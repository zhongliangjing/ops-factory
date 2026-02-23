import type { RequestHook } from '../hooks.js'
import type { GatewayConfig, VisionGlobalConfig } from '../config.js'

interface VisionConfig {
  mode: string
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  prompt: string
}

interface ImageContent {
  type: string
  data: string
  mimeType: string
}

/**
 * Resolve vision configuration: agent config overrides gateway global defaults.
 */
function resolveVisionConfig(agentConfig: Record<string, unknown>, globalVision: VisionGlobalConfig): VisionConfig {
  const agentVision = (agentConfig.vision || {}) as Record<string, unknown>
  // API key: vision.apiKey > LITELLM_API_KEY (from secrets.yaml) > global default
  const apiKey = (agentVision.apiKey as string)
    || (agentConfig.LITELLM_API_KEY as string)
    || globalVision.apiKey
    || ''
  // Base URL: vision.baseUrl > LITELLM_HOST (from config.yaml) > global default
  const baseUrl = (agentVision.baseUrl as string)
    || (agentConfig.LITELLM_HOST as string)
    || globalVision.baseUrl
    || ''
  return {
    mode:      (agentVision.mode as string)      || globalVision.mode      || 'off',
    provider:  (agentVision.provider as string)   || globalVision.provider  || '',
    model:     (agentVision.model as string)      || globalVision.model     || '',
    apiKey,
    baseUrl,
    maxTokens: (agentVision.maxTokens as number)   || globalVision.maxTokens || 1024,
    prompt:    (agentVision.prompt as string)       || globalVision.prompt    || 'Describe this image in detail.',
  }
}

/**
 * Call a vision model to analyze an image and return a text description.
 * Supports OpenAI-compatible API format (covers OpenAI, litellm/OpenRouter, Ollama, etc.)
 * and Anthropic format.
 */
async function callVisionModel(config: VisionConfig, image: ImageContent): Promise<string> {
  // Determine API format based on provider
  if (config.provider === 'anthropic') {
    return callAnthropicVision(config, image)
  }
  // Default: OpenAI-compatible format (works for openai, litellm, openrouter, ollama, etc.)
  return callOpenAICompatibleVision(config, image)
}

async function callOpenAICompatibleVision(config: VisionConfig, image: ImageContent): Promise<string> {
  let baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '')
  // Ensure /v1 prefix for OpenAI-compatible endpoints
  if (!baseUrl.endsWith('/v1')) baseUrl += '/v1'
  const url = `${baseUrl}/chat/completions`

  const body = {
    model: config.model,
    max_tokens: config.maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: config.prompt },
        {
          type: 'image_url',
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        },
      ],
    }],
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'unknown error')
    throw new Error(`Vision API error (${resp.status}): ${errorText}`)
  }

  const result = await resp.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return result.choices?.[0]?.message?.content || '[Vision model returned empty response]'
}

async function callAnthropicVision(config: VisionConfig, image: ImageContent): Promise<string> {
  const baseUrl = config.baseUrl || 'https://api.anthropic.com'
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`

  const body = {
    model: config.model,
    max_tokens: config.maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: config.prompt },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mimeType,
            data: image.data,
          },
        },
      ],
    }],
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'unknown error')
    throw new Error(`Anthropic Vision API error (${resp.status}): ${errorText}`)
  }

  const result = await resp.json() as {
    content?: Array<{ type: string; text?: string }>
  }
  const textBlock = result.content?.find(c => c.type === 'text')
  return textBlock?.text || '[Vision model returned empty response]'
}

/**
 * Vision preprocessing hook for the reply pipeline.
 *
 * - mode='off': Reject messages containing images with 400
 * - mode='passthrough': Do nothing, let images pass through to goosed as-is
 * - mode='preprocess': Call vision model to convert images to text descriptions,
 *   then replace image content with the text before forwarding to goosed
 */
export function createVisionPreprocessHook(config: GatewayConfig): RequestHook {
  return async (ctx) => {
    const visionConfig = resolveVisionConfig(ctx.agentConfig, config.vision)

    const message = ctx.body.user_message as Record<string, unknown> | undefined
    if (!message) return

    const content = message.content as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(content)) return

    const images = content.filter(c => c.type === 'image') as unknown as ImageContent[]
    if (images.length === 0) return

    switch (visionConfig.mode) {
      case 'off': {
        ctx.res.writeHead(400, { 'Content-Type': 'application/json' })
        ctx.res.end(JSON.stringify({
          error: 'Image upload is not enabled for this agent. Configure vision.mode in agent config.',
        }))
        return
      }

      case 'passthrough': {
        // Do nothing — images pass through to goosed as base64 in message content
        return
      }

      case 'preprocess': {
        if (!visionConfig.model) {
          console.error('[hook:vision-preprocess] preprocess mode requires vision model configuration')
          ctx.res.writeHead(500, { 'Content-Type': 'application/json' })
          ctx.res.end(JSON.stringify({ error: 'Vision model not configured for preprocess mode' }))
          return
        }

        console.log(`[hook:vision-preprocess] Processing ${images.length} image(s) with ${visionConfig.provider}/${visionConfig.model}`)

        // Call vision model for each image (in parallel)
        const descriptions = await Promise.all(
          images.map(async (img, i) => {
            try {
              return await callVisionModel(visionConfig, img)
            } catch (err) {
              console.error(`[hook:vision-preprocess] Failed to process image ${i + 1}:`, err)
              return `[Failed to analyze image ${i + 1}: ${err instanceof Error ? err.message : 'unknown error'}]`
            }
          })
        )

        // Replace message content: keep non-image items, replace images with text descriptions
        const newContent = content.filter(c => c.type !== 'image')
        const analysisText = descriptions
          .map((desc, i) => `[Image ${i + 1} Analysis]\n${desc}`)
          .join('\n\n')
        newContent.push({ type: 'text', text: analysisText })

        message.content = newContent
        return
      }

      default: {
        // Unknown mode, treat as passthrough
        console.warn(`[hook:vision-preprocess] Unknown vision mode '${visionConfig.mode}', treating as passthrough`)
        return
      }
    }
  }
}

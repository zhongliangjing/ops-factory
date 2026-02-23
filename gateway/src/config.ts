import { readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

export interface AgentConfig {
  id: string
  name: string
  host: string
  secret_key: string
}

export interface GatewayYamlConfig {
  agents: Array<{
    id: string
    name: string
  }>
  officePreview?: {
    enabled?: boolean
    onlyofficeUrl?: string
    fileBaseUrl?: string
  }
  idleTimeoutMinutes?: number
}

export interface OfficePreviewConfig {
  enabled: boolean
  onlyofficeUrl: string
  fileBaseUrl: string
}

export interface VisionGlobalConfig {
  mode: string            // 'off' | 'passthrough' | 'preprocess'
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  prompt: string
}

export interface UploadConfig {
  maxFileSizeMb: number
  maxImageSizeMb: number
  retentionHours: number
}

export interface GatewayConfig {
  host: string
  port: number
  secretKey: string
  projectRoot: string
  agentsDir: string
  usersDir: string
  goosedBin: string
  agents: AgentConfig[]
  officePreview: OfficePreviewConfig
  idleTimeoutMs: number
  idleCheckIntervalMs: number
  upload: UploadConfig
  vision: VisionGlobalConfig
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function loadGatewayConfig(): GatewayConfig {
  const host = process.env.GATEWAY_HOST || '0.0.0.0'
  const port = parseInt(process.env.GATEWAY_PORT || '3000', 10)
  const secretKey = process.env.GATEWAY_SECRET_KEY || 'test'
  // Default to repository root regardless of current working directory.
  const projectRoot = resolve(process.env.PROJECT_ROOT || join(__dirname, '../..'))
  const agentsDir = resolve(process.env.AGENTS_DIR || join(projectRoot, 'agents'))
  const usersDir = resolve(process.env.USERS_DIR || join(projectRoot, 'users'))
  const goosedBin = process.env.GOOSED_BIN || 'goosed'

  // Load centralized agents config
  const gatewayConfigDir = resolve(__dirname, '../config')
  const agentsConfigPath = join(gatewayConfigDir, 'agents.yaml')

  let yamlConfig: GatewayYamlConfig = {
    agents: []
  }

  if (existsSync(agentsConfigPath)) {
    const raw = readFileSync(agentsConfigPath, 'utf-8')
    yamlConfig = parse(raw) as GatewayYamlConfig
  } else {
    console.warn(`Warning: Gateway agents config not found at ${agentsConfigPath}`)
  }

  // Convert to AgentConfig array with host and secret_key
  const agents: AgentConfig[] = (yamlConfig.agents || []).map(agent => ({
    id: agent.id,
    name: agent.name,
    host,
    secret_key: secretKey,
  }))

  // Office preview (OnlyOffice) configuration — YAML first, env vars override
  const yamlOp = yamlConfig.officePreview || {}
  const officePreview: OfficePreviewConfig = {
    enabled: process.env.OFFICE_PREVIEW_ENABLED
      ? process.env.OFFICE_PREVIEW_ENABLED === 'true'
      : yamlOp.enabled ?? false,
    onlyofficeUrl: process.env.ONLYOFFICE_URL || yamlOp.onlyofficeUrl || 'http://localhost:8080',
    fileBaseUrl: process.env.ONLYOFFICE_FILE_BASE_URL || yamlOp.fileBaseUrl || `http://host.docker.internal:${port}`,
  }

  // Idle timeout for per-user goosed instances
  const idleTimeoutMinutes = yamlConfig.idleTimeoutMinutes ?? 15
  const idleTimeoutMs = parseInt(process.env.IDLE_TIMEOUT_MS || String(idleTimeoutMinutes * 60 * 1000), 10)
  const idleCheckIntervalMs = parseInt(process.env.IDLE_CHECK_INTERVAL_MS || '60000', 10)

  // File upload configuration
  const upload: UploadConfig = {
    maxFileSizeMb: parseInt(process.env.MAX_UPLOAD_FILE_SIZE_MB || '10', 10),
    maxImageSizeMb: parseInt(process.env.MAX_UPLOAD_IMAGE_SIZE_MB || '5', 10),
    retentionHours: parseInt(process.env.UPLOAD_RETENTION_HOURS || '24', 10),
  }

  // Vision global defaults (agent config.yaml can override per-agent)
  const DEFAULT_VISION_PROMPT = `Analyze this image thoroughly. Describe:
- Main content and subject matter
- Any text, numbers, or data visible
- Charts, tables, or diagrams if present
- Layout and structural elements
- Any relevant details that would help answer questions about this image
Be precise and factual.`

  const vision: VisionGlobalConfig = {
    mode: process.env.VISION_MODE || 'off',
    provider: process.env.VISION_PROVIDER || '',
    model: process.env.VISION_MODEL || '',
    apiKey: process.env.VISION_API_KEY || '',
    baseUrl: process.env.VISION_BASE_URL || '',
    maxTokens: parseInt(process.env.VISION_MAX_TOKENS || '1024', 10),
    prompt: process.env.VISION_PROMPT || DEFAULT_VISION_PROMPT,
  }

  return {
    host,
    port,
    secretKey,
    projectRoot,
    agentsDir,
    usersDir,
    goosedBin,
    agents,
    officePreview,
    idleTimeoutMs,
    idleCheckIntervalMs,
    upload,
    vision,
  }
}

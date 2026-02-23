import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { RequestHook } from '../hooks.js'
import type { GatewayConfig } from '../config.js'

/**
 * Validate that any uploaded file paths referenced in the message text
 * actually exist and are within the user's uploads directory.
 * Does NOT extract or transform file content — goosed handles that with its own tools.
 */
export function createFileAttachmentHook(config: GatewayConfig): RequestHook {
  return async (ctx) => {
    const message = ctx.body.user_message as Record<string, unknown> | undefined
    if (!message) return

    const content = message.content as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(content)) return

    const textItem = content.find(c => c.type === 'text') as { text?: string } | undefined
    if (!textItem?.text) return

    // Extract paths that look like they point to the uploads directory
    const uploadsBase = join(config.usersDir, ctx.userId, 'agents')
    const pathRegex = new RegExp(
      uploadsBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[^\\s]+/uploads/[^\\s]+',
      'g'
    )
    const referencedPaths = textItem.text.match(pathRegex)
    if (!referencedPaths || referencedPaths.length === 0) return

    for (const rawPath of referencedPaths) {
      const resolvedPath = resolve(rawPath)

      // Security: path must stay within the user's agents directory
      if (!resolvedPath.startsWith(uploadsBase)) {
        ctx.res.writeHead(403, { 'Content-Type': 'application/json' })
        ctx.res.end(JSON.stringify({ error: 'File path outside user directory' }))
        return
      }

      // Existence check
      if (!existsSync(resolvedPath)) {
        ctx.res.writeHead(404, { 'Content-Type': 'application/json' })
        ctx.res.end(JSON.stringify({ error: `Uploaded file not found: ${rawPath}` }))
        return
      }
    }
  }
}

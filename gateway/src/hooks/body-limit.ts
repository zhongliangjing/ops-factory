import type { RequestHook } from '../hooks.js'
import type { GatewayConfig } from '../config.js'

/**
 * Reject requests whose JSON body exceeds the configured size limit.
 * The limit accounts for base64 image overhead (~1.37x of raw size).
 */
export function createBodyLimitHook(config: GatewayConfig): RequestHook {
  const maxBytes = config.upload.maxFileSizeMb * 1024 * 1024 * 1.5  // extra room for base64 overhead
  return async (ctx) => {
    if (ctx.bodyStr.length > maxBytes) {
      ctx.res.writeHead(413, { 'Content-Type': 'application/json' })
      ctx.res.end(JSON.stringify({
        error: `Request body too large (${(ctx.bodyStr.length / 1024 / 1024).toFixed(1)}MB exceeds limit)`,
      }))
    }
  }
}

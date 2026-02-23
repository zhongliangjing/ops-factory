import http from 'node:http'

export interface HookContext {
  req: http.IncomingMessage
  res: http.ServerResponse
  agentId: string
  userId: string
  agentConfig: Record<string, unknown>
  body: Record<string, unknown>
  bodyStr: string
  state: Map<string, unknown>
}

export type RequestHook = (ctx: HookContext) => Promise<void>
export type ResponseHook = (ctx: HookContext, upstream: Response) => Promise<void>

interface NamedHook<T> {
  name: string
  fn: T
}

export class ReplyPipeline {
  private requestHooks: NamedHook<RequestHook>[] = []
  private responseHooks: NamedHook<ResponseHook>[] = []

  onRequest(name: string, fn: RequestHook): void {
    this.requestHooks.push({ name, fn })
  }

  onResponse(name: string, fn: ResponseHook): void {
    this.responseHooks.push({ name, fn })
  }

  /**
   * Run all registered request hooks in order.
   * Returns true if the request should proceed to upstream, false if a hook has already responded.
   */
  async runRequestHooks(ctx: HookContext): Promise<boolean> {
    for (const hook of this.requestHooks) {
      if (ctx.res.writableEnded) return false

      try {
        await hook.fn(ctx)
      } catch (err) {
        console.error(`[hook:${hook.name}] request hook error:`, err)
        if (!ctx.res.writableEnded) {
          ctx.res.writeHead(500, { 'Content-Type': 'application/json' })
          ctx.res.end(JSON.stringify({ error: `Hook '${hook.name}' failed` }))
        }
        return false
      }
    }

    if (ctx.res.writableEnded) return false

    // Sync bodyStr after all hooks have potentially modified body
    ctx.bodyStr = JSON.stringify(ctx.body)
    return true
  }

  async runResponseHooks(ctx: HookContext, upstream: Response): Promise<void> {
    for (const hook of this.responseHooks) {
      try {
        await hook.fn(ctx, upstream)
      } catch (err) {
        console.error(`[hook:${hook.name}] response hook error:`, err)
      }
    }
  }
}

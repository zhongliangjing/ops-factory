/**
 * Integration test helpers — starts a real gateway + goosed instances.
 */
import { ChildProcess, spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import net from 'node:net'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const GATEWAY_DIR = join(PROJECT_ROOT, 'gateway')
const SECRET_KEY = 'test-secret'

export interface GatewayHandle {
  port: number
  baseUrl: string
  secretKey: string
  process: ChildProcess
  logs: string[]
  /** Fetch JSON with auth headers */
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  /** Fetch JSON with auth + x-user-id */
  fetchAs: (userId: string, path: string, init?: RequestInit) => Promise<Response>
  /** Stop the gateway and all child goosed processes */
  stop: () => Promise<void>
}

/** Pick a random free port */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

/**
 * Start a real gateway process and wait until it responds on /status.
 * Uses the actual project agents.yaml and agent configs.
 */
export async function startGateway(): Promise<GatewayHandle> {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`

  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: GATEWAY_DIR,
    env: {
      ...process.env,
      GATEWAY_HOST: '127.0.0.1',
      GATEWAY_PORT: String(port),
      GATEWAY_SECRET_KEY: SECRET_KEY,
      PROJECT_ROOT,
      AGENTS_DIR: join(PROJECT_ROOT, 'agents'),
      USERS_DIR: join(PROJECT_ROOT, 'users'),
      GOOSED_BIN: process.env.GOOSED_BIN || 'goosed',
      // Short idle timeout for testing (30s)
      IDLE_TIMEOUT_MS: '30000',
      IDLE_CHECK_INTERVAL_MS: '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Collect logs for debugging
  const logs: string[] = []
  child.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    if (line) logs.push(`[gw:out] ${line}`)
  })
  child.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    if (line) logs.push(`[gw:err] ${line}`)
  })

  // Wait for gateway to respond
  const maxWait = 30_000
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${baseUrl}/status`, {
        headers: { 'x-secret-key': SECRET_KEY },
        signal: AbortSignal.timeout(2000),
      })
      if (res.ok) break
    } catch {
      // not ready yet
    }
    await sleep(500)
  }

  // Verify it's up
  try {
    const res = await fetch(`${baseUrl}/status`, {
      headers: { 'x-secret-key': SECRET_KEY },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      console.error('Gateway logs:', logs.join('\n'))
      throw new Error(`Gateway failed to start (HTTP ${res.status})`)
    }
  } catch (err) {
    console.error('Gateway logs:', logs.join('\n'))
    child.kill('SIGKILL')
    throw new Error(`Gateway failed to start: ${err}`)
  }

  const headers = (userId?: string) => {
    const h: Record<string, string> = {
      'x-secret-key': SECRET_KEY,
      'Content-Type': 'application/json',
    }
    if (userId) h['x-user-id'] = userId
    return h
  }

  return {
    port,
    baseUrl,
    secretKey: SECRET_KEY,
    process: child,
    logs,
    fetch: (path, init) =>
      fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers(), ...init?.headers } }),
    fetchAs: (userId, path, init) =>
      fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers(userId), ...init?.headers } }),
    stop: async () => {
      child.kill('SIGTERM')
      await sleep(2000)
      if (!child.killed) child.kill('SIGKILL')
      await sleep(500)
    },
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

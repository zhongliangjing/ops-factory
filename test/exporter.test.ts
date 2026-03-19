import http from 'node:http'
import net from 'node:net'
import { ChildProcess, spawn, execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { stringify } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sleep } from './helpers.js'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const EXPORTER_DIR = join(PROJECT_ROOT, 'prometheus-exporter')
const SECRET_KEY = 'test-exporter-key'

// --- Inline mock that mimics gateway /monitoring/* endpoints ---

const MOCK_SYSTEM = {
  gateway: { uptimeMs: 123_456, host: '127.0.0.1', port: 3000 },
  agents: { configured: 3 },
  idle: { timeoutMs: 900_000 },
}

const MOCK_STATUS = {
  enabled: true,
}

const MOCK_INSTANCES = {
  totalInstances: 3,
  runningInstances: 2,
  byAgent: [
    {
      agentId: 'a1',
      instances: [
        { userId: 'alice', port: 50001, pid: 1001, status: 'running', lastActivity: Date.now() - 5000 },
        { userId: 'bob', port: 50002, pid: 1002, status: 'running', lastActivity: Date.now() - 30000 },
      ],
    },
    {
      agentId: 'a2',
      instances: [
        { userId: 'alice', port: 50003, pid: 1003, status: 'error', lastActivity: Date.now() - 60000 },
      ],
    },
  ],
}

interface MockGateway {
  port: number
  server: http.Server
  stop: () => Promise<void>
}

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

async function startMockMonitoringGateway(): Promise<MockGateway> {
  const port = await freePort()
  const server = http.createServer((req, res) => {
    // Auth check
    if (req.headers['x-secret-key'] !== SECRET_KEY) {
      res.writeHead(401); res.end('Unauthorized'); return
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)

    // Support both /ops-gateway/* and direct paths for backward compatibility
    const pathname = url.pathname

    if (pathname === '/monitoring/system' || pathname === '/ops-gateway/monitoring/system') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(MOCK_SYSTEM))
      return
    }
    if (pathname === '/monitoring/instances' || pathname === '/ops-gateway/monitoring/instances') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(MOCK_INSTANCES))
      return
    }
    if (pathname === '/monitoring/status' || pathname === '/ops-gateway/monitoring/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(MOCK_STATUS))
      return
    }
    if (pathname === '/status' || pathname === '/ops-gateway/status') {
      res.writeHead(200); res.end('ok'); return
    }
    res.writeHead(404); res.end('Not Found')
  })

  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))

  return {
    port,
    server,
    stop: () => new Promise(resolve => server.close(() => resolve())),
  }
}

// --- Exporter process helper ---

interface ExporterHandle {
  port: number
  process: ChildProcess
  logs: string[]
  stop: () => Promise<void>
}

function buildExporterJar() {
  const mvn = process.env.MVN || '/tmp/apache-maven-3.9.6/bin/mvn'
  execFileSync(mvn, ['-q', '-DskipTests', 'package'], {
    cwd: EXPORTER_DIR,
    stdio: 'pipe',
  })
}

async function startExporter(gatewayPort: number): Promise<ExporterHandle> {
  const port = await freePort()

  // Write a temp config.yaml for this test run
  const testConfigPath = join(tmpdir(), `ops-factory-exporter-test-${port}.yaml`)
  const testConfig = {
    port,
    gatewayUrl: `http://127.0.0.1:${gatewayPort}/ops-gateway`,
    gatewaySecretKey: SECRET_KEY,
    collectTimeoutMs: 3000,
  }
  writeFileSync(testConfigPath, stringify(testConfig), 'utf-8')

  const child = spawn('java', ['-Dserver.port=' + String(port), '-jar', 'target/prometheus-exporter.jar'], {
    cwd: EXPORTER_DIR,
    env: {
      ...process.env,
      CONFIG_PATH: testConfigPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const logs: string[] = []
  child.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    if (line) logs.push(`[exp:out] ${line}`)
  })
  child.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    if (line) logs.push(`[exp:err] ${line}`)
  })

  // Wait for exporter to be ready
  const maxWait = 10_000
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) break
    } catch {
      // not ready
    }
    await sleep(250)
  }

  // Verify
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) {
      console.error('Exporter logs:', logs.join('\n'))
      throw new Error(`Exporter failed to start (HTTP ${res.status})`)
    }
  } catch (err) {
    console.error('Exporter logs:', logs.join('\n'))
    child.kill('SIGKILL')
    throw new Error(`Exporter failed to start: ${err}`)
  }

  return {
    port,
    process: child,
    logs,
    stop: async () => {
      child.kill('SIGTERM')
      await sleep(500)
      if (!child.killed) child.kill('SIGKILL')
      await sleep(250)
      try { unlinkSync(testConfigPath) } catch { /* ignore */ }
    },
  }
}

// --- Helper to parse Prometheus text into a map ---

function parsePrometheusText(text: string): Map<string, { value: number; labels: Record<string, string> }[]> {
  const metrics = new Map<string, { value: number; labels: Record<string, string> }[]>()

  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue

    // e.g. opsfactory_instances_total{status="running"} 2
    // or   opsfactory_gateway_up 1
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\{([^}]*)\})?\s+(.+)$/)
    if (!match) continue

    const name = match[1]
    const labelsStr = match[3] || ''
    const value = parseFloat(match[4])

    const labels: Record<string, string> = {}
    if (labelsStr) {
      for (const part of labelsStr.split(',')) {
        const eqIdx = part.indexOf('=')
        if (eqIdx > 0) {
          const key = part.slice(0, eqIdx).trim()
          const val = part.slice(eqIdx + 1).trim().replace(/^"|"$/g, '')
          labels[key] = val
        }
      }
    }

    if (!metrics.has(name)) metrics.set(name, [])
    metrics.get(name)!.push({ value, labels })
  }

  return metrics
}

// --- Tests ---

describe('Prometheus Exporter', () => {
  let mockGateway: MockGateway
  let exporter: ExporterHandle

  beforeAll(async () => {
    buildExporterJar()
    mockGateway = await startMockMonitoringGateway()
    exporter = await startExporter(mockGateway.port)
  }, 120_000)

  afterAll(async () => {
    if (exporter) await exporter.stop()
    if (mockGateway) await mockGateway.stop()
  })

  it('GET /health returns ok', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/health`)
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })

  it('GET / returns HTML with link to /metrics', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('/metrics')
    expect(html).toContain('Prometheus Exporter')
  })

  it('GET /unknown returns 404', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/unknown`)
    expect(res.status).toBe(404)
  })

  it('GET /metrics returns valid Prometheus text format', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    expect(res.status).toBe(200)
    const contentType = res.headers.get('content-type') || ''
    expect(contentType).toContain('text/plain')

    const body = await res.text()
    // Should contain HELP and TYPE lines
    expect(body).toContain('# HELP opsfactory_gateway_up')
    expect(body).toContain('# TYPE opsfactory_gateway_up gauge')
  })

  it('reports gateway_up = 1 when gateway is reachable', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    const metrics = parsePrometheusText(await res.text())

    const gatewayUp = metrics.get('opsfactory_gateway_up')
    expect(gatewayUp).toBeDefined()
    expect(gatewayUp![0].value).toBe(1)
  })

  it('reports correct gateway uptime', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    const metrics = parsePrometheusText(await res.text())

    const uptime = metrics.get('opsfactory_gateway_uptime_seconds')
    expect(uptime).toBeDefined()
    // MOCK_SYSTEM.gateway.uptimeMs = 123456 → 123.456s
    expect(uptime![0].value).toBeCloseTo(123.456, 2)
  })

  it('reports correct agents_configured_total', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    const metrics = parsePrometheusText(await res.text())

    const agents = metrics.get('opsfactory_agents_configured_total')
    expect(agents).toBeDefined()
    expect(agents![0].value).toBe(3)
  })

  it('reports instances_total by status', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    const metrics = parsePrometheusText(await res.text())

    const instances = metrics.get('opsfactory_instances_total')
    expect(instances).toBeDefined()

    const running = instances!.find(m => m.labels.status === 'running')
    const error = instances!.find(m => m.labels.status === 'error')
    expect(running?.value).toBe(2)
    expect(error?.value).toBe(1)
  })

  it('reports instance_idle_seconds per agent/user', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    const metrics = parsePrometheusText(await res.text())

    const idle = metrics.get('opsfactory_instance_idle_seconds')
    expect(idle).toBeDefined()
    expect(idle!.length).toBe(3) // 3 instances total

    const aliceA1 = idle!.find(m => m.labels.agent_id === 'a1' && m.labels.user_id === 'alice')
    expect(aliceA1).toBeDefined()
    // idle is computed from (now - lastActivity), lastActivity was set to Date.now() - 5000
    // so idle should be roughly >= 5s (plus some elapsed time)
    expect(aliceA1!.value).toBeGreaterThanOrEqual(4)
    expect(aliceA1!.value).toBeLessThan(60)

    const bobA1 = idle!.find(m => m.labels.agent_id === 'a1' && m.labels.user_id === 'bob')
    expect(bobA1).toBeDefined()
    expect(bobA1!.value).toBeGreaterThanOrEqual(29)
    expect(bobA1!.value).toBeLessThan(120)
  })

  it('reports instance_info with metadata labels', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    const metrics = parsePrometheusText(await res.text())

    const info = metrics.get('opsfactory_instance_info')
    expect(info).toBeDefined()
    expect(info!.length).toBe(3)

    const aliceA2 = info!.find(m => m.labels.agent_id === 'a2' && m.labels.user_id === 'alice')
    expect(aliceA2).toBeDefined()
    expect(aliceA2!.labels.port).toBe('50003')
    expect(aliceA2!.labels.status).toBe('error')
    expect(aliceA2!.value).toBe(1) // info metric is always 1
  })

  it('reports langfuse_configured', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    const metrics = parsePrometheusText(await res.text())

    const langfuse = metrics.get('opsfactory_langfuse_configured')
    expect(langfuse).toBeDefined()
    expect(langfuse![0].value).toBe(1)
  })

  it('includes Node.js process metrics (exporter self-monitoring)', async () => {
    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    const body = await res.text()

    // prom-client default metrics with our prefix
    expect(body).toContain('opsfactory_exporter_process_cpu')
    expect(body).toContain('opsfactory_exporter_nodejs_heap')
  })

  it('reports gateway_up = 0 when gateway is unreachable', async () => {
    // Stop the mock gateway
    await mockGateway.stop()

    // Give a moment for the port to be released
    await sleep(500)

    const res = await fetch(`http://127.0.0.1:${exporter.port}/metrics`)
    expect(res.status).toBe(200)

    const metrics = parsePrometheusText(await res.text())
    const gatewayUp = metrics.get('opsfactory_gateway_up')
    expect(gatewayUp).toBeDefined()
    expect(gatewayUp![0].value).toBe(0)

    // Restart mock gateway for any potential cleanup
    mockGateway = await startMockMonitoringGateway()
  })
})

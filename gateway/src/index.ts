import http from 'node:http'
import https from 'node:https'
import { PassThrough } from 'node:stream'
import { join } from 'node:path'
import { mkdir, rename, readdir, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import httpProxy from 'http-proxy'
import { parse as parseYaml } from 'yaml'
import { loadGatewayConfig, type GatewayConfig } from './config.js'
import { InstanceManager, SYSTEM_USER } from './instance-manager.js'
import { listOutputFiles, serveFile } from './file-server.js'
import { SessionOwnerCache, extractUserFromWorkingDir } from './user-registry.js'
import { ReplyPipeline, type HookContext } from './hooks.js'
import { readBodyAsBuffer, extractBoundary, parseMultipart } from './multipart.js'
import { createBodyLimitHook } from './hooks/body-limit.js'
import { createFileAttachmentHook } from './hooks/file-attachment.js'
import { createVisionPreprocessHook } from './hooks/vision-preprocess.js'
import { LangfuseClient } from './langfuse.js'

type JsonRecord = Record<string, unknown>

interface AgentSession extends JsonRecord {
  id: string
  working_dir?: string
  updated_at?: string
  schedule_id?: string | null
  agentId: string
}

const DEFAULT_USER = SYSTEM_USER

/** Determine user role based on userId */
function getUserRole(userId: string): 'admin' | 'user' {
  return userId === SYSTEM_USER ? 'admin' : 'user'
}

/** Return 403 if not admin. Returns true if allowed, false if blocked. */
function requireAdmin(res: http.ServerResponse, role: string): boolean {
  if (role !== 'admin') {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden: admin access required' }))
    return false
  }
  return true
}

/** Read request body as a string */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/** Format milliseconds as a human-readable uptime string */
function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

async function main() {
  const config = loadGatewayConfig()
  const startTime = Date.now()
  const manager = new InstanceManager(config)
  const ownerCache = new SessionOwnerCache()

  // Langfuse client (optional — monitoring disabled when null)
  const langfuse = config.langfuse ? new LangfuseClient(config.langfuse) : null
  if (langfuse) {
    console.log(`Langfuse monitoring enabled → ${config.langfuse!.host}`)
  } else {
    console.log('Langfuse monitoring disabled (no config found)')
  }

  console.log(`Gateway starting — ${config.agents.length} agent(s) configured (per-user instances, lazy start)`)

  // Run data migration from old directory structure
  await migrateToPerUserLayout(manager, config)

  // Start idle reaper for per-user instances
  manager.startIdleReaper(config.idleCheckIntervalMs, config.idleTimeoutMs)

  // Pre-start sys instances for all agents (sys = system user, always ready, never reaped)
  await manager.startAllForSystemUser()

  // Register default schedules from agent recipe files (non-blocking)
  registerDefaultSchedules(manager, config).catch(err =>
    console.warn('[schedules] Failed to register default schedules:', err)
  )

  const proxy = httpProxy.createProxyServer({
    proxyTimeout: 5 * 60 * 1000,
    timeout: 5 * 60 * 1000,
  })

  proxy.on('error', (err, _req, res) => {
    console.error('Proxy error:', err.message)
    if (res instanceof http.ServerResponse && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad gateway' }))
    }
  })

  // ===== Reply pipeline (hooks for /reply route) =====
  const pipeline = new ReplyPipeline()
  pipeline.onRequest('body-limit', createBodyLimitHook(config))
  pipeline.onRequest('file-attachment', createFileAttachmentHook(config))
  pipeline.onRequest('vision-preprocess', createVisionPreprocessHook(config))

  // ===== Helper: fetch JSON from a specific target URL =====

  const upstreamHeaders = (secretKey: string) => ({
    'x-secret-key': secretKey,
    'Content-Type': 'application/json',
  })

  const tryParseJson = (text: string): JsonRecord | null => {
    try { return JSON.parse(text) as JsonRecord } catch { return null }
  }

  const fetchJsonFromTarget = async (target: string, path: string, secretKey: string, method: 'GET' | 'DELETE' = 'GET') => {
    try {
      const response = await fetch(`${target}${path}`, {
        method,
        headers: upstreamHeaders(secretKey),
        signal: AbortSignal.timeout(5000),
      })
      const text = await response.text()
      return { ok: response.ok, status: response.status, json: tryParseJson(text), raw: text }
    } catch (error) {
      return { ok: false as const, status: 502, json: null as JsonRecord | null, raw: '', error: error instanceof Error ? error.message : 'Unknown upstream error' }
    }
  }

  const postJsonToTarget = async (target: string, path: string, body: unknown, secretKey: string) => {
    try {
      const response = await fetch(`${target}${path}`, {
        method: 'POST',
        headers: upstreamHeaders(secretKey),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })
      const text = await response.text()
      return { ok: response.ok, status: response.status, json: tryParseJson(text), raw: text }
    } catch (error) {
      return { ok: false as const, status: 502, json: null as JsonRecord | null, raw: '', error: error instanceof Error ? error.message : 'Unknown upstream error' }
    }
  }

  const parseSessions = (agentId: string, payload: JsonRecord | null): AgentSession[] => {
    const raw = payload?.sessions
    if (!Array.isArray(raw)) return []
    return raw
      .filter((item): item is JsonRecord => typeof item === 'object' && item !== null)
      .filter((item): item is JsonRecord & { id: string } => typeof item.id === 'string')
      .map(item => ({ ...item, agentId }))
  }

  // ===== HTTP Server =====

  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url || '/'

    // CORS
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigin)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-secret-key, x-user-id')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Auth
    const headerKey = req.headers['x-secret-key']
    const urlObj = new URL(url, `http://${req.headers.host || 'localhost'}`)
    const queryKey = urlObj.searchParams.get('key')
    const isFileRoute = urlObj.pathname.match(/^\/agents\/[^/]+\/files(\/|$)/)
    const isAuthed = headerKey === config.secretKey || (isFileRoute && queryKey === config.secretKey)

    if (!isAuthed) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    const userId = (req.headers['x-user-id'] as string)
      || (isFileRoute ? urlObj.searchParams.get('uid') : null) || DEFAULT_USER
    const role = getUserRole(userId)
    const pathname = urlObj.pathname

    // Path traversal protection: check raw URL before URL normalization strips ".."
    // new URL() resolves ".." segments, which could bypass file route guards
    if (/\/files\//.test(url) && /\.\./.test(url)) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Forbidden: path traversal detected' }))
      return
    }

    // ===== Routes =====

    // GET /status
    if (pathname === '/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }

    // GET /me
    if (pathname === '/me' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ userId, role }))
      return
    }

    // GET /config
    if (pathname === '/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ officePreview: config.officePreview }))
      return
    }

    // GET /agents
    if (pathname === '/agents' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ agents: manager.listAgents() }))
      return
    }

    // POST /agents — create a new agent (admin only)
    if (pathname === '/agents' && req.method === 'POST') {
      if (!requireAdmin(res, role)) return
      const body = await readBody(req)
      try {
        const { id, name } = JSON.parse(body)
        if (!id || typeof id !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Agent ID is required' }))
          return
        }
        if (!name || typeof name !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Agent name is required' }))
          return
        }
        const result = manager.createAgent(id.trim(), name.trim())
        res.writeHead(result.success ? 201 : 400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      }
      return
    }

    // DELETE /agents/:id — delete an agent (admin only)
    const deleteAgentMatch = pathname.match(/^\/agents\/([^/]+)\/?$/)
    if (deleteAgentMatch && req.method === 'DELETE') {
      if (!requireAdmin(res, role)) return
      const agentId = deleteAgentMatch[1]
      const result = await manager.deleteAgent(agentId)
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }

    // ===== Monitoring Routes — admin only =====

    // GET /monitoring/system — gateway health & platform info (no Langfuse dependency)
    if (pathname === '/monitoring/system' && req.method === 'GET') {
      if (!requireAdmin(res, role)) return
      const now = Date.now()
      const uptimeMs = now - startTime
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        gateway: {
          host: config.host,
          port: config.port,
          uptimeMs,
          uptimeFormatted: formatUptime(uptimeMs),
          startedAt: new Date(startTime).toISOString(),
        },
        agents: {
          configured: config.agents.length,
          list: config.agents.map(a => ({ id: a.id, name: a.name })),
        },
        idle: {
          timeoutMs: config.idleTimeoutMs,
          checkIntervalMs: config.idleCheckIntervalMs,
        },
        langfuse: {
          configured: !!config.langfuse,
          host: config.langfuse?.host || null,
        },
      }))
      return
    }

    // GET /monitoring/instances — all running instances grouped by agent
    if (pathname === '/monitoring/instances' && req.method === 'GET') {
      if (!requireAdmin(res, role)) return
      const snapshots = manager.getInstancesSnapshot()

      const byAgent: Record<string, { agentId: string; agentName: string; instances: typeof snapshots }> = {}
      for (const snap of snapshots) {
        if (!byAgent[snap.agentId]) {
          const agentCfg = config.agents.find(a => a.id === snap.agentId)
          byAgent[snap.agentId] = {
            agentId: snap.agentId,
            agentName: agentCfg?.name || snap.agentId,
            instances: [],
          }
        }
        byAgent[snap.agentId].instances.push(snap)
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        totalInstances: snapshots.length,
        runningInstances: snapshots.filter(s => s.status === 'running').length,
        byAgent: Object.values(byAgent),
      }))
      return
    }

    // GET /monitoring/status — is monitoring available?
    if (pathname === '/monitoring/status' && req.method === 'GET') {
      if (!requireAdmin(res, role)) return
      if (!langfuse) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ enabled: false }))
        return
      }
      const reachable = await langfuse.healthy()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        enabled: true,
        reachable,
        host: config.langfuse!.host,
      }))
      return
    }

    // GET /monitoring/overview?from=ISO&to=ISO
    if (pathname === '/monitoring/overview' && req.method === 'GET') {
      if (!requireAdmin(res, role)) return
      if (!langfuse) {
        res.writeHead(501, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Monitoring not configured' }))
        return
      }
      try {
        const from = urlObj.searchParams.get('from') || new Date(Date.now() - 86400000).toISOString()
        const to = urlObj.searchParams.get('to') || new Date().toISOString()
        const data = await langfuse.overview(from, to)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(data))
      } catch (err) {
        console.error('[monitoring] overview error:', err)
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to fetch monitoring data' }))
      }
      return
    }

    // GET /monitoring/traces?from=ISO&to=ISO&limit=20&errorsOnly=false
    if (pathname === '/monitoring/traces' && req.method === 'GET') {
      if (!requireAdmin(res, role)) return
      if (!langfuse) {
        res.writeHead(501, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Monitoring not configured' }))
        return
      }
      try {
        const from = urlObj.searchParams.get('from') || new Date(Date.now() - 86400000).toISOString()
        const to = urlObj.searchParams.get('to') || new Date().toISOString()
        const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10)
        const errorsOnly = urlObj.searchParams.get('errorsOnly') === 'true'
        const data = await langfuse.recentTraces({ from, to, limit, errorsOnly })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(data))
      } catch (err) {
        console.error('[monitoring] traces error:', err)
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to fetch traces' }))
      }
      return
    }

    // GET /monitoring/observations?from=ISO&to=ISO
    if (pathname === '/monitoring/observations' && req.method === 'GET') {
      if (!requireAdmin(res, role)) return
      if (!langfuse) {
        res.writeHead(501, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Monitoring not configured' }))
        return
      }
      try {
        const from = urlObj.searchParams.get('from') || new Date(Date.now() - 86400000).toISOString()
        const to = urlObj.searchParams.get('to') || new Date().toISOString()
        const data = await langfuse.latencyDistribution(from, to)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(data))
      } catch (err) {
        console.error('[monitoring] observations error:', err)
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to fetch observations' }))
      }
      return
    }

    // ===== Session Routes =====

    // POST /agents/:id/agent/start — create session (spawn user instance if needed)
    const startMatch = pathname.match(/^\/agents\/([^/]+)\/agent\/start\/?$/)
    if (startMatch && req.method === 'POST') {
      const agentId = startMatch[1]

      try {
        const target = await manager.getOrSpawn(agentId, userId)
        const bodyStr = await readBody(req)
        const body = bodyStr ? JSON.parse(bodyStr) : {}

        // Always set working_dir to the user's runtime root — the gateway
        // is the authority for per-user paths, not the client.
        body.working_dir = manager.getUserRootPath(agentId, userId)

        const result = await postJsonToTarget(target, '/agent/start', body, config.secretKey)
        if (!result.ok) {
          res.writeHead(result.status, { 'Content-Type': 'application/json' })
          res.end(result.raw || JSON.stringify({ error: 'Failed to create session' }))
          return
        }

        // Cache session ownership
        const sessionId = (result.json as JsonRecord)?.id as string
        if (sessionId) ownerCache.set(sessionId, userId)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result.json))
      } catch (err) {
        console.error('Session creation error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to create session' }))
      }
      return
    }

    // GET /sessions — aggregated from user's instances + sys instances
    if (pathname === '/sessions' && req.method === 'GET') {
      const allSessions: AgentSession[] = []
      const partialFailures: Array<{ agentId: string; error: string | null }> = []

      // For each agent, query user's instance (if running) + sys instance (if running)
      await Promise.all(config.agents.map(async (agent) => {
        const targets: Array<{ target: string; label: string }> = []

        // User's instance
        const userTarget = manager.getTarget(agent.id, userId)
        if (userTarget) targets.push({ target: userTarget, label: `${agent.id}:${userId}` })

        // Sys instance (shared sessions from schedules)
        const defaultTarget = manager.getTarget(agent.id, SYSTEM_USER)
        if (defaultTarget && defaultTarget !== userTarget) {
          targets.push({ target: defaultTarget, label: `${agent.id}:${SYSTEM_USER}` })
        }

        for (const { target, label } of targets) {
          const result = await fetchJsonFromTarget(target, `/sessions${urlObj.search}`, config.secretKey)
          if (!result.ok) {
            partialFailures.push({ agentId: agent.id, error: `HTTP ${result.status} from ${label}` })
          } else {
            const sessions = parseSessions(agent.id, result.json)
            allSessions.push(...sessions)
          }
        }
      }))

      // Populate ownership cache
      ownerCache.populateFromSessions(allSessions.map(s => ({ id: s.id, working_dir: s.working_dir })))

      // Filter: user sees own sessions + sys/shared sessions
      const sessions = allSessions
        .filter(session => {
          const owner = session.working_dir
            ? extractUserFromWorkingDir(session.working_dir)
            : DEFAULT_USER
          return owner === userId || owner === DEFAULT_USER
        })
        .sort((a, b) => {
          const aTs = typeof a.updated_at === 'string' ? Date.parse(a.updated_at) : 0
          const bTs = typeof b.updated_at === 'string' ? Date.parse(b.updated_at) : 0
          return bTs - aTs
        })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions, partialFailures }))
      return
    }

    // GET /sessions/:id
    const sessionReadMatch = pathname.match(/^\/sessions\/([^/]+)\/?$/)
    if (sessionReadMatch && req.method === 'GET') {
      const sessionId = decodeURIComponent(sessionReadMatch[1])
      const agentId = urlObj.searchParams.get('agentId') || undefined

      // Try to find session in user's instances and sys instances
      const probes = await probeSessionAcrossInstances(sessionId, userId, agentId)
      if (probes.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session not found' }))
        return
      }
      if (!agentId && probes.length > 1) {
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session exists in multiple agents. Please provide agentId.', agentIds: probes.map(p => p.agentId) }))
        return
      }

      const probe = probes[0]
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ...probe.session, agentId: probe.agentId }))
      return
    }

    // DELETE /sessions/:id
    const sessionDeleteMatch = pathname.match(/^\/sessions\/([^/]+)\/?$/)
    if (sessionDeleteMatch && req.method === 'DELETE') {
      const sessionId = decodeURIComponent(sessionDeleteMatch[1])
      const agentId = urlObj.searchParams.get('agentId') || undefined

      const probes = await probeSessionAcrossInstances(sessionId, userId, agentId)
      if (probes.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session not found' }))
        return
      }
      if (!agentId && probes.length > 1) {
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session exists in multiple agents. Please provide agentId.', agentIds: probes.map(p => p.agentId) }))
        return
      }

      const probe = probes[0]
      const result = await fetchJsonFromTarget(probe.target, `/sessions/${encodeURIComponent(sessionId)}`, config.secretKey, 'DELETE')
      if (!result.ok) {
        res.writeHead(result.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `Failed to delete session on agent '${probe.agentId}'` }))
        return
      }

      ownerCache.remove(sessionId)
      // Clean up uploaded files for this session
      cleanupSessionUploads(probe.agentId, userId, sessionId, manager)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, agentId: probe.agentId }))
      return
    }

    // ===== File Routes =====

    // GET /agents/:id/files — list user's files
    const fileListMatch = pathname.match(/^\/agents\/([^/]+)\/files\/?$/)
    if (fileListMatch && req.method === 'GET') {
      const agentId = fileListMatch[1]
      const userRootPath = manager.getUserRootPath(agentId, userId)
      await mkdir(userRootPath, { recursive: true })
      try {
        // List files, skipping goose system directories
        const files = await listOutputFiles(userRootPath, ['data', 'state', 'config'])
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ files }))
      } catch (err) {
        console.error('File listing error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to list files' }))
      }
      return
    }

    // GET /agents/:id/files/* — serve a specific file
    const fileServeMatch = pathname.match(/^\/agents\/([^/]+)\/files\/(.+)$/)
    if (fileServeMatch && req.method === 'GET') {
      const agentId = fileServeMatch[1]
      const filePath = decodeURIComponent(fileServeMatch[2])
      const userRootPath = manager.getUserRootPath(agentId, userId)
      await serveFile(userRootPath, filePath, req, res)
      return
    }

    // POST /agents/:id/files/upload — upload a file (multipart/form-data)
    const fileUploadMatch = pathname.match(/^\/agents\/([^/]+)\/files\/upload\/?$/)
    if (fileUploadMatch && req.method === 'POST') {
      const agentId = fileUploadMatch[1]
      const contentType = req.headers['content-type'] || ''

      if (!contentType.includes('multipart/form-data')) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Content-Type must be multipart/form-data' }))
        return
      }

      const boundary = extractBoundary(contentType)
      if (!boundary) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing multipart boundary' }))
        return
      }

      try {
        const maxBytes = config.upload.maxFileSizeMb * 1024 * 1024
        const body = await readBodyAsBuffer(req, maxBytes)
        const fields = parseMultipart(body, boundary)

        const fileField = fields.find(f => f.name === 'file' && f.filename)
        if (!fileField) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No file field found in upload' }))
          return
        }

        const sessionIdField = fields.find(f => f.name === 'sessionId')
        const sessionId = sessionIdField ? sessionIdField.data.toString('utf-8').trim() : 'default'

        // Sanitize filename: remove path separators and special chars, add timestamp prefix
        const rawName = fileField.filename!
        const safeName = rawName.replace(/[/\\:*?"<>|]/g, '_').replace(/^\.+/, '')
        const timestamp = Date.now()
        const storedName = `${timestamp}_${safeName}`

        // File type whitelist (extension check)
        const ALLOWED_EXTENSIONS = new Set([
          '.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.toml',
          '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.rb', '.sh',
          '.html', '.css', '.sql', '.log', '.conf', '.cfg', '.ini', '.env',
          '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
          '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
          '.zip', '.tar', '.gz',
        ])
        const ext = safeName.includes('.') ? '.' + safeName.split('.').pop()!.toLowerCase() : ''
        if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `File type '${ext}' is not allowed` }))
          return
        }

        // Store to uploads directory
        const uploadsDir = join(manager.getUserRootPath(agentId, userId), 'uploads', sessionId)
        await mkdir(uploadsDir, { recursive: true })
        const filePath = join(uploadsDir, storedName)
        writeFileSync(filePath, fileField.data)

        console.log(`[upload] ${agentId}:${userId} uploaded ${safeName} (${fileField.data.length} bytes) → ${filePath}`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          path: filePath,
          name: safeName,
          size: fileField.data.length,
          type: fileField.contentType || 'application/octet-stream',
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        const status = message.includes('exceeds maximum size') ? 413 : 500
        console.error('[upload] error:', err)
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: message }))
      }
      return
    }

    // ===== Session proxy routes (reply/resume/restart/stop) =====

    const sessionProxyMatch = pathname.match(/^\/agents\/([^/]+)\/(?:agent\/)?(reply|resume|restart|stop)\/?$/)
    if (sessionProxyMatch && req.method === 'POST') {
      const agentId = sessionProxyMatch[1]
      const action = sessionProxyMatch[2]

      const bodyStr = await readBody(req)
      let bodyJson: JsonRecord = {}
      try { bodyJson = bodyStr ? JSON.parse(bodyStr) : {} } catch { /* pass through */ }

      try {
        const target = await manager.getOrSpawn(agentId, userId)

        // For reply (SSE streaming), run pipeline hooks then proxy
        if (action === 'reply') {
          // Build hook context and run request hooks
          const agentFullConfig = manager.getAgentFullConfig(agentId)
          const hookCtx: HookContext = {
            req, res, agentId, userId,
            agentConfig: agentFullConfig,
            body: bodyJson,
            bodyStr,
            state: new Map(),
          }

          const proceed = await pipeline.runRequestHooks(hookCtx)
          if (!proceed) return  // A hook already responded (e.g. 400, 413)

          try {
            const upstreamResponse = await fetch(`${target}/reply`, {
              method: 'POST',
              headers: upstreamHeaders(config.secretKey),
              body: hookCtx.bodyStr,
            })

            res.writeHead(upstreamResponse.status, {
              'Content-Type': upstreamResponse.headers.get('content-type') || 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            })

            if (upstreamResponse.body) {
              const reader = upstreamResponse.body.getReader()
              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  res.write(value)
                }
              } catch {
                // Stream interrupted
              }
              res.end()
            } else {
              res.end()
            }
          } catch (err) {
            console.error('SSE proxy error:', err)
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' })
            }
            res.end(JSON.stringify({ error: 'Bad gateway' }))
          }
          return
        }

        // Non-streaming actions
        const result = await postJsonToTarget(target, `/agent/${action}`, bodyJson, config.secretKey)
        res.writeHead(result.ok ? 200 : result.status, { 'Content-Type': 'application/json' })
        res.end(result.raw || JSON.stringify(result.json || { error: `Failed to ${action} session` }))
      } catch (err) {
        console.error(`Session ${action} error:`, err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : `Failed to ${action}` }))
      }
      return
    }

    // ===== Agent-level routes (admin only) =====

    // GET/POST /agents/:id/mcp — proxy to sys instance + fanout for POST
    const mcpMatch = pathname.match(/^\/agents\/([^/]+)\/mcp\/?$/)
    if (mcpMatch && (req.method === 'GET' || req.method === 'POST')) {
      if (!requireAdmin(res, role)) return
      const agentId = mcpMatch[1]
      try {
        const target = await manager.getSystemInstance(agentId)

        if (req.method === 'GET') {
          req.url = '/config/extensions'
          proxy.web(req, res, { target })
        } else {
          // POST: forward to sys instance
          const bodyStr = await readBody(req)
          const result = await postJsonToTarget(target, '/config/extensions', bodyStr ? JSON.parse(bodyStr) : {}, config.secretKey)

          // Fanout to all running user instances of this agent
          const userInstances = manager.getRunningInstancesForAgent(agentId)
            .filter(inst => inst.userId !== SYSTEM_USER)
          if (userInstances.length > 0 && bodyStr) {
            const body = JSON.parse(bodyStr)
            await Promise.allSettled(userInstances.map(async inst => {
              const instTarget = manager.getTarget(inst.agentId, inst.userId)
              if (instTarget) {
                await postJsonToTarget(instTarget, '/config/extensions', body, config.secretKey)
              }
            }))
          }

          res.writeHead(result.ok ? 200 : result.status, { 'Content-Type': 'application/json' })
          res.end(result.raw || JSON.stringify(result.json))
        }
      } catch (err) {
        console.error('MCP route error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'MCP operation failed' }))
      }
      return
    }

    // DELETE /agents/:id/mcp/:name — proxy + fanout
    const mcpDeleteMatch = pathname.match(/^\/agents\/([^/]+)\/mcp\/(.+)$/)
    if (mcpDeleteMatch && req.method === 'DELETE') {
      if (!requireAdmin(res, role)) return
      const agentId = mcpDeleteMatch[1]
      const mcpName = mcpDeleteMatch[2]
      try {
        const target = await manager.getSystemInstance(agentId)
        const result = await fetchJsonFromTarget(target, `/config/extensions/${mcpName}`, config.secretKey, 'DELETE')

        // Fanout delete to all running user instances
        const userInstances = manager.getRunningInstancesForAgent(agentId)
          .filter(inst => inst.userId !== SYSTEM_USER)
        if (userInstances.length > 0) {
          await Promise.allSettled(userInstances.map(async inst => {
            const instTarget = manager.getTarget(inst.agentId, inst.userId)
            if (instTarget) {
              await fetchJsonFromTarget(instTarget, `/config/extensions/${mcpName}`, config.secretKey, 'DELETE')
            }
          }))
        }

        res.writeHead(result.ok ? 200 : result.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result.json))
      } catch (err) {
        console.error('MCP delete error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'MCP delete failed' }))
      }
      return
    }

    // GET/PUT /agents/:id/config — reads/writes files directly, no instance needed (admin only)
    const configMatch = pathname.match(/^\/agents\/([^/]+)\/config\/?$/)
    if (configMatch && (req.method === 'GET' || req.method === 'PUT')) {
      if (!requireAdmin(res, role)) return
      const agentId = configMatch[1]

      if (req.method === 'GET') {
        const agentConfig = manager.getAgentConfig(agentId)
        if (!agentConfig) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `Agent '${agentId}' not found` }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(agentConfig))
        return
      }

      if (req.method === 'PUT') {
        const body = await readBody(req)
        try {
          const updates = JSON.parse(body)
          const result = manager.updateAgentConfig(agentId, updates)
          res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        }
        return
      }
    }

    // GET /agents/:id/skills (admin only)
    const skillsMatch = pathname.match(/^\/agents\/([^/]+)\/skills\/?$/)
    if (skillsMatch && req.method === 'GET') {
      if (!requireAdmin(res, role)) return
      const agentId = skillsMatch[1]
      const skills = manager.getAgentSkillsDetailed(agentId)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ skills }))
      return
    }

    // ===== Agent-prefixed session routes (SDK calls use /agents/:id/sessions/...) =====

    // GET /agents/:id/sessions — list sessions for this agent (user + sys)
    const agentSessionsListMatch = pathname.match(/^\/agents\/([^/]+)\/sessions\/?$/)
    if (agentSessionsListMatch && req.method === 'GET') {
      const agentId = agentSessionsListMatch[1]
      const allSessions: AgentSession[] = []

      const listUids = userId === SYSTEM_USER ? [SYSTEM_USER] : [userId, SYSTEM_USER]
      for (const uid of listUids) {
        const target = manager.getTarget(agentId, uid)
        if (!target) continue
        const result = await fetchJsonFromTarget(target, `/sessions${urlObj.search}`, config.secretKey)
        if (result.ok) {
          allSessions.push(...parseSessions(agentId, result.json))
        }
      }

      // Filter: user sees own + shared sessions
      const sessions = allSessions
        .filter(session => {
          const owner = session.working_dir
            ? extractUserFromWorkingDir(session.working_dir)
            : DEFAULT_USER
          return owner === userId || owner === DEFAULT_USER
        })
        .sort((a, b) => {
          const aTs = typeof a.updated_at === 'string' ? Date.parse(a.updated_at) : 0
          const bTs = typeof b.updated_at === 'string' ? Date.parse(b.updated_at) : 0
          return bTs - aTs
        })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions }))
      return
    }

    // GET /agents/:id/sessions/:sessionId — get session from user's own instance
    // Session IDs are per-instance (not globally unique), so we only check the user's instance.
    // Schedule sessions (on sys instance) are discoverable via listing routes.
    const agentSessionGetMatch = pathname.match(/^\/agents\/([^/]+)\/sessions\/([^/]+)\/?$/)
    if (agentSessionGetMatch && req.method === 'GET') {
      const agentId = agentSessionGetMatch[1]
      const sessionId = decodeURIComponent(agentSessionGetMatch[2])

      // Check user's running instance first
      const target = manager.getTarget(agentId, userId)
      if (target) {
        const result = await fetchJsonFromTarget(target, `/sessions/${encodeURIComponent(sessionId)}`, config.secretKey)
        if (result.ok && result.json) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ...result.json, agentId }))
          return
        }
      }

      // Instance not running — spawn to check persistent sessions
      if (!target) {
        try {
          const spawnedTarget = await manager.getOrSpawn(agentId, userId)
          const result = await fetchJsonFromTarget(spawnedTarget, `/sessions/${encodeURIComponent(sessionId)}`, config.secretKey)
          if (result.ok && result.json) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ...result.json, agentId }))
            return
          }
        } catch { /* instance spawn failed */ }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }

    // DELETE /agents/:id/sessions/:sessionId — delete from user's own instance
    const agentSessionDeleteMatch = pathname.match(/^\/agents\/([^/]+)\/sessions\/([^/]+)\/?$/)
    if (agentSessionDeleteMatch && req.method === 'DELETE') {
      const agentId = agentSessionDeleteMatch[1]
      const sessionId = decodeURIComponent(agentSessionDeleteMatch[2])

      const target = manager.getTarget(agentId, userId)
      if (target) {
        const result = await fetchJsonFromTarget(target, `/sessions/${encodeURIComponent(sessionId)}`, config.secretKey, 'DELETE')
        if (result.ok) {
          ownerCache.remove(sessionId)
          cleanupSessionUploads(agentId, userId, sessionId, manager)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, agentId }))
          return
        }
      }

      // Try spawning if instance not running
      if (!target) {
        try {
          const spawnedTarget = await manager.getOrSpawn(agentId, userId)
          const result = await fetchJsonFromTarget(spawnedTarget, `/sessions/${encodeURIComponent(sessionId)}`, config.secretKey, 'DELETE')
          if (result.ok) {
            ownerCache.remove(sessionId)
            cleanupSessionUploads(agentId, userId, sessionId, manager)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, agentId }))
            return
          }
        } catch { /* spawn failed */ }
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }

    // PUT /agents/:id/sessions/:sessionId/* — proxy to user's instance (rename etc.)
    const agentSessionMutateMatch = pathname.match(/^\/agents\/([^/]+)\/sessions\/([^/]+)(\/.+)$/)
    if (agentSessionMutateMatch && (req.method === 'PUT' || req.method === 'POST')) {
      const agentId = agentSessionMutateMatch[1]
      const sessionId = agentSessionMutateMatch[2]
      const subPath = agentSessionMutateMatch[3]

      try {
        const target = await manager.getOrSpawn(agentId, userId)
        req.url = `/sessions/${sessionId}${subPath}${urlObj.search}`
        proxy.web(req, res, { target })
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Agent not available' }))
      }
      return
    }

    // GET /agents/:id/system_info — proxy to user's own instance (no admin required)
    const systemInfoMatch = pathname.match(/^\/agents\/([^/]+)\/system_info\/?$/)
    if (systemInfoMatch && req.method === 'GET') {
      const agentId = systemInfoMatch[1]
      try {
        const target = await manager.getOrSpawn(agentId, userId)
        req.url = '/system_info' + urlObj.search
        proxy.web(req, res, { target })
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Agent not available' }))
      }
      return
    }

    // /agents/:id/* — catch-all proxy to sys instance (schedules, etc.) — admin only
    // Buffer the request body BEFORE async work (spawn) to prevent stream data loss.
    // http-proxy pipes from the original req stream, but if the body data events
    // fire during an await (e.g. instance spawn), the data is lost.
    const match = pathname.match(/^\/agents\/([^/]+)(\/.*)?$/)
    if (match) {
      if (!requireAdmin(res, role)) return
      const agentId = match[1]
      const path = match[2] || '/'

      // Eagerly buffer request body so it survives async gaps
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      await new Promise<void>(resolve => req.on('end', resolve))

      try {
        const target = await manager.getSystemInstance(agentId)
        req.url = path + urlObj.search
        const buffer = new PassThrough()
        buffer.end(Buffer.concat(chunks))
        proxy.web(req, res, { target, buffer })
      } catch (err) {
        console.error('Catch-all proxy error:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Agent not available' }))
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found. Use /agents/:id/* to reach a goosed instance.' }))
  }

  const server = config.tls.enabled
    ? https.createServer({ cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key) }, requestHandler)
    : http.createServer(requestHandler)

  // ===== Helper: probe session across user + sys instances =====

  async function probeSessionAcrossInstances(sessionId: string, forUserId: string, preferredAgentId?: string) {
    const agentIds = preferredAgentId ? [preferredAgentId] : config.agents.map(a => a.id)
    const probes: Array<{ agentId: string; target: string; session: JsonRecord }> = []

    await Promise.all(agentIds.map(async (agentId) => {
      // Check user's instance first, then sys
      const uids = forUserId === SYSTEM_USER ? [SYSTEM_USER] : [forUserId, SYSTEM_USER]
      for (const uid of uids) {
        const target = manager.getTarget(agentId, uid)
        if (!target) continue
        const result = await fetchJsonFromTarget(target, `/sessions/${encodeURIComponent(sessionId)}`, config.secretKey)
        if (result.ok && result.json) {
          // When found on sys instance, verify session is accessible to this user
          if (uid === SYSTEM_USER && forUserId !== SYSTEM_USER) {
            const wd = (result.json as any).working_dir as string | undefined
            const owner = wd ? extractUserFromWorkingDir(wd) : SYSTEM_USER
            if (owner !== forUserId && owner !== SYSTEM_USER) continue
          }
          probes.push({ agentId, target, session: result.json })
          return // Found in this agent, no need to check sys
        }
      }
    }))

    return probes
  }

  // ===== Shutdown =====

  const shutdown = async () => {
    console.log('\nGateway shutting down...')
    server.close()
    await manager.stopAll()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  server.listen(config.port, config.host, () => {
    const proto = config.tls.enabled ? 'https' : 'http'
    console.log(`Gateway listening on ${proto}://${config.host}:${config.port}`)
    console.log(`  Idle timeout: ${config.idleTimeoutMs / 1000}s`)
    for (const a of config.agents) {
      console.log(`  Agent: ${a.id} (instances spawn on demand)`)
    }
  })
}

// ===== Upload cleanup =====

function cleanupSessionUploads(agentId: string, userId: string, sessionId: string, manager: InstanceManager): void {
  const uploadsDir = join(manager.getUserRootPath(agentId, userId), 'uploads', sessionId)
  if (!existsSync(uploadsDir)) return
  try {
    rmSync(uploadsDir, { recursive: true, force: true })
  } catch (err) {
    console.warn(`[cleanup] Failed to remove uploads for session ${sessionId}:`, err)
  }
}

// ===== Default Schedule Registration =====

/**
 * Scan each agent's config/recipes/ directory for recipe files and register
 * them as paused schedules on the sys instance (if not already present).
 */
async function registerDefaultSchedules(
  manager: InstanceManager,
  config: GatewayConfig,
): Promise<void> {
  const DEFAULT_CRON = '0 9 * * *' // daily at 09:00
  const authHeaders = { 'x-secret-key': config.secretKey, 'Content-Type': 'application/json' }

  for (const agent of config.agents) {
    const recipesDir = join(config.agentsDir, agent.id, 'config', 'recipes')
    if (!existsSync(recipesDir)) continue

    let recipeFiles: string[]
    try {
      recipeFiles = readdirSync(recipesDir).filter(f => /\.(ya?ml|json)$/.test(f))
    } catch { continue }
    if (recipeFiles.length === 0) continue

    const target = manager.getTarget(agent.id, SYSTEM_USER)
    if (!target) {
      console.warn(`[schedules] No sys instance for ${agent.id}, skipping schedule registration`)
      continue
    }

    // Fetch existing schedules (response: { jobs: [...] })
    let existing: Array<{ id: string }> = []
    try {
      const res = await fetch(`${target}/schedule/list`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json() as { jobs?: Array<{ id: string }> }
        existing = data.jobs || []
      }
    } catch { /* list failed — will try to create anyway */ }

    const existingIds = new Set(existing.map(s => s.id))

    for (const file of recipeFiles) {
      const scheduleId = file.replace(/\.(ya?ml|json)$/, '')
      if (existingIds.has(scheduleId)) continue

      try {
        const raw = readFileSync(join(recipesDir, file), 'utf-8')
        const recipe = file.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)

        // Create schedule
        const createRes = await fetch(`${target}/schedule/create`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ id: scheduleId, recipe, cron: DEFAULT_CRON }),
          signal: AbortSignal.timeout(5000),
        })
        if (!createRes.ok) {
          const msg = await createRes.text().catch(() => '')
          console.warn(`[schedules] Failed to create schedule ${scheduleId} for ${agent.id}: ${createRes.status} ${msg}`)
          continue
        }

        // Pause immediately (default schedules start paused)
        await fetch(`${target}/schedule/${encodeURIComponent(scheduleId)}/pause`, {
          method: 'POST',
          headers: authHeaders,
          signal: AbortSignal.timeout(5000),
        })

        console.log(`[schedules] Registered schedule "${scheduleId}" for ${agent.id} (paused)`)
      } catch (err) {
        console.warn(`[schedules] Error registering ${scheduleId} for ${agent.id}:`, err)
      }
    }
  }
}

// ===== Migration Logic =====

const MIGRATION_MARKER_V2 = '.per-user-v2-migrated'

async function migrateToPerUserLayout(
  manager: InstanceManager,
  config: { projectRoot: string; agentsDir: string; usersDir: string; agents: Array<{ id: string }> }
): Promise<void> {
  const markerPath = join(config.projectRoot, 'gateway', 'data', MIGRATION_MARKER_V2)

  if (existsSync(markerPath)) return

  console.log('Migrating to users/{userId}/agents/{agentId}/ layout...')
  let totalMoved = 0

  for (const agent of config.agents) {
    const agentRoot = join(config.agentsDir, agent.id)
    if (!existsSync(agentRoot)) continue

    // Helper: move all non-hidden entries from src dir into dst dir
    const moveContents = async (srcDir: string, dstDir: string) => {
      try {
        const entries = readdirSync(srcDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue
          const src = join(srcDir, entry.name)
          const dst = join(dstDir, entry.name)
          if (existsSync(dst)) continue // don't overwrite
          try { await rename(src, dst); totalMoved++ }
          catch (err) { console.warn(`  Migration: ${src} → ${dst}: ${(err as Error).message}`) }
        }
      } catch { /* src dir unreadable */ }
    }

    // 1. Migrate from artifacts/users/{userId}/ (oldest format)
    const oldArtifactsUsers = join(agentRoot, 'artifacts', 'users')
    if (existsSync(oldArtifactsUsers)) {
      for (const entry of readdirSync(oldArtifactsUsers, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const newRoot = await manager.prepareUserRuntime(agent.id, entry.name)
        await moveContents(join(oldArtifactsUsers, entry.name), newRoot)
      }
    }

    // 2. Migrate from agents/{agentId}/users/{userId}/ (v1 format from previous migration)
    const oldUsersDir = join(agentRoot, 'users')
    if (existsSync(oldUsersDir)) {
      for (const entry of readdirSync(oldUsersDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const newRoot = await manager.prepareUserRuntime(agent.id, entry.name)
        await moveContents(join(oldUsersDir, entry.name), newRoot)
      }
    }

    // 3. Migrate old shared data/ and state/ to sys instance
    const sysRoot = await manager.prepareUserRuntime(agent.id, SYSTEM_USER)

    for (const dirName of ['data', 'state']) {
      const oldDir = join(agentRoot, dirName)
      const newDir = join(sysRoot, dirName)
      if (existsSync(oldDir) && !existsSync(newDir)) {
        try { await rename(oldDir, newDir); console.log(`  Migrated ${agent.id}/${dirName}/ → sys`) }
        catch (err) { console.warn(`  Migration: ${dirName}/: ${(err as Error).message}`) }
      }
    }

    // 3b. Migrate __default__ user data to sys (from previous version)
    const oldDefaultRoot = join(config.usersDir, '__default__', 'agents', agent.id)
    if (existsSync(oldDefaultRoot)) {
      for (const dirName of ['data', 'state']) {
        const oldDir = join(oldDefaultRoot, dirName)
        const newDir = join(sysRoot, dirName)
        if (existsSync(oldDir) && !existsSync(newDir)) {
          try { await rename(oldDir, newDir); console.log(`  Migrated __default__/${agent.id}/${dirName}/ → sys`) }
          catch (err) { console.warn(`  Migration: ${dirName}/: ${(err as Error).message}`) }
        }
      }
      try { await rm(oldDefaultRoot, { recursive: true, force: true }) } catch { /* */ }
    }

    // 4. Clean up old directories
    for (const oldDir of [join(agentRoot, 'artifacts'), join(agentRoot, 'users'), join(agentRoot, 'data'), join(agentRoot, 'state')]) {
      if (existsSync(oldDir)) {
        try { await rm(oldDir, { recursive: true, force: true }) } catch { /* */ }
      }
    }
    // Also clean up __default__ user directory if empty
    const oldDefaultUserDir = join(config.usersDir, '__default__')
    if (existsSync(oldDefaultUserDir)) {
      try { await rm(oldDefaultUserDir, { recursive: true, force: true }) } catch { /* */ }
    }
  }

  // Write migration marker
  const markerDir = join(config.projectRoot, 'gateway', 'data')
  if (!existsSync(markerDir)) mkdirSync(markerDir, { recursive: true })
  writeFileSync(markerPath, new Date().toISOString(), 'utf-8')

  console.log(`  Migration complete (v2): ${totalMoved} files moved`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

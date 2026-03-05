import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'

type UserRole = 'admin' | 'user'

interface AgentInfo {
  id: string
  name: string
  status: string
  provider: string
  model: string
  skills: string[]
}

interface MessageContent {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  created: number
  content: MessageContent[]
  metadata: {
    userVisible: boolean
    agentVisible: boolean
  }
}

interface SessionRecord {
  id: string
  name: string
  working_dir: string
  session_type: string
  schedule_id?: string | null
  created_at: string
  updated_at: string
  user_set_name?: boolean
  message_count: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  provider_name: string
  conversation: ChatMessage[]
}

interface FileRecord {
  path: string
  name: string
  size: number
  modifiedAt: string
  type: string
  content: string
}

interface PromptTemplate {
  name: string
  description: string
  default_content: string
  user_content: string | null
  is_customized: boolean
}

interface ScheduleRecord {
  id: string
  source: string
  cron: string
  last_run?: string | null
  currently_running?: boolean
  paused?: boolean
  current_session_id?: string | null
  process_start_time?: string | null
  runSessionIds: string[]
}

const HOST = process.env.GATEWAY_HOST || '127.0.0.1'
const PORT = Number(process.env.GATEWAY_PORT || '3000')
const SECRET_KEY = process.env.GATEWAY_SECRET_KEY || 'test'

const appVersion = 'mock-gateway/0.1.0'
const nowIso = () => new Date().toISOString()
const nowEpoch = () => Math.floor(Date.now() / 1000)
let idCounter = 0

function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now()}-${idCounter}`
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type,x-secret-key,x-user-id',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  })
  res.end(payload)
}

function text(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type,x-secret-key,x-user-id',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  })
  res.end(body)
}

function noContent(res: ServerResponse, status = 204): void {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type,x-secret-key,x-user-id',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  })
  res.end()
}

function notFound(res: ServerResponse): void {
  json(res, 404, { error: 'Not found' })
}

function unauthorized(res: ServerResponse): void {
  json(res, 401, { error: 'Unauthorized' })
}

function badRequest(res: ServerResponse, message: string): void {
  json(res, 400, { error: message })
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function parseJson<T>(raw: string): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function extOf(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : 'txt'
}

function inferMime(type: string): string {
  switch (type) {
    case 'md':
    case 'txt':
    case 'log':
      return 'text/plain; charset=utf-8'
    case 'html':
      return 'text/html; charset=utf-8'
    case 'json':
      return 'application/json; charset=utf-8'
    case 'csv':
      return 'text/csv; charset=utf-8'
    case 'png':
      return 'image/png'
    default:
      return 'text/plain; charset=utf-8'
  }
}

function userIdOf(req: IncomingMessage): string {
  const header = req.headers['x-user-id']
  if (typeof header === 'string' && header.trim()) return header.trim()
  return 'sys'
}

function roleOf(userId: string): UserRole {
  return userId === 'sys' || userId === 'admin' ? 'admin' : 'user'
}

function ensureAuth(req: IncomingMessage, url: URL): boolean {
  const headerKey = req.headers['x-secret-key']
  const queryKey = url.searchParams.get('key')
  return headerKey === SECRET_KEY || queryKey === SECRET_KEY
}

const agentCatalog = [
  {
    id: 'universal-agent',
    name: 'Universal Agent',
    provider: 'mock-openai',
    model: 'gpt-4.1-mini',
    skills: ['incident-summary', 'release-checklist'],
    visionMode: 'passthrough',
    agentsMd: '# Universal Agent\n\nThis is a mock agent used for webapp development.',
  },
  {
    id: 'kb-agent',
    name: 'KB Agent',
    provider: 'mock-anthropic',
    model: 'claude-3.7-sonnet',
    skills: ['knowledge-search', 'doc-answer'],
    visionMode: 'passthrough',
    agentsMd: '# KB Agent\n\nThis is a mock KB agent.',
  },
  {
    id: 'report-agent',
    name: 'Report Agent',
    provider: 'mock-openai',
    model: 'gpt-4.1',
    skills: ['report-generation', 'chart-summary'],
    visionMode: 'passthrough',
    agentsMd: '# Report Agent\n\nThis is a mock reporting agent.',
  },
]

const promptsByAgent = new Map<string, PromptTemplate[]>(
  agentCatalog.map(agent => [agent.id, [
    {
      name: 'system',
      description: 'Primary system prompt',
      default_content: `You are the ${agent.name} running behind a mock gateway.`,
      user_content: null,
      is_customized: false,
    },
    {
      name: 'planner',
      description: 'Planning prompt',
      default_content: 'Break work into clear actionable steps.',
      user_content: null,
      is_customized: false,
    },
  ]]),
)

const mcpByAgent = new Map<string, Array<Record<string, unknown>>>(
  agentCatalog.map(agent => [agent.id, [
    {
      enabled: true,
      type: 'builtin',
      name: 'filesystem',
      description: 'Mock filesystem access',
      bundled: true,
      available_tools: ['read_file', 'write_file'],
    },
    {
      enabled: false,
      type: 'streamable_http',
      name: 'slack',
      description: 'Mock Slack MCP',
      bundled: true,
      uri: 'https://mock.invalid/slack',
      available_tools: ['post_message'],
    },
  ]]),
)

const skillsByAgent = new Map<string, Array<Record<string, string>>>(
  agentCatalog.map(agent => [agent.id, agent.skills.map(skill => ({
    name: skill,
    description: `Mock skill for ${agent.name}: ${skill}`,
    path: `skills/${skill}/SKILL.md`,
  }))]),
)

const filesByAgent = new Map<string, Map<string, FileRecord>>()
const schedulesByAgent = new Map<string, Map<string, ScheduleRecord>>()
const sessionsByUser = new Map<string, Map<string, Map<string, SessionRecord>>>()

function workingDirFor(agentId: string, userId: string): string {
  return `/mock/users/${userId}/agents/${agentId}`
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedFiles(): void {
  for (const agent of agentCatalog) {
    const items = new Map<string, FileRecord>()
    const seeded: FileRecord[] = [
      {
        path: 'README.md',
        name: 'README.md',
        size: 72,
        modifiedAt: nowIso(),
        type: 'md',
        content: `# ${agent.name}\n\nMock artifacts for webapp testing.`,
      },
      {
        path: 'artifacts/summary.html',
        name: 'summary.html',
        size: 118,
        modifiedAt: nowIso(),
        type: 'html',
        content: `<html><body><h1>${agent.name}</h1><p>Mock preview document.</p></body></html>`,
      },
      {
        path: 'artifacts/table.csv',
        name: 'table.csv',
        size: 48,
        modifiedAt: nowIso(),
        type: 'csv',
        content: 'name,value\nerrors,3\nlatency_ms,142\nsuccess_rate,99.1',
      },
    ]
    for (const file of seeded) {
      items.set(file.path, file)
    }
    filesByAgent.set(agent.id, items)
    schedulesByAgent.set(agent.id, new Map())
  }
}

seedFiles()

function agentInfo(agentId: string, userId: string): AgentInfo | null {
  const agent = agentCatalog.find(item => item.id === agentId)
  if (!agent) return null
  return {
    id: agent.id,
    name: agent.name,
    status: 'running',
    provider: agent.provider,
    model: agent.model,
    skills: clone(agent.skills),
  }
}

function sessionsFor(userId: string, agentId: string): Map<string, SessionRecord> {
  let byAgent = sessionsByUser.get(userId)
  if (!byAgent) {
    byAgent = new Map()
    sessionsByUser.set(userId, byAgent)
  }

  let sessions = byAgent.get(agentId)
  if (!sessions) {
    sessions = new Map()
    byAgent.set(agentId, sessions)
  }
  return sessions
}

function serializeSession(session: SessionRecord): SessionRecord {
  return clone(session)
}

function createSession(agentId: string, userId: string, workingDir?: string, sessionType = 'user', scheduleId: string | null = null): SessionRecord {
  const createdAt = nowIso()
  const id = nextId('session')
  const session: SessionRecord = {
    id,
    name: `${agentId} ${sessionType === 'scheduled' ? 'scheduled' : 'chat'} session`,
    working_dir: workingDir || workingDirFor(agentId, userId),
    session_type: sessionType,
    schedule_id: scheduleId,
    created_at: createdAt,
    updated_at: createdAt,
    message_count: 0,
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    provider_name: agentCatalog.find(agent => agent.id === agentId)?.provider || 'mock-openai',
    conversation: [],
  }
  sessionsFor(userId, agentId).set(id, session)
  return session
}

function findSession(agentId: string, userId: string, sessionId: string): SessionRecord | null {
  return sessionsFor(userId, agentId).get(sessionId) || null
}

function sessionList(agentId: string, userId: string): SessionRecord[] {
  return Array.from(sessionsFor(userId, agentId).values())
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map(serializeSession)
}

function appendConversation(session: SessionRecord, message: ChatMessage): void {
  session.conversation.push(message)
  session.message_count = session.conversation.length
  session.updated_at = nowIso()
}

function makeAssistantReply(agentId: string, userText: string): string {
  const intro = `Mock reply from ${agentId}.`
  if (!userText.trim()) return `${intro} No user text was provided.`
  return `${intro} You said: "${userText.trim()}". This response is synthetic and intended for webapp testing.`
}

function makeTokenState(inputText: string, outputText: string) {
  const inputTokens = Math.max(8, Math.ceil(inputText.length / 4))
  const outputTokens = Math.max(12, Math.ceil(outputText.length / 4))
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    accumulatedInputTokens: inputTokens,
    accumulatedOutputTokens: outputTokens,
    accumulatedTotalTokens: inputTokens + outputTokens,
  }
}

function sse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`)

  if (req.method === 'OPTIONS') {
    return noContent(res)
  }

  if (!ensureAuth(req, url)) {
    return unauthorized(res)
  }

  const pathname = url.pathname
  const userId = userIdOf(req)

  if (req.method === 'GET' && pathname === '/status') {
    return text(res, 200, 'ok')
  }

  if (req.method === 'GET' && pathname === '/me') {
    return json(res, 200, { userId, role: roleOf(userId) })
  }

  if (req.method === 'GET' && pathname === '/config') {
    return json(res, 200, {
      officePreview: {
        enabled: false,
        onlyofficeUrl: '',
        fileBaseUrl: `${url.protocol}//${url.host}`,
      },
    })
  }

  if (req.method === 'GET' && pathname === '/agents') {
    return json(res, 200, {
      agents: agentCatalog
        .map(agent => agentInfo(agent.id, userId))
        .filter((agent): agent is AgentInfo => agent !== null),
    })
  }

  if (req.method === 'GET' && pathname === '/monitoring/status') {
    return json(res, 200, { enabled: true, reachable: true, host: 'http://mock-langfuse.local' })
  }

  if (req.method === 'GET' && pathname === '/monitoring/overview') {
    return json(res, 200, {
      totalTraces: 42,
      totalObservations: 168,
      totalCost: 1.23,
      avgLatency: 1.42,
      p95Latency: 2.6,
      errorCount: 3,
      daily: [
        { date: '2026-02-27T00:00:00.000Z', traces: 4, observations: 16, cost: 0.11 },
        { date: '2026-02-28T00:00:00.000Z', traces: 7, observations: 28, cost: 0.17 },
        { date: '2026-03-01T00:00:00.000Z', traces: 9, observations: 36, cost: 0.29 },
        { date: '2026-03-02T00:00:00.000Z', traces: 10, observations: 41, cost: 0.31 },
        { date: '2026-03-03T00:00:00.000Z', traces: 12, observations: 47, cost: 0.35 },
      ],
    })
  }

  if (req.method === 'GET' && pathname === '/monitoring/traces') {
    return json(res, 200, [
      {
        id: 'trace-1',
        name: 'Mock home flow',
        timestamp: '2026-03-03T08:10:00.000Z',
        input: 'Create a daily summary',
        latency: 1.23,
        totalCost: 0.03,
        observationCount: 4,
        hasError: false,
      },
      {
        id: 'trace-2',
        name: 'Mock scheduled run',
        timestamp: '2026-03-03T09:30:00.000Z',
        input: 'Run a scheduled action',
        latency: 2.11,
        totalCost: 0.08,
        observationCount: 6,
        hasError: true,
        errorMessage: 'Synthetic timeout',
      },
    ])
  }

  if (req.method === 'GET' && pathname === '/monitoring/observations') {
    return json(res, 200, {
      observations: [
        {
          name: 'planner',
          count: 18,
          avgLatency: 0.92,
          p95Latency: 1.44,
          totalTokens: 2400,
          totalCost: 0.44,
        },
        {
          name: 'writer',
          count: 9,
          avgLatency: 1.58,
          p95Latency: 2.4,
          totalTokens: 3100,
          totalCost: 0.79,
        },
      ],
    })
  }

  const agentMatch = pathname.match(/^\/agents\/([^/]+)(?:\/(.*))?$/)
  if (!agentMatch) {
    return notFound(res)
  }

  const agentId = decodeURIComponent(agentMatch[1])
  const tail = agentMatch[2] || ''
  const agent = agentCatalog.find(item => item.id === agentId)
  if (!agent) {
    return notFound(res)
  }

  if (req.method === 'GET' && tail === 'system_info') {
    return json(res, 200, {
      app_version: appVersion,
      os: 'mock-os',
      os_version: '1.0',
      architecture: 'x64',
      provider: agent.provider,
      model: agent.model,
      enabled_extensions: ['filesystem'],
    })
  }

  if (req.method === 'POST' && tail === 'agent/start') {
    // Gateway is the authority for working_dir — ignore client-supplied value
    await parseBody(req)
    const session = createSession(agentId, userId)
    return json(res, 200, serializeSession(session))
  }

  if (req.method === 'POST' && tail === 'agent/resume') {
    const body = parseJson<{ session_id?: string }>(await parseBody(req)) || {}
    if (!body.session_id) return badRequest(res, 'session_id is required')
    const session = findSession(agentId, userId, body.session_id)
    if (!session) return notFound(res)
    return json(res, 200, { session: serializeSession(session), extension_results: [] })
  }

  if (req.method === 'POST' && tail === 'agent/restart') {
    return json(res, 200, { extension_results: [] })
  }

  if (req.method === 'POST' && tail === 'agent/stop') {
    return json(res, 200, { success: true })
  }

  if (req.method === 'POST' && tail === 'reply') {
    const body = parseJson<{ session_id?: string; user_message?: Omit<ChatMessage, 'id'> }>(await parseBody(req)) || {}
    if (!body.session_id || !body.user_message) return badRequest(res, 'session_id and user_message are required')

    const session = findSession(agentId, userId, body.session_id)
    if (!session) return notFound(res)

    const userMessage: ChatMessage = {
      id: nextId('msg-user'),
      role: 'user',
      created: body.user_message.created || nowEpoch(),
      content: clone(body.user_message.content || []),
      metadata: {
        userVisible: body.user_message.metadata?.userVisible !== false,
        agentVisible: body.user_message.metadata?.agentVisible !== false,
      },
    }

    const userText = userMessage.content
      .filter(content => content.type === 'text' && typeof content.text === 'string')
      .map(content => content.text || '')
      .join('\n')

    const replyText = makeAssistantReply(agentId, userText)
    const assistantMessage: ChatMessage = {
      id: nextId('msg-assistant'),
      role: 'assistant',
      created: nowEpoch(),
      content: [{ type: 'text', text: replyText }],
      metadata: { userVisible: true, agentVisible: true },
    }

    appendConversation(session, userMessage)
    appendConversation(session, assistantMessage)
    const tokenState = makeTokenState(userText, replyText)
    session.input_tokens += tokenState.inputTokens
    session.output_tokens += tokenState.outputTokens
    session.total_tokens += tokenState.totalTokens

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type,x-secret-key,x-user-id',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    })

    sse(res, { type: 'Message', message: serializeSession(session).conversation.slice(-1)[0], token_state: tokenState })
    sse(res, { type: 'Finish', reason: 'completed', token_state: tokenState })
    return res.end()
  }

  if (req.method === 'POST' && tail === 'files/upload') {
    const raw = await parseBody(req)
    const nameMatch = raw.match(/filename="([^"]+)"/)
    const fileName = nameMatch?.[1] || `upload-${idCounter + 1}.txt`
    const ext = extOf(fileName)
    const filePath = `uploads/${fileName}`
    const fileRecord: FileRecord = {
      path: filePath,
      name: fileName,
      size: Buffer.byteLength(raw),
      modifiedAt: nowIso(),
      type: ext,
      content: `Uploaded via mock gateway: ${fileName}`,
    }
    filesByAgent.get(agentId)?.set(filePath, fileRecord)
    return json(res, 200, {
      path: filePath,
      name: fileName,
      size: fileRecord.size,
      type: ext,
    })
  }

  if (req.method === 'GET' && tail === 'sessions') {
    return json(res, 200, { sessions: sessionList(agentId, userId) })
  }

  const sessionMatch = tail.match(/^sessions\/([^/]+)(?:\/(.*))?$/)
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1])
    const sessionTail = sessionMatch[2] || ''
    const session = findSession(agentId, userId, sessionId)
    if (!session) return notFound(res)

    if (req.method === 'GET' && sessionTail === '') {
      return json(res, 200, serializeSession(session))
    }

    if (req.method === 'DELETE' && sessionTail === '') {
      sessionsFor(userId, agentId).delete(sessionId)
      return noContent(res)
    }

    if (req.method === 'PUT' && sessionTail === 'name') {
      const body = parseJson<{ name?: string }>(await parseBody(req)) || {}
      session.name = body.name?.trim() || session.name
      session.user_set_name = true
      session.updated_at = nowIso()
      return noContent(res)
    }

    if (req.method === 'GET' && sessionTail === 'export') {
      const lines = session.conversation.map(msg => {
        const textParts = msg.content.filter(item => item.type === 'text').map(item => item.text || '')
        return `${msg.role.toUpperCase()}: ${textParts.join(' ')}`
      })
      return text(res, 200, lines.join('\n') || 'No conversation yet.')
    }
  }

  if (req.method === 'GET' && tail === 'config') {
    return json(res, 200, {
      id: agent.id,
      name: agent.name,
      agentsMd: agent.agentsMd,
      workingDir: workingDirFor(agent.id, userId),
      provider: agent.provider,
      model: agent.model,
      visionMode: agent.visionMode,
    })
  }

  if (req.method === 'PUT' && tail === 'config') {
    const body = parseJson<{ agentsMd?: string }>(await parseBody(req)) || {}
    if (typeof body.agentsMd === 'string') {
      agent.agentsMd = body.agentsMd
    }
    return json(res, 200, { success: true })
  }

  if (req.method === 'GET' && tail === 'skills') {
    return json(res, 200, { skills: clone(skillsByAgent.get(agent.id) || []) })
  }

  if (req.method === 'GET' && tail === 'mcp') {
    return json(res, 200, { extensions: clone(mcpByAgent.get(agent.id) || []), warnings: [] })
  }

  if (req.method === 'POST' && tail === 'mcp') {
    const body = parseJson<{ name?: string; enabled?: boolean; config?: Record<string, unknown> }>(await parseBody(req)) || {}
    if (!body.name) return badRequest(res, 'name is required')
    const list = mcpByAgent.get(agent.id) || []
    const idx = list.findIndex(item => item.name === body.name)
    const nextEntry = {
      name: body.name,
      enabled: body.enabled !== false,
      description: String(body.config?.description || 'Mock MCP entry'),
      type: String(body.config?.type || 'streamable_http'),
      ...(body.config || {}),
    }
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...nextEntry }
    } else {
      list.push(nextEntry)
    }
    mcpByAgent.set(agent.id, list)
    return json(res, 200, { success: true })
  }

  const mcpDeleteMatch = tail.match(/^mcp\/([^/]+)$/)
  if (req.method === 'DELETE' && mcpDeleteMatch) {
    const name = decodeURIComponent(mcpDeleteMatch[1])
    const list = mcpByAgent.get(agent.id) || []
    mcpByAgent.set(agent.id, list.filter(item => item.name !== name))
    return noContent(res)
  }

  if (req.method === 'GET' && tail === 'files') {
    return json(res, 200, {
      files: Array.from(filesByAgent.get(agent.id)?.values() || []).map(file => ({
        path: file.path,
        name: file.name,
        size: file.size,
        modifiedAt: file.modifiedAt,
        type: file.type,
      })),
    })
  }

  const fileMatch = tail.match(/^files\/(.+)$/)
  if (req.method === 'GET' && fileMatch) {
    const filePath = decodeURIComponent(fileMatch[1])
    const file = filesByAgent.get(agent.id)?.get(filePath)
    if (!file) return notFound(res)
    return text(res, 200, file.content, inferMime(file.type))
  }

  if (req.method === 'GET' && tail === 'config/prompts') {
    return json(res, 200, { prompts: clone(promptsByAgent.get(agent.id) || []) })
  }

  const promptMatch = tail.match(/^config\/prompts\/([^/]+)$/)
  if (promptMatch) {
    const promptName = decodeURIComponent(promptMatch[1])
    const prompts = promptsByAgent.get(agent.id) || []
    const prompt = prompts.find(item => item.name === promptName)
    if (!prompt) return notFound(res)

    if (req.method === 'GET') {
      return json(res, 200, {
        name: prompt.name,
        content: prompt.user_content || prompt.default_content,
        default_content: prompt.default_content,
        is_customized: prompt.is_customized,
      })
    }

    if (req.method === 'PUT') {
      const body = parseJson<{ content?: string }>(await parseBody(req)) || {}
      prompt.user_content = body.content || ''
      prompt.is_customized = true
      return noContent(res)
    }

    if (req.method === 'DELETE') {
      prompt.user_content = null
      prompt.is_customized = false
      return noContent(res)
    }
  }

  if (req.method === 'GET' && tail === 'schedule/list') {
    return json(res, 200, { jobs: Array.from(schedulesByAgent.get(agent.id)?.values() || []).map(job => clone(job)) })
  }

  if (req.method === 'POST' && tail === 'schedule/create') {
    const body = parseJson<{ id?: string; recipe?: { title?: string }; cron?: string }>(await parseBody(req)) || {}
    if (!body.id || !body.cron) return badRequest(res, 'id and cron are required')
    const schedule: ScheduleRecord = {
      id: body.id,
      source: body.recipe?.title || body.id,
      cron: body.cron,
      last_run: null,
      currently_running: false,
      paused: false,
      current_session_id: null,
      process_start_time: null,
      runSessionIds: [],
    }
    schedulesByAgent.get(agent.id)?.set(schedule.id, schedule)
    return json(res, 200, clone(schedule))
  }

  const scheduleDeleteMatch = tail.match(/^schedule\/delete\/([^/]+)$/)
  if (req.method === 'DELETE' && scheduleDeleteMatch) {
    const scheduleId = decodeURIComponent(scheduleDeleteMatch[1])
    schedulesByAgent.get(agent.id)?.delete(scheduleId)
    return noContent(res)
  }

  const schedulePauseMatch = tail.match(/^schedule\/([^/]+)\/(pause|unpause|run_now|inspect|sessions|kill)$/)
  if (schedulePauseMatch) {
    const scheduleId = decodeURIComponent(schedulePauseMatch[1])
    const action = schedulePauseMatch[2]
    const schedule = schedulesByAgent.get(agent.id)?.get(scheduleId)
    if (!schedule) return notFound(res)

    if (req.method === 'POST' && action === 'pause') {
      schedule.paused = true
      return noContent(res)
    }

    if (req.method === 'POST' && action === 'unpause') {
      schedule.paused = false
      return noContent(res)
    }

    if (req.method === 'POST' && action === 'run_now') {
      const session = createSession(agent.id, userId, workingDirFor(agent.id, userId), 'scheduled', scheduleId)
      const assistantMessage: ChatMessage = {
        id: nextId('msg-assistant'),
        role: 'assistant',
        created: nowEpoch(),
        content: [{ type: 'text', text: `Scheduled action ${scheduleId} executed by the mock gateway.` }],
        metadata: { userVisible: true, agentVisible: true },
      }
      appendConversation(session, assistantMessage)
      schedule.last_run = nowIso()
      schedule.current_session_id = session.id
      schedule.runSessionIds.unshift(session.id)
      return json(res, 200, { session_id: session.id })
    }

    if (req.method === 'GET' && action === 'inspect') {
      return json(res, 200, {
        sessionId: schedule.current_session_id,
        processStartTime: schedule.process_start_time,
        runningDurationSeconds: schedule.currently_running ? 12 : null,
      })
    }

    if (req.method === 'GET' && action === 'sessions') {
      const limit = Number(url.searchParams.get('limit') || '20')
      const items = schedule.runSessionIds
        .slice(0, Number.isFinite(limit) ? limit : 20)
        .map(sessionId => findSession(agent.id, userId, sessionId))
        .filter((session): session is SessionRecord => session !== null)
        .map(session => ({
          id: session.id,
          name: session.name,
          createdAt: session.created_at,
          workingDir: session.working_dir,
          scheduleId: session.schedule_id,
          messageCount: session.message_count,
          totalTokens: session.total_tokens,
          inputTokens: session.input_tokens,
          outputTokens: session.output_tokens,
          accumulatedTotalTokens: session.total_tokens,
          accumulatedInputTokens: session.input_tokens,
          accumulatedOutputTokens: session.output_tokens,
        }))
      return json(res, 200, items)
    }

    if (req.method === 'POST' && action === 'kill') {
      schedule.currently_running = false
      schedule.current_session_id = null
      return json(res, 200, { message: 'killed' })
    }
  }

  const scheduleUpdateMatch = tail.match(/^schedule\/([^/]+)$/)
  if (req.method === 'PUT' && scheduleUpdateMatch) {
    const scheduleId = decodeURIComponent(scheduleUpdateMatch[1])
    const schedule = schedulesByAgent.get(agent.id)?.get(scheduleId)
    if (!schedule) return notFound(res)
    const body = parseJson<{ cron?: string }>(await parseBody(req)) || {}
    schedule.cron = body.cron || schedule.cron
    return json(res, 200, clone(schedule))
  }

  return notFound(res)
})

server.listen(PORT, HOST, () => {
  console.log(`mock gateway listening on http://${HOST}:${PORT}`)
})

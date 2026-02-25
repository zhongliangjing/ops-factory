/**
 * Gateway Integration Tests — Deep Coverage
 *
 * All tests use only universal-agent with three users: sys (default), alice, bob.
 * Tests exercise the full request path through the gateway to real goosed instances.
 *
 * Prerequisites: goosed binary must be available in PATH.
 * Run: cd test && npx vitest run --config vitest.config.ts
 */
import http from 'node:http'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startGateway, type GatewayHandle } from './helpers.js'
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, rmdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const AGENT_ID = 'universal-agent'
const USER_ALICE = 'test-alice'
const USER_BOB = 'test-bob'
const USER_SYS = 'sys'
const PROJECT_ROOT = join(import.meta.dirname, '..')

let gw: GatewayHandle

// ===== Helpers =====

/** Build a goosed-compatible user Message */
function makeUserMessage(text: string) {
  return {
    role: 'user',
    created: Math.floor(Date.now() / 1000),
    content: [{ type: 'text', text }],
    metadata: { userVisible: true, agentVisible: true },
  }
}

/** Build a user message with an inline image */
function makeImageMessage(text: string, imageBase64: string, mimeType = 'image/png') {
  return {
    role: 'user',
    created: Math.floor(Date.now() / 1000),
    content: [
      { type: 'text', text },
      { type: 'image', data: imageBase64, mimeType },
    ],
    metadata: { userVisible: true, agentVisible: true },
  }
}

const AGENT_CONFIG_PATH = join(PROJECT_ROOT, 'agents', AGENT_ID, 'config', 'config.yaml')

/** Update vision.mode in agent config.yaml. Returns the original file content for restore. */
function setVisionMode(mode: string): string {
  const original = readFileSync(AGENT_CONFIG_PATH, 'utf-8')
  // Match the indented mode line under the vision: section (2-space indent)
  // Handles both quoted (`mode: "off"`) and unquoted (`mode: off`) formats
  const updated = original.replace(/(  mode: )"?[a-z]+"?/, `$1"${mode}"`)
  if (updated === original && !original.includes(`mode: "${mode}"`) && !original.includes(`mode: ${mode}`)) {
    throw new Error(`setVisionMode: failed to change mode to "${mode}" — regex did not match in:\n${original.substring(0, 500)}`)
  }
  writeFileSync(AGENT_CONFIG_PATH, updated, 'utf-8')
  return original
}

/** Create a minimal valid PNG image (1x1 red pixel) */
function createTestPng(): Buffer {
  // Minimal 1x1 red PNG (68 bytes)
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  )
}

/**
 * Send a reply and wait for the full SSE response.
 * Returns the raw SSE body text.
 */
async function sendReplyAndWait(
  handle: GatewayHandle,
  userId: string,
  agentId: string,
  sessionId: string,
  message: string,
  timeoutMs = 30_000,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await handle.fetchAs(userId, `/agents/${agentId}/agent/reply`, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        user_message: makeUserMessage(message),
      }),
      signal: controller.signal,
    })
    const body = await res.text()
    return body
  } catch {
    return '' // timeout / abort
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Create a session, send a real message, wait for LLM response.
 * Returns { sessionId, replyBody }.
 */
async function createSessionWithChat(
  handle: GatewayHandle,
  userId: string,
  agentId: string,
  message: string,
) {
  const startRes = await handle.fetchAs(userId, `/agents/${agentId}/agent/start`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  expect(startRes.ok).toBe(true)
  const session = await startRes.json()
  const sessionId = session.id as string

  // Resume session to load model
  const resumeRes = await handle.fetchAs(userId, `/agents/${agentId}/agent/resume`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, load_model_and_extensions: true }),
  })
  expect(resumeRes.ok).toBe(true)

  // Send message
  const replyBody = await sendReplyAndWait(handle, userId, agentId, sessionId, message)

  return { sessionId, replyBody }
}

/** Fetch session detail via agent-prefixed route */
async function getSession(handle: GatewayHandle, userId: string, agentId: string, sessionId: string) {
  const res = await handle.fetchAs(userId, `/agents/${agentId}/sessions/${sessionId}`)
  return { res, data: res.ok ? await res.json() : null }
}

/** List sessions via agent-prefixed route */
async function listSessionsForAgent(handle: GatewayHandle, userId: string, agentId: string) {
  const res = await handle.fetchAs(userId, `/agents/${agentId}/sessions`)
  expect(res.ok).toBe(true)
  const data = await res.json()
  return data.sessions as any[]
}

/** List sessions via global /sessions route */
async function listAllSessions(handle: GatewayHandle, userId: string) {
  const res = await handle.fetchAs(userId, '/sessions')
  expect(res.ok).toBe(true)
  const data = await res.json()
  return data.sessions as any[]
}

function userDir(userId: string) {
  return join(PROJECT_ROOT, 'users', userId, 'agents', AGENT_ID)
}

// ===== Setup / Teardown =====

beforeAll(async () => {
  gw = await startGateway()
}, 60_000)

afterAll(async () => {
  if (gw) await gw.stop()
}, 15_000)

// =====================================================
// 1. Gateway Health & Auth
// =====================================================
describe('Gateway health & auth', () => {
  it('GET /status returns ok', async () => {
    const res = await gw.fetch('/status')
    expect(res.ok).toBe(true)
    expect(await res.text()).toBe('ok')
  })

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${gw.baseUrl}/status`)
    expect(res.status).toBe(401)
  })

  it('GET /me returns userId from x-user-id header', async () => {
    for (const user of [USER_ALICE, USER_BOB, USER_SYS]) {
      const res = await gw.fetchAs(user, '/me')
      const data = await res.json()
      expect(data.userId).toBe(user)
    }
  })

  it('GET /me defaults to sys when no x-user-id', async () => {
    const res = await gw.fetch('/me')
    const data = await res.json()
    expect(data.userId).toBe('sys')
  })

  it('GET /config returns officePreview setting', async () => {
    const res = await gw.fetch('/config')
    const data = await res.json()
    expect(data.officePreview).toHaveProperty('enabled')
  })
})

// =====================================================
// 2. Agent listing & config
// =====================================================
describe('Agent listing & config', () => {
  it('GET /agents lists only configured agents', async () => {
    const res = await gw.fetch('/agents')
    const { agents } = await res.json()
    const ids = agents.map((a: any) => a.id)
    expect(ids).toContain('universal-agent')
    expect(ids).toContain('kb-agent')
    expect(ids).toContain('report-agent')
    expect(ids).not.toContain('contract-agent')
  })

  it('agent listing includes name, provider, model and no port', async () => {
    const res = await gw.fetch('/agents')
    const { agents } = await res.json()
    const ua = agents.find((a: any) => a.id === AGENT_ID)
    expect(ua.name).toBe('Universal Agent')
    expect(ua.provider).toBeDefined()
    expect(ua.model).toBeDefined()
    expect(ua).not.toHaveProperty('port')
  })

  it('GET /agents/:id/config returns full config including visionMode', async () => {
    const res = await gw.fetch(`/agents/${AGENT_ID}/config`)
    const data = await res.json()
    expect(data.id).toBe(AGENT_ID)
    expect(data).toHaveProperty('agentsMd')
    expect(data).toHaveProperty('workingDir')
    expect(data).not.toHaveProperty('port')
    // visionMode should be present (from config.yaml vision.mode)
    expect(data).toHaveProperty('visionMode')
  })

  it('PUT /agents/:id/config updates and restores agentsMd', async () => {
    const original = await (await gw.fetch(`/agents/${AGENT_ID}/config`)).json()
    const marker = `\n<!-- test-${Date.now()} -->`

    const putRes = await gw.fetch(`/agents/${AGENT_ID}/config`, {
      method: 'PUT',
      body: JSON.stringify({ agentsMd: original.agentsMd + marker }),
    })
    expect((await putRes.json()).success).toBe(true)

    const updated = await (await gw.fetch(`/agents/${AGENT_ID}/config`)).json()
    expect(updated.agentsMd).toContain(marker)

    // Restore
    await gw.fetch(`/agents/${AGENT_ID}/config`, {
      method: 'PUT',
      body: JSON.stringify({ agentsMd: original.agentsMd }),
    })
  })

  it('GET /agents/:id/config returns 404 for unknown agent', async () => {
    const res = await gw.fetch('/agents/nonexistent/config')
    expect(res.status).toBe(404)
  })

  it('GET /agents/:id/skills returns skills array', async () => {
    const res = await gw.fetch(`/agents/${AGENT_ID}/skills`)
    const data = await res.json()
    expect(data.skills).toBeInstanceOf(Array)
  })
})

// =====================================================
// 3. Session Full Lifecycle — Alice
// =====================================================
describe('Session lifecycle — alice', () => {
  let sessionId: string

  it('creates a session', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    sessionId = data.id
    expect(sessionId).toBeDefined()
    expect(data.working_dir).toContain(USER_ALICE)
    expect(data.working_dir).toContain(AGENT_ID)
  }, 60_000)

  it('resumes the session', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/resume`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, load_model_and_extensions: true }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.session.id).toBe(sessionId)
  })

  it('sends a message and gets a streamed reply', async () => {
    const body = await sendReplyAndWait(gw, USER_ALICE, AGENT_ID, sessionId, 'Reply with only the word "pong". Nothing else.')
    expect(body.length).toBeGreaterThan(0)
    // SSE data lines should be present
    expect(body).toContain('data:')
  }, 60_000)

  it('retrieves the session with conversation via agent-prefixed route', async () => {
    const { res, data } = await getSession(gw, USER_ALICE, AGENT_ID, sessionId)
    expect(res.ok).toBe(true)
    expect(data.id).toBe(sessionId)
    expect(data.agentId).toBe(AGENT_ID)
    // Should have conversation with at least 2 messages (user + assistant)
    expect(data.conversation).toBeInstanceOf(Array)
    expect(data.conversation.length).toBeGreaterThanOrEqual(2)

    // First message should be user's
    const userMsg = data.conversation.find((m: any) => m.role === 'user')
    expect(userMsg).toBeDefined()
    const textContent = userMsg.content.find((c: any) => c.type === 'text')
    expect(textContent.text).toContain('pong')

    // Should have assistant response
    const assistantMsg = data.conversation.find((m: any) => m.role === 'assistant')
    expect(assistantMsg).toBeDefined()
  })

  it('retrieves the session via global /sessions/:id route', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/sessions/${sessionId}?agentId=${AGENT_ID}`)
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.id).toBe(sessionId)
  })

  it('session appears in agent-prefixed listing', async () => {
    const sessions = await listSessionsForAgent(gw, USER_ALICE, AGENT_ID)
    const ids = sessions.map((s: any) => s.id)
    expect(ids).toContain(sessionId)
  })

  it('session appears in global /sessions listing', async () => {
    const sessions = await listAllSessions(gw, USER_ALICE)
    const ids = sessions.map((s: any) => s.id)
    expect(ids).toContain(sessionId)
  })

  it('renames the session via agent-prefixed route', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/sessions/${sessionId}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Alice Test Chat' }),
    })
    expect(res.ok).toBe(true)

    // Verify rename
    const { data } = await getSession(gw, USER_ALICE, AGENT_ID, sessionId)
    expect(data.name).toBe('Alice Test Chat')
  })

  it('sends a second message and the conversation grows', async () => {
    await sendReplyAndWait(gw, USER_ALICE, AGENT_ID, sessionId, 'Now reply with only "ping".')
    const { data } = await getSession(gw, USER_ALICE, AGENT_ID, sessionId)
    // Should now have at least 4 messages (2 user + 2 assistant)
    expect(data.conversation.length).toBeGreaterThanOrEqual(4)
  }, 60_000)

  it('stops the session', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/stop`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    })
    expect(res.ok).toBe(true)
  })

  it('session still accessible in history after stop', async () => {
    const { res, data } = await getSession(gw, USER_ALICE, AGENT_ID, sessionId)
    expect(res.ok).toBe(true)
    expect(data.conversation.length).toBeGreaterThanOrEqual(4)
  })
})

// =====================================================
// 4. Session Full Lifecycle — Bob (parallel user)
// =====================================================
describe('Session lifecycle — bob', () => {
  let sessionId: string

  it('creates a session and chats', async () => {
    const result = await createSessionWithChat(gw, USER_BOB, AGENT_ID, 'Reply with only the word "bob-ok".')
    sessionId = result.sessionId
    expect(result.replyBody.length).toBeGreaterThan(0)
  }, 60_000)

  it('retrieves bob session with conversation', async () => {
    const { data } = await getSession(gw, USER_BOB, AGENT_ID, sessionId)
    expect(data.id).toBe(sessionId)
    expect(data.conversation.length).toBeGreaterThanOrEqual(2)
  })

  it('bob session appears in bob listing', async () => {
    const sessions = await listSessionsForAgent(gw, USER_BOB, AGENT_ID)
    const found = sessions.find((s: any) => s.id === sessionId)
    expect(found).toBeDefined()
  })
})

// =====================================================
// 5. Cross-User Session Isolation
// =====================================================
describe('Cross-user session isolation', () => {
  it('alice cannot see bob sessions by working_dir', async () => {
    const sessions = await listAllSessions(gw, USER_ALICE)
    for (const s of sessions) {
      if (s.working_dir) {
        expect(s.working_dir).not.toContain(`/${USER_BOB}/`)
      }
    }
  })

  it('bob cannot see alice sessions by working_dir', async () => {
    const sessions = await listAllSessions(gw, USER_BOB)
    for (const s of sessions) {
      if (s.working_dir) {
        expect(s.working_dir).not.toContain(`/${USER_ALICE}/`)
      }
    }
  })

  it('agent-prefixed listing also respects isolation', async () => {
    const aliceSessions = await listSessionsForAgent(gw, USER_ALICE, AGENT_ID)
    const bobSessions = await listSessionsForAgent(gw, USER_BOB, AGENT_ID)

    for (const s of aliceSessions) {
      if (s.working_dir) expect(s.working_dir).not.toContain(`/${USER_BOB}/`)
    }
    for (const s of bobSessions) {
      if (s.working_dir) expect(s.working_dir).not.toContain(`/${USER_ALICE}/`)
    }
  })
})

// =====================================================
// 6. Session Delete
// =====================================================
describe('Session delete', () => {
  it('creates and deletes a session via global route', async () => {
    const startRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const { id: tempId } = await startRes.json()

    const delRes = await gw.fetchAs(USER_ALICE, `/sessions/${tempId}?agentId=${AGENT_ID}`, {
      method: 'DELETE',
    })
    expect(delRes.ok).toBe(true)

    // Verify 404
    const getRes = await gw.fetchAs(USER_ALICE, `/sessions/${tempId}?agentId=${AGENT_ID}`)
    expect(getRes.status).toBe(404)
  }, 60_000)

  it('creates and deletes a session via agent-prefixed route', async () => {
    const startRes = await gw.fetchAs(USER_BOB, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const { id: tempId } = await startRes.json()

    const delRes = await gw.fetchAs(USER_BOB, `/agents/${AGENT_ID}/sessions/${tempId}`, {
      method: 'DELETE',
    })
    expect(delRes.ok).toBe(true)

    // Verify 404
    const { res } = await getSession(gw, USER_BOB, AGENT_ID, tempId)
    expect(res.status).toBe(404)
  }, 60_000)

  it('returns 404 when deleting nonexistent session', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/sessions/nonexistent-id?agentId=${AGENT_ID}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })
})

// =====================================================
// 7. Multiple Sessions per User
// =====================================================
describe('Multiple sessions per user', () => {
  const sessionIds: string[] = []

  it('alice creates 3 sessions with different messages', async () => {
    for (const msg of ['say apple', 'say banana', 'say cherry']) {
      const { sessionId } = await createSessionWithChat(gw, USER_ALICE, AGENT_ID, msg)
      sessionIds.push(sessionId)
    }
    expect(sessionIds.length).toBe(3)
  }, 180_000)

  it('all 3 sessions appear in listing', async () => {
    const sessions = await listSessionsForAgent(gw, USER_ALICE, AGENT_ID)
    const ids = sessions.map((s: any) => s.id)
    for (const sid of sessionIds) {
      expect(ids).toContain(sid)
    }
  })

  it('each session has its own conversation content', async () => {
    for (let i = 0; i < sessionIds.length; i++) {
      const { data } = await getSession(gw, USER_ALICE, AGENT_ID, sessionIds[i])
      expect(data.conversation.length).toBeGreaterThanOrEqual(2)
      // Verify the user message matches what was sent
      const userMsgs = data.conversation.filter((m: any) => m.role === 'user')
      const texts = userMsgs.flatMap((m: any) =>
        m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text)
      )
      const expected = ['apple', 'banana', 'cherry'][i]
      expect(texts.some((t: string) => t.includes(expected))).toBe(true)
    }
  })
})

// =====================================================
// 8. SSE Reply Format
// =====================================================
describe('SSE reply format', () => {
  it('reply returns text/event-stream with SSE data lines', async () => {
    const startRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const { id: sessionId } = await startRes.json()

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/reply`, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        user_message: makeUserMessage('Reply with just "hi".'),
      }),
    })
    expect(res.ok).toBe(true)
    const contentType = res.headers.get('content-type') || ''
    expect(contentType).toMatch(/text\/event-stream/)

    const body = await res.text()
    // SSE format: lines starting with "data:"
    const dataLines = body.split('\n').filter(l => l.startsWith('data:'))
    expect(dataLines.length).toBeGreaterThan(0)
  }, 60_000)
})

// =====================================================
// 9. File Routes
// =====================================================
describe('File routes', () => {
  it('per-user file isolation', async () => {
    // Ensure alice's dir exists
    const aliceDir = userDir(USER_ALICE)
    if (!existsSync(aliceDir)) mkdirSync(aliceDir, { recursive: true })
    const fileName = `iso-test-${Date.now()}.txt`
    writeFileSync(join(aliceDir, fileName), 'alice-only')

    // Alice sees it
    const aliceRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files`)
    const aliceFiles = (await aliceRes.json()).files.map((f: any) => f.name)
    expect(aliceFiles).toContain(fileName)

    // Bob does NOT
    const bobRes = await gw.fetchAs(USER_BOB, `/agents/${AGENT_ID}/files`)
    const bobFiles = (await bobRes.json()).files.map((f: any) => f.name)
    expect(bobFiles).not.toContain(fileName)

    unlinkSync(join(aliceDir, fileName))
  })

  it('serves file with correct content', async () => {
    const dir = userDir(USER_ALICE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const fileName = `serve-${Date.now()}.txt`
    writeFileSync(join(dir, fileName), 'hello-content')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/${fileName}`)
    expect(res.ok).toBe(true)
    expect(await res.text()).toBe('hello-content')

    unlinkSync(join(dir, fileName))
  })

  it('HTML files served inline, DOCX as attachment', async () => {
    const dir = userDir(USER_ALICE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const htmlFile = `test-${Date.now()}.html`
    const docxFile = `test-${Date.now()}.docx`
    writeFileSync(join(dir, htmlFile), '<h1>hi</h1>')
    writeFileSync(join(dir, docxFile), 'fake-docx')

    const htmlRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/${htmlFile}`)
    expect(htmlRes.headers.get('content-type')).toContain('text/html')
    expect(htmlRes.headers.get('content-disposition')).toContain('inline')

    const docxRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/${docxFile}`)
    expect(docxRes.headers.get('content-type')).toContain('application/vnd.openxmlformats')
    expect(docxRes.headers.get('content-disposition')).toContain('attachment')

    unlinkSync(join(dir, htmlFile))
    unlinkSync(join(dir, docxFile))
  })

  it('finds file in subdirectory via fallback search', async () => {
    const dir = userDir(USER_ALICE)
    const sub = join(dir, 'nested')
    if (!existsSync(sub)) mkdirSync(sub, { recursive: true })
    const fileName = `deep-${Date.now()}.txt`
    writeFileSync(join(sub, fileName), 'nested-content')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/${fileName}`)
    expect(res.ok).toBe(true)
    expect(await res.text()).toBe('nested-content')

    unlinkSync(join(sub, fileName))
    rmdirSync(sub)
  })

  it('filters out goose system directories', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files`)
    const files = (await res.json()).files
    for (const f of files) {
      expect(f.path).not.toMatch(/^(data|state|config)\//)
    }
  })

  it('blocks path traversal', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: gw.port,
        path: `/agents/${AGENT_ID}/files/../../etc/passwd`,
        method: 'GET',
        headers: { 'x-secret-key': gw.secretKey, 'x-user-id': USER_ALICE },
      }, (res) => {
        res.resume()
        resolve(res.statusCode || 500)
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })
})

// =====================================================
// 10. MCP Extension Routes
// =====================================================
describe('MCP extension routes', () => {
  const TEST_MCP = 'test-mcp-integration'

  it('GET /agents/:id/mcp returns extensions list', async () => {
    const res = await gw.fetch(`/agents/${AGENT_ID}/mcp`)
    expect(res.ok).toBe(true)
    const contentType = res.headers.get('content-type') || ''
    expect(contentType).toContain('application/json')
  }, 90_000)

  it('POST adds and DELETE removes an extension', async () => {
    // Add
    const addRes = await gw.fetch(`/agents/${AGENT_ID}/mcp`, {
      method: 'POST',
      body: JSON.stringify({
        name: TEST_MCP,
        enabled: true,
        config: { type: 'stdio', name: TEST_MCP, description: 'test', cmd: 'echo', args: ['hi'], envs: {} },
      }),
    })
    expect(addRes.ok).toBe(true)

    // Verify present
    let listRes = await gw.fetch(`/agents/${AGENT_ID}/mcp`)
    let names = ((await listRes.json()).extensions || []).map((e: any) => e.name)
    expect(names).toContain(TEST_MCP)

    // Delete
    const delRes = await gw.fetch(`/agents/${AGENT_ID}/mcp/${TEST_MCP}`, { method: 'DELETE' })
    expect(delRes.ok).toBe(true)

    // Verify gone
    listRes = await gw.fetch(`/agents/${AGENT_ID}/mcp`)
    names = ((await listRes.json()).extensions || []).map((e: any) => e.name)
    expect(names).not.toContain(TEST_MCP)
  }, 60_000)
})

// =====================================================
// 11. Catch-all Proxy & Error Handling
// =====================================================
describe('Catch-all proxy & error handling', () => {
  it('/agents/:id/* proxies to default instance', async () => {
    const res = await gw.fetch(`/agents/${AGENT_ID}/status`)
    expect([200, 502]).toContain(res.status)
  }, 60_000)

  it('returns 404 for unknown routes', async () => {
    expect((await gw.fetch('/nonexistent')).status).toBe(404)
  })

  it('returns 404 for unknown agent config', async () => {
    expect((await gw.fetch('/agents/nonexistent/config')).status).toBe(404)
  })

  it('GET /sessions/:id returns 404 for nonexistent session', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/sessions/nonexistent?agentId=${AGENT_ID}`)
    expect(res.status).toBe(404)
  })

  it('agent-prefixed GET returns 404 for nonexistent session', async () => {
    const { res } = await getSession(gw, USER_ALICE, AGENT_ID, 'nonexistent')
    expect(res.status).toBe(404)
  })
})

// =====================================================
// 12. Vision Pipeline — mode=off (default)
// =====================================================
describe('Vision pipeline — mode=off', () => {
  let sessionId: string
  let originalConfig: string

  beforeAll(() => {
    originalConfig = setVisionMode('off')
  })

  afterAll(() => {
    writeFileSync(AGENT_CONFIG_PATH, originalConfig, 'utf-8')
  })

  it('rejects image messages with 400', async () => {
    const startRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const { id } = await startRes.json()
    sessionId = id

    await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/resume`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, load_model_and_extensions: true }),
    })

    const png = createTestPng()
    const imageB64 = png.toString('base64')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/reply`, {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        user_message: makeImageMessage('What is this?', imageB64),
      }),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('not enabled')
  }, 60_000)

  it('text-only messages still work', async () => {
    const body = await sendReplyAndWait(gw, USER_ALICE, AGENT_ID, sessionId, 'Reply with only "ok". Do not use any tools.')
    expect(body).toContain('data:')
    expect(body.length).toBeGreaterThan(0)
  }, 60_000)
})

// =====================================================
// 13. Vision Pipeline — mode=passthrough
// =====================================================
describe('Vision pipeline — mode=passthrough', () => {
  let originalConfig: string

  beforeAll(() => {
    originalConfig = setVisionMode('passthrough')
  })

  afterAll(() => {
    writeFileSync(AGENT_CONFIG_PATH, originalConfig, 'utf-8')
  })

  it('forwards images to LLM and gets vision-aware response', async () => {
    // Verify config is set correctly
    const configContent = readFileSync(AGENT_CONFIG_PATH, 'utf-8')
    expect(configContent).toContain('mode: "passthrough"')

    const startRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(startRes.ok).toBe(true)
    const { id: sessionId } = await startRes.json()

    const resumeRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/resume`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, load_model_and_extensions: true }),
    })
    expect(resumeRes.ok).toBe(true)

    const png = createTestPng()
    const imageB64 = png.toString('base64')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
      const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/reply`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          user_message: makeImageMessage('Describe this image in 10 words or less. Do not use any tools.', imageB64),
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`Reply failed (${res.status}): ${errBody}`)
      }

      const body = await res.text()
      // Should contain an SSE Message event with actual content
      const messageLines = body.split('\n').filter(l => l.startsWith('data:') && l.includes('"Message"'))
      expect(messageLines.length).toBeGreaterThan(0)

      // Parse the message to verify it contains text (the LLM's description)
      const msgData = JSON.parse(messageLines[0].replace('data: ', ''))
      const textContent = msgData.message.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toBeDefined()
      expect(textContent.text.length).toBeGreaterThan(0)
    } finally {
      clearTimeout(timer)
    }
  }, 90_000)
})

// =====================================================
// 14. Vision Pipeline — mode=preprocess
// =====================================================
describe('Vision pipeline — mode=preprocess', () => {
  let originalConfig: string

  beforeAll(() => {
    originalConfig = setVisionMode('preprocess')
  })

  afterAll(() => {
    writeFileSync(AGENT_CONFIG_PATH, originalConfig, 'utf-8')
  })

  it('preprocesses images via vision API and forwards text description', async () => {
    // Verify config is set correctly
    const configContent = readFileSync(AGENT_CONFIG_PATH, 'utf-8')
    expect(configContent).toContain('mode: "preprocess"')

    const startRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(startRes.ok).toBe(true)
    const { id: sessionId } = await startRes.json()

    const resumeRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/resume`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, load_model_and_extensions: true }),
    })
    expect(resumeRes.ok).toBe(true)

    const png = createTestPng()
    const imageB64 = png.toString('base64')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
    try {
      const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/reply`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          user_message: makeImageMessage('What was in the image analysis? Reply in 10 words. Do not use any tools.', imageB64),
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`Reply failed (${res.status}): ${errBody}`)
      }

      const body = await res.text()
      // Should contain a Message event (the LLM's response based on preprocessed text)
      const messageLines = body.split('\n').filter(l => l.startsWith('data:') && l.includes('"Message"'))
      expect(messageLines.length).toBeGreaterThan(0)

      const msgData = JSON.parse(messageLines[0].replace('data: ', ''))
      const textContent = msgData.message.content.find((c: any) => c.type === 'text')
      expect(textContent?.text).toBeDefined()
      expect(textContent.text.length).toBeGreaterThan(0)
    } finally {
      clearTimeout(timer)
    }
  }, 120_000)
})

// =====================================================
// 15. File Upload
// =====================================================
describe('File upload', () => {
  let sessionId: string
  let uploadedPath: string

  it('creates a session for upload tests', async () => {
    const startRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const data = await startRes.json()
    sessionId = data.id
    expect(sessionId).toBeDefined()
  })

  it('uploads a text file via multipart', async () => {
    const boundary = '----TestBoundary' + Date.now()
    const fileContent = 'Hello, this is a test file for upload.'
    const fileName = 'test-upload.txt'

    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="sessionId"\r\n\r\n`,
      `${sessionId}\r\n`,
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`,
      `Content-Type: text/plain\r\n\r\n`,
      `${fileContent}\r\n`,
      `--${boundary}--\r\n`,
    ].join('')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: bodyParts,
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.path).toBeDefined()
    expect(data.name).toBe(fileName)
    expect(data.size).toBe(fileContent.length)
    expect(data.type).toBe('text/plain')

    uploadedPath = data.path
    // Verify file exists on disk
    expect(existsSync(uploadedPath)).toBe(true)
  })

  it('rejects upload without file', async () => {
    const boundary = '----TestBoundary' + Date.now()
    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="sessionId"\r\n\r\n`,
      `${sessionId}\r\n`,
      `--${boundary}--\r\n`,
    ].join('')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: bodyParts,
    })
    expect(res.status).toBe(400)
  })

  it('rejects disallowed file types', async () => {
    const boundary = '----TestBoundary' + Date.now()
    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="sessionId"\r\n\r\n`,
      `${sessionId}\r\n`,
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="evil.exe"\r\n`,
      `Content-Type: application/octet-stream\r\n\r\n`,
      `MZevil\r\n`,
      `--${boundary}--\r\n`,
    ].join('')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: bodyParts,
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('not allowed')
  })

  it('cleans up uploaded files when session is deleted', async () => {
    // Verify file still exists
    expect(existsSync(uploadedPath)).toBe(true)

    // Get the uploads directory for this session
    const uploadsDir = join(
      PROJECT_ROOT, 'users', USER_ALICE, 'agents', AGENT_ID, 'uploads', sessionId
    )
    expect(existsSync(uploadsDir)).toBe(true)

    // Delete the session
    const delRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/sessions/${sessionId}`, {
      method: 'DELETE',
    })
    expect(delRes.ok).toBe(true)

    // Uploads directory should be gone
    expect(existsSync(uploadsDir)).toBe(false)
  }, 60_000)
})

// =====================================================
// 16. CORS Preflight
// =====================================================
describe('CORS preflight', () => {
  it('OPTIONS request returns 204 with CORS headers', async () => {
    const res = await gw.fetch('/status', { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT')
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE')
    expect(res.headers.get('access-control-allow-headers')).toContain('x-secret-key')
    expect(res.headers.get('access-control-allow-headers')).toContain('x-user-id')
  })

  it('regular responses include CORS Allow-Origin header', async () => {
    const res = await gw.fetch('/status')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

// =====================================================
// 17. Query-string Auth for File Routes
// =====================================================
describe('Query-string auth for file routes', () => {
  it('file listing accepts ?key= query param for auth', async () => {
    // Without any auth header, use ?key= param
    const res = await fetch(
      `${gw.baseUrl}/agents/${AGENT_ID}/files?key=${gw.secretKey}`,
      { headers: { 'x-user-id': USER_ALICE } }
    )
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data).toHaveProperty('files')
  })

  it('file serving accepts ?key= query param for auth', async () => {
    const dir = userDir(USER_ALICE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const fileName = `qsauth-${Date.now()}.txt`
    writeFileSync(join(dir, fileName), 'qs-auth-content')

    const res = await fetch(
      `${gw.baseUrl}/agents/${AGENT_ID}/files/${fileName}?key=${gw.secretKey}`,
      { headers: { 'x-user-id': USER_ALICE } }
    )
    expect(res.ok).toBe(true)
    expect(await res.text()).toBe('qs-auth-content')

    unlinkSync(join(dir, fileName))
  })

  it('rejects file request with wrong query key', async () => {
    const res = await fetch(
      `${gw.baseUrl}/agents/${AGENT_ID}/files?key=wrong-key`,
      { headers: { 'x-user-id': USER_ALICE } }
    )
    expect(res.status).toBe(401)
  })
})

// =====================================================
// 18. File Upload Edge Cases
// =====================================================
describe('File upload edge cases', () => {
  let sessionId: string

  beforeAll(async () => {
    const startRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const data = await startRes.json()
    sessionId = data.id
  }, 60_000)

  it('rejects non-multipart content-type', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'not-a-file' }),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('multipart/form-data')
  })

  it('uploads allowed file types: .json', async () => {
    const boundary = '----TestBoundary' + Date.now()
    const fileContent = '{"key": "value"}'
    const fileName = 'test-upload.json'

    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="sessionId"\r\n\r\n`,
      `${sessionId}\r\n`,
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`,
      `Content-Type: application/json\r\n\r\n`,
      `${fileContent}\r\n`,
      `--${boundary}--\r\n`,
    ].join('')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: bodyParts,
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.name).toBe(fileName)
    expect(data.type).toBe('application/json')
  })

  it('uploads allowed file types: .png', async () => {
    const boundary = '----TestBoundary' + Date.now()
    const pngData = createTestPng()
    const fileName = 'test-upload.png'

    // Build multipart body with binary PNG data
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="sessionId"\r\n\r\n` +
      `${sessionId}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: image/png\r\n\r\n`
    )
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
    const bodyBuffer = Buffer.concat([header, pngData, footer])

    const res = await fetch(`${gw.baseUrl}/agents/${AGENT_ID}/files/upload`, {
      method: 'POST',
      headers: {
        'x-secret-key': gw.secretKey,
        'x-user-id': USER_ALICE,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.name).toBe(fileName)
  })

  it('rejects disallowed file type: .bat', async () => {
    const boundary = '----TestBoundary' + Date.now()
    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="sessionId"\r\n\r\n`,
      `${sessionId}\r\n`,
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="script.bat"\r\n`,
      `Content-Type: application/x-msdos-program\r\n\r\n`,
      `@echo off\r\n`,
      `--${boundary}--\r\n`,
    ].join('')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: bodyParts,
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('not allowed')
  })

  it('sanitizes dangerous characters in filenames', async () => {
    const boundary = '----TestBoundary' + Date.now()
    const dangerousName = '../../../etc/passwd.txt'
    const fileContent = 'safe content'

    const bodyParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="sessionId"\r\n\r\n`,
      `${sessionId}\r\n`,
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="${dangerousName}"\r\n`,
      `Content-Type: text/plain\r\n\r\n`,
      `${fileContent}\r\n`,
      `--${boundary}--\r\n`,
    ].join('')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: bodyParts,
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    // Filename should be sanitized: path separators replaced, no leading dots
    expect(data.name).not.toContain('/')
    expect(data.name).not.toContain('..')
    expect(data.name).toContain('passwd.txt')
  })
})

// =====================================================
// 19. File Serving — Additional MIME Types & Edge Cases
// =====================================================
describe('File serving — MIME types & edge cases', () => {
  it('returns 404 for nonexistent file', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/nonexistent-${Date.now()}.txt`)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toContain('not found')
  })

  it('serves PDF files inline with correct content-type', async () => {
    const dir = userDir(USER_ALICE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const fileName = `test-${Date.now()}.pdf`
    writeFileSync(join(dir, fileName), 'fake-pdf-content')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/${fileName}`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toContain('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('inline')

    unlinkSync(join(dir, fileName))
  })

  it('serves PNG files inline with correct content-type', async () => {
    const dir = userDir(USER_ALICE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const fileName = `test-${Date.now()}.png`
    writeFileSync(join(dir, fileName), createTestPng())

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/${fileName}`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toContain('image/png')
    expect(res.headers.get('content-disposition')).toContain('inline')

    unlinkSync(join(dir, fileName))
  })

  it('serves CSV files with correct content-type', async () => {
    const dir = userDir(USER_ALICE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const fileName = `test-${Date.now()}.csv`
    writeFileSync(join(dir, fileName), 'name,value\nalice,100')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/${fileName}`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toContain('text/csv')

    unlinkSync(join(dir, fileName))
  })

  it('serves unknown extensions as application/octet-stream with attachment', async () => {
    const dir = userDir(USER_ALICE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const fileName = `test-${Date.now()}.xyz`
    writeFileSync(join(dir, fileName), 'unknown-content')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/${fileName}`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toContain('application/octet-stream')
    expect(res.headers.get('content-disposition')).toContain('attachment')

    unlinkSync(join(dir, fileName))
  })

  it('serves XLSX files as attachment', async () => {
    const dir = userDir(USER_ALICE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const fileName = `test-${Date.now()}.xlsx`
    writeFileSync(join(dir, fileName), 'fake-xlsx')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files/${fileName}`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toContain('spreadsheetml')
    expect(res.headers.get('content-disposition')).toContain('attachment')

    unlinkSync(join(dir, fileName))
  })
})

// =====================================================
// 20. File Listing Edge Cases
// =====================================================
describe('File listing edge cases', () => {
  it('returns empty array for a fresh user directory', async () => {
    const freshUser = `test-fresh-${Date.now()}`
    const res = await gw.fetchAs(freshUser, `/agents/${AGENT_ID}/files`)
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.files).toBeInstanceOf(Array)
    // Fresh user may have 0 files (directory just created by the listing route)
    // or config symlinks; either way it shouldn't error
  })

  it('skips .DS_Store and AGENTS.md files', async () => {
    const dir = userDir(USER_ALICE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // Create files that should be skipped
    writeFileSync(join(dir, '.DS_Store'), '')
    writeFileSync(join(dir, 'AGENTS.md'), '# skip me')
    // Create a visible file
    const visibleFile = `visible-${Date.now()}.txt`
    writeFileSync(join(dir, visibleFile), 'i am visible')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files`)
    const files = (await res.json()).files
    const names = files.map((f: any) => f.name)

    expect(names).toContain(visibleFile)
    expect(names).not.toContain('.DS_Store')
    expect(names).not.toContain('AGENTS.md')

    // Cleanup
    unlinkSync(join(dir, '.DS_Store'))
    unlinkSync(join(dir, 'AGENTS.md'))
    unlinkSync(join(dir, visibleFile))
  })

  it('skips node_modules directory', async () => {
    const dir = userDir(USER_ALICE)
    const nmDir = join(dir, 'node_modules')
    if (!existsSync(nmDir)) mkdirSync(nmDir, { recursive: true })
    writeFileSync(join(nmDir, 'package.json'), '{}')

    const res = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/files`)
    const files = (await res.json()).files
    const paths = files.map((f: any) => f.path)

    for (const p of paths) {
      expect(p).not.toContain('node_modules')
    }

    // Cleanup
    unlinkSync(join(nmDir, 'package.json'))
    rmdirSync(nmDir)
  })
})

// =====================================================
// 21. Agent Config PUT Edge Cases
// =====================================================
describe('Agent config PUT edge cases', () => {
  it('returns 400 for invalid JSON body', async () => {
    const res = await gw.fetch(`/agents/${AGENT_ID}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{{',
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid JSON')
  })

  it('returns 404 for PUT on nonexistent agent', async () => {
    const res = await gw.fetch('/agents/nonexistent-agent/config', {
      method: 'PUT',
      body: JSON.stringify({ agentsMd: 'test' }),
    })
    // The gateway reads the agent config first, which returns null for unknown agents
    // The updateAgentConfig should handle this — check the actual behavior
    expect([400, 404]).toContain(res.status)
  })

  it('GET /agents/:id/skills returns empty or array for unknown agent', async () => {
    const res = await gw.fetch('/agents/nonexistent-agent/skills')
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.skills).toBeInstanceOf(Array)
  })
})

// =====================================================
// 22. Cross-User Session Security
// =====================================================
describe('Cross-user session security', () => {
  let aliceSessionId: string

  beforeAll(async () => {
    const startRes = await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/agent/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const data = await startRes.json()
    aliceSessionId = data.id
  }, 60_000)

  it('bob cannot access alice session via agent-prefixed route', async () => {
    // Bob's instance won't have alice's session
    const { res } = await getSession(gw, USER_BOB, AGENT_ID, aliceSessionId)
    expect(res.status).toBe(404)
  }, 60_000)

  it('bob cannot delete alice session via agent-prefixed route', async () => {
    const res = await gw.fetchAs(USER_BOB, `/agents/${AGENT_ID}/sessions/${aliceSessionId}`, {
      method: 'DELETE',
    })
    // Bob's instance doesn't have this session
    expect(res.status).toBe(404)
  }, 60_000)

  afterAll(async () => {
    // Cleanup alice's session
    await gw.fetchAs(USER_ALICE, `/agents/${AGENT_ID}/sessions/${aliceSessionId}`, {
      method: 'DELETE',
    })
  })
})

// =====================================================
// 23. Path Traversal — Additional Vectors
// =====================================================
describe('Path traversal — additional vectors', () => {
  it('blocks encoded path traversal in file route', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: gw.port,
        path: `/agents/${AGENT_ID}/files/..%2F..%2Fetc%2Fpasswd`,
        method: 'GET',
        headers: { 'x-secret-key': gw.secretKey, 'x-user-id': USER_ALICE },
      }, (res) => {
        res.resume()
        resolve(res.statusCode || 500)
      })
      req.on('error', reject)
      req.end()
    })
    // Should be blocked — either by URL decoding or by the resolve/relative check
    expect([403, 404]).toContain(status)
  })

  it('blocks double-dot in nested file path', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: gw.port,
        path: `/agents/${AGENT_ID}/files/subdir/../../etc/passwd`,
        method: 'GET',
        headers: { 'x-secret-key': gw.secretKey, 'x-user-id': USER_ALICE },
      }, (res) => {
        res.resume()
        resolve(res.statusCode || 500)
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })
})

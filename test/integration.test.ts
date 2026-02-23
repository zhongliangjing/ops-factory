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
import { writeFileSync, existsSync, mkdirSync, unlinkSync, rmdirSync } from 'node:fs'
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
    expect(ids).not.toContain('report-agent')
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

  it('GET /agents/:id/config returns full config', async () => {
    const res = await gw.fetch(`/agents/${AGENT_ID}/config`)
    const data = await res.json()
    expect(data.id).toBe(AGENT_ID)
    expect(data).toHaveProperty('agentsMd')
    expect(data).toHaveProperty('workingDir')
    expect(data).not.toHaveProperty('port')
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

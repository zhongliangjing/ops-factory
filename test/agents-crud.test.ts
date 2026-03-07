/**
 * Agents CRUD integration tests — Create, Read, Update, Delete.
 *
 * Tests use a real gateway process. Each test that creates an agent
 * cleans up after itself to avoid polluting the shared agents.yaml.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startJavaGateway, type GatewayHandle } from './helpers.js'

const USER_SYS = 'sys'       // admin
const USER_ALICE = 'test-alice' // non-admin

let gw: GatewayHandle

beforeAll(async () => {
  gw = await startJavaGateway()
}, 60_000)

afterAll(async () => {
  if (gw) await gw.stop()
}, 15_000)

// ─── Helpers ──────────────────────────────────────────────

/** Create a test agent and return its id. Caller is responsible for cleanup. */
async function createAgent(id: string, name: string) {
  return gw.fetchAs(USER_SYS, '/agents', {
    method: 'POST',
    body: JSON.stringify({ id, name }),
  })
}

/** Delete a test agent (best-effort cleanup). */
async function deleteAgent(id: string) {
  return gw.fetchAs(USER_SYS, `/agents/${id}`, { method: 'DELETE' })
}

/** Generate a unique agent id for test isolation. */
function testAgentId(suffix: string) {
  return `test-${suffix}-${Date.now()}`
}

// ─── READ (listing) ──────────────────────────────────────

describe('Agent Read — listing and config', () => {
  it('GET /agents returns list of pre-configured agents', async () => {
    const res = await gw.fetchAs(USER_SYS, '/agents')
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(Array.isArray(data.agents)).toBe(true)
    expect(data.agents.length).toBeGreaterThanOrEqual(1)
    // Each agent has expected fields
    const agent = data.agents[0]
    expect(agent.id).toBeDefined()
    expect(agent.name).toBeDefined()
    expect(agent.status).toBeDefined()
  })

  it('non-admin user can also list agents', async () => {
    const res = await gw.fetchAs(USER_ALICE, '/agents')
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(Array.isArray(data.agents)).toBe(true)
  })

  it('GET /agents/:id/config returns config for existing agent (admin)', async () => {
    const agents = (await (await gw.fetchAs(USER_SYS, '/agents')).json()).agents
    const agentId = agents[0].id
    const res = await gw.fetchAs(USER_SYS, `/agents/${agentId}/config`)
    expect(res.ok).toBe(true)
    const config = await res.json()
    expect(config.id).toBe(agentId)
    expect(config.name).toBeDefined()
    expect(typeof config.agentsMd).toBe('string')
  })

  it('GET /agents/:id/config returns 404 for unknown agent', async () => {
    const res = await gw.fetchAs(USER_SYS, '/agents/nonexistent-agent-xyz/config')
    expect(res.status).toBe(404)
  })

  it('GET /agents/:id/config requires admin', async () => {
    const agents = (await (await gw.fetchAs(USER_SYS, '/agents')).json()).agents
    const agentId = agents[0].id
    const res = await gw.fetchAs(USER_ALICE, `/agents/${agentId}/config`)
    expect(res.status).toBe(403)
  })
})

// ─── CREATE ──────────────────────────────────────────────

describe('Agent Create — POST /agents', () => {
  const createdAgents: string[] = []

  afterAll(async () => {
    // Cleanup all agents created in this suite
    for (const id of createdAgents) {
      await deleteAgent(id)
    }
  })

  it('creates a new agent with valid id and name', async () => {
    const id = testAgentId('basic')
    const name = `Test Agent Basic ${Date.now()}`
    createdAgents.push(id)

    const res = await createAgent(id, name)
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.agent).toBeDefined()
    expect(data.agent.id).toBe(id)
    expect(data.agent.name).toBe(name)
    expect(data.agent.provider).toBe('openai')
    expect(data.agent.model).toBe('qwen/qwen3.5-35b-a3b')
  })

  it('new agent appears in listing', async () => {
    const id = testAgentId('listing')
    const name = `Test Agent Listing ${Date.now()}`
    createdAgents.push(id)

    await createAgent(id, name)

    const listRes = await gw.fetchAs(USER_SYS, '/agents')
    const agents = (await listRes.json()).agents
    const found = agents.find((a: { id: string }) => a.id === id)
    expect(found).toBeDefined()
    expect(found.name).toBe(name)
    expect(found.provider).toBe('openai')
    expect(found.model).toBe('qwen/qwen3.5-35b-a3b')
  })

  it('new agent config is readable', async () => {
    const id = testAgentId('config')
    const name = `Test Agent Config ${Date.now()}`
    createdAgents.push(id)

    await createAgent(id, name)

    const configRes = await gw.fetchAs(USER_SYS, `/agents/${id}/config`)
    expect(configRes.ok).toBe(true)
    const config = await configRes.json()
    expect(config.id).toBe(id)
    expect(config.name).toBe(name)
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('qwen/qwen3.5-35b-a3b')
    expect(config.agentsMd).toContain(name)
  })

  it('rejects duplicate agent ID', async () => {
    const id = testAgentId('dup-id')
    const name1 = `Test Agent DupID A ${Date.now()}`
    const name2 = `Test Agent DupID B ${Date.now()}`
    createdAgents.push(id)

    const res1 = await createAgent(id, name1)
    expect(res1.status).toBe(201)

    const res2 = await createAgent(id, name2)
    expect(res2.status).toBe(400)
    const data = await res2.json()
    expect(data.success).toBe(false)
    expect(data.error).toContain('already exists')
  })

  it('rejects duplicate agent name', async () => {
    const id1 = testAgentId('dup-name1')
    const id2 = testAgentId('dup-name2')
    const sharedName = `Duplicate Name Test ${Date.now()}`
    createdAgents.push(id1, id2)

    const res1 = await createAgent(id1, sharedName)
    expect(res1.status).toBe(201)

    const res2 = await createAgent(id2, sharedName)
    expect(res2.status).toBe(400)
    const data = await res2.json()
    expect(data.success).toBe(false)
    expect(data.error).toContain('already exists')
  })

  it('rejects invalid agent ID format', async () => {
    const cases = [
      { id: 'A', name: 'Too Short' },             // min 2 chars
      { id: 'UPPERCASE', name: 'Bad Case' },       // must be lowercase
      { id: '-leading', name: 'Leading Hyphen' },   // no leading hyphen
      { id: 'trailing-', name: 'Trailing Hyphen' }, // no trailing hyphen
      { id: 'has spaces', name: 'Spaces' },         // no spaces
      { id: 'special!char', name: 'Special' },      // no special chars
    ]

    for (const { id, name } of cases) {
      const res = await createAgent(id, name)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.success).toBe(false)
    }
  })

  it('rejects missing agent ID', async () => {
    const res = await gw.fetchAs(USER_SYS, '/agents', {
      method: 'POST',
      body: JSON.stringify({ name: 'No ID' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing agent name', async () => {
    const res = await gw.fetchAs(USER_SYS, '/agents', {
      method: 'POST',
      body: JSON.stringify({ id: 'no-name-agent' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid JSON body', async () => {
    const res = await gw.fetchAs(USER_SYS, '/agents', {
      method: 'POST',
      body: 'not json',
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid JSON')
  })

  it('requires admin role', async () => {
    const res = await gw.fetchAs(USER_ALICE, '/agents', {
      method: 'POST',
      body: JSON.stringify({ id: 'unauthorized-agent', name: 'Unauthorized' }),
    })
    expect(res.status).toBe(403)
  })
})

// ─── UPDATE ──────────────────────────────────────────────

describe('Agent Update — PUT /agents/:id/config', () => {
  let agentId: string
  const agentName = `Test Agent Update ${Date.now()}`

  beforeAll(async () => {
    agentId = testAgentId('update')
    await createAgent(agentId, agentName)
  })

  afterAll(async () => {
    await deleteAgent(agentId)
  })

  it('updates AGENTS.md via PUT /agents/:id/config', async () => {
    const newPrompt = '# Updated Prompt\n\nThis agent was updated by tests.'
    const res = await gw.fetchAs(USER_SYS, `/agents/${agentId}/config`, {
      method: 'PUT',
      body: JSON.stringify({ agentsMd: newPrompt }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('updated AGENTS.md is persisted', async () => {
    const newPrompt = '# Persisted Prompt\n\nCheck persistence.'
    await gw.fetchAs(USER_SYS, `/agents/${agentId}/config`, {
      method: 'PUT',
      body: JSON.stringify({ agentsMd: newPrompt }),
    })

    const configRes = await gw.fetchAs(USER_SYS, `/agents/${agentId}/config`)
    const config = await configRes.json()
    expect(config.agentsMd).toBe(newPrompt)
  })

  it('returns error for unknown agent', async () => {
    const res = await gw.fetchAs(USER_SYS, '/agents/nonexistent-xyz/config', {
      method: 'PUT',
      body: JSON.stringify({ agentsMd: 'test' }),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.success).toBe(false)
  })

  it('requires admin role', async () => {
    const res = await gw.fetchAs(USER_ALICE, `/agents/${agentId}/config`, {
      method: 'PUT',
      body: JSON.stringify({ agentsMd: 'hacked' }),
    })
    expect(res.status).toBe(403)
  })
})

// ─── DELETE ──────────────────────────────────────────────

describe('Agent Delete — DELETE /agents/:id', () => {
  it('deletes an existing agent', async () => {
    const id = testAgentId('delete')
    const name = `Test Agent Delete ${Date.now()}`
    await createAgent(id, name)

    // Verify it exists
    const listBefore = (await (await gw.fetchAs(USER_SYS, '/agents')).json()).agents
    expect(listBefore.some((a: { id: string }) => a.id === id)).toBe(true)

    // Delete
    const res = await deleteAgent(id)
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.success).toBe(true)

    // Verify it's gone from listing
    const listAfter = (await (await gw.fetchAs(USER_SYS, '/agents')).json()).agents
    expect(listAfter.some((a: { id: string }) => a.id === id)).toBe(false)
  })

  it('deleted agent config returns 404', async () => {
    const id = testAgentId('del-config')
    const name = `Test Agent DelConfig ${Date.now()}`
    await createAgent(id, name)
    await deleteAgent(id)

    const configRes = await gw.fetchAs(USER_SYS, `/agents/${id}/config`)
    expect(configRes.status).toBe(404)
  })

  it('returns error for unknown agent', async () => {
    const res = await deleteAgent('nonexistent-agent-xyz')
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.success).toBe(false)
    expect(data.error).toContain('not found')
  })

  it('delete is idempotent — second delete returns error', async () => {
    const id = testAgentId('del-twice')
    const name = `Test Agent DelTwice ${Date.now()}`
    await createAgent(id, name)

    const res1 = await deleteAgent(id)
    expect(res1.ok).toBe(true)

    const res2 = await deleteAgent(id)
    expect(res2.status).toBe(400)
    const data = await res2.json()
    expect(data.success).toBe(false)
  })

  it('requires admin role', async () => {
    const id = testAgentId('del-auth')
    const name = `Test Agent DelAuth ${Date.now()}`
    await createAgent(id, name)

    const res = await gw.fetchAs(USER_ALICE, `/agents/${id}`, { method: 'DELETE' })
    expect(res.status).toBe(403)

    // Cleanup
    await deleteAgent(id)
  })
})

// ─── Full lifecycle ──────────────────────────────────────

describe('Agent Full Lifecycle — create → read → update → delete', () => {
  it('completes the full CRUD cycle', async () => {
    const id = testAgentId('lifecycle')
    const name = `Lifecycle Agent ${Date.now()}`

    // 1. CREATE
    const createRes = await createAgent(id, name)
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.success).toBe(true)
    expect(created.agent.id).toBe(id)

    // 2. READ — listing
    const listRes = await gw.fetchAs(USER_SYS, '/agents')
    const agents = (await listRes.json()).agents
    expect(agents.find((a: { id: string }) => a.id === id)).toBeDefined()

    // 3. READ — config
    const configRes = await gw.fetchAs(USER_SYS, `/agents/${id}/config`)
    expect(configRes.ok).toBe(true)
    const config = await configRes.json()
    expect(config.id).toBe(id)
    expect(config.agentsMd).toContain(name)

    // 4. UPDATE — modify prompt
    const updatedPrompt = '# Updated\n\nNew instructions for lifecycle agent.'
    const updateRes = await gw.fetchAs(USER_SYS, `/agents/${id}/config`, {
      method: 'PUT',
      body: JSON.stringify({ agentsMd: updatedPrompt }),
    })
    expect(updateRes.ok).toBe(true)

    // 5. READ — verify update
    const config2 = await (await gw.fetchAs(USER_SYS, `/agents/${id}/config`)).json()
    expect(config2.agentsMd).toBe(updatedPrompt)

    // 6. DELETE
    const deleteRes = await deleteAgent(id)
    expect(deleteRes.ok).toBe(true)

    // 7. READ — verify gone
    const listAfter = (await (await gw.fetchAs(USER_SYS, '/agents')).json()).agents
    expect(listAfter.find((a: { id: string }) => a.id === id)).toBeUndefined()

    // 8. Config returns 404
    const config3 = await gw.fetchAs(USER_SYS, `/agents/${id}/config`)
    expect(config3.status).toBe(404)
  })

  it('can re-create an agent after deletion', async () => {
    const id = testAgentId('recreate')
    const name1 = `Recreate Agent V1 ${Date.now()}`
    const name2 = `Recreate Agent V2 ${Date.now()}`

    // Create → Delete → Re-create
    await createAgent(id, name1)
    await deleteAgent(id)

    const res = await createAgent(id, name2)
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.agent.name).toBe(name2)

    // Verify new name
    const config = await (await gw.fetchAs(USER_SYS, `/agents/${id}/config`)).json()
    expect(config.name).toBe(name2)

    // Cleanup
    await deleteAgent(id)
  })
})

/**
 * Command Whitelist Management API integration tests — CRUD.
 *
 * Tests use a real Java gateway process against actual file-based storage.
 * Each test that modifies the whitelist restores it to a clean state.
 *
 * API endpoints under test (prefix /ops-gateway/command-whitelist):
 *   GET    /            — get full whitelist
 *   POST   /            — add command
 *   PUT    /{pattern}   — update command by pattern
 *   DELETE /{pattern}   — delete command by pattern
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startJavaGateway, type GatewayHandle } from '../helpers.js'

const USER_ADMIN = 'admin'
const USER_NON_ADMIN = 'test-alice'

let gw: GatewayHandle

beforeAll(async () => {
  gw = await startJavaGateway()
}, 60_000)

afterAll(async () => {
  if (gw) await gw.stop()
}, 15_000)

// ─── Helpers ──────────────────────────────────────────────

interface CommandPayload {
  pattern: string
  description?: string
  enabled?: boolean
}

/** Parse JSON from a response. */
async function parseBody(res: Response) {
  return res.json() as Promise<Record<string, any>>
}

/** Add a command to the whitelist. */
async function addCommand(payload: CommandPayload) {
  return gw.fetchAs(USER_ADMIN, '/command-whitelist/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Update a command by pattern. */
async function updateCommand(pattern: string, payload: Partial<CommandPayload>) {
  return gw.fetchAs(USER_ADMIN, `/command-whitelist/${encodeURIComponent(pattern)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/** Delete a command by pattern. */
async function deleteCommand(pattern: string) {
  return gw.fetchAs(USER_ADMIN, `/command-whitelist/${encodeURIComponent(pattern)}`, {
    method: 'DELETE',
  })
}

/** Get current whitelist. */
async function getWhitelist() {
  const res = await gw.fetchAs(USER_ADMIN, '/command-whitelist/')
  return parseBody(res)
}

/** Generate unique pattern for test isolation. */
function testPattern(suffix: string) {
  return `test-cmd-${suffix}-${Date.now()}`
}

// ─── READ — Get whitelist ────────────────────────────────

describe('Whitelist Read — GET /command-whitelist/', () => {
  it('returns a whitelist object with commands array', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/command-whitelist/')
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data).toHaveProperty('commands')
    expect(Array.isArray(data.commands)).toBe(true)
  })

  it('contains default commands on first load', async () => {
    const data = await getWhitelist()
    const patterns = data.commands.map((c: any) => c.pattern)
    // Check some default commands from CommandWhitelistService.DEFAULT_COMMANDS
    expect(patterns).toContain('ps')
    expect(patterns).toContain('grep')
    expect(patterns).toContain('ls')
    expect(patterns).toContain('df')
  })

  it('each default command has expected fields', async () => {
    const data = await getWhitelist()
    const psCmd = data.commands.find((c: any) => c.pattern === 'ps')
    expect(psCmd).toBeDefined()
    expect(psCmd).toHaveProperty('pattern')
    expect(psCmd).toHaveProperty('description')
    expect(psCmd).toHaveProperty('enabled')
  })

  it('allows non-admin users to get whitelist', async () => {
    const res = await gw.fetchAs(USER_NON_ADMIN, '/command-whitelist/')
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(Array.isArray(data.commands)).toBe(true)
  })

  it('requires valid secret key', async () => {
    const res = await fetch(`${gw.baseUrl}/command-whitelist/`, {
      headers: { 'x-secret-key': 'bad-key', 'x-user-id': USER_ADMIN },
    })
    expect(res.status).toBe(401)
  })
})

// ─── CREATE ──────────────────────────────────────────────

describe('Whitelist Create — POST /command-whitelist/', () => {
  const addedPatterns: string[] = []

  afterAll(async () => {
    for (const pattern of addedPatterns) {
      await deleteCommand(pattern).catch(() => {})
    }
  })

  it('adds a new command to the whitelist', async () => {
    const pattern = testPattern('basic')
    addedPatterns.push(pattern)

    const res = await addCommand({
      pattern,
      description: 'Test command for basic add',
      enabled: true,
    })
    expect(res.status).toBe(201)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
    expect(data.command.pattern).toBe(pattern)
  })

  it('new command appears in whitelist', async () => {
    const pattern = testPattern('list')
    addedPatterns.push(pattern)

    await addCommand({ pattern, description: 'List check', enabled: true })

    const data = await getWhitelist()
    const found = data.commands.find((c: any) => c.pattern === pattern)
    expect(found).toBeDefined()
    expect(found.description).toBe('List check')
    expect(found.enabled).toBe(true)
  })

  it('adds a command with enabled=false', async () => {
    const pattern = testPattern('disabled')
    addedPatterns.push(pattern)

    const res = await addCommand({
      pattern,
      description: 'Disabled command',
      enabled: false,
    })
    expect(res.status).toBe(201)

    const data = await getWhitelist()
    const found = data.commands.find((c: any) => c.pattern === pattern)
    expect(found).toBeDefined()
    expect(found.enabled).toBe(false)
  })

  it('adds a command without optional fields', async () => {
    const pattern = testPattern('minimal')
    addedPatterns.push(pattern)

    const res = await addCommand({ pattern })
    expect(res.status).toBe(201)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
  })

  it('can add multiple commands', async () => {
    const patterns = [testPattern('multi1'), testPattern('multi2'), testPattern('multi3')]
    for (const p of patterns) {
      addedPatterns.push(p)
      const res = await addCommand({ pattern: p, enabled: true })
      expect(res.status).toBe(201)
    }

    const data = await getWhitelist()
    const allPatterns = data.commands.map((c: any) => c.pattern)
    for (const p of patterns) {
      expect(allPatterns).toContain(p)
    }
  })

  it('allows non-admin users to add command', async () => {
    const pattern = testPattern('nonadmin')
    addedPatterns.push(pattern)
    const res = await gw.fetchAs(USER_NON_ADMIN, '/command-whitelist/', {
      method: 'POST',
      body: JSON.stringify({ pattern, description: 'Non-admin command' }),
    })
    expect(res.status).toBe(201)
  })
})

// ─── UPDATE ──────────────────────────────────────────────

describe('Whitelist Update — PUT /command-whitelist/{pattern}', () => {
  const pattern = testPattern('update')

  beforeAll(async () => {
    await addCommand({
      pattern,
      description: 'Original description',
      enabled: true,
    })
  })

  afterAll(async () => {
    await deleteCommand(pattern).catch(() => {})
  })

  it('updates description', async () => {
    const res = await updateCommand(pattern, { description: 'Updated description' })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
    expect(data.command.description).toBe('Updated description')
  })

  it('toggles enabled status', async () => {
    const res = await updateCommand(pattern, { enabled: false })
    expect(res.ok).toBe(true)

    const whitelist = await getWhitelist()
    const cmd = whitelist.commands.find((c: any) => c.pattern === pattern)
    expect(cmd.enabled).toBe(false)

    // Toggle back
    await updateCommand(pattern, { enabled: true })
    const whitelist2 = await getWhitelist()
    const cmd2 = whitelist2.commands.find((c: any) => c.pattern === pattern)
    expect(cmd2.enabled).toBe(true)
  })

  it('update is persisted', async () => {
    await updateCommand(pattern, { description: 'Persistence test' })

    // Re-read whitelist to verify
    const whitelist = await getWhitelist()
    const cmd = whitelist.commands.find((c: any) => c.pattern === pattern)
    expect(cmd.description).toBe('Persistence test')
  })

  it('returns 404 for non-existent pattern', async () => {
    const res = await updateCommand('nonexistent-pattern-xyz-999', {
      description: 'Ghost',
    })
    expect(res.status).toBe(404)
    const data = await parseBody(res)
    expect(data.success).toBe(false)
    expect(data.error).toContain('not found')
  })

  it('allows non-admin users to update command', async () => {
    const res = await gw.fetchAs(
      USER_NON_ADMIN,
      `/command-whitelist/${encodeURIComponent(pattern)}`,
      { method: 'PUT', body: JSON.stringify({ description: 'Updated-By-NonAdmin' }) },
    )
    expect(res.ok).toBe(true)
  })
})

// ─── DELETE ──────────────────────────────────────────────

describe('Whitelist Delete — DELETE /command-whitelist/{pattern}', () => {
  it('deletes an existing command', async () => {
    const pattern = testPattern('delete')
    await addCommand({ pattern, description: 'To be deleted', enabled: true })

    // Verify it exists
    const before = await getWhitelist()
    expect(before.commands.some((c: any) => c.pattern === pattern)).toBe(true)

    // Delete
    const res = await deleteCommand(pattern)
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.success).toBe(true)

    // Verify it's gone
    const after = await getWhitelist()
    expect(after.commands.some((c: any) => c.pattern === pattern)).toBe(false)
  })

  it('returns 404 for non-existent pattern', async () => {
    const res = await deleteCommand('nonexistent-delete-xyz-999')
    expect(res.status).toBe(404)
    const data = await parseBody(res)
    expect(data.success).toBe(false)
    expect(data.error).toContain('not found')
  })

  it('delete is idempotent — second delete returns 404', async () => {
    const pattern = testPattern('idempotent')
    await addCommand({ pattern, enabled: true })

    const del1 = await deleteCommand(pattern)
    expect(del1.ok).toBe(true)

    const del2 = await deleteCommand(pattern)
    expect(del2.status).toBe(404)
  })

  it('allows non-admin users to delete command', async () => {
    const pattern = testPattern('delnonadmin')
    await addCommand({ pattern, enabled: true })

    const res = await gw.fetchAs(
      USER_NON_ADMIN,
      `/command-whitelist/${encodeURIComponent(pattern)}`,
      { method: 'DELETE' },
    )
    expect(res.ok).toBe(true)
  })
})

// ─── Full Lifecycle ──────────────────────────────────────

describe('Whitelist Full Lifecycle — add → read → update → delete', () => {
  it('completes the full CRUD cycle', async () => {
    const pattern = testPattern('lifecycle')

    // 1. CREATE — add command
    const addRes = await addCommand({
      pattern,
      description: 'Lifecycle test command',
      enabled: true,
    })
    expect(addRes.status).toBe(201)
    const addData = await parseBody(addRes)
    expect(addData.success).toBe(true)

    // 2. READ — verify in whitelist
    const getRes = await getWhitelist()
    const cmd = getRes.commands.find((c: any) => c.pattern === pattern)
    expect(cmd).toBeDefined()
    expect(cmd.description).toBe('Lifecycle test command')
    expect(cmd.enabled).toBe(true)

    // 3. UPDATE — change description and disable
    const updateRes = await updateCommand(pattern, {
      description: 'Updated lifecycle command',
      enabled: false,
    })
    expect(updateRes.ok).toBe(true)

    // 4. READ — verify update
    const getRes2 = await getWhitelist()
    const cmd2 = getRes2.commands.find((c: any) => c.pattern === pattern)
    expect(cmd2.description).toBe('Updated lifecycle command')
    expect(cmd2.enabled).toBe(false)

    // 5. DELETE
    const deleteRes = await deleteCommand(pattern)
    expect(deleteRes.ok).toBe(true)

    // 6. READ — verify gone
    const getRes3 = await getWhitelist()
    expect(getRes3.commands.some((c: any) => c.pattern === pattern)).toBe(false)
  })
})

// ─── Default Commands Integrity ──────────────────────────

describe('Whitelist — Default Commands Integrity', () => {
  it('does not affect default commands when adding new ones', async () => {
    const pattern = testPattern('integrity')
    const before = await getWhitelist()
    const defaultCount = before.commands.length

    await addCommand({ pattern, description: 'Integrity check', enabled: true })

    const after = await getWhitelist()
    // Default commands still present
    const defaultPatterns = ['ps', 'tail', 'grep', 'cat', 'ls', 'df', 'free', 'netstat']
    for (const dp of defaultPatterns) {
      expect(after.commands.some((c: any) => c.pattern === dp)).toBe(true)
    }
    // Total increased by 1
    expect(after.commands.length).toBe(defaultCount + 1)

    // Cleanup
    await deleteCommand(pattern)
  })
})
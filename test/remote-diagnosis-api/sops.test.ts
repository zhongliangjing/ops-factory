/**
 * SOP Management API integration tests — CRUD.
 *
 * Tests use a real Java gateway process against actual file-based storage.
 Each test creates its own SOPs and cleans up after itself.
 *
 * API endpoints under test (prefix /ops-gateway/sops):
 *   GET    /        — list all SOPs
 *   GET    /{id}    — get SOP by id
 *   POST   /        — create SOP
 *   PUT    /{id}    — update SOP
 *   DELETE /{id}    — delete SOP
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

interface SopPayload {
  name: string
  description?: string
  version?: string
  triggerCondition?: string
  nodes?: any[]
}

/** Create a test SOP and return the response. */
async function createSop(payload: SopPayload) {
  return gw.fetchAs(USER_ADMIN, '/sops/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Delete a test SOP (best-effort cleanup). */
async function deleteSop(id: string) {
  return gw.fetchAs(USER_ADMIN, `/sops/${id}`, { method: 'DELETE' })
}

/** Parse JSON from a response. */
async function parseBody(res: Response) {
  return res.json() as Promise<Record<string, any>>
}

/** Generate unique suffix for test isolation. */
function uid(suffix: string) {
  return `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ─── READ — Listing ──────────────────────────────────────

describe('SOP Read — GET /sops/', () => {
  it('returns a sops array', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/sops/')
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(Array.isArray(data.sops)).toBe(true)
  })

  it('allows non-admin users to list SOPs', async () => {
    const res = await gw.fetchAs(USER_NON_ADMIN, '/sops/')
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(Array.isArray(data.sops)).toBe(true)
  })

  it('requires valid secret key', async () => {
    const res = await fetch(`${gw.baseUrl}/sops/`, {
      headers: { 'x-secret-key': 'invalid-key', 'x-user-id': USER_ADMIN },
    })
    expect(res.status).toBe(401)
  })
})

// ─── READ — Get by ID ────────────────────────────────────

describe('SOP Read — GET /sops/{id}', () => {
  it('returns SOP details for existing SOP', async () => {
    const payload: SopPayload = {
      name: `GetById-${uid('get')}`,
      description: 'Test SOP for get-by-id',
      version: '2.0.0',
      triggerCondition: 'cpu > 90%',
    }
    const createRes = await createSop(payload)
    expect(createRes.status).toBe(201)
    const sopId = (await parseBody(createRes)).sop.id

    try {
      const getRes = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`)
      expect(getRes.ok).toBe(true)
      const data = await parseBody(getRes)
      expect(data.success).toBe(true)
      expect(data.sop).toBeDefined()
      expect(data.sop.id).toBe(sopId)
      expect(data.sop.name).toBe(payload.name)
      expect(data.sop.description).toBe(payload.description)
    } finally {
      await deleteSop(sopId)
    }
  })

  it('returns error for non-existent SOP', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/sops/nonexistent-sop-id-xyz')
    // SopService.getSop() throws IllegalArgumentException → 500
    expect(res.status).toBe(500)
    const data = await parseBody(res)
    expect(data.success).toBe(false)
  })

  it('allows non-admin users to get SOP by id', async () => {
    const payload: SopPayload = { name: `AuthSop-${uid('as')}` }
    const createRes = await createSop(payload)
    const sopId = (await parseBody(createRes)).sop.id

    try {
      const res = await gw.fetchAs(USER_NON_ADMIN, `/sops/${sopId}`)
      expect(res.ok).toBe(true)
    } finally {
      await deleteSop(sopId)
    }
  })
})

// ─── CREATE ──────────────────────────────────────────────

describe('SOP Create — POST /sops/', () => {
  const createdIds: string[] = []

  afterAll(async () => {
    for (const id of createdIds) {
      await deleteSop(id)
    }
  })

  it('creates a SOP with all fields', async () => {
    const payload: SopPayload = {
      name: `FullCreate-${uid('fc')}`,
      description: 'A full SOP creation test',
      version: '1.5.0',
      triggerCondition: 'disk > 80%',
      nodes: [
        { id: 'node-1', type: 'check', command: 'df -h' },
        { id: 'node-2', type: 'action', command: 'cleanup.sh' },
      ],
    }
    const res = await createSop(payload)
    expect(res.status).toBe(201)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
    expect(data.sop).toBeDefined()
    expect(data.sop.id).toBeDefined()
    expect(data.sop.name).toBe(payload.name)
    expect(data.sop.description).toBe(payload.description)
    expect(data.sop.version).toBe(payload.version)
    expect(data.sop.triggerCondition).toBe(payload.triggerCondition)
    expect(data.sop.nodes).toHaveLength(2)
    createdIds.push(data.sop.id)
  })

  it('creates a SOP with defaults for optional fields', async () => {
    const payload: SopPayload = {
      name: `MinimalSop-${uid('ms')}`,
    }
    const res = await createSop(payload)
    expect(res.status).toBe(201)
    const data = await parseBody(res)
    expect(data.sop.name).toBe(payload.name)
    expect(data.sop.version).toBe('1.0.0')
    expect(data.sop.description).toBe('')
    expect(data.sop.triggerCondition).toBe('')
    expect(data.sop.nodes).toEqual([])
    createdIds.push(data.sop.id)
  })

  it('new SOP appears in listing', async () => {
    const payload: SopPayload = {
      name: `ListCheck-${uid('lc')}`,
    }
    const createRes = await createSop(payload)
    const sopId = (await parseBody(createRes)).sop.id
    createdIds.push(sopId)

    const listRes = await gw.fetchAs(USER_ADMIN, '/sops/')
    const data = await parseBody(listRes)
    const found = data.sops.find((s: any) => s.id === sopId)
    expect(found).toBeDefined()
    expect(found.name).toBe(payload.name)
  })

  it('auto-generates a UUID as id', async () => {
    const payload: SopPayload = { name: `UuidCheck-${uid('uc')}` }
    const res = await createSop(payload)
    const data = await parseBody(res)
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(data.sop.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    createdIds.push(data.sop.id)
  })

  it('allows non-admin users to create SOP', async () => {
    const payload: SopPayload = { name: `NonAdminSop-${uid('nas')}` }
    const res = await gw.fetchAs(USER_NON_ADMIN, '/sops/', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    expect(res.status).toBe(201)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
    createdIds.push(data.sop.id)
  })
})

// ─── UPDATE ──────────────────────────────────────────────

describe('SOP Update — PUT /sops/{id}', () => {
  let sopId: string

  beforeAll(async () => {
    const payload: SopPayload = {
      name: `UpdateTarget-${uid('ut')}`,
      description: 'Original SOP',
      version: '1.0.0',
      triggerCondition: 'memory > 90%',
      nodes: [{ id: 'n1', type: 'check', command: 'free -m' }],
    }
    const res = await createSop(payload)
    sopId = (await parseBody(res)).sop.id
  })

  afterAll(async () => {
    await deleteSop(sopId)
  })

  it('updates individual fields', async () => {
    const res = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated-SOP-Name', description: 'Updated description' }),
    })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
    expect(data.sop.name).toBe('Updated-SOP-Name')
    expect(data.sop.description).toBe('Updated description')
    // Unchanged fields should persist
    expect(data.sop.triggerCondition).toBe('memory > 90%')
  })

  it('updates version', async () => {
    const res = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`, {
      method: 'PUT',
      body: JSON.stringify({ version: '2.1.0' }),
    })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.sop.version).toBe('2.1.0')
  })

  it('updates trigger condition', async () => {
    const res = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`, {
      method: 'PUT',
      body: JSON.stringify({ triggerCondition: 'cpu > 95% AND mem > 85%' }),
    })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.sop.triggerCondition).toBe('cpu > 95% AND mem > 85%')
  })

  it('updates nodes', async () => {
    const newNodes = [
      { id: 'n1', type: 'check', command: 'ps aux' },
      { id: 'n2', type: 'action', command: 'restart-service.sh' },
      { id: 'n3', type: 'verify', command: 'systemctl status' },
    ]
    const res = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`, {
      method: 'PUT',
      body: JSON.stringify({ nodes: newNodes }),
    })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.sop.nodes).toHaveLength(3)
  })

  it('returns error for non-existent SOP', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/sops/nonexistent-sop-xyz', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Ghost' }),
    })
    // SopService.updateSop() throws IllegalArgumentException → 400
    expect(res.status).toBe(400)
    const data = await parseBody(res)
    expect(data.success).toBe(false)
  })

  it('allows non-admin users to update SOP', async () => {
    const res = await gw.fetchAs(USER_NON_ADMIN, `/sops/${sopId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated-By-NonAdmin' }),
    })
    expect(res.ok).toBe(true)
  })
})

// ─── DELETE ──────────────────────────────────────────────

describe('SOP Delete — DELETE /sops/{id}', () => {
  it('deletes an existing SOP', async () => {
    const payload: SopPayload = { name: `DeleteTarget-${uid('dt')}` }
    const createRes = await createSop(payload)
    const sopId = (await parseBody(createRes)).sop.id

    // Verify it exists in listing
    const listBefore = await gw.fetchAs(USER_ADMIN, '/sops/')
    const beforeData = await parseBody(listBefore)
    expect(beforeData.sops.some((s: any) => s.id === sopId)).toBe(true)

    // Delete
    const deleteRes = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`, { method: 'DELETE' })
    expect(deleteRes.ok).toBe(true)
    const deleteData = await parseBody(deleteRes)
    expect(deleteData.success).toBe(true)

    // Verify it's gone
    const listAfter = await gw.fetchAs(USER_ADMIN, '/sops/')
    const afterData = await parseBody(listAfter)
    expect(afterData.sops.some((s: any) => s.id === sopId)).toBe(false)
  })

  it('returns 404 for non-existent SOP', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/sops/nonexistent-delete-xyz', { method: 'DELETE' })
    expect(res.status).toBe(404)
    const data = await parseBody(res)
    expect(data.success).toBe(false)
    expect(data.error).toContain('not found')
  })

  it('delete is idempotent — second delete returns 404', async () => {
    const payload: SopPayload = { name: `IdempotentDel-${uid('id')}` }
    const createRes = await createSop(payload)
    const sopId = (await parseBody(createRes)).sop.id

    const del1 = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`, { method: 'DELETE' })
    expect(del1.ok).toBe(true)

    const del2 = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`, { method: 'DELETE' })
    expect(del2.status).toBe(404)
  })

  it('allows non-admin users to delete SOP', async () => {
    const payload: SopPayload = { name: `DelNonAdmin-${uid('dna')}` }
    const createRes = await createSop(payload)
    const sopId = (await parseBody(createRes)).sop.id

    const res = await gw.fetchAs(USER_NON_ADMIN, `/sops/${sopId}`, { method: 'DELETE' })
    expect(res.ok).toBe(true)
  })
})

// ─── Full Lifecycle ───────────────────────────────────────

describe('SOP Full Lifecycle — create → read → update → delete', () => {
  it('completes the full CRUD cycle', async () => {
    // 1. CREATE
    const payload: SopPayload = {
      name: `Lifecycle-${uid('lc')}`,
      description: 'Lifecycle test SOP',
      version: '1.0.0',
      triggerCondition: 'error_rate > 5%',
      nodes: [{ id: 'n1', type: 'check', command: 'grep ERROR /var/log/app.log' }],
    }
    const createRes = await createSop(payload)
    expect(createRes.status).toBe(201)
    const created = await parseBody(createRes)
    const sopId = created.sop.id
    expect(created.success).toBe(true)
    expect(created.sop.name).toBe(payload.name)

    // 2. READ — by id
    const getRes = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`)
    expect(getRes.ok).toBe(true)
    const fetched = await parseBody(getRes)
    expect(fetched.sop.id).toBe(sopId)
    expect(fetched.sop.nodes).toHaveLength(1)

    // 3. READ — in listing
    const listRes = await gw.fetchAs(USER_ADMIN, '/sops/')
    const listData = await parseBody(listRes)
    expect(listData.sops.some((s: any) => s.id === sopId)).toBe(true)

    // 4. UPDATE
    const updateRes = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Updated-Lifecycle-SOP',
        version: '2.0.0',
        nodes: [
          { id: 'n1', type: 'check', command: 'grep ERROR /var/log/app.log' },
          { id: 'n2', type: 'action', command: 'restart-app.sh' },
        ],
      }),
    })
    expect(updateRes.ok).toBe(true)
    const updated = await parseBody(updateRes)
    expect(updated.sop.name).toBe('Updated-Lifecycle-SOP')
    expect(updated.sop.version).toBe('2.0.0')
    expect(updated.sop.nodes).toHaveLength(2)

    // 5. READ — verify update
    const verifyRes = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`)
    const verified = await parseBody(verifyRes)
    expect(verified.sop.name).toBe('Updated-Lifecycle-SOP')
    expect(verified.sop.version).toBe('2.0.0')

    // 6. DELETE
    const deleteRes = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`, { method: 'DELETE' })
    expect(deleteRes.ok).toBe(true)

    // 7. READ — verify gone (getSop throws → 500)
    const goneRes = await gw.fetchAs(USER_ADMIN, `/sops/${sopId}`)
    expect([404, 500]).toContain(goneRes.status)
  })

  it('can re-create a SOP after deletion', async () => {
    const name = `ReCreate-${uid('rc')}`

    // Create → Delete → Re-create with same name
    const res1 = await createSop({ name })
    const sopId1 = (await parseBody(res1)).sop.id

    await deleteSop(sopId1)

    const res2 = await createSop({ name, version: '2.0.0' })
    expect(res2.status).toBe(201)
    const recreated = await parseBody(res2)
    expect(recreated.sop.name).toBe(name)
    expect(recreated.sop.id).not.toBe(sopId1) // new UUID

    // Cleanup
    await deleteSop(recreated.sop.id)
  })
})
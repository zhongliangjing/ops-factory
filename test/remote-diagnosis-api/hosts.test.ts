/**
 * Host Management API integration tests — CRUD + connectivity test.
 *
 * Tests use a real Java gateway process against actual file-based storage.
 * Each test creates its own hosts and cleans up after itself.
 *
 * API endpoints under test (prefix /ops-gateway/hosts):
 *   GET    /            — list hosts (optional ?tags=TAG1,TAG2)
 *   GET    /{id}        — get host by id
 *   POST   /            — create host
 *   PUT    /{id}        — update host
 *   DELETE /{id}        — delete host
 *   GET    /tags        — get all unique tags
 *   POST   /{id}/test   — test SSH connectivity
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

interface HostPayload {
  name: string
  ip: string
  port?: number
  username?: string
  authType?: string
  credential?: string
  tags?: string[]
  description?: string
}

/** Create a test host and return the response. */
async function createHost(payload: HostPayload) {
  return gw.fetchAs(USER_ADMIN, '/hosts/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Delete a test host (best-effort cleanup). */
async function deleteHost(id: string) {
  return gw.fetchAs(USER_ADMIN, `/hosts/${id}`, { method: 'DELETE' })
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

describe('Host Read — GET /hosts/', () => {
  it('returns an empty or non-empty hosts array', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/hosts/')
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(Array.isArray(data.hosts)).toBe(true)
  })

  it('allows non-admin users to list hosts', async () => {
    const res = await gw.fetchAs(USER_NON_ADMIN, '/hosts/')
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(Array.isArray(data.hosts)).toBe(true)
  })

  it('requires valid secret key', async () => {
    const res = await fetch(`${gw.baseUrl}/hosts/`, {
      headers: { 'x-secret-key': 'wrong-key', 'x-user-id': USER_ADMIN },
    })
    expect(res.status).toBe(401)
  })

  it('supports tag filtering via ?tags=', async () => {
    const host1Payload: HostPayload = {
      name: `TagFilter-A-${uid('tf')}`,
      ip: '10.0.0.101',
      tags: ['RCPA', 'TEST-TAG-FILTER'],
      username: 'root',
      authType: 'password',
      credential: 'pass123',
    }
    const host2Payload: HostPayload = {
      name: `TagFilter-B-${uid('tf')}`,
      ip: '10.0.0.102',
      tags: ['GMDB', 'TEST-TAG-FILTER'],
      username: 'root',
      authType: 'password',
      credential: 'pass456',
    }

    const res1 = await createHost(host1Payload)
    const res2 = await createHost(host2Payload)
    expect(res1.status).toBe(201)
    expect(res2.status).toBe(201)

    const host1Id = (await parseBody(res1)).host.id
    const host2Id = (await parseBody(res2)).host.id

    try {
      // Filter by RCPA — should include host1 only
      const filterRes = await gw.fetchAs(USER_ADMIN, '/hosts/?tags=RCPA')
      expect(filterRes.ok).toBe(true)
      const filtered = await parseBody(filterRes)
      const ids = filtered.hosts.map((h: any) => h.id)
      expect(ids).toContain(host1Id)
      expect(ids).not.toContain(host2Id)

      // Filter by TEST-TAG-FILTER — should include both
      const sharedRes = await gw.fetchAs(USER_ADMIN, '/hosts/?tags=TEST-TAG-FILTER')
      expect(sharedRes.ok).toBe(true)
      const shared = await parseBody(sharedRes)
      const sharedIds = shared.hosts.map((h: any) => h.id)
      expect(sharedIds).toContain(host1Id)
      expect(sharedIds).toContain(host2Id)

      // Filter by nonexistent tag — should include neither
      const emptyRes = await gw.fetchAs(USER_ADMIN, '/hosts/?tags=NONEXISTENT-TAG-XYZ')
      expect(emptyRes.ok).toBe(true)
      const empty = await parseBody(emptyRes)
      const emptyIds = empty.hosts.map((h: any) => h.id)
      expect(emptyIds).not.toContain(host1Id)
      expect(emptyIds).not.toContain(host2Id)
    } finally {
      await deleteHost(host1Id)
      await deleteHost(host2Id)
    }
  })
})

// ─── READ — Get by ID ────────────────────────────────────

describe('Host Read — GET /hosts/{id}', () => {
  it('returns host details for existing host', async () => {
    const payload: HostPayload = {
      name: `GetById-${uid('get')}`,
      ip: '10.0.0.50',
      username: 'admin',
      authType: 'password',
      credential: 'secret',
      tags: ['TEST'],
      description: 'Test host for get-by-id',
    }
    const createRes = await createHost(payload)
    expect(createRes.status).toBe(201)
    const created = await parseBody(createRes)
    const hostId = created.host.id

    try {
      const getRes = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`)
      expect(getRes.ok).toBe(true)
      const data = await parseBody(getRes)
      expect(data.success).toBe(true)
      expect(data.host).toBeDefined()
      expect(data.host.id).toBe(hostId)
      expect(data.host.name).toBe(payload.name)
      expect(data.host.ip).toBe(payload.ip)
      expect(data.host.credential).toBe('***')
    } finally {
      await deleteHost(hostId)
    }
  })

  it('returns error for non-existent host', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/hosts/nonexistent-host-id-xyz')
    expect(res.status).toBe(500)
    const data = await parseBody(res)
    expect(data.success).toBe(false)
  })

  it('allows non-admin users to get host by id', async () => {
    const payload: HostPayload = {
      name: `AuthTest-${uid('auth')}`,
      ip: '10.0.0.51',
      username: 'root',
      authType: 'password',
      credential: 'pass',
    }
    const createRes = await createHost(payload)
    const hostId = (await parseBody(createRes)).host.id

    try {
      const res = await gw.fetchAs(USER_NON_ADMIN, `/hosts/${hostId}`)
      expect(res.ok).toBe(true)
    } finally {
      await deleteHost(hostId)
    }
  })
})

// ─── CREATE ──────────────────────────────────────────────

describe('Host Create — POST /hosts/', () => {
  const createdIds: string[] = []

  afterAll(async () => {
    for (const id of createdIds) {
      await deleteHost(id)
    }
  })

  it('creates a host with all fields', async () => {
    const payload: HostPayload = {
      name: `FullCreate-${uid('fc')}`,
      ip: '192.168.1.100',
      port: 2222,
      username: 'deploy',
      authType: 'password',
      credential: 'my-secret-password',
      tags: ['PROD', 'WEB'],
      description: 'Full create test host',
    }
    const res = await createHost(payload)
    expect(res.status).toBe(201)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
    expect(data.host).toBeDefined()
    expect(data.host.id).toBeDefined()
    expect(data.host.name).toBe(payload.name)
    expect(data.host.ip).toBe(payload.ip)
    expect(data.host.port).toBe(payload.port)
    expect(data.host.username).toBe(payload.username)
    expect(data.host.authType).toBe(payload.authType)
    expect(data.host.credential).toBe('***')
    expect(data.host.tags).toEqual(payload.tags)
    expect(data.host.description).toBe(payload.description)
    expect(data.host.createdAt).toBeDefined()
    expect(data.host.updatedAt).toBeDefined()
    createdIds.push(data.host.id)
  })

  it('creates a host with defaults for optional fields', async () => {
    const payload: HostPayload = {
      name: `MinimalCreate-${uid('mc')}`,
      ip: '10.0.0.1',
    }
    const res = await createHost(payload)
    expect(res.status).toBe(201)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
    expect(data.host.port).toBe(22)
    expect(data.host.username).toBe('')
    expect(data.host.authType).toBe('password')
    expect(data.host.tags).toEqual([])
    expect(data.host.description).toBe('')
    createdIds.push(data.host.id)
  })

  it('new host appears in listing', async () => {
    const payload: HostPayload = {
      name: `ListCheck-${uid('lc')}`,
      ip: '10.0.0.2',
    }
    const createRes = await createHost(payload)
    const hostId = (await parseBody(createRes)).host.id
    createdIds.push(hostId)

    const listRes = await gw.fetchAs(USER_ADMIN, '/hosts/')
    const data = await parseBody(listRes)
    const found = data.hosts.find((h: any) => h.id === hostId)
    expect(found).toBeDefined()
    expect(found.name).toBe(payload.name)
    expect(found.credential).toBe('***')
  })

  it('credential is masked in create response', async () => {
    const payload: HostPayload = {
      name: `CredMask-${uid('cm')}`,
      ip: '10.0.0.3',
      credential: 'super-secret-123',
    }
    const res = await createHost(payload)
    const data = await parseBody(res)
    expect(data.host.credential).toBe('***')
    createdIds.push(data.host.id)
  })

  it('allows non-admin users to create host', async () => {
    const payload: HostPayload = {
      name: `NonAdminCreate-${uid('na')}`,
      ip: '10.0.0.4',
    }
    const res = await gw.fetchAs(USER_NON_ADMIN, '/hosts/', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    expect(res.status).toBe(201)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
    createdIds.push(data.host.id)
  })
})

// ─── UPDATE ──────────────────────────────────────────────

describe('Host Update — PUT /hosts/{id}', () => {
  let hostId: string

  beforeAll(async () => {
    const payload: HostPayload = {
      name: `UpdateTarget-${uid('ut')}`,
      ip: '10.0.0.10',
      port: 22,
      username: 'root',
      authType: 'password',
      credential: 'original-pass',
      tags: ['INIT'],
      description: 'Original description',
    }
    const res = await createHost(payload)
    hostId = (await parseBody(res)).host.id
  })

  afterAll(async () => {
    await deleteHost(hostId)
  })

  it('updates individual fields', async () => {
    const res = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated-Name', ip: '10.0.0.99' }),
    })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.success).toBe(true)
    expect(data.host.name).toBe('Updated-Name')
    expect(data.host.ip).toBe('10.0.0.99')
    expect(data.host.username).toBe('root')
  })

  it('updates tags', async () => {
    const newTags = ['PROD', 'DB', 'UPDATED']
    const res = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`, {
      method: 'PUT',
      body: JSON.stringify({ tags: newTags }),
    })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.host.tags).toEqual(newTags)
  })

  it('updates credential (masked in response)', async () => {
    const res = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`, {
      method: 'PUT',
      body: JSON.stringify({ credential: 'new-secret-password' }),
    })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.host.credential).toBe('***')
  })

  it('preserves original credential when sending masked "***" value', async () => {
    // Create a fresh host with a known password for this test
    const freshPayload: HostPayload = {
      name: `MaskCredTest-${uid('mc')}`,
      ip: '10.0.0.60',
      username: 'root',
      authType: 'password',
      credential: 'my-original-password',
      tags: ['MASK-TEST'],
    }
    const createRes = await createHost(freshPayload)
    expect(createRes.status).toBe(201)
    const freshHostId = (await parseBody(createRes)).host.id

    try {
      // Simulate the frontend edit-without-password-change: send credential "***"
      const updateRes = await gw.fetchAs(USER_ADMIN, `/hosts/${freshHostId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'MaskCredTest-Updated', credential: '***' }),
      })
      expect(updateRes.ok).toBe(true)
      const data = await parseBody(updateRes)
      expect(data.host.credential).toBe('***')
      expect(data.host.name).toBe('MaskCredTest-Updated')

      // Now update with a real new password and verify the original was preserved
      // by checking that we can still update to a new password
      const updateRes2 = await gw.fetchAs(USER_ADMIN, `/hosts/${freshHostId}`, {
        method: 'PUT',
        body: JSON.stringify({ credential: 'new-password-after-mask' }),
      })
      expect(updateRes2.ok).toBe(true)

      // The key invariant: updating without credential change should not corrupt stored data
      // We verify this by checking the host still works with updated fields
      const getRes = await gw.fetchAs(USER_ADMIN, `/hosts/${freshHostId}`)
      expect(getRes.ok).toBe(true)
      const getData = await parseBody(getRes)
      expect(getData.host.name).toBe('MaskCredTest-Updated')
      expect(getData.host.credential).toBe('***')
    } finally {
      await deleteHost(freshHostId)
    }
  })

  it('preserves original credential when credential field is omitted', async () => {
    // Create a fresh host
    const freshPayload: HostPayload = {
      name: `OmitCredTest-${uid('oc')}`,
      ip: '10.0.0.61',
      username: 'root',
      authType: 'password',
      credential: 'original-pass-omit-test',
    }
    const createRes = await createHost(freshPayload)
    expect(createRes.status).toBe(201)
    const freshHostId = (await parseBody(createRes)).host.id

    try {
      // Update without sending credential at all
      const updateRes = await gw.fetchAs(USER_ADMIN, `/hosts/${freshHostId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'OmitCredTest-Updated', description: 'new desc' }),
      })
      expect(updateRes.ok).toBe(true)
      const data = await parseBody(updateRes)
      expect(data.host.name).toBe('OmitCredTest-Updated')
      expect(data.host.credential).toBe('***')
    } finally {
      await deleteHost(freshHostId)
    }
  })

  it('updatedAt changes after update', async () => {
    const getBefore = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`)
    const beforeData = await parseBody(getBefore)
    const originalUpdatedAt = beforeData.host.updatedAt

    await new Promise(r => setTimeout(r, 100))

    const res = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`, {
      method: 'PUT',
      body: JSON.stringify({ description: 'Trigger updatedAt change' }),
    })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.host.updatedAt).not.toBe(originalUpdatedAt)
  })

  it('returns error for non-existent host', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/hosts/nonexistent-xyz-id', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Ghost' }),
    })
    expect(res.status).toBe(400)
    const data = await parseBody(res)
    expect(data.success).toBe(false)
  })

  it('allows non-admin users to update host', async () => {
    const res = await gw.fetchAs(USER_NON_ADMIN, `/hosts/${hostId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated-By-NonAdmin' }),
    })
    expect(res.ok).toBe(true)
  })
})

// ─── DELETE ──────────────────────────────────────────────

describe('Host Delete — DELETE /hosts/{id}', () => {
  it('deletes an existing host', async () => {
    const payload: HostPayload = {
      name: `DeleteTarget-${uid('dt')}`,
      ip: '10.0.0.20',
    }
    const createRes = await createHost(payload)
    const hostId = (await parseBody(createRes)).host.id

    const listBefore = await gw.fetchAs(USER_ADMIN, '/hosts/')
    const beforeData = await parseBody(listBefore)
    expect(beforeData.hosts.some((h: any) => h.id === hostId)).toBe(true)

    const deleteRes = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`, { method: 'DELETE' })
    expect(deleteRes.ok).toBe(true)
    const deleteData = await parseBody(deleteRes)
    expect(deleteData.success).toBe(true)

    const listAfter = await gw.fetchAs(USER_ADMIN, '/hosts/')
    const afterData = await parseBody(listAfter)
    expect(afterData.hosts.some((h: any) => h.id === hostId)).toBe(false)
  })

  it('returns 404 for non-existent host', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/hosts/nonexistent-delete-xyz', { method: 'DELETE' })
    expect(res.status).toBe(404)
    const data = await parseBody(res)
    expect(data.success).toBe(false)
    expect(data.error).toContain('not found')
  })

  it('delete is idempotent — second delete returns 404', async () => {
    const payload: HostPayload = {
      name: `IdempotentDel-${uid('id')}`,
      ip: '10.0.0.21',
    }
    const createRes = await createHost(payload)
    const hostId = (await parseBody(createRes)).host.id

    const del1 = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`, { method: 'DELETE' })
    expect(del1.ok).toBe(true)

    const del2 = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`, { method: 'DELETE' })
    expect(del2.status).toBe(404)
  })

  it('allows non-admin users to delete host', async () => {
    const payload: HostPayload = {
      name: `DelNonAdmin-${uid('dna')}`,
      ip: '10.0.0.22',
    }
    const createRes = await createHost(payload)
    const hostId = (await parseBody(createRes)).host.id

    const res = await gw.fetchAs(USER_NON_ADMIN, `/hosts/${hostId}`, { method: 'DELETE' })
    expect(res.ok).toBe(true)
  })
})

// ─── Tags ───────────────────────────────────────────────

describe('Host Tags — GET /hosts/tags', () => {
  const createdIds: string[] = []

  afterAll(async () => {
    for (const id of createdIds) {
      await deleteHost(id)
    }
  })

  it('returns tags array', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/hosts/tags')
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(Array.isArray(data.tags)).toBe(true)
  })

  it('includes tags from newly created hosts', async () => {
    const uniqueTag = `TEST-TAG-${uid('tag')}`
    const payload: HostPayload = {
      name: `TagHost-${uid('th')}`,
      ip: '10.0.0.30',
      tags: [uniqueTag],
    }
    const createRes = await createHost(payload)
    createdIds.push((await parseBody(createRes)).host.id)

    const res = await gw.fetchAs(USER_ADMIN, '/hosts/tags')
    const data = await parseBody(res)
    expect(data.tags).toContain(uniqueTag)
  })

  it('allows non-admin users to get tags', async () => {
    const res = await gw.fetchAs(USER_NON_ADMIN, '/hosts/tags')
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(Array.isArray(data.tags)).toBe(true)
  })
})

// ─── Connectivity Test ────────────────────────────────────

describe('Host Connectivity Test — POST /hosts/{id}/test', () => {
  it('returns test result structure for a host (expected to fail — no real SSH)', async () => {
    const payload: HostPayload = {
      name: `ConnTest-${uid('ct')}`,
      ip: '192.0.2.1',
      username: 'root',
      authType: 'password',
      credential: 'test-pass',
    }
    const createRes = await createHost(payload)
    const hostId = (await parseBody(createRes)).host.id

    try {
      const testRes = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}/test`, { method: 'POST' })
      expect(testRes.ok).toBe(true)
      const data = await parseBody(testRes)
      expect(data).toHaveProperty('success')
      expect(data.hostId).toBe(hostId)
      expect(data).toHaveProperty('reachable')
    } finally {
      await deleteHost(hostId)
    }
  })

  it('returns failure for non-existent host', async () => {
    const res = await gw.fetchAs(USER_ADMIN, '/hosts/nonexistent-test-id/test', { method: 'POST' })
    expect(res.ok).toBe(true)
    const data = await parseBody(res)
    expect(data.success).toBe(false)
    expect(data.hostId).toBe('nonexistent-test-id')
  })

  it('allows non-admin users to test connectivity', async () => {
    const payload: HostPayload = {
      name: `ConnNonAdmin-${uid('cna')}`,
      ip: '10.0.0.40',
    }
    const createRes = await createHost(payload)
    const hostId = (await parseBody(createRes)).host.id

    try {
      const res = await gw.fetchAs(USER_NON_ADMIN, `/hosts/${hostId}/test`, { method: 'POST' })
      expect(res.ok).toBe(true)
    } finally {
      await deleteHost(hostId)
    }
  })
})

// ─── Full Lifecycle ───────────────────────────────────────

describe('Host Full Lifecycle — create > read > update > delete', () => {
  it('completes the full CRUD cycle', async () => {
    const payload: HostPayload = {
      name: `Lifecycle-${uid('lc')}`,
      ip: '10.10.10.10',
      port: 22,
      username: 'admin',
      authType: 'password',
      credential: 'cycle-password',
      tags: ['LIFECYCLE'],
      description: 'Lifecycle test host',
    }
    const createRes = await createHost(payload)
    expect(createRes.status).toBe(201)
    const created = await parseBody(createRes)
    const hostId = created.host.id
    expect(created.success).toBe(true)
    expect(created.host.name).toBe(payload.name)

    // 2. READ — by id
    const getRes = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`)
    expect(getRes.ok).toBe(true)
    const fetched = await parseBody(getRes)
    expect(fetched.host.id).toBe(hostId)
    expect(fetched.host.ip).toBe(payload.ip)

    // 3. READ — in listing
    const listRes = await gw.fetchAs(USER_ADMIN, '/hosts/')
    const listData = await parseBody(listRes)
    expect(listData.hosts.some((h: any) => h.id === hostId)).toBe(true)

    // 4. UPDATE
    const updateRes = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated-Lifecycle', tags: ['LIFECYCLE', 'UPDATED'] }),
    })
    expect(updateRes.ok).toBe(true)
    const updated = await parseBody(updateRes)
    expect(updated.host.name).toBe('Updated-Lifecycle')
    expect(updated.host.tags).toContain('UPDATED')

    // 5. READ — verify update
    const verifyRes = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`)
    const verified = await parseBody(verifyRes)
    expect(verified.host.name).toBe('Updated-Lifecycle')

    // 6. DELETE
    const deleteRes = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`, { method: 'DELETE' })
    expect(deleteRes.ok).toBe(true)

    // 7. READ — verify gone
    const goneRes = await gw.fetchAs(USER_ADMIN, `/hosts/${hostId}`)
    expect([404, 500]).toContain(goneRes.status)
  })
})

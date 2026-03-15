/**
 * Rapid lifecycle tests — quickly creates and destroys sessions
 * to verify no resource leaks (ports, processes, memory).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startJavaGateway, type GatewayHandle } from './helpers.js'
import { WebClient } from './journey-helpers.js'

let gw: GatewayHandle

beforeAll(async () => {
  gw = await startJavaGateway()
}, 60_000)

afterAll(async () => {
  if (gw) await gw.stop()
}, 15_000)

describe('Rapid session lifecycle', () => {
  it('should handle 10 sequential create-message-delete cycles without leaks', async () => {
    const client = new WebClient(gw, 'test-rapid-user', 'universal-agent')
    const results: boolean[] = []

    for (let i = 1; i <= 10; i++) {
      const sessionId = await client.startNewChat()
      const result = await client.sendMessage(
        sessionId,
        `Rapid cycle ${i}: reply with "ok-${i}".`,
      )
      results.push(result.hasFinish && !result.hasError)
      await client.deleteSession(sessionId)
    }

    // All 10 cycles should succeed
    expect(results.every(Boolean)).toBe(true)
    expect(results.length).toBe(10)

    // Gateway should still be healthy
    const statusRes = await gw.fetch('/status')
    expect(statusRes.ok).toBe(true)
  }, 300_000)

  it('should handle 3 concurrent users starting sessions simultaneously', async () => {
    const users = ['rapid-alice', 'rapid-bob', 'rapid-carol']
    const clients = users.map(u => new WebClient(gw, u, 'universal-agent'))

    // All start sessions concurrently
    const sessions = await Promise.all(
      clients.map(c => c.startNewChat()),
    )
    expect(sessions.length).toBe(3)
    sessions.forEach(s => expect(s).toBeTruthy())

    // All send messages concurrently
    const results = await Promise.all(
      clients.map((c, i) =>
        c.sendMessage(sessions[i], `Concurrent test for ${users[i]}: reply "ok".`),
      ),
    )
    results.forEach(r => {
      expect(r.hasFinish).toBe(true)
      expect(r.hasError).toBe(false)
    })

    // All delete sessions concurrently
    await Promise.all(
      clients.map((c, i) => c.deleteSession(sessions[i])),
    )

    // Verify monitoring — running instances for these users should be gone
    // (but the goosed process stays alive until idle-reaped; we check that
    //  no extra instances leaked beyond what's expected)
    const monRes = await gw.fetch('/monitoring/instances')
    expect(monRes.ok).toBe(true)
    const monData = await monRes.json()

    // totalInstances should be reasonable (not growing unboundedly)
    expect(monData.totalInstances).toBeLessThan(20)
  }, 120_000)

  it('should not leak ports after rapid create-destroy', async () => {
    // Record baseline instance count
    const before = await gw.fetch('/monitoring/instances')
    const beforeData = await before.json()
    const baselineCount = beforeData.totalInstances || 0

    const client = new WebClient(gw, 'test-port-leak', 'universal-agent')

    // Rapid create-message-delete cycle (5 times, reusing same user/agent
    // so the same goosed process is reused via getOrSpawn)
    for (let i = 0; i < 5; i++) {
      const sid = await client.startNewChat()
      const res = await client.sendMessage(sid, `Port check ${i}: reply "ok".`)
      expect(res.hasFinish).toBe(true)
      await client.deleteSession(sid)
    }

    // After all cycles, instance count should be at most baseline + 1
    // (the goosed process for test-port-leak should be reused, not spawned 5 times)
    const after = await gw.fetch('/monitoring/instances')
    const afterData = await after.json()
    expect(afterData.totalInstances).toBeLessThanOrEqual(baselineCount + 1)
  }, 180_000)
})

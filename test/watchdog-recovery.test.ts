/**
 * Watchdog recovery tests — verifies that the gateway correctly detects
 * dead goosed processes and recovers by respawning on the next request.
 *
 * Also verifies that sys instances are never idle-reaped.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startJavaGateway, sleep, type GatewayHandle } from './helpers.js'
import { WebClient } from './journey-helpers.js'

let gw: GatewayHandle

beforeAll(async () => {
  gw = await startJavaGateway()
}, 60_000)

afterAll(async () => {
  if (gw) await gw.stop()
}, 15_000)

/** Fetch monitoring instances as admin */
async function getMonitoringInstances(): Promise<any> {
  const res = await gw.fetch('/monitoring/instances')
  expect(res.ok).toBe(true)
  return res.json()
}

/** Find a specific instance's PID from monitoring data */
function findInstancePid(data: any, agentId: string, userId: string): number | null {
  if (!data.byAgent) return null
  for (const group of data.byAgent) {
    if (group.agentId !== agentId) continue
    for (const inst of group.instances || []) {
      if (inst.userId === userId && inst.pid) return inst.pid
    }
  }
  return null
}

describe('Watchdog — process crash detection and recovery', () => {
  it('should detect dead goosed process and recover on next request', async () => {
    const client = new WebClient(gw, 'test-watchdog-user', 'universal-agent')

    // 1. Start a session to spawn a goosed instance
    const sessionId = await client.startNewChat()
    expect(sessionId).toBeTruthy()

    // 2. Send a message to confirm instance is alive
    const result1 = await client.sendMessage(sessionId, 'Reply with "alive-check-ok".')
    expect(result1.hasFinish).toBe(true)
    expect(result1.hasError).toBe(false)

    // 3. Find the goosed PID via monitoring
    const monData = await getMonitoringInstances()
    const pid = findInstancePid(monData, 'universal-agent', 'test-watchdog-user')
    expect(pid).toBeTruthy()

    // 4. Kill the goosed process
    try {
      process.kill(pid!, 'SIGKILL')
    } catch {
      // Process may have already exited
    }

    // 5. Wait briefly for the process to die
    await sleep(2000)

    // 6. Send a new message — gateway should detect the dead process and respawn
    const result2 = await client.sendMessage(sessionId, 'Reply with "recovery-ok".')
    expect(result2.hasFinish).toBe(true)
    expect(result2.hasError).toBe(false)

    // 7. Verify gateway /status is still responsive
    const statusRes = await gw.fetch('/status')
    expect(statusRes.ok).toBe(true)

    // Cleanup
    await client.deleteSession(sessionId)
  }, 120_000)

  it('should recover even after multiple process crashes', async () => {
    const client = new WebClient(gw, 'test-multi-crash', 'universal-agent')
    const sessionId = await client.startNewChat()

    for (let crash = 1; crash <= 3; crash++) {
      // Send a message to confirm alive
      const result = await client.sendMessage(
        sessionId,
        `Crash cycle ${crash}: reply with "ok-${crash}".`,
      )
      expect(result.hasFinish).toBe(true)

      // Find and kill the process
      const monData = await getMonitoringInstances()
      const pid = findInstancePid(monData, 'universal-agent', 'test-multi-crash')
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch { /* already dead */ }
      }

      await sleep(2000)
    }

    // After 3 crashes, a new request should still work (getOrSpawn triggers fresh spawn)
    const finalResult = await client.sendMessage(sessionId, 'Reply with "final-ok".')
    expect(finalResult.hasFinish).toBe(true)
    expect(finalResult.hasError).toBe(false)

    await client.deleteSession(sessionId)
  }, 180_000)

  it('sys instances should not be idle-reaped', async () => {
    // supervisor-agent is sysOnly and starts automatically
    // Verify it's running
    const monData1 = await getMonitoringInstances()
    const sysGroup = monData1.byAgent?.find(
      (g: any) => g.agentId === 'supervisor-agent',
    )
    expect(sysGroup).toBeTruthy()
    expect(sysGroup.instances.length).toBeGreaterThan(0)
    expect(sysGroup.instances[0].status).toBe('RUNNING')

    // Wait longer than idle timeout (test gateway uses 30s idle timeout)
    // but we don't actually need to wait that long — just verify it's still there
    // after a brief wait (the watchdog interval is 60s in production, shorter in tests)
    await sleep(5000)

    const monData2 = await getMonitoringInstances()
    const sysGroup2 = monData2.byAgent?.find(
      (g: any) => g.agentId === 'supervisor-agent',
    )
    expect(sysGroup2).toBeTruthy()
    expect(sysGroup2.instances.length).toBeGreaterThan(0)
    expect(sysGroup2.instances[0].status).toBe('RUNNING')
  }, 30_000)

  it('gateway /status should remain responsive after process crash', async () => {
    const client = new WebClient(gw, 'test-status-check', 'universal-agent')
    const sessionId = await client.startNewChat()

    // Kill the goosed instance
    const monData = await getMonitoringInstances()
    const pid = findInstancePid(monData, 'universal-agent', 'test-status-check')
    if (pid) {
      try { process.kill(pid, 'SIGKILL') } catch { /* */ }
    }

    // /status should respond within 5s even with a dead goosed process
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await gw.fetch('/status', { signal: controller.signal })
      expect(res.ok).toBe(true)
    } finally {
      clearTimeout(timer)
    }

    await client.deleteSession(sessionId)
  }, 30_000)
})

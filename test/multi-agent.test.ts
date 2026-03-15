/**
 * Multi-agent concurrency tests — verifies that the same user can
 * simultaneously use multiple different agents without interference.
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

describe('Multi-agent concurrent usage', () => {
  const USER = 'test-multi-agent-user'
  const AGENT_A = 'universal-agent'
  const AGENT_B = 'kb-agent'

  it('same user can chat with two different agents concurrently', async () => {
    const clientA = new WebClient(gw, USER, AGENT_A)
    const clientB = new WebClient(gw, USER, AGENT_B)

    // Start sessions on both agents concurrently
    const [sessionA, sessionB] = await Promise.all([
      clientA.startNewChat(),
      clientB.startNewChat(),
    ])
    expect(sessionA).toBeTruthy()
    expect(sessionB).toBeTruthy()
    expect(sessionA).not.toBe(sessionB)

    // Send messages to both agents concurrently
    const [resultA, resultB] = await Promise.all([
      clientA.sendMessage(sessionA, 'Reply with only the word "agent-a-ok".'),
      clientB.sendMessage(sessionB, 'Reply with only the word "agent-b-ok".'),
    ])

    expect(resultA.hasFinish).toBe(true)
    expect(resultA.hasError).toBe(false)
    expect(resultB.hasFinish).toBe(true)
    expect(resultB.hasError).toBe(false)

    // Cleanup
    await Promise.all([
      clientA.deleteSession(sessionA),
      clientB.deleteSession(sessionB),
    ])
  }, 120_000)

  it('session lists are isolated per agent', async () => {
    const clientA = new WebClient(gw, USER, AGENT_A)
    const clientB = new WebClient(gw, USER, AGENT_B)

    const sessionA = await clientA.startNewChat()
    const sessionB = await clientB.startNewChat()

    // Each agent's session list should only contain its own session
    const sessionsA = await clientA.listSessions()
    const sessionsB = await clientB.listSessions()

    const sessionAIds = sessionsA.map((s: any) => s.id)
    const sessionBIds = sessionsB.map((s: any) => s.id)

    expect(sessionAIds).toContain(sessionA)
    expect(sessionAIds).not.toContain(sessionB)
    expect(sessionBIds).toContain(sessionB)
    expect(sessionBIds).not.toContain(sessionA)

    // Cleanup
    await Promise.all([
      clientA.deleteSession(sessionA),
      clientB.deleteSession(sessionB),
    ])
  }, 120_000)

  it('working_dir is different per agent', async () => {
    const clientA = new WebClient(gw, USER, AGENT_A)
    const clientB = new WebClient(gw, USER, AGENT_B)

    // Start sessions to get working_dir from the start response
    const startResA = await gw.fetchAs(
      USER,
      `/agents/${AGENT_A}/agent/start`,
      { method: 'POST', body: JSON.stringify({}) },
    )
    const startResB = await gw.fetchAs(
      USER,
      `/agents/${AGENT_B}/agent/start`,
      { method: 'POST', body: JSON.stringify({}) },
    )

    const sessionA = await startResA.json()
    const sessionB = await startResB.json()

    expect(sessionA.working_dir).toContain(AGENT_A)
    expect(sessionB.working_dir).toContain(AGENT_B)
    expect(sessionA.working_dir).not.toBe(sessionB.working_dir)

    // Both should contain the same user ID
    expect(sessionA.working_dir).toContain(USER)
    expect(sessionB.working_dir).toContain(USER)

    // Cleanup
    await gw.fetchAs(USER, `/agents/${AGENT_A}/sessions/${sessionA.id}`, { method: 'DELETE' })
    await gw.fetchAs(USER, `/agents/${AGENT_B}/sessions/${sessionB.id}`, { method: 'DELETE' })
  }, 60_000)

  it('monitoring shows instances from different agents', async () => {
    const clientA = new WebClient(gw, USER, AGENT_A)
    const clientB = new WebClient(gw, USER, AGENT_B)

    const sessionA = await clientA.startNewChat()
    const sessionB = await clientB.startNewChat()

    // Check monitoring
    const res = await gw.fetch('/monitoring/instances')
    expect(res.ok).toBe(true)
    const monData = await res.json()

    // Both agents should appear in byAgent
    const agentIds = monData.byAgent?.map((g: any) => g.agentId) || []
    expect(agentIds).toContain(AGENT_A)
    expect(agentIds).toContain(AGENT_B)

    // The user should have instances in both agent groups
    for (const agentId of [AGENT_A, AGENT_B]) {
      const group = monData.byAgent.find((g: any) => g.agentId === agentId)
      const userInst = group?.instances?.find((i: any) => i.userId === USER)
      expect(userInst).toBeTruthy()
      expect(userInst.status).toBe('RUNNING')
    }

    // Cleanup
    await Promise.all([
      clientA.deleteSession(sessionA),
      clientB.deleteSession(sessionB),
    ])
  }, 120_000)
})

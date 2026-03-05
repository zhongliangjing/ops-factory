import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GoosedClient } from '../typescript-sdk/src/client.js'
import { startMockGateway, type GatewayHandle } from './helpers.js'

const AGENT_ID = 'universal-agent'
const USER_ID = 'mock-alice'

let gateway: GatewayHandle

function collectAssistantText(events: Array<Record<string, unknown>>): string {
  return events
    .filter(event => event.type === 'Message')
    .flatMap(event => {
      const message = event.message as { content?: Array<{ type: string; text?: string }> } | undefined
      return (message?.content || []).filter(item => item.type === 'text').map(item => item.text || '')
    })
    .join('')
}

describe('Mock gateway contract', () => {
  beforeAll(async () => {
    gateway = await startMockGateway()
  }, 20_000)

  afterAll(async () => {
    if (gateway) {
      await gateway.stop()
    }
  })

  it('serves auth-gated webapp bootstrap endpoints', async () => {
    const status = await gateway.fetch('/status')
    expect(status.status).toBe(200)
    expect(await status.text()).toBe('ok')

    const me = await gateway.fetchAs(USER_ID, '/me')
    expect(await me.json()).toEqual({ userId: USER_ID, role: 'user' })

    const agents = await gateway.fetchAs(USER_ID, '/agents')
    const payload = await agents.json() as { agents: Array<{ id: string }> }
    expect(payload.agents.map(agent => agent.id)).toEqual([
      'universal-agent',
      'kb-agent',
      'report-agent',
    ])
    // working_dir is no longer in agent listing — it's set by gateway on session creation

    const config = await gateway.fetch('/config')
    const configPayload = await config.json() as { officePreview: { enabled: boolean } }
    expect(configPayload.officePreview.enabled).toBe(false)
  })

  it('supports minimal SDK session lifecycle and streaming reply', async () => {
    const client = new GoosedClient({
      baseUrl: `${gateway.baseUrl}/agents/${AGENT_ID}`,
      secretKey: gateway.secretKey,
      userId: USER_ID,
      timeout: 10_000,
    })

    const info = await client.systemInfo()
    expect(info.provider).toBe('mock-openai')
    expect(info.model).toBe('gpt-4.1-mini')

    const session = await client.startSession()
    // working_dir is set by gateway, not client — verify it uses the correct per-user path
    expect(session.working_dir).toContain(USER_ID)
    expect(session.working_dir).toContain(AGENT_ID)

    const resumed = await client.resumeSession(session.id)
    expect(resumed.session.id).toBe(session.id)
    expect(resumed.extensionResults).toEqual([])

    const events: Array<Record<string, unknown>> = []
    for await (const event of client.sendMessage(session.id, 'Summarize the incident.')) {
      events.push(event as unknown as Record<string, unknown>)
    }

    const assistantText = collectAssistantText(events)
    expect(assistantText).toContain('Mock reply from universal-agent.')
    expect(events.some(event => event.type === 'Finish')).toBe(true)

    const storedSession = await client.getSession(session.id)
    expect(storedSession.conversation).toHaveLength(2)
    expect(storedSession.message_count).toBe(2)

    const sessions = await client.listSessions()
    expect(sessions.some(item => item.id === session.id)).toBe(true)

    await client.updateSessionName(session.id, 'Renamed mock session')
    const renamed = await client.getSession(session.id)
    expect(renamed.name).toBe('Renamed mock session')

    const exported = await client.exportSession(session.id)
    expect(exported).toContain('USER:')

    await client.deleteSession(session.id)
    await expect(client.getSession(session.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('supports webapp-facing config, prompt, files, mcp, upload, and schedule endpoints', async () => {
    const client = new GoosedClient({
      baseUrl: `${gateway.baseUrl}/agents/${AGENT_ID}`,
      secretKey: gateway.secretKey,
      userId: USER_ID,
      timeout: 10_000,
    })

    const configRes = await gateway.fetchAs(USER_ID, `/agents/${AGENT_ID}/config`)
    const config = await configRes.json() as { id: string; agentsMd: string; visionMode?: string }
    expect(config.id).toBe(AGENT_ID)
    expect(config.agentsMd).toContain('mock agent')
    expect(config.visionMode).toBe('passthrough')

    const prompts = await client.listPrompts()
    expect(prompts.length).toBeGreaterThan(0)
    expect(prompts[0]?.is_customized).toBe(false)

    const prompt = await client.getPrompt('system')
    expect(prompt.content).toContain('mock gateway')

    await client.savePrompt('system', 'Customized prompt content')
    const customized = await client.getPrompt('system')
    expect(customized.is_customized).toBe(true)
    expect(customized.content).toBe('Customized prompt content')

    await client.resetPrompt('system')
    const reset = await client.getPrompt('system')
    expect(reset.is_customized).toBe(false)

    const mcpList = await gateway.fetchAs(USER_ID, `/agents/${AGENT_ID}/mcp`)
    const mcpPayload = await mcpList.json() as { extensions: Array<{ name: string }> }
    expect(mcpPayload.extensions.some(item => item.name === 'filesystem')).toBe(true)

    await gateway.fetchAs(USER_ID, `/agents/${AGENT_ID}/mcp`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'jira',
        enabled: true,
        config: { type: 'streamable_http', description: 'Jira MCP', uri: 'https://mock.invalid/jira' },
      }),
    })
    const mcpAfterAdd = await gateway.fetchAs(USER_ID, `/agents/${AGENT_ID}/mcp`)
    const mcpAfterPayload = await mcpAfterAdd.json() as { extensions: Array<{ name: string }> }
    expect(mcpAfterPayload.extensions.some(item => item.name === 'jira')).toBe(true)

    const upload = await client.uploadFile(
      new File(['hello from test'], 'notes.txt', { type: 'text/plain' }),
      'session-upload',
    )
    expect(upload.path).toContain('uploads/')

    const files = await gateway.fetchAs(USER_ID, `/agents/${AGENT_ID}/files`)
    const filePayload = await files.json() as { files: Array<{ path: string }> }
    expect(filePayload.files.some(file => file.path === upload.path)).toBe(true)

    const downloaded = await gateway.fetch(`/agents/${AGENT_ID}/files/${encodeURIComponent(upload.path)}?key=${gateway.secretKey}`)
    expect(await downloaded.text()).toContain('Uploaded via mock gateway')

    const skills = await gateway.fetchAs(USER_ID, `/agents/${AGENT_ID}/skills`)
    const skillPayload = await skills.json() as { skills: Array<{ name: string }> }
    expect(skillPayload.skills.length).toBeGreaterThan(0)

    const createdSchedule = await client.createSchedule({
      id: 'daily-summary',
      cron: '0 0 9 * * *',
      recipe: {
        title: 'Daily summary',
        description: 'Mock schedule',
        instructions: 'Summarize the latest changes',
      },
    })
    expect(createdSchedule.id).toBe('daily-summary')

    const schedules = await client.listSchedules()
    expect(schedules.some(item => item.id === 'daily-summary')).toBe(true)

    const runSessionId = await client.runScheduleNow('daily-summary')
    expect(runSessionId).toMatch(/^session-/)

    const scheduleRuns = await client.listScheduleSessions('daily-summary', 10)
    expect(scheduleRuns[0]?.id).toBe(runSessionId)

    await client.pauseSchedule('daily-summary')
    await client.unpauseSchedule('daily-summary')
    const inspect = await client.inspectSchedule('daily-summary')
    expect(inspect.sessionId).toBe(runSessionId)

    await client.deleteSchedule('daily-summary')
    const afterDelete = await client.listSchedules()
    expect(afterDelete.some(item => item.id === 'daily-summary')).toBe(false)
  })
})

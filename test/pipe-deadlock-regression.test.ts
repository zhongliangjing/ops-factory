/**
 * Pipe deadlock regression test.
 *
 * Root cause (previously fixed): goosed's tracing subscriber writes every log
 * to both file AND stderr. When the gateway didn't drain the stderr pipe,
 * the ~64KB pipe buffer would fill up, goosed's write(stderr) would block
 * a tokio worker thread, freezing the entire runtime.
 *
 * This test verifies the fix holds by:
 * 1. Starting a gateway (which drains goosed's stdout/stderr in a daemon thread)
 * 2. Sending multiple messages that trigger tool calls (generating verbose logs)
 * 3. Verifying /status remains responsive throughout
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

/** Check that /status responds within a timeout */
async function assertStatusResponsive(timeoutMs = 5000): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await gw.fetch('/status', { signal: controller.signal })
    expect(res.ok).toBe(true)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Gateway /status did not respond within ${timeoutMs}ms — possible deadlock!`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

describe('Pipe deadlock regression', () => {
  it('gateway stays responsive under high log output from tool calls', async () => {
    const client = new WebClient(gw, 'test-pipe-user', 'universal-agent')
    const sessionId = await client.startNewChat()

    // Verify baseline responsiveness
    await assertStatusResponsive()

    // Send 5 messages that trigger tool calls (shell commands generate lots of logs)
    const toolPrompts = [
      'List all files in the current directory recursively.',
      'Run: echo "test-1" && ls -la && echo "test-2" && date',
      'Run: for i in 1 2 3 4 5; do echo "iteration $i"; done',
      'Show the contents of the current working directory.',
      'Run: echo "final check" && pwd && whoami',
    ]

    for (let i = 0; i < toolPrompts.length; i++) {
      const result = await client.sendMessage(sessionId, toolPrompts[i])
      expect(result.hasFinish).toBe(true)

      // Check /status is still responsive after each message
      await assertStatusResponsive()
    }

    await client.deleteSession(sessionId)
  }, 300_000)

  it('gateway stays responsive through 10 rounds of conversation', async () => {
    const client = new WebClient(gw, 'test-pipe-long', 'universal-agent')
    const sessionId = await client.startNewChat()

    for (let round = 1; round <= 10; round++) {
      const prompt = round % 3 === 0
        ? `Round ${round}: Run the command "echo round-${round}-ok".`
        : `Round ${round}: What is ${round} times ${round}? Reply with just the number.`

      const result = await client.sendMessage(sessionId, prompt)
      expect(result.hasFinish).toBe(true)
      expect(result.hasError).toBe(false)
    }

    // Final responsiveness check
    await assertStatusResponsive()

    await client.deleteSession(sessionId)
  }, 300_000)
})

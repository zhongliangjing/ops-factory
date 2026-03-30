/**
 * QA Agent knowledge regression
 *
 * Runs a single 50-turn conversation against the real QA Agent and validates:
 * - every round triggers knowledge-service search
 * - fetch is used on fact-style questions
 * - search top hits stay aligned with the target document
 * - answers contain expected factual keywords and citations
 * - tool execution success rates stay at the configured threshold
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import net from 'node:net'

import { type GatewayHandle, sleep } from './helpers.js'
import { qaKnowledgeRegressionCases } from './qa-agent-knowledge-regression.cases.js'

const AGENT_ID = 'qa-agent'
const USER_SYS = 'admin'
const SECRET_KEY = 'test-secret'
const PROJECT_ROOT = join(import.meta.dirname, '..')
const MCP_DIR = join(PROJECT_ROOT, 'gateway', 'agents', 'qa-agent', 'config', 'mcp', 'knowledge-service')
const REPORT_DIR = join(PROJECT_ROOT, 'test', 'report')
const MIN_TOOL_SUCCESS_RATE = Number(process.env.QA_KNOWLEDGE_MIN_TOOL_SUCCESS_RATE || '1')
const MIN_CITATION_RATE = Number(process.env.QA_KNOWLEDGE_MIN_CITATION_RATE || '0')
const ROUND_TIMEOUT_MS = Number(process.env.QA_KNOWLEDGE_ROUND_TIMEOUT_MS || '120000')
const ROUND_LIMIT = Number(process.env.QA_KNOWLEDGE_ROUND_LIMIT || String(qaKnowledgeRegressionCases.length))

let gw: GatewayHandle

interface ToolRequestRecord {
  id: string
  name: string
  args: Record<string, unknown>
}

interface ToolResponseRecord {
  id: string
  name: string
  status: string
  data: Record<string, any> | null
}

interface RoundReport {
  id: string
  prompt: string
  searchCalls: number
  searchSuccesses: number
  fetchCalls: number
  fetchSuccesses: number
  citationCount: number
  topHits: string[]
  answerPreview: string
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function startQaJavaGateway(): Promise<GatewayHandle> {
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}/ops-gateway`

  const jarPath = join(PROJECT_ROOT, 'gateway', 'gateway-service', 'target', 'gateway-service.jar')
  const libDir = join(PROJECT_ROOT, 'gateway', 'gateway-service', 'target', 'lib')
  const log4jConfig = join(PROJECT_ROOT, 'gateway', 'gateway-service', 'target', 'resources', 'log4j2.xml')

  const child = spawn('java', [
    `-Dloader.path=${libDir}`,
    `-Dserver.port=${port}`,
    '-Dserver.address=127.0.0.1',
    `-Dgateway.secret-key=${SECRET_KEY}`,
    `-Dgateway.goosed-bin=${process.env.GOOSED_BIN || 'goosed'}`,
    '-Dgateway.goosed-tls=true',
    `-Dgateway.paths.project-root=${PROJECT_ROOT}`,
    '-Dgateway.cors-origin=*',
    '-Dgateway.limits.max-instances-per-user=20',
    '-Dgateway.limits.max-instances-global=100',
    `-Dlogging.config=file:${log4jConfig}`,
    '-jar', jarPath,
  ], {
    cwd: join(PROJECT_ROOT, 'gateway'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const logs: string[] = []
  child.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    if (line) logs.push(`[gw:out] ${line}`)
  })
  child.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim()
    if (line) logs.push(`[gw:err] ${line}`)
  })

  const waitUntilReady = async () => {
    const maxWait = 30_000
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      try {
        const res = await fetch(`${baseUrl}/status`, {
          headers: { 'x-secret-key': SECRET_KEY },
          signal: AbortSignal.timeout(2_000),
        })
        if (res.ok) return
      } catch {
        // ignore
      }
      await sleep(500)
    }
    throw new Error(`Gateway failed to start\n${logs.join('\n')}`)
  }

  await waitUntilReady()

  const headers = (userId?: string) => {
    const h: Record<string, string> = {
      'x-secret-key': SECRET_KEY,
      'Content-Type': 'application/json',
    }
    if (userId) h['x-user-id'] = userId
    return h
  }

  return {
    port,
    baseUrl,
    secretKey: SECRET_KEY,
    process: child,
    logs,
    fetch: (path, init) =>
      fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers('admin'), ...init?.headers } }),
    fetchAs: (userId, path, init) =>
      fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers(userId), ...init?.headers } }),
    stop: async () => {
      child.kill('SIGTERM')
      await sleep(3_000)
      if (!child.killed) child.kill('SIGKILL')
      await sleep(500)
    },
  }
}

function makeUserMessage(text: string) {
  return {
    role: 'user',
    created: Math.floor(Date.now() / 1000),
    content: [{ type: 'text', text }],
    metadata: { userVisible: true, agentVisible: true },
  }
}

function parseSseEvents(body: string): Array<Record<string, any>> {
  return body
    .split('\n\n')
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .flatMap(chunk => {
      const data = chunk
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.replace(/^data:\s*/, ''))
        .join('\n')
      if (!data) return []
      try {
        return [JSON.parse(data)]
      } catch {
        return []
      }
    })
}

function unwrapToolResult(value: unknown): Record<string, any> | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  const obj = value as Record<string, unknown>
  if (Array.isArray(obj.content)) {
    for (const item of obj.content) {
      const record = item as Record<string, unknown>
      if (record.type === 'text' && typeof record.text === 'string') {
        try {
          return JSON.parse(record.text)
        } catch {
          return null
        }
      }
    }
  }

  return obj as Record<string, any>
}

function collectAssistantText(events: Array<Record<string, any>>): string {
  return events
    .filter(event => event.type === 'Message' && event.message)
    .flatMap(event => (event.message.content || []) as Array<{ type: string; text?: string }>)
    .filter(content => content.type === 'text' && typeof content.text === 'string')
    .map(content => content.text || '')
    .join('')
}

function extractToolRecords(events: Array<Record<string, any>>) {
  const requests = new Map<string, ToolRequestRecord>()
  const responses: ToolResponseRecord[] = []

  for (const event of events) {
    if (event.type !== 'Message' || !event.message?.content) continue
    for (const content of event.message.content as Array<Record<string, any>>) {
      if (content.type === 'toolRequest' && content.id) {
        const name = content.toolCall?.value?.name || content.toolCall?.name || ''
        requests.set(content.id, {
          id: content.id,
          name,
          args: (content.toolCall?.value?.arguments || content.toolCall?.arguments || {}) as Record<string, unknown>,
        })
      }
      if (content.type === 'toolResponse' && content.id) {
        const req = requests.get(content.id)
        responses.push({
          id: content.id,
          name: req?.name || '',
          status: content.toolResult?.status || 'unknown',
          data: unwrapToolResult(content.toolResult?.value),
        })
      }
    }
  }

  return {
    requests: Array.from(requests.values()),
    responses,
  }
}

function stripCitations(text: string): string {
  return text.replace(/\{\{cite:[^}]+\}\}/g, '')
}

function countCitations(text: string): number {
  return (text.match(/\{\{cite:[^}]+\}\}/g) || []).length
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[“”"'`]/g, '')
    .replace(/[（）()【】\[\]<>]/g, '')
    .replace(/[，。,:：;；!?！？/\\|+-]/g, '')
}

function containsKeyword(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle))
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function buildRoundPrompt(prompt: string, mustUseFetch: boolean): string {
  const instructions = [
    '请每次都重新检索知识库，不要只依赖当前会话里之前轮次的记忆。',
    mustUseFetch ? '请至少 fetch 1 个最相关 chunk 的完整内容后再回答。' : '',
    '回答保持简洁，并尽量保留 citation 标记。',
  ].filter(Boolean)

  return `${prompt}\n\n${instructions.join(' ')}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatTimestamp(date = new Date()): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
}

function formatHumanTime(date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const hh = pad2(Math.floor(abs / 60))
  const mm = pad2(abs % 60)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${sign}${hh}:${mm}`
}

function writeRegressionReport(payload: {
  startedAt: string
  finishedAt: string
  status: 'passed' | 'failed'
  roundsPlanned: number
  roundsCompleted: number
  roundLimit: number
  toolSuccessRate: number
  searchSuccessRate: number
  fetchSuccessRate: number
  citationRate: number
  reports: RoundReport[]
  failureMessage?: string
}): { markdownPath: string; jsonPath: string } {
  mkdirSync(REPORT_DIR, { recursive: true })

  const stamp = formatTimestamp()
  const markdownPath = join(REPORT_DIR, `qa-agent-knowledge-regression-report_${stamp}.md`)
  const jsonPath = join(REPORT_DIR, `qa-agent-knowledge-regression-report_${stamp}.json`)

  const markdown = [
    '# QA Agent Knowledge Regression Report',
    '',
    `- 生成时间：${payload.finishedAt}`,
    `- 状态：${payload.status}`,
    `- 计划轮次：${payload.roundsPlanned}`,
    `- 已完成轮次：${payload.roundsCompleted}`,
    `- 执行轮次上限：${payload.roundLimit}`,
    `- Tool 成功率：${(payload.toolSuccessRate * 100).toFixed(2)}%`,
    `- Search 成功率：${(payload.searchSuccessRate * 100).toFixed(2)}%`,
    `- Fetch 成功率：${(payload.fetchSuccessRate * 100).toFixed(2)}%`,
    `- Citation 覆盖率：${(payload.citationRate * 100).toFixed(2)}%`,
    `- Markdown 报告路径：\`${markdownPath}\``,
    `- JSON 报告路径：\`${jsonPath}\``,
    payload.failureMessage ? `- 失败原因：${payload.failureMessage}` : '',
    '',
    '## 逐轮结果',
    '',
    '| Round | Search | Fetch | Citations | Top Hits | Answer Preview |',
    '| --- | --- | --- | --- | --- | --- |',
    ...payload.reports.map(report => {
      const topHits = report.topHits.join(' / ').replace(/\|/g, '\\|')
      const answer = report.answerPreview.replace(/\n/g, ' ').replace(/\|/g, '\\|')
      return `| ${report.id} | ${report.searchSuccesses}/${report.searchCalls} | ${report.fetchSuccesses}/${report.fetchCalls} | ${report.citationCount} | ${topHits} | ${answer} |`
    }),
    '',
  ].filter(Boolean).join('\n')

  writeFileSync(markdownPath, markdown, 'utf-8')
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8')

  return { markdownPath, jsonPath }
}

async function createSession(handle: GatewayHandle, userId: string, agentId: string): Promise<string> {
  const startRes = await handle.fetchAs(userId, `/agents/${agentId}/agent/start`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  expect(startRes.ok).toBe(true)
  const session = await startRes.json()
  const sessionId = session.id as string

  const resumeRes = await handle.fetchAs(userId, `/agents/${agentId}/agent/resume`, {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, load_model_and_extensions: true }),
  })
  expect(resumeRes.ok).toBe(true)
  return sessionId
}

async function sendReplyAndWait(
  handle: GatewayHandle,
  userId: string,
  agentId: string,
  sessionId: string,
  message: string,
  timeoutMs = ROUND_TIMEOUT_MS,
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
    return await res.text()
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

beforeAll(async () => {
  if (!existsSync(join(MCP_DIR, 'node_modules'))) {
    execFileSync('npm', ['install'], { cwd: MCP_DIR, stdio: 'inherit' })
  }
  execFileSync('npm', ['run', 'build'], { cwd: MCP_DIR, stdio: 'inherit' })
  gw = await startQaJavaGateway()
  await sleep(2_000)
}, 90_000)

afterAll(async () => {
  if (gw) await gw.stop()
}, 20_000)

describe('qa-agent knowledge regression', () => {
  it('runs the multi-turn knowledge regression and records tool success metrics', async () => {
    const cases = qaKnowledgeRegressionCases.slice(0, ROUND_LIMIT)
    const sessionId = await createSession(gw, USER_SYS, AGENT_ID)
    const reports: RoundReport[] = []
    const startedAt = formatHumanTime()

    let totalToolResponses = 0
    let successfulToolResponses = 0
    let totalSearchResponses = 0
    let successfulSearchResponses = 0
    let totalFetchResponses = 0
    let successfulFetchResponses = 0
    let roundsWithCitations = 0
    try {
      for (const testCase of cases) {
        const roundPrompt = buildRoundPrompt(testCase.prompt, testCase.mustUseFetch)
        const replyBody = await sendReplyAndWait(gw, USER_SYS, AGENT_ID, sessionId, roundPrompt)
        assertCondition(replyBody.length > 0, `[${testCase.id}] empty SSE response`)

        const events = parseSseEvents(replyBody)
        const assistantText = collectAssistantText(events)
        const answerText = stripCitations(assistantText)
        const citationCount = countCitations(assistantText)
        const { requests, responses } = extractToolRecords(events)

        const searchRequests = requests.filter(req => req.name.includes('search'))
        const searchResponses = responses.filter(res => res.name.includes('search'))
        const fetchResponses = responses.filter(res => res.name.includes('fetch') && !res.name.includes('search'))
        const successfulSearch = searchResponses.filter(res => res.status === 'success')
        const successfulFetch = fetchResponses.filter(res => res.status === 'success')

        totalToolResponses += responses.length
        successfulToolResponses += responses.filter(res => res.status === 'success').length
        totalSearchResponses += searchResponses.length
        successfulSearchResponses += successfulSearch.length
        totalFetchResponses += fetchResponses.length
        successfulFetchResponses += successfulFetch.length

        assertCondition(searchRequests.length > 0, `[${testCase.id}] expected at least one search tool request`)
        assertCondition(searchResponses.length > 0, `[${testCase.id}] expected at least one search tool response`)
        assertCondition(searchResponses.every(res => res.status === 'success'), `[${testCase.id}] search tool returned non-success status`)

        if (testCase.mustUseFetch) {
          assertCondition(fetchResponses.length > 0, `[${testCase.id}] expected at least one fetch tool response`)
          assertCondition(fetchResponses.every(res => res.status === 'success'), `[${testCase.id}] fetch tool returned non-success status`)
        }

        const firstSearchHits = Array.isArray(successfulSearch[0]?.data?.hits) ? successfulSearch[0]!.data!.hits : []
        const topHits = firstSearchHits
          .slice(0, 3)
          .map((hit: Record<string, any>) => String(hit.title || hit.snippet || hit.chunkId || ''))

        assertCondition(topHits.length > 0, `[${testCase.id}] search returned no top hits`)
        assertCondition(
          topHits.some(hit => testCase.expectedTopHitKeywords.some(keyword => containsKeyword(hit, keyword))),
          `[${testCase.id}] top 3 hits did not match expected doc ${testCase.expectedDocTitle}; got ${JSON.stringify(topHits)}`,
        )

        assertCondition(assistantText.length > 0, `[${testCase.id}] assistant returned empty text`)
        if (citationCount > 0) roundsWithCitations++

        for (const keyword of testCase.expectedAnswerKeywords) {
          assertCondition(
            containsKeyword(answerText, keyword),
            `[${testCase.id}] answer missing keyword "${keyword}". answer=${answerText}`,
          )
        }

        reports.push({
          id: testCase.id,
          prompt: roundPrompt,
          searchCalls: searchResponses.length,
          searchSuccesses: successfulSearch.length,
          fetchCalls: fetchResponses.length,
          fetchSuccesses: successfulFetch.length,
          citationCount,
          topHits,
          answerPreview: answerText.slice(0, 220),
        })
      }

      const toolSuccessRate = totalToolResponses > 0 ? successfulToolResponses / totalToolResponses : 0
      const searchSuccessRate = totalSearchResponses > 0 ? successfulSearchResponses / totalSearchResponses : 0
      const fetchSuccessRate = totalFetchResponses > 0 ? successfulFetchResponses / totalFetchResponses : 1
      const citationRate = reports.length > 0 ? roundsWithCitations / reports.length : 0
      const finishedAt = formatHumanTime()
      const reportPaths = writeRegressionReport({
        startedAt,
        finishedAt,
        status: 'passed',
        roundsPlanned: cases.length,
        roundsCompleted: reports.length,
        roundLimit: ROUND_LIMIT,
        toolSuccessRate,
        searchSuccessRate,
        fetchSuccessRate,
        citationRate,
        reports,
      })

      console.info(JSON.stringify({
        suite: 'qa-agent knowledge regression',
        rounds: reports.length,
        toolSuccessRate,
        searchSuccessRate,
        fetchSuccessRate,
        citationRate,
        reportPaths,
        reports,
      }, null, 2))

      expect(toolSuccessRate).toBeGreaterThanOrEqual(MIN_TOOL_SUCCESS_RATE)
      expect(searchSuccessRate).toBeGreaterThanOrEqual(MIN_TOOL_SUCCESS_RATE)
      expect(fetchSuccessRate).toBeGreaterThanOrEqual(MIN_TOOL_SUCCESS_RATE)
      expect(citationRate).toBeGreaterThanOrEqual(MIN_CITATION_RATE)
    } catch (error) {
      const toolSuccessRate = totalToolResponses > 0 ? successfulToolResponses / totalToolResponses : 0
      const searchSuccessRate = totalSearchResponses > 0 ? successfulSearchResponses / totalSearchResponses : 0
      const fetchSuccessRate = totalFetchResponses > 0 ? successfulFetchResponses / totalFetchResponses : 1
      const citationRate = reports.length > 0 ? roundsWithCitations / reports.length : 0
      const finishedAt = formatHumanTime()
      const failureMessage = error instanceof Error ? error.message : String(error)
      const reportPaths = writeRegressionReport({
        startedAt,
        finishedAt,
        status: 'failed',
        roundsPlanned: cases.length,
        roundsCompleted: reports.length,
        roundLimit: ROUND_LIMIT,
        toolSuccessRate,
        searchSuccessRate,
        fetchSuccessRate,
        citationRate,
        reports,
        failureMessage,
      })

      console.info(JSON.stringify({
        suite: 'qa-agent knowledge regression',
        status: 'failed',
        reportPaths,
        failureMessage,
        roundsCompleted: reports.length,
      }, null, 2))
      throw error
    }
  }, 30 * 60 * 1000)
})

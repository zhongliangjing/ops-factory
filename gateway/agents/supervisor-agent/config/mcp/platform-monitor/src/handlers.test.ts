import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Mock fetch before importing handlers
// ---------------------------------------------------------------------------

type FetchFn = typeof globalThis.fetch

// Route map: URL path → response body
let routes: Record<string, unknown> = {}

function mockFetch(input: string | URL | Request, _init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url)
  const path = url.pathname

  if (path in routes) {
    return Promise.resolve(new Response(JSON.stringify(routes[path]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  }

  return Promise.resolve(new Response(`Not found: ${path}`, { status: 404 }))
}

let originalFetch: FetchFn

beforeEach(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as FetchFn
  routes = {}
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ---------------------------------------------------------------------------
// Import handlers (after mock setup — config reads env at import time but
// fetch is called at runtime, so our beforeEach swap works)
// ---------------------------------------------------------------------------

const {
  tools,
  dispatch,
  handleGetPlatformStatus,
  handleGetAgentsStatus,
  handleGetObservabilityData,
  handleGetRealtimeMetrics,
  gw,
} = await import('./handlers.js')

// ===========================================================================
// Tests
// ===========================================================================

describe('tool definitions', () => {
  it('should define 4 tools', () => {
    assert.equal(tools.length, 4)
    const names = tools.map(t => t.name)
    assert.deepStrictEqual(names, [
      'get_platform_status',
      'get_agents_status',
      'get_observability_data',
      'get_realtime_metrics',
    ])
  })

  it('get_realtime_metrics should have empty properties (no params)', () => {
    const tool = tools.find(t => t.name === 'get_realtime_metrics')!
    assert.deepStrictEqual(tool.inputSchema.properties, {})
  })

  it('get_observability_data should accept hours param', () => {
    const tool = tools.find(t => t.name === 'get_observability_data')!
    assert.ok('hours' in tool.inputSchema.properties)
  })
})

describe('gw() helper', () => {
  it('should fetch and parse JSON', async () => {
    routes['/test'] = { ok: true }
    const result = await gw<{ ok: boolean }>('/test')
    assert.deepStrictEqual(result, { ok: true })
  })

  it('should append query params', async () => {
    // Capture the URL that was fetched
    let capturedUrl: URL | undefined
    const origMock = globalThis.fetch
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url)
      capturedUrl = url
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    }) as FetchFn

    await gw('/test', { foo: 'bar', baz: '123' })
    assert.ok(capturedUrl)
    assert.equal(capturedUrl!.searchParams.get('foo'), 'bar')
    assert.equal(capturedUrl!.searchParams.get('baz'), '123')

    globalThis.fetch = origMock
  })

  it('should throw on non-ok response', async () => {
    routes = {} // no route → 404
    await assert.rejects(
      () => gw('/missing'),
      (err: Error) => {
        assert.ok(err.message.includes('404'))
        return true
      },
    )
  })
})

describe('handleGetPlatformStatus', () => {
  it('should combine /monitoring/system and /monitoring/instances', async () => {
    routes['/monitoring/system'] = { gateway: { uptimeMs: 1000 } }
    routes['/monitoring/instances'] = { totalInstances: 3 }

    const result = JSON.parse(await handleGetPlatformStatus())
    assert.deepStrictEqual(result.system, { gateway: { uptimeMs: 1000 } })
    assert.deepStrictEqual(result.instances, { totalInstances: 3 })
  })
})

describe('handleGetAgentsStatus', () => {
  it('should combine /agents and /monitoring/instances', async () => {
    routes['/agents'] = [{ id: 'agent-1' }]
    routes['/monitoring/instances'] = { totalInstances: 1 }

    const result = JSON.parse(await handleGetAgentsStatus())
    assert.deepStrictEqual(result.agents, [{ id: 'agent-1' }])
    assert.deepStrictEqual(result.instances, { totalInstances: 1 })
  })
})

describe('handleGetObservabilityData', () => {
  it('should return error when Langfuse is not enabled', async () => {
    routes['/monitoring/status'] = { enabled: false }

    const result = JSON.parse(await handleGetObservabilityData(24))
    assert.ok(result.error.includes('not configured'))
    assert.equal(result.status.enabled, false)
  })

  it('should return error when Langfuse is not reachable', async () => {
    routes['/monitoring/status'] = { enabled: true, reachable: false, host: 'http://langfuse:3000' }

    const result = JSON.parse(await handleGetObservabilityData(24))
    assert.ok(result.error.includes('not reachable'))
  })

  it('should fetch overview/traces/observations when Langfuse is available', async () => {
    routes['/monitoring/status'] = { enabled: true, reachable: true, host: 'http://langfuse:3000' }
    routes['/monitoring/overview'] = { totalTraces: 100 }
    routes['/monitoring/traces'] = [{ id: 'trace-1' }]
    routes['/monitoring/observations'] = { breakdown: [] }

    const result = JSON.parse(await handleGetObservabilityData(12))
    assert.equal(result.timeRange.hours, 12)
    assert.deepStrictEqual(result.overview, { totalTraces: 100 })
    assert.deepStrictEqual(result.traces, [{ id: 'trace-1' }])
    assert.deepStrictEqual(result.observations, { breakdown: [] })
  })
})

describe('handleGetRealtimeMetrics', () => {
  it('should fetch /monitoring/metrics and return JSON', async () => {
    const metricsData = {
      collectionIntervalSec: 30,
      maxSlots: 120,
      returnedSlots: 2,
      current: { activeInstances: 5, totalTokens: 1234, totalSessions: 10 },
      aggregate: {
        totalRequests: 50,
        totalErrors: 1,
        avgLatencyMs: 320.5,
        avgTtftMs: 120.3,
        avgTokensPerSec: 15.2,
        p95LatencyMs: 890.0,
        p95TtftMs: 350.0,
      },
      series: [
        { t: 1710000000000, instances: 5, tokens: 1000, requests: 20 },
        { t: 1710000030000, instances: 5, tokens: 1234, requests: 30 },
      ],
      agentMetrics: { 'agent-1': { requests: 30, errors: 0 } },
    }
    routes['/monitoring/metrics'] = metricsData

    const result = JSON.parse(await handleGetRealtimeMetrics())
    assert.equal(result.collectionIntervalSec, 30)
    assert.equal(result.current.activeInstances, 5)
    assert.equal(result.aggregate.totalRequests, 50)
    assert.equal(result.aggregate.p95LatencyMs, 890.0)
    assert.equal(result.series.length, 2)
    assert.deepStrictEqual(result.agentMetrics['agent-1'], { requests: 30, errors: 0 })
  })
})

describe('dispatch', () => {
  it('should route get_platform_status', async () => {
    routes['/monitoring/system'] = { up: true }
    routes['/monitoring/instances'] = { total: 0 }

    const result = JSON.parse(await dispatch('get_platform_status', {}))
    assert.ok('system' in result)
    assert.ok('instances' in result)
  })

  it('should route get_agents_status', async () => {
    routes['/agents'] = []
    routes['/monitoring/instances'] = { total: 0 }

    const result = JSON.parse(await dispatch('get_agents_status', {}))
    assert.ok('agents' in result)
  })

  it('should route get_observability_data with default hours', async () => {
    routes['/monitoring/status'] = { enabled: false }

    const result = JSON.parse(await dispatch('get_observability_data', {}))
    assert.ok(result.error) // Langfuse not configured
  })

  it('should route get_observability_data with custom hours', async () => {
    routes['/monitoring/status'] = { enabled: false }

    const result = JSON.parse(await dispatch('get_observability_data', { hours: 48 }))
    assert.ok(result.error)
  })

  it('should route get_realtime_metrics', async () => {
    routes['/monitoring/metrics'] = { collectionIntervalSec: 30, series: [] }

    const result = JSON.parse(await dispatch('get_realtime_metrics', {}))
    assert.equal(result.collectionIntervalSec, 30)
  })

  it('should throw on unknown tool', async () => {
    await assert.rejects(
      () => dispatch('unknown_tool', {}),
      (err: Error) => {
        assert.ok(err.message.includes('Unknown tool'))
        return true
      },
    )
  })
})

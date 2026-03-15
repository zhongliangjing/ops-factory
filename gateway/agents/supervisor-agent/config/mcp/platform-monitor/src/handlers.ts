// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GATEWAY_URL = process.env.GATEWAY_URL || 'https://127.0.0.1:3000'
const GATEWAY_SECRET_KEY = process.env.GATEWAY_SECRET_KEY || 'test'

// ---------------------------------------------------------------------------
// Gateway HTTP helper
// ---------------------------------------------------------------------------

export async function gw<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${GATEWAY_URL}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  const res = await fetch(url, {
    headers: {
      'x-secret-key': GATEWAY_SECRET_KEY,
      'x-user-id': 'sys',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gateway ${path} returned ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const tools = [
  {
    name: 'get_platform_status',
    description:
      'Get platform health status: gateway uptime, host/port, running instances, Langfuse monitoring status, and idle timeout configuration.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_agents_status',
    description:
      'Get all agent configurations (provider, model, skills) and their running instance counts grouped by agent.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_observability_data',
    description:
      'Get observability metrics: KPIs (total traces, cost, avg/P95 latency, error count), daily trends, recent traces, and observation breakdown. Requires Langfuse to be configured.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hours: {
          type: 'number',
          description: 'Time range in hours to query (default: 24)',
          minimum: 1,
          maximum: 720,
        },
      },
    },
  },
  {
    name: 'get_realtime_metrics',
    description:
      'Get real-time gateway performance metrics: current active instances/tokens/sessions, aggregate stats (request count, error count, avg/P95 latency, avg/P95 TTFT, tokens/sec), time series data (30s intervals, up to 120 slots = 1 hour), and per-agent breakdown. Does NOT require Langfuse.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleGetPlatformStatus(): Promise<string> {
  const [system, instances] = await Promise.all([
    gw<Record<string, unknown>>('/monitoring/system'),
    gw<Record<string, unknown>>('/monitoring/instances'),
  ])
  return JSON.stringify({ system, instances }, null, 2)
}

export async function handleGetAgentsStatus(): Promise<string> {
  const [agentsRes, instances] = await Promise.all([
    gw<Record<string, unknown>>('/agents'),
    gw<Record<string, unknown>>('/monitoring/instances'),
  ])
  return JSON.stringify({ agents: agentsRes, instances }, null, 2)
}

export async function handleGetObservabilityData(hours: number): Promise<string> {
  const to = new Date()
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000)
  const params = { from: from.toISOString(), to: to.toISOString() }

  // First check if Langfuse is available
  const status = await gw<{ enabled: boolean; reachable?: boolean; host?: string }>('/monitoring/status')
  if (!status.enabled) {
    return JSON.stringify({
      error: 'Langfuse is not configured. Observability data is unavailable.',
      status,
    }, null, 2)
  }
  if (!status.reachable) {
    return JSON.stringify({
      error: 'Langfuse is configured but not reachable.',
      status,
    }, null, 2)
  }

  const [overview, traces, observations] = await Promise.all([
    gw<Record<string, unknown>>('/monitoring/overview', params),
    gw<Record<string, unknown>>('/monitoring/traces', { ...params, limit: '30' }),
    gw<Record<string, unknown>>('/monitoring/observations', params),
  ])

  return JSON.stringify({ timeRange: { from: from.toISOString(), to: to.toISOString(), hours }, overview, traces, observations }, null, 2)
}

export async function handleGetRealtimeMetrics(): Promise<string> {
  const metrics = await gw<Record<string, unknown>>('/monitoring/metrics')
  return JSON.stringify(metrics, null, 2)
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatch(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_platform_status':
      return handleGetPlatformStatus()
    case 'get_agents_status':
      return handleGetAgentsStatus()
    case 'get_observability_data': {
      const hours = (args as { hours?: number })?.hours ?? 24
      return handleGetObservabilityData(hours)
    }
    case 'get_realtime_metrics':
      return handleGetRealtimeMetrics()
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

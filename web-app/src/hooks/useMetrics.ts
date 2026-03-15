import { useState, useCallback, useRef, useEffect } from 'react'
import { GATEWAY_URL, gatewayHeaders } from '../config/runtime'
import { useUser } from '../contexts/UserContext'
import { getErrorMessage } from '../utils/errorMessages'

// ---- Types matching GET /monitoring/metrics response ----

export interface MetricsPoint {
  t: number
  instances: number
  tokens: number
  requests: number
  avgLatency: number
  avgTtft: number
  p95Latency: number
  p95Ttft: number
  bytes: number
  errors: number
  tokensPerSec: number
}

export interface AgentMetrics {
  requestCount: number
  errorCount: number
  avgLatencyMs: number
  avgTtftMs: number
}

export interface MetricsData {
  collectionIntervalSec: number
  maxSlots: number
  returnedSlots: number
  current: {
    activeInstances: number
    totalTokens: number
    totalSessions: number
  } | null
  aggregate: {
    totalRequests: number
    totalErrors: number
    avgLatencyMs: number
    avgTtftMs: number
    avgTokensPerSec: number
    p95LatencyMs: number
    p95TtftMs: number
  }
  series: MetricsPoint[]
  agentMetrics: Record<string, AgentMetrics>
}

export interface UseMetricsResult {
  data: MetricsData | null
  isLoading: boolean
  error: string | null
  refresh: () => void
}

export function useMetrics(autoRefreshMs = 30_000): UseMetricsResult {
  const { userId } = useUser()
  const [data, setData] = useState<MetricsData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchIdRef = useRef(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    const id = ++fetchIdRef.current
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${GATEWAY_URL}/monitoring/metrics`, {
        headers: gatewayHeaders(userId),
        signal: signal || AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const json = await res.json()
      if (id !== fetchIdRef.current) return
      setData(json)
    } catch (err) {
      if (id !== fetchIdRef.current) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(getErrorMessage(err))
    } finally {
      if (id === fetchIdRef.current) setIsLoading(false)
    }
  }, [userId])

  const refresh = useCallback(() => { load() }, [load])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    const interval = setInterval(() => {
      if (!document.hidden) load()
    }, autoRefreshMs)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [load, autoRefreshMs])

  return { data, isLoading, error, refresh }
}

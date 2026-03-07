import { Gauge, Registry, collectDefaultMetrics } from 'prom-client'
import type { ExporterConfig } from './config.js'

// --- Gateway API response types (mirrors gateway/src/index.ts) ---

interface SystemInfo {
  gateway: { host: string; port: number; uptimeMs: number }
  agents: { configured: number }
  langfuse: { configured: boolean }
}

interface InstanceSnapshot {
  agentId: string
  userId: string
  port: number
  status: 'starting' | 'running' | 'stopped' | 'error'
  idleSinceMs: number
}

interface InstancesData {
  totalInstances: number
  runningInstances: number
  byAgent: Array<{ agentId: string; agentName: string; instances: InstanceSnapshot[] }>
}

// --- Prometheus metrics ---

export class Collector {
  readonly registry: Registry
  private config: ExporterConfig

  private gatewayUp: Gauge
  private gatewayUptimeSeconds: Gauge
  private agentsConfigured: Gauge
  private instancesTotal: Gauge
  private instanceIdleSeconds: Gauge
  private instanceInfo: Gauge
  private langfuseConfigured: Gauge

  constructor(config: ExporterConfig) {
    this.config = config
    this.registry = new Registry()

    // Register default Node.js process metrics (CPU, memory, GC, etc.)
    collectDefaultMetrics({ register: this.registry, prefix: 'opsfactory_exporter_' })

    this.gatewayUp = new Gauge({
      name: 'opsfactory_gateway_up',
      help: 'Whether the gateway is reachable (1 = up, 0 = down)',
      registers: [this.registry],
    })

    this.gatewayUptimeSeconds = new Gauge({
      name: 'opsfactory_gateway_uptime_seconds',
      help: 'Gateway process uptime in seconds',
      registers: [this.registry],
    })

    this.agentsConfigured = new Gauge({
      name: 'opsfactory_agents_configured_total',
      help: 'Number of agents configured in the gateway',
      registers: [this.registry],
    })

    this.instancesTotal = new Gauge({
      name: 'opsfactory_instances_total',
      help: 'Total number of agent instances by status',
      labelNames: ['status'] as const,
      registers: [this.registry],
    })

    this.instanceIdleSeconds = new Gauge({
      name: 'opsfactory_instance_idle_seconds',
      help: 'How long each instance has been idle (seconds)',
      labelNames: ['agent_id', 'user_id'] as const,
      registers: [this.registry],
    })

    this.instanceInfo = new Gauge({
      name: 'opsfactory_instance_info',
      help: 'Instance metadata (value is always 1)',
      labelNames: ['agent_id', 'user_id', 'port', 'status'] as const,
      registers: [this.registry],
    })

    this.langfuseConfigured = new Gauge({
      name: 'opsfactory_langfuse_configured',
      help: 'Whether Langfuse observability is configured (1 = yes, 0 = no)',
      registers: [this.registry],
    })
  }

  /** Fetch from gateway API with auth headers */
  private async gw<T>(path: string): Promise<T> {
    const res = await fetch(`${this.config.gatewayUrl}${path}`, {
      headers: {
        'x-secret-key': this.config.gatewaySecretKey,
        'x-user-id': 'sys',
      },
      signal: AbortSignal.timeout(this.config.collectTimeoutMs),
    })
    if (!res.ok) {
      throw new Error(`Gateway ${path} returned HTTP ${res.status}`)
    }
    return res.json() as Promise<T>
  }

  /** Collect all metrics from gateway. Called on each /metrics scrape. */
  async collect(): Promise<void> {
    try {
      const [system, instances] = await Promise.all([
        this.gw<SystemInfo>('/monitoring/system'),
        this.gw<InstancesData>('/monitoring/instances'),
      ])

      // Gateway is reachable
      this.gatewayUp.set(1)
      this.gatewayUptimeSeconds.set(system.gateway.uptimeMs / 1000)
      this.agentsConfigured.set(system.agents.configured)
      this.langfuseConfigured.set(system.langfuse.configured ? 1 : 0)

      // Aggregate instance counts by status
      const statusCounts: Record<string, number> = { starting: 0, running: 0, stopped: 0, error: 0 }
      this.instanceIdleSeconds.reset()
      this.instanceInfo.reset()

      for (const group of instances.byAgent) {
        for (const inst of group.instances) {
          statusCounts[inst.status] = (statusCounts[inst.status] || 0) + 1
          this.instanceIdleSeconds.set(
            { agent_id: inst.agentId, user_id: inst.userId },
            inst.idleSinceMs / 1000,
          )
          this.instanceInfo.set(
            { agent_id: inst.agentId, user_id: inst.userId, port: String(inst.port), status: inst.status },
            1,
          )
        }
      }

      this.instancesTotal.reset()
      for (const [status, count] of Object.entries(statusCounts)) {
        this.instancesTotal.set({ status }, count)
      }
    } catch {
      // Gateway unreachable — mark as down, leave other metrics stale
      this.gatewayUp.set(0)
    }
  }
}

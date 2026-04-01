import { useState } from 'react'
import type { EChartsOption } from 'echarts'
import { useTranslation } from 'react-i18next'
import MonitoringChartCard from '../components/monitoring/MonitoringChartCard'
import { useGoosed } from '../contexts/GoosedContext'
import { useMonitoring, useMonitoringPlatform, type TimeRange, type DailyPoint, type TraceRow, type AgentInfo } from '../hooks/useMonitoring'
import { useMetrics, type MetricsPoint, type AgentMetrics } from '../hooks/useMetrics'

// --- Helpers --------------------------------------------------------------

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(0)
}

function fmtSec(sec: number): string {
  if (sec >= 60) return `${(sec / 60).toFixed(1)}m`
  if (sec >= 1) return `${sec.toFixed(2)}s`
  return `${(sec * 1000).toFixed(0)}ms`
}

function fmtCost(c: number): string {
  if (c === 0) return '$0'
  if (c < 0.01) return `$${c.toFixed(4)}`
  return `$${c.toFixed(2)}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtIdleTime(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function fmtMs(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}min`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}min`
}

function fmtMs2(ms: number): string {
  if (ms === 0) return '\u2014'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`
}

function fmtTimeShort(epoch: number): string {
  const d = new Date(epoch)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const MON_COLORS = {
  requests: '#2563eb',
  throughput: '#06b6d4',
  avgLatency: '#f59e0b',
  p95Latency: '#dc2626',
  ttft: '#fb7185',
  errors: '#ef4444',
  instances: '#10b981',
  grid: 'rgba(148, 163, 184, 0.18)',
  axis: '#94a3b8',
  text: '#64748b',
  textStrong: '#334155',
  blueArea: 'rgba(37, 99, 235, 0.10)',
  cyanArea: 'rgba(6, 182, 212, 0.08)',
  amberArea: 'rgba(245, 158, 11, 0.10)',
  roseArea: 'rgba(251, 113, 133, 0.08)',
  greenArea: 'rgba(16, 185, 129, 0.08)',
  redArea: 'rgba(239, 68, 68, 0.10)',
  threshold: 'rgba(220, 38, 38, 0.55)',
}

function buildChartTooltip(params: any[], valueFormatter: (seriesName: string, value: number) => string): string {
  const rows = params.map(item => {
    const value = Array.isArray(item.value) ? Number(item.value[1]) : Number(item.value)
    return `${item.marker}<span style="margin-left:4px">${item.seriesName}: ${valueFormatter(item.seriesName, value)}</span>`
  })

  return [
    `<div style="font-weight:600;margin-bottom:6px;color:${MON_COLORS.textStrong}">${params[0]?.axisValueLabel || ''}</div>`,
    ...rows,
  ].join('<br/>')
}

function buildBaseChartOption(series: MetricsPoint[]): Pick<EChartsOption, 'grid' | 'tooltip' | 'xAxis'> {
  return {
    grid: {
      left: 48,
      right: 24,
      top: 10,
      bottom: 32,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(148, 163, 184, 0.22)',
      borderWidth: 1,
      textStyle: {
        color: MON_COLORS.textStrong,
        fontSize: 12,
      },
      extraCssText: 'box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12); border-radius: 12px;',
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: 'rgba(100, 116, 139, 0.35)',
          width: 1,
        },
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: series.map(point => fmtTimeShort(point.t)),
      axisLine: {
        lineStyle: {
          color: MON_COLORS.axis,
        },
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: MON_COLORS.text,
        fontSize: 11,
        margin: 10,
      },
    },
  }
}

function buildThroughputOption(series: MetricsPoint[], labels: { requests: string; throughput: string }): EChartsOption {
  const base = buildBaseChartOption(series)

  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      formatter: params => buildChartTooltip(params as any[], (seriesName, value) => {
        if (seriesName === labels.requests) return fmtNum(value)
        return value > 0 ? value.toFixed(1) : '0'
      }),
    },
    yAxis: [
      {
        type: 'value',
        name: labels.requests,
        nameTextStyle: {
          color: MON_COLORS.text,
          fontSize: 11,
          padding: [0, 0, 0, -12],
        },
        splitLine: {
          lineStyle: {
            color: MON_COLORS.grid,
            type: 'dashed',
          },
        },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: MON_COLORS.text,
          fontSize: 11,
          formatter: (value: number) => fmtNum(value),
        },
      },
      {
        type: 'value',
        splitLine: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: MON_COLORS.text,
          fontSize: 11,
          formatter: (value: number) => value > 0 ? value.toFixed(0) : '0',
        },
      },
    ],
    series: [
      {
        name: labels.requests,
        type: 'line',
        smooth: 0.28,
        showSymbol: false,
        symbol: 'circle',
        lineStyle: {
          width: 2.5,
          color: MON_COLORS.requests,
        },
        areaStyle: {
          color: MON_COLORS.blueArea,
        },
        emphasis: {
          focus: 'series',
        },
        data: series.map(point => point.requests),
      },
      {
        name: labels.throughput,
        type: 'line',
        yAxisIndex: 1,
        smooth: 0.28,
        showSymbol: false,
        symbol: 'circle',
        lineStyle: {
          width: 2,
          color: MON_COLORS.throughput,
        },
        areaStyle: {
          color: MON_COLORS.cyanArea,
        },
        emphasis: {
          focus: 'series',
        },
        data: series.map(point => point.tokensPerSec),
      },
    ],
  }
}

function buildLatencyOption(
  series: MetricsPoint[],
  labels: { avgLatency: string; p95Latency: string; ttft: string; p95Threshold: string; ttftThreshold: string }
): EChartsOption {
  const base = buildBaseChartOption(series)

  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      formatter: params => buildChartTooltip(params as any[], (_seriesName, value) => fmtMs2(value)),
    },
    yAxis: {
      type: 'value',
      name: 'ms',
      nameTextStyle: {
        color: MON_COLORS.text,
        fontSize: 11,
        padding: [0, 0, 0, -8],
      },
      splitLine: {
        lineStyle: {
          color: MON_COLORS.grid,
          type: 'dashed',
        },
      },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: MON_COLORS.text,
        fontSize: 11,
        formatter: (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s` : `${value}`
      },
    },
    series: [
      {
        name: labels.avgLatency,
        type: 'line',
        smooth: 0.22,
        showSymbol: false,
        lineStyle: {
          width: 2.5,
          color: MON_COLORS.avgLatency,
        },
        areaStyle: {
          color: MON_COLORS.amberArea,
        },
        data: series.map(point => point.avgLatency),
      },
      {
        name: labels.p95Latency,
        type: 'line',
        smooth: 0.18,
        showSymbol: false,
        lineStyle: {
          width: 2,
          type: 'dashed',
          color: MON_COLORS.p95Latency,
        },
        data: series.map(point => point.p95Latency),
        markLine: {
          symbol: 'none',
          label: {
            show: false,
          },
          lineStyle: {
            color: MON_COLORS.threshold,
            type: 'dashed',
          },
          data: [{ yAxis: 5000 }],
        },
      },
      {
        name: labels.ttft,
        type: 'line',
        smooth: 0.22,
        showSymbol: false,
        lineStyle: {
          width: 2,
          color: MON_COLORS.ttft,
        },
        areaStyle: {
          color: MON_COLORS.roseArea,
        },
        data: series.map(point => point.avgTtft),
        markLine: {
          symbol: 'none',
          label: {
            show: false,
          },
          lineStyle: {
            color: 'rgba(251, 113, 133, 0.55)',
            type: 'dashed',
          },
          data: [{ yAxis: 2000 }],
        },
      },
    ],
  }
}

// --- Shared sub-components ------------------------------------------------

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'error' | 'success' }) {
  const cls = accent ? `mon-kpi-card mon-kpi-${accent}` : 'mon-kpi-card'
  return (
    <div className={cls}>
      <span className="mon-kpi-label">{label}</span>
      <span className="mon-kpi-value">{value}</span>
      {sub && <span className="mon-kpi-sub">{sub}</span>}
    </div>
  )
}

function StatusCard({
  title,
  description,
  value,
  tone,
  trend,
  metrics,
}: {
  title: string
  description: string
  value: string
  tone?: 'error' | 'success'
  trend?: { data: number[]; color: string }
  metrics?: Array<{ label: string; value: string }>
}) {
  const cls = tone ? `mon-chart-block mon-status-card mon-status-card-${tone}` : 'mon-chart-block mon-status-card'

  return (
    <div className={cls}>
      <div className="mon-status-card-head">
        <div className="mon-chart-card-meta">
          <span className="mon-chart-title">{title}</span>
          <span className="mon-chart-subtitle">{description}</span>
        </div>
        <span className="mon-chart-summary">{value}</span>
      </div>
      {metrics && metrics.length > 0 && (
        <div className="mon-status-metrics">
          {metrics.map(metric => (
            <div key={metric.label} className="mon-status-metric">
              <span className="mon-status-metric-label">{metric.label}</span>
              <span className="mon-status-metric-value">{metric.value}</span>
            </div>
          ))}
        </div>
      )}
      {trend && trend.data.length > 1 && (
        <div className="mon-status-sparkline" aria-hidden="true">
          <svg viewBox="0 0 240 56" preserveAspectRatio="none">
            {(() => {
              const min = Math.min(...trend.data)
              const max = Math.max(...trend.data)
              const range = max - min || 1
              const points = trend.data.map((entry, index) => {
                const x = (index / Math.max(trend.data.length - 1, 1)) * 240
                const y = 44 - ((entry - min) / range) * 28
                return `${x},${y}`
              }).join(' ')

              return (
                <>
                  <polyline
                    fill="none"
                    stroke={trend.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={points}
                  />
                  <line x1="0" y1="54" x2="240" y2="54" stroke="rgba(148, 163, 184, 0.22)" strokeDasharray="4 4" />
                </>
              )
            })()}
          </svg>
        </div>
      )}
    </div>
  )
}

/**
 * Sparkline rendered with a fixed-ratio viewBox.
 * The outer container controls the display size via CSS;
 * the SVG preserves its aspect ratio so circles stay round.
 */
function Sparkline({ data, valueKey, color, formatter }: {
  data: DailyPoint[]
  valueKey: keyof DailyPoint
  color: string
  formatter?: (v: number) => string
}) {
  const fmt = formatter || String
  const values = data.map(d => d[valueKey] as number)
  if (values.length === 0) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const padY = 10
  const w = 600
  const h = 140
  const chartH = h - 28
  const step = values.length > 1 ? (w - 40) / (values.length - 1) : (w - 40)

  const points = values.map((v, i) => ({
    x: 20 + i * step,
    y: padY + (1 - (v - min) / range) * (chartH - padY * 2),
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${points[points.length - 1].x},${chartH} L${points[0].x},${chartH} Z`
  const gradId = `grad-${color.replace(/[^a-z0-9]/gi, '')}-${valueKey as string}`

  // Horizontal grid lines
  const gridLines = [0.25, 0.5, 0.75].map(pct => padY + pct * (chartH - padY * 2))

  return (
    <svg className="mon-sparkline" viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {/* Subtle grid lines */}
      {gridLines.map((y, i) => (
        <line key={i} x1="20" y1={y} x2={w - 20} y2={y} stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="4 4" />
      ))}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4.5" fill="var(--color-bg-primary)" stroke={color} strokeWidth="2" />
          <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--color-text-secondary)">
            {fmt(values[i])}
          </text>
          <text x={p.x} y={h - 4} textAnchor="middle" fontSize="10" fill="var(--color-text-muted)">
            {fmtDate(data[i].date)}
          </text>
        </g>
      ))}
    </svg>
  )
}

function TraceStatusIcon({ hasError }: { hasError: boolean }) {
  if (hasError) {
    return <span className="mon-trace-status mon-trace-error" title="Error">✗</span>
  }
  return <span className="mon-trace-status mon-trace-ok" title="OK">✓</span>
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`mon-chevron ${expanded ? 'mon-chevron-open' : ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      width="14"
      height="14"
    >
      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
    </svg>
  )
}

function ExternalLinkIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={size} height={size}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function MonitoringDisabled({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mon-disabled">
      <div className="mon-disabled-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
          <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
          <path d="M12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <h2 className="mon-disabled-title">{title}</h2>
      <p className="mon-disabled-desc">{desc}</p>
    </div>
  )
}

// --- Tab: Platform --------------------------------------------------------

function PlatformTab() {
  const { t } = useTranslation()
  const { error: connectionError } = useGoosed()
  const { system, instances, isLoading, error } = useMonitoringPlatform()

  if (isLoading && !system) {
    return <div className="mon-loading">{t('monitoring.loading')}</div>
  }

  if (error && !connectionError) {
    return (
      <div className="conn-banner conn-banner-error">
        {t('monitoring.errorLoading')}: {error}
      </div>
    )
  }

  if (error) return null

  return (
    <>
      {/* Gateway Health */}
      {system && (
        <div className="mon-section">
          <h2 className="mon-section-title">{t('monitoring.platformTitle')}</h2>
          <div className="mon-kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <KpiCard label={t('monitoring.platformUptime')} value={system.gateway.uptimeFormatted} />
            <KpiCard label={t('monitoring.platformHost')} value={`${system.gateway.host}:${system.gateway.port}`} />
            <KpiCard label={t('monitoring.platformAgentsConfigured')} value={String(system.agents.configured)} />
            <KpiCard
              label={t('monitoring.platformLangfuse')}
              value={system.langfuse.configured ? t('monitoring.platformConfigured') : t('monitoring.platformNotConfigured')}
              accent={system.langfuse.configured ? 'success' : undefined}
            />
          </div>
          <div className="mon-kpi-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <KpiCard label={t('monitoring.platformIdleTimeout')} value={fmtMs(system.idle.timeoutMs)} />
            <KpiCard
              label={t('monitoring.instancesRunning')}
              value={instances ? `${instances.runningInstances} / ${instances.totalInstances}` : '—'}
            />
          </div>
        </div>
      )}

      {/* Running Instances Table */}
      {instances && (
        <div className="mon-section">
          <h2 className="mon-section-title">{t('monitoring.instancesTitle')}</h2>

          {instances.totalInstances === 0 ? (
            <div className="mon-no-data">{t('monitoring.instancesNone')}</div>
          ) : (
            <div className="mon-agent-table">
              <div className="mon-inst-table-header">
                <span>{t('monitoring.instancesAgent')}</span>
                <span>{t('monitoring.instancesUser')}</span>
                <span>{t('monitoring.instancesPort')}</span>
                <span>{t('monitoring.instancesStatus')}</span>
                <span>{t('monitoring.instancesIdleSince')}</span>
              </div>
              {instances.byAgent.flatMap(group =>
                group.instances.map(inst => (
                  <div key={`${inst.agentId}:${inst.userId}`} className="mon-inst-table-row">
                    <span className="mon-agent-name">{group.agentName}</span>
                    <span>{inst.userId}</span>
                    <span className="mon-agent-model">{inst.port}</span>
                    <span><span className={`status-pill status-${inst.status}`}>{inst.status}</span></span>
                    <span className="mon-traces-ts">{fmtIdleTime(inst.idleSinceMs)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// --- Tab: Agents ----------------------------------------------------------

function AgentsTab() {
  const { t } = useTranslation()
  const { error: connectionError } = useGoosed()
  const { instances, agents, isLoading, error } = useMonitoringPlatform()
  const { data: metricsData } = useMetrics(30_000)

  if (isLoading && agents.length === 0) {
    return <div className="mon-loading">{t('monitoring.loading')}</div>
  }

  if (error && !connectionError) {
    return (
      <div className="conn-banner conn-banner-error">
        {t('monitoring.errorLoading')}: {error}
      </div>
    )
  }

  if (error) return null

  // Build map of agentId -> running instance count
  const instanceCounts: Record<string, number> = {}
  if (instances) {
    for (const group of instances.byAgent) {
      instanceCounts[group.agentId] = group.instances.filter(i => i.status === 'running').length
    }
  }

  const agentMetrics: Record<string, AgentMetrics> = metricsData?.agentMetrics || {}

  return (
    <div className="mon-section">
      <h2 className="mon-section-title">{t('monitoring.agentDetails')}</h2>
      {agents.length === 0 ? (
        <div className="mon-no-data">{t('monitoring.noData')}</div>
      ) : (
        <div className="mon-agent-cards">
          {agents.map((agent: AgentInfo) => {
            const running = instanceCounts[agent.id] || 0
            const metrics = agentMetrics[agent.id]
            return (
              <div key={agent.id} className="mon-agent-card">
                <div className="mon-agent-card-header">
                  <div className="mon-agent-card-title">
                    <span className="mon-agent-card-name">{agent.name}</span>
                    <span className={`status-pill status-${agent.status}`}>{agent.status}</span>
                  </div>
                  <div className="mon-agent-card-meta">
                    <span className="mon-agent-card-tag">{agent.provider}</span>
                    <span className="mon-agent-card-tag">{agent.model}</span>
                  </div>
                </div>
                <div className="mon-agent-card-stats">
                  <div className="mon-agent-card-stat">
                    <span className="mon-agent-card-stat-label">{t('monitoring.agentInstanceCount')}</span>
                    <span className="mon-agent-card-stat-value">{running}</span>
                  </div>
                  <div className="mon-agent-card-stat">
                    <span className="mon-agent-card-stat-label">{t('monitoring.usageRequests')}</span>
                    <span className="mon-agent-card-stat-value">{metrics ? metrics.requestCount : 0}</span>
                  </div>
                  <div className="mon-agent-card-stat">
                    <span className="mon-agent-card-stat-label">{t('monitoring.usageAvgLatency')}</span>
                    <span className="mon-agent-card-stat-value">{metrics ? fmtMs2(metrics.avgLatencyMs) : '\u2014'}</span>
                  </div>
                  <div className="mon-agent-card-stat">
                    <span className="mon-agent-card-stat-label">{t('monitoring.usageErrors')}</span>
                    <span className={`mon-agent-card-stat-value${metrics && metrics.errorCount > 0 ? ' mon-stat-error' : ''}`}>
                      {metrics ? metrics.errorCount : 0}
                    </span>
                  </div>
                </div>
                {agent.skills && agent.skills.length > 0 && (
                  <div className="mon-agent-card-skills">
                    {agent.skills.map((skill: any) => (
                      <span key={typeof skill === 'string' ? skill : skill.name || skill.path} className="mon-agent-card-skill">
                        {typeof skill === 'string' ? skill : skill.name || skill.path}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Tab: Usage -----------------------------------------------------------

function PerformanceTab() {
  const { t } = useTranslation()
  const { error: connectionError } = useGoosed()
  const { data, isLoading, error } = useMetrics(30_000)

  if (isLoading && !data) {
    return <div className="mon-loading">{t('monitoring.loading')}</div>
  }
  if (error && !connectionError) {
    return <div className="conn-banner conn-banner-error">{t('monitoring.errorLoading')}: {error}</div>
  }
  if (!data) return null

  const { current, aggregate, series } = data
  const hasTrend = series.length > 1
  const hasTraffic = series.some(point =>
    point.requests > 0 ||
    point.tokensPerSec > 0 ||
    point.avgLatency > 0 ||
    point.avgTtft > 0 ||
    point.p95Latency > 0 ||
    point.errors > 0
  )
  const hasSeriesData = series.length > 0

  const throughputOption = hasTrend ? buildThroughputOption(series, {
    requests: t('monitoring.usageRequests'),
    throughput: t('monitoring.perfTokensPerSec'),
  }) : undefined

  const latencyOption = hasTrend ? buildLatencyOption(series, {
    avgLatency: t('monitoring.usageAvgLatency'),
    p95Latency: t('monitoring.perfP95Latency'),
    ttft: t('monitoring.usageAvgTtft'),
    p95Threshold: t('monitoring.perfP95Threshold'),
    ttftThreshold: t('monitoring.perfTtftThreshold'),
  }) : undefined

  const peakRequests = series.reduce((max, point) => Math.max(max, point.requests), 0)
  const peakLatency = series.reduce((max, point) => Math.max(max, point.p95Latency), 0)
  const hasErrorRequests = series.some(point => point.errors > 0)
  const instanceValues = series.map(point => point.instances)
  const instanceStable = instanceValues.length > 0 && instanceValues.every(value => value === instanceValues[0])
  const errorRate = aggregate.totalRequests > 0 ? aggregate.totalErrors / aggregate.totalRequests : 0
  const thresholdRatio = hasSeriesData ? series.filter(point => point.avgTtft > 2000 || point.p95Latency > 5000).length / series.length : 0
  const latestSpike = [...series].reverse().find(point => point.avgTtft > 2000 || point.p95Latency > 5000)

  return (
    <>
      <div className="mon-section-head">
        <div>
          <h2 className="mon-section-title">{t('monitoring.perfOverviewTitle')}</h2>
          <p className="mon-section-subtitle">{t('monitoring.perfOverviewWindow')}</p>
        </div>
      </div>
      {/* KPI Row 1 */}
      <div className="mon-kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiCard label={t('monitoring.usageActiveInstances')} value={current ? String(current.activeInstances) : '0'} />
        <KpiCard label={t('monitoring.usageRequests')} value={fmtNum(aggregate.totalRequests)} />
        <KpiCard label={t('monitoring.perfErrorRate')} value={fmtPct(errorRate)} accent={errorRate > 0 ? 'error' : undefined} />
        <KpiCard label={t('monitoring.usageAvgLatency')} value={fmtMs2(aggregate.avgLatencyMs)} />
      </div>
      {/* KPI Row 2 */}
      <div className="mon-kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiCard label={t('monitoring.perfP95Latency')} value={fmtMs2(aggregate.p95LatencyMs)} />
        <KpiCard label={t('monitoring.usageAvgTtft')} value={fmtMs2(aggregate.avgTtftMs)} />
        <KpiCard label={t('monitoring.perfThresholdRatio')} value={fmtPct(thresholdRatio)} accent={thresholdRatio > 0 ? 'error' : undefined} />
        <KpiCard label={t('monitoring.usageTotalSessions')} value={current ? String(current.totalSessions) : '0'} />
      </div>

      {/* Charts */}
      {hasTrend && (
        <div className="mon-section">
          <div className="mon-section-head">
            <div>
              <h2 className="mon-section-title">{t('monitoring.perfTrendAnalysis')}</h2>
              <p className="mon-section-subtitle">{t('monitoring.perfTrendDescription')}</p>
            </div>
          </div>
          <div className="mon-chart-grid mon-chart-grid-featured">
            <MonitoringChartCard
              title={t('monitoring.perfThroughputTrend')}
              subtitle={t('monitoring.perfSamplingWindow')}
              summary={`${t('monitoring.perfPeak')} ${fmtNum(peakRequests)}`}
              legendItems={[
                { label: t('monitoring.usageRequests'), color: MON_COLORS.requests },
                { label: t('monitoring.perfTokensPerSec'), color: MON_COLORS.throughput },
              ]}
              option={throughputOption}
              height={248}
              isLoading={isLoading && !throughputOption}
              isEmpty={!hasTraffic}
              loadingText={t('monitoring.loading')}
              emptyText={t('monitoring.perfNoTraffic')}
            />
            <MonitoringChartCard
              title={t('monitoring.perfLatencyOverview')}
              subtitle={latestSpike
                ? `${t('monitoring.perfSamplingWindow')} · ${t('monitoring.perfThresholdLatestSpike', { time: fmtTimeShort(latestSpike.t) })}`
                : t('monitoring.perfSamplingWindow')}
              summary={`P95 ${fmtMs2(peakLatency)} · ${fmtPct(thresholdRatio)}`}
              legendItems={[
                { label: t('monitoring.usageAvgLatency'), color: MON_COLORS.avgLatency },
                { label: t('monitoring.perfP95Latency'), color: MON_COLORS.p95Latency, dashed: true },
                { label: t('monitoring.usageAvgTtft'), color: MON_COLORS.ttft },
              ]}
              option={latencyOption}
              height={248}
              isLoading={isLoading && !latencyOption}
              isEmpty={!hasTraffic}
              loadingText={t('monitoring.loading')}
              emptyText={t('monitoring.perfNoTraffic')}
            />
          </div>
          <div className="mon-chart-grid mon-chart-grid-secondary">
            <StatusCard
              title={t('monitoring.perfErrorState')}
              description={hasSeriesData
                ? hasErrorRequests
                  ? t('monitoring.perfErrorStateDetected')
                  : t('monitoring.perfNoErrors')
                : t('monitoring.perfNoSeries')}
              value={fmtPct(errorRate)}
              tone={hasErrorRequests ? 'error' : 'success'}
              metrics={[
                { label: t('monitoring.usageErrors'), value: String(aggregate.totalErrors) },
                { label: t('monitoring.usageRequests'), value: fmtNum(aggregate.totalRequests) },
              ]}
              trend={hasErrorRequests ? { data: series.map(point => point.errors), color: MON_COLORS.errors } : undefined}
            />
            <StatusCard
              title={t('monitoring.perfInstancesState')}
              description={hasSeriesData
                ? instanceStable
                  ? t('monitoring.perfInstancesStable', { count: current ? current.activeInstances : instanceValues[0] || 0 })
                  : t('monitoring.perfInstancesChanged')
                : t('monitoring.perfNoSeries')}
              value={String(current ? current.activeInstances : 0)}
              tone="success"
              metrics={[
                { label: t('monitoring.perfMinInstances'), value: String(instanceValues.length ? Math.min(...instanceValues) : 0) },
                { label: t('monitoring.perfMaxInstances'), value: String(instanceValues.length ? Math.max(...instanceValues) : 0) },
              ]}
              trend={!instanceStable && hasSeriesData ? { data: instanceValues, color: MON_COLORS.instances } : undefined}
            />
          </div>
        </div>
      )}
    </>
  )
}

// --- Tab: Observability ---------------------------------------------------

const RANGES: TimeRange[] = ['1h', '24h', '7d', '30d']

function ObservabilityTab() {
  const { t } = useTranslation()
  const { error: connectionError } = useGoosed()
  const { status, overview, traces, observations, isLoading, error, range, setRange } = useMonitoring()
  const [traceFilter, setTraceFilter] = useState<'all' | 'errors'>('all')
  const filteredTraces = traceFilter === 'errors' ? traces.filter(tr => tr.hasError) : traces

  // Disabled states (Langfuse not configured or not reachable)
  if (!isLoading && status && !status.enabled) {
    return <MonitoringDisabled title={t('monitoring.notEnabled')} desc={t('monitoring.notEnabledDesc')} />
  }

  if (!isLoading && status && status.enabled && !status.reachable) {
    return <MonitoringDisabled title={t('monitoring.notReachable')} desc={t('monitoring.notReachableDesc', { host: status.host })} />
  }

  return (
    <>
      {/* Langfuse link + Time range toggle */}
      <div className="mon-obs-toolbar">
        <div className="mon-header-left">
          {status?.host && (
            <a href={status.host} target="_blank" rel="noopener noreferrer" className="mon-langfuse-link">
              {t('monitoring.openLangfuse')}
              <ExternalLinkIcon />
            </a>
          )}
        </div>
        <div className="seg-filter seg-filter-compact">
          {RANGES.map(r => (
            <button
              key={r}
              className={`seg-filter-btn ${range === r ? 'active' : ''}`}
              onClick={() => setRange(r)}
              disabled={isLoading}
            >
              {t(`monitoring.last${r}` as any)}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && !overview && (
        <div className="mon-loading">{t('monitoring.loading')}</div>
      )}

      {/* Error (only show if no page-level connection error) */}
      {error && !connectionError && (
        <div className="conn-banner conn-banner-error">
          {t('monitoring.errorLoading')}: {error}
        </div>
      )}

      {/* KPI Row */}
      {overview && (
        <>
          <div className="mon-kpi-row">
            <KpiCard label={t('monitoring.totalTraces')} value={fmtNum(overview.totalTraces)} />
            <KpiCard label={t('monitoring.totalCost')} value={fmtCost(overview.totalCost)} />
            <KpiCard label={t('monitoring.avgLatency')} value={fmtSec(overview.avgLatency)} />
            <KpiCard label={t('monitoring.p95Latency')} value={fmtSec(overview.p95Latency)} />
            <KpiCard label={t('monitoring.totalObservations')} value={fmtNum(overview.totalObservations)} />
            <KpiCard
              label={t('monitoring.errors')}
              value={String(overview.errorCount)}
              accent={overview.errorCount > 0 ? 'error' : undefined}
            />
          </div>

          {/* Trend charts */}
          {overview.daily.length > 1 && (
            <div className="mon-section">
              <div className="mon-chart-block">
                <span className="mon-chart-title">{t('monitoring.trendTraces')}</span>
                <Sparkline data={overview.daily} valueKey="traces" color="var(--color-accent)" formatter={v => String(v)} />
              </div>
            </div>
          )}

          {/* Observation breakdown table */}
          {observations && observations.observations.length > 0 && (
            <div className="mon-section">
              <h2 className="mon-section-title">{t('monitoring.observationBreakdown')}</h2>
              <div className="mon-obs-table">
                <div className="mon-obs-header">
                  <span>{t('monitoring.obsName')}</span>
                  <span>{t('monitoring.obsCount')}</span>
                  <span>{t('monitoring.obsAvgLatency')}</span>
                  <span>{t('monitoring.obsP95Latency')}</span>
                </div>
                {observations.observations.map(o => (
                  <div key={o.name} className="mon-obs-row">
                    <span className="mon-obs-name">{o.name}</span>
                    <span className="mon-obs-count">{o.count}</span>
                    <span>{fmtSec(o.avgLatency)}</span>
                    <span>{fmtSec(o.p95Latency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Traces */}
          <div className="mon-section">
            <div className="mon-traces-header-row">
              <h2 className="mon-section-title">{t('monitoring.recentTraces')}</h2>
              <div className="seg-filter seg-filter-compact">
                <button className={`seg-filter-btn ${traceFilter === 'all' ? 'active' : ''}`} onClick={() => setTraceFilter('all')}>
                  {t('monitoring.filterAll')}
                </button>
                <button className={`seg-filter-btn ${traceFilter === 'errors' ? 'active' : ''}`} onClick={() => setTraceFilter('errors')}>
                  {t('monitoring.filterErrors')}
                </button>
              </div>
            </div>

            {filteredTraces.length === 0 ? (
              <div className="mon-no-data">{t('monitoring.noData')}</div>
            ) : (
              <div className="mon-traces-table">
                <div className="mon-traces-table-header">
                  <span></span>
                  <span>{t('monitoring.timestamp')}</span>
                  <span>{t('monitoring.traceName')}</span>
                  <span>{t('monitoring.input')}</span>
                  <span>{t('monitoring.latency')}</span>
                  <span>{t('monitoring.observations')}</span>
                  <span>{t('monitoring.status')}</span>
                </div>
                {filteredTraces.map(tr => (
                  <TraceRowComp key={tr.id} trace={tr} langfuseHost={status?.host} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty state if loaded but no data */}
      {!isLoading && !error && overview && overview.totalTraces === 0 && (
        <div className="mon-no-data">{t('monitoring.noData')}</div>
      )}
    </>
  )
}

// --- Main page ------------------------------------------------------------

type MonitoringTab = 'platform' | 'agents' | 'performance' | 'observability'

export default function Monitoring() {
  const { t } = useTranslation()
  const { isConnected, error: connectionError } = useGoosed()
  const [activeTab, setActiveTab] = useState<MonitoringTab>('platform')

  const tabs: { key: MonitoringTab; label: string }[] = [
    { key: 'platform', label: t('monitoring.tabPlatform') },
    { key: 'agents', label: t('monitoring.tabAgents') },
    { key: 'performance', label: t('monitoring.tabPerformance') },
    { key: 'observability', label: t('monitoring.tabObservability') },
  ]

  return (
    <div className="page-container sidebar-top-page monitoring-page">
      {/* Header */}
      <div className="mon-page-header">
        <div className="mon-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>{t('monitoring.title')}</h1>
        </div>
      </div>

      {connectionError && (
        <div className="conn-banner conn-banner-error">
          {t('common.connectionError', { error: connectionError })}
        </div>
      )}
      {!isConnected && !connectionError && (
        <div className="conn-banner conn-banner-warning">{t('common.connectingGateway')}</div>
      )}

      {/* Tab Navigation */}
      <div className="config-tabs">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`config-tab ${activeTab === tab.key ? 'config-tab-active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'platform' && <PlatformTab />}
      {activeTab === 'agents' && <AgentsTab />}
      {activeTab === 'performance' && <PerformanceTab />}
      {activeTab === 'observability' && <ObservabilityTab />}
    </div>
  )
}

// --- Trace row sub-component (used by ObservabilityTab) --------------------

function TraceRowComp({ trace: tr, langfuseHost }: { trace: TraceRow; langfuseHost?: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const rowClass = `mon-traces-row ${tr.hasError ? 'mon-traces-row-error' : ''}`

  return (
    <>
      <div className={rowClass} onClick={() => setExpanded(!expanded)}>
        <span className="mon-traces-chevron"><ChevronIcon expanded={expanded} /></span>
        <span className="mon-traces-ts">{fmtTime(tr.timestamp)}</span>
        <span className="mon-traces-name">{tr.name}</span>
        <span className="mon-traces-input" title={tr.input}>{tr.input.slice(0, 60)}{tr.input.length > 60 ? '...' : ''}</span>
        <span className="mon-traces-latency">{fmtSec(tr.latency)}</span>
        <span className="mon-traces-obs-count">{tr.observationCount}</span>
        <span><TraceStatusIcon hasError={tr.hasError} /></span>
      </div>
      {expanded && (
        <div className="mon-traces-detail">
          <div className="mon-traces-detail-content">
            <div className="mon-traces-detail-field">
              <span className="mon-traces-detail-label">{t('monitoring.input')}</span>
              <span>{tr.input}</span>
            </div>
            {tr.totalCost > 0 && (
              <div className="mon-traces-detail-field">
                <span className="mon-traces-detail-label">{t('monitoring.totalCost')}</span>
                <span>{fmtCost(tr.totalCost)}</span>
              </div>
            )}
            {tr.hasError && tr.errorMessage && (
              <div className="mon-traces-detail-error">{tr.errorMessage}</div>
            )}
            {langfuseHost && (
              <a
                href={`${langfuseHost}/project/opsfactory-agents/traces/${tr.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mon-traces-detail-link"
              >
                View in Langfuse
                <ExternalLinkIcon size={12} />
              </a>
            )}
          </div>
        </div>
      )}
    </>
  )
}

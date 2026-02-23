import { useState } from 'react'

// --- Mock data -----------------------------------------------------------

interface AgentMetrics {
    id: string
    name: string
    status: 'healthy' | 'degraded' | 'down'
    requests24h: number
    avgResponseMs: number
    p95ResponseMs: number
    tokensInput: number
    tokensOutput: number
    successRate: number
    errorRate: number
    availability: number
    dailyRequests: number[]      // last 7 days
    dailyLatency: number[]       // last 7 days avg ms
}

interface RecentError {
    agent: string
    timestamp: string
    message: string
    code: number
}

const AGENTS_METRICS: AgentMetrics[] = [
    {
        id: 'universal-agent',
        name: 'Universal Agent',
        status: 'healthy',
        requests24h: 1_247,
        avgResponseMs: 820,
        p95ResponseMs: 2_340,
        tokensInput: 584_210,
        tokensOutput: 312_890,
        successRate: 99.2,
        errorRate: 0.8,
        availability: 99.97,
        dailyRequests: [142, 198, 167, 243, 189, 156, 239],
        dailyLatency: [680, 920, 760, 1140, 870, 740, 820],
    },
    {
        id: 'kb-agent',
        name: 'KB Agent',
        status: 'healthy',
        requests24h: 634,
        avgResponseMs: 1_150,
        p95ResponseMs: 3_120,
        tokensInput: 412_300,
        tokensOutput: 198_740,
        successRate: 98.7,
        errorRate: 1.3,
        availability: 99.85,
        dailyRequests: [72, 118, 85, 64, 132, 97, 90],
        dailyLatency: [980, 1380, 1050, 1520, 1100, 960, 1150],
    },
    {
        id: 'report-agent',
        name: 'Report Agent',
        status: 'degraded',
        requests24h: 312,
        avgResponseMs: 2_480,
        p95ResponseMs: 6_800,
        tokensInput: 1_245_600,
        tokensOutput: 876_320,
        successRate: 95.4,
        errorRate: 4.6,
        availability: 98.20,
        dailyRequests: [38, 62, 45, 28, 71, 34, 37],
        dailyLatency: [1850, 2720, 2100, 3400, 2950, 2180, 2480],
    },
]

const RECENT_ERRORS: RecentError[] = [
    { agent: 'Report Agent', timestamp: '2026-02-23 14:32:05', message: 'LLM provider timeout after 30s', code: 504 },
    { agent: 'Report Agent', timestamp: '2026-02-23 13:18:42', message: 'Token limit exceeded (128k context)', code: 400 },
    { agent: 'KB Agent', timestamp: '2026-02-23 11:05:17', message: 'Vector store connection reset', code: 503 },
    { agent: 'Report Agent', timestamp: '2026-02-23 09:47:33', message: 'Rate limit exceeded – retry after 12s', code: 429 },
    { agent: 'Universal Agent', timestamp: '2026-02-22 23:12:08', message: 'Invalid tool call schema', code: 422 },
    { agent: 'KB Agent', timestamp: '2026-02-22 20:41:55', message: 'Embedding service unavailable', code: 503 },
]

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// --- Helpers --------------------------------------------------------------

function fmtNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return n.toString()
}

function fmtMs(ms: number): string {
    if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`
    return `${ms}ms`
}

// --- Sub-components -------------------------------------------------------

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="mon-kpi-card">
            <span className="mon-kpi-label">{label}</span>
            <span className="mon-kpi-value">{value}</span>
            {sub && <span className="mon-kpi-sub">{sub}</span>}
        </div>
    )
}

function Sparkline({ values, color, formatter }: { values: number[]; color: string; formatter?: (v: number) => string }) {
    const fmt = formatter || ((v: number) => String(v))
    const max = Math.max(...values)
    const min = Math.min(...values)
    const range = max - min || 1
    const padY = 6
    const w = 220
    const h = 64
    const chartH = h - 20 // space for labels
    const step = w / (values.length - 1)

    const points = values.map((v, i) => ({
        x: i * step,
        y: padY + (1 - (v - min) / range) * (chartH - padY * 2),
    }))

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    const areaPath = `${linePath} L${points[points.length - 1].x},${chartH} L${points[0].x},${chartH} Z`

    return (
        <svg className="mon-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
            <defs>
                <linearGradient id={`grad-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.02" />
                </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#grad-${color.replace(/[^a-z0-9]/gi, '')})`} />
            <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((p, i) => (
                <g key={i}>
                    <circle cx={p.x} cy={p.y} r="3" fill="var(--color-bg-primary)" stroke={color} strokeWidth="1.5" />
                    <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="8" fontWeight="500" fill="var(--color-text-muted)">
                        {fmt(values[i])}
                    </text>
                    <text x={p.x} y={h - 2} textAnchor="middle" fontSize="8" fill="var(--color-text-muted)">
                        {DAY_LABELS[i]}
                    </text>
                </g>
            ))}
        </svg>
    )
}

function AvailabilityRing({ pct }: { pct: number }) {
    const r = 28
    const circ = 2 * Math.PI * r
    const offset = circ * (1 - pct / 100)
    const color = pct >= 99.5 ? 'var(--color-success)' : pct >= 98 ? 'var(--color-warning)' : 'var(--color-error)'
    return (
        <svg className="mon-ring" viewBox="0 0 64 64" width="64" height="64">
            <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-border)" strokeWidth="5" />
            <circle
                cx="32" cy="32" r={r}
                fill="none"
                stroke={color}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={circ}
                strokeDashoffset={offset}
                transform="rotate(-90 32 32)"
            />
            <text x="32" y="35" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--color-text-primary)">
                {pct.toFixed(1)}%
            </text>
        </svg>
    )
}

function StatusBadge({ status }: { status: AgentMetrics['status'] }) {
    return <span className={`mon-status mon-status-${status}`}>{status}</span>
}

// --- Main page ------------------------------------------------------------

type TimeRange = '24h' | '7d'

export default function Monitoring() {
    const [range, setRange] = useState<TimeRange>('24h')

    // aggregated KPIs
    const totalRequests = AGENTS_METRICS.reduce((s, a) => s + a.requests24h, 0)
    const avgResponse = Math.round(AGENTS_METRICS.reduce((s, a) => s + a.avgResponseMs, 0) / AGENTS_METRICS.length)
    const totalTokens = AGENTS_METRICS.reduce((s, a) => s + a.tokensInput + a.tokensOutput, 0)
    const avgAvailability = (AGENTS_METRICS.reduce((s, a) => s + a.availability, 0) / AGENTS_METRICS.length).toFixed(2)
    const totalErrors = RECENT_ERRORS.length

    return (
        <div className="page-container monitoring-page">
            <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h1 className="page-title">Monitoring</h1>
                    <p className="page-subtitle">
                        Agent observability powered by Langfuse
                        <a
                            href="http://localhost:3100/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mon-langfuse-link"
                        >
                            Open Langfuse
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                        </a>
                    </p>
                </div>
                <div className="mon-range-toggle">
                    <button className={`mon-range-btn ${range === '24h' ? 'active' : ''}`} onClick={() => setRange('24h')}>24 h</button>
                    <button className={`mon-range-btn ${range === '7d' ? 'active' : ''}`} onClick={() => setRange('7d')}>7 d</button>
                </div>
            </div>

            {/* ---- KPI row ---- */}
            <div className="mon-kpi-row">
                <KpiCard label="Total Requests" value={fmtNum(range === '7d' ? totalRequests * 7 : totalRequests)} sub={range === '24h' ? 'last 24 hours' : 'last 7 days'} />
                <KpiCard label="Avg Resp Time" value={fmtMs(avgResponse)} sub="across all agents" />
                <KpiCard label="Total Tokens" value={fmtNum(range === '7d' ? totalTokens * 7 : totalTokens)} sub="input + output" />
                <KpiCard label="Avg Availability" value={`${avgAvailability}%`} sub="uptime" />
                <KpiCard label="Errors" value={String(range === '7d' ? totalErrors : Math.ceil(totalErrors / 2))} sub={range === '24h' ? 'last 24 hours' : 'last 7 days'} />
            </div>

            {/* ---- Per-agent cards ---- */}
            <h2 className="mon-section-title">Agent Details</h2>
            <div className="mon-agent-grid">
                {AGENTS_METRICS.map(agent => (
                    <div key={agent.id} className="mon-agent-card">
                        {/* header */}
                        <div className="mon-agent-header">
                            <div className="mon-agent-name-row">
                                <span className={`status-dot status-${agent.status === 'healthy' ? 'running' : agent.status === 'degraded' ? 'idle' : 'error'}`} />
                                <span className="mon-agent-name">{agent.name}</span>
                            </div>
                            <StatusBadge status={agent.status} />
                        </div>

                        {/* metric pairs */}
                        <div className="mon-metric-grid">
                            <div className="mon-metric">
                                <span className="mon-metric-label">Requests (24h)</span>
                                <span className="mon-metric-value">{fmtNum(agent.requests24h)}</span>
                            </div>
                            <div className="mon-metric">
                                <span className="mon-metric-label">Avg Latency</span>
                                <span className="mon-metric-value">{fmtMs(agent.avgResponseMs)}</span>
                            </div>
                            <div className="mon-metric">
                                <span className="mon-metric-label">P95 Latency</span>
                                <span className="mon-metric-value">{fmtMs(agent.p95ResponseMs)}</span>
                            </div>
                            <div className="mon-metric">
                                <span className="mon-metric-label">Success Rate</span>
                                <span className="mon-metric-value">{agent.successRate}%</span>
                            </div>
                            <div className="mon-metric">
                                <span className="mon-metric-label">Tokens In</span>
                                <span className="mon-metric-value">{fmtNum(agent.tokensInput)}</span>
                            </div>
                            <div className="mon-metric">
                                <span className="mon-metric-label">Tokens Out</span>
                                <span className="mon-metric-value">{fmtNum(agent.tokensOutput)}</span>
                            </div>
                        </div>

                        {/* availability ring + bar charts */}
                        <div className="mon-visuals">
                            <div className="mon-visual-block">
                                <span className="mon-visual-title">Availability</span>
                                <AvailabilityRing pct={agent.availability} />
                            </div>
                            <div className="mon-visual-block mon-visual-block-grow">
                                <span className="mon-visual-title">Daily Requests</span>
                                <Sparkline values={agent.dailyRequests} color="var(--color-accent)" />
                            </div>
                            <div className="mon-visual-block mon-visual-block-grow">
                                <span className="mon-visual-title">Daily Latency</span>
                                <Sparkline values={agent.dailyLatency} color="var(--color-warning)" formatter={fmtMs} />
                            </div>
                        </div>

                        {/* error rate bar */}
                        <div className="mon-error-bar-wrapper">
                            <div className="mon-error-bar-header">
                                <span className="mon-metric-label">Error Rate</span>
                                <span className="mon-metric-value">{agent.errorRate}%</span>
                            </div>
                            <div className="mon-error-bar-track">
                                <div
                                    className="mon-error-bar-fill"
                                    style={{ width: `${Math.min(agent.errorRate * 10, 100)}%` }}
                                />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ---- Recent errors ---- */}
            <h2 className="mon-section-title">Recent Errors</h2>
            <div className="mon-errors-table">
                <div className="mon-errors-header">
                    <span>Timestamp</span>
                    <span>Agent</span>
                    <span>Code</span>
                    <span>Message</span>
                </div>
                {RECENT_ERRORS.map((err, i) => (
                    <div key={i} className="mon-errors-row">
                        <span className="mon-errors-ts">{err.timestamp}</span>
                        <span>{err.agent}</span>
                        <span className="mon-errors-code">{err.code}</span>
                        <span className="mon-errors-msg">{err.message}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

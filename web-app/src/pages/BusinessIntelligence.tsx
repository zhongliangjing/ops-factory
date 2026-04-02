import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BUSINESS_INTELLIGENCE_SERVICE_URL } from '../config/runtime'
import { useToast } from '../contexts/ToastContext'

interface TabMeta {
    id: string
    label: string
}

interface ExecutiveHero {
    score: string
    grade: string
    summary: string
    changeHint: string
    periodLabel: string
}

interface ProcessHealth {
    id: string
    label: string
    score: string
    tone: string
    summary: string
}

interface ExecutiveRisk {
    id: string
    priority: string
    title: string
    impact: string
    process: string
    value: string
}

interface RiskSummary {
    critical: number
    warning: number
    attention: number
    topRisks: ExecutiveRisk[]
}

interface TrendPoint {
    label: string
    score: number
    signal: number
}

interface TrendSection {
    title: string
    subtitle: string
    points: TrendPoint[]
}

interface ExecutiveSummary {
    hero: ExecutiveHero
    processHealths: ProcessHealth[]
    riskSummary: RiskSummary
    trend: TrendSection
}

interface MetricCard {
    id: string
    label: string
    value: string
    tone: string
}

interface ChartDatum {
    label: string
    value: number
}

interface ChartSection {
    id: string
    title: string
    type: string
    items: ChartDatum[]
}

interface TableSection {
    id: string
    title: string
    columns: string[]
    rows: string[][]
}

interface TabContent {
    id: string
    label: string
    description: string
    executiveSummary: ExecutiveSummary | null
    slaAnalysis: unknown | null
    cards: MetricCard[]
    charts: ChartSection[]
    tables: TableSection[]
}

interface OverviewResponse {
    refreshedAt: string
    tabs: TabMeta[]
    tabContents: Record<string, TabContent>
}

function ExecutiveSummaryPanel({ summary }: { summary: ExecutiveSummary; cards: MetricCard[] }) {
    const totalRisks = summary.riskSummary.critical + summary.riskSummary.warning + summary.riskSummary.attention

    return (
        <div className="business-intelligence-dashboard-shell">
            <div className="business-intelligence-dashboard-stats">
                <section className="mon-kpi-card business-intelligence-dashboard-stat-card">
                    <span className="mon-kpi-label">健康分</span>
                    <strong className="mon-kpi-value">{summary.hero.score}</strong>
                    <p className="mon-kpi-sub">当前执行摘要的总览健康指标。</p>
                </section>
                <section className="mon-kpi-card business-intelligence-dashboard-stat-card">
                    <span className="mon-kpi-label">风险总数</span>
                    <strong className="mon-kpi-value">{totalRisks} 项</strong>
                    <p className="mon-kpi-sub">关键风险、预警与关注项将在下方工作区收敛。</p>
                </section>
            </div>

            <div className="business-intelligence-dashboard-grid">
                <section className="mon-chart-block mon-chart-card business-intelligence-dashboard-panel business-intelligence-dashboard-panel-primary">
                    <div className="mon-chart-card-head business-intelligence-dashboard-panel-header">
                        <div className="mon-chart-card-meta">
                            <h3>概览结论</h3>
                            <p className="mon-chart-subtitle">用于放置整体判断、摘要结论和本期核心变化。</p>
                        </div>
                    </div>
                    <div className="business-intelligence-dashboard-panel-body business-intelligence-dashboard-panel-body-tall" />
                </section>

                <div className="business-intelligence-dashboard-side">
                    <section className="mon-chart-block mon-chart-card business-intelligence-dashboard-panel">
                        <div className="mon-chart-card-head business-intelligence-dashboard-panel-header">
                            <div className="mon-chart-card-meta">
                                <h3>核心证据</h3>
                                <p className="mon-chart-subtitle">用于承载关键指标和辅助判断信息。</p>
                            </div>
                        </div>
                        <div className="business-intelligence-dashboard-panel-body" />
                    </section>

                    <section className="mon-chart-block mon-chart-card business-intelligence-dashboard-panel">
                        <div className="mon-chart-card-head business-intelligence-dashboard-panel-header">
                            <div className="mon-chart-card-meta">
                                <h3>重点风险</h3>
                                <p className="mon-chart-subtitle">用于收敛优先关注的风险与治理方向。</p>
                            </div>
                        </div>
                        <div className="business-intelligence-dashboard-panel-body" />
                    </section>
                </div>
            </div>

            <section className="mon-chart-block mon-chart-card business-intelligence-dashboard-panel business-intelligence-dashboard-panel-wide">
                <div className="mon-chart-card-head business-intelligence-dashboard-panel-header">
                    <div className="mon-chart-card-meta">
                        <h3>治理优先级</h3>
                        <p className="mon-chart-subtitle">用于布局治理动作、责任分工和当前关注事项。</p>
                    </div>
                </div>
                <div className="business-intelligence-dashboard-panel-body business-intelligence-dashboard-panel-body-wide" />
            </section>
        </div>
    )
}

export default function BusinessIntelligence() {
    const { t } = useTranslation()
    const { showToast } = useToast()
    const [overview, setOverview] = useState<OverviewResponse | null>(null)
    const [activeTabId, setActiveTabId] = useState<string>('executive-summary')
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const loadOverview = useCallback(async (options?: { forceRefresh?: boolean }) => {
        const forceRefresh = options?.forceRefresh === true
        if (forceRefresh) {
            setRefreshing(true)
        } else {
            setLoading(true)
        }
        setError(null)
        try {
            const response = await fetch(`${BUSINESS_INTELLIGENCE_SERVICE_URL}/${forceRefresh ? 'refresh' : 'overview'}`, {
                method: forceRefresh ? 'POST' : 'GET',
            })
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`)
            }
            const data = await response.json() as OverviewResponse
            setOverview(data)
            setActiveTabId(current => (data.tabs.length > 0 && !data.tabs.some(tab => tab.id === current) ? data.tabs[0].id : current))
            if (forceRefresh) {
                showToast('success', t('businessIntelligence.refreshSuccess'))
            }
        } catch (requestError) {
            const message = requestError instanceof Error ? requestError.message : t('common.unknownError')
            setError(message)
            if (forceRefresh) {
                showToast('error', t('businessIntelligence.refreshFailed', { error: message }))
            }
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [showToast, t])

    useEffect(() => {
        void loadOverview()
    }, [loadOverview])

    const activeTab = useMemo(() => {
        if (!overview) return null
        return overview.tabContents[activeTabId] || overview.tabContents[overview.tabs[0]?.id || ''] || null
    }, [activeTabId, overview])

    return (
        <div className="page-container sidebar-top-page business-intelligence-page">
            <div className="page-header business-intelligence-header">
                <div className="business-intelligence-header-copy">
                    <h1 className="page-title">{t('businessIntelligence.title')}</h1>
                    <p className="page-subtitle">{t('businessIntelligence.subtitle')}</p>
                </div>
                <div className="business-intelligence-header-actions">
                    <div className="business-intelligence-header-meta" aria-label={t('businessIntelligence.reportingPeriod')}>
                        <span className="business-intelligence-header-meta-label">{t('businessIntelligence.reportingPeriod')}</span>
                        <span className="business-intelligence-header-meta-value">{activeTab?.executiveSummary?.hero.periodLabel || '—'}</span>
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary business-intelligence-refresh-button"
                        onClick={() => void loadOverview({ forceRefresh: true })}
                        disabled={refreshing}
                        aria-label={refreshing ? t('businessIntelligence.refreshing') : t('businessIntelligence.refresh')}
                        title={refreshing ? t('businessIntelligence.refreshing') : t('businessIntelligence.refresh')}
                    >
                        <RefreshCw size={15} className={refreshing ? 'business-intelligence-refresh-icon spinning' : 'business-intelligence-refresh-icon'} />
                        <span className="visually-hidden">{refreshing ? t('businessIntelligence.refreshing') : t('businessIntelligence.refresh')}</span>
                    </button>
                </div>
            </div>

            {error ? (
                <div className="conn-banner conn-banner-error">
                    {t('common.connectionError', { error })}
                </div>
            ) : null}

            {loading ? (
                <div className="empty-state">
                    <div className="empty-state-title">{t('common.loading')}</div>
                    <div className="empty-state-description">{t('businessIntelligence.loadingDescription')}</div>
                </div>
            ) : overview && activeTab ? (
                <>
                    <div className="config-tabs business-intelligence-tabs" role="tablist" aria-label="业务智能分析标签">
                        {overview.tabs.map(tab => (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={tab.id === activeTab.id}
                                className={`config-tab ${tab.id === activeTab.id ? 'config-tab-active' : ''}`}
                                onClick={() => setActiveTabId(tab.id)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {activeTab.id === 'executive-summary' && activeTab.executiveSummary ? (
                        <ExecutiveSummaryPanel summary={activeTab.executiveSummary} cards={activeTab.cards} />
                    ) : (
                        <section className="business-intelligence-content-card">
                            <div className="empty-state">
                                <div className="empty-state-title">待建设</div>
                            </div>
                        </section>
                    )}
                </>
            ) : (
                <div className="empty-state">
                    <h3 className="empty-state-title">{t('businessIntelligence.emptyTitle')}</h3>
                    <p className="empty-state-description">{t('businessIntelligence.emptyDescription')}</p>
                </div>
            )}
        </div>
    )
}

export const CATEGORIES = [
    'all',
    'fault-diagnosis',
    'log-analysis',
    'performance',
    'ops-knowledge',
    'automation',
] as const

export type Category = (typeof CATEGORIES)[number]

export interface PromptTemplateConfig {
    id: string
    i18nKey: string
    category: Category
    icon: string
    agentId: string
}

export const PROMPT_TEMPLATES: PromptTemplateConfig[] = [
    // Fault Diagnosis (5)
    { id: 'fault-quick-check',     i18nKey: 'templates.faultQuickCheck',     category: 'fault-diagnosis', icon: 'AlertTriangle',  agentId: 'universal-agent' },
    { id: 'fault-root-cause',      i18nKey: 'templates.faultRootCause',      category: 'fault-diagnosis', icon: 'SearchCode',     agentId: 'universal-agent' },
    { id: 'fault-alarm-triage',    i18nKey: 'templates.faultAlarmTriage',     category: 'fault-diagnosis', icon: 'Bell',           agentId: 'universal-agent' },
    { id: 'fault-timeline',        i18nKey: 'templates.faultTimeline',        category: 'fault-diagnosis', icon: 'Clock',          agentId: 'universal-agent' },
    { id: 'fault-postmortem',      i18nKey: 'templates.faultPostmortem',      category: 'fault-diagnosis', icon: 'FileCheck',      agentId: 'universal-agent' },

    // Log Analysis (5)
    { id: 'log-error-analysis',    i18nKey: 'templates.logErrorAnalysis',     category: 'log-analysis',    icon: 'FileSearch',     agentId: 'universal-agent' },
    { id: 'log-pattern-detect',    i18nKey: 'templates.logPatternDetect',     category: 'log-analysis',    icon: 'Regex',          agentId: 'universal-agent' },
    { id: 'log-trace-correlation', i18nKey: 'templates.logTraceCorrelation',  category: 'log-analysis',    icon: 'GitBranch',      agentId: 'universal-agent' },
    { id: 'log-anomaly-detect',    i18nKey: 'templates.logAnomalyDetect',     category: 'log-analysis',    icon: 'TrendingUp',     agentId: 'universal-agent' },
    { id: 'log-filter-query',      i18nKey: 'templates.logFilterQuery',       category: 'log-analysis',    icon: 'Filter',         agentId: 'universal-agent' },

    // Performance Optimization (5)
    { id: 'perf-bottleneck',       i18nKey: 'templates.perfBottleneck',       category: 'performance',     icon: 'Gauge',          agentId: 'universal-agent' },
    { id: 'perf-db-tuning',        i18nKey: 'templates.perfDbTuning',         category: 'performance',     icon: 'Database',       agentId: 'universal-agent' },
    { id: 'perf-capacity-plan',    i18nKey: 'templates.perfCapacityPlan',     category: 'performance',     icon: 'BarChart3',      agentId: 'universal-agent' },
    { id: 'perf-cache-strategy',   i18nKey: 'templates.perfCacheStrategy',    category: 'performance',     icon: 'HardDrive',      agentId: 'universal-agent' },
    { id: 'perf-cost-optimize',    i18nKey: 'templates.perfCostOptimize',     category: 'performance',     icon: 'DollarSign',     agentId: 'universal-agent' },

    // Ops Knowledge Q&A (7: original 5 + risk review & dependency from change-risk)
    { id: 'kb-concept-explain',    i18nKey: 'templates.kbConceptExplain',     category: 'ops-knowledge',   icon: 'BookOpen',       agentId: 'universal-agent' },
    { id: 'kb-best-practice',      i18nKey: 'templates.kbBestPractice',       category: 'ops-knowledge',   icon: 'Award',          agentId: 'universal-agent' },
    { id: 'kb-arch-compare',       i18nKey: 'templates.kbArchCompare',        category: 'ops-knowledge',   icon: 'GitCompare',     agentId: 'universal-agent' },
    { id: 'kb-troubleshoot-guide', i18nKey: 'templates.kbTroubleshootGuide',  category: 'ops-knowledge',   icon: 'Wrench',         agentId: 'universal-agent' },
    { id: 'kb-security-qa',        i18nKey: 'templates.kbSecurityQa',         category: 'ops-knowledge',   icon: 'Lock',           agentId: 'universal-agent' },
    { id: 'change-risk-review',    i18nKey: 'templates.changeRiskReview',     category: 'ops-knowledge',   icon: 'ShieldAlert',    agentId: 'universal-agent' },
    { id: 'change-dependency',     i18nKey: 'templates.changeDependency',     category: 'ops-knowledge',   icon: 'GitPullRequest', agentId: 'universal-agent' },

    // Automation Scripts (7: original 5 + rollback plan & checklist from change-risk)
    { id: 'auto-shell-script',     i18nKey: 'templates.autoShellScript',      category: 'automation',      icon: 'Terminal',       agentId: 'universal-agent' },
    { id: 'auto-cron-job',         i18nKey: 'templates.autoCronJob',          category: 'automation',      icon: 'Timer',          agentId: 'universal-agent' },
    { id: 'auto-health-check',     i18nKey: 'templates.autoHealthCheck',      category: 'automation',      icon: 'HeartPulse',     agentId: 'universal-agent' },
    { id: 'auto-batch-ops',        i18nKey: 'templates.autoBatchOps',         category: 'automation',      icon: 'Layers',         agentId: 'universal-agent' },
    { id: 'auto-report-gen',       i18nKey: 'templates.autoReportGen',        category: 'automation',      icon: 'FileSpreadsheet', agentId: 'universal-agent' },
    { id: 'change-rollback-plan',  i18nKey: 'templates.changeRollbackPlan',   category: 'automation',      icon: 'Undo2',          agentId: 'universal-agent' },
    { id: 'change-checklist',      i18nKey: 'templates.changeChecklist',      category: 'automation',      icon: 'ClipboardCheck', agentId: 'universal-agent' },
]

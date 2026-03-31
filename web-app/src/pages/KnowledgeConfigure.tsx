import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useToast } from '../contexts/ToastContext'
import { usePreview } from '../contexts/PreviewContext'
import { KNOWLEDGE_SERVICE_URL } from '../config/runtime'
import { useKnowledgeSourceDetail } from '../hooks/useKnowledgeSourceDetail'
import { getErrorMessage } from '../utils/errorMessages'
import KnowledgeChunksTab from '../components/knowledge/KnowledgeChunksTab'
import KnowledgeRetrievalTab from '../components/knowledge/KnowledgeRetrievalTab'
import type { ResourceStatusTone } from '../components/ResourceCard'
import type {
    KnowledgeDocumentArtifacts,
    KnowledgeDocumentPreview,
    KnowledgeDocumentSummary,
    KnowledgeIngestResponse,
    KnowledgeJobResponse,
    KnowledgeMaintenanceFailure,
    KnowledgeMaintenanceJobSummary,
    KnowledgeProfileDetail,
    KnowledgeSource,
    PagedResponse,
} from '../types/knowledge'

type KnowledgeConfigureTab = 'basic' | 'documents' | 'chunks' | 'retrieval' | 'config' | 'maintenance'
type KnowledgeConfigRow = {
    key: string
    path?: string
    value: unknown
    descriptionKey?: string
    sourceKey?: string
}
type KnowledgeConfigGroup = { title: string; rows: KnowledgeConfigRow[] }
type KnowledgeConfigMeta = {
    sourceKey: string
}
type KnowledgeDocumentFilterStatus = 'ALL' | 'READY' | 'ATTENTION' | 'PROCESSING' | 'ERROR'
type UploadQueueStatus = 'pending' | 'uploading' | 'completed' | 'failed'
type UploadSessionState = 'idle' | 'uploading' | 'finished'

const UPLOAD_BATCH_MAX_FILES = 10
const UPLOAD_BATCH_MAX_SIZE_MB = 100

interface UploadQueueItem {
    id: string
    file: File
    status: UploadQueueStatus
    error: string | null
}

function formatDateTime(value?: string | null): string {
    if (!value) return '—'
    return new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function getKnowledgeStatusTone(source?: Pick<KnowledgeSource, 'status' | 'runtimeStatus'> | null): ResourceStatusTone {
    switch (source?.runtimeStatus?.toUpperCase()) {
    case 'MAINTENANCE':
        return 'warning'
    case 'ERROR':
        return 'danger'
    default:
        break
    }

    switch (source?.status?.toUpperCase()) {
    case 'ACTIVE':
        return 'success'
    case 'DISABLED':
        return 'neutral'
    default:
        return 'neutral'
    }
}

function getKnowledgeStatusLabel(
    source: Pick<KnowledgeSource, 'status' | 'runtimeStatus'> | null | undefined,
    t: (key: string) => string
): string {
    switch (source?.runtimeStatus?.toUpperCase()) {
    case 'MAINTENANCE':
        return t('knowledge.runtimeStatusMaintenance')
    case 'ERROR':
        return t('knowledge.runtimeStatusError')
    default:
        break
    }

    switch (source?.status?.toUpperCase()) {
    case 'ACTIVE':
        return t('knowledge.statusActive')
    case 'DISABLED':
        return t('knowledge.statusDisabled')
    default:
        return source?.status || t('knowledge.statusUnknown')
    }
}

function parseTab(value: string | null): KnowledgeConfigureTab {
    switch (value) {
    case 'basic':
    case 'documents':
    case 'chunks':
    case 'retrieval':
    case 'config':
    case 'maintenance':
        return value
    default:
        return 'basic'
    }
}

function getMaintenanceJobTone(job: KnowledgeMaintenanceJobSummary | null | undefined): ResourceStatusTone {
    switch (job?.status?.toUpperCase()) {
    case 'FAILED':
        return 'danger'
    case 'RUNNING':
    case 'PENDING':
        return 'warning'
    case 'SUCCEEDED':
        return 'success'
    default:
        return 'neutral'
    }
}

function getMaintenanceJobStatusLabel(job: KnowledgeMaintenanceJobSummary | null | undefined, t: (key: string) => string): string {
    switch (job?.status?.toUpperCase()) {
    case 'PENDING':
        return t('knowledge.maintenanceStatusPending')
    case 'RUNNING':
        return t('knowledge.maintenanceStatusRunning')
    case 'SUCCEEDED':
        return t('knowledge.maintenanceStatusSucceeded')
    case 'FAILED':
        return t('knowledge.maintenanceStatusFailed')
    default:
        return t('knowledge.notAvailable')
    }
}

function getMaintenanceStageLabel(stage: string | null | undefined, t: (key: string) => string): string {
    switch ((stage || '').toUpperCase()) {
    case 'PREPARING':
        return t('knowledge.maintenanceStagePreparing')
    case 'CLEANING':
        return t('knowledge.maintenanceStageCleaning')
    case 'PARSING':
        return t('knowledge.maintenanceStageParsing')
    case 'CHUNKING':
        return t('knowledge.maintenanceStageChunking')
    case 'INDEXING':
        return t('knowledge.maintenanceStageIndexing')
    case 'COMPLETED':
        return t('knowledge.maintenanceStageCompleted')
    default:
        return t('knowledge.notAvailable')
    }
}

function humanizeKey(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_]/g, ' ')
        .replace(/^\w/, char => char.toUpperCase())
}

function stripSectionPrefix(path: string): string {
    const segments = path.split('.')
    return segments.length > 1 ? segments.slice(1).join('.') : path
}

const INDEX_PARAM_DESCRIPTION_KEYS: Record<string, string> = {
    'convert.engine': 'knowledge.configDescConvertEngine',
    'analysis.language': 'knowledge.configDescAnalysisLanguage',
    'analysis.indexAnalyzer': 'knowledge.configDescIndexAnalyzer',
    'analysis.queryAnalyzer': 'knowledge.configDescQueryAnalyzer',
    'chunking.mode': 'knowledge.configDescChunkingMode',
    'chunking.targetTokens': 'knowledge.configDescChunkingTargetTokens',
    'chunking.overlapTokens': 'knowledge.configDescChunkingOverlapTokens',
    'chunking.respectHeadings': 'knowledge.configDescChunkingRespectHeadings',
    'chunking.keepTablesWhole': 'knowledge.configDescChunkingKeepTablesWhole',
    'indexing.titleBoost': 'knowledge.configDescTitleBoost',
    'indexing.titlePathBoost': 'knowledge.configDescTitlePathBoost',
    'indexing.keywordBoost': 'knowledge.configDescKeywordBoost',
    'indexing.contentBoost': 'knowledge.configDescContentBoost',
    'indexing.bm25.k1': 'knowledge.configDescBm25K1',
    'indexing.bm25.b': 'knowledge.configDescBm25B',
}

const RETRIEVAL_PARAM_DESCRIPTION_KEYS: Record<string, string> = {
    'retrieval.mode': 'knowledge.configDescRetrievalMode',
    'retrieval.lexicalTopK': 'knowledge.configDescLexicalTopK',
    'retrieval.semanticTopK': 'knowledge.configDescSemanticTopK',
    'retrieval.rrfK': 'knowledge.configDescRrfK',
    'retrieval.strategy': 'knowledge.configDescRetrievalStrategy',
    'result.finalTopK': 'knowledge.configDescFinalTopK',
    'result.snippetLength': 'knowledge.configDescSnippetLength',
}

const DEFAULTS_PARAM_DESCRIPTION_KEYS: Record<string, string> = {
    'ingest.maxFileSizeMb': 'knowledge.configDescIngestMaxFileSizeMb',
    'ingest.allowedContentTypes': 'knowledge.configDescIngestAllowedContentTypes',
    'ingest.deduplication': 'knowledge.configDescIngestDeduplication',
    'ingest.skipExistingByDefault': 'knowledge.configDescIngestSkipExisting',
    'chunking.mode': 'knowledge.configDescChunkingMode',
    'chunking.targetTokens': 'knowledge.configDescChunkingTargetTokens',
    'chunking.overlapTokens': 'knowledge.configDescChunkingOverlapTokens',
    'chunking.respectHeadings': 'knowledge.configDescChunkingRespectHeadings',
    'chunking.keepTablesWhole': 'knowledge.configDescChunkingKeepTablesWhole',
    'retrieval.mode': 'knowledge.configDescRetrievalMode',
    'retrieval.lexicalTopK': 'knowledge.configDescLexicalTopK',
    'retrieval.semanticTopK': 'knowledge.configDescSemanticTopK',
    'retrieval.finalTopK': 'knowledge.configDescFinalTopK',
    'retrieval.rrfK': 'knowledge.configDescRrfK',
    'features.allowChunkEdit': 'knowledge.configDescFeatureAllowChunkEdit',
    'features.allowChunkDelete': 'knowledge.configDescFeatureAllowChunkDelete',
    'features.allowExplain': 'knowledge.configDescFeatureAllowExplain',
    'features.allowRequestOverride': 'knowledge.configDescFeatureAllowRequestOverride',
}

const CAPABILITY_PARAM_DESCRIPTION_KEYS: Record<string, string> = {
    'retrievalModes': 'knowledge.configDescCapabilityRetrievalModes',
    'chunkModes': 'knowledge.configDescCapabilityChunkModes',
    'expandModes': 'knowledge.configDescCapabilityExpandModes',
    'analyzers': 'knowledge.configDescCapabilityAnalyzers',
    'editableChunkFields': 'knowledge.configDescCapabilityEditableChunkFields',
    'featureFlags.allowChunkEdit': 'knowledge.configDescFeatureAllowChunkEdit',
    'featureFlags.allowChunkDelete': 'knowledge.configDescFeatureAllowChunkDelete',
    'featureFlags.allowExplain': 'knowledge.configDescFeatureAllowExplain',
    'featureFlags.allowRequestOverride': 'knowledge.configDescFeatureAllowRequestOverride',
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function flattenConfigRows(
    value: unknown,
    prefix = '',
    depth = 0
): KnowledgeConfigRow[] {
    if (value === null || value === undefined) {
        return []
    }

    if (Array.isArray(value)) {
        return value.length > 0 ? [{ key: prefix || 'items', value }] : []
    }

    if (isPlainRecord(value)) {
        if (depth >= 3) {
            return [{ key: prefix || 'value', value: JSON.stringify(value) }]
        }

        return Object.entries(value).flatMap(([childKey, childValue]) => {
            const nextPrefix = prefix ? `${prefix}.${childKey}` : childKey
            return flattenConfigRows(childValue, nextPrefix, depth + 1)
        })
    }

    return [{
        key: prefix || 'value',
        value,
    }]
}

function buildConfigGroups(config: Record<string, unknown> | null | undefined): KnowledgeConfigGroup[] {
    if (!config) return []

    return Object.entries(config)
        .map(([key, value]) => {
            if (isPlainRecord(value)) {
                return {
                    title: humanizeKey(key),
                    rows: flattenConfigRows(value).map(row => ({
                        key: row.key,
                        path: `${key}.${row.key}`,
                        value: row.value,
                    })),
                }
            }

            return {
                title: humanizeKey(key),
                rows: [{
                    key,
                    path: key,
                    value,
                }],
            }
        })
        .filter(group => group.rows.length > 0)
}

function withConfigRowMetadata(
    groups: KnowledgeConfigGroup[],
    meta: KnowledgeConfigMeta,
    descriptionKeys: Record<string, string>
): KnowledgeConfigGroup[] {
    return groups.map(group => ({
        ...group,
        rows: group.rows.map(row => {
            const rowPath = row.path || row.key
            const normalizedKey = stripSectionPrefix(rowPath)
            return {
                ...row,
                descriptionKey: descriptionKeys[rowPath] || descriptionKeys[normalizedKey] || 'knowledge.configDescriptionFallback',
                sourceKey: meta.sourceKey,
            }
        }),
    }))
}

function getProfileName(profile: KnowledgeProfileDetail | null, fallbackId: string | null | undefined, fallback: string): string {
    if (profile?.name) return profile.name
    if (fallbackId) return fallbackId
    return fallback
}

function formatConfigPrimitive(value: unknown, t: (key: string) => string): string {
    if (typeof value === 'boolean') {
        return value ? t('knowledge.enabled') : t('knowledge.disabled')
    }
    if (value === null || value === undefined || value === '') {
        return t('knowledge.notAvailable')
    }
    return String(value)
}

function renderConfigValue(value: unknown, t: (key: string) => string) {
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return <span className="knowledge-inline-empty">{t('knowledge.notAvailable')}</span>
        }

        return (
            <div className="resource-card-tags knowledge-config-value-tags">
                {value.map(item => (
                    <span key={String(item)} className="resource-card-tag">
                        {String(item)}
                    </span>
                ))}
            </div>
        )
    }

    return formatConfigPrimitive(value, t)
}

function getConfigSection(config: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> {
    const value = config?.[key]
    return isPlainRecord(value) ? value : {}
}

function getConfigString(
    config: Record<string, unknown> | null | undefined,
    section: string,
    key: string,
    fallback = ''
): string {
    const value = getConfigSection(config, section)[key]
    return typeof value === 'string' ? value : fallback
}

function getConfigNumber(
    config: Record<string, unknown> | null | undefined,
    section: string,
    key: string,
    fallback: number
): number {
    const value = getConfigSection(config, section)[key]
    return typeof value === 'number' ? value : fallback
}

function ProfileReadonlyCard({
    title,
    description,
    bindingName,
    bindingId,
    groups,
    actionLabel,
    onEdit,
    actionDisabled = false,
}: {
    title: string
    description?: string
    bindingName: string
    bindingId: string
    groups: KnowledgeConfigGroup[]
    actionLabel: string
    onEdit: () => void
    actionDisabled?: boolean
}) {
    const { t } = useTranslation()

    return (
        <section className="knowledge-section-card">
            <div className="knowledge-section-header">
                <div>
                    <h2 className="knowledge-section-title">{title}</h2>
                    {description ? <p className="knowledge-section-description">{description}</p> : null}
                </div>
                <button type="button" className="btn btn-secondary knowledge-section-action" onClick={onEdit} disabled={actionDisabled}>
                    {actionLabel}
                </button>
            </div>

            <div className="knowledge-kv-grid knowledge-kv-grid-compact">
                <div className="knowledge-kv-item">
                    <span className="knowledge-kv-label">{t('knowledge.profileName')}</span>
                    <span className="knowledge-kv-value">{bindingName}</span>
                </div>
                <div className="knowledge-kv-item">
                    <span className="knowledge-kv-label">{t('knowledge.profileId')}</span>
                    <span className="knowledge-kv-meta">{bindingId}</span>
                </div>
            </div>

            <div className="knowledge-config-readonly-groups">
                {groups.map(group => (
                    <section key={`${title}-${group.title}`} className="knowledge-config-readonly-group">
                        <h3 className="knowledge-config-group-title">{group.title}</h3>
                        <div className="knowledge-config-head">
                            <span className="knowledge-config-head-cell">{t('knowledge.configColumnParameter')}</span>
                            <span className="knowledge-config-head-cell">{t('knowledge.configColumnValue')}</span>
                            <span className="knowledge-config-head-cell">{t('knowledge.configColumnDetails')}</span>
                            <span className="knowledge-config-head-cell">{t('knowledge.configSourceLabel')}</span>
                        </div>
                        <div className="knowledge-config-readonly-rows">
                            {group.rows.map(row => (
                                <div key={`${group.title}-${row.key}`} className="knowledge-config-readonly-row">
                                    <span className="knowledge-config-key">{row.key}</span>
                                    <div className="knowledge-config-value">{renderConfigValue(row.value, t)}</div>
                                    <span className="knowledge-config-meta-cell">{t(row.descriptionKey || 'knowledge.configDescriptionFallback')}</span>
                                    <span className="knowledge-config-meta-cell">{t(row.sourceKey || 'knowledge.configSourceUnknown')}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </section>
    )
}

function ConfigGroupRows({
    title,
    rows,
    meta,
}: {
    title: string
    rows: KnowledgeConfigRow[]
    meta: KnowledgeConfigMeta
}) {
    const { t } = useTranslation()

    return (
        <section className="knowledge-config-group">
            <h3 className="knowledge-config-group-title">{title}</h3>
            <div className="knowledge-config-head">
                <span className="knowledge-config-head-cell">{t('knowledge.configColumnParameter')}</span>
                <span className="knowledge-config-head-cell">{t('knowledge.configColumnValue')}</span>
                <span className="knowledge-config-head-cell">{t('knowledge.configColumnDetails')}</span>
                <span className="knowledge-config-head-cell">{t('knowledge.configSourceLabel')}</span>
            </div>
            <div className="knowledge-config-rows">
                {rows.map(row => (
                    <div key={`${title}-${row.key}`} className="knowledge-config-row">
                        <span className="knowledge-config-key">{row.key}</span>
                        <div className="knowledge-config-value">
                            {renderConfigValue(row.value, t)}
                        </div>
                        <span className="knowledge-config-meta-cell">{t(row.descriptionKey || 'knowledge.configDescriptionFallback')}</span>
                        <span className="knowledge-config-meta-cell">{t(row.sourceKey || meta.sourceKey)}</span>
                    </div>
                ))}
            </div>
        </section>
    )
}

function MaintenanceTab({
    maintenance,
    failureItems,
    failuresLoading,
    onToggleFailures,
    sourceUnavailable,
    isMaintenanceMode,
    isRuntimeError,
    isRebuildingSource,
    onRebuild,
}: {
    maintenance: { currentJob: KnowledgeMaintenanceJobSummary | null; lastCompletedJob: KnowledgeMaintenanceJobSummary | null } | null
    failureItems: KnowledgeMaintenanceFailure[]
    failuresLoading: boolean
    onToggleFailures: () => void
    sourceUnavailable: boolean
    isMaintenanceMode: boolean
    isRuntimeError: boolean
    isRebuildingSource: boolean
    onRebuild: () => void
}) {
    const { t } = useTranslation()
    const currentJob = maintenance?.currentJob || null
    const lastCompletedJob = maintenance?.lastCompletedJob || null
    const totalDocuments = Math.max(currentJob?.totalDocuments || 0, 0)
    const processedDocuments = Math.max(currentJob?.processedDocuments || 0, 0)
    const progressPercent = totalDocuments > 0 ? Math.min(100, Math.round((processedDocuments / totalDocuments) * 100)) : 0

    return (
        <div className="knowledge-config-stack">
            <section className="knowledge-section-card">
                <div className="knowledge-section-header">
                    <div>
                        <h2 className="knowledge-section-title">{t('knowledge.maintenanceCurrentTaskTitle')}</h2>
                        <p className="knowledge-section-description">{t('knowledge.maintenanceCurrentTaskDescription')}</p>
                    </div>
                </div>

                {currentJob ? (
                    <div className="knowledge-config-stack">
                        <div className="knowledge-configure-title-line">
                            <span className={`resource-status resource-status-${getMaintenanceJobTone(currentJob)}`}>
                                {getMaintenanceJobStatusLabel(currentJob, t)}
                            </span>
                            <span className="knowledge-kv-meta">{getMaintenanceStageLabel(currentJob.stage, t)}</span>
                        </div>
                        <div>
                            <div className="knowledge-progress-track" aria-hidden="true">
                                <div className="knowledge-progress-fill" style={{ width: `${progressPercent}%` }} />
                            </div>
                            <div className="knowledge-kv-meta" style={{ marginTop: 'var(--spacing-2)' }}>
                                {t('knowledge.maintenanceProgressValue', { processed: processedDocuments, total: totalDocuments })}
                            </div>
                        </div>

                        <div className="knowledge-kv-grid knowledge-kv-grid-compact">
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.maintenanceCurrentDocument')}</span>
                                <span className="knowledge-kv-value">{currentJob.currentDocumentName || t('knowledge.notAvailable')}</span>
                            </div>
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.failedDocuments')}</span>
                                <span className="knowledge-kv-value">{currentJob.failedDocuments}</span>
                            </div>
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.maintenanceTriggeredBy')}</span>
                                <span className="knowledge-kv-value">{currentJob.createdBy || t('knowledge.notAvailable')}</span>
                            </div>
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.maintenanceStartedAt')}</span>
                                <span className="knowledge-kv-value">{formatDateTime(currentJob.startedAt)}</span>
                            </div>
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.maintenanceUpdatedAt')}</span>
                                <span className="knowledge-kv-value">{formatDateTime(currentJob.updatedAt)}</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="knowledge-empty-state">
                        <div className="knowledge-empty-title">{t('knowledge.maintenanceNoCurrentTask')}</div>
                    </div>
                )}
            </section>

            <section className="knowledge-section-card">
                <div className="knowledge-section-header">
                    <div>
                        <h2 className="knowledge-section-title">{t('knowledge.maintenanceLastJobTitle')}</h2>
                        <p className="knowledge-section-description">{t('knowledge.maintenanceLastJobDescription')}</p>
                    </div>
                </div>

                {lastCompletedJob ? (
                    <div className="knowledge-config-stack">
                        <div className="knowledge-configure-title-line">
                            <span className={`resource-status resource-status-${getMaintenanceJobTone(lastCompletedJob)}`}>
                                {getMaintenanceJobStatusLabel(lastCompletedJob, t)}
                            </span>
                            <span className="knowledge-kv-meta">{getMaintenanceStageLabel(lastCompletedJob.stage, t)}</span>
                        </div>
                        <div className="knowledge-kv-grid knowledge-kv-grid-compact">
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.maintenanceStartedAt')}</span>
                                <span className="knowledge-kv-value">{formatDateTime(lastCompletedJob.startedAt)}</span>
                            </div>
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.maintenanceFinishedAt')}</span>
                                <span className="knowledge-kv-value">{formatDateTime(lastCompletedJob.finishedAt)}</span>
                            </div>
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.documents')}</span>
                                <span className="knowledge-kv-value">{lastCompletedJob.totalDocuments}</span>
                            </div>
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.maintenanceSucceededDocuments')}</span>
                                <span className="knowledge-kv-value">{lastCompletedJob.successDocuments}</span>
                            </div>
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.failedDocuments')}</span>
                                <span className="knowledge-kv-value">{lastCompletedJob.failedDocuments}</span>
                            </div>
                            <div className="knowledge-kv-item">
                                <span className="knowledge-kv-label">{t('knowledge.maintenanceErrorSummary')}</span>
                                <span className="knowledge-kv-value">{lastCompletedJob.errorSummary || t('knowledge.notAvailable')}</span>
                            </div>
                        </div>

                        {lastCompletedJob.failedDocuments > 0 && (
                            <div className="knowledge-config-stack">
                                <div className="knowledge-section-header knowledge-section-header-compact">
                                    <div>
                                        <h3 className="knowledge-config-group-title">{t('knowledge.maintenanceFailuresTitle')}</h3>
                                    </div>
                                    <button type="button" className="btn btn-secondary knowledge-section-action" onClick={onToggleFailures}>
                                        {t('knowledge.maintenanceFailuresAction')}
                                    </button>
                                </div>
                                {failuresLoading && (
                                    <div className="knowledge-empty-state">
                                        <div className="knowledge-empty-title">{t('common.loading')}</div>
                                    </div>
                                )}
                                {!failuresLoading && failureItems.length > 0 && (
                                    <div className="knowledge-action-list">
                                        {failureItems.map(item => (
                                            <div key={`${item.documentId || item.documentName}-${item.finishedAt}`} className="knowledge-action-item">
                                                <div className="knowledge-action-copy">
                                                    <span className="knowledge-kv-label">{item.documentName || item.documentId || t('knowledge.notAvailable')}</span>
                                                    <p className="knowledge-action-text">
                                                        {getMaintenanceStageLabel(item.stage, t)} · {item.errorCode || t('knowledge.notAvailable')}
                                                    </p>
                                                    <p className="knowledge-action-text">{item.message}</p>
                                                    <p className="knowledge-kv-meta">{formatDateTime(item.finishedAt)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="knowledge-empty-state">
                        <div className="knowledge-empty-title">{t('knowledge.maintenanceNoHistory')}</div>
                    </div>
                )}
            </section>

            <section className="knowledge-section-card">
                <div className="knowledge-section-header">
                    <div>
                        <h2 className="knowledge-section-title">{t('knowledge.maintenanceActionsTitle')}</h2>
                        <p className="knowledge-section-description">{t('knowledge.maintenanceActionsDescription')}</p>
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary knowledge-section-action"
                        onClick={onRebuild}
                        disabled={sourceUnavailable || isRebuildingSource}
                    >
                        {isMaintenanceMode || isRebuildingSource ? t('knowledge.rebuilding') : isRuntimeError ? t('knowledge.rebuildRetryAction') : t('knowledge.rebuildAction')}
                    </button>
                </div>

                <div className="knowledge-action-list">
                    <div className="knowledge-action-item knowledge-action-item-single">
                        <div className="knowledge-action-copy">
                            <span className="knowledge-kv-label">{t('knowledge.rebuildTitle')}</span>
                            <p className="knowledge-action-text">{t('knowledge.rebuildHint')}</p>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    )
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getDocumentDownloadUrl(documentId: string): string {
    return `${KNOWLEDGE_SERVICE_URL}/ops-knowledge/documents/${documentId}/original`
}

function getFilenameFromDisposition(disposition: string | null, fallback: string): string {
    if (!disposition) return fallback

    const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
    if (encodedMatch) {
        try {
            return decodeURIComponent(encodedMatch[1])
        } catch {
            return encodedMatch[1]
        }
    }

    const quotedMatch = disposition.match(/filename="([^"]+)"/i)
    if (quotedMatch) return quotedMatch[1]

    const bareMatch = disposition.match(/filename=([^;]+)/i)
    if (bareMatch) return bareMatch[1].trim()

    return fallback
}

function triggerDocumentDownload(blob: Blob, filename: string): void {
    const objectUrl = window.URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')

    anchor.href = objectUrl
    anchor.download = filename
    window.document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(objectUrl)
}

function getDocumentDisplayTitle(document: Pick<KnowledgeDocumentSummary, 'name' | 'title'>): string {
    return document.title?.trim() || document.name
}

function getDocumentType(document: Pick<KnowledgeDocumentSummary, 'name' | 'contentType'>): string {
    const lowerName = document.name.toLowerCase()
    const extension = lowerName.includes('.') ? lowerName.split('.').pop() || '' : ''
    if (extension) return extension

    const contentType = document.contentType.toLowerCase()
    if (contentType.includes('pdf')) return 'pdf'
    if (contentType.includes('markdown')) return 'md'
    if (contentType.includes('html')) return 'html'
    if (contentType.includes('wordprocessingml')) return 'docx'
    if (contentType.includes('presentationml')) return 'pptx'
    if (contentType.includes('spreadsheetml')) return 'xlsx'
    if (contentType.includes('text/plain')) return 'txt'
    return contentType
}

function getArtifactsLabel(artifacts: KnowledgeDocumentArtifacts | undefined, t: (key: string) => string): string {
    if (!artifacts) return t('knowledge.docArtifactsUnknown')
    const labels: string[] = []
    if (artifacts.markdown) labels.push('MD')
    return labels.length > 0 ? labels.join(' / ') : t('knowledge.docArtifactsMissing')
}

function getDocumentHealthStatus(
    document: KnowledgeDocumentSummary,
    artifacts: KnowledgeDocumentArtifacts | undefined
): { filter: KnowledgeDocumentFilterStatus; tone: ResourceStatusTone; labelKey: string; reasonKey: string | null } {
    const normalizedStatus = document.status.toUpperCase()
    const normalizedIndexStatus = document.indexStatus.toUpperCase()
    const hasArtifacts = Boolean(artifacts?.markdown)

    if (normalizedStatus === 'ERROR') {
        return { filter: 'ERROR', tone: 'danger', labelKey: 'knowledge.docStatusError', reasonKey: 'knowledge.docReasonDocumentError' }
    }

    if (normalizedStatus === 'PROCESSING') {
        return { filter: 'PROCESSING', tone: 'warning', labelKey: 'knowledge.docStatusProcessing', reasonKey: 'knowledge.docReasonProcessing' }
    }

    if (normalizedStatus === 'INDEXED' && normalizedIndexStatus === 'INDEXED' && hasArtifacts && document.chunkCount > 0) {
        return { filter: 'READY', tone: 'success', labelKey: 'knowledge.docStatusReady', reasonKey: null }
    }

    if (!hasArtifacts) {
        return { filter: 'ATTENTION', tone: 'warning', labelKey: 'knowledge.docStatusAttention', reasonKey: 'knowledge.docReasonArtifactsMissing' }
    }

    if (document.chunkCount === 0) {
        return { filter: 'ATTENTION', tone: 'warning', labelKey: 'knowledge.docStatusAttention', reasonKey: 'knowledge.docReasonNoChunks' }
    }

    return { filter: 'ATTENTION', tone: 'warning', labelKey: 'knowledge.docStatusAttention', reasonKey: 'knowledge.docReasonNeedsReview' }
}

function isAllowedUploadFile(
    file: File,
    maxFileSizeMb: number | undefined,
    allowedContentTypes: string[] | undefined
): string | null {
    if (maxFileSizeMb && file.size > maxFileSizeMb * 1024 * 1024) {
        return 'knowledge.uploadFileTooLarge'
    }

    if (allowedContentTypes && allowedContentTypes.length > 0 && file.type && !allowedContentTypes.includes(file.type)) {
        return 'knowledge.uploadTypeUnsupported'
    }

    return null
}

function appendFilesToQueue(
    files: File[],
    currentItems: UploadQueueItem[],
    maxFileSizeMb: number | undefined,
    allowedContentTypes: string[] | undefined
): UploadQueueItem[] {
    const existingKeys = new Set(currentItems.map(item => `${item.file.name}:${item.file.size}:${item.file.lastModified}`))
    const nextItems = [...currentItems]

    for (const file of files) {
        const key = `${file.name}:${file.size}:${file.lastModified}`
        if (existingKeys.has(key)) continue
        existingKeys.add(key)

        nextItems.push({
            id: key,
            file,
            status: 'pending',
            error: isAllowedUploadFile(file, maxFileSizeMb, allowedContentTypes),
        })
    }

    return nextItems
}

function EditBasicInfoModal({
    source,
    onClose,
    onSave,
}: {
    source: KnowledgeSource
    onClose: () => void
    onSave: (updates: { name: string; description: string | null }) => Promise<boolean>
}) {
    const { t } = useTranslation()
    const [name, setName] = useState(source.name)
    const [description, setDescription] = useState(source.description || '')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSave = useCallback(async () => {
        setError(null)

        if (!name.trim()) {
            setError(t('knowledge.nameRequired'))
            return
        }

        setSaving(true)
        const success = await onSave({
            name: name.trim(),
            description: description.trim() || null,
        })

        if (!success) {
            setError(t('knowledge.saveFailed'))
            setSaving(false)
            return
        }

        setSaving(false)
        onClose()
    }, [description, name, onClose, onSave, t])

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={event => event.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('knowledge.editBasicInfoTitle')}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {error && (
                        <div className="agents-alert agents-alert-error" style={{ marginBottom: 'var(--spacing-4)' }}>
                            {error}
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label" htmlFor="knowledge-basic-name-input">{t('knowledge.name')}</label>
                        <input
                            id="knowledge-basic-name-input"
                            className="form-input"
                            type="text"
                            value={name}
                            onChange={event => setName(event.target.value)}
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="knowledge-basic-description-input">{t('knowledge.description')}</label>
                        <textarea
                            id="knowledge-basic-description-input"
                            className="form-input"
                            rows={4}
                            value={description}
                            onChange={event => setDescription(event.target.value)}
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                        {t('common.cancel')}
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={saving || !name.trim()}
                    >
                        {saving ? t('knowledge.saving') : t('common.save')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function EditIndexProfileModal({
    name,
    analyzerOptions,
    indexAnalyzer,
    queryAnalyzer,
    titleBoost,
    titlePathBoost,
    keywordBoost,
    contentBoost,
    bm25K1,
    bm25B,
    saving,
    onClose,
    onNameChange,
    onIndexAnalyzerChange,
    onQueryAnalyzerChange,
    onTitleBoostChange,
    onTitlePathBoostChange,
    onKeywordBoostChange,
    onContentBoostChange,
    onBm25K1Change,
    onBm25BChange,
    onSave,
}: {
    name: string
    analyzerOptions: string[]
    indexAnalyzer: string
    queryAnalyzer: string
    titleBoost: string
    titlePathBoost: string
    keywordBoost: string
    contentBoost: string
    bm25K1: string
    bm25B: string
    saving: boolean
    onClose: () => void
    onNameChange: (value: string) => void
    onIndexAnalyzerChange: (value: string) => void
    onQueryAnalyzerChange: (value: string) => void
    onTitleBoostChange: (value: string) => void
    onTitlePathBoostChange: (value: string) => void
    onKeywordBoostChange: (value: string) => void
    onContentBoostChange: (value: string) => void
    onBm25K1Change: (value: string) => void
    onBm25BChange: (value: string) => void
    onSave: () => void
}) {
    const { t } = useTranslation()

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal knowledge-profile-config-modal" onClick={event => event.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('knowledge.indexProfileEditorTitle')}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    <div className="knowledge-profile-editor-grid">
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.profileName')}</span>
                            <input className="form-input" value={name} onChange={event => onNameChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.indexAnalyzerLabel')}</span>
                            <select className="form-input" value={indexAnalyzer} onChange={event => onIndexAnalyzerChange(event.target.value)}>
                                {analyzerOptions.map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.queryAnalyzerLabel')}</span>
                            <select className="form-input" value={queryAnalyzer} onChange={event => onQueryAnalyzerChange(event.target.value)}>
                                {analyzerOptions.map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.titleBoostLabel')}</span>
                            <input className="form-input" inputMode="decimal" value={titleBoost} onChange={event => onTitleBoostChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.titlePathBoostLabel')}</span>
                            <input className="form-input" inputMode="decimal" value={titlePathBoost} onChange={event => onTitlePathBoostChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.keywordBoostLabel')}</span>
                            <input className="form-input" inputMode="decimal" value={keywordBoost} onChange={event => onKeywordBoostChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.contentBoostLabel')}</span>
                            <input className="form-input" inputMode="decimal" value={contentBoost} onChange={event => onContentBoostChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.bm25K1Label')}</span>
                            <input className="form-input" inputMode="decimal" value={bm25K1} onChange={event => onBm25K1Change(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.bm25BLabel')}</span>
                            <input className="form-input" inputMode="decimal" value={bm25B} onChange={event => onBm25BChange(event.target.value)} />
                        </label>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                        {t('common.cancel')}
                    </button>
                    <button className="btn btn-primary" onClick={onSave} disabled={saving}>
                        {saving ? t('knowledge.savingConfig') : t('knowledge.saveConfig')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function EditRetrievalProfileModal({
    name,
    retrievalModes,
    retrievalMode,
    lexicalTopK,
    semanticTopK,
    finalTopK,
    rrfK,
    snippetLength,
    saving,
    onClose,
    onNameChange,
    onModeChange,
    onLexicalTopKChange,
    onSemanticTopKChange,
    onFinalTopKChange,
    onRrfKChange,
    onSnippetLengthChange,
    onSave,
}: {
    name: string
    retrievalModes: string[]
    retrievalMode: string
    lexicalTopK: string
    semanticTopK: string
    finalTopK: string
    rrfK: string
    snippetLength: string
    saving: boolean
    onClose: () => void
    onNameChange: (value: string) => void
    onModeChange: (value: string) => void
    onLexicalTopKChange: (value: string) => void
    onSemanticTopKChange: (value: string) => void
    onFinalTopKChange: (value: string) => void
    onRrfKChange: (value: string) => void
    onSnippetLengthChange: (value: string) => void
    onSave: () => void
}) {
    const { t } = useTranslation()

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal knowledge-profile-config-modal" onClick={event => event.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('knowledge.retrievalProfileEditorTitle')}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    <div className="knowledge-profile-editor-grid">
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.profileName')}</span>
                            <input className="form-input" value={name} onChange={event => onNameChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.retrievalMode')}</span>
                            <select className="form-input" value={retrievalMode} onChange={event => onModeChange(event.target.value)}>
                                {retrievalModes.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                            </select>
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.lexicalTopKLabel')}</span>
                            <input className="form-input" inputMode="numeric" value={lexicalTopK} onChange={event => onLexicalTopKChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.semanticTopKLabel')}</span>
                            <input className="form-input" inputMode="numeric" value={semanticTopK} onChange={event => onSemanticTopKChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.finalTopKLabel')}</span>
                            <input className="form-input" inputMode="numeric" value={finalTopK} onChange={event => onFinalTopKChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.rrfKLabel')}</span>
                            <input className="form-input" inputMode="numeric" value={rrfK} onChange={event => onRrfKChange(event.target.value)} />
                        </label>
                        <label className="knowledge-profile-field">
                            <span className="knowledge-kv-label">{t('knowledge.snippetLengthLabel')}</span>
                            <input className="form-input" inputMode="numeric" value={snippetLength} onChange={event => onSnippetLengthChange(event.target.value)} />
                        </label>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                        {t('common.cancel')}
                    </button>
                    <button className="btn btn-primary" onClick={onSave} disabled={saving}>
                        {saving ? t('knowledge.savingConfig') : t('knowledge.saveConfig')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function DeleteKnowledgeModal({
    sourceName,
    error,
    deleting,
    onClose,
    onConfirm,
}: {
    sourceName: string
    error: string | null
    deleting: boolean
    onClose: () => void
    onConfirm: () => void
}) {
    const { t } = useTranslation()

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={event => event.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('knowledge.deleteTitle')}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {error && (
                        <div className="agents-alert agents-alert-error" style={{ marginBottom: 'var(--spacing-4)' }}>
                            {error}
                        </div>
                    )}

                    <p style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text-primary)', marginBottom: 'var(--spacing-4)' }}>
                        {t('knowledge.deleteConfirm', { name: sourceName })}
                    </p>

                    <div className="agents-alert agents-alert-warning" style={{ marginBottom: 0 }}>
                        {t('knowledge.deleteWarning')}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={deleting}>
                        {t('common.cancel')}
                    </button>
                    <button className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
                        {deleting ? t('knowledge.deleting') : t('common.delete')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function DeleteDocumentModal({
    documentName,
    deleting,
    error,
    onClose,
    onConfirm,
}: {
    documentName: string
    deleting: boolean
    error: string | null
    onClose: () => void
    onConfirm: () => void
}) {
    const { t } = useTranslation()

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={event => event.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('knowledge.deleteDocumentTitle')}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {error && (
                        <div className="agents-alert agents-alert-error" style={{ marginBottom: 'var(--spacing-4)' }}>
                            {error}
                        </div>
                    )}
                    <p style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text-primary)', marginBottom: 'var(--spacing-4)' }}>
                        {t('knowledge.deleteDocumentConfirm', { name: documentName })}
                    </p>
                    <div className="agents-alert agents-alert-warning" style={{ marginBottom: 0 }}>
                        {t('knowledge.deleteDocumentWarning')}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={deleting}>
                        {t('common.cancel')}
                    </button>
                    <button className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
                        {deleting ? t('knowledge.deleting') : t('common.delete')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function RebuildKnowledgeModal({
    sourceName,
    rebuilding,
    onClose,
    onConfirm,
}: {
    sourceName: string
    rebuilding: boolean
    onClose: () => void
    onConfirm: () => void
}) {
    const { t } = useTranslation()

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={event => event.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('knowledge.rebuildConfirmTitle')}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    <p style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text-primary)', marginBottom: 'var(--spacing-4)' }}>
                        {t('knowledge.rebuildConfirmBody', { name: sourceName })}
                    </p>

                    <div className="agents-alert agents-alert-warning" style={{ marginBottom: 0 }}>
                        <div>{t('knowledge.rebuildConfirmDowntime')}</div>
                        <div style={{ marginTop: 'var(--spacing-2)' }}>{t('knowledge.rebuildConfirmChunkWarning')}</div>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={rebuilding}>
                        {t('common.cancel')}
                    </button>
                    <button className="btn btn-primary" onClick={onConfirm} disabled={rebuilding}>
                        {rebuilding ? t('knowledge.rebuilding') : t('knowledge.rebuildConfirmAction')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function RenameDocumentModal({
    document,
    error,
    saving,
    onClose,
    onConfirm,
}: {
    document: KnowledgeDocumentSummary
    error: string | null
    saving: boolean
    onClose: () => void
    onConfirm: (title: string) => void
}) {
    const { t } = useTranslation()
    const [title, setTitle] = useState(document.title || document.name)

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={event => event.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('knowledge.renameDocumentTitle')}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {error && (
                        <div className="agents-alert agents-alert-error" style={{ marginBottom: 'var(--spacing-4)' }}>
                            {error}
                        </div>
                    )}
                    <div className="form-group">
                        <label className="form-label" htmlFor="knowledge-doc-title-input">{t('knowledge.docDisplayTitle')}</label>
                        <input
                            id="knowledge-doc-title-input"
                            className="form-input"
                            type="text"
                            value={title}
                            onChange={event => setTitle(event.target.value)}
                            autoFocus
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                        {t('common.cancel')}
                    </button>
                    <button className="btn btn-primary" onClick={() => onConfirm(title.trim())} disabled={saving || !title.trim()}>
                        {saving ? t('knowledge.saving') : t('common.save')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function UploadDocumentsModal({
    sourceId,
    sourceName,
    maxFileSizeMb,
    allowedContentTypes,
    onClose,
    onUploaded,
}: {
    sourceId: string
    sourceName: string
    maxFileSizeMb?: number
    allowedContentTypes?: string[]
    onClose: () => void
    onUploaded: () => Promise<void>
}) {
    const { t } = useTranslation()
    const [items, setItems] = useState<UploadQueueItem[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const [sessionState, setSessionState] = useState<UploadSessionState>('idle')
    const [summary, setSummary] = useState<string | null>(null)
    const [requestError, setRequestError] = useState<string | null>(null)

    const handleAddFiles = useCallback((files: File[]) => {
        setRequestError(null)
        setItems(current => {
            const next = appendFilesToQueue(files, current, maxFileSizeMb, allowedContentTypes)
            if (next.length > UPLOAD_BATCH_MAX_FILES) {
                setRequestError(t('knowledge.uploadBatchTooMany', { max: UPLOAD_BATCH_MAX_FILES, count: next.length }))
                return current
            }
            return next
        })
    }, [allowedContentTypes, maxFileSizeMb, t])

    const handleSubmit = useCallback(async () => {
        const pendingItems = items.filter(item => item.status === 'pending' && !item.error)
        if (pendingItems.length === 0) return

        const totalSizeMb = pendingItems.reduce((sum, item) => sum + item.file.size, 0) / (1024 * 1024)
        if (totalSizeMb > UPLOAD_BATCH_MAX_SIZE_MB) {
            setRequestError(t('knowledge.uploadBatchTooLarge', { size: Math.ceil(totalSizeMb), max: UPLOAD_BATCH_MAX_SIZE_MB }))
            return
        }

        setRequestError(null)
        setSummary(null)
        setSessionState('uploading')
        setItems(current => current.map(item =>
            item.status === 'pending' ? { ...item, status: 'uploading' } : item,
        ))

        const formData = new FormData()
        for (const item of pendingItems) {
            formData.append('files', item.file)
        }

        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/ops-knowledge/sources/${sourceId}/documents:ingest`, {
                method: 'POST',
                body: formData,
            })
            const data = await response.json().catch(() => null) as KnowledgeIngestResponse | { message?: string } | null

            if (!response.ok) {
                throw new Error((data as { message?: string } | null)?.message || response.statusText)
            }

            const importedCount = (data as KnowledgeIngestResponse).documentCount
            setItems(current => current.map(item => item.status === 'uploading' ? {
                ...item,
                status: 'completed',
            } : item))
            setSummary(
                importedCount === pendingItems.length
                    ? t('knowledge.uploadSummarySuccess', { count: importedCount })
                    : t('knowledge.uploadSummaryPartial', { imported: importedCount, total: pendingItems.length })
            )
            setSessionState('finished')
            await onUploaded()
        } catch (err) {
            const message = err instanceof Error ? err.message : t('errors.unknown')
            setRequestError(t('knowledge.uploadRequestFailed', { error: message }))
            setItems(current => current.map(item => item.status === 'uploading' ? {
                ...item,
                status: 'failed',
            } : item))
            setSessionState('finished')
        } finally {
        }
    }, [items, onUploaded, sourceId, t])

    const pendingCount = items.filter(item => item.status === 'pending' && !item.error).length
    const completedCount = items.filter(item => item.status === 'completed').length
    const failedCount = items.filter(item => item.status === 'failed').length

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal knowledge-upload-modal" onClick={event => event.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h2 className="modal-title">{t('knowledge.uploadTitle', { name: sourceName })}</h2>
                        <p className="knowledge-upload-subtitle">{t('knowledge.uploadSubtitle')}</p>
                    </div>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {requestError && (
                        <div className="agents-alert agents-alert-error" style={{ marginBottom: 'var(--spacing-4)' }}>
                            {requestError}
                        </div>
                    )}

                    {(summary || sessionState === 'finished') && (
                        <div className="knowledge-upload-summary" style={{ marginBottom: 'var(--spacing-4)' }}>
                            <div className="knowledge-upload-summary-title">{t('knowledge.uploadSummaryTitle')}</div>
                            {summary && (
                                <div className="knowledge-upload-summary-text">{summary}</div>
                            )}
                            <div className="knowledge-upload-summary-metrics">
                                <span>{t('knowledge.uploadSummaryMetricCompleted', { count: completedCount })}</span>
                                <span>{t('knowledge.uploadSummaryMetricFailed', { count: failedCount })}</span>
                            </div>
                        </div>
                    )}

                    <div
                        className={`knowledge-upload-dropzone ${isDragging ? 'dragging' : ''}`}
                        onDragOver={event => {
                            event.preventDefault()
                            setIsDragging(true)
                        }}
                        onDragLeave={event => {
                            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                            setIsDragging(false)
                        }}
                        onDrop={event => {
                            event.preventDefault()
                            setIsDragging(false)
                            handleAddFiles(Array.from(event.dataTransfer.files))
                        }}
                    >
                        <div className="knowledge-upload-dropzone-title">{t('knowledge.uploadDropTitle')}</div>
                        <div className="knowledge-upload-dropzone-hint">{t('knowledge.uploadDropHint', { max: UPLOAD_BATCH_MAX_FILES, sizeMb: UPLOAD_BATCH_MAX_SIZE_MB })}</div>
                        <label className="btn btn-secondary knowledge-upload-select-btn">
                            {t('knowledge.uploadSelectFiles')}
                            <input
                                type="file"
                                multiple
                                onChange={event => {
                                    handleAddFiles(Array.from(event.target.files || []))
                                    event.currentTarget.value = ''
                                }}
                                hidden
                            />
                        </label>
                    </div>

                    {items.length > 0 && (
                        <div className="knowledge-upload-queue">
                            {items.map(item => (
                                <div key={item.id} className={`knowledge-upload-item status-${item.status}`}>
                                    <div className="knowledge-upload-item-main">
                                        <div className="knowledge-upload-file-name">{item.file.name}</div>
                                        <div className="knowledge-upload-file-meta">
                                            <span>{formatFileSize(item.file.size)}</span>
                                            <span>{item.status === 'pending' ? t('knowledge.uploadItemPending') : item.status === 'uploading' ? t('knowledge.uploadItemUploading') : item.status === 'completed' ? t('knowledge.uploadItemCompleted') : t('knowledge.uploadItemFailed')}</span>
                                        </div>
                                        {item.error && (
                                            <div className="knowledge-upload-file-error">{t(item.error)}</div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        className="knowledge-upload-remove"
                                        onClick={() => setItems(current => current.filter(currentItem => currentItem.id !== item.id))}
                                        disabled={sessionState === 'uploading' || item.status === 'completed'}
                                    >
                                        {item.status === 'completed' ? t('knowledge.uploadItemCompleted') : t('knowledge.uploadRemove')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>
                        {t('knowledge.uploadClose')}
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSubmit}
                        disabled={sessionState === 'uploading' || pendingCount === 0}
                    >
                        {sessionState === 'uploading' ? t('knowledge.uploadSubmitting') : t('knowledge.uploadStart')}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default function KnowledgeConfigure() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { sourceId } = useParams<{ sourceId: string }>()
    const [searchParams, setSearchParams] = useSearchParams()
    const { showToast } = useToast()
    const { openPreview, previewFile } = usePreview()
    const {
        source,
        stats,
        capabilities,
        defaults,
        indexProfileDetail,
        retrievalProfileDetail,
        maintenance,
        isLoading,
        error,
        hasSupportingDataError,
        reload,
        loadMaintenanceFailures,
        saveSource,
        saveIndexProfile,
        saveRetrievalProfile,
        deleteSource,
    } = useKnowledgeSourceDetail(sourceId)
    const [showEditBasicInfoModal, setShowEditBasicInfoModal] = useState(false)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [showRebuildModal, setShowRebuildModal] = useState(false)
    const [deleteError, setDeleteError] = useState<string | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)
    const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([])
    const [documentArtifacts, setDocumentArtifacts] = useState<Record<string, KnowledgeDocumentArtifacts>>({})
    const [documentsLoading, setDocumentsLoading] = useState(false)
    const [documentsError, setDocumentsError] = useState<string | null>(null)
    const [documentSearchTerm, setDocumentSearchTerm] = useState('')
    const [documentStatusFilter, setDocumentStatusFilter] = useState<KnowledgeDocumentFilterStatus>('ALL')
    const [showUploadModal, setShowUploadModal] = useState(false)
    const [deleteDocumentTarget, setDeleteDocumentTarget] = useState<KnowledgeDocumentSummary | null>(null)
    const [deleteDocumentError, setDeleteDocumentError] = useState<string | null>(null)
    const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null)
    const [renameDocumentTarget, setRenameDocumentTarget] = useState<KnowledgeDocumentSummary | null>(null)
    const [renameDocumentError, setRenameDocumentError] = useState<string | null>(null)
    const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null)
    const [downloadingDocumentId, setDownloadingDocumentId] = useState<string | null>(null)
    const [isRebuildingSource, setIsRebuildingSource] = useState(false)
    const [showEditIndexProfileModal, setShowEditIndexProfileModal] = useState(false)
    const [showEditRetrievalProfileModal, setShowEditRetrievalProfileModal] = useState(false)
    const [indexProfileName, setIndexProfileName] = useState('')
    const [indexAnalyzer, setIndexAnalyzer] = useState('smartcn')
    const [queryAnalyzer, setQueryAnalyzer] = useState('smartcn')
    const [titleBoost, setTitleBoost] = useState('4')
    const [titlePathBoost, setTitlePathBoost] = useState('2.5')
    const [keywordBoost, setKeywordBoost] = useState('2')
    const [contentBoost, setContentBoost] = useState('1')
    const [bm25K1, setBm25K1] = useState('1.2')
    const [bm25B, setBm25B] = useState('0.75')
    const [isSavingIndexProfile, setIsSavingIndexProfile] = useState(false)
    const [retrievalProfileName, setRetrievalProfileName] = useState('')
    const [retrievalMode, setRetrievalMode] = useState('hybrid')
    const [lexicalTopKInput, setLexicalTopKInput] = useState('50')
    const [semanticTopKInput, setSemanticTopKInput] = useState('50')
    const [finalTopKInput, setFinalTopKInput] = useState('10')
    const [rrfKInput, setRrfKInput] = useState('60')
    const [snippetLengthInput, setSnippetLengthInput] = useState('180')
    const [isSavingRetrievalProfile, setIsSavingRetrievalProfile] = useState(false)
    const [maintenanceFailures, setMaintenanceFailures] = useState<KnowledgeMaintenanceFailure[]>([])
    const [maintenanceFailuresLoading, setMaintenanceFailuresLoading] = useState(false)
    const [expandedFailureJobId, setExpandedFailureJobId] = useState<string | null>(null)

    const activeTab = parseTab(searchParams.get('tab'))
    const isMaintenanceMode = source?.runtimeStatus?.toUpperCase() === 'MAINTENANCE'
    const isRuntimeError = source?.runtimeStatus?.toUpperCase() === 'ERROR'
    const isSourceUnavailable = isMaintenanceMode || isRuntimeError
    const runtimeBannerTone = isRuntimeError ? 'error' : 'warning'

    const tabs: { key: KnowledgeConfigureTab; label: string }[] = [
        { key: 'basic', label: t('knowledge.tabBasicInfo') },
        { key: 'documents', label: t('knowledge.tabDocuments') },
        { key: 'chunks', label: t('knowledge.tabChunks') },
        { key: 'retrieval', label: t('knowledge.tabRetrieval') },
        { key: 'config', label: t('knowledge.tabConfigParams') },
        { key: 'maintenance', label: t('knowledge.tabMaintenance') },
    ]

    const defaultsConfigGroups = useMemo(
        () => defaults
            ? withConfigRowMetadata(
                buildConfigGroups(defaults as unknown as Record<string, unknown>),
                { sourceKey: 'knowledge.configSourceConfigYaml' },
                DEFAULTS_PARAM_DESCRIPTION_KEYS,
            )
            : [],
        [defaults]
    )
    const indexReadonlyGroups = useMemo<KnowledgeConfigGroup[]>(
        () => withConfigRowMetadata(
            buildConfigGroups(indexProfileDetail?.config || null),
            { sourceKey: 'knowledge.configSourceBoundIndexProfile' },
            INDEX_PARAM_DESCRIPTION_KEYS,
        ),
        [indexProfileDetail?.config]
    )
    const retrievalReadonlyGroups = useMemo<KnowledgeConfigGroup[]>(
        () => withConfigRowMetadata(
            buildConfigGroups(retrievalProfileDetail?.config || null),
            { sourceKey: 'knowledge.configSourceBoundRetrievalProfile' },
            RETRIEVAL_PARAM_DESCRIPTION_KEYS,
        ),
        [retrievalProfileDetail?.config]
    )
    const capabilityGroups = useMemo(
        () => capabilities
            ? withConfigRowMetadata(
                buildConfigGroups(capabilities as unknown as Record<string, unknown>),
                { sourceKey: 'knowledge.configSourceServiceCapabilities' },
                CAPABILITY_PARAM_DESCRIPTION_KEYS,
            )
            : [],
        [capabilities]
    )
    const retrievalModes = capabilities?.retrievalModes?.length
        ? capabilities.retrievalModes
        : ['hybrid', 'semantic', 'lexical']
    const analyzerOptions = capabilities?.analyzers?.length
        ? capabilities.analyzers
        : ['smartcn', 'standard', 'keyword']

    useEffect(() => {
        if (!indexProfileDetail) return
        setIndexProfileName(indexProfileDetail.name || '')
        setIndexAnalyzer(getConfigString(indexProfileDetail.config, 'analysis', 'indexAnalyzer', 'smartcn'))
        setQueryAnalyzer(getConfigString(indexProfileDetail.config, 'analysis', 'queryAnalyzer', 'smartcn'))
        setTitleBoost(String(getConfigNumber(indexProfileDetail.config, 'indexing', 'titleBoost', 4)))
        setTitlePathBoost(String(getConfigNumber(indexProfileDetail.config, 'indexing', 'titlePathBoost', 2.5)))
        setKeywordBoost(String(getConfigNumber(indexProfileDetail.config, 'indexing', 'keywordBoost', 2)))
        setContentBoost(String(getConfigNumber(indexProfileDetail.config, 'indexing', 'contentBoost', 1)))
        const bm25Config = getConfigSection(getConfigSection(indexProfileDetail.config, 'indexing'), 'bm25')
        setBm25K1(String(typeof bm25Config.k1 === 'number' ? bm25Config.k1 : 1.2))
        setBm25B(String(typeof bm25Config.b === 'number' ? bm25Config.b : 0.75))
    }, [indexProfileDetail])

    useEffect(() => {
        if (!retrievalProfileDetail) return
        setRetrievalProfileName(retrievalProfileDetail.name || '')
        setRetrievalMode(getConfigString(retrievalProfileDetail.config, 'retrieval', 'mode', 'hybrid'))
        setLexicalTopKInput(String(getConfigNumber(retrievalProfileDetail.config, 'retrieval', 'lexicalTopK', 50)))
        setSemanticTopKInput(String(getConfigNumber(retrievalProfileDetail.config, 'retrieval', 'semanticTopK', 50)))
        setFinalTopKInput(String(getConfigNumber(retrievalProfileDetail.config, 'result', 'finalTopK', 10)))
        setRrfKInput(String(getConfigNumber(retrievalProfileDetail.config, 'retrieval', 'rrfK', 60)))
        setSnippetLengthInput(String(getConfigNumber(retrievalProfileDetail.config, 'result', 'snippetLength', 180)))
    }, [retrievalProfileDetail])

    const documentTypeOptions = useMemo(
        () => Array.from(new Set(documents.map(document => getDocumentType(document)))).sort(),
        [documents]
    )
    const [documentTypeFilter, setDocumentTypeFilter] = useState('ALL')
    const filteredDocuments = useMemo(() => {
        const term = documentSearchTerm.trim().toLowerCase()
        return documents.filter(document => {
            const artifacts = documentArtifacts[document.id]
            const health = getDocumentHealthStatus(document, artifacts)
            const matchesSearch = !term
                || document.name.toLowerCase().includes(term)
                || (document.title || '').toLowerCase().includes(term)
            const matchesStatus = documentStatusFilter === 'ALL' || health.filter === documentStatusFilter
            const matchesType = documentTypeFilter === 'ALL' || getDocumentType(document) === documentTypeFilter
            return matchesSearch && matchesStatus && matchesType
        })
    }, [documentArtifacts, documentSearchTerm, documentStatusFilter, documentTypeFilter, documents])
    const previewDocumentId = useMemo(() => {
        if (!previewFile?.path?.startsWith('knowledge-document:')) return null
        return previewFile.path.replace('knowledge-document:', '')
    }, [previewFile?.path])

    const updateRouteState = useCallback((tab: KnowledgeConfigureTab, options?: { documentId?: string | null }) => {
        const nextParams = new URLSearchParams(searchParams)

        if (tab === 'basic') {
            nextParams.delete('tab')
        } else {
            nextParams.set('tab', tab)
        }

        if (tab === 'chunks') {
            if (options?.documentId) {
                nextParams.set('documentId', options.documentId)
            } else {
                nextParams.delete('documentId')
            }
        } else {
            nextParams.delete('documentId')
        }

        setSearchParams(nextParams)
    }, [searchParams, setSearchParams])

    useEffect(() => {
        if (maintenance?.currentJob?.status?.toUpperCase() !== 'RUNNING') {
            return
        }
        const timer = window.setInterval(() => {
            void reload()
        }, 3000)
        return () => window.clearInterval(timer)
    }, [maintenance?.currentJob?.id, maintenance?.currentJob?.status, reload])

    const handleToggleMaintenanceFailures = useCallback(async () => {
        const jobId = maintenance?.lastCompletedJob?.id
        if (!jobId) {
            return
        }
        if (expandedFailureJobId === jobId) {
            setExpandedFailureJobId(null)
            setMaintenanceFailures([])
            return
        }
        setMaintenanceFailuresLoading(true)
        try {
            const items = await loadMaintenanceFailures(jobId)
            setMaintenanceFailures(items)
            setExpandedFailureJobId(jobId)
        } catch (err) {
            showToast('error', getErrorMessage(err))
        } finally {
            setMaintenanceFailuresLoading(false)
        }
    }, [expandedFailureJobId, loadMaintenanceFailures, maintenance?.lastCompletedJob?.id, showToast])

    const handleSaveBasicInfo = useCallback(async (updates: { name: string; description: string | null }) => {
        const result = await saveSource(updates)

        if (result.success) {
            showToast('success', t('knowledge.saveSuccess', { name: updates.name }))
            return true
        }

        showToast('error', result.error || t('knowledge.saveFailed'))
        return false
    }, [saveSource, showToast, t])

    const handleSaveIndexProfile = useCallback(async (): Promise<boolean> => {
        const nextTitleBoost = Number(titleBoost)
        const nextTitlePathBoost = Number(titlePathBoost)
        const nextKeywordBoost = Number(keywordBoost)
        const nextContentBoost = Number(contentBoost)
        const nextBm25K1 = Number(bm25K1)
        const nextBm25B = Number(bm25B)

        if ([nextTitleBoost, nextTitlePathBoost, nextKeywordBoost, nextContentBoost, nextBm25K1, nextBm25B].some(value => Number.isNaN(value))) {
            showToast('error', t('knowledge.configInvalidNumber'))
            return false
        }

        setIsSavingIndexProfile(true)
        const result = await saveIndexProfile({
            name: indexProfileName.trim() || undefined,
            config: {
                analysis: {
                    indexAnalyzer,
                    queryAnalyzer,
                },
                indexing: {
                    titleBoost: nextTitleBoost,
                    titlePathBoost: nextTitlePathBoost,
                    keywordBoost: nextKeywordBoost,
                    contentBoost: nextContentBoost,
                    bm25: {
                        k1: nextBm25K1,
                        b: nextBm25B,
                    },
                },
            },
        })
        setIsSavingIndexProfile(false)

        if (result.success) {
            showToast('success', t('knowledge.configSaveSuccess'))
            return true
        }

        showToast('error', result.error || t('knowledge.saveFailed'))
        return false
    }, [
        bm25B,
        bm25K1,
        contentBoost,
        indexAnalyzer,
        indexProfileName,
        keywordBoost,
        queryAnalyzer,
        saveIndexProfile,
        showToast,
        t,
        titleBoost,
        titlePathBoost,
    ])

    const handleSaveRetrievalProfile = useCallback(async (): Promise<boolean> => {
        const nextLexicalTopK = Number(lexicalTopKInput)
        const nextSemanticTopK = Number(semanticTopKInput)
        const nextFinalTopK = Number(finalTopKInput)
        const nextRrfK = Number(rrfKInput)
        const nextSnippetLength = Number(snippetLengthInput)

        if ([nextLexicalTopK, nextSemanticTopK, nextFinalTopK, nextRrfK, nextSnippetLength].some(value => Number.isNaN(value))) {
            showToast('error', t('knowledge.configInvalidNumber'))
            return false
        }

        setIsSavingRetrievalProfile(true)
        const result = await saveRetrievalProfile({
            name: retrievalProfileName.trim() || undefined,
            config: {
                retrieval: {
                    mode: retrievalMode,
                    lexicalTopK: nextLexicalTopK,
                    semanticTopK: nextSemanticTopK,
                    rrfK: nextRrfK,
                    strategy: 'rrf',
                },
                result: {
                    finalTopK: nextFinalTopK,
                    snippetLength: nextSnippetLength,
                },
            },
        })
        setIsSavingRetrievalProfile(false)

        if (result.success) {
            showToast('success', t('knowledge.configSaveSuccess'))
            return true
        }

        showToast('error', result.error || t('knowledge.saveFailed'))
        return false
    }, [
        finalTopKInput,
        lexicalTopKInput,
        retrievalMode,
        retrievalProfileName,
        rrfKInput,
        saveRetrievalProfile,
        semanticTopKInput,
        showToast,
        snippetLengthInput,
        t,
    ])

    const loadDocuments = useCallback(async () => {
        if (!sourceId) return

        setDocumentsLoading(true)
        setDocumentsError(null)

        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/ops-knowledge/documents?sourceId=${sourceId}&page=1&pageSize=100`)
            const data = await response.json() as PagedResponse<KnowledgeDocumentSummary> | { message?: string }

            if (!response.ok) {
                throw new Error((data as { message?: string }).message || response.statusText)
            }

            const items = (data as PagedResponse<KnowledgeDocumentSummary>).items || []
            setDocuments(items)

            const artifactEntries = await Promise.all(items.map(async document => {
                try {
                    const artifactsResponse = await fetch(`${KNOWLEDGE_SERVICE_URL}/ops-knowledge/documents/${document.id}/artifacts`)
                    const artifactsData = await artifactsResponse.json() as KnowledgeDocumentArtifacts
                    if (!artifactsResponse.ok) {
                        throw new Error(artifactsResponse.statusText)
                    }
                    return [document.id, artifactsData] as const
                } catch {
                    return [document.id, {
                        documentId: document.id,
                        markdown: false,
                    }] as const
                }
            }))
            setDocumentArtifacts(Object.fromEntries(artifactEntries))
        } catch (err) {
            setDocuments([])
            setDocumentArtifacts({})
            setDocumentsError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setDocumentsLoading(false)
        }
    }, [sourceId])

    const handleDeleteDocument = useCallback(async () => {
        if (!deleteDocumentTarget) return

        setDeleteDocumentError(null)
        setDeletingDocumentId(deleteDocumentTarget.id)
        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/ops-knowledge/documents/${deleteDocumentTarget.id}`, {
                method: 'DELETE',
            })
            const data = await response.json().catch(() => null) as { message?: string } | null
            if (!response.ok) {
                throw new Error(data?.message || response.statusText)
            }

            setDeleteDocumentTarget(null)
            showToast('success', t('knowledge.deleteDocumentSuccess', { name: deleteDocumentTarget.name }))
            await loadDocuments()
        } catch (err) {
            setDeleteDocumentError(t('knowledge.deleteDocumentFailed', { error: err instanceof Error ? err.message : t('errors.unknown') }))
        } finally {
            setDeletingDocumentId(null)
        }
    }, [deleteDocumentTarget, loadDocuments, showToast, t])

    const handleRenameDocument = useCallback(async (title: string) => {
        if (!renameDocumentTarget) return

        setRenameDocumentError(null)
        setRenamingDocumentId(renameDocumentTarget.id)
        const nextTitle = title.trim()
        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/ops-knowledge/documents/${renameDocumentTarget.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: nextTitle,
                }),
            })
            const data = await response.json().catch(() => null) as { message?: string } | null
            if (!response.ok) {
                throw new Error(data?.message || response.statusText)
            }

            setRenameDocumentTarget(null)
            showToast('success', t('knowledge.renameDocumentSuccess', { name: nextTitle }))
            await loadDocuments()
        } catch (err) {
            setRenameDocumentError(t('knowledge.renameDocumentFailed', { error: err instanceof Error ? err.message : t('errors.unknown') }))
        } finally {
            setRenamingDocumentId(null)
        }
    }, [loadDocuments, renameDocumentTarget, showToast, t])

    const handleDownloadDocument = useCallback(async (knowledgeDocument: KnowledgeDocumentSummary) => {
        setDownloadingDocumentId(knowledgeDocument.id)

        try {
            const response = await fetch(getDocumentDownloadUrl(knowledgeDocument.id))

            if (!response.ok) {
                const contentType = response.headers.get('Content-Type') || ''
                let message = response.statusText || t('errors.unknown')

                if (contentType.includes('application/json')) {
                    const data = await response.json().catch(() => null) as { message?: string } | null
                    message = data?.message || message
                } else if (response.status === 404) {
                    message = t('knowledge.downloadDocumentNotAvailable')
                }

                throw new Error(message)
            }

            const blob = await response.blob()
            const filename = getFilenameFromDisposition(
                response.headers.get('Content-Disposition'),
                knowledgeDocument.name
            )

            triggerDocumentDownload(blob, filename)
        } catch (err) {
            showToast(
                'error',
                t('knowledge.downloadDocumentFailed', {
                    name: knowledgeDocument.name,
                    error: err instanceof Error ? err.message : t('errors.unknown'),
                })
            )
        } finally {
            setDownloadingDocumentId(null)
        }
    }, [showToast, t])

    const handlePreviewDocument = useCallback(async (knowledgeDocument: KnowledgeDocumentSummary) => {
        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/ops-knowledge/documents/${knowledgeDocument.id}/preview`)
            const data = await response.json().catch(() => null) as KnowledgeDocumentPreview | { message?: string } | null

            if (!response.ok) {
                throw new Error((data as { message?: string } | null)?.message || response.statusText)
            }

            const previewData = data as KnowledgeDocumentPreview
            await openPreview({
                name: previewData.title || getDocumentDisplayTitle(knowledgeDocument),
                path: `knowledge-document:${knowledgeDocument.id}`,
                type: 'md',
                content: previewData.markdownPreview,
                downloadUrl: getDocumentDownloadUrl(knowledgeDocument.id),
                previewKind: 'markdown',
            })
        } catch (err) {
            showToast(
                'error',
                t('knowledge.docPreviewLoadFailed', {
                    error: err instanceof Error ? err.message : t('errors.unknown'),
                })
            )
        }
    }, [openPreview, showToast, t])

    const handleRebuildSource = useCallback(async () => {
        if (!source || isRebuildingSource) return

        setIsRebuildingSource(true)

        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/ops-knowledge/sources/${source.id}:rebuild`, {
                method: 'POST',
            })
            const data = await response.json().catch(() => null) as KnowledgeJobResponse | { message?: string } | null

            if (!response.ok) {
                throw new Error((data as { message?: string } | null)?.message || response.statusText)
            }

            showToast('success', t('knowledge.rebuildSuccess', { name: source.name }))
            setShowRebuildModal(false)
            await reload()
        } catch (err) {
            showToast('error', t('knowledge.rebuildFailed', {
                error: err instanceof Error ? err.message : t('errors.unknown'),
            }))
        } finally {
            setIsRebuildingSource(false)
        }
    }, [isRebuildingSource, reload, showToast, source, t])
    
    useEffect(() => {
        if (activeTab === 'documents') {
            void loadDocuments()
            return
        }
    }, [activeTab, loadDocuments])

    const handleDelete = useCallback(async () => {
        if (!source) return

        setDeleteError(null)
        setIsDeleting(true)

        const result = await deleteSource()

        if (result.success) {
            showToast('success', t('knowledge.deleteSuccess', { name: source.name }))
            navigate('/knowledge', { replace: true })
            return
        }

        setDeleteError(result.error || t('knowledge.deleteFailed', { error: t('errors.unknown') }))
        setIsDeleting(false)
    }, [deleteSource, navigate, showToast, source, t])

    if (isLoading && !source) {
        return (
            <div className="page-container knowledge-configure-page">
                <div className="empty-state">
                    <div className="empty-state-title">{t('common.loading')}</div>
                </div>
            </div>
        )
    }

    if (error && !source) {
        return (
            <div className="page-container knowledge-configure-page">
                <div className="knowledge-configure-header">
                    <button
                        type="button"
                        className="knowledge-configure-back"
                        onClick={() => navigate('/knowledge')}
                    >
                        {t('knowledge.backToList')}
                    </button>
                </div>

                <div className="empty-state">
                    <div className="empty-state-title">{t('knowledge.loadFailedTitle')}</div>
                    <div className="empty-state-description">{error}</div>
                    <div className="knowledge-empty-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => navigate('/knowledge')}>
                            {t('knowledge.backToList')}
                        </button>
                        <button type="button" className="btn btn-primary" onClick={() => void reload()}>
                            {t('common.tryAgain')}
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    if (!source || !stats) {
        return null
    }

    const pageClassName = [
        'page-container',
        'knowledge-configure-page',
        activeTab === 'documents' ? 'knowledge-configure-documents' : '',
    ].filter(Boolean).join(' ')

    return (
        <div className={pageClassName}>
            <div className="knowledge-configure-header">
                <button
                    type="button"
                    className="knowledge-configure-back"
                    onClick={() => navigate('/knowledge')}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                    {t('knowledge.backToList')}
                </button>

                <div className="knowledge-configure-title-row">
                    <div className="knowledge-configure-title-group">
                        <div className="knowledge-configure-title-line">
                            <h1 className="page-title knowledge-configure-title">{source.name}</h1>
                            <span className={`resource-status resource-status-${getKnowledgeStatusTone(source)}`}>
                                {getKnowledgeStatusLabel(source, t)}
                            </span>
                        </div>
                        <p className="page-subtitle knowledge-configure-subtitle">
                            {source.description?.trim() || t('knowledge.noDescription')}
                        </p>
                    </div>
                </div>
            </div>

            {error && (
                <div className="conn-banner conn-banner-error">
                    {t('common.connectionError', { error })}
                </div>
            )}

            {source.runtimeMessage && (
                <div className={`conn-banner conn-banner-${runtimeBannerTone}`}>
                    {source.runtimeMessage}
                    {source.lastJobError ? ` ${source.lastJobError}` : ''}
                </div>
            )}

            {source.rebuildRequired && (
                <div className="conn-banner conn-banner-warning">
                    {t('knowledge.configPendingRebuildNotice')}
                </div>
            )}

            {hasSupportingDataError && (
                <div className="conn-banner conn-banner-warning">
                    {t('knowledge.supportingDataWarning')}
                </div>
            )}

            <div className="knowledge-tab-bar">
                <div className="config-tabs knowledge-config-tabs">
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            className={`config-tab ${activeTab === tab.key ? 'config-tab-active' : ''}`}
                            onClick={() => updateRouteState(tab.key)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="knowledge-detail-layout">
                <div className="knowledge-detail-main">
                    {activeTab === 'basic' && (
                        <>
                            <section className="knowledge-section-card">
                                <div className="knowledge-section-header knowledge-section-header-compact">
                                    <div>
                                        <h2 className="knowledge-section-title">{t('knowledge.overviewMetricsTitle')}</h2>
                                    </div>
                                </div>

                                <div className="knowledge-kv-grid knowledge-kv-grid-compact">
                                    <div className="knowledge-kv-item">
                                        <span className="knowledge-kv-label">{t('knowledge.documents')}</span>
                                        <span className="knowledge-kv-value">{stats.documentCount}</span>
                                    </div>
                                    <div className="knowledge-kv-item">
                                        <span className="knowledge-kv-label">{t('knowledge.chunks')}</span>
                                        <span className="knowledge-kv-value">{stats.chunkCount}</span>
                                    </div>
                                    <div className="knowledge-kv-item">
                                        <span className="knowledge-kv-label">{t('knowledge.failedDocuments')}</span>
                                        <span className="knowledge-kv-value">{stats.failedDocumentCount}</span>
                                    </div>
                                    <div className="knowledge-kv-item">
                                        <span className="knowledge-kv-label">{t('knowledge.lastIngestion')}</span>
                                        <span className="knowledge-kv-value">
                                            {stats.lastIngestionAt ? formatDateTime(stats.lastIngestionAt) : t('knowledge.noIngestionYet')}
                                        </span>
                                    </div>
                                </div>
                            </section>

                            <div className="knowledge-config-stack">
                                <section className="knowledge-section-card">
                                    <div className="knowledge-section-header">
                                        <div>
                                            <h2 className="knowledge-section-title">{t('knowledge.basicInfoTitle')}</h2>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-secondary knowledge-section-action"
                                            onClick={() => setShowEditBasicInfoModal(true)}
                                            disabled={isSourceUnavailable}
                                        >
                                            {t('knowledge.editBasicInfo')}
                                        </button>
                                    </div>

                                    <div className="knowledge-kv-grid knowledge-kv-grid-compact">
                                        <div className="knowledge-kv-item">
                                            <span className="knowledge-kv-label">{t('knowledge.storageMode')}</span>
                                            <span className="knowledge-kv-value">{source.storageMode}</span>
                                        </div>
                                        <div className="knowledge-kv-item">
                                            <span className="knowledge-kv-label">{t('knowledge.createdAt')}</span>
                                            <span className="knowledge-kv-value">{formatDateTime(source.createdAt)}</span>
                                        </div>
                                        <div className="knowledge-kv-item">
                                            <span className="knowledge-kv-label">{t('knowledge.updatedAt')}</span>
                                            <span className="knowledge-kv-value">{formatDateTime(source.updatedAt)}</span>
                                        </div>
                                    </div>
                                </section>

                                <section className="knowledge-section-card knowledge-section-card-danger">
                                    <div className="knowledge-section-header">
                                        <div>
                                            <h2 className="knowledge-section-title">{t('knowledge.dangerZoneTitle')}</h2>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-danger knowledge-section-action"
                                            onClick={() => setShowDeleteModal(true)}
                                            disabled={isSourceUnavailable}
                                        >
                                            {t('common.delete')}
                                        </button>
                                    </div>

                                    <div className="knowledge-action-list">
                                        <div className="knowledge-action-item knowledge-action-item-danger knowledge-action-item-single">
                                            <div className="knowledge-action-copy">
                                                <span className="knowledge-kv-label">{t('knowledge.deleteTitle')}</span>
                                                <p className="knowledge-action-text">{t('knowledge.deleteActionHint')}</p>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </>
                    )}

                    {activeTab === 'config' && (
                        <div className="knowledge-config-stack">
                            <section className="knowledge-section-card">
                                <div className="knowledge-section-header">
                                    <div>
                                        <h2 className="knowledge-section-title">{t('knowledge.currentBindingsTitle')}</h2>
                                    </div>
                                </div>

                                <div className="knowledge-kv-grid knowledge-kv-grid-compact">
                                    <div className="knowledge-kv-item">
                                        <span className="knowledge-kv-label">{t('knowledge.indexProfile')}</span>
                                        <span className="knowledge-kv-value">{getProfileName(indexProfileDetail, source.indexProfileId, t('knowledge.profileUnavailable'))}</span>
                                        <span className="knowledge-kv-meta">{source.indexProfileId || t('knowledge.notBound')}</span>
                                    </div>
                                    <div className="knowledge-kv-item">
                                        <span className="knowledge-kv-label">{t('knowledge.retrievalProfile')}</span>
                                        <span className="knowledge-kv-value">{getProfileName(retrievalProfileDetail, source.retrievalProfileId, t('knowledge.profileUnavailable'))}</span>
                                        <span className="knowledge-kv-meta">{source.retrievalProfileId || t('knowledge.notBound')}</span>
                                    </div>
                                </div>
                            </section>

                            <ProfileReadonlyCard
                                title={t('knowledge.indexProfileEditorTitle')}
                                description={t('knowledge.indexProfileEditorDescription')}
                                bindingName={getProfileName(indexProfileDetail, source.indexProfileId, t('knowledge.profileUnavailable'))}
                                bindingId={source.indexProfileId || t('knowledge.notBound')}
                                groups={indexReadonlyGroups}
                                actionLabel={t('knowledge.editConfig')}
                                onEdit={() => setShowEditIndexProfileModal(true)}
                                actionDisabled={isSourceUnavailable}
                            />

                            <ProfileReadonlyCard
                                title={t('knowledge.retrievalProfileEditorTitle')}
                                description={t('knowledge.retrievalProfileEditorDescription')}
                                bindingName={getProfileName(retrievalProfileDetail, source.retrievalProfileId, t('knowledge.profileUnavailable'))}
                                bindingId={source.retrievalProfileId || t('knowledge.notBound')}
                                groups={retrievalReadonlyGroups}
                                actionLabel={t('knowledge.editConfig')}
                                onEdit={() => setShowEditRetrievalProfileModal(true)}
                                actionDisabled={isSourceUnavailable}
                            />

                            <section className="knowledge-section-card">
                                <div className="knowledge-section-header">
                                    <div>
                                        <h2 className="knowledge-section-title">{t('knowledge.defaultsTitle')}</h2>
                                        <p className="knowledge-section-description">{t('knowledge.defaultsDescription')}</p>
                                    </div>
                                </div>

                                {defaultsConfigGroups.length > 0 ? (
                                    <div className="knowledge-config-groups">
                                        {defaultsConfigGroups.map(group => (
                                            <ConfigGroupRows
                                                key={`defaults-group-${group.title}`}
                                                title={group.title}
                                                rows={group.rows}
                                                meta={{
                                                    sourceKey: 'knowledge.configSourceConfigYaml',
                                                }}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="knowledge-section-empty">{t('knowledge.defaultsUnavailable')}</p>
                                )}
                            </section>

                            <section className="knowledge-section-card">
                                <div className="knowledge-section-header">
                                    <div>
                                        <h2 className="knowledge-section-title">{t('knowledge.featuresTitle')}</h2>
                                        <p className="knowledge-section-description">{t('knowledge.featuresDescription')}</p>
                                    </div>
                                </div>

                                {capabilityGroups.length > 0 ? (
                                    <div className="knowledge-config-groups">
                                        {capabilityGroups.map(group => (
                                            <ConfigGroupRows
                                                key={`capability-group-${group.title}`}
                                                title={group.title}
                                                rows={group.rows}
                                                meta={{
                                                    sourceKey: 'knowledge.configSourceServiceCapabilities',
                                                }}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="knowledge-section-empty">{t('knowledge.capabilitiesUnavailable')}</p>
                                )}
                            </section>
                        </div>
                    )}

                    {activeTab === 'maintenance' && (
                        <MaintenanceTab
                            maintenance={maintenance}
                            failureItems={expandedFailureJobId === maintenance?.lastCompletedJob?.id ? maintenanceFailures : []}
                            failuresLoading={maintenanceFailuresLoading}
                            onToggleFailures={handleToggleMaintenanceFailures}
                            sourceUnavailable={isSourceUnavailable}
                            isMaintenanceMode={isMaintenanceMode}
                            isRuntimeError={isRuntimeError}
                            isRebuildingSource={isRebuildingSource}
                            onRebuild={() => setShowRebuildModal(true)}
                        />
                    )}

                    {activeTab === 'documents' && (
                        <section className="knowledge-section-card">
                            <div className="knowledge-section-header">
                                <div>
                                    <h2 className="knowledge-section-title">{t('knowledge.documentsTabTitle')}</h2>
                                    <p className="knowledge-section-description">{t('knowledge.documentsTabDescription', { name: source.name })}</p>
                                </div>
                                <div className="knowledge-doc-toolbar-actions">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => void loadDocuments()}
                                        disabled={documentsLoading}
                                    >
                                        {t('knowledge.docRefresh')}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={() => setShowUploadModal(true)}
                                        disabled={isSourceUnavailable}
                                    >
                                        {t('knowledge.docUpload')}
                                    </button>
                                </div>
                            </div>

                            {documentsError && (
                                <div className="conn-banner conn-banner-error">
                                    {t('common.connectionError', { error: documentsError })}
                                </div>
                            )}

                            <div className="knowledge-doc-layout">
                                <div className="knowledge-doc-main">
                                    <div className="knowledge-doc-filters">
                                        <div className="search-input-wrapper knowledge-doc-search">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <circle cx="11" cy="11" r="8" />
                                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                            </svg>
                                            <input
                                                type="text"
                                                className="search-input knowledge-doc-search-input"
                                                placeholder={t('knowledge.docSearchPlaceholder')}
                                                value={documentSearchTerm}
                                                onChange={event => setDocumentSearchTerm(event.target.value)}
                                            />
                                        </div>

                                        <select
                                            className="form-input knowledge-doc-filter-select"
                                            value={documentTypeFilter}
                                            onChange={event => setDocumentTypeFilter(event.target.value)}
                                        >
                                            <option value="ALL">{t('knowledge.docTypeAll')}</option>
                                            {documentTypeOptions.map(type => (
                                                <option key={type} value={type}>{type}</option>
                                            ))}
                                        </select>

                                        <select
                                            className="form-input knowledge-doc-filter-select"
                                            value={documentStatusFilter}
                                            onChange={event => setDocumentStatusFilter(event.target.value as KnowledgeDocumentFilterStatus)}
                                        >
                                            <option value="ALL">{t('knowledge.docFilterAll')}</option>
                                            <option value="READY">{t('knowledge.docStatusReady')}</option>
                                            <option value="ATTENTION">{t('knowledge.docStatusAttention')}</option>
                                            <option value="PROCESSING">{t('knowledge.docStatusProcessing')}</option>
                                            <option value="ERROR">{t('knowledge.docStatusError')}</option>
                                        </select>
                                    </div>

                                    {documentsLoading ? (
                                        <div className="knowledge-doc-empty">{t('common.loading')}</div>
                                    ) : filteredDocuments.length === 0 ? (
                                        <div className="knowledge-doc-empty">
                                            {documents.length === 0 ? t('knowledge.docEmptyState') : t('knowledge.docNoMatch')}
                                        </div>
                                    ) : (
                                        <div className="knowledge-doc-table">
                                            <div className="knowledge-doc-table-head">
                                                <span>{t('knowledge.docColumnName')}</span>
                                                <span>{t('knowledge.docColumnType')}</span>
                                                <span>{t('knowledge.docColumnStatus')}</span>
                                                <span>{t('knowledge.docColumnChunks')}</span>
                                                <span>{t('knowledge.docColumnArtifacts')}</span>
                                                <span>{t('knowledge.updatedAt')}</span>
                                                <span>{t('knowledge.docColumnActions')}</span>
                                            </div>

                                            {filteredDocuments.map(document => {
                                                const artifacts = documentArtifacts[document.id]
                                                const health = getDocumentHealthStatus(document, artifacts)
                                                const displayTitle = getDocumentDisplayTitle(document)
                                                const showOriginalName = displayTitle !== document.name
                                                const isSelected = previewDocumentId === document.id
                                                return (
                                                    <div key={document.id} className={`knowledge-doc-row${isSelected ? ' selected' : ''}`}>
                                                        <div className="knowledge-doc-name">
                                                            <strong>{displayTitle}</strong>
                                                            {showOriginalName && (
                                                                <span className="knowledge-doc-name-meta">{document.name}</span>
                                                            )}
                                                        </div>
                                                        <span className="knowledge-doc-cell">{getDocumentType(document)}</span>
                                                        <span className="knowledge-doc-cell">
                                                            <span className={`resource-status resource-status-${health.tone}`}>
                                                                {t(health.labelKey)}
                                                            </span>
                                                        </span>
                                                        <span className="knowledge-doc-cell">{document.chunkCount}</span>
                                                        <span className="knowledge-doc-cell">{getArtifactsLabel(artifacts, t)}</span>
                                                        <span className="knowledge-doc-cell">{formatDateTime(document.updatedAt)}</span>
                                                        <div className="knowledge-doc-actions">
                                                            <div className="knowledge-doc-actions-text">
                                                                <button
                                                                    type="button"
                                                                    className="knowledge-doc-action-link"
                                                                    onClick={() => updateRouteState('chunks', { documentId: document.id })}
                                                                >
                                                                    {t('knowledge.docViewChunks')}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="knowledge-doc-action-link"
                                                                    onClick={() => {
                                                                        setRenameDocumentError(null)
                                                                        setRenameDocumentTarget(document)
                                                                    }}
                                                                    disabled={isSourceUnavailable}
                                                                >
                                                                    {t('knowledge.docRename')}
                                                                </button>
                                                            </div>
                                                            <div className="knowledge-doc-actions-icons">
                                                                <button
                                                                    type="button"
                                                                    className={`knowledge-doc-action-btn knowledge-doc-action-icon${isSelected ? ' active' : ''}`}
                                                                    title={t('files.preview')}
                                                                    aria-label={t('files.preview')}
                                                                    onClick={() => void handlePreviewDocument(document)}
                                                                >
                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                                                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                                        <circle cx="12" cy="12" r="3" />
                                                                    </svg>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="knowledge-doc-action-btn knowledge-doc-action-icon"
                                                                    title={t('files.download')}
                                                                    aria-label={t('knowledge.docDownload')}
                                                                    onClick={() => void handleDownloadDocument(document)}
                                                                    disabled={downloadingDocumentId === document.id}
                                                                >
                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                                                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                                        <polyline points="7 10 12 15 17 10" />
                                                                        <line x1="12" y1="15" x2="12" y2="3" />
                                                                    </svg>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="knowledge-doc-action-btn knowledge-doc-action-icon danger"
                                                                    title={t('common.delete')}
                                                                    aria-label={t('common.delete')}
                                                                    onClick={() => {
                                                                        setDeleteDocumentError(null)
                                                                        setDeleteDocumentTarget(document)
                                                                    }}
                                                                    disabled={isSourceUnavailable}
                                                                >
                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                                                                        <polyline points="3 6 5 6 21 6" />
                                                                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                                                        <line x1="10" y1="11" x2="10" y2="17" />
                                                                        <line x1="14" y1="11" x2="14" y2="17" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>
                    )}

                    {activeTab === 'chunks' && (
                        <KnowledgeChunksTab
                            source={source}
                            capabilities={capabilities}
                            documentFilter={searchParams.get('documentId')}
                            onDocumentFilterChange={(documentId) => updateRouteState('chunks', { documentId })}
                            onChunksMutated={reload}
                            readOnly={isSourceUnavailable}
                        />
                    )}

                    {activeTab === 'retrieval' && (
                        <KnowledgeRetrievalTab
                            source={source}
                            capabilities={capabilities}
                            defaults={defaults}
                            retrievalProfileDetail={retrievalProfileDetail}
                            disabled={isSourceUnavailable}
                        />
                    )}
                </div>

            </div>

            {showEditBasicInfoModal && (
                <EditBasicInfoModal
                    source={source}
                    onClose={() => setShowEditBasicInfoModal(false)}
                    onSave={handleSaveBasicInfo}
                />
            )}

            {showEditIndexProfileModal && (
                <EditIndexProfileModal
                    name={indexProfileName}
                    analyzerOptions={analyzerOptions}
                    indexAnalyzer={indexAnalyzer}
                    queryAnalyzer={queryAnalyzer}
                    titleBoost={titleBoost}
                    titlePathBoost={titlePathBoost}
                    keywordBoost={keywordBoost}
                    contentBoost={contentBoost}
                    bm25K1={bm25K1}
                    bm25B={bm25B}
                    saving={isSavingIndexProfile}
                    onClose={() => {
                        if (!isSavingIndexProfile) {
                            setShowEditIndexProfileModal(false)
                        }
                    }}
                    onNameChange={setIndexProfileName}
                    onIndexAnalyzerChange={setIndexAnalyzer}
                    onQueryAnalyzerChange={setQueryAnalyzer}
                    onTitleBoostChange={setTitleBoost}
                    onTitlePathBoostChange={setTitlePathBoost}
                    onKeywordBoostChange={setKeywordBoost}
                    onContentBoostChange={setContentBoost}
                    onBm25K1Change={setBm25K1}
                    onBm25BChange={setBm25B}
                    onSave={() => void handleSaveIndexProfile().then(success => {
                        if (success) {
                            setShowEditIndexProfileModal(false)
                        }
                    })}
                />
            )}

            {showEditRetrievalProfileModal && (
                <EditRetrievalProfileModal
                    name={retrievalProfileName}
                    retrievalModes={retrievalModes}
                    retrievalMode={retrievalMode}
                    lexicalTopK={lexicalTopKInput}
                    semanticTopK={semanticTopKInput}
                    finalTopK={finalTopKInput}
                    rrfK={rrfKInput}
                    snippetLength={snippetLengthInput}
                    saving={isSavingRetrievalProfile}
                    onClose={() => {
                        if (!isSavingRetrievalProfile) {
                            setShowEditRetrievalProfileModal(false)
                        }
                    }}
                    onNameChange={setRetrievalProfileName}
                    onModeChange={setRetrievalMode}
                    onLexicalTopKChange={setLexicalTopKInput}
                    onSemanticTopKChange={setSemanticTopKInput}
                    onFinalTopKChange={setFinalTopKInput}
                    onRrfKChange={setRrfKInput}
                    onSnippetLengthChange={setSnippetLengthInput}
                    onSave={() => void handleSaveRetrievalProfile().then(success => {
                        if (success) {
                            setShowEditRetrievalProfileModal(false)
                        }
                    })}
                />
            )}

            {showUploadModal && (
                <UploadDocumentsModal
                    sourceId={source.id}
                    sourceName={source.name}
                    maxFileSizeMb={defaults?.ingest.maxFileSizeMb}
                    allowedContentTypes={defaults?.ingest.allowedContentTypes}
                    onClose={() => setShowUploadModal(false)}
                    onUploaded={loadDocuments}
                />
            )}

            {deleteDocumentTarget && (
                <DeleteDocumentModal
                    documentName={deleteDocumentTarget.name}
                    deleting={deletingDocumentId === deleteDocumentTarget.id}
                    error={deleteDocumentError}
                    onClose={() => {
                        if (!deletingDocumentId) {
                            setDeleteDocumentTarget(null)
                            setDeleteDocumentError(null)
                        }
                    }}
                    onConfirm={() => void handleDeleteDocument()}
                />
            )}

            {renameDocumentTarget && (
                <RenameDocumentModal
                    document={renameDocumentTarget}
                    error={renameDocumentError}
                    saving={renamingDocumentId === renameDocumentTarget.id}
                    onClose={() => {
                        if (!renamingDocumentId) {
                            setRenameDocumentTarget(null)
                            setRenameDocumentError(null)
                        }
                    }}
                    onConfirm={(title) => void handleRenameDocument(title)}
                />
            )}

            {showDeleteModal && (
                <DeleteKnowledgeModal
                    sourceName={source.name}
                    error={deleteError}
                    deleting={isDeleting}
                    onClose={() => {
                        if (!isDeleting) {
                            setShowDeleteModal(false)
                            setDeleteError(null)
                            setIsDeleting(false)
                        }
                    }}
                    onConfirm={() => void handleDelete()}
                />
            )}

            {showRebuildModal && (
                <RebuildKnowledgeModal
                    sourceName={source.name}
                    rebuilding={isRebuildingSource}
                    onClose={() => {
                        if (!isRebuildingSource) {
                            setShowRebuildModal(false)
                        }
                    }}
                    onConfirm={() => void handleRebuildSource()}
                />
            )}
        </div>
    )
}

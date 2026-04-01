import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KNOWLEDGE_SERVICE_URL } from '../../config/runtime'
import { useToast } from '../../contexts/ToastContext'
import KnowledgeChunkDetailModal from './KnowledgeChunkDetailModal'
import type {
    KnowledgeCapabilities,
    KnowledgeChunkDetail,
    KnowledgeChunkMutationResponse,
    KnowledgeDefaults,
    KnowledgeDocumentSummary,
    KnowledgeProfileDetail,
    KnowledgeSource,
    PagedResponse,
} from '../../types/knowledge'

type RetrievalMode = 'semantic' | 'lexical' | 'hybrid'
interface RetrievalSettings {
    displayCount: number
    lexicalThresholdEnabled: boolean
    lexicalThreshold: number
    semanticThresholdEnabled: boolean
    semanticThreshold: number
}

interface RetrievalSearchHit {
    chunkId: string
    documentId: string
    sourceId: string
    title: string
    titlePath: string[]
    snippet: string
    score: number
    lexicalScore: number
    semanticScore: number
    fusionScore: number
    pageFrom: number | null
    pageTo: number | null
}

interface RetrievalCompareModeResponse {
    hits: RetrievalSearchHit[]
    total: number
}

interface RetrievalCompareResponse {
    query: string
    fetchedTopK: number
    hybrid: RetrievalCompareModeResponse
    semantic: RetrievalCompareModeResponse
    lexical: RetrievalCompareModeResponse
}

interface RetrievalHistoryEntry {
    id: string
    query: string
    createdAt: string
}

interface RetrievalCacheEntry {
    query: string
    createdAt: string
    fetchedTopK: number
    results: Record<RetrievalMode, RetrievalModeResultState>
}

interface RetrievalPersistedState {
    lastQuery: string
    settings: RetrievalSettings | null
    entries: RetrievalCacheEntry[]
}

interface RetrievalDisplayHit extends RetrievalSearchHit {
    documentName: string
    displayScore: number
    displayPercent: number
}

interface RetrievalCompareAccent {
    strongColor: string
    shape: 'circle' | 'square' | 'diamond' | 'triangle'
}

interface RetrievalSelection {
    mode: RetrievalMode
    hit: RetrievalDisplayHit
}

interface RetrievalEditorDraft {
    keywords: string[]
    keywordInput: string
    text: string
}

interface RetrievalModeResultState {
    hits: RetrievalSearchHit[]
    total: number
    error: string | null
}

interface CompareCacheState {
    query: string
    fetchedTopK: number
    results: Record<RetrievalMode, RetrievalModeResultState>
}

interface KnowledgeRetrievalTabProps {
    source: KnowledgeSource
    capabilities: KnowledgeCapabilities | null
    defaults: KnowledgeDefaults | null
    retrievalProfileDetail: KnowledgeProfileDetail | null
    disabled?: boolean
}

const QUERY_MAX_LENGTH = 200
const HISTORY_LIMIT = 8
const RECENT_HISTORY_LIMIT = 4
const TOP_K_MIN = 1
const TOP_K_MAX = 10
const COMPARE_FETCH_TOP_K = 64
const SCORE_THRESHOLD_MIN = 0
const SCORE_THRESHOLD_MAX = 1
const SCORE_THRESHOLD_STEP = 0.01
const MODE_ORDER: RetrievalMode[] = ['hybrid', 'semantic', 'lexical']
const COMPARE_ACCENT_PALETTE: RetrievalCompareAccent[] = [
    { strongColor: '#2563eb', shape: 'circle' },
    { strongColor: '#ea580c', shape: 'square' },
    { strongColor: '#16a34a', shape: 'diamond' },
    { strongColor: '#9333ea', shape: 'triangle' },
    { strongColor: '#dc2626', shape: 'circle' },
    { strongColor: '#0891b2', shape: 'square' },
    { strongColor: '#ca8a04', shape: 'diamond' },
    { strongColor: '#db2777', shape: 'triangle' },
    { strongColor: '#4f46e5', shape: 'circle' },
    { strongColor: '#7c3aed', shape: 'square' },
    { strongColor: '#0f766e', shape: 'diamond' },
    { strongColor: '#b45309', shape: 'triangle' },
]

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function formatScore(value: number): string {
    return value.toFixed(2)
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

function getChunkEditStatusLabel(
    editStatus: string | null | undefined,
    t: (key: string) => string
): string {
    switch (editStatus?.toUpperCase()) {
    case 'USER_EDITED':
        return t('knowledge.chunkEditStatusUserEdited')
    case 'SYSTEM_GENERATED':
        return t('knowledge.chunkEditStatusSystemGenerated')
    default:
        return editStatus || t('knowledge.statusUnknown')
    }
}

function normalizeRetrievalMode(value: string | null | undefined): RetrievalMode | null {
    switch (value?.toLowerCase()) {
    case 'semantic':
    case 'vector':
        return 'semantic'
    case 'lexical':
    case 'keyword':
    case 'keywords':
    case 'full_text':
        return 'lexical'
    case 'hybrid':
        return 'hybrid'
    default:
        return null
    }
}

function getStorageKey(sourceId: string): string {
    return `opsfactory:knowledge:retrieval-history:${sourceId}:v1`
}

function getCacheStorageKey(sourceId: string): string {
    return `opsfactory:knowledge:retrieval-cache:${sourceId}:v1`
}

function normalizeHistoryEntry(raw: unknown): RetrievalHistoryEntry | null {
    if (!raw || typeof raw !== 'object') return null

    const record = raw as Record<string, unknown>
    const query = typeof record.query === 'string' ? record.query.trim() : ''
    if (!query) return null

    return {
        id: typeof record.id === 'string' ? record.id : `${Date.now()}:compare:${query}`,
        query,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    }
}

function loadHistory(storageKey: string): RetrievalHistoryEntry[] {
    if (typeof window === 'undefined') return []

    try {
        const raw = window.localStorage.getItem(storageKey)
        if (!raw) return []

        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []

        return parsed
            .map(entry => normalizeHistoryEntry(entry))
            .filter((entry): entry is RetrievalHistoryEntry => Boolean(entry))
            .slice(0, HISTORY_LIMIT)
    } catch {
        return []
    }
}

function saveHistory(storageKey: string, entries: RetrievalHistoryEntry[]): void {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(storageKey, JSON.stringify(entries))
}

function normalizeModeResultState(raw: unknown): RetrievalModeResultState {
    if (!raw || typeof raw !== 'object') {
        return {
            hits: [],
            total: 0,
            error: null,
        }
    }

    const record = raw as Record<string, unknown>
    const hits = Array.isArray(record.hits) ? record.hits as RetrievalSearchHit[] : []
    const total = typeof record.total === 'number' ? record.total : hits.length
    const error = typeof record.error === 'string' ? record.error : null

    return {
        hits,
        total,
        error,
    }
}

function normalizeCacheEntry(raw: unknown): RetrievalCacheEntry | null {
    if (!raw || typeof raw !== 'object') return null

    const record = raw as Record<string, unknown>
    const query = typeof record.query === 'string' ? record.query.trim() : ''
    if (!query) return null

    const results = isRecord(record.results) ? record.results : {}

    return {
        query,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
        fetchedTopK: typeof record.fetchedTopK === 'number' ? record.fetchedTopK : COMPARE_FETCH_TOP_K,
        results: {
            hybrid: normalizeModeResultState(results.hybrid),
            semantic: normalizeModeResultState(results.semantic),
            lexical: normalizeModeResultState(results.lexical),
        },
    }
}

function loadPersistedState(storageKey: string): RetrievalPersistedState | null {
    if (typeof window === 'undefined') return null

    try {
        const raw = window.localStorage.getItem(storageKey)
        if (!raw) return null

        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object') return null

        const record = parsed as Record<string, unknown>
        const entries = Array.isArray(record.entries)
            ? record.entries
                .map(entry => normalizeCacheEntry(entry))
                .filter((entry): entry is RetrievalCacheEntry => Boolean(entry))
                .slice(0, HISTORY_LIMIT)
            : []

        return {
            lastQuery: typeof record.lastQuery === 'string' ? record.lastQuery.trim() : '',
            settings: normalizeSettings(record.settings, null),
            entries,
        }
    } catch {
        return null
    }
}

function savePersistedState(storageKey: string, state: RetrievalPersistedState | null): void {
    if (typeof window === 'undefined') return

    if (!state || (state.entries.length === 0 && state.settings === null && !state.lastQuery)) {
        window.localStorage.removeItem(storageKey)
        return
    }

    window.localStorage.setItem(storageKey, JSON.stringify(state))
}

function upsertCacheEntry(entries: RetrievalCacheEntry[], entry: RetrievalCacheEntry): RetrievalCacheEntry[] {
    const remaining = entries.filter(item => item.query !== entry.query)
    return [entry, ...remaining].slice(0, HISTORY_LIMIT)
}

function getCachedEntry(entries: RetrievalCacheEntry[], query: string): RetrievalCacheEntry | null {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return null
    return entries.find(entry => entry.query === normalizedQuery) ?? null
}

function getTopK(defaults: KnowledgeDefaults | null): number {
    return clamp(defaults?.retrieval.finalTopK ?? 3, TOP_K_MIN, TOP_K_MAX)
}

function getSupportedModes(capabilities: KnowledgeCapabilities | null): Set<RetrievalMode> {
    const modes = (capabilities?.retrievalModes || [])
        .map(mode => normalizeRetrievalMode(mode))
        .filter((mode): mode is RetrievalMode => Boolean(mode))

    if (modes.length === 0) {
        return new Set<RetrievalMode>(['semantic', 'lexical', 'hybrid'])
    }

    return new Set(modes)
}

function getOrderedModes(supportedModes: Set<RetrievalMode>): RetrievalMode[] {
    return MODE_ORDER.filter(mode => supportedModes.has(mode))
}

function getConfiguredMode(
    defaults: KnowledgeDefaults | null,
    retrievalProfileDetail: KnowledgeProfileDetail | null,
    fallbackModes: RetrievalMode[]
): RetrievalMode {
    const profileMode = normalizeRetrievalMode(
        isRecord(retrievalProfileDetail?.config)
            ? getNestedString(retrievalProfileDetail.config, 'retrieval', 'mode')
            : null
    )
    if (profileMode) return profileMode

    const defaultMode = normalizeRetrievalMode(defaults?.retrieval.mode)
    if (defaultMode) return defaultMode

    return fallbackModes[0] || 'hybrid'
}

function buildInitialSettings(defaults: KnowledgeDefaults | null): RetrievalSettings {
    return {
        displayCount: getTopK(defaults),
        lexicalThresholdEnabled: true,
        lexicalThreshold: 0.3,
        semanticThresholdEnabled: true,
        semanticThreshold: 0.3,
    }
}

function normalizeSettings(raw: unknown, defaults: KnowledgeDefaults | null): RetrievalSettings {
    const initialSettings = buildInitialSettings(defaults)

    if (!raw || typeof raw !== 'object') {
        return initialSettings
    }

    const record = raw as Record<string, unknown>

    return {
        displayCount: clamp(
            typeof record.displayCount === 'number' ? record.displayCount : initialSettings.displayCount,
            TOP_K_MIN,
            TOP_K_MAX
        ),
        lexicalThresholdEnabled: typeof record.lexicalThresholdEnabled === 'boolean'
            ? record.lexicalThresholdEnabled
            : initialSettings.lexicalThresholdEnabled,
        lexicalThreshold: clamp(
            typeof record.lexicalThreshold === 'number' ? record.lexicalThreshold : initialSettings.lexicalThreshold,
            SCORE_THRESHOLD_MIN,
            SCORE_THRESHOLD_MAX
        ),
        semanticThresholdEnabled: typeof record.semanticThresholdEnabled === 'boolean'
            ? record.semanticThresholdEnabled
            : initialSettings.semanticThresholdEnabled,
        semanticThreshold: clamp(
            typeof record.semanticThreshold === 'number' ? record.semanticThreshold : initialSettings.semanticThreshold,
            SCORE_THRESHOLD_MIN,
            SCORE_THRESHOLD_MAX
        ),
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getNestedString(value: Record<string, unknown>, ...keys: string[]): string | null {
    let current: unknown = value

    for (const key of keys) {
        if (!isRecord(current) || !(key in current)) {
            return null
        }
        current = current[key]
    }

    return typeof current === 'string' ? current : null
}

function getModeLabelKey(mode: RetrievalMode): string {
    switch (mode) {
    case 'semantic':
        return 'knowledge.retrievalModeSemantic'
    case 'lexical':
        return 'knowledge.retrievalModeLexical'
    case 'hybrid':
        return 'knowledge.retrievalModeHybrid'
    }
}

function getDocumentName(documentId: string, names: Record<string, string>): string {
    return names[documentId] || documentId
}

function getModeScore(hit: RetrievalSearchHit, mode: RetrievalMode): number {
    const modeScore = mode === 'hybrid'
        ? hit.fusionScore
        : mode === 'semantic'
            ? hit.semanticScore
            : hit.lexicalScore

    if (Number.isFinite(modeScore) && modeScore > 0) {
        return modeScore
    }

    return hit.score
}

function isThresholdEnabledForMode(mode: RetrievalMode, settings: RetrievalSettings): boolean {
    if (mode === 'semantic') return settings.semanticThresholdEnabled
    if (mode === 'lexical') return settings.lexicalThresholdEnabled
    return false
}

function getThresholdForMode(mode: RetrievalMode, settings: RetrievalSettings): number | null {
    if (mode === 'semantic') return settings.semanticThreshold
    if (mode === 'lexical') return settings.lexicalThreshold
    return null
}

function buildDisplayResults(
    mode: RetrievalMode,
    hits: RetrievalSearchHit[],
    documentNames: Record<string, string>,
    settings: RetrievalSettings
): RetrievalDisplayHit[] {
    return hits
        .filter(hit => {
            if (mode === 'hybrid') {
                return true
            }

            if (!isThresholdEnabledForMode(mode, settings)) {
                return true
            }

            const threshold = getThresholdForMode(mode, settings)
            return threshold === null || getModeScore(hit, mode) >= threshold
        })
        .slice(0, settings.displayCount)
        .map(hit => {
        const rawScore = getModeScore(hit, mode)

        return {
            ...hit,
            documentName: getDocumentName(hit.documentId, documentNames),
            displayScore: rawScore,
            displayPercent: Math.round(clamp(rawScore, 0, 1) * 100),
        }
    })
}

function upsertHistoryEntry(entries: RetrievalHistoryEntry[], entry: RetrievalHistoryEntry): RetrievalHistoryEntry[] {
    const remaining = entries.filter(item =>
        item.query !== entry.query
    )

    return [entry, ...remaining].slice(0, HISTORY_LIMIT)
}

function buildPageRange(pageFrom: number | null, pageTo: number | null, fallback: string): string {
    if (pageFrom === null || pageFrom === undefined) return fallback
    if (pageTo === null || pageTo === undefined || pageTo === pageFrom) return String(pageFrom)
    return `${pageFrom}-${pageTo}`
}

function parseKeywords(value: string): string[] {
    const seen = new Set<string>()

    return value
        .split(/[\n,，;；]+/)
        .map(item => item.trim())
        .filter(Boolean)
        .filter(item => {
            const normalized = item.toLowerCase()
            if (seen.has(normalized)) return false
            seen.add(normalized)
            return true
        })
}

function appendKeywords(current: string[], value: string): string[] {
    const seen = new Set(current.map(item => item.toLowerCase()))
    const additions = parseKeywords(value)

    if (additions.length === 0) {
        return current
    }

    return [
        ...current,
        ...additions.filter(item => {
            const normalized = item.toLowerCase()
            if (seen.has(normalized)) return false
            seen.add(normalized)
            return true
        }),
    ]
}

function createEmptyModeResults(): Record<RetrievalMode, RetrievalModeResultState> {
    return {
        semantic: {
            hits: [],
            total: 0,
            error: null,
        },
        lexical: {
            hits: [],
            total: 0,
            error: null,
        },
        hybrid: {
            hits: [],
            total: 0,
            error: null,
        },
    }
}

function buildCompareAccentMap(
    orderedModes: RetrievalMode[],
    resultsByMode: Record<RetrievalMode, RetrievalDisplayHit[]>
): Record<string, RetrievalCompareAccent> {
    const modesByChunk = new Map<string, Set<RetrievalMode>>()
    const compareChunkIdsInOrder: string[] = []

    orderedModes.forEach(mode => {
        resultsByMode[mode].forEach(hit => {
            const existing = modesByChunk.get(hit.chunkId)
            if (existing) {
                existing.add(mode)
                return
            }

            modesByChunk.set(hit.chunkId, new Set([mode]))
            compareChunkIdsInOrder.push(hit.chunkId)
        })
    })

    const repeatedChunkIds = compareChunkIdsInOrder
        .filter(chunkId => (modesByChunk.get(chunkId)?.size ?? 0) >= 2)

    return repeatedChunkIds.reduce<Record<string, RetrievalCompareAccent>>((accumulator, chunkId, index) => {
        const paletteIndex = (index * 5) % COMPARE_ACCENT_PALETTE.length
        accumulator[chunkId] = COMPARE_ACCENT_PALETTE[paletteIndex]
        return accumulator
    }, {})
}

function toCompareModeResponse(payload: { hits?: RetrievalSearchHit[]; total?: number } | null | undefined): RetrievalCompareModeResponse {
    const hits = payload?.hits || []
    return {
        hits,
        total: payload?.total ?? hits.length,
    }
}

function RetrievalModePanel({
    mode,
    results,
    rawCount,
    error,
    searched,
    loading,
    thresholdFiltered,
    selectedKey,
    compareAccentByChunkId,
    onSelect,
}: {
    mode: RetrievalMode
    results: RetrievalDisplayHit[]
    rawCount: number
    error: string | null
    searched: boolean
    loading: boolean
    thresholdFiltered: boolean
    selectedKey: string | null
    compareAccentByChunkId: Record<string, RetrievalCompareAccent>
    onSelect: (mode: RetrievalMode, hit: RetrievalDisplayHit) => void
}) {
    const { t } = useTranslation()
    const emptyState = !searched
        ? t('knowledge.retrievalModeIdle')
        : thresholdFiltered
            ? t('knowledge.retrievalNoResultsThreshold')
        : t('knowledge.retrievalNoResults')
    return (
        <section className="knowledge-retrieval-mode-panel">
            <div className="knowledge-retrieval-mode-panel-header">
                <div className="knowledge-retrieval-mode-panel-copy">
                    <div className="knowledge-retrieval-mode-panel-title-row">
                        <h3 className="knowledge-retrieval-mode-panel-title">{t(getModeLabelKey(mode))}</h3>
                        {mode === 'hybrid' && (
                            <span className="knowledge-retrieval-mode-pill">{t('knowledge.retrievalModeRecommended')}</span>
                        )}
                    </div>
                    <div className="resource-card-tags">
                        <span className="resource-card-tag">{t('knowledge.retrievalColumnRawCount', { count: rawCount })}</span>
                        <span className="resource-card-tag">{t('knowledge.retrievalColumnShownCount', { count: results.length })}</span>
                    </div>
                </div>

            </div>

            {error && (
                <div className="conn-banner conn-banner-error">
                    {t('common.connectionError', { error })}
                </div>
            )}

            <div className="knowledge-retrieval-mode-results">
                {loading ? (
                    <div className="knowledge-retrieval-mode-empty">{t('common.loading')}</div>
                ) : results.length === 0 ? (
                    <div className="knowledge-retrieval-mode-empty">{emptyState}</div>
                ) : (
                    results.map((hit, index) => {
                        const selectionKey = `${mode}:${hit.chunkId}`
                        const compareAccent = compareAccentByChunkId[hit.chunkId]
                        return (
                            <button
                                key={selectionKey}
                                type="button"
                                className={`knowledge-retrieval-hit-card ${selectedKey === selectionKey ? 'selected' : ''} ${compareAccent ? `has-compare-accent compare-accent-${compareAccent.shape}` : ''}`}
                                onClick={() => onSelect(mode, hit)}
                                style={compareAccent ? {
                                    ['--compare-accent-strong' as string]: compareAccent.strongColor,
                                } : undefined}
                            >
                                <span className="knowledge-retrieval-hit-rank">#{index + 1}</span>
                                <div className="knowledge-retrieval-hit-main">
                                    <div className="knowledge-retrieval-hit-head">
                                        <strong className="knowledge-retrieval-hit-title">{hit.documentName}</strong>
                                        {mode === 'hybrid' ? (
                                            <span className="knowledge-retrieval-score-pill">{t('knowledge.retrievalHybridRankOnly')}</span>
                                        ) : (
                                            <span className="knowledge-retrieval-score-pill">{formatScore(hit.displayScore)}</span>
                                        )}
                                    </div>
                                    <p className="knowledge-retrieval-hit-snippet">{hit.snippet || hit.title || hit.chunkId}</p>
                                    <div className="knowledge-retrieval-hit-footer">
                                        <span className="knowledge-retrieval-result-meta">
                                            {t('knowledge.retrievalPageShort')} {buildPageRange(hit.pageFrom, hit.pageTo, t('knowledge.notAvailable'))}
                                        </span>
                                        <span className="knowledge-retrieval-result-meta">
                                            {hit.title || t('knowledge.notAvailable')}
                                        </span>
                                        <span className="knowledge-retrieval-result-meta knowledge-retrieval-hit-chunk">
                                            {hit.chunkId}
                                        </span>
                                        {mode !== 'hybrid' && (
                                            <span className="knowledge-retrieval-result-meta">
                                                {t('knowledge.retrievalModeScoreLabel')} {formatScore(hit.displayScore)}
                                            </span>
                                        )}
                                    </div>
                                    {mode === 'hybrid' && (
                                        <div className="knowledge-retrieval-score-metas">
                                            <span className="knowledge-retrieval-result-meta knowledge-retrieval-result-meta-score">
                                                {t('knowledge.retrievalLexicalScoreLabel')} {formatScore(hit.lexicalScore)}
                                            </span>
                                            <span className="knowledge-retrieval-result-meta knowledge-retrieval-result-meta-score">
                                                {t('knowledge.retrievalSemanticScoreLabel')} {formatScore(hit.semanticScore)}
                                            </span>
                                            <span className="knowledge-retrieval-result-meta knowledge-retrieval-result-meta-score">
                                                {t('knowledge.retrievalFusionScoreLabel')} {formatScore(hit.fusionScore)}
                                            </span>
                                        </div>
                                    )}
                                    {mode !== 'hybrid' && (
                                        <div className="knowledge-retrieval-bar">
                                            <span style={{ width: `${hit.displayPercent}%` }} />
                                        </div>
                                    )}
                                </div>
                            </button>
                        )
                    })
                )}
            </div>
        </section>
    )
}

function RetrievalDetailPanel({
    selection,
    detail,
    loading,
    error,
    canEdit,
    onReload,
    onClear,
}: {
    selection: RetrievalSelection | null
    detail: KnowledgeChunkDetail | null
    loading: boolean
    error: string | null
    canEdit: boolean
    onReload: () => Promise<void>
    onClear: () => void
}) {
    const { t } = useTranslation()
    const { showToast } = useToast()
    const [panelMode, setPanelMode] = useState<'view' | 'edit'>('view')
    const [draft, setDraft] = useState<RetrievalEditorDraft | null>(null)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    useEffect(() => {
        setPanelMode('view')
        setSaving(false)
        setSaveError(null)
        setDraft(detail ? {
            keywords: detail.keywords,
            keywordInput: '',
            text: detail.text || detail.markdown || '',
        } : null)
    }, [detail, selection])

    if (!selection) {
        return null
    }

    const { hit } = selection
    const content = detail?.text || detail?.markdown || hit.snippet || ''
    const isEditing = panelMode === 'edit'
    const detailTitle = detail?.title?.trim() || hit.title?.trim() || t('knowledge.chunkUntitled')
    const retrievalContextItems = [
        {
            label: t('knowledge.retrievalDetailMode'),
            value: t(getModeLabelKey(selection.mode)),
        },
        ...(selection.mode === 'hybrid'
            ? []
            : [{
                label: t('knowledge.retrievalModeScoreLabel'),
                value: formatScore(hit.displayScore),
            }]),
        {
            label: t('knowledge.retrievalLexicalScoreLabel'),
            value: formatScore(hit.lexicalScore),
        },
        {
            label: t('knowledge.retrievalSemanticScoreLabel'),
            value: formatScore(hit.semanticScore),
        },
        {
            label: t('knowledge.retrievalFusionScoreLabel'),
            value: formatScore(hit.fusionScore),
        },
        {
            label: t('knowledge.retrievalDetailTitlePath'),
            value: (detail?.titlePath || hit.titlePath).length > 0
                ? (detail?.titlePath || hit.titlePath).join(' / ')
                : t('knowledge.notAvailable'),
        },
    ]

    const metadataItems = [
        {
            label: t('knowledge.retrievalDetailDocument'),
            value: hit.documentName,
        },
        {
            label: t('knowledge.retrievalDetailChunkId'),
            value: hit.chunkId,
            code: true,
        },
        {
            label: t('knowledge.retrievalDetailPageRange'),
            value: buildPageRange(detail?.pageFrom ?? hit.pageFrom, detail?.pageTo ?? hit.pageTo, t('knowledge.notAvailable')),
        },
        {
            label: t('knowledge.chunkOrdinal'),
            value: detail?.ordinal ?? t('knowledge.notAvailable'),
        },
        {
            label: t('knowledge.chunkEditStatusLabel'),
            value: getChunkEditStatusLabel(detail?.editStatus, t),
        },
        {
            label: t('knowledge.updatedAt'),
            value: formatDateTime(detail?.updatedAt),
        },
        {
            label: t('knowledge.chunkUpdatedBy'),
            value: detail?.updatedBy || t('knowledge.notAvailable'),
        },
        {
            label: t('common.tokens'),
            value: detail?.tokenCount ?? t('knowledge.notAvailable'),
        },
        {
            label: t('knowledge.chunkTextLength'),
            value: detail?.textLength ?? t('knowledge.notAvailable'),
        },
    ]

    const commitPendingKeyword = () => {
        setDraft(current => {
            if (!current) return current

            const nextKeywords = appendKeywords(current.keywords, current.keywordInput)
            if (nextKeywords === current.keywords && !current.keywordInput.trim()) {
                return current
            }

            return {
                ...current,
                keywords: nextKeywords,
                keywordInput: '',
            }
        })
    }

    const handleRemoveKeyword = (keyword: string) => {
        setDraft(current => current
            ? {
                ...current,
                keywords: current.keywords.filter(item => item.toLowerCase() !== keyword.toLowerCase()),
            }
            : current
        )
    }

    const handleSave = async () => {
        if (!draft) return

        const text = draft.text.trim()
        const keywords = appendKeywords(draft.keywords, draft.keywordInput)

        setSaveError(null)

        if (!text) {
            setSaveError(t('knowledge.chunkContentRequired'))
            return
        }

        setSaving(true)

        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/chunks/${hit.chunkId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    keywords,
                    text,
                    markdown: text,
                }),
            })
            const data = await response.json().catch(() => null) as KnowledgeChunkMutationResponse | { message?: string } | null

            if (!response.ok) {
                throw new Error(
                    data && typeof data === 'object' && 'message' in data
                        ? String(data.message || response.statusText)
                        : response.statusText
                )
            }

            await onReload()
            setPanelMode('view')
            showToast('success', t('knowledge.chunkSaveSuccess'))
        } catch (err) {
            setSaveError(t('knowledge.chunkSaveFailed', {
                error: err instanceof Error ? err.message : t('errors.unknown'),
            }))
        } finally {
            setSaving(false)
        }
    }

    return (
        <KnowledgeChunkDetailModal
            title={detailTitle}
            subtitle={hit.chunkId}
            headerMeta={(
                <span className="resource-card-tag">{hit.documentName}</span>
            )}
            badges={[
                `${t('knowledge.retrievalDetailMode')} ${t(getModeLabelKey(selection.mode))}`,
                ...(selection.mode === 'hybrid' ? [] : [`${t('knowledge.retrievalModeScoreLabel')} ${formatScore(hit.displayScore)}`]),
                `${t('knowledge.retrievalLexicalScoreLabel')} ${formatScore(hit.lexicalScore)}`,
                `${t('knowledge.retrievalSemanticScoreLabel')} ${formatScore(hit.semanticScore)}`,
                `${t('knowledge.retrievalFusionScoreLabel')} ${formatScore(hit.fusionScore)}`,
                `${t('knowledge.retrievalPageShort')} ${buildPageRange(detail?.pageFrom ?? hit.pageFrom, detail?.pageTo ?? hit.pageTo, t('knowledge.notAvailable'))}`,
            ]}
            error={saveError || (error ? t('common.connectionError', { error }) : null)}
            loading={loading}
            loadingLabel={t('knowledge.retrievalDetailLoading')}
            mainSectionTitle={t('knowledge.retrievalDetailContent')}
            mainSectionContent={isEditing ? (
                <>
                    <label className="knowledge-visually-hidden" htmlFor="knowledge-retrieval-chunk-content">
                        {t('knowledge.chunkContentTitle')}
                    </label>
                    <textarea
                        id="knowledge-retrieval-chunk-content"
                        className="form-input knowledge-chunk-content-input"
                        rows={18}
                        value={draft?.text || ''}
                        onChange={event => setDraft(current => current
                            ? {
                                ...current,
                                text: event.target.value,
                            }
                            : current
                        )}
                        disabled={saving}
                    />
                </>
            ) : (
                <div className="knowledge-retrieval-detail-content-panel">
                    <div className="knowledge-retrieval-detail-content-text">{content || t('knowledge.notAvailable')}</div>
                </div>
            )}
            sidebarSections={[
                {
                    key: 'metadata',
                    title: t('knowledge.retrievalDetailMetadata'),
                    content: (
                        <div className="knowledge-chunk-detail-meta-list">
                            {metadataItems.map(item => (
                                <div key={item.label} className="knowledge-kv-item knowledge-chunk-detail-meta-row">
                                    <span className="knowledge-kv-label">{item.label}</span>
                                    <span className={`knowledge-kv-value ${item.code ? 'knowledge-kv-code' : ''}`.trim()}>
                                        {item.value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ),
                },
                {
                    key: 'keywords',
                    title: t('knowledge.retrievalDetailKeywords'),
                    content: isEditing ? (
                        <div className="form-group knowledge-chunk-detail-form-group">
                            <label className="form-label" htmlFor="knowledge-retrieval-chunk-keywords">
                                {t('knowledge.chunkKeywordsLabel')}
                            </label>
                            <div className="knowledge-chunk-keyword-surface">
                                <div className="knowledge-chunk-keyword-list">
                                    {draft?.keywords && draft.keywords.length > 0 ? (
                                        draft.keywords.map(keyword => (
                                            <span key={keyword} className="knowledge-chunk-keyword-pill">
                                                <span>{keyword}</span>
                                                <button
                                                    type="button"
                                                    className="knowledge-chunk-keyword-pill-remove"
                                                    onClick={() => handleRemoveKeyword(keyword)}
                                                    disabled={saving}
                                                    aria-label={`${t('common.delete')} ${keyword}`}
                                                >
                                                    &times;
                                                </button>
                                            </span>
                                        ))
                                    ) : (
                                        <span className="knowledge-inline-empty">{t('knowledge.notAvailable')}</span>
                                    )}
                                </div>
                                <input
                                    id="knowledge-retrieval-chunk-keywords"
                                    className="knowledge-chunk-keyword-inline-input"
                                    type="text"
                                    placeholder={t('knowledge.chunkKeywordsPlaceholder')}
                                    value={draft?.keywordInput || ''}
                                    onChange={event => setDraft(current => current
                                        ? {
                                            ...current,
                                            keywordInput: event.target.value,
                                        }
                                        : current
                                    )}
                                    onBlur={commitPendingKeyword}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                                            event.preventDefault()
                                            commitPendingKeyword()
                                        }
                                    }}
                                    disabled={saving}
                                />
                            </div>
                        </div>
                    ) : detail?.keywords && detail.keywords.length > 0 ? (
                        <div className="knowledge-chunk-keyword-surface knowledge-chunk-keyword-surface-readonly knowledge-retrieval-keywords">
                            {detail.keywords.map(keyword => (
                                <span key={keyword} className="knowledge-chunk-keyword-pill">{keyword}</span>
                            ))}
                        </div>
                    ) : (
                        <p className="knowledge-section-empty">{t('knowledge.notAvailable')}</p>
                    ),
                },
                {
                    key: 'retrieval-context',
                    title: t('knowledge.retrievalDetailMode'),
                    content: (
                        <div className="knowledge-chunk-detail-meta-list">
                            {retrievalContextItems.map(item => (
                                <div key={item.label} className="knowledge-kv-item knowledge-chunk-detail-meta-row">
                                    <span className="knowledge-kv-label">{item.label}</span>
                                    <span className="knowledge-kv-value">{item.value}</span>
                                </div>
                            ))}
                        </div>
                    ),
                },
            ]}
            footer={(
                <div className="knowledge-chunk-detail-footer-actions">
                    <div className="knowledge-chunk-detail-footer-danger" />
                    <div className="knowledge-chunk-detail-footer-primary">
                        <button
                            type="button"
                            className="btn btn-secondary btn-subtle"
                            onClick={() => {
                                if (isEditing) {
                                    setPanelMode('view')
                                    setSaveError(null)
                                    setDraft(detail ? {
                                        keywords: detail.keywords,
                                        keywordInput: '',
                                        text: detail.text || detail.markdown || '',
                                    } : null)
                                    return
                                }

                                onClear()
                            }}
                            disabled={saving}
                        >
                            {isEditing ? t('common.cancel') : t('common.close')}
                        </button>
                        {canEdit ? (
                            isEditing ? (
                                <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
                                    {saving ? t('knowledge.saving') : t('common.save')}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => setPanelMode('edit')}
                                    disabled={loading || !detail}
                                >
                                    {t('common.edit')}
                                </button>
                            )
                        ) : null}
                    </div>
                </div>
            )}
            onClose={onClear}
            widthClassName="knowledge-retrieval-detail-modal-compare"
        />
    )
}

export default function KnowledgeRetrievalTab({
    source,
    capabilities,
    defaults,
    retrievalProfileDetail,
    disabled = false,
}: KnowledgeRetrievalTabProps) {
    const { t } = useTranslation()
    const { showToast } = useToast()

    const allowRequestOverride = capabilities?.featureFlags.allowRequestOverride ?? true
    const systemSupportedModes = useMemo(() => getSupportedModes(capabilities), [capabilities])
    const configuredMode = useMemo(
        () => getConfiguredMode(defaults, retrievalProfileDetail, getOrderedModes(systemSupportedModes)),
        [defaults, retrievalProfileDetail, systemSupportedModes]
    )
    const supportedModes = useMemo(() => {
        if (allowRequestOverride) {
            return systemSupportedModes
        }

        return new Set<RetrievalMode>([configuredMode])
    }, [allowRequestOverride, configuredMode, systemSupportedModes])
    const orderedModes = useMemo(() => getOrderedModes(supportedModes), [supportedModes])
    const storageKey = useMemo(() => getStorageKey(source.id), [source.id])
    const cacheStorageKey = useMemo(() => getCacheStorageKey(source.id), [source.id])

    const [settings, setSettings] = useState<RetrievalSettings>(() => {
        const persistedState = loadPersistedState(cacheStorageKey)
        return persistedState?.settings
            ? normalizeSettings(persistedState.settings, defaults)
            : buildInitialSettings(defaults)
    })
    const [query, setQuery] = useState('')
    const [history, setHistory] = useState<RetrievalHistoryEntry[]>(() => loadHistory(storageKey))
    const [cachedEntries, setCachedEntries] = useState<RetrievalCacheEntry[]>(() => loadPersistedState(cacheStorageKey)?.entries ?? [])
    const [hasLoadedPersistedState, setHasLoadedPersistedState] = useState(false)
    const [documentNames, setDocumentNames] = useState<Record<string, string>>({})
    const [modeResults, setModeResults] = useState<Record<RetrievalMode, RetrievalModeResultState>>(() => createEmptyModeResults())
    const [compareCache, setCompareCache] = useState<CompareCacheState | null>(null)
    const [lastExecutedQuery, setLastExecutedQuery] = useState('')
    const [searchedModes, setSearchedModes] = useState<RetrievalMode[]>([])
    const [activeSearchModes, setActiveSearchModes] = useState<RetrievalMode[]>([])
    const [searchError, setSearchError] = useState<string | null>(null)
    const [selection, setSelection] = useState<RetrievalSelection | null>(null)
    const [detail, setDetail] = useState<KnowledgeChunkDetail | null>(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [detailError, setDetailError] = useState<string | null>(null)

    const loadChunkDetail = useCallback(async (chunkId: string): Promise<KnowledgeChunkDetail> => {
        const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/chunks/${chunkId}`)
        const data = await response.json().catch(() => null) as KnowledgeChunkDetail | { message?: string } | null

        if (!response.ok) {
            throw new Error(
                data && typeof data === 'object' && 'message' in data
                    ? String(data.message || response.statusText)
                    : response.statusText
            )
        }

        return data as KnowledgeChunkDetail
    }, [])

    useEffect(() => {
        setHistory(loadHistory(storageKey))
    }, [storageKey])

    useEffect(() => {
        saveHistory(storageKey, history)
    }, [history, storageKey])

    useEffect(() => {
        const persistedState = loadPersistedState(cacheStorageKey)
        const nextCachedEntries = persistedState?.entries ?? []
        const lastQuery = persistedState?.lastQuery ?? ''
        const lastEntry = getCachedEntry(nextCachedEntries, lastQuery)
        const restoredModes = lastEntry ? [...orderedModes] : []
        const persistedSettings = normalizeSettings(persistedState?.settings, defaults)

        setCachedEntries(nextCachedEntries)
        setSettings(persistedSettings)
        setQuery(lastEntry?.query ?? '')
        setModeResults(lastEntry?.results ?? createEmptyModeResults())
        setCompareCache(lastEntry ? {
            query: lastEntry.query,
            fetchedTopK: lastEntry.fetchedTopK,
            results: lastEntry.results,
        } : null)
        setLastExecutedQuery(lastEntry?.query ?? '')
        setSearchedModes(lastEntry ? restoredModes : [])
        setActiveSearchModes([])
        setSearchError(null)
        setSelection(null)
        setDetail(null)
        setDetailError(null)
        setDetailLoading(false)
        setHasLoadedPersistedState(true)
    }, [cacheStorageKey, orderedModes, source.id])

    useEffect(() => {
        if (!hasLoadedPersistedState) return
        savePersistedState(cacheStorageKey, {
            lastQuery: lastExecutedQuery,
            settings,
            entries: cachedEntries,
        })
    }, [cacheStorageKey, cachedEntries, hasLoadedPersistedState, lastExecutedQuery, settings])

    useEffect(() => {
        let cancelled = false

        const loadDocumentNames = async () => {
            try {
                const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/documents?sourceId=${source.id}&page=1&pageSize=100`)
                const data = await response.json().catch(() => null) as PagedResponse<KnowledgeDocumentSummary> | { message?: string } | null

                if (!response.ok) {
                    throw new Error(
                        data && typeof data === 'object' && 'message' in data
                            ? String(data.message || response.statusText)
                            : response.statusText
                    )
                }

                if (cancelled) return

                const items = (data as PagedResponse<KnowledgeDocumentSummary>).items || []
                setDocumentNames(Object.fromEntries(items.map(item => [item.id, item.name])))
            } catch {
                if (!cancelled) {
                    setDocumentNames({})
                }
            }
        }

        void loadDocumentNames()

        return () => {
            cancelled = true
        }
    }, [source.id])

    const displayResultsByMode = useMemo<Record<RetrievalMode, RetrievalDisplayHit[]>>(() => ({
        semantic: buildDisplayResults('semantic', modeResults.semantic.hits, documentNames, settings),
        lexical: buildDisplayResults('lexical', modeResults.lexical.hits, documentNames, settings),
        hybrid: buildDisplayResults('hybrid', modeResults.hybrid.hits, documentNames, settings),
    }), [documentNames, modeResults, settings])
    const compareAccentByChunkId = useMemo(
        () => buildCompareAccentMap(orderedModes, displayResultsByMode),
        [displayResultsByMode, orderedModes]
    )
    const thresholdFilteredByMode = useMemo<Record<RetrievalMode, boolean>>(() => ({
        hybrid: false,
        semantic: searchedModes.includes('semantic')
            && modeResults.semantic.total > 0
            && displayResultsByMode.semantic.length === 0,
        lexical: searchedModes.includes('lexical')
            && modeResults.lexical.total > 0
            && displayResultsByMode.lexical.length === 0,
    }), [displayResultsByMode.lexical.length, displayResultsByMode.semantic.length, modeResults.lexical.total, modeResults.semantic.total, searchedModes])

    const selectedKey = selection ? `${selection.mode}:${selection.hit.chunkId}` : null
    const recentHistory = history.slice(0, RECENT_HISTORY_LIMIT)
    const hasSearchedVisibleModes = orderedModes.some(mode => searchedModes.includes(mode))
    const hasActiveVisibleModes = orderedModes.some(mode => activeSearchModes.includes(mode))
    const effectiveQuery = query.trim()
    const testButtonDisabled = disabled || activeSearchModes.length > 0
        || !effectiveQuery
        || (effectiveQuery === lastExecutedQuery && compareCache !== null)
    const compareDiagnostic = useMemo(() => {
        if (orderedModes.length < 2) return null
        if (!orderedModes.every(mode => searchedModes.includes(mode))) return null

        const referenceIds = modeResults[orderedModes[0]].hits.map(hit => hit.chunkId)
        const identicalResults = orderedModes.slice(1).every(mode => {
            const currentIds = modeResults[mode].hits.map(hit => hit.chunkId)
            return currentIds.length === referenceIds.length
                && currentIds.every((chunkId, index) => chunkId === referenceIds[index])
        })

        const semanticAllZero = modeResults.semantic.hits.length > 0
            && modeResults.semantic.hits.every(hit => hit.semanticScore <= 0)

        if (identicalResults && semanticAllZero) {
            return t('knowledge.retrievalCompareWarningSemanticInactive')
        }

        if (identicalResults) {
            return t('knowledge.retrievalCompareWarningIdentical')
        }

        if (semanticAllZero) {
            return t('knowledge.retrievalCompareWarningSemanticZero')
        }

        return null
    }, [modeResults, orderedModes, searchedModes, t])

    const executeCompareSearch = useCallback(async (
        effectiveQuery: string,
        modes: RetrievalMode[]
    ) => {
        const baseBody: Record<string, unknown> = {
            query: effectiveQuery,
            sourceIds: [source.id],
        }

        if (source.retrievalProfileId) {
            baseBody.retrievalProfileId = source.retrievalProfileId
        }

        const compareBody = {
            ...baseBody,
            modes,
        }

        const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/search/compare`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(compareBody),
        })
        const data = await response.json().catch(() => null) as RetrievalCompareResponse | { message?: string } | null

        if (response.status === 404 || response.status === 405) {
            const modeResponses = await Promise.all(modes.map(async mode => {
                const legacyResponse = await fetch(`${KNOWLEDGE_SERVICE_URL}/search`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        ...baseBody,
                        topK: COMPARE_FETCH_TOP_K,
                        override: {
                            mode,
                            includeScores: true,
                            lexicalTopK: COMPARE_FETCH_TOP_K,
                            semanticTopK: COMPARE_FETCH_TOP_K,
                        },
                    }),
                })
                const legacyData = await legacyResponse.json().catch(() => null) as RetrievalCompareModeResponse | { hits?: RetrievalSearchHit[]; total?: number; message?: string } | null

                if (!legacyResponse.ok) {
                    throw new Error(
                        legacyData && typeof legacyData === 'object' && 'message' in legacyData
                            ? String(legacyData.message || legacyResponse.statusText)
                            : legacyResponse.statusText
                    )
                }

                return [mode, toCompareModeResponse(legacyData)] as const
            }))

            const resultMap = Object.fromEntries(modeResponses) as Partial<Record<RetrievalMode, RetrievalCompareModeResponse>>

            return {
                query: effectiveQuery,
                fetchedTopK: COMPARE_FETCH_TOP_K,
                hybrid: resultMap.hybrid ?? { hits: [], total: 0 },
                semantic: resultMap.semantic ?? { hits: [], total: 0 },
                lexical: resultMap.lexical ?? { hits: [], total: 0 },
            } satisfies RetrievalCompareResponse
        }

        if (!response.ok) {
            throw new Error(
                data && typeof data === 'object' && 'message' in data
                    ? String(data.message || response.statusText)
                    : response.statusText
            )
        }

        return data as RetrievalCompareResponse
    }, [source.id, source.retrievalProfileId])

    const executeSearch = useCallback(async (nextQuery?: string) => {
        const effectiveQuery = (nextQuery ?? query).trim()

        if (!effectiveQuery) {
            setSearchError(t('knowledge.retrievalQueryRequired'))
            return
        }

        const modesToQuery = orderedModes

        if (modesToQuery.length === 0) {
            return
        }

        setSearchError(null)
        setSelection(null)
        setDetail(null)
        setDetailError(null)
        setActiveSearchModes(modesToQuery)

        try {
            const compareResponse = await executeCompareSearch(effectiveQuery, modesToQuery)
            const nextResults: Record<RetrievalMode, RetrievalModeResultState> = {
                hybrid: {
                    hits: compareResponse.hybrid.hits || [],
                    total: compareResponse.hybrid.total ?? (compareResponse.hybrid.hits || []).length,
                    error: null,
                },
                semantic: {
                    hits: compareResponse.semantic.hits || [],
                    total: compareResponse.semantic.total ?? (compareResponse.semantic.hits || []).length,
                    error: null,
                },
                lexical: {
                    hits: compareResponse.lexical.hits || [],
                    total: compareResponse.lexical.total ?? (compareResponse.lexical.hits || []).length,
                    error: null,
                },
            }

            setModeResults(nextResults)
            setCompareCache({
                query: effectiveQuery,
                fetchedTopK: compareResponse.fetchedTopK,
                results: nextResults,
            })
            setLastExecutedQuery(effectiveQuery)
            setSearchedModes(modesToQuery)
            setCachedEntries(current => upsertCacheEntry(current, {
                query: effectiveQuery,
                createdAt: new Date().toISOString(),
                fetchedTopK: compareResponse.fetchedTopK,
                results: nextResults,
            }))

            if (modesToQuery.length > 0) {
                setHistory(current => upsertHistoryEntry(current, {
                    id: `${Date.now()}:compare:${effectiveQuery}`,
                    query: effectiveQuery,
                    createdAt: new Date().toISOString(),
                }))
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.unknown')
            setSearchError(message)
            showToast('error', message)
        } finally {
            setActiveSearchModes([])
        }
    }, [executeCompareSearch, orderedModes, query, settings, showToast, t])

    const handleReplayHistory = useCallback((entry: RetrievalHistoryEntry) => {
        setQuery(entry.query)
        if (compareCache && lastExecutedQuery === entry.query) {
            return
        }

        const cachedEntry = getCachedEntry(cachedEntries, entry.query)
        if (cachedEntry) {
            setModeResults(cachedEntry.results)
            setCompareCache({
                query: cachedEntry.query,
                fetchedTopK: cachedEntry.fetchedTopK,
                results: cachedEntry.results,
            })
            setLastExecutedQuery(cachedEntry.query)
            setSearchedModes([...orderedModes])
            setActiveSearchModes([])
            setSearchError(null)
            setSelection(null)
            setDetail(null)
            setDetailError(null)
            return
        }

        void executeSearch(entry.query)
    }, [cachedEntries, compareCache, executeSearch, lastExecutedQuery, orderedModes])

    useEffect(() => {
        if (!selection) {
            setDetail(null)
            setDetailError(null)
            setDetailLoading(false)
            return
        }

        let cancelled = false

        const loadDetail = async () => {
            setDetailLoading(true)
            setDetailError(null)

            try {
                const data = await loadChunkDetail(selection.hit.chunkId)

                if (!cancelled) {
                    setDetail(data)
                }
            } catch (err) {
                if (!cancelled) {
                    setDetail(null)
                    setDetailError(err instanceof Error ? err.message : t('errors.unknown'))
                }
            } finally {
                if (!cancelled) {
                    setDetailLoading(false)
                }
            }
        }

        void loadDetail()

        return () => {
            cancelled = true
        }
    }, [loadChunkDetail, selection, t])

    useEffect(() => {
        if (!selection) return

        const stillVisible = displayResultsByMode[selection.mode]
            .some(hit => hit.chunkId === selection.hit.chunkId)

        if (!stillVisible) {
            setSelection(null)
        }
    }, [displayResultsByMode, selection])

    const sectionTitle = t('knowledge.retrievalCompareTitle')
    const sectionDescription = t('knowledge.retrievalCompareDescription', { count: settings.displayCount })
    const showCompareBoard = hasSearchedVisibleModes || hasActiveVisibleModes || Boolean(searchError)

    return (
        <>
            <div className="knowledge-detail-layout knowledge-retrieval-workbench">
            <div className="knowledge-detail-main">
                <section className="knowledge-section-card knowledge-retrieval-test-card">
                    <div className="knowledge-section-header">
                        <div>
                            <h2 className="knowledge-section-title">{t('knowledge.retrievalTitle')}</h2>
                        </div>
                    </div>
                    <div className="knowledge-retrieval-dual-pane">
                        <div className="knowledge-retrieval-pane knowledge-retrieval-pane-main">
                            <div className="knowledge-retrieval-query-head">
                                <div className="knowledge-retrieval-query-title-row">
                                    <label className="form-label" htmlFor="knowledge-retrieval-query">{t('knowledge.retrievalQueryLabel')}</label>
                                </div>
                            </div>

                            <div className="form-group">
                                <div className="knowledge-retrieval-query-shell">
                                    <textarea
                                        id="knowledge-retrieval-query"
                                        className="form-input knowledge-retrieval-query"
                                        rows={4}
                                        maxLength={QUERY_MAX_LENGTH}
                                        placeholder={t('knowledge.retrievalQueryPlaceholder')}
                                        value={query}
                                        onChange={event => setQuery(event.target.value)}
                                        disabled={disabled}
                                    />
                                    <span className="knowledge-retrieval-query-count">
                                        {query.length}/{QUERY_MAX_LENGTH}
                                    </span>
                                </div>
                            </div>

                            <div className="knowledge-retrieval-workbench-card knowledge-retrieval-controls-card">
                                <div className="knowledge-retrieval-workbench-section">
                                    <div className="knowledge-retrieval-workbench-head">
                                        <span className="knowledge-kv-label">{t('knowledge.retrievalMethodLabel')}</span>
                                    </div>

                                    <div className="knowledge-retrieval-settings-list is-three-column">
                                        <div className="knowledge-retrieval-setting-row">
                                            <div className="knowledge-retrieval-setting-head">
                                                <label className="form-label" htmlFor="retrieval-top-k-input">{t('knowledge.retrievalDisplayCountLabel')}</label>
                                            </div>
                                            <div className="knowledge-retrieval-range-row">
                                                <input
                                                    id="retrieval-top-k-input"
                                                    className="form-input knowledge-retrieval-number-input"
                                                    type="number"
                                                    min={TOP_K_MIN}
                                                    max={TOP_K_MAX}
                                                    value={settings.displayCount}
                                                    onChange={event => setSettings(current => ({
                                                        ...current,
                                                        displayCount: clamp(Number(event.target.value) || TOP_K_MIN, TOP_K_MIN, TOP_K_MAX),
                                                    }))}
                                                />
                                                <input
                                                    className="knowledge-retrieval-range-input"
                                                    type="range"
                                                    min={TOP_K_MIN}
                                                    max={TOP_K_MAX}
                                                    value={settings.displayCount}
                                                    onChange={event => setSettings(current => ({
                                                        ...current,
                                                        displayCount: clamp(Number(event.target.value), TOP_K_MIN, TOP_K_MAX),
                                                    }))}
                                                />
                                            </div>
                                        </div>

                                        <div className="knowledge-retrieval-setting-row">
                                            <div className="knowledge-retrieval-setting-head">
                                                <div className="knowledge-retrieval-threshold-head">
                                                    <label className="form-label" htmlFor="retrieval-semantic-threshold-input">{t('knowledge.retrievalSemanticThresholdLabel')}</label>
                                                    <label className="mcp-toggle">
                                                        <input
                                                            type="checkbox"
                                                            checked={settings.semanticThresholdEnabled}
                                                            onChange={event => setSettings(current => ({
                                                                ...current,
                                                                semanticThresholdEnabled: event.target.checked,
                                                            }))}
                                                        />
                                                        <span className="mcp-toggle-slider" />
                                                    </label>
                                                </div>
                                            </div>
                                            <div className={`knowledge-retrieval-range-row ${!settings.semanticThresholdEnabled ? 'is-disabled' : ''}`}>
                                                <input
                                                    id="retrieval-semantic-threshold-input"
                                                    className="form-input knowledge-retrieval-number-input"
                                                    type="number"
                                                    min={SCORE_THRESHOLD_MIN}
                                                    max={SCORE_THRESHOLD_MAX}
                                                    step={SCORE_THRESHOLD_STEP}
                                                    value={settings.semanticThreshold}
                                                    disabled={!settings.semanticThresholdEnabled}
                                                    onChange={event => setSettings(current => ({
                                                        ...current,
                                                        semanticThreshold: clamp(Number(event.target.value) || 0, SCORE_THRESHOLD_MIN, SCORE_THRESHOLD_MAX),
                                                    }))}
                                                />
                                                <input
                                                    className="knowledge-retrieval-range-input"
                                                    type="range"
                                                    min={SCORE_THRESHOLD_MIN}
                                                    max={SCORE_THRESHOLD_MAX}
                                                    step={SCORE_THRESHOLD_STEP}
                                                    value={settings.semanticThreshold}
                                                    disabled={!settings.semanticThresholdEnabled}
                                                    onChange={event => setSettings(current => ({
                                                        ...current,
                                                        semanticThreshold: clamp(Number(event.target.value), SCORE_THRESHOLD_MIN, SCORE_THRESHOLD_MAX),
                                                    }))}
                                                />
                                            </div>
                                        </div>

                                        <div className="knowledge-retrieval-setting-row">
                                            <div className="knowledge-retrieval-setting-head">
                                                <div className="knowledge-retrieval-threshold-head">
                                                    <label className="form-label" htmlFor="retrieval-lexical-threshold-input">{t('knowledge.retrievalLexicalThresholdLabel')}</label>
                                                    <label className="mcp-toggle">
                                                        <input
                                                            type="checkbox"
                                                            checked={settings.lexicalThresholdEnabled}
                                                            onChange={event => setSettings(current => ({
                                                                ...current,
                                                                lexicalThresholdEnabled: event.target.checked,
                                                            }))}
                                                        />
                                                        <span className="mcp-toggle-slider" />
                                                    </label>
                                                </div>
                                            </div>
                                            <div className={`knowledge-retrieval-range-row ${!settings.lexicalThresholdEnabled ? 'is-disabled' : ''}`}>
                                                <input
                                                    id="retrieval-lexical-threshold-input"
                                                    className="form-input knowledge-retrieval-number-input"
                                                    type="number"
                                                    min={SCORE_THRESHOLD_MIN}
                                                    max={SCORE_THRESHOLD_MAX}
                                                    step={SCORE_THRESHOLD_STEP}
                                                    value={settings.lexicalThreshold}
                                                    disabled={!settings.lexicalThresholdEnabled}
                                                    onChange={event => setSettings(current => ({
                                                        ...current,
                                                        lexicalThreshold: clamp(Number(event.target.value) || 0, SCORE_THRESHOLD_MIN, SCORE_THRESHOLD_MAX),
                                                    }))}
                                                />
                                                <input
                                                    className="knowledge-retrieval-range-input"
                                                    type="range"
                                                    min={SCORE_THRESHOLD_MIN}
                                                    max={SCORE_THRESHOLD_MAX}
                                                    step={SCORE_THRESHOLD_STEP}
                                                    value={settings.lexicalThreshold}
                                                    disabled={!settings.lexicalThresholdEnabled}
                                                    onChange={event => setSettings(current => ({
                                                        ...current,
                                                        lexicalThreshold: clamp(Number(event.target.value), SCORE_THRESHOLD_MIN, SCORE_THRESHOLD_MAX),
                                                    }))}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="knowledge-retrieval-actions">
                                <button
                                    type="button"
                                    className="btn btn-primary knowledge-section-action"
                                    onClick={() => void executeSearch()}
                                    disabled={testButtonDisabled}
                                >
                                    {activeSearchModes.length > 0
                                        ? t('knowledge.retrievalRunning')
                                        : testButtonDisabled && effectiveQuery && compareCache && effectiveQuery === lastExecutedQuery
                                            ? t('knowledge.retrievalRunCurrent')
                                            : t('knowledge.retrievalRun')}
                                </button>
                            </div>
                        </div>

                        <aside className="knowledge-retrieval-pane knowledge-retrieval-pane-history">
                            <div className="knowledge-retrieval-history-headline">
                                <span className="knowledge-kv-label">{t('knowledge.retrievalRecentTitle')}</span>
                            </div>
                            <div className="knowledge-retrieval-history-strip">
                                {recentHistory.length > 0 ? (
                                    <div className="knowledge-retrieval-history-list" role="list">
                                        {recentHistory.map(entry => (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                className="knowledge-retrieval-history-item"
                                                onClick={() => handleReplayHistory(entry)}
                                            >
                                                <span className="knowledge-retrieval-history-item-query">{entry.query}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="knowledge-retrieval-mode-empty">{t('knowledge.retrievalCompareEmpty')}</div>
                                )}
                            </div>
                        </aside>
                    </div>
                </section>

                <section className="knowledge-section-card">
                    <div className="knowledge-section-header">
                        <div>
                            <h2 className="knowledge-section-title">{sectionTitle}</h2>
                            <p className="knowledge-section-description">{sectionDescription}</p>
                        </div>
                    </div>

                    {searchError && (
                        <div className="conn-banner conn-banner-error">
                            {t('common.connectionError', { error: searchError })}
                        </div>
                    )}

                    {compareDiagnostic && (
                        <div className="conn-banner conn-banner-warning">
                            {compareDiagnostic}
                        </div>
                    )}

                    {!showCompareBoard ? (
                        <div className="knowledge-retrieval-results-placeholder">
                            {t('knowledge.retrievalCompareEmpty')}
                        </div>
                    ) : (
                        <div className="knowledge-retrieval-compare-grid">
                            {orderedModes.map(mode => (
                                <RetrievalModePanel
                                    key={mode}
                                    mode={mode}
                                    results={displayResultsByMode[mode]}
                                    rawCount={modeResults[mode].total}
                                    error={modeResults[mode].error}
                                    searched={searchedModes.includes(mode)}
                                    loading={activeSearchModes.includes(mode)}
                                    thresholdFiltered={thresholdFilteredByMode[mode]}
                                    selectedKey={selectedKey}
                                    compareAccentByChunkId={compareAccentByChunkId}
                                    onSelect={(selectedMode, hit) => setSelection({ mode: selectedMode, hit })}
                                />
                            ))}
                        </div>
                    )}
                </section>
            </div>
            </div>

            <RetrievalDetailPanel
                selection={selection}
                detail={detail}
                loading={detailLoading}
                error={detailError}
                canEdit={capabilities?.featureFlags.allowChunkEdit ?? true}
                onReload={async () => {
                    if (!selection) return

                    setDetail(await loadChunkDetail(selection.hit.chunkId))
                }}
                onClear={() => setSelection(null)}
            />
        </>
    )
}

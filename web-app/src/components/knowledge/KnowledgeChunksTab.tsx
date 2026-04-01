import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KNOWLEDGE_SERVICE_URL } from '../../config/runtime'
import { useToast } from '../../contexts/ToastContext'
import KnowledgeChunkDetailModal from './KnowledgeChunkDetailModal'
import Pagination from '../Pagination'
import type { ResourceStatusTone } from '../ResourceCard'
import type {
    KnowledgeCapabilities,
    KnowledgeChunkDetail,
    KnowledgeChunkMutationResponse,
    KnowledgeChunkSummary,
    KnowledgeDocumentSummary,
    KnowledgeSource,
    PagedResponse,
} from '../../types/knowledge'

type ChunkEditStatusFilter = 'ALL' | 'USER_EDITED' | 'SYSTEM_GENERATED'
type ChunkPanelMode = 'closed' | 'view' | 'edit' | 'create'

interface ChunkEditorDraft {
    documentId: string
    keywords: string[]
    keywordInput: string
    text: string
}

interface KnowledgeChunksTabProps {
    source: KnowledgeSource
    capabilities: KnowledgeCapabilities | null
    documentFilter: string | null
    onDocumentFilterChange: (documentId: string | null) => void
    onChunksMutated?: () => Promise<void> | void
    readOnly?: boolean
}

const CHUNK_PAGE_SIZE = 100
const CHUNK_PAGE_SIZE_OPTIONS_DEFAULT = 20

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

function getDocumentDisplayTitle(document: Pick<KnowledgeDocumentSummary, 'name' | 'title'>): string {
    return document.title?.trim() || document.name
}

function buildPageRange(pageFrom: number | null, pageTo: number | null, fallback: string): string {
    if (pageFrom === null || pageFrom === undefined) return fallback
    if (pageTo === null || pageTo === undefined || pageTo === pageFrom) return String(pageFrom)
    return `${pageFrom}-${pageTo}`
}

function getChunkEditStatusMeta(
    editStatus: string | null | undefined,
    t: (key: string) => string
): { tone: ResourceStatusTone; label: string } {
    switch (editStatus?.toUpperCase()) {
    case 'USER_EDITED':
        return {
            tone: 'success',
            label: t('knowledge.chunkEditStatusUserEdited'),
        }
    case 'SYSTEM_GENERATED':
        return {
            tone: 'neutral',
            label: t('knowledge.chunkEditStatusSystemGenerated'),
        }
    default:
        return {
            tone: 'neutral',
            label: editStatus || t('knowledge.statusUnknown'),
        }
    }
}

function deriveChunkTitle(text: string): string {
    const firstLine = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean)
        ?.replace(/^#+\s*/, '')
        || ''

    if (!firstLine) return ''
    if (firstLine.length <= 80) return firstLine
    return `${firstLine.slice(0, 77)}...`
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init)
    const data = await response.json().catch(() => null) as { message?: string } | T | null

    if (!response.ok) {
        throw new Error(data && typeof data === 'object' && 'message' in data
            ? String(data.message || response.statusText)
            : response.statusText)
    }

    return data as T
}

async function loadAllPages<T>(buildUrl: (page: number, pageSize: number) => string): Promise<T[]> {
    const items: T[] = []
    let page = 1
    let total = 0

    do {
        const result = await requestJson<PagedResponse<T>>(buildUrl(page, CHUNK_PAGE_SIZE))
        items.push(...result.items)
        total = result.total
        page += 1
    } while (items.length < total)

    return items
}

function DeleteChunkModal({
    chunkLabel,
    deleting,
    error,
    onClose,
    onConfirm,
}: {
    chunkLabel: string
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
                    <h2 className="modal-title">{t('knowledge.chunkDeleteTitle')}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {error && (
                        <div className="agents-alert agents-alert-error" style={{ marginBottom: 'var(--spacing-4)' }}>
                            {error}
                        </div>
                    )}

                    <p style={{ fontSize: 'var(--font-size-base)', color: 'var(--color-text-primary)', marginBottom: 'var(--spacing-4)' }}>
                        {t('knowledge.chunkDeleteConfirm', { name: chunkLabel })}
                    </p>

                    <div className="agents-alert agents-alert-warning" style={{ marginBottom: 0 }}>
                        {t('knowledge.chunkDeleteWarning')}
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

export default function KnowledgeChunksTab({
    source,
    capabilities,
    documentFilter,
    onDocumentFilterChange,
    onChunksMutated,
    readOnly = false,
}: KnowledgeChunksTabProps) {
    const { t } = useTranslation()
    const { showToast } = useToast()
    const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([])
    const [documentsLoading, setDocumentsLoading] = useState(false)
    const [documentsError, setDocumentsError] = useState<string | null>(null)
    const [chunks, setChunks] = useState<KnowledgeChunkSummary[]>([])
    const [chunksLoading, setChunksLoading] = useState(false)
    const [chunksError, setChunksError] = useState<string | null>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const [editStatusFilter, setEditStatusFilter] = useState<ChunkEditStatusFilter>('ALL')
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(CHUNK_PAGE_SIZE_OPTIONS_DEFAULT)
    const [panelMode, setPanelMode] = useState<ChunkPanelMode>('closed')
    const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null)
    const [selectedChunkDetail, setSelectedChunkDetail] = useState<KnowledgeChunkDetail | null>(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [detailError, setDetailError] = useState<string | null>(null)
    const [draft, setDraft] = useState<ChunkEditorDraft | null>(null)
    const [formError, setFormError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<KnowledgeChunkSummary | null>(null)
    const [deleteError, setDeleteError] = useState<string | null>(null)
    const [deletingChunkId, setDeletingChunkId] = useState<string | null>(null)

    const editableFields = useMemo(() => new Set(capabilities?.editableChunkFields || []), [capabilities?.editableChunkFields])
    const canEditChunks = (capabilities?.featureFlags.allowChunkEdit ?? true) && !readOnly
    const canDeleteChunks = (capabilities?.featureFlags.allowChunkDelete ?? true) && !readOnly
    const canEditKeywords = canEditChunks && (editableFields.size === 0 || editableFields.has('keywords'))
    const canEditText = canEditChunks && (editableFields.size === 0 || editableFields.has('text'))
    const canCreateChunks = canEditChunks && canEditText

    const documentMap = useMemo(() => Object.fromEntries(documents.map(document => [document.id, document])), [documents])
    const selectedDocument = documentFilter ? documentMap[documentFilter] || null : null
    const selectedChunkSummary = selectedChunkId ? chunks.find(chunk => chunk.id === selectedChunkId) || null : null
    const userEditedCount = useMemo(
        () => chunks.filter(chunk => chunk.editStatus.toUpperCase() === 'USER_EDITED').length,
        [chunks]
    )

    const documentOptions = useMemo(
        () => documents
            .map(document => ({
                id: document.id,
                label: getDocumentDisplayTitle(document),
            }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        [documents]
    )

    const loadDocuments = useCallback(async () => {
        setDocumentsLoading(true)
        setDocumentsError(null)

        try {
            const items = await loadAllPages<KnowledgeDocumentSummary>((page, pageSizeValue) => {
                const params = new URLSearchParams({
                    sourceId: source.id,
                    page: String(page),
                    pageSize: String(pageSizeValue),
                })

                return `${KNOWLEDGE_SERVICE_URL}/documents?${params.toString()}`
            })

            setDocuments(items)
        } catch (err) {
            setDocuments([])
            setDocumentsError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setDocumentsLoading(false)
        }
    }, [source.id])

    const loadChunks = useCallback(async () => {
        setChunksLoading(true)
        setChunksError(null)

        try {
            const items = await loadAllPages<KnowledgeChunkSummary>((page, pageSizeValue) => {
                const params = new URLSearchParams({
                    sourceId: source.id,
                    page: String(page),
                    pageSize: String(pageSizeValue),
                })

                if (documentFilter) {
                    params.set('documentId', documentFilter)
                }

                return `${KNOWLEDGE_SERVICE_URL}/chunks?${params.toString()}`
            })

            setChunks(items)
        } catch (err) {
            setChunks([])
            setChunksError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setChunksLoading(false)
        }
    }, [documentFilter, source.id])

    const loadChunkDetail = useCallback(async (chunkId: string) => {
        setDetailLoading(true)
        setDetailError(null)

        try {
            const detail = await requestJson<KnowledgeChunkDetail>(`${KNOWLEDGE_SERVICE_URL}/chunks/${chunkId}`)
            setSelectedChunkDetail(detail)
            setDraft({
                documentId: detail.documentId,
                keywords: detail.keywords,
                keywordInput: '',
                text: detail.text || detail.markdown || '',
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error'
            setSelectedChunkDetail(null)
            setDraft(null)
            setDetailError(t('knowledge.chunkDetailLoadFailed', {
                error: message,
            }))
        } finally {
            setDetailLoading(false)
        }
    }, [])

    const refreshCollections = useCallback(async () => {
        await Promise.all([
            loadDocuments(),
            loadChunks(),
            Promise.resolve(onChunksMutated?.()),
        ])
    }, [loadChunks, loadDocuments, onChunksMutated])

    useEffect(() => {
        void loadDocuments()
    }, [loadDocuments])

    useEffect(() => {
        void loadChunks()
    }, [loadChunks])

    useEffect(() => {
        if (documentFilter && documents.length > 0 && !documents.some(document => document.id === documentFilter)) {
            onDocumentFilterChange(null)
        }
    }, [documentFilter, documents, onDocumentFilterChange])

    useEffect(() => {
        if ((panelMode !== 'view' && panelMode !== 'edit') || !selectedChunkId) return
        if (!chunks.some(chunk => chunk.id === selectedChunkId)) {
            setPanelMode('closed')
            setSelectedChunkId(null)
            setSelectedChunkDetail(null)
            setDraft(null)
            setDetailError(null)
        }
    }, [chunks, panelMode, selectedChunkId])

    useEffect(() => {
        if (panelMode !== 'view' || !selectedChunkId) return

        void loadChunkDetail(selectedChunkId)
    }, [loadChunkDetail, panelMode, selectedChunkId])

    useEffect(() => {
        setCurrentPage(1)
    }, [documentFilter, editStatusFilter, searchTerm])

    useEffect(() => {
        if (panelMode === 'create' && draft && documentFilter && draft.documentId !== documentFilter) {
            setDraft(current => current
                ? {
                    ...current,
                    documentId: documentFilter,
                }
                : current
            )
        }
    }, [documentFilter, draft, panelMode])

    const filteredChunks = useMemo(() => {
        const term = searchTerm.trim().toLowerCase()

        return chunks.filter(chunk => {
            const documentLabel = documentMap[chunk.documentId]
                ? getDocumentDisplayTitle(documentMap[chunk.documentId])
                : chunk.documentId
            const matchesSearch = !term || [
                chunk.id,
                chunk.title || '',
                chunk.snippet || '',
                documentLabel,
                ...chunk.keywords,
            ].some(value => value.toLowerCase().includes(term))
            const matchesStatus = editStatusFilter === 'ALL' || chunk.editStatus.toUpperCase() === editStatusFilter

            return matchesSearch && matchesStatus
        })
    }, [chunks, documentMap, editStatusFilter, searchTerm])

    const totalPages = Math.max(1, Math.ceil(filteredChunks.length / pageSize))

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages)
        }
    }, [currentPage, totalPages])

    const pagedChunks = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        return filteredChunks.slice(start, start + pageSize)
    }, [currentPage, filteredChunks, pageSize])

    const isPanelOpen = panelMode !== 'closed'
    const panelDocumentLabel = draft?.documentId && documentMap[draft.documentId]
        ? getDocumentDisplayTitle(documentMap[draft.documentId])
        : t('knowledge.notAvailable')

    const handleRefresh = useCallback(() => {
        void refreshCollections()
    }, [refreshCollections])

    const handleSelectChunk = useCallback((chunkId: string) => {
        setPanelMode('view')
        setSelectedChunkId(chunkId)
        setSelectedChunkDetail(null)
        setDraft(null)
        setDetailError(null)
        setFormError(null)
    }, [])

    const handleStartCreate = useCallback(() => {
        setPanelMode('create')
        setSelectedChunkId(null)
        setSelectedChunkDetail(null)
        setDetailError(null)
        setFormError(null)
        setDraft({
            documentId: documentFilter || documents[0]?.id || '',
            keywords: [],
            keywordInput: '',
            text: '',
        })
    }, [documentFilter, documents])

    const handleStartEdit = useCallback(() => {
        if (!selectedChunkId || !selectedChunkDetail) return

        setPanelMode('edit')
        setFormError(null)
        setDraft({
            documentId: selectedChunkDetail.documentId,
            keywords: selectedChunkDetail.keywords,
            keywordInput: '',
            text: selectedChunkDetail.text || selectedChunkDetail.markdown || '',
        })
    }, [selectedChunkDetail, selectedChunkId])

    const handleClosePanel = useCallback(() => {
        setPanelMode('closed')
        setSelectedChunkId(null)
        setSelectedChunkDetail(null)
        setDraft(null)
        setFormError(null)
        setDetailError(null)
    }, [])

    const commitPendingKeyword = useCallback(() => {
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
    }, [])

    const handleRemoveKeyword = useCallback((keyword: string) => {
        setDraft(current => current
            ? {
                ...current,
                keywords: current.keywords.filter(item => item.toLowerCase() !== keyword.toLowerCase()),
            }
            : current
        )
    }, [])

    const handleSave = useCallback(async () => {
        if (!draft) return

        const documentId = draft.documentId
        const text = draft.text.trim()
        const keywords = appendKeywords(draft.keywords, draft.keywordInput)

        setFormError(null)

        if (!documentId) {
            setFormError(t('knowledge.chunkDocumentRequired'))
            return
        }

        if (!text) {
            setFormError(t('knowledge.chunkContentRequired'))
            return
        }

        setSaving(true)

        try {
            if (panelMode === 'create') {
                const nextOrdinal = chunks
                    .filter(chunk => chunk.documentId === documentId)
                    .reduce((maxOrdinal, chunk) => Math.max(maxOrdinal, chunk.ordinal), 0) + 1
                const derivedTitle = deriveChunkTitle(text)
                const response = await requestJson<KnowledgeChunkMutationResponse>(
                    `${KNOWLEDGE_SERVICE_URL}/documents/${documentId}/chunks`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            ordinal: nextOrdinal,
                            title: derivedTitle || null,
                            titlePath: derivedTitle ? [derivedTitle] : [],
                            keywords,
                            text,
                            markdown: text,
                            pageFrom: null,
                            pageTo: null,
                        }),
                    }
                )

                await refreshCollections()
                setPanelMode('view')
                setSelectedChunkId(response.id)
                await loadChunkDetail(response.id)
                showToast('success', t('knowledge.chunkCreateSuccess'))
                return
            }

            if (!selectedChunkId) return

            await requestJson<KnowledgeChunkMutationResponse>(
                `${KNOWLEDGE_SERVICE_URL}/chunks/${selectedChunkId}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        keywords: canEditKeywords ? keywords : undefined,
                        text: canEditText ? text : undefined,
                        markdown: canEditText ? text : undefined,
                    }),
                }
            )

            await refreshCollections()
            await loadChunkDetail(selectedChunkId)
            setPanelMode('view')
            showToast('success', t('knowledge.chunkSaveSuccess'))
        } catch (err) {
            const message = err instanceof Error ? err.message : t('errors.unknown')
            setFormError(panelMode === 'create'
                ? t('knowledge.chunkCreateFailed', { error: message })
                : t('knowledge.chunkSaveFailed', { error: message }))
        } finally {
            setSaving(false)
        }
    }, [
        canEditKeywords,
        canEditText,
        chunks,
        draft,
        loadChunkDetail,
        panelMode,
        refreshCollections,
        selectedChunkId,
        showToast,
        t,
    ])

    const handleDelete = useCallback(async () => {
        if (!deleteTarget) return

        setDeleteError(null)
        setDeletingChunkId(deleteTarget.id)

        try {
            await requestJson<{ chunkId: string; deleted: boolean }>(
                `${KNOWLEDGE_SERVICE_URL}/chunks/${deleteTarget.id}`,
                {
                    method: 'DELETE',
                }
            )

            await refreshCollections()
            setDeleteTarget(null)
            setDeleteError(null)
            handleClosePanel()
            showToast('success', t('knowledge.chunkDeleteSuccess'))
        } catch (err) {
            setDeleteError(t('knowledge.chunkDeleteFailed', {
                error: err instanceof Error ? err.message : t('errors.unknown'),
            }))
        } finally {
            setDeletingChunkId(null)
        }
    }, [deleteTarget, handleClosePanel, refreshCollections, showToast, t])

    const isEditingPanel = panelMode === 'edit' || panelMode === 'create'
    const panelEditStatusLabel = panelMode === 'create'
        ? t('knowledge.chunkEditStatusUserEdited')
        : getChunkEditStatusMeta(selectedChunkDetail?.editStatus, t).label
    const panelOrdinal = panelMode === 'create'
        ? chunks
            .filter(chunk => chunk.documentId === draft?.documentId)
            .reduce((maxOrdinal, chunk) => Math.max(maxOrdinal, chunk.ordinal), 0) + 1
        : selectedChunkDetail?.ordinal ?? t('knowledge.notAvailable')
    const panelPageRange = panelMode === 'create'
        ? t('knowledge.notAvailable')
        : buildPageRange(selectedChunkDetail?.pageFrom ?? null, selectedChunkDetail?.pageTo ?? null, t('knowledge.notAvailable'))
    const metadataItems = [
        {
            label: t('knowledge.chunkDocumentLabel'),
            value: panelDocumentLabel,
        },
        {
            label: t('knowledge.retrievalDetailChunkId'),
            value: panelMode === 'create' ? t('knowledge.notAvailable') : selectedChunkId || t('knowledge.notAvailable'),
            code: true,
        },
        {
            label: t('knowledge.retrievalDetailPageRange'),
            value: panelPageRange,
        },
        {
            label: t('knowledge.chunkOrdinal'),
            value: panelOrdinal,
        },
        {
            label: t('knowledge.chunkEditStatusLabel'),
            value: panelEditStatusLabel,
        },
        {
            label: t('knowledge.updatedAt'),
            value: panelMode === 'create' ? '—' : formatDateTime(selectedChunkDetail?.updatedAt),
        },
        {
            label: t('knowledge.chunkUpdatedBy'),
            value: panelMode === 'create' ? '—' : selectedChunkDetail?.updatedBy || t('knowledge.notAvailable'),
        },
        {
            label: t('common.tokens'),
            value: panelMode === 'create' ? '—' : selectedChunkDetail?.tokenCount ?? t('knowledge.notAvailable'),
        },
        {
            label: t('knowledge.chunkTextLength'),
            value: panelMode === 'create' ? '—' : selectedChunkDetail?.textLength ?? t('knowledge.notAvailable'),
        },
    ]

    return (
        <>
            <div className="knowledge-detail-layout">
                <div className="knowledge-detail-main">
                    <section className="knowledge-section-card">
                        <div className="knowledge-section-header">
                            <div>
                                <h2 className="knowledge-section-title">{t('knowledge.chunksTabTitle')}</h2>
                                <p className="knowledge-section-description">
                                    {t('knowledge.chunksTabDescription', { name: source.name })}
                                </p>
                            </div>
                            <div className="knowledge-doc-toolbar-actions">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={handleRefresh}
                                    disabled={documentsLoading || chunksLoading}
                                >
                                    {t('knowledge.docRefresh')}
                                </button>
                                {canCreateChunks && (
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={handleStartCreate}
                                        disabled={readOnly || documentsLoading || documents.length === 0}
                                    >
                                        {t('knowledge.chunkCreate')}
                                    </button>
                                )}
                            </div>
                        </div>

                        {documentsError && (
                            <div className="conn-banner conn-banner-error">
                                {t('common.connectionError', { error: documentsError })}
                            </div>
                        )}

                        {chunksError && (
                            <div className="conn-banner conn-banner-error">
                                {t('common.connectionError', { error: chunksError })}
                            </div>
                        )}

                        <div className="knowledge-summary-strip knowledge-summary-strip-standalone knowledge-chunk-summary-strip">
                            <div className="knowledge-summary-chip">
                                <span className="knowledge-summary-label">{t('knowledge.chunks')}</span>
                                <span className="knowledge-summary-value">{chunks.length}</span>
                            </div>
                            <div className="knowledge-summary-chip">
                                <span className="knowledge-summary-label">{t('knowledge.chunkVisibleCount')}</span>
                                <span className="knowledge-summary-value">{filteredChunks.length}</span>
                            </div>
                            <div className="knowledge-summary-chip">
                                <span className="knowledge-summary-label">{t('knowledge.userEditedChunks')}</span>
                                <span className="knowledge-summary-value">{userEditedCount}</span>
                            </div>
                            <div className="knowledge-summary-chip knowledge-summary-chip-wide">
                                <span className="knowledge-summary-label">{t('knowledge.chunkCurrentDocument')}</span>
                                <span className="knowledge-summary-value knowledge-summary-value-small">
                                    {selectedDocument ? getDocumentDisplayTitle(selectedDocument) : t('knowledge.chunkFilterAllDocuments')}
                                </span>
                            </div>
                        </div>

                        <div className="knowledge-chunk-filters">
                            <div className="search-input-wrapper knowledge-doc-search">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="11" cy="11" r="8" />
                                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                                <input
                                    type="text"
                                    className="search-input knowledge-doc-search-input"
                                    placeholder={t('knowledge.chunkSearchPlaceholder')}
                                    value={searchTerm}
                                    onChange={event => setSearchTerm(event.target.value)}
                                />
                            </div>

                            <select
                                className="form-input knowledge-doc-filter-select"
                                value={documentFilter || 'ALL'}
                                onChange={event => onDocumentFilterChange(event.target.value === 'ALL' ? null : event.target.value)}
                                disabled={documentsLoading}
                            >
                                <option value="ALL">{t('knowledge.chunkFilterAllDocuments')}</option>
                                {documentOptions.map(option => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                ))}
                            </select>

                            <select
                                className="form-input knowledge-doc-filter-select"
                                value={editStatusFilter}
                                onChange={event => setEditStatusFilter(event.target.value as ChunkEditStatusFilter)}
                            >
                                <option value="ALL">{t('knowledge.chunkFilterAllStatuses')}</option>
                                <option value="USER_EDITED">{t('knowledge.chunkEditStatusUserEdited')}</option>
                                <option value="SYSTEM_GENERATED">{t('knowledge.chunkEditStatusSystemGenerated')}</option>
                            </select>
                        </div>

                        {chunksLoading ? (
                            <div className="knowledge-doc-empty">{t('common.loading')}</div>
                        ) : documents.length === 0 ? (
                            <div className="knowledge-doc-empty">{t('knowledge.chunkNoDocuments')}</div>
                        ) : filteredChunks.length === 0 ? (
                            <div className="knowledge-doc-empty">
                                {chunks.length === 0 ? t('knowledge.chunkEmptyState') : t('knowledge.chunkNoMatch')}
                            </div>
                        ) : (
                            <>
                                <div className="knowledge-chunk-list">
                                    {pagedChunks.map(chunk => {
                                        const document = documentMap[chunk.documentId]
                                        const meta = getChunkEditStatusMeta(chunk.editStatus, t)
                                        return (
                                            <button
                                                key={chunk.id}
                                                type="button"
                                                className={`knowledge-chunk-card ${selectedChunkId === chunk.id ? 'selected' : ''}`}
                                                onClick={() => handleSelectChunk(chunk.id)}
                                            >
                                                <div className="knowledge-chunk-card-head">
                                                    <div className="knowledge-chunk-card-head-copy">
                                                        <div className="knowledge-chunk-card-title">
                                                            {chunk.title?.trim() || t('knowledge.chunkUntitled')}
                                                        </div>
                                                        <div className="knowledge-chunk-card-subtitle">
                                                            {document ? getDocumentDisplayTitle(document) : chunk.documentId}
                                                        </div>
                                                    </div>
                                                    <span className={`resource-status resource-status-${meta.tone}`}>
                                                        {meta.label}
                                                    </span>
                                                </div>

                                                <p className="knowledge-chunk-card-snippet">
                                                    {chunk.snippet || t('knowledge.notAvailable')}
                                                </p>

                                                <div className="knowledge-chunk-card-footer">
                                                    <span>{t('knowledge.retrievalPageShort')} {buildPageRange(chunk.pageFrom, chunk.pageTo, t('knowledge.notAvailable'))}</span>
                                                    <span>{t('knowledge.chunkKeywordCount', { count: chunk.keywords.length })}</span>
                                                    <span>{t('common.tokens')} {chunk.tokenCount}</span>
                                                    <span>{formatDateTime(chunk.updatedAt)}</span>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>

                                {filteredChunks.length > 0 && (
                                    <Pagination
                                        currentPage={currentPage}
                                        totalPages={totalPages}
                                        pageSize={pageSize}
                                        totalItems={filteredChunks.length}
                                        onPageChange={setCurrentPage}
                                        onPageSizeChange={setPageSize}
                                        disabled={chunksLoading}
                                    />
                                )}
                            </>
                        )}
                    </section>
                </div>

            </div>

            {isPanelOpen && draft && (
                <KnowledgeChunkDetailModal
                    title={panelMode === 'create'
                        ? t('knowledge.chunkCreateTitle')
                        : selectedChunkSummary?.title?.trim() || t('knowledge.chunkUntitled')}
                    subtitle={panelMode === 'create'
                        ? t('knowledge.chunkCreateDescription')
                        : selectedChunkId || t('knowledge.notAvailable')}
                    headerMeta={(
                        <span className="resource-card-tag">{panelDocumentLabel}</span>
                    )}
                    badges={[
                        `${t('knowledge.retrievalPageShort')} ${panelPageRange}`,
                        panelEditStatusLabel,
                        `${t('knowledge.chunkOrdinal')} ${panelOrdinal}`,
                    ]}
                    error={formError || (!isEditingPanel ? detailError : null)}
                    loading={!isEditingPanel && detailLoading}
                    loadingLabel={t('knowledge.chunkDetailLoading')}
                    mainSectionTitle={t('knowledge.chunkContentTitle')}
                    mainSectionContent={(
                        <>
                            {isEditingPanel ? (
                                <>
                                    <label className="knowledge-visually-hidden" htmlFor="knowledge-chunk-content">
                                        {t('knowledge.chunkContentTitle')}
                                    </label>
                                    <textarea
                                        id="knowledge-chunk-content"
                                        className="form-input knowledge-chunk-content-input"
                                        rows={18}
                                        placeholder={t('knowledge.chunkContentPlaceholder')}
                                        value={draft.text}
                                        onChange={event => setDraft(current => current
                                            ? {
                                                ...current,
                                                text: event.target.value,
                                            }
                                            : current
                                        )}
                                        disabled={saving || !canEditText}
                                    />
                                </>
                            ) : (
                                <div className="knowledge-retrieval-detail-content-panel">
                                    <div className="knowledge-retrieval-detail-content-text">
                                        {draft.text || t('knowledge.notAvailable')}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                    sidebarSections={[
                        {
                            key: 'metadata',
                            title: t('knowledge.chunkMetadataTitle'),
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
                            title: t('knowledge.chunkKeywordsTitle'),
                            content: (
                                <>
                                    {panelMode === 'create' && !documentFilter ? (
                                        <div className="form-group knowledge-chunk-detail-form-group">
                                            <label className="form-label" htmlFor="knowledge-chunk-document">
                                                {t('knowledge.chunkDocumentLabel')}
                                            </label>
                                            <select
                                                id="knowledge-chunk-document"
                                                className="form-input"
                                                value={draft.documentId}
                                                onChange={event => setDraft(current => current
                                                    ? {
                                                        ...current,
                                                        documentId: event.target.value,
                                                    }
                                                    : current
                                                )}
                                                disabled={saving}
                                            >
                                                <option value="">{t('knowledge.chunkDocumentSelectPlaceholder')}</option>
                                                {documentOptions.map(option => (
                                                    <option key={option.id} value={option.id}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ) : null}

                                    {isEditingPanel ? (
                                        <div className="form-group knowledge-chunk-detail-form-group">
                                            <label className="form-label" htmlFor="knowledge-chunk-keywords">
                                                {t('knowledge.chunkKeywordsLabel')}
                                            </label>
                                            <div className="knowledge-chunk-keyword-surface">
                                                <div className="knowledge-chunk-keyword-list">
                                                    {draft.keywords.length > 0 ? (
                                                        draft.keywords.map(keyword => (
                                                            <span key={keyword} className="knowledge-chunk-keyword-pill">
                                                                <span>{keyword}</span>
                                                                <button
                                                                    type="button"
                                                                    className="knowledge-chunk-keyword-pill-remove"
                                                                    onClick={() => handleRemoveKeyword(keyword)}
                                                                    disabled={saving || !canEditKeywords}
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
                                                    id="knowledge-chunk-keywords"
                                                    className="knowledge-chunk-keyword-inline-input"
                                                    type="text"
                                                    placeholder={t('knowledge.chunkKeywordsPlaceholder')}
                                                    value={draft.keywordInput}
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
                                                    disabled={saving || !canEditKeywords}
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="knowledge-chunk-keyword-surface knowledge-chunk-keyword-surface-readonly">
                                            {draft.keywords.length > 0 ? (
                                                draft.keywords.map(keyword => (
                                                    <span key={keyword} className="knowledge-chunk-keyword-pill">{keyword}</span>
                                                ))
                                            ) : (
                                                <span className="knowledge-inline-empty">{t('knowledge.notAvailable')}</span>
                                            )}
                                        </div>
                                    )}
                                </>
                            ),
                        },
                    ]}
                    footer={(
                        <div className="knowledge-chunk-detail-footer-actions">
                            <div className="knowledge-chunk-detail-footer-danger">
                                {isEditingPanel && selectedChunkSummary && canDeleteChunks && (
                                    <button
                                        type="button"
                                        className="btn btn-danger btn-quiet-danger"
                                        onClick={() => {
                                            setDeleteError(null)
                                            setDeleteTarget(selectedChunkSummary)
                                        }}
                                        disabled={saving}
                                    >
                                        {t('common.delete')}
                                    </button>
                                )}
                            </div>
                            <div className="knowledge-chunk-detail-footer-primary">
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-subtle"
                                    onClick={() => {
                                        if (panelMode === 'edit' && selectedChunkDetail) {
                                            setPanelMode('view')
                                            setFormError(null)
                                            setDraft({
                                                documentId: selectedChunkDetail.documentId,
                                                keywords: selectedChunkDetail.keywords,
                                                keywordInput: '',
                                                text: selectedChunkDetail.text || selectedChunkDetail.markdown || '',
                                            })
                                            return
                                        }

                                        handleClosePanel()
                                    }}
                                    disabled={saving}
                                >
                                    {isEditingPanel ? t('common.cancel') : t('common.close')}
                                </button>
                                {isEditingPanel ? (
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={() => void handleSave()}
                                        disabled={saving || (!canEditText && !canEditKeywords)}
                                    >
                                        {saving ? t('knowledge.saving') : t('common.save')}
                                    </button>
                                ) : (
                                    canEditChunks && (
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            onClick={handleStartEdit}
                                            disabled={detailLoading || !selectedChunkDetail}
                                        >
                                            {t('common.edit')}
                                        </button>
                                    )
                                )}
                            </div>
                        </div>
                    )}
                    onClose={() => {
                        if (!saving) {
                            handleClosePanel()
                        }
                    }}
                />
            )}

            {deleteTarget && (
                <DeleteChunkModal
                    chunkLabel={deleteTarget.title?.trim() || deleteTarget.id}
                    deleting={deletingChunkId === deleteTarget.id}
                    error={deleteError}
                    onClose={() => {
                        if (!deletingChunkId) {
                            setDeleteTarget(null)
                            setDeleteError(null)
                        }
                    }}
                    onConfirm={() => void handleDelete()}
                />
            )}
        </>
    )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useToast } from '../contexts/ToastContext'
import { KNOWLEDGE_SERVICE_URL } from '../config/runtime'
import ResourceCard, { type ResourceStatusTone } from '../components/ResourceCard'

interface SourceSummary {
    id: string
    name: string
    description: string | null
    status: string
    storageMode: string
    indexProfileId: string | null
    retrievalProfileId: string | null
    createdAt: string
    updatedAt: string
}

interface SourceStats {
    sourceId: string
    documentCount: number
    indexedDocumentCount: number
    failedDocumentCount: number
    processingDocumentCount: number
    chunkCount: number
    userEditedChunkCount: number
    lastIngestionAt: string | null
}

interface SourceListResponse {
    items: SourceSummary[]
    page: number
    pageSize: number
    total: number
}

function formatDate(value?: string | null): string {
    if (!value) return '—'
    return new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
}

function getKnowledgeStatusTone(status?: string): ResourceStatusTone {
    switch (status?.toUpperCase()) {
    case 'ACTIVE':
        return 'success'
    case 'DISABLED':
        return 'neutral'
    default:
        return 'neutral'
    }
}

function getKnowledgeStatusLabel(status: string | undefined, t: (key: string) => string): string {
    switch (status?.toUpperCase()) {
    case 'ACTIVE':
        return t('knowledge.statusActive')
    case 'DISABLED':
        return t('knowledge.statusDisabled')
    default:
        return status || t('knowledge.statusUnknown')
    }
}

function CreateKnowledgeModal({
    onClose,
    onCreated,
}: {
    onClose: () => void
    onCreated: () => Promise<void>
}) {
    const { t } = useTranslation()
    const { showToast } = useToast()
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleCreate = useCallback(async () => {
        setError(null)
        if (!name.trim()) {
            setError(t('knowledge.nameRequired'))
            return
        }

        setCreating(true)
        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/sources`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim() || null,
                }),
            })
            const data = await response.json().catch(() => null)
            if (!response.ok) {
                setError(data?.message || t('knowledge.createFailed', { error: response.statusText }))
                return
            }
            await onCreated()
            showToast('success', t('knowledge.createSuccess', { name: name.trim() }))
            onClose()
        } catch (err) {
            setError(t('knowledge.createFailed', { error: err instanceof Error ? err.message : 'Network error' }))
        } finally {
            setCreating(false)
        }
    }, [description, name, onClose, onCreated, showToast, t])

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{t('knowledge.createTitle')}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {error && (
                        <div className="agents-alert agents-alert-error" style={{ marginBottom: 'var(--spacing-4)' }}>
                            {error}
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">{t('knowledge.name')}</label>
                        <input
                            className="form-input"
                            type="text"
                            placeholder={t('knowledge.namePlaceholder')}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">{t('knowledge.description')}</label>
                        <textarea
                            className="form-input"
                            rows={4}
                            placeholder={t('knowledge.descriptionPlaceholder')}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={creating}>
                        {t('common.cancel')}
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleCreate}
                        disabled={creating || !name.trim()}
                    >
                        {creating ? t('knowledge.creating') : t('knowledge.createAction')}
                    </button>
                </div>
            </div>
        </div>
    )
}

function DeleteKnowledgeModal({
    source,
    onClose,
    onDeleted,
}: {
    source: SourceSummary
    onClose: () => void
    onDeleted: () => Promise<void>
}) {
    const { t } = useTranslation()
    const { showToast } = useToast()
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleDelete = useCallback(async () => {
        setError(null)
        setDeleting(true)
        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/sources/${source.id}`, {
                method: 'DELETE',
            })
            const data = await response.json().catch(() => null)
            if (!response.ok) {
                setError(data?.message || t('knowledge.deleteFailed', { error: response.statusText }))
                return
            }
            await onDeleted()
            showToast('success', t('knowledge.deleteSuccess', { name: source.name }))
            onClose()
        } catch (err) {
            setError(t('knowledge.deleteFailed', { error: err instanceof Error ? err.message : 'Network error' }))
        } finally {
            setDeleting(false)
        }
    }, [onClose, onDeleted, showToast, source.id, source.name, t])

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
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
                        {t('knowledge.deleteConfirm', { name: source.name })}
                    </p>
                    <div className="agents-alert agents-alert-warning" style={{ marginBottom: 0 }}>
                        {t('knowledge.deleteWarning')}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={deleting}>
                        {t('common.cancel')}
                    </button>
                    <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                        {deleting ? t('knowledge.deleting') : t('common.delete')}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default function Knowledge() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const [sources, setSources] = useState<SourceSummary[]>([])
    const [stats, setStats] = useState<Record<string, SourceStats>>({})
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL')
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<SourceSummary | null>(null)

    const loadSources = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/sources?page=1&pageSize=100`)
            const data = await response.json() as SourceListResponse
            if (!response.ok) {
                throw new Error((data as { message?: string }).message || response.statusText)
            }
            setSources(data.items || [])

            const statsEntries = await Promise.all(
                (data.items || []).map(async source => {
                    try {
                        const statsResponse = await fetch(`${KNOWLEDGE_SERVICE_URL}/sources/${source.id}/stats`)
                        const statsData = await statsResponse.json() as SourceStats
                        if (!statsResponse.ok) {
                            throw new Error(statsResponse.statusText)
                        }
                        return [source.id, statsData] as const
                    } catch {
                        return [source.id, {
                            sourceId: source.id,
                            documentCount: 0,
                            indexedDocumentCount: 0,
                            failedDocumentCount: 0,
                            processingDocumentCount: 0,
                            chunkCount: 0,
                            userEditedChunkCount: 0,
                            lastIngestionAt: null,
                        }] as const
                    }
                })
            )
            setStats(Object.fromEntries(statsEntries))
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load knowledge sources')
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadSources()
    }, [loadSources])

    const filteredSources = useMemo(() => {
        const term = searchTerm.trim().toLowerCase()
        return sources.filter(source => {
            const matchesStatus = statusFilter === 'ALL' || source.status === statusFilter
            const matchesSearch = !term
                || source.name.toLowerCase().includes(term)
                || (source.description || '').toLowerCase().includes(term)
            return matchesStatus && matchesSearch
        })
    }, [searchTerm, sources, statusFilter])

    return (
        <div className="page-container sidebar-top-page resource-page">
            <div className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 className="page-title">{t('knowledge.title')}</h1>
                        <p className="page-subtitle">{t('knowledge.subtitle')}</p>
                    </div>
                    <button className="action-btn-primary btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        {t('knowledge.createButton')}
                    </button>
                </div>
            </div>

            {error && (
                <div className="conn-banner conn-banner-error">
                    {t('common.connectionError', { error })}
                </div>
            )}

            <div className="search-container">
                <div className="search-input-wrapper" style={{ flex: 1 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        className="search-input"
                        placeholder={t('knowledge.searchPlaceholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--color-text-muted)',
                                cursor: 'pointer',
                                padding: 'var(--spacing-1)'
                            }}
                            aria-label="Clear search"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>
            
            <div className="seg-filter" role="tablist" aria-label="Status filter">
                <button
                    type="button"
                    className={`seg-filter-btn ${statusFilter === 'ALL' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('ALL')}
                >
                    {t('knowledge.statusAll')}
                </button>
                <button
                    type="button"
                    className={`seg-filter-btn ${statusFilter === 'ACTIVE' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('ACTIVE')}
                >
                    {t('knowledge.statusActive')}
                </button>
                <button
                    type="button"
                    className={`seg-filter-btn ${statusFilter === 'DISABLED' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('DISABLED')}
                >
                    {t('knowledge.statusDisabled')}
                </button>
            </div>

            {isLoading ? (
                <div className="empty-state">
                    <div className="empty-state-title">{t('common.loading')}</div>
                </div>
            ) : filteredSources.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-title">{t('knowledge.emptyTitle')}</div>
                    <div className="empty-state-description">{t('knowledge.emptyHint')}</div>
                </div>
            ) : (
                <div className="resource-grid">
                    {filteredSources.map(source => {
                        const sourceStats = stats[source.id]
                        const descriptionText = source.description?.trim() || t('knowledge.noDescription')
                        return (
                            <ResourceCard
                                key={source.id}
                                title={source.name}
                                statusLabel={getKnowledgeStatusLabel(source.status, t)}
                                statusTone={getKnowledgeStatusTone(source.status)}
                                summary={(
                                    <p
                                        className={[
                                            'resource-card-summary-text',
                                            !source.description ? 'resource-card-summary-placeholder' : '',
                                        ].filter(Boolean).join(' ')}
                                        title={descriptionText}
                                    >
                                        {descriptionText}
                                    </p>
                                )}
                                metrics={[
                                    { label: t('knowledge.documents'), value: sourceStats?.documentCount ?? 0 },
                                    { label: t('knowledge.chunks'), value: sourceStats?.chunkCount ?? 0 },
                                    { label: t('knowledge.updatedAt'), value: formatDate(source.updatedAt) },
                                ]}
                                footer={(
                                    <>
                                        <button
                                            type="button"
                                            className="resource-card-danger-action"
                                            onClick={() => setDeleteTarget(source)}
                                        >
                                            {t('common.delete')}
                                        </button>
                                        <button
                                            type="button"
                                            className="resource-card-primary-action"
                                            onClick={() => navigate(`/knowledge/${source.id}`)}
                                        >
                                            {t('knowledge.configure')}
                                        </button>
                                    </>
                                )}
                            />
                        )
                    })}
                </div>
            )}

            {showCreateModal && (
                <CreateKnowledgeModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={loadSources}
                />
            )}

            {deleteTarget && (
                <DeleteKnowledgeModal
                    source={deleteTarget}
                    onClose={() => setDeleteTarget(null)}
                    onDeleted={loadSources}
                />
            )}
        </div>
    )
}

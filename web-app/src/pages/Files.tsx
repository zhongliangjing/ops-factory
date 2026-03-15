import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGoosed } from '../contexts/GoosedContext'
import { usePreview } from '../contexts/PreviewContext'
import { useUser } from '../contexts/UserContext'
import { GATEWAY_URL, GATEWAY_SECRET_KEY, gatewayHeaders } from '../config/runtime'

interface FileInfo {
    name: string
    path: string
    size: number
    modifiedAt: string
    type: string
}

interface AgentFile extends FileInfo {
    agentId: string
    agentName: string
}

type FileCategory = 'all' | 'doc' | 'sheet' | 'slide' | 'markdown' | 'html' | 'others'

const FILE_CATEGORIES: { key: FileCategory; labelKey: string; types: string[] }[] = [
    { key: 'all', labelKey: 'files.categories.all', types: [] },
    { key: 'doc', labelKey: 'files.categories.doc', types: ['docx', 'doc'] },
    { key: 'sheet', labelKey: 'files.categories.sheet', types: ['xlsx', 'xls', 'csv', 'tsv'] },
    { key: 'slide', labelKey: 'files.categories.slide', types: ['pptx', 'ppt'] },
    { key: 'markdown', labelKey: 'files.categories.markdown', types: ['md', 'markdown'] },
    { key: 'html', labelKey: 'files.categories.html', types: ['html', 'htm'] },
]

function getFileCategory(type: string | undefined): FileCategory {
    if (!type) return 'others'
    const lowerType = type.toLowerCase()
    for (const cat of FILE_CATEGORIES) {
        if (cat.key !== 'all' && cat.types.includes(lowerType)) {
            return cat.key
        }
    }
    return 'others'
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1048576).toFixed(1)} MB`
}

function formatDate(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    })
}

function getFileIcon(type: string) {
    switch (type) {
        case 'docx':
        case 'doc':
        case 'pdf':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
            )
        case 'xlsx':
        case 'xls':
        case 'csv':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="16" y2="17" />
                    <line x1="12" y1="9" x2="12" y2="21" />
                </svg>
            )
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'svg':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                </svg>
            )
        case 'html':
        case 'htm':
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                </svg>
            )
        default:
            return (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                </svg>
            )
    }
}

function getDownloadUrl(file: AgentFile, userId?: string | null): string {
    let url = `${GATEWAY_URL}/agents/${file.agentId}/files/${encodeURIComponent(file.path)}?key=${GATEWAY_SECRET_KEY}`
    if (userId) url += `&uid=${encodeURIComponent(userId)}`
    return url
}

export default function Files() {
    const { t } = useTranslation()
    const { agents, isConnected, error: connectionError } = useGoosed()
    const { openPreview, isPreviewable } = usePreview()
    const { userId } = useUser()
    const [files, setFiles] = useState<AgentFile[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [activeCategory, setActiveCategory] = useState<FileCategory>('all')

    useEffect(() => {
        const loadFiles = async () => {
            if (!isConnected || agents.length === 0) {
                setIsLoading(false)
                return
            }

            setIsLoading(true)
            setError(null)

            try {
                const allFiles: AgentFile[] = []
                const results = await Promise.allSettled(
                    agents.map(async (agent) => {
                        const res = await fetch(`${GATEWAY_URL}/agents/${agent.id}/files`, {
                            headers: gatewayHeaders(userId),
                        })
                        if (!res.ok) return []
                        const data = await res.json() as { files: FileInfo[] }
                        return (data.files || []).map(f => ({
                            ...f,
                            agentId: agent.id,
                            agentName: agent.name,
                        }))
                    })
                )

                for (const result of results) {
                    if (result.status === 'fulfilled') {
                        allFiles.push(...result.value)
                    }
                }

                allFiles.sort((a, b) =>
                    new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
                )
                setFiles(allFiles)
            } catch (err) {
                console.error('Failed to load files:', err)
                setError(err instanceof Error ? err.message : 'Failed to load files')
            } finally {
                setIsLoading(false)
            }
        }

        loadFiles()
    }, [agents, isConnected, userId])

    const categoryCounts = useMemo(() => {
        const counts: Record<FileCategory, number> = {
            all: files.length,
            doc: 0,
            sheet: 0,
            slide: 0,
            markdown: 0,
            html: 0,
            others: 0,
        }
        for (const file of files) {
            const cat = getFileCategory(file.type)
            counts[cat]++
        }
        return counts
    }, [files])

    const filteredFiles = useMemo(() => {
        let result = files

        // Filter by category
        if (activeCategory !== 'all') {
            result = result.filter(f => getFileCategory(f.type) === activeCategory)
        }

        // Filter by search term
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase()
            result = result.filter(f =>
                f.name?.toLowerCase().includes(term) ||
                f.agentName?.toLowerCase().includes(term) ||
                (f.type || '').toLowerCase().includes(term)
            )
        }

        return result
    }, [files, searchTerm, activeCategory])

    return (
        <div className="page-container files-page">
            <header className="page-header">
                <h1 className="page-title">{t('files.title')}</h1>
                <p className="page-subtitle">
                    {t('files.subtitle')}
                </p>
            </header>

            {(error || (!isConnected && connectionError)) && (
                <div className="conn-banner conn-banner-error">
                    {error || t('common.connectionError', { error: connectionError })}
                </div>
            )}

            <div className="search-container">
                <div className="search-input-wrapper">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        className="search-input"
                        placeholder={t('files.searchPlaceholder')}
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

            <div className="seg-filter">
                {FILE_CATEGORIES.map(cat => (
                    <button
                        key={cat.key}
                        className={`seg-filter-btn ${activeCategory === cat.key ? 'active' : ''}`}
                        onClick={() => setActiveCategory(cat.key)}
                    >
                        {t(cat.labelKey)}
                        {categoryCounts[cat.key] > 0 && (
                            <span className="seg-filter-count">{categoryCounts[cat.key]}</span>
                        )}
                    </button>
                ))}
            </div>

            {isLoading && (
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: 'var(--spacing-10)'
                }}>
                    <div className="loading-spinner" />
                </div>
            )}

            {!isLoading && files.length === 0 && (
                <div className="empty-state">
                    <svg
                        className="empty-state-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <h3 className="empty-state-title">{t('files.noFiles')}</h3>
                    <p className="empty-state-description">
                        {t('files.noFilesHint')}
                    </p>
                </div>
            )}

            {searchTerm && filteredFiles.length === 0 && !isLoading && files.length > 0 && (
                <div className="empty-state">
                    <svg
                        className="empty-state-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <h3 className="empty-state-title">{t('common.noResults')}</h3>
                    <p className="empty-state-description">
                        {t('files.noMatchFiles', { term: searchTerm })}
                    </p>
                </div>
            )}

            {(!searchTerm || filteredFiles.length > 0) && !isLoading && (
                <>
                    {searchTerm && (
                        <p style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-secondary)',
                            marginBottom: 'var(--spacing-4)'
                        }}>
                            {t('common.resultsFound', { count: filteredFiles.length })}
                        </p>
                    )}

                    <div className="file-list">
                        {filteredFiles.map(file => (
                            <div key={`${file.agentId}-${file.path}`} className="file-item animate-slide-in">
                                <div className="file-icon">
                                    {getFileIcon(file.type)}
                                </div>
                                <div className="file-info">
                                    <div className="file-name">{file.name}</div>
                                    <div className="file-meta">
                                        <span>{formatFileSize(file.size)}</span>
                                        <span>{formatDate(file.modifiedAt)}</span>
                                        <span className="file-agent-tag">{file.agentName}</span>
                                    </div>
                                </div>
                                <div className="file-actions">
                                    {isPreviewable(file.type, file.name, file.path) && (
                                        <button
                                            className="file-preview-btn"
                                            title={t('files.preview')}
                                            onClick={() => openPreview({
                                                name: file.name,
                                                path: file.path,
                                                type: file.type,
                                                agentId: file.agentId,
                                            })}
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                <circle cx="12" cy="12" r="3" />
                                            </svg>
                                        </button>
                                    )}
                                    <a
                                        href={getDownloadUrl(file, userId) + '&download=true'}
                                        className="file-download-btn"
                                        title={t('files.download')}
                                        download
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="7 10 12 15 17 10" />
                                            <line x1="12" y1="15" x2="12" y2="3" />
                                        </svg>
                                    </a>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {!isLoading && files.length > 0 && (
                <p style={{
                    marginTop: 'var(--spacing-6)',
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-muted)',
                    textAlign: 'center'
                }}>
                    {t('common.totalFiles', { count: files.length })}
                </p>
            )}
        </div>
    )
}

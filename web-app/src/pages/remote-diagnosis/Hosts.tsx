import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useHosts } from '../../hooks/useHosts'
import { useToast } from '../../contexts/ToastContext'
import type { Host, HostCreateRequest } from '../../types/host'

// ---------------------------------------------------------------------------
// Tag Input sub-component (inline)
// ---------------------------------------------------------------------------

function TagInput({
    tags,
    allTags,
    onChange,
}: {
    tags: string[]
    allTags: string[]
    onChange: (tags: string[]) => void
}) {
    const { t } = useTranslation()
    const [input, setInput] = useState('')
    const [showDropdown, setShowDropdown] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const suggestions = useMemo(() => {
        const term = input.trim().toLowerCase()
        return allTags.filter(
            at => !tags.includes(at) && (term === '' || at.toLowerCase().includes(term)),
        )
    }, [allTags, tags, input])

    const addTag = useCallback(
        (tag: string) => {
            const trimmed = tag.trim()
            if (trimmed && !tags.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
                onChange([...tags, trimmed])
            }
            setInput('')
            setShowDropdown(false)
        },
        [tags, onChange],
    )

    const removeTag = useCallback(
        (tag: string) => {
            onChange(tags.filter(t => t !== tag))
        },
        [tags, onChange],
    )

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                if (input.trim()) {
                    addTag(input)
                }
            } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
                removeTag(tags[tags.length - 1])
            }
        },
        [input, tags, addTag, removeTag],
    )

    return (
        <div style={{ position: 'relative' }}>
            <div
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 'var(--spacing-2)',
                    alignItems: 'center',
                    padding: 'var(--spacing-2) var(--spacing-4)',
                    background: 'var(--color-bg-primary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    minHeight: 40,
                    cursor: 'text',
                }}
                onClick={() => { setShowDropdown(true); inputRef.current?.focus() }}
            >
                {tags.map(tag => (
                    <span
                        key={tag}
                        className="tag-chip"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--spacing-1)',
                            padding: '2px 8px',
                            background: 'var(--color-accent-subtle)',
                            borderRadius: 'var(--radius-full)',
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--color-text-primary)',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {tag}
                        <button
                            type="button"
                            onClick={e => {
                                e.stopPropagation()
                                removeTag(tag)
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                color: 'var(--color-text-muted)',
                                fontSize: 14,
                                lineHeight: 1,
                            }}
                            aria-label={`Remove tag ${tag}`}
                        >
                            &times;
                        </button>
                    </span>
                ))}
                <input
                    ref={inputRef}
                    type="text"
                    className="form-input"
                    placeholder={tags.length === 0 ? t('remoteDiagnosis.hosts.addTag') : ''}
                    value={input}
                    onChange={e => {
                        setInput(e.target.value)
                        setShowDropdown(true)
                    }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => {
                        // Delay to allow click on dropdown item
                        setTimeout(() => setShowDropdown(false), 150)
                    }}
                    onKeyDown={handleKeyDown}
                    style={{
                        border: 'none',
                        padding: 0,
                        background: 'transparent',
                        flex: 1,
                        minWidth: 80,
                        fontSize: 'var(--font-size-sm)',
                        boxShadow: 'none',
                        outline: 'none',
                    }}
                />
            </div>
            {showDropdown && suggestions.length > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'var(--color-bg-primary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-lg)',
                        boxShadow: 'var(--shadow-lg)',
                        zIndex: 10,
                        maxHeight: 160,
                        overflowY: 'auto',
                        marginTop: 2,
                    }}
                >
                    {suggestions.map(tag => (
                        <button
                            key={tag}
                            type="button"
                            onMouseDown={e => {
                                e.preventDefault()
                                addTag(tag)
                            }}
                            style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                padding: 'var(--spacing-2) var(--spacing-4)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-primary)',
                            }}
                            onMouseEnter={e => {
                                ;(e.currentTarget as HTMLElement).style.background =
                                    'var(--color-bg-hover)'
                            }}
                            onMouseLeave={e => {
                                ;(e.currentTarget as HTMLElement).style.background = 'none'
                            }}
                        >
                            {tag}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Host Form Modal
// ---------------------------------------------------------------------------

function HostFormModal({
    host,
    allTags,
    onClose,
    onSave,
}: {
    host: Host | null
    allTags: string[]
    onClose: () => void
    onSave: (data: HostCreateRequest) => Promise<void>
}) {
    const { t } = useTranslation()
    const [name, setName] = useState(host?.name ?? '')
    const [ip, setIp] = useState(host?.ip ?? '')
    const [port, setPort] = useState(String(host?.port ?? 22))
    const [username, setUsername] = useState(host?.username ?? 'root')
    const [authType, setAuthType] = useState<'password' | 'key'>(host?.authType ?? 'password')
    const [credential, setCredential] = useState(host?.credential ?? '')
    const [tags, setTags] = useState<string[]>(host?.tags ?? [])
    const [description, setDescription] = useState(host?.description ?? '')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSave = useCallback(async () => {
        setError(null)

        if (!name.trim()) {
            setError(t('remoteDiagnosis.hosts.nameRequired'))
            return
        }
        if (!ip.trim()) {
            setError(t('remoteDiagnosis.hosts.ipRequired'))
            return
        }
        // IPv4 regex: each octet 0-255
        const ipv4Re = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/
        if (!ipv4Re.test(ip.trim())) {
            setError(t('remoteDiagnosis.hosts.ipInvalid'))
            return
        }
        if (!credential.trim()) {
            setError(t('remoteDiagnosis.hosts.credentialRequired'))
            return
        }

        setSaving(true)
        try {
            const payload: HostCreateRequest = {
                name: name.trim(),
                ip: ip.trim(),
                port: Number(port) || 22,
                username: username.trim() || 'root',
                authType,
                credential: credential.trim(),
                tags,
                description: description.trim(),
            }
            // When editing, exclude credential if user didn't change it (still the mask sentinel)
            if (host && credential.trim() === '***') {
                delete payload.credential
            }
            await onSave(payload)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setSaving(false)
        }
    }, [name, ip, port, username, authType, credential, tags, description, onSave, t])

    return (
        <div className="modal-overlay">
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
                <div className="modal-header">
                    <h2 className="modal-title">
                        {host ? t('remoteDiagnosis.hosts.editHost') : t('remoteDiagnosis.hosts.addHost')}
                    </h2>
                    <button className="modal-close" onClick={onClose}>
                        &times;
                    </button>
                </div>

                <div className="modal-body">
                    {error && (
                        <div
                            className="agents-alert agents-alert-error"
                            style={{ marginBottom: 'var(--spacing-4)' }}
                        >
                            {error}
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">{t('remoteDiagnosis.hosts.name')}</label>
                        <input
                            className="form-input"
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            autoFocus
                        />
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--spacing-4)' }}>
                        <div className="form-group" style={{ flex: 2 }}>
                            <label className="form-label">{t('remoteDiagnosis.hosts.ip')}</label>
                            <input
                                className="form-input"
                                type="text"
                                value={ip}
                                onChange={e => setIp(e.target.value)}
                                placeholder="192.168.1.100"
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label className="form-label">{t('remoteDiagnosis.hosts.port')}</label>
                            <input
                                className="form-input"
                                type="number"
                                value={port}
                                onChange={e => setPort(e.target.value)}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--spacing-4)' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label className="form-label">{t('remoteDiagnosis.hosts.username')}</label>
                            <input
                                className="form-input"
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                            />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label className="form-label">{t('remoteDiagnosis.hosts.authType')}</label>
                            <select
                                className="form-input"
                                value={authType}
                                onChange={e => setAuthType(e.target.value as 'password' | 'key')}
                            >
                                <option value="password">{t('remoteDiagnosis.hosts.password')}</option>
                                <option value="key">{t('remoteDiagnosis.hosts.key')}</option>
                            </select>
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">{t('remoteDiagnosis.hosts.credential')}</label>
                        <textarea
                            className="form-input"
                            rows={3}
                            value={credential}
                            onChange={e => setCredential(e.target.value)}
                            placeholder={
                                authType === 'key'
                                    ? '-----BEGIN RSA PRIVATE KEY-----\n...'
                                    : 'Enter password'
                            }
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">{t('remoteDiagnosis.hosts.tags')}</label>
                        <TagInput tags={tags} allTags={allTags} onChange={setTags} />
                    </div>

                    <div className="form-group">
                        <label className="form-label">{t('remoteDiagnosis.hosts.description')}</label>
                        <textarea
                            className="form-input"
                            rows={2}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
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
                        disabled={saving || !name.trim() || !ip.trim()}
                    >
                        {saving ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Hosts Tab (content only, no page wrapper)
// ---------------------------------------------------------------------------

export function HostsTab() {
    const { t } = useTranslation()
    const { hosts, isLoading, error, fetchHosts, createHost, updateHost, deleteHost, testConnection } =
        useHosts()
    const { showToast } = useToast()

    const fileInputRef = useRef<HTMLInputElement>(null)
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [editingHost, setEditingHost] = useState<Host | null>(null)
    const [showAddModal, setShowAddModal] = useState(false)
    const [testingId, setTestingId] = useState<string | null>(null)
    const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({})

    useEffect(() => {
        fetchHosts()
    }, [fetchHosts])

    const allTags = useMemo(() => {
        const set = new Set<string>()
        hosts.forEach(h => h.tags?.forEach(tag => set.add(tag)))
        return Array.from(set).sort()
    }, [hosts])

    const filteredHosts = useMemo(() => {
        if (selectedTags.length === 0) return hosts
        const lowerSelected = selectedTags.map(t => t.toLowerCase())
        return hosts.filter(h =>
            lowerSelected.some(tag => h.tags?.some(ht => ht.toLowerCase() === tag))
        )
    }, [hosts, selectedTags])

    const toggleTagFilter = useCallback((tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
        )
    }, [])

    const clearTagFilter = useCallback(() => {
        setSelectedTags([])
    }, [])

    const handleExport = useCallback(() => {
        const blob = new Blob([JSON.stringify(hosts, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'hosts-export.json'
        a.click()
        URL.revokeObjectURL(url)
        showToast('success', t('remoteDiagnosis.hosts.exportSuccess'))
    }, [hosts, showToast, t])

    const handleImport = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = async (event) => {
                try {
                    const data = JSON.parse(event.target?.result as string)
                    const items = Array.isArray(data) ? data : [data]
                    let imported = 0
                    let duplicates = 0
                    for (const item of items) {
                        try {
                            const { name, ip, port, username, authType, credential, tags, description } = item
                            await createHost({ name, ip, port: port || 22, username, authType: authType || 'password', credential, tags: tags || [], description })
                            imported++
                        } catch {
                            duplicates++
                        }
                    }
                    if (duplicates > 0) {
                        showToast('error', t('remoteDiagnosis.hosts.importDuplicate', { imported, duplicates }))
                    } else {
                        showToast('success', t('remoteDiagnosis.hosts.importSuccess'))
                    }
                    await fetchHosts()
                } catch (err) {
                    showToast('error', err instanceof Error ? err.message : 'Import failed')
                }
            }
            reader.readAsText(file)
            e.target.value = ''
        },
        [createHost, fetchHosts, showToast, t],
    )

    const handleSaveHost = useCallback(
        async (data: HostCreateRequest) => {
            if (editingHost) {
                await updateHost(editingHost.id, data)
                showToast('success', t('remoteDiagnosis.hosts.editSuccess', { name: data.name }))
            } else {
                await createHost(data)
                showToast('success', t('remoteDiagnosis.hosts.addSuccess', { name: data.name }))
            }
            setShowAddModal(false)
            setEditingHost(null)
            await fetchHosts()
        },
        [editingHost, updateHost, createHost, fetchHosts, showToast, t],
    )

    const handleDelete = useCallback(
        (host: Host) => {
            const confirmed = window.confirm(
                t('remoteDiagnosis.hosts.deleteConfirm', { name: host.name }),
            )
            if (!confirmed) return
            deleteHost(host.id)
                .then(() => {
                    showToast('success', t('remoteDiagnosis.hosts.deleteSuccess', { name: host.name }))
                    fetchHosts()
                })
                .catch((err: unknown) => {
                    showToast('error', err instanceof Error ? err.message : 'Delete failed')
                })
        },
        [deleteHost, fetchHosts, showToast, t],
    )

    const handleTest = useCallback(
        async (host: Host) => {
            setTestingId(host.id)
            setTestResults(prev => {
                const next = { ...prev }
                delete next[host.id]
                return next
            })
            try {
                const result = await testConnection(host.id)
                if (result.success) {
                    const msg = t('remoteDiagnosis.hosts.testSuccess', {
                        latency: `${result.latency}ms`,
                    })
                    setTestResults(prev => ({ ...prev, [host.id]: { ok: true, msg } }))
                    showToast('success', msg)
                } else {
                    const msg = t('remoteDiagnosis.hosts.testFailed', {
                        error: result.error || 'Unknown',
                    })
                    setTestResults(prev => ({ ...prev, [host.id]: { ok: false, msg } }))
                    showToast('error', msg)
                }
            } catch (err) {
                const msg = t('remoteDiagnosis.hosts.testFailed', {
                    error: err instanceof Error ? err.message : 'Unknown',
                })
                setTestResults(prev => ({ ...prev, [host.id]: { ok: false, msg } }))
                showToast('error', msg)
            } finally {
                setTestingId(null)
            }
        },
        [testConnection, showToast, t],
    )

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-4)' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>{t('remoteDiagnosis.hosts.title')}</h2>
                    <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('remoteDiagnosis.hosts.subtitle')}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
                    <button className="btn btn-secondary" onClick={handleExport} disabled={hosts.length === 0}>
                        {t('remoteDiagnosis.hosts.exportJson')}
                    </button>
                    <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                        {t('remoteDiagnosis.hosts.importJson')}
                    </button>
                    <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
                    <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                        {t('remoteDiagnosis.hosts.addHost')}
                    </button>
                </div>
            </div>

            {error && (
                <div className="conn-banner conn-banner-error">
                    {typeof error === 'string' ? error : error.message}
                </div>
            )}

            {allTags.length > 0 && (
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--spacing-2)',
                        marginBottom: 'var(--spacing-5)',
                        alignItems: 'center',
                    }}
                >
                    <span
                        style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-muted)',
                            marginRight: 'var(--spacing-2)',
                        }}
                    >
                        {t('remoteDiagnosis.hosts.filterByTags')}:
                    </span>
                    <button
                        type="button"
                        className={`btn btn-secondary`}
                        onClick={clearTagFilter}
                        style={{
                            padding: '2px 10px',
                            fontSize: 'var(--font-size-xs)',
                            opacity: selectedTags.length === 0 ? 1 : 0.6,
                        }}
                    >
                        {t('remoteDiagnosis.hosts.allTags')}
                    </button>
                    {allTags.map(tag => (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTagFilter(tag)}
                            style={{
                                padding: '2px 10px',
                                borderRadius: 'var(--radius-full)',
                                fontSize: 'var(--font-size-xs)',
                                border: '1px solid',
                                borderColor: selectedTags.includes(tag)
                                    ? 'var(--color-accent)'
                                    : 'var(--color-border)',
                                background: selectedTags.includes(tag)
                                    ? 'var(--color-accent-subtle)'
                                    : 'var(--color-bg-primary)',
                                color: selectedTags.includes(tag)
                                    ? 'var(--color-text-primary)'
                                    : 'var(--color-text-secondary)',
                                cursor: 'pointer',
                                fontWeight: selectedTags.includes(tag) ? 600 : 400,
                                transition: 'all var(--transition-fast)',
                            }}
                        >
                            {tag}
                        </button>
                    ))}
                </div>
            )}

            {isLoading ? (
                <div className="empty-state">
                    <h3 className="empty-state-title">{t('common.loading')}</h3>
                </div>
            ) : filteredHosts.length === 0 ? (
                <div className="empty-state">
                    <svg
                        className="empty-state-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <rect x="2" y="3" width="20" height="18" rx="2" />
                        <path d="M8 21V7m8 0v14" />
                        <path d="M2 7h20" />
                    </svg>
                    <h3 className="empty-state-title">{t('remoteDiagnosis.hosts.noHosts')}</h3>
                    <p className="empty-state-description">{t('remoteDiagnosis.hosts.noHostsHint')}</p>
                </div>
            ) : (
                <div className="agents-grid">
                    {filteredHosts.map(host => (
                        <div key={host.id} className="agent-card" style={{ minHeight: 220 }}>
                            {/* Card header: name + test status */}
                            <div className="agent-card-header">
                                <div className="agent-card-title">
                                    <div>
                                        <div className="agent-name">{host.name}</div>
                                        {host.description && (
                                            <div className="scheduled-cron">{host.description}</div>
                                        )}
                                    </div>
                                </div>
                                {testResults[host.id] && (
                                    <span className={`status-pill ${testResults[host.id].ok ? 'status-running' : 'status-stopped'}`}>
                                        {testResults[host.id].ok ? 'OK' : 'FAIL'}
                                    </span>
                                )}
                            </div>

                            {/* Tags */}
                            {host.tags && host.tags.length > 0 && (
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 'var(--spacing-3)' }}>
                                    {host.tags.map(tag => (
                                        <span
                                            key={tag}
                                            style={{
                                                display: 'inline-block',
                                                padding: '1px 8px',
                                                borderRadius: 'var(--radius-full)',
                                                fontSize: 'var(--font-size-xs)',
                                                background: 'var(--color-accent-subtle)',
                                                color: 'var(--color-text-primary)',
                                            }}
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Meta rows */}
                            <div className="agent-meta">
                                <div className="agent-meta-row">
                                    <span className="agent-meta-label">{t('remoteDiagnosis.hosts.ip')}</span>
                                    <span className="agent-meta-value" style={{ fontFamily: 'monospace' }}>{host.ip}:{host.port}</span>
                                </div>
                                <div className="agent-meta-row">
                                    <span className="agent-meta-label">{t('remoteDiagnosis.hosts.username')}</span>
                                    <span className="agent-meta-value">{host.username}</span>
                                </div>
                                <div className="agent-meta-row">
                                    <span className="agent-meta-label">{t('remoteDiagnosis.hosts.authType')}</span>
                                    <span className="agent-meta-value">
                                        {t(`remoteDiagnosis.hosts.${host.authType === 'key' ? 'key' : 'password'}`)}
                                    </span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="scheduled-actions">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => handleTest(host)}
                                    disabled={testingId === host.id}
                                >
                                    {testingId === host.id
                                        ? t('remoteDiagnosis.hosts.testing')
                                        : t('remoteDiagnosis.hosts.testConnection')}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        setEditingHost(host)
                                        setShowAddModal(true)
                                    }}
                                >
                                    {t('common.edit')}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-secondary agent-delete-button"
                                    onClick={() => handleDelete(host)}
                                >
                                    {t('common.delete')}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {(showAddModal || editingHost) && (
                <HostFormModal
                    host={editingHost}
                    allTags={allTags}
                    onClose={() => {
                        setShowAddModal(false)
                        setEditingHost(null)
                    }}
                    onSave={handleSaveHost}
                />
            )}
        </>
    )
}

// ---------------------------------------------------------------------------
// Hosts Page (backward compatible wrapper)
// ---------------------------------------------------------------------------

export default function Hosts() {
    return (
        <div className="page-container sidebar-top-page">
            <HostsTab />
        </div>
    )
}

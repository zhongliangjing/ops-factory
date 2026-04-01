import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCommandWhitelist } from '../../hooks/useCommandWhitelist'
import { useToast } from '../../contexts/ToastContext'
import type { WhitelistCommand } from '../../types/commandWhitelist'

// ---------------------------------------------------------------------------
// Whitelist Form Modal
// ---------------------------------------------------------------------------

function WhitelistFormModal({
    command,
    onClose,
    onSave,
}: {
    command: WhitelistCommand | null
    onClose: () => void
    onSave: (data: WhitelistCommand) => Promise<void>
}) {
    const { t } = useTranslation()
    const [pattern, setPattern] = useState(command?.pattern ?? '')
    const [description, setDescription] = useState(command?.description ?? '')
    const [enabled, setEnabled] = useState(command?.enabled ?? true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSave = useCallback(async () => {
        setError(null)
        if (!pattern.trim()) {
            setError(t('remoteDiagnosis.whitelist.patternRequired'))
            return
        }

        setSaving(true)
        try {
            await onSave({
                pattern: pattern.trim(),
                description: description.trim(),
                enabled,
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setSaving(false)
        }
    }, [pattern, description, enabled, onSave, t])

    return (
        <div className="modal-overlay">
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
                <div className="modal-header">
                    <h2 className="modal-title">
                        {command
                            ? t('remoteDiagnosis.whitelist.editCommand')
                            : t('remoteDiagnosis.whitelist.addCommand')}
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
                        <label className="form-label">{t('remoteDiagnosis.whitelist.pattern')}</label>
                        <input
                            className="form-input"
                            type="text"
                            value={pattern}
                            onChange={e => setPattern(e.target.value)}
                            placeholder="ps aux"
                            autoFocus
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">{t('remoteDiagnosis.whitelist.description')}</label>
                        <textarea
                            className="form-input"
                            rows={2}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Describe what this command does"
                        />
                    </div>

                    <div className="form-group">
                        <label
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--spacing-3)',
                                cursor: 'pointer',
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--color-text-secondary)',
                            }}
                        >
                            <div className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={e => setEnabled(e.target.checked)}
                                    style={{ display: 'none' }}
                                />
                                <span
                                    className="toggle-slider"
                                    style={{
                                        display: 'inline-block',
                                        width: 36,
                                        height: 20,
                                        borderRadius: 10,
                                        background: enabled ? 'var(--color-success)' : 'var(--color-border)',
                                        position: 'relative',
                                        transition: 'background var(--transition-fast)',
                                        cursor: 'pointer',
                                        flexShrink: 0,
                                    }}
                                    onClick={() => setEnabled(prev => !prev)}
                                >
                                    <span
                                        style={{
                                            position: 'absolute',
                                            top: 2,
                                            left: enabled ? 18 : 2,
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            background: '#fff',
                                            transition: 'left var(--transition-fast)',
                                            boxShadow: 'var(--shadow-sm)',
                                        }}
                                    />
                                </span>
                            </div>
                            {t('remoteDiagnosis.whitelist.enabled')}
                        </label>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                        {t('common.cancel')}
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSave}
                        disabled={saving || !pattern.trim()}
                    >
                        {saving ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Toggle Switch (inline in table)
// ---------------------------------------------------------------------------

function ToggleSwitch({
    checked,
    onChange,
}: {
    checked: boolean
    onChange: (value: boolean) => void
}) {
    return (
        <span
            role="switch"
            aria-checked={checked}
            tabIndex={0}
            onClick={() => onChange(!checked)}
            onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onChange(!checked)
                }
            }}
            style={{
                display: 'inline-block',
                width: 36,
                height: 20,
                borderRadius: 10,
                background: checked ? 'var(--color-success)' : 'var(--color-border)',
                position: 'relative',
                transition: 'background var(--transition-fast)',
                cursor: 'pointer',
                flexShrink: 0,
            }}
        >
            <span
                style={{
                    position: 'absolute',
                    top: 2,
                    left: checked ? 18 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: '#fff',
                    transition: 'left var(--transition-fast)',
                    boxShadow: 'var(--shadow-sm)',
                }}
            />
        </span>
    )
}

// ---------------------------------------------------------------------------
// Whitelist Tab (content only, no page wrapper)
// ---------------------------------------------------------------------------

export function WhitelistTab() {
    const { t } = useTranslation()
    const {
        commands,
        isLoading,
        error,
        fetchWhitelist: fetchCommands,
        addCommand: createCommand,
        updateCommand,
        deleteCommand,
    } = useCommandWhitelist()
    const { showToast } = useToast()

    const [editingCommand, setEditingCommand] = useState<WhitelistCommand | null>(null)
    const [showAddModal, setShowAddModal] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        fetchCommands()
    }, [fetchCommands])

    const handleSaveCommand = useCallback(
        async (data: WhitelistCommand) => {
            if (editingCommand) {
                await updateCommand(editingCommand.pattern, data)
                showToast('success', t('remoteDiagnosis.whitelist.editSuccess', { pattern: data.pattern }))
            } else {
                await createCommand(data)
                showToast('success', t('remoteDiagnosis.whitelist.addSuccess', { pattern: data.pattern }))
            }
            setShowAddModal(false)
            setEditingCommand(null)
            await fetchCommands()
        },
        [editingCommand, updateCommand, createCommand, fetchCommands, showToast, t],
    )

    const handleToggleEnabled = useCallback(
        async (cmd: WhitelistCommand) => {
            try {
                await updateCommand(cmd.pattern, { ...cmd, enabled: !cmd.enabled })
                showToast(
                    'success',
                    cmd.enabled
                        ? t('remoteDiagnosis.whitelist.disabled')
                        : t('remoteDiagnosis.whitelist.enabled'),
                )
                await fetchCommands()
            } catch (err) {
                showToast('error', err instanceof Error ? err.message : 'Update failed')
            }
        },
        [updateCommand, fetchCommands, showToast, t],
    )

    const handleDelete = useCallback(
        (cmd: WhitelistCommand) => {
            const confirmed = window.confirm(
                t('remoteDiagnosis.whitelist.deleteConfirm', { pattern: cmd.pattern }),
            )
            if (!confirmed) return
            deleteCommand(cmd.pattern)
                .then(() => {
                    showToast(
                        'success',
                        t('remoteDiagnosis.whitelist.deleteSuccess', { pattern: cmd.pattern }),
                    )
                    fetchCommands()
                })
                .catch((err: unknown) => {
                    showToast('error', err instanceof Error ? err.message : 'Delete failed')
                })
        },
        [deleteCommand, fetchCommands, showToast, t],
    )

    const handleExport = useCallback(() => {
        const blob = new Blob([JSON.stringify(commands, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'command-whitelist-export.json'
        a.click()
        URL.revokeObjectURL(url)
        showToast('success', t('remoteDiagnosis.whitelist.exportSuccess'))
    }, [commands, showToast, t])

    const handleImport = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = async (event) => {
                try {
                    const data = JSON.parse(event.target?.result as string)
                    const items: WhitelistCommand[] = Array.isArray(data) ? data : [data]
                    let imported = 0
                    let duplicates = 0
                    for (const item of items) {
                        try {
                            await createCommand(item as WhitelistCommand)
                            imported++
                        } catch {
                            duplicates++
                        }
                    }
                    if (duplicates > 0) {
                        showToast('error', t('remoteDiagnosis.whitelist.importDuplicate', { imported, duplicates }))
                    } else {
                        showToast('success', t('remoteDiagnosis.whitelist.importSuccess'))
                    }
                    await fetchCommands()
                } catch (err) {
                    showToast('error', err instanceof Error ? err.message : 'Import failed')
                }
            }
            reader.readAsText(file)
            e.target.value = ''
        },
        [createCommand, fetchCommands, showToast, t],
    )

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-4)' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>{t('remoteDiagnosis.whitelist.title')}</h2>
                    <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('remoteDiagnosis.whitelist.subtitle')}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
                    <button className="btn btn-secondary" onClick={handleExport} disabled={commands.length === 0}>
                        {t('remoteDiagnosis.whitelist.exportJson')}
                    </button>
                    <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                        {t('remoteDiagnosis.whitelist.importJson')}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={handleImport}
                    />
                    <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                        {t('remoteDiagnosis.whitelist.addCommand')}
                    </button>
                </div>
            </div>

            {error && (
                <div className="conn-banner conn-banner-error">
                    {error}
                </div>
            )}

            {isLoading ? (
                <div className="empty-state">
                    <h3 className="empty-state-title">{t('common.loading')}</h3>
                </div>
            ) : commands.length === 0 ? (
                <div className="empty-state">
                    <svg
                        className="empty-state-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <h3 className="empty-state-title">
                        {t('remoteDiagnosis.whitelist.noCommands')}
                    </h3>
                    <p className="empty-state-description">
                        {t('remoteDiagnosis.whitelist.noCommandsHint')}
                    </p>
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table
                        className="data-table"
                        style={{ width: '100%', borderCollapse: 'collapse' }}
                    >
                        <thead>
                            <tr>
                                <th>{t('remoteDiagnosis.whitelist.pattern')}</th>
                                <th>{t('remoteDiagnosis.whitelist.description')}</th>
                                <th style={{ textAlign: 'center' }}>
                                    {t('remoteDiagnosis.whitelist.enabled')}
                                </th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {commands.map(cmd => (
                                <tr key={cmd.pattern}>
                                    <td>
                                        <code
                                            style={{
                                                fontSize: 'var(--font-size-sm)',
                                                background: 'var(--color-bg-secondary)',
                                                padding: '2px 6px',
                                                borderRadius: 'var(--radius-sm)',
                                            }}
                                        >
                                            {cmd.pattern}
                                        </code>
                                    </td>
                                    <td
                                        style={{
                                            color: 'var(--color-text-secondary)',
                                            fontSize: 'var(--font-size-sm)',
                                        }}
                                    >
                                        {cmd.description || '--'}
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        <ToggleSwitch
                                            checked={cmd.enabled}
                                            onChange={() => handleToggleEnabled(cmd)}
                                        />
                                    </td>
                                    <td>
                                        <div
                                            style={{
                                                display: 'flex',
                                                gap: 'var(--spacing-2)',
                                                justifyContent: 'flex-end',
                                            }}
                                        >
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                style={{
                                                    padding: '4px 12px',
                                                    fontSize: 'var(--font-size-xs)',
                                                }}
                                                onClick={() => {
                                                    setEditingCommand(cmd)
                                                    setShowAddModal(true)
                                                }}
                                            >
                                                {t('common.edit')}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-danger"
                                                style={{
                                                    padding: '4px 12px',
                                                    fontSize: 'var(--font-size-xs)',
                                                }}
                                                onClick={() => handleDelete(cmd)}
                                            >
                                                {t('common.delete')}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {(showAddModal || editingCommand) && (
                <WhitelistFormModal
                    command={editingCommand}
                    onClose={() => {
                        setShowAddModal(false)
                        setEditingCommand(null)
                    }}
                    onSave={handleSaveCommand}
                />
            )}
        </>
    )
}

// ---------------------------------------------------------------------------
// Whitelist Page (backward compatible wrapper)
// ---------------------------------------------------------------------------

export default function Whitelist() {
    return (
        <div className="page-container sidebar-top-page">
            <WhitelistTab />
        </div>
    )
}

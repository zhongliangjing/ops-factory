import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSops } from '../../hooks/useSops'
import { useCommandWhitelist } from '../../hooks/useCommandWhitelist'
import { useToast } from '../../contexts/ToastContext'
import type { Sop, SopNode, SopCreateRequest } from '../../types/sop'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createEmptyNode(index: number): SopNode {
    return {
        id: `node-${Date.now()}-${index}`,
        name: '',
        type: 'start',
        hostTags: [],
        command: '',
        commandVariables: {},
        variables: [],
        outputFormat: '',
        analysisInstruction: '',
        transitions: [],
    }
}

// ---------------------------------------------------------------------------
// Variable Editor (inline sub-component)
// ---------------------------------------------------------------------------

function VariableEditor({
    variables,
    onChange,
}: {
    variables: NonNullable<SopNode['variables']>
    onChange: (v: NonNullable<SopNode['variables']>) => void
}) {
    const { t } = useTranslation()

    const addVar = useCallback(() => {
        onChange([...variables, { name: '', defaultValue: '', description: '', required: false }])
    }, [variables, onChange])

    const removeVar = useCallback(
        (index: number) => {
            onChange(variables.filter((_, i: number) => i !== index))
        },
        [variables, onChange],
    )

    const updateVar = useCallback(
        (index: number, field: string, value: string | boolean) => {
            const next = [...variables]
            next[index] = { ...next[index], [field]: value }
            onChange(next)
        },
        [variables, onChange],
    )

    return (
        <div style={{ marginTop: 'var(--spacing-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-2)' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                    {t('remoteDiagnosis.sops.nodeVariables')}
                </span>
                <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 'var(--font-size-xs)' }} onClick={addVar}>
                    + {t('remoteDiagnosis.sops.addNode')}
                </button>
            </div>
            {variables.map((v, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-2)', alignItems: 'center' }}>
                    <input
                        className="form-input"
                        placeholder={t('remoteDiagnosis.sops.varName')}
                        value={v.name}
                        onChange={e => updateVar(i, 'name', e.target.value)}
                        style={{ flex: 1, fontSize: 'var(--font-size-xs)', padding: '4px 8px' }}
                    />
                    <input
                        className="form-input"
                        placeholder={t('remoteDiagnosis.sops.varDefault')}
                        value={v.defaultValue ?? ''}
                        onChange={e => updateVar(i, 'defaultValue', e.target.value)}
                        style={{ flex: 1, fontSize: 'var(--font-size-xs)', padding: '4px 8px' }}
                    />
                    <input
                        className="form-input"
                        placeholder={t('remoteDiagnosis.sops.varDesc')}
                        value={v.description ?? ''}
                        onChange={e => updateVar(i, 'description', e.target.value)}
                        style={{ flex: 1, fontSize: 'var(--font-size-xs)', padding: '4px 8px' }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>
                        <input
                            type="checkbox"
                            checked={v.required ?? false}
                            onChange={e => updateVar(i, 'required', e.target.checked)}
                        />
                        {t('remoteDiagnosis.sops.varRequired')}
                    </label>
                    <button
                        type="button"
                        onClick={() => removeVar(i)}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-error)',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: 14,
                        }}
                        title={t('remoteDiagnosis.sops.removeNode')}
                    >
                        &times;
                    </button>
                </div>
            ))}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Transition Editor (inline sub-component)
// ---------------------------------------------------------------------------

function TransitionEditor({
    transitions,
    nodeNames,
    onChange,
}: {
    transitions: SopNode['transitions']
    nodeNames: string[]
    onChange: (t: SopNode['transitions']) => void
}) {
    const { t } = useTranslation()

    const addTransition = useCallback(() => {
        onChange([...transitions, { condition: '', description: '', nextNodes: [] }])
    }, [transitions, onChange])

    const removeTransition = useCallback(
        (index: number) => {
            onChange(transitions.filter((_, i) => i !== index))
        },
        [transitions, onChange],
    )

    const updateTransitionCondition = useCallback(
        (index: number, value: string) => {
            const next = [...transitions]
            next[index] = { ...next[index], condition: value }
            onChange(next)
        },
        [transitions, onChange],
    )

    const toggleNextNode = useCallback(
        (index: number, nodeName: string) => {
            const next = [...transitions]
            const current = next[index].nextNodes ?? []
            const updated = current.includes(nodeName)
                ? current.filter(n => n !== nodeName)
                : [...current, nodeName]
            next[index] = { ...next[index], nextNodes: updated }
            onChange(next)
        },
        [transitions, onChange],
    )

    return (
        <div style={{ marginTop: 'var(--spacing-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-2)' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                    {t('remoteDiagnosis.sops.nodeTransitions')}
                </span>
                <button type="button" className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 'var(--font-size-xs)' }} onClick={addTransition}>
                    + {t('remoteDiagnosis.sops.addNode')}
                </button>
            </div>
            {transitions.map((tr, i) => (
                <div key={i} style={{ marginBottom: 'var(--spacing-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--spacing-2)' }}>
                    <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', marginBottom: nodeNames.length > 0 ? 'var(--spacing-2)' : 0 }}>
                        <input
                            className="form-input"
                            placeholder={t('remoteDiagnosis.sops.transitionCondition')}
                            value={tr.condition}
                            onChange={e => updateTransitionCondition(i, e.target.value)}
                            style={{ flex: 1, fontSize: 'var(--font-size-xs)', padding: '4px 8px' }}
                        />
                        <button
                            type="button"
                            onClick={() => removeTransition(i)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--color-error)',
                                cursor: 'pointer',
                                padding: '2px 4px',
                                fontSize: 14,
                            }}
                            title={t('remoteDiagnosis.sops.removeNode')}
                        >
                            &times;
                        </button>
                    </div>
                    {nodeNames.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)', alignItems: 'center' }}>
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginRight: 'var(--spacing-1)' }}>
                                {t('remoteDiagnosis.sops.transitionNext')}:
                            </span>
                            {nodeNames.map(name => {
                                const checked = (tr.nextNodes ?? []).includes(name)
                                return (
                                    <label key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', cursor: 'pointer', userSelect: 'none' }}>
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleNextNode(i, name)}
                                        />
                                        {name}
                                    </label>
                                )
                            })}
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
}

// ---------------------------------------------------------------------------
// SOP Form Modal
// ---------------------------------------------------------------------------

function SopFormModal({
    sop,
    onClose,
    onSave,
}: {
    sop: Sop | null
    onClose: () => void
    onSave: (data: SopCreateRequest) => Promise<void>
}) {
    const { t } = useTranslation()
    const { commands } = useCommandWhitelist()
    const [name, setName] = useState(sop?.name ?? '')
    const [description, setDescription] = useState(sop?.description ?? '')
    const [version, setVersion] = useState(sop?.version ?? '1.0')
    const [triggerCondition, setTriggerCondition] = useState(sop?.triggerCondition ?? '')
    const [nodes, setNodes] = useState<SopNode[]>(sop?.nodes?.length ? sop.nodes : [createEmptyNode(0)])
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [commandErrors, setCommandErrors] = useState<Record<number, string>>({})

    const nodeNames = useMemo(() => nodes.map(n => n.name).filter(Boolean), [nodes])

    const validateNodeCommand = useCallback((command: string): string[] => {
        if (!command.trim()) return []
        const enabledPatterns = commands
            .filter(c => c.enabled)
            .map(c => c.pattern)
        const rejected: string[] = []
        command.split(/[|;]/).forEach(sub => {
            const trimmed = sub.trim()
            if (!trimmed) return
            const cmdName = trimmed.split(/\s+/)[0]
            if (!cmdName) return
            const allowed = enabledPatterns.some(p => {
                const patternCmd = p.split(/\s+/)[0]
                return patternCmd === cmdName || p === cmdName
            })
            if (!allowed) rejected.push(cmdName)
        })
        return rejected
    }, [commands])

    const handleAddNode = useCallback(() => {
        setNodes(prev => [...prev, createEmptyNode(prev.length)])
    }, [])

    const handleRemoveNode = useCallback((index: number) => {
        setNodes(prev => prev.filter((_, i) => i !== index))
    }, [])

    const handleNodeChange = useCallback((index: number, field: keyof SopNode, value: unknown) => {
        setNodes(prev => {
            const next = [...prev]
            next[index] = { ...next[index], [field]: value }
            return next
        })
    }, [])

    const handleSave = useCallback(async () => {
        setError(null)
        setCommandErrors({})
        if (!name.trim()) {
            setError(t('remoteDiagnosis.hosts.nameRequired'))
            return
        }

        // Validate all node commands against whitelist
        const errors: Record<number, string> = {}
        nodes.forEach((node, idx) => {
            const rejected = validateNodeCommand(node.command || '')
            if (rejected.length > 0) {
                errors[idx] = t('remoteDiagnosis.sops.commandNotInWhitelist', { commands: rejected.join(', ') })
            }
        })
        if (Object.keys(errors).length > 0) {
            setCommandErrors(errors)
            return
        }

        setSaving(true)
        try {
            await onSave({
                name: name.trim(),
                description: description.trim(),
                version: version.trim(),
                triggerCondition: triggerCondition.trim(),
                nodes,
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setSaving(false)
        }
    }, [name, description, version, triggerCondition, nodes, onSave, t, validateNodeCommand])

    return (
        <div className="modal-overlay">
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: '90vh', overflowY: 'auto' }}>
                <div className="modal-header">
                    <h2 className="modal-title">
                        {sop ? t('remoteDiagnosis.sops.editSop') : t('remoteDiagnosis.sops.addSop')}
                    </h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {error && (
                        <div className="agents-alert agents-alert-error" style={{ marginBottom: 'var(--spacing-4)' }}>
                            {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 'var(--spacing-4)' }}>
                        <div className="form-group" style={{ flex: 2 }}>
                            <label className="form-label">{t('remoteDiagnosis.sops.name')}</label>
                            <input className="form-input" type="text" value={name} onChange={e => setName(e.target.value)} autoFocus />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label className="form-label">{t('remoteDiagnosis.sops.version')}</label>
                            <input className="form-input" type="text" value={version} onChange={e => setVersion(e.target.value)} />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">{t('remoteDiagnosis.sops.description')}</label>
                        <textarea className="form-input" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
                    </div>

                    <div className="form-group">
                        <label className="form-label">{t('remoteDiagnosis.sops.triggerCondition')}</label>
                        <input className="form-input" type="text" value={triggerCondition} onChange={e => setTriggerCondition(e.target.value)} />
                    </div>

                    {/* Node editor */}
                    <div style={{ marginTop: 'var(--spacing-5)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-4)' }}>
                            <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, margin: 0 }}>
                                {t('remoteDiagnosis.sops.nodeEditor')}
                            </h3>
                            <button type="button" className="btn btn-secondary" onClick={handleAddNode}>
                                {t('remoteDiagnosis.sops.addNode')}
                            </button>
                        </div>

                        {nodes.map((node, idx) => (
                            <div
                                key={node.id}
                                style={{
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-lg)',
                                    padding: 'var(--spacing-4)',
                                    marginBottom: 'var(--spacing-4)',
                                    background: 'var(--color-bg-secondary)',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-3)' }}>
                                    <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                                        #{idx + 1}
                                    </span>
                                    {nodes.length > 1 && (
                                        <button
                                            type="button"
                                            className="btn btn-danger"
                                            style={{ padding: '2px 10px', fontSize: 'var(--font-size-xs)' }}
                                            onClick={() => handleRemoveNode(idx)}
                                        >
                                            {t('remoteDiagnosis.sops.removeNode')}
                                        </button>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: 'var(--spacing-4)' }}>
                                    <div className="form-group" style={{ flex: 1, marginBottom: 'var(--spacing-3)' }}>
                                        <label className="form-label">{t('remoteDiagnosis.sops.nodeName')}</label>
                                        <input className="form-input" value={node.name} onChange={e => handleNodeChange(idx, 'name', e.target.value)} />
                                    </div>
                                    <div className="form-group" style={{ flex: 1, marginBottom: 'var(--spacing-3)' }}>
                                        <label className="form-label">{t('remoteDiagnosis.sops.nodeType')}</label>
                                        <select className="form-input" value={node.type} onChange={e => handleNodeChange(idx, 'type', e.target.value)}>
                                            <option value="start">{t('remoteDiagnosis.sops.startNode')}</option>
                                            <option value="analysis">{t('remoteDiagnosis.sops.analysisNode')}</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="form-group" style={{ marginBottom: 'var(--spacing-3)' }}>
                                    <label className="form-label">{t('remoteDiagnosis.sops.nodeTags')}</label>
                                    <input
                                        className="form-input"
                                        placeholder="tag1, tag2"
                                        value={node.hostTags?.join(', ') ?? ''}
                                        onChange={e => {
                                            const tags = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean)
                                            handleNodeChange(idx, 'hostTags', tags)
                                        }}
                                    />
                                </div>

                                <div className="form-group" style={{ marginBottom: 'var(--spacing-3)' }}>
                                    <label className="form-label">{t('remoteDiagnosis.sops.nodeCommand')}</label>
                                    <textarea
                                        className="form-input"
                                        rows={2}
                                        value={node.command}
                                        onChange={e => {
                                            handleNodeChange(idx, 'command', e.target.value)
                                            setCommandErrors(prev => {
                                                const next = { ...prev }
                                                delete next[idx]
                                                return next
                                            })
                                        }}
                                    />
                                    {commandErrors[idx] && (
                                        <div className="agents-alert agents-alert-error" style={{ marginTop: '4px' }}>
                                            {commandErrors[idx]}
                                        </div>
                                    )}
                                </div>

                                <div className="form-group" style={{ marginBottom: 'var(--spacing-3)' }}>
                                    <label className="form-label">{t('remoteDiagnosis.sops.nodeOutputFormat')}</label>
                                    <input className="form-input" value={node.outputFormat ?? ''} onChange={e => handleNodeChange(idx, 'outputFormat', e.target.value)} />
                                </div>

                                <div className="form-group" style={{ marginBottom: 'var(--spacing-3)' }}>
                                    <label className="form-label">{t('remoteDiagnosis.sops.nodeAnalysis')}</label>
                                    <textarea
                                        className="form-input"
                                        rows={2}
                                        value={node.analysisInstruction ?? ''}
                                        onChange={e => handleNodeChange(idx, 'analysisInstruction', e.target.value)}
                                    />
                                </div>

                                <VariableEditor
                                    variables={node.variables ?? []}
                                    onChange={v => handleNodeChange(idx, 'variables', v)}
                                />

                                <TransitionEditor
                                    transitions={node.transitions ?? []}
                                    nodeNames={nodeNames}
                                    onChange={tr => handleNodeChange(idx, 'transitions', tr)}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                        {t('common.cancel')}
                    </button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
                        {saving ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Expandable SOP Row
// ---------------------------------------------------------------------------

function SopExpandableRow({ sop, onEdit, onDelete }: {
    sop: Sop
    onEdit: (sop: Sop) => void
    onDelete: (sop: Sop) => void
}) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)

    return (
        <>
            <tr onClick={() => setExpanded(prev => !prev)} style={{ cursor: 'pointer' }}>
                <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
                        <svg
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            width="14"
                            height="14"
                            style={{
                                transition: 'transform var(--transition-fast)',
                                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                color: 'var(--color-text-muted)',
                                flexShrink: 0,
                            }}
                        >
                            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                        </svg>
                        <span style={{ fontWeight: 500 }}>{sop.name}</span>
                    </div>
                </td>
                <td style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                    {sop.description || '—'}
                </td>
                <td style={{ fontSize: 'var(--font-size-sm)' }}>
                    {sop.triggerCondition || '—'}
                </td>
                <td style={{ textAlign: 'center' }}>
                    <span style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: 'var(--font-size-xs)',
                        background: 'var(--color-accent-subtle)',
                        fontWeight: 600,
                    }}>
                        {sop.nodes?.length ?? 0}
                    </span>
                </td>
                <td>
                    <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '4px 12px', fontSize: 'var(--font-size-xs)' }}
                            onClick={e => { e.stopPropagation(); onEdit(sop) }}
                        >
                            {t('common.edit')}
                        </button>
                        <button
                            type="button"
                            className="btn btn-danger"
                            style={{ padding: '4px 12px', fontSize: 'var(--font-size-xs)' }}
                            onClick={e => { e.stopPropagation(); onDelete(sop) }}
                        >
                            {t('common.delete')}
                        </button>
                    </div>
                </td>
            </tr>
            {expanded && (
                <tr>
                    <td colSpan={5} style={{ padding: 0, borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ padding: 'var(--spacing-4) var(--spacing-6)', background: 'var(--color-bg-secondary)' }}>
                            {sop.nodes && sop.nodes.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                                    {sop.nodes.map((node, i) => (
                                        <div
                                            key={node.id || i}
                                            style={{
                                                border: '1px solid var(--color-border)',
                                                borderRadius: 'var(--radius-lg)',
                                                padding: 'var(--spacing-4)',
                                                background: 'var(--color-bg-primary)',
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-2)' }}>
                                                <span style={{ fontWeight: 600 }}>
                                                    {node.name || `Node ${i + 1}`}
                                                </span>
                                                <span style={{
                                                    padding: '1px 8px',
                                                    borderRadius: 'var(--radius-full)',
                                                    fontSize: 'var(--font-size-xs)',
                                                    background: node.type === 'start' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                                                    color: node.type === 'start' ? 'var(--color-success)' : '#3b82f6',
                                                }}>
                                                    {node.type === 'start' ? t('remoteDiagnosis.sops.startNode') : t('remoteDiagnosis.sops.analysisNode')}
                                                </span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-2)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                                                {node.hostTags && node.hostTags.length > 0 && (
                                                    <div>
                                                        <span style={{ fontWeight: 500 }}>{t('remoteDiagnosis.sops.nodeTags')}:</span>{' '}
                                                        {node.hostTags.map(tag => (
                                                            <span key={tag} style={{
                                                                display: 'inline-block',
                                                                padding: '1px 6px',
                                                                borderRadius: 'var(--radius-full)',
                                                                fontSize: 'var(--font-size-xs)',
                                                                background: 'var(--color-accent-subtle)',
                                                                marginRight: 4,
                                                            }}>
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                <div>
                                                    <span style={{ fontWeight: 500 }}>{t('remoteDiagnosis.sops.nodeCommand')}:</span>{' '}
                                                    <code style={{ fontSize: 'var(--font-size-xs)', background: 'var(--color-bg-secondary)', padding: '1px 4px', borderRadius: 'var(--radius-sm)' }}>
                                                        {node.command || '—'}
                                                    </code>
                                                </div>
                                                {node.variables && node.variables.length > 0 && (
                                                    <div>
                                                        <span style={{ fontWeight: 500 }}>{t('remoteDiagnosis.sops.nodeVariables')}:</span>{' '}
                                                        {node.variables.map(v => v.name).join(', ')}
                                                    </div>
                                                )}
                                                {node.transitions && node.transitions.length > 0 && (
                                                    <div>
                                                        <span style={{ fontWeight: 500 }}>{t('remoteDiagnosis.sops.nodeTransitions')}:</span>{' '}
                                                        {node.transitions.map(tr => `${tr.condition} -> ${tr.nextNodeId}`).join('; ')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                    No nodes defined.
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    )
}

// ---------------------------------------------------------------------------
// Sops Tab (content only, no page wrapper)
// ---------------------------------------------------------------------------

export function SopsTab() {
    const { t } = useTranslation()
    const { sops, isLoading, error, fetchSops, createSop, updateSop, deleteSop } = useSops()
    const { showToast } = useToast()

    const [editingSop, setEditingSop] = useState<Sop | null>(null)
    const [showAddModal, setShowAddModal] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        fetchSops()
    }, [fetchSops])

    const handleSaveSop = useCallback(
        async (data: SopCreateRequest) => {
            if (editingSop) {
                await updateSop(editingSop.id, data)
                showToast('success', t('remoteDiagnosis.sops.editSuccess', { name: data.name }))
            } else {
                await createSop(data)
                showToast('success', t('remoteDiagnosis.sops.addSuccess', { name: data.name }))
            }
            setShowAddModal(false)
            setEditingSop(null)
            await fetchSops()
        },
        [editingSop, updateSop, createSop, fetchSops, showToast, t],
    )

    const handleDelete = useCallback(
        (sop: Sop) => {
            const confirmed = window.confirm(
                t('remoteDiagnosis.sops.deleteConfirm', { name: sop.name }),
            )
            if (!confirmed) return
            deleteSop(sop.id)
                .then(() => {
                    showToast('success', t('remoteDiagnosis.sops.deleteSuccess', { name: sop.name }))
                    fetchSops()
                })
                .catch((err: unknown) => {
                    showToast('error', err instanceof Error ? err.message : 'Delete failed')
                })
        },
        [deleteSop, fetchSops, showToast, t],
    )

    const handleExport = useCallback(() => {
        const blob = new Blob([JSON.stringify(sops, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'sops-export.json'
        a.click()
        URL.revokeObjectURL(url)
        showToast('success', t('remoteDiagnosis.sops.exportSuccess'))
    }, [sops, showToast, t])

    const handleImport = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = async (event) => {
                try {
                    const data = JSON.parse(event.target?.result as string)
                    const items = Array.isArray(data) ? data : [data]
                    for (const item of items) {
                        await createSop(item as SopCreateRequest)
                    }
                    showToast('success', t('remoteDiagnosis.sops.importSuccess'))
                    await fetchSops()
                } catch (err) {
                    showToast('error', err instanceof Error ? err.message : 'Import failed')
                }
            }
            reader.readAsText(file)
            e.target.value = ''
        },
        [createSop, fetchSops, showToast, t],
    )

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-4)' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>{t('remoteDiagnosis.sops.title')}</h2>
                    <p style={{ margin: 0, fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{t('remoteDiagnosis.sops.subtitle')}</p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
                    <button className="btn btn-secondary" onClick={handleExport} disabled={sops.length === 0}>
                        {t('remoteDiagnosis.sops.exportJson')}
                    </button>
                    <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                        {t('remoteDiagnosis.sops.importJson')}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={handleImport}
                    />
                    <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                        {t('remoteDiagnosis.sops.addSop')}
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
            ) : sops.length === 0 ? (
                <div className="empty-state">
                    <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <h3 className="empty-state-title">{t('remoteDiagnosis.sops.noSops')}</h3>
                    <p className="empty-state-description">{t('remoteDiagnosis.sops.noSopsHint')}</p>
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th>{t('remoteDiagnosis.sops.name')}</th>
                                <th>{t('remoteDiagnosis.sops.description')}</th>
                                <th>{t('remoteDiagnosis.sops.triggerCondition')}</th>
                                <th style={{ textAlign: 'center' }}>{t('remoteDiagnosis.sops.nodes')}</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sops.map(sop => (
                                <SopExpandableRow
                                    key={sop.id}
                                    sop={sop}
                                    onEdit={s => {
                                        setEditingSop(s)
                                        setShowAddModal(true)
                                    }}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {(showAddModal || editingSop) && (
                <SopFormModal
                    sop={editingSop}
                    onClose={() => {
                        setShowAddModal(false)
                        setEditingSop(null)
                    }}
                    onSave={handleSaveSop}
                />
            )}
        </>
    )
}

// ---------------------------------------------------------------------------
// Sops Page (backward compatible wrapper)
// ---------------------------------------------------------------------------

export default function Sops() {
    return (
        <div className="page-container sidebar-top-page">
            <SopsTab />
        </div>
    )
}

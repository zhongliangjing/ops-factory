import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ScheduledJob, ScheduleSessionInfo } from '@goosed/sdk'
import { useGoosed } from '../contexts/GoosedContext'
import { useToast } from '../contexts/ToastContext'
import { useInbox } from '../contexts/InboxContext'
import { useUser } from '../contexts/UserContext'
import { slugify } from '../config/runtime'
import ResourceCard, { type ResourceStatusTone } from '../components/ResourceCard'

interface FormState {
    name: string
    instruction: string
    cron: string
}

interface ScheduleDraftMap {
    [agentId: string]: {
        [scheduleId: string]: {
            name: string
            instruction: string
        }
    }
}

const DEFAULT_CRON = '0 0 9 * * *'

function getScheduleDraftsKey(userId: string): string {
    return `opsfactory:${userId}:scheduler:drafts:v1`
}


function ensureUniqueId(base: string, existingIds: Set<string>): string {
    if (!existingIds.has(base)) return base
    let counter = 2
    while (existingIds.has(`${base}-${counter}`)) {
        counter += 1
    }
    return `${base}-${counter}`
}

function isCronLikelyValid(cron: string): boolean {
    const parts = cron.trim().split(/\s+/)
    return parts.length === 5 || parts.length === 6
}

function loadDrafts(storageKey: string): ScheduleDraftMap {
    if (typeof window === 'undefined') return {}
    try {
        const raw = window.localStorage.getItem(storageKey)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as ScheduleDraftMap
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

function saveDrafts(storageKey: string, drafts: ScheduleDraftMap): void {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(storageKey, JSON.stringify(drafts))
}

function getScheduleStatusTone(job: ScheduledJob): ResourceStatusTone {
    if (job.currently_running) return 'warning'
    if (job.paused) return 'neutral'
    return 'success'
}

export default function ScheduledActions() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { userId } = useUser()
    const { agents, getClient, isConnected, error } = useGoosed()
    const { showToast } = useToast()
    const { markSessionRead } = useInbox()

    const draftsKey = getScheduleDraftsKey(userId || 'anonymous')
    const [selectedAgent, setSelectedAgent] = useState('')
    const [jobs, setJobs] = useState<ScheduledJob[]>([])
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [editingJobId, setEditingJobId] = useState<string | null>(null)
    const [viewingJobId, setViewingJobId] = useState<string | null>(null)
    const [runs, setRuns] = useState<ScheduleSessionInfo[]>([])
    const [runsLoading, setRunsLoading] = useState(false)
    const [showModal, setShowModal] = useState(false)
    const [drafts, setDrafts] = useState<ScheduleDraftMap>(() => loadDrafts(draftsKey))
    const [form, setForm] = useState<FormState>({
        name: '',
        instruction: '',
        cron: DEFAULT_CRON,
    })

    useEffect(() => {
        if (!selectedAgent && agents.length > 0) {
            setSelectedAgent(agents[0].id)
        }
    }, [agents, selectedAgent])

    const selectedClient = useMemo(() => {
        if (!selectedAgent) return null
        return getClient(selectedAgent)
    }, [getClient, selectedAgent])

    const loadSchedules = async () => {
        if (!selectedClient) return
        setLoading(true)
        try {
            const list = await selectedClient.listSchedules()
            setJobs(list)
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Failed to load schedules')
        } finally {
            setLoading(false)
        }
    }

    const loadRuns = async (scheduleId: string) => {
        if (!selectedClient) return
        setRunsLoading(true)
        try {
            const scheduleRuns = await selectedClient.listScheduleSessions(scheduleId, 30)
            setRuns(scheduleRuns)
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Failed to load schedule runs')
        } finally {
            setRunsLoading(false)
        }
    }

    useEffect(() => {
        void loadSchedules()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedClient])

    // Auto-refresh schedule list every 15s (like official desktop UI)
    const loadSchedulesRef = useRef(loadSchedules)
    loadSchedulesRef.current = loadSchedules
    useEffect(() => {
        if (viewingJobId || !selectedClient) return
        const id = setInterval(() => {
            if (!submitting) loadSchedulesRef.current()
        }, 15000)
        return () => clearInterval(id)
    }, [viewingJobId, selectedClient, submitting])

    const openCreateModal = () => {
        setEditingJobId(null)
        setForm({ name: '', instruction: '', cron: DEFAULT_CRON })
        setShowModal(true)
    }

    const openEditModal = (job: ScheduledJob) => {
        setEditingJobId(job.id)
        const draft = drafts[selectedAgent]?.[job.id]
        setForm({
            name: draft?.name || job.id,
            instruction: draft?.instruction || '',
            cron: job.cron,
        })
        setShowModal(true)
    }

    const handleSubmit = async () => {
        if (!selectedClient) return
        if (!isCronLikelyValid(form.cron)) {
            showToast('warning', 'Cron expression must have 5 or 6 fields')
            return
        }

        const cleanedName = slugify(form.name)
        if (!cleanedName) {
            showToast('warning', 'Name is required')
            return
        }
        if (!form.instruction.trim()) {
            showToast('warning', 'Instruction is required')
            return
        }

        setSubmitting(true)
        try {
            const existingIds = new Set(jobs.map(job => job.id))
            const scheduleId = editingJobId
                ? (cleanedName === editingJobId ? cleanedName : ensureUniqueId(cleanedName, existingIds))
                : ensureUniqueId(cleanedName, existingIds)

            const recipe = {
                title: form.name.trim(),
                description: `Scheduled action: ${form.name.trim()}`,
                instructions: form.instruction.trim(),
            }

            if (editingJobId) {
                const original = jobs.find(job => job.id === editingJobId)
                const wasPaused = !!original?.paused

                if (scheduleId === editingJobId) {
                    await selectedClient.deleteSchedule(editingJobId)
                    await selectedClient.createSchedule({ id: scheduleId, recipe, cron: form.cron.trim() })
                } else {
                    await selectedClient.createSchedule({ id: scheduleId, recipe, cron: form.cron.trim() })
                    await selectedClient.deleteSchedule(editingJobId)
                }

                if (wasPaused) {
                    await selectedClient.pauseSchedule(scheduleId)
                }
                showToast('success', 'Scheduled action updated')
            } else {
                await selectedClient.createSchedule({ id: scheduleId, recipe, cron: form.cron.trim() })
                showToast('success', 'Scheduled action created')
            }

            const nextDrafts: ScheduleDraftMap = {
                ...drafts,
                [selectedAgent]: {
                    ...(drafts[selectedAgent] || {}),
                    [scheduleId]: {
                        name: form.name.trim(),
                        instruction: form.instruction.trim(),
                    },
                },
            }
            setDrafts(nextDrafts)
            saveDrafts(draftsKey, nextDrafts)

            setShowModal(false)
            await loadSchedules()
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Operation failed')
        } finally {
            setSubmitting(false)
        }
    }

    const handlePause = async (job: ScheduledJob) => {
        if (!selectedClient) return
        try {
            await selectedClient.pauseSchedule(job.id)
            showToast('success', `Paused ${job.id}`)
            await loadSchedules()
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Operation failed')
        }
    }

    const handleUnpause = async (job: ScheduledJob) => {
        if (!selectedClient) return
        try {
            await selectedClient.unpauseSchedule(job.id)
            showToast('success', `Unpaused ${job.id}`)
            await loadSchedules()
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Operation failed')
        }
    }

    const handleKill = async (job: ScheduledJob) => {
        if (!selectedClient) return
        try {
            await selectedClient.killSchedule(job.id)
            showToast('success', `Killed ${job.id}`)
            await loadSchedules()
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Operation failed')
        }
    }

    const handleRunNow = async (job: ScheduledJob) => {
        if (!selectedClient) return
        try {
            const sessionId = await selectedClient.runScheduleNow(job.id)
            showToast('success', sessionId === 'CANCELLED' ? `Run cancelled for ${job.id}` : `Triggered ${job.id}`)
            await loadSchedules()
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Operation failed')
        }
    }

    const handleDelete = async (job: ScheduledJob) => {
        if (!selectedClient) return
        const confirmed = window.confirm(`Delete scheduled action "${job.id}"?`)
        if (!confirmed) return
        try {
            await selectedClient.deleteSchedule(job.id)
            showToast('success', `Deleted ${job.id}`)
            await loadSchedules()
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Delete failed')
        }
    }

    const handleViewRuns = async (job: ScheduledJob) => {
        setViewingJobId(job.id)
        await loadRuns(job.id)
    }

    const handleOpenRunSession = (sessionId: string) => {
        if (!selectedAgent) return
        markSessionRead(selectedAgent, sessionId)
        navigate(`/chat?sessionId=${sessionId}&agent=${selectedAgent}`)
    }

    const getScheduleStatusLabel = (job: ScheduledJob) => {
        if (job.paused) return t('scheduler.paused')
        if (job.currently_running) return t('scheduler.running')
        return t('scheduler.active')
    }

    return (
        <div className="page-container sidebar-top-page scheduled-page">
            {viewingJobId ? (
                <div className="scheduled-detail-header">
                    <button
                        type="button"
                        className="scheduled-detail-back"
                        onClick={() => {
                            setViewingJobId(null)
                            setRuns([])
                        }}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                            <path d="M15 18l-6-6 6-6" />
                        </svg>
                        {t('common.back')}
                    </button>

                    <div className="scheduled-detail-title-group">
                        <h2 className="page-title scheduled-detail-title">{t('scheduler.runs', { id: viewingJobId })}</h2>
                        <p className="page-subtitle scheduled-detail-subtitle">{t('scheduler.runsSubtitle')}</p>
                    </div>
                </div>
            ) : (
                <>
                    <div className="page-header">
                        <h1 className="page-title">{t('scheduler.title')}</h1>
                        <p className="page-subtitle">{t('scheduler.subtitle')}</p>
                    </div>

                    <div className="scheduled-toolbar">
                        <label className="scheduled-agent-select-wrap">
                            <span>{t('scheduler.agent')}</span>
                            <select
                                className="scheduled-agent-select"
                                value={selectedAgent}
                                onChange={(e) => setSelectedAgent(e.target.value)}
                            >
                                {agents.map(agent => (
                                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                                ))}
                            </select>
                        </label>

                        <button type="button" className="btn btn-primary" onClick={openCreateModal} disabled={!selectedAgent}>
                            {t('scheduler.createAction')}
                        </button>
                    </div>
                </>
            )}

            {error && <div className="conn-banner conn-banner-error">{t('common.connectionError', { error })}</div>}
            {!isConnected && !error && <div className="conn-banner conn-banner-warning">{t('common.connectingGateway')}</div>}

            {viewingJobId ? (
                <div className="scheduled-runs-panel">
                    {runsLoading ? (
                        <div className="empty-state">
                            <h3 className="empty-state-title">{t('scheduler.loadingRuns')}</h3>
                        </div>
                    ) : runs.length === 0 ? (
                        <div className="empty-state">
                            <h3 className="empty-state-title">{t('scheduler.noRuns')}</h3>
                            <p className="empty-state-description">{t('scheduler.noRunsHint')}</p>
                        </div>
                    ) : (
                        <div className="scheduled-runs-list">
                            {runs.map(run => (
                                <div key={run.id} className="scheduled-run-item">
                                    <div className="scheduled-run-main">
                                        <div className="scheduled-run-name">{run.name || run.id}</div>
                                        <div className="scheduled-run-meta">
                                            <span>{new Date(run.createdAt).toLocaleString()}</span>
                                            <span>{run.messageCount} {t('common.messages')}</span>
                                            {run.totalTokens !== undefined && run.totalTokens !== null && (
                                                <span>{run.totalTokens.toLocaleString()} {t('common.tokens')}</span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => handleOpenRunSession(run.id)}
                                    >
                                        {t('scheduler.openSession')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : loading ? (
                <div className="empty-state">
                    <h3 className="empty-state-title">{t('scheduler.loadingSchedules')}</h3>
                </div>
            ) : jobs.length === 0 ? (
                <div className="empty-state">
                    <h3 className="empty-state-title">{t('scheduler.noSchedules')}</h3>
                    <p className="empty-state-description">{t('scheduler.noSchedulesHint')}</p>
                </div>
            ) : (
                <div className="resource-grid scheduled-grid">
                    {jobs.map(job => (
                        <ResourceCard
                            key={job.id}
                            className="scheduled-card"
                            title={job.id}
                            statusLabel={getScheduleStatusLabel(job)}
                            statusTone={getScheduleStatusTone(job)}
                            summary={(
                                <div className="resource-card-summary-stack">
                                    <p className="resource-card-summary-text resource-card-summary-code" title={job.cron}>
                                        {job.cron}
                                    </p>
                                    <p className={['resource-card-summary-text', !drafts[selectedAgent]?.[job.id]?.instruction ? 'resource-card-summary-placeholder' : ''].filter(Boolean).join(' ')}>
                                        {drafts[selectedAgent]?.[job.id]?.instruction || t('scheduler.summaryUnavailable')}
                                    </p>
                                </div>
                            )}
                            metrics={[
                                { label: t('scheduler.cron'), value: job.cron, valueClassName: 'scheduled-card-code' },
                                { label: t('scheduler.lastRun'), value: job.last_run ? new Date(job.last_run).toLocaleString() : t('scheduler.never') },
                                { label: t('common.status'), value: getScheduleStatusLabel(job) },
                            ]}
                            footer={(
                                <div className="scheduled-card-footer">
                                    <button type="button" className="resource-card-danger-action" onClick={() => handleDelete(job)}>
                                        {t('common.delete')}
                                    </button>
                                    <div className="scheduled-card-actions">
                                        <button type="button" className="btn btn-secondary" onClick={() => handleViewRuns(job)}>
                                            {t('scheduler.viewRuns')}
                                        </button>
                                        {!job.currently_running ? (
                                            <>
                                                <button type="button" className="btn btn-secondary" onClick={() => openEditModal(job)}>{t('common.edit')}</button>
                                                {job.paused ? (
                                                    <button type="button" className="btn btn-secondary" onClick={() => handleUnpause(job)}>{t('scheduler.resume')}</button>
                                                ) : (
                                                    <button type="button" className="btn btn-secondary" onClick={() => handlePause(job)}>{t('scheduler.pause')}</button>
                                                )}
                                                <button type="button" className="resource-card-primary-action" onClick={() => handleRunNow(job)}>{t('scheduler.runNow')}</button>
                                            </>
                                        ) : (
                                            <button type="button" className="btn btn-secondary" onClick={() => handleKill(job)}>{t('scheduler.kill')}</button>
                                        )}
                                    </div>
                                </div>
                            )}
                        />
                    ))}
                </div>
            )}

            {showModal && (
                <div className="modal-overlay" role="dialog" aria-modal="true">
                    <div className="modal-content scheduled-modal">
                        <div className="modal-header">
                            <h3 className="modal-title">{editingJobId ? t('scheduler.editAction') : t('scheduler.createAction')}</h3>
                            <button type="button" className="modal-close" onClick={() => setShowModal(false)}>×</button>
                        </div>
                        <div className="modal-body scheduled-modal-body">
                            <label className="scheduled-field-label">
                                {t('scheduler.name')}
                                <input
                                    className="scheduled-input"
                                    value={form.name}
                                    onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="daily-summary-job"
                                />
                            </label>
                            <label className="scheduled-field-label">
                                {t('scheduler.instruction')}
                                <textarea
                                    className="scheduled-textarea"
                                    value={form.instruction}
                                    onChange={(e) => setForm(prev => ({ ...prev, instruction: e.target.value }))}
                                    placeholder={editingJobId ? t('scheduler.instructionPlaceholderEdit') : t('scheduler.instructionPlaceholderNew')}
                                    rows={5}
                                />
                            </label>

                            {editingJobId && <div className="scheduled-editing-id">{t('scheduler.currentScheduleId', { id: editingJobId })}</div>}

                            <label className="scheduled-field-label">
                                {t('scheduler.cron')}
                                <input
                                    className="scheduled-input"
                                    value={form.cron}
                                    onChange={(e) => setForm(prev => ({ ...prev, cron: e.target.value }))}
                                    placeholder="0 0 9 * * *"
                                />
                            </label>
                            <p className="scheduled-hint">{t('scheduler.cronHint')}</p>
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={submitting}>
                                {t('common.cancel')}
                            </button>
                            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                                {submitting ? t('scheduler.saving') : (editingJobId ? t('common.save') : t('scheduler.create'))}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

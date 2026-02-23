import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ScheduledJob, ScheduleSessionInfo } from '@goosed/sdk'
import { useGoosed } from '../contexts/GoosedContext'
import { useToast } from '../contexts/ToastContext'
import { useInbox } from '../contexts/InboxContext'
import { useUser } from '../contexts/UserContext'

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

function slugifyName(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
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

export default function ScheduledActions() {
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

        const cleanedName = slugifyName(form.name)
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

    const handlePauseToggle = async (job: ScheduledJob) => {
        if (!selectedClient) return
        try {
            if (job.paused) {
                await selectedClient.unpauseSchedule(job.id)
                showToast('success', `Unpaused ${job.id}`)
            } else {
                await selectedClient.pauseSchedule(job.id)
                showToast('success', `Paused ${job.id}`)
            }
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

    return (
        <div className="page-container scheduled-page">
            <div className="page-header">
                <h1 className="page-title">Scheduler</h1>
                <p className="page-subtitle">Create and manage cron-based actions per agent.</p>
            </div>

            {error && <div className="agents-alert agents-alert-error">Connection error: {error}</div>}
            {!isConnected && !error && <div className="agents-alert agents-alert-warning">Connecting to gateway...</div>}

            <div className="scheduled-toolbar">
                <label className="scheduled-agent-select-wrap">
                    <span>Agent</span>
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
                    Create Scheduled Action
                </button>
            </div>

            {viewingJobId ? (
                <div className="scheduled-runs-panel">
                    <div className="scheduled-runs-header">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                                setViewingJobId(null)
                                setRuns([])
                            }}
                        >
                            Back
                        </button>
                        <div>
                            <h3 className="scheduled-runs-title">{viewingJobId} Runs</h3>
                            <p className="scheduled-runs-subtitle">Recent scheduled executions for this job.</p>
                        </div>
                    </div>

                    {runsLoading ? (
                        <div className="empty-state">
                            <h3 className="empty-state-title">Loading runs...</h3>
                        </div>
                    ) : runs.length === 0 ? (
                        <div className="empty-state">
                            <h3 className="empty-state-title">No runs yet</h3>
                            <p className="empty-state-description">This schedule has not produced any session yet.</p>
                        </div>
                    ) : (
                        <div className="scheduled-runs-list">
                            {runs.map(run => (
                                <div key={run.id} className="scheduled-run-item">
                                    <div className="scheduled-run-main">
                                        <div className="scheduled-run-name">{run.name || run.id}</div>
                                        <div className="scheduled-run-meta">
                                            <span>{new Date(run.createdAt).toLocaleString()}</span>
                                            <span>{run.messageCount} messages</span>
                                            {run.totalTokens !== undefined && run.totalTokens !== null && (
                                                <span>{run.totalTokens.toLocaleString()} tokens</span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => handleOpenRunSession(run.id)}
                                    >
                                        Open Session
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : loading ? (
                <div className="empty-state">
                    <h3 className="empty-state-title">Loading schedules...</h3>
                </div>
            ) : jobs.length === 0 ? (
                <div className="empty-state">
                    <h3 className="empty-state-title">No schedules yet</h3>
                    <p className="empty-state-description">Create your first scheduled action to automate an instruction.</p>
                </div>
            ) : (
                <div className="agents-grid scheduled-grid">
                    {jobs.map(job => (
                        <div key={job.id} className="agent-card scheduled-card">
                            <div className="agent-card-header">
                                <div className="agent-card-title">
                                    <div>
                                        <div className="agent-name">{job.id}</div>
                                        <div className="scheduled-cron">{job.cron}</div>
                                    </div>
                                </div>
                                <span className={`status-pill ${job.paused ? 'status-stopped' : 'status-running'}`}>
                                    {job.paused ? 'paused' : (job.currently_running ? 'running' : 'active')}
                                </span>
                            </div>

                            <div className="agent-meta">
                                <div className="agent-meta-row">
                                    <span className="agent-meta-label">Last run</span>
                                    <span className="agent-meta-value">
                                        {job.last_run ? new Date(job.last_run).toLocaleString() : 'Never'}
                                    </span>
                                </div>
                                <div className="agent-meta-row">
                                    <span className="agent-meta-label">Source</span>
                                    <span className="agent-meta-value scheduled-source">{job.source}</span>
                                </div>
                            </div>

                            <div className="scheduled-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => openEditModal(job)}>Edit</button>
                                <button type="button" className="btn btn-secondary" onClick={() => handlePauseToggle(job)}>
                                    {job.paused ? 'Resume' : 'Pause'}
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={() => handleRunNow(job)}>Run now</button>
                                <button type="button" className="btn btn-secondary" onClick={() => handleViewRuns(job)}>View Runs</button>
                                <button type="button" className="btn btn-danger" onClick={() => handleDelete(job)}>Delete</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showModal && (
                <div className="modal-overlay" role="dialog" aria-modal="true">
                    <div className="modal-content scheduled-modal">
                        <div className="modal-header">
                            <h3 className="modal-title">{editingJobId ? 'Edit Scheduled Action' : 'Create Scheduled Action'}</h3>
                            <button type="button" className="modal-close" onClick={() => setShowModal(false)}>×</button>
                        </div>
                        <div className="modal-body scheduled-modal-body">
                            <label className="scheduled-field-label">
                                Name
                                <input
                                    className="scheduled-input"
                                    value={form.name}
                                    onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="daily-summary-job"
                                />
                            </label>
                            <label className="scheduled-field-label">
                                Instruction
                                <textarea
                                    className="scheduled-textarea"
                                    value={form.instruction}
                                    onChange={(e) => setForm(prev => ({ ...prev, instruction: e.target.value }))}
                                    placeholder={editingJobId ? 'Enter updated instructions for this schedule.' : "Tell me to summarize today's progress and pending risks."}
                                    rows={5}
                                />
                            </label>

                            {editingJobId && <div className="scheduled-editing-id">Current schedule ID: {editingJobId}</div>}

                            <label className="scheduled-field-label">
                                Cron
                                <input
                                    className="scheduled-input"
                                    value={form.cron}
                                    onChange={(e) => setForm(prev => ({ ...prev, cron: e.target.value }))}
                                    placeholder="0 0 9 * * *"
                                />
                            </label>
                            <p className="scheduled-hint">Supports 5 or 6 fields. Example: 0 0 9 * * * (every day at 09:00).</p>
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={submitting}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                                {submitting ? 'Saving...' : (editingJobId ? 'Save' : 'Create')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}


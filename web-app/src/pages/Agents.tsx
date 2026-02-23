import { useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGoosed } from '../contexts/GoosedContext'
import { useMcp } from '../hooks/useMcp'

function formatModel(provider?: string, model?: string): string {
    if (provider && model) return `${model} (${provider})`
    if (model) return model
    if (provider) return provider
    return 'Unknown'
}

// Component to fetch and display MCP count for an agent
function McpCount({ agentId }: { agentId: string }) {
    const { entries, fetchMcp } = useMcp(agentId)

    useEffect(() => {
        fetchMcp()
    }, [fetchMcp])

    const enabledCount = entries.filter(e => e.enabled).length
    return <span>{enabledCount}</span>
}

export default function Agents() {
    const { agents, isConnected, error } = useGoosed()
    const navigate = useNavigate()

    const agentSkillsMap = useMemo(() => {
        return new Map(agents.map(agent => [agent.id, agent.skills || []]))
    }, [agents])

    return (
        <div className="page-container agents-page">
            <div className="page-header">
                <h1 className="page-title">Agents</h1>
                <p className="page-subtitle">Active and configured agents available through the gateway.</p>
            </div>

            {error && (
                <div className="agents-alert agents-alert-error">Connection error: {error}</div>
            )}
            {!isConnected && !error && (
                <div className="agents-alert agents-alert-warning">Connecting to gateway...</div>
            )}

            {agents.length === 0 ? (
                <div className="empty-state">
                    <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                    </svg>
                    <h3 className="empty-state-title">No agents found</h3>
                    <p className="empty-state-description">Configure agents in the gateway to see them here.</p>
                </div>
            ) : (
                <div className="agents-grid">
                    {agents.map(agent => {
                        const skills = agentSkillsMap.get(agent.id) || []
                        return (
                            <div key={agent.id} className="agent-card">
                                <div className="agent-card-header">
                                    <div className="agent-card-title">
                                        <span className={`status-dot status-${agent.status}`}></span>
                                        <div>
                                            <div className="agent-name">{agent.name}</div>
                                        </div>
                                    </div>
                                    <span className={`status-pill status-${agent.status}`}>{agent.status}</span>
                                </div>

                                <div className="agent-meta">
                                    <div className="agent-meta-row">
                                        <span className="agent-meta-label">Model</span>
                                        <span className="agent-meta-value">{formatModel(agent.provider, agent.model)}</span>
                                    </div>
                                </div>

                                <div className="agent-extensions">
                                    <div className="agent-meta-row">
                                        <span className="agent-meta-label">Skills</span>
                                        <span className={`agent-meta-value ${skills.length === 0 ? 'is-empty' : ''}`}>
                                            {skills.length}
                                        </span>
                                    </div>
                                    <div className="agent-meta-row">
                                        <span className="agent-meta-label">MCP</span>
                                        <span className="agent-meta-value">
                                            <McpCount agentId={agent.id} />
                                        </span>
                                    </div>
                                </div>

                                <div className="agent-skill-cta">
                                    <button
                                        type="button"
                                        className="agent-skill-button"
                                        onClick={() => navigate(`/agents/${agent.id}/configure`)}
                                    >
                                        Configure
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAgentConfig } from '../hooks/useAgentConfig'
import { useToast } from '../contexts/ToastContext'
import { McpSection } from '../components/mcp'
import { SkillSection } from '../components/skill'

export default function AgentConfigure() {
    const { agentId } = useParams<{ agentId: string }>()
    const navigate = useNavigate()
    const { config, isLoading, error, fetchConfig, updateConfig } = useAgentConfig()
    const { showToast } = useToast()

    // Form state
    const [agentsMd, setAgentsMd] = useState('')
    const [isSavingPrompt, setIsSavingPrompt] = useState(false)

    useEffect(() => {
        if (agentId) {
            fetchConfig(agentId)
        }
    }, [agentId, fetchConfig])

    useEffect(() => {
        if (config) {
            setAgentsMd(config.agentsMd)
        }
    }, [config])

    const handleSavePrompt = async () => {
        if (!agentId) return
        setIsSavingPrompt(true)

        const result = await updateConfig(agentId, { agentsMd })

        if (result.success) {
            showToast('success', 'Prompt saved successfully')
        } else {
            showToast('error', result.error || 'Failed to save prompt')
        }

        setIsSavingPrompt(false)
    }

    if (isLoading) {
        return (
            <div className="page-container agent-configure-page">
                <div className="agent-configure-loading">Loading agent configuration...</div>
            </div>
        )
    }

    if (error || !config) {
        return (
            <div className="page-container agent-configure-page">
                <div className="agent-configure-error">
                    {error || 'Agent not found'}
                    <button type="button" onClick={() => navigate('/agents')}>
                        Back to Agents
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="page-container agent-configure-page">
            <div className="agent-configure-header">
                <button
                    type="button"
                    className="agent-configure-back"
                    onClick={() => navigate('/agents')}
                >
                    ← Back to Agents
                </button>
                <div className="agent-configure-title-section">
                    <h1 className="agent-configure-title">{config.name}</h1>
                    <span className="agent-configure-id">{config.id}</span>
                </div>
            </div>

            <div className="agent-configure-content">
                {/* Agent Prompt Section */}
                <section className="agent-configure-section">
                    <h2 className="agent-configure-section-title">Agent Prompt (AGENTS.md)</h2>
                    <p className="agent-configure-section-desc">
                        Define the agent&apos;s behavior, capabilities, and instructions.
                    </p>
                    <div className="agent-prompt-editor">
                        <textarea
                            value={agentsMd}
                            onChange={(e) => setAgentsMd(e.target.value)}
                            placeholder="# Agent Instructions&#10;&#10;Write your agent prompt here..."
                            rows={15}
                        />
                    </div>
                    <div className="agent-configure-actions">
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleSavePrompt}
                            disabled={isSavingPrompt}
                        >
                            {isSavingPrompt ? 'Saving...' : 'Save Prompt'}
                        </button>
                    </div>
                </section>

                {/* MCP Section */}
                <section className="agent-configure-section">
                    <McpSection agentId={agentId || null} />
                </section>

                {/* Skills Section */}
                <section className="agent-configure-section">
                    <SkillSection agentId={agentId || ''} />
                </section>
            </div>
        </div>
    )
}

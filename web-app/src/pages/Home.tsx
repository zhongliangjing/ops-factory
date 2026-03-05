import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useGoosed } from '../contexts/GoosedContext'
import ChatInput from '../components/ChatInput'
import { PROMPT_TEMPLATES } from '../config/prompts'
import { PromptTemplate } from '../types/prompt'

interface ModelInfo {
    provider: string
    model: string
}

const AGENT_TAB_ORDER = ['all', 'universal-agent', 'kb-agent'] as const

export default function Home() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { getClient, agents, isConnected, error: connectionError } = useGoosed()
    const [isCreatingSession, setIsCreatingSession] = useState(false)
    const [selectedAgent, setSelectedAgent] = useState('')
    const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
    const [presetMessage, setPresetMessage] = useState('')
    const [presetToken, setPresetToken] = useState(0)
    const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
    const [activeAgentTab, setActiveAgentTab] = useState<string>('all')

    useEffect(() => {
        if (agents.length > 0 && !selectedAgent) {
            setSelectedAgent(agents[0].id)
        }
    }, [agents, selectedAgent])

    useEffect(() => {
        const fetchModelInfo = async () => {
            if (!isConnected || !selectedAgent) return
            try {
                const client = getClient(selectedAgent)
                const systemInfo = await client.systemInfo()
                if (systemInfo.provider && systemInfo.model) {
                    setModelInfo({ provider: systemInfo.provider, model: systemInfo.model })
                }
            } catch (err) {
                console.error('Failed to fetch model info:', err)
            }
        }
        fetchModelInfo()
    }, [getClient, selectedAgent, isConnected])

    const handleInputSubmit = async (message: string) => {
        if (isCreatingSession || !selectedAgent) return

        setIsCreatingSession(true)
        try {
            const client = getClient(selectedAgent)
            const session = await client.startSession()
            await client.resumeSession(session.id)

            navigate(`/chat?sessionId=${session.id}&agent=${selectedAgent}`, {
                state: { initialMessage: message }
            })
        } catch (err) {
            console.error('Failed to create session:', err)
            alert(t('home.failedToCreateSession', { error: err instanceof Error ? err.message : 'Unknown error' }))
        } finally {
            setIsCreatingSession(false)
        }
    }

    const availableAgentTabs = useMemo(() => {
        const fromTemplates = Array.from(new Set(PROMPT_TEMPLATES.map(template => template.agentId)))
        // Ensure 'all' is always first
        const ordered = AGENT_TAB_ORDER.filter(id => id === 'all' || fromTemplates.includes(id)) as string[]
        const remaining = fromTemplates.filter(id => !AGENT_TAB_ORDER.includes(id as any))
        return ordered.concat(remaining)
    }, [])

    useEffect(() => {
        if (!availableAgentTabs.includes(activeAgentTab)) {
            setActiveAgentTab(availableAgentTabs[0] || 'all')
        }
    }, [activeAgentTab, availableAgentTabs])

    const filteredTemplates = useMemo(
        () => activeAgentTab === 'all'
            ? PROMPT_TEMPLATES
            : PROMPT_TEMPLATES.filter(template => template.agentId === activeAgentTab),
        [activeAgentTab]
    )

    const getAgentLabel = (agentId: string) => {
        if (agentId === 'all') return t('home.allAgents')

        const fromConfig = agents.find(agent => agent.id === agentId)?.name
        if (fromConfig) return fromConfig

        if (agentId === 'report-agent') return 'Report Agent'
        if (agentId === 'kb-agent') return 'KB Agent'
        if (agentId === 'contract-agent') return 'Contract Agent'
        if (agentId === 'universal-agent') return 'Universal Agent'
        return agentId
    }

    const handleTemplateSelect = (template: PromptTemplate) => {
        const targetAgentId = agents.find(agent => agent.id === template.agentId)?.id || template.agentId
        setSelectedAgent(targetAgentId)
        setPresetMessage(template.prompt)
        setPresetToken(prev => prev + 1)
        setActiveTemplateId(template.id)
    }

    return (
        <div className="home-container">
            <div className="home-hero">
                <h1 className="home-title">{t('home.greeting')}</h1>
                <p className="home-description">
                    {t('home.description')}
                </p>

                {connectionError && (
                    <div style={{
                        padding: 'var(--spacing-4)',
                        background: 'rgba(239, 68, 68, 0.2)',
                        borderRadius: 'var(--radius-lg)',
                        color: 'var(--color-error)',
                        marginBottom: 'var(--spacing-6)'
                    }}>
                        {t('common.connectionError', { error: connectionError })}
                    </div>
                )}

                {!isConnected && !connectionError && (
                    <div style={{
                        padding: 'var(--spacing-4)',
                        background: 'rgba(245, 158, 11, 0.2)',
                        borderRadius: 'var(--radius-lg)',
                        color: 'var(--color-warning)',
                        marginBottom: 'var(--spacing-6)'
                    }}>
                        {t('common.connectingGateway')}
                    </div>
                )}
            </div>

            <div className="home-input-container">
                <ChatInput
                    onSubmit={handleInputSubmit}
                    disabled={!isConnected || isCreatingSession || !selectedAgent}
                    placeholder={isCreatingSession ? t('home.creatingSession') : t('home.askAnything')}
                    autoFocus
                    selectedAgent={selectedAgent}
                    onAgentChange={setSelectedAgent}
                    modelInfo={modelInfo}
                    presetMessage={presetMessage}
                    presetToken={presetToken}
                />
            </div>

            <div className="home-template-section">
                <div className="home-template-tabs" role="tablist" aria-label="Agent template tabs">
                    {availableAgentTabs.map(tabAgentId => (
                        <button
                            key={tabAgentId}
                            type="button"
                            role="tab"
                            aria-selected={activeAgentTab === tabAgentId}
                            className={`home-template-tab ${activeAgentTab === tabAgentId ? 'is-active' : ''}`}
                            onClick={() => setActiveAgentTab(tabAgentId)}
                        >
                            {getAgentLabel(tabAgentId)}
                        </button>
                    ))}
                </div>

                <div className="home-template-grid">
                    {filteredTemplates.map(template => {
                        const Icon = template.icon
                        return (
                            <button
                                key={template.id}
                                type="button"
                                className={`prompt-template-card ${activeTemplateId === template.id ? 'is-active' : ''}`}
                                onClick={() => handleTemplateSelect(template)}
                            >
                                <div className="prompt-template-icon-container">
                                    <Icon size={20} />
                                </div>
                                <h4 className="prompt-template-name">{template.title}</h4>
                                <p className="prompt-template-desc">{template.description}</p>
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

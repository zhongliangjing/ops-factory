import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useGoosed } from '../contexts/GoosedContext'
import { useToast } from '../contexts/ToastContext'
import ChatInput from '../components/ChatInput'
import { PROMPT_TEMPLATES, CATEGORIES, type PromptTemplateConfig } from '../config/promptTemplates'
import { iconMap } from '../config/iconMap'

interface ModelInfo {
    provider: string
    model: string
}

const UNIVERSAL_AGENT_ID = 'universal-agent'

export default function Home() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { showToast } = useToast()
    const { getClient, agents, isConnected, error: connectionError } = useGoosed()
    const [isCreatingSession, setIsCreatingSession] = useState(false)
    const [selectedAgent, setSelectedAgent] = useState('')
    const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
    const [presetMessage, setPresetMessage] = useState('')
    const [presetToken, setPresetToken] = useState(0)
    const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
    const [activeCategory, setActiveCategory] = useState<string>('all')

    useEffect(() => {
        if (agents.length > 0 && !selectedAgent) {
            const universal = agents.find(a => a.id === UNIVERSAL_AGENT_ID)
            setSelectedAgent(universal ? universal.id : agents[0].id)
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

            navigate(`/chat?sessionId=${session.id}&agent=${selectedAgent}`, {
                state: { initialMessage: message }
            })
        } catch (err) {
            console.error('Failed to create session:', err)
            showToast('error', t('home.failedToCreateSession', { error: err instanceof Error ? err.message : 'Unknown error' }))
        } finally {
            setIsCreatingSession(false)
        }
    }

    const filteredTemplates = useMemo(
        () => activeCategory === 'all'
            ? PROMPT_TEMPLATES
            : PROMPT_TEMPLATES.filter(tpl => tpl.category === activeCategory),
        [activeCategory]
    )

    const handleTemplateSelect = (template: PromptTemplateConfig) => {
        const targetAgentId = agents.find(a => a.id === template.agentId)?.id || template.agentId
        setSelectedAgent(targetAgentId)
        const i18nKey = template.i18nKey.replace('templates.', '')
        setPresetMessage(t(`home.templates.${i18nKey}.prompt`))
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
                    <div className="conn-banner conn-banner-error">
                        {t('common.connectionError', { error: connectionError })}
                    </div>
                )}

                {!isConnected && !connectionError && (
                    <div className="conn-banner conn-banner-warning">
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
                <div className="home-template-tabs" role="tablist" aria-label="Scenario category tabs">
                    {CATEGORIES.map(categoryId => (
                        <button
                            key={categoryId}
                            type="button"
                            role="tab"
                            aria-selected={activeCategory === categoryId}
                            className={`home-template-tab ${activeCategory === categoryId ? 'is-active' : ''}`}
                            onClick={() => setActiveCategory(categoryId)}
                        >
                            {t(`home.categories.${categoryId}`)}
                        </button>
                    ))}
                </div>

                <div className="home-template-grid">
                    {filteredTemplates.map(template => {
                        const Icon = iconMap[template.icon]
                        const i18nKey = template.i18nKey.replace('templates.', '')
                        return (
                            <button
                                key={template.id}
                                type="button"
                                className={`prompt-template-card ${activeTemplateId === template.id ? 'is-active' : ''}`}
                                onClick={() => handleTemplateSelect(template)}
                            >
                                <div className="prompt-template-icon-container">
                                    {Icon && <Icon size={20} />}
                                </div>
                                <h4 className="prompt-template-name">{t(`home.templates.${i18nKey}.title`)}</h4>
                                <p className="prompt-template-desc">{t(`home.templates.${i18nKey}.description`)}</p>
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

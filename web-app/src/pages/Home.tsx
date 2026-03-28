import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useGoosed } from '../contexts/GoosedContext'
import { useToast } from '../contexts/ToastContext'
import ChatInput from '../components/ChatInput'
import opsclawIcon from '../assets/opsclaw.svg'

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

    return (
        <div className="home-container">
            <div className="home-hero">
                <h1 className="home-title">
                    <span>{t('home.greeting')}</span>
                    <img
                        src={opsclawIcon}
                        alt=""
                        aria-hidden="true"
                        className="home-title-icon"
                        data-testid="home-title-icon"
                    />
                </h1>
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
                />
            </div>
        </div>
    )
}

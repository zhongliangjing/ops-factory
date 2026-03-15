import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useGoosed } from '../contexts/GoosedContext'
import { useInbox } from '../contexts/InboxContext'
import { useToast } from '../contexts/ToastContext'
import { useChat, convertBackendMessage } from '../hooks/useChat'
import MessageList from '../components/MessageList'
import ChatInput from '../components/ChatInput'
import type { Session, ImageData } from '@goosed/sdk'
import type { AttachedFile } from '../components/Message'
import { isScheduledSession } from '../config/runtime'

interface LocationState {
    initialMessage?: string
}

interface ModelInfo {
    provider: string
    model: string
}

function detectAgentFromWorkingDir(workingDir: string, agents: Array<{ id: string }>): string {
    for (const agent of agents) {
        if (workingDir.includes(agent.id)) {
            return agent.id
        }
    }
    return agents[0]?.id || ''
}

export default function Chat() {
    const { t } = useTranslation()
    const [searchParams] = useSearchParams()
    const location = useLocation()
    const navigate = useNavigate()
    const { getClient, agents, isConnected, error: goosedError } = useGoosed()
    const { markSessionRead } = useInbox()
    const { showToast } = useToast()

    const sessionId = searchParams.get('sessionId')
    const agentParam = searchParams.get('agent')

    const [selectedAgent, setSelectedAgent] = useState(agentParam || agents[0]?.id || '')
    const [session, setSession] = useState<Session | null>(null)
    const [isInitializing, setIsInitializing] = useState(true)
    const [initError, setInitError] = useState<string | null>(null)
    const [isCreatingSession, setIsCreatingSession] = useState(false)
    const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
    const [showStopHint, setShowStopHint] = useState(false)
    const stopHintTimerRef = useRef<number | null>(null)

    const client = selectedAgent ? getClient(selectedAgent) : null

    const { messages, chatState, isLoading, error, tokenState, outputFilesEvent, sendMessage, stopMessage, clearMessages, setInitialMessages } = useChat({
        sessionId,
        client: client!,
    })

    useEffect(() => {
        if (error) {
            // Map gateway timeout/connection errors to localized warning toasts
            if (/No response from agent/i.test(error)) {
                showToast('warning', t('chat.agentNoResponse'))
            } else if (/Agent stopped responding/i.test(error)) {
                showToast('warning', t('chat.agentIdleTimeout'))
            } else if (/Agent connection (failed|lost)/i.test(error)) {
                showToast('warning', t('chat.agentConnectionLost'))
            } else {
                showToast('error', error)
            }
        }
    }, [error, showToast, t])

    useEffect(() => {
        if (agentParam) {
            setSelectedAgent(agentParam)
        } else if (agents.length > 0 && !selectedAgent) {
            setSelectedAgent(agents[0].id)
        }
    }, [agentParam, agents, selectedAgent])

    const locationState = location.state as LocationState | null
    const initialMessage = locationState?.initialMessage

    useEffect(() => {
        const fetchModelInfo = async () => {
            if (!isConnected || !client) return
            try {
                const systemInfo = await client.systemInfo()
                if (systemInfo.provider && systemInfo.model) {
                    setModelInfo({ provider: systemInfo.provider, model: systemInfo.model })
                }
            } catch (err) {
                console.error('Failed to fetch model info:', err)
            }
        }
        fetchModelInfo()
    }, [client, isConnected])

    const createSessionWithAgent = useCallback(async (agentId: string) => {
        setIsCreatingSession(true)
        try {
            const agentClient = getClient(agentId)
            const newSession = await agentClient.startSession()
            setSession(newSession)
            setSelectedAgent(agentId)
            clearMessages()
            navigate(`/chat?sessionId=${newSession.id}&agent=${agentId}`, { replace: true })
            return newSession
        } catch (err) {
            console.error('Failed to create session:', err)
            setInitError(err instanceof Error ? err.message : 'Failed to create session')
            return null
        } finally {
            setIsCreatingSession(false)
        }
    }, [getClient, clearMessages, navigate])

    const handleAgentChange = useCallback(async (agentId: string) => {
        if (agentId === selectedAgent) return
        await createSessionWithAgent(agentId)
    }, [selectedAgent, createSessionWithAgent])

    useEffect(() => {
        const initSession = async () => {
            if (!isConnected || !selectedAgent) return

            if (!sessionId) {
                clearMessages()
                setSession(null)
                setInitError(null)
                setIsInitializing(false)
                navigate('/', { replace: true })
                return
            }

            setIsInitializing(true)
            setInitError(null)

            try {
                const initialClient = getClient(selectedAgent)
                let resumeResult = await initialClient.resumeSession(sessionId)
                let resumedSession = resumeResult.session

                if (!agentParam && resumedSession.working_dir) {
                    const detected = detectAgentFromWorkingDir(resumedSession.working_dir, agents)
                    if (detected !== selectedAgent) {
                        setSelectedAgent(detected)
                        resumeResult = await getClient(detected).resumeSession(sessionId)
                        resumedSession = resumeResult.session
                    }
                }

                setSession(resumedSession)

                // Auto-mark scheduled sessions as read when viewed
                if (isScheduledSession(resumedSession)) {
                    const agentId = agentParam || detectAgentFromWorkingDir(resumedSession.working_dir, agents)
                    markSessionRead(agentId, sessionId)
                }

                if (resumedSession.conversation && Array.isArray(resumedSession.conversation)) {
                    const historyMessages = resumedSession.conversation.map(msg =>
                        convertBackendMessage(msg as Record<string, unknown>)
                    )
                    setInitialMessages(historyMessages)
                }
            } catch (err) {
                console.error('Failed to initialize session:', err)
                setInitError(err instanceof Error ? err.message : 'Failed to load session')
            } finally {
                setIsInitializing(false)
            }
        }
        initSession()
    }, [getClient, isConnected, sessionId, selectedAgent, agentParam, agents, setInitialMessages, clearMessages, navigate])

    useEffect(() => {
        if (initialMessage && sessionId && !isInitializing && messages.length === 0) {
            sendMessage(initialMessage)
            window.history.replaceState({}, document.title)
        }
    }, [initialMessage, sessionId, isInitializing, messages.length, sendMessage])

    useEffect(() => {
        return () => {
            if (stopHintTimerRef.current !== null) {
                window.clearTimeout(stopHintTimerRef.current)
                stopHintTimerRef.current = null
            }
        }
    }, [])

    const handleSendMessage = useCallback((text: string, images?: ImageData[], attachedFiles?: AttachedFile[]) => {
        if (stopHintTimerRef.current !== null) {
            window.clearTimeout(stopHintTimerRef.current)
            stopHintTimerRef.current = null
        }
        setShowStopHint(false)
        sendMessage(text, images, attachedFiles)
    }, [sendMessage])

    const handleUploadFile = useCallback(async (file: File): Promise<{ path: string }> => {
        if (!client || !sessionId) {
            throw new Error('No active session for file upload')
        }
        const result = await client.uploadFile(file, sessionId)
        return { path: result.path }
    }, [client, sessionId])

    const handleRetry = useCallback(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            if (msg.role === 'user') {
                const text = msg.content.find(c => c.type === 'text')?.text
                if (text) {
                    sendMessage(text)
                    return
                }
            }
        }
    }, [messages, sendMessage])

    const handleStopMessage = useCallback(async () => {
        const stopped = await stopMessage()
        if (stopped) {
            setShowStopHint(true)
            if (stopHintTimerRef.current !== null) {
                window.clearTimeout(stopHintTimerRef.current)
            }
            stopHintTimerRef.current = window.setTimeout(() => {
                setShowStopHint(false)
            }, 2200)
        }
    }, [stopMessage])

    if (isInitializing && !isConnected && goosedError) {
        return (
            <div className="chat-container">
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="empty-state">
                        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <h3 className="empty-state-title">{t('chat.failedToLoadSession')}</h3>
                        <p className="empty-state-description">{goosedError}</p>
                        <button className="btn btn-primary" style={{ marginTop: 'var(--spacing-4)' }} onClick={() => navigate('/')}>
                            {t('chat.backToHome')}
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    if (isInitializing) {
        return (
            <div className="chat-container">
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div className="loading-spinner" style={{ margin: '0 auto var(--spacing-4)' }} />
                        <p style={{ color: 'var(--color-text-secondary)' }}>{t('chat.loadingSession')}</p>
                    </div>
                </div>
            </div>
        )
    }

    if (initError) {
        return (
            <div className="chat-container">
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="empty-state">
                        <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <h3 className="empty-state-title">{t('chat.failedToLoadSession')}</h3>
                        <p className="empty-state-description">{initError}</p>
                        <button className="btn btn-primary" style={{ marginTop: 'var(--spacing-4)' }} onClick={() => navigate('/')}>
                            {t('chat.backToHome')}
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="chat-container">
            {/* Session header */}
            {session?.name && (
                <div className="chat-session-header">
                    <span className="chat-session-title">{session.name}</span>
                </div>
            )}

            {/* Messages area - scrollable */}
            <div className="chat-messages-area">
                <div className="chat-messages-scroll">
                    <MessageList messages={messages} isLoading={isLoading} chatState={chatState} agentId={selectedAgent} sessionId={sessionId} outputFilesEvent={outputFilesEvent} onRetry={handleRetry} />
                </div>
            </div>

            {/* Input at bottom - floating */}
            <div className="chat-input-area-bottom">
                <div className="chat-input-area-inner">
                    <div className={`chat-inline-hint ${showStopHint ? 'visible' : ''}`}>
                        {t('chat.generationStopped')}
                    </div>
                    <ChatInput
                        onSubmit={handleSendMessage}
                        onUploadFile={handleUploadFile}
                        disabled={isLoading || !isConnected || isCreatingSession}
                        isGenerating={isLoading}
                        onStopGeneration={handleStopMessage}
                        placeholder={isCreatingSession ? t('chat.switchingAgent') : isLoading ? t('chat.waitingForResponse') : t('chat.typePlaceholder')}
                        autoFocus
                        selectedAgent={selectedAgent}
                        onAgentChange={handleAgentChange}
                        showAgentSelector={true}
                        modelInfo={modelInfo}
                        tokenState={tokenState}
                    />
                </div>
            </div>
        </div>
    )
}

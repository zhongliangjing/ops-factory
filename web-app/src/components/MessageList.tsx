import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Message, { ChatMessage, type DetectedFile } from './Message'
import type { ToolResponseMap } from './Message'
import { ChatState, type OutputFilesEvent } from '../hooks/useChat'
import { extractSourceDocuments, type Citation } from '../utils/citationParser'
import { useUser } from '../contexts/UserContext'
import { GATEWAY_URL, GATEWAY_SECRET_KEY } from '../config/runtime'

interface MessageListProps {
    messages: ChatMessage[]
    isLoading?: boolean
    chatState?: ChatState
    agentId?: string
    sessionId?: string | null
    outputFilesEvent?: OutputFilesEvent | null
    onRetry?: () => void
}

export default function MessageList({ messages, isLoading = false, chatState = ChatState.Idle, agentId, sessionId, outputFilesEvent, onRetry }: MessageListProps) {
    const { t } = useTranslation()
    const { userId } = useUser()
    const containerRef = useRef<HTMLDivElement>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const [messageOutputFiles, setMessageOutputFiles] = useState<Map<string, DetectedFile[]>>(new Map())
    const processedOutputFilesRef = useRef<Set<string>>(new Set())

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages])

    const visibleMessages = useMemo(
        () => messages.filter(msg => !msg.metadata || msg.metadata.userVisible !== false),
        [messages]
    )

    const finalAssistantTextMessageId = useMemo(() => {
        for (let i = visibleMessages.length - 1; i >= 0; i--) {
            const msg = visibleMessages[i]
            if (msg.role === 'assistant' && msg.content.some(c => c.type === 'text' && typeof c.text === 'string' && c.text.trim().length > 0)) {
                return msg.id
            }
        }
        return undefined
    }, [visibleMessages])

    const toolResponses = useMemo<ToolResponseMap>(() => {
        const map: ToolResponseMap = new Map()
        for (const msg of visibleMessages) {
            for (const content of msg.content) {
                if (content.type === 'toolResponse' && content.id) {
                    const toolResult = content.toolResult
                    map.set(content.id, {
                        result: toolResult?.status === 'success' ? toolResult.value : toolResult,
                        isError: toolResult?.status === 'error'
                    })
                }
            }
        }
        return map
    }, [visibleMessages])

    // Extract source documents from tool call results for fallback references
    const sourceDocuments = useMemo<Citation[]>(() => {
        return extractSourceDocuments(visibleMessages)
    }, [visibleMessages])

    const gatewayHeaders = useCallback((): Record<string, string> => {
        const h: Record<string, string> = { 'x-secret-key': GATEWAY_SECRET_KEY }
        if (userId) h['x-user-id'] = userId
        return h
    }, [userId])

    // ── Real-time: handle OutputFiles SSE event ─────────────────────
    // When the gateway sends an OutputFiles event after a /reply completes,
    // attach the files to the last assistant text message and persist the mapping.
    useEffect(() => {
        if (!outputFilesEvent || !agentId || !finalAssistantTextMessageId) return

        // Deduplicate: don't process the same event twice
        const eventKey = `${outputFilesEvent.sessionId}:${finalAssistantTextMessageId}`
        if (processedOutputFilesRef.current.has(eventKey)) return
        processedOutputFilesRef.current.add(eventKey)

        const files: DetectedFile[] = outputFilesEvent.files.map(f => ({
            path: f.path,
            name: f.name,
            ext: f.ext,
        }))

        // Update local state
        setMessageOutputFiles(prev => {
            const next = new Map(prev)
            next.set(finalAssistantTextMessageId, files)
            return next
        })

        // Persist to gateway (fire-and-forget)
        fetch(`${GATEWAY_URL}/agents/${agentId}/file-capsules`, {
            method: 'POST',
            headers: { ...gatewayHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: outputFilesEvent.sessionId,
                messageId: finalAssistantTextMessageId,
                files,
            }),
        }).catch(() => { /* best-effort persistence */ })
    }, [outputFilesEvent, agentId, finalAssistantTextMessageId, gatewayHeaders])

    // ── Resume: load persisted file capsules from gateway ───────────
    useEffect(() => {
        if (!agentId || !sessionId || isLoading) return
        // Only fetch on initial load when we have messages but no output files yet
        if (messageOutputFiles.size > 0 || visibleMessages.length === 0) return

        let cancelled = false
        const loadPersistedCapsules = async () => {
            try {
                const res = await fetch(
                    `${GATEWAY_URL}/agents/${agentId}/file-capsules?sessionId=${encodeURIComponent(sessionId)}`,
                    { headers: gatewayHeaders() }
                )
                if (!res.ok || cancelled) return
                const data = await res.json() as { entries?: Record<string, DetectedFile[]> }
                if (!data.entries || cancelled) return

                const map = new Map<string, DetectedFile[]>()
                for (const [msgId, files] of Object.entries(data.entries)) {
                    if (Array.isArray(files) && files.length > 0) {
                        map.set(msgId, files)
                    }
                }
                if (map.size > 0) {
                    setMessageOutputFiles(map)
                }
            } catch {
                /* best-effort resume */
            }
        }

        loadPersistedCapsules()
        return () => { cancelled = true }
    }, [agentId, sessionId, isLoading, visibleMessages.length, gatewayHeaders])

    // Reset state when agent or session changes
    useEffect(() => {
        setMessageOutputFiles(new Map())
        processedOutputFilesRef.current = new Set()
    }, [agentId, sessionId])

    if (visibleMessages.length === 0 && !isLoading) {
        return (
            <div className="empty-state">
                <svg
                    className="empty-state-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <h3 className="empty-state-title">{t('chat.noMessages')}</h3>
                <p className="empty-state-description">
                    {t('chat.startConversation')}
                </p>
            </div>
        )
    }

    return (
        <div className="chat-messages" ref={containerRef}>
            {visibleMessages.map((message, index) => {
                const isLastAssistant =
                    isLoading &&
                    message.role === 'assistant' &&
                    index === visibleMessages.length - 1
                const isFinalAssistantResponse =
                    message.role === 'assistant' &&
                    !!message.id &&
                    message.id === finalAssistantTextMessageId
                const hasOutputFiles = !!message.id && messageOutputFiles.has(message.id)
                return (
                    <Message
                        key={message.id || index}
                        message={message}
                        toolResponses={toolResponses}
                        agentId={agentId}
                        userId={userId}
                        isStreaming={isLastAssistant}
                        onRetry={message.role === 'assistant' && index === visibleMessages.length - 1 ? onRetry : undefined}
                        sourceDocuments={isFinalAssistantResponse ? sourceDocuments : undefined}
                        outputFiles={message.id ? messageOutputFiles.get(message.id) : undefined}
                        showFileCapsules={hasOutputFiles}
                    />
                )
            })}

            {isLoading && visibleMessages[visibleMessages.length - 1]?.role !== 'assistant' && (
                <div className="message assistant animate-fade-in">
                    <div className="message-avatar">G</div>
                    <div className="message-content">
                        <div className="loading-dots">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                        {chatState === ChatState.Thinking && (
                            <div className="loading-status-text">{t('chat.thinking')}</div>
                        )}
                        {chatState === ChatState.Compacting && (
                            <div className="loading-status-text">{t('chat.compactingContext')}</div>
                        )}
                    </div>
                </div>
            )}

            <div ref={bottomRef} />
        </div>
    )
}

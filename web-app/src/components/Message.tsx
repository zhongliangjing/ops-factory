import { memo, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ToolCallDisplay from './ToolCallDisplay'
import CitationMark from './CitationMark'
import ReferenceList from './ReferenceList'
import { usePreview } from '../contexts/PreviewContext'
import { mergeCitationMetadata, parseCitations, replaceCitationsWithPlaceholders, type Citation } from '../utils/citationParser'
import { getDisplayTextContent, getFullTextContent, getReasoningContent, getThinkingContent } from '../utils/messageContent'
import { GATEWAY_URL, GATEWAY_SECRET_KEY } from '../config/runtime'
import type { ChatMessage, DetectedFile, ToolResponseMap } from '../types/message'

interface MessageProps {
    message: ChatMessage
    toolResponses?: ToolResponseMap
    agentId?: string
    userId?: string | null
    isStreaming?: boolean
    onRetry?: () => void
    sourceDocuments?: Citation[]
    fetchedDocuments?: Citation[]
    outputFiles?: DetectedFile[]
    showFileCapsules?: boolean
}

interface ToolCallPair {
    id: string
    name: string
    args?: Record<string, unknown>
    result?: unknown
    isPending: boolean
    isError: boolean
}

interface ProcessEntry {
    key: string
    kind: 'reasoning' | 'thinking' | 'tool'
    label?: string
    content?: string
    toolCall?: ToolCallPair
}

interface ScrollFadeState {
    hasTopFade: boolean
    hasBottomFade: boolean
}

function ThinkingStatusIcon({ isStreaming, isOpen }: { isStreaming: boolean; isOpen: boolean }) {
    if (isStreaming) {
        return (
            <span className="process-thinking-status process-thinking-status-spinning" aria-hidden="true">
                <span className="process-thinking-spinner-ring" />
            </span>
        )
    }

    return (
        <span className={`process-thinking-status process-thinking-status-chevron${isOpen ? ' open' : ''}`} aria-hidden="true" />
    )
}

function parseTodoContent(content: string) {
    const lines = content.split('\n').map(line => line.trim()).filter(Boolean)
    const tasks: Array<{ done: boolean; text: string }> = []
    for (const line of lines) {
        if (line.startsWith('#')) continue
        const checked = line.match(/^- \[(x|X)\]\s+(.+)$/)
        if (checked) { tasks.push({ done: true, text: checked[2].trim() }); continue }
        const unchecked = line.match(/^- \[\s\]\s+(.+)$/)
        if (unchecked) { tasks.push({ done: false, text: unchecked[1].trim() }) }
    }
    return tasks
}

function normalizeProcessText(text: string | undefined): string {
    return (text || '').replace(/\s+/g, ' ').trim()
}

function FileCapsule({ filePath, fileName, fileExt, agentId, userId }: {
    filePath: string; fileName: string; fileExt: string; agentId?: string; userId?: string | null
}) {
    const downloadUrl = `${GATEWAY_URL}/agents/${agentId}/files/${encodeURIComponent(filePath)}?key=${GATEWAY_SECRET_KEY}${userId ? `&uid=${encodeURIComponent(userId)}` : ''}`
    const { openPreview, isPreviewable } = usePreview()
    const canPreview = isPreviewable(fileExt, fileName, filePath)

    const handlePreview = (e: React.MouseEvent) => {
        e.preventDefault()
        openPreview({
            name: fileName,
            path: filePath,
            type: fileExt,
            agentId: agentId || '',
        })
    }

    return (
        <div className="file-capsule">
            <span className="file-capsule-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                </svg>
            </span>
            <span className="file-capsule-name">{fileName}</span>
            <div className="file-capsule-actions">
                {canPreview && (
                    <button className="file-capsule-btn" onClick={handlePreview} title="Preview">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                    </button>
                )}
                <a href={downloadUrl + '&download=true'} download className="file-capsule-btn" title="Download">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </a>
            </div>
        </div>
    )
}

function MessageInner({
    message,
    toolResponses = new Map(),
    agentId,
    userId,
    isStreaming = false,
    onRetry,
    sourceDocuments,
    fetchedDocuments,
    outputFiles = [],
    showFileCapsules = true,
}: MessageProps) {
    const isUser = message.role === 'user'

    const fullText = getFullTextContent(message)
    const displayTextFromContent = getDisplayTextContent(message)

    const processEntries = useMemo<ProcessEntry[]>(() => {
        if (isUser) return []

        const items: ProcessEntry[] = []
        let hasStructuredReasoning = false
        let hasStructuredThinking = false
        let textBufferKind: 'reasoning' | 'thinking' | null = null
        let textBuffer = ''
        const pushProcessTextEntry = (entry: ProcessEntry) => {
            const previous = items[items.length - 1]
            const currentText = normalizeProcessText(entry.content)
            const previousText = normalizeProcessText(previous?.content)

            if (
                previous &&
                (previous.kind === 'reasoning' || previous.kind === 'thinking') &&
                (entry.kind === 'reasoning' || entry.kind === 'thinking') &&
                currentText.length > 0 &&
                currentText === previousText
            ) {
                return
            }

            items.push(entry)
        }

        const flushTextBuffer = () => {
            if (!textBufferKind || !textBuffer.trim()) {
                textBufferKind = null
                textBuffer = ''
                return
            }

            pushProcessTextEntry({
                key: `${message.id || 'message'}-${textBufferKind}-${items.length}`,
                kind: textBufferKind,
                label: textBufferKind === 'reasoning' ? '推理过程' : '思考过程',
                content: textBuffer,
            })

            textBufferKind = null
            textBuffer = ''
        }

        for (const content of message.content) {
            if (content.type === 'reasoning' && typeof content.text === 'string' && content.text.trim()) {
                hasStructuredReasoning = true
                if (textBufferKind !== 'reasoning') {
                    flushTextBuffer()
                    textBufferKind = 'reasoning'
                }
                textBuffer += content.text
                continue
            }

            if (content.type === 'thinking' && typeof content.thinking === 'string' && content.thinking.trim()) {
                hasStructuredThinking = true
                if (textBufferKind !== 'thinking') {
                    flushTextBuffer()
                    textBufferKind = 'thinking'
                }
                textBuffer += content.thinking
                continue
            }

            if (content.type === 'toolRequest' && content.id) {
                flushTextBuffer()
                const toolCall = content.toolCall
                const name = toolCall?.value?.name || 'unknown'
                if (name === 'unknown' && toolCall?.status === 'error') {
                    continue
                }

                const response = toolResponses.get(content.id)
                items.push({
                    key: content.id,
                    kind: 'tool',
                    toolCall: {
                        id: content.id,
                        name,
                        args: toolCall?.value?.arguments,
                        result: response?.result,
                        isPending: !response && toolCall?.status === 'pending',
                        isError: response?.isError || toolCall?.status === 'error',
                    },
                })
            }
        }

        flushTextBuffer()

        if (!hasStructuredReasoning) {
            const reasoningText = getReasoningContent(message)
            if (reasoningText) {
                pushProcessTextEntry({
                    key: `${message.id || 'message'}-reasoning-fallback`,
                    kind: 'reasoning',
                    label: '推理过程',
                    content: reasoningText,
                })
            }
        }

        if (!hasStructuredThinking) {
            const thinkingText = getThinkingContent(message)
            if (thinkingText) {
                pushProcessTextEntry({
                    key: `${message.id || 'message'}-thinking-fallback`,
                    kind: 'thinking',
                    label: '思考过程',
                    content: thinkingText,
                })
            }
        }

        return items
    }, [isUser, message.content, message.id, toolResponses])

    const [openState, setOpenState] = useState<Record<string, boolean>>({})
    const [fadeState, setFadeState] = useState<Record<string, ScrollFadeState>>({})
    const contentRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const wasStreamingRef = useRef(isStreaming)

    useEffect(() => {
        setOpenState(current => {
            const next = { ...current }
            for (const entry of processEntries) {
                if ((entry.kind === 'reasoning' || entry.kind === 'thinking') && !(entry.key in next)) {
                    next[entry.key] = isStreaming
                }
            }
            return next
        })
    }, [isStreaming, processEntries])

    useEffect(() => {
        if (isStreaming) {
            setOpenState(current => {
                const next = { ...current }
                for (const entry of processEntries) {
                    if (entry.kind !== 'reasoning' && entry.kind !== 'thinking') continue
                    next[entry.key] = true
                }
                return next
            })
        }
    }, [isStreaming, processEntries])

    useEffect(() => {
        const wasStreaming = wasStreamingRef.current
        if (wasStreaming && !isStreaming) {
            setOpenState(current => {
                const next = { ...current }
                for (const entry of processEntries) {
                    if (entry.kind !== 'reasoning' && entry.kind !== 'thinking') continue
                    next[entry.key] = false
                }
                return next
            })
        }
        wasStreamingRef.current = isStreaming
    }, [isStreaming, processEntries])

    useEffect(() => {
        const computeFadeState = (element: HTMLDivElement | null): ScrollFadeState => {
            if (!element) return { hasTopFade: false, hasBottomFade: false }
            const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0)
            return {
                hasTopFade: element.scrollTop > 2,
                hasBottomFade: maxScrollTop - element.scrollTop > 2,
            }
        }

        const syncFadeStates = () => {
            setFadeState(current => {
                const next = { ...current }
                for (const entry of processEntries) {
                    if (entry.kind !== 'reasoning' && entry.kind !== 'thinking') continue
                    next[entry.key] = computeFadeState(contentRefs.current[entry.key] || null)
                }
                return next
            })
        }

        syncFadeStates()
        window.addEventListener('resize', syncFadeStates)
        return () => window.removeEventListener('resize', syncFadeStates)
    }, [processEntries, openState])

    const toggleEntry = (key: string) => {
        if (isStreaming) return
        setOpenState(current => ({ ...current, [key]: !current[key] }))
    }

    const handleScroll = (key: string) => {
        const element = contentRefs.current[key]
        if (!element) return
        const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0)
        setFadeState(current => ({
            ...current,
            [key]: {
                hasTopFade: element.scrollTop > 2,
                hasBottomFade: maxScrollTop - element.scrollTop > 2,
            }
        }))
    }

    useEffect(() => {
        if (!isStreaming) return

        setFadeState(current => {
            const next = { ...current }

            for (const entry of processEntries) {
                if ((entry.kind !== 'reasoning' && entry.kind !== 'thinking') || !openState[entry.key]) continue

                const element = contentRefs.current[entry.key]
                if (!element) continue

                element.scrollTop = element.scrollHeight
                next[entry.key] = {
                    hasTopFade: element.scrollTop > 2,
                    hasBottomFade: false,
                }
            }

            return next
        })
    }, [isStreaming, openState, processEntries])

    const TodoToolCard = ({ toolCall }: { toolCall: ToolCallPair }) => {
        const raw = typeof toolCall.args?.content === 'string' ? toolCall.args.content : ''
        const tasks = parseTodoContent(raw)
        const doneCount = tasks.filter(t => t.done).length
        const totalCount = tasks.length
        const indicatorTone = (() => {
            if (toolCall.isError) return 'error'
            if (toolCall.isPending) return 'pending'
            if (totalCount > 0 && doneCount === totalCount) return 'success'
            return 'active'
        })()
        const rawDisplayName = toolCall.name.split('__').pop()?.replace(/_/g, ' ') || toolCall.name
        const cleanedDisplayName = rawDisplayName.replace(/^todo\s+/i, '').trim() || rawDisplayName
        const capitalized = cleanedDisplayName.charAt(0).toUpperCase() + cleanedDisplayName.slice(1)

        return (
            <div className="tool-call embedded todo-tool-call">
                <div className="tool-call-header">
                    <span className={`tool-call-indicator ${indicatorTone}`} aria-hidden="true" />
                    <span className="tool-call-name">Todo {capitalized}</span>
                </div>
                <div className="tool-call-body">
                    {tasks.length > 0 ? (
                        <div className="todo-tasks">
                            {tasks.map((task, idx) => (
                                <div key={idx} className={`todo-task-item ${task.done ? 'done' : ''}`}>
                                    <span className="todo-task-check" aria-hidden="true">{task.done ? '✓' : '○'}</span>
                                    <span className="todo-task-text">{task.text}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <pre className="tool-call-output">{raw}</pre>
                    )}
                    {toolCall.isPending && (
                        <div className="tool-call-running">
                            <span className="loading-dots"><span></span><span></span><span></span></span>
                            <span>Running...</span>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    const isEmptyAssistantResponse = !isUser && message.content.length === 0 && !isStreaming

    if (isUser && !fullText) {
        return null
    }

    const hasProcessEntries = !isUser && processEntries.length > 0

    if (!isUser && !fullText && !hasProcessEntries && !isStreaming && !isEmptyAssistantResponse) {
        return null
    }

    const rawDisplayText = !isUser ? (displayTextFromContent || fullText) : fullText
    const parsedCitations: Citation[] = !isUser && rawDisplayText ? parseCitations(rawDisplayText) : []
    const citations = mergeCitationMetadata(parsedCitations, sourceDocuments || [])
    const citationMap = new Map(citations.map(c => [c.index, c]))
    const retrievedDocuments = sourceDocuments || fetchedDocuments || []

    const displayText = citations.length > 0
        ? replaceCitationsWithPlaceholders(rawDisplayText)
            .replace(/```[ \t]*\[CITE_/g, '```\n\n[CITE_')
        : rawDisplayText
    const shouldShowCitedReferences = !isUser && !isStreaming && citations.length > 0
    const shouldShowRetrievedReferences = !isUser && !isStreaming && retrievedDocuments.length > 0

    return (
        <div className={`message ${isUser ? 'user' : 'assistant'} animate-slide-in`}>
            <div className="message-avatar">
                {isUser ? 'U' : 'G'}
            </div>
            <div className="message-body">
                <div className="message-content">
                    {isEmptyAssistantResponse && (
                        <div className="message-error-banner">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <span>The model did not return a valid response. This may be a temporary service issue.</span>
                            {onRetry && (
                                <button className="message-error-retry" onClick={onRetry}>
                                    Retry
                                </button>
                            )}
                        </div>
                    )}

                    {!isUser && processEntries.length > 0 && (
                        <div className="process-flow">
                            {processEntries.map((entry, index) => {
                                const stepClass = `${index === 0 ? ' process-step-first' : ''}${index === processEntries.length - 1 ? ' process-step-last' : ''}`

                                if (entry.kind === 'reasoning' || entry.kind === 'thinking') {
                                    const isOpen = openState[entry.key] ?? true
                                    const state = fadeState[entry.key] || { hasTopFade: false, hasBottomFade: false }
                                    return (
                                        <div key={entry.key} className={`process-step process-step-thinking${stepClass}`}>
                                            <div className="process-step-rail" aria-hidden="true" />
                                            <div className="process-step-content">
                                                <button
                                                    type="button"
                                                    className={`process-thinking-header${isOpen ? ' open' : ''}${isStreaming ? ' is-streaming' : ''}`}
                                                    onClick={() => toggleEntry(entry.key)}
                                                    disabled={isStreaming}
                                                    aria-expanded={isOpen}
                                                >
                                                    <ThinkingStatusIcon isStreaming={isStreaming} isOpen={isOpen} />
                                                    <span className="process-thinking-label">{entry.label}</span>
                                                </button>
                                                {isOpen && (
                                                    <div
                                                        ref={element => { contentRefs.current[entry.key] = element }}
                                                        className={`thinking-block-content process-thinking-content${state.hasTopFade ? ' has-top-fade' : ''}${state.hasBottomFade ? ' has-bottom-fade' : ''}`}
                                                        onScroll={() => handleScroll(entry.key)}
                                                    >
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                            {entry.content || ''}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                }

                                const toolCall = entry.toolCall!
                                const indicatorTone = toolCall.isError ? 'error' : toolCall.isPending ? 'pending' : 'success'

                                return (
                                    <div key={entry.key} className={`process-step process-step-tool process-step-tool-${indicatorTone}${stepClass}`}>
                                        <div className="process-step-rail" aria-hidden="true">
                                            <span className={`process-step-node ${indicatorTone}`} />
                                        </div>
                                        <div className="process-step-content">
                                            {toolCall.name.startsWith('todo__')
                                                ? <TodoToolCard toolCall={toolCall} />
                                                : (
                                                    <ToolCallDisplay
                                                        name={toolCall.name}
                                                        args={toolCall.args}
                                                        result={toolCall.result}
                                                        isPending={toolCall.isPending}
                                                        isError={toolCall.isError}
                                                        embedded
                                                    />
                                                )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {displayText && (
                        <div className="message-text">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    a: ({ href, children, ...props }) => {
                                        if (href?.startsWith('#cite-')) {
                                            const index = parseInt(href.replace('#cite-', ''), 10)
                                            const citation = citationMap.get(index)
                                            if (citation) return <CitationMark citation={citation} />
                                            return <>{children}</>
                                        }
                                        if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:') && agentId) {
                                            return (
                                                <span className="file-link-group">
                                                    <span className="file-link-name">{children}</span>
                                                </span>
                                            )
                                        }
                                        return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
                                    }
                                }}
                            >
                                {displayText}
                            </ReactMarkdown>
                        </div>
                    )}

                    {isUser && message.metadata?.attachedFiles && message.metadata.attachedFiles.length > 0 && (
                        <div className="file-capsules-container">
                            {message.metadata.attachedFiles.map((file, idx) => (
                                <FileCapsule
                                    key={`attached-${file.path}-${idx}`}
                                    filePath={file.path}
                                    fileName={file.name}
                                    fileExt={file.ext}
                                    agentId={agentId}
                                    userId={userId}
                                />
                            ))}
                        </div>
                    )}

                    {!isUser && showFileCapsules && outputFiles.length > 0 && (
                        <div className="file-capsules-container">
                            {outputFiles.map((file, idx) => (
                                <FileCapsule
                                    key={`${file.path}-${idx}`}
                                    filePath={file.path}
                                    fileName={file.name}
                                    fileExt={file.ext}
                                    agentId={agentId}
                                    userId={userId}
                                />
                            ))}
                        </div>
                    )}

                    {shouldShowCitedReferences && displayText && (
                        <ReferenceList citations={citations} label="本轮引用过的资料" />
                    )}

                    {shouldShowRetrievedReferences && displayText && (
                        <ReferenceList citations={retrievedDocuments} label="本轮检索过的资料" />
                    )}

                    {isStreaming && (
                        <div className="streaming-indicator">
                            <div className="loading-dots">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default memo(MessageInner)

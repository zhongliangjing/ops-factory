import { useCallback, useReducer, useRef, useEffect, useState } from 'react'
import { GoosedClient } from '@goosed/sdk'
import type { TokenState, ImageData, OutputFile } from '@goosed/sdk'
import { ChatMessage, MessageContent, type AttachedFile } from '../components/Message'

// ── ChatState enum ──────────────────────────────────────────────
export enum ChatState {
    Idle = 'idle',
    Streaming = 'streaming',
    Thinking = 'thinking',
    Compacting = 'compacting',
    Errored = 'errored',
}

// ── Reducer state & actions ─────────────────────────────────────
interface StreamState {
    messages: ChatMessage[]
    chatState: ChatState
    error: string | null
    tokenState: TokenState | null
}

type StreamAction =
    | { type: 'SET_MESSAGES'; payload: ChatMessage[] }
    | { type: 'SET_CHAT_STATE'; payload: ChatState }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'SET_TOKEN_STATE'; payload: TokenState }
    | { type: 'START_STREAMING' }
    | { type: 'STREAM_FINISH'; error?: string }

const initialState: StreamState = {
    messages: [],
    chatState: ChatState.Idle,
    error: null,
    tokenState: null,
}

function streamReducer(state: StreamState, action: StreamAction): StreamState {
    switch (action.type) {
        case 'SET_MESSAGES':
            return { ...state, messages: action.payload }
        case 'SET_CHAT_STATE':
            return { ...state, chatState: action.payload }
        case 'SET_ERROR':
            return { ...state, error: action.payload }
        case 'SET_TOKEN_STATE':
            return { ...state, tokenState: action.payload }
        case 'START_STREAMING':
            return { ...state, chatState: ChatState.Streaming, error: null }
        case 'STREAM_FINISH':
            return {
                ...state,
                chatState: action.error ? ChatState.Errored : ChatState.Idle,
                error: action.error ?? state.error,
            }
        default:
            return state
    }
}

// ── Helpers ─────────────────────────────────────────────────────

interface UseChatOptions {
    sessionId: string | null
    client: GoosedClient
}

export interface OutputFilesEvent {
    sessionId: string
    files: OutputFile[]
}

export interface UseChatReturn {
    messages: ChatMessage[]
    chatState: ChatState
    isLoading: boolean
    error: string | null
    tokenState: TokenState | null
    outputFilesEvent: OutputFilesEvent | null
    sendMessage: (text: string, images?: ImageData[], attachedFiles?: AttachedFile[]) => Promise<void>
    stopMessage: () => Promise<boolean>
    clearMessages: () => void
    setInitialMessages: (msgs: ChatMessage[]) => void
}

/**
 * Detect thinking blocks in message text (e.g. <think>…</think>).
 * Used to switch ChatState to Thinking while the model is reasoning.
 */
function hasThinkingContent(msg: ChatMessage): boolean {
    return msg.content.some(
        c => c.type === 'text' && c.text && /<think>/i.test(c.text) && !/<\/think>/i.test(c.text)
    )
}

/**
 * Detect compaction system notifications.
 */
function hasCompactingContent(msg: ChatMessage): boolean {
    return msg.content.some(
        c =>
            (c as unknown as Record<string, unknown>).type === 'systemNotification' &&
            (c as unknown as Record<string, unknown>).notificationType === 'compactingMessage'
    )
}

/**
 * Push or update a message in the messages array.
 * Mirrors the desktop's pushMessage logic:
 * - Same ID as last message → update in place
 *   - text + text with single content item → accumulate (append)
 *   - otherwise → push to content array
 * - Different ID → append new message
 */
function pushMessage(currentMessages: ChatMessage[], incomingMsg: ChatMessage): ChatMessage[] {
    const lastMsg = currentMessages[currentMessages.length - 1]

    if (lastMsg?.id && lastMsg.id === incomingMsg.id) {
        const lastContent = lastMsg.content[lastMsg.content.length - 1]
        const newContent = incomingMsg.content[incomingMsg.content.length - 1]

        if (
            lastContent?.type === 'text' &&
            newContent?.type === 'text' &&
            incomingMsg.content.length === 1
        ) {
            lastContent.text = (lastContent.text || '') + (newContent.text || '')
        } else {
            lastMsg.content.push(...incomingMsg.content)
        }
        return [...currentMessages]
    } else {
        return [...currentMessages, incomingMsg]
    }
}

/**
 * Convert backend message format to ChatMessage format.
 */
function convertBackendMessage(msg: Record<string, unknown>): ChatMessage {
    const metadata = msg.metadata as { userVisible?: boolean; agentVisible?: boolean } | undefined
    return {
        id: (msg.id as string) || `msg-${Date.now()}-${Math.random()}`,
        role: (msg.role as 'user' | 'assistant') || 'assistant',
        content: (msg.content as MessageContent[]) || [],
        created: (msg.created as number) || Math.floor(Date.now() / 1000),
        metadata: metadata,
    }
}

// ── Hook ────────────────────────────────────────────────────────

export function useChat({ sessionId, client }: UseChatOptions): UseChatReturn {
    const [state, dispatch] = useReducer(streamReducer, initialState)

    const messagesRef = useRef<ChatMessage[]>([])
    const isStreamingRef = useRef(false)
    const abortControllerRef = useRef<AbortController | null>(null)
    const streamErrorRef = useRef<string | null>(null)
    const [outputFilesEvent, setOutputFilesEvent] = useState<OutputFilesEvent | null>(null)

    // Track mounted state
    const isMountedRef = useRef(true)
    useEffect(() => {
        isMountedRef.current = true
        return () => { isMountedRef.current = false }
    }, [])

    // Keep messagesRef in sync
    useEffect(() => {
        messagesRef.current = state.messages
    }, [state.messages])

    const setInitialMessages = useCallback((msgs: ChatMessage[]) => {
        dispatch({ type: 'SET_MESSAGES', payload: msgs })
    }, [])

    const sendMessage = useCallback(async (text: string, images?: ImageData[], attachedFiles?: AttachedFile[]) => {
        if (!sessionId || isStreamingRef.current) return
        if (!text.trim() && (!images || images.length === 0) && (!attachedFiles || attachedFiles.length === 0)) return

        dispatch({ type: 'START_STREAMING' })
        isStreamingRef.current = true
        streamErrorRef.current = null

        // Create an AbortController so we can cancel the HTTP connection
        const controller = new AbortController()
        abortControllerRef.current = controller

        // Build the API text: append full server paths so the agent can process files
        let apiText = text.trim()
        if (attachedFiles && attachedFiles.length > 0) {
            const serverPaths = attachedFiles
                .map(f => f.serverPath)
                .filter((p): p is string => !!p)
            if (serverPaths.length > 0) {
                apiText = apiText
                    ? `${apiText} ${serverPaths.join(' ')}`
                    : serverPaths.join(' ')
            }
        }

        // Build user message content (clean text + images — no file paths)
        const userContent: MessageContent[] = []
        if (text.trim()) {
            userContent.push({ type: 'text', text: text.trim() })
        }
        if (images && images.length > 0) {
            for (const img of images) {
                userContent.push({ type: 'image', data: img.data, mimeType: img.mimeType } as MessageContent)
            }
        }

        // Add user message immediately (clean text, file metadata separate)
        const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: userContent,
            created: Math.floor(Date.now() / 1000),
            ...(attachedFiles && attachedFiles.length > 0 ? { metadata: { attachedFiles } } : {}),
        }

        let currentMessages = [...messagesRef.current, userMessage]
        dispatch({ type: 'SET_MESSAGES', payload: currentMessages })

        try {
            for await (const event of client.sendMessage(sessionId, apiText, images)) {
                if (!isMountedRef.current || controller.signal.aborted) break

                switch (event.type) {
                    case 'Message': {
                        if (!event.message) break
                        const incomingMessage = convertBackendMessage(event.message as Record<string, unknown>)
                        currentMessages = pushMessage(currentMessages, incomingMessage)
                        dispatch({ type: 'SET_MESSAGES', payload: currentMessages })

                        // Update token state
                        if (event.token_state) {
                            dispatch({ type: 'SET_TOKEN_STATE', payload: event.token_state })
                        }

                        // Determine chat sub-state from message content
                        if (hasCompactingContent(incomingMessage)) {
                            dispatch({ type: 'SET_CHAT_STATE', payload: ChatState.Compacting })
                        } else if (hasThinkingContent(incomingMessage)) {
                            dispatch({ type: 'SET_CHAT_STATE', payload: ChatState.Thinking })
                        } else {
                            dispatch({ type: 'SET_CHAT_STATE', payload: ChatState.Streaming })
                        }
                        break
                    }

                    case 'UpdateConversation': {
                        // Context compaction: backend sends entire replacement conversation
                        if (event.conversation && Array.isArray(event.conversation)) {
                            currentMessages = event.conversation.map(msg =>
                                convertBackendMessage(msg as Record<string, unknown>)
                            )
                            dispatch({ type: 'SET_MESSAGES', payload: currentMessages })
                        }
                        break
                    }

                    case 'Finish': {
                        // Stream completed. Capture final token state.
                        if (event.token_state) {
                            dispatch({ type: 'SET_TOKEN_STATE', payload: event.token_state })
                        }
                        break
                    }

                    case 'Error': {
                        const errorMsg = event.error || 'Unknown error occurred'
                        streamErrorRef.current = errorMsg
                        dispatch({ type: 'SET_ERROR', payload: errorMsg })
                        break
                    }

                    case 'OutputFiles': {
                        // Gateway detected new/modified files after this reply
                        if (event.files && event.files.length > 0 && event.sessionId) {
                            setOutputFilesEvent({
                                sessionId: event.sessionId,
                                files: event.files,
                            })
                        }
                        break
                    }

                    case 'ModelChange':
                    case 'Notification':
                    case 'Ping':
                        // Acknowledged but no action needed for now
                        break
                }
            }
        } catch (err) {
            if (isMountedRef.current && !(err instanceof DOMException && err.name === 'AbortError')) {
                const errorMsg = err instanceof Error ? err.message : 'Failed to send message'
                streamErrorRef.current = errorMsg
                dispatch({ type: 'SET_ERROR', payload: errorMsg })
            }
        } finally {
            if (isMountedRef.current) {
                dispatch({ type: 'STREAM_FINISH', error: streamErrorRef.current ?? undefined })
                isStreamingRef.current = false
                abortControllerRef.current = null
            }
        }
    }, [client, sessionId])

    const stopMessage = useCallback(async (): Promise<boolean> => {
        if (!sessionId || !isStreamingRef.current) return false

        // Abort the SSE connection immediately
        abortControllerRef.current?.abort()
        isStreamingRef.current = false
        dispatch({ type: 'STREAM_FINISH' })

        try {
            await client.stopSession(sessionId)
            return true
        } catch (err) {
            if (isMountedRef.current) {
                dispatch({ type: 'SET_ERROR', payload: err instanceof Error ? err.message : 'Failed to stop message' })
            }
            return false
        }
    }, [client, sessionId])

    const clearMessages = useCallback(() => {
        dispatch({ type: 'SET_MESSAGES', payload: [] })
        dispatch({ type: 'SET_ERROR', payload: null })
    }, [])

    return {
        messages: state.messages,
        chatState: state.chatState,
        isLoading: state.chatState === ChatState.Streaming || state.chatState === ChatState.Thinking || state.chatState === ChatState.Compacting,
        error: state.error,
        tokenState: state.tokenState,
        outputFilesEvent,
        sendMessage,
        stopMessage,
        clearMessages,
        setInitialMessages,
    }
}

export { convertBackendMessage }

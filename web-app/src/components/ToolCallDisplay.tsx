import { useState } from 'react'
import UIResourceRenderer, { isUIResource } from './UIResourceRenderer'

// Type for embedded resource content
interface EmbeddedResource {
    resource: {
        uri: string
        mimeType?: string
        text?: string
        blob?: string
    }
}

// Content item from tool result
interface ContentItem {
    type?: string
    text?: string
    resource?: {
        uri: string
        mimeType?: string
        text?: string
        blob?: string
    }
    annotations?: {
        audience?: string[]
    }
}

// Tool result structure
interface ToolResultValue {
    content?: ContentItem[]
}

interface ToolCallDisplayProps {
    name: string
    args?: Record<string, unknown>
    result?: unknown
    isError?: boolean
    isPending?: boolean
}

// Extract content items from tool result, filtering by audience
function getToolResultContent(toolResult: unknown): ContentItem[] {
    if (!toolResult || typeof toolResult !== 'object') return []

    const result = toolResult as ToolResultValue
    if (!result.content || !Array.isArray(result.content)) return []

    return result.content.filter((item) => {
        const annotations = item.annotations
        return !annotations?.audience || annotations.audience.includes('user')
    })
}

// Extract UI resources from tool result content
function extractUIResources(result: unknown): EmbeddedResource[] {
    const content = getToolResultContent(result)
    const uiResources: EmbeddedResource[] = []

    for (const item of content) {
        if (item.resource && isUIResource({ resource: item.resource })) {
            uiResources.push({ resource: item.resource })
        }
    }

    return uiResources
}

export default function ToolCallDisplay({
    name,
    args,
    result,
    isError = false,
    isPending = false
}: ToolCallDisplayProps) {
    const [showDetails, setShowDetails] = useState(false)
    const [showOutput, setShowOutput] = useState(false)

    const statusClass = isPending ? 'pending' : isError ? 'error' : 'success'
    const displayName = formatToolName(name)

    // Extract UI resources from result
    const uiResources = result !== undefined ? extractUIResources(result) : []
    const hasUIResources = uiResources.length > 0

    return (
        <>
            <div className="tool-call">
                {/* Main Header - Tool Name (always visible, no collapse) */}
                <div className="tool-call-header">
                    <span className={`tool-call-indicator ${statusClass}`} aria-hidden="true" />
                    <span className="tool-call-name">{displayName}</span>
                </div>

                <div className="tool-call-body">
                    {/* Tool Details Section */}
                    {args && Object.keys(args).length > 0 && (
                        <div className="tool-call-section">
                            <div
                                className="tool-call-section-header"
                                onClick={() => setShowDetails(!showDetails)}
                            >
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    className={`tool-call-chevron ${showDetails ? 'open' : ''}`}
                                >
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                                <span className="tool-call-section-title">Tool Details</span>
                            </div>
                            {showDetails && (
                                <div className="tool-call-section-content">
                                    {Object.entries(args).map(([key, value]) => (
                                        <div key={key} className="tool-call-kv">
                                            <span className="tool-call-kv-key">{key}</span>
                                            <span className="tool-call-kv-value">
                                                {typeof value === 'string' ? value : JSON.stringify(value)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Output Section - only show if no UI resources (they'll be shown separately) */}
                    {result !== undefined && !hasUIResources && (
                        <div className="tool-call-section">
                            <div
                                className="tool-call-section-header"
                                onClick={() => setShowOutput(!showOutput)}
                            >
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    className={`tool-call-chevron ${showOutput ? 'open' : ''}`}
                                >
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                                <span className="tool-call-section-title">Output</span>
                            </div>
                            {showOutput && (
                                <div className="tool-call-section-content">
                                    <pre className="tool-call-output">
                                        {formatResult(result)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Pending indicator */}
                    {isPending && (
                        <div className="tool-call-running">
                            <span className="loading-dots">
                                <span></span>
                                <span></span>
                                <span></span>
                            </span>
                            <span>Running...</span>
                        </div>
                    )}
                </div>
            </div>

            {/* UI Resources - rendered as visualizations below the tool call box */}
            {uiResources.map((resource, index) => (
                <UIResourceRenderer
                    key={index}
                    resource={resource.resource}
                />
            ))}
        </>
    )
}

function formatToolName(name: string): string {
    // Convert tool__action format to readable format
    // e.g., "developer__text_editor" -> "developer › text editor"
    const parts = name.split('__')
    if (parts.length > 1) {
        // Get the action part and make it readable
        const action = parts[parts.length - 1].replace(/_/g, ' ')
        return action.charAt(0).toUpperCase() + action.slice(1)
    }
    return name.replace(/_/g, ' ')
}

const MAX_RESULT_LENGTH = 50_000 // 50KB cap to prevent browser freeze on large blobs

function formatResult(result: unknown): string {
    if (typeof result === 'string') {
        return result.length > MAX_RESULT_LENGTH
            ? result.slice(0, MAX_RESULT_LENGTH) + '\n... [truncated]'
            : result
    }
    if (Array.isArray(result)) {
        // If it's an array of content items (like from tool response)
        return result.map(item => {
            if (typeof item === 'object' && item !== null) {
                if ('text' in item) return (item as { text: string }).text
                if ('type' in item && item.type === 'text' && 'text' in item) {
                    return (item as { text: string }).text
                }
            }
            return JSON.stringify(item, null, 2)
        }).join('\n')
    }
    const serialized = JSON.stringify(result, null, 2)
    return serialized.length > MAX_RESULT_LENGTH
        ? serialized.slice(0, MAX_RESULT_LENGTH) + '\n... [truncated]'
        : serialized
}

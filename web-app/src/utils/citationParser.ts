/**
 * Citation parsing utility.
 *
 * Citation format:
 *   {{cite:INDEX|TITLE|CHUNK_ID|SOURCE_ID|PAGE_LABEL|SNIPPET|URL}}
 */

export interface Citation {
    index: number
    title: string
    documentId?: string | null
    chunkId: string | null
    sourceId: string | null
    pageLabel: string | null
    snippet: string | null
    url: string | null
}

const CITE_REGEX = /\{\{cite:([^}]*)\}\}/g

function sanitizeField(value: string | undefined): string | null {
    const trimmed = (value || '').trim()
    return trimmed.length > 0 ? trimmed : null
}

function parseCitationBody(body: string, fallbackIndex: number): Citation | null {
    const trimmed = body.trim()
    if (/^chk_[a-zA-Z0-9]+$/.test(trimmed)) {
        return {
            index: fallbackIndex,
            title: trimmed,
            documentId: null,
            chunkId: trimmed,
            sourceId: null,
            pageLabel: null,
            snippet: null,
            url: null,
        }
    }

    const parts = body.split('|').map(part => part.trim())
    if (parts.length < 6) return null

    const index = parseInt(parts[0], 10)
    if (!Number.isFinite(index)) return null

    return {
        index,
        title: parts[1] || `Citation ${index}`,
        documentId: null,
        chunkId: sanitizeField(parts[2]),
        sourceId: sanitizeField(parts[3]),
        pageLabel: sanitizeField(parts[4]),
        snippet: sanitizeField(parts[5]),
        url: sanitizeField(parts[6]),
    }
}

export function parseCitations(text: string): Citation[] {
    const map = new Map<number, Citation>()
    let match: RegExpExecArray | null
    const re = new RegExp(CITE_REGEX.source, CITE_REGEX.flags)
    let fallbackIndex = 1

    while ((match = re.exec(text)) !== null) {
        const citation = parseCitationBody(match[1], fallbackIndex)
        if (citation && !map.has(citation.index)) {
            map.set(citation.index, citation)
            fallbackIndex = Math.max(fallbackIndex, citation.index + 1)
        }
    }

    return Array.from(map.values()).sort((a, b) => a.index - b.index)
}

export function hasCitations(text: string): boolean {
    return new RegExp(CITE_REGEX.source).test(text)
}

export type TextSegment = { type: 'text'; value: string } | { type: 'cite'; citation: Citation }

export function splitByCitations(text: string): TextSegment[] {
    const segments: TextSegment[] = []
    const re = new RegExp(CITE_REGEX.source, CITE_REGEX.flags)
    let lastIndex = 0
    let match: RegExpExecArray | null
    let fallbackIndex = 1

    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
        }

        const citation = parseCitationBody(match[1], fallbackIndex)
        if (citation) {
            segments.push({ type: 'cite', citation })
            fallbackIndex = Math.max(fallbackIndex, citation.index + 1)
        }

        lastIndex = re.lastIndex
    }

    if (lastIndex < text.length) {
        segments.push({ type: 'text', value: text.slice(lastIndex) })
    }

    return segments
}

export function stripCitations(text: string): string {
    return text.replace(new RegExp(CITE_REGEX.source, CITE_REGEX.flags), '')
}

export function replaceCitationsWithPlaceholders(text: string): string {
    let fallbackIndex = 1
    return text.replace(new RegExp(CITE_REGEX.source, CITE_REGEX.flags), (_, body: string) => {
        const citation = parseCitationBody(body, fallbackIndex)
        if (citation) {
            fallbackIndex = Math.max(fallbackIndex, citation.index + 1)
        }
        return citation ? `[CITE_${citation.index}](#cite-${citation.index})` : ''
    })
}

interface MessageContentItem {
    type: string
    id?: string
    toolCall?: {
        value?: {
            name?: string
            arguments?: Record<string, unknown>
        }
    }
    toolResult?: {
        status?: string
        value?: unknown
    }
}

function unwrapToolResult(value: unknown): unknown {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value)
        } catch {
            return value
        }
    }

    const obj = value as Record<string, unknown>
    if (Array.isArray(obj?.content)) {
        for (const item of obj.content) {
            const ci = item as Record<string, unknown>
            if (ci.type === 'text' && typeof ci.text === 'string') {
                try {
                    return JSON.parse(ci.text)
                } catch {
                    return ci.text
                }
            }
        }
    }

    return value
}

export function extractSourceDocuments(messages: { content: MessageContentItem[] }[]): Citation[] {
    const toolNames = new Map<string, string>()
    const searchHits = new Map<string, Citation>()
    const fetchHits = new Map<string, Citation>()

    for (const msg of messages) {
        for (const content of msg.content) {
            if (content.type === 'toolRequest' && content.id) {
                const name = content.toolCall?.value?.name || ''
                toolNames.set(content.id, name)
            }

            if (content.type === 'toolResponse' && content.id) {
                const name = toolNames.get(content.id) || ''
                const value = content.toolResult?.status === 'success' ? content.toolResult.value : null
                if (!value) continue

                const data = unwrapToolResult(value) as Record<string, unknown>

                if (/search/i.test(name)) {
                    const hits = Array.isArray(data?.hits) ? data.hits : []
                    for (const hit of hits) {
                        const record = hit as Record<string, unknown>
                        const chunkId = typeof record.chunkId === 'string' ? record.chunkId : null
                        if (!chunkId) continue

                        searchHits.set(chunkId, {
                            index: 0,
                            title: typeof record.title === 'string' && record.title.trim() ? record.title : chunkId,
                            documentId: typeof record.documentId === 'string' ? record.documentId : null,
                            chunkId,
                            sourceId: typeof record.sourceId === 'string' ? record.sourceId : null,
                            pageLabel: buildPageLabel(record.pageFrom, record.pageTo),
                            snippet: typeof record.snippet === 'string' ? record.snippet : null,
                            url: null,
                        })
                    }
                }

                if (/fetch/i.test(name) && !/search/i.test(name)) {
                    const chunkId = typeof data?.chunkId === 'string' ? data.chunkId : null
                    if (!chunkId) continue

                    const text = typeof data?.text === 'string' ? data.text : ''
                    fetchHits.set(chunkId, {
                        index: 0,
                        title: typeof data?.title === 'string' && data.title.trim() ? data.title : chunkId,
                        documentId: typeof data?.documentId === 'string' ? data.documentId : null,
                        chunkId,
                        sourceId: typeof data?.sourceId === 'string' ? data.sourceId : null,
                        pageLabel: buildPageLabel(data?.pageFrom, data?.pageTo),
                        snippet: text ? text.slice(0, 180).trim() : null,
                        url: null,
                    })
                }
            }
        }
    }

    const merged = new Map<string, Citation>()
    for (const [chunkId, citation] of searchHits.entries()) {
        merged.set(chunkId, citation)
    }
    for (const [chunkId, citation] of fetchHits.entries()) {
        const existing = merged.get(chunkId)
        merged.set(chunkId, {
            ...citation,
            documentId: citation.documentId || existing?.documentId || null,
            title: existing?.title || citation.title,
            snippet: citation.snippet || existing?.snippet || null,
            sourceId: citation.sourceId || existing?.sourceId || null,
            pageLabel: citation.pageLabel || existing?.pageLabel || null,
        })
    }

    return Array.from(merged.values()).map((citation, index) => ({ ...citation, index: index + 1 }))
}

export function extractFetchedDocuments(messages: { content: MessageContentItem[] }[]): Citation[] {
    const toolNames = new Map<string, string>()
    const fetchHits = new Map<string, Citation>()

    for (const msg of messages) {
        for (const content of msg.content) {
            if (content.type === 'toolRequest' && content.id) {
                const name = content.toolCall?.value?.name || ''
                toolNames.set(content.id, name)
            }

            if (content.type !== 'toolResponse' || !content.id) {
                continue
            }

            const name = toolNames.get(content.id) || ''
            if (!/fetch/i.test(name) || /search/i.test(name)) {
                continue
            }

            const value = content.toolResult?.status === 'success' ? content.toolResult.value : null
            if (!value) continue

            const data = unwrapToolResult(value) as Record<string, unknown>
            const chunkId = typeof data?.chunkId === 'string' ? data.chunkId : null
            if (!chunkId) continue

            const text = typeof data?.text === 'string' ? data.text : ''
            fetchHits.set(chunkId, {
                index: 0,
                title: typeof data?.title === 'string' && data.title.trim() ? data.title : chunkId,
                documentId: typeof data?.documentId === 'string' ? data.documentId : null,
                chunkId,
                sourceId: typeof data?.sourceId === 'string' ? data.sourceId : null,
                pageLabel: buildPageLabel(data?.pageFrom, data?.pageTo),
                snippet: text ? text.slice(0, 180).trim() : null,
                url: null,
            })
        }
    }

    return Array.from(fetchHits.values()).map((citation, index) => ({ ...citation, index: index + 1 }))
}

function buildPageLabel(pageFrom: unknown, pageTo: unknown): string | null {
    const from = typeof pageFrom === 'number' ? pageFrom : null
    const to = typeof pageTo === 'number' ? pageTo : null

    if (from == null && to == null) return null
    if (from != null && to != null) {
        return from === to ? `${from}` : `${from}-${to}`
    }
    return `${from ?? to}`
}

export function mergeCitationMetadata(citations: Citation[], sourceDocuments: Citation[]): Citation[] {
    const sourceByChunkId = new Map(
        sourceDocuments
            .filter(citation => citation.chunkId)
            .map(citation => [citation.chunkId as string, citation]),
    )

    return citations.map(citation => {
        if (!citation.chunkId) return citation
        const source = sourceByChunkId.get(citation.chunkId)
        if (!source) return citation
        return {
            ...citation,
            documentId: citation.documentId || source.documentId || null,
            title: citation.title === citation.chunkId && source.title ? source.title : citation.title,
            sourceId: citation.sourceId || source.sourceId,
            pageLabel: citation.pageLabel || source.pageLabel,
            snippet: citation.snippet || source.snippet,
            url: citation.url || source.url,
        }
    })
}

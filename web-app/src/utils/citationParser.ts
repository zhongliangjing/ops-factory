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

interface ParsedCitationToken {
    citation: Citation
    identityKey: string
}

function parseCitationBody(body: string, fallbackIndex: number): ParsedCitationToken | null {
    const trimmed = body.trim()
    if (/^chk_[a-zA-Z0-9]+$/.test(trimmed)) {
        return {
            identityKey: `chunk:${trimmed}`,
            citation: {
                index: fallbackIndex,
                title: trimmed,
                documentId: null,
                chunkId: trimmed,
                sourceId: null,
                pageLabel: null,
                snippet: null,
                url: null,
            },
        }
    }

    const parts = body.split('|').map(part => part.trim())
    if (parts.length < 6) return null

    const index = parseInt(parts[0], 10)
    if (!Number.isFinite(index)) return null

    return {
        identityKey: `index:${index}`,
        citation: {
            index,
            title: parts[1] || `Citation ${index}`,
            documentId: null,
            chunkId: sanitizeField(parts[2]),
            sourceId: sanitizeField(parts[3]),
            pageLabel: sanitizeField(parts[4]),
            snippet: sanitizeField(parts[5]),
            url: sanitizeField(parts[6]),
        },
    }
}

function getDisplayCitation(
    token: ParsedCitationToken,
    displayCitations: Map<string, Citation>,
): Citation {
    const existing = displayCitations.get(token.identityKey)
    if (existing) {
        return existing
    }

    const displayCitation = {
        ...token.citation,
        index: displayCitations.size + 1,
    }
    displayCitations.set(token.identityKey, displayCitation)
    return displayCitation
}

export function parseCitations(text: string): Citation[] {
    const displayCitations = new Map<string, Citation>()
    let match: RegExpExecArray | null
    const re = new RegExp(CITE_REGEX.source, CITE_REGEX.flags)
    let fallbackIndex = 1

    while ((match = re.exec(text)) !== null) {
        const token = parseCitationBody(match[1], fallbackIndex)
        if (token) {
            getDisplayCitation(token, displayCitations)
            fallbackIndex = Math.max(fallbackIndex, token.citation.index + 1)
        }
    }

    return Array.from(displayCitations.values())
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
    const displayCitations = new Map<string, Citation>()

    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
        }

        const token = parseCitationBody(match[1], fallbackIndex)
        if (token) {
            const citation = getDisplayCitation(token, displayCitations)
            segments.push({ type: 'cite', citation })
            fallbackIndex = Math.max(fallbackIndex, token.citation.index + 1)
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
    const displayCitations = new Map<string, Citation>()
    return text.replace(new RegExp(CITE_REGEX.source, CITE_REGEX.flags), (_, body: string) => {
        const token = parseCitationBody(body, fallbackIndex)
        if (token) {
            const citation = getDisplayCitation(token, displayCitations)
            fallbackIndex = Math.max(fallbackIndex, token.citation.index + 1)
            return `[CITE_${citation.index}](#cite-${citation.index})`
        }
        return ''
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
    return citations.map(citation => {
        const source = resolveCitationEvidence(citation, sourceDocuments)
        if (!source) return citation
        return {
            ...citation,
            documentId: source.documentId || citation.documentId || null,
            chunkId: source.chunkId || citation.chunkId || null,
            title: source.title || citation.title,
            sourceId: source.sourceId || citation.sourceId,
            pageLabel: source.pageLabel || citation.pageLabel,
            snippet: source.snippet || citation.snippet,
            url: source.url || citation.url,
        }
    })
}

function resolveCitationEvidence(citation: Citation, sourceDocuments: Citation[]): Citation | null {
    if (sourceDocuments.length === 0) return null

    const normalizedCitationTitle = normalizeCitationText(citation.title)
    const normalizedCitationSnippet = normalizeCitationText(citation.snippet)
    const hasTitle = normalizedCitationTitle.length > 0
    const hasSnippet = normalizedCitationSnippet.length > 0

    return sourceDocuments.find(source => {
        const sameChunkId = citation.chunkId && source.chunkId === citation.chunkId
        if (sameChunkId) return true

        const sourceTitle = normalizeCitationText(source.title)
        const sourceSnippet = normalizeCitationText(source.snippet)
        const sameTitle = hasTitle && normalizedCitationTitle === sourceTitle
        const samePage = matchesPageLabel(citation.pageLabel, source.pageLabel)

        if (sameTitle && samePage && hasSnippet && normalizedCitationSnippet === sourceSnippet) {
            return true
        }

        if (sameTitle && snippetsOverlap(normalizedCitationSnippet, sourceSnippet)) {
            return true
        }

        if (citation.documentId && citation.documentId === source.documentId && samePage) {
            return true
        }

        return sameTitle && samePage
    }) || null
}

function normalizeCitationText(value: string | null | undefined): string {
    return (value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
}

function matchesPageLabel(left: string | null, right: string | null): boolean {
    if (!left || !right) return false
    return left === right
}

function snippetsOverlap(left: string, right: string): boolean {
    if (!left || !right) return false
    return left.includes(right) || right.includes(left)
}

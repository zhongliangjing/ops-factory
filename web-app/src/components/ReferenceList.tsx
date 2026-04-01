import { useCallback, useState } from 'react'
import { KNOWLEDGE_SERVICE_URL } from '../config/runtime'
import { usePreview } from '../contexts/PreviewContext'
import type { Citation } from '../utils/citationParser'

interface ReferenceListProps {
    citations: Citation[]
    label?: string
    variant?: 'cited' | 'retrieved'
}

interface ReferenceGroup {
    key: string
    documentId: string
    title: string
    citationCount: number
    citationIndices: number[]
    pageLabels: string[]
}

function buildReferenceKey(citation: Citation): string {
    return `doc:${citation.documentId}`
}

async function loadDocumentPreview(documentId: string) {
    const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/documents/${documentId}/preview`)
    const data = await response.json().catch(() => null) as { title?: string; markdownPreview?: string; message?: string } | null

    if (!response.ok || !data?.markdownPreview) {
        throw new Error(data?.message || response.statusText)
    }

    return data
}

function groupReferences(citations: Citation[]): ReferenceGroup[] {
    const groups: ReferenceGroup[] = []
    const groupsByKey = new Map<string, ReferenceGroup>()

    for (const citation of citations) {
        if (!citation.documentId) continue

        const key = buildReferenceKey(citation)
        const existing = groupsByKey.get(key)
        if (existing) {
            existing.citationCount += 1
            if (!existing.citationIndices.includes(citation.index)) {
                existing.citationIndices.push(citation.index)
            }
            if (citation.pageLabel && !existing.pageLabels.includes(citation.pageLabel)) {
                existing.pageLabels.push(citation.pageLabel)
            }
            continue
        }

        const group: ReferenceGroup = {
            key,
            documentId: citation.documentId,
            title: citation.title,
            citationCount: 1,
            citationIndices: [citation.index],
            pageLabels: citation.pageLabel ? [citation.pageLabel] : [],
        }
        groupsByKey.set(key, group)
        groups.push(group)
    }

    return groups
}

export default function ReferenceList({
    citations,
    label = '本轮检索过的资料',
    variant = 'retrieved',
}: ReferenceListProps) {
    if (citations.length === 0) return null
    const { openPreview } = usePreview()
    const [openingKey, setOpeningKey] = useState<string | null>(null)

    const handlePreview = useCallback(async (group: ReferenceGroup) => {
        setOpeningKey(group.key)
        try {
            const previewPath = `knowledge-document:${group.documentId}`
            await openPreview({
                name: group.title,
                path: previewPath,
                type: 'md',
                content: '',
                previewKind: 'markdown',
            })

            const data = await loadDocumentPreview(group.documentId)

            await openPreview({
                name: data.title || group.title,
                path: previewPath,
                type: 'md',
                content: data.markdownPreview,
                previewKind: 'markdown',
            })
        } finally {
            setOpeningKey(null)
        }
    }, [openPreview])

    const groups = groupReferences(citations)

    if (groups.length === 0) return null

    return (
        <div className="reference-list">
            <div className="reference-list-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                {label} ({groups.length})
            </div>
            <div className="reference-capsules">
                {groups.map((group) => (
                    <button
                        key={group.key}
                        className="reference-capsule linked"
                        type="button"
                        onClick={() => void handlePreview(group)}
                        disabled={openingKey === group.key}
                    >
                        {variant === 'cited' ? (
                            <span className="reference-capsule-indices" aria-label={`引用序号 ${group.citationIndices.join(', ')}`}>
                                {group.citationIndices.map(index => (
                                    <span key={index} className="reference-capsule-index">{index}</span>
                                ))}
                            </span>
                        ) : null}
                        <span className="reference-capsule-title">{group.title}</span>
                        <span className="reference-capsule-meta">
                            {variant === 'cited' ? `${group.citationCount} 处引用` : `${group.citationCount} chunks`}
                            {group.pageLabels.length > 0 ? ` · p.${group.pageLabels.join(', ')}` : ''}
                        </span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                    </button>
                ))}
            </div>
        </div>
    )
}

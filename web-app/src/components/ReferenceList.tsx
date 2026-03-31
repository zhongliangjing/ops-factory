import { useCallback, useState } from 'react'
import { KNOWLEDGE_SERVICE_URL } from '../config/runtime'
import { usePreview } from '../contexts/PreviewContext'
import type { Citation } from '../utils/citationParser'

interface ReferenceListProps {
    citations: Citation[]
    label?: string
}

interface ReferenceGroup {
    key: string
    documentId: string
    title: string
    citationCount: number
    pageLabels: string[]
}

function buildReferenceKey(citation: Citation): string {
    return `doc:${citation.documentId}`
}

export default function ReferenceList({ citations, label = '本轮检索过的资料' }: ReferenceListProps) {
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

            const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/ops-knowledge/documents/${group.documentId}/preview`)
            const data = await response.json().catch(() => null) as { title?: string; markdownPreview?: string; message?: string } | null
            if (!response.ok || !data?.markdownPreview) {
                throw new Error(data?.message || response.statusText)
            }

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

    const groups: ReferenceGroup[] = []
    const groupsByKey = new Map<string, ReferenceGroup>()

    for (const citation of citations) {
        if (!citation.documentId) {
            continue
        }

        const key = buildReferenceKey(citation)
        const existing = groupsByKey.get(key)
        if (existing) {
            existing.citationCount += 1
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
            pageLabels: citation.pageLabel ? [citation.pageLabel] : [],
        }
        groupsByKey.set(key, group)
        groups.push(group)
    }

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
                        <span className="reference-capsule-index">{group.citationCount}</span>
                        <span className="reference-capsule-title">{group.title}</span>
                        <span className="reference-capsule-meta">
                            {group.citationCount} chunks
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

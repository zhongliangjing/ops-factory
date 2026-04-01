import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { KNOWLEDGE_SERVICE_URL } from '../config/runtime'
import type { Citation } from '../utils/citationParser'

interface CitationMarkProps {
    citation: Citation
}

interface CardStyle {
    left: number
    top: number
    width: number
}

const sourceNameCache = new Map<string, string>()

export default function CitationMark({ citation }: CitationMarkProps) {
    const [showCard, setShowCard] = useState(false)
    const [cardPosition, setCardPosition] = useState<'above' | 'below'>('above')
    const [cardStyle, setCardStyle] = useState<CardStyle | null>(null)
    const [sourceName, setSourceName] = useState<string | null>(citation.sourceId || null)
    const markRef = useRef<HTMLSpanElement>(null)
    const cardRef = useRef<HTMLDivElement>(null)
    const showTimeout = useRef<ReturnType<typeof setTimeout>>()
    const hideTimeout = useRef<ReturnType<typeof setTimeout>>()

    const updateCardPosition = useCallback((cardHeight = 0) => {
        if (!markRef.current) return

        const rect = markRef.current.getBoundingClientRect()
        const viewportPadding = 16
        const gap = 8
        const cardWidth = Math.min(360, window.innerWidth - viewportPadding * 2)
        const centerLeft = rect.left + rect.width / 2 - cardWidth / 2
        const left = Math.max(viewportPadding, Math.min(centerLeft, window.innerWidth - viewportPadding - cardWidth))
        const spaceAbove = rect.top - viewportPadding
        const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
        const shouldShowBelow = cardHeight > 0
            ? (spaceAbove < cardHeight + gap && spaceBelow > spaceAbove)
            : rect.top < 200
        const top = shouldShowBelow
            ? Math.min(rect.bottom + gap, window.innerHeight - viewportPadding - Math.max(cardHeight, 120))
            : Math.max(viewportPadding, rect.top - gap - cardHeight)

        setCardPosition(shouldShowBelow ? 'below' : 'above')
        setCardStyle({
            left,
            top,
            width: cardWidth,
        })
    }, [])

    const show = useCallback(() => {
        clearTimeout(hideTimeout.current)
        showTimeout.current = setTimeout(() => {
            updateCardPosition()
            setShowCard(true)
        }, 200)
    }, [updateCardPosition])

    const hide = useCallback(() => {
        clearTimeout(showTimeout.current)
        hideTimeout.current = setTimeout(() => setShowCard(false), 150)
    }, [])

    useEffect(() => {
        if (!showCard) return

        const handleViewportChange = () => updateCardPosition(cardRef.current?.offsetHeight || 0)
        window.addEventListener('scroll', handleViewportChange, true)
        window.addEventListener('resize', handleViewportChange)

        return () => {
            window.removeEventListener('scroll', handleViewportChange, true)
            window.removeEventListener('resize', handleViewportChange)
        }
    }, [showCard, updateCardPosition])

    useLayoutEffect(() => {
        if (!showCard || !cardRef.current) return
        updateCardPosition(cardRef.current.offsetHeight)
    }, [showCard, citation, updateCardPosition])

    useEffect(() => {
        return () => {
            clearTimeout(showTimeout.current)
            clearTimeout(hideTimeout.current)
        }
    }, [])

    useEffect(() => {
        if (!citation.sourceId) {
            setSourceName(null)
            return
        }

        const cached = sourceNameCache.get(citation.sourceId)
        if (cached) {
            setSourceName(cached)
            return
        }

        let cancelled = false
        fetch(`${KNOWLEDGE_SERVICE_URL}/sources/${citation.sourceId}`)
            .then(async response => {
                if (!response.ok) throw new Error(String(response.status))
                return response.json() as Promise<{ name?: string }>
            })
            .then(data => {
                const nextName = data.name?.trim() || citation.sourceId || ''
                sourceNameCache.set(citation.sourceId as string, nextName)
                if (!cancelled) setSourceName(nextName)
            })
            .catch(() => {
                if (!cancelled) setSourceName(citation.sourceId)
            })

        return () => {
            cancelled = true
        }
    }, [citation.sourceId])

    return (
        <span className="citation-mark-wrapper" ref={markRef}>
            <span
                className="citation-mark"
                onMouseEnter={show}
                onMouseLeave={hide}
            >
                {citation.index}
            </span>

            {showCard && cardStyle && createPortal(
                <div
                    ref={cardRef}
                    className={`citation-card ${cardPosition} is-portal`}
                    style={{
                        left: `${cardStyle.left}px`,
                        width: `${cardStyle.width}px`,
                        top: `${cardStyle.top}px`,
                    }}
                    onMouseEnter={show}
                    onMouseLeave={hide}
                >
                    <div className="citation-card-title">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span>{citation.title}</span>
                    </div>
                    <div className="citation-card-meta">
                        {sourceName ? (
                            <span className="citation-card-pill">{sourceName}</span>
                        ) : null}
                        {citation.chunkId ? (
                            <span className="citation-card-pill">Chunk {citation.chunkId}</span>
                        ) : null}
                        {citation.pageLabel ? (
                            <span className="citation-card-pill">Page {citation.pageLabel}</span>
                        ) : null}
                    </div>
                    {citation.snippet ? (
                        <div className="citation-card-snippet">{citation.snippet}</div>
                    ) : null}
                </div>,
                document.body,
            )}
        </span>
    )
}

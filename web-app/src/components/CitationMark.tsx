import { useState, useRef, useEffect, useCallback } from 'react'
import type { Citation } from '../utils/citationParser'

interface CitationMarkProps {
    citation: Citation
}

export default function CitationMark({ citation }: CitationMarkProps) {
    const [showCard, setShowCard] = useState(false)
    const [cardPosition, setCardPosition] = useState<'above' | 'below'>('above')
    const markRef = useRef<HTMLSpanElement>(null)
    const cardRef = useRef<HTMLDivElement>(null)
    const showTimeout = useRef<ReturnType<typeof setTimeout>>()
    const hideTimeout = useRef<ReturnType<typeof setTimeout>>()

    const show = useCallback(() => {
        clearTimeout(hideTimeout.current)
        showTimeout.current = setTimeout(() => {
            if (markRef.current) {
                const rect = markRef.current.getBoundingClientRect()
                setCardPosition(rect.top < 200 ? 'below' : 'above')
            }
            setShowCard(true)
        }, 200)
    }, [])

    const hide = useCallback(() => {
        clearTimeout(showTimeout.current)
        hideTimeout.current = setTimeout(() => setShowCard(false), 150)
    }, [])

    useEffect(() => {
        return () => {
            clearTimeout(showTimeout.current)
            clearTimeout(hideTimeout.current)
        }
    }, [])

    const handleClick = () => {
        if (citation.url) {
            window.open(citation.url, '_blank', 'noopener,noreferrer')
        }
    }

    return (
        <span className="citation-mark-wrapper" ref={markRef}>
            <span
                className={`citation-mark${citation.url ? ' clickable' : ''}`}
                onMouseEnter={show}
                onMouseLeave={hide}
                onClick={handleClick}
                role={citation.url ? 'link' : undefined}
            >
                {citation.index}
            </span>

            {showCard && (
                <div
                    ref={cardRef}
                    className={`citation-card ${cardPosition}`}
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
                    {citation.url && (
                        <a
                            className="citation-card-link"
                            href={citation.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                        >
                            Open source
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                        </a>
                    )}
                </div>
            )}
        </span>
    )
}

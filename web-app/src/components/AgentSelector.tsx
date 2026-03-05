import { useState, useRef, useEffect } from 'react'
import { useGoosed } from '../contexts/GoosedContext'

interface AgentSelectorProps {
    selectedAgent: string
    onAgentChange: (agentId: string) => void
    disabled?: boolean
}

export default function AgentSelector({
    selectedAgent,
    onAgentChange,
    disabled = false
}: AgentSelectorProps) {
    const { agents } = useGoosed()
    const [isOpen, setIsOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const selectedAgentInfo = agents.find(a => a.id === selectedAgent) || agents[0]

    return (
        <div className="agent-selector" ref={dropdownRef}>
            <button
                type="button"
                className="agent-selector-trigger"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    width="14"
                    height="14"
                    className="agent-icon"
                >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                </svg>
                <span className="agent-name">{selectedAgentInfo?.name || selectedAgent}</span>
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    width="12"
                    height="12"
                    className={`chevron ${isOpen ? 'open' : ''}`}
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {isOpen && (
                <div className="agent-dropdown">
                    {agents.map(agent => (
                        <button
                            key={agent.id}
                            type="button"
                            className={`agent-option ${agent.id === selectedAgent ? 'selected' : ''}`}
                            onClick={() => {
                                onAgentChange(agent.id)
                                setIsOpen(false)
                            }}
                        >
                            {agent.name}
                            {agent.id === selectedAgent && (
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    width="14"
                                    height="14"
                                    className="check-icon"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

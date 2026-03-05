import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react'
import { GoosedClient } from '@goosed/sdk'
import { useUser } from './UserContext'

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:3000'
const GATEWAY_SECRET_KEY = import.meta.env.VITE_GATEWAY_SECRET_KEY || 'test'

export interface AgentInfo {
    id: string
    name: string
    status: string
    provider?: string
    model?: string
    skills: string[]
    sysOnly?: boolean
}

interface GoosedContextType {
    getClient: (agentId: string) => GoosedClient
    agents: AgentInfo[]
    isConnected: boolean
    error: string | null
    refreshAgents: () => Promise<void>
}

const GoosedContext = createContext<GoosedContextType | null>(null)

export function GoosedProvider({ children }: { children: ReactNode }) {
    const { userId, role } = useUser()
    const [agents, setAgents] = useState<AgentInfo[]>([])
    const [isConnected, setIsConnected] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const clientCache = useRef<Record<string, GoosedClient>>({})
    const lastUserId = useRef<string | null>(null)

    // Clear client cache when userId changes
    if (lastUserId.current !== userId) {
        clientCache.current = {}
        lastUserId.current = userId
    }

    const getClient = useCallback((agentId: string): GoosedClient => {
        const cacheKey = `${agentId}:${userId || ''}`
        if (!clientCache.current[cacheKey]) {
            clientCache.current[cacheKey] = new GoosedClient({
                baseUrl: `${GATEWAY_URL}/agents/${agentId}`,
                secretKey: GATEWAY_SECRET_KEY,
                timeout: 5 * 60 * 1000, // 5 minutes for LLM responses
                userId: userId || undefined,
            })
        }
        return clientCache.current[cacheKey]
    }, [userId])

    const fetchAgents = useCallback(async () => {
        try {
            const headers: Record<string, string> = { 'x-secret-key': GATEWAY_SECRET_KEY }
            if (userId) headers['x-user-id'] = userId
            const res = await fetch(`${GATEWAY_URL}/agents`, {
                headers,
                signal: AbortSignal.timeout(5000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setAgents(data.agents || [])
            setIsConnected(true)
            setError(null)
        } catch (err) {
            setIsConnected(false)
            setError(err instanceof Error ? err.message : 'Failed to connect to gateway')
        }
    }, [userId])

    useEffect(() => {
        fetchAgents()
    }, [fetchAgents])

    const visibleAgents = useMemo(() => {
        if (role === 'admin') return agents
        return agents.filter(a => !a.sysOnly)
    }, [agents, role])

    return (
        <GoosedContext.Provider value={{ getClient, agents: visibleAgents, isConnected, error, refreshAgents: fetchAgents }}>
            {children}
        </GoosedContext.Provider>
    )
}

export function useGoosed(): GoosedContextType {
    const context = useContext(GoosedContext)
    if (!context) {
        throw new Error('useGoosed must be used within a GoosedProvider')
    }
    return context
}

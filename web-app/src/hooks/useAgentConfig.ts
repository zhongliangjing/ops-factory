import { useState, useCallback } from 'react'
import type { AgentConfig, UpdateAgentConfigRequest, UpdateAgentConfigResponse } from '../types/agentConfig'

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:3000'
const GATEWAY_SECRET_KEY = import.meta.env.VITE_GATEWAY_SECRET_KEY || 'test'

interface UseAgentConfigResult {
    config: AgentConfig | null
    isLoading: boolean
    error: string | null
    fetchConfig: (agentId: string) => Promise<void>
    updateConfig: (agentId: string, updates: UpdateAgentConfigRequest) => Promise<UpdateAgentConfigResponse>
}

export function useAgentConfig(): UseAgentConfigResult {
    const [config, setConfig] = useState<AgentConfig | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchConfig = useCallback(async (agentId: string) => {
        setIsLoading(true)
        setError(null)

        try {
            const res = await fetch(`${GATEWAY_URL}/agents/${agentId}/config`, {
                headers: { 'x-secret-key': GATEWAY_SECRET_KEY },
                signal: AbortSignal.timeout(10000),
            })

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${await res.text()}`)
            }

            const data: AgentConfig = await res.json()
            setConfig(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch config')
        } finally {
            setIsLoading(false)
        }
    }, [])

    const updateConfig = useCallback(async (
        agentId: string,
        updates: UpdateAgentConfigRequest
    ): Promise<UpdateAgentConfigResponse> => {
        setError(null)

        try {
            const res = await fetch(`${GATEWAY_URL}/agents/${agentId}/config`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'x-secret-key': GATEWAY_SECRET_KEY,
                },
                body: JSON.stringify(updates),
                signal: AbortSignal.timeout(10000),
            })

            const data: UpdateAgentConfigResponse = await res.json()

            if (!res.ok || !data.success) {
                setError(data.error || 'Failed to update config')
            }

            return data
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to update config'
            setError(errorMsg)
            return { success: false, error: errorMsg }
        }
    }, [])

    return {
        config,
        isLoading,
        error,
        fetchConfig,
        updateConfig,
    }
}

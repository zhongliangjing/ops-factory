import { useState, useCallback, useEffect } from 'react'
import { useUser } from '../contexts/UserContext'
import { GATEWAY_URL, gatewayHeaders } from '../config/runtime'
import { getErrorMessage } from '../utils/errorMessages'
import type { WhitelistCommand } from '../types/commandWhitelist'

export function useCommandWhitelist() {
    const { userId } = useUser()
    const [commands, setCommands] = useState<WhitelistCommand[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchWhitelist = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            const res = await fetch(`${GATEWAY_URL}/command-whitelist`, {
                headers: gatewayHeaders(userId),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
            const data = await res.json()
            setCommands(data.commands || [])
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setIsLoading(false)
        }
    }, [userId])

    const addCommand = useCallback(async (cmd: WhitelistCommand): Promise<boolean> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/command-whitelist`, {
                method: 'POST',
                headers: gatewayHeaders(userId),
                body: JSON.stringify(cmd),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) {
                const text = await res.text()
                let msg = text
                try { msg = JSON.parse(text).error || text } catch { /* use raw text */ }
                throw new Error(msg)
            }
            await fetchWhitelist()
            return true
        } catch (err) {
            setError(getErrorMessage(err))
            throw err
        }
    }, [userId, fetchWhitelist])

    const updateCommand = useCallback(async (pattern: string, updates: Partial<WhitelistCommand>): Promise<boolean> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/command-whitelist/${encodeURIComponent(pattern)}`, {
                method: 'PUT',
                headers: gatewayHeaders(userId),
                body: JSON.stringify(updates),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
            await fetchWhitelist()
            return true
        } catch (err) {
            setError(getErrorMessage(err))
            return false
        }
    }, [userId, fetchWhitelist])

    const deleteCommand = useCallback(async (pattern: string): Promise<boolean> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/command-whitelist/${encodeURIComponent(pattern)}`, {
                method: 'DELETE',
                headers: gatewayHeaders(userId),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            await fetchWhitelist()
            return true
        } catch (err) {
            setError(getErrorMessage(err))
            return false
        }
    }, [userId, fetchWhitelist])

    useEffect(() => { fetchWhitelist() }, [fetchWhitelist])

    return { commands, isLoading, error, fetchWhitelist, addCommand, updateCommand, deleteCommand }
}

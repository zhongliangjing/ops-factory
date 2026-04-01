import { useState, useCallback, useEffect } from 'react'
import { useUser } from '../contexts/UserContext'
import { GATEWAY_URL, gatewayHeaders } from '../config/runtime'
import { getErrorMessage } from '../utils/errorMessages'
import type { Host, HostCreateRequest, HostTestResult } from '../types/host'

export function useHosts(tags?: string[]) {
    const { userId } = useUser()
    const [hosts, setHosts] = useState<Host[]>([])
    const [allTags, setAllTags] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchHosts = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            const params = tags && tags.length > 0 ? `?tags=${tags.join(',')}` : ''
            const res = await fetch(`${GATEWAY_URL}/hosts${params}`, {
                headers: gatewayHeaders(userId),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
            const data = await res.json()
            setHosts(data.hosts || [])
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setIsLoading(false)
        }
    }, [userId, tags])

    const fetchTags = useCallback(async () => {
        try {
            const res = await fetch(`${GATEWAY_URL}/hosts/tags`, {
                headers: gatewayHeaders(userId),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setAllTags(data.tags || [])
        } catch {
            // ignore
        }
    }, [userId])

    const createHost = useCallback(async (req: HostCreateRequest): Promise<Host | null> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/hosts`, {
                method: 'POST',
                headers: gatewayHeaders(userId),
                body: JSON.stringify(req),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
            const data = await res.json()
            await fetchHosts()
            await fetchTags()
            return data.host as Host
        } catch (err) {
            setError(getErrorMessage(err))
            return null
        }
    }, [userId, fetchHosts, fetchTags])

    const updateHost = useCallback(async (id: string, req: Partial<HostCreateRequest>): Promise<boolean> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/hosts/${id}`, {
                method: 'PUT',
                headers: gatewayHeaders(userId),
                body: JSON.stringify(req),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
            await fetchHosts()
            await fetchTags()
            return true
        } catch (err) {
            setError(getErrorMessage(err))
            return false
        }
    }, [userId, fetchHosts, fetchTags])

    const deleteHost = useCallback(async (id: string): Promise<boolean> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/hosts/${id}`, {
                method: 'DELETE',
                headers: gatewayHeaders(userId),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            await fetchHosts()
            await fetchTags()
            return true
        } catch (err) {
            setError(getErrorMessage(err))
            return false
        }
    }, [userId, fetchHosts, fetchTags])

    const testConnection = useCallback(async (id: string): Promise<HostTestResult> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/hosts/${id}/test`, {
                method: 'POST',
                headers: gatewayHeaders(userId),
                signal: AbortSignal.timeout(15000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return await res.json()
        } catch (err) {
            return { success: false, message: getErrorMessage(err) }
        }
    }, [userId])

    useEffect(() => { fetchHosts() }, [fetchHosts])
    useEffect(() => { fetchTags() }, [fetchTags])

    return { hosts, allTags, isLoading, error, fetchHosts, fetchTags, createHost, updateHost, deleteHost, testConnection }
}

import { useState, useCallback, useEffect } from 'react'
import { useUser } from '../contexts/UserContext'
import { GATEWAY_URL, gatewayHeaders } from '../config/runtime'
import { getErrorMessage } from '../utils/errorMessages'
import type { Sop, SopCreateRequest } from '../types/sop'

export function useSops() {
    const { userId } = useUser()
    const [sops, setSops] = useState<Sop[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchSops = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            const res = await fetch(`${GATEWAY_URL}/sops`, {
                headers: gatewayHeaders(userId),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
            const data = await res.json()
            setSops(data.sops || [])
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setIsLoading(false)
        }
    }, [userId])

    const getSop = useCallback(async (id: string): Promise<Sop | null> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/sops/${id}`, {
                headers: gatewayHeaders(userId),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            return data as Sop
        } catch (err) {
            setError(getErrorMessage(err))
            return null
        }
    }, [userId])

    const createSop = useCallback(async (req: SopCreateRequest): Promise<Sop | null> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/sops`, {
                method: 'POST',
                headers: gatewayHeaders(userId),
                body: JSON.stringify(req),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) {
                const text = await res.text()
                let msg = text
                try { msg = JSON.parse(text).error || text } catch { /* use raw text */ }
                throw new Error(msg)
            }
            const data = await res.json()
            await fetchSops()
            return data as Sop
        } catch (err) {
            setError(getErrorMessage(err))
            throw err
        }
    }, [userId, fetchSops])

    const updateSop = useCallback(async (id: string, req: Partial<Sop>): Promise<boolean> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/sops/${id}`, {
                method: 'PUT',
                headers: gatewayHeaders(userId),
                body: JSON.stringify(req),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) {
                const text = await res.text()
                let msg = text
                try { msg = JSON.parse(text).error || text } catch { /* use raw text */ }
                throw new Error(msg)
            }
            await fetchSops()
            return true
        } catch (err) {
            setError(getErrorMessage(err))
            throw err
        }
    }, [userId, fetchSops])

    const deleteSop = useCallback(async (id: string): Promise<boolean> => {
        try {
            const res = await fetch(`${GATEWAY_URL}/sops/${id}`, {
                method: 'DELETE',
                headers: gatewayHeaders(userId),
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            await fetchSops()
            return true
        } catch (err) {
            setError(getErrorMessage(err))
            return false
        }
    }, [userId, fetchSops])

    useEffect(() => { fetchSops() }, [fetchSops])

    return { sops, isLoading, error, fetchSops, getSop, createSop, updateSop, deleteSop }
}

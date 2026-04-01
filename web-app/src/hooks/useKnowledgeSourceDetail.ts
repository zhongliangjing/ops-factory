import { useCallback, useEffect, useState } from 'react'
import { KNOWLEDGE_SERVICE_URL } from '../config/runtime'
import { getErrorMessage } from '../utils/errorMessages'
import type {
    KnowledgeCapabilities,
    KnowledgeDefaults,
    KnowledgeMaintenanceFailure,
    KnowledgeMaintenanceOverview,
    KnowledgeProfileDetail,
    KnowledgeSource,
    KnowledgeSourceStats,
    KnowledgeSourceUpdateRequest,
} from '../types/knowledge'

interface SaveSourceResult {
    success: boolean
    data?: KnowledgeSource
    error?: string
}

interface DeleteSourceResult {
    success: boolean
    error?: string
}

interface SaveProfileResult {
    success: boolean
    data?: KnowledgeProfileDetail
    error?: string
}

interface UseKnowledgeSourceDetailResult {
    source: KnowledgeSource | null
    stats: KnowledgeSourceStats | null
    capabilities: KnowledgeCapabilities | null
    defaults: KnowledgeDefaults | null
    indexProfileDetail: KnowledgeProfileDetail | null
    retrievalProfileDetail: KnowledgeProfileDetail | null
    maintenance: KnowledgeMaintenanceOverview | null
    isLoading: boolean
    error: string | null
    hasSupportingDataError: boolean
    reload: () => Promise<void>
    loadMaintenanceFailures: (jobId: string) => Promise<KnowledgeMaintenanceFailure[]>
    saveSource: (updates: KnowledgeSourceUpdateRequest) => Promise<SaveSourceResult>
    saveIndexProfile: (updates: { name?: string; config?: Record<string, unknown> }) => Promise<SaveProfileResult>
    saveRetrievalProfile: (updates: { name?: string; config?: Record<string, unknown> }) => Promise<SaveProfileResult>
    deleteSource: () => Promise<DeleteSourceResult>
}

function createEmptyStats(sourceId: string): KnowledgeSourceStats {
    return {
        sourceId,
        documentCount: 0,
        indexedDocumentCount: 0,
        failedDocumentCount: 0,
        processingDocumentCount: 0,
        chunkCount: 0,
        userEditedChunkCount: 0,
        lastIngestionAt: null,
    }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(10000),
    })
    const data = await response.json().catch(() => null)

    if (!response.ok) {
        const message = data && typeof data === 'object' && 'message' in data
            ? String((data as { message?: string }).message || response.statusText)
            : response.statusText
        throw new Error(`HTTP ${response.status}: ${message}`)
    }

    return data as T
}

export function useKnowledgeSourceDetail(sourceId: string | undefined): UseKnowledgeSourceDetailResult {
    const [source, setSource] = useState<KnowledgeSource | null>(null)
    const [stats, setStats] = useState<KnowledgeSourceStats | null>(null)
    const [capabilities, setCapabilities] = useState<KnowledgeCapabilities | null>(null)
    const [defaults, setDefaults] = useState<KnowledgeDefaults | null>(null)
    const [indexProfileDetail, setIndexProfileDetail] = useState<KnowledgeProfileDetail | null>(null)
    const [retrievalProfileDetail, setRetrievalProfileDetail] = useState<KnowledgeProfileDetail | null>(null)
    const [maintenance, setMaintenance] = useState<KnowledgeMaintenanceOverview | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [hasSupportingDataError, setHasSupportingDataError] = useState(false)

    const reload = useCallback(async () => {
        if (!sourceId) {
            setSource(null)
            setStats(null)
            setCapabilities(null)
            setDefaults(null)
            setIndexProfileDetail(null)
            setRetrievalProfileDetail(null)
            setMaintenance(null)
            setError(null)
            setHasSupportingDataError(false)
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        setError(null)
        setHasSupportingDataError(false)

        try {
            const sourceData = await requestJson<KnowledgeSource>(
                `${KNOWLEDGE_SERVICE_URL}/sources/${sourceId}`
            )

            const [
                statsResult,
                capabilitiesResult,
                defaultsResult,
                indexProfileDetailResult,
                retrievalProfileDetailResult,
                maintenanceResult,
            ] = await Promise.allSettled([
                requestJson<KnowledgeSourceStats>(
                    `${KNOWLEDGE_SERVICE_URL}/sources/${sourceId}/stats`
                ),
                requestJson<KnowledgeCapabilities>(
                    `${KNOWLEDGE_SERVICE_URL}/capabilities`
                ),
                requestJson<KnowledgeDefaults>(
                    `${KNOWLEDGE_SERVICE_URL}/system/defaults`
                ),
                sourceData.indexProfileId
                    ? requestJson<KnowledgeProfileDetail>(
                        `${KNOWLEDGE_SERVICE_URL}/profiles/index/${sourceData.indexProfileId}`
                    )
                    : Promise.resolve(null),
                sourceData.retrievalProfileId
                    ? requestJson<KnowledgeProfileDetail>(
                        `${KNOWLEDGE_SERVICE_URL}/profiles/retrieval/${sourceData.retrievalProfileId}`
                    )
                    : Promise.resolve(null),
                requestJson<KnowledgeMaintenanceOverview>(
                    `${KNOWLEDGE_SERVICE_URL}/sources/${sourceId}/maintenance`
                ),
            ])

            const supportingDataFailed = [
                statsResult,
                capabilitiesResult,
                defaultsResult,
                indexProfileDetailResult,
                retrievalProfileDetailResult,
                maintenanceResult,
            ].some(result => result.status === 'rejected')

            setSource(sourceData)
            setStats(statsResult.status === 'fulfilled' ? statsResult.value : createEmptyStats(sourceData.id))
            setCapabilities(capabilitiesResult.status === 'fulfilled' ? capabilitiesResult.value : null)
            setDefaults(defaultsResult.status === 'fulfilled' ? defaultsResult.value : null)
            setIndexProfileDetail(indexProfileDetailResult.status === 'fulfilled' ? indexProfileDetailResult.value : null)
            setRetrievalProfileDetail(retrievalProfileDetailResult.status === 'fulfilled' ? retrievalProfileDetailResult.value : null)
            setMaintenance(maintenanceResult.status === 'fulfilled' ? maintenanceResult.value : null)
            setHasSupportingDataError(supportingDataFailed)
        } catch (err) {
            setSource(null)
            setStats(null)
            setCapabilities(null)
            setDefaults(null)
            setIndexProfileDetail(null)
            setRetrievalProfileDetail(null)
            setMaintenance(null)
            setError(getErrorMessage(err))
        } finally {
            setIsLoading(false)
        }
    }, [sourceId])

    useEffect(() => {
        void reload()
    }, [reload])

    const saveSource = useCallback(async (updates: KnowledgeSourceUpdateRequest): Promise<SaveSourceResult> => {
        if (!sourceId) {
            return {
                success: false,
                error: 'Missing source id',
            }
        }

        setError(null)

        try {
            const updatedSource = await requestJson<KnowledgeSource>(
                `${KNOWLEDGE_SERVICE_URL}/sources/${sourceId}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updates),
                }
            )

            setSource(updatedSource)

            return {
                success: true,
                data: updatedSource,
            }
        } catch (err) {
            const message = getErrorMessage(err)
            setError(message)
            return {
                success: false,
                error: message,
            }
        }
    }, [sourceId])

    const saveIndexProfile = useCallback(async (updates: { name?: string; config?: Record<string, unknown> }): Promise<SaveProfileResult> => {
        const profileId = source?.indexProfileId
        if (!profileId) {
            return {
                success: false,
                error: 'Missing index profile id',
            }
        }

        setError(null)

        try {
            await requestJson<{ id: string; name: string; updatedAt: string }>(
                `${KNOWLEDGE_SERVICE_URL}/profiles/index/${profileId}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updates),
                }
            )

            const detail = await requestJson<KnowledgeProfileDetail>(
                `${KNOWLEDGE_SERVICE_URL}/profiles/index/${profileId}`
            )
            setIndexProfileDetail(detail)
            await reload()
            return {
                success: true,
                data: detail,
            }
        } catch (err) {
            const message = getErrorMessage(err)
            setError(message)
            return {
                success: false,
                error: message,
            }
        }
    }, [reload, source?.indexProfileId])

    const saveRetrievalProfile = useCallback(async (updates: { name?: string; config?: Record<string, unknown> }): Promise<SaveProfileResult> => {
        const profileId = source?.retrievalProfileId
        if (!profileId) {
            return {
                success: false,
                error: 'Missing retrieval profile id',
            }
        }

        setError(null)

        try {
            await requestJson<{ id: string; name: string; updatedAt: string }>(
                `${KNOWLEDGE_SERVICE_URL}/profiles/retrieval/${profileId}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updates),
                }
            )

            const detail = await requestJson<KnowledgeProfileDetail>(
                `${KNOWLEDGE_SERVICE_URL}/profiles/retrieval/${profileId}`
            )
            setRetrievalProfileDetail(detail)
            await reload()
            return {
                success: true,
                data: detail,
            }
        } catch (err) {
            const message = getErrorMessage(err)
            setError(message)
            return {
                success: false,
                error: message,
            }
        }
    }, [reload, source?.retrievalProfileId])

    const deleteSource = useCallback(async (): Promise<DeleteSourceResult> => {
        if (!sourceId) {
            return {
                success: false,
                error: 'Missing source id',
            }
        }

        setError(null)

        try {
            await requestJson<{ sourceId: string; deleted: boolean }>(
                `${KNOWLEDGE_SERVICE_URL}/sources/${sourceId}`,
                {
                    method: 'DELETE',
                }
            )

            return { success: true }
        } catch (err) {
            const message = getErrorMessage(err)
            setError(message)
            return {
                success: false,
                error: message,
            }
        }
    }, [sourceId])

    const loadMaintenanceFailures = useCallback(async (jobId: string): Promise<KnowledgeMaintenanceFailure[]> => {
        const response = await requestJson<{ jobId: string; items: KnowledgeMaintenanceFailure[] }>(
            `${KNOWLEDGE_SERVICE_URL}/jobs/${jobId}/failures`
        )
        return response.items || []
    }, [])

    return {
        source,
        stats,
        capabilities,
        defaults,
        indexProfileDetail,
        retrievalProfileDetail,
        maintenance,
        isLoading,
        error,
        hasSupportingDataError,
        reload,
        loadMaintenanceFailures,
        saveSource,
        saveIndexProfile,
        saveRetrievalProfile,
        deleteSource,
    }
}

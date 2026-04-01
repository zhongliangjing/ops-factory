import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeConfigure from '../pages/KnowledgeConfigure'

const showToast = vi.fn()
const openPreview = vi.fn()

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) => {
            if (params?.name && params?.error) return `${key}:${String(params.name)}:${String(params.error)}`
            if (params?.name) return `${key}:${String(params.name)}`
            if (params?.error) return `${key}:${String(params.error)}`
            return key
        },
    }),
}))

vi.mock('../contexts/ToastContext', () => ({
    useToast: () => ({ showToast }),
}))

vi.mock('../contexts/PreviewContext', () => ({
    usePreview: () => ({
        previewFile: null,
        isLoading: false,
        error: null,
        openPreview,
        closePreview: vi.fn(),
        isPreviewable: () => true,
    }),
}))

vi.mock('../config/runtime', () => ({
    KNOWLEDGE_SERVICE_URL: 'http://127.0.0.1:8092',
}))

const baseSource = {
    id: 'src_001',
    name: '产品文档库',
    description: '产品手册与 FAQ',
    status: 'ACTIVE',
    storageMode: 'MANAGED',
    indexProfileId: 'ip_default',
    retrievalProfileId: 'rp_default',
    runtimeStatus: 'ACTIVE',
    runtimeMessage: null,
    currentJobId: null,
    lastJobError: null,
    rebuildRequired: false,
    createdAt: '2026-03-25T10:00:00Z',
    updatedAt: '2026-03-25T10:00:00Z',
}

describe('KnowledgeConfigure page', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        window.localStorage.clear()

        let sourceState = { ...baseSource }
        let documents = [
            {
                id: 'doc_001',
                sourceId: 'src_001',
                name: 'runbook.pdf',
                contentType: 'application/pdf',
                title: 'Runbook PDF',
                status: 'INDEXED',
                indexStatus: 'INDEXED',
                fileSizeBytes: 1024,
                chunkCount: 8,
                userEditedChunkCount: 0,
                createdAt: '2026-03-25T10:00:00Z',
                updatedAt: '2026-03-25T10:05:00Z',
            },
        ]

        Object.assign(globalThis.URL, {
            createObjectURL: vi.fn(() => 'blob:runbook'),
            revokeObjectURL: vi.fn(),
        })

        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            const method = init?.method ?? 'GET'

            if (method === 'GET' && url.endsWith('/knowledge/sources/src_001')) {
                return { ok: true, json: async () => sourceState } as Response
            }

            if (method === 'PATCH' && url.endsWith('/knowledge/sources/src_001')) {
                const payload = JSON.parse(String(init?.body || '{}')) as Record<string, string>
                sourceState = {
                    ...sourceState,
                    name: payload.name || sourceState.name,
                    description: payload.description || sourceState.description,
                    rebuildRequired: true,
                }
                return { ok: true, json: async () => sourceState } as Response
            }

            if (method === 'DELETE' && url.endsWith('/knowledge/sources/src_001')) {
                return { ok: true, json: async () => ({ sourceId: 'src_001', deleted: true }) } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/sources/src_001/stats')) {
                return {
                    ok: true,
                    json: async () => ({
                        sourceId: 'src_001',
                        documentCount: documents.length,
                        indexedDocumentCount: documents.length,
                        failedDocumentCount: 0,
                        processingDocumentCount: 0,
                        chunkCount: 234,
                        userEditedChunkCount: 3,
                        lastIngestionAt: '2026-03-25T12:30:00Z',
                    }),
                } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/capabilities')) {
                return {
                    ok: true,
                    json: async () => ({
                        retrievalModes: ['lexical', 'hybrid', 'semantic'],
                        chunkModes: ['hierarchical'],
                        expandModes: ['ordinal_neighbors'],
                        analyzers: ['smartcn'],
                        editableChunkFields: ['title', 'keywords', 'text'],
                        featureFlags: {
                            allowChunkEdit: true,
                            allowChunkDelete: true,
                            allowExplain: true,
                            allowRequestOverride: false,
                        },
                    }),
                } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/system/defaults')) {
                return {
                    ok: true,
                    json: async () => ({
                        ingest: {
                            maxFileSizeMb: 100,
                            allowedContentTypes: ['application/pdf', 'text/markdown'],
                            deduplication: 'sha256',
                            skipExistingByDefault: true,
                        },
                        chunking: {
                            mode: 'hierarchical',
                            targetTokens: 512,
                            overlapTokens: 64,
                            respectHeadings: true,
                            keepTablesWhole: true,
                        },
                        retrieval: {
                            mode: 'hybrid',
                            lexicalTopK: 50,
                            semanticTopK: 50,
                            finalTopK: 10,
                            rrfK: 60,
                        },
                        features: {
                            allowChunkEdit: true,
                            allowChunkDelete: true,
                            allowExplain: true,
                            allowRequestOverride: false,
                        },
                    }),
                } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/profiles/index/ip_default')) {
                return {
                    ok: true,
                    json: async () => ({
                        id: 'ip_default',
                        name: '默认索引配置',
                        config: {
                            analysis: { language: 'zh', indexAnalyzer: 'smartcn', queryAnalyzer: 'smartcn' },
                            chunking: { mode: 'hierarchical', targetTokens: 512 },
                            indexing: { titleBoost: 4, titlePathBoost: 2.5, keywordBoost: 2, contentBoost: 1, bm25: { k1: 1.2, b: 0.75 } },
                        },
                    }),
                } as Response
            }

            if (method === 'PATCH' && url.endsWith('/knowledge/profiles/index/ip_default')) {
                sourceState = { ...sourceState, rebuildRequired: true }
                return { ok: true, json: async () => ({ id: 'ip_default', updatedAt: '2026-03-25T13:00:00Z' }) } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/profiles/retrieval/rp_default')) {
                return {
                    ok: true,
                    json: async () => ({
                        id: 'rp_default',
                        name: '默认召回配置',
                        config: {
                            retrieval: { mode: 'hybrid', lexicalTopK: 50, semanticTopK: 50, rrfK: 60 },
                            result: { finalTopK: 10, snippetLength: 180 },
                        },
                    }),
                } as Response
            }

            if (method === 'GET' && url.includes('/knowledge/documents?sourceId=src_001&page=1&pageSize=100')) {
                return { ok: true, json: async () => ({ items: documents, page: 1, pageSize: 100, total: documents.length }) } as Response
            }

            if (method === 'PATCH' && url.endsWith('/knowledge/documents/doc_001')) {
                const payload = JSON.parse(String(init?.body || '{}')) as Record<string, string>
                documents = documents.map(document => document.id === 'doc_001'
                    ? { ...document, title: payload.title || document.title }
                    : document)
                return { ok: true, json: async () => ({ documentId: 'doc_001', updated: true }) } as Response
            }

            if (method === 'POST' && url.endsWith('/knowledge/sources/src_001/documents:ingest')) {
                documents = [
                    ...documents,
                    {
                        id: 'doc_002',
                        sourceId: 'src_001',
                        name: 'guide.pdf',
                        contentType: 'application/pdf',
                        title: 'Guide PDF',
                        status: 'INDEXED',
                        indexStatus: 'INDEXED',
                        fileSizeBytes: 2048,
                        chunkCount: 4,
                        userEditedChunkCount: 0,
                        createdAt: '2026-03-25T11:00:00Z',
                        updatedAt: '2026-03-25T11:05:00Z',
                    },
                ]
                return { ok: true, json: async () => ({ jobId: 'job_001', sourceId: 'src_001', status: 'SUCCEEDED', documentCount: 1 }) } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/documents/doc_001/original')) {
                return {
                    ok: true,
                    headers: new Headers({ 'Content-Disposition': 'attachment; filename="runbook.pdf"' }),
                    blob: async () => new Blob(['pdf-bytes']),
                } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/documents/doc_001/preview')) {
                return {
                    ok: true,
                    json: async () => ({
                        markdownPreview: '# Runbook PDF\n\nPreview content.',
                        excerpt: 'Preview content.',
                    }),
                } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/sources/src_001/maintenance')) {
                return {
                    ok: true,
                    json: async () => ({
                        sourceId: 'src_001',
                        currentJob: null,
                        lastCompletedJob: {
                            id: 'job_000',
                            type: 'SOURCE_REBUILD',
                            status: 'FAILED',
                            stage: 'INDEXING',
                            createdBy: 'admin',
                            startedAt: '2026-03-25T12:00:00Z',
                            updatedAt: '2026-03-25T12:10:00Z',
                            finishedAt: '2026-03-25T12:10:00Z',
                            totalDocuments: 12,
                            processedDocuments: 12,
                            successDocuments: 10,
                            failedDocuments: 2,
                            currentDocumentId: null,
                            currentDocumentName: null,
                            message: 'Source rebuild completed with failures',
                            errorSummary: '2 个文档处理失败',
                        },
                    }),
                } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/jobs/job_000/failures')) {
                return {
                    ok: true,
                    json: async () => ({
                        jobId: 'job_000',
                        items: [
                            {
                                documentId: 'doc_001',
                                documentName: 'runbook.pdf',
                                stage: 'INDEXING',
                                errorCode: 'INDEX_WRITE_FAILED',
                                message: '索引写入失败',
                                finishedAt: '2026-03-25T12:09:00Z',
                            },
                        ],
                    }),
                } as Response
            }

            if (method === 'POST' && url.endsWith('/knowledge/sources/src_001:rebuild')) {
                sourceState = { ...sourceState, runtimeStatus: 'MAINTENANCE', currentJobId: 'job_001' }
                return { ok: true, json: async () => ({ jobId: 'job_001', sourceId: 'src_001', status: 'RUNNING' }) } as Response
            }

            if (url.includes('/knowledge/chunks') || url.includes('/knowledge/search')) {
                return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 100, total: 0, hits: [], hybrid: { hits: [], total: 0 }, semantic: { hits: [], total: 0 }, lexical: { hits: [], total: 0 } }) } as Response
            }

            return { ok: false, status: 404, json: async () => ({ message: 'not found' }) } as Response
        }))
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('renders basic info and saves edited source settings', async () => {
        render(
            <MemoryRouter initialEntries={['/knowledge/src_001']}>
                <Routes>
                    <Route path="/knowledge/:sourceId" element={<KnowledgeConfigure />} />
                </Routes>
            </MemoryRouter>
        )

        await screen.findByRole('heading', { name: '产品文档库' })
        fireEvent.click(screen.getByRole('button', { name: 'knowledge.editBasicInfo' }))
        await screen.findByText('knowledge.editBasicInfoTitle')

        fireEvent.change(screen.getByLabelText('knowledge.name'), { target: { value: '产品文档库 v2' } })
        fireEvent.change(screen.getByLabelText('knowledge.description'), { target: { value: '新的描述' } })
        fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith('success', 'knowledge.saveSuccess:产品文档库 v2')
        })
        expect(await screen.findByRole('heading', { name: '产品文档库 v2' })).toBeInTheDocument()
    })

    it('shows maintenance failures and submits a rebuild request', async () => {
        render(
            <MemoryRouter initialEntries={['/knowledge/src_001?tab=maintenance']}>
                <Routes>
                    <Route path="/knowledge/:sourceId" element={<KnowledgeConfigure />} />
                </Routes>
            </MemoryRouter>
        )

        await screen.findByText('knowledge.maintenanceLastJobTitle')
        expect(screen.getByText('knowledge.maintenanceStatusFailed')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'knowledge.maintenanceFailuresAction' }))
        expect(await screen.findByText('runbook.pdf')).toBeInTheDocument()
        expect(screen.getByText('索引写入失败')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'knowledge.rebuildAction' }))
        await screen.findByRole('heading', { name: 'knowledge.rebuildConfirmTitle' })
        fireEvent.click(screen.getByRole('button', { name: 'knowledge.rebuildConfirmAction' }))

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith('success', 'knowledge.rebuildSuccess:产品文档库')
        })
    })

    it('supports upload, rename, preview, and download in the documents workflow', async () => {
        render(
            <MemoryRouter initialEntries={['/knowledge/src_001?tab=documents']}>
                <Routes>
                    <Route path="/knowledge/:sourceId" element={<KnowledgeConfigure />} />
                </Routes>
            </MemoryRouter>
        )

        await screen.findByText('knowledge.documentsTabTitle')

        fireEvent.click(screen.getByRole('button', { name: 'knowledge.docUpload' }))
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
        fireEvent.change(fileInput, {
            target: {
                files: [new File(['pdf'], 'guide.pdf', { type: 'application/pdf' })],
            },
        })
        fireEvent.click(screen.getByRole('button', { name: 'knowledge.uploadStart' }))
        expect(await screen.findByText('Guide PDF')).toBeInTheDocument()

        fireEvent.click(screen.getAllByRole('button', { name: 'knowledge.docRename' })[0])
        await screen.findByText('knowledge.renameDocumentTitle')
        fireEvent.change(screen.getByLabelText('knowledge.docDisplayTitle'), { target: { value: 'Release Notes' } })
        fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
        expect(await screen.findByText('Release Notes')).toBeInTheDocument()

        fireEvent.click(screen.getAllByRole('button', { name: 'files.preview' })[0])
        await waitFor(() => {
            expect(openPreview).toHaveBeenCalledWith(expect.objectContaining({
                path: 'knowledge-document:doc_001',
                previewKind: 'markdown',
            }))
        })

        fireEvent.click(screen.getAllByRole('button', { name: 'knowledge.docDownload' })[0])
        await waitFor(() => {
            expect(globalThis.URL.createObjectURL).toHaveBeenCalled()
            expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:runbook')
        })
    })
})

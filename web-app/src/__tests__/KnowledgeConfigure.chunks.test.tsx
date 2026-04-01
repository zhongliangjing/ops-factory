import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeConfigure from '../pages/KnowledgeConfigure'

const showToast = vi.fn()

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
        openPreview: vi.fn(),
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

describe('KnowledgeConfigure chunks tab', () => {
    beforeEach(() => {
        vi.clearAllMocks()

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
                chunkCount: 1,
                userEditedChunkCount: 0,
                createdAt: '2026-03-25T10:00:00Z',
                updatedAt: '2026-03-25T10:05:00Z',
            },
            {
                id: 'doc_002',
                sourceId: 'src_001',
                name: 'faq.md',
                contentType: 'text/markdown',
                title: 'FAQ',
                status: 'INDEXED',
                indexStatus: 'INDEXED',
                fileSizeBytes: 2048,
                chunkCount: 1,
                userEditedChunkCount: 1,
                createdAt: '2026-03-25T11:00:00Z',
                updatedAt: '2026-03-25T11:05:00Z',
            },
        ]

        let chunks = [
            {
                id: 'chk_001',
                documentId: 'doc_001',
                sourceId: 'src_001',
                ordinal: 1,
                title: 'Initial Chunk',
                titlePath: ['Initial Chunk'],
                keywords: ['runbook', 'incident'],
                text: 'Initial chunk content for the runbook document.',
                markdown: 'Initial chunk content for the runbook document.',
                pageFrom: 1,
                pageTo: 1,
                tokenCount: 8,
                editStatus: 'SYSTEM_GENERATED',
                updatedBy: 'system',
                createdAt: '2026-03-25T10:05:00Z',
                updatedAt: '2026-03-25T10:05:00Z',
            },
            {
                id: 'chk_002',
                documentId: 'doc_002',
                sourceId: 'src_001',
                ordinal: 1,
                title: 'FAQ Chunk',
                titlePath: ['FAQ Chunk'],
                keywords: ['faq'],
                text: 'FAQ chunk content for the markdown document.',
                markdown: 'FAQ chunk content for the markdown document.',
                pageFrom: 2,
                pageTo: 2,
                tokenCount: 7,
                editStatus: 'USER_EDITED',
                updatedBy: 'system',
                createdAt: '2026-03-25T11:05:00Z',
                updatedAt: '2026-03-25T11:05:00Z',
            },
        ]

        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            const method = init?.method ?? 'GET'
            const parsedUrl = new URL(url, 'http://127.0.0.1')

            if (method === 'GET' && url.endsWith('/knowledge/sources/src_001')) {
                return { ok: true, json: async () => baseSource } as Response
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
                        chunkCount: chunks.length,
                        userEditedChunkCount: chunks.filter(chunk => chunk.editStatus === 'USER_EDITED').length,
                        lastIngestionAt: '2026-03-25T12:30:00Z',
                    }),
                } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/capabilities')) {
                return {
                    ok: true,
                    json: async () => ({
                        retrievalModes: ['lexical', 'hybrid'],
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
                        ingest: { maxFileSizeMb: 100, allowedContentTypes: ['application/pdf', 'text/markdown'], deduplication: 'sha256', skipExistingByDefault: true },
                        chunking: { mode: 'hierarchical', targetTokens: 512, overlapTokens: 64, respectHeadings: true, keepTablesWhole: true },
                        retrieval: { mode: 'hybrid', lexicalTopK: 50, semanticTopK: 50, finalTopK: 10, rrfK: 60 },
                        features: { allowChunkEdit: true, allowChunkDelete: true, allowExplain: true, allowRequestOverride: false },
                    }),
                } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/profiles/index/ip_default')) {
                return { ok: true, json: async () => ({ id: 'ip_default', name: '默认索引配置', config: { chunking: { mode: 'hierarchical', targetTokens: 512 } } }) } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/profiles/retrieval/rp_default')) {
                return { ok: true, json: async () => ({ id: 'rp_default', name: '默认召回配置', config: { retrieval: { mode: 'hybrid' }, result: { finalTopK: 10, snippetLength: 180 } } }) } as Response
            }

            if (method === 'GET' && parsedUrl.pathname === '/knowledge/documents') {
                return { ok: true, json: async () => ({ items: documents, page: 1, pageSize: 100, total: documents.length }) } as Response
            }

            if (method === 'GET' && parsedUrl.pathname === '/knowledge/chunks') {
                const documentId = parsedUrl.searchParams.get('documentId')
                const sourceId = parsedUrl.searchParams.get('sourceId')
                const items = chunks
                    .filter(chunk => !documentId || chunk.documentId === documentId)
                    .filter(chunk => !sourceId || chunk.sourceId === sourceId)
                    .map(chunk => ({
                        id: chunk.id,
                        documentId: chunk.documentId,
                        sourceId: chunk.sourceId,
                        ordinal: chunk.ordinal,
                        title: chunk.title,
                        titlePath: chunk.titlePath,
                        keywords: chunk.keywords,
                        snippet: chunk.text,
                        pageFrom: chunk.pageFrom,
                        pageTo: chunk.pageTo,
                        tokenCount: chunk.tokenCount,
                        editStatus: chunk.editStatus,
                        updatedAt: chunk.updatedAt,
                    }))
                return { ok: true, json: async () => ({ items, page: 1, pageSize: 100, total: items.length }) } as Response
            }

            if (method === 'GET' && url.includes('/knowledge/chunks/')) {
                const chunkId = parsedUrl.pathname.split('/').at(-1) || ''
                const chunk = chunks.find(item => item.id === chunkId)
                return { ok: true, json: async () => ({ ...chunk, textLength: chunk?.text.length || 0 }) } as Response
            }

            if (method === 'PATCH' && url.endsWith('/knowledge/chunks/chk_001')) {
                const payload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
                chunks = chunks.map(chunk => chunk.id === 'chk_001'
                    ? {
                        ...chunk,
                        keywords: payload.keywords as string[],
                        text: String(payload.text),
                        markdown: String(payload.markdown),
                        editStatus: 'USER_EDITED',
                    }
                    : chunk)
                return { ok: true, json: async () => ({ id: 'chk_001', reembedded: true, reindexed: true, editStatus: 'USER_EDITED' }) } as Response
            }

            if (method === 'POST' && url.endsWith('/knowledge/documents/doc_001/chunks')) {
                const payload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
                const created = {
                    id: 'chk_003',
                    documentId: 'doc_001',
                    sourceId: 'src_001',
                    ordinal: 2,
                    title: 'Manual validation chunk content for operators.',
                    titlePath: ['Manual validation chunk content for operators.'],
                    keywords: payload.keywords as string[],
                    text: String(payload.text),
                    markdown: String(payload.markdown),
                    pageFrom: 1,
                    pageTo: 1,
                    tokenCount: 6,
                    editStatus: 'USER_EDITED',
                    updatedBy: 'system',
                    createdAt: '2026-03-25T12:00:00Z',
                    updatedAt: '2026-03-25T12:00:00Z',
                }
                chunks = [...chunks, created]
                return { ok: true, json: async () => ({ id: 'chk_003', reembedded: true, reindexed: true, editStatus: 'USER_EDITED' }) } as Response
            }

            if (method === 'DELETE' && url.endsWith('/knowledge/chunks/chk_003')) {
                chunks = chunks.filter(chunk => chunk.id !== 'chk_003')
                return { ok: true, json: async () => ({ chunkId: 'chk_003', deleted: true }) } as Response
            }

            if (url.includes('/knowledge/search') || url.includes('/knowledge/sources/src_001/maintenance')) {
                return { ok: true, json: async () => ({ hits: [], items: [], page: 1, pageSize: 100, total: 0, currentJob: null, lastCompletedJob: null }) } as Response
            }

            return { ok: false, status: 404, json: async () => ({ message: 'not found' }) } as Response
        }))
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('jumps from the documents tab into a document-scoped chunks view', async () => {
        render(
            <MemoryRouter initialEntries={['/knowledge/src_001?tab=documents']}>
                <Routes>
                    <Route path="/knowledge/:sourceId" element={<KnowledgeConfigure />} />
                </Routes>
            </MemoryRouter>
        )

        await screen.findByText('knowledge.documentsTabTitle')
        fireEvent.click(screen.getAllByRole('button', { name: 'knowledge.docViewChunks' })[0])

        await screen.findByText('knowledge.chunksTabTitle')
        expect(screen.getByText('Initial Chunk')).toBeInTheDocument()
        expect(screen.queryByText('FAQ Chunk')).not.toBeInTheDocument()
        expect(screen.getAllByText('Runbook PDF').length).toBeGreaterThan(0)
    })

    it('creates, edits, and deletes chunks from the chunks tab', async () => {
        render(
            <MemoryRouter initialEntries={['/knowledge/src_001?tab=chunks']}>
                <Routes>
                    <Route path="/knowledge/:sourceId" element={<KnowledgeConfigure />} />
                </Routes>
            </MemoryRouter>
        )

        await screen.findByText('knowledge.chunksTabTitle')
        fireEvent.click(screen.getByRole('button', { name: /Initial Chunk/ }))
        await screen.findByText('Initial chunk content for the runbook document.')

        fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
        fireEvent.change(screen.getByLabelText('knowledge.chunkKeywordsLabel'), { target: { value: 'manual-keyword, incident-custom' } })
        fireEvent.change(screen.getByLabelText('knowledge.chunkContentTitle'), { target: { value: 'Updated runbook content with manual edits.' } })
        fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith('success', 'knowledge.chunkSaveSuccess')
        })
        expect((await screen.findAllByText('Updated runbook content with manual edits.')).length).toBeGreaterThan(0)

        fireEvent.click(screen.getByRole('button', { name: 'knowledge.chunkCreate' }))
        await screen.findByText('knowledge.chunkCreateTitle')
        fireEvent.change(screen.getByLabelText('knowledge.chunkDocumentLabel'), { target: { value: 'doc_001' } })
        fireEvent.change(screen.getByLabelText('knowledge.chunkKeywordsLabel'), { target: { value: 'manual-only-term' } })
        fireEvent.change(screen.getByLabelText('knowledge.chunkContentTitle'), { target: { value: 'Manual validation chunk content for operators.' } })
        fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith('success', 'knowledge.chunkCreateSuccess')
        })

        expect((await screen.findAllByText('Manual validation chunk content for operators.')).length).toBeGreaterThan(0)
        fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }))
        fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }))
        await screen.findByText('knowledge.chunkDeleteTitle')
        fireEvent.click(screen.getAllByRole('button', { name: 'common.delete' }).at(-1)!)

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith('success', 'knowledge.chunkDeleteSuccess')
        })
        expect(screen.queryByText('Manual validation chunk content for operators.')).not.toBeInTheDocument()
    })
})

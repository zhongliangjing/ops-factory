import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeConfigure from '../pages/KnowledgeConfigure'

const showToast = vi.fn()
const compareRequests: Array<Record<string, unknown>> = []
let allowRequestOverride = true
let compareModeStatus = 200
let useLegacyFallback = false

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) => {
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
        openInlinePreview: vi.fn(),
        previewFile: null,
        closePreview: vi.fn(),
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

const detailByChunkId = {
    chk_hyb_001: {
        id: 'chk_hyb_001',
        documentId: 'doc_hybrid',
        sourceId: 'src_001',
        ordinal: 1,
        title: '混合结论',
        titlePath: ['召回评估', '混合结论'],
        text: '混合检索把语义相关和关键词命中放在一起，整体排序更均衡。',
        markdown: '混合检索把语义相关和关键词命中放在一起。',
        keywords: ['hybrid', 'rank'],
        pageFrom: 6,
        pageTo: 6,
        tokenCount: 64,
        textLength: 23,
        editStatus: 'SYSTEM_GENERATED',
        updatedBy: null,
        createdAt: '2026-03-25T10:00:00Z',
        updatedAt: '2026-03-25T10:05:00Z',
    },
    chk_sem_001: {
        id: 'chk_sem_001',
        documentId: 'doc_semantic',
        sourceId: 'src_001',
        ordinal: 2,
        title: '语义覆盖',
        titlePath: ['召回评估', '语义覆盖'],
        text: '向量召回覆盖更多语义近邻段落，适合问题表达不稳定的场景。',
        markdown: '向量召回覆盖更多语义近邻段落。',
        keywords: ['semantic', 'embedding'],
        pageFrom: 3,
        pageTo: 3,
        tokenCount: 58,
        textLength: 24,
        editStatus: 'SYSTEM_GENERATED',
        updatedBy: null,
        createdAt: '2026-03-25T10:00:00Z',
        updatedAt: '2026-03-25T10:05:00Z',
    },
    chk_lex_001: {
        id: 'chk_lex_001',
        documentId: 'doc_lexical',
        sourceId: 'src_001',
        ordinal: 3,
        title: '精确命中',
        titlePath: ['召回评估', '精确命中'],
        text: '关键词检索优先命中包含 Qwen3-32B 精确词项的结论段落。该段落适合验证词项召回。',
        markdown: '关键词检索优先命中包含 Qwen3-32B 精确词项的结论段落。',
        keywords: ['Qwen3-32B', 'keyword'],
        pageFrom: 8,
        pageTo: 8,
        tokenCount: 72,
        textLength: 39,
        editStatus: 'SYSTEM_GENERATED',
        updatedBy: null,
        createdAt: '2026-03-25T10:00:00Z',
        updatedAt: '2026-03-25T10:05:00Z',
    },
} as const

function renderRetrievalPage() {
    render(
        <MemoryRouter initialEntries={['/knowledge/src_001?tab=retrieval']}>
            <Routes>
                <Route path="/knowledge/:sourceId" element={<KnowledgeConfigure />} />
            </Routes>
        </MemoryRouter>
    )
}

describe('KnowledgeConfigure retrieval tab', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        window.localStorage.clear()
        compareRequests.length = 0
        allowRequestOverride = true
        compareModeStatus = 200
        useLegacyFallback = false

        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            const parsedUrl = new URL(url, 'http://localhost')
            const method = init?.method ?? 'GET'

            if (method === 'GET' && url.endsWith('/knowledge/sources/src_001')) {
                return { ok: true, json: async () => baseSource } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/sources/src_001/stats')) {
                return {
                    ok: true,
                    json: async () => ({
                        sourceId: 'src_001',
                        documentCount: 12,
                        indexedDocumentCount: 10,
                        failedDocumentCount: 1,
                        processingDocumentCount: 1,
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
                        retrievalModes: ['semantic', 'lexical', 'hybrid'],
                        chunkModes: ['hierarchical'],
                        expandModes: ['ordinal_neighbors'],
                        analyzers: ['smartcn'],
                        editableChunkFields: ['title', 'keywords', 'text'],
                        featureFlags: {
                            allowChunkEdit: true,
                            allowChunkDelete: true,
                            allowExplain: true,
                            allowRequestOverride,
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
                        retrieval: { mode: 'semantic', lexicalTopK: 50, semanticTopK: 50, finalTopK: 3, rrfK: 60 },
                        features: { allowChunkEdit: true, allowChunkDelete: true, allowExplain: true, allowRequestOverride },
                    }),
                } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/profiles/index/ip_default')) {
                return { ok: true, json: async () => ({ id: 'ip_default', name: '默认索引配置', config: { chunking: { mode: 'hierarchical', targetTokens: 512 } } }) } as Response
            }

            if (method === 'GET' && url.endsWith('/knowledge/profiles/retrieval/rp_default')) {
                return {
                    ok: true,
                    json: async () => ({
                        id: 'rp_default',
                        name: '默认召回配置',
                        config: {
                            retrieval: { mode: 'semantic', lexicalTopK: 50, semanticTopK: 50, rrfK: 60 },
                            result: { finalTopK: 3, snippetLength: 180 },
                        },
                    }),
                } as Response
            }

            if (method === 'GET' && url.includes('/knowledge/documents?sourceId=src_001&page=1&pageSize=100')) {
                return {
                    ok: true,
                    json: async () => ({
                        items: [
                            { id: 'doc_hybrid', sourceId: 'src_001', name: '混合检索总结.pdf', contentType: 'application/pdf', title: '混合检索总结', status: 'INDEXED', indexStatus: 'INDEXED', fileSizeBytes: 1024, chunkCount: 8, userEditedChunkCount: 0, createdAt: '2026-03-25T10:00:00Z', updatedAt: '2026-03-25T10:05:00Z' },
                            { id: 'doc_semantic', sourceId: 'src_001', name: '向量召回评估.pdf', contentType: 'application/pdf', title: '向量召回评估', status: 'INDEXED', indexStatus: 'INDEXED', fileSizeBytes: 2048, chunkCount: 6, userEditedChunkCount: 0, createdAt: '2026-03-25T10:00:00Z', updatedAt: '2026-03-25T10:05:00Z' },
                            { id: 'doc_lexical', sourceId: 'src_001', name: '关键词命中说明.pdf', contentType: 'application/pdf', title: '关键词命中说明', status: 'INDEXED', indexStatus: 'INDEXED', fileSizeBytes: 2048, chunkCount: 4, userEditedChunkCount: 0, createdAt: '2026-03-25T10:00:00Z', updatedAt: '2026-03-25T10:05:00Z' },
                        ],
                        page: 1,
                        pageSize: 100,
                        total: 3,
                    }),
                } as Response
            }

            if (method === 'POST' && url.endsWith('/knowledge/search/compare')) {
                const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
                compareRequests.push(body)

                if (compareModeStatus === 404) {
                    return { ok: false, status: 404, json: async () => ({ message: 'not found' }) } as Response
                }

                if (compareModeStatus === 500) {
                    return { ok: false, status: 500, json: async () => ({ message: 'Embedding dimension mismatch' }) } as Response
                }

                return {
                    ok: true,
                    json: async () => ({
                        query: body.query,
                        fetchedTopK: 64,
                        hybrid: {
                            total: 1,
                            hits: [{ chunkId: 'chk_hyb_001', documentId: 'doc_hybrid', sourceId: 'src_001', title: '混合结论', titlePath: ['召回评估', '混合结论'], snippet: '混合检索把语义相关和关键词命中放在一起，整体排序更均衡。', score: 0.92, lexicalScore: 0.74, semanticScore: 0.88, fusionScore: 0.92, pageFrom: 6, pageTo: 6 }],
                        },
                        semantic: {
                            total: 1,
                            hits: [{ chunkId: 'chk_sem_001', documentId: 'doc_semantic', sourceId: 'src_001', title: '语义覆盖', titlePath: ['召回评估', '语义覆盖'], snippet: '向量召回覆盖更多语义近邻段落，适合问题表达不稳定的场景。', score: 0.81, lexicalScore: 0.32, semanticScore: 0.81, fusionScore: 0.81, pageFrom: 3, pageTo: 3 }],
                        },
                        lexical: {
                            total: 1,
                            hits: [{ chunkId: 'chk_lex_001', documentId: 'doc_lexical', sourceId: 'src_001', title: '精确命中', titlePath: ['召回评估', '精确命中'], snippet: '关键词检索优先命中包含 Qwen3-32B 精确词项的结论段落。', score: 0.76, lexicalScore: 0.76, semanticScore: 0.24, fusionScore: 0.76, pageFrom: 8, pageTo: 8 }],
                        },
                    }),
                } as Response
            }

            if (method === 'POST' && url.endsWith('/knowledge/search')) {
                if (!useLegacyFallback) {
                    return { ok: true, json: async () => ({ query: 'unused', total: 0, hits: [] }) } as Response
                }

                const body = JSON.parse(String(init?.body || '{}')) as Record<string, any>
                const mode = body.override?.mode as string
                const hit = mode === 'hybrid'
                    ? { chunkId: 'chk_hyb_001', documentId: 'doc_hybrid', sourceId: 'src_001', title: '混合结论', titlePath: ['召回评估', '混合结论'], snippet: '混合检索把语义相关和关键词命中放在一起，整体排序更均衡。', score: 0.92, lexicalScore: 0.74, semanticScore: 0.88, fusionScore: 0.92, pageFrom: 6, pageTo: 6 }
                    : mode === 'semantic'
                        ? { chunkId: 'chk_sem_001', documentId: 'doc_semantic', sourceId: 'src_001', title: '语义覆盖', titlePath: ['召回评估', '语义覆盖'], snippet: '向量召回覆盖更多语义近邻段落，适合问题表达不稳定的场景。', score: 0.81, lexicalScore: 0.32, semanticScore: 0.81, fusionScore: 0.81, pageFrom: 3, pageTo: 3 }
                        : { chunkId: 'chk_lex_001', documentId: 'doc_lexical', sourceId: 'src_001', title: '精确命中', titlePath: ['召回评估', '精确命中'], snippet: '关键词检索优先命中包含 Qwen3-32B 精确词项的结论段落。', score: 0.76, lexicalScore: 0.76, semanticScore: 0.24, fusionScore: 0.76, pageFrom: 8, pageTo: 8 }
                return { ok: true, json: async () => ({ query: body.query, total: 1, hits: [hit] }) } as Response
            }

            if (method === 'GET' && url.includes('/knowledge/chunks/')) {
                const chunkId = parsedUrl.pathname.split('/').at(-1) as keyof typeof detailByChunkId | undefined
                return { ok: true, json: async () => (chunkId ? detailByChunkId[chunkId] : detailByChunkId.chk_hyb_001) } as Response
            }

            if (method === 'PATCH' && url.endsWith('/knowledge/chunks/chk_lex_001')) {
                return { ok: true, json: async () => ({ id: 'chk_lex_001', reembedded: true, reindexed: true, editStatus: 'USER_EDITED' }) } as Response
            }

            return { ok: false, status: 404, json: async () => ({ message: 'not found' }) } as Response
        }))
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('runs compare mode and supports detail inspection plus chunk editing', async () => {
        renderRetrievalPage()
        await screen.findByText('knowledge.retrievalTitle')

        fireEvent.change(screen.getByRole('textbox', { name: 'knowledge.retrievalQueryLabel' }), { target: { value: 'qwen3' } })
        fireEvent.click(screen.getByRole('button', { name: 'knowledge.retrievalRun' }))

        expect(await screen.findByText('混合检索总结.pdf')).toBeInTheDocument()
        expect(screen.getByText('向量召回评估.pdf')).toBeInTheDocument()
        expect(screen.getByText('关键词命中说明.pdf')).toBeInTheDocument()
        expect(compareRequests[0]?.modes).toEqual(['hybrid', 'semantic', 'lexical'])

        fireEvent.click(screen.getAllByText('关键词命中说明.pdf')[0])
        expect(await screen.findByText('关键词检索优先命中包含 Qwen3-32B 精确词项的结论段落。该段落适合验证词项召回。')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
        fireEvent.change(screen.getByLabelText('knowledge.chunkContentTitle'), { target: { value: 'Updated lexical retrieval note.' } })
        fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith('success', 'knowledge.chunkSaveSuccess')
        })
    })

    it('binds to the retrieval profile mode when request override is disabled', async () => {
        allowRequestOverride = false
        renderRetrievalPage()

        await screen.findByText('knowledge.retrievalTitle')
        expect(screen.queryByRole('button', { name: 'knowledge.retrievalViewCompare' })).not.toBeInTheDocument()

        fireEvent.change(screen.getByRole('textbox', { name: 'knowledge.retrievalQueryLabel' }), { target: { value: 'qwen3' } })
        fireEvent.click(screen.getByRole('button', { name: 'knowledge.retrievalRun' }))

        await waitFor(() => {
            expect(compareRequests).toHaveLength(1)
        })
        expect(compareRequests[0]?.retrievalProfileId).toBe('rp_default')
        expect(compareRequests[0]?.modes).toEqual(['semantic'])
    })

    it('falls back to legacy search when compare endpoint is unavailable', async () => {
        compareModeStatus = 404
        useLegacyFallback = true
        renderRetrievalPage()

        await screen.findByText('knowledge.retrievalTitle')
        fireEvent.change(screen.getByRole('textbox', { name: 'knowledge.retrievalQueryLabel' }), { target: { value: 'ITSM' } })
        fireEvent.click(screen.getByRole('button', { name: 'knowledge.retrievalRun' }))

        expect(await screen.findByText('混合检索总结.pdf')).toBeInTheDocument()
        expect(screen.getByText('向量召回评估.pdf')).toBeInTheDocument()
        expect(screen.getByText('关键词命中说明.pdf')).toBeInTheDocument()
        expect(compareRequests).toHaveLength(1)
    })

    it('shows backend compare errors directly without falling back to legacy search', async () => {
        compareModeStatus = 500
        renderRetrievalPage()

        await screen.findByText('knowledge.retrievalTitle')
        fireEvent.change(screen.getByRole('textbox', { name: 'knowledge.retrievalQueryLabel' }), { target: { value: 'ITSM' } })
        fireEvent.click(screen.getByRole('button', { name: 'knowledge.retrievalRun' }))

        expect(await screen.findByText('common.connectionError:Embedding dimension mismatch')).toBeInTheDocument()
        expect(showToast).toHaveBeenCalledWith('error', 'Embedding dimension mismatch')
        expect(compareRequests).toHaveLength(1)
    })
})

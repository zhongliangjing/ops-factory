import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Knowledge from '../pages/Knowledge'

const showToast = vi.fn()

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) => {
            if (params?.name) return `${key}:${String(params.name)}`
            if (params?.error) return `${key}:${String(params.error)}`
            return key
        },
    }),
}))

vi.mock('../contexts/ToastContext', () => ({
    useToast: () => ({
        showToast,
    }),
}))

vi.mock('../config/runtime', () => ({
    KNOWLEDGE_SERVICE_URL: 'http://127.0.0.1:8092',
}))

describe('Knowledge page', () => {
    beforeEach(() => {
        vi.clearAllMocks()

        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            const method = init?.method ?? 'GET'

            if (method === 'GET' && url.includes('/ops-knowledge/sources?page=1&pageSize=100')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        items: [
                            {
                                id: 'src_001',
                                name: '产品文档库',
                                description: '产品手册与FAQ',
                                status: 'ACTIVE',
                                storageMode: 'MANAGED',
                                indexProfileId: 'ip_default',
                                retrievalProfileId: 'rp_default',
                                createdAt: '2026-03-24T10:00:00Z',
                                updatedAt: '2026-03-24T10:00:00Z',
                            },
                        ],
                        page: 1,
                        pageSize: 100,
                        total: 1,
                    }),
                } as Response)
            }

            if (method === 'GET' && url.includes('/ops-knowledge/sources/src_001/stats')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        sourceId: 'src_001',
                        documentCount: 12,
                        indexedDocumentCount: 12,
                        failedDocumentCount: 0,
                        processingDocumentCount: 0,
                        chunkCount: 234,
                        userEditedChunkCount: 3,
                        lastIngestionAt: '2026-03-24T10:10:00Z',
                    }),
                } as Response)
            }

            if (method === 'POST' && url.endsWith('/ops-knowledge/sources')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        id: 'src_002',
                        name: '新知识库',
                    }),
                } as Response)
            }

            if (method === 'DELETE' && url.endsWith('/ops-knowledge/sources/src_001')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        sourceId: 'src_001',
                        deleted: true,
                    }),
                } as Response)
            }

            return Promise.resolve({
                ok: false,
                status: 404,
                json: async () => ({ message: 'not found' }),
            } as Response)
        }))
    })

    it('renders source cards with stats and opens create modal', async () => {
        render(
            <MemoryRouter>
                <Knowledge />
            </MemoryRouter>
        )

        await screen.findByText('产品文档库')
        expect(screen.getByText('产品手册与FAQ')).toBeInTheDocument()
        expect(screen.getByText('12')).toBeInTheDocument()
        expect(screen.getByText('234')).toBeInTheDocument()

        fireEvent.click(screen.getByText('knowledge.createButton'))
        expect(screen.getByText('knowledge.createTitle')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('knowledge.namePlaceholder')).toBeInTheDocument()
    })

    it('creates a knowledge base and refreshes the list', async () => {
        render(
            <MemoryRouter>
                <Knowledge />
            </MemoryRouter>
        )

        await screen.findByText('产品文档库')
        fireEvent.click(screen.getByText('knowledge.createButton'))
        fireEvent.change(screen.getByPlaceholderText('knowledge.namePlaceholder'), { target: { value: '新知识库' } })
        fireEvent.change(screen.getByPlaceholderText('knowledge.descriptionPlaceholder'), { target: { value: '描述' } })
        fireEvent.click(screen.getByText('knowledge.createAction'))

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith('success', 'knowledge.createSuccess:新知识库')
        })

        const fetchMock = vi.mocked(fetch)
        expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:8092/ops-knowledge/sources',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }),
        )
    })

    it('deletes a knowledge base after confirmation', async () => {
        render(
            <MemoryRouter>
                <Knowledge />
            </MemoryRouter>
        )

        await screen.findByText('产品文档库')
        fireEvent.click(screen.getByText('common.delete'))
        expect(screen.getByText('knowledge.deleteTitle')).toBeInTheDocument()
        fireEvent.click(screen.getAllByRole('button', { name: 'common.delete' }).at(-1)!)

        await waitFor(() => {
            expect(showToast).toHaveBeenCalledWith('success', 'knowledge.deleteSuccess:产品文档库')
        })
    })

    it('navigates to configure page when configure is clicked', async () => {
        render(
            <MemoryRouter initialEntries={['/knowledge']}>
                <Routes>
                    <Route path="/knowledge" element={<Knowledge />} />
                    <Route path="/knowledge/:sourceId" element={<div>configure-page</div>} />
                </Routes>
            </MemoryRouter>
        )

        await screen.findByText('产品文档库')
        fireEvent.click(screen.getByText('knowledge.configure'))
        await screen.findByText('configure-page')
    })

    it('shows error banner when the API fails to load sources', async () => {
        vi.mocked(fetch).mockReset()
        vi.stubGlobal('fetch', vi.fn(() =>
            Promise.reject(new Error('Network Error'))
        ))

        render(
            <MemoryRouter>
                <Knowledge />
            </MemoryRouter>
        )

        await screen.findByText('common.connectionError:Network Error')
    })

    it('shows inline error in the modal when source creation fails', async () => {
        vi.mocked(fetch).mockReset()
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            const method = init?.method ?? 'GET'

            if (method === 'GET' && url.includes('/ops-knowledge/sources?page=1&pageSize=100')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ items: [], page: 1, pageSize: 100, total: 0 }),
                } as Response)
            }

            if (method === 'POST' && url.endsWith('/ops-knowledge/sources')) {
                return Promise.resolve({
                    ok: false,
                    status: 400,
                    json: async () => ({ message: 'Source name already exists' }),
                } as Response)
            }

            return Promise.resolve({
                ok: false,
                status: 404,
                json: async () => ({ message: 'not found' }),
            } as Response)
        }))

        render(
            <MemoryRouter>
                <Knowledge />
            </MemoryRouter>
        )

        await waitFor(() => {
            expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
        })
        fireEvent.click(screen.getByText('knowledge.createButton'))
        fireEvent.change(screen.getByPlaceholderText('knowledge.namePlaceholder'), { target: { value: '重复名称' } })
        fireEvent.click(screen.getByText('knowledge.createAction'))

        await screen.findByText('Source name already exists')
    })

    it('filters sources by status when clicking the status filter', async () => {
        vi.mocked(fetch).mockReset()
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = String(input)
            const method = init?.method ?? 'GET'

            if (method === 'GET' && url.includes('/ops-knowledge/sources?page=1&pageSize=100')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        items: [
                            {
                                id: 'src_001',
                                name: '活跃知识库',
                                description: '',
                                status: 'ACTIVE',
                                storageMode: 'MANAGED',
                                indexProfileId: 'ip_default',
                                retrievalProfileId: 'rp_default',
                                createdAt: '2026-03-24T10:00:00Z',
                                updatedAt: '2026-03-24T10:00:00Z',
                            },
                            {
                                id: 'src_002',
                                name: '禁用知识库',
                                description: '',
                                status: 'DISABLED',
                                storageMode: 'MANAGED',
                                indexProfileId: 'ip_default',
                                retrievalProfileId: 'rp_default',
                                createdAt: '2026-03-24T10:00:00Z',
                                updatedAt: '2026-03-24T10:00:00Z',
                            },
                        ],
                        page: 1,
                        pageSize: 100,
                        total: 2,
                    }),
                } as Response)
            }

            if (method === 'GET' && url.includes('/ops-knowledge/sources/') && url.includes('/stats')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        documentCount: 1,
                        chunkCount: 10,
                        indexedDocumentCount: 1,
                        failedDocumentCount: 0,
                        processingDocumentCount: 0,
                        userEditedChunkCount: 0,
                        lastIngestionAt: null,
                    }),
                } as Response)
            }

            return Promise.resolve({
                ok: false,
                status: 404,
                json: async () => ({ message: 'not found' }),
            } as Response)
        }))

        render(
            <MemoryRouter>
                <Knowledge />
            </MemoryRouter>
        )

        await screen.findByText('活跃知识库')
        expect(screen.getByText('禁用知识库')).toBeInTheDocument()

        const tablist = screen.getByRole('tablist', { name: 'Status filter' })
        const filterButtons = tablist.querySelectorAll('button')

        fireEvent.click(filterButtons[1])
        expect(screen.getByText('活跃知识库')).toBeInTheDocument()
        expect(screen.queryByText('禁用知识库')).not.toBeInTheDocument()

        fireEvent.click(filterButtons[2])
        expect(screen.queryByText('活跃知识库')).not.toBeInTheDocument()
        expect(screen.getByText('禁用知识库')).toBeInTheDocument()

        fireEvent.click(filterButtons[0])
        expect(screen.getByText('活跃知识库')).toBeInTheDocument()
        expect(screen.getByText('禁用知识库')).toBeInTheDocument()
    })
})

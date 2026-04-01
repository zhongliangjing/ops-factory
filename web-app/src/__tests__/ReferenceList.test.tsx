import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReferenceList from '../components/ReferenceList'

const openPreview = vi.fn()

vi.mock('../contexts/PreviewContext', () => ({
    usePreview: () => ({
        openPreview,
    }),
}))

vi.mock('../config/runtime', () => ({
    KNOWLEDGE_SERVICE_URL: 'http://127.0.0.1:8092',
}))

describe('ReferenceList', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        openPreview.mockReset()
    })

    it('opens loading state first and then loads the full document preview', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                title: 'Runbook.pdf',
                markdownPreview: '# Full document',
            }),
        } as Response)

        render(
            <ReferenceList
                citations={[
                    {
                        index: 1,
                        title: 'Runbook.pdf',
                        documentId: 'doc_001',
                        chunkId: 'chk_001',
                        sourceId: 'src_001',
                        pageLabel: '12',
                        snippet: 'Important cited excerpt',
                        url: null,
                    },
                    {
                        index: 2,
                        title: 'Runbook.pdf',
                        documentId: 'doc_001',
                        chunkId: 'chk_002',
                        sourceId: 'src_001',
                        pageLabel: '13',
                        snippet: 'Second cited excerpt',
                        url: null,
                    },
                ]}
                label="回答中引用的资料"
                variant="cited"
            />
        )

        expect(screen.getByText('回答中引用的资料 (1)')).toBeInTheDocument()
        expect(screen.getByText('2 处引用 · p.12, 13')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /Runbook\.pdf/i }))

        await waitFor(() => {
            expect(openPreview).toHaveBeenCalledTimes(2)
        })
        expect(openPreview).toHaveBeenNthCalledWith(1, expect.objectContaining({
            name: 'Runbook.pdf',
            path: 'knowledge-document:doc_001',
            previewKind: 'markdown',
            type: 'md',
            content: '',
        }))
        expect(openPreview.mock.calls[0][0].content).toBe('')
        expect(openPreview).toHaveBeenNthCalledWith(2, expect.objectContaining({
            name: 'Runbook.pdf',
            path: 'knowledge-document:doc_001',
            previewKind: 'markdown',
            type: 'md',
            content: '# Full document',
        }))
    })
})

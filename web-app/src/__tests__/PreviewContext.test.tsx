import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PreviewProvider, usePreview } from '../contexts/PreviewContext'
import { UserProvider } from '../contexts/UserContext'

const STORAGE_KEY = 'opsfactory:userId'

function PreviewHarness() {
    const { openPreview, previewFile, error } = usePreview()

    return (
        <div>
            <button
                type="button"
                onClick={() => void openPreview({
                    name: 'notes.md',
                    path: '/tmp/notes.md',
                    type: 'md',
                    content: '# hello preview',
                })}
            >
                open-direct
            </button>
            <button
                type="button"
                onClick={() => void openPreview({
                    name: 'server.log',
                    path: '/logs/server.log',
                    type: 'txt',
                    agentId: 'agent-1',
                })}
            >
                open-agent
            </button>
            <div data-testid="preview-name">{previewFile?.name || ''}</div>
            <div data-testid="preview-content">{previewFile?.content || ''}</div>
            <div data-testid="preview-error">{error || ''}</div>
        </div>
    )
}

describe('PreviewProvider', () => {
    const fetchMock = vi.fn<typeof fetch>()

    beforeEach(() => {
        localStorage.setItem(STORAGE_KEY, 'test-user')
        vi.stubGlobal('fetch', fetchMock)
        fetchMock.mockImplementation((input: RequestInfo | URL) => {
            const url = String(input)

            if (url.endsWith('/config')) {
                return Promise.resolve(new Response(JSON.stringify({
                    officePreview: {
                        enabled: false,
                        onlyofficeUrl: '',
                        fileBaseUrl: '',
                    },
                }), { status: 200 }))
            }

            if (url.endsWith('/me')) {
                return Promise.resolve(new Response(JSON.stringify({ role: 'admin' }), { status: 200 }))
            }

            if (url.includes('/agents/agent-1/files/')) {
                return Promise.resolve(new Response('fetched preview text', { status: 200 }))
            }

            return Promise.reject(new Error(`Unhandled fetch: ${url}`))
        })
    })

    afterEach(() => {
        localStorage.clear()
        vi.unstubAllGlobals()
        vi.clearAllMocks()
    })

    it('supports direct preview requests without agentId', async () => {
        render(
            <UserProvider>
                <PreviewProvider>
                    <PreviewHarness />
                </PreviewProvider>
            </UserProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: 'open-direct' }))

        await waitFor(() => {
            expect(screen.getByTestId('preview-name')).toHaveTextContent('notes.md')
            expect(screen.getByTestId('preview-content')).toHaveTextContent('# hello preview')
            expect(screen.getByTestId('preview-error')).toBeEmptyDOMElement()
        })
    })

    it('loads agent-backed previews through the gateway when agentId is present', async () => {
        render(
            <UserProvider>
                <PreviewProvider>
                    <PreviewHarness />
                </PreviewProvider>
            </UserProvider>
        )

        fireEvent.click(screen.getByRole('button', { name: 'open-agent' }))

        await waitFor(() => {
            expect(screen.getByTestId('preview-name')).toHaveTextContent('server.log')
            expect(screen.getByTestId('preview-content')).toHaveTextContent('fetched preview text')
            expect(screen.getByTestId('preview-error')).toBeEmptyDOMElement()
        })
    })
})

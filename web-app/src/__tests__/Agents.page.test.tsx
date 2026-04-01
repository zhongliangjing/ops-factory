import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Agents from '../pages/Agents'

const refreshAgents = vi.fn()
const fetchMcp = vi.fn()

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}))

vi.mock('../contexts/GoosedContext', () => ({
    useGoosed: () => ({
        agents: [
            {
                id: 'universal-agent',
                name: 'Universal Agent',
                status: 'configured',
                provider: 'custom_openai_oss_120b',
                model: 'openai/gpt-oss-120b',
                skills: ['skill-a', 'skill-b', 'skill-c'],
            },
        ],
        isConnected: true,
        error: null,
        refreshAgents,
    }),
}))

vi.mock('../contexts/UserContext', () => ({
    useUser: () => ({
        role: 'admin',
        userId: 'admin',
    }),
}))

vi.mock('../hooks/useMcp', () => ({
    useMcp: () => ({
        entries: [
            { enabled: true },
            { enabled: true },
            { enabled: false },
        ],
        fetchMcp,
    }),
}))

vi.mock('../config/runtime', () => ({
    GATEWAY_URL: 'http://127.0.0.1:8088/gateway',
    gatewayHeaders: () => ({ 'Content-Type': 'application/json' }),
    slugify: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
}))

describe('Agents page', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
            ok: true,
            json: async () => ({ success: true }),
        } as Response)))
    })

    it('renders compact resource cards with model summary and metrics', async () => {
        render(
            <MemoryRouter>
                <Agents />
            </MemoryRouter>
        )

        expect(await screen.findByText('Universal Agent')).toBeInTheDocument()
        expect(screen.getByText('custom_openai_oss_120b')).toBeInTheDocument()
        expect(screen.getByText('openai/gpt-oss-120b')).toBeInTheDocument()
        expect(screen.getByText('3')).toBeInTheDocument()
        expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('opens delete modal and navigates to configure page', async () => {
        render(
            <MemoryRouter initialEntries={['/agents']}>
                <Routes>
                    <Route path="/agents" element={<Agents />} />
                    <Route path="/agents/:agentId/configure" element={<div>configure-page</div>} />
                </Routes>
            </MemoryRouter>
        )

        await screen.findByText('Universal Agent')

        fireEvent.click(screen.getByText('agents.deleteAgent'))
        expect(screen.getByText('agents.deleteAgentTitle')).toBeInTheDocument()

        fireEvent.click(screen.getByText('agents.configure'))
        expect(await screen.findByText('configure-page')).toBeInTheDocument()
    })
})

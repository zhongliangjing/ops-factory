import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Home from '../pages/Home'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const translations: Record<string, string> = {
                'home.greeting': '你好，我是 OpsClaw',
                'home.description': '你的 AI 智能运维助手。',
            }

            return translations[key] ?? key
        },
    }),
}))

vi.mock('../contexts/GoosedContext', () => ({
    useGoosed: () => ({
        getClient: vi.fn(),
        agents: [],
        isConnected: true,
        error: null,
    }),
}))

vi.mock('../contexts/ToastContext', () => ({
    useToast: () => ({
        showToast: vi.fn(),
    }),
}))

vi.mock('../components/ChatInput', () => ({
    default: () => <div data-testid="chat-input" />,
}))

describe('Home page', () => {
    it('renders a text heading with a stable svg icon instead of an emoji glyph', () => {
        render(
            <MemoryRouter>
                <Home />
            </MemoryRouter>
        )

        expect(screen.getByRole('heading', { name: '你好，我是 OpsClaw' })).toBeTruthy()
        expect(screen.getByTestId('home-title-icon')).toBeTruthy()
        expect(screen.queryByText('🦞')).toBeNull()
        expect(screen.queryAllByRole('tab')).toHaveLength(0)
    })
})

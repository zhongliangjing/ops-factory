import { describe, it, expect } from 'vitest'
import { normalizeChatStreamError } from '../utils/chatStreamError'

describe('normalizeChatStreamError', () => {
    it('maps browser stream decode failures to connection lost message', () => {
        const msg = normalizeChatStreamError(
            new Error('Request failed: Stream decode error: error decoding response body.')
        )

        expect(msg).toBe('Agent connection lost, please retry')
    })

    it('maps terminated body streams to connection lost message', () => {
        const msg = normalizeChatStreamError(
            new Error('TypeError: Failed to fetch because the body stream was terminated')
        )

        expect(msg).toBe('Agent connection lost, please retry')
    })

    it('preserves existing idle-timeout style errors', () => {
        const msg = normalizeChatStreamError('Agent stopped responding, please try again')

        expect(msg).toBe('Agent stopped responding, please try again')
    })

    it('returns fallback message for empty errors', () => {
        const msg = normalizeChatStreamError('')

        expect(msg).toBe('Failed to send message')
    })
})

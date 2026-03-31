import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
    GoosedAuthError,
    GoosedClient,
    GoosedConnectionError,
} from '../src/index.js'

describe('GoosedClient basic smoke tests', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        globalThis.fetch = undefined as typeof fetch
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    test('status() sends secret key and user headers', async () => {
        let request: RequestInfo | URL | undefined
        let init: RequestInit | undefined

        globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
            request = input
            init = options
            return new Response('ok', {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            })
        }) as typeof fetch

        const client = new GoosedClient({
            baseUrl: 'http://127.0.0.1:3002/ops-gateway',
            secretKey: 'unit-secret',
            userId: 'unit-user',
            timeout: 500,
        })

        const result = await client.status()

        assert.equal(result, 'ok')
        assert.equal(String(request), 'http://127.0.0.1:3002/ops-gateway/status')
        assert.equal(init?.method, 'GET')
        assert.equal((init?.headers as Record<string, string>)['x-secret-key'], 'unit-secret')
        assert.equal((init?.headers as Record<string, string>)['x-user-id'], 'unit-user')
    })

    test('status() maps 401 responses to GoosedAuthError', async () => {
        globalThis.fetch = (async () => new Response('denied', { status: 401 })) as typeof fetch

        const client = new GoosedClient({
            baseUrl: 'http://127.0.0.1:3002/ops-gateway',
            secretKey: 'unit-secret',
        })

        await assert.rejects(() => client.status(), GoosedAuthError)
    })

    test('status() maps fetch failures to GoosedConnectionError', async () => {
        globalThis.fetch = (async () => {
            throw new TypeError('fetch failed')
        }) as typeof fetch

        const client = new GoosedClient({
            baseUrl: 'http://127.0.0.1:3002/ops-gateway',
            secretKey: 'unit-secret',
        })

        await assert.rejects(() => client.status(), GoosedConnectionError)
    })
})

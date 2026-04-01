import { afterEach, describe, expect, it, vi } from 'vitest'

async function importRuntimeModule() {
    vi.resetModules()
    return import('../config/runtime')
}

describe('runtime config', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('loads runtime values from /config.json', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                gatewayUrl: 'https://127.0.0.1:3000',
                gatewaySecretKey: 'secret',
                knowledgeServiceUrl: 'https://127.0.0.1:8092',
            }),
        } as Response)

        const runtime = await importRuntimeModule()
        await runtime.initializeRuntimeConfig()

        expect(globalThis.fetch).toHaveBeenCalledWith('/config.json', { cache: 'no-store' })
        expect(runtime.GATEWAY_URL).toBe('https://127.0.0.1:3000/gateway')
        expect(runtime.GATEWAY_SECRET_KEY).toBe('secret')
        expect(runtime.KNOWLEDGE_SERVICE_URL).toBe('https://127.0.0.1:8092/knowledge')
    })

    it('builds gateway headers with configured secret key and user id', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                gatewayUrl: 'https://127.0.0.1:3000',
                gatewaySecretKey: 'secret',
            }),
        } as Response)

        const runtime = await importRuntimeModule()
        await runtime.initializeRuntimeConfig()

        expect(runtime.gatewayHeaders('alice')).toEqual({
            'Content-Type': 'application/json',
            'x-secret-key': 'secret',
            'x-user-id': 'alice',
        })
    })
})

/**
 * Prompt API Integration Tests
 *
 * Tests the /config/prompts endpoints via the gateway catch-all proxy.
 * These endpoints proxy to goosed's prompt template management API.
 *
 * Prerequisites: goosed binary must be available in PATH.
 * Run: cd test && npx vitest run --config vitest.config.ts prompts.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startJavaGateway, type GatewayHandle } from './helpers.js'

const AGENT_ID = 'universal-agent'

let gw: GatewayHandle

// ===== Setup / Teardown =====

beforeAll(async () => {
    gw = await startJavaGateway()
}, 60_000)

afterAll(async () => {
    if (gw) await gw.stop()
}, 15_000)

// =====================================================
// Prompt template listing
// =====================================================
describe('Prompt template listing', () => {
    it('GET /agents/:id/config/prompts returns list of templates', async () => {
        const res = await gw.fetch(`/agents/${AGENT_ID}/config/prompts`)
        expect(res.ok).toBe(true)

        const data = await res.json()
        expect(data).toHaveProperty('prompts')
        expect(Array.isArray(data.prompts)).toBe(true)
        expect(data.prompts.length).toBeGreaterThan(0)

        // Each template should have required fields
        const first = data.prompts[0]
        expect(first).toHaveProperty('name')
        expect(first).toHaveProperty('description')
        expect(typeof first.name).toBe('string')
        expect(typeof first.description).toBe('string')
    })

    it('includes known prompt templates (system.md)', async () => {
        const res = await gw.fetch(`/agents/${AGENT_ID}/config/prompts`)
        const data = await res.json()
        const names = data.prompts.map((p: any) => p.name)
        expect(names).toContain('system.md')
    })

    it('each template has is_customized boolean', async () => {
        const res = await gw.fetch(`/agents/${AGENT_ID}/config/prompts`)
        const data = await res.json()
        for (const prompt of data.prompts) {
            expect(typeof prompt.is_customized).toBe('boolean')
        }
    })
})

// =====================================================
// Get individual prompt
// =====================================================
describe('Get individual prompt', () => {
    it('GET /agents/:id/config/prompts/system.md returns prompt content', async () => {
        const res = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/system.md`)
        expect(res.ok).toBe(true)

        const data = await res.json()
        expect(data).toHaveProperty('name', 'system.md')
        expect(data).toHaveProperty('content')
        expect(data).toHaveProperty('default_content')
        expect(data).toHaveProperty('is_customized')
        expect(typeof data.content).toBe('string')
        expect(typeof data.default_content).toBe('string')
        expect(data.content.length).toBeGreaterThan(0)
        expect(data.default_content.length).toBeGreaterThan(0)
    })

    it('returns 404 for unknown prompt name', async () => {
        const res = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/nonexistent.md`)
        expect(res.ok).toBe(false)
        // goosed returns 404 for unknown template names
        expect([404, 500]).toContain(res.status)
    })

    it('content equals default_content when not customized', async () => {
        const res = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/system.md`)
        const data = await res.json()

        if (!data.is_customized) {
            expect(data.content).toBe(data.default_content)
        }
    })
})

// =====================================================
// Save and reset prompt
// =====================================================
describe('Save and reset prompt', () => {
    const TEST_PROMPT = 'compaction.md'
    let originalContent = ''

    it('save custom prompt content', async () => {
        // First, get the original content
        const getRes = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/${TEST_PROMPT}`)
        expect(getRes.ok).toBe(true)
        const original = await getRes.json()
        originalContent = original.default_content

        // Save custom content
        const customContent = originalContent + '\n\n# Custom test addition'
        const saveRes = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/${TEST_PROMPT}`, {
            method: 'PUT',
            body: JSON.stringify({ content: customContent }),
        })
        expect(saveRes.ok).toBe(true)

        // Verify it was saved
        const verifyRes = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/${TEST_PROMPT}`)
        expect(verifyRes.ok).toBe(true)
        const verified = await verifyRes.json()
        expect(verified.content).toBe(customContent)
        expect(verified.is_customized).toBe(true)
        // default_content should remain unchanged
        expect(verified.default_content).toBe(originalContent)
    })

    it('customized flag appears in list after save', async () => {
        const res = await gw.fetch(`/agents/${AGENT_ID}/config/prompts`)
        const data = await res.json()
        const target = data.prompts.find((p: any) => p.name === TEST_PROMPT)
        expect(target).toBeDefined()
        expect(target.is_customized).toBe(true)
    })

    it('reset prompt to default', async () => {
        const resetRes = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/${TEST_PROMPT}`, {
            method: 'DELETE',
        })
        expect(resetRes.ok).toBe(true)

        // Verify it was reset
        const verifyRes = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/${TEST_PROMPT}`)
        expect(verifyRes.ok).toBe(true)
        const verified = await verifyRes.json()
        expect(verified.is_customized).toBe(false)
        expect(verified.content).toBe(verified.default_content)
    })

    it('reset non-customized prompt is idempotent', async () => {
        // Resetting a prompt that's already default should succeed silently
        const resetRes = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/${TEST_PROMPT}`, {
            method: 'DELETE',
        })
        expect(resetRes.ok).toBe(true)
    })
})

// =====================================================
// SDK client prompt methods
// =====================================================
describe('SDK prompt methods', () => {
    // Dynamically import SDK to test through the same gateway
    let GoosedClient: any

    beforeAll(async () => {
        const sdk = await import('../typescript-sdk/src/index.js')
        GoosedClient = sdk.GoosedClient
    })

    it('listPrompts returns templates array', async () => {
        const client = new GoosedClient({
            baseUrl: `${gw.baseUrl}/agents/${AGENT_ID}`,
            secretKey: gw.secretKey,
            userId: 'sys',
        })
        const prompts = await client.listPrompts()
        expect(Array.isArray(prompts)).toBe(true)
        expect(prompts.length).toBeGreaterThan(0)
        expect(prompts[0]).toHaveProperty('name')
        expect(prompts[0]).toHaveProperty('description')
    })

    it('getPrompt returns content and default_content', async () => {
        const client = new GoosedClient({
            baseUrl: `${gw.baseUrl}/agents/${AGENT_ID}`,
            secretKey: gw.secretKey,
            userId: 'sys',
        })
        const prompt = await client.getPrompt('system.md')
        expect(prompt.name).toBe('system.md')
        expect(typeof prompt.content).toBe('string')
        expect(typeof prompt.default_content).toBe('string')
        expect(typeof prompt.is_customized).toBe('boolean')
    })

    it('savePrompt + getPrompt + resetPrompt lifecycle', async () => {
        const client = new GoosedClient({
            baseUrl: `${gw.baseUrl}/agents/${AGENT_ID}`,
            secretKey: gw.secretKey,
            userId: 'sys',
        })
        const testPrompt = 'recipe.md'

        // Get original
        const original = await client.getPrompt(testPrompt)
        const customContent = original.default_content + '\n# SDK test'

        // Save
        await client.savePrompt(testPrompt, customContent)

        // Verify
        const saved = await client.getPrompt(testPrompt)
        expect(saved.content).toBe(customContent)
        expect(saved.is_customized).toBe(true)

        // Reset
        await client.resetPrompt(testPrompt)

        // Verify reset
        const reset = await client.getPrompt(testPrompt)
        expect(reset.is_customized).toBe(false)
        expect(reset.content).toBe(reset.default_content)
    })

    it('getPrompt throws for unknown prompt', async () => {
        const client = new GoosedClient({
            baseUrl: `${gw.baseUrl}/agents/${AGENT_ID}`,
            secretKey: gw.secretKey,
            userId: 'sys',
        })
        await expect(client.getPrompt('nonexistent.md')).rejects.toThrow()
    })
})

// =====================================================
// Auth & edge cases
// =====================================================
describe('Prompt auth & edge cases', () => {
    it('rejects unauthenticated prompt requests', async () => {
        const res = await fetch(`${gw.baseUrl}/agents/${AGENT_ID}/config/prompts`)
        expect(res.status).toBe(401)
    })

    it('PUT with empty content is handled', async () => {
        const res = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/recipe.md`, {
            method: 'PUT',
            body: JSON.stringify({ content: '' }),
        })
        // goosed may accept or reject empty content — either way, no crash
        expect([200, 400, 500]).toContain(res.status)

        // Clean up: reset to default
        await gw.fetch(`/agents/${AGENT_ID}/config/prompts/recipe.md`, {
            method: 'DELETE',
        })
    })

    it('multiple prompts can be read in sequence', async () => {
        const promptNames = ['system.md', 'compaction.md', 'recipe.md']
        for (const name of promptNames) {
            const res = await gw.fetch(`/agents/${AGENT_ID}/config/prompts/${name}`)
            expect(res.ok).toBe(true)
            const data = await res.json()
            expect(data.name).toBe(name)
        }
    })
})

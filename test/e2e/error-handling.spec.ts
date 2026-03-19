/**
 * E2E Tests: Error handling when gateway is unavailable
 *
 * Prerequisites: only webapp needs to be running (gateway intentionally blocked):
 *   cd web-app && npm run dev
 *
 * These tests use Playwright's route interception to block all gateway
 * requests, simulating a gateway-down scenario. They verify that each page
 * shows a user-friendly error instead of an infinite loading spinner.
 *
 * Run:
 *   cd test && npx playwright test e2e/error-handling.spec.ts
 */
import { test, expect, type Page } from '@playwright/test'

const GATEWAY_PATTERN = '**/localhost:3000/ops-gateway/**'
const GATEWAY_PATTERN_ALT = '**/127.0.0.1:3000/ops-gateway/**'

/**
 * Block all gateway requests so the frontend behaves as if the gateway is down.
 * Uses route.abort('connectionrefused') to simulate network failure.
 */
async function blockGateway(page: Page) {
    await page.route(GATEWAY_PATTERN, route => route.abort('connectionrefused'))
    await page.route(GATEWAY_PATTERN_ALT, route => route.abort('connectionrefused'))
}

/** Set auth in localStorage so ProtectedRoute doesn't redirect to /login */
async function setAuth(page: Page, userId = 'e2e-error-user') {
    await page.goto('/login')
    await page.evaluate((uid) => {
        localStorage.setItem('opsfactory:userId', uid)
    }, userId)
}

// =====================================================
// Gateway-down error display — all pages
// =====================================================
test.describe('Gateway unavailable — error display', () => {
    test.beforeEach(async ({ page }) => {
        await setAuth(page)
        await blockGateway(page)
    })

    test('History page shows error instead of infinite loading', async ({ page }) => {
        await page.goto('/history')
        const errorBanner = page.locator('.conn-banner-error')
        await expect(errorBanner.first()).toBeVisible({ timeout: 15000 })
        const loadingSpinner = page.locator('.loading-spinner')
        await expect(loadingSpinner).not.toBeVisible({ timeout: 5000 })
    })

    test('Chat page shows error instead of infinite loading', async ({ page }) => {
        await page.goto('/chat')
        const errorIndicator = page.locator('text=/网络连接失败|加载会话失败|Failed to load session|Connection error/i')
        await expect(errorIndicator.first()).toBeVisible({ timeout: 15000 })
    })

    test('Agents page shows connection error', async ({ page }) => {
        await page.goto('/agents')
        const errorBanner = page.locator('.conn-banner-error')
        await expect(errorBanner.first()).toBeVisible({ timeout: 15000 })
    })

    test('Files page shows error instead of infinite loading', async ({ page }) => {
        await page.goto('/files')
        const errorBanner = page.locator('.conn-banner-error')
        await expect(errorBanner.first()).toBeVisible({ timeout: 15000 })
        const loadingSpinner = page.locator('.loading-spinner')
        await expect(loadingSpinner).not.toBeVisible({ timeout: 5000 })
    })

    test('Inbox page shows connection error banner', async ({ page }) => {
        await page.goto('/inbox')
        const errorBanner = page.locator('.conn-banner-error')
        await expect(errorBanner.first()).toBeVisible({ timeout: 15000 })
    })

    test('Monitoring page shows error banner', async ({ page }) => {
        // Monitoring requires admin — use 'sys' user to avoid redirect
        await page.evaluate(() => {
            localStorage.setItem('opsfactory:userId', 'sys')
        })
        await page.goto('/monitoring')
        const errorBanner = page.locator('.conn-banner-error').or(
            page.locator('text=/网络连接失败|加载监控数据失败|Failed to load|Connection error/i')
        )
        await expect(errorBanner.first()).toBeVisible({ timeout: 20000 })
    })

    test('Home page shows error banner', async ({ page }) => {
        await page.goto('/')
        const errorBanner = page.locator('.conn-banner-error')
        await expect(errorBanner.first()).toBeVisible({ timeout: 15000 })
    })
})

// =====================================================
// Unified banner styling
// =====================================================
test.describe('Unified error banner styling', () => {
    test.beforeEach(async ({ page }) => {
        await setAuth(page)
        await blockGateway(page)
    })

    test('all pages use conn-banner CSS class', async ({ page }) => {
        const pages = ['/history', '/files', '/inbox', '/agents']
        for (const p of pages) {
            await page.goto(p)
            const banner = page.locator('.conn-banner.conn-banner-error')
            await expect(banner.first()).toBeVisible({ timeout: 15000 })
        }
    })
})

// =====================================================
// Error message quality (no raw HTTP errors)
// =====================================================
test.describe('Error message friendliness', () => {
    test.beforeEach(async ({ page }) => {
        await setAuth(page)
        await blockGateway(page)
    })

    test('error messages do not show raw HTTP status codes', async ({ page }) => {
        await page.goto('/agents')
        await page.waitForTimeout(7000)
        const bodyText = await page.locator('body').textContent()
        expect(bodyText).not.toMatch(/HTTP \d{3}:/)
        expect(bodyText).not.toMatch(/Failed to fetch/)
        expect(bodyText).not.toMatch(/TypeError:/)
        expect(bodyText).not.toMatch(/Error:.*ECONNREFUSED/)
    })

    test('error messages are localized', async ({ page }) => {
        await page.goto('/agents')
        const errorText = page.locator('text=/网络连接失败|Network connection failed/i')
        await expect(errorText.first()).toBeVisible({ timeout: 15000 })
    })
})

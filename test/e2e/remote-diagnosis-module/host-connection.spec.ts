/**
 * E2E Test: Remote Host SSH Connection
 *
 * Verifies SSH connectivity to a real remote host:
 *   1. Login and navigate to Diagnosis → Hosts tab
 *   2. Add a host with SSH credentials
 *   3. Click "Test Connection" button
 *   4. Verify connection succeeds (OK indicator)
 *   5. Cleanup: delete the test host
 *
 * Every step takes a screenshot and validates API responses.
 */
import { test, expect, type Page, type Response } from '@playwright/test'

const ADMIN_USER = 'admin'
const SS_DIR = 'test-results/host-connection'

const TEST_HOST = {
    name: 'E2E-ConnTest',
    ip: '172.20.10.2',
    port: 22,
    username: 'sunsong',
    authType: 'password',
    credential: '0805',
    tags: ['E2E'],
    description: 'E2E connection test host',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAs(page: Page, username: string) {
    await page.goto('/login')
    await page.fill('input[placeholder="Your name"]', username)
    await page.click('button:has-text("Enter")')
    await page.waitForURL('/')
    await page.waitForTimeout(800)
}

async function ss(page: Page, name: string) {
    await page.screenshot({ path: `${SS_DIR}/${name}.png`, fullPage: true })
}

async function clickTab(page: Page, labelPattern: string) {
    const tab = page.locator('.config-tab').filter({ hasText: new RegExp(labelPattern) })
    await expect(tab).toBeVisible({ timeout: 5000 })
    await tab.click()
    await page.waitForTimeout(600)
}

async function waitForApi(
    page: Page,
    predicate: (r: Response) => boolean,
    timeout = 15000,
): Promise<Response> {
    return page.waitForResponse(predicate, { timeout })
}

/** Fill a form field by its label text */
async function fillByLabel(modal: Page | ReturnType<Page['locator']>, labelPattern: string, value: string) {
    const label = modal.locator('.form-label').filter({ hasText: new RegExp(labelPattern) })
    const group = label.locator('..')
    const input = group.locator('input.form-input').first()
    await input.fill(value)
}

/** Fill a textarea by its label text */
async function fillTextareaByLabel(modal: Page | ReturnType<Page['locator']>, labelPattern: string, value: string) {
    const label = modal.locator('.form-label').filter({ hasText: new RegExp(labelPattern) })
    const group = label.locator('..')
    const textarea = group.locator('textarea.form-input').first()
    await textarea.fill(value)
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('Remote Host SSH Connection Test', () => {
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await loginAs(page, ADMIN_USER)
        await page.goto('/remote-diagnosis')
        await page.waitForTimeout(1000)
        await clickTab(page, '主机管理|Hosts')
        await page.waitForTimeout(1000)
    })

    test('add host and verify SSH connection', async ({ page }) => {
        // =================================================================
        // Step 1: Add a new host
        // =================================================================
        await page.locator('.btn-primary').first().click()
        const modal = page.locator('.modal')
        await expect(modal).toBeVisible({ timeout: 5000 })
        await page.waitForTimeout(300)

        // Fill form fields
        await fillByLabel(modal, '名称|Name', TEST_HOST.name)
        await fillByLabel(modal, 'IP', TEST_HOST.ip)
        await modal.locator('input[type="number"]').fill(String(TEST_HOST.port))
        await fillByLabel(modal, '用户名|Username', TEST_HOST.username)
        await modal.locator('select.form-input').first().selectOption(TEST_HOST.authType)
        await fillTextareaByLabel(modal, '凭据|Credential', TEST_HOST.credential)

        await ss(page, '01-host-form-filled')

        // Submit
        const createApi = waitForApi(
            page,
            r => r.url().includes('/hosts') && r.request().method() === 'POST' && !r.url().includes('/hosts/'),
        )
        await modal.locator('.modal-footer .btn-primary').click()
        const createResp = await createApi

        await ss(page, '02-after-host-created')

        // Verify creation succeeded
        expect(createResp.ok(), `Create host failed: ${createResp.status()}`).toBeTruthy()
        const createBody = await createResp.json()
        expect(createBody.success, `API returned success:false`).toBe(true)
        expect(createBody.host, `Response missing host object`).toBeDefined()

        const hostId = createBody.host.id
        expect(hostId, `Host ID is empty`).toBeTruthy()

        // Wait for modal to close and table to update
        await expect(modal).not.toBeVisible({ timeout: 3000 })
        await page.waitForTimeout(1000)

        // Verify host appears in table
        const hostRow = page.locator('.data-table tbody tr').filter({ hasText: TEST_HOST.name })
        await expect(hostRow).toBeVisible({ timeout: 5000 })

        await ss(page, '03-host-in-table')

        // =================================================================
        // Step 2: Test SSH Connection
        // =================================================================
        // Find the "Test Connection" button in the host row
        const testBtn = hostRow.locator('button').filter({ hasText: /测试连接|Test Connection|Test/ })
        await expect(testBtn).toBeVisible({ timeout: 3000 })

        const testApi = waitForApi(
            page,
            r => r.url().includes('/hosts/') && r.url().includes('/test') && r.request().method() === 'POST',
            20000,
        )
        await testBtn.click()
        const testResp = await testApi

        await ss(page, '04-after-connection-test')

        // Verify test API response
        expect(testResp.ok(), `Test connection API failed: ${testResp.status()}`).toBeTruthy()
        const testBody = await testResp.json()
        expect(testBody.success, `Connection test returned success:false`).toBe(true)

        // Verify UI shows "OK" indicator
        const okIndicator = hostRow.locator('span').filter({ hasText: 'OK' })
        await expect(okIndicator, 'Expected "OK" indicator to be visible after successful connection test').toBeVisible({ timeout: 5000 })

        await ss(page, '05-connection-ok')

        // =================================================================
        // Step 3: Cleanup — delete the test host
        // =================================================================
        const deleteBtn = hostRow.locator('.btn-danger')
        await expect(deleteBtn).toBeVisible({ timeout: 3000 })

        page.once('dialog', d => d.accept())
        const delApi = waitForApi(
            page,
            r => r.url().includes(`/hosts/${hostId}`) && r.request().method() === 'DELETE',
        ).catch(() => null)

        await deleteBtn.click()
        const delResp = await delApi
        if (delResp) {
            expect(delResp.ok(), `Delete failed: ${delResp.status()}`).toBeTruthy()
        }

        await page.waitForTimeout(1000)

        // Verify host is gone from table
        const hostRowAfterDelete = page.locator('.data-table tbody tr').filter({ hasText: TEST_HOST.name })
        await expect(hostRowAfterDelete, `Host still visible after deletion`).not.toBeVisible({ timeout: 3000 })

        await ss(page, '06-cleaned-up')
    })
})

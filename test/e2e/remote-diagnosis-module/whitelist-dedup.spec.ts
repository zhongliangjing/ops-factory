/**
 * E2E Test: Whitelist Command Dedup
 *
 * Verifies that adding a duplicate command pattern is properly rejected:
 *   1. Login and navigate to Diagnosis → Whitelist tab
 *   2. Add a new command successfully
 *   3. Attempt to add the same pattern again → verify rejected
 *   4. Verify table still shows only one entry for that pattern
 *   5. Cleanup: delete the test command
 *
 * Every step takes a screenshot and validates API responses.
 */
import { test, expect, type Page, type Response } from '@playwright/test'

const ADMIN_USER = 'admin'
const SS_DIR = 'test-results/whitelist-dedup'
const TEST_PATTERN = `e2e-dedup-test-${Date.now()}`
const TEST_DESCRIPTION = 'E2E dedup test command'

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

async function waitForApi(page: Page, predicate: (r: Response) => boolean, timeout = 10000): Promise<Response> {
    return page.waitForResponse(predicate, { timeout })
}

/** Count how many table rows contain the given text */
async function countRowsWithText(page: Page, text: string): Promise<number> {
    const rows = page.locator('.data-table tbody tr')
    const count = await rows.count()
    let matched = 0
    for (let i = 0; i < count; i++) {
        const rowText = await rows.nth(i).textContent()
        if (rowText?.includes(text)) matched++
    }
    return matched
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('Whitelist Command — Dedup Validation', () => {
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await loginAs(page, ADMIN_USER)
        await page.goto('/remote-diagnosis')
        await page.waitForTimeout(1000)
        await clickTab(page, '命令白名单|Whitelist')
        await page.waitForTimeout(1000)
    })

    test('add command then reject duplicate pattern', async ({ page }) => {
        // =================================================================
        // Step 1: Add a new command successfully
        // =================================================================
        await page.locator('.btn-primary').first().click()
        const modal = page.locator('.modal')
        await expect(modal).toBeVisible({ timeout: 5000 })

        await modal.locator('.form-input[type="text"]').fill(TEST_PATTERN)
        await modal.locator('textarea').fill(TEST_DESCRIPTION)

        await ss(page, '01-add-form-filled')

        const addApi = waitForApi(page,
            r => r.url().includes('/command-whitelist') && r.request().method() === 'POST' && !r.url().includes('/command-whitelist/')
        )
        await modal.locator('.modal-footer .btn-primary').click()
        const addResp = await addApi

        await ss(page, '02-after-first-add')

        // Verify first add succeeded (201 or 200)
        expect(addResp.ok(), `First add failed: ${addResp.status()}`).toBeTruthy()
        await expect(modal).not.toBeVisible({ timeout: 3000 })

        // Verify exactly 1 row with our pattern
        await page.waitForTimeout(1000)
        const count1 = await countRowsWithText(page, TEST_PATTERN)
        expect(count1, `Expected 1 row with pattern, found ${count1}`).toBe(1)

        await ss(page, '03-one-row-in-table')

        // =================================================================
        // Step 2: Attempt to add the SAME pattern again → should be rejected
        // =================================================================
        await page.locator('.btn-primary').first().click()
        const modal2 = page.locator('.modal')
        await expect(modal2).toBeVisible({ timeout: 5000 })

        await modal2.locator('.form-input[type="text"]').fill(TEST_PATTERN)
        await modal2.locator('textarea').fill('duplicate attempt')

        await ss(page, '04-duplicate-form-filled')

        const dupApi = waitForApi(page,
            r => r.url().includes('/command-whitelist') && r.request().method() === 'POST' && !r.url().includes('/command-whitelist/')
        )
        await modal2.locator('.modal-footer .btn-primary').click()
        const dupResp = await dupApi

        await ss(page, '05-after-duplicate-add')

        // Verify API rejected the duplicate (409 Conflict)
        expect(dupResp.status(), `Expected 409 for duplicate, got ${dupResp.status()}`).toBe(409)
        const dupBody = await dupResp.json()
        expect(dupBody.success, `API returned success:true for duplicate`).toBe(false)
        expect(dupBody.error, `Error message should mention "already exists"`).toContain('already exists')

        // Verify toast error appeared
        const toastError = page.locator('.toast-error, .toast-error')
        // Toast may or may not be visible depending on how fast it fades

        // Modal should still be visible (error state) or closed with toast
        await page.waitForTimeout(2000)
        await ss(page, '06-duplicate-rejected')

        // Close modal if still open
        if (await modal2.isVisible()) {
            await modal2.locator('.modal-close').click()
            await page.waitForTimeout(500)
        }

        // =================================================================
        // Step 3: Verify table still has exactly 1 row with our pattern
        // =================================================================
        await page.waitForTimeout(1000)
        const count2 = await countRowsWithText(page, TEST_PATTERN)
        expect(count2, `Expected still 1 row after duplicate attempt, found ${count2}`).toBe(1)

        await ss(page, '07-still-one-row')

        // =================================================================
        // Step 4: Cleanup — delete the test command
        // =================================================================
        const deleteBtns = page.locator('.data-table tbody tr').filter({ hasText: TEST_PATTERN }).locator('.btn-danger')
        if (await deleteBtns.count() > 0) {
            page.once('dialog', d => d.accept())
            const delApi = waitForApi(page,
                r => r.url().includes('/command-whitelist/') && r.request().method() === 'DELETE'
            ).catch(() => null)

            await deleteBtns.first().click()
            const delResp = await delApi
            if (delResp) {
                expect(delResp.ok(), `Delete failed: ${delResp.status()}`).toBeTruthy()
            }
            await page.waitForTimeout(1000)
        }

        // Verify test pattern is gone
        const count3 = await countRowsWithText(page, TEST_PATTERN)
        expect(count3, `Expected 0 rows after cleanup, found ${count3}`).toBe(0)

        await ss(page, '08-cleaned-up')
    })
})

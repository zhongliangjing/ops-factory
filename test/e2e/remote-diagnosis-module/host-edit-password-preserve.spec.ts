/**
 * E2E Test: Host Edit Password Preservation
 *
 * Verifies the bug fix: editing a host without changing the password
 * must NOT corrupt the stored credential.
 *
 * Scenario:
 *   1. Login and navigate to Diagnosis → Hosts tab
 *   2. Add a host with known SSH credentials
 *   3. Verify SSH connection succeeds (proves credential is valid)
 *   4. Click "Edit" on the host, change only the name (NOT the password)
 *   5. Save the edit
 *   6. Click "Test Connection" again — must still succeed
 *   7. Verify the credential textarea shows "***" (masked) but real credential is preserved
 *   8. Cleanup: delete the test host
 */
import { test, expect, type Page, type Response } from '@playwright/test'

const ADMIN_USER = 'admin'
const SS_DIR = 'test-results/host-edit-password-preserve'

const TEST_HOST = {
    name: 'E2E-EditPreserve',
    ip: '172.20.10.2',
    port: 22,
    username: 'sunsong',
    authType: 'password',
    credential: '0805',
    tags: ['E2E-PRESERVE'],
    description: 'E2E edit password preservation test',
}

const UPDATED_NAME = 'E2E-EditPreserve-Updated'

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
async function fillByLabel(modal: ReturnType<Page['locator']>, labelPattern: string, value: string) {
    const label = modal.locator('.form-label').filter({ hasText: new RegExp(labelPattern) })
    const group = label.locator('..')
    const input = group.locator('input.form-input').first()
    await input.fill(value)
}

/** Fill a textarea by its label text */
async function fillTextareaByLabel(modal: ReturnType<Page['locator']>, labelPattern: string, value: string) {
    const label = modal.locator('.form-label').filter({ hasText: new RegExp(labelPattern) })
    const group = label.locator('..')
    const textarea = group.locator('textarea.form-input').first()
    await textarea.fill(value)
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('Host Edit Password Preservation', () => {
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await loginAs(page, ADMIN_USER)
        await page.goto('/remote-diagnosis')
        await page.waitForTimeout(1000)
        await clickTab(page, '主机管理|Hosts')
        await page.waitForTimeout(1000)
    })

    test('editing host without changing password preserves the original credential', async ({ page }) => {
        // =================================================================
        // Step 1: Create a host with known credentials
        // =================================================================
        await page.locator('.btn-primary').first().click()
        const modal = page.locator('.modal')
        await expect(modal).toBeVisible({ timeout: 5000 })
        await page.waitForTimeout(300)

        await fillByLabel(modal, '名称|Name', TEST_HOST.name)
        await fillByLabel(modal, 'IP', TEST_HOST.ip)
        await modal.locator('input[type="number"]').fill(String(TEST_HOST.port))
        await fillByLabel(modal, '用户名|Username', TEST_HOST.username)
        await modal.locator('select.form-input').first().selectOption(TEST_HOST.authType)
        await fillTextareaByLabel(modal, '凭据|Credential', TEST_HOST.credential)

        await ss(page, '01-create-form-filled')

        const createApi = waitForApi(
            page,
            r => r.url().includes('/hosts') && r.request().method() === 'POST' && !r.url().includes('/hosts/'),
        )
        await modal.locator('.modal-footer .btn-primary').click()
        const createResp = await createApi

        expect(createResp.ok(), `Create host failed: ${createResp.status()}`).toBeTruthy()
        const createBody = await createResp.json()
        expect(createBody.success).toBe(true)
        const hostId = createBody.host.id
        expect(hostId).toBeTruthy()

        await expect(modal).not.toBeVisible({ timeout: 3000 })
        await page.waitForTimeout(1000)

        await ss(page, '02-host-created')

        try {
            // =================================================================
            // Step 2: Test connection first time — verify credential works
            // =================================================================
            const hostRow = page.locator('.data-table tbody tr').filter({ hasText: TEST_HOST.name })
            await expect(hostRow).toBeVisible({ timeout: 5000 })

            const testBtn = hostRow.locator('button').filter({ hasText: /测试连接|Test Connection|Test/ })
            await expect(testBtn).toBeVisible({ timeout: 3000 })

            const testApi1 = waitForApi(
                page,
                r => r.url().includes('/hosts/') && r.url().includes('/test') && r.request().method() === 'POST',
                20000,
            )
            await testBtn.click()
            const testResp1 = await testApi1

            expect(testResp1.ok(), `First connection test failed: ${testResp1.status()}`).toBeTruthy()
            const testBody1 = await testResp1.json()
            expect(testBody1.success, 'First connection test should succeed — credential is valid').toBe(true)

            await ss(page, '03-first-connection-ok')

            // =================================================================
            // Step 3: Edit the host — change only the name, NOT the password
            // =================================================================
            const editBtn = hostRow.locator('button').filter({ hasText: /编辑|Edit/ })
            await expect(editBtn).toBeVisible({ timeout: 3000 })
            await editBtn.click()

            const editModal = page.locator('.modal')
            await expect(editModal).toBeVisible({ timeout: 5000 })
            await page.waitForTimeout(300)

            // Verify the credential field shows the masked value "***"
            const credTextarea = editModal.locator('textarea.form-input').first()
            const credValue = await credTextarea.inputValue()
            expect(credValue, 'Credential field should show masked "***" value when editing').toBe('***')

            // Change only the name field
            await fillByLabel(editModal, '名称|Name', UPDATED_NAME)

            await ss(page, '04-edit-form-with-masked-credential')

            // Save the edit — the frontend should exclude credential from the request
            const updateApi = waitForApi(
                page,
                r => r.url().includes(`/hosts/${hostId}`) && r.request().method() === 'PUT',
            )
            await editModal.locator('.modal-footer .btn-primary').click()
            const updateResp = await updateApi

            await ss(page, '05-after-edit-save')

            // Verify the update succeeded
            expect(updateResp.ok(), `Update host failed: ${updateResp.status()}`).toBeTruthy()
            const updateBody = await updateResp.json()
            expect(updateBody.success).toBe(true)
            expect(updateBody.host.name).toBe(UPDATED_NAME)

            // Verify the request body did NOT send "***" as credential
            const reqBody = JSON.parse(updateResp.request().postData() || '{}')
            // The credential should either be absent or not be "***"
            if (reqBody.credential !== undefined) {
                expect(reqBody.credential, 'Backend should not receive "***" as credential value').not.toBe('***')
            }

            await expect(editModal).not.toBeVisible({ timeout: 3000 })
            await page.waitForTimeout(1000)

            // =================================================================
            // Step 4: Test connection again — must still succeed
            // =================================================================
            const updatedRow = page.locator('.data-table tbody tr').filter({ hasText: UPDATED_NAME })
            await expect(updatedRow).toBeVisible({ timeout: 5000 })

            const testBtn2 = updatedRow.locator('button').filter({ hasText: /测试连接|Test Connection|Test/ })
            await expect(testBtn2).toBeVisible({ timeout: 3000 })

            const testApi2 = waitForApi(
                page,
                r => r.url().includes('/hosts/') && r.url().includes('/test') && r.request().method() === 'POST',
                20000,
            )
            await testBtn2.click()
            const testResp2 = await testApi2

            expect(testResp2.ok(), `Second connection test failed: ${testResp2.status()}`).toBeTruthy()
            const testBody2 = await testResp2.json()
            expect(
                testBody2.success,
                'Second connection test must succeed — credential was preserved after edit',
            ).toBe(true)

            await ss(page, '06-second-connection-ok-credential-preserved')

            // =================================================================
            // Step 5: Verify the OK indicator is shown
            // =================================================================
            const okIndicator = updatedRow.locator('span').filter({ hasText: 'OK' })
            await expect(okIndicator, 'Expected "OK" indicator after second connection test').toBeVisible({ timeout: 5000 })

            await ss(page, '07-final-ok-state')

        } finally {
            // =================================================================
            // Step 6: Cleanup
            // =================================================================
            const cleanupRow = page.locator('.data-table tbody tr').filter({ hasText: UPDATED_NAME })
            if (await cleanupRow.isVisible({ timeout: 3000 }).catch(() => false)) {
                const deleteBtn = cleanupRow.locator('.btn-danger')
                if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    page.once('dialog', d => d.accept())
                    await deleteBtn.click()
                    await page.waitForTimeout(1000)
                }
            }
            await ss(page, '08-cleaned-up')
        }
    })
})

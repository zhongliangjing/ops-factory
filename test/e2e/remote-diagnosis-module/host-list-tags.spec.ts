/**
 * E2E Test: Host List — Tags Display & CRUD Verification
 *
 * Verifies host list configuration and modification capabilities,
 * with a focus on the tag display issue:
 *   1. Login and navigate to Diagnosis → Hosts tab
 *   2. Create a host WITH tags — verify tags render in the table row
 *   3. Edit the host — verify tags are preserved in the edit form
 *   4. Modify tags (add / remove) — verify changes persist after save
 *   5. Create a second host with different tags
 *   6. Verify tag filter bar appears and works
 *   7. Delete both hosts (cleanup)
 *
 * Every step takes a screenshot and validates API responses.
 */
import { test, expect, type Page, type Response } from '@playwright/test'

const ADMIN_USER = 'admin'
const SS_DIR = 'test-results/host-list-tags'

const HOST_A = {
    name: 'E2E-TagHost-A',
    ip: '10.0.0.101',
    port: 22,
    username: 'admin',
    authType: 'password',
    credential: 'test-pass',
    tags: ['WEB', 'PROD'],
    description: 'Tag test host A',
}

const HOST_B = {
    name: 'E2E-TagHost-B',
    ip: '10.0.0.102',
    port: 22,
    username: 'admin',
    authType: 'password',
    credential: 'test-pass',
    tags: ['DB', 'PROD'],
    description: 'Tag test host B',
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

/** Fill a form input by its label text (bilingual) */
async function fillByLabel(
    modal: ReturnType<Page['locator']>,
    labelPattern: string,
    value: string,
) {
    const label = modal.locator('.form-label').filter({ hasText: new RegExp(labelPattern) })
    const group = label.locator('..')
    const input = group.locator('input.form-input').first()
    await input.fill(value)
}

/** Fill a form textarea by its label text (bilingual) */
async function fillTextareaByLabel(
    modal: ReturnType<Page['locator']>,
    labelPattern: string,
    value: string,
) {
    const label = modal.locator('.form-label').filter({ hasText: new RegExp(labelPattern) })
    const group = label.locator('..')
    const textarea = group.locator('textarea.form-input').first()
    await textarea.fill(value)
}

/**
 * Find the TagInput's text input inside the modal form.
 * Hosts.tsx TagInput renders:
 *   form-group > label + div[style="position:relative"] > div[style="display:flex"] > input
 */
function getTagInput(modal: ReturnType<Page['locator']>) {
    const tagsLabel = modal.locator('.form-label').filter({ hasText: /标签|Tags/ })
    const formGroup = tagsLabel.locator('..')
    return formGroup.locator('input[type="text"]').first()
}

/** Add tags into the TagInput component (type + Enter for each) */
async function addTagsToInput(
    page: Page,
    modal: ReturnType<Page['locator']>,
    tags: string[],
) {
    const tagInput = getTagInput(modal)
    for (const tag of tags) {
        await tagInput.fill(tag)
        await tagInput.press('Enter')
        await page.waitForTimeout(200)
    }
}

/**
 * Create a host via the UI modal form.
 * IMPORTANT: Caller must already be on the Hosts tab.
 */
async function createHostViaUI(
    page: Page,
    host: typeof HOST_A,
): Promise<string> {
    // Click the first btn-primary on page ("Add Host" button)
    await page.locator('.btn-primary').first().click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(300)

    // Name
    const nameLabel = modal.locator('.form-label').filter({ hasText: /名称|Name/ })
    if ((await nameLabel.count()) > 0) {
        const nameGroup = nameLabel.locator('..')
        await nameGroup.locator('input').first().fill(host.name)
    }

    // IP
    const ipLabel = modal.locator('.form-label').filter({ hasText: /IP/ })
    if ((await ipLabel.count()) > 0) {
        const ipGroup = ipLabel.locator('..')
        await ipGroup.locator('input').first().fill(host.ip)
    }

    // Port
    await modal.locator('input[type="number"]').fill(String(host.port))

    // Username
    const userLabel = modal.locator('.form-label').filter({ hasText: /用户名|Username/ })
    if ((await userLabel.count()) > 0) {
        const userGroup = userLabel.locator('..')
        await userGroup.locator('input').first().fill(host.username)
    }

    // Auth type
    await modal.locator('select.form-input').first().selectOption(host.authType)

    // Credential
    const credLabel = modal.locator('.form-label').filter({ hasText: /凭据|Credential/ })
    if ((await credLabel.count()) > 0) {
        const credGroup = credLabel.locator('..')
        await credGroup.locator('textarea').first().fill(host.credential)
    }

    // Tags — use TagInput (type each + Enter)
    await addTagsToInput(page, modal, host.tags)

    // Description (optional)
    const descLabel = modal.locator('.form-label').filter({ hasText: /描述|Description/ })
    if ((await descLabel.count()) > 0) {
        const descGroup = descLabel.locator('..')
        await descGroup.locator('textarea').first().fill(host.description ?? '')
    }

    await ss(page, `form-filled-${host.name}`)

    // Submit
    const apiPromise = waitForApi(
        page,
        r => r.url().includes('/hosts') && r.request().method() === 'POST' && !r.url().includes('/hosts/'),
    )
    await modal.locator('.modal-footer .btn-primary').click()
    const resp = await apiPromise

    expect(resp.ok(), `Create host "${host.name}" failed: ${resp.status()}`).toBeTruthy()
    const body = await resp.json()
    expect(body.success, `API returned success:false for "${host.name}"`).toBe(true)

    const hostId = body.host?.id
    expect(hostId, `Host ID is empty for "${host.name}"`).toBeTruthy()

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 3000 })
    await page.waitForTimeout(800)

    return hostId
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('Host List — Tags Display & Modification', () => {
    test.setTimeout(180_000)

    test.beforeEach(async ({ page }) => {
        await loginAs(page, ADMIN_USER)
        await page.goto('/remote-diagnosis')
        await page.waitForTimeout(1500)
        await clickTab(page, '主机管理|Hosts')
        await page.waitForTimeout(1000)

        // Clean up ALL stale test hosts from previous runs (loop until gone)
        for (const hostDef of [HOST_A, HOST_B]) {
            for (let attempt = 0; attempt < 5; attempt++) {
                const staleRow = page.locator('.data-table tbody tr').filter({ hasText: hostDef.name }).first()
                if ((await staleRow.count()) === 0 || !(await staleRow.isVisible())) break
                const deleteBtn = staleRow.locator('.btn-danger')
                if ((await deleteBtn.count()) > 0) {
                    page.once('dialog', d => d.accept())
                    await deleteBtn.click().catch(() => {})
                    await page.waitForTimeout(800)
                } else {
                    break
                }
            }
        }
    })

    test('create host with tags and verify tag display in list', async ({ page }) => {
        // =================================================================
        // Step 1: Create Host A with tags [WEB, PROD]
        // =================================================================
        const hostIdA = await createHostViaUI(page, HOST_A)

        await ss(page, '01-host-a-created')

        // =================================================================
        // Step 2: Verify tags are visible in the table row
        // =================================================================
        const hostRowA = page.locator('.data-table tbody tr').filter({ hasText: HOST_A.name }).first()
        await expect(hostRowA, `Host A row not found in table`).toBeVisible({ timeout: 5000 })

        // Verify each tag is rendered as a chip/badge in the tags column
        for (const tag of HOST_A.tags) {
            const tagSpan = hostRowA.locator('span').filter({ hasText: new RegExp(`^${tag}$`) })
            await expect(
                tagSpan,
                `Tag "${tag}" not visible in host row for "${HOST_A.name}"`,
            ).toBeVisible({ timeout: 3000 })
        }

        await ss(page, '02-host-a-tags-visible')

        // =================================================================
        // Step 3: Edit Host A — verify tags are preserved in form
        // =================================================================
        const editBtnA = hostRowA.locator('button').filter({ hasText: /编辑|Edit/ })
        await expect(editBtnA).toBeVisible({ timeout: 3000 })
        await editBtnA.click()

        const modal = page.locator('.modal')
        await expect(modal).toBeVisible({ timeout: 5000 })

        // Verify existing tag chips are present in the TagInput
        // Note: .tag-chip text includes "×" button char, so use string match (contains)
        for (const tag of HOST_A.tags) {
            const tagChip = modal.locator('.tag-chip').filter({ hasText: tag })
            await expect(
                tagChip,
                `Tag chip "${tag}" not found in edit form for "${HOST_A.name}"`,
            ).toBeVisible({ timeout: 3000 })
        }

        await ss(page, '03-edit-form-tags-preserved')

        // =================================================================
        // Step 4: Add a new tag "STAGING" via edit form
        // =================================================================
        await addTagsToInput(page, modal, ['STAGING'])

        // Verify the new tag chip appears
        const newTagChip = modal.locator('.tag-chip').filter({ hasText: 'STAGING' })
        await expect(newTagChip, 'New tag "STAGING" not shown as chip in edit form').toBeVisible({ timeout: 3000 })

        await ss(page, '04-new-tag-added-in-edit')

        // Save the edit
        const updateApi = waitForApi(
            page,
            r => r.url().includes(`/hosts/${hostIdA}`) && r.request().method() === 'PUT',
        )
        await modal.locator('.modal-footer .btn-primary').click()
        const updateResp = await updateApi

        expect(updateResp.ok(), `Update host failed: ${updateResp.status()}`).toBeTruthy()
        const updateBody = await updateResp.json()
        expect(updateBody.success, `Update returned success:false`).toBe(true)

        await expect(modal).not.toBeVisible({ timeout: 3000 })
        await page.waitForTimeout(1000)

        await ss(page, '05-host-a-updated')

        // =================================================================
        // Step 5: Verify updated tags in table (WEB, PROD, STAGING)
        // =================================================================
        const updatedRow = page.locator('.data-table tbody tr').filter({ hasText: HOST_A.name }).first()
        await expect(updatedRow).toBeVisible({ timeout: 5000 })

        const expectedTags = [...HOST_A.tags, 'STAGING']
        for (const tag of expectedTags) {
            const tagSpan = updatedRow.locator('span').filter({ hasText: new RegExp(`^${tag}$`) })
            await expect(
                tagSpan,
                `Updated tag "${tag}" not visible after edit`,
            ).toBeVisible({ timeout: 3000 })
        }

        await ss(page, '06-updated-tags-in-table')

        // =================================================================
        // Step 6: Remove a tag via edit — remove "STAGING"
        // =================================================================
        const editBtn2 = updatedRow.locator('button').filter({ hasText: /编辑|Edit/ })
        await editBtn2.click()
        await expect(modal).toBeVisible({ timeout: 5000 })

        // Click the × button on the "STAGING" tag chip
        const stagingChip = modal.locator('.tag-chip').filter({ hasText: 'STAGING' })
        await expect(stagingChip).toBeVisible({ timeout: 3000 })
        await stagingChip.locator('button').click()
        await page.waitForTimeout(300)

        // Verify STAGING is gone from the form
        await expect(
            modal.locator('.tag-chip').filter({ hasText: 'STAGING' }),
            'STAGING tag should be removed from form',
        ).not.toBeVisible({ timeout: 2000 })

        await ss(page, '07-tag-removed-in-edit')

        // Save
        const updateApi2 = waitForApi(
            page,
            r => r.url().includes(`/hosts/${hostIdA}`) && r.request().method() === 'PUT',
        )
        await modal.locator('.modal-footer .btn-primary').click()
        const updateResp2 = await updateApi2
        expect(updateResp2.ok()).toBeTruthy()
        await expect(modal).not.toBeVisible({ timeout: 3000 })
        await page.waitForTimeout(1000)

        // Verify STAGING no longer in table
        const rowAfterRemove = page.locator('.data-table tbody tr').filter({ hasText: HOST_A.name }).first()
        await expect(
            rowAfterRemove.locator('span').filter({ hasText: /^STAGING$/ }),
            'STAGING tag should be gone from table',
        ).not.toBeVisible({ timeout: 3000 })

        // Verify original tags still there
        for (const tag of HOST_A.tags) {
            const tagSpan = rowAfterRemove.locator('span').filter({ hasText: new RegExp(`^${tag}$`) })
            await expect(tagSpan, `Original tag "${tag}" should still be present`).toBeVisible({ timeout: 3000 })
        }

        await ss(page, '08-tag-removal-verified')

        // =================================================================
        // Step 7: Create Host B with tags [DB, PROD]
        // =================================================================
        const hostIdB = await createHostViaUI(page, HOST_B)

        await ss(page, '09-host-b-created')

        // Verify Host B tags in table
        const hostRowB = page.locator('.data-table tbody tr').filter({ hasText: HOST_B.name })
        await expect(hostRowB).toBeVisible({ timeout: 5000 })
        for (const tag of HOST_B.tags) {
            const tagSpan = hostRowB.locator('span').filter({ hasText: new RegExp(`^${tag}$`) })
            await expect(tagSpan, `Tag "${tag}" not visible for "${HOST_B.name}"`).toBeVisible({ timeout: 3000 })
        }

        await ss(page, '10-host-b-tags-visible')

        // =================================================================
        // Step 8: Verify tag filter bar and filter functionality
        // =================================================================
        await page.waitForTimeout(500)

        // Click "PROD" tag filter button — should show both hosts
        const prodFilterBtn = page.locator('button').filter({ hasText: /^PROD$/ }).first()
        if ((await prodFilterBtn.count()) > 0) {
            await prodFilterBtn.click()
            await page.waitForTimeout(500)

            const rows = page.locator('.data-table tbody tr')
            const count = await rows.count()
            expect(count, 'PROD filter should show both hosts').toBeGreaterThanOrEqual(2)

            await ss(page, '11-filter-prod-both-hosts')

            // Clear filter
            const allBtn = page.locator('button').filter({ hasText: /全部|All/ }).first()
            if ((await allBtn.count()) > 0) {
                await allBtn.click()
                await page.waitForTimeout(500)
            }
        }

        // Click "WEB" tag filter — should show only Host A
        const webFilterBtn = page.locator('button').filter({ hasText: /^WEB$/ }).first()
        if ((await webFilterBtn.count()) > 0) {
            await webFilterBtn.click()
            await page.waitForTimeout(500)

            const filteredRows = page.locator('.data-table tbody tr')
            const filteredCount = await filteredRows.count()
            expect(filteredCount, 'WEB filter should show only 1 host').toBeLessThanOrEqual(1)

            await expect(
                page.locator('.data-table tbody tr').filter({ hasText: HOST_A.name }),
            ).toBeVisible({ timeout: 3000 })

            await ss(page, '12-filter-web-only-host-a')

            // Clear filter
            const allBtn2 = page.locator('button').filter({ hasText: /全部|All/ }).first()
            if ((await allBtn2.count()) > 0) {
                await allBtn2.click()
                await page.waitForTimeout(500)
            }
        }

        await ss(page, '13-filter-cleared')

        // =================================================================
        // Step 9: Cleanup — delete both test hosts
        // =================================================================
        for (const hostDef of [HOST_A, HOST_B]) {
            const row = page.locator('.data-table tbody tr').filter({ hasText: hostDef.name }).first()
            if ((await row.count()) > 0) {
                const deleteBtn = row.locator('.btn-danger')
                if ((await deleteBtn.count()) > 0) {
                    page.once('dialog', d => d.accept())
                    const delApi = waitForApi(
                        page,
                        r => r.url().includes('/hosts/') && r.request().method() === 'DELETE',
                    ).catch(() => null)
                    await deleteBtn.click()
                    const delResp = await delApi
                    if (delResp) {
                        expect(delResp.ok(), `Delete "${hostDef.name}" failed`).toBeTruthy()
                    }
                    await page.waitForTimeout(500)
                }
            }
        }

        await ss(page, '14-cleanup-done')
    })
})

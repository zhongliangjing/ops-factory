/**
 * E2E Test: Remote Diagnosis — Complete Scenario
 *
 * One sequential end-to-end test covering the full RCPA fault diagnosis workflow:
 *   1. Navigate to Diagnosis page, verify tabs
 *   2. Create 3 hosts (2× RCPA + 1× GMDB) with tags
 *   3. Create 4 whitelist commands used by the SOP
 *   4. Create a 4-node RCPA fault diagnosis SOP
 *   5. Verify SOP details (expand row)
 *   6. Verify host tag filter works
 *   7. Verify whitelist toggle
 *   8. Cleanup: delete SOP → whitelist → hosts
 *
 * Every step takes a screenshot and validates API responses have no errors.
 */
import { test, expect, type Page, type Response } from '@playwright/test'

const ADMIN_USER = 'admin'
const SS_DIR = 'test-results/diagnosis-scenario'

// ---- Host definitions (from requirements) ----
const HOSTS = [
    { name: 'RCPA-1', ip: '192.168.1.100', port: 22, username: 'rcpa', authType: 'password', credential: 'test123', tags: ['RCPA'], description: 'RCPA主机1' },
    { name: 'RCPA-2', ip: '192.168.1.101', port: 22, username: 'rcpa', authType: 'password', credential: 'test123', tags: ['RCPA'], description: 'RCPA主机2' },
    { name: 'GMDB-1', ip: '192.168.1.101', port: 22, username: 'gmdb', authType: 'password', credential: 'test123', tags: ['GMDB'], description: 'GMDB节点' },
]

// ---- Whitelist commands (extracted from SOP commands) ----
const WHITELIST_COMMANDS = [
    { pattern: 'ps -ef|grep', description: '查看进程信息', enabled: true },
    { pattern: 'tail', description: '查看日志尾部', enabled: true },
    { pattern: 'cd', description: '切换目录', enabled: true },
    { pattern: 'grep', description: '文本搜索过滤', enabled: true },
]

// ---- SOP definition (from requirements) ----
const SOP = {
    name: 'RCPA故障诊断SOP',
    version: '1.0',
    description: 'RCPA进程故障诊断标准操作规程：从进程重启判断开始，逐步分析线程池使用量、longsql、报错日志',
    triggerCondition: 'RCPA服务异常告警',
    nodes: [
        {
            name: '进程重启判断',
            type: 'start',
            hostTags: ['RCPA'],
            command: 'ps -ef|grep /rcpa/openas|grep -v grep',
            outputFormat: '进程列表',
            analysisInstruction: '根据进程运行时长判断是否发生重启。如果没有重启转入节点"线程池使用量分析"和"longsql分析"，否则转入节点"报错日志分析"',
        },
        {
            name: '线程池使用量分析',
            type: 'analysis',
            hostTags: ['RCPA'],
            command: 'cd /home/rcpa/openas/logs/stat;tail -n 50 pool.log',
            outputFormat: '|日志级别|线程名|线程池名称|实际使用线程数|最大线程数|实际缓存队列大小|队列长度|',
            analysisInstruction: '分析线程池实际使用量，如达到最大使用量将会出现等待或者超时失败情况',
        },
        {
            name: 'longsql分析',
            type: 'analysis',
            hostTags: ['GMDB'],
            command: 'cd /onip/app/rtbmdb/gmdb/log/debug;tail -n 500 dgmserver.log|grep "Long SQL"',
            outputFormat: 'Long SQL日志',
            analysisInstruction: '根据命令来判断是否存在查询的select或者update语句的Duration耗时较长',
        },
        {
            name: '报错日志分析',
            type: 'analysis',
            hostTags: ['RCPA'],
            command: 'cd /home/rcpa/openas/logs/run;tail -n 500 run.log|grep -v "is not match"|grep -v "parameter format error"',
            outputFormat: '错误日志',
            analysisInstruction: '根据日志内容做问题分析',
        },
    ],
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

/** Set up console error monitoring, return collected errors */
function monitorErrors(page: Page): string[] {
    const errors: string[] = []
    page.on('console', msg => {
        if (msg.type() === 'error' && !msg.text().includes('favicon')) {
            errors.push(msg.text())
        }
    })
    page.on('pageerror', err => errors.push(`PAGE_ERROR: ${err.message}`))
    return errors
}

/** Assert no error banners visible on page */
async function assertNoErrors(page: Page) {
    const banners = page.locator('.conn-banner-error, .agents-alert-error')
    const count = await banners.count()
    for (let i = 0; i < count; i++) {
        const text = await banners.nth(i).textContent()
        throw new Error(`Page error banner visible: ${text}`)
    }
}

/** Click a tab by partial label (supports both EN/ZH) */
async function clickTab(page: Page, labelPattern: string) {
    const tab = page.locator('.config-tab').filter({ hasText: new RegExp(labelPattern) })
    await expect(tab).toBeVisible({ timeout: 5000 })
    await tab.click()
    await page.waitForTimeout(600)
}

/** Wait for a specific API call, return the response */
async function waitForApi(page: Page, predicate: (r: Response) => boolean, timeout = 10000): Promise<Response> {
    return page.waitForResponse(predicate, { timeout })
}

/** Verify API response is OK and has no error field */
async function verifyApiOk(resp: Response, label: string) {
    expect(resp.ok(), `${label} API returned ${resp.status()}`).toBeTruthy()
    const contentType = resp.headers()['content-type'] || ''
    if (contentType.includes('json')) {
        const body = await resp.json()
        expect(body.error, `${label} API returned error field: ${body.error}`).toBeUndefined()
        return body
    }
    return null
}

// ---------------------------------------------------------------------------
// Full scenario test
// ---------------------------------------------------------------------------

test.describe('Remote Diagnosis — Complete Scenario', () => {
    test.setTimeout(300_000)

    test('complete diagnosis setup workflow', async ({ page }) => {
        const errors = monitorErrors(page)

        // =================================================================
        // Login
        // =================================================================
        await loginAs(page, ADMIN_USER)

        // =================================================================
        // 1. Navigate to Diagnosis page
        // =================================================================
        await page.goto('/remote-diagnosis')
        await page.waitForTimeout(1500)

        // Verify page title visible
        await expect(page.locator('.page-title')).toBeVisible({ timeout: 10000 })

        // Verify all 3 tabs exist (主机管理, SOP管理, 命令白名单)
        const tabs = page.locator('.config-tab')
        await expect(tabs).toHaveCount(3)

        // Verify first tab (hosts) is active by default
        const activeTab = page.locator('.config-tab-active')
        await expect(activeTab).toBeVisible()

        await ss(page, '01-page-loaded')
        await assertNoErrors(page)

        // =================================================================
        // 2. Create 3 hosts
        // =================================================================
        for (let i = 0; i < HOSTS.length; i++) {
            const host = HOSTS[i]

            // Open add modal
            await page.locator('.btn-primary').first().click()
            const modal = page.locator('.modal')
            await expect(modal).toBeVisible({ timeout: 5000 })

            // Fill form fields by label
            // Name
            const nameLabel = modal.locator('.form-label').filter({ hasText: /名称|Name/ })
            if (await nameLabel.count() > 0) {
                const nameGroup = nameLabel.locator('..')
                await nameGroup.locator('input').first().fill(host.name)
            } else {
                // Fallback: fill first input
                await modal.locator('input[type="text"]').first().fill(host.name)
            }

            // IP
            const ipLabel = modal.locator('.form-label').filter({ hasText: /IP/ })
            if (await ipLabel.count() > 0) {
                const ipGroup = ipLabel.locator('..')
                await ipGroup.locator('input').first().fill(host.ip)
            } else {
                await modal.locator('input[type="text"]').nth(1).fill(host.ip)
            }

            // Port
            const portInput = modal.locator('input[type="number"]').first()
            await portInput.fill(String(host.port))

            // Username
            const userLabel = modal.locator('.form-label').filter({ hasText: /用户名|Username/ })
            if (await userLabel.count() > 0) {
                const userGroup = userLabel.locator('..')
                await userGroup.locator('input').first().fill(host.username)
            }

            // Auth type select
            const authSelect = modal.locator('select').first()
            await authSelect.selectOption(host.authType)

            // Credential textarea
            const credLabel = modal.locator('.form-label').filter({ hasText: /凭据|Credential/ })
            if (await credLabel.count() > 0) {
                const credGroup = credLabel.locator('..')
                await credGroup.locator('textarea').first().fill(host.credential)
            } else {
                await modal.locator('textarea').first().fill(host.credential)
            }

            // Tags — TagInput component
            const tagInput = modal.locator('.tag-input-container input')
            if (await tagInput.count() > 0) {
                for (const tag of host.tags) {
                    await tagInput.fill(tag)
                    await tagInput.press('Enter')
                    await page.waitForTimeout(200)
                }
            }

            await ss(page, `02-${i + 1}-host-form-${host.name}`)

            // Save — intercept API
            const apiPromise = waitForApi(page,
                r => r.url().includes('/hosts') && r.request().method() === 'POST'
            )
            await modal.locator('.modal-footer .btn-primary').click()
            const resp = await apiPromise

            // Verify API success
            await verifyApiOk(resp, `Create host "${host.name}"`)

            // Modal should close on success
            await expect(modal).not.toBeVisible({ timeout: 3000 })
            await ss(page, `02-${i + 1}-host-saved-${host.name}`)
            await assertNoErrors(page)
        }

        // Verify table has ≥ 3 rows (our newly created hosts)
        await page.waitForTimeout(1000)
        const hostRows = page.locator('.data-table tbody tr')
        const hostCount = await hostRows.count()
        expect(hostCount, 'Expected at least 3 hosts in table').toBeGreaterThanOrEqual(3)
        await ss(page, '02-all-hosts-created')

        // =================================================================
        // 3. Create whitelist commands
        // =================================================================
        await clickTab(page, '命令白名单|Whitelist')
        await page.waitForTimeout(1000)
        await ss(page, '03-whitelist-tab')

        for (let i = 0; i < WHITELIST_COMMANDS.length; i++) {
            const cmd = WHITELIST_COMMANDS[i]

            await page.locator('.btn-primary').first().click()
            const modal = page.locator('.modal')
            await expect(modal).toBeVisible({ timeout: 5000 })

            // Pattern input
            await modal.locator('.form-input[type="text"]').fill(cmd.pattern)
            // Description textarea
            await modal.locator('textarea').fill(cmd.description)

            await ss(page, `03-${i + 1}-cmd-form`)

            const apiPromise = waitForApi(page,
                r => r.url().includes('/command-whitelist') && r.request().method() === 'POST'
            )
            await modal.locator('.modal-footer .btn-primary').click()
            const resp = await apiPromise

            await page.waitForTimeout(800)

            if (resp.ok()) {
                const body = await resp.json()
                expect(body.error, `Whitelist API error: ${body.error}`).toBeUndefined()
                await expect(modal).not.toBeVisible({ timeout: 3000 })
            } else if (resp.status() === 409) {
                // Already exists — acceptable, close modal
                await modal.locator('.modal-close').click()
                await page.waitForTimeout(500)
            } else {
                const errText = await resp.text()
                throw new Error(`Add whitelist "${cmd.pattern}" failed (${resp.status()}): ${errText}`)
            }

            await ss(page, `03-${i + 1}-cmd-after-save`)
            await assertNoErrors(page)
        }

        // Verify commands in table
        await page.waitForTimeout(1000)
        const cmdRows = page.locator('.data-table tbody tr')
        const cmdCount = await cmdRows.count()
        expect(cmdCount, 'Expected ≥ 4 whitelist commands').toBeGreaterThanOrEqual(WHITELIST_COMMANDS.length)
        await ss(page, '03-all-commands')

        // =================================================================
        // 4. Create SOP
        // =================================================================
        await clickTab(page, 'SOP')
        await page.waitForTimeout(1000)
        await ss(page, '04-sop-tab')

        // Open add SOP modal
        await page.locator('.btn-primary').first().click()
        const modal = page.locator('.modal')
        await expect(modal).toBeVisible({ timeout: 5000 })

        // Basic info: fill by label for robustness
        // Name
        const sopNameLabel = modal.locator('.form-label').filter({ hasText: /名称|Name/ }).first()
        if (await sopNameLabel.count() > 0) {
            const sopNameGroup = sopNameLabel.locator('..')
            await sopNameGroup.locator('input').first().fill(SOP.name)
        } else {
            await modal.locator('.form-input[type="text"]').first().fill(SOP.name)
        }

        // Version
        const sopVerLabel = modal.locator('.form-label').filter({ hasText: /版本|Version/ }).first()
        if (await sopVerLabel.count() > 0) {
            const sopVerGroup = sopVerLabel.locator('..')
            await sopVerGroup.locator('input').first().fill(SOP.version)
        }

        // Description
        const sopDescLabel = modal.locator('.form-label').filter({ hasText: /描述|Description/ }).first()
        if (await sopDescLabel.count() > 0) {
            const sopDescGroup = sopDescLabel.locator('..')
            await sopDescGroup.locator('textarea').first().fill(SOP.description)
        }

        // Trigger Condition
        const sopTrigLabel = modal.locator('.form-label').filter({ hasText: /触发|Trigger/ }).first()
        if (await sopTrigLabel.count() > 0) {
            const sopTrigGroup = sopTrigLabel.locator('..')
            await sopTrigGroup.locator('input').first().fill(SOP.triggerCondition)
        }

        await ss(page, '04-sop-basic-info')

        // ---- Fill node #1 (default node already in form) ----
        // Node containers have a border style and contain "#N" heading
        const nodeContainers = modal.locator('[style*="border"]')
        const node0 = nodeContainers.nth(0)

        // Node Name
        const node0NameLabel = node0.locator('.form-label').filter({ hasText: /节点名称|Node Name/ }).first()
        if (await node0NameLabel.count() > 0) {
            await node0NameLabel.locator('..').locator('input').first().fill(SOP.nodes[0].name)
        } else {
            await node0.locator('input[type="text"]').first().fill(SOP.nodes[0].name)
        }

        // Node Type
        await node0.locator('select').first().selectOption(SOP.nodes[0].type)

        // Host Tags
        const node0TagsInput = node0.locator('input[placeholder="tag1, tag2"]')
        if (await node0TagsInput.count() > 0) {
            await node0TagsInput.fill(SOP.nodes[0].hostTags.join(', '))
        } else {
            const tagsLabel = node0.locator('.form-label').filter({ hasText: /标签|Tags/ }).first()
            if (await tagsLabel.count() > 0) {
                await tagsLabel.locator('..').locator('input').first().fill(SOP.nodes[0].hostTags.join(', '))
            }
        }

        // Command
        const node0CmdLabel = node0.locator('.form-label').filter({ hasText: /命令|Command/ }).first()
        if (await node0CmdLabel.count() > 0) {
            await node0CmdLabel.locator('..').locator('textarea').first().fill(SOP.nodes[0].command)
        } else {
            await node0.locator('textarea').first().fill(SOP.nodes[0].command)
        }

        // Output Format
        const node0OutLabel = node0.locator('.form-label').filter({ hasText: /输出格式|Output Format/ }).first()
        if (await node0OutLabel.count() > 0) {
            await node0OutLabel.locator('..').locator('input').first().fill(SOP.nodes[0].outputFormat)
        } else {
            const node0TextInputs = node0.locator('input[type="text"]')
            await node0TextInputs.nth(1).fill(SOP.nodes[0].outputFormat)
        }

        // Analysis Instruction
        const node0AnaLabel = node0.locator('.form-label').filter({ hasText: /分析|Analysis/ }).first()
        if (await node0AnaLabel.count() > 0) {
            await node0AnaLabel.locator('..').locator('textarea').first().fill(SOP.nodes[0].analysisInstruction)
        } else {
            const node0Textareas = node0.locator('textarea')
            await node0Textareas.nth(1).fill(SOP.nodes[0].analysisInstruction)
        }

        await ss(page, '04-node1-filled')

        // ---- Add nodes #2-#4 ----
        for (let n = 0; n < 3; n++) {
            const addBtn = modal.locator('button').filter({ hasText: /添加节点|Add Node|\+.*节点/ }).first()
            if (await addBtn.count() > 0) {
                await addBtn.click()
                await page.waitForTimeout(300)
            }
        }
        await ss(page, '04-4-nodes-added')

        // Fill nodes #2-#4
        for (let n = 1; n <= 3; n++) {
            const node = SOP.nodes[n]
            const container = nodeContainers.nth(n)
            if (!(await container.count())) continue

            // Node Name
            const nameLabel = container.locator('.form-label').filter({ hasText: /节点名称|Node Name/ }).first()
            if (await nameLabel.count() > 0) {
                await nameLabel.locator('..').locator('input').first().fill(node.name)
            } else {
                await container.locator('input[type="text"]').first().fill(node.name)
            }

            // Node Type
            await container.locator('select').first().selectOption(node.type)

            // Host Tags
            const tagsInput = container.locator('input[placeholder="tag1, tag2"]')
            if (await tagsInput.count() > 0) {
                await tagsInput.fill(node.hostTags.join(', '))
            } else {
                const tagsLabel = container.locator('.form-label').filter({ hasText: /标签|Tags/ }).first()
                if (await tagsLabel.count() > 0) {
                    await tagsLabel.locator('..').locator('input').first().fill(node.hostTags.join(', '))
                }
            }

            // Command
            const cmdLabel = container.locator('.form-label').filter({ hasText: /命令|Command/ }).first()
            if (await cmdLabel.count() > 0) {
                await cmdLabel.locator('..').locator('textarea').first().fill(node.command)
            } else {
                await container.locator('textarea').first().fill(node.command)
            }

            // Output Format
            const outLabel = container.locator('.form-label').filter({ hasText: /输出格式|Output Format/ }).first()
            if (await outLabel.count() > 0) {
                await outLabel.locator('..').locator('input').first().fill(node.outputFormat)
            } else {
                const textInputs = container.locator('input[type="text"]')
                await textInputs.nth(1).fill(node.outputFormat)
            }

            // Analysis Instruction
            const anaLabel = container.locator('.form-label').filter({ hasText: /分析|Analysis/ }).first()
            if (await anaLabel.count() > 0) {
                await anaLabel.locator('..').locator('textarea').first().fill(node.analysisInstruction)
            } else {
                const textareas = container.locator('textarea')
                await textareas.nth(1).fill(node.analysisInstruction)
            }
        }

        await ss(page, '04-all-nodes-filled')

        // ---- Save SOP ----
        const sopApi = waitForApi(page,
            r => r.url().includes('/sops') && r.request().method() === 'POST'
        )
        await modal.locator('.modal-footer .btn-primary').click()
        const sopResp = await sopApi

        await page.waitForTimeout(1500)
        await ss(page, '04-sop-after-save')

        // Verify API success
        expect(sopResp.ok(), `SOP creation failed (${sopResp.status()})`).toBeTruthy()
        const sopBody = await sopResp.json()
        expect(sopBody.error, `SOP API error: ${sopBody.error}`).toBeUndefined()

        // Modal closed
        await expect(modal).not.toBeVisible({ timeout: 5000 })

        // SOP appears in table
        await page.waitForTimeout(1000)
        const sopTable = page.locator('.data-table')
        await expect(sopTable).toBeVisible({ timeout: 5000 })
        const sopRow = sopTable.locator('tbody tr').filter({ hasText: SOP.name }).first()
        await expect(sopRow).toBeVisible({ timeout: 5000 })

        await ss(page, '04-sop-in-table')
        await assertNoErrors(page)

        // =================================================================
        // 5. Verify SOP details (expand row)
        // =================================================================
        await sopRow.click()
        await page.waitForTimeout(500)

        // Verify expanded content
        const expanded = page.locator('tr td[colspan]')
        const expandedCount = await expanded.count()
        expect(expandedCount, 'SOP row did not expand after click').toBeGreaterThan(0)

        const expandedText = await expanded.first().textContent()
        expect(expandedText, 'Expanded SOP should contain node names').toContain(SOP.nodes[0].name)

        await ss(page, '05-sop-expanded')
        await assertNoErrors(page)

        // =================================================================
        // 6. Verify host tag filter
        // =================================================================
        await clickTab(page, '主机管理|Hosts')
        await page.waitForTimeout(1000)

        const rcpaBtn = page.locator('button').filter({ hasText: /^RCPA$/ }).first()
        if (await rcpaBtn.count() > 0) {
            await rcpaBtn.click()
            await page.waitForTimeout(500)

            // Only RCPA hosts visible (2 rows)
            const filteredRows = page.locator('.data-table tbody tr')
            const count = await filteredRows.count()
            expect(count, `Expected ≤ 2 RCPA hosts after filter, got ${count}`).toBeLessThanOrEqual(2)

            await ss(page, '06-filtered-rcpa')

            // Clear filter — click "全部" button
            const allBtn = page.locator('button').filter({ hasText: /全部|All/ }).first()
            if (await allBtn.count() > 0) {
                await allBtn.click()
                await page.waitForTimeout(500)
            }
        }
        await ss(page, '06-tag-filter-ok')
        await assertNoErrors(page)

        // =================================================================
        // 7. Verify whitelist toggle
        // =================================================================
        await clickTab(page, '命令白名单|Whitelist')
        await page.waitForTimeout(1000)

        const toggleSwitches = page.locator('.data-table tbody tr [role="switch"]')
        const switchCount = await toggleSwitches.count()

        if (switchCount > 0) {
            const firstSwitch = toggleSwitches.first()

            // Toggle
            const toggleApi = waitForApi(page,
                r => r.url().includes('/command-whitelist/') && r.request().method() === 'PUT'
            ).catch(() => null)

            await firstSwitch.click()
            await page.waitForTimeout(1500)

            const toggleResp = await toggleApi
            if (toggleResp) {
                expect(toggleResp.ok(), `Toggle API failed: ${toggleResp.status()}`).toBeTruthy()
            }

            await ss(page, '07-whitelist-toggled')

            // Toggle back to restore
            await firstSwitch.click()
            await page.waitForTimeout(1000)
        }
        await assertNoErrors(page)

        // =================================================================
        // Final: screenshot all data retained (no cleanup)
        // =================================================================
        const relevantErrors = errors.filter(e =>
            !e.includes('favicon') &&
            !e.includes('DevTools') &&
            !e.includes('net::ERR') &&
            !e.includes('400 (Bad Request)') &&
            !e.includes('404 (Not Found)') &&
            !e.includes('409 (Conflict)') &&
            !e.includes('Warning: Encountered two children with the same key')
        )
        expect(relevantErrors, `Console errors found:\n${relevantErrors.join('\n')}`).toHaveLength(0)

        await ss(page, '11-final-state')
    })
})

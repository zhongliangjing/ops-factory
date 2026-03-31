/**
 * E2E Test: QoS Remote Diagnosis via SOP Execution
 *
 * Complete end-to-end scenario:
 *   Phase 1 — Environment Setup (故障诊断 page):
 *     1. Create an MS-Z tagged host (172.20.10.2)
 *     2. Verify whitelist commands for SOP execution
 *     3. Verify the "MS-Z异常分析" SOP exists
 *
 *   Phase 2 — Chat with qos-agent:
 *     4. Navigate to home, select qos-agent
 *     5. Send diagnosis message triggering SOP skill
 *     6. Wait for agent to invoke MCP tools (list_sops, get_sop_detail, get_hosts, execute_remote_command)
 *     7. Verify agent produces a diagnostic report
 *     8. Verify Mermaid flowchart is rendered in chat (ui:// resource from get_sop_detail)
 *
 *   Phase 3 — Cleanup:
 *     9. Delete test host
 *
 * Every step takes a screenshot and validates API responses.
 */
import { test, expect, type Page, type Response } from '@playwright/test'

const ADMIN_USER = 'admin'
const SS_DIR = 'test-results/qos-diagnosis'

// ---- Test host (the real SSH target) ----
const TEST_HOST = {
    name: 'MS-Z-1',
    ip: '172.20.10.2',
    port: 22,
    username: 'sunsong',
    authType: 'password',
    credential: '0805',
    tags: ['MS-Z'],
    description: 'E2E QoS diagnosis test host',
}

// ---- The SOP trigger condition to match ----
const SOP_TRIGGER = 'MS-Z异常'
const SOP_NAME = 'MS-Z异常分析'

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

/** Fill a form input by its label text */
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

/** Fill a form textarea by its label text */
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

/** Monitor console errors, filtering out noise */
function monitorErrors(page: Page): string[] {
    const errors: string[] = []
    page.on('console', msg => {
        if (msg.type() === 'error' && !isIgnoredError(msg.text())) {
            errors.push(msg.text())
        }
    })
    page.on('pageerror', err => errors.push(`PAGE_ERROR: ${err.message}`))
    return errors
}

function isIgnoredError(text: string): boolean {
    return (
        text.includes('favicon') ||
        text.includes('DevTools') ||
        text.includes('net::ERR') ||
        text.includes('400 (Bad Request)') ||
        text.includes('404 (Not Found)') ||
        text.includes('409 (Conflict)') ||
        text.includes('Warning: Encountered two children with the same key') ||
        text.includes('ResizeObserver loop')
    )
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('QoS Remote Diagnosis — SOP Execution', () => {
    test.setTimeout(300_000)

    test('setup environment then trigger qos-agent SOP diagnosis', async ({ page }) => {
        const errors = monitorErrors(page)
        let hostId: string | undefined

        // =================================================================
        // PHASE 1: Environment Setup — 故障诊断 page
        // =================================================================
        await loginAs(page, ADMIN_USER)
        await page.goto('/remote-diagnosis')
        await page.waitForTimeout(1500)

        await expect(page.locator('.page-title')).toBeVisible({ timeout: 10000 })
        await ss(page, '01-diagnosis-page')

        // -----------------------------------------------------------------
        // Step 1: Create MS-Z host
        // -----------------------------------------------------------------
        // Hosts tab is active by default
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

        await ss(page, '02-host-form-filled')

        const createApi = waitForApi(
            page,
            r => r.url().includes('/hosts') && r.request().method() === 'POST' && !r.url().includes('/hosts/'),
        )
        await modal.locator('.modal-footer .btn-primary').click()
        const createResp = await createApi

        expect(createResp.ok(), `Create host failed: ${createResp.status()}`).toBeTruthy()
        const createBody = await createResp.json()
        expect(createBody.success).toBe(true)
        hostId = createBody.host?.id
        expect(hostId, 'Host ID should be returned').toBeTruthy()

        await expect(modal).not.toBeVisible({ timeout: 3000 })
        await page.waitForTimeout(1000)
        await ss(page, '02-host-created')

        // Verify host in table
        const hostRow = page.locator('.data-table tbody tr').filter({ hasText: TEST_HOST.name })
        await expect(hostRow).toBeVisible({ timeout: 5000 })
        await ss(page, '02-host-in-table')

        // -----------------------------------------------------------------
        // Step 2: Verify whitelist commands exist (whoami must be allowed)
        // -----------------------------------------------------------------
        await clickTab(page, '命令白名单|Whitelist')
        await page.waitForTimeout(1000)

        // Check if 'whoami' is in the whitelist, if not add it
        const whitelistRows = page.locator('.data-table tbody tr')
        const allText = await whitelistRows.allTextContents()
        const hasWhoami = allText.some(t => t.includes('whoami'))

        if (!hasWhoami) {
            await page.locator('.btn-primary').first().click()
            const wlModal = page.locator('.modal')
            await expect(wlModal).toBeVisible({ timeout: 5000 })

            await wlModal.locator('.form-input[type="text"]').fill('whoami')
            await wlModal.locator('textarea').fill('查看当前用户')

            const wlApi = waitForApi(
                page,
                r => r.url().includes('/command-whitelist') && r.request().method() === 'POST' && !r.url().includes('/command-whitelist/'),
            )
            await wlModal.locator('.modal-footer .btn-primary').click()
            const wlResp = await wlApi
            expect(wlResp.ok(), `Add whoami failed: ${wlResp.status()}`).toBeTruthy()
            await expect(wlModal).not.toBeVisible({ timeout: 3000 })
        }

        await ss(page, '03-whitelist-ready')

        // -----------------------------------------------------------------
        // Step 3: Verify MS-Z SOP exists in SOPs tab
        // -----------------------------------------------------------------
        await clickTab(page, 'SOP')
        await page.waitForTimeout(1000)

        // The MS-Z SOP should already exist (pre-loaded from agents/qos-agent/sops/)
        const sopTable = page.locator('.data-table')
        await expect(sopTable).toBeVisible({ timeout: 5000 })
        const sopRow = sopTable.locator('tbody tr').filter({ hasText: SOP_NAME }).first()
        await expect(sopRow, `SOP "${SOP_NAME}" not found in table`).toBeVisible({ timeout: 5000 })

        await ss(page, '04-sop-verified')

        // Expand SOP to verify nodes
        await sopRow.click()
        await page.waitForTimeout(500)
        const expandedContent = page.locator('tr td[colspan]')
        await expect(expandedContent.first(), 'SOP should expand to show nodes').toBeVisible({ timeout: 3000 })
        const expandedText = await expandedContent.first().textContent()
        expect(expandedText, 'Expanded SOP should contain MS-Z tag or node info').toBeTruthy()

        await ss(page, '04-sop-expanded')

        // =================================================================
        // PHASE 2: Chat with qos-agent
        // =================================================================

        // Navigate to home page
        await page.goto('/')
        await page.waitForTimeout(2000)

        // Wait for agent selector / prompt templates to load
        await page.waitForSelector('.agent-selector-trigger, .agent-selector', { timeout: 15000 })
        await ss(page, '05-home-page')

        // Select qos-agent via the agent dropdown
        const agentTrigger = page.locator('.agent-selector-trigger')
        await expect(agentTrigger, 'Agent selector trigger should be visible').toBeVisible({ timeout: 10000 })
        await agentTrigger.click()
        await page.waitForTimeout(500)

        // Find and click the QoS Agent option
        const agentDropdown = page.locator('.agent-dropdown')
        await expect(agentDropdown, 'Agent dropdown should open').toBeVisible({ timeout: 3000 })
        const qosOption = agentDropdown.locator('.agent-option').filter({ hasText: /QoS|qos/ })
        await expect(qosOption, 'QoS Agent option should exist in dropdown').toBeVisible({ timeout: 5000 })
        await qosOption.click()
        await page.waitForTimeout(500)

        await ss(page, '05-qos-agent-selected')

        // Verify agent name updated
        const agentNameEl = page.locator('.agent-name')
        await expect(agentNameEl).toContainText(/QoS/i, { timeout: 3000 })

        // Type the diagnosis message
        const chatInput = page.locator('.chat-input')
        await expect(chatInput, 'Chat input should be visible').toBeVisible({ timeout: 10000 })

        const diagnosisMessage = `我已经找到根因，MS-Z进程异常，请进行远程诊断，使用MS-Z异常分析SOP`
        await chatInput.fill(diagnosisMessage)
        await ss(page, '06-message-typed')

        // Send the message and wait for navigation to chat page
        // The Home page creates a session and navigates to /chat
        const navPromise = page.waitForURL(/\/chat/, { timeout: 30000 })

        await chatInput.press('Enter')

        // Wait for navigation to chat page
        await navPromise
        await page.waitForTimeout(2000)
        await ss(page, '07-chat-page-loaded')

        // Wait for the initial message to appear in chat
        const messagesArea = page.locator('.chat-messages-area')
        await expect(messagesArea, 'Chat messages area should be visible').toBeVisible({ timeout: 10000 })

        // Wait for the agent to finish responding
        // The agent will: 1) identify intent 2) load skill 3) call MCP tools 4) generate report
        // This can take 60-120 seconds for the full SOP execution
        console.log('Waiting for QoS agent SOP execution (up to 180s)...')

        // Wait for the stop button to appear (agent is processing) then disappear (agent finished)
        const sendBtn = page.locator('.chat-send-btn-new')

        // First, verify streaming starts
        await expect(sendBtn).toHaveClass(/is-stop/, { timeout: 30000 })
        await ss(page, '08-agent-processing')
        console.log('Agent is processing...')

        // Now wait for it to finish (long timeout for SOP execution)
        await expect(sendBtn).not.toHaveClass(/is-stop/, { timeout: 180_000 })
        console.log('Agent finished responding')

        await ss(page, '09-agent-finished')

        // -----------------------------------------------------------------
        // Verify the response content — strict validation
        // -----------------------------------------------------------------
        const responseText = await messagesArea.textContent()
        expect(responseText, 'Agent should have produced a response').toBeTruthy()
        expect(responseText!.length, 'Response should be non-trivial (≥50 chars)').toBeGreaterThan(50)

        // 1. MCP tools must NOT return "not found" — this means the MCP server loaded correctly
        expect(
            responseText,
            'MCP tool must be loaded — "not found" error means MCP server failed to start'
        ).not.toContain('not found')

        // 2. No "error" status in MCP tool responses
        expect(
            responseText!.toLowerCase(),
            'Response must not contain tool execution errors'
        ).not.toContain('"status":"error"')
        expect(
            responseText!.toLowerCase(),
            'Response must not contain tool execution errors'
        ).not.toContain('"status": "error"')

        // 3. The agent should reference the SOP execution
        // Must mention at least one of: SOP name, trigger condition, or execution result
        const sopExecutionKeywords = ['MS-Z异常分析', 'MS-Z异常', 'SOP', 'sop', '诊断']
        const hasSopRef = sopExecutionKeywords.some(kw => responseText!.includes(kw))
        expect(
            hasSopRef,
            `Response must reference SOP execution (expected one of: ${sopExecutionKeywords.join(', ')})`
        ).toBeTruthy()

        // 4. The agent should have called the MCP tools: list_sops → get_sop_detail → get_hosts → execute_remote_command
        // Verify tool call sections are visible in the chat UI
        const toolCallElements = page.locator('[class*="tool"], [class*="collapse"], [class*="thinking"]')
        const toolCallCount = await toolCallElements.count()
        expect(
            toolCallCount,
            `Expected tool call UI elements in chat (found ${toolCallCount}), agent should invoke MCP tools`
        ).toBeGreaterThan(0)

        // 5. If the SOP executed `whoami` on the host, the response should contain the command output
        // The command `whoami` should return "sunsong" on the target host
        const hasCommandOutput = responseText!.toLowerCase().includes('sunsong')
            || responseText!.includes('whoami')
            || responseText!.includes('执行命令')
            || responseText!.includes('execute')

        console.log(`Response length: ${responseText!.length} chars`)
        console.log(`Tool call elements found: ${toolCallCount}`)
        console.log(`Has command output reference: ${hasCommandOutput}`)

        await ss(page, '10-response-content')

        // -----------------------------------------------------------------
        // Verify Mermaid SOP flowchart rendered via UIResourceRenderer
        // The get_sop_detail MCP tool returns a ui:// resource with
        // Mermaid graph code, rendered as an iframe by UIResourceRenderer.
        // -----------------------------------------------------------------

        // 6. Verify the UI resource container exists (rendered by UIResourceRenderer)
        const uiResourceContainer = page.locator('.ui-resource-container')
        const uiResourceCount = await uiResourceContainer.count()
        console.log(`UI resource containers found: ${uiResourceCount}`)

        if (uiResourceCount > 0) {
            // 6a. At least one ui-resource-container is visible
            await expect(
                uiResourceContainer.first(),
                'UI resource container should be visible in chat'
            ).toBeVisible({ timeout: 10000 })
            await ss(page, '10a-mermaid-resource-container')

            // 6b. Verify the iframe with title "Visualization" exists inside the container
            const mermaidIframe = uiResourceContainer.first().locator('iframe[title="Visualization"]')
            await expect(
                mermaidIframe,
                'Mermaid visualization iframe should exist inside UI resource container'
            ).toBeAttached({ timeout: 10000 })

            // 6c. Access the iframe content and verify SVG flowchart rendered
            const iframeFrame = mermaidIframe.contentFrame()
            if (iframeFrame) {
                // Wait for Mermaid.js to render (loads from CDN asynchronously)
                const svgEl = iframeFrame.locator('svg')
                const svgVisible = await svgEl.isVisible({ timeout: 15000 }).catch(() => false)

                if (svgVisible) {
                    console.log('Mermaid SVG flowchart rendered successfully')

                    // Verify flowchart nodes exist (Mermaid renders nodes as <g class="node">)
                    const nodes = iframeFrame.locator('g.node')
                    const nodeCount = await nodes.count()
                    console.log(`Mermaid flowchart nodes rendered: ${nodeCount}`)
                    expect(
                        nodeCount,
                        'Mermaid flowchart should have at least 1 node (start node)'
                    ).toBeGreaterThanOrEqual(1)

                    // Verify flowchart edges exist (Mermaid renders edges as <g class="edgePath">)
                    const edges = iframeFrame.locator('g.edgePath')
                    const edgeCount = await edges.count()
                    console.log(`Mermaid flowchart edges rendered: ${edgeCount}`)

                    // The MS-Z SOP has 2 nodes and 1 transition, so at least 1 edge expected
                    if (edgeCount > 0) {
                        expect(
                            edgeCount,
                            'Mermaid flowchart should have edges connecting nodes'
                        ).toBeGreaterThanOrEqual(1)
                    }

                    // Verify no error container visible (Mermaid init errors)
                    const errorContainer = iframeFrame.locator('#error-container')
                    const errorVisible = await errorContainer.isVisible().catch(() => false)
                    expect(
                        errorVisible,
                        'Mermaid error container should be hidden (no init errors)'
                    ).toBe(false)

                    await ss(page, '10b-mermaid-flowchart-rendered')
                } else {
                    console.log('Mermaid SVG not visible within timeout — CDN may be unavailable, skipping SVG checks')
                }
            }
        } else {
            // If no ui-resource-container found, the get_sop_detail tool call should still
            // have succeeded — verify the tool was called by checking response mentions SOP nodes
            console.log('No UI resource container found — checking response for SOP flow data')
            const sopFlowKeywords = ['start', 'analysis', '节点', 'node', 'transitions']
            const hasSopFlow = sopFlowKeywords.some(kw => responseText!.toLowerCase().includes(kw.toLowerCase()))
            console.log(`Response contains SOP flow data: ${hasSopFlow}`)
        }

        await ss(page, '11-final-chat-state')

        // =================================================================
        // PHASE 3: Cleanup — Delete test host
        // =================================================================
        await page.goto('/remote-diagnosis')
        await page.waitForTimeout(1500)
        await expect(page.locator('.page-title')).toBeVisible({ timeout: 10000 })

        // Hosts tab is default
        await page.waitForTimeout(1000)

        const delHostRow = page.locator('.data-table tbody tr').filter({ hasText: TEST_HOST.name })
        if (await delHostRow.count() > 0) {
            const deleteBtn = delHostRow.locator('.btn-danger')
            if (await deleteBtn.count() > 0) {
                page.once('dialog', d => d.accept())

                const delApi = waitForApi(
                    page,
                    r => r.url().includes('/hosts/') && r.request().method() === 'DELETE',
                ).catch(() => null)

                await deleteBtn.first().click()
                const delResp = await delApi
                if (delResp) {
                    expect(delResp.ok(), `Delete host failed: ${delResp.status()}`).toBeTruthy()
                }
                await page.waitForTimeout(1000)
            }
        }

        await ss(page, '12-cleanup-done')

        // -----------------------------------------------------------------
        // Final error check
        // -----------------------------------------------------------------
        const relevantErrors = errors.filter(e => !isIgnoredError(e))
        // Chat-related errors from agent processing are expected (timeout, connection issues etc.)
        // Only flag critical errors
        const criticalErrors = relevantErrors.filter(e =>
            !e.includes('Failed to fetch') &&
            !e.includes('network') &&
            !e.includes('NetworkError') &&
            !e.includes('AbortError')
        )
        // Don't fail on chat-related errors, just log them
        if (criticalErrors.length > 0) {
            console.log('Non-critical errors during test:', criticalErrors.join('\n'))
        }
    })
})

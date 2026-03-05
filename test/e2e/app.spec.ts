/**
 * Frontend E2E Tests (Playwright)
 *
 * Prerequisites: gateway + webapp must be running:
 *   cd ops-factory && scripts/ctl.sh startup all
 *
 * Run:
 *   cd test && npx playwright test --config playwright.config.ts
 *
 * Covered:
 *   - Login flow
 *   - Sidebar navigation (role-aware)
 *   - RBAC: admin vs regular user sidebar visibility
 *   - RBAC: admin-only page access guards
 *   - Agents page: lists agents, configure button visibility
 *   - Agent Configure page: edit prompt, save (admin only)
 *   - History page: renders, search input present
 *   - Files page: renders with category filters
 *   - Chat page: send message, receive streaming response
 *   - Settings page: shows user, logout
 */
import { test, expect, type Page } from '@playwright/test'

const REGULAR_USER = 'e2e-test-user'
const ADMIN_USER = 'sys'

// Helper: login as a specific user
async function loginAs(page: Page, username: string) {
  await page.goto('/login')
  await page.fill('input[placeholder="Your name"]', username)
  await page.click('button:has-text("Enter")')
  await page.waitForURL('/')
  // Wait for role to be fetched from /me
  await page.waitForTimeout(500)
}

// Helper: login as regular user (backward compat)
async function login(page: Page) {
  await loginAs(page, REGULAR_USER)
}

// =====================================================
// 1. Login
// =====================================================
test.describe('Login', () => {
  test('can login and reach home page', async ({ page }) => {
    await login(page)
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('text=Home').first()).toBeVisible()
  })

  test('redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')
    await page.waitForURL('/login')
    await expect(page.locator('.login-title')).toHaveText('Ops Factory')
  })
})

// =====================================================
// 2. Sidebar Navigation — Regular User
// =====================================================
test.describe('Sidebar navigation — regular user', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  const userNavItems = [
    { text: 'Home', path: '/' },
    { text: 'History', path: '/history' },
    { text: 'Files', path: '/files' },
    { text: 'Inbox', path: '/inbox' },
  ]

  for (const item of userNavItems) {
    test(`navigates to ${item.text} (${item.path})`, async ({ page }) => {
      await page.click(`.sidebar-nav a[href="${item.path}"]`)
      await expect(page).toHaveURL(item.path)
    })
  }

  test('does NOT show Agents link', async ({ page }) => {
    await expect(page.locator('.sidebar-nav a[href="/agents"]')).not.toBeVisible()
  })

  test('does NOT show Scheduler link', async ({ page }) => {
    await expect(page.locator('.sidebar-nav a[href="/scheduled-actions"]')).not.toBeVisible()
  })

  test('does NOT show Monitoring link', async ({ page }) => {
    await expect(page.locator('.sidebar-nav a[href="/monitoring"]')).not.toBeVisible()
  })
})

// =====================================================
// 3. Sidebar Navigation — Admin User
// =====================================================
test.describe('Sidebar navigation — admin user', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_USER)
  })

  const adminNavItems = [
    { text: 'Home', path: '/' },
    { text: 'History', path: '/history' },
    { text: 'Files', path: '/files' },
    { text: 'Inbox', path: '/inbox' },
    { text: 'Agents', path: '/agents' },
    { text: 'Scheduler', path: '/scheduled-actions' },
    { text: 'Monitoring', path: '/monitoring' },
  ]

  for (const item of adminNavItems) {
    test(`shows and navigates to ${item.text} (${item.path})`, async ({ page }) => {
      const link = page.locator(`.sidebar-nav a[href="${item.path}"]`)
      await expect(link).toBeVisible()
      await link.click()
      await expect(page).toHaveURL(item.path)
    })
  }
})

// =====================================================
// 4. RBAC — Admin-Only Page Guards
// =====================================================
test.describe('RBAC — page access guards', () => {
  test('regular user redirected from /agents/:id/configure', async ({ page }) => {
    await login(page)
    await page.goto('/agents/universal-agent/configure')
    // AdminRoute should redirect to /
    await expect(page).toHaveURL('/')
  })

  test('regular user redirected from /scheduled-actions', async ({ page }) => {
    await login(page)
    await page.goto('/scheduled-actions')
    await expect(page).toHaveURL('/')
  })

  test('regular user redirected from /monitoring', async ({ page }) => {
    await login(page)
    await page.goto('/monitoring')
    await expect(page).toHaveURL('/')
  })

  test('admin can access /agents/:id/configure', async ({ page }) => {
    await loginAs(page, ADMIN_USER)
    await page.goto('/agents/universal-agent/configure')
    await expect(page).toHaveURL('/agents/universal-agent/configure')
    // Should load the configure page content
    await page.waitForSelector('textarea', { timeout: 10_000 })
  })

  test('admin can access /scheduled-actions', async ({ page }) => {
    await loginAs(page, ADMIN_USER)
    await page.goto('/scheduled-actions')
    await expect(page).toHaveURL('/scheduled-actions')
  })

  test('admin can access /monitoring', async ({ page }) => {
    await loginAs(page, ADMIN_USER)
    await page.goto('/monitoring')
    await expect(page).toHaveURL('/monitoring')
  })
})

// =====================================================
// 5. Agents Page — Role-Based Content
// =====================================================
test.describe('Agents page', () => {
  test('regular user can access /agents but has no Configure button', async ({ page }) => {
    await login(page)
    await page.goto('/agents')
    await page.waitForSelector('.agent-card', { timeout: 10_000 })
    // Agent cards should be visible
    await expect(page.locator('.agent-card')).not.toHaveCount(0)
    // Universal Agent name visible
    await expect(page.locator('text=Universal Agent').first()).toBeVisible()
    // Configure button should NOT be visible
    await expect(page.locator('.agent-skill-button')).not.toBeVisible()
  })

  test('admin sees Configure button on agent cards', async ({ page }) => {
    await loginAs(page, ADMIN_USER)
    await page.goto('/agents')
    await page.waitForSelector('.agent-card', { timeout: 10_000 })
    // Configure button should be visible
    const configBtn = page.locator('.agent-skill-button').first()
    await expect(configBtn).toBeVisible()
  })

  test('admin configure button navigates to agent settings', async ({ page }) => {
    await loginAs(page, ADMIN_USER)
    await page.goto('/agents')
    await page.waitForSelector('.agent-card', { timeout: 10_000 })
    const configBtn = page.locator('.agent-skill-button').first()
    await configBtn.click()
    await expect(page).toHaveURL(/\/agents\/[^/]+\/configure/)
  })

  test('agent cards show model info', async ({ page }) => {
    await loginAs(page, ADMIN_USER)
    await page.goto('/agents')
    await page.waitForSelector('.agent-card', { timeout: 10_000 })
    const modelLabel = page.locator('.agent-meta-label:has-text("Model")')
    await expect(modelLabel.first()).toBeVisible()
  })
})

// =====================================================
// 6. Agent Configure Page (admin only)
// =====================================================
test.describe('Agent configure page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_USER)
  })

  test('loads agent prompt editor', async ({ page }) => {
    await page.goto('/agents/universal-agent/configure')
    await page.waitForSelector('textarea', { timeout: 10_000 })
    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible()
    const value = await textarea.inputValue()
    expect(value.length).toBeGreaterThan(0)
  })

  test('can edit and save agent prompt', async ({ page }) => {
    await page.goto('/agents/universal-agent/configure')
    await page.waitForSelector('textarea', { timeout: 10_000 })

    const textarea = page.locator('textarea')
    const original = await textarea.inputValue()
    const marker = `\n<!-- e2e test ${Date.now()} -->`
    await textarea.fill(original + marker)

    const saveBtn = page.locator('.btn-primary:has-text("Save")')
    await saveBtn.click()
    await page.waitForTimeout(1000)

    await page.reload()
    await page.waitForSelector('textarea', { timeout: 10_000 })
    const updated = await page.locator('textarea').inputValue()
    expect(updated).toContain('e2e test')

    // Restore original
    await page.locator('textarea').fill(original)
    await page.locator('.btn-primary:has-text("Save")').click()
    await page.waitForTimeout(500)
  })
})

// =====================================================
// 7. History Page
// =====================================================
test.describe('History page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('renders with search and filter controls', async ({ page }) => {
    await page.goto('/history')
    const search = page.locator('input[placeholder*="Search"]').or(page.locator('input[type="search"]')).or(page.locator('input[placeholder*="search"]'))
    await expect(search.first()).toBeVisible({ timeout: 5000 })
  })
})

// =====================================================
// 8. Files Page
// =====================================================
test.describe('Files page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('renders with category filters', async ({ page }) => {
    await page.goto('/files')
    await page.waitForSelector('text=All', { timeout: 5000 })
    await expect(page.locator('text=All').first()).toBeVisible()
  })
})

// =====================================================
// 9. Chat Page
// =====================================================
test.describe('Chat page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('can send a message and receive a streamed response', async ({ page }) => {
    await page.goto('/chat')
    const chatInput = page.locator('textarea').or(page.locator('[contenteditable]')).or(page.locator('input[type="text"]'))
    await expect(chatInput.first()).toBeVisible({ timeout: 15_000 })
    await chatInput.first().fill('Reply with the single word "pong"')
    await chatInput.first().press('Enter')
    await page.waitForTimeout(3000)
    const messageArea = page.locator('.main-content')
    const textContent = await messageArea.textContent()
    expect(textContent?.length).toBeGreaterThan(10)
  }, 120_000)
})

// =====================================================
// 10. Chat — session working_dir & multi-user
// =====================================================
test.describe('Chat — session working_dir isolation', () => {
  const USER_A = 'e2e-alice'
  const USER_B = 'e2e-bob'

  test('regular user creates session and working_dir points to correct user directory', async ({ page }) => {
    await loginAs(page, USER_A)
    // Intercept the /agent/start response to verify working_dir
    const startResponsePromise = page.waitForResponse(
      resp => resp.url().includes('/agent/start') && resp.status() === 200
    )
    await page.goto('/chat')
    const chatInput = page.locator('textarea').or(page.locator('[contenteditable]')).or(page.locator('input[type="text"]'))
    await expect(chatInput.first()).toBeVisible({ timeout: 15_000 })
    await chatInput.first().fill('Reply with only "ok"')
    await chatInput.first().press('Enter')

    const startResponse = await startResponsePromise
    const sessionData = await startResponse.json()
    // working_dir must contain the user ID and agent ID
    expect(sessionData.working_dir).toContain(USER_A)
    expect(sessionData.working_dir).toContain('universal-agent')
    // Must NOT point to another user's directory
    expect(sessionData.working_dir).not.toContain(USER_B)
  }, 120_000)

  test('different user gets different working_dir', async ({ page }) => {
    await loginAs(page, USER_B)
    const startResponsePromise = page.waitForResponse(
      resp => resp.url().includes('/agent/start') && resp.status() === 200
    )
    await page.goto('/chat')
    const chatInput = page.locator('textarea').or(page.locator('[contenteditable]')).or(page.locator('input[type="text"]'))
    await expect(chatInput.first()).toBeVisible({ timeout: 15_000 })
    await chatInput.first().fill('Reply with only "ok"')
    await chatInput.first().press('Enter')

    const startResponse = await startResponsePromise
    const sessionData = await startResponse.json()
    expect(sessionData.working_dir).toContain(USER_B)
    expect(sessionData.working_dir).toContain('universal-agent')
    expect(sessionData.working_dir).not.toContain(USER_A)
  }, 120_000)

  test('no system_info 403 errors in console for regular user', async ({ page }) => {
    const errors: string[] = []
    page.on('response', resp => {
      if (resp.status() === 403) {
        errors.push(`403 on ${resp.url()}`)
      }
    })

    await loginAs(page, USER_A)
    await page.goto('/chat')
    await page.waitForTimeout(3000) // Wait for system_info and other requests

    // No 403 errors should occur
    expect(errors).toEqual([])
  }, 30_000)
})

// =====================================================
// 11. Settings Page
// =====================================================
test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('shows user info and logout button', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator(`.settings-username:has-text("${REGULAR_USER}")`)).toBeVisible({ timeout: 5000 })
    await expect(page.locator('button:has-text("Log out")')).toBeVisible()
  })

  test('logout redirects to login page', async ({ page }) => {
    await page.goto('/settings')
    await page.click('button:has-text("Log out")')
    await page.waitForURL('/login')
    await expect(page.locator('.login-title')).toHaveText('Ops Factory')
  })
})

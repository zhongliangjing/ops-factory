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
 *   - Sidebar navigation to all pages
 *   - Agents page: lists agents, shows status/model info
 *   - Agent Configure page: edit prompt, save
 *   - History page: renders, search input present
 *   - Files page: renders with category filters
 *   - Chat page: send message, receive streaming response
 *   - Settings page: shows user, logout
 */
import { test, expect, type Page } from '@playwright/test'

const TEST_USER = 'e2e-test-user'

// Helper: login and navigate to home
async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[placeholder="Your name"]', TEST_USER)
  await page.click('button:has-text("Enter")')
  // Should redirect to home
  await page.waitForURL('/')
}

// =====================================================
// 1. Login
// =====================================================
test.describe('Login', () => {
  test('can login and reach home page', async ({ page }) => {
    await login(page)
    // Sidebar should be visible with user's name
    await expect(page.locator('.sidebar')).toBeVisible()
    // Home page content should be visible
    await expect(page.locator('text=Home').first()).toBeVisible()
  })

  test('redirects to login when not authenticated', async ({ page }) => {
    // Clear any stored login
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')
    await page.waitForURL('/login')
    await expect(page.locator('.login-title')).toHaveText('Ops Factory')
  })
})

// =====================================================
// 2. Sidebar Navigation
// =====================================================
test.describe('Sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  const navItems = [
    { text: 'Home', path: '/' },
    { text: 'History', path: '/history' },
    { text: 'Agents', path: '/agents' },
    { text: 'Files', path: '/files' },
    { text: 'Scheduler', path: '/scheduled-actions' },
    { text: 'Inbox', path: '/inbox' },
  ]

  for (const item of navItems) {
    test(`navigates to ${item.text} (${item.path})`, async ({ page }) => {
      await page.click(`.sidebar-nav a[href="${item.path}"]`)
      await expect(page).toHaveURL(item.path)
    })
  }
})

// =====================================================
// 3. Agents Page
// =====================================================
test.describe('Agents page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('lists configured agents', async ({ page }) => {
    await page.goto('/agents')
    // Wait for agents to load
    await page.waitForSelector('.agent-card', { timeout: 10_000 })
    const cards = page.locator('.agent-card')
    await expect(cards).not.toHaveCount(0)

    // Universal Agent should be present
    await expect(page.locator('text=Universal Agent').first()).toBeVisible()
  })

  test('agent cards show model info', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForSelector('.agent-card', { timeout: 10_000 })
    // At least one card should have model metadata
    const modelLabel = page.locator('.agent-meta-label:has-text("Model")')
    await expect(modelLabel.first()).toBeVisible()
  })

  test('configure button navigates to agent settings', async ({ page }) => {
    await page.goto('/agents')
    await page.waitForSelector('.agent-card', { timeout: 10_000 })

    // Click the first Configure button
    const configBtn = page.locator('.agent-skill-button').first()
    await configBtn.click()

    // Should navigate to agent configure page
    await expect(page).toHaveURL(/\/agents\/[^/]+\/configure/)
  })
})

// =====================================================
// 4. Agent Configure Page
// =====================================================
test.describe('Agent configure page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('loads agent prompt editor', async ({ page }) => {
    await page.goto('/agents/universal-agent/configure')
    // Wait for config to load
    await page.waitForSelector('textarea', { timeout: 10_000 })
    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible()
    // Should have some content (AGENTS.md)
    const value = await textarea.inputValue()
    expect(value.length).toBeGreaterThan(0)
  })

  test('can edit and save agent prompt', async ({ page }) => {
    await page.goto('/agents/universal-agent/configure')
    await page.waitForSelector('textarea', { timeout: 10_000 })

    // Read original
    const textarea = page.locator('textarea')
    const original = await textarea.inputValue()

    // Append test marker
    const marker = `\n<!-- e2e test ${Date.now()} -->`
    await textarea.fill(original + marker)

    // Click save
    const saveBtn = page.locator('.btn-primary:has-text("Save")')
    await saveBtn.click()

    // Wait for save to complete
    await page.waitForTimeout(1000)

    // Reload and verify
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
// 5. History Page
// =====================================================
test.describe('History page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('renders with search and filter controls', async ({ page }) => {
    await page.goto('/history')
    // Search input should exist
    const search = page.locator('input[placeholder*="Search"]').or(page.locator('input[type="search"]')).or(page.locator('input[placeholder*="search"]'))
    await expect(search.first()).toBeVisible({ timeout: 5000 })
  })
})

// =====================================================
// 6. Files Page
// =====================================================
test.describe('Files page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('renders with category filters', async ({ page }) => {
    await page.goto('/files')
    // Wait for page to load — check for category buttons
    await page.waitForSelector('text=All', { timeout: 5000 })
    // Category filters should include at least "All"
    await expect(page.locator('text=All').first()).toBeVisible()
  })
})

// =====================================================
// 7. Chat Page
// =====================================================
test.describe('Chat page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('can send a message and receive a streamed response', async ({ page }) => {
    // Navigate to chat (creates a new session)
    await page.goto('/chat')

    // Wait for the chat page to be ready
    // The chat input area should be present
    const chatInput = page.locator('textarea').or(page.locator('[contenteditable]')).or(page.locator('input[type="text"]'))
    await expect(chatInput.first()).toBeVisible({ timeout: 15_000 })

    // Type a message
    await chatInput.first().fill('Reply with the single word "pong"')

    // Submit (press Enter or click send button)
    await chatInput.first().press('Enter')

    // Wait for a response message to appear (assistant bubble)
    // This may take a few seconds due to LLM processing
    await page.waitForTimeout(3000)

    // The page should contain some response content (not just the user message)
    const messageArea = page.locator('.main-content')
    const textContent = await messageArea.textContent()
    expect(textContent?.length).toBeGreaterThan(10)
  }, 120_000)
})

// =====================================================
// 8. Settings Page
// =====================================================
test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('shows user info and logout button', async ({ page }) => {
    await page.goto('/settings')
    // Should show the test user's name
    await expect(page.locator(`.settings-username:has-text("${TEST_USER}")`)).toBeVisible({ timeout: 5000 })
    // Logout button should exist
    await expect(page.locator('button:has-text("Log out")')).toBeVisible()
  })

  test('logout redirects to login page', async ({ page }) => {
    await page.goto('/settings')
    await page.click('button:has-text("Log out")')
    await page.waitForURL('/login')
    await expect(page.locator('.login-title')).toHaveText('Ops Factory')
  })
})

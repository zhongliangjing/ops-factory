import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

const KNOWLEDGE_URL = process.env.KNOWLEDGE_SERVICE_URL || 'http://127.0.0.1:8092'

async function loginAsAdmin(page: Page, username = `knowledge-e2e-${Date.now()}`) {
  await page.goto('/login')
  await page.fill('input[placeholder="Your name"]', username)
  await page.click('button:has-text("Enter")')
  await page.waitForURL('/')
}

async function createSource(request: APIRequestContext, name: string, description: string) {
  const response = await request.post(`${KNOWLEDGE_URL}/ops-knowledge/sources`, {
    data: { name, description },
  })
  expect(response.ok()).toBeTruthy()
  return await response.json() as { id: string; name: string }
}

async function patchSource(
  request: APIRequestContext,
  sourceId: string,
  payload: Record<string, unknown>,
) {
  const response = await request.patch(`${KNOWLEDGE_URL}/ops-knowledge/sources/${sourceId}`, {
    data: payload,
  })
  expect(response.ok()).toBeTruthy()
  return await response.json()
}

async function getSource(request: APIRequestContext, sourceId: string) {
  const response = await request.get(`${KNOWLEDGE_URL}/ops-knowledge/sources/${sourceId}`)
  expect(response.ok()).toBeTruthy()
  return await response.json() as { id: string; rebuildRequired: boolean; runtimeStatus: string }
}

async function findSourceByName(request: APIRequestContext, name: string) {
  const response = await request.get(`${KNOWLEDGE_URL}/ops-knowledge/sources?page=1&pageSize=100`)
  expect(response.ok()).toBeTruthy()
  const data = await response.json() as { items: Array<{ id: string; name: string }> }
  const item = data.items.find(entry => entry.name === name)
  expect(item, `source ${name} should exist`).toBeDefined()
  return item!
}

async function uploadFile(
  request: APIRequestContext,
  sourceId: string,
  file: { name: string; mimeType: string; body: string },
) {
  const response = await request.post(`${KNOWLEDGE_URL}/ops-knowledge/sources/${sourceId}/documents:ingest`, {
    multipart: {
      files: {
        name: file.name,
        mimeType: file.mimeType,
        buffer: Buffer.from(file.body, 'utf-8'),
      },
    },
  })
  expect(response.ok()).toBeTruthy()
  return await response.json()
}

async function deleteSourceBestEffort(request: APIRequestContext, sourceId: string) {
  await request.delete(`${KNOWLEDGE_URL}/ops-knowledge/sources/${sourceId}`)
}

async function waitForSourceRebuildCleared(
  request: APIRequestContext,
  sourceId: string,
  timeoutMs = 30_000,
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const source = await getSource(request, sourceId)
    if (!source.rebuildRequired && source.runtimeStatus !== 'MAINTENANCE') {
      return source
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for source ${sourceId} rebuild to finish`)
}

function resourceCard(page: Page, title: string) {
  return page.locator('.resource-card').filter({ hasText: title }).first()
}

function documentRow(page: Page, text: string) {
  return page.locator('.knowledge-doc-row').filter({ hasText: text }).first()
}

test.describe('Knowledge management', () => {
  test('creates, filters, and deletes knowledge sources from the list page', async ({ page, request }) => {
    const cleanup: string[] = []
    const disabledName = `E2E Disabled Source ${Date.now()}`
    const createdName = `E2E Created Source ${Date.now()}`

    try {
      const disabled = await createSource(request, disabledName, 'disabled source for list filters')
      cleanup.push(disabled.id)
      await patchSource(request, disabled.id, { status: 'DISABLED' })

      await loginAsAdmin(page)
      await page.goto('/knowledge')
      await expect(page.locator('.page-title')).toBeVisible()

      await page.locator('.page-header-actions .btn.btn-primary').click()
      await page.locator('.modal input.form-input').first().fill(createdName)
      await page.locator('.modal textarea.form-input').fill('created from playwright')
      await page.locator('.modal-footer .btn.btn-primary').click()

      const created = await findSourceByName(request, createdName)
      cleanup.push(created.id)

      await expect(resourceCard(page, createdName)).toBeVisible({ timeout: 15_000 })

      const searchInput = page.locator('.search-input')
      await searchInput.fill(disabledName)
      await expect(resourceCard(page, disabledName)).toBeVisible()

      await page.locator('.seg-filter-btn').nth(2).click()
      await expect(page.locator('.resource-card')).toHaveCount(1)
      await expect(resourceCard(page, disabledName)).toBeVisible()

      await searchInput.fill(createdName)
      await page.locator('.seg-filter-btn').nth(1).click()
      await expect(resourceCard(page, createdName)).toBeVisible()

      await resourceCard(page, createdName).locator('.resource-card-danger-action').click()
      await page.locator('.modal-footer .btn.btn-danger').click()
      await expect(resourceCard(page, createdName)).toHaveCount(0)
    } finally {
      for (const sourceId of cleanup) {
        await deleteSourceBestEffort(request, sourceId)
      }
    }
  })

  test('covers document rename, preview, upload, chunk navigation, and delete', async ({ page, request }) => {
    const cleanup: string[] = []
    const sourceName = `E2E Documents ${Date.now()}`

    try {
      const source = await createSource(request, sourceName, 'documents workflow')
      cleanup.push(source.id)

      await uploadFile(request, source.id, {
        name: 'alpha-runbook.md',
        mimeType: 'text/markdown',
        body: [
          '# Alpha Runbook',
          '',
          'Restart the service and verify the alarm is cleared.',
        ].join('\n'),
      })
      await uploadFile(request, source.id, {
        name: 'beta-notes.txt',
        mimeType: 'text/plain',
        body: 'Beta notes for document workflow validation.',
      })

      await loginAsAdmin(page)
      await page.goto(`/knowledge/${source.id}?tab=documents`)
      await expect(page.locator('.knowledge-doc-row')).toHaveCount(2, { timeout: 15_000 })

      const alphaRow = documentRow(page, 'alpha-runbook.md')
      await alphaRow.locator('.knowledge-doc-actions-text .knowledge-doc-action-link').nth(1).click()
      await page.locator('#knowledge-doc-title-input').fill('Alpha Runbook Renamed')
      await page.locator('.modal-footer .btn.btn-primary').click()
      await expect(documentRow(page, 'Alpha Runbook Renamed')).toBeVisible({ timeout: 15_000 })

      const renamedRow = documentRow(page, 'Alpha Runbook Renamed')
      await renamedRow.locator('.knowledge-doc-actions-icons .knowledge-doc-action-btn').nth(0).click()
      await expect(renamedRow).toHaveClass(/selected/, { timeout: 10_000 })

      await page.locator('.knowledge-doc-toolbar-actions .btn.btn-primary').click()
      await page.locator('.knowledge-upload-modal input[type="file"]').setInputFiles({
        name: 'gamma-checklist.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# Gamma Checklist\n\nValidate chunk navigation and upload flow.', 'utf-8'),
      })
      await page.locator('.knowledge-upload-modal .modal-footer .btn.btn-primary').click()
      await expect(page.locator('.knowledge-doc-row')).toHaveCount(3, { timeout: 15_000 })

      const gammaRow = documentRow(page, 'gamma-checklist.md')
      await expect(gammaRow).toBeVisible()
      await gammaRow.locator('.knowledge-doc-actions-text .knowledge-doc-action-link').first().click()
      await expect(page).toHaveURL(new RegExp(`/knowledge/${source.id}\\?tab=chunks&documentId=`))
      await expect(page.locator('.knowledge-section-title').filter({ hasText: /Chunk|分块|Chunks/ }).first()).toBeVisible()

      await page.goto(`/knowledge/${source.id}?tab=documents`)
      await expect(page.locator('.knowledge-doc-row')).toHaveCount(3, { timeout: 15_000 })
      await gammaRow.locator('.knowledge-doc-actions-icons .knowledge-doc-action-btn.danger').click()
      await page.locator('.modal-footer .btn.btn-danger').click()
      await expect(documentRow(page, 'gamma-checklist.md')).toHaveCount(0)
      await expect(page.locator('.knowledge-doc-row')).toHaveCount(2)
    } finally {
      for (const sourceId of cleanup) {
        await deleteSourceBestEffort(request, sourceId)
      }
    }
  })

  test('creates, edits, and deletes chunks from the chunks tab', async ({ page, request }) => {
    const cleanup: string[] = []
    const sourceName = `E2E Chunks ${Date.now()}`
    const createdChunkTitle = 'Operator checklist for recovery'

    try {
      const source = await createSource(request, sourceName, 'chunks workflow')
      cleanup.push(source.id)

      await uploadFile(request, source.id, {
        name: 'chunk-seed.md',
        mimeType: 'text/markdown',
        body: [
          '# Chunk Seed',
          '',
          'The seed document ensures the chunk tab has a backing document.',
          '',
          '## Existing section',
          '',
          'Existing content for baseline chunk coverage.',
        ].join('\n'),
      })

      await loginAsAdmin(page)
      await page.goto(`/knowledge/${source.id}?tab=chunks`)
      await expect(page.locator('.knowledge-chunk-card').first()).toBeVisible({ timeout: 15_000 })

      await page.locator('.knowledge-section-header .btn.btn-primary').click()
      await page.locator('#knowledge-chunk-content').fill([
        createdChunkTitle,
        '',
        'Step one: validate the service health.',
        'Step two: confirm the topology recovers.',
      ].join('\n'))
      await page.locator('#knowledge-chunk-keywords').fill('manual,critical')
      await page.locator('#knowledge-chunk-keywords').press('Enter')
      await page.locator('.knowledge-chunk-detail-footer .btn.btn-primary').click()

      const createdCard = page.locator('.knowledge-chunk-card').filter({ hasText: createdChunkTitle }).first()
      await expect(createdCard).toBeVisible({ timeout: 15_000 })

      await createdCard.click()
      await page.locator('.knowledge-chunk-detail-footer .btn.btn-primary').click()
      await page.locator('#knowledge-chunk-content').fill([
        createdChunkTitle,
        '',
        'Step one: validate the service health.',
        'Step two: confirm the topology recovers.',
        'Step three: record the recovery in the incident timeline.',
      ].join('\n'))
      await page.locator('#knowledge-chunk-keywords').fill('updated')
      await page.locator('#knowledge-chunk-keywords').press('Enter')
      await page.locator('.knowledge-chunk-detail-footer .btn.btn-primary').click()
      await expect(page.locator('.knowledge-chunk-keyword-pill').filter({ hasText: 'updated' }).first()).toBeVisible({ timeout: 10_000 })

      await page.locator('.knowledge-chunk-detail-footer .btn.btn-primary').click()
      await page.locator('.knowledge-chunk-detail-footer .btn.btn-danger').click()
      await page.locator('.modal-footer .btn.btn-danger').click()
      await expect(page.locator('.knowledge-chunk-card').filter({ hasText: createdChunkTitle })).toHaveCount(0)
    } finally {
      for (const sourceId of cleanup) {
        await deleteSourceBestEffort(request, sourceId)
      }
    }
  })

  test('edits index config and triggers a rebuild from the maintenance tab', async ({ page, request }) => {
    const cleanup: string[] = []
    const sourceName = `E2E Maintenance ${Date.now()}`

    try {
      const source = await createSource(request, sourceName, 'maintenance workflow')
      cleanup.push(source.id)

      await uploadFile(request, source.id, {
        name: 'maintenance-seed.md',
        mimeType: 'text/markdown',
        body: [
          '# Maintenance Seed',
          '',
          'This source is used to validate rebuild-required and rebuild execution.',
        ].join('\n'),
      })

      await loginAsAdmin(page)
      await page.goto(`/knowledge/${source.id}?tab=config`)
      await expect(page.locator('.knowledge-section-card')).toHaveCount(4, { timeout: 15_000 })

      await page.locator('.knowledge-section-card .knowledge-section-action').nth(0).click()
      await page.locator('.knowledge-profile-config-modal input.form-input').nth(3).fill('5.5')
      await page.locator('.knowledge-profile-config-modal .modal-footer .btn.btn-primary').click()

      await page.goto(`/knowledge/${source.id}?tab=maintenance`)
      await expect(page.locator('.conn-banner.conn-banner-warning')).toBeVisible({ timeout: 15_000 })

      await page.locator('.knowledge-config-stack .knowledge-section-card .knowledge-section-action').last().click()
      await page.locator('.modal-footer .btn.btn-primary').click()

      await waitForSourceRebuildCleared(request, source.id)
      await page.reload()
      await expect(page.locator('.conn-banner.conn-banner-warning')).toHaveCount(0)
      await expect(page.locator('.knowledge-section-title').filter({ hasText: /Maintenance|维护|Current|Last/ }).first()).toBeVisible()
    } finally {
      for (const sourceId of cleanup) {
        await deleteSourceBestEffort(request, sourceId)
      }
    }
  })

  test('runs retrieval compare, opens chunk detail, edits content, and records history', async ({ page, request }) => {
    const cleanup: string[] = []
    const sourceName = `E2E Retrieval ${Date.now()}`

    try {
      const source = await createSource(request, sourceName, 'retrieval workflow')
      cleanup.push(source.id)

      await uploadFile(request, source.id, {
        name: 'retrieval-seed.md',
        mimeType: 'text/markdown',
        body: [
          '# EulerOS Retrieval Notes',
          '',
          'EulerOS 2 SP12 deployment guidance is stored in this chunk for retrieval testing.',
          '',
          'The platform also keeps deployment notes for incident handling and topology verification.',
        ].join('\n'),
      })

      await loginAsAdmin(page)
      await page.goto(`/knowledge/${source.id}?tab=retrieval`)
      await page.fill('#knowledge-retrieval-query', 'EulerOS')
      await page.locator('.knowledge-retrieval-actions .btn.btn-primary').click()

      await expect(page.locator('.knowledge-retrieval-hit-card').first()).toBeVisible({ timeout: 20_000 })
      await page.locator('.knowledge-retrieval-hit-card').first().click()
      await expect(page.locator('.knowledge-chunk-detail-modal')).toBeVisible({ timeout: 10_000 })

      await page.locator('.knowledge-chunk-detail-footer .btn.btn-primary').click()
      await page.locator('#knowledge-retrieval-chunk-content').fill([
        'EulerOS 2 SP12 deployment guidance is stored in this chunk for retrieval testing.',
        '',
        'Validated by E2E retrieval edit.',
      ].join('\n'))
      await page.locator('#knowledge-retrieval-chunk-keywords').fill('retrieval-e2e')
      await page.locator('#knowledge-retrieval-chunk-keywords').press('Enter')
      await page.locator('.knowledge-chunk-detail-footer .btn.btn-primary').click()

      await expect(page.locator('.knowledge-chunk-keyword-pill').filter({ hasText: 'retrieval-e2e' }).first()).toBeVisible({ timeout: 10_000 })
      await page.locator('.knowledge-chunk-detail-footer .btn.btn-secondary').click()

      await expect(page.locator('.knowledge-retrieval-history-item').first()).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('.knowledge-retrieval-history-item-query').first()).toContainText('EulerOS')
    } finally {
      for (const sourceId of cleanup) {
        await deleteSourceBestEffort(request, sourceId)
      }
    }
  })
})

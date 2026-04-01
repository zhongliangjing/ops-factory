import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

type FetchFn = typeof globalThis.fetch

let routes: Record<string, unknown> = {}
let originalFetch: FetchFn

function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url)
  const key = `${init?.method || 'GET'} ${url.pathname}${url.search}`

  if (key in routes) {
    return Promise.resolve(new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  }

  return Promise.resolve(new Response(`Not found: ${key}`, { status: 404 }))
}

beforeEach(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch as FetchFn
  routes = {}
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

const {
  tools,
  handleSearch,
  handleFetch,
  dispatch,
} = await import('./handlers.js')

describe('tool definitions', () => {
  it('defines search and fetch tools', () => {
    assert.equal(tools.length, 2)
    assert.deepStrictEqual(tools.map(tool => tool.name), ['search', 'fetch'])
  })
})

describe('handleSearch', () => {
  it('uses the configured default source when sourceIds is omitted', async () => {
    routes['POST /knowledge/search'] = {
      query: '故障定位',
      hits: [],
      total: 0,
    }

    let capturedBody: Record<string, unknown> | undefined
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return mockFetch(input, init)
    }) as FetchFn

    const result = JSON.parse(await handleSearch({ query: '故障定位' }))
    assert.equal(result.query, '故障定位')
    assert.deepStrictEqual(capturedBody?.sourceIds, ['src_ac8da09a7cfd'])
    assert.equal(capturedBody?.topK, 8)
  })

  it('passes explicit sourceIds through', async () => {
    routes['POST /knowledge/search'] = {
      query: '容量规划',
      hits: [{ chunkId: 'chk_1', sourceId: 'src_x', title: '容量', titlePath: [], snippet: '说明', score: 0.9, lexicalScore: 0.9, semanticScore: 0.2, fusionScore: 0.9, documentId: 'doc_1', pageFrom: 1, pageTo: 1 }],
      total: 1,
    }

    let capturedBody: Record<string, unknown> | undefined
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return mockFetch(input, init)
    }) as FetchFn

    const result = JSON.parse(await handleSearch({ query: '容量规划', sourceIds: ['src_custom'], topK: 3 }))
    assert.equal(result.total, 1)
    assert.deepStrictEqual(capturedBody?.sourceIds, ['src_custom'])
    assert.equal(capturedBody?.topK, 3)
  })
})

describe('handleFetch', () => {
  it('fetches chunk detail with optional neighbors', async () => {
    routes['GET /knowledge/fetch/chk_123?includeNeighbors=true&neighborWindow=2&includeMarkdown=true&includeRawText=true'] = {
      chunkId: 'chk_123',
      documentId: 'doc_1',
      sourceId: 'src_ac8da09a7cfd',
      title: '处理步骤',
      titlePath: ['值班手册'],
      text: '详细说明',
      markdown: '详细说明',
      keywords: ['值班'],
      pageFrom: 6,
      pageTo: 6,
      previousChunkId: 'chk_122',
      nextChunkId: 'chk_124',
      neighbors: [{ position: 'previous', chunkId: 'chk_122', text: '前文' }],
    }

    const result = JSON.parse(await handleFetch({ chunkId: 'chk_123', includeNeighbors: true, neighborWindow: 2 }))
    assert.equal(result.chunkId, 'chk_123')
    assert.equal(result.neighbors.length, 1)
  })

  it('rejects neighborWindow values outside the backend limit', async () => {
    await assert.rejects(
      () => handleFetch({ chunkId: 'chk_123', includeNeighbors: true, neighborWindow: 3 }),
      /fetch\.neighborWindow must be an integer between 1 and 2/,
    )
  })
})

describe('dispatch', () => {
  it('routes search', async () => {
    routes['POST /knowledge/search'] = { query: 'Q', hits: [], total: 0 }
    const result = JSON.parse(await dispatch('search', { query: 'Q' }))
    assert.equal(result.query, 'Q')
  })

  it('routes fetch', async () => {
    routes['GET /knowledge/fetch/chk_1?includeNeighbors=false&neighborWindow=1&includeMarkdown=true&includeRawText=true'] = {
      chunkId: 'chk_1',
      documentId: 'doc_1',
      sourceId: 'src_ac8da09a7cfd',
      title: '标题',
      titlePath: [],
      text: '正文',
      markdown: '正文',
      keywords: [],
      pageFrom: null,
      pageTo: null,
      previousChunkId: null,
      nextChunkId: null,
      neighbors: [],
    }
    const result = JSON.parse(await dispatch('fetch', { chunkId: 'chk_1' }))
    assert.equal(result.chunkId, 'chk_1')
  })
})

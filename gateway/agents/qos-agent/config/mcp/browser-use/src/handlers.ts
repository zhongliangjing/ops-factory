import puppeteer, { type Browser, type Page } from 'puppeteer'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output'
const NAV_TIMEOUT = 30_000
const CHROME_PATH = process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    : '/usr/bin/google-chrome')

// ---------------------------------------------------------------------------
// Browser session singleton
// ---------------------------------------------------------------------------
let browser: Browser | null = null
let page: Page | null = null

async function getPage(): Promise<Page> {
  if (browser && browser.connected) {
    const pages = await browser.pages()
    if (pages.length > 0) {
      page = pages[0]
      return page
    }
  }
  browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=zh-CN',
    ],
  })
  page = (await browser.pages())[0] || await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  page.setDefaultNavigationTimeout(NAV_TIMEOUT)
  return page
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export const tools = [
  {
    name: 'browser_navigate',
    description: 'Open a URL in Chromium and return page title and interactive elements. The browser session persists across calls.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to open' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element by its index number (from browser_navigate/browser_get_state element list).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        index: { type: 'integer', description: 'Element index from the page state' },
      },
      required: ['index'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input field by element index, then press Enter.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        index: { type: 'integer', description: 'Element index of the input field' },
        text: { type: 'string', description: 'Text to type' },
        press_enter: { type: 'boolean', description: 'Whether to press Enter after typing (default: false)' },
      },
      required: ['index', 'text'],
    },
  },
  {
    name: 'browser_get_state',
    description: 'Get current page URL, title, and list of interactive elements with their indices.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'browser_extract',
    description: 'Extract text content from the page. Use query to filter specific elements.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'CSS selector or "all" for full page text (default: "all")' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot and save to output directory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        full_page: { type: 'boolean', description: 'Capture full scrollable page (default: false)' },
      },
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page up or down.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Direction (default: down)' },
      },
    },
  },
  {
    name: 'browser_close',
    description: 'Close the browser session.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

// ---------------------------------------------------------------------------
// Element indexing helper
// ---------------------------------------------------------------------------
interface ElementInfo {
  index: number
  tag: string
  text: string
  href?: string
  type?: string
  placeholder?: string
}

async function getElements(): Promise<ElementInfo[]> {
  if (!page) return []
  return page.evaluate(() => {
    const selectors = 'a, button, input, select, textarea, [role="button"], [onclick]'
    const nodes = Array.from(document.querySelectorAll(selectors))
    return nodes.slice(0, 80).map((el, i) => {
      const htmlEl = el as HTMLElement
      const inputEl = htmlEl as HTMLInputElement
      return {
        index: i,
        tag: htmlEl.tagName.toLowerCase(),
        text: (htmlEl.textContent?.trim().slice(0, 60) || inputEl.value || '').slice(0, 60),
        href: (htmlEl as HTMLAnchorElement).href || undefined,
        type: inputEl.type || undefined,
        placeholder: inputEl.placeholder || undefined,
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleNavigate(args: { url: string }): Promise<string> {
  const p = await getPage()
  await p.goto(args.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
  await new Promise(r => setTimeout(r, 500)) // small settle delay
  const title = await p.title()
  const elements = await getElements()
  const elList = elements.map(e => {
    const extras: string[] = []
    if (e.type) extras.push(`type=${e.type}`)
    if (e.placeholder) extras.push(`placeholder="${e.placeholder}"`)
    if (e.href && e.tag === 'a') extras.push(`href=${e.href.slice(0, 60)}`)
    const extra = extras.length ? ` ${extras.join(' ')}` : ''
    return `  [${e.index}] <${e.tag}> "${e.text}"${extra}`
  }).join('\n')
  return `Title: ${title}\nURL: ${p.url()}\nElements (${elements.length}):\n${elList}`
}

async function handleClick(args: { index: number }): Promise<string> {
  const p = await getPage()
  const selectors = 'a, button, input, select, textarea, [role="button"], [onclick]'
  const result = await p.evaluate((idx: number) => {
    const nodes = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick]')
    const el = nodes[idx] as HTMLElement | undefined
    if (!el) return null
    el.click()
    return { tag: el.tagName, text: (el.textContent?.trim() || '').slice(0, 60) }
  }, args.index)
  if (!result) return `Error: No element at index ${args.index}`
  await new Promise(r => setTimeout(r, 800))
  return `Clicked [${args.index}] <${result.tag}> "${result.text}"\nURL: ${p.url()}`
}

async function handleType(args: { index: number; text: string; press_enter?: boolean }): Promise<string> {
  const p = await getPage()
  // Focus the element via evaluate, then type via keyboard
  const found = await p.evaluate((idx: number) => {
    const nodes = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick]')
    const el = nodes[idx] as HTMLElement | undefined
    if (!el) return false
    el.focus()
    if ((el as HTMLInputElement).value !== undefined) (el as HTMLInputElement).value = ''
    return true
  }, args.index)
  if (!found) return `Error: No element at index ${args.index}`
  await p.keyboard.type(args.text, { delay: 30 })
  if (args.press_enter) {
    await p.keyboard.press('Enter')
    await new Promise(r => setTimeout(r, 800))
  }
  return `Typed "${args.text}" into [${args.index}]${args.press_enter ? ' + Enter' : ''}\nURL: ${p.url()}`
}

async function handleGetState(): Promise<string> {
  if (!page) return 'Error: No browser session. Call browser_navigate first.'
  const title = await page.title()
  const elements = await getElements()
  const elList = elements.map(e => {
    const extras: string[] = []
    if (e.type) extras.push(`type=${e.type}`)
    if (e.placeholder) extras.push(`placeholder="${e.placeholder}"`)
    const extra = extras.length ? ` ${extras.join(' ')}` : ''
    return `  [${e.index}] <${e.tag}> "${e.text}"${extra}`
  }).join('\n')
  return `Title: ${title}\nURL: ${page.url()}\nElements (${elements.length}):\n${elList}`
}

async function handleExtract(args: { query?: string }): Promise<string> {
  if (!page) return 'Error: No browser session.'
  const query = args.query || 'all'
  if (query === 'all' || query === 'body' || query === 'text') {
    return await page.evaluate(() => document.body.innerText.slice(0, 15000))
  }
  try {
    const text = await page.$eval(query, el => (el as HTMLElement).innerText.slice(0, 15000))
    return text
  } catch {
    return await page.evaluate(() => document.body.innerText.slice(0, 15000))
  }
}

async function handleScreenshot(args: { full_page?: boolean }): Promise<string> {
  if (!page) return 'Error: No browser session.'
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = join(OUTPUT_DIR, `screenshot-${ts}.png`)
  await page.screenshot({ path, fullPage: args.full_page ?? false })
  return `Screenshot saved: ${path}`
}

async function handleScroll(args: { direction?: string }): Promise<string> {
  if (!page) return 'Error: No browser session.'
  const dir = args.direction || 'down'
  const px = 600
  await page.evaluate((d: string, p: number) => window.scrollBy(0, d === 'up' ? -p : p), dir, px)
  return `Scrolled ${dir}`
}

async function handleClose(): Promise<string> {
  if (browser) {
    await browser.close()
    browser = null
    page = null
    return 'Browser closed.'
  }
  return 'No active session.'
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
export async function dispatch(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'browser_navigate': return handleNavigate(args as any)
    case 'browser_click': return handleClick(args as any)
    case 'browser_type': return handleType(args as any)
    case 'browser_get_state': return handleGetState()
    case 'browser_extract': return handleExtract(args as any)
    case 'browser_screenshot': return handleScreenshot(args as any)
    case 'browser_scroll': return handleScroll(args as any)
    case 'browser_close': return handleClose()
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const GATEWAY_URL = process.env.GATEWAY_URL || 'https://127.0.0.1:3000'
const GATEWAY_SECRET_KEY = process.env.GATEWAY_SECRET_KEY || 'test'
const API_PREFIX = '/ops-gateway'
const OUTPUT_DIR = process.env.OUTPUT_DIR || './output'
const MAX_OUTPUT_SIZE = 1_000_000 // 1MB

// ---------------------------------------------------------------------------
// Gateway HTTP helper
// ---------------------------------------------------------------------------

export async function gw<T>(path: string, params?: Record<string, string>, method?: string, body?: unknown): Promise<T> {
  const url = new URL(`${GATEWAY_URL}${path}`)
  if (params && method !== 'POST') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  const res = await fetch(url, {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-secret-key': GATEWAY_SECRET_KEY,
      'x-user-id': 'admin',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Gateway ${path} returned ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const tools = [
  {
    name: 'list_sops',
    description: '列出所有可用的SOP诊断流程，包含id、名称、触发条件。用于根据故障类型匹配适合的SOP。',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_sop_detail',
    description: '获取SOP的完整流程定义，包含所有节点、变量定义、分支条件和命令模板。用于了解SOP的完整执行流程。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sopId: { type: 'string', description: 'SOP ID' },
      },
      required: ['sopId'],
    },
  },
  {
    name: 'get_hosts',
    description: '获取管理的主机列表，可通过标签过滤。传入tags参数返回匹配任一标签的主机。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '按标签过滤（如["RCPA"]），返回tags中包含任一指定标签的主机',
        },
      },
    },
  },
  {
    name: 'execute_remote_command',
    description: '通过SSH在远程主机上执行诊断命令并返回输出。命令必须符合白名单要求。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        hostId: { type: 'string', description: '目标主机ID' },
        command: { type: 'string', description: '要执行的命令（支持管道和分号链接）' },
        timeout: { type: 'number', description: '超时时间(秒)，默认30' },
      },
      required: ['hostId', 'command'],
    },
  },
]

// ---------------------------------------------------------------------------
// Mermaid generation
// ---------------------------------------------------------------------------

interface SopNode {
  id?: string
  name: string
  type: string
  transitions?: { condition: string; nextNodeId: string }[]
}

interface SopData {
  name?: string
  nodes?: SopNode[]
  [key: string]: unknown
}

export function sopToMermaid(sop: SopData): string {
  const nodes = sop.nodes ?? []
  if (nodes.length === 0) return 'graph TD\n    empty["空SOP"]'

  // Build name → index mapping (nextNodeId stores the target node's name)
  const nameToIndex = new Map<string, number>()
  nodes.forEach((n, i) => nameToIndex.set(n.name, i))

  const lines: string[] = ['graph TD']

  // Node declarations
  nodes.forEach((node, i) => {
    const label = node.name.replace(/"/g, "'")
    if (node.type === 'start') {
      lines.push(`    N${i}(["${label}"])`)
    } else {
      lines.push(`    N${i}["${label}"]`)
    }
  })

  // Edges with conditions
  nodes.forEach((node, i) => {
    for (const t of node.transitions ?? []) {
      const targetIdx = nameToIndex.get(t.nextNodeId)
      if (targetIdx !== undefined) {
        const cond = t.condition.replace(/"/g, "'")
        lines.push(`    N${i} -->|"${cond}"| N${targetIdx}`)
      }
    }
  })

  // Style start nodes (indigo)
  nodes.forEach((node, i) => {
    if (node.type === 'start') {
      lines.push(`    style N${i} fill:#e0e7ff,stroke:#6366f1,stroke-width:2px`)
    }
  })

  return lines.join('\n')
}

interface ContentItem {
  type: 'text' | 'resource'
  text?: string
  resource?: {
    uri: string
    mimeType: string
    text: string
  }
}

export function buildMermaidResource(mermaidCode: string, title: string): ContentItem {
  return {
    type: 'resource',
    resource: {
      uri: `ui://sop-executor/mermaid/${encodeURIComponent(title)}`,
      mimeType: 'text/html',
      text: `<div class="mermaid">\n${mermaidCode}\n</div>`,
    },
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleListSops(): Promise<string> {
  const data = await gw<{ sops: Record<string, unknown>[] }>(`${API_PREFIX}/sops`)
  return JSON.stringify(data, null, 2)
}

export async function handleGetSopDetail(sopId: string): Promise<ContentItem[]> {
  const data = await gw<Record<string, unknown>>(`${API_PREFIX}/sops/${sopId}`)
  // API returns { success: true, sop: { nodes: [...] } } — extract inner sop object
  const sop = (data.sop ?? data) as SopData
  const textContent: ContentItem = {
    type: 'text',
    text: JSON.stringify(data, null, 2),
  }
  const mermaidCode = sopToMermaid(sop)
  const mermaidResource = buildMermaidResource(mermaidCode, String(sop.name ?? sopId))
  return [textContent, mermaidResource]
}

export async function handleGetHosts(tags?: string[]): Promise<string> {
  const params: Record<string, string> = {}
  if (tags && tags.length > 0) {
    params.tags = tags.join(',')
  }
  const data = await gw<{ hosts: Record<string, unknown>[] }>(`${API_PREFIX}/hosts`, params)
  return JSON.stringify(data, null, 2)
}

export async function handleExecuteRemote(hostId: string, command: string, timeout?: number): Promise<string> {
  const data = await gw<Record<string, unknown>>(`${API_PREFIX}/remote/execute`, undefined, 'POST', {
    hostId,
    command,
    timeout: timeout ?? 30,
  })

  // 将执行输出保存为附件文件
  try {
    const hostName = String(data.hostName || hostId)
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const safeName = hostName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_')
    const fileName = `sop-exec-${safeName}-${timestamp}.log`

    mkdirSync(OUTPUT_DIR, { recursive: true })

    let content = [
      `=== SOP 远程执行输出 ===`,
      `主机: ${hostName} (${hostId})`,
      `命令: ${command}`,
      `退出码: ${data.exitCode}`,
      `耗时: ${data.duration}ms`,
      `时间: ${new Date().toISOString()}`,
      ``,
      `--- 标准输出 ---`,
      String(data.output || ''),
      ``,
      `--- 标准错误 ---`,
      String(data.error || ''),
    ].join('\n')

    if (content.length > MAX_OUTPUT_SIZE) {
      content = content.slice(0, MAX_OUTPUT_SIZE) + '\n\n... [输出超过 1MB，已截断] ...'
    }

    writeFileSync(join(OUTPUT_DIR, fileName), content, 'utf-8')
  } catch (writeErr) {
    // 文件写入失败不影响工具返回
    console.error('[sop-executor] Failed to write output file:', writeErr)
  }

  return JSON.stringify(data, null, 2)
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatch(name: string, args: Record<string, unknown>): Promise<string | ContentItem[]> {
  switch (name) {
    case 'list_sops':
      return handleListSops()
    case 'get_sop_detail':
      return handleGetSopDetail((args as { sopId?: string }).sopId ?? '')
    case 'get_hosts':
      return handleGetHosts((args as { tags?: string[] }).tags)
    case 'execute_remote_command':
      return handleExecuteRemote(
        (args as { hostId?: string }).hostId ?? '',
        (args as { command?: string }).command ?? '',
        (args as { timeout?: number }).timeout,
      )
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

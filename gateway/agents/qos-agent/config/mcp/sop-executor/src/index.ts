import process from 'node:process'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools, dispatch } from './handlers.js'

// ---------------------------------------------------------------------------
// ASCII-safe stdout for Windows encoding compatibility
// ---------------------------------------------------------------------------
// On Chinese Windows (code page CP936/GBK), if the parent process reads
// MCP stdout with the system code page instead of UTF-8, Chinese characters
// in JSON-RPC messages get garbled.
//
// We patch process.stdout.write so that all string output is ASCII-only:
// every non-ASCII code-unit (0x7F-0xFFFF) is replaced with \uXXXX.
// JSON parsers decode \uXXXX back to the correct Unicode character.
// ---------------------------------------------------------------------------

const _origWrite = process.stdout.write.bind(process.stdout)

function escapeNonAscii(s: string): string {
  return s.replace(
    /[\u007f-\uffff]/g,
    c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4),
  )
}

// @ts-ignore -- overriding write signatures
process.stdout.write = function (chunk: any, ...rest: any[]): any {
  if (typeof chunk === 'string') {
    return _origWrite(escapeNonAscii(chunk), ...rest)
  }
  return _origWrite(chunk, ...rest)
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'sop-executor', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const result = await dispatch(name, args ?? {})
  if (Array.isArray(result)) {
    return { content: result }
  }
  return { content: [{ type: 'text', text: result }] }
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[sop-executor] MCP server running on stdio')

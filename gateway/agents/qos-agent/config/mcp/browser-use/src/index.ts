import process from 'node:process'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { tools, dispatch } from './handlers.js'

// ASCII-safe stdout for Windows
const _origWrite = process.stdout.write.bind(process.stdout)
function escapeNonAscii(s: string): string {
  return s.replace(/[\u007f-\uffff]/g, c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4))
}
// @ts-ignore
process.stdout.write = function (chunk: any, ...rest: any[]): any {
  if (typeof chunk === 'string') return _origWrite(escapeNonAscii(chunk), ...rest)
  return _origWrite(chunk, ...rest)
}

const server = new Server(
  { name: 'browser-use', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  try {
    const result = await dispatch(name, args ?? {})
    return { content: [{ type: 'text', text: result }] }
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }] }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[browser-use] MCP server running on stdio')

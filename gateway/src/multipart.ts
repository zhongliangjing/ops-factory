import http from 'node:http'

export interface MultipartField {
  name: string
  filename?: string
  contentType?: string
  data: Buffer
}

/**
 * Read the full request body as a Buffer with a size limit.
 * Unlike readBody() which reads as string, this preserves binary data.
 */
export function readBodyAsBuffer(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalSize = 0

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length
      if (totalSize > maxBytes) {
        req.destroy()
        reject(new Error(`Request body exceeds maximum size of ${maxBytes} bytes`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Extract boundary string from Content-Type header.
 * e.g. "multipart/form-data; boundary=----abc123" → "----abc123"
 */
export function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=([^\s;]+)/)
  return match ? match[1] : null
}

/**
 * Parse a multipart/form-data body into its constituent fields.
 * Handles both text fields and file fields with binary data.
 */
export function parseMultipart(body: Buffer, boundary: string): MultipartField[] {
  const fields: MultipartField[] = []
  const boundaryBuf = Buffer.from(`--${boundary}`)
  const endBoundaryBuf = Buffer.from(`--${boundary}--`)
  const crlfcrlf = Buffer.from('\r\n\r\n')

  // Find all boundary positions
  const positions: number[] = []
  let searchStart = 0
  while (true) {
    const idx = body.indexOf(boundaryBuf, searchStart)
    if (idx === -1) break
    positions.push(idx)
    searchStart = idx + boundaryBuf.length
  }

  // Each part is between consecutive boundaries
  for (let i = 0; i < positions.length - 1; i++) {
    const partStart = positions[i] + boundaryBuf.length
    const partEnd = positions[i + 1]

    // Check if this is the end boundary
    const afterBoundary = body.subarray(positions[i], positions[i] + endBoundaryBuf.length)
    if (afterBoundary.equals(endBoundaryBuf)) break

    // Skip the \r\n after boundary
    let dataStart = partStart
    if (body[dataStart] === 0x0d && body[dataStart + 1] === 0x0a) {
      dataStart += 2
    }

    // Remove trailing \r\n before next boundary
    let dataEnd = partEnd
    if (body[dataEnd - 2] === 0x0d && body[dataEnd - 1] === 0x0a) {
      dataEnd -= 2
    }

    const partData = body.subarray(dataStart, dataEnd)

    // Find header/body separator (\r\n\r\n)
    const headerEnd = partData.indexOf(crlfcrlf)
    if (headerEnd === -1) continue

    const headerStr = partData.subarray(0, headerEnd).toString('utf-8')
    const bodyData = partData.subarray(headerEnd + 4)

    // Parse headers
    const headers = parsePartHeaders(headerStr)
    const disposition = headers['content-disposition'] || ''
    const name = extractHeaderParam(disposition, 'name')
    if (!name) continue

    fields.push({
      name,
      filename: extractHeaderParam(disposition, 'filename') || undefined,
      contentType: headers['content-type'] || undefined,
      data: bodyData,
    })
  }

  return fields
}

function parsePartHeaders(headerStr: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of headerStr.split('\r\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.substring(0, colonIdx).trim().toLowerCase()
    const value = line.substring(colonIdx + 1).trim()
    headers[key] = value
  }
  return headers
}

function extractHeaderParam(header: string, param: string): string | null {
  // Match both param="value" and param=value
  const regex = new RegExp(`${param}="([^"]*)"`, 'i')
  const match = header.match(regex)
  if (match) return match[1]

  // Try without quotes
  const regex2 = new RegExp(`${param}=([^;\\s]+)`, 'i')
  const match2 = header.match(regex2)
  return match2 ? match2[1] : null
}

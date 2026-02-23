import { IncomingMessage, ServerResponse } from 'node:http'
import { readdir, stat } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { join, sep, extname, resolve, relative, basename } from 'node:path'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
}

const INLINE_TYPES = new Set(['.html', '.htm', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.txt', '.md', '.json', '.css', '.js'])

export interface FileInfo {
  name: string
  path: string
  size: number
  modifiedAt: string
  type: string
}

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv'])
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep', 'AGENTS.md'])

/**
 * If filePath is absolute and lives under workingDir,
 * strip the prefix so we get a safe relative path.
 */
function normaliseFilePath(filePath: string, workingDir: string): string {
  if (!filePath.startsWith('/')) return filePath
  const abs = resolve(filePath)
  const rel = relative(workingDir, abs)
  if (!rel.startsWith('..') && !rel.includes(`${sep}..`)) return rel
  // Could not make it relative — return just the basename so findFileByName can search
  return basename(filePath)
}

/**
 * Recursively collect all files under artifactsDir.
 * Now scans the entire artifacts directory, not just output/ subdirectories.
 */
export async function listOutputFiles(artifactsDir: string, extraSkipDirs?: string[]): Promise<FileInfo[]> {
  const files: FileInfo[] = []

  if (!existsSync(artifactsDir)) return files

  const skipSet = extraSkipDirs ? new Set([...SKIP_DIRS, ...extraSkipDirs]) : SKIP_DIRS
  await collectFilesRecursive(artifactsDir, '', files, skipSet)

  // Sort by modifiedAt descending
  files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
  return files
}

async function collectFilesRecursive(dir: string, relBase: string, files: FileInfo[], skipDirs: Set<string> = SKIP_DIRS): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relPath = relBase ? join(relBase, entry.name) : entry.name

    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue
      await collectFilesRecursive(fullPath, relPath, files, skipDirs)
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue
      const fileStat = await stat(fullPath)
      const ext = extname(entry.name).toLowerCase()
      files.push({
        name: entry.name,
        path: relPath,
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        type: ext.replace('.', '') || 'unknown',
      })
    }
  }
}

/**
 * Recursively search for a file by name in a directory
 */
async function searchFileRecursive(dir: string, targetName: string): Promise<string | null> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const fullPath = join(dir, entry.name)

    if (entry.isFile()) {
      if (entry.name === targetName) return fullPath
    } else if (entry.isDirectory()) {
      const found = await searchFileRecursive(fullPath, targetName)
      if (found) return found
    }
  }
  return null
}

/**
 * Search for a file by name - first in output directories, then entire working directory
 */
async function findFileByName(workingDir: string, fileName: string): Promise<string | null> {
  // Decode filename if URL-encoded
  let targetName = fileName
  try {
    targetName = decodeURIComponent(fileName)
  } catch { /* use original */ }

  // First check output directories (prioritize skill outputs)
  const outputFiles = await listOutputFiles(workingDir)
  const outputMatch = outputFiles.find(f => f.name === targetName)
  if (outputMatch) return join(workingDir, outputMatch.path)

  // Then search the entire working directory
  return searchFileRecursive(workingDir, targetName)
}

/**
 * Serve a file from workingDir with path traversal protection.
 */
export async function serveFile(workingDir: string, filePath: string, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Normalise: if filePath is absolute and lives under workingDir, make it relative
  const normalised = normaliseFilePath(filePath, workingDir)

  // Path traversal check
  let resolved = resolve(workingDir, normalised)
  const rel = relative(workingDir, resolved)
  const isSafe = !rel.startsWith('..') && !rel.includes(`${sep}..`)

  if (!isSafe) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Forbidden: path traversal detected' }))
    return
  }

  // If file not found at exact path, search by filename
  if (!existsSync(resolved)) {
    const found = await findFileByName(workingDir, basename(normalised))
    if (found) {
      resolved = found
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'File not found' }))
      return
    }
  }

  const ext = extname(resolved).toLowerCase()
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
  const fileName = basename(resolved)
  const disposition = INLINE_TYPES.has(ext) ? 'inline' : `attachment; filename="${fileName}"`

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Disposition': disposition,
  })

  const stream = createReadStream(resolved)
  stream.pipe(res)
  stream.on('error', (err) => {
    console.error('File stream error:', err.message)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
    }
    res.end(JSON.stringify({ error: 'Failed to read file' }))
  })
}

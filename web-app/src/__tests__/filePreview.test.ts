import { describe, it, expect } from 'vitest'
import { inferFileType, getPreviewKind, isPreviewableFile, needsTextContent } from '../utils/filePreview'

describe('inferFileType', () => {
    it('returns explicit type when provided', () => {
        expect(inferFileType({ type: 'py' })).toBe('py')
    })

    it('ignores "unknown" type and falls back to name', () => {
        expect(inferFileType({ type: 'unknown', name: 'hello.ts' })).toBe('ts')
    })

    it('extracts extension from filename', () => {
        expect(inferFileType({ name: 'report.pdf' })).toBe('pdf')
    })

    it('extracts extension from path', () => {
        expect(inferFileType({ path: '/home/user/docs/readme.md' })).toBe('md')
    })

    it('handles dotfiles', () => {
        expect(inferFileType({ name: '.gitignore' })).toBe('gitignore')
        expect(inferFileType({ name: '.env' })).toBe('env')
    })

    it('handles Dockerfile and Makefile', () => {
        expect(inferFileType({ name: 'Dockerfile' })).toBe('dockerfile')
        expect(inferFileType({ name: 'Makefile' })).toBe('makefile')
    })

    it('returns unknown for files without extension', () => {
        expect(inferFileType({ name: 'LICENSE' })).toBe('unknown')
    })

    it('returns unknown for empty input', () => {
        expect(inferFileType({})).toBe('unknown')
    })

    it('handles Windows-style paths', () => {
        expect(inferFileType({ path: 'C:\\Users\\docs\\file.xlsx' })).toBe('xlsx')
    })

    it('trims whitespace from type', () => {
        expect(inferFileType({ type: '  JSON  ' })).toBe('json')
    })
})

describe('getPreviewKind', () => {
    it('classifies markdown files', () => {
        expect(getPreviewKind({ name: 'readme.md' })).toBe('markdown')
        expect(getPreviewKind({ type: 'markdown' })).toBe('markdown')
    })

    it('classifies HTML files', () => {
        expect(getPreviewKind({ name: 'index.html' })).toBe('html')
        expect(getPreviewKind({ name: 'page.htm' })).toBe('html')
    })

    it('classifies image files', () => {
        expect(getPreviewKind({ name: 'photo.png' })).toBe('image')
        expect(getPreviewKind({ name: 'icon.svg' })).toBe('image')
        expect(getPreviewKind({ name: 'pic.webp' })).toBe('image')
    })

    it('classifies PDF files', () => {
        expect(getPreviewKind({ name: 'document.pdf' })).toBe('pdf')
    })

    it('classifies audio files', () => {
        expect(getPreviewKind({ name: 'song.mp3' })).toBe('audio')
        expect(getPreviewKind({ name: 'sound.wav' })).toBe('audio')
    })

    it('classifies video files', () => {
        expect(getPreviewKind({ name: 'clip.mp4' })).toBe('video')
        expect(getPreviewKind({ name: 'movie.webm' })).toBe('video')
    })

    it('classifies office files', () => {
        expect(getPreviewKind({ name: 'doc.docx' })).toBe('office')
        expect(getPreviewKind({ name: 'sheet.xlsx' })).toBe('office')
        expect(getPreviewKind({ name: 'slides.pptx' })).toBe('office')
    })

    it('classifies spreadsheet files', () => {
        expect(getPreviewKind({ name: 'data.csv' })).toBe('spreadsheet')
        expect(getPreviewKind({ name: 'data.tsv' })).toBe('spreadsheet')
    })

    it('classifies code/text files', () => {
        expect(getPreviewKind({ name: 'app.ts' })).toBe('code')
        expect(getPreviewKind({ name: 'main.py' })).toBe('code')
        expect(getPreviewKind({ name: 'config.yaml' })).toBe('code')
        expect(getPreviewKind({ name: 'data.json' })).toBe('code')
        expect(getPreviewKind({ name: 'script.sh' })).toBe('code')
        expect(getPreviewKind({ name: 'style.css' })).toBe('code')
    })

    it('returns unsupported for unknown types', () => {
        expect(getPreviewKind({ name: 'archive.zip' })).toBe('unsupported')
        expect(getPreviewKind({ name: 'binary.exe' })).toBe('unsupported')
        expect(getPreviewKind({})).toBe('unsupported')
    })
})

describe('isPreviewableFile', () => {
    it('returns true for previewable files', () => {
        expect(isPreviewableFile({ name: 'readme.md' })).toBe(true)
        expect(isPreviewableFile({ name: 'photo.png' })).toBe(true)
        expect(isPreviewableFile({ name: 'app.ts' })).toBe(true)
    })

    it('returns false for unsupported files', () => {
        expect(isPreviewableFile({ name: 'archive.zip' })).toBe(false)
        expect(isPreviewableFile({ name: 'binary.exe' })).toBe(false)
        expect(isPreviewableFile({})).toBe(false)
    })
})

describe('needsTextContent', () => {
    it('returns true for code, markdown, html', () => {
        expect(needsTextContent('code')).toBe(true)
        expect(needsTextContent('markdown')).toBe(true)
        expect(needsTextContent('html')).toBe(true)
    })

    it('returns false for binary preview types', () => {
        expect(needsTextContent('image')).toBe(false)
        expect(needsTextContent('pdf')).toBe(false)
        expect(needsTextContent('audio')).toBe(false)
        expect(needsTextContent('video')).toBe(false)
        expect(needsTextContent('office')).toBe(false)
        expect(needsTextContent('spreadsheet')).toBe(false)
        expect(needsTextContent('unsupported')).toBe(false)
    })
})

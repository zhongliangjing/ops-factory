import { useCallback, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { usePreview } from '../contexts/PreviewContext'
import { useToast } from '../contexts/ToastContext'
import { useUser } from '../contexts/UserContext'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { inferFileType } from '../utils/filePreview'
import OnlyOfficePreview from './OnlyOfficePreview'
import { GATEWAY_URL, GATEWAY_SECRET_KEY } from '../config/runtime'

// Map file extensions to highlight.js language names
const HLJS_LANG_MAP: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    py: 'python',
    sh: 'bash',
    bash: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    sql: 'sql',
    xml: 'xml',
    svg: 'xml',
    go: 'go',
    rs: 'rust',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    r: 'r',
    lua: 'lua',
    perl: 'perl',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    nginx: 'nginx',
    ini: 'ini',
    toml: 'ini',
    diff: 'diff',
    graphql: 'graphql',
    vue: 'xml',
    svelte: 'xml',
}

// Map file types to display names
function getLanguageName(type: string): string {
    const map: Record<string, string> = {
        js: 'JavaScript',
        ts: 'TypeScript',
        jsx: 'JSX',
        tsx: 'TSX',
        py: 'Python',
        sh: 'Shell',
        bash: 'Bash',
        yaml: 'YAML',
        yml: 'YAML',
        json: 'JSON',
        html: 'HTML',
        htm: 'HTML',
        css: 'CSS',
        md: 'Markdown',
        markdown: 'Markdown',
        txt: 'Text',
        sql: 'SQL',
        xml: 'XML',
        svg: 'SVG',
        go: 'Go',
        rs: 'Rust',
        java: 'Java',
        csv: 'CSV',
        tsv: 'TSV',
        pdf: 'PDF',
        mp3: 'Audio',
        wav: 'Audio',
        ogg: 'Audio',
        m4a: 'Audio',
        mp4: 'Video',
        webm: 'Video',
        mov: 'Video',
        docx: 'DOCX',
        doc: 'DOC',
        xlsx: 'XLSX',
        xls: 'XLS',
        pptx: 'PPTX',
        ppt: 'PPT',
    }
    return map[type.toLowerCase()] || type.toUpperCase()
}

// Safely decode URL-encoded filename
function decodeFileName(name: string): string {
    try {
        return decodeURIComponent(name)
    } catch {
        return name
    }
}

export default function FilePreview() {
    const { t } = useTranslation()
    const { showToast } = useToast()
    const { previewFile, isLoading, error, closePreview } = usePreview()
    const { userId } = useUser()
    const [copied, setCopied] = useState(false)
    const [showSource, setShowSource] = useState(false)

    // Reset state when file changes
    useEffect(() => {
        setCopied(false)
        setShowSource(false)
    }, [previewFile?.path])

    const handleCopy = useCallback(async () => {
        if (!previewFile?.content) return
        try {
            await navigator.clipboard.writeText(previewFile.content)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy:', err)
            showToast('error', t('errors.copyFailed'))
        }
    }, [previewFile?.content, showToast, t])

    const getDownloadUrl = useCallback(() => {
        if (!previewFile) return ''
        let url = `${GATEWAY_URL}/agents/${previewFile.agentId}/files/${encodeURIComponent(previewFile.path)}?key=${GATEWAY_SECRET_KEY}`
        if (userId) url += `&uid=${encodeURIComponent(userId)}`
        return url
    }, [previewFile, userId])

    // Syntax highlighted code
    const highlightedCode = useMemo(() => {
        if (!previewFile?.content) return ''
        const lang = HLJS_LANG_MAP[inferFileType(previewFile)]
        if (lang) {
            try {
                return hljs.highlight(previewFile.content, { language: lang }).value
            } catch {
                // Fallback to auto-detection
                try {
                    return hljs.highlightAuto(previewFile.content).value
                } catch {
                    return ''
                }
            }
        }
        // Try auto-detection for unknown types
        try {
            return hljs.highlightAuto(previewFile.content).value
        } catch {
            return ''
        }
    }, [previewFile?.content, previewFile?.type])

    const isOpen = !!previewFile
    const previewKind = previewFile?.previewKind
    const canToggleSource = previewKind === 'html' || previewKind === 'markdown'
    const canCopyContent = !!previewFile?.content
    const displayType = previewFile ? inferFileType(previewFile) : ''

    return (
        <div className={`file-preview-panel ${isOpen ? 'open' : ''}`}>
            {isOpen && previewFile && (
                <>
                    <div className="file-preview-header">
                        <div className="file-preview-title">
                            <span className="file-preview-name">{decodeFileName(previewFile.name)}</span>
                            <span className="file-preview-lang">{getLanguageName(displayType)}</span>
                        </div>
                        <div className="file-preview-actions">
                            {canToggleSource && (
                                <button
                                    className={`file-preview-btn ${showSource ? 'active' : ''}`}
                                    onClick={() => setShowSource(!showSource)}
                                    title={showSource ? 'Show rendered' : 'Show source'}
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                        {showSource ? (
                                            <>
                                                <circle cx="12" cy="12" r="10" />
                                                <line x1="2" y1="12" x2="22" y2="12" />
                                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                            </>
                                        ) : (
                                            <>
                                                <polyline points="16 18 22 12 16 6" />
                                                <polyline points="8 6 2 12 8 18" />
                                            </>
                                        )}
                                    </svg>
                                </button>
                            )}
                            {canCopyContent && (
                                <button
                                    className="file-preview-btn"
                                    onClick={handleCopy}
                                    title={copied ? 'Copied!' : 'Copy content'}
                                >
                                    {copied ? (
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                    )}
                                </button>
                            )}
                            <a
                                href={getDownloadUrl() + '&download=true'}
                                className="file-preview-btn"
                                title="Download"
                                download
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                            </a>
                            <button
                                className="file-preview-btn file-preview-close"
                                onClick={closePreview}
                                title="Close preview"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div className="file-preview-content">
                        {isLoading && (
                            <div className="file-preview-loading">
                                <div className="loading-spinner" />
                                <p>Loading file...</p>
                            </div>
                        )}

                        {error && (
                            <div className="file-preview-error">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                <p>{error}</p>
                            </div>
                        )}

                        {!isLoading && !error && previewFile && (
                            <>
                                {previewKind === 'image' && (
                                    <div className="file-preview-media-wrapper">
                                        <img
                                            className="file-preview-media-image"
                                            src={getDownloadUrl()}
                                            alt={previewFile.name}
                                        />
                                    </div>
                                )}

                                {previewKind === 'pdf' && (
                                    <iframe
                                        className="file-preview-iframe"
                                        src={getDownloadUrl()}
                                        title={previewFile.name}
                                    />
                                )}

                                {previewKind === 'audio' && (
                                    <div className="file-preview-media-wrapper">
                                        <audio className="file-preview-media-audio" controls src={getDownloadUrl()} />
                                    </div>
                                )}

                                {previewKind === 'video' && (
                                    <div className="file-preview-media-wrapper">
                                        <video className="file-preview-media-video" controls src={getDownloadUrl()} />
                                    </div>
                                )}

                                {previewKind === 'office' && previewFile.onlyofficeUrl && previewFile.fileBaseUrl && (
                                    <OnlyOfficePreview
                                        name={previewFile.name}
                                        path={previewFile.path}
                                        agentId={previewFile.agentId}
                                        type={previewFile.type}
                                        onlyofficeUrl={previewFile.onlyofficeUrl}
                                        fileBaseUrl={previewFile.fileBaseUrl}
                                    />
                                )}

                                {previewKind === 'spreadsheet' && previewFile.tableData && (
                                    <div className="file-preview-table-wrap">
                                        <table className="file-preview-table">
                                            <tbody>
                                                {previewFile.tableData.map((row, rowIdx) => (
                                                    <tr key={`row-${rowIdx}`}>
                                                        {row.map((cell, cellIdx) => (
                                                            <td key={`cell-${rowIdx}-${cellIdx}`}>{cell}</td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* HTML: render in iframe or show source */}
                                {previewKind === 'html' && !showSource && previewFile.content !== undefined && (
                                    <iframe
                                        className="file-preview-iframe"
                                        srcDoc={previewFile.content}
                                        sandbox="allow-same-origin allow-scripts"
                                        title={previewFile.name}
                                    />
                                )}

                                {/* Markdown: render or show source */}
                                {previewKind === 'markdown' && !showSource && previewFile.content !== undefined && (
                                    <div className="file-preview-markdown">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {previewFile.content}
                                        </ReactMarkdown>
                                    </div>
                                )}

                                {/* Source view for renderable types */}
                                {canToggleSource && showSource && previewFile.content !== undefined && (
                                    <pre className="file-preview-code">
                                        <code
                                            dangerouslySetInnerHTML={{ __html: highlightedCode || previewFile.content }}
                                        />
                                    </pre>
                                )}

                                {/* Code files: syntax highlighted */}
                                {previewKind === 'code' && previewFile.content !== undefined && (
                                    <pre className="file-preview-code">
                                        <code
                                            dangerouslySetInnerHTML={{ __html: highlightedCode || previewFile.content }}
                                        />
                                    </pre>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}

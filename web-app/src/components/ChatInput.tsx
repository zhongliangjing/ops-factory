import { useState, useRef, useEffect, useCallback, KeyboardEvent, ChangeEvent, DragEvent, ClipboardEvent } from 'react'
import type { TokenState, ImageData } from '@goosed/sdk'
import AgentSelector from './AgentSelector'
import { compressImageDataUrl, isImageFile, parseDataUrl, readFileAsDataUrl } from '../utils/imageUtils'

// File handling constants
const MAX_IMAGES_PER_MESSAGE = 3
const MAX_FILES_PER_MESSAGE = 5
const MAX_FILE_SIZE_MB = 10
const MAX_IMAGE_SIZE_MB = 5
const SUPPORTED_FILE_TYPES = [
    // Text files
    '.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.csv', '.tsv',
    // Code files
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
    '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.sh', '.bash',
    '.css', '.scss', '.less', '.html', '.vue', '.svelte',
    // Config files
    '.env', '.gitignore', '.dockerignore', '.editorconfig', '.prettierrc',
    '.eslintrc', '.babelrc', 'Dockerfile', 'Makefile',
    // Document files
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    // Archives
    '.zip', '.tar', '.gz',
]

interface UploadedFile {
    id: string
    file: File
    name: string
    type: string
    size: number
    isImage: boolean
    preview?: string       // Data URL for image preview (compressed)
    uploadedPath?: string  // Server path for non-image files after upload
    isLoading: boolean
    error?: string
}

interface ChatInputProps {
    onSubmit: (message: string, images?: ImageData[]) => void
    onStopGeneration?: () => void | Promise<void>
    onUploadFile?: (file: File) => Promise<{ path: string }>
    disabled?: boolean
    isGenerating?: boolean
    placeholder?: string
    autoFocus?: boolean
    selectedAgent?: string
    onAgentChange?: (agentId: string) => void
    showAgentSelector?: boolean
    modelInfo?: { provider: string; model: string } | null
    tokenState?: TokenState | null
    presetMessage?: string
    presetToken?: number
    visionMode?: string  // 'off' | 'passthrough' | 'preprocess'
}

export default function ChatInput({
    onSubmit,
    onStopGeneration,
    onUploadFile,
    disabled = false,
    isGenerating = false,
    placeholder = "Type a message...",
    autoFocus = false,
    selectedAgent = '',
    onAgentChange,
    showAgentSelector = true,
    modelInfo,
    tokenState,
    presetMessage,
    presetToken,
    visionMode = 'off',
}: ChatInputProps) {
    const [value, setValue] = useState('')
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const [isTemplateAppliedFlash, setIsTemplateAppliedFlash] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Auto-resize textarea
    useEffect(() => {
        const textarea = textareaRef.current
        if (textarea) {
            textarea.style.height = 'auto'
            textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
        }
    }, [value])

    // Auto focus
    useEffect(() => {
        if (autoFocus && textareaRef.current) {
            textareaRef.current.focus()
        }
    }, [autoFocus])

    // Fill input from external template selection without submitting.
    useEffect(() => {
        if (typeof presetToken !== 'number') return
        setValue(presetMessage || '')
        setIsTemplateAppliedFlash(true)
        if (textareaRef.current) {
            textareaRef.current.focus()
        }

        const timer = window.setTimeout(() => {
            setIsTemplateAppliedFlash(false)
        }, 1200)

        return () => window.clearTimeout(timer)
    }, [presetToken, presetMessage])

    const imagesAllowed = visionMode !== 'off'

    const isFileTypeSupported = (file: File): boolean => {
        const extension = '.' + file.name.split('.').pop()?.toLowerCase()
        return SUPPORTED_FILE_TYPES.includes(extension) || file.name === 'Dockerfile' || file.name === 'Makefile'
    }

    const currentImageCount = uploadedFiles.filter(f => f.isImage && !f.error).length
    const currentFileCount = uploadedFiles.filter(f => !f.isImage && !f.error).length

    const processImageFile = useCallback(async (file: File, fileId: string) => {
        try {
            const dataUrl = await readFileAsDataUrl(file)
            const compressed = await compressImageDataUrl(dataUrl)
            setUploadedFiles(prev =>
                prev.map(f => f.id === fileId ? { ...f, preview: compressed, isLoading: false } : f)
            )
        } catch (err) {
            setUploadedFiles(prev =>
                prev.map(f => f.id === fileId ? {
                    ...f, isLoading: false,
                    error: `Failed to process image: ${err instanceof Error ? err.message : 'Unknown error'}`
                } : f)
            )
        }
    }, [])

    const processNonImageFile = useCallback(async (file: File, fileId: string) => {
        if (!onUploadFile) {
            setUploadedFiles(prev =>
                prev.map(f => f.id === fileId ? { ...f, isLoading: false, error: 'File upload not available' } : f)
            )
            return
        }
        try {
            const result = await onUploadFile(file)
            setUploadedFiles(prev =>
                prev.map(f => f.id === fileId ? { ...f, uploadedPath: result.path, isLoading: false } : f)
            )
        } catch (err) {
            setUploadedFiles(prev =>
                prev.map(f => f.id === fileId ? {
                    ...f, isLoading: false,
                    error: `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`
                } : f)
            )
        }
    }, [onUploadFile])

    const handleFileSelect = async (files: FileList | null) => {
        if (!files || files.length === 0) return

        const incoming = Array.from(files)

        // Separate images and non-images
        const imageFiles = incoming.filter(f => isImageFile(f))
        const nonImageFiles = incoming.filter(f => !isImageFile(f))

        // Check image limits
        if (imageFiles.length > 0 && !imagesAllowed) {
            alert('Image upload is not enabled for this agent.')
            if (nonImageFiles.length === 0) return
        }

        const allowedImages = imagesAllowed
            ? imageFiles.slice(0, MAX_IMAGES_PER_MESSAGE - currentImageCount)
            : []
        const allowedFiles = nonImageFiles.slice(0, MAX_FILES_PER_MESSAGE - currentFileCount)

        if (allowedImages.length < imageFiles.length && imagesAllowed) {
            alert(`Maximum ${MAX_IMAGES_PER_MESSAGE} images allowed per message.`)
        }
        if (allowedFiles.length < nonImageFiles.length) {
            alert(`Maximum ${MAX_FILES_PER_MESSAGE} files allowed per message.`)
        }

        const allFiles = [...allowedImages, ...allowedFiles]
        if (allFiles.length === 0) return

        // Add files with loading state
        const newEntries: UploadedFile[] = allFiles.map(file => {
            const isImage = isImageFile(file)
            const maxSize = isImage ? MAX_IMAGE_SIZE_MB : MAX_FILE_SIZE_MB

            const entry: UploadedFile = {
                id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                file,
                name: file.name,
                type: file.type,
                size: file.size,
                isImage,
                isLoading: true,
            }

            // Check file type
            if (!isImage && !isFileTypeSupported(file)) {
                return { ...entry, isLoading: false, error: `Unsupported file type.` }
            }

            // Check file size
            if (file.size > maxSize * 1024 * 1024) {
                return {
                    ...entry, isLoading: false,
                    error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Max: ${maxSize}MB`
                }
            }

            return entry
        })

        setUploadedFiles(prev => [...prev, ...newEntries])

        // Process files in parallel
        for (const entry of newEntries) {
            if (entry.error) continue
            if (entry.isImage) {
                processImageFile(entry.file, entry.id)
            } else {
                processNonImageFile(entry.file, entry.id)
            }
        }

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(true)
    }

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
    }

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        const files = e.dataTransfer.files
        handleFileSelect(files)
    }

    const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.files
        if (!items || items.length === 0) return

        const imageFiles = Array.from(items).filter(f => isImageFile(f))
        if (imageFiles.length === 0) return

        e.preventDefault()

        if (!imagesAllowed) {
            alert('Image upload is not enabled for this agent.')
            return
        }

        const remaining = MAX_IMAGES_PER_MESSAGE - currentImageCount
        if (remaining <= 0) {
            alert(`Maximum ${MAX_IMAGES_PER_MESSAGE} images allowed per message.`)
            return
        }

        const toProcess = imageFiles.slice(0, remaining)
        const newEntries: UploadedFile[] = toProcess.map((file, i) => ({
            id: `paste-${Date.now()}-${i}`,
            file,
            name: file.name || `pasted-image-${Date.now()}.png`,
            type: file.type,
            size: file.size,
            isImage: true,
            isLoading: true,
        }))

        setUploadedFiles(prev => [...prev, ...newEntries])

        for (const entry of newEntries) {
            processImageFile(entry.file, entry.id)
        }
    }

    const handleRemoveFile = (id: string) => {
        setUploadedFiles(prev => prev.filter(f => f.id !== id))
    }

    const handleSubmit = () => {
        if (disabled) return

        // Extract images as ImageData[]
        const images: ImageData[] = uploadedFiles
            .filter(f => f.isImage && f.preview && !f.error && !f.isLoading)
            .map(f => parseDataUrl(f.preview!))
            .filter((parsed): parsed is { data: string; mimeType: string } => parsed !== null)

        // Collect non-image file paths to append to text
        const filePaths = uploadedFiles
            .filter(f => !f.isImage && f.uploadedPath && !f.error && !f.isLoading)
            .map(f => f.uploadedPath!)

        let text = value.trim()
        if (filePaths.length > 0) {
            text = text ? `${text} ${filePaths.join(' ')}` : filePaths.join(' ')
        }

        if (!text && images.length === 0) return

        onSubmit(text, images.length > 0 ? images : undefined)
        setValue('')
        setUploadedFiles([])
        // Reset textarea height
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
        }
    }

    const handleStopGeneration = () => {
        if (!isGenerating || !onStopGeneration) return
        onStopGeneration()
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            handleSubmit()
        }
    }

    const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
        setValue(e.target.value)
    }

    const handleFileInputClick = () => {
        fileInputRef.current?.click()
    }

    const hasContent = value.trim() || uploadedFiles.some(f => !f.error && !f.isLoading)
    const totalFileCount = uploadedFiles.length
    const maxTotalFiles = MAX_IMAGES_PER_MESSAGE + MAX_FILES_PER_MESSAGE
    const isAnyFileLoading = uploadedFiles.some(f => f.isLoading)

    return (
        <div
            className={`chat-input-container ${isDragging ? 'dragging' : ''} ${isTemplateAppliedFlash ? 'template-applied' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={SUPPORTED_FILE_TYPES.join(',')}
                onChange={(e) => handleFileSelect(e.target.files)}
                style={{ display: 'none' }}
            />

            {/* Drag overlay */}
            {isDragging && (
                <div className="drag-overlay">
                    <div className="drag-overlay-content">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="48" height="48">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <p>Drop files here</p>
                    </div>
                </div>
            )}

            {/* Uploaded files preview */}
            {uploadedFiles.length > 0 && (
                <div className="uploaded-files">
                    {uploadedFiles.map(file => (
                        <div key={file.id} className={`uploaded-file ${file.error ? 'error' : ''}`}>
                            {file.isImage && file.preview ? (
                                <img src={file.preview} alt={file.name} className="uploaded-file-preview" />
                            ) : (
                                <div className="uploaded-file-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                                        <polyline points="13 2 13 9 20 9" />
                                    </svg>
                                </div>
                            )}
                            <div className="uploaded-file-info">
                                <span className="uploaded-file-name">{file.name}</span>
                                {file.error ? (
                                    <span className="uploaded-file-error">{file.error}</span>
                                ) : file.isLoading ? (
                                    <span className="uploaded-file-loading">Loading...</span>
                                ) : (
                                    <span className="uploaded-file-size">
                                        {(file.size / 1024).toFixed(1)} KB
                                    </span>
                                )}
                            </div>
                            <button
                                className="uploaded-file-remove"
                                onClick={() => handleRemoveFile(file.id)}
                                aria-label="Remove file"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="chat-input-wrapper">
                <textarea
                    ref={textareaRef}
                    className="chat-input"
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={placeholder}
                    disabled={disabled}
                    rows={1}
                />
            </div>

            {/* Toolbar */}
            <div className="chat-input-toolbar">
                {/* Attach button */}
                <button
                    className="toolbar-btn"
                    onClick={handleFileInputClick}
                    disabled={disabled || totalFileCount >= maxTotalFiles}
                    title={`Attach files (${totalFileCount}/${maxTotalFiles})`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" width="17" height="17">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                    {totalFileCount > 0 && (
                        <span className="toolbar-badge">{totalFileCount}</span>
                    )}
                </button>

                <div className="toolbar-divider" />

                {/* Model info */}
                {modelInfo && (
                    <>
                        <div className="toolbar-item toolbar-model-info">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                            </svg>
                            <span className="toolbar-text">{modelInfo.model}</span>
                        </div>
                        <div className="toolbar-divider" />
                    </>
                )}

                {/* Token usage */}
                {tokenState && tokenState.accumulatedTotalTokens > 0 && (
                    <>
                        <div className="toolbar-item toolbar-token-info" title={`Input: ${tokenState.accumulatedInputTokens.toLocaleString()} / Output: ${tokenState.accumulatedOutputTokens.toLocaleString()}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
                                <line x1="16" y1="8" x2="2" y2="22" />
                                <line x1="17.5" y1="15" x2="9" y2="15" />
                            </svg>
                            <span className="toolbar-text">{tokenState.accumulatedTotalTokens.toLocaleString()}</span>
                        </div>
                        <div className="toolbar-divider" />
                    </>
                )}

                {/* Agent selector */}
                {showAgentSelector && onAgentChange && (
                    <AgentSelector
                        selectedAgent={selectedAgent}
                        onAgentChange={onAgentChange}
                        disabled={disabled}
                    />
                )}

                <button
                    className={`chat-send-btn-new ${isGenerating ? 'is-stop' : ''}`}
                    onClick={isGenerating ? handleStopGeneration : handleSubmit}
                    disabled={isGenerating ? !onStopGeneration : (disabled || !hasContent || isAnyFileLoading)}
                    aria-label={isGenerating ? "Stop generation" : "Send message"}
                    title={isGenerating ? "Stop generation" : "Send message"}
                >
                    {isGenerating ? (
                        <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
                            <rect x="5.5" y="5.5" width="13" height="13" rx="2.1" />
                        </svg>
                    ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="18" height="18">
                            <path d="M12 19V5" />
                            <path d="M6.5 10.5L12 5l5.5 5.5" />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    )
}

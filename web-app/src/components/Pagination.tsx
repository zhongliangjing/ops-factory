import { useTranslation } from 'react-i18next'

interface PaginationProps {
    currentPage: number
    totalPages: number
    pageSize: number
    totalItems: number
    onPageChange: (page: number) => void
    onPageSizeChange?: (size: number) => void
    disabled?: boolean
}

export default function Pagination({
    currentPage,
    totalPages,
    pageSize,
    totalItems,
    onPageChange,
    onPageSizeChange,
    disabled = false
}: PaginationProps) {
    const { t } = useTranslation()

    const getPageNumbers = () => {
        const pages: (number | string)[] = []
        const showEllipsis = totalPages > 7

        if (!showEllipsis) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i)
            }
        } else {
            if (currentPage <= 4) {
                pages.push(1, 2, 3, 4, 5, '...', totalPages)
            } else if (currentPage >= totalPages - 3) {
                pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
            } else {
                pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
            }
        }
        return pages
    }

    const startItem = Math.min((currentPage - 1) * pageSize + 1, totalItems)
    const endItem = Math.min(currentPage * pageSize, totalItems)

    return (
        <div className="pagination">
            <div className="pagination-info">
                <span className="pagination-text">
                    {t('common.showing', {
                        start: startItem,
                        end: endItem,
                        total: totalItems
                    })}
                </span>

                {onPageSizeChange && (
                    <select
                        className="pagination-size-select"
                        value={pageSize}
                        onChange={(e) => onPageSizeChange(Number(e.target.value))}
                        disabled={disabled}
                    >
                        <option value={10}>10 {t('common.perPage')}</option>
                        <option value={20}>20 {t('common.perPage')}</option>
                        <option value={50}>50 {t('common.perPage')}</option>
                        <option value={100}>100 {t('common.perPage')}</option>
                    </select>
                )}
            </div>

            <div className="pagination-controls">
                <button
                    className="pagination-btn"
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={disabled || currentPage === 1}
                    aria-label={t('common.previousPage')}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>

                {getPageNumbers().map((page, index) => (
                    typeof page === 'number' ? (
                        <button
                            key={index}
                            className={`pagination-btn ${page === currentPage ? 'active' : ''}`}
                            onClick={() => onPageChange(page)}
                            disabled={disabled}
                        >
                            {page}
                        </button>
                    ) : (
                        <span key={index} className="pagination-ellipsis">
                            {page}
                        </span>
                    )
                ))}

                <button
                    className="pagination-btn"
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={disabled || currentPage === totalPages}
                    aria-label={t('common.nextPage')}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </button>
            </div>
        </div>
    )
}

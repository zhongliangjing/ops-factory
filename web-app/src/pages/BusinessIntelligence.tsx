import { useTranslation } from 'react-i18next'

export default function BusinessIntelligence() {
    const { t } = useTranslation()

    return (
        <div className="page-container sidebar-top-page">
            <div className="page-header">
                <h1 className="page-title">{t('businessIntelligence.title')}</h1>
                <p className="page-subtitle">{t('businessIntelligence.subtitle')}</p>
            </div>

            <div className="empty-state">
                <svg className="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 3v18h18" />
                    <rect x="7" y="11" width="3" height="6" rx="1" />
                    <rect x="12" y="7" width="3" height="10" rx="1" />
                    <rect x="17" y="4" width="3" height="13" rx="1" />
                </svg>
                <h3 className="empty-state-title">{t('businessIntelligence.placeholderTitle')}</h3>
                <p className="empty-state-description">{t('businessIntelligence.placeholderDescription')}</p>
            </div>
        </div>
    )
}

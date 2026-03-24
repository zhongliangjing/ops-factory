import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { KNOWLEDGE_SERVICE_URL } from '../config/runtime'

interface SourceDetail {
    id: string
    name: string
    description: string | null
}

export default function KnowledgeConfigure() {
    const { t } = useTranslation()
    const { sourceId } = useParams<{ sourceId: string }>()
    const [source, setSource] = useState<SourceDetail | null>(null)

    useEffect(() => {
        let cancelled = false
        async function loadSource() {
            if (!sourceId) return
            try {
                const response = await fetch(`${KNOWLEDGE_SERVICE_URL}/ops-knowledge/sources/${sourceId}`)
                if (!response.ok) return
                const data = await response.json() as SourceDetail
                if (!cancelled) {
                    setSource(data)
                }
            } catch {
                if (!cancelled) {
                    setSource(null)
                }
            }
        }
        void loadSource()
        return () => {
            cancelled = true
        }
    }, [sourceId])

    return (
        <div className="page-container">
            <div className="page-header">
                <h1 className="page-title">{source?.name || t('knowledge.configure')}</h1>
                <p className="page-subtitle">{source?.description || t('knowledge.configurePlaceholder')}</p>
            </div>
            <div className="empty-state">
                <div className="empty-state-title">{t('knowledge.configurePlaceholderTitle')}</div>
                <div className="empty-state-description">{t('knowledge.configurePlaceholder')}</div>
            </div>
        </div>
    )
}

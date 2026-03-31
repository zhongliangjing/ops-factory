import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HostsTab } from './Hosts'
import { SopsTab } from './Sops'
import { WhitelistTab } from './Whitelist'

type DiagnosisTab = 'hosts' | 'sops' | 'whitelist'

export default function Diagnosis() {
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState<DiagnosisTab>('hosts')

    const tabs: { key: DiagnosisTab; label: string }[] = [
        { key: 'hosts', label: t('sidebar.hosts') },
        { key: 'sops', label: t('sidebar.sops') },
        { key: 'whitelist', label: t('sidebar.whitelist') },
    ]

    return (
        <div className="page-container sidebar-top-page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">{t('sidebar.faultDiagnosis')}</h1>
                    <p className="page-subtitle">{t('remoteDiagnosis.subtitle')}</p>
                </div>
            </div>

            <div className="config-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        type="button"
                        className={`config-tab ${activeTab === tab.key ? 'config-tab-active' : ''}`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'hosts' && <HostsTab />}
            {activeTab === 'sops' && <SopsTab />}
            {activeTab === 'whitelist' && <WhitelistTab />}
        </div>
    )
}

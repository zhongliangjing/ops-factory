import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useGoosed } from '../contexts/GoosedContext'
import { useUser } from '../contexts/UserContext'
import { useToast } from '../contexts/ToastContext'
import ChatInput from '../components/ChatInput'
import { PROMPT_TEMPLATES, CATEGORIES, type PromptTemplateConfig } from '../config/promptTemplates'
import { iconMap } from '../config/iconMap'
import { gatewayHeaders } from '../config/runtime'

interface ModelInfo {
    provider: string
    model: string
}

const UNIVERSAL_AGENT_ID = 'universal-agent'

// 诊断接口不需要 ops-gateway 后缀的网关地址
const DIAGNOSIS_GATEWAY_URL = `${import.meta.env.VITE_GATEWAY_URL || 'http://localhost:3000'}`

export default function Home() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { showToast } = useToast()
    const { userId } = useUser()
    const { getClient, agents, isConnected, error: connectionError } = useGoosed()
    const [isCreatingSession, setIsCreatingSession] = useState(false)
    const [diagnosisMessage, setDiagnosisMessage] = useState<string>('')
    const [selectedAgent, setSelectedAgent] = useState('')
    const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
    const [presetMessage, setPresetMessage] = useState('')
    const [presetToken, setPresetToken] = useState(0)
    const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
    const [activeCategory, setActiveCategory] = useState<string>('all')
    
    // 诊断接口调用
    const handleDiagnosis = async (sceneCode: string) => {
        try {
            // 使用不带 ops-gateway 后缀的网关地址
            const res = await fetch(`${DIAGNOSIS_GATEWAY_URL}/itom/api/diagnosis/getDiagnosisQuery?sceneCode=${sceneCode}`, {
                headers: gatewayHeaders(userId),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            // 使用 text() 获取字符串响应
            const data = await res.text();
            console.log('诊断结果:', data);
            let messageContent = '';
            if (data) {
                messageContent = data;
            }
            setDiagnosisMessage(messageContent);
            return data;
        } catch (err) {
            console.error('获取诊断信息失败:', err);
            showToast('error', '获取诊断信息失败');
            throw err;
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const hasScene = params.get('sceneCode')
        if (agents.length > 0) {
            if (hasScene) {
                setSelectedAgent('qos-agent');
                // 调用诊断接口获取消息内容
                handleDiagnosis(hasScene);
            } else if (!selectedAgent) {
                // 没有sceneCode且没有选择agent时，选择默认agent
                const universal = agents.find(a => a.id === UNIVERSAL_AGENT_ID);
                setSelectedAgent(universal ? universal.id : agents[0].id);
            }
        }
    }, [agents, selectedAgent])

    // 当诊断接口返回数据后，自动发送消息
    useEffect(() => {
        if (selectedAgent && diagnosisMessage) {
            console.log('诊断接口返回数据，发送消息:', diagnosisMessage);
            // 清空诊断消息，避免重复发送
            setDiagnosisMessage('');
            // 发送诊断结果作为消息
            handleInputSubmit(diagnosisMessage);
        }
    }, [selectedAgent, diagnosisMessage]);

    useEffect(() => {
        const fetchModelInfo = async () => {
            if (!isConnected || !selectedAgent) return
            try {
                const client = getClient(selectedAgent)
                const systemInfo = await client.systemInfo()
                if (systemInfo.provider && systemInfo.model) {
                    setModelInfo({ provider: systemInfo.provider, model: systemInfo.model })
                }
            } catch (err) {
                console.error('Failed to fetch model info:', err)
            }
        }
        fetchModelInfo()
    }, [getClient, selectedAgent, isConnected])

    const handleInputSubmit = async (message: string) => {
        if (isCreatingSession || !selectedAgent) return

        setIsCreatingSession(true)
        try {
            const client = getClient(selectedAgent)
            const session = await client.startSession()

            navigate(`/chat?sessionId=${session.id}&agent=${selectedAgent}`, {
                state: { initialMessage: message }
            })
        } catch (err) {
            console.error('Failed to create session:', err)
            showToast('error', t('home.failedToCreateSession', { error: err instanceof Error ? err.message : 'Unknown error' }))
        } finally {
            setIsCreatingSession(false)
        }
    }

    const filteredTemplates = useMemo(
        () => activeCategory === 'all'
            ? PROMPT_TEMPLATES
            : PROMPT_TEMPLATES.filter(tpl => tpl.category === activeCategory),
        [activeCategory]
    )

    const handleTemplateSelect = (template: PromptTemplateConfig) => {
        const targetAgentId = agents.find(a => a.id === template.agentId)?.id || template.agentId
        setSelectedAgent(targetAgentId)
        const i18nKey = template.i18nKey.replace('templates.', '')
        setPresetMessage(t(`home.templates.${i18nKey}.prompt`))
        setPresetToken(prev => prev + 1)
        setActiveTemplateId(template.id)
    }

    return (
        <div className="home-container">
            <div className="home-hero">
                <h1 className="home-title">{t('home.greeting')}</h1>
                <p className="home-description">
                    {t('home.description')}
                </p>

                {connectionError && (
                    <div className="conn-banner conn-banner-error">
                        {t('common.connectionError', { error: connectionError })}
                    </div>
                )}

                {!isConnected && !connectionError && (
                    <div className="conn-banner conn-banner-warning">
                        {t('common.connectingGateway')}
                    </div>
                )}
            </div>

            <div className="home-input-container">
                <ChatInput
                    onSubmit={handleInputSubmit}
                    disabled={!isConnected || isCreatingSession || !selectedAgent}
                    placeholder={isCreatingSession ? t('home.creatingSession') : t('home.askAnything')}
                    autoFocus
                    selectedAgent={selectedAgent}
                    onAgentChange={setSelectedAgent}
                    modelInfo={modelInfo}
                    presetMessage={presetMessage}
                    presetToken={presetToken}
                />
            </div>

            <div className="home-template-section">
                <div className="home-template-tabs" role="tablist" aria-label="Scenario category tabs">
                    {CATEGORIES.map(categoryId => (
                        <button
                            key={categoryId}
                            type="button"
                            role="tab"
                            aria-selected={activeCategory === categoryId}
                            className={`home-template-tab ${activeCategory === categoryId ? 'is-active' : ''}`}
                            onClick={() => setActiveCategory(categoryId)}
                        >
                            {t(`home.categories.${categoryId}`)}
                        </button>
                    ))}
                </div>

                <div className="home-template-grid">
                    {filteredTemplates.map(template => {
                        const Icon = iconMap[template.icon]
                        const i18nKey = template.i18nKey.replace('templates.', '')
                        return (
                            <button
                                key={template.id}
                                type="button"
                                className={`prompt-template-card ${activeTemplateId === template.id ? 'is-active' : ''}`}
                                onClick={() => handleTemplateSelect(template)}
                            >
                                <div className="prompt-template-icon-container">
                                    {Icon && <Icon size={20} />}
                                </div>
                                <h4 className="prompt-template-name">{t(`home.templates.${i18nKey}.title`)}</h4>
                                <p className="prompt-template-desc">{t(`home.templates.${i18nKey}.description`)}</p>
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

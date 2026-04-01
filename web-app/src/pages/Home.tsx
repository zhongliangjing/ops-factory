import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useGoosed } from '../contexts/GoosedContext'
import { useUser } from '../contexts/UserContext'
import { useToast } from '../contexts/ToastContext'
import ChatInput from '../components/ChatInput'
import { gatewayHeaders } from '../config/runtime'
import opsclawIcon from '../assets/opsclaw.svg'
import { getUrlParams } from '../utils/urlParams'

interface ModelInfo {
    provider: string
    model: string
}

const UNIVERSAL_AGENT_ID = 'universal-agent'

// 诊断接口不需要 gateway 前缀的网关地址
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
    
    // 诊断接口调用
    const handleDiagnosis = async (sceneCode: string) => {
        try {
            // 使用不带 gateway 前缀的网关地址
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
        const params = getUrlParams()
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
            const params = getUrlParams()
             const startT = new Date(Number(params.get('startTime'))).toLocaleString('zh-CN', {timeZone:
            'Asia/Shanghai'});
           const endT= new Date(Number(params.get('endTime'))).toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'}); 
            const timeStr = params.get('startTime') && params.get('endTime') ? `， 时间区间为[ ${startT}，${endT} ]` : ''
            const str = '对环境：'+ params.get('envCode') + '进行健康度初步分析' + timeStr
            // 发送诊断结果作为消息
            handleInputSubmit(str);
            // handleInputSubmit(diagnosisMessage);
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

    return (
        <div className="home-container">
            <div className="home-hero">
                <h1 className="home-title">
                    <span>{t('home.greeting')}</span>
                    <img
                        src={opsclawIcon}
                        alt=""
                        aria-hidden="true"
                        className="home-title-icon"
                        data-testid="home-title-icon"
                    />
                </h1>
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
                />
            </div>
        </div>
    )
}

import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useGoosed } from '../contexts/GoosedContext'
import { useInbox } from '../contexts/InboxContext'
import { useToast } from '../contexts/ToastContext'
import { useUser } from '../contexts/UserContext'
import { useSidebar } from '../contexts/SidebarContext'
import { getAvatarForUser } from '../pages/Settings'
import SettingsModal from '../pages/Settings'
import { isAdminUser } from '../config/runtime'

export default function Sidebar() {
    const { t } = useTranslation()
    const { getClient, agents } = useGoosed()
    const { showToast } = useToast()
    const { unreadCount } = useInbox()
    const { userId, role, logout } = useUser()
    const { isCollapsed, toggleSidebar } = useSidebar()
    const isAdmin = isAdminUser(userId, role)
    const navigate = useNavigate()
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [isCreatingSession, setIsCreatingSession] = useState(false)

    const avatar = userId ? getAvatarForUser(userId) : '🦆'

    const handleLogout = () => {
        logout()
        navigate('/login', { replace: true })
    }

    const handleNewChat = async () => {
        const defaultAgent = agents[0]?.id
        if (!defaultAgent || isCreatingSession) return

        setIsCreatingSession(true)
        try {
            const session = await getClient(defaultAgent).startSession()
            navigate(`/chat?sessionId=${session.id}&agent=${defaultAgent}`)
        } catch (err) {
            console.error('Failed to create session:', err)
            showToast('error', t('home.failedToCreateSession', { error: err instanceof Error ? err.message : 'Unknown error' }))
        } finally {
            setIsCreatingSession(false)
        }
    }

    return (
        <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <span className="sidebar-logo-text">OpsFactory</span>
                </div>
                <button
                    className="sidebar-toggle-btn"
                    onClick={toggleSidebar}
                    title={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                        {isCollapsed ? (
                            <>
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                <line x1="9" y1="3" x2="9" y2="21" />
                                <polyline points="13 8 16 12 13 16" />
                            </>
                        ) : (
                            <>
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                <line x1="9" y1="3" x2="9" y2="21" />
                                <polyline points="16 8 13 12 16 16" />
                            </>
                        )}
                    </svg>
                </button>
            </div>

            <nav className="sidebar-nav">
                <NavLink
                    to="/"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    end
                    title={isCollapsed ? t('sidebar.home') : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                    <span className="nav-label">{t('sidebar.home')}</span>
                </NavLink>

                <button
                    type="button"
                    className="nav-link new-chat-nav"
                    title={isCollapsed ? t('sidebar.newChat') : undefined}
                    onClick={handleNewChat}
                    disabled={isCreatingSession}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span className="nav-label">{t('sidebar.newChat')}</span>
                </button>

                <NavLink
                    to="/history"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    title={isCollapsed ? t('sidebar.history') : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span className="nav-label">{t('sidebar.history')}</span>
                </NavLink>

                <NavLink
                    to="/inbox"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    title={isCollapsed ? t('sidebar.inbox') : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 12h-4l-3 4H9l-3-4H2" />
                        <path d="M5 12V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" />
                    </svg>
                    <span className="nav-label">{t('sidebar.inbox')}</span>
                    {unreadCount > 0 && <span className="sidebar-badge">{unreadCount}</span>}
                </NavLink>

                {isAdmin && <NavLink
                    to="/agents"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    title={isCollapsed ? t('sidebar.agents') : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                    </svg>
                    <span className="nav-label">{t('sidebar.agents')}</span>
                </NavLink>}

                {isAdmin && <NavLink
                    to="/knowledge"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    title={isCollapsed ? t('sidebar.knowledge') : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                    <span className="nav-label">{t('sidebar.knowledge')}</span>
                </NavLink>}

                <NavLink
                    to="/files"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    title={isCollapsed ? t('sidebar.files') : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    <span className="nav-label">{t('sidebar.files')}</span>
                </NavLink>

                {isAdmin && <NavLink
                    to="/scheduled-actions"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    title={isCollapsed ? t('sidebar.scheduler') : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                        <path d="M9 2v3M15 2v3M9 19v3M15 19v3" />
                    </svg>
                    <span className="nav-label">{t('sidebar.scheduler')}</span>
                </NavLink>}

                {isAdmin && <NavLink
                    to="/monitoring"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    title={isCollapsed ? t('sidebar.monitoring') : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    <span className="nav-label">{t('sidebar.monitoring')}</span>
                </NavLink>}
            </nav>

            <div className="sidebar-user-section">
                <span className="sidebar-user-avatar">{avatar}</span>
                <span className="sidebar-user-name">{userId}</span>
                <div className="sidebar-user-actions">
                    <button className="sidebar-user-btn" onClick={() => setSettingsOpen(true)} title={t('sidebar.settings')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                    </button>
                    <button className="sidebar-user-btn" onClick={handleLogout} title={t('sidebar.logout')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                </div>
            </div>
            <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </aside>
    )
}

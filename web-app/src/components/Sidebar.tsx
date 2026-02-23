import { NavLink, useNavigate } from 'react-router-dom'
import { useInbox } from '../contexts/InboxContext'
import { useUser } from '../contexts/UserContext'
import { getAvatarForUser } from '../pages/Settings'

export default function Sidebar() {
    const { unreadCount } = useInbox()
    const { userId, logout } = useUser()
    const navigate = useNavigate()

    const avatar = userId ? getAvatarForUser(userId) : '🦆'

    const handleLogout = () => {
        logout()
        navigate('/login', { replace: true })
    }

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-logo">
                    <span>OpsFactory</span>
                </div>
            </div>

            <nav className="sidebar-nav">
                <NavLink
                    to="/"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    end
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                    <span>Home</span>
                </NavLink>

                <NavLink to="/chat" className="nav-link new-chat-nav">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span>New Chat</span>
                </NavLink>

                <NavLink
                    to="/history"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span>History</span>
                </NavLink>

                <NavLink
                    to="/inbox"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 12h-4l-3 4H9l-3-4H2" />
                        <path d="M5 12V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" />
                    </svg>
                    <span>Inbox</span>
                    {unreadCount > 0 && <span className="sidebar-badge">{unreadCount}</span>}
                </NavLink>

                <NavLink
                    to="/agents"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                    </svg>
                    <span>Agents</span>
                </NavLink>

                <NavLink
                    to="/files"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    <span>Files</span>
                </NavLink>

                <NavLink
                    to="/scheduled-actions"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                        <path d="M9 2v3M15 2v3M9 19v3M15 19v3" />
                    </svg>
                    <span>Scheduler</span>
                </NavLink>

                <NavLink
                    to="/monitoring"
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    <span>Monitoring</span>
                </NavLink>
            </nav>

            <div className="sidebar-user-section">
                <span className="sidebar-user-avatar">{avatar}</span>
                <span className="sidebar-user-name">{userId}</span>
                <div className="sidebar-user-actions">
                    <button className="sidebar-user-btn" onClick={() => navigate('/settings')} title="Settings">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                    </button>
                    <button className="sidebar-user-btn" onClick={handleLogout} title="Log out">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                </div>
            </div>
        </aside>
    )
}

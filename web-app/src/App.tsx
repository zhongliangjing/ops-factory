import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Chat from './pages/Chat'
import History from './pages/History'
import Files from './pages/Files'
import Agents from './pages/Agents'
import AgentConfigure from './pages/AgentConfigure'
import ScheduledActions from './pages/ScheduledActions'
import Monitoring from './pages/Monitoring'
import Inbox from './pages/Inbox'
import Login from './pages/Login'
import FilePreview from './components/FilePreview'
import { PreviewProvider, usePreview } from './contexts/PreviewContext'
import { InboxProvider } from './contexts/InboxContext'
import { SidebarProvider, useSidebar } from './contexts/SidebarContext'
import { ProtectedRoute, AdminRoute } from './contexts/UserContext'

const IS_EMBED = new URLSearchParams(window.location.search).get('embed') === 'true'

function AppContent() {
    const { previewFile } = usePreview()
    const { isCollapsed } = useSidebar()
    const isPreviewOpen = !!previewFile
    const isEmbed = IS_EMBED

    const mainWrapperClass = [
        'main-wrapper',
        isEmbed ? 'embed-mode' : '',
        isPreviewOpen ? 'with-preview' : '',
        isCollapsed ? 'sidebar-collapsed' : '',
    ].filter(Boolean).join(' ')

    return (
        <div className="app-container">
            <div className={mainWrapperClass}>
                <main className="main-content">
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/chat" element={<Chat />} />
                        <Route path="/history" element={<History />} />
                        <Route path="/files" element={<Files />} />
                        <Route path="/scheduled-actions" element={<AdminRoute><ScheduledActions /></AdminRoute>} />
                        <Route path="/monitoring" element={<AdminRoute><Monitoring /></AdminRoute>} />
                        <Route path="/inbox" element={<Inbox />} />
                        <Route path="/agents" element={<Agents />} />
                        <Route path="/agents/:agentId/configure" element={<AdminRoute><AgentConfigure /></AdminRoute>} />
                    </Routes>
                </main>
                {!isEmbed && <FilePreview />}
            </div>
        </div>
    )
}

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/*" element={
                <ProtectedRoute>
                    <SidebarProvider>
                        <InboxProvider>
                            <PreviewProvider>
                                <AppContent />
                            </PreviewProvider>
                        </InboxProvider>
                    </SidebarProvider>
                </ProtectedRoute>
            } />
        </Routes>
    )
}

import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
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
import Settings from './pages/Settings'
import FilePreview from './components/FilePreview'
import { PreviewProvider, usePreview } from './contexts/PreviewContext'
import { ToastProvider } from './contexts/ToastContext'
import { InboxProvider } from './contexts/InboxContext'
import { ProtectedRoute } from './contexts/UserContext'

function AppContent() {
    const { previewFile } = usePreview()
    const isPreviewOpen = !!previewFile

    return (
        <div className="app-container">
            <Sidebar />
            <div className={`main-wrapper ${isPreviewOpen ? 'with-preview' : ''}`}>
                <main className="main-content">
                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/chat" element={<Chat />} />
                        <Route path="/history" element={<History />} />
                        <Route path="/files" element={<Files />} />
                        <Route path="/scheduled-actions" element={<ScheduledActions />} />
                        <Route path="/monitoring" element={<Monitoring />} />
                        <Route path="/inbox" element={<Inbox />} />
                        <Route path="/agents" element={<Agents />} />
                        <Route path="/agents/:agentId/configure" element={<AgentConfigure />} />
                        <Route path="/settings" element={<Settings />} />
                    </Routes>
                </main>
                <FilePreview />
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
                    <ToastProvider>
                        <InboxProvider>
                            <PreviewProvider>
                                <AppContent />
                            </PreviewProvider>
                        </InboxProvider>
                    </ToastProvider>
                </ProtectedRoute>
            } />
        </Routes>
    )
}

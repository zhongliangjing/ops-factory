import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { UserProvider } from './contexts/UserContext'
import { GoosedProvider } from './contexts/GoosedContext'
import { ToastProvider } from './contexts/ToastContext'
import ErrorBoundary from './components/ErrorBoundary'
import { initializeRuntimeConfig } from './config/runtime'
import './i18n'
import './App.css'

function renderStartupError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown startup error'
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <div style={{ padding: '24px', fontFamily: 'monospace', lineHeight: 1.5 }}>
                <h1>Web App startup failed</h1>
                <p>{message}</p>
                <p>Please verify /config.json on the deployment host.</p>
            </div>
        </React.StrictMode>,
    )
}

async function bootstrap() {
    try {
        await initializeRuntimeConfig()
        ReactDOM.createRoot(document.getElementById('root')!).render(
            <React.StrictMode>
                <ErrorBoundary>
                    <HashRouter>
                        <ToastProvider>
                            <UserProvider>
                                <GoosedProvider>
                                    <App />
                                </GoosedProvider>
                            </UserProvider>
                        </ToastProvider>
                    </HashRouter>
                </ErrorBoundary>
            </React.StrictMode>,
        )
    } catch (error) {
        console.error('Failed to initialize runtime config', error)
        renderStartupError(error)
    }
}

void bootstrap()

import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { UserProvider } from './contexts/UserContext'
import { GoosedProvider } from './contexts/GoosedContext'
import { ToastProvider } from './contexts/ToastContext'
import ErrorBoundary from './components/ErrorBoundary'
import './i18n'
import './App.css'

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

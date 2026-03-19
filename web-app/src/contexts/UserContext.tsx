import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { GATEWAY_URL, GATEWAY_SECRET_KEY, isAdminUser } from '../config/runtime'

const STORAGE_KEY = 'opsfactory:userId'

export type UserRole = 'admin' | 'user'

interface UserContextType {
    userId: string | null
    role: UserRole | null
    login: (username: string) => void
    logout: () => void
}

const UserContext = createContext<UserContextType | null>(null)

export function getCookie(name: string) {
    const cookies = document.cookie;
    for(let cookie of cookies) {
        const [cookieName,cookieValue] = cookie.trim().split('=')
        if(cookieName ===name) {
            return decodeURIComponent(cookieValue)
        }
    }
    return null;
}

export function UserProvider({ children }: { children: ReactNode }) {
    const [userId, setUserId] = useState<string | null>(() => {
        const params = new URLSearchParams(window.location.search)
        const urlUserId = getCookie('username') ? getCookie('username') : params.get('userId')
        if (urlUserId) {
            localStorage.setItem(STORAGE_KEY, urlUserId)
            return urlUserId
        }
        return localStorage.getItem(STORAGE_KEY)
    })
    const [role, setRole] = useState<UserRole | null>(null)

    const fetchRole = useCallback(async (uid: string) => {
        try {
            const res = await fetch(`${GATEWAY_URL}/me`, {
                headers: {
                    'x-secret-key': GATEWAY_SECRET_KEY,
                    'x-user-id': uid,
                },
                signal: AbortSignal.timeout(5000),
            })
            if (res.ok) {
                const data = await res.json()
                setRole(data.role ?? 'user')
            } else {
                setRole(uid === 'sys' ? 'admin' : 'user')
            }
        } catch {
            setRole(uid === 'sys' ? 'admin' : 'user')
        }
    }, [])

    useEffect(() => {
        if (userId) {
            fetchRole(userId)
        } else {
            setRole(null)
        }
    }, [userId, fetchRole])

    const login = useCallback((username: string) => {
        const trimmed = username.trim()
        if (!trimmed) return
        localStorage.setItem(STORAGE_KEY, trimmed)
        setUserId(trimmed)
    }, [])

    const logout = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY)
        setUserId(null)
        setRole(null)
    }, [])

    return (
        <UserContext.Provider value={{ userId, role, login, logout }}>
            {children}
        </UserContext.Provider>
    )
}

export function useUser(): UserContextType {
    const context = useContext(UserContext)
    if (!context) {
        throw new Error('useUser must be used within a UserProvider')
    }
    return context
}

/** Redirect to /login if not authenticated */
export function ProtectedRoute({ children }: { children: ReactNode }) {
    const { userId } = useUser()

    if (!userId) {
        return <Navigate to="/login" replace />
    }

    return <>{children}</>
}

/** Redirect to / if not admin */
export function AdminRoute({ children }: { children: ReactNode }) {
    const { userId, role } = useUser()

    if (!userId) {
        return <Navigate to="/login" replace />
    }

    if (role !== null && !isAdminUser(userId, role)) {
        return <Navigate to="/" replace />
    }

    return <>{children}</>
}

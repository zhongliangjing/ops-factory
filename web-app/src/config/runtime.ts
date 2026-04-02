import type { UserRole } from '../contexts/UserContext'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
// const GATEWAY_PATH_PREFIX = '/gateway'
const KNOWLEDGE_PATH_PREFIX = '/knowledge'

function isLoopbackHost(host: string): boolean {
    return LOOPBACK_HOSTS.has(host)
}

// function resolveGatewayUrl(raw: string | undefined): string {
//     const pageHost = window.location.hostname || '127.0.0.1'
//     const pageProtocol = window.location.protocol || 'http:'
//     const fallbackOrigin = `${pageProtocol}//${pageHost}:3000`

//     if (!raw) return `${fallbackOrigin}${GATEWAY_PATH_PREFIX}`

//     try {
//         const url = new URL(raw)
//         if (isLoopbackHost(url.hostname) && !isLoopbackHost(pageHost)) {
//             url.hostname = pageHost
//         }
//         return `${url.origin}${GATEWAY_PATH_PREFIX}`
//     } catch {
//         return `${fallbackOrigin}${GATEWAY_PATH_PREFIX}`
//     }
// }

function resolveKnowledgeServiceUrl(raw: string | undefined): string {
    const pageHost = window.location.hostname || '127.0.0.1'
    const pageProtocol = window.location.protocol || 'http:'
    const fallbackOrigin = `${pageProtocol}//${pageHost}:8092`

    if (!raw) return `${fallbackOrigin}${KNOWLEDGE_PATH_PREFIX}`

    try {
        const url = new URL(raw)
        if (isLoopbackHost(url.hostname) && !isLoopbackHost(pageHost)) {
            url.hostname = pageHost
        }
        return `${url.origin}${KNOWLEDGE_PATH_PREFIX}`
    } catch {
        return `${fallbackOrigin}${KNOWLEDGE_PATH_PREFIX}`
    }
}

const DEFAULT_SECRET_KEY = 'test'
// export const GATEWAY_URL = resolveGatewayUrl(import.meta.env.VITE_GATEWAY_URL)
export const GATEWAY_URL = `${window.location.origin}/gateway`
export const GATEWAY_SECRET_KEY = DEFAULT_SECRET_KEY
export const KNOWLEDGE_SERVICE_URL = resolveKnowledgeServiceUrl(undefined)

export function isAdminUser(userId: string | null, role: UserRole | null): boolean {
    if (role === 'admin') return true
    return userId === 'admin'
}

/** Build gateway request headers with secret key and optional user ID. */
export function gatewayHeaders(userId?: string | null): Record<string, string> {
    const h: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-secret-key': GATEWAY_SECRET_KEY,
    }
    if (userId) h['x-user-id'] = userId
    return h
}

/** Convert a display name to a kebab-case ID. */
export function slugify(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

/** Check if a session is a scheduled session. */
export function isScheduledSession(session: { session_type?: string; schedule_id?: string | null }): boolean {
    return session.session_type === 'scheduled' || !!session.schedule_id
}

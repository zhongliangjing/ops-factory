import type { UserRole } from '../contexts/UserContext'
import { parse } from 'yaml'

interface RuntimeConfigYaml {
    gatewayUrl?: string
    gatewaySecretKey?: string
    knowledgeServiceUrl?: string
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function isLoopbackHost(host: string): boolean {
    return LOOPBACK_HOSTS.has(host)
}

function resolveGatewayUrl(raw: string | undefined): string {
    const pageHost = window.location.hostname || '127.0.0.1'
    const pageProtocol = window.location.protocol || 'http:'
    const fallback = `${pageProtocol}//${pageHost}:3000`

    if (!raw) return fallback

    try {
        const url = new URL(raw)
        if (isLoopbackHost(url.hostname) && !isLoopbackHost(pageHost)) {
            url.hostname = pageHost
        }
        // Add /ops-gateway path prefix after port
        return `${url.origin}/ops-gateway`
    } catch {
        return fallback
    }
}

function resolveKnowledgeServiceUrl(raw: string | undefined): string {
    const pageHost = window.location.hostname || '127.0.0.1'
    const pageProtocol = window.location.protocol || 'http:'
    const fallback = `${pageProtocol}//${pageHost}:8092`

    if (!raw) return fallback

    try {
        const url = new URL(raw)
        if (isLoopbackHost(url.hostname) && !isLoopbackHost(pageHost)) {
            url.hostname = pageHost
        }
        return url.origin
    } catch {
        return fallback
    }
}

const DEFAULT_SECRET_KEY = 'test'

export let GATEWAY_URL = resolveGatewayUrl(undefined)
export let GATEWAY_SECRET_KEY = DEFAULT_SECRET_KEY
export let KNOWLEDGE_SERVICE_URL = resolveKnowledgeServiceUrl(undefined)

function setRuntimeConfig(config: RuntimeConfigYaml): void {
    GATEWAY_URL = resolveGatewayUrl(config.gatewayUrl)
    GATEWAY_SECRET_KEY = config.gatewaySecretKey || DEFAULT_SECRET_KEY
    KNOWLEDGE_SERVICE_URL = resolveKnowledgeServiceUrl(config.knowledgeServiceUrl)
}

export async function initializeRuntimeConfig(): Promise<void> {
    const response = await fetch('/config.yaml', { cache: 'no-store' })
    if (!response.ok) {
        throw new Error(`Failed to load /config.yaml (${response.status})`)
    }

    const config = (parse(await response.text()) as RuntimeConfigYaml | null) || {}

    if (!config.gatewayUrl) {
        throw new Error('Missing required configuration: gatewayUrl')
    }
    if (!config.gatewaySecretKey) {
        throw new Error('Missing required configuration: gatewaySecretKey')
    }

    setRuntimeConfig(config)
}

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

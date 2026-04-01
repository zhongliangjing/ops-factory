export interface Host {
    id: string
    name: string
    ip: string
    port: number
    username: string
    authType: 'password' | 'key'
    credential?: string
    tags: string[]
    description: string
    createdAt: string
    updatedAt: string
}

export interface HostCreateRequest {
    name: string
    ip: string
    port: number
    username: string
    authType: 'password' | 'key'
    credential: string
    tags: string[]
    description?: string
}

export interface HostTestResult {
    success: boolean
    message: string
    latency?: string
}

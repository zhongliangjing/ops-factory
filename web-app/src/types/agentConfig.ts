// Agent configuration types

export interface AgentConfig {
    id: string
    name: string
    agentsMd: string  // AGENTS.md content
    workingDir: string
    provider?: string
    model?: string
}

export interface UpdateAgentConfigRequest {
    agentsMd?: string
}

export interface UpdateAgentConfigResponse {
    success: boolean
    error?: string
}

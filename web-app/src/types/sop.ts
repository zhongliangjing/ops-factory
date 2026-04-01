export interface SopNodeVariable {
    name: string
    description: string
    defaultValue: string
    required: boolean
}

export interface SopNode {
    id: string
    name: string
    type: 'start' | 'analysis'
    hostTags: string[]
    command: string
    commandVariables: Record<string, SopCommandVariable>
    variables?: SopNodeVariable[]
    outputFormat: string
    analysisInstruction: string
    transitions: SopTransition[]
}

export interface SopCommandVariable {
    description: string
    defaultValue: string
    required: boolean
}

export interface SopTransition {
    condition: string
    description: string
    nextNodes: string[]
    nextNodeId?: string
}

export interface Sop {
    id: string
    name: string
    description: string
    version: string
    triggerCondition: string
    nodes: SopNode[]
}

export interface SopCreateRequest {
    name: string
    description?: string
    version?: string
    triggerCondition?: string
    nodes?: SopNode[]
}

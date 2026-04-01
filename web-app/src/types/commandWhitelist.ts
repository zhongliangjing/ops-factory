export interface WhitelistCommand {
    pattern: string
    description: string
    enabled: boolean
}

export interface CommandWhitelistData {
    commands: WhitelistCommand[]
}

/**
 * goosed-sdk types
 */

export interface MessageMetadata {
    userVisible: boolean;
    agentVisible: boolean;
}

export interface TextContent {
    type: 'text';
    text: string;
}

export interface MessageContent {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    id?: string;
    toolCall?: Record<string, unknown>;
    toolResult?: Record<string, unknown>;
}

export interface Message {
    id?: string;
    role: 'user' | 'assistant';
    created: number;
    content: MessageContent[];
    metadata: MessageMetadata;
}

export interface TokenState {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    accumulatedInputTokens: number;
    accumulatedOutputTokens: number;
    accumulatedTotalTokens: number;
}

export interface ExtensionConfig {
    type: string;
    name: string;
    description?: string;
    bundled?: boolean;
}

export interface Session {
    id: string;
    name: string;
    working_dir: string;
    session_type: string;
    schedule_id?: string | null;
    created_at: string;
    updated_at: string;
    user_set_name?: boolean;
    message_count?: number;
    total_tokens?: number | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    provider_name?: string | null;
    conversation?: Record<string, unknown>[] | null;
}

export interface ToolInfo {
    name: string;
    description: string;
    parameters: string[];
    permission?: string | null;
}

export interface CallToolResponse {
    content: Record<string, unknown>[];
    is_error: boolean;
}

export interface ExtensionResult {
    name: string;
    success: boolean;
}

export interface SystemInfo {
    app_version: string;
    os: string;
    os_version: string;
    architecture: string;
    provider: string;
    model: string;
    enabled_extensions: string[];
}

export type SSEEventType = 'Ping' | 'Message' | 'Finish' | 'Error' | 'ModelChange' | 'Notification' | 'UpdateConversation';

export interface SSEEvent {
    type: SSEEventType;
    message?: Record<string, unknown>;
    token_state?: TokenState;
    reason?: string;
    error?: string;
    model?: string;
    mode?: string;
    request_id?: string;
    conversation?: Record<string, unknown>[];
}

export interface ImageData {
    data: string;       // base64 encoded image data (no data URL prefix)
    mimeType: string;   // e.g. 'image/jpeg', 'image/png'
}

export interface UploadResult {
    path: string;
    name: string;
    size: number;
    type: string;
}

export interface GoosedClientOptions {
    baseUrl?: string;
    secretKey?: string;
    timeout?: number;
    userId?: string;
}

export interface SetProviderRequest {
    provider: string;
    model: string;
}

export interface Recipe {
    title: string;
    description: string;
    instructions?: string;
    prompt?: string;
    [key: string]: unknown;
}

export interface RecipeManifest {
    id: string;
    recipe: Recipe;
    file_path: string;
    last_modified: string;
    schedule_cron?: string | null;
    slash_command?: string | null;
}

export interface ScheduledJob {
    id: string;
    source: string;
    cron: string;
    last_run?: string | null;
    currently_running?: boolean;
    paused?: boolean;
    current_session_id?: string | null;
    process_start_time?: string | null;
}

export interface ListSchedulesResponse {
    jobs: ScheduledJob[];
}

export interface RunNowResponse {
    session_id: string;
}

export interface ScheduleSessionInfo {
    id: string;
    name: string;
    createdAt: string;
    workingDir: string;
    scheduleId?: string | null;
    messageCount: number;
    totalTokens?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    accumulatedTotalTokens?: number | null;
    accumulatedInputTokens?: number | null;
    accumulatedOutputTokens?: number | null;
}

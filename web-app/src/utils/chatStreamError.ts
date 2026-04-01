const CONNECTION_LOST_MESSAGE = 'Agent connection lost, please retry'

const STREAM_CONNECTION_PATTERNS = [
    /stream decode error/i,
    /error decoding response body/i,
    /body stream.*terminated/i,
    /networkerror.*stream/i,
    /failed to fetch/i,
    /networkerror when attempting to fetch resource/i,
    /net::err_/i,
    /terminated/i,
]

export function normalizeChatStreamError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? '')
    const trimmed = message.trim()

    if (!trimmed) {
        return 'Failed to send message'
    }

    if (/agent stopped responding/i.test(trimmed) || /idle timeout/i.test(trimmed)) {
        return 'Agent stopped responding, please try again'
    }

    if (/agent connection (failed|lost)/i.test(trimmed)) {
        return CONNECTION_LOST_MESSAGE
    }

    if (STREAM_CONNECTION_PATTERNS.some(pattern => pattern.test(trimmed))) {
        return CONNECTION_LOST_MESSAGE
    }

    return trimmed
}

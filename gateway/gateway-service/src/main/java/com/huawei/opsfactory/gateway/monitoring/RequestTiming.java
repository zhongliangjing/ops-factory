package com.huawei.opsfactory.gateway.monitoring;

/**
 * Immutable timing record captured per SSE /reply request.
 */
public class RequestTiming {

    private final long startTime;
    private final long ttftMs;
    private final long totalMs;
    private final long totalBytes;
    private final boolean error;
    private final String agentId;
    private final String userId;

    public RequestTiming(long startTime, long ttftMs, long totalMs,
                         long totalBytes, boolean error,
                         String agentId, String userId) {
        this.startTime = startTime;
        this.ttftMs = ttftMs;
        this.totalMs = totalMs;
        this.totalBytes = totalBytes;
        this.error = error;
        this.agentId = agentId;
        this.userId = userId;
    }

    public long getStartTime() { return startTime; }
    public long getTtftMs() { return ttftMs; }
    public long getTotalMs() { return totalMs; }
    public long getTotalBytes() { return totalBytes; }
    public boolean isError() { return error; }
    public String getAgentId() { return agentId; }
    public String getUserId() { return userId; }
}

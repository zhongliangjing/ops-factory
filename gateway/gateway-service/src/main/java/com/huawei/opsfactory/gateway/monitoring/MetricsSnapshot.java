package com.huawei.opsfactory.gateway.monitoring;

/**
 * One 30-second metrics collection snapshot.
 */
public class MetricsSnapshot {

    private long timestamp;
    private int activeInstances;
    private long totalTokens;
    private long totalSessions;
    private int requestCount;
    private double avgLatencyMs;
    private double avgTtftMs;
    private double p95LatencyMs;
    private double p95TtftMs;
    private long totalBytes;
    private int errorCount;
    private double tokensPerSec;

    public MetricsSnapshot() {}

    public long getTimestamp() { return timestamp; }
    public void setTimestamp(long timestamp) { this.timestamp = timestamp; }

    public int getActiveInstances() { return activeInstances; }
    public void setActiveInstances(int activeInstances) { this.activeInstances = activeInstances; }

    public long getTotalTokens() { return totalTokens; }
    public void setTotalTokens(long totalTokens) { this.totalTokens = totalTokens; }

    public long getTotalSessions() { return totalSessions; }
    public void setTotalSessions(long totalSessions) { this.totalSessions = totalSessions; }

    public int getRequestCount() { return requestCount; }
    public void setRequestCount(int requestCount) { this.requestCount = requestCount; }

    public double getAvgLatencyMs() { return avgLatencyMs; }
    public void setAvgLatencyMs(double avgLatencyMs) { this.avgLatencyMs = avgLatencyMs; }

    public double getAvgTtftMs() { return avgTtftMs; }
    public void setAvgTtftMs(double avgTtftMs) { this.avgTtftMs = avgTtftMs; }

    public double getP95LatencyMs() { return p95LatencyMs; }
    public void setP95LatencyMs(double p95LatencyMs) { this.p95LatencyMs = p95LatencyMs; }

    public double getP95TtftMs() { return p95TtftMs; }
    public void setP95TtftMs(double p95TtftMs) { this.p95TtftMs = p95TtftMs; }

    public long getTotalBytes() { return totalBytes; }
    public void setTotalBytes(long totalBytes) { this.totalBytes = totalBytes; }

    public int getErrorCount() { return errorCount; }
    public void setErrorCount(int errorCount) { this.errorCount = errorCount; }

    public double getTokensPerSec() { return tokensPerSec; }
    public void setTokensPerSec(double tokensPerSec) { this.tokensPerSec = tokensPerSec; }
}

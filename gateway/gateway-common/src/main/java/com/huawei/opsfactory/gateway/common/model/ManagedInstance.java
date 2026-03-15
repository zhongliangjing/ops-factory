package com.huawei.opsfactory.gateway.common.model;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public class ManagedInstance {

    public enum Status {
        STARTING, RUNNING, STOPPED, ERROR
    }

    private final String agentId;
    private final String userId;
    private final int port;
    private final long pid;
    private volatile Status status;
    private volatile long lastActivity;
    private volatile int restartCount = 0;
    private volatile long lastRestartTime = 0;
    private transient Process process;
    /** Sessions that have been resumed (provider+extensions loaded) on this instance. */
    private final Set<String> resumedSessions = ConcurrentHashMap.newKeySet();

    public ManagedInstance(String agentId, String userId, int port, long pid, Process process) {
        this.agentId = agentId;
        this.userId = userId;
        this.port = port;
        this.pid = pid;
        this.process = process;
        this.status = Status.STARTING;
        this.lastActivity = System.currentTimeMillis();
    }

    public String getAgentId() {
        return agentId;
    }

    public String getUserId() {
        return userId;
    }

    public int getPort() {
        return port;
    }

    public long getPid() {
        return pid;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    public long getLastActivity() {
        return lastActivity;
    }

    public void touch() {
        this.lastActivity = System.currentTimeMillis();
    }

    public Process getProcess() {
        return process;
    }

    /** Mark a session as resumed (provider+extensions loaded) on this instance. */
    public void markSessionResumed(String sessionId) {
        resumedSessions.add(sessionId);
    }

    /** Check whether a session has been resumed on this instance. */
    public boolean isSessionResumed(String sessionId) {
        return sessionId != null && resumedSessions.contains(sessionId);
    }

    public int getRestartCount() {
        return restartCount;
    }

    public void setRestartCount(int restartCount) {
        this.restartCount = restartCount;
    }

    public void resetRestartCount() {
        this.restartCount = 0;
    }

    public long getLastRestartTime() {
        return lastRestartTime;
    }

    public void setLastRestartTime(long lastRestartTime) {
        this.lastRestartTime = lastRestartTime;
    }

    public String getKey() {
        return buildKey(agentId, userId);
    }

    public static String buildKey(String agentId, String userId) {
        return agentId + ":" + userId;
    }
}

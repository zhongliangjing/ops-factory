package com.huawei.opsfactory.gateway.common.model;

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
    private transient Process process;

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

    public String getKey() {
        return buildKey(agentId, userId);
    }

    public static String buildKey(String agentId, String userId) {
        return agentId + ":" + userId;
    }
}

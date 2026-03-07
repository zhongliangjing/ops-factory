package com.huawei.opsfactory.gateway.hook;

import java.util.HashMap;
import java.util.Map;

public class HookContext {

    private String body;
    private final String agentId;
    private final String userId;
    private final Map<String, Object> state = new HashMap<>();

    public HookContext(String body, String agentId, String userId) {
        this.body = body;
        this.agentId = agentId;
        this.userId = userId;
    }

    public String getBody() {
        return body;
    }

    public void setBody(String body) {
        this.body = body;
    }

    public String getAgentId() {
        return agentId;
    }

    public String getUserId() {
        return userId;
    }

    public Map<String, Object> getState() {
        return state;
    }
}

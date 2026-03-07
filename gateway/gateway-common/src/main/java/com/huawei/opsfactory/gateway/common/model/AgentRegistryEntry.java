package com.huawei.opsfactory.gateway.common.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record AgentRegistryEntry(String id, String name, boolean sysOnly) {
}

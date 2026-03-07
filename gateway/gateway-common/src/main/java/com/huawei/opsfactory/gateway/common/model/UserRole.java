package com.huawei.opsfactory.gateway.common.model;

public enum UserRole {
    ADMIN,
    USER;

    public static UserRole fromUserId(String userId) {
        return "sys".equals(userId) ? ADMIN : USER;
    }

    public boolean isAdmin() {
        return this == ADMIN;
    }
}

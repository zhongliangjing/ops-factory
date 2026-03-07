package com.huawei.opsfactory.gateway.common.constants;

public final class GatewayConstants {

    private GatewayConstants() {
    }

    // Headers
    public static final String HEADER_SECRET_KEY = "x-secret-key";
    public static final String HEADER_USER_ID = "x-user-id";
    public static final String QUERY_KEY = "key";

    // Default users
    public static final String SYS_USER = "sys";
    public static final String DEFAULT_USER = "__default__";

    // Process
    public static final int HEALTH_CHECK_MAX_ATTEMPTS = 30;
    public static final long HEALTH_CHECK_INTERVAL_MS = 500L;
    public static final long STOP_GRACE_PERIOD_MS = 1000L;

    // Idle
    public static final int DEFAULT_IDLE_TIMEOUT_MINUTES = 15;
    public static final long DEFAULT_IDLE_CHECK_INTERVAL_MS = 60000L;

    // Upload
    public static final int DEFAULT_MAX_FILE_SIZE_MB = 50;
}

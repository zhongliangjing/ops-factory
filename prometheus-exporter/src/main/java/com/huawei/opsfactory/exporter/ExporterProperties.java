package com.huawei.opsfactory.exporter;

public class ExporterProperties {
    private int port = 9091;
    private String gatewayUrl;
    private String gatewaySecretKey;
    private int collectTimeoutMs = 5000;

    public int getPort() {
        return port;
    }

    public void setPort(int port) {
        this.port = port;
    }

    public String getGatewayUrl() {
        return gatewayUrl;
    }

    public void setGatewayUrl(String gatewayUrl) {
        this.gatewayUrl = gatewayUrl;
    }

    public String getGatewaySecretKey() {
        return gatewaySecretKey;
    }

    public void setGatewaySecretKey(String gatewaySecretKey) {
        this.gatewaySecretKey = gatewaySecretKey;
    }

    public int getCollectTimeoutMs() {
        return collectTimeoutMs;
    }

    public void setCollectTimeoutMs(int collectTimeoutMs) {
        this.collectTimeoutMs = collectTimeoutMs;
    }
}

package com.huawei.opsfactory.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "gateway")
public class GatewayProperties {

    private String secretKey = "test";
    private String corsOrigin = "http://127.0.0.1:5173";
    private String goosedBin = "goosed";

    private Paths paths = new Paths();
    private Idle idle = new Idle();
    private Upload upload = new Upload();
    private Vision vision = new Vision();
    private Langfuse langfuse = new Langfuse();
    private OfficePreview officePreview = new OfficePreview();

    // ---- Getters / Setters ----

    public String getSecretKey() {
        return secretKey;
    }

    public void setSecretKey(String secretKey) {
        this.secretKey = secretKey;
    }

    public String getCorsOrigin() {
        return corsOrigin;
    }

    public void setCorsOrigin(String corsOrigin) {
        this.corsOrigin = corsOrigin;
    }

    public String getGoosedBin() {
        return goosedBin;
    }

    public void setGoosedBin(String goosedBin) {
        this.goosedBin = goosedBin;
    }

    public Paths getPaths() {
        return paths;
    }

    public void setPaths(Paths paths) {
        this.paths = paths;
    }

    public Idle getIdle() {
        return idle;
    }

    public void setIdle(Idle idle) {
        this.idle = idle;
    }

    public Upload getUpload() {
        return upload;
    }

    public void setUpload(Upload upload) {
        this.upload = upload;
    }

    public Vision getVision() {
        return vision;
    }

    public void setVision(Vision vision) {
        this.vision = vision;
    }

    public Langfuse getLangfuse() {
        return langfuse;
    }

    public void setLangfuse(Langfuse langfuse) {
        this.langfuse = langfuse;
    }

    public OfficePreview getOfficePreview() {
        return officePreview;
    }

    public void setOfficePreview(OfficePreview officePreview) {
        this.officePreview = officePreview;
    }

    // ---- Nested config classes ----

    public static class Paths {
        private String projectRoot = "..";
        private String agentsDir = "agents";
        private String usersDir = "users";

        public String getProjectRoot() { return projectRoot; }
        public void setProjectRoot(String projectRoot) { this.projectRoot = projectRoot; }
        public String getAgentsDir() { return agentsDir; }
        public void setAgentsDir(String agentsDir) { this.agentsDir = agentsDir; }
        public String getUsersDir() { return usersDir; }
        public void setUsersDir(String usersDir) { this.usersDir = usersDir; }
    }

    public static class Idle {
        private int timeoutMinutes = 15;
        private long checkIntervalMs = 60000L;

        public int getTimeoutMinutes() { return timeoutMinutes; }
        public void setTimeoutMinutes(int timeoutMinutes) { this.timeoutMinutes = timeoutMinutes; }
        public long getCheckIntervalMs() { return checkIntervalMs; }
        public void setCheckIntervalMs(long checkIntervalMs) { this.checkIntervalMs = checkIntervalMs; }
    }

    public static class Upload {
        private int maxFileSizeMb = 50;
        private int maxImageSizeMb = 20;

        public int getMaxFileSizeMb() { return maxFileSizeMb; }
        public void setMaxFileSizeMb(int maxFileSizeMb) { this.maxFileSizeMb = maxFileSizeMb; }
        public int getMaxImageSizeMb() { return maxImageSizeMb; }
        public void setMaxImageSizeMb(int maxImageSizeMb) { this.maxImageSizeMb = maxImageSizeMb; }
    }

    public static class Vision {
        private String mode = "off";
        private String provider = "";
        private String model = "";
        private String apiKey = "";
        private String baseUrl = "";
        private int maxTokens = 1024;

        public String getMode() { return mode; }
        public void setMode(String mode) { this.mode = mode; }
        public String getProvider() { return provider; }
        public void setProvider(String provider) { this.provider = provider; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
        public int getMaxTokens() { return maxTokens; }
        public void setMaxTokens(int maxTokens) { this.maxTokens = maxTokens; }
    }

    public static class Langfuse {
        private String host = "";
        private String publicKey = "";
        private String secretKey = "";

        public String getHost() { return host; }
        public void setHost(String host) { this.host = host; }
        public String getPublicKey() { return publicKey; }
        public void setPublicKey(String publicKey) { this.publicKey = publicKey; }
        public String getSecretKey() { return secretKey; }
        public void setSecretKey(String secretKey) { this.secretKey = secretKey; }
    }

    public static class OfficePreview {
        private boolean enabled = false;
        private String onlyofficeUrl = "";
        private String fileBaseUrl = "";

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getOnlyofficeUrl() { return onlyofficeUrl; }
        public void setOnlyofficeUrl(String onlyofficeUrl) { this.onlyofficeUrl = onlyofficeUrl; }
        public String getFileBaseUrl() { return fileBaseUrl; }
        public void setFileBaseUrl(String fileBaseUrl) { this.fileBaseUrl = fileBaseUrl; }
    }
}

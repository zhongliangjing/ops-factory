package com.huawei.opsfactory.gateway.config;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;

@Component
@ConfigurationProperties(prefix = "gateway")
public class GatewayProperties {

    private static final Logger log = LogManager.getLogger(GatewayProperties.class);

    private String secretKey = "test";
    private String corsOrigin = "http://127.0.0.1:5173";
    private String goosedBin = "goosed";
    private boolean gooseTls = true;

    private Paths paths = new Paths();
    private Idle idle = new Idle();
    private Upload upload = new Upload();
    private Limits limits = new Limits();
    private Prewarm prewarm = new Prewarm();
    private Sse sse = new Sse();
    private Langfuse langfuse = new Langfuse();
    private OfficePreview officePreview = new OfficePreview();
    private String credentialEncryptionKey = "changeit-changeit-changeit-32";
    private RemoteExecution remoteExecution = new RemoteExecution();

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

    public boolean isGooseTls() {
        return gooseTls;
    }

    public void setGooseTls(boolean gooseTls) {
        this.gooseTls = gooseTls;
    }

    public String gooseScheme() {
        return gooseTls ? "https" : "http";
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

    public Langfuse getLangfuse() {
        return langfuse;
    }

    public void setLangfuse(Langfuse langfuse) {
        this.langfuse = langfuse;
    }

    public Limits getLimits() {
        return limits;
    }

    public void setLimits(Limits limits) {
        this.limits = limits;
    }

    public Prewarm getPrewarm() {
        return prewarm;
    }

    public void setPrewarm(Prewarm prewarm) {
        this.prewarm = prewarm;
    }

    public Sse getSse() {
        return sse;
    }

    public void setSse(Sse sse) {
        this.sse = sse;
    }

    public OfficePreview getOfficePreview() {
        return officePreview;
    }

    public void setOfficePreview(OfficePreview officePreview) {
        this.officePreview = officePreview;
    }

    public String getCredentialEncryptionKey() {
        return credentialEncryptionKey;
    }

    public void setCredentialEncryptionKey(String credentialEncryptionKey) {
        this.credentialEncryptionKey = credentialEncryptionKey;
    }

    public RemoteExecution getRemoteExecution() {
        return remoteExecution;
    }

    public void setRemoteExecution(RemoteExecution remoteExecution) {
        this.remoteExecution = remoteExecution;
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
        private int maxRestartAttempts = 3;
        private long restartBaseDelayMs = 5000L;

        public int getTimeoutMinutes() { return timeoutMinutes; }
        public void setTimeoutMinutes(int timeoutMinutes) { this.timeoutMinutes = timeoutMinutes; }
        public long getCheckIntervalMs() { return checkIntervalMs; }
        public void setCheckIntervalMs(long checkIntervalMs) { this.checkIntervalMs = checkIntervalMs; }
        public int getMaxRestartAttempts() { return maxRestartAttempts; }
        public void setMaxRestartAttempts(int maxRestartAttempts) { this.maxRestartAttempts = maxRestartAttempts; }
        public long getRestartBaseDelayMs() { return restartBaseDelayMs; }
        public void setRestartBaseDelayMs(long restartBaseDelayMs) { this.restartBaseDelayMs = restartBaseDelayMs; }
    }

    public static class Upload {
        private int maxFileSizeMb = 50;
        private int maxImageSizeMb = 20;

        public int getMaxFileSizeMb() { return maxFileSizeMb; }
        public void setMaxFileSizeMb(int maxFileSizeMb) { this.maxFileSizeMb = maxFileSizeMb; }
        public int getMaxImageSizeMb() { return maxImageSizeMb; }
        public void setMaxImageSizeMb(int maxImageSizeMb) { this.maxImageSizeMb = maxImageSizeMb; }
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

    public static class Limits {
        private int maxInstancesPerUser = 5;
        private int maxInstancesGlobal = 50;

        public int getMaxInstancesPerUser() { return maxInstancesPerUser; }
        public void setMaxInstancesPerUser(int maxInstancesPerUser) { this.maxInstancesPerUser = maxInstancesPerUser; }
        public int getMaxInstancesGlobal() { return maxInstancesGlobal; }
        public void setMaxInstancesGlobal(int maxInstancesGlobal) { this.maxInstancesGlobal = maxInstancesGlobal; }
    }

    public static class Sse {
        private int firstByteTimeoutSec = 120;
        private int idleTimeoutSec = 300;
        private int maxDurationSec = 600;

        public int getFirstByteTimeoutSec() { return firstByteTimeoutSec; }
        public void setFirstByteTimeoutSec(int firstByteTimeoutSec) { this.firstByteTimeoutSec = firstByteTimeoutSec; }
        public int getIdleTimeoutSec() { return idleTimeoutSec; }
        public void setIdleTimeoutSec(int idleTimeoutSec) { this.idleTimeoutSec = idleTimeoutSec; }
        public int getMaxDurationSec() { return maxDurationSec; }
        public void setMaxDurationSec(int maxDurationSec) { this.maxDurationSec = maxDurationSec; }
    }

    public static class Prewarm {
        private boolean enabled = true;
        private String defaultAgentId = "universal-agent";

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getDefaultAgentId() { return defaultAgentId; }
        public void setDefaultAgentId(String defaultAgentId) { this.defaultAgentId = defaultAgentId; }
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

    public static class RemoteExecution {
        private int defaultTimeout = 30;
        private int maxTimeout = 120;

        public int getDefaultTimeout() { return defaultTimeout; }
        public void setDefaultTimeout(int defaultTimeout) { this.defaultTimeout = defaultTimeout; }
        public int getMaxTimeout() { return maxTimeout; }
        public void setMaxTimeout(int maxTimeout) { this.maxTimeout = maxTimeout; }
    }

    // ---- PostConstruct for logging configuration values ----

    @PostConstruct
    public void logConfiguration() {
        log.info("GatewayProperties loaded: gooseTls={}, gooseScheme={}, goosedBin={}",
                gooseTls, gooseScheme(), goosedBin);
    }
}

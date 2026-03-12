package com.huawei.opsfactory.gateway.process;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.gateway.common.constants.GatewayConstants;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.common.util.ProcessUtil;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import org.yaml.snakeyaml.Yaml;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import javax.net.ssl.SSLSocketFactory;
import java.security.cert.X509Certificate;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

@Component
public class InstanceManager {

    private static final Logger log = LogManager.getLogger(InstanceManager.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final GatewayProperties properties;
    private final PortAllocator portAllocator;
    private final RuntimePreparer runtimePreparer;
    private final AgentConfigService agentConfigService;
    private final SSLSocketFactory trustAllSslFactory;
    private final int serverPort;
    private final boolean serverSslEnabled;

    /** key = "agentId:userId" -> ManagedInstance */
    private final ConcurrentHashMap<String, ManagedInstance> instances = new ConcurrentHashMap<>();
    /** Per-key spawn locks to prevent concurrent spawns */
    private final ConcurrentHashMap<String, ReentrantLock> spawnLocks = new ConcurrentHashMap<>();

    public InstanceManager(GatewayProperties properties,
                           PortAllocator portAllocator,
                           RuntimePreparer runtimePreparer,
                           AgentConfigService agentConfigService,
                           @Value("${server.port:3000}") int serverPort,
                           @Value("${server.ssl.enabled:false}") boolean serverSslEnabled) {
        this.properties = properties;
        this.portAllocator = portAllocator;
        this.runtimePreparer = runtimePreparer;
        this.agentConfigService = agentConfigService;
        this.trustAllSslFactory = createTrustAllSslFactory();
        this.serverPort = serverPort;
        this.serverSslEnabled = serverSslEnabled;
    }

    private static SSLSocketFactory createTrustAllSslFactory() {
        try {
            TrustManager[] trustAll = { new X509TrustManager() {
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                public void checkClientTrusted(X509Certificate[] certs, String authType) {}
                public void checkServerTrusted(X509Certificate[] certs, String authType) {}
            }};
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, trustAll, new java.security.SecureRandom());
            return sc.getSocketFactory();
        } catch (Exception e) {
            throw new RuntimeException("Failed to create trust-all SSL factory", e);
        }
    }

    private String goosedBaseUrl(int port) {
        return properties.goosedScheme() + "://127.0.0.1:" + port;
    }

    /**
     * Auto-start sys instances for sysOnly agents on gateway startup,
     * then register default schedules from recipe files.
     */
    @PostConstruct
    public void autoStartSysOnlyAgents() {
        agentConfigService.getRegistry().stream()
                .filter(entry -> entry.sysOnly())
                .forEach(entry -> {
                    try {
                        log.info("Auto-starting sys instance for sysOnly agent: {}", entry.id());
                        ManagedInstance instance = doSpawn(entry.id(), GatewayConstants.SYS_USER);
                        registerDefaultSchedules(entry.id(), instance.getPort());
                    } catch (Exception e) {
                        log.error("Failed to auto-start sys instance for {}: {}", entry.id(), e.getMessage());
                    }
                });
    }

    /**
     * Scan agent's config/recipes/ directory and register each recipe as a paused schedule.
     */
    private void registerDefaultSchedules(String agentId, int port) {
        Path recipesDir = agentConfigService.getAgentsDir()
                .resolve(agentId).resolve("config").resolve("recipes");
        if (!Files.isDirectory(recipesDir)) return;

        try {
            // Fetch existing schedules
            Set<String> existingIds = new HashSet<>();
            try {
                String listJson = httpGet(port, "/schedule/list");
                // Simple parsing: extract "id" values from jobs array
                if (listJson != null && listJson.contains("\"jobs\"")) {
                    Map<String, Object> parsed = MAPPER.readValue(listJson,
                            new TypeReference<Map<String, Object>>() {});
                    Object jobs = parsed.get("jobs");
                    if (jobs instanceof List<?> jobList) {
                        for (Object job : jobList) {
                            if (job instanceof Map<?, ?> jobMap) {
                                Object id = jobMap.get("id");
                                if (id != null) existingIds.add(id.toString());
                            }
                        }
                    }
                }
            } catch (Exception e) {
                log.warn("Failed to list existing schedules for {}: {}", agentId, e.getMessage());
            }

            try (DirectoryStream<Path> stream = Files.newDirectoryStream(recipesDir, "*.{yaml,yml,json}")) {
                for (Path recipeFile : stream) {
                    String fileName = recipeFile.getFileName().toString();
                    String scheduleId = fileName.replaceAll("\\.(ya?ml|json)$", "");

                    if (existingIds.contains(scheduleId)) {
                        log.info("Schedule {} already exists for {}, skipping", scheduleId, agentId);
                        continue;
                    }

                    try {
                        String recipeContent = Files.readString(recipeFile, StandardCharsets.UTF_8);
                        // Parse recipe YAML/JSON
                        Object recipe;
                        if (fileName.endsWith(".json")) {
                            recipe = MAPPER.readValue(recipeContent, Object.class);
                        } else {
                            Yaml yaml = new Yaml();
                            recipe = yaml.load(recipeContent);
                        }

                        // Create schedule
                        Map<String, Object> body = new HashMap<>();
                        body.put("id", scheduleId);
                        body.put("recipe", recipe);
                        body.put("cron", "0 9 * * *");
                        String bodyJson = MAPPER.writeValueAsString(body);

                        boolean created = httpPost(port, "/schedule/create", bodyJson);
                        if (!created) {
                            log.warn("Failed to create schedule {} for {}", scheduleId, agentId);
                            continue;
                        }

                        // Pause immediately
                        httpPost(port, "/schedule/" + scheduleId + "/pause", "{}");
                        log.info("Registered schedule \"{}\" for {} (paused)", scheduleId, agentId);
                    } catch (Exception e) {
                        log.warn("Error registering schedule {} for {}: {}", scheduleId, agentId, e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Error scanning recipes for {}: {}", agentId, e.getMessage());
        }
    }

    private HttpURLConnection openConnection(URL url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        if (properties.isGoosedTls() && conn instanceof HttpsURLConnection) {
            HttpsURLConnection httpsConn = (HttpsURLConnection) conn;
            httpsConn.setSSLSocketFactory(trustAllSslFactory);
            httpsConn.setHostnameVerifier((hostname, session) -> true);
        }
        return conn;
    }

    /**
     * Quick health probe: HTTP GET /status with 3s timeout.
     * Returns false if the goosed instance is unresponsive (hung, TLS broken, etc.).
     */
    private boolean isHealthy(int port) {
        try {
            URL url = new URL(goosedBaseUrl(port) + "/status");
            HttpURLConnection conn = openConnection(url);
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setRequestMethod("GET");
            try {
                return conn.getResponseCode() == 200;
            } finally {
                conn.disconnect();
            }
        } catch (Exception e) {
            log.debug("Health check failed for port {}: {}", port, e.getMessage());
            return false;
        }
    }

    private String httpGet(int port, String path) throws IOException {
        URL url = new URL(goosedBaseUrl(port) + path);
        HttpURLConnection conn = openConnection(url);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        conn.setRequestMethod("GET");
        conn.setRequestProperty("x-secret-key", properties.getSecretKey());
        try {
            int code = conn.getResponseCode();
            if (code == 200) {
                return new String(conn.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            }
            return null;
        } finally {
            conn.disconnect();
        }
    }

    private boolean httpPost(int port, String path, String body) throws IOException {
        URL url = new URL(goosedBaseUrl(port) + path);
        HttpURLConnection conn = openConnection(url);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("x-secret-key", properties.getSecretKey());
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setDoOutput(true);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(body.getBytes(StandardCharsets.UTF_8));
        }
        try {
            return conn.getResponseCode() == 200;
        } finally {
            conn.disconnect();
        }
    }

    /**
     * Get a running instance or spawn a new one.
     * Returns a Mono that resolves to the ManagedInstance.
     */
    public Mono<ManagedInstance> getOrSpawn(String agentId, String userId) {
        String key = ManagedInstance.buildKey(agentId, userId);

        ManagedInstance existing = instances.get(key);
        if (existing != null && existing.getStatus() == ManagedInstance.Status.RUNNING) {
            if (!existing.getProcess().isAlive()) {
                log.warn("Instance {}:{} process died (port={}), removing stale entry",
                        agentId, userId, existing.getPort());
                existing.setStatus(ManagedInstance.Status.STOPPED);
                instances.remove(key);
            } else if (!isHealthy(existing.getPort())) {
                log.warn("Instance {}:{} unresponsive on port={}, killing and respawning",
                        agentId, userId, existing.getPort());
                stopInstance(existing);
            } else {
                existing.touch();
                return Mono.just(existing);
            }
        }

        return Mono.fromCallable(() -> doSpawn(agentId, userId))
                .subscribeOn(Schedulers.boundedElastic());
    }

    private ManagedInstance doSpawn(String agentId, String userId) throws Exception {
        String key = ManagedInstance.buildKey(agentId, userId);
        ReentrantLock lock = spawnLocks.computeIfAbsent(key, k -> new ReentrantLock());
        lock.lock();
        try {
            // Double-check after acquiring lock
            ManagedInstance existing = instances.get(key);
            if (existing != null && existing.getStatus() == ManagedInstance.Status.RUNNING) {
                existing.touch();
                return existing;
            }

            // Check instance limits
            int maxPerUser = properties.getLimits().getMaxInstancesPerUser();
            int maxGlobal = properties.getLimits().getMaxInstancesGlobal();
            long userCount = instances.values().stream()
                    .filter(i -> i.getUserId().equals(userId) && i.getStatus() == ManagedInstance.Status.RUNNING)
                    .count();
            if (userCount >= maxPerUser) {
                throw new IllegalStateException("Per-user instance limit reached (" + maxPerUser + ")");
            }
            if (instances.size() >= maxGlobal) {
                throw new IllegalStateException("Global instance limit reached (" + maxGlobal + ")");
            }

            Path runtimeRoot = runtimePreparer.prepare(agentId, userId);
            resetStuckRunningSchedules(runtimeRoot);
            int port = portAllocator.allocate();

            Map<String, String> env = buildEnvironment(agentId, userId, port, runtimeRoot);

            ProcessBuilder pb = new ProcessBuilder(properties.getGoosedBin(), "agent");
            pb.directory(new File(runtimeRoot.toString()));
            pb.environment().putAll(env);
            pb.redirectErrorStream(true);

            log.info("Spawning goosed for {}:{} on port {}", agentId, userId, port);
            Process process = pb.start();
            long pid = ProcessUtil.getPid(process);

            ManagedInstance instance = new ManagedInstance(agentId, userId, port, pid, process);
            instances.put(key, instance);

            waitForReady(port, process);
            instance.setStatus(ManagedInstance.Status.RUNNING);
            log.info("Instance {}:{} ready on port {} (pid={})", agentId, userId, port, pid);

            return instance;
        } catch (Exception e) {
            log.error("Failed to spawn {}:{}", agentId, userId, e);
            throw e;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Reset stuck currently_running flags in schedule.json before goosed starts.
     * goosed persists currently_running=true but doesn't reset it on restart,
     * so we fix it here before the process loads the file.
     */
    private void resetStuckRunningSchedules(Path runtimeRoot) {
        Path scheduleFile = runtimeRoot.resolve("data").resolve("schedule.json");
        if (!Files.exists(scheduleFile)) return;
        try {
            String content = Files.readString(scheduleFile, StandardCharsets.UTF_8);
            if (!content.contains("\"currently_running\":true") && !content.contains("\"currently_running\": true")) {
                return;
            }
            List<Map<String, Object>> jobs = MAPPER.readValue(content,
                    new TypeReference<List<Map<String, Object>>>() {});
            boolean modified = false;
            for (Map<String, Object> job : jobs) {
                if (Boolean.TRUE.equals(job.get("currently_running"))) {
                    job.put("currently_running", false);
                    job.put("current_session_id", null);
                    job.put("process_start_time", null);
                    modified = true;
                }
            }
            if (modified) {
                Files.writeString(scheduleFile, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(jobs),
                        StandardCharsets.UTF_8);
                log.info("Reset stuck currently_running flags in {}", scheduleFile);
            }
        } catch (Exception e) {
            log.warn("Failed to reset schedule state in {}: {}", scheduleFile, e.getMessage());
        }
    }

    private Map<String, String> buildEnvironment(String agentId, String userId, int port, Path runtimeRoot) {
        Map<String, String> env = new HashMap<>();

        // Load agent config.yaml and secrets.yaml as env vars
        Map<String, Object> agentConfig = agentConfigService.loadAgentConfigYaml(agentId);
        Map<String, Object> agentSecrets = agentConfigService.loadAgentSecretsYaml(agentId);
        for (var entry : agentConfig.entrySet()) {
            if (entry.getValue() instanceof String || entry.getValue() instanceof Number
                    || entry.getValue() instanceof Boolean) {
                env.put(entry.getKey(), entry.getValue().toString());
            }
        }
        for (var entry : agentSecrets.entrySet()) {
            if (entry.getValue() instanceof String || entry.getValue() instanceof Number
                    || entry.getValue() instanceof Boolean) {
                env.put(entry.getKey(), entry.getValue().toString());
            }
        }

        // Core goosed env
        env.put("GOOSE_PORT", String.valueOf(port));
        env.put("GOOSE_HOST", "127.0.0.1");
        env.put("GOOSE_SERVER__SECRET_KEY", properties.getSecretKey());
        env.put("GOOSE_PATH_ROOT", runtimeRoot.toString());
        env.put("GOOSE_DISABLE_KEYRING", "1");
        env.put("GOOSE_TLS", String.valueOf(properties.isGoosedTls()));

        // Diagnostic: verbose logging for agent internals to trace hang points
        env.put("RUST_LOG", "goose::agents=trace,goose::providers=debug,goosed::routes=debug,goose::session=debug,rmcp=debug,goose::agents::extension_manager=trace,goose::agents::mcp_client=trace");

        // Gateway self-URL for MCP extensions that call back to the gateway
        String gatewayScheme = serverSslEnabled ? "https" : "http";
        env.put("GATEWAY_URL", gatewayScheme + "://127.0.0.1:" + serverPort);
        if (serverSslEnabled) {
            env.put("NODE_TLS_REJECT_UNAUTHORIZED", "0");
        }

        return env;
    }

    private void waitForReady(int port, Process process) throws Exception {
        URL url = new URL(goosedBaseUrl(port) + "/status");
        long interval = GatewayConstants.HEALTH_CHECK_INITIAL_INTERVAL_MS;
        for (int i = 0; i < GatewayConstants.HEALTH_CHECK_MAX_ATTEMPTS; i++) {
            if (!ProcessUtil.isAlive(process)) {
                throw processExitedException(process, port);
            }
            try {
                HttpURLConnection conn = openConnection(url);
                conn.setConnectTimeout(500);
                conn.setReadTimeout(500);
                conn.setRequestMethod("GET");
                try {
                    int code = conn.getResponseCode();
                    if (code == 200) {
                        log.info("goosed ready on port {} after {} attempts", port, i + 1);
                        return;
                    }
                } finally {
                    conn.disconnect();
                }
            } catch (IOException ignored) {
                // Not ready yet
            }
            Thread.sleep(interval);
            interval = Math.min(interval * 2, GatewayConstants.HEALTH_CHECK_MAX_INTERVAL_MS);
        }
        if (!ProcessUtil.isAlive(process)) {
            throw processExitedException(process, port);
        }
        throw new RuntimeException("goosed failed to start on port " + port
                + " (process alive but not responding after "
                + GatewayConstants.HEALTH_CHECK_MAX_ATTEMPTS + " attempts)");
    }

    private RuntimeException processExitedException(Process process, int port) {
        int exitCode = process.exitValue();
        String output = ProcessUtil.readOutput(process, 4096);
        return new RuntimeException("goosed process exited with code " + exitCode
                + " on port " + port + ". Output: " + output);
    }

    public ManagedInstance getInstance(String agentId, String userId) {
        return instances.get(ManagedInstance.buildKey(agentId, userId));
    }

    public Collection<ManagedInstance> getAllInstances() {
        return instances.values();
    }

    public void stopInstance(ManagedInstance instance) {
        log.info("Stopping instance {}:{} (port={})", instance.getAgentId(), instance.getUserId(), instance.getPort());
        instance.setStatus(ManagedInstance.Status.STOPPED);
        ProcessUtil.stopGracefully(instance.getProcess(), GatewayConstants.STOP_GRACE_PERIOD_MS);
        instances.remove(instance.getKey());
    }

    /**
     * Kill a hung instance asynchronously so the next getOrSpawn() will create a fresh one.
     * Called by SseRelayService when a timeout is detected (goosed is deadlocked).
     */
    public void forceRecycle(String agentId, String userId) {
        String key = ManagedInstance.buildKey(agentId, userId);
        ManagedInstance instance = instances.get(key);
        if (instance != null && instance.getStatus() == ManagedInstance.Status.RUNNING) {
            log.warn("Force-recycling hung instance {}:{} (port={})", agentId, userId, instance.getPort());
            stopInstance(instance);
        }
    }

    /**
     * Stop all instances for a given agent across all users.
     */
    public void stopAllForAgent(String agentId) {
        instances.values().stream()
                .filter(inst -> inst.getAgentId().equals(agentId))
                .toList()
                .forEach(this::stopInstance);
    }

    /**
     * Touch all instances for a user (keep them alive together).
     */
    public void touchAllForUser(String userId) {
        for (ManagedInstance inst : instances.values()) {
            if (inst.getUserId().equals(userId)) {
                inst.touch();
            }
        }
    }

    @PreDestroy
    public void stopAll() {
        log.info("Stopping all instances...");
        for (ManagedInstance inst : instances.values()) {
            try {
                stopInstance(inst);
            } catch (Exception e) {
                log.error("Error stopping {}:{}", inst.getAgentId(), inst.getUserId(), e);
            }
        }
    }
}

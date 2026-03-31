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
import java.security.SecureRandom;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

@Component
@org.springframework.context.annotation.DependsOn("systemUserMigrationService")
public class InstanceManager {

    private static final Logger log = LogManager.getLogger(InstanceManager.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final GatewayProperties properties;
    private final PortAllocator portAllocator;
    private final RuntimePreparer runtimePreparer;
    private final AgentConfigService agentConfigService;
    private final SSLSocketFactory trustAllSslFactory;
    private final int serverPort;
    private final boolean serverSslEnabled;
    private final String gatewayApiPassword;

    /** key = "agentId:userId" -> ManagedInstance */
    private final ConcurrentHashMap<String, ManagedInstance> instances = new ConcurrentHashMap<>();
    /** Per-key spawn locks to prevent concurrent spawns */
    private final ConcurrentHashMap<String, ReentrantLock> spawnLocks = new ConcurrentHashMap<>();

    public InstanceManager(GatewayProperties properties,
                           PortAllocator portAllocator,
                           RuntimePreparer runtimePreparer,
                           AgentConfigService agentConfigService,
                           @Value("${server.port:3000}") int serverPort,
                           @Value("${server.ssl.enabled:false}") boolean serverSslEnabled,
                           @Value("${gateway.api.password:}") String gatewayApiPassword) {
        this.properties = properties;
        this.portAllocator = portAllocator;
        this.runtimePreparer = runtimePreparer;
        this.agentConfigService = agentConfigService;
        this.trustAllSslFactory = createTrustAllSslFactory();
        this.serverPort = serverPort;
        this.serverSslEnabled = serverSslEnabled;
        this.gatewayApiPassword = gatewayApiPassword;
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
        return properties.gooseScheme() + "://127.0.0.1:" + port;
    }

    /**
     * Auto-start configured resident instances on gateway startup,
     * then register default schedules from recipe files.
     */
    @PostConstruct
    public void autoStartResidentInstances() {
        agentConfigService.getResidentInstances().forEach(target -> {
            try {
                log.info("Auto-starting resident instance for {}:{}", target.agentId(), target.userId());
                ManagedInstance instance = doSpawn(target.agentId(), target.userId());
                registerDefaultSchedules(target.agentId(), instance.getPort(), instance.getSecretKey());
            } catch (Exception e) {
                log.error("Failed to auto-start resident instance for {}:{}: {}",
                        target.agentId(), target.userId(), e.getMessage());
            }
        });
    }

    /**
     * Scan agent's config/recipes/ directory and register each recipe as a paused schedule.
     */
    private void registerDefaultSchedules(String agentId, int port, String secretKey) {
        Path recipesDir = agentConfigService.getAgentsDir()
                .resolve(agentId).resolve("config").resolve("recipes");
        if (!Files.isDirectory(recipesDir)) return;

        try {
            // Fetch existing schedules
            Set<String> existingIds = new HashSet<>();
            try {
                String listJson = httpGet(port, "/schedule/list", secretKey);
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

                        boolean created = httpPost(port, "/schedule/create", bodyJson, secretKey);
                        if (!created) {
                            log.warn("Failed to create schedule {} for {}", scheduleId, agentId);
                            continue;
                        }

                        // Pause immediately
                        httpPost(port, "/schedule/" + scheduleId + "/pause", "{}", secretKey);
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
        if (properties.isGooseTls() && conn instanceof HttpsURLConnection) {
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

    private String httpGet(int port, String path, String secretKey) throws IOException {
        URL url = new URL(goosedBaseUrl(port) + path);
        HttpURLConnection conn = openConnection(url);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        conn.setRequestMethod("GET");
        conn.setRequestProperty("x-secret-key", secretKey);
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

    private boolean httpPost(int port, String path, String body, String secretKey) throws IOException {
        URL url = new URL(goosedBaseUrl(port) + path);
        HttpURLConnection conn = openConnection(url);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(5000);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("x-secret-key", secretKey);
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
        long requestStart = System.currentTimeMillis();

        // Quick non-blocking check: reuse instance if process is alive.
        // The blocking health probe runs on boundedElastic below.
        ManagedInstance existing = instances.get(key);
        if (existing != null && existing.getStatus() == ManagedInstance.Status.RUNNING) {
            if (!existing.getProcess().isAlive()) {
                log.warn("Instance {}:{} process died (port={}), removing stale entry",
                        agentId, userId, existing.getPort());
                existing.setStatus(ManagedInstance.Status.STOPPED);
                instances.remove(key);
            } else {
                // Process alive — run blocking health probe off the reactor thread
                return Mono.fromCallable(() -> {
                    long probeStart = System.currentTimeMillis();
                    if (!isHealthy(existing.getPort())) {
                        log.warn("Instance {}:{} unresponsive on port={}, killing and respawning",
                                agentId, userId, existing.getPort());
                        stopInstance(existing);
                        return doSpawn(agentId, userId);
                    }
                    long probeMs = System.currentTimeMillis() - probeStart;
                    long totalMs = System.currentTimeMillis() - requestStart;
                    log.debug("Reusing existing instance {}:{} port={} pid={}", agentId, userId,
                            existing.getPort(), existing.getPid());
                    log.info("[INSTANCE] resolved existing instance {}:{} port={} pid={} probeMs={} totalMs={}",
                            agentId, userId, existing.getPort(), existing.getPid(), probeMs, totalMs);
                    existing.touch();
                    existing.resetRestartCount();
                    return existing;
                }).subscribeOn(Schedulers.boundedElastic());
            }
        }

        log.info("[INSTANCE] no running instance for {}:{}, spawning new one", agentId, userId);
        return Mono.fromCallable(() -> doSpawn(agentId, userId))
                .doOnNext(instance -> log.info("[INSTANCE] spawned new instance {}:{} port={} pid={} totalMs={}",
                        agentId, userId, instance.getPort(), instance.getPid(),
                        System.currentTimeMillis() - requestStart))
                .subscribeOn(Schedulers.boundedElastic());
    }

    private ManagedInstance doSpawn(String agentId, String userId) throws Exception {
        String key = ManagedInstance.buildKey(agentId, userId);
        long spawnStart = System.currentTimeMillis();
        ReentrantLock lock = spawnLocks.computeIfAbsent(key, k -> new ReentrantLock());
        lock.lock();
        try {
            // Double-check after acquiring lock
            ManagedInstance existing = instances.get(key);
            if (existing != null && existing.getStatus() == ManagedInstance.Status.RUNNING) {
                existing.touch();
                log.info("[INSTANCE] concurrent spawn reused existing instance {}:{} port={} pid={} totalMs={}",
                        agentId, userId, existing.getPort(), existing.getPid(),
                        System.currentTimeMillis() - spawnStart);
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

            long prepareStart = System.currentTimeMillis();
            Path runtimeRoot = runtimePreparer.prepare(agentId, userId);
            resetStuckRunningSchedules(runtimeRoot);
            int port = portAllocator.allocate();
            long prepareMs = System.currentTimeMillis() - prepareStart;

            log.info("Preparing to spawn goosed for {}:{} on port {}, runtimeRoot={}, goosedBin={}",
                    agentId, userId, port, runtimeRoot, properties.getGoosedBin());

            Map<String, String> env = buildEnvironment(agentId, userId, port, runtimeRoot);
            String instanceSecret = env.get("GOOSE_SERVER__SECRET_KEY");

            ProcessBuilder pb = new ProcessBuilder(properties.getGoosedBin(), "agent");
            pb.directory(new File(runtimeRoot.toString()));
            pb.environment().putAll(env);
            pb.redirectErrorStream(true);

            long processStart = System.currentTimeMillis();
            log.info("Spawning goosed for {}:{} on port {}, command: {} agent, TLS={}",
                    agentId, userId, port, properties.getGoosedBin(), env.get("GOOSE_TLS"));
            Process process = pb.start();
            long pid = ProcessUtil.getPid(process);
            long processStartMs = System.currentTimeMillis() - processStart;
            log.info("goosed process started for {}:{} on port {} with pid={}, GOOSE_TLS env={}",
                    agentId, userId, port, pid, env.get("GOOSE_TLS"));

            // Drain stdout/stderr to prevent pipe buffer full → goosed write() blocks → tokio deadlock.
            // goosed's tracing subscriber writes every log to both file and stderr; if the pipe buffer
            // (~64KB) fills up, the write() syscall blocks a tokio worker thread, freezing the runtime.
            Thread drainThread = new Thread(() -> {
                try (var in = process.getInputStream()) {
                    byte[] buf = new byte[8192];
                    long totalBytes = 0;
                    int bytesRead;
                    while ((bytesRead = in.read(buf)) != -1) {
                        totalBytes += bytesRead;
                    }
                    log.debug("Drain thread for {}:{} finished, total bytes drained: {}",
                            agentId, userId, totalBytes);
                } catch (java.io.IOException e) {
                    log.debug("Drain thread for {}:{} ended with IOException: {}",
                            agentId, userId, e.getMessage());
                }
            }, "goosed-drain-" + agentId + "-" + userId);
            drainThread.setDaemon(true);
            drainThread.start();

            ManagedInstance instance = new ManagedInstance(agentId, userId, port, pid, process, instanceSecret);
            instances.put(key, instance);

            long readyStart = System.currentTimeMillis();
            log.debug("Starting health check for {}:{} on port {} (pid={}), URL: {}",
                    agentId, userId, port, pid, goosedBaseUrl(port) + "/status");
            waitForReady(port, process);
            long readyMs = System.currentTimeMillis() - readyStart;
            instance.setStatus(ManagedInstance.Status.RUNNING);
            log.info("Instance {}:{} ready on port {} (pid={})", agentId, userId, port, pid);
            log.info("[INSTANCE] spawn ready {}:{} port={} pid={} prepareMs={} processStartMs={} waitReadyMs={} totalMs={}",
                    agentId, userId, port, pid, prepareMs, processStartMs, readyMs,
                    System.currentTimeMillis() - spawnStart);

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
        // Per-instance random secret key (32 bytes hex)
        byte[] secretBytes = new byte[32];
        SECURE_RANDOM.nextBytes(secretBytes);
        StringBuilder hexSecret = new StringBuilder(64);
        for (byte b : secretBytes) {
            hexSecret.append(String.format("%02x", b));
        }
        env.put("GOOSE_SERVER__SECRET_KEY", hexSecret.toString());
        env.put("GOOSE_PATH_ROOT", runtimeRoot.toString());
        env.put("GOOSE_DISABLE_KEYRING", "1");

        boolean gooseTlsValue = properties.isGooseTls();
        env.put("GOOSE_TLS", String.valueOf(gooseTlsValue));
        log.info("buildEnvironment: properties.isGooseTls()={}, setting GOOSE_TLS={} for {}:{}",
                gooseTlsValue, gooseTlsValue, agentId, userId);

        // Enable debug logging for goose internals, but keep rustls/hyper at info
        // to avoid tracing_log deadlock in TLS handshake (rustls debug logs go through
        // tracing_log bridge which can deadlock the tokio runtime)
        env.put("RUST_LOG", "info,goose=debug,goosed=debug,rmcp=debug");
        env.put("GOOSE_DEBUG", "1");
        log.debug("goosed env for {}:{}: RUST_LOG={}, GOOSE_DEBUG=1, GOOSE_PORT={}, GOOSE_TLS={}",
                agentId, userId, env.get("RUST_LOG"), port, env.get("GOOSE_TLS"));

        // Gateway self-URL for MCP extensions that call back to the gateway
        String gatewayScheme = serverSslEnabled ? "https" : "http";
        env.put("GATEWAY_URL", gatewayScheme + "://127.0.0.1:" + serverPort);
        if (serverSslEnabled) {
            env.put("NODE_TLS_REJECT_UNAUTHORIZED", "0");
        }

        // Gateway API password for goosed process
        if (gatewayApiPassword != null && !gatewayApiPassword.isEmpty()) {
            env.put("GATEWAY_API_PASSWORD", gatewayApiPassword);
        }

        return env;
    }

    private void waitForReady(int port, Process process) throws Exception {
        String baseUrl = goosedBaseUrl(port);
        URL url = new URL(baseUrl + "/status");
        String healthCheckUrl = url.toString();
        log.info("[gooseTls config] waitForReady: using baseUrl={}, gooseScheme={}, health check URL: {}",
                baseUrl, properties.gooseScheme(), healthCheckUrl);
        log.info("Waiting for goosed on port {} to be ready, health check URL: {}, max attempts: {}",
                port, healthCheckUrl, GatewayConstants.HEALTH_CHECK_MAX_ATTEMPTS);
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
                    } else {
                        log.warn("Health check attempt {}/{} returned status code {} for {}",
                                i + 1, GatewayConstants.HEALTH_CHECK_MAX_ATTEMPTS, code, healthCheckUrl);
                    }
                } finally {
                    conn.disconnect();
                }
            } catch (IOException e) {
                log.debug("Health check attempt {}/{} failed for {}: {}",
                        i + 1, GatewayConstants.HEALTH_CHECK_MAX_ATTEMPTS, healthCheckUrl, e.getMessage());
            }
            Thread.sleep(interval);
            interval = Math.min(interval * 2, GatewayConstants.HEALTH_CHECK_MAX_INTERVAL_MS);
        }
        if (!ProcessUtil.isAlive(process)) {
            throw processExitedException(process, port);
        }
        log.error("goosed failed to start on port {} after {} attempts - process is alive but not responding. Health check URL: {}",
                port, GatewayConstants.HEALTH_CHECK_MAX_ATTEMPTS, healthCheckUrl);
        throw new RuntimeException("goosed failed to start on port " + port
                + " (process alive but not responding after "
                + GatewayConstants.HEALTH_CHECK_MAX_ATTEMPTS + " attempts)");
    }

    private RuntimeException processExitedException(Process process, int port) {
        int exitCode = process.exitValue();
        String output = ProcessUtil.readOutput(process, 4096);
        log.error("goosed process exited unexpectedly on port {}, exitCode={}, output (first 4KB): {}",
                port, exitCode, output);
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

    /**
     * Asynchronously respawn a crashed instance. Called by InstanceWatchdog
     * when a dead process is detected during periodic health checks.
     */
    public void respawnAsync(String agentId, String userId, int restartCount) {
        Mono.fromCallable(() -> {
            ManagedInstance instance = doSpawn(agentId, userId);
            instance.setRestartCount(restartCount);
            instance.setLastRestartTime(System.currentTimeMillis());
            return instance;
        }).subscribeOn(Schedulers.boundedElastic())
          .subscribe(
              inst -> log.info("Watchdog respawned {}:{} on port {} (restart #{})",
                      agentId, userId, inst.getPort(), restartCount),
              err -> log.error("Watchdog failed to respawn {}:{}: {}",
                      agentId, userId, err.getMessage())
          );
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

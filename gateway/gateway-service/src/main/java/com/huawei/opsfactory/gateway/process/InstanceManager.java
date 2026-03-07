package com.huawei.opsfactory.gateway.process;

import com.huawei.opsfactory.gateway.common.constants.GatewayConstants;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.common.util.ProcessUtil;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
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

    private final GatewayProperties properties;
    private final PortAllocator portAllocator;
    private final RuntimePreparer runtimePreparer;
    private final AgentConfigService agentConfigService;

    /** key = "agentId:userId" -> ManagedInstance */
    private final ConcurrentHashMap<String, ManagedInstance> instances = new ConcurrentHashMap<>();
    /** Per-key spawn locks to prevent concurrent spawns */
    private final ConcurrentHashMap<String, ReentrantLock> spawnLocks = new ConcurrentHashMap<>();

    public InstanceManager(GatewayProperties properties,
                           PortAllocator portAllocator,
                           RuntimePreparer runtimePreparer,
                           AgentConfigService agentConfigService) {
        this.properties = properties;
        this.portAllocator = portAllocator;
        this.runtimePreparer = runtimePreparer;
        this.agentConfigService = agentConfigService;
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
                    com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                    Map<String, Object> parsed = mapper.readValue(listJson,
                            new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
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
                        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                        Object recipe;
                        if (fileName.endsWith(".json")) {
                            recipe = mapper.readValue(recipeContent, Object.class);
                        } else {
                            Yaml yaml = new Yaml();
                            recipe = yaml.load(recipeContent);
                        }

                        // Create schedule
                        Map<String, Object> body = new HashMap<>();
                        body.put("id", scheduleId);
                        body.put("recipe", recipe);
                        body.put("cron", "0 9 * * *");
                        String bodyJson = mapper.writeValueAsString(body);

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

    private String httpGet(int port, String path) throws IOException {
        URL url = new URL("http://127.0.0.1:" + port + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
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
        URL url = new URL("http://127.0.0.1:" + port + path);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
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
            existing.touch();
            return Mono.just(existing);
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

            Path runtimeRoot = runtimePreparer.prepare(agentId, userId);
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

            waitForReady(port);
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

        return env;
    }

    private void waitForReady(int port) throws Exception {
        for (int i = 0; i < GatewayConstants.HEALTH_CHECK_MAX_ATTEMPTS; i++) {
            try {
                URL url = new URL("http://127.0.0.1:" + port + "/status");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(500);
                conn.setReadTimeout(500);
                conn.setRequestMethod("GET");
                int code = conn.getResponseCode();
                conn.disconnect();
                if (code == 200) {
                    return;
                }
            } catch (IOException ignored) {
                // Not ready yet
            }
            Thread.sleep(GatewayConstants.HEALTH_CHECK_INTERVAL_MS);
        }
        throw new RuntimeException("goosed failed to start on port " + port);
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

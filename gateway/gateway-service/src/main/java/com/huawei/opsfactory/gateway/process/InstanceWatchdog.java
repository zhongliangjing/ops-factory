package com.huawei.opsfactory.gateway.process;

import com.huawei.opsfactory.gateway.common.constants.GatewayConstants;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.huawei.opsfactory.gateway.common.util.ProcessUtil;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Component
public class InstanceWatchdog {

    private static final Logger log = LogManager.getLogger(InstanceWatchdog.class);

    private final InstanceManager instanceManager;
    private final GatewayProperties properties;
    private final PrewarmService prewarmService;

    public InstanceWatchdog(InstanceManager instanceManager, GatewayProperties properties,
                            PrewarmService prewarmService) {
        this.instanceManager = instanceManager;
        this.properties = properties;
        this.prewarmService = prewarmService;
    }

    @Scheduled(fixedDelayString = "${gateway.idle.check-interval-ms:60000}")
    public void watchInstances() {
        checkInstanceHealth();
        reapIdleInstances();
    }

    /**
     * Phase 1: Check all RUNNING instances for process liveness.
     * Dead processes are cleaned up and respawned with backoff.
     */
    private void checkInstanceHealth() {
        int maxRestarts = properties.getIdle().getMaxRestartAttempts();
        long baseDelay = properties.getIdle().getRestartBaseDelayMs();
        long now = System.currentTimeMillis();

        // Snapshot to avoid ConcurrentModificationException during stopInstance
        List<ManagedInstance> snapshot = new ArrayList<>(instanceManager.getAllInstances());

        for (ManagedInstance instance : snapshot) {
            if (instance.getStatus() != ManagedInstance.Status.RUNNING) {
                continue;
            }

            if (instance.getProcess() != null && ProcessUtil.isAlive(instance.getProcess())) {
                continue;
            }

            // Process is dead
            int exitCode = -1;
            try {
                if (instance.getProcess() != null) {
                    exitCode = instance.getProcess().exitValue();
                }
            } catch (IllegalThreadStateException ignored) {
                // Should not happen since isAlive() returned false
            }

            String agentId = instance.getAgentId();
            String userId = instance.getUserId();
            int restartCount = instance.getRestartCount();

            log.warn("Watchdog detected dead instance {}:{} (port={}, pid={}, exit={})",
                    agentId, userId, instance.getPort(), instance.getPid(), exitCode);
            instanceManager.stopInstance(instance);

            // Respawn with backoff
            if (restartCount >= maxRestarts) {
                log.error("Instance {}:{} exceeded max restart attempts ({}), not respawning. "
                        + "Will retry on next user request.",
                        agentId, userId, maxRestarts);
                continue;
            }

            long backoffMs = Math.min(baseDelay * (1L << Math.min(restartCount, 20)), 300_000L);
            long elapsed = now - instance.getLastRestartTime();
            if (instance.getLastRestartTime() > 0 && elapsed < backoffMs) {
                log.info("Instance {}:{} backing off ({}ms remaining before retry #{})",
                        agentId, userId, backoffMs - elapsed, restartCount + 1);
                continue;
            }

            log.info("Watchdog respawning instance {}:{} (attempt #{})",
                    agentId, userId, restartCount + 1);
            instanceManager.respawnAsync(agentId, userId, restartCount + 1);
        }
    }

    /**
     * Phase 2: Reap idle instances (original IdleReaper logic).
     * Sys instances are never reaped.
     */
    private void reapIdleInstances() {
        long maxIdleMs = properties.getIdle().getTimeoutMinutes() * 60_000L;
        long now = System.currentTimeMillis();
        Set<String> reapedUsers = new HashSet<>();

        List<ManagedInstance> snapshot = new ArrayList<>(instanceManager.getAllInstances());
        for (ManagedInstance instance : snapshot) {
            // Never reap sys instances
            if (GatewayConstants.SYS_USER.equals(instance.getUserId())) {
                continue;
            }
            if (instance.getStatus() == ManagedInstance.Status.RUNNING
                    && now - instance.getLastActivity() > maxIdleMs) {
                log.info("Reaping idle instance {}:{} (idle {}s)",
                        instance.getAgentId(), instance.getUserId(),
                        (now - instance.getLastActivity()) / 1000);
                instanceManager.stopInstance(instance);
                reapedUsers.add(instance.getUserId());
            }
        }

        // Reset pre-warm state for users who have no remaining instances
        for (String userId : reapedUsers) {
            boolean hasRemaining = instanceManager.getAllInstances().stream()
                    .anyMatch(i -> i.getUserId().equals(userId)
                            && i.getStatus() == ManagedInstance.Status.RUNNING);
            if (!hasRemaining) {
                prewarmService.clearUser(userId);
            }
        }
    }
}

package com.huawei.opsfactory.gateway.process;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Test;

import java.util.List;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

public class InstanceWatchdogTest {

    private InstanceManager instanceManager;
    private GatewayProperties properties;
    private PrewarmService prewarmService;
    private InstanceWatchdog watchdog;

    @Before
    public void setUp() {
        instanceManager = mock(InstanceManager.class);
        properties = new GatewayProperties();
        properties.getIdle().setTimeoutMinutes(15);
        properties.getIdle().setMaxRestartAttempts(3);
        properties.getIdle().setRestartBaseDelayMs(5000L);
        prewarmService = mock(PrewarmService.class);
        watchdog = new InstanceWatchdog(instanceManager, properties, prewarmService);
    }

    // ---- Idle reap tests (original behavior) ----

    @Test
    public void testReap_idleInstance() {
        ManagedInstance idle = createInstance("agent1", "user1", ManagedInstance.Status.RUNNING, mockAliveProcess());
        setLastActivity(idle, System.currentTimeMillis() - 20 * 60 * 1000L);

        when(instanceManager.getAllInstances()).thenReturn(List.of(idle));

        watchdog.watchInstances();

        verify(instanceManager).stopInstance(idle);
    }

    @Test
    public void testReap_activeInstance() {
        ManagedInstance active = createInstance("agent1", "user1", ManagedInstance.Status.RUNNING, mockAliveProcess());
        setLastActivity(active, System.currentTimeMillis());

        when(instanceManager.getAllInstances()).thenReturn(List.of(active));

        watchdog.watchInstances();

        verify(instanceManager, never()).stopInstance(active);
    }

    @Test
    public void testReap_neverReapsSys() {
        ManagedInstance sysInstance = createInstance("agent1", "sys", ManagedInstance.Status.RUNNING, mockAliveProcess());
        setLastActivity(sysInstance, System.currentTimeMillis() - 60 * 60 * 1000L);

        when(instanceManager.getAllInstances()).thenReturn(List.of(sysInstance));

        watchdog.watchInstances();

        verify(instanceManager, never()).stopInstance(sysInstance);
    }

    @Test
    public void testReap_skipsNonRunning() {
        ManagedInstance stopped = createInstance("agent1", "user1", ManagedInstance.Status.STOPPED, null);
        setLastActivity(stopped, System.currentTimeMillis() - 20 * 60 * 1000L);

        when(instanceManager.getAllInstances()).thenReturn(List.of(stopped));

        watchdog.watchInstances();

        verify(instanceManager, never()).stopInstance(stopped);
    }

    // ---- Health check tests (new behavior) ----

    @Test
    public void testWatchdog_detectsDeadProcess_respawns() {
        Process deadProcess = mockDeadProcess(1);
        ManagedInstance dead = createInstance("agent1", "user1", ManagedInstance.Status.RUNNING, deadProcess);

        when(instanceManager.getAllInstances()).thenReturn(List.of(dead));

        watchdog.watchInstances();

        verify(instanceManager).stopInstance(dead);
        verify(instanceManager).respawnAsync("agent1", "user1", 1);
    }

    @Test
    public void testWatchdog_respectsMaxRestartAttempts() {
        Process deadProcess = mockDeadProcess(1);
        ManagedInstance dead = createInstance("agent1", "user1", ManagedInstance.Status.RUNNING, deadProcess);
        dead.setRestartCount(3); // Already at max

        when(instanceManager.getAllInstances()).thenReturn(List.of(dead));

        watchdog.watchInstances();

        verify(instanceManager).stopInstance(dead);
        verify(instanceManager, never()).respawnAsync("agent1", "user1", 4);
    }

    @Test
    public void testWatchdog_backoffDelay() {
        Process deadProcess = mockDeadProcess(1);
        ManagedInstance dead = createInstance("agent1", "user1", ManagedInstance.Status.RUNNING, deadProcess);
        dead.setRestartCount(1);
        dead.setLastRestartTime(System.currentTimeMillis() - 1000); // Only 1s ago, backoff is 10s

        when(instanceManager.getAllInstances()).thenReturn(List.of(dead));

        watchdog.watchInstances();

        verify(instanceManager).stopInstance(dead);
        // Should not respawn yet due to backoff
        verify(instanceManager, never()).respawnAsync("agent1", "user1", 2);
    }

    @Test
    public void testWatchdog_backoffExpired_respawns() {
        Process deadProcess = mockDeadProcess(1);
        ManagedInstance dead = createInstance("agent1", "user1", ManagedInstance.Status.RUNNING, deadProcess);
        dead.setRestartCount(1);
        dead.setLastRestartTime(System.currentTimeMillis() - 20_000); // 20s ago, backoff is 10s

        when(instanceManager.getAllInstances()).thenReturn(List.of(dead));

        watchdog.watchInstances();

        verify(instanceManager).stopInstance(dead);
        verify(instanceManager).respawnAsync("agent1", "user1", 2);
    }

    @Test
    public void testWatchdog_aliveProcess_noAction() {
        ManagedInstance alive = createInstance("agent1", "user1", ManagedInstance.Status.RUNNING, mockAliveProcess());

        when(instanceManager.getAllInstances()).thenReturn(List.of(alive));

        watchdog.watchInstances();

        verify(instanceManager, never()).stopInstance(alive);
        verify(instanceManager, never()).respawnAsync("agent1", "user1", 1);
    }

    // ---- Helpers ----

    private ManagedInstance createInstance(String agentId, String userId,
                                          ManagedInstance.Status status, Process process) {
        ManagedInstance instance = new ManagedInstance(agentId, userId, 8080, 1234L, process);
        instance.setStatus(status);
        return instance;
    }

    private Process mockAliveProcess() {
        Process p = mock(Process.class);
        when(p.isAlive()).thenReturn(true);
        return p;
    }

    private Process mockDeadProcess(int exitCode) {
        Process p = mock(Process.class);
        when(p.isAlive()).thenReturn(false);
        when(p.exitValue()).thenReturn(exitCode);
        return p;
    }

    private void setLastActivity(ManagedInstance instance, long timestamp) {
        try {
            java.lang.reflect.Field field = ManagedInstance.class.getDeclaredField("lastActivity");
            field.setAccessible(true);
            field.setLong(instance, timestamp);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}

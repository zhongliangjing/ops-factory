package com.huawei.opsfactory.gateway.process;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Test;
import org.mockito.Mockito;

import java.util.List;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

public class IdleReaperTest {

    private InstanceManager instanceManager;
    private GatewayProperties properties;
    private IdleReaper reaper;

    @Before
    public void setUp() {
        instanceManager = mock(InstanceManager.class);
        properties = new GatewayProperties();
        properties.getIdle().setTimeoutMinutes(15);
        reaper = new IdleReaper(instanceManager, properties);
    }

    @Test
    public void testReap_idleInstance() {
        ManagedInstance idle = createInstance("agent1", "user1", ManagedInstance.Status.RUNNING);
        // Simulate idle for 20 minutes
        setLastActivity(idle, System.currentTimeMillis() - 20 * 60 * 1000L);

        when(instanceManager.getAllInstances()).thenReturn(List.of(idle));

        reaper.reapIdleInstances();

        verify(instanceManager).stopInstance(idle);
    }

    @Test
    public void testReap_activeInstance() {
        ManagedInstance active = createInstance("agent1", "user1", ManagedInstance.Status.RUNNING);
        // Last activity just now
        setLastActivity(active, System.currentTimeMillis());

        when(instanceManager.getAllInstances()).thenReturn(List.of(active));

        reaper.reapIdleInstances();

        verify(instanceManager, never()).stopInstance(active);
    }

    @Test
    public void testReap_neverReapsSys() {
        ManagedInstance sysInstance = createInstance("agent1", "sys", ManagedInstance.Status.RUNNING);
        setLastActivity(sysInstance, System.currentTimeMillis() - 60 * 60 * 1000L); // 1 hour idle

        when(instanceManager.getAllInstances()).thenReturn(List.of(sysInstance));

        reaper.reapIdleInstances();

        verify(instanceManager, never()).stopInstance(sysInstance);
    }

    @Test
    public void testReap_skipsNonRunning() {
        ManagedInstance stopped = createInstance("agent1", "user1", ManagedInstance.Status.STOPPED);
        setLastActivity(stopped, System.currentTimeMillis() - 20 * 60 * 1000L);

        when(instanceManager.getAllInstances()).thenReturn(List.of(stopped));

        reaper.reapIdleInstances();

        verify(instanceManager, never()).stopInstance(stopped);
    }

    private ManagedInstance createInstance(String agentId, String userId, ManagedInstance.Status status) {
        ManagedInstance instance = new ManagedInstance(agentId, userId, 8080, 1234L, null);
        instance.setStatus(status);
        return instance;
    }

    private void setLastActivity(ManagedInstance instance, long timestamp) {
        // Use touch and then adjust via reflection or just accept the approximation
        // Since lastActivity is set in constructor, and we need old timestamp, use a helper
        try {
            java.lang.reflect.Field field = ManagedInstance.class.getDeclaredField("lastActivity");
            field.setAccessible(true);
            field.setLong(instance, timestamp);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}

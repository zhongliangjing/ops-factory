package com.huawei.opsfactory.gateway.process;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import org.junit.Before;
import org.junit.Test;

import java.util.Collection;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class InstanceManagerTest {

    private InstanceManager instanceManager;
    private GatewayProperties properties;
    private PortAllocator portAllocator;
    private RuntimePreparer runtimePreparer;
    private AgentConfigService agentConfigService;

    @Before
    public void setUp() {
        properties = new GatewayProperties();
        properties.setSecretKey("test-secret");
        portAllocator = mock(PortAllocator.class);
        runtimePreparer = mock(RuntimePreparer.class);
        agentConfigService = mock(AgentConfigService.class);
        when(agentConfigService.loadAgentConfigYaml(anyString())).thenReturn(Map.of());
        when(agentConfigService.loadAgentSecretsYaml(anyString())).thenReturn(Map.of());

        instanceManager = new InstanceManager(properties, portAllocator, runtimePreparer, agentConfigService);
    }

    @Test
    public void testGetInstance_noInstance() {
        assertNull(instanceManager.getInstance("agent1", "user1"));
    }

    @Test
    public void testGetAllInstances_empty() {
        Collection<ManagedInstance> all = instanceManager.getAllInstances();
        assertNotNull(all);
        assertTrue(all.isEmpty());
    }

    @Test
    public void testStopInstance() {
        // Create a mock instance manually with a mock process
        Process mockProcess = mock(Process.class);
        when(mockProcess.isAlive()).thenReturn(false);
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, mockProcess);
        instance.setStatus(ManagedInstance.Status.RUNNING);

        // Use reflection to add instance to internal map for testing
        addInstanceDirectly(instance);

        assertNotNull(instanceManager.getInstance("agent1", "user1"));

        instanceManager.stopInstance(instance);

        assertNull(instanceManager.getInstance("agent1", "user1"));
        assertEquals(ManagedInstance.Status.STOPPED, instance.getStatus());
    }

    @Test
    public void testStopAllForAgent() {
        Process mockProcess = mock(Process.class);
        when(mockProcess.isAlive()).thenReturn(false);

        ManagedInstance inst1 = new ManagedInstance("agent1", "user1", 8080, 1234L, mockProcess);
        inst1.setStatus(ManagedInstance.Status.RUNNING);
        ManagedInstance inst2 = new ManagedInstance("agent1", "user2", 8081, 1235L, mockProcess);
        inst2.setStatus(ManagedInstance.Status.RUNNING);
        ManagedInstance inst3 = new ManagedInstance("agent2", "user1", 8082, 1236L, mockProcess);
        inst3.setStatus(ManagedInstance.Status.RUNNING);

        addInstanceDirectly(inst1);
        addInstanceDirectly(inst2);
        addInstanceDirectly(inst3);

        assertEquals(3, instanceManager.getAllInstances().size());

        instanceManager.stopAllForAgent("agent1");

        assertEquals(1, instanceManager.getAllInstances().size());
        assertNull(instanceManager.getInstance("agent1", "user1"));
        assertNull(instanceManager.getInstance("agent1", "user2"));
        assertNotNull(instanceManager.getInstance("agent2", "user1"));
    }

    @Test
    public void testTouchAllForUser() throws InterruptedException {
        Process mockProcess = mock(Process.class);

        ManagedInstance inst1 = new ManagedInstance("agent1", "user1", 8080, 1234L, mockProcess);
        ManagedInstance inst2 = new ManagedInstance("agent2", "user1", 8081, 1235L, mockProcess);
        ManagedInstance inst3 = new ManagedInstance("agent1", "user2", 8082, 1236L, mockProcess);

        addInstanceDirectly(inst1);
        addInstanceDirectly(inst2);
        addInstanceDirectly(inst3);

        long beforeUser2 = inst3.getLastActivity();
        Thread.sleep(10);

        instanceManager.touchAllForUser("user1");

        assertTrue(inst1.getLastActivity() > beforeUser2);
        assertTrue(inst2.getLastActivity() > beforeUser2);
        // user2's instance should NOT have been touched more recently
        assertEquals(beforeUser2, inst3.getLastActivity());
    }

    @Test
    public void testStopAll() {
        Process mockProcess = mock(Process.class);
        when(mockProcess.isAlive()).thenReturn(false);

        ManagedInstance inst1 = new ManagedInstance("agent1", "user1", 8080, 1234L, mockProcess);
        inst1.setStatus(ManagedInstance.Status.RUNNING);
        ManagedInstance inst2 = new ManagedInstance("agent2", "user2", 8081, 1235L, mockProcess);
        inst2.setStatus(ManagedInstance.Status.RUNNING);

        addInstanceDirectly(inst1);
        addInstanceDirectly(inst2);

        instanceManager.stopAll();

        assertTrue(instanceManager.getAllInstances().isEmpty());
    }

    @Test
    public void testStopAll_handlesErrors() {
        Process mockProcess = mock(Process.class);
        // destroyForcibly throws exception
        when(mockProcess.isAlive()).thenThrow(new RuntimeException("Process error"));

        ManagedInstance inst = new ManagedInstance("agent1", "user1", 8080, 1234L, mockProcess);
        inst.setStatus(ManagedInstance.Status.RUNNING);
        addInstanceDirectly(inst);

        // Should not throw even if individual instance fails
        instanceManager.stopAll();
    }

    @Test
    public void testGetOrSpawn_returnsExistingRunningInstance() {
        Process mockProcess = mock(Process.class);
        ManagedInstance existing = new ManagedInstance("agent1", "user1", 8080, 1234L, mockProcess);
        existing.setStatus(ManagedInstance.Status.RUNNING);
        addInstanceDirectly(existing);

        long beforeTouch = existing.getLastActivity();

        ManagedInstance result = instanceManager.getOrSpawn("agent1", "user1").block();

        assertNotNull(result);
        assertEquals(existing, result);
        assertTrue(result.getLastActivity() >= beforeTouch);
    }

    /**
     * Helper to add instances directly to the internal map via reflection.
     */
    private void addInstanceDirectly(ManagedInstance instance) {
        try {
            java.lang.reflect.Field field = InstanceManager.class.getDeclaredField("instances");
            field.setAccessible(true);
            @SuppressWarnings("unchecked")
            java.util.concurrent.ConcurrentHashMap<String, ManagedInstance> instances =
                    (java.util.concurrent.ConcurrentHashMap<String, ManagedInstance>) field.get(instanceManager);
            instances.put(instance.getKey(), instance);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}

package com.huawei.opsfactory.gateway.common.model;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

public class ManagedInstanceTest {

    @Test
    public void testBuildKey() {
        assertEquals("agent1:user1", ManagedInstance.buildKey("agent1", "user1"));
        assertEquals("kb-agent:admin", ManagedInstance.buildKey("kb-agent", "admin"));
    }

    @Test
    public void testGetKey() {
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, null, "test-secret");
        assertEquals("agent1:user1", instance.getKey());
    }

    @Test
    public void testInitialStatus() {
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, null, "test-secret");
        assertEquals(ManagedInstance.Status.STARTING, instance.getStatus());
    }

    @Test
    public void testSetStatus() {
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, null, "test-secret");
        instance.setStatus(ManagedInstance.Status.RUNNING);
        assertEquals(ManagedInstance.Status.RUNNING, instance.getStatus());
    }

    @Test
    public void testTouch() throws InterruptedException {
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, null, "test-secret");
        long before = instance.getLastActivity();
        Thread.sleep(10);
        instance.touch();
        assertTrue(instance.getLastActivity() >= before);
    }

    @Test
    public void testGetters() {
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 9090, 5678L, null, "test-secret");
        assertEquals("agent1", instance.getAgentId());
        assertEquals("user1", instance.getUserId());
        assertEquals(9090, instance.getPort());
        assertEquals(5678L, instance.getPid());
    }

    @Test
    public void testStatusTransitions() {
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, null, "test-secret");
        assertEquals(ManagedInstance.Status.STARTING, instance.getStatus());

        instance.setStatus(ManagedInstance.Status.RUNNING);
        assertEquals(ManagedInstance.Status.RUNNING, instance.getStatus());

        instance.setStatus(ManagedInstance.Status.STOPPED);
        assertEquals(ManagedInstance.Status.STOPPED, instance.getStatus());

        instance.setStatus(ManagedInstance.Status.ERROR);
        assertEquals(ManagedInstance.Status.ERROR, instance.getStatus());
    }

    @Test
    public void testStatusEnumValues() {
        ManagedInstance.Status[] values = ManagedInstance.Status.values();
        assertEquals(4, values.length);
        assertEquals(ManagedInstance.Status.STARTING, ManagedInstance.Status.valueOf("STARTING"));
        assertEquals(ManagedInstance.Status.RUNNING, ManagedInstance.Status.valueOf("RUNNING"));
        assertEquals(ManagedInstance.Status.STOPPED, ManagedInstance.Status.valueOf("STOPPED"));
        assertEquals(ManagedInstance.Status.ERROR, ManagedInstance.Status.valueOf("ERROR"));
    }

    @Test
    public void testProcessIsNullable() {
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, null, "test-secret");
        assertEquals(null, instance.getProcess());
    }

    @Test
    public void testLastActivityInitializedOnConstruction() {
        long before = System.currentTimeMillis();
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, null, "test-secret");
        long after = System.currentTimeMillis();

        assertTrue(instance.getLastActivity() >= before);
        assertTrue(instance.getLastActivity() <= after);
    }

    @Test
    public void testBuildKey_specialCharacters() {
        assertEquals("agent-1:user_2", ManagedInstance.buildKey("agent-1", "user_2"));
        assertEquals("a:b", ManagedInstance.buildKey("a", "b"));
    }

    @Test
    public void testTouch_updatesTimestamp() throws InterruptedException {
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, null, "test-secret");
        long first = instance.getLastActivity();
        Thread.sleep(15);
        instance.touch();
        long second = instance.getLastActivity();
        assertTrue("Touch should update lastActivity", second > first);
    }

    @Test
    public void testSessionResumedTracking() {
        ManagedInstance instance = new ManagedInstance("agent1", "user1", 8080, 1234L, null, "test-secret");
        String sessionId = "s1";
        assertTrue(!instance.isSessionResumed(sessionId));
        instance.markSessionResumed(sessionId);
        assertTrue(instance.isSessionResumed(sessionId));
        instance.unmarkSessionResumed(sessionId);
        assertTrue(!instance.isSessionResumed(sessionId));
    }
}

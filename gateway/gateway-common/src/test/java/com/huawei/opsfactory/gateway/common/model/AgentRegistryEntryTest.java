package com.huawei.opsfactory.gateway.common.model;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class AgentRegistryEntryTest {

    @Test
    public void testRecordAccessors() {
        AgentRegistryEntry entry = new AgentRegistryEntry("kb-agent", "KB Agent", true);
        assertEquals("kb-agent", entry.id());
        assertEquals("KB Agent", entry.name());
        assertTrue(entry.sysOnly());
    }

    @Test
    public void testRecordAccessors_notSysOnly() {
        AgentRegistryEntry entry = new AgentRegistryEntry("test-agent", "Test Agent", false);
        assertEquals("test-agent", entry.id());
        assertEquals("Test Agent", entry.name());
        assertFalse(entry.sysOnly());
    }

    @Test
    public void testRecordEquality() {
        AgentRegistryEntry a = new AgentRegistryEntry("a", "A", false);
        AgentRegistryEntry b = new AgentRegistryEntry("a", "A", false);
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
    }
}

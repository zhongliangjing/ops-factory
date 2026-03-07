package com.huawei.opsfactory.gateway.hook;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class HookContextTest {

    @Test
    public void testConstructor() {
        HookContext ctx = new HookContext("{}", "agent1", "user1");
        assertEquals("{}", ctx.getBody());
        assertEquals("agent1", ctx.getAgentId());
        assertEquals("user1", ctx.getUserId());
        assertNotNull(ctx.getState());
        assertTrue(ctx.getState().isEmpty());
    }

    @Test
    public void testSetBody() {
        HookContext ctx = new HookContext("original", "agent1", "user1");
        ctx.setBody("modified");
        assertEquals("modified", ctx.getBody());
    }

    @Test
    public void testState() {
        HookContext ctx = new HookContext("{}", "agent1", "user1");
        ctx.getState().put("key", "value");
        assertEquals("value", ctx.getState().get("key"));
    }
}

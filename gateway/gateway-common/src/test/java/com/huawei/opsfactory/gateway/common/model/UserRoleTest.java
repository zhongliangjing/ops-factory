package com.huawei.opsfactory.gateway.common.model;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class UserRoleTest {

    @Test
    public void testFromUserId_sys() {
        assertEquals(UserRole.ADMIN, UserRole.fromUserId("sys"));
    }

    @Test
    public void testFromUserId_regularUser() {
        assertEquals(UserRole.USER, UserRole.fromUserId("user123"));
        assertEquals(UserRole.USER, UserRole.fromUserId("__default__"));
        assertEquals(UserRole.USER, UserRole.fromUserId(""));
    }

    @Test
    public void testIsAdmin() {
        assertTrue(UserRole.ADMIN.isAdmin());
        assertFalse(UserRole.USER.isAdmin());
    }
}

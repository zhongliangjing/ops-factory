package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.proxy.GoosedProxy;
import org.junit.Before;
import org.junit.Test;
import org.springframework.web.reactive.function.client.WebClient;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class SessionServiceTest {

    private SessionService sessionService;

    @Before
    public void setUp() {
        InstanceManager instanceManager = mock(InstanceManager.class);
        GoosedProxy goosedProxy = mock(GoosedProxy.class);
        when(goosedProxy.getWebClient()).thenReturn(WebClient.create());
        when(goosedProxy.getSecretKey()).thenReturn("test");
        sessionService = new SessionService(instanceManager, goosedProxy);
    }

    @Test
    public void testCacheAndRetrieveOwner() {
        sessionService.cacheOwner("session-1", "user-a");
        assertEquals("user-a", sessionService.getCachedOwner("session-1"));
    }

    @Test
    public void testGetCachedOwner_notCached() {
        assertNull(sessionService.getCachedOwner("unknown-session"));
    }

    @Test
    public void testRemoveOwner() {
        sessionService.cacheOwner("session-1", "user-a");
        sessionService.removeOwner("session-1");
        assertNull(sessionService.getCachedOwner("session-1"));
    }

    @Test
    public void testCacheOverwrite() {
        sessionService.cacheOwner("session-1", "user-a");
        sessionService.cacheOwner("session-1", "user-b");
        assertEquals("user-b", sessionService.getCachedOwner("session-1"));
    }
}

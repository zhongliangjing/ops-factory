package com.huawei.opsfactory.gateway.proxy;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import org.junit.Before;
import org.junit.Test;

import static org.junit.Assert.assertNotNull;
import static org.mockito.Mockito.mock;

public class SseRelayServiceTest {

    private SseRelayService sseRelayService;

    @Before
    public void setUp() {
        GatewayProperties properties = new GatewayProperties();
        properties.setSecretKey("test-key");
        GoosedProxy goosedProxy = new GoosedProxy(properties);
        InstanceManager instanceManager = mock(InstanceManager.class);
        sseRelayService = new SseRelayService(goosedProxy, properties, instanceManager);
    }

    @Test
    public void testRelayReturnsFlux() {
        assertNotNull(sseRelayService.relay(99999, "/reply", "{\"test\": true}", "test-agent", "sys"));
    }
}

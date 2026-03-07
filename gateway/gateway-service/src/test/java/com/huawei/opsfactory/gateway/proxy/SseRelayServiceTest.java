package com.huawei.opsfactory.gateway.proxy;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Test;

import static org.junit.Assert.assertNotNull;

public class SseRelayServiceTest {

    private SseRelayService sseRelayService;

    @Before
    public void setUp() {
        GatewayProperties properties = new GatewayProperties();
        properties.setSecretKey("test-key");
        GoosedProxy goosedProxy = new GoosedProxy(properties);
        sseRelayService = new SseRelayService(goosedProxy, properties);
    }

    @Test
    public void testRelayReturnsFlux() {
        assertNotNull(sseRelayService.relay(99999, "/reply", "{\"test\": true}"));
    }
}

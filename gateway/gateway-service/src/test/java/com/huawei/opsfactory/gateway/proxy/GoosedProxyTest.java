package com.huawei.opsfactory.gateway.proxy;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

public class GoosedProxyTest {

    private GoosedProxy proxy;

    @Before
    public void setUp() {
        GatewayProperties properties = new GatewayProperties();
        properties.setSecretKey("test-key");
        proxy = new GoosedProxy(properties);
    }

    @Test
    public void testWebClientNotNull() {
        assertNotNull(proxy.getWebClient());
    }

    @Test
    public void testSecretKey() {
        assertEquals("test-key", proxy.getSecretKey());
    }
}

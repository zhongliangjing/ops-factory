package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class LangfuseServiceTest {

    @Test
    public void testIsConfigured_allSet() {
        GatewayProperties props = new GatewayProperties();
        GatewayProperties.Langfuse langfuse = new GatewayProperties.Langfuse();
        langfuse.setHost("http://langfuse.example.com");
        langfuse.setPublicKey("pk-123");
        langfuse.setSecretKey("sk-456");
        props.setLangfuse(langfuse);

        LangfuseService service = new LangfuseService(props);
        assertTrue(service.isConfigured());
    }

    @Test
    public void testIsConfigured_missingHost() {
        GatewayProperties props = new GatewayProperties();
        GatewayProperties.Langfuse langfuse = new GatewayProperties.Langfuse();
        langfuse.setHost("");
        langfuse.setPublicKey("pk-123");
        langfuse.setSecretKey("sk-456");
        props.setLangfuse(langfuse);

        LangfuseService service = new LangfuseService(props);
        assertFalse(service.isConfigured());
    }

    @Test
    public void testIsConfigured_defaults() {
        GatewayProperties props = new GatewayProperties();
        LangfuseService service = new LangfuseService(props);
        assertFalse(service.isConfigured());
    }
}

package com.huawei.opsfactory.gateway.config;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class GatewayPropertiesTest {

    @Test
    public void testDefaults() {
        GatewayProperties props = new GatewayProperties();

        assertEquals("test", props.getSecretKey());
        assertEquals("http://127.0.0.1:5173", props.getCorsOrigin());
        assertEquals("goosed", props.getGoosedBin());
    }

    @Test
    public void testPathDefaults() {
        GatewayProperties.Paths paths = new GatewayProperties.Paths();
        assertEquals("..", paths.getProjectRoot());
        assertEquals("agents", paths.getAgentsDir());
        assertEquals("users", paths.getUsersDir());
    }

    @Test
    public void testIdleDefaults() {
        GatewayProperties.Idle idle = new GatewayProperties.Idle();
        assertEquals(15, idle.getTimeoutMinutes());
        assertEquals(60000L, idle.getCheckIntervalMs());
    }

    @Test
    public void testUploadDefaults() {
        GatewayProperties.Upload upload = new GatewayProperties.Upload();
        assertEquals(50, upload.getMaxFileSizeMb());
        assertEquals(20, upload.getMaxImageSizeMb());
    }

    @Test
    public void testVisionDefaults() {
        GatewayProperties.Vision vision = new GatewayProperties.Vision();
        assertEquals("off", vision.getMode());
        assertEquals("", vision.getProvider());
        assertEquals(1024, vision.getMaxTokens());
    }

    @Test
    public void testOfficePreviewDefaults() {
        GatewayProperties.OfficePreview op = new GatewayProperties.OfficePreview();
        assertFalse(op.isEnabled());
        assertEquals("", op.getOnlyofficeUrl());
    }

    @Test
    public void testSetters() {
        GatewayProperties props = new GatewayProperties();
        props.setSecretKey("new-key");
        props.setCorsOrigin("http://localhost:8080");
        props.setGoosedBin("/usr/bin/goosed");

        assertEquals("new-key", props.getSecretKey());
        assertEquals("http://localhost:8080", props.getCorsOrigin());
        assertEquals("/usr/bin/goosed", props.getGoosedBin());
    }

    @Test
    public void testLangfuseDefaults() {
        GatewayProperties.Langfuse langfuse = new GatewayProperties.Langfuse();
        assertEquals("", langfuse.getHost());
        assertEquals("", langfuse.getPublicKey());
        assertEquals("", langfuse.getSecretKey());
    }
}

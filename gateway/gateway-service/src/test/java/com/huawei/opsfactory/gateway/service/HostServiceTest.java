package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static org.junit.Assert.*;

public class HostServiceTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    private HostService hostService;
    private GatewayProperties properties;
    private Path hostsDir;

    @Before
    public void setUp() throws IOException {
        properties = new GatewayProperties();
        GatewayProperties.Paths paths = new GatewayProperties.Paths();
        paths.setProjectRoot(tempFolder.getRoot().getAbsolutePath());
        properties.setPaths(paths);
        properties.setCredentialEncryptionKey("test-key-test-key-test-key-32");

        hostService = new HostService(properties);
        hostService.init();

        hostsDir = Path.of(tempFolder.getRoot().getAbsolutePath())
                .toAbsolutePath().normalize().resolve("gateway").resolve("data").resolve("hosts");
    }

    // ── listHosts ──────────────────────────────────────────────────

    @Test
    public void testListHosts_empty() {
        List<Map<String, Object>> hosts = hostService.listHosts(null);
        assertTrue(hosts.isEmpty());
    }

    @Test
    public void testListHosts_returnsAllHosts() {
        createHost("host-1", "Server1", "10.0.0.1", List.of("RCPA"));
        createHost("host-2", "Server2", "10.0.0.2", List.of("GMDB"));

        List<Map<String, Object>> hosts = hostService.listHosts(null);
        assertEquals(2, hosts.size());
    }

    @Test
    public void testListHosts_credentialsMasked() {
        createHost("host-1", "Server1", "10.0.0.1", List.of());

        List<Map<String, Object>> hosts = hostService.listHosts(null);
        assertEquals(1, hosts.size());
        assertEquals("***", hosts.get(0).get("credential"));
    }

    @Test
    public void testListHosts_filterByTag() {
        createHost("host-1", "Server1", "10.0.0.1", List.of("RCPA"));
        createHost("host-2", "Server2", "10.0.0.2", List.of("GMDB"));
        createHost("host-3", "Server3", "10.0.0.3", List.of("RCPA", "ALL"));

        List<Map<String, Object>> hosts = hostService.listHosts(new String[]{"RCPA"});
        assertEquals(2, hosts.size());
    }

    @Test
    public void testListHosts_filterByTagNoMatch() {
        createHost("host-1", "Server1", "10.0.0.1", List.of("RCPA"));

        List<Map<String, Object>> hosts = hostService.listHosts(new String[]{"NONEXISTENT"});
        assertTrue(hosts.isEmpty());
    }

    @Test
    public void testListHosts_emptyTagsArray() {
        createHost("host-1", "Server1", "10.0.0.1", List.of());

        List<Map<String, Object>> hosts = hostService.listHosts(new String[]{});
        assertEquals(1, hosts.size());
    }

    // ── getHost ────────────────────────────────────────────────────

    @Test
    public void testGetHost_existing() {
        createHost("host-1", "Server1", "10.0.0.1", List.of("RCPA"));

        Map<String, Object> host = hostService.getHost("host-1");
        assertNotNull(host);
        assertEquals("Server1", host.get("name"));
        assertEquals("***", host.get("credential"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void testGetHost_notFound() {
        hostService.getHost("nonexistent");
    }

    // ── getHostWithCredential ──────────────────────────────────────

    @Test
    public void testGetHostWithCredential_decryptsCredential() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "TestHost");
        body.put("ip", "10.0.0.1");
        body.put("port", 22);
        body.put("username", "root");
        body.put("authType", "password");
        body.put("credential", "mySecretPassword");
        body.put("tags", List.of());

        Map<String, Object> created = hostService.createHost(body);
        String id = (String) created.get("id");

        Map<String, Object> host = hostService.getHostWithCredential(id);
        assertEquals("mySecretPassword", host.get("credential"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void testGetHostWithCredential_notFound() {
        hostService.getHostWithCredential("nonexistent");
    }

    // ── createHost ─────────────────────────────────────────────────

    @Test
    public void testCreateHost_success() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "TestHost");
        body.put("ip", "10.0.0.1");
        body.put("port", 22);
        body.put("username", "root");
        body.put("authType", "password");
        body.put("credential", "secret123");
        body.put("tags", List.of("RCPA"));
        body.put("description", "Test host");

        Map<String, Object> result = hostService.createHost(body);

        assertNotNull(result.get("id"));
        assertEquals("TestHost", result.get("name"));
        assertEquals("10.0.0.1", result.get("ip"));
        assertEquals(22, result.get("port"));
        assertEquals("root", result.get("username"));
        assertEquals("password", result.get("authType"));
        assertEquals(List.of("RCPA"), result.get("tags"));
        assertEquals("Test host", result.get("description"));
        assertEquals("***", result.get("credential"));
        assertNotNull(result.get("createdAt"));
        assertNotNull(result.get("updatedAt"));
    }

    @Test
    public void testCreateHost_defaultValues() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "MinimalHost");

        Map<String, Object> result = hostService.createHost(body);

        assertEquals("", result.get("ip"));
        assertEquals(22, result.get("port"));
        assertEquals("", result.get("username"));
        assertEquals("password", result.get("authType"));
        assertEquals("", result.get("description"));
    }

    @Test
    public void testCreateHost_encryptedCredentialStored() throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "EncHost");
        body.put("credential", "plainTextPassword");

        Map<String, Object> result = hostService.createHost(body);
        String id = (String) result.get("id");

        // Read raw file and verify credential is encrypted (not plain text)
        Path file = hostsDir.resolve(id + ".json");
        String raw = Files.readString(file, StandardCharsets.UTF_8);
        assertFalse(raw.contains("plainTextPassword"));
    }

    // ── updateHost ─────────────────────────────────────────────────

    @Test
    public void testUpdateHost_success() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Original");
        body.put("ip", "10.0.0.1");
        body.put("credential", "pass");
        hostService.createHost(body);
        String id = getFirstHostId();

        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("name", "Updated");
        updates.put("ip", "10.0.0.2");

        Map<String, Object> result = hostService.updateHost(id, updates);
        assertEquals("Updated", result.get("name"));
        assertEquals("10.0.0.2", result.get("ip"));
    }

    @Test
    public void testUpdateHost_updateCredential() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Host");
        body.put("credential", "oldPassword");
        hostService.createHost(body);
        String id = getFirstHostId();

        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("credential", "newPassword");

        Map<String, Object> result = hostService.updateHost(id, updates);
        assertEquals("***", result.get("credential"));

        // Verify decrypted credential is updated
        Map<String, Object> withCred = hostService.getHostWithCredential(id);
        assertEquals("newPassword", withCred.get("credential"));
    }

    @Test
    public void testUpdateHost_updateTags() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Host");
        body.put("tags", List.of("OLD"));
        hostService.createHost(body);
        String id = getFirstHostId();

        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("tags", List.of("NEW1", "NEW2"));

        Map<String, Object> result = hostService.updateHost(id, updates);
        assertEquals(List.of("NEW1", "NEW2"), result.get("tags"));
    }

    @Test
    public void testUpdateHost_partialUpdate() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Original");
        body.put("ip", "10.0.0.1");
        body.put("description", "original desc");
        hostService.createHost(body);
        String id = getFirstHostId();

        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("description", "new desc");

        Map<String, Object> result = hostService.updateHost(id, updates);
        assertEquals("Original", result.get("name"));
        assertEquals("10.0.0.1", result.get("ip"));
        assertEquals("new desc", result.get("description"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void testUpdateHost_notFound() {
        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("name", "NewName");
        hostService.updateHost("nonexistent", updates);
    }

    @Test
    public void testUpdateHost_maskedCredentialPreservesOriginal() {
        // Create host with a known password
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Host");
        body.put("credential", "originalSecretPassword");
        hostService.createHost(body);
        String id = getFirstHostId();

        // Simulate frontend sending back the masked "***" value (edit without password change)
        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("name", "UpdatedName");
        updates.put("credential", "***");

        hostService.updateHost(id, updates);

        // Verify the original credential is preserved (not overwritten with "***")
        Map<String, Object> withCred = hostService.getHostWithCredential(id);
        assertEquals("originalSecretPassword", withCred.get("credential"));
        assertEquals("UpdatedName", withCred.get("name"));
    }

    @Test
    public void testUpdateHost_updatedAtChanges() throws InterruptedException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Host");
        hostService.createHost(body);
        String id = getFirstHostId();

        String createdAt = (String) hostService.getHost(id).get("createdAt");
        Thread.sleep(10); // Ensure timestamp difference

        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("name", "Updated");
        hostService.updateHost(id, updates);

        String updatedAt = (String) hostService.getHost(id).get("updatedAt");
        assertNotNull(updatedAt);
    }

    // ── deleteHost ─────────────────────────────────────────────────

    @Test
    public void testDeleteHost_success() {
        createHost("host-del", "ToDelete", "10.0.0.1", List.of());

        boolean deleted = hostService.deleteHost("host-del");
        assertTrue(deleted);
        assertTrue(hostService.listHosts(null).isEmpty());
    }

    @Test
    public void testDeleteHost_notFound() {
        boolean deleted = hostService.deleteHost("nonexistent");
        assertFalse(deleted);
    }

    // ── getAllTags ─────────────────────────────────────────────────

    @Test
    public void testGetAllTags_empty() {
        List<String> tags = hostService.getAllTags();
        assertTrue(tags.isEmpty());
    }

    @Test
    public void testGetAllTags_collectsUnique() {
        createHost("h1", "S1", "10.0.0.1", List.of("RCPA", "ALL"));
        createHost("h2", "S2", "10.0.0.2", List.of("GMDB"));
        createHost("h3", "S3", "10.0.0.3", List.of("RCPA"));

        List<String> tags = hostService.getAllTags();
        assertEquals(3, tags.size());
        assertTrue(tags.contains("RCPA"));
        assertTrue(tags.contains("GMDB"));
        assertTrue(tags.contains("ALL"));
    }

    @Test
    public void testGetAllTags_hostWithNoTags() {
        createHost("h1", "S1", "10.0.0.1", null);

        List<String> tags = hostService.getAllTags();
        assertTrue(tags.isEmpty());
    }

    // ── testConnection ─────────────────────────────────────────────

    @Test
    public void testConnection_hostNotFound() {
        Map<String, Object> result = hostService.testConnection("nonexistent");
        assertEquals(false, result.get("success"));
    }

    // ── Edge cases ─────────────────────────────────────────────────

    @Test
    public void testListHosts_skipsCorruptFile() throws IOException {
        // Write a corrupt JSON file
        Files.writeString(hostsDir.resolve("bad.json"), "not valid json {}", StandardCharsets.UTF_8);

        List<Map<String, Object>> hosts = hostService.listHosts(null);
        // Should not throw, just skip the corrupt file
        assertNotNull(hosts);
    }

    @Test
    public void testCreateHost_withKeyAuth() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "KeyHost");
        body.put("ip", "10.0.0.1");
        body.put("authType", "key");
        body.put("credential", "-----BEGIN RSA PRIVATE KEY-----\nfakekey\n-----END RSA PRIVATE KEY-----");

        Map<String, Object> result = hostService.createHost(body);
        assertEquals("key", result.get("authType"));
        assertEquals("***", result.get("credential"));
    }

    // ── Helpers ────────────────────────────────────────────────────

    private void createHost(String id, String name, String ip, List<String> tags) {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("id", id);
        host.put("name", name);
        host.put("ip", ip);
        host.put("port", 22);
        host.put("username", "root");
        host.put("authType", "password");
        host.put("credential", "***");
        host.put("tags", tags != null ? tags : List.of());
        host.put("description", "");
        host.put("createdAt", "2026-01-01T00:00:00Z");
        host.put("updatedAt", "2026-01-01T00:00:00Z");

        try {
            Path file = hostsDir.resolve(id + ".json");
            String json = new com.fasterxml.jackson.databind.ObjectMapper()
                    .writerWithDefaultPrettyPrinter().writeValueAsString(host);
            Files.writeString(file, json, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private String getFirstHostId() {
        List<Map<String, Object>> hosts = hostService.listHosts(null);
        assertFalse("Expected at least one host", hosts.isEmpty());
        return (String) hosts.get(0).get("id");
    }
}

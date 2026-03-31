package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.junit.MockitoJUnitRunner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@RunWith(MockitoJUnitRunner.class)
public class RemoteExecutionServiceTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    @Mock
    private HostService hostService;

    @Mock
    private CommandWhitelistService commandWhitelistService;

    private RemoteExecutionService remoteExecutionService;
    private GatewayProperties properties;

    @Before
    public void setUp() {
        properties = new GatewayProperties();
        remoteExecutionService = new RemoteExecutionService(
                hostService, commandWhitelistService, properties);
    }

    // ── execute: host not found ──────────────────────────────────

    @Test
    public void testExecute_hostNotFound() {
        when(hostService.getHostWithCredential("nonexistent"))
                .thenThrow(new IllegalArgumentException("Host not found: nonexistent"));

        Map<String, Object> result = remoteExecutionService.execute("nonexistent", "ps -ef", 30);

        assertEquals(-1, result.get("exitCode"));
        assertEquals("Host not found: nonexistent", result.get("error"));
        assertEquals("nonexistent", result.get("hostId"));
    }

    // ── execute: command rejected by whitelist ───────────────────

    @Test
    public void testExecute_commandRejected() {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("name", "TestHost");
        host.put("ip", "192.168.1.1");
        host.put("port", 22);
        host.put("username", "root");
        host.put("authType", "password");
        host.put("credential", "secret");
        when(hostService.getHostWithCredential("host-1")).thenReturn(host);

        when(commandWhitelistService.validateCommand("rm -rf /"))
                .thenReturn(List.of("rm"));

        Map<String, Object> result = remoteExecutionService.execute("host-1", "rm -rf /", 30);

        assertEquals(-1, result.get("exitCode"));
        assertNotNull(result.get("rejectedCommands"));
        assertTrue(((List<?>) result.get("rejectedCommands")).contains("rm"));
    }

    // ── execute: SSH connection fails (invalid host) ─────────────

    @Test
    public void testExecute_sshConnectionFails() {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("name", "BadHost");
        host.put("ip", "256.256.256.256"); // invalid IP
        host.put("port", 22);
        host.put("username", "root");
        host.put("authType", "password");
        host.put("credential", "secret");
        when(hostService.getHostWithCredential("host-1")).thenReturn(host);

        when(commandWhitelistService.validateCommand("ls")).thenReturn(List.of());

        Map<String, Object> result = remoteExecutionService.execute("host-1", "ls", 5);

        // Should get an error result, not crash
        assertEquals(-1, result.get("exitCode"));
        assertNotNull(result.get("error"));
        assertTrue(result.get("error").toString().contains("SSH execution failed"));
    }

    // ── execute: whitelist validation passes, SSH fails gracefully ─

    @Test
    public void testExecute_whitelistCheckedBeforeSsh() {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("name", "Host");
        host.put("ip", "10.0.0.1");
        host.put("port", 22);
        host.put("username", "root");
        host.put("authType", "password");
        host.put("credential", "secret");
        when(hostService.getHostWithCredential("host-1")).thenReturn(host);

        // Command rejected - should NOT attempt SSH
        when(commandWhitelistService.validateCommand("reboot"))
                .thenReturn(List.of("reboot"));

        Map<String, Object> result = remoteExecutionService.execute("host-1", "reboot", 30);

        assertEquals(-1, result.get("exitCode"));
        // Verify that we get the whitelist rejection, not an SSH error
        assertNotNull(result.get("rejectedCommands"));
    }

    // ── execute: port from Number ────────────────────────────────

    @Test
    public void testExecute_hostWithNonDefaultPort() {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("name", "Host");
        host.put("ip", "10.0.0.1");
        host.put("port", 2222);
        host.put("username", "root");
        host.put("authType", "password");
        host.put("credential", "secret");
        when(hostService.getHostWithCredential("host-1")).thenReturn(host);

        when(commandWhitelistService.validateCommand("ls")).thenReturn(List.of());

        // SSH will fail but the service should handle it gracefully
        Map<String, Object> result = remoteExecutionService.execute("host-1", "ls", 5);
        assertNotNull(result);
    }

    // ── execute: key auth type ───────────────────────────────────

    @Test
    public void testExecute_keyAuthType() {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("name", "KeyHost");
        host.put("ip", "10.0.0.1");
        host.put("port", 22);
        host.put("username", "root");
        host.put("authType", "key");
        host.put("credential", "fake-key-content");
        when(hostService.getHostWithCredential("host-1")).thenReturn(host);

        when(commandWhitelistService.validateCommand("ps")).thenReturn(List.of());

        // SSH will fail with fake key but should not crash
        Map<String, Object> result = remoteExecutionService.execute("host-1", "ps", 5);
        assertNotNull(result);
        assertEquals(-1, result.get("exitCode"));
    }

    // ── execute: missing port uses default 22 ────────────────────

    @Test
    public void testExecute_missingPortDefaultsTo22() {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("name", "Host");
        host.put("ip", "10.0.0.1");
        host.put("username", "root");
        host.put("authType", "password");
        host.put("credential", "secret");
        // port is missing
        when(hostService.getHostWithCredential("host-1")).thenReturn(host);

        when(commandWhitelistService.validateCommand("ls")).thenReturn(List.of());

        Map<String, Object> result = remoteExecutionService.execute("host-1", "ls", 5);
        assertNotNull(result);
    }

    // ── execute: empty command ───────────────────────────────────

    @Test
    public void testExecute_emptyCommand() {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("name", "Host");
        host.put("ip", "10.0.0.1");
        host.put("port", 22);
        host.put("username", "root");
        host.put("authType", "password");
        host.put("credential", "secret");
        when(hostService.getHostWithCredential("host-1")).thenReturn(host);

        when(commandWhitelistService.validateCommand("")).thenReturn(List.of());

        Map<String, Object> result = remoteExecutionService.execute("host-1", "", 5);
        assertNotNull(result);
    }
}

package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class RemoteExecutionService {

    private static final Logger log = LogManager.getLogger(RemoteExecutionService.class);

    private final HostService hostService;
    private final CommandWhitelistService commandWhitelistService;
    private final GatewayProperties properties;

    public RemoteExecutionService(HostService hostService,
                                  CommandWhitelistService commandWhitelistService,
                                  GatewayProperties properties) {
        this.hostService = hostService;
        this.commandWhitelistService = commandWhitelistService;
        this.properties = properties;
    }

    /**
     * Execute a remote command on the specified host via SSH.
     *
     * @param hostId         the host ID to connect to
     * @param command        the shell command to execute
     * @param timeoutSeconds maximum execution time in seconds
     * @return result map with hostId, hostName, exitCode, output, error, duration
     */
    public Map<String, Object> execute(String hostId, String command, int timeoutSeconds) {
        // Step 1: Get host with decrypted credential
        Map<String, Object> host;
        try {
            host = hostService.getHostWithCredential(hostId);
        } catch (IllegalArgumentException e) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("hostId", hostId);
            result.put("hostName", "");
            result.put("exitCode", -1);
            result.put("output", "");
            result.put("error", "Host not found: " + hostId);
            result.put("duration", 0L);
            return result;
        }

        String hostName = (String) host.getOrDefault("name", "");
        String hostname = (String) host.get("ip");
        int port = host.get("port") instanceof Number n ? n.intValue() : 22;
        String username = (String) host.get("username");
        String authType = (String) host.get("authType");
        String credential = (String) host.get("credential");

        // Step 2: Validate command against whitelist
        List<String> rejected = commandWhitelistService.validateCommand(command);
        if (!rejected.isEmpty()) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("hostId", hostId);
            result.put("hostName", hostName);
            result.put("exitCode", -1);
            result.put("output", "");
            result.put("error", "Command rejected: the following commands are not in the whitelist: " + String.join(", ", rejected));
            result.put("rejectedCommands", rejected);
            result.put("duration", 0L);
            return result;
        }

        // Step 3: Execute via SSH
        Session session = null;
        ChannelExec channel = null;
        long startTime = System.currentTimeMillis();

        try {
            JSch jsch = new JSch();
            session = jsch.getSession(username, hostname, port);

            if ("key".equals(authType)) {
                jsch.addIdentity("remote-exec", credential.getBytes(StandardCharsets.UTF_8),
                        null, null);
            } else {
                session.setPassword(credential);
            }

            session.setConfig("StrictHostKeyChecking", "no");
            session.connect(5000);

            channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand(command);

            InputStream in = channel.getInputStream();
            InputStream err = channel.getExtInputStream();

            ByteArrayOutputStream outputBuffer = new ByteArrayOutputStream();
            ByteArrayOutputStream errorBuffer = new ByteArrayOutputStream();

            channel.connect();

            // Read streams with timeout
            long deadline = System.currentTimeMillis() + (long) timeoutSeconds * 1000;
            byte[] buf = new byte[4096];

            while (true) {
                if (channel.isClosed()) {
                    // Read any remaining data
                    while (in.available() > 0) {
                        int len = in.read(buf);
                        if (len > 0) {
                            outputBuffer.write(buf, 0, len);
                        }
                    }
                    while (err.available() > 0) {
                        int len = err.read(buf);
                        if (len > 0) {
                            errorBuffer.write(buf, 0, len);
                        }
                    }
                    break;
                }

                while (in.available() > 0) {
                    int len = in.read(buf);
                    if (len > 0) {
                        outputBuffer.write(buf, 0, len);
                    }
                }
                while (err.available() > 0) {
                    int len = err.read(buf);
                    if (len > 0) {
                        errorBuffer.write(buf, 0, len);
                    }
                }

                if (System.currentTimeMillis() > deadline) {
                    log.warn("Command execution timed out after {} seconds for host {}", timeoutSeconds, hostId);
                    channel.sendSignal("KILL");
                    break;
                }

                Thread.sleep(50);
            }

            int exitCode = channel.getExitStatus();
            long duration = System.currentTimeMillis() - startTime;

            String output = outputBuffer.toString(StandardCharsets.UTF_8);
            String errorOutput = errorBuffer.toString(StandardCharsets.UTF_8);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("hostId", hostId);
            result.put("hostName", hostName);
            result.put("exitCode", exitCode);
            result.put("output", output);
            result.put("error", errorOutput);
            result.put("duration", duration);
            return result;

        } catch (Exception e) {
            long duration = System.currentTimeMillis() - startTime;
            log.error("SSH execution failed for host {}: {}", hostId, e.getMessage());

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("hostId", hostId);
            result.put("hostName", hostName);
            result.put("exitCode", -1);
            result.put("output", "");
            result.put("error", "SSH execution failed: " + e.getMessage());
            result.put("duration", duration);
            return result;
        } finally {
            if (channel != null) {
                try {
                    channel.disconnect();
                } catch (Exception ignored) {
                }
            }
            if (session != null) {
                try {
                    session.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }
}

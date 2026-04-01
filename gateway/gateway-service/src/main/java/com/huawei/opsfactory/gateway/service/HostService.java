package com.huawei.opsfactory.gateway.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class HostService {

    private static final Logger log = LogManager.getLogger(HostService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String AES_ALGORITHM = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;

    private final GatewayProperties properties;
    private Path gatewayRoot;
    private Path hostsDir;
    private SecretKeySpec aesKey;

    public HostService(GatewayProperties properties) {
        this.properties = properties;
    }

    @PostConstruct
    public void init() {
        this.gatewayRoot = Path.of(properties.getPaths().getProjectRoot())
                .toAbsolutePath().normalize().resolve("gateway");
        this.hostsDir = gatewayRoot.resolve("data").resolve("hosts");

        // Derive AES key from configuration (ensure exactly 32 bytes for AES-256)
        String keyStr = properties.getCredentialEncryptionKey();
        byte[] keyBytes = new byte[32];
        byte[] rawKeyBytes = keyStr.getBytes(StandardCharsets.UTF_8);
        System.arraycopy(rawKeyBytes, 0, keyBytes, 0, Math.min(rawKeyBytes.length, 32));
        this.aesKey = new SecretKeySpec(keyBytes, "AES");

        try {
            Files.createDirectories(hostsDir);
        } catch (IOException e) {
            log.error("Failed to create hosts directory: {}", hostsDir, e);
        }

        log.info("HostService initialized, hostsDir={}", hostsDir);
    }

    // ── CRUD Operations ──────────────────────────────────────────────

    public List<Map<String, Object>> listHosts(String[] tags) {
        List<Map<String, Object>> hosts = new ArrayList<>();
        if (!Files.isDirectory(hostsDir)) {
            return hosts;
        }
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(hostsDir, "*.json")) {
            for (Path file : stream) {
                if (!Files.isRegularFile(file)) {
                    continue;
                }
                try {
                    Map<String, Object> host = readHostFile(file);
                    if (host != null) {
                        // Mask credential for listing
                        host.put("credential", "***");

                        // Filter by tags if provided
                        if (tags != null && tags.length > 0) {
                            Object hostTagsObj = host.get("tags");
                            if (!(hostTagsObj instanceof List<?> hostTags)) {
                                continue;
                            }
                            boolean matches = false;
                            for (String tag : tags) {
                                if (hostTags.stream().anyMatch(ht -> String.valueOf(ht).equalsIgnoreCase(tag))) {
                                    matches = true;
                                    break;
                                }
                            }
                            if (!matches) {
                                continue;
                            }
                        }
                        hosts.add(host);
                    }
                } catch (Exception e) {
                    log.warn("Failed to read host file: {}", file, e);
                }
            }
        } catch (IOException e) {
            log.error("Failed to list hosts from {}", hostsDir, e);
        }
        return hosts;
    }

    public Map<String, Object> getHost(String id) {
        Path file = hostsDir.resolve(id + ".json");
        Map<String, Object> host = readHostFile(file);
        if (host == null) {
            throw new IllegalArgumentException("Host not found: " + id);
        }
        host.put("credential", "***");
        return host;
    }

    public Map<String, Object> getHostWithCredential(String id) {
        Path file = hostsDir.resolve(id + ".json");
        Map<String, Object> host = readHostFile(file);
        if (host == null) {
            throw new IllegalArgumentException("Host not found: " + id);
        }
        // Decrypt credential for internal use
        Object credentialObj = host.get("credential");
        if (credentialObj instanceof String credentialValue && !credentialValue.isEmpty()) {
            try {
                host.put("credential", decrypt(credentialValue));
            } catch (Exception e) {
                log.warn("Failed to decrypt credential for host {}: {}", id, e.getMessage());
                // Leave the encrypted value as-is
            }
        }
        return host;
    }

    public Map<String, Object> createHost(Map<String, Object> body) {
        String id = UUID.randomUUID().toString();
        String now = Instant.now().toString();

        Map<String, Object> host = new LinkedHashMap<>();
        host.put("id", id);
        host.put("name", body.getOrDefault("name", ""));
        host.put("ip", body.getOrDefault("ip", ""));
        host.put("port", body.getOrDefault("port", 22));
        host.put("username", body.getOrDefault("username", ""));
        host.put("authType", body.getOrDefault("authType", "password"));
        host.put("tags", body.getOrDefault("tags", List.of()));
        host.put("description", body.getOrDefault("description", ""));
        host.put("createdAt", now);
        host.put("updatedAt", now);

        // Encrypt credential
        Object credentialObj = body.get("credential");
        String rawCredential = credentialObj != null ? credentialObj.toString() : "";
        try {
            host.put("credential", encrypt(rawCredential));
        } catch (Exception e) {
            log.error("Failed to encrypt credential for new host {}", id, e);
            throw new RuntimeException("Failed to encrypt credential", e);
        }

        writeHostFile(id, host);
        log.info("Created host: id={}, name={}", id, host.get("name"));

        // Return with masked credential
        Map<String, Object> result = new LinkedHashMap<>(host);
        result.put("credential", "***");
        return result;
    }

    public Map<String, Object> updateHost(String id, Map<String, Object> body) {
        Path file = hostsDir.resolve(id + ".json");
        Map<String, Object> host = readHostFile(file);
        if (host == null) {
            throw new IllegalArgumentException("Host not found: " + id);
        }

        // Update mutable fields
        if (body.containsKey("name")) {
            host.put("name", body.get("name"));
        }
        if (body.containsKey("ip")) {
            host.put("ip", body.get("ip"));
        }
        if (body.containsKey("port")) {
            host.put("port", body.get("port"));
        }
        if (body.containsKey("username")) {
            host.put("username", body.get("username"));
        }
        if (body.containsKey("authType")) {
            host.put("authType", body.get("authType"));
        }
        if (body.containsKey("tags")) {
            host.put("tags", body.get("tags"));
        }
        if (body.containsKey("description")) {
            host.put("description", body.get("description"));
        }
        if (body.containsKey("credential")) {
            Object credentialObj = body.get("credential");
            String rawCredential = credentialObj != null ? credentialObj.toString() : "";
            // Skip update when the frontend sends back the masked sentinel value
            if (!"***".equals(rawCredential)) {
                try {
                    host.put("credential", encrypt(rawCredential));
                } catch (Exception e) {
                    log.error("Failed to encrypt credential for host {}", id, e);
                    throw new RuntimeException("Failed to encrypt credential", e);
                }
            }
        }

        host.put("updatedAt", Instant.now().toString());
        writeHostFile(id, host);
        log.info("Updated host: id={}", id);

        // Return with masked credential
        Map<String, Object> result = new LinkedHashMap<>(host);
        result.put("credential", "***");
        return result;
    }

    public boolean deleteHost(String id) {
        Path file = hostsDir.resolve(id + ".json");
        try {
            if (Files.exists(file)) {
                Files.delete(file);
                log.info("Deleted host: id={}", id);
                return true;
            }
            return false;
        } catch (IOException e) {
            log.error("Failed to delete host file: {}", file, e);
            return false;
        }
    }

    public List<String> getAllTags() {
        LinkedHashSet<String> allTags = new LinkedHashSet<>();
        List<Map<String, Object>> hosts = listHosts(null);
        for (Map<String, Object> host : hosts) {
            Object tagsObj = host.get("tags");
            if (tagsObj instanceof List<?> tags) {
                for (Object tag : tags) {
                    if (tag != null) {
                        allTags.add(tag.toString());
                    }
                }
            }
        }
        return new ArrayList<>(allTags);
    }

    public Map<String, Object> testConnection(String id) {
        Map<String, Object> host;
        try {
            host = getHostWithCredential(id);
        } catch (IllegalArgumentException e) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success", false);
            result.put("message", "Host not found: " + id);
            return result;
        }

        String hostname = (String) host.get("ip");
        int port = host.get("port") instanceof Number n ? n.intValue() : 22;
        String username = (String) host.get("username");
        String authType = (String) host.get("authType");
        String credential = (String) host.get("credential");

        Map<String, Object> result = new LinkedHashMap<>();
        long start = System.currentTimeMillis();

        try {
            JSch jsch = new JSch();
            Session session = jsch.getSession(username, hostname, port);

            if ("key".equals(authType)) {
                jsch.addIdentity("test-connection", credential.getBytes(StandardCharsets.UTF_8),
                        null, null);
            } else {
                session.setPassword(credential);
            }

            session.setConfig("StrictHostKeyChecking", "no");
            session.connect(5000);

            long latency = System.currentTimeMillis() - start;
            session.disconnect();

            result.put("success", true);
            result.put("message", "Connection successful");
            result.put("latency", latency + "ms");
        } catch (Exception e) {
            long latency = System.currentTimeMillis() - start;
            log.warn("SSH connection test failed for host {}: {}", id, e.getMessage());
            result.put("success", false);
            result.put("message", "Connection failed: " + e.getMessage());
            result.put("latency", latency + "ms");
        }

        return result;
    }

    // ── File I/O Helpers ─────────────────────────────────────────────

    private Map<String, Object> readHostFile(Path file) {
        if (!Files.exists(file)) {
            return null;
        }
        try {
            String json = Files.readString(file, StandardCharsets.UTF_8);
            return MAPPER.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (IOException e) {
            log.error("Failed to read host file: {}", file, e);
            return null;
        }
    }

    private void writeHostFile(String id, Map<String, Object> host) {
        try {
            Files.createDirectories(hostsDir);
            Path file = hostsDir.resolve(id + ".json");
            String json = MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(host);
            Files.writeString(file, json, StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.error("Failed to write host file for id={}", id, e);
            throw new RuntimeException("Failed to save host", e);
        }
    }

    // ── AES-GCM Encryption ───────────────────────────────────────────

    private String encrypt(String plaintext) throws Exception {
        byte[] iv = new byte[GCM_IV_LENGTH];
        new SecureRandom().nextBytes(iv);

        Cipher cipher = Cipher.getInstance(AES_ALGORITHM);
        GCMParameterSpec gcmSpec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
        cipher.init(Cipher.ENCRYPT_MODE, aesKey, gcmSpec);

        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

        // Prepend IV to ciphertext
        byte[] combined = new byte[iv.length + ciphertext.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);

        return Base64.getEncoder().encodeToString(combined);
    }

    private String decrypt(String encryptedBase64) throws Exception {
        byte[] combined = Base64.getDecoder().decode(encryptedBase64);

        byte[] iv = new byte[GCM_IV_LENGTH];
        byte[] ciphertext = new byte[combined.length - GCM_IV_LENGTH];
        System.arraycopy(combined, 0, iv, 0, GCM_IV_LENGTH);
        System.arraycopy(combined, GCM_IV_LENGTH, ciphertext, 0, ciphertext.length);

        Cipher cipher = Cipher.getInstance(AES_ALGORITHM);
        GCMParameterSpec gcmSpec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
        cipher.init(Cipher.DECRYPT_MODE, aesKey, gcmSpec);

        byte[] plaintext = cipher.doFinal(ciphertext);
        return new String(plaintext, StandardCharsets.UTF_8);
    }
}

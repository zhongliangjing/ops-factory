package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry;
import com.huawei.opsfactory.gateway.common.util.YamlLoader;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
public class AgentConfigService {

    private static final Logger log = LogManager.getLogger(AgentConfigService.class);

    private final GatewayProperties properties;
    private final CopyOnWriteArrayList<AgentRegistryEntry> registry = new CopyOnWriteArrayList<>();

    public AgentConfigService(GatewayProperties properties) {
        this.properties = properties;
    }

    @PostConstruct
    public void loadRegistry() {
        Path agentsYaml = getGatewayRoot().resolve("config").resolve("agents.yaml");
        Map<String, Object> data = YamlLoader.load(agentsYaml);

        Object agentsObj = data.get("agents");
        if (agentsObj instanceof List<?> agentsList) {
            for (Object item : agentsList) {
                if (item instanceof Map<?, ?> rawMap) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> map = (Map<String, Object>) rawMap;
                    String id = YamlLoader.getString(map, "id", "");
                    String name = YamlLoader.getString(map, "name", "");
                    boolean sysOnly = Boolean.TRUE.equals(map.get("sysOnly"));
                    registry.add(new AgentRegistryEntry(id, name, sysOnly));
                }
            }
        }
        log.info("Loaded {} agents from registry", registry.size());
    }

    public List<AgentRegistryEntry> getRegistry() {
        return Collections.unmodifiableList(registry);
    }

    public AgentRegistryEntry findAgent(String agentId) {
        for (AgentRegistryEntry entry : registry) {
            if (entry.id().equals(agentId)) {
                return entry;
            }
        }
        return null;
    }

    /**
     * Load the agent's config.yaml as a Map.
     */
    public Map<String, Object> loadAgentConfigYaml(String agentId) {
        Path configPath = getAgentConfigDir(agentId).resolve("config.yaml");
        return YamlLoader.load(configPath);
    }

    /**
     * Load the agent's secrets.yaml as a Map.
     */
    public Map<String, Object> loadAgentSecretsYaml(String agentId) {
        Path secretsPath = getAgentConfigDir(agentId).resolve("secrets.yaml");
        return YamlLoader.load(secretsPath);
    }

    /**
     * List skill subdirectories for an agent.
     */
    public List<String> listSkills(String agentId) {
        Path skillsDir = getAgentConfigDir(agentId).resolve("skills");
        List<String> skills = new ArrayList<>();
        if (!Files.isDirectory(skillsDir)) {
            return skills;
        }
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(skillsDir)) {
            for (Path entry : stream) {
                if (Files.isDirectory(entry)) {
                    skills.add(entry.getFileName().toString());
                }
            }
        } catch (IOException e) {
            log.error("Failed to list skills for {}", agentId, e);
        }
        return skills;
    }

    /**
     * Read AGENTS.md content for an agent.
     */
    public String readAgentsMd(String agentId) {
        Path mdPath = getAgentsDir().resolve(agentId).resolve("AGENTS.md");
        if (!Files.exists(mdPath)) {
            return "";
        }
        try {
            return Files.readString(mdPath);
        } catch (IOException e) {
            log.error("Failed to read AGENTS.md for {}", agentId, e);
            return "";
        }
    }

    /**
     * Write AGENTS.md content for an agent.
     */
    public void writeAgentsMd(String agentId, String content) throws IOException {
        Path mdPath = getAgentsDir().resolve(agentId).resolve("AGENTS.md");
        Files.writeString(mdPath, content);
    }

    /**
     * Create a new agent: directory structure, config files, registry update.
     */
    public Map<String, Object> createAgent(String id, String name) throws IOException {
        // Validate ID format
        if (!id.matches("^[a-z0-9]([a-z0-9\\-]*[a-z0-9])?$") || id.length() < 2) {
            throw new IllegalArgumentException(
                    "Agent ID must be at least 2 chars, lowercase letters, numbers, and hyphens only (no leading/trailing hyphens)");
        }

        // Check duplicate ID
        if (findAgent(id) != null) {
            throw new IllegalArgumentException("Agent with ID '" + id + "' already exists");
        }

        // Check duplicate name
        for (AgentRegistryEntry entry : registry) {
            if (entry.name().equals(name)) {
                throw new IllegalArgumentException("Agent with name '" + name + "' already exists");
            }
        }

        // Create directory structure
        Path agentDir = getAgentsDir().resolve(id);
        Path configDir = agentDir.resolve("config");
        Files.createDirectories(configDir.resolve("skills"));

        // Copy config template from universal-agent or use defaults
        Path templateConfig = getAgentsDir().resolve("universal-agent").resolve("config").resolve("config.yaml");
        Path targetConfig = configDir.resolve("config.yaml");
        if (Files.exists(templateConfig)) {
            Files.copy(templateConfig, targetConfig);
        } else {
            Files.writeString(targetConfig, "GOOSE_PROVIDER: openai\nGOOSE_MODEL: gpt-4o\n");
        }

        // Write empty secrets.yaml
        Files.writeString(configDir.resolve("secrets.yaml"), "");

        // Write AGENTS.md
        Files.writeString(agentDir.resolve("AGENTS.md"), "# " + name + "\n");

        // Update agents.yaml on disk
        updateAgentsYaml(id, name, false);

        // Update in-memory registry
        registry.add(new AgentRegistryEntry(id, name, false));

        // Read provider/model from created config
        Map<String, Object> config = YamlLoader.load(targetConfig);
        return Map.of(
                "id", id,
                "name", name,
                "provider", config.getOrDefault("GOOSE_PROVIDER", ""),
                "model", config.getOrDefault("GOOSE_MODEL", ""));
    }

    /**
     * Delete an agent: stop instances, remove files, update registry.
     */
    public void deleteAgent(String id) throws IOException {
        AgentRegistryEntry entry = findAgent(id);
        if (entry == null) {
            throw new IllegalArgumentException("Agent '" + id + "' not found");
        }

        // Remove agent directory
        Path agentDir = getAgentsDir().resolve(id);
        if (Files.exists(agentDir)) {
            deleteRecursively(agentDir);
        }

        // Update agents.yaml
        updateAgentsYaml(id, null, true);

        // Remove from in-memory registry
        registry.removeIf(e -> e.id().equals(id));
    }

    private void updateAgentsYaml(String id, String name, boolean remove) throws IOException {
        Path agentsYaml = getGatewayRoot().resolve("config").resolve("agents.yaml");
        Map<String, Object> data = YamlLoader.load(agentsYaml);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> agents = (List<Map<String, Object>>) data.get("agents");
        if (agents == null) {
            agents = new ArrayList<>();
        }

        if (remove) {
            agents.removeIf(a -> id.equals(a.get("id")));
        } else {
            Map<String, Object> newAgent = new HashMap<>();
            newAgent.put("id", id);
            newAgent.put("name", name);
            agents.add(newAgent);
        }

        data.put("agents", agents);
        org.yaml.snakeyaml.Yaml yaml = new org.yaml.snakeyaml.Yaml();
        Files.writeString(agentsYaml, yaml.dump(data));
    }

    private void deleteRecursively(Path path) throws IOException {
        if (Files.isDirectory(path)) {
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(path)) {
                for (Path child : stream) {
                    deleteRecursively(child);
                }
            }
        }
        Files.deleteIfExists(path);
    }

    public Path getAgentsDir() {
        return getGatewayRoot().resolve(properties.getPaths().getAgentsDir());
    }

    public Path getUsersDir() {
        return getGatewayRoot().resolve(properties.getPaths().getUsersDir());
    }

    public Path getAgentConfigDir(String agentId) {
        return getAgentsDir().resolve(agentId).resolve("config");
    }

    public Path getGatewayRoot() {
        return Path.of(properties.getPaths().getProjectRoot()).toAbsolutePath().normalize()
                .resolve("gateway");
    }
}

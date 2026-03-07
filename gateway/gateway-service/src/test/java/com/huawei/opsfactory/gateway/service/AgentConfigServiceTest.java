package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class AgentConfigServiceTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    private AgentConfigService service;
    private GatewayProperties properties;
    private Path gatewayRoot;

    @Before
    public void setUp() throws IOException {
        gatewayRoot = tempFolder.getRoot().toPath().resolve("gateway");
        Files.createDirectories(gatewayRoot.resolve("config"));
        Files.createDirectories(gatewayRoot.resolve("agents"));
        Files.createDirectories(gatewayRoot.resolve("users"));

        String agentsYaml = "agents:\n  - id: test-agent\n    name: Test Agent\n  - id: kb-agent\n    name: KB Agent\n    sysOnly: true\n";
        Files.writeString(gatewayRoot.resolve("config").resolve("agents.yaml"), agentsYaml);

        properties = new GatewayProperties();
        GatewayProperties.Paths paths = new GatewayProperties.Paths();
        paths.setProjectRoot(tempFolder.getRoot().getAbsolutePath());
        properties.setPaths(paths);

        service = new AgentConfigService(properties);
        service.loadRegistry();
    }

    @Test
    public void testLoadRegistry() {
        List<AgentRegistryEntry> registry = service.getRegistry();
        assertEquals(2, registry.size());
        assertEquals("test-agent", registry.get(0).id());
        assertEquals("Test Agent", registry.get(0).name());
        assertFalse(registry.get(0).sysOnly());
        assertEquals("kb-agent", registry.get(1).id());
        assertTrue(registry.get(1).sysOnly());
    }

    @Test
    public void testFindAgent_exists() {
        AgentRegistryEntry entry = service.findAgent("test-agent");
        assertNotNull(entry);
        assertEquals("Test Agent", entry.name());
    }

    @Test
    public void testFindAgent_notFound() {
        assertNull(service.findAgent("nonexistent"));
    }

    @Test
    public void testLoadAgentConfigYaml() throws IOException {
        Path configDir = gatewayRoot.resolve("agents").resolve("test-agent").resolve("config");
        Files.createDirectories(configDir);
        Files.writeString(configDir.resolve("config.yaml"),
                "GOOSE_PROVIDER: openai\nGOOSE_MODEL: gpt-4o\n");

        Map<String, Object> config = service.loadAgentConfigYaml("test-agent");
        assertEquals("openai", config.get("GOOSE_PROVIDER"));
        assertEquals("gpt-4o", config.get("GOOSE_MODEL"));
    }

    @Test
    public void testLoadAgentConfigYaml_noFile() {
        Map<String, Object> config = service.loadAgentConfigYaml("nonexistent");
        assertTrue(config.isEmpty());
    }

    @Test
    public void testReadWriteAgentsMd() throws IOException {
        Path agentDir = gatewayRoot.resolve("agents").resolve("test-agent");
        Files.createDirectories(agentDir);
        Files.writeString(agentDir.resolve("AGENTS.md"), "# Test Agent\n");

        String md = service.readAgentsMd("test-agent");
        assertEquals("# Test Agent\n", md);

        service.writeAgentsMd("test-agent", "# Updated\nNew content\n");
        String updated = service.readAgentsMd("test-agent");
        assertEquals("# Updated\nNew content\n", updated);
    }

    @Test
    public void testReadAgentsMd_noFile() {
        String md = service.readAgentsMd("nonexistent");
        assertEquals("", md);
    }

    @Test
    public void testListSkills() throws IOException {
        Path skillsDir = gatewayRoot.resolve("agents").resolve("test-agent")
                .resolve("config").resolve("skills");
        Files.createDirectories(skillsDir.resolve("skill-a"));
        Files.createDirectories(skillsDir.resolve("skill-b"));
        Files.writeString(skillsDir.resolve("readme.txt"), "not a skill");

        List<String> skills = service.listSkills("test-agent");
        assertEquals(2, skills.size());
        assertTrue(skills.contains("skill-a"));
        assertTrue(skills.contains("skill-b"));
    }

    @Test
    public void testListSkills_noSkillsDir() {
        List<String> skills = service.listSkills("nonexistent");
        assertTrue(skills.isEmpty());
    }

    @Test
    public void testCreateAgent() throws IOException {
        Path templateDir = gatewayRoot.resolve("agents").resolve("universal-agent").resolve("config");
        Files.createDirectories(templateDir);
        Files.writeString(templateDir.resolve("config.yaml"),
                "GOOSE_PROVIDER: anthropic\nGOOSE_MODEL: claude-3\n");

        Map<String, Object> result = service.createAgent("new-agent", "New Agent");
        assertEquals("new-agent", result.get("id"));
        assertEquals("New Agent", result.get("name"));
        assertEquals("anthropic", result.get("provider"));

        assertNotNull(service.findAgent("new-agent"));

        assertTrue(Files.exists(gatewayRoot.resolve("agents").resolve("new-agent").resolve("AGENTS.md")));
        assertTrue(Files.exists(gatewayRoot.resolve("agents").resolve("new-agent").resolve("config").resolve("config.yaml")));
        assertTrue(Files.exists(gatewayRoot.resolve("agents").resolve("new-agent").resolve("config").resolve("secrets.yaml")));
    }

    @Test(expected = IllegalArgumentException.class)
    public void testCreateAgent_duplicateId() throws IOException {
        service.createAgent("test-agent", "Duplicate");
    }

    @Test(expected = IllegalArgumentException.class)
    public void testCreateAgent_invalidId() throws IOException {
        service.createAgent("INVALID!", "Bad ID");
    }

    @Test
    public void testDeleteAgent() throws IOException {
        Path agentDir = gatewayRoot.resolve("agents").resolve("test-agent");
        Files.createDirectories(agentDir.resolve("config"));
        Files.writeString(agentDir.resolve("AGENTS.md"), "# Test\n");

        service.deleteAgent("test-agent");

        assertNull(service.findAgent("test-agent"));
        assertFalse(Files.exists(agentDir));
    }

    @Test(expected = IllegalArgumentException.class)
    public void testDeleteAgent_notFound() throws IOException {
        service.deleteAgent("nonexistent");
    }

    @Test
    public void testLoadAgentSecretsYaml() throws IOException {
        Path configDir = gatewayRoot.resolve("agents").resolve("test-agent").resolve("config");
        Files.createDirectories(configDir);
        Files.writeString(configDir.resolve("secrets.yaml"),
                "OPENAI_API_KEY: sk-test123\nANTHROPIC_KEY: ak-test456\n");

        Map<String, Object> secrets = service.loadAgentSecretsYaml("test-agent");
        assertEquals("sk-test123", secrets.get("OPENAI_API_KEY"));
        assertEquals("ak-test456", secrets.get("ANTHROPIC_KEY"));
    }

    @Test
    public void testLoadAgentSecretsYaml_noFile() {
        Map<String, Object> secrets = service.loadAgentSecretsYaml("nonexistent");
        assertTrue(secrets.isEmpty());
    }

    @Test(expected = IllegalArgumentException.class)
    public void testCreateAgent_duplicateName() throws IOException {
        service.createAgent("another-agent", "Test Agent");
    }

    @Test
    public void testCreateAgent_noTemplate() throws IOException {
        Map<String, Object> result = service.createAgent("new-agent", "New Agent");
        assertEquals("new-agent", result.get("id"));
        assertEquals("New Agent", result.get("name"));
        assertEquals("openai", result.get("provider"));
    }

    @Test
    public void testGettersResolveCorrectPaths() {
        Path agentsDir = service.getAgentsDir();
        assertTrue(agentsDir.toString().endsWith("gateway/agents"));

        Path usersDir = service.getUsersDir();
        assertTrue(usersDir.toString().endsWith("gateway/users"));
    }

    @Test
    public void testGetAgentConfigDir() {
        Path configDir = service.getAgentConfigDir("test-agent");
        assertTrue(configDir.toString().endsWith("agents/test-agent/config"));
    }

    @Test
    public void testDeleteAgent_removesFromYaml() throws IOException {
        Path agentDir = gatewayRoot.resolve("agents").resolve("test-agent");
        Files.createDirectories(agentDir.resolve("config"));
        Files.writeString(agentDir.resolve("AGENTS.md"), "# Test\n");

        int sizeBefore = service.getRegistry().size();
        service.deleteAgent("test-agent");
        assertEquals(sizeBefore - 1, service.getRegistry().size());

        AgentConfigService freshService = new AgentConfigService(properties);
        freshService.loadRegistry();
        assertNull(freshService.findAgent("test-agent"));
    }

    @Test
    public void testRegistryIsUnmodifiable() {
        List<AgentRegistryEntry> registry = service.getRegistry();
        try {
            registry.add(new AgentRegistryEntry("illegal", "Illegal", false));
        } catch (UnsupportedOperationException e) {
            // Expected
        }
    }

    @Test
    public void testCreateAgent_updatesAgentsYaml() throws IOException {
        Path templateDir = gatewayRoot.resolve("agents").resolve("universal-agent").resolve("config");
        Files.createDirectories(templateDir);
        Files.writeString(templateDir.resolve("config.yaml"),
                "GOOSE_PROVIDER: anthropic\nGOOSE_MODEL: claude-3\n");

        service.createAgent("created-agent", "Created Agent");

        AgentConfigService freshService = new AgentConfigService(properties);
        freshService.loadRegistry();
        assertNotNull(freshService.findAgent("created-agent"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void testCreateAgent_singleCharId() throws IOException {
        service.createAgent("a", "Single Char");
    }

    @Test
    public void testCreateAgent_skillsDirectoryCreated() throws IOException {
        service.createAgent("new-agent", "New Agent");
        Path skillsDir = gatewayRoot.resolve("agents").resolve("new-agent")
                .resolve("config").resolve("skills");
        assertTrue(Files.isDirectory(skillsDir));
    }

    @Test
    public void testLoadRegistry_emptyAgentsYaml() throws IOException {
        Files.writeString(gatewayRoot.resolve("config").resolve("agents.yaml"), "");
        AgentConfigService freshService = new AgentConfigService(properties);
        freshService.loadRegistry();
        assertTrue(freshService.getRegistry().isEmpty());
    }

    @Test
    public void testLoadRegistry_noAgentsKey() throws IOException {
        Files.writeString(gatewayRoot.resolve("config").resolve("agents.yaml"), "other: value\n");
        AgentConfigService freshService = new AgentConfigService(properties);
        freshService.loadRegistry();
        assertTrue(freshService.getRegistry().isEmpty());
    }
}

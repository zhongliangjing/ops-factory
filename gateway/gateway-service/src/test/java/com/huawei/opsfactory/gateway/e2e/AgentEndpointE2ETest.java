package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry;
import org.junit.Test;
import org.springframework.http.MediaType;

import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * E2E tests for AgentController endpoints.
 * Tests the full HTTP pipeline: AuthWebFilter → UserContextFilter → AgentController.
 */
public class AgentEndpointE2ETest extends BaseE2ETest {

    // ====================== GET /agents ======================

    @Test
    public void listAgents_authenticated_returnsAgentList() {
        when(agentConfigService.getRegistry()).thenReturn(List.of(
                new AgentRegistryEntry("universal-agent", "Universal Agent", false),
                new AgentRegistryEntry("kb-agent", "Knowledge Base Agent", true)));
        when(agentConfigService.loadAgentConfigYaml("universal-agent"))
                .thenReturn(Map.of("GOOSE_PROVIDER", "openai", "GOOSE_MODEL", "gpt-4o"));
        when(agentConfigService.loadAgentConfigYaml("kb-agent"))
                .thenReturn(Map.of("GOOSE_PROVIDER", "anthropic", "GOOSE_MODEL", "claude-3"));
        when(agentConfigService.listSkills("universal-agent")).thenReturn(List.of("brainstorming"));
        when(agentConfigService.listSkills("kb-agent")).thenReturn(Collections.emptyList());

        webClient.get().uri("/agents")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agents").isArray()
                .jsonPath("$.agents.length()").isEqualTo(2)
                .jsonPath("$.agents[0].id").isEqualTo("universal-agent")
                .jsonPath("$.agents[0].name").isEqualTo("Universal Agent")
                .jsonPath("$.agents[0].sysOnly").isEqualTo(false)
                .jsonPath("$.agents[0].provider").isEqualTo("openai")
                .jsonPath("$.agents[0].model").isEqualTo("gpt-4o")
                .jsonPath("$.agents[0].skills.length()").isEqualTo(1)
                .jsonPath("$.agents[1].id").isEqualTo("kb-agent")
                .jsonPath("$.agents[1].sysOnly").isEqualTo(true);
    }

    @Test
    public void listAgents_emptyRegistry_returnsEmptyArray() {
        when(agentConfigService.getRegistry()).thenReturn(Collections.emptyList());

        webClient.get().uri("/agents")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agents").isArray()
                .jsonPath("$.agents.length()").isEqualTo(0);
    }

    @Test
    public void listAgents_unauthenticated_returns401() {
        webClient.get().uri("/agents")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void listAgents_regularUser_canAccess() {
        when(agentConfigService.getRegistry()).thenReturn(Collections.emptyList());

        webClient.get().uri("/agents")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agents").isArray();
    }

    // ====================== POST /agents (Create) ======================

    @Test
    public void createAgent_admin_success() throws Exception {
        when(agentConfigService.createAgent("test-agent", "Test Agent")).thenReturn(
                Map.of("id", "test-agent", "name", "Test Agent",
                        "provider", "openai", "model", "gpt-4o"));

        webClient.post().uri("/agents")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\":\"test-agent\",\"name\":\"Test Agent\"}")
                .exchange()
                .expectStatus().isCreated()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true)
                .jsonPath("$.agent.id").isEqualTo("test-agent")
                .jsonPath("$.agent.name").isEqualTo("Test Agent");
    }

    @Test
    public void createAgent_nonAdmin_returns403() {
        webClient.post().uri("/agents")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\":\"test\",\"name\":\"Test\"}")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void createAgent_missingId_returns400() {
        webClient.post().uri("/agents")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"Test Agent\"}")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void createAgent_blankId_returns400() {
        webClient.post().uri("/agents")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\":\"  \",\"name\":\"Test Agent\"}")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void createAgent_missingName_returns400() {
        webClient.post().uri("/agents")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\":\"test-agent\"}")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void createAgent_duplicateId_returns400() throws Exception {
        when(agentConfigService.createAgent(anyString(), anyString()))
                .thenThrow(new IllegalArgumentException("Agent with ID 'test-agent' already exists"));

        webClient.post().uri("/agents")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\":\"test-agent\",\"name\":\"Test Agent\"}")
                .exchange()
                .expectStatus().isBadRequest();
    }

    // ====================== DELETE /agents/{id} ======================

    @Test
    public void deleteAgent_admin_success() throws Exception {
        doNothing().when(instanceManager).stopAllForAgent("test-agent");
        doNothing().when(agentConfigService).deleteAgent("test-agent");

        webClient.delete().uri("/agents/test-agent")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true);

        verify(instanceManager).stopAllForAgent("test-agent");
        verify(agentConfigService).deleteAgent("test-agent");
    }

    @Test
    public void deleteAgent_nonAdmin_returns403() {
        webClient.delete().uri("/agents/test-agent")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void deleteAgent_notFound_returns400() throws Exception {
        doThrow(new IllegalArgumentException("Agent 'nonexistent' not found"))
                .when(agentConfigService).deleteAgent("nonexistent");

        webClient.delete().uri("/agents/nonexistent")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isBadRequest();
    }

    // ====================== GET /agents/{id}/skills ======================

    @Test
    public void listSkills_admin_returnsSkillsList() {
        when(agentConfigService.listSkills("universal-agent"))
                .thenReturn(List.of("brainstorming", "coding"));

        webClient.get().uri("/agents/universal-agent/skills")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.skills.length()").isEqualTo(2)
                .jsonPath("$.skills[0]").isEqualTo("brainstorming")
                .jsonPath("$.skills[1]").isEqualTo("coding");
    }

    @Test
    public void listSkills_nonAdmin_returns403() {
        webClient.get().uri("/agents/universal-agent/skills")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    // ====================== GET /agents/{id}/config ======================

    @Test
    public void getConfig_admin_returnsAgentConfig() {
        when(agentConfigService.findAgent("universal-agent"))
                .thenReturn(new AgentRegistryEntry("universal-agent", "Universal Agent", false));
        when(agentConfigService.loadAgentConfigYaml("universal-agent"))
                .thenReturn(Map.of("GOOSE_PROVIDER", "openai", "GOOSE_MODEL", "gpt-4o"));
        when(agentConfigService.readAgentsMd("universal-agent"))
                .thenReturn("# Universal Agent\nA general purpose agent.");
        when(agentConfigService.getAgentsDir()).thenReturn(Path.of("/tmp/agents"));

        webClient.get().uri("/agents/universal-agent/config")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agentsMd").isEqualTo("# Universal Agent\nA general purpose agent.")
                .jsonPath("$.provider").isEqualTo("openai")
                .jsonPath("$.model").isEqualTo("gpt-4o");
    }

    @Test
    public void getConfig_nonAdmin_returns403() {
        webClient.get().uri("/agents/universal-agent/config")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void getConfig_missingProviderModel_returnsEmptyStrings() {
        when(agentConfigService.findAgent("minimal-agent"))
                .thenReturn(new AgentRegistryEntry("minimal-agent", "Minimal Agent", false));
        when(agentConfigService.loadAgentConfigYaml("minimal-agent"))
                .thenReturn(Collections.emptyMap());
        when(agentConfigService.readAgentsMd("minimal-agent")).thenReturn("");
        when(agentConfigService.getAgentsDir()).thenReturn(Path.of("/tmp/agents"));

        webClient.get().uri("/agents/minimal-agent/config")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agentsMd").isEqualTo("")
                .jsonPath("$.provider").isEqualTo("")
                .jsonPath("$.model").isEqualTo("");
    }

    // ====================== PUT /agents/{id}/config ======================

    @Test
    public void updateConfig_admin_success() throws Exception {
        when(agentConfigService.findAgent("universal-agent"))
                .thenReturn(new AgentRegistryEntry("universal-agent", "Universal Agent", false));
        doNothing().when(agentConfigService).writeAgentsMd(eq("universal-agent"), anyString());

        webClient.put().uri("/agents/universal-agent/config")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"agentsMd\":\"# Updated content\"}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true);

        verify(agentConfigService).writeAgentsMd("universal-agent", "# Updated content");
    }

    @Test
    public void updateConfig_nonAdmin_returns403() {
        webClient.put().uri("/agents/universal-agent/config")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"agentsMd\":\"hacked\"}")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void updateConfig_nullAgentsMd_stillReturnsUpdated() {
        when(agentConfigService.findAgent("universal-agent"))
                .thenReturn(new AgentRegistryEntry("universal-agent", "Universal Agent", false));

        webClient.put().uri("/agents/universal-agent/config")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"other\":\"field\"}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true);
    }
}

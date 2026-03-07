package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.AuthWebFilter;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@RunWith(SpringRunner.class)
@WebFluxTest(AgentController.class)
@Import({GatewayProperties.class, AuthWebFilter.class, UserContextFilter.class})
public class AgentControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private AgentConfigService agentConfigService;

    @MockBean
    private InstanceManager instanceManager;

    @Test
    public void testListAgents() {
        when(agentConfigService.getRegistry()).thenReturn(List.of(
                new AgentRegistryEntry("agent1", "Agent One", false),
                new AgentRegistryEntry("agent2", "Agent Two", true)
        ));
        when(agentConfigService.loadAgentConfigYaml("agent1"))
                .thenReturn(Map.of("GOOSE_PROVIDER", "openai", "GOOSE_MODEL", "gpt-4o"));
        when(agentConfigService.loadAgentConfigYaml("agent2"))
                .thenReturn(Map.of("GOOSE_PROVIDER", "anthropic", "GOOSE_MODEL", "claude-3"));
        when(agentConfigService.listSkills("agent1")).thenReturn(List.of("brainstorming"));
        when(agentConfigService.listSkills("agent2")).thenReturn(Collections.emptyList());

        webTestClient.get().uri("/agents")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agents[0].id").isEqualTo("agent1")
                .jsonPath("$.agents[0].name").isEqualTo("Agent One")
                .jsonPath("$.agents[0].sysOnly").isEqualTo(false)
                .jsonPath("$.agents[0].provider").isEqualTo("openai")
                .jsonPath("$.agents[0].skills.length()").isEqualTo(1)
                .jsonPath("$.agents[1].id").isEqualTo("agent2")
                .jsonPath("$.agents[1].sysOnly").isEqualTo(true);
    }

    @Test
    public void testListAgents_empty() {
        when(agentConfigService.getRegistry()).thenReturn(List.of());

        webTestClient.get().uri("/agents")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agents.length()").isEqualTo(0);
    }

    @Test
    public void testCreateAgent_asAdmin() throws Exception {
        Map<String, Object> agent = new HashMap<>();
        agent.put("id", "new-agent");
        agent.put("name", "New Agent");
        agent.put("provider", "openai");
        agent.put("model", "gpt-4o");
        when(agentConfigService.createAgent(eq("new-agent"), eq("New Agent"))).thenReturn(agent);

        webTestClient.post().uri("/agents")
                .header("x-secret-key", "test")
                // sys user = admin by default
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\": \"new-agent\", \"name\": \"New Agent\"}")
                .exchange()
                .expectStatus().isCreated()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true)
                .jsonPath("$.agent.id").isEqualTo("new-agent");
    }

    @Test
    public void testCreateAgent_nonAdminForbidden() {
        webTestClient.post().uri("/agents")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\": \"new-agent\", \"name\": \"New Agent\"}")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testCreateAgent_missingId() {
        webTestClient.post().uri("/agents")
                .header("x-secret-key", "test")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\": \"New Agent\"}")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void testDeleteAgent_asAdmin() throws Exception {
        Mockito.doNothing().when(instanceManager).stopAllForAgent("agent1");
        Mockito.doNothing().when(agentConfigService).deleteAgent("agent1");

        webTestClient.delete().uri("/agents/agent1")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true);
    }

    @Test
    public void testDeleteAgent_nonAdminForbidden() {
        webTestClient.delete().uri("/agents/agent1")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testGetSkills_asAdmin() {
        when(agentConfigService.listSkills("agent1")).thenReturn(
                List.of("brainstorming", "analysis"));

        webTestClient.get().uri("/agents/agent1/skills")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.skills[0]").isEqualTo("brainstorming")
                .jsonPath("$.skills[1]").isEqualTo("analysis");
    }

    @Test
    public void testGetConfig_asAdmin() {
        when(agentConfigService.findAgent("agent1"))
                .thenReturn(new AgentRegistryEntry("agent1", "Agent One", false));
        when(agentConfigService.readAgentsMd("agent1")).thenReturn("# Agent One\n");
        Map<String, Object> config = new HashMap<>();
        config.put("GOOSE_PROVIDER", "anthropic");
        config.put("GOOSE_MODEL", "claude-3");
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(config);
        when(agentConfigService.getAgentsDir()).thenReturn(java.nio.file.Path.of("/tmp/agents"));

        webTestClient.get().uri("/agents/agent1/config")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agentsMd").isEqualTo("# Agent One\n")
                .jsonPath("$.provider").isEqualTo("anthropic")
                .jsonPath("$.model").isEqualTo("claude-3");
    }

    @Test
    public void testUpdateConfig_asAdmin() throws Exception {
        when(agentConfigService.findAgent("agent1"))
                .thenReturn(new AgentRegistryEntry("agent1", "Agent One", false));
        Mockito.doNothing().when(agentConfigService).writeAgentsMd("agent1", "# Updated\n");

        webTestClient.put().uri("/agents/agent1/config")
                .header("x-secret-key", "test")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"agentsMd\": \"# Updated\\n\"}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true);
    }

    @Test
    public void testUpdateConfig_nonAdminForbidden() {
        webTestClient.put().uri("/agents/agent1/config")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"agentsMd\": \"# Updated\"}")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testCreateAgent_missingName() {
        webTestClient.post().uri("/agents")
                .header("x-secret-key", "test")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\": \"new-agent\"}")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void testCreateAgent_blankId() {
        webTestClient.post().uri("/agents")
                .header("x-secret-key", "test")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\": \"   \", \"name\": \"New Agent\"}")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void testCreateAgent_duplicateReturns400() throws Exception {
        when(agentConfigService.createAgent(eq("dup-agent"), eq("Dup Agent")))
                .thenThrow(new IllegalArgumentException("Agent already exists"));

        webTestClient.post().uri("/agents")
                .header("x-secret-key", "test")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"id\": \"dup-agent\", \"name\": \"Dup Agent\"}")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void testGetSkills_nonAdminForbidden() {
        webTestClient.get().uri("/agents/agent1/skills")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testGetConfig_nonAdminForbidden() {
        webTestClient.get().uri("/agents/agent1/config")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testListAgents_noAuthRequired() {
        // listAgents does not require admin, just auth
        when(agentConfigService.getRegistry()).thenReturn(List.of());

        webTestClient.get().uri("/agents")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agents").isArray();
    }
}

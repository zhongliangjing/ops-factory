package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.AuthWebFilter;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import com.huawei.opsfactory.gateway.service.LangfuseService;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.util.List;

import static org.mockito.Mockito.when;

@RunWith(SpringRunner.class)
@WebFluxTest(MonitoringController.class)
@Import({GatewayProperties.class, AuthWebFilter.class, UserContextFilter.class})
public class MonitoringControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private InstanceManager instanceManager;

    @MockBean
    private AgentConfigService agentConfigService;

    @MockBean
    private LangfuseService langfuseService;

    @Test
    public void testSystem_asAdmin() {
        when(agentConfigService.getRegistry()).thenReturn(List.of());
        when(instanceManager.getAllInstances()).thenReturn(List.of());

        webTestClient.get().uri("/monitoring/system")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.gateway.uptimeMs").isNumber()
                .jsonPath("$.gateway.host").isNotEmpty()
                .jsonPath("$.gateway.port").isNumber()
                .jsonPath("$.agents.configured").isEqualTo(0)
                .jsonPath("$.idle.timeoutMs").isNumber();
    }

    @Test
    public void testSystem_nonAdminForbidden() {
        webTestClient.get().uri("/monitoring/system")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testInstances() {
        ManagedInstance inst = new ManagedInstance("agent1", "user1", 9090, 5678L, null);
        inst.setStatus(ManagedInstance.Status.RUNNING);
        when(instanceManager.getAllInstances()).thenReturn(List.of(inst));

        webTestClient.get().uri("/monitoring/instances")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(1)
                .jsonPath("$.runningInstances").isEqualTo(1)
                .jsonPath("$.byAgent[0].agentId").isEqualTo("agent1")
                .jsonPath("$.byAgent[0].instances[0].userId").isEqualTo("user1")
                .jsonPath("$.byAgent[0].instances[0].port").isEqualTo(9090)
                .jsonPath("$.byAgent[0].instances[0].status").isEqualTo("running");
    }

    @Test
    public void testLangfuseStatus() {
        when(langfuseService.isConfigured()).thenReturn(true);

        webTestClient.get().uri("/monitoring/status")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.enabled").isEqualTo(true);
    }

    @Test
    public void testInstances_nonAdminForbidden() {
        webTestClient.get().uri("/monitoring/instances")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testLangfuseStatus_nonAdminForbidden() {
        webTestClient.get().uri("/monitoring/status")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testInstances_empty() {
        when(instanceManager.getAllInstances()).thenReturn(List.of());

        webTestClient.get().uri("/monitoring/instances")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(0)
                .jsonPath("$.runningInstances").isEqualTo(0)
                .jsonPath("$.byAgent.length()").isEqualTo(0);
    }

    @Test
    public void testInstances_multipleInstances() {
        ManagedInstance inst1 = new ManagedInstance("agent1", "user1", 9090, 5678L, null);
        inst1.setStatus(ManagedInstance.Status.RUNNING);
        ManagedInstance inst2 = new ManagedInstance("agent2", "user2", 9091, 5679L, null);
        inst2.setStatus(ManagedInstance.Status.STOPPED);
        when(instanceManager.getAllInstances()).thenReturn(List.of(inst1, inst2));

        webTestClient.get().uri("/monitoring/instances")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(2)
                .jsonPath("$.runningInstances").isEqualTo(1)
                .jsonPath("$.byAgent.length()").isEqualTo(2);
    }

    @Test
    public void testLangfuseStatus_notConfigured() {
        when(langfuseService.isConfigured()).thenReturn(false);

        webTestClient.get().uri("/monitoring/status")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.enabled").isEqualTo(false);
    }

    @Test
    public void testSystem_withData() {
        when(agentConfigService.getRegistry()).thenReturn(List.of(
                new com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry("a1", "Agent1", false),
                new com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry("a2", "Agent2", true)
        ));
        ManagedInstance inst = new ManagedInstance("a1", "u1", 8080, 1234L, null);
        when(instanceManager.getAllInstances()).thenReturn(List.of(inst));

        webTestClient.get().uri("/monitoring/system")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agents.configured").isEqualTo(2)
                .jsonPath("$.gateway.uptimeMs").isNumber()
                .jsonPath("$.idle.timeoutMs").isNumber();
    }
}

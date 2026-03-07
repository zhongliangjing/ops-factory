package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import org.junit.Test;
import reactor.core.publisher.Mono;

import java.util.Collections;
import java.util.List;

import static org.mockito.Mockito.when;

/**
 * E2E tests for MonitoringController endpoints:
 * GET /monitoring/system
 * GET /monitoring/instances
 * GET /monitoring/status
 * GET /monitoring/traces
 * GET /monitoring/observations
 */
public class MonitoringEndpointE2ETest extends BaseE2ETest {

    // ====================== GET /monitoring/system ======================

    @Test
    public void system_admin_returnsSystemInfo() {
        when(agentConfigService.getRegistry()).thenReturn(List.of(
                new AgentRegistryEntry("agent-a", "Agent A", false)));
        when(instanceManager.getAllInstances()).thenReturn(Collections.emptyList());

        webClient.get().uri("/monitoring/system")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.gateway.uptimeMs").isNumber()
                .jsonPath("$.gateway.host").isNotEmpty()
                .jsonPath("$.gateway.port").isNumber()
                .jsonPath("$.agents.configured").isEqualTo(1)
                .jsonPath("$.idle.timeoutMs").isNumber();
    }

    @Test
    public void system_nonAdmin_returns403() {
        webClient.get().uri("/monitoring/system")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void system_unauthenticated_returns401() {
        webClient.get().uri("/monitoring/system")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== GET /monitoring/instances ======================

    @Test
    public void instances_admin_returnsInstanceList() {
        ManagedInstance inst = new ManagedInstance("agent-a", "alice", 9001, 54321L, null);
        inst.setStatus(ManagedInstance.Status.RUNNING);
        when(instanceManager.getAllInstances()).thenReturn(List.of(inst));

        webClient.get().uri("/monitoring/instances")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(1)
                .jsonPath("$.runningInstances").isEqualTo(1)
                .jsonPath("$.byAgent.length()").isEqualTo(1)
                .jsonPath("$.byAgent[0].agentId").isEqualTo("agent-a")
                .jsonPath("$.byAgent[0].instances[0].userId").isEqualTo("alice")
                .jsonPath("$.byAgent[0].instances[0].port").isEqualTo(9001)
                .jsonPath("$.byAgent[0].instances[0].pid").isEqualTo(54321)
                .jsonPath("$.byAgent[0].instances[0].status").isEqualTo("running")
                .jsonPath("$.byAgent[0].instances[0].lastActivity").isNumber();
    }

    @Test
    public void instances_emptyList_returnsEmptyResult() {
        when(instanceManager.getAllInstances()).thenReturn(Collections.emptyList());

        webClient.get().uri("/monitoring/instances")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(0)
                .jsonPath("$.runningInstances").isEqualTo(0)
                .jsonPath("$.byAgent.length()").isEqualTo(0);
    }

    @Test
    public void instances_nonAdmin_returns403() {
        webClient.get().uri("/monitoring/instances")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void instances_multipleInstances_groupedByAgent() {
        ManagedInstance inst1 = new ManagedInstance("agent-a", "alice", 9001, 111L, null);
        inst1.setStatus(ManagedInstance.Status.RUNNING);
        ManagedInstance inst2 = new ManagedInstance("agent-b", "bob", 9002, 222L, null);
        inst2.setStatus(ManagedInstance.Status.STOPPED);
        ManagedInstance inst3 = new ManagedInstance("agent-a", "sys", 9003, 333L, null);
        inst3.setStatus(ManagedInstance.Status.STARTING);

        when(instanceManager.getAllInstances()).thenReturn(List.of(inst1, inst2, inst3));

        webClient.get().uri("/monitoring/instances")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(3)
                .jsonPath("$.runningInstances").isEqualTo(1)
                .jsonPath("$.byAgent.length()").isEqualTo(2);
    }

    // ====================== GET /monitoring/status (Langfuse) ======================

    @Test
    public void langfuseStatus_configured_returnsTrue() {
        when(langfuseService.isConfigured()).thenReturn(true);

        webClient.get().uri("/monitoring/status")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.enabled").isEqualTo(true);
    }

    @Test
    public void langfuseStatus_notConfigured_returnsFalse() {
        when(langfuseService.isConfigured()).thenReturn(false);

        webClient.get().uri("/monitoring/status")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.enabled").isEqualTo(false);
    }

    @Test
    public void langfuseStatus_nonAdmin_returns403() {
        webClient.get().uri("/monitoring/status")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    // ====================== GET /monitoring/traces ======================

    @Test
    public void traces_admin_returnsTraceData() {
        when(langfuseService.getTraces("2024-01-01", "2024-01-02", 20, false))
                .thenReturn(Mono.just("[{\"traceId\":\"t1\"}]"));

        webClient.get().uri("/monitoring/traces?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("[{\"traceId\":\"t1\"}]");
    }

    @Test
    public void traces_customLimitAndErrorsOnly() {
        when(langfuseService.getTraces("2024-01-01", "2024-01-02", 5, true))
                .thenReturn(Mono.just("[{\"error\":true}]"));

        webClient.get().uri("/monitoring/traces?from=2024-01-01&to=2024-01-02&limit=5&errorsOnly=true")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("[{\"error\":true}]");
    }

    @Test
    public void traces_nonAdmin_returns403() {
        webClient.get().uri("/monitoring/traces?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    // ====================== GET /monitoring/observations ======================

    @Test
    public void observations_admin_returnsData() {
        when(langfuseService.getObservations("2024-01-01", "2024-01-02"))
                .thenReturn(Mono.just("[{\"observationId\":\"o1\"}]"));

        webClient.get().uri("/monitoring/observations?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("[{\"observationId\":\"o1\"}]");
    }

    @Test
    public void observations_nonAdmin_returns403() {
        webClient.get().uri("/monitoring/observations?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isForbidden();
    }
}

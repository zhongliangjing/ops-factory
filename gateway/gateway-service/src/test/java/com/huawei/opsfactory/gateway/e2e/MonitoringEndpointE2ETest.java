package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.monitoring.MetricsSnapshot;
import org.junit.Test;
import reactor.core.publisher.Mono;

import java.util.Collections;
import java.util.List;
import java.util.Map;

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
                new AgentRegistryEntry("agent-a", "Agent A")));
        when(instanceManager.getAllInstances()).thenReturn(Collections.emptyList());

        webClient.get().uri("/gateway/monitoring/system")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
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
        webClient.get().uri("/gateway/monitoring/system")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void system_unauthenticated_returns401() {
        webClient.get().uri("/gateway/monitoring/system")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== GET /monitoring/instances ======================

    @Test
    public void instances_admin_returnsInstanceList() {
        ManagedInstance inst = new ManagedInstance("agent-a", "alice", 9001, 54321L, null, "test-secret");
        inst.setStatus(ManagedInstance.Status.RUNNING);
        when(instanceManager.getAllInstances()).thenReturn(List.of(inst));
        when(agentConfigService.findAgent("agent-a")).thenReturn(
                new AgentRegistryEntry("agent-a", "Agent A"));

        webClient.get().uri("/gateway/monitoring/instances")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(1)
                .jsonPath("$.runningInstances").isEqualTo(1)
                .jsonPath("$.byAgent.length()").isEqualTo(1)
                .jsonPath("$.byAgent[0].agentId").isEqualTo("agent-a")
                .jsonPath("$.byAgent[0].agentName").isEqualTo("Agent A")
                .jsonPath("$.byAgent[0].instances[0].userId").isEqualTo("alice")
                .jsonPath("$.byAgent[0].instances[0].port").isEqualTo(9001)
                .jsonPath("$.byAgent[0].instances[0].pid").isEqualTo(54321)
                .jsonPath("$.byAgent[0].instances[0].status").isEqualTo("running")
                .jsonPath("$.byAgent[0].instances[0].lastActivity").isNumber()
                .jsonPath("$.byAgent[0].instances[0].idleSinceMs").isNumber();
    }

    @Test
    public void instances_emptyList_returnsEmptyResult() {
        when(instanceManager.getAllInstances()).thenReturn(Collections.emptyList());

        webClient.get().uri("/gateway/monitoring/instances")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(0)
                .jsonPath("$.runningInstances").isEqualTo(0)
                .jsonPath("$.byAgent.length()").isEqualTo(0);
    }

    @Test
    public void instances_nonAdmin_returns403() {
        webClient.get().uri("/gateway/monitoring/instances")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void instances_multipleInstances_groupedByAgent() {
        ManagedInstance inst1 = new ManagedInstance("agent-a", "alice", 9001, 111L, null, "test-secret");
        inst1.setStatus(ManagedInstance.Status.RUNNING);
        ManagedInstance inst2 = new ManagedInstance("agent-b", "bob", 9002, 222L, null, "test-secret");
        inst2.setStatus(ManagedInstance.Status.STOPPED);
        ManagedInstance inst3 = new ManagedInstance("agent-a", "admin", 9003, 333L, null, "test-secret");
        inst3.setStatus(ManagedInstance.Status.STARTING);

        when(instanceManager.getAllInstances()).thenReturn(List.of(inst1, inst2, inst3));

        webClient.get().uri("/gateway/monitoring/instances")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
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
        when(langfuseService.checkReachable()).thenReturn(Mono.just(true));

        webClient.get().uri("/gateway/monitoring/status")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.enabled").isEqualTo(true)
                .jsonPath("$.reachable").isEqualTo(true)
                .jsonPath("$.host").exists();
    }

    @Test
    public void langfuseStatus_notConfigured_returnsFalse() {
        when(langfuseService.isConfigured()).thenReturn(false);

        webClient.get().uri("/gateway/monitoring/status")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.enabled").isEqualTo(false);
    }

    @Test
    public void langfuseStatus_nonAdmin_returns403() {
        webClient.get().uri("/gateway/monitoring/status")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    // ====================== GET /monitoring/overview ======================

    @Test
    public void overview_admin_returnsOverviewData() {
        when(langfuseService.getOverview("2024-01-01", "2024-01-02")).thenReturn(Mono.just(Map.of(
                "totalTraces", 5,
                "totalObservations", 10,
                "totalCost", 0.25,
                "avgLatency", 1.0,
                "p95Latency", 2.5,
                "errorCount", 0,
                "daily", List.of()
        )));

        webClient.get().uri("/gateway/monitoring/overview?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalTraces").isEqualTo(5)
                .jsonPath("$.totalObservations").isEqualTo(10)
                .jsonPath("$.errorCount").isEqualTo(0);
    }

    @Test
    public void overview_nonAdmin_returns403() {
        webClient.get().uri("/gateway/monitoring/overview?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    // ====================== GET /monitoring/traces ======================

    @Test
    public void traces_admin_returnsTraceData() {
        when(langfuseService.getTracesFormatted("2024-01-01", "2024-01-02", 20, false))
                .thenReturn(Mono.just(List.of(Map.of(
                        "id", "t1", "name", "test", "timestamp", "2024-01-01T00:00:00Z",
                        "input", "hello", "latency", 1.0, "totalCost", 0.01,
                        "observationCount", 2, "hasError", false
                ))));

        webClient.get().uri("/gateway/monitoring/traces?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$[0].id").isEqualTo("t1")
                .jsonPath("$[0].name").isEqualTo("test");
    }

    @Test
    public void traces_customLimitAndErrorsOnly() {
        when(langfuseService.getTracesFormatted("2024-01-01", "2024-01-02", 5, true))
                .thenReturn(Mono.just(List.of(Map.of(
                        "id", "t2", "name", "error-trace", "hasError", true
                ))));

        webClient.get().uri("/gateway/monitoring/traces?from=2024-01-01&to=2024-01-02&limit=5&errorsOnly=true")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$[0].hasError").isEqualTo(true);
    }

    @Test
    public void traces_nonAdmin_returns403() {
        webClient.get().uri("/gateway/monitoring/traces?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    // ====================== GET /monitoring/observations ======================

    @Test
    public void observations_admin_returnsData() {
        when(langfuseService.getObservationsFormatted("2024-01-01", "2024-01-02"))
                .thenReturn(Mono.just(Map.of("observations", List.of(
                        Map.of("name", "generation", "count", 5, "avgLatency", 1.0,
                                "p95Latency", 2.0, "totalTokens", 100, "totalCost", 0.05)
                ))));

        webClient.get().uri("/gateway/monitoring/observations?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.observations[0].name").isEqualTo("generation")
                .jsonPath("$.observations[0].count").isEqualTo(5);
    }

    @Test
    public void observations_nonAdmin_returns403() {
        webClient.get().uri("/gateway/monitoring/observations?from=2024-01-01&to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isForbidden();
    }

    // ====================== GET /monitoring/metrics ======================

    @Test
    public void metrics_admin_returnsMetricsData() {
        MetricsSnapshot s = new MetricsSnapshot();
        s.setTimestamp(1000L);
        s.setActiveInstances(2);
        s.setTotalTokens(5000);
        s.setTotalSessions(3);
        s.setRequestCount(4);
        s.setAvgLatencyMs(2500.0);
        s.setAvgTtftMs(800.0);
        s.setP95LatencyMs(4000.0);
        s.setP95TtftMs(1500.0);
        s.setTotalBytes(15000);
        s.setErrorCount(1);

        when(metricsBuffer.getSnapshots(120)).thenReturn(List.of(s));

        webClient.get().uri("/gateway/monitoring/metrics")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.collectionIntervalSec").isEqualTo(30)
                .jsonPath("$.maxSlots").isEqualTo(120)
                .jsonPath("$.returnedSlots").isEqualTo(1)
                .jsonPath("$.current.activeInstances").isEqualTo(2)
                .jsonPath("$.current.totalTokens").isEqualTo(5000)
                .jsonPath("$.current.totalSessions").isEqualTo(3)
                .jsonPath("$.aggregate.totalRequests").isEqualTo(4)
                .jsonPath("$.aggregate.totalErrors").isEqualTo(1)
                .jsonPath("$.aggregate.avgLatencyMs").isEqualTo(2500.0)
                .jsonPath("$.aggregate.avgTtftMs").isEqualTo(800.0)
                .jsonPath("$.series.length()").isEqualTo(1)
                .jsonPath("$.series[0].t").isEqualTo(1000)
                .jsonPath("$.series[0].instances").isEqualTo(2)
                .jsonPath("$.series[0].requests").isEqualTo(4)
                .jsonPath("$.series[0].errors").isEqualTo(1);
    }

    @Test
    public void metrics_empty_returnsEmptyResult() {
        when(metricsBuffer.getSnapshots(120)).thenReturn(List.of());

        webClient.get().uri("/gateway/monitoring/metrics")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.returnedSlots").isEqualTo(0)
                .jsonPath("$.current").isEmpty()
                .jsonPath("$.aggregate.totalRequests").isEqualTo(0)
                .jsonPath("$.series.length()").isEqualTo(0);
    }

    @Test
    public void metrics_nonAdmin_returns403() {
        webClient.get().uri("/gateway/monitoring/metrics")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void metrics_unauthenticated_returns401() {
        webClient.get().uri("/gateway/monitoring/metrics")
                .exchange()
                .expectStatus().isUnauthorized();
    }
}

package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.AuthWebFilter;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.monitoring.MetricsBuffer;
import com.huawei.opsfactory.gateway.monitoring.MetricsSnapshot;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.process.PrewarmService;
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

import reactor.core.publisher.Mono;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.when;

@RunWith(SpringRunner.class)
@WebFluxTest(MonitoringController.class)
@Import({GatewayProperties.class, AuthWebFilter.class, UserContextFilter.class})
public class MonitoringControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private PrewarmService prewarmService;

    @MockBean
    private InstanceManager instanceManager;

    @MockBean
    private AgentConfigService agentConfigService;

    @MockBean
    private LangfuseService langfuseService;

    @MockBean
    private MetricsBuffer metricsBuffer;

    @Test
    public void testSystem_asAdmin() {
        when(agentConfigService.getRegistry()).thenReturn(List.of());
        when(instanceManager.getAllInstances()).thenReturn(List.of());

        webTestClient.get().uri("/gateway/monitoring/system")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
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
        webTestClient.get().uri("/gateway/monitoring/system")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testInstances() {
        ManagedInstance inst = new ManagedInstance("agent1", "user1", 9090, 5678L, null, "test-secret");
        inst.setStatus(ManagedInstance.Status.RUNNING);
        when(instanceManager.getAllInstances()).thenReturn(List.of(inst));
        when(agentConfigService.findAgent("agent1")).thenReturn(
                new com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry("agent1", "Agent One"));

        webTestClient.get().uri("/gateway/monitoring/instances")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(1)
                .jsonPath("$.runningInstances").isEqualTo(1)
                .jsonPath("$.byAgent[0].agentId").isEqualTo("agent1")
                .jsonPath("$.byAgent[0].agentName").isEqualTo("Agent One")
                .jsonPath("$.byAgent[0].instances[0].userId").isEqualTo("user1")
                .jsonPath("$.byAgent[0].instances[0].port").isEqualTo(9090)
                .jsonPath("$.byAgent[0].instances[0].status").isEqualTo("running")
                .jsonPath("$.byAgent[0].instances[0].idleSinceMs").isNumber();
    }

    @Test
    public void testLangfuseStatus() {
        when(langfuseService.isConfigured()).thenReturn(true);
        when(langfuseService.checkReachable()).thenReturn(Mono.just(true));

        webTestClient.get().uri("/gateway/monitoring/status")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.enabled").isEqualTo(true)
                .jsonPath("$.reachable").isEqualTo(true)
                .jsonPath("$.host").exists();
    }

    @Test
    public void testInstances_nonAdminForbidden() {
        webTestClient.get().uri("/gateway/monitoring/instances")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testLangfuseStatus_nonAdminForbidden() {
        webTestClient.get().uri("/gateway/monitoring/status")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testInstances_empty() {
        when(instanceManager.getAllInstances()).thenReturn(List.of());

        webTestClient.get().uri("/gateway/monitoring/instances")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalInstances").isEqualTo(0)
                .jsonPath("$.runningInstances").isEqualTo(0)
                .jsonPath("$.byAgent.length()").isEqualTo(0);
    }

    @Test
    public void testInstances_multipleInstances() {
        ManagedInstance inst1 = new ManagedInstance("agent1", "user1", 9090, 5678L, null, "test-secret");
        inst1.setStatus(ManagedInstance.Status.RUNNING);
        ManagedInstance inst2 = new ManagedInstance("agent2", "user2", 9091, 5679L, null, "test-secret");
        inst2.setStatus(ManagedInstance.Status.STOPPED);
        when(instanceManager.getAllInstances()).thenReturn(List.of(inst1, inst2));

        webTestClient.get().uri("/gateway/monitoring/instances")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
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

        webTestClient.get().uri("/gateway/monitoring/status")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.enabled").isEqualTo(false);
    }

    @Test
    public void testOverview() {
        when(langfuseService.getOverview("2024-01-01", "2024-01-02")).thenReturn(Mono.just(Map.of(
                "totalTraces", 10,
                "totalObservations", 20,
                "totalCost", 0.5,
                "avgLatency", 1.2,
                "p95Latency", 3.0,
                "errorCount", 1,
                "daily", List.of()
        )));

        webTestClient.get().uri("/gateway/monitoring/overview?from=2024-01-01&to=2024-01-02")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.totalTraces").isEqualTo(10)
                .jsonPath("$.totalObservations").isEqualTo(20)
                .jsonPath("$.errorCount").isEqualTo(1);
    }

    @Test
    public void testOverview_nonAdminForbidden() {
        webTestClient.get().uri("/gateway/monitoring/overview?from=2024-01-01&to=2024-01-02")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testSystem_withData() {
        when(agentConfigService.getRegistry()).thenReturn(List.of(
                new com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry("a1", "Agent1"),
                new com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry("a2", "Agent2")
        ));
        ManagedInstance inst = new ManagedInstance("a1", "u1", 8080, 1234L, null, "test-secret");
        when(instanceManager.getAllInstances()).thenReturn(List.of(inst));

        webTestClient.get().uri("/gateway/monitoring/system")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.agents.configured").isEqualTo(2)
                .jsonPath("$.gateway.uptimeMs").isNumber()
                .jsonPath("$.idle.timeoutMs").isNumber();
    }

    // ====================== GET /monitoring/metrics ======================

    @Test
    public void testMetrics_empty() {
        when(metricsBuffer.getSnapshots(120)).thenReturn(List.of());

        webTestClient.get().uri("/gateway/monitoring/metrics")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.collectionIntervalSec").isEqualTo(30)
                .jsonPath("$.maxSlots").isEqualTo(120)
                .jsonPath("$.returnedSlots").isEqualTo(0)
                .jsonPath("$.current").isEmpty()
                .jsonPath("$.aggregate.totalRequests").isEqualTo(0)
                .jsonPath("$.aggregate.totalErrors").isEqualTo(0)
                .jsonPath("$.series.length()").isEqualTo(0);
    }

    @Test
    public void testMetrics_withSnapshots() {
        MetricsSnapshot s1 = new MetricsSnapshot();
        s1.setTimestamp(1000L);
        s1.setActiveInstances(2);
        s1.setTotalTokens(5000);
        s1.setTotalSessions(3);
        s1.setRequestCount(4);
        s1.setAvgLatencyMs(2000.0);
        s1.setAvgTtftMs(500.0);
        s1.setP95LatencyMs(3000.0);
        s1.setP95TtftMs(800.0);
        s1.setTotalBytes(10000);
        s1.setErrorCount(1);

        MetricsSnapshot s2 = new MetricsSnapshot();
        s2.setTimestamp(2000L);
        s2.setActiveInstances(3);
        s2.setTotalTokens(8000);
        s2.setTotalSessions(5);
        s2.setRequestCount(6);
        s2.setAvgLatencyMs(3000.0);
        s2.setAvgTtftMs(700.0);
        s2.setP95LatencyMs(5000.0);
        s2.setP95TtftMs(1200.0);
        s2.setTotalBytes(20000);
        s2.setErrorCount(0);

        when(metricsBuffer.getSnapshots(120)).thenReturn(List.of(s1, s2));

        webTestClient.get().uri("/gateway/monitoring/metrics")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.returnedSlots").isEqualTo(2)
                // Current = latest snapshot (s2)
                .jsonPath("$.current.activeInstances").isEqualTo(3)
                .jsonPath("$.current.totalTokens").isEqualTo(8000)
                .jsonPath("$.current.totalSessions").isEqualTo(5)
                // Aggregate: weighted average = (2000*4 + 3000*6) / (4+6) = 26000/10 = 2600
                .jsonPath("$.aggregate.totalRequests").isEqualTo(10)
                .jsonPath("$.aggregate.totalErrors").isEqualTo(1)
                .jsonPath("$.aggregate.avgLatencyMs").isEqualTo(2600.0)
                // Series
                .jsonPath("$.series.length()").isEqualTo(2)
                .jsonPath("$.series[0].t").isEqualTo(1000)
                .jsonPath("$.series[1].t").isEqualTo(2000);
    }

    @Test
    public void testMetrics_nonAdminForbidden() {
        webTestClient.get().uri("/gateway/monitoring/metrics")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testMetrics_weightedAverage() {
        // Test that average is weighted by request count, not naive average
        // Window 1: 1 request at 10000ms latency
        MetricsSnapshot s1 = new MetricsSnapshot();
        s1.setTimestamp(1000L);
        s1.setRequestCount(1);
        s1.setAvgLatencyMs(10000.0);
        s1.setAvgTtftMs(5000.0);

        // Window 2: 99 requests at 100ms latency
        MetricsSnapshot s2 = new MetricsSnapshot();
        s2.setTimestamp(2000L);
        s2.setRequestCount(99);
        s2.setAvgLatencyMs(100.0);
        s2.setAvgTtftMs(50.0);

        when(metricsBuffer.getSnapshots(120)).thenReturn(List.of(s1, s2));

        // Weighted avg = (10000*1 + 100*99) / 100 = 19900/100 = 199
        // NOT naive avg = (10000 + 100) / 2 = 5050
        webTestClient.get().uri("/gateway/monitoring/metrics")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.aggregate.avgLatencyMs").isEqualTo(199.0)
                .jsonPath("$.aggregate.avgTtftMs").isEqualTo(99.5);
    }
}

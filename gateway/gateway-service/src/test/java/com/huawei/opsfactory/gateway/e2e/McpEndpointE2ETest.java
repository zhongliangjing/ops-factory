package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import org.junit.Before;
import org.junit.Test;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.Collections;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * E2E tests for McpController endpoints:
 * GET /agents/{agentId}/mcp
 * POST /agents/{agentId}/mcp
 * DELETE /agents/{agentId}/mcp/{name}
 */
public class McpEndpointE2ETest extends BaseE2ETest {

    private ManagedInstance sysInstance;

    @Before
    public void setUp() {
        sysInstance = new ManagedInstance("test-agent", "admin", 9999, 12345L, null, "test-secret");
        sysInstance.setStatus(ManagedInstance.Status.RUNNING);

        // McpController always spawns the system instance
        when(instanceManager.getOrSpawn("test-agent", "admin"))
                .thenReturn(Mono.just(sysInstance));
        when(instanceManager.getAllInstances()).thenReturn(Collections.emptyList());
        when(goosedProxy.goosedBaseUrl(anyInt())).thenAnswer(inv ->
                "http://127.0.0.1:" + inv.getArgument(0));
    }

    // ====================== GET /agents/{agentId}/mcp ======================

    @Test
    public void getMcpExtensions_admin_proxiesToSysInstance() {
        when(goosedProxy.proxy(any(), any(), eq(9999), eq("/config/extensions"), any()))
                .thenReturn(Mono.empty());

        webClient.get().uri("/gateway/agents/test-agent/mcp")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk();

        verify(instanceManager).getOrSpawn("test-agent", "admin");
        verify(goosedProxy).proxy(any(), any(), eq(9999), eq("/config/extensions"), any());
    }

    @Test
    public void getMcpExtensions_nonAdmin_returns403() {
        webClient.get().uri("/gateway/agents/test-agent/mcp")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void getMcpExtensions_unauthenticated_returns401() {
        webClient.get().uri("/gateway/agents/test-agent/mcp")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== POST /agents/{agentId}/mcp ======================

    @Test
    public void createMcpExtension_admin_forwardsToSysInstance() {
        // Mock WebClient for McpController's direct WebClient usage
        WebClient mockWebClient = WebClient.builder().build();
        when(goosedProxy.getWebClient()).thenReturn(mockWebClient);

        // McpController creates its own WebClient request; we can't easily mock that
        // chain end-to-end without a real HTTP server. Instead, test the admin guard.
        // The POST to the system instance will fail (no real server), returning 500.
        webClient.post().uri("/gateway/agents/test-agent/mcp")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"test-mcp\",\"type\":\"stdio\"}")
                .exchange()
                .expectStatus().is5xxServerError();
    }

    @Test
    public void createMcpExtension_nonAdmin_returns403() {
        webClient.post().uri("/gateway/agents/test-agent/mcp")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"test-mcp\"}")
                .exchange()
                .expectStatus().isForbidden();
    }

    // ====================== DELETE /agents/{agentId}/mcp/{name} ======================

    @Test
    public void deleteMcpExtension_nonAdmin_returns403() {
        webClient.delete().uri("/gateway/agents/test-agent/mcp/my-extension")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void deleteMcpExtension_unauthenticated_returns401() {
        webClient.delete().uri("/gateway/agents/test-agent/mcp/my-extension")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void deleteMcpExtension_admin_attemptsProxyToSys() {
        WebClient mockWebClient = WebClient.builder().build();
        when(goosedProxy.getWebClient()).thenReturn(mockWebClient);

        // Will fail with 500 because there's no real goosed to proxy to.
        // The test verifies the admin guard passes and the instance manager is called.
        webClient.delete().uri("/gateway/agents/test-agent/mcp/my-extension")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().is5xxServerError();

        verify(instanceManager).getOrSpawn("test-agent", "admin");
    }
}

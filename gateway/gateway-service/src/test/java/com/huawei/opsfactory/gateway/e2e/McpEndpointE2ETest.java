package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import org.junit.Before;
import org.junit.Test;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.Collections;

import static org.mockito.ArgumentMatchers.any;
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
        sysInstance = new ManagedInstance("test-agent", "sys", 9999, 12345L, null);
        sysInstance.setStatus(ManagedInstance.Status.RUNNING);

        // McpController always spawns sys instance
        when(instanceManager.getOrSpawn("test-agent", "sys"))
                .thenReturn(Mono.just(sysInstance));
        when(instanceManager.getAllInstances()).thenReturn(Collections.emptyList());
    }

    // ====================== GET /agents/{agentId}/mcp ======================

    @Test
    public void getMcpExtensions_admin_proxiesToSysInstance() {
        when(goosedProxy.proxy(any(), any(), eq(9999), eq("/config/extensions")))
                .thenReturn(Mono.empty());

        webClient.get().uri("/agents/test-agent/mcp")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk();

        verify(instanceManager).getOrSpawn("test-agent", "sys");
        verify(goosedProxy).proxy(any(), any(), eq(9999), eq("/config/extensions"));
    }

    @Test
    public void getMcpExtensions_nonAdmin_returns403() {
        webClient.get().uri("/agents/test-agent/mcp")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void getMcpExtensions_unauthenticated_returns401() {
        webClient.get().uri("/agents/test-agent/mcp")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== POST /agents/{agentId}/mcp ======================

    @Test
    public void createMcpExtension_admin_forwardsToSysInstance() {
        // Mock WebClient for McpController's direct WebClient usage
        WebClient mockWebClient = WebClient.builder().build();
        when(goosedProxy.getWebClient()).thenReturn(mockWebClient);
        when(goosedProxy.getSecretKey()).thenReturn(SECRET_KEY);

        // McpController creates its own WebClient request; we can't easily mock that
        // chain end-to-end without a real HTTP server. Instead, test the admin guard.
        // The POST to sys instance will fail (no real server), returning 500.
        webClient.post().uri("/agents/test-agent/mcp")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"test-mcp\",\"type\":\"stdio\"}")
                .exchange()
                .expectStatus().is5xxServerError();
    }

    @Test
    public void createMcpExtension_nonAdmin_returns403() {
        webClient.post().uri("/agents/test-agent/mcp")
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
        webClient.delete().uri("/agents/test-agent/mcp/my-extension")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void deleteMcpExtension_unauthenticated_returns401() {
        webClient.delete().uri("/agents/test-agent/mcp/my-extension")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void deleteMcpExtension_admin_attemptsProxyToSys() {
        WebClient mockWebClient = WebClient.builder().build();
        when(goosedProxy.getWebClient()).thenReturn(mockWebClient);
        when(goosedProxy.getSecretKey()).thenReturn(SECRET_KEY);

        // Will fail with 500 because there's no real goosed to proxy to.
        // The test verifies the admin guard passes and the instance manager is called.
        webClient.delete().uri("/agents/test-agent/mcp/my-extension")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().is5xxServerError();

        verify(instanceManager).getOrSpawn("test-agent", "sys");
    }
}

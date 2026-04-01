package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import org.junit.Before;
import org.junit.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import reactor.core.publisher.Mono;

import java.nio.file.Path;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Extended E2E tests for SessionController covering previously missing endpoints:
 * GET /sessions/{sessionId}?agentId=X (global session get)
 * DELETE /sessions/{sessionId}?agentId=X (global session delete)
 * PUT /agents/{agentId}/sessions/{sessionId}/name (rename session)
 */
public class SessionEndpointExtendedE2ETest extends BaseE2ETest {

    private ManagedInstance runningInstance;

    @Before
    public void setUp() {
        runningInstance = new ManagedInstance("test-agent", "alice", 9999, 12345L, null, "test-secret");
        runningInstance.setStatus(ManagedInstance.Status.RUNNING);
        when(agentConfigService.getUserAgentDir(any(String.class), any(String.class)))
                .thenAnswer(inv -> Path.of("/tmp/test-users")
                        .resolve(inv.getArgument(0, String.class))
                        .resolve("agents").resolve(inv.getArgument(1, String.class)));
    }

    // ====================== GET /sessions/{sessionId}?agentId=X ======================

    @Test
    public void getSessionGlobal_authenticated_returnsSessionWithAgentId() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.fetchJson(eq(9999), eq("/sessions/session-abc"), anyString()))
                .thenReturn(Mono.just("{\"id\":\"session-abc\",\"conversation\":[]}"));

        webClient.get().uri("/gateway/sessions/session-abc?agentId=test-agent")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.id").isEqualTo("session-abc")
                .jsonPath("$.agentId").isEqualTo("test-agent");
    }

    @Test
    public void getSessionGlobal_unauthenticated_returns401() {
        webClient.get().uri("/gateway/sessions/session-abc?agentId=test-agent")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== DELETE /sessions/{sessionId}?agentId=X ======================

    @Test
    public void deleteSessionGlobal_authenticated_removesOwnerAndProxies() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.proxy(any(), any(), eq(9999), eq("/sessions/session-xyz"), any()))
                .thenReturn(Mono.empty());

        webClient.delete().uri("/gateway/sessions/session-xyz?agentId=test-agent")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk();

        verify(goosedProxy).proxy(any(), any(), eq(9999), eq("/sessions/session-xyz"), any());
    }

    @Test
    public void deleteSessionGlobal_unauthenticated_returns401() {
        webClient.delete().uri("/gateway/sessions/session-xyz?agentId=test-agent")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== PUT /agents/{agentId}/sessions/{sessionId}/name ======================

    @Test
    public void renameSession_authenticated_proxiesToGoosed() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.proxyWithBody(any(), eq(9999), eq("/sessions/session-123/name"),
                eq(HttpMethod.PUT), anyString(), anyString()))
                .thenReturn(Mono.empty());

        webClient.put().uri("/gateway/agents/test-agent/sessions/session-123/name")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"My Chat\"}")
                .exchange()
                .expectStatus().isOk();

        verify(goosedProxy).proxyWithBody(any(), eq(9999), eq("/sessions/session-123/name"),
                eq(HttpMethod.PUT), anyString(), anyString());
    }

    @Test
    public void renameSession_unauthenticated_returns401() {
        webClient.put().uri("/gateway/agents/test-agent/sessions/session-123/name")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"name\":\"test\"}")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== Session not found ======================

    @Test
    public void getSession_notFoundFromGoosed_returns404() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.fetchJson(eq(9999), eq("/sessions/nonexistent"), anyString()))
                .thenReturn(Mono.error(org.springframework.web.reactive.function.client.WebClientResponseException
                        .create(404, "Not Found", org.springframework.http.HttpHeaders.EMPTY, new byte[0], null)));

        webClient.get().uri("/gateway/agents/test-agent/sessions/nonexistent")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isNotFound();
    }
}

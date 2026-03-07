package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.hook.HookContext;
import org.junit.Before;
import org.junit.Test;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * E2E tests for ReplyController endpoints:
 * POST /agents/{agentId}/reply, /resume, /restart, /stop
 */
public class ReplyEndpointE2ETest extends BaseE2ETest {

    private ManagedInstance mockInstance;

    @Before
    public void setUp() {
        mockInstance = new ManagedInstance("test-agent", "alice", 9999, 12345L, null);
        mockInstance.setStatus(ManagedInstance.Status.RUNNING);
        // HookPipeline passes body through unchanged
        when(hookPipeline.executeRequest(any(HookContext.class)))
                .thenAnswer(inv -> Mono.just(((HookContext) inv.getArgument(0)).getBody()));
    }

    // ====================== POST /agents/{agentId}/reply (SSE) ======================

    @Test
    public void reply_authenticatedUser_streamsSSE() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(mockInstance));

        DataBuffer buffer = new DefaultDataBufferFactory()
                .wrap("data: {\"content\":\"hello\"}\n\n".getBytes(StandardCharsets.UTF_8));
        when(sseRelayService.relay(eq(9999), eq("/reply"), anyString()))
                .thenReturn(Flux.just(buffer));

        webClient.post().uri("/agents/test-agent/reply")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"hello\"}")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchange()
                .expectStatus().isOk();
    }

    @Test
    public void reply_unauthenticated_returns401() {
        webClient.post().uri("/agents/test-agent/reply")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"hello\"}")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void reply_defaultUser_usesSysUser() {
        ManagedInstance sysInstance = new ManagedInstance("test-agent", "sys", 8888, 11111L, null);
        sysInstance.setStatus(ManagedInstance.Status.RUNNING);

        when(instanceManager.getOrSpawn("test-agent", "sys"))
                .thenReturn(Mono.just(sysInstance));

        DataBuffer buffer = new DefaultDataBufferFactory()
                .wrap("data: ok\n\n".getBytes(StandardCharsets.UTF_8));
        when(sseRelayService.relay(eq(8888), eq("/reply"), anyString()))
                .thenReturn(Flux.just(buffer));

        webClient.post().uri("/agents/test-agent/reply")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                // No x-user-id header -> defaults to "sys"
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"test\"}")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchange()
                .expectStatus().isOk();

        verify(instanceManager).getOrSpawn("test-agent", "sys");
    }

    // ====================== POST /agents/{agentId}/resume ======================

    @Test
    public void resume_authenticatedUser_proxiesToGoosed() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(mockInstance));
        when(goosedProxy.proxyWithBody(any(), eq(9999), eq("/agent/resume"),
                eq(HttpMethod.POST), anyString()))
                .thenReturn(Mono.empty());

        webClient.post().uri("/agents/test-agent/resume")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().isOk();

        verify(goosedProxy).proxyWithBody(any(), eq(9999), eq("/agent/resume"),
                eq(HttpMethod.POST), anyString());
    }

    @Test
    public void resume_unauthenticated_returns401() {
        webClient.post().uri("/agents/test-agent/resume")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== POST /agents/{agentId}/restart ======================

    @Test
    public void restart_authenticatedUser_proxiesToGoosed() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(mockInstance));
        when(goosedProxy.proxyWithBody(any(), eq(9999), eq("/agent/restart"),
                eq(HttpMethod.POST), anyString()))
                .thenReturn(Mono.empty());

        webClient.post().uri("/agents/test-agent/restart")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().isOk();
    }

    // ====================== POST /agents/{agentId}/stop ======================

    @Test
    public void stop_authenticatedUser_proxiesToGoosed() {
        when(instanceManager.getOrSpawn("test-agent", "bob"))
                .thenReturn(Mono.just(mockInstance));
        when(goosedProxy.proxyWithBody(any(), eq(9999), eq("/agent/stop"),
                eq(HttpMethod.POST), anyString()))
                .thenReturn(Mono.empty());

        webClient.post().uri("/agents/test-agent/stop")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().isOk();
    }

    @Test
    public void stop_unauthenticated_returns401() {
        webClient.post().uri("/agents/test-agent/stop")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== Instance spawn failure ======================

    @Test
    public void reply_instanceSpawnFails_returns500() {
        when(instanceManager.getOrSpawn(anyString(), anyString()))
                .thenReturn(Mono.error(new RuntimeException("Failed to spawn")));

        webClient.post().uri("/agents/test-agent/reply")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"test\"}")
                .exchange()
                .expectStatus().is5xxServerError();
    }
}

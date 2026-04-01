package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.hook.HookContext;
import org.junit.Before;
import org.junit.Test;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.MediaType;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * E2E tests verifying instance limit enforcement at the HTTP layer.
 * When InstanceManager.getOrSpawn throws IllegalStateException for
 * per-user or global limits, the reply endpoint should return 5xx.
 */
public class InstanceLimitE2ETest extends BaseE2ETest {

    @Before
    public void setUp() {
        // HookPipeline passes body through unchanged
        when(hookPipeline.executeRequest(any(HookContext.class)))
                .thenAnswer(inv -> Mono.just(((HookContext) inv.getArgument(0)).getBody()));
    }

    @Test
    public void reply_perUserLimitReached_returns5xx() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.error(new IllegalStateException("Per-user instance limit reached (5)")));

        webClient.post().uri("/gateway/agents/test-agent/reply")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"hello\"}")
                .exchange()
                .expectStatus().is5xxServerError();
    }

    @Test
    public void reply_globalLimitReached_returns5xx() {
        when(instanceManager.getOrSpawn("test-agent", "bob"))
                .thenReturn(Mono.error(new IllegalStateException("Global instance limit reached (50)")));

        webClient.post().uri("/gateway/agents/test-agent/reply")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"hello\"}")
                .exchange()
                .expectStatus().is5xxServerError();
    }

    @Test
    public void reply_normalSpawn_returns200() {
        ManagedInstance mockInstance = new ManagedInstance("test-agent", "alice", 9999, 12345L, null, "test-secret");
        mockInstance.setStatus(ManagedInstance.Status.RUNNING);

        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(mockInstance));

        DataBuffer buffer = new DefaultDataBufferFactory()
                .wrap("data: {\"type\":\"Finish\"}\n\n".getBytes(StandardCharsets.UTF_8));
        when(sseRelayService.relay(eq(9999), eq("/reply"), anyString(), eq("test-agent"), eq("alice"), any()))
                .thenReturn(Flux.just(buffer));

        webClient.post().uri("/gateway/agents/test-agent/reply")
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
        webClient.post().uri("/gateway/agents/test-agent/reply")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"hello\"}")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void resume_limitReached_returns5xx() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.error(new IllegalStateException("Per-user instance limit reached (5)")));

        webClient.post().uri("/gateway/agents/test-agent/resume")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().is5xxServerError();
    }
}

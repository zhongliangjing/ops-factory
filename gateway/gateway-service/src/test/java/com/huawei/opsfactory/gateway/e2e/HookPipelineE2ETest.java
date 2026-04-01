package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.hook.HookContext;
import org.junit.Before;
import org.junit.Test;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * E2E tests verifying HookPipeline integration with ReplyController.
 * Tests that hook rejections (413, 403) are properly propagated to the client,
 * and that successful hooks allow the request through to SseRelayService.
 */
public class HookPipelineE2ETest extends BaseE2ETest {

    private ManagedInstance mockInstance;

    @Before
    public void setUp() {
        mockInstance = new ManagedInstance("test-agent", "alice", 9999, 12345L, null, "test-secret");
        mockInstance.setStatus(ManagedInstance.Status.RUNNING);
    }

    @Test
    public void reply_hookPassThrough_relaysToGoosed() {
        when(hookPipeline.executeRequest(any(HookContext.class)))
                .thenAnswer(inv -> Mono.just(((HookContext) inv.getArgument(0)).getBody()));
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
    public void reply_hookRejectsWithPayloadTooLarge_returns413() {
        when(hookPipeline.executeRequest(any(HookContext.class)))
                .thenReturn(Mono.error(new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                        "Request body exceeds maximum allowed size")));

        webClient.post().uri("/gateway/agents/test-agent/reply")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"hello\"}")
                .exchange()
                .expectStatus().isEqualTo(413);

        // SseRelayService should NOT have been called
        verify(sseRelayService, never()).relay(
                any(int.class), anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    public void reply_hookRejectsWithForbidden_returns403() {
        when(hookPipeline.executeRequest(any(HookContext.class)))
                .thenReturn(Mono.error(new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "File path escapes allowed directory")));

        webClient.post().uri("/gateway/agents/test-agent/reply")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"hello\"}")
                .exchange()
                .expectStatus().isForbidden();

        verify(sseRelayService, never()).relay(
                any(int.class), anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    public void reply_hookThrowsUnexpectedException_returns500() {
        when(hookPipeline.executeRequest(any(HookContext.class)))
                .thenReturn(Mono.error(new RuntimeException("Unexpected hook failure")));

        webClient.post().uri("/gateway/agents/test-agent/reply")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"message\":\"hello\"}")
                .exchange()
                .expectStatus().is5xxServerError();

        verify(sseRelayService, never()).relay(
                any(int.class), anyString(), anyString(), anyString(), anyString(), anyString());
    }

    @Test
    public void reply_hookModifiesBody_modifiedBodyReachesRelay() {
        // Hook transforms the body (e.g., injects file content)
        when(hookPipeline.executeRequest(any(HookContext.class)))
                .thenReturn(Mono.just("{\"modified\":true}"));
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(mockInstance));

        DataBuffer buffer = new DefaultDataBufferFactory()
                .wrap("data: {\"type\":\"Finish\"}\n\n".getBytes(StandardCharsets.UTF_8));
        when(sseRelayService.relay(eq(9999), eq("/reply"), eq("{\"modified\":true}"),
                eq("test-agent"), eq("alice"), anyString()))
                .thenReturn(Flux.just(buffer));

        webClient.post().uri("/gateway/agents/test-agent/reply")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"original\":true}")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .exchange()
                .expectStatus().isOk();

        // Verify relay received the modified body, not the original
        verify(sseRelayService).relay(eq(9999), eq("/reply"), eq("{\"modified\":true}"),
                eq("test-agent"), eq("alice"), anyString());
    }
}

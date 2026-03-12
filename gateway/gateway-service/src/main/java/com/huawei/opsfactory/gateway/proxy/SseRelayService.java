package com.huawei.opsfactory.gateway.proxy;

import com.huawei.opsfactory.gateway.common.constants.GatewayConstants;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class SseRelayService {

    private static final Logger log = LogManager.getLogger(SseRelayService.class);

    private final GoosedProxy goosedProxy;
    private final WebClient webClient;
    private final GatewayProperties properties;
    private final InstanceManager instanceManager;

    public SseRelayService(GoosedProxy goosedProxy, GatewayProperties properties,
                           InstanceManager instanceManager) {
        this.goosedProxy = goosedProxy;
        this.webClient = goosedProxy.getWebClient();
        this.properties = properties;
        this.instanceManager = instanceManager;
    }

    /**
     * Relay SSE stream from a goosed instance.
     * Returns a Flux of raw DataBuffer chunks for zero-copy streaming.
     *
     * Three timeout layers protect against goosed hangs:
     * 1. firstByteTimeout — abort if no data arrives at all (prepare_reply_context hung)
     * 2. idleTimeout — abort if gap between chunks exceeds threshold (tool execution hung)
     * 3. maxDuration — hard ceiling on any single reply
     *
     * On timeout, the hung instance is automatically killed so the next request
     * triggers a fresh spawn instead of hitting the same deadlock.
     */
    public Flux<DataBuffer> relay(int port, String path, String body,
                                   String agentId, String userId) {
        String target = goosedProxy.goosedBaseUrl(port) + path;
        long startTime = System.currentTimeMillis();
        AtomicInteger chunkCount = new AtomicInteger(0);
        AtomicLong lastChunkTime = new AtomicLong(startTime);
        AtomicLong totalBytes = new AtomicLong(0);

        GatewayProperties.Sse sseConfig = properties.getSse();
        Duration firstByteTimeout = Duration.ofSeconds(sseConfig.getFirstByteTimeoutSec());
        Duration idleTimeout = Duration.ofSeconds(sseConfig.getIdleTimeoutSec());
        Duration maxDuration = Duration.ofSeconds(sseConfig.getMaxDurationSec());

        log.info("[SSE-DIAG] relay START → {} body={}chars firstByte={}s idle={}s max={}s",
                target, body.length(),
                sseConfig.getFirstByteTimeoutSec(),
                sseConfig.getIdleTimeoutSec(),
                sseConfig.getMaxDurationSec());

        Flux<DataBuffer> upstream = webClient.post()
                .uri(target)
                .header(GatewayConstants.HEADER_SECRET_KEY, properties.getSecretKey())
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .bodyValue(body)
                .retrieve()
                .bodyToFlux(DataBuffer.class)
                .doOnNext(buf -> {
                    int seq = chunkCount.incrementAndGet();
                    long now = System.currentTimeMillis();
                    long gap = now - lastChunkTime.getAndSet(now);
                    int readable = buf.readableByteCount();
                    totalBytes.addAndGet(readable);

                    // Log first 3 chunks always, then every 10th, and any chunk after >5s gap
                    if (seq <= 3 || seq % 10 == 0 || gap > 5000) {
                        String preview = peekContent(buf, 120);
                        log.info("[SSE-DIAG] chunk#{} {}B gap={}ms elapsed={}ms preview={}",
                                seq, readable, gap, now - startTime, preview);
                    }
                })
                .doOnError(e -> {
                    long elapsed = System.currentTimeMillis() - startTime;
                    log.error("[SSE-DIAG] relay ERROR after {}ms, chunks={}, bytes={}: {}",
                            elapsed, chunkCount.get(), totalBytes.get(), e.getMessage());
                })
                .doOnComplete(() -> {
                    long elapsed = System.currentTimeMillis() - startTime;
                    log.info("[SSE-DIAG] relay COMPLETE {}ms chunks={} bytes={}",
                            elapsed, chunkCount.get(), totalBytes.get());
                })
                .doOnCancel(() -> {
                    long elapsed = System.currentTimeMillis() - startTime;
                    log.warn("[SSE-DIAG] relay CANCELLED after {}ms, chunks={}, bytes={}",
                            elapsed, chunkCount.get(), totalBytes.get());
                });

        // Layer 1+2: First-byte timeout and per-element idle timeout.
        // timeout(Publisher, Function) uses firstTimeout for the first element,
        // then the Function produces a new timeout publisher after each element.
        Flux<DataBuffer> withTimeouts = upstream
                .timeout(
                        Mono.delay(firstByteTimeout),
                        item -> Mono.delay(idleTimeout)
                )
                // Layer 3: Hard max duration
                .take(maxDuration);

        // On timeout or connection error, emit a synthetic SSE error event,
        // then kill the hung instance so the next request spawns a fresh one.
        return withTimeouts
                .onErrorResume(e -> {
                    if (e instanceof TimeoutException) {
                        long elapsed = System.currentTimeMillis() - startTime;
                        int chunks = chunkCount.get();
                        String reason = chunks == 0
                                ? "No response from agent in " + sseConfig.getFirstByteTimeoutSec() + "s"
                                : "Agent stopped responding for " + sseConfig.getIdleTimeoutSec() + "s";
                        log.warn("[SSE-DIAG] relay TIMEOUT after {}ms, chunks={}, bytes={}: {}",
                                elapsed, chunks, totalBytes.get(), reason);
                        recycleAsync(agentId, userId, "timeout");
                        return sseErrorEvent(reason);
                    }
                    if (e instanceof WebClientRequestException) {
                        log.warn("[SSE-DIAG] relay CONNECTION ERROR: {}", e.getMessage());
                        return sseErrorEvent("Agent connection failed: " + e.getMessage());
                    }
                    // PrematureCloseException comes wrapped in WebClientResponseException
                    if (isPrematureClose(e)) {
                        log.warn("[SSE-DIAG] relay PREMATURE CLOSE after {}ms, chunks={}, bytes={}: {}",
                                System.currentTimeMillis() - startTime,
                                chunkCount.get(), totalBytes.get(), e.getMessage());
                        // Instance likely already dead/recycled — emit error event
                        return sseErrorEvent("Agent connection lost, please retry");
                    }
                    // Other errors: propagate
                    return Flux.error(e);
                });
    }

    /**
     * Kill the hung instance on a separate thread to avoid blocking the SSE response.
     */
    private void recycleAsync(String agentId, String userId, String reason) {
        Mono.fromRunnable(() -> {
            log.info("[SSE-DIAG] Recycling hung instance {}:{} reason={}", agentId, userId, reason);
            instanceManager.forceRecycle(agentId, userId);
        }).subscribeOn(Schedulers.boundedElastic()).subscribe();
    }

    /**
     * Check if the error is a PrematureCloseException (connection lost mid-stream).
     * This occurs when goosed is killed while an SSE stream is active.
     */
    private boolean isPrematureClose(Throwable e) {
        // Direct PrematureCloseException
        if (e.getClass().getSimpleName().equals("PrematureCloseException")) return true;
        // Wrapped in WebClientResponseException
        Throwable cause = e.getCause();
        return cause != null && cause.getClass().getSimpleName().equals("PrematureCloseException");
    }

    /**
     * Create a synthetic SSE error event that the webapp can parse and display.
     */
    private Flux<DataBuffer> sseErrorEvent(String reason) {
        String ssePayload = "data: {\"type\":\"Error\",\"error\":\"" +
                reason.replace("\"", "\\\"") + "\"}\n\n";
        DataBuffer buf = DefaultDataBufferFactory.sharedInstance
                .wrap(ssePayload.getBytes(StandardCharsets.UTF_8));
        return Flux.just(buf);
    }

    /**
     * Peek at the first N bytes of a DataBuffer without consuming it.
     */
    private static String peekContent(DataBuffer buf, int maxLen) {
        try {
            int readable = buf.readableByteCount();
            int len = Math.min(readable, maxLen);
            byte[] bytes = new byte[len];
            int pos = buf.readPosition();
            buf.read(bytes);
            buf.readPosition(pos); // reset position so downstream can still read
            String s = new String(bytes, StandardCharsets.UTF_8)
                    .replace("\n", "\\n").replace("\r", "\\r");
            return s.length() > maxLen ? s.substring(0, maxLen) + "…" : s;
        } catch (Exception e) {
            return "<peek-error>";
        }
    }
}

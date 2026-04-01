package com.huawei.opsfactory.gateway.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.common.util.JsonUtil;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.hook.HookContext;
import com.huawei.opsfactory.gateway.hook.HookPipeline;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.proxy.GoosedProxy;
import com.huawei.opsfactory.gateway.proxy.SseRelayService;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import com.huawei.opsfactory.gateway.service.FileService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/gateway/agents/{agentId}")
public class ReplyController {

    private static final Logger log = LogManager.getLogger(ReplyController.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InstanceManager instanceManager;
    private final SseRelayService sseRelayService;
    private final GoosedProxy goosedProxy;
    private final HookPipeline hookPipeline;
    private final AgentConfigService agentConfigService;
    private final FileService fileService;
    private final ConcurrentHashMap<String, Mono<String>> inFlightResumes = new ConcurrentHashMap<>();

    public ReplyController(InstanceManager instanceManager,
                           SseRelayService sseRelayService,
                           GoosedProxy goosedProxy,
                           HookPipeline hookPipeline,
                           AgentConfigService agentConfigService,
                           FileService fileService) {
        this.instanceManager = instanceManager;
        this.sseRelayService = sseRelayService;
        this.goosedProxy = goosedProxy;
        this.hookPipeline = hookPipeline;
        this.agentConfigService = agentConfigService;
        this.fileService = fileService;
    }

    /**
     * SSE streaming chat reply.
     * Runs request hooks (body limit, file attachment) then proxies to goosed.
     * If the session has not been resumed on this goosed instance (e.g. after force-recycle),
     * automatically calls /agent/resume to restore the provider and extensions first.
     */
    @PostMapping(value = {"/reply", "/agent/reply"}, produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<DataBuffer> reply(@PathVariable String agentId,
                                   @RequestBody String body,
                                   ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        HookContext ctx = new HookContext(body, agentId, userId);
        log.debug("[REPLY] agentId={} userId={} bodyLen={}", agentId, userId, body.length());
        return hookPipeline.executeRequest(ctx)
                .flatMapMany(processedBody -> {
                    log.debug("[REPLY] hooks done, getting instance for {}:{}", agentId, userId);
                    String sessionId = JsonUtil.extractSessionId(processedBody);
                    Path workingDir = agentConfigService.getUserAgentDir(userId, agentId);

                    // Snapshot files before relay (best-effort, empty list on error)
                    List<Map<String, Object>> beforeFiles = snapshotFiles(workingDir);

                    return instanceManager.getOrSpawn(agentId, userId)
                            .flatMapMany(instance -> {
                                log.info("[REPLY] instance ready {}:{} port={} pid={} sessionResumed={}",
                                        agentId, userId, instance.getPort(), instance.getPid(),
                                        instance.isSessionResumed(sessionId));
                                instance.touch();
                                instanceManager.touchAllForUser(userId);

                                Flux<DataBuffer> upstream = ensureSessionResumed(instance, sessionId)
                                        .thenMany(sseRelayService.relay(instance.getPort(), "/reply",
                                                processedBody, agentId, userId, instance.getSecretKey()));

                                // After stream completes: diff files → inject OutputFiles SSE event
                                return upstream.concatWith(
                                        Mono.defer(() -> buildOutputFilesEvent(workingDir, sessionId, beforeFiles))
                                                .subscribeOn(Schedulers.boundedElastic()));
                            });
                });
    }

    /**
     * Snapshot current files in the working directory (best-effort).
     */
    private List<Map<String, Object>> snapshotFiles(Path workingDir) {
        try {
            return fileService.listFiles(workingDir);
        } catch (Exception e) {
            log.debug("[REPLY] file snapshot failed (best-effort): {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Compute file diff and emit an OutputFiles SSE event if files changed.
     * Returns empty Mono if no files changed or on any error.
     */
    private Mono<DataBuffer> buildOutputFilesEvent(Path workingDir, String sessionId,
                                                    List<Map<String, Object>> beforeFiles) {
        try {
            List<Map<String, Object>> afterFiles = fileService.listFiles(workingDir);
            List<Map<String, String>> changed = fileService.diffFiles(beforeFiles, afterFiles);
            if (changed.isEmpty()) {
                return Mono.empty();
            }

            String json = MAPPER.writeValueAsString(Map.of(
                    "type", "OutputFiles",
                    "sessionId", sessionId != null ? sessionId : "",
                    "files", changed));
            String ssePayload = "data: " + json + "\n\n";
            log.info("[REPLY] detected {} output files for session {}", changed.size(), sessionId);

            DataBuffer buf = DefaultDataBufferFactory.sharedInstance
                    .wrap(ssePayload.getBytes(StandardCharsets.UTF_8));
            return Mono.just(buf);
        } catch (Exception e) {
            log.warn("[REPLY] failed to build OutputFiles event: {}", e.getMessage());
            return Mono.empty();
        }
    }

    /**
     * Ensure that the session referenced in the reply body has been resumed on this
     * goosed instance (provider + extensions loaded). This is a no-op when the session
     * was already resumed (normal flow). After a force-recycle, the goosed process is
     * brand-new and needs an explicit /agent/resume call before it can handle /reply.
     */
    private Mono<Void> ensureSessionResumed(ManagedInstance instance, String sessionId) {
        if (sessionId == null || instance.isSessionResumed(sessionId)) {
            log.debug("[REPLY] session {} already resumed or null, skipping resume", sessionId);
            return Mono.empty();
        }
        String resumeBody = "{\"session_id\":\"" + sessionId + "\",\"load_model_and_extensions\":true}";
        return resumeSession(instance, sessionId, resumeBody, "[REPLY]")
                .onErrorResume(e -> {
                    log.warn("[REPLY] session {} resume failed on instance {}:{}: {} (will retry next request)",
                            sessionId, instance.getAgentId(), instance.getUserId(), e.getMessage());
                    return Mono.empty();
                })
                .then();
    }

    private Mono<String> resumeSession(ManagedInstance instance, String sessionId, String body, String logPrefix) {
        if (sessionId == null || sessionId.isBlank()) {
            return goosedProxy.fetchJson(instance.getPort(), HttpMethod.POST, "/agent/resume", body, 120, instance.getSecretKey());
        }

        String dedupeKey = instance.getKey() + ":" + sessionId;
        return inFlightResumes.computeIfAbsent(dedupeKey, ignored -> {
            long resumeStart = System.currentTimeMillis();
            log.info("{} session {} not yet resumed on instance {}:{} (port={}), calling /agent/resume",
                    logPrefix, sessionId, instance.getAgentId(), instance.getUserId(), instance.getPort());
            return goosedProxy.fetchJson(instance.getPort(), HttpMethod.POST, "/agent/resume", body, 120, instance.getSecretKey())
                    .doOnNext(r -> {
                        long resumeMs = System.currentTimeMillis() - resumeStart;
                        instance.markSessionResumed(sessionId);
                        log.info("{} session {} resumed in {}ms on instance {}:{}",
                                logPrefix, sessionId, resumeMs, instance.getAgentId(), instance.getUserId());
                    })
                    .doOnSubscribe(sub -> log.debug("{} joining in-flight resume key={}", logPrefix, dedupeKey))
                    .doFinally(signalType -> inFlightResumes.remove(dedupeKey))
                    .cache();
        });
    }

    @PostMapping(value = {"/resume", "/agent/resume"}, produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<String> resume(@PathVariable String agentId,
                               @RequestBody String body,
                               ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        String sessionId = JsonUtil.extractSessionId(body);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> resumeSession(instance, sessionId, body, "[RESUME]"))
                .onErrorResume(WebClientResponseException.class, e -> {
                    if (e.getStatusCode() == HttpStatus.NOT_FOUND) {
                        return Mono.error(new ResponseStatusException(
                                HttpStatus.NOT_FOUND, "Session not found"));
                    }
                    return Mono.error(e);
                });
    }

    @PostMapping({"/restart", "/agent/restart"})
    public Mono<Void> restart(@PathVariable String agentId,
                               @RequestBody String body,
                               ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.proxyWithBody(
                        exchange.getResponse(), instance.getPort(), "/agent/restart",
                        HttpMethod.POST, body, instance.getSecretKey()));
    }

    @PostMapping({"/stop", "/agent/stop"})
    public Mono<Void> stop(@PathVariable String agentId,
                            @RequestBody String body,
                            ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        String sessionId = JsonUtil.extractSessionId(body);
        log.info("[STOP] request received agentId={} userId={} sessionId={} bodyLen={}",
                agentId, userId, sessionId, body.length());
        return instanceManager.getOrSpawn(agentId, userId)
                .doOnNext(instance -> log.info("[STOP] instance resolved agentId={} userId={} sessionId={} port={} pid={}",
                        agentId, userId, sessionId, instance.getPort(), instance.getPid()))
                .flatMap(instance -> goosedProxy.proxyWithBody(
                        exchange.getResponse(), instance.getPort(), "/agent/stop",
                        HttpMethod.POST, body, instance.getSecretKey())
                        .doOnSubscribe(sub -> log.info("[STOP] forwarding to goosed agentId={} userId={} sessionId={} port={}",
                                agentId, userId, sessionId, instance.getPort()))
                        .doOnSuccess(ignored -> log.info("[STOP] goosed stop completed agentId={} userId={} sessionId={} status={}",
                                agentId, userId, sessionId, exchange.getResponse().getStatusCode()))
                        .doOnError(err -> log.warn("[STOP] goosed stop failed agentId={} userId={} sessionId={} port={} error={}",
                                agentId, userId, sessionId, instance.getPort(), err.getMessage())));
    }
}

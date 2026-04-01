package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import com.huawei.opsfactory.gateway.service.FileService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * Persists and retrieves file capsule metadata (messageId → output files).
 * Data is stored at: data/{sessionId}/file-capsules.json
 */
@RestController
@RequestMapping("/gateway/agents/{agentId}/file-capsules")
public class FileCapsuleController {

    private final AgentConfigService agentConfigService;
    private final FileService fileService;

    public FileCapsuleController(AgentConfigService agentConfigService, FileService fileService) {
        this.agentConfigService = agentConfigService;
        this.fileService = fileService;
    }

    /**
     * GET /agents/{agentId}/file-capsules?sessionId=xxx
     * Returns persisted messageId → files mapping for a session.
     */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, Object>> getFileCapsules(@PathVariable String agentId,
                                                      @RequestParam String sessionId,
                                                      ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        Path workingDir = agentConfigService.getUserAgentDir(userId, agentId);
        return Mono.fromCallable(() -> {
            Map<String, List<Map<String, String>>> entries = fileService.loadOutputFiles(workingDir, sessionId);
            return Map.<String, Object>of("entries", entries);
        }).subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * POST /agents/{agentId}/file-capsules
     * Frontend writes back the messageId → files mapping after receiving the OutputFiles SSE event.
     * Body: { "sessionId": "xxx", "messageId": "msg_uuid4", "files": [...] }
     */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, Object>> saveFileCapsule(@PathVariable String agentId,
                                                      @RequestBody Map<String, Object> body,
                                                      ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        Path workingDir = agentConfigService.getUserAgentDir(userId, agentId);

        String sessionId = (String) body.get("sessionId");
        String messageId = (String) body.get("messageId");
        Object rawFiles = body.get("files");

        if (sessionId == null || messageId == null || !(rawFiles instanceof List<?> fileList)) {
            return Mono.just(Map.of("status", "error", "message", "sessionId, messageId, and files are required"));
        }

        // Convert List<Object> → List<Map<String, String>>
        List<Map<String, String>> files = fileList.stream()
                .filter(item -> item instanceof Map)
                .map(item -> {
                    Map<String, String> entry = new java.util.LinkedHashMap<>();
                    ((Map<?, ?>) item).forEach((k, v) -> entry.put(String.valueOf(k), String.valueOf(v)));
                    return entry;
                })
                .toList();

        return Mono.fromCallable(() -> {
            fileService.persistOutputFiles(workingDir, sessionId, messageId, files);
            return Map.<String, Object>of("status", "ok");
        }).subscribeOn(Schedulers.boundedElastic());
    }
}

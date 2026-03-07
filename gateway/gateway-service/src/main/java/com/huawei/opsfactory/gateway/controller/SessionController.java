package com.huawei.opsfactory.gateway.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.proxy.GoosedProxy;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import com.huawei.opsfactory.gateway.service.SessionService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;

@RestController
public class SessionController {

    private static final Logger log = LogManager.getLogger(SessionController.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InstanceManager instanceManager;
    private final SessionService sessionService;
    private final GoosedProxy goosedProxy;
    private final AgentConfigService agentConfigService;

    public SessionController(InstanceManager instanceManager,
                             SessionService sessionService,
                             GoosedProxy goosedProxy,
                             AgentConfigService agentConfigService) {
        this.instanceManager = instanceManager;
        this.sessionService = sessionService;
        this.goosedProxy = goosedProxy;
        this.agentConfigService = agentConfigService;
    }

    @PostMapping("/agents/{agentId}/agent/start")
    public Mono<Void> startSession(@PathVariable String agentId,
                                    @RequestBody String body,
                                    ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        // Inject working_dir into the request body (override any client-supplied value)
        String workingDir = agentConfigService.getUsersDir()
                .resolve(userId).resolve("agents").resolve(agentId)
                .toAbsolutePath().normalize().toString();
        String modifiedBody;
        try {
            java.util.Map<String, Object> bodyMap = MAPPER.readValue(body,
                    new TypeReference<java.util.Map<String, Object>>() {});
            bodyMap.put("working_dir", workingDir);
            modifiedBody = MAPPER.writeValueAsString(bodyMap);
        } catch (Exception e) {
            modifiedBody = "{\"working_dir\":\"" + workingDir.replace("\\", "\\\\")
                    .replace("\"", "\\\"") + "\"}";
        }
        String finalBody = modifiedBody;
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.proxyWithBody(
                        exchange.getResponse(), instance.getPort(), "/agent/start",
                        HttpMethod.POST, finalBody));
    }

    @GetMapping(value = "/sessions", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<String> listAllSessions(ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        return Flux.fromIterable(instanceManager.getAllInstances())
                .filter(inst -> inst.getUserId().equals(userId)
                        || "sys".equals(inst.getUserId()))
                .filter(inst -> inst.getStatus() == ManagedInstance.Status.RUNNING)
                .flatMap(inst -> sessionService.getSessionsFromInstance(inst)
                        .map(json -> extractSessionsArray(json, inst.getAgentId())))
                .collectList()
                .map(lists -> {
                    List<String> allSessions = new ArrayList<>();
                    for (List<String> batch : lists) {
                        allSessions.addAll(batch);
                    }
                    return "{\"sessions\":[" + String.join(",", allSessions) + "]}";
                });
    }

    /**
     * Parse goosed response and extract individual session JSON strings,
     * injecting agentId into each.
     */
    @SuppressWarnings("unchecked")
    private List<String> extractSessionsArray(String json, String agentId) {
        List<String> result = new ArrayList<>();
        try {
            Map<String, Object> wrapper = MAPPER.readValue(json,
                    new TypeReference<Map<String, Object>>() {});
            Object sessionsObj = wrapper.get("sessions");
            if (sessionsObj instanceof List<?> sessions) {
                for (Object s : sessions) {
                    if (s instanceof Map<?, ?> sessionMap) {
                        Map<String, Object> mutable = new java.util.LinkedHashMap<>((Map<String, Object>) sessionMap);
                        mutable.put("agentId", agentId);
                        result.add(MAPPER.writeValueAsString(mutable));
                    }
                }
            }
        } catch (Exception e) {
            // If parsing fails, try treating as a raw array
            try {
                List<Map<String, Object>> sessions = MAPPER.readValue(json,
                        new TypeReference<List<Map<String, Object>>>() {});
                for (Map<String, Object> s : sessions) {
                    Map<String, Object> mutable = new java.util.LinkedHashMap<>(s);
                    mutable.put("agentId", agentId);
                    result.add(MAPPER.writeValueAsString(mutable));
                }
            } catch (Exception e2) {
                log.warn("Failed to parse sessions from instance: {}", e2.getMessage());
            }
        }
        return result;
    }

    @GetMapping("/agents/{agentId}/sessions")
    public Mono<Void> listAgentSessions(@PathVariable String agentId,
                                         ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.proxy(
                        exchange.getRequest(), exchange.getResponse(),
                        instance.getPort(), "/sessions"));
    }

    @GetMapping(value = "/agents/{agentId}/sessions/{sessionId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<String> getSession(@PathVariable String agentId,
                                    @PathVariable String sessionId,
                                    ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.fetchJson(instance.getPort(), "/sessions/" + sessionId))
                .map(json -> injectAgentId(json, agentId))
                .onErrorResume(WebClientResponseException.class, e -> {
                    if (e.getStatusCode() == HttpStatus.NOT_FOUND) {
                        return Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND, "session not found"));
                    }
                    return Mono.error(e);
                });
    }

    /**
     * Global session detail: GET /sessions/{sessionId}?agentId=X
     */
    @GetMapping(value = "/sessions/{sessionId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<String> getSessionGlobal(@PathVariable String sessionId,
                                          @RequestParam String agentId,
                                          ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.fetchJson(instance.getPort(), "/sessions/" + sessionId))
                .map(json -> injectAgentId(json, agentId))
                .onErrorResume(WebClientResponseException.class, e -> {
                    if (e.getStatusCode() == HttpStatus.NOT_FOUND) {
                        return Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND, "session not found"));
                    }
                    return Mono.error(e);
                });
    }

    @DeleteMapping("/agents/{agentId}/sessions/{sessionId}")
    public Mono<Void> deleteSession(@PathVariable String agentId,
                                     @PathVariable String sessionId,
                                     ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        sessionService.removeOwner(sessionId);
        cleanupUploads(userId, agentId, sessionId);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.proxy(
                        exchange.getRequest(), exchange.getResponse(),
                        instance.getPort(), "/sessions/" + sessionId));
    }

    /**
     * Global session delete: DELETE /sessions/{sessionId}?agentId=X
     */
    @DeleteMapping("/sessions/{sessionId}")
    public Mono<Void> deleteSessionGlobal(@PathVariable String sessionId,
                                           @RequestParam String agentId,
                                           ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        sessionService.removeOwner(sessionId);
        cleanupUploads(userId, agentId, sessionId);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.proxy(
                        exchange.getRequest(), exchange.getResponse(),
                        instance.getPort(), "/sessions/" + sessionId));
    }

    /**
     * Inject agentId into a session JSON response.
     */
    private String injectAgentId(String json, String agentId) {
        try {
            java.util.Map<String, Object> map = MAPPER.readValue(json,
                    new TypeReference<java.util.Map<String, Object>>() {});
            map.put("agentId", agentId);
            return MAPPER.writeValueAsString(map);
        } catch (Exception e) {
            // If parsing fails, just return original
            return json;
        }
    }

    /**
     * Clean up uploaded files for a deleted session.
     */
    private void cleanupUploads(String userId, String agentId, String sessionId) {
        try {
            Path uploadsDir = agentConfigService.getUsersDir()
                    .resolve(userId).resolve("agents").resolve(agentId)
                    .resolve("uploads").resolve(sessionId);
            if (Files.isDirectory(uploadsDir)) {
                // Delete all files in the directory, then the directory itself
                try (var entries = Files.walk(uploadsDir)) {
                    entries.sorted(java.util.Comparator.reverseOrder())
                            .forEach(p -> {
                                try {
                                    Files.deleteIfExists(p);
                                } catch (IOException ignored) {
                                }
                            });
                }
            }
        } catch (Exception e) {
            log.warn("Failed to clean up uploads for session {}: {}", sessionId, e.getMessage());
        }
    }

    /**
     * Rename session: PUT /agents/{agentId}/sessions/{sessionId}/name
     */
    @PutMapping("/agents/{agentId}/sessions/{sessionId}/name")
    public Mono<Void> renameSession(@PathVariable String agentId,
                                     @PathVariable String sessionId,
                                     @RequestBody String body,
                                     ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.proxyWithBody(
                        exchange.getResponse(), instance.getPort(),
                        "/sessions/" + sessionId + "/name",
                        HttpMethod.PUT, body));
    }
}

package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.common.model.AgentRegistryEntry;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/gateway/agents")
public class AgentController {

    private final AgentConfigService agentConfigService;
    private final InstanceManager instanceManager;

    public AgentController(AgentConfigService agentConfigService, InstanceManager instanceManager) {
        this.agentConfigService = agentConfigService;
        this.instanceManager = instanceManager;
    }

    @GetMapping
    public Mono<Map<String, Object>> listAgents() {
        return Mono.fromCallable(() -> {
            List<Map<String, Object>> agents = agentConfigService.getRegistry().stream()
                    .map(entry -> {
                        Map<String, Object> config = agentConfigService.loadAgentConfigYaml(entry.id());
                        List<Map<String, String>> skills = agentConfigService.listSkills(entry.id());
                        Map<String, Object> agentMap = new LinkedHashMap<>();
                        agentMap.put("id", entry.id());
                        agentMap.put("name", entry.name());
                        agentMap.put("status", "configured");
                        agentMap.put("provider", config.getOrDefault("GOOSE_PROVIDER", ""));
                        agentMap.put("model", config.getOrDefault("GOOSE_MODEL", ""));
                        agentMap.put("skills", skills);
                        return (Map<String, Object>) agentMap;
                    })
                    .toList();
            return Map.<String, Object>of("agents", agents);
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping
    public Mono<ResponseEntity<Map<String, Object>>> createAgent(@RequestBody Map<String, String> body,
                                                                   ServerWebExchange exchange) {
        requireAdmin(exchange);
        String id = body.get("id");
        String name = body.get("name");
        if (id == null || id.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Agent ID is required");
        }
        if (name == null || name.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Agent name is required");
        }
        try {
            Map<String, Object> agent = agentConfigService.createAgent(id.strip(), name.strip());
            return Mono.just(ResponseEntity.status(HttpStatus.CREATED)
                    .body(Map.of("success", (Object) true, "agent", agent)));
        } catch (IllegalArgumentException e) {
            Map<String, Object> errorBody = new LinkedHashMap<>();
            errorBody.put("success", false);
            errorBody.put("error", e.getMessage());
            return Mono.just(ResponseEntity.badRequest().body(errorBody));
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to create agent");
        }
    }

    @DeleteMapping("/{id}")
    public Mono<ResponseEntity<Map<String, Object>>> deleteAgent(@PathVariable String id,
                                                                   ServerWebExchange exchange) {
        requireAdmin(exchange);
        try {
            instanceManager.stopAllForAgent(id);
            agentConfigService.deleteAgent(id);
            return Mono.just(ResponseEntity.ok(Map.of("success", (Object) true)));
        } catch (IllegalArgumentException e) {
            Map<String, Object> errorBody = new LinkedHashMap<>();
            errorBody.put("success", false);
            errorBody.put("error", e.getMessage());
            return Mono.just(ResponseEntity.badRequest().body(errorBody));
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to delete agent");
        }
    }

    @GetMapping("/{id}/skills")
    public Mono<Map<String, Object>> listSkills(@PathVariable String id, ServerWebExchange exchange) {
        requireAdmin(exchange);
        return Mono.just(Map.of("skills", agentConfigService.listSkills(id)));
    }

    @GetMapping("/{id}/config")
    public Mono<ResponseEntity<Map<String, Object>>> getConfig(@PathVariable String id,
                                                                 ServerWebExchange exchange) {
        requireAdmin(exchange);
        AgentRegistryEntry entry = agentConfigService.findAgent(id);
        if (entry == null) {
            return Mono.just(ResponseEntity.notFound().build());
        }
        Map<String, Object> config = agentConfigService.loadAgentConfigYaml(id);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", entry.id());
        result.put("name", entry.name());
        result.put("agentsMd", agentConfigService.readAgentsMd(id));
        result.put("provider", config.getOrDefault("GOOSE_PROVIDER", ""));
        result.put("model", config.getOrDefault("GOOSE_MODEL", ""));
        result.put("workingDir", agentConfigService.getAgentsDir().resolve(id).toString());
        return Mono.just(ResponseEntity.ok(result));
    }

    @PutMapping("/{id}/config")
    public Mono<ResponseEntity<Map<String, Object>>> updateConfig(@PathVariable String id,
                                                                    @RequestBody Map<String, String> body,
                                                                    ServerWebExchange exchange) {
        requireAdmin(exchange);
        AgentRegistryEntry entry = agentConfigService.findAgent(id);
        if (entry == null) {
            Map<String, Object> errorBody = new LinkedHashMap<>();
            errorBody.put("success", false);
            errorBody.put("error", "Agent '" + id + "' not found");
            return Mono.just(ResponseEntity.badRequest().body(errorBody));
        }
        String agentsMd = body.get("agentsMd");
        if (agentsMd != null) {
            try {
                agentConfigService.writeAgentsMd(id, agentsMd);
            } catch (Exception e) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to update config");
            }
        }
        return Mono.just(ResponseEntity.ok(Map.of("success", (Object) true)));
    }

    // ── Memory endpoints ──────────────────────────────────────────

    private static final java.util.regex.Pattern CATEGORY_PATTERN =
            java.util.regex.Pattern.compile("^[a-zA-Z0-9_-]+$");

    @GetMapping("/{id}/memory")
    public Mono<ResponseEntity<Map<String, Object>>> listMemory(@PathVariable String id,
                                                                  ServerWebExchange exchange) {
        requireAdmin(exchange);
        return Mono.fromCallable(() -> {
            List<Map<String, String>> files = agentConfigService.listMemoryFiles(id);
            return ResponseEntity.ok(Map.<String, Object>of("files", files));
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @GetMapping("/{id}/memory/{category}")
    public Mono<ResponseEntity<Map<String, Object>>> getMemoryFile(@PathVariable String id,
                                                                     @PathVariable String category,
                                                                     ServerWebExchange exchange) {
        requireAdmin(exchange);
        if (!isValidCategory(category)) {
            return badCategory();
        }
        return Mono.<ResponseEntity<Map<String, Object>>>fromCallable(() -> {
            String content = agentConfigService.readMemoryFile(id, category);
            if (content == null) {
                return ResponseEntity.notFound().<Map<String, Object>>build();
            }
            return ResponseEntity.ok(Map.<String, Object>of("category", category, "content", content));
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PutMapping("/{id}/memory/{category}")
    public Mono<ResponseEntity<Map<String, Object>>> putMemoryFile(@PathVariable String id,
                                                                     @PathVariable String category,
                                                                     @RequestBody Map<String, String> body,
                                                                     ServerWebExchange exchange) {
        requireAdmin(exchange);
        if (!isValidCategory(category)) {
            return badCategory();
        }
        return Mono.fromCallable(() -> {
            try {
                agentConfigService.writeMemoryFile(id, category, body.getOrDefault("content", ""));
                return ResponseEntity.ok(Map.<String, Object>of("success", (Object) true));
            } catch (IllegalArgumentException e) {
                return ResponseEntity.badRequest()
                        .body(Map.<String, Object>of("success", (Object) false, "error", e.getMessage()));
            }
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @DeleteMapping("/{id}/memory/{category}")
    public Mono<ResponseEntity<Map<String, Object>>> deleteMemoryFile(@PathVariable String id,
                                                                        @PathVariable String category,
                                                                        ServerWebExchange exchange) {
        requireAdmin(exchange);
        if (!isValidCategory(category)) {
            return badCategory();
        }
        return Mono.fromCallable(() -> {
            try {
                agentConfigService.deleteMemoryFile(id, category);
                return ResponseEntity.ok(Map.<String, Object>of("success", (Object) true));
            } catch (IllegalArgumentException e) {
                return ResponseEntity.badRequest()
                        .body(Map.<String, Object>of("success", (Object) false, "error", e.getMessage()));
            }
        }).subscribeOn(Schedulers.boundedElastic());
    }

    private static boolean isValidCategory(String category) {
        return CATEGORY_PATTERN.matcher(category).matches();
    }

    private static Mono<ResponseEntity<Map<String, Object>>> badCategory() {
        return Mono.just(ResponseEntity.badRequest()
                .body(Map.of("success", (Object) false, "error", "Invalid category name")));
    }

    private void requireAdmin(ServerWebExchange exchange) {
        UserContextFilter.requireAdmin(exchange);
    }
}

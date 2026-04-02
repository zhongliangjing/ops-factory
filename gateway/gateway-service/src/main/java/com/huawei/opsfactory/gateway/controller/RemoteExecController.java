package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.service.RemoteExecutionService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/gateway/remote")
public class RemoteExecController {

    private static final Logger log = LogManager.getLogger(RemoteExecController.class);

    private final RemoteExecutionService remoteExecutionService;

    public RemoteExecController(RemoteExecutionService remoteExecutionService) {
        this.remoteExecutionService = remoteExecutionService;
    }

    @PostMapping("/execute")
    public Mono<ResponseEntity<Map<String, Object>>> execute(
            @RequestBody Map<String, Object> request,
            ServerWebExchange exchange) {
        UserContextFilter.requireAdmin(exchange);

        String hostId = (String) request.get("hostId");
        String command = (String) request.get("command");
        Object timeoutObj = request.get("timeout");
        int timeout = (timeoutObj instanceof Number) ? ((Number) timeoutObj).intValue() : 30;

        if (hostId == null || hostId.isBlank()) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("success", false);
            body.put("error", "hostId is required");
            return Mono.just(ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body));
        }
        if (command == null || command.isBlank()) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("success", false);
            body.put("error", "command is required");
            return Mono.just(ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body));
        }

        final int finalTimeout = timeout;
        return Mono.fromCallable(() -> {
            try {
                Map<String, Object> result = remoteExecutionService.execute(hostId, command, finalTimeout);

                // Check for whitelist rejection
                if (Boolean.FALSE.equals(result.get("success"))
                        && result.containsKey("rejectedCommands")) {
                    Map<String, Object> body = new LinkedHashMap<>();
                    body.put("success", false);
                    body.put("error", "Command rejected by whitelist");
                    body.put("rejectedCommands", result.get("rejectedCommands"));
                    body.put("message", result.getOrDefault("message", ""));
                    return ResponseEntity.status(HttpStatus.FORBIDDEN).body(body);
                }

                Map<String, Object> body = new LinkedHashMap<>();
                body.put("hostId", result.get("hostId"));
                body.put("hostName", result.get("hostName"));
                body.put("exitCode", result.get("exitCode"));
                body.put("output", result.get("output"));
                body.put("error", result.getOrDefault("error", ""));
                body.put("duration", result.get("duration"));
                return ResponseEntity.ok(body);
            } catch (Exception e) {
                log.error("Failed to execute remote command on host {}", hostId, e);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", e.getMessage());
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
            }
        }).subscribeOn(Schedulers.boundedElastic());
    }
}

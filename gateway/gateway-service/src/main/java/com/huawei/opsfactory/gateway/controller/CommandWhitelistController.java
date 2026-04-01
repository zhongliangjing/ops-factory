package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.service.CommandWhitelistService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/gateway/command-whitelist")
public class CommandWhitelistController {

    private static final Logger log = LogManager.getLogger(CommandWhitelistController.class);

    private final CommandWhitelistService commandWhitelistService;

    public CommandWhitelistController(CommandWhitelistService commandWhitelistService) {
        this.commandWhitelistService = commandWhitelistService;
    }

    @GetMapping
    public Mono<Map<String, Object>> getWhitelist(ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            Map<String, Object> whitelist = commandWhitelistService.getWhitelist();
            return whitelist;
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping
    public Mono<ResponseEntity<Map<String, Object>>> addCommand(
            @RequestBody Map<String, Object> request,
            ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            try {
                commandWhitelistService.addCommand(request);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", true);
                body.put("command", request);
                return ResponseEntity.status(HttpStatus.CREATED).body(body);
            } catch (IllegalArgumentException e) {
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", e.getMessage());
                return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
            } catch (Exception e) {
                log.error("Failed to add command to whitelist", e);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", e.getMessage());
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
            }
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PutMapping("/{pattern}")
    public Mono<ResponseEntity<Map<String, Object>>> updateCommand(
            @PathVariable String pattern,
            @RequestBody Map<String, Object> request,
            ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            try {
                commandWhitelistService.updateCommand(pattern, request);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", true);
                body.put("command", request);
                return ResponseEntity.ok(body);
            } catch (IllegalArgumentException e) {
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", "Command not found: " + pattern);
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
            } catch (Exception e) {
                log.error("Failed to update command {}", pattern, e);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", e.getMessage());
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
            }
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @DeleteMapping("/{pattern}")
    public Mono<ResponseEntity<Map<String, Object>>> deleteCommand(
            @PathVariable String pattern,
            ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            try {
                commandWhitelistService.deleteCommand(pattern);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", true);
                return ResponseEntity.ok(body);
            } catch (IllegalArgumentException e) {
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", "Command not found: " + pattern);
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
            }
        }).subscribeOn(Schedulers.boundedElastic());
    }
}

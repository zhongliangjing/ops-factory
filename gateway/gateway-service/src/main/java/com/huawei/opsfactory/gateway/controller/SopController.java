package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.service.SopService;
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
@RequestMapping("/gateway/sops")
public class SopController {

    private static final Logger log = LogManager.getLogger(SopController.class);

    private final SopService sopService;

    public SopController(SopService sopService) {
        this.sopService = sopService;
    }

    @GetMapping
    public Mono<Map<String, Object>> listSops(ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            List<Map<String, Object>> sops = sopService.listSops();
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("sops", sops);
            return result;
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @GetMapping("/{id}")
    public Mono<ResponseEntity<Map<String, Object>>> getSop(
            @PathVariable String id,
            ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            Map<String, Object> sop = sopService.getSop(id);
            if (sop == null) {
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", "SOP not found: " + id);
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
            }
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("success", true);
            body.put("sop", sop);
            return ResponseEntity.ok(body);
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping
    public Mono<ResponseEntity<Map<String, Object>>> createSop(
            @RequestBody Map<String, Object> request,
            ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            try {
                Map<String, Object> sop = sopService.createSop(request);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", true);
                body.put("sop", sop);
                return ResponseEntity.status(HttpStatus.CREATED).body(body);
            } catch (IllegalArgumentException e) {
                log.warn("Duplicate SOP name: {}", e.getMessage());
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", e.getMessage());
                return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
            } catch (Exception e) {
                log.error("Failed to create SOP", e);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", e.getMessage());
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
            }
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PutMapping("/{id}")
    public Mono<ResponseEntity<Map<String, Object>>> updateSop(
            @PathVariable String id,
            @RequestBody Map<String, Object> request,
            ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            try {
                Map<String, Object> sop = sopService.updateSop(id, request);
                if (sop == null) {
                    Map<String, Object> body = new LinkedHashMap<>();
                    body.put("success", false);
                    body.put("error", "SOP not found: " + id);
                    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
                }
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", true);
                body.put("sop", sop);
                return ResponseEntity.ok(body);
            } catch (IllegalArgumentException e) {
                log.warn("SOP update conflict: {}", e.getMessage());
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", e.getMessage());
                return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
            } catch (Exception e) {
                log.error("Failed to update SOP {}", id, e);
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", e.getMessage());
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
            }
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @DeleteMapping("/{id}")
    public Mono<ResponseEntity<Map<String, Object>>> deleteSop(
            @PathVariable String id,
            ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            boolean deleted = sopService.deleteSop(id);
            if (!deleted) {
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("error", "SOP not found: " + id);
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body);
            }
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("success", true);
            return ResponseEntity.ok(body);
        }).subscribeOn(Schedulers.boundedElastic());
    }
}

package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.common.model.UserRole;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.Map;

@RestController
public class StatusController {

    private final GatewayProperties properties;

    public StatusController(GatewayProperties properties) {
        this.properties = properties;
    }

    @GetMapping("/status")
    public Mono<String> status() {
        return Mono.just("ok");
    }

    @GetMapping("/me")
    public Mono<Map<String, Object>> me(ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        UserRole role = exchange.getAttribute(UserContextFilter.USER_ROLE_ATTR);
        return Mono.just(Map.of(
                "userId", userId != null ? userId : "unknown",
                "role", role != null ? role.name().toLowerCase() : "user"));
    }

    @GetMapping("/config")
    public Mono<Map<String, Object>> config() {
        GatewayProperties.OfficePreview op = properties.getOfficePreview();
        return Mono.just(Map.of(
                "officePreview", Map.of(
                        "enabled", op.isEnabled(),
                        "onlyofficeUrl", op.getOnlyofficeUrl(),
                        "fileBaseUrl", op.getFileBaseUrl())));
    }
}

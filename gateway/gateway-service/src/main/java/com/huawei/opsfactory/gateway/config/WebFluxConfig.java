package com.huawei.opsfactory.gateway.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

@Configuration
public class WebFluxConfig {

    private final GatewayProperties properties;

    public WebFluxConfig(GatewayProperties properties) {
        this.properties = properties;
    }

    @Bean
    @Order(0)
    public WebFilter corsFilter() {
        return (ServerWebExchange exchange, WebFilterChain chain) -> {
            String origin = properties.getCorsOrigin();
            var response = exchange.getResponse();
            var headers = response.getHeaders();

            headers.set("Access-Control-Allow-Origin", origin != null ? origin : "*");
            headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            headers.set("Access-Control-Allow-Headers", "x-secret-key, x-user-id, content-type, authorization");
            headers.set("Access-Control-Expose-Headers", "*");
            headers.set("Access-Control-Max-Age", "3600");

            if ("OPTIONS".equalsIgnoreCase(exchange.getRequest().getMethodValue())) {
                response.setStatusCode(HttpStatus.NO_CONTENT);
                return response.setComplete();
            }

            return chain.filter(exchange);
        };
    }
}

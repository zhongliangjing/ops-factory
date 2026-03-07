package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.Base64;

@Service
public class LangfuseService {

    private static final Logger log = LogManager.getLogger(LangfuseService.class);

    private final GatewayProperties.Langfuse config;
    private final WebClient webClient;

    public LangfuseService(GatewayProperties properties) {
        this.config = properties.getLangfuse();
        this.webClient = WebClient.builder()
                .codecs(c -> c.defaultCodecs().maxInMemorySize(10 * 1024 * 1024))
                .build();
    }

    public boolean isConfigured() {
        return config.getHost() != null && !config.getHost().isBlank()
                && config.getPublicKey() != null && !config.getPublicKey().isBlank()
                && config.getSecretKey() != null && !config.getSecretKey().isBlank();
    }

    public Mono<String> getTraces(String from, String to, int limit, boolean errorsOnly) {
        if (!isConfigured()) {
            return Mono.just("[]");
        }
        String url = config.getHost() + "/api/public/traces?fromTimestamp=" + from
                + "&toTimestamp=" + to + "&limit=" + limit;
        return doGet(url);
    }

    public Mono<String> getObservations(String from, String to) {
        if (!isConfigured()) {
            return Mono.just("[]");
        }
        String url = config.getHost() + "/api/public/observations?fromTimestamp=" + from
                + "&toTimestamp=" + to;
        return doGet(url);
    }

    private Mono<String> doGet(String url) {
        String auth = Base64.getEncoder().encodeToString(
                (config.getPublicKey() + ":" + config.getSecretKey()).getBytes());
        return webClient.get()
                .uri(url)
                .header("Authorization", "Basic " + auth)
                .retrieve()
                .bodyToMono(String.class)
                .onErrorResume(e -> {
                    log.error("Langfuse API error: {}", e.getMessage());
                    return Mono.just("[]");
                });
    }
}

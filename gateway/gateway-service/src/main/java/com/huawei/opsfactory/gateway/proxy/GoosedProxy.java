package com.huawei.opsfactory.gateway.proxy;

import com.huawei.opsfactory.gateway.common.constants.GatewayConstants;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

@Component
public class GoosedProxy {

    private final WebClient webClient;
    private final GatewayProperties properties;

    public GoosedProxy(GatewayProperties properties) {
        this.properties = properties;
        this.webClient = WebClient.builder()
                .codecs(configurer -> configurer.defaultCodecs()
                        .maxInMemorySize(50 * 1024 * 1024))
                .build();
    }

    /**
     * Proxy an arbitrary request to a goosed instance.
     */
    public Mono<Void> proxy(ServerHttpRequest request, ServerHttpResponse response, int port, String path) {
        String target = "http://127.0.0.1:" + port + path;
        HttpMethod method = request.getMethod();

        WebClient.RequestBodySpec spec = webClient.method(method != null ? method : HttpMethod.GET)
                .uri(target)
                .headers(h -> copyHeaders(request.getHeaders(), h));

        WebClient.RequestHeadersSpec<?> ready;
        if (method == HttpMethod.POST || method == HttpMethod.PUT || method == HttpMethod.PATCH) {
            ready = spec.body(BodyInserters.fromDataBuffers(request.getBody()));
        } else {
            ready = spec;
        }

        return ready.exchangeToMono(upstream -> {
            response.setStatusCode(upstream.statusCode());
            response.getHeaders().addAll(upstream.headers().asHttpHeaders());
            return response.writeWith(upstream.bodyToFlux(DataBuffer.class));
        });
    }

    /**
     * Proxy with a pre-read JSON body string (for routes that need body inspection).
     */
    public Mono<Void> proxyWithBody(ServerHttpResponse response, int port, String path,
                                     HttpMethod method, String body) {
        String target = "http://127.0.0.1:" + port + path;

        return webClient.method(method)
                .uri(target)
                .header(GatewayConstants.HEADER_SECRET_KEY, properties.getSecretKey())
                .header(HttpHeaders.CONTENT_TYPE, "application/json")
                .bodyValue(body)
                .exchangeToMono(upstream -> {
                    response.setStatusCode(upstream.statusCode());
                    response.getHeaders().addAll(upstream.headers().asHttpHeaders());
                    return response.writeWith(upstream.bodyToFlux(DataBuffer.class));
                });
    }

    /**
     * Fetch JSON from a goosed instance and return the raw body string.
     */
    public Mono<String> fetchJson(int port, String path) {
        String target = "http://127.0.0.1:" + port + path;
        return webClient.get()
                .uri(target)
                .header(GatewayConstants.HEADER_SECRET_KEY, properties.getSecretKey())
                .retrieve()
                .bodyToMono(String.class);
    }

    public WebClient getWebClient() {
        return webClient;
    }

    public String getSecretKey() {
        return properties.getSecretKey();
    }

    private void copyHeaders(HttpHeaders source, HttpHeaders target) {
        target.addAll(source);
        // Inject secret key for goosed auth
        target.set(GatewayConstants.HEADER_SECRET_KEY, properties.getSecretKey());
    }
}

package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.common.constants.GatewayConstants;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.proxy.GoosedProxy;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

@RestController
@RequestMapping("/ops-gateway/agents/{agentId}/mcp")
public class McpController {

    private final InstanceManager instanceManager;
    private final GoosedProxy goosedProxy;

    public McpController(InstanceManager instanceManager, GoosedProxy goosedProxy) {
        this.instanceManager = instanceManager;
        this.goosedProxy = goosedProxy;
    }

    @GetMapping
    public Mono<Void> getMcpExtensions(@PathVariable String agentId, ServerWebExchange exchange) {
        requireAdmin(exchange);
        // Route to sys instance
        return instanceManager.getOrSpawn(agentId, GatewayConstants.SYS_USER)
                .flatMap(instance -> goosedProxy.proxy(
                        exchange.getRequest(), exchange.getResponse(),
                        instance.getPort(), "/config/extensions"));
    }

    @PostMapping
    public Mono<String> createMcpExtension(@PathVariable String agentId,
                                            @RequestBody String body,
                                            ServerWebExchange exchange) {
        requireAdmin(exchange);

        // Persist config to the sys instance, then recycle all agent instances so
        // subsequent requests start from a clean process with the updated config.
        return instanceManager.getOrSpawn(agentId, GatewayConstants.SYS_USER)
                .flatMap(sysInstance -> {
                    WebClient wc = goosedProxy.getWebClient();
                    String sysTarget = goosedProxy.goosedBaseUrl(sysInstance.getPort());

                    return wc.post()
                            .uri(sysTarget + "/config/extensions")
                            .header(GatewayConstants.HEADER_SECRET_KEY, goosedProxy.getSecretKey())
                            .header("Content-Type", "application/json")
                            .bodyValue(body)
                            .retrieve()
                            .bodyToMono(String.class)
                            .map(sysResult -> {
                                instanceManager.stopAllForAgent(agentId);
                                return sysResult;
                            });
                });
    }

    @DeleteMapping("/{name}")
    public Mono<String> deleteMcpExtension(@PathVariable String agentId,
                                            @PathVariable String name,
                                            ServerWebExchange exchange) {
        requireAdmin(exchange);
        String path = "/config/extensions/" + name;

        return instanceManager.getOrSpawn(agentId, GatewayConstants.SYS_USER)
                .flatMap(sysInstance -> {
                    WebClient wc = goosedProxy.getWebClient();
                    String sysTarget = goosedProxy.goosedBaseUrl(sysInstance.getPort());

                    return wc.delete()
                            .uri(sysTarget + path)
                            .header(GatewayConstants.HEADER_SECRET_KEY, goosedProxy.getSecretKey())
                            .retrieve()
                            .bodyToMono(String.class)
                            .map(sysResult -> {
                                instanceManager.stopAllForAgent(agentId);
                                return sysResult;
                            });
                });
    }

    private void requireAdmin(ServerWebExchange exchange) {
        UserContextFilter.requireAdmin(exchange);
    }
}

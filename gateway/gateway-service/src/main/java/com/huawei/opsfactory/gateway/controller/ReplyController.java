package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.hook.HookContext;
import com.huawei.opsfactory.gateway.hook.HookPipeline;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.proxy.GoosedProxy;
import com.huawei.opsfactory.gateway.proxy.SseRelayService;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@RestController
@RequestMapping("/agents/{agentId}")
public class ReplyController {

    private final InstanceManager instanceManager;
    private final SseRelayService sseRelayService;
    private final GoosedProxy goosedProxy;
    private final HookPipeline hookPipeline;

    public ReplyController(InstanceManager instanceManager,
                           SseRelayService sseRelayService,
                           GoosedProxy goosedProxy,
                           HookPipeline hookPipeline) {
        this.instanceManager = instanceManager;
        this.sseRelayService = sseRelayService;
        this.goosedProxy = goosedProxy;
        this.hookPipeline = hookPipeline;
    }

    /**
     * SSE streaming chat reply.
     * Runs request hooks (vision, body limit, file attachment) then proxies to goosed.
     */
    @PostMapping(value = {"/reply", "/agent/reply"}, produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<DataBuffer> reply(@PathVariable String agentId,
                                   @RequestBody String body,
                                   ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        HookContext ctx = new HookContext(body, agentId, userId);
        return hookPipeline.executeRequest(ctx)
                .flatMapMany(processedBody ->
                        instanceManager.getOrSpawn(agentId, userId)
                                .flatMapMany(instance -> {
                                    instance.touch();
                                    instanceManager.touchAllForUser(userId);
                                    return sseRelayService.relay(instance.getPort(), "/reply", processedBody);
                                }));
    }

    @PostMapping({"/resume", "/agent/resume"})
    public Mono<Void> resume(@PathVariable String agentId,
                              @RequestBody String body,
                              ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.proxyWithBody(
                        exchange.getResponse(), instance.getPort(), "/agent/resume",
                        HttpMethod.POST, body));
    }

    @PostMapping({"/restart", "/agent/restart"})
    public Mono<Void> restart(@PathVariable String agentId,
                               @RequestBody String body,
                               ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.proxyWithBody(
                        exchange.getResponse(), instance.getPort(), "/agent/restart",
                        HttpMethod.POST, body));
    }

    @PostMapping({"/stop", "/agent/stop"})
    public Mono<Void> stop(@PathVariable String agentId,
                            @RequestBody String body,
                            ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        return instanceManager.getOrSpawn(agentId, userId)
                .flatMap(instance -> goosedProxy.proxyWithBody(
                        exchange.getResponse(), instance.getPort(), "/agent/stop",
                        HttpMethod.POST, body));
    }
}

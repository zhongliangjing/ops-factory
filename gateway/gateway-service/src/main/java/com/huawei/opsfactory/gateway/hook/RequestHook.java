package com.huawei.opsfactory.gateway.hook;

import reactor.core.publisher.Mono;

public interface RequestHook {

    /**
     * Process a request through this hook.
     * May modify the context body or reject the request by returning Mono.error().
     */
    Mono<HookContext> process(HookContext ctx);
}

package com.huawei.opsfactory.gateway.hook;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.util.List;

@Component
public class HookPipeline {

    private static final Logger log = LogManager.getLogger(HookPipeline.class);

    private final List<RequestHook> hooks;

    public HookPipeline(List<RequestHook> hooks) {
        this.hooks = hooks;
        log.info("Registered {} request hooks", hooks.size());
    }

    /**
     * Run all request hooks in order. Returns the (possibly modified) body.
     * If any hook returns an error Mono, the pipeline short-circuits.
     */
    public Mono<String> executeRequest(HookContext ctx) {
        Mono<HookContext> chain = Mono.just(ctx);
        for (RequestHook hook : hooks) {
            chain = chain.flatMap(hook::process);
        }
        return chain.map(HookContext::getBody);
    }
}

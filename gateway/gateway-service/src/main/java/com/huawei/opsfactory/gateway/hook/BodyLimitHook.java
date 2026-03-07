package com.huawei.opsfactory.gateway.hook;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;

@Component
@Order(1)
public class BodyLimitHook implements RequestHook {

    private final long maxBytes;

    public BodyLimitHook(GatewayProperties properties) {
        // Base64 overhead: ~33% larger than raw bytes
        this.maxBytes = (long) properties.getUpload().getMaxFileSizeMb() * 1024 * 1024 * 4 / 3;
    }

    @Override
    public Mono<HookContext> process(HookContext ctx) {
        if (ctx.getBody() != null && ctx.getBody().length() > maxBytes) {
            return Mono.error(new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                    "Request body exceeds maximum allowed size"));
        }
        return Mono.just(ctx);
    }
}

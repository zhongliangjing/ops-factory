package com.huawei.opsfactory.gateway.hook;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Test;
import org.springframework.web.server.ResponseStatusException;
import reactor.test.StepVerifier;

public class BodyLimitHookTest {

    private BodyLimitHook hook;

    @Before
    public void setUp() {
        GatewayProperties properties = new GatewayProperties();
        properties.getUpload().setMaxFileSizeMb(1); // 1MB limit for testing
        hook = new BodyLimitHook(properties);
    }

    @Test
    public void testSmallBody_passes() {
        HookContext ctx = new HookContext("{\"message\": \"hello\"}", "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testOversizedBody_fails() {
        // Create a body larger than 1MB * 4/3 ≈ 1.33MB
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 1_500_000; i++) {
            sb.append('x');
        }
        HookContext ctx = new HookContext(sb.toString(), "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectError(ResponseStatusException.class)
                .verify();
    }

    @Test
    public void testNullBody_passes() {
        HookContext ctx = new HookContext(null, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }
}

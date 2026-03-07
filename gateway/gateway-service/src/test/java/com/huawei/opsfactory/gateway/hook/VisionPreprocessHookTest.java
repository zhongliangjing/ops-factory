package com.huawei.opsfactory.gateway.hook;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import org.junit.Before;
import org.junit.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import reactor.test.StepVerifier;

import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class VisionPreprocessHookTest {

    private GatewayProperties properties;
    private AgentConfigService agentConfigService;
    private VisionPreprocessHook hook;

    @Before
    public void setUp() {
        properties = new GatewayProperties();
        agentConfigService = mock(AgentConfigService.class);
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(Map.of());
        hook = new VisionPreprocessHook(properties, agentConfigService);
    }

    @Test
    public void testNoContent_passthrough() {
        HookContext ctx = new HookContext("{\"user_message\": {\"text\": \"hello\"}}", "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testNoImages_passthrough() {
        String body = "{\"user_message\": {\"content\": [{\"type\": \"text\", \"text\": \"hello\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testNonArrayContent_passthrough() {
        String body = "{\"user_message\": {\"content\": \"plain text\"}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testMissingUserMessage_passthrough() {
        String body = "{\"other_field\": \"value\"}";
        HookContext ctx = new HookContext(body, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testOffMode_rejectsImages() {
        Map<String, Object> agentConfig = new HashMap<>();
        agentConfig.put("vision_mode", "off");
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(agentConfig);

        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectErrorSatisfies(e -> {
                    assertTrue(e instanceof ResponseStatusException);
                    assertEquals(HttpStatus.BAD_REQUEST, ((ResponseStatusException) e).getStatus());
                    assertTrue(e.getMessage().contains("not enabled"));
                })
                .verify();
    }

    @Test
    public void testPassthroughMode_allowsImages() {
        Map<String, Object> agentConfig = new HashMap<>();
        agentConfig.put("vision_mode", "passthrough");
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(agentConfig);

        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testPreprocessMode_noModel_error() {
        Map<String, Object> agentConfig = new HashMap<>();
        agentConfig.put("vision_mode", "preprocess");
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(agentConfig);

        // Set global vision config to have no model
        properties.getVision().setMode("preprocess");
        properties.getVision().setModel("");

        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectErrorSatisfies(e -> {
                    assertTrue(e instanceof ResponseStatusException);
                    assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, ((ResponseStatusException) e).getStatus());
                    assertTrue(e.getMessage().contains("not configured"));
                })
                .verify();
    }

    @Test
    public void testDefaultMode_off_rejectsImages() {
        // Default vision mode is "off"
        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectError(ResponseStatusException.class)
                .verify();
    }

    @Test
    public void testInvalidJson_passthrough() {
        HookContext ctx = new HookContext("not valid json{{", "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testConfigResolution_agentOverridesGlobal() {
        // Agent-level vision_mode=off should override global passthrough
        Map<String, Object> agentConfig = new HashMap<>();
        agentConfig.put("vision_mode", "off");
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(agentConfig);

        properties.getVision().setMode("passthrough");

        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectError(ResponseStatusException.class)
                .verify();
    }

    @Test
    public void testConfigResolution_globalFallback() {
        // No agent-level config, should use global passthrough
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(Map.of());
        properties.getVision().setMode("passthrough");

        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testUnknownMode_passthrough() {
        Map<String, Object> agentConfig = new HashMap<>();
        agentConfig.put("vision_mode", "unknown-mode");
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(agentConfig);

        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testMixedContent_passthroughMode() {
        // Set passthrough mode explicitly
        Map<String, Object> agentConfig = new HashMap<>();
        agentConfig.put("vision_mode", "passthrough");
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(agentConfig);

        String body = "{\"user_message\": {\"content\": [" +
                "{\"type\": \"text\", \"text\": \"describe this\"}," +
                "{\"type\": \"image\", \"data\": \"abc\", \"mimeType\": \"image/png\"}" +
                "]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testEmptyContentArray_passthrough() {
        String body = "{\"user_message\": {\"content\": []}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testPreprocessMode_blankModel_error() {
        Map<String, Object> agentConfig = new HashMap<>();
        agentConfig.put("vision_mode", "preprocess");
        agentConfig.put("vision_model", "   "); // blank, not null
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(agentConfig);

        properties.getVision().setModel("");

        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectError(ResponseStatusException.class)
                .verify();
    }

    @Test
    public void testConfigResolution_gooseProviderFallback() {
        Map<String, Object> agentConfig = new HashMap<>();
        agentConfig.put("GOOSE_PROVIDER", "anthropic");
        agentConfig.put("GOOSE_MODEL", "claude-3");
        agentConfig.put("vision_mode", "off");
        when(agentConfigService.loadAgentConfigYaml("agent1")).thenReturn(agentConfig);

        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        // Should still reject because mode is "off"
        StepVerifier.create(hook.process(ctx))
                .expectError(ResponseStatusException.class)
                .verify();
    }
}

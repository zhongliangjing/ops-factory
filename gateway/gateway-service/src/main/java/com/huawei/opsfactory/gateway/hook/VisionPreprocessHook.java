package com.huawei.opsfactory.gateway.hook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Component
@Order(3)
public class VisionPreprocessHook implements RequestHook {

    private static final Logger log = LogManager.getLogger(VisionPreprocessHook.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final String DEFAULT_PROMPT = "Describe this image in detail.";

    private final GatewayProperties properties;
    private final AgentConfigService agentConfigService;
    private final WebClient webClient;

    public VisionPreprocessHook(GatewayProperties properties,
                                AgentConfigService agentConfigService) {
        this.properties = properties;
        this.agentConfigService = agentConfigService;
        this.webClient = WebClient.builder()
                .codecs(c -> c.defaultCodecs().maxInMemorySize(50 * 1024 * 1024))
                .build();
    }

    @Override
    public Mono<HookContext> process(HookContext ctx) {
        try {
            JsonNode root = objectMapper.readTree(ctx.getBody());
            JsonNode content = root.path("user_message").path("content");
            if (!content.isArray()) {
                return Mono.just(ctx);
            }

            boolean hasImages = false;
            for (JsonNode item : content) {
                if ("image".equals(item.path("type").asText())) {
                    hasImages = true;
                    break;
                }
            }
            if (!hasImages) {
                return Mono.just(ctx);
            }

            VisionConfig config = resolveConfig(ctx.getAgentId());

            return switch (config.mode()) {
                case "off" -> Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Image upload is not enabled for this agent. Configure vision.mode in agent config."));
                case "passthrough" -> Mono.just(ctx);
                case "preprocess" -> {
                    if (config.model() == null || config.model().isBlank()) {
                        yield Mono.error(new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                                "Vision model not configured for preprocess mode"));
                    }
                    yield preprocessImages(ctx, root, content, config);
                }
                default -> Mono.just(ctx);
            };
        } catch (ResponseStatusException e) {
            return Mono.error(e);
        } catch (Exception e) {
            log.error("Error in VisionPreprocessHook", e);
            return Mono.just(ctx);
        }
    }

    private Mono<HookContext> preprocessImages(HookContext ctx, JsonNode root,
                                                JsonNode content, VisionConfig config) {
        List<JsonNode> imageNodes = new ArrayList<>();
        List<JsonNode> nonImageNodes = new ArrayList<>();

        for (JsonNode item : content) {
            if ("image".equals(item.path("type").asText())) {
                imageNodes.add(item);
            } else {
                nonImageNodes.add(item);
            }
        }

        return Flux.range(0, imageNodes.size())
                .flatMap(i -> analyzeImage(imageNodes.get(i), config, i + 1))
                .collectList()
                .map(descriptions -> {
                    var sb = new StringBuilder();
                    for (int i = 0; i < descriptions.size(); i++) {
                        if (i > 0) {
                            sb.append("\n\n");
                        }
                        sb.append("[Image ").append(i + 1).append(" Analysis]\n");
                        sb.append(descriptions.get(i));
                    }

                    ObjectNode rootObj = (ObjectNode) root.deepCopy();
                    ArrayNode newContent = objectMapper.createArrayNode();
                    for (JsonNode nonImage : nonImageNodes) {
                        newContent.add(nonImage);
                    }
                    ObjectNode analysisItem = objectMapper.createObjectNode();
                    analysisItem.put("type", "text");
                    analysisItem.put("text", sb.toString());
                    newContent.add(analysisItem);

                    ((ObjectNode) rootObj.path("user_message")).set("content", newContent);
                    ctx.setBody(rootObj.toString());
                    return ctx;
                });
    }

    private Mono<String> analyzeImage(JsonNode imageNode, VisionConfig config, int index) {
        if ("anthropic".equals(config.provider())) {
            return analyzeWithAnthropic(imageNode, config, index);
        } else {
            return analyzeWithOpenAI(imageNode, config, index);
        }
    }

    private Mono<String> analyzeWithAnthropic(JsonNode imageNode, VisionConfig config, int index) {
        String baseUrl = config.baseUrl() == null || config.baseUrl().isBlank()
                ? "https://api.anthropic.com" : config.baseUrl();
        String url = baseUrl + "/v1/messages";

        String mimeType = imageNode.path("mimeType").asText("image/png");
        String data = imageNode.path("data").asText("");

        String requestBody = buildAnthropicRequest(config.model(), config.maxTokens(), config.prompt(), mimeType, data);

        return webClient.post()
                .uri(url)
                .header("Content-Type", "application/json")
                .header("x-api-key", config.apiKey())
                .header("anthropic-version", "2023-06-01")
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(String.class)
                .map(response -> {
                    try {
                        JsonNode resp = objectMapper.readTree(response);
                        JsonNode respContent = resp.path("content");
                        if (respContent.isArray()) {
                            for (JsonNode block : respContent) {
                                if ("text".equals(block.path("type").asText())) {
                                    String text = block.path("text").asText();
                                    if (!text.isEmpty()) {
                                        return text;
                                    }
                                }
                            }
                        }
                        return "[Vision model returned empty response]";
                    } catch (Exception e) {
                        return "[Failed to parse vision response]";
                    }
                })
                .onErrorResume(e -> {
                    log.error("Anthropic vision API error for image {}: {}", index, e.getMessage());
                    return Mono.just("[Failed to analyze image " + index + ": " + e.getMessage() + "]");
                });
    }

    private Mono<String> analyzeWithOpenAI(JsonNode imageNode, VisionConfig config, int index) {
        String baseUrl = config.baseUrl() == null || config.baseUrl().isBlank()
                ? "https://openrouter.ai/api/v1" : config.baseUrl();
        if (!baseUrl.endsWith("/v1") && !baseUrl.contains("/v1/")) {
            baseUrl = baseUrl + "/v1";
        }
        String url = baseUrl + "/chat/completions";

        String mimeType = imageNode.path("mimeType").asText("image/png");
        String data = imageNode.path("data").asText("");

        String requestBody = buildOpenAIRequest(config.model(), config.maxTokens(), config.prompt(), mimeType, data);

        WebClient.RequestHeadersSpec<?> spec = webClient.post()
                .uri(url)
                .header("Content-Type", "application/json")
                .bodyValue(requestBody);

        if (config.apiKey() != null && !config.apiKey().isBlank()) {
            spec = webClient.post()
                    .uri(url)
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + config.apiKey())
                    .bodyValue(requestBody);
        }

        return spec.retrieve()
                .bodyToMono(String.class)
                .map(response -> {
                    try {
                        JsonNode resp = objectMapper.readTree(response);
                        String text = resp.path("choices").path(0)
                                .path("message").path("content").asText("");
                        return text.isEmpty() ? "[Vision model returned empty response]" : text;
                    } catch (Exception e) {
                        return "[Failed to parse vision response]";
                    }
                })
                .onErrorResume(e -> {
                    log.error("OpenAI vision API error for image {}: {}", index, e.getMessage());
                    return Mono.just("[Failed to analyze image " + index + ": " + e.getMessage() + "]");
                });
    }

    private String buildAnthropicRequest(String model, int maxTokens,
                                          String prompt, String mimeType, String data) {
        try {
            ObjectNode root = objectMapper.createObjectNode();
            root.put("model", model);
            root.put("max_tokens", maxTokens);

            ArrayNode messages = objectMapper.createArrayNode();
            ObjectNode message = objectMapper.createObjectNode();
            message.put("role", "user");

            ArrayNode content = objectMapper.createArrayNode();
            ObjectNode textItem = objectMapper.createObjectNode();
            textItem.put("type", "text");
            textItem.put("text", prompt);
            content.add(textItem);

            ObjectNode imageItem = objectMapper.createObjectNode();
            imageItem.put("type", "image");
            ObjectNode source = objectMapper.createObjectNode();
            source.put("type", "base64");
            source.put("media_type", mimeType);
            source.put("data", data);
            imageItem.set("source", source);
            content.add(imageItem);

            message.set("content", content);
            messages.add(message);
            root.set("messages", messages);

            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new RuntimeException("Failed to build Anthropic request", e);
        }
    }

    private String buildOpenAIRequest(String model, int maxTokens,
                                       String prompt, String mimeType, String data) {
        try {
            ObjectNode root = objectMapper.createObjectNode();
            root.put("model", model);
            root.put("max_tokens", maxTokens);

            ArrayNode messages = objectMapper.createArrayNode();
            ObjectNode message = objectMapper.createObjectNode();
            message.put("role", "user");

            ArrayNode content = objectMapper.createArrayNode();
            ObjectNode textItem = objectMapper.createObjectNode();
            textItem.put("type", "text");
            textItem.put("text", prompt);
            content.add(textItem);

            ObjectNode imageItem = objectMapper.createObjectNode();
            imageItem.put("type", "image_url");
            ObjectNode imageUrl = objectMapper.createObjectNode();
            imageUrl.put("url", "data:" + mimeType + ";base64," + data);
            imageItem.set("image_url", imageUrl);
            content.add(imageItem);

            message.set("content", content);
            messages.add(message);
            root.set("messages", messages);

            return objectMapper.writeValueAsString(root);
        } catch (Exception e) {
            throw new RuntimeException("Failed to build OpenAI request", e);
        }
    }

    @SuppressWarnings("unchecked")
    private VisionConfig resolveConfig(String agentId) {
        GatewayProperties.Vision global = properties.getVision();
        Map<String, Object> agentConf = agentConfigService.loadAgentConfigYaml(agentId);

        // Vision config can be nested under "vision:" key or flat as "vision_mode" etc.
        Map<String, Object> visionSection = Map.of();
        Object visionObj = agentConf.get("vision");
        if (visionObj instanceof Map<?, ?>) {
            visionSection = (Map<String, Object>) visionObj;
        }

        String agentMode = firstNonBlank(getStr(visionSection, "mode"), getStr(agentConf, "vision_mode"));
        String mode = firstNonBlank(agentMode, global.getMode(), "passthrough");

        String agentProvider = firstNonBlank(getStr(visionSection, "provider"), getStr(agentConf, "vision_provider"));
        String gooseProvider = getStr(agentConf, "GOOSE_PROVIDER");
        String provider = firstNonBlank(agentProvider, gooseProvider, global.getProvider());

        String agentModel = firstNonBlank(getStr(visionSection, "model"), getStr(agentConf, "vision_model"));
        String gooseModel = getStr(agentConf, "GOOSE_MODEL");
        String model = firstNonBlank(agentModel, gooseModel, global.getModel());

        String agentApiKey = firstNonBlank(getStr(visionSection, "apiKey"), getStr(agentConf, "vision_api_key"));
        String litellmKey = getStr(agentConf, "LITELLM_API_KEY");
        String openaiKey = getStr(agentConf, "OPENAI_API_KEY");
        String apiKey = firstNonBlank(agentApiKey, litellmKey, openaiKey, global.getApiKey());

        String agentBaseUrl = firstNonBlank(getStr(visionSection, "baseUrl"), getStr(agentConf, "vision_base_url"));
        String litellmHost = getStr(agentConf, "LITELLM_HOST");
        String openaiHost = getStr(agentConf, "OPENAI_HOST");
        String baseUrl = firstNonBlank(agentBaseUrl, litellmHost, openaiHost, global.getBaseUrl());

        int maxTokens = global.getMaxTokens() > 0 ? global.getMaxTokens() : 1024;

        return new VisionConfig(mode, provider, model, apiKey, baseUrl, maxTokens, DEFAULT_PROMPT);
    }

    private static String getStr(Map<String, Object> map, String key) {
        Object val = map.get(key);
        return val != null ? val.toString() : null;
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        return "";
    }

    private record VisionConfig(String mode, String provider, String model,
                                String apiKey, String baseUrl, int maxTokens, String prompt) {
    }
}

package com.huawei.opsfactory.gateway.hook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
@Order(2)
public class FileAttachmentHook implements RequestHook {

    private static final Logger log = LogManager.getLogger(FileAttachmentHook.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final AgentConfigService agentConfigService;

    public FileAttachmentHook(AgentConfigService agentConfigService) {
        this.agentConfigService = agentConfigService;
    }

    @Override
    public Mono<HookContext> process(HookContext ctx) {
        try {
            JsonNode root = objectMapper.readTree(ctx.getBody());
            JsonNode userMessage = root.path("user_message");
            if (userMessage.isMissingNode()) {
                return Mono.just(ctx);
            }

            JsonNode content = userMessage.path("content");
            if (!content.isArray()) {
                return Mono.just(ctx);
            }

            // Find text content and extract file paths
            Path usersDir = agentConfigService.getUsersDir();
            String usersDirStr = usersDir.toAbsolutePath().normalize().toString();

            // Pattern to match paths within the users directory
            Pattern pathPattern = Pattern.compile(
                    Pattern.quote(usersDirStr) + "[/\\\\][^\\s\"']+");

            for (JsonNode item : content) {
                if (!"text".equals(item.path("type").asText())) {
                    continue;
                }
                String text = item.path("text").asText("");
                List<String> paths = extractPaths(pathPattern, text);

                for (String filePath : paths) {
                    Path resolved = Path.of(filePath).toAbsolutePath().normalize();
                    // Security: path must be within users/{userId}/agents
                    Path userAgentsDir = usersDir.resolve(ctx.getUserId()).resolve("agents");
                    if (!resolved.startsWith(userAgentsDir.toAbsolutePath().normalize())) {
                        log.warn("Path escapes user directory: {}", filePath);
                        return Mono.error(new ResponseStatusException(HttpStatus.FORBIDDEN,
                                "Access denied: file path outside user directory"));
                    }
                    if (!Files.exists(resolved)) {
                        log.warn("Referenced file does not exist: {}", filePath);
                        return Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND,
                                "Referenced file not found: " + resolved.getFileName()));
                    }
                }
            }

            return Mono.just(ctx);
        } catch (ResponseStatusException e) {
            return Mono.error(e);
        } catch (Exception e) {
            log.error("Error in FileAttachmentHook", e);
            return Mono.just(ctx);
        }
    }

    private List<String> extractPaths(Pattern pattern, String text) {
        List<String> paths = new ArrayList<>();
        Matcher matcher = pattern.matcher(text);
        while (matcher.find()) {
            paths.add(matcher.group());
        }
        return paths;
    }
}

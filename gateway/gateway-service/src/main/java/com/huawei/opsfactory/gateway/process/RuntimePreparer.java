package com.huawei.opsfactory.gateway.process;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@Component
public class RuntimePreparer {

    private static final Logger log = LogManager.getLogger(RuntimePreparer.class);

    private final GatewayProperties properties;

    public RuntimePreparer(GatewayProperties properties) {
        this.properties = properties;
    }

    /**
     * Prepare the per-user runtime directory for an agent instance.
     * Creates directories and symlinks to shared agent config.
     *
     * @return the runtime root path for this (agentId, userId)
     */
    public Path prepare(String agentId, String userId) throws IOException {
        Path projectRoot = Path.of(properties.getPaths().getProjectRoot()).toAbsolutePath().normalize();
        Path gatewayRoot = projectRoot.resolve("gateway");
        Path agentsDir = gatewayRoot.resolve(properties.getPaths().getAgentsDir());
        Path usersDir = gatewayRoot.resolve(properties.getPaths().getUsersDir());

        Path userAgentDir = usersDir.resolve(userId).resolve("agents").resolve(agentId);
        Files.createDirectories(userAgentDir);

        // Symlink config -> shared agent config
        Path configLink = userAgentDir.resolve("config");
        Path agentConfigDir = agentsDir.resolve(agentId).resolve("config");
        if (!Files.exists(configLink) && Files.exists(agentConfigDir)) {
            Path relative = userAgentDir.relativize(agentConfigDir);
            Files.createSymbolicLink(configLink, relative);
            log.info("Created config symlink: {} -> {}", configLink, relative);
        }

        // Symlink AGENTS.md
        Path agentsMdLink = userAgentDir.resolve("AGENTS.md");
        Path agentsMdSource = agentsDir.resolve(agentId).resolve("AGENTS.md");
        if (!Files.exists(agentsMdLink) && Files.exists(agentsMdSource)) {
            Path relative = userAgentDir.relativize(agentsMdSource);
            Files.createSymbolicLink(agentsMdLink, relative);
        }

        // Create data and uploads dirs
        Files.createDirectories(userAgentDir.resolve("data"));
        Files.createDirectories(userAgentDir.resolve("uploads"));

        return userAgentDir;
    }
}

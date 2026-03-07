package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.common.model.UserRole;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import com.huawei.opsfactory.gateway.service.LangfuseService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/monitoring")
public class MonitoringController {

    private final InstanceManager instanceManager;
    private final AgentConfigService agentConfigService;
    private final LangfuseService langfuseService;
    private final GatewayProperties gatewayProperties;

    @Value("${server.port:3000}")
    private int serverPort;

    @Value("${server.address:0.0.0.0}")
    private String serverHost;

    public MonitoringController(InstanceManager instanceManager,
                                AgentConfigService agentConfigService,
                                LangfuseService langfuseService,
                                GatewayProperties gatewayProperties) {
        this.instanceManager = instanceManager;
        this.agentConfigService = agentConfigService;
        this.langfuseService = langfuseService;
        this.gatewayProperties = gatewayProperties;
    }

    @GetMapping("/system")
    public Mono<Map<String, Object>> system(ServerWebExchange exchange) {
        requireAdmin(exchange);
        long uptimeMs = ManagementFactory.getRuntimeMXBean().getUptime();
        long idleTimeoutMs = gatewayProperties.getIdle().getTimeoutMinutes() * 60_000L;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("gateway", Map.of(
                "uptimeMs", uptimeMs,
                "host", serverHost,
                "port", serverPort));
        result.put("agents", Map.of(
                "configured", agentConfigService.getRegistry().size()));
        result.put("idle", Map.of(
                "timeoutMs", idleTimeoutMs));
        return Mono.just(result);
    }

    @GetMapping("/instances")
    public Mono<Map<String, Object>> instances(ServerWebExchange exchange) {
        requireAdmin(exchange);
        List<ManagedInstance> allInstances = new ArrayList<>(instanceManager.getAllInstances());

        // Group by agentId
        Map<String, List<Map<String, Object>>> grouped = allInstances.stream()
                .collect(Collectors.groupingBy(
                        ManagedInstance::getAgentId,
                        LinkedHashMap::new,
                        Collectors.mapping(inst -> {
                            Map<String, Object> m = new LinkedHashMap<>();
                            m.put("userId", inst.getUserId());
                            m.put("port", inst.getPort());
                            m.put("pid", inst.getPid());
                            m.put("status", inst.getStatus().name().toLowerCase());
                            m.put("lastActivity", inst.getLastActivity());
                            return m;
                        }, Collectors.toList())));

        List<Map<String, Object>> byAgent = new ArrayList<>();
        for (var entry : grouped.entrySet()) {
            Map<String, Object> agentGroup = new LinkedHashMap<>();
            agentGroup.put("agentId", entry.getKey());
            agentGroup.put("instances", entry.getValue());
            byAgent.add(agentGroup);
        }

        long running = allInstances.stream()
                .filter(i -> i.getStatus() == ManagedInstance.Status.RUNNING)
                .count();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalInstances", allInstances.size());
        result.put("runningInstances", (int) running);
        result.put("byAgent", byAgent);
        return Mono.just(result);
    }

    @GetMapping("/status")
    public Mono<Map<String, Object>> langfuseStatus(ServerWebExchange exchange) {
        requireAdmin(exchange);
        return Mono.just(Map.of("enabled", langfuseService.isConfigured()));
    }

    @GetMapping("/traces")
    public Mono<String> traces(@RequestParam(required = false) String from,
                                @RequestParam(required = false) String to,
                                @RequestParam(defaultValue = "20") int limit,
                                @RequestParam(defaultValue = "false") boolean errorsOnly,
                                ServerWebExchange exchange) {
        requireAdmin(exchange);
        if (from == null || to == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "from and to parameters are required");
        }
        return langfuseService.getTraces(from, to, limit, errorsOnly);
    }

    @GetMapping("/observations")
    public Mono<String> observations(@RequestParam(required = false) String from,
                                      @RequestParam(required = false) String to,
                                      ServerWebExchange exchange) {
        requireAdmin(exchange);
        if (from == null || to == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "from and to parameters are required");
        }
        return langfuseService.getObservations(from, to);
    }

    private void requireAdmin(ServerWebExchange exchange) {
        UserRole role = exchange.getAttribute(UserContextFilter.USER_ROLE_ATTR);
        if (role == null || !role.isAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "admin access required");
        }
    }
}

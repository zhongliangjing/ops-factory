package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.monitoring.MetricsBuffer;
import com.huawei.opsfactory.gateway.monitoring.MetricsSnapshot;
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
@RequestMapping("/gateway/monitoring")
public class MonitoringController {

    private final InstanceManager instanceManager;
    private final AgentConfigService agentConfigService;
    private final LangfuseService langfuseService;
    private final GatewayProperties gatewayProperties;
    private final MetricsBuffer metricsBuffer;

    @Value("${server.port:3000}")
    private int serverPort;

    @Value("${server.address:0.0.0.0}")
    private String serverHost;

    public MonitoringController(InstanceManager instanceManager,
                                AgentConfigService agentConfigService,
                                LangfuseService langfuseService,
                                GatewayProperties gatewayProperties,
                                MetricsBuffer metricsBuffer) {
        this.instanceManager = instanceManager;
        this.agentConfigService = agentConfigService;
        this.langfuseService = langfuseService;
        this.gatewayProperties = gatewayProperties;
        this.metricsBuffer = metricsBuffer;
    }

    @GetMapping("/system")
    public Mono<Map<String, Object>> system(ServerWebExchange exchange) {
        requireAdmin(exchange);
        long uptimeMs = ManagementFactory.getRuntimeMXBean().getUptime();
        long idleTimeoutMs = gatewayProperties.getIdle().getTimeoutMinutes() * 60_000L;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("gateway", Map.of(
                "uptimeMs", uptimeMs,
                "uptimeFormatted", formatUptime(uptimeMs),
                "host", serverHost,
                "port", serverPort));
        result.put("agents", Map.of(
                "configured", agentConfigService.getRegistry().size()));
        result.put("idle", Map.of(
                "timeoutMs", idleTimeoutMs,
                "checkIntervalMs", gatewayProperties.getIdle().getCheckIntervalMs()));

        Map<String, Object> langfuse = new LinkedHashMap<>();
        langfuse.put("configured", langfuseService.isConfigured());
        String langfuseHost = gatewayProperties.getLangfuse().getHost();
        langfuse.put("host", (langfuseHost != null && !langfuseHost.isEmpty()) ? langfuseHost : null);
        result.put("langfuse", langfuse);

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
                            m.put("agentId", inst.getAgentId());
                            m.put("userId", inst.getUserId());
                            m.put("port", inst.getPort());
                            m.put("pid", inst.getPid());
                            m.put("status", inst.getStatus().name().toLowerCase());
                            m.put("lastActivity", inst.getLastActivity());
                            m.put("idleSinceMs", System.currentTimeMillis() - inst.getLastActivity());
                            return m;
                        }, Collectors.toList())));

        List<Map<String, Object>> byAgent = new ArrayList<>();
        for (var entry : grouped.entrySet()) {
            Map<String, Object> agentGroup = new LinkedHashMap<>();
            agentGroup.put("agentId", entry.getKey());
            var agentEntry = agentConfigService.findAgent(entry.getKey());
            agentGroup.put("agentName", agentEntry != null ? agentEntry.name() : entry.getKey());
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
        boolean configured = langfuseService.isConfigured();
        String langfuseHost = gatewayProperties.getLangfuse().getHost();

        if (!configured) {
            return Mono.just(Map.of("enabled", false));
        }

        return langfuseService.checkReachable()
                .map(reachable -> {
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("enabled", true);
                    result.put("reachable", reachable);
                    result.put("host", langfuseHost != null ? langfuseHost : "");
                    return result;
                });
    }

    @GetMapping("/overview")
    public Mono<Map<String, Object>> overview(@RequestParam(required = false) String from,
                                               @RequestParam(required = false) String to,
                                               ServerWebExchange exchange) {
        requireAdmin(exchange);
        if (from == null || to == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "from and to parameters are required");
        }
        return langfuseService.getOverview(from, to);
    }

    @GetMapping("/traces")
    public Mono<List<Map<String, Object>>> traces(@RequestParam(required = false) String from,
                                                   @RequestParam(required = false) String to,
                                                   @RequestParam(defaultValue = "20") int limit,
                                                   @RequestParam(defaultValue = "false") boolean errorsOnly,
                                                   ServerWebExchange exchange) {
        requireAdmin(exchange);
        if (from == null || to == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "from and to parameters are required");
        }
        return langfuseService.getTracesFormatted(from, to, limit, errorsOnly);
    }

    @GetMapping("/observations")
    public Mono<Map<String, Object>> observations(@RequestParam(required = false) String from,
                                                   @RequestParam(required = false) String to,
                                                   ServerWebExchange exchange) {
        requireAdmin(exchange);
        if (from == null || to == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "from and to parameters are required");
        }
        return langfuseService.getObservationsFormatted(from, to);
    }

    @GetMapping("/metrics")
    public Mono<Map<String, Object>> metrics(ServerWebExchange exchange) {
        requireAdmin(exchange);
        List<MetricsSnapshot> snapshots = metricsBuffer.getSnapshots(120);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("collectionIntervalSec", 30);
        result.put("maxSlots", 120);
        result.put("returnedSlots", snapshots.size());

        // Current state from latest snapshot
        if (!snapshots.isEmpty()) {
            MetricsSnapshot latest = snapshots.get(snapshots.size() - 1);
            Map<String, Object> current = new LinkedHashMap<>();
            current.put("activeInstances", latest.getActiveInstances());
            current.put("totalTokens", latest.getTotalTokens());
            current.put("totalSessions", latest.getTotalSessions());
            result.put("current", current);
        } else {
            result.put("current", null);
        }

        // Aggregate stats over all snapshots (weighted mean by request count)
        int totalRequests = 0;
        int totalErrors = 0;
        double weightedLatencySum = 0;
        double weightedTtftSum = 0;
        for (MetricsSnapshot s : snapshots) {
            totalRequests += s.getRequestCount();
            totalErrors += s.getErrorCount();
            weightedLatencySum += s.getAvgLatencyMs() * s.getRequestCount();
            weightedTtftSum += s.getAvgTtftMs() * s.getRequestCount();
        }
        double avgLatency = totalRequests > 0 ? weightedLatencySum / totalRequests : 0;
        double avgTtft = totalRequests > 0 ? weightedTtftSum / totalRequests : 0;

        // Compute average tokens/sec (mean of non-zero snapshots)
        double tokensPerSecSum = 0;
        int tokensPerSecCount = 0;
        // Compute aggregate p95 latency (max of per-snapshot p95 as approximation)
        double maxP95Latency = 0;
        double maxP95Ttft = 0;
        for (MetricsSnapshot s : snapshots) {
            if (s.getTokensPerSec() > 0) {
                tokensPerSecSum += s.getTokensPerSec();
                tokensPerSecCount++;
            }
            if (s.getP95LatencyMs() > maxP95Latency) maxP95Latency = s.getP95LatencyMs();
            if (s.getP95TtftMs() > maxP95Ttft) maxP95Ttft = s.getP95TtftMs();
        }
        double avgTokensPerSec = tokensPerSecCount > 0 ? tokensPerSecSum / tokensPerSecCount : 0;

        Map<String, Object> aggregate = new LinkedHashMap<>();
        aggregate.put("totalRequests", totalRequests);
        aggregate.put("totalErrors", totalErrors);
        aggregate.put("avgLatencyMs", Math.round(avgLatency * 100.0) / 100.0);
        aggregate.put("avgTtftMs", Math.round(avgTtft * 100.0) / 100.0);
        aggregate.put("avgTokensPerSec", Math.round(avgTokensPerSec * 100.0) / 100.0);
        aggregate.put("p95LatencyMs", Math.round(maxP95Latency * 100.0) / 100.0);
        aggregate.put("p95TtftMs", Math.round(maxP95Ttft * 100.0) / 100.0);
        result.put("aggregate", aggregate);

        // Time series (oldest first)
        List<Map<String, Object>> series = new ArrayList<>();
        for (MetricsSnapshot s : snapshots) {
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("t", s.getTimestamp());
            point.put("instances", s.getActiveInstances());
            point.put("tokens", s.getTotalTokens());
            point.put("requests", s.getRequestCount());
            point.put("avgLatency", Math.round(s.getAvgLatencyMs() * 100.0) / 100.0);
            point.put("avgTtft", Math.round(s.getAvgTtftMs() * 100.0) / 100.0);
            point.put("p95Latency", Math.round(s.getP95LatencyMs() * 100.0) / 100.0);
            point.put("p95Ttft", Math.round(s.getP95TtftMs() * 100.0) / 100.0);
            point.put("bytes", s.getTotalBytes());
            point.put("errors", s.getErrorCount());
            point.put("tokensPerSec", Math.round(s.getTokensPerSec() * 100.0) / 100.0);
            series.add(point);
        }
        result.put("series", series);

        // Per-agent metrics breakdown
        result.put("agentMetrics", metricsBuffer.getAgentStats());

        return Mono.just(result);
    }

    private static String formatUptime(long ms) {
        long seconds = ms / 1000;
        long days = seconds / 86400;
        long hours = (seconds % 86400) / 3600;
        long minutes = (seconds % 3600) / 60;
        long secs = seconds % 60;
        if (days > 0) return days + "d " + hours + "h " + minutes + "m";
        if (hours > 0) return hours + "h " + minutes + "m";
        return minutes + "m " + secs + "s";
    }

    private void requireAdmin(ServerWebExchange exchange) {
        UserContextFilter.requireAdmin(exchange);
    }
}

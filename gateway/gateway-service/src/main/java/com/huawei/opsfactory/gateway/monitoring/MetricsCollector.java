package com.huawei.opsfactory.gateway.monitoring;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.proxy.GoosedProxy;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Collects metrics from running goosed instances every 30 seconds.
 * Calls GET /sessions/insights on each instance and aggregates with
 * request timing data captured by the SSE relay layer.
 */
@Component
public class MetricsCollector {

    private static final Logger log = LogManager.getLogger(MetricsCollector.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final InstanceManager instanceManager;
    private final GoosedProxy goosedProxy;
    private final MetricsBuffer metricsBuffer;
    private long previousTotalTokens = -1;

    public MetricsCollector(InstanceManager instanceManager,
                            GoosedProxy goosedProxy,
                            MetricsBuffer metricsBuffer) {
        this.instanceManager = instanceManager;
        this.goosedProxy = goosedProxy;
        this.metricsBuffer = metricsBuffer;
    }

    @Scheduled(fixedDelay = 30000)
    public void collect() {
        try {
            doCollect();
        } catch (Exception e) {
            log.warn("Metrics collection failed: {}", e.getMessage());
        }
    }

    private void doCollect() {
        List<ManagedInstance> running = instanceManager.getAllInstances().stream()
                .filter(i -> i.getStatus() == ManagedInstance.Status.RUNNING)
                .collect(Collectors.toList());

        // Collect insights from all running instances concurrently
        List<Mono<long[]>> fetches = running.stream()
                .map(inst -> goosedProxy.fetchJson(inst.getPort(), "/sessions/insights")
                        .timeout(Duration.ofSeconds(5))
                        .map(json -> {
                            try {
                                JsonNode node = MAPPER.readTree(json);
                                return new long[]{
                                        node.path("total_tokens").asLong(0),
                                        node.path("total_sessions").asLong(0)
                                };
                            } catch (Exception e) {
                                return new long[]{0, 0};
                            }
                        })
                        .onErrorReturn(new long[]{0, 0}))
                .collect(Collectors.toList());

        List<long[]> results = Flux.merge(fetches).collectList()
                .block(Duration.ofSeconds(10));

        long totalTokens = 0;
        long totalSessions = 0;
        if (results != null) {
            for (long[] r : results) {
                totalTokens += r[0];
                totalSessions += r[1];
            }
        }

        // Drain request timings and compute latency stats
        List<RequestTiming> timings = metricsBuffer.drainTimings();

        int requestCount = timings.size();
        int errorCount = 0;
        long byteSum = 0;
        double avgLatency = 0;
        double avgTtft = 0;
        double p95Latency = 0;
        double p95Ttft = 0;

        if (!timings.isEmpty()) {
            List<Long> latencies = new ArrayList<>();
            List<Long> ttfts = new ArrayList<>();
            long latencySum = 0;
            long ttftSum = 0;

            for (RequestTiming t : timings) {
                latencies.add(t.getTotalMs());
                ttfts.add(t.getTtftMs());
                latencySum += t.getTotalMs();
                ttftSum += t.getTtftMs();
                byteSum += t.getTotalBytes();
                if (t.isError()) errorCount++;
            }

            avgLatency = (double) latencySum / requestCount;
            avgTtft = (double) ttftSum / requestCount;

            Collections.sort(latencies);
            Collections.sort(ttfts);
            int p95Index = (int) Math.ceil(requestCount * 0.95) - 1;
            p95Index = Math.max(0, Math.min(p95Index, requestCount - 1));
            p95Latency = latencies.get(p95Index);
            p95Ttft = ttfts.get(p95Index);
        }

        // Compute tokens/sec from delta
        double tokensPerSec = 0;
        if (previousTotalTokens >= 0 && totalTokens >= previousTotalTokens) {
            long deltaTokens = totalTokens - previousTotalTokens;
            tokensPerSec = deltaTokens / 30.0;
        }
        previousTotalTokens = totalTokens;

        // Build and record snapshot
        MetricsSnapshot snapshot = new MetricsSnapshot();
        snapshot.setTimestamp(System.currentTimeMillis());
        snapshot.setActiveInstances(running.size());
        snapshot.setTotalTokens(totalTokens);
        snapshot.setTotalSessions(totalSessions);
        snapshot.setRequestCount(requestCount);
        snapshot.setAvgLatencyMs(avgLatency);
        snapshot.setAvgTtftMs(avgTtft);
        snapshot.setP95LatencyMs(p95Latency);
        snapshot.setP95TtftMs(p95Ttft);
        snapshot.setTotalBytes(byteSum);
        snapshot.setErrorCount(errorCount);
        snapshot.setTokensPerSec(tokensPerSec);

        metricsBuffer.record(snapshot);
        metricsBuffer.persistToDisk();

        log.debug("Metrics collected: instances={} tokens={} sessions={} requests={} avgLatency={}ms",
                running.size(), totalTokens, totalSessions, requestCount, Math.round(avgLatency));
    }
}

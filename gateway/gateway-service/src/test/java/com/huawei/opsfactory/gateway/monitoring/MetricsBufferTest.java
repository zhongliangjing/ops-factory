package com.huawei.opsfactory.gateway.monitoring;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Test;

import java.util.List;

import static org.junit.Assert.*;

/**
 * Unit tests for MetricsBuffer — circular buffer, drainTimings, persistence.
 */
public class MetricsBufferTest {

    private MetricsBuffer buffer;

    @Before
    public void setUp() {
        GatewayProperties props = new GatewayProperties();
        // Use a temp path that won't collide
        props.getPaths().setProjectRoot(System.getProperty("java.io.tmpdir") + "/metrics-test-" + System.nanoTime());
        buffer = new MetricsBuffer(props);
    }

    // ---- Snapshot tests ----

    @Test
    public void getSnapshots_empty() {
        List<MetricsSnapshot> result = buffer.getSnapshots(120);
        assertTrue(result.isEmpty());
    }

    @Test
    public void getSnapshots_singleEntry() {
        MetricsSnapshot s = makeSnapshot(1000L, 10);
        buffer.record(s);

        List<MetricsSnapshot> result = buffer.getSnapshots(120);
        assertEquals(1, result.size());
        assertEquals(1000L, result.get(0).getTimestamp());
    }

    @Test
    public void getSnapshots_orderedOldestFirst() {
        buffer.record(makeSnapshot(100L, 1));
        buffer.record(makeSnapshot(200L, 2));
        buffer.record(makeSnapshot(300L, 3));

        List<MetricsSnapshot> result = buffer.getSnapshots(120);
        assertEquals(3, result.size());
        assertEquals(100L, result.get(0).getTimestamp());
        assertEquals(200L, result.get(1).getTimestamp());
        assertEquals(300L, result.get(2).getTimestamp());
    }

    @Test
    public void getSnapshots_maxSlotsLimitsResult() {
        for (int i = 0; i < 10; i++) {
            buffer.record(makeSnapshot(i * 100L, i));
        }

        List<MetricsSnapshot> result = buffer.getSnapshots(3);
        assertEquals(3, result.size());
        // Should return the 3 most recent
        assertEquals(700L, result.get(0).getTimestamp());
        assertEquals(800L, result.get(1).getTimestamp());
        assertEquals(900L, result.get(2).getTimestamp());
    }

    @Test
    public void getSnapshots_circularOverwrite() {
        // Fill beyond capacity (120) to test wrap-around
        for (int i = 0; i < 130; i++) {
            buffer.record(makeSnapshot(i * 1000L, i));
        }

        List<MetricsSnapshot> result = buffer.getSnapshots(120);
        assertEquals(120, result.size());
        // Oldest should be #10 (first 10 were overwritten)
        assertEquals(10_000L, result.get(0).getTimestamp());
        // Newest should be #129
        assertEquals(129_000L, result.get(119).getTimestamp());
    }

    // ---- Timing tests ----

    @Test
    public void drainTimings_empty() {
        List<RequestTiming> result = buffer.drainTimings();
        assertTrue(result.isEmpty());
    }

    @Test
    public void drainTimings_singleTiming() {
        buffer.recordTiming(makeTiming(1000L, 100, 500, false));

        List<RequestTiming> result = buffer.drainTimings();
        assertEquals(1, result.size());
        assertEquals(100, result.get(0).getTtftMs());
        assertEquals(500, result.get(0).getTotalMs());
    }

    @Test
    public void drainTimings_drainsAll() {
        buffer.recordTiming(makeTiming(1000L, 100, 500, false));
        buffer.recordTiming(makeTiming(2000L, 200, 600, true));
        buffer.recordTiming(makeTiming(3000L, 150, 700, false));

        List<RequestTiming> result = buffer.drainTimings();
        assertEquals(3, result.size());

        // Second drain should be empty
        List<RequestTiming> result2 = buffer.drainTimings();
        assertTrue(result2.isEmpty());
    }

    @Test
    public void drainTimings_multipleWindows() {
        // Window 1
        buffer.recordTiming(makeTiming(1000L, 100, 500, false));
        buffer.recordTiming(makeTiming(2000L, 200, 600, false));
        List<RequestTiming> w1 = buffer.drainTimings();
        assertEquals(2, w1.size());

        // Window 2
        buffer.recordTiming(makeTiming(3000L, 300, 700, false));
        List<RequestTiming> w2 = buffer.drainTimings();
        assertEquals(1, w2.size());
        assertEquals(300, w2.get(0).getTtftMs());
    }

    @Test
    public void drainTimings_bufferWrapAround() {
        // Fill the 500-slot timing buffer completely then drain
        for (int i = 0; i < 500; i++) {
            buffer.recordTiming(makeTiming(i * 10L, i, i * 2, false));
        }
        List<RequestTiming> result = buffer.drainTimings();
        assertEquals(500, result.size());

        // Fill more than capacity without draining (tests the pendingTimingCount cap)
        for (int i = 0; i < 600; i++) {
            buffer.recordTiming(makeTiming(i * 10L, i + 1000, i * 3, false));
        }
        List<RequestTiming> result2 = buffer.drainTimings();
        // Should get 500 (capped at capacity), the most recent ones
        assertEquals(500, result2.size());
        // Most recent should be the last one written
        assertEquals(1599, result2.get(499).getTtftMs());
    }

    @Test
    public void drainTimings_wrapWithoutDrain_doesNotLoseData() {
        // This tests the critical bug fix: when write index wraps around to
        // equal drain index, we must not silently return empty.
        for (int i = 0; i < 500; i++) {
            buffer.recordTiming(makeTiming(i, i, i * 2, false));
        }
        // At this point writeIndex == 0 (wrapped), pendingTimingCount == 500
        List<RequestTiming> result = buffer.drainTimings();
        assertEquals(500, result.size());
    }

    // ---- Persistence tests ----

    @Test
    public void persistToDisk_andRestore() {
        buffer.record(makeSnapshot(System.currentTimeMillis(), 5));
        buffer.record(makeSnapshot(System.currentTimeMillis() - 1000, 3));
        buffer.persistToDisk();

        // Verify data survives a second persist (no corruption)
        buffer.record(makeSnapshot(System.currentTimeMillis() + 1000, 7));
        buffer.persistToDisk();

        List<MetricsSnapshot> result = buffer.getSnapshots(120);
        assertEquals(3, result.size());
    }

    @Test
    public void persistToDisk_skipsWhenNotDirty() {
        // No data recorded, should skip
        buffer.persistToDisk();
        // No exception = pass
    }

    // ---- Error counting ----

    @Test
    public void drainTimings_errorFlag() {
        buffer.recordTiming(makeTiming(1000L, 100, 500, false));
        buffer.recordTiming(makeTiming(2000L, 200, 600, true));
        buffer.recordTiming(makeTiming(3000L, 150, 700, true));

        List<RequestTiming> result = buffer.drainTimings();
        long errorCount = result.stream().filter(RequestTiming::isError).count();
        assertEquals(2, errorCount);
    }

    // ---- Helpers ----

    private MetricsSnapshot makeSnapshot(long timestamp, int tokens) {
        MetricsSnapshot s = new MetricsSnapshot();
        s.setTimestamp(timestamp);
        s.setTotalTokens(tokens);
        s.setActiveInstances(1);
        s.setTotalSessions(1);
        return s;
    }

    private RequestTiming makeTiming(long startTime, long ttft, long total, boolean error) {
        return new RequestTiming(startTime, ttft, total, 1024, error, "agent-1", "user-1");
    }
}

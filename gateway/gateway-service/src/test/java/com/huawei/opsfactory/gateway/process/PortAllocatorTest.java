package com.huawei.opsfactory.gateway.process;

import org.junit.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.Assert.assertTrue;

public class PortAllocatorTest {

    @Test
    public void testAllocate_returnsValidPort() {
        PortAllocator allocator = new PortAllocator();
        int port = allocator.allocate();
        assertTrue("Port should be in valid range", port > 0 && port <= 65535);
    }

    @Test
    public void testAllocate_returnsDifferentPorts() {
        PortAllocator allocator = new PortAllocator();
        Set<Integer> ports = new HashSet<>();
        for (int i = 0; i < 10; i++) {
            ports.add(allocator.allocate());
        }
        // Should get mostly unique ports (race condition possible but unlikely in test)
        assertTrue("Should allocate mostly unique ports", ports.size() >= 5);
    }
}

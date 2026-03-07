package com.huawei.opsfactory.gateway.process;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.ServerSocket;

@Component
public class PortAllocator {

    /**
     * Allocate an available ephemeral port by binding to port 0
     * and immediately releasing it.
     */
    public int allocate() {
        try (ServerSocket socket = new ServerSocket(0)) {
            socket.setReuseAddress(true);
            return socket.getLocalPort();
        } catch (IOException e) {
            throw new RuntimeException("Failed to allocate an available port", e);
        }
    }
}

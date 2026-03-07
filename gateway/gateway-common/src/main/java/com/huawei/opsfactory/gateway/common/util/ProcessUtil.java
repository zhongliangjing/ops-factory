package com.huawei.opsfactory.gateway.common.util;

/**
 * Process management utility using JDK 21 APIs.
 */
public final class ProcessUtil {

    private ProcessUtil() {
    }

    /**
     * Get PID from a Process instance using Process.pid() (JDK 9+).
     */
    public static long getPid(Process process) {
        return process.pid();
    }

    /**
     * Check if a process is still alive.
     */
    public static boolean isAlive(Process process) {
        return process.isAlive();
    }

    /**
     * Gracefully stop a process: SIGTERM, wait, then force kill.
     */
    public static void stopGracefully(Process process, long graceMs) {
        if (!process.isAlive()) {
            return;
        }
        process.destroy();
        try {
            Thread.sleep(graceMs);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        if (process.isAlive()) {
            process.destroyForcibly();
        }
    }
}

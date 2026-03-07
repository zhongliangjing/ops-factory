package com.huawei.opsfactory.gateway.common.util;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class ProcessUtilTest {

    @Test
    public void testIsAlive_runningProcess() throws Exception {
        Process process = new ProcessBuilder("sleep", "10").start();
        try {
            assertTrue(ProcessUtil.isAlive(process));
        } finally {
            process.destroyForcibly();
        }
    }

    @Test
    public void testIsAlive_deadProcess() throws Exception {
        Process process = new ProcessBuilder("echo", "hello").start();
        process.waitFor();
        assertFalse(ProcessUtil.isAlive(process));
    }

    @Test
    public void testGetPid_returnsPositive() throws Exception {
        Process process = new ProcessBuilder("sleep", "5").start();
        try {
            long pid = ProcessUtil.getPid(process);
            assertTrue("PID should be positive", pid > 0);
        } finally {
            process.destroyForcibly();
        }
    }

    @Test
    public void testStopGracefully() throws Exception {
        Process process = new ProcessBuilder("sleep", "60").start();
        assertTrue(ProcessUtil.isAlive(process));

        ProcessUtil.stopGracefully(process, 100);

        // After stop, process should be dead
        assertFalse(ProcessUtil.isAlive(process));
    }

    @Test
    public void testStopGracefully_alreadyDead() throws Exception {
        Process process = new ProcessBuilder("echo", "done").start();
        process.waitFor();
        // Should not throw
        ProcessUtil.stopGracefully(process, 100);
        assertFalse(ProcessUtil.isAlive(process));
    }
}

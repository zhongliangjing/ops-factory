package com.huawei.opsfactory.gateway.common.util;

import org.junit.Test;

import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PathSanitizerTest {

    @Test
    public void testIsSafe_normalPath() {
        Path base = Path.of("/home/user/data");
        assertTrue(PathSanitizer.isSafe(base, "file.txt"));
        assertTrue(PathSanitizer.isSafe(base, "subdir/file.txt"));
    }

    @Test
    public void testIsSafe_traversalAttack() {
        Path base = Path.of("/home/user/data");
        assertFalse(PathSanitizer.isSafe(base, "../etc/passwd"));
        assertFalse(PathSanitizer.isSafe(base, "../../secret"));
        assertFalse(PathSanitizer.isSafe(base, "subdir/../../etc/passwd"));
    }

    @Test
    public void testIsSafe_nullPath() {
        Path base = Path.of("/home/user/data");
        assertFalse(PathSanitizer.isSafe(base, null));
    }

    @Test
    public void testSanitizeFilename_normal() {
        assertEquals("hello.txt", PathSanitizer.sanitizeFilename("hello.txt"));
        assertEquals("my-file_v2.pdf", PathSanitizer.sanitizeFilename("my-file_v2.pdf"));
    }

    @Test
    public void testSanitizeFilename_removesPathSeparators() {
        // Now extracts basename after last separator
        assertEquals("passwd", PathSanitizer.sanitizeFilename("/etc/passwd"));
        assertEquals("system32", PathSanitizer.sanitizeFilename("C:\\Windows\\system32"));
    }

    @Test
    public void testSanitizeFilename_removesTraversalDots() {
        String result = PathSanitizer.sanitizeFilename("../../../etc/passwd.txt");
        assertFalse("Should not contain '..'", result.contains(".."));
        assertTrue("Should contain 'passwd.txt'", result.contains("passwd.txt"));
    }

    @Test
    public void testSanitizeFilename_removesSpecialChars() {
        assertEquals("file_name_.txt", PathSanitizer.sanitizeFilename("file name!.txt"));
    }

    @Test
    public void testSanitizeFilename_null() {
        assertEquals("unnamed", PathSanitizer.sanitizeFilename(null));
    }

    @Test
    public void testSanitizeFilename_chineseCharacters() {
        String result = PathSanitizer.sanitizeFilename("测试文件.txt");
        assertTrue(result.contains("测试文件"));
        assertTrue(result.endsWith(".txt"));
    }
}

package com.huawei.opsfactory.gateway.common.util;

import java.nio.file.Path;

public final class PathSanitizer {

    private PathSanitizer() {
    }

    /**
     * Check that the resolved path stays within the allowed base directory.
     * Prevents path traversal attacks.
     */
    public static boolean isSafe(Path base, String relativePath) {
        if (relativePath == null || relativePath.contains("..")) {
            return false;
        }
        Path resolved = base.resolve(relativePath).normalize();
        return resolved.startsWith(base.normalize());
    }

    /**
     * Sanitize a filename by removing path separators and special characters.
     */
    public static String sanitizeFilename(String filename) {
        if (filename == null) {
            return "unnamed";
        }
        // Extract just the basename (after last separator)
        String basename = filename;
        int lastSlash = Math.max(basename.lastIndexOf('/'), basename.lastIndexOf('\\'));
        if (lastSlash >= 0) {
            basename = basename.substring(lastSlash + 1);
        }
        // Remove non-safe characters, keeping alphanumeric, dot, dash, underscore, CJK
        String sanitized = basename.replaceAll("[^a-zA-Z0-9._\\-\\u4e00-\\u9fff]", "_");
        // Collapse consecutive dots to prevent ".." traversal patterns
        sanitized = sanitized.replaceAll("\\.{2,}", ".");
        // Strip leading dots/underscores
        sanitized = sanitized.replaceAll("^[._]+", "");
        if (sanitized.isEmpty()) {
            return "unnamed";
        }
        return sanitized;
    }
}

package com.huawei.opsfactory.gateway.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.gateway.common.util.PathSanitizer;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static java.util.Map.entry;

@Service
public class FileService {

    private static final Map<String, String> MIME_TYPES = Map.ofEntries(
            entry("json", "application/json"),
            entry("pdf", "application/pdf"),
            entry("xml", "application/xml"),
            entry("zip", "application/zip"),
            entry("csv", "text/csv"),
            entry("txt", "text/plain"),
            entry("md", "text/markdown"),
            entry("html", "text/html"),
            entry("css", "text/css"),
            entry("js", "text/javascript"),
            entry("ts", "text/typescript"),
            entry("java", "text/x-java-source"),
            entry("py", "text/x-python"),
            entry("yaml", "text/yaml"),
            entry("yml", "text/yaml"),
            entry("png", "image/png"),
            entry("jpg", "image/jpeg"),
            entry("jpeg", "image/jpeg"),
            entry("gif", "image/gif"),
            entry("svg", "image/svg+xml"),
            entry("webp", "image/webp"),
            entry("bmp", "image/bmp"),
            entry("doc", "application/msword"),
            entry("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            entry("xls", "application/vnd.ms-excel"),
            entry("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            entry("ppt", "application/vnd.ms-powerpoint"),
            entry("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"));

    private static final Set<String> SKIP_DIRS = Set.of(
            "data", "state", "config", "node_modules", ".goose");

    private static final Set<String> SKIP_FILES = Set.of(
            ".DS_Store", "AGENTS.md", ".gitkeep");

    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            "txt", "md", "json", "csv", "xml", "yaml", "yml",
            "html", "css", "js", "ts", "java", "py", "go", "rs", "rb", "sh",
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
            "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp",
            "zip", "gz", "tar", "log");

    private static final Set<String> BLOCKED_EXTENSIONS = Set.of(
            "exe", "bat", "cmd", "com", "msi", "dll", "sys", "scr",
            "vbs", "vbe", "wsf", "wsh", "ps1");

    /**
     * List files recursively under a directory, filtering out system dirs and hidden files.
     */
    public List<Map<String, Object>> listFiles(Path dir) throws IOException {
        List<Map<String, Object>> files = new ArrayList<>();
        if (!Files.isDirectory(dir)) {
            return files;
        }
        listFilesRecursive(dir, dir, files);
        return files;
    }

    private void listFilesRecursive(Path base, Path current, List<Map<String, Object>> files) throws IOException {
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(current)) {
            for (Path entry : stream) {
                String name = entry.getFileName().toString();
                if (Files.isDirectory(entry)) {
                    if (!SKIP_DIRS.contains(name) && !name.startsWith(".")) {
                        listFilesRecursive(base, entry, files);
                    }
                } else {
                    if (!SKIP_FILES.contains(name)) {
                        int dot = name.lastIndexOf('.');
                        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase() : "";
                        files.add(Map.of(
                                "name", name,
                                "path", base.relativize(entry).toString(),
                                "size", Files.size(entry),
                                "type", ext,
                                "modifiedAt", Files.getLastModifiedTime(entry).toInstant().toString()));
                    }
                }
            }
        }
    }

    /**
     * Resolve and validate a file path within a base directory.
     * If the file is not found at the direct path, performs a fallback search.
     */
    public Resource resolveFile(Path baseDir, String relativePath) {
        if (!PathSanitizer.isSafe(baseDir, relativePath)) {
            return null;
        }
        Path resolved = baseDir.resolve(relativePath).normalize();
        if (Files.exists(resolved) && !Files.isDirectory(resolved)) {
            return new FileSystemResource(resolved);
        }
        // Fallback: search for the file by name in subdirectories
        String fileName = Path.of(relativePath).getFileName().toString();
        try {
            Path found = searchFile(baseDir, fileName);
            if (found != null) {
                return new FileSystemResource(found);
            }
        } catch (IOException e) {
            // ignore search errors
        }
        return null;
    }

    private Path searchFile(Path dir, String fileName) throws IOException {
        if (!Files.isDirectory(dir)) {
            return null;
        }
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path entry : stream) {
                if (Files.isDirectory(entry)) {
                    String dirName = entry.getFileName().toString();
                    if (!SKIP_DIRS.contains(dirName)) {
                        Path found = searchFile(entry, fileName);
                        if (found != null) {
                            return found;
                        }
                    }
                } else if (entry.getFileName().toString().equals(fileName)) {
                    return entry;
                }
            }
        }
        return null;
    }

    /**
     * Check if a file extension is allowed for upload.
     */
    public boolean isAllowedExtension(String filename) {
        String ext = getExtension(filename);
        if (BLOCKED_EXTENSIONS.contains(ext)) {
            return false;
        }
        return ALLOWED_EXTENSIONS.contains(ext) || ext.isEmpty();
    }

    private String getExtension(String filename) {
        int dot = filename.lastIndexOf('.');
        if (dot < 0) {
            return "";
        }
        return filename.substring(dot + 1).toLowerCase();
    }

    public String getMimeType(String filename) {
        int dot = filename.lastIndexOf('.');
        if (dot < 0) {
            return "application/octet-stream";
        }
        String ext = filename.substring(dot + 1).toLowerCase();
        return MIME_TYPES.getOrDefault(ext, "application/octet-stream");
    }

    /**
     * Whether this MIME type should be displayed inline (vs download).
     */
    public boolean isInline(String mimeType) {
        return mimeType.startsWith("text/")
                || mimeType.startsWith("image/")
                || "application/json".equals(mimeType)
                || "application/pdf".equals(mimeType);
    }

    // ── File capsule persistence ────────────────────────────────────────

    private static final Logger log = LogManager.getLogger(FileService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String CAPSULE_FILE = "file-capsules.json";

    /**
     * Compute the diff between two file snapshots.
     * Returns files that are new or have been modified (size or modifiedAt changed).
     */
    public List<Map<String, String>> diffFiles(List<Map<String, Object>> before,
                                                List<Map<String, Object>> after) {
        Map<String, Map<String, Object>> beforeMap = new HashMap<>();
        for (Map<String, Object> f : before) {
            beforeMap.put((String) f.get("path"), f);
        }

        List<Map<String, String>> changed = new ArrayList<>();
        for (Map<String, Object> f : after) {
            String path = (String) f.get("path");
            Map<String, Object> prev = beforeMap.get(path);
            boolean isNew = prev == null;
            boolean isUpdated = prev != null && (
                    !prev.get("modifiedAt").equals(f.get("modifiedAt"))
                            || !prev.get("size").equals(f.get("size")));
            if (isNew || isUpdated) {
                String name = (String) f.get("name");
                String ext = (String) f.get("type");
                changed.add(Map.of("path", path, "name", name, "ext", ext != null ? ext : ""));
            }
        }
        return changed;
    }

    /**
     * Persist file capsule entries for a session.
     * Merges new entries into existing data (read-modify-write).
     * Path: {workingDir}/data/{sessionId}/file-capsules.json
     */
    public void persistOutputFiles(Path workingDir, String sessionId, String messageId,
                                    List<Map<String, String>> files) {
        Path dir = workingDir.resolve("data").resolve(sessionId);
        Path file = dir.resolve(CAPSULE_FILE);
        try {
            Files.createDirectories(dir);

            // Read existing entries (if any)
            Map<String, List<Map<String, String>>> entries = new LinkedHashMap<>();
            if (Files.exists(file)) {
                Map<String, Object> existing = MAPPER.readValue(
                        Files.readString(file, StandardCharsets.UTF_8),
                        new TypeReference<>() {});
                Object raw = existing.get("entries");
                if (raw instanceof Map<?, ?> rawMap) {
                    for (Map.Entry<?, ?> e : rawMap.entrySet()) {
                        if (e.getValue() instanceof List<?> list) {
                            List<Map<String, String>> typed = new ArrayList<>();
                            for (Object item : list) {
                                if (item instanceof Map<?, ?> m) {
                                    Map<String, String> entry = new LinkedHashMap<>();
                                    m.forEach((k, v) -> entry.put(String.valueOf(k), String.valueOf(v)));
                                    typed.add(entry);
                                }
                            }
                            entries.put(String.valueOf(e.getKey()), typed);
                        }
                    }
                }
            }

            // Add / replace entry for this messageId
            entries.put(messageId, files);

            // Write back
            Map<String, Object> wrapper = new LinkedHashMap<>();
            wrapper.put("entries", entries);
            Files.writeString(file, MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(wrapper),
                    StandardCharsets.UTF_8);

            log.debug("Persisted {} file capsules for session {} message {}", files.size(), sessionId, messageId);
        } catch (Exception e) {
            log.warn("Failed to persist file capsules for session {}: {}", sessionId, e.getMessage());
        }
    }

    /**
     * Load persisted file capsule entries for a session.
     * Returns messageId → files mapping, or empty map on any error.
     */
    public Map<String, List<Map<String, String>>> loadOutputFiles(Path workingDir, String sessionId) {
        Path file = workingDir.resolve("data").resolve(sessionId).resolve(CAPSULE_FILE);
        if (!Files.exists(file)) {
            return Map.of();
        }
        try {
            Map<String, Object> data = MAPPER.readValue(
                    Files.readString(file, StandardCharsets.UTF_8),
                    new TypeReference<>() {});
            Object raw = data.get("entries");
            if (!(raw instanceof Map<?, ?> rawMap)) {
                return Map.of();
            }
            Map<String, List<Map<String, String>>> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : rawMap.entrySet()) {
                if (e.getValue() instanceof List<?> list) {
                    List<Map<String, String>> typed = new ArrayList<>();
                    for (Object item : list) {
                        if (item instanceof Map<?, ?> m) {
                            Map<String, String> entry = new LinkedHashMap<>();
                            m.forEach((k, v) -> entry.put(String.valueOf(k), String.valueOf(v)));
                            typed.add(entry);
                        }
                    }
                    result.put(String.valueOf(e.getKey()), typed);
                }
            }
            return result;
        } catch (Exception e) {
            log.warn("Failed to read file capsules for session {}: {}", sessionId, e.getMessage());
            return Map.of();
        }
    }
}

package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.common.util.PathSanitizer;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
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
                        files.add(Map.of(
                                "name", name,
                                "path", base.relativize(entry).toString(),
                                "size", Files.size(entry)));
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
}

package com.huawei.opsfactory.knowledge.service;

import com.huawei.opsfactory.knowledge.config.KnowledgeRuntimeProperties;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.stream.Stream;
import org.springframework.stereotype.Component;

@Component
public class StorageManager {

    private final Path baseDir;

    public StorageManager(KnowledgeRuntimeProperties runtimeProperties) {
        this.baseDir = Path.of(runtimeProperties.getBaseDir()).toAbsolutePath().normalize();
    }

    public Path originalFilePath(String sourceId, String documentId, String filename) {
        return baseDir.resolve("upload").resolve(sourceId).resolve(documentId).resolve("original").resolve(filename);
    }

    public Path artifactDir(String sourceId, String documentId) {
        return baseDir.resolve("artifacts").resolve(sourceId).resolve(documentId);
    }

    public Path artifactSourceDir(String sourceId) {
        return baseDir.resolve("artifacts").resolve(sourceId);
    }

    public Path uploadDocumentDir(String sourceId, String documentId) {
        return baseDir.resolve("upload").resolve(sourceId).resolve(documentId);
    }

    public Path uploadSourceDir(String sourceId) {
        return baseDir.resolve("upload").resolve(sourceId);
    }

    public Path save(InputStream inputStream, Path path) {
        try {
            Files.createDirectories(path.getParent());
            Files.copy(inputStream, path);
            return path;
        } catch (IOException e) {
            throw new IllegalStateException("Failed to save file " + path, e);
        }
    }

    public void writeString(Path path, String content) {
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path, content == null ? "" : content);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to write file " + path, e);
        }
    }

    public String readString(Path path) {
        try {
            return Files.exists(path) ? Files.readString(path) : "";
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read file " + path, e);
        }
    }

    public void deleteRecursively(Path path) {
        try {
            if (!Files.exists(path)) {
                return;
            }
            try (Stream<Path> walk = Files.walk(path)) {
                walk.sorted(Comparator.reverseOrder())
                    .forEach(current -> {
                        try {
                            Files.deleteIfExists(current);
                        } catch (IOException e) {
                            throw new IllegalStateException("Failed to delete " + current, e);
                        }
                    });
            }
        } catch (IOException e) {
            throw new IllegalStateException("Failed to delete path " + path, e);
        }
    }
}

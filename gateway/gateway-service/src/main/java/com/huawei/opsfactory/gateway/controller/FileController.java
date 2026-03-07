package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.common.util.PathSanitizer;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import com.huawei.opsfactory.gateway.service.FileService;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/agents/{agentId}/files")
public class FileController {

    private final InstanceManager instanceManager;
    private final AgentConfigService agentConfigService;
    private final FileService fileService;

    public FileController(InstanceManager instanceManager,
                          AgentConfigService agentConfigService,
                          FileService fileService) {
        this.instanceManager = instanceManager;
        this.agentConfigService = agentConfigService;
        this.fileService = fileService;
    }

    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, Object>> listFiles(@PathVariable String agentId,
                                                ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        Path workingDir = agentConfigService.getUsersDir()
                .resolve(userId).resolve("agents").resolve(agentId);
        try {
            return Mono.just(Map.of("files", fileService.listFiles(workingDir)));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to list files");
        }
    }

    @GetMapping("/**")
    public Mono<ResponseEntity<?>> getFile(@PathVariable String agentId,
                                            ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        Path workingDir = agentConfigService.getUsersDir()
                .resolve(userId).resolve("agents").resolve(agentId);

        // Extract the file path after /agents/{agentId}/files/
        String fullPath = exchange.getRequest().getPath().value();
        String prefix = "/agents/" + agentId + "/files/";
        String relativePath = fullPath.substring(prefix.length());

        // Check for path traversal — return 403
        if (!PathSanitizer.isSafe(workingDir, relativePath)) {
            return Mono.just(ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", "path traversal not allowed")));
        }

        Resource resource = fileService.resolveFile(workingDir, relativePath);
        if (resource == null) {
            return Mono.just(ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "file not found")));
        }

        String filename = resource.getFilename();
        String mimeType = fileService.getMimeType(filename != null ? filename : "");
        String disposition = fileService.isInline(mimeType) ? "inline" : "attachment";

        // Read file as bytes to prevent Spring from overriding Content-Type
        try {
            byte[] content = resource.getInputStream().readAllBytes();
            return Mono.just(ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(mimeType))
                    .header(HttpHeaders.CONTENT_DISPOSITION, disposition + "; filename=\"" + filename + "\"")
                    .body(content));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read file");
        }
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Mono<Map<String, Object>> uploadFile(@PathVariable String agentId,
                                                 @RequestPart("file") FilePart filePart,
                                                 @RequestPart("sessionId") String sessionId,
                                                 ServerWebExchange exchange) {
        String userId = exchange.getAttribute(UserContextFilter.USER_ID_ATTR);
        Path uploadsDir = agentConfigService.getUsersDir()
                .resolve(userId).resolve("agents").resolve(agentId)
                .resolve("uploads").resolve(sessionId);

        String originalName = filePart.filename();

        // Check file type
        if (!fileService.isAllowedExtension(originalName)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "File type not allowed: " + originalName);
        }

        try {
            Files.createDirectories(uploadsDir);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to create upload dir");
        }

        String safeName = System.currentTimeMillis() + "_" + PathSanitizer.sanitizeFilename(originalName);
        Path dest = uploadsDir.resolve(safeName);
        String mimeType = fileService.getMimeType(originalName);

        return filePart.transferTo(dest)
                .then(Mono.fromCallable(() -> {
                    Map<String, Object> result = new HashMap<>();
                    result.put("status", "uploaded");
                    result.put("filename", safeName);
                    result.put("path", dest.toString());
                    result.put("name", PathSanitizer.sanitizeFilename(originalName));
                    result.put("type", mimeType);
                    result.put("size", Files.size(dest));
                    return result;
                }));
    }

    /**
     * Fallback for upload requests that are not multipart/form-data.
     */
    @PostMapping(value = "/upload")
    public Mono<Map<String, Object>> uploadFileNotMultipart() {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Upload requires multipart/form-data content type");
    }
}

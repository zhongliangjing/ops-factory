package com.huawei.opsfactory.knowledge.api.document;

import com.huawei.opsfactory.knowledge.common.model.PageResponse;
import com.huawei.opsfactory.knowledge.service.KnowledgeServiceFacade;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/ops-knowledge")
public class DocumentController {

    private final KnowledgeServiceFacade facade;

    public DocumentController(KnowledgeServiceFacade facade) {
        this.facade = facade;
    }

    @GetMapping("/documents")
    public PageResponse<DocumentSummary> listDocuments(
        @RequestParam(required = false) String sourceId,
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int pageSize
    ) {
        return facade.listDocuments(page, pageSize, sourceId);
    }

    @PostMapping(value = "/sources/{sourceId}/documents:ingest", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public IngestDocumentsResponse ingestDocuments(
        @PathVariable("sourceId") String sourceId,
        @RequestPart("files") @NotNull MultipartFile[] files
    ) {
        return facade.ingest(sourceId, files);
    }

    @GetMapping("/documents/{documentId}")
    public DocumentDetail getDocument(@PathVariable("documentId") String documentId) {
        return facade.getDocument(documentId);
    }

    @PatchMapping("/documents/{documentId}")
    public DocumentUpdateResponse updateDocument(@PathVariable("documentId") String documentId, @RequestBody UpdateDocumentRequest request) {
        return facade.updateDocument(documentId, request);
    }

    @DeleteMapping("/documents/{documentId}")
    public DeleteDocumentResponse deleteDocument(@PathVariable("documentId") String documentId) {
        return facade.deleteDocument(documentId);
    }

    @GetMapping("/documents/{documentId}/chunks")
    public PageResponse<com.huawei.opsfactory.knowledge.api.chunk.ChunkController.ChunkSummary> listDocumentChunks(
        @PathVariable("documentId") String documentId,
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int pageSize
    ) {
        return facade.listDocumentChunks(documentId, page, pageSize);
    }

    @GetMapping("/documents/{documentId}/preview")
    public DocumentPreviewResponse previewDocument(@PathVariable("documentId") String documentId) {
        return facade.previewDocument(documentId);
    }

    @GetMapping("/documents/{documentId}/artifacts")
    public DocumentArtifactsResponse getArtifacts(@PathVariable("documentId") String documentId) {
        return facade.getArtifacts(documentId);
    }

    @GetMapping("/documents/{documentId}/artifacts/markdown")
    public String getMarkdownArtifact(@PathVariable("documentId") String documentId) {
        return facade.readArtifact(documentId, "content.md");
    }

    @GetMapping("/documents/{documentId}/artifacts/text")
    public String getTextArtifact(@PathVariable("documentId") String documentId) {
        return facade.readArtifact(documentId, "content.txt");
    }

    @PostMapping("/documents/{documentId}:rebuild")
    public JobCreationResponse rebuildDocument(@PathVariable("documentId") String documentId) {
        return facade.simpleDocumentJob(documentId, "REBUILD_DOCUMENT");
    }

    @PostMapping("/documents/{documentId}:reindex")
    public JobCreationResponse reindexDocument(@PathVariable("documentId") String documentId) {
        return facade.simpleDocumentJob(documentId, "INDEX");
    }

    @PostMapping("/documents/{documentId}:rechunk")
    public JobCreationResponse rechunkDocument(@PathVariable("documentId") String documentId) {
        return facade.simpleDocumentJob(documentId, "CHUNK");
    }

    @GetMapping("/documents/{documentId}/stats")
    public DocumentStatsResponse getDocumentStats(@PathVariable("documentId") String documentId) {
        return facade.documentStats(documentId);
    }

    public record DocumentSummary(
        String id,
        String sourceId,
        String name,
        String contentType,
        String title,
        String status,
        String indexStatus,
        long fileSizeBytes,
        int chunkCount,
        int userEditedChunkCount,
        Instant createdAt,
        Instant updatedAt
    ) {
    }

    public record IngestDocumentsResponse(String jobId, String sourceId, String status, int documentCount) {
    }

    public record DocumentDetail(
        String id,
        String sourceId,
        String name,
        String originalFilename,
        String title,
        String description,
        List<String> tags,
        String sha256,
        String contentType,
        String language,
        String status,
        String indexStatus,
        long fileSizeBytes,
        int chunkCount,
        int userEditedChunkCount,
        String errorMessage,
        Instant createdAt,
        Instant updatedAt
    ) {
    }

    public record UpdateDocumentRequest(
        String title,
        String description,
        List<String> tags
    ) {
    }

    public record DocumentUpdateResponse(String id, boolean updated, Instant updatedAt) {
    }

    public record DeleteDocumentResponse(String documentId, boolean deleted) {
    }

    public record DocumentPreviewResponse(String documentId, String title, String markdownPreview, String textPreview) {
    }

    public record DocumentArtifactsResponse(String documentId, boolean markdown, boolean text, boolean xhtml) {
    }

    public record JobCreationResponse(String jobId, String documentId, String jobType, String status) {
    }

    public record DocumentStatsResponse(
        String documentId,
        int chunkCount,
        int userEditedChunkCount,
        Instant lastIndexedAt,
        String status,
        String indexStatus
    ) {
    }
}

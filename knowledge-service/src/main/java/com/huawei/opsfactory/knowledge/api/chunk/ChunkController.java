package com.huawei.opsfactory.knowledge.api.chunk;

import com.huawei.opsfactory.knowledge.common.model.PageResponse;
import com.huawei.opsfactory.knowledge.service.KnowledgeServiceFacade;
import java.time.Instant;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/knowledge")
public class ChunkController {

    private final KnowledgeServiceFacade facade;

    public ChunkController(KnowledgeServiceFacade facade) {
        this.facade = facade;
    }

    @GetMapping("/chunks")
    public PageResponse<ChunkSummary> listChunks(
        @RequestParam(required = false) String sourceId,
        @RequestParam(required = false) String documentId,
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int pageSize
    ) {
        return facade.listChunks(page, pageSize, sourceId, documentId);
    }

    @GetMapping("/chunks/{chunkId}")
    public ChunkDetail getChunk(@PathVariable("chunkId") String chunkId) {
        return facade.getChunk(chunkId);
    }

    @PostMapping("/documents/{documentId}/chunks")
    public ChunkMutationResponse createChunk(@PathVariable("documentId") String documentId, @RequestBody CreateChunkRequest request) {
        return facade.createChunk(documentId, request);
    }

    @PatchMapping("/chunks/{chunkId}")
    public ChunkMutationResponse updateChunk(@PathVariable("chunkId") String chunkId, @RequestBody UpdateChunkRequest request) {
        return facade.updateChunk(chunkId, request);
    }

    @PatchMapping("/chunks/{chunkId}/keywords")
    public ChunkKeywordsResponse updateChunkKeywords(@PathVariable("chunkId") String chunkId, @RequestBody ChunkKeywordsRequest request) {
        return facade.updateChunkKeywords(chunkId, request.keywords());
    }

    @DeleteMapping("/chunks/{chunkId}")
    public DeleteChunkResponse deleteChunk(@PathVariable("chunkId") String chunkId) {
        return facade.deleteChunk(chunkId);
    }

    @PostMapping("/documents/{documentId}/chunks:reorder")
    public ReorderChunksResponse reorderChunks(@PathVariable("documentId") String documentId, @RequestBody ReorderChunksRequest request) {
        return facade.reorderChunks(documentId, request.items());
    }

    @PostMapping("/chunks/{chunkId}:reindex")
    public ChunkReindexResponse reindexChunk(@PathVariable("chunkId") String chunkId) {
        return facade.reindexChunk(chunkId);
    }

    public record ChunkSummary(
        String id,
        String documentId,
        String sourceId,
        int ordinal,
        String title,
        List<String> titlePath,
        List<String> keywords,
        String snippet,
        Integer pageFrom,
        Integer pageTo,
        int tokenCount,
        String editStatus,
        Instant updatedAt
    ) {
    }

    public record ChunkDetail(
        String id,
        String documentId,
        String sourceId,
        int ordinal,
        String title,
        List<String> titlePath,
        List<String> keywords,
        String text,
        String markdown,
        Integer pageFrom,
        Integer pageTo,
        int tokenCount,
        int textLength,
        String editStatus,
        String updatedBy,
        Instant createdAt,
        Instant updatedAt
    ) {
    }

    public record CreateChunkRequest(
        int ordinal,
        String title,
        List<String> titlePath,
        List<String> keywords,
        String text,
        String markdown,
        Integer pageFrom,
        Integer pageTo
    ) {
    }

    public record UpdateChunkRequest(
        String title,
        List<String> titlePath,
        List<String> keywords,
        String text,
        String markdown,
        Integer pageFrom,
        Integer pageTo
    ) {
    }

    public record ChunkMutationResponse(
        String id,
        String documentId,
        boolean reembedded,
        boolean reindexed,
        String editStatus,
        Instant updatedAt
    ) {
    }

    public record ChunkKeywordsRequest(List<String> keywords) {
    }

    public record ChunkKeywordsResponse(
        String id,
        List<String> keywords,
        boolean reembedded,
        boolean reindexed,
        Instant updatedAt
    ) {
    }

    public record DeleteChunkResponse(String chunkId, boolean deleted) {
    }

    public record ReorderChunksRequest(List<ReorderItem> items) {
    }

    public record ReorderItem(String chunkId, int ordinal) {
    }

    public record ReorderChunksResponse(String documentId, boolean updated, boolean reindexed, int updatedCount) {
    }

    public record ChunkReindexResponse(String chunkId, boolean reindexed, Instant updatedAt) {
    }
}

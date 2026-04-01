package com.huawei.opsfactory.knowledge.api.source;

import com.huawei.opsfactory.knowledge.common.model.PageResponse;
import com.huawei.opsfactory.knowledge.service.KnowledgeServiceFacade;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/knowledge/sources")
public class SourceController {

    private final KnowledgeServiceFacade facade;

    public SourceController(KnowledgeServiceFacade facade) {
        this.facade = facade;
    }

    @GetMapping
    public PageResponse<SourceResponse> listSources(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int pageSize
    ) {
        return facade.listSources(page, pageSize);
    }

    @PostMapping
    public SourceResponse createSource(@Valid @RequestBody CreateSourceRequest request) {
        return facade.createSource(request);
    }

    @GetMapping("/{sourceId}")
    public SourceResponse getSource(@PathVariable("sourceId") String sourceId) {
        return facade.getSource(sourceId);
    }

    @PatchMapping("/{sourceId}")
    public SourceResponse updateSource(@PathVariable("sourceId") String sourceId, @RequestBody UpdateSourceRequest request) {
        return facade.updateSource(sourceId, request);
    }

    @DeleteMapping("/{sourceId}")
    public DeleteSourceResponse deleteSource(@PathVariable("sourceId") String sourceId) {
        return facade.deleteSource(sourceId);
    }

    @GetMapping("/{sourceId}/stats")
    public SourceStatsResponse getSourceStats(@PathVariable("sourceId") String sourceId) {
        return facade.sourceStats(sourceId);
    }

    @PostMapping("/{sourceId}:rebuild")
    public RebuildSourceResponse rebuildSource(@PathVariable("sourceId") String sourceId) {
        return facade.rebuildSource(sourceId);
    }

    @GetMapping("/{sourceId}/maintenance")
    public MaintenanceOverviewResponse getMaintenance(@PathVariable("sourceId") String sourceId) {
        return facade.maintenanceOverview(sourceId);
    }

    public record CreateSourceRequest(
        @NotBlank @Size(max = 64) String name,
        @Size(max = 256) String description,
        String indexProfileId,
        String retrievalProfileId
    ) {
    }

    public record UpdateSourceRequest(
        String name,
        String description,
        String status,
        String indexProfileId,
        String retrievalProfileId
    ) {
    }

    public record SourceResponse(
        String id,
        String name,
        String description,
        String status,
        String storageMode,
        String indexProfileId,
        String retrievalProfileId,
        String runtimeStatus,
        String runtimeMessage,
        String currentJobId,
        String lastJobError,
        boolean rebuildRequired,
        Instant createdAt,
        Instant updatedAt
    ) {
    }

    public record SourceStatsResponse(
        String sourceId,
        int documentCount,
        int indexedDocumentCount,
        int failedDocumentCount,
        int processingDocumentCount,
        int chunkCount,
        int userEditedChunkCount,
        Instant lastIngestionAt
    ) {
    }

    public record DeleteSourceResponse(
        String sourceId,
        boolean deleted
    ) {
    }

    public record RebuildSourceResponse(
        String jobId,
        String sourceId,
        String status
    ) {
    }

    public record MaintenanceOverviewResponse(
        String sourceId,
        MaintenanceJobSummary currentJob,
        MaintenanceJobSummary lastCompletedJob
    ) {
    }

    public record MaintenanceJobSummary(
        String id,
        String type,
        String status,
        String stage,
        String createdBy,
        Instant startedAt,
        Instant updatedAt,
        Instant finishedAt,
        int totalDocuments,
        int processedDocuments,
        int successDocuments,
        int failedDocuments,
        String currentDocumentId,
        String currentDocumentName,
        String message,
        String errorSummary
    ) {
    }
}

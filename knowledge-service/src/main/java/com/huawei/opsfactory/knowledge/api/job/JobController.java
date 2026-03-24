package com.huawei.opsfactory.knowledge.api.job;

import com.huawei.opsfactory.knowledge.common.model.PageResponse;
import com.huawei.opsfactory.knowledge.service.KnowledgeServiceFacade;
import java.time.Instant;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/ops-knowledge/jobs")
public class JobController {

    private final KnowledgeServiceFacade facade;

    public JobController(KnowledgeServiceFacade facade) {
        this.facade = facade;
    }

    @GetMapping
    public PageResponse<JobResponse> listJobs(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int pageSize
    ) {
        return facade.listJobs(page, pageSize);
    }

    @GetMapping("/{jobId}")
    public JobResponse getJob(@PathVariable("jobId") String jobId) {
        return facade.getJob(jobId);
    }

    @PostMapping("/{jobId}:cancel")
    public JobCancelResponse cancelJob(@PathVariable("jobId") String jobId) {
        return facade.cancelJob(jobId);
    }

    @PostMapping("/{jobId}:retry")
    public JobRetryResponse retryJob(@PathVariable("jobId") String jobId) {
        return facade.retryJob(jobId);
    }

    @GetMapping("/{jobId}/logs")
    public JobLogsResponse getLogs(@PathVariable("jobId") String jobId) {
        return facade.logs(jobId);
    }

    public record JobResponse(
        String id,
        String jobType,
        String sourceId,
        String documentId,
        String status,
        int progress,
        String message,
        Instant startedAt,
        Instant finishedAt,
        Instant createdAt,
        Instant updatedAt
    ) {
    }

    public record JobCancelResponse(String jobId, boolean cancelled, String status, Instant updatedAt) {
    }

    public record JobRetryResponse(String jobId, String originalJobId, String status) {
    }

    public record JobLogsResponse(String jobId, List<JobLogEntry> entries) {
    }

    public record JobLogEntry(Instant time, String level, String message) {
    }
}

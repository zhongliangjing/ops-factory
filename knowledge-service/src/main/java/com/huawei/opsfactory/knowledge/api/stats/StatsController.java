package com.huawei.opsfactory.knowledge.api.stats;

import com.huawei.opsfactory.knowledge.service.KnowledgeServiceFacade;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/ops-knowledge/stats")
public class StatsController {

    private final KnowledgeServiceFacade facade;

    public StatsController(KnowledgeServiceFacade facade) {
        this.facade = facade;
    }

    @GetMapping("/overview")
    public OverviewStatsResponse getOverview() {
        return facade.overviewStats();
    }

    public record OverviewStatsResponse(
        int sourceCount,
        int documentCount,
        int indexedDocumentCount,
        int failedDocumentCount,
        int processingDocumentCount,
        int chunkCount,
        int userEditedChunkCount,
        int runningJobCount
    ) {
    }
}

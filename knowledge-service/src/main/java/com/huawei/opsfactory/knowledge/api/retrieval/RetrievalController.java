package com.huawei.opsfactory.knowledge.api.retrieval;

import com.huawei.opsfactory.knowledge.service.KnowledgeServiceFacade;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/knowledge")
public class RetrievalController {

    private final KnowledgeServiceFacade facade;

    public RetrievalController(KnowledgeServiceFacade facade) {
        this.facade = facade;
    }

    @PostMapping("/search")
    public SearchResponse search(@RequestBody SearchRequest request) {
        return facade.search(request);
    }

    @PostMapping("/search/compare")
    public CompareSearchResponse compare(@RequestBody CompareSearchRequest request) {
        return facade.compare(request);
    }

    @GetMapping("/fetch/{chunkId}")
    public FetchResponse fetch(
        @PathVariable("chunkId") String chunkId,
        @RequestParam(defaultValue = "false") boolean includeNeighbors,
        @RequestParam(defaultValue = "1") int neighborWindow,
        @RequestParam(defaultValue = "true") boolean includeMarkdown,
        @RequestParam(defaultValue = "true") boolean includeRawText
    ) {
        return facade.fetch(chunkId, includeNeighbors, neighborWindow);
    }

    @PostMapping("/retrieve")
    public RetrieveResponse retrieve(@RequestBody RetrieveRequest request) {
        return facade.retrieve(request);
    }

    @PostMapping("/explain")
    public ExplainResponse explain(@RequestBody ExplainRequest request) {
        return facade.explain(request);
    }

    public record SearchRequest(
        String query,
        List<String> sourceIds,
        List<String> documentIds,
        String retrievalProfileId,
        Integer topK,
        SearchFilters filters,
        SearchOverride override
    ) {
    }

    public record SearchFilters(List<String> contentTypes) {
    }

    public record SearchOverride(
        String mode,
        Integer lexicalTopK,
        Integer semanticTopK,
        Integer rrfK,
        Double scoreThreshold,
        Boolean includeScores,
        Boolean includeExplain,
        Integer snippetLength
    ) {
    }

    public record SearchResponse(String query, List<SearchHit> hits, int total) {
    }

    public record CompareSearchRequest(
        String query,
        List<String> sourceIds,
        List<String> documentIds,
        String retrievalProfileId,
        SearchFilters filters,
        List<String> modes
    ) {
    }

    public record CompareSearchResponse(
        String query,
        int fetchedTopK,
        CompareModeResponse hybrid,
        CompareModeResponse semantic,
        CompareModeResponse lexical
    ) {
    }

    public record CompareModeResponse(List<SearchHit> hits, int total) {
    }

    public record SearchHit(
        String chunkId,
        String documentId,
        String sourceId,
        String title,
        List<String> titlePath,
        String snippet,
        double score,
        double lexicalScore,
        double semanticScore,
        double fusionScore,
        Integer pageFrom,
        Integer pageTo
    ) {
    }

    public record FetchResponse(
        String chunkId,
        String documentId,
        String sourceId,
        String title,
        List<String> titlePath,
        String text,
        String markdown,
        List<String> keywords,
        Integer pageFrom,
        Integer pageTo,
        String previousChunkId,
        String nextChunkId,
        List<NeighborChunk> neighbors
    ) {
    }

    public record NeighborChunk(String position, String chunkId, String text) {
    }

    public record RetrieveRequest(
        String query,
        List<String> sourceIds,
        String retrievalProfileId,
        Integer topK,
        RetrieveOverride override
    ) {
    }

    public record RetrieveOverride(
        Boolean expandContext,
        String expandMode,
        Integer neighborWindow,
        Integer maxEvidenceCount,
        Integer maxEvidenceTokens,
        Boolean includeMetadata,
        Boolean includeReferences,
        Boolean includeExplain
    ) {
    }

    public record RetrieveResponse(String query, List<Evidence> evidences) {
    }

    public record Evidence(
        String chunkId,
        String documentId,
        String sourceId,
        String title,
        String content,
        String markdown,
        double score,
        List<String> keywords,
        List<Reference> references
    ) {
    }

    public record Reference(String type, Integer pageFrom, Integer pageTo) {
    }

    public record ExplainRequest(String query, String chunkId, List<String> sourceIds, String retrievalProfileId) {
    }

    public record ExplainResponse(
        String query,
        String chunkId,
        LexicalExplain lexical,
        SemanticExplain semantic,
        FusionExplain fusion
    ) {
    }

    public record LexicalExplain(List<String> matchedFields, double score, int rank) {
    }

    public record SemanticExplain(double score, int rank) {
    }

    public record FusionExplain(String mode, double score) {
    }
}

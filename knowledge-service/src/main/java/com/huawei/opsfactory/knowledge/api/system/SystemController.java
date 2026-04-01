package com.huawei.opsfactory.knowledge.api.system;

import com.huawei.opsfactory.knowledge.config.KnowledgeProperties;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/knowledge")
public class SystemController {

    private final KnowledgeProperties properties;

    public SystemController(KnowledgeProperties properties) {
        this.properties = properties;
    }

    @GetMapping("/capabilities")
    public CapabilitiesResponse capabilities() {
        return new CapabilitiesResponse(
            List.of("lexical", "semantic", "hybrid"),
            List.of("fixed", "paragraph", "hierarchical"),
            List.of("ordinal_neighbors", "same_section"),
            List.of("smartcn", "standard"),
            List.of("title", "titlePath", "keywords", "text", "markdown", "pageFrom", "pageTo"),
            new FeatureFlags(
                properties.getFeatures().isAllowChunkEdit(),
                properties.getFeatures().isAllowChunkDelete(),
                properties.getFeatures().isAllowExplain(),
                properties.getFeatures().isAllowRequestOverride()
            )
        );
    }

    @GetMapping("/system/defaults")
    public DefaultsResponse defaults() {
        return new DefaultsResponse(
            new IngestDefaults(
                properties.getIngest().getMaxFileSizeMb(),
                properties.getIngest().getAllowedContentTypes(),
                properties.getIngest().getDeduplication(),
                properties.getIngest().isSkipExistingByDefault()
            ),
            new ChunkingDefaults(
                properties.getChunking().getMode(),
                properties.getChunking().getTargetTokens(),
                properties.getChunking().getOverlapTokens(),
                properties.getChunking().isRespectHeadings(),
                properties.getChunking().isKeepTablesWhole()
            ),
            new RetrievalDefaults(
                properties.getRetrieval().getMode(),
                properties.getRetrieval().getLexicalTopK(),
                properties.getRetrieval().getSemanticTopK(),
                properties.getRetrieval().getFinalTopK(),
                properties.getRetrieval().getRrfK()
            ),
            new FeatureFlags(
                properties.getFeatures().isAllowChunkEdit(),
                properties.getFeatures().isAllowChunkDelete(),
                properties.getFeatures().isAllowExplain(),
                properties.getFeatures().isAllowRequestOverride()
            )
        );
    }

    public record CapabilitiesResponse(
        List<String> retrievalModes,
        List<String> chunkModes,
        List<String> expandModes,
        List<String> analyzers,
        List<String> editableChunkFields,
        FeatureFlags featureFlags
    ) {
    }

    public record DefaultsResponse(
        IngestDefaults ingest,
        ChunkingDefaults chunking,
        RetrievalDefaults retrieval,
        FeatureFlags features
    ) {
    }

    public record IngestDefaults(
        int maxFileSizeMb,
        List<String> allowedContentTypes,
        String deduplication,
        boolean skipExistingByDefault
    ) {
    }

    public record ChunkingDefaults(
        String mode,
        int targetTokens,
        int overlapTokens,
        boolean respectHeadings,
        boolean keepTablesWhole
    ) {
    }

    public record RetrievalDefaults(
        String mode,
        int lexicalTopK,
        int semanticTopK,
        int finalTopK,
        int rrfK
    ) {
    }

    public record FeatureFlags(
        boolean allowChunkEdit,
        boolean allowChunkDelete,
        boolean allowExplain,
        boolean allowRequestOverride
    ) {
    }
}

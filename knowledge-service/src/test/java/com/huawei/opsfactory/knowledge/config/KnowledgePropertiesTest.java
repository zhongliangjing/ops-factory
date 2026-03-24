package com.huawei.opsfactory.knowledge.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class KnowledgePropertiesTest {

    @Test
    void shouldExposeExpectedDefaultBusinessSettings() {
        KnowledgeProperties properties = new KnowledgeProperties();

        assertThat(properties.getIngest().getMaxFileSizeMb()).isEqualTo(100);
        assertThat(properties.getIngest().getDeduplication()).isEqualTo("sha256");

        assertThat(properties.getConvert().getEngine()).isEqualTo("tika");
        assertThat(properties.getConvert().isEnablePdfboxFallback()).isTrue();

        assertThat(properties.getAnalysis().getLanguage()).isEqualTo("zh");
        assertThat(properties.getAnalysis().getIndexAnalyzer()).isEqualTo("smartcn");
        assertThat(properties.getAnalysis().getQueryAnalyzer()).isEqualTo("smartcn");

        assertThat(properties.getChunking().getMode()).isEqualTo("hierarchical");
        assertThat(properties.getChunking().getTargetTokens()).isEqualTo(500);
        assertThat(properties.getChunking().getOverlapTokens()).isEqualTo(80);
        assertThat(properties.getChunking().isRespectHeadings()).isTrue();
        assertThat(properties.getChunking().isKeepTablesWhole()).isTrue();

        assertThat(properties.getEmbedding().getBaseUrl()).isEqualTo("https://openrouter.ai/api/v1");
        assertThat(properties.getEmbedding().getModel()).isEqualTo("qwen/qwen3-embedding-4b");
        assertThat(properties.getEmbedding().getDimensions()).isEqualTo(2560);

        assertThat(properties.getRetrieval().getMode()).isEqualTo("hybrid");
        assertThat(properties.getRetrieval().getFusionMode()).isEqualTo("rrf");
        assertThat(properties.getRetrieval().getFinalTopK()).isEqualTo(10);

        assertThat(properties.getFeatures().isAllowChunkEdit()).isTrue();
        assertThat(properties.getFeatures().isAllowChunkDelete()).isTrue();
        assertThat(properties.getFeatures().isAllowExplain()).isTrue();
        assertThat(properties.getFeatures().isAllowRequestOverride()).isTrue();
    }
}

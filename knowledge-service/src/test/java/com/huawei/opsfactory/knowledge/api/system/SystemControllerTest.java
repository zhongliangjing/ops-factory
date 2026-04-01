package com.huawei.opsfactory.knowledge.api.system;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.huawei.opsfactory.knowledge.config.KnowledgeProperties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(SystemController.class)
@Import(SystemController.class)
@EnableConfigurationProperties(KnowledgeProperties.class)
class SystemControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void shouldExposeCapabilitiesForManagementUiAndThirdPartyClients() throws Exception {
        mockMvc.perform(get("/knowledge/capabilities"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalModes[0]").value("lexical"))
            .andExpect(jsonPath("$.retrievalModes[2]").value("hybrid"))
            .andExpect(jsonPath("$.chunkModes[2]").value("hierarchical"))
            .andExpect(jsonPath("$.analyzers[0]").value("smartcn"))
            .andExpect(jsonPath("$.featureFlags.allowChunkEdit").value(true))
            .andExpect(jsonPath("$.featureFlags.allowExplain").value(true));
    }

    @Test
    void shouldExposeDefaultBusinessConfigurationView() throws Exception {
        mockMvc.perform(get("/knowledge/system/defaults"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.ingest.maxFileSizeMb").value(100))
            .andExpect(jsonPath("$.ingest.deduplication").value("sha256"))
            .andExpect(jsonPath("$.chunking.mode").value("hierarchical"))
            .andExpect(jsonPath("$.chunking.targetTokens").value(500))
            .andExpect(jsonPath("$.retrieval.mode").value("hybrid"))
            .andExpect(jsonPath("$.retrieval.lexicalTopK").value(50))
            .andExpect(jsonPath("$.retrieval.semanticTopK").value(50))
            .andExpect(jsonPath("$.retrieval.rrfK").value(60))
            .andExpect(jsonPath("$.features.allowRequestOverride").value(true));
    }
}

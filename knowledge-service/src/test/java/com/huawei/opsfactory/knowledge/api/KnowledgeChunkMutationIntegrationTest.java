package com.huawei.opsfactory.knowledge.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class KnowledgeChunkMutationIntegrationTest extends KnowledgeApiIntegrationTestSupport {

    @BeforeEach
    void setUp() throws IOException {
        resetRuntimeState();
    }

    @Test
    void shouldReembedAndRefreshRecallWhenChunksAreEdited() throws Exception {
        String sourceId = createSource();
        uploadMarkdownFile(sourceId, "manual-edits.md", """
            # Manual Edit Coverage

            This document validates manual chunk editing and retrieval refresh.
            """);

        JsonNode documents = listDocuments(sourceId);
        String documentId = documents.path("items").get(0).path("id").asText();
        int initialEmbeddingCache = jdbcTemplate.queryForObject("select count(*) from embedding_cache", Integer.class);

        JsonNode createdChunk = readJson(mockMvc.perform(post("/knowledge/documents/{documentId}/chunks", documentId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "ordinal": 50,
                      "title": "Manual validation chunk",
                      "titlePath": ["Manual validation chunk"],
                      "keywords": ["manual-keyword"],
                      "text": "manual-only-term appears in this manually managed chunk",
                      "markdown": "manual-only-term appears in this manually managed chunk",
                      "pageFrom": 1,
                      "pageTo": 1
                    }
                    """))
            .andExpect(status().isOk())
            .andReturn());
        String chunkId = createdChunk.path("id").asText();
        assertThat(createdChunk.path("reembedded").asBoolean()).isTrue();

        int afterCreateCache = jdbcTemplate.queryForObject("select count(*) from embedding_cache", Integer.class);
        assertThat(afterCreateCache).isEqualTo(initialEmbeddingCache + 1);
        assertThat(search(sourceId, "manual-only-term", null, 10, null, """
            {
              "mode": "lexical"
            }
            """).path("hits").get(0).path("chunkId").asText()).isEqualTo(chunkId);

        JsonNode updatedChunk = readJson(mockMvc.perform(patch("/knowledge/chunks/{chunkId}", chunkId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "title": "Manual validation chunk revised",
                      "text": "updated-only-term replaces the original retrieval phrase",
                      "markdown": "updated-only-term replaces the original retrieval phrase"
                    }
                    """))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(updatedChunk.path("reembedded").asBoolean()).isTrue();

        int afterTextEditCache = jdbcTemplate.queryForObject("select count(*) from embedding_cache", Integer.class);
        assertThat(afterTextEditCache).isEqualTo(afterCreateCache + 1);
        JsonNode updatedDetail = readJson(mockMvc.perform(get("/knowledge/chunks/{chunkId}", chunkId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(updatedDetail.path("text").asText()).contains("updated-only-term");

        assertThat(search(sourceId, "updated-only-term", null, 10, null, """
            {
              "mode": "lexical"
            }
            """).path("hits").get(0).path("chunkId").asText()).isEqualTo(chunkId);

        JsonNode keywordsUpdate = readJson(mockMvc.perform(patch("/knowledge/chunks/{chunkId}/keywords", chunkId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "keywords": ["reembed-keyword", "incident-custom"]
                    }
                    """))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(keywordsUpdate.path("reembedded").asBoolean()).isTrue();

        int afterKeywordEditCache = jdbcTemplate.queryForObject("select count(*) from embedding_cache", Integer.class);
        assertThat(afterKeywordEditCache).isEqualTo(afterTextEditCache + 1);
        assertThat(search(sourceId, "reembed-keyword", null, 10, null, """
            {
              "mode": "lexical"
            }
            """).path("hits").get(0).path("chunkId").asText()).isEqualTo(chunkId);

        JsonNode documentStats = readJson(mockMvc.perform(get("/knowledge/documents/{documentId}/stats", documentId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(documentStats.path("userEditedChunkCount").asInt()).isGreaterThan(0);

        JsonNode reindex = readJson(mockMvc.perform(post("/knowledge/chunks/{chunkId}:reindex", chunkId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(reindex.path("reindexed").asBoolean()).isTrue();

        readJson(mockMvc.perform(delete("/knowledge/chunks/{chunkId}", chunkId))
                .andExpect(status().isOk())
                .andReturn());
        assertThat(search(sourceId, "updated-only-term", null, 10, null, """
            {
              "mode": "lexical"
            }
            """).path("total").asInt()).isZero();
    }
}

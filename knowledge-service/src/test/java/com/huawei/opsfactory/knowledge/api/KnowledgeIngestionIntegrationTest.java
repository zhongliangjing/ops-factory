package com.huawei.opsfactory.knowledge.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

class KnowledgeIngestionIntegrationTest extends KnowledgeApiIntegrationTestSupport {

    @BeforeEach
    void setUp() throws IOException {
        resetRuntimeState();
    }

    @Test
    void shouldIngestSupportedDocumentsChunkThemAndServeArtifactsAndRetrieval() throws Exception {
        String sourceId = createSource();
        List<Path> files = inputFiles();

        JsonNode ingest = uploadInputFiles(sourceId);
        assertThat(ingest.path("status").asText()).isEqualTo("SUCCEEDED");
        int importedCount = ingest.path("documentCount").asInt();
        assertThat(importedCount).isGreaterThan(0).isLessThanOrEqualTo(files.size());

        JsonNode stats = readJson(mockMvc.perform(get("/knowledge/sources/{sourceId}/stats", sourceId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(stats.path("documentCount").asInt()).isEqualTo(importedCount);
        assertThat(stats.path("chunkCount").asInt()).isGreaterThan(4);

        JsonNode documents = listDocuments(sourceId);
        assertThat(documents.path("total").asInt()).isEqualTo(importedCount);

        String htmlDocumentId = documentIdByName(documents, "SLA_Violation_Analysis_Report_CN.html");
        String xlsxDocumentId = documentIdByName(documents, "Comprehensive_Quality_Report.xlsx");

        JsonNode htmlDetail = readJson(mockMvc.perform(get("/knowledge/documents/{documentId}", htmlDocumentId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(htmlDetail.path("status").asText()).isEqualTo("INDEXED");
        assertThat(htmlDetail.path("indexStatus").asText()).isEqualTo("INDEXED");

        String htmlMarkdown = mockMvc.perform(get("/knowledge/documents/{documentId}/artifacts/markdown", htmlDocumentId))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
        assertThat(htmlMarkdown)
            .contains("# SLA违约归因分析报告")
            .contains("SLA")
            .doesNotContain("<html")
            .doesNotContain("<style");

        byte[] original = mockMvc.perform(get("/knowledge/documents/{documentId}/original", htmlDocumentId))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsByteArray();
        assertThat(original).isNotEmpty();

        JsonNode xlsxChunks = readJson(mockMvc.perform(get("/knowledge/documents/{documentId}/chunks", xlsxDocumentId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(xlsxChunks.path("total").asInt()).isGreaterThan(1);

        String middleChunkId = xlsxChunks.path("items").get(1).path("id").asText();
        JsonNode fetch = readJson(mockMvc.perform(get("/knowledge/fetch/{chunkId}", middleChunkId)
                .param("includeNeighbors", "true")
                .param("neighborWindow", "1"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(fetch.path("text").asText()).isNotBlank();
        assertThat(fetch.path("neighbors").isArray()).isTrue();

        JsonNode retrieval = readJson(mockMvc.perform(post("/knowledge/retrieve")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "query": "SLA",
                      "sourceIds": ["%s"],
                      "topK": 3
                    }
                    """.formatted(sourceId)))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(retrieval.path("evidences").isArray()).isTrue();
        assertThat(retrieval.path("evidences")).isNotEmpty();
        assertThat(retrieval.path("evidences").get(0).path("content").asText()).containsIgnoringCase("SLA");
    }

    @Test
    void shouldRejectUnsupportedContentTypeWithBadRequest() throws Exception {
        String sourceId = createSource();
        MockMultipartFile unsupportedFile = new MockMultipartFile(
            "files", "malware.exe", "application/x-msdownload", "MZ fake exe content".getBytes()
        );

        mockMvc.perform(multipart("/knowledge/sources/{sourceId}/documents:ingest", sourceId)
                .file(unsupportedFile))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("REQUEST_FAILED"))
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Failed to ingest file malware.exe")));
    }

    @Test
    void shouldDeduplicateIdenticalFileOnSecondUpload() throws Exception {
        String sourceId = createSource();
        MockMultipartFile file = new MockMultipartFile(
            "files", "repeat.md", "text/markdown", "# Repeat\n\nSame content".getBytes()
        );

        JsonNode first = readJson(mockMvc.perform(multipart("/knowledge/sources/{sourceId}/documents:ingest", sourceId)
                .file(file))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(first.path("status").asText()).isEqualTo("SUCCEEDED");
        assertThat(first.path("documentCount").asInt()).isEqualTo(1);

        JsonNode second = readJson(mockMvc.perform(multipart("/knowledge/sources/{sourceId}/documents:ingest", sourceId)
                .file(file))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(second.path("documentCount").asInt()).isEqualTo(0);

        JsonNode docs = listDocuments(sourceId);
        assertThat(docs.path("total").asInt()).isEqualTo(1);
    }
}

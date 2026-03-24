package com.huawei.opsfactory.knowledge.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest
@AutoConfigureMockMvc
class KnowledgeCoverageIntegrationTest {

    private static final Path RUNTIME_BASE_DIR = Path.of("target/test-runtime-coverage").toAbsolutePath().normalize();
    private static final Path INPUT_FILES_DIR = Path.of("src/test/resources/inputFiles").toAbsolutePath().normalize();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("knowledge.runtime.base-dir", () -> RUNTIME_BASE_DIR.toString());
    }

    @BeforeEach
    void resetState() throws IOException {
        resetDatabase();
        recreateDirectory(RUNTIME_BASE_DIR.resolve("upload"));
        recreateDirectory(RUNTIME_BASE_DIR.resolve("artifacts"));
        recreateDirectory(RUNTIME_BASE_DIR.resolve("indexes"));
    }

    @Test
    void shouldCoverSupportedFileMatrixAndArtifacts() throws Exception {
        String sourceId = createSource(null, null);
        JsonNode ingest = uploadInputFiles(sourceId);
        List<Path> files = inputFiles();
        Map<String, String> expectedMarkers = Map.of(
            "Comprehensive_Quality_Report_20260204_132159_EN_matplotlib_chart.xlsx", "Health Score",
            "Major_Incident_Analysis_INC20250115001_EN.docx", "incident",
            "SLA_Violation_Analysis_Report_CN.html", "SLA",
            "sample-knowledge.pdf", "PDF Sample",
            "sample-knowledge.pptx", "PPTX Sample",
            "sample-metrics.csv", "retrieval_mode",
            "sample-operations-note.md", "chunk management",
            "sample-runbook.txt", "Runbook"
        );

        assertThat(ingest.path("documentCount").asInt()).isEqualTo(files.size());
        assertThat(ingest.path("status").asText()).isEqualTo("SUCCEEDED");

        JsonNode documents = listDocuments(sourceId);
        assertThat(documents.path("total").asInt()).isEqualTo(files.size());
        assertThat(fileNames(documents)).containsExactlyInAnyOrderElementsOf(fileNames(files));

        for (JsonNode item : documents.path("items")) {
            String documentId = item.path("id").asText();
            JsonNode detail = readJson(mockMvc.perform(get("/ops-knowledge/documents/{documentId}", documentId))
                .andExpect(status().isOk())
                .andReturn());
            assertThat(detail.path("status").asText()).isEqualTo("INDEXED");
            assertThat(detail.path("indexStatus").asText()).isEqualTo("INDEXED");
            assertThat(detail.path("contentType").asText()).isNotBlank();

            JsonNode preview = readJson(mockMvc.perform(get("/ops-knowledge/documents/{documentId}/preview", documentId))
                .andExpect(status().isOk())
                .andReturn());
            assertThat(preview.path("markdownPreview").asText()).isNotBlank();
            assertThat(preview.path("textPreview").asText()).isNotBlank();

            JsonNode artifacts = readJson(mockMvc.perform(get("/ops-knowledge/documents/{documentId}/artifacts", documentId))
                .andExpect(status().isOk())
                .andReturn());
            assertThat(artifacts.path("markdown").asBoolean()).isTrue();
            assertThat(artifacts.path("text").asBoolean()).isTrue();

            String markdown = mockMvc.perform(get("/ops-knowledge/documents/{documentId}/artifacts/markdown", documentId))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
            String text = mockMvc.perform(get("/ops-knowledge/documents/{documentId}/artifacts/text", documentId))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
            assertThat(markdown).isNotBlank();
            assertThat(text).isNotBlank();
            assertThat(markdown).containsIgnoringCase(expectedMarkers.get(item.path("name").asText()));
            assertThat(text).containsIgnoringCase(expectedMarkers.get(item.path("name").asText()));

            JsonNode documentStats = readJson(mockMvc.perform(get("/ops-knowledge/documents/{documentId}/stats", documentId))
                .andExpect(status().isOk())
                .andReturn());
            assertThat(documentStats.path("chunkCount").asInt()).isGreaterThan(0);
        }

        assertSearchHitsDocument(sourceId, documentIdByName(documents, "Major_Incident_Analysis_INC20250115001_EN.docx"), "incident");
        assertSearchHitsDocument(sourceId, documentIdByName(documents, "SLA_Violation_Analysis_Report_CN.html"), "SLA");
        assertSearchHitsDocument(sourceId, documentIdByName(documents, "Comprehensive_Quality_Report_20260204_132159_EN_matplotlib_chart.xlsx"), "Comprehensive");
        assertSearchHitsDocument(sourceId, documentIdByName(documents, "sample-knowledge.pdf"), "PDF Sample");
        assertSearchHitsDocument(sourceId, documentIdByName(documents, "sample-knowledge.pptx"), "PPTX Sample");
        assertSearchHitsDocument(sourceId, documentIdByName(documents, "sample-metrics.csv"), "retrieval_mode");
        assertSearchHitsDocument(sourceId, documentIdByName(documents, "sample-operations-note.md"), "chunk management");
        assertSearchHitsDocument(sourceId, documentIdByName(documents, "sample-runbook.txt"), "Runbook");

        assertThat(jdbcTemplate.queryForObject("select count(*) from knowledge_document", Integer.class)).isEqualTo(files.size());
        assertThat(jdbcTemplate.queryForObject("select count(*) from document_chunk", Integer.class)).isGreaterThan(0);
    }

    @Test
    void shouldCoverRetrievalExplainAndContentTypeFilters() throws Exception {
        String sourceId = createSource(null, null);
        uploadInputFiles(sourceId);
        JsonNode documents = listDocuments(sourceId);

        String csvDocumentId = documentIdByName(documents, "sample-metrics.csv");
        String csvContentType = contentTypeByName(documents, "sample-metrics.csv");
        JsonNode csvSearch = search(sourceId, "retrieval_mode", null, null, List.of(csvContentType));
        assertThat(csvSearch.path("total").asInt()).isGreaterThan(0);
        assertThat(csvSearch.path("hits").get(0).path("documentId").asText()).isEqualTo(csvDocumentId);

        String pptxDocumentId = documentIdByName(documents, "sample-knowledge.pptx");
        JsonNode pptxSearch = search(sourceId, "PPTX Sample", List.of(pptxDocumentId), null, null);
        assertThat(pptxSearch.path("total").asInt()).isGreaterThan(0);

        String hitChunkId = csvSearch.path("hits").get(0).path("chunkId").asText();
        JsonNode explain = readJson(mockMvc.perform(post("/ops-knowledge/explain")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "query": "retrieval_mode",
                      "chunkId": "%s",
                      "sourceIds": ["%s"]
                    }
                    """.formatted(hitChunkId, sourceId)))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(explain.path("lexical").path("matchedFields").toString()).contains("content");

        JsonNode retrieve = readJson(mockMvc.perform(post("/ops-knowledge/retrieve")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "query": "incident",
                      "sourceIds": ["%s"],
                      "topK": 3
                    }
                    """.formatted(sourceId)))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(retrieve.path("evidences").isArray()).isTrue();
        assertThat(retrieve.path("evidences").size()).isGreaterThan(0);
        assertThat(retrieve.path("evidences").get(0).path("content").asText()).containsIgnoringCase("incident");
        assertThat(retrieve.path("evidences").get(0).path("references").isArray()).isTrue();

        String xlsxDocId = documentIdByName(documents, "Comprehensive_Quality_Report_20260204_132159_EN_matplotlib_chart.xlsx");
        JsonNode xlsxChunks = readJson(mockMvc.perform(get("/ops-knowledge/documents/{documentId}/chunks", xlsxDocId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(xlsxChunks.path("total").asInt()).isGreaterThan(1);
        String middleChunkId = xlsxChunks.path("items").get(1).path("id").asText();
        JsonNode fetch = readJson(mockMvc.perform(get("/ops-knowledge/fetch/{chunkId}", middleChunkId)
                .param("includeNeighbors", "true")
                .param("neighborWindow", "1"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(fetch.path("neighbors").isArray()).isTrue();
        assertThat(fetch.path("text").asText()).isNotBlank();
    }

    @Test
    void shouldCoverSourceProfileAndBindingManagement() throws Exception {
        JsonNode createdIndexProfile = readJson(mockMvc.perform(post("/ops-knowledge/profiles/index")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name": "index-%s",
                      "config": {
                        "chunking": {
                          "mode": "hierarchical",
                          "targetTokens": 256
                        }
                      }
                    }
                    """.formatted(UUID.randomUUID())))
            .andExpect(status().isOk())
            .andReturn());
        String indexProfileId = createdIndexProfile.path("id").asText();

        JsonNode createdRetrievalProfile = readJson(mockMvc.perform(post("/ops-knowledge/profiles/retrieval")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name": "retrieval-%s",
                      "config": {
                        "retrieval": {
                          "mode": "hybrid"
                        },
                        "result": {
                          "finalTopK": 7
                        }
                      }
                    }
                    """.formatted(UUID.randomUUID())))
            .andExpect(status().isOk())
            .andReturn());
        String retrievalProfileId = createdRetrievalProfile.path("id").asText();

        JsonNode indexList = readJson(mockMvc.perform(get("/ops-knowledge/profiles/index"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(indexList.path("total").asInt()).isGreaterThan(0);

        JsonNode retrievalList = readJson(mockMvc.perform(get("/ops-knowledge/profiles/retrieval"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(retrievalList.path("total").asInt()).isGreaterThan(0);

        JsonNode indexDetail = readJson(mockMvc.perform(get("/ops-knowledge/profiles/index/{profileId}", indexProfileId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(indexDetail.path("id").asText()).isEqualTo(indexProfileId);

        JsonNode retrievalDetail = readJson(mockMvc.perform(get("/ops-knowledge/profiles/retrieval/{profileId}", retrievalProfileId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(retrievalDetail.path("id").asText()).isEqualTo(retrievalProfileId);

        mockMvc.perform(patch("/ops-knowledge/profiles/index/{profileId}", indexProfileId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name": "updated-index-profile-%s",
                      "config": {
                        "chunking": {
                          "targetTokens": 300
                        }
                      }
                    }
                    """.formatted(UUID.randomUUID())))
            .andExpect(status().isOk());

        mockMvc.perform(patch("/ops-knowledge/profiles/retrieval/{profileId}", retrievalProfileId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name": "updated-retrieval-profile-%s",
                      "config": {
                        "result": {
                          "finalTopK": 5
                        }
                      }
                    }
                    """.formatted(UUID.randomUUID())))
            .andExpect(status().isOk());

        String sourceId = createSource(indexProfileId, retrievalProfileId);
        JsonNode sourceDetail = readJson(mockMvc.perform(get("/ops-knowledge/sources/{sourceId}", sourceId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(sourceDetail.path("indexProfileId").asText()).isEqualTo(indexProfileId);
        assertThat(sourceDetail.path("retrievalProfileId").asText()).isEqualTo(retrievalProfileId);

        mockMvc.perform(patch("/ops-knowledge/sources/{sourceId}", sourceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name": "patched-source",
                      "description": "patched description",
                      "status": "DISABLED"
                    }
                    """))
            .andExpect(status().isOk());

        JsonNode sourceList = readJson(mockMvc.perform(get("/ops-knowledge/sources"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(sourceList.path("total").asInt()).isGreaterThan(0);
        JsonNode patchedSource = readJson(mockMvc.perform(get("/ops-knowledge/sources/{sourceId}", sourceId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(patchedSource.path("name").asText()).isEqualTo("patched-source");
        assertThat(patchedSource.path("status").asText()).isEqualTo("DISABLED");

        JsonNode bindings = readJson(mockMvc.perform(get("/ops-knowledge/profiles/bindings"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(bindings.path("items").toString()).contains(sourceId);

        mockMvc.perform(patch("/ops-knowledge/profiles/bindings/{sourceId}", sourceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "indexProfileId": "%s",
                      "retrievalProfileId": "%s"
                    }
                    """.formatted(indexProfileId, retrievalProfileId)))
            .andExpect(status().isOk());

        mockMvc.perform(delete("/ops-knowledge/profiles/index/{profileId}", indexProfileId))
            .andExpect(status().isBadRequest());
        mockMvc.perform(delete("/ops-knowledge/profiles/retrieval/{profileId}", retrievalProfileId))
            .andExpect(status().isBadRequest());

        JsonNode disposableIndexProfile = readJson(mockMvc.perform(post("/ops-knowledge/profiles/index")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name": "disposable-index-%s",
                      "config": {
                        "chunking": {
                          "targetTokens": 400
                        }
                      }
                    }
                    """.formatted(UUID.randomUUID())))
            .andExpect(status().isOk())
            .andReturn());
        JsonNode disposableRetrievalProfile = readJson(mockMvc.perform(post("/ops-knowledge/profiles/retrieval")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name": "disposable-retrieval-%s",
                      "config": {
                        "result": {
                          "finalTopK": 3
                        }
                      }
                    }
                    """.formatted(UUID.randomUUID())))
            .andExpect(status().isOk())
            .andReturn());

        mockMvc.perform(delete("/ops-knowledge/profiles/index/{profileId}", disposableIndexProfile.path("id").asText()))
            .andExpect(status().isOk());
        mockMvc.perform(delete("/ops-knowledge/profiles/retrieval/{profileId}", disposableRetrievalProfile.path("id").asText()))
            .andExpect(status().isOk());
    }

    @Test
    void shouldDeleteSourceAndCascadeDocumentsChunksBindingsAndArtifacts() throws Exception {
        String sourceId = createSource(null, null);
        uploadInputFiles(sourceId);

        JsonNode documents = listDocuments(sourceId);
        assertThat(documents.path("total").asInt()).isGreaterThan(0);

        Path uploadSourceDir = RUNTIME_BASE_DIR.resolve("upload").resolve(sourceId);
        Path artifactSourceDir = RUNTIME_BASE_DIR.resolve("artifacts").resolve(sourceId);
        assertThat(Files.exists(uploadSourceDir)).isTrue();
        assertThat(Files.exists(artifactSourceDir)).isTrue();
        assertThat(jdbcTemplate.queryForObject("select count(*) from knowledge_source where id = ?", Integer.class, sourceId)).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("select count(*) from knowledge_document where source_id = ?", Integer.class, sourceId)).isGreaterThan(0);
        assertThat(jdbcTemplate.queryForObject("select count(*) from document_chunk where source_id = ?", Integer.class, sourceId)).isGreaterThan(0);
        assertThat(jdbcTemplate.queryForObject("select count(*) from source_profile_binding where source_id = ?", Integer.class, sourceId)).isEqualTo(1);

        JsonNode deleteResponse = readJson(mockMvc.perform(delete("/ops-knowledge/sources/{sourceId}", sourceId))
            .andExpect(status().isOk())
            .andReturn());

        assertThat(deleteResponse.path("sourceId").asText()).isEqualTo(sourceId);
        assertThat(deleteResponse.path("deleted").asBoolean()).isTrue();
        assertThat(jdbcTemplate.queryForObject("select count(*) from knowledge_source where id = ?", Integer.class, sourceId)).isZero();
        assertThat(jdbcTemplate.queryForObject("select count(*) from knowledge_document where source_id = ?", Integer.class, sourceId)).isZero();
        assertThat(jdbcTemplate.queryForObject("select count(*) from document_chunk where source_id = ?", Integer.class, sourceId)).isZero();
        assertThat(jdbcTemplate.queryForObject("select count(*) from source_profile_binding where source_id = ?", Integer.class, sourceId)).isZero();
        assertThat(Files.exists(uploadSourceDir)).isFalse();
        assertThat(Files.exists(artifactSourceDir)).isFalse();
    }

    @Test
    void shouldCoverDocumentAndJobManagementWithDataConsistency() throws Exception {
        String sourceId = createSource(null, null);
        JsonNode ingest = uploadInputFiles(sourceId);
        String ingestJobId = ingest.path("jobId").asText();

        JsonNode documents = listDocuments(sourceId);
        String documentId = documentIdByName(documents, "sample-knowledge.pdf");

        mockMvc.perform(patch("/ops-knowledge/documents/{documentId}", documentId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "title": "Updated PDF Title",
                      "description": "updated description",
                      "tags": ["pdf", "updated"]
                    }
                    """))
            .andExpect(status().isOk());

        JsonNode updatedDocument = readJson(mockMvc.perform(get("/ops-knowledge/documents/{documentId}", documentId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(updatedDocument.path("title").asText()).isEqualTo("Updated PDF Title");
        assertThat(updatedDocument.path("description").asText()).isEqualTo("updated description");
        assertThat(updatedDocument.path("tags").toString()).contains("updated");

        JsonNode rebuild = readJson(mockMvc.perform(post("/ops-knowledge/documents/{documentId}:rebuild", documentId))
            .andExpect(status().isOk())
            .andReturn());
        JsonNode reindex = readJson(mockMvc.perform(post("/ops-knowledge/documents/{documentId}:reindex", documentId))
            .andExpect(status().isOk())
            .andReturn());
        JsonNode rechunk = readJson(mockMvc.perform(post("/ops-knowledge/documents/{documentId}:rechunk", documentId))
            .andExpect(status().isOk())
            .andReturn());

        JsonNode jobs = readJson(mockMvc.perform(get("/ops-knowledge/jobs"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(jobs.path("total").asInt()).isGreaterThanOrEqualTo(4);

        JsonNode jobDetail = readJson(mockMvc.perform(get("/ops-knowledge/jobs/{jobId}", ingestJobId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(jobDetail.path("id").asText()).isEqualTo(ingestJobId);

        mockMvc.perform(post("/ops-knowledge/jobs/{jobId}:cancel", rebuild.path("jobId").asText()))
            .andExpect(status().isOk());
        mockMvc.perform(post("/ops-knowledge/jobs/{jobId}:retry", reindex.path("jobId").asText()))
            .andExpect(status().isBadRequest());

        MockMultipartFile unsupported = new MockMultipartFile(
            "files",
            "unsupported.bin",
            MediaType.APPLICATION_OCTET_STREAM_VALUE,
            "binary-data".getBytes()
        );
        mockMvc.perform(multipart("/ops-knowledge/sources/{sourceId}/documents:ingest", sourceId).file(unsupported))
            .andExpect(status().isBadRequest());
        String failedJobId = jdbcTemplate.queryForObject(
            "select id from ingestion_job where status = 'FAILED' order by created_at desc limit 1",
            String.class
        );
        mockMvc.perform(post("/ops-knowledge/jobs/{jobId}:retry", failedJobId))
            .andExpect(status().isOk());

        JsonNode logs = readJson(mockMvc.perform(get("/ops-knowledge/jobs/{jobId}/logs", rechunk.path("jobId").asText()))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(logs.path("entries").isArray()).isTrue();

        int beforeDeleteDocumentCount = jdbcTemplate.queryForObject("select count(*) from knowledge_document", Integer.class);
        int beforeDeleteChunkCount = jdbcTemplate.queryForObject("select count(*) from document_chunk where document_id = ?", Integer.class, documentId);

        mockMvc.perform(delete("/ops-knowledge/documents/{documentId}", documentId))
            .andExpect(status().isOk());

        mockMvc.perform(get("/ops-knowledge/documents/{documentId}", documentId))
            .andExpect(status().isNotFound());

        assertThat(jdbcTemplate.queryForObject("select count(*) from knowledge_document", Integer.class)).isEqualTo(beforeDeleteDocumentCount - 1);
        assertThat(jdbcTemplate.queryForObject("select count(*) from document_chunk where document_id = ?", Integer.class, documentId)).isZero();
        assertThat(beforeDeleteChunkCount).isGreaterThan(0);
        assertThat(Files.exists(RUNTIME_BASE_DIR.resolve("artifacts").resolve(sourceId).resolve(documentId))).isFalse();
        assertThat(Files.exists(RUNTIME_BASE_DIR.resolve("upload").resolve(sourceId).resolve(documentId))).isFalse();
    }

    @Test
    void shouldCoverChunkCrudReorderReindexAndPersistence() throws Exception {
        String sourceId = createSource(null, null);
        uploadInputFiles(sourceId);
        JsonNode documents = listDocuments(sourceId);
        String documentId = documentIdByName(documents, "Comprehensive_Quality_Report_20260204_132159_EN_matplotlib_chart.xlsx");

        JsonNode initialChunks = readJson(mockMvc.perform(get("/ops-knowledge/documents/{documentId}/chunks", documentId))
            .andExpect(status().isOk())
            .andReturn());
        int initialChunkCount = initialChunks.path("total").asInt();
        String existingChunkId = initialChunks.path("items").get(0).path("id").asText();

        JsonNode createdChunk = readJson(mockMvc.perform(post("/ops-knowledge/documents/{documentId}/chunks", documentId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "ordinal": 999,
                      "title": "Custom Chunk",
                      "titlePath": ["Custom Chunk"],
                      "keywords": ["custom-keyword"],
                      "text": "custom-search-term appears here",
                      "markdown": "## Custom Chunk\\n\\ncustom-search-term appears here",
                      "pageFrom": 1,
                      "pageTo": 1
                    }
                    """))
            .andExpect(status().isOk())
            .andReturn());
        String chunkId = createdChunk.path("id").asText();

        assertThat(jdbcTemplate.queryForObject("select count(*) from document_chunk where document_id = ?", Integer.class, documentId))
            .isEqualTo(initialChunkCount + 1);

        mockMvc.perform(patch("/ops-knowledge/chunks/{chunkId}", chunkId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "title": "Updated Custom Chunk",
                      "titlePath": ["Updated", "Custom Chunk"],
                      "keywords": ["updated-keyword"],
                      "text": "updated-custom-search-term appears here",
                      "markdown": "## Updated Custom Chunk\\n\\nupdated-custom-search-term appears here",
                      "pageFrom": 2,
                      "pageTo": 2
                    }
                    """))
            .andExpect(status().isOk());

        JsonNode chunkDetail = readJson(mockMvc.perform(get("/ops-knowledge/chunks/{chunkId}", chunkId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(chunkDetail.path("title").asText()).isEqualTo("Updated Custom Chunk");
        assertThat(chunkDetail.path("keywords").toString()).contains("updated-keyword");

        mockMvc.perform(patch("/ops-knowledge/chunks/{chunkId}/keywords", chunkId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "keywords": ["updated-keyword", "keyword-2"]
                    }
                    """))
            .andExpect(status().isOk());

        JsonNode chunkList = readJson(mockMvc.perform(get("/ops-knowledge/chunks")
                .param("documentId", documentId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(chunkList.path("total").asInt()).isEqualTo(initialChunkCount + 1);

        mockMvc.perform(post("/ops-knowledge/documents/{documentId}/chunks:reorder", documentId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "items": [
                        {"chunkId": "%s", "ordinal": 1},
                        {"chunkId": "%s", "ordinal": 999}
                      ]
                    }
                    """.formatted(chunkId, existingChunkId)))
            .andExpect(status().isOk());
        assertThat(jdbcTemplate.queryForObject("select ordinal from document_chunk where id = ?", Integer.class, chunkId)).isEqualTo(1);

        mockMvc.perform(post("/ops-knowledge/chunks/{chunkId}:reindex", chunkId))
            .andExpect(status().isOk());

        JsonNode search = search(sourceId, "updated-custom-search-term", null, null, null);
        assertThat(search.path("total").asInt()).isGreaterThan(0);

        mockMvc.perform(delete("/ops-knowledge/chunks/{chunkId}", chunkId))
            .andExpect(status().isOk());
        assertThat(jdbcTemplate.queryForObject("select count(*) from document_chunk where id = ?", Integer.class, chunkId)).isZero();
        assertThat(jdbcTemplate.queryForObject("select count(*) from document_chunk where document_id = ?", Integer.class, documentId))
            .isEqualTo(initialChunkCount);
    }

    @Test
    void shouldCoverBoundaryAndDedupBehaviors() throws Exception {
        String sourceId = createSource(null, null);
        JsonNode firstIngest = uploadInputFiles(sourceId);
        assertThat(firstIngest.path("documentCount").asInt()).isEqualTo(inputFiles().size());

        JsonNode secondIngest = uploadInputFiles(sourceId);
        assertThat(secondIngest.path("documentCount").asInt()).isZero();
        assertThat(listDocuments(sourceId).path("total").asInt()).isEqualTo(inputFiles().size());

        MockMultipartFile unsupported = new MockMultipartFile(
            "files",
            "unsupported.bin",
            MediaType.APPLICATION_OCTET_STREAM_VALUE,
            "binary-data".getBytes()
        );
        mockMvc.perform(multipart("/ops-knowledge/sources/{sourceId}/documents:ingest", sourceId).file(unsupported))
            .andExpect(status().isBadRequest());
        assertThat(jdbcTemplate.queryForObject("select count(*) from ingestion_job where status = 'FAILED'", Integer.class)).isGreaterThan(0);

        mockMvc.perform(post("/ops-knowledge/sources")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name": "",
                      "description": "invalid"
                    }
                    """))
            .andExpect(status().isBadRequest());

        mockMvc.perform(post("/ops-knowledge/search")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "query": "incident",
                      "sourceIds": ["%s"],
                      "topK": 0
                    }
                    """.formatted(sourceId)))
            .andExpect(status().isBadRequest());

        String anyChunkId = jdbcTemplate.queryForObject("select id from document_chunk limit 1", String.class);
        mockMvc.perform(get("/ops-knowledge/fetch/{chunkId}", anyChunkId)
                .param("includeNeighbors", "true")
                .param("neighborWindow", "99"))
            .andExpect(status().isBadRequest());

        mockMvc.perform(post("/ops-knowledge/profiles/bind")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "sourceId": "not-found",
                      "indexProfileId": "not-found",
                      "retrievalProfileId": "not-found"
                    }
                    """))
            .andExpect(status().isNotFound());

        mockMvc.perform(get("/ops-knowledge/sources/not-found"))
            .andExpect(status().isNotFound());
        mockMvc.perform(get("/ops-knowledge/documents/not-found"))
            .andExpect(status().isNotFound());
        mockMvc.perform(get("/ops-knowledge/chunks/not-found"))
            .andExpect(status().isNotFound());
        mockMvc.perform(get("/ops-knowledge/jobs/not-found"))
            .andExpect(status().isNotFound());
        mockMvc.perform(get("/ops-knowledge/profiles/index/not-found"))
            .andExpect(status().isNotFound());
        mockMvc.perform(get("/ops-knowledge/profiles/retrieval/not-found"))
            .andExpect(status().isNotFound());
    }

    private String createSource(String indexProfileId, String retrievalProfileId) throws Exception {
        String body = """
            {
              "name": "coverage-source-%s",
              "description": "coverage test source"%s%s
            }
            """.formatted(
            UUID.randomUUID(),
            indexProfileId != null ? ",\n  \"indexProfileId\": \"" + indexProfileId + "\"" : "",
            retrievalProfileId != null ? ",\n  \"retrievalProfileId\": \"" + retrievalProfileId + "\"" : ""
        );
        JsonNode json = readJson(mockMvc.perform(post("/ops-knowledge/sources")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andReturn());
        return json.path("id").asText();
    }

    private JsonNode uploadInputFiles(String sourceId) throws Exception {
        var ingestRequest = multipart("/ops-knowledge/sources/{sourceId}/documents:ingest", sourceId);
        for (Path file : inputFiles()) {
            ingestRequest.file(toMultipartFile(file));
        }
        return readJson(mockMvc.perform(ingestRequest)
            .andExpect(status().isOk())
            .andReturn());
    }

    private JsonNode listDocuments(String sourceId) throws Exception {
        return readJson(mockMvc.perform(get("/ops-knowledge/documents")
                .param("sourceId", sourceId))
            .andExpect(status().isOk())
            .andReturn());
    }

    private JsonNode search(String sourceId, String query, List<String> documentIds, Integer topK, List<String> contentTypes) throws Exception {
        String documentIdsJson = documentIds == null ? "[]" : objectMapper.writeValueAsString(documentIds);
        String filtersJson = contentTypes == null ? "null" : "{\"contentTypes\":" + objectMapper.writeValueAsString(contentTypes) + "}";
        return readJson(mockMvc.perform(post("/ops-knowledge/search")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "query": "%s",
                      "sourceIds": ["%s"],
                      "documentIds": %s,
                      "topK": %d,
                      "filters": %s
                    }
                    """.formatted(query, sourceId, documentIdsJson, topK == null ? 10 : topK, filtersJson)))
            .andExpect(status().isOk())
            .andReturn());
    }

    private void assertSearchHitsDocument(String sourceId, String documentId, String query) throws Exception {
        JsonNode response = search(sourceId, query, List.of(documentId), 10, null);
        assertThat(response.path("total").asInt()).isGreaterThan(0);
        assertThat(response.path("hits").get(0).path("documentId").asText()).isEqualTo(documentId);
    }

    private List<Path> inputFiles() throws IOException {
        try (Stream<Path> files = Files.list(INPUT_FILES_DIR)) {
            return files
                .filter(Files::isRegularFile)
                .filter(path -> !path.getFileName().toString().startsWith("."))
                .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                .toList();
        }
    }

    private MockMultipartFile toMultipartFile(Path file) throws IOException {
        String contentType = Files.probeContentType(file);
        return new MockMultipartFile(
            "files",
            file.getFileName().toString(),
            contentType != null ? contentType : MediaType.APPLICATION_OCTET_STREAM_VALUE,
            Files.readAllBytes(file)
        );
    }

    private JsonNode readJson(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private Set<String> fileNames(JsonNode documents) {
        return stream(documents.path("items")).map(item -> item.path("name").asText()).collect(Collectors.toSet());
    }

    private Set<String> fileNames(List<Path> files) {
        return files.stream().map(path -> path.getFileName().toString()).collect(Collectors.toSet());
    }

    private String documentIdByName(JsonNode documents, String fileName) {
        return stream(documents.path("items"))
            .filter(item -> fileName.equals(item.path("name").asText()))
            .findFirst()
            .orElseThrow()
            .path("id")
            .asText();
    }

    private String contentTypeByName(JsonNode documents, String fileName) {
        return stream(documents.path("items"))
            .filter(item -> fileName.equals(item.path("name").asText()))
            .findFirst()
            .orElseThrow()
            .path("contentType")
            .asText();
    }

    private Stream<JsonNode> stream(JsonNode array) {
        return java.util.stream.StreamSupport.stream(array.spliterator(), false);
    }

    private void resetDatabase() {
        jdbcTemplate.update("delete from embedding_record");
        jdbcTemplate.update("delete from source_profile_binding");
        jdbcTemplate.update("delete from document_chunk");
        jdbcTemplate.update("delete from knowledge_document");
        jdbcTemplate.update("delete from ingestion_job");
        jdbcTemplate.update("delete from knowledge_source");
        jdbcTemplate.update("delete from index_profile where name <> 'system-default-index'");
        jdbcTemplate.update("delete from retrieval_profile where name <> 'system-default-retrieval'");
    }

    private static void recreateDirectory(Path dir) throws IOException {
        if (Files.exists(dir)) {
            try (Stream<Path> walk = Files.walk(dir)) {
                walk.sorted(Comparator.reverseOrder())
                    .filter(path -> !path.equals(dir))
                    .forEach(path -> {
                        try {
                            Files.deleteIfExists(path);
                        } catch (IOException e) {
                            throw new IllegalStateException("Failed to delete " + path, e);
                        }
                    });
            }
        }
        Files.createDirectories(dir);
    }
}

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
class KnowledgeUploadFlowIntegrationTest {

    private static final Path RUNTIME_BASE_DIR = Path.of("target/test-runtime").toAbsolutePath().normalize();
    private static final Path INPUT_FILES_DIR = Path.of("src/test/resources/inputFiles").toAbsolutePath().normalize();
    private static final Path OUTPUT_FILES_DIR = Path.of("src/test/resources/outputFiles").toAbsolutePath().normalize();

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
    void resetDirectories() throws IOException {
        resetDatabase();
        recreateDirectory(RUNTIME_BASE_DIR.resolve("upload"));
        recreateDirectory(RUNTIME_BASE_DIR.resolve("artifacts"));
        recreateDirectory(RUNTIME_BASE_DIR.resolve("indexes"));
        recreateDirectory(OUTPUT_FILES_DIR);
    }

    @Test
    void shouldIngestUploadedDocumentsAndServeSearchAndFetch() throws Exception {
        String sourceId = createSource();
        List<Path> sampleFiles = inputFiles();
        assertThat(sampleFiles).isNotEmpty();

        var ingestRequest = multipart("/ops-knowledge/sources/{sourceId}/documents:ingest", sourceId);
        for (Path file : sampleFiles) {
            ingestRequest.file(toMultipartFile(file));
        }
        MvcResult ingestResult = mockMvc.perform(ingestRequest)
            .andExpect(status().isOk())
            .andReturn();

        JsonNode ingestJson = objectMapper.readTree(ingestResult.getResponse().getContentAsString());
        assertThat(ingestJson.path("documentCount").asInt()).isEqualTo(sampleFiles.size());
        assertThat(ingestJson.path("status").asText()).isEqualTo("SUCCEEDED");

        JsonNode sourceStats = readJson(mockMvc.perform(get("/ops-knowledge/sources/{sourceId}/stats", sourceId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(sourceStats.path("documentCount").asInt()).isEqualTo(sampleFiles.size());
        assertThat(sourceStats.path("chunkCount").asInt()).isGreaterThan(0);

        JsonNode documentList = readJson(mockMvc.perform(get("/ops-knowledge/documents")
                .param("sourceId", sourceId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(documentList.path("total").asInt()).isEqualTo(sampleFiles.size());

        JsonNode firstDocument = documentList.path("items").get(0);
        assertThat(firstDocument).isNotNull();
        String documentId = firstDocument.path("id").asText();

        JsonNode chunks = readJson(mockMvc.perform(get("/ops-knowledge/documents/{documentId}/chunks", documentId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(chunks.path("total").asInt()).isGreaterThan(0);
        String firstChunkId = chunks.path("items").get(0).path("id").asText();

        JsonNode searchResponse = readJson(mockMvc.perform(post("/ops-knowledge/search")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "query": "SLA",
                      "sourceIds": ["%s"],
                      "topK": 10
                    }
                    """.formatted(sourceId)))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(searchResponse.path("total").asInt()).isGreaterThan(0);

        String hitChunkId = searchResponse.path("hits").get(0).path("chunkId").asText(firstChunkId);
        JsonNode fetchResponse = readJson(mockMvc.perform(get("/ops-knowledge/fetch/{chunkId}", hitChunkId)
                .param("includeNeighbors", "true")
                .param("neighborWindow", "1"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(fetchResponse.path("chunkId").asText()).isEqualTo(hitChunkId);
        assertThat(fetchResponse.path("text").asText()).isNotBlank();

        JsonNode overview = readJson(mockMvc.perform(get("/ops-knowledge/stats/overview"))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(overview.path("documentCount").asInt()).isEqualTo(sampleFiles.size());
        assertThat(overview.path("chunkCount").asInt()).isGreaterThan(0);
    }

    @Test
    void shouldExportMarkdownArtifactsToOutputFilesDirectory() throws Exception {
        String sourceId = createSource();
        uploadInputFiles(sourceId);

        JsonNode documentList = readJson(mockMvc.perform(get("/ops-knowledge/documents")
                .param("sourceId", sourceId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(documentList.path("total").asInt()).isGreaterThan(0);

        for (JsonNode item : documentList.path("items")) {
            String documentId = item.path("id").asText();
            String fileName = item.path("name").asText();
            String markdown = mockMvc.perform(get("/ops-knowledge/documents/{documentId}/artifacts/markdown", documentId))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
            Path outputFile = OUTPUT_FILES_DIR.resolve(toMarkdownFileName(fileName));
            Files.writeString(outputFile, markdown);
            assertThat(markdown).isNotBlank();
            assertThat(Files.exists(outputFile)).isTrue();
            assertThat(Files.size(outputFile)).isGreaterThan(0L);
        }

        try (Stream<Path> files = Files.list(OUTPUT_FILES_DIR)) {
            List<Path> markdownFiles = files
                .filter(Files::isRegularFile)
                .filter(path -> path.getFileName().toString().endsWith(".md"))
                .toList();
            assertThat(markdownFiles).hasSize(documentList.path("total").asInt());
        }
    }

    @Test
    void shouldSupportChunkCrudAndReflectChangesInSearch() throws Exception {
        String sourceId = createSource();
        uploadInputFiles(sourceId);

        JsonNode documentList = readJson(mockMvc.perform(get("/ops-knowledge/documents")
                .param("sourceId", sourceId))
            .andExpect(status().isOk())
            .andReturn());
        String documentId = documentList.path("items").get(0).path("id").asText();

        JsonNode createdChunk = readJson(mockMvc.perform(post("/ops-knowledge/documents/{documentId}/chunks", documentId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "ordinal": 999,
                      "title": "Manual Validation Chunk",
                      "titlePath": ["Manual Validation Chunk"],
                      "keywords": ["manual-keyword"],
                      "text": "manual-only-term appears in this manually managed chunk",
                      "markdown": "## Manual Validation Chunk\\n\\nmanual-only-term appears in this manually managed chunk",
                      "pageFrom": 1,
                      "pageTo": 1
                    }
                    """))
            .andExpect(status().isOk())
            .andReturn());
        String chunkId = createdChunk.path("id").asText();

        JsonNode searchAfterCreate = search(sourceId, "manual-only-term");
        assertThat(searchAfterCreate.path("total").asInt()).isGreaterThan(0);

        mockMvc.perform(patch("/ops-knowledge/chunks/{chunkId}/keywords", chunkId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "keywords": ["manual-keyword-updated", "incident-custom"]
                    }
                    """))
            .andExpect(status().isOk());

        JsonNode fetched = readJson(mockMvc.perform(get("/ops-knowledge/fetch/{chunkId}", chunkId))
            .andExpect(status().isOk())
            .andReturn());
        assertThat(fetched.path("keywords").toString()).contains("manual-keyword-updated");

        mockMvc.perform(delete("/ops-knowledge/chunks/{chunkId}", chunkId))
            .andExpect(status().isOk());

        JsonNode searchAfterDelete = search(sourceId, "manual-only-term");
        assertThat(searchAfterDelete.path("total").asInt()).isZero();
    }

    @Test
    void shouldReturnNotFoundForMissingResources() throws Exception {
        mockMvc.perform(get("/ops-knowledge/sources/not-found"))
            .andExpect(status().isNotFound());

        mockMvc.perform(get("/ops-knowledge/documents/not-found"))
            .andExpect(status().isNotFound());

        mockMvc.perform(get("/ops-knowledge/chunks/not-found"))
            .andExpect(status().isNotFound());

        mockMvc.perform(get("/ops-knowledge/jobs/not-found"))
            .andExpect(status().isNotFound());
    }

    private String createSource() throws Exception {
        MvcResult result = mockMvc.perform(post("/ops-knowledge/sources")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "name": "report-agent-docs",
                      "description": "integration test source"
                    }
                    """))
            .andExpect(status().isOk())
            .andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).path("id").asText();
    }

    private void uploadInputFiles(String sourceId) throws Exception {
        var ingestRequest = multipart("/ops-knowledge/sources/{sourceId}/documents:ingest", sourceId);
        for (Path file : inputFiles()) {
            ingestRequest.file(toMultipartFile(file));
        }
        mockMvc.perform(ingestRequest)
            .andExpect(status().isOk());
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

    private JsonNode search(String sourceId, String query) throws Exception {
        return readJson(mockMvc.perform(post("/ops-knowledge/search")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "query": "%s",
                      "sourceIds": ["%s"],
                      "topK": 10
                    }
                    """.formatted(query, sourceId)))
            .andExpect(status().isOk())
            .andReturn());
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

    private String toMarkdownFileName(String originalName) {
        return originalName.replaceAll("[^a-zA-Z0-9._-]", "_") + ".md";
    }
}

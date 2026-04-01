package com.huawei.opsfactory.knowledge.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
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
abstract class KnowledgeApiIntegrationTestSupport {

    protected static final Path RUNTIME_BASE_DIR = Path.of("target/test-runtime-api").toAbsolutePath().normalize();
    protected static final Path INPUT_FILES_DIR = Path.of("src/test/resources/inputFiles").toAbsolutePath().normalize();

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper objectMapper;

    @Autowired
    protected JdbcTemplate jdbcTemplate;

    @DynamicPropertySource
    static void registerProperties(DynamicPropertyRegistry registry) {
        registry.add("knowledge.runtime.base-dir", () -> RUNTIME_BASE_DIR.toString());
    }

    protected void resetRuntimeState() throws IOException {
        resetDatabase();
        recreateDirectory(RUNTIME_BASE_DIR.resolve("upload"));
        recreateDirectory(RUNTIME_BASE_DIR.resolve("artifacts"));
        recreateDirectory(RUNTIME_BASE_DIR.resolve("indexes"));
    }

    protected String createSource() throws Exception {
        return createSource("test-source-" + UUID.randomUUID(), null, null);
    }

    protected String createSource(String name, String indexProfileId, String retrievalProfileId) throws Exception {
        String body = """
            {
              "name": "%s",
              "description": "integration test source"%s%s
            }
            """.formatted(
            name,
            indexProfileId != null ? ",\n  \"indexProfileId\": \"" + indexProfileId + "\"" : "",
            retrievalProfileId != null ? ",\n  \"retrievalProfileId\": \"" + retrievalProfileId + "\"" : ""
        );
        JsonNode json = readJson(mockMvc.perform(post("/knowledge/sources")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andReturn());
        return json.path("id").asText();
    }

    protected JsonNode uploadInputFiles(String sourceId) throws Exception {
        var ingestRequest = multipart("/knowledge/sources/{sourceId}/documents:ingest", sourceId);
        for (Path file : inputFiles()) {
            ingestRequest.file(toMultipartFile(file));
        }
        return readJson(mockMvc.perform(ingestRequest)
            .andExpect(status().isOk())
            .andReturn());
    }

    protected JsonNode uploadMarkdownFile(String sourceId, String fileName, String markdown) throws Exception {
        MockMultipartFile file = new MockMultipartFile("files", fileName, "text/markdown", markdown.getBytes());
        return readJson(mockMvc.perform(multipart("/knowledge/sources/{sourceId}/documents:ingest", sourceId)
                .file(file))
            .andExpect(status().isOk())
            .andReturn());
    }

    protected JsonNode listDocuments(String sourceId) throws Exception {
        return readJson(mockMvc.perform(get("/knowledge/documents")
                .param("sourceId", sourceId))
            .andExpect(status().isOk())
            .andReturn());
    }

    protected JsonNode search(String sourceId, String query) throws Exception {
        return search(sourceId, query, null, 10, null, null);
    }

    protected JsonNode search(
        String sourceId,
        String query,
        List<String> documentIds,
        Integer topK,
        List<String> contentTypes,
        String overrideJson
    ) throws Exception {
        String documentIdsJson = documentIds == null ? "[]" : objectMapper.writeValueAsString(documentIds);
        String filtersJson = contentTypes == null ? "null" : "{\"contentTypes\":" + objectMapper.writeValueAsString(contentTypes) + "}";
        String overrideValue = overrideJson == null ? "null" : overrideJson;
        return readJson(mockMvc.perform(post("/knowledge/search")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "query": "%s",
                      "sourceIds": ["%s"],
                      "documentIds": %s,
                      "topK": %d,
                      "filters": %s,
                      "override": %s
                    }
                    """.formatted(query, sourceId, documentIdsJson, topK == null ? 10 : topK, filtersJson, overrideValue)))
            .andExpect(status().isOk())
            .andReturn());
    }

    protected JsonNode compareSearch(String sourceId, String query, List<String> modes) throws Exception {
        return readJson(mockMvc.perform(post("/knowledge/search/compare")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "query": "%s",
                      "sourceIds": ["%s"],
                      "modes": %s
                    }
                    """.formatted(query, sourceId, objectMapper.writeValueAsString(modes))))
            .andExpect(status().isOk())
            .andReturn());
    }

    protected JsonNode readJson(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    protected String documentIdByName(JsonNode documents, String fileName) {
        return stream(documents.path("items"))
            .filter(item -> fileName.equals(item.path("name").asText()))
            .findFirst()
            .orElseThrow()
            .path("id")
            .asText();
    }

    protected String contentTypeByName(JsonNode documents, String fileName) {
        return stream(documents.path("items"))
            .filter(item -> fileName.equals(item.path("name").asText()))
            .findFirst()
            .orElseThrow()
            .path("contentType")
            .asText();
    }

    protected Stream<JsonNode> stream(JsonNode array) {
        return java.util.stream.StreamSupport.stream(array.spliterator(), false);
    }

    protected List<Path> inputFiles() throws IOException {
        try (Stream<Path> files = Files.list(INPUT_FILES_DIR)) {
            return files
                .filter(Files::isRegularFile)
                .filter(path -> !path.getFileName().toString().startsWith("."))
                .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                .toList();
        }
    }

    protected MockMultipartFile toMultipartFile(Path file) throws IOException {
        String contentType = Files.probeContentType(file);
        return new MockMultipartFile(
            "files",
            file.getFileName().toString(),
            contentType != null ? contentType : MediaType.APPLICATION_OCTET_STREAM_VALUE,
            Files.readAllBytes(file)
        );
    }

    protected void resetDatabase() {
        jdbcTemplate.update("delete from maintenance_job_failure");
        jdbcTemplate.update("delete from embedding_cache");
        jdbcTemplate.update("delete from source_profile_binding");
        jdbcTemplate.update("delete from document_chunk");
        jdbcTemplate.update("delete from knowledge_document");
        jdbcTemplate.update("delete from ingestion_job");
        jdbcTemplate.update("delete from knowledge_source");
        jdbcTemplate.update("delete from index_profile where name <> 'system-default-index'");
        jdbcTemplate.update("delete from retrieval_profile where name <> 'system-default-retrieval'");
    }

    protected static void recreateDirectory(Path dir) throws IOException {
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

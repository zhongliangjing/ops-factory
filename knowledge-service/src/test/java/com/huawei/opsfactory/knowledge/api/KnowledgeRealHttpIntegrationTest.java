package com.huawei.opsfactory.knowledge.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.knowledge.service.EmbeddingService;
import com.huawei.opsfactory.knowledge.service.LexicalIndexService;
import com.huawei.opsfactory.knowledge.service.SearchService;
import com.huawei.opsfactory.knowledge.service.VectorIndexService;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class KnowledgeRealHttpIntegrationTest {

    private static final Path RUNTIME_BASE_DIR = Path.of("target/test-runtime-http").toAbsolutePath().normalize();
    private static final Path INPUT_FILES_DIR = Path.of("src/test/resources/inputFiles").toAbsolutePath().normalize();
    private static final Path OUTPUT_FILES_DIR = Path.of("src/test/resources/outputFiles").toAbsolutePath().normalize();

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private VectorIndexService vectorIndexService;

    @Autowired
    private LexicalIndexService lexicalIndexService;

    @Autowired
    private EmbeddingService embeddingService;

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
        recreateDirectory(OUTPUT_FILES_DIR);
    }

    @Test
    void shouldBehaveLikeARealClientUsingHttpAndMultipartUpload() throws Exception {
        String sourceId = createSourceOverHttp();
        uploadFilesOverHttp(sourceId, inputFiles());
        int expectedImportedCount = getJson("/knowledge/documents?sourceId=" + sourceId).path("total").asInt();

        JsonNode sourceStats = getJson("/knowledge/sources/" + sourceId + "/stats");
        assertThat(sourceStats.path("documentCount").asInt()).isEqualTo(expectedImportedCount);
        assertThat(sourceStats.path("chunkCount").asInt()).isGreaterThan(0);

        JsonNode documentList = getJson("/knowledge/documents?sourceId=" + sourceId);
        assertThat(documentList.path("total").asInt()).isEqualTo(expectedImportedCount);

        JsonNode firstDocument = documentList.path("items").get(0);
        String documentId = firstDocument.path("id").asText();
        JsonNode chunks = getJson("/knowledge/documents/" + documentId + "/chunks");
        assertThat(chunks.path("total").asInt()).isGreaterThan(0);

        JsonNode searchResponse = postJson("/knowledge/search", """
            {
              "query": "incident",
              "sourceIds": ["%s"],
              "topK": 10
            }
            """.formatted(sourceId));
        assertThat(searchResponse.path("total").asInt()).isGreaterThan(0);

        JsonNode compareResponse = postJson("/knowledge/search/compare", """
            {
              "query": "incident",
              "sourceIds": ["%s"]
            }
            """.formatted(sourceId));
        assertThat(compareResponse.path("fetchedTopK").asInt()).isEqualTo(64);
        assertThat(compareResponse.path("hybrid").path("hits").isArray()).isTrue();
        assertThat(compareResponse.path("semantic").path("hits").isArray()).isTrue();
        assertThat(compareResponse.path("lexical").path("hits").isArray()).isTrue();

        String hitChunkId = searchResponse.path("hits").get(0).path("chunkId").asText();
        JsonNode fetchResponse = getJson("/knowledge/fetch/" + hitChunkId + "?includeNeighbors=true&neighborWindow=1");
        assertThat(fetchResponse.path("text").asText()).isNotBlank();

        for (JsonNode item : documentList.path("items")) {
            String currentDocumentId = item.path("id").asText();
            String fileName = item.path("name").asText();
            ResponseEntity<String> markdownResponse = restTemplate.getForEntity(url("/knowledge/documents/" + currentDocumentId + "/artifacts/markdown"), String.class);
            assertThat(markdownResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
            String markdown = markdownResponse.getBody();
            assertThat(markdown).isNotBlank();
            Files.writeString(OUTPUT_FILES_DIR.resolve(toMarkdownFileName(fileName)), markdown);
        }

        try (Stream<Path> files = Files.list(OUTPUT_FILES_DIR)) {
            assertThat(files.filter(Files::isRegularFile).count()).isEqualTo(expectedImportedCount);
        }
    }

    @Test
    void shouldServeCompareSearchForItsmQueryOverRealHttp() throws Exception {
        String sourceId = createSourceOverHttp();
        uploadMarkdownOverHttp(sourceId, "itsm-deployment.md", """
            # ITSM 部署方案

            ITSM 部署在 itsm-01 和 itsm-02 两台服务器上。
            运维智能体平台部署在 EulerOS 2 SP12 x86 环境。
            """);

        JsonNode compareResponse = postJson("/knowledge/search/compare", """
            {
              "query": "ITSM",
              "sourceIds": ["%s"]
            }
            """.formatted(sourceId));

        assertThat(compareResponse.path("fetchedTopK").asInt()).isEqualTo(64);
        assertThat(compareResponse.path("hybrid").path("hits").size()).isGreaterThan(0);
        assertThat(compareResponse.path("semantic").path("hits").size()).isGreaterThan(0);
        assertThat(compareResponse.path("lexical").path("hits").size()).isGreaterThan(0);
    }

    @Test
    void shouldInvalidateStaleEmbeddingCacheDuringVectorRebuild() throws Exception {
        String sourceId = createSourceOverHttp();
        uploadMarkdownOverHttp(sourceId, "legacy-embedding.md", """
            # Incident runbook

            ITSM incident handling requires deployment records and topology context.
            """);

        String vectorJson = objectMapper.writeValueAsString(createVector(2560, 0.01d));
        jdbcTemplate.update("update embedding_cache set dimension = ?, vector_json = ?", 2560, vectorJson);

        vectorIndexService.rebuildOnStartup();

        Integer maxDimension = jdbcTemplate.queryForObject("select max(dimension) from embedding_cache", Integer.class);
        assertThat(maxDimension).isEqualTo(1024);

        JsonNode compareResponse = postJson("/knowledge/search/compare", """
            {
              "query": "ITSM",
              "sourceIds": ["%s"]
            }
            """.formatted(sourceId));
        assertThat(compareResponse.path("semantic").path("hits").isArray()).isTrue();
    }

    @Test
    void shouldHitContentLevelEmbeddingCacheAcrossDifferentChunkIds() throws Exception {
        String sourceId = createSourceOverHttp();
        uploadMarkdownOverHttp(sourceId, "cache-hit.md", """
            # Cache hit

            Shared embedding content for cache reuse.
            """);

        JsonNode documents = getJson("/knowledge/documents?sourceId=" + sourceId);
        String documentId = documents.path("items").get(0).path("id").asText();

        int initialCacheCount = jdbcTemplate.queryForObject("select count(*) from embedding_cache", Integer.class);

        JsonNode firstChunk = postJson("/knowledge/documents/" + documentId + "/chunks", """
            {
              "ordinal": 900,
              "title": "Shared chunk",
              "titlePath": ["Shared", "Chunk"],
              "keywords": ["cache-hit"],
              "text": "Shared embedding content for cache reuse.",
              "markdown": "Shared embedding content for cache reuse.",
              "pageFrom": 1,
              "pageTo": 1
            }
            """);
        int afterFirstInsert = jdbcTemplate.queryForObject("select count(*) from embedding_cache", Integer.class);

        JsonNode secondChunk = postJson("/knowledge/documents/" + documentId + "/chunks", """
            {
              "ordinal": 901,
              "title": "Shared chunk",
              "titlePath": ["Shared", "Chunk"],
              "keywords": ["cache-hit"],
              "text": "Shared embedding content for cache reuse.",
              "markdown": "Shared embedding content for cache reuse.",
              "pageFrom": 1,
              "pageTo": 1
            }
            """);
        int afterSecondInsert = jdbcTemplate.queryForObject("select count(*) from embedding_cache", Integer.class);
        String contentHash = embeddingHash(embeddingService.buildChunkEmbeddingText(new SearchService.SearchableChunk(
            secondChunk.path("id").asText(),
            documentId,
            sourceId,
            "Shared chunk",
            List.of("Shared", "Chunk"),
            List.of("cache-hit"),
            "Shared embedding content for cache reuse.",
            "Shared embedding content for cache reuse.",
            1,
            1,
            901,
            "ACTIVE",
            "tester"
        )));
        Integer contentHashRows = jdbcTemplate.queryForObject(
            "select count(*) from embedding_cache where content_hash = ?",
            Integer.class,
            contentHash
        );

        assertThat(firstChunk.path("id").asText()).isNotEqualTo(secondChunk.path("id").asText());
        assertThat(afterFirstInsert).isEqualTo(initialCacheCount + 1);
        assertThat(afterSecondInsert)
            .withFailMessage("Expected content-level embedding cache hit, but cache row count changed from %s to %s", afterFirstInsert, afterSecondInsert)
            .isEqualTo(afterFirstInsert);
        assertThat(contentHashRows)
            .withFailMessage("Expected exactly one embedding_cache row for identical content hash %s", contentHash)
            .isEqualTo(1);
    }

    @Test
    void shouldRebuildIndexesForMiguKnowledgeBaseUsingUploadedDocuments() throws Exception {
        String sourceId = createSourceOverHttp("咪咕运维知识库 —— 测试");
        uploadFilesOverHttp(sourceId, inputFiles());

        int cacheCountBeforeRebuild = jdbcTemplate.queryForObject("select count(*) from embedding_cache", Integer.class);

        lexicalIndexService.rebuildOnStartup();
        vectorIndexService.rebuildOnStartup();

        int cacheCountAfterRebuild = jdbcTemplate.queryForObject("select count(*) from embedding_cache", Integer.class);
        JsonNode compareResponse = postJson("/knowledge/search/compare", """
            {
              "query": "incident deployment topology",
              "sourceIds": ["%s"]
            }
            """.formatted(sourceId));

        assertThat(cacheCountBeforeRebuild).isGreaterThan(0);
        assertThat(cacheCountAfterRebuild)
            .withFailMessage("Expected rebuild to reuse content-level embedding cache for uploaded documents in source %s", sourceId)
            .isEqualTo(cacheCountBeforeRebuild);
        assertThat(compareResponse.path("semantic").path("hits").size()).isGreaterThan(0);
        assertThat(compareResponse.path("lexical").path("hits").size()).isGreaterThan(0);
    }

    private String createSourceOverHttp() throws Exception {
        return createSourceOverHttp("http-source-" + UUID.randomUUID());
    }

    private String createSourceOverHttp(String sourceName) throws Exception {
        JsonNode json = postJson("/knowledge/sources", """
            {
              "name": "%s",
              "description": "real http integration test source"
            }
            """.formatted(sourceName));
        return json.path("id").asText();
    }

    private void uploadFilesOverHttp(String sourceId, List<Path> files) throws IOException {
        String boundary = "----KnowledgeBoundary" + UUID.randomUUID().toString().replace("-", "");
        List<byte[]> byteArrays = new ArrayList<>();
        for (Path file : files) {
            String contentType = Files.probeContentType(file);
            String header = "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"files\"; filename=\"" + file.getFileName() + "\"\r\n"
                + "Content-Type: " + (contentType != null ? contentType : MediaType.APPLICATION_OCTET_STREAM_VALUE) + "\r\n\r\n";
            byteArrays.add(header.getBytes(StandardCharsets.UTF_8));
            byteArrays.add(Files.readAllBytes(file));
            byteArrays.add("\r\n".getBytes(StandardCharsets.UTF_8));
        }
        byteArrays.add(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url("/knowledge/sources/" + sourceId + "/documents:ingest")))
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .POST(HttpRequest.BodyPublishers.ofByteArrays(byteArrays))
            .build();

        try {
            HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode())
                .withFailMessage("Unexpected upload response: status=%s body=%s", response.statusCode(), response.body())
                .isEqualTo(HttpStatus.OK.value());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Multipart upload interrupted", e);
        }
    }

    private void uploadMarkdownOverHttp(String sourceId, String fileName, String markdown) throws Exception {
        String boundary = "----KnowledgeBoundary" + UUID.randomUUID().toString().replace("-", "");
        byte[] payload = (
            "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"files\"; filename=\"" + fileName + "\"\r\n"
                + "Content-Type: text/markdown\r\n\r\n"
                + markdown
                + "\r\n--" + boundary + "--\r\n"
        ).getBytes(StandardCharsets.UTF_8);

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url("/knowledge/sources/" + sourceId + "/documents:ingest")))
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
            .build();

        HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode())
            .withFailMessage("Unexpected markdown upload response: status=%s body=%s", response.statusCode(), response.body())
            .isEqualTo(HttpStatus.OK.value());
    }

    private JsonNode getJson(String path) throws Exception {
        ResponseEntity<String> response = restTemplate.getForEntity(url(path), String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return objectMapper.readTree(response.getBody());
    }

    private JsonNode postJson(String path, String body) throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<String> response = restTemplate.exchange(
            url(path),
            HttpMethod.POST,
            new HttpEntity<>(body, headers),
            String.class
        );
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return objectMapper.readTree(response.getBody());
    }

    private String url(String path) {
        return "http://127.0.0.1:" + port + path;
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

    private void resetDatabase() {
        jdbcTemplate.update("delete from embedding_cache");
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

    private List<Double> createVector(int size, double value) {
        Double[] values = new Double[size];
        for (int index = 0; index < size; index++) {
            values[index] = value;
        }
        return List.of(values);
    }

    private String embeddingHash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}

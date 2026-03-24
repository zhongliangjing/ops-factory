package com.huawei.opsfactory.knowledge.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
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

        JsonNode sourceStats = getJson("/ops-knowledge/sources/" + sourceId + "/stats");
        assertThat(sourceStats.path("documentCount").asInt()).isEqualTo(inputFiles().size());
        assertThat(sourceStats.path("chunkCount").asInt()).isGreaterThan(0);

        JsonNode documentList = getJson("/ops-knowledge/documents?sourceId=" + sourceId);
        assertThat(documentList.path("total").asInt()).isEqualTo(inputFiles().size());

        JsonNode firstDocument = documentList.path("items").get(0);
        String documentId = firstDocument.path("id").asText();
        JsonNode chunks = getJson("/ops-knowledge/documents/" + documentId + "/chunks");
        assertThat(chunks.path("total").asInt()).isGreaterThan(0);

        JsonNode searchResponse = postJson("/ops-knowledge/search", """
            {
              "query": "incident",
              "sourceIds": ["%s"],
              "topK": 10
            }
            """.formatted(sourceId));
        assertThat(searchResponse.path("total").asInt()).isGreaterThan(0);

        String hitChunkId = searchResponse.path("hits").get(0).path("chunkId").asText();
        JsonNode fetchResponse = getJson("/ops-knowledge/fetch/" + hitChunkId + "?includeNeighbors=true&neighborWindow=1");
        assertThat(fetchResponse.path("text").asText()).isNotBlank();

        for (JsonNode item : documentList.path("items")) {
            String currentDocumentId = item.path("id").asText();
            String fileName = item.path("name").asText();
            ResponseEntity<String> markdownResponse = restTemplate.getForEntity(url("/ops-knowledge/documents/" + currentDocumentId + "/artifacts/markdown"), String.class);
            assertThat(markdownResponse.getStatusCode()).isEqualTo(HttpStatus.OK);
            String markdown = markdownResponse.getBody();
            assertThat(markdown).isNotBlank();
            Files.writeString(OUTPUT_FILES_DIR.resolve(toMarkdownFileName(fileName)), markdown);
        }

        try (Stream<Path> files = Files.list(OUTPUT_FILES_DIR)) {
            assertThat(files.filter(Files::isRegularFile).count()).isEqualTo(inputFiles().size());
        }
    }

    private String createSourceOverHttp() throws Exception {
        String sourceName = "http-source-" + UUID.randomUUID();
        JsonNode json = postJson("/ops-knowledge/sources", """
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
            .uri(URI.create(url("/ops-knowledge/sources/" + sourceId + "/documents:ingest")))
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

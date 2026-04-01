package com.huawei.opsfactory.gateway.e2e;

import org.junit.Before;
import org.junit.Test;
import org.springframework.http.MediaType;

import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * E2E tests for FileCapsuleController endpoints:
 * GET  /agents/{agentId}/file-capsules?sessionId=xxx
 * POST /agents/{agentId}/file-capsules
 */
public class FileCapsuleEndpointE2ETest extends BaseE2ETest {

    private static final Path USERS_DIR = Path.of("/tmp/test-gateway/gateway/users");

    @Before
    public void setUp() {
        when(agentConfigService.getUserAgentDir(any(String.class), any(String.class)))
                .thenAnswer(inv -> USERS_DIR.resolve(inv.getArgument(0, String.class))
                        .resolve("agents").resolve(inv.getArgument(1, String.class)));
    }

    // ====================== GET /agents/{agentId}/file-capsules ======================

    @Test
    public void getFileCapsules_authenticated_returnsEntries() {
        Map<String, List<Map<String, String>>> entries = new LinkedHashMap<>();
        entries.put("msg_001", List.of(
                Map.of("name", "output.csv", "path", "data/output.csv")));
        when(fileService.loadOutputFiles(any(Path.class), eq("session-1")))
                .thenReturn(entries);

        webClient.get().uri("/gateway/agents/test-agent/file-capsules?sessionId=session-1")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.entries.msg_001.length()").isEqualTo(1)
                .jsonPath("$.entries.msg_001[0].name").isEqualTo("output.csv");
    }

    @Test
    public void getFileCapsules_emptyEntries_returnsEmptyMap() {
        when(fileService.loadOutputFiles(any(Path.class), eq("session-1")))
                .thenReturn(Collections.emptyMap());

        webClient.get().uri("/gateway/agents/test-agent/file-capsules?sessionId=session-1")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.entries").isMap()
                .jsonPath("$.entries.length()").isEqualTo(0);
    }

    @Test
    public void getFileCapsules_unauthenticated_returns401() {
        webClient.get().uri("/gateway/agents/test-agent/file-capsules?sessionId=session-1")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void getFileCapsules_multipleMessages_returnsAll() {
        Map<String, List<Map<String, String>>> entries = new LinkedHashMap<>();
        entries.put("msg_001", List.of(Map.of("name", "a.txt", "path", "data/a.txt")));
        entries.put("msg_002", List.of(
                Map.of("name", "b.csv", "path", "data/b.csv"),
                Map.of("name", "c.pdf", "path", "data/c.pdf")));
        when(fileService.loadOutputFiles(any(Path.class), eq("session-2")))
                .thenReturn(entries);

        webClient.get().uri("/gateway/agents/test-agent/file-capsules?sessionId=session-2")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.entries.msg_001.length()").isEqualTo(1)
                .jsonPath("$.entries.msg_002.length()").isEqualTo(2);
    }

    // ====================== POST /agents/{agentId}/file-capsules ======================

    @Test
    public void saveFileCapsule_validBody_returnsOk() {
        webClient.post().uri("/gateway/agents/test-agent/file-capsules")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"sessionId\":\"s1\",\"messageId\":\"msg_001\",\"files\":[{\"name\":\"out.csv\",\"path\":\"data/out.csv\"}]}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("ok");

        verify(fileService).persistOutputFiles(
                any(Path.class), eq("s1"), eq("msg_001"), any(List.class));
    }

    @Test
    public void saveFileCapsule_missingSessionId_returnsError() {
        webClient.post().uri("/gateway/agents/test-agent/file-capsules")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"messageId\":\"msg_001\",\"files\":[]}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("error");
    }

    @Test
    public void saveFileCapsule_missingMessageId_returnsError() {
        webClient.post().uri("/gateway/agents/test-agent/file-capsules")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"sessionId\":\"s1\",\"files\":[]}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("error");
    }

    @Test
    public void saveFileCapsule_missingFiles_returnsError() {
        webClient.post().uri("/gateway/agents/test-agent/file-capsules")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"sessionId\":\"s1\",\"messageId\":\"msg_001\"}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.status").isEqualTo("error");
    }

    @Test
    public void saveFileCapsule_unauthenticated_returns401() {
        webClient.post().uri("/gateway/agents/test-agent/file-capsules")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"sessionId\":\"s1\",\"messageId\":\"msg_001\",\"files\":[]}")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== User isolation ======================

    @Test
    public void fileCapsules_differentUsers_resolveDifferentPaths() {
        Path aliceDir = USERS_DIR.resolve("alice").resolve("agents").resolve("test-agent");
        Path bobDir = USERS_DIR.resolve("bob").resolve("agents").resolve("test-agent");

        Map<String, List<Map<String, String>>> aliceEntries = Map.of(
                "msg_a", List.of(Map.of("name", "alice.txt", "path", "alice.txt")));
        Map<String, List<Map<String, String>>> bobEntries = Map.of(
                "msg_b", List.of(Map.of("name", "bob.txt", "path", "bob.txt")));

        when(fileService.loadOutputFiles(eq(aliceDir), eq("s1"))).thenReturn(aliceEntries);
        when(fileService.loadOutputFiles(eq(bobDir), eq("s1"))).thenReturn(bobEntries);

        // Alice sees her capsules
        webClient.get().uri("/gateway/agents/test-agent/file-capsules?sessionId=s1")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.entries.msg_a[0].name").isEqualTo("alice.txt");

        // Bob sees his capsules
        webClient.get().uri("/gateway/agents/test-agent/file-capsules?sessionId=s1")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.entries.msg_b[0].name").isEqualTo("bob.txt");
    }
}

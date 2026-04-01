package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.AuthWebFilter;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.service.HostService;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

@RunWith(SpringRunner.class)
@WebFluxTest(HostController.class)
@Import({GatewayProperties.class, AuthWebFilter.class, UserContextFilter.class})
public class HostControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private HostService hostService;

    @MockBean
    private com.huawei.opsfactory.gateway.process.PrewarmService prewarmService;

    // ── listHosts ────────────────────────────────────────────────

    @Test
    public void testListHosts_empty() {
        when(hostService.listHosts(any())).thenReturn(List.of());

        webTestClient.get().uri("/gateway/hosts/")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.hosts").isArray()
                .jsonPath("$.hosts").isEmpty();
    }

    @Test
    public void testListHosts_withHosts() {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("id", "host-1");
        host.put("name", "Server1");
        host.put("credential", "***");
        when(hostService.listHosts(any())).thenReturn(List.of(host));

        webTestClient.get().uri("/gateway/hosts/")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.hosts[0].id").isEqualTo("host-1")
                .jsonPath("$.hosts[0].name").isEqualTo("Server1");
    }

    @Test
    public void testListHosts_withTagsFilter() {
        when(hostService.listHosts(any())).thenReturn(List.of());

        webTestClient.get().uri("/gateway/hosts/?tags=RCPA,GMDB")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk();
    }

    // ── getHost ──────────────────────────────────────────────────

    @Test
    public void testGetHost_existing() {
        Map<String, Object> host = new LinkedHashMap<>();
        host.put("id", "host-1");
        host.put("name", "Server1");
        host.put("credential", "***");
        when(hostService.getHost("host-1")).thenReturn(host);

        webTestClient.get().uri("/gateway/hosts/host-1")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true)
                .jsonPath("$.host.id").isEqualTo("host-1");
    }

    @Test
    public void testGetHost_notFound() {
        when(hostService.getHost("nonexistent"))
                .thenThrow(new IllegalArgumentException("Host not found: nonexistent"));

        webTestClient.get().uri("/gateway/hosts/nonexistent")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().is5xxServerError();
    }

    // ── createHost ───────────────────────────────────────────────

    @Test
    public void testCreateHost_success() {
        Map<String, Object> created = new LinkedHashMap<>();
        created.put("id", "new-id");
        created.put("name", "NewHost");
        created.put("credential", "***");
        when(hostService.createHost(any())).thenReturn(created);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "NewHost");
        body.put("ip", "10.0.0.1");

        webTestClient.post().uri("/gateway/hosts/")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isCreated()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true)
                .jsonPath("$.host.id").isEqualTo("new-id");
    }

    @Test
    public void testCreateHost_error() {
        when(hostService.createHost(any()))
                .thenThrow(new RuntimeException("Encryption failed"));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Host");

        webTestClient.post().uri("/gateway/hosts/")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.success").isEqualTo(false);
    }

    // ── updateHost ───────────────────────────────────────────────

    @Test
    public void testUpdateHost_success() {
        Map<String, Object> updated = new LinkedHashMap<>();
        updated.put("id", "host-1");
        updated.put("name", "Updated");
        when(hostService.updateHost(eq("host-1"), any())).thenReturn(updated);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Updated");

        webTestClient.put().uri("/gateway/hosts/host-1")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true)
                .jsonPath("$.host.name").isEqualTo("Updated");
    }

    @Test
    public void testUpdateHost_notFound() {
        when(hostService.updateHost(eq("nonexistent"), any()))
                .thenThrow(new IllegalArgumentException("Host not found: nonexistent"));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Updated");

        webTestClient.put().uri("/gateway/hosts/nonexistent")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isBadRequest();
    }

    // ── deleteHost ───────────────────────────────────────────────

    @Test
    public void testDeleteHost_success() {
        when(hostService.deleteHost("host-1")).thenReturn(true);

        webTestClient.delete().uri("/gateway/hosts/host-1")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true);
    }

    @Test
    public void testDeleteHost_notFound() {
        when(hostService.deleteHost("nonexistent")).thenReturn(false);

        webTestClient.delete().uri("/gateway/hosts/nonexistent")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isNotFound()
                .expectBody()
                .jsonPath("$.success").isEqualTo(false);
    }

    // ── getTags ──────────────────────────────────────────────────

    @Test
    public void testGetTags() {
        when(hostService.getAllTags()).thenReturn(List.of("RCPA", "GMDB", "ALL"));

        webTestClient.get().uri("/gateway/hosts/tags")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.tags[0]").isEqualTo("RCPA")
                .jsonPath("$.tags[1]").isEqualTo("GMDB")
                .jsonPath("$.tags[2]").isEqualTo("ALL");
    }

    // ── testConnectivity ─────────────────────────────────────────

    @Test
    public void testConnectivity_success() {
        Map<String, Object> testResult = new LinkedHashMap<>();
        testResult.put("success", true);
        testResult.put("reachable", true);
        testResult.put("latencyMs", 45);
        when(hostService.testConnection("host-1")).thenReturn(testResult);

        webTestClient.post().uri("/gateway/hosts/host-1/test")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true)
                .jsonPath("$.reachable").isEqualTo(true);
    }

    @Test
    public void testConnectivity_failure() {
        Map<String, Object> testResult = new LinkedHashMap<>();
        testResult.put("success", false);
        testResult.put("error", "Connection refused");
        when(hostService.testConnection("host-1")).thenReturn(testResult);

        webTestClient.post().uri("/gateway/hosts/host-1/test")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(false);
    }

    // ── Auth tests ───────────────────────────────────────────────

    @Test
    public void testListHosts_unauthorized_noKey() {
        webTestClient.get().uri("/gateway/hosts/")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void testListHosts_forbidden_nonAdmin() {
        webTestClient.get().uri("/gateway/hosts/")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testCreateHost_forbidden_nonAdmin() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "Host");

        webTestClient.post().uri("/gateway/hosts/")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isForbidden();
    }
}

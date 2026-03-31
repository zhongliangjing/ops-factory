package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.AuthWebFilter;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.service.CommandWhitelistService;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@RunWith(SpringRunner.class)
@WebFluxTest(CommandWhitelistController.class)
@Import({GatewayProperties.class, AuthWebFilter.class, UserContextFilter.class})
public class CommandWhitelistControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private CommandWhitelistService commandWhitelistService;

    @MockBean
    private com.huawei.opsfactory.gateway.process.PrewarmService prewarmService;

    // ── getWhitelist ─────────────────────────────────────────────

    @Test
    public void testGetWhitelist() {
        Map<String, Object> whitelist = new LinkedHashMap<>();
        whitelist.put("commands", List.of(
                Map.of("pattern", "ps", "description", "查看进程", "enabled", true),
                Map.of("pattern", "tail", "description", "查看日志", "enabled", true)
        ));
        when(commandWhitelistService.getWhitelist()).thenReturn(whitelist);

        webTestClient.get().uri("/gateway/command-whitelist/")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.commands").isArray()
                .jsonPath("$.commands[0].pattern").isEqualTo("ps");
    }

    // ── addCommand ───────────────────────────────────────────────

    @Test
    public void testAddCommand_success() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("pattern", "iostat");
        body.put("description", "IO统计");
        body.put("enabled", true);

        webTestClient.post().uri("/gateway/command-whitelist/")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isCreated()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true);
    }

    @Test
    public void testAddCommand_error() {
        doThrow(new RuntimeException("Write failed"))
                .when(commandWhitelistService).addCommand(any());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("pattern", "test");

        webTestClient.post().uri("/gateway/command-whitelist/")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.success").isEqualTo(false);
    }

    // ── updateCommand ────────────────────────────────────────────

    @Test
    public void testUpdateCommand_success() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("description", "updated desc");
        body.put("enabled", false);

        webTestClient.put().uri("/gateway/command-whitelist/ps")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true);
    }

    @Test
    public void testUpdateCommand_notFound() {
        doThrow(new IllegalArgumentException("Command pattern not found: unknown"))
                .when(commandWhitelistService).updateCommand(eq("unknown"), any());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("description", "test");

        webTestClient.put().uri("/gateway/command-whitelist/unknown")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isNotFound()
                .expectBody()
                .jsonPath("$.success").isEqualTo(false);
    }

    // ── deleteCommand ────────────────────────────────────────────

    @Test
    public void testDeleteCommand_success() {
        webTestClient.delete().uri("/gateway/command-whitelist/ps")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.success").isEqualTo(true);
    }

    @Test
    public void testDeleteCommand_notFound() {
        doThrow(new IllegalArgumentException("Command pattern not found: unknown"))
                .when(commandWhitelistService).deleteCommand("unknown");

        webTestClient.delete().uri("/gateway/command-whitelist/unknown")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isNotFound()
                .expectBody()
                .jsonPath("$.success").isEqualTo(false);
    }

    // ── Auth tests ───────────────────────────────────────────────

    @Test
    public void testGetWhitelist_unauthorized_noKey() {
        webTestClient.get().uri("/gateway/command-whitelist/")
                .header("x-user-id", "admin")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void testGetWhitelist_forbidden_nonAdmin() {
        webTestClient.get().uri("/gateway/command-whitelist/")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void testAddCommand_forbidden_nonAdmin() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("pattern", "test");

        webTestClient.post().uri("/gateway/command-whitelist/")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isForbidden();
    }
}

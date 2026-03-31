package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.AuthWebFilter;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.service.RemoteExecutionService;
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

import static org.mockito.Mockito.when;

@RunWith(SpringRunner.class)
@WebFluxTest(RemoteExecController.class)
@Import({GatewayProperties.class, AuthWebFilter.class, UserContextFilter.class})
public class RemoteExecControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private RemoteExecutionService remoteExecutionService;

    @MockBean
    private com.huawei.opsfactory.gateway.process.PrewarmService prewarmService;

    // ── execute: validation ──────────────────────────────────────

    @Test
    public void testExecute_missingHostId() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("command", "ps -ef");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.success").isEqualTo(false)
                .jsonPath("$.error").isEqualTo("hostId is required");
    }

    @Test
    public void testExecute_blankHostId() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "  ");
        body.put("command", "ps -ef");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").isEqualTo("hostId is required");
    }

    @Test
    public void testExecute_missingCommand() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "host-1");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.success").isEqualTo(false)
                .jsonPath("$.error").isEqualTo("command is required");
    }

    @Test
    public void testExecute_blankCommand() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "host-1");
        body.put("command", "  ");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isBadRequest()
                .expectBody()
                .jsonPath("$.error").isEqualTo("command is required");
    }

    // ── execute: success ─────────────────────────────────────────

    @Test
    public void testExecute_success() {
        Map<String, Object> execResult = new LinkedHashMap<>();
        execResult.put("hostId", "host-1");
        execResult.put("hostName", "Server1");
        execResult.put("exitCode", 0);
        execResult.put("output", "rcpa  1234  1  0  Mar27 ?  00:05:23 /rcpa/openas");
        execResult.put("error", "");
        execResult.put("duration", 1250L);
        when(remoteExecutionService.execute("host-1", "ps -ef", 30)).thenReturn(execResult);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "host-1");
        body.put("command", "ps -ef");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.hostId").isEqualTo("host-1")
                .jsonPath("$.exitCode").isEqualTo(0)
                .jsonPath("$.output").isEqualTo("rcpa  1234  1  0  Mar27 ?  00:05:23 /rcpa/openas")
                .jsonPath("$.duration").isEqualTo(1250);
    }

    @Test
    public void testExecute_customTimeout() {
        Map<String, Object> execResult = new LinkedHashMap<>();
        execResult.put("hostId", "host-1");
        execResult.put("hostName", "Server1");
        execResult.put("exitCode", 0);
        execResult.put("output", "ok");
        execResult.put("error", "");
        execResult.put("duration", 100L);
        when(remoteExecutionService.execute("host-1", "ls", 60)).thenReturn(execResult);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "host-1");
        body.put("command", "ls");
        body.put("timeout", 60);

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.exitCode").isEqualTo(0);
    }

    // ── execute: whitelist rejection ─────────────────────────────

    @Test
    public void testExecute_whitelistRejected() {
        // The service returns rejectedCommands but does NOT set success=false
        // The controller checks for Boolean.FALSE.equals(result.get("success")) && rejectedCommands
        // Since RemoteExecutionService does not set "success" key, the controller will
        // return 200 OK with the result as-is (the whitelist check in controller won't trigger)
        Map<String, Object> execResult = new LinkedHashMap<>();
        execResult.put("hostId", "host-1");
        execResult.put("hostName", "Server1");
        execResult.put("exitCode", -1);
        execResult.put("output", "");
        execResult.put("error", "Command rejected: the following commands are not in the whitelist: rm");
        execResult.put("rejectedCommands", List.of("rm"));
        execResult.put("duration", 0L);
        when(remoteExecutionService.execute("host-1", "rm -rf /", 30)).thenReturn(execResult);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "host-1");
        body.put("command", "rm -rf /");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.exitCode").isEqualTo(-1);
    }

    @Test
    public void testExecute_whitelistRejected_withSuccessFalse() {
        // If the service explicitly sets success=false AND rejectedCommands,
        // the controller should return 403 FORBIDDEN.
        // Note: Using Boolean.FALSE (not primitive false) to match controller's
        // Boolean.FALSE.equals() check.
        Map<String, Object> execResult = new LinkedHashMap<>();
        execResult.put("success", Boolean.FALSE);
        execResult.put("hostId", "host-1");
        execResult.put("hostName", "Server1");
        execResult.put("exitCode", -1);
        execResult.put("output", "");
        execResult.put("error", "Command rejected");
        execResult.put("rejectedCommands", List.of("rm"));
        execResult.put("duration", 0L);
        when(remoteExecutionService.execute("host-1", "rm -rf /", 30)).thenReturn(execResult);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "host-1");
        body.put("command", "rm -rf /");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isForbidden()
                .expectBody()
                .jsonPath("$.success").isEqualTo(false)
                .jsonPath("$.error").isEqualTo("Command rejected by whitelist");
    }

    // ── execute: host not found ──────────────────────────────────

    @Test
    public void testExecute_hostNotFound() {
        Map<String, Object> execResult = new LinkedHashMap<>();
        execResult.put("hostId", "nonexistent");
        execResult.put("hostName", "");
        execResult.put("exitCode", -1);
        execResult.put("output", "");
        execResult.put("error", "Host not found: nonexistent");
        execResult.put("duration", 0L);
        when(remoteExecutionService.execute("nonexistent", "ls", 30)).thenReturn(execResult);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "nonexistent");
        body.put("command", "ls");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.exitCode").isEqualTo(-1);
    }

    // ── Auth tests ───────────────────────────────────────────────

    @Test
    public void testExecute_unauthorized_noKey() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "host-1");
        body.put("command", "ls");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-user-id", "admin")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void testExecute_forbidden_nonAdmin() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("hostId", "host-1");
        body.put("command", "ls");

        webTestClient.post().uri("/gateway/remote/execute")
                .header("x-secret-key", "test")
                .header("x-user-id", "regular-user")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .exchange()
                .expectStatus().isForbidden();
    }
}

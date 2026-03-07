package com.huawei.opsfactory.gateway.e2e;

import org.junit.Test;

/**
 * E2E tests for the authentication filter chain.
 * Verifies AuthWebFilter and UserContextFilter behavior through real HTTP requests.
 */
public class AuthFilterE2ETest extends BaseE2ETest {

    // ====================== AuthWebFilter Tests ======================

    @Test
    public void statusEndpoint_noAuth_returns401() {
        webClient.get().uri("/status")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void protectedEndpoint_noSecretKey_returns401() {
        webClient.get().uri("/me")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void protectedEndpoint_wrongSecretKey_returns401() {
        webClient.get().uri("/me")
                .header(HEADER_SECRET_KEY, "wrong-key")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void protectedEndpoint_emptySecretKey_returns401() {
        webClient.get().uri("/me")
                .header(HEADER_SECRET_KEY, "")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    public void protectedEndpoint_validSecretKeyInHeader_returns200() {
        webClient.get().uri("/me")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .exchange()
                .expectStatus().isOk();
    }

    @Test
    public void protectedEndpoint_validSecretKeyInQueryParam_returns200() {
        webClient.get().uri("/me?key=" + SECRET_KEY)
                .exchange()
                .expectStatus().isOk();
    }

    @Test
    public void optionsRequest_noAuth_passesThrough() {
        webClient.options().uri("/me")
                .exchange()
                .expectStatus().isNoContent();
    }

    // ====================== UserContextFilter Tests ======================

    @Test
    public void meEndpoint_noUserIdHeader_defaultsToSys() {
        webClient.get().uri("/me")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("sys")
                .jsonPath("$.role").isEqualTo("admin");
    }

    @Test
    public void meEndpoint_sysUser_isAdmin() {
        webClient.get().uri("/me")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "sys")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("sys")
                .jsonPath("$.role").isEqualTo("admin");
    }

    @Test
    public void meEndpoint_regularUser_isUser() {
        webClient.get().uri("/me")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("alice")
                .jsonPath("$.role").isEqualTo("user");
    }

    @Test
    public void meEndpoint_blankUserIdHeader_defaultsToSys() {
        webClient.get().uri("/me")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "  ")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("sys")
                .jsonPath("$.role").isEqualTo("admin");
    }

    // ====================== Cross-Cutting Auth + Admin Tests ======================

    @Test
    public void adminEndpoint_regularUser_returns403() {
        webClient.get().uri("/monitoring/system")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void adminEndpoint_noAuth_returns401beforeForbidden() {
        // Auth filter runs before user context filter
        webClient.get().uri("/monitoring/system")
                .exchange()
                .expectStatus().isUnauthorized();
    }
}

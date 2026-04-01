package com.huawei.opsfactory.gateway.e2e;

import org.junit.Test;

/**
 * E2E tests for StatusController endpoints: /status, /me, /config.
 */
public class StatusEndpointE2ETest extends BaseE2ETest {

    // ====================== GET /status ======================

    @Test
    public void getStatus_returnsOk() {
        webClient.get().uri("/gateway/status")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("ok");
    }

    // ====================== GET /me ======================

    @Test
    public void getMe_sysUser_returnsSys() {
        webClient.get().uri("/gateway/me")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("admin")
                .jsonPath("$.role").isEqualTo("admin");
    }

    @Test
    public void getMe_regularUser_returnsUser() {
        webClient.get().uri("/gateway/me")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "user-123")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("user-123")
                .jsonPath("$.role").isEqualTo("user");
    }

    // ====================== GET /config ======================

    @Test
    public void getConfig_returnsOfficePreviewDefaults() {
        webClient.get().uri("/gateway/config")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.officePreview.enabled").isEqualTo(false)
                .jsonPath("$.officePreview.onlyofficeUrl").isEqualTo("")
                .jsonPath("$.officePreview.fileBaseUrl").isEqualTo("");
    }

    @Test
    public void getConfig_unauthenticated_returns401() {
        webClient.get().uri("/gateway/config")
                .exchange()
                .expectStatus().isUnauthorized();
    }
}

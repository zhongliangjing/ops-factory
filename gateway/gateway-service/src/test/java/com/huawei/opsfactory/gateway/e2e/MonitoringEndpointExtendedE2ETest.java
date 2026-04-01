package com.huawei.opsfactory.gateway.e2e;

import org.junit.Test;

/**
 * Extended E2E tests for MonitoringController covering missing parameter validation:
 * GET /monitoring/overview — missing from/to → 400
 * GET /monitoring/traces — missing from/to → 400
 * GET /monitoring/observations — missing from/to → 400
 */
public class MonitoringEndpointExtendedE2ETest extends BaseE2ETest {

    // ====================== GET /monitoring/overview — missing params ======================

    @Test
    public void overview_missingFromAndTo_returns400() {
        webClient.get().uri("/gateway/monitoring/overview")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void overview_missingTo_returns400() {
        webClient.get().uri("/gateway/monitoring/overview?from=2024-01-01")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void overview_missingFrom_returns400() {
        webClient.get().uri("/gateway/monitoring/overview?to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isBadRequest();
    }

    // ====================== GET /monitoring/traces — missing params ======================

    @Test
    public void traces_missingFromAndTo_returns400() {
        webClient.get().uri("/gateway/monitoring/traces")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void traces_missingTo_returns400() {
        webClient.get().uri("/gateway/monitoring/traces?from=2024-01-01")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void traces_missingFrom_returns400() {
        webClient.get().uri("/gateway/monitoring/traces?to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isBadRequest();
    }

    // ====================== GET /monitoring/observations — missing params ======================

    @Test
    public void observations_missingFromAndTo_returns400() {
        webClient.get().uri("/gateway/monitoring/observations")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void observations_missingTo_returns400() {
        webClient.get().uri("/gateway/monitoring/observations?from=2024-01-01")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isBadRequest();
    }

    @Test
    public void observations_missingFrom_returns400() {
        webClient.get().uri("/gateway/monitoring/observations?to=2024-01-02")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isBadRequest();
    }
}

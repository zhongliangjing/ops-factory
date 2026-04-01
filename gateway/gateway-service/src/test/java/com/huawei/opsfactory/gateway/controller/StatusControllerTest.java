package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.AuthWebFilter;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import com.huawei.opsfactory.gateway.process.PrewarmService;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.web.reactive.server.WebTestClient;

@RunWith(SpringRunner.class)
@WebFluxTest(StatusController.class)
@Import({GatewayProperties.class, AuthWebFilter.class, UserContextFilter.class})
public class StatusControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private PrewarmService prewarmService;

    @Test
    public void testStatus() {
        webTestClient.get().uri("/gateway/status")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("ok");
    }

    @Test
    public void testMe_noUserIdHeader_returnsUnknown() {
        // /me is excluded from UserContextFilter, so no user attributes are set.
        webTestClient.get().uri("/gateway/me")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("unknown")
                .jsonPath("$.role").isEqualTo("user");
    }

    @Test
    public void testMe_withUserIdHeader_returnsUser() {
        webTestClient.get().uri("/gateway/me")
                .header("x-secret-key", "test")
                .header("x-user-id", "user123")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("user123")
                .jsonPath("$.role").isEqualTo("user");
    }

    @Test
    public void testConfig() {
        webTestClient.get().uri("/gateway/config")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.officePreview.enabled").isEqualTo(false);
    }

    @Test
    public void testUnauthorized_noKey() {
        webTestClient.get().uri("/gateway/me")
                .exchange()
                .expectStatus().isUnauthorized();
    }
}

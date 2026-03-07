package com.huawei.opsfactory.gateway.controller;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import com.huawei.opsfactory.gateway.filter.AuthWebFilter;
import com.huawei.opsfactory.gateway.filter.UserContextFilter;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.web.reactive.server.WebTestClient;

@RunWith(SpringRunner.class)
@WebFluxTest(StatusController.class)
@Import({GatewayProperties.class, AuthWebFilter.class, UserContextFilter.class})
public class StatusControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @Test
    public void testStatus() {
        webTestClient.get().uri("/status")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("ok");
    }

    @Test
    public void testMe_defaultSysUser() {
        webTestClient.get().uri("/me")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("sys")
                .jsonPath("$.role").isEqualTo("admin");
    }

    @Test
    public void testMe_regularUser() {
        webTestClient.get().uri("/me")
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
        webTestClient.get().uri("/config")
                .header("x-secret-key", "test")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.officePreview.enabled").isEqualTo(false);
    }

    @Test
    public void testUnauthorized_noKey() {
        webTestClient.get().uri("/me")
                .exchange()
                .expectStatus().isUnauthorized();
    }
}

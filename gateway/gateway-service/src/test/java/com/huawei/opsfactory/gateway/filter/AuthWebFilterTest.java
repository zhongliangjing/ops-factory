package com.huawei.opsfactory.gateway.filter;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.junit.Assert.assertEquals;

public class AuthWebFilterTest {

    private AuthWebFilter filter;
    private GatewayProperties properties;

    @Before
    public void setUp() {
        properties = new GatewayProperties();
        properties.setSecretKey("test-secret");
        filter = new AuthWebFilter(properties);
    }

    @Test
    public void testStatusEndpointIsPublic() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/status").build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();
    }

    @Test
    public void testOptionsPassesThrough() {
        MockServerHttpRequest request = MockServerHttpRequest.options("/agents").build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();
    }

    @Test
    public void testValidSecretKeyInHeader() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/agents")
                .header("x-secret-key", "test-secret")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();
    }

    @Test
    public void testValidSecretKeyInQueryParam() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/agents?key=test-secret").build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();
    }

    @Test
    public void testInvalidSecretKeyReturns401() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/agents")
                .header("x-secret-key", "wrong-key")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();

        assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
    }

    @Test
    public void testMissingSecretKeyReturns401() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/agents").build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();

        assertEquals(HttpStatus.UNAUTHORIZED, exchange.getResponse().getStatusCode());
    }
}

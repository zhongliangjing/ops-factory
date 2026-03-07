package com.huawei.opsfactory.gateway.filter;

import com.huawei.opsfactory.gateway.common.model.UserRole;
import org.junit.Before;
import org.junit.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.junit.Assert.assertEquals;

public class UserContextFilterTest {

    private UserContextFilter filter;

    @Before
    public void setUp() {
        filter = new UserContextFilter();
    }

    @Test
    public void testExtractsUserIdFromHeader() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/test")
                .header("x-user-id", "user123")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();

        assertEquals("user123", exchange.getAttribute(UserContextFilter.USER_ID_ATTR));
        assertEquals(UserRole.USER, exchange.getAttribute(UserContextFilter.USER_ROLE_ATTR));
    }

    @Test
    public void testDefaultsToSysUser() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/test").build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();

        assertEquals("sys", exchange.getAttribute(UserContextFilter.USER_ID_ATTR));
        assertEquals(UserRole.ADMIN, exchange.getAttribute(UserContextFilter.USER_ROLE_ATTR));
    }

    @Test
    public void testSysUserGetsAdminRole() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/test")
                .header("x-user-id", "sys")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();

        assertEquals(UserRole.ADMIN, exchange.getAttribute(UserContextFilter.USER_ROLE_ATTR));
    }

    @Test
    public void testEmptyUserIdDefaultsToSys() {
        MockServerHttpRequest request = MockServerHttpRequest.get("/test")
                .header("x-user-id", "")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        WebFilterChain chain = ex -> Mono.empty();
        StepVerifier.create(filter.filter(exchange, chain))
                .verifyComplete();

        assertEquals("sys", exchange.getAttribute(UserContextFilter.USER_ID_ATTR));
    }
}

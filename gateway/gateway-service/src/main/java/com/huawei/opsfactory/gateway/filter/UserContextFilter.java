package com.huawei.opsfactory.gateway.filter;

import com.huawei.opsfactory.gateway.common.constants.GatewayConstants;
import com.huawei.opsfactory.gateway.common.model.UserRole;
import com.huawei.opsfactory.gateway.process.PrewarmService;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

@Component
@Order(2)
public class UserContextFilter implements WebFilter {

    public static final String USER_ID_ATTR = "userId";
    public static final String USER_ROLE_ATTR = "userRole";

    private final PrewarmService prewarmService;

    public UserContextFilter(PrewarmService prewarmService) {
        this.prewarmService = prewarmService;
    }

    private static boolean isSystemEndpoint(String path) {
        return path.equals("/status") || path.equals("/me") || path.equals("/config") ||
               path.equals("/gateway/status") || path.equals("/gateway/me") || path.equals("/gateway/config");
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String path = request.getPath().value();

        String userId = request.getHeaders().getFirst(GatewayConstants.HEADER_USER_ID);
        if (userId == null || userId.isBlank()) {
            userId = request.getQueryParams().getFirst(GatewayConstants.QUERY_UID);
        }
        if (userId == null || userId.isBlank()) {
            // System endpoints don't require user context
            if (isSystemEndpoint(path)) {
                return chain.filter(exchange);
            }
            exchange.getResponse().setStatusCode(HttpStatus.BAD_REQUEST);
            return exchange.getResponse().setComplete();
        }

        UserRole role = UserRole.fromUserId(userId);

        exchange.getAttributes().put(USER_ID_ATTR, userId);
        exchange.getAttributes().put(USER_ROLE_ATTR, role);

        // Trigger pre-warm for authenticated users
        prewarmService.onUserActivity(userId);

        return chain.filter(exchange);
    }

    /**
     * Shared admin check — throws 403 if the current user is not an admin.
     */
    public static void requireAdmin(ServerWebExchange exchange) {
        UserRole role = exchange.getAttribute(USER_ROLE_ATTR);
        if (role == null || !role.isAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "admin access required");
        }
    }
}

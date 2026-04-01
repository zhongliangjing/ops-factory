package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import org.junit.Test;
import reactor.core.publisher.Mono;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * E2E tests for CatchAllProxyController:
 * Verifies auth, admin/user access control, and proxy routing for /agents/{agentId}/** paths.
 */
public class CatchAllProxyEndpointE2ETest extends BaseE2ETest {

    // ====================== Admin access ======================

    @Test
    public void adminAccessToSchedules_proxiesToGoosed() {
        ManagedInstance instance = new ManagedInstance("test-agent", "admin", 9000, 123L, null, "test-secret");
        instance.setStatus(ManagedInstance.Status.RUNNING);
        when(instanceManager.getOrSpawn("test-agent", "admin")).thenReturn(Mono.just(instance));
        when(goosedProxy.proxy(any(), any(), eq(9000), eq("/schedules/list"), any())).thenReturn(Mono.empty());

        webClient.get().uri("/gateway/agents/test-agent/schedules/list")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk();

        verify(goosedProxy).proxy(any(), any(), eq(9000), eq("/schedules/list"), any());
    }

    // ====================== User-accessible routes ======================

    @Test
    public void userAccessToSystemInfo_allowed() {
        ManagedInstance instance = new ManagedInstance("test-agent", "alice", 9000, 123L, null, "test-secret");
        instance.setStatus(ManagedInstance.Status.RUNNING);
        when(instanceManager.getOrSpawn("test-agent", "alice")).thenReturn(Mono.just(instance));
        when(goosedProxy.proxy(any(), any(), eq(9000), eq("/system_info"), any())).thenReturn(Mono.empty());

        webClient.get().uri("/gateway/agents/test-agent/system_info")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk();
    }

    @Test
    public void userAccessToStatus_allowed() {
        ManagedInstance instance = new ManagedInstance("test-agent", "alice", 9000, 123L, null, "test-secret");
        instance.setStatus(ManagedInstance.Status.RUNNING);
        when(instanceManager.getOrSpawn("test-agent", "alice")).thenReturn(Mono.just(instance));
        when(goosedProxy.proxy(any(), any(), eq(9000), eq("/status"), any())).thenReturn(Mono.empty());

        webClient.get().uri("/gateway/agents/test-agent/status")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk();
    }

    // ====================== Access denied ======================

    @Test
    public void userAccessToAdminRoute_returns403() {
        webClient.get().uri("/gateway/agents/test-agent/schedules/list")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isForbidden();
    }

    @Test
    public void userAccessToConfigPrompts_returns403() {
        webClient.get().uri("/gateway/agents/test-agent/config/prompts")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "bob")
                .exchange()
                .expectStatus().isForbidden();
    }

    // ====================== Authentication ======================

    @Test
    public void unauthenticated_returns401() {
        webClient.get().uri("/gateway/agents/test-agent/schedules/list")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== Query string forwarding ======================

    @Test
    public void queryStringForwarded_toGoosed() {
        ManagedInstance instance = new ManagedInstance("test-agent", "admin", 9000, 123L, null, "test-secret");
        instance.setStatus(ManagedInstance.Status.RUNNING);
        when(instanceManager.getOrSpawn("test-agent", "admin")).thenReturn(Mono.just(instance));
        when(goosedProxy.proxy(any(), any(), eq(9000), eq("/schedules/list?limit=5"), any())).thenReturn(Mono.empty());

        webClient.get().uri("/gateway/agents/test-agent/schedules/list?limit=5")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "admin")
                .exchange()
                .expectStatus().isOk();

        verify(goosedProxy).proxy(any(), any(), eq(9000), eq("/schedules/list?limit=5"), any());
    }
}

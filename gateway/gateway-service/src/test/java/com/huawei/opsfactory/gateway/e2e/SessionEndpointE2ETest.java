package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import org.junit.Before;
import org.junit.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import reactor.core.publisher.Mono;

import java.nio.file.Path;
import java.util.Collections;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * E2E tests for SessionController endpoints:
 * POST /agents/{agentId}/agent/start
 * GET /sessions
 * GET /agents/{agentId}/sessions
 * GET /agents/{agentId}/sessions/{sessionId}
 * DELETE /agents/{agentId}/sessions/{sessionId}
 */
public class SessionEndpointE2ETest extends BaseE2ETest {

    private ManagedInstance runningInstance;

    @Before
    public void setUp() {
        runningInstance = new ManagedInstance("test-agent", "alice", 9999, 12345L, null, "test-secret");
        runningInstance.setStatus(ManagedInstance.Status.RUNNING);
        // Mock getUserAgentDir for startSession working_dir injection
        when(agentConfigService.getUserAgentDir(any(String.class), any(String.class)))
                .thenAnswer(inv -> Path.of("/tmp/test-users")
                        .resolve(inv.getArgument(0, String.class))
                        .resolve("agents").resolve(inv.getArgument(1, String.class)));
    }

    // ====================== POST /agents/{agentId}/agent/start ======================

    @Test
    public void startSession_authenticated_callsStartThenResume() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/start"), anyString(), anyInt(), anyString()))
                .thenReturn(Mono.just("{\"id\":\"session-123\"}"));
        when(goosedProxy.fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/resume"), anyString(), anyInt(), anyString()))
                .thenReturn(Mono.just("{\"session\":{\"id\":\"session-123\"},\"extension_results\":[]}"));

        webClient.post().uri("/gateway/agents/test-agent/agent/start")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{\"session_name\":\"test-session\"}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.id").isEqualTo("session-123");

        // Verify canonical flow: start → resume(load_model_and_extensions=true)
        verify(goosedProxy).fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/start"), anyString(), anyInt(), anyString());
        verify(goosedProxy).fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/resume"),
                org.mockito.ArgumentMatchers.contains("\"load_model_and_extensions\":true"), anyInt(), anyString());
    }

    @Test
    public void startSession_resumeFails_propagatesError() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/start"), anyString(), anyInt(), anyString()))
                .thenReturn(Mono.just("{\"id\":\"session-123\"}"));
        when(goosedProxy.fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/resume"), anyString(), anyInt(), anyString()))
                .thenReturn(Mono.error(new RuntimeException("Extension loading failed")));

        webClient.post().uri("/gateway/agents/test-agent/agent/start")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().is5xxServerError();
    }

    @Test
    public void startSession_resumeReceivesCorrectSessionId() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/start"), anyString(), anyInt(), anyString()))
                .thenReturn(Mono.just("{\"id\":\"abc-def-456\",\"name\":\"New Chat\"}"));
        when(goosedProxy.fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/resume"), anyString(), anyInt(), anyString()))
                .thenReturn(Mono.just("{\"session\":{\"id\":\"abc-def-456\"},\"extension_results\":[]}"));

        webClient.post().uri("/gateway/agents/test-agent/agent/start")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().isOk();

        // Verify resume is called with the correct session ID from start response
        verify(goosedProxy).fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/resume"),
                org.mockito.ArgumentMatchers.contains("\"session_id\":\"abc-def-456\""), anyInt(), anyString());
    }

    @Test
    public void startSession_returnsStartResponse_notResumeResponse() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        String startResponse = "{\"id\":\"session-123\",\"name\":\"New Chat\",\"working_dir\":\"/tmp\"}";
        when(goosedProxy.fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/start"), anyString(), anyInt(), anyString()))
                .thenReturn(Mono.just(startResponse));
        when(goosedProxy.fetchJson(eq(9999), eq(HttpMethod.POST), eq("/agent/resume"), anyString(), anyInt(), anyString()))
                .thenReturn(Mono.just("{\"session\":{\"id\":\"session-123\"},\"extension_results\":[{\"name\":\"developer\",\"success\":true}]}"));

        webClient.post().uri("/gateway/agents/test-agent/agent/start")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                // Should return the original start response (Session JSON), not the resume response
                .jsonPath("$.id").isEqualTo("session-123")
                .jsonPath("$.name").isEqualTo("New Chat")
                .jsonPath("$.extension_results").doesNotExist();
    }

    @Test
    public void startSession_unauthenticated_returns401() {
        webClient.post().uri("/gateway/agents/test-agent/agent/start")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue("{}")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== GET /sessions (Aggregated) ======================

    @Test
    public void listAllSessions_noInstances_returnsEmptyArray() {
        when(instanceManager.getAllInstances()).thenReturn(Collections.emptyList());

        webClient.get().uri("/gateway/sessions")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("{\"sessions\":[]}");
    }

    @Test
    public void listAllSessions_withRunningInstances_aggregatesSessions() {
        ManagedInstance userInstance = new ManagedInstance("agent-a", "alice", 8001, 111L, null, "test-secret");
        userInstance.setStatus(ManagedInstance.Status.RUNNING);
        ManagedInstance sysInstance = new ManagedInstance("agent-b", "admin", 8002, 222L, null, "test-secret");
        sysInstance.setStatus(ManagedInstance.Status.RUNNING);
        ManagedInstance otherUserInstance = new ManagedInstance("agent-a", "bob", 8003, 333L, null, "test-secret");
        otherUserInstance.setStatus(ManagedInstance.Status.RUNNING);

        when(instanceManager.getAllInstances())
                .thenReturn(List.of(userInstance, sysInstance, otherUserInstance));

        // Sessions returned for alice's instance and the system instance (not bob's)
        when(sessionService.getSessionsFromInstance(userInstance))
                .thenReturn(Mono.just("{\"sessions\":[{\"id\":\"s1\"}]}"));
        when(sessionService.getSessionsFromInstance(sysInstance))
                .thenReturn(Mono.just("{\"sessions\":[{\"id\":\"s2\"}]}"));

        webClient.get().uri("/gateway/sessions")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk();
    }

    @Test
    public void listAllSessions_stoppedInstancesExcluded() {
        ManagedInstance stoppedInstance = new ManagedInstance("agent-a", "alice", 8001, 111L, null, "test-secret");
        stoppedInstance.setStatus(ManagedInstance.Status.STOPPED);

        when(instanceManager.getAllInstances())
                .thenReturn(List.of(stoppedInstance));

        webClient.get().uri("/gateway/sessions")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class).isEqualTo("{\"sessions\":[]}");
    }

    @Test
    public void listAllSessions_unauthenticated_returns401() {
        webClient.get().uri("/gateway/sessions")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== GET /agents/{agentId}/sessions ======================

    @Test
    public void listAgentSessions_authenticated_proxiesToGoosed() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.proxy(any(), any(), eq(9999), eq("/sessions"), any()))
                .thenReturn(Mono.empty());

        webClient.get().uri("/gateway/agents/test-agent/sessions")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk();

        verify(goosedProxy).proxy(any(), any(), eq(9999), eq("/sessions"), any());
    }

    // ====================== GET /agents/{agentId}/sessions/{sessionId} ======================

    @Test
    public void getSession_authenticated_proxiesToGoosed() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.fetchJson(eq(9999), eq("/sessions/session-123"), anyString()))
                .thenReturn(Mono.just("{\"id\":\"session-123\",\"conversation\":[]}"));

        webClient.get().uri("/gateway/agents/test-agent/sessions/session-123")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.id").isEqualTo("session-123")
                .jsonPath("$.agentId").isEqualTo("test-agent");
    }

    @Test
    public void getSession_unauthenticated_returns401() {
        webClient.get().uri("/gateway/agents/test-agent/sessions/session-123")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ====================== DELETE /agents/{agentId}/sessions/{sessionId} ======================

    @Test
    public void deleteSession_authenticated_removesOwnerAndProxies() {
        when(instanceManager.getOrSpawn("test-agent", "alice"))
                .thenReturn(Mono.just(runningInstance));
        when(goosedProxy.proxy(any(), any(), eq(9999), eq("/sessions/session-456"), any()))
                .thenReturn(Mono.empty());

        webClient.delete().uri("/gateway/agents/test-agent/sessions/session-456")
                .header(HEADER_SECRET_KEY, SECRET_KEY)
                .header(HEADER_USER_ID, "alice")
                .exchange()
                .expectStatus().isOk();

        verify(goosedProxy).proxy(any(), any(), eq(9999), eq("/sessions/session-456"), any());
    }

    @Test
    public void deleteSession_unauthenticated_returns401() {
        webClient.delete().uri("/gateway/agents/test-agent/sessions/session-456")
                .exchange()
                .expectStatus().isUnauthorized();
    }
}

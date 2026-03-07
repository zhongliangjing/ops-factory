package com.huawei.opsfactory.gateway.e2e;

import com.huawei.opsfactory.gateway.hook.HookContext;
import com.huawei.opsfactory.gateway.hook.HookPipeline;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import com.huawei.opsfactory.gateway.proxy.GoosedProxy;
import com.huawei.opsfactory.gateway.proxy.SseRelayService;
import com.huawei.opsfactory.gateway.service.AgentConfigService;
import com.huawei.opsfactory.gateway.service.FileService;
import com.huawei.opsfactory.gateway.service.LangfuseService;
import com.huawei.opsfactory.gateway.service.SessionService;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.AutoConfigureWebTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * Base class for E2E tests. Loads the full Spring context with real filters
 * (AuthWebFilter, UserContextFilter) but mocks external-facing services.
 *
 * All subclasses share the same cached ApplicationContext because they
 * declare the identical set of @MockBean fields.
 */
@RunWith(SpringRunner.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWebTestClient
public abstract class BaseE2ETest {

    protected static final String SECRET_KEY = "test";
    protected static final String HEADER_SECRET_KEY = "x-secret-key";
    protected static final String HEADER_USER_ID = "x-user-id";

    @Autowired
    protected WebTestClient webClient;

    // Mock all services that interact with external resources
    @MockBean
    protected InstanceManager instanceManager;

    @MockBean
    protected AgentConfigService agentConfigService;

    @MockBean
    protected GoosedProxy goosedProxy;

    @MockBean
    protected SseRelayService sseRelayService;

    @MockBean
    protected SessionService sessionService;

    @MockBean
    protected LangfuseService langfuseService;

    @MockBean
    protected FileService fileService;

    @MockBean
    protected HookPipeline hookPipeline;
}

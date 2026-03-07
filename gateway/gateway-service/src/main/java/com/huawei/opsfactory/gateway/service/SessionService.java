package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.common.constants.GatewayConstants;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.process.InstanceManager;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class SessionService {

    private static final Logger log = LogManager.getLogger(SessionService.class);

    private final InstanceManager instanceManager;
    private final WebClient webClient;
    private final String secretKey;

    /** sessionId -> userId ownership cache */
    private final ConcurrentHashMap<String, String> ownerCache = new ConcurrentHashMap<>();

    public SessionService(InstanceManager instanceManager,
                          com.huawei.opsfactory.gateway.proxy.GoosedProxy goosedProxy) {
        this.instanceManager = instanceManager;
        this.webClient = goosedProxy.getWebClient();
        this.secretKey = goosedProxy.getSecretKey();
    }

    public void cacheOwner(String sessionId, String userId) {
        ownerCache.put(sessionId, userId);
    }

    public String getCachedOwner(String sessionId) {
        return ownerCache.get(sessionId);
    }

    public void removeOwner(String sessionId) {
        ownerCache.remove(sessionId);
    }

    /**
     * Query sessions from a specific goosed instance.
     */
    public Mono<String> getSessionsFromInstance(ManagedInstance instance) {
        String url = "http://127.0.0.1:" + instance.getPort() + "/sessions";
        return webClient.get()
                .uri(url)
                .header(GatewayConstants.HEADER_SECRET_KEY, secretKey)
                .retrieve()
                .bodyToMono(String.class)
                .onErrorReturn("[]");
    }
}

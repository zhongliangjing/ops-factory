package com.huawei.opsfactory.gateway.process;

import com.huawei.opsfactory.gateway.common.constants.GatewayConstants;
import com.huawei.opsfactory.gateway.common.model.ManagedInstance;
import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class IdleReaper {

    private static final Logger log = LogManager.getLogger(IdleReaper.class);

    private final InstanceManager instanceManager;
    private final GatewayProperties properties;

    public IdleReaper(InstanceManager instanceManager, GatewayProperties properties) {
        this.instanceManager = instanceManager;
        this.properties = properties;
    }

    @Scheduled(fixedDelayString = "${gateway.idle.check-interval-ms:60000}")
    public void reapIdleInstances() {
        long maxIdleMs = properties.getIdle().getTimeoutMinutes() * 60_000L;
        long now = System.currentTimeMillis();

        for (ManagedInstance instance : instanceManager.getAllInstances()) {
            // Never reap sys instances
            if (GatewayConstants.SYS_USER.equals(instance.getUserId())) {
                continue;
            }
            if (instance.getStatus() == ManagedInstance.Status.RUNNING
                    && now - instance.getLastActivity() > maxIdleMs) {
                log.info("Reaping idle instance {}:{} (idle {}s)",
                        instance.getAgentId(), instance.getUserId(),
                        (now - instance.getLastActivity()) / 1000);
                instanceManager.stopInstance(instance);
            }
        }
    }
}

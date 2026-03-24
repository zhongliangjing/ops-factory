package com.huawei.opsfactory.knowledge.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final KnowledgeProperties properties;

    public WebConfig(KnowledgeProperties properties) {
        this.properties = properties;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        String corsOrigin = properties.getCorsOrigin();
        if (StringUtils.hasText(corsOrigin)) {
            String[] origins = StringUtils.commaDelimitedListToStringArray(corsOrigin);
            registry.addMapping("/**")
                    .allowedOriginPatterns(origins)
                    .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                    .allowedHeaders("*")
                    .allowCredentials(true)
                    .maxAge(3600);
        }
    }
}

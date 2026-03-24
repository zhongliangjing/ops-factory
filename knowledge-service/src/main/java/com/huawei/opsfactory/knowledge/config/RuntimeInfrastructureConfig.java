package com.huawei.opsfactory.knowledge.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.sql.DataSource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

@Configuration
@EnableConfigurationProperties(KnowledgeRuntimeProperties.class)
public class RuntimeInfrastructureConfig {

    @Bean
    public DataSource dataSource(KnowledgeRuntimeProperties runtimeProperties) throws IOException {
        Path baseDir = Path.of(runtimeProperties.getBaseDir()).toAbsolutePath().normalize();
        Files.createDirectories(baseDir);
        Files.createDirectories(baseDir.resolve("meta"));
        Files.createDirectories(baseDir.resolve("upload"));
        Files.createDirectories(baseDir.resolve("artifacts"));
        Files.createDirectories(baseDir.resolve("indexes"));

        DriverManagerDataSource dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("org.sqlite.JDBC");
        dataSource.setUrl("jdbc:sqlite:" + baseDir.resolve("meta").resolve("knowledge.db"));
        return dataSource;
    }

    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Bean
    public SchemaInitializer schemaInitializer(DataSource dataSource) {
        ResourceDatabasePopulator populator =
            new ResourceDatabasePopulator(false, false, "UTF-8", new ClassPathResource("db/schema-sqlite.sql"));
        return new SchemaInitializer(dataSource, populator);
    }

    public static final class SchemaInitializer {
        public SchemaInitializer(DataSource dataSource, ResourceDatabasePopulator populator) {
            populator.execute(dataSource);
        }
    }
}

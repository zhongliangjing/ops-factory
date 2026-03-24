package com.huawei.opsfactory.knowledge.schema;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class SqliteSchemaResourceTest {

    @Test
    void shouldShipSqliteSchemaForRuntimeBootstrap() throws IOException {
        ClassPathResource resource = new ClassPathResource("db/schema-sqlite.sql");

        assertThat(resource.exists()).isTrue();

        String sql = resource.getContentAsString(StandardCharsets.UTF_8);

        assertThat(sql).contains("CREATE TABLE IF NOT EXISTS knowledge_source");
        assertThat(sql).contains("CREATE TABLE IF NOT EXISTS knowledge_document");
        assertThat(sql).contains("CREATE TABLE IF NOT EXISTS document_chunk");
        assertThat(sql).contains("CREATE TABLE IF NOT EXISTS ingestion_job");
    }
}

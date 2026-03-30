package com.huawei.opsfactory.knowledge.schema;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class FlywayMigrationResourceTest {

    @Test
    void shouldShipFlywayMigrationScriptsForRuntimeBootstrap() throws IOException {
        ClassPathResource initScript = new ClassPathResource("db/migration/common/V1__init.sql");

        assertThat(initScript.exists()).isTrue();

        String sql = initScript.getContentAsString(StandardCharsets.UTF_8);

        assertThat(sql).contains("CREATE TABLE IF NOT EXISTS knowledge_source");
        assertThat(sql).contains("CREATE TABLE IF NOT EXISTS knowledge_document");
        assertThat(sql).contains("CREATE TABLE IF NOT EXISTS document_chunk");
        assertThat(sql).contains("CREATE TABLE IF NOT EXISTS ingestion_job");
    }

    @Test
    void shouldShipAllJavaMigrationClassesOnClasspath() {
        assertThat(classExists("db.migration.common.V2__add_source_runtime_columns")).isTrue();
        assertThat(classExists("db.migration.common.V3__add_job_progress_columns")).isTrue();
        assertThat(classExists("db.migration.common.V4__drop_legacy_embedding_record")).isTrue();
    }

    private boolean classExists(String className) {
        try {
            Class.forName(className);
            return true;
        } catch (ClassNotFoundException e) {
            return false;
        }
    }
}

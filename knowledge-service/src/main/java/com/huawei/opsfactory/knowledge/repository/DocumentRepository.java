package com.huawei.opsfactory.knowledge.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.knowledge.common.util.Jsons;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class DocumentRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final RowMapper<DocumentRecord> mapper = this::map;

    public DocumentRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public void insert(DocumentRecord record) {
        jdbcTemplate.update(
            "insert into knowledge_document (id, source_id, name, original_filename, title, description, tags_json, sha256, content_type, language, status, index_status, file_size_bytes, chunk_count, user_edited_chunk_count, error_message, updated_by, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            record.id(), record.sourceId(), record.name(), record.originalFilename(), record.title(), record.description(),
            Jsons.write(objectMapper, record.tags()), record.sha256(), record.contentType(), record.language(), record.status(),
            record.indexStatus(), record.fileSizeBytes(), record.chunkCount(), record.userEditedChunkCount(),
            record.errorMessage(), record.updatedBy(), record.createdAt().toString(), record.updatedAt().toString()
        );
    }

    public List<DocumentRecord> findAll() {
        return jdbcTemplate.query("select * from knowledge_document order by created_at desc", mapper);
    }

    public List<DocumentRecord> findBySourceId(String sourceId) {
        return jdbcTemplate.query("select * from knowledge_document where source_id = ? order by created_at desc", mapper, sourceId);
    }

    public Optional<DocumentRecord> findById(String id) {
        return jdbcTemplate.query("select * from knowledge_document where id = ?", mapper, id).stream().findFirst();
    }

    public Optional<DocumentRecord> findBySourceIdAndSha256(String sourceId, String sha256) {
        return jdbcTemplate.query(
            "select * from knowledge_document where source_id = ? and sha256 = ?",
            mapper,
            sourceId,
            sha256
        ).stream().findFirst();
    }

    public void update(DocumentRecord record) {
        jdbcTemplate.update(
            "update knowledge_document set title=?, description=?, tags_json=?, content_type=?, language=?, status=?, index_status=?, file_size_bytes=?, chunk_count=?, user_edited_chunk_count=?, error_message=?, updated_by=?, updated_at=? where id=?",
            record.title(), record.description(), Jsons.write(objectMapper, record.tags()), record.contentType(), record.language(),
            record.status(), record.indexStatus(), record.fileSizeBytes(), record.chunkCount(), record.userEditedChunkCount(),
            record.errorMessage(), record.updatedBy(), record.updatedAt().toString(), record.id()
        );
    }

    public void delete(String id) {
        jdbcTemplate.update("delete from knowledge_document where id = ?", id);
    }

    public void deleteBySourceId(String sourceId) {
        jdbcTemplate.update("delete from knowledge_document where source_id = ?", sourceId);
    }

    public long count() {
        return jdbcTemplate.queryForObject("select count(*) from knowledge_document", Long.class);
    }

    public long countByStatus(String status) {
        return jdbcTemplate.queryForObject("select count(*) from knowledge_document where status = ?", Long.class, status);
    }

    private DocumentRecord map(ResultSet rs, int rowNum) throws SQLException {
        return new DocumentRecord(
            rs.getString("id"),
            rs.getString("source_id"),
            rs.getString("name"),
            rs.getString("original_filename"),
            rs.getString("title"),
            rs.getString("description"),
            Jsons.readStringList(objectMapper, rs.getString("tags_json")),
            rs.getString("sha256"),
            rs.getString("content_type"),
            rs.getString("language"),
            rs.getString("status"),
            rs.getString("index_status"),
            rs.getLong("file_size_bytes"),
            rs.getInt("chunk_count"),
            rs.getInt("user_edited_chunk_count"),
            rs.getString("error_message"),
            rs.getString("updated_by"),
            Instant.parse(rs.getString("created_at")),
            Instant.parse(rs.getString("updated_at"))
        );
    }

    public record DocumentRecord(
        String id,
        String sourceId,
        String name,
        String originalFilename,
        String title,
        String description,
        List<String> tags,
        String sha256,
        String contentType,
        String language,
        String status,
        String indexStatus,
        long fileSizeBytes,
        int chunkCount,
        int userEditedChunkCount,
        String errorMessage,
        String updatedBy,
        Instant createdAt,
        Instant updatedAt
    ) {
    }
}

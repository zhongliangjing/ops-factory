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
public class ChunkRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final RowMapper<ChunkRecord> mapper = this::map;

    public ChunkRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public void insert(ChunkRecord record) {
        jdbcTemplate.update(
            "insert into document_chunk (id, document_id, source_id, ordinal, title, title_path_json, keywords_json, text, markdown, page_from, page_to, token_count, text_length, content_hash, edit_status, updated_by, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            record.id(), record.documentId(), record.sourceId(), record.ordinal(), record.title(),
            Jsons.write(objectMapper, record.titlePath()), Jsons.write(objectMapper, record.keywords()),
            record.text(), record.markdown(), record.pageFrom(), record.pageTo(), record.tokenCount(), record.textLength(),
            record.contentHash(), record.editStatus(), record.updatedBy(), record.createdAt().toString(), record.updatedAt().toString()
        );
    }

    public List<ChunkRecord> findAll() {
        return jdbcTemplate.query("select * from document_chunk order by updated_at desc", mapper);
    }

    public List<ChunkRecord> findByDocumentId(String documentId) {
        return jdbcTemplate.query("select * from document_chunk where document_id = ? order by ordinal asc", mapper, documentId);
    }

    public List<ChunkRecord> findBySourceId(String sourceId) {
        return jdbcTemplate.query("select * from document_chunk where source_id = ? order by updated_at desc", mapper, sourceId);
    }

    public Optional<ChunkRecord> findById(String id) {
        return jdbcTemplate.query("select * from document_chunk where id = ?", mapper, id).stream().findFirst();
    }

    public void update(ChunkRecord record) {
        jdbcTemplate.update(
            "update document_chunk set ordinal=?, title=?, title_path_json=?, keywords_json=?, text=?, markdown=?, page_from=?, page_to=?, token_count=?, text_length=?, content_hash=?, edit_status=?, updated_by=?, updated_at=? where id=?",
            record.ordinal(), record.title(), Jsons.write(objectMapper, record.titlePath()), Jsons.write(objectMapper, record.keywords()),
            record.text(), record.markdown(), record.pageFrom(), record.pageTo(), record.tokenCount(), record.textLength(),
            record.contentHash(), record.editStatus(), record.updatedBy(), record.updatedAt().toString(), record.id()
        );
    }

    public void delete(String id) {
        jdbcTemplate.update("delete from document_chunk where id = ?", id);
    }

    public void deleteByDocumentId(String documentId) {
        jdbcTemplate.update("delete from document_chunk where document_id = ?", documentId);
    }

    public void deleteBySourceId(String sourceId) {
        jdbcTemplate.update("delete from document_chunk where source_id = ?", sourceId);
    }

    public long count() {
        return jdbcTemplate.queryForObject("select count(*) from document_chunk", Long.class);
    }

    public long countBySourceId(String sourceId) {
        return jdbcTemplate.queryForObject("select count(*) from document_chunk where source_id = ?", Long.class, sourceId);
    }

    public long countUserEdited() {
        return jdbcTemplate.queryForObject("select count(*) from document_chunk where edit_status = 'USER_EDITED'", Long.class);
    }

    public long countUserEditedBySourceId(String sourceId) {
        return jdbcTemplate.queryForObject("select count(*) from document_chunk where source_id = ? and edit_status = 'USER_EDITED'", Long.class, sourceId);
    }

    private ChunkRecord map(ResultSet rs, int rowNum) throws SQLException {
        return new ChunkRecord(
            rs.getString("id"),
            rs.getString("document_id"),
            rs.getString("source_id"),
            rs.getInt("ordinal"),
            rs.getString("title"),
            Jsons.readStringList(objectMapper, rs.getString("title_path_json")),
            Jsons.readStringList(objectMapper, rs.getString("keywords_json")),
            rs.getString("text"),
            rs.getString("markdown"),
            (Integer) rs.getObject("page_from"),
            (Integer) rs.getObject("page_to"),
            rs.getInt("token_count"),
            rs.getInt("text_length"),
            rs.getString("content_hash"),
            rs.getString("edit_status"),
            rs.getString("updated_by"),
            Instant.parse(rs.getString("created_at")),
            Instant.parse(rs.getString("updated_at"))
        );
    }

    public record ChunkRecord(
        String id,
        String documentId,
        String sourceId,
        int ordinal,
        String title,
        List<String> titlePath,
        List<String> keywords,
        String text,
        String markdown,
        Integer pageFrom,
        Integer pageTo,
        int tokenCount,
        int textLength,
        String contentHash,
        String editStatus,
        String updatedBy,
        Instant createdAt,
        Instant updatedAt
    ) {
    }
}

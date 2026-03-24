package com.huawei.opsfactory.knowledge.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class BindingRepository {

    private final JdbcTemplate jdbcTemplate;
    private final RowMapper<BindingRecord> mapper = this::map;

    public BindingRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void upsert(BindingRecord record) {
        int updated = jdbcTemplate.update(
            "update source_profile_binding set index_profile_id=?, retrieval_profile_id=?, updated_at=? where source_id=?",
            record.indexProfileId(), record.retrievalProfileId(), record.updatedAt().toString(), record.sourceId()
        );
        if (updated == 0) {
            jdbcTemplate.update(
                "insert into source_profile_binding (id, source_id, index_profile_id, retrieval_profile_id, created_at, updated_at) values (?,?,?,?,?,?)",
                record.id(), record.sourceId(), record.indexProfileId(), record.retrievalProfileId(),
                record.createdAt().toString(), record.updatedAt().toString()
            );
        }
    }

    public List<BindingRecord> findAll() {
        return jdbcTemplate.query("select * from source_profile_binding order by updated_at desc", mapper);
    }

    public Optional<BindingRecord> findBySourceId(String sourceId) {
        return jdbcTemplate.query("select * from source_profile_binding where source_id = ?", mapper, sourceId).stream().findFirst();
    }

    public void deleteBySourceId(String sourceId) {
        jdbcTemplate.update("delete from source_profile_binding where source_id = ?", sourceId);
    }

    private BindingRecord map(ResultSet rs, int rowNum) throws SQLException {
        return new BindingRecord(
            rs.getString("id"),
            rs.getString("source_id"),
            rs.getString("index_profile_id"),
            rs.getString("retrieval_profile_id"),
            Instant.parse(rs.getString("created_at")),
            Instant.parse(rs.getString("updated_at"))
        );
    }

    public record BindingRecord(
        String id,
        String sourceId,
        String indexProfileId,
        String retrievalProfileId,
        Instant createdAt,
        Instant updatedAt
    ) {
    }
}

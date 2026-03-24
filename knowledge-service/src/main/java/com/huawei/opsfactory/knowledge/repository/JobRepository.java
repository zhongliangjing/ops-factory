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
public class JobRepository {

    private final JdbcTemplate jdbcTemplate;
    private final RowMapper<JobRecord> mapper = this::map;

    public JobRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void insert(JobRecord record) {
        jdbcTemplate.update(
            "insert into ingestion_job (id, job_type, source_id, document_id, status, progress, message, started_at, finished_at, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?)",
            record.id(), record.jobType(), record.sourceId(), record.documentId(), record.status(), record.progress(),
            record.message(), stringify(record.startedAt()), stringify(record.finishedAt()), record.createdAt().toString(), record.updatedAt().toString()
        );
    }

    public void update(JobRecord record) {
        jdbcTemplate.update(
            "update ingestion_job set status=?, progress=?, message=?, started_at=?, finished_at=?, updated_at=? where id=?",
            record.status(), record.progress(), record.message(), stringify(record.startedAt()), stringify(record.finishedAt()),
            record.updatedAt().toString(), record.id()
        );
    }

    public List<JobRecord> findAll() {
        return jdbcTemplate.query("select * from ingestion_job order by created_at desc", mapper);
    }

    public Optional<JobRecord> findById(String id) {
        return jdbcTemplate.query("select * from ingestion_job where id = ?", mapper, id).stream().findFirst();
    }

    public void deleteBySourceId(String sourceId) {
        jdbcTemplate.update("delete from ingestion_job where source_id = ?", sourceId);
    }

    public long countRunning() {
        return jdbcTemplate.queryForObject("select count(*) from ingestion_job where status = 'RUNNING'", Long.class);
    }

    private String stringify(Instant instant) {
        return instant == null ? null : instant.toString();
    }

    private JobRecord map(ResultSet rs, int rowNum) throws SQLException {
        return new JobRecord(
            rs.getString("id"),
            rs.getString("job_type"),
            rs.getString("source_id"),
            rs.getString("document_id"),
            rs.getString("status"),
            rs.getInt("progress"),
            rs.getString("message"),
            parse(rs.getString("started_at")),
            parse(rs.getString("finished_at")),
            Instant.parse(rs.getString("created_at")),
            Instant.parse(rs.getString("updated_at"))
        );
    }

    private Instant parse(String value) {
        return value == null ? null : Instant.parse(value);
    }

    public record JobRecord(
        String id,
        String jobType,
        String sourceId,
        String documentId,
        String status,
        int progress,
        String message,
        Instant startedAt,
        Instant finishedAt,
        Instant createdAt,
        Instant updatedAt
    ) {
    }
}

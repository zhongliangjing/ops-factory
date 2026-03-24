CREATE TABLE IF NOT EXISTS knowledge_source (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    storage_mode TEXT NOT NULL,
    index_profile_id TEXT,
    retrieval_profile_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_document (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    name TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    title TEXT,
    description TEXT,
    tags_json TEXT,
    sha256 TEXT NOT NULL,
    content_type TEXT,
    language TEXT,
    status TEXT NOT NULL,
    index_status TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    user_edited_chunk_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES knowledge_source(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_document_source_sha256
ON knowledge_document(source_id, sha256);

CREATE INDEX IF NOT EXISTS idx_document_source_id
ON knowledge_document(source_id);

CREATE TABLE IF NOT EXISTS document_chunk (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    title TEXT,
    title_path_json TEXT,
    keywords_json TEXT,
    text TEXT NOT NULL,
    markdown TEXT,
    page_from INTEGER,
    page_to INTEGER,
    token_count INTEGER NOT NULL,
    text_length INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    edit_status TEXT NOT NULL,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES knowledge_document(id),
    FOREIGN KEY (source_id) REFERENCES knowledge_source(id)
);

CREATE INDEX IF NOT EXISTS idx_chunk_document_id
ON document_chunk(document_id);

CREATE INDEX IF NOT EXISTS idx_chunk_source_id
ON document_chunk(source_id);

CREATE TABLE IF NOT EXISTS index_profile (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retrieval_profile (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_profile_binding (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL UNIQUE,
    index_profile_id TEXT NOT NULL,
    retrieval_profile_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES knowledge_source(id),
    FOREIGN KEY (index_profile_id) REFERENCES index_profile(id),
    FOREIGN KEY (retrieval_profile_id) REFERENCES retrieval_profile(id)
);

CREATE TABLE IF NOT EXISTS ingestion_job (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    source_id TEXT,
    document_id TEXT,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL,
    message TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES knowledge_source(id),
    FOREIGN KEY (document_id) REFERENCES knowledge_document(id)
);

CREATE INDEX IF NOT EXISTS idx_job_status
ON ingestion_job(status);

CREATE TABLE IF NOT EXISTS embedding_record (
    id TEXT PRIMARY KEY,
    chunk_id TEXT NOT NULL UNIQUE,
    model TEXT NOT NULL,
    dimension INTEGER NOT NULL,
    vector_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (chunk_id) REFERENCES document_chunk(id)
);

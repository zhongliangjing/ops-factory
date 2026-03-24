package com.huawei.opsfactory.knowledge.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.huawei.opsfactory.knowledge.api.chunk.ChunkController;
import com.huawei.opsfactory.knowledge.api.document.DocumentController;
import com.huawei.opsfactory.knowledge.api.job.JobController;
import com.huawei.opsfactory.knowledge.api.profile.ProfileController;
import com.huawei.opsfactory.knowledge.api.retrieval.RetrievalController;
import com.huawei.opsfactory.knowledge.api.source.SourceController;
import com.huawei.opsfactory.knowledge.common.model.PageResponse;
import com.huawei.opsfactory.knowledge.common.util.Ids;
import com.huawei.opsfactory.knowledge.repository.BindingRepository;
import com.huawei.opsfactory.knowledge.repository.ChunkRepository;
import com.huawei.opsfactory.knowledge.repository.DocumentRepository;
import com.huawei.opsfactory.knowledge.repository.JobRepository;
import com.huawei.opsfactory.knowledge.repository.ProfileRepository;
import com.huawei.opsfactory.knowledge.repository.SourceRepository;
import java.io.InputStream;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

@Service
public class KnowledgeServiceFacade {

    private final SourceRepository sourceRepository;
    private final DocumentRepository documentRepository;
    private final ChunkRepository chunkRepository;
    private final JobRepository jobRepository;
    private final ProfileRepository profileRepository;
    private final BindingRepository bindingRepository;
    private final StorageManager storageManager;
    private final TikaConversionService conversionService;
    private final ChunkingService chunkingService;
    private final SearchService searchService;
    private final ProfileBootstrapService profileBootstrapService;
    private final ObjectMapper objectMapper;

    public KnowledgeServiceFacade(
        SourceRepository sourceRepository,
        DocumentRepository documentRepository,
        ChunkRepository chunkRepository,
        JobRepository jobRepository,
        ProfileRepository profileRepository,
        BindingRepository bindingRepository,
        StorageManager storageManager,
        TikaConversionService conversionService,
        ChunkingService chunkingService,
        SearchService searchService,
        ProfileBootstrapService profileBootstrapService,
        ObjectMapper objectMapper
    ) {
        this.sourceRepository = sourceRepository;
        this.documentRepository = documentRepository;
        this.chunkRepository = chunkRepository;
        this.jobRepository = jobRepository;
        this.profileRepository = profileRepository;
        this.bindingRepository = bindingRepository;
        this.storageManager = storageManager;
        this.conversionService = conversionService;
        this.chunkingService = chunkingService;
        this.searchService = searchService;
        this.profileBootstrapService = profileBootstrapService;
        this.objectMapper = objectMapper;
    }

    public PageResponse<SourceController.SourceResponse> listSources(int page, int pageSize) {
        List<SourceController.SourceResponse> items = sourceRepository.findAll().stream().map(this::toSourceResponse).toList();
        return page(items, page, pageSize);
    }

    public SourceController.SourceResponse createSource(SourceController.CreateSourceRequest request) {
        Instant now = Instant.now();
        String id = Ids.newId("src");
        String indexProfileId = request.indexProfileId() != null ? request.indexProfileId() : profileBootstrapService.defaultIndexProfileId();
        String retrievalProfileId = request.retrievalProfileId() != null ? request.retrievalProfileId() : profileBootstrapService.defaultRetrievalProfileId();
        validateIndexProfileExists(indexProfileId);
        validateRetrievalProfileExists(retrievalProfileId);
        SourceRepository.SourceRecord record = new SourceRepository.SourceRecord(
            id, request.name(), request.description(), "ACTIVE", "MANAGED", indexProfileId, retrievalProfileId, now, now
        );
        sourceRepository.insert(record);
        bindingRepository.upsert(new BindingRepository.BindingRecord(Ids.newId("spb"), id, indexProfileId, retrievalProfileId, now, now));
        return toSourceResponse(record);
    }

    public SourceController.SourceResponse getSource(String sourceId) {
        return sourceRepository.findById(sourceId).map(this::toSourceResponse)
            .orElseThrow(() -> new IllegalArgumentException("Source not found: " + sourceId));
    }

    public SourceController.SourceResponse updateSource(String sourceId, SourceController.UpdateSourceRequest request) {
        SourceRepository.SourceRecord existing = sourceRepository.findById(sourceId)
            .orElseThrow(() -> new IllegalArgumentException("Source not found: " + sourceId));
        Instant now = Instant.now();
        String indexProfileId = request.indexProfileId() != null ? request.indexProfileId() : existing.indexProfileId();
        String retrievalProfileId = request.retrievalProfileId() != null ? request.retrievalProfileId() : existing.retrievalProfileId();
        validateIndexProfileExists(indexProfileId);
        validateRetrievalProfileExists(retrievalProfileId);
        SourceRepository.SourceRecord updated = new SourceRepository.SourceRecord(
            sourceId,
            request.name() != null ? request.name() : existing.name(),
            request.description() != null ? request.description() : existing.description(),
            request.status() != null ? request.status() : existing.status(),
            existing.storageMode(),
            indexProfileId,
            retrievalProfileId,
            existing.createdAt(),
            now
        );
        sourceRepository.update(updated);
        bindingRepository.upsert(new BindingRepository.BindingRecord(
            Ids.newId("spb"), sourceId, updated.indexProfileId(), updated.retrievalProfileId(), existing.createdAt(), now
        ));
        return toSourceResponse(updated);
    }

    public SourceController.DeleteSourceResponse deleteSource(String sourceId) {
        SourceRepository.SourceRecord source = sourceRepository.findById(sourceId)
            .orElseThrow(() -> new IllegalArgumentException("Source not found: " + sourceId));
        List<DocumentRepository.DocumentRecord> documents = documentRepository.findBySourceId(sourceId);
        for (DocumentRepository.DocumentRecord document : documents) {
            storageManager.deleteRecursively(storageManager.artifactDir(sourceId, document.id()));
            storageManager.deleteRecursively(storageManager.uploadDocumentDir(sourceId, document.id()));
        }
        chunkRepository.deleteBySourceId(sourceId);
        documentRepository.deleteBySourceId(sourceId);
        jobRepository.deleteBySourceId(sourceId);
        bindingRepository.deleteBySourceId(sourceId);
        sourceRepository.delete(source.id());
        storageManager.deleteRecursively(storageManager.artifactSourceDir(sourceId));
        storageManager.deleteRecursively(storageManager.uploadSourceDir(sourceId));
        return new SourceController.DeleteSourceResponse(sourceId, true);
    }

    public SourceController.SourceStatsResponse sourceStats(String sourceId) {
        long documentCount = documentRepository.findBySourceId(sourceId).size();
        long indexedCount = documentRepository.findBySourceId(sourceId).stream().filter(d -> "INDEXED".equals(d.status())).count();
        long failedCount = documentRepository.findBySourceId(sourceId).stream().filter(d -> "ERROR".equals(d.status())).count();
        long processingCount = documentRepository.findBySourceId(sourceId).stream().filter(d -> "PROCESSING".equals(d.status())).count();
        long chunkCount = chunkRepository.countBySourceId(sourceId);
        long userEditedCount = chunkRepository.countUserEditedBySourceId(sourceId);
        Instant lastIngestion = jobRepository.findAll().stream()
            .filter(j -> sourceId.equals(j.sourceId()) && "SUCCEEDED".equals(j.status()))
            .map(JobRepository.JobRecord::updatedAt)
            .max(Comparator.naturalOrder())
            .orElse(null);
        return new SourceController.SourceStatsResponse(
            sourceId, (int) documentCount, (int) indexedCount, (int) failedCount, (int) processingCount,
            (int) chunkCount, (int) userEditedCount, lastIngestion
        );
    }

    public PageResponse<DocumentController.DocumentSummary> listDocuments(int page, int pageSize, String sourceId) {
        List<DocumentRepository.DocumentRecord> docs = sourceId == null ? documentRepository.findAll() : documentRepository.findBySourceId(sourceId);
        List<DocumentController.DocumentSummary> items = docs.stream().map(this::toDocumentSummary).toList();
        return page(items, page, pageSize);
    }

    public DocumentController.IngestDocumentsResponse ingest(String sourceId, MultipartFile[] files) {
        sourceRepository.findById(sourceId).orElseThrow(() -> new IllegalArgumentException("Source not found: " + sourceId));
        Instant now = Instant.now();
        JobRepository.JobRecord job = new JobRepository.JobRecord(Ids.newId("job"), "INGEST", sourceId, null, "RUNNING", 0, "Ingest started", now, null, now, now);
        jobRepository.insert(job);
        int imported = 0;
        try {
            for (MultipartFile file : files) {
                if (file.isEmpty() || !StringUtils.hasText(file.getOriginalFilename())) {
                    continue;
                }
                if (processUpload(sourceId, file)) {
                    imported++;
                }
            }
            JobRepository.JobRecord finished = new JobRepository.JobRecord(job.id(), job.jobType(), sourceId, null, "SUCCEEDED", 100, "Ingest completed", now, Instant.now(), job.createdAt(), Instant.now());
            jobRepository.update(finished);
            return new DocumentController.IngestDocumentsResponse(job.id(), sourceId, "SUCCEEDED", imported);
        } catch (RuntimeException ex) {
            JobRepository.JobRecord failed = new JobRepository.JobRecord(job.id(), job.jobType(), sourceId, null, "FAILED", imported == 0 ? 0 : 100, ex.getMessage(), now, Instant.now(), job.createdAt(), Instant.now());
            jobRepository.update(failed);
            throw ex;
        }
    }

    public DocumentController.DocumentDetail getDocument(String documentId) {
        return documentRepository.findById(documentId).map(this::toDocumentDetail)
            .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
    }

    public DocumentController.DocumentUpdateResponse updateDocument(String documentId, DocumentController.UpdateDocumentRequest request) {
        DocumentRepository.DocumentRecord existing = documentRepository.findById(documentId)
            .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
        DocumentRepository.DocumentRecord updated = new DocumentRepository.DocumentRecord(
            existing.id(), existing.sourceId(), existing.name(), existing.originalFilename(),
            request.title() != null ? request.title() : existing.title(),
            request.description() != null ? request.description() : existing.description(),
            request.tags() != null ? request.tags() : existing.tags(),
            existing.sha256(), existing.contentType(), existing.language(), existing.status(), existing.indexStatus(),
            existing.fileSizeBytes(), existing.chunkCount(), existing.userEditedChunkCount(), existing.errorMessage(),
            "system", existing.createdAt(), Instant.now()
        );
        documentRepository.update(updated);
        return new DocumentController.DocumentUpdateResponse(documentId, true, updated.updatedAt());
    }

    public DocumentController.DeleteDocumentResponse deleteDocument(String documentId) {
        DocumentRepository.DocumentRecord existing = documentRepository.findById(documentId)
            .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
        chunkRepository.deleteByDocumentId(documentId);
        documentRepository.delete(documentId);
        storageManager.deleteRecursively(storageManager.artifactDir(existing.sourceId(), existing.id()));
        storageManager.deleteRecursively(storageManager.uploadDocumentDir(existing.sourceId(), existing.id()));
        return new DocumentController.DeleteDocumentResponse(documentId, true);
    }

    public PageResponse<ChunkController.ChunkSummary> listDocumentChunks(String documentId, int page, int pageSize) {
        List<ChunkController.ChunkSummary> items = chunkRepository.findByDocumentId(documentId).stream().map(this::toChunkSummary).toList();
        return page(items, page, pageSize);
    }

    public DocumentController.DocumentPreviewResponse previewDocument(String documentId) {
        DocumentRepository.DocumentRecord document = documentRepository.findById(documentId)
            .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
        Path artifactDir = storageManager.artifactDir(document.sourceId(), document.id());
        return new DocumentController.DocumentPreviewResponse(
            documentId,
            document.title(),
            storageManager.readString(artifactDir.resolve("content.md")),
            storageManager.readString(artifactDir.resolve("content.txt"))
        );
    }

    public DocumentController.DocumentArtifactsResponse getArtifacts(String documentId) {
        DocumentRepository.DocumentRecord document = documentRepository.findById(documentId)
            .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
        Path artifactDir = storageManager.artifactDir(document.sourceId(), document.id());
        return new DocumentController.DocumentArtifactsResponse(
            documentId,
            java.nio.file.Files.exists(artifactDir.resolve("content.md")),
            java.nio.file.Files.exists(artifactDir.resolve("content.txt")),
            false
        );
    }

    public String readArtifact(String documentId, String name) {
        DocumentRepository.DocumentRecord document = documentRepository.findById(documentId)
            .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
        return storageManager.readString(storageManager.artifactDir(document.sourceId(), document.id()).resolve(name));
    }

    public DocumentController.JobCreationResponse simpleDocumentJob(String documentId, String jobType) {
        Instant now = Instant.now();
        JobRepository.JobRecord job = new JobRepository.JobRecord(Ids.newId("job"), jobType, null, documentId, "SUCCEEDED", 100, jobType + " completed", now, now, now, now);
        jobRepository.insert(job);
        return new DocumentController.JobCreationResponse(job.id(), documentId, jobType, job.status());
    }

    public DocumentController.DocumentStatsResponse documentStats(String documentId) {
        DocumentRepository.DocumentRecord document = documentRepository.findById(documentId)
            .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
        Instant lastIndexed = jobRepository.findAll().stream()
            .filter(j -> documentId.equals(j.documentId()) && "SUCCEEDED".equals(j.status()))
            .map(JobRepository.JobRecord::updatedAt)
            .max(Comparator.naturalOrder())
            .orElse(document.updatedAt());
        return new DocumentController.DocumentStatsResponse(
            documentId, document.chunkCount(), document.userEditedChunkCount(), lastIndexed, document.status(), document.indexStatus()
        );
    }

    public PageResponse<ChunkController.ChunkSummary> listChunks(int page, int pageSize, String sourceId, String documentId) {
        List<ChunkRepository.ChunkRecord> chunks;
        if (documentId != null) {
            chunks = chunkRepository.findByDocumentId(documentId);
        } else if (sourceId != null) {
            chunks = chunkRepository.findBySourceId(sourceId);
        } else {
            chunks = chunkRepository.findAll();
        }
        List<ChunkController.ChunkSummary> items = chunks.stream().map(this::toChunkSummary).toList();
        return page(items, page, pageSize);
    }

    public ChunkController.ChunkDetail getChunk(String chunkId) {
        return chunkRepository.findById(chunkId).map(this::toChunkDetail)
            .orElseThrow(() -> new IllegalArgumentException("Chunk not found: " + chunkId));
    }

    public ChunkController.ChunkMutationResponse createChunk(String documentId, ChunkController.CreateChunkRequest request) {
        DocumentRepository.DocumentRecord document = documentRepository.findById(documentId)
            .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
        ChunkRepository.ChunkRecord record = new ChunkRepository.ChunkRecord(
            Ids.newId("chk"), documentId, document.sourceId(), request.ordinal(), request.title(), request.titlePath(),
            request.keywords(), request.text(), request.markdown(), request.pageFrom(), request.pageTo(),
            com.huawei.opsfactory.knowledge.common.util.TokenEstimator.estimate(request.text()),
            request.text() == null ? 0 : request.text().length(),
            hash(request.text() + request.markdown()), "USER_EDITED", "system", Instant.now(), Instant.now()
        );
        chunkRepository.insert(record);
        refreshDocumentChunkStats(documentId);
        return new ChunkController.ChunkMutationResponse(record.id(), documentId, true, true, record.editStatus(), record.updatedAt());
    }

    public ChunkController.ChunkMutationResponse updateChunk(String chunkId, ChunkController.UpdateChunkRequest request) {
        ChunkRepository.ChunkRecord existing = chunkRepository.findById(chunkId)
            .orElseThrow(() -> new IllegalArgumentException("Chunk not found: " + chunkId));
        String text = request.text() != null ? request.text() : existing.text();
        String markdown = request.markdown() != null ? request.markdown() : existing.markdown();
        ChunkRepository.ChunkRecord updated = new ChunkRepository.ChunkRecord(
            existing.id(), existing.documentId(), existing.sourceId(), existing.ordinal(),
            request.title() != null ? request.title() : existing.title(),
            request.titlePath() != null ? request.titlePath() : existing.titlePath(),
            request.keywords() != null ? request.keywords() : existing.keywords(),
            text,
            markdown,
            request.pageFrom() != null ? request.pageFrom() : existing.pageFrom(),
            request.pageTo() != null ? request.pageTo() : existing.pageTo(),
            com.huawei.opsfactory.knowledge.common.util.TokenEstimator.estimate(text),
            text == null ? 0 : text.length(),
            hash(text + markdown),
            "USER_EDITED",
            "system",
            existing.createdAt(),
            Instant.now()
        );
        chunkRepository.update(updated);
        refreshDocumentChunkStats(existing.documentId());
        return new ChunkController.ChunkMutationResponse(chunkId, existing.documentId(), true, true, updated.editStatus(), updated.updatedAt());
    }

    public ChunkController.ChunkKeywordsResponse updateChunkKeywords(String chunkId, List<String> keywords) {
        ChunkRepository.ChunkRecord existing = chunkRepository.findById(chunkId)
            .orElseThrow(() -> new IllegalArgumentException("Chunk not found: " + chunkId));
        ChunkRepository.ChunkRecord updated = new ChunkRepository.ChunkRecord(
            existing.id(), existing.documentId(), existing.sourceId(), existing.ordinal(), existing.title(),
            existing.titlePath(), keywords, existing.text(), existing.markdown(), existing.pageFrom(), existing.pageTo(),
            existing.tokenCount(), existing.textLength(), hash(existing.text() + existing.markdown() + keywords),
            "USER_EDITED", "system", existing.createdAt(), Instant.now()
        );
        chunkRepository.update(updated);
        refreshDocumentChunkStats(existing.documentId());
        return new ChunkController.ChunkKeywordsResponse(chunkId, keywords, true, true, updated.updatedAt());
    }

    public ChunkController.DeleteChunkResponse deleteChunk(String chunkId) {
        ChunkRepository.ChunkRecord existing = chunkRepository.findById(chunkId)
            .orElseThrow(() -> new IllegalArgumentException("Chunk not found: " + chunkId));
        chunkRepository.delete(chunkId);
        refreshDocumentChunkStats(existing.documentId());
        return new ChunkController.DeleteChunkResponse(chunkId, true);
    }

    public ChunkController.ReorderChunksResponse reorderChunks(String documentId, List<ChunkController.ReorderItem> items) {
        for (ChunkController.ReorderItem item : items) {
            ChunkRepository.ChunkRecord existing = chunkRepository.findById(item.chunkId())
                .orElseThrow(() -> new IllegalArgumentException("Chunk not found: " + item.chunkId()));
            chunkRepository.update(new ChunkRepository.ChunkRecord(
                existing.id(), existing.documentId(), existing.sourceId(), item.ordinal(), existing.title(), existing.titlePath(),
                existing.keywords(), existing.text(), existing.markdown(), existing.pageFrom(), existing.pageTo(),
                existing.tokenCount(), existing.textLength(), existing.contentHash(), "USER_EDITED", "system", existing.createdAt(), Instant.now()
            ));
        }
        refreshDocumentChunkStats(documentId);
        return new ChunkController.ReorderChunksResponse(documentId, true, true, items.size());
    }

    public ChunkController.ChunkReindexResponse reindexChunk(String chunkId) {
        return new ChunkController.ChunkReindexResponse(chunkId, true, Instant.now());
    }

    public RetrievalController.SearchResponse search(RetrievalController.SearchRequest request) {
        int topK = request.topK() != null ? request.topK() : 10;
        if (topK <= 0 || topK > profileBootstrapService.properties().getRetrieval().getMaxTopK()) {
            throw new IllegalStateException("Invalid topK: " + topK);
        }
        List<SearchService.SearchableChunk> searchableChunks = filterChunks(request.sourceIds(), request.documentIds(), request.filters());
        List<SearchService.SearchMatch> matches = searchService.search(searchableChunks, request.query(), topK);
        List<RetrievalController.SearchHit> hits = matches.stream().map(match -> {
            SearchService.SearchableChunk chunk = match.chunk();
            String snippet = chunk.text().length() > 180 ? chunk.text().substring(0, 180) : chunk.text();
            return new RetrievalController.SearchHit(
                chunk.id(), chunk.documentId(), chunk.sourceId(), chunk.title(), chunk.titlePath(), snippet,
                match.score(), match.score(), 0.0, match.score(), chunk.pageFrom(), chunk.pageTo()
            );
        }).toList();
        return new RetrievalController.SearchResponse(request.query(), hits, hits.size());
    }

    public RetrievalController.FetchResponse fetch(String chunkId, boolean includeNeighbors, int neighborWindow) {
        if (neighborWindow <= 0 || neighborWindow > profileBootstrapService.properties().getFetch().getMaxNeighborWindow()) {
            throw new IllegalStateException("Invalid neighborWindow: " + neighborWindow);
        }
        ChunkRepository.ChunkRecord chunk = chunkRepository.findById(chunkId)
            .orElseThrow(() -> new IllegalArgumentException("Chunk not found: " + chunkId));
        List<RetrievalController.NeighborChunk> neighbors = null;
        if (includeNeighbors) {
            List<ChunkRepository.ChunkRecord> siblings = chunkRepository.findByDocumentId(chunk.documentId());
            neighbors = siblings.stream()
                .filter(s -> Math.abs(s.ordinal() - chunk.ordinal()) <= neighborWindow && !s.id().equals(chunk.id()))
                .map(s -> new RetrievalController.NeighborChunk(s.ordinal() < chunk.ordinal() ? "previous" : "next", s.id(), s.text()))
                .toList();
        }
        List<ChunkRepository.ChunkRecord> siblings = chunkRepository.findByDocumentId(chunk.documentId());
        String previous = siblings.stream().filter(s -> s.ordinal() == chunk.ordinal() - 1).map(ChunkRepository.ChunkRecord::id).findFirst().orElse(null);
        String next = siblings.stream().filter(s -> s.ordinal() == chunk.ordinal() + 1).map(ChunkRepository.ChunkRecord::id).findFirst().orElse(null);
        return new RetrievalController.FetchResponse(
            chunk.id(), chunk.documentId(), chunk.sourceId(), chunk.title(), chunk.titlePath(), chunk.text(), chunk.markdown(),
            chunk.keywords(), chunk.pageFrom(), chunk.pageTo(), previous, next, neighbors
        );
    }

    public RetrievalController.RetrieveResponse retrieve(RetrievalController.RetrieveRequest request) {
        RetrievalController.SearchResponse searchResponse = search(new RetrievalController.SearchRequest(
            request.query(), request.sourceIds(), List.of(), request.retrievalProfileId(), request.topK(), null, null
        ));
        List<RetrievalController.Evidence> evidences = searchResponse.hits().stream().map(hit -> {
            RetrievalController.FetchResponse fetched = fetch(hit.chunkId(), false, 1);
            return new RetrievalController.Evidence(
                fetched.chunkId(), fetched.documentId(), fetched.sourceId(), fetched.title(), fetched.text(), fetched.markdown(),
                hit.score(), fetched.keywords(), List.of(new RetrievalController.Reference("page", fetched.pageFrom(), fetched.pageTo()))
            );
        }).toList();
        return new RetrievalController.RetrieveResponse(request.query(), evidences);
    }

    public RetrievalController.ExplainResponse explain(RetrievalController.ExplainRequest request) {
        ChunkRepository.ChunkRecord chunk = chunkRepository.findById(request.chunkId())
            .orElseThrow(() -> new IllegalArgumentException("Chunk not found: " + request.chunkId()));
        SearchService.ExplainResult explain = searchService.explain(toSearchableChunk(chunk), request.query());
        return new RetrievalController.ExplainResponse(
            request.query(),
            request.chunkId(),
            new RetrievalController.LexicalExplain(explain.matchedFields(), explain.score(), 1),
            new RetrievalController.SemanticExplain(0.0, 0),
            new RetrievalController.FusionExplain("rrf", explain.score())
        );
    }

    public PageResponse<ProfileController.ProfileSummary> listIndexProfiles(int page, int pageSize) {
        List<ProfileController.ProfileSummary> items = profileRepository.findAllIndex().stream()
            .map(p -> new ProfileController.ProfileSummary(p.id(), p.name(), p.config(), p.createdAt(), p.updatedAt()))
            .toList();
        return page(items, page, pageSize);
    }

    public PageResponse<ProfileController.ProfileSummary> listRetrievalProfiles(int page, int pageSize) {
        List<ProfileController.ProfileSummary> items = profileRepository.findAllRetrieval().stream()
            .map(p -> new ProfileController.ProfileSummary(p.id(), p.name(), p.config(), p.createdAt(), p.updatedAt()))
            .toList();
        return page(items, page, pageSize);
    }

    public ProfileController.ProfileDetail createIndexProfile(ProfileController.CreateProfileRequest request) {
        Instant now = Instant.now();
        ProfileRepository.ProfileRecord record = new ProfileRepository.ProfileRecord(Ids.newId("ip"), request.name(), request.config(), "index", now, now);
        profileRepository.insertIndex(record);
        return new ProfileController.ProfileDetail(record.id(), record.name(), record.config(), now, now);
    }

    public ProfileController.ProfileDetail createRetrievalProfile(ProfileController.CreateProfileRequest request) {
        Instant now = Instant.now();
        ProfileRepository.ProfileRecord record = new ProfileRepository.ProfileRecord(Ids.newId("rp"), request.name(), request.config(), "retrieval", now, now);
        profileRepository.insertRetrieval(record);
        return new ProfileController.ProfileDetail(record.id(), record.name(), record.config(), now, now);
    }

    public ProfileController.ProfileDetail getIndexProfile(String id) {
        ProfileRepository.ProfileRecord record = profileRepository.findIndexById(id).orElseThrow(() -> new IllegalArgumentException("Index profile not found: " + id));
        return new ProfileController.ProfileDetail(record.id(), record.name(), record.config(), record.createdAt(), record.updatedAt());
    }

    public ProfileController.ProfileDetail getRetrievalProfile(String id) {
        ProfileRepository.ProfileRecord record = profileRepository.findRetrievalById(id).orElseThrow(() -> new IllegalArgumentException("Retrieval profile not found: " + id));
        return new ProfileController.ProfileDetail(record.id(), record.name(), record.config(), record.createdAt(), record.updatedAt());
    }

    public ProfileController.ProfileUpdateResponse updateIndexProfile(String id, ProfileController.UpdateProfileRequest request) {
        ProfileRepository.ProfileRecord existing = profileRepository.findIndexById(id).orElseThrow(() -> new IllegalArgumentException("Index profile not found: " + id));
        ProfileRepository.ProfileRecord updated = new ProfileRepository.ProfileRecord(id, request.name() != null ? request.name() : existing.name(),
            mergeMaps(existing.config(), request.config()), "index", existing.createdAt(), Instant.now());
        profileRepository.updateIndex(updated);
        return new ProfileController.ProfileUpdateResponse(id, updated.name(), updated.updatedAt());
    }

    public ProfileController.ProfileUpdateResponse updateRetrievalProfile(String id, ProfileController.UpdateProfileRequest request) {
        ProfileRepository.ProfileRecord existing = profileRepository.findRetrievalById(id).orElseThrow(() -> new IllegalArgumentException("Retrieval profile not found: " + id));
        ProfileRepository.ProfileRecord updated = new ProfileRepository.ProfileRecord(id, request.name() != null ? request.name() : existing.name(),
            mergeMaps(existing.config(), request.config()), "retrieval", existing.createdAt(), Instant.now());
        profileRepository.updateRetrieval(updated);
        return new ProfileController.ProfileUpdateResponse(id, updated.name(), updated.updatedAt());
    }

    public ProfileController.DeleteProfileResponse deleteIndexProfile(String id) {
        ensureProfileNotBound(id, true);
        profileRepository.deleteIndex(id);
        return new ProfileController.DeleteProfileResponse(id, true);
    }

    public ProfileController.DeleteProfileResponse deleteRetrievalProfile(String id) {
        ensureProfileNotBound(id, false);
        profileRepository.deleteRetrieval(id);
        return new ProfileController.DeleteProfileResponse(id, true);
    }

    public PageResponse<ProfileController.BindingResponse> listBindings(int page, int pageSize) {
        List<ProfileController.BindingResponse> items = bindingRepository.findAll().stream()
            .map(b -> new ProfileController.BindingResponse(b.sourceId(), b.indexProfileId(), b.retrievalProfileId(), b.updatedAt()))
            .toList();
        return page(items, page, pageSize);
    }

    public ProfileController.BindingResponse bindProfiles(ProfileController.BindingRequest request) {
        sourceRepository.findById(request.sourceId()).orElseThrow(() -> new IllegalArgumentException("Source not found: " + request.sourceId()));
        validateIndexProfileExists(request.indexProfileId());
        validateRetrievalProfileExists(request.retrievalProfileId());
        Instant now = Instant.now();
        bindingRepository.upsert(new BindingRepository.BindingRecord(Ids.newId("spb"), request.sourceId(), request.indexProfileId(), request.retrievalProfileId(), now, now));
        SourceRepository.SourceRecord source = sourceRepository.findById(request.sourceId()).orElseThrow(() -> new IllegalArgumentException("Source not found: " + request.sourceId()));
        sourceRepository.update(new SourceRepository.SourceRecord(source.id(), source.name(), source.description(), source.status(), source.storageMode(), request.indexProfileId(), request.retrievalProfileId(), source.createdAt(), now));
        return new ProfileController.BindingResponse(request.sourceId(), request.indexProfileId(), request.retrievalProfileId(), now);
    }

    public ProfileController.BindingResponse updateBinding(String sourceId, ProfileController.BindingPatchRequest request) {
        BindingRepository.BindingRecord existingBinding = bindingRepository.findBySourceId(sourceId)
            .orElseThrow(() -> new IllegalArgumentException("Binding not found for source: " + sourceId));
        return bindProfiles(new ProfileController.BindingRequest(
            sourceId,
            request.indexProfileId() != null ? request.indexProfileId() : existingBinding.indexProfileId(),
            request.retrievalProfileId() != null ? request.retrievalProfileId() : existingBinding.retrievalProfileId()
        ));
    }

    public JobController.JobResponse getJob(String jobId) {
        return jobRepository.findById(jobId).map(this::toJobResponse)
            .orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));
    }

    public PageResponse<JobController.JobResponse> listJobs(int page, int pageSize) {
        List<JobController.JobResponse> items = jobRepository.findAll().stream().map(this::toJobResponse).toList();
        return page(items, page, pageSize);
    }

    public JobController.JobCancelResponse cancelJob(String jobId) {
        JobRepository.JobRecord existing = jobRepository.findById(jobId).orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));
        JobRepository.JobRecord updated = new JobRepository.JobRecord(existing.id(), existing.jobType(), existing.sourceId(), existing.documentId(), "CANCELLED", existing.progress(), existing.message(), existing.startedAt(), Instant.now(), existing.createdAt(), Instant.now());
        jobRepository.update(updated);
        return new JobController.JobCancelResponse(jobId, true, "CANCELLED", updated.updatedAt());
    }

    public JobController.JobRetryResponse retryJob(String jobId) {
        JobRepository.JobRecord existing = jobRepository.findById(jobId).orElseThrow(() -> new IllegalArgumentException("Job not found: " + jobId));
        if (!"FAILED".equals(existing.status())) {
            throw new IllegalStateException("Only failed jobs can be retried");
        }
        Instant now = Instant.now();
        JobRepository.JobRecord retry = new JobRepository.JobRecord(Ids.newId("job"), existing.jobType(), existing.sourceId(), existing.documentId(), "SUCCEEDED", 100, "Retry completed", now, now, now, now);
        jobRepository.insert(retry);
        return new JobController.JobRetryResponse(retry.id(), jobId, retry.status());
    }

    public JobController.JobLogsResponse logs(String jobId) {
        JobController.JobResponse job = getJob(jobId);
        return new JobController.JobLogsResponse(jobId, List.of(new JobController.JobLogEntry(job.updatedAt(), "INFO", job.message())));
    }

    public com.huawei.opsfactory.knowledge.api.stats.StatsController.OverviewStatsResponse overviewStats() {
        return new com.huawei.opsfactory.knowledge.api.stats.StatsController.OverviewStatsResponse(
            sourceRepository.findAll().size(),
            (int) documentRepository.count(),
            (int) documentRepository.countByStatus("INDEXED"),
            (int) documentRepository.countByStatus("ERROR"),
            (int) documentRepository.countByStatus("PROCESSING"),
            (int) chunkRepository.count(),
            (int) chunkRepository.countUserEdited(),
            (int) jobRepository.countRunning()
        );
    }

    private boolean processUpload(String sourceId, MultipartFile file) {
        try {
            String documentId = Ids.newId("doc");
            String sha256 = sha256(file.getInputStream());
            if (documentRepository.findBySourceIdAndSha256(sourceId, sha256).isPresent()) {
                return false;
            }
            Path originalPath = storageManager.originalFilePath(sourceId, documentId, file.getOriginalFilename());
            storageManager.save(file.getInputStream(), originalPath);
            TikaConversionService.ConversionResult conversion = conversionService.convert(originalPath);
            if (!isAllowedContentType(Optional.ofNullable(file.getContentType()).orElse(conversion.contentType()), conversion.contentType())) {
                storageManager.deleteRecursively(storageManager.uploadDocumentDir(sourceId, documentId));
                throw new IllegalStateException("Unsupported content type: " + conversion.contentType());
            }
            Instant now = Instant.now();
            DocumentRepository.DocumentRecord doc = new DocumentRepository.DocumentRecord(
                documentId, sourceId, file.getOriginalFilename(), file.getOriginalFilename(), conversion.title(), null, List.of(),
                sha256, Optional.ofNullable(file.getContentType()).orElse(conversion.contentType()), "zh",
                "INDEXED", "INDEXED", file.getSize(), 0, 0, null, "system", now, now
            );
            documentRepository.insert(doc);
            Path artifactDir = storageManager.artifactDir(sourceId, documentId);
            storageManager.writeString(artifactDir.resolve("content.txt"), conversion.text());
            storageManager.writeString(artifactDir.resolve("content.md"), conversion.markdown());
            List<ChunkingService.ChunkDraft> chunks = chunkingService.chunk(conversion.title(), conversion.text(), conversion.markdown());
            for (ChunkingService.ChunkDraft draft : chunks) {
                chunkRepository.insert(new ChunkRepository.ChunkRecord(
                    Ids.newId("chk"), documentId, sourceId, draft.ordinal(), draft.title(), draft.titlePath(), draft.keywords(),
                    draft.text(), draft.markdown(), 1, 1, draft.tokenCount(), draft.textLength(), hash(draft.text() + draft.markdown()),
                    "SYSTEM_GENERATED", "system", now, now
                ));
            }
            refreshDocumentChunkStats(documentId);
            return true;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to ingest file " + file.getOriginalFilename(), e);
        }
    }

    private boolean isAllowedContentType(String requestContentType, String detectedContentType) {
        List<String> allowed = profileBootstrapService.allowedContentTypes();
        return allowed.contains(requestContentType) || allowed.contains(detectedContentType);
    }

    private void validateIndexProfileExists(String profileId) {
        if (profileId != null && profileRepository.findIndexById(profileId).isEmpty()) {
            throw new IllegalArgumentException("Index profile not found: " + profileId);
        }
    }

    private void validateRetrievalProfileExists(String profileId) {
        if (profileId != null && profileRepository.findRetrievalById(profileId).isEmpty()) {
            throw new IllegalArgumentException("Retrieval profile not found: " + profileId);
        }
    }

    private void ensureProfileNotBound(String profileId, boolean indexProfile) {
        boolean inUse = bindingRepository.findAll().stream().anyMatch(binding ->
            indexProfile ? profileId.equals(binding.indexProfileId()) : profileId.equals(binding.retrievalProfileId())
        );
        if (inUse) {
            throw new IllegalStateException("Profile is still bound to a source: " + profileId);
        }
    }

    private void refreshDocumentChunkStats(String documentId) {
        DocumentRepository.DocumentRecord existing = documentRepository.findById(documentId)
            .orElseThrow(() -> new IllegalArgumentException("Document not found: " + documentId));
        List<ChunkRepository.ChunkRecord> chunks = chunkRepository.findByDocumentId(documentId);
        int userEdited = (int) chunks.stream().filter(c -> "USER_EDITED".equals(c.editStatus())).count();
        documentRepository.update(new DocumentRepository.DocumentRecord(
            existing.id(), existing.sourceId(), existing.name(), existing.originalFilename(), existing.title(), existing.description(),
            existing.tags(), existing.sha256(), existing.contentType(), existing.language(), "INDEXED", "INDEXED",
            existing.fileSizeBytes(), chunks.size(), userEdited, existing.errorMessage(), existing.updatedBy(), existing.createdAt(), Instant.now()
        ));
    }

    private String sha256(InputStream inputStream) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = inputStream.read(buffer)) >= 0) {
                digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to calculate sha256", e);
        }
    }

    private String hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest((value == null ? "" : value).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private List<SearchService.SearchableChunk> filterChunks(
        List<String> sourceIds,
        List<String> documentIds,
        RetrievalController.SearchFilters filters
    ) {
        return chunkRepository.findAll().stream()
            .filter(c -> sourceIds == null || sourceIds.isEmpty() || sourceIds.contains(c.sourceId()))
            .filter(c -> documentIds == null || documentIds.isEmpty() || documentIds.contains(c.documentId()))
            .filter(c -> {
                if (filters == null || filters.contentTypes() == null || filters.contentTypes().isEmpty()) {
                    return true;
                }
                return documentRepository.findById(c.documentId())
                    .map(DocumentRepository.DocumentRecord::contentType)
                    .filter(filters.contentTypes()::contains)
                    .isPresent();
            })
            .map(this::toSearchableChunk)
            .toList();
    }

    private SearchService.SearchableChunk toSearchableChunk(ChunkRepository.ChunkRecord record) {
        return new SearchService.SearchableChunk(
            record.id(), record.documentId(), record.sourceId(), record.title(), record.titlePath(),
            record.keywords(), record.text(), record.markdown(), record.pageFrom(), record.pageTo(),
            record.ordinal(), record.editStatus(), record.updatedBy()
        );
    }

    private SourceController.SourceResponse toSourceResponse(SourceRepository.SourceRecord source) {
        return new SourceController.SourceResponse(
            source.id(), source.name(), source.description(), source.status(), source.storageMode(),
            source.indexProfileId(), source.retrievalProfileId(), source.createdAt(), source.updatedAt()
        );
    }

    private DocumentController.DocumentSummary toDocumentSummary(DocumentRepository.DocumentRecord document) {
        return new DocumentController.DocumentSummary(
            document.id(), document.sourceId(), document.name(), document.contentType(), document.title(), document.status(),
            document.indexStatus(), document.fileSizeBytes(), document.chunkCount(), document.userEditedChunkCount(),
            document.createdAt(), document.updatedAt()
        );
    }

    private DocumentController.DocumentDetail toDocumentDetail(DocumentRepository.DocumentRecord document) {
        return new DocumentController.DocumentDetail(
            document.id(), document.sourceId(), document.name(), document.originalFilename(), document.title(), document.description(),
            document.tags(), document.sha256(), document.contentType(), document.language(), document.status(), document.indexStatus(),
            document.fileSizeBytes(), document.chunkCount(), document.userEditedChunkCount(), document.errorMessage(),
            document.createdAt(), document.updatedAt()
        );
    }

    private ChunkController.ChunkSummary toChunkSummary(ChunkRepository.ChunkRecord chunk) {
        String snippet = chunk.text().length() > 180 ? chunk.text().substring(0, 180) : chunk.text();
        return new ChunkController.ChunkSummary(
            chunk.id(), chunk.documentId(), chunk.sourceId(), chunk.ordinal(), chunk.title(), chunk.titlePath(),
            chunk.keywords(), snippet, chunk.pageFrom(), chunk.pageTo(), chunk.tokenCount(), chunk.editStatus(), chunk.updatedAt()
        );
    }

    private ChunkController.ChunkDetail toChunkDetail(ChunkRepository.ChunkRecord chunk) {
        return new ChunkController.ChunkDetail(
            chunk.id(), chunk.documentId(), chunk.sourceId(), chunk.ordinal(), chunk.title(), chunk.titlePath(), chunk.keywords(),
            chunk.text(), chunk.markdown(), chunk.pageFrom(), chunk.pageTo(), chunk.tokenCount(), chunk.textLength(),
            chunk.editStatus(), chunk.updatedBy(), chunk.createdAt(), chunk.updatedAt()
        );
    }

    private JobController.JobResponse toJobResponse(JobRepository.JobRecord job) {
        return new JobController.JobResponse(
            job.id(), job.jobType(), job.sourceId(), job.documentId(), job.status(), job.progress(), job.message(),
            job.startedAt(), job.finishedAt(), job.createdAt(), job.updatedAt()
        );
    }

    private Map<String, Object> mergeMaps(Map<String, Object> base, Map<String, Object> patch) {
        if (patch == null || patch.isEmpty()) {
            return base;
        }
        Map<String, Object> merged = new java.util.LinkedHashMap<>(base);
        merged.putAll(patch);
        return merged;
    }

    private <T> PageResponse<T> page(List<T> items, int page, int pageSize) {
        int safePage = Math.max(page, 1);
        int safePageSize = Math.max(pageSize, 1);
        int from = Math.min((safePage - 1) * safePageSize, items.size());
        int to = Math.min(from + safePageSize, items.size());
        return new PageResponse<>(items.subList(from, to), safePage, safePageSize, items.size());
    }
}

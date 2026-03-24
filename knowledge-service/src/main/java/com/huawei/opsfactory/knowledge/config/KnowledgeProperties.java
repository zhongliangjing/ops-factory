package com.huawei.opsfactory.knowledge.config;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "ops-knowledge")
public class KnowledgeProperties {

    private Ingest ingest = new Ingest();
    private Convert convert = new Convert();
    private Analysis analysis = new Analysis();
    private Chunking chunking = new Chunking();
    private Metadata metadata = new Metadata();
    private Embedding embedding = new Embedding();
    private Indexing indexing = new Indexing();
    private Retrieval retrieval = new Retrieval();
    private Fetch fetch = new Fetch();
    private Retrieve retrieve = new Retrieve();
    private Features features = new Features();
    private String corsOrigin = "*";

    public Ingest getIngest() { return ingest; }
    public void setIngest(Ingest ingest) { this.ingest = ingest; }
    public Convert getConvert() { return convert; }
    public void setConvert(Convert convert) { this.convert = convert; }
    public Analysis getAnalysis() { return analysis; }
    public void setAnalysis(Analysis analysis) { this.analysis = analysis; }
    public Chunking getChunking() { return chunking; }
    public void setChunking(Chunking chunking) { this.chunking = chunking; }
    public Metadata getMetadata() { return metadata; }
    public void setMetadata(Metadata metadata) { this.metadata = metadata; }
    public Embedding getEmbedding() { return embedding; }
    public void setEmbedding(Embedding embedding) { this.embedding = embedding; }
    public Indexing getIndexing() { return indexing; }
    public void setIndexing(Indexing indexing) { this.indexing = indexing; }
    public Retrieval getRetrieval() { return retrieval; }
    public void setRetrieval(Retrieval retrieval) { this.retrieval = retrieval; }
    public Fetch getFetch() { return fetch; }
    public void setFetch(Fetch fetch) { this.fetch = fetch; }
    public Retrieve getRetrieve() { return retrieve; }
    public void setRetrieve(Retrieve retrieve) { this.retrieve = retrieve; }
    public Features getFeatures() { return features; }
    public void setFeatures(Features features) { this.features = features; }
    public String getCorsOrigin() { return corsOrigin; }
    public void setCorsOrigin(String corsOrigin) { this.corsOrigin = corsOrigin; }

    public static class Ingest {
        private int maxFileSizeMb = 100;
        private List<String> allowedContentTypes = new ArrayList<>(List.of(
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain",
            "text/markdown",
            "text/html",
            "text/csv"
        ));
        private String deduplication = "sha256";
        private boolean skipExistingByDefault = true;
        public int getMaxFileSizeMb() { return maxFileSizeMb; }
        public void setMaxFileSizeMb(int maxFileSizeMb) { this.maxFileSizeMb = maxFileSizeMb; }
        public List<String> getAllowedContentTypes() { return allowedContentTypes; }
        public void setAllowedContentTypes(List<String> allowedContentTypes) { this.allowedContentTypes = allowedContentTypes; }
        public String getDeduplication() { return deduplication; }
        public void setDeduplication(String deduplication) { this.deduplication = deduplication; }
        public boolean isSkipExistingByDefault() { return skipExistingByDefault; }
        public void setSkipExistingByDefault(boolean skipExistingByDefault) { this.skipExistingByDefault = skipExistingByDefault; }
    }

    public static class Convert {
        private String engine = "tika";
        private boolean enablePdfboxFallback = true;
        private boolean extractMetadata = true;
        private boolean normalizeWhitespace = true;
        private boolean normalizeFullHalfWidth = true;
        private boolean keepMarkdownArtifact = true;
        public String getEngine() { return engine; }
        public void setEngine(String engine) { this.engine = engine; }
        public boolean isEnablePdfboxFallback() { return enablePdfboxFallback; }
        public void setEnablePdfboxFallback(boolean enablePdfboxFallback) { this.enablePdfboxFallback = enablePdfboxFallback; }
        public boolean isExtractMetadata() { return extractMetadata; }
        public void setExtractMetadata(boolean extractMetadata) { this.extractMetadata = extractMetadata; }
        public boolean isNormalizeWhitespace() { return normalizeWhitespace; }
        public void setNormalizeWhitespace(boolean normalizeWhitespace) { this.normalizeWhitespace = normalizeWhitespace; }
        public boolean isNormalizeFullHalfWidth() { return normalizeFullHalfWidth; }
        public void setNormalizeFullHalfWidth(boolean normalizeFullHalfWidth) { this.normalizeFullHalfWidth = normalizeFullHalfWidth; }
        public boolean isKeepMarkdownArtifact() { return keepMarkdownArtifact; }
        public void setKeepMarkdownArtifact(boolean keepMarkdownArtifact) { this.keepMarkdownArtifact = keepMarkdownArtifact; }
    }

    public static class Analysis {
        private String language = "zh";
        private String indexAnalyzer = "smartcn";
        private String queryAnalyzer = "smartcn";
        public String getLanguage() { return language; }
        public void setLanguage(String language) { this.language = language; }
        public String getIndexAnalyzer() { return indexAnalyzer; }
        public void setIndexAnalyzer(String indexAnalyzer) { this.indexAnalyzer = indexAnalyzer; }
        public String getQueryAnalyzer() { return queryAnalyzer; }
        public void setQueryAnalyzer(String queryAnalyzer) { this.queryAnalyzer = queryAnalyzer; }
    }

    public static class Chunking {
        private String mode = "hierarchical";
        private int targetTokens = 500;
        private int overlapTokens = 80;
        private boolean respectHeadings = true;
        private boolean keepTablesWhole = true;
        private boolean splitLongParagraphs = true;
        private boolean mergeShortParagraphs = true;
        private int minChunkTokens = 80;
        private int maxChunkTokens = 900;
        public String getMode() { return mode; }
        public void setMode(String mode) { this.mode = mode; }
        public int getTargetTokens() { return targetTokens; }
        public void setTargetTokens(int targetTokens) { this.targetTokens = targetTokens; }
        public int getOverlapTokens() { return overlapTokens; }
        public void setOverlapTokens(int overlapTokens) { this.overlapTokens = overlapTokens; }
        public boolean isRespectHeadings() { return respectHeadings; }
        public void setRespectHeadings(boolean respectHeadings) { this.respectHeadings = respectHeadings; }
        public boolean isKeepTablesWhole() { return keepTablesWhole; }
        public void setKeepTablesWhole(boolean keepTablesWhole) { this.keepTablesWhole = keepTablesWhole; }
        public boolean isSplitLongParagraphs() { return splitLongParagraphs; }
        public void setSplitLongParagraphs(boolean splitLongParagraphs) { this.splitLongParagraphs = splitLongParagraphs; }
        public boolean isMergeShortParagraphs() { return mergeShortParagraphs; }
        public void setMergeShortParagraphs(boolean mergeShortParagraphs) { this.mergeShortParagraphs = mergeShortParagraphs; }
        public int getMinChunkTokens() { return minChunkTokens; }
        public void setMinChunkTokens(int minChunkTokens) { this.minChunkTokens = minChunkTokens; }
        public int getMaxChunkTokens() { return maxChunkTokens; }
        public void setMaxChunkTokens(int maxChunkTokens) { this.maxChunkTokens = maxChunkTokens; }
    }

    public static class Metadata {
        private boolean extractKeywords = true;
        private int maxKeywords = 12;
        private boolean extractTitlePath = true;
        private boolean extractSummary = false;
        private boolean storePageRefs = true;
        public boolean isExtractKeywords() { return extractKeywords; }
        public void setExtractKeywords(boolean extractKeywords) { this.extractKeywords = extractKeywords; }
        public int getMaxKeywords() { return maxKeywords; }
        public void setMaxKeywords(int maxKeywords) { this.maxKeywords = maxKeywords; }
        public boolean isExtractTitlePath() { return extractTitlePath; }
        public void setExtractTitlePath(boolean extractTitlePath) { this.extractTitlePath = extractTitlePath; }
        public boolean isExtractSummary() { return extractSummary; }
        public void setExtractSummary(boolean extractSummary) { this.extractSummary = extractSummary; }
        public boolean isStorePageRefs() { return storePageRefs; }
        public void setStorePageRefs(boolean storePageRefs) { this.storePageRefs = storePageRefs; }
    }

    public static class Embedding {
        private String baseUrl = "https://openrouter.ai/api/v1";
        private String apiKey = "";
        private String model = "qwen/qwen3-embedding-4b";
        private int timeoutMs = 30000;
        private int batchSize = 32;
        private int dimensions = 2560;
        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public int getTimeoutMs() { return timeoutMs; }
        public void setTimeoutMs(int timeoutMs) { this.timeoutMs = timeoutMs; }
        public int getBatchSize() { return batchSize; }
        public void setBatchSize(int batchSize) { this.batchSize = batchSize; }
        public int getDimensions() { return dimensions; }
        public void setDimensions(int dimensions) { this.dimensions = dimensions; }
    }

    public static class Indexing {
        private double titleBoost = 4.0;
        private double titlePathBoost = 2.5;
        private double keywordBoost = 2.0;
        private double contentBoost = 1.0;
        private boolean storeRawText = true;
        private boolean storeMarkdown = true;
        public double getTitleBoost() { return titleBoost; }
        public void setTitleBoost(double titleBoost) { this.titleBoost = titleBoost; }
        public double getTitlePathBoost() { return titlePathBoost; }
        public void setTitlePathBoost(double titlePathBoost) { this.titlePathBoost = titlePathBoost; }
        public double getKeywordBoost() { return keywordBoost; }
        public void setKeywordBoost(double keywordBoost) { this.keywordBoost = keywordBoost; }
        public double getContentBoost() { return contentBoost; }
        public void setContentBoost(double contentBoost) { this.contentBoost = contentBoost; }
        public boolean isStoreRawText() { return storeRawText; }
        public void setStoreRawText(boolean storeRawText) { this.storeRawText = storeRawText; }
        public boolean isStoreMarkdown() { return storeMarkdown; }
        public void setStoreMarkdown(boolean storeMarkdown) { this.storeMarkdown = storeMarkdown; }
    }

    public static class Retrieval {
        private String mode = "hybrid";
        private int lexicalTopK = 50;
        private int semanticTopK = 50;
        private int finalTopK = 10;
        private int maxTopK = 50;
        private String fusionMode = "rrf";
        private int rrfK = 60;
        private double lexicalWeight = 0.5;
        private double semanticWeight = 0.5;
        private int snippetLength = 180;
        public String getMode() { return mode; }
        public void setMode(String mode) { this.mode = mode; }
        public int getLexicalTopK() { return lexicalTopK; }
        public void setLexicalTopK(int lexicalTopK) { this.lexicalTopK = lexicalTopK; }
        public int getSemanticTopK() { return semanticTopK; }
        public void setSemanticTopK(int semanticTopK) { this.semanticTopK = semanticTopK; }
        public int getFinalTopK() { return finalTopK; }
        public void setFinalTopK(int finalTopK) { this.finalTopK = finalTopK; }
        public int getMaxTopK() { return maxTopK; }
        public void setMaxTopK(int maxTopK) { this.maxTopK = maxTopK; }
        public String getFusionMode() { return fusionMode; }
        public void setFusionMode(String fusionMode) { this.fusionMode = fusionMode; }
        public int getRrfK() { return rrfK; }
        public void setRrfK(int rrfK) { this.rrfK = rrfK; }
        public double getLexicalWeight() { return lexicalWeight; }
        public void setLexicalWeight(double lexicalWeight) { this.lexicalWeight = lexicalWeight; }
        public double getSemanticWeight() { return semanticWeight; }
        public void setSemanticWeight(double semanticWeight) { this.semanticWeight = semanticWeight; }
        public int getSnippetLength() { return snippetLength; }
        public void setSnippetLength(int snippetLength) { this.snippetLength = snippetLength; }
    }

    public static class Fetch {
        private boolean includeNeighborsByDefault = false;
        private int defaultNeighborWindow = 1;
        private int maxNeighborWindow = 2;
        public boolean isIncludeNeighborsByDefault() { return includeNeighborsByDefault; }
        public void setIncludeNeighborsByDefault(boolean includeNeighborsByDefault) { this.includeNeighborsByDefault = includeNeighborsByDefault; }
        public int getDefaultNeighborWindow() { return defaultNeighborWindow; }
        public void setDefaultNeighborWindow(int defaultNeighborWindow) { this.defaultNeighborWindow = defaultNeighborWindow; }
        public int getMaxNeighborWindow() { return maxNeighborWindow; }
        public void setMaxNeighborWindow(int maxNeighborWindow) { this.maxNeighborWindow = maxNeighborWindow; }
    }

    public static class Retrieve {
        private boolean expandContext = true;
        private String expandMode = "ordinal_neighbors";
        private int neighborWindow = 1;
        private int maxEvidenceCount = 5;
        private int maxEvidenceTokens = 3000;
        private boolean includeMetadata = true;
        private boolean includeReferences = true;
        public boolean isExpandContext() { return expandContext; }
        public void setExpandContext(boolean expandContext) { this.expandContext = expandContext; }
        public String getExpandMode() { return expandMode; }
        public void setExpandMode(String expandMode) { this.expandMode = expandMode; }
        public int getNeighborWindow() { return neighborWindow; }
        public void setNeighborWindow(int neighborWindow) { this.neighborWindow = neighborWindow; }
        public int getMaxEvidenceCount() { return maxEvidenceCount; }
        public void setMaxEvidenceCount(int maxEvidenceCount) { this.maxEvidenceCount = maxEvidenceCount; }
        public int getMaxEvidenceTokens() { return maxEvidenceTokens; }
        public void setMaxEvidenceTokens(int maxEvidenceTokens) { this.maxEvidenceTokens = maxEvidenceTokens; }
        public boolean isIncludeMetadata() { return includeMetadata; }
        public void setIncludeMetadata(boolean includeMetadata) { this.includeMetadata = includeMetadata; }
        public boolean isIncludeReferences() { return includeReferences; }
        public void setIncludeReferences(boolean includeReferences) { this.includeReferences = includeReferences; }
    }

    public static class Features {
        private boolean allowChunkEdit = true;
        private boolean allowChunkDelete = true;
        private boolean allowExplain = true;
        private boolean allowRequestOverride = true;
        public boolean isAllowChunkEdit() { return allowChunkEdit; }
        public void setAllowChunkEdit(boolean allowChunkEdit) { this.allowChunkEdit = allowChunkEdit; }
        public boolean isAllowChunkDelete() { return allowChunkDelete; }
        public void setAllowChunkDelete(boolean allowChunkDelete) { this.allowChunkDelete = allowChunkDelete; }
        public boolean isAllowExplain() { return allowExplain; }
        public void setAllowExplain(boolean allowExplain) { this.allowExplain = allowExplain; }
        public boolean isAllowRequestOverride() { return allowRequestOverride; }
        public void setAllowRequestOverride(boolean allowRequestOverride) { this.allowRequestOverride = allowRequestOverride; }
    }
}

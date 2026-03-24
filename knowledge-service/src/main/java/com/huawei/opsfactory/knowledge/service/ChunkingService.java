package com.huawei.opsfactory.knowledge.service;

import com.huawei.opsfactory.knowledge.common.util.KeywordExtractor;
import com.huawei.opsfactory.knowledge.common.util.TokenEstimator;
import com.huawei.opsfactory.knowledge.config.KnowledgeProperties;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ChunkingService {

    private final KnowledgeProperties properties;

    public ChunkingService(KnowledgeProperties properties) {
        this.properties = properties;
    }

    public List<ChunkDraft> chunk(String title, String text, String markdown) {
        String[] blocks = (text == null ? "" : text).split("\\R\\s*\\R");
        List<ChunkDraft> drafts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        int ordinal = 1;
        int target = properties.getChunking().getTargetTokens();
        for (String block : blocks) {
            String normalized = block.strip();
            if (normalized.isBlank()) {
                continue;
            }
            if (!current.isEmpty()) {
                current.append("\n\n");
            }
            current.append(normalized);
            if (TokenEstimator.estimate(current.toString()) >= target) {
                drafts.add(buildDraft(title, current.toString(), ordinal++));
                current.setLength(0);
            }
        }
        if (!current.isEmpty()) {
            drafts.add(buildDraft(title, current.toString(), ordinal));
        }
        if (drafts.isEmpty()) {
            drafts.add(buildDraft(title, text == null ? "" : text, 1));
        }
        return drafts;
    }

    private ChunkDraft buildDraft(String title, String content, int ordinal) {
        List<String> titlePath = title == null || title.isBlank() ? List.of() : List.of(title);
        List<String> keywords = KeywordExtractor.extract(content, properties.getMetadata().getMaxKeywords());
        return new ChunkDraft(
            ordinal,
            title,
            titlePath,
            keywords,
            content,
            content,
            TokenEstimator.estimate(content),
            content.length()
        );
    }

    public record ChunkDraft(
        int ordinal,
        String title,
        List<String> titlePath,
        List<String> keywords,
        String text,
        String markdown,
        int tokenCount,
        int textLength
    ) {
    }
}

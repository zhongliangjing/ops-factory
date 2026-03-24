package com.huawei.opsfactory.knowledge.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;

@Service
public class SearchService {

    public List<SearchMatch> search(List<SearchableChunk> chunks, String query, int topK) {
        String q = query == null ? "" : query.toLowerCase(Locale.ROOT).trim();
        List<SearchMatch> matches = new ArrayList<>();
        for (SearchableChunk chunk : chunks) {
            double lexical = score(chunk, q);
            if (lexical <= 0) {
                continue;
            }
            matches.add(new SearchMatch(chunk, lexical));
        }
        matches.sort(Comparator.comparingDouble(SearchMatch::score).reversed());
        if (matches.size() > topK) {
            return new ArrayList<>(matches.subList(0, topK));
        }
        return matches;
    }

    public ExplainResult explain(SearchableChunk chunk, String query) {
        String q = query == null ? "" : query.toLowerCase(Locale.ROOT).trim();
        List<String> fields = new ArrayList<>();
        if (contains(chunk.title(), q)) {
            fields.add("title");
        }
        if (contains(String.join(" ", chunk.titlePath()), q)) {
            fields.add("titlePath");
        }
        if (contains(String.join(" ", chunk.keywords()), q)) {
            fields.add("keywords");
        }
        if (contains(chunk.text(), q)) {
            fields.add("content");
        }
        return new ExplainResult(fields, score(chunk, q));
    }

    private double score(SearchableChunk chunk, String query) {
        if (query.isBlank()) {
            return 0;
        }
        double score = 0;
        if (contains(chunk.title(), query)) {
            score += 4.0;
        }
        if (contains(String.join(" ", chunk.titlePath()), query)) {
            score += 2.5;
        }
        if (contains(String.join(" ", chunk.keywords()), query)) {
            score += 2.0;
        }
        if (contains(chunk.text(), query)) {
            score += 1.0;
        }
        return score;
    }

    private boolean contains(String haystack, String needle) {
        return haystack != null && !needle.isBlank() && haystack.toLowerCase(Locale.ROOT).contains(needle);
    }

    public record SearchableChunk(
        String id,
        String documentId,
        String sourceId,
        String title,
        List<String> titlePath,
        List<String> keywords,
        String text,
        String markdown,
        Integer pageFrom,
        Integer pageTo,
        int ordinal,
        String editStatus,
        String updatedBy
    ) {
    }

    public record SearchMatch(SearchableChunk chunk, double score) {
    }

    public record ExplainResult(List<String> matchedFields, double score) {
    }
}

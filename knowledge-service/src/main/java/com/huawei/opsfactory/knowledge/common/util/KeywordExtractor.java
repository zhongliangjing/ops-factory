package com.huawei.opsfactory.knowledge.common.util;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class KeywordExtractor {

    private static final Pattern TOKEN_PATTERN = Pattern.compile("[\\p{IsHan}A-Za-z0-9_\\-]{2,}");
    private static final Set<String> STOP_WORDS = Set.of(
        "the", "and", "for", "with", "that", "this", "from", "was", "are", "but", "have", "has",
        "sla", "report"
    );

    private KeywordExtractor() {
    }

    public static List<String> extract(String text, int maxKeywords) {
        Map<String, Integer> counts = new HashMap<>();
        Matcher matcher = TOKEN_PATTERN.matcher(text == null ? "" : text);
        while (matcher.find()) {
            String token = matcher.group().toLowerCase(Locale.ROOT);
            if (STOP_WORDS.contains(token)) {
                continue;
            }
            counts.merge(token, 1, Integer::sum);
        }

        List<String> tokens = new ArrayList<>(counts.keySet());
        tokens.sort(Comparator.<String>comparingInt(counts::get).reversed().thenComparing(String::compareTo));
        if (tokens.size() > maxKeywords) {
            return new ArrayList<>(tokens.subList(0, maxKeywords));
        }
        return tokens;
    }
}

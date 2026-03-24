package com.huawei.opsfactory.knowledge.common.util;

public final class TokenEstimator {

    private TokenEstimator() {
    }

    public static int estimate(String text) {
        if (text == null || text.isBlank()) {
            return 0;
        }
        String normalized = text.trim();
        int whitespaceWords = normalized.split("\\s+").length;
        int cjkChars = (int) normalized.codePoints().filter(TokenEstimator::isCjk).count();
        return Math.max(whitespaceWords, cjkChars / 2);
    }

    private static boolean isCjk(int codePoint) {
        Character.UnicodeScript script = Character.UnicodeScript.of(codePoint);
        return script == Character.UnicodeScript.HAN;
    }
}

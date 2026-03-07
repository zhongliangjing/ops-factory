package com.huawei.opsfactory.gateway.common.util;

import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.Map;

public final class YamlLoader {

    private YamlLoader() {
    }

    /**
     * Load a YAML file as a flat Map. Returns empty map if file does not exist.
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> load(Path path) {
        if (!Files.exists(path)) {
            return Collections.emptyMap();
        }
        try (InputStream is = Files.newInputStream(path)) {
            Yaml yaml = new Yaml();
            Map<String, Object> result = yaml.load(is);
            return result != null ? result : Collections.emptyMap();
        } catch (IOException e) {
            throw new RuntimeException("Failed to load YAML: " + path, e);
        }
    }

    /**
     * Get a string value from a nested map, returning defaultValue if absent.
     */
    public static String getString(Map<String, Object> map, String key, String defaultValue) {
        Object val = map.get(key);
        return val != null ? val.toString() : defaultValue;
    }

    /**
     * Get an int value from a nested map, returning defaultValue if absent.
     */
    public static int getInt(Map<String, Object> map, String key, int defaultValue) {
        Object val = map.get(key);
        if (val instanceof Number n) {
            return n.intValue();
        }
        if (val instanceof String s) {
            try {
                return Integer.parseInt(s);
            } catch (NumberFormatException e) {
                return defaultValue;
            }
        }
        return defaultValue;
    }
}

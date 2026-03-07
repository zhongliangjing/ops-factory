package com.huawei.opsfactory.gateway.common.util;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileWriter;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class YamlLoaderTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    @Test
    public void testLoad_existingFile() throws Exception {
        File yamlFile = tempFolder.newFile("test.yaml");
        try (FileWriter w = new FileWriter(yamlFile)) {
            w.write("name: test-agent\nport: 8080\nenabled: true\n");
        }

        Map<String, Object> data = YamlLoader.load(yamlFile.toPath());
        assertEquals("test-agent", data.get("name"));
        assertEquals(8080, data.get("port"));
        assertEquals(true, data.get("enabled"));
    }

    @Test
    public void testLoad_nonExistentFile() {
        Path nonExistent = tempFolder.getRoot().toPath().resolve("missing.yaml");
        Map<String, Object> data = YamlLoader.load(nonExistent);
        assertTrue(data.isEmpty());
    }

    @Test
    public void testLoad_emptyFile() throws Exception {
        File yamlFile = tempFolder.newFile("empty.yaml");
        Map<String, Object> data = YamlLoader.load(yamlFile.toPath());
        assertTrue(data.isEmpty());
    }

    @Test
    public void testGetString_present() {
        assertEquals("value", YamlLoader.getString(Map.of("key", "value"), "key", "default"));
    }

    @Test
    public void testGetString_absent() {
        assertEquals("default", YamlLoader.getString(Map.of(), "key", "default"));
    }

    @Test
    public void testGetInt_present() {
        assertEquals(3000, YamlLoader.getInt(Map.of("port", 3000), "port", 8080));
    }

    @Test
    public void testGetInt_stringValue() {
        assertEquals(3000, YamlLoader.getInt(Map.of("port", "3000"), "port", 8080));
    }

    @Test
    public void testGetInt_absent() {
        assertEquals(8080, YamlLoader.getInt(Map.of(), "port", 8080));
    }

    @Test
    public void testGetInt_invalidString() {
        assertEquals(8080, YamlLoader.getInt(Map.of("port", "abc"), "port", 8080));
    }
}

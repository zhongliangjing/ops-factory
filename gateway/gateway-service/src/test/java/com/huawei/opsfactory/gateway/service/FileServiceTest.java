package com.huawei.opsfactory.gateway.service;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.springframework.core.io.Resource;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class FileServiceTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    private FileService fileService;

    @Before
    public void setUp() {
        fileService = new FileService();
    }

    @Test
    public void testListFiles_emptyDir() throws IOException {
        List<Map<String, Object>> files = fileService.listFiles(tempFolder.getRoot().toPath());
        assertTrue(files.isEmpty());
    }

    @Test
    public void testListFiles_withFiles() throws IOException {
        createFile("file1.txt", "hello");
        createFile("file2.json", "{}");

        List<Map<String, Object>> files = fileService.listFiles(tempFolder.getRoot().toPath());
        assertEquals(2, files.size());
    }

    @Test
    public void testListFiles_recursive() throws IOException {
        File subDir = tempFolder.newFolder("subdir");
        try (FileWriter w = new FileWriter(new File(subDir, "nested.txt"))) {
            w.write("nested content");
        }
        createFile("top.txt", "top");

        List<Map<String, Object>> files = fileService.listFiles(tempFolder.getRoot().toPath());
        assertEquals(2, files.size());
    }

    @Test
    public void testListFiles_nonExistentDir() throws IOException {
        List<Map<String, Object>> files = fileService.listFiles(
                tempFolder.getRoot().toPath().resolve("nonexistent"));
        assertTrue(files.isEmpty());
    }

    @Test
    public void testResolveFile_valid() throws IOException {
        createFile("test.txt", "content");
        Resource resource = fileService.resolveFile(tempFolder.getRoot().toPath(), "test.txt");
        assertNotNull(resource);
        assertTrue(resource.exists());
    }

    @Test
    public void testResolveFile_traversalAttack() {
        Resource resource = fileService.resolveFile(
                tempFolder.getRoot().toPath(), "../../../etc/passwd");
        assertNull(resource);
    }

    @Test
    public void testResolveFile_nonExistent() {
        Resource resource = fileService.resolveFile(
                tempFolder.getRoot().toPath(), "missing.txt");
        assertNull(resource);
    }

    @Test
    public void testGetMimeType() {
        assertEquals("application/json", fileService.getMimeType("data.json"));
        assertEquals("image/png", fileService.getMimeType("image.png"));
        assertEquals("text/plain", fileService.getMimeType("readme.txt"));
        assertEquals("application/pdf", fileService.getMimeType("doc.pdf"));
        assertEquals("text/markdown", fileService.getMimeType("notes.md"));
        assertEquals("application/octet-stream", fileService.getMimeType("noext"));
        assertEquals("application/octet-stream", fileService.getMimeType("unknown.xyz"));
    }

    @Test
    public void testIsInline() {
        assertTrue(fileService.isInline("text/plain"));
        assertTrue(fileService.isInline("text/html"));
        assertTrue(fileService.isInline("image/png"));
        assertTrue(fileService.isInline("application/json"));
        assertTrue(fileService.isInline("application/pdf"));
        assertFalse(fileService.isInline("application/zip"));
        assertFalse(fileService.isInline("application/octet-stream"));
    }

    private void createFile(String name, String content) throws IOException {
        File file = new File(tempFolder.getRoot(), name);
        try (FileWriter w = new FileWriter(file)) {
            w.write(content);
        }
    }
}

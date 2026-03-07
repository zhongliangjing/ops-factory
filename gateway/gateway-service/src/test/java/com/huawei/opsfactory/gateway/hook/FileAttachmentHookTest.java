package com.huawei.opsfactory.gateway.hook;

import com.huawei.opsfactory.gateway.service.AgentConfigService;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import reactor.test.StepVerifier;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class FileAttachmentHookTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    private AgentConfigService agentConfigService;
    private FileAttachmentHook hook;
    private Path usersDir;

    @Before
    public void setUp() throws IOException {
        agentConfigService = mock(AgentConfigService.class);
        usersDir = tempFolder.getRoot().toPath().resolve("users");
        Files.createDirectories(usersDir);
        when(agentConfigService.getUsersDir()).thenReturn(usersDir);
        hook = new FileAttachmentHook(agentConfigService);
    }

    @Test
    public void testNoUserMessage_passthrough() {
        String body = "{\"other\": \"data\"}";
        HookContext ctx = new HookContext(body, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testNoContent_passthrough() {
        String body = "{\"user_message\": {\"text\": \"hello\"}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testNonArrayContent_passthrough() {
        String body = "{\"user_message\": {\"content\": \"plain text\"}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testNoFilePaths_passthrough() {
        String body = "{\"user_message\": {\"content\": [{\"type\": \"text\", \"text\": \"no paths here\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testValidFilePath_passthrough() throws IOException {
        // Create a valid file in the user's agent directory
        Path agentsDir = usersDir.resolve("user1").resolve("agents").resolve("agent1").resolve("uploads");
        Files.createDirectories(agentsDir);
        Path validFile = agentsDir.resolve("test.txt");
        Files.writeString(validFile, "content");

        String filePath = validFile.toAbsolutePath().normalize().toString();
        String body = "{\"user_message\": {\"content\": [{\"type\": \"text\", \"text\": \"See file " + filePath + "\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testPathTraversal_forbidden() throws IOException {
        // Create a file outside the user's directory
        Path otherUserDir = usersDir.resolve("otheruser").resolve("agents").resolve("agent1");
        Files.createDirectories(otherUserDir);
        Path otherFile = otherUserDir.resolve("secret.txt");
        Files.writeString(otherFile, "secret");

        // Attempt to reference a file outside the user's own directory via the users path
        String filePath = otherFile.toAbsolutePath().normalize().toString();
        String body = "{\"user_message\": {\"content\": [{\"type\": \"text\", \"text\": \"See " + filePath + "\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectErrorSatisfies(e -> {
                    assertTrue(e instanceof ResponseStatusException);
                    assertEquals(HttpStatus.FORBIDDEN, ((ResponseStatusException) e).getStatus());
                })
                .verify();
    }

    @Test
    public void testNonExistentFile_notFound() throws IOException {
        // Reference a file that doesn't exist within the valid user directory
        Path agentsDir = usersDir.resolve("user1").resolve("agents");
        Files.createDirectories(agentsDir);

        String filePath = agentsDir.resolve("agent1").resolve("nonexistent.txt")
                .toAbsolutePath().normalize().toString();
        String body = "{\"user_message\": {\"content\": [{\"type\": \"text\", \"text\": \"See " + filePath + "\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");

        StepVerifier.create(hook.process(ctx))
                .expectErrorSatisfies(e -> {
                    assertTrue(e instanceof ResponseStatusException);
                    assertEquals(HttpStatus.NOT_FOUND, ((ResponseStatusException) e).getStatus());
                })
                .verify();
    }

    @Test
    public void testNonTextContent_ignored() {
        // Image type content should be skipped
        String body = "{\"user_message\": {\"content\": [{\"type\": \"image\", \"data\": \"abc123\"}]}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testInvalidJson_passthrough() {
        HookContext ctx = new HookContext("not valid json", "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }

    @Test
    public void testEmptyContentArray_passthrough() {
        String body = "{\"user_message\": {\"content\": []}}";
        HookContext ctx = new HookContext(body, "agent1", "user1");
        StepVerifier.create(hook.process(ctx))
                .expectNext(ctx)
                .verifyComplete();
    }
}

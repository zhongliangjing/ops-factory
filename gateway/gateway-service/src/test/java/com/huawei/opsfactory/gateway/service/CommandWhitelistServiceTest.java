package com.huawei.opsfactory.gateway.service;

import com.huawei.opsfactory.gateway.config.GatewayProperties;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.nio.file.Path;
import java.util.*;

import static org.junit.Assert.*;

public class CommandWhitelistServiceTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    private CommandWhitelistService whitelistService;

    @Before
    public void setUp() {
        GatewayProperties properties = new GatewayProperties();
        GatewayProperties.Paths paths = new GatewayProperties.Paths();
        paths.setProjectRoot(tempFolder.getRoot().getAbsolutePath());
        properties.setPaths(paths);

        whitelistService = new CommandWhitelistService(properties);
        whitelistService.init();
    }

    // ── init (default initialization) ────────────────────────────

    @Test
    public void testInit_createsDefaultWhitelist() {
        // init() is called in setUp()
        Map<String, Object> whitelist = whitelistService.getWhitelist();
        assertNotNull(whitelist);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) whitelist.get("commands");
        assertNotNull(commands);
        assertFalse(commands.isEmpty());

        // Check that default commands are present
        Set<String> patterns = new HashSet<>();
        for (Map<String, Object> cmd : commands) {
            patterns.add((String) cmd.get("pattern"));
        }
        assertTrue(patterns.contains("ps"));
        assertTrue(patterns.contains("tail"));
        assertTrue(patterns.contains("grep"));
        assertTrue(patterns.contains("cat"));
        assertTrue(patterns.contains("ls"));
        assertTrue(patterns.contains("df"));
        assertTrue(patterns.contains("free"));
        assertTrue(patterns.contains("cd"));
    }

    // ── getWhitelist ─────────────────────────────────────────────

    @Test
    public void testGetWhitelist_returnsStructure() {
        Map<String, Object> whitelist = whitelistService.getWhitelist();
        assertTrue(whitelist.containsKey("commands"));
    }

    // ── addCommand ───────────────────────────────────────────────

    @Test
    public void testAddCommand_success() {
        Map<String, Object> cmd = new LinkedHashMap<>();
        cmd.put("pattern", "iostat");
        cmd.put("description", "查看IO统计");
        cmd.put("enabled", true);

        whitelistService.addCommand(cmd);

        Map<String, Object> whitelist = whitelistService.getWhitelist();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) whitelist.get("commands");
        boolean found = commands.stream().anyMatch(c -> "iostat".equals(c.get("pattern")));
        assertTrue(found);
    }

    @Test
    public void testAddCommand_multiple() {
        whitelistService.addCommand(Map.of("pattern", "cmd1", "enabled", true));
        whitelistService.addCommand(Map.of("pattern", "cmd2", "enabled", true));

        Map<String, Object> whitelist = whitelistService.getWhitelist();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) whitelist.get("commands");
        assertTrue(commands.stream().anyMatch(c -> "cmd1".equals(c.get("pattern"))));
        assertTrue(commands.stream().anyMatch(c -> "cmd2".equals(c.get("pattern"))));
    }

    // ── updateCommand ────────────────────────────────────────────

    @Test
    public void testUpdateCommand_success() {
        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("description", "updated description");
        updates.put("enabled", false);

        whitelistService.updateCommand("ps", updates);

        Map<String, Object> whitelist = whitelistService.getWhitelist();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) whitelist.get("commands");
        Map<String, Object> psCmd = commands.stream()
                .filter(c -> "ps".equals(c.get("pattern")))
                .findFirst().orElseThrow();
        assertEquals("updated description", psCmd.get("description"));
        assertEquals(false, psCmd.get("enabled"));
    }

    @Test
    public void testUpdateCommand_preservesPattern() {
        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("description", "new desc");

        whitelistService.updateCommand("tail", updates);

        Map<String, Object> whitelist = whitelistService.getWhitelist();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) whitelist.get("commands");
        boolean tailExists = commands.stream().anyMatch(c -> "tail".equals(c.get("pattern")));
        assertTrue(tailExists);
    }

    @Test(expected = IllegalArgumentException.class)
    public void testUpdateCommand_notFound() {
        Map<String, Object> updates = new LinkedHashMap<>();
        updates.put("description", "test");
        whitelistService.updateCommand("nonexistent_cmd", updates);
    }

    // ── deleteCommand ────────────────────────────────────────────

    @Test
    public void testDeleteCommand_success() {
        whitelistService.deleteCommand("ps");

        Map<String, Object> whitelist = whitelistService.getWhitelist();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) whitelist.get("commands");
        boolean psExists = commands.stream().anyMatch(c -> "ps".equals(c.get("pattern")));
        assertFalse(psExists);
    }

    @Test
    public void testDeleteCommand_reducesCount() {
        Map<String, Object> before = whitelistService.getWhitelist();
        @SuppressWarnings("unchecked")
        int countBefore = ((List<Map<String, Object>>) before.get("commands")).size();

        whitelistService.deleteCommand("grep");

        Map<String, Object> after = whitelistService.getWhitelist();
        @SuppressWarnings("unchecked")
        int countAfter = ((List<Map<String, Object>>) after.get("commands")).size();
        assertEquals(countBefore - 1, countAfter);
    }

    @Test(expected = IllegalArgumentException.class)
    public void testDeleteCommand_notFound() {
        whitelistService.deleteCommand("nonexistent_cmd");
    }

    // ── validateCommand ──────────────────────────────────────────

    @Test
    public void testValidateCommand_allAllowed() {
        List<String> rejected = whitelistService.validateCommand("ps -ef");
        assertTrue(rejected.isEmpty());
    }

    @Test
    public void testValidateCommand_pipeAllowed() {
        List<String> rejected = whitelistService.validateCommand("ps -ef|grep java|grep -v grep");
        assertTrue(rejected.isEmpty());
    }

    @Test
    public void testValidateCommand_semicolonAllowed() {
        List<String> rejected = whitelistService.validateCommand("cd /home;tail -n 50 log.txt");
        assertTrue(rejected.isEmpty());
    }

    @Test
    public void testValidateCommand_rejectedCommand() {
        List<String> rejected = whitelistService.validateCommand("rm -rf /");
        assertEquals(1, rejected.size());
        assertEquals("rm", rejected.get(0));
    }

    @Test
    public void testValidateCommand_mixedAllowedAndRejected() {
        List<String> rejected = whitelistService.validateCommand("ps -ef|reboot");
        assertEquals(1, rejected.size());
        assertEquals("reboot", rejected.get(0));
    }

    @Test
    public void testValidateCommand_disabledCommand() {
        // Disable 'ps' first
        whitelistService.updateCommand("ps", Map.of("enabled", false));

        List<String> rejected = whitelistService.validateCommand("ps -ef");
        assertEquals(1, rejected.size());
        assertEquals("ps", rejected.get(0));
    }

    @Test
    public void testValidateCommand_emptyString() {
        List<String> rejected = whitelistService.validateCommand("");
        assertTrue(rejected.isEmpty());
    }

    @Test
    public void testValidateCommand_complexPipe() {
        List<String> rejected = whitelistService.validateCommand(
                "cd /home/rcpa/logs/stat;tail -n 50 pool.log|grep -v timeout");
        assertTrue(rejected.isEmpty());
    }

    @Test
    public void testValidateCommand_multipleRejected() {
        List<String> rejected = whitelistService.validateCommand("rm -rf /;reboot;shutdown now");
        assertEquals(3, rejected.size());
        assertTrue(rejected.contains("rm"));
        assertTrue(rejected.contains("reboot"));
        assertTrue(rejected.contains("shutdown"));
    }
}

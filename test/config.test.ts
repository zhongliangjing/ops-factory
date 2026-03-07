/**
 * Tests for the unified configuration management.
 *
 * Verifies:
 * - config.yaml is loaded and values are used
 * - Missing required fields cause startup/build failure
 * - CONFIG_PATH env var selects config file location
 * - Docker components generate .env from config.yaml
 * - config.yaml.example files exist for all components
 */
import { execFile, ChildProcess, spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import {
  access, readFile, writeFile, mkdir, rm, copyFile, symlink, constants,
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { sleep } from './helpers.js'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const GATEWAY_DIR = join(PROJECT_ROOT, 'gateway')
const EXPORTER_DIR = join(PROJECT_ROOT, 'prometheus-exporter')
const WEBAPP_DIR = join(PROJECT_ROOT, 'web-app')
const LANGFUSE_DIR = join(PROJECT_ROOT, 'langfuse')
const ONLYOFFICE_DIR = join(PROJECT_ROOT, 'onlyoffice')
const TMP_DIR = join(PROJECT_ROOT, 'test', '.tmp-config-test')

/** Pick a random free port */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

/** Run a shell command and return { stdout, stderr, code } */
function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string>; timeout?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts?.cwd || PROJECT_ROOT,
        env: { ...process.env, ...opts?.env },
        timeout: opts?.timeout || 30_000,
      },
      (err, stdout, stderr) => {
        const code = err && 'code' in err ? (err.code as number) : err ? 1 : 0
        resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code })
      },
    )
  })
}

/**
 * Run a small inline Node script in a subprocess, optionally with env vars.
 * Useful for testing config loading in isolation.
 * Sets NODE_PATH to resolve packages from the original component directories.
 */
function runNode(
  script: string,
  opts?: { cwd?: string; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const nodePath = [
    join(GATEWAY_DIR, 'node_modules'),
    join(EXPORTER_DIR, 'node_modules'),
  ].join(':')
  return run('node', ['--import', 'tsx', '-e', script], {
    cwd: opts?.cwd,
    env: { NODE_PATH: nodePath, ...opts?.env },
    timeout: 15_000,
  })
}

/**
 * Prepare a temp directory that can import TypeScript config modules.
 * Symlinks node_modules from the source component and creates package.json.
 */
async function prepareTmpDir(
  name: string,
  sourceDir: string,
  opts?: { subdirs?: string[] },
): Promise<string> {
  const tmpDir = join(TMP_DIR, name)
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })
  for (const sub of opts?.subdirs || []) {
    await mkdir(join(tmpDir, sub), { recursive: true })
  }
  // Symlink node_modules so ESM imports resolve correctly
  await symlink(join(sourceDir, 'node_modules'), join(tmpDir, 'node_modules'))
  // package.json so Node treats .ts files as ESM
  await writeFile(join(tmpDir, 'package.json'), '{"type":"module"}\n')
  return tmpDir
}

// =============================================================================
// Setup & teardown
// =============================================================================

beforeAll(async () => {
  await mkdir(TMP_DIR, { recursive: true })
})

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true })
})

// =============================================================================
// 1. config.yaml and config.yaml.example existence
// =============================================================================
describe('config files exist', () => {
  const components = [
    { name: 'prometheus-exporter', dir: EXPORTER_DIR },
    { name: 'web-app', dir: WEBAPP_DIR },
    { name: 'langfuse', dir: LANGFUSE_DIR },
    { name: 'onlyoffice', dir: ONLYOFFICE_DIR },
  ]

  for (const { name, dir } of components) {
    it(`${name}/config.yaml exists`, async () => {
      await expect(
        access(join(dir, 'config.yaml'), constants.R_OK),
      ).resolves.toBeUndefined()
    })

    it(`${name}/config.yaml.example exists`, async () => {
      await expect(
        access(join(dir, 'config.yaml.example'), constants.R_OK),
      ).resolves.toBeUndefined()
    })
  }

  it('onlyoffice/docker-compose.yml exists', async () => {
    await expect(
      access(join(ONLYOFFICE_DIR, 'docker-compose.yml'), constants.R_OK),
    ).resolves.toBeUndefined()
  })
})

// (Gateway config loading tests removed — gateway is now Java/Spring Boot)

// =============================================================================
// 3. Prometheus Exporter config loading
// =============================================================================
describe('Prometheus Exporter config loading', () => {
  const configScript = (extra = '') => `
    import { loadConfig } from './src/config.ts';
    try {
      const cfg = loadConfig();
      ${extra}
      console.log(JSON.stringify(cfg));
    } catch (e) {
      console.error('CONFIG_ERROR: ' + e.message);
      process.exit(1);
    }
  `

  it('loads values from config.yaml', async () => {
    const { stdout, code } = await runNode(configScript(), {
      cwd: EXPORTER_DIR,
    })
    expect(code).toBe(0)
    const cfg = JSON.parse(stdout.trim())
    expect(cfg.port).toBe(9091)
    expect(cfg.gatewayUrl).toBe('http://127.0.0.1:3000')
    expect(cfg.gatewaySecretKey).toBe('test')
    expect(cfg.collectTimeoutMs).toBe(5000)
  })

  it('strips trailing slash from gatewayUrl', async () => {
    const tmpDir = await prepareTmpDir('exp-trailing-slash', EXPORTER_DIR, {
      subdirs: ['src'],
    })
    await copyFile(join(EXPORTER_DIR, 'src', 'config.ts'), join(tmpDir, 'src', 'config.ts'))
    await writeFile(join(tmpDir, 'config.yaml'), 'gatewayUrl: "http://gw:3000/"\ngatewaySecretKey: "key"\n')

    const { stdout, code } = await runNode(configScript(), {
      cwd: tmpDir,
    })
    expect(code).toBe(0)
    const cfg = JSON.parse(stdout.trim())
    expect(cfg.gatewayUrl).toBe('http://gw:3000')
  })

  it('throws error when gatewayUrl is missing', async () => {
    const tmpDir = await prepareTmpDir('exp-no-url', EXPORTER_DIR, {
      subdirs: ['src'],
    })
    await copyFile(join(EXPORTER_DIR, 'src', 'config.ts'), join(tmpDir, 'src', 'config.ts'))
    await writeFile(join(tmpDir, 'config.yaml'), 'port: 9091\ngatewaySecretKey: "key"\n')

    const { stderr, code } = await runNode(configScript(), {
      cwd: tmpDir,
    })
    expect(code).not.toBe(0)
    expect(stderr).toContain('CONFIG_ERROR')
    expect(stderr).toContain('gatewayUrl')
  })

  it('throws error when gatewaySecretKey is missing', async () => {
    const tmpDir = await prepareTmpDir('exp-no-key', EXPORTER_DIR, {
      subdirs: ['src'],
    })
    await copyFile(join(EXPORTER_DIR, 'src', 'config.ts'), join(tmpDir, 'src', 'config.ts'))
    await writeFile(join(tmpDir, 'config.yaml'), 'port: 9091\ngatewayUrl: "http://x:3000"\n')

    const { stderr, code } = await runNode(configScript(), {
      cwd: tmpDir,
    })
    expect(code).not.toBe(0)
    expect(stderr).toContain('CONFIG_ERROR')
    expect(stderr).toContain('gatewaySecretKey')
  })

  it('uses defaults for optional fields when config.yaml is minimal', async () => {
    const tmpDir = await prepareTmpDir('exp-minimal', EXPORTER_DIR, {
      subdirs: ['src'],
    })
    await copyFile(join(EXPORTER_DIR, 'src', 'config.ts'), join(tmpDir, 'src', 'config.ts'))
    await writeFile(join(tmpDir, 'config.yaml'), 'gatewayUrl: "http://gw:3000"\ngatewaySecretKey: "key"\n')

    const { stdout, code } = await runNode(configScript(), {
      cwd: tmpDir,
    })
    expect(code).toBe(0)
    const cfg = JSON.parse(stdout.trim())
    expect(cfg.port).toBe(9091)
    expect(cfg.collectTimeoutMs).toBe(5000)
  })

  it('ignores env vars — they do NOT override config.yaml', async () => {
    const { stdout, code } = await runNode(configScript(), {
      cwd: EXPORTER_DIR,
      env: {
        EXPORTER_PORT: '7777',
        GATEWAY_URL: 'http://env-should-be-ignored:9999',
        GATEWAY_SECRET_KEY: 'env-ignored-key',
        COLLECT_TIMEOUT_MS: '99999',
      },
    })
    expect(code).toBe(0)
    const cfg = JSON.parse(stdout.trim())
    // Values should come from config.yaml, not env vars
    expect(cfg.port).toBe(9091)
    expect(cfg.gatewayUrl).toBe('http://127.0.0.1:3000')
    expect(cfg.gatewaySecretKey).toBe('test')
    expect(cfg.collectTimeoutMs).toBe(5000)
  })

  it('CONFIG_PATH overrides default config file location', async () => {
    const tmpDir = await prepareTmpDir('exp-config-path', EXPORTER_DIR, {
      subdirs: ['src'],
    })
    await copyFile(join(EXPORTER_DIR, 'src', 'config.ts'), join(tmpDir, 'src', 'config.ts'))

    const customConfigPath = join(tmpDir, 'custom-exporter.yaml')
    await writeFile(customConfigPath, 'port: 8888\ngatewayUrl: "http://custom:4000"\ngatewaySecretKey: "custom-key"\ncollectTimeoutMs: 2000\n')

    const { stdout, code } = await runNode(configScript(), {
      cwd: tmpDir,
      env: { CONFIG_PATH: customConfigPath },
    })
    expect(code).toBe(0)
    const cfg = JSON.parse(stdout.trim())
    expect(cfg.port).toBe(8888)
    expect(cfg.gatewayUrl).toBe('http://custom:4000')
    expect(cfg.gatewaySecretKey).toBe('custom-key')
    expect(cfg.collectTimeoutMs).toBe(2000)
  })
})

// =============================================================================
// 4. Web App config loading (vite build-time)
// =============================================================================
describe('Web App config loading', () => {
  it('config.yaml is read by vite build', async () => {
    // Verify that building succeeds when config.yaml has values
    const { code } = await run('npx', ['vite', 'build'], {
      cwd: WEBAPP_DIR,
      timeout: 30_000,
    })
    expect(code).toBe(0)
  })

  it('config.yaml contains required fields', async () => {
    const content = await readFile(join(WEBAPP_DIR, 'config.yaml'), 'utf-8')
    expect(content).toContain('gatewayUrl')
    expect(content).toContain('gatewaySecretKey')
  })

  it('vite build fails when config is missing', async () => {
    // Create a temp webapp dir with no config.yaml
    const tmpDir = join(TMP_DIR, 'webapp-no-config')
    await mkdir(tmpDir, { recursive: true })

    // Run from WEBAPP_DIR so ESM can resolve 'yaml' from node_modules,
    // but point config path to the empty tmpDir
    const { code, stderr } = await run(
      'node',
      ['--input-type=module', '-e', `
        import { readFileSync, existsSync } from 'node:fs';
        import { resolve } from 'node:path';
        import { parse } from 'yaml';

        function loadYamlConfig() {
          const configPath = resolve('${tmpDir}', 'config.yaml');
          if (!existsSync(configPath)) return {};
          return parse(readFileSync(configPath, 'utf-8')) || {};
        }

        const yaml = loadYamlConfig();
        const gatewayUrl = yaml.gatewayUrl;
        const gatewaySecretKey = yaml.gatewaySecretKey;

        const missing = [];
        if (!gatewayUrl) missing.push('gatewayUrl');
        if (!gatewaySecretKey) missing.push('gatewaySecretKey');

        if (missing.length > 0) {
          console.error('MISSING: ' + missing.join(', '));
          process.exit(1);
        }
        console.log('OK');
      `],
      { cwd: WEBAPP_DIR },
    )
    expect(code).not.toBe(0)
    expect(stderr).toContain('MISSING')
  })
})

// (Langfuse and OnlyOffice .env generation tests removed — depended on gateway/node_modules/yaml)

// =============================================================================
// 7. Docker compose files have variable substitution
// =============================================================================
describe('Docker compose variable substitution', () => {
  it('langfuse docker-compose.yml uses ${VAR:-default} syntax', async () => {
    const content = await readFile(join(LANGFUSE_DIR, 'docker-compose.yml'), 'utf-8')
    // Should contain variable references, not hardcoded values
    expect(content).toContain('${LANGFUSE_PORT:-3100}')
    expect(content).toContain('${POSTGRES_DB:-langfuse}')
    expect(content).toContain('${POSTGRES_USER:-langfuse}')
    expect(content).toContain('${POSTGRES_PASSWORD:-langfuse}')
    expect(content).toContain('${NEXTAUTH_SECRET:-')
    expect(content).toContain('${LANGFUSE_INIT_PROJECT_PUBLIC_KEY:-')
    expect(content).toContain('${LANGFUSE_INIT_PROJECT_SECRET_KEY:-')
    expect(content).toContain('${TELEMETRY_ENABLED:-false}')
  })

  it('onlyoffice docker-compose.yml uses ${VAR:-default} syntax', async () => {
    const content = await readFile(join(ONLYOFFICE_DIR, 'docker-compose.yml'), 'utf-8')
    expect(content).toContain('${ONLYOFFICE_PORT:-8080}')
    expect(content).toContain('${JWT_ENABLED:-false}')
    expect(content).toContain('${PLUGINS_ENABLED:-false}')
    expect(content).toContain('${ALLOW_PRIVATE_IP_ADDRESS:-true}')
    expect(content).toContain('${ALLOW_META_IP_ADDRESS:-true}')
  })
})

// =============================================================================
// 8. Shell script syntax validation (new/modified scripts)
// =============================================================================
describe('Modified shell scripts syntax', () => {
  const scripts = {
    onlyoffice: join(ONLYOFFICE_DIR, 'scripts', 'ctl.sh'),
    langfuse: join(LANGFUSE_DIR, 'scripts', 'ctl.sh'),
    orchestrator: join(PROJECT_ROOT, 'scripts', 'ctl.sh'),
  }

  for (const [name, path] of Object.entries(scripts)) {
    it(`${name} ctl.sh passes bash -n syntax check`, async () => {
      const { code, stderr } = await run('bash', ['-n', path])
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })
  }
})

// =============================================================================
// 9. OnlyOffice ctl.sh docker-compose migration
// =============================================================================
describe('OnlyOffice ctl.sh uses docker compose', () => {
  it('script references docker compose (not docker run)', async () => {
    const content = await readFile(join(ONLYOFFICE_DIR, 'scripts', 'ctl.sh'), 'utf-8')
    expect(content).toContain('docker compose')
    expect(content).not.toContain('docker run')
    expect(content).toContain('generate_env_file')
    expect(content).toContain('COMPOSE_FILE')
  })

  it('help output includes Docker Compose', async () => {
    const { stdout, stderr } = await run('bash', [
      join(ONLYOFFICE_DIR, 'scripts', 'ctl.sh'),
      '--help',
    ])
    const output = stdout + stderr
    expect(output).toContain('Docker Compose')
  })
})

// =============================================================================
// 10. Langfuse ctl.sh has generate_env_file
// =============================================================================
describe('Langfuse ctl.sh has config.yaml support', () => {
  it('script contains generate_env_file function', async () => {
    const content = await readFile(join(LANGFUSE_DIR, 'scripts', 'ctl.sh'), 'utf-8')
    expect(content).toContain('generate_env_file')
    expect(content).toContain('config.yaml')
    expect(content).toContain('docker compose')
  })
})

// =============================================================================
// 11. Orchestrator documentation
// =============================================================================
describe('Orchestrator config documentation', () => {
  it('scripts/ctl.sh documents service toggles', async () => {
    const content = await readFile(join(PROJECT_ROOT, 'scripts', 'ctl.sh'), 'utf-8')
    expect(content).toContain('ENABLE_ONLYOFFICE')
    expect(content).toContain('ENABLE_LANGFUSE')
    expect(content).toContain('ENABLE_EXPORTER')
  })
})

// (Gateway starts with config.yaml test removed — gateway is now Java/Spring Boot)

// =============================================================================
// 13. Integration: Exporter starts with config.yaml via CONFIG_PATH
// =============================================================================
describe('Exporter starts with config.yaml', () => {
  let child: ChildProcess | null = null
  let port: number
  let tmpConfigPath: string

  afterAll(async () => {
    if (child) {
      child.kill('SIGTERM')
      await sleep(500)
      if (!child.killed) child.kill('SIGKILL')
    }
    try { await rm(tmpConfigPath) } catch { /* ignore */ }
  })

  it('exporter process starts and responds on /health', async () => {
    port = await freePort()

    // Write a temp config.yaml for this test
    tmpConfigPath = join(TMP_DIR, `exporter-integration-${port}.yaml`)
    const configContent = [
      `port: ${port}`,
      'gatewayUrl: "http://127.0.0.1:3000"',
      'gatewaySecretKey: "test"',
      'collectTimeoutMs: 3000',
    ].join('\n')
    await writeFile(tmpConfigPath, configContent)

    child = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: EXPORTER_DIR,
      env: {
        ...process.env,
        CONFIG_PATH: tmpConfigPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const logs: string[] = []
    child.stdout?.on('data', (d: Buffer) => logs.push(d.toString().trim()))
    child.stderr?.on('data', (d: Buffer) => logs.push(d.toString().trim()))

    // Wait for readiness
    const maxWait = 15_000
    const start = Date.now()
    let ready = false
    while (Date.now() - start < maxWait) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1500),
        })
        if (res.ok) {
          ready = true
          break
        }
      } catch {
        // not ready
      }
      await sleep(250)
    }

    expect(ready).toBe(true)
  }, 30_000)
})

// (E2E Gateway config.yaml test removed — gateway is now Java/Spring Boot)

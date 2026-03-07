/**
 * Tests for the refactored service control scripts.
 *
 * These tests verify:
 * - Script syntax validity (bash -n)
 * - Help/usage output
 * - Status reporting when services are not running
 * - Graceful shutdown when nothing is running
 * - Orchestrator delegates to sub-scripts correctly
 * - Service toggle flags (ENABLE_ONLYOFFICE, ENABLE_LANGFUSE, ENABLE_EXPORTER)
 * - gateway/goosed symlink existence
 */
import { execFile } from 'node:child_process'
import { resolve, join } from 'node:path'
import { access, constants } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')

const SCRIPTS = {
  orchestrator: join(PROJECT_ROOT, 'scripts', 'ctl.sh'),
  gateway: join(PROJECT_ROOT, 'gateway', 'scripts', 'ctl.sh'),
  webapp: join(PROJECT_ROOT, 'web-app', 'scripts', 'ctl.sh'),
  langfuse: join(PROJECT_ROOT, 'langfuse', 'scripts', 'ctl.sh'),
  onlyoffice: join(PROJECT_ROOT, 'onlyoffice', 'scripts', 'ctl.sh'),
  exporter: join(PROJECT_ROOT, 'prometheus-exporter', 'scripts', 'ctl.sh'),
} as const

type ScriptName = keyof typeof SCRIPTS

/** Run a shell command and return { stdout, stderr, code } */
function run(
  cmd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, ...env },
        timeout: 15_000,
      },
      (err, stdout, stderr) => {
        const code = err && 'code' in err ? (err.code as number) : err ? 1 : 0
        resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code })
      },
    )
  })
}

/** Run a ctl.sh script with given args */
function runCtl(
  name: ScriptName,
  args: string[],
  env?: Record<string, string>,
) {
  return run('bash', [SCRIPTS[name], ...args], env)
}

// =============================================================================
// 1. Script existence and permissions
// =============================================================================
describe('script files', () => {
  for (const [name, path] of Object.entries(SCRIPTS)) {
    it(`${name} script exists and is executable`, async () => {
      await expect(
        access(path, constants.X_OK),
      ).resolves.toBeUndefined()
    })
  }
})

// =============================================================================
// 2. Syntax validation (bash -n)
// =============================================================================
describe('syntax validation', () => {
  for (const [name, path] of Object.entries(SCRIPTS)) {
    it(`${name} passes bash -n`, async () => {
      const { code, stderr } = await run('bash', ['-n', path])
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })
  }
})

// =============================================================================
// 3. Help / usage output
// =============================================================================
describe('help output', () => {
  for (const [name] of Object.entries(SCRIPTS)) {
    it(`${name} --help shows usage`, async () => {
      const { stdout, stderr, code } = await runCtl(
        name as ScriptName,
        ['--help'],
      )
      const output = stdout + stderr
      expect(code).toBe(1) // usage exits with 1
      expect(output).toContain('Usage:')
      expect(output).toContain('startup')
      expect(output).toContain('shutdown')
      expect(output).toContain('status')
      expect(output).toContain('restart')
    })
  }

  it('orchestrator help lists components', async () => {
    const { stdout, stderr } = await runCtl('orchestrator', ['--help'])
    const output = stdout + stderr
    expect(output).toContain('gateway')
    expect(output).toContain('webapp')
    expect(output).toContain('langfuse')
    expect(output).toContain('onlyoffice')
    expect(output).toContain('exporter')
  })

  it('orchestrator help lists service toggles', async () => {
    const { stdout, stderr } = await runCtl('orchestrator', ['--help'])
    const output = stdout + stderr
    expect(output).toContain('ENABLE_ONLYOFFICE')
    expect(output).toContain('ENABLE_LANGFUSE')
    expect(output).toContain('ENABLE_EXPORTER')
  })
})

// =============================================================================
// 4. Unknown action handling
// =============================================================================
describe('unknown action', () => {
  for (const [name] of Object.entries(SCRIPTS)) {
    it(`${name} rejects unknown action`, async () => {
      const { stdout, stderr, code } = await runCtl(
        name as ScriptName,
        ['bogus'],
      )
      const output = stdout + stderr
      expect(code).not.toBe(0)
      expect(output).toMatch(/[Uu]nknown action|Usage:/)
    })
  }
})

// =============================================================================
// 5. No-args shows usage
// =============================================================================
describe('no args', () => {
  for (const [name] of Object.entries(SCRIPTS)) {
    it(`${name} with no args shows usage`, async () => {
      const { stdout, stderr, code } = await runCtl(
        name as ScriptName,
        [],
      )
      const output = stdout + stderr
      expect(code).toBe(1)
      expect(output).toContain('Usage:')
    })
  }
})

// =============================================================================
// 6. Status when services are not running
// =============================================================================
describe('status when not running', () => {
  // Scripts now read port from their own config.yaml
  // These tests work as long as the real services aren't running during test execution

  it('gateway status reports not running', async () => {
    const { stdout, stderr, code } = await runCtl('gateway', ['status'])
    const output = stdout + stderr
    expect(code).not.toBe(0)
    expect(output).toMatch(/not running|FAIL/)
  })

  it('webapp status reports not running', async () => {
    const { stdout, stderr, code } = await runCtl('webapp', ['status'])
    const output = stdout + stderr
    expect(code).not.toBe(0)
    expect(output).toMatch(/not running|FAIL/)
  })

  it('exporter status reports not running', async () => {
    const { stdout, stderr, code } = await runCtl('exporter', ['status'])
    const output = stdout + stderr
    expect(code).not.toBe(0)
    expect(output).toMatch(/not running|FAIL/)
  })
})

// =============================================================================
// 7. Shutdown when nothing is running (should be graceful)
// =============================================================================
describe('shutdown when nothing running', () => {
  it('gateway shutdown is graceful', async () => {
    const { code } = await runCtl('gateway', ['shutdown'])
    expect(code).toBe(0)
  })

  it('webapp shutdown is graceful', async () => {
    const { code } = await runCtl('webapp', ['shutdown'])
    expect(code).toBe(0)
  })

  it('exporter shutdown is graceful', async () => {
    const { code } = await runCtl('exporter', ['shutdown'])
    expect(code).toBe(0)
  })
})

// =============================================================================
// 8. Orchestrator unknown component
// =============================================================================
describe('orchestrator component routing', () => {
  it('rejects unknown component', async () => {
    const { stdout, stderr, code } = await runCtl('orchestrator', [
      'startup',
      'nonexistent',
    ])
    const output = stdout + stderr
    expect(code).not.toBe(0)
    expect(output).toContain('Usage:')
  })

  it('status for single component works', async () => {
    const { stdout, stderr, code } = await runCtl(
      'orchestrator',
      ['status', 'gateway'],
    )
    const output = stdout + stderr
    // Should fail (not running) but not crash
    expect(code).not.toBe(0)
    expect(output).toMatch(/not running|FAIL/)
  })
})

// =============================================================================
// 9. Service toggles
// =============================================================================
describe('service toggles', () => {
  it('status all skips disabled onlyoffice', async () => {
    const { stdout, stderr } = await runCtl('orchestrator', ['status'], {
      ENABLE_ONLYOFFICE: 'false',
      ENABLE_LANGFUSE: 'false',
      ENABLE_EXPORTER: 'false',
    })
    const output = stdout + stderr
    // Should NOT contain onlyoffice/langfuse/exporter status lines
    expect(output).not.toMatch(/OnlyOffice running/)
    expect(output).not.toMatch(/Langfuse running/)
    expect(output).not.toMatch(/Exporter running/)
    // But should still check gateway and webapp
    expect(output).toMatch(/[Gg]ateway/)
    expect(output).toMatch(/[Ww]ebapp/)
  })
})

// (gateway/goosed symlink tests removed — gateway is now Java/Spring Boot)

// =============================================================================
// 11. Sub-script --background flag parsing
// =============================================================================
describe('--background flag parsing', () => {
  // We can't actually start services here, but we can verify that
  // scripts that support --background accept it without syntax errors
  // by checking help output still works with the flag
  for (const name of ['gateway', 'webapp', 'exporter'] as const) {
    it(`${name} accepts --background flag`, async () => {
      const { stdout, stderr, code } = await runCtl(name, ['--help', '--background'])
      const output = stdout + stderr
      // help exits 1 but should not crash
      expect(code).toBe(1)
      expect(output).toContain('Usage:')
    })
  }
})

// (gateway .gitignore test removed — gateway is now Java/Spring Boot)

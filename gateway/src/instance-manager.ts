import net from 'node:net'
import { ChildProcess, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AgentConfig, GatewayConfig } from './config.js'

/** The system user whose instances are pre-started and never reaped. */
export const SYSTEM_USER = 'sys'

interface ManagedInstance {
  agentId: string
  userId: string
  port: number
  child: ChildProcess | null
  status: 'starting' | 'running' | 'stopped' | 'error'
  lastActivity: number
  runtimeRoot: string // GOOSE_PATH_ROOT = CWD
}

function instanceKey(agentId: string, userId: string): string {
  return `${agentId}:${userId}`
}

export class InstanceManager {
  private instances = new Map<string, ManagedInstance>()
  private spawnLocks = new Map<string, Promise<ManagedInstance>>()
  private warmingUsers = new Set<string>() // Track users being warmed up
  private config: GatewayConfig
  private idleTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: GatewayConfig) {
    this.config = config
  }

  // ===================== Core lifecycle =====================

  /**
   * Get a running instance for (agentId, userId), or spawn one.
   * Also triggers background warm-up of all other agents for this user.
   * Returns the upstream target URL (e.g. http://127.0.0.1:54321).
   */
  async getOrSpawn(agentId: string, userId: string): Promise<string> {
    const key = instanceKey(agentId, userId)
    const existing = this.instances.get(key)
    if (existing && existing.status === 'running' && existing.child) {
      existing.lastActivity = Date.now()
      // Also touch all other instances for this user to keep them alive together
      this.touchUserInstances(userId)
      return `http://${this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host}:${existing.port}`
    }

    // Use spawn lock to prevent concurrent spawns for the same key
    let pending = this.spawnLocks.get(key)
    if (pending) {
      const inst = await pending
      return `http://${this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host}:${inst.port}`
    }

    const promise = this.spawnForUser(agentId, userId)
    this.spawnLocks.set(key, promise)
    try {
      const inst = await promise
      // Warm up all other agents for this user in the background
      if (userId !== SYSTEM_USER) {
        this.warmUpUserInstances(userId, agentId)
      }
      return `http://${this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host}:${inst.port}`
    } finally {
      this.spawnLocks.delete(key)
    }
  }

  /** Get or spawn the sys instance for agent-level operations (schedules, MCP, catch-all proxy). */
  async getSystemInstance(agentId: string): Promise<string> {
    return this.getOrSpawn(agentId, SYSTEM_USER)
  }

  /**
   * Pre-start sys instances for all configured agents.
   * Called at gateway startup so sys user is always ready.
   */
  async startAllForSystemUser(): Promise<void> {
    console.log(`[startup] Pre-starting sys instances for ${this.config.agents.length} agent(s)...`)
    const results = await Promise.allSettled(
      this.config.agents.map(a => this.getOrSpawn(a.id, SYSTEM_USER))
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      console.warn(`[startup] ${failed}/${this.config.agents.length} sys instance(s) failed to start`)
    } else {
      console.log(`[startup] All sys instances ready`)
    }
  }

  /** Get target URL for an existing running instance (no spawn). Returns null if not running. */
  getTarget(agentId: string, userId: string): string | null {
    const key = instanceKey(agentId, userId)
    const inst = this.instances.get(key)
    if (!inst || inst.status !== 'running') return null
    const host = this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host
    return `http://${host}:${inst.port}`
  }

  // ===================== Per-user warm-up =====================

  /**
   * Background warm-up: spawn all remaining agents for this user.
   * Called after the first agent instance is created for a user.
   */
  private warmUpUserInstances(userId: string, excludeAgentId: string): void {
    if (this.warmingUsers.has(userId)) return // Already warming
    this.warmingUsers.add(userId)

    const otherAgents = this.config.agents.filter(a => a.id !== excludeAgentId)
    if (otherAgents.length === 0) {
      this.warmingUsers.delete(userId)
      return
    }

    console.log(`[warm-up] Pre-warming ${otherAgents.length} agent(s) for user ${userId}`)

    // Fire-and-forget: spawn other agents in the background
    Promise.allSettled(
      otherAgents.map(agent => this.getOrSpawn(agent.id, userId))
    ).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) {
        console.warn(`[warm-up] ${failed}/${otherAgents.length} agent(s) failed to warm up for user ${userId}`)
      } else {
        console.log(`[warm-up] All agents ready for user ${userId}`)
      }
      this.warmingUsers.delete(userId)
    })
  }

  /**
   * Touch all running instances for a user to prevent idle reaping.
   * When a user is active on any agent, all their agents stay alive.
   */
  private touchUserInstances(userId: string): void {
    const now = Date.now()
    for (const inst of this.instances.values()) {
      if (inst.userId === userId && inst.status === 'running') {
        inst.lastActivity = now
      }
    }
  }

  // ===================== User runtime setup =====================

  /**
   * Prepare per-user runtime directory:
   *   users/{userId}/agents/{agentId}/
   *     config -> ../../../../agents/{agentId}/config   (symlink)
   *     AGENTS.md -> ../../../../agents/{agentId}/AGENTS.md  (symlink)
   * Returns the absolute path of the user root (= GOOSE_PATH_ROOT = CWD).
   */
  async prepareUserRuntime(agentId: string, userId: string): Promise<string> {
    const userAgentRoot = join(this.config.usersDir, userId, 'agents', agentId)
    await mkdir(userAgentRoot, { recursive: true })

    // Symlink config -> ../../../../agents/{agentId}/config
    const configLink = join(userAgentRoot, 'config')
    if (!existsSync(configLink)) {
      const configTarget = join('..', '..', '..', '..', 'agents', agentId, 'config')
      symlinkSync(configTarget, configLink)
    }

    // Symlink AGENTS.md -> ../../../../agents/{agentId}/AGENTS.md
    const agentsMdLink = join(userAgentRoot, 'AGENTS.md')
    const agentsMdSource = join(this.getAgentRootPath(agentId), 'AGENTS.md')
    if (!existsSync(agentsMdLink) && existsSync(agentsMdSource)) {
      const agentsMdTarget = join('..', '..', '..', '..', 'agents', agentId, 'AGENTS.md')
      symlinkSync(agentsMdTarget, agentsMdLink)
    }

    return userAgentRoot
  }

  // ===================== Port allocation =====================

  /** Allocate a free port from the OS (same pattern as goose desktop app). */
  async allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo
        const port = addr.port
        server.close(() => resolve(port))
      })
      server.on('error', reject)
    })
  }

  // ===================== Spawn =====================

  private async spawnForUser(agentId: string, userId: string): Promise<ManagedInstance> {
    const agentConfig = this.findAgentConfig(agentId)
    if (!agentConfig) {
      throw new Error(`Agent '${agentId}' not found in configuration`)
    }

    console.log(`[instance] Starting ${agentId}:${userId}...`)

    const userRoot = await this.prepareUserRuntime(agentId, userId)
    const port = await this.allocatePort()

    // Build environment
    const agentConfigEnv = this.getAgentConfigEnv(agentId)
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...agentConfigEnv,
      GOOSE_PORT: String(port),
      GOOSE_HOST: agentConfig.host,
      GOOSE_SERVER__SECRET_KEY: agentConfig.secret_key,
      GOOSE_PATH_ROOT: userRoot,
      GOOSE_DISABLE_KEYRING: '1',
    }

    const child = spawn(this.config.goosedBin, ['agent'], {
      env,
      cwd: userRoot, // CWD = GOOSE_PATH_ROOT = user directory
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const key = instanceKey(agentId, userId)
    const inst: ManagedInstance = {
      agentId,
      userId,
      port,
      child,
      status: 'starting',
      lastActivity: Date.now(),
      runtimeRoot: userRoot,
    }
    this.instances.set(key, inst)

    child.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) console.log(`[${agentId}:${userId}] ${line}`)
    })

    child.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) console.error(`[${agentId}:${userId}] ${line}`)
    })

    child.on('exit', (code) => {
      console.log(`[${agentId}:${userId}] exited with code ${code}`)
      inst.status = code === 0 ? 'stopped' : 'error'
      inst.child = null
    })

    // Wait for goosed to be ready
    await this.waitForReady(port, agentConfig)
    inst.status = 'running'
    console.log(`[${agentId}:${userId}] ready on port ${port}`)
    return inst
  }

  private async waitForReady(port: number, agentConfig: AgentConfig): Promise<void> {
    const host = agentConfig.host === '0.0.0.0' ? '127.0.0.1' : agentConfig.host
    const url = `http://${host}:${port}/status`
    const maxAttempts = 30

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(url, {
          headers: { 'x-secret-key': agentConfig.secret_key },
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) return
      } catch {
        // not ready yet
      }
      await new Promise(r => setTimeout(r, 500))
    }

    throw new Error(`Instance on port ${port} failed to become ready`)
  }

  // ===================== Idle reaper =====================

  startIdleReaper(intervalMs: number, maxIdleMs: number): void {
    this.idleTimer = setInterval(() => {
      const now = Date.now()
      for (const [key, inst] of this.instances) {
        // Never reap sys instances
        if (inst.userId === SYSTEM_USER) continue
        if (inst.status !== 'running') continue
        if (now - inst.lastActivity > maxIdleMs) {
          console.log(`[idle-reaper] Stopping idle instance ${key} (idle ${Math.round((now - inst.lastActivity) / 1000)}s)`)
          this.stopInstance(key).catch(err =>
            console.error(`[idle-reaper] Error stopping ${key}:`, err)
          )
        }
      }
    }, intervalMs)
  }

  // ===================== Stop =====================

  async stopInstance(key: string): Promise<void> {
    const inst = this.instances.get(key)
    if (!inst || !inst.child) return

    inst.child.kill('SIGTERM')
    inst.status = 'stopped'

    // Wait briefly for graceful shutdown
    await new Promise(r => setTimeout(r, 1000))

    // Force kill if still alive
    if (inst.child && !inst.child.killed) {
      inst.child.kill('SIGKILL')
    }
    inst.child = null
    this.instances.delete(key)
  }

  async stopAll(): Promise<void> {
    const keys = [...this.instances.keys()]
    await Promise.allSettled(keys.map(key => this.stopInstance(key)))
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  // ===================== Instance queries =====================

  /** Get all running instances for a given agent (for MCP fanout). */
  getRunningInstancesForAgent(agentId: string): ManagedInstance[] {
    const result: ManagedInstance[] = []
    for (const inst of this.instances.values()) {
      if (inst.agentId === agentId && inst.status === 'running') {
        result.push(inst)
      }
    }
    return result
  }

  /** Get all running instances for a given user across all agents. */
  getRunningInstancesForUser(userId: string): ManagedInstance[] {
    const result: ManagedInstance[] = []
    for (const inst of this.instances.values()) {
      if (inst.userId === userId && inst.status === 'running') {
        result.push(inst)
      }
    }
    return result
  }

  /** Check if any instance is running for a given agent. */
  hasRunningInstance(agentId: string): boolean {
    for (const inst of this.instances.values()) {
      if (inst.agentId === agentId && inst.status === 'running') return true
    }
    return false
  }

  // ===================== Path helpers =====================

  private getAgentRootPath(agentId: string): string {
    return join(this.config.agentsDir, agentId)
  }

  /** Get the user's root directory path (for file listing/serving). */
  getUserRootPath(agentId: string, userId: string): string {
    return join(this.config.usersDir, userId, 'agents', agentId)
  }

  /** Get agent config by ID from the loaded configuration. */
  private findAgentConfig(agentId: string): AgentConfig | undefined {
    return this.config.agents.find(a => a.id === agentId)
  }

  // ===================== Agent-level config (reads shared files, not per-instance) =====================

  listAgents(): Array<{
    id: string
    name: string
    status: string
    working_dir: string
    provider?: string
    model?: string
    skills: string[]
  }> {
    return this.config.agents.map(a => {
      const gooseConfig = this.getAgentGooseConfig(a.id)
      return {
        id: a.id,
        name: a.name,
        status: this.hasRunningInstance(a.id) ? 'running' : 'stopped',
        working_dir: relative(this.config.projectRoot, this.config.usersDir) || 'users',
        provider: gooseConfig?.GOOSE_PROVIDER,
        model: gooseConfig?.GOOSE_MODEL,
        skills: this.getAgentSkills(a.id),
      }
    })
  }

  private getAgentSkills(agentId: string): string[] {
    const skillsDir = join(this.getAgentRootPath(agentId), 'config', 'skills')
    if (!existsSync(skillsDir)) return []
    try {
      return readdirSync(skillsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }

  getAgentSkillsDetailed(agentId: string): Array<{
    name: string
    description: string
    path: string
  }> {
    const skillsDir = join(this.getAgentRootPath(agentId), 'config', 'skills')
    if (!existsSync(skillsDir)) return []
    try {
      const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b))

      return skillDirs.map(skillName => {
        const skillPath = join(skillsDir, skillName)
        const skillMdPath = join(skillPath, 'SKILL.md')
        let description = ''
        if (existsSync(skillMdPath)) {
          try {
            const content = readFileSync(skillMdPath, 'utf-8')
            const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
            if (frontmatterMatch) {
              const descMatch = frontmatterMatch[1].match(/description:\s*(.+)/)
              if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '')
            }
            if (!description) {
              for (const line of content.split('\n')) {
                const trimmed = line.trim()
                if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
                  description = trimmed
                  break
                }
              }
            }
          } catch { /* ignore */ }
        }
        return { name: skillName, description: description || 'No description available', path: `.claude/skills/${skillName}` }
      })
    } catch {
      return []
    }
  }

  getAgentConfig(agentId: string): {
    id: string
    name: string
    agentsMd: string
    workingDir: string
    provider?: string
    model?: string
  } | null {
    const agentConfig = this.findAgentConfig(agentId)
    if (!agentConfig) return null

    const agentsMdPath = join(this.getAgentRootPath(agentId), 'AGENTS.md')
    let agentsMd = ''
    if (existsSync(agentsMdPath)) {
      try { agentsMd = readFileSync(agentsMdPath, 'utf-8') } catch { /* */ }
    }

    const gooseConfig = this.getAgentGooseConfig(agentId)
    return {
      id: agentConfig.id,
      name: agentConfig.name,
      agentsMd,
      workingDir: relative(this.config.projectRoot, this.config.usersDir) || 'users',
      provider: gooseConfig?.GOOSE_PROVIDER,
      model: gooseConfig?.GOOSE_MODEL,
    }
  }

  updateAgentConfig(agentId: string, updates: { agentsMd?: string }): {
    success: boolean
    error?: string
  } {
    const agentConfig = this.findAgentConfig(agentId)
    if (!agentConfig) return { success: false, error: `Agent '${agentId}' not found` }

    try {
      if (updates.agentsMd !== undefined) {
        const agentsMdPath = join(this.getAgentRootPath(agentId), 'AGENTS.md')
        writeFileSync(agentsMdPath, updates.agentsMd, 'utf-8')
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  /**
   * Read top-level string/number/boolean values from agent config.yaml and secrets.yaml.
   */
  getAgentConfigEnv(agentId: string): Record<string, string> {
    const result: Record<string, string> = {}
    const configDir = join(this.getAgentRootPath(agentId), 'config')

    for (const filename of ['config.yaml', 'secrets.yaml']) {
      const filePath = join(configDir, filename)
      if (!existsSync(filePath)) continue
      try {
        const parsed = parseYaml(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object') continue
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') result[key] = value
          else if (typeof value === 'number' || typeof value === 'boolean') result[key] = String(value)
        }
      } catch { /* ignore parse errors */ }
    }
    return result
  }

  private getAgentGooseConfig(agentId: string): { GOOSE_PROVIDER?: string; GOOSE_MODEL?: string } | null {
    const configPath = join(this.getAgentRootPath(agentId), 'config', 'config.yaml')
    if (!existsSync(configPath)) return null
    try {
      return parseYaml(readFileSync(configPath, 'utf-8')) as { GOOSE_PROVIDER?: string; GOOSE_MODEL?: string }
    } catch {
      return null
    }
  }
}

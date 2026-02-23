/**
 * In-memory session ownership cache.
 *
 * Source of truth is goosed's SQLite — the `working_dir` field on each session
 * encodes the owning user:
 *   - Contains `/users/{userId}/` → belongs to that user
 *   - No `/users/` segment       → system/shared → DEFAULT_USER ("sys")
 *
 * This cache avoids repeated round-trips to goosed for ownership checks on
 * hot paths like /reply.  It is populated on:
 *   1. Session creation (gateway intercepts POST /agent/start)
 *   2. Session listing  (gateway parses working_dir from aggregated results)
 *   3. On-demand fetch  (cache miss → fetch session details → parse → cache)
 */

import { SYSTEM_USER } from './instance-manager.js'

/** Extract userId from a working_dir string, e.g. "users/alice/agents/kb-agent/" → "alice" */
export function extractUserFromWorkingDir(workingDir: string): string {
  const match = workingDir.match(/\/users\/([^/]+)/)
  return match ? match[1] : SYSTEM_USER
}

export class SessionOwnerCache {
  private cache = new Map<string, string>()

  /** Record ownership (called on session creation or when discovered via listing) */
  set(sessionId: string, userId: string): void {
    this.cache.set(sessionId, userId)
  }

  /** Lookup cached ownership. Returns undefined on cache miss. */
  get(sessionId: string): string | undefined {
    return this.cache.get(sessionId)
  }

  /** Remove entry (e.g. after session deletion) */
  remove(sessionId: string): void {
    this.cache.delete(sessionId)
  }

  /** Populate cache from a batch of sessions (e.g. from listing) */
  populateFromSessions(sessions: Array<{ id: string; working_dir?: string }>): void {
    for (const s of sessions) {
      if (s.working_dir) {
        this.cache.set(s.id, extractUserFromWorkingDir(s.working_dir))
      }
    }
  }
}

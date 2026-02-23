# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Directory Permissions

- `ops-factory/` is the project directory. Files within this directory **can be modified**.
- `goose-main/` (`/Users/buyangnie/Documents/GitHub/goose-main`) is a reference directory. Files within this directory **must NOT be modified** — read-only for reference purposes.

## Project Overview

Ops Factory is a multi-tenant AI agent management platform built on Goose. It consists of three main components:

- **Gateway** (`gateway/`) — TypeScript HTTP server that manages per-user agent instances, proxies requests, and handles routing/auth
- **Web App** (`web-app/`) — React frontend for chat, session management, file browsing, and agent configuration
- **TypeScript SDK** (`typescript-sdk/`) — Client library (`@goosed/sdk`) for programmatic access to the Goose API

Agents are configured in `agents/` (e.g., `universal-agent`, `kb-agent`) via YAML config files. The gateway spawns `goosed` binary processes on dynamic ports with per-user isolation under `users/{userId}/agents/{agentId}/`.

## Common Commands

### Service Management (from project root)

```bash
./scripts/ctl.sh startup              # Start all services
./scripts/ctl.sh startup gateway      # Start gateway only
./scripts/ctl.sh startup webapp       # Start web app only
./scripts/ctl.sh shutdown all         # Stop all services
./scripts/ctl.sh status               # Check service status
./scripts/ctl.sh restart gateway      # Restart gateway
```

### Gateway (`cd gateway`)

```bash
npm install
npm run dev          # Development mode (tsx src/index.ts)
npm run build        # TypeScript compile
npm run start        # Production (node dist/index.js)
```

### Web App (`cd web-app`)

```bash
npm install
npm run dev          # Vite dev server on http://127.0.0.1:5173
npm run build        # tsc && vite build
```

### TypeScript SDK (`cd typescript-sdk`)

```bash
npm install
npm run build        # TypeScript compile
npm test             # Unit tests (node --test with tsx)
npm run test:integration
```

### Tests (`cd test`)

```bash
npm install
npm test                  # Vitest integration tests
npm run test:watch        # Watch mode
npm run test:e2e          # Playwright E2E tests (requires running app)
npm run test:e2e:headed   # E2E with visible browser
```

## Architecture

```text
Web App (React/Vite :5173)
    │
    │  GATEWAY_URL + GATEWAY_SECRET_KEY
    ▼
Gateway (Node.js :3000)
    │
    ├── InstanceManager: spawns goosed processes per user on dynamic ports
    │   ├── "sys" user instance (always running, handles schedules)
    │   └── per-user instances (spawned on demand, idle-reaped after 15 min)
    │
    ├── Routes: /agents/:id/agent/* → proxy to user's goosed instance
    ├── Routes: /agents/:id/sessions/* → session management
    ├── Routes: /agents/:id/files/* → file serving
    └── Routes: /agents/:id/config → agent config CRUD
```

**Key architectural details:**

- The gateway uses raw Node.js `http` module (no Express) with `http-proxy` for proxying to agent instances
- Agent configs in `agents/{id}/config/` are symlinked into per-user directories under `users/` to avoid duplication
- Chat uses SSE (Server-Sent Events) streaming from goosed through the gateway proxy
- The web app imports `@goosed/sdk` as a local dependency (`file:../typescript-sdk`)
- The SDK's `GoosedClient` handles HTTP communication, SSE streaming, sessions, tools, recipes, and schedules
- Web app state is managed through React Context providers (User, Goosed, Toast, Inbox, Preview)

## Key Environment Variables

```bash
GATEWAY_HOST=0.0.0.0          # Gateway bind host
GATEWAY_PORT=3000              # Gateway port
GATEWAY_SECRET_KEY=test        # Auth key shared between gateway and web app
GOOSED_BIN=goosed              # Path to goosed binary
PROJECT_ROOT=<auto>            # Set by ctl.sh
```

Web app env is in `web-app/.env`. Agent-level config (LLM provider, model, extensions) lives in `agents/{id}/config/config.yaml`.

## Module Structure

All packages use ESM (`"type": "module"` in package.json). TypeScript is used throughout. There is no monorepo tool (no nx, turborepo, or npm workspaces) — each package has its own `node_modules` and must be installed separately.

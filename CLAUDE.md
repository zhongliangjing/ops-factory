# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Directory Permissions

- `ops-factory/` is the project directory. Files within this directory **can be modified**.
- `goose/` (sibling directory `../goose`) is a reference directory. **Full read access granted** (all files and directories). Files within this directory **must NOT be modified** — read-only for reference purposes.

> **Setup note**: Clone the [goose](https://github.com/block/goose) repo as a sibling directory so Claude Code can reference it. Then add `../goose` as an additional working directory in your Claude Code settings.

## Project Overview

Ops Factory is a multi-tenant AI agent management platform built on Goose. It consists of three main components:

- **Gateway** (`gateway/`) — Java Spring Boot (WebFlux) HTTP server that manages per-user agent instances, proxies requests, and handles routing/auth. Multi-module Maven project with `gateway-common` (shared utilities/models) and `gateway-service` (main application).
- **Web App** (`web-app/`) — React frontend for chat, session management, file browsing, and agent configuration
- **TypeScript SDK** (`typescript-sdk/`) — Client library (`@goosed/sdk`) for programmatic access to the Goose API

Agents are configured in `gateway/agents/` (e.g., `universal-agent`, `kb-agent`) via YAML config files. The gateway spawns `goosed` binary processes on dynamic ports with per-user isolation under `gateway/users/{userId}/agents/{agentId}/`.

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
mvn compile                           # Compile all modules
mvn package -DskipTests               # Build JAR (gateway-service/target/gateway-service.jar)
mvn test                              # Run unit tests
./scripts/ctl.sh startup              # Build + start gateway
./scripts/ctl.sh startup --background # Start in background
./scripts/ctl.sh shutdown             # Stop gateway + all goosed processes
./scripts/ctl.sh status               # Health check
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
Gateway (Spring Boot WebFlux :3000)
    │
    ├── agents/          Agent configs (config.yaml, secrets.yaml, AGENTS.md, skills/)
    ├── users/           Per-user runtime dirs (spawned on demand)
    │
    ├── InstanceManager: spawns goosed processes per user on dynamic ports
    │   ├── sysOnly agents (always running, e.g. supervisor-agent)
    │   └── per-user instances (spawned on demand, idle-reaped after 15 min)
    │
    ├── Controllers:
    │   ├── AgentController      /agents, /agents/:id
    │   ├── SessionController    /agents/:id/sessions/*
    │   ├── FileController       /agents/:id/files/*
    │   ├── MonitoringController /monitoring/*
    │   ├── StatusController     /status, /me, /config
    │   └── CatchAllProxyController  /agents/:id/agent/* → proxy to goosed
    │
    ├── Filters: AuthWebFilter (secret key), UserContextFilter (userId/role)
    ├── Hooks: BodyLimitHook, FileAttachmentHook, VisionPreprocessHook
    └── Services: AgentConfigService, SessionService, FileService, LangfuseService
```

**Key architectural details:**

- The gateway is a **Java 21 / Spring Boot 2.7 / WebFlux** reactive application (multi-module Maven)
- `gateway-common`: shared constants (`GatewayConstants`), models (`ManagedInstance`, `AgentRegistryEntry`, `UserRole`), utilities (`PathSanitizer`, `ProcessUtil`, `YamlLoader`)
- `gateway-service`: controllers, filters, hooks, services, process management (`InstanceManager`, `IdleReaper`, `PortAllocator`, `RuntimePreparer`, `PrewarmService`)
- `GoosedProxy` + `SseRelayService` handle HTTP proxying and SSE streaming to goosed instances
- Agent configs in `gateway/agents/{id}/config/` are symlinked into per-user directories under `gateway/users/` to avoid duplication
- Chat uses SSE (Server-Sent Events) streaming from goosed through the gateway proxy
- The web app imports `@goosed/sdk` as a local dependency (`file:../typescript-sdk`)
- The SDK's `GoosedClient` handles HTTP communication, SSE streaming, sessions, tools, recipes, and schedules
- Web app state is managed through React Context providers (User, Goosed, Toast, Inbox, Preview)

## Gateway Configuration

Gateway config lives in `gateway/config.yaml` with priority: **env var > config.yaml > default**.

The `ctl.sh` script reads `config.yaml` values and injects them as Java system properties (`-D`) when starting the gateway. Spring Boot's `application.yml` maps these to `GatewayProperties` via `${ENV_VAR:default}` syntax.

```bash
# Core
GATEWAY_HOST=0.0.0.0          # Bind host
GATEWAY_PORT=3000              # Server port
GATEWAY_SECRET_KEY=test        # Auth key shared between gateway and web app
GOOSED_BIN=goosed              # Path to goosed binary
PROJECT_ROOT=<auto>            # Set by ctl.sh

# Limits
IDLE_TIMEOUT_MINUTES=15        # Idle reap timeout
MAX_INSTANCES_PER_USER=5
MAX_INSTANCES_GLOBAL=50

# Optional integrations
LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
VISION_MODE, VISION_PROVIDER, VISION_MODEL, VISION_API_KEY
OFFICE_PREVIEW_ENABLED, ONLYOFFICE_URL
```

Web app env is in `web-app/.env`. Agent-level config (LLM provider, model, extensions) lives in `gateway/agents/{id}/config/config.yaml`.

## Module Structure

- **Gateway**: Java 21, Maven multi-module (`gateway-common`, `gateway-service`). Spring Boot WebFlux (reactive). Built JAR at `gateway-service/target/gateway-service.jar`.
- **Web App, SDK, Tests**: ESM (`"type": "module"` in package.json), TypeScript. No monorepo tool — each package has its own `node_modules` and must be installed separately.

## General Rules

- Do NOT make changes beyond what was explicitly requested. If you notice related improvements (e.g., updating Chinese text, modifying README, refactoring adjacent code), propose them first and wait for approval.

## Build & Verification

- After implementing multi-file Java changes in the gateway, always run `mvn compile` (or `mvn package -DskipTests`) and fix ALL compilation errors before presenting the result as complete.
- After implementing multi-file TypeScript changes in web-app/SDK/tests, always run `npm run build` and fix ALL TypeScript errors before presenting the result as complete.

## UI Development

- When modifying UI styles or components, do a comprehensive grep/search for ALL instances of the pattern being changed (e.g., all button classes, all modal styles) before declaring the task complete. Never assume a single CSS class covers all cases.

## Debugging Guidelines

- When debugging issues, limit hypothesis exploration to 3 attempts before stepping back to reassess. If the first 3 hypotheses fail, summarize findings and ask the user for direction rather than continuing to guess.

## Git Conventions

- After making `.gitignore` changes, always check if the affected files are already tracked with `git ls-files` and run `git rm --cached` if needed.

## Configuration & Deployment

- When configuring environment variables or service configs, verify the injection path end-to-end. Config values in `gateway/config.yaml` are read by `ctl.sh` and injected as Java `-D` properties. Spring Boot `application.yml` uses `${ENV_VAR:default}` to bind them to `GatewayProperties`. Confirm the full chain: config.yaml → ctl.sh → system property → application.yml → GatewayProperties.

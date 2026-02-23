# Ops Factory

A multi-tenant AI agent management platform built on [Goose](https://github.com/block/goose). Ops Factory provides a unified web interface for managing multiple AI agents that collaborate on operations tasks such as incident analysis, knowledge retrieval, and report generation.

## Architecture

```text
Web App (React/Vite :5173)
    |
    |  x-secret-key / x-user-id
    v
Gateway (Node.js :3000)
    |
    +-- InstanceManager: spawns goosed processes per user on dynamic ports
    |     +-- "sys" instances (always running, handles schedules)
    |     +-- per-user instances (spawned on demand, idle-reaped after 15 min)
    |
    +-- Routes: /agents/:id/agent/* -> proxy to user's goosed instance
    +-- Routes: /agents/:id/sessions/* -> session management
    +-- Routes: /agents/:id/files/* -> file serving
    +-- Routes: /agents/:id/config -> agent config CRUD
```

See [docs/architecture.md](./docs/architecture.md) for the full architecture documentation (in Chinese).

## Components

| Component | Directory | Port | Description |
|-----------|-----------|------|-------------|
| Gateway | `gateway/` | 3000 | Node.js HTTP server managing per-user agent instances, proxying, and routing |
| Web App | `web-app/` | 5173 | React frontend for chat, session management, file browsing, and agent configuration |
| TypeScript SDK | `typescript-sdk/` | — | Client library (`@goosed/sdk`) for programmatic access to the Goose API |
| Agents | `agents/` | — | Pre-configured AI agents (universal, kb, report) with YAML configs and skills |
| Langfuse | `langfuse/` | 3100 | LLM observability platform (Docker Compose) |
| OnlyOffice | — | 8080 | Office document preview server (Docker) |

## Quick Start

### Prerequisites

- Node.js 18+
- [goosed](https://github.com/block/goose) binary installed and on PATH
- Docker (for OnlyOffice and Langfuse)

### Start All Services

```bash
./scripts/ctl.sh startup
```

This starts OnlyOffice, Langfuse, Gateway, and Web App in order. The web app is available at `http://127.0.0.1:5173`.

### Start Individual Components

```bash
./scripts/ctl.sh startup gateway    # Start gateway only
./scripts/ctl.sh startup webapp     # Start web app only
./scripts/ctl.sh shutdown all       # Stop all services
./scripts/ctl.sh status             # Check service status
./scripts/ctl.sh restart gateway    # Restart gateway
```

### Manual Setup

```bash
# 1. Gateway
cd gateway && npm install && npm run dev

# 2. Web App (in another terminal)
cd web-app && npm install && npm run dev

# 3. Open http://127.0.0.1:5173
```

## TypeScript SDK

```bash
cd typescript-sdk && npm install && npm run build
```

```typescript
import { GoosedClient } from '@goosed/sdk';

const client = new GoosedClient({
  baseUrl: 'http://127.0.0.1:3000/agents/universal-agent',
  secretKey: 'test',
  userId: 'alice',
});

// Start a session and chat
const session = await client.startSession('/path/to/workdir');
const reply = await client.chat(session.id, 'Hello!');
console.log(reply);

// Streaming
for await (const event of client.sendMessage(session.id, 'Explain this code')) {
  if (event.type === 'Message') {
    console.log(event.message);
  }
}
```

## Testing

```bash
cd test
npm install
npm test                  # Vitest integration tests
npm run test:e2e          # Playwright E2E tests (requires running app)
npm run test:e2e:headed   # E2E with visible browser
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_HOST` | `0.0.0.0` | Gateway bind address |
| `GATEWAY_PORT` | `3000` | Gateway port |
| `GATEWAY_SECRET_KEY` | `test` | Shared auth key between gateway and web app |
| `GOOSED_BIN` | `goosed` | Path to goosed binary |
| `PROJECT_ROOT` | auto-detected | Project root directory |
| `VITE_GATEWAY_URL` | `http://127.0.0.1:3000` | Gateway URL for the web app |
| `OFFICE_PREVIEW_ENABLED` | `true` | Enable OnlyOffice file preview |
| `IDLE_TIMEOUT_MS` | `900000` | User instance idle timeout (ms) |

## Project Structure

```text
ops-factory/
├── gateway/           # Node.js HTTP gateway
├── web-app/           # React frontend
├── typescript-sdk/    # @goosed/sdk client library
├── agents/            # Agent configurations (YAML + skills)
├── langfuse/          # Langfuse Docker Compose
├── scripts/           # Service management (ctl.sh)
├── test/              # Integration and E2E tests
├── docs/              # Architecture documentation
└── users/             # Per-user runtime directories (auto-generated)
```

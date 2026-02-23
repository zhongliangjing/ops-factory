# Feishu Doc MCP for kb-agent

This directory documents the Feishu MCP wiring used by kb-agent.

## Runtime registration

The extension is registered in:

- `agents/kb-agent/config/config.yaml`

Extension name: `feishu-doc`

## Knowledge base

- Name: `AgenticOps`
- `space_id`: `7599469732730850247`

## Tools

| Tool | Usage |
|------|-------|
| `wiki_v1_node_search` | Search knowledge base documents. Always pass `space_id: "7599469732730850247"`. Do not pass `useUAT` in static token mode. |
| `docs_v1_content_get` | Fetch document Markdown content. Pass `doc_token` (from search results `obj_token`). Do not pass `useUAT` in static token mode. |

## Authentication

Uses static **user_access_token** via `USER_ACCESS_TOKEN` environment variable.

Required OAuth scopes:
- `wiki:wiki:readonly` (or `wiki:wiki`)
- `search:docs:read`
- `docs:document.content:read`
- `drive:drive.search:readonly`

### Prerequisites

Required secrets in `agents/kb-agent/config/secrets.yaml`:

- `APP_ID`
- `APP_SECRET`
- `USER_ACCESS_TOKEN` (manual refresh every ~2 hours)

## Usage policy

- Intended for RAG only (search + read).
- Data boundary: only the `AgenticOps` knowledge base.
- Cite source title and URL in final answers.
- Prefer summary + quote snippets, avoid full raw dump.
- Disallowed: create, update, delete, share docs; cross-tenant operations.

## Local verification

1. Update `USER_ACCESS_TOKEN` in `agents/kb-agent/config/secrets.yaml`.
2. Start stack:
   - `OFFICE_PREVIEW_ENABLED=false ./scripts/startup.sh`
3. Check mcp list:
   - `curl -H 'x-secret-key: test' http://127.0.0.1:3000/agents/kb-agent/mcp`
4. In kb-agent chat, ask a question about your knowledge base content.

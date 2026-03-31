# Documentation Map

This `docs/` tree serves both product-facing and engineering-facing documentation. Keep quick-start material in the repository `README.md`, keep hard collaboration rules in `AGENTS.md`, and use this directory for details that need to persist across teams and sessions.

## Structure
- `product/`: product overview, user flows, demos, and feature notes.
- `architecture/`: module responsibilities, system boundaries, integration contracts, and design decisions.
- `development/`: onboarding, coding constraints, UI rules, testing policy, and review expectations.
- `operations/`: local startup, deployment, monitoring, and troubleshooting.
- `adr/`: Architecture Decision Records for decisions that should not be rediscovered in code review.

## Current Core Docs
- `architecture/overview.md`: service responsibilities and cross-module boundaries.
- `architecture/api-boundaries.md`: gateway/API/auth/SSE compatibility rules.
- `architecture/knowledge-service-architecture.md`: knowledge-service front-end/back-end architecture, retrieval strategy, defaults, and API map.
- `architecture/knowledge-service-integration.md`: knowledge-service API, configuration, and service-to-service integration guide.
- `architecture/knowledge-service-mcp.md`: qa-agent knowledge-service MCP registration, tools, defaults, and runtime behavior.
- `architecture/qa-agent-architecture.md`: QA Agent runtime configuration, prompt constraints, and agentic RAG workflow.
- `architecture/process-management.md`: goosed instance lifecycle and runtime isolation rules.
- `architecture/process-management-deep-dive.md`: detailed gateway runtime/process-management design note.
- `development/ui-guidelines.md`: frontend layout and interaction constraints.
- `development/testing-guidelines.md`: what tests to add for which changes.
- `development/change-scope-rules.md`: scope control and collaboration guardrails.
- `development/review-checklist.md`: pull request review checklist for cross-team changes.
- `operations/goosed-pipe-deadlock-postmortem.md`: incident postmortem and debugging best practices.

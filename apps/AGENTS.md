# Application Agent Instructions

## Role

Applications are composition roots. They wire domain schemas, NamespaceRuntime, persistence adapters, transport endpoints, authentication, and process lifecycle without moving those contracts out of their owning packages.

## Boundaries

- Consume package public exports; package-internal constructors and testing seams are not application APIs.
- Keep ordinary REST, WebSocket, and internal business writes on one validated mutation path with one authorization decision point. Trusted instance replication uses its documented raw-update path and must remain inaccessible to ordinary clients.
- Bind each namespace to its own schema/runtime scope; unknown dialects fail loudly according to the core contracts.
- Keep adapter selection, environment configuration, logging, and shutdown orchestration at the application edge.
- Add an application-local `AGENTS.md` when an app gains framework-specific commands, deployment rules, or generated assets.

## Verification

Each application must define its own focused checks. Before integration, run its checks plus root `pnpm typecheck` and `pnpm test`; completion requires graceful shutdown and cross-package contract tests to remain green.

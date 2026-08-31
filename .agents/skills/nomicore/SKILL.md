---
name: nomicore
description: Integrate Nomicore into an independent project. Use when authoring or validating VFSL schemas, generating TypeScript namespace projections, implementing typed namespace reads/writes, composing Cordis Instance/Clock/Timer/Persistence/Registry and role-specific replication plugins, or configuring standalone Hub/Peer deployment and replica recovery.
---

# Nomicore integration

Treat the current repository as the owning host. Its schema, generated types, application code, configuration, tests, build, and deployment stay in that repository; Nomicore is an imported module.

## Route the task

Load only the branch needed:

- **Schema** — creating or changing `schema.vfsl`, choosing carriers, validating schema or example ROOT data: read [schema.md](schema.md).
- **Typed access** — generating `generated.ts`, wiring TypeScript, or implementing namespace read/write code: read [typed-access.md](typed-access.md).
- **Cordis host** — configuring Instance identity, Clock, Timer, Persistence, Registry, namespace creation/opening, role-specific replication plugins, or shutdown: read [cordis-host.md](cordis-host.md).
- **Replication** — choosing standalone versus embedded Hub/Peer hosting, or configuring authorization, targets, TLS, readiness, lifecycle, epoch bump, reset, or recovery: read [replication.md](replication.md).

For an end-to-end integration, execute those branches in that order. Re-open a prior branch when a later change alters its input—for example, regenerate and typecheck after changing the schema.

## Shared discovery

Resolve the Nomicore checkout before editing:

1. Prefer an explicit path supplied by the user or host instructions.
2. Otherwise inspect linked `@nomicore/*` package paths and the current project's dependency metadata.
3. Record the resolved checkout as `NOMICORE_ROOT` for commands; do not copy Nomicore source into the host.

Use the host's package manager and scripts where they already encode the workflow. During pre-publish local integration, link package directories by actual path; global package-name linking is not the contract.

## Completion gate

The integration is complete only when every selected branch meets its own completion gate, generated artifacts are fresh, the host typecheck passes, runtime tests cover failure results, and no application code imports Nomicore internal source paths or live writable Yjs objects.

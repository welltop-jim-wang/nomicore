---
name: nomicore
description: Integrate Nomicore into an independent project. Use when authoring or validating VFSL schemas, generating TypeScript namespace projections, implementing typed namespace reads/writes, composing Cordis Instance/Clock/Timer/Persistence/Registry and role-specific replication plugins, or configuring standalone Hub/Peer deployment and replica recovery.
---

# Nomicore integration

Treat the current repository as the owning host. Its schema, generated types, application code, configuration, tests, build, and deployment stay in that repository; Nomicore is an imported module.

## Route the task

Load only the branch needed:

- **Schema** — creating or changing `schema.vfsl`, choosing carriers, validating schema/example ROOT data, or replacing the SCHEMA of an existing namespace: read [schema.md](schema.md).
- **Typed access** — generating `generated.ts`, wiring TypeScript, or implementing namespace read/write code: read [typed-access.md](typed-access.md).
- **Cordis host** — configuring Instance identity, Clock, Timer, Persistence, Registry, namespace creation/opening, role-specific replication plugins, or shutdown: read [cordis-host.md](cordis-host.md).
- **Replication** — choosing standalone versus embedded Hub/Peer hosting, or configuring authorization, targets, TLS, readiness, lifecycle, epoch bump, reset, or recovery: read [replication.md](replication.md).

For an end-to-end integration, execute those branches in that order. Re-open a prior branch when a later change alters its input—for example, regenerate and typecheck after changing the schema.

## Shared discovery

For ordinary consumption, install released `@nomicore/*` packages from npm with the host's package manager and keep the chosen versions in its lockfile. Resolve a Nomicore checkout only when editing Nomicore itself, reading repository-only architecture references, or validating an explicitly unreleased change:

1. Prefer an explicit path supplied by the user or host instructions.
2. Otherwise inspect the current project's dependency metadata; do not replace a working npm dependency with a source link.
3. When a checkout is genuinely needed, record it as `NOMICORE_ROOT`; do not copy Nomicore source into the host.

Use source links or local tarballs only for unreleased integration work. Return final consumer verification to released npm packages whenever the task does not require checkout modifications.

## Completion gate

The integration is complete only when every selected branch meets its own completion gate, generated artifacts are fresh, the host typecheck passes, runtime tests cover failure results, and no application code imports Nomicore internal source paths or live writable Yjs objects.

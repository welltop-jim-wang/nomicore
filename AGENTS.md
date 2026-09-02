# Agent Instructions

## Agent skills

### Issue tracker

Issues live in the repo's GitHub Issues (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Module guidance

Before changing files under `packages/`, `domains/`, `apps/`, or `docs/`, read the nearest nested `AGENTS.md`; it defines that module's contract boundaries and verification gates.

### Schema authoring

When creating or editing `domains/*/schema.vfsl`, follow `docs/vfsl/schema-authoring-guide.md` for modeling, VFSL v1 syntax, carrier selection, generation, and validation.

### Nomicore integration skill

When an independent project needs to use Nomicore—author or validate VFSL, generate typed Namespace access, compose Cordis plugins, or configure Hub/Peer replication—use the `nomicore` skill in `.agents/skills/nomicore/`; keep the independent project as the owning host.

### Typed Namespace writes — mandatory

Every application or independent project that mutates Namespace data must generate the schema projection, load its `VfslPathMap` augmentation into the consuming TypeScript Program, and pass a projection-aware `typecheck`; follow `.agents/skills/nomicore/typed-access.md` and `docs/integration/external-project-vfsl-codegen.md`. Writes must use generated `PathAt`/`PathPatchValue`/`PathElementValue` types through a host-owned typed adapter over `NamespaceLease.mutateData()`; this is required, not optional. Reads may use the dynamic `NamespaceLease.readData()` interface when the caller intentionally handles runtime-shaped data, though typed reads should use generated `PathAt`/`PathValue` where static projection is desired. For writes, never skip generation or typecheck, widen mutation paths to unchecked arrays, encode array indices as strings (`'0'` instead of numeric `0`), scatter `any`/casts through business code, access live `Y.Doc`, edit snapshots, or treat runtime SCHEMA validation as a substitute for compile-time path/value checking. Write-path completion requires `generate --check`, `tsc --listFilesOnly` evidence that the exact projection is loaded, and negative type fixtures proving unknown mutation paths and wrong values fail closed.

### Third-party plugin hosting

When integrating Nomicore into an external Cordis host, changing plugin assembly, or documenting plugin configuration and shutdown, use Cordis plugin-factory composition and follow `docs/integration/cordis-plugin-hosting.md` for Instance → Clock/Timer → Persistence → Registry → role-specific replication order, readiness, adapter options, and lifecycle teardown; keep `instanceId + role` in the Instance service and do not assume a stable dynamic pluginId or `cordis_define` contract.

### Instance replication

When changing Hub/Peer replication, authentication, wire frames, connection or namespace state machines, backpressure, reconciliation, or shutdown drain, treat `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` as the architecture and `docs/protocols/instance-replication-v1.md` as the normative wire contract; then read the nearest package or app `AGENTS.md`.

### Git worktrees

Create all repository worktrees under the repository-local `.worktrees/` directory. Do not create routine worktrees beside the repository or under `/tmp`. See `.agents/WORKTREES.md`.

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

### Third-party plugin hosting

When integrating Nomicore into an external Cordis host, changing plugin assembly, or documenting plugin configuration and shutdown, use Cordis plugin-factory composition and follow `docs/integration/cordis-plugin-hosting.md` for Instance → Clock/Timer → Persistence → Registry → role-specific replication order, readiness, adapter options, and lifecycle teardown; keep `instanceId + role` in the Instance service and do not assume a stable dynamic pluginId or `cordis_define` contract.

### Instance replication

When changing Hub/Peer replication, authentication, wire frames, connection or namespace state machines, backpressure, reconciliation, or shutdown drain, treat `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` as the architecture and `docs/protocols/instance-replication-v1.md` as the normative wire contract; then read the nearest package or app `AGENTS.md`.

### Git worktrees

Create all repository worktrees under the repository-local `.worktrees/` directory. Do not create routine worktrees beside the repository or under `/tmp`. See `.agents/WORKTREES.md`.

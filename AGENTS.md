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

### Third-party plugin hosting

When integrating Nomicore into an external Cordis host, changing plugin assembly, or documenting plugin configuration and shutdown, follow `docs/integration/cordis-plugin-hosting.md` for dependency order, adapter options, Registry usage, and lifecycle teardown.

### Git worktrees

Create all repository worktrees under the repository-local `.worktrees/` directory. Do not create routine worktrees beside the repository or under `/tmp`. See `.agents/WORKTREES.md`.

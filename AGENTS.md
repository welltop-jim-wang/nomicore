# Agent Instructions

## Agent skills

### Issue tracker

Issues live in the repo's GitHub Issues (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Git worktrees

Create all repository worktrees under the repository-local `.worktrees/` directory. Do not create routine worktrees beside the repository or under `/tmp`. See `.agents/WORKTREES.md`.

# Git worktrees

Repository-local worktrees must be created under `.worktrees/` at the repository root.

For this checkout, use paths such as:

```bash
git worktree add .worktrees/<name> <branch>
```

Rules:

- Do not create routine worktrees as siblings of the repository or under `/tmp`.
- Use a short, branch-related directory name under `.worktrees/`.
- Before creating one, inspect `git worktree list` and remove or prune stale entries when safe.
- Never reuse a path that contains uncommitted work.
- Keep `.worktrees/` ignored so nested checkouts cannot be committed by the parent repository.

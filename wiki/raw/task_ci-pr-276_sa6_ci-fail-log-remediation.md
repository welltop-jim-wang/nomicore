# Remediation record: `task_ci-pr-276_sa6_ci-fail.log` staging whitespace defect

Scope: acceptance-contract iteration 2, retryable local-finalization diagnostic — the sole
blocking untracked evidence artifact, `wiki/raw/task_ci-pr-276_sa6_ci-fail.log`, failed exact
staging whitespace validation. No production implementation, approved design, or test behavior
was altered.

## Artifact role

Raw GitHub Actions log of the CI red for PR #276: run 34296011254 / job 102292700330,
shard `test (24, 4)` 4/6. It evidences the canary failure
`apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts` "real-process stale reclaim race has
exactly one live owner": assertion `toHaveLength(1)` got 2 (frame `root-lock-atomic-reclaim-red.test.ts:104:22`),
`Tests 1 failed | 497 passed`, `Process completed with exit code 1.` Cited in the SA6 contract
evidence table (`wiki/raw/task_ci-pr-276_sa6_contract.md`).

## Defect (reproduced before remediation)

17 lines carry trailing whitespace — empty-content export padding after the `Z` timestamp
or after the final separator tab: lines 11, 13, 84, 86, 89, 92, 95, 103, 105, 106, 111, 112,
114, 117, 120, 122, 123. Exact staging (`git add wiki/raw/task_ci-pr-276_sa6_ci-fail.log` then
`git diff --cached --check`) exits 2 with 17 x "trailing whitespace." errors. Verified by staging
the pristine copy and re-running the check (exit code 2) before applying the fix.

## Remediation

Removed exactly the line-ending `[ \t]+` run from each affected line (one byte per line,
17 bytes total; file 21985 -> 21968 bytes; still 124 lines). Byte-level comparison against the
pristine copy: every line is identical once trailing whitespace is ignored, i.e. no content byte
changed. ANSI color codes, `##[error]` markers, timestamps, line ordering, the mid-line BOM
(EF BB BF at offset 32), the single trailing newline, and all material CI-failure facts
(failing test, assertion text, frame, counts, duration, exit code 1) are preserved.

## Post-fix verification

- `grep -P '[ \t]+$'` on the artifact: 0 matches.
- Exact staging (`git add` + `git diff --cached --check`): exit 0, clean.
- Worktree state: evidence files remain untracked (index restored to the pre-existing clean
  state); the mandatory cached whitespace validation now passes when the finalizer stages them.

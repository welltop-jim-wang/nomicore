# Issue #138 Standards Review — R2 Final

## Scope and final verdict

- **Exact committed range reviewed:** `08da15b..HEAD`
  - `556d6da fix(ws-replication): 切片 7 实例认证/连接生命周期实现（issue #138）`
  - `f749c89 docs(wiki): issue #138 切片 7 任务档案与 SA3 实现档案入库 / task brief + design + SA2 review + SA3 impl archives (issue #138)`
  - `d528103 docs(wiki): 移除任务简报 EOF 多余空行（Standards B1）/ remove trailing EOF blank line in task brief (Standards B1)`
- **Uncommitted task artifacts reviewed as appropriate:** modified dispatch archive; untracked SA7 real-TCP authentication test; AC checklist; SA4, SA7, specification, and this Standards review artifacts.
- **Review conduct:** no business code, tests, Git state, push, or PR was changed by this review. The only file written is this requested uncommitted Standards review artifact.
- **R2 final verdict: PASS / CLEAR.** B1 is resolved. No remaining repository-standard blocker was found in the requested committed range or the reviewed task artifacts.

## R2 evidence

### B1 resolution and patch hygiene

The prior blocking finding was the trailing blank line at EOF in `wiki/raw/task_phase5-ws-auth-lifecycle.md`, reported by `git diff --check 08da15b..HEAD`.

Commit `d528103` removes exactly that line. Revalidation in `/home/wangjian/nomicore-fix-issue-138` produced:

```text
$ git diff --check 08da15b..HEAD
(exit 0; no output)

$ git diff --check
(exit 0; no output)

$ git show --check --oneline d528103
d528103 docs(wiki): 移除任务简报 EOF 多余空行（Standards B1）/ remove trailing EOF blank line in task brief (Standards B1)
(exit 0; no whitespace errors)
```

Therefore B1 is closed for both the requested exact committed diff and the current uncommitted artifact patch.

### Applicable conventions and public API review

- Root `AGENTS.md` is applicable; no nested `AGENTS.md` exists under `packages/ws-replication`.
- The public Hub contract is internally coherent: `HubReplicationOptions.verifyToken` is required and construction-validated; `accept()` accurately returns `Promise<HubConnection | undefined>` for fail-closed refusal; `HubUpgradeRequest` and `PeerTokenVerifier` are exported and covered by public API type tests.
- Existing drivers now provide the mandatory verifier/token, avoiding accidental broad test breakage from the intentional API change.

### Defensive and lifecycle standards review

The committed implementation has maintainable, explicit control flow for the high-risk cases:

1. **Fail-closed authentication:** missing/invalid credentials, absent verifier, verifier throw/rejection, malformed verifier result, and invalid authenticated identity close with policy refusal and allocate no protocol connection.
2. **Authentication-window limits:** early inbound frames are bounded by count and `maxFrameBytes`; overflow and oversize frames use distinct close behavior; timeout and late verifier settlement cannot revive a rejected connection.
3. **Replay/race discipline:** listeners precede verification and are detached before allocation; initial no-op unsubscribers protect synchronous transport replay. The uncommitted SA7 real-TCP artifact supplements the deterministic coverage with backlog-replay and immediate-delivery observations.
4. **Identity and authorization binding:** HELLO identity must equal authenticated verifier identity; revocation is scoped to authenticated identity and namespace, with normalized append-only cleanup sequencing to avoid cleanup-tail races.
5. **GOAWAY/drain and shutdown lifecycle:** draining blocks new work through existing ready gates, owns cancellation of its timer, classifies policy/protocol close during drain correctly, and distinguishes retry hints from normal backoff. Hub shutdown stops acceptance before best-effort ready-connection GOAWAY and settlement.

No standards defect requiring a change was identified in these areas.

### Verification

Commands run in the target worktree after the B1 repair:

```text
pnpm --filter @nomicore/ws-replication typecheck
```

Result: **passed**.

```text
pnpm exec vitest run packages/ws-replication/test
```

Result: **passed — 19 test files, 126 tests; Type Errors: no errors.**

This run includes the uncommitted SA7 real-TCP authentication-window artifact (5 passing tests) as supplementary evidence. Its diagnostics showed the intended bounded frame handling and cleanup behavior; deterministic package tests remain the primary contract evidence.

## Remaining notes (nonblocking)

1. Lifecycle comments are necessarily detailed for race and resource invariants. Future cleanup may retain invariant-focused explanation while moving historical review/process identifiers into archives; current density is not a standards blocker.
2. Keeping `verifyToken` at the `HubReplicationImpl.accept()` boundary rather than exposing it through `HubInternals` is an appropriate separation of concerns.
3. The untracked SA7 test and uncommitted task archives are clean under `git diff --check`. Whether to commit them as durable task evidence is an owner/workflow decision, not a Standards blocker.

## R2 disposition

**CLEAR for the reviewed standards gate.** The B1 whitespace blocker is resolved by `d528103`; committed and uncommitted diff checks are clean, and package typecheck plus the full ws-replication test suite pass. No remaining standards blocker was identified.

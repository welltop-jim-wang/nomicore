# Acceptance Criteria Checklist — issue #190

| AC# | 描述 | 状态(✅/❌) | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | Trusted transport synchronous replay of an oversized frame is rejected with documented frame-limit semantics. | ✅ | SA6 contract `ws-replication-issue190-red.test.ts` AC1; SA7 report: 4/4 contract tests pass, expected 1009/`upgrade-frame-limit` and observer behavior. | Closed by shared admission implementation. |
| AC2 | Trusted transport synchronous replay of more than `MAX_EARLY_FRAMES` rejects at first over-limit frame. | ✅ | SA6 AC2; SA7 contract report confirms 4/4 including first-over-limit path. | Closed by shared admission implementation. |
| AC3 | Frames after rejection are not retained or replayed. | ✅ | SA6 AC3; SA7 dynamic test suite and guard test verify rejected callback absorption and zero allocation. | Closed by rejection state plus listener detach. |
| AC4 | Ordinary token-verification path retains current behavior. | ✅ | SA6 preservation anchor; SA4 baseline causal replay; SA7 package suite 46 files/322 tests, production smoke preserves legal HELLO path. | Closed; shared mechanism preserves token path contract. |
| AC5a | Focused ws-replication tests pass. | ✅ | SA7: `packages/ws-replication/test` 46 files, 322 tests passed; Type Errors none. | Closed. |
| AC5b | Root `pnpm typecheck` passes. | ✅ | Re-run after host recovery: `pnpm typecheck`, exit `0`; complete stdout/stderr log at `.mabf-bg/issue190-root-typecheck.log`, exit record `.mabf-bg/issue190-root-typecheck.exit`. | Closed by direct root validation. |
| AC5c | Full `pnpm test` passes. | ✅ | Post-cleanup direct root validation: `pnpm test -- --maxWorkers=2`, exit `0`; **214 test files / 2267 tests passed**, Type Errors none, duration 124.14s. Complete stdout/stderr: `.mabf-bg/issue190-root-test4.log`; exit record: `.mabf-bg/issue190-root-test4.exit`. `--maxWorkers=2` is a Runner-level cgroup `pids.max=256` resource constraint only; no tests, assertions, timeouts, or scope were changed. | Closed by real full-suite execution. |
| AC5d | `git diff --check` passes. | ✅ | SA3, SA4 and SA7 report clean diff checks. | Closed. |

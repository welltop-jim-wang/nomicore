# Final Spec Review — Issue #190

**Verdict: PASS (R3 resolves the prior validation-only blocker).**

## Implementation review

`6fde7ea` correctly centralizes `accept()` and `acceptTrusted()` on `installEarlyFrameAdmission()`. Admission checks `byteLength > maxFrameBytes` and `frames.length >= 16` before `push`; rejection is sticky, closes with the documented `{1009|1008, 'upgrade-frame-limit'}`, emits `auth-upgrade-rejected` with the required reason, and detaches listeners after synchronous registration returns. Both callers return before constructing `HubConnectionImpl`, so rejection cannot be revived by later callbacks. The token path retains its timer/verifier flow; its focused parity and normal HELLO tests pass.

The added committed tests and uncommitted SA7 dynamic tests cover oversized/count limits, exact boundaries, post-rejection pumping, synchronous replay, observer/wire behavior, token-path parity, and trusted production happy-path behavior. Focused issue tests passed: **13/13**. `pnpm typecheck` and `git diff --check b66615c` passed.

## Blocker

The required full `pnpm test` did **not** pass in this worktree. It failed in unrelated app tests:

1. `apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts` — AC1 MemoryPersistence: process exited while awaiting `verify-write`.
2. `apps/yjs-server/test/smoke-skeleton-red.test.ts` — active-file-root lock test timed out waiting for the second instance to exit.

The initial default-concurrency run exceeded the 120-second review cap, so its result alone was not conclusive. These failures are outside the #190 diff, but acceptance criterion 5 explicitly requires full-suite success.

## R2 evidence — constrained-concurrency revalidation

I first inspected Runner evidence: `.mabf-bg/issue190-root-test4.exit` is `0`; its `pnpm test -- --maxWorkers=2` log reports **214 files / 2267 tests passed** in **124.14s**, including the two files cited above.

I then independently reran the identical command with a 300-second allowance, preserving assertions, timeouts, and scope. My complete log is `.mabf-bg/issue190-final-spec-r2.log` and exit marker is `.mabf-bg/issue190-final-spec-r2.exit`. It finished in **123.78s** with exit **1**: **213 files passed, 1 failed; 2266 tests passed, 1 failed**. The sole real failure was `apps/yjs-server/test/smoke-skeleton-red.test.ts`, test “a second instance sharing an active file root is rejected loudly (lock guard, AC2)”, at line 331: `timeout 30000ms waiting for second instance to exit` (`waitForExit`, line 114). Type errors: none.

Thus the prior MemoryPersistence failure was not reproduced, but the independent full-suite rerun still is not green. This was the R2 validation-only basis for the then-current **REJECT**; no #190 functional defect was found in the reviewed implementation.

## R3 evidence — flaky classification and final disposition

I fully reviewed SA7’s R2/R3 report and independently checked the cited local artifacts. The three HEAD isolation logs (`.mabf-bg/r2-iso-single-head-{1,2,3}.log`) each pass `smoke-skeleton-red.test.ts` **4/4**; the lock-guard case takes **6169/6182/6177 ms**, leaving about 24 seconds of its 30-second budget. The Runner’s prior full suite remains an exit-0 control (214/2267, 124.14s). A later full-scale same-code run passes that smoke test (6173 ms) but instead fails a different real-process spawn/timing test, demonstrating victim drift rather than a stable behavioral regression.

Scope/cause checks support that classification: `git diff b66615c..HEAD -- apps/yjs-server` is empty; task changes are only `hub-connection.ts` plus ws-replication tests. SA7’s baseline-isolation comparison is additionally persuasive: b66615c passes the same lock test three times at equivalent timing. The second-process lock-failure route exits before the application’s ws-replication loading point, so it cannot execute the changed admission logic.

**R3 conclusion: PASS.** The sole R2 failure is a pre-existing, environment-sensitive real-process timing flake, not a #190-relevant blocker. The task meets the stated admission, semantics, replay-safety, zero-allocation/non-revival, and ordinary-token-path requirements; no outstanding #190 scope, implementation, or validation blocker remains.

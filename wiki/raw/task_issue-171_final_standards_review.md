# Final Standards Review — issue #171

- **Reviewer scope:** independent final standards review; no source edits performed
- **Exact diff range reviewed:** `ef19bae..HEAD`
- **Reviewed HEAD:** `3242d16` (`fix(ws-replication): dispose resources on removeTarget in GOAWAY drain window (issue #171 F1)`)
- **Review date:** 2026-08-30
- **Final verdict:** **clear**

## Scope and evidence

Reviewed only the requested range and directly relevant repository conventions/task archives:

- Source changes:
  - `packages/ws-replication/src/peer-namespace.ts`
  - `packages/ws-replication/src/peer-connection.ts`
  - `packages/ws-replication/src/hub-namespace.ts`
  - `packages/ws-replication/src/lifecycle-queue.ts`
- Test changes:
  - `packages/ws-replication/test/ws-replication-issue171-red.test.ts`
  - `packages/ws-replication/test/ws-replication-sa4-issue171-review-red.test.ts`
  - `packages/ws-replication/test/ws-replication-sa6-hardening-g1-g2-red.test.ts`
- Relevant archives:
  - `wiki/raw/task_issue-171.md`
  - `wiki/raw/task_issue-171_design.md`
  - `wiki/raw/task_issue-171_sa2_review.md`
  - `wiki/raw/task_issue-171_sa3_impl.md`
  - `wiki/raw/task_issue-171_sa4_review.md`
  - `wiki/raw/task_issue-171_sa7_report.md`
  - `wiki/raw/task_issue-171_ac_checklist.md`
- Repository standards/conventions consulted: root CI/typecheck layout, lifecycle ownership patterns in the affected WS replication package, and issue #171 task archives.

The range contains three commits:

1. `202558b` — core lifecycle-race repair.
2. `fc09cbb` — contract-test corrections/additions.
3. `3242d16` — F1 drain-window disposal repair.

## Standards assessment

### 1. Lifecycle ownership and defensive behavior — pass

The implementation follows the task’s key ownership discipline:

- Peer cleanup claims are captured before enqueuing work (`claimForDisposal()` is evaluated in the caller’s synchronous stack). Delayed cleanup therefore acts on the captured generation, rather than reading and destroying resources installed by a later generation.
- `runDisposal()` uses session object identity as the auxiliary-state guard. This protects a replacement session while still tearing down auxiliary resources if an epoch advanced but no new session was created.
- Fire-and-forget lifecycle paths use explicit `.catch(() => undefined)` and disposal internals contain rejection boundaries. This is consistent with the repository’s resilience-oriented lifecycle conventions and avoids unhandled-rejection escape paths.
- Hub opening continuations use an abort predicate for terminal/closing states and explicitly close/release locally acquired session/lease values before they are assigned to fields. This resolves the delayed-open lease leak without emitting late protocol frames.
- `CLOSE_OK` validation now applies the authoritative violation policy for unmatched/stale acknowledgements, including the `closeSequence === undefined` window. The test coverage includes both ordinary remove-target and hub-initiated-close paths.
- GOAWAY restart handling separates immediate receive-path quiescence from the deadline’s transport-close responsibility. The peer’s synchronous subscription/timer quiescence and later full disposal are explicit and tested.
- The late F1 repair is narrowly scoped and correct in intent: a target removed during the GOAWAY drain window queues captured-resource disposal even though the namespace has already projected to `disconnected`/`closed`. It preserves the terminal guard while preventing session, lease, watchdog, round, and channel leakage.

### 2. Correctness and regression risk — pass

The range directly addresses all issue acceptance themes: delayed continuations, cross-generation cleanup, suppressed CLOSE behavior, invalid acknowledgement closure, and GOAWAY timing.

Evidence is stronger than unit-only coverage:

- Contract tests cover H1, P3, C4, C4b, G5, and F1 failure families.
- Task archives document an independent SA4 red-team finding for F1, its focused repair, and the required replay.
- `task_issue-171_sa7_report.md` records real-TCP/real-timer validation for F1, GOAWAY quiescence, and both invalid-CLOSE_OK variants, plus deterministic tests for quiet-state `SYNC_APPLIED` behavior and no late OPEN during the drain window.
- The local final execution for this review passed **26 test files / 168 tests**, with no Vitest type errors.

No remaining blocking correctness risk was found within `ef19bae..HEAD`.

### 3. Tests, CI applicability, and documentation — pass

- The added tests use existing package harness patterns and are named `*.test.ts`, matching the repository’s test discovery convention.
- Tests are deterministic where appropriate (fake scheduler/duplex) and use real transport only for the transport-specific behaviors that cannot be established by the fake seam.
- The task archive includes design, adversarial review, implementation evidence, static review, dynamic review, and acceptance-criteria mapping. The documentation provides sufficient rationale for the non-obvious cleanup ordering and identity guards.
- Current review commands passed:

  ```text
  pnpm exec vitest run packages/ws-replication --typecheck
  → 26 files passed, 168 tests passed, Type Errors: no errors

  pnpm run typecheck
  → exit 0

  git diff --check ef19bae..HEAD
  → clean
  ```

### 4. Maintainability — pass

The changes are concentrated in the lifecycle owners rather than spread through unrelated surfaces. The central cleanup primitives and comments explain the non-obvious cross-generation and drain-window invariants. The added comments are verbose but purposeful for race-sensitive behavior and are supported by task-local tests/archives.

`lifecycle-queue.ts` documents the intentional separation of hub and peer lifecycle authorities instead of retaining a dead generic abstraction. This matches the stated task scope and avoids a misleading shared queue abstraction.

### 5. Debug artifacts and repository hygiene — pass

- `git diff --check ef19bae..HEAD` is clean.
- No production debug instrumentation, `.only`, `.skip`, `debugger`, or executable debug logging was found in the reviewed code/test delta.
- The only textual debug-term hit in the diff was archival prose that documents the absence/removal of a prior temporary debug file; it is not a runtime artifact.
- No out-of-scope production modules were modified in the requested commit range.

## Blocking findings

None.

## Non-blocking notes

1. The worktree contains additional uncommitted SA7 test/archive artifacts outside the reviewed commit range. They were not treated as part of `ef19bae..HEAD` and therefore do not change this range verdict. Their local presence explains why the final package test run collected 26 files / 168 tests rather than only the committed-range test count.
2. The root `REPORT.md` currently describes issue #133 rather than issue #171. This appears to be inherited worktree/report metadata and is outside the explicit diff range; it is not a code-quality blocker for issue #171. The issue-specific archival record is present under `wiki/raw/task_issue-171*.md`.

## Final verdict

**clear** — The reviewed range meets the repository’s lifecycle-defensiveness, correctness, maintainability, test, documentation, and hygiene expectations. No blocking standards findings remain for `ef19bae..HEAD`.

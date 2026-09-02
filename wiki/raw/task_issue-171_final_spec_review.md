# Issue #171 Final Independent Spec Review

- **Reviewer scope:** independent final specification review; no production code edits
- **Worktree:** `/home/wangjian/nomicore-fix-issue-171`
- **Exact reviewed range:** `ef19bae..HEAD`
- **Reviewed commits:** `202558b`, `fc09cbb`, `3242d16`
- **Verdict:** **clear**

## Materials compared

The complete intended diff was compared against:

1. `wiki/raw/task_issue-171.md` (scope and six acceptance criteria)
2. `wiki/raw/task_issue-171_design.md` (including R1/R1.1 design corrections)
3. `wiki/raw/task_issue-171_ac_checklist.md`
4. The implementation and issue-specific tests changed in `ef19bae..HEAD`.

## Requirement coverage and evidence

| Requirement | Diff evidence | Review result |
|---|---|---|
| Scope 1 / AC1–AC2: hub delayed authorize/open/session continuation must not revive a quiesced channel and must release acquired local resources | `hub-namespace.ts` adds `isOpenAborted()` (`closing` or terminal), suppresses late wire/state effects, and `finishOpenSilently(pendingLease, pendingSession)` closes/releases resources obtained before assignment. The intentional authorize-success path continues to `registry.open`, matching design §11.2’s acquire-then-release accounting requirement. | Satisfied. H1 test verifies a late continuation produces exactly one lease release and leaves only fixture lease after reconnect/stop. |
| Scope 2 / AC1–AC2: old peer cleanup cannot clear a new generation’s resources | `peer-namespace.ts` captures `CleanupClaim` synchronously before lifecycle queuing; `runDisposal` operates only on captured session/lease/unsubscribe and protects mutable fields/auxiliary teardown with session identity. `onCloseRequest` captures epoch only for later wire/state side effects, preventing old `CLOSE_OK` from being emitted on a new generation. | Satisfied. P3 exercises blocked gen-1 close cleanup, reconnects to gen-2, then proves gen-2 state, listener, hub channel, and replication remain live. |
| Scope 3 / AC2: every connection-loss branch cleans timers and resources | `onConnectionLost()` clears all namespace timers before branching and queues disposal for active/failed paths; `onConnectionFatal()` uses lightweight quiesce plus disposal. Hub `onCloseRequest()`/`quiesceConnection()` also clear timers. | Satisfied. The F1 regression specifically covers GOAWAY drain plus `removeTarget`, validating session/lease clearing and watchdog teardown. |
| Scope 4 / AC3: no CLOSE-on-wire means no close-timeout wait | `removeTarget()` records/awaits `CLOSE_OK` only when `sendChecked(CLOSE_NAMESPACE)` returns a positive sequence; zero/suppressed send settles locally and queues disposal. | Satisfied. Existing and updated AC3b coverage plus the full suite pass. |
| Scope 5 / AC4: forged/stale/mismatched `CLOSE_OK` is explicit, finite violation handling | `onCloseOk()` accepts only matching positive close sequence in `closing`; other non-disconnected/nonterminal CLOSE_OK frames invoke `connectionFatal('ACK_STATE_VIOLATION', 1002)`. | Satisfied. C4 and C4b verify ERROR, blocked state, transport close, and finite close promise settlement for both locally initiated and hub-initiated-close windows. |
| Scope 6 / AC5: GOAWAY restart/shutdown synchronously quiesces data acceptance and deadline only controls later transport close | `peer-connection.ts` invokes `quiesceControllersLite()` synchronously for restart GOAWAY. `onConnectionQuiesce()` unsubscribes, clears timers, and projects disconnected without deferred disposal; deadline performs full disposal and closes the transport. `SERVER_SHUTTING_DOWN` remains immediate blocked/fatal handling. | Satisfied. G5 proves listener removal and zero new UPDATE before deadline, then verifies deadline transport close. |
| Scope 7: lifecycle authority/dead abstraction | The unused hub `cleanupTail` is removed. Hub retains its explicit per-channel `closeQueue`; peer has one `enqueueLifecycle` queue backed by `cleanupTail`, while `Memoized` remains the close-promise coalescing mechanism. `lifecycle-queue.ts` documents those distinct authoritative duties. | Satisfied; no unnecessary shared abstraction was introduced. |

## Test adequacy

The changed test surface is behavior-oriented and covers the principal race/fault intersections rather than source-code assertions:

- `ws-replication-issue171-red.test.ts`: H1, P3, C4, C4b, G5.
- `ws-replication-sa4-issue171-review-red.test.ts`: F1, the GOAWAY drain-window `removeTarget` leak regression.
- `ws-replication-sa6-hardening-g1-g2-red.test.ts`: AC3b expectation updated to the authoritative fatal-ACK behavior.
- Full ws-replication suite includes dynamic and real-transport issue #171 tests.

Final verification run in this worktree:

```text
pnpm run typecheck
  PASS (exit 0)

pnpm exec vitest run packages/ws-replication --typecheck
  PASS: 26 files, 168 tests, 0 failed, no type errors

git diff --check ef19bae..HEAD
  PASS (no output; exit 0)
```

## Scope-creep assessment

No blocking scope creep found. The production changes are confined to hub/peer namespace lifecycle handling, peer GOAWAY handling, and lifecycle-authority documentation. The removal of the unused hub `cleanupTail`, inbound quiet handling during the new connected-GOAWAY/disconnected projection, and auxiliary-state reset are directly necessary supporting changes for the specified race-free lifecycle behavior.

## Blocking findings

None.

## Non-blocking notes

1. The diff contains extensive explanatory comments and supporting raw design/review artifacts. This is documentation-heavy but traceable to the issue’s lifecycle-race design process and does not alter unrelated runtime behavior.
2. The tests use a limited number of intentional internal read-only projections for lifecycle/resource state. Their primary assertions remain observable protocol frames, connection/namespace state, registry observer events, and replication behavior; this is acceptable for deterministic race coverage.

## Final verdict

**clear** — the reviewed diff `ef19bae..HEAD` implements the issue #171 intended scope, satisfies the documented acceptance criteria, has adequate focused regression coverage for the identified races, and passes the required final checks. No blocking specification discrepancy, unaddressed required behavior, or material scope creep was identified.

# Final Spec Review — issue #138: instance authentication and connection lifecycle

- **Reviewer:** Independent final Spec review (R2)
- **Worktree:** `/home/wangjian/nomicore-fix-issue-138`
- **Exact reviewed committed range:** `08da15b..HEAD`
- **HEAD at review:** `d528103d34cec34b107a94edd8635a61012e775e`
- **Reviewed commits:**
  - `556d6da` — implementation
  - `f749c89` — task/design/review archives
  - `d528103` — Standards B1 documentation-only repair (remove EOF blank line)
- **Review basis:** issue acceptance criteria in `TASK.md:9-21` and `wiki/raw/task_phase5-ws-auth-lifecycle.md:11-19`; accepted design `wiki/raw/task_phase5-ws-auth-lifecycle_design.md` (R1–R3); protocol/phase records cited by that design; final uncommitted task evidence listed below.
- **Scope discipline:** This was an independent review. It changed only this review artifact; it did not change business code, tests, Git state, push, or PRs.

## R2 final verdict

**CLEAR / PASS — approved for publication.**

The exact range `08da15b..HEAD` conforms to the issue #138 acceptance criteria and accepted design. The sole prior blocking Standards B1 finding was a documentation-only EOF blank line in the task brief. Commit `d528103` removes precisely that blank line, and the exact range now passes `git diff --check 08da15b..HEAD`. No remaining blocking Spec defect was identified.

`d528103` is intentionally not functional evidence: it neither changes implementation nor tests. Functional conformance remains evidenced by `556d6da`, the accepted design, and the final SA4/SA7 task artifacts.

## Repair verification: Standards B1 is closed

| Item | R2 evidence | Result |
|---|---|---|
| Prior blocker | `wiki/raw/task_phase5-ws-auth-lifecycle_standards_review.md:62-81` recorded `wiki/raw/task_phase5-ws-auth-lifecycle.md:118: new blank line at EOF` as its only blocking finding. | Confirmed historical blocker. |
| Repair scope | `d528103` is titled as removal of the task-brief EOF blank line; its change is documentation-only in `wiki/raw/task_phase5-ws-auth-lifecycle.md`. | Precise/minimal repair; no product behavior changed. |
| Exact-range hygiene | R2 ran `git diff --check 08da15b..HEAD`; it produced no output and exited successfully. | **Pass.** |
| Revalidation consequence | The Standards review explicitly says PASS criteria are removal of B1 plus green hygiene/typecheck/test evidence. The final artifact set records typecheck and package tests green; the repair itself cannot invalidate those unchanged code/test results. | **B1 closed.** |

## Acceptance-criteria traceability

| AC | R2 finding | Code/design evidence | Validation/final-artifact evidence |
|---|---|---|---|
| AC-1 — authenticate before allocation | **Pass.** Upgrade acceptance is async and fail-closed. Missing/bad credentials and invalid verifier results close before `HubConnectionImpl` allocation. The authentication window is bounded by frame count, frame size, and timeout; a late verifier result cannot revive a refused upgrade. | `packages/ws-replication/src/hub-connection.ts:84-193`; accepted design §2–§3. | Existing final review evidence in this file’s R1 material; SA4 `:52-56`; SA7 §Step 1 and §D3. |
| AC-2 — authenticated HELLO/ACK binding | **Pass.** Hub compares HELLO `peerInstanceId` with verified upgrade identity before ready; established peer-side Hub identity/version/capability/nonce checks remain in place. | `hub-connection.ts:373-417`; `peer-connection.ts:265-282`; design §4. | SA4 `:43-45`; red acceptance test #6 reported green by SA4/SA7. |
| AC-3 — v1 sequence/ACK/timeout/error/close-code contract | **Pass.** The range does not alter frozen codec/error-registry surfaces. Identity mismatch remains a registered connection-fatal 1008 path; draining close classification preserves permanent 1002/1008 blocking versus retryable handling. | `hub-connection.ts:347-417`; `peer-connection.ts:506-553`; design §10–§11. | SA4 `:24-41`; SA7 Step 1 reports all 15 acceptance ITs green. |
| AC-4 — deep authorization and scoped revoke | **Pass.** Revoke is keyed by authenticated identity and namespace, emits `NAMESPACE_UNAUTHORIZED` only for the target scope, settles cleanup, and makes unknown scopes no-op. | `hub-connection.ts:202-209,335-340`; `hub-namespace.ts:560-567,800-825`; design §5. | SA4 `:43-45,57-60`; acceptance #7/#8 green. |
| AC-5 — scheduler/random, GOAWAY, retry behavior | **Pass.** Non-permanent GOAWAY drains irrespective of retry hint; close deadline uses 1001; hints schedule `retryAfterMs + random × cap`; no hint uses normal backoff. Drain-time 1002/1008 becomes blocked. | `peer-connection.ts:365-411,506-553,608-619`; design §6. | SA4 `:35-37,52-56`; SA7 Step 1 and D4 green. |
| AC-6 — prevent new work and orderly shutdown | **Pass.** Ready-state gates suppress new inbound/control/data work during draining. Hub closure stops acceptance, sends shutdown GOAWAY to ready connections, then closes without waiting for network ACK. | `peer-connection.ts:123-155,235-263,438-459`; `hub-connection.ts:215-224,313-333`; design §6–§7. | SA7 D4 records real TCP order: `frame:GOAWAY` before socket close, with 1001. |
| AC-7 — no secret/high-cardinality exposure | **Pass within this slice.** New close reasons are static; no new logging/observer/config surface exposes token, owner, update, schema/root, or raw causes. Typed upgrade token does not enter the protocol wire. HTTP/header and gateway-log integration belongs to the later composition-root slice. | `hub-connection.ts:91-102,196-200,384-388`; design §8.4. | SA4 `:57`; SA7 D2 confirms no current composition root and documents the later integration obligation; acceptance #1/#6 redaction coverage is green. |

## Design and scope conformance

1. **Accepted D1–D5 design is implemented.** The public `HubUpgradeRequest`, `PeerTokenVerifier`, mandatory verifier, async `accept`, identity binding, scoped `revoke`, GOAWAY drain behavior, and shutdown order match design §§2–7.
2. **Race/resource controls are consistent with R3.** No-op unsubscribe initialization, idempotent early rejection, post-registration handling, bounded early frames, and timeout match the accepted R3 race remediation. The implementation’s documented microtask yield tightens the immediate-verifier early-frame case; SA4 independently reviewed it as a nonblocking, contract-strengthening implementation detail (`task_phase5-ws-auth-lifecycle_sa4_review.md:35-37`).
3. **Frozen surfaces remain untouched.** The committed source changes are confined to the approved modules; protocol/codec/registry/round-engine/peer-namespace and other denied surfaces are not altered, consistent with design §11 and SA4 `:26-34`.
4. **Dynamic evidence supports static conformance.** Final uncommitted SA7 evidence reports 19 package test files / 126 tests passing with no type errors, plus real TCP validation for bounded authentication-window behavior, GOAWAY-before-close ordering, and no duplicate delivery (`task_phase5-ws-auth-lifecycle_sa7_report.md:95-164`).

## Final task artifacts considered

The following uncommitted items were treated as evidence only and were **not** treated as part of the committed-range repair:

- `packages/ws-replication/test/ws-replication-sa7-r1-transport-auth.test.ts`
- `wiki/raw/task_phase5-ws-auth-lifecycle_ac_checklist.md`
- `wiki/raw/task_phase5-ws-auth-lifecycle_sa4_review.md`
- `wiki/raw/task_phase5-ws-auth-lifecycle_sa7_report.md`
- modified `wiki/raw/task_phase5-ws-auth-lifecycle_dispatch.md`
- this R2 review and the Standards review artifact

They corroborate behavior and review closure but do not change the conclusion that the intended committed diff is exactly `08da15b..HEAD` and that `d528103` only closes documentation hygiene B1.

## Blocking findings

**None.**

## Nonblocking follow-ups

1. **Composition-root integration remains deferred by slice boundary.** A future HTTP/WebSocket composition root must inject the bearer credential from a header rather than a URL/query and verify gateway/access logs do not retain it, as documented by SA7 D2. This is not a missing deliverable in this package-level slice.
2. **Optional early-listener hygiene.** SA7 notes a bounded rejected-upgrade closure can persist until the closed transport is released; adding a later `detachEarly()` would be a pure hygiene improvement, not an AC or design violation (`task_phase5-ws-auth-lifecycle_sa7_report.md:108-115`).

## Final decision

**R2 PASS / CLEAR FOR PUBLICATION.** Standards B1 is repaired by `d528103`; `git diff --check 08da15b..HEAD` is clean; the implementation continues to satisfy issue #138’s seven acceptance criteria and the accepted design. No further Spec repair is required.

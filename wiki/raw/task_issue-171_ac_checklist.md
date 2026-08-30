# Issue #171 Acceptance Criteria Checklist

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | Delayed authorize/open/session/cleanup cannot revive an old namespace or clear a new-generation listener after disconnect/reconnect/close. | ✅ | SA6 H1/P3; SA7 report RT-F1, N1 and D3; SA4 R2 ownership review. `ws-replication-issue171-red.test.ts`, `ws-replication-sa7-issue171-real-transport.test.ts`, and `ws-replication-sa7-issue171-dynamic.test.ts` are green. | Closed by SA3 commits `202558b`, `3242d16`; SA4 R2 and SA7 pass. |
| AC2 | Every acquired lease/session releases exactly once; no subscription, watchdog, round, ACK timer, or channel-state leak. | ✅ | SA6 H1/P3 and SA4 F1 regression anchor; SA7 RT-F1 proves real transport lease release exactly once and watchdog timer stops. SA7 full suite: 168 passed. | Closed by ownership claims/disposal and F1 repair. |
| AC3 | When CLOSE is not on wire, removeTarget does not wait for closeTimeoutMs. | ✅ | SA3 implementation report §D3/AC3; SA2 R2 validates suppressed-send paths; SA4 review confirms settlement paths; SA6 updated AC3b is green. | Closed by positive-sequence gate and local settlement on suppressed send. |
| AC4 | Forged/stale/mismatched CLOSE_OK has explicit error and closure behavior. | ✅ | SA6 C4/C4b; SA7 RT-C4/RT-C4b records ERROR `ACK_STATE_VIOLATION`, real socket close code 1002, blocked state and finite settlement. | Closed by universal unmatched CLOSE_OK violation handling. |
| AC5 | GOAWAY synchronously stops new data acceptance; deadline controls only transport close and does not delay namespace quiesce. | ✅ | SA6 G5; SA7 RT-G5 records disconnected projection/subscription removal before deadline, zero UPDATE, and deadline-only transport close. | Closed by lightweight synchronous quiesce plus deadline full disposal. |
| AC6 | `pnpm run typecheck`, `pnpm exec vitest run packages/ws-replication --typecheck`, and `git diff --check` pass. | ✅ | SA7 report: typecheck exit 0, ws suite 26 files / 168 tests / 0 failed / no type errors, diff check clean. Final Controller verification remains required before complete report. | Evidence accepted; rerun final required commands during finalization. |

All six acceptance criteria are satisfied by independently reviewed SA4 R2 and dynamically verified SA7 pass evidence. Final local commands remain a finalization gate, not a substitute for these criteria.

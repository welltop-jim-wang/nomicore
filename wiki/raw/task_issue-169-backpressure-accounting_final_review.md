# Final Independent Dual-Axis Review — Issue #169

## Superseded R1

- First review range: `ef19bae..541c3b7`, including the then-uncommitted SA7 dynamic test and archives.
- Standards reviewer `e40d78dc-dadc-46ec-9067-b837f1ece5e4`: **BLOCK**.
- Spec reviewer `34caae2c-0cc6-4a69-9a3f-9b27a630bc3c`: **BLOCK**.
- Shared blocker: data-only aggregate bufferedAmount decreases released `controlUnflushed`, allowing outstanding control bytes to exceed `maxQueuedControlBytes`.
- Resolution path: SA1 R12/v5 kind-aware retirement design → SA2 R12 pass → SA3 commit `8da8692` → SA4 R3 pass → SA7 R2 pass. D1 is now a safety regression proving data flush cannot release control quota.

## Current Fresh Review

- Reviewed range: `ef19bae..HEAD`, including commits `541c3b7` and `8da8692`, plus all intended issue #169 task archives.
- Standards reviewer: agent `ed37c949-65c4-447f-a43f-9ef77ff572c1` — **PASS**.
  - Verified delta-kind retirement: negative deltas retire absorbed/pending data before control and decrement `controlUnflushed` only by actual retired control bytes (`r3 + r4`).
  - Verified D1 permits 9 control frames (148,293 B ≤ 163,840 B), data-only flushes, then rejects the next control frame with one exhaustion and no quota breach.
  - Independently passed `pnpm run typecheck`, ws-replication 24 files/174 tests, and `git diff --check ef19bae..HEAD`.
- Spec reviewer: agent `87c4ebf1-3194-4e17-959e-bd5006a796ac` — **PASS**.
  - Independently verified `backpressure.ts` data-first retirement and D1 safety invariant against issue #169, SA1 v5.2, SA2 R12, AC 6/6, SA4 R3, and SA7 R2.
  - Independently passed focused 19/19, typecheck, ws-replication 24 files/174 tests, and `git diff --check ef19bae..HEAD`.

## Non-blocking Notes

- CI dynamic trigger evidence awaits Host publication because this branch is not pushed and has no PR; local collection evidence is recorded by SA4/SA7.
- The documented Δ≡0/write-through saturation exposure remains accepted and observable, with #164 as a production guard dependency.
- TCP CI timing observation and data-side P2 precision coverage remain recorded future follow-ups.

## Final Gate

**PASS.** Both fresh independent review axes found no blocking issue. The earlier control-quota blocker is closed by R12 and its D1 safety regression. Final local verification, archival commit, and correct issue #169 REPORT.md completion may proceed.

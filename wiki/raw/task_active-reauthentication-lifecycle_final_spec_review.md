# Issue #175 Final Specification / Acceptance Review

**Scope reviewed:** implementation delta `0df6583..6c7d9cf` and uncommitted `packages/ws-replication/test/ws-replication-sa7-175-dynamic.test.ts`.

## Verdict: pass

No blocking specification or acceptance-criteria finding was identified.

## Protocol alignment

- Protocol §6.3 requires `GOAWAY` to carry a stable safe reason code and receiver-local drain deadline, with sender WS 1001 closure after the deadline. The implementation sends `GOAWAY(REAUTH_REQUIRED, closeTimeoutMs)`, arms a Hub deadline, and independently arms the Peer blocked deadline.
- Protocol §15.1 classifies `REAUTH_REQUIRED` as `blocked` pending explicit token/config change; `notifyAuthChanged()` transitions only blocked peers into the existing rebuild/dial flow.
- Protocol §15.2 says established Bearer-authenticated connections are closed only when an auth/authorization Adapter actively emits reauth/revoke. `HubReplication.requestReauth(instanceIdentity)` supplies that narrow public seam.

## Acceptance criteria evidence

1. **Auth Adapter seam — pass.** Public `HubReplication.requestReauth(instanceIdentity)` and `PeerReplication.notifyAuthChanged()` are declared in `src/types.ts` and implemented in Hub/Peer connection code.
2. **Targeted REAUTH GOAWAY — pass.** `requestReauth` selects authenticated connections and calls `beginReauth`, which emits `GOAWAY(REAUTH_REQUIRED, drainTimeoutMs > 0)`.
3. **Isolation — pass.** Selection is by `authenticatedInstanceId`, not token or namespace. The AC3 test verifies beta-only impact while alpha remains ready/live/open.
4. **Bounded old-transport closure — pass.** Hub drains until `closeTimeoutMs`, then closes 1001/`hub-reauth`; Peer independently closes a still-open blocked transport at its received positive deadline with 1001/`blocked-deadline`. SA7 D1/D3/D5 cover real TCP ordering and receiver-deadline behavior.
5. **Blocked until explicit change — pass.** `REAUTH_REQUIRED` enters blocked; no automatic dial occurs. `notifyAuthChanged()` only acts from blocked and invokes rebuild. AC5 verifies token rotation, recovery to ready/live, and convergence.
6. **Idempotence/races/no unhandled rejection — pass.** Per-connection `reauthRequested`, closed-state guards, copied connection iteration, and deadline cleanup cover duplicate, late, transport-close, and `hub.close` paths. AC6 plus SA7 D2 report zero unhandled rejections.
7. **No token exposure — pass.** Reauth uses instance identity and constant reason strings; neither GOAWAY nor close reasons include token data. AC7 and SA7 D1 scan wire bytes/close metadata.
8. **Dynamic coverage — pass.** Committed lifecycle tests exercise Hub reauth, block/recovery, isolation, deadline, races, and secrecy. Uncommitted SA7 adds six dynamic cases: real TCP ordering/drain, accept race, shutdown deadline, zero-drain behavior, receiver deadline independence, and blocked liveness closure.

## Verification executed

`pnpm exec vitest run packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts packages/ws-replication/test/ws-replication-sa7-175-dynamic.test.ts --reporter=verbose`

Result: **2 files passed, 12 tests passed, no type errors**.

## Non-blocking notes

- The SA7 test and supporting review/design files are uncommitted in this worktree. This is acceptable for the requested review scope but they must be included intentionally if their added coverage is expected in the final change set.
- A protocol `GOAWAY` with `drainTimeoutMs: 0` remains intentionally non-deadlined at the Peer; production Hub reauth emits a positive timeout, and SA7 explicitly regression-tests this zero-budget semantic.

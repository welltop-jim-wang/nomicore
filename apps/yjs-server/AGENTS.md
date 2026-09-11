# Yjs Server Agent Instructions

## Role

`apps/yjs-server` is the deployable Hub/Peer composition root (Phase 5 切片 9). It wires
Instance identity, Clock, Cordis Timer, Memory/File Persistence, NamespaceRegistry,
role-specific WebSocket replication (with real `ws` transport), authentication/authorization,
validated configuration, the optional diagnostics manager (`config.diagnostics`, ADR-0011 /
ADR-0014), and ordered teardown — without moving any of those contracts
out of their owning packages.

## Boundaries

- Consume only package public exports (`@nomicore/{instance,clock,persistence,namespace-registry,namespace-api,namespace-diagnostic-log,ws-replication}`);
  no package-internal subpaths, no testing seams, no DSH profiles.
- One static role per process (`role: 'hub' | 'peer'`); never both.
- Authorization bindings are built before any network endpoint accepts. The deployable
  Hub verifies each bearer token exactly once before HTTP Upgrade, then passes only the
  resulting trusted `peerInstanceId` through the package's public `acceptTrusted` seam;
  adapters never interpret credentials or re-run the verifier.
- Single disposal chain: replication drain (the package-level WebSocket stop completes the
  admitted-apply drain and close session → release lease inside `hubService.stop()`) → bounded
  drain of already-admitted REST work (skipped while the host is still unconstructed during
  boot) → registry shutdown → diagnostics O(1) close → persistence dispose → timer/clock
  teardown. Never trigger a second concurrent teardown chain.
- The Hub listener owns raw-path route-family selection (ADR 0015): plain requests are
  REST-first and fall back to the listener's own `/healthz`/404 surface when the router
  reports `matched:false`, while upgrades keep the single `/replication` gate; the REST
  router is constructed once from the shared Registry reference and the Instance role. The
  stopping-intake `503` and the temporary HTTP rejection `500` are transport-layer
  placeholders, not terminal error-contract shapes (FR-3 converges them).
- stdout is a strict NDJSON lifecycle-event channel; stdin is the NDJSON control channel
  (one reply per line; the process never exits or crashes because of control input).
- Management verbs preserve the documented role gates and orchestration: Hub owns schema/epoch
  changes; Peer reset archives the replica, waits for channel settlement, then re-adds the target.
  Keep `peerOwners` consistent so retries remain reachable after partial failure.
- Hub owns the terminal-delete verb `delete-namespace` (issue #228): role gate first (peer →
  `unknown-op`), then argument gate (`invalid-op-args`, zero filesystem touch), known-set gate
  (known namespaces before the deletion tombstone → `namespace-unknown`), single-flight
  per-namespace. The orchestration is a compound workflow — `ok:true` means data AND diagnostic
  logs are both logically deleted within the same reply cycle (ADR-0014-LOG L299); any segment
  failure returns an honest failure code (`delete-namespace-failed` / `log-delete-failed` with
  step/errno) and re-entrant retry is the only completion path; the process never exits because
  of control input.
- Root-level file persistence acquires the authoritative `<rootDir>/.nomicore-lock/`
  directory by atomically renaming a complete private staging directory into place
  (the canonical name is first observable with its full `owner.json`); publication
  and stale reclaim serialize on the `.reap-claim` mutual-exclusion gate, whose
  wait is bounded — one unchanged holder occupancy times out to a loud failure
  instead of an unbounded silent wait. `.nomicore-lock.json` is published as a
  diagnostic mirror; clean shutdown releases the directory, and a shared active
  root is rejected.

## Verification

Run `tsc -p apps/yjs-server/tsconfig.json` (typecheck) and the app test suite
(`vitest run apps/yjs-server/test`). Completion requires graceful shutdown and
cross-package contract tests to remain green.

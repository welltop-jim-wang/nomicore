# Yjs Server Agent Instructions

## Role

`apps/yjs-server` is the deployable Hub/Peer composition root (Phase 5 切片 9). It wires
Clock, Cordis Timer, Memory/File Persistence, NamespaceRegistry (with static role),
WebSocket replication (with real `ws` transport), authentication/authorization,
validated configuration, and ordered teardown — without moving any of those contracts
out of their owning packages.

## Boundaries

- Consume only package public exports (`@nomicore/{clock,persistence,namespace-registry,ws-replication}`);
  no package-internal subpaths, no testing seams, no DSH profiles.
- One static role per process (`role: 'hub' | 'peer'`); never both.
- Authorization bindings are built before any network endpoint accepts. The deployable
  Hub verifies each bearer token exactly once before HTTP Upgrade, then passes only the
  resulting trusted `peerInstanceId` through the package's public `acceptTrusted` seam;
  adapters never interpret credentials or re-run the verifier.
- Single disposal chain: replication drain → registry shutdown → persistence dispose →
  timer/clock teardown. Never trigger a second concurrent teardown chain.
- stdout is a strict NDJSON lifecycle-event channel; stdin is the NDJSON control channel
  (one reply per line; the process never exits or crashes because of control input).
- Root-level file persistence acquires `<rootDir>/.nomicore-lock.json` (exclusive `wx`)
  and releases it on clean shutdown; a shared active root is unsupported and rejected.

## Verification

Run `tsc -p apps/yjs-server/tsconfig.json` (typecheck) and the app test suite
(`vitest run apps/yjs-server/test`). Completion requires graceful shutdown and
cross-package contract tests to remain green.

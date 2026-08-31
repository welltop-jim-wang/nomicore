# Namespace Registry Agent Instructions

## Contract

This package is the host-level owner of namespace runtimes, leases, replication sessions, idle retention, and shutdown. Read `README.md`, ADR 0009, ADR 0010, ADR 0012, and the relevant vocabulary in root `CONTEXT.md` before changing behavior.

## Boundaries

- Key active entries by `namespaceId`; preserve one active Runtime generation and one write sequencer per namespace while allowing independent namespaces to progress concurrently.
- Treat each `NamespaceLease` as an independent caller capability. Release is idempotent; the last release retains an idle Runtime until the injected timer expires, and reopen may reuse it.
- Keep owner checks fail-closed without exposing namespace existence. Ordinary create generates namespace IDs internally; trusted replica import/reset stays on its restricted lifecycle path.
- Open replication sessions only through a lease. Enforce the Registry's static Hub/Peer role, one live session per lease, epoch fences, and session termination on lease release or shutdown.
- Keep lifecycle ordering explicit: stop acceptance, drain accepted Registry operations, cancel idle timers, close runtimes, and aggregate shutdown failures.
- Production assembly consumes injected Instance, Clock, Cordis Timer, and Persistence services. Read role only from the Instance service; the Registry plugin has no role configuration. Use public package APIs except for the intentional `@nomicore/namespace-runtime/internal` Registry seam.
- Add public APIs only through `src/index.ts`; keep hostile/test controls in the explicit testing surface.

## Verification

Run Registry open/create, lease/idle, replication, shutdown, persistence-parity, Cordis, concurrency, and public-surface tests plus the package typecheck. Run root `pnpm typecheck` and `pnpm test` for lifecycle, identity, role, or replication-contract changes.

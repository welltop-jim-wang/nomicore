# Replication Protocol Agent Instructions

## Contract

This package owns the byte codec and public frame types for Nomicore instance replication v1. `docs/protocols/instance-replication-v1.md` is the normative wire contract; ADR 0010 supplies architectural context.

## Boundaries

- Keep one WebSocket binary message equal to one complete frame with the fixed 20-byte big-endian envelope.
- Preserve strict, fail-closed decoding: validate limits and envelope fields before allocation, fully consume payloads, and reject malformed, non-canonical, unknown, or trailing data with stable classifications.
- Treat message codes, capability bits, error codes, and close classifications as compatibility registries. Extend append-only where the protocol permits; never renumber or silently reinterpret existing values.
- Keep namespace identifiers, sequence ranges, directions, payload ordering, and size limits aligned with the normative protocol.
- Keep the codec transport- and Registry-independent. Yjs/lib0 dependencies implement bytes and sync payloads, not connection lifecycle or authorization.
- Add public APIs only through `src/index.ts`; exported types and runtime codec behavior must evolve together.

## Verification

Run envelope, golden-message, registry, malformed-input, truncation/round-trip, version-interoperability, fuzz/property, package-contract, and `.test-d.ts` suites plus the package typecheck. Wire changes require old/new interoperability evidence and root `pnpm typecheck` and `pnpm test`.

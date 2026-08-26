# VFSL Codegen Agent Instructions

## Contract

This package turns evaluated VFSL derived schemas into deterministic TypeScript projections. Read `README.md` and ADR 0005 before changing collection, emission, CLI, or freshness behavior.

## Boundaries

- Consume evaluator output; do not re-derive VFSL semantics in the generator.
- Keep output deterministic and byte-stable. `pnpm generate --check` must detect every stale generated file without rewriting accepted source state.
- Generated files import protocol types from `@nomicore/vfsl-protocol`; preserve module augmentation and empty-domain behavior.
- Unsupported shapes and export-name collisions fail loudly with stable diagnostics rather than emitting weakened types.
- Keep CLI filesystem concerns at the edge and emitter logic independently testable.

## Verification

Run codegen tests and typecheck, then run `pnpm generate --check`. If emitted types or protocol wiring change, also run root `pnpm typecheck` and `pnpm test`.

# VFSL Protocol Agent Instructions

## Contract

This package is the zero-runtime TypeScript protocol consumed by generated domain projections. ADR 0004 defines its public type-level behavior.

## Boundaries

- Keep the emitted JavaScript surface empty: use type declarations and type exports only.
- Preserve fail-closed path resolution. Unknown paths and non-array sequence edits must remain compile-time errors, while reads of union-member-only fields retain `undefined` where specified.
- Treat `PathSchema`, `PathAt`, value/kind projections, `VfslTypedAccess`, and `VfslPathMap` augmentation as public compatibility contracts.
- Avoid importing runtime packages or domain-specific types.
- Validate behavior with both positive and negative `.test-d.ts` cases; expected compiler failures are part of the contract.

## Verification

Run this package's typecheck and protocol type tests. Run root `pnpm typecheck` when an exported type changes, because generated domains consume this surface.

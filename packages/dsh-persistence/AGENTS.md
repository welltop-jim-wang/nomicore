# DSH Persistence Agent Instructions

## Contract

This package is the DSH development profile and inspector/probe adapter around `@nomicore/persistence`. It demonstrates and observes the core persistence plugin; it does not redefine persistence semantics.

## Boundaries

- Keep production persistence contracts in `@nomicore/persistence`; consume them here through public APIs.
- Keep probe output deterministic: inject clocks/timers and settle asynchronous work explicitly rather than relying on wall-clock sleeps.
- Preserve machine-readable event and record shapes when changing the CLI or inspector-facing output.
- Keep profile assembly thin and ensure memory/file behavior remains attributable to the underlying adapters.

## Verification

Run DSH profile, probe, CLI, and determinism tests. When core persistence integration changes, also run the persistence contract suite and root `pnpm typecheck`.

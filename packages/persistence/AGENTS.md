# Persistence Agent Instructions

## Contract

This package owns the server-side `DocPersistence`/`DocHandle` contract and its memory and file adapters. ADR 0006 is normative for ownership, lifecycle, dirty notification, scheduling, and adapter parity.

## Boundaries

- Keep the core package independent of DSH profile and inspector concerns; those belong in `@nomicore/dsh-persistence`.
- A handle exclusively owns its live `Y.Doc` until release. Preserve lifecycle, committed-state, duplicate-create, and degradation semantics across adapters.
- Memory and file adapters must satisfy the same contract. Adapter-specific I/O details must not leak into consumers.
- Dirty notification, flush scheduling, release, and timer injection are observable concurrency behavior; test ordering and failure paths deterministically.
- Add public exports through `src/index.ts`; keep test helpers explicit and out of production assembly paths.

## Verification

Run persistence contract tests against every adapter touched, plus package typecheck. Run root `pnpm typecheck` and `pnpm test` for contract or lifecycle changes.

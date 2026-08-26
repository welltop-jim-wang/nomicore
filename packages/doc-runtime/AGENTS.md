# Document Runtime Agent Instructions

## Contract

This package bridges compiled VFSL semantics and Yjs carriers. ADR 0007 defines logical validation and mutation behavior; ADR 0008 defines schema-independent reads and its boundary with NamespaceRuntime.

## Boundaries

- Keep reads schema-independent: project the actual carrier at a path without recompiling or revalidating the document.
- Validated writes support exactly the public mutation operations and preserve zero-write behavior on validation failure.
- Build replacement state detached, then install it in one guarded Yjs transaction. A post-write invariant failure is fatal, not a recoverable validation result.
- Never expose live writable ROOT, SCHEMA, META, or prepared internal state through the public surface.
- Keep carrier mechanics here and persistence/lifecycle sequencing in `@nomicore/namespace-runtime`.
- Add public APIs only through `src/index.ts`; public-surface guard tests must account for every export.

## Verification

Run doc-runtime tests including fatal, nested-path, carrier, and public-surface guards. Run root `pnpm typecheck` and `pnpm test` when public types or mutation/read contracts change.

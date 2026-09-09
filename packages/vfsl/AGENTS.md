# VFSL Core Agent Instructions

## Contract

This package owns VFSL parsing, semantic analysis, evaluation, schema-envelope compilation, fingerprints, derived schemas, and logical validation. Treat root `CONTEXT.md`, `docs/vfsl/v1-spec.md`, and ADRs 0001/0003/0007/0016 as normative when changing those contracts (ADR 0016 replaces the ADR 0008 D8 closure sentence; see its Consequences section).

## Boundaries

- Keep parser, evaluator, and validators synchronous and deterministic. Public malformed-input paths return discriminated results rather than throwing.
- Explicit exception (ADR 0016): `resolveSchemaAtPath` takes `derived` as a trusted-domain input — malformed derived schemas (missing ref targets, value-tree reference cycles, structure/value two-tree divergence, missing root/ROOT) throw `InternalError` and never enter the result union; keyPattern engine errors (PatternCompileError/PatternUnsupportedError/PatternTooLargeError/PatternBudgetExceeded) are not malformed-derived — legal derived schemas may carry undecidable patterns, so they fail closed into `SCHEMA_PATH_NOT_FOUND` (paired with the value-level handling in `validate.ts`).
- Keep IR and derived-schema outputs environment-neutral, JSON-serializable data. `schemasource.ts` is the intentional filesystem-bound seam.
- Preserve the separation between carrier structure and value semantics; do not add Yjs runtime concerns here.
- Add public API only through `src/index.ts`. Internal parser/tokenizer/analyzer structures are not public contracts.
- Stable error codes, issue ordering, path reporting, envelope strictness, and fingerprint inputs are compatibility behavior.

## Verification

Run the package typecheck and the VFSL tests for focused changes. Run root `pnpm typecheck` and `pnpm test` when public types, generated consumers, envelope compilation, or validation behavior changes.

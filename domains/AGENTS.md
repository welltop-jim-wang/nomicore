# Domain Schema Agent Instructions

## Contract

Each directory under `domains/` is a VFSL schema module plus its generated TypeScript projection and contract tests. Root `CONTEXT.md`, `docs/vfsl/v1-spec.md`, and ADR 0005 define the shared model and generation pipeline.

## Workflow

1. Edit `schema.vfsl` as the source of truth.
2. Run root `pnpm generate` to refresh generated projections.
3. Review the generated diff; change generator code rather than hand-editing generated output.
4. Run `pnpm generate --check`, domain type tests, root typecheck, and root tests. Completion requires generated output to be fresh and every domain test to pass.

## Boundaries

- Keep exactly one map-shaped `ROOT` alias and use the canonical marker-type spellings.
- Keep domain invariants expressible by the frozen VFSL dialect; authority rules and application migrations belong above this layer.
- Treat generated files as artifacts. Domain package exports may wrap or re-export them but must not fork their projected types.

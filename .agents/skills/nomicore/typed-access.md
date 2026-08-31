# Generated types and namespace access branch

Generate projections in the independent host and use them to type-check business access. Read `$NOMICORE_ROOT/docs/integration/external-project-vfsl-codegen.md` before implementation; it is the authoritative external-project workflow.

## Process

1. Confirm host layout:

   ```text
   <host>/domains/<domain>/schema.vfsl
   <host>/domains/<domain>/generated.ts
   <host>/src/...
   ```

2. During unpublished local integration, link required Nomicore package directories from the host by actual path. At minimum for generation and type projection:

   ```bash
   cd /path/to/host
   pnpm link \
     "$NOMICORE_ROOT/packages/vfsl" \
     "$NOMICORE_ROOT/packages/vfsl-protocol" \
     "$NOMICORE_ROOT/packages/vfsl-codegen"
   ```

   Link runtime packages required by the Cordis branch separately. Do not use global package-name linking as the primary workflow.
3. Generate from the host root. The current CLI's `--domains` value is the directory that **contains** `domains/`:

   ```bash
   cd /path/to/host
   pnpm exec tsx "$NOMICORE_ROOT/packages/vfsl-codegen/src/cli.ts" --domains .
   ```

4. Include `domains/**/*.ts` in the host `tsconfig.json`. If the TypeScript program is entry-pruned, add a host `.d.ts` type-only import of each generated projection.
5. Review generated diffs. Modify `schema.vfsl` or the generator contract—not `generated.ts`—when output is wrong.
6. Keep runtime validation and static typing distinct:
   - business code uses generated `VfslPathMap`, `PathAt`, `PathValue`, `PathPatchValue`, and `PathElementValue` through a host-owned adapter;
   - the adapter calls public `NamespaceLease.read()` and `mutateRoot()`;
   - one narrow assertion may bridge a successful runtime result to its projected type;
   - application call sites contain no `any`, source-deep imports, or live `Y.Doc` access.
7. Preserve literal paths (`as const` for reused tuples). Verify negative cases: unknown paths, wrong values, and array operations on non-array nodes must fail host typecheck.
8. Add host scripts equivalent to generation, freshness check, typecheck, and tests. Until a stable packaged CLI exists, keep absolute checkout paths explicitly marked as local-only configuration.

## Runtime mutation facts

Current validated operations are `set`, `delete`, `array-insert`, and `array-delete`. `array-insert` takes `values: readonly unknown[]`. There is no atomic `array-append` operation; a read-length-then-insert helper has concurrency semantics that the host must judge explicitly.

The runtime SCHEMA passed to Registry creation must come from the same `schema.vfsl`. Generated types do not replace that text.

## Completion gate

Complete when generation succeeds, `--check` reports fresh output, generated files are tracked by the host, positive access code type-checks, intentional invalid examples are rejected by TypeScript tests, runtime failures remain handled as structured results, and the host's full typecheck/tests pass.

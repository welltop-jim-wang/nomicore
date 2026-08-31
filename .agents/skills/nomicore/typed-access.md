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

## Mutation policy: minimal, mergeable, semantic

Design every business write against three simultaneous criteria:

1. **Minimal** — generate the smallest mutation that changes only the intended schema node.
2. **Mergeable** — preserve unrelated Yjs nodes so concurrent edits to other fields, records, and array positions can merge with the smallest conflict surface.
3. **Semantic** — choose an operation whose path and verb state the domain change directly (`set quantity`, `delete optional note`, `insert tag`) rather than encoding it as replacement of an incidental snapshot.

Business updates therefore target the **narrowest independently writable schema path**. For a scalar field, call `set` on that leaf path:

```ts
await lease.mutateRoot({
  op: 'set',
  path: ['items', itemId, 'quantity'],
  value: nextQuantity,
})
```

For collections, use their structural operations at the collection path: `array-insert` / `array-delete`; use `set` only for a `plain`, `leaf`, or XML terminal that is intentionally replaced as one value. Add or remove a Record entry at that entry path. Preserve every unaffected Yjs container and sibling.

Before implementing a write, name the domain change in one sentence and map it to one mutation:

| Domain change | Mutation shape |
| --- | --- |
| Change one field | `set` at that field's terminal path |
| Add/replace one Record entry | `set` at the entry path |
| Remove one Record entry or optional field | `delete` at that path |
| Insert ordered elements | `array-insert` at the array path with an explicit index |
| Remove ordered elements | `array-delete` at the array path with explicit index/count |
| Replace an intentionally opaque value | `set` at its `plain`/leaf/XML terminal |

If one business command changes several independent nodes, emit the corresponding minimal mutations through the Runtime's sequenced write path and define the command's partial-failure/atomicity semantics explicitly. Do not hide a multi-node command inside whole-parent replacement merely to obtain a single call.

A read-modify-write of the complete ROOT (read `[]`, construct a new object, then `set` `[]`) is a correctness anti-pattern for ordinary business updates. Although the low-level runtime accepts `set([])` as an explicit whole-ROOT replacement operation, it invalidates old Yjs subtype identities, overwrites concurrent changes represented by the reconstructed snapshot, expands the conflict/write surface, and discards the schema's chosen synchronization granularity. Reserve it for an explicit administrative replacement/migration flow with dedicated concurrency and lifecycle handling—not normal application writes.

The same rule applies below ROOT: replacing an entire map/object after changing one child is broader than the intended mutation. Descend to the last independently writable terminal described by the generated path projection.

Current validated operations are `set`, `delete`, `array-insert`, and `array-delete`. `array-insert` takes `values: readonly unknown[]`. There is no atomic `array-append` operation; a read-length-then-insert helper has concurrency semantics that the host must judge explicitly.

The runtime SCHEMA passed to Registry creation must come from the same `schema.vfsl`. Generated types do not replace that text.

## Completion gate

Complete when generation succeeds, `--check` reports fresh output, generated files are tracked by the host, positive access code type-checks, intentional invalid examples are rejected by TypeScript tests, and every business write is demonstrably minimal, mergeable, and semantic: its verb/path describe the intended change, it preserves unrelated Yjs nodes, and it does not reconstruct ROOT or a parent container. Runtime failures remain handled as structured results, concurrency tests cover independent edits where relevant, and the host's full typecheck/tests pass.

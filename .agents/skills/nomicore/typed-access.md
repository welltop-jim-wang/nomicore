# Generated types and namespace access branch

Generate projections in the independent host and use them to type-check business access. Read `$NOMICORE_ROOT/docs/integration/external-project-vfsl-codegen.md` before implementation; it is the authoritative external-project workflow.

## Process

1. Confirm host layout:

   ```text
   <host>/domains/<domain>/schema.vfsl
   <host>/domains/<domain>/generated.ts
   <host>/src/...
   ```

2. Install released packages from npm with the host package manager:

   ```bash
   cd /path/to/host
   pnpm add -D @nomicore/vfsl-codegen @nomicore/vfsl-protocol
   ```

   Add runtime packages required by the Cordis branch separately. Source links or local tarballs are only for explicitly unreleased Nomicore changes.
3. Generate from the host root. The CLI's `--domains` value is the directory that **contains** `domains/`:

   ```bash
   cd /path/to/host
   pnpm exec nomicore-generate --domains .
   ```

4. Prove that each consuming package's TypeScript **Program** contains its generated projection. `generated.ts` augments `@nomicore/vfsl-protocol`; merely generating or committing it does nothing when it is outside the Program. Follow [Program wiring](#program-wiring) and choose the narrowest compliant branch.
5. Review generated diffs. Modify `schema.vfsl` or the generator contract—not `generated.ts`—when output is wrong.
6. Keep runtime validation and static typing distinct:
   - business code uses generated `VfslPathMap`, `PathAt`, `PathValue`, `PathPatchValue`, and `PathElementValue` through a host-owned adapter;
   - the adapter calls public `NamespaceLease.readData()` and `mutateData()`;
   - one narrow assertion may bridge a successful runtime result to its projected type;
   - application call sites contain no `any`, source-deep imports, or live `Y.Doc` access.
7. Preserve literal paths (`as const` for reused tuples). Verify negative cases: unknown paths, wrong values, and array operations on non-array nodes must fail host typecheck.
8. Add host scripts equivalent to generation, freshness check, typecheck, and tests. Until a stable packaged CLI exists, keep absolute checkout paths explicitly marked as local-only configuration.

## Program wiring

First inspect the consuming package's `tsconfig` chain, build/typecheck scripts, `rootDir`, `include`/`files`, project references, declaration/emit mode, and repository package-boundary guards. Use `tsc -p <consumer-tsconfig> --listFilesOnly` as evidence; editor hover or a successful unrelated build is not evidence.

Choose exactly one branch:

### A. One Program may include the domain projection

Add the generated file to the consuming Program through `include`, or add a package-owned type entry such as `src/nomicore-schema.d.ts`:

```ts
import type {} from '../../../../domains/<domain>/generated.js'
```

The relative path is from the type entry. Ensure that `.d.ts` itself is included. This creates no runtime import, but it does pull `generated.ts` into the TypeScript Program.

### B. Build may not cross `rootDir`, but no-emit typecheck may

Keep the ordinary build Program package-local. Create a separate `tsconfig.typecheck.json` and a `typecheck/nomicore-schema.d.ts` type entry. The typecheck Program uses `noEmit: true`, includes package source plus the type entry, and either omits `rootDir` or sets it high enough to cover the repository-level domain projection. Run this Program in package and repository CI.

### C. Every Program is forbidden from reading outside the package

Generate the projection into the package's permitted source/type directory with the supported single-domain mode:

```bash
pnpm generate --domains /path/to/host --domain <domain> \
  --out packages/<consumer>/src/generated/nomicore-schema.ts
pnpm generate --domains /path/to/host --domain <domain> \
  --out packages/<consumer>/src/generated/nomicore-schema.ts --check
```

Relative `--out` resolves from `--domains`. Keep `schema.vfsl` as the sole editable source and exactly one active projection per TypeScript Program; delete the old default projection when moving it package-local. The output remains generated and CI must run `--check`. Do not maintain a copied projection by hand.

Do not add all repository `domains/**/*.ts` to every package: module augmentations merge globally inside a Program, unrelated schemas can pollute path tables, and incompatible top-level fields can collide. Wire only the projection(s) consumed by that package.

### Activation guards

Add a package-local `.test-d.ts` or equivalent compile fixture that fails if the augmentation disappears:

```ts
import type { PathAt, PathPatchValue, VfslPathMap } from '@nomicore/vfsl-protocol'

type Quantity = PathPatchValue<
  PathAt<VfslPathMap, ['items', string, 'quantity']>
>

const valid: Quantity = 12
// @ts-expect-error schema says quantity is numeric
const invalid: Quantity = 'twelve'

type Missing = PathPatchValue<
  PathAt<VfslPathMap, ['items', string, 'missing']>
>
// @ts-expect-error unknown path must fail closed to never
const missing: Missing = 'x'
```

Use paths and values from the actual schema. A guard is complete only when both a known path resolves to its exact value type and an unknown path fails closed. Also inspect `--listFilesOnly` output for the exact generated file.

## Mutation policy: minimal, mergeable, semantic

Design every business write against three simultaneous criteria:

1. **Minimal** — generate the smallest mutation that changes only the intended schema node.
2. **Mergeable** — preserve unrelated Yjs nodes so concurrent edits to other fields, records, and array positions can merge with the smallest conflict surface.
3. **Semantic** — choose an operation whose path and verb state the domain change directly (`set quantity`, `delete optional note`, `insert tag`) rather than encoding it as replacement of an incidental snapshot.

Business updates therefore target the **narrowest independently writable schema path**. For a scalar field, call `set` on that leaf path:

```ts
await lease.mutateData({
  op: 'set',
  path: ['items', itemId, 'quantity'],
  value: nextQuantity,
})
```

For collections, use their structural operations at the collection path: `array-insert` / `array-delete`; use `set` only for a `plain`, `leaf`, or XML terminal that is intentionally replaced as one value. When a typed path descends through an array element, its index segment is a `number` (`0`, `index`), never a numeric-looking string (`'0'`); string segments address object/Record keys, while number segments address array positions. Add or remove a Record entry at that entry path. Preserve every unaffected Yjs container and sibling.

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

Array element paths use numeric segments. Keep `['assignments', 0, 'headSha']` or `['assignments', index, 'headSha']` with `index: number`; reject `['assignments', '0', 'headSha']`, `String(index)`, and template-string indices. A string segment means an object/Record key. Add a negative type fixture for every typed adapter that writes through an array, proving the numeric-looking string form fails compilation.

The runtime SCHEMA passed to Registry creation or an existing namespace's `replaceSchema()` must come from the same `schema.vfsl`. Generated types do not replace that text. For an existing namespace, complete the Hub/Peer rollout in [schema-evolution.md](schema-evolution.md) before publishing writers that use changed paths.

## Completion gate

Complete when generation succeeds, `--check` reports fresh output, generated files are tracked by the host, `tsc --listFilesOnly` proves the consuming Program contains the exact projection, and activation guards prove a known path's exact type plus an unknown path's fail-closed behavior. Positive access code type-checks, intentional invalid examples are rejected, and every business write is demonstrably minimal, mergeable, and semantic: its verb/path describe the intended change, it preserves unrelated Yjs nodes, and it does not reconstruct ROOT or a parent container. Runtime failures remain handled as structured results, concurrency tests cover independent edits where relevant, and both the package-local build Program and the projection-aware typecheck Program pass their required CI gates.

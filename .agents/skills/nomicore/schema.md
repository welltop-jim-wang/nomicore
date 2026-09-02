# VFSL schema branch

Author the schema inside the independent host repository. Treat it as the single source for runtime SCHEMA and generated TypeScript.

## Process

1. Read the host's domain requirements, terminology, existing schema/tests, and its nearest agent instructions.
2. Read `$NOMICORE_ROOT/docs/vfsl/schema-authoring-guide.md`; use `$NOMICORE_ROOT/docs/vfsl/v1-spec.md` when syntax or semantics are uncertain.
3. Create or edit `domains/<domain>/schema.vfsl` with required headers:

   ```vfsl
   // @lang: vfsl
   // @id: <domain>@1
   // @version: 1
   ```

   The id base must equal `<domain>`. Define exactly one map-shaped `ROOT`. Keep SCHEMA identity and META lifecycle facts out of ROOT. Choose carriers by synchronization/write granularity and document non-obvious domain meaning with adjacent JSDoc.
4. Validate directly from the Nomicore checkout before code generation:

   ```bash
   cd "$NOMICORE_ROOT"
   pnpm schema:check /absolute/path/to/host/domains/<domain>/schema.vfsl
   ```

   If the host has a representative plain JSON ROOT snapshot:

   ```bash
   pnpm schema:check /absolute/path/to/host/domains/<domain>/schema.vfsl \
     --data /absolute/path/to/root-example.json
   ```

5. Fix every diagnostic at its source. Preserve structured constraints in VFSL rather than replacing them with comments or parallel handwritten TypeScript.

## Completion gate

Complete when the schema command exits 0, representative ROOT data validates when available, ROOT contains only domain data, every carrier matches required mutation granularity, and the host has exactly one editable schema source for that domain.

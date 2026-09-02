# Existing namespace schema replacement

Replace an existing namespace's SCHEMA only through a Hub-owned `NamespaceLease`. Read `$NOMICORE_ROOT/docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`, `$NOMICORE_ROOT/docs/adr/0010-hub-peer-websocket-ydoc-replication.md`, and the `replace-schema` row in `$NOMICORE_ROOT/docs/integration/hub-peer-deployment.md` before execution.

## Process

1. Identify the owning Hub, owner partition, persisted `namespaceId`, current SCHEMA envelope, representative current ROOT, connected Peers, and the business code that will use changed paths. A Peer cannot replace SCHEMA locally.
2. Edit the host's sole `domains/<domain>/schema.vfsl`; update its schema identity according to the host's versioning policy. Validate the proposed schema and a representative complete post-change ROOT with `schema:check`.
3. Regenerate the TypeScript projection and run freshness plus projection-aware typecheck before deploying any writer that uses new or changed paths. Wrong generated diffs are fixed in `schema.vfsl`, never by editing generated output.
4. Choose exactly one replacement branch:
   - **Keep ROOT** — use when the complete current logical ROOT already validates against the proposed schema, such as adding an optional field or widening a value constraint.
   - **Replace ROOT** — use when the current ROOT is incompatible, such as adding a required field. Construct and validate the complete final logical ROOT; `root` is not a patch, merge, projection, or migration callback.
5. Open the existing namespace on the Hub with the same owner and `namespaceId`, retain the lease, then call:

   ```ts
   const result = await lease.replaceSchema({
     schema: proposedEnvelope,
     // root: completeFinalRoot, // required only for the replace-ROOT branch
   })
   ```

   Branch on `result.ok` and stable issue codes. A rejection is zero-write. Do not edit snapshots, live `Y.Doc`, SCHEMA maps, Persistence handles, or a Peer replica to perform schema replacement.
6. After success, verify the Hub lease reports the expected schema identity and that business reads/writes under the proposed schema behave as tested. Success means the local sequenced SCHEMA transaction and dirty registration completed; it does not prove disk flush, Peer propagation, or Peer Runtime activation.
7. Coordinate Peers before enabling writers that use changed schema paths. Replicated SCHEMA bytes do not hot-switch an already materialized Peer Runtime's active schema. Use the documented controlled reset/re-bootstrap or restart procedure, wait for the target to return `live`, and verify the new schema before publishing dependent Peer business capabilities.
8. Release the lease and complete the owning Host's normal lifecycle. Preserve the previous schema/root evidence and an explicit rollback plan; rollback is another reviewed Hub replacement, not snapshot overwrite.

## Replacement decision table

| Proposed change | `root` argument | Required action |
| --- | --- | --- |
| Add optional field | Usually omit | Prove current complete ROOT validates |
| Widen compatible value constraint | Usually omit | Prove current complete ROOT validates |
| Add required field | Supply | Build complete final ROOT containing the field |
| Remove/rename field | Usually supply | Build complete final ROOT without stale/unknown keys |
| Change carrier or container shape | Supply | Explicitly rebuild complete logical data for the new shape |

## Guardrails

- `replaceSchema()` is Hub-only; Peer returns `REPLICATION_ROLE_PERMISSION`.
- Provided `root` is closed-validated as-is. Unknown keys, missing required fields, non-plain values, and `undefined` fail loudly.
- Replacement runs through the namespace's unique write sequencer. Keep ordinary business writes quiesced or explicitly coordinated when the replacement changes their accepted shape.
- Generated TypeScript types and runtime SCHEMA must come from the same edited `schema.vfsl`.
- Updating SCHEMA is not a general migration engine. The owning Host designs any data transformation and supplies the complete final ROOT.

## Completion gate

Complete only when the proposed schema and final ROOT validate, generated projections are fresh, all affected writers pass projection-aware typecheck, Hub `replaceSchema()` succeeds through a lease, Hub behavior is verified, every required Peer is reset/restarted and returns `live` with the new schema, dependent business capabilities are published only afterward, and no snapshot or live Yjs object was edited directly.

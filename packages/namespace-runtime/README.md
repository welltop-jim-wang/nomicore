# `@nomicore/namespace-runtime`

`NamespaceRuntime` owns one persistence `DocHandle` for one namespace and exposes synchronous reads plus serialized ROOT/SCHEMA writes.

## Public API

The package entry exports the `NamespaceRuntime` interface and related result/status types. It intentionally does **not** export a production constructor, the owned `DocHandle`, the live `Y.Doc`, writable ROOT/SCHEMA/META references, the sequencer, queue state, or testing seams.

Production assembly is performed by the owning registry layer through the restricted `@nomicore/namespace-runtime/internal` subpath (`createNamespaceRuntimeForRegistry`, consumed only by `@nomicore/namespace-registry` production code). Tests inside this package may import the internal seam constructor directly from `src/runtime.ts`; it is not a business API.

### Reads

- `read(path)` projects a schema-independent logical value from the live ROOT carrier.
- `getSchemaEnvelope()`, `getMetadata()`, and `getActiveSchema()` return detached projections and never expose live writable Yjs references.
- Reads do not enter the write sequencer. New reads and projection getters stop being accepted once `close()` enters `closing`; `getStatus()` remains available.

### Writes

- `mutateRoot(mutation)` performs a validated ROOT mutation.
- `replaceSchema(input)` compiles a proposed schema and atomically replaces SCHEMA plus, when supplied, the complete ROOT generation. A supplied ROOT is validated as-is; unknown top-level or nested keys fail loudly with zero writes.
- P0, ROOT writes, SCHEMA writes, and the close barrier share one FIFO sequencer. Inputs are snapshotted at slot start, and dirty notification remains part of the slot.
- Persistence degradation rejects new writes without disabling reads. Internal fatal errors permanently disable writes while preserving reads.

### Lifecycle

`close()` is idempotent and returns the same Promise. It synchronously enters `closing`, stops new read/write acceptance, drains accepted slots, calls `handle.release()` exactly once, and then enters `closed`. A release failure rejects the Promise but does not revert the lifecycle.

`getStatus()` reports lifecycle and capability truth without exposing queue internals. `owner` and `namespaceId` are identity projections only; they are not authorization proof.

## Contract sources

The normative behavior is defined by root `CONTEXT.md` and `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md`. Historical `wiki/raw/` artifacts are non-normative; superseded designs are marked at the top and link to their replacement.
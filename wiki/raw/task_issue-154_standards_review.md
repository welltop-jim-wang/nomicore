# Standards Review — issue #154 (commits c0f6cbc, 385a376, 739a24b; diff 722bddf...HEAD)

Standards sources: root `AGENTS.md`, `packages/namespace-diagnostic-log/AGENTS.md`. Read-only review.

## Verdict: PASS — no blocking findings. 4 low-severity observations, all non-blocking.

## Documented-standards compliance (explicit pass)

- **Binding face (#154 clause)**: `src/retention.ts` and `src/read-session.ts` are pure TS — zero `node:*` imports (verified by grep); enumeration via reader's `enumerateSegmentGroups`, paths via `paths.ts`; all sweep/deletion IO stays in `src/adapters/file.ts`. PASS.
- **Reserved filenames (INV-13)**: every new scan uses the `isSafeStreamId` / `enumerateSegmentGroups` grammar gates (`scanSweepStreams`, `deleteNamespaceDiagnosticLog` N3 branch, `enumerateSegmentGroups` `.deleting` exclusion). PASS.
- **Lease registry (INV-9)**: module-level, partitioned by `(rootDir, namespaceId)`, process-internal, no cross-process locks — exactly as documented. PASS.
- **Event whitelist**: `retention-swept` carries exactly the six documented count fields; `retention-config-invalid{field}` closed enum; `stream-init-failed.reason` adds `'namespace-log-deleted'`; no streamId/segment/offset in events (report object is data-plane, allowed). PASS.
- **Trigger discipline (INV-14)**: sweep only at construction (`sweepOnOpen`) + explicit `sweepRetention()`; not on `emit`/`beforeCommit`. PASS.
- **Incrementality**: `index.ts` exports purely additive; `schema.ts` untouched; test helpers appended only, zero existing test assertions changed; no new dependencies; `docs/adr/**` untouched. PASS.

## Findings (Fowler baseline; smells are judgment calls)

1. **Duplicated Code — P1 age pass vs P2 byte pass** (`adapters/file.ts` `sweepNow`): ~30 lines of shared enumerate→open-check→lease-check→delete scaffolding. **Low, non-blocking** — the duplication embodies the documented SA4 R1 ruling that the two limits stay independent and non-gating (repo standard overrides smell). A shared per-stream deletion-cursor helper could dedupe without re-coupling gates.
2. **Duplicated Code — minor repetitions** (`adapters/file.ts`): (a) `hygieneStream`'s S2/S3 unlink pair repeats `deleteGroup`'s tail; (b) the `try { enumerateSegmentGroups } catch { failedSteps++ }` block appears 5×; (c) magic placeholder `'log-' + '0'.repeat(32)` appears 3× — deserves a named constant. **Low, non-blocking.**
3. **Primitive Obsession / Data Clump — `RetentionSweepReport`** doubles as mutable accumulator (`failedSteps += 1` at ~12 sites) and public result. **Low, non-blocking** — the field set is the documented §2.2 public contract; a collector class isn't warranted.
4. **Dead vestige — `n`/`void n` in T-D3** (`file-adapter-namespace-deletion.test.ts`): counter incremented then discarded. **Trivial, non-blocking.**

Explicitly dismissed: file.ts growth (Divergent Change) — IO收口 in `adapters/file.ts` is mandated by AGENTS.md; test-file scaffolding duplication — deliberate red-light self-containment (SA6 convention); no Mysterious Name, Feature Envy, Repeated Switches, Shotgun Surgery, Speculative Generality, Message Chains, Middle Man (bar trivial `rmSyncInTest` wrapper), or Refused Bequest observed.

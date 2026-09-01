# Spec Review — Issue #154: Retain, lease, and delete namespace diagnostic logs

**Axis**: Spec (engineering/code-review) | **Date**: 2026-08-31
**Diff**: `722bddf...HEAD` (c0f6cbc, 385a376, 739a24b) — 15 files, +2681/−32, all inside `packages/namespace-diagnostic-log`
**Spec**: issue #154 requirement list; parent ADR `docs/adr/0012-...md:280-299`
**Context read**: SA4 R1/R2, SA7 report; diff inspected independently (file-by-file), suite independently re-run.

## Verdict: **PASS**

## Requirement traceability

| Spec requirement | Evidence | Status |
|---|---|---|
| Configurable maxAge / maxBytesPerNamespace; defaults 30d / 1 GiB (ADR 282-287) | `retention.ts` `DEFAULT_RETENTION_MAX_AGE_MS=2_592_000_000`, `DEFAULT_RETENTION_MAX_BYTES=1 GiB`; `FileRetentionConfig` wired via `file.ts` config; T-A7 | ✅ |
| Explicit `null` disables a limit; `0` keeps documented non-unlimited meaning (ADR 289) | `validateLimit`: `null→null` (off), `0→all closed groups expire` (`retention.ts` doc + README table "0 = …立即过期（**非无限**）"); T-A4 (双 null 零动作), T-A5 (0/0 尽删闭组、开组原样) | ✅ |
| First-to-hit, limits independent (ADR 289) | 385a376 removed the P2 age-freshness gate (`file.ts` P2 comment "无年龄新鲜度门"); T-A9 pins byte budget under fresh data; SA4 R2/SA7 counterfactually proved T-A9 red on c0f6cbc | ✅ |
| Only closed + unleased groups; never open group (ADR 289) | P1/P2: `openSegmentOf` guard + `segmentLeased` + prefix discipline (first undeletable stops stream); INV-1 covers BIN-first transient; T-B1/B4/B5, T-C1/C7, T-B6 | ✅ |
| JSONL-as-commit-marker deletion, resumable across restart (ADR 291-295) | `deleteGroup` S1 rename `.jsonl`→`.deleting` → S2 unlink `.bin` → S3 unlink marker; hygiene pass (P0, unconditional) completes leftover `.deleting` and orphan BINs (open group exempt); W0–W3 cover every interrupted step, T-E8/T-E7 orphan; SA7 real-SIGKILL W1/W2 | ✅ |
| Short-lived renewable leases; expired leases never block forever (ADR 297) | `read-session.ts`: ttl default 15s, `renew()`, `close()`, `maxLifetimeMs` (default null = explicit-renewal mode, permitted by "最大lease时长**或**显式续租"); expiry lazily judged `leasedUntil > now` → cannot block; T-C1–C8 | ✅ |
| Retained-history reporting via scan, not manifest (ADR 297) | `readStreamStrict` adds `historyTrimmed` + `earliestRetainedSequence` (structural rule: lowest live segment ≠ `00000001`); sweep report `earliestRetained`/`historyTrimmedStreams` rebuilt by scan; T-E1–E3 (mid-hole still corrupt) | ✅ |
| Logical namespace deletion: locator/manifests/JSONL/BIN/deletion markers/indexes; no secure-erase claims (ADR 299) | `deleteNamespaceDiagnosticLog`: marker gate → unlink `current.json`(+tmp) → per-stream rename→rm → `rmSync(namespaceDir)` (covers all on-disk artifacts; adapter has no separate index file) → lease partition released; vocabulary = deleted/absent/failed, no erase/purge/secure; T-D1–D9 (incl. half-state gate, reentry, fresh lineage) | ✅ |
| Test list: frontiers / open protection / leases / every interrupted step / orphan / history reporting / full deletion | T-A1–A9, T-B1–B10, T-C1–C8, W0–W3, T-E1–E8, T-D1–D9 — all present, all red-first per SA6 | ✅ |

**Scope creep**: none. All 15 files within the package (src, 5 test files + helpers, README/AGENTS.md, package.json 0.1.4→0.1.5); exports purely additive; ADR and other packages untouched.

## Non-blocking observations (Info)

1. `maxBytesPerNamespace` accounting = JSONL+BIN only, excludes `manifest.json`/`current.json` (~KB); conservative and consistently applied in report (SA7 O1).
2. `sweepOnOpen:false` defers ADR-294 startup completion of leftover `.deleting` to the next explicit sweep (default `true` complies).
3. ADR-299 Host obligation ("Host 执行数据删除请求时必须同时调用日志删除能力") is not wired here — Host integration deferred to #155; outside this package's diff scope.

## Verification

`npx vitest run packages/namespace-diagnostic-log/` → **27 files / 427 tests passed, Type Errors: none** (independently re-run this review).

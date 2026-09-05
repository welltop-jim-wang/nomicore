# Acceptance Criteria Checklist — Issue #150

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | Namespace create emits structured outcomes for acceptance, duplicate, input snapshot, schema compile, validation, transaction/Persistence, and post-commit Runtime construction using stable facts. | ✅ | SA6 contract `packages/namespace-registry/test/registry-create-diagnostic-red.test.ts` maps and exercises all listed paths; SA7 report Step 1 independently reran 72/72 tests including its 16 contractual cases; SA4 R2 verified 18 insertion points and stable stage/code/result mappings. | Closed by implementation commits `85f36bd`, `0f72527`. |
| AC2 | Successful creation supplies detached initial Y.Doc genesis bytes; post-commit fatal preserves committed fact. | ✅ | SA6 AC2 File-adapter E2E asserts genesis-baseline seq 1 plus attempt seq 2 and materialized SCHEMA/META/ROOT; post-commit factory fatal asserts `committed:true` and update bytes. SA7 dynamic suite passes, including its one-attempt/no-double-record checks. | Closed. |
| AC3 | Pre-input failures avoid caller payload; later capture reuses detached safe snapshot. | ✅ | SA6 contract covers shutdown/entry duplicate `not-accessed`, hostile payload/snapshot failure, proxy trap parity and queued mutation snapshot reuse. SA7 reran the contract green; SA4 R2 verified raw-issues and seam isolation boundaries. | Closed. |
| AC4 | Logging disabled, stream-init failure, queue pressure, and sink failure do not change business result, Persistence, or Registry lifecycle. | ✅ | SA6 AC4 cases cover disabled-vs-enabled equivalence, emitter throw, bounded-memory queue pressure, and real File-adapter invalid-roll-target initialization. SA4 R2 and SA7 independently reran these anchors; SA7 added malformed seam forms and shutdown/in-flight isolation checks. | Closed. |
| AC5 | Tests cover successful genesis, duplicate, validation rejection, persistence failure, post-commit construction failure, delayed initialization with honest current-state genesis. | ✅ | SA6 16-test contract covers every listed scenario. SA6 R2 corrected AC5 to failed first init → ROOT n=2 mutation → valid retry/new stream, retaining the n=1 anti-forgery check. SA7 confirms 16/16 green and adds File-adapter/FIFO dynamic coverage. | Closed. |

## Gate conclusion

All five acceptance criteria are independently evidenced by SA6 contract tests, SA4 implementation review, and SA7 dynamic validation. No remaining AC gap is identified.

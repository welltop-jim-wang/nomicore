# Issue #149 — Record ROOT mutations and SCHEMA replacements

## Task type
Bugfix

## Parent
PR #142 (`docs/namespace-diagnostic-change-log`)

## Objective
Connect real NamespaceRuntime ROOT mutations and SCHEMA replacements to the namespace diagnostic change log. Operators must be able to distinguish committed updates, no-ops, expected rejections, and committed-aware fatal outcomes through stable stage and code while preserving sequencer ordering, zero-write guarantees, dirty notification behavior, capability state, and hostile-input access discipline.

## Acceptance criteria
1. ROOT mutation and SCHEMA replacement attempts emit frozen operation, source/context, stage, stable code, issues, committed fact, and effect classification for every existing result path.
2. Successful transactions provide detached owned Yjs update bytes for the exact transaction effect; no-op and update-omitted outcomes remain explicit and no live Y.Doc escapes.
3. Acceptance and capability-gate rejection records mark input as not accessed; later records consume only the operation's existing detached safe snapshot.
4. Logger throw, queue-full, validation failure, and sink failure do not alter business return values, commits, write-sequencer order, dirty notification, or Runtime capability.
5. Tests cover committed, rejected, fatal-before-commit, fatal-after-commit, and Proxy/accessor inputs with zero additional reads caused by logging.

## Dependency note
Blocked by #148, which may not yet be merged. Execute against the current worktree and record any resulting limitation in the final report.

---

## SA6 Phase 1 — 红灯契约（2026-08-29，实现前初始契约）

### 契约锚点（行为验证，全部运行时断言，无源码 grep）

- **测试文件**：`packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts`（14 it，14/14 红灯）。
- **注入面（字段名即契约锚点，SA1/SA3 按此落地 seam）**：
  - `NamespaceRuntimeSeamInput` 新增可选 `diagnosticEmitter?: NamespaceDiagnosticChangeEmitter`（`@nomicore/namespace-diagnostic-log` 的 emitter 接缝；测试经 `createBoundedMemoryDiagnosticLog(...).emitter` 装配）；
  - `NamespaceRuntimeSeamInput` 新增可选 `clock?: () => number`（结构兼容 observedAtFrom / @nomicore/clock Clock.now —— `observedAt` 必须来自注入 Clock）。
- **stage/code/result 映射（本契约冻结；沿用 SA5 映射，歧义处取 ADR 语义）**：
  - lifecycle 拒接纳（close 后写）→ `acceptance` / `RUNTIME_WRITE_DISABLED` / `rejected` / input `not-accessed`（ROOT 与 SCHEMA 两条）；
  - S1 fatal 已置位后的排队写 → `capability-gate` / `RUNTIME_WRITE_DISABLED` / `rejected` / `not-accessed`；
  - S2 门（handle 不可写 / notifyDirty 未绑定）→ `capability-gate` / `RUNTIME_WRITE_DISABLED` / `rejected` / `not-accessed`；
  - S2 getStatus 抛错 → fatal `committed:false`，`capability-gate`，code `NSRT-FATAL-WRITE-INTERNAL`，sourcePhase `write-slot-internal`，sourceModule `runtime`，input `not-accessed`；
  - S3 快照失败（敌意 accessor）→ `input-snapshot` / `MUTATION_INPUT_NOT_PLAIN_DATA` / `rejected` / input `unsafe-input`，且 accessor 零执行、零额外读取；
  - S4 schema unavailable → `capability-gate` / `SCHEMA_UNAVAILABLE` / `rejected` / input 已捕获（digest——快照成功后才到 S4）；
  - S4 schema 编译失败（畸形 text）→ `schema-compile` / `SCHEMA_TEXT_INVALID` / `rejected`；
  - S4 compile 抛错（守卫）→ fatal `committed:false`，`schema-compile`，code `NSRT-FATAL-SCHEMA-WRITE-INTERNAL`，sourcePhase `schema-compile-throw`；
  - S5 领域校验失败（ROOT）→ `validation` / `rejected` / issues 非空 / input 已捕获；
  - S5→S7 成功（ROOT 与 SCHEMA，含 keep-root 与 replace-root 两分支）→ `transaction` / `committed` effect `update`（updateCapture:true 且 payload 正常时）——**update 必须为精确事务 owned bytes**：按设计 §6.4 消费形态（同源基态 + 依序增量链）重放可观察到该次事务的真实效果（ROOT 值 / SCHEMA text），禁止以事务后整文档编码冒充（ADR-0011 §D）；
  - S6 notifyDirty 失败 → fatal `committed:true`，`dirty-notification`，code `NSRT-FATAL-WRITE-INTERNAL`，sourcePhase `notify-dirty-failed`，effect `update`（携带该事务精确 effect），live doc 已提交（业务面 committed 事实为真）。
- **记录形状**：attempt record（operation/stage/observedAt/source `{kind:'local'}`/attemptId `att-+32hex`/input/result；committed 无 code）；管线 code↔sourceModule 成对（code 出现则 sourceModule 必为 `runtime`）。
- **AC4 故障隔离**：emitter.emit 抛错被吞没——业务返回值、FIFO 顺序、dirty notification、capability（`getStatus().fatal === null`、handle ready）全不变，且两次尝试恰好各 emit 一次（当前红灯：emitCalls 0≠2）；队列满（capacity 1）→ 第二条记录 drop，`stats().accepted===1 / droppedTotal===1`，业务两写均 ok 且顺序正确。
- **AC5 零额外读取**：合法 Proxy 输入（get trap 计数）下，装配日志与无日志基线的 trap 计数相等；敌意 accessor 输入下 accessor 零执行。当前红灯仅因「记录不存在」（poll 超时）；修复后该两项为回归守卫（若日志重读原输入即变红）。
- **依赖说明**：`@nomicore/namespace-diagnostic-log` 尚非 namespace-runtime 依赖（SA5 E2），测试以相对路径 `../../namespace-diagnostic-log/src/index.js` 引入真实内存 adapter（非 mock、非 fallback）；SA3 落地时需把该包加入 `dependencies`。测试文件无需改动即可在修复后转绿。

### 红灯验证（2026-08-29，真实运行）

```
$ npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts --typecheck.enabled=false
 Test Files  1 failed (1)
      Tests  14 failed (14)   （Duration 41.87s）
```

失败证据（均为 bug 症状「0 记录 / 0 emit」，business 断言全部先行通过）：

```
× AC1/AC2 committed：… → Matcher did not succeed in time.
  AssertionError: expected +0 to be 1   ← log.records() 恒 0（emitter 未被接线）
× AC5 零额外读取：… → 同上（logged 对照 0 记录）
× AC1 acceptance：… → 同上（acceptance 层 0 记录）
× AC1/AC4 fatal-before-commit/after-commit：… → 同上
× AC4 emitter 违约 throw：… → AssertionError: expected +0 to be 2  ← emitCalls 0
× AC4 队列满：… → expected +0 to be 1（accepted 0）
（其余 8 条同型：waitAttempts poll 超时，期望 1/2 条记录实际 0 条）
```

**结论**：红灯契约成立——每条既有结果路径当前 0 记录、emitter 零调用；修复方向按 SA5 四层缺口（依赖/注入/发射/owned-bytes）实施后，本套件应 14/14 转绿，且不依赖任何源码文本断言。

### R2 修订（§13.8 carrier 消费形态修正，2026-08-29）——同源基态 + 依序增量链重放

依据设计 §6.4/§13.8（SA1 R2/R3 修正、SA2 R3 通过；§14 P8 实测）：事务增量是**增量**（left origin / delete set 引用 pre-state struct）——应用到空 Y.Doc 不物化（P8：38 bytes 增量 → 空 doc `store.clients=[]`、ROOT 空、不抛错），必须同源基态（事务前 pre-state、同 clientID）+ 依序增量链重放。修订只改测试消费形态，语义断言与断言值零变化：

- `applyCarrier(carrier, baseState, prior=[])`：基态先立 → prior 依序 apply → 本条事务增量；inline/format/payloadLength 三断言不变；
- 3 处 it 在 `makeWriter()` 后、任何写调用前局部捕获 `baseState = Y.encodeStateAsUpdate(handle.doc)`（禁模块级常量——makeDoc 每次新 clientID）；
- 4 个调用点（§13.8c，R3-1 修正计数）：ROOT committed（单笔 baseState）；fatal-after-commit（单笔 baseState）；SCHEMA committed ×2（`recs[0]` 单笔 baseState；`recs[1]` baseState + `prior=[recs[0] 的 carrier]`——第二笔 left origin 依赖第一笔后状态，链式依序为机制必需）；全部终态断言值不变；
- 新增 §13.8d 反向鉴别 `expectNoMaterializeWithoutBase`（3 处）：真增量对无基态空 doc 不物化（`ROOT.size===0 && SCHEMA.size===0`）——若 producer 回归为「事务后整文档编码」冒充则必然物化、立即红（防冒充回归）。
- 机制重验（yjs@13.6.32，与 P8 同版本实测）：ROOT 事务增量 38 bytes；空 doc 应用 → ROOT/SCHEMA size 0；base→tx₁ → `ROOT n=42, a='x'`；SCHEMA keep-root 增量 132 bytes、base→tx₁ → 新 SCHEMA.text 且 ROOT 未动；链 base→tx₁→tx₂ → `ENV_REPLACE.text` + `ROOT {n:2,a:'y',b:true}`；replace-root 增量对空 doc 同样 size 0。

### 转绿验证（2026-08-29，当前 worktree——SA3 已按设计 §16 ALLOW LIST 实施 diagnostic.ts 等）

```
$ npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts --typecheck.enabled=false
 Test Files  1 passed (1)
      Tests  14 passed (14)   （Duration 3.13s，tests 451ms）
```

红灯历史证据保留于上节（Phase 1 初始契约，0 记录/0 emit 时为真红）；§13.8 修订仅应用形态（基态链式重放 + 反向鉴别），不新增/删减 it，转绿判据 14/14 不变。

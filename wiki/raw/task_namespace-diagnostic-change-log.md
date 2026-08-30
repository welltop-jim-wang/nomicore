# Task Brief — Issue #150: Record the namespace creation lifecycle and genesis

- **Repository:** welltop-jim-wang/nomicore (`nomicore`)
- **Issue:** #150
- **Parent:** PR #142 (`docs/namespace-diagnostic-change-log`)
- **Task type:** feature
- **Worktree:** `/home/wangjian/nomicore-fix-issue-150`
- **Branch:** `fix/issue-150-on-docs-namespace-diagnostic-change-log`
- **Run ID:** `issue-150-1788101991-4073122`
- **Round:** 1

## Objective

Record namespace creation from its first observable attempt through duplicate detection, safe input capture, schema and ROOT preparation, Persistence commit, and post-commit Runtime construction. A successful creation or later logging enablement attempts a current Y.Doc genesis, while stream initialization or logging failure never changes create results or namespace availability.

## Acceptance Criteria

1. Namespace creation emits structured outcomes for acceptance, duplicate, input snapshot, schema compile, validation, transaction/Persistence, and post-commit Runtime construction paths using existing stable facts.
2. Successful creation supplies detached genesis update bytes representing the committed initial Y.Doc, and post-commit fatal outcomes preserve their committed fact.
3. Pre-input failures do not access caller payload, and all later input capture reuses the creation path's existing detached safe snapshot.
4. Logging disabled, stream initialization failure, queue pressure, and sink failure do not change create success, rejection, Persistence state, or Registry lifecycle behaviour.
5. Tests cover successful genesis, duplicate, validation rejection, persistence failure, post-commit construction failure, and delayed stream initialization with an honest current-state genesis.

## Constraint

Issue text states it was blocked by #148; implement against the current worktree without waiting for that issue to merge.

---

## SA6 Phase 1 — 红灯契约（2026-08-30，实现前初始契约）

### 契约锚点（行为验证，全部运行时断言，无源码 grep）

- **测试文件**：`packages/namespace-registry/test/registry-create-diagnostic-red.test.ts`（16 it，16/16 红灯）。
- **注入面（字段名即契约锚点，SA1/SA3 按此落地 seam）**：
  - `NamespaceRegistryTestingOverrides`（及 `CreateNamespaceRegistryOptions` 等价生产面）新增可选 `diagnosticLog?: NamespaceRegistryDiagnosticLog`；
  - `NamespaceRegistryDiagnosticLog = { emitter: NamespaceDiagnosticChangeEmitter; initStream?(namespaceId: string, genesisUpdateBytes?: Uint8Array): void }`——emitter 为 #148 冻结接口（「业务模块依赖小 emitter interface」ADR-0011 §Interface）；initStream 为 ADR-0012 stream 建立缝（genesis bytes 由 producer 供给、adapter 内部构造 genesis-baseline——CONTEXT.md「producer 只供 bytes」）；测试经 `createBoundedMemoryDiagnosticLog(...).emitter` 与真实 `createFileDiagnosticLog` 装配（非 mock、非 fallback）；
  - `observedAt` 复用 Registry 既有必需 Clock（`new Date(clock.now()).toISOString()`）——**不得引入第二次 Clock 读数**（测试锚 `clock.calls === 1`；ADR-0009「Clock 单次读数」冻结契约）。
- **stage/code/result 映射（本契约冻结；事实取 Registry 既有稳定码，不发明新码）**：
  - 停接纳拒绝（shutdown 后 create）→ `acceptance` / `REGISTRY_NOT_ACCEPTING` / `rejected` / input `not-accessed`（零 trap——停接纳先于一切输入访问）；
  - entry duplicate（active/idle entry）→ `acceptance` / `NAMESPACE_ALREADY_EXISTS` / `rejected` / `not-accessed`（pre-input：entry 检查先于 payload 快照）且 schema/root 零 trap；
  - 持久层 duplicate（DOC_DUPLICATE）→ `transaction` / `NAMESPACE_ALREADY_EXISTS` / `rejected` / 快照已捕获（已进入 Persistence 提交段——四源同码但阶段真实）；
  - payload 快照失败（敌意 accessor）→ `input-snapshot` / `NAMESPACE_CREATE_INVALID_INPUT` / `rejected` / input `unsafe-input`，accessor 零执行；
  - schema 编译失败 → `schema-compile` / `NAMESPACE_SCHEMA_INVALID` / `rejected` / issues 非空 / 快照已捕获；
  - ROOT 校验失败 → `validation` / `NAMESPACE_ROOT_INVALID` / `rejected` / issues 非空 / 快照已捕获；
  - Persistence 运营失败 → `transaction` / `NAMESPACE_CREATE_FAILED` / `rejected` / 快照已捕获；
  - 成功提交 → `transaction` / `committed` + effect `update`（**初始文档 owned bytes**：create 事务无 pre-state，对空 Y.Doc 应用即全量物化 SCHEMA 四键/META 二键/ROOT——精确 effect，无 #149 增量基态问题）/ 无 code（ADR-0011「committed 无 code」）/ input 快照；
  - 提交后 Runtime 构造失败 → `transaction` / fatal `committed:true` / code `NAMESPACE_REGISTRY_FATAL` / sourcePhase `runtime-construction` / sourceModule `registry` / effect `update`（初始文档 bytes——committed 事实保留）；业务面同时断言 `NamespaceRegistryFatalError{phase:'runtime-construction', committed:true}` 与「文档保留可 open」。
- **AC2 genesis**：成功 create 后 `initStream` **恰一次**、携带提交初始文档的 detached bytes（genesis-baseline seq 1 物化 = SCHEMA/META/ROOT）；真实 File adapter E2E：`createFileDiagnosticLog({genesisUpdateBytes})` → `readStreamStrict` → stream 上 `genesis-baseline`(seq 1) + `attempt`(seq 2)，manifest 存在、observedAt 同源注入 Clock。
- **AC3 零额外读取与既有快照复用**：合法 Proxy 输入下 logged 与无日志基线的 schema/root trap 计数相等；排队后（createDoc gate 前）变异调用方原对象 → 记录 input 恒为槽内 frozen snapshot（`{schema, root}` 深克隆）而非变异后原对象。
- **AC4 故障隔离（四不变）**：emitter 违约 throw → create ok/status running/lease active/创建恰一次，emit 恰一次尝试；队列满（capacity 1）→ 第一条 accepted、第二条 queue-full drop（stats 计数），业务双创建均 ok；日志启用 vs 禁用（baseline）→ 业务结果逐位一致（同 namespaceId/同 Clock 下 metadata/status/registryState）且启用侧有记录；stream init 失败（真实 File adapter invalid roll targets）→ create ok + 独立健康 observer `LOG_STREAM_INIT_FAILED/invalid-roll-targets`（绝不手工伪造事件）。
- **AC5 延迟 stream 初始化（诚实当前态 genesis）**：变更 ROOT（n:1→n:2）后以当时 Y.Doc（Host 经 Persistence loadDoc 取 bytes）建立新 stream → genesis 物化 `ROOT.n=2`（若伪称「从创建时起连续」则 n=1——反向鉴别锚）。
- **依赖说明**：`@nomicore/namespace-diagnostic-log` 尚非 namespace-registry 依赖，测试以相对路径 `../../namespace-diagnostic-log/src/index.js` 引入真实 adapter（非 mock、非 fallback）；SA3 落地时需把该包加入 `dependencies`。测试文件无需改动即可在修复后转绿。
- **测试策略**：沿用 vitest 单文件收集（`packages/*/test/**/*.test.ts`）；无端口、无外部服务、无新测试包（log 包经相对路径），`scripts/test-lock.sh` 在本 worktree 不存在（无端口/新包 → 无需新增）。

### 红灯验证（2026-08-30，真实运行；终版文件经异步竞态加固后的复跑）

```
$ cd /home/wangjian/nomicore-fix-issue-150
$ ./node_modules/.bin/vitest run packages/namespace-registry/test/registry-create-diagnostic-red.test.ts --typecheck.enabled=false
 Test Files  1 failed (1)
      Tests  16 failed (16)   （Duration 51.09s，tests 48.36s）
```

失败证据（16/16 统一红灯签名：**0 记录 / 0 emit / 0 initStream**——所有成功路径的业务断言
（create ok / createdAt / Clock 单读 / trap 计数 / 业务结果逐位一致）均先于日志侧锚点通过，
即 16 项失败全部由「日志记录与 stream 初始化缺席」驱动，无一因业务断言误红）：

```
× AC1/AC2 成功 create：… → Matcher did not succeed in time.
  Caused by: AssertionError: expected +0 to be 1   ← log.records().filter(attempt).length 恒 0（emitter 未接线）
× AC2 genesis 落盘（File adapter E2E）：… → Matcher did not succeed in time.
  （poll fileLog !== undefined 超时——initStream 从未调用，磁盘零 stream）
× AC1 重复（entry duplicate）：… → expected +0 to be 2（记录 0）
× AC1 持久层重复（DOC_DUPLICATE）：… → expected +0 to be 1（记录 0）
× AC1 停接纳拒绝：… → expected +0 to be 1（记录 0）
× AC1/AC3 敌意 payload：… → expected +0 to be 1（记录 0）
× AC1 schema 编译失败：… → expected +0 to be 1（记录 0）
× AC1 ROOT 校验失败：… → expected +0 to be 1（记录 0）
× AC1 持久层运营失败：… → expected +0 to be 1（记录 0）
× AC2 提交后构造失败：… → expected +0 to be 1（记录 0）
× AC3 零额外读取/快照复用：… → expected +0 to be 1（记录 0）
× AC4 emitter 违约 throw：… → expected +0 to be 1  ← emitCalls 0
× AC4 队列压力：… → expected +0 to be 1（accepted 0）
× AC4 日志启用不改变业务：… → Matcher did not succeed in time.（business 逐位一致已在先通过；日志侧 0 记录）
× AC4 stream 初始化失败隔离：… → expected +0 to be 1  ← initCalls 0 / 0 健康事件
× AC5 延迟 stream 初始化：… → Matcher did not succeed in time.（initStream 未调用 → fileLog 恒 undefined）
```

第一轮复跑（poll 加固前）另有 2 项以 `expected undefined to be defined` 直接暴露
initStream 零调用（AC2 落盘、AC5 延迟初始化）；加固为 poll（契约不锁定 emit/initStream
相对 create() 结算的先后——ADR-0011「emitter 不被 await」）后统一为 poll 超时形态，
红灯语义不变（同为日志侧缺席驱动）。

**结论**：红灯契约成立——每条 create 结局路径当前 0 记录、emitter/initStream 零调用；
修复方向按 seam（`diagnosticLog` 注入：emitter + initStream）接线 create 全路径 + genesis
bytes 供给后，本套件应 16/16 转绿，且不依赖任何源码文本断言。

**独立性验证**：`./node_modules/.bin/tsc -p tsconfig.typecheck.json`（仓库 CI 门禁，含
`packages/*/test/**/*.ts`）exit 0、0 errors；既有 `registry-create.test.ts` 50/50 通过
（附件测试不与既有套件互扰）。

# SA3 实现报告 — namespace create 生命周期与 genesis 接入诊断变更日志（issue #150）

**日期**：2026-08-31
**权威契约**：`wiki/raw/task_namespace-diagnostic-change-log_design.md`（SA1 R2；SA2 R2 pass——三强制项 R2-M1/M2/M3 落实，零新阻塞项）
**红灯基线**：`packages/namespace-registry/test/registry-create-diagnostic-red.test.ts`（SA6 冻结，16 it 全红——0 记录/0 emit/0 initStream，本报告实现前复跑确认）
**实现 commit**：见文末 §7（branch `fix/issue-150-on-docs-namespace-diagnostic-change-log`）

---

## 1. 变更清单（SA1 设计 §10 ALLOW LIST 全落地；DENY LIST 零触碰）

| 文件 | 变更 |
|---|---|
| `packages/namespace-registry/src/create-diagnostic.ts`（**新建**） | CreateDiag 诊断环境（`emitOutcome`/`emitEarlyOutcome`/`initStream` 三缝）、`emitAttempt` 吞没内核、`projectIssues` 三层防御（数组级→条目级→整体级）、`projectCompileIssue`（码派生与 p0.toIssueSummary 逐字同源：`SCHEMA_ENVELOPE_${String(code)}` / `SCHEMA_TEXT_INVALID`，R2-M1）、`projectValidateIssue`（逐字段同形透传）、`encodeDetachedState`（encode throw → undefined 诚实缺席）、`fatalFromBytes`（R2-M3：committed+bytes→update / 无 bytes→unknown）、`fatalFromCommitted`（create-document 段：DocRuntimeFatalError committed:true → unknown，其余 committed:false）、`createCreateDiag`（absent → 全 no-op 冻结单例）——**零导出到公共面（index.ts 不 re-export）** |
| `packages/namespace-registry/src/registry.ts`（修改） | `NamespaceRegistryInternalOptions.diagnosticLog?`；构造栈 `createCreateDiag(options.diagnosticLog, clock)` 一行；§7 全部 18 插点（#1 停接纳/#2 identity/#3/#7 entry duplicate/#4-6 closing fatal×3/#8 快照失败/#9 clock fatal 零 emission（§6.3.2c 诚实缺席，插点仅注释说明）/#10 schema-invalid（rawIssues+issuesKind 传 raw，投影在 diag 吞没 try 内——R2-M2）/#11 root-invalid/#12/#13 createDocument fatal/#14 DOC_DUPLICATE/#15 运营失败/#16a/#16b createDoc fatal/#17 成功 committed（state undefined → 不构造 emission，§6.2 #17）/#18 factory fatal（`fatalFromBytes(true, state)`——R2-M3））；`initStream` 在 createDoc resolve 后、factory 前调用（DC-2；传 `state?.slice()` 独立副本）；业务分支/结算/observer/throw 时机零改动；生产工厂透传 `options.diagnosticLog` |
| `packages/namespace-registry/src/types.ts`（修改） | `NamespaceRegistryDiagnosticLog` 接口（emitter 必需 + initStream 可选；sync-only 契约注释）+ `CreateNamespaceRegistryOptions.diagnosticLog?` + 纯 `import type`（零值级引入诊断包运行图——DC-5） |
| `packages/namespace-registry/src/testing.ts`（修改） | `NamespaceRegistryTestingOverrides.diagnosticLog?` + 工厂透传（对齐 runtimeFactory/observer/clock 注入面模式） |
| `packages/namespace-registry/src/index.ts`（修改） | 类型导出白名单追加 `NamespaceRegistryDiagnosticLog`（1 行） |
| `packages/namespace-registry/package.json`（修改） | `dependencies` 追加 `@nomicore/namespace-diagnostic-log: workspace:*` 与 `yjs: ^13.6.30`（yjs 自 devDependencies 上移——src 值级消费诚实化）；**版本 0.1.3 → 0.1.4** |
| `pnpm-lock.yaml`（修改） | 上述依赖变更的 lockfile 更新（workspace link + yjs 移动） |
| `packages/namespace-registry/test/registry-create-diagnostic-code-source.test.ts`（**新建**，SA2 R2 遗留 #1） | 跨包码串单源守护测试（2 it）：未知方言 → `SCHEMA_ENVELOPE_4`、BAD_SCHEMA → `SCHEMA_TEXT_INVALID`（与 p0.toIssueSummary 同串）；反向锚：无 `VFSL-ENV-E`/`VFSL-E` 发明前缀复活 |
| `wiki/raw/task_namespace-diagnostic-change-log_design.md`（修改，SA2 R2 遗留 #2/#3） | §11 「五项→六项」计数校正；§11 第 1 行 `schema-patterns.ts:36-38 → :22-25`（RE_ 副本在 :42-44）；§6.3.4/§11 第 3 行「语义复制先例」措辞按 SA2 事实修正（schema-write.ts:315-317 是**同包直接 import** 先例；跨包语义复制的立论 = internal.ts 值导出冻结 + DENY LIST） |

**DENY LIST 全程零触碰**：`plugin.ts` / `create-document.ts` / `identity.ts` / `errors.ts` / `lease.ts` / `observer.ts` / `packages/namespace-diagnostic-log/**` / `packages/namespace-runtime/**` / `packages/doc-runtime/**` / `packages/persistence/**` / `packages/vfsl/**` 与既有测试文件均未修改。

## 2. 逐红锚转绿证据（SA6 16 项 → 15/16 绿；AC5 剩余红灯见 §4——契约与冻结 adapter 冲突）

最终态全量命令：
- `./node_modules/.bin/vitest run packages/namespace-registry/test/registry-create-diagnostic-red.test.ts --typecheck.enabled=false` → **15 passed / 1 failed（AC5）**（基线 16 failed）
- `./node_modules/.bin/vitest run packages/namespace-registry/test` → **179 passed / 1 failed（同 AC5）**（13 文件 全过；含既有 registry-create 50/50、SA7 活链路、模块边界守卫等零回归）
- `./node_modules/.bin/vitest run packages/namespace-diagnostic-log/test` → **372 passed / 0 failed**（21 文件——冻结契约零触碰确认）
- `./node_modules/.bin/tsc -p tsconfig.typecheck.json` → **exit 0、0 errors**（CI 门禁，含 `packages/*/test/**/*.ts`）

### 15/16 转绿的实现落点（红线 —— 全由「0 记录/0 emit/0 initStream」驱动）

| SA6 锚 | 实现落点 |
|---|---|
| AC1/AC2 成功 create：transaction/committed + initStream genesis bytes + 单时钟读 | 插点 #17（`clock.calls===1`：业务 1 + 诊断复用 0）；#17a initStream 恰一次（state?.slice()）；genesis bytes 物化 = SCHEMA 四键/META 二键/ROOT |
| AC2 genesis 落盘（真实 File adapter E2E）：manifest + genesis-baseline seq1 + attempt seq2 | initStream → `createFileDiagnosticLog({genesisUpdateBytes})` → 磁盘 2 记录、observedAt 同源注入 Clock |
| AC1 重复（entry duplicate） | 插点 #3（acceptance/ALREADY_EXISTS/not-accessed）——全量策略下事实优先 |
| AC1 持久层重复（DOC_DUPLICATE） | 插点 #14（transaction/ALREADY_EXISTS/快照已捕获） |
| AC1 停接纳拒绝 | 插点 #1（acceptance/REGISTRY_NOT_ACCEPTING/not-accessed）——零 trap（诊断零输入读取） |
| AC1/AC3 敌意 payload 快照失败 | 插点 #8（input-snapshot/unsafe-input）——accessor 零执行×2 |
| AC1 schema 编译失败 | 插点 #10（schema-compile/SCHEMA_INVALID + issues 非空——`SCHEMA_TEXT_INVALID` 投影） |
| AC1 ROOT 校验失败 | 插点 #11（validation/ROOT_INVALID + issues 非空——validate 同形投影） |
| AC1 持久层运营失败 | 插点 #15（transaction/CREATE_FAILED） |
| AC2 提交后 Runtime 构造失败 | 插点 #18（fatal committed:true + effect update + 初始文档 bytes；业务 committed:true reject + 文档保留可 open） |
| AC3 既有安全快照复用 + 零额外读取 | 诊断只消费冻结快照（`{snapshot:{schema,root}}` 一次性容器）；排队后变异不影响记录 |
| AC4 emitter 违约 throw | `emitAttempt` 顶层 try/catch 吞没；emit 恰一次尝试（emitCalls===1） |
| AC4 队列压力（capacity 1） | 全同步 emit；adapter 丢弃语义不变（accepted 1 / queue-full 1）——Registry 零感知 |
| AC4 日志启用不改变业务结果 | absent → no-op 单例；启用侧业务面逐位一致 + 有记录 |
| AC4 stream 初始化失败隔离 | `initStream` try/catch 吞没（Host 违约隔离）；`LOG_STREAM_INIT_FAILED/invalid-roll-targets` 由真实 file adapter 的 observer 产生（Registry 不代发） |

## 3. 关键实现决策（与设计的偏差：无；实现期确认点）

1. **`fatalFromBytes`/`fatalFromCommitted` 导出面**：设计 §12 注明「仅 registry.ts 相对导入消费」——二者（含 `encodeDetachedState`、`createCreateDiag`）从 create-diagnostic.ts 模块级导出供 registry.ts 消费，`projectIssues` 保持模块内私有；index.ts 零 re-export（零公共导出纪律不变）。
2. **obserevedAt 复用**：槽内结局全部传 `createdAt` 字符串（`readCreatedAtOrFatal` 产物）；早期结局（#1-#8）由 `emitEarlyOutcome` 读一次 clock（失败 → 丢弃该条）；成功路径 `clock.calls===1` 锚成立。
3. **emit 恒在 initStream 之后**（§6.3.5 固定次序）：`createDoc resolve → encodeDetachedState → diag.initStream(state?.slice()) → factory → diag.emitOutcome(...)`——AC2 pending-buffer 与直通两种 Host binding 均兼容。

## 4. 剩余红灯：AC5 与冻结 adapter 语义的契约冲突（本报告重点）

**现象**：AC5「延迟 stream 初始化」在 `registry-create-diagnostic-red.test.ts:923` 恒失败：`expected 1 to be 2`（late genesis 物化 `ROOT.n=1` 而非 `2`）。

**根因（已源码级 + 复现脚本三重确认）**：AC5 测试的 create 期 `initStream` binding 以**合法配置**调用真实 File adapter 成功建立了 stream S1（manifest + genesis-baseline n=1 + current.json）；随后测试直接调用 `createFileDiagnosticLog({rootDir, namespaceId:'k-ns', genesisUpdateBytes: currentState(n=2), …})` 模拟「延迟初始化」——但 File adapter 的**冻结 reopen 语义**（#153/#166：`file.ts:960-995` `resolveResumeCandidate` ③ locator → `analyzeStreamForResume` → 健康则 `resume`；`file.ts:987` 注释「resume 不写 genesis」）使第二次调用 **resume 同一 stream S1**（`lateLog.streamId === S1`），`genesisUpdateBytes`（当前态 n=2）被**静默忽略**——`readStreamStrict(S1).records[0]` 仍是创建态 genesis（n=1）→ `expect(…get('n')).toBe(2)` 恒红。复现：双调用同一 rootDir/namespaceId → `same stream? true`、`rec0 = genesis-baseline seq 1`、物化 n=1；而「第一次构造失败 + 第二次合法」的 AC4 型流（首调 `targetRecordsPerSegment: 0` → disabled 零落盘 → 次调 fresh）→ 新 stream、物化 n=2——证明测试所需的「新 stream」语义只有「首建失败后重试」可达（即 ADR-0012「后续**重试**成功时以当时 Y.Doc 建立新 stream」的原文场景）。

**结论**：SA6 冻结的 AC5 用例存在**契约内部不一致**：line 896 锚（create 期 initStream 调用 → binding 以合法配置成功建 stream）与 line 920-923 锚（同 rootDir 二次 createFileDiagnosticLog 必须产生**新** stream 且 genesis=当前态）在冻结 adapter resume 语义下互斥。SA1 设计 §3.3 AC5 注记「该行为由 Host 侧 binding + file adapter 既有语义承载」对「既有语义」的判定有误（既有语义 = 同 rootDir/namespaceId 健康 stream 恒 resume、genesis 忽略）。**SA3 无范围内修复路径**（测试为 [SA6 owned] 禁改断言；adapter 在 DENY LIST 禁改；Registry 侧只能保证 initStream 恰一次 + bytes 诚实——已满足）。

**建议处置（二选一，需 SA6/总控裁决）**：
- **A（最小，推荐）**：AC5 首建 binding 改用 AC4 型失败配置（`targetRecordsPerSegment: 0`）——`createFileDiagnosticLog` 返回 disabled 实例（`fileLog` 仍被赋值，line 896 poll 通过）、零 stream 落盘；随后「重试」调用（合法配置 + currentState）产生**新** stream → genesis 物化 n=2——精确兑付 ADR-0012「后续重试成功时以当时 Y.Doc 建立新 stream」；已用独立脚本验证该组合预期全绿。
- **B**：AC5 改为断言冻结 resume 语义：二次调用同 rootDir → 同 streamId、genesis 保持创建态（n=1）、currentState genisis 属「首建失败后重试」场景（同 A 的构造，只是断言方向相反）。

**在裁决前**：AC5 剩余 1 红为契约冲突所致，非实现缺陷；其余 15/16 与全部既有套件零回归。

## 5. SA2 R2 非阻塞项落实

- **R2 遗留 #1 守护测试**：✅ 新增 `registry-create-diagnostic-code-source.test.ts`（2/2 绿——`SCHEMA_ENVELOPE_4` / `SCHEMA_TEXT_INVALID` 与 p0.toIssueSummary 实测同串）。
- **R2 遗留 #2 行号/计数**：✅ 设计文档已修（§11 六项计数 + `schema-patterns.ts:22-25`）。
- **R2 遗留 #3 措辞**：✅ 设计文档已修（schema-write.ts:315-317 = 同包 import 先例；跨包语义复制立论 = internal.ts 冻结 + DENY LIST）。
- **SA2 攻击点 #5（initStream async 逃逸）**：设计 §5.1 已补 sync-only 契约注释——本次实现文档注释随附（Runtime 不做运行时防御，属既有 #149 同款暴露，处置责任在 Host）。

## 6. 剩余风险

| 风险 | 等级 | 说明 |
|---|---|---|
| AC5 契约冲突未决 | **高（阻塞性）** | 需 SA6 修订测试（选项 A/B）；修订后 SA3 无需改实现即可全绿（A 已独立验证） |
| 跨包码派生无机器单源 | 低 | 已以守护测试冻结当前对齐（设计 §6.3.4 语义复制基准仍在名） |
| emit/initStream 同步成本 | 低 | 设计 §8.5 已声明（同步 I/O 计入 create 尝试；Host 可用 memory adapter 规避）；Registry 零异步日志状态 |
| encode 失败全静默角case | 低 | 设计 §8.5 备案（不可达防御；缺失经 stream 有 manifest 无 genesis 可观测） |

## 7. 交付

commit：`<见提交摘要>`（branch `fix/issue-150-on-docs-namespace-diagnostic-change-log`）
- 业务代码：`packages/namespace-registry/`（src×5 + package.json 0.1.3→0.1.4 + test 守护文件 + SA6 红灯契约测试文件终态）
- wiki/raw：本任务 7 份档案（SA6 brief / SA1 R2 design / SA2 R2 review / relevant_decisions / conflict_report ×2 / dispatch）+ 本报告（design 的 3 处 INFO 修订在其原文件内）
- **未提交**：REPORT.md、`.mabf-bg/`（按任务要求排除）

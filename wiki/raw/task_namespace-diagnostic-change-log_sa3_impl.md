# SA3 实现报告 — namespace create 生命周期与 genesis 接入诊断变更日志（issue #150）

**日期**：2026-08-31（R1 实施）；2026-08-31 R2 修订（SA4 R1 reject B1/B2 处置 + SA6 AC5 勘误合流，见 §8）
**权威契约**：`wiki/raw/task_namespace-diagnostic-change-log_design.md`（SA1 R2；SA2 R2 pass——三强制项 R2-M1/M2/M3 落实，零新阻塞项）
**红灯基线**：`packages/namespace-registry/test/registry-create-diagnostic-red.test.ts`（SA6 冻结，16 it 全红——0 记录/0 emit/0 initStream，本报告实现前复跑确认）
**实现 commit**：R1 `85f36bd`；SA6 AC5 勘误 `80a2eb8`（HEAD）；R2（B1/B2 修复）见 §7/§8（branch `fix/issue-150-on-docs-namespace-diagnostic-change-log`）

---

## 1. 变更清单（SA1 设计 §10 ALLOW LIST 全落地；DENY LIST 零触碰）

| 文件 | 变更 |
|---|---|
| `packages/namespace-registry/src/create-diagnostic.ts`（**新建**） | CreateDiag 诊断环境（`emitOutcome`/`emitEarlyOutcome`/`initStream` 三缝）、`emitAttempt` 吞没内核、`projectIssues` 三层防御（数组级→条目级→整体级）、`projectCompileIssue`（码派生与 p0.toIssueSummary 逐字同源：`SCHEMA_ENVELOPE_${String(code)}` / `SCHEMA_TEXT_INVALID`，R2-M1）、`projectValidateIssue`（逐字段同形透传）、`encodeDetachedState`（encode throw → undefined 诚实缺席）、`fatalFromBytes`（R2-M3：committed+bytes→update / 无 bytes→unknown）、`fatalFromCommitted`（create-document 段：DocRuntimeFatalError committed:true → unknown，其余 committed:false）、`createCreateDiag`（absent/null → 全 no-op 冻结单例）——**零导出到公共面（index.ts 不 re-export）**；【R2/SA4 B1】seam 对象属性读取全部纳入真非抛边界：`emitter` 构造期一次捕获 + 形状校验（null / 敌意 getter / 畸形 emitter → 日志禁用 NOOP_DIAG），`initStream` 属性读取+调用同处吞没 try——emit 路径不再读 `diagnosticLog` 本体属性 |
| `packages/namespace-registry/src/registry.ts`（修改） | `NamespaceRegistryInternalOptions.diagnosticLog?`；构造栈 `createCreateDiag(options.diagnosticLog, clock)` 一行；§7 全部 18 插点（#1 停接纳/#2 identity/#3/#7 entry duplicate/#4-6 closing fatal×3/#8 快照失败/#9 clock fatal 零 emission（§6.3.2c 诚实缺席，插点仅注释说明）/#10 schema-invalid（rawIssues+issuesKind 传 raw，投影在 diag 吞没 try 内——R2-M2）/#11 root-invalid/#12/#13 createDocument fatal/#14 DOC_DUPLICATE/#15 运营失败/#16a/#16b createDoc fatal/#17 成功 committed（state undefined → 不构造 emission，§6.2 #17）/#18 factory fatal（`fatalFromBytes(true, state)`——R2-M3））；`initStream` 在 createDoc resolve 后、factory 前调用（DC-2；传 `state?.slice()` 独立副本）；业务分支/结算/observer/throw 时机零改动；生产工厂透传 `options.diagnosticLog` |
| `packages/namespace-registry/src/types.ts`（修改） | `NamespaceRegistryDiagnosticLog` 接口（emitter 必需 + initStream 可选；sync-only 契约注释）+ `CreateNamespaceRegistryOptions.diagnosticLog?` + 纯 `import type`（零值级引入诊断包运行图——DC-5） |
| `packages/namespace-registry/src/testing.ts`（修改） | `NamespaceRegistryTestingOverrides.diagnosticLog?` + 工厂透传（对齐 runtimeFactory/observer/clock 注入面模式） |
| `packages/namespace-registry/src/index.ts`（修改） | 类型导出白名单追加 `NamespaceRegistryDiagnosticLog`（1 行） |
| `packages/namespace-registry/package.json`（修改） | `dependencies` 追加 `@nomicore/namespace-diagnostic-log: workspace:*` 与 `yjs: ^13.6.30`（yjs 自 devDependencies 上移——src 值级消费诚实化）；**版本 0.1.3 → 0.1.4** |
| `pnpm-lock.yaml`（修改） | 上述依赖变更的 lockfile 更新（workspace link + yjs 移动） |
| `packages/namespace-registry/test/registry-create-diagnostic-code-source.test.ts`（**新建**，SA2 R2 遗留 #1 + SA4 R1 B1 回归） | ① 跨包码串单源守护（2 it）：未知方言 → `SCHEMA_ENVELOPE_4`、BAD_SCHEMA → `SCHEMA_TEXT_INVALID`（与 p0.toIssueSummary 同串）；反向锚：无 `VFSL-ENV-E`/`VFSL-E` 发明前缀复活；【R2/SA4 B1】② seam 防御边界回归（新增 4 it，共 6 it）：`diagnosticLog: null` / 敌意 Proxy（emitter getter throw）/ 畸形 emitter（缺失 emit 函数）→ 收敛为日志禁用且 create ok + duplicate resolve + running 零漂移；`initStream` 同步 throw → 吞没隔离 |
| `wiki/raw/task_namespace-diagnostic-change-log_design.md`（修改，SA2 R2 遗留 #2/#3 + R2 登记） | §11 「五项→六项」计数校正；§11 第 1 行 `schema-patterns.ts:36-38 → :22-25`（RE_ 副本在 :42-44）；§6.3.4/§11 第 3 行「语义复制先例」措辞按 SA2 事实修正（schema-write.ts:315-317 是**同包直接 import** 先例；跨包语义复制的立论 = internal.ts 值导出冻结 + DENY LIST）；【R2/SA4 B2】§10 ALLOW LIST 追加 `registry-create-diagnostic-code-source.test.ts`（[SA3 owned] 登记：码串守护 + seam 防御边界回归）；【R2/SA4 观察 1】§12 措辞修正（实际导出不变量 = 模块级导出但不经 CreateDiag 接口暴露、index.ts 零 re-export）；【R2/B1】§6.4 防御表补「diagnosticLog 对象违约」行 |

**DENY LIST 全程零触碰**：`plugin.ts` / `create-document.ts` / `identity.ts` / `errors.ts` / `lease.ts` / `observer.ts` / `packages/namespace-diagnostic-log/**` / `packages/namespace-runtime/**` / `packages/doc-runtime/**` / `packages/persistence/**` / `packages/vfsl/**` 与既有测试文件均未修改。

## 2. 逐红锚转绿证据（SA6 16 项 → **16/16 绿**；R1 的 15/16 + AC5 契约冲突已由 SA6 勘误关闭，见 §4/§8）

最终态全量命令（R2 复跑）：
- `./node_modules/.bin/vitest run packages/namespace-registry/test/registry-create-diagnostic-red.test.ts --typecheck.enabled=false` → **16 passed / 0 failed**（基线 16 failed；R1 末态 15 passed）
- `./node_modules/.bin/vitest run packages/namespace-registry/test/registry-create-diagnostic-red.test.ts packages/namespace-registry/test/registry-create.test.ts packages/namespace-registry/test/registry-create-diagnostic-code-source.test.ts --typecheck.enabled=false` → **3 文件 / 72 passed / 0 failed**（SA6 16it + registry-create 50it + 守护/边界 6it——SA4 固定复验范围）
- R1 全量基线（供对照）：`packages/namespace-registry/test` → 179/180（AC5 除外）；`packages/namespace-diagnostic-log/test` → **372/372**（冻结契约零触碰确认）
- `./node_modules/.bin/tsc -p tsconfig.typecheck.json` → **exit 0、0 errors**（CI 门禁，含 `packages/*/test/**/*.ts`；SA4 独立复跑同结论）

**R2 后 SA4 独立复跑记录**（`task_namespace-diagnostic-change-log_sa4_review.md`）：`registry-create-diagnostic-red.test.ts` 16/16、code-source 2/2（当时）；本报告 R2 后最终态：SA6 16/16 + 守护/边界 6/6 全绿。

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

## 4. AC5 契约冲突：已由 SA6 R2 勘误关闭（历史记录 + 结论）

**R1 时点现象**：AC5「延迟 stream 初始化」在 `registry-create-diagnostic-red.test.ts:923` 恒失败：`expected 1 to be 2`（late genesis 物化 `ROOT.n=1` 而非 `2`）。

**R1 根因诊断（源码级 + 复现脚本三重确认，已获 SA4/S6 独立复核）**：AC5 测试 create 期 `initStream` binding 以合法配置调用真实 File adapter 成功建立 stream S1（manifest + genesis-baseline n=1 + current.json）；随后测试直接调用 `createFileDiagnosticLog({rootDir, namespaceId:'k-ns', genesisUpdateBytes: currentState(n=2), …})` 模拟「延迟初始化」——但 File adapter 的**冻结 reopen 语义**（#153/#166：`file.ts:960-995` 健康 stream 恒 `resume`；`file.ts:987`「resume 不写 genesis」）使第二次调用 **resume 同一 stream S1**（`lateLog.streamId === S1`），`genesisUpdateBytes`（当前态 n=2）被**静默忽略**——`records[0]` 仍为创建态 genesis（n=1）→ 恒红。测试锚「首建成功 + 同 rootDir 二次调用必须产新 stream」与冻结 resume 语义互斥（契约内部不一致，SA3 无范围内修复路径）。

**Resolution**：SA6 R2 勘误采纳本报告建议的**方案 A**（同 `task_namespace-diagnostic-change-log_sa4_review.md` 观察 3 核验）——commit `80a2eb8`：AC5 首建 binding 改用 `targetRecordsPerSegment: 0`（首次 initStream **真实失败**：`LOG_STREAM_INIT_FAILED/invalid-roll-targets` + 零落盘；`fileLog` 仍被赋值故 poll 通过），ROOT n:1→n:2 后「重试」以合法配置 + currentState 建**新** stream → genesis 物化 n=2（ADR-0012「后续**重试**成功时以当时 Y.Doc 建立新 stream」精确兑付）。SA6 勘误后 **16/16 绿**；15 个无关 it 断言零触碰（仅 header 注释 + `readdirSync` import + AC5 本体重写），SA4 核验通过。

**SA3 侧（无需改实现）**：Registry 只保证「首次 initStream 恰一次 + bytes 诚实」——勘误前后实现零改动；R2 复跑证实 16/16。

## 5. SA2 R2 非阻塞项落实

- **R2 遗留 #1 守护测试**：✅ 新增 `registry-create-diagnostic-code-source.test.ts`（2/2 绿——`SCHEMA_ENVELOPE_4` / `SCHEMA_TEXT_INVALID` 与 p0.toIssueSummary 实测同串）。
- **R2 遗留 #2 行号/计数**：✅ 设计文档已修（§11 六项计数 + `schema-patterns.ts:22-25`）。
- **R2 遗留 #3 措辞**：✅ 设计文档已修（schema-write.ts:315-317 = 同包 import 先例；跨包语义复制立论 = internal.ts 冻结 + DENY LIST）。
- **SA2 攻击点 #5（initStream async 逃逸）**：设计 §5.1 已补 sync-only 契约注释——本次实现文档注释随附（Runtime 不做运行时防御，属既有 #149 同款暴露，处置责任在 Host）。

## 6. 剩余风险

| 风险 | 等级 | 说明 |
|---|---|---|
| 跨包码派生无机器单源 | 低 | 已以守护测试冻结当前对齐（设计 §6.3.4 语义复制基准仍在名）；p0.toIssueSummary 未来演进 → 守护测试红灯 |
| emit/initStream 同步成本 | 低 | 设计 §8.5 已声明（同步 I/O 计入 create 尝试；Host 可用 memory adapter 规避）；Registry 零异步日志状态 |
| encode 失败全静默角case | 低 | 设计 §8.5 备案（不可达防御；缺失经 stream 有 manifest 无 genesis 可观测） |
| #17/#18 双记录理论角 | 极低 | SA4 观察 2 残留（emitOutcome 修复后结构性不可抛 → 该次序安全；纯对象构造不可达），交 SA7 动态面知悉 |

## 7. 交付（R2 终态）

commit 链（branch `fix/issue-150-on-docs-namespace-diagnostic-change-log`，未 push）：
- `85f36bd`（R1 实现）；`80a2eb8`（SA6 AC5 勘误，非 SA3 产出）；**R2 commit（本报告 §8 修复）**——见 §8 末。
- 业务代码：`packages/namespace-registry/`（src×5 + package.json 0.1.3→0.1.4 + test 守护文件 + SA6 红灯契约测试文件终态）
- wiki/raw：本任务档案（SA6 brief / SA1 R2 design / SA2 R2 review / SA4 R1 review / relevant_decisions / conflict_report ×2 / dispatch / 本报告；design 的 INFO 修订在其原文件内）
- **未提交**：REPORT.md、`.mabf-bg/`（按任务要求排除）

## 8. R2 修订：SA4 R1 B1/B2 处置（2026-08-31）

**SA4 R1 verdict: reject**——两个可共同修复的阻断项（`task_namespace-diagnostic-change-log_sa4_review.md`）；本 R2 一次闭合，复验范围按 SA4 固定清单执行。

### B1（SA3 侧，限 create-diagnostic.ts）——seam 对象访问逸出吞没边界

**漏洞**：R1 的 `emitOutcome`/`emitEarlyOutcome` 闭包在 `emitAttempt` 的 try **之外**求值 `diagnosticLog.emitter`——null / 敌意 Proxy（getter throw）注入下：成功 create 翻转为 rejection（且 #17 的 throw 落在 factory try 内被 #18 catch 吞成 fatal，随后 #18 diag 调用再次 throw 冲出 catch——entry 泄漏 + committed fatal 误报）；duplicate 的 ALREADY_EXISTS resolve 翻转为 rejection。SA4 PoC 双形态命中。

**修复**（`create-diagnostic.ts`，`createCreateDiag` 重构）：
1. 缺席判定收紧 `== null`（null 一并走 no-op——SA4 可选建议采纳）；
2. `emitter` 在**构造栈内一次读取 + 最小形状校验**（非 null/object 且 `emit` 为 function），读取包在 try 内——null / 敌意 getter / 畸形对象一律收敛为「日志禁用」（NOOP_DIAG 冻结单例）；
3. emit 路径（emitOutcome/emitEarlyOutcome）只用构造期捕获的 `emitter` 引用——**不再读 `diagnosticLog` 本体属性**；`emitter.emit` 的属性读取+调用仍全在 `emitAttempt` 吞没 try 内；
4. `initStream` 的属性读取与函数调用同处吞没 try（R1 已在 try 内，保持+类型修正）。

**修后不改变**：emit 恰一次尝试、不重试；AC4 全锚（emitter.emit throw 隔离等）零回归；正常装配（真实 adapter / 缺省）行为逐位不变（SA4 554/554 绿线保持）。

**B1 回归测试**（SA3 owned 文件内新增 4 it，共 6 it）：`diagnosticLog: null`、敌意 Proxy（emitter getter throw）、畸形 `{emitter:{}}` → 断言 create ok + duplicate resolve `NAMESPACE_ALREADY_EXISTS` + registry running（零 reject 漂移）；`initStream` 同步 throw → 断言 create ok + createdAt 精确 + running（吞没隔离）。R1 代码下 null 注入 PoC 即失败（SA4 实证）——本组测试为针对性回归。

### B2（SA1 侧 §10）——`registry-create-diagnostic-code-source.test.ts` ALLOW LIST 登记

设计 §10 ALLOW LIST 追加该文件（[SA3 owned]，理由 = SA2 R2 遗留 #1 交办 + SA4 R1 B1 回归；与 SA6 冻结文件独立、不改其断言）。同步落实 SA4 观察 1（§12 措辞修正：实际导出不变量 = 模块级导出但不经 CreateDiag 接口暴露、index.ts 零 re-export）与 §6.4 防御表补「diagnosticLog 对象违约」行。

### SA4 固定复验范围证据（R2 后）

| 命令 | 结果 |
|---|---|
| `vitest run .../registry-create-diagnostic-red.test.ts`（SA6 冻结套件 16 it） | **16/16 passed**（含 AC5 勘误后终态） |
| `vitest run .../registry-create.test.ts`（50 用例） | **50/50 passed** |
| AC4 注入/隔离行为 | SA6 AC4 四锚（emitter throw / queue-full / 业务逐位一致 / stream init 失败）16/16 内含；新增 seam 防御 4 it 全绿 |
| `vitest run .../registry-create-diagnostic-code-source.test.ts` | **6/6 passed**（码守护 2 + B1 回归 4） |
| `tsc -p tsconfig.typecheck.json` | **exit 0 / 0 errors** |

**R2 commit**：见交付摘要（本报告 + 修复 diff 同 commit；SA4 复验范围内文件：create-diagnostic.ts、设计 §10/§12/§6.4、code-source 测试、本报告、SA4 review、dispatch 已含）。

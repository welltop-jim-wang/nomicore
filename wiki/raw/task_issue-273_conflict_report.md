# 冲突门禁报告 — Issue #273 namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影（ADR 0016）

## 任务标识

- 任务：Issue #273 — `readData` 成功分支升级为 `{ ok: true, value, schema }`（feature；in-progress）
- 简报：`wiki/raw/task_issue-273.md`（Issue 正文快照，2026-09-09T02:59:09Z 版本；「行为要点」6 条 + AC1–AC5 同源）
- Issue comments：经 REST 读取为空（dispatch 记录），本门禁以 `gh issue view 273` 复核一致（`comments: []`）——无 owner 要求、无 override 声明、无范围收敛指令需要并入
- Worktree：`/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`，HEAD `1acd9e9`，工作树干净——仅简报/dispatch 两个未跟踪快照）
- 阶段：前置冲突门禁（SA1 派发前；iteration 0）
- 裁决人：SA8 Conflict Gatekeeper
- 权威母法：ADR-0016《readData 语义 schema 投影》（2026-09-09，已接受）+ ADR-0008《ADR 0016 修订节》（D8 封口改写与 readData 结果形状，2026-09-09）——两者均已在仓（parent PR #271 首提交 `a6b2a79`）
- 声明依赖：Blocked by #272；Parent PR #271（`docs/adr-0016-readdata-schema`）

## 检查范围

- 冲突基准：`docs/adr/` 全集 **14 个文件（0001–0012、0014、0016；0013/0015 不存在）** 逐个核读（0016/0008 全文精读；其余按辖域定位核读——`grep -l readData docs/adr/*.md` 仅命中 0008/0016，确认读结果契约无第三个发言者）+ 根 `CONTEXT.md` 全读（173 行，「Data」「语义 schema 投影」两条已按 ADR-0016 Consequences 落地）。
- 被审对象：任务简报「行为要点」6 条 + Acceptance Criteria 1–5 全文，及声明依赖（#272 / PR #271）的就绪度与范围阻断。
- 辅助核验（不构成独立冲突基准，按收录关系核验落地载体）：`packages/vfsl/src/resolve-schema-at-path.ts`（#272 落地表面——`ReadDataSchemaProjection` 四件套 + 错误三分通道 + 「detached 深拷贝属 namespace-runtime 组合边界」头注）、`packages/vfsl/src/index.ts`（L125–126 公开导出）、`packages/doc-runtime/src/read.ts`（`ReadLogicalValueResult` 现形状 `{ok:true,value} | PATH_NOT_ALLOWED`）、`packages/namespace-runtime/src/runtime.ts`（L106–129 现联合 + D3 零包装注记）、`packages/namespace-runtime/src/p0.ts`（L37/43/169–170 `schemaState` + `activeTools {module, derived}` 组合 seam）、`packages/namespace-registry/src/types.ts`（L448–451 lease 别名）与 `src/lease.ts`（L388–391 `Equal` 类型级锁）、两包 `package.json`（`@nomicore/vfsl: workspace:*` 依赖既在）、`packages/namespace-runtime/AGENTS.md` / `packages/namespace-registry/AGENTS.md`（包边界与验证门）、公共面审计测试在位（`runtime-acceptance-exports-audit.test.ts` / `runtime-public-surface-ownership.test.ts`）。
- 被 superseded 的条款不计入约束：ADR-0007 的 open/read 编排与 schema-aware read（被 ADR-0008 取代）；ADR-0008 的 D8 封口原句与 `{ok:true,value}` 旧形状（被 ADR 0016 修订节改写，修订节已在仓）；ADR-0009 的 `(owner.userId, namespaceId)` Registry key 旧条款（被 ADR-0010 取代）。

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含修订） | 否 | 不触 schema 文本/信封/方言；投影消费已编译 derived，SSOT 链路不变；无冲突 |
| ADR-0002 | 全新重写，authority 出范围 | accepted | 否 | 无交集；无冲突 |
| ADR-0003 | 求值器与派生 schema | accepted | 是（投影体母法） | §4 ref 按名不内联展开——投影体 `valueSchema`（ref 保留）+ 传递闭包别名表递归安全（E106 无环保证终止）同源；无冲突 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 约束 vfsl-protocol 纯类型包；本任务消费 vfsl 引擎包既有导出（#272 已落地并经其门禁 clear），不触协议包辖域；无冲突 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 不触 codegen；typed-access「加法兼容（adapter 可忽略新字段）」由 ADR-0016 §分层明示；无冲突 |
| ADR-0006 | 持久化 DocPersistence | accepted（含修订） | 否 | 不触持久层；无冲突 |
| ADR-0007 | 逻辑校验与 Yjs Runtime Bridge | accepted（open/read 条款被 0008 取代；含 #237 修订） | 是（doc-runtime seam） | 本任务「doc-runtime 不动、读取保持 schema 无关」= ADR-0016 §分层 L74 + ADR-0008 读取能力节原文延续；`readLogicalValueAtPath(doc, path)` 签名语义不变；无冲突 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#237 修订 + **ADR 0016 修订节**） | **是（直接母法之二）** | 修订节 L169–177：D8 封口改写（derived 只经投影受控只读深拷贝进公共面；module/validator 仍永不）+ 成功分支 `{ok:true,value,schema}` 演进 + 「原规则保持」（schema 无关读取、不进 sequencer、失败通道、读取保留不变量均不变）——简报行为要点逐条同源；无冲突 |
| ADR-0009 | Registry、租约与 Host 生命周期 | accepted（含修订） | 是（lease 透传） | lease 代理 Runtime 同步读取（L38）无任何条款冻结旧读结果形状；「仅类型别名跟随、lease 行为零变化」= ADR-0016 §分层 L76 明文；无冲突 |
| ADR-0010 | Hub/Peer 复制 | accepted（含修订） | 是（null 情形②的事实源） | L94「raw update 不执行完整 VFSL 预校验，是 zero-write 的明确例外」——「路径偏离 schema（raw 复制可产生 schema 外数据）」情形的母法；无冲突 |
| ADR-0011 | 诊断变更日志 | accepted | 否 | ADR-0016 明示「诊断变更日志不涉及读面」；无冲突 |
| ADR-0012 | 实例身份与 WS plugin 所有权 | accepted | 否 | 无交集；无冲突 |
| ADR-0014 | VFSL 校验 JSONL 与 framed sidecar 日志格式 | accepted（含 amendment） | 否 | 无交集；无冲突 |
| ADR-0016 | readData 语义 schema 投影 | accepted | **是（直接母法）** | 简报为其「结果形状/投影体/交付纪律/分层与兼容面」各节的逐条实施票：形状、null 三情形、路径键控、空路径 ROOT、深拷贝纪律、分层归属、失败分支与观测面不变——全部为该 ADR 明文决策；无冲突 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无冲突项（hard-violation 0 / override-declared 0 / 需 owner 裁决的演进项 0） |

无冲突项。逐条对照说明（非冲突，供 SA1/SA2 参考）：

1. **成功分支 `{ ok: true, value, schema }`、always-on、无 opt-in** vs ADR-0016 §结果形状 + §交付纪律：逐字同源；「opt-in 开关」为 ADR-0016 被否备选（接口分叉、形状随参数变化）。CONTEXT「Data」词条已注册「readData 成功时同步返回值与其语义 schema 投影（ADR-0016）」。裁决 no-conflict。
2. **`schema: null` 三情形（无 active schema / 路径偏离 schema / 静态解析失败）、`null` 不是读的失败** vs ADR-0016 L22 + CONTEXT「语义 schema 投影」词条：逐字同源；三情形不区分（「有就给」，无缺席原因分类）为 ADR-0016 被否备选（schema 子通道联合）的直接反面。裁决 no-conflict。
3. **值缺席照常返 schema（路径键控非值键控）+ 空路径返 ROOT 值 schema 投影** vs ADR-0016 L24–25 + CONTEXT L38：逐字同源；解析与实际值无关（不用判别式缓存按值收窄）是 ADR-0016 解析语义明文。裁决 no-conflict。
4. **每次读深拷贝（detached、不冻结、零缓存）** vs ADR-0016 §交付纪律 L70 + CONTEXT「语义 schema 投影」Avoid 句（「把投影当作 live derived schema 的共享引用」）：逐字同源；`activeTools.derived` 活引用绝不递出 = ADR-0008 修订节 D8 改写的正面要求。#272 落地的 resolver 头注已明示「detached 深拷贝属 namespace-runtime 组合边界」——本票承接该义务正属其位。裁决 no-conflict。
5. **doc-runtime 不动（读取保持 schema 无关）** vs ADR-0016 §分层 L74 + ADR-0008 §读取能力 L18/L20 + 修订节第 3 条「原规则保持」：简报正确地把组合职责全部放在 namespace-runtime；`readLogicalValueAtPath(doc, path)`（doc-runtime `read.ts` L44–56 现形状）签名与语义零触碰。裁决 no-conflict。
6. **namespace-runtime 组合载体读与 resolveSchemaAtPath** vs ADR-0016 §分层 L75 + ADR-0008 修订节第 1/2 条：`schemaState ≠ 'ready'` 或无 activeTools → `schema: null`；组合 seam（`p0.ts` `schemaState`/`activeTools`、`@nomicore/vfsl: workspace:*` 依赖）既在。D8 修订使 derived 经投影深拷贝进公共面**合法化**——本票是该修订的实施票而非违反者。裁决 no-conflict。
7. **registry 仅 `NamespaceLeaseReadDataResult` 别名跟随、lease 透传行为零变化** vs ADR-0016 §分层 L76 + ADR-0009 L38：ADR-0009 无条款冻结旧读形状；lease.ts L390 `Equal` 类型级锁是**包内实现纪律**（非 ADR），其存在恰证明「别名跟随」路径成立（改 runtime 形状 → 同步改别名 → 锁保持绿）。裁决 no-conflict。
8. **失败分支（PATH_NOT_ALLOWED / RUNTIME_READ_DISABLED / released issue）不变** vs ADR-0016 L23 + ADR-0008 修订节第 3 条 + CONTEXT「停接纳」词条：三通道各自原样；`RUNTIME_READ_DISABLED` 稳定码（ADR-0008 #93 修订节注册）不动。裁决 no-conflict。
9. **getSchema/getMetadata/getActiveSchema/getStatus 均不变** vs ADR-0008 §读取能力 L32–36 + 修订节：修订只改 D8 的 derived 半句与 readData 成功分支；`getActiveSchema` 五字段身份（不含 module/derived/validator）不受影响——D8 修订后 `module` 与 validator 仍永不进公共面。裁决 no-conflict。
10. **无新增公共方法/参数；public-surface 审计测试按新形状更新** vs ADR-0008 D2「十键协议」+ ADR-0016 Consequences L92：键集不变（结果形状演进非键增删）；「对读结果做 toEqual 全等断言的测试需要更新；toMatchObject 加法兼容」为 ADR-0016 自己登记的 Consequences——AC4 与之逐字对应，审计测试文件在位。裁决 no-conflict。
11. **两包测试（含 test-d）+ 根仓 `pnpm typecheck`/`pnpm test` 绿** vs ADR-0016 Consequences + 两包 AGENTS.md Verification：核验面一致；仓库内 `readData(` 消费者除两包外仅 `apps/yjs-server/src/app.ts`（REST 层，读 `value` 加法兼容）与 `packages/vfsl/src/schema-check-cli.ts`（同名本地函数，无关）——根仓门覆盖。裁决 no-conflict。
12. **载荷不含载体结构树** vs ADR-0016 §投影体 L44 + CONTEXT「ROOT」/「结构树」词条：简报投影体 = 值语义子树 + 闭包别名 + 注释切片，无 StructureNode。裁决 no-conflict。

## 就绪度评估（依赖与范围阻断）

- **Blocked by #272：已满足**。Issue #272 CLOSED（2026-09-09T02:58:46Z，ci-passed）；实现经 PR #277（MERGED）落入 parent PR #271 分支，本 worktree HEAD `1acd9e9` 即该合并提交。依赖表面亲核在案：`packages/vfsl/src/resolve-schema-at-path.ts` 存在，`index.ts` L125–126 公开导出 `resolveSchemaAtPath` + `ReadDataSchemaProjection`/`ResolveSchemaAtPathResult`；其头注明示深拷贝边界留给本票（「detached 深拷贝属 namespace-runtime 组合边界（ADR-0016 交付纪律）」）、结构侧逐字复用 `drillStep`（单源不分叉）——本票所需依赖面完整、无缺口。
- **Parent PR #271：开放 = 设计使然，非阻断**。GitHub 实测（API 亲核）：PR #271 OPEN、base `main`（真实 main HEAD `a4037cf`，经 `gh api branches/main` 确认——**本地 `origin/main` 引用陈旧停在 `6a005a4`，勿据此 rebase**）、`mergeable: MERGEABLE` / `mergeStateStatus: CLEAN`、恰 2 提交（`a6b2a79` ADR 文档 + `1acd9e9` #272 实现）。本 worktree 已正确栈接其 head。对下游的含义：#273 的实现/PR 应继续栈接 `docs/adr-0016-readdata-schema` 支系（或等 #271 先合入 main），不得基于陈旧本地 main 重开基线——属工作流纪律，非 ADR 冲突。
- **无碰撞**：`ReadDataSchemaProjection` 在 namespace-runtime/namespace-registry/apps 全无既有使用或半成品；工作树干净（仅 `task_issue-273.md`/`task_273_dispatch.md` 两快照未跟踪）。
- **组合 seam 齐备**：`p0.ts` `schemaState('preparing'|'ready'|'unavailable')` + `activeTools {module, derived}`（内部保留，L169 注记）；`@nomicore/vfsl: workspace:*` 已是两包依赖；runtime/registry 公共面审计与 test-d 测试文件在位，验证门可用。
- **Issue comments 为空**（REST + `gh` 双确认）：无 owner 附加要求需并入。
- **范围阻断：无**。分层边界（doc-runtime 零改动、registry 仅别名）与 ADR-0016 §分层逐字一致，无越界承接、无范围缺口。
- 结论：**就绪，可立即派发 SA1**（简报自评「Blocked by #272」成立且已满足）。

## 结论

- Verdict 为 **clear**：任务简报「行为要点」6 条与 AC1–AC5 对 `docs/adr/` 全集（14 文件）及 `CONTEXT.md` 无任何直接违反；无 override 声明需求、无需 owner 裁决的演进项。任务性质是 ADR-0016（已接受）+ ADR-0008 ADR-0016 修订节（已接受）「结果形状/交付纪律/分层与兼容面」的忠实实施票——每条要求均有母法明文条款一一对应；CONTEXT 词条已先行落地，无术语债。
- 给下游 SA 的红线提醒（非冲突）：
  1. **包装而非透传**：现 `NamespaceRuntimeReadDataResult = ReadLogicalValueResult | RuntimeReadDisabledResult` 是零包装透传（runtime.ts L116–118「D3 零包装」）；新成功分支 `{ok:true,value,schema}` **不再是** `ReadLogicalValueResult` 的 ok 变体原样——runtime 边界必须显式映射（value 透传 + schema 附加），`PATH_NOT_ALLOWED` 失败分支原样透传不变；doc-runtime 零改动。
  2. **lease `Equal` 锁同步**：`types.ts` L448–451 别名（含 `ReadLogicalValueResult` 直引）与 `lease.ts` L388–391 类型级锁必须同步演进且锁保持编译绿——「仅类型别名跟随」的验收形态即 AC1「两层类型一致」。
  3. **null 单义性**：resolver 失败（`SCHEMA_PATH_NOT_FOUND`/`SCHEMA_PATH_INVALID`）在 runtime 组合层一律收敛为 `schema: null`（静态解析失败情形），**不得**把 vfsl 两码泄漏进读结果联合、不得为缺席原因新增子通道（ADR-0016 被否备选明文拒绝）。
  4. **InternalError 通道归属须 SA1 钉死**：resolver 对可信域畸形 derived 抛 `InternalError`（#272 已裁定不进结果联合）；runtime 侧 activeTools.derived 出自自身 P0 编译（可信域），该 throw 实际不可达——但设计必须显式钉死其处置（ADR-0008「只有 internal bug 才抛异常」L28 支持 throw 逃逸读面；ADR-0016 null 情形③「静态解析失败」支持收敛 null——两读法各有锚点，属设计钉死面，非门禁裁决面）。
  5. **深拷贝是本票义务**：#272 resolver 返回与调用方 derived **共享节点**（其头注明示）；本票必须在 namespace-runtime 边界对四件套整体深拷贝（可变普通副本、不冻结、零缓存、跨读零共享），AC3 隔离测试即其锚。
  6. **测试改锚面**：按 ADR-0016 Consequences 更新读结果 toEqual 全等断言（toMatchObject 加法兼容）；public-surface 审计测试按新形状改锚（AC4）；`apps/yjs-server` REST 消费面由根仓 `pnpm typecheck`/`pnpm test` 门覆盖（AC5）。
  7. **工作流纪律**：实现留在 `mabf/issue-273` / 栈接 PR #271 支系；本地 `origin/main` 引用陈旧（`6a005a4`，真实 main 为 `a4037cf`），任何 rebase/对比决策以 GitHub API 实测为准。
- 信息充分性：ADR 全集 14 文件与 `CONTEXT.md` 已核读；任务简报完整；依赖（#272 表面、PR #271 状态、组合 seam、类型锁、审计测试、依赖图）已按收录关系亲核。无信息不足。

Verdict: clear

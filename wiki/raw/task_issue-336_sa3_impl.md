# SA3 Implementation Report — Issue #336（T3：readData 五键组合）

> 角色：SA3（TDD 执行者），iteration 0。worktree `/home/wangjian/nomicore-fix-issue-336`，
> 基线 HEAD `cdfdff6`（T0 #333 / T1 #334 / T2 #335 已在支）。只实现，不 commit / 不 push。

## Inputs consumed

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-336.md`（任务简报；Issue 正文同源，REST comments 空——无 Owner 要求） | 已读 |
| `wiki/raw/task_issue-336_design.md`（SA1 iteration 1，1070 行） | 已读全文 |
| `wiki/raw/task_issue-336_sa2_review.md`（SA2 iteration 1，verdict approve；F1 销项 + M1/M2 MINOR） | 已读全文 |
| `wiki/raw/task_issue-336_conflict_report.md`（SA8 前置门禁，clear / requiresConflictRecheck=true） | 已读 |
| `wiki/raw/task_issue-336_relevant_decisions.md`（ADR 0024/0016/0008/0009/0003 摘录） | 已读 |
| `wiki/raw/task_issue-336_design_conflict_report.md`（SA8 设计后复审，clear；§8 八项实现复查） | 已读 |
| `task_issue-336_sa6_contract.md` | **不存在**——按设计 §5/§12 以 Issue AC + ADR-0024 验收节 L120–130 为验收权威 |
| 上游源码亲核 | doc-runtime `read.ts`（L100–155/L230–238/L326–377/L536–694）、vfsl `resolve-schema-at-path.ts`（L72–228/L333–375/L450–546）、runtime `runtime.ts`/`read-schema-projection.ts`、registry `lease.ts`/`types.ts`/`index.ts`、T0 三件、既有 projection-red/control/hostile 套件、`apps/yjs-server/src/app.ts` L594–615 |

## Existing worktree reconciliation

- 无既有 `task_issue-336_sa3_impl.md`、无未提交实现（`git status` 清点仅 wiki 输入 + 本票新增/修改）。
- 既有 T0 集中面（helper/scanner/gate）与 10 个消费文件核对无误：按设计只改集中面 3 件，
  10 个消费文件**零手改**（`git status` 逐名核对）。
- 上游 T1/T2 落地面只消费、零编辑（git diff 零触碰 `packages/doc-runtime/**`、`packages/vfsl/**`）。
- 既有 `readdata-schema-projection-fixture.ts` 零编辑（新预算 fixture 独立复制其构造形态）。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/namespace-runtime/src/runtime.ts` | §7.1-A-1/A-2/A-2b/A-2c、§7.2-B、§7.3-C | `readData` 双重载实现（lifecycle gate 先行 → 无 options 两参逐字节 + 新鲜 `[]` → 预算三参 + 接缝净化 + 五键组装）；`NamespaceRuntimeReadDataResult` 成功面五键、新增 `NamespaceRuntimeReadDataBudgetResult` / `NamespaceRuntimeReadDataOptions` / `ReadLogicalValueBudgetFailure`；包内 `canonicalReadOptions`、`seamReadOptionsInvalid`、`echoReadPath`（自 `readDisabled` 提取为共用）；readData JSDoc 预算/五键/失败语义重写；import 增补 |
| `packages/namespace-runtime/src/read-schema-projection.ts` | §7.4-D-1～D-4 | `projectReadDataSchema` 纯/预算双重载 + resolver 显式两分支调用；`detachReadSchemaProjection`/`cloneValueSchema`/`cloneValueSchemaRecord` 双重载加宽；`cloneValueSchema` 新增显式 `case 'truncated'`（10-case 穷尽、无 default；clue 全新普通副本 + memo）；模块头注预算段 |
| `packages/namespace-runtime/src/index.ts` | §7.3-C-3 | +3 type-only 导出（`NamespaceRuntimeReadDataBudgetResult` / `NamespaceRuntimeReadDataOptions` / `ReadLogicalValueTruncationEntry` 转出）；头注 #336 演进注记（值导出面仍恰 `RuntimeWriteFatalError`） |
| `packages/namespace-registry/src/types.ts` | §7.5-E-1 | `NamespaceLeaseReadDataBudgetResult` 别名（runtime 预算联合 ∪ released issue）；`NamespaceLease.readData` 双重载（预算在前 / legacy 在后）；import 增补 |
| `packages/namespace-registry/src/lease.ts` | §7.5-E-2/E-3 | 工厂内 `leaseReadData` 双重载（released 短路先行；active 期 raw 引用直传）+ 字面量引用；新增 `_readBudgetAlias` / `_readOverloadOrder` 两个 Equal 锁（`_readAlias` 原文保持） |
| `packages/namespace-registry/src/index.ts` | §7.5-E-1 | +1 type-only 导出（`NamespaceLeaseReadDataBudgetResult`） |
| `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | §7.6-F-1 | 恰三键 → 五键：`READDATA_OK_KEYS` 五键、`ReadDataOkShape` 加 `truncated`/`truncations`（schema **保持纯面**——N3）、`readDataOk(value, schema, truncated = false, truncations = [])`、`expectReadDataOk` 独立内联五键期望（反伪绿不变量保持）、`expectReadDataOkKeys` 随常量 |
| `packages/namespace-runtime/test/helpers/readdata-shape-assertion-scan.ts` | §7.6-F-2 | `SUCCESS_SHAPE_KEYS` 五键化 + 头注/family B 描述同步（family A 判定零改动——超集匹配穿修订持续有效） |
| `packages/namespace-runtime/test/readdata-shape-assertion-consolidation-gate.test.ts` | §7.6-F-2 | 正样本五键化（family B 五元素数组、family A 三/五键双样本）、三键 family B 移入负样本、五键生产者样本、门断言语义不变 |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget-red.test.ts`（新） | §12-T1 | 主缝预算契约红灯（组 A–H：五键恒形 / depth 清单 / omitted 语义 / 两通道对齐 + F-x 延拓 / width 逐字节 / READ_OPTIONS_INVALID 矩阵+差分+F-x1～F-x6 / 零物化哨兵 / schema:null 共存） |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget-control.test.ts`（新） | §12-T2 | 负控：无 options 逐字节回归锚（T1 值预言机 + resolver 投影预言机 + JSON 逐字节）、失败分支键集、敌意 path 预算对偶、detach 纪律（含标记 clue） |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget-fixture.ts`（新） | §11/§12（N4） | 预算 fixture：复制既有 fixture 构造形态（MemoryPersistence + seam），**零编辑**原文件；严格/raw 两变体 + 敌意 options 构造器（descriptor/get 分叉、抛错 get trap、状态化/交替 descriptor trap、非 enumerable own 键） |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget.test-d.ts`（新） | §12-T3 | 类型锚：两联合 `keyof` 五键精确集、truncations/schema 类型、零泄漏、失败面无新键、重载序（ReturnType=legacy）、options 别名等式、`@ts-expect-error` 反向锁 |
| `packages/namespace-registry/test/registry-readdata-budget-passthrough.test.ts`（新） | §12-T5 | lease 透传：同一引用捕获（path/options）、单参 legacy 通道（argc===1）、敌意 options 零 lease 层触达、released 先行冻结单例、真实装配 lease ≡ runtime 直调 |
| `packages/namespace-registry/test/registry-readdata-budget-passthrough.test-d.ts`（新） | §12-T6 | lease 类型锚：预算别名组合等式、released 成员、五键、零泄漏、重载序、反向锁 |

## SA2 Finding落实

| Finding ID | Implementation | Result |
|---|---|---|
| **F1（BLOCKER，iteration 0）**：净化器裸 `[[Get]]` 重读 raw options 的三触发路径 | `canonicalReadOptions`（runtime.ts 包内）逐字对齐 T1 读纪律：`Object.keys` own-enumerable 键空间 + `getOwnPropertyDescriptor` data-property 取值（零 `[[Get]]`）+ 整体 try 收编 + present-undefined 剥离 / -0 归一；净化失败走 A-2b 双出口（出口① 重派发 T1 单源收编；出口② `seamReadOptionsInvalid` 接缝终态成员，返回类型 = `ReadLogicalValueBudgetFailure` Extract 单源锁） | **落实**。测试锚：D5/D6 `getCalls() === 0`（零 `[[Get]]`）；F-x5/F-x6 恰四键 `READ_OPTIONS_INVALID`、零 throw（descriptor trap 调用计数 4/5 与钉死轨迹一致）；D5 负断言排除 `ok:true ∧ schema:null ∧ truncated:true` 静默组合 |
| N1（MINOR）：调用方矩阵漏列 `apps/yjs-server` | 该 app 属 DENY、零改动；单参 legacy 通道保持（`readData` 无 options 分支结构不变） | 承接：root `pnpm typecheck`（14 包含该 app）绿；root `pnpm test` 350 文件全绿 |
| N2（MINOR）：消费文件计数 10（非 11） | 五键修订只在 helper 单点；gate 文件消费 scanner 不消费 helper（零手改） | 落实：`git status` 显示 helper/scanner/gate 恰 3 件；runtime+registry 套件 95 文件 / 864 测试全绿 |
| N3（MINOR）：helper `schema` 类型与预算投影的关系钉死（保持纯面 + 预算断言纪律） | `ReadDataOkShape.schema` 保持 `ReadDataSchemaProjection \| null`；预算测试只用 `expectReadDataOkKeys` + 定点断言，零 `expectReadDataOk` 整形状断言、零 `as any` | 落实：10 个消费文件 typed stub 对 legacy + 预算双重载均可赋值（`tsc -p tsconfig.typecheck.json` 零错误）；预算用例编译通过 |
| N4（MINOR）：fixture 措辞（复制形态、零编辑原文件） | 新 `runtime-readdata-shape-budget-fixture.ts` 复制构造形态；`readdata-schema-projection-fixture.ts` 零编辑 | 落实：`git status` 无该既有 fixture |
| M1（MINOR，措辞层）：设计「键集漂移已全部响亮拒绝」表述过宽（键在场性在两可接受视图间交替不可检测） | 设计文本非 SA3 面（不修改 `wiki/raw/*design*`）；实现行为与修订语义一致——F-x5/F-x6 仅断言可检测漂移面（trap 抛/accessor 显形/值非法/未知键显形）为响亮失败，测试**未**声称键在场性交替被拒；不可检测残余与设计 §13 登记一致 | 无行为偏差；措辞修订留 SA1/Controller（建议随 PR 描述登记） |
| M2（MINOR，门禁命令精度）：`pnpm --filter <pkg> test` 两包均无 `test` script | 采用 SA2 建议的可执行形式：`pnpm exec vitest run <路径>` + `tsc -p <tsconfig>`；AC7 由 root `pnpm typecheck` + `pnpm test` 覆盖 | 落实：见 Verification 表（每条命令按字面可运行） |
| SA2 §14 观测 3（F-x2 夹具卫生） | `Object.prototype.depth` 污染用 try/finally 还原（断言失败不泄漏） | 落实 |
| SA2 §14 观测 4（差分矩阵边界） | F3 差分只用于确定性夹具；状态化/交替 trap（F-x5/F-x6）单独分组、不作差分基准 | 落实 |

## SA8 §8 实现复查核对（设计后复审八项）

| # | 核对项 | 结果 |
|---|---|---|
| 1 | canonical 净化包内不导出、仅 T1 成功后执行；读纪律逐字对应；零 `[[Get]]` | ✅（`canonicalReadOptions` 非导出；D5/D6 零 get 调用计数锚） |
| 2 | A-2b 双出口仅在净化失败分支；T1 成员原样透传；绝不 throw / `schema:null` / 带截断键 | ✅（F-x5 出口① / F-x6 出口② 恰四键；全程零 throw） |
| 3 | A-2c 返回类型 = Extract 派生、`echoReadPath` 与 readDisabled 同纪律、message 恒非空、触发点唯一 | ✅（`seamReadOptionsInvalid` 唯一触发点 = 净化失败 ∧ 重派发成功） |
| 4 | 两通道对齐（归一 recipe + F-x1/F-x2/F-x3 延拓）、差分矩阵、`{depth:undefined}`、width 逐字节 | ✅（D1–D6 / F3 / F4 / E1） |
| 5 | 两联合成功成员恰五键；无 options 新鲜 `[]`；三既有失败分支键集零变化；lifecycle×options 定序锚 | ✅（A1–A3 / F7 / T2 控制文件） |
| 6 | T0 helper 五键化（schema 纯面）+ gate 随动 + family A/B 归零 + 10 消费文件零手改 | ✅（gate 22 测试绿；95 文件套件绿） |
| 7 | lease 透传（released 先行、raw 同一引用直传、三 Equal 锁编译绿、type-only 导出） | ✅（T5/T6 + `tsc -p tsconfig.typecheck.json`） |
| 8 | DENY LIST 零触碰；package 门禁 + root `pnpm typecheck`/`pnpm test`；版本 bump 属发布流 | ✅（`git status` 逐路径核对；门禁全绿；未改 package.json 版本——发布流随动） |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/namespace-runtime/src/runtime.ts` | ✅（ALLOW 行 1） | readData 双重载 + 双结果联合 + 包内三 helper + JSDoc |
| `packages/namespace-runtime/src/read-schema-projection.ts` | ✅（ALLOW 行 2） | 投影接缝双重载 + `case 'truncated'` |
| `packages/namespace-runtime/src/index.ts` | ✅（ALLOW 行 3） | type-only 导出 +3 |
| `packages/namespace-registry/src/types.ts` | ✅（ALLOW 行 4） | lease 预算别名 + 双重载 |
| `packages/namespace-registry/src/lease.ts` | ✅（ALLOW 行 5） | lease 透传 + 2 Equal 锁 |
| `packages/namespace-registry/src/index.ts` | ✅（ALLOW 行 6） | type-only 导出 +1 |
| `packages/namespace-runtime/test/helpers/readdata-ok-shape.ts` | ✅（ALLOW 行 7） | 五键修订单点 |
| `packages/namespace-runtime/test/helpers/readdata-shape-assertion-scan.ts` | ✅（ALLOW 行 8） | family B 常量五键化 |
| `packages/namespace-runtime/test/readdata-shape-assertion-consolidation-gate.test.ts` | ✅（ALLOW 行 9） | 门正负样本随动 |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget-red.test.ts` | ✅（ALLOW 行 10） | 主缝红灯契约（AC1–AC5） |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget-control.test.ts` | ✅（ALLOW 行 11） | 负控/回归锚（AC5） |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget-fixture.ts` | ✅（ALLOW 行 12） | 预算 fixture（复制形态；N4） |
| `packages/namespace-runtime/test/runtime-readdata-shape-budget.test-d.ts` | ✅（ALLOW 行 13） | 类型面锚 |
| `packages/namespace-registry/test/registry-readdata-budget-passthrough.test.ts` | ✅（ALLOW 行 14） | lease 透传断言（AC6） |
| `packages/namespace-registry/test/registry-readdata-budget-passthrough.test-d.ts` | ✅（ALLOW 行 15） | lease 类型锚 |

DENY LIST 零触碰（`git status --short` 逐路径核对）：`packages/doc-runtime/**`、`packages/vfsl/**`、
`readdata-schema-projection-fixture.ts`、docs 负控三件、`docs/adr/**`、`CONTEXT.md`、
wire/复制/诊断面、`apps/yjs-server/**`、既有 readData 行为套件全部未修改。

## Verification

| Command | Result | Evidence |
|---|---|---|
| 红灯态：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-runtime/test/runtime-readdata-shape-budget-red.test.ts packages/namespace-runtime/test/runtime-readdata-shape-budget-control.test.ts packages/namespace-registry/test/registry-readdata-budget-passthrough.test.ts`（实现前） | **红**：`Test Files 3 failed`、`Tests 27 failed \| 10 passed`；失败原因 = 成功分支恰三键（`truncated` undefined）、第二实参被忽略（F 组 `ok:true` 而非 `READ_OPTIONS_INVALID`）、零物化哨兵仍整读响亮失败 | 逐组 verbose 清单（A/B/C/D/E/G 组全红 + F1/F3/F4/F5/F-x5/F-x6 红；F2/F6/F7/H1/H2 与三条控制断言为绿——红灯原因即能力缺口本身） |
| 绿灯态：同一命令（实现后） | **绿**：`Test Files 3 passed (3)`、`Tests 37 passed (37)`、`Type Errors no errors` | 37 用例全绿（含 F-x3/F-x4 零 `[[Get]]` 计数锚、F-x5/F-x6 descriptor 调用计数 4/5、D1–D6 两通道位置集相等、E1 JSON 逐字节相等） |
| 包门禁：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-runtime packages/namespace-registry` | **绿**：`Test Files 95 passed (95)`、`Tests 864 passed (864)`、`Type Errors no errors` | 含既有 projection-red/control、hostile-path、sync-read-face、docs-adr0016-sync-control（21 测试）、T0 收敛门（22 测试）、registry surface/declaration 审计 |
| 全测试程序类型门：`pnpm exec tsc -p tsconfig.typecheck.json` | **绿**（零输出） | 覆盖全部 `packages/*/test/**/*.ts`（含 10 消费文件 stub 对双重载可赋值性、新 `*.test-d.ts` 的 Equal/`@ts-expect-error` 锁、`apps/yjs-server` 单参调用） |
| 受影响包 typecheck：`pnpm exec tsc -p packages/namespace-runtime/tsconfig.json`；`pnpm exec tsc -p packages/namespace-registry/tsconfig.json` | **绿**（两者零输出） | 公共类型面（双联合/重载/Equal 锁/`case 'truncated'` 穷尽性） |
| root 门禁（AC7）：`pnpm typecheck` | **绿**：14 包逐包 tsc（含 `apps/yjs-server`） | 输出仅脚本回显，无诊断 |
| root 门禁（AC7）：`pnpm test`（`vitest run --typecheck`） | **绿**：`Test Files 350 passed (350)`、`Tests 3841 passed (3841)`、`Type Errors no errors` | 全仓套件 + `*.test-d.ts` 类型收集 |

## Deferred verification

- **SA8 设计后冲突复查（`requiresConflictRecheck=true`）**：公共 API 面（runtime 双重载 + 两联合五键 +
  新公共失败码 + 3 type-only 导出；registry lease 双重载 + 新别名 + 1 导出）与 A-2b/A-2c 实现 diff
  的 ADR 复查属 SA8/Controller 面；本报告 §SA8 表给出逐项核对证据。
- **版本 bump**（runtime 0.1.12→0.1.13、registry 0.1.10→0.1.11）按设计 §13 属发布流随动，SA3 未改
  `package.json`（非代码面）。
- **SA4/SA7 独立验证面**（回归/动态/负控交叉验证）与 SA5 文档/CI 面非 SA3 职责；后续票 T4 #337
  （`DeepOptional`）与 T5 #338（文档负控正则 + 形状注记）不在本票半径。
- **残余风险承接**：非确定性 descriptor 在两个 T1 可接受视图间交替（键在场性/合法值交替）接缝不可
  检测——设计 §13 已登记 follow-up（需 doc-runtime 暴露已校验预算）；本实现未伪装闭合。
- 本 worktree 依赖为 `pnpm install --offline` 安装（零网络），未执行 `pnpm generate --check`
  / `pnpm schema:check`——本票零 `domains/*/schema.vfsl` 与 codegen 面变更，设计未指定该门。

## Deviations or blockers

- **无阻塞**。实现按批准设计逐点落地；红灯契约全部转绿。
- **M2 命令形式适配**（非设计偏离）：设计 §12 门禁表的包级行字面不可执行（两包 package.json 无
  `test` script），采用 SA2 M2 建议的 `pnpm exec vitest run <路径>` + `tsc -p <tsconfig>`；覆盖面未缩小。
- **M1 措辞**：设计文本的残余风险表述过宽属 SA1/Controller 修订面，SA3 不改设计文件；实现与
  F-x 断言均按修订后语义（可检测漂移面响亮失败，不可检测交替诚实登记）。
- **未新增测试基础设施**：fixture/测试全部在 ALLOW 新文件内，零改动 DENY 既有套件。

## Suggested commit message

```
fix(#336): [shape-budget] T3: readData 五键组合——两通道同预算与截断清单

ADR-0024 决策 1/3/4/5/6 的 runtime/registry 组合切片：
- runtime readData 双重载（预算在前/legacy 在后）：同预算贯通值通道（T1 三参）
  与投影通道（T2 三参）；成功分支恒五键 {ok,value,schema,truncated,truncations}
  （无预算读 = false / 新鲜空数组），失败分支形状不动
- READ_OPTIONS_INVALID 进预算结果联合（含未知键；同步不抛、不借路径/生命周期码；
  legacy 联合零泄漏）；截断清单逐字段透传（零合成）
- 接缝净化 canonicalReadOptions（T1 同款读纪律：own-enumerable 键空间 + descriptor
  取值 + try 收编；零 [[Get]]）；视图不稳定走 A-2b 双出口响亮失败（重派发单源 /
  A-2c 接缝终态成员，Extract 单源类型锁）
- projectReadDataSchema / detach / cloneValueSchema 双重载 + 显式 case 'truncated'
  （10-case 穷尽、无 default）；type-only 导出 +3
- registry lease readData 双重载原样透传（released 先行、raw 引用直传；预算别名 +
  两 Equal 锁）；type-only 导出 +1
- T0 集中面恰三键 → 五键单点修订（helper/scanner/gate；10 消费文件零手改）
- 契约测试：runtime 主缝红灯（组 A–H，含 F-x1～F-x6 敌意净化面）+ 负控 + 类型锚；
  registry 透传 + 类型锚
```

（SA3 不执行 commit；本段仅供 Controller 选用。）

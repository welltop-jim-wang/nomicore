# 任务简报 — namespace-runtime：原子 SCHEMA replacement 与 ROOT generation

> **SUPERSEDED（已取代）**：本文记录 issue #91 round 1 的历史方案；其中“顶层声明域投影 / 静默剥离 / `projectDeclaredRootKeys`”契约已废止。当前裁决见 `task_namespace-runtime-replace-schema-rev1.md`：provided root 必须作为完整最终 logical ROOT 原样封闭校验，任何未声明键均响亮失败且零写入。

- Issue: #91 (welltop-jim-wang/nomicore)
- run_id: issue-91-1787570858-562378
- branch: fix/issue-91-on-docs-namespace-runtime
- base: docs/namespace-runtime
- Task Type: feature（功能开发）

## Parent

PR #85（docs/namespace-runtime）

## What to build

实现 Runtime 的 replaceSchema：先编译 proposed SCHEMA，再用新 schema 验证当前或完整 proposed ROOT，最后在单 transaction 中原子切换 SCHEMA 与必要的 ROOT generation，并安装新的 active schema tools。

## Acceptance criteria

- [ ] AC1: replaceSchema 与 mutateRoot 共享唯一 write sequencer，但不依赖当前 schema 编译成功
- [ ] AC2: 未提供 root 时，按 proposed derived 严格提取并验证当前 ROOT，载体或逻辑不兼容则零写入失败
- [ ] AC3: 提供 root 时，将其视为完整最终 logical ROOT，完成验证与 detached 构造后整体替换内容
- [ ] AC4: SCHEMA 是顶层 Y.Map，transaction 内 clear 后恰写 lang/version/id/text 四个字符串键
- [ ] AC5: SCHEMA 与必要 ROOT 变化在一次 transaction 中原子提交，顶层 ROOT Y.Map identity 保持
- [ ] AC6: transaction 成功后立即安装新 active schema tools，再 await dirty notifier
- [ ] AC7: 编译、验证或构造失败时 SCHEMA/ROOT/active tools 均不变
- [ ] AC8: P0 schema-unavailable 后可由合法 replaceSchema 恢复 ROOT write；persistence-degraded 或 prior fatal 时仍拒绝
- [ ] AC9: 准备期间 read/getSchemaEnvelope/getActiveSchema 继续观察旧 committed generation
- [ ] AC10: 使用独立窄结果联合和确定性/集成测试，并通过全量 typecheck/test、Node 20/24 CI

## Blocked by

- #87（已合入：1543ab3 — doc-runtime committed-aware transaction fatal 契约）
- #88（已合入 — doc-runtime replaceRootContent + 包内 detached builder seam）
- #89（已合入：df22660 — namespace-runtime 骨架、同步读取面与队首 P0）
- #90（已合入：1616c28 — 唯一 write sequencer 与 validated ROOT write / mutateRoot）

## Working Directory

/home/wangjian/nomicore-fix-issue-91

## 关键上下文（总控预读，供 SA 参考）

1. **ADR-0008**（docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md）
   是本任务唯一行为契约源。本任务实现其中「ROOT write 与 SCHEMA write」节的
   **SCHEMA write 全部五步** + 「Fatal 与失败通道」节的 SCHEMA replacement 部分 +
   「单一 write sequencer」节中适用于 SCHEMA write 的槽序/快照/degraded 语义。
   close() barrier、公共事件订阅**不属于本任务**（后续 issue）。
2. **ADR-0008 SCHEMA write 契约原文要点**（逐句为验收锚）：
   - `runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })`；
   - SCHEMA write **不依赖当前 schema 可编译**；与 mutateRoot 共享唯一严格 FIFO
     write sequencer，在自己的完整 sequencer 槽内：
     1. 编译 proposed SCHEMA 并构造新 tools；
     2. 未提供 `root` 时，按 proposed derived 严格提取并验证当前 ROOT，证明逻辑值
        与实际载体均已兼容；
     3. 提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached
        构造完整新内容；
     4. 在一个 transaction 中原子替换 SCHEMA 与必要的 ROOT generation；
     5. transaction 返回后立即安装新 active tools，再 `await notifyDirty()`。
   - SCHEMA 是顶层具名 Y.Map。成功替换时在 transaction 内 `clear()` 后写入恰好
     `lang/version/id/text` 四个字符串键。提供完整 ROOT 时保留顶层
     `doc.getMap('ROOT')` identity，在同一 transaction 内清空并安装已 detached
     构造的内容；其下旧 Yjs 子类型 identity 可失效。不提供 ROOT 时不修改 ROOT，
     也不破坏其 identity。
   - 新 SCHEMA 的编译、最终 ROOT 校验或 detached 构造失败均发生在 transaction 前，
     SCHEMA/ROOT 零写入，active tools 不变。读取在准备期间继续观察旧 committed
     generation；transaction 后才观察新 SCHEMA/ROOT，且 active identity 同步切换。
   - 「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write 仍可
     修复」（§P0 与 active schema）——即 P0 schema-unavailable 态下 replaceSchema
     仍可入槽执行并恢复。
   - 「ROOT mutation 与 SCHEMA replacement 使用各自独立的窄 issue 类型，不形成
     巨型 write issue」（§Fatal 与失败通道）。
   - `persistence-degraded` 阻止 ROOT、SCHEMA 以及未来所有 Y.Doc 写（§单一 write
     sequencer）；fatal 语义同 ROOT write（committed:false 不 notify；committed:true
     /未知异常保守 best-effort notify 但始终 reject；永久关写保读；已排队后续写
     仍取得槽、零访问输入、零写入返回 RUNTIME_WRITE_DISABLED）。
3. **现状基线**（#89/#90 已交付，本分支 HEAD 已含）：
   - `packages/namespace-runtime/src/sequencer.ts`：WriteSequencer promise-chain
     严格 FIFO（enqueue 微任务起步、前项 settle 后项方启、链尾恒绿）；
   - `runtime.ts`：八键闭包公共面（owner/namespaceId/read/getSchemaEnvelope/
     getMetadata/getActiveSchema/getStatus/mutateRoot），seam 构造器
     `createNamespaceRuntimeWithSeam({handle, p0Gate?, compile?, notifyDirty?})`；
     生产构造器包内保留不导出；
   - `write.ts`：ROOT 写槽 S1–S7（S1 lifecycle/fatal gate → S2 writable gate +
     notifier 绑定检查 → S3 槽起点受控 snapshotter 递归冻结快照 → S4 执行时
     active schema → S5 领域校验+detached 构造+单事务（applyValidatedMutation
     唯一 Y.Doc 写入口）→ S6 同槽 await notifyDirty → S7 槽释放）+ 受控
     snapshotter + fatal 分类 + `RootMutationIssue`/`MutateRootResult` 窄结果联合；
   - `p0.ts`：P0 槽体 + `RuntimeState`（schemaState/activeInfo/activeTools/fatal/
     fatalCause）；`status.ts`：六键结构化瞬时 capability 投影（键集恰
     lifecycle/read/rootWrite/schemaWrite/schema/fatal；schemaWrite =
     !fatal && writableNow，rootWrite 另含 schemaState!=='unavailable'）；
   - `errors.ts`：`RuntimeWriteFatalError`（committed + 稳定 phase + 稳定码）；
   - 测试 10 文件 50 用例全绿（packages/namespace-runtime/test/）。
4. **doc-runtime 可复用底层资产**（#87/#88/#90 已交付，公共入口
   `packages/doc-runtime/src/index.ts` 均已导出）：
   - `replaceRootContent(derived, snapshot, doc)`（#88）：完整验证 + detached 构造
     成功后单 transaction 内 `clear()` + 安装，保留顶层 ROOT Y.Map identity；
     与 materializeRoot 复用同一包内 detached builder；前置失败零写入；结果联合
     `{ ok:true } | { ok:false; issues: ReplaceIssue[] }`；
   - `applyValidatedMutation`（#90 恢复导出，set-only）；
   - `extractYjsSnapshot`（严格提取，载体不兼容即失败——AC2「严格提取」候选）；
   - `readLogicalValueAtPath`、`materializeRoot`、`DocRuntimeFatalError`；
   - vfsl 公共面：`compileSchemaEnvelope`（envelope → CompileSchemaEnvelopeResult）、
     `validateLogicalSnapshot`（derived 逻辑验证）。
   - ADR-0008 §必要的底层演进 3：「SCHEMA replacement 可复用 detached builder 与
     原子 ROOT-content replacement helper，不复制 materialization 逻辑」——禁止在
     namespace-runtime 内重写物化/替换逻辑。
5. **P0 槽体与 compile 接缝现状**：P0 只读取 SCHEMA 标准四键、调用 seam 注入的
   `compile`（缺省 vfsl compileSchemaEnvelope）并构造 schema-dependent tools；
   RuntimeState.activeTools/activeInfo 由 P0 安装。replaceSchema 成功后须安装新
   active tools（AC6），getActiveSchema 投影随之切换（AC9 对照）。
6. **快照纪律**（§单一 write sequencer）：输入引用在排队期间可变化；取得槽后
   立即用受控 snapshotter 复制并递归冻结 plain data；replaceSchema 的
   `{ schema, root? }` 输入同样受此约束（S3 同款）；只接受 primitive、
   finite number、null、plain object/array。
7. **成功事务可观测锚**（沿 #90 先例）：成功 replaceSchema = 恰 1 次 Y.Doc 更新
   事件 + 1 次 notifier；失败 = 0 更新事件、0 notifier、state 字节不变、
   active tools 不变。
8. **status 投影**：status.ts 已实现 schemaWrite 瞬时推导（!fatal && writableNow）
   ——unavailable 态 schemaWrite 仍 enabled（与 AC8 恢复路径一致）；若设计触及
   status 语义须保持六键键集不变。
9. **仓库纪律**：pnpm workspace（七包）；测试命令 `pnpm test`（vitest run
   --typecheck，CI 同命令）；`pnpm typecheck` 七包 tsc；另有聚合通道
   `tsc -p tsconfig.typecheck.json`；Node 20/24 CI；改动包须 bump patch 版本
   （硬门禁 9；namespace-runtime 当前 0.1.2）；namespace-runtime tsconfig
   include 仅 src/**（#89 设计 §7.1 决议：测试文件类型注入不纳入 tsc，由
   vitest --typecheck 与聚合通道覆盖）。
10. **CONTEXT.md 术语**：写序列器 / active schema / 信封（lang/version/id/text 四键）
    / 载体投影读取 / validateLogicalSnapshot / 派生 schema / detached 构造。

---

## SA6 Phase 1 验收锚定：测试设计与红灯证据（2026-08-24）

### 测试文件

| 文件 | 锚定范围 |
|---|---|
| `packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts` | AC1–AC9 确定性 seam 测试（13 用例）：未提供 root 幸福路径（四键原子安装/ROOT 零修改/active 切换/恰 1 更新+1 notifier）；共享 sequencer 严格 FIFO（mutateRoot 先占槽 → replaceSchema 排队，AC9 准备期读取旧 generation）；反向（replaceSchema 占槽 notifier 挂住 → mutateRoot 排队，挂住期新 active tools 已安装——AC6 时序锚）；未提供 root 载体不兼容 / 逻辑不兼容零写入失败；提供 root 幸福路径（单事务、顶层 ROOT identity 保持、SCHEMA 恰四键）；提供 root 逻辑校验失败零写入；proposed 编译失败零写入（active tools 不变）；非 plain 输入拒绝（MUTATION_INPUT_NOT_PLAIN_DATA）；排队期间输入引用变化 → 槽起点快照获胜；P0 schema-unavailable 合法恢复 → ROOT write 恢复；persistence-degraded / prior fatal 拒绝（RUNTIME_WRITE_DISABLED、输入零访问、零写入） |
| `packages/namespace-runtime/test/runtime-replace-schema-persistence.test.ts` | AC3/AC8/AC10 真实 Persistence 集成（2 用例）：replaceSchema（提供完整 ROOT）→ 单事务 → saveDoc 登记 → flush → 全新 Persistence 实例跨实例读到新 SCHEMA（四键）+ 新 ROOT；真实 P0 编译失败（非法 SCHEMA 文本）→ unavailable → replaceSchema 合法恢复 → mutateRoot 恢复 ROOT write → flush → 全新实例看到新 SCHEMA 与写入值 |
| `packages/namespace-runtime/test/runtime-replace-schema-type-guard.test-d.ts` | 类型层正锚：`NamespaceRuntime` 公共面必须包含 `replaceSchema` 成员（第九键）——当前缺失 → TS2339 红（vitest --typecheck 与聚合 tsc 双通道）；SA3 加入成员后转绿 |

### 契约锚点（SA1 设计 / SA3 实现的验收行为锚，仅可补充）

1. `runtime.replaceSchema({ schema: proposedEnvelope, root?: completeLogicalRoot })` 成为 runtime 公共面方法（第九键）；模块级入口保持窄（`entry.replaceSchema === undefined`）；
2. 独立窄结果联合：成功 `{ ok: true }`；普通失败（compile/提取/校验/快照拒绝/write-disabled）`{ ok: false, issues: { message, path }[] }` 且零写入；fatal 走 Promise rejection（本 Phase 未确定性锚定 replaceSchema 自身 fatal 通道——触发路径依赖 SA3 对 doc-runtime 接缝的走线，属 SA3 实现后的验证面，见「备注」）；
3. 与 mutateRoot 共享唯一严格 FIFO write sequencer（占槽互斥 + notifier 屏障互通，双向验证）；
4. 不依赖当前 schema 可编译：P0 unavailable 态 replaceSchema 仍可入槽执行并恢复 ROOT write（AC1/AC8）；
5. 未提供 root：按 proposed derived 严格提取并验证当前 ROOT（extractYjsSnapshot 型严格载体判定 + validateLogicalSnapshot）——载体不兼容或逻辑不兼容均零写入失败；成功时不修改 ROOT、不破坏 identity；
6. 提供 root：视为完整最终 logical ROOT——校验 + detached 构造成功后整体替换；顶层 `doc.getMap('ROOT')` identity 保持；旧子类型 identity 不承诺；
7. SCHEMA 是顶层具名 Y.Map：成功替换时 transaction 内 clear 后写恰好 lang/version/id/text 四键（键名四字符串；值型 lang/id/text string、version number——「四个字符串键」指键名）；SCHEMA map identity 保持；
8. SCHEMA 与必要 ROOT 变化在同一次 transaction 原子提交：成功恰 1 次 Y.Doc 更新事件 + 恰 1 次 notifier；
9. AC6 时序：transaction 返回后立即安装新 active tools，再 await notifyDirty——notifier 挂住窗口内 getActiveSchema 已切换新 compile 投影（getActiveSchema().id 新值可观测）；
10. 各类失败（编译/校验/构造/快照拒绝）零写入：0 更新事件、0 notifier、state 字节不变、SCHEMA/ROOT 内容不变、active tools（getActiveSchema）不变、读取保留；
11. write-disabled（persistence-degraded / prior fatal）：ok:false + issues 含稳定码 `RUNTIME_WRITE_DISABLED`、输入零访问（Proxy 观测）、零写入；degraded 不阻止 P0/read；fatal 后读取保留、队列持续流转不挂死；
12. snapshotter 共享（S3 同款）：只接受 primitive、finite number、null、plain object/array；非 plain 输入 → ok:false 含稳定码 `MUTATION_INPUT_NOT_PLAIN_DATA`、零写入；输入对象在排队期间被调用方改动 → 槽开始时刻快照获胜；
13. AC9：准备/排队期间 read/getSchemaEnvelope/getActiveSchema 继续观察旧 committed generation；transaction 后才观察新 SCHEMA/ROOT 且 active identity 同步切换。

### 红灯验证证据

- 定向运行（vitest run，2 文件 15 用例）：**15 failed | 0 passed**；失败形态：14 例 `TypeError: runtime.replaceSchema is not a function` + 1 例 `expected 'undefined' to be 'function'`（首个用例红灯锚行 `expect(typeof runtime.replaceSchema).toBe('function')`——构造性红灯：公共面九键未实现）。
- 类型层通道：`pnpm exec vitest run --typecheck packages/namespace-runtime/test/runtime-replace-schema-type-guard.test-d.ts` → **Type Errors 1 failed**（`TS2339: Property 'replaceSchema' does not exist on type 'NamespaceRuntime'` + 伴随 `TS2349`）。
- 聚合通道：`./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` → exit 2，共 2 错（均为上述类型守卫文件缺失成员；其余新增测试文件经该通道零错——行为断言全部运行时锚定，无源码 grep）。
- 结论：**红灯真实、与实现差距一致**——功能不存在（构造性红灯），无「写了就绿」的假红灯；无无法复现阻塞。实现（SA3）后全部断言转绿即验收通过。
- 备注：replaceSchema 自身的 committed:true/committed:false fatal rejection 通道未纳入本 Phase 确定性锚定——其确定性触发（E204 类 internal 不变量破坏注入）依赖 SA3 对 doc-runtime 组合接缝（replaceRootContent/buildTopEntries 走线）的选型；fatal 语义（永久关写保读 / 后续写 RUNTIME_WRITE_DISABLED）已由 #90 ROOT-write 侧冻结锚 + 本文件 prior-fatal 拒绝用例覆盖同族契约；建议 SA3 实现后由 SA4 验尸或 SA7 动态验证补确定性触发锚。

---

## SA3 实现记录（2026-08-24，issue #91 Phase 3）

### 改动文件清单（严格限设计 §11 ALLOW LIST；DENY LIST 零触碰）

**namespace-runtime（0.1.2 → 0.1.3）**
- `packages/namespace-runtime/src/schema-write.ts` — **新建**：SCHEMA 写槽唯一实现（S1–S7 槽体 + S3 输入形状检查 + S4 proposed 编译与三级分类 + S5.5 installActive 时点 + issue 映射 + `ReplaceSchemaInput`/`SchemaReplacementIssue`/`ReplaceSchemaResult`/`SchemaWriteEnv`）。SA4 红线核验：`grep schemaState` 于本文件 **零命中**（无任何 schemaState 门——D2 R1.1/A7）。
- `packages/namespace-runtime/src/write.ts` — 修改：导出共享槽基建 `snapshotMutation`/`SnapshotResult`/`disabled`/`markWriteFatal`/`rejectWithWriteFatal`/`writeFatalMessage`/`errDetailOf`；fatal 机械参数化槽位 `WriteSlot = 'root'|'schema'`（'root' 默认渲染逐字节不变——`runtime-write-fatal-message-rev1.test.ts` 全绿；'schema' 走独立摘要码与「SCHEMA write」名词）。`runRootWriteSlot` 行为零变化。
- `packages/namespace-runtime/src/p0.ts` — 修改：`@internal` 导出 `installActive`（增 `delete state.schemaIssue`——P0 调用点 no-op）/`assertCompiledShape`（【R1.1/A1】检查面扩展：envelope own 键集**恰** `{lang,version,id,text}` + lang/id/text string + version number + text string（原漏检）+ 双指纹 + module/derived；P0 零回归——真实编译产物恒过、P0 冻结测试无畸形 ok:true 注入）/`toIssueSummary`。
- `packages/namespace-runtime/src/errors.ts` — 修改（append-only）：`FATAL_SCHEMA_WRITE_INTERNAL_CODE`（`NSRT-FATAL-SCHEMA-WRITE-INTERNAL`）/`_MESSAGE` + `RuntimeWriteFatalPhase` 增 `'schema-compile-throw'`（v1 冻结表只增）。
- `packages/namespace-runtime/src/runtime.ts` — 修改：`NamespaceRuntime` 第九键 `replaceSchema`（属性语法 + 类型化 input，D1）+ V3c'' `SchemaWriteEnv` 一次成型（零新增注入点——compile 与 writeEnv 同一批捕获局部量）。
- `packages/namespace-runtime/src/index.ts` — 修改：类型导出 `ReplaceSchemaInput`/`SchemaReplacementIssue`/`ReplaceSchemaResult`（值导出面不变——`entry.replaceSchema === undefined` 锚保持）。
- `packages/namespace-runtime/package.json` — version **0.1.3**（硬门禁 9）。

**doc-runtime（0.1.8 → 0.1.9）**
- `packages/doc-runtime/src/schema-replace.ts` — **新建**：组合 seam `replaceSchemaAndRoot`（⓪ `assertOutermostTransactionContext` → ① prepare（①a root 结构 → E204；①b envelope 形状守卫纵深防御；①c `probeSchemaMap` 四级级联（SCHEMA 缺席 → getMap 惰性创建零 update）；①d keep-root = `extractYjsSnapshot`+`validateLogicalSnapshot` / replace-root = `projectDeclaredRootKeys`→validate→`buildTopEntries`→`probeRoot`；catch 逐字镜像 replace.ts：`DerivedInvariantError → E204`、其余 → E200 模块名制）→ ② `transactGuarded` 单事务（SCHEMA 原实例 clear+恰四次 set [+ ROOT 原实例 clear+entries 安装]）→ ③ `verifySchemaFourKeys`（⑤-S，size+逐键同一性双断言）→ ④ `verifyInstall`（⑤-R）+ `verifySnapshotIntact`（⑥，喂投影形态）→ ⑤ `{ok:true}`）。`projectDeclaredRootKeys` 消费 `detached-build.ts` 的 `@internal recordSlotOf`（单点约定，A6 已落）——顶层未声明键静默剥离（锚 15）、嵌套层保持 F7 响亮拒绝、Record 形全保留、union 不投影（D7 三层论证落入实现注释）。
- `packages/doc-runtime/src/index.ts` — 修改：导出 `replaceSchemaAndRoot` + `SchemaReplaceInput`/`SchemaRootPlan` 类型（+1 值导出；`public-surface-guard.test.ts` 五项必需导出与 `applyValidatedMutation` 唯一性正则不受影响）。
- `packages/doc-runtime/package.json` — version **0.1.9**（硬门禁 9）。

**仓库根**
- `CONTEXT.md` — 修改：`## Language` 节「信封（envelope）」条目后新增「顶层声明域投影（top-level declared projection）」术语条目（D7 末尾逐字基准文本；A2 三处显式化之一，另两处 = `ReplaceSchemaInput.root` JSDoc + `projectDeclaredRootKeys` 实现注释）。

### 实现要点（与设计 §4 D1–D10 逐条对齐）

1. **D2 槽序**：S1 fatal gate → S2 writable+notifier 检查 → S3 `snapshotMutation`+形状检查 → S4 proposed 编译（seam 注入 compile 路由，`assertCompiledShape` 强化守卫先掷）→ S5 `replaceSchemaAndRoot` → S5.5 `installActive`（同步、await notify 前）→ S6 `await notifyDirty()` → S7 释放。两类写共享同一 `WriteSequencer` 实例（runtime.ts 单 sequencer，mutateRoot/replaceSchema 同队列）。
2. **D5 fatal 三分类**：S2 getStatus 抛错 → `write-slot-internal` committed:false；S4 compile 抛出/ok:false 零 issues/畸形 ok:true → `schema-compile-throw` committed:false（结构上先于一切 doc 写）；S5 branded 透传（E201/E203/E204）/未知异常 → `unknown-pipeline-throw` committed:true 保守；S6 notifier 失败 → `notify-dirty-failed` committed:true（新 tools 已装不改回滚）。一律 `markWriteFatal(env, err, 'schema')`（独立摘要码 `NSRT-FATAL-SCHEMA-WRITE-INTERNAL`，status.fatal 来源可判别）+ `RuntimeWriteFatalError` rejection。
3. **D6 单事务原子性**：SCHEMA clear+四键与（提供 root 时）ROOT clear+install 在**同一** `transactGuarded` 内——成功恰 1 次 update；双顶层 Y.Map identity 严格保持（原实例 clear+set，无换名/delete/异型写入）。
4. **D7 顶层声明域投影**：`projectDeclaredRootKeys` 在 replace-root 分支对 snapshot 先做顶层声明键集投影；⑥ 校验消费投影形态（喂 narrowed——喂 raw 会把锚 15 用例变成 E201 fatal）。SA3 自验：`{schema: ns-2b, root:{n:999,a:'x',b:true}}` → ok:true 且 read(['n'])===999、generation 键集恰 {a,n}。
5. **D8 状态迁移单点**：成功路径 `installActive` 一次写齐 activeInfo（五字段直引 compile 产物）+ activeTools + 'ready' + delete schemaIssue；P0 unavailable → ready 恢复 → `status.rootWrite.enabled` 经 status.ts 既有推导自动恢复（status.ts 零改动）。
6. **A3 撕裂态**（设计登记项，SA4/SA7 验证面）：写后 fatal（E201/E203）时事务已提交而 installActive 未执行——getActiveSchema 停留旧 id、read/getSchemaEnvelope 观察新 generation、双写位 false、后续写 RUNTIME_WRITE_DISABLED（notify 失败路径不在此列——tools 已装，active 与 committed 一致）。

### 测试运行证据摘要（全部后台独立进程，.mabf-bg/ 日志与 exit 文件）

| 闸口 | 命令 | 结果 |
|---|---|---|
| 定向（namespace-runtime 全部） | `pnpm exec vitest run packages/namespace-runtime` | **exit 0**：13 文件 66 用例全绿（含 SA6 冻结 13+2 用例全绿 + `runtime-replace-schema-type-guard.test-d.ts` Type Errors 0；既有 10 文件回归全绿） |
| 定向（doc-runtime 全部——公共面 +1 值导出零回归） | `pnpm exec vitest run packages/doc-runtime` | **exit 0**：19 文件 291 用例全绿，Type Errors 0 |
| 全量 | `pnpm test`（vitest run --typecheck） | **exit 0**：83 文件 1069 用例全绿，Type Errors 0（首轮因与 typecheck/聚合 tsc 并行造成 vitest worker `onTaskUpdate` 超时 Infrastructure flake；单独重跑 exit 0） |
| 七包 typecheck | `pnpm typecheck` | **exit 0**（vfsl/vfsl-protocol/vfsl-codegen/persistence/dsh-persistence/doc-runtime/namespace-runtime 全过） |
| 聚合通道 | `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` | **exit 0**（红灯期 2 错已消除：TS2339/TS2349 由第九键成员消解） |
| SA4 红线自验（/tmp scratch，即用即删） | seam 注入畸形 ok:true（envelope 多键）→ `RuntimeWriteFatalError` rejection **phase=schema-compile-throw, committed=false, updates=0**（非 ok:false——A1 已修）；手造环 ref derived → rejection **phase=pre-commit-internal, committed=false, updates=0**（非 E200 ok:false——A4 已修） | 两条均符合设计 D9 表 |

- 红灯转绿对照：SA6 冻结 15 运行时用例 + 1 类型断言全部转绿（红灯现状「15 failed | 0 passed」→ 现 15 用例全绿 + 类型守卫 0 error）；`runtime.replaceSchema` 断言 `typeof === 'function'` 通过；`entry.replaceSchema === undefined` 锚保持。
- 未做：git add/commit（总控统一收口）、push、CI 裁决——均属 SA3 边界外。
- 遗留观察点（移交 SA4/SA7，非本 Phase 缺口）：replaceSchema fatal 通道的确定性冻结锚仍按设计 D9 末条（注入路径 α/β/γ）由 SA4 验尸或 SA7 动态验证补锚；A3 撕裂态观察清单见 D9 末条。

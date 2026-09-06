# SA3 实现轮冲突复审（conflict recheck）— Issue #226 implementation R0

- 被审对象：`wiki/raw/task_issue-226_sa3_impl.md`（dispatch `sa-a86630cb`，verdict approve-ready，
  `requiresConflictRecheck: true` 的触发点 = §7/§7.1 对 #155 lifecycle/SA7 测试时序锚的随票修订）
  及其全部落地改动：
  - 生产：`packages/namespace-registry/src/diag-pump.ts`（新增）、`create-diagnostic.ts`、
    `registry.ts`、`plugin.ts`（仅注释）、`apps/yjs-server/src/diagnostics.ts`（仅头注释）、
    两处 `package.json` 版本号（registry 0.1.7→0.1.8、yjs-server 0.1.2→0.1.3）
  - 测试修订（本轮复审焦点）：`apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`
    （E1/E3 到达 poll 化，47+/0−）、`apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts`
    （D8 到达 poll 化微修；C1 R3 修订为 rev1 轮既有已复审面）、
    `packages/namespace-registry/test/registry-surface.test.ts`（R4 注释，零正则改动）
  - 新契约文件：`packages/namespace-registry/test/registry-issue-226-red.test.ts`（rev1 落地形态）
- 复审基准：简报 AC1–AC5（`task_issue-226.md`）、批准设计（`task_issue-226_design.md` iter4 §2–§10）、
  SA2 attack review **approve**（§5 观察项）、rev1 契约 + 其 SA8 recheck **clear**（R1–R4/N1–N5/§7/§8）、
  SA8 design-conflict（C1–C3）、ADR-0011 / ADR-0012（诊断日志版，含 2026-08-28 amendment L250/L252）/ 0008 / 0009 / 0010 被引条款、
  #149/#150/#155 基线
- 复审方式：全部独立重验——git diff 全量亲读（逐 hunk）、生产锚点亲读（diag-pump 全文、
  create-diagnostic 三态路由、registry 装配点与 8+2 发射点、types.ts seam、三处 factory 调用点）、
  ADR 条款回查原文、契约锚行号与 rev1 recheck 记录逐一比对、五组后台 Job 独立重跑（§3）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，基线 HEAD `45a22f0`，
  SA3 改动未提交——git status 与 SA3 §1 清单一致）
- 边界：零生产代码改动、零测试改动、零 git 操作；唯一写入 = 本文件
- 时间：2026-09-06（implementation conflict recheck 轮）

## Verdict

**clear**（`requiresConflictRecheck: false`）

触发本轮的三项测试时序锚修订（E1/E3/D8）全部属 SA8 C3 裁决同类或 SA2 §5.1 预授权域内，
断言本体零改动、契约语义无弱化；实现与批准设计、rev1 契约、ADR-0011/0012 及 #149/#150/#155
基线零冲突。本轮独立重跑：#226 契约 13/13 绿、#149+#150+守卫+相关 58/58 绿（顺序复跑）、
#155 两套件 28/28 绿（C1 翻绿 + D8 微修 + E1/E3 修订后）、根 typecheck 零错误。逐项论证见 §1/§2。

## 1. 复审焦点：三项测试时序锚修订的合法性

### 1.1 E1/E3（lifecycle-red，47+/0−）— SA8 C3 同类，裁定合法

- **diff 亲读**：两处修订均为**纯插入**（0 删除行）——在既有断言/动作前插入「到达 poll」
  （等 provision 的 `namespace-create` + `replication-enable` 记录经 drain 落盘，5s 界、撕裂读重试），
  其后 `currentStreamId`/`signalAndExit`/全部既有断言**逐字未动**。
- **同类性成立**：原 E1 在 ready 观测后**同步**读 `current.json`、E3 在 ready 后**立即** SIGTERM——
  把「建流/落盘与 ready 同刻到达」的修复前时序冻结为期望。#226 AC3 明文要求建流不在业务关键路径内
  （生产载体 = macrotask drain），故该时序锚与 AC3 正面冲突——与 SA8 C3（#155 SA7 C1 三锚冻结
  缺陷 A 行为）同类，只是 SA6 rev1 重新固话时的落后面（rev1 只覆盖了 SA7 文件 C1）。
  机制上本轮亲读 diag-pump 证实：入队点 `setImmediate`（check 阶段）必晚于 ready 观测的微任务链
  → 修复后同步读确定性缺席。
- **基线对照证据链**：SA3 §7 记录 stash 实现后原样运行全套件 22/22 绿（2026-09-06）——
  红由 #226 载体引入，非独立缺陷。本轮实现态重跑 22/22 绿（§3）。
- **语义无弱化**：E1 仍断言单 stream 目录、首条 genesis-baseline、双 operation 记录、数据面隔离
  （snapshot 无策略标记）——「日志从创建起」语义保持，仅到达方式从「同步可读」放宽为「5s 界内到达」；
  E3 仍以 30s 界 + exit 0 证明有界停机、停机后 strict 读——AC4「不能无限延长 shutdown」的规范性
  锚在 #226 契约 T9/T13（本轮证实未被 SA3 触碰，§2.2），E3 从属 app 级旁证。
- **旁证收敛**：E2/E4/E5 无需同类修订的结构原因本轮核实——其首读均发生在 ≥1 次跨进程
  sendOp 往返之后（子进程事件循环已让渡多轮，drain 必已执行），非时序冻结形状；全套件 22/22 绿佐证。

### 1.2 D8（SA7 文件）— SA2 §5.1 预授权范围内，裁定合法

- SA2 attack review §5.1 原文预授权：「若历史性偶发，按『到达 poll 化』处理（属 #155 文件非 C1
  用例的微调，需另行小修，不属本设计缺陷）」——SA3 在 bash-26 全量轮历史性偶发一次后执行，
  与预授权形状逐字一致：poll `root-mutation` 记录落盘到达（5s 界）后再执行既有读流与 SIGTERM，
  **断言本体零改动**（diff 亲读：纯插入，其后的 `readStreamStrict`/全部断言未动）。
- 附带效应（SIGTERM 前子进程 drain 已排空 → 消除 tsx 信号中继窗命中面）与 SA2 分析的
  停机时序一致；本轮重跑 D8 用例绿（9.4s 进程级 E2E，§3）。

### 1.3 C1（SA7 文件）— rev1 轮既有已复审面，本轮零触碰证实

git diff 中 C1 相关 hunk 与 rev1 recheck §1 R3 行记录的落地形态一致（`dropsEarly toHaveLength(0)`、
B 半 poll `namespaces/NS_B/current.json` + 恰 1 条 attempt（transaction/NAMESPACE_CREATE_FAILED/rejected）、
A 流干净面保持、结尾 drops===0 断言仍位于 release/shutdown/host.close **之前**（本轮亲读 L310–320）；
唯一新增文本 = D8 hunk 与两行注释措辞（`manager-closed`→`manager-failed` 注释勘误，断言未动）。

## 2. 实现 vs 设计 / 契约 / ADR / 基线

### 2.1 生产改动面逐点对照（批准设计 §3/§8）

| 项 | 亲读结论 |
|---|---|
| diag-pump.ts | 与设计 §3.1 逐点一致：per-ns FIFO + 单飞 drain、裸 `setImmediate`、有界 256 drop-newest（保序）、逐任务 try/catch 非抛、排空后 `queues.delete` 释放 Map 位、零公共导出（index.ts 无 re-export——grep 证实）。ADR-0012 L252 不触发（adapter 单 record 同步 append 语义一字未动，泵只搬调用点 = amendment L250 选项 (a)） |
| create-diagnostic.ts | 路由三态与设计 §3.2 表逐行一致：legacy（无 runtimeEmitterFor）路径行为逐字节现行（共享 emitter 同步发射 + initStream 同步调用）；泵路径 emission 组装留捕获点（`assembleEmission`，载荷字段/observedAt 与 #150/#155 现状同位）；被拒 create 先 `initStream(ns, undefined)`（genesis-less——ADR-0012 L22「genesis 未成功写入时 stream 仍可记录诊断事实」）再落结局（同 ns FIFO 次序）；`resolveRuntimeDiag` 产物 = O(1) 延迟 wrapper（`clock: () => clock.now()` 不变）；公共入口 `undefined` → 恒同步共享通道（设计 §7.2） |
| registry.ts | 装配点合并为 `createDiagRuntime`（设计 §3.3 唯一 wiring 点）；三处 factory 调用点（L1229/L1442/L1586）零改动；槽体业务步骤零改动。**SA3 §4 偏差 1（发射调用点参数化 `emitOutcome(ns, …)`/`emitEarlyOutcome(ns\|undefined, …)`）裁定合法**：`CreateDiag` 是包内内部接口而非 Host seam——seam 冻结对象 `types.ts` `NamespaceRegistryDiagnosticLog` 三成员 `{emitter; initStream?; runtimeEmitterFor?}` 零新增零改动（亲读）；8 个槽内调用点只加传候选 id（载荷/observedAt/位置零改动），公共入口 2 点传 `undefined` 维持无归属同步面；legacy 路径忽略该参数。物理不可实现性论证成立（泵需 ns 数据键控键而原签名不携带） |
| Host diagnostics.ts | 仅头注释/行注释更新（文档级，设计 §3.4 建议项）——零代码语义改动（diff 亲读：全部 hunk 在注释内） |
| plugin.ts | 仅注释内函数名引用更新（`createCreateDiag`→`createDiagRuntime`）——文档级。**登记：SA3 §1 表未单列此项**（见 §4 卫生注记 1） |
| 版本号 | 两个改动包均按硬门禁 bump ✓ |
| 零改动面证实 | `packages/namespace-runtime/**`、`packages/namespace-diagnostic-log/**`、`types.ts`、`index.ts` 均未触碰（git status + grep）→ #149 AC4 `emitCalls===2` 直注锚结构性零漂移（14/14 绿，§3） |

时序纪律（recheck §8.2/SA2 obs 5）：泵调度只发生在入队点（槽内 O(1) `setImmediate`），
Registry/Runtime 结算路径零 macrotask 让渡——T8–T13 顺序锚全绿（§3）即该纪律的可执行证明。

### 2.2 契约本体未被实现轮弱化

`registry-issue-226-red.test.ts` 为未跟踪文件、无 git 基线可比对——本轮以 rev1 recheck 记录的
锚行号/形状逐一比对：T8 poll+顺序（L495–506）、T9（L540–544）、T10（L577–581）、T12（L587 起，
生产装配全链路注入注释在）、T13（L628–655，poll `emit:<ns>:2:end` + 顺序 + 墙钟旁证）全部与
recheck 记录吻合；13 用例全集在场且全绿（§3）。SA3 未借实现之机改动契约锚。

### 2.3 ADR 合规（本轮回查原文）

| 条款 | 裁决 |
|---|---|
| ADR-0012 amendment **L250**（File adapter emit 接入点必须在 sequencer slot 之外/释放后） | 合规且强于要求：initStream/ensure/emit 全部移至 macrotask drain（一切业务槽与槽间窗口之外） |
| ADR-0012 **L252**（未来 queue/batch 切片四类语义义务） | 不触发：adapter 存储语义一字未动；泵有界/丢弃为调用方侧局部纪律 |
| ADR-0011 emit seam（L117 帧：「不得阻塞、throw、返回 durability promise」）+ L129（「adapter 慢/失败/队列满不得延长 write slot 或阻塞 close/shutdown；停止不得无限等待日志 sink」） | wrapper `emit = O(1) 入队` 即 seam 语义本身；泵与 shutdown 零耦合（不清、不等、不 disposer）——T9/T13 锚为该条款可执行化 |
| ADR-0011「日志不得引入第二个业务排序机构」 | 泵只序 per-ns 诊断投递（FIFO = emission 序 → ADR-0012 sequence 连续性载体），零业务排序面 |
| ADR-0012 **L22/L24**（genesis 诚实缺席；配置 stream 创建时冻结） | genesis-less 流只记 attempt 事实；T11/C1 不锚 replay complete（N4 边界保持） |
| 词表冻结 | 零新 operation/stage/code/result 值——`assembleEmission` 输出字段与现状同位（AC5 内容锚全绿佐证） |
| seam 冻结 + 静态守卫 | types.ts 三成员零新增；`setImmediate` 全 src 仅 diag-pump.ts L137 一处调用点（grep 证实）——与 R4 注释「本注释只授权 diag-pump 一处」逐字吻合；三正则不含 setImmediate，守卫 12/12 绿 |

### 2.4 #149/#150/#155 基线

- **#149**（runtime-root-schema-diagnostic-red，14 用例）：文件零改动、Runtime 包零改动、直注不经
  wrapper——14/14 绿（§3 bash-35）。C2 互斥根源维持消解态。
- **#150**（registry-create-diagnostic-red，16 用例）+ code-source（6）+ sa7-dynamic（10）：文件零改动；
  无 `runtimeEmitterFor` Host → legacy 路径逐字节现行——32/32 绿（§3）。
- **#155**：SA7 6/6（C1 翻绿 = #226 全量门兑现；C1b/M2/镜像/fatal 零触碰）+ lifecycle-red 22/22
  （E1/E3 修订后）——28/28 绿（§3）。全 repo `unattributed` 反向锚维持清零（recheck §4 盘点 + C1 现锚 0）。

## 3. 本轮独立重跑证据（后台 Job，2026-09-06）

| 套件 | Job | 结果 |
|---|---|---|
| #226 修订后红契约 | bash-30 | **13 passed (13)**，Type Errors 0，15.43s |
| #149+#150+code-source+sa7-dynamic+registry-surface 守卫（5 文件组合） | bash-31 | 57 passed \| 1 failed（registry-surface「主入口 export keys 恰九个」**边际超时**——见下） |
| 同 5 文件组合**顺序独跑**复现 | bash-35 | **58 passed (58)**，Type Errors 0，exit 0，33.85s |
| registry-surface 单文件 | bash-34 | **12 passed (12)**（export-keys 用例 3475ms 单跑通过；declaration 审计 10–17s 级均绿） |
| #155 SA7 + lifecycle E2E | bash-32 | **28 passed (28)**（SA7 6/6 含 C1/D8；lifecycle-red 22/22 含 E1/E3），Type Errors 0 |
| 根 typecheck（14 tsconfig） | bash-33 | exit 0，零错误 |

**bash-31 单败裁定 = 环境负载型边际超时，非实现回归**：该轮我同时并发 4 个重作业（vitest×3 +
typecheck）于满载 4 核机（SA3 §6 已登记整日 load ~6.7–8.1）；export-keys 用例单跑即需 3.5s、
贴着 5s 默认用例预算，并发下打穿。顺序独跑同组合 58/58 绿 + 单文件 12/12 绿（bash-34/35）
双重复现通过，且该用例（#112 冻结清单）与 #226 改动面无交集（index.ts 零改动、grep 证实
diag-pump 未被 re-export）。与 SA3 §6 的负载抖动分析同型。

## 4. 卫生注记（非阻断，移交 SA4/SA7 知悉）

1. **plugin.ts 注释改动未列入 SA3 §1 表**：文档级（函数改名后的引用同步），语义零影响——
   本轮 diff 亲读证实仅注释一行；登记为报告完整性瑕疵，非冲突。
2. **N1（泵溢出内部丢弃计数）按建议项跳过**：与设计 §7.4/attack review obs 3 一致
   （Registry 无日志健康通道，ADR-0011 健康归 Host/adapter observer；无消费者即死代码）——合规跳过。
3. **`streamedNamespaces` Set 随尝试 namespace 数单调增长**（每条 33 字符字符串，Registry 寿命内
   不释放）：内存卫生注记，量级无害、非契约/ADR 冲突——SA4 静态验尸域。
4. **E3 修订后 app 级不再覆盖「SIGTERM 落在 drain 执行窗内」场景**：该面由 #226 契约 T13
   （close barrier 与在途写）+ T9（shutdown 排序）单元级锚与设计 §7.5（迟到 drain 落
   `manager-closed` 桩——C1b 直探用例在场）承载——观察项，非冲突。

## 5. 结论

- 触发项（E1/E3/D8 时序锚修订）：**合法**——C3 同类/SA2 §5.1 预授权、断言本体零改动、
  语义无弱化、基线对照证据链完整（§1）。
- 实现：与批准设计 §2–§9、rev1 契约（未被弱化）、ADR-0011/0012/0008/0009/0010 零冲突（§2）。
- 基线：#149/#150/#155 全绿、守卫全绿、根 typecheck 零错误（§3）。
- SA3 `requiresConflictRecheck: true` 的遗留问题本轮收口：无残余冲突。

## 6. 本轮边界

- 零生产代码、零测试/守卫、零 git 操作；测试全部经后台 Job（bash-30 至 bash-35）；
  唯一写入 = 本文件。
- 结构化结果：verdict `clear`、`requiresConflictRecheck: false`；
  artifactPaths = 本文件 + 被审 SA3 实现报告 + 批准设计 + rev1 契约及其 recheck + SA2 attack review。

Verdict: **clear** — `requiresConflictRecheck: false`

# SA3 实现报告 — Issue #226 创建诊断覆盖与日志生命周期隔离（implementation R0，dispatch sa-a86630cb）

- 任务：Issue #226（bugfix）— `wiki/raw/task_issue-226.md`（AC1–AC5；Parent PR #142）
- Worktree：`/home/wangjian/nomicore-fix-issue-226`（branch `mabf/issue-226`，基线 HEAD `45a22f0`）
- 输入（全部已复核）：`task_issue-226_design.md`（SA1 design iteration 4，approve 面 §2–§9）、
  `task_issue-226_design_attack_review.md`（SA2 **approve**，§5 移交 SA3 观察项）、
  `task_issue-226_red_contract_rev1.md` + `task_issue-226_red_contract_rev1_conflict_recheck.md`
  （SA8 recheck **clear**，§8 SA3 完成门）、`task_issue-226_design_conflict_report.md`（SA8 C1–C3/N1–N5）
- 实现轮时间：2026-09-06 10:47 – 12:0x（本地）；全部验证经后台 Job（`bash-12` 至 `bash-25`）

## Verdict（实现完成门）

**approve-ready**：修订后红契约 13 用例全绿；#149/#150 相邻基线全绿；#155 SA7（C1 翻绿）与
#155 生命周期 E2E 套件全绿；静态守卫套件全绿；根 typecheck 零错误；全量回归结果见 §6。
本文件为 SA3 交付物——待 SA4 静态验尸与 SA7 动态验证独立复核（含 §7 的 rev1 落后面修订，
建议 SA8 recheck 例行确认）。

## 1. 实现清单（与 SA1 设计 §8 文件级改动面对照）

| 文件 | 改动 | 设计对照 |
|---|---|---|
| `packages/namespace-registry/src/diag-pump.ts`（**新增**） | per-namespace FIFO + 单飞 `setImmediate` drain + 有界 256 drop-newest + 全程逐任务 try/catch 非抛 + 排空后 Map 位释放。零公共导出（index.ts 不 re-export） | §3.1（载体 = amendment L250 选项 (a)：只移调用点，非 L252 writer queue） |
| `packages/namespace-registry/src/create-diagnostic.ts` | `createDiagRuntime` 单一装配（diag + resolveRuntimeDiag 共享同一泵）；泵路径路由（早结局 8 点以候选 ns 数据键控入泵 + 被拒 create genesis-less 补建流；initStream/#17/#18 入泵；resolver 产出 = O(1) 延迟 wrapper）；legacy 路径（无 `runtimeEmitterFor`）逐字节现行；公共入口无归属拒绝恒同步共享通道；emission 组装留在捕获点（assembleEmission——载荷/observedAt 与 #150/#155 现状同位） | §3.2/§3.3 路由三态表；§6 trace (a)–(e) |
| `packages/namespace-registry/src/registry.ts` | 装配点一行（L776–779 两构造合并为 `createDiagRuntime`）；**发射调用点参数化**：槽内 8 个建流前发射点加传 `id.namespaceId`，公共入口 2 点传 `undefined` | §3.3（见 §4 偏差登记） |
| `packages/namespace-registry/test/registry-surface.test.ts` | **R4**：§2.M 守卫注释固化「`setImmediate` 为 diag-pump 显式许可的调度原语、三正则有意不含之」——零正则改动 | rev1 R4 + recheck §1 R4 行 |
| `apps/yjs-server/src/diagnostics.ts` | 头注释更新（文档级）：无归属通道语义修订（#226 后只收公共入口级拒绝/结构性迟到流量）；adapter 构造时机出槽注记 | SA2 obs 4 / 设计 §3.4 |
| `apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` | E1/E3 到达 poll 修订（**§7 落后面**，47+/0−，断言本体零改动） | SA8 C3/R3 同类裁决（见 §7） |
| `apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts` | D8 到达 poll 微修（**§7.1**，SA2 obs 5.1 预授权执行，断言本体零改动） | SA2 §5.1 |
| `packages/namespace-registry/package.json` | 0.1.7 → **0.1.8** | 硬门禁 9 |
| `apps/yjs-server/package.json` | 0.1.2 → **0.1.3** | 硬门禁 9 |

零改动：`packages/namespace-runtime/**`（Runtime 包零生产改动——B3 经生产 wiring wrapper 解决）；
`apps/yjs-server/src` 除注释外零改动；`namespace-diagnostic-log` 零改动（泵只经公共类型 import）。

## 2. 机制（实现后的路由三态）

- **生产形状**（seam 有 `runtimeEmitterFor` + `initStream`）：`createDiagRuntime` 构造泵。
  槽内 8 个建流前结局：捕获点组装语义 emission → （首次）`enqueueInitStream(ns, undefined)`
  genesis-less 补建流 → `enqueueEmit(ns, record)`；L1438 `initStream(bytes)` → 入队
  （O(1)）；#17/#18 → 入队；三处 factory 第三参 = wrapper（`emit` = O(1) 入队，构造时
  零解析——B2/B3 同步存储同时出槽/出窗）。drain 在 macrotask check 阶段同步顺序执行
  该 ns 队列（init-stream 先于 emit，per-ns FIFO = #150 DC-2 次序的新载体），逐任务
  try 收编 Host 违约。
- **legacy 形状**（无 `runtimeEmitterFor`，#150 缓冲型 Host）：无泵，全部走既有同步共享
  emitter / 同步 initStream 路径——行为逐字节现行（#150 16 用例零漂移实证）。
- **公共入口** acceptance/identity 拒绝（ns 生成前）→ 恒同步共享通道（非缺陷 A 对象）。

## 3. 时序纪律（recheck §8.2 / SA2 obs 5 落实）

Registry 槽内/槽间窗口与 Runtime 结算路径零 macrotask 引入：槽内残余日志工作 = O(1)
组装 + Map push；drain 调度 `setImmediate` 只发生在入队点，执行点在业务路径外。
T8–T13 顺序锚（到达 poll + 顺序）与墙钟旁证全绿证明该纪律成立（§5）。

## 4. 对设计文件级改动面的偏差登记（均已论证、非语义偏差）

1. **发射调用点参数化**：设计 §3.2「CreateDiag 方法签名不变 + registry.ts 仅装配点一行
   改动」在物理上不可实现——泵路径必须以候选 ns 为数据键控键，而早结局方法原签名不携带
   ns；槽内调用点在发射时点持有 `id.namespaceId`（SA1 §1.1 自证），故把
   `emitOutcome(namespaceId, observedAt, e)` / `emitEarlyOutcome(namespaceId | undefined, e)`
   参数化。8 个槽内调用点逐点加传（载荷/observedAt/调用位置零改动）；公共入口传
   `undefined` 维持无归属同步面。legacy 路径忽略该参数（行为逐字节现行）。
2. **N1（泵溢出内部丢弃计数）**：未落地——「建议项、零成本预留、不进公共面」；Registry
   无日志健康通道（ADR-0011：健康归 Host/adapter observer），计数器无消费者即死代码，
   故按建议性质跳过并在本文件登记（SA4 可复核）。
3. R4 注释按 rev1/recheck 移交落地（§1 表）；Host 头注释顺带更新（SA2 obs 4）。

## 5. 验证证据（后台 Job；真实退出态 + 输出摘要）

| 套件 | 命令（Job） | 结果 |
|---|---|---|
| 修订后红契约（T1–T13 全集） | `pnpm test packages/namespace-registry/test/registry-issue-226-red.test.ts`（bash-13） | **13 passed (13)**，Type Errors 0，Duration 4.76s（修复前基线 = 12F\|1P，recheck §3 复现） |
| #149+#150+守卫+相关 | registry-create-diagnostic-red（#150 16）+ runtime-root-schema-diagnostic-red（#149 14）+ sa7-dynamic 10 + code-source 6 + registry-surface 12（bash-14） | **58 passed (58)**，Type Errors 0（#149 AC4 `emitCalls===2` 同步锚保持；守卫零命中） |
| #155 SA7（含 C1 翻绿 + D8 进程级） | `pnpm test apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts`（bash-15） | **6 passed (6)**：C1 三新锚绿（B 以 NS_B 归属落盘、0 unattributed drop、目录存在、A 流干净）、D8 SIGTERM exit 0 零丢弃 |
| #155 生命周期 E2E（E1–E5） | `pnpm test apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts`（bash-20 修复前红 / bash-23 修订后） | 修订后 **22 passed (22)**（E1/E3 见 §7） |
| 根 typecheck（14 tsconfig） | `pnpm typecheck`（bash-16 前置段） | exit 0，零错误 |
| 全量回归 | `pnpm test`（bash-24，见 §6） | 见 §6 |
| whitespace | `git diff --check` | exit 0 |

## 6. 全量回归与宿主负载型抖动分析

- **bash-16 全量（默认 5s 超时，load 7.5/4 核）**：`2865 passed | 4 failed`——4 个超时集中在
  `registry-phase5-replication-session-red.test.ts`（AC-5/补锚 (a) 等，5s 超时）；**单文件重跑
  22/22 绿**（两个被指用例单跑 2.5–2.7s——纯负载型边际超时；该文件零诊断接线，与 #226 结构性无关）。
- **bash-18 全量（默认 5s 超时）**：`2863 passed | 6 failed`——失败集合与 bash-16 **完全不同**
  （lifecycle-red E1/E3、root-lock real-process race、vfsl-codegen CLI ×2、ws-replication
  real-transport），均为 5s 边际超时型；除 E1/E3（§7 真因）外逐一单跑复绿（root-lock 7/7、
  ws-replication 4/4；generate-cli-check 8 用例中 7 绿、1 个 CLI 子进程用例单跑仍偶发超时——
  独立于本票的负载敏感用例）。
- **bash-24 全量（默认 5s 超时；E1/E3 修订后）**：`2867 passed | 2 failed`——仅
  vfsl-codegen CLI 子进程用例 2 个 5s 边际超时（该包零改动、与 #226 零路径重叠；
  其中「自定义输出 --check」用例单跑即需 5.87s > 5s——纯环境边际，非本票回归）。
- **bash-26 全量（--testTimeout=30000，仅放宽用例预算、零跳过零禁用）**：`2868 passed | 1 failed`
  ——唯一失败 = SA7 文件 D8（进程级 E2E；此前 4 轮全绿），按 SA2 obs 5.1 预授权到达
  poll 化微修（§7.1）后单跑复绿。
- **bash-28 全量（--testTimeout=30000，D8 微修后）**：**260 passed (260) 文件 / 2869 passed
  (2869) 用例，Type Errors 0**——唯一残留 = vitest worker RPC 超时
  （`[vitest-worker]: Timeout calling "onTaskUpdate"`，宿主 load ~8/4 核下的编排层噪声，
  零测试失败）。
- **bash-29 全量复跑（同预算）**：**260 passed (260) / 2869 passed (2869)，Type Errors 0**
  ——同上，残留 Errors 2 全为 worker RPC 超时噪声（`full-final.log` 佐证），内容全绿两次连续
  复现。
- 宿主负载：整日 load ~6.7–8.1/4 核（6 用户共享机）；默认 5s 预算下多处进程级/CLI
  子进程套件的边际超时轮次间漂移，逐一单跑复绿（registry-phase5-replication 22/22、
  root-lock 7/7、ws-replication real-transport 4/4、vfsl-codegen 7/8 其中 1 个单跑即需
  5.87s、lifecycle-red 22/22、SA7 6/6）——本票相关套件全部确定性绿。

## 7. rev1 契约落后面修订（SA8 C3/R3 同类裁决的延伸；建议 SA8 recheck 例行确认）

**发现**：SA8 C3/R3 重新固话只覆盖 `diagnostic-replay-host-lifecycle-sa7.test.ts` C1；本文件
（#155 生命周期 E2E 红套件转绿基线）E1/E3 的**未 poll 跨进程读/杀时序**同样冻结了修复前
时序：E1 在 ready 观测后立即读 `current.json`；E3 在 ready 后立即 SIGTERM。

**证据**：实现后 E1 确定性红（3/3，`current.json` 在 ready 观测 ~70ms 后才由 drain 建立——
进程内探针实测）；E3 红（tsx CLI 信号中继 30ms 应答窗被子进程 drain 同步 fs 窗打穿 →
父进程 143，非停机语义缺陷）。**基线对照**（stash 实现后原样运行，2026-09-06）：E1/E3 及
全套件 **22/22 绿**——确认由 #226 延迟投递载体引入，属「锚把修复前时序断言为期望」的
C3 同类，而非独立缺陷。

**修订（47+/0−，断言本体零改动）**：E1/E3 各自在既有断言前插入「到达 poll」——等待
provision 的 `namespace-create` + `replication-enable` 记录经 drain 落盘（poll 让出事件循环
→ drain 执行；5s 界；撕裂读重试）后再执行原有读/SIGTERM。语义保持：E1「日志从创建起
（genesis + 两 operation）与数据面隔离」；E3「有界停机（30s 界 exit 0）+ 停机后 strict
一致」——有界性仍由 30s 界证明。修订后全套件 22/22 绿（bash-23）。

### 7.1 D8（SA7 文件）到达 poll 化微修——SA2 obs 5.1 预授权执行

SA2 attack review §5.1 已登记「verify-write 回复后无 poll 同步读流」为修复后唯一不带 poll
保护的跨进程读时序点并预授权：**「若历史性偶发，按『到达 poll 化』处理（属 #155 文件非 C1
用例的微调，需另行小修，不属本设计缺陷）」**。bash-26 全量轮（此前 4 轮全绿）该用例历史性
偶发一次（写入 pump drain 晚于回复到达的跨进程读窗 + SIGTERM 落在 drain 执行窗内）。
按预授权执行微修：读流前 poll `root-mutation` 记录落盘到达（5s 界；撕裂读/current.json
未达重试）——断言本体零改动；顺带保证 SIGTERM 前子进程 drain 已排空（消除 tsx 信号中继窗
命中面）。微修后 D8 单跑复绿（bash-27）、bash-28/bash-29 全量连续两轮全绿（260/260，
2869/2869）。

## 8. 边界与移交

- 本实现轮唯一写入 = 本文件 + §1 代码/测试改动 + dispatch 日志行 6。
- 移交：SA4 静态验尸（重点：§4 偏差 1 的合理性、泵并发/内存面、§7 修订合法性）；
  SA7 动态验证（重点：T1–T13/C1/E1–E5 活链路、D8 时序）；建议 SA8 对 §7 落后面 recheck。
- 结构化结果：summary + artifactPaths（本文件 + 全部实现文件）；verdict `approve-ready` 语义
  见首节（实现门完成，待 SA4/SA7 双清）；`requiresConflictRecheck: true`（§7 落后面建议例行复审）。

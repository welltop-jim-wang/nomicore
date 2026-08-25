# SA7 动态验证报告 — namespace-runtime replaceSchema（issue #91 Phase 4）

- **Date**: 2026-08-24（SA7 独立动态验证）
- **对象**: SA3 实现（工作树未提交 diff：base `docs/namespace-runtime`@1616c28 == HEAD；`schema-write.ts` / `schema-replace.ts` 新建 + 7 文件修改 + 3 冻结测试）
- **输入**: 任务简报（AC1–AC10 + SA6 冻结 13 契约锚）、设计 R1.1（重点 D8/A3 撕裂态、D9 末条注入路径 α/β/γ）、SA2 评审 §5 红线、SA4 验尸报告（§10 补锚配方 / §12 动态审核重点）、ADR-0008
- **产出（新增测试文件，属 SA7 职责面，沿 #90 `runtime-mutate-root-sa7-dynamic.test.ts` 先例）**: `packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts`（9 用例，未 commit——总控统一收口）
- **Verdict**: **pass**（四闸口独立复跑全绿 + fatal 通道 α/β/γ 确定性补锚全绿 + SA2 红线动态核验全过 + AC9 时序实证 + Persistence 集成独立复跑通过；0 新发现问题）

---

## 0. Step 0/Step 1 结论（Skill 流程）

```
[SA7 Step 0 结论]
SA4 verdict: pass（sa4_review.md 顶部 Verdict 行：pass，0 CRITICAL / 0 HIGH / 0 MEDIUM）
操作: 进 Step 1（SA4 已过关，SA7 不下调只可上发）

[SA7 Step 1 结论]
SA6 红灯（现为冻结回归）: 🟢 GREEN —— runtime-replace-schema-sequencer.test.ts 13 用例 +
  runtime-replace-schema-persistence.test.ts 2 用例 + type-guard 1 类型断言，在本轮
  定向与全量复跑中全部真实执行且通过（见 §2/§3 证据摘录）
操作: 进入清单驱动验证
```

## 1. 独立复跑四闸口（全部后台独立进程，日志 `.mabf-bg/sa7-*`）

| 闸口 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 全量（含 SA7 新增 9 用例） | `pnpm test`（vitest run --typecheck） | **exit 0**：**Test Files 84 passed (84) / Tests 1078 passed (1078) / Type Errors no errors**（基线 83 文件 1069 用例 + SA7 补锚 1 文件 9 用例） | `.mabf-bg/sa7-final-serial.log`（exit 载 `.mabf-bg/sa7-final-full.exit` = FULL_EXIT=0） |
| 七包 typecheck | `pnpm typecheck` | **exit 0**（vfsl/vfsl-protocol/vfsl-codegen/persistence/dsh-persistence/doc-runtime/namespace-runtime 全过） | `.mabf-bg/sa7-full-typecheck.log`（EXIT=0） |
| 聚合通道 | `npx tsc -p tsconfig.typecheck.json --noEmit` | **exit 0** | `.mabf-bg/sa7-aggregate-tsc.log`（EXIT=0） |
| 定向 namespace-runtime | `pnpm exec vitest run packages/namespace-runtime` | **exit 0**：**Test Files 14 passed (14) / Tests 75 passed (75) / Type Errors no errors** | `.mabf-bg/sa7-final-serial.log` [2/3] 段（NSRT_EXIT=0） |
| 定向 doc-runtime | `pnpm exec vitest run packages/doc-runtime` | **exit 0**：**Test Files 19 passed (19) / Tests 291 passed (291) / Type Errors no errors**（含 public-surface-guard——+1 值导出零回归） | `.mabf-bg/sa7-final-serial.log` [3/3] 段（DOCRT_EXIT=0） |
| Persistence 集成独立复跑 | `pnpm exec vitest run packages/namespace-runtime/test/runtime-replace-schema-persistence.test.ts` | **exit 0**：Test Files 1 passed (1) / Tests 2 passed (2) | `.mabf-bg/sa7-persistence.log`（EXIT=0） |

**Infrastructure flake 登记（非测试失败）**：首轮全量与 `pnpm typecheck` / 聚合 tsc 三重量级进程并跑，vitest worker 出现 2 条 `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error（测试本体 `Type Errors no errors`、无任何用例失败）——与 SA3 实现记录登记的同型 flake 一致。**单独串行重跑后 exit 0**（上表全量行即单独重跑结果；后续定向/持久化复跑均串行排队，未再复现）。判据：fail 形态是 worker RPC 超时而非断言失败，且复跑全绿。

## 2. vitest 触发证据（硬门禁 14 / Skill Step 4）

本任务新增 `*.test.ts`：`packages/namespace-runtime/test/runtime-replace-schema-{sequencer,persistence,sa7-dynamic}.test.ts` + `runtime-replace-schema-type-guard.test-d.ts`。全部经 workspace 级收集（`vitest.config.ts` include `packages/*/test/**/*.test.ts` + typecheck include `*.test-d.ts`）真实执行。全量输出摘录（`.mabf-bg/sa7-final-serial.log`）：

```
 Test Files  84 passed (84)
      Tests  1078 passed (1078)
Type Errors  no errors
```

两包测试文件真实执行的证据（全量输出 ✓ 行摘录）：

```
 ✓ packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts (13 tests) 154ms
 ✓ packages/namespace-runtime/test/runtime-replace-schema-persistence.test.ts (2 tests) 201ms
 ✓ packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts (9 tests) 139ms
 ✓ packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts (12 tests) 124ms
 ✓ packages/namespace-runtime/test/runtime-p0-sequencer.test.ts (7 tests) 76ms
 ✓ packages/namespace-runtime/test/runtime-write-fatal-message-rev1.test.ts (3 tests) 32ms
 ✓ packages/doc-runtime/test/replace-root-content.test.ts (13 tests) 63ms
 ✓ packages/doc-runtime/test/public-surface-guard.test.ts (3 tests) 10ms
 ✓ packages/doc-runtime/test/extract-yjs-snapshot.test.ts (21 tests) 56ms
（两包全部 14 + 19 文件均在 runner 列表内，完整清单见日志）
 ✓  TS  packages/namespace-runtime/test/runtime-replace-schema-type-guard.test-d.ts (1 test)
```

| Workspace Package | 通道 | 触发结果 | log 摘录 |
|---|---|---|---|
| namespace-runtime | `pnpm test` 全量 + 定向 | ✓ Test Files 14 passed (14)，Tests 75 passed (75) | `✓ packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts (9 tests)` |
| doc-runtime | `pnpm test` 全量 + 定向 | ✓ Test Files 19 passed (19)，Tests 291 passed (291) | `✓ packages/doc-runtime/test/public-surface-guard.test.ts (3 tests)` |

**verdict**: ✅ all-vitest-packages-triggered（本地全量通道；CI 侧动态证据见 §7 说明）。

## 3. replaceSchema fatal 通道确定性补锚（SA6 移交 + SA4 §10 配方 + 设计 D9 末条）

新增冻结级测试文件 `packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts`（9 用例，全绿；**零新注 seam**——doc observer 与 seam compile 注入即达，SA2 认可的注入面）。逐路径断言结果：

### 路径 α（E201 + A3 撕裂态五要素）——✓ 绿

注入：`doc.on('update', …)` 一次性在事务提交后 `SCHEMA.delete('text')` → ⑤-S `verifySchemaFourKeys` 检出 size 偏离。实测断言全部成立：

- rejection 为 `RuntimeWriteFatalError`，**phase=`post-commit-verification`、committed=true**；message 含 `NSRT-WRITE-FATAL` / `SCHEMA write` / `phase=post-commit-verification` / `committed=true`；
- **best-effort notifyDirty 恰一次**（notifierCalls===1）；事务已 live commit（updates ≥ 1）；
- **撕裂态五要素逐项实证**：
  1. `getActiveSchema()?.id === 'ns-1'`（**永久旧 id**——installActive 未执行，后续亦无路径再切换）；
  2. `getSchemaEnvelope()?.id === 'ns-2b'` 且 `read(['n'])===999 / read(['a'])==='x'`（read/getSchemaEnvelope 观察**新** generation——读取以 live doc 为准）；SCHEMA 实际键集恰 `[id,lang,version]`、`getSchemaEnvelope()?.text===undefined`（doc 保持 observer 留下的实际状态，不回滚不补偿）；
  3. `rootWrite.enabled===false && schemaWrite.enabled===false`（双写位 false）；
  4. 后续 `mutateRoot` 与 `replaceSchema` 均 settle `{ok:false}` 含 `RUNTIME_WRITE_DISABLED`（**队列持续流转不挂死**）+ 零新事务（state 字节不变）+ 撕裂读面保持；
  5. `status.fatal.code === 'NSRT-FATAL-SCHEMA-WRITE-INTERNAL'`（显式标记、来源可判别、不静默冒充健康）+ `read.enabled===true`（永久禁写保读）。

### 路径 β（E203 observer-cleanup-throw）——✓ 绿

注入：`doc.on('update', () => { throw new Error('sa7-observer-boom') })` → `transactGuarded` 包装。实测：rejection **phase=`observer-cleanup-throw`、committed=true**；cause 零信息损失保留（`fatal.cause instanceof Error`）；事务已提交（updates===1、字节已变、live SCHEMA 四键新内容 `[id,lang,text,version]`）；best-effort notify 恰一次；撕裂（active 旧 ns-1 × live 新 ns-2b）；后续写 DISABLED；keep-root 分支 ROOT 未被触碰（read n===1）。

### 路径 γ（E204 pre-commit-internal，A4 红线）——✓ 绿

注入：seam `compile` 按 envelope.id 分发，对 ns-2b 返回 ok:true 但 derived 为手造环 ref（`structure.node=ref SA7CYC`、`aliases.SA7CYC=ref SA7CYC`——过 `assertCompiledShape` 后在 seam ①d `projectDeclaredRootKeys` 内 `makeRefResolver` 环守卫抛 `DerivedInvariantError`）。实测：**rejection phase=`pre-commit-internal`、committed=false**（A4 红线成立——**非** ok:false DOCRT-E200 降级）；cause 为原始 sentinel；0 update / 0 notifier / state 字节不变 / SCHEMA·ROOT·active tools 三不变；fatal 摘要 `NSRT-FATAL-SCHEMA-WRITE-INTERNAL` + 永久禁写保读。

### SA4 §10 配方覆盖对照

| SA4 §10 要求 | SA7 落点 | 结果 |
|---|---|---|
| α 三路径 + 撕裂五要素 + DISABLED 后续写 | §3 路径 α（五要素逐项 + mutateRoot/replaceSchema 双后续） | ✓ |
| β phase/committed/notifier 计数/字节观察 | §3 路径 β | ✓ |
| γ phase/committed/notifier 计数/字节不变 | §3 路径 γ | ✓ |
| 零新注 seam（doc observer + seam compile 注入） | 实现方式与设计 D9 末条一致 | ✓ |

## 4. SA2 §5 红线动态核验（独立动态确认，SA4 已静态+scratch 注入，本节为持久化测试面）

| 红线 | SA7 动态断言（新增测试文件内） | 结果 |
|---|---|---|
| A1 变体（多键 / text 非 string / version 非 number / 缺 text 键） | 注入 compile 畸形 ok:true 四变体 → 全部 `RuntimeWriteFatalError` rejection **phase=`schema-compile-throw`、committed=false**；0 update / 0 notifier / 字节不变 / active tools 仍 ns-1 / fatal 码 NSRT-FATAL-SCHEMA-WRITE-INTERNAL——**无一降级 ok:false** | ✓ 4/4 |
| A2 顶层剥离 | `ns-2b（声明 {a,n}）× root {n:999,a:'x',b:true}` → ok:true；**`read(['b'])===undefined`**；ROOT 实际键集恰 `['a','n']`；updates 1 + notifier 1 | ✓ |
| A2 嵌套未声明键 loud | `inner:{x,y}` → ok:false，issue message 明示未声明键 y；零写入五件套 | ✓ |
| A2 union 形 × 未声明键 loud | `type ROOT = {a:number}|{b:string}`（fixture 编译实测 node.kind=union）× root `{a:1,extra:2}` → ok:false（不投影、无静默剥离）；零写入 | ✓ |

## 5. AC9 时序实证（独立动态确认）

前项 `mutateRoot` 占槽且 notifier 挂住 → `replaceSchema` 排队窗口内三读面全部观察旧 committed generation：`getSchemaEnvelope()?.id==='ns-1'`、`getActiveSchema()?.id==='ns-1'`、`read(['n'])===2`（M 已提交的旧 generation 值）；sleep 25ms 余量后仍不变、完成序仍空（FIFO 屏障）。放行后 M→R 依序 settle，**transaction 后读面同步切换**：`getSchemaEnvelope()?.id==='ns-2b'`、`getActiveSchema()?.id==='ns-2b'`、`read(['n'])===42`。✓ 绿。

## 6. SA4 §12 动态审核重点逐条

| # | SA4 移交项 | SA7 处置 | 结果 |
|---|---|---|---|
| 1 | 补 replaceSchema fatal 通道确定性锚（α/β/γ + 撕裂五要素 + DISABLED 后续） | §3（新增测试文件 9 用例，全量仍全绿——文件落入最终 commit 范围待总控收口） | ✓ |
| 2 | CI 动态证据（Node 20/24 矩阵 Test 步骤摘录） | **属 push/PR 后阶段**——SA7 不 push 不建 PR（边界）；本地全量证据见 §2，CI 摘录移交总控 publish 阶段 | ⏳ 非阻断（见 §7） |
| 3 | P0→replaceSchema 恢复链真实 Persistence flush 时序 | persistence 文件第 2 用例独立复跑 exit 0（unavailable → replaceSchema 恢复 → mutateRoot → flush → 跨实例读回新 SCHEMA + 写入值） | ✓ |
| 4 | ⑥ verifySnapshotIntact 喂 narrowed × 嵌套 Y 载体对称性 | 新增动态确认用例：`ns-arr（a: string[]）× root {n:5,a:['x','y']}` → ok:true；**真实 `Y.Array` 载体安装**（instanceof 断言）；`read(['a'])` deep-equal `['x','y']`、`read(['a',0])==='x'`（严格整数段下钻）；ROOT identity 保持；updates 1 + notifier 1 | ✓ |

## 7. Spec 触发证据（verdict 升级段适用性说明）

本任务 SA1 design **无 `*.spec.ts`（E2E）改动**；SA4 静态自检与 SA7 本地动态均不触发 Step 3。CI Run 证据（Step 3/4 的 CI 侧摘录）在本次验证时点**不存在**——工作树尚未 push（SA7 职责边界禁 push/建 PR/宣称 CI 绿）。本地等价证据 = §1/§2 四闸口 + 定向 + 持久化复跑全绿；CI 动态摘录（Node 20/24 `Test` 步骤含三个 `runtime-replace-schema-*` 文件收集行）由总控在 publish/CI 观察阶段补录（SA4 §12 #2 同判）。

## 8. 边界与纪律自检

- **零 `src/` 修改**：`git status` 核对——SA7 仅新增 `packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts` 与本报告；SA3 的 12 个代码文件未动。
- **测试断言纪律**：新文件零源码 grep 断言（全部运行时行为锚：公共接缝观察 / update 计数 / state 字节 / notifier 计数 / Proxy 不适用处未用）；fixture 文本（union/nested/arr）已用真实 vfsl 编译预检（scratch 即用即删于 /tmp）。
- **未 commit / 未 push**：按任务边界留给总控统一收口（建议 commit 范围含新测试文件）。
- **后台独立进程**：全部测试命令 `setsid nohup … & disown`，日志/exit 落 `.mabf-bg/sa7-*`；未使用 `fuser -k`（本轮无端口型服务测试，全 vitest 进程型）。
- **并发 flake 处置**：首轮三进程并跑触发 vitest worker RPC 超时（SA3 已登记同型），串行复跑全绿后定谳为 Infrastructure flake，未掩盖任何用例失败（首轮亦无断言失败）。

## 9. 结论

**Verdict: pass。**

- 四闸口独立复跑全绿（全量 84 文件 1078 用例 + Type Errors 0；七包 tsc；聚合 tsc；定向 ns-14 文件 75 用例 / doc-19 文件 291 用例）；
- SA6 移交的 replaceSchema fatal 通道确定性锚已按 SA4 §10 配方补齐（新测试文件 9 用例全绿：α E201+撕裂五要素 / β E203 / γ E204 非 E200 / A1 四变体 / A2 三边界 / AC9 / ⑥ 嵌套载体）；
- SA2 §5 红线 A1/A2/A3/A4 动态核验全部成立；AC6/AC9 时序与单事务原子性经公共接缝实测复现；
- 真实 Persistence 集成（含 P0 unavailable 恢复全链）独立复跑通过；
- 未发现任何新 CRITICAL/HIGH/MEDIUM 问题；无环境阻塞（唯一 flake 已定谳并复现排除）。

# SA6 红灯契约报告 — Issue #151: Record trusted replication and management writes

> 阶段：Phase 1 acceptance anchoring（实现前初始契约；retry 1，fresh session）。
> 输入：任务简报 `wiki/raw/task_trusted-replication-management-diagnostic-change-log.md`、SA8 决策产物
> （`_relevant_decisions.md` / `_conflict_report.md`，verdict `clear`）、#149/#150 既有红灯契约先例。
> 角色声明：本报告只写测试、未改任何生产代码、未 push。

## 交付物

| 项 | 值 |
|---|---|
| 测试文件 | `packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts`（新增，913 行，15 用例） |
| 运行命令 | `pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts --reporter=verbose` |
| 运行方式 | `setsid nohup bash -c '...' & disown` 独立进程（skill 测试执行规范）；无端口依赖，未启用 test-lock 变更 |
| 运行结果 | **15/15 FAIL**（exit 1）；`Type Errors: no errors`；Duration 3.21s |

## 红灯证据（实测）

```
Test Files  1 failed (1)
      Tests  15 failed (15)
Type Errors  no errors

失败原因（15/15 全部相同一档）：
  → managementSurface(...).enableReplication is not a function   (11)
  → surface.enableReplication is not a function                  (4)
```

- 当前 worktree 基线（HEAD `722bddf`，branch `fix/issue-151-on-docs-namespace-diagnostic-change-log`，
  `pnpm install --frozen-lockfile` exit 0）：`NamespaceRuntime` **无**
  `enableReplication` / `bumpReplicationEpoch` 键，`NamespaceLease` **无**
  `openReplicationSession` —— Phase 5 复制业务层不在本工作树（SA8 冲突报告盘点注记 3：replication
  业务实现属其交付票，本 worktree 对 replication 仅命中诊断词表冻结面
  `packages/namespace-diagnostic-log/src/{schema,vocabulary}.ts`）。
- 因此每个用例在**首个操作调用处**以 TypeError 失败——红灯 = 目标操作面缺失，这是当前
  基线的诚实失败形态；**未为「记录级红」虚构任何永远 TypeError 的假路径**。SA3 落地
  （操作面 + 诊断发射）后，同一批用例自动转为「记录必须存在且分类正确」的断言红/绿
  （`waitAttempts` poll 超时改为失败、断言头失效）——测试文件本身零改动。

## 契约覆盖矩阵（AC → 用例）

| 验收标准 | 用例（it 标题缩写） | 断言锚点 |
|---|---|---|
| AC1 三条 operation + 受控 source/context | enable committed；bump；apply hub-to-peer；apply peer-to-hub | `replication-enable` / `replication-epoch-bump` / `replication-apply` 字面量；source `{kind:'local'}`（管理写）与 `{kind:'replication', direction:'hub-to-peer'\|'peer-to-hub', remoteInstanceId}`（apply）；context `{replicationId, replicationEpoch}`；observedAt=注入 Clock；attemptId `/^att-[0-9a-f]{32}$/` |
| AC2 阶段/码/committed 事实保留 | enable 输入拒绝；fence 后 apply（identity）；session closed；raw update 损坏；notifier 失败 fatal；getStatus 抛错 fatal | stage `validation`/`identity`/`acceptance`/`validation`/`dirty-notification`/`capability-gate`；既有稳定码 `REPLICATION_INPUT_INVALID`/`REPLICATION_EPOCH_CONFLICTED`/`REPLICATION_SESSION_CLOSED`/`REPLICATION_RAW_UPDATE_INVALID`/`NSRT-FATAL-REPLICATION-APPLY-INTERNAL`（设计裁决值，见修订记录）；fatal `committed:false`/`committed:true` 事实；业务 rejection 保留 phase/committed（`toMatchObject`） |
| AC3 owned bytes / noop / update-omitted | enable committed；bump；apply committed；apply noop；幂等重入 noop | committed `effect:'update'` + 基态链式重放（基态 → enable 增量 → apply 增量，§13.8 消费形态）见证精确 effect；`expectNoMaterializeWithoutBase` 真增量反向鉴别（防整文档编码冒充）；`effect:'noop'` 显式（零写入场景；update-omitted 为存储面分支，未在复制侧构造——payload 超限场景属 SA7 面） |
| AC4 日志故障隔离 | emitter 违约 throw；队列满 | 业务结果/顺序（enable→bump FIFO、META 事实）/identity 状态/`status.fatal===null`/handle ready 不变；emit 次数恰 2 且 throw 被吞没；`capacity:1` 下 accepted=1、droppedTotal=1 而业务面完整 |
| AC5 双向 + transport 隔离 | peer-to-hub；transport 隔离 | direction 双字面量精确；session open/getStatus/close 零 emission；日志仅含变更尝试（enable+apply 恰 2 条 emission，无任何 transport 事件记录） |

## 契约来源与「既有形状」选取

- 词表/阶段/result/source/context 全部取自冻结面（ADR-0011/0012 + `vocabulary.ts`/`record.ts`），
  零新增 operation/stage/reason；
- 复制业务**操作面形状**（`enableReplication({replicationId})`、`bumpReplicationEpoch()`、
  `lease.openReplicationSession({localRole, remoteInstanceId})`、`session.applyRemoteUpdate(update)`
  及上述稳定拒绝码/fatal 码）取自本仓既有 Phase 5 复制实现主线（`packages/namespace-runtime/src/
  replication-write.ts`、`replication-session.ts`、`packages/namespace-registry/src/lease.ts`，
  此实现不在本 worktree 基线、在主线仓库历史中）——作为 AC2「保留既有 stable phase/code/
  committed」的锚，**不是**本契约新发明的 API；
- 诊断 seam 沿用 #149 既有 `diagnosticEmitter` + `clock`（`createNamespaceRuntimeWithSeam`
  字段名即既有契约锚点）；
- apply 会话经真实 Registry 链（`createNamespaceRegistryForTesting` + `registry.create` →
  lease → session），测试 fixture 以 runtimeFactory 注入诊断 seam——与 #150 红灯契约同款装配；
- 无任何源码 grep/readFileSync 断言；全部为运行时行为断言（记录内容、Yjs 增量重放、业务
  返回值、session 状态、emitter 计数）。

## 依赖与风险注记（供 SA1/总控）

1. **复制业务层缺失**是本契约的基线事实（SA8 注记 3）：SA1 设计必须在设计中显式锚定所依赖
   的 replication seam 落点并记录依赖（简报「record any resulting limitation」纪律）；
2. 操作面形状若在 Phase 5 交付票合入时与主线不同，本契约按**合并后既有形状**修订（红线不变，
   形状字段按设计仲裁）——本报告已尽量选用主线既有字面名；
3. 两处语义映射按 ADR 词表裁决、建议 SA2/SA4 复核：stage `identity` 承载 epoch 拒绝（词表无
   独立 epoch 阶段）；session-closed 拒绝映射 stage `acceptance`（接纳期拒绝）且 `input.capture='not-accessed'`；
4. noop 触发方式 = 合法零新状态 Yjs update（`Y.encodeStateAsUpdate(new Y.Doc())`）：若 Phase 5
   既有 raw-update 验证面将其归类 `REPLICATION_RAW_UPDATE_INVALID`，noop 用例触发方式按既有
   语义调整（设计仲裁），AC3 noop 显式要求不变；
5. update-omitted 分支未在本契约构造（payload 超限/捕获禁用属存储面策略，SA7 动态面）；
6. 本测试文件新增未触碰任何既有测试与生产文件；`pnpm exec tsc -p tsconfig.typecheck.json`（CI
   等价）结果见下附验证命令。

## Verdict

**RED（真实红灯，可复现）**：15/15 FAIL，失败原因单一且诚实——基线不存在 #151 的目标操作面
（runtime 复制管理键、lease 复制会话键全部缺失），诊断发射层面（三条 operation 的语义 emission）
同样为零。测试全部锚定可观察运行时行为（record 内容 / Yjs 增量重放 / 业务结果 / session 状态 /
emitter 计数），无源码 grep、无 skip、无软兜底。SA3 实现（操作面落地 + 诊断接线，commit `218a74e`）
后，本契约 14/15 转绿；余 1 个红灯经 SA6 独立核验为**本契约 fixture 缺陷**（bump 重放链缺失，
见下节），最小修正后 **15/15 PASS**（`Test Files 1 passed / Tests 15 passed (15)`，exit 0；
`tsc -p tsconfig.typecheck.json`=0 errors）。

## 修订记录（设计裁决勘误，SA1/SA2 独立核验）

- **修订内容**：apply fatal 稳定码字面量 `NSRT-FATAL-REPLICATION-APPLY-WRITE-INTERNAL` →
  **`NSRT-FATAL-REPLICATION-APPLY-INTERNAL`**（测试文件 2 处断言 + 头部注释，本报告矩阵同步）。
- **裁决依据**：SA1/SA2 独立核验主线既有稳定码（`packages/namespace-runtime/src/errors.ts` 常量
  `FATAL_REPLICATION_APPLY_WRITE_INTERNAL_CODE = 'NSRT-FATAL-REPLICATION-APPLY-INTERNAL'`）——
  常量**名**含 WRITE（沿管理写 `FATAL_REPLICATION_WRITE_INTERNAL_CODE` 命名族），**值**不含
  WRITE（apply 专用码与 REPLICATION WRITE 管理写码区分）。SA6 初版按常量名误植了值；语义断言
  （stage/committed 事实/phase）与其余契约零改动。
- **复核**：修订后重跑红灯测试（见「验证命令与证据」），仍 15/15 FAIL（同一失败形态：
  操作面 TypeError），判定红未受修改影响——该码断言在基线处本就不可达（记录断言在操作面
  之后）；`tsc -p tsconfig.typecheck.json` 仍 0 errors。

## 修订记录（SA3 期间契约 fixture 勘误，SA6 最小修正 — replay chain）

- **背景**：SA3 实现落地（commit `218a74e`）后契约 14/15 绿灯；唯一红灯为
  `AC1/AC2/AC3 epoch bump committed` 用例 —— `AssertionError: expected undefined to be 2`
  （`fresh.getMap('META').get('replicationEpoch')` 为 undefined，测试文件第 520 行）。
- **独立核验（SA6 复跑确认，SA3 报告属实）**：失败位于该用例 committed-update 的重放断言。
  根因为 SA6 契约 fixture 错误：bump 事务增量**结构性依赖** enable 事务 pre-state
  （META 复制键 replicationId/replicationEpoch 由 enable 事务创建，bump 增量的 left origin
  引用其 struct）——用例以 `applyCarrier(rec.result, baseState)` 基态**单独**重放 bump 增量，
  未链入 enable 增量（与 apply 用例同款 prior 链缺失），META 键因此不物化。
- **修正（最小，仅测试文件重放链，断言零改动）**：bump 用例改为与 apply 用例同款链式重放
  `applyCarrier(bumpCarrier, baseState, [enableCarrier])`（prior = enable 记录的 committed
  update carrier，经既有 helper 的 prior 参）。单键语义断言原样保持：
  `META.replicationEpoch === 2`、`META.replicationId === REPLICATION_ID`（identity 保留）、
  context/operation/source/stage 断言不动、`expectNoMaterializeWithoutBase` 保留（bump 增量
  对空 doc 仍不物化——真增量鉴别不受影响）。
- **复验**：修正后 **15/15 PASS**（`Test Files 1 passed / Tests 15 passed (15)`，exit 0）；
  `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` = TSC_EXIT=0，0 errors。

## 验证命令与证据（复现）

```bash
cd /home/wangjian/nomicore-fix-issue-151
pnpm install --frozen-lockfile                 # exit 0（62 packages reused）
setsid nohup bash -c \
  'pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts --reporter=verbose; echo "EXIT=$?" > /tmp/sa6-151-exit' \
  > /tmp/sa6-151.log 2>&1 < /dev/null & disown
# 结果：Test Files 1 failed; Tests 15 failed (15); Type Errors no errors; EXIT=1
pnpm exec tsc -p tsconfig.typecheck.json --noEmit   # TSC_EXIT=0，0 errors（CI 等价测试文件类型检查）
```

# SA6 红灯报告 — Issue #140（Phase 5 收口：三实例收敛验收 + 管理动词缺口）

- **日期**：2026-08-30
- **基线**：HEAD `469ca36`（`Phase 5: deliver deployable Hub and Peer yjs-server app (#186)`）；dispatch（`task_issue-140-phase-5-websocket-replication_dispatch.md`）Phase 0 verdict = clear，本文件 = **Phase 1 acceptance anchor** 产出
- **工位**：`/home/wangjian/nomicore-fix-issue-140`（worktree，branch `fix/issue-140-on-docs-phase-5-websocket-replication`）
- **结论**：**红灯成立（3 failed / 3 passed，1 文件 6 用例）**。三个红灯 = Phase 5 管理动词验收缺口（`replace-schema` / `bump-epoch` / `reset-replica` 在 app stdin 控制面一律 `unknown-op`）；三个绿灯 = 已交付验收证据（AC1 双适配器三实例收敛 + AC6 FilePersistence crash recovery 回归锁）。未写任何生产代码、未 commit。

## 0. 范围与取舍（最小必要验收契约）

按总控「Phase 1 acceptance anchor：定义可执行集成验收契约」指令，对八条 AC 逐条落点：

| AC | 落点 | 状态@HEAD |
|---|---|---|
| AC1 并发 ROOT 写收敛 | **本文件绿灯锁 ①②**（hub+p1+p2 并发 `verify-write`，`count`/`tags` 三处收敛；Memory + File 双适配器、File 独立 rootDir） | ✅ 已交付（真实证据见 §2.2） |
| AC2 断连写 reconcile / absent-peer bootstrap / bootstrap-race | 既有绿：`ws-replication-ac3-bootstrap` + `ac4-reconcile` + `ac6-resync-close`（引擎）；`stdin-error-chain-red`（app 级 F1 断连写窗口）；黑盒探针：hub SIGKILL 硬崩溃 → peer backoff 重拨 → 停电窗口内写以足够 timeout 成功并收敛 42/42 | ✅ 已交付（非红灯；本项目不再重复锚） |
| AC3 lineage/epoch 冲突、protected-field、**hub schema 传播**、**epoch fencing**、**guarded reset**、archive | protected-field/epoch 冲突 = 既有绿（`ac7-faults`、`ac6-resync-close`）；**schema 传播 / epoch fencing / guarded reset = 本文件红灯锚 ①②③**（app 黑盒管理动词缺失 `unknown-op`） | 🔴 **验收缺口**（见 §2.3） |
| AC4 hub degraded 拒绝 / peer degraded 内存跟随 / retry persistence / 陈旧快照重启 / hub diff 恢复（双适配器） | 既有绿：`runtime-acceptance-degraded-two-adapter`（runtime 级双适配器）；黑盒探针 S8/probe8 证实 app 端到端：hub degraded 拒绝 + reauth 恢复收敛 3/3；peer degraded 内存跟随 + SIGKILL + 陈旧快照重启收敛 2/2（`bootstrap-imported`/`sync-diff-applied`） | ✅ 已交付（UI 面行为与已接受契约一致） |
| AC5 backpressure/frame/update/channel limits、dropped ACK、malformed、auth/authz/revocation、secret-free logs、graceful drain | 既有绿：`ws-replication-issue169-backpressure-accounting`、`issue171`、`sa7-*` 系列、`auth-lifecycle-red`（15/15 绿，revocation 已实现）、`observer-red`；app 级 `ordered-shutdown-red`（drain 序）、`stdin-error-chain-red`（malformed） | ✅ 已交付（channel 数上限不在冻结契约：设计 §11.4 记 evolution item，**不作红锚**——见设计 0010 L165 与 multiplex-backpressure 设计） |
| AC6 FilePersistence 独立 root + 进程重启 + archive/reset + crash recovery | 进程重启/crash 恢复 = 既有绿（`hub-restart-static-target-red`、`smoke-skeleton-red`、本文件绿灯锁 ③）；**archive/reset = 红灯锚 ③**（与 AC3 同一缺口） | 🔴/✅ 见左 |
| AC7 公共导出/稳定错误/文档一致性 | 非运行时；公共面既有绿（`ws-replication-api.test-d.ts`、`third-party-composition-red`、`public-surface-guard` 系列）；文档一致性属 SA3/SA4 域 | ⏳ 非 SA6 红锚域 |
| AC8 typecheck/全测/no-emit/Node matrix | CI 域 | ⏳ 非 SA6 红锚域 |

**取舍依据**：a) AC3 三缺口的根因是**同一实现缺口**——app 黑盒控制面只暴露自检动词（`status/shutdown/read/verify-write/add-target/remove-target/notify-auth-changed/request-reauth`，见 `apps/yjs-server/src/app.ts:444-470` 的 dispatch 表），hub 侧 `replaceSchema`/`bumpReplicationEpoch` 与 registry 侧 `resetReplica`（registry.ts）虽已交付于**嵌入宿主 API**，但被部署蓝本（hub-peer-deployment.md 动词表）与外层黑盒均无管理入口——Phase 5「black-box acceptance」无法通过黑盒到达，正属「定义可执行集成验收契约」缺口；b) registry 层 `resetReplica` 前置核对（`expectedLocalIdentity` 不匹配 → `NAMESPACE_RESET_IDENTITY_MISMATCH` 零破坏）已有 registry 级绿测，故本红灯锚只钉 **app 黑盒 reachability**，不重复 registry 语义；c) AC2/AC4/AC5 行为与已接受契约一致（引擎+app 级既有绿测 + 黑盒探针双证），不为伪红而重锚；d) 静态验证（AC7/AC8）不属 SA6。

## 1. 产出文件（测试专用）

```text
apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts   # 6 用例（3 红锚 + 3 绿锁）
```

- 全部黑盒：真实 spawn（`tsx apps/yjs-server/src/main.ts --config <json>`）、真实 WebSocket（hub `listen` 自由端口 + peer dial）、真实 Memory/File Persistence（FilePersistence 一律独立 rootDir）；断言只消费子进程 stdout NDJSON（事件/回执）与 stdin 控制回执，**零源码 grep / 零字符串形状断言**。
- 进程树纪律：spawn `detached: true`（进程组 leader），`afterEach` 以负 pid SIGKILL 连真实 app 子进程一并回收（tsx wrapper 与 app 是父子关系——SIGKILL wrapper 不会杀 app，会造成孤儿进程与 EAGAIN，首轮运行实测后已修）。

## 2. 红灯运行

### 2.1 命令（后台独立进程，按项目执行纪律）

```bash
npx vitest run apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts --no-typecheck
```

（`--no-typecheck`：app 测试为 `.test.ts`，不进 typecheck include；测试端口全部 ephemeral/自由，冲突防护照旧执行。）

### 2.2 真实结果（2026-08-30 实测，`Test Files 1 failed (1) | Tests 3 failed | 3 passed (6)`）

```text
   ✓ AC1（MemoryPersistence）：hub+p1+p2 并发 ROOT 写 → 三处收敛（独立 rootDir）  5886ms
   ✓ AC1（FilePersistence）：hub+p1+p2 并发 ROOT 写 → 三处收敛（独立 rootDir）  4675ms
   ✓ AC6（FilePersistence）：peer-2 崩溃（SIGKILL 真实 app pid）→ hub 期间写入 → 同 rootDir 重启 → 收敛  8531ms
   × AC3-①: hub 合法 SCHEMA 替换单向传播到双 peer（replace-schema 动词）
     → AssertionError: expected false to be true（replaced.ok === false）
   × AC3-②: hub bump-epoch → 双 peer channel 立即 identity-conflicted（epoch fencing）
     → AssertionError: expected false to be true（bumped.ok === false）
   × AC3-③: 受控 reset-replica —— 错误 expected identity 稳定拒绝零破坏；正确 identity 归档重引导后收敛
     → AssertionError: expected 'unknown-op' to be 'NAMESPACE_RESET_IDENTITY_MISMATCH'
```

### 2.3 失败根因（全部 = 同一实现缺口，非测试语法/基建错误）

| 用例 | 失败证据 | 红根因 |
|---|---|---|
| AC3-① | `expect(replaced.ok).toBe(true)` ← 回执 `{ok:false, code:'unknown-op'}` | `app.ts` dispatch 表无 `replace-schema` 分支（`app.ts:444-470` default → `unknown-op`）——hub 合法 SCHEMA 替换的黑盒管理面不存在 |
| AC3-② | `expect(bumped.ok).toBe(true)` ← 回执 `{ok:false, code:'unknown-op'}` | dispatch 表无 `bump-epoch`——epoch fencing（IDENTITY_CHANGED → 双 peer `identity-conflicted`）的黑盒触发面不存在 |
| AC3-③ | 回执 `{ok:false, code:'unknown-op'}` ≠ `NAMESPACE_RESET_IDENTITY_MISMATCH` | dispatch 表无 `reset-replica`——guarded reset（身份核对/归档/re-bootstrap 编排）的黑盒面不存在（对应设计已知边界「peer 侧 resetReplica 编排」） |

**对 SA1/SA3 的意图声明**：实现方向 = 在 `app.ts` 控制面新增三个管理动词（hub 侧 `replace-schema`/`bump-epoch`、peer 侧 `reset-replica`），各自接线已交付的底层能力（hub lease `replaceSchema`/`bumpReplicationEpoch`、registry `resetReplica` + peer `removeTarget`/`addTarget` 重开通道），并同步 `docs/integration/hub-peer-deployment.md` 动词表（AC7）。动词命名与回执稳定码以本文件断言为契约起点，SA1 设计/SA2 审查可调整（调整同时须修本文件断言）。

## 3. 边界声明

- 零 `packages/**`、零 `src/**` 生产代码改动；唯一新增 = 测试文件 + 本报告 + 任务简报 Phase-1 记录；`git status` 未见任何生产文件修改；未 commit。
- 未新增测试包/端口依赖（全部 ephemeral/自由端口）；本 repo 无 `scripts/test-lock.sh`。
- 一例 infra 警告（首轮运行 `spawn tsx EAGAIN` 与 AC3-③ 启动超时）已定位为**孤儿 app 进程堆积**（SIGKILL wrapper 不杀 app 子进程），以 `detached` 进程组回收修复；终轮运行零警告、零孤儿（`pgrep` 空）。
- 红灯原因 = 验收缺口（控制面无对应动词），非「测试写错但实现正确」；若实现后仍未绿属 SA3 问题，非 SA6 复现失败。
- 实现后不扩张：动态/压力/时序/互通/fuzz 属 SA7；若 SA4/SA7 指出本契约缺陷，按其指定最小范围修正 fixture 或断言。
- 端口/时序风险：AC3-② 断言 fenced 后 hub 写入「有界窗口不收敛」，若未来实现选择 fencing 前广播最后状态，该断言需 SA7 复核（帧序语义），已在注释中注明。

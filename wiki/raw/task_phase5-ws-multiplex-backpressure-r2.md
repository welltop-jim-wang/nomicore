# 任务简报（Revision Round 2）— issue #137 Phase 5: multiplex namespaces with bounded fair backpressure

## Task Type: Bug 修复（质量复审修订轮，5 个协议一致性缺陷 + 1 项测试覆盖缺口）

## 身份

- repository: welltop-jim-wang/nomicore（repositoryId: nomicore）
- issue: #137
- worktree: /home/wangjian/nomicore-fix-issue-137
- branch: fix/issue-137-on-docs-phase-5-websocket-replication
- run_id: issue-137-1787922674-8367
- round: 2

## 背景

Round 1 已完成本地 MABF 验收（REPORT.md status: complete，基线 6f2676f → 58150ad），PR #162 已 ci-passed。
质量复审在 PR #162 / issue #137 评论留下 **5 个待修复问题**，需更新同一 branch。
Round 1 任务档案：`wiki/raw/task_phase5-ws-multiplex-backpressure*.md`（简报/设计/SA2/SA4/SA7/AC 清单/双轴终审/dispatch log）。

## 必须处理的 review feedback（逐条全文，来自 issue #137 评论）

### R2-1（HIGH）超大 UPDATE 静默丢失且不触发 resync

- 位置：`packages/ws-replication/src/update-channel.ts:123-141,164-172`
- 现象：queued UPDATE 被取出后若编码结果超过 maxUpdateBytes，发送路径返回 0，但该项已被消费，且不设置 needsResync / 不声明 RESYNC_REQUIRED。
- 违反：`docs/protocols/instance-replication-v1.md:254-261,488`
- 建议：出队前校验合并结果；或发送失败时进入 resync；单笔 UPDATE 超限则按 UPDATE_TOO_LARGE 明确收口。

### R2-2（MEDIUM）sequence 耗尽路径发送重复序列号

- 位置：`packages/ws-replication/src/peer-connection.ts:477-494`、`packages/ws-replication/src/hub-connection.ts:411-432`
- 现象：sequence 已耗尽时仍用 0xffffffff 发送 ERROR，会重复已消费序列号。
- 违反：严格递增约束 `docs/protocols/instance-replication-v1.md:21-23,54`
- 建议：此时 framing 已不可信，按 §14 直接关闭连接，不再发送重复序列的 ERROR。

### R2-3（HIGH）queued limits 错误计入 in-flight UPDATE

- 位置：`packages/ws-replication/src/update-channel.ts:123-129`
- 现象：`overflows()` 将 inFlight.size 及所有 in-flight payload bytes 计入 queued count/bytes。
- 违反：AC2 要求 queued count/bytes 与 configurable in-flight window 分离；AC3 规定 overflow 只丢弃 unsent increments；协议 §17 分别列出 queue limits 与 maxInFlightUpdates（`docs/protocols/instance-replication-v1.md:479-488`）。
- 影响：合法满窗口会使第一笔未发送 UPDATE 提前溢出并触发不必要 resync。

### R2-4（MEDIUM）control-frame reserve 错用 lowWater，无独立额度

- 位置：`packages/ws-replication/src/backpressure.ts:74-82`；配置面 `packages/ws-replication/src/types.ts:18-29`、`packages/ws-replication/src/defaults.ts:16-27`
- 违反：AC5/协议 §17 要求 control frame 有独立保留额度（`docs/protocols/instance-replication-v1.md:490`），low-water 仅用于恢复 dequeue（`:492`）。
- 现象：以 `limits.lowWater` 作为 reserve ceiling，导致调整 transport hysteresis 时同时改变控制帧容量。
- 建议：增加独立且可验证的 control reserve 配置/语义。
- ⚠️ 注意：Round 1 设计 DENY LIST 原声明 types/defaults 零改动；本轮 review 明确要求改配置面，设计修订必须登记此 ALLOW 变更。

### R2-5（MEDIUM）AC7 缺持续对抗流量下 no-starvation / bounded-memory 测试

- 位置：`packages/ws-replication/test/ws-replication-issue137-ac1-ac7-red.test.ts:15-25,55-236`、`packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts:1-54`
- 要求：用 fake scheduler 增加持续生产测试，断言普通 namespace 在永久 hot namespace 竞争下最终获得发送机会，且对抗生产期间 queue/connection memory 始终有界。

## 验收标准（本轮）

1. R2-1 ~ R2-4 缺陷修复，每条有先行红灯测试锚定（复现 → 修复 → 转绿）。
2. R2-5 对抗流量测试补齐（若实现本已公平可直接转绿，但其缺失本身是缺口，必须落盘并通过）。
3. AC1–AC7 语义保持（round 1 既有测试套件零回归）。
4. ws-replication 全部测试通过、TypeScript 通过、git diff --check 通过。
5. 修复保持最小且与 `docs/protocols/instance-replication-v1.md` 一致；改动的包 bump patch 版本。
6. 禁止 push/PR/label 操作；REPORT.md 不 commit。

## 验证命令（项目既有）

- 后台：`npx vitest run packages/ws-replication`（ws-replication 套件）
- 后台：`npx tsc -p packages/ws-replication/tsconfig.json`（包级类型检查）
- 收尾：`pnpm typecheck`（全仓）、`git diff --check`

## 基线（round 2 启动时总控亲测）

- ws-replication vitest：14 文件 / 94 测试全绿（exit 0，.mabf-bg/ctl-r2-baseline-vitest.log）
- tsc：见 .mabf-bg/ctl-r2-baseline-tsc.exit

## SA6 红灯锚定（Phase 1 交付，2026-08-29）

- 产出：`packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts`（9 用例，
  R2-1×2 含直发路径 / R2-2×2 / R2-3×2 / R2-4×2 / R2-5×1）；详细报告
  `wiki/raw/task_phase5-ws-multiplex-backpressure-r2_sa6_red.md`。
- 红灯验证（`npx vitest run packages/ws-replication`，全包，修订后复跑）：
  `Test Files 1 failed | 14 passed (15)`、`Tests 8 failed | 95 passed (103)`、
  `VITEST_EXIT=1`（红灯期望）、Type Errors: no errors；`npx tsc -p packages/ws-replication/tsconfig.json` TSC_OK。
- 红灯清单（当前实现失败、修复后转绿）：
  - R2-1（队列路径）单笔 UPDATE 超 maxUpdateBytes 静默丢失——本地收到 hub blurb=seed / state=live / RESYNC=0；
    R2-1（直发路径，SA2 红线思路 #4 可选加固——已采纳）live+窗口空位+队列空+单笔超限直发 →
    RESYNC_REQUIRED ≥ 1 ∧ needs-resync（当前 state=live → 红）；
  - R2-2 (peer) / (hub) sequence 耗尽仍发 0xffffffff ERROR——发送序列第 7 帧重复前值 4294967295；
  - R2-3 (count) / (bytes) 合法满窗口 + 空队列 → 误溢出→needs-resync（期望 live）；
  - R2-4 (独立性) lowWater=512 时 3,000B control 流量应存活——当前早耗 → backoff；
    R2-4 (生效) controlReserveBytes=1500 应耗尽 1011——当前不耗尽（新字段未实现；
    首个失败断言即 1011，红因正确）。
- 直绿说明：R2-5（no-starvation / bounded-memory 持续对抗测试）在当前实现下即绿（RR 公平轮转
  已满足语义）——覆盖缺口落盘即修复（简报验收第 2 条字面授权）；断言为真行为（wire 帧数/收敛/
  状态/本地接受），非伪绿。
- SA6 冻结新契约字段：`controlReserveBytes`（control frame 独立保留额度，字节）；
  建议安全缺省 64*1024（与旧 lowWater 缺省一致，默认行为零漂移）；types.ts / defaults.ts /
  validate.ts 增补属 R2-4 ALLOW 变更域（见 r2_conflict_report / relevant_decisions 登记）。
- 既有套件零回归：14 文件（既有 94 测试）全绿。
- R2 修订（SA2 复审后置项，2026-08-29）：R2-4（生效）末段原守卫 `hub n === K` 被自身前置断言
  结构性否决（57B ACK ⇒ allowed=26 ⇒ 第 27 ACK 死亡 ⇒ hub n ∈ [27,35]）——按设计 §5.6 钉死
  形态改为区间守卫（`hub n ≥ allowed+1` ∧ `≤ allowed+1+maxInFlightUpdates` ∧ `peer n === K`）；
  另采纳可选加固新增 R2-1（直发）IT。修订后 9 用例复跑：8 红灯 + 1 直绿 + 既有 94 零回归。
- **终态（SA3 修复 34bbfba 落库 + 直发守卫修订后，2026-08-29）**：
  `npx vitest run packages/ws-replication` → **15 文件 / 103 测试全绿（VITEST_EXIT=0，
  日志 `.mabf-bg/sa6-r2-final-vitest.log`）**：8 红灯全部转绿 + R2-5 保持绿 + 既有 94 零回归；
  `npx tsc -p packages/ws-replication/tsconfig.json` TSC_OK；`git diff --check` 干净。
  SA6 守卫修订两处——R2-4（生效）区间守卫（§5.6 钉死）、R2-1（直发）删瞬时态快照断言
  （declareLocalResync → 恢复 round 在 settle 预算内完成 ⇒ 断言时刻恒 live）并增
  `settleUntil(hub 收敛)` 更强收敛分支——均为锚修正非软化（核心红灯信号 RESYNC_REQUIRED ≥ 1
  与收敛性保留并加强；SA3 四次复跑 + 10-tick trace 确定性一致）。
- 注意（移交 SA1/SA3）：既有 SA7 动态 D3a/D3c 以 lowWater 为保留额度锚，R2-4 修复将改写其语义，
  属设计修订/SA7 适配域，非本轮红灯回归。src/ 零改动（铁律，仅新增测试文件）。

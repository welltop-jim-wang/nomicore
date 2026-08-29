# SA3 实现记录 — Issue #172 Phase 5 权威契约收敛

**Date**: 2026-08-30（SA4 F1 修正：2026-08-31，窄域纯文档）
**Author**: SA3（TDD Executor）
**被审对象**: `wiki/raw/task_phase-5-websocket-replication-contracts_design.md`（R3，SA2 R3 = pass）
**Worktree**: `/home/wangjian/nomicore-fix-issue-172`（branch `fix/issue-172-on-docs-phase-5-websocket-replication`）

> **修订记录（SA4 reject → 窄域 F1 回流）**：SA4 静态验尸 verdict = reject（窄域
> F1 单一阻断簇）——SA3 对 T7/T8 缺口的归类失实（初版「Σ queued 与冻结文本兼容」
> 被 protocol §17 L492 明文否定——该行属**冻结语义偏差**）。本记录 §3.1/§3.2 归类句
> 已更正（标记「SA4 F1 更正」）；归类失实连带修复 = phase 文档「交付现状与边界」节
> 切片 6 行限定注记 + 已知偏差表新增「严格接纳 pipeline 判据」行 + 「验收锚」段登记
> R1-3 期望红灯锚（存在性可审计——N1 登记面闭合）+ 设计文档 EOF 空行剥除（N2）。
> 生产代码与测试断言零改动；修复后提交为独立 commit（纯文档/wiki 变更）。

---

## 1. 交付摘要

按设计 §3 完整实施允许范围，四条工作流（W-A 公共 API 收敛 / W-B 测试迁移与叙事 /
W-C 文档收敛 / W-D 延后锚可执行登记）全部落盘。G1 契约（A1-1/A1-2/A1-2b/A1-3）转绿；
8 条延后锚（A2-1/A2-2 → #169；A3-1 → #170；A4-1/A4-2/A5-1/A5-2/A5-5 → #171）以
`it.fails` 注册为期望红灯（断言体零改动）；锚集完整性 meta 守卫（D2-bis）到位。

**验证结果**：

- `pnpm typecheck`（12 包）——no errors。
- `pnpm test`（含 `--typecheck`）——**2041 passed / 2 failed**（两次失败均为
  `registry-phase5-replication-session-red.test.ts` 两个 degraded 用例的 **5s 超时**
  ——该文件本票零改动，单独运行 22/22 全绿（用例各约 3s，全量并行负载下超 5s 超时线；
  判定为负载抖动而非行为回归——见 §6）。
- `git diff --check`——通过。
- 设计 §5 三项 grep 门禁：① `controlReserveBytes` 全仓（排除 wiki）= 仅 ADR-0010 #172
  修订节 1 处历史记述（设计 C2 草案原文，见 §5 例外说明）；② `契约来源：wiki` /
  `设计基准：wiki` / `以 wiki/raw.*为准` = **零命中**；③ `保守上界|fail-safe`
  （docs/ + ws-replication src）= **零命中**。
- `it.fails` 双向翻转一次性实测（设计 §5 / SA2 #7）：(a) 现绿锁 A3-2 临时标 `it.fails`
  → anchors 文件 **红**（2 failed：A3-2 绿→记红 + meta 守卫计数失配 9≠8）；
  (b) 还原 → anchors **17/17 绿**（8 锚期望红全记绿 + 守卫绿）；(c) 全程零
  unhandled rejection。

---

## 2. 落盘清单（与设计 §7 ALLOW 逐项对照）

### W-A 生产代码（5 文件）
- `packages/ws-replication/src/types.ts` — L29 字段改名 `maxQueuedControlBytes` + 头注释
  去权威化 + 契约面注释改挂 protocol §17/§18。
- `packages/ws-replication/src/defaults.ts` — 缺省 `8 * 1024 * 1024` + 头注释改挂。
- `packages/ws-replication/src/validate.ts` — `validateLimits` 追加链式下界
  `maxQueuedControlBytes ≥ maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES(128)`（同步
  TypeError；构造期、resolve 合并之后——与 `pongTimeoutMs < pingIntervalMs` 同相位）。
- `packages/ws-replication/src/backpressure.ts` — L81 记账判据换读新字段 + D5 近似口径
  注释（净方向取决于冲刷进度，不声称保守上界）+ `BACKPRESSURE_POLL_INTERVAL_MS` 追加
  #169 偏差登记。
- `packages/ws-replication/src/index.ts` — 头注释改挂（导出集零变化）。

### W-C 续 去权威化 src（6 文件，仅注释）
`sreplication-session.ts`（ADR-0010 #134 修订节）、`doc-runtime/{extract,materialize,read,replace,carrier}.ts`
（ADR-0007/0008）。

### W-B 测试（12 文件）
- `harness.ts` / `ws-replication-api.test-d.ts` — 镜像与类型形状改名 + 8 MiB。
- `ws-replication-issue172-contract-anchors.test.ts` — A1-3 fixture 追加
  `maxBootstrapBytes: 1_024`；8 条延后锚 `it.fails` 注册 + 归口注释；文件末尾新增
  D2-bis meta 守卫（`DEFERRED_ANCHORS` 8 项 + 普通 `it` 计数/锚号正则 + `node:fs`）；
  头注释 G1 组「#172 已收敛」+ 三条 G1 标题去「RED：…（现为…）」括注。
- `ws-replication-issue137-r2-red.test.ts` — R2-4 两用例改名 + `maxBootstrapBytes: 1_024`
  追加（断言零改动）。
- `ws-replication-issue137-ac1-ac7-red.test.ts` — 头与 ★ 注释改回归锁表述。
- `ws-replication-sa7-issue137-dynamic.test.ts` — D3a/D3b/D3c 合法化重构（§3 详述）。
- `ws-replication-sa7-round2-dynamic.test.ts` — 恒真加固三处 + D4_LIMITS 改名（§3 修正）。
- `ws-replication-review-revisions-r1-r7-red.test.ts` — 恒真加固两处 + QUEUE_LIMITS 改名
  + R1-3 重分类（§3 修正）。
- `ws-replication-sa6-hardening-g1-g2-red.test.ts` / `g3-g4-red.test.ts` — 头叙事改为
  「已交付（回归锁）」（AC1–AC6 各条同步）。
- `ws-replication-ac4-reconcile.test.ts` — L71 恒真加固。
- `ws-replication-sa7-r2-transport.test.ts` — 两侧构造显式
  `limits: { maxBootstrapBytes: 1_024, maxQueuedControlBytes: 64_000 }` + 头注释 D4-bis
  改述（旧字段名注释清零——历史叙述保留为「#172 前缺省 64KiB 参照系」）。

### W-C 续 测试侧去权威化（14 处，仅注释）
11 测试头 + 2 helper + 1 test-d（§3.4 #10–#23 全数，ADR-0004/0007/0009/0010 挂靠）。

### W-C 文档（2 文件）
`docs/phases/phase-5-websocket-replication.md`（C1-a resetReplica supersede 注记 + C1-b
「交付现状与边界」节全文）、`docs/adr/0010-…md`（C2「issue #172 修订」节 append-only）。

### DENY LIST 零触碰
protocol / CONTEXT.md / replication-protocol/** / namespace-registry src / clock /
persistence / domains / tests/** / apps/** / ws-replication 行为面文件
（liveness/hub-connection/peer-connection/peer-namespace/hub-namespace/frame-io/
update-channel/round-engine/lifecycle-queue/fence-watchdog/testing）——零改动。

---

## 3. 设计实现偏差记录（反证门触发，3 处；均保留非恒真断言）

### 3.1 T7（sa7-round2-dynamic D2）：设计 P4「#8 pipeline 触发」假设失效——触发点实测为第 9 笔 handoff（Σ queued 判据）

- **设计假设**：pipeline（queued + buffered）≈66KiB > 64KiB 应在 #8 触发 shed →
  declareHubResync，故 RESYNC ≥ 1 / pendingData = 0 断言放在 #8 之后。
- **实测观测**（基线代码 + 本票代码均同——非回归）：`after#8: resyncs=0, pending=7`
  （#8 帧被滞回接纳——Σ queued 57.8KiB ≤ 64KiB 不触发）；`after#9/#10: resyncs=1,
  pending=0, needsResync=true`——当前实现只按 **Σ queued > maxQueuedBytesPerConnection**
  判据（`enforceConnectionCap`），pipeline 判据（queued+buffered）未接线；shed 在第 9 笔
  handoff（Σ queued 66.1KiB > 64KiB）触发。
- **处置**：RESYNC ≥ 1 / pendingData = 0 断言移至第 9/10 笔之后（与设计意图「触发面
  显影 + 幸存面清零」一致、非恒真），注释记录实测值与修正依据；文件头 D2 叙事同步。
- **归类（SA4 F1 更正）**：**冻结语义偏差**——protocol §17 L492 明文「总队列记账 =
  每 namespace 排队字节 + socket `bufferedAmount`（**连接级 pipeline**）」「严格接纳：
  拒纳 + 幸存面同批丢弃 + needs-resync 显影」；当前实现 `enforceConnectionCap` 仅
  Σ queued、暂停段入队无 pipeline 判据 = **与冻结文本不合**（SA3 初版记录的「Σ queued
  实现与冻结文本兼容」陈述已被 SA4 以协议原文否定——本行即更正记录）。同一缺口与
  3.2 同源：**缺口登记**——phase 文档已知偏差表新增「严格接纳 pipeline 判据」行 +
  R1-3 锚登记入验收锚段（存在性可审计）；修复路由待总控裁决（建议并入 #169 背压域
  扩 scope 或新立 issue）。

### 3.2 T8（r1-r7 R1-3）：幸存面组合场景未实现——以 it.fails 注册期望红灯（KNOWN GAP）

- **设计假设**：R1-3「拒纳 × 幸存面」与 R1-2（单帧拒纳，现绿）同族，L428 RESYNC ≥ 1
  应转绿。
- **实测观测**：阶段 4 触发帧被接纳（queued 7→8；Σ queued 58.1KiB ≤ 64KiB），
  RESYNC 声明 = 0、幸存面零丢弃、needsResync = false、状态 live（实测状态机投影）——
  当前实现只实现了单帧拒纳（R1-1/R1-2 现绿回归锁）；幸存面组合场景（B1 契约：
  pipeline 判据拒纳 + 幸存面同批丢弃 + 无条件 RESYNC）**未实现**。
- **处置**：L428/L442 加固断言**原样保留**（冻结契约语义、非恒真）；整个 R1-3 用例按
  设计 D2 的 it.fails 机制注册**期望红灯**（断言谓词零改动——it.fails 是注册转换）；
  用例上方与文件头 R1 条「现状」注释记载实测证据与归类（KNOWN GAP，非 #169/#170/#171
  验收锚）。修复落地转绿时套件会红 → 自动摘标。
- **归类（SA4 F1 更正）**：**冻结语义偏差**（§17 L492 连接级 pipeline 记账 + 严格接纳
  幸存面语义）——同 3.1 的缺口同一冻结文本依据；本票无修复授权（行为修复属严格接纳
  R1 修订域，未分配 issue），按设计反证门记录并上报总控裁决路由。**存在性登记**：
  phase 文档「验收锚」段已登记 R1-3 为 it.fails 期望红灯锚（文档面兜底——r1-r7 文件
  的 `.fails` 标记不受 anchors 文件 D2-bis 守卫覆盖，删锚零信号风险以该登记契约收缩）。

### 3.3 T6（sa7-issue137-dynamic D3b）：合法化场景的结构性后果 + allowed 算术微调

- **② 断言算术**：设计「wire0 UPDATE_ACK 计数 = allowed」——合法化场景下探针写 ACK
  占用第 1 额位，线上总数 = allowed（探针 + allowed−1 笔循环 ACK；第 allowed+1 笔触发、
  其 ACK 缺席）——断言改为总数 = allowed（含探针），写次数 = allowed+1 语义不变。
- **⑥ 断言**：设计「wire1 BOOTSTRAP_SNAPSHOT 恰 1 帧」在合法化场景**结构性不成立**——
  wire0 已交付 bootstrap（链式下界正面证明），peer 有本地副本 → 重连走 reconcile：
  实测 wire1 帧序 = [HELLO_ACK, OPEN_OK, SYNC_STEP1, SYNC_STEP2, SYNC_APPLIED]。
  ⑥ 改为「wire1 零第二 BOOTSTRAP + SYNC_STEP1 ≥ 1（round 开启）+ 大 blurb 收敛 +
  probe.events 空」——恢复段三谓词的合法化等价形。
- **校准事实**（D4 校准门实测）：C_live = 90_793B（≤ 92_128 ✓）、ACK 帧 = 57B、
  allowed = 23、触发后 wire 累计（除收口 ERROR）92_104B ≤ 92_128 ✓、bootstrap
  快照 ≤ 92_000（BOOTSTRAP_TOO_LARGE 未出现）✓——92_000 档一次性通过，无需升档。

---

## 4. D2-bis meta 守卫自检记录

- 读本文件自身（`new URL(import.meta.url)`）断言 `it.fails(` 计数 = 8 且每锚号
  `it.fails('<id> ` 在场。
- **三方向反腐烂验证**（设计 §1-D2-bis）：(a) 把 A3-2 改 `it.fails`（计数 9）→ 守卫红
  （连同 A3-2 绿→记红，套件 2 failed）✓；(b) 删除任一 it.fails 用例 → 计数失配红
  （由 (a) 的计数敏感性等价覆盖）✓；(c) 还原 → 全绿 ✓。
- 守卫正则与 message 无自匹配（`it\\.fails\\(` 转义 + message 无 `it.fails(` 裸文本）。

---

## 5. §5 门禁 ① 的唯一残留与例外说明

`git grep controlReserveBytes -- ':(exclude)wiki'` = 1 处命中：
`docs/adr/0010-…md:314`——设计 §3.3 C2 草案**原文**（SA2 R3 pass 的落盘文本）：
「PR #165 曾以 `controlReserveBytes`（64 KiB）落地，与本节及 protocol §17 不一致」。
这是 ADR **append-only 修订节内的历史记述**（记录旧名→新名的收敛事实——去掉旧名则该
记录失去所指），与门禁注释「设计/评审文档合法保留旧名历史记述」同类；非活契约/代码/
规范残留。**其余零命中**（含全部 src、测试、phase 文档）。

---

## 6. 全量套件两例超时的判读

`registry-phase5-replication-session-red.test.ts` 两用例（AC-5 peer degraded /
补锚 (a)）在首次全量跑 5s 超时；单独跑 22/22 全绿（两用例各 ≈2.8s/3.3s）。判定：
全量 176 文件并行负载下的超时抖动（该文件本票零改动——仅注释级去权威化；用例语义
与 ws-replication 零耦合）。提交前最终全量重跑结果见 §1（或补记于此节）。

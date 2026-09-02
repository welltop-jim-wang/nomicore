# SA4 静态验尸报告 — issue #137（单连接多 namespace 多路复用 + 有界公平背压）

**Date**: 2026-08-28（R1）/ 2026-08-29（R2 复审，§8）
**Verdict（R1，已被 R2 复审取代）**: reject（窄幅·恰一处 F1——update-channel.ts deliver 快速路径操作数顺序 TOCTOU → 超窗发射）
**Verdict（R2 复审，最新·最终）**: **pass** —— F1 修复（commit 8f9751e）按 R1 固定复验范围逐项核销：diff 恰一行互换（+4 行注释）且静力学正确；三件证据（vitest 77/77 / tsc / E5 复现转绿）SA4 **独立复跑**全部吻合（不复读 SA3 退出码）；固定范围及其直接影响面内零新阻断项。详见 §8。
**被审对象**: commit 6f2676f..9d4d0e2（11 文件，+1109/−82：src/backpressure.ts 新建 + frame-io/update-channel/peer-connection/hub-connection/peer-namespace/hub-namespace 修改 + package.json 0.1.0→0.1.1 + SA6 owned 测试三件随附）
**审查基准**: 设计 `..._design.md`（R3 版 715 行）、SA2 `..._sa2_review.md`（R3 pass + §8.4 移交锚）、`..._relevant_decisions.md`（D1–D11）、协议 `docs/protocols/instance-replication-v1.md` §10/§13.1/§14/§17、SA6 红灯契约（任务简报 §SA6）
**审查方法**: 全量源码阅读 + 四红灯走查独立重演 + 独立进程真实执行（vitest 77 IT / tsc / 定向复现脚本）+ 静态守卫锚 grep（SA2 §8.4 移交项逐条）

---

## 0. 执行证据（命令 + 结果）

| # | 命令 | 结果 |
|---|---|---|
| E1 | `pnpm exec vitest run packages/ws-replication --no-typecheck`（独立进程 setsid nohup，退出码落盘） | **Test Files 12 passed (12) / Tests 77 passed (77)，EXIT=0**——4 红灯全转绿 + 既有 73 IT 零回归（SA6 基线 73+4=77 吻合） |
| E2 | `pnpm exec tsc -p packages/ws-replication/tsconfig.json`（独立进程） | EXIT=0（类型面干净） |
| E3 | `git diff --check 6f2676f..9d4d0e2` | clean（零空白问题） |
| E4 | deny/blacklist 扫描（见 §2.1/§2.2） | deny-list 零命中 / blacklist 零命中 |
| E5 | F1 定向复现：`pnpm exec tsx /tmp/sa4-repro-overwindow.ts`（脚本在 /tmp，未触碰 worktree；复现逻辑全文见 §3.1） | `[2] 第三写后 peerToHub UPDATE 帧数 = 2（窗口=1）`、`[6] 近似在途 = 2 > maxInFlightUpdates=1 ← 超窗`、EXIT=2（复现成立；正确行为应为 1 帧） |

---

## 1. 立法门禁结论（skill 硬门禁逐项）

### 1.1 文件清单 Scope Creep Guard —— ✅ 通过（附 F2 文档债登记）

- ALLOW LIST（设计 §14，10 项）与 actual diff（11 文件）比对：**恰 1 项超出 ALLOW——`packages/ws-replication/package.json`**。
- 字段级核验：该文件 diff **仅 `version: 0.1.0 → 0.1.1` 一行**，无依赖/其他字段改动。
- 定性：MABF 硬门禁 #9「所有改过代码的模块必须 bump patch 版本号」的履行产物（src/ 六文件改码 ⇒ 必 bump）；总控任务简报明示该文件在审查范围（「11 文件：…package.json 0.1.0→0.1.1」）且重点审查锚 #5 要求核验 bump 落实。按 issue #79 SA4 先例（「实质性授权成立，不判 scope-creep」）——**不判 scope-creep**。
- **F2（LOW·文档债，非阻断，回流 SA1 备忘）**：设计 §14 ALLOW LIST 未按 doc-runtime R4 先例以字段粒度列明 `package.json`（「仅限 patch bump」）。任何后续设计修订应补列，避免下轮 SA4 重复争议。

### 1.2 设计偏离审查 —— ⚠️ 恰一处偏离（= F1，见 §3）；其余逐节一致

设计 §0 四件事、§3 分层、§4.2–§4.5、§5、§6.1–§6.4、§7–§8 逐条对照实现：架构/数据流/属主边界/状态机零改动/teardown 矩阵全部忠实落地（逐锚明细见 §4 重点锚核验表）。唯一偏离：§6.2 deliver 快速路径的实现求值顺序使 §4.1 直发条件「窗口有空位且闸门开」在**发送时刻**可不成立（静态+实证，§3）。

### 1.3 E2E spec runner 触发性 —— N/A

本任务 diff 无 `*.spec.ts` 文件（`git diff --name-only | grep -E '\.spec\.ts$'` 零命中）。

### 1.4 vitest 触发性自检（硬门禁 #14）—— ✅ 通过（本任务含 *.test.ts 变更，必检）

- 本任务新增 `*.test.ts`：`packages/ws-replication/test/ws-replication-issue137-ac1-ac7-red.test.ts`（4 IT）。所属 workspace package = `@nomicore/ws-replication`（`packages/ws-replication/package.json` name 字段）。
- CI 接通证据：`.github/workflows/ci.yml` 唯一 workflow，`test` job（node 20/24 矩阵）执行根 `pnpm test` = `vitest run --typecheck`；根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', ...]` —— `packages/ws-replication/test/*.test.ts` 落在 include 范围内；`Typecheck` step 的 `pnpm typecheck` 显式含 `tsc -p packages/ws-replication/tsconfig.json`。
- 结论：**新测试文件被 CI `test` job 的 vitest 命令直接覆盖，无「测试存在但从未被触发」黑洞**。SA7 动态验证仍须从 `gh run view --log` 摘录 vitest 触发证据（联动要求不变）。

### 1.5 协议假设审查（硬门禁 #15）—— ✅ 通过

- 设计 §12 章节在位，P-1~P-8 共 8 条，依据类型全部为「源码引用 / 现有测试引用」，无「应该/通常/预计」类无据推断。
- 本轮逐锚独立复核（不复读 SA2 §3）：P-1 `issue137-driver.ts:120-125` `Object.defineProperty` getter 属性形态 ✓（与实现 `readBufferedAmount` 鸭子读同构）；P-2 `namespace-registry/src/testing.ts:92-107` `advanceBy` 按 `at <= deadline` 到期序触发 ✓；P-3 `peer-connection.ts` `onClose`：仅 1002/1008 → `enterBlocked`，其余（含 1011）→ `onTemporaryFailure` ✓；P-4 `replication-protocol/src/errors.ts:27,108` `CONNECTION_BACKPRESSURE | retryable=yes | 1011` 条目在位 ✓；P-5 `harness.ts` `saveGates.shift()` 到达序消费 ✓；P-6 yjs 依赖在位（update-channel.ts 新增 `import * as Y`）✓；P-7 回声抑制既有锚（ac5-live）随 E1 全绿 ✓；P-8 `harness.ts` close 仅通知对端 listeners ✓。
- 无「声称实测但未贴输出」条目；全部引用可定位、可复跑。**无 protocol-assumption-mismatch**。

### 1.6 契约改动连锁审查（Caller Rippling）—— ✅ 通过

- 公共契约改动：**无**（types.ts/defaults.ts/validate.ts/index.ts 零触碰，E4；`index.ts` 不导出 backpressure —— grep 零命中，R0-4 ✓）。SA4 五类触发（return→throw / Promise 形态 / 同步变异步 / catch 重抛 / 可空性翻转）均不命中。
- 内部 seam 四项（设计 §13 表）逐项比对：
  1. `UpdateChannelHost` +`dataGateOpen`/`onDataQueued`/`requestDataDrain` —— peer-namespace/hub-namespace 两处 host 字面量均已补 ✓；
  2. `PeerNamespaceHost`/`HubChannelHost` +`sendData`/`dataGateOpen`/`onDataQueued`/`requestDataDrain` —— peer-connection/hub-connection 两处均已补 ✓；
  3. `OutboundQueue` −data 死代码 +`emit`/`onEmitted`、`drain` 收窄 control-only —— 删除符号（`flushQueued`/`dataQueues`/`nextDataNamespace`/`queuedDataCount`/`OutboundQueue.sendData`）全库 grep **零残留 caller**（仅注释提及）✓；`sendControl` 返回 lastSeq 语义不变 ✓；
  4. `flushQueued` 删除 → `pullAndSendOne`：原两处内部 caller（onAck/resetForLive）改 `requestDataDrain` ✓，外部 caller 零残留 ✓。
- throw 传播收口（SA2 §8.4 F7 静态守卫锚）：新链路 `drainData → pullAndSendOne → sendAndRegister → sendUpdateFrame → host.sendData → sender.tryEmitData → OutboundQueue.emit`——peer-namespace.ts / hub-namespace.ts `sendUpdateFrame` 的 try/catch **明确覆盖 `host.sendData` 调用**（`OutboundExhaustedError`/编码错 → 返回 0 → F4）✓；control 链路经 `sendChecked`（两侧）try/catch ✓。**任何异常不得穿越回调栈**的要求在两侧控制器均落实。

### 1.7 测试质量：源码 GREP 断言禁令 —— ✅ 通过

- 本任务三个测试文件（red.test.ts / issue137-driver.ts / harness.ts 增量）扫描：零 `readFileSync(<源码>) + toMatch/toContain` 反模式；全部断言为 wire 帧（`framesOf`/`frames` 解码后的 message.kind/namespaceId 序列）、状态投影（`getNamespaceState`/`connectionState`）、持久化值（`rootValue` 经 StubPersistence.peek）、时序门闩（saveGates/saveGate）——运行时行为断言。
- SA6 owned 三件与任务简报 §SA6 契约逐点吻合：4 用例名/断言形态（`<4` 帧、`[a,b,a,b,a,b]`、A needs-resync/B live/ready、fan-out 零帧 + `UPDATE_ACK ≥ 1`）、seam 形态（属性形态 bufferedAmount @ driver:120-125、saveGates 到达序 @ harness:403-408、空队列零影响）、既有 harness 行为零扰动。SA6 红灯描述的四锚在 E1 中全部转绿且 73 IT 零回归——**红灯契约未被弱化的行为学佐证**（断言逐条与简报红锚表一致）。
- 装饰性备注（F3·NOTE）：文件头/行内「当前实现…本断言红」措辞在转绿后已过时——SA6 owned 不改，不阻断。

---

## 2. 范围与红线核验

### 2.1 DENY LIST 零触碰 —— ✅

`git diff --name-only 6f2676f..9d4d0e2` 与 DENY LIST 交集为空：types.ts / defaults.ts / validate.ts / src/index.ts / round-engine.ts / fence-watchdog.ts / lifecycle-queue.ts / error-mapping.ts / src/testing.ts / replication-protocol 全包 / namespace-registry / namespace-runtime / doc-runtime / apps / docs —— **零命中**（E4）。R0-2 两级队列属主边界：backpressure.ts 只经 facet 读 ws-replication 自己的 UpdateChannel 队列，零 import/触碰 namespace-registry ✓（§11.2 依赖方向由结构保证：backpressure.ts 仅 import replication-protocol/frame-io/types）。

### 2.2 BLACKLIST —— ✅ 零命中（package-lock/yarn.lock/.DS_Store/TASK.md/*.bak）

### 2.3 版本 bump（硬门禁 #9 / 重点锚 5）—— ✅

`packages/ws-replication/package.json` `0.1.0 → 0.1.1`，diff 唯一改动行。

---

## 3. 发现清单

### F1（MAJOR·阻断·reject 唯一原因）deliver 快速路径操作数顺序 TOCTOU → 超窗发射（违反协议 §10.2 / 设计 §4.1 直发条件）

**位置**：`packages/ws-replication/src/update-channel.ts:70`

```ts
if (this.inFlight.size < this.host.limits.maxInFlightUpdates && this.host.dataGateOpen()) {
  this.sendAndRegister(bytes);
```

**机理（单线程重入推演，逐步）**：

1. `dataGateOpen()` 不是纯读——其 `observeWater()` 在「暂停段 ∧ level ≤ lowWater」时执行 `resume()`（backpressure.ts:184-190），而 resume **同步** `requestDrain() → drainData()`（§4.2「恢复即立即 drain」设计 sanctioned 的重入）；
2. drain 在 deliver 的条件求值**内部**消费窗口空位（pullAndSendOne 前置③每次重查窗口，drain 发帧至窗口满）；
3. `&&` 左操作数（窗口检查）先于右操作数（闸门检查）求值——重入 drain 结束后**不再复查窗口**，外层 `sendAndRegister(bytes)` 直发；
4. 结果：`inFlight.size = maxInFlightUpdates + 1`。发送时刻「窗口有空位 ∧ 闸门开」（设计 §4.1 直发条件）不成立——违反协议 §10.2「窗口满只暂停该 namespace 发送」的发送方义务；SA2 §5-F5 红灯思路明确以「无超窗 inFlight（经后续 ACK 数与帧数守恒断言）」为预期保证，本实现恰在该未布防的缝上失守。

**可复现证据（E5，确定性，全部用既有 SA6 seam，零 scheduler 推进）**：`/tmp/sa4-repro-overwindow.ts`（脚本全文已附于本报告同轮移交；逻辑：`maxInFlightUpdates:1` + withPressure → 置压 2×highWater → 写 n=11/12（窗口空但闸门关 → 入队 2 项，实测暂停段 0 帧 ✓）→ 悬挂 hub 首个 saveDoc（扣 ACK）→ 撤压至 lowWater/2 且**不推进 scheduler** → 写 n=13）：

```text
[1] 暂停段 UPDATE 帧数 = 0（期望 0）
[2] 第三写后 peerToHub UPDATE 帧数 = 2（窗口=1；正确行为应为 1）
[3] hubToPeer UPDATE_ACK 数 = 0（saveDoc 悬挂 → 合并帧 ACK 被扣）
[6] 近似在途（已发未 ACK）= 2 > maxInFlightUpdates=1 ? 是 ← 超窗
[7] 释放后 hub n = 13（数据最终收敛）
```

正确行为（操作数互换后静态推演）：resume+drain 在闸门检查内先完成（合并 n=11+12 一帧、inFlight=1=窗口满）→ 窗口检查 `1 < 1` 不成立 → n=13 **入队**等 ACK——第三写后恰 1 帧。

**影响评估（如实，不过度指控）**：有界 +1 帧/每次该交错（drain 自身尊重窗口，仅外层直发绕过复查）；无数据丢失（E5[7] hub 收敛）、无 wire 序列破裂（每帧独立sequenced/ACKed）、无饥饿；属发送方 pacing 不变量违约（§10.2/§6.2 前置③同族）+ §11.3 有界内存上界瞬时 +1 帧。触发条件生产可达：真实 WS adapter 的 bufferedAmount 降至 lowWater 后的下一笔本地写即触发（无需 scheduler/ poll 参与）。

**修复指令（回流 SA3·固定复验范围）**：`update-channel.ts` deliver live 分支操作数互换一行——

```ts
if (this.host.dataGateOpen() && this.inFlight.size < this.host.limits.maxInFlightUpdates) {
```

互换后闸门观察（含 resume→drain 重入）先完成，窗口检查读的是 drain 后真值；窗口检查与实际发送之间无任何发射点（仅大小门），TOCTOU 关闭。`pullAndSendOne` 无需改动（其唯一 caller 是 drainData，drain 期间 paused=false，resume 不可达，无同型重入）。**对既有 77 IT 行为中性**（既有用例的 resume 均由 poll timer `advanceBy` 触发，无一由 deliver 的闸门检查触发；无压力用例 dataGateOpen 无副作用）——SA3 修复后须复跑 E1（77/77）+ E5 复现脚本转绿形态（恰 1 帧）。SA4 复审仅验：该一行 diff + E1 + E5。

**测试债登记（不在本轮阻断项内）**：设计 DENY 冻结了非 SA6 三件的测试面，SA3 不得自行加守卫用例；F5 形态「超窗断言」建议随下轮设计修订交 SA6（红灯形态即 E5 场景：第三写后 `framesOf(UPDATE).length === 1` + ACK 守恒），本轮由 SA7 动态验证承接（§6-D1）。

### F2（LOW·文档债·非阻断，回流 SA1 备忘）设计 ALLOW LIST 未列 package.json

见 §1.1。字段级核验仅 version 一行；按 issue #79 SA4 先例不判 scope-creep。后续设计修订按 doc-runtime R4 先例以字段粒度补列（「仅限 patch bump；依赖与其他字段零改动」）。

### F3（NOTE·非阻断）红灯注释措辞过时

测试文件内「当前实现…本断言红」注释描述的是 #136 交付态，现已全绿。SA6 owned 不改；不阻断。

### F4（NOTE·非阻断·SA7 观察项）恢复窗口内 control 帧可能被同栈 drain 的 data 帧先行

`sender.sendControl` 的 `observeWater` 若触发 resume→drain，drain 的 data 帧先于该 control 帧上 wire（序列号按出队分配，纪律不破；control 未被阻塞——同栈同步发出）。协议 §17「control/error/ACK 高优先级」语义未被违反（优先级指不受 data 队列阻塞，非绝对先行），登记为 SA7 观察项即可，无需求改。

### F5（NOTE·非阻断）暂停段 control 帧双重编码

`sendControl` 暂停段先 `measureFrame`（探针编码）再实际编码——设计 §4.3「判据必须确定，估算不可接受」的必然代价；探针 `sequence:0` 与实际序列产生逐字节同长帧（envelope sequence 为固定 4 字节大端字段，且 `measureFrame` 与 `emitOne` 共用同一组 `maxFrameBytes`/`codecFieldLimits` 选项——frame-io.ts:160-166 与 backpressure.ts:268-274 比对一致）；AC-6b 绿测实证经过该路径（UPDATE_ACK 在暂停段经判据放行）。性能可忽略（§11.4）。

---

## 4. 重点审查锚核验表（总控指定 8 项）

| # | 锚 | 结论 | 证据 |
|---|---|---|---|
| 1 | 耗尽谓词恰为 `controlReserveUsed + frameBytes > lowWater` | ✅ | backpressure.ts:79 逐字吻合（且仅在 paused 段判定、触发帧**不发送**即 `return 0` 并收口、判定先于 `emitControl`）；无 `used ≥ reserve` 等异形（全文 grep 唯一判据）。记账侧 `onEmitted` 按实际编码字节累加且仅暂停段——探针长==实际长（见 F5），「发出后 used ≤ lowWater」不变量成立 |
| 2 | 合并账务核减口径 = 被取出各项入账字节数之和 | ✅ | takeItems 逐项 `queuedByteCount -= item.bytes.byteLength`（update-channel.ts:184,189）；合并产物实长仅两用：inFlight 登记（sendAndRegister(frame)）+ 贪心 `maxUpdateBytes` 上界判据；`queuedBytes` 恒可从队列重算（push/shift/discard 三处对称维护）；`overflows()` pendingBytes 两侧口径各自为真实占用——三套记账无 phantom 撕裂面 |
| 3 | pullAndSendOne 消费即进展（F4 丢弃也 true） | ✅ | update-channel.ts:160-169：前置五条任一不满足 → false 且不消费（①在 facet 层 `state==='live'` ✓ peer/hub-namespace sendFacet；②③④⑤在 channel）；消费（takeItems）后**无条件 return true**——F4（seq≤0）也 true，R3 方案 A 逐字落实 |
| 4 | connectionFatal 收口 ERROR 直发 outbound 绕过 ready 门（有意 delta） | ✅ | peer connectionFatal/failConnectionBackpressure → `this.emitControl(...)` 直发 outbound（绕过 `sendControl` 的 ready 门与 sender 额度判据），try/catch best-effort；hub connectionFatal 同（`this.outbound.sendControl` 直发）。豁免面恰 5 个终局调用点（peer connectionFatal/onSequenceExhausted[raw transport.send]/failConnectionBackpressure、hub connectionFatal/onSequenceExhausted[raw]）；重入守卫：failConnectionBackpressure 状态守卫 {stopped/backoff/blocked/draining}、enterBlocked 幂等、hub closedFlag——幂等不依赖 transport.closed ✓（I-4） |
| 5 | 版本号 bump（硬门禁 #9） | ✅ | 0.1.0→0.1.1，唯一改动行 |
| 6 | DENY LIST 零触碰 | ✅ | §2.1（E4 命令 + 零命中输出） |
| 7 | 硬门禁 #14 vitest 触发性自检 | ✅ | §1.4：根 `pnpm test`（`vitest run --typecheck`）include `packages/*/test/**/*.test.ts` 覆盖新测试文件；CI test job（node 20/24）+ typecheck step（含该包 tsconfig）双接通 |
| 8 | 硬门禁 #15 协议假设审查 | ✅ | §1.5：P-1~P-8 章节在位、依据全部源码/测试引用级、本轮逐锚复核属实 |

---

## 5. 标准验尸维度结论

1. **设计一致性**：⚠️ 恰一处偏离（F1——§6.2/§4.1 直发条件在发送时刻可不成立）；其余 §0 四件事/分层/属主/状态机零改动/teardown 矩阵逐节忠实。
2. **读写路径一致性**：✅ 无分叉。三套记账（overflows pendingBytes / facet.queuedBytes / inFlight bytes）口径自洽且互逆；wheel 与 facet 查询同一 controllers/channels map。
3. **静默失败**：✅ 无。额度耗尽 → ERROR + close(1011) + FSM 迁移（hub closed / peer backoff）响亮收口；F4 丢弃有 round diff 修复语义（协议 §10.1 sanctioned）；bufferedAmount 缺失 → 0 为契约行为（非伪降级，B-7 演进位登记保持）。
4. **降级方案**：✅ 安全。唯一类降级读（duck-typed 属性缺失→0）经 SA2 #11 定性为契约行为；无新降级路径。
5. **极端攻击**：❌ 发现一处可静态+实证确认漏洞（F1，处置：REJECT 回流 SA3）。其余极端面（lowWater=1 首控制帧即 1011 / cap<单笔 update round 抖动 / Σ==cap 无迟滞 churn）均为设计显式登记接受的行为（§4.3/§4.4/B-2/B-3），非遗漏。
6. **错误处理**：✅ 完整。emit 异常链（F7 锚）两侧 sendUpdateFrame try/catch 覆盖 host.sendData；收口路径 best-effort + 重入守卫；teardown 矩阵全覆盖（peer stop/enterBlocked/onTemporaryFailure/requestRebuild/scheduleDrainClose/failConnectionBackpressure/dialNow 换新；hub close/onTransportClosed/connectionFatal/onSequenceExhausted）。
7. **架构评估**：✅ 可行。无退回 SA1 信号（零 FIXME/零绕行/降级非唯一路径/未触无关模块）；D1–D11 零推翻。
8. **过度设计**：✅ 精简。backpressure.ts 275 行 vs 设计预估 ~220 行（注释占比高，逻辑量级吻合）；死代码按设计删除；无「为将来需求」的抽象层（R0-3 遵守：无 observer 接口、无第二种 transport 形态）。

---

## 6. 动态审核重点（交 SA7）

- **D1（F1 修复后回归锚·必测）**：E5 场景（maxInFlightUpdates=1 + withPressure + 暂停段积压 2 项 + saveGate 扣 ACK + 撤压不推进 scheduler + 第三写）→ 断言第三写后 `framesOf('peerToHub', UPDATE).length === 1` 且 ACK 守恒（窗口内至多 1 帧 unACKed）；并从 `gh run view --log` 摘录 vitest 触发证据（§1.4 联动）。
- **D2（SA2 §5-F2 锚）**：handshaking 期 peer fatal（坏帧注入）→ 恰 1 帧 connection ERROR + close + blocked——锁定 R2 新语义，防 SA3 回退成静默。
- **D3（SA2 §5-F3 配方）**：额度耗尽可达性——withPressure + `lowWater:1, highWater:2` → 置压 → 任一 control 帧 → CONNECTION_BACKPRESSURE ERROR + close(1011) + peer backoff（attempts≥1 非 blocked）+ 重连恢复；缺省 64KiB 配方（≈1600+ ACK 或单个 >64KiB Step2 首帧即触发）锁定谓词精确触发帧数。
- **D4（SA2 R2-N1 转绿守卫）**：超限项 + 合法小更新同队（maxUpdateBytes 配小 + 窗口 1 + saveGate 扣 ACK）→ 释放后合法项在预算内到达对端收敛（settleUntil）且超限项零 UPDATE wire 帧。
- **D5（SA2 §5-F6 锚）**：withPressure 置压进入暂停 → GOAWAY(SERVER_RESTARTING, drainTimeoutMs=0) → drain close → peer scheduler.pending() 恢复基线（无残留 poll timer）。
- **D6（B-7 反向风险·生产前）**：真实 WS adapter 须暴露 `bufferedAmount` number 属性——切片 7 自检演进位（本轮仅登记，非本任务验收面）。

---

## 7. Verdict 与回流

**Verdict: reject（窄幅·恰一处 F1）**

- **回流目标**：SA3（一处一行修复：`packages/ws-replication/src/update-channel.ts` deliver live 分支操作数互换；该文件在 ALLOW LIST 内）。
- **固定复验范围**：该一行 diff + 其直接影响面（同文件快速路径行为）——复验 = E1（vitest 77/77）+ E5 复现脚本（期望恰 1 帧）。SA4 复审仅验此范围；通过即改判 pass，不做范围外重审。
- F2（SA1 文档债）、F3/F4/F5（NOTE）随本轮一次性列全，均不阻断、无需本轮处置。
- 四红灯转绿 + 73 IT 零回归 + 类型干净 + DENY/blacklist 零触碰 + 门禁 #9/#14/#15 落实均已在 E1–E5 取证——修复 F1 后本实现即达可放行态。

> 边界重申：本报告为静态验尸 + 定向实证；SA7 动态验证独立进行，`pass` 不被本报告预支。

---

# §8. R2 复审（2026-08-29 追加；按 R1 §7 固定复验范围，对象 = commit 8f9751e）

> 复审范围（R1 钉死）：F1 一行 diff 正确性 + 其直接影响面（同文件 deliver 快速路径行为）+ 三件
> 证据真实性核验（vitest 77/77 / tsc / E5 复现转绿）。方法：SA4 独立复跑全部证据（不复读 SA3
> 落盘退出码）+ 修复 diff 逐行静力学复核；不做范围外重审（R1 §1–§6 结论不因一行互换重开）。

## 8.1 修复 diff 核验 —— ✅ 与 R1 修复指令逐字对应

- **范围隔离**：`git diff --name-only 9d4d0e2..8f9751e` = 恰 `packages/ws-replication/src/update-channel.ts`（1 文件，+5/−1，`git diff --check` clean）；`pullAndSendOne` 未改动（commit 仅 1 hunk）；工作树 `packages/` 零未提交改动。一次收敛纪律遵守：F2/F3/F4/F5 未触碰（该 commit 不含测试/wiki/package.json 变更）。
- **互换正确性（静力学）**：`if (this.host.dataGateOpen() && this.inFlight.size < this.host.limits.maxInFlightUpdates)` —— ①闸门观察（含暂停段撤压时 `observeWater → resume → 同步 drainData` 重入）在窗口检查**之前**完成，窗口检查读的是 drain 后真值（drain 填满窗口 → 走既有入队路径，不再直发）；②窗口检查与 `sendAndRegister → sendUpdateFrame`（仅大小门）之间无任何发射点，窗口/水位在该区间不可变，`tryEmitData` 内部复查必然与外层一致——TOCTOU 关闭，直发条件「窗口有空位 ∧ 闸门开」在**发送时刻**成立（协议 §10.2 / 设计 §4.1）。
- **次生效应评估（无新伤）**：互换后 `dataGateOpen` 在窗口满时也会被观察（旧顺序被 `&&` 短路跳过）——该观察点扩大与设计 D9「每次 data 发送尝试前」**更贴合**（窗口满时的 deliver 亦属发送尝试；水位越限 → 进入暂停段并武装 poll timer 是正确行为），非回归；闸门关/无压力路径求值结果与旧顺序等价（77/77 绿为行为中性实证）。
- commit message 对机理的转述（「pullAndSendOne 无需改动——唯一 caller 是 drainData，drain 期间 paused=false，resume 不可达」）与 R1 §3 论证一致，复核属实。

## 8.2 证据真实性核验（SA4 独立复跑，2026-08-29 00:31）—— ✅ 三件全部吻合

| # | 命令（独立进程 setsid nohup / 前台 timeout，退出码落盘） | SA4 独立复跑结果 | SA3 落盘（.mabf-bg/） | 一致性 |
|---|---|---|---|---|
| R2-E1 | `pnpm exec vitest run packages/ws-replication --no-typecheck` | **Test Files 12 passed (12) / Tests 77 passed (77)，EXIT=0** | sa3-r137-f1-vitest.exit=EXIT=0（00:29） | ✅ |
| R2-E2 | `pnpm exec tsc -p packages/ws-replication/tsconfig.json` | EXIT=0 | sa3-r137-f1-tsc.exit=EXIT=0 | ✅ |
| R2-E3 | `pnpm exec tsx /tmp/sa4-repro-overwindow.ts`（R1 E5 同一脚本，零改动） | `[1] 暂停段 0 帧` / `[2] 第三写后 UPDATE 帧数 = 1（原 bug 为 2）` / `[3] ACK=0（saveDoc 悬挂）` / `[6] 近似在途 = 1 > maxInFlightUpdates=1 ? 否` / `[7] 释放后 hub n=13 收敛`，**EXIT=0** | sa3-r137-f1-e5.exit=EXIT=0 | ✅ |

R2-E3 关键判别值逐项核对：第三写后**恰 1 帧**（合并 n=11+12；n=13 按修复后语义入队等 ACK——帧数判别与 R1 预言的正确形态一致）；在途 1 ≤ 窗口 1（超窗消除）；释放后 hub 收敛 n=13（**活性无损**——被入队的 n=13 经 ACK→drain 正常到达，排除「修复引入滞留」的反向风险）。

## 8.3 新阻断项扫描 —— 无

- 固定范围内：互换的静力学全部有利或中性（§8.1）；E5 转绿同时证伪「超窗」与「滞留」两个反向形态；77/77 排除既有用例行为漂移（含 AC-6a `[a,b,a,b,a,b]`、AC-2 合并 `<4` 帧、AC-5 shed 隔离、AC-6b control 保留——四红锚在 R2-E1 中随套件复绿）。
- 范围外（R1 已审结论，不重开）：DENY/blacklist 零触碰在修复 commit 复核一次（1 文件，非 DENY 面）；F2（SA1 文档债）/F3/F4/F5（NOTE）维持 R1 留痕处置，均非阻断。

## 8.4 R2 Verdict

**Verdict: pass（最终）**

- F1 按 R1 修复指令逐字落实（一行互换 + 机理注释），静力学正确、次生效应有利或中性；
- 三件证据 SA4 独立复跑全部吻合，E5 判别值与 R1 预言的正确形态逐项一致（1 帧 / 不超窗 / 收敛）；
- 固定复验范围及其直接影响面内零新阻断项；R1 非阻断项按一次收敛纪律留痕放行。
- **SA4 静态验尸闭环，路由 → SA7 动态验证**（§6 D1–D6 清单继续有效；D1 的断言形态已由本轮 E5 预演，SA7 仍须在 CI/动态环境复证并摘录 vitest 触发证据）。

> 边界重申（末次）：`pass` 仅表示 SA3 实现通过 SA4 静态验尸 + 定向实证；SA7 动态验证与 AC 逐条门禁独立进行，不受本裁决替代或预支。

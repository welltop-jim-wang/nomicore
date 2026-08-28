# Final Review — Standards 轴（issue #137 连接级有界公平背压）

- **审查对象**: `git diff 6f2676f..179495b`（worktree `/home/wangjian/nomicore-fix-issue-137`，branch `fix/issue-137-on-docs-phase-5-websocket-replication`）
- **轴职责**: 仓库工程约定 / 生命周期·防御式模式 / 测试要求 / 文档要求 / 可维护性。硬违规与非阻断判断分列。
- **审查方式**: 全量 diff 逐行读 + 改动后全文上下文复核 + 档案交叉核对 + 独立复跑（不复读 SA 退出码）。
- **独立性**: 本轴不与 Spec 轴交换上下文。

## Verdict: **blocking-findings**

恰 1 项阻断发现（B1：teardown 矩阵缺口——GOAWAY 分类 blocked 直达路径未 teardown ConnectionSender，poll timer 泄漏面与设计 §8 成文声称不符）。四条硬门禁全部通过；另登记 7 条非阻断判断（N1–N7）。

**最小修复建议（回流轮执行，非本轴动手）**: `peer-connection.ts:369-371` 的 GOAWAY `SERVER_SHUTTING_DOWN`/`REAUTH_REQUIRED` 分支在 `setState('blocked')` 前补 `this.sender?.teardown();`（一行，与 SA2 #6 姊妹路径同构），并补一条 D5 变体动态用例（暂停段 + GOAWAY(SERVER_SHUTTING_DOWN) → blocked → `scheduler.pending()` 回退核验）。同时把设计 §8 矩阵行（design.md:508/554）的「blocked」覆盖声称与该分支对齐。

---

## 一、硬门禁复核（全部通过）

| # | 门禁 | 判定 | 证据 |
|---|---|---|---|
| 1 | 禁止运行时 clamp 配置 | ✅ 通过 | diff 全量扫描零 `Math.min/max/floor` 配置钳制（仅测试侧 `Math.floor(100/ackBytes)` 期望值计算，`ws-replication-sa7-issue137-dynamic.test.ts:384`——非运行时）；`defaults.ts:46-49` `resolveLimits` 保持「显式字段整值替换、逐字段 clamp 是禁区（§15.1）」未被触碰；新增常量 `BACKPRESSURE_POLL_INTERVAL_MS`（`backpressure.ts:55`）/`DRAIN_TURN_LIMIT`（`backpressure.ts:58`）为冻结常量非配置 |
| 2 | 禁止 fallback 到系统 timer | ✅ 通过 | diff 新增行零裸 `setTimeout/setInterval`；全部 timer 经注入 `ReplicationTimer`：`backpressure.ts:194,208`（`host.timer`）、`update-channel.ts` armTimer/clearTimer 经 host 注入、`peer-connection.ts:380,586,620`（`options.timer`）、`hub-connection.ts:159`（`hub.timer`）——与协议 §17「无 drain event 时使用 Cordis Timer 调度检查，不使用原生 timer」（`docs/protocols/instance-replication-v1.md:492`）字面一致 |
| 3 | 测试禁止真实时间等待 | ✅ 通过 | 新增测试零 real sleep：fake scheduler `advanceBy` 步进（`ws-replication-issue137-ac1-ac7-red.test.ts:129,229`；`ws-replication-sa7-issue137-dynamic.test.ts:125-136,539,548`）+ 微任务预算 `settle/settleUntil` + 门闩（`saveGate`/`saveGates`/`deferred`）；`advanceUntilReady`（`ws-replication-sa7-issue137-dynamic.test.ts:125-136`）为确定性 fake-time 步进，注释注明饿死机理 |
| 4 | src/ 改动须有对应测试覆盖 | ✅ 通过（B1 修复后需补 D5 变体，见下） | 覆盖映射：`backpressure.ts` 水位闸门/恢复 poll → AC-6a/AC-6b（`ws-replication-issue137-ac1-ac7-red.test.ts:97,203`）；RR 公平 → AC-4 同用例（恢复段帧序恰 `[a,b,a,b,a,b]`，:138）；连接总压 shed → AC-5（:145）；保留额度耗尽 → D3a/b/c 三互补面（`ws-replication-sa7-issue137-dynamic.test.ts:249,313,354`）；`update-channel.ts` 合并取帧 → AC-2（:58）+ D4 活性（:425）；F1 闸门先行 → D1（:141）；handshaking fatal 直发 → D2（:200）；poll timer teardown → D5（:510，仅 SERVER_RESTARTING 分支——B1 缺口所在） |

独立复跑（本轴亲跑，非复读）：`tsc -p packages/ws-replication/tsconfig.json` exit 0；仓根 `vitest run` **167 文件 / 1964 测试全绿、typecheck 零错误**；`packages/ws-replication` 子集 **14 文件 / 93 测试全绿**（工作树与 179495b 代码同一，仅 dispatch.md 有在途编辑）。

## 二、阻断发现（hard/blocking）

### B1（阻断·生命周期/teardown 矩阵缺口）：GOAWAY 分类 blocked 直达路径未 teardown ConnectionSender

**发现**: `peer-connection.ts:364-374` `onGoaway` 对 `SERVER_SHUTTING_DOWN`/`REAUTH_REQUIRED` 走 `setState('blocked')` 直达（:370），**不经** `enterBlocked()`（:560-566——该处有 `sender?.teardown()`，:562），本分支无任何 sender teardown。

**泄漏机理（与同任务已修的 SA2 #6 完全同形）**: 若连接处于暂停段（poll timer 已武装，`backpressure.ts:192-204`），GOAWAY 分类帧到达 → blocked → 此后：
1. `onClose` 对 blocked 早退（`peer-connection.ts:497`），transport 被对端关闭也不触发清理；
2. poll fire：`tornDown=false`、`paused=true` → `readBufferedAmount() > lowWater` 即 `armPoll()` 重武装（`backpressure.ts:198-200`）——在 bufferedAmount 不归零的平台上（浏览器 WS 关闭后 bufferedAmount 保持非零；或测试式 stale getter）形成 **1s 周期无限重武装**，直至人工 `stop()`（:107 有 teardown）；
3. blocked 按协议语义是「等待配置/人工 start」的长寿命态（`docs/protocols/instance-replication-v1.md:436-437`），泄漏窗口不设上界。

**为什么够阻断**（而非 nit）：
- 设计 §8 teardown 矩阵成文声称覆盖「blocked」（`task_phase5-ws-multiplex-backpressure_design.md:508`）与风险表行 8「§8 teardown 矩阵覆盖 stop/blocked/backoff/rebuild/hub close/GOAWAY drain-close」（:554）——**实现未兑现成文声称**，doc/impl 失配；
- 本任务 R2 轮已把同形缺口（`scheduleDrainClose` 路径）定为必须修复项（SA2 #6，`sa2_review.md:123,302`；设计 R2 补行 :509）并已修——同一 handler 内相距 5 行的姊妹分类分支漏修，矩阵不完备；
- 可达路径：peer 出站暂停（bufferedAmount > highWater）与 hub 下发 SHUTTING_DOWN/REAUTH_REQUIRED 相互独立，负载+停机场景自然共现；
- 测试缺口：D5（`ws-replication-sa7-issue137-dynamic.test.ts:510-572`）仅锚定 SERVER_RESTARTING 分支；既有 G2（`ws-replication-sa7-dynamic.test.ts:217-224`）覆盖 blocked 分类但**无压力组合**，泄漏交互零断言。

**对照证据（矩阵其余项均完备，证明缺口恰此一处）**: peer 侧 stop（:107）/ dialNow 换新前旧 sender（:194-196）/ GOAWAY drain-close（:386）/ failConnectionBackpressure（:556）/ enterBlocked（:562）/ onTemporaryFailure backoff（:575）/ requestRebuild（:599）全部 teardown 在位；hub 侧 close（`hub-connection.ts:172`）/ onTransportClosed（:354）/ connectionFatal（:367）/ onSequenceExhausted（:415）四路全覆盖。

## 三、非阻断判断（nits / 登记备查，不阻塞合并）

| # | 级别 | 发现 | 证据 |
|---|---|---|---|
| N1 | nit | peer host 适配 `dataGateOpen: () => this.sender?.dataGateOpen() ?? true`（`peer-connection.ts:81`）：无连接期静默默认开闸。结构性不可达（控制器 live 蕴含连接 ready；下游 ready 门 :433 收口），非运行时配置 fallback，不违门禁；但缺一行「未拨号期读值无意义」注释，与 hub 侧恒有 sender 的不对称（`hub-connection.ts:154`）宜成文 | 同上 |
| N2 | nit | `hub-connection.ts:132` OutboundQueue 构造回调 `(info) => this.sender.onEmitted(info)` 引用 :134 才赋值的 `this.sender`——正确性依赖「OutboundQueue 构造期零回调」事实（当前成立），建议一行注释固化该前提 | `hub-connection.ts:126-143` |
| N3 | nit | 注释口径微差：`backpressure.ts:6` 头注「缺失/非 number 属性 → 0」窄于实现（另含 NaN/Infinity → 0，`Number.isFinite` 守卫）；`peer-connection.ts:324-326` 注释反而准确（「缺失/非 number/非有限数」）。实现更严是安全的，建议头注对齐 | `backpressure.ts:5-6` vs `peer-connection.ts:331-335`、`hub-connection.ts:401-408` |
| N4 | nit | 测试卫生：`gates[0] as unknown as import('./harness.js').Deferred` 双重断言冗余——`holdHubSaveDocs()` 已声明返回 `Deferred[]`（`issue137-driver.ts:76,214-217`） | `ws-replication-issue137-ac1-ac7-red.test.ts:161-162` |
| N5 | 备查 | 版本 0.1.0→0.1.1 为 patch 递增（`package.json:3`）；feature 语义下 semver 宜 minor，但包 `private: true` 且仓内无成文版本约定，前例（#136 建仓 0.1.0）无冲突——登记备查 | `packages/ws-replication/package.json` |
| N6 | 备查（diff 外） | `update-channel.ts:256-257` `UpdateChannelControl` 哨兵 re-export 全仓零消费方——#136 遗留、非本 diff 引入，仅登记 | `update-channel.ts:256-257` |
| N7 | 备查 | `wiki/raw/task_phase5-ws-multiplex-backpressure_dispatch.md` 存在工作树未提交改动（step 16 完成 + step 17 双轴终审 pending 登记）——属在途日志，预期随终审产物一并入库；179495b 内档案本体齐备（见 §四） | `git status` 实测 |

## 四、各维度通过项明细

### 1. 仓库工程约定（通过）
- **TS 风格一致**: `.js` ESM 后缀 import、`unknown | undefined` timer handle、`Object.freeze` 常量、non-null 断言（`backpressure.ts:143`、`update-channel.ts:182,185`）与 frame-io/round-engine 等既有文件同构；`tsc` 严格模式零错误（本轴复跑）。
- **命名/注释质量**: 新模块头注完整交代四件事与属主边界（`backpressure.ts:1-19`）；F1/SA2 修复点位全部带出处注释（`update-channel.ts:70-73`、`peer-connection.ts:383-385,491-495`）；`queuedByteCount` 改名避让 getter 冲突，语义清晰。
- **零 console/敏感信息日志**: src 与新增测试全量扫描零 `console.`/`process.env`。
- **缺依赖响亮失败**: 无静默配置兜底；`readBufferedAmount` 的「缺失 → 0=无压力」为设计 §4.2 钉死的鸭子类型 seam 契约（成文于 `peer-connection.ts:324-326`/`hub-connection.ts:401` 与测试头注 `ws-replication-issue137-ac1-ac7-red.test.ts:35-38`），并经既有套件结构性零回归实证（93/93 绿），非擅自 fallback。
- **依赖方向**: `backpressure.ts` 仅 import replication-protocol/frame-io/types（:20-22），零 Runtime/Lease/Registry 依赖——「不进 Runtime sequencer」由依赖方向保证（:15-18），与本轴复核一致。

### 2. 生命周期/防御式模式（B1 之外通过）
- teardown 幂等（`backpressure.ts:124-131` 重复调用无副作用；`clearPoll` undefined 守卫 :206-210）；stale fire 零副作用且不重武装（:196）。
- 重入为设计内决策并经 D1 动态锚定：`drainData` 同步重入路径（resume→requestDrain→drainData）由 `paused`/`isEmitAllowed` 帧间复查（:158）与 visited 上界收口，cursor 越界经 `facetOf(undefined)→undefined` 良性吸收——无崩溃面。
- 异常传播收口完备：`connectionFatal`/`failConnectionBackpressure` best-effort ERROR 均 try/catch（`peer-connection.ts:516-521,547-551`；`hub-connection.ts:368-375`）；emit 回调异常双侧收敛返回 0 → F4（`peer-namespace.ts:748-756`、`hub-namespace.ts:657-667`，带 SA2 #7 出处注释）。
- 幂等收口：`declareLocalResync`/`declareHubResync` 经 `resyncDeclared` 守卫（`peer-namespace.ts:697-707`、`hub-namespace.ts:640-649`），shed 重复触发零重复 RESYNC 帧。
- `enforceConnectionCap` 终止性：每轮要么返回要么整队 shed + wheel 移除（`backpressure.ts:214-229`），wheel 单调缩 → 必终止；`pickVictim` 并列取 wheel 序先者（确定性，:231-243）。
- `failConnectionBackpressure` 重入守卫覆盖 stopped/backoff/blocked/draining（`peer-connection.ts:536-558`），收口路径零递归。

### 3. 测试要求（通过）
- 零 `.only/.skip/.todo`；断言全部为 wire 帧/状态投影/持久化值/scheduler 计面，零源码 grep/fs 访问（扫描实测）。
- 确定性：真实 yjs/Registry/Runtime 双实例 + fake-duplex 内存双端 + fake scheduler + 门闩（`saveGates` 顺序门闩为纯新增，`harness.ts:338-341,403-408`），无竞态等待。
- 既有套件零削弱：diff 内 test/ 仅 4 文件、**1190 行纯新增零删除**（4 条 `-` 行均为 diff 文件头）；harness 改动为可选门闩队列，空队列零行为变化（注释成文 :403-405）；既有 11 个 IT 文件逐字节未动。

### 4. 文档要求（通过）
- wiki/raw/ 任务档案齐备且随代码入库（commit 179495b）：简报（`task_phase5-ws-multiplex-backpressure.md`，146 行）、SA8 冲突报告（`_conflict_report.md`，verdict clear）、SA1 设计（`_design.md`，715 行）、SA2 设计复审（`_sa2_review.md`，R3 最终 pass，:415）、SA4 静态验尸（`_sa4_review.md`，R2 最终 pass）、SA7 动态验证（`_sa7_report.md`，pass + D1–D5 + 2 条非阻断登记）、AC 逐条门禁清单（`_ac_checklist.md`，AC-1~7 全 ✅）、dispatch log（`_dispatch.md`）、决策摘要（`_relevant_decisions.md`）。
- 档案链路与代码互证一致（设计 §8/§4.3/§5 条款与实现逐点对应；唯 §8「blocked」覆盖声称与 B1 失配——见阻断项）。

### 5. 可维护性（通过）
- **死代码删除彻底**: frame-io `dataQueues/dataOrder/dataCursor/sendData/queuedDataCount/nextDataNamespace` 全移除（`frame-io.ts` diff -59 行），全仓零残留引用（grep 实测，`flushQueued` 仅存于历史指涉注释）；`OutboundQueue.drain` 收窄为 control-only 且注释成文（:109）。
- **新模块边界清晰**: backpressure.ts 单职责（连接级调度），`DataSenderFacet`/`ConnectionSenderHost` 双接口隔离连接层与通道层（:25-52）；index.ts 冻结契约面未扩张（内部模块不公出）——与 SA6 冻结契约注释一致。
- **注释与语义一致性**: 除 N3 微差外，§4.x/§6.x/§10.x 引用与实现逐点吻合（本轴抽样 12 处交叉核对）。

---

## 附：审查留痕

- 复跑环境：worktree HEAD=179495b（+dispatch.md 在途编辑，不影响代码）；Node/pnpm 仓内固定工具链。
- 命令留痕：`tsc -p packages/ws-replication/tsconfig.json`（exit 0）；`vitest run`（167/1964 全绿，66.6s）；`vitest run packages/ws-replication`（14/93 全绿）；diff 全量模式扫描（timer/console/clamp/only-skip/fs 访问）。
- 本轴未修改任何代码/测试文件；未执行 push/PR。

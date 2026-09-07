# 独立实现审查 — issue #239（SA4 implementation review）

> 阶段：implementation review（SA4）。审查对象：当前 worktree 全部未提交改动
> （10 个修改文件 + 2 个新增测试文件 + wiki 证据）。前置输入全读：任务简报、SA1 设计、
> SA2 attack review（approve）、SA3 实现证据、SA6 红灯契约（ac_red.md + 两 log + 冻结
> 测试文件）、SA8 conflict report（clear）+ relevant_decisions。
> Issue comments 亲自复核（`gh issue view 239 --json comments`）：**0 条，无额外 Owner 要求**。
> 方法：不轻信 SA1/SA2/SA3 的行号与结论，全部对照源码/协议文档/依赖源码独立复核，
> 并亲跑触发性测试（见 §5）。

## Verdict

**`approve`**（`requiresConflictRecheck=false`）——零阻断缺陷。4 项非阻断观察见 §8。

## 1. 改动面完备性（独立清点）

- `git status`：修改 `docs/protocols/instance-replication-v1.md`、
  `packages/ws-replication/src/{types,observer,round-engine,peer-namespace,hub-namespace,testing}.ts`、
  `test/{driver,ws-replication-api.test-d,ws-replication-observer-red}.ts*`；未提交新增
  `test/ws-replication-issue239-{ac-red,repro}.test.ts`。与 SA3 交付清单逐项一致，无第 12 个文件。
- 发射点 grep（src 全量）：`sync-step2-sent`/`sync-diff-applied` 恰 4 处
  （hub-namespace L147/L932、peer-namespace L160/L1119）+ types.ts 联合两成员——A10 复核成立。
- 事件型数：types.ts `readonly type: '` 计数 = **20**；协议 §23.1 标题「20 型」、
  ALLOWED_KEYS 20 行、api.test-d「20 型」断言三处互证——事件型数不变。
- `testing.ts` 仅经 `./testing` 子路径导出（package.json exports 既有条目），`src/index.ts`
  零新增导出——D4「不进生产 API」落实。

## 2. 攻击面一：wire bytes 与 §9.4/§16 状态机不变性 — 通过

- **零 wire 改动**：diff 不触碰 `@nomicore/replication-protocol`、帧构造、发送路径。
  round-engine 仅三处参数化（`RoundHost.applyStep2` 接口签名、`onStep2` 传
  `message.syncRoundId`、`applyStep2Safely` 透传）；实读 L141-160 确认 `onStep2` 在
  L147-153 违例矩阵（含 `syncRoundId !== currentRound` 检查）**之后**才调用，
  `sendStep2`（L184-194）帧构造一字未动；`checkSettled`/`resetState`/`teardown` 不动。
- **状态机守护**：peer/hub 改动全部位于既有 `observerOn` 门控分支与 apply 结算续体的
  事件构造；`session.applyRemoteUpdate(update)` 调用、`pendingApplies`、SYNC_APPLIED
  发送（peer L1016-1026 / hub L844-855）、`degradedBypassActive()` 判别、UPDATE_ACK
  路径零变化。V4 回归（periodic-reconcile/ac4/ac5/issue231）+ 冻结契约守护断言
  （回 live、roundId 单调 +1）亲跑全绿（§5）。
- **无 observer 热路径**：before 捕获门控 `isStep2 && this.observerOn`（peer L1060 /
  hub L886）；after 捕获在 `if (this.observerOn)` 块内且以 `svBefore !== undefined`
  短路——无 observer ⇒ 零捕获、零 digest、零事件字段构造；T8 三运行基线（无 observer/
  良性/每事件必 throw wire 与文档内容全等）亲跑绿——§23.4「逐字节等价」保持。
- UPDATE 热路径（`isStep2=false`）：svBefore 恒 undefined ⇒ after/派生全短路，零新增读取。

## 3. 攻击面二：safe-digest 注册 / observer gating / syncRoundId 代际边界 — 通过

- **safe-digest（D4/§23.3）**：注册文本（协议 L689-699）与实现
  （observer.ts `stateVectorSafeDigest`）逐参数一致：双泳道 FNV-1a-32（正序+逆序）、
  offset basis 2166136261、prime 16777619、模 2³²（`Math.imul(h^b,16777619)>>>0`）、
  16 位小写零填充 hex。**算法基准向量独立复算**（评审者以两套独立实现——`Math.imul`
  与 BigInt 模乘——重算）：空输入 `811c9dc5811c9dc5`、`[0,0]` `117697cd117697cd`、
  0..9 `2f8540720825a114`，与 T2 单元块 hardcode 期望**全部一致**（双实现互证排除实现
  自证）。注册即冻结 + 演进走另增字段的文案在 §23.3 落实；raw SV 字节仍属禁止项
  （digest 为派生定长字符串），深扫断言把守。
- **observer gating（D3/§23.4）**：before 捕获位于帧分发同步段（t0 采样同点、
  `session.applyRemoteUpdate` 入队前）；after 捕获位于结算续体（事件发射同点，同
  `session` 局部引用）；两处均经 `session.encodeStateVector()`——实读
  `packages/namespace-runtime/src/replication-session.ts`：同步读面、终态同步 throw
  `ReplicationSessionClosedError` ⇒ 折叠路径真实存在。`safeStateVector` try/catch →
  undefined（`safeNow` L125-131 同款先例）；效果字段组**单命运**：`effect` 对象整组
  构造、整组 spread（`...(effect !== undefined ? effect : {})`）或整组缺——peer/hub
  两侧同构；`exactOptionalPropertyTypes: true`（tsconfig.base.json L10）下条件 spread
  不写显式 undefined，包 tsc exit 0。peer degraded 分支：效果组计算后不附着
  （`degraded-bypass-applied` 键集不变，互斥规则保持），成本上界已在代码注释与设计 D3
  声明。throw 隔离：`dispatchReplicationObserver` try/catch 单点不变（observer.ts L34-42）。
- **syncRoundId（D2/§21）**：sent 侧取帧内 `message.syncRoundId`（`sendStep2` 既有
  wire 字段 = `currentRound`）；applied 侧经 `RoundHost.applyStep2` 第三参显式透传，
  调用前 `onStep2` 已校验 `=== currentRound`（L149）。`applyRemoteUpdate(..., true, ...)`
  全仓恰两处（peer L1016 / hub L844，各自 `applyStep2` 内）——`syncRoundId!` 非空断言
  来源封闭；UPDATE 路径（peer L558 / hub L607）isStep2 缺省 false 零投影。接线 lambda
  （peer L185-186 / hub L173-174）第三参已同步（SA2 观察 1 落实）。零新增长生命周期
  状态——字段均为发射时刻投影，§21「进程重启丢弃」与 §23.1 注记「跨重启关联不存在」
  一致；§23.6 禁入默认 metric label 落实（协议 L755）。

## 4. 攻击面三：类型面 / conformance / 协议文档 — 通过

- **types.ts ↔ api.test-d.ts**：两成员新增字段逐字同步（`toEqualTypeOf` 精确锁定协锁），
  V5 亲跑 16/16、Type Errors: no errors。
- **conformance（T2）**：ALLOWED_KEYS 两行 append（旧键全保留）；数值守卫名单 +=
  `syncRoundId`/`encodedUpdateBytes`（有限非负口径同族）；`assertSafe` 内新增：
  两 sync 型 `encodedUpdateBytes === bytes`、`syncRoundId` 在场、效果组单命运（
  `hasOwnProperty` 四键同现同缺）、组内一致性（`stateVectorChanged === (beforeHash !==
  afterHash)`、`applyEffect ↔ stateVectorChanged`）、hash `/^[0-9a-f]{16}$/` 文法；
  helpers 单元块（digest 基准向量 hardcode + 确定性 + safeStateVector throwing reader
  折叠 + 字节比较三态）经 `@nomicore/ws-replication/testing` 导入。V3 亲跑 32/32 绿。
- **协议文档**：diff 5 个 hunk（L625/L677/L701/L725/L746）**全部位于 §23（L598 起）内**，
  §9/§16/§18/§21 一字未动（节锚点核对）；§23.1 两行替换保留全部旧字段（append-only）；
  语义注记含「观测投影，非因果归因」与 delete-set-only 盲区边界（SA2 观察 2 采纳）；
  §23.3 documented safe digest 注册（算法/长度/用途/禁项完整）；§23.4 捕获纪律段；
  §23.6 `applyEffect` 入 label 白名单、`syncRoundId`/两 hash 入禁 label 列；§23.7
  conformance 招募——与设计 §5 逐条对应。ADR 零修订（#231 先例，A7）。
- **driver.ts**：diff 仅 SA5 additive seam（`hubObserver`/`peerObserver` boot 选项 +
  两处条件 spread）；`stateVectorOf`/`advanceMs`/`peerFrames`/`waitNamespace` 确认在
  HEAD 已存在（`git show HEAD:...` 8 处命中）——SA3 未改 driver（T5）属实。
- **冻结件未动**：`ws-replication-issue239-ac-red.test.ts`（未跟踪新文件）断言面与
  SA6 ac_red.md §2 契约逐条一致；红灯 log 失败消息与该文件 `numberField` L127 模板
  逐字一致（含行号上下文）——冻结件与红灯证据同源可信。

## 5. 触发性自检（SA4 亲跑，worktree 根，后台进程）

| # | 命令 | 结果 |
|---|---|---|
| V1-V3 | vitest：ac-red + repro + observer-red（3 files） | **36/36 passed，exit 0**（与 Controller 亲跑 3 files/36 tests 一致；ac-red 冻结件不改一字转绿：场景 1 no-op rounds=3 periodicGroups=3 全 noop；场景 2 delta={hub:false,peer:true} changedEvents=1、修复后 changedEvents=0；repro 7 轮全 noop + 修复 round hub noop/peer changed + 修复后回 noop；observer-red T1-T13 + helpers 单元块全绿） |
| V4 | vitest：periodic-reconcile + ac4 + ac5 + issue231 + issue230（邻接面） | **29/29 passed，exit 0**（状态机守护 + issue #230 sync 计数邻接面不受新字段影响） |
| V5 | vitest：api.test-d.ts（typecheck 模式） | **16/16 passed，Type Errors: no errors** |
| V6 | `tsc -p packages/ws-replication/tsconfig.json` | **exit 0** |
| V7 | 根 `pnpm typecheck` | **exit 0**（见下方补记） |
| RT-G5 | real-transport RT-G5 ×8（3 并发负载 + 1 全文件 + 4 串行） | 3 fail（并发负载）/ 1 fail（全文件，与另一 job 并发）/ 串行 **1 pass + 3 fail** — 间歇性，判定见 §6 |

V7 补记：根 `pnpm typecheck` 亲跑完成，输出无错误、exit 0。

## 6. RT-G5 独立判定（SA3 自报 353/354 唯一失败项）

**判定：预先存在的测试基建时序竞态（环境性 flake），非本改动回归；不屏蔽、不跳过。**

依据（全部独立取得）：

1. **失败签名**：`expect(run.peer.getConnectionState()).toBe('draining')` 收到
   `'blocked'`（test L508），发生在 GOAWAY 注入后数百 ms 内（221-1376ms，远早于
   1200ms drain deadline 与各 waitUntil 超时）——不是断言窗口超时，而是 peer 把连接
   投影为 protocol-violation 收口态。
2. **机制（实读测试源码定位）**：`injectHubToPeer` 以 `peerSide.nextSequenceForReceiver()`
   （= peer **已重组**的最大帧序 + 1）手工编序，把 GOAWAY 原始字节写进 hub→peer 真实
   socket。而前置 `waitUntil(UPDATE >= 1)` 只等 peer **出站** UPDATE 记账，不等 hub 的
   UPDATE_ACK **回流重组**完成；若注入时刻 ACK 仍在途，注入帧与 ACK 同抢同一 wire
   序列 → §3 方向连续序列违例 → peer ERROR/`blocked`。该竞态是测试自身的手工序列
   记账 vs 对端活跃发送器之争，**先于本改动存在**。
3. **与改动零因果**：(a) `bootReal` 不注入 replication observer（grep 全文件确认，
   `makeObservedPeerNode` 是 registry lease 记账，非复制 observer）⇒ `observerOn=false`
   ⇒ 本改动的全部新增行为（事件字段附着/SV 捕获/digest）在该测试中**根本不执行**；
   (b) round-engine 改动为纯参数透传（§2）；(c) wire 字节零变化（§2）——改动无通道
   影响该失败。
4. **经验证据**：本审查 8 次运行中**带全部 #239 改动仍通过**（串行 run-2 通过）⇒ 非
   确定性破坏；SA3 pristine HEAD stash 基线同款间歇失败（1 fail / 1 pass）佐证预先
   存在；包全量其余 353 全绿。
5. **处置**：不因该失败阻断本交付（其守护的 issue #171 GOAWAY drain 语义另有
   RT-F1/C4/C4b 真机锚全部通过）；建议另立维护任务修复测试注入序列记账竞态
   （§8 观察 1），不属 issue #239 范围。

## 7. 实现偏差裁决（SA3 §3 两项）

1. **repro 场景 1 noop 断言范围（periodic 组而非全部事件）**：**接受**。SA6 冻结契约
   §2.2-1 自身把 no-op round 定义为「初始 reconcile 后的 periodic round」，
   `expectNoopApplied` 只约束 `slice(-rounds)` periodic 组；boot 初始 reconcile round
   （round 1）把 peer import 期本地写收编至 hub（26 B 真实收敛、hub before/after hash
   分歧）是窗口语义「观测投影，非因果归因」的正确投影——如实报 changed 恰是本修复
   语义正确的证据，而非过度报告。设计 §6 T3.1 字面（「全部事件」）比冻结契约宽，SA3
   按契约口径落地并在 (5) 保留全事件面关联/长度/单命运/一致性断言——偏差有据、有文档、
   不触及冻结件与硬约束。
2. **§23.1 注记补 delete-set-only 盲区一句**：**接受**。纯文档、采纳 SA2 观察 2、
   与冻结契约语义（SV 派生判据）一致。

## 8. 非阻断观察

1. **RT-G5 测试注入序列记账竞态**（§6 机制）——预先存在的环境敏感基建缺陷，建议另立
   任务（注入前等待对端 in-flight 帧排空，或以 drop/replace seam 取代手工编序注入）。
2. **peer degraded Step2 效果组丢弃成本**：degraded 判别在结算后才可得，before 捕获
   已付、after/派生照做后丢弃——设计 D3 已声明成本上界（每 Step2 apply ≤ 2 次 SV 读取
   + 2 次 digest），SA2 观察 3 已记录可短路优化空间；现形状合规。
3. **`syncRoundId!` 非空断言**依赖「isStep2=true 调用点封闭于两处 applyStep2」的结构
   事实（本次全仓 grep 复核成立）；未来新增 isStep2 调用点时该断言无编译期防护——
   由 §23.7 conformance「事件 roundId ∈ wire Step1 集合」断言在运行期把守，可接受。
4. **window 语义的 delete-set-only 固有盲区**已在协议 §23.1 注记明文声明（SV 只记
   struct clock），与 issue 定义（derived from before/after vector）一致——文档化
   处理正确，无需代码动作。

## 9. 协议假设抽查（设计 §8 A1-A10 独立复核）

- A1：yjs@13.6.32 `writeStateVector` 实读——`sv.entries().sort(...)` 后逐项 varUint
  写出 ⇒ 编码 canonical ⇒ 字节相等 ⟺ 逻辑 SV 相等；`stateVectorBytesEqual` 判据可靠。
- A2：round-engine 实读——`receivedStep2` 单槽 + `syncRoundId === currentRound` 校验
  （L147-153）、`ownStep2Seq` 单槽（L193）⇒ 每 round 每侧恰一笔 apply/sent，roundId
  分组无歧义（V1/V2 集合相等断言亲跑绿）。
- A3/A9：§21 丢弃语义与 §23.6 label 口径在协议文内核对；§23.6 禁 label 列已含
  `syncRoundId`/两 hash。
- A4：`encodeStateVector` 同步读面 + 终态同步 throw（实读 namespace-runtime 源码）。
- A5：`observerOn = host.observerPresent()` 构造期标记（peer L150 / hub L137 实读）；
  T8 基线亲跑绿。
- A6：no-op round `bytes>0 ∧ applyEffect='noop'` 并存——V1 场景 1 亲跑实证（每轮
  10 B / 全 noop）。
- A10：改动面完备性（§1 独立清点）。

## 10. 结论

生产改动（P1-P7）与测试改动（T1-T5）逐条对照设计 §4/§5/§6 落实且经独立复核：
wire bytes 与 §9.4/§16 状态机零变化（改动全部位于 observer 门控分支、事件构造与纯
参数透传，状态机守护测试亲跑全绿）；safe-digest 按 §23.3 append-only 注册且算法基准
向量经双实现独立复算一致、注册即冻结；observer gating 三重门控 + 单命运折叠 +
不进 sequencer 槽（T8 基线保持）；syncRoundId 为 wire 事实投影、单连接代际、零新增
跨重启状态；类型面/conformance/协议文档/冻结件四锁面同步完整。SA6 冻结契约不改一字
转绿（亲跑）；V1-V7 触发性验证矩阵亲跑全绿；SA3 自报的 RT-G5 失败经 8 次独立运行 +
机制定位判定为预先存在的测试基建时序竞态（带改动仍通过、无 observer 下改动代码不
执行、wire 零变化），非回归、不构成阻断；SA3 两项实现偏差均裁决接受。两处非阻断
观察（RT-G5 基建竞态建议另立任务；degraded 效果组丢弃成本可优化）不影响交付。
**Verdict = `approve`，无冲突需复审。**

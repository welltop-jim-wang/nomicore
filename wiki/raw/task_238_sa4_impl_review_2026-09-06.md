# SA4 实现独立静态复核（implementation review）— Issue #238 分段观测与 sent/applied/acked 关联

## 任务标识

- 复核对象：Issue #238 当前实现（worktree 全量 diff，22 modified + 2 new test files）+ SA3 实现记录
  `wiki/raw/task_238_sa3_impl_2026-09-06.md`（自评 Verdict: approve）
- 依据基线：已批准设计 `wiki/raw/task_238_design_2026-09-06.md`（Verdict approve）+ SA2 攻击复核
  `wiki/raw/task_238_design_attack_review_2026-09-06.md`（approve，随附 F3/F4/F5/F6 处置）
- Worktree：`/home/wangjian/nomicore-fix-issue-238`（branch `mabf/issue-238`，基准 HEAD `9e3f0bf`，
  未提交未推送——按任务要求）
- 复核人：SA4（implementation-review 阶段；与 SA1/SA2/SA3/SA5/SA6/SA8 无身份重叠）
- 复核方法：设计 §9 受影响文件清单 vs `git diff HEAD` 逐文件比对；四门（G1–G4）与 Owner
  要求独立重推导（不采信 SA3 自评）；关键源文件实读（sequencer/replication-session/runtime/
  internal/registry/types/testing/update-channel/peer-namespace/hub-namespace/liveness/
  peer-connection/hub-connection）；独立复跑聚焦契约 + typecheck + 冻结面负向守卫 + 全套件。

## 一、独立复跑证据（本 worktree，2026-09-06 实跑）

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run packages/ws-replication/test/ws-replication-issue238-repro.test.ts packages/ws-replication/test/ws-replication-issue238-segmented-observation.test.ts --reporter=verbose` | **2 files / 9 tests passed**（repro 阶梯 57 ms + 契约 8 用例），Type Errors no errors，exit 0——与 Controller 已登记验证一致 |
| `pnpm --filter @nomicore/ws-replication typecheck` | **exit 0** |
| `pnpm exec vitest run packages/namespace-runtime/test packages/namespace-registry/test packages/ws-replication/test/ws-replication-observer-red.test.ts packages/ws-replication/test/ws-replication-api.test-d.ts` | **64 files / 623 tests passed**，Type Errors no errors——冻结面负向守卫（十二键/O-11/lease 2 键/导出审计/internal 守卫/safe-field 白名单/21 型 union）零修改前提全绿 |
| `pnpm exec vitest run packages/ws-replication/test` | **50 files / 356 tests passed**，Type Errors no errors——与 SA3 §3 登记值（348 基线 + 8 新契约）逐位一致，零回归 |

## 二、改动面 vs 设计 §9 清单逐文件核验

diff 路径集合与 SA3 §2 精确改动路径**逐文件一致**（22 modified + segmented-observation 新增；
repro 与 wiki 六件为先前 SA 轮 untracked 产物）。设计声明「不触碰」面逐一实证：
`lease.ts`、`packages/persistence/**`、`ws-replication/src/{observer,plugin,defaults,index}.ts`、
`namespace-runtime/src/index.ts` **全部零改动**（git diff --stat 空）；ADR-0010 仅追加
「issue #238 修订」节（+9 行，全部位于新节内）；CONTEXT.md 零改动。

## 三、四门（G1–G4）独立重推导

### G1 槽序 — 未触发

- `sequencer.ts`：记账关闭路径（无 stageClock 或无 slotMetrics——构造期判定）与既有实现
  **逐字节同形**（`settled = this.tail.then(run, run)` + `this.tail = settled.then(noop, noop)`
  原样保留）。记账在场路径链形不变：`runMeasured` 包装不改 FIFO 定序（`.then` 链仍单线），
  仅槽内加微任务跳（见观察 O7，opt-in 配置内、定序零影响）。
- `replication-session.ts`：admission/slotStart/applyStart/dirtyStart/dirtyDone 五戳全部经
  `stageNow()` 安全包装的**纯同步时钟读**，零新增 await/调度点；R1–R7 槽结构与
  `await notifyDirty()` 位置逐行核对未动；refusal/fatal 分支逐字节保持（无 stages）。
- close barrier 与 P0/S/schema/E/bump 入队点仅加 label 参——`WriteSequencer` 仍为包内零公共
  导出模块（index.ts 零改动实证）。
- 槽样本 flush 在 `settled.then(...)` 续体（槽释放后、任何槽的 run 调用栈之外）；sink throw
  自捕获；缓冲有界（1024 丢最旧）。

### G2 受保护判据 — 未触发

`protectedContentEvaluated`（R4 scratch clone 内容投影相等判据）函数与全部调用语义零改动；
实读 R4 区域确认唯一插入物 = `applyStart` 时钟读（R4 通过后、R5 `Y.applyUpdate` 前）。
无任何增量/diff 触达判据或成本优化预写（H3 修复支路按设计 §8.2 留在门后）。

### G3 wire — 未触发

全部变更 local：事件对象字段、channel host 内部回调（`noteUpdateSent`/`onUpdateAcked` info
扩展）、`queuedAt` 记账、registry/runtime 包内 seam。`sendChecked`/UPDATE_ACK 构帧零改动；
protocol §3/§10 原文零改动（仅 §23 append-only 修订 + ADR-0010 追加节）。契约测试第 6 项
（在场/缺席两构型 wire 帧协议语义序列逐帧全等 + 控制面字节长度一致）独立复跑为绿。

### G4 冻结注册表 — 未触发（含被批准演进面）

- 拒绝码闭集：runtime 侧 6 码 / registry 侧镜像逐字未动（实读比对）。
- `ReplicationSession.getStatus()`（O-11）与 Runtime `getStatus()` replication 两态域：diff
  零触点（负向守卫测试 623/623 绿佐证）。
- Runtime 公共面对象：十二键零改动；观测经 seam 输入 + WeakMap host（`stageClock` 加在 host，
  非公共键）。
- lease 2 键严格校验：`lease.ts` 零改动；观测参数刻意走 registry 构造 options（ADR-0010 修订
  节第 2 条登记该消歧）。
- 事件词汇 20→21 型：走 protocol §23 自我声明 append-only 条款 + Issue AC #7 明文要求——
  SA2 攻击复核 A5 已独立重推导为「被批准演进，非未批准扩形」；本复核确认实现与该批准路径
  一致（新字段全部为差值/uint32 有限数值，safe-field 白名单同步扩且旧键集不变——observer-red
  白名单 diff 实读为纯增列）。
- watch item 1（ok 分支 `stages` 的保守读法消歧）：ADR-0010「issue #238 修订」节已按 SA2 F4
  必含项登记（四条：联合加性、不进 session open 输入、槽级记账落点、发射点纪律）。

## 四、Owner 要求（评论 IC_kwDOT8JVvs8AAAABS2CyWg，2026-09-06T13:39:25Z）逐项达成核验

| Owner 要求 | 实现落点（实读 + 独立复跑佐证） | 裁决 |
|---|---|---|
| 确定性观测区分 **event-loop stall** | 第 21 型 `event-loop-delay-sampled`（liveness ping 锚点，observer+clock+ping/onPong 三者齐备才武装，缺一零状态零调度）；正向控制测试注入已知漂移 Δ=30/20 → delayMs 精确复现；dormant 测试（时源缺面 → 零采样） | ✓ |
| **sequencer queue wait** | `queueWaitMs` = slotStart − admission（A4 入队前采样）；saveGate 构型逐笔精确 [0,4000,3000,2000,1000]（契约测试 1 独立复跑绿） | ✓ |
| **protected check / live apply** | `protectedCheckMs`（R1–R3 同步门 + R4 预演，设计 §4.1 裁决口径）+ `liveApplyMs`（R5）；本构型恒 0 逐笔断言 | ✓ |
| **dirty notification** | `dirtyNotifyMs` = R6 resolve − dirtyStart；u1 = 5000（门闩持有时长）精确断言 | ✓ |
| 可靠 **sent/applied/acked sequence 关联** | 三事件面 + `sequence`（= wire envelope sequence / `UPDATE_ACK.ackedSequence`）；非合并构型逐位 = wire 帧序断言；合并构型（窗口 1 诱发贪心合并）断言一 sequence 覆盖合并帧、三事件计数一致、sendQueueMs=[0,4000] 精确差值、事件 bytes = wire 载荷长度 | ✓ |
| 保留基线五笔阶梯 + live/无重连/无 namespace error | repro 文件字节未动（断言面实读：:147 阶梯、:152-161 wires===1/ready/live/零错误/零连接迁移；文件 untracked 自 SA5/SA6 轮，断言面与 SA2 复核登记逐位一致）；driver/harness 变更全部加性可选缺省 dormant；契约测试第 1 项以生产 seam 复证同一阶梯与契约面 | ✓ |
| 不得表述为生产 11 秒阶段证明 | repro 头注边界声明（「不构成生产 11 秒占槽阶段的证明」）保留；protocol §23.4 新增「跨侧减法只作 triage 近似」登记；ADR-0010 修订节同口径；SA3 报告同口径——全链一致，无越界断言 | ✓ |

## 五、发现（全部非阻塞；逐条附处置意见）

- **O1（文案精度，随附修正建议）**：`runtime.ts` `captureSeamInput` 顶层 TypeError 文案仍为
  `'{ handle, p0Gate?, compile?, notifyDirty? }'`——未列新键 `replicationObservability`。
  形状守卫本身响亮且正确（stageClock/slotMetrics 分别校验）；纯文案精度，可在后续 PR 顺手补。
- **O2（冻结基线的陈旧注释，登记不动作）**：repro 头注 :34-35「事件面不携带 sequence（生产
  缺口……属后续设计/实现）」在实现后成为陈旧描述。该文件按 Owner R1 字节冻结，陈旧注释是
  冻结的既定代价；不得为本复核修改（无 Owner 签字不动基线）。
- **O3（slotKind 词表四重复制，可维护性观察）**：`SequencerSlotKind`（runtime）+ registry 内部
  seam + testing seam + 公共 `ReplicationObservabilitySlotSample` 三处字面量镜像。系刻意设计
  （import 图审计纪律——不把 runtime 内部类型名带进 registry/testing 声明图；先例 = 拒绝码
  联合镜像）。seam 形状漂移在 `createNamespaceRuntimeForRegistry` 消费点编译期红；公共类型
  词表漂移仅文档级——后续若加槽类型须四地同步（登记为维护注意项）。
- **O4（对设计 §11.2-6 的已文档化适配，接受）**：wire 不变断言以 kind#seq 语义序列 + 无载荷
  帧字节长度实现，而非字面「字节序列全等」——因 Yjs update 载荷含随机 doc client id，跨运行
  字节比结构性不可确定（两次 observer-off 运行之间亦然）；与本仓库 conformance 惯例
  （observer-red T8 同款注记）一致。SA3 §3 已如实登记。语义覆盖（零增删/零重排/零控制面字节
  扰动）达成设计意图；接受。
- **O5（queueDepthAtStart 含本槽，已文档化口径）**：设计 §7 表述「尚未开跑的排队任务数」未明
  是否含自身；实现 = 含本槽（类型注释 + 测试断言 R1 深度 2 = R1+R2 双登记）。口径自洽且已
  固化在公共类型文档；无需动作。
- **O6（refusal 路径的观测期时钟读，不可观测差异）**：`slotStart` 在槽入口（R1 前）采样——
  stageClock 在场时 refusal/fatal 路径多一次被丢弃的时钟读。dormant 路径（无 stageClock）零
  时钟读保持；结果形状/协议行为逐字节不动。无动作。
- **O7（记账在场路径的微任务跳，opt-in 且定序不变）**：`runMeasured` async 包装在
  stageClock+slotMetrics 双在场时为每槽加微任务跳。FIFO 定序由 `.then` 链决定、不受影响；
  dormant 路径逐字节同形。属 D5/D7 许可范围；无动作。

无 HIGH/MEDIUM 级发现；O1–O7 全部为文案/可维护性/已文档化适配级别，不构成 reject 或返工依据。

## 六、vitest / E2E 触发面结论

- **聚焦 vitest（Owner 契约面）**：repro + segmented-observation = 9/9 绿、Type Errors no
  errors——本复核独立复跑，与 Controller 已登记验证及 SA3 §3 一致。手动时钟/微任务泵/门闩，
  零 real sleep。
- **typecheck**：`@nomicore/ws-replication` exit 0（独立复跑）；SA3 另登记根 `pnpm typecheck`
  （13 项目）exit 0——本次复核以聚焦面 + 三包测试内嵌 typecheck 覆盖，未重跑根门（Controller
  验证域已含核心门）。
- **冻结面负向守卫**：namespace-runtime + namespace-registry 全目录 + observer-red + api.test-d
  = 64 files / 623 tests 绿——十二键/O-11/lease 2 键/导出审计/internal 守卫/safe-field 白名单
  （21 型 + 新字段增列后旧键集不变）全部通过，实证 G4 零触碰。
- **回归面**：ws-replication 全套件 50 files / 356 tests 绿（= SA5/SA6 基线 348 + 新 8，零回归）。
- **E2E**：本任务未新增 real-transport E2E——新事件面经既有 dispatch 隔离路径发射，由全套件中
  既有 real-transport dynamics/observer isolation 用例覆盖同一管线；生产 H1 判别力按设计 §6
  边界依赖部署后数据（fake-duplex 结构性排除 stall，测试形态 = 已知漂移正向控制），与 Owner
  R2「复现≠生产阶段证明」边界一致。无 E2E 缺口需要本任务补齐。

## 七、裁决

- 实现与已批准设计逐文件一致：四段差值经 apply 结果加性 `stages` 从槽内导出、发射留在 apply
  结算续体（§23.4 实读保持）；sequence 三事件面闭环且与 wire 逐位对账；event-loop 探针与槽级
  记账 dormant 缺省、gating 完整；registry 装配三层构造点闭包盖 namespaceId 戳；SA2 随附
  F3（命令勘误）/F4（ADR-0010 登记）/F5（noteUpdateSent 形状）/F6（degraded 不携时延字段）
  全部落实。
- 四门独立重推导全部未触发；Owner 六项要求逐项达成且以可复跑断言固化；基线锚字节未动。
- 独立复跑（聚焦 9/9 + typecheck exit 0 + 守卫 623 + 全套件 356）全绿；发现 O1–O7 全部
  非阻塞。
- **Verdict: approve**（O1 为后续 PR 顺手项；O2–O7 登记性观察，无需动作）

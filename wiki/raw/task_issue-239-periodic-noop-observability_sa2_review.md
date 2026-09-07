# 独立攻击审查 — issue #239 SA1 设计（design attack review）

> 阶段：design review（独立攻击审查，SA2）。审查对象：
> `wiki/raw/task_issue-239-periodic-noop-observability_design.md`（SA1/设计）。
> 前置输入全读：任务简报、SA8 冲突报告（`clear`）+ relevant_decisions、
> SA5 故障分析（reproduced 20/20）、SA6 红灯契约（`..._ac_red.md` + 两 log +
> `ws-replication-issue239-ac-red.test.ts` 冻结件）。
> Issue comments 于派发前完整读取：0 条，无额外 Owner 要求。
> SA1 structured result `requiresConflictRecheck=false` → 不插入 SA8 设计复审，由本审查承担独立攻击面。
>
> 方法：不轻信设计文档的任何行号/结构断言，全部对照本 worktree 源码、测试与协议文档独立复核。

## Verdict

**`approve`**（`requiresConflictRecheck=false`）——零阻断缺陷；4 项非阻断观察见 §6。

## 1. 审查范围与独立复核清单

| # | 设计断言 | 独立复核证据（本 worktree 实读） | 结论 |
|---|---|---|---|
| V-1 | 发射点恰 4 处 + 类型面 1 处 + 白名单 1 处 + api 协锁 1 处（A10） | 全仓 grep（排除 node_modules/wiki/raw）：`peer-namespace.ts` L159/L1076、`hub-namespace.ts` L146/L891（唯一 4 处 src 发射点）；`types.ts` L336-350；`observer-red.test.ts` ALLOWED_KEYS L1148-1149；`api.test-d.ts` L246-247。无第 5 处发射点、无遗漏锁面 | 成立 |
| V-2 | P3 round-engine 纯参数化（D2） | `round-engine.ts` L30 `RoundHost.applyStep2` 现签名；`onStep2` L134-152 先校验 `message.syncRoundId === currentRound` 再调 `applyStep2Safely`（L151）；`applyStep2Safely` L188-195。违例矩阵/结算/reset 逻辑与设计「一字不动」承诺一致；改动确为参数透传 | 成立 |
| V-3 | applied 侧 roundId 透传可行且无旁路 | `applyRemoteUpdate(..., true)` 全仓仅两处调用：peer L1007 / hub L835（各自 `applyStep2` 内）；其余调用（peer L553 / hub L602）均 UPDATE 路径（isStep2 缺省 false）→ `syncRoundId!` 非空断言来源封闭 | 成立 |
| V-4 | before/after 捕获点与 §23.4 纪律（D3/A4） | peer `applyRemoteUpdate` L1029-1098：`session` 为局部引用（L1034）、t0 采样 L1042（接纳同步段，`session.applyRemoteUpdate` 入队前）、结算续体 L1053-1081、degraded 分支 L1056-1063（`degraded-bypass-applied`，互斥规则在）。hub L855-910 镜像、无 degraded 分支（L879 注释「hub 结构性不可 bypass」）。`replication-session.ts` `encodeStateVector` L409-414：同步读面、终态同步 throw `ReplicationSessionClosedError`（折叠路径真实存在）；接纳层 L436+ 为同步段 | 成立 |
| V-5 | 折叠先例与隔离 | `observer.ts` `safeNow` L125-131（try/catch → undefined 先例）；`dispatchReplicationObserver` L34-42（observer 缺席 no-op + throw 静默隔离） | 成立 |
| V-6 | observer gating（A5） | `observerOn` 构造期标记：peer L126/L150、hub L115/L137；既有发射点全部 `observerOn` 门控（peer L157、hub L144 等）；设计新增读取全部挂 `isStep2 && observerOn`（before）与 `svBefore !== undefined`（after/派生）→ 无 observer 零捕获零 digest 零事件，§23.4「逐字节等价」满足；T8 三运行基线测试（observer-red L1086-1111）不改继续把守 | 成立 |
| V-7 | syncRoundId 单连接代际（A3） | `peer-namespace.ts` L96 `roundCounter` 为 PeerNamespace 实例字段（连接×namespace 作用域），从 0 起 → round ≥ 1（hub 侧 `onStep1` L101 拒绝 `<= lastRound`、`lastRound` 初值 0 亦排除 round 0）→ 契约 `numberField` 类型断言与 conformance `>0` 断言均可满足；设计零新增长生命周期状态（§1 不做清单第 5 行 + D2 帧内投影）；§21 L564「进程重启丢弃 …syncRoundId…」与 D7「§9/§16/§18/§21 一字不动」相容 | 成立 |
| V-8 | SV 字节判据可靠性（A1） | `pnpm-lock.yaml` L982 单版本解析 `yjs@13.6.32`；`yjs/src/utils/encoding.js` `writeStateVector`：`sv.entries().sort(...)` 后逐项 varUint 写出 → 同一 client→clock 映射恒产生逐字节相同编码 → 字节相等 ⟺ 逻辑 SV 相等；`stateVectorBytesEqual`（长度+逐位）判据可靠 | 成立 |
| V-9 | 红灯契约转绿可行性 | 见 §4 逐场景推演 | 成立 |
| V-10 | 协议文档落点（D7/§5） | 协议 L628-629 两行现状与设计 §5.1 替换文本逐字对应（单表「bootstrap / reconcile / updates」）；§23.3 允许清单（L670-678）现无 digest 类别 → §5.2 注册为必要 append-only 步骤；§23.4（L685-706）、§23.6 label 白名单 `{side,type,code,cause,reason}`（L728）+ 高基数禁 label（L731-733）、§23.7 conformance 招募（L735-748）均按设计 §5.3-§5.5 存在对应插入点；issue #231 append-only 先例在 L640-641 文内可见（A7） | 成立 |
| V-11 | conformance/api 协锁（D6/T1/T2） | ALLOWED_KEYS 20 行冻结白名单 L1141-1163；数值守卫名单 L1190-1200；api 型断言 `toEqualTypeOf` 精确锁定 L238-261（20 型）。设计 T1/T2 同步追加否则红——锁面清单完整 | 成立 |
| V-12 | 测试基建免改（T5） | `driver.ts`：`hubObserver`/`peerObserver` L197-199/L510/L539、`stateVectorOf` L445、`advanceMs` L600、`peerFrames` L295、`waitNamespace` L311、`hubFixture` L209 均在场——契约测试所需全部就绪，无需改 driver | 成立 |
| V-13 | testing 子路径（P6/D4） | `package.json` exports `./testing` → `src/testing.ts`（既有；`ws-replication-auth-lifecycle-red.test.ts` L40 已从该子路径 import）→ 纯函数 helper 导出落点成立，不进 `src/index.ts` 生产 API | 成立 |

## 2. 攻击面一：wire bytes 与 §9.4/§16 状态机不变性 — **通过**

- 生产改动清单（P1-P6）全部位于 `packages/ws-replication` 的 observer 层与类型面：`types.ts`（observer 事件联合，非 wire codec）、`observer.ts`（新增纯函数）、`round-engine.ts`（回调参数化）、peer/hub-namespace（observer 门控分支内追加字段投影 + SV 读取）、`testing.ts`（re-export）。**零改动** `@nomicore/replication-protocol` codec、帧构造、帧发送逻辑。
- round-engine 改动复核为纯透传：引擎状态字段、违例矩阵、`checkSettled`/`resetState` 不动；`SYNC_STEP2` 帧构造（L176-186）不动。
- peer/hub 的改动点均在既有 `observerOn` 分支内部；`SYNC_APPLIED`/`UPDATE_ACK` 发送、`finalize`、状态迁移路径零触碰（peer L1005-1026 / hub L834-853 的 SYNC_APPLIED 逻辑不动，observer 事件发射在 apply 结算续体内、决策落定之后，与 §23.4 时序纪律一致）。
- 事件型数维持 20（§23.1 标题「20 型」、ALLOWED_KEYS 20 行、api 型断言「20 型」三处互证）；`bytes` 字段名/语义冻结，澄清走新增 `encodedUpdateBytes === bytes`（SA8 注记 2 的 add-only 形式）。
- 状态机守护有测试把守：冻结契约每轮断言回 live、roundId 单调 +1（ac-red 场景 1/2 守护断言）+ V4 回归面。

## 3. 攻击面二：safe-digest / observer gating / syncRoundId 代际边界 — **通过**

- **safe-digest**：算法（双泳道 FNV-1a-32，正序+逆序，basis 2166136261 / prime 16777619 / mod 2³²，恒 16 位小写 hex）在 §23.3 以「documented safe digest」append-only 注册（§5.2），注册即冻结（GA 纪律），演进走再增字段（D4）。这是 issue 明文授权的两形态之一（"keyed **或** documented"）；否决 keyed 的理由（跨侧关联要求两端同 key、无跨进程分发渠道）成立——hub after-hash 与 peer after-hash 的跨侧比对（§0 第四问的最小安全载体）确实只有 documented 形态可达。raw SV 字节仍属 Yjs bytes 禁止项：digest 是派生定长字符串，事件树深扫（契约 `assertEventTreeSafe` + conformance T9）持续把守；hash 仅入事件/trace payload，§5.4 明确禁入默认 metric label。64 位有效判别宽度用于相等/关联（非保密）充分；T2.4 以 hardcode 基准向量锁算法冻结。
- **observer gating**：三重门控链完整——无 observer（构造期 `observerOn=false`）→ 零事件零捕获零 digest（§23.4「逐字节等价」）；有 observer 但非 Step2（UPDATE 热路径）→ 零新增读取；Step2 → before/after 各一次 `encodeStateVector` + 两次 digest + 一次比较，成本 O(clients) 且有界（含 degraded 分支丢弃路径的成本上界，D3 已注记）。捕获/比较 throw 经 `safeStateVector` 折叠（`safeNow` 同款，V-5），效果字段组**单命运**（整组 spread/整组缺，P4.3 构造单点 + T2.3 一致性断言把守）——绝不伪造 `noop`。捕获点纪律合规：before 在帧分发同步段（t0 同点）、after 在结算续体（`degradedBypassActive()` 投影读取先例同点），均为读取面、不进 Registry write sequencer 槽（replication-session 接纳层同步段实读确认，V-4）；SV 捕获只经 session 受控能力 `encodeStateVector`，不暴露 live Y.Doc（ADR-0012 被否决方案规避）。
- **syncRoundId 代际边界**：sent 侧取帧内 `message.syncRoundId`（§9.2 既有 wire 字段）；applied 侧经 `RoundHost.applyStep2` 第三参显式透传，且 `onStep2` 已在调用前校验 roundId === currentRound（V-2/V-3）——投影的是「帧携带的 wire 事实」，与被否决的读引擎内部态方案相比对重构更稳健（设计 D2 论证成立）。计数器为连接内 PeerNamespace 实例字段（round ≥ 1，V-7），零新增跨连接/跨重启状态；§21 丢弃语义与 §5.1 注记「跨重启关联不存在」一致。设计不将其绑入默认 metrics label（高基数 payload 处理，§23.6 同款）。

## 4. 攻击面三：红灯契约转绿可行性 — **通过**（逐断言推演）

对照冻结件 `ws-replication-issue239-ac-red.test.ts`（不改一字）：

1. **字段在场**：`groupsOf`/`numberField`/`booleanField` 要求全部 sync 事件带 `syncRoundId: number`、`encodedUpdateBytes === bytes`，全部 `sync-diff-applied` 带 `stateVectorChanged: boolean` + `applyEffect`——D1/D5 必在字段 + 效果组（受控场景捕获必成功，session 全程 open）覆盖。
2. **场景 1（no-op）**：已收敛副本每轮双侧 Step2 均空 diff 结构性非零（`minBytes > 0` 由 Yjs 编码非规范零长保证，SA5 探针 2 B `[0,0]` + 本地 10 B 双证）；双侧窗口（接纳→结算）内无任何写 → 双侧 `stateVectorChanged=false`/`applyEffect='noop'` 全场成立；事件 roundId 集合 === peer 出向 Step1 roundId 集合（每轮 peer 恰一发 Step1、双侧各恰一发 Step2/apply——round-engine 单槽约束 L143-145/L185 实读确认无歧义分组）；含初始 reconcile 轮（round 1 亦投影）集合相等成立。
3. **场景 2（漂移修复）**：漂移注入为 hub 直写（同步、round 前）→ hub 侧 Step2 窗口内无写 → `noop` = `delta.hub=false` ✓；peer 侧经 round Step2 收到漂移 → 窗口内 SV 推进 → `changed` = `delta.peer=true` ✓；`changedCount ≥ 1` ✓。时序关键点（advanceBy 同步段先于 hub 出向 UPDATE 微任务；注入后不 await、不丢帧）是**冻结测试自身的属性**，设计 T5 不改 driver、T4 不改契约 → 时序纪律原样保持。随后的重复 UPDATE 走 `update-applied`（互斥规则），不在契约断言面。修复后下一轮全 noop（非粘滞）——效果字段为逐 apply 窗口派生，天然无粘滞。
4. **hash 字段相容**：契约不断言额外字段缺席；深扫只拒 `Uint8Array`/`ArrayBuffer`/`DataView`——16-hex 字符串通过。设计落地 hash 不破坏冻结件。
5. **类型协锁**：`exactOptionalPropertyTypes` 下效果字段条件 spread（`...(effect !== undefined ? effect : {})`）与既有 `applyLatencyMs` 缺 clock 先例同形（peer L1073 实读）；api.test-d 与 types.ts 双侧同步（T1/P1）后 `toEqualTypeOf` 绿。

**结论：设计按 §4/§5/§6 落地后，冻结契约不改一字转绿（V1），且 V2-V9 验证矩阵覆盖回归/协锁/稳定性。**

## 5. 攻击面四：生产/测试/协议文档覆盖完整性 — **通过**

- 生产：P1-P6 与发射点/类型/引擎/两侧 namespace/testing 子路径一一对应（V-1/V-13），无第 5 处发射点、无遗漏生产文件。
- 测试：T1（api 型协锁）、T2（conformance 白名单 + 数值守卫 + 单命运/一致性/文法断言 + helpers 单元面）、T3（SA5 复现按预告翻转）、T4（契约冻结）、T5（driver 免改）——与冻结契约 §6 转绿条件三条逐一对应；T8 三运行基线不改（门控天然满足）。
- 协议：§23.1 两行替换 + 语义注记、§23.3 digest 注册、§23.4 捕获纪律、§23.6 label 白名单/禁项、§23.7 conformance 招募——五处 append-only 插入点均在协议文内核实（V-10）；§9/§16/§18/§21 不动；ADR 零修订（#231 先例 + SA8 认定）。
- 外围面独立排查：`ws-replication-issue230-incremental-mutation.test.ts`（断言 sync 事件计数为 0——新字段不影响零计数）；`.agents/skills/nomicore/replication.md`（仅 prose 列事件名、无字段集枚举，落地后仍准确）；包 README 与 CONTEXT.md 不枚举事件字段（无需更新）。无遗漏文档面。
- 验证命令 V1-V9 与包 AGENTS 验证门（focused state-machine tests + 包 typecheck + 根 typecheck/test）对齐。

## 6. 非阻断观察（供 SA3 实现参考，不影响 approve）

1. **RoundHost 接线 lambda 需同步加参（编译器强制，建议列全）**：P3 改 `RoundHost.applyStep2` 接口 + P4.2/P5.2 改私有 `applyStep2` 签名后，构造处接线（peer L181 / hub L169 `applyStep2: (update, step2Sequence) => this.applyStep2(...)`）也必须加第三参。2 参 lambda 对 3 参接口类型仍可赋值，但函数体对已要求 3 参的私有方法的 2 参调用会被 V6 typecheck 以 TS2554 拦截——正确性有编译器兜底，唯建议 P4/P5 显式列出该两行，避免实现者误以为接口改完即闭面。
2. **SV 派生效果对 delete-set-only 修复的固有盲区（建议文档一句话声明）**：Yjs state vector 只记录 struct clock；仅携带 tombstone（delete-set）的 Step2 修复不推进 SV → `applyEffect='noop'` 而 logical state 实际变化。这是 issue 自身定义（"derived from before/after vector, not byteLength"）与冻结契约的固有语义，非设计缺陷；建议 §5.1 语义注记可选补一句该边界（现文「观测投影，非因果归因」已部分覆盖）。
3. **degraded 分支的 after 捕获可免（微优化，现形状合规）**：D3 规定 peer degraded Step2 捕获照做、效果组丢弃（成本有界已注记）；实现上 degraded 判别在结算后才可得，before 已付成本无可挽回，after 可在 degraded 分支短路——设计现形状不违反任何纪律，仅记录优化空间。
4. **yjs 版本口径**：SA5 文档写 `^13.6.30`、设计 A1 写 13.6.32（lock L982 单版本解析）——无冲突，以 lock 为准；A1 的 canonical 编码依据在 13.6.32 源码实读核实（V-8）。

## 7. 结论

四攻击面全部通过：wire bytes 与 §9.4/§16 状态机零变化（改动全部位于 observer 门控分支与类型面，状态机路径零触碰且有守护断言把守）；safe-digest（documented 形态、§23.3 append-only 注册、注册即冻结、不入默认 label）、observer gating（无 observer 零捕获、折叠单命运、不进 sequencer 槽）、syncRoundId（wire 事实投影、单连接代际、无跨重启状态）三项约束落实充分；红灯契约按设计落地后不改一字转绿（逐断言推演成立）；生产/测试/协议文档覆盖完整（含外围面独立排查）。合规对照矩阵（设计 §9）逐行有代码/协议证据支撑。**Verdict = `approve`，无冲突需复审，可进入 SA3 实现。**

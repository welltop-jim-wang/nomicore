# SA8 冲突门禁报告 — issue #245（前置门禁）

- **dispatch**: sa-325e7495-c92b-46b0-a247-762761664f92（mabf-sa8 / conflict-gate / iteration 0）
- **审查对象**: issue #245 任务简报「ws-replication：分块传输 observer 事件（issue #233 切片 4）」
- **门禁类型**: 前置门禁（SA 派发前：任务简报 vs ADR 全集 + CONTEXT.md）
- **Issue comment REST snapshot**: `[]`（空——dispatch 声明经本次实测 `GET /issues/245/comments` 复核一致）——无 owner 补充要求需要并入；本报告仅以 issue body 为任务要求来源
- **裁决**: **通过（clear）——0 阻塞冲突 / 0 轻微冲突 / 6 条非阻塞就绪注意项（R20–R25）**

## 1. 冲突基准与效力判定

基准 = `CONTEXT.md` + `docs/adr/` 全集（14 篇）。全库扫描 supersede/废止标记：**无任何 ADR 处于 ADR 级被取代状态**（grep 命中均为 ADR 正文节内历史修订记录，同 #244 门禁裁定）。代码与 `docs/protocols/`、wiki 不构成自动阻塞依据，仅作就绪性佐证。

- **ADR 0013（chunked live update transfer）**：状态「提议（issue #233 base PR #241）」。沿用 #244 前置门禁 R9 裁定：正文已入 corpus（commit 164eee7）、CONTEXT.md 已并入「分块复制传输／UPDATE_CHUNK／CAP_CHUNKED_UPDATE」三词条、切片 #242/#243/#244 已按其合并落地——按 SA8 基准规则其为**现行约束**。其「Observer seam（append-only，对齐 §23 纪律）」节（L83–94）冻结 4 个 chunked-update 事件类型与字段，是本简报的直接基准。
- **ADR 0010** 为 observer seam 架构权威（L167：复制插件提供结构化 observer seam，最小观测面含 updates/bytes in/out、apply/ACK latency）；ADR 0013 自述扩展 ADR 0010 的 live UPDATE 路径、不改变其 ACK durability 语义——observer 事件只描述既有协议事实的观测投影，不改 wire 字节。
- **§23 纪律**（safe-field 白名单、throw 隔离、决策落定后发射、时钟折叠、无 observer 逐字节等价）由 ADR 0013 显式引用（「同 §23.3」「全部沿用 §23.4」）并登记于 `docs/protocols/instance-replication-v1.md` §23（标题自述「local，非 wire 契约」；append-only：事件类型/词表只增不改，GA 后字段语义冻结）。

## 2. 逐条对照（简报 → 基线）

| # | 简报要求 | 基线依据 | 裁决 |
|---|---|---|---|
| C1 | observer seam append-only 新增四个事件类型，键集冻结并经白名单断言 | ADR 0013 L85–92 observer seam 表逐字同源（4 型 + 字段 + 「键集冻结」）；protocol §23.1 append-only 条款（L667）；§23.1 L725 明文「成功路径三型（sent/applied/acked）为 **#245 计划项**，本切片不登记为已实现行为」——协议自身已为本简报预留登记位 | 无冲突 |
| C2 | `chunked-update-sent`：transfer 完成出站时一次，非逐 chunk；字段 transferId/chunkCount/totalBytes | ADR 0013 L89 逐字对应；发送侧锚点已就位：末 chunk 出站时刻 = ACK 计时锚（ADR L53）且切片 2 已按「末 chunk noteUpdateSent{末序,总长}、中间 chunk 不发射」构型记账（`update-channel.ts:402` 注释明文「#245 归 chunked 事件」）——简报即该预留的承接 | 无冲突 |
| C3 | `chunked-update-applied` 纳入 apply 成功路径互斥规则**第四形态** | ADR 0013 L90 逐字预授权（「apply 成功路径互斥规则第四形态」）；现行 protocol L727–729 互斥规则为三选一（update-applied／sync-diff-applied／degraded-bypass-applied），第四形态扩展在冻结面内（「UPDATE_CHUNK 且非 degraded」的自然落位，见 R23）；现状 chunked apply 复用既有管线发 `update-applied`（`hub-namespace.ts:746,1192`、`peer-namespace.ts:728,1425`）——改道预先授权，见 R21 | 无冲突 |
| C4 | `chunked-update-acked` | ADR 0013 L91 逐字对应（`ackLatencyMs?`）；ACK 复用既有 UPDATE_ACK、ackedSequence = 末 chunk 帧序（ADR L46）——无新 ACK 消息；现状末 chunk 帧序已注册 inFlight（bytes=总长），ACK 路径经既有 `update-acked` 管线（`hub-namespace.ts:1061`）——改道预先授权（R21） | 无冲突 |
| C5 | `chunked-update-aborted`：reason 闭集 {timeout, shed, resync-declared, channel-teardown, connection-teardown, epoch-fence} + receivedChunks/receivedBytes；与切片 3 中止路径一一对应、每笔中止恰一事件 | ADR 0013 L92 逐字对应；**该型已由 #244 交付**：protocol §23.1 第 23 型登记（L725，含六 reason 接线行——shed/epoch-fence 行已接线，#244 设计复审 R11 的承接错位已按其选项 (a) 收口）、`types.ts:660–687`（含 side 信封、无 connectionId——域键集逐字 ADR L92）、`hub-namespace.ts:795`/`peer-namespace.ts:778` 发射 + busy 守卫计数不变量 + SA7 动态断言测试在库 | 无冲突（范围 = 校验/保持已冻结面，非重新实现——见 R20） |
| C6 | safe-field 白名单：只报长度/计数/有界标识（transferId），零 Yjs bytes/ArrayBuffer、零 Error/异常原文、零 token/owner/内容，含 JSON.stringify 哨兵扫描 | ADR 0013 L85（「safe-field 同 §23.3——只报长度/计数/有界标识，零 Yjs bytes 与内容」）；§23.3 白名单 + §23.7 L881–883 conformance 既有断言族（含 `JSON.stringify` 无标记物、深扫无 Uint8Array/ArrayBuffer/Error）；CONTEXT.md「分块复制传输」词条约束遵守（transferId 为有界标识、非跨连接持久标识——事件字段用法一致） | 无冲突 |
| C7 | throw 隔离、决策落定后发射、无 observer 零事件零采样逐字节等价纪律全部沿用 | ADR 0013 L94（「throw 隔离、决策落定后发射、无 observer 逐字节等价——全部沿用 §23.4」）；§23.4 L803–807（throw 静默隔离、发射点永不位于 Registry write sequencer 槽内）+ L841（无 observer = 零事件、零状态投影读取、零时钟调用，逐字节等价）；隔离分发单点已就位（`observer.ts` dispatchReplicationObserver）；AC2「observer 每事件必 throw 时 wire 帧序列/终态/文档内容/apply 结算与无 observer 基线逐字节全等」= §23.7 L883–884 既有 conformance 要求同款 | 无冲突 |
| C8 | 无 clock 时 latency 字段缺失（非 undefined 值）、有 clock 时 ≥ 0 | §23.4 L811 逐字对应（「缺省 clock = 全部 latency 字段不存在（field 缺失，非 undefined 值）」）+ clock-throw 折叠策略（L812–816）+ §23.7 L884–885（「无 clock 时 latency 字段缺失、有 clock 时 ≥ 0」）——AC3 措辞与现行纪律逐字同源 | 无冲突 |
| C9 | §23.7 conformance 增补测试（事件矩阵 key-set 冻结、时钟折叠策略） | §23.7 L879 起既有 conformance 补充框架（全事件矩阵 key-set 冻结白名单断言已列为必备项）；增补属 append-only 扩展，先例：issue #231/#238/#239 均按此模式追加 | 无冲突 |

**交叉 ADR 检查**：ADR 0011/0014（namespace 诊断变更日志）与复制 observer seam 为两个不同观测面（诊断日志 = producer→emitter 的语义 emission 流，emit 不 throw、调用点在 write sequencer slot 之外；observer = ws-replication 构造注入同步回调）——简报不触碰诊断日志，无交集无抵触。ADR 0012（实例身份/插件所有权）、0009（Registry/Lease）、0008（sequencer——事件发射点纪律反被其强化）、0001–0007（VFSL/求值/投影/持久化/校验）与本简报无交集。CONTEXT.md 全部词条无违反：简报零新词汇（chunked-update-* 四型属 protocol §23.1 事件词汇域，非 CONTEXT.md 词条域）。

## 3. 依赖评估

- **Blocked by #244（切片 3）**：CLOSED（ci-passed），经 PR #280 合并（commit `733b3a7`），且该 commit 为当前工作分支 `mabf/issue-245` 的**直接父提交**——**满足**。其交付面正是本简报的地基：中止矩阵全部接线行（含 shed/epoch-fence）、`chunked-update-aborted` 第 23 型与 busy 守卫计数不变量、SA7 动态断言——AC5「reason 闭集与切片 3 的全部中止路径一一对应」有完整对端可依。
- **#243（切片 2，端到端传输）**：CLOSED（PR #275，commit `e2178f3`，在分支历史）——transfer 状态机 + 发送侧记账锚（末 chunk noteUpdateSent/inFlight 注册末帧序）已就位，#245 三成功型事件挂点齐备。
- **#242（切片 1，codec + capability）**：CLOSED（PR #264）——wire 面 0x42 帧与 CAP_CHUNKED_UPDATE 协商冻结。
- **父 issue #233**：OPEN（enhancement 伞票，正常）；**父 PR #241**：OPEN——见 R25（同 #244 门禁 R9）。
- **运行基线**：`packages/ws-replication` 具备模块契约 AGENTS.md 与验证门；observer 判别联合（23 型）、隔离分发单点、testing surface（`@nomicore/ws-replication/testing`）在库；三成功型零实现（grep 全库仅 aborted 族命中）——与 protocol L725「不登记为已实现行为」的登记口径一致，无文档-行为漂移。

## 4. 就绪注意项（非阻塞，转交 SA1；编号接续 #244 三份门禁报告 R7–R19）

- **R20 · 「四个新增」实为 3 新增 + 1 已交付**：`chunked-update-aborted` 已由 #244 注册（protocol 第 23 型）并实现（types.ts/hub/peer + 六接线行 + 动态断言）。简报 AC5 措辞「与**切片 3** 的全部中止路径一一对应」自认切片 3 为对端——SA1 须把 aborted 的范围定为**校验/保持已冻结面**（键集、reason 六值闭集、每笔中止恰一事件不变量回归），不得重复注册、不得改动已冻结键集；新增实现面只有 sent/applied/acked 三型。
- **R21 · 既有族事件的改道（pre-authorized redirect）——本切片唯一可观测行为变化**：现状 chunked transfer 走普通族事件（末 chunk 出站发 `update-sent{bytes=总长}`；apply 成功发 `update-applied`；末帧 ACK 发 `update-acked`），#245 将三处改道至 chunked 族。改道由 ADR 0013 L90「第四形态」+ protocol L725「#245 计划项」预先授权，非静默语义漂移；但 SA1 须显式刻画改道前后差异，并保证**普通 UPDATE 帧的 update-sent/applied/acked 键集与发射时机逐字节不变**——append-only「只增不改」的边界恰好落在「哪类 apply 发哪型」，这是 SA2/SA7 复核的第一落点。
- **R22 · 键集边界：ADR 表 vs §23 结构信封/关联字段**：`side: ReplicationObserverSide` 是 seam 结构信封（22 型全员惯例；#244 设计复审 R12 已裁定第 23 型补 side 并落地）——三新类型应同样携带（连接域键集外、信封内）。ADR 0013 三型字段表**不含** `sequence`（#238 三事件面关联键）与四段差值字段，简报亦未要求——SA1 缺省按 ADR 表逐字冻结键集；若设计判断 chunked 族需要 sequence/stages 关联（与 #238 三事件面闭环对齐），属 append-only 键扩展，须显式设计裁决 + 协议 §23.1 登记，不得静默加键。
- **R23 · degraded × chunked 交叠欠定**：§23.5 判据「degraded，任意来源」胜出——chunked apply 落在 peer degraded 期时发 `degraded-bypass-applied` 还是 `chunked-update-applied`，ADR 0013 与简报均未明示。互斥规则第四形态的自然落位 = `chunked-update-applied`（UPDATE_CHUNK 且非 degraded），degraded 期维持 degraded-bypass 胜出——SA1 须显式裁决并把 §23.7 既有 degraded 互斥断言延伸到 chunked 构型。
- **R24 · 规范文档同步义务**：落地时须修订 protocol §23.1（事件词汇 23→26 型、三成功型登记并撤「计划项」措辞）、L727–729（apply 互斥规则三选一→四选一）、§23.7（conformance 增补）；ADR 0013「后果」+ docs/AGENTS.md 要求契约变更同步规范文档、不得虚构未实现行为——落地前对三新型维持「计划项」登记口径（同 L725 既有纪律）。
- **R25 · ADR 0013 状态与父 PR 未合并**：状态「提议」、PR #241 OPEN。按 SA8 基准规则其为现行约束（正文入 corpus、CONTEXT.md 并词、切片 1–3 已按其落地），不阻塞；仅提示总控：若 #241 后续发生方向性返工（尤其 observer seam 表），本门禁结论需复审。

## 5. 结论

**门禁通过（clear）**。issue #245 任务简报与 ADR 0013 Observer seam 节逐条同源（四型、字段、reason 闭集、safe-field、隔离纪律、时钟折叠全部逐字对应），与 ADR 0010 及其余 ADR/CONTEXT.md 零抵触；blocked-by #244 已满足且其交付面正是本切片地基；「四新增」中一型已交付属范围澄清（R20）而非矛盾，三成功型对普通族事件的改道为 ADR 预先授权（R21）。可进入 SA1 设计；R20–R23 为设计后复审（轻量）核对项，R24 为落地同步义务。

# SA8 冲突门禁报告 — issue #245（设计后复审：SA1 设计冲突复查）

- **dispatch**: sa-d619060b-05e7-4ace-8ee0-52eebdd93534（mabf-sa8 / conflict-gate / iteration 1）
- **审查对象**: SA1 设计 `wiki/raw/task_issue-245_design.md`（dispatch `sa-669d3109-…`，iteration 0）——
  issue #245「ws-replication：分块传输 observer 事件（issue #233 切片 4）」
- **门禁类型**: 设计后复审（轻量；SA1 产出 vs ADR 全集 + CONTEXT.md，按前置门禁 R20–R23 预登记核对项 +
  dispatch 指定四焦点：**声明改道 / 事件键集 / 互斥判别顺序 / 兼容边界**）
- **对照输入（实读）**: issue body（`wiki/raw/task_issue-245.md`，AC1–AC6；`## Comments` 空节——REST 快照 `[]`
  经 dispatch 复核，无 owner 评论要求需并入，与前置门禁 §1 / SA6 §2 一致）、SA6 契约
  （`wiki/raw/task_issue-245_sa6_contract.md`，approve；红灯文件 R1–R5/N1–N5）、SA8 前置门禁
  （`artifacts/sa8-conflict-gate-issue-245.md`，clear，R20–R25）、仓库契约（CONTEXT.md + `docs/adr/` 全集 14 篇；
  `docs/protocols/instance-replication-v1.md` §23 作 ADR 0013 引用之纪律载体与佐证，非独立阻塞基准）
- **裁决**: **通过（clear）——0 阻塞冲突 / 0 轻微冲突 / 3 条非阻塞就绪注意项（R26–R28）**

## 1. 冲突基准与效力判定（沿用前置门禁，本轮复核一致）

基准 = `CONTEXT.md` + `docs/adr/` 全集。本轮重新全库扫描 supersede/废止标记：命中均为 ADR 正文节内
历史修订记录（ADR 0006 §修订、0007「由 ADR 0008 部分取代（Runtime/open/read 条款）」、0008 取代关系节、
0010 issue #229 注记、0014 首切片范围句）——**无任何 ADR 级整体被取代，且全部命中位于 VFSL/Runtime/持久化/
停机域，与 #245 的复制 observer 域零交集**。ADR 0013 状态「提议」按前置门禁 §1 裁定维持现行约束
（正文入 corpus commit `164eee7`、CONTEXT.md 已并入「分块复制传输／UPDATE_CHUNK／CAP_CHUNKED_UPDATE」
三词条（本轮实测 L141–150 在库）、切片 1–3 已按其落地）；R25 条件项（父 PR #241 方向性返工则复审）继续有效。
ADR 0010 L167 区（实测）为 observer seam 架构权威：「复制插件提供结构化 observer seam 给日志/metrics/trace
Adapter，**不提供业务公共 update events**。最小观测面包括 … updates/bytes in/out、apply/ACK latency …」——
三新型属该观测面族的 transfer 级投影，ADR 0013 L83–94 append-only 扩展，未越「业务公共 update events」禁线。

## 2. 焦点一：声明改道（R21）——无冲突

设计声明（§1 目标 2、§8.4 改道边界总表、§8.5 数据流）：三处结算点改道——末 chunk 出站 sent、组装 apply
成功 applied、末 chunk ACK 结算 acked，从普通族改道至 chunked 族；普通 UPDATE 帧路径普通族三事件键集与
发射时机逐字节不变。逐项对基线核验：

| 改道点 | 基线依据（实测） | 设计落点 | 裁决 |
|---|---|---|---|
| applied 改道（普通族归零） | ADR 0013 L90「apply 成功路径互斥规则**第四形态**」+ 协议 L727–729 现行三选一（每笔成功 apply 恰一事件）——四形态扩展**结构性蕴含**分块 apply 不再发 `update-applied`（否则恰一不变量破产） | §8.3 第 5 参判别 + §8.4 表「update-applied 不再发（改道）」；SA6 R2 断言增量归零 | 无冲突（结构性蕴含，非解释性扩展） |
| sent 改道 | ADR L89「transfer 完成出站时一次，非逐 chunk」——transfer 级恰一语义 + 末 chunk 帧序单点记账（`update-channel.ts:402` 注释「#245 归 chunked 事件」为 #243 预留锚，实测在库）；若保留逐帧 `update-sent` 则同一结算双计 | §8.2 `chunked` 组在场判别；SA6 R1 断言窗口内 update-sent 归零 | 无冲突（前置门禁 C2/R21 预先授权的相容读法；见 R28 留痕建议） |
| acked 改道 | ADR L46「ACK 复用既有 UPDATE_ACK：ackedSequence = 末 chunk 帧序。不新增 ACK 消息」——末帧序单 ACK 簿记（实测 `onAck` 由 inFlight 条目驱动） | §8.2 inFlight 条目 `chunked: true` 标记透传；零新 ACK 消息（非目标明示） | 无冲突 |
| 普通 UPDATE 帧族不变 | §23.1 append-only「只增不改」边界；SA6 N1 | Option A 结构性保持：普通路径回调不携带 `chunked` 组 → 既有发射体零触碰（§8.2/§8.3「既有发射体逐字节不变」锚 + N1 逐字键集断言）；`sendAndRegister` 路径（`update-channel.ts:325`）不在改动面 | 无冲突 |
| 改道边界范围 | 前置门禁 R21：「SA1 须显式刻画改道前后差异，并保证普通 UPDATE 帧的 … 逐字节不变」 | §8.4 总表逐结算点列「来源判据 / 事件（恰一）/ 普通族同点行为」+ §8.5「wire 字节与持久化路径零变化（N3 kind#seq 摘要全等即证）」 | 无冲突（刻画义务已履行；边界未越「哪类 apply/结算发哪型」） |

**代码锚点抽查（改道可行性事实）**：`applyRemoteUpdate` 调用点双侧各恰三处（hub 661/749/1092、peer
637/731/1308——B9 穷举与实测一致）；`onAck` zombie 路径（`update-channel.ts:202-205`）不发事件——弃置
transfer 零 acked，与 aborted 零成功型不变量一致；发射位置三处均在记账落定后（DD6 与实测代码序一致：
sent 于 `inFlight.set` 后、`armAckTimer` 前；acked 于 `inFlight.delete` + timer 重挂后、`requestDataDrain`
前）——§23.4「决策落定后发射」纪律满足。

## 3. 焦点二：事件键集（DD1）——无冲突，逐字核对通过

设计 §8.1 三型键集 vs ADR 0013 L89–91 逐字段比对（`type` = 判别联合判别子、`side` = §23 结构信封）：

| type | 设计键集 | ADR 表域键集（逐字） | 差集 |
|---|---|---|---|
| `chunked-update-sent` | type、side、connectionId?、namespaceId、transferId、chunkCount、totalBytes | connectionId?、namespaceId、transferId、chunkCount、totalBytes | 零（+判别子/信封） |
| `chunked-update-applied` | type、side、connectionId?、namespaceId、bytes、chunkCount、applyLatencyMs? | connectionId?、namespaceId、bytes、chunkCount、applyLatencyMs? | 零 |
| `chunked-update-acked` | type、side、connectionId?、namespaceId、bytes、ackLatencyMs? | connectionId?、namespaceId、bytes、ackLatencyMs? | 零 |

- **side 信封**：实测 `types.ts` 判别联合 23 成员**全部**携带 `readonly side: ReplicationObserverSide`
  （23/23 命中）——「全员惯例」主张成立；第 23 型（#244 R12 裁决）先例在库。R22 裁决「三新类型应同样
  携带」已落实。
- **表外键排除**（sequence／四段差值／效果组／sendQueueMs／applied·acked 上的 transferId）：= 前置门禁
  R22 缺省裁决（ADR 表逐字冻结）。佐证实测：`sequence` 确为 #238 四事件面关联键（observer-red ALLOWED_KEYS
  中 update-sent/applied/acked 与 degraded-bypass-applied 键集均含 sequence）；ADR 0013 三型表不含——设计
  排除正确。**扩展路径已按 R22 要求显式登记**（DD1「未选择方案」+ §13 残余问题 1：显式设计裁决 + §23.1
  登记 + SA6 契约修订 dispatch）——未静默加键。
- **sent 恒无时延键**：ADR L89 表无 latency 字段；SA6 R5 断言 exact-keyset——设计 §8.1 注释明示「clock 在场
  也不加」。一致。
- **latency 条件附着**（字段缺失非 undefined 值）与 `cidField`（connectionId 缺省 = 整键缺省）：§23.4 L811
  纪律；设计 §8.1/§8.2 条件展开 + 实测 `observer.ts:76-80` `cidField` 在库。一致。
- **类型面同步义务**：`ws-replication-api.test-d.ts` 联合枚举现状 23 成员（实测，含第 23 型结构展开）——
  设计 §8.6 追加三成员义务登记正确，缺同步即编译红（自 enforcing）。
- **aborted 保持面（DD0/R20）**：实测第 23 型成员 = type、side、namespaceId、transferId、reason（六值闭集）、
  receivedChunks、receivedBytes——无 connectionId（ADR L92 逐字）；设计 ALLOW LIST 不含其生产发射面，
  「不重复注册、不改键集」成立。范围 = 校验/保持（N4 回归锚），未越界。

## 4. 焦点三：互斥判别顺序（DD2）——无冲突

设计全序：peer = **degraded → isStep2 → chunked → update**；hub = isStep2 → chunked → update（无 degraded 分支）。

- **degraded 胜出（任意来源，含 chunked）**：协议 L729 现行「`degraded-bypass-applied`（degraded，任意来源）」
  + §23.5 判据（实测 L852–864：判别为 apply 完成后读投影；**peer 专属**——「hub 结构性不可能 bypass，故事件
  side:'peer' 专属」）——设计 DD2 裁决 = 前置门禁 R23 自然落位（「chunked-update-applied 仅 UPDATE_CHUNK
  来源 ∧ 非 degraded」），既未让 chunked 抢先 degraded（N5 恰一断言锚），也未改 degraded-bypass 键集/时机
  （degraded 窗口分块 apply 维持 `degraded-bypass-applied{bytes=总长, sequence=末 chunk 帧序}`——该键集含
  sequence 属 #238 既有追加，零改动主张与现行行为一致）。
- **四形态对三形态的保真扩展**：现行三选一谓词（update = UPDATE 且非 degraded；sync-diff = Step2 且非
  degraded；degraded = 任意来源）在四选一下**每个既有谓词出口不变**——唯一变化 = 「UPDATE 且非 degraded」
  细分为「chunked 来源 → 第四形态／其余 → update-applied」，即 ADR L90 预授权的「第四形态」本体。协议
  L727–729 三选一→四选一修订已按 R24 登记为落地同步义务（§8.6），落地前文档-行为登记口径一致（L725
  「计划项」措辞仍在，实测在库）。
- **hub 无 degraded 分支**：实测 `hub-namespace.ts:1167` 注释「HB9'：每笔成功 apply 恰一事件（hub 无
  degraded 判别——结构性不可 bypass）」——设计 hub 序与代码事实、§23.5 peer 专属裁定三方一致。
- **isStep2 ∧ chunked 结构性不可达**：B9 调用点穷举实测成立（applyStep2 仅经 SYNC_STEP2 控制帧入口传
  isStep2=true；assembler complete 调用点字面传 false）——两入口不相交，「无需运行时防御分支」主张与
  结构事实一致，不构成对互斥规则的弱化。
- **计数不变量汇总**（§8.4）：每笔完成 transfer → sent/applied/acked 各恰一；每笔成功 apply → 四形态恰一；
  每笔 busy→aborted 边沿 → aborted 恰一；中止与成功三型互斥——与 ADR L46 单 ACK 语义、协议 §23.1 第 23 型
  登记不变量、#244 busy 守卫交付面逐条对齐，无重复计数口径。

## 5. 焦点四：兼容边界——无冲突

| 边界 | 设计声明 | 基线/实测核验 | 裁决 |
|---|---|---|---|
| 普通 UPDATE 帧族逐字节不变 | Option A：普通路径回调无 `chunked` 组 → 事件逐字节不变 | 结构性成立；SA6 N1 = 逐字键集 + sequence 闭环 + 零 chunked 族 + safe-field 深扫行为锁 | 无冲突 |
| append-only 词表 23→26 | 判别联合尾部追加第 24–26 型 | §23.1 append-only 条款；#244（23 型）、#256（22 型）、#238（21 型）、#231（20 型）先例链；api.test-d 枚举同步义务登记 | 无冲突 |
| 冻结面零触碰 | aborted 生产面零改动（DD0） | 实测第 23 型成员形状 = ADR L92 逐字；ALLOW LIST 无其发射面 | 无冲突 |
| 公共 API 面 | index.ts/testing.ts 零新符号 | 实测：`ReplicationObserverEvent`/`ReplicationObserverSide` 既有导出（index.ts L59/61）；`applyRemoteUpdate`/`UpdateChannelHost`/`UpdateChunkAcceptResult` **未导出**（内部 seam，grep 全库仅 testing.ts 内部绑定）——DD3/DD4/DD5 均内部接口 | 无冲突 |
| 外部 observer 消费方 | 26 型 = switch/映射新增分支，非破坏 | §23.1 append-only 纪律 + ADR 0010 L167 seam 族（updates/bytes/latency 观测面内） | 无冲突 |
| wire / 持久化 / ADR 文本 | 零变化（非目标 + DENY） | DENY LIST 覆盖 replication-protocol、连接状态机、ADR 全集；§8.5 三 hop 均进程内同步投影 | 无冲突 |
| CONTEXT.md 词汇 | 零新词条、零词条改动 | 三新型属 protocol §23.1 事件词汇域（前置门禁 §2 裁定）；transferId/chunkCount/totalBytes 已由「分块复制传输」/「UPDATE_CHUNK」词条覆盖（实测 L141–150）；§9.4 聚合域 (transferId, connectionId) + teardown 归 1 遵守词条作用域与 Avoid 项（不当跨连接持久标识） | 无冲突 |
| 观测面隔离 | 诊断日志（ADR 0011/0014）零交集 | DENY LIST 明示；两观测面判别同前置门禁交叉检查 | 无冲突 |
| ADR 0013 L110 刻画文件保护 | 「不改刻画文件」 | `ws-replication-issue233-repro.test.ts` **不在 ALLOW LIST**（默认禁改）；K1（#243 实现轮收敛绿灯，非刻画文件）改写 = SA6 §10 预先授权的存量翻转 | 无冲突 |
| 验证门 | §12：焦点套件 → 全包 → 包 tsc → 根 typecheck/test | `packages/ws-replication/AGENTS.md` 验证门实测一致 | 无冲突 |

**S1 形状兼容主张复核**（DD3 理由 c）：实测 `ws-replication-issue243-sa7-dynamic.test.ts` fake host 的
`noteUpdateSent`/`onUpdateAcked` 仅复制 `{sequence, bytes}`/`{bytes, sequence}` 且断言为 toEqual 精确形状——
信息对象追加可选 `chunked` 组不改日志条目形状，回调次数不变（末 chunk 恰一结算保持）——「S1 零改动保持绿」
主张成立。

**Issue body / SA6 契约 / 前置门禁三方闭合**：AC1→DD1/§8.1、AC2→§9.1（零新机制，经 `dispatchReplicationObserver`
单点——实测 `observer.ts:34-44` 在库）、AC3→§9.2（B6 连接层门控 + N2 全生命周期零时钟断言）、AC4→DD2/§8.4、
AC5→DD0/N4（保持面）、AC6→§8.6——六条 AC 无遗漏无弱化；SA6 R1–R5/N1–N5 逐条有设计响应（设计 §5 表）；
前置门禁 R20–R23 复核项全部落实且与本轮独立核验一致，R24/R25 分类为「登记义务/条件项」正确。owner 评论
要求 = 零（REST `[]`，三方一致），无需并入项。

## 6. 就绪注意项（非阻塞；编号接续 R20–R25）

- **R26 · §23.7 矩阵 chunked 腿的 aborted 暴露面**：`ALLOWED_KEYS` 现状 22 行（实测）——第 23 型
  `chunked-update-aborted` **不在** §23.7 正典矩阵白名单（协议 §23.1 登记明文将其动态断言「归 SA7 动态
  验证面」，#244 先例，非缺口）；但 `assertSafe` 对无白名单行的观测类型**直接红**（实测
  `expect(allowed, …无白名单).toBeDefined()`）。设计 §8.6(c) 计划「全矩阵场景加一条协商分块写腿」而只追加
  三行白名单 + transferId/chunkCount/totalBytes 数值键——若 chunked 写腿未在任何收口相位（矩阵含 GOAWAY
  注入、wire close 1006、`peer.stop()`）前收敛，在途 transfer 中止将观测到 aborted → conformance 文件以
  「无白名单」红。**非契约冲突**（登记口径自洽），转交 SA3：chunked 腿须置于收口前收敛，或同步补 aborted
  白名单行 + receivedChunks/receivedBytes 数值键——设计自身「白名单行不得为死行」原则对称适用于
  「观测集 ⊆ 白名单覆盖」。
- **R27 · DD3 末 chunk 分支 `sendQueueMs` 可选删除**：设计许可「保留或删除（零可观测差异）」。复核成立
  （该值仅被改道后的事件消费，而 chunked-update-sent 恒无此键；普通路径 `sendAndRegister`（L325）自有
  计算），但二选一应在实现轮定死并保持 N1/N3 逐字节等价锚绿——避免 SA4/SA7 复核时将保留态误读为
  未清理、删除态误读为行为漂移。
- **R28 · 改道读法的规范留痕（R24 增强项）**：sent/acked 的「分块窗口普通族归零」为前置门禁 C2–C4/R21
  预先授权 + SA6 契约冻结的相容读法，但 ADR 0013 无单句明文（applied 为四形态结构性蕴含）。落地轮
  R24 修订协议 §23.1 时，三新行登记宜显式携带「分块 transfer 窗口内对应普通族事件归零（改道）」措辞，
  使 append-only「只增不改」边界句落入规范文档而非仅存于设计/契约——与设计 §8.6 计划相容的措辞义务，
  非范围变更。

## 7. 结论

**设计后复审通过（clear）**。SA1 设计（iteration 0）与冲突基线（ADR 全集 + CONTEXT.md）**零冲突**：
四焦点逐项闭合——声明改道（三结算点改道 = ADR 0013 L46/L89–91 + 前置门禁 R21 预先授权，applied 为四形态
结构性蕴含，普通帧族结构性逐字节保持且改道前后差异已显式刻画）；事件键集（三型域键集与 ADR L89–91
**逐字零差集**，side 信封 23/23 全员惯例实测成立，表外键排除 = R22 缺省裁决且扩展路径已显式登记）；
互斥判别顺序（degraded 任意来源胜出 = R23 自然落位且与 §23.5 peer 专属判据/hub 结构性不可 bypass 代码
注释一致，四形态对三形态为保真扩展，isStep2 ∧ chunked 结构性不可达经调用点穷举证实）；兼容边界
（append-only 23→26、aborted 冻结面零触碰、公共 API 零新符号、wire/持久化/ADR 文本零变化、CONTEXT.md
词汇域零越界、刻画文件默认禁改）。Issue body 六条 AC、SA6 契约 R1–R5/N1–N5、前置门禁 R20–R25 三方逐点
闭合无弱化。R26–R28 为非阻塞就绪注意项（R26 归 SA3 实现纪律，R27 归实现轮二选一定死，R28 为 R24 落地
措辞义务）。

**后续实现轮（SA3 落地 + R24 规范同步）不需要新的冲突复查**（`requiresConflictRecheck: false`）：全部
剩余工作落在已核对的未冻结实现语义（DD3–DD6 内部 seam）、已路由的实现义务（R24 文档同步、R26/R27 实现
纪律）与既有条件项内；R25 触发条件照旧——父 PR #241 若发生方向性返工（尤其 ADR 0013 observer seam 表），
本复审结论连同前置门禁一并复审。

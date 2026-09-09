# SA1 设计 — issue #245：ws-replication 分块传输 observer 事件（issue #233 切片 4）

- Dispatch：`sa-15652a57-b845-4e89-b4ef-f989a5558441`（mabf-sa1 / design / iteration 1——按 SA2 评审 F1 修订）
- 前版：`sa-669d3109-44be-4cbf-ad5f-61bcb1a4336a`（iteration 0；已经 SA8 设计后复审 clear 与 SA2 设计攻击
  评审 reject——唯一阻断项 F1 已由本版落实，逐条映射见 §14）
- 对象：issue #245「ws-replication：分块传输 observer 事件（issue #233 切片 4）」
- 工作区：worktree `nomicore-fix-issue-245`，分支 `mabf/issue-245`，HEAD `733b3a7`
- 输入（实读）：
  - Host 简报 `wiki/raw/task_issue-245.md`（issue body AC1–AC6；`## Comments` 空节——REST 快照 `[]` 复核一致，
    零 owner 评论要求需并入）
  - SA2 设计攻击评审 `wiki/raw/task_issue-245_sa2_review.md`（reject；1 × MAJOR F1 + 非阻塞观察 N-O1–N-O5——本版修订输入）
  - SA6 验收契约 `wiki/raw/task_issue-245_sa6_contract.md`（approve；红灯契约
    `packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts`，10 用例 R1–R5/N1–N5）
  - SA8 前置门禁 `artifacts/sa8-conflict-gate-issue-245.md`（clear；R20–R25 就绪注意项）
  - SA8 设计后复审 `artifacts/sa8-conflict-gate-issue-245-design-recheck.md`（clear；R26–R28 非阻塞注意项——§6 承接）
  - 源码：`packages/ws-replication/src/{types,observer,update-channel,update-transfer,hub-namespace,peer-namespace,hub-connection,peer-connection}.ts`
  - 规范：ADR 0013（L83–94 observer seam 表）、ADR 0010、`docs/protocols/instance-replication-v1.md` §23.1/§23.3/§23.4/§23.7
  - 既有测试：`ws-replication-observer-red.test.ts`（§23.7 全事件矩阵 + T12 时钟两用例 L1485/L1517 实读复核）、
    `ws-replication-issue245-ac-red.test.ts`（冻结键集 L174–185 + chunked 构型 L77–98/L396）、
    `ws-replication-issue243-chunked-live.test.ts`（K1）、`ws-replication-issue243-sa7-dynamic.test.ts`（S1）、
    #244 两套件、`ws-replication-api.test-d.ts`
- 说明：`wiki/raw/task_issue-245_relevant_decisions.md` / `_conflict_report.md` 不存在（SA2 评审 §1 同认）；等价
  SA8 产物 = `artifacts/sa8-conflict-gate-issue-245.md` + `artifacts/sa8-conflict-gate-issue-245-design-recheck.md`
  （Host 落盘的前置门禁与设计后复审，SA6 契约 §1 同源引用），按下文 §6 承接。

---

## 1. 任务类型、目标与非目标

**任务类型：Feature（观测面能力缺口）**。分块传输（#242 codec / #243 传输 / #244 中止矩阵）已交付，但其
成功三面对观测面不可按 transfer 区分——成功路径仍发普通族事件，`chunked-update-sent/applied/acked`
三型零注册零实现（SA6 §8 能力缺口链；协议 §23.1 L725「计划项」登记口径）。

**目标**

1. observer seam 判别联合 append-only 新增第 24–26 型：`chunked-update-sent` / `chunked-update-applied` /
   `chunked-update-acked`，键集逐字 = ADR 0013 L89–91 域键集 + §23 结构信封（`type`/`side`，
   `connectionId?` 握手后在场）。
2. 三处改道（SA8 R21 预先授权，本切片唯一可观测行为变化）：分块 transfer 的
   末 chunk 出站 sent、组装 apply 成功 applied、末 chunk ACK 结算 acked，从普通族改道至 chunked 族；
   普通 UPDATE 帧路径的普通族三事件键集与发射时机逐字节不变。
3. apply 成功路径互斥规则扩展为四形态（每笔成功 apply 恰一事件）。
4. §23 纪律全量沿用：safe-field 白名单、throw 隔离、决策落定后发射、无 observer 零事件零采样、
   时钟折叠两态（无 clock 字段缺失 / 有 clock ≥ 0）。
5. 规范文档同步（SA8 R24）：协议 §23.1 词汇 23→26 型、L727–729 互斥三选一→四选一、§23.7 增补。
6. §23.7 conformance 增补为**必交付验收面**（AC6 两个具名子项，F1 修订）：事件矩阵 chunked 腿
   （key-set 冻结）与 T12 时钟折叠两态分块腿（注入 clock 在场 ≥ 0 / 无 clock 整键缺失）——见 §8.6(c)(d)、
   §8.6.1；均不得降级为非阻塞 follow-up。

**非目标**

- 零 wire 变化：不改 `UPDATE_CHUNK` 帧格式、codec、协商位、ACK 消息与 ackedSequence 语义
  （ADR 0013 L46/AC：单 ACK、末 chunk 帧序——完全复用）。
- 不重新实现 `chunked-update-aborted`（SA8 R20：#244 已交付，本切片范围 = 保持冻结面）。
- 不为三新型追加 ADR 表外键（无 `sequence`/四段差值/效果组/`transferId`-on-applied——见 §7 DD1 裁决）。
- 不改分块几何、发送状态机、窗口/背压记账、恢复与中止路径。
- 不触碰 ADR 文本（ADR 0013 状态「提议」按 R25 维持，观察父 PR #241）。

## 2. 当前行为与证据锚点

| # | 事实 | 锚点 |
|---|---|---|
| B1 | 发送侧：仅末 chunk 出站时 `noteUpdateSent{sequence:末 chunk 帧序, bytes:totalBytes}` 恰一；中间 chunk 零发射（注释明文「#245 归 chunked 事件」） | `update-channel.ts:405-450`（L402、L440-444）；facet 发射 `hub-namespace.ts:1072-1085` / `peer-namespace.ts:1287-1300`（`update-sent`） |
| B2 | 接收侧：组装收齐 `complete` → `applyRemoteUpdate(result.bytes, sequence)`（isStep2=false，无分块判别）→ 成功发 `update-applied`（peer 先判 degraded） | `hub-namespace.ts:744-758, 1115-1193`；`peer-namespace.ts:726-740, 1332-1427`（degraded 分支 L1387-1398） |
| B3 | ACK：`UpdateChannel.onAck` 由 inFlight 记账（末 chunk 条目 bytes=totalBytes, sentAt）驱动 `onUpdateAcked{bytes, latencyMs?, sequence}` → facet 发 `update-acked` | `update-channel.ts:178-207`；`hub-namespace.ts:1056-1069` / `peer-namespace.ts:1270-1283` |
| B4 | 三成功型零注册：判别联合 23 型仅含第 23 型 `chunked-update-aborted`（#244 交付：types L664-684、双侧发射 L786-804/L769-787、busy 守卫、六 reason 闭集） | `types.ts:661-684`；`hub-namespace.ts:786-804`；`peer-namespace.ts:769-787`；协议 §23.1 L725 |
| B5 | assembler `complete` 结果只携带 `bytes`（`completeIfExact` 先 reset）；进度快照仅 aborted 路径使用 | `update-transfer.ts:164-172, 88-99` |
| B6 | 时钟采样 observer 门控在连接层（无 observer → `host.now` 恒 undefined → 通道/facet 全部 `safeNow` 读数零时钟调用） | `hub-connection.ts:543`；`peer-connection.ts:166` |
| B7 | 隔离分发单点 + 条件附着（`cidField`：connectionId 缺省 = 整键缺省） | `observer.ts:34-44, 76-80` |
| B8 | §23.7 全事件矩阵白名单现 22 行（ALLOWED_KEYS），矩阵场景无 chunked 腿；api 型断言枚举全联合成员 | `ws-replication-observer-red.test.ts:1145-1176, 1270-1303`；`ws-replication-api.test-d.ts:240-267` |
| B9 | `applyRemoteUpdate` 调用方每侧恰三处：onUpdate（plain）/ handleAssemblerResult（chunk 组装）/ applyStep2（isStep2） | `hub-namespace.ts:661, 749, 1092`；`peer-namespace.ts:637, 731, 1308` |

## 3. 能力缺口（承接 SA6 §8，不虚构 Bug 根因）

一笔**完成的**协商分块 transfer（3 chunk ≈20,029B）现行可观测事件面 = 普通族三事件
（sent{末序,总长}/applied/acked{bytes=总长}），无 transferId/chunkCount 词表、无 transfer 级观测语义。
直接缺口：三成功型事件类型零注册（判别联合 23 型无成员）+ 发射点零实现——末 chunk 出站记账
`noteUpdateSent` 无 transfer 上下文可用、组装 apply 成功发射点无「分块来源」判别、ACK 结算同构。
目标语义已由 ADR 0013 L89–91 冻结（SA6 红灯 R1–R5 逐条对齐，SA8 C1–C9 三方一致）。

## 4. Owner 要求落实

Issue comment REST 快照 = `[]`（SA8 门禁 §1 经 `GET /issues/245/comments` 复核一致；SA6 契约 §2 同）。
零 owner 评论要求/豁免需要并入——要求源 = issue body 六条 Acceptance criteria + ADR 0013/§23 冻结面。

| 来源 | Updated at | Requirement | 设计章节 |
|---|---|---|---|
| issue body（#245，2026-09-09T15:51:55Z） | — | AC1 四型键集冻结 + safe-field 深扫 | §7 DD1、§8.1、§12 |
| 同上 | — | AC2 throw 隔离逐字节等价 | §9.1（沿用，零新机制） |
| 同上 | — | AC3 无 observer 零事件/零投影/零时钟；latency 两态 | §9.2（B6 结构性门控） |
| 同上 | — | AC4 互斥第四形态（每笔成功 apply 恰一） | §7 DD2、§8.4 |
| 同上 | — | AC5 aborted reason 闭集/计数不变量（保持面） | §7 DD0、§12 N4 |
| 同上 | — | AC6 §23.7 conformance 增补——「事件矩阵 key-set 冻结」与「时钟折叠策略」两子项均必交付且可执行 | §8.6(c)（矩阵腿）+ §8.6.1(d-i)/(d-ii)（T12 两态分块腿）+ §11/§12（范围与证据行） |

## 5. 复现和根因承接（SA6 契约）

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 红 R1：chunk0/chunk1 出站后零 chunked 事件（绿半边）+ 末 chunk 收敛后 `chunked-update-sent` 必须恰一、SENT_KEYS 逐字、字段=wire 申报、普通族归零——现 0 | SA6 §5/§13；契约文件 R1 | §8.2：末 chunk 结算点改道——`noteUpdateSent` 携带 `chunked{transferId,chunkCount}` 组，facet 分支发 `chunked-update-sent`；中间 chunk 保持零通知（B1 不变） |
| 红 R2：分块 apply 必须 `chunked-update-applied` 恰一（bytes=totalBytes、chunkCount=wire）、`update-applied` 增量归零——现 0/仍 1 | SA6 §5；契约 R2 | §8.3：assembler `complete` 携带 `chunkCount` → `applyRemoteUpdate` 第 5 参 `chunked` 判别 → 非 Step2 ∧ 非 degraded 发第四形态 |
| 红 R3：`chunked-update-acked` 恰一（bytes=total）、`update-acked` 归零、sent 先于 acked | SA6 §5；契约 R3 | §8.2：inFlight 条目 `chunked` 标记 → `onUpdateAcked` 分支；发射位置不变（sent=末 chunk 出站时刻 < acked=ACK 帧处理时刻，同侧结构性有序） |
| 红 R4：hub→peer 方向镜像 + side 双侧 | SA6 §5；契约 R4 | §8.3/§8.5：hub/peer 孪生发射点双侧对称落地（镜像防单侧漏网） |
| 红 R5：clock 在场 applied.applyLatencyMs / acked.ackLatencyMs ≥ 0；sent 恒无 latency 键 | SA6 §5；契约 R5 | §8.1（键集不含 sent latency）+ §8.3/§8.4（t0/t1、sentAt 既有采样点复用） |
| 绿 N1：限内 UPDATE 普通族三事件键集逐字不变、零 chunked 族、safe-field 深扫 | 契约 N1 | §7 DD3（Option A：普通路径回调无 `chunked` 组 → 事件逐字节不变，结构性保持） |
| 绿 N2：无 observer 零时钟调用（含收口）+ 收敛 + dirty 恰一 | 契约 N2 | §9.2：全部新读数经既有 observer 门控采样点（B6），零新增无门控读数 |
| 绿 N3：每事件必 throw 与无 observer 基线 wire kind#seq/终态/内容/结算全等 | 契约 N3 | §9.1：发射仍经 `host.emitObserver` → `dispatchReplicationObserver` 单点隔离 |
| 绿 N4：aborted 键集/六 reason/恰一回归（#244 保持面） | 契约 N4 | §7 DD0：aborted 生产面零改动 |
| 绿 N5：degraded × chunked 互斥单事件（现 = degraded-bypass-applied） | 契约 N5 | §7 DD2：degraded 判别先于 chunked 判别（裁决=SA8 自然落位） |
| 预期红翻转存量：#243 K1 三普通族断言、observer-red 矩阵加行、api 型断言 | SA6 §10/§15 | §8.6、§11（实现轮同步更新清单） |

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| R20 「四新增」= 3 新增 + 1 已交付（aborted 范围 = 校验/保持冻结面） | §7 DD0、§12（N4 回归锚） | aborted 生产代码零触碰；不重复注册、不改键集；新增面仅 sent/applied/acked | 是（轻量核对：范围未越界） |
| R21 既有族改道 = 唯一可观测行为变化；普通 UPDATE 帧族逐字节不变；显式刻画改道前后差异 | §8.5（改道边界表）、§12（N1） | 改道判据 = 「该结算是否来自在途 chunked transfer」（发送/ACK）与「该 apply 是否来自 assembler complete 且非 Step2、非 degraded」（接收）；普通路径回调形状不变 | 是（轻量核对：append-only 边界） |
| R22 键集边界：缺省按 ADR 表逐字冻结；扩展须显式裁决 | §7 DD1 | 裁决 = ADR 逐字（无 sequence/stages/effect；applied/acked 无 transferId；sent 恒无 latency 键）；扩展路径记录为 follow-up | 是（轻量核对：键集裁决） |
| R23 degraded × chunked 欠定，须显式裁决 + §23.7 断言延伸 | §7 DD2、§8.4、§12（N5） | 裁决 = degraded 胜出（`chunked-update-applied` 仅「UPDATE_CHUNK 来源 ∧ 非 degraded」）；§23.7 增补含 degraded×chunked 互斥断言（N5 为可执行锚） | 是（轻量核对：裁决一致性） |
| R24 规范文档同步义务（落地轮） | §8.6、§11 | 协议 §23.1（23→26、撤「计划项」措辞、aborted 行尾句同步清理）、L727–729 四选一、§23.7 增补；与实现同变更落地（不得虚构未实现行为） | 否（登记义务，非冲突） |
| R25 ADR 0013「提议」+ 父 PR #241 OPEN | §13 | 非阻塞；本设计完全在 ADR 0013 冻结面内实现，不改 ADR 文本；若 #241 方向性返工（尤其 observer seam 表）→ 复审本设计 | 否（条件项，已记录触发条件） |
| 复审 R26 矩阵 chunked 腿的 aborted 暴露面（白名单 22 行不含第 23 型；`assertSafe` L1180-1181 对无白名单类型直接红） | §8.6(c) 备注 | chunked 腿置于收口相位（GOAWAY 注入/wire close 1006/`peer.stop()`）**之前**收敛；若实现确需收口后在途 transfer 中止被观测，须同步补 aborted 白名单行 + `receivedChunks`/`receivedBytes` 数值键（「观测集 ⊆ 白名单覆盖」与「白名单行不得为死行」对称） | 否（SA3 实现纪律；失败形态为响亮红，非静默漂移） |
| 复审 R27 末 chunk 分支 `sendQueueMs` 保留/删除二选一 | §7 DD3 | 实现轮定死（两形态均保持 N1/N3 逐字节等价锚绿）；避免 SA4/SA7 复读歧义 | 否（实现轮决策，非设计面变化） |
| 复审 R28 §23.1 三新行登记携带改道归零措辞 | §8.6 协议行（R24 增强） | 落地轮修订 §23.1 时，三新行显式携带「分块 transfer 窗口内对应普通族事件归零（改道）」措辞，使 append-only 边界句进入规范文档 | 否（措辞义务，非范围变更） |

## 7. 设计决策与主要备选方案

### DD0 · aborted = 保持面（R20）

`chunked-update-aborted` 的类型注册（types.ts L664-684）、双侧发射点、busy 守卫计数不变量、六 reason
接线全部零改动。本切片对 aborted 的全部工作 = 不碰 + 由契约 N4（及 #244 既有套件）回归守护。
中止路径与成功路径互斥（中止 transfer 永不到达末 chunk 出站/apply/ACK——SA6 N4 已断言零成功型事件），
成功三型落地不改变该不变量。

### DD1 · 键集 = ADR 0013 L89–91 逐字 + §23 信封（R22 裁决）

**裁决**：三新型域键集逐字取 ADR 表，不加任何表外键：

| type | 键集（exact；`?` = 条件在场） | 依据 |
|---|---|---|
| `chunked-update-sent` | `type`、`side`、`connectionId?`、`namespaceId`、`transferId`、`chunkCount`、`totalBytes` | ADR L89 + §23 信封（side 为 22 型全员惯例，#244 R12 先例；connectionId 握手后在场——分块结构性仅在握手后） |
| `chunked-update-applied` | `type`、`side`、`connectionId?`、`namespaceId`、`bytes`、`chunkCount`、`applyLatencyMs?` | ADR L90 |
| `chunked-update-acked` | `type`、`side`、`connectionId?`、`namespaceId`、`bytes`、`ackLatencyMs?` | ADR L91 |

明确排除（并写入实现注释）：`sequence`（#238 三事件面关联键——普通族专属）、四段差值
（`queueWaitMs/protectedCheckMs/liveApplyMs/dirtyNotifyMs`）、`sendQueueMs`、效果字段组
（#239 sync 专属）、applied/acked 上的 `transferId`。`chunked-update-sent` 恒无任何时延/差值键
（clock 在场也不加——R5 断言 exact-keyset）。

**理由**：(a) ADR 0013 表自述「键集冻结」；(b) 已批准的 SA6 契约以本地字面量
`SENT_KEYS/APPLIED_KEYS/ACKED_KEYS` 做 exact-keyset 断言——加键即红（分歧信号）；(c) chunked 族的
关联需求由 wire 层满足：`UPDATE_CHUNK` 帧自带 transferId/chunkCount/totalBytes，`chunked-update-sent`
与 `chunked-update-aborted` 携带 transferId，跨侧关联经 wire 序 + connectionId 可达；(d) 最小变更。
**未选择方案**：为对齐 #238 三事件面闭环而追加 `sequence`/四段差值——属 append-only 键扩展，
须显式设计裁决 + 协议 §23.1 登记 + SA6 契约修订 dispatch（SA6 §15 已列路径）；本设计不做，
记录为 follow-up（§13，明确非本任务必要条件）。

### DD2 · degraded 判别胜出（R23 裁决）

互斥规则第四形态的落位：`chunked-update-applied` ⇔ 「apply 来源 = UPDATE_CHUNK 组装收齐」∧
「非 Step2」∧「非 degraded」。peer 侧判别顺序（全序，无交叠）：

```
每笔成功 apply（observer 在场时）恰一事件：
  degraded(degradedBypassActive()) → degraded-bypass-applied      （任意来源，含 chunked——键集/时机不变）
  else isStep2                      → sync-diff-applied            （结构性不含 chunked 来源，见下）
  else chunked                      → chunked-update-applied       （第四形态，本切片新增）
  else                              → update-applied
```

hub 侧同构但无 degraded 分支（`hub-namespace.ts:1167` 注释明证——hub 结构性不可 bypass）。
`isStep2 ∧ chunked` 结构性不可达：Step2 diff 经 `SYNC_STEP2` 控制帧直达 `applyStep2`，assembler 只收
`UPDATE_CHUNK` 数据帧——两入口不相交（B9 调用点穷举），无需运行时防御分支。
degraded 窗口的 chunked apply 维持 `degraded-bypass-applied`（bytes=totalBytes、sequence=末 chunk 帧序
——现行行为已如此，零改动；N5 断言该形状）。

### DD3 · 通道宿主 seam = 既有回调上的条件字段组（Option A）

**选定**：不新增宿主回调；在既有 `UpdateChannelHost` 回调信息上追加可选 `chunked` 组：

- `noteUpdateSent` 信息追加 `chunked?: Readonly<{ transferId: number; chunkCount: number }>`
  ——仅末 chunk 结算通知携带（中间 chunk 沿用零通知，B1 不变）；此时 `bytes` = `totalBytes`（既有语义）。
- `UpdateChannel.inFlight` 条目值追加 `chunked?: true` 标记（末 chunk 注册时置位）；
  `onAck` 将标记透传：`onUpdateAcked` 信息追加 `chunked?: true`。

**理由**：(a) 最小生产面——普通路径回调不携带该组，facet 分支缺省侧逐字节不变（N1 结构性保持）；
(b) ACK 记账单路径保持（latency/sentAt 计算零分叉）；(c) #243 SA7 动态套件 S1 的 fake host 只复制
`{sequence, bytes}` / `{bytes, sequence}`——形状兼容，S1 **零改动保持绿**（已核对
`ws-replication-issue243-sa7-dynamic.test.ts:126-128, 211-230`）；(d) 契约不锁实现形态（SA6 §12）。
**未选择方案（Option B）**：新增 `noteChunkedUpdateSent` / `onChunkedUpdateAcked` 专用回调——结构性
更隔离，但需同步改写 S1 fake host 与断言、双侧宿主接口双份接线，churn 更大且无行为收益。

通道层其余微调：末 chunk 结算分支中 `sendQueueMs` 的计算可保留或删除（chunked 事件不消费该字段；
`sentAt` 必须保留——inFlight ACK latency 依赖）；删除属死代码清理，零可观测差异。

### DD4 · assembler `complete` 携带 `chunkCount`

`UpdateChunkAcceptResult` 的 `complete` 变体由 `{ outcome: 'complete'; bytes }` 扩展为
`{ outcome: 'complete'; bytes: Uint8Array; chunkCount: number }`（`completeIfExact` 在 reset 前捕获
`declaredChunkCount`）。不携带 `transferId`/`totalBytes`：成功型键集无一需要 transferId；
`bytes.byteLength === declaredTotalBytes` 是 assembler Σbytes 精确核对的既有不变量
（`update-transfer.ts:164-172`），applied 的 `bytes` 字段直接取 `update.byteLength`。

### DD5 · `applyRemoteUpdate` 增设第 5 可选参 `chunked`

签名（hub/peer 孪生）：`applyRemoteUpdate(update, sequence, isStep2 = false, syncRoundId?, chunked?: Readonly<{ chunkCount: number }>)`。
唯一新调用点 = 双侧 `handleAssemblerResult` 'complete' 分支（B9 中该调用点现传
`(result.bytes, sequence)` → 改传 `(result.bytes, sequence, false, undefined, { chunkCount: result.chunkCount })`）。
onUpdate/applyStep2 两类既有调用点零改动（不传第 5 参）。

### DD6 · 发射位置 = 决策落定后（沿用既有锚点）

- sent：`sendOneChunk` 末 chunk 分支内、`inFlight.set` 之后、`armAckTimer` 之前（= 现 `noteUpdateSent`
  位置，`update-channel.ts:435-445`）——「transfer 完成出站」= 末 chunk 帧已交宿主发送且已注册在途。
- applied：`applyRemoteUpdate` 成功结算的 `observerOn` 块内、`UPDATE_ACK` 发送之前（= 现
  `update-applied` 位置，hub L1182-1193 / peer L1414-1426）。
- acked：`onAck` 内 `inFlight.delete` + timer 重挂逻辑之后、`requestDataDrain` 之前（= 现
  `onUpdateAcked` 位置，`update-channel.ts:190-199`）。
三处均为同步调用，时延采样复用既有 `t0/t1`（applied）与 `entry.sentAt`（acked）锚点——零新增采样点。

### 已拒绝的其他方案

- **逐 chunk 发 `chunked-update-sent`**：违背 ADR L89「transfer 完成出站时一次，非逐 chunk」。
- **新 ACK 消息/逐 chunk ACK**：ADR 0013 拒绝清单第 4 条；单 ACK + 末 chunk 序簿记已足够。
- **在 assembler/通道内直接发射 observer 事件**：发射权属 namespace facet（connectionId/side/observerOn
  在 facet 层）；通道经宿主回调上抛（既有架构，#238 先例）。
- **为 chunked 族补 `stages`/效果组**：见 DD1 排除项。

## 8. 接口、状态机与数据流

### 8.1 类型注册（`types.ts`，判别联合 append-only 第 24–26 型，插于第 23 型之后）

```ts
// ── issue #245（append-only 第 24–26 型；ADR 0013 L89–91 域键集逐字 + §23 side 信封。
//    R22 裁决：无 sequence/四段差值/效果组/sendQueueMs——chunked 族关联键 = transferId
//    （sent/aborted）+ wire UPDATE_CHUNK 帧；扩展 = append-only 键追加，须显式裁决 + §23.1 登记）──
| {
    /** 分块 transfer 完成出站（末 chunk 已交发送且注册在途）恰一；中间 chunk 零事件。 */
    readonly type: 'chunked-update-sent';
    readonly side: ReplicationObserverSide;
    readonly connectionId?: string;
    readonly namespaceId: string;
    readonly transferId: number;
    readonly chunkCount: number;
    readonly totalBytes: number;
  }
| {
    /** apply 成功路径互斥规则第四形态（UPDATE_CHUNK 组装收齐 ∧ 非 Step2 ∧ 非 degraded）。 */
    readonly type: 'chunked-update-applied';
    readonly side: ReplicationObserverSide;
    readonly connectionId?: string;
    readonly namespaceId: string;
    readonly bytes: number;
    readonly chunkCount: number;
    readonly applyLatencyMs?: number;
  }
| {
    /** 末 chunk 帧序的单 ACK 收妥结算（发送侧）。 */
    readonly type: 'chunked-update-acked';
    readonly side: ReplicationObserverSide;
    readonly connectionId?: string;
    readonly namespaceId: string;
    readonly bytes: number;
    readonly ackLatencyMs?: number;
  }
```

### 8.2 发送侧（`update-channel.ts` + 双侧 facet `onUpdateSent`/`onUpdateAcked` 分支）

通道（与 `activeTransfer` 全程在场的上下文对接，SA6 §10）：

```ts
// sendOneChunk 末 chunk 分支（现 L429-445）：注册在途时携带标记 + 通知携带上下文组
this.inFlight.set(seq, { bytes: transfer.totalBytes, ...(sentAt !== undefined ? { sentAt } : {}), chunked: true });
this.host.noteUpdateSent({
  sequence: seq,
  bytes: transfer.totalBytes,
  ...(sendQueueMs !== undefined ? { sendQueueMs } : {}),   // 可整段删除（chunked 不消费）
  chunked: { transferId: transfer.transferId, chunkCount: transfer.chunkCount },
});

// onAck（现 L190-198）：透传标记
this.host.onUpdateAcked({
  bytes: entry.bytes, sequence,
  ...(latencyMs !== undefined ? { latencyMs } : {}),
  ...(entry.chunked !== undefined ? { chunked: true } : {}),
});
```

facet（hub `onUpdateSent` L1072-1085 / `onUpdateAcked` L1056-1069；peer L1287-1300 / L1270-1283 孪生）：

```ts
private onUpdateSent(info: Readonly<{ sequence; bytes; sendQueueMs?; chunked?: { transferId; chunkCount } }>): void {
  if (!this.observerOn) return;
  if (info.chunked !== undefined) {
    // 改道（R21）：分块 transfer 完成出站 → chunked 族；无 sequence/latency 键（DD1）
    this.host.emitObserver({
      type: 'chunked-update-sent',
      side: 'hub',                          // peer 侧 'peer'
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      transferId: info.chunked.transferId,
      chunkCount: info.chunked.chunkCount,
      totalBytes: info.bytes,               // 末 chunk 结算时 bytes = totalBytes（通道语义）
    });
    return;
  }
  /* 既有 update-sent 发射体逐字节不变（N1 锚） */
}

private onUpdateAcked(info: Readonly<{ bytes; latencyMs?; sequence; chunked?: true }>): void {
  if (!this.observerOn) return;
  if (info.chunked !== undefined) {
    this.host.emitObserver({
      type: 'chunked-update-acked',
      side: 'hub',                          // peer 侧 'peer'
      ...(cidField(this.host.connectionId())),
      namespaceId: this.namespaceId,
      bytes: info.bytes,
      ...(info.latencyMs !== undefined ? { ackLatencyMs: info.latencyMs } : {}),
    });
    return;
  }
  /* 既有 update-acked 发射体逐字节不变 */
}
```

恰一性：每笔完成的出站 transfer 恰一次末 chunk 结算（`activeTransfer` 生命周期单点：
`startTransfer` 创建 → 末 chunk 清除 → 重复结算结构性不可达）→ sent 恰一；每末 chunk 帧序恰一条
inFlight 条目 → ACK 恰一 acked（zombie 迟到 ACK 不经 `onUpdateAcked`，`update-channel.ts:202-205`——
弃置 transfer 零 acked，与 aborted 零成功型不变量一致）。

### 8.3 接收侧（`update-transfer.ts` + 双侧 `handleAssemblerResult`/`applyRemoteUpdate`）

```ts
// update-transfer.ts：complete 变体携带 chunkCount（completeIfExact 于 reset 前捕获）
| { readonly outcome: 'complete'; readonly bytes: Uint8Array; readonly chunkCount: number }

// hub/peer handleAssemblerResult 'complete'（hub L744-751 / peer L726-733）：
void this.applyRemoteUpdate(result.bytes, sequence, false, undefined, { chunkCount: result.chunkCount });

// applyRemoteUpdate 发射分叉（hub L1182-1193；peer L1414-1426，degraded 分支在其之前且零改动）：
if (isStep2) {
  /* 既有 sync-diff-applied（...base 展开体不变） */
} else if (chunked !== undefined) {
  // 第四形态：独立字段组——不得展开 base（base 含 sequence/stages，DD1 排除项）
  this.host.emitObserver({
    type: 'chunked-update-applied',
    side: 'hub',                            // peer 侧 'peer'
    ...(cidField(this.host.connectionId())),
    namespaceId: this.namespaceId,
    bytes: update.byteLength,               // = 声明 totalBytes（assembler Σ 核对不变量）
    chunkCount: chunked.chunkCount,
    ...(applyLatencyMs !== undefined ? { applyLatencyMs } : {}),   // t1-t0 既有采样
  });
} else {
  /* 既有 update-applied（...base 展开体不变） */
}
```

hub 侧（无 degraded 分支）分叉序 = isStep2 → chunked → update；peer 侧 = degraded（先行，不变）→
isStep2 → chunked → update（DD2 全序）。

### 8.4 事件路由与互斥边界（改道边界总表，R21）

| 结算点 | 来源判据 | 事件（恰一） | 普通族同点行为 |
|---|---|---|---|
| 末 chunk 出站（`sendOneChunk` isLast） | `activeTransfer !== undefined`（结构性必然） | `chunked-update-sent`（发送侧 side） | `update-sent` **不再发**（改道） |
| 普通 UPDATE 帧出站（`sendAndRegister`） | 无 transfer（`chunked` 组缺省） | `update-sent`（逐字节不变） | 不变（N1） |
| 末 chunk ACK（`onAck` 命中带标记条目） | inFlight 条目 `chunked: true` | `chunked-update-acked`（发送侧 side） | `update-acked` **不再发**（改道） |
| 普通 ACK | 条目无标记 | `update-acked`（逐字节不变） | 不变（N1） |
| 组装收齐 apply 成功（非 Step2、非 degraded） | `applyRemoteUpdate` 第 5 参在场 | `chunked-update-applied`（接收侧 side） | `update-applied` **不再发**（改道） |
| degraded 窗口任意来源 apply（peer） | `degradedBypassActive()` | `degraded-bypass-applied`（不变） | 互斥负向半边零双发（N5） |
| Step2 diff apply | `isStep2` | `sync-diff-applied`（不变；与 chunked 结构性不相交） | 不变 |
| transfer 中止（六 reason） | #244 既有矩阵 | `chunked-update-aborted`（不变，DD0） | 零成功型事件（N4） |

**计数不变量汇总**：每笔完成的 transfer → sent 恰一 + （对端）applied 恰一 + （发送端）acked 恰一；
每笔成功 apply → 四形态恰一；每笔 busy→aborted 边沿 → aborted 恰一（busy 守卫）；中止与成功三型
互斥（中止 transfer 结构性不可达任一成功结算点）。

### 8.5 数据流路线（运行时事件对象，唯一新增数据类别）

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚 |
|---|---|---|---|---|---|---|---|---|
| hop1 chunked-update-sent | `sendOneChunk` 末 chunk：transfer 上下文（通道内存态）+ seq>0 | facet `onUpdateSent` 构造事件对象（进程内，同步） | 通道→facet 经宿主回调（包内私有 seam）；facet 附加 side/connectionId?/namespaceId | 不落盘不上 wire（observer 回调直投） | 宿主 observer（构造注入同步回调） | 发送侧恰一事件；safe-field 仅计数/长度/有界 transferId | observer throw → `dispatchReplicationObserver` 静默吞；无 observer → `observerOn` 早退零构造 | R1/R4、N1/N2/N3 |
| hop2 chunked-update-applied | assembler `complete{bytes, chunkCount}` → `applyRemoteUpdate` 成功 | facet apply 结算 `observerOn` 块构造 | assembler→控制器→facet（包内）；t0/t1 时钟差经连接层 observer 门控 | 同上（零持久化；apply 本身的 dirty/save 为既有路径，不改） | 宿主 observer | 接收侧恰一事件；与三旧形态互斥 | 同上；apply 失败/refused/rejected → 既有失败族事件，零 chunked 事件 | R2/R4/R5、N5 |
| hop3 chunked-update-acked | `onAck` 命中末 chunk 条目（bytes/sentAt/chunked） | 通道计算 latency → facet `onUpdateAcked` 构造 | 通道→facet 宿主回调；sentAt 差值（clock 缺省 → 字段缺失） | 同上 | 宿主 observer | 发送侧恰一事件；晚于 sent（同侧有序） | 同上；zombie 迟到 ACK → 无事件（既有语义） | R3/R4/R5、N2 |

三 hop 均为**进程内同步观测投影**：事实源 = 通道/assembler/session 的既有记账；无缓存、无最终一致性、
无跨进程边界；wire 字节与持久化路径零变化（N3 的 wire kind#seq 摘要全等即其证明）。

### 8.6 测试与规范同步（实现轮交付面）

| 文件 | 改动 |
|---|---|
| `packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts` | **零改动**——R1–R5 转绿、N1–N5 保持绿（契约冻结，实现不得适配契约） |
| `packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts` | K1（L557-640）三普通族断言改指 chunked 族：sent 恰一{transferId/chunkCount/totalBytes=wire}、acked 恰一{bytes=totalBytes}（无 sequence 键）、applied 恰一{bytes/chunkCount}（无 sequence 键）+ 普通族三事件归零断言；文件头 L8 注释同步。其余 K 用例零改动（L831 属未协商普通路径，不受影响——已核对） |
| `packages/ws-replication/test/ws-replication-issue243-sa7-dynamic.test.ts` | **零改动**（Option A 形状兼容，S1 的 fake host 只复制 sequence/bytes——已核对 L126-128、L211-230） |
| `packages/ws-replication/test/ws-replication-observer-red.test.ts` | §23.7 conformance 增补（AC6，两具名子项**均必交付**）：(a) `ALLOWED_KEYS` 追加三行（键集同 §8.1 表）；(b) 数值有限非负键清单追加 `transferId`/`chunkCount`/`totalBytes`；(c) `observedBoot` 增设 chunked 选项（peer `chunkedUpdate: true`——`peer-connection.ts:384-385` opt-in 旋钮 + 低 `maxUpdateBytes` limits；构型同契约文件 LIMITS/BIG（L77–98：8KiB / ≈20KB → 3 chunk）），全矩阵场景（L1270-1303）加一条协商分块写腿，`expectedTypes` 追加三新型（矩阵必须真实激发三型——白名单行不得为死行）；**R26 纪律**：该腿置于收口相位（GOAWAY 注入/wire close 1006/`peer.stop()`）之前收敛——收口后在途 transfer 中止会观测 `chunked-update-aborted`，而白名单不含该型（`assertSafe` 直接红）；若实现确需收口后在途，须同步补 aborted 白名单行 + `receivedChunks`/`receivedBytes` 数值键；(d) T12 时钟折叠两态分块腿——**必交付**（AC6「时钟折叠策略」子项，F1 修订升格；两腿钉死见 §8.6.1） |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | 联合枚举块（L240-267）追加三成员（否则 type-test 编译红）；按 #244 先例追加三新型字段型断言（transferId/chunkCount/totalBytes/bytes/latency 可选性） |
| `docs/protocols/instance-replication-v1.md` | §23.1：词汇 23→26 型；追加三行登记（键集、发射点、恰一不变量、计数口径、零采样缺省——**R28：三新行显式携带「分块 transfer 窗口内对应普通族事件归零（改道）」措辞**）；aborted 行删除尾句「成功路径三型……不登记为已实现行为」；(L727-729) 互斥规则三选一→四选一（`chunked-update-applied` = UPDATE_CHUNK 且非 degraded；degraded 任意来源胜出）；§23.7 增补：chunked 三型 key-set 冻结、时钟折叠两态、degraded×chunked 互斥断言要求 |

#### 8.6.1 T12 时钟折叠两态分块腿（必交付——AC6「时钟折叠策略」具名子项；F1 修订）

AC6 的两个具名子项（「事件矩阵 key-set 冻结」「时钟折叠策略」）都必须在 §23.7 正典文件
`ws-replication-observer-red.test.ts` 内有可执行验收：不得以契约文件（R5/N1）替代 AC 指名的 §23.7 位置，
也不得降级为非阻塞 follow-up。两腿落点钉死（全部位于该文件 T12 describe 块内，复用 §8.6(c) chunked 选项
与既有 fixture 机制，零生产代码改动）：

- **(d-i) T12「注入 clock」用例（L1485 起）补分块写腿**：经 §8.6(c) 同款协商分块构型执行一笔确定性大写
  （> `maxUpdateBytes`，如 ≈20KB → 3 chunk——同契约 LIMITS/BIG 几何），hub 侧 `persistence.saveGate` 门闩
  制造确定性 apply 延迟（既有 T12 机制；分块 apply 经 assembler complete → `applyRemoteUpdate` → 同一
  sequencer/save 管线，门闩同样生效）。断言：
  1. `chunked-update-applied.applyLatencyMs` **在场**（`in === true`）、`Number.isFinite`、**≥ 0**；
  2. `chunked-update-acked.ackLatencyMs` **在场**、有限、**≥ 0**；
  3. `chunked-update-sent` 键集**仍无任何 latency 键**（`'applyLatencyMs' in sent === false` ∧
     `'ackLatencyMs' in sent === false`，或等价 exact-keyset 断言——clock 在场也不加，DD1 裁决）。
  门闩确定性下可顺带断言精确值（如 25，同既有普通族用例形态）——实现自由，非本设计强制；设计只锁
  在场/有限/≥ 0 与 sent 无时延键。
- **(d-ii) T12「无 clock」用例（L1517 起）补分块写腿**：该用例的手工构型
  （`createHubReplication`/`createPeerReplication` 不注入 `clock`——L1531/L1545 注释锚）追加同一 chunked
  协商旋钮（`chunkedUpdate: true` + 低 `maxUpdateBytes` limits）与一笔大写。断言：
  1. 三 chunked 成功型事件仍发（`sent`/`applied`/`acked` 至少各一——时钟缺面不抑制事件，仅抑制键）；
  2. `chunked-update-applied` **无 `applyLatencyMs` 键**（`'applyLatencyMs' in applied === false`——整键缺失，
     非 undefined 值，§23.4 L811 纪律）；
  3. `chunked-update-acked` **无 `ackLatencyMs` 键**（同上 `in === false`）。

**两态分工成文（N-O5）**：矩阵 chunked 腿经 `observedBoot` 缺省 ManualClock 运行（有 clock 态），由 (b)
数值键清单执行「在场 ≥ 0」的通用数值检查；(d-i) 以确定性门闩对 chunked 族执行**在场态专属断言** + sent 恒无
时延键；(d-ii) 覆盖**缺场态**（两 latency 键整键缺失）。三处合并 = §23.7 L884–885「无 clock 时 latency 字段
缺失、有 clock 时 ≥ 0」在 chunked 族上的完整两态覆盖。契约 R5/N1 仍为行为面双保险（契约文件冻结，实现不得
适配），但 AC6 验收以本节两腿为 §23.7 正典证据。

**SA4/SA7 验收口径（AC6）**：矩阵腿（key-set 冻结 + safe-field + expectedTypes）与 (d-i)/(d-ii) 两腿全部在
`ws-replication-observer-red.test.ts` 内存在且绿——缺任一腿即 AC6 不满足，不得援引契约文件替代 AC 指名位置。

## 9. 错误、恢复、并发与幂等

### 9.1 throw 隔离与决策落定（AC2，零新机制）

三新事件全部经 `host.emitObserver` → `dispatchReplicationObserver`（`observer.ts:34-44`）投递：
try/catch 静默隔离、同步回调返回值忽略。发射点均在状态迁移/记账落定之后（DD6 位置）——observer
throw 不改变 wire 序、终态、文档内容、apply 结算（N3 全等断言）。事件对象不可变（readonly 联合成员）。

### 9.2 无 observer / 无 clock 纪律（AC3）

- 零事件/零构造：facet 分支首行 `if (!this.observerOn) return;`（既有门）。
- 零投影读取：三新型字段源 = 通道/assembler 记账与既有 t0/t1 采样点，无新增 live 状态读取；
  `degradedBypassActive()` 仅 peer 既有判别（chunked 分支不触达）。
- 零时钟调用：全部时钟读取经连接层 observer 门控（B6：`hub-connection.ts:543` /
  `peer-connection.ts:166`——无 observer 时 `host.now` 恒 undefined，通道 `safeNow(() => this.host.now?.())`
  与 facet t0/t1 均零调用）；含 stop/收口路径（N2 全生命周期断言）。通道在末 chunk 结算无条件构造的
  `chunked{transferId, chunkCount}` 组 = 常驻标量的 O(1) 对象（与既有 info 对象同成本类），非采样。
- 时钟折叠两态：无 clock → `applyLatencyMs`/`ackLatencyMs` 整键缺失（条件附着展开，非 undefined 值）；
  有 clock → 在场且 ≥ 0（单调时源差值；clock throw → `safeNow` 折叠 → 字段缺失，既有纪律）。

### 9.3 与中止/恢复路径的交互（AC5 保持面）

- ACK timeout（`abandonInFlight`）：末 chunk 条目转 zombie；迟到 ACK 返回 'zombie' 不发事件——
  弃置 transfer 零 acked。接收侧 assembly 已完成的（applied 已发）不受发送侧弃置影响——
  与 #244 中止矩阵语义连续（中止事件只登记接收侧 partial 弃置）。
- resync/shed/teardown/epoch-fence：经 `discardQueued`/`clearActiveTransfer` 终止在途 transfer——
  未到末 chunk 出站 ⇒ 零 sent/acked；接收侧 busy 弃置 ⇒ aborted（既有）+ 零成功型（N4）。
- 恢复 round 后重发：新 transferId（`nextTransferId` 严格递增；teardown 归 1——作用域
  (连接, 方向, ns)，`update-channel.ts:103-107, 511-522`）；sent 事件携带本作用域 transferId。
- 并发：每 (ns, 方向) 至多 1 个在途 transfer（DD-3.2 不变量）+ 连接级并发 assembly 槽（#244 D3）——
  事件恰一性由这些既有单点结构性保证，无新增锁/队列。

### 9.4 幂等与重试

事件发射本身零重试语义（观测投影，至多一次恰一）。协议重试（resync 恢复、重连）产生**新** transfer/
新事件流，计数不变量按 transfer/apply/中止边沿各自成立——聚合方（宿主 metrics）按
(transferId, connectionId) 域聚合，跨重连不复用（transferId 作用域纪律）。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `UpdateChannelHost` 生产实现 ×2（hub/peer facet） | `noteUpdateSent`/`onUpdateAcked` 按三字段信息发射普通族 | 信息加宽（可选 `chunked` 组/标记）→ 分支发射双族 | §8.2 双侧分支（本设计核心） | `hub-namespace.ts:232-233`、`peer-namespace.ts:272-273` |
| `applyRemoteUpdate` 调用点 ×6（双侧各 3） | plain/isStep2 两态 | 第三态 `chunked`（仅 assembler complete 调用点传入） | §8.3：双侧 handleAssemblerResult 一行 + 分叉 | B9 锚点 |
| `UpdateChunkAcceptResult` 消费方 ×2（双侧 handleAssemblerResult） | `complete` 只读 `bytes` | 增读 `chunkCount` | §8.3（DD4） | `update-transfer.ts:56-62` |
| `ReplicationObserverEvent` 类型消费者——api 型断言 | 联合 23 型枚举 | 26 型枚举 + 三新型字段断言 | §8.6（type-test 必须同步否则编译红） | `ws-replication-api.test-d.ts:240-267` |
| observer 全事件矩阵 + T12 时钟用例（§23.7 正典） | 白名单 22 行、矩阵无 chunked 腿；T12 两用例只断言普通族 | +3 行白名单 + 数值键 + 矩阵 chunked 腿 + expectedTypes + T12「注入 clock」「无 clock」两用例分块腿（§8.6.1，必交付） | §8.6(c)(d)/§8.6.1（AC6） | `ws-replication-observer-red.test.ts:1145-1176, 1270-1303, 1485-1569` |
| #243 chunked-live K1 | 分块路径断言普通族三事件 | 改指 chunked 族（授权翻转存量） | §8.6 | `ws-replication-issue243-chunked-live.test.ts:557-640` |
| #243 SA7 动态 S1（fake host） | 只复制 `{sequence, bytes}`/`{bytes, sequence}` | 形状兼容，零改动保持绿 | 无 | `ws-replication-issue243-sa7-dynamic.test.ts:126-128, 211-230` |
| #244 两套件（aborted 冻结面） | 断言 aborted 键集/闭集/恰一 + 中止场景零成功型 | 零改动保持绿（aborted 面未触碰；中止场景结构性零成功型） | 无 | `ws-replication-issue244-{ac-red,sa7-dynamic}.test.ts`（grep 零普通族断言命中） |
| 宿主 observer/metrics 消费方（外部） | 23 型判别 | 26 型（append-only——未知 type 对 switch/映射表为新增分支，非破坏） | 宿主自行决定（§23.7 既有聚合建议适用） | ADR 0010 L167；协议 §23.7 注记 |
| `src/index.ts` 导出面 | `ReplicationObserverEvent` 已导出 | 三新型为既有联合成员，零新符号 | 无 | `index.ts`（既有导出） |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/ws-replication/src/types.ts` | 判别联合追加第 24–26 型（§8.1） | AC1 键集冻结的类型面 |
| `packages/ws-replication/src/update-channel.ts` | `noteUpdateSent` 信息 `chunked` 组、inFlight 条目标记、`onAck` 透传、（可选）末 chunk 分支 `sendQueueMs` 死代码清理 | sent 改道与 acked 改道的通道侧上下文（DD3） |
| `packages/ws-replication/src/update-transfer.ts` | `complete` 变体携带 `chunkCount`（DD4） | applied 事件的 chunkCount 事实源 |
| `packages/ws-replication/src/hub-namespace.ts` | `onUpdateSent`/`onUpdateAcked` 分支、`handleAssemblerResult` 传参、`applyRemoteUpdate` 第 5 参 + 发射分叉（§8.2/§8.3） | hub 侧三发射点改道 |
| `packages/ws-replication/src/peer-namespace.ts` | 同上孪生（peer side） | peer 侧三发射点改道（R4 双侧） |
| `packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts` | K1 断言与头注释改指 chunked 族 | 授权红翻转存量（SA6 §10） |
| `packages/ws-replication/test/ws-replication-observer-red.test.ts` | 白名单 3 行 + 数值键 + 矩阵 chunked 腿 + expectedTypes + T12「注入 clock」「无 clock」两用例分块腿（§8.6.1，**必交付**） | AC6 §23.7 conformance 两子项（key-set 冻结 + 时钟折叠两态）的正典可执行验收 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | 联合枚举 + 三新型字段型断言 | 公共类型面锁定（编译必同步） |
| `docs/protocols/instance-replication-v1.md` | §23.1（23→26、三行登记、aborted 行尾句清理）、L727-729 四选一、§23.7 增补 | R24 规范同步义务 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/replication-protocol/**`（codec/注册表/错误码） | wire 面与本任务零交集 | 零 wire 变化（非目标）；§23 为 local seam |
| `packages/ws-replication/src/{hub,peer}-connection.ts`、`update-channel.ts` 的发送状态机/窗口/背压逻辑 | 事件挂点在其上层 | 发送语义、记账口径、协商门不变（N1/N3 逐字节等价依赖） |
| `packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts` | 已批准验收契约 | 契约冻结——实现适配契约即造假 |
| `packages/ws-replication/test/ws-replication-issue244-*.test.ts`、`ws-replication-issue239-*.test.ts`、其余 `*-ac-red`/`*-sa7-dynamic` 冻结套件 | 历史切片回归锚 | 保护已交付面（aborted/互斥/效果组等）；本设计下应零改动保持绿 |
| `docs/adr/0013-*.md` 及其余 ADR | ADR 为决策记录 | R25：状态与文本由父 PR #241 生命周期决定，本切片不改 |
| `packages/namespace-diagnostic-log/**`、Registry/Runtime/Persistence | 无交集观测面 | SA8 交叉检查：诊断日志与 observer seam 为两个观测面，零交集 |
| `packages/ws-replication/src/index.ts`、`testing.ts` | 导出面 | 三新型为既有联合成员；零新符号、零新 testing 钩子 |
| `wiki/raw/task_issue-245*.md`（除本设计文件）、`artifacts/sa8-*` | Host/上游产物 | 只读输入 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 sent 语义/键集 | 红 R1（现 0） | 契约 R1（闸门相位：chunk0/1 后零事件 → 末 chunk 后恰一 + SENT_KEYS 逐字 + 字段=wire 申报 + 普通族归零） | R1 绿 |
| AC1/AC4 applied 键集与互斥 | 红 R2 | 契约 R2（窗口恰一 apply-form 增量 + chunked-update-applied 恰一 + APPLIED_KEYS + update-applied 增量归零） | R2 绿 |
| AC1 acked + 时序 | 红 R3 | 契约 R3（恰一 + ACKED_KEYS + bytes=total + update-acked 归零 + sent 先于 acked） | R3 绿 |
| 方向镜像/side 双侧 | 红 R4 | 契约 R4（hub→peer：hub sent/acked + peer applied 各恰一、双侧普通族归零） | R4 绿 |
| AC3 时钟两态 | R5 + N1/N2 | 契约 R5（clock 注入 latency 在场 ≥ 0、sent 恒无 latency 键）+ R1–R4 无 clock exact-keyset + N2 零时钟调用 + §8.6.1 (d-i)/(d-ii)（chunked 族两态在 §23.7 正典文件内可执行） | 全绿 |
| AC2 throw 隔离 | N3 | 契约 N3（每事件必 throw vs 无 observer：wire kind#seq/终态/内容/dirty 全等） | 保持绿 |
| R21 普通族逐字节不变 | N1 | 契约 N1（限内 UPDATE：普通族三事件键集逐字 + sequence 闭环 + 零 chunked 族 + safe-field 深扫/哨兵） | 保持绿 |
| R20 aborted 保持面 | N4 | 契约 N4（resync-declared 行：aborted 恰一 + ABORTED_KEYS + reason 闭集 + 零成功型 + 零部分写入 + 残渣良性） | 保持绿 |
| R23 degraded×chunked | N5 | 契约 N5（degraded 窗口分块下行：apply-form 增量恰一 = degraded-bypass-applied + 零双发） | 保持绿 |
| AC6 §23.7 增补 —「事件矩阵 key-set 冻结」子项 | observer-red 现无 chunked 腿（白名单 22 行实测） | §8.6(c)：矩阵 chunked 腿（协商分块大写）激发三型经白名单/哨兵/深扫/数值断言；`expectedTypes` 含三新型（不得为死行） | 新腿绿 |
| AC6 §23.7 增补 —「时钟折叠策略」子项（F1 修订必交付） | T12 两用例现只断言普通族（L1485-1569 实测） | §8.6.1：(d-i) 注入 clock 分块腿——applied.applyLatencyMs/acked.ackLatencyMs 在场、有限、≥ 0 且 sent 键集无任何 latency 键；(d-ii) 无 clock 分块腿——两 latency 键整键缺失（`in === false`）且三 chunked 型事件仍发 | 两腿绿——AC6 两子项证据均指向 §23.7 正典文件自身，无需以契约文件替代 AC 指名位置 |
| 授权翻转存量 | K1 现断言普通族 | #243 K1 改写后 | K1 绿（chunked 族形状） |
| 类型面 | api.test-d 联合枚举 | tsc + type-test 同步 | 编译零错 |
| 门禁 | — | 按 `packages/ws-replication/AGENTS.md`：焦点套件（issue245/243/244/observer-red/api）→ `vitest run packages/ws-replication/test` 全包 → 包 tsc + 根 `pnpm typecheck` + `pnpm test` | 全绿（472+ 用例零意外翻转——唯一预期翻转已随改道同步） |

## 13. 风险、回滚与残余问题

**风险与护栏**

| 风险 | 护栏 |
|---|---|
| 双侧孪生漏改单侧（hub 或 peer） | R4 方向镜像红；两侧发射点改动作对称评审 |
| applied 误展开 `base`（泄漏 sequence/stages） | R2 exact-keyset（APPLIED_KEYS）红；§8.3 代码注释明示「不得展开 base」 |
| degraded 判别顺序回归（chunked 抢先） | N5 恰一增量断言红 |
| 无 observer 时钟泄漏 | B6 连接层门控结构性防；N2 计数时钟断言（含收口） |
| 忘记同步 K1/api 枚举/矩阵（编译或存量红） | 全包回归门禁（§12 末行）即暴露 |
| 实现轮跳过 T12 两态分块腿（AC6「时钟折叠策略」子项失去 §23.7 正典证据） | §8.6.1 已升格为必交付并钉死两腿；§12 AC6 行分列两腿证据；SA4/SA7 验收直接检查 T12 两用例含分块腿且绿——不得以契约文件 R5/N1 替代 AC 指名位置（F1 教训固化为门禁） |
| 文档先行登记未实现行为 | R24：文档与实现同变更落地；落地前三新型维持「计划项」口径 |
| 事件泄漏内容/身份字段 | 三 hop 字段源均为计数/长度/有界 transferId（§8.5）；N1/N4/N5 哨兵深扫 |

**回滚**：单包变更（src 5 文件 + test 3 文件 + 协议 1 文件），revert 即恢复现行为（分块路径回退普通族
事件）；契约 R1–R5 随之回红——回滚可见性由契约保证。无数据迁移、无持久化面。

**残余问题 / follow-up（均非本任务必要条件）**

1. chunked 族的 #238 式帧级关联键（`sequence`）与效果字段——若未来需要，属 append-only 键扩展：
   显式设计裁决 + 协议 §23.1 登记 + SA6 契约修订 dispatch（DD1 已记录路径与理由）。
2. ADR 0013 状态转正随父 PR #241 生命周期处理（R25 条件项：若 observer seam 表方向性返工，复审本设计）。

（iteration 0 曾将「observer-red 注入 clock 用例的分块腿」列为 follow-up——该腿是 AC6 具名子项，已按 F1
升格为必交付（§8.6.1），不再属于残余问题。）

## 14. 评审修订映射

评审输入：`wiki/raw/task_issue-245_sa2_review.md`（SA2 dispatch `sa-f0ad20cb-…`，design-review iteration 0，
verdict **reject**：1 × MAJOR F1，0 × BLOCKER）。逐条落实：

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **F1（MAJOR）**：AC6 第二具名子项「时钟折叠策略」被 §8.6(d) 标注「推荐非阻塞」、§13 列为 follow-up、§12 AC6 证据行只列矩阵腿——SA3 可合法跳过 (d)，§23.7 正典文件对 chunked 族 latency 键无两态可执行验收，AC 验收被静默搬迁到契约文件 | §8.6(d) 行改写（升格必交付）+ 新增 **§8.6.1**（两腿钉死：(d-i) T12「注入 clock」L1485 起补分块写腿——saveGate 门闩断言 applied.applyLatencyMs/acked.ackLatencyMs 在场、有限、≥ 0 且 sent 键集无任何 latency 键；(d-ii) T12「无 clock」L1517 起补分块写腿——两 latency 键整键缺失（`in === false`）且三型仍发）+ §1 目标 6 + §4 AC6 行 + §12 AC6 行拆为两子项证据行（均列 §23.7 正典落点）+ §11 ALLOW LIST observer-red 行（去掉「可选」）+ §13 残余项 2 删除并留改写说明 | 已落实。改动全部落在既有 ALLOW LIST 文件 `ws-replication-observer-red.test.ts` 的交付义务描述内，零范围扩张（依赖 §8.6(c) 同款 observedBoot chunked 选项）；SA4/SA7 验收口径成文：AC6 两子项证据均指向 §23.7 正典文件自身，不得以契约文件替代 |
| N-O1（承接 SA8 复审 R26）：矩阵 chunked 腿的 aborted 暴露面纪律 | §6 R26 行 + §8.6(c) 备注 | 已并入（非阻断）：腿置于收口相位前收敛，或同步补 aborted 白名单行 + receivedChunks/receivedBytes 数值键 |
| N-O2（承接 R27）：`sendQueueMs` 二选一须实现轮定死 | §6 R27 行（DD3 维持「可保留或删除」） | 边界保持（SA8 裁定为实现轮决策）；已登记纪律：任一形态均须保持 N1/N3 绿 |
| N-O3（承接 R28）：协议 §23.1 三新行携带改道归零措辞 | §6 R28 行 + §8.6 协议行 | 已并入为 R24 落地措辞义务 |
| N-O4：api.test-d 用例标题计数漂移（「22 型」vs 实际 23） | §8.6 api 行（追加三成员时同步把计数改 26） | 已登记为实现轮同步项（非阻断） |
| N-O5：矩阵腿（在场态）/T12 无 clock 腿（缺场态）两态分工成文 | §8.6.1「两态分工成文」段 | 已成文，不再隐含 |

SA2 评审确认成立且无需改动的面（键集裁决、改道路由、互斥判别顺序、通道 seam、双侧孪生、调用方矩阵、
ALLOW/DENY、aborted 保持面）本版逐字保持；SA6 契约（R1–R5/N1–N5、冻结键集、契约文件 DENY）与
SA8 两份门禁（R20–R25、R26–R28）边界零触碰。

## 15. 是否需要设计后 ADR 冲突复查

**本版（iteration 1）不需要（`requiresConflictRecheck: false`）**。理由：

1. iteration 0 的设计后冲突复查**已执行并 clear**（`artifacts/sa8-conflict-gate-issue-245-design-recheck.md`：
   四焦点——声明改道/事件键集/互斥判别顺序/兼容边界——逐项闭合；R26–R28 为非阻塞注意项）。
2. 本版修订只改**测试交付义务与设计文本**：F1 修复全部位于已授权的 §23.7 正典测试文件
   `ws-replication-observer-red.test.ts` 的交付清单内（该文件本就在 ALLOW LIST），零键集变化、零改道
   路由变化、零互斥顺序变化、零 wire/持久化/状态机/生命周期变化（SA2 结构化裁决同认）。
3. 技能触发条件逐一核对：无公共 API/协议变化（DD1–DD6 逐字保持）；无 wire/schema/持久化/状态机语义
   变化；未触碰 ADR 冻结面（ADR 0013 L83–94 键集表未动）；未修订既有决策（DD0–DD6 裁决原样）；
   未引入新生命周期所有权或失败语义。

R25 条件项照旧：父 PR #241 若发生方向性返工（尤其 ADR 0013 observer seam 表），前置门禁 + 设计后复审
结论连同本设计一并复审。

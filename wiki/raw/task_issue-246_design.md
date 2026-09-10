# SA1 设计 — issue #246：分块传输 wire 契约收口与新旧互通矩阵（issue #233 切片 5）

- dispatch：sa-fb1cecd0-06ea-454a-963b-54c049f37539（mabf-sa1 / design / iteration 1）
- 任务简报：`wiki/raw/task_issue-246.md`（= issue #246 正文快照；Issue updated at 2026-09-10T00:56:27Z；comments REST 快照 `[]`）
- SA8 前置门禁：`artifacts/sa8-conflict-gate-issue-246.md`（裁决 clear；就绪注意项 R26–R31）
- SA2 评审输入：`wiki/raw/task_issue-246_sa2_review.md`（iteration 0 裁决 **reject**：4 MAJOR F1–F4 + 6 非阻塞观察 N1–N6）——本 iteration 1 逐条落实，映射见 §14
- 基线：分支 `mabf/issue-246` @ `d1888cc`（= #245 经 #281 合并的交付 commit，blocked-by 已满足）；工作树仅含未跟踪的简报、SA8 报告、SA2 评审与本设计四件
- 设计产物：本文档（`wiki/raw/task_issue-246_design.md`，iteration 1 原位修订全文）

---

## 0. 输入摘要与已核实事实

| 输入 | 状态 | 结论 |
|---|---|---|
| Issue 正文（简报） | 已读 | 5 条 AC（文档修订/ADR 接受/互通矩阵/§22 收口/文档验证），Parent PR #241，Blocked-by #245 |
| Issue comments | REST 快照 `[]`（dispatch 前即时读取） | **零 owner 评论、零 comment ID 需要落实**；issue 正文为唯一任务要求来源 |
| SA6 诊断/契约 `task_issue-246_sa6_contract.md` | 不存在 | 本票为文档收口 + conformance 证据票，无生产缺陷需要诊断；替代证据 = 切片 1–4 已交付的实现与测试（§2.2/§2.3），设计中不列任何未建立的根因 |
| SA8 冲突报告 | `artifacts/sa8-conflict-gate-issue-246.md` | clear；R26–R31 逐条落实（§6） |
| SA2 评审输入 | 存在（iteration 0，reject：F1–F4 MAJOR + N1–N6 观察） | §14 逐条映射；F1/F2 修订 §7.4/§12，F3 修订 §7.1/§12.2，F4 修订 §7.2/§12.2；N1–N6 一并吸收 |
| SA8 相关决议 `task_issue-246_relevant_decisions.md` | 不存在 | SA8 门禁报告已含等价内容（其 §1 裁定基准 = CONTEXT.md + docs/adr/ 全集逐条对照）；ADR 0013/0010 原文已直接复核 |

**任务类型**：Documentation + Conformance-evidence（文档收口票 + conformance 证据交付票）。**零生产行为变化**（§8.3 论证）。

---

## 1. 任务模型：目标与非目标

### 1.1 目标（What to build 逐条）

1. **§10.3 收口**：`docs/protocols/instance-replication-v1.md` §10.3 把「跨帧规则与 assembly 状态机、ACK 复用属后续切片」占位（L312）替换为完整 live UPDATE 分块契约：发送端规则、接收端规则、transfer 身份、ACK 锚点——与 ADR 0013「发送端规则/接收端规则/ACK 复用」节及实现三方逐字一致，**含完整错误码映射（首 chunk 声明超限 ⇒ `UPDATE_TRANSFER_TOO_LARGE`，F3）**。
2. **ADR 0013 接受与权威登记**：状态「提议」→「已接受」；显式登记两层权威让渡边界（wire 冻结值 → 协议文档唯一权威；配置表/设计理据 → ADR 0013 保留）；**observer 事件词表单列为 local seam 词表，不入 wire 冻结值枚举（F4）**。
3. **互通矩阵 conformance 证据**：传输层 v1 peer ↔ v2 hub、v2 peer ↔ v1 hub、v2 ↔ v2 全组合测试提交并绿；未协商 ⇒ 超限丢弃 + reconciliation 的 v1 行为逐字节保持（可执行形态 = **三层确定性等同断言**，F1）；issue #233 刻画测试作为 v1 基线继续全绿。
4. **§22 conformance 清单收口**：互通矩阵与 golden vectors / 新消息码锁定值（0x42、CAP 0x00000001）纳入清单并指向在库资产。
5. **术语一致性与文档验证**：实现代际词表三层消歧（R27）；清理全部「提议」残留与过期切片注记（含 §22 既有条目「v1 回落」措辞改挂，N1）；链接/引用文件名检查、过期术语搜索（含全局「提议」零命中搜索，N2）、`git diff --check` 干净。

### 1.2 非目标（防 scope creep）

- **不改任何生产代码**：`packages/*/src/**` 零改动——不为互通矩阵新增 hub 侧 capability 注入旋钮或 testing seam（§7.4 论证；R28 以等价性设计承接）。
- **不改已冻结面**（R26）：消息码 `0x42`、UPDATE_CHUNK 六字段序、两错误码语义（fatal/retryable/terminal）、`UPDATE_TRANSFER_EXPIRED` reason、§23.1 事件键集、§17 四配置缺省与校验链——只校验与保持，不重登记、不改值。
- **不改 issue #233 刻画文件**：`ws-replication-issue233-repro.test.ts` 保持原样继续作为 v1 基线（ADR 0013 L110）。
- **不发明旧版包多版本 harness**（R29）：`@nomicore/ws-replication` 为 workspace-only 包，仓内无旧版安装机制；旧/新互通以「wire 可见行为等价」构型表达。
- 不修订 ADR 0010 及其余 ADR（ADR 0010 分块引用实测为零——`grep -nE "UPDATE_CHUNK|CAP_CHUNKED|分块" docs/adr/0010-*.md` 无命中，权威边界已干净）。
- 不做 `CAP_CHUNKED_SYNC`、awareness、多 hub 等 ADR 0013 非目标面的任何推进。

---

## 2. 当前行为与证据锚点

### 2.1 文档现状

| 事实 | 锚点 |
|---|---|
| §10.3 已冻结单帧 payload 六字段表 + codec 级单帧规则；跨帧规则明文「属后续切片」 | `docs/protocols/instance-replication-v1.md:299-312`（占位句在 L312；全文档「属后续切片」唯一命中） |
| §5 消息注册表已登记 `0x42 UPDATE_CHUNK`（Result/Ack = UPDATE_ACK）+ 未协商 connection fatal 注记 +「v1 的 HELLO 仍发 optionalCapabilities=0」 | 同文件 L111、L113 |
| §6.1 capability 词表已登记 bit `0x00000001 CAP_CHUNKED_UPDATE` | 同文件 L130-134 |
| §13.2 已登记 `UPDATE_TRANSFER_VIOLATION`/`UPDATE_TRANSFER_TOO_LARGE`；**L413 已冻结分类**：首 chunk 声明超资源上限（totalBytes 超 maxChunkedUpdateBytes / chunkCount 超 maxChunksPerUpdate）→ TOO_LARGE；跨帧元数据违例与连接级并发超额 → VIOLATION | 同文件 L410-413 |
| §9.4 已登记 `UPDATE_TRANSFER_EXPIRED` | 同文件 L262 |
| §17 已登记四配置 + 跨字段链①② + 非追溯性条款；L535 现文「issue #242 / ADR 0013 配置表为权威」 | 同文件 L535-569 |
| §23.1 已登记 26 型（含 chunked 四型）；§22 已有 codec 层互通义务行（L652）+ 分块条目（L653，含「v1 回落」措辞）；**现行 §22 零 `*.test.ts` 文件名**（F2 事实） | 同文件 L669-700、L728、L641-657 |
| §23 头注明文「属于 local seam：**不改变任何 wire 字节**，不新增帧/字段/错误码」（F4 依据） | 同文件 §23 节首 |
| ADR 0013 状态行 = 「提议（issue #233 base PR；接受后 wire 冻结值以 …修订为唯一权威，本文不先行改冻结契约）」 | `docs/adr/0013-chunked-live-update-transfer.md:4` |
| ADR 0013 后果节预设本票：「落地时须修订 …（消息注册表、§13.2、§17、§23）并补 golden vectors 与旧/新互通矩阵」+「复现刻画测试保留为现状基线」；L25 预授权互通矩阵组合 | 同文件 L25、L109-110 |
| 「提议」全仓（docs + CONTEXT）恰 2 处：ADR 0013 L4 状态行、`CONTEXT.md:142`「（ADR 0013 提议）」 | grep 实测 |
| `CONTEXT.md:146` UPDATE_CHUNK 词条含过期切片注记「issue #242 切片 1 冻结 wire 面，后续切片承接状态机」（状态机切片 #243–#245 已落地） | `CONTEXT.md:145-146` |
| 「v2」在协议文档与 CONTEXT.md 中零出现；「v1」在协议文档 10 处、双义（协议版本 1 ↔ 旧实现代际） | grep 实测（R27 事实确认） |
| 协议文档 L301「切片 1 只冻结 wire 面」注记——本切片收口后过期 | 同文件 L301 |
| `docs/AGENTS.md` Authority 节：`wiki/raw/` 为 evidence 非规范契约（File A 断言源纪律依据） | `docs/AGENTS.md:5` |

### 2.2 实现现状（切片 1–4 已交付，AC1「与实现逐字一致」有活实现可对照）

| 规则 | 实现锚点 |
|---|---|
| 消息码/capability/未协商门控 | `packages/replication-protocol/src/constants.ts:45`（`CAP_CHUNKED_UPDATE = 0x00000001`）、`payloads.ts:830-834`（UPDATE_CHUNK 未协商在 payload 解析前抛 `UNSUPPORTED_MESSAGE_TYPE`）、`messages.ts`（0x42 注册） |
| HELLO 协商单点 | `packages/ws-replication/src/peer-connection.ts:385`（offer：`chunkedUpdate === true` 才置位，缺省 0 = v1 逐字节；`types.ts:191-193`「wire 协商位是唯一行为判据」）；`peer-connection.ts:473`（逐字消费 `HELLO_ACK.selectedCapabilities`，不与本地 offered 求交）；`hub-connection.ts:714-724`（onHello 单点交集）+ `:64`（`HUB_SUPPORTED_CAPABILITIES = CAP_CHUNKED_UPDATE` 模块常量，**无配置旋钮**——R28 事实确认）+ `:1025`/`:513`（双侧全部 chunked 行为门控于 `isChunkedNegotiated()`） |
| 发送端：chunkable 判定/惰性切片/transfer 载体 | `packages/ws-replication/src/update-channel.ts:151-156`（已协商 ∧ 超 `maxUpdateBytes` ∧ ≤ `maxChunkedUpdateBytes` ∧ transferId 域未耗尽；未协商恒 false）、`:89-98`（activeTransfer 载体 = 队列项，末 chunk 出站才 shift；每 (ns,方向) 至多 1）、`:119`（transferId (ns,方向,连接) 域内自 1 严格递增） |
| 接收端：assembly 跨帧规则 | `packages/ws-replication/src/update-transfer.ts:117-168`（idle 首 chunk 校验序全部先于分配；busy 后续 chunk：transferId/totalBytes/chunkCount 逐字节一致 ∧ `chunkIndex === 已收数量` ∧ bytes ≤ maxUpdateBytes ∧ Σ 不超 totalBytes；收齐 Σbytes === totalBytes 精确核对）；`:184-197`（totalBytes 超 `maxChunkedUpdateBytes` → **TOO_LARGE**；几何一致 → VIOLATION） |
| 接收端：count 维上界与连接级并发槽（controller 层） | `packages/ws-replication/src/hub-namespace.ts:707-716`、`peer-namespace.ts:690-699`（`chunkCount > maxChunksPerUpdate` → **TOO_LARGE**；`tryBeginInboundAssembly` 超额 → VIOLATION，ns 级、连接保持 ready） |
| assembly timeout → RESYNC | `hub-namespace.ts`/`peer-namespace.ts` `armTimer('assembly')` 进度滑动 deadline（每收一 chunk 重置）；协议 §18 L582 已登记 |
| ACK 复用 | `update-channel.ts:52-67`（末 chunk 条目 `chunked: true` 标记；`UPDATE_ACK.ackedSequence` = 末 chunk 帧序；单 ACK 结算） |

### 2.3 测试资产现状

| 资产 | 覆盖 | 状态 |
|---|---|---|
| `packages/replication-protocol/test/codec-messages-golden.test.ts` | 18 型注册表恰锁 + UPDATE_CHUNK 三 golden 向量 + 0x42 锚定 | 在库绿 |
| `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` | AC1 全字段 golden、AC2 敌意输入、AC3 未协商拒绝 + `selectCapabilities` 位运算、AC4 错误码/reason 注册表 | 在库绿 |
| `packages/replication-protocol/test/codec-version-interop.test.ts` | 版本协商全矩阵 + `selectCapabilities` 全矩阵 + 锁定 yjs/y-protocols/lib0 组合 golden 旧字节 × 新 codec 互通（§22 L652 义务的 codec 层兑现） | 在库绿 |
| `packages/ws-replication/test/ws-replication-issue233-repro.test.ts` | R1/R2/R3 现状刻画；运行于缺省 `chunkedUpdate` 缺省路径 = v1 基线 | 在库绿（AC3 末句要求继续全绿） |
| `packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts` | 旋钮开关全链路、hub→peer 镜像、结构违例、残渣判别、RR 穿插、中止族；**`decodeWire` 先例**（L111-112：`decodeMessage(bytes, {selectedCapabilities: CAP_CHUNKED_UPDATE})` 自备解码 helper） | 在库绿 |
| `packages/ws-replication/test/harness.ts` → `issue137-driver.ts` | `makeNode`/`makeWire`/`okLease`/`settle`/`settleUntil` 等构件：**定义于 `harness.ts`，`issue137-driver.ts` 仅转出口（L39-40）**（N3 修正归因）；`bootMulti` 未暴露 chunkedUpdate 旋钮——矩阵测试需自带旋钮组装，见 §7.4 | 在库 |

依赖随机性事实（F1 根因，SA2 实测）：yjs@13.6.x `generateNewClientId = random.uint32`（dist 实测）——每个 Y.Doc 会话的 clientID 为随机 uint32，lib0 varuint 编码宽度 1–5 字节随值变化；因此**跨会话的 Yjs 载荷字节与字节长度均不确定相等**（单 client 同宽概率 ≈0.88，矩阵两格 ≥2 个 client ⇒ 每次运行约两成概率出现长度差）。同会话内同帧对比不受影响。

---

## 3. 能力缺口（根因）

1. **§10.3 契约缺口**：跨帧规则（transferId 域语义、首 chunk 二维声明上界、`chunkIndex === 已收数量`、收齐一次 apply、末 chunk ACK 锚点、assembly 易失作用域与全部丢弃路径、并发上限、超时、**错误码三分类映射**）在协议文档中只有一句「属后续切片」占位——规范文档未承载已实现的 wire 契约，AC1 的三方对照缺文档一角。
2. **ADR 0013 决策状态缺口**：四实现切片（#242/#243/#244/#245，commits `c20aeb0`/`e2178f3`/`733b3a7`/`d1888cc` 均在分支历史、ci-passed）已落地而 ADR 仍标「提议」——决策记录与仓库事实脱节；其 L4 预设的「接受 + 协议修订为唯一权威」同票闭环未执行。
3. **实现代际词表缺口**：互通矩阵必然引入「v1/v2 实现代际」第三层语义；协议文档「v1」现承担双义且全文零「v2」——不显式定义则「v2」必被误读为协议版本 2（ADR 0013 明文 envelope version 恒 1、零新协议版本）。
4. **传输层互通证据缺口**：§22 L652 的旧/新互通义务只有 codec 层兑现；传输层（真实 HELLO 协商 → 超限行为 → reconciliation）全组合矩阵不存在，且「v2 peer ↔ v1 hub」格在现实现下不可直接构型（R28：hub 支持集为编译期常量）。
5. **过期术语残留**：ADR 0013 L4 状态行、`CONTEXT.md:142`「（ADR 0013 提议）」、`CONTEXT.md:146`「后续切片承接状态机」、协议 L301「切片 1 只冻结 wire 面」。

---

## 4. Owner 要求落实

Issue comments 为空（REST 快照 `[]`），无 owner 评论需要映射；issue 正文 5 条 AC 为最高优先级任务输入：

| AC（issue 正文） | 设计落实位置 |
|---|---|
| AC1 协议文档全部相关节修订；字段顺序/消息语义与 ADR 0013 及实现逐字一致；文档间零矛盾（ADR 0010/0013、CONTEXT.md 词汇） | §7.1（§10.3 内容规范，含 F3 错误码映射）、§7.3（术语）、§7.6（CONTEXT 修订）、§12 契约组 D2/D3/D5（三方一致性可执行断言，D2-3 含 TOO_LARGE 锚） |
| AC2 ADR 0013 状态转「已接受」，修订节注明 wire 权威归属 | §7.2（两层权威让渡设计 + F4 枚举拆分）、§12 契约组 D1 |
| AC3 互通矩阵测试提交并绿（v1 peer↔v2 hub、v2 peer↔v1 hub、v2↔v2；未协商 ⇒ v1 行为逐字节保持；#233 刻画测试继续全绿） | §7.4（矩阵 + 等价性设计 + interposer + F1 三层确定性等同）、§12 契约 File B（M1–M3 + codec 锚） |
| AC4 golden vectors 与新消息码锁定值纳入 §22 conformance 清单 | §7.5（§22 收口措辞）、§12 契约组 D4 |
| AC5 文档验证：链接与引用文件名检查、过期术语搜索、`git diff --check` 干净 | §12.4（可执行 doc 验证配方 + 契约组 D3/D6 内嵌文件名存在性断言 + N2 全局「提议」搜索） |

## 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| SA6 契约不存在 | `wiki/raw/` 无 `task_issue-246_sa6_contract.md` | 本票无生产缺陷诊断需求；以切片 1–4 交付面为实现事实源（§2.2），验收契约由本设计直接定义（§12） |
| 分块行为已全量实现并绿 | §2.2/§2.3 锚点 | 文档按实现收口（AC1「与实现逐字一致」）；互通矩阵为 conformance 回归而非红灯 |
| v1 基线行为已刻画 | `ws-replication-issue233-repro.test.ts` R1/R2/R3 | 矩阵以该基线为对照锚（§7.4 M1/M2 三层确定性等同断言，F1）；文件不动 |
| codec 层旧/新互通已兑现 | `codec-version-interop.test.ts` | §22 收口直接指向（R29：以既有矩阵为锚，不发明多版本 harness） |
| v1-hub 格不可直接构型 | `hub-connection.ts:64` 常量 | §7.4 等价性设计（R28 二选一中的等价性论证路线） |
| Yjs clientID 随机 ⇒ 跨会话字节/长度不可全等 | yjs dist `generateNewClientId = random.uint32`（SA2 实测）；§23.7 issue #238 先例为**同会话** A/B 对比 | M2≡M1 等价证据改用三层确定性断言（kind#sequence 序列 / 确定性字段逐字段 / Yjs 承载帧 kind+计数），字节级断言仅保留于 interposer 同帧字节对（§7.4.2，F1） |

## SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| R26 收口定界：不重复登记、不动冻结面 | §1.2、§7.1、§12 D5（绿锚只校验） | §5/§6.1/§13.2/§17/§23 既有条目仅做绿锚回归断言；实质新增限定为 §10.3/ADR 接受/§22/CONTEXT/全文一致性五项 | 是（SA8 指定轻量核对项） |
| R27 v1/v2 词表三层消歧 | §7.3、§7.6 | 协议 §1 新增「实现代际」词条 + §5 L113 与 **§22 L653「v1 回落」**用词改挂词条（N1）；新互通条目使用「v1/v2 代际」措辞；CONTEXT.md 同步增词；明示「非协议版本」 | 否（落地同步义务） |
| R28 v2 peer↔v1 hub 可行性二选一 | §7.4 | **选等价性论证 + wire 层 capability 剥除 interposer + 三层确定性等同断言与 interposer 单帧字节对断言（F1 形态）**；不新增生产 seam（备选方案否决理由见 §7.4.3） | 是（SA8 指定轻量核对项） |
| R29 锚定既有互通资产、不造旧包 harness | §7.4.2、§7.5 | codec 层锚 = `codec-version-interop.test.ts`；传输层新增构型文件 File B；零多版本安装 | 否（落地同步义务） |
| R30 接受时点与父 PR #241 未合并 | §7.2、§13 | 与切片链先例一致（ADR L4 预设同票闭环）；登记为总控留意项，不阻塞 | 否 |
| R31 两层权威边界 + 「提议」零残留 | §7.2、§7.6、§12 D1/D3 | 让渡范围限定 wire 冻结值（消息码/字段序/capability/错误码/reason 词表锁定值）；observer 事件词表单列为 local seam 词表（F4）；§17 L535 配置表权威归属 ADR 保持不变；过期术语清单化验收（含 N2 全局搜索） | 否（落地同步义务） |

---

## 7. 设计决策与主要备选方案

### 7.1 决策 D1 — §10.3 收口为完整 wire 契约（本票唯一实质新增文档内容）

替换 L312 占位句后的 §10.3 结构（保留既有 L301-311 字段表与 codec 级单帧规则段，仅把「切片 1 只冻结 wire 面」注记改为中性表述）：

1. **transfer 身份**：`transferId` 为 uint32，作用域 (连接, 方向, namespace)，从 1 严格递增、不回绕；0 非法（已由单帧规则承载，跨帧节重申域语义）。transfer 内 `chunkIndex`/`chunkCount`/`totalBytes` 声明逐字节一致。
2. **发送端规则**（源 = ADR 0013「发送端规则」+ `update-channel.ts`）：仅当 `bytes.byteLength > maxUpdateBytes` ∧ 已协商 `CAP_CHUNKED_UPDATE` ∧ channel live 时进入分块；切片在出队发送时刻惰性进行（队列持完整 update，`maxQueuedUpdateBytes/Count` 记账口径不变）；每帧独立 sequence、独立受 dataGateOpen 与 round-robin 每轮每 namespace 一帧调度（window 空位允许时小 update 可穿插）；整笔 transfer 占 1 个 in-flight 窗口槽直至 ACK；ACK 计时锚 = 末 chunk 出站时刻（`ackTimeoutMs` 语义不变）；中止复用既有机制（连接 shed / 队列溢出 / ACK timeout / RESYNC_REQUIRED / 终态）。
3. **接收端规则**（源 = ADR 0013「接收端规则」+ `update-transfer.ts`/`hub-namespace.ts`/`peer-namespace.ts`；**错误码映射与 §13.2 L413 已登记分类逐字同向，F3**）：assembly 纯易失，作用域 (连接, 方向, namespaceId, transferId)，连接断开、namespace close/终态、GOAWAY drain、epoch fence、RESYNC_REQUIRED ⇒ 全部丢弃；首 chunk 在分配前完成二维声明上界校验（`totalBytes ≤ maxChunkedUpdateBytes`、`chunkCount ≤ maxChunksPerUpdate`）与几何一致（`totalBytes ≤ chunkCount × maxUpdateBytes`、`chunkCount ≥ 1`），通过后按已验证上界一次性分配 detached buffer；**错误码三分类映射（显式，不得合并叙述）**：
   - **首 chunk 声明超限**（`totalBytes > maxChunkedUpdateBytes` 或 `chunkCount > maxChunksPerUpdate`）⇒ namespace ERROR `UPDATE_TRANSFER_TOO_LARGE`（fatal、terminal failed）；
   - **几何不一致 / 后续帧跨帧违例**（transferId/totalBytes/chunkCount 不一致、`chunkIndex ≠ 已收数量`、bytes 超限、Σ 超 totalBytes、收齐核对失败）**/ 连接级并发 assembly 超 `maxConcurrentAssembliesPerConnection`** ⇒ namespace ERROR `UPDATE_TRANSFER_VIOLATION`（fatal、terminal failed；并发超额为 ns 级、连接保持 ready）；
   - **assembly 停滞超 `assemblyTimeoutMs`**（每收一 chunk 重置的进度滑动 deadline 到期）⇒ 丢弃 partial + `RESYNC_REQUIRED{reasonCode: UPDATE_TRANSFER_EXPIRED}`（非终态）；

   后续 chunk 要求 transferId/totalBytes/chunkCount 逐字节一致 ∧ `chunkIndex === 已收数量` ∧ `bytes ≤ maxUpdateBytes`；收齐 ⇒ 长度精确核对（Σbytes === totalBytes）⇒ **一次** sequenced `applyRemoteUpdate()` + dirty notification ⇒ `UPDATE_ACK(ackedSequence = 末 chunk 帧序)`；重组失败一律发生在 apply 之前，live Y.Doc 零写入。
4. **未协商门控**（既有 L312 后半句保留）：解码侧未协商必须在 payload 解析前以 `UNSUPPORTED_MESSAGE_TYPE` connection fatal 拒绝（close 1002，分类与 §5 未知消息码一致）。

措辞纪律：以上规则的 normative 语句以 ADR 0013 对应节为源逐字对齐，实现细节差异（如校验执行的模块内位置）不写入规范——文档只写 wire 可见契约。**不改 §10.1/§10.2**（普通 UPDATE/ACK 语义零变化）。

### 7.2 决策 D2 — ADR 0013 接受与两层权威让渡（R31；F4 修订枚举）

1. **状态行**（L4）改为：「已接受（issue #233 切片 1–5 落地：#242/#243/#244/#245/#246；wire 冻结值——消息码 `0x42`、UPDATE_CHUNK payload 字段序、capability/错误码/reason 词表锁定值——以 `docs/protocols/instance-replication-v1.md` 为唯一权威；observer 事件词表为 local seam 词表（协议 §23，非 wire 契约），登记随协议文档维护；配置表与设计理据权威保留于本文「资源上限与配置链」）」。日期按落地 commit 填写。**枚举拆分（F4）**：wire 冻结值枚举只含消息码、字段序、capability/错误码/reason 词表锁定值；observer 事件词表**单列**为 local seam 词表并显式标注「非 wire 契约」——与协议 §23 头注「属于 local seam：不改变任何 wire 字节，不新增帧/字段/错误码」零矛盾。
2. **取代与关联**（L120-122）：把「接受后以该文档修订为唯一 wire 权威」的未来时改为已生效表述，并显式两层边界：wire 冻结值（枚举同上，不含事件词表）→ 协议文档；配置语义/设计理据/拒绝备选方案 → 本文；observer 事件词表按协议 §23 定位为 local seam 词表、随协议文档登记维护。ADR 0010 关系句不动（扩展而非修订）。
3. **§17 L535 不动**：「issue #242 / ADR 0013 配置表为权威」与两层边界一致（配置层权威本就留在 ADR），避免「唯一权威」措辞误伤配置表归属。
4. ADR 其余节（背景/决策/后果/非目标）为历史记录不重写；L109-110 的「落地时须修订」义务由本票履行的事实经状态行生效条款闭合。

### 7.3 决策 D3 — 实现代际词表三层消歧（R27）

协议文档 §1 新增词条（置于既有术语表）：

> **实现代际（implementation generation）**：端点的实现代际，与协议版本正交——`envelopeVersion` 恒 1、HELLO `protocolVersions` 不因代际变化（§3 两层版本独立）。v1 代际 = 不含 `CAP_CHUNKED_UPDATE` 的旧实现：HELLO 恒发 `optionalCapabilities=0`，收到 0x42 按未知消息码 connection fatal；v2 代际 = 支持该 capability 的现实现。代际差异仅在 HELLO capability 协商的 wire 位上可见；互通矩阵（§22）按代际组合刻画回落行为。

同步改挂：§5 L113「v1 的 HELLO 仍发…」→「v1 代际的 HELLO 仍发…（实现代际定义见 §1）」；**§22 既有分块条目 L653「…与 v1 回落（新旧互不破译）」→「…与 v1 代际回落（新旧互不破译；实现代际定义见 §1）」**（N1 采纳——R27 消歧不留残留双义）；§22 新互通条目使用「v1/v2 代际」措辞。CONTEXT.md 增同义词条（§7.6）。**禁止**在协议文档任何位置出现「协议版本 2」「envelope v2」「protocol v2」语义的「v2」用法——契约组 D3 以负向断言锁死。

### 7.4 决策 D4 — 互通矩阵：等价性设计 + wire 层 capability 剥除 interposer（R28）

#### 7.4.1 等价性论证（可执行化）

**命题**：任意含 v1 代际端点的组合，其 wire 行为 ≡ 双方 `HELLO_ACK.selectedCapabilities === 0` 的 v2↔v2 未协商组合。

1. v1 代际端点**定义上**不含 capability：v1 HELLO 恒发 `optionalCapabilities=0`（协议 §5 L113）、v1 hub 支持集为 ∅（bit 仅由 #242+ 代码注册）⇒ 交集恒 0。`selectCapabilities(0, CAP_CHUNKED_UPDATE, 0) = {ok: true, selected: 0}`（纯函数行断言）。
2. v2 端点全部 chunked 行为（发送与接收）门控于协商位单点：peer 逐字消费 `HELLO_ACK.selectedCapabilities`（`peer-connection.ts:473`，「wire 协商位是唯一行为判据」，`types.ts:191-193`）；hub 门控于 onHello 单点交集捕获值（`hub-connection.ts:714-724`/`1025`）。selected=0 ⇒ 发送侧 chunkable 恒 false（`update-channel.ts:151-156`）⇒ 超限走 v1 丢弃 + needs-resync；接收侧 0x42 在 payload 解析前 `UNSUPPORTED_MESSAGE_TYPE` fatal 1002（`payloads.ts:831`）——分类与 v1 codec 未知消息码规则一致（§5/§10.3）。
3. 因此「v1 hub」的 wire 可见差异仅在「offered bit → selected bit」的交集结果为 0 这一点上。

**推论**：在测试里于 HELLO 单帧上把 peer 的 `optionalCapabilities` 位剥除后再交给真实 v2 hub，即得到一个**真实双端**未协商会话（hub 自身状态机经自身交集计算得出 selected=0，非外部改写 ACK）——它与 v1 hub 在 wire 上不可区分，且 hub 侧后续行为（不分块、不期待分块、超限丢弃）全部由真实 v2 代码在未协商分支执行。

#### 7.4.2 构型（File B：`packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts`）

测试纪律与既有套件一致（真实 yjs/Registry/Runtime；fake-duplex；fake scheduler；零 real sleep；零源码 grep 断言）。自备组装（不改 `bootMulti`）：以 `harness.ts` 定义、`issue137-driver.ts` 转出口的构件（`makeNode`/`makeWire`/`okLease`/`settle`/`settleUntil`）直接组装 hub + peer，暴露 `peerChunked` 旋钮与 interposer 开关（N3 归因修正）。极限构型沿用 #233 R1：`maxUpdateBytes=8KiB`、20KB 写。**解码 helper**：自备 `decodeWire(bytes) = decodeMessage(bytes, {selectedCapabilities: CAP_CHUNKED_UPDATE})`（#243 L111-112 先例，N6）——矩阵含 UPDATE_CHUNK 帧的时间线一律经此解码，未协商格经 `{selectedCapabilities: 0}` 构型断言拒绝。

**Interposer（测试本地，~30 行）**：包装交给 `hub.accept` 的 transport 端——`onMessage(fn)` 内先经 codec `decodeMessage` 判型，HELLO（0x01）则以 `encodeMessage({...msg, optionalCapabilities: 0}, {sequence: header.sequence})` 重编码转发，其余帧与 `send`/`close`/`closed`/`onClose` 原样委托（`onMessage` 返回的退订句柄原样透传）；**记录原始/重写 HELLO 字节对为证据**（唯一字节级断言对象，见 M2）。

**M2≡M1 等价证据的三层确定性形态（F1 修订——跨会话不做任何字节/长度全等断言）**：

| 层 | 对象 | 断言 |
|---|---|---|
| (a) 帧序列层 | 两时间线（M1 与 M2 各自独立组装）post-HELLO 的每方向帧流 | `kind#sequence`（消息类型 + envelope sequence）**序列逐项全等**（peerToHub 与 hubToPeer 各自比对）——sequence 为连接内确定性计数器，与 Yjs 随机性无关 |
| (b) 确定性字段层 | 非随机载荷帧 | 解码后**逐字段相等**：`HELLO_ACK.selectedCapabilities`/`protocolVersion`、`RESYNC_REQUIRED.reasonCode`（+namespaceId）、`UPDATE_ACK.ackedSequence`（+namespaceId）、OPEN 族字段（`OPEN_NAMESPACE.namespaceId/hasLocalReplica/replicationId/replicationEpoch`、`OPEN_OK.namespaceId/mode/replicationId/replicationEpoch`）、`BOOTSTRAP_ACK.namespaceId`。**排除会话随机/会话域字段**：`connectionNonce`（16 字节随机 + HELLO_ACK 原样回显）、`connectionId`（hub 生成 `${instanceId}-conn-${connId}`，连接域标识，`hub-connection.ts:765`）、以及一切 Yjs 编码字节 |
| (c) Yjs 承载层 | 载荷含 Yjs 编码字节的帧（`SYNC_STEP1`/`SYNC_STEP2`/`UPDATE`/`UPDATE_CHUNK`，及构型触及的 `BOOTSTRAP_SNAPSHOT`） | **只比 kind + 每 kind 计数（+ namespaceId）**——其字节与字节长度均随会话随机 doc client id（varuint 宽度 1–5）变化，不参与任何相等断言 |

**字节级「4 字节」声明的唯一挂靠点（F1）**：interposer 在**同一会话内**记录的原始 ↔ 重写 HELLO 字节对——两字节串**等长**、envelope `sequence` 相同、解码后除 `optionalCapabilities`（`CAP_CHUNKED_UPDATE` → `0`）外逐字段相等（`peerInstanceId`/`expectedHubInstanceId`/`protocolVersions`/`requiredCapabilities`/`connectionNonce` 全部原样保留）；字节差异位置全部落在 `optionalCapabilities` 4 字节 uint32 BE 字段窗口内（uint32 BE 下通常恰 1 字节值差 `0x01→0x00`，窗口内其余 3 字节两侧本为 `0x00`）。**跨会话（M2 vs M1）不存在任何「唯一允许差异 = 4 字节」类声明**——两会话 HELLO 的 16 字节随机 nonce 与 Yjs 载荷字节本就不同。

| 格 | 构型 | 断言（逐格） |
|---|---|---|
| M1 v1 peer ↔ v2 hub | `chunkedUpdate` 缺省（不传） | HELLO.optionalCapabilities===0；HELLO_ACK.selectedCapabilities===0；20KB peer 写：恰一 `resync-required`（channelState=needs-resync）+ 恰一 wire RESYNC_REQUIRED + 零 UPDATE/零 UPDATE_CHUNK 承载该写 + 收敛经 >8KiB 的 SYNC_STEP2 diff + 回 live；20KB hub 写镜像（hubToPeer 零 UPDATE_CHUNK、resync 收敛）。**resync 恰一性按观测侧分别断言（N4）**：peer 写腿 = 发射侧 hub observer `resync-required{cause:'send-failed', reason:'update-too-large'}` 恰一 + wire RESYNC_REQUIRED 恰一，接收侧 peer remote-declared 处置；hub 写镜像腿对称（发射侧 hub、接收侧 peer）——禁止双 observer 汇总计数 |
| M2 v2 peer ↔ v1 hub | 旋钮 true + interposer | interposer 证据：原始 HELLO（timeline）`optionalCapabilities===CAP_CHUNKED_UPDATE`（v2 确实 offered）、重写后 ===0、字节对断言见上（等长/同 sequence/仅 optionalCapabilities 字段窗口内差异）；HELLO_ACK.selectedCapabilities===0；**M1 全部行为断言逐条成立（含 N4 按侧 resync 断言）**；**M2≡M1 三层确定性等同**：(a) 双时间线 post-HELLO 每方向 `kind#sequence` 序列全等；(b) 确定性字段帧逐字段相等（枚举见上表，排除 nonce/connectionId/Yjs 字节）；(c) Yjs 承载帧只比 kind+计数（+namespaceId） |
| M3 v2 ↔ v2 协商分块 | 旋钮 true、无 interposer | HELLO_ACK.selectedCapabilities===CAP_CHUNKED_UPDATE；20KB peer 写：peerToHub UPDATE_CHUNK ≥2 帧（transferId=1、chunkIndex 0..n-1 连续、Σbytes=totalBytes）+ 恰一 UPDATE_ACK 且 ackedSequence===末 chunk 帧序 + 收敛 + 零 resync-required；20KB hub 写镜像（hubToPeer 分块 + 单 ACK）；#233 R1 反向断言（零 SYNC_STEP2 承载该写） |

**Codec/协商数学锚**（同文件，import 自 `@nomicore/replication-protocol`）：`selectCapabilities(0, CAP_CHUNKED_UPDATE, 0)` → selected 0（v1 hub 数学）；`selectCapabilities(0, CAP_CHUNKED_UPDATE, CAP_CHUNKED_UPDATE)` → selected CAP（v2 hub 数学）；构造 UPDATE_CHUNK 帧 + `decodeMessage(bytes, {selectedCapabilities: 0})` → `UNSUPPORTED_MESSAGE_TYPE`（v1 端收 0x42 ≡ v2 未协商收 0x42 的分类等同锚，补 `codec-issue242-ac-red` AC3 于矩阵语境）。

**v1 基线**：#233 刻画文件不动、继续全绿（AC3 末句）；M1 即传输层 v1 行为参照系。

#### 7.4.3 备选方案与否决理由

1. **生产 seam（hub 侧 supported-capabilities 注入旋钮 / testing surface 覆盖）**——否决：为文档票引入生产行为面，违背「零生产改动」与 R26 收口定界；协议 §6.1 无「hub 支持集可配置」概念，实现该旋钮将迫使规范登记新行为面（docs/AGENTS.md「documentation-only wording changes must not invent implementation behavior」的反向约束），scope 失控。
2. **旧版包多版本 harness**——否决：R29 明令禁止（workspace-only 包、无旧版安装机制）；且依赖锁定互通已在 codec 层由 golden 旧字节 × 新 codec 覆盖。
3. **测试内从零实现完整 raw v1 hub 端点模拟器**——否决：需复刻 OPEN/bootstrap/reconcile/ACK 全协议面，维护成本与失真风险高于单帧 HELLO 剥除；等价性论证（7.4.1）已把「v1 hub」的差异收缩到 HELLO 交集单点，interposer 恰好只在该单点建模。
4. **改写 hub 发出的 HELLO_ACK（selected 1→0）**——否决：制造 hub 内部状态（自认已协商）与 wire 声明分歧的拜占庭构型，hub→peer 方向会继续分块，不是忠实的 v1 hub。
5. **M2≡M1 跨会话 payload 长度序列全等（iteration 0 形态）**——否决（F1）：Yjs clientID 随机 uint32 的 varuint 宽度差使每次运行约两成概率假红；CI 反复假红会迫使弱化断言或加 retry，污染 AC3 证据。以三层确定性形态取代（§7.4.2）。

**诚实边界登记**：interposer 建模的是 v1 hub 的 wire 可见行为（HELLO 交集单点），不运行 pre-#242 hub 代码。残余风险（v1 hub 在其他 wire 点存在差异）由三层既有证据封堵：(a) v1 代码 = 现代码减去全部由协商位门控的分块特性（append-only 切片链 + #243 F1/F6 未协商负控）；(b) #233 刻画测试锁 v1 行为；(c) codec 层 golden 旧字节互通。该边界写入测试文件头注与 §13 残余问题。

### 7.5 决策 D5 — §22 conformance 清单收口（R26/R29）

在 §22 既有分块条目（L653，含 N1「v1 代际回落」改挂）后追加一条（措辞落地时可微调，语义冻结）：

> - 实现代际互通矩阵（issue #246，ADR 0013 已接受；代际定义见 §1）：传输层全组合——v1 peer ↔ v2 hub、v2 peer ↔ v1 hub（未协商 ⇒ 超限丢弃 + reconciliation 的 v1 行为逐字节保持；等同性以三层确定性断言承载：kind#sequence 序列全等、确定性字段帧逐字段相等、Yjs 承载帧按 kind+计数——跨会话字节/长度全等因 Yjs 随机 doc client id 不适用）、v2 ↔ v2（协商分块）；v1 基线 = issue #233 刻画测试（`ws-replication-issue233-repro.test.ts`）；codec 层锚 = 版本协商全矩阵 + 锁定组合 golden 旧字节互通（`codec-version-interop.test.ts`）；传输层锚 = `ws-replication-issue246-interop-matrix.test.ts`；UPDATE_CHUNK 全字段 golden 与 0x42 / CAP_CHUNKED_UPDATE=0x00000001 锁定值 = `codec-messages-golden.test.ts`、`codec-issue242-ac-red.test.ts`。

### 7.6 决策 D6 — CONTEXT.md 词汇修订

1. L142：「（ADR 0013 提议）」→「（ADR 0013 已接受）」。
2. L146 UPDATE_CHUNK 词条：过期注记「issue #242 切片 1 冻结 wire 面，后续切片承接状态机」→「跨帧规则与 assembly 状态机为协议 §10.3 契约（issue #243–#245 落地、#246 收口）」。
3. 新增「实现代际（implementation generation）」词条（与 §7.3 协议词条同义，含 _Avoid_：把 v2 代际误读为协议版本 2 / 用代际推断 envelopeVersion 或 protocolVersions 变化）。
4. 既有「分块复制传输」「CAP_CHUNKED_UPDATE」词条正文不动（与本票结论零矛盾）。

---

## 8. 接口、状态机与数据流

### 8.1 文档结构变化（接口面）

| 文档 | 节 | 变化类型 |
|---|---|---|
| 协议文档 | §1 | +1 词条（实现代际） |
| 协议文档 | §5 L113、§22 L653 | 措辞改挂词条（v1 → v1 代际；N1 含 L653） |
| 协议文档 | §10.3 | 占位句替换为跨帧规则四段（含 F3 错误码三分类）；L301 切片注记中性化 |
| 协议文档 | §22 | +1 互通矩阵条目 |
| ADR 0013 | 状态行、取代与关联 | 状态翻转 + 两层权威登记 + F4 seam 词表单列 |
| CONTEXT.md | L142/L146 + 新词条 | 状态同步 + 过期注记清理 + 增词 |

### 8.2 状态机

零状态机变化：本票不触碰 §15/§16/§21 任何状态、迁移、停机序（R26 冻结面核对——chunked 各切片未改停机序，ADR 0013 自述保持 ADR 0010 语义）。

### 8.3 数据流路线

**零运行时数据流变化**——依据：ALLOW LIST（§11）不含任何 `src/**` 路径；互通矩阵测试只消费既有公共 API（`createHubReplication`/`createPeerReplication`/codec `encode|decodeMessage`/`selectCapabilities`）与既有测试构件；文档修订不产生运行时路径。唯一「新增数据」= 测试内 interposer 对 HELLO 单帧的单次改写（`optionalCapabilities` 4 字节字段，测试域，出 worktree 即消失）。

## 9. 错误、恢复、并发与幂等

- 本票零生产错误语义变化；§10.3 收口写入的错误码三分类映射（首 chunk 声明超限 ⇒ `UPDATE_TRANSFER_TOO_LARGE` fatal/config/failed；跨帧违例/几何不一致/并发超额 ⇒ `UPDATE_TRANSFER_VIOLATION` fatal/no/failed；停滞超时 ⇒ `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}` 非终态）与 §13.2/§9.4 既有登记逐字同向（契约组 D2-3/D5 绿锚锁定，防收口时手滑改值或并类，F3）。
- 测试并发/幂等纪律：矩阵测试遵循套件惯例（fake scheduler、`settleUntil` 有界等待、零 real sleep）；M1/M2 各自独立组装（无跨用例共享状态）；确定性断言不依赖任何跨会话字节相等（F1），fake-duplex 时间线在 fake scheduler 下确定性排空。

## 10. 调用方影响矩阵

| 调用方（文档/契约消费者） | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `@nomicore/replication-protocol` / `@nomicore/ws-replication` 实现与维护者 | 以 ADR 0013 + 分散 issue 注记拼合跨帧契约 | 以协议 §10.3 为 wire 唯一权威（含错误码三分类）；ADR 保留配置/理据 | 零代码改动 | §2.2 实现锚与 §7.1 内容一一对应（含 `update-transfer.ts:184-187` TOO_LARGE） |
| ADR 0013 状态行读者（决策记录） | 「提议」误导决策状态 | 已接受 + 两层权威 + seam 词表单列（F4） | — | §7.2；协议 §23 头注 |
| §22 conformance 资产（SA6/SA7 后续轮） | 互通义务只有 codec 层锚 | 传输层矩阵锚登记（File B）；§22 条目文件名存在性由 D6-1 守护（规范源唯一 = `docs/` + `CONTEXT.md`，F2） | 后续维护按新锚 | §7.5、§12.2 |
| CI / 根测试 | 无 doc 契约断言 | File A 进入 `pnpm test`（vitest include `packages/*/test/**/*.test.ts` 已覆盖两文件） | 零配置改动（`vitest.config.ts` 不动） | `vitest.config.ts` include |
| 外部集成读者（CONTEXT.md 词汇） | 「ADR 0013 提议」误导决策状态 | 已接受 + 代际词条 | — | §7.6 |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `docs/protocols/instance-replication-v1.md` | §1 +词条；§5 L113 与 §22 L653 措辞改挂；§10.3 占位替换（L301/312，含 F3 错误码三分类）；§22 +互通条目 | AC1/AC4/AC5；§7.1/7.3/7.5 |
| `docs/adr/0013-chunked-live-update-transfer.md` | 状态行 + 取代与关联节（L4、L120-122；F4 枚举拆分） | AC2；§7.2 |
| `CONTEXT.md` | L142/L146 注记清理 + 实现代际词条 | AC1（词汇零矛盾）/AC5；§7.6 |
| `packages/replication-protocol/test/codec-issue246-doc-contract.test.ts` | 新建 `[SA6 owned]`：文档契约测试（§12.2 D1–D6；文件名维持 `codec-` 前缀 = 与同目录 `codec-package-contract.test.ts` 命名谱系一致，N5 登记不改） | AC1/AC2/AC4/AC5 可执行化 |
| `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts` | 新建 `[SA6 owned]`：传输层互通矩阵 + interposer（§12.3，F1 三层断言） | AC3 可执行化 |
| `wiki/raw/task_issue-246_design.md` | 本设计（SA1 产出与后续修订） | 流程产物 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/ws-replication/src/**`、`packages/replication-protocol/src/**` | 实现面 | 零生产改动定界（§1.2）；R28 经等价性设计消解，不加 seam |
| `packages/ws-replication/test/ws-replication-issue233-repro.test.ts` | v1 基线刻画 | ADR 0013 L110「不改刻画文件」；AC3 要求其继续全绿 |
| `packages/ws-replication/test/issue137-driver.ts`、`driver.ts`、`harness.ts` | 共享测试构件 | 矩阵测试自备组装；不为旋钮改共享 fixture（R26 收口定界；#245 observer-red 同先例） |
| 既有 codec 测试五件（golden/issue242-ac-red/version-interop/malformed/registries 等） | 既有 conformance 锚 | 只读锚定；矩阵数学锚入 File B，不重复登记（R26/R29） |
| `docs/adr/0010-*.md` 及其余 ADR、`docs/protocols` 其他文件 | 权威边界 | ADR 0010 分块引用为零，无需动；其余 ADR 零交集（SA8 §2 交叉检查） |
| §5/§6.1/§13.2/§17/§23 既有登记行（协议文档内） | 已冻结登记 | R26：不重复登记、不改冻结值（§17 L535 配置权威归属保持）；§22 L653 仅做 R27 词汇改挂，不改义务语义 |
| `vitest.config.ts`、根/包 `package.json`、`tsconfig*` | 测试接线 | include 模式已覆盖新测试文件 |
| `apps/**`、`domains/**`、其余 `packages/**`、`wiki/raw/`（本设计外） | 无涉 | 零交集；wiki/raw 为非规范 evidence（docs/AGENTS.md Authority 节），File A/B 断言源禁止指向 |

## 12. 可执行验收契约（red-light contract）

### 12.1 总则（F2 修订：红面精确枚举，与 §12.2 表内标注一一对应）

- **红面**（实现前必红、实现后转绿）= File A 的 **D1-1、D1-2、D1-3、D1-4、D1-5、D2-1、D2-2、D2-3、D3-1、D3-3、D4-1、D4-2**（共 12 条；D1-1..4、D2-1..3、D3-1、D3-3、D4-1/2 为 SA2 F2 指定真红组，D1-5 为 F4 修订新增的 seam 词表单列锚——现行 ADR 状态行无该句，同为实现前红；均实测红于文档现状）。
- **绿面**（实现前后恒绿，回归锁定）= File A 的 D2-4、D3-2、D5-1..D5-5、D6-1、D6-2、D6-3 + File B 全部（行为已由切片 1–4 落地——AC3 要求「提交并绿」，本票对行为面是 conformance 证据而非红灯）。**D6-1 落地前为空洞绿**（现行 §22 零 `*.test.ts` 文件名 ⇒ 解析得空集 ⇒ 空洞通过），随 §22 新条目落地转为携带真实存在性检查的绿——不属红面。
- 运行前缀统一：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run <file>`（与根 `pnpm test` 脚本同源条件）。

### 12.2 File A — `packages/replication-protocol/test/codec-issue246-doc-contract.test.ts`

**断言源纪律（F2-3）**：经 `readFileSync(new URL('../../../<path>', import.meta.url))` **只读取 `docs/` 下文件与 `CONTEXT.md`**（先例：`codec-package-contract.test.ts` 读文件；N3：头注登记「跨出包界读仓库根 docs/CONTEXT.md」的读取边界——包内既有先例只读本包文件，本文件为 docs 契约测试的新惯例）。**禁止读取 `wiki/raw/**`**——该目录为非规范 evidence（`docs/AGENTS.md:5`「Historical wiki/raw artifacts are evidence, not normative contracts」），且为未跟踪任务产物，契约测试不得依赖。断言以「锚定子串/正则存在于指定节切片」为形态；节切片按最近标题切分。

| 组 | # | 断言 | 红/绿 |
|---|---|---|---|
| D1 ADR 状态与权威 | D1-1 | ADR 0013 含 `状态：已接受`；不含 `状态：提议` | 红 |
| | D1-2 | ADR 0013 权威让渡锚：`docs/protocols/instance-replication-v1.md` + `唯一权威` + wire 让渡范围词（`wire 冻结值`/消息码/字段序/capability/错误码/reason 词表锁定值枚举）同现；**该枚举子句不含「事件词表」**（F4——事件词表不得从属于 wire 冻结值） | 红 |
| | D1-3 | 两层边界锚：配置权威保留表述（`配置表` 权威归本文）在状态行或取代与关联节 | 红 |
| | D1-4 | 取代与关联节含两层权威锚（wire 冻结值 → 协议文档 / 配置与理据 → 本文）且不含旧未来时子句「接受后以该文档修订」 | 红 |
| | D1-5 | observer seam 词表单列锚：状态行或取代与关联节含「事件词表」+ seam 定位词（`local seam` 或 `非 wire 契约`）同现，且该句不含「wire 冻结值」从属表述（F4——与协议 §23 头注零冲突） | 红 |
| D2 §10.3 完整契约 | D2-1 | §10.3 切片不含 `属后续切片` | 红 |
| | D2-2 | 含发送端锚：进入条件（`> maxUpdateBytes` ∧ 协商 ∧ live）、出队惰性切片、每帧独立 sequence、round-robin/窗口槽、ACK 锚 = 末 chunk、中止复用 | 红 |
| | D2-3 | 含接收端锚：assembly 作用域四元组、首 chunk 分配前二维上界 + 几何一致、**首 chunk 声明超限 ⇒ `UPDATE_TRANSFER_TOO_LARGE`（F3 新增锚）**、`UPDATE_TRANSFER_VIOLATION`（跨帧违例/几何不一致/并发上限）、`chunkIndex === 已收数量`、收齐一次 apply + `UPDATE_ACK`（ackedSequence = 末 chunk 帧序）、`UPDATE_TRANSFER_EXPIRED` 超时路径、apply 前零 live 写入 | 红 |
| | D2-4 | 未协商门控句保留（`UNSUPPORTED_MESSAGE_TYPE` + 1002 + payload 解析前） | 绿（回归） |
| D3 术语一致 | D3-1 | 协议 §1 含 `实现代际` 词条 + 三层消歧锚（`envelopeVersion` 恒 1 / `protocolVersions` 不变 / 非 protocol 版本） | 红 |
| | D3-2 | 协议文档不含 `协议版本 2`、`envelope v2`、`protocol v2` 类误读串（负向断言） | 绿 |
| | D3-3 | CONTEXT.md 含 `实现代际` 词条；不含 `ADR 0013 提议`；UPDATE_CHUNK 词条不含 `后续切片承接` | 红 |
| D4 §22 收口 | D4-1 | §22 含互通矩阵条目：三代际格 + 三层确定性等同表述（`kind#sequence` + 确定性字段 + kind/计数）+ v1 基线指向 #233 刻画文件名 | 红 |
| | D4-2 | §22 分块/互通条目含锁定值 `0x42` 与 `0x00000001` 及 golden/矩阵测试文件指向（`0x00000001` 与文件指向为新增面） | 红 |
| D5 三方一致绿锚 | D5-1 | §5 注册表行含 `` `0x42` | UPDATE_CHUNK ``；§6.1 行含 `0x00000001` + `CAP_CHUNKED_UPDATE`；§13.2 含 `UPDATE_TRANSFER_VIOLATION`/`UPDATE_TRANSFER_TOO_LARGE` 行；§9.4 含 `UPDATE_TRANSFER_EXPIRED` 行 | 绿 |
| | D5-2 | §17 含四配置键名 + 链①②不变量行；`不得运行时 clamp` 在节内 | 绿 |
| | D5-3 | §23.1 含 `chunked-update-sent`/`-applied`/`-acked`/`-aborted` 四型行 | 绿 |
| | D5-4 | 实现侧三方锁：`MESSAGE_TYPES.UPDATE_CHUNK === 0x42`、`CAP_CHUNKED_UPDATE === 0x00000001`（import 自本包）与文档登记值相等 | 绿 |
| | D5-5 | §10.3 字段表六字段序（namespaceId→transferId→chunkIndex→chunkCount→totalBytes→bytes）保持 | 绿 |
| D6 引用完整性 | D6-1 | **唯一规范源**：解析**协议文档 §22 节切片**、ADR 0013、CONTEXT.md 分块词条中出现的全部 `*.test.ts` 文件名，逐一断言相对仓库根存在（链接与引用文件名检查的可执行化）。**红绿归类：随 §22 新条目转绿（落地前空洞绿——现行 §22 零文件名，解析得空集空洞通过；ADR 0013 既有 `ws-replication-issue233-repro.test.ts` 引用为真实通过项），移出红面**。无任何「§7.5」指涉（F2——设计文档节号不是规范断言源） | 绿（落地前空洞绿 → 落地后携带真实存在性检查） |
| | D6-2 | ADR 0013 与 CONTEXT.md 分块词条中引用的 `docs/...` 路径全部存在 | 绿 |
| | D6-3 | ADR 0010 零分块引用守卫：`UPDATE_CHUNK|CAP_CHUNKED|分块` 在 `docs/adr/0010-*.md` 零命中 | 绿 |

### 12.3 File B — `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts`

`describe('issue #246 实现代际互通矩阵（ADR 0013 L25；未协商 ⇒ v1 超限行为保持）')`：

1. `M1 v1 peer ↔ v2 hub`（§7.4.2 断言列；resync 恰一性按观测侧断言，N4）。
2. `M2 v2 peer ↔ v1 hub（HELLO capability 剥除 interposer）`：
   - interposer 证据：原始 HELLO `optionalCapabilities===CAP_CHUNKED_UPDATE`、重写后 ===0；
   - **interposer 字节对断言（同会话单帧，F1 唯一字节级断言）**：原始/重写字节串等长、envelope sequence 相同、解码后除 `optionalCapabilities` 外逐字段相等（含 connectionNonce 原样保留）、字节差异位置全部落在 optionalCapabilities 4 字节字段窗口内；
   - M1 全部行为断言逐条成立（含 N4 按侧 resync 断言）；
   - **M2≡M1 三层确定性等同（F1——无任何跨会话字节/长度相等项）**：(a) post-HELLO 每方向 `kind#sequence` 序列逐项全等；(b) 确定性字段帧逐字段相等（HELLO_ACK.selectedCapabilities/protocolVersion、RESYNC_REQUIRED.reasonCode、UPDATE_ACK.ackedSequence、OPEN 族字段、BOOTSTRAP_ACK.namespaceId；排除 connectionNonce/connectionId/Yjs 字节）；(c) Yjs 承载帧（SYNC_STEP1/2、UPDATE、UPDATE_CHUNK、BOOTSTRAP_SNAPSHOT）只比 kind+计数（+namespaceId）。
3. `M3 v2 ↔ v2 协商分块`（§7.4.2 断言列，双方向；UPDATE_CHUNK 帧经 `decodeWire`（`{selectedCapabilities: CAP}`，#243 先例，N6）解码断言）。
4. `协商数学与分类等同锚`：`selectCapabilities` 两行 + 未协商 0x42 解码拒绝（close 1002 分类）。
5. 文件头注登记等价性论证、诚实边界（§7.4.1/§7.4.3）与「M2 确定性断言不含跨会话字节/长度相等」的纪律依据（F1）。

### 12.4 命令与预期状态

| 命令 | 实现前 | 实现后 |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/replication-protocol/test/codec-issue246-doc-contract.test.ts` | **红**（真红组 D1-1..5、D2-1..3、D3-1、D3-3、D4-1/2 失败于文档现状；D2-4/D3-2/D5-*/D6-* 绿——D6-1 空洞绿不贡献红） | 绿 |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts` | 绿（行为面 conformance；确定性断言零随机性依赖，F1） | 绿 |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue233-repro.test.ts` | 绿（v1 基线） | 绿（AC3 末句） |
| `pnpm typecheck` | 绿 | 绿 |
| `pnpm test` | 新 File A 红 / File B 绿 | 全绿 |
| `git diff --check` | 干净 | 干净（AC5） |
| 过期术语搜索：`grep -rn "提议" docs/ CONTEXT.md`（N2 全局——R31「以『提议』为零」的忠实形态） | 恰 2 处命中（ADR 0013 L4、CONTEXT.md L142） | **零命中** |
| 定向过期术语搜索：`grep -n "状态：提议" docs/adr/0013-*.md`；`grep -n "ADR 0013 提议" CONTEXT.md`；`grep -n "属后续切片" docs/protocols/instance-replication-v1.md`；`grep -n "后续切片承接" CONTEXT.md`；`grep -nE "UPDATE_CHUNK|CAP_CHUNKED|分块" docs/adr/0010-*.md` | 前四者各有命中、末者零命中 | **全部零命中**（AC5） |

### 12.5 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 三方逐字一致 | §2.1/§2.2 锚点 | File A D2/D5（D2-3 含 TOO_LARGE 锚，F3） | D2 红→绿；D5 恒绿 |
| AC2 接受 + 权威归属 | ADR L4 转移机制 | File A D1（D1-2/D1-5 锚 F4 拆分后枚举） | 红→绿；D1-2 枚举不含「事件词表」、D1-5 seam 句与 §23 头注零冲突 |
| AC3 互通矩阵 | #233/codec 层既有 | File B M1–M3 + 数学锚 | 恒绿；M2≡M1 三层确定性等同全成立；**SA7 动态轮抽查 M2 ≥20 次重复运行零假红（F1 验收）** |
| AC4 §22 收口 | L652-653 | File A D4（红→绿）+ D6-1（落地前空洞绿→落地后真实存在性检查，F2） | D4 红→绿；D6-1 全程绿且落地后非空洞 |
| AC5 文档验证 | docs/AGENTS.md Verification | §12.4 命令表后七行（含 N2 全局搜索） | 全零命中/干净 |
| R28 等价性泄漏风险 | §7.4.1 论证 | M2 interposer 证据（字节对断言）+ 分类锚 | selected=0 且三层确定性等同全成立 |
| 收口手滑改冻结值 / 错误码并类 | §2.1 登记现状（§13.2 L413） | File A D2-3 + D5 + 既有 codec/ws 套件 | 恒绿（任何值漂移或 VIOLATION/TOO_LARGE 并类即红） |

## 13. 风险、回滚和残余问题

| 风险 | 缓解 | 回滚 |
|---|---|---|
| §10.3 收口措辞与 ADR/实现出现非逐字漂移（含错误码并类） | File A D2-3（含 TOO_LARGE 锚）+ D5 三方锁 + SA2/SA9 评审 | 文档单文件 revert，零运行时耦合 |
| interposer 等价性论证存在未建模 wire 差异 | §7.4.3 诚实边界 + 三层既有证据（负控/刻画/golden 旧字节）；矩阵文件头注登记 | 删 File B 单文件；后续票若需更强证据可提议 testing seam（独立决策） |
| M2 断言跨会话随机性假红（iteration 0 形态的闪断） | **已消除（F1）**：三层确定性断言不含任何跨会话字节/长度相等项；SA7 动态轮 ≥20 次重复抽查兜底 | — |
| ADR 接受时点早于父 PR #241 合并（R30） | 切片链先例一致；ADR L4 预设同票闭环；总控留意项：#241 若方向性返工需复审 SA8 结论 | ADR 状态行独立回滚 |
| §22 条目落地后引用悬空（文件名指向不存在资产） | D6-1 落地后为真实存在性检查（非顺序敏感红灯，F2 修订）；File B 与文档同票交付 | — |
| 残余 follow-up（非本票必要条件）：`CAP_CHUNKED_SYNC`（R3 另一半尾部）属 ADR 0013 非目标，未经本票推进 | — | — |

**任务内无未解决必要条件**；无阻塞。命名注记（N5）：File A 维持 `codec-` 前缀与同目录 `codec-package-contract.test.ts` 谱系一致，不改名。

## 14. 评审修订映射（iteration 1 — `wiki/raw/task_issue-246_sa2_review.md`）

| Finding | 严重度 | 修订位置 | 处理结果 |
|---|---|---|---|
| F1（M2≡M1 跨会话 payload 长度序列全等闪断；「唯一差异 = HELLO 4 字节」跨会话不可执行） | MAJOR | §7.4.2（三层确定性形态表 + interposer 字节对断言 + M2 行重写 + 备选方案 5 否决）、§12.3-2、§12.5 AC3 行、§13 闪断风险行、§2.3 依赖随机性事实、§0/§4/复现承接表措辞同步 | **已落实**：M2≡M1 改为 (a) kind#sequence 序列全等、(b) 确定性字段帧逐字段相等（枚举字段，排除 nonce/connectionId/Yjs 字节）、(c) Yjs 承载帧只比 kind+计数（+namespaceId）；「4 字节」声明唯一挂靠 interposer 同会话原始↔重写 HELLO 字节对（等长、同 sequence、差异限于 optionalCapabilities 4 字节窗口）；§12.3 断言清单零跨会话字节/长度相等项；SA7 ≥20 次重复零假红入验收映射 |
| F2（D6-1 红灯归类错误——现行 §22 零文件名为空洞绿；「§22/§7.5」来源歧义） | MAJOR | §12.1（红面精确枚举：SA2 指定真红组 D1-1..4、D2-1..3、D3-1、D3-3、D4-1/2 + F4 新增 D1-5，共 12 条；D6-1 移出红面）、§12.2 D6-1 行（唯一规范源 = 协议文档 §22 + ADR 0013 + CONTEXT.md 分块词条；空洞绿归类；删除「§7.5」指涉）、§12.2 断言源纪律段（只读 `docs/` + `CONTEXT.md`、禁读 `wiki/raw`，引 `docs/AGENTS.md:5`）、§12.4 File A 预期状态、§12.5 AC4 行、§13 D6 行、DENY LIST wiki/raw 行 | **已落实**：D6-1 无「§7.5」指涉、归类「落地前空洞绿 → 随 §22 新条目转绿」；§12.1 红面清单与 §12.2 表内红/绿标注一一对应（红 = D1-1..5/D2-1..3/D3-1/D3-3/D4-1/2）；File A 只读 docs/ + CONTEXT.md 明示 |
| F3（§10.3 收口未指定首 chunk 声明超限 ⇒ `UPDATE_TRANSFER_TOO_LARGE`；D2-3 锚集缺该码） | MAJOR | §7.1-3（错误码三分类映射显式化：声明超限 ⇒ TOO_LARGE；几何不一致/后续帧跨帧违例/连接级并发超额 ⇒ VIOLATION；停滞超时 ⇒ RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}）、§12.2 D2-3（+TOO_LARGE 锚）、§12.5 AC1/收口手滑行、§9 | **已落实**：D2-3 含 TOO_LARGE 锚；§10.3 内容规范与 §13.2 L413 分类逐字同向（「任一不符 ⇒ VIOLATION」的并类措辞已删除，三分类分列） |
| F4（ADR 0013 状态行把 observer「事件词表」并入「wire 冻结值」，与协议 §23 local seam 定位矛盾） | MAJOR | §7.2-1（枚举拆分：wire 冻结值 = 消息码/字段序/capability/错误码/reason 词表锁定值；事件词表单列「local seam 词表（协议 §23，非 wire 契约）——登记随协议文档维护」）、§7.2-2（取代与关联同步）、§12.2 D1-2（枚举不含「事件词表」负向断言）+ D1-5 新增（seam 词表单列锚）、§12.5 AC2 行、R31 行 | **已落实**：修订后状态行不含「事件词表」从属「wire 冻结值」的表述；D1-2/D1-5 断言文本与 §23 头注「不改变任何 wire 字节」零冲突 |
| N1（R27 残留：§22 L653「v1 回落」未改挂） | 观察 | §7.3（L653 →「v1 代际回落」改挂入清单）、§8.1、ALLOW LIST 协议文档行、R27 行 | 已采纳改挂 |
| N2（全局「提议」搜索缺失） | 观察 | §12.4（+`grep -rn "提议" docs/ CONTEXT.md`：实现前恰 2 处 → 实现后零命中）、§1.1-5、R31 行 | 已采纳 |
| N3（settle\* 归因失准；File A 跨包读取边界未登记） | 观察 | §2.3（harness.ts 定义、driver 转出口）、§7.4.2（构件来源修正）、§12.2 断言源纪律（头注登记读取边界） | 已采纳 |
| N4（「恰一 resync-required」未指明观测侧） | 观察 | §7.4.2 M1/M2 行（发射侧 observer `resync-required{cause:'send-failed', reason:'update-too-large'}` 恰一 + wire 帧恰一 + 接收侧 remote-declared 处置；禁止双 observer 汇总）、§12.3-1/2 | 已采纳，SA6 落地按侧断言 |
| N5（File A `codec-` 前缀弱命名） | 观察 | §11 ALLOW LIST（登记维持命名的理由：与同目录 `codec-package-contract.test.ts` 谱系一致）、§13 注记 | 已登记不改（SA2 明示可不改） |
| N6（File B 需自备 `{selectedCapabilities: CAP}` decode helper） | 观察 | §7.4.2（`decodeWire` = #243 L111-112 先例点名）、§12.3-3 | 已采纳 |

F1–F4 全部为 SA2 `Required revisions` 表逐条对应落实；6 条非阻塞观察全部吸收（N5 为登记不改）。无无法落实项、无待决策冲突。

## 15. 是否需要设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）**。理由：(1) 本设计修订既有决策状态（ADR 0013 提议→已接受）并登记权威让渡——属「修订既有决策」面；(2) SA8 门禁 §5 明示 R26–R28 为「设计后复审（轻量）核对项」，其中 R28 的等价性设计取舍（否决生产 seam、采用 interposer + 三层确定性断言）与 R26 的收口定界正是指定核对对象；(3) 协议规范文档（wire 契约权威）实质扩节。SA2 评审确认其 findings 不扩大该复审范围（§16：无新增 ADR 冲突面）；本 iteration 1 修订未引入新的权威面或语义变化，不改变该结论。R29–R31 为落地同步义务，随实现交付核销。

# 设计与验收契约 — issue #242：UPDATE_CHUNK codec 与 CAP_CHUNKED_UPDATE 协商（issue #233 切片 1）

> 阶段：design（SA2 评审修订），iteration 1，SA1。本文档整体改写为当前唯一一致设计，历史版本表述已删除。
> 输入：`wiki/raw/task_issue-242.md`（Host 经 REST 刷新的 Issue 正文；**评论区为空，REST 返回 `[]`——无 Owner 评论要求适用**；iteration 1 dispatch 刷新结果同为 `[]`）。
> 评审输入：`wiki/raw/task_issue-242_sa2_review.md`（reject：F1 BLOCKER + F2 MAJOR + F3/F4 MINOR + O2；逐条映射见 §14）。
> 上游产物：无 `task_issue-242_sa6_contract.md`、无 `task_issue-242_relevant_decisions.md`、无 `task_issue-242_conflict_report.md`（首次派发即如此；替代证据见 §5/§6）。
> 本切片 = ADR 0013 的 wire 地基：**只交付协议包能力，不改任何发送/接收运行时行为**；ws-replication 仅允许两处单 case 的类型兼容补丁（§7 D-8，运行时构造性不可达）。

## 1. 任务类型、目标与非目标

**类型**：Feature（协议 append-only 扩展，issue #233 的切片 1；父 PR #241 `feat/issue-233-chunked-update-base`）。

**目标**（Issue「What to build」逐项）：

1. 新增自描述 `UPDATE_CHUNK` 消息（`namespaceId / transferId / chunkIndex / chunkCount / totalBytes / bytes`）的编解码与 golden vectors；
2. HELLO 协商新增 `CAP_CHUNKED_UPDATE` capability bit（交集生效；envelope version 与 flags 不变）；
3. append-only 注册两个 namespace 错误码（`UPDATE_TRANSFER_VIOLATION`、`UPDATE_TRANSFER_TOO_LARGE`）与一个 RESYNC reason（`UPDATE_TRANSFER_EXPIRED`）；
4. 未协商端收到 UPDATE_CHUNK 按既有未知消息码规则响亮关闭连接（新旧实现互不破译）。

**非目标**（Issue + ADR 0013 约束 + SA2 F1 修订）：

- 不改变任何发送/接收**运行时行为**：`packages/ws-replication` 的 `decodeInbound` 零改动、HELLO 仍发 `optionalCapabilities: 0` / `selectedCapabilities: 0`；**唯一例外**是 §7 D-8 指定的两处 `dispatchReady` 穷尽 switch 单 case 类型兼容分支（编译层必需、运行时构造性不可达，见 §11 收窄后的 DENY LIST）；
- 不实现发送端切片、接收端 assembly 状态机、`maxChunkedUpdateBytes`/`maxChunksPerUpdate`/`assemblyTimeoutMs`/`maxConcurrentAssembliesPerConnection` 配置链（ADR 0013 资源上限表，后续切片）；
- 不做跨 chunk 的 transfer 一致性/顺序校验（`chunkIndex === 已收数量`、transferId 单调等属接收端状态机）；
- 不改 envelope（version 恒 1、flags 恒 0、20-byte 头不变）；不新增 ACK 消息；不提高 `maxUpdateBytes`；
- 不实现 `CAP_CHUNKED_SYNC`（SYNC_STEP2/BOOTSTRAP 分块，ADR 0013 非目标）。

## 2. 当前行为与证据锚点

| 事实 | 锚点 |
|---|---|
| 消息注册表恰 17 条 v1 消息，0x42 未注册；未注册码在 decodeFrame 步骤 6 → connection fatal `UNSUPPORTED_MESSAGE_TYPE` | `packages/replication-protocol/src/messages.ts:43-98`；`src/envelope.ts:108-112`；`test/codec-registries.test.ts:72-80`（现断言 `0x42` 未注册，实现后须翻转为已注册） |
| `test/codec-envelope.test.ts:88-89` 以 0x42 作为「未注册码」样本 | `test/codec-envelope.test.ts:88-89`（实现后须换成仍空闲的码，如 0x43） |
| payload 编解码：CanonicalReader 有界读 + 字段规则 + `expectEnd` 完全消费；非 canonical varUint/非法 UTF-8/超界/尾随 → `MALFORMED_FRAME`；分配前检查 `pos+len ≤ end`（无越界分配） | `src/canonical.ts:90-207`；`src/payloads.ts:733-739` |
| ERROR wire 的 scope/fatal/retryable 位由注册表推导、不一致即 `MALFORMED_FRAME`（decodeError/encodeError 区段） | `src/errors.ts:112-139`；`src/payloads.ts:257-339` |
| uint32 语义字段族经 `readVarUint32`/`writeVarUint32`（>0xffffffff 拒绝） | `src/canonical.ts:177-184, 238-241`；`src/payloads.ts:114-116` |
| HELLO 携带 `requiredCapabilities`/`optionalCapabilities`（uint32 BE），HELLO_ACK 携带 `selectedCapabilities`；`selectCapabilities` 纯函数：required 全支持才 ok、optional 取交集 | `src/payloads.ts:120-213`；`src/negotiation.ts:26-29`；规范 §6.1/§6.2 |
| namespace 错误注册表恰 20 条（冻结、append-only） | `src/errors.ts:112-139`；规范 §13.2 |
| `decodeMessage(bytes, { expectedSequence, maxFrameBytes, limits })` 是 ws-replication 唯一解码入口；`decodeInbound` 不传任何 capability（只传 expectedSequence/maxFrameBytes） | `packages/ws-replication/src/frame-io.ts:58-67` |
| **ws-replication 两处 `dispatchReady(message: ReplicationMessage)` 穷尽 switch 以 `const never: never = message` 收尾**：联合追加 `UpdateChunkMsg` 后 default 分支窄化为 `UpdateChunkMsg`，赋 `never` 即 TS2322，root `pnpm typecheck` 必红 | `packages/ws-replication/src/hub-connection.ts:791`、`src/peer-connection.ts:522`；root `package.json` scripts.typecheck 逐包 tsc 链含 `tsc -p packages/ws-replication/tsconfig.json`（SA2 F1，经隔离实验复现 TS2322） |
| 两连接类均有 `private connectionFatal(code: string, wsCloseCode: number)`；decode 异常收口链把 `ProtocolError.code` 原样送 `connectionFatal(code, wsCloseCodeFor(code))`，`UNSUPPORTED_MESSAGE_TYPE` → 1002 | `hub-connection.ts:872`、`peer-connection.ts:828`；`hub-connection.ts:604-616`（catch 链）+ `hub-connection.ts:1017-1023`（`wsCloseCodeFor`：FRAME_TOO_LARGE→1009、IDENTITY/POLICY→1008、其余→1002）；`peer-connection.ts:360-371` |
| HELLO 发送端：peer `optionalCapabilities: 0`、hub `selectedCapabilities: 0`（v1 现状） | `packages/ws-replication/src/peer-connection.ts:333`、`src/hub-connection.ts:707` |
| `DecodeOptions` 现有 `maxFrameBytes`/`expectedSequence`/`limits`；选项非法值 → `CONNECTION_POLICY_VIOLATION`（响亮，不 clamp）；`resolveExpectedSequence` 是**急切校验**先例（decodeFrame 对所有消息先行生效） | `src/limits.ts:22-67`（急切先例：`resolveExpectedSequence`，limits.ts:53-60） |
| 规范 §9.4 对 RESYNC `reasonCode` 仅约束为非空 varString（「稳定安全原因」），**并无已枚举的闭集合词表** | `docs/protocols/instance-replication-v1.md:243-248` |
| 超限大 update 现状 = 丢弃 + needs-resync（本票不动） | ADR 0013 背景；`packages/ws-replication/test/ws-replication-issue233-repro.test.ts`（R1/R2/R3 基线刻画，保留） |
| wire 变更验证门：包 AGENTS 明示「Wire changes require … root `pnpm typecheck` and `pnpm test`」+ 新旧互通证据 | `packages/replication-protocol/AGENTS.md` Verification |
| lib0 锁定 `0.2.117`（golden 十六进制编码行为依据） | `pnpm-lock.yaml:793` |

## 3. 能力缺口

协议包当前无法表达「分块传输」的任何 wire 面：无 0x42 消息（编解码/注册表/golden）、无 capability 常量与解码门控、错误注册表无 transfer 语义码、RESYNC 词表无过期 reason。后续 ws-replication 切片（发送切片/接收 assembly）全部依赖本切片先冻结这些 wire 值。

## 4. Owner 要求落实

| 来源 | Requirement | 设计章节 |
|---|---|---|
| Issue 正文 What to build | UPDATE_CHUNK 自描述消息编解码 + golden vectors（字段序以 ADR 0013 为准） | §7 D-1、§8、§12 AC1 |
| Issue 正文 What to build | HELLO `CAP_CHUNKED_UPDATE` bit 交集协商；envelope version/flags 不变 | §7 D-2/D-3、§12 AC3 |
| Issue 正文 What to build | 两个 namespace 错误码 + 一个 RESYNC reason（append-only） | §7 D-4/D-5、§12 AC4 |
| Issue 正文 What to build | 未协商端收 UPDATE_CHUNK 按未知消息码规则响亮关闭；只交付协议包能力 | §7 D-3/D-8、§9、§12 AC3 |
| Issue AC1–AC5 | 见 §12 验收映射逐条 | §12 |
| Issue Comments | **无评论（REST 返回 `[]`）——无额外 Owner 要求；iteration 1 dispatch 刷新结果同为空，无新增** | — |

## 5. 复现和根因承接

无 SA6 诊断/契约产物（首次派发）。替代证据链：

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 单帧超限 update 不可发送：丢弃 + needs-resync；SYNC_STEP2 控制帧绕开 data 记账；R3 终局 failed | ADR 0013 背景（引用 `ws-replication-issue233-repro.test.ts` 实测） | 本切片只建 wire 地基，不触碰该行为；基线刻画测试不动 |
| 协议 append-only 演进是既定纪律（消息码/capability/错误码/close 分类为兼容注册表） | `packages/replication-protocol/AGENTS.md` Boundaries；规范 §5 | 新面全部走 append-only：1 个消息码、1 个 capability bit、2 个错误码、1 个 reason，零重编号/重解释 |
| 本任务无需根因修复（Feature 切片），「缺口」= 协议面不存在 | §3 | 红灯契约（§16）以可执行失败证明缺口 |

## 6. SA8 约束落实

无 SA8 冲突报告/相关决议产物。已直接读取治理 ADR 与包 AGENTS：

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| ADR 0013（提议态）：UPDATE_CHUNK 字段序/码值 0x42/CAP bit 0x1/两条错误码语义/RESYNC reason/envelope 不变/「本票只交付协议包能力」 | §7 D-1~D-5、§8 | 逐字落实（golden 字段序以 ADR 0013 表为唯一权威）；「只交付协议包能力」= 运行时零行为变化（ws-replication 类型兼容补丁运行时不可达，§7 D-8） | **是**（见 §15） |
| ADR 0013：ACK 复用 UPDATE_ACK（ackedSequence=末 chunk 帧序），不新增 ACK 消息 | §8 注册表 ack 列 | `ack: 'UPDATE_ACK'` | 否（按 ADR 原文） |
| ADR 0013：chunk 大小复用 `maxUpdateBytes`（零新 frame 级上限） | §7 D-6 | codec 对 bytes 复用 `FieldLimits.maxUpdateBytes` → `UPDATE_TOO_LARGE` | 否 |
| ADR 0010/规范 §3/§5：一 message 一 frame、20-byte 头、未知码 connection fatal、扩展必须 HELLO 显式协商 | §7 D-3、§8 | UPDATE_CHUNK 不改固定头；解码门控以协商结果为前提（fail-closed） | 否（按既有裁决） |
| ADR 0013「落地时须修订 docs/protocols/instance-replication-v1.md + CONTEXT.md 词汇」 | §11 ALLOW LIST（文档面） | 实现阶段随实现同步修订；reason 词表是**首次定义**而非「向既有闭集合追加」（§7 D-5，SA2 F4） | 是（同 §15 一并复查） |
| 包 AGENTS Verification：wire 变更须 root `pnpm typecheck` + root `pnpm test` + 新旧互通证据 | §12 AC5、§16、§17 | root typecheck exit 0 列为独立转绿证据项（SA2 F1 修订 4）；互通证据 = AC3 v1 回落用例 + 既有 139+ 用例 | 否（执行既有门） |

## 7. 设计决策与主要备选方案

### D-1 消息形态与字段规则（wire 契约核心）

`0x42 UPDATE_CHUNK (namespace)`，payload 字段序（**ADR 0013 唯一权威**，lib0 canonical）：

| # | 字段 | 编码 | codec 级规则（单帧、无状态） |
|---|---|---|---|
| 1 | namespaceId | varString | `^ns-[0-9a-f]{32}$`（复用 `checkNamespaceId`） |
| 2 | transferId | varUint | uint32 域（`readVarUint32`/`writeVarUint32`）且 ≥ 1（ADR：域内从 1 严格递增；0 非法） |
| 3 | chunkIndex | varUint | uint32 域，0-based，且 < chunkCount |
| 4 | chunkCount | varUint | uint32 域，≥ 1 |
| 5 | totalBytes | varUint | uint32 域，且 ≥ bytes.byteLength（单 chunk 是全量的切片） |
| 6 | bytes | varUint8Array | 非空（空分片无意义）；提供 `limits.maxUpdateBytes` 时 ≤ 该值 → `UPDATE_TOO_LARGE` |

- decode/encode 执行同一套规则（既有 R9 对称原则）；违规 → `MALFORMED_FRAME`。
- 跨帧规则（transferId 一致性/单调、`chunkIndex === 已收数量`、`totalBytes ≤ maxChunkedUpdateBytes`、实收 == totalBytes）**不在本切片**——它们属接收端 assembly 状态机（ADR 0013 接收端规则），且依赖后续切片的配置链。
- 注册表元数据：`scope: 'namespace'`、`direction: 'either'`、`ack: 'UPDATE_ACK'`（复用既有 ACK，末 chunk 帧序）。
- 单帧语义自洽规则（transferId≥1、index<count、非空 bytes、bytes≤totalBytes）已经 SA2 独立裁定**准予保留**（合法发送端结构性不产出违规形态；全部 fail-closed；与 ADR 0013 接收端首 chunk 校验同向；见评审 §14.1）。若上游未来裁决收窄，只需删断言与对应分支，wire 面不变。

**备选拒绝**：BEGIN/CHUNK/COMMIT 三帧（ADR 0013 已拒绝，首 chunk 自描述已提供提前拒绝与完成围栏）；把跨帧校验前压到 codec（拒绝理由：codec 无状态、无配置面，会迫使 codec 持有连接级状态，破坏「transport/Registry 无关」边界）。

### D-2 capability bit 与常量

- `CAP_CHUNKED_UPDATE = 0x00000001`（ADR 0013 冻结值），新增于 `src/constants.ts` 并经 `src/index.ts` 导出。
- HELLO/HELLO_ACK codec 零改动：bit 经既有 uint32 BE 字段承载（golden 断言锁定字段位置与字节）；协商语义由既有 `selectCapabilities` 纯函数覆盖（交集）。
- envelope version 恒 1、flags 恒 0：UPDATE_CHUNK golden 的 header 断言锁定。

### D-3 解码门控：`DecodeOptions.selectedCapabilities`（缺省 fail-closed；校验作用域=急切）

- `DecodeOptions` 追加可选 `selectedCapabilities?: number`（uint32；非法值 → `CONNECTION_POLICY_VIOLATION`，与 `expectedSequence` 同判据）。
- **校验作用域 = 急切（SA2 F3 修订）**：对称 `resolveExpectedSequence` 先例（`src/limits.ts:53-60`——decodeFrame 对**所有**消息类型先行校验 `expectedSequence`），`selectedCapabilities` 的解析/校验在 `decodeMessage` 入口对全部消息类型先行生效，与 `header.messageType` 无关。非 UPDATE_CHUNK 帧 + 非法选项值同样 → `CONNECTION_POLICY_VIOLATION`。红灯契约 AC3 已有用例钉死该作用域（合法非 UPDATE_CHUNK 帧 + 非法值 → CPV；同帧 + 合法值 → 正常解码，证明无假拒绝）。拒绝「仅 UPDATE_CHUNK 路径惰性校验」：会让选项合法性依赖消息类型，产生类型相关的策略漂移，且与既有急切先例不对称。
- `decodeMessage`：当 `header.messageType === MESSAGE_TYPES.UPDATE_CHUNK` 且 `((options?.selectedCapabilities ?? 0) & CAP_CHUNKED_UPDATE) === 0` → 抛 `ProtocolError('UNSUPPORTED_MESSAGE_TYPE')`（connection fatal、wsCloseCode 1002，均由既有注册表导出）。检查置于 payload 解析之前（未协商端对 0x42 的拒绝与载荷内容无关）。
- **缺省 = 未协商**：不传该选项即 v1 保守语义。由此 `ws-replication` 的 `decodeInbound`（frame-io.ts:58-67，不传选项）行为逐字节不变——「本票不改任何发送/接收行为」由构造成立，且 AC3 的「未协商端按 UNSUPPORTED_MESSAGE_TYPE 处理」在协议包内即可执行验证（v1 端 = supported 无该位 → selected=0 → fatal）。
- `encodeMessage` 不做 capability 门控：发送端 gating 是 ws-replication 后续切片的职责（「发送方不得分块」）；协议包必须能构造任意已注册消息的向量（fuzz/golden 需要）。
- `decodeFrame` 不改：帧层只认「已注册与否」（0x42 注册后帧层放行，门控在消息层）。

**备选拒绝**：(a) codec 无条件解码 0x42、gating 全部留给 ws-replication——AC3 第二句在协议包内不可验证，且未修改调用方（不传任何协商信息）会静默接受未协商新码，违反「新旧互不破译」；(b) `DecodeOptions.capabilities` 命名——与 HELLO_ACK 字段 `selectedCapabilities` 语义对齐，取后者；(c) 惰性校验作用域——见上，被急切先例与红灯用例共同拒绝。

### D-4 namespace 错误注册表（append-only，恰 22 条）

| Code | Fatal | Retryable | Terminal state | 先例对齐 |
|---|---|---|---|---|
| `UPDATE_TRANSFER_VIOLATION` | true | no | failed | `SYNC_STATE_VIOLATION`（ADR 0013 明示） |
| `UPDATE_TRANSFER_TOO_LARGE` | true | config | failed | `SYNC_DIFF_TOO_LARGE` 语义族（ADR 0013 明示） |

- `NamespaceErrorCode` 联合追加两字面量；`NAMESPACE_ERRORS` 追加两条（`namespaceError(...)`，条目冻结）；连接级 registry 零新增。
- ERROR wire 的 scope/fatal/retryable 推导、`lookupError` 双表消解、`ProtocolError` 元数据导出全部经既有单点机制自动覆盖新码（无需新机制）。
- 两码的**发射点**（跨帧 violation 判定、`maxChunkedUpdateBytes` 超限）属后续切片；本切片交付注册与 wire 可编码性。

### D-5 RESYNC reason 词表

- 规范 §9.4 现状：`reasonCode` 仅约束为非空 varString（「稳定安全原因」），**不存在已枚举的闭集合词表**（SA2 F4 修订：iteration-0 表述「词表是文档级闭集合」与文档现状不符）。本切片的文档修订是**在 §9.4 首次定义 reason 词表枚举**（既有既定 reason 一并登记入表）并登记 `UPDATE_TRANSFER_EXPIRED`（非终态；发射点 = 后续切片 assembly timeout）——SA3 修订文档时不要去找不存在的既有清单。
- codec 现状对 `reasonCode` 只做非空校验；本切片以 roundtrip golden 锁定该字面量可上 wire。不为 reason 新建代码级枚举——避免在无发射点的切片预造状态机面。

### D-6 字段限额

- 不新增 `FieldLimits` 条目：chunk `bytes` 复用 `maxUpdateBytes`（超限 → 既有 `UPDATE_TOO_LARGE`）；`totalBytes` 的 `maxChunkedUpdateBytes` 判定属接收端配置链（后续切片）。`PROTOCOL_OVERHEAD_BYTES = 128` 覆盖 UPDATE_CHUNK 最坏开销（36 + 5×5 = 61 ≤ 128，SA2 独立复算确认），常量不动。

### D-7 测试/红灯策略（acceptance-contract 交付物；iteration 1 增补）

- 独立红灯契约文件 `test/codec-issue242-ac-red.test.ts`：**28 用例**（AC1 6 + AC2 8 + AC3 **7** + AC4 7）+ 3 条全字段 golden 向量字面量。iteration 0 为 27 用例；iteration 1 按 SA2 F3 在 AC3 追加 1 例「选项校验作用域=急切」（非 UPDATE_CHUNK 帧 + 非法 `selectedCapabilities` → `CONNECTION_POLICY_VIOLATION`；同帧 + 合法值 0 → 正常解码），把校验作用域从「两种实现均可转绿」的歧义钉死为可执行红灯要求。不触碰任何既有测试文件（issue #239 先例：红灯期零既有文件改动，既有面保持绿）。
- golden 向量（3 条全字段：基本/多字节 LEB128/uint32 上界）以字面量锁定在红灯文件内；实现阶段由 SA3 整合进 `test/fixtures.ts` 的 `GOLDEN`/`MESSAGE_TABLE`/`NAMESPACE_ERROR_TABLE` 并同步更新既有计数断言（§11）。
- 红灯文件直接以 typed 引用新 API（`MESSAGE_TYPES.UPDATE_CHUNK`、`CAP_CHUNKED_UPDATE`、`UpdateChunkMsg`、`DecodeOptions.selectedCapabilities`）→ 运行层红灯（esbuild 不查类型，符号 undefined / 0x42 帧级拒绝）+ 类型层红灯（`tsc -p` TS2305/TS2724/TS2339/TS2551/TS2353/TS2345），两层失败都唯一指向缺失实现（§16 证据）。

### D-8 ws-replication 类型兼容补丁（SA2 F1 修订核心）

**事实链**（SA2 F1，已复核源码）：D-1/§8 把 `UpdateChunkMsg` 并入 `ReplicationMessage` 后，`packages/ws-replication` 两处 `dispatchReady(message: ReplicationMessage)` 穷尽 switch 的 `default` 分支将 `message` 窄化为 `UpdateChunkMsg`，`const never: never = message` 即 TS2322（`hub-connection.ts:791`、`peer-connection.ts:522`）；root `pnpm typecheck` 的逐包 tsc 链包含 `tsc -p packages/ws-replication/tsconfig.json`（root `package.json` scripts.typecheck），照 iteration-0 的「ws-replication 整体 DENY + 零改动」实施必然无法通过本设计自设的 AC5 wire 变更门与包 AGENTS Verification 义务。运行时不可达不能豁免类型层断裂。

**决策**：在两文件的 `dispatchReady` switch 中、`default` 分支之前，各追加**恰好一个**最小 case 分支（SA2 推荐项 a：fail-loud 分类自镜像；两行语句 + 注释）：

```ts
case 'UPDATE_CHUNK':
  // 类型兼容分支（issue #242 切片 1）：decodeInbound 缺省门控下构造性不可达——
  // 未协商 ⇒ 消息层 UNSUPPORTED_MESSAGE_TYPE（1002）先于 dispatch。分类与 decode 层自镜像
  // （wsCloseCodeFor('UNSUPPORTED_MESSAGE_TYPE') === 1002），为后续切片防误分发兜底。
  this.connectionFatal('UNSUPPORTED_MESSAGE_TYPE', 1002);
  return;
```

（两文件分别使用各自类的 `private connectionFatal(code: string, wsCloseCode: number)`——hub-connection.ts:872 / peer-connection.ts:828，同类内可调；hub 侧亦可写 `wsCloseCodeFor('UNSUPPORTED_MESSAGE_TYPE')`，值为同一 1002，取字面量以与 peer 侧补丁逐字同形。）

- **运行时构造性不可达论证**：`decodeInbound`（frame-io.ts:58-67）不传 `selectedCapabilities` → 缺省 = 未协商 → `decodeMessage` 在消息层对 0x42 先抛 `UNSUPPORTED_MESSAGE_TYPE` → 连接类 catch 链（hub:604-616 / peer:360-371）`connectionFatal(code, wsCloseCodeFor(code))` → `dispatchReady` 在本切片永远收不到 `UPDATE_CHUNK`。v1 流量（0x42 从未发送）与未协商新码流量的可观察行为逐字节不变：同一错误码、同一 close code 1002、同一收口拓扑，仅拒绝点从帧层「未注册」移到消息层「未协商门控」（分类相同）。
- **为什么选 fail-loud 而非 no-op return**（SA2 两选项）：no-op 静默丢弃违反本仓「正常路径不变量缺失应 fail loud」纪律；若后续切片在 dispatch 实装前意外放行 0x42，no-op 会静默丢数据，fail-loud 则以稳定分类关闭连接。补丁与 decode 层门控分类自镜像，测试上由 root `pnpm typecheck`（编译器自身证明穷尽性恢复）+ 既有 ws-replication 用例零变化共同背书。
- **边界**：两文件**仅允许**上述单一 case 分支（含其注释）；禁止任何其他改动（HELLO 能力位置位、`decodeInbound` 传选项、发送/接收行为、draining 过滤调整等均属后续切片，仍 DENY）。

### D-9 主要未选方案汇总

1. 先做 ws-replication 协商管道再定码值——wire 值未冻结即写状态机，返工面大（ADR 0013 明确本切片边界）。
2. 为 UPDATE_CHUNK 增加独立 `maxChunkBytes` FieldLimits——ADR 0013 明示复用 `maxUpdateBytes`（零新 frame 级上限）。
3. 在 codec 校验 `totalBytes ≤ chunkCount × maxUpdateBytes`——依赖配置面，留给接收端首 chunk 校验。
4. **把 `UpdateChunkMsg` 排除在 `ReplicationMessage` 联合之外（另立联合）以保 ws-replication 零改动**——破坏「解码返回类型 = wire 消息全集」单点事实源，`decodeMessage` 返回类型与注册表脱钩，fuzz/roundtrip/GOLDEN 全量循环机制全部要开叉；两行 case 的成本远低（SA2 F1 评审已隐含排除该路线）。
5. `case 'UPDATE_CHUNK'` no-op return（SA2 选项 b）——见 D-8 拒绝理由。

## 8. 接口、状态机和数据流

**公共 API 变化（全部 append-only，经 `src/index.ts`）**：

| 符号 | 形态 |
|---|---|
| `CAP_CHUNKED_UPDATE` | `const = 0x00000001`（constants.ts） |
| `MessageName` | 追加 `'UPDATE_CHUNK'` |
| `UpdateChunkMsg` | `{ kind: 'UPDATE_CHUNK'; namespaceId: string; transferId: number; chunkIndex: number; chunkCount: number; totalBytes: number; bytes: Uint8Array }`，并入 `ReplicationMessage` |
| `MESSAGE_TYPES` / `MESSAGE_NAMES` / `MESSAGE_REGISTRY` | 追加 `UPDATE_CHUNK: 0x42` / `'66' → 'UPDATE_CHUNK'` / `{code:0x42, scope:'namespace', direction:'either', ack:'UPDATE_ACK'}` |
| `NamespaceErrorCode`、`NAMESPACE_ERRORS` | 追加 `UPDATE_TRANSFER_VIOLATION`、`UPDATE_TRANSFER_TOO_LARGE`（22 条） |
| `DecodeOptions` | 追加 `selectedCapabilities?: number`（uint32；急切校验，D-3） |

**联合扩容的下游类型效应（D-8）**：`ReplicationMessage` +1 成员使 ws-replication 两处穷尽 switch 编译断裂，由 §11 ALLOW LIST 的两处单 case 类型兼容补丁收口；除此之外联合扩容对全仓无其他调用方影响（SA2 §9 全仓 grep：apps/yjs-server 无穷尽 switch / `Record<MessageName,…>` 面）。

**状态机**：无（本切片不引入任何运行时状态；codec 保持纯函数）。

**数据流路线**（本切片唯一 wire 数据流：codec 内一跳）：

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| UPDATE_CHUNK encode | 调用方构造 `UpdateChunkMsg` | `encodeMessage`：字段规则校验 → PayloadWriter（lib0 canonical）→ 20-byte 头组装 | 纯内存 bytes；无持久化/网络 | 无（调用方决定） | `decodeMessage` | 逐字节 canonical frame（golden 锁定） | 规则违规 → `MALFORMED_FRAME`；`maxUpdateBytes` 超限 → `UPDATE_TOO_LARGE` | AC1/AC2 |
| UPDATE_CHUNK decode | wire bytes（含敌意） | `decodeFrame`（9 步帧检查）→ 急切选项校验（D-3）→ 门控（D-3）→ payload 逐字段 → `expectEnd` | 分配仅发生在 `readVarUint8ArrayCopy` 的 `pos+len ≤ end` 检查之后 | 无 | 调用方拿到 `DecodedMessage` | 字段全等对象（detached copy） | 帧级/选项级/门控/载荷级四级分类拒绝，绝无未分类异常 | AC1/AC2/AC3 |
| ERROR（新码）/ RESYNC（新 reason） | 调用方 | `encodeError`（注册表推导位）/ `encodeResyncRequired` | 同上 | 无 | 调用方 | 注册表单点导出的 wire 形态 | 位不一致 → `MALFORMED_FRAME` | AC4 |

无运行时持久化、无缓存、无最终一致性面（依据：协议包无状态、无 Cordis/WS/Registry 依赖，`packages/replication-protocol/AGENTS.md` Contract）。

## 9. 错误、恢复、并发和幂等

- **分类**（全部既有码，零新分类）：payload 规则违规/非 canonical/非法 UTF-8/截断/尾随/超声明 → `MALFORMED_FRAME`；`bytes > maxUpdateBytes` → `UPDATE_TOO_LARGE`；未协商 0x42 → `UNSUPPORTED_MESSAGE_TYPE`（connection fatal，1002）；选项非法（任意消息类型，急切）→ `CONNECTION_POLICY_VIOLATION`。任何路径只抛 `ProtocolError`。
- **拒绝顺序**：帧级 9 步（截断在步骤 2/8 先于消息层）→ 选项急切校验 → 门控（先于 payload 解析）→ 载荷级字段规则 → `expectEnd`。分类确定、可测。
- **无越界分配**：`readVarUint8ArrayCopy` 分配前检查（`canonical.ts:187-196`）；巨额声明（如 2^32）在分配前分类拒绝——AC2 以「只抛 ProtocolError，绝不 RangeError/TypeError」为可观察判据。
- **并发/幂等**：纯函数、无共享状态；同一输入重复编码/解码结果逐字节一致（canonical）。重试/回滚不适用（无副作用）。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `packages/ws-replication/src/frame-io.ts` `decodeInbound` | `decodeMessage(bytes, {expectedSequence, maxFrameBytes})`；0x42 → 帧级 `UNSUPPORTED_MESSAGE_TYPE` | 完全相同（缺省选项 = 未协商 → 0x42 仍 `UNSUPPORTED_MESSAGE_TYPE`，仅拒绝点移至消息层门控，分类/close code 不变） | **零改动**（本票不改发送/接收行为） | frame-io.ts:58-67；D-3 |
| `packages/ws-replication/src/hub-connection.ts` `dispatchReady`（:791 穷尽检查） | 17 成员联合下 `default: const never` 编译通过；运行时永不见 0x42 | 18 成员联合 → default 窄化为 `UpdateChunkMsg` → **TS2322 编译断裂** | **类型兼容补丁（运行时不可达）**：D-8 单 case 分支（`case 'UPDATE_CHUNK': this.connectionFatal('UNSUPPORTED_MESSAGE_TYPE', 1002); return;` + 注释），置于 `default` 前；禁止其他改动 | hub-connection.ts:770-795、:872、:604-616；root package.json scripts.typecheck；SA2 F1 |
| `packages/ws-replication/src/peer-connection.ts` `dispatchReady`（:522 穷尽检查） | 同上 | 同上 | 同上（D-8 单 case 分支） | peer-connection.ts:500-528、:828、:360-371；SA2 F1 |
| `packages/ws-replication` HELLO 发送（peer-connection:333 / hub-connection:707） | `optionalCapabilities: 0` / `selectedCapabilities: 0` | 不变（后续切片才置位） | 零改动 | §2 锚点 |
| 协议包既有 9 个测试文件 | 139 用例全绿 | 依赖锁定的计数/码空间断言需 append-only 翻转（0x42 注册、GOLDEN 18→21、namespace 20→22、envelope 测试 0x42 样本换 0x43、GOLDEN 全量 decode 循环对 UPDATE_CHUNK 传 `selectedCapabilities`） | 实现阶段由 SA3 更新（ALLOW LIST §11，逐文件列明） | codec-registries.test.ts:72-80；codec-messages-golden.test.ts:51；codec-envelope.test.ts:88-89；codec-roundtrip-truncation.test.ts:29-49；codec-package-contract.test.ts:84-92；codec-fuzz-property.test.ts:95-140 |
| `codec-api.test-d.ts`（类型契约） | 锁 17 消息联合/导出面 | 追加 UPDATE_CHUNK/CAP_CHUNKED_UPDATE/DecodeOptions 新字段的类型断言 | 实现阶段更新 | codec-api.test-d.ts:35 |
| `apps/yjs-server` | 仅 kind 过滤与 `as ReplicationMessage` 断言，无穷尽 switch/`Record<MessageName,…>` 面 | 不受联合扩容影响 | 零改动 | SA2 §9 全仓 grep |
| 未来切片（发送切片/接收 assembly） | 不存在 | 依赖本切片冻结的码值/字段序/门控/错误码；届时以真实分发逻辑**替换** D-8 两处镜像 case | 非本票 | ADR 0013 |

## 11. 文件范围

### ALLOW LIST（实现阶段预期改动；本阶段已交付 ●）

| 路径 | 预期改动 | 原因 |
|---|---|---|
| ● `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` | 红灯契约（iteration 0 新增 27 用例；iteration 1 按 SA2 F3 增至 **28 用例** + 3 golden 向量字面量）；实现后不改即绿 | §7 D-7、§12 |
| `packages/replication-protocol/src/messages.ts` | 注册 UPDATE_CHUNK(0x42) + `UpdateChunkMsg` + 联合成员 | D-1 |
| `packages/replication-protocol/src/payloads.ts` | `decodeUpdateChunk`/`encodeUpdateChunk`（D-1 字段规则）+ `decodeMessage` 急切选项校验与门控（D-3） | D-1/D-3 |
| `packages/replication-protocol/src/constants.ts` | `CAP_CHUNKED_UPDATE` | D-2 |
| `packages/replication-protocol/src/errors.ts` | 两条 namespace 码（22 条） | D-4 |
| `packages/replication-protocol/src/limits.ts` | `DecodeOptions.selectedCapabilities` + 急切解析/校验（uint32，对称 `resolveExpectedSequence`） | D-3 |
| `packages/replication-protocol/src/index.ts` | 导出新符号 | AGENTS「公共 API 只经 index.ts」 |
| `packages/ws-replication/src/hub-connection.ts` | **仅** `dispatchReady` 穷尽 switch 追加 D-8 单 case 类型兼容分支（case 标签 + `this.connectionFatal('UNSUPPORTED_MESSAGE_TYPE', 1002)` + `return` + 注释）；其余零改动 | D-8（SA2 F1：联合扩容的下游穷尽检查编译断裂；root typecheck 门） |
| `packages/ws-replication/src/peer-connection.ts` | 同上（D-8 单 case 分支）；其余零改动 | 同上 |
| `packages/replication-protocol/test/fixtures.ts` | 整合 3 条 UPDATE_CHUNK golden（GOLDEN 18→21）+ `MESSAGE_TABLE/SCOPE/DIRECTION/ACK` 增行 + `NAMESPACE_ERROR_TABLE` 增两码（20→22）+ `UpdateChunkMsg` 形状 | §10 既有测试对齐 |
| `packages/replication-protocol/test/codec-messages-golden.test.ts` | `toHaveLength(18)→21`；UPDATE_CHUNK golden 用例（decode 传 `selectedCapabilities`）；「17 个」表述更新 | §10 |
| `packages/replication-protocol/test/codec-registries.test.ts` | 码空间断言翻转（0x42 已注册，样本改 0x43+）；17→18 消息、20→22 namespace 码 | §10 |
| `packages/replication-protocol/test/codec-envelope.test.ts:88-89` | 未注册码样本 0x42 → 0x43（或其他仍空闲码） | §10 |
| `packages/replication-protocol/test/codec-roundtrip-truncation.test.ts` | GOLDEN 循环 decode 对 UPDATE_CHUNK 传 `selectedCapabilities: CAP_CHUNKED_UPDATE`（或经 fixtures 标注）；「17 种」表述更新 | §10 |
| `packages/replication-protocol/test/codec-package-contract.test.ts` | 同上（GOLDEN encode/decode 循环） | §10 |
| `packages/replication-protocol/test/codec-fuzz-property.test.ts` | randomMessage 增加 UPDATE_CHUNK 分支（decode 传门控选项）；变异面沿用 decodeFrame | §10、AC5 |
| `packages/replication-protocol/test/codec-api.test-d.ts` | 新类型面断言 | §10 |
| `docs/protocols/instance-replication-v1.md` | §5 注册表增 0x42 行；§10 增 10.3 UPDATE_CHUNK 字段表；§6.1 capability 词表增 bit；§13.2 增两码行；§9.4 **首次定义** reason 词表枚举并登记 `UPDATE_TRANSFER_EXPIRED`（D-5 修订）；§22 conformance 面说明 | ADR 0013「落地时须修订」 |
| `CONTEXT.md` | 增补「分块复制传输」词汇（UPDATE_CHUNK/CAP_CHUNKED_UPDATE） | ADR 0013「后果」 |
| ● `wiki/raw/task_issue-242_design.md`（本文档）、● 三份证据日志（`_ac_red.log` / `_ac_red_typecheck.log` / `_regression.log`，iteration 1 全部刷新为可复现命令 + 原始输出 + 退出码；R4 全仓探测追加于 `_regression.log` 尾部） | 本阶段交付 | §16 |

### DENY LIST（iteration 1 按 SA2 F1 收窄）

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/ws-replication/**` —— **收窄例外：`src/hub-connection.ts` 与 `src/peer-connection.ts` 两文件允许且仅允许 D-8 指定的 `dispatchReady` 单 case 类型兼容分支（含注释）；两文件的任何其他改动、以及 ws-replication 其余全部文件，仍然禁改** | 后续切片属地 + 类型兼容窄例外 | Issue 明示「本票只交付协议包能力，不改变任何发送/接收行为」；D-8 补丁运行时构造性不可达 = 零行为变化；R1/R2/R3 基线刻画（`ws-replication-issue233-repro.test.ts`）必须保留；HELLO 置位、decodeInbound 传选项、发送/接收行为均属后续切片 |
| `packages/replication-protocol/src/canonical.ts`、`src/envelope.ts` | 敌意拒绝/帧检查已完备 | UPDATE_CHUNK 全部敌意面由既有 Reader/帧层覆盖；改动徒增回归面 |
| `packages/replication-protocol/package.json` | 依赖边界 | 零新依赖（AC5 manifest 契约锁定 yjs/y-protocols/lib0） |
| `docs/adr/0013-*.md`、`docs/adr/0010-*.md` | 治理输入 | ADR 状态修订是 Owner 决策，非实现任务面 |
| 其余 packages/apps/domains/tests（含 `apps/yjs-server`、`packages/vfsl-codegen`） | 无关 | 隔离爆炸半径；§16 记录的两个先在环境性失败文件不属本任务，禁止顺手修改 |

## 12. 验收与验证映射

| 需求（Issue AC） | 现有证据 | 所需行为测试（红灯契约锚点） | 预期观察（实现后） |
|---|---|---|---|
| AC1 golden vectors 锁定 + canonical roundtrip | 无（0x42 未注册） | `codec-issue242-ac-red.test.ts` AC1 describe（6 用例）：注册表三元组/CAP 常量、3 条全字段向量（基本/多字节/uint32 上界）encode 逐字节 == 锁定 frame、decode 字段全等、header version=1/flags=0/reserved=0、encode(decode) === frame、字段序切片断言 | 全绿；向量字面量即冻结契约 |
| AC2 敌意解码响亮拒绝、无越界分配 | 既有敌意面只覆盖 17 消息 | AC2 describe（8 用例）：逐 byte offset 截断（BAD_MAGIC/FRAME_LENGTH_MISMATCH）；非 canonical varUint（`81 00`/`83 00`/9 字节续位）；超 uint32 域（2^32）；非法 UTF-8；非法 namespaceId（大写/短）；payload 尾随；超声明 bytes（200 超余量、2^32 巨额声明）；语义自洽（chunkCount=0/index≥count/transferId=0/空 bytes/bytes>totalBytes）；`maxUpdateBytes` 超限 → `UPDATE_TOO_LARGE`；encode 侧同规则（R9） | 全部只抛 `ProtocolError` 且分类如断言；无 RangeError/TypeError（分配前拒绝） |
| AC3 交集协商 + 未协商 fatal + **选项校验作用域（F3）** | `selectCapabilities`/HELLO codec 已在（绿锚） | AC3 describe（**7 用例**）：位 0x1 交集/required 拒绝矩阵；HELLO/HELLO_ACK bit 字节级 roundtrip（uint32 BE 字段位置锁定）；缺省/selected=0/仅他位 → `UNSUPPORTED_MESSAGE_TYPE`（scope=connection、fatal、1002、retryable=no）；本位置位（含多余位）解码成功；选项非法值 → `CONNECTION_POLICY_VIOLATION`；**急切作用域用例（F3 新增）：合法非 UPDATE_CHUNK 帧（GOLDEN HELLO）+ 非法选项值 → `CONNECTION_POLICY_VIOLATION`，同帧 + 合法值 → 正常解码**；v1 支持集 selected=0 → fatal（互通回落） | 全绿；未协商路径分类由连接注册表单点导出；选项校验与消息类型无关 |
| AC4 注册表单点 + reason 词表 | 无（两码不存在） | AC4 describe（7 用例）：两码 scope/fatal/retryable/terminalState 全等；22 条 + 既有 20 条抽样不变 + 冻结；`lookupError` 双向；ERROR wire roundtrip + 注册表推导位前缀 + 位不一致拒绝；`ProtocolError` 元数据消解；`RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}` roundtrip + 空理由仍拒 | 全绿；wire 位不可被调用方覆盖 |
| AC5 协议包全量测试与 typecheck 绿（含 root wire 变更门） | 既有 9 文件 139 用例绿 + 红灯契约红（§16） | 实现阶段命令：(1) 包级 `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/replication-protocol`（**与 §16 R3 同命令、无排除**）→ exit 0；(2) `pnpm exec tsc -p packages/replication-protocol/tsconfig.json` → exit 0；(3) **root `pnpm typecheck` → exit 0（独立证据项：证明 D-8 两处 case 补丁恢复了 ws-replication 穷尽 switch——编译器自身即穷尽性证明）**；(4) root `pnpm test`（= `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck`）→ 归因判读见 §17-5；(5) 互通证据 = AC3 v1 回落用例 + 既有 ws-replication 用例零变化 | 全部 exit 0（§17-5 的归因规则除外）；wire 值冻结面与 §7 完全一致 |

## 13. 风险、回滚和残余问题

| 风险/残余 | 评估 | 处置 |
|---|---|---|
| D-1 语义自洽规则（transferId≥1、index<count、非空 bytes、bytes≤totalBytes）超出 Issue AC 明列的敌意清单 | 无假拒绝：合法发送端（ADR 发送规则）结构性不产出这些形态；且全部 fail-closed | **SA2 已独立裁定准予保留**（评审 §14.1，四点理由）；如未来上游裁决收窄，只需删除断言与对应实现分支，wire 面不变 |
| D-8 类型兼容补丁被误读为「发送/接收行为改动」 | 运行时构造性不可达（decodeInbound 缺省门控先拒，D-8 论证链）；分类/close code 与 decode 层拒绝完全一致 | 设计 + 补丁内注释双重记载不可达性论证；root typecheck exit 0 + 既有 ws-replication 用例零变化为证据；SA4 复审时以 §10 矩阵为准 |
| 门控缺省 fail-closed 使既有 GOLDEN 全量 decode 循环必须传选项 | 机械更新（§11 四个测试文件），且强化了门控证明 | ALLOW LIST 逐文件列明 |
| 全仓 root `pnpm test` 存在两个**先在**环境性失败（与本任务无关） | `apps/yjs-server/test/stdin-error-chain-red.test.ts`（T7-F1 加载竞态：process exited 134 / EAGAIN spawn CPU burner）与 `packages/vfsl-codegen/test/generate-cli-check.test.ts`（5000ms 超时）；均为已跟踪文件；**隔离复跑二者 12/12 通过（exit 0）**；本任务未修改任何已跟踪文件（git status 仅未跟踪新增） | 非本任务回归、不在本任务修复（DENY）；SA3/SA4 对 root `pnpm test` 按 §17-5 归因规则判读；如复现可隔离复跑佐证 |
| 旧实现收到新 namespace ERROR 码（VIOLATION/TOO_LARGE）（SA2 O2） | 结构性不可达：ADR 0013 互通矩阵——未协商端不会被分块，也就不会发出/收到 transfer 语义错误码；若真收到，decode 层 `lookupError` 未命中 → `MALFORMED_FRAME` → fatal（响亮拒绝，非误读） | 残余记录于此；无需机制 |
| 「未协商端」证据是包内模拟（v1 支持集 → selected=0 → fatal），非真实旧二进制互跑 | 协议包层可达成最强证据；真实跨版本互跑不属本仓测试面 | 残余，记录；ADR 0013 互通矩阵由该用例 + 既有 v1 行为不变共同覆盖 |
| ADR 0013 状态为「提议」，wire 冻结值以其为权威但正式权威是协议文档修订 | 本切片 golden 直接按 ADR 字段序锁定；文档修订在实现阶段同批 | §6 已标冲突复查（§15 维持） |
| 回滚 | 纯 append-only：删除新注册项/常量/选项 + 回退 D-8 两处 case 即回到 v1；无数据迁移、无持久化面 | 单 PR 可逆 |

任务内必要条件全部已覆盖；无伪装成 follow-up 的前置项。真实 follow-up（后续切片）：发送切片、接收 assembly、配置链、observer 四事件、D-8 两处镜像 case 被真实分发逻辑替换（ADR 0013）。

## 14. 评审修订映射（iteration 1）

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **F1（BLOCKER）**：DENY 全禁 ws-replication 与 §8 联合扩容在类型层互斥，顶撞 AC5 root 门（hub-connection.ts:791 / peer-connection.ts:522 TS2322） | §7 D-8（新增决策，采纳 SA2 推荐项 a：fail-loud 分类自镜像 case）、§1 非目标、§8 联合扩容下游效应、§10 矩阵两行改写为「类型兼容补丁（运行时不可达）」、§11 DENY 收窄例外 + ALLOW 增两文件、§12 AC5 root typecheck 独立证据项、§17 转绿条件 2/5 | 已落实：DENY LIST 收窄为「两文件且仅限单 case 分支」；补丁语义二选一已决（fail-loud 镜像，拒绝 no-op 的理由成文）；root `pnpm typecheck` exit 0 列为独立证据项 |
| **F2（MAJOR）**：§16 回归命令与日志不可复现（存在未披露的执行排除；`Errors 17` 使 exit ≠ 0 未记录） | §16 全节重写；三份证据日志全部刷新（`_ac_red.log` / `_ac_red_typecheck.log` / `_regression.log`，每份内嵌精确命令 + 原始输出 + 退出码）；R3 改为**无任何排除**的 `--typecheck packages/replication-protocol` 域命令（红灯文件的 20 个失败与 21 个类型错误在日志中如实可见）；补充全仓探测 run 及两个先在环境性失败的隔离复跑证据 | 已落实：文档命令 ↔ 日志逐项一致（Test Files / Tests / Errors / exit code 均记录）；无隐藏排除；实质结论（既有 9 文件 139 用例零失败）保留 |
| **F3（MINOR）**：`selectedCapabilities` 校验作用域未指定（急切 vs 惰性） | §7 D-3（校验作用域=急切，对称 `resolveExpectedSequence` 先例 + 拒绝惰性的理由）、D-7（红灯契约 27→28 用例）、§12 AC3 行、红灯文件 AC3 新增用例（非 UPDATE_CHUNK 帧 + 非法值 → CPV；同帧 + 合法值 → 正常解码） | 已落实：采纳急切校验并以可执行红灯用例钉死（本iteration 实测该用例红：20 failed \| 8 passed） |
| **F4（MINOR）**：§2 两处锚点笔误；D-5「词表是文档级闭集合」与文档现状不符 | §2 表（`test/codec-envelope.test.ts:88-89` 左列修正；ERROR 位推导锚点拆为 `errors.ts:112-139` + `payloads.ts:257-339`）、§7 D-5（改为「§9.4 首次定义 reason 词表枚举」）、§11 文档面行、§2 新增 §9.4 现状锚点行 | 已落实 |
| **O2（非阻断）**：旧实现收到新 namespace ERROR 码的不可达性论证补记 | §13 残余表新增一行 | 已落实 |
| SA2 §14.1（D-1 语义自洽规则裁定准予保留） | §7 D-1、§13 对应行标注「SA2 已裁定」 | 已记录，规则保留 |
| SA2 §14.5/14.6（lookupError 红灯期弱锚说明；overhead 复算确认） | 无需设计改动（前者转绿后自然变实锚；后者 D-6 已引用） | 不适用 |

## 15. 是否需要设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）**。理由：

1. 公共 API 与 wire 协议变化：新增消息码 0x42、capability bit 0x1、两条 namespace 错误码、一个 RESYNC reason、`DecodeOptions` 语义扩展——触碰规范 §5/§6.1/§13.2 冻结面；
2. ADR 0013 处于「提议」状态，本设计按其字段序/码值直接冻结 golden，而 ADR 自述「接受后 wire 冻结值以协议文档修订为唯一权威」——实现阶段对 `docs/protocols/instance-replication-v1.md` 的修订（含 §9.4 首次定义 reason 词表）需与 ADR 0013 及 ADR 0010（§5「未来扩展只能在 HELLO 明确协商后使用」）做一次正式一致性复查；
3. D-3 门控缺省语义（缺省 = 未协商 = fatal）与急切校验作用域是对「既有未知消息码规则」在库层的新表述，值得 SA8 确认与 ADR 0013「天然强制 gating」表述的等价性；
4. D-8 在 ws-replication 增加运行时不可达的镜像 case——属类型兼容而非行为决策，但位于 ADR 0010/0013 管辖包内，一并提请确认。

SA2 评审 §15 明示「维持必要；本次评审未发现其之外的新 ADR 冲突维度」。

## 16. 证据与复现（iteration 1 刷新；SA2 F2 修订）

**工作树状态**：任务 worktree 根（`/home/wangjian/nomicore-fix-issue-242`），未实施树；`git status --short` 仅 8 个未跟踪新增（红灯契约文件 + 7 个 wiki/raw 产物），**零已跟踪文件修改**——既有面结论不依赖任何源码改动。

**iteration-0 证据问题的如实披露（F2）**：iteration-0 的 `_regression.log` 由一次对红灯文件做了**未披露执行排除**的运行产生（日志只含 9 个既有文件、无红灯文件失败记录，但 17 个 unhandled TypeCheckError 证明该文件在盘且被 tsc 程序覆盖），且三份日志均未记录退出码——命令与日志不可互推。iteration 1 起以「无任何排除 + 命令/输出/退出码同录」的四份 run 取代；本节命令在未实施树上重跑应逐项复现日志中的 Test Files / Tests / Errors / exit code。

**R1 红灯契约（运行层）**

- 命令：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/replication-protocol/test/codec-issue242-ac-red.test.ts --reporter=verbose`
- 结果：**exit 1，Tests 20 failed | 8 passed (28)**，Test Files 1 failed (1)。
- 失败归因（全部且仅为缺失实现）：`MESSAGE_TYPES.UPDATE_CHUNK` undefined、encode 抛 `UNSUPPORTED_MESSAGE_TYPE: unknown message kind`、decode 帧级 `UNSUPPORTED_MESSAGE_TYPE: unknown message type 0x42`（致敌意分类断言不可达）、`NAMESPACE_ERRORS.UPDATE_TRANSFER_*` undefined / 20≠22 / `unknown error code` / scope 兜底 connection、F3 新增用例（HELLO 帧正常解码而期望 CPV——选项不存在故被忽略）。8 个通过用例 = 必须持续成立的锚（golden 算术自校验、字段序字面量、selectCapabilities 交集、HELLO bit 字节级 roundtrip、未协商 fatal 分类、v1 回落、lookupError 隔离、RESYNC roundtrip）。
- 稳定性：第二次运行（默认 reporter）exit 1、20 failed | 8 passed，失败用例名集合与首次逐名一致（AC1×4 / AC2×8 / AC3×3 / AC4×5）；纯函数 + 固定向量，无随机/计时器。
- 日志：`wiki/raw/task_issue-242_ac_red.log`（内嵌命令与退出码）。

**R2 类型层红灯（API 面精确规格）**

- 命令：`pnpm exec tsc -p packages/replication-protocol/tsconfig.json`
- 结果：**exit 2，21 个错误，全部位于红灯契约文件且全部为缺失 API**（TS2305/TS2724 `CAP_CHUNKED_UPDATE`/`UpdateChunkMsg`；TS2353/TS2345 `DecodeOptions.selectedCapabilities`——F3 用例贡献 4 处对象字面量；TS2339/TS2551 `UPDATE_CHUNK`/`UPDATE_TRANSFER_*`），无任何测试自身逻辑的类型错误。
- 日志：`wiki/raw/task_issue-242_ac_red_typecheck.log`。

**R3 回归（既有面保持绿；无任何排除——红灯文件的失败与类型错误如实可见）**

- 命令：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/replication-protocol`
- 结果：**exit 1，Test Files 1 failed | 9 passed (10)，Tests 20 failed | 147 passed (167)，Type Errors no errors，Errors 21**。
- 判读：唯一失败文件 = 红灯契约文件（预期红灯，20 用例失败 + 21 个 unhandled source TypeCheckError 与 R2 同源）；既有 9 个测试文件（8 个 `.test.ts` + `codec-api.test-d.ts` TS 工程）**139 用例零失败**；Tests 147 = 139 + 8（红灯文件通过锚）。实现完成后**同一命令**（依旧无排除）exit 0。
- 日志：`wiki/raw/task_issue-242_regression.log`（内嵌命令、原始输出与退出码）。

**R4 全仓探测（补充证据，同样无排除）**

- 命令：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck`（= root `pnpm test` 的展开形式）
- 结果：exit 1，Test Files 3 failed | 228 passed (231)，Tests 22 failed | 2372 passed (2394)，Errors 23。3 个失败文件 = 本任务红灯契约文件（20 失败，预期）+ 2 个**先在环境性失败**（`apps/yjs-server/test/stdin-error-chain-red.test.ts` T7-F1 加载竞态：process exited 134 / EAGAIN spawn；`packages/vfsl-codegen/test/generate-cli-check.test.ts` 5000ms 超时）。
- 归因证据：两文件均为已跟踪文件、本任务零已跟踪文件修改（git status）；**隔离复跑二者 exit 0（12/12 通过）** → 全仓并行负载下的环境性抖动，先在于本任务，非本任务回归；已记入 §13 与 §17-5 归因规则，不在本任务修复（DENY）。
- 日志：追加于 `wiki/raw/task_issue-242_regression.log` 尾部（含隔离复跑命令与结果）。

## 17. 转绿条件（实现完成后本契约不改即绿）

1. `messages.ts`/`payloads.ts`/`constants.ts`/`errors.ts`/`limits.ts`/`index.ts` 按 §7/§8 落地（D-1 字段规则逐条、D-3 门控 + **急切**选项校验、D-4 两码、D-2 常量）；
2. `packages/ws-replication/src/hub-connection.ts` 与 `peer-connection.ts` 各落地 D-8 单 case 类型兼容分支（**仅此**）；
3. §11 ALLOW LIST 中既有测试文件的 append-only 翻转完成（fixtures 整合、计数/码空间/样本更新、GOLDEN 循环传门控选项、fuzz 增分支、test-d 增断言）；
4. 协议文档与 CONTEXT.md 修订（§11 文档面）；
5. 验证命令全绿，逐项独立记录退出码：
   - 包级：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/replication-protocol`（与 R3 同命令，无排除）→ **exit 0**；`pnpm exec tsc -p packages/replication-protocol/tsconfig.json` → **exit 0**；
   - **root `pnpm typecheck` → exit 0（独立证据项，SA2 F1 修订 4：其逐包 tsc 链含 `tsc -p packages/ws-replication/tsconfig.json`，通过即证明 D-8 两处 case 恢复了穷尽 switch——编译器自身即穷尽性/完备性证明）**；
   - root `pnpm test`：所有 replication-protocol 与 ws-replication 测试文件零失败，且无任何失败可归因于本任务 ALLOW LIST 文件；若 §16-R4 记录的两个先在环境性失败复现（stdin-error-chain-red 加载竞态 / generate-cli-check 超时），按 §13 归因规则隔离复跑佐证并如实记录，**不得在本任务内修改它们**（DENY），也不得为使其变绿而调整本任务实现。

## 18. 证据文件清单（artifactPaths）

- `packages/replication-protocol/test/codec-issue242-ac-red.test.ts`（28 用例 + 3 向量）
- `wiki/raw/task_issue-242_design.md`（本文档）
- `wiki/raw/task_issue-242_ac_red.log`（R1/R1b，含命令与退出码）
- `wiki/raw/task_issue-242_ac_red_typecheck.log`（R2，含命令与退出码）
- `wiki/raw/task_issue-242_regression.log`（R3 + R4 补充，含命令与退出码）

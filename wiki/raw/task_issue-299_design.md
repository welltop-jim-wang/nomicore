# 设计产物 — issue #299（feat：#295 切片 1：0x42 kind 首字段单形态 codec + 聚合上限配置链）

- **dispatch**: sa-515098b5-d3e1-48ff-a6a5-fcc2800b257c（mabf-sa1 / design / iteration 2；iteration 1 = sa-fd2ae580-4184-4429-a824-431f35f86686；首版 = sa-2fcad09c-f695-4e26-823e-2b716f8b04b3 / design / iteration 0）
- **输入基线**: 任务简报 `wiki/raw/task_issue-299.md`（issue #299 正文 + AC1–AC4；REST comments 为空）；SA6 验收契约 `wiki/raw/task_issue-299_sa6_contract.md`（裁决 approve，21 红 / 5 绿负控 / 2 类型面红）；SA8 前置冲突门禁 `artifacts/sa8-conflict-gate-issue-299.md`（裁决 clear，R32–R37）；SA8 设计后复审 `artifacts/sa8-conflict-gate-issue-299-design-recheck.md`（iteration 1，裁决 clear，R38–R41）；SA2 设计攻击评审 `wiki/raw/task_issue-299_sa2_review.md`（iteration 0，verdict **reject：0 BLOCKER / 3 MAJOR（F1/F2/F3）+ 非阻塞 O1–O4**；核心设计 D1–D9 经独立攻击全部成立，激活门窄门裁决维持）——iteration 1 为 F1–F3 逐条修订（顺带吸收 O1/O2 叙述精度项）；SA4 实现静态审查 `wiki/raw/task_issue-299_sa4_review.md`（iteration 0，verdict **approve：0 BLOCKER / 0 MAJOR / 1 MINOR（M1，路由 design 的 ALLOW 台账补正）+ 非阻塞 N-Obs1–N-Obs5**）——**iteration 2（本版）为 M1 窄幅台账补正 + N-Obs1 矩阵精度建议顺带采纳**，修订映射见 §14.2
- **规范权威**: wire 冻结值 = `docs/protocols/instance-replication-v1.md`（§5 L114–116、§10.3 L307–345、§13.2 L448–452、§17 L578–615、§22 L698–701）；配置语义理据 = `docs/adr/0019-chunked-sync-transfer.md`；词汇 = `CONTEXT.md` L154–171
- **缺失输入**: `wiki/raw/task_issue-299_relevant_decisions.md` 与 `wiki/raw/task_issue-299_conflict_report.md` 不存在（SA6 §1 / SA2 §1 已登记；SA8 门禁报告为 dispatch 指定的冲突面替代）→ 本设计直接以 ADR 0019/0013/0010、协议各节与 CONTEXT.md 为规范依据；设计后冲突复查已由 SA8 执行且 clear（§15）
- **HEAD**: `eb380d7aed296c15accf8832a45a96b630f0c8ce`（分支 `mabf/issue-299`）

---

## 1. 任务类型、目标与非目标

**任务类型：Feature（能力缺口补齐）**。HEAD 的 0x42 codec 仍是 ADR 0013 六字段形态、limits 容器缺两个聚合上限键——这是 ADR 0019 冻结目标与实现现状之间的缺口，不是缺陷（旧形态从未发布，SA8 C4 前提经实测复核成立）。

**目标**：

1. `UPDATE_CHUNK`（0x42）payload 改写为 kind 首字段单形态并正确编解码：`kind varUint ∈ {0,1,2}` 首字段 + 既有五字段序 + 首 chunk 绑定块（kind=1 → `replicationId varString + replicationEpoch varUint`；kind=2 → `syncRoundId varUint`；位置 = `totalBytes` 之后、`bytes` 之前），codec 往返逐字节无损。
2. codec 单帧规则追加：`kind ∉ {0,1,2}`、绑定块缺失/越位 → `MALFORMED_FRAME`；旧六字段形态首字节（0x23 = varString 长度 35）与合法 kind 集合不相交 → 自动作废。
3. 仓内 UPDATE_CHUNK golden vectors 在本分支改写为单形态（ADR 0019 L36–37/L100 显式授权）。
4. 配置面：`maxChunkedBootstrapBytes` / `maxChunkedSyncDiffBytes` 两键（缺省各 4 MiB）进入 `ReplicationLimits` / `DEFAULT_REPLICATION_LIMITS` / 插件 allowlist；两条链②不等式（`≤ maxChunksPerUpdate × maxUpdateBytes`）进入启动期响亮验证，违例构造期 `TypeError`，绝不运行时 clamp；control reserve 校验原样保留；未表达新键的存量配置不误判（非追溯性）。
5. transferId 字段语义（uint32、≥ 1、三 kind 同一字段位/同一计数器语义）在 codec/契约层锁定。

**非目标**（全部沿用 SA6 §12 范围边界与 ADR 0019 非目标）：

- 无 `CAP_CHUNKED_SYNC` 协商、无双形态切换、无发送端 gating（ADR 0019 拒绝方案 #1；SA8 R32：issue 标题措辞废弃，正文为准）。
- 不移除/不改动 0x42 解码侧 `CAP_CHUNKED_UPDATE` 协商门（SA8 R34；负控 N1）。
- 不实现 kind=1/2 的发送端、绑定块**内容**核对（`REPLICATION_ID_MISMATCH` / `REPLICATION_EPOCH_MISMATCH` / `SYNC_STATE_VIOLATION` 属 §8.1/§9.2 后续切片）、按 kind 的聚合上限运行期执行、assembly 状态机的 kind 分派收口、head-of-line 发送端切片与记账。
- 不新增/不改动任何错误码、RESYNC reason、observer 事件（append-only 冻结面；SA8 R36）。
- 不修订 §5/§10.3/§13.2/§17 的规范语义（HEAD 已是目标契约，实现与之对齐；仅收口 §22 L701 措辞，SA8 R37）。
- 不承诺与历史六字段形态互通（同版本部署假设，ADR 0019 部署前提）。

## 2. 当前行为与证据锚点

| # | 当前行为 | 证据锚点 |
|---|---|---|
| 1 | 0x42 codec 为六字段形态：`namespaceId → transferId → chunkIndex → chunkCount → totalBytes → bytes`，无 kind、无绑定块 | `packages/replication-protocol/src/payloads.ts` L651–662（注释）、`decodeUpdateChunk` L663–691、`encodeUpdateChunk` L693+；`messages.ts` `UpdateChunkMsg` L235–246 |
| 2 | 解码顺序以 `namespaceId` varString 起始 → kind 首字节被误读为 varString 长度（0x00→空串 / 0x01→1 字节串）→ `MALFORMED_FRAME: invalid namespaceId` | payloads.ts L664–666；SA6 probe A（`artifacts/sa6-issue299-probe.log`） |
| 3 | 既有单帧规则：transferId ≥ 1、chunkCount ≥ 1、chunkIndex < chunkCount、bytes 非空 ≤ totalBytes、bytes ≤ maxUpdateBytes（超限 `UPDATE_TOO_LARGE`）；encode 侧同套校验（R9 对称） | payloads.ts L666–690（decode）、L694–726（encode） |
| 4 | 解码侧协商门：未协商 `CAP_CHUNKED_UPDATE` 在 payload 解析前 `UNSUPPORTED_MESSAGE_TYPE`（connection fatal 1002）；`selectedCapabilities` 非法值急切 `CONNECTION_POLICY_VIOLATION` | payloads.ts decode 分发；协议 §10.3 L345；负控 N1/N2 HEAD 绿 |
| 5 | `DEFAULT_REPLICATION_LIMITS` 14 键（无两新键）；`validateLimits` 无新键值门；`validateChunkedTransferChain` 仅 #244 链①②；构造器激活门 = 显式 `maxChunkedUpdateBytes` ∨ `maxChunksPerUpdate` | `packages/ws-replication/src/defaults.ts` L16–32；`validate.ts` L140–231；`hub-connection.ts` L201–206；`peer-connection.ts` L115–120 |
| 6 | 插件配置严格 allowlist `LIMIT_KEYS` 14 键（无两新键）→ 新键经插件路径被 `invalid configuration` 拒绝 | `plugin.ts` L154；SA6 probe B / C7 红 |
| 7 | 发送路径：`UpdateChannel` 惰性切片 → `ChunkedTransferPiece`（kind 无关形状，minus namespaceId）→ hub/peer `sendUpdateChunk` 构造消息 → `sender.tryEmitData`；transferId 计数器 = `update-channel.ts` L121 `nextTransferId`（自 1 严格递增、uint32 域不回绕） | `update-channel.ts` L94/L121/L399–409；`update-transfer.ts` L23–30；`hub-connection.ts` L1010–1018；`peer-connection.ts` L797–807 |
| 8 | 接收路径：`frame-io.decodeInbound` → 连接层 `case 'UPDATE_CHUNK'` → `withChannel` → `onUpdateChunk(ChunkedTransferPiece & {sequence})` → `UpdateChunkAssembler`（kind 无关） | `frame-io.ts` L61–75；`hub-connection.ts` L855–858；`peer-connection.ts` L583；`hub-namespace.ts` L669、`peer-namespace.ts` L666 |
| 9 | golden 资产：`fixtures.ts` 3 条 UPDATE_CHUNK golden（BASIC/MULTIBYTE/U32_MAX，六字段字面量，payload 首字节 0x23）+ 测试本地 `UpdateChunkMsg` interface；`codec-messages-golden.test.ts` 锁 `GOLDEN` 恰 21 条与三条消息深等 | `fixtures.ts` L183–190、L359–387；`codec-messages-golden.test.ts` L52–53、L236–244 |
| 10 | 文档面已是目标契约（单形态、配置链、错误码全登记）；§22 L701 预告 golden vectors 由实现票交付 | 协议 §5 L116、§10.3、§17 L602–615、§22 L701；SA8 §1（commits `2ca06f6`+`eb380d7`） |

## 3. 根因 / 能力缺口

承接 SA6 §8 根因链（高置信，逐条有源码与 probe 证据）：

1. **Codec 缺口**：目标契约（ADR 0019「消息形态」+ 协议 §10.3 字段表）要求 kind 首字段单形态；HEAD 解析器按六字段读首字节 → 任何单形态帧必然 `MALFORMED_FRAME: invalid namespaceId`；kind=1/2 绑定块无法表达。R1–R4/R12 红、probe A。
2. **配置缺口**：两新键不在 limits 类型/缺省/值门/链②/插件 allowlist 五个面 → 显式越界/非法值静默接纳（hub/peer 构造入口），插件路径反而拒绝合法新键（配置链断裂）。C1–C4/C7 红、probe B。
3. **非根因**（排除，SA6 §11）：解码器入口、协商门、`selectedCapabilities` 校验、既有链机制、装配桩均健全（N1–N3/C5–C6 绿）。
4. **放大因素**：缺 kind 与绑定块使后续 #295 切片（§8.1/§9.2 分块路径）全部阻塞——本切片是一切后续切片的地基（issue 正文）。

## 4. Owner 要求落实

Issue #299 REST comments 为空（Host dispatch 声明、SA8 §0 与 SA6 §2 三方一致实测 `[]`）→ **无 Owner 评论映射项**。验收目标 = issue 正文 What to build + AC1–AC4 + SA6 已批契约 + SA8 R32–R37。

## 5. 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
|---|---|---|
| 任务类型 = Feature；HEAD 六字段行为是预期现状非缺陷 | SA6 契约抬头 | 设计以能力缺口补齐表述（§1/§3），零「修复」措辞 |
| 契约 21 红断言在 HEAD 100% 确定性失败（3 次重复）；5 负控绿 | `artifacts/sa6-issue299-red-evidence.log`、`-red-detail.log`、`-existing-suites.log`、`-full-suite.log` | 设计实现面 = 精确使 21 断言转绿且 5 负控保持绿（§12 映射）；契约三文件不改一行 |
| 12 × `MALFORMED_FRAME: invalid namespaceId`（kind 首字节被误读） | red-detail.log | §7 D3：kind 首字段先行读取与校验 |
| R5/R6 红：旧六字段未被拒绝、golden 首字节 0x23 | red-detail.log | §7 D3（首字节不相交自动作废）+ D7（golden 改写） |
| 5 × 配置断言红 + 2 × 类型面红（缺省缺失/链缺失/allowlist/TS 缺键） | red-detail.log | §7 D5/D6（配置五面）+ D1/D5（类型面） |
| 契约 §15.1：wire kind 的 TS 字段名未锁定，属 SA1 设计面 | SA6 契约 §15.1 | §7 D1 裁决 `transferKind` |
| 契约 §15.2：编码侧绑定块一致性规则（拒绝 vs 归一化）建议 SA1 显式裁决并补测 | SA6 契约 §15.2 | §7 D4 裁决严格拒绝 + §12 补测项 |
| 契约 §15.3：发送端共用 transferId 计数器为设计约束登记（后续切片执行） | SA6 契约 §15.3 | §7 D8 + §9 登记约束（复用 `update-channel.ts` L121 计数器，不新增第二计数器） |
| 契约 §15.4 / §10：链②激活门门宽 | SA6 契约 §15.4、§10 | §7 D6 显式裁决（含 SA6 文档内部矛盾的推导与处理） |
| 全仓基线：327 文件 3460 用例仅契约 2 文件红 | `artifacts/sa6-issue299-full-suite.log` | 文件范围（§11）保证既有面零回归 |

## 6. SA8 约束落实

| SA8 项 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| R32 标题「CAP_CHUNKED_SYNC 协商 / 双形态」废弃，正文为准 | §1 非目标 | 全程单形态恒用；无协商、无 gating、无双形态断言；设计与 ADR 0019 拒绝方案 #1 对齐 | 否（正文与 ADR 同源，无新冲突） |
| R33 codec 无状态边界（AC4 落地方式） | §7 D3/D4、§9 | codec 只锁 transferId 字段语义（≥ 1、uint32、三 kind 同一字段位）；连接域计数器属发送端状态（`update-channel.ts` 既有计数器，本切片不动）；无跨帧状态入 codec | 否 |
| R34 「无 capability 协商」作用域收窄到 sync 段；解码侧协商门一体适用 | §7 D3、§11 DENY | 协商门（payload 解析前 `UNSUPPORTED_MESSAGE_TYPE`）与 `codec-issue242-ac-red.test.ts` 锚原样保留（负控 N1）；零改动协商面 | 否 |
| R35 链②触发键作用域须精确落地 | §7 D6 | 显式裁决：#244 家族门原样保留（含 `maxChunksPerUpdate`）；#295 两链②各以**自身新键显式**激活。R35 关切（显式下调 `maxChunksPerUpdate` 须响亮）由 #244 链②承载（推导见 D6） | 已执行并了结：SA8 设计后复审 clear（R38 裁决窄门为唯一一致读法）；SA2 §15 独立三层复核维持——**窄门解释原样保留** |
| R36 append-only 冻结面不动 | §1 非目标、§11 DENY | 零断言/零实现 4 新错误码、`SYNC_TRANSFER_EXPIRED`、observer 8 型；只使用既有 `MALFORMED_FRAME`/`UPDATE_TOO_LARGE`/`UNSUPPORTED_MESSAGE_TYPE`/`CONNECTION_POLICY_VIOLATION`；`BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 死码保留不动 | 否 |
| R37 文档同步义务 | §7 D10、§11 ALLOW | 收口协议 §22 L701 措辞，按 **R39 精度约束二分**（SA2 F3）：codec 向量支改写为已交付并指向 `codec-issue299-ac-red.test.ts` 冻结向量 + 改写后 golden；传输层资产支维持「由 §8.1/§9.2 后续切片交付，本规范不预设其存在」待交付表述——不声称不存在的传输层资产；保留 D4-1/D4-2 锚（0x42/0x00000001/四个资产文件名）与 L707 义务句；§17/§13.2/§5 零改动；过期术语扫描照例执行 | 否（R39 在 R37 既有框架内收窄，非新冲突面） |
| 门禁基准：ADR 0019 与任务是义务-履行关系；wire 值唯一权威 = 协议文档 | 全文 | 所有 wire 决策引用协议行号；配置语义引用 ADR 0019 | 否（设计完全在已接受决策内履行） |

## 7. 设计决策与主要备选方案

### D1 — wire kind 的 TS 成员名与类型：`transferKind: UpdateChunkTransferKind`（必填）

`UpdateChunkMsg.kind` 已是判别联合判别键（`'UPDATE_CHUNK'`，messages.ts L237），wire kind 必须异名。裁决：

```ts
/** 0x42 UPDATE_CHUNK wire kind 首字段（ADR 0019 / 协议 §10.3）。0=live-update / 1=snapshot / 2=sync-diff。 */
export type UpdateChunkTransferKind = 0 | 1 | 2;

export interface UpdateChunkMsg {
  kind: 'UPDATE_CHUNK';
  /** wire kind 首字段（单形态恒在；编码/解码双向校验 ∈ {0,1,2}）。与判别键 kind 异名。 */
  transferKind: UpdateChunkTransferKind;
  namespaceId: string;
  transferId: number;
  chunkIndex: number;
  chunkCount: number;
  totalBytes: number;
  /** 绑定块成员（当且仅当 transferKind=1 ∧ chunkIndex=0 出现；见 replicationEpoch）。 */
  replicationId?: string;
  replicationEpoch?: number;
  /** 绑定块成员（当且仅当 transferKind=2 ∧ chunkIndex=0 出现）。 */
  syncRoundId?: number;
  bytes: Uint8Array;
}
```

- 命名 `transferKind` 而非 `chunkKind`：kind 是 transfer 的属性（同一 transfer 全部 chunk 同 kind；ADR 0019 通篇「单笔 chunked transfer」），与既有成员 `transferId` 构成自然兄弟命名；§17 配置键语义（`maxChunked*Bytes` 按 kind 分族）同源。
- **必填**（非可选 + 缺省 0）：wire 首字段恒在（R1 往返强制），可选+缺省会制造「调用方漏写被静默当 kind=0」的静默 fallback；必填使所有构造点在编译期显式表态。经 `src/index.ts` 导出 `UpdateChunkTransferKind`（公共类型与 codec 行为同步演化，包 AGENTS 纪律）。
- 备选拒绝：(a) 判别联合三接口（live/snapshot/sync 各一 interface）——绑定块存在性还依赖 `chunkIndex===0`（运行时数据），静态类型无法表达「kind=1 ∧ idx>0 无绑定块」，三接口制造虚假静态保证；(b) `chunkKind`/`wireKind` 命名——语义弱于 transfer 归属；(c) 可选 + encode 缺省 0——静默缺省，拒绝。

### D2 — 绑定块 TS 形状：可选成员 + codec 双向 iff 校验（无静态伪保证）

`replicationId?: string` / `replicationEpoch?: number` / `syncRoundId?: number` 为可选成员；**存在性唯一裁决点 = codec**：decode 按 wire 位置还原（不可能产出非法组合），encode 按 iff 规则校验（非法组合拒绝，见 D4）。类型面不试图静态表达（D1 备选 a 已拒绝）；调用方在类型面上以可选成员读取绑定块。

### D3 — decode：kind 首字段先行 + 立即校验 + 绑定块按位读取（单形态唯一形态）

`decodeUpdateChunk`（payloads.ts L663）新读取序（协议 §10.3 字段表逐字）：

1. `kind = reader.readVarUint()`（canonical varUint，`canonical.ts` reader 既有原语）；`kind ∉ {0,1,2}` → 立即 `MALFORMED_FRAME`（首字节流入即拒绝——ADR 0019 L37「恶意声明在第一个字节流入前即可拒绝」；kind=3/127 红、旧六字段首字节 0x23=35 自动落入本拒绝 → R5/R7）。
2. `namespaceId = reader.readVarString()` + `checkNamespaceId`（不变）。
3. `transferId`（≥ 1）/ `chunkIndex` / `chunkCount`（≥ 1、idx < count）/ `totalBytes`（既有规则逐字不变）。
4. **绑定块**（`kind≠0 ∧ chunkIndex=0` 时，位置 = totalBytes 之后、bytes 之前）：kind=1 → `replicationId = readVarString()` + `replicationEpoch = readVarUint()`（safe uint）；kind=2 → `syncRoundId = readVarUint()`。仅按 wire 位置读取——契约违例向量（缺块/越位/尾随）经 canonical reader 的定长读尽、缓冲欠载、非 canonical 与全消费检查收敛为 `MALFORMED_FRAME`（R8/R9/R10 各向量已逐条手验收敛路径——SA2 O1 更正后的精确机制：`KIND1_NO_BINDING` 在 replicationEpoch 读取处欠载（replicationId 误吞长度前缀 `03`+`0a0b0c` 后缓冲尽）；`KIND1_BINDING_AFTER_BYTES` 在 bytes 长度声明处欠载（绑定块位先读，RID 首字节 `61` 被当 bytes 长度前缀，声明 97 > 余量 33）；`KIND1_BINDING_ON_LATER` 落入全消费尾随检查（idx=1 不读绑定块，bytes 长度前缀 `20`=32 恰好消费 RID 余量，遗留 `01 0a` 两字节尾随）；`KIND2_BINDING_ON_LATER` 在 bytes 长度声明处欠载（idx=1 不读绑定块，长度前缀 `05` 声明 5 字节仅余 2——**非尾随路径**）；`KIND0_BINDING_BYTES` 落入尾随检查（bytes 长度前缀 `01` 消费 `0a` 后遗留绑定块字节）。五向量分类同为 `MALFORMED_FRAME`、行为无差异，但机制按实测收敛点逐条精确，防 SA4 按错误机制实现「专门」的尾随检查——尾随检查仅是既有全消费纪律，无需为任一向量新增代码路径）。
5. `bytes = readVarUint8ArrayCopy()` + 既有规则（非空、≤ totalBytes、≤ maxUpdateBytes → `UPDATE_TOO_LARGE`，kind 无关，R13）。
6. 全消费检查（既有）不变。

返回对象携带 `transferKind` 与（如存在）绑定块成员（条件展开，无显式 `undefined` 键）。协商门、`encodePayload`/`decodePayload` 分发、`FieldLimits` 透传全部不变（R34）。

### D4 — encode：同一套单帧规则 + 绑定块 iff 严格拒绝（SA6 §15.2 裁决：拒绝，不归一化）

`encodeUpdateChunk`（payloads.ts L693）在既有「先验证后写」序上追加（全部 → `MALFORMED_FRAME`）：

- `transferKind` 非 safe integer ∉ {0,1,2} → 拒绝（JS 调用方/cast 防御；TS 面已由 D1 类型收窄）。
- 绑定块 iff 校验（严格拒绝，不做 writer 归一化）：
  - `transferKind=0`：三个绑定成员任一存在 → 拒绝；
  - `transferKind=1 ∧ chunkIndex=0`：`replicationId`（string）与 `replicationEpoch`（safe uint，varUint 可编码）必须存在，`syncRoundId` 必须不存在，否则拒绝；
  - `transferKind=1 ∧ chunkIndex>0`：三个绑定成员必须全部不存在 → 拒绝携带者；
  - `transferKind=2 ∧ chunkIndex=0`：`syncRoundId`（safe uint）必须存在，`replicationId`/`replicationEpoch` 必须不存在；
  - `transferKind=2 ∧ chunkIndex>0`：全部不存在。
- 写序 = D3 读序镜像：`writeVarUint(transferKind,'kind')` 首位 → 既有五字段 → 绑定块（iff）→ bytes。

**裁决理由（拒绝 vs 归一化）**：归一化（如 kind=1 ∧ idx>0 时静默丢弃绑定块）= 为调用方 bug 提供静默 fallback，违反 R9 对称纪律（encode/decode 同一套单帧规则）与「正常路径不变量缺失应 fail loud」；丢弃还会使 decode→encode→decode 不等价。**值域边界（SA6 §15.6）**：codec 只校验结构性规则与 varUint/varString 可编码性（safe uint ≥ 0）；`replicationId` 文法、`replicationEpoch ≥ 1`、`syncRoundId ≥ 0` 等语义域**不校验**——内容核对属 §8.1/§9.2 后续切片（R36），过度约束会与后续切片冲突。
- 备选拒绝：encode 归一化（丢弃/补默认绑定块）——静默改写调用方输入，拒绝；值域校验入 codec——越界抢占 §8.1/§9.2 的内容核对语义，拒绝。

### D5 — 配置五面：类型 / 缺省 / 值门 / 插件 allowlist（链见 D6）

1. `types.ts` `ReplicationLimits` 追加两必填 `readonly number` 键（api.test-d 契约同形；文档注释锚 ADR 0019 配置表）。
2. `defaults.ts` `DEFAULT_REPLICATION_LIMITS` 追加 `maxChunkedBootstrapBytes: 4 * 1024 * 1024`、`maxChunkedSyncDiffBytes: 4 * 1024 * 1024`（C1 键集恰为 14+2；`resolveLimits` Partial 合并自动携带；timeouts 键集零漂移——`assemblyTimeoutMs` 容器不动，AC3）。
3. `validate.ts` `validateLimits` 追加两键 `positiveSafeInteger` 值门（合并结果上无条件执行；缺省 4 MiB 恒合法 → 零非追溯性面；C2/C3 非法值 0/1.5/−1 构造期 `TypeError`）。
4. `plugin.ts` `LIMIT_KEYS` 追加两键（C7：hub/peer 插件配置接纳新键；`mergeNested` 为对象展开（plugin.ts L214–217），显式键的 own-property 在 config→override→构造器链上保真，链②经构造器继承生效；C7(3) 插件 `apply` 路径违例 → `TypeError` 且无 ready 服务）。
5. control reserve 校验（`maxQueuedControlBytes ≥ maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES`）与全部既有链**原样不动**（C6；ADR 0019 L63「静态纪律、不条件化」）。

### D6 — 链②激活门裁决（R35 / SA6 §15.4 显式裁决）：#295 两链各以自身新键显式激活；#244 家族门原样保留

**裁决**：

- **#244 家族（链① `maxChunkedUpdateBytes ≤ maxQueuedUpdateBytes`、链② `≤ maxChunksPerUpdate × maxUpdateBytes`）**：激活门 = 显式 `maxChunkedUpdateBytes` ∨ 显式 `maxChunksPerUpdate` —— **HEAD 原样保留**（hub-connection.ts L201–206 / peer-connection.ts L115–120 现有块零语义变化）。
- **#295 bootstrap 链②**（`maxChunkedBootstrapBytes ≤ maxChunksPerUpdate × maxUpdateBytes`）：激活 ⇔ 调用方**显式表达 `maxChunkedBootstrapBytes`**。
- **#295 sync 链②**（`maxChunkedSyncDiffBytes ≤ maxChunksPerUpdate × maxUpdateBytes`）：激活 ⇔ 调用方**显式表达 `maxChunkedSyncDiffBytes`**。
- 判定一律在 resolve 合并结果上；`≤` 含等号；绝不运行时 clamp。

**推导（为什么显式 `maxChunksPerUpdate` 不激活 #295 两链）**——SA6 可执行契约的边界族在数学上排除了更宽的门：

```text
C2/C3 边界接纳族 = {maxChunksPerUpdate: 4, maxChunkedUpdateBytes: 1MiB, maxQueuedUpdateBytes: 2MiB, <新键=2MiB>}
合并结果：maxUpdateBytes = 512KiB（缺省），product = 4 × 512KiB = 2 MiB，
          另一新键 = 缺省 4 MiB > 2 MiB。
契约断言该构型必须被「接纳」（expectBothEntryPointsAccepted，≤ 含等号敏感度锚）。
⇒ 若显式 maxChunksPerUpdate（或任一新键）激活「另一条」未表达新键的链，缺省 4 MiB > product 2 MiB
  必然构造期 TypeError，C2/C3 边界接纳断言失败。
⇒ 每条 #295 链②只能由其自身新键的显式表达激活。
```

**R35 关切的保持**：显式下调 `maxChunksPerUpdate`（如 `{maxChunksPerUpdate: 1}`）仍构造期响亮 `TypeError`——由 #244 链②承载（合并结果 `maxChunkedUpdateBytes` 缺省 4 MiB > 1 × 512 KiB；C5(a) 的红→绿正是该路径；三 envelope 缺省同为 4 MiB，故任何 `product < 4 MiB` 的显式下调必被 #244 链②捕获）。C5(b) `{maxChunksPerUpdate: 8}`（product = 4 MiB = 缺省 envelope）接纳、C5(c) 零分块族键配置（含 `maxUpdateBytes: 32KiB` 反例）接纳——均与裁决一致。

**上游矛盾记录（诚实报告）**：SA6 契约文档内部存在张力——§10 影响面速写「链②激活门 = 新键 ∨ `maxChunksPerUpdate`」与 §15.4 散文「`maxChunksPerUpdate` 显式下调触发新链…锁定为必须激活」采取更宽读法，而其可执行断言 C2/C3 边界族（转绿判据「不改一行 26/26 通过」）要求本裁决的窄门。**可执行契约是已批验收权威**，设计按窄门落地；该偏差与推导在此显式登记，供 SA2/SA4/SA8 复核（若后续裁定采纳散文宽门，须先修订契约 C2/C3 边界族——按 SA6 §15.4 自身的「同步修订本契约」出口）。附带语义后果（设计接受并被 C2/C3 边界族显式 sanction）：显式表达某分块族键 + 显式下调 `maxUpdateBytes` 的配置（如 `{maxUpdateBytes: 32KiB, maxChunkedBootstrapBytes: 1MiB}`）中，未表达新键的缺省 envelope 可数学越界而不被构造期拦截——与 C5(c)「缺省不可判」纪律同构，属已批语义。

**实现形状**：`validate.ts` 新增两个一不等式函数（各自独立、可独立激活、错误消息含三操作数值）：

```ts
/** issue #299（ADR 0019 配置链）：bootstrap 聚合上限链②——仅显式 maxChunkedBootstrapBytes 激活（D6）。 */
export function validateChunkedBootstrapChain(limits: ReplicationLimits): void
/** issue #299（ADR 0019 配置链）：sync-diff 聚合上限链②——仅显式 maxChunkedSyncDiffBytes 激活（D6）。 */
export function validateChunkedSyncDiffChain(limits: ReplicationLimits): void
```

hub/peer 构造器在既有 #244 门块之后各加两条 `hasOwnProperty` 守卫调用（与 HEAD 内联门习惯一致；两处保持逐字对称）。包内私有导出（不经 `src/index.ts`，与 `validateChunkedTransferChain` 同待遇）。

- 备选拒绝：(a) 家族门（任一新键 ∨ `maxChunksPerUpdate` 激活两链）——与 C2/C3 边界接纳断言数学冲突（上推导）；(b) 每链布尔参数单函数——两链激活条件在本裁决下完全同构于自身键，独立函数更可读；(c) 把门收进 `validateLimits` 无条件执行——违反非追溯性（C5(c) `{maxUpdateBytes: 32KiB}` 必须接纳）；(d) 修改 SA6 契约文件以对齐散文——被转绿判据禁止。

### D7 — golden vectors 改写（AC1）：3 条既有 golden 改写为 kind {0,1,2}，计数 21 不变

`fixtures.ts` 三条 golden（BASIC/MULTIBYTE/U32_MAX）与本地 `UpdateChunkMsg` interface（L183）：

| golden | 改写后 kind | 绑定块 | payload 前缀变化 |
|---|---|---|---|
| UPDATE_CHUNK_BASIC（idx=0） | 0（live-update 首 chunk） | 无（kind=0 恒无） | 前缀 `00`（payload = `00` + 原六字段序） |
| UPDATE_CHUNK_MULTIBYTE（idx=63） | 1（snapshot 非首 chunk） | 无（idx>0 不得携带） | 前缀 `01` |
| UPDATE_CHUNK_U32_MAX（idx=0xfffffffe） | 2（sync-diff 非首 chunk） | 无（idx>0 不得携带） | 前缀 `02` |

三 kind 全覆盖、R6 首字节 ∈ {0,1,2} 且逐字节往返；`GOLDEN` 计数 21 不变（`codec-messages-golden.test.ts` L53 零改动，仅 L236 用例标题的字段序描述行更新为 `kind → ns → …`，断言面不变）；truncation/fuzz 按 GOLDEN 驱动自动覆盖新形态。**绑定块形态不进 fixtures golden**：由契约冻结向量 `KIND1_FIRST`/`KIND2_FIRST`（codec-issue299-ac-red.test.ts R3/R4，永久回归资产）逐字节锁定——§22 L701「kind 首字段 + 首 chunk 绑定块的 golden vectors 由实现 ticket 交付」由此兑现（+ 改写后 golden）。

**既有六字段字面量同步作废于 `codec-issue242-ac-red.test.ts`（SA2 F1：改写面完整声明，三处改动 + 向量本体的机械跟随）**——该文件是 #242 协商/回落契约锚，改写后必须全绿且保持判别力：

- **改动 ①（向量本体 + 锁定帧字面量）**：VECTOR_A/B/C `message` 各加 `transferKind: 0`、`payloadHex` 各前缀 `'00'`（三向量保持 kind=0 live-update 语义）；`PINNED_FRAME_HEX` 三条锁定字面量的头部 payloadLength 字段随 +1 字节同步（A: 45→46 字节 `2d`→`2e`、B: 50→51 字节 `32`→`33`、C: 58→59 字节 `3a`→`3b`）——否则「golden 向量与规范算术构造一致」用例（`buildFrameHex` 自校验 vs 锁定字面量）必红（`buildFrameHex` 实测按 payloadHex 长度计算头部，fixtures.ts L61–74）。
- **改动 ②（`hostilePayload` 敌意构造前缀——F1(b) 伪绿修复）**：`hostilePayload` 增加缺省 `'00'` kind 前缀并扩展 `kindHex` 覆盖键——拼接序变为 `(overrides.kindHex ?? '00') + (overrides.nsHex ?? NS_HEX) + …`。缺省前缀使 L247–297 全部敌意向量（非 canonical varUint / 非法 UTF-8 / 超声明 bytes / 单帧自洽 / 尾随）携带合法 kind=0 首字节，字段级规则重新可抵达——单形态解码下无前缀的敌意 payload 首字节 0x23=35 ∉ {0,1,2}，全部在 kind 门被偶然拒绝（断言仍绿但不再测及被测规则）；判别性由前缀存在保证（如 `transferIdHex:'8100'` 非最短编码在 kind 合法前提下仍 `MALFORMED_FRAME`，抵达 canonical 检查）。
- **改动 ③（L225–232 字段序锁定断言改写——F1(a) 必红修复）**：从「`startsWith(NS_HEX)` + `.slice(NS_HEX.length)`」改写为单形态全序断言——`expect(VECTOR_A.payloadHex.startsWith('00' + NS_HEX)).toBe(true)` + `.slice(2 + NS_HEX.length)` 等值断言（B/C 同步），或等价的全字面量 payloadHex 等值断言；用例标题（L225「字段顺序锁定：varString(ns) → …」）更新为 `kind(varUint) → varString(ns) → …` 单形态序。
- **注释/标题同步**：文件头契约锚注释（L5–7「字段顺序唯一权威：namespaceId → …」）与 AC1 describe 标题（「字段序 = ADR 0013」）的字段序描述更新为 ADR 0019 / 协议 §10.3 单形态序（权威引用同步升级，ADR 0013 划除登记由 ADR 0019 承载）。

语义边界澄清：「该文件不引入 kind≠0 变量」**仅指三 golden 向量的语义**（保持 kind=0 live-update，不引入 kind≠0 正控/敌意变量）；敌意构造统一携带缺省合法 kind=0 前缀（改动 ②），kind≠0 的违例面由契约 R8–R10 与 encode-symmetry 补测（D4/F2）承载，不在本文件扩张。
- 备选拒绝：第四条 golden（如 kind=2 首 chunk + syncRoundId 绑定）——需改 `GOLDEN` 计数锚 21→22，超出已批契约改写面（SA6 §10 明确「3 条 golden 改写」），绑定块已由契约向量锁定；改变某 golden 的 chunkIndex（如 MULTIBYTE idx 63→0）以承载绑定块——破坏其 uint32/多字节原始用途。

### D8 — 连接层：发送显式 `transferKind: 0`，接收承载不消费（切片边界）

- **发送**：hub-connection.ts L1010–1018 与 peer-connection.ts L797–807 的 `sendUpdateChunk` 消息字面量追加 `transferKind: 0`（live-update 路径本切片唯一 kind；注释锚后续切片）。`ChunkedTransferPiece`（update-transfer.ts L23，「UPDATE_CHUNK 消息体 minus namespaceId」）**不加 kind**——kind=1/2 发送端（含绑定块数据流）属 §8.1/§9.2 后续切片，现在加可选 kind 是投机面。
- **接收**：`case 'UPDATE_CHUNK'` 经 `{...message, sequence}` 展开转发（hub-connection.ts L857），`transferKind` 与绑定块成员作为额外字段结构兼容地流过 `onUpdateChunk` → `UpdateChunkAssembler`（本切片 kind 无关，不读取）；无新分支、无新拒绝面。
- **不可达性论证**：同版本部署假设下（ADR 0019 部署前提），本版本端点不发送 kind≠0 帧，故「kind≠0 帧进入 live-update assembly」在本切片部署面结构性不可达；测试亦不构造该形态经传输层。kind 分派/按 kind 聚合上限/绑定块内容核对 = 后续切片（SA6 §12 范围边界「assembly 状态机与 kind 无关收口」）。
- **AC4 计数器约束登记（本切片仅契约锁定，不改代码）**：三种 kind 共用同一 transferId 计数器，作用域 (连接, 方向, namespaceId)，从 1 严格递增、uint32 不回绕；kind=1/2 发送端落地时**复用 `update-channel.ts` L121 既有 `nextTransferId`，不新增第二计数器**。本切片 codec 层锁定字段语义（R11 transferId=0 三 kind 一致拒绝、R12 uint32 上界三 kind 一致接纳；D3/D4 同一字段位）。

### D9 — fuzz/property 扩展（§22 义务顺带兑现）

`codec-fuzz-property.test.ts` case 18（L144–157）生成器扩展：`transferKind` 随机 ∈ {0,1,2}；`chunkIndex` 随机 ∈ [0, chunkCount)；当 `transferKind≠0 ∧ chunkIndex=0` 时生成绑定块成员（replicationId 随机 hex string / replicationEpoch、syncRoundId 随机 safe uint），否则不生成。既有 300 轮 encode→decode→逐字段一致断言（L160–178）自动覆盖三 kind × 绑定块有无的全部 presence 组合（对称性属性面）。

### D10 — 文档义务（R37 + SA8 R39 精度约束，SA2 F3 二分收口）

协议 §22 L701 措辞收口——**不得整句改写为「已交付」**：现文「kind 首字段 + 首 chunk 绑定块的 golden vectors **与传输层测试资产**由实现 ticket 交付，本规范不预设其存在」须**拆为两支**（本切片只交付 codec 向量；传输层 kind=1/2 资产属 §8.1/§9.2 后续切片、不存在——按 D10 旧稿整句收口会把不存在的传输层资产写成事实，违反 docs/AGENTS.md「documentation-only wording changes must not invent implementation behavior」）：

- **codec 向量支（改写为已交付事实并指向资产）**：「kind 首字段 + 首 chunk 绑定块的 golden vectors 已由实现 ticket 交付」+ 指向 `packages/replication-protocol/test/codec-issue299-ac-red.test.ts` 冻结向量（`KIND1_FIRST`/`KIND2_FIRST` 等）与改写后 golden（`codec-messages-golden.test.ts` / `fixtures.ts`）。
- **传输层资产支（维持待交付表述，原样保留语义）**：「传输层测试资产由 §8.1/§9.2 后续切片交付，本规范不预设其存在」——收口后 §22 内不得存在任何「传输层资产已交付/已存在」语义的表述。

**保持不变**：§22 内 `0x42`、`0x00000001` 与四个资产文件名锚（`codec-issue246-doc-contract.test.ts` D4-1/D4-2 依赖，`toContain` 断言）；新增指向的 `codec-issue299-ac-red.test.ts` 文件名在仓（doc-contract D6-1 存在性检查可解析）；L707「实现不得改变本文字段顺序和消息语义」义务句零改动。§5/§10.3/§13.2/§17/§1 零改动；CONTEXT.md 零改动（HEAD 词条已是目标语义）；ADR 零改动（ADR 0019 已接受，本设计是履行非修订）。

## 8. 接口、状态机和数据流

**接口变化**（全部 additive-with-required-member，无签名变化）：

| 接口 | 变化 | 消费方 |
|---|---|---|
| `UpdateChunkMsg`（公共） | + `transferKind`（必填）、+ `replicationId?`/`replicationEpoch?`/`syncRoundId?` | 两包 + 测试（§10 矩阵） |
| `UpdateChunkTransferKind`（公共，新） | `0 \| 1 \| 2` 命名类型 | 经 `src/index.ts` 导出 |
| `ReplicationLimits`（公共） | + 两必填 readonly number 键 | `Partial<ReplicationLimits>` 消费方（app/插件）类型不破 |
| `DEFAULT_REPLICATION_LIMITS` | + 两键 4 MiB | C1 |
| `validateChunkedBootstrapChain` / `validateChunkedSyncDiffChain`（包内私有，新） | 一不等式各一 | hub/peer 构造器 |
| `LIMIT_KEYS`（plugin.ts 私有） | + 两键 | 插件配置面 |
| wire 0x42 payload | 单形态（kind 首字段 + 绑定块位） | 对端（同版本） |

**状态机**：零状态机变化。codec 无状态（R33）；连接/namespace/assembly 状态机不动；配置校验是构造期一次性纯函数。

**数据流路线**：

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| ① 出站 live-update chunk（kind=0） | `UpdateChannel` 出队惰性切片（完整 update > maxUpdateBytes ∧ 协商 ∧ live） | `ChunkedTransferPiece`（无 kind，不变）→ hub/peer `sendUpdateChunk` 构造 `{kind:'UPDATE_CHUNK', transferKind:0, …}` | 包内内存对象 → `encodeMessage`/`encodeUpdateChunk`（D4 校验后写 kind 首字节） | WS binary frame（data 路径、sequence、记账口径全部不变） | 对端 `decodeInbound` | 0x42 帧首 payload 字节 = `00`；字段序 = kind → 五字段 | encode 违例 → `ProtocolError`（MALFORMED_FRAME/UPDATE_TOO_LARGE）在出站点抛出，`sendUpdateChunkFrame` 既有 try/catch 收敛为 0 + send-failed（不变） | R1/R2 往返；issue243/244 既有传输套件 |
| ② 入站 0x42（任意 kind） | 对端 WS frame | — | 协商门（payload 前，不变）→ `decodeUpdateChunk` 单形态解码（D3）→ 连接层展开转发 | — | `onUpdateChunk` → `UpdateChunkAssembler`（kind/绑定块本切片不消费） | 合法单形态帧解码为携带 `transferKind`/绑定块的消息；kind≠0 帧解码成功且流过 live 路径（部署面不可达，D8） | kind 非法/绑定块违例 → `MALFORMED_FRAME`（connection fatal 1002，分类不变）；未协商 → `UNSUPPORTED_MESSAGE_TYPE`（不变） | R1–R14、N1 |
| ③ 配置链 | `createHubReplication`/`createPeerReplication`（含插件 `apply` 经 `mergeNested` 同一入口） | 构造期（服务注册前） | `resolveLimits`（Partial 合并，新键缺省 4 MiB）→ `validateLimits`（值门）→ #244 家族门（不变）→ #295 两链各自新键门（D6） | 内存配置，无持久化 | 构造器/插件 ready 服务 | 违例构造期 `TypeError`、无 ready 服务；合法（含边界等号）接纳 | `TypeError` 即失败终止，无 clamp、无部分初始化（构造器顺序：校验先于字段赋值，HEAD 顺序保持） | C1–C7 |

无持久化数据、无跨进程数据、无缓存一致性面（同版本部署，帧即弃）。

## 9. 错误、恢复、并发和幂等

- **错误分类零新增**：codec 层仅 `MALFORMED_FRAME`（connection fatal 1002）与 `UPDATE_TOO_LARGE`（namespace 级，字段限额复用 maxUpdateBytes，kind 无关）+ 既有协商门两码；配置层 `TypeError`（`assertCollKind`/`positiveSafeInteger` 既有抛出面）。R36 冻结面零触碰。
- **失败语义**：decode 违例 = 连接 fatal（对端行为不变）；encode 违例 = 调用方 bug 响亮失败（发送侧控制器既有 try/catch → 弃置 + send-failed 声明，路径不变）；配置违例 = 构造期一次性失败，无运行期重试面。
- **恢复**：连接 fatal 后由既有重连/RESYNC 机制承载（不在本切片）；assembly 易失性纪律不变（partial 绝不入 live Y.Doc）。
- **并发/幂等**：codec 纯函数无并发面；配置校验构造期单线程；transferId 计数器语义（AC4）本切片仅字段锁定，计数器本体在 `UpdateChannel` 既有串行域（每 ns 方向单 channel），kind=1/2 复用约束已登记（D8）。
- **资源所有权**：零新所有权。绑定块成员随消息对象生命周期；无新 buffer 分配路径（`readVarUint8ArrayCopy` 既有拷贝纪律）。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `hub-connection.sendUpdateChunk`（L1010） | 构造六字段消息字面量 | 构造含 `transferKind: 0` 的单形态消息 | +1 成员（D8） | hub-connection.ts L1010–1018 |
| `peer-connection.sendUpdateChunk`（L797） | 同上 | 同上 | +1 成员（D8） | peer-connection.ts L797–807 |
| hub/peer 构造器链②门（hub L201–206 / peer L115–120） | #244 家族门 | 追加两条新键守卫调用（D6） | 各 +4 行 | 两文件现有块 |
| `hub-namespace.onUpdateChunk`/`sendUpdateChunkFrame`、`peer-namespace` 对应面 | 结构化转发 `ChunkedTransferPiece & {sequence}` | 不变（展开携带新字段，结构兼容，assembler 不读取） | 零改动 | hub-namespace.ts L64/L669/L812；peer-namespace.ts L59/L666/L804 |
| `frame-io.decodeInbound` | 透传 `selectedCapabilities` + decode | 不变（新字段随消息透传） | 零改动 | frame-io.ts L61–75 |
| `update-channel` / `update-transfer`（`UpdateChunkAssembler`） | kind 无关收发 | 不变（D8 切片边界） | 零改动 | update-channel.ts L121；update-transfer.ts L23 |
| `plugin.ts`（hub/peer 插件） | `LIMIT_KEYS` 14 键拒绝新键 | allowlist 接纳；`mergeNested` 展开保真 → 构造器链继承（C7） | LIMIT_KEYS +2 键 | plugin.ts L154/L214–217/L362/L453/L392/L475 |
| `encodePayload`/`decodePayload` 分发 | 按 kind 判别键分发 | 不变 | 零改动 | payloads.ts L809 |
| `apps/yjs-server`（`Partial<ReplicationLimits>` 消费 + 自有 config 文件 allowlist） | 类型面不感知具体键；app `LIMIT_KEYS`（config.ts L136–148）自 #243/#244 起即不含分块族键 | 类型零破（Partial）；app 配置文件面维持家族级滞后（见 DENY） | 零改动（本切片） | apps/yjs-server/src/config.ts L136–148、index.ts L89/L146 |
| `packages/replication-protocol/test`：fixtures（L183/L359–387）、codec-issue242-ac-red（改动 ①②③ + `PINNED_FRAME_HEX` 头部长度同步，D7）、codec-messages-golden（L236 标题行）、codec-fuzz-property（case 18）、codec-api.test-d（L44–61，`toMatchTypeOf` 容忍额外成员，零改动必要） | 六字段构造/字面量 | 单形态构造（D7/D9） | fixtures/vectors/fuzz 更新；api.test-d 可选补 `transferKind` 类型锁 | 各文件 |
| `packages/replication-protocol/test/codec-issue299-encode-symmetry.test.ts`（**新增**，SA2 F2 授权落点） | 不存在 | encode 侧 iff 严格拒绝冻结断言（§12 清单：负控 ①–⑧ + 正控 P1–P5） | 新建文件（§11 ALLOW 在列；不触契约三文件） | SA2 §13-F2 / SA6 §15.2 |
| `packages/ws-replication/test` 4 个构造 0x42 的文件：issue243-chunked-live、issue243-ac-red、issue244-ac-red、issue246-interop-matrix | `encodeMessage({kind:'UPDATE_CHUNK',…})` 对象字面量 | 每处 + `transferKind: 0`（全部为 live-update 传输测试） | 每文件少量成员行（SA3 实现实测已改，`git status` 在列） | `grep -rl "kind: 'UPDATE_CHUNK'"` 实测清单 |
| `packages/ws-replication/test` 4 个仅类型提取的文件：issue243-real-transport、issue244-sa7-dynamic、issue244-slot-reclaim-regression、issue245-ac-red | `type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>` 类型别名（无对象字面量构造） | 不变——类型级提取自动携带新必填成员，无需运行时表态（iteration 2 更正：原「每处 + transferKind: 0」为过宽登记） | 零改动（SA4 §4 / SA3 §ALLOW 内零改动段 / 本轮 grep 三方一致） | 各文件 L58 / L104 / L96 / L97 |
| `ws-replication-observer-red.test.ts`（`ConnectionSenderHost` 手写全量 `ResolvedLimits` 字面量，L799–811；T5 水位夹具） | 完整 16 键 limits 字面量（缺省值手写形态） | 两新键转必填后编译期必红（TS2739: missing `maxChunkedBootstrapBytes`, `maxChunkedSyncDiffBytes`）→ 字面量机械跟随补两键缺省值（值 = `DEFAULT_REPLICATION_LIMITS` 的 4 MiB；链②合法：4 MiB ≤ 64 × 512 KiB = 32 MiB；零断言面——两新键在 `src/` 无行为读者，该测试不跑构造器校验链） | **+2 行编译期必改**（iteration 2 更正：原「零改动」为登记缺陷——D5.1 必填类型面 × §12 根 typecheck 零错误 × 「该文件零改动」三者数学上不相容，SA4 §4-A 五要素静态证明） | `types.ts` L53/L57 必填键；`ResolvedLimits extends ReplicationLimits {}`（types.ts L882）；`backpressure.ts` L44 `limits: ResolvedLimits`（非 Partial）；同字面量 #243/#244 先例（commit `bbdaa65`/`9a669f4`）；`git diff` 实测恰 +2 行 |
| `codec-malformed.test.ts` / `codec-roundtrip-truncation.test.ts` / `codec-issue246-doc-contract.test.ts` | HEX 向量/GOLDEN 驱动/文档锚 | 不变（实测无 0x42 构造；GOLDEN 驱动自动覆盖；doc 契约锚保留） | 零改动 | 各文件审计（`git status` 无条目） |
| SA6 契约三文件 | 红 | 26/26 绿（不改一行） | **禁止修改** | SA6 §13 转绿判据 |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因（正文锚） |
|---|---|---|
| `packages/replication-protocol/src/messages.ts` | `UpdateChunkMsg` + `transferKind`/绑定块成员；新增 `UpdateChunkTransferKind` | D1/D2 |
| `packages/replication-protocol/src/payloads.ts` | `decodeUpdateChunk`/`encodeUpdateChunk` 单形态重写（注释块同步） | D3/D4 |
| `packages/replication-protocol/src/index.ts` | 导出 `type UpdateChunkTransferKind` | D1（公共 API 经 index 纪律） |
| `packages/ws-replication/src/types.ts` | `ReplicationLimits` + 两必填键（注释锚 ADR 0019 配置表） | D5 |
| `packages/ws-replication/src/defaults.ts` | `DEFAULT_REPLICATION_LIMITS` + 两键 4 MiB | D5 |
| `packages/ws-replication/src/validate.ts` | `validateLimits` + 两值门；新增 `validateChunkedBootstrapChain`/`validateChunkedSyncDiffChain` | D5/D6 |
| `packages/ws-replication/src/plugin.ts` | `LIMIT_KEYS` + 两键 | D5 |
| `packages/ws-replication/src/hub-connection.ts` | 链门追加两守卫；`sendUpdateChunk` + `transferKind: 0` | D6/D8 |
| `packages/ws-replication/src/peer-connection.ts` | 同上（逐字对称） | D6/D8 |
| `packages/replication-protocol/test/fixtures.ts` | 本地 interface + 3 golden 单形态改写（hex 前缀 + message 成员） | D7 |
| `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` | D7 三处改写：① VECTOR_A/B/C `message` + `transferKind: 0`、`payloadHex` + `'00'` 前缀、`PINNED_FRAME_HEX` 头部 payloadLength 同步（`2d`→`2e` / `32`→`33` / `3a`→`3b`）；② `hostilePayload` 缺省 `'00'` kind 前缀 + `kindHex` 覆盖键（敌意套件字段级规则保持可抵达，F1(b) 伪绿消除）；③ L225–232 字段序锁定断言改写为 `kind → ns → 五字段` 全序 + 文件头/用例标题字段序描述行同步（F1(a) 必红消除） | D7 / SA2 F1 |
| `packages/replication-protocol/test/codec-issue299-encode-symmetry.test.ts` | **新增**：encode 侧 iff 严格拒绝冻结断言清单（§12 AC2 编码侧对称行：负控 ①–⑧ 全部 `MALFORMED_FRAME` + 正控 P1–P5；不触契约三文件） | D4 / SA2 F2（SA6 §15.2 补测建议的授权落点；`codec-malformed.test.ts` 维持零改动——落点二选一取新文件方案） |
| `packages/replication-protocol/test/codec-messages-golden.test.ts` | 仅 L236 用例标题字段序描述行（断言面不变） | D7 |
| `packages/replication-protocol/test/codec-fuzz-property.test.ts` | case 18 生成器 kind/绑定块扩展 | D9 |
| `packages/replication-protocol/test/codec-api.test-d.ts` | 可选：类型锁补 `transferKind`（既有 `toMatchTypeOf` 不强制） | D1 类型面冻结建议 |
| `packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts` | 构造点 + `transferKind: 0`（实测已改） | §10 矩阵 |
| `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts` | 构造点 + `transferKind: 0`（实测已改） | §10 |
| `packages/ws-replication/test/ws-replication-issue243-real-transport.test.ts` | **零改动必要**（仅类型级 `Extract<…, { kind: 'UPDATE_CHUNK' }>`，无对象字面量构造；保留 ALLOW 许可位——iteration 2 更正，原「构造点 + transferKind: 0」为过宽登记） | §10 矩阵（SA4 N-Obs1） |
| `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts` | 构造点 + `transferKind: 0`（实测已改） | §10 |
| `packages/ws-replication/test/ws-replication-issue244-sa7-dynamic.test.ts` | **零改动必要**（同 issue243-real-transport：仅类型级 Extract） | §10 矩阵（SA4 N-Obs1） |
| `packages/ws-replication/test/ws-replication-issue244-slot-reclaim-regression.test.ts` | **零改动必要**（同上：仅类型级 Extract） | §10 矩阵（SA4 N-Obs1） |
| `packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts` | **零改动必要**（同上：仅类型级 Extract） | §10 矩阵（SA4 N-Obs1） |
| `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts` | 构造点 + `transferKind: 0`（实测已改） | §10 |
| `packages/ws-replication/test/ws-replication-observer-red.test.ts` | `ConnectionSenderHost.limits` 完整 `ResolvedLimits` 字面量 +2 行缺省键（`maxChunkedBootstrapBytes: 4 * 1024 * 1024` / `maxChunkedSyncDiffBytes: 4 * 1024 * 1024`，注释沿 #243/#244「新增字段（缺省值）」惯例）——**编译期必改点（TS2739），非行为改动**：零断言面、两键无 `src/` 行为读者、值 = `DEFAULT_REPLICATION_LIMITS`、该测试不跑构造器校验链（SA4 §4-A 五要素：编译期强制 + 语义惰性 + 值等于缺省 + 最小行数 + 完整登记） | §10 矩阵行（SA4 M1 裁定；D5.1 必填类型面 × §12 根 typecheck 判据的唯一可满足解——iteration 2 补正漏登记） |
| `docs/protocols/instance-replication-v1.md` | §22 L701 措辞收口（保留 D4-1/D4-2 锚） | D10/R37 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | 可选：limits 类型锁字面量补两键（`toMatchTypeOf` 不强制） | D5 类型面冻结建议 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/replication-protocol/test/codec-issue299-ac-red.test.ts`、`packages/ws-replication/test/ws-replication-issue299-ac-red.test.ts`、`packages/ws-replication/test/ws-replication-issue299-api.test-d.ts` | SA6 验收契约 | 转绿判据「不改一行 26/26」；sha256 锁定（SA6 §13） |
| `packages/ws-replication/src/update-transfer.ts`、`update-channel.ts`、`hub-namespace.ts`、`peer-namespace.ts`、`frame-io.ts` | 传输/assembly 层 | D8 切片边界：本切片 kind 无关收发，kind 分派/绑定块核对/按 kind 聚合上限属 §8.1/§9.2 后续切片；改动会越出已批契约范围 |
| `docs/adr/*`（含 0013/0019） | 决策记录 | 本设计是 ADR 0019 的履行非修订；SA8 门禁确认义务-履行关系 |
| `docs/protocols/instance-replication-v1.md` 的 §5/§10.3/§13.2/§17 及其他节 | 规范权威 | HEAD 已是目标契约，实现对齐而非再修订（SA8 §1/R37）；仅 §22 L701 在 ALLOW |
| `CONTEXT.md` | 词汇 | 词条已是 ADR 0019 目标语义（SA8 §1），零新词条 |
| `apps/yjs-server/**` | 组合根消费方 | 类型面零破（Partial）；app config 文件 allowlist 自 #243/#244 起即不含分块族键（config.ts L136–148 实测先例）——扩展 app 配置文件面是家族级 catch-up（见 §13 follow-up），混入本切片 = 无契约覆盖的范围扩张 |
| 错误码注册表 / `SYNC_TRANSFER_EXPIRED` / observer 事件（`packages/replication-protocol/src/registry*`、`observer.ts`、协议 §13.2/§18/§23） | append-only 冻结面 | R36：死码保留、不重复登记、不改语义 |
| `packages/replication-protocol/src/canonical.ts`、envelope/帧层 | 编解码基座 | 单形态只动 payload 字段序，reader/writer 原语（`readVarUint`/`writeVarUint`）已具备；动基座波及全消息域 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 单形态编解码 + golden 改写 | 契约 R1–R6 红（HEAD） | 契约文件不改一行 | R1–R6 绿：kind 0/1/2 向量字段断言 + decode→encode 逐字节往返；golden ≥3 且首字节 ∈ {0,1,2} |
| AC2 kind/绑定块单帧规则 | R7–R10 红 | 同上 | kind=3/127、缺绑定块、绑定块越位（bytes 后/非首 chunk/kind=0 携带）全部 `MALFORMED_FRAME`；每例前置相近正控帧可解码 |
| AC2 编码侧对称 | R14 红 | 同上 + **新增补测 `packages/replication-protocol/test/codec-issue299-encode-symmetry.test.ts`（SA2 F2 授权落点，§11 ALLOW 在列；`codec-malformed.test.ts` 不动）**，冻结断言清单——负控（全部 `MALFORMED_FRAME`，①–⑤ = SA2 F2 钉死五例）：① `transferKind=1 ∧ chunkIndex>0` 携 `replicationId`（+`replicationEpoch`）；② `transferKind=0` 携 `syncRoundId`；③ `transferKind=1 ∧ chunkIndex=0` 缺 `replicationEpoch`（仅携 `replicationId`）；④ `transferKind=3` 经 encode（JS/cast 面）；⑤ `transferKind=2 ∧ chunkIndex=0` 携 `replicationId`（跨族污染，SA2 建议项采纳）；补足 D4 分支完备镜像（⑥–⑧，同文件必测）：⑥ `transferKind=2 ∧ chunkIndex>0` 携 `syncRoundId`；⑦ `transferKind=0` 携 `replicationId` / 携 `replicationEpoch`（与 ② 合成 kind=0「三成员任一存在即拒」完整三分支）；⑧ `transferKind=1 ∧ chunkIndex=0` 缺 `replicationId`（③ 的镜像半例）。**每组前置相近正控可编码**：P1 kind=0 纯五字段 / P2 kind=1 ∧ idx=0 携完整绑定块 / P3 kind=2 ∧ idx=0 携 `syncRoundId` / P4 kind=1 ∧ idx>0 无绑定块 / P5 kind=2 ∧ idx>0 无绑定块（正控同时断言 decode→encode 往返逐字节无损）。不触契约三文件 | encode 侧 iff 严格拒绝（无归一化）八分支全部有执行面；R14 既有四例保持；SA2 F2 验收 =「ALLOW 与 §12 一致；补测文件在仓、断言全绿、不触契约三文件」 |
| 既有 #242 敌意套件判别力保持 | SA2 §8-E4（单形态下敌意 payload 首字节 0x23 全部在 kind 门被偶然拒绝 → 伪绿） | `codec-issue242-ac-red.test.ts` 按 D7 改动 ② 前缀化后全绿；敌意向量缺省携合法 kind=0 前缀 → 字段级规则（非 canonical varUint / 非法 UTF-8 / 超声明 bytes / 单帧自洽 / 尾随）仍被抵达 | 无伪绿：拒绝原因落在被测规则而非 kind 门的偶然拦截（如 `transferIdHex:'8100'` 在 kind 合法前提下仍 `MALFORMED_FRAME`）；全仓回归中 codec-issue242 全绿（SA2 F1 验收） |
| AC2 kind 无关字段限额 | R13 红 | 契约文件 | kind=1/2 bytes 超 maxUpdateBytes → `UPDATE_TOO_LARGE` |
| AC3 两键缺省/键集 | C1 红 | 契约文件 | 缺省各 4 MiB；limits 键集恰 14+2；timeouts 键集不漂移 |
| AC3 两条链② + 等号敏感度 | C2/C3/C4 红 | 契约文件 | 隔离违例（40 MiB）TypeError；族内 product=2MiB 时 =2MiB 接纳 / +1 拒绝；两键联立任一越界 TypeError；非法值（0/1.5/−1）TypeError |
| AC3 非追溯性 + 门宽 | C5 绿（负控，须保持） | 契约文件 | 显式 `maxChunksPerUpdate` 1 → TypeError（经 #244 链②，D6）/ 8 → 接纳；`maxUpdateBytes: 32KiB` 单键 → 接纳；零分块族键存量配置 → 接纳 |
| AC3 control reserve | C6 绿（负控，须保持） | 契约文件 | 违例 TypeError / 边界恰好合法；插件既有键装配 ready |
| AC3 插件配置链 | C7 红 | 契约文件 | 两新键 allowlist 接纳 + ready；40 MiB 经插件 apply → TypeError 且 `requirePeerReplication` unavailable |
| AC3 类型面 | api.test-d 2 红 | 契约文件 | 两键必填 number、可经 Partial 覆盖、机制键名不变 |
| AC4 transferId 语义 | R11/R12 红 | 契约文件 | tid=0 三 kind 一致 `MALFORMED_FRAME`；0xffffffff 三 kind 一致接纳且往返无损 |
| 协商门保持（R34） | N1 绿 | 契约文件 + `codec-issue242-ac-red.test.ts` | 未协商 0x42（含单形态与旧向量）payload 解析前 `UNSUPPORTED_MESSAGE_TYPE`；`codec-issue242` 全绿 |
| 他域不波及 | N3 绿 | 契约文件 + golden/truncation 套件 | UPDATE 0x40 往返不变；21 golden 计数不变；全 truncation 偏移拒绝分类不变 |
| 既有传输层回归 | SA6 §4 基线 45 用例绿 | issue243/244/245/246 传输套件（4 个构造点文件 +`transferKind:0`；4 个仅类型提取文件零改动；observer-red T5 夹具 +2 缺省键零行为影响——SA3 日志 §4 两包 500 用例实测全绿） | 全绿（wire 经 encodeMessage 自动单形态，断言为解码面，不受影响） |
| fuzz/property | 既有 300 轮绿 | D9 扩展后 | 三 kind × 绑定块 presence 组合 encode→decode→字段一致；golden 单字节变异收敛分类不变 |
| 全仓回归 | `artifacts/sa6-issue299-full-suite.log`（HEAD：327 文件 3441 用例绿 + 契约 2 文件红） | 根 `pnpm typecheck` + `pnpm test` | 328 测试文件全绿（327 既有 + 1 新增 `codec-issue299-encode-symmetry.test.ts`；含 26/26 契约）；`Type Errors no errors`。**wire-change 验证门豁免依据（SA2 O2 显式化）**：`packages/replication-protocol/AGENTS.md`「Wire changes require old/new interoperability evidence」由 ADR 0019 同版本部署假设（部署前提，L14–18）+ 旧六字段形态从未发布 + PR #241 OPEN 未合入（SA8 C4 / 设计后复审 §1 三重实测）显式豁免——无新旧互通消费方，互操作证据面为空集；同版本自互通由改写后 golden/契约向量/传输层既有套件承载 |
| 文档一致性 | SA8 R37 + R39 | §22 二分收口后 `codec-issue246-doc-contract.test.ts` + 过期术语扫描 + `git diff --check` | D4-1/D4-2/D6-1 锚全绿（`codec-issue299-ac-red.test.ts` 新指向文件名可解析）；**§22 内零「传输层资产已交付/已存在」语义表述**（SA2 F3 验收）；规范文档零「双形态/CAP_CHUNKED_SYNC」命中；L707 义务句保持 |

## 13. 风险、回滚和残余问题

**风险**：

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | D6 窄门与 SA6 §10/§15.4 散文宽门的偏差被后续评审否决 | 中 | §7 D6 已给完整数学推导（C2/C3 边界族强制窄门）；若裁定宽门，须先修订契约 C2/C3（SA6 自身出口），实现改动 = 两个守卫条件各加一个 `hasOwnProperty`，影响面收敛 |
| 2 | `transferKind` 必填是 `UpdateChunkMsg` 公共类型破坏性演化，遗漏构造点导致编译红 | 低 | 类型系统全程收窄（非运行时发现）；§10 矩阵已穷举仓内全部构造点（两包 src 2 处 + protocol 测试 4 文件 + ws 测试 4 文件，SA4/SA3/本轮 grep 三方一致；iteration 2 更正原「8 ws 测试」过宽计数），另加 observer-red 全量 `ResolvedLimits` 字面量的 +2 行编译期跟随（iteration 2 经 SA4 M1 补入 §10/§11）；无仓外消费方（workspace `*`、包未发布、PR #241 未合入） |
| 3 | kind≠0 帧进入 live-update assembly（接收层不消费 kind）被误读为本切片缺陷 | 低 | D8 不可达性论证（同版本部署）+ SA6 §12 范围边界原文；设计显式登记而非静默 |
| 4 | golden/向量改写遗漏某个六字段字面量副本（多文件复制向量；`codec-issue242` 敌意 helper 无前缀 → 伪绿） | 低 | R6 对 fixtures 全量过滤断言兜底；`codec-issue242` 三处改动（D7 ①②③）+ `PINNED_FRAME_HEX` 头部长度同步已逐项列入 §11 ALLOW 预期改动；判别性由缺省 kind 前缀存在保证（§12 判别力保持行）；truncation/malformed 经审计无六字段字面量 |
| 5 | encode 侧绑定块值域校验被过度实现（抢占 §8.1/§9.2） | 低 | D4 显式列出校验集边界（结构性 + 可编码性 only）；补测只断言结构拒绝 |
| 6 | §22 收口措辞越界声称传输层资产已交付（SA8 R39 / SA2 F3） | 低 | D10 二分模板钉死（codec 向量支 vs 传输层资产支）；§12 文档一致性行验收判据 =「§22 内零传输层资产已存在表述」；doc-contract D4/D6 锚 + L707 义务句保持 |

**回滚**：单分支整体 revert 即恢复六字段 HEAD（旧形态无部署存量、无持久化数据、无 wire 兼容面——ADR 0019 前提）；配置键回滚无数据迁移。

**任务内解决项**：无遗留必要条件（设计可直接实施）。

**残余 / follow-up（非本切片）**：

1. #295 后续切片：kind=1/2 发送端（含绑定块数据流与共用 `nextTransferId` 计数器）、接收端 kind 分派与按 kind 聚合上限执行、绑定块内容核对三码、assembly kind 无关收口、head-of-line 发送端（§8.1/§9.2）。
2. `apps/yjs-server` 配置文件 allowlist 的分块族 catch-up（`maxChunkedUpdateBytes`/`maxChunksPerUpdate`/`maxConcurrentAssembliesPerConnection`/`assemblyTimeoutMs`/两新键/controlReserve 映射）——家族级任务，先例自 #243 起滞后。
3. §22 L701 收口后，`docs/agents` 域文档如引用「golden vectors 待交付」措辞的同步检查（R37 过期术语扫描覆盖）。

## 14. 评审修订映射

### 14.1 SA2 设计评审（iteration 1 修订输入；已全部落实）

评审输入 = `wiki/raw/task_issue-299_sa2_review.md`（iteration 0，verdict reject：0 BLOCKER / 3 MAJOR；核心 D1–D9 全部成立）。逐条落实：

| Finding | 严重度 | 要求（SA2 §13） | 修订位置 | 处理结果 |
|---|---|---|---|---|
| **F1** `codec-issue242-ac-red.test.ts` 改写清单不完整（伪绿 + 必红破面） | MAJOR | 声明三处改动：① `hostilePayload` 缺省 `'00'` kind 前缀（+`kindHex` 覆盖键）；② L225–232 字段序锁定断言改写为 kind→ns→… 全序；③ 注释/用例标题同步；明确「不引入 kind≠0 变量」仅指向量语义 | §7 D7（改动 ①②③ 完整声明 + `PINNED_FRAME_HEX` 头部 payloadLength 机械跟随 `2d→2e`/`32→33`/`3a→3b`——SA2 未列但同属必红面，已并入改动 ①）；§10 矩阵行；§11 ALLOW 条目；§12 新增「判别力保持」行；§13 风险 4 缓解 | **已落实**（含 SA2 F1 验收判据：实现后 codec-issue242 全绿且敌意向量抵达字段级规则） |
| **F2** encode 侧补测无 ALLOW 落点 | MAJOR | §11 ALLOW 增补 `codec-issue299-encode-symmetry.test.ts`（或改列 codec-malformed 并撤「不变」行）；断言清单在 §12 钉死（五例 + 跨族污染建议项），每组前置相近正控 | §11 ALLOW 新增条目（取新文件方案，`codec-malformed.test.ts` 维持零改动声明）；§12 AC2 编码侧对称行冻结清单（负控 ①–⑧：SA2 钉死 ①–⑤ + 设计补足 D4 分支镜像 ⑥–⑧；正控 P1–P5）；§10 新增矩阵行 | **已落实**（SA2 F2 验收判据：ALLOW 与 §12 一致；补测文件在仓、断言全绿、不触契约三文件） |
| **F3** §22 收口措辞声称未实现的传输层资产 | MAJOR | D10 收口措辞二分：codec 向量「已交付」+ 指向 `codec-issue299-ac-red.test.ts` 冻结向量与改写后 golden；传输层资产维持「由 §8.1/§9.2 后续切片交付」待交付表述；D4-1/D4-2 锚与 L707 义务保持 | §7 D10（二分改写 + 保持项 + 验收判据）；§6 R37 行（吸收 R39 精度约束）；§12 文档一致性行；§13 新增风险 6 | **已落实**（SA2 F3 验收判据：§22 零「传输层资产已存在」表述；doc-contract D4-1/D4-2/D6-1 全绿；过期术语扫描零命中） |
| O1 D3 收敛路径叙述误差（`KIND2_BINDING_ON_LATER` 实为 bytes 长度声明处欠载） | 非阻塞 | 顺手更正机制叙述 | §7 D3 步 4（五向量逐条精确收敛路径；尾随检查仅 `KIND1_BINDING_ON_LATER`/`KIND0_BINDING_BYTES`） | **已顺带落实** |
| O2 wire-change 验证门豁免依据显式化 | 非阻塞 | §12 全仓回归行显式引用豁免依据 | §12 全仓回归行（ADR 0019 同版本部署假设 + PR #241 OPEN 实测） | **已顺带落实** |
| O3 正向确认清单（矩阵重合 / `toMatchTypeOf` 容忍 / fuzz 自动覆盖 等） | 非阻塞 | 供 SA4 参考，无需修订 | 无需修订（设计声明维持） | 无动作 |
| O4 D6 残余语义登记被确认（已批语义非缺口） | 非阻塞 | 无需修订 | §7 D6 上游矛盾记录段维持原样 | 无动作 |

**激活门处置（dispatch 点名「preserve the accepted conflict-gate interpretation」）**：D6 窄门裁决**原样保留、零改动**——SA2 §15 独立三层复核（协议 §17 字面 / 契约 C2/C3 数学 / R35 实质关切经 #244 链②承载）维持窄门为唯一一致读法，与 SA8 R38 裁决一致；宽门读法须走 SA8 §2.4 出口的三层同步修订（协议 §17 L615 + 契约 C2/C3 + SA6 契约自身出口），本设计不采纳。

### 14.2 SA4 实现静态审查（iteration 2 修订输入；本版逐条落实）

评审输入 = `wiki/raw/task_issue-299_sa4_review.md`（iteration 0，verdict **approve：0 BLOCKER / 0 MAJOR / 1 MINOR**；实现零改动要求，唯一修订对象 = 本设计台账）。逐条落实：

| Finding | 严重度 | 要求（SA4 §10 / §12） | 修订位置 | 处理结果 |
|---|---|---|---|---|
| **M1** `ws-replication-observer-red.test.ts` +2 行落在 ALLOW 台账之外——设计 §10/§11 矩阵登记缺陷（「D5.1 必填类型面 × §12 根 typecheck 零错误 × 该文件零改动」三者不相容）；实现本身正确、必要、最小（SA4 §4-A 五要素静态证明：编译期强制 + 语义惰性 + 值等于缺省 + 最小行数 + 完整登记） | MINOR（路由 design） | 设计文档补正：① §11 ALLOW 增 `packages/ws-replication/test/ws-replication-observer-red.test.ts` 一行（预期改动 = `ConnectionSenderHost.limits` 字面量 +2 行缺省键）；② §10 对应矩阵行由「零改动」更正为「+2 行编译期必改」；实现零改动。验收 = 台账与实际 diff 一致，后续 SA 审计不再出现 ALLOW 外条目 | ① §11 ALLOW 新增 observer-red 条目（含五要素正确性依据与必改点证明链锚点）；② §10 矩阵 observer-red 独立成行（「+2 行编译期必改」+ TS2739 必红证据 + 链②合法 + 零断言面论证） | **已落实**（本轮 `git diff --stat` 复核 = 恰 +2 行，与台账逐字一致；锚点 `types.ts` L53/L57/L882、`backpressure.ts` L44、`defaults.ts` L33–L34 本轮全部实测在位） |
| N-Obs1 §10 矩阵双向失准（4 文件多列「+transferKind: 0」、observer-red 漏列 +2 行） | 非阻塞（M1 顺带修正建议） | 同步更正多列侧，使矩阵与 grep 事实一致（构造点 = 两包 src 2 + protocol 测试 4 + ws 测试 4） | §10 矩阵拆分为「4 构造点文件 + `transferKind: 0`」与「4 仅类型提取文件零改动」两行（含各文件 `Extract<…>` 行号锚点）；§11 ALLOW 对应 4 行预期改动更正为「零改动必要（保留许可位）」；§12 传输回归行、§13 风险 2 缓解同步一致性更正 | **已顺带落实**（本轮 grep 复核：4 文件均为 `type ChunkMsg = Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>`，无对象字面量构造） |
| N-Obs2 SA3 采纳 O5/O6 已落地 | 观察项 | 无需设计动作 | — | 无动作 |
| N-Obs3 fuzz 缺失侧断言由 encode-symmetry P4/P5 `toBeUndefined()` 承载，组合覆盖完整 | 观察项 | 无需补测 | §12 fuzz 行维持 | 无动作 |
| N-Obs4 SA6 §10 对 observer-red 的描述（「构造 0x42 的夹具」）与事实不符（仅类型夹具） | 上游文档精度（已被 SA4 §4-A 事实链替代） | 无需行动 | §10 矩阵 observer-red 行以实测证据（L799–811 字面量）描述该文件，不再沿用 SA6 措辞 | 无动作 |
| N-Obs5 wire-change 互通证据门豁免依据自洽（ADR 0019 同版本假设 + 旧形态未发布 + PR #241 OPEN） | 观察项 | 无需行动 | §12 全仓回归行豁免依据维持 | 无动作 |

**范围纪律（M1 边界条件回写）**：本 ALLOW 补行仅覆盖 SA4 §4-A 裁定的五要素机械跟随（编译期强制 + 语义惰性 + 值等于缺省 + 最小行数 + 完整登记）——任何带断言/行为语义或非强制的 ALLOW 外改动仍按 MAJOR 处置；本条目不是后续切片扩权的先例。D1–D10 设计决策、SA6 契约三文件（sha256 锁定）、DENY 全清单零改动。

## 15. 是否需要设计后 ADR 冲突复查及理由

**iteration 0（首版）曾提交 `requiresConflictRecheck: true`**（四判据：公共 API 类型变化 / wire 行为变化 / SA6 文档矛盾裁决 / 无新增生命周期面）——**复查已执行且 clear**：SA8 设计后复审（dispatch sa-75f9d7c2-b601-4663-8c49-8c8e4299e214，`artifacts/sa8-conflict-gate-issue-299-design-recheck.md`）：0 阻塞冲突，四个聚焦面（公共 API 类型、0x42 字段序、绑定块规则、激活门歧义）逐条无冲突；D6 窄门经「协议 §17 L615 字面（『对应…生效』+ 无『或』子句）→ 契约 C2/C3 边界族数学强制 → C5a 经 #244 链②承载」三层核实为唯一一致读法（R38）；R32（issue 标题文本，正文为准）/ R39（§22 收口精度）/ R40（必填成员实现期核对）/ R41（接收面中间态登记）为非阻塞接续项，均已被本版吸收（R39 → D10 二分）。

**iteration 1：`requiresConflictRecheck = false`**。理由：

1. F1–F3（+O1/O2）全部为设计完备性/一致性修订——F1 是既有 ALLOW 条目的改写面补全（测试资产文件内部，零生产面）、F2 是新测试文件的授权落点（零生产面变化）、F3 在 R37/R39 既有文档义务框架内**收窄**措辞（不新增声称），均不产生新的 ADR/协议冲突面——与 SA2 §15 复核结论一致（「F1–F3 修订完成后无需重开冲突检查，SA1 修订迭代可直接进入再评审」）。
2. **D6 窄门裁决原样保留**（dispatch 点名保持已接受的冲突门禁解释）：SA2 §15 独立三层复核维持 + SA8 R38 裁决一致；本修订未触碰该裁决的任何推导前提。
3. 不涉及：新增生命周期所有权、新失败语义、修订既有 ADR（零 ADR 修订、零错误码新增维持）。

**iteration 2（本修订，SA4 M1 台账补正）：`requiresConflictRecheck = false`**。理由：

1. 本修订是**纯设计台账一致性补正**：§11 ALLOW 增一行测试夹具文件（`ws-replication-observer-red.test.ts` +2 行缺省键）、§10 矩阵行更正（「零改动」→「+2 行编译期必改」）+ N-Obs1 过宽侧收窄（4 文件改记「零改动必要」）及 §12/§13 对应文本对齐——零生产代码设计变化、零 wire/协议/schema/持久化/状态机语义变化、零新错误码/observer 事件/生命周期所有权。
2. 被补正的实现改动本身（测试夹具 `ResolvedLimits` 字面量 +2 缺省键）经 SA4 §4-A 静态证明为**已批准设计自身判据的唯一可满足解**（D5.1 必填类型面 × §12 根 typecheck 零错误的编译期必改点），非新设计决策、不触碰任何 ADR 冻结面或 SA8 R32–R41 约束（R36 冻结面、R34 协商门、DENY 全清单零关联）。
3. 不涉及公共 API 变化（类型面 D1/D5 已由 iteration 0/1 覆盖并经 SA8 设计后复审 clear + SA4 实现审查 approve）；本修订只使登记与既有事实一致，不引入任何待裁决冲突。

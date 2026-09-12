# SA6 诊断与验收契约 — issue #299（feat：#295 切片 1：0x42 kind 首字段单形态 codec + 聚合上限配置链）

- **dispatch**: sa-9b7c7ad4-62e1-4d61-94f1-5ca7cb2dbe0d（mabf-sa6 / acceptance-contract / iteration 0）
- **任务类型**: **Feature**（能力缺口证明 + 目标行为验收契约）。非 Bug：ADR 0022 显式声明旧六字段形态「从未发布、无兼容负担」（SA8 C4 前提经实测复核成立），HEAD 六字段行为是**预期的现状**而非缺陷。
- **HEAD**: `eb380d7aed296c15accf8832a45a96b630f0c8ce`（分支 `mabf/issue-299`；工作树诊断前仅含未跟踪 `wiki/raw/task_issue-299.md` 与 `artifacts/sa8-conflict-gate-issue-299.md`）
- **裁决**: **approve** — 能力缺口稳定复现并定位到源码与 wire 字节；契约 21 条红灯断言在 HEAD 100% 确定性失败（3 次重复）、5 条负控在 HEAD 绿；失败原因唯一指向缺失的 kind 首字段/新配置键，非环境或 fixture 错误。

## 1. 任务类型与输入

| 输入 | 路径 | 状态 |
|---|---|---|
| Host 任务简报 | `wiki/raw/task_issue-299.md` | 在库（正文 + AC1–AC4；comments 段为空） |
| SA8 前置冲突门禁 | `artifacts/sa8-conflict-gate-issue-299.md` | 在库（裁决 clear，R32–R37 就绪注意项） |
| relevant_decisions | `wiki/raw/task_issue-299_relevant_decisions.md` | **不存在**（未产出）；以 ADR 0022/0013/0010、协议 §5/§10.3/§17/§22、CONTEXT.md 直接为规范依据 |
| conflict_report | `wiki/raw/task_issue-299_conflict_report.md` | **不存在**；冲突面以 SA8 门禁报告为准（dispatch 指定） |
| Owner 补充要求 | issue comments（REST） | **无**（SA8 实测 `[]`，dispatch 声明一致）→ §2 无映射项 |

规范基线（wire 值唯一权威 = 协议文档；配置语义理据权威 = ADR 0022）：

- `docs/adr/0022-chunked-sync-transfer.md`（消息形态、round/epoch 绑定、资源上限与配置链、明确拒绝的备选方案 #1/#4/#7）
- `docs/protocols/instance-replication-v1.md`：§5 L116（单形态恒用 + v1 代际否定）、§10.3 L307–345（字段表 + 单形态 + codec 级单帧规则 + 协商门）、§13.2 L448–452、§17 L578–615（配置表 / 启动校验块 / 非追溯性纪律 / control reserve 原样保留）、§22 L701（golden vectors 由实现票交付）
- `CONTEXT.md` L154–171（分块复制传输 / UPDATE_CHUNK / 同版本部署假设 / 实现代际）

## 2. Owner comment 映射

无。issue REST comments 返回空（SA8 §0 与本次 dispatch 声明一致），故验收目标 = issue body 的 What to build + AC1–AC4 + SA8 门禁裁决。

## 3. SA8 约束吸收

| SA8 项 | 本契约落地方式 |
|---|---|
| R32 标题「CAP_CHUNKED_SYNC 协商 / 双形态」废弃，正文为准 | 契约全程单形态恒用；无协商、无 gating、无双形态断言；负控 N1 反向锁定「解码侧协商门仍在」（不得把「无协商」误读为移除 0x42 门控） |
| R33 codec 无状态边界（AC4 落地方式） | codec 级只断言 transferId 字段语义（≥1、uint32、三 kind 一致）；连接域计数器属发送端状态，契约报告 §12/§15 显式移交（不写入 codec 状态） |
| R34 「无 capability 协商」作用域收窄到 sync 段 | 负控 N1 逐帧断言未协商 0x42 在 payload 解析前 `UNSUPPORTED_MESSAGE_TYPE`（含单形态 kind=1 向量），旧资产 `codec-issue242-ac-red.test.ts` 保持绿 |
| R35 链②触发键作用域须精确落地 | 负控 C5 锁定门宽：显式 `maxChunksPerUpdate`（#244/#295 共享操作数键）仍必须激活链；非追溯性仅覆盖「零分块族键」存量配置（含数学上会使缺省 envelope 越界的 `maxUpdateBytes=32KiB` 反例） |
| R36 append-only 冻结面不动 | 契约零断言 4 新错误码 / RESYNC reason / observer 事件；只使用既有 `MALFORMED_FRAME` / `UPDATE_TOO_LARGE` / `UNSUPPORTED_MESSAGE_TYPE` / `CONNECTION_POLICY_VIOLATION` |
| R37 文档同步义务 | 报告 §10 记录落地后须收口 §22 L701 措辞（golden vectors 已交付）；契约不新增文档断言 |

## 4. 环境与基线

- 运行时：node `v24.13.0`、pnpm `10.28.2`、vitest `3.2.7`、typescript `5.9.3`。
- 依赖安装：`pnpm install --offline --frozen-lockfile`（16 workspace projects / 65 包 / 481ms，零网络）——离线 store 命中。
- 基线（HEAD，未含本契约文件时 / 本契约文件为纯增量）：

| 范围 | 结果 | 证据 |
|---|---|---|
| `packages/replication-protocol/test`（12 文件） | 既有 11 文件 194 用例全绿；本契约文件 14 红 | `artifacts/sa6-issue299-existing-suites.log`、`artifacts/sa6-issue299-red-detail.log` |
| `ws-replication-issue244-ac-red` + `ws-replication-plugin` + `ws-replication-issue243-chunked-live`（45 用例） | 45 passed | `artifacts/sa6-issue299-existing-suites.log` |
| `ws-replication-issue299-ac-red`（本契约） | 5 红 / 2 绿（负控） | `artifacts/sa6-issue299-red-evidence.log` |
| `ws-replication-issue299-api.test-d.ts`（类型面） | 5 处 TS 缺失键错误 | `artifacts/sa6-issue299-red-detail.log` |
| 全仓 `pnpm test`（327 文件 / 3460 用例，614.68s） | 仅本契约 2 条运行时文件红（19 用例）；其余 325 文件 / 3441 用例全绿；`Type Errors no errors` | `artifacts/sa6-issue299-full-suite.log` |

工作树仅新增契约文件（无生产改动、无 fixture 改动）。

## 5. 正向复现（能力缺口）

**Codec**：以规范 §10.3 字段表逐字节构造 kind 首字段向量，`decodeMessage(..., {selectedCapabilities: CAP_CHUNKED_UPDATE})` 在 HEAD 一律失败：

```text
KIND0_FIRST = 00 23<NS> 01 00 03 d804 03 0a0b0c
             → HEAD: ProtocolError MALFORMED_FRAME: invalid namespaceId
KIND1_FIRST = 01 23<NS> 01 00 03 d804 20<RID> 01 03 0a0b0c   （绑定块 replicationId+epoch）
KIND2_FIRST = 02 23<NS> 09 00 02 e807 05 04 deadbeef          （绑定块 syncRoundId）
```

**配置链**：HEAD `DEFAULT_REPLICATION_LIMITS` 仅 14 键（无两新键）；两新键的显式越界申报被静默接纳：

```text
createHubReplication({limits:{maxChunkedBootstrapBytes: 40MiB}})  → ACCEPTED（静默；应为 TypeError）
createHubReplication({limits:{maxChunkedSyncDiffBytes: 40MiB}})   → ACCEPTED（静默）
createHubReplication({limits:{maxChunkedBootstrapBytes: 0}})      → ACCEPTED（静默）
createHubReplicationPlugin({limits:{maxChunkedBootstrapBytes:…}}) → TypeError: hub replication limits: invalid configuration
```

复现率：3/3 运行、21/21 红灯用例全失败（§7）。

## 6. 负控（形态无关，HEAD 绿且实现后必须保持绿）

| 负控 | 断言 | HEAD |
|---|---|---|
| N1 | 未协商 `CAP_CHUNKED_UPDATE` 的 0x42（含单形态向量与旧向量）→ payload 解析前 `UNSUPPORTED_MESSAGE_TYPE` | 绿 |
| N2 | `selectedCapabilities` 非法值（-1 / 1.5）急切 `CONNECTION_POLICY_VIOLATION` | 绿 |
| N3 | UPDATE 0x40 golden 逐字节往返（改写不波及它域） | 绿 |
| C5 | 非追溯性 + 门宽（显式 `maxChunksPerUpdate` 仍激活链；零分块族键配置不误判） | 绿 |
| C6 | control reserve 校验原样保留（`maxQueuedControlBytes ≥ maxBootstrapBytes+128` 违例/边界）+ 既有键插件装配路径可用 | 绿 |

负控价值：N1/N2 证明失败不是 decode 入口或选项校验损坏；N3/C5/C6 证明失败不是环境/装配桩损坏，且红精确落在「缺失的新形态/新键」上。C6 同时预验证了 C7 使用的 `Context`/`provideInstance`/`provideClock`/`provideNomicoreRegistry`/`apply` 装配桩在 HEAD 可用（避免「实现后才发现桩错误」）。

## 7. 稳定性、规模与时序

- 契约 3 次重复运行结果完全一致：`21 failed | 5 passed (26)` + `Type Errors 2 failed`（`artifacts/sa6-issue299-red-evidence.log`）。
- 零 real sleep、零 timer、零并发：全部为纯算术向量 + 构造期同步校验，无时序/规模依赖；不存在竞态面。
- 失败分类明细（单次运行）：12 × `ProtocolError MALFORMED_FRAME: invalid namespaceId`（codec 正控/往返）、1 × 旧形态未拒绝、1 × golden fixture 首字节 0x23、5 × 配置断言（缺省缺失/链缺失/allowlist）、2 × 类型面缺失键（`artifacts/sa6-issue299-red-detail.log`）。

## 8. 根因链 / 能力缺口

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 1 | 目标契约冻结：0x42 payload = `kind varUint` 首字段 + 五字段序 + 首 chunk 绑定块；`kind ∈ {0,1,2}`；违者 `MALFORMED_FRAME` | ADR 0022「消息形态」；§5 L116；§10.3 L307–323；CONTEXT.md L157 | 高 |
| 2 | HEAD codec 为 ADR 0013 六字段形态：`namespaceId → transferId → chunkIndex → chunkCount → totalBytes → bytes`，无 kind、无绑定块 | `packages/replication-protocol/src/payloads.ts` L651–690（注释 + `decodeUpdateChunk` L663 / `encodeUpdateChunk` L693） | 高 |
| 3 | 直接故障点：kind 首字节被当作 `namespaceId` varString 长度（0x00 → 空串 / 0x01 → 1 字节串）→ `invalid namespaceId` → `MALFORMED_FRAME` | probe A：`00`+旧 payload 与 `01`+旧 payload 均 `MALFORMED_FRAME: invalid namespaceId` | 高 |
| 4 | 触发条件：只要对端按单形态发送 0x42（kind=0/1/2 任一、任意 chunk），HEAD 解码必然失败；bindings 无法表达 | R1–R4、R12 红；probe A | 高 |
| 5 | 配置缺口：`DEFAULT_REPLICATION_LIMITS` 14 键无两新键；`validateLimits` 无新键值门；`validateChunkedTransferChain` 无两条新链②；插件 `LIMIT_KEYS` 无两新键 | `defaults.ts` L16–32；`validate.ts` L140–231；`plugin.ts` L154 | 高 |
| 6 | 后果：显式越界/非法新键静默接纳（启动期不响亮）；插件配置面把新键判为 `invalid configuration`（配置链断裂） | probe B；C1–C4/C7 红 | 高 |
| 7 | 非根因（排除）：不是解码器损坏、不是协商门失效、不是既有链机制失效——三者经负控/对照均正常 | probe A/B；N1–N3/C5–C6 绿 | 高 |
| 8 | 放大因素：缺 kind 后三个 kind 全部不可表达；缺少绑定块字段后 kind=1/2 的首 chunk 无法自描述，后续 §8.1/§9.2 切片全部阻塞 | §5/§10.3/§8.1/§9.2；issue #299「一切后续切片的地基」 | 高 |

## 9. 因果实验（最小对照）

**probe A（codec，单变量）**——同一 payload 仅前缀一个 kind 字节：

```text
旧六字段形态            : OK kind=UPDATE_CHUNK transferId=1 chunkIndex=0 chunkCount=3 totalBytes=600
同一 payload 前缀 0x00  : REJECT MALFORMED_FRAME: invalid namespaceId
同一 payload 前缀 0x01  : REJECT MALFORMED_FRAME: invalid namespaceId
仓内 3 条 golden 首字节 = 0x23（= NS varString 长度 35）
```

→ 解析器、fixture、字段值全部健全；失败的**唯一变量**是缺 kind 首字段与绑定块。旧形态首字节 0x23 与合法 kind 集合 {0,1,2} 不相交 → 「旧形态作废」在单形态下自动成立（R5 的判据）。

**probe B（配置链，对照）**——同一构造入口：

```text
#244 链①（maxChunkedUpdateBytes=6MiB > maxQueuedUpdateBytes 4MiB） : TypeError（响亮）
#244 链②（maxChunksPerUpdate=1 → 4MiB > 512KiB）                    : TypeError（响亮）
#295 bootstrap 链②（maxChunkedBootstrapBytes=40MiB > 32MiB）        : ACCEPTED（静默）
#295 sync 链②（maxChunkedSyncDiffBytes=40MiB > 32MiB）              : ACCEPTED（静默）
#295 新键非法值（maxChunkedBootstrapBytes=0）                        : ACCEPTED（静默）
DEFAULT_REPLICATION_LIMITS 键面 = 14 键（无两新键）
```

→ 链机制与触发门本身健全（#244 两链响亮），缺口精确落在 #295 两新键、两链②与插件 allowlist。

**断言敏感度反证（写入契约，非临时）**：

- 边界等号族：product = 4 × 512 KiB = 2 MiB 时，`bootstrap = 2 MiB` 必须**接纳**、`2 MiB + 1` 必须**拒绝**——判据若写成 `<`、上界若写错 product、链若缺失，二者必有一个失败。
- 编码侧对称（R14）：decode 产物被改写为违例字段（transferId=0 / chunkIndex=chunkCount / 空 bytes）后 encode 必须 `MALFORMED_FRAME`——锁定「先验证后写」的 R9 对称纪律。
- R6 fixture 断言：golden 首字节必须 ∈ {0,1,2} 且往返无损——若实现只改 codec 而不改写 golden（AC1 的显式要求），R6 直接失败。
- 负控反例设计：C5(c) 使用数学上会让缺省 envelope 越界、但**零分块族键**的存量配置（`maxUpdateBytes=32KiB`）——若实现把两条新链无条件化（误判非追溯性），C5 立即红。

## 10. 影响面

**生产面（实现票的落点，不在 SA6 权限内）**：

- `packages/replication-protocol/src/payloads.ts`（`decodeUpdateChunk` L663 / `encodeUpdateChunk` L693 字段序 + 绑定块 + 单帧规则；`encodePayload`/`decodePayload` 分发不变）
- `packages/replication-protocol/src/messages.ts` L235（`UpdateChunkMsg` 增 wire kind 与绑定块成员；判别键 `kind:'UPDATE_CHUNK'` 保持不变 → kind 字段命名属 SA1 设计面）
- `packages/ws-replication/src/types.ts` L23–49（`ReplicationLimits` 增两必填 readonly number）、`defaults.ts` L16–32（`DEFAULT_REPLICATION_LIMITS` 两缺省 4 MiB）、`validate.ts` L140–231（值门 + 两条链②）、`plugin.ts` L154（`LIMIT_KEYS` 严格 allowlist）、`hub-connection.ts` L195–206 / `peer-connection.ts` L109–120（链②激活门 = 新键 ∨ `maxChunksPerUpdate`）
- 既有发送/接收调用点（`update-channel.ts`、`update-transfer.ts`、`hub-namespace.ts`、`peer-namespace.ts`、`frame-io.ts`）随类型演化对齐

**测试/资产改写面（AC1 与 SA8 R36/R37）**：

- `packages/replication-protocol/test/fixtures.ts` L361–387（3 条 UPDATE_CHUNK golden 改写为单形态；`UPDATE_CHUNK` fixture interface 同步）
- `codec-messages-golden.test.ts`、`codec-issue242-ac-red.test.ts`（其自带六字段向量）、`codec-roundtrip-truncation.test.ts`、`codec-malformed.test.ts`、`codec-fuzz-property.test.ts`、`codec-api.test-d.ts` L44–61（`toMatchTypeOf` 为「额外字段可容忍」，加 kind 字段不破）
- `packages/ws-replication/test/ws-replication-issue243-*.test.ts`、`issue244-*.test.ts`、`issue245-ac-red.test.ts`、`issue246-interop-matrix.test.ts`、`observer-red.test.ts`（构造 0x42 的夹具）
- 文档义务：协议 §22 L701「golden vectors 由实现 ticket 交付，本规范不预设其存在」落地后收口；`codec-issue246-doc-contract.test.ts` D5-5 的六字段序检查已容忍前置 kind 行（HEAD 绿）。

## 11. 已排除假设

| 假设 | 排除依据 |
|---|---|
| 环境/依赖损坏导致红 | 同包 194 用例、ws-replication 45 用例全绿；契约 5 条负控同文件同入口绿 |
| fixture/golden 向量写错（伪红） | probe A 用 HEAD 自证旧向量解码出预期字段值；新向量由规范字段表纯算术构造并与 ADR 0022 示例序逐字核对 |
| 旧六字段形态需保留（兼容） | ADR 0022 明确单形态恒用 + 旧形态从未发布（PR #241 OPEN、分支 codec 现状六字段，SA8 §3 实测）；协议 §5/§10.3 已冻结单形态 |
| 该切片刻意移除 0x42 协商门 | 协议 §10.3 L345 + ADR 0022 非目标 #5 + SA8 R34；负控 N1 锁定 |
| codec 应承载 transferId 计数器/跨帧状态（AC4 误读） | CONTEXT.md UPDATE_CHUNK「codec 只做单帧无状态编解码」+ SA8 R33；契约只锁字段语义 |
| 新键需要链①（≤ maxQueuedUpdateBytes） | §17 L602–603 与 ADR 0022 配置表只登记链②；契约边界族刻意同时满足「只链②」与「链②+链①式读法」，不预先裁决未登记约束 |
| `assemblyTimeoutMs` 应迁到 limits 容器 | AC3「键名不变」；C1 断言 timeouts 键集与缺省不动 |
| 红是 pytest/vitest 入口或路径问题 | 三条契约文件均由仓库 `vitest.config.ts` 默认 include 收集执行（§14） |

## 12. 验收契约与测试路径

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `packages/replication-protocol/test/codec-issue299-ac-red.test.ts` | R1–R14（14 红）+ N1–N3（3 绿） | AC1（单形态 + 绑定块 + golden 改写）、AC2（kind/绑定块规则 + 编码侧对称）、AC4（transferId 三 kind 一致） |
| `packages/ws-replication/test/ws-replication-issue299-ac-red.test.ts` | C1–C4、C7（5 红）+ C5–C6（2 绿） | AC3（两键缺省、两条链②、非法值、control reserve 保留、非追溯性、插件配置链） |
| `packages/ws-replication/test/ws-replication-issue299-api.test-d.ts` | 2（类型面红） | AC3 的公共类型面：两键为必填 number、可经 `Partial<ReplicationLimits>` 覆盖 |

契约设计要点：

1. **wire 面锁定、TS 命名不锁定**：codec 断言只用既有公开字段 + `decode→encode` 逐字节往返 + 规范算术 golden，不假设 wire kind/绑定块的 TS 字段名（`UpdateChunkMsg.kind` 已是判别键，命名属 SA1 设计面）。
2. **每条单帧规则带相近正控**：R7–R14 先断言同 kind 合法帧可单形态解码，再断言违例分类——拒绝不可能是旧解析器误判的偶然结果。
3. **AC4 边界**：codec 层锁定 `transferId ≥ 1`、uint32 上界三 kind 一致、同一字段位；发送端 (连接,方向,namespace) 共用计数器「从 1 严格递增不回绕」是发送端状态（SA8 R33），在 kind=1/2 发送端落地的后续切片执行，本契约仅作为设计约束登记（§15）。
4. **chain ② 上界含等号**：边界族 `{maxChunksPerUpdate:4, maxChunkedUpdateBytes:1MiB, maxQueuedUpdateBytes:2MiB}` 令 product = 2 MiB；`bootstrap/sync = 2 MiB` 接纳、`2 MiB + 1` 拒绝。
5. **链激活门（R35）**：显式 `maxChunksPerUpdate` 必须仍激活链（保留 HEAD 门宽，不得窄化为「只认新键」）；零分块族键的存量配置（含 `maxUpdateBytes=32KiB` 反例）不得误判。
6. **配置链含插件 allowlist**：hub/peer 插件 `limits` 显式两新键不得被 `LIMIT_KEYS` 拒绝；链②违例经插件 `apply` 路径响亮 `TypeError` 且服务不注册。

契约显式不覆盖（范围边界）：4 新错误码/RESYNC reason/observer 事件的发射（§8.1/§9.2/§23 后续切片，SA8 R36）；绑定块**内容**核对与不符码（`REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH`/`SYNC_STATE_VIOLATION`）；assembly 状态机与 kind 无关收口；head-of-line 发送端切片与记账。

## 13. 红/绿与基线证据

| 证据 | 路径 |
|---|---|
| 契约红证据 + 3 次稳定性 | `artifacts/sa6-issue299-red-evidence.log`（21 failed / 5 passed / 2 type errors ×3 一致） |
| 失败原因明细 | `artifacts/sa6-issue299-red-detail.log` |
| 既有套件基线（protocol 194 绿；ws-replication 45 绿） | `artifacts/sa6-issue299-existing-suites.log` |
| 因果实验 probe A/B/C | `artifacts/sa6-issue299-probe.log` |
| 全仓 `pnpm test` | `artifacts/sa6-issue299-full-suite.log`（2 failed | 325 passed；19 failed | 3441 passed；Type Errors no errors；仅本契约 2 条运行时文件红） |

契约文件 sha256（红证据对应的精确版本）：

```text
3168f11c135a3840f8beffd4f432f7feb344d17d82aa347a424add362fbbbf0c  packages/replication-protocol/test/codec-issue299-ac-red.test.ts
56a2337bed6af8340ede7e445d256ef745f6e47b721b4ed0ddac15cfe2516793  packages/ws-replication/test/ws-replication-issue299-ac-red.test.ts
171104c28be3f77449f864daec0aabecaf5c6d2ff1c2003b60d3abe5ae5a0fe8  packages/ws-replication/test/ws-replication-issue299-api.test-d.ts
```

红证据摘要（HEAD）：

```text
R1–R14 (codec) : 14 failed — 12× MALFORMED_FRAME: invalid namespaceId（单形态向量被旧解析器误读）
                            + R5 旧六字段未被拒绝 + R6 golden 首字节 0x23
C1–C4, C7      :  5 failed — 缺省缺失 / 链②静默接纳 / allowlist 'invalid configuration'
api.test-d.ts  :  2 failed — 5 处 TS2339/TS2561（两键不在 ReplicationLimits）
N1–N3, C5–C6   :  5 passed（负控）
```

转绿判据：实现落地后上述三条契约文件**不改一行**即应为 26/26 通过（含 5 负控与 2 类型面），且既有套件保持绿。

## 14. Runner 触发证据

- `vitest.config.ts`：`test.include = ['packages/*/test/**/*.test.ts', ...]` → 两 `.test.ts` 契约文件被默认收集；`typecheck.include = ['packages/*/test/**/*.test-d.ts', ...]` → `.test-d.ts` 类型面被收集。
- 命中清单实证：`npx vitest run packages/replication-protocol/test` 报告 `Test Files 1 failed | 11 passed (12)`（本契约文件在列、其余 11 文件 194 用例绿）。
- 与 `pnpm test` 同入口实证：`--typecheck` 显式运行三条契约文件成功收集并执行（red evidence 日志包含 `Type Errors` 段落）。
- 零 skip/only/todo、零 env override、零 fallback、零源码字符串断言；断言全部为运行时行为或编译期类型面。

## 15. 未知与阻塞

1. **wire kind 的 TS 字段名未锁定**（契约刻意）：SA1 设计需选择与判别键 `kind:'UPDATE_CHUNK'` 不冲突的成员名；无论可选+缺省 0 或必填，R1 的字节往返都会强制「kind 首字段恒在」。
2. **编码侧绑定块一致性规则**：`kind=1` 消息在 `chunkIndex>0` 时是否拒绝还是丢弃绑定块（R9 对称的严格读法 vs writer 归一化）未在本次断言（无法在不锁定字段名的情况下表达）；建议 SA1 在设计中显式裁决并补测。
3. **发送端共用 transferId 计数器**（AC4 后半）须在 kind=1/2 发送端落地的后续切片执行；本契约登记设计约束：单计数器、作用域 (连接, 方向, namespaceId)、从 1 严格递增、不回绕、三 kind 共用、复用 `update-channel.ts` 既有计数器，代码不新增第二计数器。
4. **`maxChunksPerUpdate` 显式下调触发新链**（R35）：本契约按 §17「同纪律」锁定为「必须激活」（C5a）；若 SA1 设计出与 HEAD 门宽不同的读法，须在设计门禁显式裁决并同步修订本契约。
5. **绝不运行时 clamp 的「值相等」面**：无 resolved limits 公共访问器，本切片以「装配期响亮拒绝 + 边界等号接纳」表达；若后续引入 limits 访问器可追加值相等断言。
6. **绑定块字段值域**（replicationId 文法 / epoch ≥ 1 / syncRoundId ≥ 0）未作为独立红灯断言：ADR/§10.3 只冻结存在性与位置，内容核对属 §8.1/§9.2；R8/R9/R10 的违例向量在「校验值域」与「不校验值域」两种实现下都收敛到 `MALFORMED_FRAME`，不引入过度约束。
7. `.test-d.ts` 使 `pnpm typecheck` 在实现前为红——这是类型面红灯的预期形态；若实现无法在本切片补齐类型面，须重新进入设计门禁。

## 16. 临时诊断清理

- 临时 probe 源文件（收尾前已删除，不进入交付）：`packages/replication-protocol/test/.sa6-299-probe.ts`、`packages/replication-protocol/test/.sa6-299-probe2.ts`、`packages/ws-replication/test/.sa6-299-probe.ts`。
- 未改动任何生产实现、既有测试或 fixture；`git status` 仅显示契约测试 3 文件 + 报告 + 证据日志（见收尾核对）。
- 零常驻进程/服务、零后台长驻任务（全仓 `pnpm test` 为一次性前台命令的后台包装，收尾前核对/终止）。

# SA3 Implementation Report — issue #299（feat：#295 切片 1：0x42 kind 首字段单形态 codec + 聚合上限配置链）

- **dispatch**: `sa-9e8e1172-6b2a-4a6a-83a6-78665f8ec6dd`（mabf-sa3 / implementation / iteration 0）
- **HEAD**: `eb380d7aed296c15accf8832a45a96b630f0c8ce`（分支 `mabf/issue-299`）
- **实现依据**: `wiki/raw/task_issue-299_design.md`（iteration 1，SA2 **approve**：0 BLOCKER / 0 MAJOR / 2 MINOR）+ `wiki/raw/task_issue-299_sa6_contract.md`（approve，26 项转绿判据）+ SA8 门禁两份（clear）
- **验证摘要**: 契约 **31/31 绿**（26 转绿判据 + 新增 encode-symmetry 5）· protocol 包 213/213 · ws-replication 包 500/500 · 根 `pnpm typecheck` 退出 0 · `git diff --check` 干净 · 契约三文件 sha256 与 SA6 §13 锁定值逐字节一致（未改一行）

---

## Inputs consumed

| 输入 | 路径 | 状态 / 用途 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-299.md` | 在库；issue 正文 + AC1–AC4；comments 段为空（Owner 要求 = 无） |
| 最新批准设计 | `wiki/raw/task_issue-299_design.md` | 在库（iteration 1）；ALLOW/DENY、D1–D10、§12 验证矩阵逐条执行 |
| SA2 评审 | `wiki/raw/task_issue-299_sa2_review.md` | 在库；approve，F1–F3 已解决 + O5/O6 建议项（本轮顺手落实） |
| SA6 验收契约 | `wiki/raw/task_issue-299_sa6_contract.md` | 在库；红/绿判据 + 契约三文件 sha256 |
| SA6 红证据 | `artifacts/sa6-issue299-red-evidence.log`、`-red-detail.log`、`-probe.log`、`-existing-suites.log`、`-full-suite.log` | 在库；对照基线 |
| SA8 前置门禁 | `artifacts/sa8-conflict-gate-issue-299.md` | 在库（clear，R32–R37） |
| SA8 设计后复审 | `artifacts/sa8-conflict-gate-issue-299-design-recheck.md` | 在库（clear，R38–R41） |
| SA6 契约三文件 | `packages/replication-protocol/test/codec-issue299-ac-red.test.ts`、`packages/ws-replication/test/ws-replication-issue299-ac-red.test.ts`、`packages/ws-replication/test/ws-replication-issue299-api.test-d.ts` | DENY；只读执行，**零改动**（sha256 见 §Verification） |
| `relevant_decisions` / `conflict_report` | `wiki/raw/task_issue-299_relevant_decisions.md`、`task_issue-299_conflict_report.md` | 不存在（SA6 §1 / SA2 §1 已登记）；按设计以 ADR/协议/CONTEXT + SA8 门禁为规范依据 |
| 既有实现报告 | `wiki/raw/task_issue-299_sa3_impl.md` | 不存在（本文件为首次产出） |

## Existing worktree reconciliation

- dispatch 起始 `git status`：工作树无任何未提交实现改动；仅存在 SA6/SA8 产出的未跟踪证据（`artifacts/sa6-*`、`artifacts/sa8-*`、`wiki/raw/task_issue-299*`）与契约三文件——全部原样保留。
- 无待修订的旧实现：所有生产/测试改动均为本次按最新批准设计首次落地。
- 契约三文件（DENY）在实现前后 sha256 不变（见 §Verification 第 1 行），满足「不改一行 26/26」转绿判据。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/replication-protocol/src/messages.ts` | D1/D2、§8 接口表 | 新增 `UpdateChunkTransferKind = 0 \| 1 \| 2`；`UpdateChunkMsg` + 必填 `transferKind` + 可选 `replicationId?`/`replicationEpoch?`/`syncRoundId?`；注释锚 ADR 0019 / §10.3 |
| `packages/replication-protocol/src/payloads.ts` | D3/D4、§7 | `decodeUpdateChunk` 单形态重写（kind 首字段先行 + 非法值即拒 + 五字段序 + 绑定块按位读取 + 既有 bytes/限额/全消费纪律不变）；`encodeUpdateChunk` 镜像写序 + kind 值域 + 绑定块 iff 严格拒绝（无归一化）；注释块改写为 ADR 0019 单形态 |
| `packages/replication-protocol/src/index.ts` | D1 | 导出 `type UpdateChunkTransferKind` |
| `packages/ws-replication/src/types.ts` | D5.1 | `ReplicationLimits` + 两必填 `readonly number` 键（注释锚 ADR 0019 配置表 + 链②约束） |
| `packages/ws-replication/src/defaults.ts` | D5.2 | `DEFAULT_REPLICATION_LIMITS` + `maxChunkedBootstrapBytes: 4 MiB`、`maxChunkedSyncDiffBytes: 4 MiB`（键集 14 → 16） |
| `packages/ws-replication/src/validate.ts` | D5.3、D6 | `validateLimits` + 两键 `positiveSafeInteger` 值门；新增 `validateChunkedBootstrapChain` / `validateChunkedSyncDiffChain`（各一不等式、错误消息含三操作数、包内导出） |
| `packages/ws-replication/src/plugin.ts` | D5.4 | `LIMIT_KEYS` + 两键（插件严格 allowlist 接纳；链②经 `apply` 继承生效） |
| `packages/ws-replication/src/hub-connection.ts` | D6、D8 | 构造器在既有 #244 门块后追加两条 `hasOwnProperty` 守卫（各自新键激活对应链②）；`sendUpdateChunk` 消息字面量 + `transferKind: 0` |
| `packages/ws-replication/src/peer-connection.ts` | D6、D8 | 同上（与 hub 逐字对称） |
| `packages/replication-protocol/test/fixtures.ts` | D7 | 本地 `UpdateChunkMsg` interface 单形态对齐；三条 golden 改写（BASIC→kind=0、MULTIBYTE→kind=1、U32_MAX→kind=2；payload 前缀 `00`/`01`/`02`；计数 21 不变） |
| `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` | D7 改动 ①②③（SA2 F1） | ① 三向量 + `transferKind: 0`、payloadHex 前缀 `'00'`、`PINNED_FRAME_HEX` 头长 `2d→2e`/`32→33`/`3a→3b`；② `hostilePayload` 缺省 `'00'` kind 前缀 + `kindHex` 覆盖键；③ 字段序锁定断言改 `kind → ns → 五字段` 全序 + 文件头/用例标题/`ChunkVector` 注释升级为 ADR 0019（顺带 O6） |
| `packages/replication-protocol/test/codec-issue299-encode-symmetry.test.ts`（新增） | D4、§12 AC2（SA2 F2） | encode 侧 iff 严格拒绝冻结清单：负控 ①–⑩（含 O5 建议的 ⑨⑩）+ 正控 P1–P5（P2/P3 以规范算术向量逐字节锁定绑定块位置 + decode→encode 往返） |
| `packages/replication-protocol/test/codec-messages-golden.test.ts` | D7 | 仅用例标题字段序描述行（断言面不变，GOLDEN=21 锚保持） |
| `packages/replication-protocol/test/codec-fuzz-property.test.ts` | D9 | case 18 生成器扩展：随机 `transferKind ∈ {0,1,2}` ∧ `chunkIndex ∈ [0, chunkCount)` ∧ 绑定块 presence 由 iff 规则推导 |
| `packages/replication-protocol/test/codec-api.test-d.ts` | D1 类型面（ALLOW 可选） | 类型锁补 `transferKind`（`toEqualTypeOf<UpdateChunkTransferKind>`）+ 绑定块可选成员形状 |
| `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts` | §10 矩阵 | 1 处构造点 + `transferKind: 0` |
| `packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts` | §10 矩阵 | 5 处构造点 + `transferKind: 0` |
| `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts` | §10 矩阵 | 2 处构造点 + `transferKind: 0` |
| `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts` | §10 矩阵 | 1 处构造点 + `transferKind: 0` |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | D5 类型面（ALLOW 可选） | limits 类型锁补两键（必填 number；`DEFAULT` 两键 number） |
| `docs/protocols/instance-replication-v1.md` | D10 / R37+R39（SA2 F3） | §22 L701 二分收口：codec 向量支改「已交付」并指向 `codec-issue299-ac-red.test.ts` 冻结向量 + 改写后 golden（`codec-messages-golden.test.ts` / `fixtures.ts`）；传输层 kind=1/2 资产维持「由 §8.1/§9.2 后续切片交付，本规范不预设其存在」 |
| `packages/ws-replication/test/ws-replication-observer-red.test.ts` | **范围外机械跟随（见 §Deviations）** | `ConnectionSenderHost.limits` 字面量补两新键缺省值（2 行）——`ResolvedLimits extends ReplicationLimits` 的必填键扩张导致的编译期必改点，设计 §10 矩阵漏登记 |
| `wiki/raw/task_issue-299_sa3_impl.md`（本文件） | 技能固定产物 | 实现报告 |
| `artifacts/sa3-issue299-verification.log`（新增） | 证据 | 契约哈希 + 契约运行 + 两包套件 + 根 typecheck + `git diff --check` 原始输出 |

**ALLOW 内但零改动（实测无需编辑）**：`ws-replication-issue243-real-transport.test.ts`、`issue244-sa7-dynamic.test.ts`、`issue244-slot-reclaim-regression.test.ts`、`issue245-ac-red.test.ts`——设计 §10 矩阵列为「构造点 + `transferKind: 0`」，但实测这 4 文件只有 `Extract<DecodedMessage['message'], { kind: 'UPDATE_CHUNK' }>` 类型提取，无 `kind: 'UPDATE_CHUNK'` 对象字面量（全仓构造点 = 两包 src 2 处 + protocol 测试 4 文件 + ws 测试 4 文件，已全部表态）。

## SA2 Finding落实

| Finding ID | Implementation | Result |
|---|---|---|
| **F1** `codec-issue242-ac-red.test.ts` 改写清单不完整（MAJOR） | 三处改动 + `PINNED_FRAME_HEX` 头部 payloadLength 同步全部落地（D7 ①：向量 `transferKind: 0` + `'00'` 前缀 + `2e`/`33`/`3b`；②：`hostilePayload` 缺省 kind 前缀 + `kindHex` 键；③：字段序全序断言 + 头/标题/注释升级）；实测该文件 28 用例全绿，敌意向量字段级规则仍被抵达（`transferIdHex:'8100'` 等在合法 kind 前提下仍 `MALFORMED_FRAME`），无伪绿 | **已落实**（§12「判别力保持」判据满足） |
| **F2** encode 侧补测无 ALLOW 落点（MAJOR） | 新建 `codec-issue299-encode-symmetry.test.ts`（ALLOW 新条目），冻结清单五例 ①–⑤ 全采纳 + 补足 ⑥–⑧ + O5 建议 ⑨⑩，每组前置相近正控 P1–P5（含往返无损）；未触契约三文件 | **已落实**（5 用例全绿） |
| **F3** §22 收口声称未实现传输层资产（MAJOR） | D10 二分模板逐字落地：codec 向量支「已交付」+ 指向在仓资产；传输层资产支维持待交付语义；`0x42`/`0x00000001`/四资产名锚与 L707 义务句零改动 | **已落实**（§22 内零「传输层资产已交付/已存在」表述；doc-contract 22 用例全绿） |
| **O1** D3 收敛路径叙述（MINOR） | 设计层修订；实现按「无专门尾随检查、仅既有欠载/全消费纪律」落地（decode 未新增任何针对单一向量的代码路径） | 已遵循（五向量契约用例全绿） |
| **O2** wire-change 门豁免依据（MINOR） | 设计层已显式化；实现侧无动作 | 无动作（§Deferred 登记） |
| **O5** 两个原子镜像半例（建议） | 顺手采纳为负控 ⑨（kind=2 ∧ idx=0 缺 `syncRoundId`）与 ⑩（kind=1 ∧ idx=0 携 `syncRoundId`） | 已补（补测文件 5 用例含 ⑩/⑨，全绿） |
| **O6** codec-issue242 L82 注释残留 | `ChunkVector.payloadHex` 注释改为「ADR 0019 / 协议 §10.3 单形态序」 | 已更正 |
| **O3/O4**（无需动作） | 无动作（设计声明维持） | 闭合 |

**激活门处置**：D6 窄门裁决原样实现——#244 家族门（含显式 `maxChunksPerUpdate`）零语义变化；两条 #295 链②各由**自身新键**显式激活（`hasOwnProperty` 守卫）；契约 C2–C5 全绿（边界等号接纳 / off-by-one 拒绝 / 显式 `maxChunksPerUpdate=1` 经 #244 链②响亮 TypeError / 零分块族键存量配置不误判）。

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/replication-protocol/src/messages.ts` | ALLOW #1 | 类型面 + wire kind/绑定块成员 |
| `packages/replication-protocol/src/payloads.ts` | ALLOW #2 | 单形态 codec（D3/D4） |
| `packages/replication-protocol/src/index.ts` | ALLOW #3 | 公共类型导出 |
| `packages/ws-replication/src/types.ts` | ALLOW #4 | 两必填 limits 键 |
| `packages/ws-replication/src/defaults.ts` | ALLOW #5 | 两缺省 4 MiB |
| `packages/ws-replication/src/validate.ts` | ALLOW #6 | 两值门 + 两链② |
| `packages/ws-replication/src/plugin.ts` | ALLOW #7 | allowlist +2 键 |
| `packages/ws-replication/src/hub-connection.ts` | ALLOW #8 | 链门守卫 + `transferKind: 0` |
| `packages/ws-replication/src/peer-connection.ts` | ALLOW #9 | 同上（逐字对称） |
| `packages/replication-protocol/test/fixtures.ts` | ALLOW #10 | golden 单形态改写 |
| `packages/replication-protocol/test/codec-issue242-ac-red.test.ts` | ALLOW #11 | D7 ①②③ |
| `packages/replication-protocol/test/codec-issue299-encode-symmetry.test.ts` | ALLOW #12（新增条目） | encode 侧对称补测 |
| `packages/replication-protocol/test/codec-messages-golden.test.ts` | ALLOW #13 | 用例标题字段序行 |
| `packages/replication-protocol/test/codec-fuzz-property.test.ts` | ALLOW #14 | case 18 生成器扩展 |
| `packages/replication-protocol/test/codec-api.test-d.ts` | ALLOW #15（可选） | 类型锁 |
| `packages/ws-replication/test/ws-replication-issue243-ac-red.test.ts` | ALLOW #16 | 构造点表态 |
| `packages/ws-replication/test/ws-replication-issue243-chunked-live.test.ts` | ALLOW #17 | 5 构造点表态 |
| `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts` | ALLOW #19 | 2 构造点表态 |
| `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts` | ALLOW #22 | 1 构造点表态 |
| `docs/protocols/instance-replication-v1.md`（仅 §22 L701） | ALLOW #23 | D10 文档收口 |
| `packages/ws-replication/test/ws-replication-api.test-d.ts` | ALLOW #24（可选） | limits 类型锁 +2 键 |
| `packages/ws-replication/test/ws-replication-observer-red.test.ts` | **范围外（既不在 ALLOW、也不在 DENY）** | 见 §Deviations：2 行字面量补全，编译期必改点 |
| `wiki/raw/task_issue-299_sa3_impl.md` | 技能固定产物（实现报告） | 本报告 |
| `artifacts/sa3-issue299-verification.log` | 证据产物（与 SA6/SA8 同惯例） | 验证原始输出 |

**DENY 核对（零触碰）**：契约三文件（sha256 不变）· `update-transfer.ts`/`update-channel.ts`/`hub-namespace.ts`/`peer-namespace.ts`/`frame-io.ts`（`git status` 无条目）· `docs/adr/*` · 协议 §5/§10.3/§13.2/§17 及其他节（diff 仅 §22 一行）· `CONTEXT.md` · `apps/yjs-server/**` · 错误码注册表/`observer.ts` · `canonical.ts`/envelope。

## Verification

| Command | Result | Evidence |
|---|---|---|
| `sha256sum` 契约三文件（实现后复测） | `3168f11c…` / `56a2337b…` / `171104c2…` ——与 SA6 §13 锁定值逐字节一致（DENY 未改一行） | `artifacts/sa3-issue299-verification.log` §1 |
| `npx vitest run --typecheck <契约三文件> <encode-symmetry>` | **4 文件 / 31 用例全绿**（契约 26/26 转绿 + 新增 5）；`Type Errors no errors`；零 skip/only/todo | log §2 |
| `npx vitest run packages/replication-protocol/test` | **13 文件 / 213 用例全绿**（含 contract 17、encode-symmetry 5、golden 27、issue242 28、truncation 8、fuzz 5、doc-contract 22、类型面 8）；`Type Errors no errors` | log §3 |
| `npx vitest run packages/ws-replication/test` | **70 文件 / 500 用例全绿**（含 issue299 契约 7、issue243/244/245/246 传输套件、observer-red、plugin、real-transport、类型面）；`Type Errors no errors` | log §4 |
| `pnpm typecheck`（根，14 个 tsconfig，含 `apps/yjs-server`） | **退出码 0，Type Errors no errors** | log §5（`typecheck_exit=0`） |
| `codec-issue246-doc-contract.test.ts`（§22 收口后） | 22/22 绿：D4-1/D4-2 锚（`0x42`/`0x00000001`/四资产名）与 D6-1 新指向 `codec-issue299-ac-red.test.ts` 存在性全部通过；L707 义务句保持 | log §3（协议包套件内） |
| 过期术语扫描（`双形态`/`CAP_CHUNKED_SYNC` in `docs/protocols`+`CONTEXT.md`） | `docs/protocols` 零命中；`CONTEXT.md` 仅 L167 `_Avoid_` 反例条（词表避免项，非规范正文，HEAD 既有）；ADR 0013/0019 命中属**已拒绝方案/接替登记**（DENY，历史记录，预期保留） | log §7 |
| `git diff --check` | 干净（零空白错误） | log §6 |
| 工作树 changed paths 核对 | 21 个 M + 新增测试/报告/证据；DENY 路径（传输/assembly 五文件、ADR、协议 §5/§10.3/§13.2/§17、CONTEXT、apps/yjs-server、注册表/observer、canonical/envelope）零条目 | log §8 |

**红灯 → 绿灯证据链**：SA6 基线（HEAD）21 红 / 5 负控绿 → 本实现后契约 26/26 绿且负控保持绿（N1 协商门、N2 选项急切校验、N3 他域回归、C5 非追溯性/门宽、C6 control reserve 全绿），失败分类零新增（仅既有 `MALFORMED_FRAME`/`UPDATE_TOO_LARGE`/`UNSUPPORTED_MESSAGE_TYPE`/`CONNECTION_POLICY_VIOLATION` 与配置层 `TypeError`）。

## Deferred verification

SA3 职责边界外、移交 SA4/SA7（设计 §12 已登记，非本切片缺口）：

1. **全仓 `pnpm test`**（328 文件全绿 + `Type Errors no errors`）——最终动态验证门；本切片已覆盖受影响两包全套件（213 + 500）与根 typecheck。
2. **wire-change 新旧互通证据门豁免**：`packages/replication-protocol/AGENTS.md`「Wire changes require old/new interoperability evidence」由 ADR 0019 同版本部署假设 + 旧六字段形态从未发布 + PR #241 OPEN（SA8 C4 实测）显式豁免——互操作证据面为空集；同版本自互通由改写后 golden/契约向量/传输层既有套件承载。
3. **kind=1/2 传输层**：发送端（含绑定块数据流与共用 `update-channel.ts` `nextTransferId` 计数器）、接收端 kind 分派/按 kind 聚合上限执行/绑定块内容核对三码、assembly kind 无关收口、head-of-line 切片——属 §8.1/§9.2 后续切片（本切片接收层不消费 `transferKind`，部署面结构性不可达，D8/R41 已登记）。
4. **AC4 计数器本体**：本切片仅 codec/契约层锁定字段语义（R11/R12 绿）；计数器不改代码，复用既有 `nextTransferId` 约束已在报告与设计中登记。
5. **`apps/yjs-server` 配置文件 allowlist 分块族 catch-up**（含两新键）——家族级 follow-up（设计 §13-2），本切片零改动。

## Deviations or blockers

**1 项范围偏差（无阻塞，需 SA4/SA7 追认或要求设计补 ALLOW 条目）**：

- **`packages/ws-replication/test/ws-replication-observer-red.test.ts`（+2 行）**——设计 §10 矩阵声明该文件「零改动」，但 `ConnectionSenderHost.limits` 的完整字面量（L800–809）在 `ResolvedLimits extends ReplicationLimits` 两键转必填后编译期必红：
  - 证据（未修前）：`packages/ws-replication/test/ws-replication-observer-red.test.ts(800,7): error TS2739: … is missing the following properties from type 'ResolvedLimits': maxChunkedBootstrapBytes, maxChunkedSyncDiffBytes`（根 `pnpm typecheck` 因 `&&` 链在 ws-replication 处中止，`apps/yjs-server` 未被执行）。
  - 处置：补两行缺省值（`4 * 1024 * 1024`），与同字面量既有 `maxChunkedUpdateBytes`/`maxChunksPerUpdate`/`maxConcurrentAssembliesPerConnection` 的「新增字段（缺省值）」注释同形。零行为影响（该对象字面量本就是手写全量缺省，等价于 `DEFAULT_REPLICATION_LIMITS`；不涉及任何断言或业务语义）。
  - 为什么未按「范围不足退回 SA1/SA2」处理：替代方案只有把 `ResolvedLimits` 的新键改为可选（会破坏 D5.1 必填类型面与契约 `api.test-d` 的 `toEqualTypeOf<number>()`，属公共设计降级），而设计 §12 又把根 `pnpm typecheck` 零错误列为转绿判据——即设计自身要求的结果只能由这一处机械跟随达成。已在本报告完整登记，供 SA4/SA7 裁决；若要求严格 ALLOW 一致，最小修法是设计 §11 ALLOW 增补该文件一行（零实现语义变化）。
- **无其他偏差 / 无阻塞**：契约语义零改、断言零弱化、无 skip/only/todo、无 env override、无 fallback、无生产侧静默降级。

## Suggested commit message

```
feat(#299): 0x42 UPDATE_CHUNK kind 首字段单形态 codec + 聚合上限配置链（#295 切片 1）

- codec：0x42 payload 改写为 kind(varUint ∈ {0,1,2}) 首字段单形态；kind=1/2 首 chunk 绑定块
  （replicationId+replicationEpoch / syncRoundId）位于 totalBytes 与 bytes 之间；encode/decode
  同一套单帧规则（kind 非法值、绑定块缺失/越位/跨族污染 → MALFORMED_FRAME，严格拒绝不归一化）；
  导出 UpdateChunkTransferKind；协商门与 UPDATE_TOO_LARGE 语义不变。
- 配置：ReplicationLimits 增 maxChunkedBootstrapBytes / maxChunkedSyncDiffBytes（缺省各 4 MiB）
  进入值门、插件 LIMIT_KEYS 与两条链②（各自新键显式激活；#244 家族门原样保留）；违例构造期
  TypeError、绝不运行时 clamp；control reserve 校验原样保留（非追溯性）。
- 测试：三条 golden 改写为单形态（BASIC→kind0 / MULTIBYTE→kind1 / U32_MAX→kind2，计数 21 不变）；
  #242 向量与敌意构造前缀化（消除单形态下的伪绿）；新增 encode 侧 iff 严格拒绝补测；
  fuzz/property 覆盖三 kind × 绑定块 presence；SA6 契约三文件不改一行 26/26 转绿。
- 文档：协议 §22 收口——codec 向量标记为已交付并指向资产；传输层 kind=1/2 资产维持后续切片待交付。
```

（仅供 Controller 选择；SA3 不执行 commit/push/PR。）

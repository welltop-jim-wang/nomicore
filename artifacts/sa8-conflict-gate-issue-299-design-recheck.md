# SA8 冲突门禁报告 — issue #299（设计后复审）

- **dispatch**: sa-75f9d7c2-b601-4663-8c49-8c8e4299e214（mabf-sa8 / conflict-gate / iteration 1）
- **审查对象**: SA1 设计 `wiki/raw/task_issue-299_design.md`（dispatch sa-2fcad09c-f695-4e26-823e-2b716f8b04b3 / design / iteration 0），对照基线 = `CONTEXT.md` + `docs/adr/` 全集（17 篇）+ wire 唯一权威 `docs/protocols/instance-replication-v1.md`（root AGENTS.md「Instance replication」节指定；本 dispatch 明示纳入协议规范为复核基准）
- **门禁类型**: 设计后复审（SA1 产出后：设计 vs 决策集；全维度攻击评审属 SA2，不在本报告范围）
- **Issue comment REST snapshot**: `[]`（dispatch 声明与 `gh issue view 299` 实测一致）——无 Owner 补充要求需要并入
- **裁决**: **通过（clear）——0 阻塞冲突 / 1 个轻微冲突接续（R32，仅 issue 标题文本，正文与设计为准）/ 4 条非阻塞复核注意项（R38–R41）**。dispatch 聚焦四点（公共 API 类型变更、0x42 wire 字段序、绑定块规则、聚合上限激活门含已记录的验收契约歧义）全部逐条对照裁决如下。

## 1. 冲突基准与效力判定

- **ADR 0022**（已接受，issue #295 设计冻结）：本设计是其显式履行票；wire 冻结值以协议文档为唯一权威（ADR 0022 L4），配置语义理据权威保留于 ADR 0022、机制键语义显式转引协议 §17（L61）。
- **ADR 0013**（已接受）：其非目标 #4 的划除与接替登记（L117）、ADR 0022 L116 对「未协商端逐字节不变」纪律的限定范围偏离登记均显式在册——六字段旧形态不构成约束；`CAP_CHUNKED_UPDATE` 协商门是 ADR 0013 已实现内容、ADR 0022 非目标 #5 明确不修订。
- **协议文档**为 wire 契约唯一权威；HEAD（`eb380d7`）已是 #295 修订后目标契约（§5 L114–116、§10.3 L307–345、§13.2 L445–452、§17 L575–615、§22 L699–701、§23.1 第 29–36 型）。
- **`wiki/raw/` 一律为 evidence、非规范契约**（docs/AGENTS.md「Authority」节明文）——SA6 契约的可执行断言是已批验收权威（SA6 裁决 approve、sha256 锁定、转绿判据「不改一行 26/26」），但其散文（§3-R35/§12-5/§15.4）不构成规范基准；本复审对其内部歧义按「协议字面 → 可执行契约 → SA6 散文」的效力序裁决（§2.4）。
- **CONTEXT.md**：五分块词条（分块复制传输/UPDATE_CHUNK/CAP_CHUNKED_UPDATE/同版本部署假设/实现代际，L153–171）与设计用法逐条一致；设计零 CONTEXT.md 改动、零新词条——无词汇漂移。
- 全库 supersede 扫描与 #244/#245/#246/#299 前置门禁连续裁定一致：无 ADR 级整体被取代状态。
- **ADR 0022 事实前提复核**：PR #241 OPEN 未合并（本次 `gh pr view 241` 实测）；分支 codec 现状六字段（`payloads.ts` `decodeUpdateChunk` 实测：`namespaceId` 起始、无 kind/绑定块）；`messages.ts` `UpdateChunkMsg` 以 `kind:'UPDATE_CHUNK'` 为判别键、无 `transferKind` 成员——「旧形态从未发布、无兼容负担」前提成立，设计 D1–D7 的改写面有 ADR 0022 L36–37/L100 直接授权。

## 2. dispatch 聚焦四点逐条裁决

### 2.1 公共 API 类型变更（设计 D1/D2/D5/D8）——无冲突

| 设计裁决 | 基线依据 | 裁决 |
|---|---|---|
| `UpdateChunkMsg` + 必填 `transferKind: UpdateChunkTransferKind`（`0\|1\|2`）+ 可选 `replicationId?`/`replicationEpoch?`/`syncRoundId?` | 协议/ADR/CONTEXT 均只冻结 wire 形态与语义，不约束 TS 成员名；SA6 §15.1 显式将命名留为 SA1 设计面；`kind` 已被判别键占用（`messages.ts` L237 实测）→ 异名必要；必填性镜像「kind 首字段恒在」（§5 L116「恒为」/AC1「恒在」），可选+缺省 0 会制造静默 fallback，与「响亮」纪律相悖 | 无冲突 |
| 绑定块为可选成员、存在性唯一裁决点 = codec（D2） | §10.3 L323 绑定块存在性是 wire 位置条件（`kind≠0 ∧ chunkIndex=0`），静态类型无法表达对运行时 `chunkIndex` 的依赖；CONTEXT.md「UPDATE_CHUNK」词条 codec 无状态纪律不涉类型面 | 无冲突 |
| `ReplicationLimits` + 两必填 readonly number 键 + `DEFAULT_REPLICATION_LIMITS` 两键 4 MiB + `validateLimits` 无条件 `positiveSafeInteger` 值门 + `LIMIT_KEYS` +2 | ADR 0022 配置表 L58–59（缺省 4 MiB、约束链②）；§17 L578–579/L590–609（缺省值 + 启动响亮验证块；值门无条件先例 = #244 键 `maxChunksPerUpdate ≥ 1`，`validate.ts` L152/L154 实测同构）；缺省 4 MiB 恒合法 → 零非追溯性面 | 无冲突 |
| 导出 `UpdateChunkTransferKind` 经 `src/index.ts`；两条新链②校验函数包内私有 | packages/ws-replication/AGENTS.md「Export production APIs through `src/index.ts`」；`validateChunkedTransferChain` 同待遇先例 | 无冲突 |
| 破坏性演化作用域（必填成员使全部构造点编译期表态） | 包未发布、workspace `*` 内部消费、PR #241 未合入（实测）、同版本部署假设（ADR 0022 L14–18）——无仓外/跨版本消费方；§10 矩阵穷举仓内构造点 | 无冲突（R40 登记实现期核对义务） |

### 2.2 0x42 wire 字段序（设计 D3/D4/D7）——无冲突

- **读序/写序**：`kind varUint` 首位 → `namespaceId` → `transferId`（≥1、0 非法）→ `chunkIndex` → `chunkCount`（≥1、idx<count）→ `totalBytes` → [绑定块] → `bytes`——与 §5 L116、§10.3 L313 字段表、L323 单形态段、ADR 0022 L24–34 代码块**逐字同源**；绑定块位置（`totalBytes` 之后、`bytes` 之前）逐字一致。encode 写序 = 读序镜像满足 L321「encode/decode 同一套」。
- **kind 非法值即拒**：`kind ∉ {0,1,2}` → `MALFORMED_FRAME` 于首字段读取处——对齐 ADR 0022 L37「恶意声明在第一个字节流入前即可拒绝」；旧六字段首字节 0x23=35 与合法 kind 集合不相交 → 旧形态自动作废（SA6 probe A 实测佐证）。
- **golden 改写**：3 条 golden 改 kind {0,1,2}、计数 21 不变、绑定块形态由契约冻结向量 `KIND1_FIRST`/`KIND2_FIRST` 逐字节锁定——ADR 0022 L100「#242 的 0x42 golden vectors 在本分支内改写为单形态」直接授权；§22 L701「kind 首字段 + 首 chunk 绑定块的 golden vectors…由实现 ticket 交付」由此兑现（交付物 = 改写后 golden + 契约冻结向量，收口措辞精度见 R39）。
- **协商门/字段限额不动**：`CAP_CHUNKED_UPDATE` pre-parse 拒绝（§10.3 L345、§5 L114）、`bytes ≤ maxUpdateBytes` → `UPDATE_TOO_LARGE` kind 无关（§10.3 L321）、v1 代际端 0x42 照旧 fatal（CONTEXT.md「实现代际」）——设计 R34 落实，负控 N1 锚保留。

### 2.3 绑定块规则（设计 D2/D3/D4）——无冲突

- **存在性/位置 iff**：`当且仅当 kind≠0 ∧ chunkIndex=0`（kind=1 → `replicationId varString + replicationEpoch varUint`；kind=2 → `syncRoundId varUint`）——§10.3 L323、§5 L116、ADR 0022 L32/L37–43 逐字同源；违例向量收敛 `MALFORMED_FRAME`（R8/R9/R10 契约向量与 D3 收敛路径推导一致）。
- **encode 侧严格拒绝（不归一化）**：L321「codec 级单帧规则（encode/decode 同一套，违者 `MALFORMED_FRAME`）」+ L323 将 kind/绑定块规则**追加进该同一套**——encode 侧 iff 严格拒绝是「同一套」的直接推论；归一化会造成 decode→encode→decode 不等价，与 R9 对称纪律冲突——设计裁决 D4 与基线一致（SA6 §15.2 显式留裁，落点正确）。
- **值域边界不越界**：codec 只校验结构性规则与 varUint/varString 可编码性，`replicationId` 文法/`replicationEpoch ≥ 1`/`syncRoundId` 语义不校验——§10.3 codec 级规则仅冻结存在性/位置；内容核对（`REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH`/`SYNC_STATE_VIOLATION`）由 §8.1 L202/§9.2 L238 归属后续切片；SA6 §15.6 同裁定。过度约束反而会与 §8.1/§9.2 冲突——设计边界正确（R36 落实）。
- **transferId 语义锁定**：uint32、≥1、0 非法、三 kind 同一字段位/同一计数器（§5 L116、§10.3 L315/L325、ADR 0013 L32 + ADR 0022 L28、CONTEXT.md「分块复制传输」L154）；计数器本体留发送端（复用 `update-channel.ts` 既有 `nextTransferId`、不新增第二计数器）——CONTEXT.md「UPDATE_CHUNK」codec 无状态纪律（R33）一致。

### 2.4 聚合上限激活门（设计 D5/D6）与已记录的验收契约歧义——无冲突（歧义按效力序裁决成立，登记 R38）

**歧义本体**：SA6 契约文档内部矛盾——散文（§3-R35「显式 `maxChunksPerUpdate`（#244/#295 共享操作数键）仍必须激活链」、§12-5「不得窄化为『只认新键』」、§15.4「锁定为『必须激活』（C5a）」）采取**宽门**读法（显式 `maxChunksPerUpdate` 激活 #295 两链②）；而其可执行断言 C2/C3 边界族要求**窄门**（每条 #295 链②仅由自身新键显式激活）。SA1 D6 按可执行契约裁决窄门并诚实登记偏差。本次复审三层核实：

1. **协议字面（§17，规范权威）支持窄门**：L613 对 #244 两链的激活门是「显式 `maxChunkedUpdateBytes` **或** `maxChunksPerUpdate`（两链不等式的分块族操作数键）」；L615 对 #295 键的平行句**刻意无「或」子句**——「调用方显式配置 `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes` 时**对应**链式校验响亮生效…未表达新键的存量配置不误判」。「对应」把每条链绑定到自身键；宽门会让**非对应**链在仅表达一个新键（或仅表达 `maxChunksPerUpdate`）的配置上开火，直接抵触「对应…生效」+「不误判」两条款。窄门是唯一字面一致的读法。
2. **可执行契约（sha256 锁定、已批验收权威）数学上强制窄门**：C2/C3 边界接纳族 `{maxChunksPerUpdate: 4, maxChunkedUpdateBytes: 1MiB, maxQueuedUpdateBytes: 2MiB, maxChunkedBootstrapBytes: 2MiB}`（product = 2 MiB；另一新键未表达 → 缺省 4 MiB > 2 MiB）断言**必须接纳**（实测契约文件 L259–263/L286–289）；宽门下该族必构造期 `TypeError`，「不改一行 26/26」转绿判据不可能成立。反之窄门下全族自洽。
3. **SA6 散文对 C5a 的引用是过度引申**：C5(a)（`{maxChunksPerUpdate: 1}` → `TypeError`，实测 L326–329）在窄门下经 **#244 链②** 满足（合并缺省 `maxChunkedUpdateBytes` 4 MiB > 1 × 512 KiB）——该路径在 HEAD 已绿即证（#244 家族门实测存在于 hub-connection.ts L201–206 / peer-connection.ts L115–120，注释 R1c 先例原文即此构型）；C5(b)（`maxChunksPerUpdate: 8` → 4 MiB ≤ 4 MiB 等号接纳）、C5(c)（零分块族键/仅 `maxUpdateBytes: 32KiB` 接纳）同样与窄门相容。**没有任何一条可执行断言区分宽窄两门，除 C2/C3 边界族——而它只与窄门相容。**

**R35 关切保持**：显式下调 `maxChunksPerUpdate` 的响亮失败由 #244 链②完整承载（三 envelope 缺省同为 4 MiB，任何 product < 4 MiB 的显式下调必越 #244 链②）——前置门禁 R35 的实质关切（「不得静默违反缺省上界」）零损失；D6 对 #244 家族门「HEAD 原样保留」同时满足 SA6 §12-5「保留 HEAD 门宽」在 #244 域的 字面要求。

**残余语义（设计已显式登记）**：显式表达某分块族键时，未表达新键的缺省 envelope 可数学越界而不被构造期拦截（如边界族本身）——该残余由 §17「对应激活 + 未表达不误判」纪律显式 sanction，与 #244 先例同构（C5(c)：`maxUpdateBytes: 32KiB` 下缺省 `maxChunkedUpdateBytes` 4 MiB > 64 × 32 KiB 同样不被拦截），且运行期首 chunk 声明校验（§8.1/§9.2/§10.3 L340 按 kind 聚合上限）仍对实际 transfer 生效——资源安全不受损，属已批语义非冲突。

**出口登记**：若后续评审裁定采纳宽门，须三层同步修订（协议 §17 L615 补「或」子句 + 修订锁定契约 C2/C3 边界族 + SA6 §15.4 自身「同步修订本契约」出口）——任一层单独改动都会制造新的规范-契约冲突；当前三层现状下窄门是唯一一致读法，D6 裁决成立。

## 3. 交叉 ADR 检查

- **ADR 0010**（基线架构）：设计零 envelope/ACK durability/identity fencing/backpressure 分层/停机顺序触碰（DENY 列表锁 `update-transfer.ts`/`update-channel.ts`/`hub-namespace.ts`/`peer-namespace.ts`/`frame-io.ts`；零状态机变化）——一致。
- **ADR 0012**（实例身份）：0x42 payload 零身份字段新增（绑定块是数据成员且内容核对属后续切片）——零交集。
- **ADR 0011/0014**（诊断日志）：非 observer 票，§23.1 第 29–36 型零触碰（R36）——零交集。
- **ADR 0001–0009/0016–0018**（VFSL/投影/持久化/运行时/Registry/schema 生命周期）：文件范围仅 `replication-protocol` codec/类型与 `ws-replication` 配置面——零交集。
- **apps/yjs-server** 维持家族级配置文件滞后并登记 follow-up（§13-2）——与 #243/#244 先例一致，非本切片契约面。

## 4. 复核注意项（非阻塞；编号接续前置门禁 R32–R37）

- **R32 · 【轻微冲突·接续】issue 标题文本仍与 ADR 0022 冲突**：标题「…CAP_CHUNKED_SYNC 协商、0x42 kind 双形态 codec…」仍逐字命中 ADR 0022 明确拒绝方案 #1（L87）与 CONTEXT.md「同版本部署假设」Avoid 条。设计已按正文/AC 单形态落地（§1 非目标显式废弃标题措辞）——不阻塞；建议 reporter 改题（如「0x42 kind 首字段单形态 codec、聚合上限配置链」）并在派发词中声明标题废弃。仓内规范文档零「双形态/CAP_CHUNKED_SYNC」命中（维持）。
- **R38 · 激活门歧义裁决登记（§2.4）**：D6 窄门经三层核实为唯一一致读法；SA6 散文宽门读法属 evidence 层内部不一致，不构成规范冲突。SA2/SA4 评审不得据 SA6 §10/§15.4 散文要求实现宽门——那会破坏锁定契约 C2/C3 并与 §17 L615 字面冲突；若确要宽门，走 §2.4 出口的三层同步修订。
- **R39 · §22 L701 收口措辞精度（D10 落地约束）**：该句同时预告「golden vectors **与传输层测试资产**由实现 ticket 交付」。本切片交付的是 codec 层向量（改写后 3 golden + 契约冻结向量 `KIND1_FIRST`/`KIND2_FIRST`）；**传输层 kind=1/2 资产属 §8.1/§9.2 后续切片、本切片不存在**。收口措辞必须区分两者（「已交付」声明限定在 codec 向量面，传输层资产维持待交付表述），否则违反 docs/AGENTS.md「documentation-only wording changes must not invent implementation behavior」；同时保留 §22 内 `0x42`、`0x00000001` 与四个资产文件名锚（`codec-issue246-doc-contract.test.ts` D4-1/D4-2 依赖）与 L707「实现不得改变本文字段顺序和消息语义」义务。
- **R40 · 必填成员破坏性演化的实现期核对**：`transferKind` 必填使全部 `UPDATE_CHUNK` 构造点编译期表态——§10 矩阵已穷举（两包生产 + 8 个 ws 测试 + protocol 测试资产），实现须以 `grep -rl "kind: 'UPDATE_CHUNK'"` 复核清单零遗漏并以根 `pnpm typecheck` 收口（风险 2 缓解成立的前提是清单完备；无仓外消费方经本次实测复合：包未发布、PR #241 OPEN）。
- **R41 · D8 接收面中间态残余（已登记，非冲突）**：本切片接收层不消费 `transferKind`，kind≠0 帧若到达将流经 live 路径——同版本部署下结构性不可达（本版本端点不发 kind≠0；v1 代际端 0x42 pre-parse fatal；旧六字段首字节 0x23 被_kind ∈ {0,1,2}_ 拒绝），且 kind 分派/按 kind 聚合上限/绑定块内容核对显式属 §8.1/§9.2 后续切片（SA6 §12 范围边界 + issue 切片计划）。设计已显式登记不可达性论证而非静默——SA2 可就「中间态暴露面」攻击，但规范终态契约未因此被违反；实现须保证测试不构造 kind≠0 帧经传输层（D8 已声明）。

## 5. 结论

**设计后复审通过（clear）**。SA1 设计是 ADR 0022 + 协议目标契约的忠实履行设计，四个聚焦面全部与基线逐条同源：公共 API 类型变更是 additive-with-required-member 的设计面裁决（命名/必填性无基线约束且与 wire 恒在语义互证）；0x42 字段序与 §5 L116/§10.3 L313/L323 逐字一致；绑定块 iff 规则与 encode/decode 同套纪律一致且值域边界正确收在 §8.1/§9.2 之前；聚合上限激活门的窄门裁决经「协议 §17 L615 字面（『对应…生效』+ 无『或』子句 + 未表达不误判）→ 可执行契约 C2/C3 边界族数学强制 → C5a 经 #244 链②满足」三层核实为唯一一致读法，SA6 散文宽门是 evidence 层内部不一致、已被 SA1 正确处理并诚实登记。唯一冲突仍是 R32 的 issue 标题文本（正文为准、不阻塞、建议改题）。R38–R41 为设计与实现边界的非阻塞登记项，转交 SA2/SA4 参考。**无需设计修订**——`requiresConflictRecheck = false`。

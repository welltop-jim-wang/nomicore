# SA2 设计攻击评审 — issue #245：ws-replication 分块传输 observer 事件（issue #233 切片 4）

- Dispatch：`sa-a193a35c-e0f9-49af-9526-775102b652a2`（mabf-sa2 / design-review / iteration 1——F1 修订版复审）
- 评审对象：SA1 设计 `wiki/raw/task_issue-245_design.md`（dispatch `sa-15652a57-…`，iteration 1，按前轮 F1 修订）
- 前轮评审：本文件 iteration 0（dispatch `sa-f0ad20cb-…`，verdict **reject**：1 × MAJOR F1）——F1 处置见 §13
- 工作区：worktree `nomicore-fix-issue-245`，分支 `mabf/issue-245`，HEAD `733b3a7`（本轮 `git status` 复核：
  生产代码与 docs 零改动，工作树仅含任务产物未跟踪文件——SA1 iteration 1 为纯设计文本修订，与 §14 自述一致）

## 1. Reviewed inputs（实读）

| 输入 | 状态 |
|---|---|
| Host 简报 `wiki/raw/task_issue-245.md`（issue body AC1–AC6；`## Comments` 空节） | 实读；本 dispatch 声明 Issue 评论 REST 快照 = `[]` 且无 owner 评论要求需并入——与简报/SA6 §2/SA8 两门禁四方一致 |
| SA1 设计 `wiki/raw/task_issue-245_design.md`（iteration 1，596 行——§8.6(d) 升格 + 新增 §8.6.1 + §1/§4/§11/§12/§13/§14 修订） | 实读（全文） |
| SA6 验收契约 `wiki/raw/task_issue-245_sa6_contract.md`（approve；契约文件 10 用例 R1–R5/N1–N5） | 实读（含冻结键集 SENT/APPLIED/ACKED/ABORTED_KEYS 与 LIMITS/BIG 构型） |
| SA8 前置门禁 `artifacts/sa8-conflict-gate-issue-245.md`（clear；R20–R25；C1–C9 逐条对照含 C8 时钟折叠/C9 §23.7 映射） | 实读 |
| SA8 设计后复审 `artifacts/sa8-conflict-gate-issue-245-design-recheck.md`（clear；四焦点 + R26–R28） | 实读 |
| 契约红灯文件 `packages/ws-replication/test/ws-replication-issue245-ac-red.test.ts`（L40–250 本轮复核：LIMITS 8KiB L77–82、BIG ≈20KB→3 chunk L88–89、expectKeysExactly L165–169、四键集字面量 L174–185、六 reason 闭集 L186–193、APPLY_FORM_TYPES 四形态 L195–200） | 实读 |
| §23.7 正典文件 `packages/ws-replication/test/ws-replication-observer-red.test.ts`（1773 行，本轮重点复核：observedBoot 定义 **L136（测试文件内局 helper，非 harness）**、ObservedOptions 含 limits/maxUpdateBytes L113–134、ManualClock L54、saveGate 用例族 L775–800；ALLOWED_KEYS 22 行 L1145–1176、assertSafe 无白名单直接红 L1178–1181、数值键清单 L1203–1219、全矩阵场景 L1270–1303（expectedTypes L1295–1299；GOAWAY/1006/stop 收口相位 L1283–1287）、T12 describe L1484：注入 clock 用例 L1485（saveGate 门闩 + 双钟 advance(25) + applyLatencyMs/ackLatencyMs === 25）、无 clock 用例 L1517（手工构型 `createHubReplication`/`createPeerReplication`，「无 clock」注释锚 **L1531/L1545**，`in === false` 断言 L1561/1567） | 实读 |
| 源码锚点复核（本轮独立重打）：`update-channel.ts` sendOneChunk 末 chunk 结算（inFlight.set→noteUpdateSent→armAckTimer 序，L429–445）+ onAck（L178–207，zombie L202–205 零事件）；`update-transfer.ts` UpdateChunkAcceptResult.complete `{bytes}` L56–62 + completeIfExact reset 前返 L164–172；`hub-namespace.ts` applyRemoteUpdate 签名 `(update, sequence, isStep2=false, syncRoundId?)` L1114–1118、t0/t1 门控采样、isStep2→update-applied 发射分叉 L1182–1193、handleAssemblerResult 'complete' 单行调用 L744–751、HB9' 注释（hub 无 degraded）L1167、facet onUpdateAcked/onUpdateSent L1056–1085；`peer-namespace.ts` 孪生（degraded 分支先于 t1/isStep2 分叉 L1389 起、发射体 L1414–1426、facet L1270–1300）；`hub-connection.ts:543`/`peer-connection.ts:166` now 绑定 observer 门控；`peer-connection.ts:384-385` chunkedUpdate opt-in 旋钮（HELLO optionalCapabilities）；`observer.ts:34-44` 隔离分发单点；`types.ts` 第 23 型 aborted L661–684 | 实读 |
| 规范：ADR 0013 L83–94（四型键集冻结表逐字复核）；`docs/protocols/instance-replication-v1.md` §23.1（L669 词汇 23 型、L725 aborted 行尾句「#245 计划项」、L727–729 互斥三选一）、§23.4（L811「field 缺失，非 undefined 值」+ clock-throw 折叠）、§23.7（L879 起框架，含「无 clock 时 latency 字段缺失、有 clock 时 ≥ 0」） | 实读 |
| 存量翻转面：`ws-replication-issue243-chunked-live.test.ts` K1（L556–640 三普通族断言实证）；`ws-replication-issue243-sa7-dynamic.test.ts` S1 fake host 只复制 `{sequence,bytes}`/`{bytes,sequence}`（L124–129 实证）；`ws-replication-api.test-d.ts` 联合枚举 L239–267（标题「22 型」vs 实际 23 成员——N-O4 漂移在库） | 实读 |
| `wiki/raw/task_issue-245_relevant_decisions.md` / `_conflict_report.md` | 不存在（SA6/SA8/前轮同认；等价产物 = SA8 门禁两份） |

评审方法：本轮为 **F1 定向复审 + 全清单复扫**。(a) 对 F1 修订链（§1 目标 6 → §4 AC6 行 → §8.6(d) → §8.6.1 两腿 → §11 ALLOW 行 → §12 两证据行 → §13 残余删除 + 护栏行 → §14 映射 → SA4/SA7 验收口径）逐节核验「必交付」语义无残留降级措辞（grep 推荐/非阻塞/follow-up 全文扫描）；(b) 对两腿的可执行性做构型级攻击（fixture 能力、门闩机制、断言形态、失败模式）；(c) 对 iteration 0 已认可面（键集/改道/互斥/seam/调用方/范围）按 §14「逐字保持」主张抽验源码锚点；(d) 按技能清单六面复扫。

## 2. Verdict

**approve** —— 0 × BLOCKER，0 × MAJOR。前轮 F1（AC6「时钟折叠策略」子项被降级为可选）已完全解决：
§23.7 canonical clock-folding conformance 对 chunked 事件现为**必交付、可执行、范围正确**（详见 §12/§13）。
1 × 新增非阻塞观察（N-O6：分块大写的 fixture 构型约束——响亮红失败模式，不阻断）。

iteration 0 已独立核验通过的工程面（键集裁决、改道路由、互斥判别顺序、通道 seam、双侧孪生、调用方矩阵、
ALLOW/DENY、aborted 保持面）在本版逐字保持（§14 主张与本轮锚点抽验一致），不重复展开——下文仅记差异与
本轮新证。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1 四型键集冻结 + 白名单断言 + safe-field 深扫 | §7 DD1、§8.1、§12 | 成立（iteration 0 结论维持；本轮复核 §8.1 三型键集 vs 契约 SENT/APPLIED/ACKED_KEYS 与 ADR 0013 L89–91 三方逐字零差集） |
| AC2 observer 每事件必 throw 逐字节等价 | §9.1 | 成立（`observer.ts:34-44` 单点隔离在库；发射点均在记账落定后——本轮重验 sendOneChunk/onAck/applyRemoteUpdate 代码序） |
| AC3 无 observer 零事件/零投影/零时钟；latency 两态 | §9.2 | 成立（`hub-connection.ts:543`/`peer-connection.ts:166` now 门控本轮重验；两态执行面现在除契约 R5/N1 外新增 §23.7 正典两腿——见 AC6 行） |
| AC4 互斥第四形态（每笔成功 apply 恰一） | §7 DD2、§8.3/§8.4 | 成立（hub/peer 分叉结构与实测代码一致；isStep2 ∧ chunked 结构性不可达经调用点穷举维持） |
| AC5 aborted reason 闭集/计数不变量（保持面） | §7 DD0、§12 N4 | 成立（第 23 型生产面零触碰；六 reason 闭集 = 契约 L186–193 本轮复核） |
| AC6 §23.7 conformance 增补——「事件矩阵 key-set 冻结」+「时钟折叠策略」**两子项** | §8.6(c) + **§8.6.1 (d-i)/(d-ii)** + §1 目标 6 + §4 + §11 + §12 | **成立（F1 已解决）**。key-set 半边：白名单 3 行 + 数值键 + 矩阵 chunked 腿 + expectedTypes 追加三新型（落点 L1145–1176/L1203–1219/L1270–1303 均实测在库）。时钟折叠半边：§8.6.1 两腿钉死在 T12 两用例（L1485/L1517 实测锚点命中），(d-i) 注入 clock 在场态专属断言（含 sent 恒无 latency 键）、(d-ii) 无 clock 缺场态整键缺失断言——与 SA8 C8→§23.7 L884–885「无 clock 时 latency 字段缺失、有 clock 时 ≥ 0」逐字对齐；「不得以契约文件替代 AC 指名位置」的验收口径成文（§8.6.1 末段） |
| 目标/非目标未静默扩大或收缩 | §1 | 成立（非目标五项与 DENY/DD0/DD1 一致；本版唯一增量 = §23.7 两腿交付义务，落点在既有 ALLOW 文件内，零范围扩张） |

## 4. Owner评论覆盖

Issue comment REST 快照 = `[]`（本 dispatch 声明经刷新复核返回空数组；简报 `## Comments` 空节、SA6 §2、SA8
两门禁 §1 四方一致）。零 owner 评论要求/豁免需要并入——要求源 = issue body 六条 AC + ADR 0013/§23 冻结面。
设计 §4 已如实登记。无遗漏输入。

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| （无） | — | — | 空集 |

## 5. 上游事实与SA8约束

iteration 0 的红/绿映射（R1–R5、N1–N5、预期翻转存量）在本版逐字保持且本轮锚点抽验一致，不再重复。差异项：

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA8 C8/C9：AC3 后半与 AC6 措辞逐字映射 §23.4 L811 / §23.7 L879–885 既有框架 | §8.6.1 两腿 + §8.6(c) 矩阵腿 | **落实（本轮新验）**：§23.7 正典文件对 chunked 族 latency 键现有两态可执行验收路径（此前为 F1 缺口） |
| SA8 R26（矩阵 chunked 腿 aborted 暴露面） | §6 R26 行 + §8.6(c) 备注 | 落实（从 iteration 0 的「未记载」升格为 §6 表内行 + (c) 备注：腿置于收口相位前收敛，或补 aborted 白名单行 + receivedChunks/receivedBytes 数值键）。矩阵收口相位序（GOAWAY L1283 → close 1006 L1285 → stop L1287）本轮实测——纪律落点真实 |
| SA8 R27（sendQueueMs 二选一） | §6 R27 行 | 落实为登记义务（SA8 裁定实现轮决策；任一形态须保持 N1/N3 绿） |
| SA8 R28（§23.1 三新行携带改道归零措辞） | §6 R28 行 + §8.6 协议行 | 落实为 R24 落地措辞义务 |
| SA8 R20–R25 | §6/§7/§13 | 落实（与 iteration 0 相同；本版零触碰） |
| 前轮 N-O1/N-O2/N-O3/N-O4/N-O5 | §6 + §8.6(c) 备注 + §8.6 api 行 + §8.6.1「两态分工成文」段 + §14 映射表 | 全部并入（N-O5 两态分工已成文：矩阵腿=在场态通用数值检查、(d-i)=在场态专属断言、(d-ii)=缺场态——三处合并即 §23.7 L884–885 完整两态覆盖） |

## 6. 设计内部一致性

- **F1 修订链无残留降级措辞**：全文 grep「推荐/非阻塞/follow-up/可选」——命中项全部合法（DD3/DD5 的可选
  参数、R27 sendQueueMs 死代码清理「可选」、残余 1 = 表外键扩展、残余 2 = R25 条件项、R26–R28 非阻塞注意项、
  §13 护栏行自述）；时钟折叠腿无一处以可选/follow-up 语义出现。§13 尾注显式声明 iteration 0 的 follow-up 项
  「不再属于残余问题」。
- **交叉引用闭合**：§8.6(d)→§8.6.1；§8.6.1→§8.6(c)（chunked 选项）；§1 目标 6→§8.6(c)(d)/§8.6.1；
  §4 AC6 行→§8.6(c)+§8.6.1(d-i)/(d-ii)+§11/§12；§11 observer-red 行→§8.6.1；§12 两 AC6 证据行→§8.6(c)/§8.6.1；
  §14 F1 行枚举的修订位置逐一存在且内容相符。无死引用、无前后相反描述。
- **「附录承认但正文未改」形态**：本轮专项检查（前轮 F1 即此形态）——§8.6(d) 行内已改写为必交付并内联指向
  §8.6.1，正文表内无任何「推荐」标记残留。未发现新实例。
- **锚点真实性**：本轮独立重打的全部行号锚点（见 §1）命中现实码；§8.6.1 所引 T12 两用例 L1485/L1517、
  「无 clock」注释锚 L1531/L1545、saveGate 机制、矩阵 expectedTypes L1295–1299、契约 LIMITS/BIG L77–98、
  `peer-connection.ts:384-385` 旋钮均与代码逐字一致。
- iteration 0 已验的键集/路由/互斥/调用方一致性主张在本版逐字保持（§14），本轮抽验无反例。

## 7. 状态机与并发攻击

iteration 0 的 S1–S9 攻击矩阵（单 transfer、zombie ACK、发送侧弃置、resync/teardown、transferId 作用域、
无 observer 收口、同步重入、窗口内并发限内写、单 chunk transfer）在本版全部维持——修订仅增加测试交付义务，
零新增生产状态机面。本轮补充攻击：

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S10 | T12 注入 clock 分块腿：saveGate 门闩悬挂 hub apply（chunked 来源） | 双钟 advance(25) 后释放门闩 | chunked-update-applied.applyLatencyMs / chunked-update-acked.ackLatencyMs 确定性 = 25 | 无——分块 apply 经 assembler complete → 同一 `applyRemoteUpdate` → 同一 session/sequencer/save 管线（hub L744–751 单行调用点 + L1114 起管线实测），门闩确定性结构性转移；既有普通族用例（L1485–1515）已证机制有效 | — |
| S11 | T12 无 clock 分块腿：时钟缺面 | 分块 transfer 全程 | 三 chunked 成功型事件仍发（observer 在场、clock 缺席不抑制事件仅抑制键）；两 latency 键整键缺失 | 无——发射门控 = observerOn（facet 首行），时钟仅经 t0/t1/sentAt 条件附着；既有无 clock 用例（L1517–1569）已证该形态于普通族 | — |
| S12 | 矩阵 chunked 腿（协商位开、8KiB 限）| 限内小写与超限大写并发/穿插 | 小写走普通族（≤ maxUpdateBytes 单帧）、大写走 chunked 族——expectedTypes 双族并存 | 无——通道 chunkable 判据 = `byteLength > maxUpdateBytes`（既有），双族并存由构型几何保证（这正是 8KiB+大写几何的必要性，见 N-O6） | — |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1–E6 | （iteration 0 全表：apply 失败族、observer throw、clock throw、重组违例、出站拒绝、文档先行） | 同 iteration 0（零改动面维持） | 无 | — |
| E7（=前轮 F1） | 实现轮跳过 §23.7 时钟折叠腿 → AC6 具名子项失去正典证据 | **已修复**：§8.6.1 升格必交付 + §13 护栏行（「F1 教训固化为门禁」）+ §8.6.1 末段 SA4/SA7 验收口径（「缺任一腿即 AC6 不满足，不得援引契约文件替代」） | 无——跳过路径在设计层已被三重封死（目标/交付义务/验收口径） | — |
| E8 | 矩阵 chunked 腿被弱化实现（如删既有 expectedTypes 普通族成员以求绿） | §8.6(c) 措辞 =「expectedTypes **追加**三新型」+「全矩阵场景**加一条**腿」（append-only 语义钉死） | 低：弱化实现会造成 §23.7 conformance 覆盖回退，SA4/SA7 以 expectedTypes diff 可见；非设计缺口 | — |

## 9. 契约影响审查

iteration 0 全表维持（`UpdateChannelHost` 信息加宽、inFlight 条目标记、`UpdateChunkAcceptResult.complete`
加 chunkCount、`applyRemoteUpdate` 第 5 参、判别联合 23→26、K1 授权翻转、未协商存量结构性不受影响）。
本轮增量：

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| T12 两用例（§23.7 正典）从「只断言普通族」扩为「普通族 + 分块腿」 | 无：两用例为文件内局 `it(...)`，无外部消费者；Collector.of/lastOf 按 type 过滤对新型即用（types.ts 追加后 `Extract<>` 编译面同步） | observer-red L1484–1570 结构实测 | — |
| observedBoot 增设 chunked 选项 | 无：observedBoot 为 observer-red **文件内局 helper（L136）**，非共享 harness 导出——选项扩展零外部调用方 | L136 实测；harness.ts 导出面零触碰 | — |

## 10. 架构一致性与惯例审查

iteration 0 的责任归属/相似能力/单一事实源/生命周期对称/平行机制五面结论维持（修订零生产面变化）。
本轮增量核对：

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| §23.7 时钟折叠两态验收 | §23.7 正典 conformance 文件（仓库惯例：#238 先例——latency 承载面新增时在 T12 建两用例） | §8.6.1 两腿钉死于 T12 两用例 | 正确（正典位置而非契约文件替代——F1 修复即归位此 Owner） |
| 分块构型几何（limits + 大写） | 测试文件内局（observedBoot 选项 / 用例内构型） | §8.6(c)/§8.6.1 | 正确（零生产代码；见 N-O6 构型约束） |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| #238 T12 时钟两用例（普通族） | saveGate 门闩 + ManualClock advance + `in === false` 断言形态 | 同机制扩分块腿（非新测试机制） | 一致 | 复用既有 conformance 框架；零平行断言通道 |
| 契约文件 R5/N1（时钟两态行为面） | CountingClock + exact-keyset | §8.6.1 明确定位为「行为面双保险」，AC6 验收以 §23.7 两腿为准 | 一致（互补非重复） | 契约冻结不适配；正典文件承担 AC 指名位置 |

### 单一事实源 / 生命周期对称 / 平行机制

无变化（iteration 0 结论维持）：两腿复用既有 fixture/门闩/收集器，无第二套事件观测机制、无镜像计数、
无新生命周期面。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW LIST 9 项（与 iteration 0 逐字相同——F1 修订零扩张） | §11；F1 全部改动落在既有 ALLOW 文件 `ws-replication-observer-red.test.ts` 的交付义务描述内 + 设计文本 | — |
| observer-red 行从「（d）可选」改为「T12 两用例分块腿（§8.6.1，**必交付**）」 | §11 表 | —（义务强化非范围扩张） |
| DENY：契约文件冻结 / 发送状态机 / ADR / index.ts、testing.ts / 冻结套件 | §11 DENY 表与 iteration 0 相同；本轮 git status 复核生产面零改动 | — |
| `packages/ws-replication/test/harness.ts` 不在 ALLOW（共享 fixture 面） | ALLOW LIST 无此行；SCHEMA_ENVELOPE（harness L165，`type ROOT = { n: number; ext?: number; extra?: number; }`）为共享常量 | 设计未要求改 harness（observedBoot 为文件内局）——合规；构型约束见 N-O6 |
| follow-up（§13）不掩盖必要项 | 残余 1（表外键扩展）确属 R22 路径登记；残余 2 = R25 条件项；时钟腿已显式移出残余（§13 尾注） | — |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1–AC5 | 契约 R1–R5/N1–N5（运行时事件对象断言；入口真实） | 无（iteration 0 结论维持） | — |
| AC6 §23.7 —「事件矩阵 key-set 冻结」 | §8.6(c)：白名单 3 行 + 数值键（transferId/chunkCount/totalBytes）+ 矩阵 chunked 腿 + expectedTypes 追加三新型（「不得为死行」自检） | 无 | — |
| AC6 §23.7 —「时钟折叠策略」（**F1 修复核心**） | §8.6.1：(d-i) T12 注入 clock L1485 起分块腿——saveGate 门闩确定性，断言 applied.applyLatencyMs/acked.ackLatencyMs 在场（`in === true`）、`Number.isFinite`、≥ 0，且 sent 键集无任何 latency 键（`in === false` 或等价 exact-keyset）；(d-ii) T12 无 clock L1517 起分块腿——三型仍发 + 两 latency 键整键缺失（`in === false`，§23.4 L811「非 undefined 值」纪律） | 无——两腿均落在 AC 指名的 §23.7 正典文件内，断言观察运行时事件对象而非源码文本；机制（门闩/手工无 clock 构型/注释锚）本轮逐一实证可执行 | — |
| 两态覆盖完备性 | 矩阵腿（observedBoot 缺省 ManualClock = 有 clock 态，数值键通用检查）+ (d-i)（在场态专属 + sent 恒无时延键）+ (d-ii)（缺场态）＝ §23.7 L884–885 完整两态 | 无（N-O5 分工已成文于 §8.6.1） | — |
| SA4/SA7 验收口径 | §8.6.1 末段：「矩阵腿与 (d-i)/(d-ii) 两腿全部在 observer-red 内存在且绿——缺任一腿即 AC6 不满足，不得援引契约文件替代 AC 指名位置」 | 无 | — |
| 授权翻转存量 / 类型面 / 门禁链 | K1 改写 + api 枚举同步（编译红自 enforcing）+ §12 末行包 AGENTS.md 门 | 无（iteration 0 结论维持） | — |

## 13. Required revisions

无（0 BLOCKER / 0 MAJOR）。

**前轮 F1 处置记录**（ID 保留用于修订映射；不再为阻断项）：

| Finding ID | 前轮裁决 | 本轮处置 |
|---|---|---|
| F1（MAJOR，iteration 0） | AC6「时钟折叠策略」子项被 §8.6(d) 标「推荐非阻塞」、§13 列 follow-up、§12 证据行只列矩阵腿——§23.7 正典文件对 chunked 族时钟两态无可执行验收 | **已解决并核销**。逐条对照前轮修复要求：(i) 注入 clock 用例分块腿——§8.6.1(d-i) 钉死（在场/有限/≥ 0 + sent 无时延键）；(ii) 无 clock 用例分块腿——§8.6.1(d-ii) 钉死（整键缺失 + 三型仍发）；(iii) §12 AC6 行拆两子项证据行 + §13 残余 2 删除（留改写说明）。前轮接受条件「修订后的设计明确 (d) 为必交付；实现轮 SA4/SA7 验收 AC6 时两态证据均可指向 §23.7 正典文件自身」——§1 目标 6、§8.6(d)、§8.6.1 标题与末段、§11 ALLOW 行、§13 护栏行五处「必交付」语义一致成文，SA4/SA7 口径显式禁止以契约文件替代。修复全部位于既有 ALLOW 文件交付义务 + 设计文本，零范围扩张、零生产面变化、零 ADR 冲突面变化 |

## 14. Non-blocking observations

1. **N-O6（本轮新增——分块大写的 fixture 构型约束）**：§8.6(c) 矩阵腿与 §8.6.1 两腿均需「一笔大写
   （> maxUpdateBytes，≈20KB → 3 chunk，同契约 LIMITS/BIG 几何）」。约束：observer-red 的 fixture 链经
   `makeHubNamespace` → 共享 `SCHEMA_ENVELOPE`（`test/harness.ts` L165：`type ROOT = { n: number; ext?:
   number; extra?: number; }`——**纯数值字段**），且 `test/harness.ts` 不在 ALLOW LIST（不得为加字符串字段而
   改共享 fixture）。因此 ≈20KB 业务写**不能**经 observedBoot 缺省 fixture 或 T12 无 clock 用例的
   `makeHubNamespace(hubNode, {owner})` 构造；naive 实现的失败模式均为响亮红而非静默漂移：(a) 8KiB 限 +
   小写 → 零 chunked 事件 → expectedTypes 红（「缺事件 chunked-update-sent」，同时触犯设计自设的「白名单行
   不得为死行」）；(b) 极低 maxUpdateBytes → 全部写改道 → 矩阵普通族 expectedTypes（update-sent/applied）红。
   文件内可行构型（零范围扩张，均有同文件先例）：observedBoot chunked 选项以**文件内局 schema envelope**
   （含字符串字段，先例 = sentinel 用例 L1317–1334 直接 `registry.create` 自定义 schema）构造 fixture，使
   ≈20KB 字符串写命中契约几何——矩阵腿必须走此路（保普通族 expectedTypes 双族并存，S12）；T12 两腿无
   expectedTypes 约束，低限几何亦可接受（小写 > 低限即分块），但 (d-i) 的「同契约几何」措辞下仍以大写构型
   为正解。建议 SA3 实现时在 §8.6(c)/(d) 落地说明中钉死所选构型车辆。
2. **N-O1→N-O4 承接状态**（iteration 0 遗留）：N-O1（R26 aborted 暴露面）已升格入设计正文 §6/§8.6(c) 备注；
   N-O2（sendQueueMs 二选一）维持实现轮定死纪律；N-O3（R28 措辞）已并入 R24 义务；N-O4（api.test-d 标题
   计数漂移「22 型」vs 23 成员）已在 §8.6 api 行登记为实现轮同步项（L239 实测标题仍在，追加三成员时改 26）。
3. **N-O5**：两态分工（矩阵腿在场态 / (d-i) 在场态专属 / (d-ii) 缺场态）已由 §8.6.1 成文——本轮核销为已解决。
4. 设计 §8.2/§10 对 peer degraded 窗口 chunked apply 维持 `degraded-bypass-applied{sequence=末 chunk 帧序}`
   的表述与现行代码吻合（peer 实参来源本轮重验）；实现时该 sequence 键是 #238 既有追加（非 DD1 排除对象——
   排除仅约束 chunked 族键集），勿在 chunked 族以外误删（iteration 0 遗留提示，维持）。

---

**结构化裁决**：`approve`（0 BLOCKER / 0 MAJOR；前轮 F1 已解决核销）。`requiresConflictRecheck: false`——
F1 修复仅触及既有 ALLOW LIST 测试文件（`ws-replication-observer-red.test.ts`）的交付义务与设计文本，
零键集/改道路由/互斥顺序/wire/持久化/状态机变化，SA8 设计后复审四焦点结论不受影响；R25 条件项照旧。
`pass` 仅表示设计通过审查；实现与活链路验证归后续 SA4/SA7。

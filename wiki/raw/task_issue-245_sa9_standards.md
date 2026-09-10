# SA9 标准评审 — issue #245：ws-replication 分块传输 observer 事件（issue #233 切片 4）

- Dispatch：`sa-1da351bd-abfb-46a9-b31a-b9314b1f4411`（mabf-sa9 / standards-review / iteration 0）
- 评审对象：committed HEAD `a7c1add7b06c6023d84a674e73df4cec0f99fa05`（`feat(ws-replication): observe chunked update lifecycle`，单提交，父提交 = 权威父 PR #241 head `733b3a757f37459838bd88bf7952b7215540a1d9`——`git merge-base --is-ancestor` 实测为祖先，工作树对 HEAD 干净，仅 host 简报 `wiki/raw/task_issue-245.md` 未跟踪）
- 评审范围（SA9 职责）：仓库 AGENTS/ADR/模块责任/既有架构惯例/单一事实源/生命周期对称性/文件范围/测试质量标准 + 安全与兼容性；**不**复核 Issue 需求实现完备性（归 SA10）、不重跑测试（以 SA3 日志 + SA4 独立重跑为证据面并逐项核对其与 HEAD 树同一性）
- Owner 评论：REST 快照 `[]`（dispatch 声明；简报 `## Comments` 空节、SA2/SA4/SA6/SA8 五方一致）——零 owner 评论要求需并入

## 1. Reviewed inputs（实读/实测）

| 输入 | 状态 |
|---|---|
| HEAD 提交元数据 + 祖先关系 + 工作树状态 | 实测（`git log`/`merge-base`/`status`） |
| HEAD 全量 diff（已跟踪改动 18 文件：src 5 + test 4（含新契约文件）+ 协议 1 + wiki/artifacts 8） | 实读（src 5 文件逐 hunk；observer-red 20+ hunk；api.test-d/K1/协议 diff 全文；契约文件关键段：键集字面量 L174–185、R3 锚 L917–921、N5 收窄 L800–813、用例清单） |
| SA1 设计（iteration 1）`task_issue-245_design.md` | 实读（全文 596 行） |
| SA2 复审 `task_issue-245_sa2_review.md`（approve，0B/0M） | 实读 |
| SA4 实现后红队评审 `task_issue-245_sa4_review.md`（approve，1 × 流程债 F1 非阻断） | 实读 |
| SA6 契约 `task_issue-245_sa6_contract.md` + 红灯/验证日志 `artifacts/sa6-issue245-verify.log`、`artifacts/sa3-issue245-verify.log` | 实读 |
| SA8 两门禁 `artifacts/sa8-conflict-gate-issue-245.md`（clear，R20–R25）/ `-design-recheck.md`（clear，R26–R28） | 实读 |
| 规范基线：ADR 0013 L83–94 键集冻结表；`docs/protocols/instance-replication-v1.md` §23.1/§23.4/§23.7（HEAD 文本） | 实读 |
| 仓库契约：根 `AGENTS.md`、`packages/ws-replication/AGENTS.md`、CONTEXT.md 相关词条 | 实读 |

## 2. Verdict

**approve** —— 0 × BLOCKER / 0 × MAJOR；1 × MINOR 流程债（M1：契约 facilitation 的 SA6 追认未落盘，承自 SA4 F1）+ 2 × 观察项（不阻断）。

实现与批准设计（iteration 1）的裁决面逐项吻合：键集 = ADR 0013 L89–91 逐字 + §23 信封；改道路由（R21）三结算点全部落地且普通族逐字节不变；互斥判别全序（degraded → isStep2 → chunked → update）双侧孪生一致；时钟折叠两态；aborted 保持面零触碰；规范文档同变更同步。测试证据链（SA3 日志 + SA4 独立重跑）指向与 HEAD 逐位相同的树，门禁全绿。

## 3. 逐轴标准核验

### 3.1 AGENTS.md 合规（根 + 包级）

| 要求 | 核验 | 结论 |
|---|---|---|
| Instance replication 变更以 ADR 0010 + `instance-replication-v1.md` 为规范权威 | 设计/实现/文档同步均以 §23 为基准；协议 §23.1/§23.7 与实现同变更落地（R24） | 合规 |
| Observer seam 注入、隔离与 close 分类纪律 | 三新发射点全部经 `host.emitObserver` → `dispatchReplicationObserver` 单点（`observer.ts` 零 diff，grep 实测无 chunked 引用——分发类型无关）；observer throw 静默隔离沿用 | 合规 |
| 零 wire 变化（不改 codec/协商位/ACK 语义） | `packages/replication-protocol/**` 零 diff（diffstat 实测）；ACK = 末 chunk 帧序单 ACK 复用 | 合规 |
| 导出面经 `src/index.ts`；testing 面克制 | `index.ts`/`testing.ts` 零 diff（实测）；三新型为既有导出联合的成员，零新符号 | 合规 |
| 包级验证门（焦点套件 → 全包 → 包 tsc → 根 typecheck/test） | SA3 日志 (b)–(g) + SA4 独立重跑逐项一致：契约 10/10、observer-red 32/32、全包 64 文件 472/472、包 tsc exit 0、根 typecheck exit 0、根 302 文件 3235/3235、`git diff --check` exit 0 | 合规（证据在库可复核） |
| typed-writes 强制面 | 测试辅助 `writeHub/writePeer` 沿用该测试文件既有 `mutateData({op:'set', path:[key]})` 动态构型（diff 仅加宽形参类型 `blurb?: string`，未引入新模式）；生产代码无 Namespace 写路径变更 | 合规（无新增背离） |

### 3.2 ADR 符合性

- **ADR 0013 L89–91 键集逐字**：types.ts 第 24–26 型成员与 ADR 表 + 契约字面量（SENT/APPLIED/ACKED_KEYS L174–177）+ T9 白名单三新行四方独立比对零差集（含 `connectionId?` 信封与 latency 键可选性）。R22 裁决执行正确：无 `sequence`/四段差值/效果组/`sendQueueMs` 键，applied/acked 无 `transferId`，sent 恒无 latency 键。
- **append-only 纪律**：判别联合 23→26 型纯追加（头注释与协议 §23.1 标题同步）；第 23 型 aborted 生产面零触碰（DD0/R20——diff 实测 types/hub/peer 的 aborted 段均不在变更内）。
- **ADR 文本未触碰**（R25）：`docs/adr/**` 零 diff；ADR 0013 维持「提议」状态随父 PR #241 生命周期——正确。
- **协议文档同步（R24/R28）**：§23.1 词汇 23→26 型 + 三新行登记且每行携带「分块 transfer 窗口内对应普通族事件归零（改道）」措辞（R28 措辞义务落实）；aborted 行尾「#245 计划项」句清理为已落地表述；互斥规则三选一→四选一（含 `isStep2 ∧ chunked` 结构性不可达注记）；§23.7 增补含矩阵 key-set 子项、时钟折叠 (d-i)/(d-ii) 子项、degraded×chunked 互斥断言。**文档与实现同变更，无虚构未实现行为**。

### 3.3 模块责任与既有架构惯例

- 发射权属 namespace facet（side/connectionId/observerOn 在 facet 层），通道经既有宿主回调上抛上下文（Option A，#238 先例）——未新增宿主回调、未在 assembler/通道内直接发射。
- `UpdateChannelHost` 信息加宽为可选组（`chunked?`），普通路径回调形状不变——#243 SA7 动态套件 S1 fake host 窄形状（只复制 `{sequence,bytes}`）结构兼容，零改动保绿（SA4 重跑实证）。
- 条件附着展开（`...(x !== undefined ? {k} : {})`）与 `cidField` 复用、`observerOn` 首行早退——与 §23.4 时钟折叠纪律及既有发射体写法逐字同构。
- 发射位置 = 记账/决策落定后（`inFlight.set` → `noteUpdateSent` → `armAckTimer`；onAck 删除/重挂后；apply 结算 observerOn 块内、UPDATE_ACK 之前）——DD6 锚点实测一致；zombie 迟到 ACK 在 `onUpdateAcked` 之前返回（update-channel.ts L218–221），弃置 transfer 零成功型事件。

### 3.4 单一事实源

- 键集单一事实源 = types.ts 判别联合（协议 §23.1 登记 + 契约字面量 + T9 白名单为其投影/断言面，三方一致）。
- 事件字段事实源 = wire `UPDATE_CHUNK` 申报（transferId/chunkCount/totalBytes）与既有记账（inFlight bytes/sentAt、t0/t1）——无第二套计数/镜像状态；assembler `complete` 的 `chunkCount` 于 reset 前捕获 `declaredChunkCount`（DD4），`bytes === totalBytes` 由 Σbytes 既有不变量保证。
- `sendOneChunk` 内 `sendQueueMs` 死代码删除（R27 定死）+ 注释自证；普通帧路径 `sendAndRegister`（L331–346）逐字节不变（diff 实测）。

### 3.5 生命周期对称性

- 零新生命周期面：inFlight 条目生命周期不变（末 chunk 注册 → ACK/弃置删除）；activeTransfer 槽位 1→1 转换不变；`transferId` 作用域（连接, 方向, ns）与 teardown 归零纪律不变。
- 中止↔成功互斥结构保持：中止 transfer 结构性不可达末 chunk 出站/apply/ACK 结算点；N4 保持面绿。
- 收口路径（stop/GOAWAY/断线）零新增挂点；连接层时钟门控（`hub-connection.ts:543`/`peer-connection.ts:166`）零 diff——无 observer = 零时钟调用的结构性保证不受影响。

### 3.6 文件范围（ALLOW/DENY）

- 已跟踪实现/测试/文档改动 10 文件：src 5 + test 3 改动 + 契约 1（新增转跟踪）+ 协议 1 —— 除契约文件外全部 ⊆ 设计 §11 ALLOW LIST；DENY 面逐项零 diff 实测（replication-protocol、hub/peer-connection、ADR、index/testing、harness.ts、#244/#239 等冻结套件、S1 动态套件）。
- **唯一 DENY 越界**：`ws-replication-issue245-ac-red.test.ts`（设计 §11 DENY「契约冻结」+ §8.6「零改动」明文）被 SA3 改动两处脚手架锚（R3 等待锚翻转、N5 全型零断言收窄）——已披露（代码内注释 + sa3 日志 §6）并经 SA4 攻击性核验：结构性被迫（旧锚在目标语义下结构性永不满足/与 R4 结构性互斥）、断言零弱化（N5 反增 hub 侧恰一正断言）、反向仍红（settleUntil 预算耗尽 throw）。见 §5 M1。
- wiki/raw + artifacts 入提交 = 分支既有惯例（父提交 733b3a7 同款），非实现范围扩张。

### 3.7 测试质量标准

- 入口真实：契约文件与 observer-red 均位于 `packages/ws-replication/test/`，根 `vitest.config.ts` include 自动发现；`*.test-d.ts` 经 typecheck 面覆盖。
- 零 `skip/only/todo`、零 `process.env` 覆盖（四改动测试文件 grep 实测）；零兜底分支（SA4 同验）。
- 断言观察运行时事件对象/wire 帧/文档状态（非源码文本）；键集断言为 exact-keyset（`expectKeysExactly` 排序比对）；safe-field 深扫 + JSON.stringify 哨兵保留并扩至三新型。
- 确定性：虚拟时间/fake scheduler、闸门相位、saveGate 门闩、ManualClock advance(25)——T12 (d-i) 精确值断言 (=25) 在门闩确定性下成立；零 real sleep。
- AC6 两具名子项均在 §23.7 正典文件内可执行（F1 教训核验）：矩阵 chunked 腿（激发三新型、白名单行非死行、置于 GOAWAY/1006/stop 收口相位**之前**收敛——R26 纪律 diff 实测落点正确）+ T12 (d-i)/(d-ii) 分块腿（在场/有限/≥0 + sent 恒无 latency 键；无 clock 整键缺失 `in === false` + 三型仍发）——未以契约文件替代 AC 指名位置。
- N-O6 构型约束落实：20KB 字符串写经文件内局 schema（`blurb?: string`），共享 `SCHEMA_ENVELOPE`/harness 未动（diffstat 实测）。

### 3.8 安全与兼容性

- **Safe-field**：三新型字段 = 长度/计数/有界 transferId；零 Yjs bytes/ArrayBuffer、零 Error 原文、零 token/owner/内容；白名单 + 数值有限非负清单（+transferId/chunkCount/totalBytes）覆盖。
- **隔离**：throw 静默隔离单点未动；事件对象 readonly 不可变；无 observer = 零事件构造/零投影读取/零时钟调用（N2 全生命周期含收口）。
- **兼容性**：wire 零变化；observer 联合 append-only（宿主 switch 对未知 type 为新增分支，非破坏）；普通族三事件键集/时机逐字节不变（N1/N3 锚）；存量套件零意外翻转（全包 472 + 根 3235 绿——唯一预期翻转 K1 已获授权并同步）。

## 4. AC 映射（标准面视角；实现完备性归 SA10）

| AC | 标准核验落点 | 证据 |
|---|---|---|
| AC1 键集冻结 + 白名单 + 深扫 | §3.2/§3.8：四方键集一致；T9 白名单非死行自证 | 契约 R1–R5、observer-red T9（SA4 重跑绿） |
| AC2 throw 隔离逐字节等价 | §3.1/§3.3：单点隔离 + 落定后发射 | N3（SA4 重跑绿） |
| AC3 无 observer 纪律 + latency 两态 | §3.5：连接层门控零 diff；条件附着整键缺失 | N2 + T12 (d-i)/(d-ii)（绿） |
| AC4 互斥第四形态 | §3.3：双侧判别全序实测（peer L1431–1483 / hub L1231–1244）；chunked 分支不展开 base | R2/R4/N5（绿） |
| AC5 aborted 保持面 | §3.5/§3.6：生产面零触碰 | N4 + #244 两套件（绿） |
| AC6 §23.7 两子项 | §3.7：两腿在正典文件内存在且绿 | observer-red 32/32（SA4 重跑逐名核验） |

## 5. Findings

### M1（MINOR，流程债——不阻断）——DENY 冻结契约文件两处 facilitation 缺 SA6 追认落盘

SA3 修改了 DENY 明文冻结的契约文件两处（R3 等待锚、N5 断言收窄）。SA4 已 adversarial 核验「结构性被迫、零弱化、反向仍红」并裁为**非阻断流程债**，建议按 `task_228_sa6_f1_ratification.md` 先例由 SA6 出追认产物或派契约修订 dispatch。本轮复核：该追认产物**尚未落盘**（`wiki/raw/` grep 无 issue-245 ratification 文件）——治理债仍为开口项。
裁 MINOR 而非 MAJOR 的理由：(a) 被越界的 DENY 属设计级护栏而非仓库级标准（AGENTS/ADR/模块契约零违反）；(b) 改动方向非「实现适配契约以造假绿」——全部验收断言原样或增强，且逆向（去实现）仍响亮红；(c) 披露充分（代码内注释 + SA3 日志 §6 + SA4 §5），回流路径明确。**放行条件**：该债须在 finalize 前由 SA6 追认或契约修订 dispatch 清偿；本评审将其登记为跟踪项而非阻断项。

### N1（观察）——N5 收窄丢弃一条平凡断言

原循环「hub 零 chunked-update-applied」在收窄后无对应断言（hub 为发送侧，该事件结构性不可达；SA4 F2 同认覆盖损失可忽略：T9 assertSafe 全事件面 + R2/R4 恰一另护）。建议随 M1 追认一并登记。

### N2（观察）——设计层教训（SA4 F3，回流 SA1）

「契约零改动」假设被运行证伪（红期脚手架锚定改道前世界）。后续切片设计应做锚相容性审计或预置豁免类目。与本次实现合规性无关，仅登记。

## 6. 结论

HEAD `a7c1add` 在 AGENTS/ADR 符合性、模块责任、架构惯例、单一事实源、生命周期对称、文件范围（除已披露且经核验的契约 facilitation）、测试质量、安全与兼容性全部标准轴上合规；SA8 两门禁 clear、SA2 approve、SA4 approve 与本评审独立核验一致。**approve**；M1 流程债跟踪至 SA6 追认，不阻断。

## 附：artifactPaths（worktree-relative）

1. `wiki/raw/task_issue-245_sa9_standards.md` —— 本报告。
2. `wiki/raw/task_issue-245_sa4_review.md` —— SA4 评审（F1 流程债核验依据）。
3. `artifacts/sa3-issue245-verify.log` —— SA3 验证日志（§6 facilitation 披露）。

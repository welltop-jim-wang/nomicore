# SA2 设计攻击评审 — issue #246（分块传输 wire 契约收口与新旧互通矩阵）

- dispatch：sa-f2db4b93-0d85-4608-be88-a2135bc63c46（mabf-sa2 / design-review / iteration 1，复审）
- 评审对象：`wiki/raw/task_issue-246_design.md`（SA1，iteration 1 原位修订，409 行）
- 基线：分支 `mabf/issue-246` @ `d1888cc`（实测 HEAD 一致；工作树仅未跟踪简报/SA8 门禁/SA2 评审/设计四件）
- 前轮：iteration 0（dispatch sa-f3fa8ac5…）裁决 **reject**（4 MAJOR F1–F4 + 6 观察 N1–N6）
- **裁决：approve（0 BLOCKER / 0 MAJOR；3 条非阻塞观察 N7–N9）**——F1–F4 全部经独立事实核验属实落实；docs-only 定界、SA8 R26–R31 承接、零闪断重复运行验收均成立。`approve` 不替代 SA4/SA7 对实现与活链路的后续验证。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-246.md`（issue 正文快照） | 已读；5 条 AC + What to build + Blocked-by #245（已闭合，见 SA8 §3） |
| Issue comments | REST 快照 `[]`（dispatch 声明；SA8 门禁经 `GET /issues/246/comments` 复核一致）——无 owner 评论需要映射 |
| `wiki/raw/task_issue-246_design.md`（SA1 iteration 1） | 已读全文（409 行），含 §14 修订映射 |
| `artifacts/sa8-conflict-gate-issue-246.md` | 已读；clear，R26–R31（§4 逐条比对设计 §6 承接） |
| `docs/protocols/instance-replication-v1.md`（947 行） | 已复读关键节（§1/§5 L111-113/§6.1/§9.4/§10.3 L299-312/§13.2 L405-415/§17 L533-569/§22 L641-657/§23 头注 L664/§23.1） |
| `docs/adr/0013-chunked-live-update-transfer.md` | 已复读（L4 状态行、L25、L109-110、L120-122、全文「事件词表」零出现实测） |
| `CONTEXT.md` L138-150（分块词条区） | 已复读；`test.ts` 引用零出现实测 |
| 实现：`constants.ts:45`/`payloads.ts:150-151,181-182,828-836`/`hub-connection.ts:64,243,713-724,765,1025`/`peer-connection.ts:385,473`/`update-channel.ts:52-67,89-119,151-156`/`update-transfer.ts:180-197`/`hub-namespace.ts:707-716`/`peer-namespace.ts:690-699`/`types.ts:78-82` | 已复读设计引用锚点行，全部属实 |
| 测试资产：codec 五件 + `ws-replication-issue233-repro.test.ts` + `ws-replication-issue243-chunked-live.test.ts`（decodeWire L111-112）+ `harness.ts`（`makeCounterRandomBytes` L270-283、`makeNode` L498-515、`makeWire` L647+）+ `issue137-driver.ts`（L36-44 转出口） | 已读；`vitest.config.ts` include、两包 tsconfig `test/**` include、根 `package.json` test 脚本实测 |
| 依赖事实：yjs@13.6.32 dist `generateNewClientId = random.uint32`（`:385`，`this.clientID = generateNewClientId()` `:426`）；lib0 varuint 宽度 1–5 字节 | 已实测 |
| `docs/AGENTS.md` Authority 节 | 已读（wiki/raw = evidence 非规范契约） |
| `namespace-registry/src/registry.ts` `drawReplicationId`（`:956-975`，randomBytes 受控注入） | 已读（iteration 1 新增核验，见 §7/F1 深挖） |

SA6 契约与 SA8 相关决议文件不存在——SA1 §0 如实登记，以 SA8 门禁报告 + ADR 原文替代，事实源充分，不构成缺口（与 iteration 0 裁定一致）。

## 2. Verdict

**approve**。iteration 0 的 4 个 MAJOR（F1 跨会话闪断断言、F2 D6-1 红绿归类与来源歧义、F3 错误码映射缺口、F4 seam 词表并入 wire 冻结值）在修订稿中全部有对应正文与断言面修订，且本轮逐项做了**独立事实核验**（不只采信 SA1 §14 自述），全部成立：

- **F1 → 已解决**：M2≡M1 改为三层确定性等同（kind#sequence 序列 / 确定性字段逐字段 / Yjs 承载帧 kind+计数），字节级断言唯一挂靠 interposer 同会话原始↔重写 HELLO 字节对；全设计 grep 复核**零残留跨会话字节/长度相等项**。两项独立深挖均通过：(i) `optionalCapabilities` 实测为**定长 4 字节 uint32BE**（`payloads.ts:181-182` encode / `:150-151` decode）⇒ 字节对「等长 + 差异限于 4 字节窗口（0x01→0x00，其余 3 字节双侧 0x00）」是确定性成立，非概率成立；(ii) (b) 层 OPEN 族 `replicationId`/`replicationEpoch` 的跨会话确定性成立——`makeNode` 为每个 Registry 注入**独立** `makeCounterRandomBytes()` 计数随机源（`harness.ts:270-283/509`），`drawReplicationId` 走该受控源（`registry.ts:956-975`），结构相同的两次组装抽出相同 replicationId（ precondition 见 N9）。
- **F2 → 已解决**：D6-1 断言源唯一化（协议 §22 节切片 + ADR 0013 + CONTEXT.md 分块词条，零「§7.5」指涉），红绿归类改为「落地前空洞绿 → 落地后真实存在性检查」并移出红面；§12.1 红面精确枚举 12 条与 §12.2 表内红标注**一一对应**（实测核对：红 = D1-1..5、D2-1..3、D3-1、D3-3、D4-1/2）。空洞绿事实复核：现行 §22 零 `*.test.ts` 文件名（实测），ADR 0013 仅引 `ws-replication-issue233-repro.test.ts`（在库），CONTEXT 分块词条零 test 引用 ⇒ 实现前 D6-1 确为真绿。断言源纪律（只读 `docs/` + `CONTEXT.md`、禁读 `wiki/raw/**`）有 `docs/AGENTS.md` Authority 节背书。红面 12 条逐条对现行文档核验**全部真红**、绿面逐条核验全部真绿。
- **F3 → 已解决**：§7.1-3 错误码三分类显式分列，与协议 §13.2 L413 已冻结分类逐字同向（实测对照：声明超限 → TOO_LARGE；几何/跨帧违例 + 连接级并发超额 → VIOLATION；停滞超时 → `RESYNC_REQUIRED{UPDATE_TRANSFER_EXPIRED}` 非终态），fatal/config/failed 与 fatal/no/failed 分类属性和 §13.2 表逐字一致；实现锚（`update-transfer.ts:184-193`、`hub-namespace.ts:707-711`、`peer-namespace.ts:690-694`）同向。D2-3 锚集补 `UPDATE_TRANSFER_TOO_LARGE`，并类措辞已删除。
- **F4 → 已解决**：§7.2.1 枚举拆分——wire 冻结值枚举只含消息码/字段序/capability/错误码/reason 词表锁定值；observer 事件词表单列「local seam 词表（协议 §23，非 wire 契约）」，与 §23 头注「属于 local seam：**不改变任何 wire 字节**，不新增帧/字段/错误码」（L664 实测）零矛盾；D1-2 负向断言（枚举子句不含「事件词表」）+ D1-5 单列锚（seam 句不含「wire 冻结值」从属表述）双向锁死。现行 ADR 全文「事件词表」零出现（实测）⇒ D1-5 实现前真红成立。

docs-only 定界保持、SA8 R26–R31 全条目承接、零闪断重复运行验收（§12.5 AC3 行「SA7 动态轮抽查 M2 ≥20 次重复运行零假红」+ §13 兜底行）均核验成立。无 BLOCKER/MAJOR；3 条非阻塞观察见 §14。

## 3. 需求覆盖

| Requirement（issue 正文） | Design section | Assessment |
|---|---|---|
| 消息注册表（UPDATE_CHUNK 0x42）修订 | §2.1、§12 D5-1 绿锚 | 覆盖正确（R26 收口：只校验不重登记；§5 L111 实测在库） |
| HELLO capability 协商节 | §2.1、D5-1 | 覆盖（§6.1 L130-134 实测在库） |
| live UPDATE 分块节（发送/接收/transfer 身份/ACK 锚点） | §7.1、D2-1..4 | 覆盖且为唯一实质新增；错误码映射完整（F3 已修） |
| namespace 错误码注册表两个新码 | §2.1、§7.1-3、D2-3/D5-1 | 覆盖（§13.2 L410-413 实测；三分类逐字同向） |
| 资源上限与配置链节 | §2.1、D5-2 | 覆盖（§17 L535-569 + L567「不得运行时 clamp」实测） |
| observer seam 节 | §2.1、D5-3 | 覆盖（§23.1 四型 L698-700/L728 实测） |
| conformance 清单增补 + golden/锁定值入 §22 | §7.5、D4-1/D4-2 | 覆盖；红判成立（现行 §22 无 `0x42`/`0x00000001`/文件名，实测） |
| ADR 0013 状态转已接受 + wire 权威归属 | §7.2、D1-1..5 | 覆盖；枚举拆分后与 §23 零矛盾（F4 已修） |
| 互通矩阵 v1↔v2 全组合 + #233 基线全绿 | §7.4、File B M1–M3、§12.3/§12.4 | 覆盖；等价证据改为确定性形态（F1 已修） |
| 文档验证（链接/过期术语/`git diff --check`） | §12.4、D3/D6 | 覆盖；含 N2 全局「提议」搜索（实测现行恰 2 处：ADR L4、CONTEXT L142） |

## 4. Owner 评论覆盖

Issue comments REST 快照 `[]`（SA1 §0、SA8 门禁首部双登记一致，dispatch 声明即时读取）。**无 comment ID、无 updated_at 需要映射**；issue 正文为唯一任务要求来源。无遗漏。

## 5. 上游事实与 SA8 约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| R26 收口定界（不重登记/不动冻结面） | §1.2、§7.1 措辞纪律、§12 D5 绿锚 | 落实；D5 各锚实测在库（含 D5-5 六字段序 L305-310） |
| R27 v1/v2 三层消歧 | §7.3（§1 词条 + §5 L113 + **§22 L653** 改挂，N1 已采纳）、§7.6（CONTEXT 增词）、D3 | 落实；「v1」10 行/「v2」零出现实测；D3-2 负向串现行零命中（绿判成立）；L653「v1 回落」已入改挂清单 |
| R28 v1-hub 格二选一 | §7.4 等价性论证 + interposer + 三层确定性断言（显式否决生产 seam） | 落实；论证链锚点全部实测成立（`HUB_SUPPORTED_CAPABILITIES` `hub-connection.ts:64`、onHello 交集 `:713-724`、`isChunkedNegotiated` `:1025`、peer 逐字消费 `peer-connection.ts:473`、`chunkable` 门控 `update-channel.ts:151-156`、未协商 decode 前拒 `payloads.ts:828-836`）；interposer 委托面与 `DuplexTransport`（`types.ts:78-82`，`onMessage` 返回退订句柄）实测吻合 |
| R29 锚定既有资产、不造旧包 harness | §7.4.2/§7.5 | 落实（`codec-version-interop.test.ts` 在库实测；File B 零多版本安装） |
| R30 接受时点/父 PR | §7.2、§13 | 落实（登记总控留意项，不阻塞——与 SA8 R30 一致） |
| R31 两层权威边界 +「提议」零残留 | §7.2/§7.6/§12 D1/D3 | 落实；枚举拆分后两层边界自洽（F4 已修）；「提议」恰 2 处实测、全局零命中搜索入 §12.4 |
| SA6 契约不存在 | §0/§4 复现承接表 | 如实登记；以切片 1–4 交付面为事实源成立 |

## 6. 设计内部一致性

| 检查 | 结果 |
|---|---|
| 正文 ↔ 锚点 | 抽查全部关键行号（含 iteration 1 新增的 `payloads.ts:181-182` uint32BE、`harness.ts:270-283` 计数随机、`registry.ts:956` drawReplicationId、`hub-connection.ts:765` connectionId 格式）全部属实——无虚构证据 |
| §12.1 红面枚举 vs §12.2 表内标注 | 一一对应（红 12 条、绿 12 条；逐条核验真红/真绿，见 §2 F2 段） |
| §7.4.2 三层断言表 ↔ §12.3-2 断言清单 ↔ §7.5 §22 条目表述 | 三处同构，字段枚举与排除项（connectionNonce/connectionId/Yjs 字节）一致 |
| §7.1-3 错误码三分类 ↔ §13.2 L413 ↔ 实现锚 | 逐字同向（F3 已修；「任一不符 ⇒ VIOLATION」并类措辞已删除） |
| §7.2.1 状态行枚举 ↔ D1-2/D1-5 断言 ↔ 协议 §23 头注 | 零冲突（F4 已修；枚举子句不含「事件词表」、seam 句不含「wire 冻结值」） |
| §8.3 零生产改动 vs ALLOW LIST | 一致（ALLOW 无任何 `src/**`） |
| §14 修订映射 vs 正文实际修订 | 逐条核对属实（F1–F4 修订位置与内容一致；N1–N6 全部吸收，N5 登记不改） |
| 残留措辞失准 | 未发现新失准；iteration 0 N3 归因（harness.ts 定义/driver 转出口）已修正且与实测一致 |

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | 本票不触碰任何生产状态机（§8.2） | — | §15/§16/§21 零变化 | 无（R26/停机序核对成立） | — |
| S2 | 测试域：M1/M2 独立组装 | 同一 fake scheduler 下 20KB 写 → resync round | 恰一 resync + 收敛 | 无跨用例共享状态（§9）；「恰一」已按观测侧分别断言（N4 已采纳，§7.4.2 M1/M2 行明示禁止双 observer 汇总） | — |
| S3 | interposer 生命周期 | 连接 teardown/重连 | 会话级一次性 HELLO 改写 | 无泄漏面；委托面（send/close/closed/onClose + onMessage 退订句柄透传）与 `DuplexTransport` 实测接口吻合（`types.ts:78-82`、`hub-connection.ts:243 accept`） | — |
| S4 | M2 重写帧合法性 | peer offered CAP → interposer 剥除 → hub 交集 | selected=0，peer 逐字消费不回验 offered（`peer-connection.ts:473`）→ 无拜占庭分歧 | 无；备选方案 4（改写 HELLO_ACK）已被正确否决 | — |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1（iteration 0） | §10.3 收口把首 chunk 声明超限误并入 VIOLATION | 三分类显式分列 + D2-3 TOO_LARGE 锚 + D5 绿锚 | 已消除（实测与 §13.2 L413 逐字同向） | — |
| E2（iteration 0） | M2≡M1 断言跨会话闪断 | 三层确定性形态；字节级断言唯一挂靠同会话 interposer 字节对；定长 uint32BE 实测背书 | 已消除（grep 全设计零跨会话字节/长度相等项；≥20 次重复零假红入验收） | — |
| E3 | File A 读取的文档被移动/改名 | D6-2/D6-3 存在性/零命中断言 | 低（路径稳定、`git diff --check` 管控）；可接受 | — |
| E4 | (b) 层 OPEN 族字段跨会话随机 | replicationId 经 makeNode 独立计数随机源，结构相同组装抽值得同 | 已核验消除；落地前提见 N9（须以 makeNode 原样组装、两次组装构型序列一致） | N9（非阻塞） |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| 协议文档（wire 权威）新读者 | 无——§10.3 三分类完整、与 §13.2/实现同向 | §13.2 L413 vs §7.1-3（已对齐） | — |
| ADR 0013 状态行读者 | 无——两层权威 + seam 词表单列，D1-2/D1-5 双向锁定 | §23 头注 L664 | — |
| §22 conformance 清单（SA6/SA7 后续轮） | 文件名解析规则对「裸文件名 vs 全路径」未显式约定（见 N7） | §7.5 草稿条目用裸文件名；D6-1 断言「相对仓库根存在」 | N7（非阻塞） |
| `@nomicore/replication-protocol`/`ws-replication` 维护者 | 零代码改动、以 §10.3 为权威——成立 | §2.2 锚实测 | — |
| CI/根测试 | include `packages/*/test/**/*.test.ts` 与两包 tsconfig `test/**` include 实测覆盖两新文件；运行前缀与根 `pnpm test` 脚本同源（实测）——「零配置改动」成立 | `vitest.config.ts:15`、两包 `tsconfig.json:3`、根 `package.json:11` | — |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| wire 契约权威 | 协议文档 | §7.2 两层让渡 | 正确（R31；F4 修枚举后成立） |
| 配置语义/理据权威 | ADR 0013 | §7.2-3（§17 L535 不动，实测现文一致） | 正确 |
| v1 行为基线 | #233 刻画测试 | §1.2/DENY 不动 | 正确 |
| 互通证据 | 包内测试（vitest include 域） | File A/B 位置 | 正确（root `tests/` 为 Python VFSL 验收，不在 include——放包内是唯一可执行位置） |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 包内读文件的契约测试 | `codec-package-contract.test.ts`（readFileSync + import.meta.url） | File A 读仓库根 docs（`../../../`），头注登记读取边界（N3 已采纳） | 谱系一致、范围外扩有登记 | 合理新惯例 |
| 传输层互通/协商构型 | `ws-replication-issue243-chunked-live.test.ts`（decodeWire L111-112 先例） | File B 同风格自备组装 | 一致 | #243 先例直接可循（N6 已点名） |
| 语义摘要判定 | §23.7 issue #238（kind#seq，同会话 A/B） | M2≡M1 三层形态 | 一致且已按会话域修正 | 跨会话随机面显式排除（F1） |
| 测试随机源受控 | `makeCounterRandomBytes`（harness 既有） | File B 经 makeNode 复用 | 一致 | 零新随机源机制 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| wire 冻结值 | 协议文档（修订后） | ADR 历史正文、实现常量 | D5-4 三方锁封堵；低 |
| 决策状态 | ADR 0013 状态行 | CONTEXT 标注、协议注记 | D3-3 负向断言 + 「提议」零残留封堵；低 |
| 实现代际词表 | 协议 §1 词条 + CONTEXT 同义词条 | §5/§22 用词 | 两处绑定修订（§7.3/§7.6）；低 |

### 生命周期对称性

不适用（零生产生命周期变化；interposer 为测试域一次性对象，退订句柄透传对称）。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二套 doc 校验 harness | 无（root tests 为 Python VFSL） | File A | 非平行——唯一可执行位置 |
| 旧版包 harness | 无 | 明确否决（§7.4.3-2） | 正确（R29） |
| hub capability 注入 seam | 无 | 明确否决（§7.4.3-1） | 正确（R28 + 零生产改动） |
| HELLO_ACK 改写 | — | 明确否决（§7.4.3-4，拜占庭构型） | 正确 |
| 跨会话字节全等断言 | — | 明确否决（§7.4.3-5，iteration 0 形态） | 正确（F1） |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW LIST 6 项 vs 正文触及面 | §7/§8/§12 涉及的每个路径均在 ALLOW（协议文档、ADR 0013、CONTEXT.md、两新测试文件、设计文档自身） | 无 |
| DENY vs 正文冲突 | 无冲突：零 `src/**`、#233 文件不动、共享 fixture 只 import 不改、既有 codec 测试只读、`vitest.config.ts`/tsconfig 不动（include 实测已覆盖） | 无 |
| ALLOW 无理由扩张 | 无——6 项均有 AC/决策节对应 | 无 |
| follow-up 掩盖必要项 | `CAP_CHUNKED_SYNC` 为 ADR 0013 非目标，登记为非必要残余，正确 | 无 |
| docs-only 定界（dispatch 复核项） | §8.3 论证 + ALLOW/DENY 实测一致；interposer 为测试域单帧改写，出 worktree 即消失 | 保持成立 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1 三方逐字一致 | File A D2/D5（D2-3 含 TOO_LARGE 锚） | 无——D5 全部绿锚实测在库；§10.3 新正文红锚完整（发送端/接收端/三分类/收齐核对/零 live 写入） | — |
| AC2 接受 + 权威归属 | File A D1-1..5 | 无——12 条红锚逐条实测真红；D1-2/D1-5 双向锁定 F4 枚举 | — |
| AC3 互通矩阵 | File B M1–M3 + 数学锚（File B 全绿面，行为已落地） | 无——三层确定性断言零跨会话字节/长度项；**≥20 次重复零假红为具体可执行验收**（SA7 动态轮，目标用例 M2、次数、期望零假红三要素齐备，§12.5 AC3 行 + §13 兜底行） | — |
| AC4 §22 收口 | D4-1/D4-2（红，实测成立）+ D6-1 | 无——D6-1 空洞绿→真实存在性检查，全程不伪红不伪绿（文件名解析路径约定见 N7） | — |
| AC5 文档验证 | §12.4 命令表后七行（含 N2 全局「提议」搜索） | 无——现行值实测（恰 2 处 / 定向各有命中 / ADR 0010 零命中）与「实现前」列一致 | — |
| 红灯先行 | §12.1/§12.4 前/后状态表 | 无——红面 12 条与表内标注一一对应且逐条实测真红 | — |

## 13. Required revisions

无（0 BLOCKER / 0 MAJOR）。

### 评审历史与修订映射（F1–F4 复核记录，均已解决、不再构成阻断）

| Finding ID（iteration 0） | 复核结论 | 关键独立证据 |
|---|---|---|
| issue246-SA2-F1 | **已解决** | 三层确定性形态 + interposer 同会话字节对；`payloads.ts:181-182` 定长 uint32BE；yjs dist `:385/:426` 随机 clientID（字节对不受其影响）；全设计 grep 零跨会话字节/长度相等项；§7.4.3-5 否决旧形态；≥20 次重复验收入 §12.5 |
| issue246-SA2-F2 | **已解决** | D6-1 唯一规范源（§22/ADR/CONTEXT 词条）、零「§7.5」指涉、空洞绿归类；红面 12 条精确枚举且逐条实测真红；断言源禁读 wiki/raw（docs/AGENTS.md Authority 背书）；空洞绿前提实测成立（ADR 仅引存在的 #233 文件、CONTEXT 零 test 引用） |
| issue246-SA2-F3 | **已解决** | §7.1-3 三分类与 §13.2 L410-413 及 `update-transfer.ts:184-193`/`hub-namespace.ts:707-711`/`peer-namespace.ts:690-694` 逐字同向；D2-3 含 TOO_LARGE 锚；§9 分类属性（fatal/config/failed、fatal/no/failed）与 §13.2 表一致 |
| issue246-SA2-F4 | **已解决** | §7.2.1 枚举拆分 + §7.2-2 同步；D1-2 负向 + D1-5 单列锚；与 §23 头注 L664 零冲突；现行 ADR「事件词表」零出现 ⇒ D1-5 真红成立 |
| N1–N6 | 全部吸收 | N1（L653 改挂入 §7.3/§8.1/ALLOW）、N2（全局搜索入 §12.4）、N3（归因修正 + 读取边界头注）、N4（按观测侧断言入 §7.4.2/§12.3）、N5（登记不改）、N6（decodeWire 先例点名）——逐条与正文核对属实 |

## 14. Non-blocking observations

| ID | Observation |
|---|---|
| N7 | D6-1「逐一断言相对仓库根存在」的解析规则对**裸文件名 vs 全路径**未显式约定：§7.5 草稿条目现以裸文件名列举五个测试资产（`ws-replication-issue233-repro.test.ts` 等）。若落地文本保持裸名而断言按仓库根解析，将恒红（响亮、非静默）。建议 SA6 落地 §22 条目时直接写全 repo 相对路径（如 `packages/ws-replication/test/…`），使 D6-1 的存在性检查与引用文本自解释；断言与文本同归 SA6 所有，不构成设计缺口。 |
| N8 | D3-1 消歧锚的示例子串（「protocolVersions 不变」「非 protocol 版本」）与 §7.3 草拟词条措辞（「protocolVersions 不因代际变化」「与协议版本正交」）非逐字相同。SA6 撰写 §1 词条与 D3-1 断言时应以同侧措辞对齐（或按语义正则撰写），避免字面错配造成假红。属措辞对齐细节，非结构缺陷。 |
| N9 | (b) 层 OPEN 族 `replicationId` 跨会话确定性成立的前提已实测锚定：`makeNode` 为每 Registry 注入**独立** `makeCounterRandomBytes()`（harness.ts:270-283/509），`drawReplicationId` 走该受控源（registry.ts:956-975）。File B 落地须以 makeNode 原样组装且 M1/M2 两次构型调用序列一致（不得引入共享随机源工厂或改变 enableReplication 前的抽取次序）；建议在文件头注一行登记该前提（与 §12.3-5 头注纪律合并即可）。 |

## 15. 评审方法与证据命令（SA2 只读核验，未运行测试/服务）

- 基线与工作树：`git log --oneline -2`（HEAD `d1888cc`）、`git status --short`（仅四件未跟踪任务产物）
- F1 深挖：`payloads.ts:150-151/181-182`（HELLO required/optional capabilities 定长 `readUint32BE/writeUint32BE`）；yjs@13.6.32 dist `:385` `generateNewClientId = random.uint32`、`:426` `this.clientID = generateNewClientId()`；`harness.ts` `makeCounterRandomBytes`（每节点独立闭包计数）与 `makeNode`；`registry.ts:956-975` `drawReplicationId`（randomBytes 受控注入、128-bit hex）；`types.ts:78-82` DuplexTransport（onMessage 返回退订句柄）+ `hub-connection.ts:243` accept 签名——interposer 委托面吻合
- F2 复核：现行 §22（L641-657）零 `*.test.ts` 实测；ADR 0013 `test.ts` 引用 = L10/L122（#233 文件，在库）；CONTEXT.md 分块词条零 `test.ts` 引用；设计全文「§7.5」指涉清零 grep；§12.1 红面 12 条 vs §12.2 表逐条对照 + 逐条对现行文档核验真红/真绿
- F3 复核：协议 §13.2 L405-415（VIOLATION yes/no/failed、TOO_LARGE yes/config/failed + L413 分类句）；`update-transfer.ts:180-197`、`hub-namespace.ts:707-716`、`peer-namespace.ts:690-699`
- F4 复核：协议 §23 头注 L664；ADR 0013 全文「事件词表」零出现；现行 L4 状态行/L120-122 未来时原文
- 冻结面绿锚：§5 L111、§6.1 L130-134、§9.4 L262、§17 L535-569 + L567 clamp、§23.1 四型（L698-700/L728）、§10.3 六字段表、`constants.ts:45`、`payloads.ts:828-836`（decode 前拒）
- 术语与验证基建：`grep -c v1`（10）、`grep v2`（协议与 CONTEXT 零）、`grep -rn 提议 docs/ CONTEXT.md`（恰 2 处）、ADR 0010 分块引用零命中、`vitest.config.ts:15` include、两包 `tsconfig.json:3` include、根 `package.json:11` test 脚本、`index.ts` 导出（MESSAGE_TYPES/CAP_CHUNKED_UPDATE/selectCapabilities）
- 测试资产：`codec-version-interop.test.ts` 在库；#243 `decodeWire` L111-112；`issue137-driver.ts:36-44` 转出口；`ws-replication-issue233-repro.test.ts` 在库

## 16. 结论与路由建议

- 裁决 **approve**：设计可安全交付 SA3/SA6 实施。实施要点 = §7（五处文档修订 + 两新测试文件）+ §12 红绿契约 + N7–N9 三条落地措辞注意。
- 无新增 ADR 冲突面：iteration 1 修订未引入新的权威面或语义变化；SA8 已排 R26–R28 设计后轻量复审（设计 §15 亦如实登记）→ 本评审 `requiresConflictRecheck = false`。
- `approve` 不替代 SA4（实现审查）与 SA7（活链路动态验证，含 M2 ≥20 次重复零假红抽查）的后续验证。

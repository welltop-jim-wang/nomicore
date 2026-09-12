# SA2 设计攻击评审 — issue #299（feat：#295 切片 1：0x42 kind 首字段单形态 codec + 聚合上限配置链）

- **dispatch**: sa-52561ea3-c366-41b4-a7c7-26462175dbbc（mabf-sa2 / design-review / iteration 1）
- **评审对象**: SA1 设计 `wiki/raw/task_issue-299_design.md` **iteration 1 修订版**（dispatch sa-fd2ae580-4184-4429-a824-431f35f86686；首版 iteration 0 已经 iteration 0 评审 reject：0 BLOCKER / 3 MAJOR（F1/F2/F3）+ 非阻塞 O1–O4）
- **HEAD**: `eb380d7aed296c15accf8832a45a96b630f0c8ce`（分支 `mabf/issue-299`，本评审实测一致，与设计声明相同）
- **Verdict**: **approve** — 0 BLOCKER / 0 MAJOR / 2 MINOR（O5/O6）。前轮 F1/F2/F3 三项 MAJOR 经本轮独立源码级复核**全部落实且验收判据完整**；核心设计 D1–D9 未被修订触碰、维持前轮已独立攻击成立的结论；D6 窄门按 dispatch 点名原样保留（本轮复核维持）。设计可安全进入实施。

## 1. Reviewed inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-299.md` | 在库（正文 + AC1–AC4；comments 段为空） |
| SA6 验收契约 | `wiki/raw/task_issue-299_sa6_contract.md` | 在库（approve；21 红 / 5 负控 / 2 类型面红） |
| SA8 前置门禁 | `artifacts/sa8-conflict-gate-issue-299.md` | 在库（clear，R32–R37） |
| SA8 设计后复审 | `artifacts/sa8-conflict-gate-issue-299-design-recheck.md` | 在库（clear，R38–R41） |
| SA2 前轮评审 | `wiki/raw/task_issue-299_sa2_review.md`（iteration 0） | 在库（reject：F1/F2/F3 + O1–O4）——本文件即其原位更新 |
| SA1 设计（评审对象） | `wiki/raw/task_issue-299_design.md` | 在库（iteration 1，含 §14 修订映射） |
| relevant_decisions / conflict_report | `wiki/raw/task_issue-299_relevant_decisions.md`、`task_issue-299_conflict_report.md` | 不存在（设计抬头与 SA6 §1 已登记；SA8 门禁报告为 dispatch 指定替代——非阻断） |
| Issue 实时核验 | `gh issue view 299` | OPEN、**comments=0**（与 dispatch「Owner requirements: none; REST comments empty」一致） |
| 源码/规范独立核验 | payloads.ts（L651–726）、messages.ts、canonical 基座、defaults.ts（14 键实测）、validate.ts（值门/链/门先例实测）、plugin.ts（LIMIT_KEYS 实测）、hub/peer 构造器门、codec-issue242-ac-red.test.ts（全文件 516 行逐行）、codec-issue299-ac-red.test.ts（冻结向量）、fixtures.ts（buildFrameHex/golden）、codec-malformed / codec-roundtrip-truncation / codec-fuzz-property / codec-issue246-doc-contract（锚实测）、协议 §5/§10.3/§17/§22（L701/L707 实测原文）、ADR 0022、`apps/yjs-server/src/config.ts` | 本评审逐点实测（见各节 Evidence） |

契约三文件 sha256 本轮复测：`3168f11c…` / `56a2337b…` / `171104c2…` ——与前轮锁定值逐字节一致，「不改一行 26/26」转绿判据对象保持稳定。全仓基线复测（full-suite log）：`Test Files 2 failed | 325 passed (327)`、`Tests 19 failed | 3441 passed (3460)` ——设计 §5「3460 用例」与 §12「3441 用例绿 + 契约 2 文件红」为同一基线的两个切片，**一致非矛盾**（3460 = 3441 绿 + 19 红；19 = R1–R14 中 14 例 + C 面 5 例，2 类型面红在 typecheck 通道）。

## 2. Verdict

**approve**。本轮为 F1–F3 定向复核 + 全设计独立再攻击：

- **F1（codec 测试改写完整性）落实**：设计 D7 改动 ①②③ + `PINNED_FRAME_HEX` 头部长度同步完整覆盖 `codec-issue242-ac-red.test.ts` 的全部受影响面；本评审对 516 行逐行核对，未再发现改写后必红或伪绿的残留点（唯一残留为 L82 过期权威注释，见 O6，零测试影响）。头部长度算术独立复算成立（A: 45→46=`2e`、B: 50→51=`33`、C: 58→59=`3b`；`buildFrameHex` 实测按 payloadHex 长度计算头部，fixtures.ts L63–72）。
- **F2（encode 侧对称补测落点）落实**：`codec-issue299-encode-symmetry.test.ts` 进入 §11 ALLOW（含冻结断言清单描述）+ §10 矩阵行 + §12 AC2 编码侧对称行，三处一致；负控 ①–⑧ 覆盖 D4 全部六条规则线、正控 P1–P5 含往返无损；SA2 前轮钉死的 ①–⑤ 全部采纳并扩展。残余为两个原子镜像半例（O5，非阻断）。
- **F3（§22 措辞精度）落实**：D10 二分模板精确吸收 SA8 R39——codec 向量支「已交付 + 指向资产」、传输层资产支维持待交付表述，且 §12 验收行钉死「§22 内零『传输层资产已交付/已存在』语义表述」；D4-1/D4-2/D6-1 锚与 L707 义务句保持项经 doc-contract 测试源码实测确认兼容。
- **O1/O2 顺带项落实**：D3 步 4 五向量收敛机制经本评审独立字节级推演**全部正确**（详见 §6）；§12 全仓回归行显式引用 wire-change 门豁免依据（包 AGENTS「Wire changes require old/new interoperability evidence」由同版本部署假设 + 旧形态未发布 + PR #241 OPEN 豁免）。
- **D6 窄门**：dispatch 点名保持已接受的冲突门禁解释——设计 §14 显式声明原样保留、零改动；本轮复核 §17 L613 原文（「显式配置…时**对应**链式校验响亮生效」+ 无「或」子句，与 L611 #244 行的「**或** `maxChunksPerUpdate`」形成刻意对照）与契约 CHAIN2_FAMILY（L81–86 实测）仍为窄门的字面 + 数学双重依据。维持。

## 3. 需求覆盖

（iteration 0 已逐条覆盖并确认；本轮复核修订未引入需求面变化——D1–D9 目标/非目标文本未动，F1–F3 修订均为完备性补全。结论维持：）

| Requirement（issue 正文 / AC） | Design section | Assessment |
|---|---|---|
| 0x42 单形态 + 绑定块编解码往返 | §1 目标 1、§7 D3/D4 | 覆盖；字段序与协议 §10.3 字段表（本轮实测：kind 行居首 + 绑定块位「totalBytes 之后、bytes 之前」+ iff 规则逐字）一致 |
| kind ∉ {0,1,2} / 绑定块违例 → MALFORMED_FRAME | §7 D3/D4 | 覆盖；旧形态首字节 0x23=35 与 {0,1,2} 不相交（实测） |
| golden vectors 本分支改写 | §7 D7 | 覆盖（改写面本轮复核完整，见 §6/F1） |
| 两聚合上限键 + 两条链②响亮验证 + 绝不 clamp | §7 D5/D6 | 覆盖；defaults 14 键 / LIMIT_KEYS 14 键 / 构造器 #244 门 / `validateChunkedTransferChain` 两不等式先例（错误消息含三操作数值）全部实测在库 |
| 三机制键 kind 无关、键名不变 | §7 D5.2 | 覆盖（timeouts 键集零漂移，C1 锁定） |
| control reserve 原样保留 | §7 D5.5 | 覆盖（validate.ts 既有双登记实测） |
| 存量配置非追溯性 | §7 D6 | 覆盖（窄门 + C5 三支，前轮已三层复核） |
| AC4 三 kind 共用 transferId 计数器 | §7 D3/D4、D8 | 覆盖（R11/R12 + 复用 L121 计数器登记；协议 §10.3「三种 kind 共用同一 transferId 计数器」本轮实测原文在库） |
| Blocked by: None | §13 | 一致 |

目标/非目标无静默扩大：修订未触碰协商门、错误码冻结面、§5/§10.3/§13.2/§17、kind=1/2 发送端边界。

## 4. Owner评论覆盖

无。issue #299 OPEN、REST comments = 0（本轮 `gh issue view 299` 实测 + Host dispatch 声明 + SA6 §2/SA8 §0 三方一致）。验收目标 = 正文 + AC1–AC4 + SA6 已批契约 + SA8 R32–R37（+R38–R41）。

## 5. 上游事实与SA8约束

（iteration 0 逐条表格维持；本轮增量复核项：）

| Fact or constraint | Design response | Assessment（本轮增量） |
|---|---|---|
| SA6 21 红（19 test 红 + 2 类型面红）/ 5 负控 | §5 表 + §12 映射 | 基线数字与 full-suite log 实测对账成立（3460=3441+19）；红因（kind 首字节被误读为 varString 长度）与 payloads.ts L664 实测读序吻合（本轮重读确认 L663–666 现状） |
| **D6 窄门（dispatch 点名保持）** | §7 D6 + §14「原样保留、零改动」 | **维持**：§17 L613「对应…生效」+ 无「或」子句 vs L611 #244 行「或」子句的刻意对照（本轮实测原文）；CHAIN2_FAMILY {maxChunksPerUpdate:4, maxChunkedUpdateBytes:1MiB, maxQueuedUpdateBytes:2MiB}（L81–86 实测）+ 边界族仅表达单一新键 ⇒ 宽门数学不可行；R35 关切经 #244 链②承载（hub L200–206 门实测原样） |
| R37/R39 文档同步义务 | §7 D10 二分 + §6 R37 行 | **落实**（F3，见 §12） |
| SA6 §15.2 encode 侧裁决留白 | §7 D4 + §12 补测清单 | **落实**（F2，见 §12） |
| SA6 §15.6 绑定块值域不校验 | §7 D4 值域边界 | 维持落实（契约 R8/R9/R10 向量在「结构校验 only」实现下收敛同码——本轮对 KIND1_NO_BINDING 等五向量独立推演证实） |
| 全仓基线仅契约 2 文件红 | §11 + §12 | 前提成立；§12「328 文件全绿」预期在本轮 F1 完整改写面下**成立**（327 既有含 2 契约文件转绿 + 1 新增 encode-symmetry） |

## 6. 设计内部一致性

**F1 定向复核（本轮重点）**——对 `codec-issue242-ac-red.test.ts` 全 516 行逐行核对设计 D7 改动 ①②③ + PINNED 头部同步的完备性：

- **改动 ①（向量本体 + 锁定帧）**：VECTOR_A/B/C `payloadHex` 前缀 `'00'` 后，L191–195（`buildFrameHex` vs `PINNED_FRAME_HEX`）与 L197–202（`encodeMessage` vs 锁定字面量）自动一致的前提 = 头部 payloadLength 同步——设计给出的 `2d→2e`（A：36+1+1+1+2+1+3=45→46）、`32→33`（B：50→51）、`3a→3b`（C：58→59）经本评审独立复算**全部正确**（`buildFrameHex` L63–72 实测按 `payloadHex.length/2` 计算头部）。L212 `payloadLength` 断言随 payloadHex 自动正确。
- **改动 ②（hostilePayload 前缀）**：L156–165 现签名（`nsHex|transferIdHex|chunkIndexHex|chunkCountHex|totalBytesHex|tailHex`）追加缺省 `'00'` kind 前缀 + `kindHex` 覆盖键后，全部调用点（L247–297 六组敌意用例）零破坏；缺省 `chunkIndexHex='00'` ∧ kind=0 ⇒ 绑定块永不读取 ⇒ 敌意 payload 的字段级规则（非 canonical varUint / 非法 UTF-8 / 超声明 bytes / 单帧自洽 / 尾随）**全部重新可抵达**——E4 伪绿消除。逐例抽验：`transferIdHex:'8100'`（非最短）在 kind 合法前提下抵达 canonical 检查；`nsHex:'23'+ff×35` 抵达 UTF-8 fatal；`tailHex:'c801'+…` 抵达超声明 bytes 拒绝。L280–282 尾随用例经 `VECTOR_A.payloadHex + 'ab'`（随 ① 自动前缀化）保持判别力。
- **改动 ③（L225–232 字段序锁定）**：`startsWith('00' + NS_HEX)` + `.slice(2 + NS_HEX.length)` 算术正确（2 hex chars = 1 kind 字节）；备选「全字面量等值断言」等价可行。
- **全文件残留扫描**：AC3/AC4 段（L323–515）经 ①②③ 后零依赖六字段形态（chunkFrame/encodeMessage 均经向量驱动）；L5–7 文件头与 L173/L225 标题在改动清单内；唯一未列名处 = L82 `ChunkVector.payloadHex` 字段注释「字段顺序 = ADR 0013 表序」（**O6**，注释级、零断言面）。
- **全仓六字段字面量扫描**（`grep -rl "236e732d…"`）：命中 4 文件 = codec-issue242（ALLOW，F1 改写）、codec-issue299 契约（DENY，`OLD_SIX_FIELD` 向量为**故意**的旧形态负样本，必须保持）、codec-malformed（实测 `NS_VSTR` 仅用于非 0x42 消息构造——设计「零改动」声明成立）、fixtures（ALLOW，golden 改写）。**无第五处遗漏**。

**F2 定向复核**：§11 ALLOW 新条目（含冻结清单描述）/ §10 矩阵行 / §12 AC2 编码侧对称行三处文本互相一致；`codec-malformed.test.ts` 维持「零改动」且不在 ALLOW（落点二选一取新文件方案，无矛盾）；负控 ①–⑧ 与 D4 六条规则线的映射逐条核对：④→kind 值域；②+⑦→kind=0 三成员任一存在；③+⑧→kind=1∧idx=0 缺任一；①→kind=1∧idx>0 携带；⑤→kind=2∧idx=0 携异族成员；⑥→kind=2∧idx>0 携带——**每条规则线 ≥1 执行面**。残余原子半例见 O5。

**F3 定向复核**：D10 模板与协议 §22 L701 现文（本轮实测：「kind 首字段 + 首 chunk 绑定块的 golden vectors **与传输层测试资产**由实现 ticket 交付，本规范不预设其存在」）逐支对应；「保持不变」清单中 D4-1/D4-2 锚（`0x42`/`0x00000001`/四资产文件名，实测位于 §22 的 #242/#246 条目行——不在 L701 编辑面内）与 L707 义务句（实测原文在库）均不受收口影响；新指向 `codec-issue299-ac-red.test.ts` 经 D6-1 `testFileTokens` 存在性检查可解析（文件在仓，实测）。

**O1 复核（前轮指出、本轮验证修订正确性）**——D3 步 4 五向量收敛机制独立字节级推演：

| 向量 | 设计修订后叙述 | 本评审独立推演 | 一致 |
|---|---|---|---|
| KIND1_NO_BINDING | replicationEpoch 读取处欠载（RID 误吞 `03`+`0a0b0c` 后缓冲尽） | kind=1∧idx=0 → 读绑定块：RID len=03 → RID=0a0b0c → epoch 读取无余字节 → 欠载 | ✓ |
| KIND1_BINDING_AFTER_BYTES | bytes 长度声明处欠载（RID 首字节 `61` 被当 bytes 长度前缀，声明 97 > 余量 33） | RID len=03→RID=0a0b0c，epoch=`20`(32)，bytes len=`61`(97) > 余 33 字节 → 欠载 | ✓ |
| KIND1_BINDING_ON_LATER | 全消费尾随检查（idx=1 不读绑定块，`20`=32 恰消费 RID 余量，遗留 `01 0a` 两字节尾随） | bytes len=0x20=32 → 消费 32 字节 RID → 余 `01 0a` → 尾随拒绝 | ✓ |
| KIND2_BINDING_ON_LATER | bytes 长度声明处欠载（长度前缀 `05` 声明 5 字节仅余 2——**非尾随路径**） | bytes len=0x05=5 > 余 `01 0a`=2 → 欠载（前轮 O1 指出的错误已更正） | ✓ |
| KIND0_BINDING_BYTES | 尾随检查（`01` 消费 `0a` 后遗留绑定块字节） | bytes len=01 → `0a`；余 34 字节绑定块 → 尾随拒绝 | ✓ |

五向量分类同为 `MALFORMED_FRAME`、行为无差异，机制叙述已按实测收敛点逐条精确——SA4 不会按错误机制实现「专门」检查路径。

其余一致性维持前轮结论：调用方矩阵与全仓 grep 完全重合（本轮重跑 grep：两包 src + protocol 测试 5 文件 + ws-replication 测试 8 文件，root `tests/` 零构造）；D7 golden 映射 iff 自洽（BASIC idx=0→kind0 无绑定 / MULTIBYTE idx=63→kind1 idx>0 无绑定 / U32_MAX idx=0xfffffffe→kind2 idx>0 无绑定）；D9 fuzz 断言循环（`Object.entries(msg)` 逐字段断言，L170–178 实测）自动覆盖新成员；truncation 套件 GOLDEN 驱动（实测「全部 18 种消息」经 GOLDEN 迭代）零波及。

## 7. 状态机与并发攻击

（iteration 0 S1–S4 全部无 gap，修订未触碰状态面——codec 纯函数、配置构造期一次性、计数器不动。维持前轮结论：）

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | 发送路径构造消息（hub/peer `sendUpdateChunk`） | 调用方漏写 `transferKind` | TS 面必填报错；JS 面 D4 encode 校验拒绝 → `ProtocolError` 出站点抛出、既有 try/catch 收敛 | 无 | 无 |
| S2 | 入站 0x42 任意 kind | kind≠0 帧流经连接层展开转发 | 结构兼容流过 assembler（不读取）；部署面不可达（同版本 + pre-parse fatal + 首字节不相交三重） | 无 | 无 |
| S3 | 配置构造期（含插件 `apply` 经 `mergeNested` 同一入口） | 链②违例 | 构造期 `TypeError`、无 ready 服务、无部分初始化 | 无 | 无 |
| S4 | transferId 计数器 | 本切片不触 | 零改动；AC4 仅契约锁定 | 无 | 无 |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | decode 违例（kind/绑定块/尾随/欠载） | `MALFORMED_FRAME` connection fatal 1002，分类不变 | 无——五向量收敛路径本轮独立推演全部成立（§6 表） | 无 |
| E2 | encode 违例（iff 打破） | `MALFORMED_FRAME` 调用方 bug 响亮失败 | 执行面已落地：F2 补测文件 + 冻结清单（负控 ①–⑧ / 正控 P1–P5） | 无（O5 建议追加两镜像半例） |
| E3 | 配置违例 | 构造期 `TypeError`、校验先于字段赋值 | 无 | 无 |
| E4 | #242 敌意套件伪绿 | **已消除**：改动 ② 缺省 kind 前缀使字段级规则重新可抵达；验收行（§12「判别力保持」）含判别性判据 | 无 | 无 |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `UpdateChunkMsg` + 必填 `transferKind` | 无——构造点矩阵与 grep 重合（本轮重跑）；`toMatchTypeOf` 容忍（api.test-d / ws-replication-api.test-d） | §10 vs grep 实测 | 无 |
| wire 0x42 形态变化 | 无互通消费方（同版本部署 + v1 pre-parse fatal + 0x23 不相交）；包 AGENTS wire-change 门豁免依据已显式化（§12 全仓回归行） | ADR 0022 部署前提；SA8 C4 | 无 |
| `codec-issue242-ac-red.test.ts`（#242 契约锚） | **已补全**：三处改动 + PINNED 头部同步覆盖全部受影响面（本轮 516 行逐行核对）；改写后全绿且判别力保持 | D7 改动 ①②③；§11 ALLOW 条目 | 无（O6 注释级残留） |
| `ReplicationLimits` + 两必填键 | `Partial` 消费方类型不破；app 配置面家族级滞后 + follow-up 登记（§13-2） | config.ts L136–148 先例 | 无 |
| 插件 `LIMIT_KEYS` | +2 键；`mergeNested` 对象展开保真（plugin.ts L214–217 实测） | probe B/C7 红 | 无 |

## 10. 架构一致性与惯例审查

（iteration 0 四表（责任归属 / 相似能力对照 / 单一事实源 / 生命周期对称性 / 平行机制）维持成立；本轮增量：）

- **责任归属**：F1 改写落在既有契约锚文件内部（零生产面）、F2 新测试文件落在本包 test 目录（SA6 §15.2 授权的补测落点）、F3 收口落在规范文档单点（§22 L701）——三处修订均未引入新的 Owner 偏移。
- **相似能力对照**：`validateChunkedBootstrapChain`/`validateChunkedSyncDiffChain` 与既有 `validateChunkedTransferChain`（本轮实测：两不等式、错误消息含三操作数值、包内私有）同构；#295 门与 #244 门（hub L200–206 实测 `hasOwnProperty` 双键）同构扩展。
- **单一事实源**：D10 收口只改 §22 L701 一处措辞，不产生第二权威；codec 向量「已交付」指向的资产（契约冻结向量 + 改写后 golden）在仓可解析——事实与声明一致（这是 F3 二分的实质：不把不存在的传输层资产写成事实）。
- **生命周期对称性 / 平行机制**：无新 acquire/release；无第二计数器/缓存/worker/log 格式。维持。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| F2 新文件 `codec-issue299-encode-symmetry.test.ts` 已入 ALLOW，条目含冻结断言清单与「不触契约三文件」边界；`codec-malformed.test.ts` 的「零改动」声明与不在 ALLOW 一致（实测该文件无 0x42 构造） | §11 ALLOW vs §10/§12 逐条比对 + 源码实测 | 无 |
| F1 条目（codec-issue242）预期改动描述升级为「①②③ + PINNED 头部同步」，与实际必要面吻合（本轮逐行核对） | §11 ALLOW vs 516 行实测 | 无 |
| 其余 ALLOW/DENY 与正文一致：DENY 三契约文件（sha256 本轮复测锁定）、传输/assembly 五文件、ADR/协议节（仅 §22 L701 在 ALLOW）、CONTEXT、错误码冻结面、apps/yjs-server（先例实测） | §10/§11 交叉核对 | 无 |
| ALLOW 无理由扩张：新增面 = F2 授权落点（SA2 前轮要求）+ 两个可选类型锁条目（标注「可选」且 `toMatchTypeOf` 不强制）——无静默扩权 | §11 | 无 |
| follow-up（§13）不含本任务必要项：yjs-server 配置键 catch-up 为家族级先例延续（#243 起滞后实测），非本切片契约面 | §13-2 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1/AC2/AC4 codec 面 | 契约 R1–R14 不改一行转绿（sha256 锁定）+ golden/truncation/fuzz | 无 | 无 |
| **AC2 encode 侧 iff 对称（F2）** | 新增 `codec-issue299-encode-symmetry.test.ts`：负控 ①–⑧ 全部 `MALFORMED_FRAME` + 正控 P1–P5（含往返逐字节）+ 每组前置相近正控；清单在 §12 冻结、ALLOW 在列 | 无（O5：两原子镜像半例建议追加） | 无 |
| **#242 敌意套件判别力保持（F1/E4）** | 改动 ② 前缀化后全绿 + 字段级规则可抵达（§12「判别力保持」行含判别性判据：`transferIdHex:'8100'` 在 kind 合法前提下仍拒） | 无 | 无 |
| AC3 配置面 | 契约 C1–C7 + api.test-d 26/26 | 无（D6 窄门与 C2/C3/C5 相容性前轮已推演，本轮 CHAIN2_FAMILY 复测维持） | 无 |
| 负控保持绿（N1–N3/C5/C6） | 契约文件 | 无 | 无 |
| 既有传输层回归 | 8 文件 +`transferKind:0` 后全绿（构造为字面量、断言为解码面） | 无 | 无 |
| fuzz/property | D9 生成器扩展；断言循环自动覆盖 | 无 | 无 |
| 全仓回归 | `pnpm typecheck` + `pnpm test`：328 文件全绿（含 26/26 契约）+ Type Errors no errors；wire-change 门豁免依据显式（O2 落实） | 无——F1(a) 修复后该预期成立 | 无 |
| **文档一致性（F3）** | §22 二分收口后 doc-contract D4-1/D4-2/D6-1 锚全绿 + 「§22 内零传输层资产已存在表述」判据 + 过期术语扫描 + L707 义务句保持 | 无 | 无 |

## 13. Required revisions

**无 BLOCKER / 无 MAJOR。** 前轮三项 MAJOR 的处置登记（稳定 ID 保留用于修订映射；均不再为阻断项）：

| Finding ID | 前轮严重度 | 修订验证（本轮独立复核） | 状态 |
|---|---|---|---|
| F1 codec 测试改写清单不完整 | MAJOR | D7 改动 ①②③ + `PINNED_FRAME_HEX` 头部长度同步（`2d→2e`/`32→33`/`3a→3b`，独立复算正确）+ §10 矩阵行 + §11 条目升级 + §12「判别力保持」行 + §13 风险 4；本评审 516 行逐行核对无残留必红/伪绿点 | **已解决（验证通过）** |
| F2 encode 侧补测无 ALLOW 落点 | MAJOR | ALLOW 新条目 + §12 冻结清单（负控 ①–⑧ = 前轮钉死 ①–⑤ 全采纳 + D4 分支镜像 ⑥–⑧；正控 P1–P5）+ §10 矩阵行；三处一致、每条 D4 规则线 ≥1 执行面 | **已解决（验证通过；O5 为非阻断增强建议）** |
| F3 §22 收口措辞声称未实现资产 | MAJOR | D10 二分模板（codec 向量支「已交付 + 指向资产」/ 传输层资产支维持待交付）+ §6 R37 行吸收 R39 + §12 验收判据「§22 内零传输层资产已存在表述」+ §13 风险 6；doc-contract 锚兼容性实测 | **已解决（验证通过）** |
| O1 D3 收敛机制叙述误差 | MINOR | D3 步 4 五向量逐条精确化；本评审独立字节级推演全部吻合（§6 表） | **已解决** |
| O2 wire-change 门豁免依据显式化 | MINOR | §12 全仓回归行显式引用（ADR 0022 同版本部署 + 旧形态未发布 + PR #241 OPEN） | **已解决** |
| O3/O4 | MINOR | 无需修订（设计声明维持；O3 正向清单本轮多点抽验仍成立） | 闭合 |

**实施就绪判定：可进入实施**。ALLOW/DENY 与正文一致、测试改写面完整且算术验证、补测落点与冻结清单授权、文档收口模板精确、D6 窄门维持——SA4 可直接按 §11 ALLOW 逐文件实施，SA6 契约三文件为不改一行转绿判据。

## 14. Non-blocking observations

- **O5（encode-symmetry 清单的两个原子镜像半例，建议非必须）**：负控 ①–⑧ 覆盖 D4 全部六条规则线，但两处原子方向无执行面：(a) `transferKind=2 ∧ chunkIndex=0` **缺** `syncRoundId`（「必须存在」方向——③/⑧ 为 kind=1 覆盖了该方向，kind=2 无对应；若实现遗漏该检查，错误将延迟到对端 decode 才暴露而非 encode 响亮失败）；(b) `transferKind=1 ∧ chunkIndex=0` **携** `syncRoundId`（跨族污染的另一方向——⑤ 仅为 kind=2 携 `replicationId`）。建议 SA4 建文件时顺手补为 ⑨⑩（各配相近正控），成本极低；不补不阻断——D4 规则文本无歧义、每条规则线已有 ≥1 负控、SA2 前轮钉死清单已全采纳。
- **O6（codec-issue242 L82 注释残留）**：`ChunkVector.payloadHex` 字段注释「lib0 canonical payload（字段顺序 = ADR 0013 表序）」是文件内唯一未被改动 ③「文件头/用例标题字段序描述行」列名的六字段序描述处。注释级、零断言面、不影响全绿与判别力；建议 SA4 编辑该文件（已在 ALLOW）时同步更正为 ADR 0022 单形态序，避免权威引用残留。
- **O7（正向确认，供 SA4 参考，本轮复验维持）**：① 全仓 grep 与调用矩阵重合（本轮重跑）；② `codec-malformed.test.ts` 的 `NS_VSTR` 仅用于非 0x42 消息（零改动声明实测成立）；③ truncation 套件 GOLDEN 驱动自动覆盖；④ fuzz 断言循环 `Object.entries(msg)` 结构性自动扩展；⑤ `PINNED_FRAME_HEX` 仅在自校验/编码比对两处使用，随 ① 同步后自动一致；⑥ 基线数字对账：3460 总用例 = 3441 绿 + 19 红（2 文件），§5/§12 引用互洽。

## 15. 复核结论

- **F1–F3 定向复核**：三项 MAJOR 全部落实，验收判据与前轮要求逐条对应（见 §13 表）；顺带项 O1/O2 落实并经独立验证。
- **激活门处置（dispatch 点名「preserve the accepted conflict-gate interpretation」）**：D6 窄门原样保留；本轮 §17 L613/L611 字面对照 + CHAIN2_FAMILY 数学复测维持「窄门为唯一一致读法」结论，与 SA8 R38 一致。
- **requiresConflictRecheck = false**：修订均为测试资产完备性/文档措辞精度收窄，零生产语义变化、零 ADR 冲突新面（与 SA8 设计后复审 clear 及前轮 §15 结论一致）。设计可安全进入实施（SA3/SA4），后续由 SA4/SA7 验证实现与活链路。

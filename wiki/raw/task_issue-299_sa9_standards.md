# SA9 Standards 审查报告 — Issue #299（feat：#295 切片 1：0x42 kind 首字段单形态 codec + 聚合上限配置链）

> SA9（独立 Standards 审查者）standards-review 轮产物。dispatch
> `sa-56bd6dbd-d81b-42ba-a4f7-3d36c71bc0d1`，phase standards-review，iteration 0。
> **Worktree**: `/home/wangjian/nomicore-fix-issue-299`（branch `mabf/issue-299`）。
> **被审对象**: 已提交 HEAD `f63c2d2822cc19eb76a64d4a3923f26c3ce18c96`
> （`feat(replication): add kind-first update chunk codec`）的完整交付 diff
> `eb380d7..f63c2d2`——38 文件 +3143/−45（`git show --stat` 本轮亲证）：9 个生产源文件、
> 15 个测试文件（含 SA6 契约三文件 + 新增 encode-symmetry）、1 行协议文档收口、
> 6 个 wiki/raw 流水线产物、7 个 artifacts 证据文件。父提交
> `eb380d7aed296c15accf8832a45a96b630f0c8ce`（`git rev-parse HEAD~1` 亲证一致，= dispatch
> 声明的 authoritative parent base：#295 docs 分支头，含 ADR 0019 与协议 §5/§10.3/§17
> 目标契约冻结）。工作树除未跟踪简报 `task_issue-299.md` 与 SA7/SA6 部分证据日志外干净。
> **Issue 评论输入**: dispatch 明示 REST comments 读 = `[]`；简报 §Comments、SA6 §2、
> SA8 §0（双通道实测）、SA2 §4、SA4 §1、SA7 §1 六处同口径——无 Owner 追加要求需并入。
> **输入产物（全部亲读）**: `task_issue-299.md`（简报，What to build + AC1–AC4）、
> `task_issue-299_design.md`（SA1 iteration 2 全文 434 行，D1–D10 + §10 矩阵 + §11
> ALLOW/DENY + §14.1/§14.2 修订映射）、`task_issue-299_sa2_review.md`（approve，
> 0 MAJOR，F1–F3 已解决 + O5/O6）、`task_issue-299_sa3_impl.md`、
> `task_issue-299_sa4_review.md`（approve，0 BLOCKER/MAJOR，1 MINOR=M1 台账路由）、
> `task_issue-299_sa6_contract.md`（approve，21 红 + 5 负控 + 2 类型面红，§13 sha256
> 锁定）、`task_issue-299_sa7_report.md`（approve）、SA8 门禁两份（clear，R32–R41）、
> 规范基线 ADR 0019/0013 全文、协议 §10.3/§17/§22 原文、CONTEXT.md L154–171 词条、
> 根 `AGENTS.md`、`docs/AGENTS.md`、两包 `AGENTS.md`。
> **审查方式**: 独立取证，非结论复用——交付 diff 全量亲读（`git diff eb380d7 f63c2d2`，
> 生产 9 文件逐行 + 测试 15 文件逐行 + 文档 1 行）；契约三文件 sha256 复跑
> （= SA6 §13 锁定值逐字节一致）；DENY 清单反向 grep（零命中）；构造点全仓独立 grep
> （`kind: 'UPDATE_CHUNK'` src 4 处 + 测试 13 文件，与 §10 矩阵三方口径重合）；
> `.only/.skip/.todo` 扫描（零命中）；过期术语扫描（`双形态`/`CAP_CHUNKED_SYNC`，
> 规范面零命中）；`git diff eb380d7 f63c2d2 --check`（干净）；hub/peer 构造器
> 校验时序亲读（守卫先于 `this.limits = limits`）；协议 §10.3 字段表/§17 校验块
> 与实现逐字对照；docs/AGENTS 文档纪律逐条对照 §22 收口 diff。未运行测试、未启动
> 服务（SA9 纪律）；零代码/设计/测试改动；零 commit/push/PR；唯一写入 = 本文件。
> **职责面**: 只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、
> 生命周期对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **0 BLOCKER / 0 MAJOR / 0 MINOR**。交付在 AGENTS 链、ADR 保真、模块责任、
  架构惯例、单一事实源、生命周期对称性、文件范围、测试质量八个 standards 面全部
  合规（§1–§8）。
- 交付 diff 与设计 iteration 2 的 §11 ALLOW 台账**逐条一致**（§6 亲证）：SA4 唯一
  MINOR（M1：observer-red +2 行落在 ALLOW 外）已由设计 iteration 2 台账补正收口，
  提交面上 ALLOW 外条目为零；DENY 全清单零触碰（含契约三文件 sha256 逐字节复测一致）。
- D1–D10 全部按批准设计落地且与协议 §10.3/§17 规范原文逐字同向；协议 §22 L701
  二分收口符合 docs/AGENTS「不得虚构实现行为」纪律（codec 向量支标记已交付并指向
  在仓资产、传输层资产支维持待交付表述）。
- 流程面合规：SA6 契约 approve → SA8 前置门禁 clear → SA1 设计 → SA8 设计后复审
  clear → SA2 approve（iteration 1）→ SA3 实现 → SA4 approve（M1 路由 design）→
  SA1 iteration 2 台账补正 → SA7 approve——审查链完整，无跳级、无未决阻断项。

---

## 1. AGENTS.md 链合规

| 规约 | 本轮亲证 | 判定 |
|---|---|---|
| 根 AGENTS「Module guidance：读最近嵌套 AGENTS」 | 两包 AGENTS 均亲读并逐条对照（下两行）；docs/AGENTS 对照 §22 改动（§1 末行） | ✅ |
| replication-protocol AGENTS「strict, fail-closed decoding：validate limits before allocation、fully consume payloads、reject malformed/non-canonical/unknown/trailing with stable classifications」 | `decodeUpdateChunk`（payloads.ts L669–726）：kind 首字段先行读取 + 非法值立即 `throwMalformed`（首字节流入即拒）；绑定块仅按 wire 位置读取（`transferKind !== 0 && chunkIndex === 0`），缺块/越位/尾随经 canonical reader 欠载与既有全消费检查收敛——未新增任何专门分支；`bytes` 限额/非空/≤totalBytes/全消费纪律零改动；分类仅既有 `MALFORMED_FRAME`/`UPDATE_TOO_LARGE` | ✅ |
| replication-protocol AGENTS「compatibility registries append-only；never renumber or silently reinterpret」 | 消息码 0x42、capability bit 0x00000001、错误码、close 分类注册表零改动（diff 无 registry/observer/canonical 命中）；0x42 payload 形态改写属 ADR 0019 显式授权（「ADR 0013 冻结的六字段形态作废…golden vectors 在本分支内改写为单形态」），非静默 reinterpret | ✅ |
| replication-protocol AGENTS「Wire changes require old/new interoperability evidence + root typecheck/test」 | 豁免依据在设计 §12 全仓回归行显式登记并经 SA2 O2/SA4 N-Obs5 复核自洽：ADR 0019 同版本部署假设（部署前提节）+ 旧六字段形态从未发布（SA8 C4 实测 PR #241 OPEN）+ v1 代际端照旧 `UNSUPPORTED_MESSAGE_TYPE` 的非互破译由既有机制承载；同版本自互通证据 = 改写后 golden 三向量 + 契约冻结向量 + 既有 interop 矩阵（500 用例套件内绿，SA7 §4 实测）；root `pnpm typecheck` exit 0（SA3/SA7 双轮日志） | ✅（豁免已文档化） |
| replication-protocol AGENTS「Add public APIs only through `src/index.ts`；exported types and runtime codec behavior must evolve together」 | `UpdateChunkTransferKind` 经 `src/index.ts` 导出（diff 第 1 行）；类型面（messages.ts）与 codec 行为（payloads.ts）同提交同步演化 | ✅ |
| replication-protocol AGENTS「codec transport- and Registry-independent」 | payloads.ts 零新 import、零跨帧状态；diff 审读无模块级状态新增 | ✅ |
| ws-replication AGENTS「Preserve protocol ordering and FSM invariants」 | 零状态机改动：连接/namespace/assembly FSM 无 diff（DENY 五文件零触碰亲证）；配置校验 = 构造期一次性纯函数 | ✅ |
| ws-replication AGENTS「Export production APIs through `src/index.ts`」 | `validateChunkedBootstrapChain`/`validateChunkedSyncDiffChain` 为包内导出但**不经** `src/index.ts`（`grep validate packages/ws-replication/src/index.ts` 零命中亲证）——与 `validateChunkedTransferChain` 既有待遇同构 | ✅ |
| docs/AGENTS「code behavior changes → update every normative document whose stated contract changed；documentation-only wording changes must not invent implementation behavior」 | 规范契约改动（§5/§10.3/§17/CONTEXT/ADR 0019）已在父 base（`2ca06f6`+`eb380d7`）就位，本票义务面 = §22 L701 一行收口：codec 向量支改写为「已由实现 ticket 交付」并指向**在仓可解析**资产（`codec-issue299-ac-red.test.ts`/`codec-messages-golden.test.ts`/`fixtures.ts` 三路径均实测存在）；传输层 kind=1/2 资产支维持「由 §8.1/§9.2 后续切片交付，本规范不预设其存在」——零虚构 | ✅ |
| docs/AGENTS「Use repository vocabulary exactly；update CONTEXT.md when introducing/changing a domain term」 | 新注释/文档用词（单形态、绑定块、同版本部署假设、kind 三态）全部取自 CONTEXT.md L154–171 既有词条（亲读：五词条已在父 base 并入 ADR 0019 语义）——零新术语发明，CONTEXT 同改义务不触发（设计 DENY 声明与实测一致） | ✅ |

## 2. ADR 保真（交付逐条对照 ADR 0019 决策节）

| ADR 0019 决策 | 交付落点 | 判定 |
|---|---|---|
| 消息形态：kind varUint 首字段 + 五字段序不变 + 绑定块（kind=1 → replicationId varString + replicationEpoch varUint；kind=2 → syncRoundId varUint）位于 totalBytes 之后、bytes 之前 | decode 读序 = kind → ns → transferId → chunkIndex → chunkCount → totalBytes → [绑定块] → bytes；encode 写序逐字镜像（先验证后写）；与协议 §10.3 字段表亲读逐字一致 | ✅ |
| codec 单帧规则追加 `kind ∈ {0,1,2}`、绑定块当且仅当 `kind≠0 ∧ chunkIndex=0`（违者 MALFORMED_FRAME） | decode 首字节门 + encode iff 八分支严格拒绝（不归一化）；旧六字段首字节 0x23=35 ∉ {0,1,2} 自动作废（契约 R5 覆盖） | ✅ |
| 六字段形态作废、golden 本分支改写 | fixtures.ts 三 golden 前缀 `00`/`01`/`02` + `transferKind` 0/1/2（kind 全覆盖；MULTIBYTE idx=63/U32_MAX idx=0xfffffffe 非首 chunk 故无绑定块——iff 自洽）；`GOLDEN` 计数 21 锚零改动 | ✅ |
| 配置表：两新键缺省各 4 MiB、约束 ≤ maxChunksPerUpdate × maxUpdateBytes | defaults.ts +2 键（`4 * 1024 * 1024`，键集 14→16）；validate.ts 两个一不等式函数（`<=` 含等号、错误消息含三操作数值） | ✅ |
| 安全缺省、启动期响亮验证、绝不运行时 clamp | 构造器 `hasOwnProperty` 守卫 → 违例构造期 TypeError、先于 `this.limits = limits`（hub L218/peer L132 亲读）；零 clamp 代码路径 | ✅ |
| 三机制键 kind 无关、键名不变 | `maxChunksPerUpdate`/`maxConcurrentAssembliesPerConnection`/`assemblyTimeoutMs` 零改名零漂移（契约 C1 键集断言锁定） | ✅ |
| control reserve 校验原样保留 | validate.ts `maxQueuedControlBytes ≥ maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES` 块零 diff（负控 C6 绿） | ✅ |
| append-only 冻结面：错误码/RESYNC reason/observer 8 型属后续切片 | 零新错误码、零 observer 事件 diff（R36）；`BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 死码原样保留 | ✅ |
| 非目标：无 CAP_CHUNKED_SYNC 协商、无双形态、无 gating、无向前兼容面 | 零协商面 diff（协商门负控 N1 保持绿）；发送端硬编码 `transferKind: 0` 无 gating 分支 | ✅ |
| ADR 0013 保持面：0x42 解码侧协商门不动 | payloads.ts decode 分发与 `codec-issue242-ac-red.test.ts` 协商锚保留（该文件按 D7 三处改写为单形态前缀化，判别力恢复——`hostilePayload` 缺省 `'00'` kind 前缀使字段级规则重新可抵达，SA2 F1/E4 伪绿修复落实） | ✅ |

## 3. 模块责任与既有架构惯例

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 单帧 codec 规则归属 replication-protocol | payloads.ts 纯函数、零跨帧状态（R33）；transport/Registry 无依赖渗入 | ✅ |
| 启动期配置校验归属 ws-replication 构造期 | validate.ts 纯函数 + hub/peer 构造器守卫（先于字段赋值）；插件 `apply` 经 `mergeNested` 同一入口继承（C7 绿） | ✅ |
| transferId 计数器归属 update-channel（发送端状态） | `update-channel.ts` 零 diff（DENY 保持）；AC4 本切片仅 codec/契约层锁定字段语义（R11/R12），复用既有 `nextTransferId` 的约束在设计 D8/SA3 §Deferred 显式登记——未新增第二计数器 | ✅ |
| 相似能力同构 | 两个新链函数与 `validateChunkedTransferChain` 同构（`assertCollKind` + 三操作数消息）；hub/peer 两条新守卫与 #244 家族门块同形且置于其后、双侧逐字对称（diff 亲证） | ✅ |
| 必填键的测试字面量跟随惯例 | observer-red `limits` 字面量 +2 行注释形态「issue #295：slice 1 新增字段（缺省值）」与同字面量 #243/#244 行逐形同构（仓内既有惯例第三次应用） | ✅ |
| cast 纪律 | payloads.ts 收窄 cast（`as 0 | 1 | 2`、`as string`/`as number`）均在运行时守卫之后，与既有 L427 `mode as 0 | 1` 先例同形；encode-symmetry 的 `as unknown as UpdateChunkMsg` 是 D4 显式点名的「JS/cast 防御」被测面本身 | ✅ |

## 4. 单一事实源

| 事实 | 权威源 | 派生面 | 漂移风险 |
|---|---|---|---|
| wire 字段序/单帧规则 | 协议 §10.3（规范） | payloads.ts 注释块锚定 §10.3 + ADR 0019；fixtures 注释同步升级 | 无（注释为指针非副本；契约 R1–R14 + golden 常驻机械门） |
| 配置缺省值 | `DEFAULT_REPLICATION_LIMITS` | `resolveLimits` Partial 合并唯一展开点；observer-red 字面量为测试局部夹具且值逐字等于缺省（非第二运行时事实源） | 无 |
| golden 向量 | `fixtures.ts` GOLDEN（21 锚） | #242 契约三向量与 golden 逐字一致保持（D7 同步改写）；绑定块形态由 SA6 契约冻结向量 `KIND1_FIRST`/`KIND2_FIRST` 锁定（单一权威，不进 fixtures） | 无 |
| 链②判据与错误消息 | validate.ts 两函数 | hub/peer 仅调用不复制判据 | 无 |
| 词汇 | CONTEXT.md L154–171 | 全部注释/文档词形取自词条 | 无 |

无第二计数器/缓存/worker/日志格式/重试环引入。

## 5. 生命周期对称性

- **无新 acquire/release、无后台任务、无新资源所有权**：codec 纯函数；配置校验构造期单线程一次性；绑定块成员随消息对象生命周期；无新 buffer 分配路径（`readVarUint8ArrayCopy` 既有拷贝纪律不变）。
- **构造器失败语义对称**：hub/peer 双侧守卫逐字对称、违例同消息（SA7 探针 15 构型 × 双入口实证）；违例时无部分初始化（守卫先于 `this.limits = limits`、服务不注册——插件路径 C7(3) 实证 unavailable）。
- **错误路径对称**：decode/encode 同一套单帧规则（R9 对称纪律），违例同收敛 `MALFORMED_FRAME`；fatal close(1002) 分类不变。

## 6. 文件范围（ALLOW/DENY 对照提交 diff）

| 交付路径面 | 设计 iteration 2 ALLOW/DENY | 本轮亲证 | 判定 |
|---|---|---|---|
| replication-protocol src：messages/payloads/index | ALLOW #1–3 | diff 逐行吻合 D1–D4（类型面 + 单形态 codec + 导出） | ✅ |
| ws-replication src：types/defaults/validate/plugin/hub/peer | ALLOW #4–9 | diff 逐行吻合 D5/D6/D8（两必填键/两缺省/两值门+两链②/allowlist +2/守卫+`transferKind: 0`） | ✅ |
| protocol test：fixtures/issue242/encode-symmetry(新)/golden/fuzz/api.test-d | ALLOW #10–15 | 逐行吻合 D7/D9/SA2 F1/F2；`PINNED_FRAME_HEX` 头长 `2d→2e`/`32→33`/`3a→3b` 与 payload +1 字节算术自洽（buildFrameHex 自校验用例机械锁定） | ✅ |
| ws test：issue243-ac-red/chunked-live、issue244-ac-red、issue246-interop、api.test-d、observer-red | ALLOW #16–24（observer-red 行 = iteration 2 台账补正，含五要素依据） | 构造点 9 处 +`transferKind: 0` 逐处吻合；类型锁 +2 键；observer-red 恰 +2 行缺省键（与台账预期改动逐字一致——SA4 M1 已闭环） | ✅ |
| ALLOW 内零改动 4 文件（real-transport/sa7-dynamic/slot-reclaim/issue245） | iteration 2 更正为「零改动必要（保留许可位）」 | 本轮独立 grep：4 文件均仅 `type ChunkMsg = Extract<…, { kind: 'UPDATE_CHUNK' }>` 类型级提取（L58/L104/L96/L97），零对象字面量构造——零改动正确 | ✅ |
| `docs/protocols/instance-replication-v1.md` 仅 §22 L701 | ALLOW #23 | diff 恰 1 行替换；`0x42`/`0x00000001`/四资产名锚与 L707 义务句零触碰（diff 上下文亲证） | ✅ |
| SA6 契约三文件 | DENY（sha256 锁定） | `sha256sum` 复测 = `3168f11c…`/`56a2337b…`/`171104c2…`，与 SA6 §13 逐字节一致——未改一行 | ✅ |
| DENY 面：update-transfer/update-channel/hub-namespace/peer-namespace/frame-io、docs/adr、协议 §5/§10.3/§13.2/§17 及其他节、CONTEXT.md、apps/yjs-server、registry/observer/canonical | 冻结 | `git diff --name-only` 反向 grep 零命中（exit 1） | ✅ |
| wiki/raw 6 产物 + artifacts 7 证据 | 流水线固定产物 | 与 #274 等合并先例一致 | ✅ |

## 7. 测试质量标准

| 检查项 | 本轮亲证 | 判定 |
|---|---|---|
| 削弱标记 | 全部触及测试文件 `.only`/`.skip`/`.todo` 零命中（grep 亲证）；零 env override、零 fallback（encode-symmetry 纪律头注 + 扫描） | ✅ |
| 断言强度 | 契约 C 面断言 `toThrow(TypeError)` 类型级 + 边界等号接纳/off-by-one 拒绝双向敏感度（C2/C3），非源码字符串断言；encode-symmetry 双断言 `ProtocolError` 实例 + code；P2/P3 以规范算术向量逐字节锁定绑定块位置 + decode→encode→re-encode 逐字节往返 | ✅ |
| 负控保持 | N1–N3/C5/C6 五负控设计为「实现后必须保持绿」（SA6 §6），SA3/SA7 双轮日志绿；契约三文件未改一行转绿（sha256 亲证） | ✅ |
| 判别力保持/恢复 | #242 敌意套件 `hostilePayload` 缺省 `'00'` 前缀 + `kindHex` 覆盖键——字段级规则（非 canonical/UTF-8/超声明/尾随）在单形态下重新可抵达（SA2 F1(b) 伪绿修复）；L225–232 字段序断言升级为 kind→ns→五字段全序 | ✅ |
| golden/截断/fuzz 覆盖 | golden 三 kind 全覆盖且计数 21 锚不变；truncation 套件 GOLDEN 驱动自动覆盖单形态；fuzz case 18 生成器扩展为 kind ∈ {0,1,2} × idx ∈ [0,count) × 绑定块 presence 按 iff 推导（结构性覆盖，断言循环 `Object.entries` 自动携带新成员；缺失侧由 encode-symmetry P4/P5 `toBeUndefined()` 锁定） | ✅ |
| 收集入口真实性 | 新增 `codec-issue299-encode-symmetry.test.ts` 命中根 vitest `include: ['packages/*/test/**/*.test.ts']`；两 `.test-d.ts` 命中 typecheck include（vitest.config.ts L15/L20 亲读） | ✅ |
| 执行证据 | SA3 日志：契约 31/31 绿 + protocol 213/213 + ws-replication 500/500 + 根 typecheck exit 0；SA7 复核同数 + 探针删除后 52/52 重跑一致。SA9 按纪律不复跑测试，静态面本轮独立复核全部成立 | ✅ |

## 8. SA4 批准面 == 已提交 HEAD（一致性核验）

SA4 于 `eb380d7` 工作树批准实现（M1 路由 design）；SA1 iteration 2 台账补正（§11 ALLOW
增 observer-red 行 + §10 矩阵更正 + N-Obs1 收窄）零实现改动要求。本轮核验提交
`f63c2d2`：设计文档含 §14.2 修订映射（434 行全本入库）、实现 diff 与 SA3 声明的
21 M + 新增清单逐条一致、SA7 复核「tracked 变更集合 = SA3 声明」亲证在案。
**批准面（设计 iteration 2 + 实现）与提交面零偏差。**

## 9. Findings 与 Non-blocking observations

**0 BLOCKER / 0 MAJOR / 0 MINOR 修订项。** 以下为非阻断观察（无 Required action）：

- **O-1（nit，流程）**：提交消息 `feat(replication): add kind-first update chunk codec`
  未携带 `(#299)` 引用（SA3 建议消息为 `feat(#299): …`；近期 `fix(#246)…(#294)`、
  `feat(ws-replication): observe chunked update lifecycle (#281)` 两惯例并存）。根/docs
  AGENTS 均未规定提交消息格式——非文档化标准违规，仅记观察（与 #274 SA9 O-1 同款）。
- **O-2（流程）**：AC 面全仓 `pnpm test`（328 文件）终态门未在 SA3/SA7 会话执行——
  已按设计 §12/SA4 §11 既定路由移交 Controller 合流前最终门；已执行面 = 受影响两包
  全套件（213+500）+ 根 `pnpm typecheck` exit 0 + 契约 31/31 + 传输构造点/真实 TCP/
  互通矩阵聚焦 41/41（SA7 日志），覆盖全部可受影响面。SA9 纪律不运行测试；该项属
  Controller 终态验证面，非 standards 阻断（与 #274 SA9 O-2 同款）。
- **O-3（观察）**：简报 `wiki/raw/task_issue-299.md` 与部分证据日志
  （`artifacts/sa6-issue299-red-detail.log`、`artifacts/sa7-issue299-*.log` 5 个）未跟踪，
  而 sa3/sa6 其余日志与 sa8 门禁已随票入库——证据收纳节奏存在轻微不对称；
  wiki/raw 与 artifacts 均为证据面非规范契约（docs/AGENTS「Authority」节），
  收纳节奏属 Controller finalize 面（与 #274 SA9 O-3 同款）。
- **O-4（正向确认）**：SA4 唯一 MINOR（M1）的处置链完整闭环——SA3 诚实登记 →
  SA4 五要素静态证明并路由 design → SA1 iteration 2 台账补正（§11 ALLOW + §10 矩阵
  + N-Obs1 收窄）→ 提交面 ALLOW/diff 一致（本轮 §6 亲证）。M1 边界条件（五要素齐备
  的机械跟随方可援引）已在设计 §14.2 回写，防先例滥用。
- **O-5（观察）**：SA6 契约文档内部张力（§10/§15.4 散文宽门 vs C2/C3 可执行断言
  窄门）由设计 D6 显式推导 + SA8 R38 三层核实裁决为窄门，「可执行契约优先于散文」
  的效力序符合 docs/AGENTS「wiki/raw 为 evidence、非规范契约」与 SA8 §2.4 既定
  框架；契约文件按转绿判据未改一行。若后续裁定宽门须走契约修订出口——已登记于
  设计 §13 风险 1，非本票缺口。

## 10. requiresConflictRecheck

**false。** 交付与 SA8 已裁定 clear 的设计（前置 R32–R37 + 设计后复审 R38–R41）逐条
一致；iteration 2 台账补正为纯登记一致性修订（设计 §15 自评 false，理由三层亲证成立）；
规范面（ADR、协议 §5/§10.3/§13.2/§17、CONTEXT）零触碰；无新决策面接触、无新错误码/
observer 事件/生命周期所有权；SA2 §15 与 SA4 §11 同裁 false。实现期防回潮由常驻机械门
兜底（契约 R1–R14/C1–C7/N1–N3 + golden 21 锚 + 类型面锁）。

## 11. 本轮独立取证命令留痕

```
git log --oneline -15 && git status --short                # HEAD=f63c2d2；工作树仅未跟踪证据
git rev-parse HEAD~1                                       # eb380d7… = dispatch 声明 base
git show --stat f63c2d2                                    # 38 文件 +3143/−45
git diff eb380d7 f63c2d2 -- <生产 9 文件/测试 15 文件/docs>  # 交付全文亲读
git diff eb380d7 f63c2d2 --check                           # 干净（零空白错误）
git diff eb380d7 f63c2d2 --name-only | grep -E <DENY 模式>  # 零命中（exit 1）
sha256sum <契约三文件>                                      # = SA6 §13 锁定值逐字节一致
grep -rn "kind: 'UPDATE_CHUNK'" --include="*.ts" packages apps domains tests
                                                           # src 4 处 + 测试 13 文件，与 §10 矩阵重合
grep -n "transferKind" packages/*/src                      # 构造点 2 处 + codec 面，无遗漏
grep -cn "\.only\|\.skip\|\.todo" <触及测试 6 文件>          # 全零
grep -rn "双形态\|CAP_CHUNKED_SYNC" docs/ CONTEXT.md        # 规范面零命中（CONTEXT L167 仅 _Avoid_ 条）
grep -n "validate" packages/ws-replication/src/index.ts     # 零命中（包内私有纪律保持）
grep -n "include" vitest.config.ts                          # L15/L20 收集入口亲读
sed -n '195,222p' packages/ws-replication/src/hub-connection.ts  # 校验先于字段赋值亲读
sed -n '300,350p;575,620p' docs/protocols/instance-replication-v1.md  # §10.3/§17 原文对照
sed -n '150,172p' CONTEXT.md                               # 五词条 ADR 0019 语义已在位
```

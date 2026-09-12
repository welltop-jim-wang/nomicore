# SA4 实现静态审查 — issue #299（feat：#295 切片 1：0x42 kind 首字段单形态 codec + 聚合上限配置链）

- **dispatch**: sa-b018b20d-420e-49f9-b300-44ac127317e6（mabf-sa4 / implementation-review / iteration 0）
- **审查对象**: SA3 实现（dispatch `sa-9e8e1172-6b2a-4a6a-83a6-78665f8ec6dd`；报告 `wiki/raw/task_issue-299_sa3_impl.md`）对已批准设计 iteration 1 的落地 + 测试/文档
- **HEAD**: `eb380d7aed296c15accf8832a45a96b630f0c8ce`（分支 `mabf/issue-299`；工作树含实现 diff，与 SA3 报告声明一致）
- **Verdict**: **approve** — 0 BLOCKER / 0 MAJOR / 1 MINOR（M1：范围外 +2 行偏差需设计 ALLOW 台账补正；实现本身正确且必要，见 §4-A 与 §10）

## 1. Reviewed inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-299.md` | 在库（正文 + AC1–AC4；comments 段为空） |
| 批准设计 | `wiki/raw/task_issue-299_design.md`（iteration 1） | 在库；D1–D10 / §10 矩阵 / §11 ALLOW / §12 验证映射逐项核对 |
| SA2 设计评审 | `wiki/raw/task_issue-299_sa2_review.md`（approve，F1–F3 已解决 + O5/O6 建议） | 在库 |
| SA6 验收契约 | `wiki/raw/task_issue-299_sa6_contract.md`（approve，21 红 / 5 负控 / 2 类型面红；§13 sha256 锁定） | 在库 |
| SA6 红证据 | `artifacts/sa6-issue299-{red-evidence,red-detail,probe,existing-suites,full-suite}.log` | 在库 |
| SA8 前置门禁 + 设计后复审 | `artifacts/sa8-conflict-gate-issue-299{,-design-recheck}.md`（clear，R32–R41） | 在库 |
| SA3 实现报告 + 验证日志 | `wiki/raw/task_issue-299_sa3_impl.md`、`artifacts/sa3-issue299-verification.log` | 在库 |
| 实现源码/测试/文档 diff | `git diff`（21 M + 3 新测试文件 + 证据/报告，全量逐文件审读） | 本轮逐行 |
| `relevant_decisions` / `conflict_report` | 不存在 | 设计/SA6/SA2 三方已登记；以 ADR 0022/0013/0010 + 协议 + SA8 门禁为规范依据，非阻断 |
| Issue 实时核验 | comments = 空（Host dispatch + SA6 §2 + SA2 §4 三方一致） | 无 Owner 评论映射项 |

本轮全部结论基于源码/diff/日志的静态证据；未运行测试、未启动服务（SA4 职责边界），动态结论引用 SA3 日志并列入 §11。

## 2. Verdict

**approve**。理由：

1. **上游契约零改**：SA6 契约三文件 sha256 本轮复测 = `3168f11c…` / `56a2337b…` / `171104c2…`，与 SA6 §13 锁定值逐字节一致——「不改一行 26/26」转绿判据的对象未被触碰；SA3 日志 §2 实测 31/31 绿（契约 7+17+2 类型面 + encode-symmetry 5）。
2. **D1–D10 逐项落实**（§4 表）：单形态 codec、绑定块 iff 严格拒绝、配置五面、窄门链②、golden 改写、#242 判别力修复、fuzz 扩展、§22 二分收口——全部与设计/SA2 冻结清单逐字对应，无遗漏、无越权语义。
3. **DENY 零触碰**（§6 表）：传输/assembly 五文件、ADR、协议 §5/§10.3/§13.2/§17、CONTEXT、apps/yjs-server、错误码冻结面全部无 diff 条目。
4. **唯一偏差 = `ws-replication-observer-red.test.ts` +2 行**（dispatch 点名项）：经静态证明为设计自身强制（D5.1 必填类型面 × §12 根 typecheck 零错误判据的唯一可满足解）、值正确（= DEFAULT）、行为零影响（新键无任何 src 行为读者）、最小（仓内唯一全量 `ResolvedLimits` 字面量）、有先例（同字面量 #243/#244 切片两次同形机械跟随）、诚实登记（SA3 §Deviations 完整记录 + 建议 ALLOW 补行）。按技能「必要偏离记录证据与建议路由」处置为 MINOR（M1，路由 design），不构成 MAJOR「范围越界」——变更内容是本任务自身类型面的编译期必改点，非能力/行为/域扩张；边界条件见 §10。
5. 测试质量（§9）：无 skip/only/todo、无源码字符串断言弱化、负控保持、判别力恢复、runner 入口全部命中。

## 3. 上游要求落实

Owner 评论：无（REST comments 空，三方一致）。验收目标 = issue 正文 + AC1–AC4 + SA6 契约 + SA8 R32–R41。

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| AC1 单形态 codec + golden 改写 | payloads.ts decode/encode 重写（kind 首字段 + 绑定块按位）；fixtures.ts 三 golden 前缀 `00/01/02` + `transferKind` 0/1/2，计数 21 不变；契约 R1–R6 绿（日志 §2/§3） | 落实 |
| AC2 kind/绑定块单帧规则（解码侧） | decode kind ∉ {0,1,2} 首字节即拒；绑定块仅 `kind≠0 ∧ chunkIndex=0` 按位读取，无专门分支；契约 R7–R10 绿 | 落实 |
| AC2 编码侧对称（SA2 F2/O5） | 新文件 `codec-issue299-encode-symmetry.test.ts`：负控 ①–⑩ + 正控 P1–P5，P2/P3 规范算术锁定向量 + 逐字节往返；5 用例绿 | 落实（含 O5 ⑨⑩） |
| AC3 两键 + 两链② + 等号敏感度 + 非追溯性 + control reserve | types/defaults/validate/plugin 四面 + hub/peer 构造器 `hasOwnProperty` 守卫；契约 C1–C7 全绿（含 C2/C3 边界族 =2MiB 接纳/+1 拒绝、C5 三支、C6） | 落实 |
| AC3 类型面 | `ws-replication-api.test-d.ts` +2 键必填 number 锁；契约 `.test-d.ts` 2 红转绿（日志 §2 `Type Errors no errors`） | 落实 |
| AC4 transferId 三 kind 一致 | 既有 transferId 检查不动（值域 kind 无关）；R11/R12 绿；计数器零改动（`update-channel.ts` 无 diff，DENY 保持） | 落实（契约层锁定，符合 D8/R33） |
| SA8 R32/R34/R36 | 无协商面改动（协商门/`codec-issue242` 锚原样）；零新错误码/observer 事件（仅既有 MALFORMED_FRAME/UPDATE_TOO_LARGE/UNSUPPORTED_MESSAGE_TYPE/CONNECTION_POLICY_VIOLATION + TypeError）；负控 N1 绿 | 落实 |
| SA8 R37/R39（§22 二分收口） | docs diff 仅 L701 一行：codec 向量支「已交付」+ 指向在仓资产；传输层资产支维持「由 §8.1/§9.2 后续切片交付，本规范不预设其存在」；§22 内零「传输层资产已存在」表述；doc-contract 22/22 绿（日志 §3） | 落实（SA2 F3 验收判据满足） |
| SA2 F1（#242 改写完整性） | 三向量 +`transferKind:0`/`'00'` 前缀、`PINNED_FRAME_HEX` 头长 `2d→2e`/`32→33`/`3a→3b`、`hostilePayload` 缺省 `'00'` + `kindHex` 键、L225–232 全序断言、文件头/L82 注释升级（O6）；issue242 28 用例绿 | 落实（伪绿消除） |
| SA2 F2 | encode-symmetry 进 ALLOW 并落仓，不触契约三文件 | 落实 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1 `UpdateChunkTransferKind` / 必填 `transferKind` | messages.ts（新类型 + 必填成员 + 注释锚）；index.ts 导出 | 与设计逐字一致（必填非可选；异名判别键） | — |
| D2 绑定块可选成员 + codec 唯一裁决 | messages.ts 三个可选成员；decode 条件展开（无显式 `undefined` 键） | 一致 | — |
| D3 decode kind 先行 + 按位读绑定块 | payloads.ts `decodeUpdateChunk`：`readVarUint` → 非法即 `throwMalformed`；五字段既有序；`kind≠0 ∧ idx=0` 读绑定块（kind1=RID+epoch / kind2=syncRoundId）；bytes/限额/全消费纪律不变 | 一致；无专门尾随分支（O1 遵循）；KIND1_FIRST/KIND2_FIRST 向量手验解码序吻合 | — |
| D4 encode iff 严格拒绝（六规则线） | payloads.ts `encodeUpdateChunk`：kind 值域（safe int ∈{0,1,2}）→ kind=0 三成员任一拒 / kind≠0∧idx>0 携带拒 / kind1∧idx=0 缺一拒+携 syncRoundId 拒 / kind2∧idx=0 缺 syncRoundId 拒+携异族拒；值域仅结构 + 可编码性（epoch/syncRoundId safe uint ≥ 0，RID 仅 string）——无 §8.1/§9.2 语义抢占 | 一致（无归一化；写序=读序镜像，先验证后写） | — |
| D5 配置四面 | types.ts 两必填键；defaults.ts 两键 4 MiB（键集 14→16，timeouts 零漂移）；validate.ts 两 `positiveSafeInteger` 值门；plugin.ts `LIMIT_KEYS` +2 | 一致 | — |
| D6 链②窄门 | validate.ts 两个独立一不等式函数（错误消息含三操作数）；hub/peer 构造器在既有 #244 门块后各加两条 `hasOwnProperty` 守卫、判定在 resolve 合并结果、先于字段赋值；#244 家族门零语义变化 | 一致；与契约 C2/C3 边界族、C5(a)（经 #244 链②响亮）逐支相容（手验） | — |
| D7 golden 改写 + #242 三处改动 | fixtures.ts（BASIC=0/MULTIBYTE=1/U32_MAX=2，iff 自洽：idx=0xfffffffe>0 无绑定块）；codec-issue242 ①②③ + PINNED 头长同步 + 注释（O6） | 一致；golden 计数 21 断言零改动 | — |
| D8 发送 `transferKind:0` / 接收不消费 | hub/peer `sendUpdateChunk` 字面量 + `transferKind: 0`；`case 'UPDATE_CHUNK'` 展开转发/assembly 五文件零 diff；`ChunkedTransferPiece` 不加 kind | 一致 | — |
| D9 fuzz 扩展 | codec-fuzz-property case 18：kind 随机 {0,1,2}、idx ∈ [0,count)、绑定块 presence 按 iff 推导 | 一致 | — |
| D10 §22 二分收口 | docs/protocols diff 仅 L701；`0x42`/`0x00000001`/四资产名锚在未改动的 #242/#246 条目行保持；L707 义务句未触碰；D6-1 `existsSync` 可解析新指向（全路径引用） | 一致 | — |
| **§10 矩阵行「observer-red 零改动」** | 实测 +2 行（见 §4-A） | **设计声明与 D5.1×§12 判据不相容——设计矩阵缺陷，非实现越权** | **M1（MINOR，路由 design）** |
| §10 矩阵 4 文件「+transferKind: 0」 | real-transport/sa7-dynamic/slot-reclaim/issue245 实测仅类型级 `Extract<…, { kind: 'UPDATE_CHUNK' }>`，零改动 | 设计矩阵过宽侧；SA3 零改动正确（本轮 grep 逐文件复核） | 非阻塞（ALLOW 内未修改 = 说明项） |

### 4-A. 点名偏差专审：`ws-replication-observer-red.test.ts` +2 行（正确性与范围）

**事实**（diff 全量 = 仅 +2 行）：L809–810 在 `ConnectionSenderHost` 的 `limits` 字面量内追加 `maxChunkedBootstrapBytes: 4 * 1024 * 1024` / `maxChunkedSyncDiffBytes: 4 * 1024 * 1024`，注释与同字面量 #243/#244 行同形（「issue #295：slice 1 新增字段（缺省值）」）。

**必要性（静态证明链，本轮逐环复核）**：
1. `types.ts`：两新键为 `ReplicationLimits` **必填** `readonly number`（D5.1、契约 api.test-d `toEqualTypeOf<number>()` 强制必填面）；
2. `types.ts` L882：`export interface ResolvedLimits extends ReplicationLimits {}`（空继承，无键松弛）；
3. `backpressure.ts` L44：`readonly limits: ResolvedLimits`（非 Partial）；
4. 测试 L799–811 手写**全量** `ResolvedLimits` 字面量 → 缺两键即 TS2739（SA3 报告所引编译错误与本链吻合；根 `pnpm typecheck` 判据 = 设计 §12 转绿条件）。
⇒ 「D5.1 必填类型面 + §12 typecheck 零错误 + §10『observer-red 零改动』」三者数学上不可同时成立——设计 §10/§11 矩阵存在登记缺陷；+2 行是批准设计的唯一可满足解。替代路径全部违反更高优先级约束：键转可选 = 破坏 D5.1 与锁定契约类型面（公共设计降级）；`as` 断言/cast = 测试弱化且违反仓内 cast 纪律；改 `...DEFAULT_REPLICATION_LIMITS` 展开 = 更大 diff 且改写手写字面量风格。

**正确性**：值逐字等于 `DEFAULT_REPLICATION_LIMITS`（4 MiB）；链②合法（4 MiB ≤ 64×512 KiB = 32 MiB）；该字面量仅供 T5「水位 send-paused/send-resumed」`ConnectionSender` 单元测试——本轮 grep 证明两新键在 `src/` 零行为读者（仅 types/defaults/validate/plugin/构造器守卫引用；`codecFieldLimits` 只读 maxUpdate/maxBootstrap/maxSyncDiff 三键）；该测试不直接跑构造器校验链，无 TypeError 触发面；文件内无键集/键计数断言——**零断言面、零行为影响**。

**范围**：仓内唯一全量 `ResolvedLimits` 类型化字面量（其余测试 limits 均为 Partial/harness 形态，本轮逐文件核对：harness.ts 局部接口、issue169 HarnessLimits、observer-red L123/L836/L905/L1715 均 Partial）；既不在 ALLOW 也不在 DENY、非冻结契约；同字面量先例两次（commit `bbdaa65` #243、`9a669f4` #244 同形机械跟随）；SA6 §10 影响面本就列名 `observer-red.test.ts` 为测试资产改写面（上游已预见，设计收窄时误判）。SA3 处置（最小修 + 完整登记 + 建议 ALLOW 补行）符合技能「必要偏离记录证据与路由，不修改设计/实现」。

**裁定**：MINOR（M1）。不构成 MAJOR「范围越界」的依据：变更内容是本任务自身公共类型面的编译期必改点（同包测试夹具消费本任务自己的类型），非能力扩张、非行为变化、非 DENY/契约面；且被批准设计的验收判据强制。修复对象是**设计台账**（§11 ALLOW 增一行 + §10 矩阵行更正），非实现。边界条件（防先例滥用）：本裁定仅覆盖「编译期强制 + 语义惰性 + 值等于缺省 + 最小行数 + 完整登记」五要素齐备的机械跟随；任何带断言/行为语义或非强制的 ALLOW 外改动仍按 MAJOR 处置。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 单帧 codec 规则 | replication-protocol（codec 无状态） | payloads.ts（纯函数，零跨帧状态） | 正确（R33） |
| 链②启动校验 | ws-replication 构造期（生命周期 owner） | validate.ts 纯函数 + hub/peer 构造器（先于字段赋值） | 正确 |
| transferId 计数器 | update-channel（发送端状态） | 零改动（复用既有 `nextTransferId` 约束已登记） | 正确（D8） |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 链式校验函数 | `validateChunkedTransferChain`（两不等式、三操作数错误消息、包内私有） | `validateChunkedBootstrapChain`/`validateChunkedSyncDiffChain` 同构 | 一致 | D6 指定复用形态 |
| 构造器激活门 | hub/peer #244 门块（`hasOwnProperty` 双键） | 两条新守卫同形、置于既有块后 | 一致 | 窄门与家族门并存的唯一一致读法（SA8 R38） |
| 必填键的测试字面量跟随 | observer-red 同字面量 #243/#244 行（bbdaa65/9a669f4） | +2 行同注释惯例 | 一致 | 仓内既有惯例第三次应用 |

### 单一事实源 / 生命周期对称性 / 平行机制

单一事实源：缺省值唯一权威 = `DEFAULT_REPLICATION_LIMITS`（`resolveLimits` 展开；测试字面量仅为测试局部夹具且值等于缺省，非第二运行时事实源）；golden 唯一权威 = fixtures.ts（#242 向量与 golden 逐字一致保持）。无新 acquire/release、无后台任务；无第二计数器/缓存/worker/日志格式/重试环。全部通过。

## 6. 文件范围审查

实际改动 = 21 M + 新增 3 契约文件（SA6 产物）+ encode-symmetry + 证据/报告（技能/惯例固定产物）。

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| replication-protocol src：messages/payloads/index | ALLOW #1–3 | D1–D4 | 在列 |
| ws-replication src：types/defaults/validate/plugin/hub/peer | ALLOW #4–9 | D5/D6/D8 | 在列 |
| protocol test：fixtures/issue242/golden/fuzz/api.test-d | ALLOW #10–15 | D7/D9/类型锁 | 在列 |
| `codec-issue299-encode-symmetry.test.ts`（新增） | ALLOW #12 | SA2 F2 落点 | 在列 |
| ws test：issue243-ac-red/chunked-live、issue244-ac-red、issue246-interop、api.test-d | ALLOW #16–24 | 构造点/类型锁 | 在列 |
| docs/protocols/instance-replication-v1.md（仅 L701） | ALLOW #23 | D10 | 在列（diff 仅 1 行替换） |
| ALLOW 内零改动 4 文件（real-transport/sa7-dynamic/slot-reclaim/issue245） | ALLOW #18–21 | 实测仅类型级 Extract，无需改动 | MINOR/说明项 |
| **`ws-replication-observer-red.test.ts`（+2 行）** | **不在 ALLOW（亦不在 DENY）** | 编译期必改点 | **M1（MINOR，路由 design 补 ALLOW 行）** |
| 契约三文件 / DENY 全清单 | DENY | — | **零触碰**：sha256 本轮复测一致；update-transfer/update-channel/hub-namespace/peer-namespace/frame-io、docs/adr、协议 §5/§10.3/§13.2/§17、CONTEXT、apps/yjs-server、注册表/observer/canonical 均 `git status` 无条目 |

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `UpdateChunkMsg` + 必填 `transferKind`/可选绑定块 | 仓内全部构造点（本轮全仓 grep 含 apps/domains/root tests）：两包 src 2 + protocol 测试 4 文件 + ws 测试 4 文件——全部已表态或类型级提取；无仓外消费方（workspace 包未发布） | 构造点 +`transferKind: 0`；类型级 Extract 无需改动 | 无遗漏（矩阵与 grep 重合） | — |
| 解码产物新字段经连接层 | `case 'UPDATE_CHUNK'` `{...message, sequence}` 展开 → `onUpdateChunk` → assembler | 结构兼容流过，本切片不读取（D8/R41 已登记中间态） | 部署面不可达（同版本 + 首字节不相交） | — |
| `ReplicationLimits` 必填键扩张 | `Partial<ReplicationLimits>` 消费方（app/插件/harness） | Partial 合并自动携带缺省；唯一全量字面量 = observer-red（已处置，M1） | 无 | — |
| 0x42 wire 形态变化 | 对端（同版本）；v1 代际端 | v1 端照旧 `UNSUPPORTED_MESSAGE_TYPE`（负控 N1 绿）；旧六字段首字节 0x23 ∉ {0,1,2} 自动作废（R5 绿） | wire-change 门豁免依据已登记（ADR 0022 同版本假设 + 旧形态未发布） | — |
| `resolved` 链②对插件路径 | plugin `apply` → `mergeNested` 展开保真 → 构造器守卫继承 | C7 绿（allowlist 接纳 + 违例 `TypeError` 且服务不注册） | 无 | — |

## 8. 错误、恢复与并发

- **错误分类零新增**：decode/encode 违例 → `MALFORMED_FRAME`（`throwMalformed` 既有路径，连接 fatal 1002 不变）；bytes 超限 → `UPDATE_TOO_LARGE`（kind 无关，复用 maxUpdateBytes）；配置违例 → 构造期 `TypeError`（`assertCollKind`/`positiveSafeInteger` 既有抛出面）。R36 冻结面零触碰。
- **无静默失败**：encode iff 违例响亮拒绝（无归一化/丢弃/补默认——decode→encode→decode 等价保持，P1–P5 往返断言锁定）；配置违例无 clamp（边界等号接纳/off-by-one 拒绝敏感度锚转绿）。
- **校验时序**：构造器链 = resolve → validateLimits（值门）→ #244 家族门（不变）→ #295 两窄门（各自 `hasOwnProperty`）→ 字段赋值——违例时无部分初始化（守卫先于 `this.limits = limits`，diff 位置核实）。
- **并发/幂等**：codec 纯函数；配置构造期单线程；无新资源所有权、无新 buffer 路径（`readVarUint8ArrayCopy` 既有拷贝纪律）。
- **静态无法确认项** → §11（全仓 pnpm test、真实传输矩阵在单形态下的运行时行为）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| 契约三文件（DENY，sha256 一致） | R1–R14/N1–N3、C1–C7、类型面 2 | `vitest.config.ts` include `packages/*/test/**/*.test.ts` + typecheck `.test-d.ts` | 未改一行；26/26 绿 + 负控保持（日志 §2） | — |
| `codec-issue299-encode-symmetry.test.ts`（新） | encode iff 八分支 + ⑨⑩、P1–P5 往返逐字节、锁定算术向量位置 | 同上（文件名匹配 include） | 无 skip/only；`ProtocolError` 实例 + code 双断言；冻结清单 ①–⑩ 全采纳（SA2 F2 + O5） | — |
| `codec-issue242-ac-red.test.ts` | #242 协商/回落契约锚 + 敌意套件 | 同上 | 判别力恢复：`hostilePayload` 缺省 `'00'` 前缀使字段级规则（非 canonical/UTF-8/超声明/尾随）重新可抵达；`kindHex` 覆盖键保留 kind 门可测性；28 用例绿 | — |
| golden/truncation/fuzz | GOLDEN=21 计数锚不变；truncation GOLDEN 驱动自动覆盖单形态；fuzz 三 kind × presence 组合（idx 由恒 0 扩为 [0,count)） | 同上 | 断言面仅标题行变化；fuzz 生成器与断言循环结构性覆盖 | — |
| ws 传输套件（issue243/244/246） | 既有传输层回归 | 同上 | 构造为字面量（+`transferKind:0`）、断言为解码面——不受 wire 前缀影响；500 用例绿（日志 §4） | — |
| `ws-replication-observer-red.test.ts`（M1 面） | T5 水位断言（与两新键无关联） | 同上 | +2 行仅补夹具数据；无断言/键集断言触碰 | M1（范围台账，非测试弱化） |

零 skip/only/todo（两包全目录扫描）；零 env override / fallback / 源码字符串断言；红灯→绿灯证据链完整（SA6 基线 21 红 → 31/31 绿）。

## 10. Required revisions

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
|---|---|---|---|---|---|---|
| **M1** | MINOR | `git diff` observer-red +2 行；types.ts 必填键；`ResolvedLimits extends ReplicationLimits {}`（L882）；`backpressure.ts` L44 `limits: ResolvedLimits`；设计 §10 矩阵行「零改动」 | 实现改动落在 ALLOW 台账之外——设计 §10/§11 矩阵登记缺陷（D5.1 × §12 typecheck 判据 × 「该文件零改动」三者不相容），实现本身正确、必要、最小（§4-A 五要素证明） | 设计文档补正：§11 ALLOW 增 `packages/ws-replication/test/ws-replication-observer-red.test.ts` 一行（预期改动 = `ConnectionSenderHost.limits` 字面量 +2 行缺省键）；§10 对应矩阵行由「零改动」更正为「+2 行编译期必改」。实现零改动 | 台账与实际 diff 一致；后续 SA 审计不再出现 ALLOW 外条目 | design |

无 BLOCKER / 无 MAJOR。M1 为台账修正义务，不阻断 approve（变更语义惰性且已被批准设计强制；见 §4-A 边界条件）。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 全仓回归（328 文件，含 apps/yjs-server 与 root tests 的间接消费） | Controller 路由的最终动态验证（设计 §12 全仓行；SA3 已覆盖两包 213+500 + 根 typecheck=0） | `pnpm test` 全绿 + `Type Errors no errors`（327 既有含 2 契约转绿 + 1 新增 encode-symmetry） | 任何非契约转绿类的新红，或契约负控（N1–N3/C5/C6）翻红 |
| 真实 WebSocket / interop 矩阵在单形态下的运行时行为 | 同上（`ws-replication-issue243-real-transport`、`issue246-interop-matrix` 在两包套件内已绿；全仓入口再确认） | v1 代际端对 0x42 照旧 `UNSUPPORTED_MESSAGE_TYPE`；v2↔v2 分块收敛不变 | 互通矩阵等价断言失败 |
| 观察面事件矩阵对 wire 前缀的无关性 | 同上（observer-red 套件在两包套件内已绿） | T1–T5 事件矩阵全绿（+2 行夹具数据无行为影响，§4-A 静态证明的运行时复核） | observer-red 任一用例红 |
| fuzz 种子外溢（300 轮 seeded 之外的 kind/presence 组合） | 后续切片或 SA7 抽查（可选加轮次） | encode→decode→逐字段一致属性保持 | 出现等价破坏或分类漂移 |

## 12. Non-blocking observations

- **N-Obs1**：设计 §10 矩阵双向失准（4 文件多列「+transferKind」、observer-red 漏列 +2 行）——M1 顺带修正时建议同步更正多列侧，使矩阵与 grep 事实（构造点 = 两包 src 2 + protocol 测试 4 + ws 测试 4）一致。
- **N-Obs2**：SA3 采纳 O5（encode-symmetry ⑨⑩）与 O6（#242 L82 注释升级）——本轮 diff 核实均已落地，超出最低要求且零成本，良好。
- **N-Obs3**：fuzz 断言循环按 `Object.entries(msg)` 逐字段断言存在侧；缺失侧（绑定成员 absent）由 encode-symmetry P4/P5 的 `toBeUndefined()` 显式锁定——组合覆盖完整，无需补测。
- **N-Obs4**：SA6 §10 影响面对 observer-red 的描述（「构造 0x42 的夹具」）与事实（无 0x42 构造、仅类型夹具）不符——上游文档精度问题，已被本审查 §4-A 的事实链替代，无需行动。
- **N-Obs5**：wire-change 互通证据门豁免依据（ADR 0022 同版本部署假设 + 旧形态未发布 + PR #241 OPEN）已在设计 §12/SA3 报告显式登记——本轮复核 `packages/replication-protocol/AGENTS.md`「Wire changes require old/new interoperability evidence」条款与豁免论证自洽，无消费方需要互通证据。

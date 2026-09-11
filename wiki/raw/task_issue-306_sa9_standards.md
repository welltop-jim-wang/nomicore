# SA9 标准审查 — issue #306（M4 联合成员文档注释：解析挂载 + IR/derived `memberDocs`）

- **Dispatch**: sa-8530a5d6-6cdf-4442-abf1-f44703b7e3d5（mabf-sa9 / standards-review / iteration 0）
- **审查对象**: 最终提交 diff `91c4add..78b2bdd`（branch `mabf/issue-306`，worktree `/home/wangjian/nomicore-fix-issue-306`）。Parent PR #305 head = `91c4addab449…ead23e`，与 pre-commit base 一致（本侧 `git show` 核实 HEAD~1 = 91c4add）。
- **Owner feedback**: 无适用 issue 评论（dispatch 明示 REST 评论空数组；SA6 §2 / SA8 两报告独立复核一致，本审查采信三方一致）。
- **Verdict**: **approve**（无 BLOCKER、无 MAJOR；4 条 MINOR 见 §7，均不阻断）。
- **职责边界**: 仅判断实现是否符合仓库 AGENTS / ADR / 模块责任 / 既有架构惯例 / 单一事实源 / 生命周期对称性 / 文件范围 / 测试质量标准；Issue 需求完整性属 SA10，不在本审查面。本审查未修改任何代码/设计/测试，未运行测试或服务，唯一产出为本文件。

## 1. Reviewed inputs

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-306.md`（Host 简报，AC1~AC6） | 已读 |
| `wiki/raw/task_issue-306_design.md`（SA1，417 行，§7 D1~D7 / §11 ALLOW-DENY） | 已读 |
| `wiki/raw/task_issue-306_sa2_review.md`（approve，无 BLOCKER/MAJOR） | 已读 |
| `wiki/raw/task_issue-306_sa3_impl.md`（12 红 → 19/19 绿、619/619、双 typecheck exit 0） | 已读 |
| `wiki/raw/task_issue-306_sa4_review.md`（approve，4 MINOR） | 已读 |
| `wiki/raw/task_issue-306_sa6_contract.md`（19 用例 12 红/7 绿冻结契约） | 已读 |
| `wiki/raw/task_issue-306_sa7_report.md`（approve，798 跨包绿 + A/B 逐字节基线） | 已读 |
| `.scratch/sa8-conflict-report-issue-306.md`（clear，C-1~C-6/E-1~E-6）＋ `wiki/raw/task_issue-306_design_conflict_report.md`（clear） | 已读 |
| `docs/adr/0019-vfsl-union-member-docs.md`（规范权威，决策 1~10） | 已读，逐条对照 diff |
| 根 `AGENTS.md`、`packages/vfsl/AGENTS.md`、`docs/AGENTS.md`、`tsconfig.base.json`、`vitest.config.ts`、`.gitignore` | 已读 |
| 提交 diff 全文（5 源文件 + 3 契约测试 + 7 wiki 产物，2048+/14-） | 逐行核读 |

## 2. 逐维度裁决

### 2.1 ADR 合规（规范权威逐条对照）

| ADR 0019 决策 | 落地位置（已核） | 裁决 |
| --- | --- | --- |
| 决策 1（M4 两锚位：`|` 前挂后继；首成员无 `|` 挂成员起始记号；连续 doc 同挂；夹缝不属 M4） | `parser.ts:178-188`（`recordPipeAnchor`/`recordStartAnchor`）、`parser.ts:330-355`（`parseUnionType` 两锚位记录点） | ✅ 逐子句一致 |
| 决策 2（坍缩维持 E305，不发明挂载目标） | `parser.ts:346-348`（`members.length === 1` 早退不结算） | ✅ |
| 决策 3（M3 优先不双挂，冻结约束） | `settleMemberDocs` 逐位 `===` 引用同一性核对（`parser.ts:208-214`），失配 → `[]` 不动 dangling；契约用例 7/10 双方向封死 | ✅ 构造性落实 |
| 决策 4（AST 必填等长 `memberDocs`；IR 条件键；记录+终局核对机制） | `parser.ts:43`（AST 变体）、`ir.ts:45-54`（条件键 + 指纹纪律注）、`semantic.ts:222-230`（`some(d => d.length > 0)` 条件展开） | ✅ 六要素（记录区间/引用/≥2/逆序/同一性/坍缩不回收）全部在场 |
| 决策 5（derived 条件稀疏表 + 手造 IR loud 守卫；显式修订 ADR 0003 docs 表条款） | `derived.ts:84-91`（差异常态化类型注，决策明文要求）、`evaluate.ts:341-347/355-369/401-410/72-74` | ✅ 修订链经 SA8 两报告核实（docs/AGENTS.md「显式修订而非静默矛盾」满足） |
| 决策 8（纯文档：不进校验与物化） | `validate.ts`/`validate-patch.ts`/物化路径零改动（diff 不含）；契约用例 15 七路全等 | ✅ |
| 决策 9.3（E305 正文补「联合成员」，前缀冻结） | `semantic.ts:76` 单点正文；前缀由 `makeIssue` 构造不变；全仓断言面仅前缀正则（SA2/SA8 独立 grep，本审查复核 `semantic.ts:76` 为唯一生产点） | ✅ |
| 决策 10（不改 tokenizer 侧通道） | `tokenizer.ts` 零改动（diff 不含） | ✅ |
| ADR 0007 / 0017 / 0018（指纹条款与消费方） | `fingerprint.ts` 零改动（本审查核：`D2-CONTRACT-MARKER` 单一生产者不变量保持；`semanticFingerprintOf` 输入构造不变）；条件键构造性保证存量输入 IR 逐字节不变（金样本断言 + SA7 A/B 15 语料逐字节相等） | ✅ 无第二规范化层、`sha256:v1:` 不升级 |

### 2.2 AGENTS 合规

- **根 AGENTS.md**：模块指引要求改动 `packages/` 前读最近嵌套 AGENTS——`packages/vfsl/AGENTS.md` 已被上游各 SA 与本审查作为边界基准；schema authoring / typed-access / 第三方插件托管等条款不适用于本切片（纯解析器/求值器内部能力，无 Namespace 写路径、无插件装配）。✅
- **packages/vfsl/AGENTS.md 边界逐条**：parser/evaluator 保持同步确定性（新增代码纯算术比较，无 IO/异步）；公共畸形输入走判别结果不 throw（`guardMemberDocs` TypeError → 顶层 catch → E100 判别结果，`evaluate.ts:77-80`）；IR/derived 保持环境中立、JSON 可序列化纯数据（契约 JSON 往返断言）；无 Yjs 运行时关注点引入；公共 API 未新增（`index.ts` 零改动，两类型经既有导出自然携带可选键——「Add public API only through src/index.ts」满足）；错误码集合、issue 排序、路径报告、信封严格性、指纹输入等兼容行为全部保持（E305 触发面只缩小、无新码）。✅
- **packages/vfsl/AGENTS.md Verification 门禁**：「public types 变化时跑根 `pnpm typecheck` 与 `pnpm test`」——根 typecheck 已跑（14 tsconfig exit 0，有日志）；根 `pnpm test` 未在本支本地跑，SA4 N-1 已登记并路由 CI/SA7。SA7 以三个运行时消费包全套（vfsl-codegen/doc-runtime/namespace-runtime，798 绿）+ A/B 基线作补偿证据；本审查独立 grep 确认跨包 `memberDocs` 生产者/引用者零命中（`grep -rl memberDocs packages | grep -v packages/vfsl` → exit 1），失败语义扩展仅经「手造 IR 带 memberDocs」可达而全仓无该生产者。残余面（namespace-registry/namespace-diagnostic-log/vfsl-protocol/domains 套件）只经稳定接缝消费、类型面由 14 tsconfig 覆盖。**定级 MINOR**（M-2），非阻断：补偿证据充分、残余风险构造性有界、全量分片属 CI 门禁。✅（有登记偏差）
- **docs/AGENTS.md**：「code 行为变更须同步更新每份规范文档」——v1-spec §5 现行「三锚位」文本与本实现存在已知分歧，但该中间态由 ADR 0019 后果节显式排期（§5 修订随实现 PR 落地）、SA8 C-1 编码为 PR #305 收官门槛（#309 同支同步），本提交位于集成分支 `docs/issue-304-vfsl-union-member-docs` 之上、未进 main，终态纪律在 PR 边界保持。本切片零 `docs/**` 改动符合 DENY。✅（中间态已登记，非静默矛盾）

### 2.3 模块责任与既有架构惯例

| 维度 | 裁决 |
| --- | --- |
| 责任归属 | doc 记账事实拥有者 = parser（dangling/claimed/docTotal）→ M4 并入同一记账系统（splice + `claimed += n`），未复制底层状态机；AST→IR 条件附加在 semantic.ts；derived 收集与守卫族宿主在 evaluate.ts（复用 `put` 统一入口与顶层 catch）；E305 消息唯一生产点原位改；指纹单一生产者零触碰。全部落在既有责任中心。✅ |
| 惯例一致性 | M4 延迟回收 vs M1/M2/M3 同步 `claimDocs` 是有 ADR 明文依据的分歧（决策 4：坍缩判定须扫到末尾），非私自发明；条件展开构造与 `derived.ts:13` 既有 `exactOptionalPropertyTypes` 纪律同款（tsconfig.base.json:10 已核旗标开启）；`<member N>` 文法零改动复用既有合成段；`ir.ts` union 变体多行注释形与紧随的 marker 变体（`ir.ts:57-65`）版式一致。✅ |
| 实现自由度 | `settleM4`→`settleMemberDocs` 命名、`md.every((d) => Array.isArray(d))` 逐参形、B 锚 `?? []` 防御——均为 SA3/SA4 已声明等价形，记录在案。✅ |

### 2.4 单一事实源

doc 文本唯一来源 = tokenizer `DocLead.body`（`tokenizer.ts:78` pending 数组引用挂唯一记号）→ AST `memberDocs`（`leads.map(d => d.body)`，逐字）→ IR（`semantic.ts` 同数组引用传递，无拷贝/规范化）→ derived（`put` 逐字引用）。无第二记账系统、无第二消息生产点、无第二规范化层；指纹单一生产者插入序 canonical JSON 不变量保持。✅

### 2.5 生命周期对称性

全链路同步纯函数：无资源获取/释放对、无后台任务、无缓存失效面（`compiledCache` 按文本内容键、失败不落缓存——SA7 探针动态核实）；`M4Pending`/`pendings` 随解析栈消亡，错误路径（error 记号即抛）无需清理；`docTotal` 核对仅在成功路径运行（既有纪律不变）。未引入任何不对称。✅

### 2.6 文件范围

- 生产改动恰为设计 §11 ALLOW 五条：`parser.ts`/`ir.ts`/`semantic.ts`/`derived.ts`/`evaluate.ts`（151+/14-）；DENY 全零触碰（tokenizer/fingerprint/validate*/resolve/shapes/resolve-schema-at-path/index/envelope/schemasource、vfsl-codegen/**、docs/**、tests/**、domains/**、其余 packages）——本审查以 `git diff 91c4add..HEAD --stat` 与逐文件 diff 核实。✅
- 契约三件（SA6 冻结验收输入）随实现一并提交，内容与 SA6 录制一致（SA3 红灯基线 12 红逐条吻合佐证未软化）；`git diff --check` exit 0（本审查复核）。✅
- 7 件 wiki/raw 过程产物随提交入库：仓库既有惯例成立（`git ls-files wiki/raw` 计 1107 件；既有提交含 SA 产物先例），不越范围。✅

### 2.7 测试质量标准

| 项 | 裁决 |
| --- | --- |
| 红灯先行 | 契约录制于实现前 HEAD `91c4add`（12 红/7 绿，3 次运行逐字一致）；SA3 以 stash 剥离实现复现红灯基线逐条吻合——断言非恒真。✅ |
| 断言质量 | 全经公共入口（`parseVfsl`/`evaluate`/`semanticFingerprintOf`）观察运行时产物；等长 `toEqual`、逐字载荷、`hasOwnProperty` 整键在场性、JSON 往返、双方向不双挂、精确锚点/前缀、4 类畸形逐类 `expectE100`（恰一条 + 无 derived 载荷）；负控在场（同布局无 doc、M3 坍缩、良性等长/全空手造 IR）。✅ |
| 金样本 | IR/derived 紧凑 JSON SHA-256 + `sha256:v1:` 指纹精确值六常量实现前录制、SA4 未重录；SA7 运行时复算全等。✅ |
| 卫生 | 无 `skip/only/todo`（本审查 grep 0 命中，exit 1）；fixture 非 `.test.ts` 不被收集（vitest include 已核）；包 tsconfig include `test/**` → 契约类型面受 tsc 覆盖。✅ |
| 收集与门禁 | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 命中两新文件；CI typecheck/test 分片按磁盘枚举自动收编。✅ |

## 3. 交叉一致性（上游产物链）

SA6 契约（19 用例/金样本六值）→ SA1 设计（D1~D7 与契约用例映射）→ SA2 approve（O-1~O-5 MINOR，SA3 逐条核销）→ SA8 前置/复查双 clear（C-1~C-6 约束链）→ SA3 实现（ALLOW 五条，红灯→绿灯日志齐备）→ SA4 approve（含 M4 机制独立对抗重推）→ SA7 approve（动态 A/B 基线 + 端到端 + 跨包 798）。各环 verdict 与证据互相啮合，本审查抽查的关键锚点（`parser.ts:178-220/330-355`、`semantic.ts:76/222-230`、`evaluate.ts:72-80/341-410`、`ir.ts:45-54`、`derived.ts:84-91`、tokenizer/fingerprint 零改动、跨包 grep）全部与上游主张一致，未发现证据断裂或 verdict 与工件内容矛盾。

## 4. 冲突复查状态

设计 §14 自报 `requiresConflictRecheck: true`；SA8 设计后复查（`task_issue-306_design_conflict_report.md`）已执行并消解为 false（公共类型面加性、指纹语义面、`evaluate` 失败语义扩展三项均有 ADR 0019 显式授权条款承接）。本审查无需再触发冲突复查。

## 5. BLOCKER / MAJOR

无。

## 6. 残余风险归属（非本 diff 缺陷）

#307（codegen 四发射位）/#308（投影切片第三来源）/#309（v1-spec §5 + 编写指南 + 「三锚位」措辞清扫）为 SA8 C-1/C-5 编码的预期分支中间态，PR #305 收官门槛须含三票——流程性事项移交总控，不对 #306 定级。

## 7. Non-blocking observations（MINOR，不阻断 approve）

| ID | 观察 | 证据 | 建议路由 |
| --- | --- | --- | --- |
| M-1 | 提交信息未携带 issue 引用：近 15 条历史提交全部含 `#NNN`（`feat(#282): … (#283)` 等形），本次 `feat(vfsl): attach documentation to union members` 无 `#306`；SA3 建议的带引用+正文格式未被采用 | `git log --format='%s'` 比对 | 历史已定型、不改写；后续提交沿用仓库引用惯例 |
| M-2 | `packages/vfsl/AGENTS.md` Verification 要求 public types 变化时跑根 `pnpm test`；本支未本地跑（根 typecheck 已跑 exit 0）。补偿证据：798 跨包绿 + 跨包 memberDocs 零生产者（本审查 grep）+ 14 tsconfig + A/B 逐字节基线 | SA4 N-1 同项登记；SA7 §10 偏差 1 | CI 全量分片确认（门禁性质，非本地缺陷） |
| M-3 | `semantic.ts:5` 文件头注释仍写「M1/M2/M3 三锚位之外」（M4 成立后措辞过时）；同提交内 `evaluate.ts` 同类注释已顺带更新（「三表收集→表收集」），此处未同步 | `semantic.ts:5` vs diff | 已属 SA8 C-1 登记的 #309「全仓三锚位措辞清扫」范围，同支收官时一并清理；非静默漂移 |
| M-4 | Host 简报 `wiki/raw/task_issue-306.md` 保持 untracked，而 7 件同任务产物已入库且其他任务简报（如 `task_issue-72.md`）在库 | `git status` / `git ls-files` | 入库与否由总控 finalize 决定；不影响实现面 |

## 8. Verdict

**approve**。最终提交 diff 是 ADR 0019 决策 1/2/3/4/5/8/9.3/10 与已批准设计 §7 D1~D7 的忠实落地；模块责任、单一事实源、生命周期对称性、既有惯例全部保持；文件范围恰为 ALLOW 五条 + 冻结契约三件 + 过程产物，DENY 零触碰；测试为红灯先行、负控完备、金样本冻结、无软化的高质量契约。4 条 MINOR 均不阻断。

— SA9（Standards Reviewer），唯一产物为本文件。

# 冲突门禁报告（设计后复审）— Issue #273 namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影（ADR 0016）

## 1. Reviewed subject

- 被审对象：**design** — SA1 设计 `wiki/raw/task_issue-273_design.md`（iteration 0，374 行；D1–D7 决策、§8 状态机/数据流、§10 调用方矩阵、§11 文件范围、§12 验收映射、§14 自报复查）
- 复审触发：设计 §14 自报 `requiresConflictRecheck: true`，范围自述收窄到 **D4**（resolver `InternalError` 处置 = throw 逃逸公共读面）；本复审全量过设计、以 D4 为焦点深审
- 阶段：设计后冲突复审（SA1 之后、SA2 之前）；`wiki/raw/task_issue-273_sa2_review.md` **不存在**（实测）——无 SA2 评审输入可并入
- Worktree：`/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`，HEAD `1acd9e9`；`git status` 仅 SA6 契约 5 文件 + 任务快照 5 文件未跟踪，生产实现零改动——实测）
- 裁决人：SA8 Conflict Gatekeeper（mabf-sa8）

## 2. Inputs and decision set

- 冲突基准（逐个核读）：`docs/adr/` 全集 **14 文件**（0001–0012、0014、0016；0013/0015 不存在）+ 根 `CONTEXT.md`（173 行）+ 模块 AGENTS 明确收录的决策（`packages/vfsl/AGENTS.md` L10 可信域 throw 例外句；`packages/namespace-runtime/AGENTS.md` / `packages/namespace-registry/AGENTS.md` grep `readData|throw|抛` 零命中——两包 AGENTS 无读面/抛错条款，不构成额外约束）
- readData 语义发言者唯一性复核：`grep -l readData docs/adr/*.md docs/protocols/*.md` 仅命中 **ADR-0008 + ADR-0016**（实测）——读结果契约无第三个决策文本
- 对照输入：任务简报 `wiki/raw/task_issue-273.md`（行为要点 6 + AC1–AC5）、SA6 契约 `wiki/raw/task_issue-273_sa6_contract.md`（approve；§15.1 显式不锁 InternalError 处置）、前置门禁 `wiki/raw/task_issue-273_conflict_report.md`（clear；红线 4 = 本复审焦点）、#272 设计后复审 `wiki/raw/task_issue-272_conflict_recheck.md`（clear 先例：resolver 层 throw 通道已裁定 no-conflict，并把深拷贝义务显式指派给本组合票）
- Issue comments：REST 读取为空（dispatch 记录；简报/SA6/前置门禁三处同载 `comments: []`）——**无 owner 要求需并入、无 override 声明在案**
- 被 superseded 条款不计入约束：ADR-0007 open/read 编排与 schema-aware read（被 ADR-0008 取代）；ADR-0008 原 D8 封口句与旧 `{ok:true,value}` 形状（被 ADR-0016 修订节改写，L167–178 在仓已核）；ADR-0009 旧 Registry key（被 ADR-0010 取代）
- 源码仅作事实核验（非独立基准）：`resolve-schema-at-path.ts`（错误三分头注 + `InternalError` throw + 共享节点声明）、`p0.ts`（schemaState/activeTools/installActive/⑦ fatal 不迁移 schemaState）、`runtime.ts`（现联合 + lifecycle gate 前置）、`projection.ts` 头注（「生产不可达 → loud / 生产合法可达 → 可观测缺席信号」单一判据 + NSRT-SCHEMA-E1/E2、NSRT-META-E1/E2 loud throw）、`runtime-boundary-supplementary.test.ts`（getMetadata 原始 `RangeError` 逃逸锚）、`lease.ts`（直透传 + `Equal` 类型级锁）、`apps/yjs-server/src/app.ts` L543–551（REST 消费 try/finally 仅用 value）

## 3. Decision analysis

### 3.1 焦点：D4 — resolver `InternalError` 处置 = throw 逃逸 `readData` 公共读面

**设计行为**（§7-D4、§8.2 状态机、§9 错误节）：组合层对 `resolveSchemaAtPath` 不加任何 try/catch；可信域畸形 derived 的 `InternalError` 直接逃逸 `readData`；不收敛 `schema:null`、不降级失败码、不记 fatal 态、不发诊断；JSDoc/模块头注显式记录该通道（internal-bug-only、生产不可达）。

| Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| ADR-0016 §解析语义 L64 | 「`ref` 目标缺失（畸形派生物）沿 validate-patch 先例抛 `InternalError`：**可信域契约，不进结果联合**」 | 组合层保留该 throw 穿透（不吞、不收敛） | **no-conflict** | throw 是 ADR 自己设立的刻意 loud 通道；「不进结果联合」即不折入 NOT_FOUND/INVALID 两码（null 情形③的文义载体）——设计 D3 恰只把**两码**收敛 null，InternalError 不折入任何结果形态，通道保真 | 无 |
| ADR-0016 §结果形状 L22 | 「`schema` 为 `null` 覆盖**三种情形**……三种情形不区分……`null` 不是读的失败，读的 `ok` 恒真」 | D4 不触碰三情形枚举；throw 不产生任何返回值 | **no-conflict** | 三情形枚举穷尽（无 active schema / 路径偏离 / 静态解析失败=解析器结果联合两码），不含 InternalError；「ok 恒真」辖**返回结果**的 ok 键语义（schema 缺席 ≠ 读失败），非「读面永不抛」承诺——若作永不抛读法则与 ADR-0008 L28 直接矛盾。**不对称性**：收敛 null 需把 InternalError 塞进三情形枚举之外的第 4 类缺席（缺乏母法正授权、与 L64 carve-out 相抵）；throw 逃逸不修订任何枚举语义 | 无 |
| ADR-0008 §读取能力 L28 | 「预期路径、载体和 lifecycle 失败使用同步结果联合，**只有 internal bug 才抛异常**」 | internal-bug 通道（可信域畸形 derived = 内部不变量破坏）以 throw 呈现 | **implements-existing-decision** | 该句是读能力的**常设抛错政策**：结果联合辖预期失败、internal bug 辖 throw。`activeTools.derived` 恒为自身 P0/SCHEMA 写槽 `compileSchemaEnvelope` ok 产物（p0.ts `installActive` 单点安装，实测），畸形即 internal bug——D4 是把该既有政策延续进 ADR-0016 新增的 schema 组合面，非新造通道。此前 ready 期结构上不可抛仅因旧读面纯透传非抛函数；通道在契约中既存，ADR-0016 附加了可触发它的内部工作 | 无 |
| ADR-0008 修订节第 3 条 L177–178 | 「原规则保持：读取保持 schema 无关、不进 sequencer、失败通道（`PATH_NOT_ALLOWED` / `RUNTIME_READ_DISABLED`）与读取保留不变量均不变」 | 结果联合失败通道原样；读保持同步、零副作用、sequencer 外 | **no-conflict** | 「失败通道」辖**结果联合分支**（两码），throw 非结果分支；D1/D2 保 `PATH_NOT_ALLOWED` 原样透传、`RuntimeReadDisabledResult` 逐字不变（L109–114 实测）、lifecycle gate 原序 | 无 |
| ADR-0016 §分层与兼容面 L77 + ADR-0011 | 「诊断变更日志不涉及读面」；log 为 best-effort 观测、emit never throws、不改业务结局 | D4 明确不发诊断（读面零副作用） | **implements-existing-decision** | 读面零诊断是 ADR-0016 明文；D4 的「不发诊断」是义务兑现非裁量 | 无 |
| ADR-0008 §Fatal 与失败通道 L87–93 | internal fatal（`DocRuntimeFatalError` 域）永久禁写、保留读取 | D4 不记 fatal 态（备选「catch 转 fatal」被设计否决） | **no-conflict** | fatal 域辖**写槽** internal fatal；从读途异常写生命周期状态 = 新生命周期所有权，无 ADR 支持。ADR-0009/CONTEXT 亦无「读异常须转写侧状态」条款 | 无 |
| ADR-0009 §NamespaceLease L38 | lease「代理 Runtime 除 close 外的同步读取……released 后操作经既有通道返回 `NAMESPACE_LEASE_RELEASED`」 | throw 经 lease 直透传传播至 Host（lease.ts L276–278 实测零改动） | **no-conflict** | ADR-0009 无条款冻结 lease 读非抛；「代理」语义即行为同构。CONTEXT「停接纳」词条 L92 已注册同步数据面 **loud throw 稳定码**模式（getter 拒绝通道为 throw）——Host 消费面与 runtime 同步面 loud throw 共存已是注册词汇 | 无 |
| vfsl/AGENTS.md L10（模块 AGENTS 收录决策） | 「`resolveSchemaAtPath` takes `derived` as a trusted-domain input — malformed derived schemas … throw `InternalError` and **never enter the result union**」 | 下层刻意 loud 的通道在组合层保持 loud | **no-conflict** | #272 复审复查点 2 已裁定同一通道在 vfsl 层 no-conflict（「ADR 全集与 CONTEXT.md 无任何条款要求 vfsl 公共函数一律不抛」；path 敌意/判别联合 vs derived 可信域/throw 二分划界正确）。组合层 catch 收敛 = 在上一层静默化下层刻意保持的内部缺陷信号（层次纪律倒置），设计论证链 1 成立 | 无 |
| ADR-0007 L54（未被取代部分） | 「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚」 | 可信域异常 loud 呈现（不伪装、不 fallback） | **no-conflict** | 同向先例：内部异常不静默吸收。doc-runtime E100「意外异常 → PATH_NOT_ALLOWED」辖**敌意数据面**值读（INV-R1 同步不抛），与可信域 schema 面分属两域——设计 D4 备选否决节的域界划分与 vfsl AGENTS 二分一致 | 无 |
| SA6 契约 §15.1 | 「resolver `InternalError` 处置……契约不预设」 | D4 钉死为 throw 逃逸 | **no-conflict** | 两种处置均不违契约锚（15 红契约全部落在可达路径的 schema 键/内容/隔离，无一断言「readData 永不抛」；负控辖失败分支形状）；设计钉死在留白自由度内 | 无 |
| 任务简报 行为要点 6 / AC4 | 「失败分支（PATH_NOT_ALLOWED / RUNTIME_READ_DISABLED / released）与 getSchema/getMetadata/getActiveSchema/getStatus 均不变」「无新增公共方法/参数」 | throw 通道不新增结果分支、不新增方法/参数 | **no-conflict** | throw 非结果分支、非方法/参数；六要点与 AC1–AC5 逐条对照见前置门禁表 1–12（本复审无新发现推翻） | 无 |
| 包内先例（辅助核验，非决策文本） | `projection.ts` 头注「生产不可达 → loud / 生产合法可达 → 可观测缺席信号」（R2 修订判据）；getSchema 载体异型 loud throw `NSRT-SCHEMA-E2`；getMetadata 循环值原始 `RangeError` 逃逸（测试锚实测） | D4 把 schema 附加加入同一处置类 | （佐证，不计入裁决行） | InternalError 生产不可达（derived 出自自身编译）→ loud，与包内同步投影面单一判据局部一致 | 无 |

**D4 总裁决：no-conflict**（含 implements-existing-decision 成分：ADR-0008 L28 常设 internal-bug 抛错政策的组合面延续）。设计论证链六条（层次纪律 / ADR 锚点 / 包内先例 / 可达性 / 上游传承 / 文档义务）逐条与决策文本核对成立；两个被否备选（收敛 null；catch 转 fatal/降级码）的否决理由均有条款依据——前者缺乏母法正授权且与三情形穷尽枚举 + L64 carve-out 相抵，后者无 ADR 支持且违反「原规则保持」。

### 3.2 其余设计决策全量对照

| # | Design | Clause | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| 1 | D1 结果联合重定型（ok 恰三键、`schema` 精确可空、失败成员 `Extract<ReadLogicalValueResult,{ok:false}>` 单源派生） | ADR-0016 §结果形状 L18–25 + ADR-0008 修订节第 2 条 L173–176 | implements-existing-decision | 形状逐字；`RuntimeReadDisabledResult` 逐字不变（runtime.ts L109–114 实测）；Extract 保持 doc-runtime 失败形状唯一事实源（备选否决②正确） | 无 |
| 2 | D2 组合顺序（lifecycle gate 原序 → 值读先行 → 失败短路零 schema 工作 → 恰三键构造） | ADR-0016 §分层 L75 组合公式 + ADR-0008 §读取能力 L18/L28 | no-conflict | gate 前置 = 既有 B3 原序保持；「失败分支不带 schema」由短路结构保证；schema 无关值读不变 | 无 |
| 3 | D3 null 单点守卫（`schemaState!=='ready' \|\| activeTools===undefined → null`；resolver 两码单义收敛 null；fatal 由 schemaState 停留 preparing 天然覆盖；未知方言同出口） | ADR-0016 L22 三情形 + 被否备选「schema 子通道」明文拒绝 | implements-existing-decision | p0.ts ⑦ 实测：internal fault 只置 fatal/fatalCause，schemaState 保持 'preparing'；无码泄漏、无 `schemaIssue` 子通道；未知方言属 registry 导入面（SA6 §15.4 显式不锁，follow-up #3 留痕） | 无 |
| 4 | D5 深拷贝（新内部模块、identity-memo、可变普通副本、不冻结、零缓存、docs/aliasDocs 一并拷贝） | ADR-0016 §交付纪律 L70 + ADR-0008 修订节第 1 条 L169–172（D8 封口改写：derived 只经投影深拷贝进公共面）+ CONTEXT「语义 schema 投影」Avoid 句 | implements-existing-decision | **#272 复审复查点 3 附加条件**（「组合票不得遗漏深拷贝义务」）由本设计 D5 承接闭合；模块不进 index 公共面，沿 p0.ts/projection.ts 先例 | 无 |
| 5 | D6 registry 仅别名跟随（`NamespaceRuntimeReadDataResult \| NamespaceLeaseReleasedIssue`）+ lease.ts 零改动（Equal 锁自然绿） | ADR-0016 §分层 L76 + ADR-0009 §NamespaceLease L38 | no-conflict | lease.ts L276–278 直透传、L388–391 Equal 锁实测在位；无结构性第二份形状定义 | 无 |
| 6 | D7 测试改锚三策略 + 全仓站点清单（补齐 SA6 §10 清单外 8 站点 + 3 stub 类 + 2 工厂默认值） | ADR-0016 Consequences 第 2 条（toEqual 需更新 / toMatchObject 加法兼容——ADR 自登记义务） | implements-existing-decision | 改锚策略保持原断言意图、不弱化值断言；两道根门兜底 | 无 |
| 7 | p0.ts L43 旧注释更正（「永不进任何公共面」→ 按修订节改写；注释级零行为） | ADR-0008 修订节第 1 条（旧句已被改写，注释为陈术语） | implements-existing-decision | docs 纪律（陈述与现行决策一致）；DENY LIST 已限 p0.ts 仅允许注释行 | 无 |
| 8 | §11 DENY：doc-runtime/**、vfsl/**、SA6 契约 5 文件、lease.ts、registry index.ts、apps/yjs-server/**、CONTEXT.md、docs/adr/** | ADR-0016 §分层（doc-runtime 不动 / vfsl 纯消费 / registry 仅别名）+ 验收契约冻结纪律 | no-conflict | 设计不修订任何决策文档——与「无 evolution-required」结论自洽（见 §6） | 无 |
| 9 | ADR-0001/0002/0003/0004/0005/0006/0009/0010/0011/0012/0014 辖域 | 各 ADR 正文 | no-conflict | 设计零触及（SSOT 文本 / authority / 投影体母法不折入 / codegen / 持久化 / raw 复制例外仅为 null 情形②事实源 / 诊断不涉读面 / 实例身份 / 日志格式）；readData 语义仅 0008+0016 两处规定（grep 实测） | 无 |

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| — | — | — | — |

无 override 声明、无 override 需求：D4 不声称覆盖任何决策（其立场是**合成**两个既有明文决策而非修订）；Issue comments 为空（无 Owner 覆盖权威可来源）；无新 ADR/协议版本。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| read 失败分支（结果联合） | `PATH_NOT_ALLOWED`（doc-runtime 单源）与 `RUNTIME_READ_DISABLED` 码/形状 | ADR-0016 L23 + ADR-0008 修订节第 3 条 | 设计保持原样（D1 Extract + L109–114 逐字；§8.2 状态机）——**通过** |
| lease released issue | `NAMESPACE_LEASE_RELEASED` 通道 | ADR-0009 §NamespaceLease | lease.ts 零改动（D6）——**通过** |
| getSchema/getMetadata/getActiveSchema/getStatus | 五字段身份、四键投影、META 深拷贝、status 结构 | ADR-0008 §读取能力 L32–36 + 修订节 | 设计零触碰（§8.1「其余公共面零变化」）——**通过** |
| 公共面键集 | `NamespaceRuntime` 十二键、exports 值键集（`RuntimeWriteFatalError`）、无新增公共方法/参数 | ADR-0008 D2 + ADR-0016 Consequences + AC4 | 新模块不进 index；§8.1 声明零变化，负控/审计测试锚定——**通过**（实现后复核） |
| 稳定码注册面 | 不新增读结果联合稳定码；`RUNTIME_READ_DISABLED` 等既有码不动；vfsl 两码不泄漏进读联合 | ADR-0008 #93 修订节第 1/5 条 + ADR-0016 被否备选 | D3 单义收敛 null；InternalError 非 namespace-runtime 码（vfsl 包内错误类，index 未导出——实测 grep）——**通过** |
| null 三情形枚举 | 三情形不区分、无缺席原因子通道、`null` 单义 | ADR-0016 L22 + CONTEXT「语义 schema 投影」 | D3/D4 均不扩展枚举（D4 恰是不扩展的那个选项）——**通过** |
| doc-runtime 读面 | `readLogicalValueAtPath(doc, path)` 签名语义、schema 无关、INV-R1 同步不抛 | ADR-0016 §分层 L74 + ADR-0008 | DENY LIST 全包；负控 #1/#2 + 类型守卫锚锁定——**通过** |
| wire/持久化/复制/诊断 | 读面不产生变更日志事件；ReplicationSession raw 读面不触；零持久化变化 | ADR-0016 L77 + R3 边界声明 | 设计零触碰——**通过** |

（以上为设计层核对；实际 diff 逐项核对属实现后复查，见 §10 清单。）

## 6. Evolution requirements

**无 evolution-required 项。**

- D4 不修订任何决策文本：结果形状/null 枚举/失败通道/交付纪律均按现行 ADR-0016 + ADR-0008 修订节执行；throw 通道是 ADR-0008 L28 常设政策在新组合面的可观测化，不需 ADR/CONTEXT/协议同变更集修订。设计 §11 DENY `docs/adr/**` 与 `CONTEXT.md` 与该结论自洽。
- JSDoc/模块头注记录 throw 通道（D4 论证 6）属**代码文档**义务，描述的是既有决策合成已授权的行为——按 `docs/AGENTS.md`「documentation-only wording changes must not invent implementation behavior」，不构成规范性文档变更需求。
- 反事实核验（裁决边界的对称性，非本设计立场）：若设计选择「收敛 null」，需把 InternalError 纳入三情形枚举之外的缺席类别（触碰 ADR-0016 L22 穷尽枚举与 L64 carve-out 的文义）→ 至少须论证 evolution；若选择「catch 转 fatal/降级码」→ 触碰失败通道不变量与 fatal 域所有权 → evolution-required。设计选择的 throw 逃逸是唯一无文本修订负担的选项。

## 7. Hard conflicts

无。hard-conflict 0。

全决策集无任何条款要求 runtime/lease 读面一律不抛（ADR-0008 L28 明文反向预设 internal-bug throw；CONTEXT L92 注册同步数据面 loud throw 模式；#272 复审已确认「ADR 全集与 CONTEXT.md 无任何条款要求 vfsl 公共函数一律不抛」，同句检索对 runtime/registry 读面同样成立——本复审全量重核）。

## 8. Required actions（非阻塞，移交下游）

1. **[SA3/SA4 — 实现义务，非冲突]** D4 文档义务必须落地：`readData` JSDoc 与 `read-schema-projection.ts` 模块头注显式记录 throw 通道（internal-bug-only、`InternalError`、生产不可达）——防止后续维护者误判为漏改。
2. **[SA4/SA7 — 观察项]** `InternalError` 类未从 `@nomicore/vfsl` index 公开导出（仅 `resolve.ts` 模块级 + 注释提及，实测）——本票 DENY `packages/vfsl/**`，JSDoc 只能按名文字引用（沿 getMetadata 原始 `RangeError` 无类型契约先例）；不得为本票导出该类。
3. **[SA2 — 可评估，非冲突]** `apps/yjs-server` `opRead` 以 try/**finally**（无 catch）消费 `lease.readData`：throw 若发生将传播至外层 RPC 处理——生产不可达（不变量），且 REST 错误映射无 ADR 辖域；SA2 可自行评估是否需要外层收编，不构成本门禁义务。
4. **[SA2 — 建议]** 设计 §12 对 D4 的可选负向测试（seam 注入畸形 derived 断言 `toThrow`）是防「实现擅自加 catch 收敛」的最廉价守卫；采纳与否属 SA2/SA4 裁量。
5. **[实现票]** 工作流纪律沿用前置门禁红线 7：栈接 PR #271 支系；本地 `origin/main` 陈旧（`6a005a4`），对比/rebase 以 GitHub API 实测为准。

## 9. Verdict

**clear**。

- 冲突点数：**0**（hard-conflict 0 / override-declared 0 / evolution-required 0）。
- 裁决分布（对照行共 20）：**no-conflict × 13**（D4 焦点表 9 行：ADR-0016 L64/L22、ADR-0008 修订节 3/Fatal 节、ADR-0009、vfsl AGENTS、ADR-0007、SA6 §15.1、简报要点 6/AC4；3.2 表 4 行：D2、D6、§11 DENY、其余 ADR 辖域）+ **implements-existing-decision × 7**（D4 焦点表 2 行：ADR-0008 L28 常设抛错政策的组合面延续、诊断不涉读面义务；3.2 表 5 行：D1、D3、D5（#272 复审指派的深拷贝义务）、D7、p0.ts 陈术语清理）。D4 焦点表另有包内先例 1 行为佐证证据（非裁决行，不计入）。
- 焦点裁定：**D4（readData 公共读面 InternalError throw 通道）= no-conflict**——位于 ADR-0016 §解析语义 L64（可信域 throw 契约，不进结果联合）与 ADR-0008 §读取能力 L28（只有 internal bug 才抛异常）两个已接受决策的合成区间内；不修订三情形穷尽枚举、不触碰结果联合失败通道、不越 fatal/诊断辖域、与 lease 代理语义及 CONTEXT 注册的同步面 loud throw 模式相容。设计自报的复查理由（公共读面新增失败语义）由此闭合。
- 其余设计（结果形状、null 收敛、组合顺序、深拷贝、registry 别名、测试改锚、文件范围）为 ADR-0016 + ADR-0008 修订节的逐字实施，前置门禁已裁决 no-conflict，本复审未发现新冲突面。
- SA6 契约一致性：15 红契约 + 6 负控 + 2 类型锚 + 共享夹具与设计 D1–D6 逐条可满足；D4 在 §15.1 显式留白内，无契约锚与 throw 通道冲突。
- 信息充分性：ADR 全集 14 文件 + CONTEXT + 模块 AGENTS 决策句 + 前置门禁/SA6/#272 复审 + 源码事实（resolver 头注、p0 状态机、runtime/lease 透传、projection 判据与测试锚）均已亲核；无信息不足。

## 10. requiresConflictRecheck

**true**（实现阶段复查，范围收窄如下）。

理由：本设计对**公共 API**（`readData` 结果形状——既有面破坏性演进）与**失败语义**（readData 新增可观测 throw 通道，既有 ADR 未逐字规定、由设计合成钉死）的改变**尚待实现核对**；实际 diff 将触碰 ADR-0016/ADR-0008 辖定的读结果公共面（skill implementation 复审触发条件之三命中）。设计面冲突问题已由本报告闭合；下列为实现后复查清单（逐项核对实际 diff）：

1. D4 按钉死落地：组合层**无 catch**（不收敛 null、不降级码、不记 fatal、不发诊断），`InternalError` 逃逸；JSDoc + 模块头注两处文档义务在场。
2. ok 成员恰三键、`schema` 精确可空；失败成员 `Extract` 派生、`RuntimeReadDisabledResult` 逐字；resolver 两码单义收敛 null 且不泄漏进读联合。
3. 深拷贝落位 runtime 边界（活 derived 零出站、不冻结、零缓存、跨读零共享）；lease.ts 零改动、Equal 锁编译绿。
4. 冻结面逐项保持：失败三分支、released issue、四 getter、十二键/exports 键集、无新增公共方法/参数/稳定码。
5. p0.ts 改动仅注释行；SA6 契约 5 文件未被修改（DENY）。

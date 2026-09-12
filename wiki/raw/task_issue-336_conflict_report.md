# 冲突报告（Conflict Report）— Issue #336 前置门禁

> SA8 产出。只裁决冲突，不评设计优劣、不判实现质量、不做设计。基准 = ADR 全集 + CONTEXT.md（+ 模块 AGENTS 明文收录的决策）；源码仅作现状确认。Issue comments（REST）为空——无 Owner 评论 override 面。

## 1. Reviewed subject

**task**（前置门禁）——Issue #336「[shape-budget] T3: readData 五键组合——两通道同预算与截断清单」需求与验收标准 vs 决策集。被审需求四件：① readData 五键恒形结果（恰三键 → 五键破坏性修订，经 T0 集中 helper 落地）；② 值/投影两通道同预算截断与截断清单语义；③ `READ_OPTIONS_INVALID` 进公共结果联合；④ registry lease options 原样透传。

## 2. Inputs and decision set

- 输入：`wiki/raw/task_issue-336.md`（简报）+ Issue #336 正文（同源，comments 空）；谱系 T0 #333 / T1 #334 / T2 #335 已合入本支（`80d59f8`/`b8e2947`/`cdfdff6`），Blocked-by 已解除；ADR 0024 基线三提交（`50d52a1`/`7679c57`/`ba11f32`，PR #332）在支上。
- 决策集：`docs/adr/` 全集 20 文件清点（全部 accepted、无 superseded；条款级修订关系见 §4）；细读 0003 / 0008 / 0009 / 0016 / 0019 / 0024；根 `CONTEXT.md` 全读（L37–55 预算词汇族已落）；`packages/namespace-runtime/AGENTS.md`、`packages/namespace-registry/AGENTS.md`、`packages/doc-runtime/AGENTS.md` 模块契约；`docs/protocols/`、`docs/phases/`、`docs/vfsl/` grep 核对无 readData 条款面（readData 不上 wire、不进语言 spec）。
- 现状确认：runtime `readData` 单参、成功恰三键（runtime.ts L121–129/L152/L474–487）；投影组合面两参、深拷贝器 9-kind 显式分派无 default（read-schema-projection.ts L42–58/L121–181）；lease 无透传（lease.ts L276–279）；T1 双结果联合（`READ_OPTIONS_INVALID` 只在预算联合；载体定序 G0→options→N0）；T2 投影包装联合（标记带内、resolver 码 `SCHEMA_OPTIONS_INVALID`、无独立清单字段）。详录见 `wiki/raw/task_issue-336_relevant_decisions.md`。

## 3. Decision analysis

| # | Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|---|
| 1 | ADR-0024 | 决策 4 L58–69（五键恒形、恰三键→五键破坏性修订、失败分支不带新键、0.x minor bump 论据） | 成功分支恒五键 `{ok,value,schema,truncated,truncations}`；预算读与无预算读（空清单）都携带；失败分支形状不动 | **implements-existing-decision** | 0024 L58–69；验收 L122 | 形状唯一、无「缺席=无截断」隐式约定；空截断也恒空数组；经 T0 集中 helper 完成形状锚修订 |
| 2 | ADR-0024 | 决策 6 L85–87（公共面归属：runtime 组合两通道同预算；registry lease 原样透传；不新增第二条读路径） | runtime `readData(path, options?)` 一次读内以**同一预算**贯通值与投影两通道；lease 透传 options | **implements-existing-decision** | 0024 L85–87；验收 L129 | 同一 options 对象贯通两通道；禁止第二条读路径；禁止 runtime 层对完整投影的事后裁剪（L116 否决项） |
| 3 | ADR-0024 | 决策 1 L22–31（options 封闭形状、未知键拒绝、`READ_OPTIONS_INVALID` 同步不抛、不借路径/生命周期码；L29 无 options=完整投影） | `READ_OPTIONS_INVALID` 进入 readData 公共结果联合（含未知键）；无 options 逐字节现行为回归锚 | **implements-existing-decision** | 0024 L29–31；验收 L122 | 同步、不抛、不借用 `PATH_NOT_ALLOWED`/`RUNTIME_READ_DISABLED`；无 options 调用不可产生该码（值/投影内容逐字节回归锚） |
| 4 | ADR-0024 | 决策 3 L43–56（清单条目三字段、path 与实参同基、depth 尾段即被裁键名、width 父路径单条、omitted=直接子项数） | 截断清单恒在场；条目 `{path, kind, omitted}`；omitted 计数语义断言（直接子项数 ≠ 后代总数 fixture） | **implements-existing-decision** | 0024 L44–56；验收 L123 | 清单源 = 值通道载体计数（T1 `ReadLogicalValueTruncationEntry`）；不逐键罗列 width；条目不带被截容器内部子键列表 |
| 5 | ADR-0024 | 决策 2 L33–40（截断省略唯一值内形态、E1 吸收纪律不动摇、`depth:0` 唯一例外） | T3 组合面不引入新值内形态：键省略 + 清单消歧；无「键在值 undefined」第三态 / 哨兵 / 同形占位 | **no-conflict**（值内形态已由 T1 落地；T3 只组合） | 0024 L35–40；CONTEXT L49–51 | runtime 组装不得在值或投影通道引入占位/哨兵形态 |
| 6 | ADR-0024 | 决策 5 L81（两通道截断位置对齐，契约级承诺；commit `ba11f32`）：同预算下值截断位置与投影截断标记一一对应，错位即契约违约 | 主缝断言「同一预算下值截断位置与投影截断标记一一对应」 | **implements-existing-decision**（T2 落计层规则前提，T3 兑现组合验收） | 0024 L81；T2 设计 §6.10/G10.2 交付的 options 规则集对齐前提 | 两通道 options 校验规则集不得分叉（carrier `READ_OPTIONS_INVALID` 与 resolver `SCHEMA_OPTIONS_INVALID` 同规则）；对齐断言进主缝契约测试 |
| 7 | ADR-0024 | 决策 5 L74 + 验收 L125（width 对投影无操作；仅 width 预算读的投影与无预算读逐字节相等） | AC「width 触发时 schema 投影与同路径无预算读逐字节相等」 | **implements-existing-decision** | 0024 L74、L125 | width 参数不进投影裁剪判定（T2 已落）；T3 组合不得让 width 经由组合层影响投影 |
| 8 | ADR-0024 + ADR-0016 | 0024 决策 5 L73/L75；0016 L22（`schema:null` 单义、ok 恒真）、L24–25（值缺席照常返 schema、空路径返 ROOT 投影） | 预算读下 `schema:null` 三情形单义不变；always-on 不降级 | **no-conflict**（既有条款在预算下的组合由 0024 L73–75 授权，单义条款未被修订） | 0016 L22–25；0024 L75 | 组合层不新增 schema 缺席原因分类；值缺席/空路径行为原样 |
| 9 | ADR-0016 | L19 结果形状恰三键——被 0024 修订节第 1 条（L101）+ 决策 4 显式修订 | 五键恒形与 0016 三键文本的表面张力由 0024 合法解除（新形状字段恒在场、自描述，无「结果形状随参数分叉」；schema 通道仍 always-on） | **implements-existing-decision**（0016 形状条款经 0024 显式修订，corpus 内授权链） | 0016 L19；0024 L60–69、L101 | 不得复活 schema opt-in 或参数化形状分叉；0016 未列修订条款（null 单义、失败通道、detached 深拷贝）原样有效 |
| 10 | ADR-0016 | L23 失败分支（`PATH_NOT_ALLOWED` / `RUNTIME_READ_DISABLED` / lease released 各走原有通道） | 既有失败分支形状不动、不带 truncated/truncations；`READ_OPTIONS_INVALID` 为**新增**分支（不改既有分支） | **no-conflict** | 0016 L23；0024 L67、L30 | `PATH_NOT_ALLOWED` 形状以 doc-runtime 为单源派生（runtime.ts L117–119 既有纪律）；`NAMESPACE_LEASE_RELEASED` 冻结 issue 原样 |
| 11 | ADR-0016 + ADR-0009 | 0016 L75（namespace-runtime 组合两者）/ L76（registry 仅类型别名跟随、lease 行为零变化）；0009 L38（lease 代理 Runtime 同步读取） | lease 加 options 参数**原样透传**（0024 决策 6 加法授权）；`NamespaceLeaseReadDataResult` 类型别名跟随；`Equal<...>` 类型锚随之 | **implements-existing-decision** | 0016 L75–76；0009 L38；0024 L87 | 透传 = 代理语义加法扩展（非行为分叉）；released 短路先于透传；lease 层不得新增预算解释/校验/第二行为 |
| 12 | ADR-0008 | 读取能力 L16–27——被 0024 修订节（L99）修订为「预算内投影 + 截断清单」（不传预算 = 完整投影默认保留）；读取不进 sequencer | 预算读语义修订已注册；T3 组合保持 reads 在 sequencer 外、detached 投影、可变普通深拷贝 | **implements-existing-decision** | 0008 L16–27；0024 L99；namespace-runtime AGENTS「Reads stay outside that sequencer」 | 读路径零 sequencer 槽位；返回面保持 detached（无 live 引用递出） |
| 13 | ADR-0008 + CONTEXT | 0008 L123（`RUNTIME_READ_DISABLED` 稳定码、lifecycle 失败不借路径失败码）；CONTEXT L115–117（停接纳、key 仅 lifecycle、getStatus 不受影响） | lifecycle 停接纳分支原样；`READ_OPTIONS_INVALID` 同纪律不借生命周期码 | **no-conflict** | 0008 L123；CONTEXT L115–117；0024 L30 | lifecycle gate 行为零变化（closing/closed 期同步结果联合拒绝）； getStatus 不受预算面影响 |
| 14 | ADR-0003 | L46（派生 schema 形状变更须走设计修订流程）；0024 L115（否决 `kind:'truncated'` 进 9-kind 冻结面） | T3 深拷贝器将遇 T2 `SchemaTruncationMarker`（`kind:'truncated'`，包装联合成员）——标记是投影通道派生形态，非 ValueSchema 成员 | **no-conflict**（需求未触冻结面；组合面处理标记不得下沉为 ValueSchema kind） | 0003 L46；0024 L77/L115；resolve-schema-at-path.ts L82–88 | 标记处理留在投影包装层；无预算读投影恒纯 ValueSchema、形状零变化；拷贝器对未知 kind 的处置由 SA1 设计钉死（见 §8 第 4 条） |
| 15 | ADR-0011/0014 + ADR-0016 L77 + docs/protocols | 诊断变更日志不涉及读面；ReplicationSession raw 读面（可信域）不变；readData 不上 wire（grep protocols/phases/vfsl 无条款面） | T3 触碰面限于 namespace-runtime / namespace-registry 读面与测试；零 wire、零诊断日志、零复制面改动 | **no-conflict**（范围核对） | 0016 L77；grep 核对记录（relevant_decisions §2） | 不触 wire 字段 / event 成员 / 错误码词表（instance-replication-v1.md 面） |
| 16 | 模块 AGENTS（namespace-runtime / namespace-registry / doc-runtime） | runtime：reads 不进 sequencer、公共面 detached、registry 经 internal seam；registry：公共 API 只经 `src/index.ts`、lease 独立能力；doc-runtime：读取 schema 无关 | T3 改动落在 runtime/registry 公共读面 + 测试；doc-runtime 只消费不修改 | **no-conflict** | 三份 AGENTS Contract/Boundaries 节 | 类型/签名变更经各包 `src/index.ts` 公共出口；全套包门禁 + root `pnpm typecheck` / `pnpm test`（AC 末条） |

裁决分布：no-conflict 7 项（#5、#8、#10、#13、#14、#15、#16）；implements-existing-decision 9 项（#1、#2、#3、#4、#6、#7、#9、#11、#12）；evolution-required 0 项；hard-conflict 0 项。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| ADR-0016「结果形状」恰三键条款（L19） | ADR-0024（accepted，2026-09-12，corpus 内）决策 4 + 修订节第 1 条（L60–69、L101） | readData 成功分支恒五键；失败分支形状不动、不带新键 | truncated/truncations 恒在场（空清单空数组）；既有「恰三键」形状锚/深等断言经 T0 helper 全线修订；破坏性修订随各包 0.x minor bump（L69 论据） |
| ADR-0016「分层与兼容面」L76（registry 仅类型别名跟随、lease 行为零变化）——狭义读法 | ADR-0024 决策 6（L87）「registry lease 原样透传」 | lease `readData(path, options?)` 加法参数透传 | 透传不改代理语义：released 短路、类型别名跟随、`Equal<...>` 锚保持；lease 层零预算解释 |
| ADR-0008「读取能力」完整深拷贝读语义（L27） | ADR-0024 修订节（L99） | 读语义 = 预算内投影 + 截断清单；不传预算 = 完整投影（既有语义作默认保留） | 投影递归成本界 = 实际返回部分；T3 组合兑现两通道同预算 |
| （边界注记）ADR-0016 L74 `readLogicalValueAtPath` 两参 / L50–58 `resolveSchemaAtPath` 两参 | ADR-0024 修订节第 2/3 条（L102–103） | 载体/解析入口三参化 | **非本票面**——T1 #334 / T2 #335 已落地；T3 只消费 |

Owner 评论 override：无需（无既有决策被违反；上述均为 corpus 内新 ADR 显式修订路径）。SA8 不替 Owner 或 SA1 创建新 override。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| ValueSchema 9-kind 语义联合（含 DerivedSchema 形状） | 截断标记不得成为 ValueSchema 成员；无预算读投影恒纯 ValueSchema | ADR-0003 L46；0024 L77/L115 | 需求未触——一致（T3 拷贝器标记处置为实现期核对项，§8-4） |
| `ReadDataSchemaProjection` 四键（valueSchema/aliases/docs/aliasDocs）与键规约 | 键集不变；docs 三源合并序与键文法不变；valueSchema 仅预算读下类型加宽 | 0016 L30–42；0019 修订节 L106–115；0024 L77 | 需求未触投影体键集——一致 |
| 既有失败分支形状 | `PATH_NOT_ALLOWED`（doc-runtime 单源）、`RUNTIME_READ_DISABLED`（ok/code/path/message 四键，runtime.ts L110–115）、`NAMESPACE_LEASE_RELEASED` 冻结 issue 原样；均不带 truncated/truncations | 0016 L23；0024 L67；lease.ts L78–82 | 需求明文「失败分支形状不动」——一致 |
| 无 options 逐字节现行为 | options 缺席时值与投影内容逐字节不变（信封按决策 4 恒五键加键） | 0024 L29、L67；验收 L122 | AC 自带回归锚——一致 |
| E1 输出端吸收纪律 | 无「键在、值 undefined」第三态；`depth:0` 目标容器为唯一例外 | 0024 L40；CONTEXT L49–51 | 需求未触——一致 |
| `schema: null` 单义与 always-on | 预算参数不是 schema 开关；null 三情形不区分；ok 恒真 | 0016 L22/L69；0024 L75、L101 | 需求未触——一致 |
| 读不进 write sequencer；lifecycle 停接纳 | reads 零 sequencer 槽位；closing/closed 同步结果联合拒绝、key 仅 lifecycle；getStatus 全生命周期可用 | ADR-0008 读取能力节/L123；CONTEXT L115–117；runtime AGENTS | 需求未触——一致 |
| Wire / 诊断日志 / 复制 raw 读面 | 零改动（readData 不上 wire；诊断日志不涉及读面；ReplicationSession 可信域不变） | 0016 L77；grep protocols/phases/vfsl | 需求未触——一致 |
| lease released 通道 | released 短路先于一切透传；冻结 issue 形状不变 | 0009 L38；lease.ts L78–82、L276–279 | 需求为 active 期透传——一致 |

## 6. Evolution requirements

无新增 evolution-required 项。本票所需的决策演进（ADR-0008 读语义、ADR-0016 四处条款、CONTEXT 词汇族）已由 ADR 0024 及其基线提交（`50d52a1`/`7679c57`/`ba11f32`，PR #332 支）在同一变更集内完成——修订文件（ADR 0024 + CONTEXT.md L37–55）、新旧语义（修订节逐条登记）、失败语义（决策 1：`READ_OPTIONS_INVALID` 同步不抛、码位独立）、版本（0.x minor bump 论据 L69）、验证（验收节 L120–130）、不变冻结面（备选否决节 L109–118）齐备。

残余义务归票核对（非本票、无悬空）：T4 #337 = `DeepOptional` 类型面（0024 决策 7）；T5 #338 = 文档负控正则修订（0024 L105）、docs/integration 形状注记（cordis-plugin-hosting.md L340「恰三键」）、typed-access 预算纪律条款；ADR 0016/0008 文本回填「ADR 0024 修订」批注节属 PR #332 / T5 面——repo 先例（0008 的 0016/0017 修订节、0016 的 0019 修订节）为回填式，但 0024 修订节已「四处显式登记，不静默矛盾」，corpus 内权威链完整，docs/AGENTS「显式修订、不静默矛盾」义务已满足（T2 门禁 §6 同一注记，维持非阻塞结论）。

## 7. Hard conflicts

无。

## 8. Required actions

1. **按 ADR 0024 决策 6 钉死选型实现**：同一 options 对象在一次 readData 内贯通值通道（T1 三参）与投影通道（T2 三参）；不新增第二条读路径；禁止 runtime 层对完整投影的事后裁剪（0024 L116 否决项）。
2. **五键恒形**：预算读与无预算读（空清单）都携带 `truncated`/`truncations`；失败分支形状不动、不带新键（0024 L67）；恰三键 → 五键修订在 T0 集中 helper 处完成（gate 测试 `readdata-shape-assertion-consolidation-gate.test.ts` 随之更新）。
3. **`READ_OPTIONS_INVALID` 公共失败分支**：同步、不抛、不借路径/生命周期码（0024 L30）；无 options 调用不可产生该码；载体层定序沿用 T1 已钉死的 G0 → options → N0（read.ts L112/L135）。
4. **SA1 设计收口点（ADR 未钉死，非冲突）**：(a) runtime 层 lifecycle gate 与 options 校验的定序（现结构 lifecycle 先行——closing/closed + 非法 options 归 `RUNTIME_READ_DISABLED`；与 #92「停接纳即拒绝」精神一致，但 0024 未明文，需设计钉死并入契约测试）；(b) 深拷贝器对 `SchemaTruncationMarker`（`kind:'truncated'`）的处置——现 9-case 显式分派无 default（read-schema-projection.ts L121–181），类型加宽后必须显式覆盖且不得把标记当 ValueSchema 成员（ADR-0003 冻结面）；(c) 公共 `truncations` 清单的源与合成（值通道载体计数为决策 3 语义源；resolver 无清单字段）；(d) runtime 类型面从 T1 双联合的派生方式（`READ_OPTIONS_INVALID` 只在预算联合——read.ts L96–97 注记预期的零泄漏点）。
5. **两通道一致性契约**：值截断位置 ↔ 投影截断标记一一对应（0024 L81，错位即契约违约）；两通道 options 校验规则集不分叉（T2 §6.10 交付的对齐前提）；width-only 预算读投影与无预算读逐字节相等（L125）。
6. **lease 透传**：加法可选参数、active 期原样透传、released 短路与冻结 issue 原样、类型别名跟随与 `Equal<...>` 锚保持（0016 L76 + 0024 L87）；公共面经 `src/index.ts`。
7. **越界禁令**：不动 doc-runtime / vfsl 公共面（T1/T2 已落，只消费）；不动文档负控正则与 docs/integration 形状注记（T5 #338 面）；不做 `DeepOptional`（T4 #337 面）；不触 wire / 诊断日志 / 复制面。
8. **门禁**：影响包全套门禁 + root `pnpm typecheck` / `pnpm test`（AC 末条；两份模块 AGENTS 验证节）。

## 9. Verdict

**clear** —— 16 项对照全部为 no-conflict（7）或 implements-existing-decision（9）；无需新的决策演进；被修订的 ADR 0016/0008 条款均有 corpus 内合法 override 链（ADR 0024 accepted）；谱系残余义务（T4 #337 / T5 #338）已开票承接、无悬空。总控可继续派发 SA1。

## 10. requiresConflictRecheck

**true** —— 理由：(a) 公共 API 面变更（runtime `readData` 签名 + 成功分支五键结果联合 + 新公共失败码 + registry lease 签名）尚待 SA1 设计与实现核对；(b) §4 三项正式 override 的落地（失败分支不带新键、无 options 逐字节回归、lease 透传不扩大代理语义）须在设计后复审与实现复审逐项核对；(c) 两通道截断位置一一对应为跨 T1/T2/T3 的契约级承诺，组合层（本票）落地时须实测核对未漂移。

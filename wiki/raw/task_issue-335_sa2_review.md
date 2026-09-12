# SA2 设计攻击评审 — Issue #335 `[shape-budget] T2: 投影通道形状预算——解析入口三参化与截断标记`

- 派发：`sa-9a70014d-5084-4dcb-95af-2dac67f7643a`（role `mabf-sa2`，phase `design-review`，iteration 1）
- Worktree：`/home/wangjian/nomicore-fix-issue-335`（branch `mabf/issue-335`，HEAD `ba11f328ae845bf882d131a2098a7afc8dfcc17c`，实测与设计头一致；生产源码零改动，仅 `wiki/raw/task_issue-335*` 任务件 untracked）
- 评审日期基线：2026-09-12（与设计/契约同 worktree 同 HEAD）
- 评审对象：iteration 1 修订版设计（770 行）——对 iteration 0 全部五项 finding（F1/F2 MAJOR + F3/F4/F5 MINOR）的逐条修订；主干（公共类型/API 面、Q1 标记归属、计层算术、options 校验、兼容路线）自 iteration 0 起未变，本迭代复核其未被修订扰动。

## 1. Reviewed inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报（Issue #335 正文，comments REST `[]`） | `wiki/raw/task_issue-335.md` | 已读 |
| SA1 设计 iteration 1（评审对象） | `wiki/raw/task_issue-335_design.md`（770 行） | 已读全文 |
| 本评审 iteration 0（修订输入） | `wiki/raw/task_issue-335_sa2_review.md`（reject；F1/F2 MAJOR + F3–F5 MINOR） | 已读（本文档原位更新） |
| SA6 诊断与验收契约 | `wiki/raw/task_issue-335_sa6_contract.md`（382 行） | 已读全文 |
| SA8 冲突报告（verdict `clear`，requiresConflictRecheck=true） | `wiki/raw/task_issue-335_conflict_report.md` | 已读全文 |
| SA8 决议摘录 | `wiki/raw/task_issue-335_relevant_decisions.md` | 已读全文 |
| 母法 ADR 0024 | `docs/adr/0024-readdata-shape-budget.md` | 已读（L25–31/L66–84/L96–132 逐条复核） |
| 既有母法 | ADR 0016 / 0003 / 0019 / 0008（经 SA8 摘录 + 源码交叉核对） | 摘录核对 |
| 词汇 | `CONTEXT.md` L41–55（「语义 schema 投影」预算段原文核对） | 已读 |
| 现状源码 | `packages/vfsl/src/resolve-schema-at-path.ts`（496 行全文）、`src/index.ts`、`src/derived.ts`、`src/evaluate.ts`（valueOf/别名登记）、`packages/namespace-runtime/src/read-schema-projection.ts` | 已读全文/关键段 |
| 既有测试/夹具 | `resolve-schema-at-path*.test.ts`/`.test-d.ts`、`-fixture.ts`、`-member-docs-fixture.ts`（M4 全文）、`runtime-readdata-schema-projection-red.test.ts` | 关键断言与键文法核对 |
| 模块契约 | `packages/vfsl/AGENTS.md`、根 `AGENTS.md` | 已读 |
| 工程面 | `tsconfig.base.json`、`vitest.config.ts`、git HEAD/status、消费面 grep | 已核 |

方法：独立重放 §6.3/§6.3.5 walk 规约（含两相环防御入口协议）于 #272 夹具矩阵全格（5 路径 × depth 0–4）、M4 夹具 23 docs 键逐键锚定对账、两类环状输入（透明环/容器环 × 有限预算/∞ 预算）与合法递归别名（`alias ROOT` 含 `ref:ROOT`）的终止性与输出同构推演；核对既有源码行为（`sliceDocs` L443–452 前缀谓词、`collectAliasClosure` L380–419、`matchValueCandidate` inFlight L226–247、`matchValueNode` visited L251–253、`valueOf` L276–325 逐位新建 + L60 `values[a.name]` 每名一体）；grep 复核 `resolveSchemaAtPath` 消费面与 DENY 八文件存在性。

## 2. Verdict

**approve** —— iteration 0 全部五项 finding 经逐条独立核验**已解决**：

- **F1（环防御）已解决**：`出口写表`单表结构废除，改为「完成表 + 进行中集」两相防御（§6.3.5），入口协议固定（完成表 → 进行中集 → 渲染 → 移出 → 写表），重入返回**原节点引用**。终止性、throw 通道纯度、`{}` ≡ 无 options（含合法递归别名与手造环）三面闭合；§7.4.2「环机制行为中性」论证与 §12 风险行同步修正。
- **F2（enum 成员注释键）已解决**：采用本评审选项 (b)——walk 的 enum 终态补 emit `${path}.<member ${i}>`；§7.4.2 双向等价论证重立；对选项 (a)（前缀匹配）的否决经核验**技术成立**（`[]` d=1 时 `ROOT` 壳已渲染，前缀规则过选标记位键 `ROOT.audit`/`ROOT.keywords`/`ROOT.config`——三者确为 #272 fieldDocs 实际在册键，与矩阵 docs=`{ROOT.notes}` 矛盾）；M4 型逐字节差分锚进入 §10/§11。
- F3/F4/F5（MINOR）均已解决（伪代码顺序 + hasOwn 守卫；DENY 显式枚举八文件、两表交集为空；跨票 options 规则集对齐前提入 §6.10）。

本迭代新攻击发现 2 项 MINOR（N1：§7.3 伪代码 emit 谓词「child 不是 MARKER」对经 optional 透明包装的标记位字面误读，与权威矩阵/§6.6 矛盾；N2：§6.3.5 完成表串染分析对「富预算首渲染复用到贫预算位」方向的单边表述）——均不阻断，见 §14。无 BLOCKER/MAJOR。

`pass` 仅表示设计通过审查；实现与活链路验证归 SA4/SA7。设计自申报的 SA8 复核项（§14 五项，含 `requiresConflictRecheck=true`）不被本裁决替代。

## 3. 需求覆盖

| Requirement（Issue 正文 What to build / AC） | Design section | Assessment |
|---|---|---|
| `resolveSchemaAtPath(derived, path, options?)` 三参化（ADR-0024 决策 5） | §1 目标 1 / §6.8 / §7.2 | 覆盖；重载方案与既有 test-d 断言相容性复核成立（§9） |
| valueSchema 与值同 depth 截断 | §6.3 walk / §6.3.4 矩阵 | 覆盖；矩阵全格重放一致（含 `['u']` d=2 修正格——本迭代再重放确认） |
| 截断处放投影层截断标记（不扩 ValueSchema、携带成员级线索） | §6.4 / §6.1 | 覆盖；`kind:'truncated'` 十案判别 + 线索嵌套判别联合成立；九 kind 冻结面零改动（`derived.ts` L44–53 实证） |
| 别名闭包与 docs/aliasDocs 切片同遍历收缩（先裁后收集） | §6.3 / §6.6 / §7.3 | 覆盖（iteration 0 为 F2 部分覆盖，现已闭合——enum 成员位 emit 后 docs 选键与无预算分支在零标记与裁剪两态均等价，§7.4.2 双向论证重放成立） |
| 计层规则：union 透明、ref 终态边界 | §6.3 表 / §6.2 / §6.10 | 覆盖；ref 不耗层（同 b 入体）与 SA6 §12.4 默认读法一致（`['audit']` d=1「净体」反证核验） |
| width 对投影无操作 | §6.9 | 覆盖（校验后不进任何判定） |
| 无 options 逐字节不变 | §6.7 / §7.4 | 覆盖；结构性论证重立（分支隔离 + 身份短路 + 环中性 + enum 成员位 emit 四合取） |
| AC1–AC5 → 设计落点映射 | §4 / §11 | 映射完整且与 SA6 §12.1 一致；AC2/AC4 行已补 M4 型逐字节差分锚 |
| 非目标（不动 doc-runtime/namespace-runtime/registry/docs） | §1 / §10 DENY | 覆盖，与 SA8 §8.5 一致；修订未扩大范围 |

## 4. Owner评论覆盖

REST Issue comments 读取为 `[]`（简报与派发均确认，本迭代派发明示「无 Issue comments to incorporate」）——无评论来源义务，无映射表可列。全部义务 = Issue 正文 + AC1–AC5 + ADR 0024 决策 5，设计与契约处置一致。

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA8 #1 决策 5 钉死：预算在解析递归内生效、禁事后裁剪、禁值域哨兵与扩 kind | §6.3/§7.3 单遍历 walk（先裁后收集、`b=0` 先于子位触达）；改动面限 vfsl 两文件 | 落实 |
| SA8 #2 公共面只经 `src/index.ts` | §7.1 九项名目全经 index 出口（`index.ts` L125–126 现唯一出口实证） | 落实 |
| SA8 #3 resolver 层 options 失败通道收口 | §6.5：`SCHEMA_OPTIONS_INVALID` 判别联合、同步不抛、path 回显、敌意 getter/Proxy 收敛、校验次序 path → options → derived | 落实；码位论证（vfsl `SCHEMA_*` 码族先例）成立，列 §14 复核 |
| SA8 #4 回归锚（无 options 逐字节 + width-only 逐字节） | §6.7/§7.4/§11 | 落实；§7.4.2 论证经 F2 修订后重放成立（enum 注释键缺口已闭合） |
| SA8 #5 越界禁令 | §10 DENY | 落实 |
| SA8 §10(a) 公共 API/类型面后置核对 | §14.1 + `requiresConflictRecheck=true` | 落实 |
| SA8 §10(b) 两项 override 落地 + 范围申报 | §6.1 诚实申报 aliases 加宽 = 显式扩大，列 §14.2 复核 | 处置正确（SA6 §10 表已预告该路径） |
| SA8 §10(c) 跨票计层一一对应 | §6.10 T3 归一化前提 + 弱断言/夹具规避 + **options 校验规则集对齐前提（F5 修订）** | 落实 |
| SA8 §5 冻结面（九 kind、两码语义、四键、合并序、always-on、纯函数、负控、三包公共面） | §5 表逐项 + §6.3–§6.9 | 落实；F1 修复保持 throw 通道纯度（预算游走零新增 throw，§8） |
| P1/P2/P3 能力缺口承接 | §3 表四行 | 落实 |

## 6. 设计内部一致性

**F1–F5 修订核验（逐条独立重放）**：

- **F1 → §6.3.5 两相防御：成立**。入口协议（完成表 → 进行中集 → 渲染 → 移出 → 写表）对全部预算域终止：透明环（union/optional 自引用）任意预算首重入即透传原引用；容器环 `b=∞` 透传 + 身份短路输出原环状结构、有限 b 按层耗尽产生有界壳+标记（重放：2-环 A→B→A，b=1 → B@0 MARKER → A 壳；b=2 → 重入 A@0 透传 → 全身份短路返回原 A——两种结果均确定、终止、无裸异常）。所引先例与源码逐字核对相符：`matchValueNode` visited 先加后递归静默终止（L252–253）、`collectAliasClosure` visitedNodes 同款（L388–389）、ref 名环由路径游走段 inFlight 处置（L226–247，路径依赖）——预算读与无预算读在同一 (derived, path) 上 throw 行为一致（游走段逐字保留）。§6.1 递归包含例外经源码核实成立：path `[]` 终点 `values['ROOT']` 直walk（源码 L133 实证），无预算 `collectAliasClosure` 对含 `ref:ROOT` 的合法派生物登记 `aliases['ROOT'] = values['ROOT']` 原体引用（L409）；预算分支重入经 in-progress 透传取得同一原体——`{}` 逐字节恒等的必要条件成立，且输出经按名 ref 终止、恒 JSON 可序列化（合法派生物的"环"是名引用不是对象图环）。
- **F2 → enum 成员位 emit：成立**。M4 夹具 23 键逐键对账：`ROOT.mode.<member 0/1>`（内联）、`Status.<member 0/1>`（别名）、`ROOT.inlineItems.<item>.<member 0/1>`（数组元素）、`ROOT.recInline.<key>.<member 0/1>`（Record 槽——evaluate `record` 分支实证 `'<key>'` 字段形态）四形态全部由 walk 的「union/optional 成员位既有 emit + enum 字面量成员位补 emit」覆盖；零标记读（`{}`/充足 depth/width-only）下 `spine ∪ emitted` ≡ 无预算前缀选键集（双向重放：⊆ 各 emitted 位以终点路径/闭包锚名为前缀根；⊇ 各无预算键的锚定链文法段（字段名/`<key>`/`<item>`/`<member N>`）逐类被 walk 渲染 emit，含 `[]` 终点壳位 `ROOT` 覆盖 `k === p` 精确形、闭包根锚 emit 覆盖 `k === a` 形）。对选项 (a) 的否决核验为正确（见 §2）——该否决撤回了 iteration 0 建议中错误的前提（「标记位不入 emitted 即天然排除」），技术处理干净。
- **F3 → 已解决**：§6.3 表 object/array 行 `b=0 → MARKER` 先于一切子位触达（权威顺序明文）；§7.3 伪代码字面顺序已改（`if b == 0` 首行）；ref 行 `Object.hasOwn` 守卫 + `InternalError("值树未声明别名: …")` 与 `collectAliasClosure` L406 同文同码；§11 有 `{depth:N>0}` 毒化差分行。
- **F4 → 已解决**：DENY 行显式枚举既有 8 文件（逐一核对全部存在于 `packages/vfsl/test/`），ALLOW 四新文件（`-budget-*`）与 DENY 零交集；「import ≠ 修改」注记明确。
- **F5 → 已解决**：§6.10 新增跨票 options 校验规则集对齐前提（含 present-undefined 拒收加严 pin），并随 G10 前提写入 T2 实现说明。

**iteration 0 已核验主干的未扰动复核**：§6.4 名目、§6.8 重载（既有 test-d `parameter(0/1)` 取末位重载、两重载前两参同型；两参调用解析第一重载保纯度）、§6.5 校验次序（path → options → derived，敌意通道先于可信域）、§6.9 width 零作用、§6.3.4 矩阵修正（`['u']` d=2 无标记 ≡ 无预算，再重放确认）——修订均未触碰或仅做一致性扩写。

**残余不一致（新，MINOR → N1）**：§7.3 伪代码（及 §6.3 表措辞「`child` 非标记才 emit」）对**经 optional 透明包装的标记位**存在字面误读：`[]` d=1 时 `config` 字段的 walk 结果为 `optional(MARKER(container 'object'))`（§6.2 包装保留的必然形态），按伪代码字面「child 不是 MARKER」为真 → emit `ROOT.config`；但 §6.3.4 矩阵格与 §6.6 例（L393–394）明文 pin `[]` d=1 docs = `{ROOT.notes}`、`ROOT.config` 被裁不入选。权威表意（「字段值位被裁则该路径不入 emitted」）与矩阵一致，伪代码谓词欠精确——与 iteration 0 F3 同类（伪代码誊写缺陷、权威表正确），且 §11 AC1「矩阵逐格断言」+ AC2 docs 断言为确定性 oracle，字面误实现必红。附带：union 壳部分/全部成员标记时宿主位自身 docs 键的去留（union{scalar,MARKER} / union{MARKER,MARKER}）未见明文 pin——现有夹具无可观察位（#272/M4 均无 union 宿主位在册键），两读法均满足 G5.1 ⊆ 与零标记等价，属可 pin 自由度。

## 7. 状态机与并发攻击

对象为同步纯函数，无状态机/并发维度；确定性/幂等由零跨调用状态 + walk 局部 inProgress/memo 保证（§7.5/§8，G2.7/G8.4）。针对性攻击（重放）：

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | 手造派生物，union/optional 自引用环（任意预算）或容器环 + `{}`/width-only（b=∞） | 三参预算调用进入 walk | 终止、ok、`{}` 输出与无预算读引用级同构 | 无缺口——§6.3.5 入口协议重入即透传原引用（不构造/不 emit/不抛）；无预算读对该输入亦 ok 且共享原节点（源码 L252–253/L388–389 实证）——两分支同构 | — |
| S2 | 手造容器环 + 有限 depth | 预算调用 | 终止、确定、标记/透传按规约 | 无缺口——预算在完成一次环回前耗尽 → 有界壳+标记；未耗尽 → 重入透传（重放两例均确定）；测试口径明示环状输出用引用相等断言（不可 stringify） | — |
| S3 | 合法递归别名（`alias A { ref A }` / `alias ROOT` 含 `ref:ROOT` / 互递归 A↔B） | 任意预算 + 任意 path | 与无预算读同构（闭包单名、原体/原 ref 引用、JSON 可序列化） | 无缺口——自/互递归经闭包名集先登记终止（镜像既有收集器）；path `[]` 的 ROOT 直walk重入经 in-progress 透传取得原体（§6.1 例外 + §6.3.5(c)，源码 L133/L409 对账成立） | — |
| S4 | 同一别名被多个不同剩余预算位引用 | 预算读 | 确定性渲染（首发现预算） | 无缺口——§6.1 pin + 失效方向安全论证 + §6.10 T3 弱断言/夹具规避前提；ALLOW 夹具含双引用构造断言 | — |
| S5 | 重复调用同 (path, options)、交错预算/无预算调用 | 任意次 | 逐字节/逐引用确定、互不影响 | 无缺口（零跨调用状态；环状输入「逐引用确定」入测试口径） | — |
| S6 | path 与 options 同时非法；path 内容级失败 + options 非法 | 单次调用 | path 码胜（形状守卫在前）；options 码胜于游走期 NOT_FOUND | 无缺口（§6.5.4 次序推论一致） | — |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | 敌意 options（抛错 getter / Proxy / 非对象 / 未知键 / present-undefined / 非法数值） | 局部 try/catch 收敛 `SCHEMA_OPTIONS_INVALID`，校验先于一切游走与 derived 访问；try 范围仅限校验块 | 无缺口；「什么都不泄漏」严于 G7.4 且不吞 InternalError | — |
| E2 | 值树节点环（手造）在预算分支 | 两相防御透传/有界壳；无 `RangeError` 等裸异常 | 无缺口（F1 已闭合；§8「预算游走零新增 throw」与 throw 纪律 L24/L299 相容——ref 缺失 InternalError 为既有通道的预算分支镜像，非新增通道） | — |
| E3 | 预算分支 ref 目标缺失（`{depth:N}` N 足够触达） | `Object.hasOwn` 守卫 → `InternalError`（与 L406 同文）；`{depth:0}` 不触达 → ok | 无缺口（F3 已闭合；P3 三态差分入 §11） | — |
| E4 | options 校验失败后的部分状态 | 无（失败对象恰三键、path 新鲜副本、校验先于游走） | 无缺口 | — |
| E5 | render 中途 throw（ref 缺失）后的 walk 局部状态 | 调用整体 unwind，inProgress/memo 为调用内局部，无泄漏面 | 无缺口（§6.3.5(1)「每调用局部，零跨调用状态」） | — |
| E6 | 回滚 | 移除预算分支 + 出口即回滚；无 options 路径分支隔离未被触碰 | 无缺口 | — |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| 两参调用面（namespace-runtime `read-schema-projection.ts` L56 + 全部既有测试） | 无——重载第一签名保 `ResolveSchemaAtPathResult` 纯度；`cloneValueSchema` L121–181 逐 kind 穷举在纯 `ValueSchema` 下保持穷尽；既有 test-d `parameter(0/1)`（取末位重载，前两参同型）与两参调用断言不红 | grep 复核：生产消费唯一 `read-schema-projection.ts`（不加 catch、InternalError 直通注释实证）；`ReadDataSchemaProjection` 泛型化缺省实例化逐字段同型 | — |
| 显式 `undefined` 三参调用 | 运行时 ≡ 缺省（逐字节）、静态取加宽面——已显式区分并在 test-d 锚定 | §6.8 | — |
| `fn.length` 2→3 | 已如实记录（ADR「签名逐字不变」指调用形态；红灯机制以 JSON.stringify 差分为断言） | §6.8 尾注 | — |
| T3（#336）未来消费 | 三码吸收 + 标记 detach 前提 + **options 校验规则集对齐前提（F5 修订补齐）**均已交付 | §6.10 | — |
| npm 0.x 外部消费者 | 加法扩展 + minor bump 依据（ADR 0024 L69）已引 | §9 末行 | — |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| 预算游走/计层/标记/闭包/切片收缩 | vfsl resolver（ADR 0024 决策 5 钉死） | `resolve-schema-at-path.ts` 单文件 | 正确 |
| 公共名目出口 | `src/index.ts` 唯一出口（模块契约） | §7.1 | 正确 |
| detached 深拷贝/五键组合 | namespace-runtime（T3 面） | 明确非目标 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 别名闭包收集 | `collectAliasClosure`（名集先登记、`aliases[n]=values[n]` 原样、发现序） | walk 的 ref 情形镜像同一纪律（名集先登记、锚名切换、首发现预算）；递归包含例外显式复现「原体引用」纪律 | 一致 | 单遍历同构；F1 修订后 visited 语义亦同构（先加后递归 ↔ 进入即登记） |
| docs 切片 | `sliceDocs`（三表扫描序、三源合并序、空过滤、memberDocs 条件稀疏） | 预算分支照抄扫描/合并序，仅换 want 谓词（`spine ∪ emitted` 精确匹配） | 一致 | 只收缩选键集合；F2 修复后两态等价 |
| 值侧环/敌意防御 | matchValueNode visited、matchValueCandidate inFlight、collectAliasClosure visitedNodes | walk 两相防御（in-progress 透传 + 完成表 memo） | 一致（F1 修订后） | 透传复现「共享原引用」输出语义；完成表为 DAG 记忆化对应物 |
| 码族惯例 | vfsl `SCHEMA_*`、envelope issue 族、runtime 自有族 | `SCHEMA_OPTIONS_INVALID` | 一致 | 接缝内新码 + §14 复核项 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 类型树/别名表/文档三表 | `derived`（只读） | walk 渲染产物（每调用新鲜、零缓存） | 无（G3.4 深比较锚定；§7.5 数据流表） |

### 生命周期对称性

纯函数，无 acquire/release 面；无新增后台任务/缓存/监听。不适用，无缺口。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二套 docs 后处理 | `sliceDocs` | 预算分支复用同扫描/合并序 | 非平行 |
| 第二闭包收集器 | `collectAliasClosure` | 无 options 分支原样调用既有件；预算分支单遍历产出 | 非平行 |

无 BLOCKER 级架构问题。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW（2 src + 4 新测试/夹具）与 DENY（显式 8 文件 + 其余 vfsl src + 三包 + docs + 配置）交集为空；DENY 八文件逐一存在；无 glob 歧义（F4 已闭合） | §10 全表 + `packages/vfsl/test/` 实测清单 | — |
| 实现路径/测试路径全部落 ALLOW；DENY 与正文（§1 非目标、§7 蓝图）无冲突；T3/T4/T5 follow-up 为真实票谱系分工且前提（§6.10）已随本设计交付，无必要项被掩埋 | §10/§12 | — |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1 标记位置/线索（G2/G3 + §6.3.4 矩阵逐格） | budget.test.ts 矩阵断言 + D1/D2/D3 变异 | 无（矩阵经两轮独立重放核验） | — |
| AC2 闭包/切片收缩（G4/G5） | 键集精确相等 + 子集断言 + **M4 型 enum 注释夹具上 `{}`/充足 depth/width-only 与无预算读逐字节差分 + 被裁 enum 成员键省略断言**（iteration 0 缺口已补位） | 无 | — |
| AC3 计层/width（G2/G6） | 对偶孪生 + width-only/组合逐字节 ≡（预算生效后重验，enum 注释夹具对 F2 类缺陷敏感——已闭合） | 无 | — |
| AC4 公共面/回归锚（G1/G8） | test-d 新名目 + 两参纯度 @ts-expect-error + 14 路径冻结哈希 + **M4 型无预算基线冻结**（补 #272 哈希对 enum 注释键的盲区） | 无 | — |
| AC5 门禁（G9） | §12.6 四命令 + 改动面门禁 | 无 | — |
| options 校验（G7） | 非法值矩阵 + 敌意 getter/Proxy + path 回显 | 无 | — |
| 环防御（§6.3.5） | 手造环状派生物断言组（不发散/无裸异常/`{}` 引用级同构/有限 depth 确定/重复调用确定）+ 两相防御变异（恢复「出口写表」）必红 | 无——环状输出不可 stringify 的断言口径已明示用引用相等 | — |
| 预算分支 ref 缺失守卫（F3） | 毒化三态差分（`{depth:0}` ok / `{depth:N}` InternalError / 无预算 throw） | 无 | — |
| 计层矩阵修正（§6.3.4） | fixture oracle G0.2 层结构字面量独立对账 `['u']` d=2 | 无 | — |
| 多引用跨预算 | 双引用构造 + 确定性断言 | 无 | — |
| 测试入口真实性 | vitest include / typecheck.include / 包 tsconfig test glob 覆盖新路径；运行时红文件动态接缝纪律 | 无 | — |

## 13. Required revisions

无 BLOCKER/MAJOR。iteration 0 F1–F5 全部核验为已解决；本迭代新发现均为 MINOR，不阻断实施。

## 14. Non-blocking observations

1. **N1（MINOR，建议实现前顺手收口）——emit 谓词对透明包装标记位的字面精度**：§7.3 伪代码「`if child 不是 MARKER: emit`」与 §6.3 表「`child` 非标记才 emit」在 `optional(MARKER(...))` 形态下与权威矩阵矛盾（`[]` d=1 的 `ROOT.config`：矩阵/§6.6 pin 不入选，伪代码字面会 emit）。权威语义（「字段值位被裁则该路径不入 emitted」+ 矩阵格 + §11 逐格断言）已确定且唯一，字面误实现会被 oracle 测试捕获——不阻断。建议修订：§6.3/§7.3 将谓词精确化为「该子位未被裁：子结果经 optional 透明包装后根位为标记 ⟹ 不 emit；union 壳（成员部分或全部标记）⟹ 宿主位照常 emit（§6.10 多重标记语义）」，同时补一句 union 宿主位 docs 键去留的显式 pin（现为可 pin 自由度，现有夹具无可观察位；新预算夹具若在 union 宿主位放文档键须先 pin）。
2. **N2（MINOR）——§6.3.5 完成表串染分析的单边表述**：「首渲染胜出……方向为过度裁剪/少报，非危险方向」只覆盖 MARKER 首渲染情形；富预算首渲染的全量节点经 memo 复用到贫预算位时方向为**少裁/多报可见**（§6.1 自判的危险方向）。该情形仅存于可信域外手造 DAG（合法派生物单预算上下文——(i)–(iii) 论证经 `evaluate.ts` L60/L276–325 实证成立，memo 在合法输入上零命中），且该域已明文免责（承诺 = 终止 + 确定 + 无裸异常 + 环位原样透传）——净承诺正确，仅中间论证欠完整。建议补一句如实登记双向复用，避免后续读者误引「非危险方向」为普遍结论。
3. `[]` d=0 时终点锚位裸键（如假想的 fieldDocs `'ROOT'` 键）因「标记位不入 emitted + path `[]` 脊柱为空」被省略，而无预算分支经 `k === p` 选中——机械规则自洽（G5.1 ⊆ 成立、零标记态等价、现有夹具零可观察位），属 §6.6 脊柱保留 pin 的对偶边；建议随 §14.4 复核项一并一句 pin。
4. options 封闭形状检查经 `Object.keys`——Symbol 键与非可枚举键不可见，与 ADR 0024 L30 字符串键语义一致（readData 先例同款），非缺口（iteration 0 观察 3 维持）。
5. 设计对 Q1（aliases 加宽）、`SCHEMA_OPTIONS_INVALID` 码位、脊柱键保留、跨票计层四项 override/收口点的诚实申报与复核武装（§14 五项、`requiresConflictRecheck=true`）完整；F1/F2 修订均落在 ADR 0024 L73「选键收缩」授权域与模块 throw 纪律既有授权域内，本评审不追加新的 ADR 冲突面。
6. `fn.length` 2→3 与身份短路的引用级恒等强化（G8.3）均维持 iteration 0 判断：已如实记录/成立，存档备查。

---

**结论**：iteration 1 修订对五项 finding 的处置全部经独立重放核验成立（F1 两相环防御终止且与无预算读同构；F2 enum 成员位 emit 使 docs 选键两态等价、对前缀匹配的否决技术正确）；主干 API/兼容路线未受修订扰动。残余 2 项 MINOR（N1/N2）为文档精度类，权威规约与验收 oracle 已唯一确定行为。裁决：**approve**。实现期按 §11 断言组与 §12.6 门禁执行；SA8 后置复核（§14）不受本裁决替代。

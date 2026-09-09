# SA4 实现后红队审查 — Issue #272 vfsl 公开 `resolveSchemaAtPath`（ADR 0016）

- 角色：SA4（mabf-sa4）· 阶段 implementation-review · 迭代 0
- 被审对象：HEAD `de5633c`（branch `mabf/issue-272`，实现提交；基线 a6b2a79）——实测核实，工作树干净（无未提交改动）
- 审查产物：`wiki/raw/task_issue-272_sa4_review.md`（本文件）
- Worktree：`/home/wangjian/nomicore-fix-issue-272`
- 方法：静态实现审查（源码/diff/测试源码/真实 runner 入口逐行核读 + 手工推演全部契约路径）；按 SA4 纪律不运行测试、不启动服务

---

## 1. Reviewed inputs

| 输入 | 状态 | 说明 |
|---|---|---|
| 任务简报 `wiki/raw/task_issue-272.md` | 已读 | Issue 正文（解析语义 6 条 + AC1–AC4）；Comments 空（REST 空响应，与 dispatch 一致）——无 owner 要求需并入 |
| 批准设计 `wiki/raw/task_issue-272_design.md`（迭代 1，SA2 approve） | 已读 | §7 D1–D9、§8.1–§8.7、§11 ALLOW/DENY、§12 验证映射逐节对照实现 |
| SA2 设计评审 `wiki/raw/task_issue-272_sa2_review.md`（approve） | 已读 | SA2-F1 验收三条件 + N1–N10 观察逐条核对实现落点 |
| SA3 实现报告 `wiki/raw/task_issue-272_sa3_impl.md` | 已读 | Changed paths 五项与 git diff 逐一对账；§偏差说明（七项在场守卫）独立复核 |
| SA6 契约 `wiki/raw/task_issue-272_sa6_contract.md`（approve） | 已读 | 并逐行核读契约四文件本体（红 34 / 负控 11 / test-d 3 实数清点成立：`it(` 计数 34+11+4+3） |
| SA8 冲突报告 `task_issue-272_conflict_report.md`（clear）/ 复审 `task_issue-272_conflict_recheck.md`（clear） | 已读 | 红线 1–5 落点核对 |
| `task_issue-272_relevant_decisions.md` | 不存在 | SA8 冲突报告已含 ADR 全集（14 文件）盘点；上游各产物一致声明以此替代——可继续 |
| 实现源码（新模块 464 行全文 + 复用面 drillStep/structureLens/pattern/resolve/evaluate/derived/index/AGENTS） | 已读 | `packages/vfsl/src/resolve-schema-at-path.ts` 全文；validate-patch.ts L55–214；pattern.ts 错误四类与 compile/match 签名；resolve.ts walkRefChain/InternalError；evaluate.ts walkDocs L356–401 键文法；derived.ts ValueSchema/DerivedSchema 冻结形状 |
| Git diff（a6b2a79..de5633c）与 status | 已做 | 16 文件 +2695/−6；工作树干净；无 /tmp 残留、无 marker |
| 全仓符号 grep | 已做 | `resolveSchemaAtPath`/`ReadDataSchemaProjection`/`SCHEMA_PATH_*` 在 vfsl 之外零命中（无既有 caller、无越界引用）；`drillStep`/`structureLens` 未泄漏出包 |
| CI/runner 入口 | 已核 | vitest.config.ts include/typecheck include；包 tsconfig `test/**`；根 `pnpm test`=`vitest run --typecheck`；`.github/workflows/ci.yml` + `scripts/ci-test-shard.mjs`（磁盘枚举、未收录文件按均值兜底、绝无静默漏跑——新测试文件必被发现） |

## 2. Verdict

**approve** —— 实现忠实落实批准设计（迭代 1）与 SA6 契约：结构侧逐字复用 `drillStep`（diff 仅 `export` 关键字 + 注释，零行为改动）；值侧镜像游走/终点合成/闭包/切片与 §8.3–§8.6 逐条对位；D7 引擎四类错误单点分类器（fail-closed NOT_FOUND、意外异常包装 InternalError、成功产物每调用局部缓存）与 D8 形状/内容分类逐锚定例手推全中；红线 1 无顶层 catch、红线 3 零 `discriminator` 读（grep 实证）；文件范围严格在 ALLOW 内、DENY 零触碰；SA6 契约四文件未被动过（SA2 迭代 1 评审的行号锚 L70–86/L174–177/L303–316/L373–396 全部精确命中）；新增 pattern-errors 锚定满足 SA2-F1 验收三条件。发现 0 BLOCKER / 0 MAJOR；3 枚 MINOR 观察（O1 通道纯度声明超出实际守卫覆盖、O2 aliasDocs 空条目过滤偏离设计字面但属显式解锁自由度、O3 SA3 报告一处计数表述）不阻断。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| AC1 经包 index 导出 + 失败 path 新鲜副本 | index.ts 导出块（值导出 + 2 类型导出，带红线 1/2 JSDoc）；实现三处失败分支均 `[...path]`/`[]` 新建（L95/L99/L138/L158） | 落实；红契约 9 断言锚定（L253–269 改原数组不穿透、两次不共享） |
| AC2-1 union any-member 扩展 + 合成 union 无判别式 | 值侧 union 全成员展开（L279–284，成员 i 0 基语法路径）；终点多候选 `{kind:'union', members}` 恰两键（L170–172）；全模块零 `discriminator` 读（grep 实证，仅注释提及） | 落实；剥光断言（L303–316）+ `Object.keys(node)===['kind','members']`（L289） |
| AC2-2 keyPattern fail-closed | `acceptRecordSlot`：失配与引擎四类错误同标记 `keyPatternRejected` → NOT_FOUND（L322–334）；单层 try/catch + `instanceof` 四类精确识别（L338–345） | 落实；红契约 L202–206/L330–337 + pattern-errors 新增锚 |
| AC2-3 optional 透明展开/返回保留 | 规范化循环解包 optional、语法路径不变（L228–231）；出候选收**原始**字段值（optional/ref 包装保留，L258/L327） | 落实；红契约 5 断言（L341–370） |
| AC2-4 ref 缺失 InternalError 不进联合 | 值游走 own 守卫查表缺失 throw（L235，文案 `值树未声明别名: …` 与 valueLens L81 逐字节一致）；闭包缺失 throw（L403）；无顶层 catch（全文唯一 try/catch 在 acceptRecordSlot 单层局部） | 落实；红契约两态（L374–396）；pattern-errors 第 4 测锚定与引擎错误通道共存不互吞 |
| AC3 docs/aliasDocs 键同构 + 闭包传递不发散 | `sliceDocs` 三类键选键（脊柱 Set ∪ 终点子树前缀 ∪ 闭包别名前缀）+ field→marker 合并序 + 空条目过滤（L427–463）；闭包名集去重 + 节点身份防环（L377–416）；语法路径生成与 evaluate.ts walkDocs 文法逐字对齐（本次逐行比对：字段 `.${name}`、`<member ${i}>` 0 基、`<item>`、`<key>`、ref 锚名切换、ref 终态不穿越） | 落实；红契约 6 断言 + 递归别名单名闭包 JSON 往返（L487–498） |
| AC4 包测试/typecheck 绿 + 根仓零回归 | SA3 报告：vfsl 32 文件 600 测试 + tsc exit 0 + 根 typecheck/test 绿 | 静态一致性成立（32 文件 = 31 `.test.ts` + 1 test-d 实数清点吻合；38 = 红 34 + Pattern 4 吻合；600 与设计预测 594+4+类型面 存在 ±1 计数口径差，见 §11 动态项）；运行结果本审查未复跑（SA4 纪律），归 SA7 |
| Issue comments（空） | 无 owner 评论 | 无遗漏；实现未擅自引入简报外语义 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1 双游标：结构侧复用 `drillStep` 本体 | L125/L136（模块级导入调用）；validate-patch.ts 仅加 `export` 关键字 + 复用注释（diff 实证零行为改动） | 忠实；同构单源成立（红线 3） | — |
| D1 值侧镜像游走（游标/语法路径/keyPattern/出候选） | `matchValueCandidate`（optional 解包 + ref 逐跳 + in-flight 单次规范化作用域 + 锚名切换，L223–244）+ `matchValueNode`（map 精确字段→`<key>` 槽 / array 非负整数 / union 全成员，L248–289） | 忠实；`visited`/`seen` 每段作用域镜像 drillStep 每步 Set 语义；union 成员为 ref 时锚名切换与 walkDocs「ref 终态不穿越」一致（本次专门推演：无脊柱键漂移） | — |
| D2 切片三类别 + 合并序 + 空过滤 | `sliceDocs` L427–463 | 忠实（键序 = fieldDocs 声明序后 markerDocs 去重并入，逐调用确定）；aliasDocs 空条目过滤见 O2 | O2 |
| D3 ROOT 别名级注释不入 | `sliceDocs` 仅闭包别名取 aliasDocs（L458–462） | 忠实 | — |
| D4 候选发现序 / 身份去重 | `emitValue` 有序列表 + `Set` 身份去重、脊柱键全量收集（L208–214） | 忠实 | — |
| D5 引用返回 + 容器/切片/失败 path 新鲜 | 单候选原样引用（L171）；合成节点/五键容器/docs/aliasDocs/`[...path]` 逐调用新建；JSDoc 双落点（模块 L70–88 + index 导出块）均写明共享节点与深拷贝归属 | 忠实 | — |
| D6 真实节点原样（含判别式）/合成恒两键 | L170–172 + 闭包原样引用（L406） | 忠实；零判别式读（grep 实证） | — |
| D7(a) 两树分歧 throw（keyPattern 拒绝标记在场除外） | L155–164：out 空 && !keyPatternRejected → `InternalError('两树形状分歧: …')` | 忠实；触发面与设计文字一致 | — |
| D7(b) 引擎四类错误 fail-closed NOT_FOUND、意外异常包装 InternalError、成功产物每调用缓存 | `acceptRecordSlot` L298–335：单层 try/catch 包 compile+match；四类 instanceof（镜像 emitPatternError 分支形状）；缓存仅成功产物（L312）；`match(compiled, seg, () => {})` no-op charge 与 index.ts matchPattern 先例同款 | 忠实；SA2-F1 验收三条件全部满足（每类显式处置 + 可达性前提测试 + JSDoc 清单一致） | — |
| D8 形状级/内容级分类（不镜像 KIND_ORDER） | `classifyStructureReject` L359–369：INVALID ⟺ 无「map+string」可行 && 无「array+非负整数」可行 && 无终态形态；分类只在结构侧 out 空分支、先于且独立于 keyPattern | 忠实；§8.6 全部 9+2 锚定例手推逐条命中（含 `[0]`/`['keywords','0']`/`['keywords',-1]`→INVALID，`['nope']`/`['u','z']`/`['notes','x']`/`['attachments',0]`/`['assets','bad key!']`→NOT_FOUND，pattern-errors 夹具 `['r','k']`→NOT_FOUND、`['r',7]`→INVALID） | — |
| D9 模块落位 + 包内导出纪律 | 新文件 `resolve-schema-at-path.ts`；drillStep/DrillResult/structureLens 模块级导出不进 index；值侧 ref 解析未新造 while 链算法（规范化循环逐跳 + in-flight，expand 先例；walkRefChain 仍全仓恰一份） | 忠实 | — |
| §8.2 入口规整（path 先于 derived） | L94–101 先 path 形状守卫；derived 守卫扩展为七项在场检查（SA3 已申报的守卫完备化） | 落实 + 有据加严（见 §8 与 O1）；对全部契约/设计锚定输入零行为差异 | — |
| §8.6 对照表逐行 | 手工推演全部行（含 `[]` docs 五键 + Audit.createdBy、`['audit','createdBy']` 双键、`['u','x']` 合成 union 空切片、`['assets']` 规则推出 {Audit.createdBy}、双删表两态 throw） | 全等 | — |

设计明确但实现缺失：无。实现必要偏离设计：仅 §8.2 守卫完备化（已申报）与 aliasDocs 空过滤（O2，显式解锁自由度内）。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 路径合法性判定（⟺ 命题写侧半张脸） | validate-patch `drillStep` | 复用本体（模块级导出） | 正确（零分叉） |
| 值语义投影产出 | vfsl 新模块（ADR-0016 指派） | `resolve-schema-at-path.ts` | 正确 |
| keyPattern 判定与错误分类 | pattern.ts 引擎 + validate.ts 分类先例 | compile/match 复用 + instanceof 四类镜像 emitPatternError 分支形状 | 正确（读侧通道按 ADR-0016 差异化：值级 issue → 内容级失败码，语义同源） |
| 深拷贝边界 | namespace-runtime 组合票 | vfsl 返回引用 + JSDoc 双落点声明 | 正确（follow-up #1 义务未在本票承接、未裁撤） |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 结构侧逐段下钻 | drillStep | 复用本体 | 一致 | 单源 |
| 值域 ref 链解析 | walkRefChain + 透镜族（「while 算法恰一份」纪律） | 候选规范化内逐跳 + in-flight（expand 先例） | 一致 | 无平行算法 |
| 引擎错误分类 | validate.ts emitPatternError（四类 → 值级；意外 → throw） | 同形状单层 try/catch（四类 → 内容级拒绝；意外 → 包装 InternalError） | 一致（通道翻译） | 无顶层 catch 约束下的忠实翻译，通道纯度保持 |
| 正则编译缓存 | validate.ts compileOrCache（ctx 局部、失败不缓存） | 每调用局部 Map、成功产物（L308–312） | 一致 | 非跨调用 memo |
| no-op charge | index.ts matchPattern `() => {}` | 同款（L322） | 一致 | 先例在案 |
| 失败 path 回显 | validate-patch `[...path]` | `[...path]`/`[]` 全量新鲜副本 | 一致（加法严格化） | — |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 路径合法性 | drillStep 单一实现 | 读侧零复制判定 | 无 |
| 值语义/别名/文档 | derived.values/aliases/三表（冻结形状） | 投影为切片/引用，键不发明、内容逐字 | 无（表扫描以表为源） |
| 语法路径文法 | evaluate.ts walkDocs | 脊柱键生成逐字镜像（本次逐行比对四类合成段 + ref 锚名切换规则） | 低（文本镜像——设计 R1 自登；契约 ⊆ 不变量 + 键集断言兜底，且实现注释明示文法出处） |
| 引擎错误身份/预算 | pattern.ts 四类 + matchBudget | instanceof 精确识别 | 无 |

无第二事实源、无镜像状态、无 marker、无标签反推。

### 生命周期对称性

纯函数、零资源分配（regexCache 为调用局部 Map）：无 register/dispose、无订阅、无后台任务——对称性平凡满足；失败即返回或 throw，无部分状态逃逸。评估：通过。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二套 ref 解析 while 链 | walkRefChain | 候选内逐跳规范化 | 非平行 |
| 第二套 docs 键空间生成 | walkDocs | 表扫描 + 前缀匹配 | 非平行 |
| 第二套引擎错误分类语义 | emitPatternError | 同形状 instanceof | 非平行（通道按 ADR 差异化有据） |
| 跨调用缓存 | getCompiled 域 | 无（每调用局部） | 非平行 |

## 6. 文件范围审查

只读 Git 命令核对（`git diff a6b2a79..de5633c --stat` + `git status`），未 checkout/revert/修改任何范围声明。

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts`（新建 464 行） | ALLOW 行 1 | 全部算法唯一载体 | 符合 |
| `packages/vfsl/src/index.ts`（+11） | ALLOW 行 2 | 导出块 + JSDoc | 符合（既有导出逐字节不变——diff 仅追加块） |
| `packages/vfsl/src/validate-patch.ts`（+16/−6） | ALLOW 行 3 | 三处 `export` 关键字 + 包内复用注释 | 符合（diff 逐行核验：仅 `structureLens`/`DrillResult`/`drillStep` 加 export 与注释，零行为改动） |
| `packages/vfsl/AGENTS.md`（+3/−1） | ALLOW 行 4 | normative 补 ADR-0016 + Boundaries 例外句 | 符合（例外句含引擎四类错误 fail-closed 对偶句——红线 5；N8 措辞建议未完全采纳但现文未把引擎错误归为 ADR 明文，可接受） |
| `packages/vfsl/test/resolve-schema-at-path-pattern-errors.test.ts`（新建 119 行） | ALLOW 行 5 | SA2-F1 验收锚 | 符合 |
| `wiki/raw/task_issue-272*.md`（7 文件） | （流程工件） | MABF 各阶段交付物随实现提交 | 与仓库惯例一致（wiki/raw 数百枚同款工件；历史任务提交同模式，如 d7098ed）；非生产代码，非范围越界 |
| DENY 面（契约四文件、derived.ts、resolve.ts、evaluate/validate/pattern/parser/semantic、其余 packages、docs/adr、根配置） | — | — | 零触碰（diff 实证）；契约四文件经 SA2 迭代 1 行号锚（L70–86/L174–177/L303–316/L373–396）+ 断言计数（34/11/3）双重核对未被 SA3 修改 |

ALLOW 中未修改路径：无（六项全部落实）。无超 ALLOW/DENY 违规。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| 新公共导出（1 值 + 2 类型） | 无既有调用方（全仓 grep：vfsl 外零命中） | 纯加法 | 无 | — |
| vfsl index 既有消费者（doc-runtime 等） | 经包入口导入 | 既有导出逐字节不变 | 无 | — |
| `drillStep`/`structureLens` 模块级导出 | 包内新模块唯一消费者（grep：未出包、未进 index） | 沿 resolve.ts→validate-patch 包内消费先例；validatePatch 等既有函数零行为改动 | 无 | — |
| 未来 namespace-runtime readData 组合 | 组合票 | 两码吸收面完整：合法派生物上唯一 throw 源是可信域畸形（JSDoc 已划界）；引擎错误已并入 NOT_FOUND，无未申报异常通道 | 无（SA2 §9 担忧已随 D7 落实消除） | — |
| test-d 类型面 | vitest typecheck（根 `pnpm test` --typecheck + CI typecheck 作业 `--typecheck.only`） | 签名/判别联合/投影名目三断言与实现类型逐项相容（`parameter(1).toEqualTypeOf<readonly (string\|number)[]>` 与 L91 签名一致；ok 分支无 code；失败 path `Array`） | 无 | — |

无遗漏 caller、无未处理新错误语义。

## 8. 错误、恢复与并发

- **通道三分互斥全覆盖**（实测代码路径）：①敌意 path + 内容级拒绝 → 两码联合（path 新鲜副本）；②可信域畸形 + 引擎意外异常 → `InternalError` throw（全文无顶层 catch——唯一 try/catch 为 acceptRecordSlot 单层局部，四类之内内容级、之外包装 InternalError）；③ok 投影。无静默 fallback：引擎不可判定按「缺失接纳证明 = 拒绝」fail-closed，不冒充失配、不升级崩溃（D7 逐字落实）。
- **两树分歧触发面**：结构放行 + 值零候选 + 无 keyPattern 拒绝标记 → InternalError。对合法派生物不可达（唯一系统性分歧 YPlainArray/Record 值位物化均被双游标吸收——`['attachments']` 整位 ok / `['attachments',0]` 结构侧先拒，本次手推验证）；该分支无测试锚（契约/设计均未要求锚定手造分歧——SA6 §15-Q7 留白、设计 §12 未列），见 §11 动态项 3。
- **纯度/确定性/幂等**：零模块状态（grep 实证）；全部调用局部（spine/regexCache/ctx 每段/每次调用新建）；同输入同输出；失败可重试无部分状态。
- **递归/成本**：值侧每段规范化 + matchValueNode 递归受值树深度（≤ MAX_TYPE_NESTING=100）约束；闭包名集 + 节点身份双去重终止；敌意段最坏成本受引擎步数预算封顶（单次 match ≤ 4M ticks + 编译 ≤ 10_000 指令；跨段×候选为乘积界——SA2-N10 已按非阻断记录，实现无放大）。
- **守卫完备化（SA3 申报偏差）复核**：七项在场检查把本函数消费面全部收为 InternalError，方向与设计 §8.2 一致（更保守）；但**值为 null/非对象的表键**（如 `{structure:null,…}`、`{values:null,…}`、fieldDocs 值非数组）仍会泄漏裸 TypeError（`derived.structure.kind` / `Object.hasOwn(null,…)` / 展开非可迭代）——设计原文 §8.2 步 3 同样存在该缝隙，实现不劣于设计，仅 SA3 报告与模块注释「不泄漏裸 TypeError / 本函数 throw 的只有 InternalError」的**声明覆盖面大于实际守卫覆盖面**。可信域入参 + 诊断质量级 → O1（MINOR）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `resolve-schema-at-path.test.ts`（34 it，SA6 红→绿契约） | 接缝/五键/确定性/JSON 往返；两码 9 例 toEqual 全等 + path 新鲜副本三重断言；union 合成两键 + 多集比较 + 剥光判别式 5 路径；Record 终点原样/失配/number 段隔离；optional 5 例；ref 缺失两态 `.toThrow(InternalError)` + 实例 name；docs/aliasDocs 键集逐字 + 跨读集 ⊆ 不变量 + 递归别名不发散 | 根 vitest include `packages/*/test/**/*.test.ts`；CI 分片器磁盘枚举自动发现 | 无 skip/only/todo（grep 实证）；无源码文本断言；全部行为锚定 | — |
| `resolve-schema-at-path-control.test.ts`（11 it，负控） | C1 夹具求值基线；C2 期望字面量与真实求值器逐字对账（含 ALL_NONEMPTY_DOCS/ALIAS_DOCS、markerDocs 全空、ROOT 无注释）；C3 写侧对偶矩阵 7+4+3+越界澄清+Pattern 值级 | 同上 | 无；不 import 目标接缝（前提性验证） | — |
| `resolve-schema-at-path.test-d.ts`（3 it，类型面） | 签名精确匹配、判别联合两码、投影四件套、ok 无 code（@ts-expect-error） | `vitest run --typecheck`（根 test）+ CI typecheck 作业 `--typecheck.only --passWithNoTests=false` + 包 tsc | 无 | — |
| `resolve-schema-at-path-pattern-errors.test.ts`（4 it，SA3 新增） | 三枚确定性引擎错误夹具（`[` 编译失败 / `\1` 子集外 / `a{20000}` 超限）各含 parse+evaluate ok 前置 + 值树 keyPattern 携带断言；`['r','k']`→NOT_FOUND（不 throw）、`['r',7]`→INVALID（形状隔离）；第 4 测红线 1 共存（同派生物 good 槽终点 ref 缺失仍 throw） | 同红契约（include 命中；CI 分片兜底权重） | 无 skip/only；断言全行为化（toEqual 全等失败分支）；BudgetExceeded 确定性探针未加——设计 §12 标注「可选」，非缺口 | — |

SA6 红灯断言保持性：契约四文件未被实现修改（行号锚 + 计数双重核对，见 §6）；负控 11 前提断言原样在仓。测试敏感性：红→绿翻转由真实接缝（动态 import index）驱动，期望字面量经真实求值器对账（C2）——非弱化断言。发现入口全部真实（vitest include / typecheck include / 包 tsconfig `test/**` / CI 分片磁盘枚举）。

## 10. Required revisions

**无 BLOCKER / MAJOR / MINOR 级阻断项。**

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| SA3 报告的验证门结果（vfsl 32 文件/600 测试、包 tsc、根 typecheck/test 全绿） | SA7 活链路终验复跑同命令 | 32 files / 600 tests passed / no type errors；根两门 exit 0 | 任一文件/断言失败或 skip |
| 计数口径 ±1：设计 §12 预测 594 运行时 + Pattern 4 + 类型面 3 = 601，SA3 报 600 | SA7 复跑输出核对 vitest 对 test-d 的计数方式 | 600 或 601 皆可接受，但需确认无隐藏 skip/排除 | 实际 < 598 或存在 skip |
| 两树分歧 InternalError 分支（D7a）零测试锚（契约/设计均未要求；手造派生物才可达） | SA7 如有余量可加探针（可选） | 手造「结构放行、值树零候选、无 keyPattern」派生物 → throw InternalError 而非联合失败/裸 TypeError | 降级为失败码或裸 TypeError |
| `PatternBudgetExceeded` 运行期通道（无确定性夹具，设计申报可选探针） | SA7 可选：近限可编译 Pattern × 超长敌意段 | 不 throw InternalError（内容级拒绝或失配同形） | throw InternalError |

## 12. Non-blocking observations

| ID | Observation |
|---|---|
| O1 | **通道纯度声明覆盖面 > 守卫覆盖面**（MINOR，措辞级）：模块注释 L104–105 与 SA3 报告 §实现要点 6 宣称「手造垃圾派生物不向调用方泄漏裸 TypeError / 本函数 throw 的只有 InternalError」；七项在场守卫只查键在场，不查值非 null/形状——`{structure:null,…}` 在 L118 `derived.structure.kind` 处、`{values:null,…}` 在 L121 `Object.hasOwn(null,…)` 处、fieldDocs 值非数组在 L450 展开处仍会泄漏裸 TypeError。设计原文 §8.2 步 3 同构缝隙（实现不劣于设计），可信域入参、无正确性/安全影响、红线 1（ref 缺失通道）不受影响。建议后续措辞收敛（JSDoc/注释改为「键缺席守卫」）或守卫补值非 null 检查——纯加法、不属本票验收面 |
| O2 | **aliasDocs 空条目过滤偏离设计字面**（显式解锁自由度内）：设计 §8.6/D2 对 docs 合并明文空条目过滤、对 aliasDocs 仅写「存在则浅拷贝」；实现 L461 对 aliasDocs 也过滤空条目（`arr.length > 0`）。SA6 §12 显式「docs 空条目保留不锁（设计自由度）」、契约全部经 `nonEmpty()` 断言——两种行为均绿。方向与 D2 噪声治理理据一致（`[]` 读的 U 闭包别名无注释时不产生 `{U:[]}` 空行）。无需改动；记录为实现钉定 |
| O3 | SA3 报告 Verification 表「红 34 + 新增 Pattern 锚 4」准确（38 = 34+4 实数清点吻合），但「2 files passed / 38 tests」与「32 files / 600 tests」中 test-d 的计数口径未说明（600 vs 设计预测 601 的 ±1）——SA7 复跑时顺带核对即可（见 §11 行 2） |
| O4 | AGENTS.md 例外句把 keyPattern 引擎四类错误与 ADR-0016 并列表述（"Explicit exception (ADR 0016): …"）：引擎错误 fail-closed 属「ADR 未规定、设计 D7 钉死」（SA2-N8 曾建议措辞精度）。现文未直接声称 ADR 明文规定引擎错误通道（ADR-0016 前缀覆盖的是 resolveSchemaAtPath 可信域例外整体），可接受；若后续者据此误读为 ADR 明文，按设计 §7-D7 修订史澄清即可 |
| O5 | SA2-N6 实现纪律（in-flight 环检测作用域 = 单次候选规范化）已正确落实（`matchValueCandidate` 每次调用新建 inFlight，L224；union 成员递归各自作用域）——合法递归别名深路径逐段解析不误报环，本次手推确认 |

---

## 审查结论重述

- **Verdict：approve**。实现与批准设计（迭代 1）、SA6 契约、SA8 五条红线、SA2-F1 修订要求逐条对位成立：同构单源（drillStep 复用、零判别式读）、D7 引擎错误通道正确、D8 分类逐锚定例命中、文件范围零违规、契约零篡改、测试真实触发且行为锚定。0 BLOCKER / 0 MAJOR；MINOR 观察 O1–O5 不阻断。
- `requiresConflictRecheck`：**false**——实现未引入设计之外的语义面（守卫完备化为更保守加严、aliasDocs 空过滤在显式解锁自由度内），无新 ADR 冲突风险。
- `approve` 不替代 SA7 活链路终验（§11 动态项归 SA7/Controller 路由）。

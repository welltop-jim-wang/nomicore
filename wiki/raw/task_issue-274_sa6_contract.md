# SA6 诊断与验收契约 — Issue #274 文档同步：typed-access 与 docs/integration 覆盖 readData 语义 schema 投影（ADR 0016）

- Worktree：`/home/wangjian/nomicore-fix-issue-274`（branch `mabf/issue-274`，HEAD `6ab8c87` = #273 合并提交 fix #273 PR #278）
- Phase：acceptance-contract（iteration 0，dispatch `wiki/raw/task_274_dispatch.md`）
- 任务类型：**feature（文档能力缺口契约）**——仓库**行为与规范面已就位**（#273/#272 已合入 HEAD、ADR-0016/ADR-0008 修订节/CONTEXT 词条已落仓），缺口是**面向集成方与 agent 消费者的文档同步**：typed-access skill 与 docs/integration 未覆盖 readData 语义 schema 投影，且 cordis-plugin-hosting 示例含与 ADR-0016 矛盾的过时形状注记。非 Bug，不虚构根因。
- 裁决：**approve**（缺口证实、契约可执行、测试入口真实、7/7 红灯原因正确、21/21 负控绿、类型面全绿）

## 1. Task type and inputs

| 输入 | 位置 | 说明 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-274.md`（untracked 输入） | Issue #274 正文快照：What to build 六要点（成功读 `schema` 字段形态=四键投影体 / docs 切片与派生 schema 文档三表同构的键规约 / 「`schema` 为 `null` 不是读的失败」判读 / 读后修改场景凭投影构造合法 mutation / 范围 = typed-access 指引 + docs/integration 消费 readData 文档 / 现有示例加法兼容）；AC1–AC3；Blocked by #273（已合入 HEAD，解除） |
| dispatch | `wiki/raw/task_274_dispatch.md` | SA6 acceptance-contract（iteration 0）派发；Issue comments REST = `[]`，无 owner 要求 |
| 母法（规范面，均已接受） | `docs/adr/0016-readdata-semantic-schema-projection.md`（98 行）+ `docs/adr/0008` ADR 0016 修订节 L167–177 + `CONTEXT.md` 「Data」L34 /「语义 schema 投影」L36–40 词条 | 结果形状 `{ok:true,value,schema}`；`schema` 为 `null` 三情形单义（无 active schema / 路径偏离 / 静态解析失败），null 不是读的失败；投影体四键 valueSchema/aliases/docs/aliasDocs；docs/aliasDocs 键规约与 DerivedSchema 文档三表同构（§3 绝对语法路径 + `<item>`/`<key>`/`<member N>` 合成段文法、别名以别名名锚定）；交付纪律 always-on、每次读 detached 深拷贝 |
| 行为依赖面（已合入 HEAD） | `packages/namespace-runtime` readData 组合（#273，PR #278）+ `packages/vfsl` `resolveSchemaAtPath`/`ReadDataSchemaProjection`（#272，PR #277） | 成功分支恰三键；HEAD 上其契约测试全绿（本会话复跑 §4） |
| 作用域文档（本票文档变更对象，SA6 零改动） | `.agents/skills/nomicore/typed-access.md`（153 行，英文正文）；`docs/integration/cordis-plugin-hosting.md`；`docs/integration/external-project-vfsl-codegen.md` | 全仓 grep `readData(`：docs/integration 消费面恰三处（cordis L340/L360、external L253/L349） |

环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7；根 `pnpm install --frozen-lockfile` 完成（无 approve-builds 拦截脚本）。

## 2. Owner comment mapping

Issue comments 经 REST 当前读取为空（dispatch 记录 `[]`；本次会话无新 REST 读——dispatch/简报快照即当前事实），无 comment ID / updated_at / owner 要求需并入。执行标准唯一来源 = 简报 AC1–AC3 + What to build 六要点 + ADR-0016 规范面。

## 3. SA8 constraints（并入契约的方式）

固定位置无 task_issue-274 专属 SA8 报告（dispatch 前无 SA8 产物落仓）；约束从上游契约链与仓库纪律提取并逐条并入：

1. **行为已冻结（#273 SA6/SA8 链）**：成功分支恰三键 `{ok:true,value,schema}`、null 单义、always-on、每次读深拷贝——本票只做**文档同步**，文档陈述不得与 ADR-0016/CONTEXT 矛盾（docs/AGENTS.md「code behavior 变更须同步规范文档；documentation-only 改动不得发明行为」）。→ R7 示例注记同步 + 全作用域无矛盾扫描。
2. **现有示例加法兼容**（简报 What to build）：external-project-vfsl-codegen §5 适配器/§6 反例只消费 `.ok`/`.value`——不强制改写 → 负控扫描锁定「无两键全等形状注记」即可（加法兼容例子允许保留）。
3. **docs/AGENTS.md 验证面**：链接与引用文件名可查、无陈旧术语/矛盾决策、`git diff --check`；「可执行契约变更时才跑代码检查」→ 本票契约即可执行文档内容检查（vitest），终态仍须 `pnpm typecheck` + `pnpm test` 绿（AC3）。
4. **词汇纪律**：仓库规范词形为「语义 schema 投影」「`schema` 为 `null` 不是读的失败」（ADR-0016 L22/L30–39、CONTEXT L36–40、runtime.ts readData JSDoc 同款）——契约匹配器以规范词形为锚，防陈旧术语回潮。
5. **无 opt-in 发明**（ADR-0016 always-on、备选否决 L81）→ 作用域文档不得出现 `readData(path, {…})` 带参读面（负控）。
6. **typed-access 核心内容不可被同步重写吞掉**（生成/接线/负向类型夹具/mutation 最小化纪律仍须在场）→ 内容保持负控。

## 4. Environment and baseline

- HEAD `6ab8c87`（#273 合并提交 = 行为面就位）；`git status` = 6 个 untracked（简报、dispatch 2 枚既有输入 + 本报告与 3 个契约文件 4 枚产物），**生产实现与既有文档零改动**。
- 本会话基线复跑（全部绿）：
  - `pnpm typecheck`（全仓 16 个 package/app tsconfig 顺序 tsc）→ **exit 0，零错误**。
  - `vitest run packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts …-control.test.ts` → **21/21 绿**（#273 行为契约在 HEAD 全绿——成功分支确实返回四键 schema 投影；这是 R7「文档注记过时」的行为侧前提）。
  - `vitest run registry-open.test.ts registry-create.test.ts` → **79/79 绿**；全 registry 测试目录 → **405 passed / 唯一失败 = 本票红契约文件 R1–R7**（§13）——registry 行为面未受任何影响。
- 作用域文档现状（缺口预扫描，全部实测）：`typed-access.md` 含 `投影` 0 次、ADR-0016 引用 0 次、valueSchema/aliasDocs 0 次、null 0 次；`cordis-plugin-hosting.md` L341 含唯一过时形状注记 `// { ok: true, value: 'first' }`；`external-project-vfsl-codegen.md` 的 4 处「投影」全部是生成类型投影语义（与 readData 结果无关，见 §11 排除项）。

## 5. Positive reproduction — 能力缺口（feature 证明）

**缺口声明**：行为与规范面（#273/#272/ADR-0016/CONTEXT/ADR-0008 修订节）已合入，但面向集成方与 agent 消费者的文档未同步：
(a) typed-access 指引对成功读的 `schema` 字段形态、null 判读、典型消费方式**零覆盖**（AC1 未满足）；
(b) docs/integration 的 readData 示例注记与运行时真实形状**矛盾**（AC2 未满足）。

最小输入 → 可观测断言矩阵（HEAD 实测，probe/行为锚 + 内容扫描）：

| 缺口面 | 输入（文档现状） | 可观测断言 | HEAD 观察 |
|---|---|---|---|
| AC1-① 形态/权威挂接 | typed-access.md 全文 | 引用 ADR-0016 或 0016-readdata 锚点 | 0 命中 → 缺口 |
| AC1-② 成功读形状 | typed-access.md 全文 | 「readData …（语义）schema 投影」同段共现 | 无任何 schema/readData/投影关联段 → 缺口 |
| AC1-③ 四键投影体 | typed-access.md 全文 | valueSchema 与 aliasDocs 具名 | 0 命中 → 缺口 |
| AC1-④ docs 键规约 | typed-access.md 全文 | aliasDocs + 键规约同构锚词 | 0 命中 → 缺口 |
| AC1-⑤ null 判读 | typed-access.md 全文 | null + 「不是读的失败」 | 0 命中（全文无 null）→ 缺口 |
| AC1-⑥ 消费/读后 mutation | typed-access.md 全文 | 「schema 投影」词形 + mutation 关联 | 无 → 缺口 |
| AC2 示例矛盾 | cordis-plugin-hosting.md L340–341 | 形状注记须含 schema（或删除） | L341 两键全等注记 → **与真实输出矛盾** |
| 行为事实（矛盾的行为侧证据） | registry.create 示例原样装配 → `lease.readData(['title'])` | 键集恰 {ok,schema,value}；schema 非 null 且四键 | **实测命中**（行为锚 21/21 控制之一） |

## 6. Negative control

负控/基线文件 `readdata-docs-adr0016-sync-control.test.ts`（HEAD **21/21 绿**，目标同步后应保持绿——实现越界即红）：
1. **行为锚**（1 条）：按 cordis-plugin-hosting「创建、读取、修改和重新打开」示例原样装配真实 Registry（Cordis Context + stub persistence + registry plugin，schema `type ROOT = { title: string; count: number };`、root `{title:'first',count:0}`），实测 `readData(['title'])`：ok=true、value='first'、`Object.keys` 排序恰 `['ok','schema','value']`、`schema` 非 null 且 own keys 恰 `['aliasDocs','aliases','docs','valueSchema']`；`['count']` 同形（value=0）。**该事实即 R7 红灯的行为侧因果证据**——文档注记 `// { ok: true, value: 'first' }` 与真实输出矛盾，红灯不是扫描器空转。
2. **匹配器敏感性单元验证**（15 条）：每个内容锚正样本（中/英文规范词形，绿）+ 负样本（缺锚词/语义反向/同段落无关关键词，红）。负样本含**现状段落回归样本**（typed-access.md 第 4–8 步编号清单段含 generated projection + `schema.vfsl` + `readData()` 但无「schema 投影」词形 → 必须拒绝——这正是初版 matcher 伪绿处，见 §9 实验 3）。
3. **内容负控扫描**（4 条）：external-project-vfsl-codegen.md 与 typed-access.md 无两键全等形状注记（现 0，同步后须保持 0）；作用域三文档无 `readData(path, …)` 带参（opt-in）用法（ADR-0016 always-on）；typed-access 核心内容保持（VfslPathMap / `--check` 不被重写吞掉）；权威源健全性（ADR-0016 在场且含 `schema: ReadDataSchemaProjection | null` 与「不是读的失败」——匹配器词汇的来源锚）。
4. **段落切分冒烟**：ADR-0016 按空行分段 >10 段（matcher 输入健壮性）。

## 7. Stability, scale and timing

- 红灯全确定性：红契约 **3 次连续运行 7/7 红**（原因一致：6 条 typed-access 内容缺口 + 1 条 L341 过时注记）；负控 21/21 绿；无竞态、无时钟依赖、无超时（全文 ~百 ms 级；行为锚为真实装配的微任务链，进程内完成）。
- 行为锚稳定性：registry.open/create 基线 79/79、runtime readData 契约 21/21 复跑全绿——装配与断言非 flake。
- 规模/性能非本 feature 关注（文档内容检查 O(文件行数)）。

## 8. Capability gap（feature 的缺口链，替代 Bug 根因链）

| Step | 事实 | 证据 | Confidence |
|---|---|---|---|
| ① 规范面（ADR-0016 + ADR-0008 修订节 + CONTEXT 词条）已接受且与行为一致 | 结果形状/投影体/null 三情形/深拷贝交付纪律逐条成文；D8 封口修订 | `docs/adr/0016…` L14–77；`docs/adr/0008` L167–177；`CONTEXT.md` L34/L36–40 | high |
| ② 行为面（#273/#272）已合入且测试全绿 | readData ready 成功分支 = 恰三键；resolver 公共导出；运行时契约 21/21 绿 | HEAD `6ab8c87`/`1acd9e9`；本会话复跑（§4/§6 行为锚） | high |
| ③ 消费文档（typed-access skill + docs/integration）未覆盖新结果面 | typed-access.md 零投影/ADR-0016/null 词汇；integration 文档 readData 消费面三处中仅 cordis 有形状注记且为两键全等 | grep 预扫描（§5）；作用域文档逐字亲读 | high |
| ④ 缺口（a）：AC1 六要点全部无文档陈述 | 内容锚 R1–R6 逐条 0 命中 → 红灯 | 红契约 7/7（§13） | high |
| ⑤ 缺口（b）：cordis 示例注记与真实输出矛盾（AC2） | L341 注记 `{ ok: true, value: 'first' }` vs 行为锚实测键集 {ok,schema,value} + schema 四键非 null | R7 红灯 + 行为锚（§5/§6/§13） | high |
| ⑥ 收敛点 = 文档同步本身（无生产/规范改动义务） | 规范/行为两面的所有陈述已冻结；文档只陈述不得矛盾、示例加法兼容 | docs/AGENTS.md 纪律；ADR-0016 L77「typed-access 投影与 codegen 加法兼容」 | high |

## 9. Causal experiments（最小因果实验）

1. **文档内容锚 vs 行为事实对照**：行为锚实测成功读携带 schema（键集恰三键、四键投影体非 null）→ cordis L341 注记缺 schema 键即为**矛盾陈述**（过时）；对照 external-project-vfsl-codegen 适配器（只消费 `.ok`/`.value`，无形状注记）→ 加法兼容、无矛盾 → 作用域内**恰一个**矛盾站点被 R7 精确定位（不是整批文档过时）。
2. **预言机健全性（内容锚词汇来源）**：所有匹配器锚词取自 ADR-0016/CONTEXT 规范词形（「语义 schema 投影」「不是读的失败」、valueSchema/aliasDocs 标识）——词汇有单一权威源，防止 matcher 与文档「互相发明」新术语。
3. **反证/变异敏感——初版伪绿回归**：初版 shape/consumption 锚为「同段含 readData+schema+projection」，typed-access.md 现有第 4–8 步编号清单段（generated projection + `schema.vfsl` + `readData()`）即伪绿 → 收紧为规范词形相邻锚「schema 投影 / schema projection」，并把该现状段固化为负样本（§6.2）→ 现 7/7 红而 matcher 对规范样本全绿（正样本 6/6）——断言敏感性与非空转双向受检。
4. **null 判读反向对照**：负样本「schema 为 null 说明读取失败」（语义反向）与「value/schema 缺失时不是读的失败但无 null」（锚缺失）均被拒 → R5 锚既防反向陈述又防关键词漂移。

## 10. Impact surface（实现参考，非本阶段改动）

SA3/SA4 后续按 SA1 设计落位；本契约视角的必改/可选面：

- **必改（R 契约对应）**：
  - `.agents/skills/nomicore/typed-access.md`：新增/改写说明——成功读随值携带 `schema`（语义 schema 投影，ADR-0016/CONTEXT 词形）、投影体四键（valueSchema/aliases/docs/aliasDocs 或 ReadDataSchemaProjection）、docs/aliasDocs 键规约与派生 schema 文档表同构、`schema` 为 `null` 不是读的失败、典型消费（含读后修改凭投影构造合法 mutation）。建议落点：typed-access.md 新增「Read 语义与 schema 投影」小节（或并入 Process item 6 / 新 Completion gate 条款），并引用 ADR-0016 与 CONTEXT 词条（docs/AGENTS：链接权威源，不整段复制规则）。
  - `docs/integration/cordis-plugin-hosting.md` L340–343：`readData(['title'])` 示例注记同步为含 `schema` 的形状（或删除全等注记、改为说明性文字）——需与同页 L360（无注记，加法兼容）一致。
- **可选（不强制；现有示例加法兼容）**：`docs/integration/external-project-vfsl-codegen.md` §5 `read()` 适配器/§6 反例保持 `.ok`/`.value` 消费即合法；若想给 agent 型宿主递出 schema，可在 §5 适配器加转发说明（不改变示例行为）。
- **无改动义务**：ADR-0016/ADR-0008/CONTEXT（规范面已落仓）；`packages/*` 生产代码与测试；其他 integration 文档（hub-peer-deployment / local-package-linking 无 readData 消费，grep 实测）；根 AGENTS.md typed-namespace 节（「Reads may use the dynamic readData()」句与 ADR-0016 加法兼容，不矛盾——§11 排除项 4）。
- 仓库最终门：全仓 `pnpm typecheck` + `pnpm test` 绿（AC3）+ `git diff --check`（docs/AGENTS）。

## 11. Ruled-out hypotheses

| 假设 | 排除依据 |
|---|---|
| 缺口在行为面（readData 未实现投影） | #273 已合入 HEAD，运行时契约 21/21 绿、registry 79/79 绿；行为锚实测三键 + 四键投影体（§6.1） |
| 缺口在规范面（ADR/CONTEXT 未定案） | ADR-0016/ADR-0008 修订节/CONTEXT 词条已落仓且为母法基线（§1） |
| 红因测试入口/收集问题 | 文件被 vitest `include: ['packages/*/test/**/*.test.ts']` 收集（实测 7/7 确定性红 + 同目录 control 21/21 绿）；内容 matcher 有独立敏感性正/负样本（§6.2） |
| 红因 matcher 关键词空转/伪红 | 正样本全绿、现状段回归样本全红（§9 实验 3）；行为锚把 R7 矛盾钉在真实运行时输出上（§6.1） |
| 文档「投影」词已覆盖（external-codegen 4 处） | 全部是**生成静态类型投影**语义（L3/L81/L130/L492），无一处与 readData 结果面相关——正因如此 shape/consumption 锚采用规范词形相邻短语而非裸词（§9 实验 3） |
| 根 AGENTS.md 或其它文档存在与 ADR-0016 矛盾的 readData 陈述 | 全仓 grep：作用域外 readData 陈述（根 AGENTS.md「动态 readData 可用」句、replication skill L90）均加法兼容、无形状断言；全仓唯一两键全等形状注记 = cordis L341（§5/§6 扫描实测） |
| 现有 typed stub/测试需随文档票改动 | 无——#273 已完成行为改锚；本票零生产/测试改锚义务（AC3 只是终态门） |

## 12. Acceptance contract and test paths

红契约 `packages/namespace-registry/test/readdata-docs-adr0016-sync-red.test.ts`（**7 tests，HEAD 全红**；目标文档同步后全绿）：

| # | 契约断言（最小输入 → 可观测断言） | 对应 AC / ADR |
|---|---|---|
| R1 | typed-access.md 引用 ADR-0016 / 0016-readdata 锚点（权威形态来源挂接） | AC1 形态说明前提；docs/AGENTS 链接纪律 |
| R2 | typed-access.md 有段落说明「成功读随值返回该路径的语义 schema 投影（schema 字段）」（readData + 规范词形「schema 投影 / schema projection」同段） | AC1 What to build ①（结果形状）；ADR-0016 L19 |
| R3 | typed-access.md 有段落具名投影体四键（valueSchema + aliasDocs，或 ReadDataSchemaProjection） | AC1 What to build ①（四键投影体）；ADR-0016 L30–39 |
| R4 | typed-access.md 有段落说明 docs/aliasDocs 键规约与派生 schema 文档三表同构（aliasDocs + 同构/synthetic/寻址/键规约 等锚词） | AC1 What to build ②（键规约）；ADR-0016 L42 |
| R5 | typed-access.md 有段落含 null + 「不是读的失败 / not a read failure」（规范判读语） | AC1 What to build ③（null 判读）；ADR-0016 L22 |
| R6 | typed-access.md 有段落含「schema 投影」词形 + mutation/mutateData（读后修改场景凭投影构造合法 mutation） | AC1 What to build ④（典型消费）；ADR-0016 L8 |
| R7 | cordis-plugin-hosting.md 无两键全等成功形状注记（行注释 `// { ok: true, value: …` 且不含 schema） | AC2（示例同步、无矛盾）；ADR-0016 L19 |

负控/基线 `…-sync-control.test.ts`（21 tests，HEAD 与目标后均绿）：行为锚（cordis 示例真实装配实测三键形状 + 四键投影体）；matcher 敏感性正样本 6 / 负样本 9（含现状段回归）；内容负控扫描 4（external-codegen/typed-access 无过时注记、无 opt-in 用法、typed-access 核心内容保持、ADR-0016 词汇健全性）。共享 matcher 夹具 `readdata-docs-adr0016-contract-fixture.ts`（非测试文件，vitest 不收集）。

**SA3 满足契约的示例性措辞**（非唯一解；只要锚词在场即可，语义质量由 SA1/SA4 评审兜底）：
- R2/R6 满足句：「readData 成功分支返回 `{ ok: true, value, schema }`：`schema` 为该路径的语义 schema 投影（形态/缺席语义见 ADR-0016）；读取后需要修改时，可凭随读投影解读值域并构造合法 mutation。」
- R3 满足句：「投影体四键：valueSchema（值语义子树）/ aliases（传递闭包别名）/ docs / aliasDocs（注释切片）。」
- R4 满足句：「docs/aliasDocs 的键规约与派生 schema 文档三表同构（§3 语法路径 + 合成段寻址，别名以别名名锚定）。」
- R5 满足句：「`schema` 为 `null` 时不是读的失败（读的 `ok` 恒真）。」

## 13. Red/green or baseline evidence

命令（worktree 根；3 次连续复跑）：

```
# 红契约（文档内容断言；7/7 确定性红 ×3）
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run \
  packages/namespace-registry/test/readdata-docs-adr0016-sync-red.test.ts --typecheck.enabled=false
# → Test Files 1 failed (1)；Tests 7 failed (7)（3 次一致）
# 失败消息（代表性，全部为断言失败、非环境/超时/收集错误）：
#   R1 …expected false to be true（typed-access.md 必须引用 ADR 0016 …）
#   R2 …expected false to be true（须有 readData + 「schema 投影」段 …）
#   R3 …（须具名 valueSchema 与 aliasDocs …）
#   R4 …（docs/aliasDocs 键规约同构 …）
#   R5 …（null + 「不是读的失败」…）
#   R6 …（「schema 投影」+ mutation …）
#   R7 …当前过时注记：L341: // { ok: true, value: 'first' }: expected [Array(1)] to deeply equal []

# 负控/基线（21/21 绿）
… vitest run packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts --typecheck.enabled=false
# → Test Files 1 passed (1)；Tests 21 passed (21)（含行为锚：实测 {ok,value:'first',schema:四键}）

# 既有基线（绿）
… vitest run runtime-readdata-schema-projection-red.test.ts …-control.test.ts        # 21/21
… vitest run registry-open.test.ts registry-create.test.ts --typecheck.enabled=false  # 79/79
… vitest run packages/namespace-registry/test --typecheck.enabled=false               # 405 passed；唯一失败 = 本票红契约文件（R1–R7）
pnpm typecheck                                                                        # exit 0
```

红灯原因判定：R1–R6 全部是「typed-access.md 缺规范陈述」的结构性失败（断言消息逐条点名缺口内容）；R7 是唯一过时形状注记被精确定位（L341），其矛盾由行为锚的**真实运行时输出**背书（同示例装配实测三键）——红在正确原因，非 matcher 空转、非环境、非入口错误。

## 14. Runner trigger evidence

- 契约文件被仓库真实入口收集：`vitest.config.ts` `include: ['packages/*/test/**/*.test.ts']`（实测命中，§13）；CI test 分片按磁盘枚举（`scripts/ci-test-shard.mjs`）自动纳入新文件。
- 夹具文件无 `.test.ts` 后缀 → 不被收集（precedent：`readdata-schema-projection-fixture.ts`、vfsl `resolve-schema-at-path-fixture.ts`）。
- 终态门：全仓 `pnpm typecheck`（16 个 tsconfig）+ `pnpm test`（vitest --typecheck）绿 = AC3；本契约期红仅限 R1–R7 契约文件（目标文档同步后全绿），生产/规范面零改动。
- 放置理由：docs 无自有 package 测试目录（vitest include 只收 packages/domains/apps 测试）；本契约行为锚按 cordis-plugin-hosting 示例走 registry.create → lease.readData 真实装配，故收于 `packages/namespace-registry/test/`（#273 SA6 先例：契约文件收于行为所属包测试目录）。

## 15. Unknowns and blockers

无 blocker。契约未锁（留给 SA1/SA2/SA3 的自由度/注意事项）：
1. **措辞自由度**：匹配器只锁规范词形锚（R1–R7），文档具体句式/落点自由；建议 typed-access.md 以新增小节 + 链接 ADR-0016/CONTEXT 方式落位（docs/AGENTS 链接纪律），语义质量由 SA2/SA4 评审兜底（内容锚是**最低门**不是充分门）。
2. **文档语言**：typed-access.md 现为英文正文——满足句可用英文规范词形（"semantic schema projection"、"A null schema is not a read failure"），匹配器双语兼容（§6.2 正样本双语）。
3. **R7 修法自由**：含 schema 的三键注记 / 删除注记 / 改说明文字均可（行为锚只锁运行时事实不锁文档措辞）。
4. **可选增值（非契约）**：消费方「每次读 detached 深拷贝、不得跨读缓存共享」的告诫（CONTEXT Avoid 词条）与 agent 解读值语义（枚举/字面量域）示例可随 SA1 设计加入 typed-access（README 层 optional），契约不强锁。
5. 根 AGENTS.md 动态 readData 句（§10/§11）是否顺带微调由 SA1 判断——无矛盾、非契约。

## 16. Temporary diagnostics cleanup

- 无临时 probe/日志遗留：行为锚为契约文件的**常驻**用例（control），非临时诊断代码；全部运行进程内完成（Cordis 装配在用例内 `lease.release()` + `ctx.fiber.dispose()` + unhandled-rejection 探针收尾，零后台进程）。
- `git status` 最终 = 简报/dispatch（既有 untracked 输入 2 枚）+ 本报告 + 3 契约文件（untracked 产物 4 枚）；**生产实现与既有文档零改动**；无 commit/push。

## Artifacts（worktree-relative）

- `wiki/raw/task_issue-274_sa6_contract.md`（本报告）
- `packages/namespace-registry/test/readdata-docs-adr0016-sync-red.test.ts`（7 条红契约：R1–R7）
- `packages/namespace-registry/test/readdata-docs-adr0016-sync-control.test.ts`（21 条负控/基线：行为锚 + matcher 敏感性 + 内容扫描）
- `packages/namespace-registry/test/readdata-docs-adr0016-contract-fixture.ts`（共享 matcher/文档路径夹具）

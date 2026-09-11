# SA7 动态验证报告 — issue #306（M4 联合成员文档注释：解析挂载 + IR/derived `memberDocs`）

- **Dispatch**: sa-b9001af4-ac56-4398-a464-6dd138ccadb2（mabf-sa7 / final-verification / iteration 0）
- **Worktree**: `/home/wangjian/nomicore-fix-issue-306`，branch `mabf/issue-306`，HEAD `91c4add`（`git status`：生产改动恰为 `M packages/vfsl/src/{parser,ir,semantic,derived,evaluate}.ts`，151 insertions / 14 deletions；SA6 契约三件与 wiki/scratch 产物 untracked）
- **验证对象**: SA3 实现（SA4 verdict **approve**）vs SA6 批准验收契约（19 用例/12 红 7 绿，冻结）＋ SA1 设计 §7 D1~D7 / §8 数据流路线 ①~⑤
- **Verdict**: **approve**（所有设计声明改变的数据流按设计变化、所有声明保持的路线逐字节保持、状态机转换与关键值正确、禁止状态未出现、错误与 cleanup 符合设计、临时诊断已清理）

---

## 1. Inputs

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-306.md`（Host 简报，AC1~AC6） | 已读；issue 无适用 Owner 评论（Host dispatch「REST comment read returned an empty array」） |
| `wiki/raw/task_issue-306_design.md`（SA1 设计，417 行） | 已读（§7 D1~D7、§8.3 路线①~⑤、§8.2 状态机） |
| `wiki/raw/task_issue-306_sa6_contract.md`（冻结验收契约） | 已读（19 用例、金样本六值、E-1~E-5） |
| `wiki/raw/task_issue-306_sa3_impl.md` / `task_issue-306_sa4_review.md`（approve） | 已读（SA4 §11 动态项与 N-1/N-2 观察作为本轮回补验证输入） |
| `.scratch/sa8-conflict-report-issue-306.md` + `wiki/raw/task_issue-306_design_conflict_report.md`（均 clear） | 已读（C-1~C-6 / E-1~E-6、O-1/O-2 实现红线——协议边界，不可改变） |
| `docs/adr/0019-vfsl-union-member-docs.md`（规范权威） | 已读（决策 1/2/3/4/5/8/9.3/10 逐条对照动态观察） |
| `packages/vfsl/src/{parser,ir,semantic,derived,evaluate}.ts` 实现 diff + 冻结契约三件 | 全文核读（本验证零实现改动） |

## 2. Runtime environment

`node v24.13.0`、`pnpm 10.28.2`、`vitest 3.2.7`（内建 typecheck）、`typescript 5.9.3`、`tsx 4.23.12`；worktree `/home/wangjian/nomicore-fix-issue-306`。全部链路同步纯函数（无服务、无端口、无后台进程遗留）。

## 3. Changed Data Flow Verification

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| ① doc→AST 附着点 A（`|` 前 doc 挂后继成员） | 契约用例 1/3＋探针：`"a" /** 乙 */ \| "b"` → `[[],[' 乙 ']]`；两条 `\|` 各带 doc → `[[],[' b1 '],[' c1 ']]`；多行前导 `\|` 布局三成员等长对齐 | 契约测试＋探针（经 `parseVfsl`） | leadDocs → dangling 尾部区间 → 逆序同一性核对 → splice → `memberDocs[i]` | doc 挂 `|` 之后的成员 | 与期望逐字一致 | ✅ |
| ① doc→AST 附着点 B（首成员起始记号） | 契约用例 2/4＋探针：`/** 甲 */ "a" \| "b"` → `[[' 甲 '],[]]`；连续两条 doc（含换行/`@tag`）逐字 `[[' 一 ',' 二\n * @tag '],[]]`；**非字面量成员起始**（SA4 N-2 静态判定项，本轮动态落证）：`/** 甲 */ { a:"x" } \| { b:"y" }` → `[[' 甲 '],[]]`、`/** 甲 */ Record<string,"x"> \| Record<string,"y">` → `[[' 甲 '],[]]` | 契约测试＋探针 | peek 记号 leadDocs 引用＋消费前下标快照 → 出口结算 | 挂 member 0 | 与期望逐字一致 | ✅ |
| ① 记账并入（第四类回收不触碰三锚位） | 混排模块（M1 别名 doc＋M2 字段 doc＋M3 标记 doc＋M4 成员 doc 同模块）`ok:true` 无 E100 → `claimed + dangling.length === docTotal` 不变量在 M4 路径成立；每条 doc 恰落一处（M1/M2/M3/M4 之一） | 探针（复杂混排） | `/** 别名级 */` → ROOT.docs；`/** f */` → 字段 docs；`\| /** 载体 */ YLeaf` 夹缝 → marker.docs 恰一次、成员表不含「载体」；`\|` 前 doc → 成员表 | 无静默丢失/无双挂/无假 E100 | 全部符合（docTotal 失衡会 loud E100，未出现） | ✅ |
| ① 嵌套联合（内层先结算、外层 start 不漂移） | `/** 外0 */ \| YArray</** 内0 */ \| "a" \| "b"> \| YArray<"z">` → 外层 `[[' 外0 '],[]]`、内层 arg `[[' 内0 '],[]]`；Record 值位两个联合同模块各挂各（B 锚 `[[' 甲 '],[]]` / A 锚 `[[],[' 乙 ']]`） | 探针 | 内层 splice 区间下标 > 外层已记录区间 → 外层核对不受影响 | 各联合独立正确挂载 | 与期望一致 | ✅ |
| ② AST→IR 条件键＋键序 | 有 doc：`Object.keys(union)` = `['kind','members','memberDocs']`、JSON 往返等价；无 doc：恰 `['kind','members']`、同模块混排 P 有键 / Q 无键且 JSON 不含 `memberDocs` 串 | 契约测试＋探针 | `some(d=>d.length>0)` 条件展开 | 条件附加、键序 kind→members→memberDocs | 与期望一致 | ✅ |
| ③ IR→指纹（新文本） | M4 文本 `sha256:v1:612e845b…29c05` ≠ 去 doc 文本 `sha256:v1:84ca4f74…1612`（前缀 v1 不升级） | 探针（`semanticFingerprintOf`） | IR JSON → SHA-256 → `sha256:v1:` | 新键参与指纹输入、前缀冻结 | 与期望一致 | ✅ |
| ④ IR→derived 条件稀疏表 | 三成员仅成员 1 带 doc → 恰一键 `T.<member 1>`；第八键居末 `Object.keys(derived)` = 七键＋`memberDocs`；嵌套 `X.k.<member 0>` / `V.<item>.<member 0>`（契约）；同 IR 两次求值逐字节一致 | 契约测试＋探针（`evaluate`） | `guardMemberDocs` → `<member N>` 键 → 末位条件展开 | 只收非空、键序声明序、条件整键 | 与期望一致 | ✅ |
| ④ 端到端编译链（SA4 §11 第 2 项） | `compileSchemaEnvelope`（M4 schema）→ 冻结五件套 ok：semanticFingerprint 与直算逐字节相同（`sha256:v1:612e845b…`）、envelopeFingerprint 前缀 v1、derived 含 `{'T.<member 0>':[' 甲 ']}`、**deepFreeze 覆盖新表**（向 memberDocs 表写入 → 抛 TypeError）；`getCompiled`：同文本两次调用返回**同一对象引用**（内容键缓存命中不重解析）、失败文本（夹缝 E305）不落缓存且重试结果逐字节一致 | 探针（公共接缝） | parse→evaluate→fingerprint→deepFreeze/cache | 新文本产出新指纹、缓存与冻结正常 | 与期望一致 | ✅ |
| ⑤ 校验/物化盲读 | 有/无成员 doc 的 derived 对同一 snapshot：合法值与非法值（`"zzz"`）的 `validateLogicalSnapshot` 结果全等（非法侧同为 ok:false 单条 `值不在枚举内：期望 a \| b`，path `["s"]`）；七路 derived 全等（契约用例 15） | 契约测试＋探针 | derived → 校验解释器 | memberDocs 不进校验 | 与期望一致 | ✅ |

## 4. Preserved Data Flow Verification

基线 = `git archive HEAD packages/vfsl/src` 抽取的实现前源码（HEAD `91c4add`，`grep memberDocs` 零命中）与当前实现在同一进程内对同一语料逐字节对比（A/B 探针，138 项断言全过）：

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
| --- | --- | --- | --- | --- | --- |
| 存量 IR（C-2/E-1） | 15 条存量语料（`domains/vfs3-assets/schema.vfsl` 真实 schema、SPEC_FIXTURE、FIXTURE_B、M1/M2/M3 合法 doc 文本、判别联合/嵌套/Record 值位/数组/数字字面量/Pattern 键/多行前导 `\|` 无 doc 布局）IR 紧凑 JSON 逐字节不变 | A/B 探针 | 摘要 X | 与 baseline **逐字节相等**（15/15）；IR 无 `memberDocs` 串 | ✅ |
| 存量 semantic 指纹（C-2） | 同语料指纹逐字节不变、`sha256:v1:` 不升级 | A/B 探针＋契约金样本复算 | `sha256:v1:b71be76e…0631c`（A）/ `55095e88…144d`（B） | 与 baseline 逐字节相等（15/15）；金样本 A/B 四值（IR sha `325cf923…f3ffc`、`78332590…be71`；指纹两值）运行时复算逐字节等于 SA6 常量 | ✅ |
| 存量 derived（E-1） | 同语料派生物 JSON 逐字节不变、恰七键 | A/B 探针＋契约 | 键集合七键 | 与 baseline 逐字节相等（15/15）、无 `memberDocs` 键；FIXTURE_B derived sha `547748b6…492f` 等于 SA6 常量 | ✅ |
| E305 维持面（C-3） | 坍缩两形态 `/** d */ "a"` / `/** d */ \| "a"` → E305 @(2,10)；`\|` 夹缝非标记（单行 @(2,16) / 多行 @(4,5)） | A/B 探针＋契约用例 8/9 | E305 恰一条、锚注释起始 | 两侧同为 E305 恰一条、锚点/前缀逐字节一致；**唯一差异 = 正文枚举补「联合成员」**（baseline 无、current 有——决策 9.3 授权的正文变更，前缀 `VFSL-E305: ` 冻结两侧一致） | ✅ |
| 坍缩/嵌套坍缩不结算（决策 2） | 内层坍缩 `YArray</** d */ "a">` doc 留 dangling → E305 | 探针 | —（旧路径同判） | E305 恰一条 @(2,19)（锚内层注释起始） | ✅ |
| EOF 悬空 doc | 全部结算之后沉积的 doc → E305 | 探针 | —（既有行为） | E305 恰一条 @(3,1) | ✅ |
| M3 优先（决策 3） | `\| /** 载体 */ YLeaf` 夹缝 doc 挂 marker 恰一次、不进成员表；M3 坍缩形态 `ok:true` 无 memberDocs | 契约用例 7/10＋探针混排 | 既有行为 | marker docs `[' 载体 ']` 恰一次、成员表不含「载体」（双方向封死） | ✅ |
| tokenizer 侧通道 / claimDocs / 三锚位 / fingerprint.ts / validate / resolve / index（D7 六条） | 零改动 | `git status`＋包/根 typecheck＋619 存量测试 | — | `M` 条目恰 5 个 ALLOW 文件；fingerprint 单一生产者（A/B 指纹逐字节相等的构造前提） | ✅ |
| 跨包盲读消费方（设计 §10 矩阵） | codegen emitter / doc-runtime / namespace-runtime 对可选键盲读、行为零变化 | `npx vitest run packages/vfsl-codegen/test packages/doc-runtime/test packages/namespace-runtime/test` | — | **78 files / 798 tests 全绿**、Type Errors: no errors | ✅ |

## 5. State Machine Verification

dangling 记账状态机（设计 §8.2）逐转换的运行时观察：

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
| --- | --- | --- | --- | --- | --- |
| doc 随锚记号入 dangling | A 锚（`\|` next()）/ B 锚（首成员 peek） | 记录 `{start, leads}` pending，不动作 | 挂载成功（①两锚位全部正例）＋成员解析中 M2/M3 各自回收互不干扰（A+M2 并存、混排模块） | 记录时刻提前 splice（会抢 M3）——未见（M3 夹缝 doc 恰一次在 marker） | ✅ |
| pending 记录完毕 | union 出口 `members ≥ 2` | 逆序逐位 `===` 同一性核对：全配 → splice＋`claimed += n`；失配 → `memberDocs[i]=[]` 不动 dangling | `\|` 前 doc → 成员表；M3 已回收的夹缝 doc → 空槽＋marker 恰一次 | 正序结算假性失配（嵌套/多 pending 场景 doc 误留 dangling）——未见（嵌套两联合、双 `\|` doc、Record 值位双联合全对） | ✅ |
| pending 记录完毕 | `members === 1` 坍缩 | 不结算 → doc 留 dangling → analyze 立 E305（锚注释起始） | 两形态 @(2,10)、内层坍缩 @(2,19) | 坍缩误挂成员/别名——未见 | ✅ |
| 结算后 | 模块末 | `claimed + dangling.length === docTotal`（失衡 → 兜底 E100） | 全部 ok 场景无假 E100（混排模块 M1/M2/M3/M4＋EOF E305 共存 ok 或预期单错） | 静默丢 doc / doc 双挂——未见（每条 doc 恰落一处） | ✅ |
| 任意态 | 重复触发/重入 | 纯函数幂等：重复解析/求值逐字节一致 | 两次 parse IR JSON sha 相等、两次 evaluate JSON 相等；getCompiled 失败重试一致 | 竞态/半完成状态——不适用（同步无共享可变状态，构造性无面） | ✅ |
| evaluate 入口 | 手造 IR 带 `memberDocs` | 缺席=合法；在场=等长数组的数组才放行 | 良性等长 ok:true；全空数组不产生键 | `?? []` 静默规范化——未见（四类畸形全 loud） | ✅ |

## 6. Error and Cleanup Flow

- **E100 边界（AC5）**：手造 IR 四类畸形（短于/长于 members、元素非数组、整体非数组）→ 每类 `ok:false`、**恰一条** issue、前缀 `^VFSL-E100: `、`'derived' in result === false`（无派生物载荷）；良性等长 `[[' x '],[]]` ok:true 产 `T.<member 0>`；全空 `[[],[]]` ok:true 不产键。错误沿设计路径传播（TypeError → evaluate 顶层 catch → E100 判别结果，不外抛）。
- **E305 边界（AC2/C-3）**：触发面只缩小——4 个维持面（坍缩两形态/夹缝单行/多行）恰一条 E305＋冻结前缀＋精确锚点，M4 正例全部 ok:true；E305 消息前缀冻结、正文补「联合成员」（`/联合.{0,6}成员/` 过，A/B 显示正文差异恰为此枚举项）。
- **无伪成功**：E305/E100 均为判别结果（`ok:false` + issues），不吞错、无 fallback 分支；parser 侧 docTotal 失衡兜底保持（任何结算算术错误必以 E100 暴露而非静默——全场景未触发，符合预期）。
- **cleanup/资源**：全链路同步纯函数、无 IO/进程/端口/后台任务；`M4Pending` 随解析栈消亡；deepFreeze 覆盖新表（写抛）；失败不落编译缓存、可无限重放。无 cleanup 时序问题。

## 7. Temporary Diagnostics

| 项 | 内容 |
| --- | --- |
| 添加 | `.scratch/sa7-probe-306.ts`（公共接缝探针，73 项断言，`[SA7-DATAFLOW]` 前缀日志）、`.scratch/sa7-probe-306-ab.ts`（baseline A/B 探针，138 项断言）、`/tmp/sa7-baseline/`（`git archive HEAD packages/vfsl/src` 抽取的实现前源码）。均为临时观察工具，**未修改任何生产/测试文件**，未改变控制流（只读调用公共接缝） |
| 删除 | 上述三件全部删除（`.scratch/` 现仅剩 SA3 四份证据日志＋SA8 报告＋既有 `vfsl-v1-parser/`） |
| Post-removal 验证 | 重新运行关键场景（冻结契约两文件）→ **19/19 绿、Type Errors: no errors**，与删除前逐字一致；`grep -rn "SA7-DATAFLOW"` 全 worktree 零命中（exit 1）；`git diff` 零命中——临时诊断未进入任何持久化产物 |

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA6 | 19 用例验收契约（AC1~AC5） | 冻结契约两文件 vitest | 19/19 绿 | 19/19 绿（运行 2 次＋删除探针后复跑 1 次，逐字一致） | §9 命令 1 | ✅ | — |
| SA6 | E-1 存量金样本（IR/指纹/derived 六值） | 契约断言＋探针运行时复算 | 逐字节等于常量 | 六值全等；A/B 对 15 条语料逐字节相等（45 项字节等式） | §9 命令 1/7 | ✅ | — |
| SA6 | E-2 M4 矩阵（两锚位/连续 doc/坍缩/夹缝/M3） | 契约＋探针（对象、Record 成员起始、分隔 `\|` doc、嵌套、EOF） | 全部按决策 1/2/3 | 全部符合 | §3 路线① | ✅ | — |
| SA6 | E-3 derived 条件稀疏（`<member N>`/只收非空/整键缺席/嵌套） | 契约＋探针 | 按决策 5 | 全部符合（第八键居末、`T.<member 1>` 单键） | §3 路线④ | ✅ | — |
| SA6 | E-4 手造 IR 守卫 | 契约＋探针 | 四类畸形恰一条 E100、无 derived | 符合 | §6 | ✅ | — |
| SA6 | E-5 门禁绿（包测试＋typecheck） | vitest＋tsc＋pnpm typecheck | 全绿 | 619/619、包 tsc exit 0、根 14 tsconfig exit 0 | §9 命令 2/3/4 | ✅ | — |
| SA4 | §11-1 跨包测试面（N-1：全仓 test 未跑） | 定向消费方面（codegen/doc-runtime/namespace-runtime） | 全绿 | 78 files / 798 tests 绿 | §9 命令 5 | ✅ | 全仓 `pnpm test` 留 CI 分片（SA7 边界：不运行全仓回归；见 §10 偏差 1） |
| SA4 | §11-2 信封编译/指纹端到端＋deepFreeze＋缓存 | `compileSchemaEnvelope`/`getCompiled` 探针 | 新指纹/内容键缓存/冻结覆盖 | 全部符合 | §3 路线④ | ✅ | — |
| SA4 | N-2 B 锚非字面量成员起始（静态判定项） | 探针（`{` / `Record<` 成员起始） | 挂 member 0 | `[[' 甲 '],[]]` 两形态均符合 | §3 路线① | ✅ | 如需显式锁定由 #309 规格测试矩阵承接（出 #306 冻结面） |
| Design | D1/D2/D3/D4 挂载/AST/IR/derived 全链 | 路线①~④探针 | 按设计 | 全部符合 | §3 | ✅ | — |
| Design | C-2 指纹纪律（存量逐字节、无第二生产者） | A/B baseline 对比 | 逐字节相等 | 15/15 语料三项产物逐字节相等 | §4 | ✅ | — |
| Design | C-3 E305 只缩小＋C-6 消息边界 | A/B＋契约 | 维持面不变、前缀冻结 | 4 面维持、唯一正文差异=授权枚举项 | §4 | ✅ | — |
| Design | C-4 纯文档（不进校验） | `validateLogicalSnapshot` 双向＋契约七路 | 结果全等 | 全等（合法/非法 snapshot 两向） | §3 路线⑤ | ✅ | — |

## 9. Commands and Evidence

| # | Command | Result |
| --- | --- | --- |
| 1 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/vfsl/test/parse-vfsl-union-member-docs.test.ts packages/vfsl/test/evaluate-derived-member-docs.test.ts` | **2 files / 19 tests 全绿**，Type Errors: no errors（初始＋删除探针后复跑一致） |
| 2 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/vfsl/test` | **34 files / 619 tests 全绿**（33 运行时 + 1 `.test-d.ts`），Type Errors: no errors，exit 0（67.65s） |
| 3 | `npx tsc -p packages/vfsl/tsconfig.json` | exit 0 |
| 4 | `pnpm typecheck`（根，14 个 tsconfig 全链） | exit 0 |
| 5 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/vfsl-codegen/test packages/doc-runtime/test packages/namespace-runtime/test` | **78 files / 798 tests 全绿**，Type Errors: no errors，exit 0 |
| 6 | 探针 1（公共接缝：parseVfsl/evaluate/semanticFingerprintOf/getCompiled/compileSchemaEnvelope/validateLogicalSnapshot） | **73 项断言全过**（附着点/嵌套/混排记账/键序/指纹/derived/缓存/冻结/E305/E100/校验全等） |
| 7 | 探针 2（baseline `git archive HEAD` vs 当前，同进程 A/B） | **138 项断言全过**（15 存量语料×IR/指纹/derived 逐字节相等＝45 项字节等式；4 M4 语料 baseline=E305/current=ok；4 E305 维持面锚点/前缀一致） |
| 8 | 契约冻结完整性 | 三件 mtime 停留 SA6 时窗（12:20~12:23）；`grep -E "\.(skip\|only\|todo)\("` 零命中；`git status` 的 `M` 条目恰 5 个 ALLOW 文件 |
| 9 | 临时诊断清理 | 探针两件＋`/tmp/sa7-baseline` 删除；worktree 与 `git diff` 中 `[SA7-DATAFLOW]` 零命中；复跑命令 1 结果不变 |

关键运行时值（复算）：金样本 A IR sha `325cf923…f3ffc` / 指纹 `sha256:v1:b71be76e…0631c`；B IR sha `78332590…be71` / 指纹 `sha256:v1:55095e88…144d`；M4 新文本指纹 `sha256:v1:612e845b6165e366984f0ba0c8db78c796e8c7c3962608a2f1201722e2229c05` vs 去 doc `sha256:v1:84ca4f747746b94020d7752ade0dcd5e89404a5bc62a90230c09548f42401612`；E305 现行正文 `VFSL-E305: 悬空文档注释：未紧邻可挂载的声明性节点（类型别名 / 属性 / 标记类型 / 联合成员），且不相邻即不再挂载`。

## 10. Deviations

1. **全仓 `pnpm test` 未运行**（SA7 技能边界「不运行全仓回归」；SA6 E-5 亦将 #306 验收面定为 `packages/vfsl` 包测试＋typecheck）。以设计 §10 点名的盲读消费方面（vfsl-codegen / doc-runtime / namespace-runtime，798 绿）＋根 14 tsconfig typecheck 作为跨包替代证据；全仓分片留 CI（SA4 N-1 的建议路由，非本验证缺陷）。
2. **探针语料三次自纠**（E309 标量/容器混形、E306 Record 键形、括号分组不在 v1 子集、成员计数笔误）——全部为探针输入构造错误，两侧实现行为始终一致；最终探针全过后删除。无实现侧异常发现。
3. **#307（codegen 四发射位）/ #308（投影切片第三来源）/ #309（v1-spec §5 措辞）缺席**——SA8 C-5 预期中间态，不判 #306 缺陷；PR #305 收官清单须另行核对三票（流程性提醒，移交总控）。
4. `wiki/raw/task_issue-306_relevant_decisions.md` / `task_issue-306_conflict_report.md` 不存在（SA8 等价产物 `.scratch/sa8-conflict-report-issue-306.md` ＋设计后复查报告均 clear，已作为协议边界输入）。
5. 本验证**零实现改动**、零契约改动、未 commit/push/建 PR（SA7 职责边界）。

## 11. Verdict

**approve**。

- 设计声明改变的路线（§8.3 ①~⑤）全部按设计变化：两锚位挂载（含非字面量成员起始）、条件 IR 键＋键序、条件稀疏 derived 表＋`<member N>` 文法、新文本指纹、端到端编译/缓存/冻结、手造 IR loud E100。
- 设计声明保持的路线全部逐字节保持：15 条存量语料 IR/指纹/derived 三项产物与实现前 baseline 逐字节相等（含真实 `domains/vfs3-assets/schema.vfsl`）；E305 四个维持面锚点/前缀不变；M3 优先不双挂；三锚位与 tokenizer 侧通道零变化。
- 状态机转换与关键值正确（含坍缩不结算、嵌套先内后外、EOF 悬空、记账不变量），禁止状态（双挂、静默丢失、假 E305、静默规范化）未出现。
- 错误与 cleanup 符合设计：判别结果、恰一条、无派生物载荷、失败不落缓存、可重放。
- 冻结契约 19/19 绿、包 619/619 绿、包/根 typecheck exit 0、定向跨包 798 绿；临时诊断已全部清理且清理后结果不变。

— SA7（Dynamic Verifier），唯一产物为本报告。

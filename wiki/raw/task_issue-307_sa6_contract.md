# SA6 诊断与验收契约 — issue #307（vfsl-codegen 联合成员 doc 四发射位）

- 派发：`sa-d86c67f2-87fc-4095-a02c-bcc8d471c342`（role `mabf-sa6`，phase `acceptance-contract`，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-307`（branch `mabf/issue-307`，HEAD `4d4208b`）
- 产出日期：2026-09-11
- 任务类型：**Feature**（能力缺口证明 + 目标行为验收契约；不虚构 Bug 根因）
- 契约测试：`packages/vfsl-codegen/test/generate-union-member-docs.test.ts`（33 用例：23 红 / 10 绿）

## Verdict

`approve`

能力缺口已证明（derived `memberDocs` 四发射位输入在场、生成物零发射），验收契约可执行、测试入口真实、负控当前即绿、预期文案经反证探针证实在既有布局上可达；23 条红灯全部为「成员 doc 字节缺失」的断言失败，10 条负控绿。可进入 SA1 设计 / SA3 实现。

---

## 1. 任务类型与输入

| 输入 | 路径 | 采用 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-307.md` | issue #307 正文 + AC1–AC4；State open；无评论 |
| 上游冲突产物 | `wiki/raw/task_issue-307_conflict_report.md` | SA8 门禁 Verdict `clear`；登记 W1/W2 设计留白、B1–B3 边界义务 |
| 规范基准 | `docs/adr/0019-vfsl-union-member-docs.md` 决策 6（accepted 2026-09-11） | 四发射位 + 无发射位位点 + semicolonFree 同布局的唯一规范来源 |
| 派生物基准 | `packages/vfsl/src/derived.ts` L84-91（ADR 0019 决策 5）、`evaluate.ts` L341-429 | `memberDocs` 条件稀疏表与 `<member N>` 键文法（#306 已合并） |
| 现存实现 | `packages/vfsl-codegen/src/emitter.ts`、`docs.ts`、`collect.ts` | 当前三槽 docs 消费面（缺口定位） |
| 现存测试 | `packages/vfsl-codegen/test/*.test.ts`（8 文件 62 用例） | 基线与负控风格、CLI 端到端先例、`tsc-helper.ts` 孤立编译辅助 |

分发说明「Issue 反馈 REST 快照：无评论（none applicable）」与 SA8 实读一致：无 owner 覆盖性输入；契约基准 = issue AC + ADR 0019 决策 6。
本 iteration 尚无 SA1 设计产物；ADR 0019 决策 6 未定的两处实现自由度（W1 切换判据、W2 多 doc 渲染）由本契约**钉死为可执行断言**（§12.3），SA1/SA3 若有不同选择必须先经 SA6 原位修订本契约。

## 2. Owner 评论映射

无 owner 评论（REST 快照空）。AC → 契约用例映射：

| Issue #307 AC | 契约落点（测试） |
|---|---|
| AC1 别名判别联合成员 doc 以 `  \| ` 行基准上一行发射 | 发射位 1 组 3 用例（默认 / ref 成员 / semicolonFree） |
| AC1 别名枚举有成员 doc 时转多行（默认 + semicolonFree） | 发射位 2 组 4 用例（枚举 / 标量联合 / 部分 doc / semicolonFree） |
| AC2 内联联合/枚举成员 doc 行内前置 | 发射位 3/4 组 7 用例（ref / 枚举 / 标量联合 / map 判别 / 数组元素位 / 部分 doc / semicolonFree） |
| AC3 无成员 doc 生成物逐字节不变；存量 domains `generate --check` 不报过期 | 负控「无 doc」5 用例 + 存量 domain 逐字节相等 + 仓根 `pnpm generate --check` 退出 0 |
| AC4 codegen 包测试与 typecheck 绿、根 `pnpm typecheck` 绿 | 验证门（§12.4）+ 类型面组 2 用例（孤立 tsc 零诊断，注释不改变类型形状） |
| （ADR 决策 6 末段）YPlainArray / YXmlFragment 无发射位 | 负控组 3 用例（plain / xml / M3 优先位） |
| （SA8 W1/W2）切换判据与多 doc 渲染 | §12.3 契约决策 + 对应用例（含 mutation 敏感对照） |

## 3. SA8 约束采纳

- **B1 范围边界**：契约与测试只落 `packages/vfsl-codegen`（emitter + test）。不触 `packages/vfsl` 公共面、`resolve-schema-at-path.ts`（#308）、v1-spec §5 / schema-authoring-guide §7/8（#309）、协议包与规格文本。测试未引用任何 #308/#309 行为。
- **B2 集成惯例**：实现挂 PR #305 同支累积；本契约只新增测试文件，不改生产实现。
- **B3 环境注记**：门禁环境未安装依赖；本 worktree 已 `pnpm install --frozen-lockfile`（见 §4），`generate --check` 可实跑并已实跑。
- **W1/W2**：作为 SA6 契约决策收口（§12.3），并已在测试中锚定；不属冲突点。
- SA8 核验的前置事实复核通过：#306（M4 解析 + IR/derived `memberDocs`）确在 HEAD 在场（`packages/vfsl/src/derived.ts` L91、`evaluate.ts` L406-407），消费面就绪。

## 4. 环境与基线

- 运行时：Node v24.13.0，pnpm 10.28.2，仓库零构建产物（vitest + tsx 现场转译，`NODE_OPTIONS=--conditions=nomicore-source`）。
- 依赖：`pnpm install --frozen-lockfile` → exit 0（16 workspace projects，65 包复用，`packages/vfsl-codegen/node_modules/@nomicore/vfsl` 软链在场）。
- **基线（添加契约测试前，HEAD `4d4208b`）**：

| 命令 | 结果 |
|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl-codegen` | **8 文件 / 62 用例全绿**，Type Errors: no errors，exit 0（含 2 个 CLI spawn 型与 1 个孤立 tsc 型用例） |
| `pnpm --filter @nomicore/vfsl-codegen typecheck` | exit 0 |
| `pnpm typecheck`（根 14 tsconfig 串行） | exit 0 |
| `pnpm generate --check` | exit 0（存量 domains 新鲜） |

- 契约测试加入后（本契约产物在树）：**9 文件 / 23 failed + 72 passed / 95**，Type Errors: no errors；包/根 typecheck 与 `generate --check` 仍 exit 0（§13）。

## 5. 正例复现（能力缺口）

最小复现 = 公共入口 `parseVfsl` → `evaluate` → `generateProjection`，不 mock 任何边界。四个发射位的**输入在场、输出缺失**成对出现（红因前置断言 + 断言失败对照）：

| 发射位 | derived `memberDocs` 键（实测在场） | 当前生成物（HEAD 4d4208b 实测） | 目标（ADR 0019 决策 6） |
|---|---|---|---|
| 1 别名判别联合 | `Entity.<member 0>` / `Entity.<member 1>` | `export type Entity =\n  \| { … }\n  \| { … };`（无 doc 行） | 每成员 doc 行在 `  \| ` 行上方 |
| 1 别名联合 ref 成员 | `U.<member 0/1>` | `  \| PathSchema<A, 'map'>\n  \| PathSchema<B, 'map'>`（无 doc 行） | 同上（规则 0 外壳成员） |
| 2 别名枚举坍缩位 | `Status.<member 0/1/2>` | `export type Status = 'draft' \| 'submitted' \| 'archived';`（单行） | 有 doc → 多行 `  \| ` 逐成员 |
| 2 别名标量联合坍缩位 | `Maybe.<member 0/1>` | `export type Maybe = string \| null;`（单行） | 同上 |
| 3 内联联合（字段位） | `ROOT.u.<member 0/1>`、`ROOT.tags.<item>.<member 0/1>` | `u: PathSchema<PathSchema<A, 'map'> \| …, 'map'>`（无 doc） | 成员前 `/** d */` 行内前置 |
| 4 内联枚举（字段位） | `ROOT.s.<member 0/1>` | `s: PathSchema<'draft' \| 'submitted', 'leaf'>`（无 doc） | 同行内前置 |
| 无发射位：plain / xml | `ROOT.p.<item>.<member 0/1>`、`ROOT.x.u.<member 0/1>`（照常收集） | 无 doc 字节 | **保持**无 doc 字节（决策 6 末段） |

直接故障点：`emitter.ts` 的 `EmitTables`（L121-129）只有 `aliasDocs/fieldDocs/markerDocs` 三槽，`generateProjection`（L146-154）不消费 `derived.memberDocs`；`emitAlias`（L211-225）无成员边界回填，`emitInner`（L259-309）无成员前缀拼接。能力缺口 = **第四表未接线**，非输入缺失、非解析失败。

## 6. 负控

10 条当前即绿（实现后必须保持），且均为**运行时可观察行为**断言：

1. YPlainArray 纯值子树：`memberDocs` 键在场（`ROOT.p.<item>.<member 0/1>`），生成物 `p: PathSchema<'a' | 'b'[], 'plain'>;` 且 doc 文本零出现。
2. YXmlFragment 不透明实参：`memberDocs` 键在场，生成物 `x: PathSchema<string, 'xml-fragment'>;` 且 doc 文本零出现。
3. M3 优先位（`type X = | /** 载体口径 */ YLeaf<string> | YLeaf<number>`）：`derived.memberDocs` 整键缺席 → `export type X = string | number;` 单行不变，标记 doc 不泄漏。
4. 无 doc 派生表条件稀疏：三个无 doc fixture 的 `memberDocs` 均为 `undefined`。
5. 无 doc 别名联合：`  | ` 多行布局与 HEAD 金样本逐字节一致。
6. 无 doc 坍缩位：枚举 / 标量联合（含 M3 标记联合）维持既有单行金样本。
7. 无 doc 内联位：联合 / 枚举 / 标量联合维持既有单行内联金样本。
8. 同模块混合：无 doc 别名单行、无 doc 字段位单行（切换不整模块联动）。
9. `domains/vfs3-assets`：派生 `memberDocs` 缺席，`generateProjection(derived, {sourceText})` 与仓内 `generated.ts` **逐字节相等**。
10. 仓根 `pnpm generate --check` 退出 0（存量 domains 不报过期）。

## 7. 稳定性、规模与时序

- **确定性**：多 doc 块位/行内位用例均附「同输入两次发射逐字节一致」断言；`generateProjection` 纯函数无状态（既有 `--check` 幂等链）。
- **时序/并发**：无竞态面（纯文本发射）；契约用例不用定时器/端口/文件锁。CLI 型用例各 350–1200ms（spawn `pnpm generate`），已按既有先例设 per-test timeout 20s。
- **规模**：位点键空间与成员数线性；无新增算法复杂度（前缀拼接 + 已排序遍历）。
- **环境无依赖漂移**：fixture 全部内联在测试文件，仅存量 domain 对照读仓内文件；临时 fixture 写 `mkdtemp` 系统临时目录，不污染 `domains/`。

## 8. 能力缺口链（Capability gap）

| Step | 事实 | 证据 | 置信度 |
|---|---|---|---|
| 1 | 规范要求四发射位（含坍缩位多行切换、semicolonFree 同布局、无发射位位点） | ADR 0019 决策 6 全文；issue #307 正文/AC；SA8 clear | 确定 |
| 2 | 输入已就绪：M4 成员 doc 经 parse → IR `memberDocs` 条件键 → derived 条件稀疏表（键 = `<member N>` 路径） | `derived.ts` L84-91；`evaluate.ts` L404-408；实测键清单（§5 表） | 确定 |
| 3 | 生成器当前零消费：`EmitTables` 三槽、`generateProjection` 不读第四表 | `emitter.ts` L121-154 源码符号 + 四发射位实测输出（§5） | 确定 |
| 4 | 因此生成物对成员 doc 零字节发射（含 aliasDocs 在场的别名） | 契约红灯 diff（§13）：期望 doc 行 vs 实际无 doc 行 | 确定 |
| 5 | 无 doc 路径不受影响（条件稀疏 + 位点闸门） | 10 条负控绿 + 存量 domain 逐字节相等 | 确定 |
| 6 | 放大因素：坍缩位（leaf×enum/union）无结构成员边界，成员边界只能从 `memberDocs` 键回填——若按值侧 kind 猜测会破坏第 6 步的逐字节稳定 | W1 对照用例：部分 doc fixture 当前单行、目标多行；纯无 doc fixture 必须单行 | 高（SA8 W1 已登记） |

## 9. 因果实验

1. **探针 v1–v4（已删除）**：对 20+ 种 M4 合法写法做 parse→evaluate→emit，实测 `memberDocs` 键、两树形态（`struct=leaf value=enum` / `struct=leaf value=union` / `struct=union value=union`）与当前输出，得到 §5 表的「输入在场 / 输出缺失」配对，并确认 fixture 源语法正确（doc 紧邻 `|` 之前才挂成员；doc 在 `|` 之后对非标记成员维持 E305——排除 fixture 错）。
2. **反证探针 v5（已删除）**：不修改生产实现，机械验证契约预期串与既有布局一致：
   - Family A（插入型：别名联合 / 全部内联位）——预期串剥掉 doc 行/内联 doc 块后，必须是当前输出子串（10/10 OK）；
   - Family B（重排型：坍缩位）——预期成员行按 ` | ` 回拼 + `export type X = ` 前缀 + 终止符必须等于当前单行输出行（6/6 OK）。
   - 合计 **16/16 OK**，证明契约文案只在既有成员文本上增加 doc 行 / 对既有单行成员序列重排，不存在不可达 whitespace 或文法漂移。
3. **切换闸门敏感对照**：同一模块内 `Status`（无 doc，单行）与 `DocStatus`（有 doc，多行）并存 → 断言逐位点独立；若实现按「值侧 kind 一律多行化」或「整模块联动」，负控 #6/#8 或正例 W1 用例必红。
4. **伪红排除**：所有红用例先断言 `derived.memberDocs` 键在场（或 fixture 预验证），并以 `parseVfsl`/`evaluate` 的 `ok` 失败信息携带 issues——实跑无一条红因 fixture/入口错误（§13）。

## 10. 影响面

- 唯一生产面：`packages/vfsl-codegen/src/emitter.ts`（`EmitTables` 接线 `derived.memberDocs`；`emitAlias` 坍缩区别名多行；`emitUnionBodyMembers`/`emitInner`/`emitNode` 成员前缀；复用 `docs.ts` 的 `tsdocLines` 逐字渲染）；不改 `cli.ts`/`collect.ts`（`collectProjection` 已透传完整 derived）。
- 不触：`packages/vfsl`（含 `resolve-schema-at-path.ts`=#308）、`packages/vfsl-protocol`、v1-spec / schema-authoring-guide（#309）、CLI 参数面。
- 类型面：成员 doc 是注释，`VfslPathMap` 增广体、`PathSchema` 外壳、`PathKind` 尾参零变化（契约含孤立 tsc 零诊断用例兜底）。
- 消费方：生成物的 hover/生成文档/AI 读码获得逐成员语义；无 doc schema 的消费方零字节变化。

## 11. 排除的假设

| 假设 | 判定 | 依据 |
|---|---|---|
| derived `memberDocs` 未收集/条件稀疏实现缺失 | 排除 | 实测键在场（§5）；#306 已并（PR #313） |
| fixture 源语法不合法导致红 | 排除 | M4 合法写法实测 parse/evaluate ok；E305 仅出现在「doc 在 `\|` 之后」的非标记成员（已用作反例理解） |
| semicolonFree 模式已发射成员 doc | 排除 | semicolonFree 实测输出同样零 doc 字节 |
| YPlainArray / YXmlFragment 应发射（其他实现已做） | 排除 | ADR 决策 6 末段明文无发射位；负控断言与规范同向 |
| 存量 `generate --check` 已过期（红因环境） | 排除 | 契约加入前后均 exit 0 |
| 测试入口不被仓库发现 | 排除 | vitest include 命中（9 文件）、包 tsconfig include `test/**/*.ts`、包 typecheck exit 0（§14） |
| 坍缩位「无 doc 也转多行」 | 排除（作为负控） | 无 doc 金样本单行断言 + 存量 domain 逐字节相等 |

## 12. 验收契约与测试路径

测试路径：`packages/vfsl-codegen/test/generate-union-member-docs.test.ts`（vitest，`packages/*/test/**/*.test.ts` 命中）。

### 12.1 契约总表

| # | 位点 | 最小输入 | 可观察断言（目标） | 旧实现 | 目标实现 |
|---|---|---|---|---|---|
| C1 | 别名判别联合（map 成员） | `Entity = /** d0 */ \| { … } /** d1 */ \| { … }` | doc 行 `  /**  d  */` 位于对应 `  \| ` 行上方 | 红（无 doc 行） | 绿 |
| C2 | 别名联合（ref 成员） | `U = /** d0 */ A /** d1 */ \| B` | 同上，成员文本 `PathSchema<A, 'map'>` 不变 | 红 | 绿 |
| C3 | 别名枚举坍缩位 | `Status = /** d0 */ \| "draft" …` | `export type Status =` 换行 + `  \| 'draft'` 逐成员（成员文本 = 单行形态逐段） | 红（单行无 doc） | 绿 |
| C4 | 别名标量联合坍缩位 | `Maybe = /** d0 */ string /** d1 */ \| null` | 同上（`  \| string` / `  \| null`） | 红 | 绿 |
| C5 | 内联联合（字段/数组元素位） | `u: /** d0 */ A /** d1 */ \| B`、`YArray</** d */ "a" …>` | `PathSchema</** d0 */ M0 \| /** d1 */ M1, kind>` 行内前置，`\|` join 文法不变 | 红 | 绿 |
| C6 | 内联枚举/标量联合（字段位） | `s: /** d0 */ "draft" …`、`v: /** d0 */ string …` | 同行内前置 | 红 | 绿 |
| C7 | 多 doc 成员（W2） | 同成员 2 条 doc | 块位：逐块逐行叠加；行内位：逐块单空格串联；两次发射逐字节一致 | 红 | 绿 |
| C8 | semicolonFree 同布局 | 上述任一位点 | doc 行/前缀位置不变、全文零分号、无行尾空格 | 红 | 绿 |
| C9 | 无发射位（负控） | `YPlainArray<…>` / `YXmlFragment<{…}>` 内 M4 | derived 键在场，生成物零 doc 字节 | 绿 | **保持绿** |
| C10 | 无 doc 逐字节不变（负控） | 无 M4 的联合/枚举/内联 fixture + 存量 domain | 与 HEAD 金样本 / 仓内 `generated.ts` 逐字节相同 | 绿 | **保持绿** |
| C11 | CLI 端到端 | 临时 domain（含别名枚举 + 别名联合 doc） | `pnpm generate` 写盘含 doc 文案；同格式 `--check` exit 0；semicolonFree 同闭 | 红（写盘无 doc） | 绿 |
| C12 | 类型面 | 带 doc 生成物 | 孤立 program `preEmitDiagnostics` 为空 | 红（前置 doc 在场断言） | 绿 |

### 12.2 契约决策 1（W1，SA6 钉死）

**多行切换判据 = 该位点 `<member N>` 键在 derived `memberDocs` 表中存在非空条目**，N 覆盖该联合值侧成员序号（`emitAlias` 用别名名 + `.<member N>`；内联位用完整语法路径 + `.<member N>`）。判据：

- 不按值侧 kind / 成员数量推测；坍缩族（enum 字面量联合、标量联合）与未坍缩族同判据；
- 按位点独立：同模块内有 doc 位点多行、无 doc 位点保持既有单行（逐字节不变）；
- 部分成员有 doc → **全成员**多行逐行，仅在有 doc 的成员行上方/前缀处出现 doc；
- 整键缺席（`derived.memberDocs === undefined`，含 M3 优先的标记联合位）→ 永不切换。

### 12.3 契约决策 2（W2，SA6 钉死）

- **块位**（发射位 1/2）：成员 doc 每条一块，按源序逐行叠加于成员行（`  | ` 行）上方，缩进与 `|` 列对齐（2 空格基准）；多行 doc 体经 `tsdocLines` 逐字保留（默认模式 `/** ` 行尾空格保留，semicolonFree 剥该空格）。
- **行内位**（发射位 3/4）：每条 doc 一块、按源序以**单个空格**串联，紧跟成员起点（`/** d */ Member`）；不引入换行、不改变 `| ` join 文法。
- 确定性：同一 derived 输入两次发射逐字节一致；表遍历按声明序。

### 12.4 验证门（实现完成后必须全部通过）

| 门 | 命令 | 当前（契约在树、实现未做） |
|---|---|---|
| 包测试（含新契约 33 例） | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl-codegen`（或根 `pnpm test`，vitest 配置 typecheck 开启） | 9 文件 23F/72P，无类型错误（红为预期） |
| 包 typecheck | `pnpm --filter @nomicore/vfsl-codegen typecheck`（= `tsc -p packages/vfsl-codegen/tsconfig.json`，include `test/**/*.ts`） | exit 0 |
| 生成物新鲜 | `pnpm generate --check`（仓根；存量 domains 不报过期） | exit 0 |
| 根 typecheck | `pnpm typecheck`（14 tsconfig 串行） | exit 0 |
| 根测试 | `pnpm test`（全仓 vitest + `--typecheck`） | 未跑全仓（#307 范围外；SA7 收官应跑） |

**验收判据**：实现后 33/33 用例绿、包测试 95/95 绿、包与根 typecheck exit 0、`pnpm generate --check` exit 0，且 C9/C10 负控不因实现走样而红。

## 13. 红/绿证据

**红灯（23，全部 `AssertionError: … to contain …`，期望含成员 doc 文案、实际输出无）**：

- 发射位 1（3）：map 成员 doc 行；ref 成员 doc 行；semicolonFree 同布局。
- 发射位 2（4）：字面量枚举多行；标量联合坍缩位多行；部分 doc → 全成员多行；semicolonFree 同布局。
- 发射位 3/4（7）：内联 ref 联合；内联枚举；内联标量联合；内联 map 判别联合；数组元素位；内联部分 doc；内联 semicolonFree。
- W2（4）：多 doc 块位叠加；多 doc 行内串联；多行 doc 体默认模式；多行 doc 体 semicolonFree。
- 判据独立性（1）：同模块内有 doc 别名 `DocStatus` 独立多行。
- CLI（2）：默认格式写盘含 doc + `--check` 0；semicolonFree 写盘零分号含 doc + `--check --semicolon-free` 0。
- 类型面（2）：带 doc 生成物孤立 tsc 零诊断（默认 / semicolonFree）。

红灯诊断样本（红因 = 发射缺口，非 fixture/入口）：

```text
FAIL … 决策 6.2 … 字面量枚举：三成员含 doc …
- /**  状态  */
- export type Status =
-   /**  草稿  */
-   | 'draft'
+ export type Status = 'draft' | 'submitted' | 'archived';

FAIL … 决策 6.3/6.4 … 内联枚举 …
-     s: PathSchema</**  草稿  */ 'draft' | /**  已提交  */ 'submitted', 'leaf'>;
+     s: PathSchema<'draft' | 'submitted', 'leaf'>;
```

**绿灯（10）**：§6 全部负控（含存量 domain 逐字节相等与仓根 `generate --check` exit 0）。
**基线绿（既有 62 例）**：契约加入后仍全绿（95 = 62 旧 + 33 新；72 passed = 62 + 10 负控）。
**红灯可信性**：所有红用例在断言文案前先验证 fixture 的 `memberDocs` 键在场（或已在测试内断言键清单）；反证探针证明期望文案可达；实跑无一条红因 `测试前提失败`（parse/evaluate 异常）。

## 14. 测试入口证据

- vitest 配置 include `packages/*/test/**/*.test.ts` 命中新文件；实跑 `pnpm exec vitest run packages/vfsl-codegen` 报告 9 文件（原 8 + 新 1）。
- 包 tsconfig `include: ["src/**/*.ts", "test/**/*.ts"]` → `pnpm --filter @nomicore/vfsl-codegen typecheck` 编译新测试 exit 0（契约类型面不欠账）。
- 根 `pnpm test` = `NODE_OPTIONS=--conditions=nomicore-source vitest run --typecheck`，同一 include 面，新文件随之纳入。
- 测试用公共入口（`generateProjection` / `parseVfsl` / `evaluate`）与 CLI 子进程，无 skip/only/todo、无 env override、无 fallback、无源码字符串断言。

## 15. 未知与阻塞

- 无阻塞项。
- 风险登记：W2 的块位多行 doc 体精确字节（默认模式 `/** ` 后行尾空格）是 SA6 按 `tsdocLines` 既有语义钉死的契约选择；SA1 若设计不同的 doc 渲染语义，必须先修订本契约再实现（否则 SA3 会以红/绿错位收场）。
- W1 采用「memberDocs 条目在场」判据而非值侧 kind；SA1 设计需与此一致。
- 环境：本 worktree 已装依赖（`node_modules` 不入 git）；门禁环境若无依赖，SA7 需先 `pnpm install --frozen-lockfile`。

## 16. 临时诊断清理

- 删除：`packages/vfsl-codegen/probe-307.mts`、`packages/vfsl-codegen/probe-307b.mts`（诊断探针 v1–v5，含反证逻辑）；`ls packages/vfsl-codegen/` 确认仅剩 `AGENTS.md/package.json/README.md/src/test/tsconfig.json`。
- `git status --short` 仅显示新增契约测试与 Host 提供的 `wiki/raw/task_issue-307*.md`；**生产实现零改动**（无 emitter/src 变更）。
- 未启动常驻服务/端口；CLI 型用例的子进程均已结束（spawnSync 同步）；无 nohup/PID 文件/轮询 marker。

# SA4 静态验尸报告 — Parser JSDoc 原文捕获（issue #7）

**Date**: 2026-08-19
**Verdict**: **pass**（附 4 项非阻塞观察 + 动态审核重点清单交 SA7）

**评审对象**：SA3 commit `4584335`（+ 上下文链 SA6 `4179034`/`70db1ad`、SA1 `6234ad7`、SA2 `53c6b5b`）
**任务基线**：`4e7dfe2`（PR #12 依赖合并点，简报明言；`mabf.basebranch` 配置的分支 diff 含 #5 依赖工作，非本任务范围——见 O4）
**评审方法**：设计 R2（调度称 R3，SA2 N3 已登记映射）逐节对照 + SA2 R2 锚点清单逐项核对 + 6 个 src 文件逐行阅读 + 全量测试独立复跑 + 65 项动态探针（经公共入口 `parseVfsl`，临时 vitest 文件，跑完即删，零 worktree 残留）

---

## 审核结论

1. 设计一致性：✅ 一致（SA2 锚点清单 8 项全过；1 项设计文档措辞口径观察 O1，非实现缺陷）
2. 读写路径一致性：✅ 一致（doc 单向流 tokenizer pending → token.leadDocs → parser dangling/claim → semantic 候选 → IR docs，无分叉）
3. 静默失败：✅ 无（docTotal 不变量构造性排除 + E305 显式报错；65 项探针零「内部错误（意外异常）」命中）
4. 降级方案：✅ 安全（无降级路径；E100 资源上限消息如实区分「实现资源上限，非方言判定」）
5. 极端攻击：✅ 安全（深嵌套 T14 三档、交错嵌套、doc 挂靠全部非锚位记号、CRLF/non-BMP/星面边界、多错误聚合——全部按设计行为）
6. 错误处理：✅ 完整（全部失败路径收敛 `{ok:false, issues:[…]}` 恰 1 条；`parseVfsl` 不抛错承诺维持）
7. 架构评估：✅ 可行（零 FIXME/TODO/临时补丁；集中式记账把正确性收口单一 `next()`，优于枚举式）
8. 过度设计：✅ 精简（源码 +202 行 vs 设计预估 +225；每个机制映射一条被攻击验证过的设计条款；无防御不可能条件的代码）

---

## 1. Scope Creep Guard（§1.1）

**任务范围 diff**（`4e7dfe2..HEAD`，8 代码文件 + 4 wiki 档案）：

| 文件 | ALLOW LIST 依据 | 核对 |
|---|---|---|
| `packages/vfsl/src/tokenizer.ts` | §12 | ✅ doc 分类 + leadDocs，扫描循环推进逻辑逐字未动（diff 仅闭合分支加 `close = i`） |
| `packages/vfsl/src/parser.ts` | §12 | ✅ AST/记账/marker/深度预算 |
| `packages/vfsl/src/semantic.ts` | §12 | ✅ E305 候选 + walk + toIR |
| `packages/vfsl/src/ir.ts` | §12 | ✅ 类型增量 |
| `packages/vfsl/src/errors.ts` | §12 | ✅ E305 + 注册表注释 15 个 |
| `packages/vfsl/src/index.ts` | §12 | ✅ 编排适配（公共导出面不变） |
| `packages/vfsl/package.json` | §12/§15 | ✅ **仅 version 一行** 0.1.1→0.1.2（结构性字段未动，DENY 遵守） |
| `packages/vfsl/test/parse-vfsl-jsdoc.test.ts` | §12 `[SA6 owned]` | ✅ 由 SA6 自己的 commit `70db1ad` 落库，**SA3 commit 零触碰测试文件** |
| `wiki/raw/task_vfsl-jsdoc-capture{,_design,_dispatch,_sa2_review}.md` | 白名单 | ✅ |

**越界**：无。既有三测试文件（parse-vfsl / errors / r3-regression）不在 diff 中（§12 预测吻合）；`docs/vfsl/v1-spec.md`（DENY）未动；`.github/**`、`apps/**`、`tests/**` 未动。

**BLACKLIST**：committed diff 零命中。⚠️ 卫生警示见 O3（worktree 有未跟踪 `TASK.md` 与 `.mabf-bg/`，不得进未来 commit）。

## 2. 设计偏离审查（§1.2 + SA2 R2 红线思路 3 锚点清单逐项）

| # | 锚点 | 实证 |
|---|---|---|
| 1 | `claimDocs()` 恰三处 | ✅ M1 `parser.ts:201`、M2 `parser.ts:454`、M3 `parser.ts:349`；grep 全文件无第四处 |
| 2 | 记号消费无 `next()` 旁路 | ✅ `this.index += 1` 全文件唯一（`parser.ts:129`，即 `next()` 内）；generic-diag 平衡扫描经 `next()`（`:419`） |
| 3 | EOF 记账恰一处 | ✅ `parseModule` 循环出口 `parser.ts:192-194`（peek eof → push leadDocs → break） |
| 4 | `MAX_TYPE_DEPTH = 100` 且无第二深度计数器 | ✅ `parser.ts:23`；唯一 `depth` 字段（`:104`）；恰两个守卫入口（marker 分支 `:350-358`、parseObjectType `:436-444`），`try/finally` 回退、超限 throw 在 try 外（=设计 §4.3「抛出即全线 unwind，无需回退」逐字）；generic-diag 的 `angleDepth` 是循环局部计数器非递归预算 |
| 5 | `parser.ts:9-11` 头注释改「两个入口」 | ✅ `:9-15` 按设计 §4.6 给定文本落库 |
| 6 | `errors.ts` 注册表注释 15 个 + 延后清单改写 | ✅ 「15 个，E304/E306/E307/E309 延后」（§9.1/§12 要求逐字） |
| 7 | 集中式记账 + docTotal 不变量 | ✅ `next()` 内记账（`:133-136`）、`docTotal` 构造时一次算好（`:115`）、`parseModule` 返回前 assert（`:212-214`）、plain Error → index.ts 顶层兜底（`:42-51`） |
| 8 | M3 同步性 | ✅ parsePrimaryType `:302` 消费 → `case 'ident'` 直通 parseIdentType，分支前全部 if/peek 零 `next()`，`claimDocs()` 于 marker 分支顶 |

**行为面**（§1.2 行为表）：五标记 `<` 形态 ok:true + IR marker 节点 ✅（探针 M-five/M-ir-shape）；裸 `YMap`、`Record<K,V>`、`string & Pattern<…>`、`T[]` 全部维持 E100 ✅（探针四项——**#6 领地零偷做**，E304/E307/E309 无任何子集实现，grep 无对应分支）；深度超限 E100 资源口径三态消息原文 ✅。

**IR 形状**（§7）：`docs: string[]` 必填上 alias/field/marker ✅；属性插入序 kind→name→[optional]→docs→type 机器验证（`Object.keys` 序列化比对）✅；marker 单节点 + name 源拼写 ✅。

**E305 相位**（§5.1）：语义相位候选 + min-position 聚合 ✅；相位判别 T3（E301@(1,10) 胜出）/T4（E101@(1,36) 胜出，模块未全量解析 E305 不浮出）探针双确认 ✅。

**SA6 用例 1 断言回炉 diff**（SA2 流程门 N1）：commit `70db1ad` 对测试文件的改动**严格限于 §7.4(b) 授权的五条断言比对口径**（转义形 `e1/e2`），`DOC_ASSET_1/2` 常量与其余六用例逐字未动 ✅。回炉先于 SA3（dispatch #7 → #8 时序）✅。

## 3. 测试质量与触发性（§1.3/§1.4/§1.7）

- **§1.7 源码 grep 断言禁令**：零命中（整个 test 目录无 `readFileSync`/fs import；全部断言驱动 `parseVfsl` 运行时行为）✅。
- **vitest 触发性**：根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖新文件；`.github/workflows/ci.yml` Typecheck（`pnpm typecheck`）+ Test（`pnpm test`）两步触发 ✅（本任务无 .spec.ts，§1.3 N/A）。
- **既有断言零破坏**：三文件不在任务 diff；44/44 全绿含 r3-regression 星面四用例与 E203 锚点用例 ✅。
- **测试所有权边界**：SA3 commit 只动 7 个 src/package 文件，零测试文件 ✅。

## 4. 契约改动连锁（§1.6）

内部函数签名改动（`parseModule` 返回形状、`parseTypeAlias` 加参、`analyze` 加参、`tokenize` 不变）：grep 全仓 caller——`parseModule`/`analyze`/`tokenize` 仅 `index.ts:33-35` 调用，`parseTypeAlias` 仅 `parser.ts:202` 调用；全部位于 `parseVfsl` 顶层 try/catch 内，无未捕获 throw 路径；公共接缝（签名/返回形状/不抛错/导出面）未动 ✅。

## 5. SA4 独立证据运行

| 运行 | 结果 |
|---|---|
| 全量测试 `pnpm test`（独立进程） | **44/44 通过**（4 文件：11+19+7+7），与总控亲验一致 |
| `pnpm typecheck` | **exit 0**（初次 exit 2 系 SA4 自己的临时探针文件混入 strict 检查所致，删除后复跑通过——非 SA3 代码问题） |
| **SA4 动态探针 65 项**（公共入口 `parseVfsl`，临时 vitest 文件用后即删） | **65/65 通过** |

探针覆盖（全部通过）：
- **设计 §5.3 示例表全量 13 行**（含 S5.3-11 聚合口径修正——见 O1）。
- **§10 T1~T15 未落库构想全部行为**：T1(1,10)/T2(1,23)/T3(E301 胜)/T4(E101 胜)/T5 E203(1,18)/T6 嵌套 ok/T7 E106(1,20)/T8 E100/T9 marker 连续 doc/T10 无 E304/**T11 E305(1,17)/T12 E305(1,6)/T13 E305(1,12)**（SA2 三大误实现检测器全绿）/T14 N=100 ok+JSON 往返、N=101/5000/20000 全部 E100@(1,510) 且**零「内部错误」零爆栈**/T15 N=100 ok+往返、N=101 E100@(1,310)。
- **统一预算交错封顶**：60 marker+60 对象=120 层 → E100（非爆栈）；100 层交错 → ok:true；对象 50+marker 51 → 锚第 51 个 YMap Ident@(1,410)——独立双预算的违标形态被统一计数器正确封死。
- **SA4 自构攻击 20+ 形态**：doc 挂 `>`/`?`/`:`/`,`/分隔符/EOF/generic-diag `<` 的 E305 归属；多悬空 min-position；E305 vs E301/E302/E101/E105/E203 相位与聚合交互；未闭合第二条注释 E203 锚其起始(1,11)；CRLF/non-BMP/四星`/**** x */`→body `** x `/六星`/******/`→body `**`/`/** */`→body `" "` 逐字往返；「对象内 EOF 带 doc」「缺分号 EOF 带 doc」「doc 后词法错误」全部结构化 E100（无内部错误）；忽略型注释穿插不中断 4 条 doc 累积按序同挂。

## 6. 静默失败 / 错误处理 / 降级（§3/§4/§6）

- 本 issue 病灶（doc 静默丢弃）由**构造**排除：集中式记账使「枚举漏消费点」类失误不可能（任何被 `next()` 消费的记号其 leadDocs 默认入 dangling），docTotal 不变量作为第二道 loud 防线（命中即 throw → E100 内部错误——65 项探针零命中）。
- 全部分支（词法 error 记号、语法 VfslSyntaxError、语义候选、深度守卫、不变量）收敛 `{ok:false, issues:[1]}`；`parseVfsl` 不抛错（探针含 not.toThrow 语义的 try/catch 包装，零 THREW）。
- 无降级路径；无虚假降级（资源上限消息如实自述实现边界）。

## 7. 架构与过度设计（§7/§8）

- 零 FIXME/TODO/HACK、零 console/debugger 残留、零绕过架构约束的补丁。
- 源码 +202 行（设计估 +225），机制与设计条款一一映射，无「为将来需求」的抽象层；`depositedByLast`/`claimed`/`docTotal` 三计数器是不变量的最小会计。
- 变更半径：未触碰超出简报范围的模块。

---

## 非阻塞观察（不构成本次 reject，登记供后续处理）

| # | 级别 | 内容 | 建议处置 |
|---|---|---|---|
| **O1** | LOW（设计文档措辞） | 设计 §5.3 示例表行 `type A = Foo \| /** d */ number;` 写「E305」，但该输入含未声明引用 Foo——按 §5.1/§6.2 min-position 聚合（T3 同构先例），可观察胜者是 **E301@(1,10)**。实现按聚合语义走（探针确认），§5.3 行描述的是「doc 的归宿」而非「最终聚合影子」，两口径未区分 | SA1 下次修订时给该行补注（或改输入为已声明别名）；SA6/SA7 若落库此形态应锚 E301@(1,10) |
| **O2** | 测试覆盖缺口（设计自标非阻塞） | §10 T1~T15 红线构想**均未落库**（SA6 文件恰 7 用例）。SA4 探针证实当前行为全部正确，但 T11/T12/T13（误实现检测器）、T14/T15（深度预算双侧）、T3/T4（相位判别）、T5（`/**` 未闭合）**无任何已落库回归锁**——未来回归（如 #6 触碰 parser）无红灯拦截 | 建议 SA6 在 #6 动工前或收尾轮补落 T11~T15（最小集）；SA7 动态验证见下方清单 |
| **O3** | 卫生 | worktree 未跟踪 `TASK.md`（§1.1 5b BLACKLIST——PR #253 事故同型物）与 `.mabf-bg/`（MABF 运行日志）。committed diff 零命中故不 REJECT | 总控确保二者不进任何 commit（可加 .gitignore 或提交前清理） |
| **O4** | 记账 | `mabf.basebranch` 配置分支的 diff 含 #5 依赖工作（PR #12 合并），本任务真实基线为 `4e7dfe2`（简报明言）。与 SA2 N3 标签错位同族的编号漂移 | 后续 SA 引用 diff 范围时以 `4e7dfe2..HEAD` 锚定 |

---

## 动态审核重点（交 SA7）

（SA4 探针在本机环境已全绿；以下为 SA7 在 CI/真实运行环境需摘录证据的项）

1. **CI 触发证据**：`gh run view --log` 摘录本分支 commit 的 Test job 输出（44/44）与 Typecheck job 输出（exit 0）——SA4 本地复跑一致，CI 侧留档。
2. **T14 深嵌套真实栈余量**：N=5000/20000 的 `not.toThrow` + E100@(1,510) + 消息体不含「内部错误」——设计 §4.6 栈余量 23.4× 是保守基线推算，SA7 在 CI runner 栈配置下复核一次。
3. **N=100 marker IR JSON 往返**（`JSON.parse(JSON.stringify(module))` 深等）——序列化余量 11.1× 的实测面。
4. **O2 落库后**（若 SA6 补测）：T11~T15 的红→绿历史与 vitest 收集证据（`vitest.config.ts` include 覆盖）。
5. **E305 冻结面抽检**：用例 4 形态（`type A = string;\n/** 悬空 */` → E305@(2,1)）+ E305 消息前缀——已入 44 套件，CI 绿即证。

---

## R1 补遗：§1.4 vitest 触发性自检（2026-08-19，硬门禁 14 字面结论补录）

> 补遗缘由：R1 报告 §3 已含 vitest 触发性的实质审查（根 config include + workflow 步骤 + 全量复跑），但缺 SKILL §1.4 要求的「vitest 触发性自检」字面结论章节（硬门禁 14 的 grep 锚）。本节按 §1.4 门禁规则完整重跑并补录结论；既有章节零改动。

**触发条件**：任务 diff（`4e7dfe2..HEAD`）含 1 个新增 `*.test.ts` → 门禁适用（`.spec.ts` 零个，§1.3 维持 N/A，与 R1 §3 记载一致）。

**步骤 1 — 抽 test 文件与其 workspace package**：

| test 文件（任务 diff 内） | 落库 commit | 最近 package.json | workspace package |
|---|---|---|---|
| `packages/vfsl/test/parse-vfsl-jsdoc.test.ts` | `4179034`（SA6 红灯）+ `70db1ad`（SA6 断言回炉），均为任务链 SA6 commit | `packages/vfsl/package.json` | `@nomicore/vfsl`（`pnpm-workspace.yaml` `packages/*` 成员） |

**步骤 2 — 抽 CI vitest 调用范围**：
- 仓库唯一 workflow `.github/workflows/ci.yml`，唯一测试 job：`test`（matrix node 20/24），step `Test` → `pnpm test`（`ci.yml:39`）。
- 根 `package.json` `"test": "vitest run"` —— **根级裸调用，无 `--filter`/`--project`/`-r`**；全仓唯一 vitest 配置为根 `vitest.config.ts`（无 `vitest.workspace.ts`，无嵌套 config），include = `packages/*/test/**/*.test.ts`。
- 口径说明：SKILL §1.4 辅助命令的字面 grep（`pnpm.*--filter.*<pkg>.*vitest`）在本仓**零命中**——这不是「包未被覆盖」，而是本仓 CI 不使用 `--filter` 机制，覆盖面由根 config 的 include glob 决定。辅助命令明示「可按需调整」，故以门禁规则 2/3 的语义比对为准，本节如实登记该偏差而非套用会误报的参考脚本。

**步骤 3 — 范围比对**：`packages/vfsl/test/parse-vfsl-jsdoc.test.ts` 精确命中根 include glob `packages/*/test/**/*.test.ts` → `@nomicore/vfsl` 落在 `test` job 的 vitest 命令范围内（静态判定：覆盖）。

**步骤 4 — 运行时收集证据**（独立进程按 CI 原样命令复跑 `pnpm test`，2026-08-19）：

```text
 ✓ packages/vfsl/test/parse-vfsl-jsdoc.test.ts (7 tests) 8ms
 ✓ packages/vfsl/test/parse-vfsl.test.ts (11 tests) 9ms
 ✓ packages/vfsl/test/parse-vfsl-errors.test.ts (19 tests) 12ms
 ✓ packages/vfsl/test/parse-vfsl-r3-regression.test.ts (7 tests) 6ms
 Test Files  4 passed (4) | Tests  44 passed (44) | exit=0
```

目标文件被根 `vitest run` **实际收集并执行**（7/7）——覆盖不是纸面推断，是可复现事实。

**触发路径备注**：workflow `on: pull_request`（任意分支）+ `push: branches: [main]`；分支尚未 push，CI run log 待总控 push/建 PR 后摘录——SA7 报告「清单 1」已如实登记该环境阻塞。此为运行留档事项，非本门禁范围（本门禁判「workspace package 是否在 vitest 命令范围内」，已判覆盖）。

**结论行**：`all-vitest-packages-triggered`

**复核处置**：本轮补遗复核（§1.4 四步 + 独立进程复跑）未发现新缺陷 → **Verdict 维持 pass**（文件头部 Verdict 行不变）。

# SA4 实现静态审查 — issue #307（vfsl-codegen 联合成员 doc 四发射位）

- 派发：`sa-00aa941c-e349-4ab0-8cb9-9c1152d7bae1`（role `mabf-sa4`，phase `implementation-review`，iteration 0）
- 被审对象：`wiki/raw/task_issue-307_sa3_impl.md`（SA3，iteration 0，工作树对 HEAD `4d4208b` 的未提交改动）
- 审查日期：2026-09-11
- 审查方法：独立实读全部改动源码与上下文（emitter.ts / docs.ts / valuetype.ts 全文 + `git diff` 逐 hunk；derived.ts / evaluate.ts walkDocs；ADR 0019 决策 6 原文；契约测试 638 行全文；vitest.config.ts、根/包 package.json、tsconfig、tsc-helper.ts、ci-test-shard.mjs、cli.ts、collect.ts、index.ts、.gitignore），只读 git 命令核对范围（status -uall / diff --stat / rev-parse / stash list）。不采信 SA3 自述，验证命令与断言逐条对源码复核。SA4 未运行测试、未启动服务、未创建进程。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-307.md`（任务简报，Issue 正文 + AC1–AC4，`## Comments` 空） | 实读 |
| `wiki/raw/task_issue-307_design.md`（SA1 批准设计，D1–D8 / §11 ALLOW-DENY / §12 验证门） | 实读（审查基准） |
| `wiki/raw/task_issue-307_sa2_review.md`（SA2 `approve`，O1/O2/O3 非阻断精化） | 实读（增量要求基准） |
| `wiki/raw/task_issue-307_sa6_contract.md`（approved 契约，33 例 + W1/W2 钉死值 + §12.4 验证门） | 实读（验收真相基准） |
| `wiki/raw/task_issue-307_sa3_impl.md`（SA3 实现报告，被审对象） | 实读 |
| `wiki/raw/task_issue-307_conflict_report.md`（SA8 `clear`，W1/W2/B1–B3） | 实读 |
| `packages/vfsl-codegen/src/emitter.ts`（546 行全文 + diff 逐 hunk） | 实读复核 |
| `packages/vfsl-codegen/src/docs.ts`（32 行全文）、`src/valuetype.ts`（85 行全文） | 实读复核 |
| `packages/vfsl-codegen/src/{index,collect,cli}.ts`、`test/tsc-helper.ts` | 实读复核（未改动确认 + 入口真实性） |
| `packages/vfsl-codegen/test/generate-union-member-docs.test.ts`（契约测试 638 行） | 实读（质量审查 + 完整性核对） |
| `packages/vfsl/src/derived.ts`（DerivedSchema 八键）、`src/evaluate.ts`（collectDocs/walkDocs/guardMemberDocs） | 实读复核（键空间对齐） |
| `docs/adr/0019-vfsl-union-member-docs.md` 决策 6 全文 | 实读（规范基准） |
| `packages/vfsl-codegen/AGENTS.md`（本包契约）、根 `AGENTS.md`、根/包 `package.json`、`vitest.config.ts`、`tsconfig.json`、`.github/workflows/ci.yml`、`scripts/ci-test-shard.mjs`、`.gitignore` | 实读复核 |
| git 只读状态（HEAD `4d4208b`、status -uall、diff --stat 3 文件 +120/−14、stash 空、索引无 staged） | 实读复核 |
| `wiki/raw/task_issue-307_relevant_decisions.md`、`…_sa4_review.md`（前序）、`…_sa7_report.md`、`…_design_conflict_report.md` | 不存在（iteration 0，无返工/冲突复查输入） |

## 2. Verdict

**`approve`**

无 BLOCKER / MAJOR finding。核心结论（对应派发关注点，全部经源码独立复核）：

1. **四发射位完整且位点正确**。doc 查找点全集封闭在 4 处：`emitAlias` union×union 行装配（emitter.ts L232-238，D2）、`emitAlias` 坍缩闸门 + 多行装配（L245-259，D3）、`emitInner` case `'union'` 前缀 map（L331-333，D4）、`emitInner` case `'leaf'` enum/union 分支（L342-346，D5）。grep 全包证实 `memberDocsAt`/`memberBlock`/`memberInlinePrefix` 调用点恰为这 4 处渲染 + 1 处闸门探测（L247），无第五位点、无遗漏路径（case `'ref'`/`'plain'`/`'xml-fragment'`/`'map'`/`'array'` 逐 case 枚举核对：ref 为按名终态、plain/xml 为无发射位、map/array 递归进入 emitNode/emitInner 后仍收敛到 D4/D5）。
2. **契约保持**。契约测试 sha256 `b9c87b9ea0360f04362214a2eaeb769f5d03ec17ac11e158742edf1676189e64` 与 SA3 报告记录值逐字符一致；mtime 14:09:56 早于三个 src 文件的实现改动（14:34–14:35），其余 8 个既有测试文件与 tsc-helper.ts mtime 均为 13:54（checkout 时刻，零触碰）。契约未被实现侧改写。
3. **逐字节稳定性（静态代数证明成立）**。四条改动路径在无 doc 输入下与 HEAD 表达式逐字节等价：D2 的 `['  | m', …].join('\n')` ≡ 既有 `` `  | ${members.join('\n  | ')}` ``（纯装配重构，成员文本生成零改动）；D4 的空前缀 map + join ≡ 既有 join；D5/D6 的 `projectUnionMembers(...).join(' | ')` 是 `projectValue` enum/union 两 case 既有表达式的保形分解（valuetype.ts L29-32 与 L70-74 逐字比对）；D7 的 `tsdocBlock` 是 docs.ts 既有单块表达式原样搬移。闸门闭合时 fall-through 返回语句与 HEAD 逐字相同（L260）。
4. **无发射位边界（结构性）**。`case 'plain'` 仍走无 doc 感知的 `projectValue(value.element)`（L323，projectValue 未获任何查表/路径参数）；`case 'xml-fragment'` 仍为不透明 `'string'`（L351）；M3 优先位由条件稀疏表整键缺席闸死（`tables.memberDocs?.[…]` → undefined）。负控 #1/#2/#3 的「键在场 + 字节缺席」配对与代码路径一一对应。
5. **W1 判据与 SA6 §12.2 钉死值一致**。闸门 = `node.kind === 'leaf' && memberCount > 0` 时对 N ∈ [0, 值侧成员数) 探 `Name.<member N>` 键存在**非空**条目（`memberDocsAt` 将空数组视同缺席——SA2 O1 精化落实）；不按值侧 kind/成员数量切换布局；按位点独立（只读本别名键）；部分 doc → 全成员多行且仅 doc 成员带 doc 行（`if (memberDoc !== '') lines.push`）；整键缺席永不切换。值侧非 enum/union → `memberCount = 0` 恒闭合。
6. **semicolonFree 同布局**。`term = ''`、doc 块缩进恒 `'  '`、`tsdocBlock` 沿用「多行体 `/**` 后不垫空格」既有分支；行内前缀经 `tsdocInline(docs, tables)` 传递同一开关；成员对象字面量多行化时前缀仍在 `{` 前。契约 C8 组 + CLI 双格式闭环断言锚定。
7. **文件范围合规**。见 §6——ALLOW 3 个 src 文件之外零生产改动，DENY 全部未触碰，无 git 操作。

SA2 O1/O2 两条非阻断精化均已落实（O1：`docs !== undefined && docs.length > 0`；O2：闸门条件含 `node.kind === 'leaf'`，非 leaf 结构形（含手造异形配对）闸门恒闭合、继续走既有 desync 路径）；O3 维持登记无动作。SA3 声称的验证证据与真实入口一致（§9），全量实跑属 SA7 收官门（§11 转动态验证项，不构成静态阻断）。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue #307 AC1a：别名判别联合成员 doc 以 `  \| ` 行为基准上一行发射 | emitter.ts L229-238：`emitUnionBodyMembers` 逐成员 + `memberBlock(tables, name, i, '  ')` 块位，doc 行在 `  \| ` 行上方、缩进与 `\|` 列对齐；键 = `${name}.<member ${i}>`（与 walkDocs evaluate.ts L405-407 文法一致） | 落实（契约 C1 组 3 例锚定） |
| Issue #307 AC1b：别名枚举有成员 doc 时转多行（默认 + semicolonFree 两模式） | emitter.ts L240-259：W1 闸门 + `projectUnionMembers` 分段 + 逐成员 `  \| ` 行 + doc 块；`term` 随模式、doc 缩进恒 `  ` | 落实（契约 C3/C4 组 4 例锚定） |
| Issue #307 AC2：内联联合/枚举成员 doc 行内前置 | emitter.ts L331-333（case `'union'`，一处接线经 emitNode 覆盖字段/嵌套对象/`.<item>`/`<key>` 位）与 L342-346（case `'leaf'` enum/union）；前缀 = `${tsdocInline(docs, tables)} ` 紧跟成员起点，`\|` join 文法不变 | 落实（契约 C5/C6 组 7 例锚定） |
| Issue #307 AC3a：无成员 doc 生成物逐字节不变 | 条件稀疏闸门（`memberDocs === undefined` → 四路径全走既有表达式）+ 四处保形重构（§2 结论 3 代数论证）+ 既有 62 例金样本 + 契约负控 #4–#8 | 落实（静态证明成立；运行时绿由 SA3 报告 + SA7 复跑兜底） |
| Issue #307 AC3b：存量 domains `pnpm generate --check` 不报过期 | `domains/**` 零改动（git status 证实）；vfs3-assets 无 M4 文本 → `derived.memberDocs === undefined`（负控 #9 断言）→ 生成物与仓内 `generated.ts` 逐字节相等；CI `pnpm generate --check` 门在 ci.yml L147 | 落实 |
| Issue #307 AC4：包测试/typecheck/根 typecheck 绿 | 验证门入口全部真实：根 `pnpm test`（vitest include `packages/*/test/**/*.test.ts` 命中新契约）、`pnpm --filter @nomicore/vfsl-codegen typecheck`（tsconfig include `test/**/*.ts`）、根 `pnpm typecheck`（14 tsconfig 串行）、`pnpm generate --check` | 入口落实；SA3 报告全绿（95/95、3350/3350、双 typecheck、--check exit 0）。SA4 不运行测试，实跑结果采信面见 §11 动态验证项 |
| Issue 正文末句：YPlainArray / YXmlFragment 内成员 doc 无发射位 | §2 结论 4：两条代码路径零 doc 查找点，结构性保证非特判丢弃 | 落实（契约负控 #1/#2） |
| SA6 §12.2 W1 钉死值（条目在场判据、位点独立、部分 doc 全多行、整键缺席永不切换） | §2 结论 5 逐条比对 | 逐字落实，无第二种解释 |
| SA6 §12.3 W2 钉死值（块位逐块逐行叠加 2 空格基准；行内位逐块单空格串联紧跟成员起点；双发一致） | 块位 = `tsdocLines(memberDocsAt(...), '  ', tables)`（join `\n`）；行内位 = `tsdocInline`（join `' '`）+ 尾单空格（L441-444）；表不遍历、循环按声明序数组 | 逐字落实（契约 W2 组 4 例含双发一致断言锚定） |
| SA6 §15 风险登记：SA1/SA3 不同 doc 渲染语义须先修订契约 | 实现渲染全部来自既有 `tsdocLines` 语义搬移（`tsdocBlock`）+ 同语义行内变体，零新规范化 | 无偏离，未触发契约修订义务 |
| SA2 O1（MINOR）：空 memberDocs 条目应视同缺席 | `memberDocsAt` L430-433：`docs !== undefined && docs.length > 0 ? docs : undefined`——空条目不开闸门、不产行内前缀（无孤立单空格） | 落实（合法链路本不可达——walkDocs L406 只收 `length > 0` 条目；实现使钉死值「非空条目」字面成立） |
| SA2 O2（MINOR）：畸形非 leaf 坍缩别名保留既有 desync | 闸门条件 L246 `node.kind === 'leaf' && memberCount > 0`——结构 union×值 enum 等异形配对闸门恒闭合 → `emitInner` case `'union'` → desync throw（与 HEAD 同路径同异常） | 落实（§9 错误语义零变化对畸形输入亦成立） |
| SA2 O3 / 设计 R3：行内位多行 doc 体为已定义语义 | `tsdocInline` 逐字内嵌（`tsdocBlock` 同源），无重排 | 维持登记，无本任务动作（正确） |
| Owner 评论 | Issue 反馈 REST 快照无评论（none applicable），简报 `## Comments` 空 | 无遗漏（无输入即无义务） |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1 EmitTables 第四槽（条件）+ `generateProjection` 接线 + 查键 only 三助手 | emitter.ts L127-132（槽 + 注释）、L159-160（逐字引用 `derived.memberDocs`）、L424-444（`memberDocsAt`/`memberBlock`/`memberInlinePrefix`） | 与设计逐条一致：只按 `${path}.<member ${i}>` 索引查键、绝不枚举表；「七槽→八槽」注释更新（DerivedSchema 实为 8 键、memberDocs 第八键居末，derived.ts L91 证实注释准确） | 无 |
| D2 发射位 1 块位装配（成员文本获取不变） | emitter.ts L229-238：`emitUnionBodyMembers` 调用逐字未改（diff 证实签名/参数/缩进策略原样），行装配改逐成员 forEach | 无 doc 时 `lines.join('\n')` 与既有表达式代数等价（逐字节）；有 doc 时块位在 `  \| ` 上方 | 无 |
| D3 发射位 2 W1 闸门 + 多行布局（含 O2 精化） | emitter.ts L240-259 | 判据/独立性/部分 doc/整键缺席四条钉死值全落实；`memberCount` 按值侧 kind 仅界定索引区间与可达性（leaf×enum/union 是唯一合法坍缩配对），非布局依据；成员文本 = `projectUnionMembers` 分段（与单行形态严格同源） | 无 |
| D4 发射位 3 行内前置 | emitter.ts L331-333 | 一行式 map + join；desync 守卫、`common` 同形裁决先于 doc 渲染（顺序不变）；ref/map×object/去外壳三形态统一前置 | 无 |
| D5 发射位 4 行内前置（scalar/pattern 原样） | emitter.ts L342-347 | enum/union 分段 + 前缀；scalar/pattern 维持 `projectValue`；无需布局闸门（内联恒单行）——与设计论证一致 | 无 |
| D6 `projectUnionMembers` 单一真相源 + `projectValue` 保形重构 | valuetype.ts L29-32（两 case 合并 fall-through 到 `projectUnionMembers(...).join(' \| ')`）、L65-77（新助手，包内导出、非联合形响亮 throw） | 分解的是同一表达式，字节不变；stack 语义保持（emitInner 旧调用本就不传 stack，默认 `[]`，两向一致）；不进 `index.ts` 公共面 | 无 |
| D7 `tsdocBlock` 抽取 + `tsdocInline` | docs.ts L8-15（tsdocLines 组合）、L22-25（tsdocInline）、L28-32（tsdocBlock）；文件头「三槽→四槽」注释 | 既有表达式原样搬移（早退保留）；行内变体 join `' '` + 零缩进；`opts` 沿用 `tables` 结构兼容传法；不进公共面 | 无 |
| D8 无发射位边界（结构性） | §2 结论 4；`emitNode`/`emitObjectMembers`/`emitInterfaceMember` 零改动（diff 证实） | doc 查找点全集封闭于 D2–D5，无 `if (isPlain) skip` 特判 | 无 |
| 设计 §8「无公共接口变化、无状态机」 | `generateProjection` 签名/返回/选项零改动；`index.ts` 未动（mtime 13:54 + 不在 diff）；纯函数无状态/缓存/IO | 一致 | 无 |
| 设计 §11 弹性条款（允许收拢 D6/D7 进 emitter） | 未行使——三文件分工与 ALLOW 表逐行对应 | 合规（收拢是允许而非要求） | 无 |

设计明确但实现缺失：无。实现必要偏离设计：无（O1/O2 为 SA2 批准的增量精化，SA3 报告已如实登记为「相对设计的唯一增量」）。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 成员 doc 发射 | codegen 纯发射器（ADR 0005 D3） | emitter.ts 四位点 | 正确 |
| 成员边界信息 | derived `memberDocs` 键回填（ADR 0019 决策 6.2） | `memberDocsAt` 索引查键 only | 正确（零重推导；`structureOf`/值折叠等语义判定未被触碰） |
| doc 块渲染 | docs.ts | `tsdocBlock` 单源双变体 | 正确（搬移而非复制） |
| 值分段投影 | valuetype.ts | `projectUnionMembers` | 正确（与单行形态同源） |
| 收集/解析 | packages/vfsl（#306 冻结） | 零改动 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| docs 表消费 | EmitTables 三槽按键查找 + tsdocLines 渲染 | 第四槽同构（按键查找 + 同一渲染器族） | 一致 | 同协议扩展，无平行通道 |
| 字段 doc 行内/块位双模式（#222） | emitObjectMembers 双模式 + `/**` 后不垫空格 | `tsdocBlock` 复用同一分支表达式 | 一致 | semicolonFree 语义单源 |
| `<member N>` 键文法 | `emitUnionBodyMembers` L405 内联构造 / walkDocs L407 | `memberDocsAt` 同文法 | 一致 | 键空间逐位对齐（别名名 / 完整语法路径 × `.<member i>`） |
| 包内导出先例 | `projectValue` 自 valuetype.ts 导出供 emitter 导入 | `projectUnionMembers`/`tsdocInline` 同款 | 一致 | 公共面仍仅 `generateProjection` + 选项类型（index.ts 实读） |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 联合成员边界/序号 | derived `memberDocs` 键 | 无第二份 | 无（设计 A4/A5 否决路径均未采用） |
| 成员文本分段 | `projectUnionMembers` | 多行布局逐段与单行 join 同源 | 结构性消除 |
| doc 块渲染 | `tsdocBlock` | tsdocLines/tsdocInline 共用 | 无 |
| doc 查键 | `memberDocsAt` 单点 | 四发射位共用 | 无 |

### 生命周期对称性

纯函数、无状态、无 IO、无 register/dispose 面——不适用；CLI 文件系统关注点保持在边缘（cli.ts/collect.ts 零改动），包 AGENTS 边界维持。

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二套 doc 渲染器 | docs.ts tsdocLines | 无（tsdocBlock 抽取自既有表达式） | 无平行 |
| 第二套成员分段 | projectValue enum/union case | 无（D6 分解该两 case，非另写） | 无平行 |
| 表驱动遍历/第二状态 | 无 | 无（声明序索引循环） | 无平行 |
| 新错误类/降级路径 | 既有命名化异常族 | 无（唯一新 throw = 内部误用守卫，正常输入不可达） | 无平行 |

## 6. 文件范围审查

只读 git 证据：`git status --porcelain -uall` 恰为 3 个 modified src 文件 + 7 个未跟踪文件（契约测试 + 6 个 wiki 产物）；`git diff --stat` = 3 文件 +120/−14；HEAD 仍 `4d4208b`（无新提交）；stash 空；索引无 staged 内容（无 add/commit/push）。

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/vfsl-codegen/src/emitter.ts` | ALLOW 行 1 | D1–D5 + 三助手 + 注释更新（七槽→八槽、发射位注释） | 合规（改动面逐 hunk 落在 ALLOW 描述内） |
| `packages/vfsl-codegen/src/docs.ts` | ALLOW 行 2 | D7：tsdocBlock 抽取 + tsdocInline + 头注释四槽 | 合规 |
| `packages/vfsl-codegen/src/valuetype.ts` | ALLOW 行 3 | D6：projectUnionMembers + projectValue 保形重构 | 合规 |
| `packages/vfsl-codegen/test/generate-union-member-docs.test.ts`（未跟踪，非本次改动） | DENY 行 1 | SA6 契约（Host 预置） | 未触碰（sha256/mtime 证据见 §2 结论 2） |
| `wiki/raw/task_issue-307_sa3_impl.md`（未跟踪） | 非生产路径；SA3 固定产物位（与 task_249/238 等先例同惯例） | 实现报告 | 合规（不在 DENY；DENY 的三个 wiki 输入未触碰） |
| 其余 Host/SA wiki 产物（未跟踪） | Host/上游只读输入 | 管线产物 | 未触碰 |

DENY 核对（全部未触碰，mtime 13:54 + 不在 git status）：契约测试与其余 8 测试文件 + tsc-helper.ts、`packages/vfsl/**`（含 `resolve-schema-at-path.ts`=#308）、`docs/vfsl/**`（#309）、`cli.ts`/`collect.ts`/`index.ts`/`header.ts`/`protocol-surface.ts`、`domains/**`、`packages/vfsl-protocol/**` 及其余 packages/apps。`.scratch/`、`artifacts/`、`tests/`、`REPORT.md` 为 HEAD 既有 tracked 文件且零改动（`git ls-files` 证实为存量，非本任务引入）；`packages/vfsl-codegen/` 目录无探针残留（实 ls 仅 AGENTS/package/README/src/test/tsconfig/node_modules）。

ALLOW 中未修改路径：无（三 src 全部按预期修改）。范围越界：无。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `generateProjection(derived, opts?)` 公共签名/返回 | `collect.ts` L91（CLI 唯一编排）、契约测试、下游消费仓 | 签名零变化；`derived.memberDocs` 随对象自然到达（L159-160 逐字引用） | 无 | 无 |
| `GenerateProjectionOptions.semicolonFree` | cli.ts 参数面（`--semicolon-free` 实读在场）、生成与 `--check` 同取值 | 选项面零改动；两模式各自闭环（契约 C11 双格式断言） | 无 | 无 |
| `index.ts` 公共导出面 | 外部消费方（含 typed Namespace 投影消费） | 仅 `generateProjection` + 选项类型；`tsdocInline`/`projectUnionMembers` 不外泄 | 无 | 无 |
| 生成物字节面（`generated.ts` 入仓 + CI regen-diff） | `pnpm generate --check`、CI L147、vfs3-assets | 无 M4 输入域逐字节不变（§3 AC3b）；有 doc 域按契约新增注释字节，`--check` 同门幂等 | 无 | 无 |
| 类型形状（VfslPathMap 增广体/PathSchema 外壳/PathKind 尾参） | tsc 消费方、根 typecheck 14 tsconfig | 成员 doc 为注释字节，类型形状零变化（契约 C12 孤立 program `preEmitDiagnostics` 空断言锚定；tsc-helper 为真实编译器 API 入口） | 无 | 无 |
| 既有 8 测试文件 62 例 | vitest include | 无 doc fixture 输出逐字节不变（静态代数证明）→ 全绿保持 | 无 | 无 |
| `projectValue` 包内导出面 | emitter.ts（既有导入） | 导出面只增不改；enum/union 行为保形 | 无 | 无 |
| `emitUnionBodyMembers` 共享助手 | emitAlias（块位）+ emitInner（行内位）两调用点 | 本体零改动（diff 证实）——两种 doc 位置语义在调用点装配，未耦合进共享助手（设计 A2 否决理由成立） | 无 | 无 |

关键 caller 无遗漏：grep 全包 `memberDocs` 消费面 = EmitTables 槽 + 接线 + 单点查键 + 闸门（§2 结论 1），无旁路读取、无第二消费通道。

## 8. 错误、恢复与并发

| 检查项 | 结论 | 证据 |
|---|---|---|
| 错误吞掉/伪装成功 | 无。无 try/catch 新增、无 fallback、无 env override | diff 逐 hunk；包 AGENTS「fail loudly」维持 |
| 既有 throw 触发条件与顺序 | 零变化。root 形态/N3 碰撞守卫先于发射；desync/同形裁决/ROOT 引用在 emitInner 各 case 原位；O2 精化使畸形坍缩配对（非 leaf 结构 × enum/union 值 + 手造键）闸门恒闭合、仍走既有 desync——SA3 探针 A/B 报告与 HEAD 同一异常 | emitter.ts L165-182（前置守卫未动）、L246（leaf 约束）、L304/326/337/350（case 内守卫原位） |
| 唯一新 throw | `projectUnionMembers` 内部误用守卫（非联合形值），两调用点（L252、L343）均被 enum/union 分支条件约束，合法输入不可达；响亮非静默 | valuetype.ts L76 |
| 部分完成诚实报告 | 纯函数单返回值，无部分写盘面；CLI 写盘/`--check` 语义零改动 | cli.ts 未动 |
| 幂等/重试 | `generate` → `--check` 同字节幂等（两模式各自闭环）；无状态无副作用，回滚 = revert 三文件 | 设计 §9 论证在实现中逐条成立 |
| 确定性 | 无表枚举、无键序依赖；循环全部按 `values`/`members`/`node.members` 声明序数组；无定时器/随机/环境读取；契约 W2 双发一致断言锚定 | L233/L247/L252/L331/L343 全为数组序迭代 |
| 并发/TOCTOU/双写 | 无共享状态、无 IO 竞态面 | 纯函数 |
| 手造 derived 越界/悬空键 | 查键 only：越界键（N ≥ 成员数）永不读取；空数组条目视同缺席（O1）；无表遍历故无键序影响 | L430-433 |
| 进程重启/事务中断/迟到回调 | 不适用（无持久化、无回调面） | — |

静态无法确认项：无（本任务无运行时状态面；仅测试实跑结果转 §11）。

## 9. 测试质量审查

SA4 未运行测试；以下为测试源码与真实触发入口的静态审查。验收真相 = SA6 契约 33 例（实数核对：3+4+7+4+3+6+2+2+2 = 33 ✓）。

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| 发射位 1 组 3 例（map 成员/ref 成员/semicolonFree） | 生成文本 `toContain` 精确多行串（doc 行位置、缩进、成员文本、终止符）；前置断言 `memberDocKeys` 键清单在场（证伪伪红） | 根 `pnpm test` / `vitest run packages/vfsl-codegen`（include 命中） | 无 | 无 |
| 发射位 2 组 4 例（枚举/标量联合/部分 doc/semicolonFree） | 多行布局 + W1 部分 doc 语义（无 doc 成员不垫行）；键清单前置 | 同上 | 无 | 无 |
| 发射位 3/4 组 7 例（ref/枚举/标量联合/map 判别/数组元素位/部分 doc/semicolonFree） | 行内前缀 + `\|` join 文法 + `.<item>` 深层键 + semicolonFree 无行尾空格（`not.toMatch(/ +$/m)`） | 同上 | 无 | 无 |
| W2 组 4 例（多 doc 块位/行内/多行体默认/多行体 semicolonFree） | 逐块叠加、单空格串联、多行体逐字（默认 `/** ` 行尾空格保留 / semicolonFree 剥除）；双发 `toBe` 逐字节一致 | 同上 | 无 | 无 |
| 负控 plain/xml/M3 3 例 | 「derived 键在场 + 生成物 doc 文本零出现」配对（证伪伪造性跳过）；M3 位 `memberDocs` 整键 `toBeUndefined()` + 单行 + 标记 doc 不泄漏 | 同上 | 无 | 无 |
| 负控无 doc 6 例 | 三 fixture `memberDocs` undefined + HEAD 金样本 `toContain` 逐字节串 + 判据独立性（同模块并存） | 同上 | 无（金样本为内联字面量，锚定具体字节） | 无 |
| 负控存量域 2 例 | vfs3-assets 派生表缺席 + `generateProjection` 输出与仓内 `generated.ts` **逐字节相等**（`toBe`）；仓根 `pnpm generate --check` 子进程 exit 0（20s timeout） | 同上 + CI L147 冗余门 | 无 | 无 |
| CLI 端到端 2 例 | `mkdtemp` 临时 domain → `pnpm generate` 写盘含 doc 文案 → 同格式 `--check` exit 0；semicolonFree 零分号 + 闭环 | vitest（spawnSync 同步，无残留进程）；fixture 模式与既有 `generate-cli-check.test.ts` 同款 | 无 | 无 |
| 类型面 2 例（it.each 双格式） | 生成物写盘 → `preEmitDiagnostics` 为空 + `formatDiagnostics` 空串（真实编译器 API program，红因前置断言 doc 在场） | vitest + 包 typecheck（tsconfig include `test/**/*.ts`） | 无 | 无 |

测试 weakened 面检查：无 skip/only/todo（全文实读）；无源码字符串断言（全部断言运行时生成文本/派生表/子进程退出码）；断言经公共入口（`parseVfsl`/`evaluate`/`generateProjection`/CLI/tsc API），不 mock 边界。触发入口真实性：根 vitest include `packages/*/test/**/*.test.ts` 命中；CI typecheck 作业（ci.yml L39-44）+ 分片作业经 `scripts/ci-test-shard.mjs` 磁盘枚举（新增文件自动入分片，无静默漏跑）+ CI `pnpm generate --check`（L147）；包 typecheck include `test/**/*.ts`。SA6 红灯断言保持：契约文件未被改动（§2 结论 2），SA3 实现前红灯基线 23F/10P 与实现后 95/95 由 SA3 报告记录（实跑归 SA7 复核）。

## 10. Required revisions

无 BLOCKER / MAJOR finding。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| SA3 声称的绿色运行（包测试 95/95、根 3350/3350、包/根 typecheck、`pnpm generate --check` exit 0）需干净环境复现 | SA7 收官门（SA6 §12.4 + 包 AGENTS：`pnpm install --frozen-lockfile` 后实跑五门） | 全部 exit 0 / 全绿；负控不因实现走样而红 | 任一门非零或负控红 → 实现返工（回流 SA3） |
| Node 版本矩阵（CI 20/24 双版本）下行为一致 | CI test 分片矩阵 | 双版本全绿 | 任一版本红 |
| SA3 O1/O2 探针结论（手造 derived 空条目/异形配对输出与 HEAD 逐字节相同、desync 同款）探针已删除、契约不覆盖手造输入 | 如需加固，可由验收侧以一次性探针复核（非本任务欠账——合法链路不可达已由 evaluate 冻结契约 + guardMemberDocs 静态证实） | 手造输入行为与 HEAD 一致 | 出现孤立空格字节或异常面变化 → 回流 SA3 |

## 12. Non-blocking observations

| ID | Severity | Observation | Suggested refinement | Acceptance |
|---|---|---|---|---|
| N1 | MINOR | 契约测试文件权限位 600（`-rw-------`），其余测试文件为 664——SA6 落盘方式差异；git 仅跟踪可执行位，提交后无实质影响 | 无需动作（ Runner Host 提交时正常入库） | 不适用 |
| N2 | MINOR | 发射位 1（union×union）的「部分成员有 doc」形态无专属契约用例（W1 部分	doc 用例覆盖发射位 2/4）——实现行为一致（`if (memberDoc !== '')` 同一装配），仅契约覆盖面备注 | 若后续契约修订（SA6 职责）可补一例 | 不阻塞；非实现缺陷 |
| N3 | MINOR | R3（行内位多行 doc 体：注释块内嵌换行进入单行类型实参）契约未覆盖——设计/SA2 O3 已登记为「已定义语义、非未决」，实现 `tsdocInline` 逐字语义与其一致 | 维持登记；消费方反馈另立票据走 SA6 修订 | 不适用（已登记） |

## 收尾结论

实现是对批准设计（D1–D8）、SA6 契约（§12.1–12.4 + W1/W2 钉死值）、SA2 精化（O1/O2）与 ADR 0019 决策 6 的忠实落地：四发射位完整、键空间与 walkDocs 逐位对齐、无 doc 路径逐字节不变（静态代数证明）、无发射位结构性保持、W1/W2 语义无第二种解释、文件范围零越界、契约测试未被触碰、验证门入口全部真实。**Verdict：`approve`**。`requiresConflictRecheck = false`：实现为 ADR 0019 决策 6 后果清单明文登记的交付物，无公共 API/wire/schema/持久化/状态机语义变化，无新冲突面。

# SA10 Spec 审查报告 — issue #307（vfsl-codegen 联合成员 doc 四发射位）

- 派发：`sa-723452c8-25a8-4d9a-a650-bc748e1f7160`（role `mabf-sa10`，phase `spec-review`，iteration **1**）
- Worktree：`/home/wangjian/nomicore-fix-issue-307`（branch `mabf/issue-307`）
- 审查日期：2026-09-11
- 被审对象：**SA9 F1 注释级修正后的最终交付 diff**——HEAD `f63b0a5c2fa845aa64b1cf0c5eadb7057b5c20d2`（权威 Parent PR #305 head，`git rev-parse HEAD` 亲证逐字符一致）+ 工作树未提交改动（3 个 src 文件 +120/−14 + 未跟踪契约测试 1 文件）
- 本轮增量背景：SA9（iteration 0，`approve`）登记唯一 MINOR **F1**——emitter.ts 闸门注释枚举「部分/全部成员无条目」与代码/W1 钉死值不符；SA3 iteration 1 做最小注释级修正（删「部分/」二字）。本轮审查对象 = iteration 0 交付 diff + 该注释修正。
- 审查基准：issue #307 正文 + AC1–AC4（无评论）、SA6 approved 契约（33 例 + W1/W2 钉死值 + §12.4 验证门）、ADR 0019 决策 6/8/9、SA1 设计 D1–D8、SA2 O1–O3、SA8 W1/W2/B1–B3、SA4/SA7/SA9 结论与证据
- 审查方法：独立实读交付 diff 逐 hunk 与全部改动文件上下文；对 F1 修正前后状态逐行核对（SA9 记录的原措辞 vs 当前 L243）；核对输入链键文法（evaluate.ts walkDocs / derived.ts）；静态代数验证「无 doc 逐字节不变」；只读 git 命令核对 rebase 状态、文件范围与修正的注释纯度。按职责边界**未运行测试**（动态证据采信 SA7 干净环境实跑记录 + SA3 iteration 1 修正后复跑声明，并做转移性核验）。

## Verdict

**`approve`**

Issue #307 全部四条 AC 在交付 diff 中完整、正确兑现，无遗漏、无部分实现、无错误实现、无 scope creep；SA6 契约 C1–C12 与 W1/W2 钉死值逐字落地；ADR 0019 决策 6 的四发射位 / 两类无发射位 / semicolonFree 同布局与决策 8 纯文档性质全部保持。**SA9 F1 修正经亲证为纯注释改动且措辞现在与代码/契约一致**（§3）；iteration 0 的 approve 结论（见前一版本报告同路径）对全部实质维度继续成立。须随 PR 披露的未达成/遗留项见 §9——全部为已登记的非阻断项，无一项触及 AC。

---

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-307.md`（Issue 正文 + AC1–AC4；`## Comments` 空） | 实读（审查基准） |
| `wiki/raw/task_issue-307_sa6_contract.md`（approved，33 例 23 红/10 绿 + §12.2/12.3 钉死值 + §12.4 五门） | 实读（验收真相基准） |
| `docs/adr/0019-vfsl-union-member-docs.md` 决策 6/8/9（accepted 2026-09-11） | 实读（规范基准） |
| `wiki/raw/task_issue-307_design.md`（SA1 设计 D1–D8、§11 ALLOW/DENY） | 实读 |
| `wiki/raw/task_issue-307_sa2_review.md`（`approve`，O1/O2/O3 MINOR） | 实读 |
| `wiki/raw/task_issue-307_sa3_impl.md`（iteration 1：F1 注释修正 + iteration 0 实现保留）、`…_sa4_review.md`（`approve`，N1–N3）、`…_sa7_report.md`（`approve`）、`…_sa9_standards.md`（`approve`，F1 MINOR + O1/O2 OBS） | 实读（不采信自述，关键声明逐条对源码复核） |
| `wiki/raw/task_issue-307_conflict_report.md`（SA8 `clear`，W1/W2/B1–B3） | 实读 |
| 交付 diff：`packages/vfsl-codegen/src/{emitter,docs,valuetype}.ts` 逐 hunk + 全文上下文；`test/generate-union-member-docs.test.ts` 638 行（sha256 核对） | 实读复核 |
| 输入链：`packages/vfsl/src/derived.ts` L84-91、`src/evaluate.ts` L401-410（walkDocs 键文法） | 实读复核（未改动确认） |
| Issue 反馈 | REST 快照无评论（none applicable），与简报 `## Comments` 空一致——无 owner 覆盖性输入 |

## 2. Rebase 状态与交付面对账（派发声明 vs 实测）

| 声明 | 实测（本轮亲证） | 结论 |
|---|---|---|
| 权威 Parent PR #305 head = `f63b0a5c2fa845aa64b1cf0c5eadb7057b5c20d2` | `git rev-parse HEAD` = 同一全 SHA | 一致 |
| 实现 rebase 到该 head 且无冲突 | `git merge-base --is-ancestor 4d4208b f63b0a5` 成立（线性历史）；基线增量 = 仅 #305 一提交（`apps/yjs-server/src/lifecycle.ts`、`…/test/root-lock-atomic-reclaim-red.test.ts`、`docs/integration/hub-peer-deployment.md`）；`git diff 4d4208b f63b0a5 -- packages/vfsl-codegen packages/vfsl domains` **零字节** | 一致：基线增量与交付面零交集 |
| 交付 diff = SA3 iteration 1 报告的同一份 | `git status --porcelain -uall` 恰为 3 个 modified src（`git diff --stat` = **+120/−14**，与 SA9/SA4/SA3 记录逐字一致）+ 未跟踪契约测试与 wiki 产物；stash 空、索引无 staged | 一致 |
| 契约测试未被实现侧/修正侧改写 | sha256 `b9c87b9ea0360f04362214a2eaeb769f5d03ec17ac11e158742edf1676189e64`，与 SA3（两轮）/SA4/SA7 四处记录逐字符一致；仍处未跟踪状态 | 验收真相有效 |
| 无临时诊断残留 | `ls packages/vfsl-codegen/` 仅 AGENTS/package/README/src/test/tsconfig/node_modules；`git diff HEAD --check` exit 0 | 干净 |

**SA7 证据转移性**：SA7 五门绿（包测试 95/95、包/根 typecheck exit 0、`pnpm generate --check` exit 0、根 `pnpm test` 316 文件 3350 例）采集于 rebase 前 HEAD `4d4208b`；交付 diff 自 SA7 以来仅发生 F1 注释修正（§3 亲证非注释字节零变化），且基线增量不触 `packages/vfsl-codegen`/`packages/vfsl`/`domains`——动态证据对当前 diff 保持有效；rebase 后根测试总数随 #305 新增用例变化，复跑属 CI/Runner Host 观察面（披露 D1）。

## 3. SA9 F1 修正核验（本轮增量，亲证）

| 核验点 | 证据 | 结论 |
|---|---|---|
| 修正前措辞（SA9 §9 F1 记录） | emitter.ts L243 = 「闸门闭合（无 M4 输入、M3 优先位、**部分/全部**成员无条目、非 leaf 结构形）」——「部分成员无条目」与紧邻代码 `.some((d) => d !== undefined)`（任一成员有非空条目即开闸）及 SA6 §12.2 W1 钉死值（部分成员有 doc → 全成员多行，契约用例实测绿）矛盾 | 失实确认（SA9 判定成立） |
| 修正后措辞（当前文件亲读） | emitter.ts **L243** = 「闸门闭合（无 M4 输入、M3 优先位、**全部成员无条目**、非 leaf 结构形）」——与代码（L246-249：仅当区间 [0, 值侧成员数) 内存在非空条目才开闸）、与 W1 钉死值完全一致；同注释前两句 W1 判据原文未动（L240-242 亲读） | **修正正确且精确**（SA9 建议删「部分/」二字，落实为「全部成员无条目」，语义等同建议文「全成员无条目」） |
| 注释纯度（comment-only） | diff 行数统计不变（+120/−14，修正发生在已加入行内的文本替换）；SA9 §2/§3 引用的全部行锚在当前文件逐一命中且代码字节逐字相同：发射位 1 装配 L229-238、位 2 闸门+多行 L240-259、位 3 行内前缀 L329-333、位 4 分段前缀 L340-346、`memberDocsAt` L430-433（含 O1 空数组视同缺席）、plain 无发射位 L319-324、xml-fragment 不透明终态 L349-352、`projectUnionMembers` valuetype.ts L65-77、`tsdocLines/tsdocInline/tsdocBlock` docs.ts L8-15/L22-25/L28-32 | **非注释字节与 SA9 审查时完全相同**——iteration 0 的全部 approve 论证原样转移 |
| 同类残留 | SA3 声明 `grep -rn "部分" packages/vfsl-codegen/src/` 无命中（本轮 `grep 闸门闭合\|部分/全部` 复核仅命中修正后 L243 一处） | 无第二处失实枚举 |

结论：F1 从「唯一遗留 MINOR」转为**已关闭**；当前交付 diff 在 spec 与 standards 两面均无已知失实表述。

## 4. Issue AC 逐项核验

### AC1 — 别名判别联合成员 doc 以 `  | ` 行上一行发射；别名枚举有成员 doc 时转多行（默认 + semicolonFree）→ ✅ 达成

| 子要求 | 实现锚点（独立核读） | 测试锚点 |
|---|---|---|
| 发射位 1：doc 行在 `  | ` 行上方、缩进与 `|` 列对齐 | emitter.ts L230-238：成员文本获取零改动，行装配改逐成员 `memberBlock(tables, name, i, '  ')` 在 `` `  | ${text}` `` 上方入 lines；无 doc 时 `lines.join('\n')` ≡ 既有 `` `  \| ${members.join('\n  \| ')}` ``（装配代数等价，逐字节） | 契约发射位 1 组 3 例（map 成员 / ref 成员 / semicolonFree），含键清单前置断言证伪伪红 |
| 发射位 2：坍缩别名有成员 doc → 多行逐成员 | emitter.ts L240-259：W1 闸门（`node.kind === 'leaf' && memberCount > 0` + 对 N∈[0, 值侧成员数) 探 `Name.<member N>` 非空条目）→ `projectUnionMembers` 分段 + 逐成员 `  \| ` 行与块位 doc；闸门闭合 → L260 既有单行路径逐字保留 | 契约发射位 2 组 4 例（枚举 / 标量联合 / 部分 doc 全多行 / semicolonFree）+ 判据独立性 1 例 |
| 两种模式同布局 | `term` 随 `tables.semicolonFree`（默认 `;` / sf `''`）；doc 块缩进恒 `'  '`；sf 下成员对象字面量多行化维持既有行为 | 两组各含 semicolonFree 用例（全文零分号断言）+ CLI sf 闭环用例 |

### AC2 — 内联联合/枚举成员 doc 行内前置 → ✅ 达成

| 子要求 | 实现锚点 | 测试锚点 |
|---|---|---|
| 发射位 3：内联联合行内前置 | emitter.ts L331-333（`emitInner` case `'union'`）：`.map((text, i) => memberInlinePrefix(tables, path, i) + text).join(' \| ')`——前缀紧跟成员起点，join 文法不变；一处接线经 emitNode 覆盖字段位 / 嵌套对象位 / `.<item>` 数组元素位 / `.<key>` Record 位 | 契约 3/4 组 7 例（ref / 枚举 / 标量联合 / map 判别 / 数组元素位深层键 / 部分 doc / semicolonFree 无行尾空格） |
| 发射位 4：内联枚举/标量联合行内前置 | emitter.ts L342-346（case `'leaf'` enum/union 分支）：`projectUnionMembers` 分段 + 同一行内前缀；scalar/pattern 维持 L347 原样 | 同上组内枚举 / 标量联合 / 部分 doc 用例 |

### AC3 — 无成员 doc 生成物逐字节不变；存量 domains `generate --check` 不报过期 → ✅ 达成

静态代数证明（本审查独立复核逐 hunk；F1 修正不触任何以下路径——§3）：

| 改动路径 | 无 doc 输入下的等价论证 |
|---|---|
| D2（发射位 1 装配） | 无 doc → `memberBlock` 恒 `''` → `lines = ['  \| m0', …]`，`join('\n')` 与既有表达式逐字节相同 |
| D3（发射位 2 闸门） | `derived.memberDocs === undefined`（条件稀疏，derived.ts L84-91 实读）→ `memberDocsAt` 恒 undefined → 闸门闭合 → L260 单行路径逐字保留 |
| D4/D5（行内前缀） | 无 doc → 前缀 `''`（`memberInlinePrefix` L441-444）→ map+join ≡ 既有 join |
| D6（valuetype 保形重构） | `projectValue` 原 enum/union 两 case 的 map 体逐字搬入 `projectUnionMembers`（valuetype.ts L65-77），新合并 case = `projectUnionMembers(v, values, stack).join(' \| ')`——同一表达式分解，字节不变 |
| D7（docs 保形重构） | `tsdocBlock` = 既有单块表达式原样搬移（含 sf 多行体 `/**` 后不垫空格分支）；`tsdocLines` = 同一 map + `join('\n')`，字节不变 |

行为锚定：契约负控 10 例当前即绿且实现后必须保持——条件稀疏断言（3 fixture `memberDocs` undefined）、三类金样本逐字节 `toContain`、同模块有/无 doc 位点并存独立、vfs3-assets `generateProjection` 输出与仓内 `generated.ts` **逐字节 `toBe`**、仓根 `pnpm generate --check` 子进程 exit 0。工作树 `domains/**` 零改动（git status 实证）；SA7 干净环境 `pnpm generate --check` exit 0（其 §9 命令 3/11，含诊断删除后复跑）。

### AC4 — codegen 包测试与 typecheck 绿，根 `pnpm typecheck` 绿 → ✅ 达成（证据转移，见披露 D1）

验证门入口全部真实（vitest include `packages/*/test/**/*.test.ts` 命中契约文件；包 tsconfig include `test/**/*.ts`；根 14 tsconfig 串行）。SA7 干净环境（全量 node_modules 删除 + `pnpm install --frozen-lockfile` 重装）实跑：包测试 9 文件 95/95（33 契约例红转绿 + 62 既有金样本保持）、包 typecheck exit 0、根 typecheck exit 0、根 `pnpm test` 316 文件 3350/3350、`pnpm generate --check` exit 0——SA6 §12.4 验收判据全满足。F1 修正为纯注释（§3），SA3 iteration 1 复跑声明 95/95 保持；本审查按职责不运行测试，证据转移性论证见 §2。

## 5. Issue 正文附加要求与 ADR 0019 合规

| 要求（来源） | 实现核验 | 结论 |
|---|---|---|
| YPlainArray 纯值子树成员 doc 无发射位（正文末句 / 决策 6 末段） | emitter.ts L319-324 case `'plain'` 仍走 `projectValue(value.element, tables.values)`——`projectValue`/`projectUnionMembers` 实读确认无 doc 感知、无查表/路径参数；该路径无 `memberInlinePrefix` 调用 | ✅ 结构性无发射位（非特判丢弃），负控断言「derived 键在场 + 生成物 doc 文本零出现」配对 |
| YXmlFragment 不透明实参成员 doc 无发射位 | L349-352 case `'xml-fragment'` 仍为不透明 `'string'` 终态，不递归实参，子树键不可达 | ✅ 同上 |
| semicolonFree 模式同布局 | doc 行/前缀位置两模式相同；`tsdocBlock` 沿用既有 sf 语义；CLI 双格式闭环用例（零分号 + 无行尾空格 + `--check --semicolon-free` exit 0） | ✅ |
| 决策 8 纯文档性质（不进校验/物化/机器语义） | 改动纯注释字节发射；`VfslPathMap` 增广体、`PathSchema` 外壳、`PathKind` 尾参零变化；`packages/vfsl` 校验/物化面零改动 | ✅（契约 C12 双格式孤立 tsc `preEmitDiagnostics` 空断言兜底） |
| 决策 9 只增不改（无 doc 路径逐字节、指纹面） | §4 AC3 静态证明 + 负控锚定；指纹输入面（`packages/vfsl`）本任务零触碰（#306 已兑现的义务未被回撤） | ✅ |
| ADR 0005 D3 纯发射器（不重推导语义） | 成员边界信息只来自 derived `memberDocs` 键回填（`memberDocsAt` 索引查键 only、绝不枚举表）；`structureOf`/值折叠等语义判定零触碰 | ✅ |

## 6. SA6 契约 C1–C12 与 W1/W2 钉死值核验

| 契约项 | 实现落点 | 结论 |
|---|---|---|
| C1/C2（发射位 1，map / ref 成员） | emitter L230-238 | ✅ |
| C3/C4（发射位 2，枚举 / 标量联合坍缩位多行；成员文本 = 单行形态逐段） | emitter L245-258 + `projectUnionMembers`（D6 结构化同源） | ✅ |
| C5/C6（发射位 3/4 行内前置，`\|` join 文法不变） | emitter L331-333 / L342-346 | ✅ |
| C7（W2 多 doc：块位逐块逐行叠加 / 行内位逐块单空格串联 / 双发逐字节一致） | 块位 = `tsdocLines`（join `'\n'`）；行内位 = `tsdocInline`（join `' '`）+ 尾单空格；表不遍历、声明序数组循环 | ✅ |
| C8（semicolonFree 同布局） | `term=''`、doc 缩进恒 `'  '`、`tsdocBlock` sf 分支同源 | ✅ |
| C9（无发射位负控：plain / xml / M3 优先位） | 结构性保证（§5）；M3 位由整键缺席闸死 | ✅ 保持绿 |
| C10（无 doc 逐字节不变负控 + 存量 domain 逐字节 + `--check` exit 0） | §4 AC3 全部论证 | ✅ 保持绿 |
| C11（CLI 端到端双格式写盘 + 新鲜闭环） | CLI/collect 零改动、derived 透传自然到达（`generateProjection` 签名未变） | ✅（SA7 命令 7–10 独立复跑命中，含跨格式 fail-closed 双向 exit 1） |
| C12（类型面：孤立 tsc 零诊断） | 纯注释发射 | ✅ |
| W1 钉死值（§12.2）：非空条目在场判据 / 按位点独立 / 部分 doc → 全成员多行 / 整键缺席永不切换 | emitter L245-249 探键区间 = [0, 值侧成员数)；`memberDocsAt` 空数组视同缺席（SA2 O1 落实，L430-433）；`if (memberDoc !== '')` 无 doc 成员不垫行；值侧非 enum/union → `memberCount = 0` 恒闭合；**F1 修正后注释枚举与以上逐条一致（§3）** | ✅ 逐字，无第二种解释 |
| W2 钉死值（§12.3）：块位逐块叠加 2 空格基准 / 行内位单空格串联紧跟成员起点 / 逐字渲染（默认 `/** ` 行尾空格保留、sf 剥除）/ 确定性 | `tsdocBlock` 单一真相源双变体；无表枚举、无键序依赖、无定时器/随机/环境读取 | ✅ 逐字（契约含双发一致断言；SA7 探针键序反转输出不变） |

契约测试 33 例实数复核：3+4+7+4+3+6+2+2+2 = 33 ✓（红 23 = 3+4+7+4+判据独立 1+CLI 2+类型面 2；绿 10 = 无发射位 3+无 doc 5+存量域 2），与 SA6 §13 一致。测试质量：无 skip/only/todo、无 mock、无源码字符串断言、经公共入口（`parseVfsl`/`evaluate`/`generateProjection`/CLI 子进程/真实 tsc API）观察运行时行为；契约文件 sha256 与 SA4/SA7/SA3 记录一致，未被实现侧或修正侧触碰。

## 7. Owner 评论映射

无 owner 评论（REST 快照空、简报 `## Comments` 空）。无输入即无义务——无遗漏。

## 8. 文件范围与 scope creep 检查

| 检查项 | 实测（本轮亲证） | 结论 |
|---|---|---|
| 生产改动面 | 恰 `packages/vfsl-codegen/src/{emitter,docs,valuetype}.ts`（git status `--porcelain -uall` + diff --stat 实证，+120/−14）= 设计 §11 ALLOW 行 1–3（含「相关注释更新」——F1 修正落在此授权内） | 合规，零越界 |
| DENY 面 | 契约测试与其余 8 测试文件 + tsc-helper.ts、`packages/vfsl/**`（含 `resolve-schema-at-path.ts`=#308 面）、`docs/vfsl/**`（#309 面）、`cli.ts`/`collect.ts`/`index.ts`/`header.ts`/`protocol-surface.ts`、`domains/**`、其余 packages/apps——全部不在 git status | 全部未触碰 |
| 公共面 | `index.ts` 仍仅导出 `generateProjection` + `GenerateProjectionOptions`；`tsdocInline`/`projectUnionMembers` 仅包内导出（沿 `projectValue` 先例）；`generateProjection` 签名/返回/选项零变化 | 无公共 API 变化，无 scope creep |
| git 操作 | HEAD 仍 `f63b0a5`、无新提交、stash 空、索引无 staged | 本任务侧无 git 操作 |
| 残留物 | `packages/vfsl-codegen/` 目录实 ls 仅 AGENTS/package/README/src/test/tsconfig/node_modules | 干净 |
| 错误语义 | 唯一新 throw = `projectUnionMembers` 内部误用守卫（两调用点均被 enum/union 分支约束，合法输入不可达）；SA2 O2 落实（闸门含 `node.kind === 'leaf'`，L246，畸形坍缩配对保留既有 desync 路径与逐字异常，SA7 G6 动态证实与 HEAD 逐字相同）；F1 修正不触任何守卫 | 零新失败语义、零静默降级 |

## 9. PR 必须披露的未达成/遗留项（全部非阻断）

| # | 项 | 性质 | 路由 |
|---|---|---|---|
| D1 | SA7 五门动态证据采集于 rebase 前 HEAD `4d4208b`；rebase 到 `f63b0a5` 后未由 SA7 复跑；其后的 F1 修正为纯注释（§3 亲证非注释字节零变化），SA3 iteration 1 声明修正后包测试 95/95 保持——交付 diff 行为面与 SA7 验证对象逐字节相同、基线增量与交付面零交集（§2 转移性论证成立） | 流程披露 | rebase 后五门复跑归 CI / Runner Host 收官观察 |
| D2 | SA4 N1 / SA9 O1：契约测试文件权限位 600（其余测试 664）——SA6 落盘方式差异；git 仅跟踪可执行位，提交后无实质影响 | 外观注记 | Runner Host 提交时正常入库，无需动作 |
| D3 | SA4 N2：发射位 1（union×union）「部分成员有 doc」形态无专属契约用例（部分 doc 用例覆盖发射位 2/4；实现为同一装配 `if (memberDoc !== '')`） | 契约覆盖面注记，非实现缺陷 | 若需补例走 SA6 契约修订 |
| D4 | R3/O3/N3：行内位遇多行 doc 体时注释块内嵌换行进入单行类型实参——TypeScript 合法、`tsdocInline` 逐字语义，设计已登记为「已定义语义、非未决」，契约未覆盖 | 已登记已知语义 | 消费方反馈另立票据走 SA6 契约修订 |
| D5 | 明确 follow-up（非本任务欠账）：#308（readData docs 切片第三来源，ADR 0019 决策 7）、#309（v1-spec §5 四锚位 + schema-authoring-guide §7/8 同步） | 边界外后续票 | B1 范围边界，#307 不承担 |

**无未达成 AC、无部分实现 AC、无不可达成 AC。** 关键 AC（AC1–AC4）全部 met——不满足 reject 判据。SA9 唯一 MINOR（F1）已在交付 diff 中正确关闭（§3）。

## 10. Verdict 判据核对

- Issue AC1–AC4：全部达成（§4 逐条，实现锚点 + 测试锚点双证）✔
- Issue 正文附加要求（无发射位位点 / semicolonFree 同布局）：达成（§5）✔
- SA6 approved 契约：C1–C12 + W1/W2 钉死值逐字落地，33 例红转绿（SA7 干净环境实跑），负控 10 例保持绿 ✔
- ADR 0019 决策 6/8/9 与 ADR 0005 D3 / ADR 0004 类型形状契约：合规（§5）✔
- SA9 F1 修正：纯注释、措辞正确、无同类残留（§3）✔
- Owner 评论：无，无遗漏 ✔
- 文件范围：ALLOW 内零越界、DENY 全未触碰、无公共面变化、无 scope creep（§8）✔
- 未披露项：无——应披露项已全部登记于 §9（均非阻断）✔

**Verdict：`approve`**。`requiresConflictRecheck = false`：实现为 ADR 0019 决策 6 后果清单明文登记的交付物；F1 修正为注释级精化，不引入任何新语义；rebase 基线增量（#305）与交付面零交集，未引入新冲突面；无公共 API / wire / schema / 持久化 / 状态机语义变化。

# SA2 设计攻击评审 — issue #307（vfsl-codegen 联合成员 doc 四发射位）

- 派发：`sa-afff620c-a975-4e41-8a94-ec0c35496419`（role `mabf-sa2`，phase `design-review`，iteration 0）
- 被审对象：`wiki/raw/task_issue-307_design.md`（SA1，iteration 0，HEAD `4d4208b`）
- 评审日期：2026-09-11
- 评审方法：独立实读源码逐锚点复核（emitter.ts / docs.ts / valuetype.ts / collect.ts / cli.ts / index.ts 全文；derived.ts / evaluate.ts 关键段；ADR 0019 全文；契约测试 638 行全文；vitest 配置、根与包 package.json、tsc-helper.ts、存量 domain schema），不采信设计自述。

## Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-307.md`（任务简报，issue #307 正文 + AC1–AC4，无评论） | 实读 |
| `wiki/raw/task_issue-307_design.md`（SA1 设计，iteration 0） | 实读（被审对象） |
| `wiki/raw/task_issue-307_sa6_contract.md`（approved 契约，33 例） | 实读 |
| `wiki/raw/task_issue-307_conflict_report.md`（SA8 Verdict `clear`，W1/W2/B1–B3） | 实读 |
| `wiki/raw/task_issue-307_relevant_decisions.md` | 不存在（SA8 冲突报告即等价决议产物，17 ADR + CONTEXT.md 盘点） |
| `packages/vfsl-codegen/src/emitter.ts`（L121-129、L146-154、L211-225、L259-309、L348-371 等） | 实读复核 |
| `packages/vfsl-codegen/src/docs.ts`、`src/valuetype.ts`、`src/collect.ts`、`src/cli.ts`、`src/index.ts` | 实读复核 |
| `packages/vfsl/src/derived.ts`（L84-91）、`src/evaluate.ts`（L85-142 结构坍缩、L276-329 值折叠、L341-429 walkDocs） | 实读复核 |
| `packages/vfsl-codegen/test/generate-union-member-docs.test.ts`（契约测试）+ `tsc-helper.ts` | 实读复核 |
| `docs/adr/0019-vfsl-union-member-docs.md`（决策 6 规范来源） | 实读 |
| `packages/vfsl-codegen/AGENTS.md`、README.md、根 vitest.config.ts、根/包 package.json、`domains/vfs3-assets/schema.vfsl` | 实读复核 |
| git 状态（HEAD `4d4208b`，工作树仅新增契约测试 + wiki 产物，生产零改动） | 实读复核 |

## Verdict

**`approve`**

无 BLOCKER / MAJOR finding。四发射位的位点完备性与键空间对齐、逐字节稳定性论证、无发射位结构性边界、坍缩位 W1 闸门、W2 确定性渲染、文件范围均经源码独立复核成立；设计逐字采纳 SA6 契约 §12.2/§12.3 钉死值，无第二种解释（除 2 条不可达路径上的措辞级偏差，见 Non-blocking observations）。2 条 MINOR 观察不阻断安全实施。

### 核心复核结论（对应派发关注点）

1. **四发射位正确性与完备性（成立）**。枚举发射的全部代码路径：`emitAlias` union×union 分支（D2）、`emitAlias` else 分支（D3 闸门 + 既有单行）、`emitInner` case `'union'`（D4，经 `emitNode` 覆盖接口成员位/嵌套对象成员位/数组元素位 `.<item>`/Record `<key>` 位，且 `emitUnionBodyMembers` 内层 `emitInner` 递归覆盖嵌套联合的深层 `.<member N>.<member M>` 键）、`emitInner` case `'leaf'` enum/union 分支（D5）。键构造与 `walkDocs` 键空间逐位比对一致（`evaluate.ts` L387-428 的 `${path}.<member ${i}>`/`.<key>`/`.<item>` 文法 = emitter 既有内联构造）；无第四个联合/枚举值投影路径遗漏（`case 'ref'` 终态、`case 'plain'`/`'xml-fragment'` 属无发射位）。
2. **坍缩位分类前提（成立）**。`structureOf` 规则 3（`evaluate.ts` L119-125）：全标量联合（含全字面量、标量联合）→ 结构 `leaf`，值侧 `valueOf`（L301-310）全字面量 → `enum`（声明序、**不去重**，L305）、否则 `union`——所以「值 enum ⟺ 全字面量 ⟺ 结构 leaf」在合法派生物上互斥，D3 闸门「仅 leaf×enum / leaf×union 可能命中」的结构断言成立，且 `memberDocs` 索引 N ↔ enum `values[N]` / union `members[N]` 对齐有结构性保证。
3. **逐字节稳定性（成立）**。D2 无 doc 装配（`lines = ['  | m0', …].join('\n')`）与既有 `` `  | ${members.join('\n  | ')}` `` 代数等价；D4/D5 的空前缀 map 与既有 join 等价；D6 是 `projectValue` enum/union 两 case 既有表达式的保形分解（逐字比对 valuetype.ts L29-30/L44-45 与 D6 伪代码一致）；D7 `tsdocBlock` 是 docs.ts L16-18 既有表达式的原样搬移。四条路径的「无 doc 输出 = 既有表达式」论证全部成立，另有既有 62 例金样本 + 契约负控 #5–#10 三层经验网。
4. **无发射位边界（成立，结构性）**。`case 'plain'` → `projectValue(value.element)`（projectValue 保持无 doc 感知，D6 不加查表参数）、`case 'xml-fragment'` → 不透明 `'string'` 不递归——两条路径上不存在任何 `memberInlinePrefix`/`memberBlock` 调用点，doc 查找点全集封闭在 D2–D5 四处（设计 §8 D8 表逐行核实）。M3 优先位由条件稀疏表整键缺席闸死。
5. **W1 闸门（成立）**。判据 = `Name.<member N>`（N ∈ [0, 值侧成员数)）条目在场，不看值侧 kind/成员数/其他位点；部分 doc → 全成员多行；整键缺席永不切换——与 SA6 §12.2 钉死值一致，负控 #3（M3 优先单行）、#6/#8/#10（金样本 + 存量域逐字节）构成判据独立性的行为锚。
6. **W2 确定性（成立）**。块位 = 既有 `tsdocLines`（join `\n`）逐字渲染、行内位 = `tsdocInline`（join `' '` + 前缀单空格）——与契约 §12.3 及 4 条 W2 用例（含两次发射逐字节一致断言）逐字吻合；无表遍历、无键序依赖，循环全部按声明序数组。
7. **文件范围（成立）**。见 §文件范围审查。

---

## 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1a 别名判别联合成员 doc 以 `  \| ` 行基准上一行发射 | §7 D2 | 覆盖。装配重构保形 + `memberBlock` 块位；与 emitter.ts L217-223 现行为逐字节等价论证成立；契约 C1 组 3 用例锚定 |
| AC1b 别名枚举有成员 doc 时转多行（默认 + semicolonFree） | §7 D3 | 覆盖。W1 闸门 + `projectUnionMembers` 分段多行；坍缩分类经 `structureOf` 规则 3 复核成立；契约 C3/C4 + 判据独立性用例锚定 |
| AC2 内联联合/枚举成员 doc 行内前置 | §7 D4/D5 | 覆盖。一处接线（case `'union'`）经 `emitNode` 全路径覆盖字段/嵌套对象/数组元素/Record key 位；case `'leaf'` enum/union 分段；契约 C5/C6 组 7 用例锚定 |
| AC3 无成员 doc 逐字节不变；存量 `generate --check` 不报过期 | §7 D1 + §9 + §12 | 覆盖。条件稀疏闸门 + 四路径保形论证 + 负控 #4–#10（含 vfs3-assets 逐字节 + 仓根 `--check` exit 0）；存量 schema 实读确认无 M4 文本（无成员前 doc） |
| AC4 codegen 包测试与 typecheck 绿、根 `pnpm typecheck` 绿 | §12 验证门 | 覆盖。SA6 §12.4 五门全列（包测试 95/95、包/根 typecheck、`generate --check`；根 `pnpm test` 按 AGENTS「emitted types 变更」义务列 SA7 收官） |
| What-to-build 末句：YPlainArray/YXmlFragment 无发射位 | §7 D8 | 覆盖（结构性保证，见核心结论 4） |
| What-to-build：semicolonFree 同布局 | §7 D2–D5 + D7 | 覆盖。`term`/缩进/多行化既有行为维持，doc 块位置两模式相同；`tsdocBlock` 沿用 semicolonFree 语义 |
| Blocked by #306 | §1/§2 | 满足。HEAD `4d4208b` 即 #313（#306 实现）合并点，derived `memberDocs` 消费面在场（derived.ts L84-91、evaluate.ts L404-408 实读确认） |

目标/非目标无静默扩大：非目标显式排除 packages/vfsl、#308/#309 面、CLI 参数面、公共导出面、无发射位发明——与 B1 一致。

## Owner评论覆盖

Issue 反馈 REST 快照：无评论（none applicable）。任务简报 `## Comments` 节为空，与派发说明一致——无 owner 覆盖性输入需映射。Issue 正文 AC 即最高优先级输入，映射见上表。

## 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA6 契约 §12.2 W1 钉死值（条目在场判据、位点独立、部分 doc 全多行、整键缺席永不切换） | §5 表 + §7 D3 原样采纳 | 落实。判据实现 = 索引区间查键，与钉死值一致（「非空条目」措辞偏差见观察 O1，合法输入不可区分） |
| SA6 契约 §12.3 W2 钉死值（块位逐块逐行叠加 2 空格基准；行内位逐块单空格串联；tsdocLines 逐字；双发一致） | §5 表 + D2/D5/D7 | 落实。`tsdocInline` join `' '` + `memberInlinePrefix` 尾单空格与 4 条 W2 用例期望串逐字吻合 |
| SA6 风险登记：SA1 设计不同 doc 渲染语义须先修订契约 | §5 末行声明无不同语义 | 属实。D7 渲染全部来自既有 `tsdocLines` 语义搬移，零新规范化 |
| SA8 B1 范围边界（#307 = codegen only；不触 #308/#309 面） | §11 ALLOW/DENY | 落实。DENY 显式列 `resolve-schema-at-path.ts`、`packages/vfsl/**`、v1-spec/schema-authoring-guide |
| SA8 B2 集成惯例（挂 PR #305 同支累积） | §11 备注 | 落实。分支 `mabf/issue-307` 已在 #313→#305 支系；设计不产生 git 操作 |
| SA8 B3 环境义务（SA3/SA6/SA7 实跑验证门） | §12 + R6 | 落实。沿用 SA6 §12.4 五门 |
| ADR 0005 D3 纯发射器（不重推导语义） | §6 + D1/D3/D6 | 落实。成员边界只从 `memberDocs` 键回填；D6 复用 `projectValue` 分段不新增语义推导 |
| ADR 0019 决策 6 四发射位 + 末段无发射位 + 决策 8 纯文档性质 | §7 全部 + §8 | 落实。纯文本发射，无校验/物化/机器语义面变化 |
| ADR 0019 决策 5 条件稀疏表（键 = `<member N>`，N 从 0 声明序） | §2 锚点 #1/#2 | 与 derived.ts L84-91、evaluate.ts L404-408 实读一致 |
| #306 前置（`memberDocs` 消费面在场） | §2 锚点 | 实读确认 |

## 设计内部一致性

- 正文（§1 四发射位定义）↔ D2–D5 伪代码 ↔ §8 数据流伪代码 ↔ §10 调用方矩阵 ↔ §11 文件范围 ↔ §12 验收映射：逐项交叉核对无矛盾。
- §2 全部 12 条证据锚点经源码实读复核：行号与内容全部命中（emitter L121-129/L146-154/L217-225/L283-304/L348-371、docs.ts L8-19、valuetype L29-30/L44-45、collect.ts L91、derived L84-91、evaluate L404-408）。无死引用、无旧 API。
- 「纯增量」总原则与 D2–D5 各「无 doc = 既有表达式」逐条论证自洽，且被代数复核（join 装配等价、表达式保形分解）证实。
- 备选 A1–A6 否决理由与源码事实一致（A1 的 plain 泄漏路径、A3 的字符串手术风险、A4 的负控必红、A5 的表遍历键序依赖均真实）。
- §9「错误语义零变化」与 D3 闸门前置存在一处措辞级张力（异形配对 + 手造键时闸门先于 desync），详见观察 O2——合法输入不可达，不构成矛盾。
- §14 评审修订映射正确反映 iteration 0 无前序评审。

## 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | 无状态纯函数（`generateProjection` 单次调用内 tables 快照） | 同一 derived 双次发射（W2 双发断言、`generate`→`--check` 幂等） | 逐字节一致 | 无。memberDocs 只做索引查键（无枚举、无键序依赖），成员循环按 `values`/`members`/`node.members` 声明序数组；无缓存/IO/随机/时间 | 无 |
| S2 | 表缺席（一切存量 schema） | `memberDocs === undefined` | 四路径输出与 HEAD 逐字节相同 | 无。`memberDocsAt` 短路 undefined → 前缀 `''`/闸门闭合；`EmitTables` 增槽不改其余三表消费 | 无 |
| S3 | 部分 doc（表在场但位点稀疏） | 同模块有 doc 位点 + 无 doc 位点并存 | 逐位点独立切换 | 无。闸门按 `Name.<member N>` 区间查键，不整模块联动（契约负控 #8/W1 对照锚定） | 无 |
| S4 | 嵌套联合（`<member N>.<member M>` 深层键） | 联合成员本身是联合/含联合字段 | 深层键在对应深层发射位点命中 | 无。`emitUnionBodyMembers` 内层 `emitInner`/`emitNode` 递归携带 `memberPath`，键空间与 walkDocs 递归（L405-409）逐层一致 | 无 |

无状态机、无并发面（§9 与包 AGENTS「emitter 独立可测」边界一致）。

## 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | parse/evaluate 失败（E305/E100 等） | 既有失败面零改动（发射前发生，CLI exit 2） | 无 | 无 |
| E2 | 结构/值失配（desync）、异形联合（UnsupportedUnionKindError）、ROOT 引用、N3 碰撞 | 守卫原位保留，先于 doc 渲染；不为绕过增加 fallback | 无（合法输入下） | 无（O2 为手造输入的措辞级观察） |
| E3 | `projectUnionMembers` 收到非联合形值 | 响亮 throw（内部误用守卫，正常输入不可达——两调用点均被 enum/union 分支条件约束） | 无。与包 AGENTS「fail loudly」同向 | 无 |
| E4 | 手造 derived 越界/悬空 `<member N>` 键 | 查键 only、无表遍历：越界键永不读取；不对齐键不触发新失败类 | 无（evaluate 冻结契约 + guardMemberDocs 保证正常链路对齐；与其他三表按键查找纪律一致） | 无 |
| E5 | 实现引入字节漂移 | 负控 #5–#10 + 既有 62 例 + 仓根 `--check` 三层网必红；回滚 = revert 三个 src 文件（无持久化状态） | 无 | 无 |
| E6 | 行内位遇多行 doc 体 | R3：已定义语义（tsdocInline 逐字、TS 合法、确定性），登记为已知；如消费方不接受另立票据走 SA6 修订 | 低且已登记 | 无 |

无静默失败、无伪成功路径；降级面为零（纯增量接线）。

## 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `generateProjection(derived, opts?)` 公共签名 | 无。签名/返回/选项零变化；`DerivedSchema.memberDocs` 已由 #306 声明，本设计只读 | emitter.ts L146、index.ts L7-8 实读 | 无 |
| `collect.ts` `projectionText`（CLI 唯一编排） | 无。透传完整 derived，零改动即携带第四表 | collect.ts L91 实读 | 无 |
| `cli.ts`（参数面/写盘/`--check`/孤儿检查） | 无。`--domains/--check/--semicolon-free` 既有面覆盖契约 C11 双格式闭环；`--check` 逐字节 diff 机制零改动天然覆盖新字节 | cli.ts L40-74/L116-143 实读 | 无 |
| 既有测试 8 文件 62 例 | 无。无 M4 fixture 输出逐字节不变 → 全绿保持；测试目录实读确认 8 文件 + 契约新 1 文件 = 9，vitest include `packages/*/test/**/*.test.ts` 命中 | ls test/ + vitest.config.ts 实读 | 无 |
| 契约测试 33 例 | 无。DENY 列入禁改；实现与断言冲突时走 SA6 原位修订（§11 DENY 表明文） | 设计 §11 + 契约 §1/§15 | 无 |
| 生成物消费方（hover/AI 读码/生成文档、semicolonFree 消费仓） | 无。M4 域获得逐成员 TSDoc；无 M4 域零字节变化（存量 schema 实读确认无成员前 doc）；类型形状零变化（C12 孤立 tsc 兜底） | domains/vfs3-assets/schema.vfsl 实读（union 均无成员 doc） | 无 |
| `projectValue`/`tsdocLines` 包内导出面 | 无。D6/D7 新助手仅包内 export（沿 projectValue 既有先例），不进 index.ts；保形重构由既有金样本锚定 | index.ts 实读 | 无 |

## 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| 成员 doc 发射 | codegen 纯发射器（ADR 0005 D3） | emitter.ts 四位点 | 正确 |
| 成员边界信息 | derived `memberDocs` 表（ADR 0019 决策 6.2：仅键回填，不重推导） | D1 查键 only | 正确（不越权重推导） |
| doc 块渲染 | docs.ts 既有渲染职责 | D7 `tsdocBlock`/`tsdocInline` | 正确（单一真相源搬移而非复制） |
| 值分段投影 | valuetype.ts | D6 `projectUnionMembers` | 正确（与单行形态同源） |
| 收集/解析 | packages/vfsl（#306 已落，冻结） | 非目标显式排除 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| docs 表消费（三槽先例） | EmitTables aliasDocs/fieldDocs/markerDocs 槽 + 按键查找 + tsdocLines 渲染 | 第四槽同构：按键查找 + 同一渲染器 | 一致 | 同协议扩展，无平行通道 |
| 字段 doc 行内/块位双模式（#222 先例） | emitObjectMembers 默认行内、semicolonFree 上移一行 + `/**` 后不垫空格 | 成员 doc 块位/行内位 + 同 semicolonFree 语义 | 一致 | `tsdocBlock` 复用同一分支表达式 |
| `<member N>` 键文法 | `emitUnionBodyMembers` L358 既有内联构造 / walkDocs L407 | D1 同文法查键 | 一致 | 键空间逐位对齐 |
| 别名联合多行 `  \| ` 布局 | emitAlias L217-223 既有 | D2 保形装配 + 上方插行 | 一致 | #222 多行先例同构 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 联合成员边界/序号 | derived `memberDocs` 键（唯一入口 D1） | 无第二份 | 无（不按值侧 kind 猜测——A4 否决） |
| 成员文本分段 | `projectUnionMembers`（D6 单源） | 多行布局逐段与单行 join 同源 | 结构性消除（「成员文本 = 单行形态逐段」从约定变结构事实） |
| doc 块渲染 | `tsdocBlock`（D7 单源） | tsdocLines/tsdocInline 两个变体共用 | 无 |
| doc 查键 | `memberDocsAt`（D1 单点） | 三处发射位共用 | 无 |

### 生命周期对称性

纯函数、无状态、无 IO——无 register/dispose、acquire/release 面；CLI 文件系统关注点保持在边缘（包 AGENTS 边界维持）。不适用且无新增不对称。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二套 doc 渲染器 | docs.ts tsdocLines | 无（tsdocBlock 抽取自既有表达式） | 无平行 |
| 第二套成员分段逻辑 | projectValue enum/union case | 无（D6 分解该两 case，非另写） | 无平行 |
| 表驱动遍历/第二状态 | 无 | 无（A5 否决，声明序索引循环） | 无平行 |
| 新错误类/降级路径 | 既有命名化异常族 | 无（A6 否决） | 无平行 |

## 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW = emitter.ts + docs.ts + valuetype.ts + 设计产物（3 src + 1 wiki） | 设计 §7 改动面逐项落在这 3 文件（D1-D5 emitter、D6 valuetype、D7 docs）；与 SA6 §10「唯一生产面」同判；无正文改动落在 ALLOW 之外 | 无 |
| 「收拢 D6/D7 进 emitter.ts」的弹性条款 | 附加约束「ALLOW LIST 不得扩大到上表之外」+ 两不变量保持——收拢只会缩小触面，不扩张 | 无 |
| DENY：契约测试 + 其余 8 测试文件 | 实现不得改契约（与契约 §1/§15 修订纪律一致）；基线金样本锚定逐字节不变 | 无 |
| DENY：`packages/vfsl/**`（含 `resolve-schema-at-path.ts`=#308）、v1-spec/schema-authoring-guide（#309）、协议包、cli/collect/index/header/protocol-surface、`domains/**` | 与 SA8 B1、调用方矩阵「零改动」、AC3 逐项对齐；README 经实读确认无会因本特性失实的表述（无三锚位枚举类文案），无需纳入 | 无 |
| 集成惯例（B2）以备注而非文件项承载 | 挂 #305 同支、git 操作归 Runner Host——与 #306→#313 先例一致 | 无 |

ALLOW 无无理由扩张；DENY 与正文无冲突；follow-up（#308/#309/R3）均非本任务必要项被推诿。

## 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| 四发射位（D2–D5） | 契约 C1–C8 红 18 例（实现后转绿）：公共入口 `generateProjection` 文本断言，含 ref 成员、map 判别、数组元素位、部分 doc、双格式 | 无——断言观察运行时输出而非源码文本；红因前置断言排除伪红 | 无 |
| W1 闸门与位点独立 | 判据独立性红 1 例 + 负控 #3/#6/#8（M3 单行、金样本单行、混合模块并存） | 无 | 无 |
| W2 确定性 | 4 例含「同输入两次发射逐字节一致」双发断言 | 无 | 无 |
| 无 doc 逐字节不变（AC3） | 负控 #5–#8 金样本 + #9 vfs3-assets 与仓内 `generated.ts` 逐字节 + #10 仓根 `generate --check` exit 0 | 无——旧实现真红已由 SA6 实跑证实（23 红），负控现绿且实现后必须保持 | 无 |
| 无发射位（D8） | 负控 #1/#2（plain/xml：derived 键在场断言 + 生成物 doc 文本零出现）+ #3（M3 优先） | 无——「键在场 + 字节缺席」配对证伪伪造性跳过 | 无 |
| CLI 端到端 + 新鲜度闭环 | C11 双格式：临时 domain 写盘含 doc + 同格式 `--check` exit 0（`--domains` 参数面实读确认支持） | 无 | 无 |
| 类型面（注释不改类型形状） | C12 双格式孤立 program `preEmitDiagnostics` 为空（tsc-helper 实读确认真实入口） | 无 | 无 |
| 验证门（AC4/B3） | §12 五门：包测试 95/95、包/根 typecheck、`generate --check`；根 `pnpm test` 按包 AGENTS emitted-types 条款列 SA7 收官 | 无——SA6 §12.4 同判；SA3 自检清单完整 | 无 |
| 保形重构无漂移（D6/D7） | 既有 8 文件 62 例全绿保持（doc 金样本 + 单行金样本双向锚定） | 无 | 无 |

测试全部落在仓库真实入口（vitest include 命中、包 tsconfig include `test/**/*.ts`、CLI 子进程走根 `pnpm generate`）。

## Required revisions

无 BLOCKER / MAJOR finding。

## Non-blocking observations

| ID | Severity | Observation | Suggested refinement | Acceptance |
|---|---|---|---|---|
| O1 | MINOR | W1 判据措辞：SA6 §12.2 钉死值为「存在**非空**条目」，设计 D3 实现为 `d !== undefined`（存在即命中）；且 `memberInlinePrefix` 对空数组条目会产出孤立单空格前缀。合法链路不可达（walkDocs L407 仅收 `length > 0` 条目），仅手造 derived 可区分，与设计「原样采纳、不做第二种解释」的声明存在措辞级偏差 | `memberDocsAt` 将空数组视同缺席（`d !== undefined && d.length > 0 ? d : undefined`），或在 D1 注明「表内条目恒非空（evaluate 冻结契约），故存在性 ≡ 非空性」 | 手造 derived `{ memberDocs: { 'X.<member 0>': [] } }` → 输出与表缺席时逐字节相同；无孤立空格字节 |
| O2 | MINOR | D3 闸门以值侧 kind 计 `memberCount`，先于 `emitInner` 的 desync 守卫求值：手造 derived 若同时携带「结构 union×值 enum（或 xml×enum 等异形配对）」与 `Name.<member N>` 条目，会经闸门发射多行而非按现状 throw desync——与 §9「不改变任何既有 throw 的触发条件与顺序」在畸形输入上不严格成立。合法派生物不可达（`structureOf` 规则 3：值 enum ⟺ 结构 leaf，互斥已复核） | 闸门条件加 `node.kind === 'leaf'`（或等效地把值侧 kind 判断置于 leaf 节点分支内），使 §9 声明对畸形输入亦严格成立 | 手造异形配对 derived 行为与 HEAD 相同（desync 命名化异常），闸门仅 leaf×enum/leaf×union 可命中 |
| O3 | MINOR | R3（行内位多行 doc 体：注释块内嵌换行进入单行类型实参）契约未覆盖（W2 行内用例均为单行 doc）。设计已定义为逐字语义并登记为已知语义、后续按消费方反馈另立票据——处置诚实，无需本任务动作 | 无（维持登记）；若后续消费方反馈，走 SA6 契约修订流程 | 不适用（已登记） |

以上三条均不阻断实施：O1/O2 仅手造 derived 可观测（evaluate 是唯一合法生产者，其冻结契约 + guardMemberDocs 已封死两条路径），O3 已有诚实登记与既定路由。

## 评审结论

`approve`。设计可安全进入 SA3 实现。实现期纪律提醒（非 finding）：契约测试 33 例为验收真相、不得改写；负控 #1–#10 实现后必须保持绿；若实现与契约断言冲突，先经 SA6 原位修订契约。`requiresConflictRecheck = false`（设计为 ADR 0019 决策 6 忠实实现，无公共 API/wire/schema/持久化/状态机语义变化，无新冲突面）。

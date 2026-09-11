# SA1 设计 — issue #307：vfsl-codegen 联合成员 doc 四发射位

- 派发：`sa-f12f0700-de27-4040-a718-8341c8adf4a6`（role `mabf-sa1`，phase `design`，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-307`（branch `mabf/issue-307`，HEAD `4d4208b`）
- 产出日期：2026-09-11
- 输入实读：`wiki/raw/task_issue-307.md`（Host 刷新，Issue 正文 + AC1–AC4，无评论）、
  `wiki/raw/task_issue-307_sa6_contract.md`（approved 契约 + 33 例红/绿契约测试
  `packages/vfsl-codegen/test/generate-union-member-docs.test.ts`）、
  `wiki/raw/task_issue-307_conflict_report.md`（SA8 Verdict `clear`，W1/W2/B1–B3）。
  `task_issue-307_relevant_decisions.md` 与 `task_issue-307_sa2_review.md` 不存在；
  SA8 冲突报告即本任务已存在的等价决议产物（ADR 盘点 17 份 + CONTEXT.md），无评审输入。

---

## 1. 任务类型、目标与非目标

**任务类型：Feature（能力接线）**。不是 Bug：输入链（parser M4 → IR 条件键 → derived
条件稀疏 `memberDocs` 表）已由 #306（PR #313）落地在本支 HEAD，缺口是生成器对第四张
docs 表**零消费**——这是缺失的发射能力，不是错误行为。

**目标**：在 `packages/vfsl-codegen` 的纯发射器内，把 derived `memberDocs` 表接线到
ADR 0019 决策 6 的四个发射位，使成员 doc 字节随生成物到达类型投影消费方（hover、
AI 读码、生成文档）：

1. 别名判别联合（union×union）：成员 doc 块位于对应 `  | ` 成员行上方（缩进与 `|`
   列对齐，2 空格基准）；
2. 别名坍缩位（leaf×enum / leaf×union，含标量联合）：**有成员 doc 条目时**转多行
   `  | ` 逐成员布局，无条目保持既有单行（逐字节不变）；
3. 内联联合（字段类型位、数组元素位、Record `<key>` 位等）：成员 doc 行内前置
   （`/** d */ Member | …`），`|` join 文法不变；
4. 内联枚举/标量联合（字段类型位坍缩形）：同行内前置。

两种输出模式（默认 / `semicolonFree`）同布局；W2 多 doc 成员确定性渲染。

**非目标**：

- 不改 `packages/vfsl` 任何文件（M4 解析与 derived 表已就绪；`resolve-schema-at-path.ts`
  第三来源并入属 #308）；
- 不改 v1-spec §5 / schema-authoring-guide §7/8（属 #309）；
- 不改 CLI 参数面、collect 编排、协议包、公共导出面（`index.ts` 仅
  `generateProjection` + `GenerateProjectionOptions`）；
- 不为 YPlainArray 纯值子树 / YXmlFragment 实参内的成员 doc 发明发射位（ADR 0019
  决策 6 末段：无发射位，derived 照常收集）；
- 不实现、不运行测试（SA3/SA6/SA7 职责）。

## 2. 当前行为与证据锚点（HEAD `4d4208b` 实读）

| # | 事实 | 锚点 |
|---|---|---|
| 1 | 输入就绪：`DerivedSchema.memberDocs?: Record<string, string[]>` 条件稀疏（整键仅在 ≥1 成员带 doc 时在场，表内只收非空条目），键 = `<member N>` 路径（N 从 0 起声明序） | `packages/vfsl/src/derived.ts` L84-91 |
| 2 | 收集侧：walkDocs 按 IR union 成员序写 `memberDocs[`${path}.<member ${i}`]`（仅非空条目）；手造 IR 畸形 → TypeError → E100 | `packages/vfsl/src/evaluate.ts` L404-408、L361-368；表入 derived 见 L74 |
| 3 | 生成器三槽消费面：`EmitTables` 只有 `aliasDocs/fieldDocs/markerDocs` + `semicolonFree`；`generateProjection` 不读 `derived.memberDocs` | `packages/vfsl-codegen/src/emitter.ts` L121-129、L146-154 |
| 4 | 发射位 1 布局基准已在场：`emitAlias` union×union 分支产 `export type X =\n  | A\n  | B;`，成员文本来自 `emitUnionBodyMembers`（内部已构造 `${path}.<member ${i}` 键，L358） | `emitter.ts` L217-223、L348-371 |
| 5 | 坍缩位现走单行：`emitAlias` else 分支 → `emitInner` case `'leaf'` → `projectValue`（enum → `'a' | 'b'`；union → 成员 ` | ` join） | `emitter.ts` L224、L295-301；`valuetype.ts` L29-30、L44-45 |
| 6 | 内联联合现走 `emitInner` case `'union'` → `emitUnionBodyMembers(...).join(' | ')`；内联枚举走 case `'leaf'` → `projectValue` | `emitter.ts` L289-293、L295-301 |
| 7 | 无发射位限界是结构性的：case `'plain'` 直接 `projectValue(value.element)`（纯值投影无 doc 感知）；case `'xml-fragment'` → 不透明 `'string'`，不递归实参 | `emitter.ts` L283-287、L302-304 |
| 8 | doc 渲染既有语义：`tsdocLines(docs, indent, opts)` 每条 doc 一块、逐字（默认 `${indent}/** ${d} */`；semicolonFree 且体以 `\n` 起始时 `${indent}/**${d} */`），块间 `\n` 连接，返回不含尾换行 | `packages/vfsl-codegen/src/docs.ts` L8-19 |
| 9 | doc 文本逐字继承：`/** 图片变体 */` 的存储值为 ` 图片变体 `（含首尾空格）→ 渲染为 `/**  图片变体  */`；多行体逐字（含源缩进），不重排续行 | parser 逐字继承（derived.ts 注释「逐字继承」）；契约金样本 L172-179、L390-403 |
| 10 | semicolonFree 先例：对象字面量多行化、成员 doc 由行内位移至上一行、`/**` 后不垫空格；两种格式逐字节互斥、生成与 `--check` 同取值 | `emitter.ts` L28-40、L317-343；README「无分号输出」节；`generate-semicolon-free.test.ts` |
| 11 | CLI 编排透传完整 derived：`collect.ts` → `generateProjection(result.derived, {...})`，无 docs 过滤 | `packages/vfsl-codegen/src/collect.ts` L91 |
| 12 | 基线全绿：包测试 8 文件 62 例、包/根 typecheck、`pnpm generate --check` 均 exit 0；契约测试加入后 23 红（全部为成员 doc 字节缺失）/ 72 绿 | SA6 契约 §4、§13 |

## 3. 能力缺口（根因链）

| Step | 事实 | 证据 | 置信度 |
|---|---|---|---|
| 1 | 规范要求四发射位 + 坍缩位多行切换 + semicolonFree 同布局 + 两类无发射位 | ADR 0019 决策 6 全文（`docs/adr/0019-vfsl-union-member-docs.md`）；issue #307 AC | 确定 |
| 2 | 输入在场：四发射位的 derived `memberDocs` 键实测存在（`Entity.<member 0>`、`Status.<member 0..2>`、`ROOT.u.<member 0/1>`、`ROOT.tags.<item>.<member 0/1>` 等） | SA6 契约 §5 表；契约测试红因前置断言 | 确定 |
| 3 | 生成器零消费：`EmitTables` 三槽 + `generateProjection` 不读第四表 → 四位点生成物对成员 doc **零字节发射**（含 aliasDocs 在场的别名） | 锚点 #3；SA6 §13 红 diff 样本 | 确定 |
| 4 | 无 doc 路径不受影响的闸门已内建：条件稀疏表整键缺席（`=== undefined`）→ 一切判据闭合 | 锚点 #1；负控 4/10 绿 | 确定 |
| 5 | 放大因素：坍缩位（两树坍缩为 leaf/enum）无结构成员边界，成员边界只能从 `memberDocs` 键回填——按值侧 kind 或成员数猜测会破坏「无 doc 逐字节不变」 | ADR 0019 决策 6.2；SA8 W1；负控 #6/#8 | 高 |

**直接故障点**（SA6 §5 采信，本设计源码复核一致）：`emitter.ts` 的 `EmitTables`
无第四槽；`emitAlias` 两分支均无成员边界回填；`emitInner` case `'union'`/`'leaf'`
无成员前缀拼接。缺口 = **第四表未接线**，非输入缺失、非解析失败、非布局引擎缺失。

## 4. Owner要求落实

无 owner 评论（Issue 反馈 REST 快照：无评论，none applicable）。Issue 正文 AC 为最高
优先级任务输入，映射：

| 来源 | Updated at | 要求 | 设计落点 |
|---|---|---|---|
| Issue #307 AC1（正文 2026-09-11T05:54:04Z） | — | 别名判别联合成员 doc 以 `  \| ` 行为基准上一行发射 | §7 D2（发射位 1 块位渲染） |
| Issue #307 AC1 | — | 别名枚举有成员 doc 时转多行（默认 + semicolonFree） | §7 D3（W1 闸门 + 多行布局） |
| Issue #307 AC2 | — | 内联联合/枚举成员 doc 行内前置 | §7 D4/D5（发射位 3/4 行内前缀） |
| Issue #307 AC3 | — | 无成员 doc 生成物逐字节不变；存量 `generate --check` 不报过期 | §7 D1（条件稀疏闸门）+ §9 确定性论证 + §12 负控 |
| Issue #307 AC4 | — | codegen 包测试与 typecheck 绿、根 `pnpm typecheck` 绿 | §12 验证门（SA6 §12.4 全套） |
| Issue #307 正文（What to build 末句） | — | YPlainArray / YXmlFragment 内成员 doc 无发射位；semicolonFree 同布局 | §7 D8（结构性边界）+ D2–D5 双模式 |

## 5. 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
|---|---|---|
| 能力缺口已证明：输入在场 / 输出缺失成对，23 红全为成员 doc 字节缺失 | 契约 §5、§13 | 本设计只做发射接线（§7），不触输入链 |
| 契约测试 = 验收真相：33 例（23 红 / 10 绿负控），实跑入口 `vitest run packages/vfsl-codegen` | 契约 §12、§14 | §12 验收映射逐条挂 C1–C12；实现不得改契约文件（§11 DENY） |
| W1 多行切换判据已被 SA6 钉死：该位点 `<member N>` 键存在非空条目（不按值侧 kind/成员数）；按位点独立；部分 doc → 全成员多行；整键缺席永不切换 | 契约 §12.2 | D3 原样采纳，判据实现 = 索引区间查键（§7），不做第二种解释 |
| W2 多 doc 渲染已被 SA6 钉死：块位逐块逐行叠加于成员行上方（2 空格基准）；行内位逐块单空格串联紧跟成员起点；tsdocLines 逐字（默认模式 `/** ` 行尾空格保留、semicolonFree 剥除）；两次发射逐字节一致 | 契约 §12.3 | D2/D5/D7 原样采纳；多 doc 块位 = 既有 `tsdocLines`（join `\n`），行内位 = 新内部助手 `tsdocInline`（join `' '`），零新规范化 |
| SA8 前置核验：#306 已并（HEAD `4d4208b`），消费面就绪；无 #308/#309 隐藏依赖 | 冲突报告 §结论 | 设计输入面 = derived 第四表 only；文件范围排除 #308/#309 面（§11） |
| 契约风险登记：SA1 若设计不同 doc 渲染语义，必须先经 SA6 原位修订契约 | 契约 §15 | 本设计无不同语义——逐字节采用契约 §12.2/12.3，无需契约修订 |

上游事实与源码无矛盾（§2 表逐锚点复核）。

## 6. SA8约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| W1 坍缩位多行切换判据（成员条目在场，非值侧 kind；多行成员文法来源 = values 声明序） | §7 D3 | 判据 = `memberDocs` 键存在性（索引区间查键）；成员文本 = 逐成员投影（= 单行形态逐段，D6 结构化保证） | 否（与 SA6 §12.2 钉死值一致） |
| W2 多 doc 成员确定性拼接（逐位定义） | §7 D2/D5/D7 | 块位逐块叠加、行内位单空格串联；表不遍历、成员循环按声明序 → 确定性结构成立 | 否（与 SA6 §12.3 一致） |
| B1 范围边界：#307 = `packages/vfsl-codegen` only；不触 `packages/vfsl`（含 #308 面）、协议包、规格文本（#309 面） | §11 ALLOW/DENY | ALLOW 仅 3 个 src 文件 + 本设计产物；DENY 显式列出 #308/#309 面 | 否 |
| B2 集成惯例：实现挂 PR #305 同支累积、收官人工合并 | §11 备注 | 本 worktree 已在 `mabf/issue-307`（#313→#305 支）；提交/合并归 Runner Host，设计不产生 git 操作 | 否 |
| B3 环境义务：SA3 完成自检与 SA6/SA7 验收必须实跑 `pnpm generate --check`、包测试、根 typecheck | §12 验证门 | 沿用 SA6 §12.4 五门；本包 AGENTS「emitted types 变更时另跑根 typecheck 与 test」一并列入 | 否 |
| ADR 0005 D3：生成器是纯发射器，不得重推导语义 | §7 D1/D3/D6 | 成员边界信息**只**来自 derived `memberDocs` 键回填；逐成员投影复用既有 `projectValue` 分段，不新增语义推导 | 否 |
| ADR 0004/0005：类型树形状 = 生成契约；生成物确定性、`--check` 抓一切过期 | §8、§9 | 成员 doc 是注释：`VfslPathMap` 增广体、`PathSchema` 外壳、`PathKind` 尾参零变化；确定性论证见 §9 | 否 |
| ADR 0019 决策 6/8：四发射位 + 无发射位位点 + 纯文档性质（不进校验/物化/机器语义） | §7 全部、§8 数据流 | 纯文本发射，无任何语义面变化 | 否 |

## 7. 设计决策与主要备选方案

设计总原则：**接线是纯增量的**——`memberDocs` 表缺席（一切存量 schema）时，四条
改动路径的输出与 HEAD 逐字节相同；表在场时，仅在四个发射位插入 doc 字节 / 切换
坍缩位布局。成员边界信息只来自 `memberDocs` 键（ADR 0005 D3：消费派生物，不重推导）。

### D1 — EmitTables 第四槽（唯一数据入口）

- `EmitTables`（emitter.ts L121-129）新增 `memberDocs: Record<string, string[]> | undefined`
  （条件槽，与 derived 条件稀疏表同形）；注释由「七槽」改「八槽（memberDocs 条件）」。
- `generateProjection`（L146-154）接线一行：`memberDocs: derived.memberDocs`（逐字引用，
  不复制、不规范化）。
- **查表语义 = 只按索引查键，绝不枚举表**：唯一读法是
  `tables.memberDocs?.[`${path}.<member ${i}`]`，`path` 为发射位语法路径、`i` 为成员
  声明序。表键顺序与实现无关（确定性由构造保证）；越界/悬空键（手造 derived 才可能
  出现）永远不会被读到——与其他三张 docs 表的按键查找纪律一致，不新增响亮失败，也
  不静默改布局。
- 三个内部助手（emitter.ts 内，均为纯函数）：
  - `memberDocsAt(tables, path, i): readonly string[] | undefined` —— 单点查键；
  - `memberBlock(tables, path, i, indent): string` —— 块位渲染：
    `tsdocLines(memberDocsAt(...) ?? [], indent, tables)`（空 → `''`）；
  - `memberInlinePrefix(tables, path, i): string` —— 行内前缀：
    有条目 → `${tsdocInline(docs, tables)} `（单空格结尾），无 → `''`。

### D2 — 发射位 1：别名判别联合（`emitAlias` union×union 分支）块位渲染

现行为（L217-223）：`members = emitUnionBodyMembers(node, value, name, tables, semicolonFree ? '  ' : '', common)`，
返回 `` `${head}export type ${name} =\n  | ${members.join('\n  | ')}${term}` ``。

改动：成员文本获取**不变**；行装配改为逐成员：

```ts
const members = emitUnionBodyMembers(node, value, name, tables, tables.semicolonFree ? '  ' : '', common);
const lines: string[] = [];
members.forEach((text, i) => {
  const doc = memberBlock(tables, name, i, '  ');       // 键 = `${name}.<member ${i}>`
  if (doc !== '') lines.push(doc);
  lines.push(`  | ${text}`);
});
return `${head}export type ${name} =\n${lines.join('\n')}${term}`;
```

- 无 doc：`lines` = `['  | m0', '  | m1', …]`，join 后与既有
  `` `  | ${members.join('\n  | ')}` `` **逐字节相同**（纯装配重构，成员文本与
  `emitUnionBodyMembers` 零改动）。
- 有 doc：doc 块位于对应 `  | ` 行上方，缩进 `  `（与 `|` 列对齐）；多 doc / 多行体
  由 `tsdocLines` 既有语义逐字渲染（W2 块位）。
- `head`（别名级 aliasDocs）、`term`（默认 `;` / semicolonFree `` `''` ``）、
  semicolonFree 下成员对象字面量多行化布局全部维持既有行为；两种模式 doc 块位置相同。
- `emitUnionBodyMembers` 本体不改：块位（发射位 1）与行内位（发射位 3）的 doc 位置
  语义不同，放在共享助手里会耦合两种渲染（见备选 A2）。

### D3 — 发射位 2：别名坍缩位 W1 闸门 + 多行布局（`emitAlias` else 分支）

现行为（L224）：`` return `${head}export type ${name} = ${emitInner(node, value, name, tables, '')}${term}` ``。

改动：在既有单行路径**之前**加闸门（仅 leaf×enum / leaf×union 形态可能命中）：

```ts
const memberCount = value.kind === 'enum' ? value.values.length
                  : value.kind === 'union' ? value.members.length : 0;
const gated = memberCount > 0 &&
  Array.from({ length: memberCount }, (_, i) => memberDocsAt(tables, name, i)).some((d) => d !== undefined);
if (gated) {
  const segs = projectUnionMembers(value, tables.values);   // D6：成员文本 = 单行形态逐段
  const lines: string[] = [];
  segs.forEach((text, i) => {
    const doc = memberBlock(tables, name, i, '  ');
    if (doc !== '') lines.push(doc);
    lines.push(`  | ${text}`);
  });
  return `${head}export type ${name} =\n${lines.join('\n')}${term}`;
}
// 闸门闭合 → 既有单行路径逐字保留
return `${head}export type ${name} = ${emitInner(node, value, name, tables, '')}${term}`;
```

- **W1 判据（SA6 §12.2 钉死值，逐条落实）**：
  - 判据 = `memberDocs` 在 `Name.<member N>`（N ∈ [0, 值侧成员数)）上存在条目——
    不看值侧 kind、不看成员数量、不看模块内其他位点；
  - 按位点独立：同模块内有 doc 别名转多行、无 doc 别名单行并存（负控 #8 / W1 对照）；
  - 部分成员有 doc → 全成员逐行多行，无 doc 成员行前不垫 doc 行也不垫空行；
  - `derived.memberDocs === undefined`（含 M3 优先的标记联合位：doc 挂 markerDocs）
    → 闸门恒闭合，永不切换；
  - 值侧非 enum/union（scalar/pattern/object/array/ref…）→ `memberCount = 0`，闸门
    闭合，走既有路径（这些形态在 IR 上无 union 节点，`<member N>` 键不可能存在）。
- 成员文本来源 = `projectUnionMembers`（D6）：enum → `'lit'` / `String(lit)` 逐字面量；
  union → 逐成员 `projectValue`。与单行形态的分段严格一致（结构性保证，见 D6）。
- semicolonFree：同一装配，`term = ''`；doc 块缩进仍 `  `。
- **不做的事**：不重新推导成员边界（键回填 only）；不对「越界键」报错（见 D1）；不改
  markerDocs 在坍缩位的既有不发射行为（M3 优先负控断言 `载体口径` 零出现，现状即如此）。

### D4 — 发射位 3：内联联合行内前置（`emitInner` case `'union'`）

现行为（L289-293）：`return emitUnionBodyMembers(node, value, path, tables, indent, common).join(' | ')`。

改动（一行式）：

```ts
case 'union': {
  if (value.kind !== 'union') throw desync(node, value, path);
  const common = unionKind(node, tables, path);
  return emitUnionBodyMembers(node, value, path, tables, indent, common)
    .map((text, i) => memberInlinePrefix(tables, path, i) + text)   // 键 = `${path}.<member ${i}>`
    .join(' | ');
}
```

- 无 doc：前缀 `''`，join 字节与现状相同。
- 有 doc：前缀紧跟成员起点（`/** d */ Member`）；`\|` join 文法、成员文本、
  `common` 同形裁决、desync 守卫全部不变。ref 成员（规则 0 外壳 `PathSchema<A, 'map'>`）、
  map×object 成员（对象字面量）、去外壳成员三种形态统一前置。
- semicolonFree：成员对象字面量多行化时前缀仍在 `{` 之前（紧跟成员起点），无行尾
  空格（doc 块以 `*/` 收尾 + 单空格 + 成员文本）。
- 覆盖路径面：接口成员位（`emitInterfaceMember` → `emitNode` → `emitInner`）、嵌套
  对象成员位（`emitObjectMembers` → `emitNode`）、数组元素位（`path.<item>`）、
  Record `<key>` 位（`path.<key>`）——全部经 `emitInner` case `'union'`，一处接线
  全覆盖（键 = 各自完整语法路径 + `.<member N>`，与 walkDocs 键空间一致）。

### D5 — 发射位 4：内联枚举/标量联合坍缩位行内前置（`emitInner` case `'leaf'`）

现行为（L295-301）：值侧 scalar/enum/pattern/union 校验后 `return projectValue(value, tables.values)`。

改动：enum/union 值改走分段渲染（doc 感知），scalar/pattern 维持原样：

```ts
case 'leaf': {
  if (value.kind !== 'scalar' && value.kind !== 'enum' && value.kind !== 'pattern' && value.kind !== 'union') {
    throw desync(node, value, path);
  }
  if (value.kind === 'enum' || value.kind === 'union') {
    return projectUnionMembers(value, tables.values)
      .map((text, i) => memberInlinePrefix(tables, path, i) + text)
      .join(' | ');
  }
  return projectValue(value, tables.values);   // scalar / pattern 原样
}
```

- 无 doc：`projectUnionMembers(...).join(' | ')` 与 `projectValue(value)` 对 enum/union
  是同一表达式的分解（D6），字节相同。
- 有 doc：与发射位 3 同一前缀语义（`/** d */ 'draft' | /** d' */ 'submitted'`）。
- **此处不需要布局闸门**：内联位布局恒单行，doc 只是前缀；W1 闸门仅坍缩**别名**需要
  （那里才存在单行→多行的布局切换）。

### D6 — `projectUnionMembers`（valuetype.ts 内部助手，单一真相源）

```ts
/** 值侧联合成员逐段投影（#307）：enum → 字面量段；union → 成员投影段；
 *  与 projectValue 单行形态的分段严格一致（join ' | ' 即还原单行）。 */
export function projectUnionMembers(
  v: ValueSchema,
  values: Record<string, ValueSchema>,
  stack: readonly string[] = [],
): string[] {
  if (v.kind === 'enum') {
    return v.values.map((lit) => (typeof lit === 'string' ? `'${lit}'` : String(lit)));
  }
  if (v.kind === 'union') {
    return v.members.map((m) => projectValue(m, values, stack));
  }
  throw new Error(`projectUnionMembers: 非联合形值（kind=${v.kind}）`); // 内部误用守卫（响亮，不静默）
}
```

- `projectValue` 的 `case 'enum'` / `case 'union'` 重构为
  `return projectUnionMembers(v, values, stack).join(' | ')`——**保形重构**：两 case
  的既有表达式即「逐段 map + join ' | '」，分解后字节不变（既有金样本与负控锚定）。
- 收益：「成员文本 = 单行形态逐段」（SA6 反证探针 v5 Family B 不变量 / 契约 C3
  「成员文本 = 单行形态逐段」）从约定变成结构事实——多行布局的每一段与单行输出严格
  同源，不可能漂移。
- 仅包内导出（`export` 供 emitter 导入），**不进 `index.ts` 公共面**；非联合形值传入
  → 响亮 throw（防御性守卫；两个调用点均已被 enum/union 分支条件约束，正常输入不可达）。

### D7 — `tsdocInline`（docs.ts 内部助手）+ `tsdocLines` 保形重构

- 抽出单块渲染（既有表达式原样搬移）：

```ts
function tsdocBlock(d: string, indent: string, semicolonFree: boolean): string {
  return semicolonFree && d.startsWith('\n') ? `${indent}/**${d} */` : `${indent}/** ${d} */`;
}
```

- `tsdocLines(docs, indent, opts)` 改为 `docs.map((d) => tsdocBlock(d, indent, opts?.semicolonFree === true)).join('\n')`
  ——空/undefined 早退保留；**输出字节与现状完全相同**（既有 alias/field/marker doc
  金样本锚定）。
- 新增行内变体（W2 行内位钉死语义：逐块、单空格串联、零缩进）：

```ts
/** 行内位 doc 块（#307 W2）：每条 doc 一块、按源序以单个空格串联（无缩进、无换行分隔）。 */
export function tsdocInline(docs: readonly string[] | undefined, opts?: { semicolonFree?: boolean }): string {
  if (docs === undefined || docs.length === 0) return '';
  return docs.map((d) => tsdocBlock(d, '', opts?.semicolonFree === true)).join(' ');
}
```

- 多行 doc 体逐字保留（不重排续行缩进）——W2 块位金样本
  （默认 `  /** ␠\n   * 第一行\n   * 第二行\n    */`；semicolonFree 首行 `  /**` 无
  行尾空格）全部来自既有语义，本设计零新规范化。行内位遇到多行体时同样逐字发射
  （注释块内嵌换行，TypeScript 合法；见 §13 R3）。
- docs.ts 文件头注释「docs 三槽」改「docs 四槽（含 #307 memberDocs）」；
  `tsdocLines`/`tsdocInline` 的 `opts` 参数沿用现状——调用方直接传 `tables`
  （EmitTables 结构兼容 `{ semicolonFree?: boolean }`）。
- 均不进 `index.ts` 公共面。

### D8 — 无发射位边界：结构性保证，非特判丢弃

四类不发射位全部由「doc 查找点只存在于四个发射位」这一结构事实保证，无任何
`if (isPlain) skip` 式特判：

| 位点 | 代码路径 | 为何零发射 |
|---|---|---|
| YPlainArray 纯值子树（键 `…<item>.<member N>` 照常收集） | `emitInner` case `'plain'` → `projectValue(value.element)` | `projectValue` 无 doc 感知且**保持无 doc 感知**（D6 只加分段助手，不给 projectValue 加路径/查表参数）；该路径无 `memberInlinePrefix` 调用 |
| YXmlFragment 实参（键 `ROOT.x.u.<member N>` 照常收集） | `emitInner` case `'xml-fragment'` → `'string'` 不透明终态 | 不递归实参，子树键不可达 |
| M3 优先位（doc 挂 markerDocs，memberDocs 整键缺席） | 任意发射位 | D1 查键返回 undefined → 前缀 `''` / 闸门闭合；坍缩位 markerDocs 的既有不发射行为不变 |
| 无 doc 的联合/枚举/内联位 | 全部 | 条件稀疏表缺席或键缺席 → 四个发射位输出与 HEAD 逐字节相同（D2–D5 逐条论证） |

doc 查找点全集 = `emitAlias` union×union 行装配（D2）、`emitAlias` 坍缩闸门与多行
装配（D3）、`emitInner` case `'union'` map（D4）、`emitInner` case `'leaf'`
enum/union 分支（D5）。`emitNode`（markerDocs 行内渲染）、`emitObjectMembers`
（fieldDocs 两种模式布局）、`emitInterfaceMember`（fieldDocs）均零改动。

### 备选方案（未选择及原因）

| # | 方案 | 否决原因 |
|---|---|---|
| A1 | 把 doc 前缀下沉进 `projectValue`（值投影自带查表） | plain 纯值子树同走 `projectValue` → 成员 doc 泄漏进无发射位，直接撞负控 C9（`纯值成员` 零出现）；且 projectValue 无语法路径上下文，需改签名污染全部调用点 |
| A2 | 在 `emitUnionBodyMembers` 内加「块位/行内」模式参数统一渲染 | 共享助手耦合两种位置语义；助手被 emitAlias/emitInner 两处复用，模式分支增加走样面；调用点装配（D2/D4）让两发射位各自独立、互不牵连 |
| A3 | 坍缩位多行成员文本 = 对单行串按 `' \| '` 字符串切分 | 字符串手术：嵌套 union 成员 / 对象字面量成员内含 ` \| ` 时切错段；D6 结构化分段无此风险 |
| A4 | 坍缩位按值侧 kind（enum → 恒多行）或成员数量切换布局 | 违反 W1 钉死判据；无 doc 枚举被强制多行 → 负控 #6/#10（金样本单行 + 存量 domain 逐字节）必红 |
| A5 | 枚举 `memberDocs` 表驱动遍历（按表键序生成成员行） | 表遍历引入键顺序依赖，且无 doc 成员不在表内无法生成；声明序索引循环（D2–D5）天然确定且覆盖无 doc 成员 |
| A6 | 为成员 doc 发射新增独立错误类/降级路径 | 无新失败语义需求：输入对齐由 evaluate 冻结契约保证（walkDocs 键 = IR 成员序 = 值侧成员序），异常路径沿用既有 desync/联合同形裁决，先于 doc 渲染 |

## 8. 接口、状态机与数据流

**接口变化**：无公共接口变化。`generateProjection(derived, opts?)` 签名、
`GenerateProjectionOptions`、返回 string 不变；`DerivedSchema.memberDocs` 已由 #306
声明（本设计只消费）。变化全部在包内私有结构：`EmitTables` 增一槽、emitter/docs/
valuetype 增内部助手。**无状态机**（纯函数，无状态、无缓存、无 IO）。

**伪代码总览**（发射期成员 doc 数据流，全部在单次 `generateProjection` 调用内）：

```
generateProjection(derived, opts)
  tables.memberDocs = derived.memberDocs            // D1：唯一入口，逐字引用
  emitAlias(name):
    union×union → D2 行装配（块位 doc，键 name.<member i>）
    else        → D3 闸门（键 name.<member i>，i < 值侧成员数）
                  ├ 命中 → projectUnionMembers 分段 + 块位 doc 多行
                  └ 闭合 → 既有单行 emitInner 路径（逐字保留）
  emitInterfaceMember / emitObjectMembers → emitNode（零改动）→ emitInner:
    case 'union' → D4：成员文本 map(行内前缀, 键 path.<member i>) join ' | '
    case 'leaf'  → D5：enum/union → projectUnionMembers + 行内前缀；scalar/pattern 原样
    case 'plain' / 'xml-fragment' / 其余 → 零改动（无 doc 查找点 = 无发射位）
```

**数据流路线**（生成物内容路径变化；无运行时持久化/传输面）：

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| 1 schema→derived | `pnpm generate`（CLI）/测试入口，`schema.vfsl` 文本 | parser M4 → IR `union.memberDocs`（条件键）→ evaluate walkDocs → derived `memberDocs`（条件稀疏） | 跨包边界一次：`packages/vfsl` → `packages/vfsl-codegen`，载体 = `DerivedSchema`（冻结形状，#306 已落）；生成器零重推导 | 内存（纯数据） | `generateProjection` D1 接线 | 四发射位 doc 字节进生成物；无 M4 → 表缺席 → 零新字节 | 解析/求值失败 = 既有 E305/E100 面，本设计不触 | 契约红因前置断言（键在场）+ 负控 #4 |
| 2 derived→生成物 | `generateProjection` | 四发射位字节插入（D2–D5）/ 坍缩位布局切换（D3） | 查键 only、声明序循环、无表遍历；doc 渲染 = tsdocLines/tsdocInline 逐字 | 返回 string | CLI 写盘 `domains/<id>/generated.ts`（既有） | 带 doc 生成物；hover/AI 读码/生成文档获得逐成员语义 | 发射期异常 = 既有响亮失败（desync/UnsupportedUnionKind/Root 引用/碰撞守卫），无新失败类 | C1–C8、C12 |
| 3 生成物→新鲜度 | `pnpm generate --check`（CI regen-diff） | 内存重生成 + 逐字节 diff（既有机制零改动） | 两种格式互斥、生成与 check 同取值（既有 fail-closed） | 仓内 `generated.ts` | CI | M4 域：fresh；存量域（无 M4）：字节不变 → 不报过期 | 漂移 → 非零退出（既有） | C11、负控 #9/#10 |

## 9. 错误、恢复、并发和幂等

- **错误语义零变化**：不新增错误类、不新增静默降级、不改变任何既有 throw 的触发
  条件与顺序（root 形态/N3 碰撞守卫先于发射；desync/联合同形/ROOT 引用/值环守卫
  在 emitInner 各 case 内原位）。唯一新 throw = `projectUnionMembers` 内部误用守卫
  （D6，正常输入不可达）。成员 doc 是注释，不影响任何类型诊断（C12 孤立 tsc 零诊断）。
- **确定性**：`generateProjection` 纯函数无状态；memberDocs 只做索引查键（无枚举、
  无键序依赖），成员循环按声明序（`values`/`members`/`node.members` 数组序）；同输入
  两次发射逐字节一致（W2 用例双发断言锚定）。无定时器、无随机、无环境读取。
- **幂等/重试**：`generate` → `--check` 同字节幂等（两种模式各自闭环保留）；无副作用、
  无需回滚协议——实现出错的回滚 = revert 三个 src 文件（无持久化状态、存量 domains
  生成物不受影响，因其无 M4 输入）。
- **并发**：无共享状态、无 IO 竞态面（CLI 文件系统关注点保持在边缘，本设计不触）。
- **正常路径不变量缺失即响亮**：值侧/结构侧失配、异形联合、ROOT 被引用等仍按既有
  命名化异常拒绝——本设计不为绕过它们增加任何 fallback。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `collect.ts` `projectionText`（CLI generate/--check 唯一编排） | 透传完整 derived 给 `generateProjection` | 完全相同（签名未变；derived.memberDocs 随对象自然到达） | **零** | collect.ts L91；SA6 §10「不改 cli/collect」 |
| `cli.ts`（参数面/写盘/孤儿检查） | 不感知 docs 表 | 完全相同 | **零** | cli.ts；契约 C11 走 CLI 子进程验证 |
| `index.ts` 公共导出面 | 仅 `generateProjection` + 选项类型 | 相同（tsdocInline/projectUnionMembers 仅包内） | **零** | index.ts L7-8 |
| 既有测试 8 文件 62 例（金样本/负控） | 断言无 M4 fixture 的输出字节 | 输出逐字节不变 → 全绿保持 | **零** | SA6 §4 基线；§7 负控 #5–#8 |
| 契约测试 33 例 | 23 红（doc 缺失）/ 10 绿 | 33/33 绿（实现后） | **零（不许改）** | 契约 §12/§13；§11 DENY |
| 生成物消费方（hover/AI 读码/生成文档、`@stylistic` 消费仓） | 看不到成员语义 | M4 域获得逐成员 TSDoc；无 M4 域零字节变化；semicolonFree 仓零分号 + 无行尾空格保持 | **零** | ADR 0019 决策 6；README 无分号节 |
| `domains/vfs3-assets` 存量域 | 生成物入仓、CI regen-diff | 逐字节不变、`--check` fresh | **零** | 契约负控 #9/#10 |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/vfsl-codegen/src/emitter.ts` | EmitTables 增 `memberDocs` 槽 + generateProjection 接线一行（D1）；`emitAlias` union×union 行装配（D2）与坍缩闸门/多行（D3）；`emitInner` case `'union'` 前缀 map（D4）与 case `'leaf'` enum/union 分段（D5）；三个查键/渲染助手；相关注释更新（七槽→八槽、leaf 注释补成员前缀） | 四发射位唯一生产改动面（SA6 §10 同判） |
| `packages/vfsl-codegen/src/docs.ts` | 抽 `tsdocBlock`（保形）、新增 `tsdocInline`（D7）；文件头注释三槽→四槽 | W2 行内位渲染 + 块位渲染单一真相源 |
| `packages/vfsl-codegen/src/valuetype.ts` | 新增 `projectUnionMembers`（包内导出）、`projectValue` enum/union 两 case 保形重构（D6） | 坍缩位/内联位成员分段单一真相源（「成员文本 = 单行形态逐段」结构化） |
| `wiki/raw/task_issue-307_design.md` | 本设计产物 | SA1 固定产物位 |

（若实现证明 valuetype/docs 的助手可以内联进 emitter 而更简，允许把 D6/D7 收拢进
emitter.ts 单文件——但「分段与单行同源」「doc 渲染单一真相源」两个不变量必须保持，
且 ALLOW LIST 不得扩大到上表之外。）

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/vfsl-codegen/test/generate-union-member-docs.test.ts` | SA6 验收契约（33 例） | 验收真相；弱化/改写即契约失效。实现与其断言冲突时必须先经 SA6 原位修订契约（契约 §1/§15），不得由实现侧改测试将就 |
| `packages/vfsl-codegen/test/**`（其余 8 文件 + `tsc-helper.ts`） | 既有基线金样本 | 基线锚定「无 doc 逐字节不变」；实现不得调测试适配输出 |
| `packages/vfsl/src/resolve-schema-at-path.ts` | #308（ADR 0019 决策 7，readData docs 切片第三来源） | B1 范围边界：越界即任务串联 |
| `packages/vfsl/**`（parser/ir/semantic/derived/evaluate/fingerprint 等） | #306 已合并的输入链 | 输入面已冻结；生成器只消费派生物（ADR 0005 D3）；指纹稳定性义务已由 #306 兑现 |
| `docs/vfsl/v1-spec*.md`（§5 挂载锚位）、`docs/vfsl/schema-authoring-guide.md`（§7/8） | #309 规格与指南修订 | B1：#307 不承担 spec 欠账 |
| `packages/vfsl-codegen/src/cli.ts`、`collect.ts`、`index.ts`、`header.ts`、`protocol-surface.ts` | CLI/编排/公共面 | 无功能需求（derived 已透传、签名未变）；公共面冻结（index.ts 最小化注释） |
| `packages/vfsl-protocol/**`、其余 `packages/**`、`apps/**` | 类型投影消费面 | 成员 doc 是注释，类型形状零变化（C12 兜底） |
| `domains/**`（含 `domains/vfs3-assets/generated.ts`） | 存量域生成物 | AC3：存量逐字节不变、`--check` 不报过期；不得手工改生成物 |
| `wiki/raw/task_issue-307.md`、`…_sa6_contract.md`、`…_conflict_report.md` | Host/上游只读输入 | 管线固定产物，SA1 只读 |

集成惯例备注（B2，非文件项）：实现提交挂 PR #305 同支累积（本 worktree 分支
`mabf/issue-307` 已在该支系）；提交/合并由 Runner Host 执行，本设计不产生 git 操作。

## 12. 验收与验证映射

验收真相 = SA6 契约测试（33 例）+ §12.4 验证门。SA1 不写/不跑测试；下表把每条设计
路线挂到可执行断言。

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| D2 发射位 1（别名联合块位，map/ref 成员、双模式） | 契约红 3 例（决策 6.1 组） | 既有契约用例（已写定） | doc 行位于 `  \| ` 上方、缩进对齐；成员文本与无 doc 时一致；semicolonFree 无分号同布局 |
| D3 发射位 2（坍缩位多行切换 + W1 判据） | 契约红 4 例（枚举/标量联合/部分 doc/semicolonFree）+ 判据独立性红 1 例 | 既有契约用例 | 有 doc → `export type X =` 换行 + `  \| ` 逐成员；部分 doc → 全成员多行仅 doc 成员带 doc 行；同模块无 doc 别名单行并存 |
| D4/D5 发射位 3/4（内联行内前置） | 契约红 7 例（ref/枚举/标量联合/map 判别/数组元素位/部分 doc/semicolonFree） | 既有契约用例 | `PathSchema</** d */ M0 \| /** d' */ M1, kind>`；join 文法不变；前缀紧跟成员起点 |
| D7 W2 多 doc / 多行体渲染 | 契约红 4 例 + 双发一致性断言 | 既有契约用例 | 块位逐块叠加、行内单空格串联；多行体默认 `/** ` 行尾空格保留、semicolonFree 剥除；两次发射逐字节一致 |
| D1/D8 无 doc 逐字节不变 + 无发射位 | 负控绿 10 例（含存量 domain 逐字节、仓根 `--check` exit 0） | 既有契约负控（实现后必须保持绿） | 无 M4 fixture 与 HEAD 金样本逐字节相同；plain/xml 零 doc 字节；M3 优先位单行 |
| 类型面（注释不改类型形状） | 契约红 2 例（孤立 tsc） | 既有契约用例（默认/semicolonFree） | `preEmitDiagnostics` 为空 |
| CLI 端到端（写盘 + 新鲜度闭环） | 契约红 2 例 | 既有契约用例（临时 domain，双格式） | 写盘含 doc 文案；同格式 `--check` exit 0；零分号域零分号 |
| 验证门（AC4，B3） | SA6 §4 基线 + §12.4 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl-codegen`（95/95）；`pnpm --filter @nomicore/vfsl-codegen typecheck`；仓根 `pnpm generate --check`；根 `pnpm typecheck`；按包 AGENTS（emitted types 变更）另跑根 `pnpm test`（SA7 收官） | 全部 exit 0 / 全绿；负控不因实现走样而红 |
| 保形重构无漂移（D6/D7） | 既有 8 文件 62 例金样本（alias/field/marker doc 字节、enum/union 单行） | 既有测试即回归网 | 62 例保持全绿（无 M4 输入下输出逐字节不变） |

## 13. 风险、回滚和残余问题

| # | 风险 | 等级 | 缓解 / 依据 | 失败可重试 | 回滚条件 |
|---|---|---|---|---|---|
| R1 | 无 doc 路径字节漂移（装配重构引入走样） | 中 | D2–D5 每条路径给出「无 doc 输出 = 既有表达式」的逐字论证；负控 #5–#8 金样本 + 存量 domain 逐字节 + `--check` 三层网 | 是（修实现重跑） | 负控任一红 → 实现返工（不是设计缺口） |
| R2 | D6/D7 保形重构漂移 | 低 | 分解的是同一表达式（map+join / 单块渲染函数搬移）；既有 62 例含 doc 金样本与单行金样本双向锚定 | 是 | 既有任一金样本红 |
| R3 | 行内位遇多行 doc 体：注释块内嵌换行出现在单行类型实参内 | 低 | TypeScript 合法（注释可出现在类型实参空白处）；tsdocInline 逐字语义与块位一致、确定性；契约未覆盖该组合（W2 行内用例均为单行 doc）——**已定义语义，非未决**；如消费方（如某 lint 规则）不接受，属新决策，另立票据走 SA6 契约修订 | — | 不阻塞；登记为已知语义 |
| R4 | 手造 derived 携带越界 `<member N>` 键或与值侧成员数不对齐 | 低 | 查键 only：越界键永不读取（无遍历）；正常链路键序 = IR 成员序 = 值侧成员序（evaluate 冻结契约 + guardMemberDocs）；与其他三张 docs 表的按键查找纪律一致，不新增失败面 | — | 不适用（不可达） |
| R5 | 契约后续修订（W1/W2 语义变化）导致设计-契约错位 | 低 | 本设计逐字采纳契约 §12.2/12.3；若 SA6 原位修订契约，SA3 实现须以修订版为准并同步回改 D3/D7 对应段 | — | 契约修订时重读本设计对应节 |
| R6 | 环境：门禁环境缺依赖 | — | B3：SA3 自检/SA6/SA7 验收前 `pnpm install --frozen-lockfile`（SA6 §4 已验证本 worktree 可装可跑） | 是 | — |

**任务内必要条件**：无未决阻塞项。**明确 follow-up（非本任务）**：#308
（readData docs 切片第三来源）、#309（v1-spec §5 四锚位 + schema-authoring-guide
§7/8 同步）、R3 若消费方反馈再议。

## 14. 评审修订映射

`wiki/raw/task_issue-307_sa2_review.md` 不存在（iteration 0，尚无评审输入）——本节
无适用 finding。评审到达后由后续 iteration 逐条落实并填表。

## 15. 设计后 ADR 冲突复查结论

**`requiresConflictRecheck = false`**。理由：

- 规范来源直接且已 accepted：本设计是 ADR 0019 决策 6 的忠实实现（其后果清单原文
  登记「`packages/vfsl-codegen`：emitter.ts 四发射位（含枚举多行布局、semicolonFree
  模式同布局）」为交付物），不修订、不收窄、不静默改写任何决策；SA8 前置门禁
  Verdict `clear`（冲突点 0）。
- 无公共 API、wire、schema、持久化、状态机语义变化：`generateProjection` 签名与
  `DerivedSchema`（#306 已落）零改动；`memberDocs` 消费是纯发射器对既有派生物的
  读取（ADR 0005 D3 纪律内）；生成物变化仅为 ADR 明文要求的新注释字节。
- 无新生命周期所有权 / 失败语义：错误面与失败顺序完全沿用现状（§9）。
- W1/W2 两处实现自由度已由 SA6 契约钉死，本设计逐字采纳、无第二种解释（§5 表末行）。

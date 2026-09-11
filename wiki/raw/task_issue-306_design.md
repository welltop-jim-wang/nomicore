# 设计产物 — issue #306：M4 联合成员文档注释（解析挂载 + IR/derived `memberDocs`）

- **Dispatch**: sa-aba44c9b-193b-477c-9f3b-93e38d93b7cb（mabf-sa1 / design / iteration 0）
- **Worktree**: `/home/wangjian/nomicore-fix-issue-306`，branch `mabf/issue-306`，HEAD `91c4add`（`git status`：生产文件零改动，未跟踪文件仅 Host 简报、SA6 契约测试 3 件、SA8 报告）
- **规范权威**: ADR 0019（已接受、未被取代）＋ `docs/vfsl/v1-spec.md` §4/§5/§8/§10 ＋ `packages/vfsl/AGENTS.md`
- **设计产物**: 本文件（唯一设计产出）

---

## 1. 任务类型、目标与非目标

**任务类型：Feature（能力缺口 → 增量能力）**，附一条 ADR 0019 决策 9.3 授权的既有消息措辞变更，与一组必须逐字节保持的冻结行为。不是 bug 修复：成员 doc 现行落 E305 是 v1-spec §5「三锚位」现行文本的规格要求行为（SA6 §1 已定性，SA8 矩阵 10 已核授权链）。

**目标（#306 范围 = `packages/vfsl` 五个源文件）**：

1. **Parser 附着点（M4）**：联合成员前的文档注释从 E305 拒绝变为合法挂载——doc 紧邻 `|` 之前挂后继成员；首成员无前导 `|` 时挂成员起始记号；连续多条 doc 按序同挂一成员（ADR 0019 决策 1）。
2. **IR 表示**：union 节点条件键 `memberDocs?: string[][]`——与 `members` 等长对齐、无 doc 成员为空数组、全体成员均无 doc 时整键不存在（决策 4）。
3. **derived 表示**：`DerivedSchema` 条件稀疏 `memberDocs?: Record<string, string[]>`——键走既有 `<member N>` 路径文法、只收非空条目、无成员 doc 的模块派生物不含该键（决策 5，显式修订 ADR 0003 docs 表条款）。
4. **校验边界**：手造 IR 的 `memberDocs` 畸形（非等长数组的数组）走 loud 边界 → `evaluate` 返回 `ok:false` 恰一条 `VFSL-E100`、无 `derived` 载荷（决策 5）；`validate.ts` / 物化路径不读成员 doc（决策 8）。
5. **兼容/指纹保持**：无成员 doc 的存量 schema 的 IR JSON、semantic 指纹（`sha256:v1:` 前缀）、derived JSON 逐字节不变；E305 触发面只缩小；M3 优先不双挂（决策 2/3/4/9）。
6. **E305 消息正文**：可挂载节点枚举补「联合成员」（前缀 `VFSL-E305: ` 冻结，v1-spec §4）。

**非目标（明确出界，SA8 C-5）**：

- `packages/vfsl-codegen` 四发射位与 `generate --check` → **#307**；
- `resolveSchemaAtPath` docs 切片第三来源合并（ADR 0016 经 0019 修订）→ **#308**；
- v1-spec §5 / schema-authoring-guide / 检查表 / 全仓「三锚位」措辞 → **#309**（与实现同支落地，PR #305 收官门槛，C-1）；
- tokenizer 侧通道改动（ADR 0019 决策 10 明确不做）；单成员坍缩场景发明挂载目标（决策 2）；校验错误回带成员 doc（决策 8）。

---

## 2. 当前行为与证据锚点（实现前基线）

### 2.1 doc 侧通道与集中式记账（现行机制，M4 复用而非修改）

| 环节 | 行为 | 锚点 |
| --- | --- | --- |
| tokenizer pending 缓冲 | 连续 doc 注释累积到 `pending`，随下一个真实记号 emit 挂靠为其 `leadDocs`（忽略型注释/空白不中断） | `tokenizer.ts:72-82`（pending/emit）、`tokenizer.ts:175-177`（doc 分类入 pending） |
| parser 集中式记账 | 任何非 error 记号被 `next()` 消费时，其 `leadDocs` 一律并入 `dangling`；`depositedByLast` 记录「刚消费记号」的存入条数 | `parser.ts:134-146`（next）、`parser.ts:141-144`（存入） |
| 三锚位回收 | `claimDocs()` 只回收「刚消费记号」存入的尾部 `depositedByLast` 条；全 parser 恰三个调用点：M1 别名起点（`parseModule` 消费 `type` 后）、M2 字段名（`parseObjectType` 消费字段名后）、M3 标记名（`parseMarkerType` 直通） | `parser.ts:148-156`（claimDocs）、调用点 `parser.ts:209`（M1）/`parser.ts:522`（M2）/`parser.ts:434`（M3） |
| union 解析零回收 | `parseUnionType` 消费前导 `\|` 与成员起始记号时不调用 `claimDocs()`——成员 doc 留在 `dangling` | `parser.ts:255-269` |
| 记账不变量 | `claimed + dangling.length === docTotal`，失衡抛普通 Error → `index.ts` 顶层兜底 E100 | `parser.ts:118-123`（docTotal）、`parser.ts:220-222`（核对） |
| E305 判定 | `parseModule` 返回 dangling（仅行列）；`analyze` 为每条 dangling 立 E305 候选，锚注释起始（DocLead 自带） | `parser.ts:223`、`semantic.ts:71-83`（消息正文在 `semantic.ts:76`） |

### 2.2 AST → IR → derived → 指纹（现行形状）

- AST union 节点：`{ kind: 'union'; members: AstType[]; pos: Pos }`（`parser.ts:41`，内部结构非公共契约——`index.ts` 不导出 `AstType`）。
- IR union 变体：`{ kind: 'union'; members: VfslType[] }`（`ir.ts:45`，经 `index.ts:60-67` 导出 `VfslType`）。AST→IR 转换 `semantic.ts:222-223` 只产 `{kind, members}`。
- `DerivedSchema` 恰七键：`aliases/structure/values/index/aliasDocs/fieldDocs/markerDocs`（`derived.ts:69-84`）；docs 收集 `DocsTables` 仅三表（`evaluate.ts:338-342`），`walkDocs` union 分支只递归 members、不落任何表（`evaluate.ts:380-382`）；`<member N>` 合成段文法已存在（`evaluate.ts:381`）。
- 手造 IR 守卫族：`put`/`appendDocs` 对 alias/field/marker 三槽「缺失/非数组 → TypeError」→ evaluate 顶层 catch → E100（`evaluate.ts:344-354`、`evaluate.ts:74-77`）。
- semantic 指纹 = `{domain, lang, version, module}` 紧凑 JSON 的 SHA-256，前缀 `sha256:v1:`（`fingerprint.ts:55-57`、`fingerprint.ts:24`）；单一生产者插入序 canonical（D2-CONTRACT-MARKER，`fingerprint.ts:7-14`）。

### 2.3 union 节点的盲读消费方（本设计不改它们的union 分支）

`resolve.ts:188-193/209-217/230-242`（Cls 折叠只读 `members`）、`shapes.ts`（AST walk 只读 `members`）、`validate.ts:350/517`、`validate-patch.ts:160/247`、`resolve-schema-at-path.ts:279/394`、`evaluate.ts` 结构/值树分支（`evaluate.ts:116-121/149-156/298-307`）——全部按 `kind` 判别后只读 `members`/`marker`/`arg`，不重构 union 节点。`StructureNode`/`ValueSchema` 的 union 形状（`derived.ts:33/48`）不含 docs。

### 2.4 基线数字（SA6 录制，实现前 HEAD `91c4add`）

- `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/vfsl`（宽过滤）→ 43 files / 682 tests 全绿；
- 加入 2 个契约测试文件后 `npx vitest run packages/vfsl/test` → 607 绿 + 12 红（红全部在新契约文件内，存量零回归）；
- `npx tsc -p packages/vfsl/tsconfig.json` exit 0；根 `pnpm typecheck`（14 个 tsconfig）exit 0；
- 金样本（E-1，实现前录制，SA4 **不得重录**）：

| 样本 | IR JSON SHA-256 | semantic 指纹 | derived JSON SHA-256 |
| --- | --- | --- | --- |
| v1-spec §10 fixture（A） | `325cf923…f3ffc` | `sha256:v1:b71be76e…0631c` | `2335a023…375b` |
| 联合密集 fixture（B） | `78332590…be71` | `sha256:v1:55095e88…144d` | `547748b6…492f` |

（精确值见 `packages/vfsl/test/parse-vfsl-union-member-docs.test.ts:33-36`、`evaluate-derived-member-docs.test.ts:26-27`。）

---

## 3. 根因 / 能力缺口（承接结论）

能力缺口链（SA6 §8，本设计逐条承接）：parser 集中式 dangling 记账只在 M1/M2/M3 三锚位回收，`parseUnionType` 消费前导 `|` 与成员起始记号时零回收（`parser.ts:255-269`）→ 成员 doc 留悬空候选 → E305；IR 面 `toIRType` union 分支无 `memberDocs`（`semantic.ts:222-223`）；derived 面 `DocsTables` 仅三表、`walkDocs` union 分支不落表（`evaluate.ts:338-342/380-382`）；守卫面 memberDocs 不在 `put/appendDocs` 守卫族入口内 → 手造畸形静默忽略（SA6 用例 11 实测 `ok:true`）。最深根因是 v1-spec §5 冻结「三锚位」：M4 需要**延迟回收**（成员数须扫到表达式末尾才知坍缩与否，ADR 0019 决策 4 末段），该机制未实现。

---

## 4. Owner 要求落实

issue #306 **无适用 Owner 评论**：Host dispatch 明示「REST comment read returned an empty array」；SA6 §2 与 SA8 报告均独立复核一致（`gh issue view 306` → `comments:0`）。因此无「评论 vs ADR」裁决项，需求面 = issue 正文 What-to-build + AC1~AC6。正文要求逐条映射：

| 正文要求（issue #306） | 设计位置 |
| --- | --- |
| doc 紧邻 `\|` 之前挂后继成员；首成员无前导 `\|` 挂成员起始记号 | §7 D1（附着点 A/B） |
| 成员 doc 进 IR（union 条件 `memberDocs` 键，与 members 等长） | §7 D3 |
| derived 条件稀疏 `memberDocs` 表，`<member N>` 键 | §7 D4 |
| 单成员坍缩维持 E305 | §7 D1（坍缩不结算）＋ §12（用例 8） |
| `\|` 夹缝 doc：非标记成员 E305、标记成员按 M3 挂载不双挂 | §7 D1（附着点只认 `|`/成员起始两类锚）＋ D2（核对失败=已被 M3 回收） |
| E305 消息补「联合成员」 | §7 D6 |
| 纯文档性质，不进校验与物化 | §7 D7（盲读不变式） |

---

## 5. 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
| --- | --- | --- |
| 19 契约用例 12 红 / 7 绿，失败集合三次运行逐字一致；红因全部为能力缺口/键缺席/措辞未补 | SA6 §5/§7/§13；`packages/vfsl/test/parse-vfsl-union-member-docs.test.ts`（13 用例）、`evaluate-derived-member-docs.test.ts`（6 用例） | 本设计 §7 每项决策均映射到契约用例（§12）；契约文件为冻结验收输入，实现只许使其转绿 |
| 直接故障点：`parseUnionType` 零回收；`claimDocs` 恰三调用点 | `parser.ts:141-144/151-156/209/522/434/255-269` | §7 D1 在 `parseUnionType` 内新增第四类回收（记录＋终局核对），不动 `claimDocs` 与三锚位 |
| M3 优先是既有行为（`\| /** d */ YLeaf<"a">` 现行 `ok:true` 挂 marker 恰一次） | SA6 §9 E-b；契约用例 7/10 | §7 D2 引用同一性核对天然实现「M3 先回收则 M4 放弃」（不双挂冻结约束） |
| 手造 IR 畸形 memberDocs 现行 `ok:true` 静默忽略 | SA6 §9 E-d；契约用例 17 | §7 D5 守卫族同族延伸（TypeError → E100） |
| 金样本 A/B 摘要实现前 3 次稳定复现 | SA6 §9 E-e；契约文件常量 | §7 D3/D4 条件附加保证逐字节稳定；§12 用例 18/19 与 derived 金样本锚定 |
| 契约交付即红（SA4 落地前 CI vitest 门禁红） | SA6 §15.3 | §13 风险 3 登记（仓库既有先例） |

上游事实与源码无矛盾（本设计逐锚点复核了 SA6 引用的全部行号）。

---

## 6. SA8 约束落实

SA8 固定位置产物 `wiki/raw/task_issue-306_relevant_decisions.md` 与 `wiki/raw/task_issue-306_conflict_report.md` **不存在**；等价 SA8 门禁产物为 `.scratch/sa8-conflict-report-issue-306.md`（verdict **clear**，阻塞冲突 0 项——SA6 输入表同引），决策面由该报告 ＋ ADR 0019 直接承载。本设计按其约束清单逐条落实：

| SA8 约束 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
| --- | --- | --- | --- |
| C-1 规格同支同步（#309，PR #305 收官门槛） | §1 非目标、§11 DENY LIST | #306 不改规格文本；红/绿分流保证实现与 #309 可分步落地 | 否（排期依赖边已编码，无静默矛盾） |
| C-2 指纹纪律（强） | §7 D3/D4、§8 数据流 | 条件键只在「v1 原本 E305 拒绝的文本」产物上出现；存量 IR/derived/指纹逐字节不变；无第二规范化层；`sha256:v1:` 不升级 | **是**（见 §14：公共类型面/持久化语义变化的例行复查） |
| C-3 E305 触发面只缩小 | §7 D1/D6、§12 用例 8/9/10 | 坍缩两形态与 `\|` 夹缝（非标记成员）维持 E305（现行锚点冻结）；不新增错误码 | 否 |
| C-4 纯文档纪律 | §7 D7 | `validate.ts`/`validate-patch.ts`/物化路径零改动、零读取 memberDocs | 否 |
| C-5 分支中间态豁免（#307/#308/#309 不判缺陷） | §1 非目标、§10 调用方矩阵、§13 残余 4 | codegen/投影对 memberDocs 盲读（见 §2.3 证据）；#306 验收面不含二者 | 否 |
| C-6 消息变更边界 | §7 D6 | 只动 message 正文；前缀 `VFSL-E305: ` 冻结；全仓既有断言仅前缀正则（`parse-vfsl-jsdoc.test.ts:127`，已复核） | 否 |
| E-1 存量稳定金样本 | §2.4、§12 用例 18/19 ＋ derived 金样本 | 契约已含且先于实现录制；设计禁止 SA4 重录 | — |
| E-2 M4 矩阵 | §7 D1/D2、§12 用例 1-4/7-11 | 两锚位正例、连续 doc、坍缩、夹缝两态、叠写各归各锚位 | — |
| E-3 derived 条件稀疏 | §7 D4、§12 用例 12-14 | 键序、只收非空、整键缺席、嵌套路径合成 | — |
| E-4 手造 IR 守卫 | §7 D5、§12 用例 16/17 | 4 类畸形 → 恰一条 E100、无 derived；良性等长正控 | — |
| E-5 门禁绿 | §12 验证命令 | 契约 19 用例 ＋ 存量 607 ＋ 包/根 typecheck | — |
| E-6 规格一致性 | 出界（#309 验收面） | 本设计不越界断言规格文本 | — |

---

## 7. 设计决策与主要备选方案

### D1. Parser 附着点：M4「记录位置 + 终局核对」延迟回收（ADR 0019 决策 1/4 的机制化）

**附着点定义（两条子规则，零 tokenizer 改动）**：

- **附着点 A（前导 `|` 记号锚）**：`parseUnionType` 内每次 `this.next()` 消费一个 `|`（含首个前导 `|` 与后续成员分隔 `|`）后，该 `|` 记号的 `leadDocs`（即 tokenizer 挂靠其上的、紧邻 `|` 之前的全部 doc）是**后继成员**的候选 doc。记录 `{ start: dangling.length - depositedByLast, leads: dangling.slice(尾部 depositedByLast 条) }`（DocLead 引用）。
- **附着点 B（成员起始记号锚）**：仅当首成员**无**前导 `|` 时——进入 `parsePostfixType()` 之前 `peek()` 所指记号即成员起始记号（`parsePostfixType → parsePrimaryType` 的第一次 `next()` 恰消费它），其 `leadDocs` 是首成员的候选 doc。记录 `{ start: dangling.length（消费前快照）, leads: peeked.leadDocs ?? [] }`。
- 后续成员（成员 1..n-1）恒有前导 `|`，恒走附着点 A；`|` 与成员之间的夹缝 doc 挂在成员起始记号上，**不属于** A/B 任一记录——非标记成员无人回收 → E305 维持；成员起始记号为标记名时由既有 M3 `claimDocs()` 回收（决策 3，M3 优先）。

**结算（终局核对，`parseUnionType` 出口、仅当 `members.length ≥ 2`）**：按成员**逆序**逐个核对——`leads.length > 0` 且 `dangling.slice(start, start + leads.length)` 与 `leads` **逐位引用同一**（`===`）时：`dangling.splice(start, leads.length)`、`claimed += leads.length`、`memberDocs[i] = leads.map(d => d.body)`；任一位失配（或区间越界）→ **核对失败 = 已被 M3 等内部锚位回收** → `memberDocs[i] = []`，不动 dangling。

```ts
// parser.ts 设计伪代码（AstType union 变体同步加必填 memberDocs，见 D2）
interface M4Pending { start: number; leads: DocLead[] }   // Parser 私有，不导出

private parseUnionType(): AstType {
  const members: AstType[] = [];
  const pendings: M4Pending[] = [];
  if (this.peekPunct('|')) {
    this.next();                                  // 前导 |（附着点 A）
    pendings.push(this.recordPipeAnchor());       // {start: len-depositedByLast, leads: 尾部条}
  } else {
    pendings.push(this.recordStartAnchor());      // 附着点 B：{start: dangling.length, leads: peek().leadDocs ?? []}
  }
  members.push(this.parsePostfixType());
  while (this.peekPunct('|')) {
    this.next();                                  // 成员分隔 |（附着点 A，恒前导于后继成员）
    pendings.push(this.recordPipeAnchor());
    members.push(this.parsePostfixType());
  }
  if (members.length === 1) return members[0]!;   // §7.3 坍缩：不结算 → doc 留 dangling → E305（决策 2）
  const memberDocs = this.settleM4(pendings);     // 逆序 + 引用同一性核对 + splice + claimed 记账
  return { kind: 'union', members, pos: nodePos(members[0]!), memberDocs };
}
```

**机制正确性论证（每个关键场景对到契约用例）**：

| 场景 | 记录 | 结算 | 契约用例 |
| --- | --- | --- | --- |
| `/** 甲 */ "a" \| "b"`（B 锚，字面量成员） | `"a"` 的 [甲] @ start | 无内部锚位回收 → 同一 → 挂 member 0 | 用例 2 |
| `"a" /** 乙 */ \| "b"`（A 锚） | `\|` 的 [乙] | 挂 member 1 | 用例 3 |
| 连续两条 doc（pending 累积同挂 `\|`/首记号） | leads=[一, 二] | 整段同挂一成员、逐字 | 用例 4 |
| `/** 成员口径 */ \| /** 载体口径 */ YLeaf<"a"> \| YLeaf<"b">`（叠写） | A 锚记 [成员口径]；`YLeaf` 记号上的 [载体口径] 不记录——`parseMarkerType` 的 `claimDocs()` 在 M4 结算**之前**已回收（M3 同步性：紧跟标记名 next()） | [成员口径] 同一 → 挂 member 0；marker.docs=[' 载体口径 ']，成员表无「载体口径」→ 不双挂 | 用例 7 |
| `/** d */ YLeaf<"a"> \| "b"`（B 锚 + M3 抢先） | B 记 [d] @ start；M3 `claimDocs()` 在成员解析中已 splice 掉 [d] | `dangling[start]` 非 d（越界或他物）→ 失配 → member 0 无 doc；d 已在 marker 节点恰一次 | 用例 7 的机制面（M3 优先冻结约束） |
| 坍缩 `/** d */ "a"` / `/** d */ \| "a"` | B/A 各记 [d] | `members.length === 1` → 不结算 → E305 @(2,10)（现行逐字节） | 用例 8 |
| 夹缝非标记 `"a" \| /** d */ "b"` | `\|` 无 doc（A 记 0 条）；`"b"` 上的 d 不记录 | d 留 dangling → E305 @(2,16)（单行）/@(4,5)（多行） | 用例 9 |
| 嵌套联合（`YArray</** e */ \| "a" \| "b">`） | 内层 union 自有 pendings，先于外层结算 | 内层 splice 的区间下标恒 > 外层已记录区间 → 外层 start 不漂移；内层坍缩不结算时其 doc 留 dangling → E305 | 用例 13 的嵌套机制面 |

**为什么必须逆序**：同一 union 内，成员 i 的记录区间下标 < 成员 j（j>i）的区间下标。若正序先 splice 成员 i，则成员 j 记录的 `start` 整体左移 → 同一性核对假性失配 → 成员 j 的 doc 误留 dangling（假 E305）。逆序从最高下标结算，先结算者不影响更低下标的记录（splice 只影响其后元素）。引用同一性则封死「不同 doc 对象占据同一下标」的假性匹配（DocLead 对象每条注释恰创建一次、恰入 dangling 一次，token 层无重挂）。

**为什么必须延迟**：坍缩判定要扫到表达式末尾（`parser.ts:265-268`）；且 B 锚的 M3 竞争只有等成员解析完才知道胜负。急切回收（消费 `|` 即 splice）会（a）在 M3 之前抢走夹缝前 doc，逆转决策 3 的优先级、造成双挂；（b）坍缩时需要「放回」到正确位置（顺序敏感、易错）。

**记账不变量保持**：`settleM4` 的每次 splice 同步 `claimed += n`，`parseModule:220-222` 的 `docTotal` 核对对 M4 路径自动成立；结算只在 `parseUnionType` 出口发生，彼时不存在未结算的 `claimDocs` 窗口（M1/M2/M3 的回收点都在进入嵌套 `parseTypeExpr` **之前**、紧跟各自锚记号的 next()——`parser.ts:209/434/522`，已逐点核实），故 M4 的 splice 不与任何 pending 回收窗口竞争 `depositedByLast`/dangling 尾部。

**备选方案（拒绝）**：

1. *tokenizer 穿透 `|`（锚位一律成员起始记号）*——ADR 0019 Considered Options 已否决：需改侧通道、影响全部既有 E305 判定面；A/B 两子规则零词法改动达成同一作者意图。
2. *急切回收 + 坍缩回滚*——见上，M3 竞争与放回顺序两处不可靠。
3. *结算时不做同一性核对、只信下标*——B 锚 + M3 场景会双挂（d 已被 M3 取走，下标处可能已是后续 doc 或空），违反决策 3 冻结约束；ADR 决策 4 明文要求「以引用同一性核对回收（核对失败 = 已被 M3 等内部锚位回收）」。

### D2. AST 形状：union 节点恒携带必填 `memberDocs`

`parser.ts:41` 变体改为 `{ kind: 'union'; members: AstType[]; pos: Pos; memberDocs: string[][] }`——**必填、与 members 等长**（无 doc 成员为 `[]`），坍缩路径不产 union 节点（无携带者，doc 留 dangling）。ADR 0019 决策 4 明文：「parser 内部 AST 的 union 节点恒携带 memberDocs（必填、等长），AST → IR 转换时按上述条件附加」。AST 是内部结构（`packages/vfsl/AGENTS.md`「Internal parser/tokenizer/analyzer structures are not public contracts」；`index.ts` 不导出 `AstType`），唯一构造点是 `parseUnionType`，`shapes.ts` 等 AST 消费方只读 `kind`/`members`（§2.3）——typecheck 面零波及。

### D3. IR 表示：union 条件键 `memberDocs?: string[][]`（`ir.ts` ＋ `semantic.ts`）

- `ir.ts:45` 变体追加 `memberDocs?: string[][]`，并按 ADR 后果节补**指纹纪律注**：键只在「使用 M4 的文本」产物上在场；全体成员均无 doc 时整键不存在；键插入序 `kind → members → memberDocs`；该键参与 semantic 指纹输入，条件附加是存量指纹逐字节稳定的构造保证（非风格选择）。
- `semantic.ts:222-223` 转换改为条件展开（`exactOptionalPropertyTypes` 纪律——`derived.ts:13` 既有注释同款）：

```ts
case 'union': {
  const members = t.members.map(toIRType);
  const memberDocs = t.memberDocs;                       // AST 必填、等长（D2）
  return memberDocs.some((d) => d.length > 0)
    ? { kind: 'union', members, memberDocs }
    : { kind: 'union', members };
}
```

「全体成员均无 doc → 整键不存在」的条件即 `some(d => d.length > 0)`；对 parseVfsl 产物，`memberDocs[i]` 非空 ⟺ M4 结算成功回收了成员 i 的 doc。IR 保持纯数据、可 JSON 序列化、无行列（`ir.ts:7-9` 纪律；契约用例 1 的 JSON 往返断言锚定）。

### D4. derived 表示：条件稀疏 `memberDocs` 表（`derived.ts` ＋ `evaluate.ts`）

- `derived.ts` `DerivedSchema` 追加 `memberDocs?: Record<string, string[]>`，类型注**常态化写明与三表惯例的差异**（ADR 0019 决策 5 明文要求）：键 = 成员语法路径（既有 `<member N>` 合成段，N 从 0 起声明序），值 = 成员 doc 逐字继承；**条件稀疏**——仅当模块至少一名成员携带 doc 时整键在场，且表内只收非空条目；这与 `aliasDocs/fieldDocs/markerDocs` 的全量立行惯例不同，目的是存量派生物逐字节不变。
- `evaluate.ts` `DocsTables` 增 `memberDocs: Record<string, string[]>`（初值 `{}`）；`walkDocs` union 分支：先过 D5 守卫，再逐成员 `if (memberDocs[i]?.length) put(tables.memberDocs, `${path}.<member ${i}>`, memberDocs[i])`，随后照旧 `walkDocs(m, `${path}.<member ${i}>`, tables)` 递归——键插入序 = 成员声明序（表序确定性，与既有三表同构）；嵌套路径合成复用既有文法（字段段 + `<item>` 段 + `<member N>` 段，`evaluate.ts:373-399` 现行合成逻辑零改动）。
- `evaluate.ts` 返回字面量（`evaluate.ts:63-73`）在七键之后**条件展开追加末位**：`...(Object.keys(docs.memberDocs).length > 0 ? { memberDocs: docs.memberDocs } : {})`——存量 schema 键集合与键序 = 既有七键（契约 `BASE_DERIVED_KEYS` 断言），新 schema 第八键居末。表内单条收集仍走 `put` 统一守卫入口（元素必为数组——D5 已整体守卫，`put` 的 Array.isArray 为防御性二次同形）。
- `memberDocs` **不进** `StructureNode`/`ValueSchema`/`index`（`resolve-schema-at-path.test.ts:289` 断言合成 union 值节点恰 `['kind','members']`；`evaluate-derived-schema.test.ts` 锚 IR 形状——两锚点均不得破）。

### D5. 校验边界：手造 IR `memberDocs` loud 守卫（`evaluate.ts`，决策 5 / AC5）

`walkDocs` union 分支入口（递归 members 之前）设守卫，与 `put`/`appendDocs`（`evaluate.ts:344-354`）同族：

```ts
/** §3.4 守卫族同族延伸：键在场（!== undefined）即必须是「与 members 等长的数组的数组」；
 *  缺席 = 合法存量形状（条件键）。禁止静默规范化（?? [] / 忽略）。 */
function guardMemberDocs(t: Extract<VfslType, { kind: 'union' }>): void {
  const md: unknown = (t as { memberDocs?: unknown }).memberDocs;
  if (md === undefined) return;                       // 键缺席：合法
  if (!Array.isArray(md) || md.length !== t.members.length || !md.every(Array.isArray)) {
    throw new TypeError(`memberDocs 畸形（手造 IR）：期望与 members 等长的数组的数组`);
  }
}
```

- 抛 `TypeError` → `evaluate` 顶层 catch（`evaluate.ts:74-77`）→ `{ ok:false }` 恰一条 `VFSL-E100`（冻结前缀构造同源）、无 `derived` 载荷。四类畸形全覆盖：整体非数组 / 短于 / 长于 / 元素非数组；良性等长（含全空数组）放行——全空数组过守卫但条件稀疏使其不产生任何键（契约正控）。
- 与 `put`/`appendDocs` 的**有意不对称**：三槽 docs 在 IR 是必填槽（缺失即 loud），`memberDocs` 是条件键（缺席合法、在场才校验）——ADR 决策 5 的明文边界。
- 求值顺序确定性：守卫在 `collectDocs`（`evaluate.ts:61`）内触发，位于 aliases/structure/values/index 之后；同一 IR 若另有更早的 InternalError（如 E304），先到者胜——单错误模型下行为确定。守卫只判形状（数组性/等长），不校验元素字符串性——与三表守卫口径一致，超面校验不做。
- **`validate.ts` / `validate-patch.ts` / 物化路径零改动零读取**（C-4 / 决策 8）：§2.3 已核其 union 分支只读 `members`。

### D6. E305 消息正文（`semantic.ts:76`，决策 9.3 / C-6）

现行：`悬空文档注释：未紧邻可挂载的声明性节点（类型别名 / 属性 / 标记类型），且不相邻即不再挂载`
改为：`悬空文档注释：未紧邻可挂载的声明性节点（类型别名 / 属性 / 标记类型 / 联合成员），且不相邻即不再挂载`

前缀 `VFSL-E305: ` 与锚点（注释起始）不动；枚举补「联合成员」满足契约 `/联合.{0,6}成员/`（间隔 0 字符）。全仓既有断言仅前缀正则（`parse-vfsl-jsdoc.test.ts:127`，§2 已复核；`tests/acceptance/vfsl_spec_acceptance.py` 只查规格文本，属 #309 面）。

### D7. 不变式清单（本设计显式冻结的「不改」）

1. tokenizer 侧通道（pending → leadDocs）零改动（决策 10）；
2. `claimDocs`/`depositedByLast`/`docTotal` 语义与三锚位调用点零改动（M4 是新增第四类回收，不触碰既有三类）；
3. `StructureNode`/`ValueSchema`/`index`/`Discriminator` 形状零改动；判别式检测（`detectDiscriminator`）零改动；
4. `resolve.ts`/`shapes.ts`/`validate.ts`/`validate-patch.ts`/`resolve-schema-at-path.ts`/`envelope.ts`/`schemasource.ts`/`fingerprint.ts`/`index.ts` 零改动（公共接缝 `parseVfsl`/`evaluate` 签名不变，类型经既有导出自然携带新可选键）；
5. E305 的触发条件、锚点、聚合规则（min-position）不变——M4 只是从 dangling 中多回收了一类条目；
6. 错误码集合不变：不新增码，不改变任何既有码的条件与含义。

---

## 8. 接口、状态机与数据流

### 8.1 公共接口变化

无新增函数/导出。两个导出类型联合的成员形状**加性**变化：`VfslType` union 变体 + `memberDocs?: string[][]`（`index.ts:60-67` 既有导出自然携带）；`DerivedSchema` + `memberDocs?: Record<string, string[]>`（`index.ts:69-78` 同）。两者均为可选键——存量消费者类型面零破坏（§10 矩阵）。`evaluate` 公共行为的唯一扩展：手造 IR 携畸形 `memberDocs` 时由「静默忽略、ok:true」变为「ok:false E100」（ADR 授权，§10）。

### 8.2 parser dangling 状态机（M4 视角）

```
[doc 随锚记号入 dangling] --A 锚(|)或 B 锚(首成员起始记号)--> [记录 {start, leads}（pending，不动作）]
    --成员解析（M2/M3 可能在其中回收自己的槽--> 影响 dangling 尾部/中段）-->
[union 出口] --members ≥ 2--> [逆序同一性核对] --全配--> splice + claimed+=n --> memberDocs[i]=bodies
                                    +--失配--> memberDocs[i]=[]（doc 已归内部锚位，典型 M3）
              --members == 1（坍缩）--> 不结算 --> doc 留 dangling --> analyze 立 E305 候选（锚注释起始）
[模块末] claimed + dangling.length === docTotal（失衡 → 兜底 E100，不变）
```

无新异常路径：splice/核对纯算术与比较，不可抛；所有既有失败语义（error 记号即抛、E305、E100 兜底）原样。

### 8.3 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ① doc → AST | `parseVfsl(text)`；`|`/成员起始记号携带的 leadDocs | `next()` 入 dangling（`parser.ts:141-144`）；M4 结算 splice 出 | tokenizer pending（`tokenizer.ts:72-82`）→ dangling → `memberDocs[i]`（bodies 逐字） | 进程内 AST（不持久化） | `toIRType`（semantic） | union 节点 memberDocs 等长数组 | 坍缩/夹缝不回收 → E305；记账失衡 → E100 兜底 | 契约用例 1-11 |
| ② AST → IR | `analyze`（candidates 空） | `semantic.ts:222-223` 条件展开 | some(non-empty) 才携带键；键序 kind→members→memberDocs | IR（纯数据、JSON 可序列化） | `evaluate`、`semanticFingerprintOf`、codegen(#307)、envelope 编译链 | 新文本 IR 多一键；存量 IR 逐字节不变 | 转换无可抛点 | 契约用例 5/6/18/19 |
| ③ IR → 指纹 | `compileSchemaEnvelope`/`getCompiled` 链（`index.ts:349-353`） | `fingerprint.ts:55-57`（零改动） | `{domain, lang, version, module}` 紧凑 JSON SHA-256；前缀 `sha256:v1:` | META.schema 生命周期元数据 / peer re-arm 对比（ADR 0017/0018，均 #306 外） | 指纹对比方 | 存量指纹逐字节不变；新文本指纹不同（该文本此前 E305、无既有指纹可比） | 无（纯计算） | 契约用例 18/19 精确值 |
| ④ IR → derived | `evaluate(module)` | `DocsTables.memberDocs`（walkDocs union 分支）→ 返回字面量末位条件展开 | D5 守卫（TypeError→E100）→ `<member N>` 键、只收非空、条件稀疏 | DerivedSchema（纯数据、内容哈希纪律） | codegen(#307 盲读)、`resolveSchemaAtPath`(#308 盲读)、namespace-runtime | 新 schema 第八键；存量派生物七键逐字节不变 | 畸形 memberDocs → ok:false E100、无 derived | 契约用例 12-17 ＋ derived 金样本 |
| ⑤ 校验/物化 | `validateLogicalSnapshot`/`validatePatch` | 无（零改动） | memberDocs 盲读（C-4） | — | — | 有无成员 doc 的校验/物化结果全等 | — | 契约用例 15（七路全等） |

跨边界说明：①-⑤ 全部同步、进程内、纯函数；唯一持久化语义在 ③（指纹进 ADR 0017 生命周期元数据与 ADR 0018 re-arm 对比）——其输入 IR 对存量文本逐字节不变，故存量命名空间零影响；新文本此前被 E305 拒绝、不可能存在已存指纹，无迁移/对账路径。无缓存失效问题（`compiledCache` 按文本内容哈希，新文本新键）。

---

## 9. 错误、恢复、并发和幂等

- **错误面**：不新增错误码。E305 条件 = 现条件减去 M4 回收的条目（只缩小，C-3）；E100 新增一类触发（手造 IR 畸形 memberDocs → TypeError → 顶层 catch），与既有守卫族同构（`evaluate.ts:74-77`）。parser 内 M4 无新抛点；`docTotal` 失衡兜底不变——若实现算错 splice，将以 loud E100 暴露而非静默丢 doc。
- **恢复/重试**：`parseVfsl`/`evaluate` 均纯函数、无 IO、无半完成状态；失败结果可无限次重放（`getCompiled` 失败不落缓存可重试的既有性质不变）。
- **并发**：parser/evaluator 均同步无共享可变状态（Parser 实例私有 dangling/claimed）；`compiledCache` 既有线程模型不变。无竞态面。
- **幂等**：同一文本重复解析/求值结果逐字节一致（无 Date/random/IO；SA6 §7 三次运行一致佐证）。
- **资源界**：`MAX_TYPE_NESTING = 100` 及计费口径零改动（M4 不新增递归深度；pendings 数组 O(成员数)，随解析栈消亡）。

---

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
| --- | --- | --- | --- | --- |
| `parseSchemaEnvelope` / `getCompiled` / `compileSchemaEnvelope`（`index.ts:193/240/324`，编排 parseVfsl→evaluate） | 成员 doc 文本 → E305 → 失败不落缓存 | 同文本 → ok 链路走通；IR/derived 携新键；指纹按 ③ 变化 | **零改动**（签名与编排不变） | `index.ts:151-177/240-294/324-368` |
| `evaluate` 直调方（手造 IR） | 畸形 memberDocs 静默忽略 → ok:true | **ok:false 恰一条 E100、无 derived**（ADR 决策 5 授权的行为变更） | 零改动（仓库内唯一手造 IR 调用方是测试；契约用例 16/17 即其目标行为） | SA6 §9 E-d；`evaluate.ts:74-77` |
| `@nomicore/vfsl-codegen` emitter | 自建 tables 结构体只取 `fieldDocs/markerDocs`；对 derived 其余键盲读 | memberDocs 盲读 → 无崩溃、无输出差异（发射位是 #307） | 零改动（#307 范围） | `packages/vfsl-codegen/src/emitter.ts:125-126/151-152`（已复核：显式挑选两表，非整对象展开） |
| `resolveSchemaAtPath` / namespace-runtime readData 投影 | docs 切片两来源 | memberDocs 不入切片（第三来源是 #308）；类型面盲读可选键 | 零改动 | `resolve-schema-at-path.ts:279/394`；ADR 0019 决策 7 |
| `validateLogicalSnapshot` / `validatePatch` | 不读任何 docs | 不变（C-4） | 零改动 | `validate.ts:350/517`、`validate-patch.ts:160/247` |
| ADR 0017 META.schema 指纹对比 / ADR 0018 peer re-arm | 存量指纹比对 | 输入逐字节不变 → 零触发差异；M4 新文本此前不可编译、无存量指纹 | 零改动 | §8.3 ③；ADR 0019 决策 4 D2 论证 |
| E305 消息文本匹配方（测试/工具） | 全仓仅前缀正则断言 | 前缀冻结、正文增枚举项 → 全部仍绿 | 零改动 | `parse-vfsl-jsdoc.test.ts:127`（grep 复核唯一锚） |
| 类型消费者（外部 import `VfslType`/`DerivedSchema`） | union 变体/表形状如现 | +可选键（加性）→ 既有解构/switch 零影响 | 零改动 | `index.ts:60-78` 导出面 |

未覆盖调用方：无（`packages/vfsl` 公共面全量枚举如上；`resolve.ts`/`shapes.ts` 为模块内私有消费，§2.3/D7 已核）。

---

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因（对应正文） |
| --- | --- | --- |
| `packages/vfsl/src/parser.ts` | `AstType` union 变体 +必填 `memberDocs: string[][]`；`parseUnionType` 附着点 A/B 记录、`settleM4` 逆序同一性结算（splice + claimed 记账）；私有 `M4Pending` 与记录助手 | §7 D1/D2 |
| `packages/vfsl/src/ir.ts` | union 变体 +`memberDocs?: string[][]` ＋ 指纹纪律注 | §7 D3（ADR 后果节「条件键 + 指纹纪律注」） |
| `packages/vfsl/src/semantic.ts` | `toIRType` union 分支条件展开；E305 消息正文补「联合成员」 | §7 D3/D6 |
| `packages/vfsl/src/derived.ts` | `DerivedSchema` +`memberDocs?: Record<string, string[]>` ＋ 条件稀疏差异注 | §7 D4（决策 5「差异常态化写在类型注释里」） |
| `packages/vfsl/src/evaluate.ts` | `DocsTables` 增表；`walkDocs` union 分支守卫 + 逐成员收集；返回字面量末位条件展开 | §7 D4/D5 |

（设计产物本身：`wiki/raw/task_issue-306_design.md` —— 本文件，SA1 产出。）

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
| --- | --- | --- |
| `packages/vfsl/src/tokenizer.ts` | doc 侧通道 | ADR 0019 决策 10：不改侧通道（M4 是利用而非修改） |
| `packages/vfsl/src/fingerprint.ts` | 指纹构造 | C-2：不得引入第二规范化层或升级 v2 前缀；单一生产者不变量（D2-CONTRACT-MARKER） |
| `packages/vfsl/src/validate.ts`、`validate-patch.ts` | 校验/物化 | C-4 纯文档纪律：不读 memberDocs |
| `packages/vfsl/src/resolve.ts`、`shapes.ts` | union 消费（盲读） | §2.3/D7：形状归类与 AST walk 不需要 doc；改动无对应验收且徒增指纹风险 |
| `packages/vfsl/src/resolve-schema-at-path.ts` | 投影 docs 切片 | #308 范围（C-5 中间态豁免边界） |
| `packages/vfsl/src/index.ts`、`envelope.ts`、`schemasource.ts` | 公共编排/信封 | 无签名/接缝变化（§8.1）；改动无对应验收 |
| `packages/vfsl-codegen/**` | 四发射位 | #307 范围 |
| `docs/vfsl/v1-spec.md`、`docs/vfsl/schema-authoring-guide.md`、`docs/adr/**`、`CONTEXT.md` | 规格与决策文本 | #309 范围（C-1 同支同步由 #309 承接；SA8 矩阵 12 已核 CONTEXT 无需改） |
| `packages/vfsl/test/**`（含 SA6 三件：`parse-vfsl-union-member-docs.test.ts`、`evaluate-derived-member-docs.test.ts`、`union-member-docs-fixture.ts`） | 冻结验收输入 | 契约先于实现录制（E-1）；SA4 不得重录金样本或软化断言——实现与断言冲突 = 实现错误，回设计修订 |
| `tests/**`、`domains/**`、其余 `packages/**`、`apps/**` | 出验收面 | #306 验收 = packages/vfsl 包测试 + typecheck（E-5）；存量输入不可能产出新键（C-2），跨包行为零变化 |

---

## 12. 验收与验证映射（required test implementation plan）

**测试文件已存在**（SA6 交付，`packages/vfsl/test/`）：`parse-vfsl-union-member-docs.test.ts`（13 用例，AC1/AC2/AC4）、`evaluate-derived-member-docs.test.ts`（6 用例，AC3/AC5/决策 8）、`union-member-docs-fixture.ts`（金样本数据，不被 vitest 收集）。实现任务 = 使 12 红转绿、7 绿保持、存量 607 绿保持、typecheck 绿。**无需新增测试文件**——SA6 §12 已论证 19 用例覆盖 AC1~AC6 全部明文语义与 SA8 E-1~E-5；若实现中发现覆盖缺口，回本设计补映射而非现场扩测。

| 需求或风险（设计元素） | 现有证据 | 所需行为测试（契约用例） | 预期观察 |
| --- | --- |---|--- |
| D1 附着点 A（`\|` 前挂后继） | 红：现行 E305 @(2,14) | 用例 3、6（`/** 甲 */ \| "a" \| "b"`） | `memberDocs=[[],[' 乙 ']]` / `[[' 甲 '],[]]`；Pair 有键 |
| D1 附着点 B（首成员起始记号） | 红：E305 @(2,10) | 用例 2、4 | `[[' 甲 '],[]]`；连续 doc `[[' 一 ',' 二\n * @tag '],[]]` 逐字 |
| D1 多行前导 `\|` 布局 | 红：E305 @(3,3) | 用例 1 | 三成员等长对齐 + JSON 往返 + 负控（同排版无 doc ok） |
| D1 坍缩不结算（决策 2） | 绿（现行即 E305） | 用例 8 | 两形态 `^VFSL-E305: ` @(2,10) 维持 |
| D1 夹缝非标记 E305 | 绿 | 用例 9 | @(2,16)/@(4,5) 维持 |
| D2 同一性核对 → M3 优先不双挂（决策 3） | 红（E305 遮蔽） | 用例 7、10 | 成员表含「成员口径」、marker `docs=[' 载体口径 ']` 恰一次、成员表无「载体口径」；M3 坍缩负控 `ok:true` 无 memberDocs |
| D3 IR 条件键（决策 4） | 红（无键） | 用例 5、6 | 混排模块 Pair 有键 / Plain 内层联合整键不存在且 JSON 不含该串 |
| D3/D4 存量逐字节稳定（AC4/E-1/C-2） | 绿（实现前金样本） | 用例 18、19 ＋ evaluate 文件 derived 金样本 | IR SHA-256、指纹精确值、derived SHA-256、`sha256:v1:` 前缀、七键集合全等 |
| D4 derived 条件稀疏 + `<member N>`（AC3/E-3） | 红（parse 前置失败） | 用例 12、13 | 键序 `Status.<member 0|1>`、member 2 不成键；`X.k.<member 0>`、`V.<item>.<member 0>` |
| D4 无 doc 派生物整键缺席 | 绿 | 用例 14（＋ evaluate 正控） | 键集合 = 七表、摘要不变 |
| D5 手造 IR 守卫（AC5/E-4） | 红（静默 ok:true） | 用例 16、17 | 良性等长/全空 ok:true（无键或 `T.<member 0>`）；4 类畸形恰一条 E100、无 derived |
| D7 纯文档性质（决策 8/C-4） | 红（parse 前置失败） | 用例 15 | 七路 `toEqual` 全等 + 派生物确有差异 |
| D6 E305 措辞（决策 9.3/C-6） | 红（正文无枚举项） | 用例 11 | 前缀不变 + `/联合.{0,6}成员/` |

**验证命令（SA4/SA7 执行；SA1 不运行）**：

```bash
cd /home/wangjian/nomicore-fix-issue-306
NODE_OPTIONS=--conditions=nomicore-source npx vitest run \
  packages/vfsl/test/parse-vfsl-union-member-docs.test.ts \
  packages/vfsl/test/evaluate-derived-member-docs.test.ts   # 目标：19/19 绿
npx vitest run packages/vfsl/test                            # 目标：34 files / 619 全绿
npx tsc -p packages/vfsl/tsconfig.json && pnpm typecheck     # 目标：均 exit 0
```

（SA6 §9 的 mutation 敏感性表与本设计 §7 各决策一一对应：错误实现——前导 `\|` doc 挂前一成员、丢严格相邻、M4 抢 M3 槽/双挂、无 doc 联合附空表、坍缩误挂、连续 doc 乱序/丢条、嵌套键文法错、空表入场、成员 doc 泄入物化/七路、`?? []` 静默规范化——各有必红用例，断言非恒真。）

---

## 13. 风险、回滚和残余问题

| # | 风险/残余 | 定性 | 缓解或归属 |
| --- | --- | --- | --- |
| 1 | M4 结算算术缺陷（区间漂移/部分回收）导致 doc 丢失或假 E305 | 高风险路径 | `docTotal` 不变量使丢失必以 loud E100 暴露（`parser.ts:220-222`）；逆序 + 同一性核对的构造论证（§7 D1）；契约用例 1-11 + mutation 表 |
| 2 | 金样本脆弱：任何键序重排、补空槽、二次规范化都会（正确地）触红 | 强制口径（C-2），非缺陷 | 实现约束：条件展开构造、键序 kind→members→memberDocs / 表居 derived 末位 |
| 3 | 契约交付即红：SA4 落地前 CI vitest 门禁红 | 已登记（SA6 §15.3，仓库既有红灯交付先例） | 流程性：本设计落地后立即转 SA4 |
| 4 | 分支中间态：codegen 无发射位、投影无第三来源、规格仍写三锚位 | 预期中间态（C-5/C-1） | #307/#308/#309 承接；PR #305 收官清单须含三者（SA7 不得以缺席判 #306 缺陷，收官核对不得漏） |
| 5 | 契约未锁类型声明细节（`readonly` 等）与元素字符串性 | 实现自由度（SA6 §15.1） | SA7 以 typecheck + 只读审查确认类型面同步；D5 守卫口径 = ADR 明文面，不超面 |
| 6 | E305 措辞正文再演变 | 低（正文不冻结） | 本设计固定推荐措辞（D6）；任何后续演变走 #309 措辞清扫同支 |
| 7 | 回滚 | 单分支五文件改动 | `git revert` 实现提交即回到三锚位行为；契约测试随实现回滚转红（红灯是能力缺口信号），无数据迁移、无持久化兼容负担（§8.3 ③） |

**任务内必要条件均已具备，无未解决前置**；无伪装为 follow-up 的必要条件。

---

## 14. 是否需要设计后 ADR 冲突复查及理由

**需要（`requiresConflictRecheck: true`）**。理由：

1. **公共类型面变化**：导出类型 `VfslType`（union 变体）与 `DerivedSchema` 追加可选键——虽为加性且 ADR 0019 决策 4/5 逐字授权，但属公共 API 形状变化（skill 复查条件第一项）。
2. **持久化/指纹语义面**：IR 与 derived 是内容哈希（ADR 0017 生命周期元数据、ADR 0018 re-arm）的输入；本设计改变「新文本」的指纹输入集合并修订 ADR 0003 冻结的 docs 表条款（经 ADR 0019 决策 5 显式修订）——触碰 ADR 冻结面（虽已被授权修订）。
3. **公共函数失败语义扩展**：`evaluate` 对手造 IR 畸形 memberDocs 从静默 ok:true 变为 ok:false E100——失败语义变化（经决策 5 授权）。
4. SA8 固定位置产物 `wiki/raw/task_issue-306_relevant_decisions.md` 缺席（等价 `.scratch` 报告 verdict clear），按技能规程「缺少 SA8 产物时读取相关 ADR 并标记需要冲突复查」执行。

复查焦点建议：确认本设计未越 ADR 0019 授权面（尤其 D1 结算机制是否忠实决策 4 的「记录位置 + 终局核对」文义、D5 守卫边界是否与决策 5「非等长数组的数组」口径一致）、以及 C-2 指纹纪律的条件附加实现（D3/D4）无第二生产者。

---

## 附：评审修订映射

`wiki/raw/task_issue-306_sa2_review.md` 不存在（iteration 0，无评审输入）——本节按技能规程省略；后续评审 finding 到修订位置的映射由修订迭代补入。

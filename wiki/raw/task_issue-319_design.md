# Issue #319 实现设计 — number 值域收窄核心：validate 与 validate-patch 统一判定（ADR 0021）

- 角色：SA1（mabf-sa1）· 阶段 design · 迭代 1（评审修订版）· one-shot dispatch `sa-cf7c655b-f581-4a57-81f7-a3e251882cfb`
- 设计产物：`wiki/raw/task_issue-319_design.md`（本文件；迭代 0 首版基础上的**原位修订**——逐条落实 SA2 评审 F1/F2，核心机制面（D-A~D-G）保持不变）
- 上游输入：任务简报 `wiki/raw/task_issue-319.md`；SA6 验收契约 `wiki/raw/task_issue-319_sa6_contract.md`（approve）；SA8 冲突报告 `wiki/raw/task_issue-319_conflict_report.md`（verdict clear，requiresConflictRecheck=true）与决策摘录 `wiki/raw/task_issue-319_relevant_decisions.md`；SA2 设计攻击评审 `wiki/raw/task_issue-319_sa2_review.md`（reject：F1 BLOCKER + F2 MAJOR；修订映射见 §14）
- 裁决权威：`docs/adr/0021-vfsl-number-domain-narrowing.md`（accepted，2026-09-11，issue #312）
- Issue #319 REST 评论：读取成功且为空数组 —— **无 Owner 评论要求**（SA6 §2 / SA8 §4 同证）

---

## 1. 任务类型、目标与非目标

**任务类型：bug**（运行时判定缺口：声明值域与执行值域错位）。

**目标**

1. 裸 `number` 叶子的运行时判定收窄为 ADR 0021 决策 1 公式：`typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)`——NaN / +Infinity / -Infinity / -0 四值全拒；`0`、`0.0`、有限小数（含次正规 `5e-324`、`1e308`、负有限数）放行。
2. 失配消息细分（ADR 0021 决策 3）：typeof 非 number 维持既有「类型不匹配：期望 number，实际 X」**逐字节不变**；typeof 是 number 但为四值之一给「期望 number（有限数且非 -0），实际 NaN/Infinity/-Infinity/-0」，`-0` 经 `Object.is` 单独识别（`String(-0) === "0"` 误导，不得显示为 "0"）。
3. validate 与 validate-patch 写路径同口径（经共享解释器 `validateSubtree` 自动达成，零 validate-patch 改动）。
4. changelog 结构性闭合锁定测试（AC3）：合法写入的 doc 不再触发数值分支 `capture:'unavailable'`。
5. 同变更集规范修订（SA8 Required action 1）：`docs/vfsl/v1-spec.md` §8 增补「语义收窄例外」条款，文本采用 ADR 0021 决策 4 原文。
6. 冻结面零改动：IR / derived 两树 / codegen 生成物 / 语义指纹与既有 fixture 逐字节不变；无新增错误码；公共 API 不新增；issue 顺序与路径报告锚位不变。
7. 既有测试影响面收编（SA2 F1；ADR 0021 决策 5 的测试侧后果）：仓内 3 处把「四值属 number 类型面」编码为构造失败支路前置的 doc-runtime 测试断言，按 §7 D-H 的逐用例规格迁移到新失败面，并更正两处失准注释行——**不触碰任何业务实现、不放宽任何拒绝**。

**非目标（排除面，SA8 §8-R3 边界纪律 + ADR 0021 决策 2/7）**

- 文本侧 `-0` 字面量 E100 拒绝（ADR 0021 决策 2 依赖 ADR 0020，0020 不在本分支决策集；现状 `-0` 字面量 tokenizer 即 `E100 未知记号: -`，SA6 探针 4 实证——本任务不触碰 parser/tokenizer）。
- `int` / `range` 三形态判定（无对象可改：`ValueSchema` 无 int/range kind（`derived.ts` L51），文本侧 `int/Int/range/Range` 均 E301）。
- `seedForTest` / 手工 `new Y.Doc()` 直构面收窄（ADR 0021 决策 7 L104–105 明示排除；消费侧判据继续兜底）。
- 枚举数值字面量 SameValue 化（SA6 Q2：`enumContains` 严格相等（`validate.ts` L162–165），`e: 0 | 1` 收 `-0` 现状 ok:true 保持）。
- 读路径行为（doc-runtime 读保持 schema-independent，`packages/doc-runtime/AGENTS.md` Contract；存量 doc 中的四值仍可读回）。
- 迁移 / 侦察 / 自动修复工具（ADR 0021 决策 5）。
- `preview` 渲染（`validate.ts` L207–208 `String(v)`）与 `jsonTypeOf`（L142–151）的既有输出——它们出现在其他消息分支，属兼容行为面。

---

## 2. 当前行为与证据锚点

全部结论以源码与上游证据为据（SA1 只读取；本设计另做了一次窄只读 JS 语义探针，见 §7-D-C）：

| # | 事实 | 锚点 |
| --- | --- | --- |
| B1 | 值校验分支谓词只做 `typeof`：`t.type === 'unknown' ? true : t.type === 'null' ? value === null : typeof value === t.type`，四值放行；消息 `类型不匹配：期望 ${t.type}，实际 ${jsonTypeOf(value)}` | `packages/vfsl/src/validate.ts` L458–464（谓词 L460、消息 L462） |
| B2 | 硬矛盾判定（联合候选过滤）同款谓词第二份实现：unknown 永不矛盾、null 严格、其余 `typeof value !== node.type` | `validate.ts` L320–325（L323/L324/L325） |
| B3 | 全仓仅此两处 schema 值域 number 谓词（其余 `typeof === 'number'` 为 jsonTypeOf/preview/路径用途） | SA6 §10 全仓扫描；本设计 grep 复核（`validate.ts` L147/L207/L460、`validate-patch.ts` L45） |
| B4 | validate 与 validate-patch 共享同一解释器：`interpret`（L598–631）→ `validateLogicalSnapshot`（L649–651）/ `validateSubtree`（L658–660）；validate-patch L35 导入，`finish`（L562–569）与 `validateBoundary`（L1012–1019）消费 | `validate.ts` L598–660；`validate-patch.ts` L35/L562–569/L1012–1019 |
| B5 | 联合三段算法：段 1 候选过滤用 `contradicts`（contraMemo）、段 2 接受扫描用 `countIssues`（countMemo，经 `validateValue` 计数 sink）、段 3 报告（候选分支 `联合成员 i/N：` 前缀下钻 / 无候选分支汇总+下钻双输出；argmin 严格 `<` 平局取声明序在前者） | `validate.ts` L391–435（L410–413/L415–420/L422–434/L437–444） |
| B6 | **memo 内键 = 快照值本身**：`countMemo`/`contraMemo` 均为 `Map<ValueSchema, Map<unknown, …>>`，读写四处直接以 value 为键（L289/L312 读，L303/L316 经 `memoStore` L382 写） | `validate.ts` L79–82（Ctx 字段）、L285–305、L308–318、L364–384 |
| B7 | JS 语义事实（本设计 node 探针实证）：`Map` 键比较为 SameValueZero——`m.set(-0,x).get(0) === x` 且 `m.set(0,x).get(-0) === x`（双向碰撞）；NaN 键只与自身相等；`String(-0)="0"`、`String(Infinity)="Infinity"`、`String(-Infinity)="-Infinity"`；`Number.isFinite(-0)===true`、`Object.is(-0,0)===false` | 探针输出（§7-D-C）；与 SA6 §6 探针 C 一致 |
| B8 | 写路径消费链：doc-runtime 四处 `applyMutationAtBoundary` 调用（S6 段），`!applied.ok → {kind:'fail'}` 零写入；namespace-runtime S3 `copyFrozen` 只挡非有限数（`-0` 穿透）、R9 通道透传 issues | `packages/doc-runtime/src/mutation-local.ts` L234/L267/L310/L366；`packages/namespace-runtime/src/write.ts` L138–146（S3）、L205–209（R9）、L340–346（copyFrozen） |
| B9 | 消费侧既有守卫（保持不动）：extract `copyPlainValue` 与 detached-build `copyJsonDomain` 拒非有限数、`-0` 直通 | `packages/doc-runtime/src/extract.ts` L268–272；`packages/doc-runtime/src/detached-build.ts` L183–186 |
| B10 | changelog 数值分支：`jcs` 非有限数 → `SnapshotContractViolation` → 投影收编 `capture:'unavailable'` + `input-projection-failed`；`-0` → `String(-0)="0"`（RFC 8785 §3.2.2.3）与 `0` digest 碰撞 | `packages/namespace-diagnostic-log/src/canonical-json.ts` L57–64（L61–63）；`src/projection/input.ts` L85–96；既有契约 `test/input-capture.test.ts` L200–209 |
| B11 | 规范文本现状：v1-spec §8（L461–471）只有「只增不改」三条规则，无任何例外条款（HEAD / PR #318 分支 / issue-310 分支三处核查均无） | SA6 §4 规范基线；本设计复读 `docs/vfsl/v1-spec.md` L461–471 确认 |
| B12 | 基线绿（实现前，生产源码零改动）：全仓 `pnpm test` 313 files / 3298 tests / typecheck 无错；`pnpm typecheck` exit 0；`pnpm generate --check` exit 0。**修订注记（SA2 F1）**：基线绿中恰 3 处断言编码的是旧四值语义（B13）——「基线绿」与「实现后全绿」之间的落差由 D-H 的用例级迁移收编，锁定强度不减 | SA6 §4 / 证据 4；SA2 §5 B12 行 |
| B13 | **既有测试把旧值域编码为构造失败支路前置**（迭代 0 设计与 SA6 契约均未识别，SA2 F1 揭示，本迭代逐行复读核对）：① `packages/doc-runtime/test/materialize-root.test.ts` RAC-2 C-7 行（L841 `type ROOT = { n: number; };` + `{n:NaN}`；断言模板第 (1) 步 L853 `expect(validateLogicalSnapshot(derived, snapshot).ok).toBe(true)`）；② `packages/doc-runtime/test/replace-root-content.test.ts` L486–506 用例（L489 前置 ok:true；L501 `toContain('non-finite number')`）；③ 同文件 L630–643 mat/rep 等价用例（L633 前置 ok:true）。同矩阵 C-3/C-4a/C-4b 行用 `u: unknown`，不受收窄影响；`namespace-registry/test/registry-create.test.ts` L727 NaN root 行断言的是拒绝（`NAMESPACE_CREATE_INVALID_INPUT`），收窄后仍绿。另：`materialize.ts` L128 与 `replace.ts` L120 注释「① 逻辑校验（值域宽域）」在收窄后失准 | 两测试文件与两源文件原文（本迭代复读）；SA2 §9 契约影响表 / §13-F1 |

旧实现五面 100% 放行四值（validateLogicalSnapshot / validatePatch / append / insert / applyMutationAtBoundary，含嵌套位），负控 49/49 绿——复现与敏感性证据全部承接 SA6 §5/§6/§13，本设计不重复复现。

---

## 3. 根因或能力缺口

**根因链（承接 SA6 §8，设计侧确认）**

1. **声明值域与执行值域错位**（最深根因）：ADR 0008 L25 声明「JSON-compatible plain value」、写路径 snapshotter 只收 finite number（L49，`write.ts` L344–346 同款），执行侧 `typeof` 判定却大于该声明域；`-0` 连 finite 守卫都挡不住（B7）。
2. **直接故障点两处**：`validateValue`（B1）与 `contradictsInner`（B2）——同一「number 判定」的两份实现，均只做 `typeof`。
3. **共享核心放大**：`validateSubtree` 单一解释器使缺口同时覆盖校验路径与全部写路径（B4）——修复同样单点生效。
4. **观测与出口腐化**：四值经合法写入进入 doc 后，changelog JCS 分支对 NaN/±Inf 退化 `capture:'unavailable'`、对 `-0` 静默输出 `"0"`（B10）。

**设计新识别的第三故障面（SA6 契约未覆盖，本设计 §7-D-C 收编）**：`countMemo`/`contraMemo` 以值为键 + Map SameValueZero 使 `-0` 与 `0` 同键（B6/B7）。现状无害（两值判定相同）；**收窄后二者判定相反，memo 相邻污染产生两类错误**：

- `{xs: [0, -0]}`（schema `type U = number | string; type ROOT = { xs: U[]; };`——v1 合法形，参见 D-C「测试输入的 v1 合法形」）：`xs[0]=0` 接受并在 `countMemo[N][0]=0` 落键；`xs[1]=-0` 查 `countIssues(N,-0)` 命中 0 的缓存 → 距离 0 → **段 2 静默接受 -0**（联合位收窄失效，AC1-3 直接被元素顺序击穿）。
- `{xs: [-0, 0]}`：`xs[0]=-0` 拒绝并落 `contraMemo[N][-0]=true`；`xs[1]=0` 查 `contradicts(0,N)` 命中 -0 的缓存 → 0 被当矛盾 → 无候选分支 → **对合法值 0 注入伪 issue**（「issue 顺序与路径报告是兼容行为」被破坏）。别名共享节点（`type N = number` 经 ref 解析到同一对象，memo 外键按对象同一性）可把污染面扩大到跨位置。
- 该碰撞与「是否同步收窄 `contradicts`」**正交**：countMemo 经 `validateValue` 在任何变体下都收窄，`accept-only` 变体同样产生第一类静默接受。memo 消歧是**无条件必做项**。

**既有测试影响面（SA2 F1 揭示，迭代 0 与 SA6 契约均未识别，本迭代收编为 D-H）**：仓内 3 处 doc-runtime 测试断言把「NaN 属 number 类型面」编码为「构造失败支路」的前置条件（B13）。收窄使失败面上移至 ① 逻辑校验——这是 ADR 0021 决策 5 breaking 姿势在**既有测试**上的直接后果；不迁移则「实现后全仓测试全绿」（AC6）不可达。逐用例处置规格见 §7 D-H。

---

## 4. Owner 要求落实

Issue #319 REST 评论读取成功且返回**空数组**（任务简报 L31–32「Comments」节为空；SA6 §2、SA8 §4 Owner 评论 override 行均同证）。**无 Owner 评论级要求、无 override、无待并入补充验收项**——本设计的需求源收敛为：Issue 正文（What to build + 五条验收项）+ ADR 0021（accepted 裁决权威）+ SA8 Required actions 1–4。

| 要求来源 | 要求 | 设计落点 |
| --- | --- | --- |
| Issue 正文 L17 | 四值全拒 + 消息细分 + `-0` 经 `Object.is` 识别 + 双路径同口径 | §7 D-A/D-B/D-D |
| Issue 正文 L21（AC1） | validate 四值全拒、消息细分正确；0/0.0/有限小数放行 | §12 T1-AC1-1~4 + AC1-5（设计新增 memo 序独立性） |
| Issue 正文 L22（AC2） | validate-patch 写路径同口径四值全拒 | §12 T1-AC2-1 |
| Issue 正文 L23（AC3） | changelog 结构性闭合锁定测试 | §12 T2（AC3-1~5） |
| Issue 正文 L24（AC4） | IR / derived / codegen / fixture 指纹逐字节零改动 | §12 T1-AC6/AC7 + 基线套件 |
| Issue 正文 L25（AC5） | 包测试、typecheck 全绿 | §12 验证映射 |
| SA8 R1 | v1-spec §8 同变更集增补例外条款 | §7 D-E |
| SA8 R2 | 消息保持原 emit 锚位、issue 顺序、单错误量 | §7 D-A 消息规则 |
| SA8 R3 | 排除面纪律（文本侧/int/range/seed/直构） | §1 非目标 + §12 T1-AC7 |
| SA8 R4（可选建议） | CONTEXT.md 增补 number 值域术语 | **不采纳**：术语「JSON 可忠实表示数」的权威定义在 ADR 0021 决策 1，v1-spec §8 条款内嵌 ADR 引用（docs/AGENTS.md「Link to the authoritative source instead of copying」）；本任务不引入新术语到共享词汇表，避免多文档复制漂移 |

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
| --- | --- | --- |
| 旧实现五面（validate/patch/append/insert/boundary）100% 放行四值；嵌套位（数组/Record/optional/联合）同放行 | SA6 §5 探针 A/A3/B/B2/B3/B4；B1/B4 源码锚点 | 单点收窄 `validateValue` 谓词即全覆盖（共享解释器）；嵌套位 path 已实测正确，无需路径改动（§7 D-A） |
| 根因双点：`validate.ts` L458–464 与 L320–325 同款 `typeof` 谓词 | SA6 §8；B1/B2 | 两点统一收窄到单一共享谓词 `scalarAccepts`（§7 D-A/D-B，Q1 裁决=同步收窄） |
| 反事实三态：base 49/35 红（35 条全为四值目标断言）；`both`（两点同收窄）104/104 绿；`accept-only`（仅校验分支）104/104 绿；两变体唯一可观测差异 = 联合报告形态 | SA6 §9-1/§13 证据 1 | 契约对实现自由度中立；设计据 Q1 裁决锁定 `both` 形态（§7 D-B），联合位测试随之可锁汇总条数 |
| 写路径同口径的结构基础：四类写路径与 validate 行为逐条一致（共享 `validateSubtree`） | SA6 §8 共享核心行；B4 | validate-patch.ts 零改动（DENY LIST）；同口径由结构保证 |
| 观测闭合机制：旧实现 NaN/±Inf 快照 → `capture:'unavailable'` + 事件；`-0` → `capture:'full'` 且 digest 与 0 碰撞；收窄后四值写被拒 → 两类腐化对合法写入结构性不可达 | SA6 §9-2/§13 证据 3；B10 | T2 锁定测试按 SA6 §12 T2 规格落地（§12）；changelog 包源码零改动 |
| 边界现状：`-0`/`-1` 字面量 tokenizer 即 `E100 未知记号: -`；`int/Int/range/Range` → E301 | SA6 §9-3 探针 4 | 排除面负控进 T1-AC7；parser/tokenizer 零改动 |
| **设计增量事实**：Map SameValueZero 使 `-0 ≡ 0` 同键；memo 以值为键 | 本设计 node 探针（B7）+ 源码 B6 | §7 D-C memo 键消歧（必做）+ §12 T1 AC1-5 序独立性测试（设计新增验收面） |
| **SA2 F1 事实**：3 处既有 doc-runtime 测试断言旧四值语义（构造失败支路前置），收窄后必红；`materialize.ts` L128 / `replace.ts` L120 注释失准 | SA2 §9/§13-F1；B13（本设计逐行复读核对一致） | §7 D-H 逐用例迁移规格 + §11 ALLOW 增列两测试文件与两注释行（用例级/comment 级限定）+ §10/§13 补行 |
| **SA2 F2 事实**：括号分组类型（如 `( A \| B )[]`）不在 v1 子集，出现即 VFSL-E100（v1-spec 文法注记 5 L78–79；`parse-vfsl-errors.test.ts` L51–57 已锁）——迭代 0 的 AC1-5 schema 文本非法 | `docs/vfsl/v1-spec.md` L78–79；`packages/vfsl/test/parse-vfsl-errors.test.ts` L51–57 | §3/§7 D-C/§12 AC1-5 三处全部改用合法等价形（`type U = number \| string;` + TypeRef 数组后缀；⑤ Record 联合实参），并修 D-C 末行双层方括号笔误 |

上游事实与源码无矛盾。

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
| --- | --- | --- | --- |
| ADR 0021 决策 1（判定公式，L39–51） | §7 D-A | `isJsonFaithfulNumber` 逐字落地公式；适用面仅裸 `number`（int/range 依赖缺席的 0020） | 否（公式照抄） |
| ADR 0021 决策 3（四值细分消息、双路径同口径、文案不进冻结面，L65–73） | §7 D-A/D-D | typeof 失配消息逐字节保持；四值独立消息分支；冻结粒度采纳 SA6 规则①–④（Q3 裁决=维持） | 是（SA8 复查项 (a) 消息面） |
| ADR 0021 决策 4（§8 例外条款，L75–85） | §7 D-E | 条款全文逐字落入 v1-spec §8；override 不扩大（仅裸 number） | 是（SA8 复查项 (b) §8 落文） |
| ADR 0021 决策 5（不侦察/不迁移/loud 失败，L87–92） | §1 非目标、§13 风险；**测试侧后果 §7 D-H** | 存量四值 doc 在 rearm/重校验点 loud 失败 = 既定姿势（数据损坏信号），不做任何缓解工具；既有测试把旧值域编码为前置的 3 处断言按 D-H 用例级迁移到新失败面（不放宽任何拒绝） | 否 |
| ADR 0021 决策 6（IR/derived/codegen/指纹零影响，L96–97） | §12 T1-AC6 | 锁定 = 既有套件（含指纹 KAT）+ `pnpm generate --check` + fixtures 零 diff | 是（SA8 复查项 (c) 冻结面 diff） |
| ADR 0021 决策 7（观测/出口闭合、种子直构面排除，L99–105） | §12 T2、§1 非目标 | 闭合锁定测试；seed/直构面不加断言、不改消费侧守卫（B9 保持） | 否 |
| ADR 0021 Consequences L133–134（无新增错误码） | §7 D-A/D-D | 四值拒绝走 validate 消息通道，非新码 | 是（并入复查项 (c)） |
| ADR 0008 L25/L49（声明值域；snapshotter finite） | §3 根因 | 收窄使执行语义对齐声明值域并补 `-0` 缺口 | 否 |
| ADR 0007 issue #237 修订节（校验拓扑） | §7 D-A | 不改拓扑：双路径同口径在既有 `validateSubtree` 拓扑内达成 | 否 |
| ADR 0010 R2-4（SameValue 判据不动） | §1 非目标 | 受保护字段判据零触碰；四值对合法写入结构性不可达后由消费侧判据兜底种子/直构面 | 否 |
| ADR 0014（record schema / JSONL 不动） | DENY LIST | changelog 包 src 零改动；`input-capture.test.ts` 原样保持绿（AC3-5） | 否 |
| ADR 0017（指纹稳定） | §12 T1-AC6 | 零改动锁定对照面 | 是（并入复查项 (c)） |
| packages/vfsl/AGENTS.md（错误码/issue 顺序/路径报告/信封严格性/指纹输入=兼容行为；公共 API 只经 index.ts） | §7 D-A 消息规则、DENY LIST | 新消息在原 emit 锚位发出、每标量节点恰 1 条、遍历序不变；`index.ts` 零改动 | 是（并入复查项 (a)/(c)） |
| docs/AGENTS.md（行为变更须同步修订 stated contract 变化的规范文档） | §7 D-E | §8 条款与代码同变更集 | 是（并入复查项 (b)） |

---

## 7. 设计决策与主要备选方案

### D-A 裸 number 谓词收窄：单一共享谓词 + 独立四值消息分支

`packages/vfsl/src/validate.ts` 为**唯一生产改动文件**。新增模块局部辅助（放在 §3.3 诊断区 `jsonTypeOf` 邻域；全部不进公共面）：

```ts
type ScalarTypeName = Extract<ValueSchema, { kind: 'scalar' }>['type'];
// = 'string' | 'number' | 'boolean' | 'null' | 'unknown'（derived.ts L51）

/** ADR 0021 决策 1：number 值域 = 恰好 JSON 可忠实表示的数。
 *  NaN / +Infinity / -Infinity 由 Number.isFinite 排除；-0 是有限数，须 Object.is 单独排除。 */
function isJsonFaithfulNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0);
}

/** 四值渲染（ADR 0021 决策 3：-0 必须 Object.is 识别——String(-0)==='0' 误导）。全函数：
 *  有限非 -0 值防御性回落 String(v)（正常不可达——调用点已过滤）。 */
function renderNumberValue(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (Object.is(v, -0)) return '-0';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  return String(v);
}

/** 裸标量判定——contradictsInner 与 validateValue 的单一事实源（消除双谓词分叉）。
 *  unknown 恒真 / null 严格等值 / number 收窄 / 其余 typeof：与旧实现逐分支等价，仅 number 收窄。 */
function scalarAccepts(type: ScalarTypeName, value: unknown): boolean {
  if (type === 'unknown') return true;
  if (type === 'null') return value === null;
  if (type === 'number') return isJsonFaithfulNumber(value);
  return typeof value === type;
}

/** 标量拒绝消息：typeof 失配（含 number 收非 number 型）逐字节维持既有文案；
 *  typeof 是 number 但落四值 → 收窄消息（SA6 T1 规则①–④的取值来源）。 */
function scalarRejectMessage(type: ScalarTypeName, value: unknown): string {
  if (type === 'number' && typeof value === 'number') {
    return `期望 number（有限数且非 -0），实际 ${renderNumberValue(value)}`;
  }
  return `类型不匹配：期望 ${type}，实际 ${jsonTypeOf(value)}`;
}
```

两个消费点改为：

```ts
// validateValue（L458–464 现区段替换；emit 锚位、thunk 门控、单条量全部保持）：
case 'scalar': {
  if (!scalarAccepts(t.type, value)) {
    ctx.emit([...path], () => scalarRejectMessage(t.type, value));
  }
  break;
}

// contradictsInner（L322–325 现三行替换；unknown→false / null→!==null 语义被等价吸收）：
case 'scalar':
  return !scalarAccepts(node.type, value);
```

**性质核对（逐项对 SA8 R2 / AGENTS.md 兼容面）**

- typeof 失配消息逐字节不变：`scalarRejectMessage('number', 'x')` → 走通用分支 → `类型不匹配：期望 number，实际 string`（与 L462 现行完全一致；其余标量类型同）。
- emit 锚位：仍在 `validateValue` scalar 分支的单一 `ctx.emit([...path], thunk)`；消息构造留在 thunk 内（R4 门控——计数态/截断态不构造消息、不跑 preview）。
- issue 顺序与单条量：每标量节点至多 1 条 issue；遍历序（声明序字段 / 数组序）不变——T1-AC1-4 锁定。
- 计费：收窄是常数时间条件判断，**不新增计费点**；`WORK_LIMIT=2×10⁸`、issue 上限 100、截断标记语义全部不变。
- 纯函数契约：辅助函数无状态；`renderNumberValue` 仅在 thunk 内执行。
- 公共 API：全部模块局部，`src/index.ts` 零改动。

**备选（拒绝）**：扩 `jsonTypeOf` 让 NaN/±Inf 返回特殊名——`jsonTypeOf` 是多消息共用的兼容行为面（L462 等多处消费），改动会波及无关消息文案。

### D-B 重复谓词的行为选择（SA6 Q1 裁决）：两点同步收窄，单一事实源

**裁决：`contradictsInner` 与 `validateValue` 同步收窄**（SA6 反事实变体 A「both」），如 D-A 所示由 `scalarAccepts` 单一谓词供两点消费。

理由：

1. **ADR 0021 决策 1 定义的是「number 判定」本身**，不是某个调用点的行为。`contradicts` 是同一判定在候选过滤处的第二份实现；保留宽域等于在库内重新制造本票要消除的「声明/执行错位」（谓词分叉）。
2. **报告分类学一致性**：收窄后四值是「类型命中但值域外」的硬失配，与 `true` 入 `number | string`（typeof 失配）语义同类。现状对 `true` 走无候选分支（汇总 + 下钻）；同步收窄使四值获得同款形态。`accept-only` 会让四值在联合位呈现与其他硬失配**不同**的报告形状（`联合成员 1/2：…` 单条），留下长期口径长尾。
3. **段间一致性**：`countIssues` 经 `validateValue` 在任何变体下都已收窄（距离已反映窄域）；让段 1 候选过滤（`contradicts`）保留宽域会造成同一算法内两段判定口径互斥。
4. **契约风险为零**：SA6 反事实实测 `both` 104/104 绿；差异仅在联合报告形态，本设计随之锁定（见下）。

**锁定的联合位可观察形态**（`u: number | string` + 四值，number 声明在前）：

- 段 1：两成员均矛盾（number 被收窄谓词矛盾、string 被 typeof 矛盾）→ 无候选；
- 段 3 无候选分支：恰 **2 条** issue 同在 `['u']`——① 汇总 `不匹配任何联合成员（any-of 全拒绝）：失败距离最小的成员为联合成员 1/2（距离 1）`；② 下钻 detail = 收窄消息（距离平局 1:1，argmin 严格 `<` 取声明序在前 = number 成员，满足 T1 规则①–④）。
- 若声明序为 `string | number`，下钻 winner = string → detail 为 `类型不匹配：期望 string，实际 number`（平局规则既定行为，非本设计新引入）。测试用 `number | string` 序锁定四值 detail 在场。

**备选（拒绝）**：`accept-only`（变体 B）——制造谓词分叉与报告形态分叉（理由 2/3）；且**并不回避** D-C 的 memo 碰撞（`countMemo` 仍经 `validateValue` 收窄，`{xs:[0,-0]}` 静默接受照样发生）。

### D-C memo 键消歧：`-0` 哨兵键（设计必做项，契约外新增）

**问题**（§3 末）：`countMemo`/`contraMemo` 内键 = 值本身（B6）；Map SameValueZero 使 `-0 ≡ 0` 同键（B7 探针实证，双向碰撞）；收窄后两值判定相反 → 同一调用内相邻出现时后查者命中前者的缓存：`[0, -0]` 序 → **-0 被静默接受**（联合位收窄失效）；`[-0, 0]` 序 → **0 被注入伪联合汇总 issue**。别名共享节点（ref 解析到同一对象，memo 外键按对象同一性）可跨位置传播污染。

**方案**：模块级哨兵键 + 键归一化，三处触点（两读一写；`memoStore` 为双 memo 共用写点）：

```ts
/** count/contra memo 内键消歧：Map 键比较为 SameValueZero（-0 ≡ 0），收窄后二者判定
 *  相反，不得共键。哨兵为模块级常量标签（与 ISSUE_LIMIT/WORK_LIMIT 同类的不可变常量，
 *  非跨调用可变缓存——「per-call 中间态调用局部」纪律不受影响）。 */
const NEG_ZERO_MEMO_KEY: unique symbol = Symbol('vfsl:neg-zero-memo-key');
function memoKey(value: unknown): unknown {
  return typeof value === 'number' && Object.is(value, -0) ? NEG_ZERO_MEMO_KEY : value;
}
```

- `countIssues` L289：`inner?.get(memoKey(value))`
- `contradicts` L312：`inner?.get(memoKey(value))`
- `memoStore` L382：`inner.set(memoKey(value), result)`

NaN / ±Infinity 键无碰撞（SameValueZero 下 NaN 只与自身相等，±Infinity 与任何有限数不同键），仅 ±0 对需要消歧。`MEMO_CAP` 清空重建、memoEntries 计数、计费语义全部不变。修正后：`{xs:[0,-0]}` → `['xs',1]` 拒；`{xs:[-0,0]}` → 仅 `['xs',0]` 拒、`['xs',1]` 零 issue。

**测试输入的 v1 合法形（SA2 F2 修订）**：memo 序独立性测试的 schema **不得**使用括号分组联合数组——v1-spec 文法注记 5（L78–79）明文「括号分组类型（如 `( A | B )[]`）不在 v1 子集，出现即 VFSL-E100」，`parse-vfsl-errors.test.ts` L51–57 已把 `( string | number )` 锁为 E100。合法等价形：

```vfsl
type U = number | string;
type ROOT = { xs: U[]; };
```

文法依据：`ArrayType = PrimaryType, { "[", "]" }` 且 `PrimaryType ⊇ TypeRef`——`U[]` 合法；等价性依据：validate.ts array 分支 `resolveValues(t.element)`（L499）经 `walkRefChain` + `ctx.refMemo`（L136–138）把 `U` 解析到**同一 union 成员节点对象**，数组各元素（及跨字段别名）的 memo 外键同一性与 `-0/0` 碰撞语义完整保持——与括号分组写法（若合法）语义等价，且本就是仓内 TypeRef 常规用法。⑤ Record 值位用 `Record<string, number | string>`（`RecordType` 实参为 TypeExpr，联合直接合法，无需括号）。

**备选（拒绝）**：
- 字符串哨兵（如 `'-0!'`）——快照值可为任意字符串，同节点下真实字符串值与哨兵碰撞可期；Symbol 身份唯一、永不与用户值相等（探针实证）。
- 每次 `interpret` 调用在 `createCtx` 内新建哨兵——纯度等价但多一处 Ctx 管线；模块常量更简且与既有常量同类。
- number 值跳过 memo——无谓放弃性能优化且扩大 diff。

### D-D 消息冻结粒度（SA6 Q3 裁决）：维持 SA6 规则①–④

采纳 SA6 T1 消息规则为 normative：① 含域短语 `期望 number（有限数且非 -0）`（ADR 0021 决策 3 逐字）；② 不以 `类型不匹配：` 开头；③ 非 `VFSL-E100` banner；④ 以期望值字面量结尾（`NaN`/`Infinity`/`-Infinity`/`-0` 尾 token 正则见 SA6 §12，`String(-0)="0"` 的实现必红）+ 四值消息两两互异。整句文案不冻结（ADR「文案不进冻结面」）。

**理由**：Issue AC1 写「消息细分正确」——SA6 规则集是该验收的最小可执行判据（去掉①则「细分」只剩尾 token，「正确」失去域语义锚）；D-A 的 `scalarRejectMessage` 天然满足全部规则。SA6 提出的放宽备选（仅尾 token + `实际` 在场 + 互异）**不采纳**。

### D-E v1-spec §8「语义收窄例外」条款（SA8 R1；同变更集强制文档交付物）

**修订文件**：`docs/vfsl/v1-spec.md` §8。**插入点**：第 3 条规则（L467 `3. 错误码稳定：…`）之后、「对历史文本的解释…」段（L469）之前，新增：

```markdown
例外条款（逐一经 ADR 显式裁决；语义收窄例外首例 = ADR 0021，issue #312）：

- 语义收窄例外：缩小既有合法值域/文本域的变更，仅当满足下列全部条件时允许，且须逐一经 ADR 显式裁决：(a) 收窄使执行语义与已声明的架构契约对齐（本次：ADR 0008 L31「JSON-compatible plain value」）；(b) 影响面与存量姿势在 ADR 中显式记录（本次：决策 5）；(c) owner 显式裁决。
```

- 条款正文 = ADR 0021 决策 4 L80–83 **逐字**（SA6 D1 / SA8 §6 修订计划完整性已核）；引导行是纯结构标签 + ADR 0021 L85「首例」事实陈述，不新增规范性内容。
- **只增不改**：三条既有规则（L465–467）与「只增不改」表述逐字不动；「对历史文本的解释」段不动；不引入 ADR 0020 的保留名例外（0020 不在决策集）；方言 `version` 不升；错误码不重编。
- **验证属 review 门（SA8 recheck），不得写成源码/文档字符串断言测试**：条款在场且与 ADR 0021 决策 4 语义一致；`git diff --check` 干净；实现报告携带 §8 diff。

**备选（拒绝）**：同时在 §3 给 number 运行时值域肯定性陈述——SA8 摘录已核「被触碰的规范文本收敛为 §8 冻结纪律」（§3/§4 无 number 值域陈述，`PrimitiveType` 仅列记号）；扩面超出 SA8 裁定的最小修订。

### D-F 契约测试落位与强度裁决（SA6 Q4/Q5/Q6）

- **Q4（T2 位置）**：维持 `packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts`。依赖方向正确（该包 `package.json` 已声明 `@nomicore/vfsl: workspace:*`，`schema-freeze.test.ts` 有导入先例；emitter/`testing` 子路径/`helpers/base.ts` 可复用）；`applyMutationAtBoundary`/`planMutationBoundary` 本就是 `@nomicore/vfsl` 公共导出（`packages/vfsl/src/index.ts` L103–110）。不采纳「vfsl 包自持」备选（测试期反向导入破坏包依赖方向纪律）。
- **Q5（零改动锁定强度）**：维持「既有 313/3298 套件（含 `compile-schema-envelope` 指纹 KAT）+ `pnpm typecheck` + `pnpm generate --check` + fixtures/生成物零 diff」。不新增派生两树逐字节哈希 fixture——无任何 IR/derived/codegen 代码路径被触碰（判定纯运行时），`generate --check` 是生成物新鲜度的权威门，新增哈希 fixture 只加维护成本不加风险覆盖。**修订注记（F1）**：套件中恰 3 处断言按 D-H 用例级迁移后同套件全绿——迁移本身即锁定对象（§12 F1 验收行），其余 3295 项测试零改动原样保持绿，锁定强度不减。
- **Q6（runtime 端到端）**：不做。NaN/±Inf 在 runtime S3 已被 `copyFrozen` 既有契约拦下（B8）；`-0` 经 `applyMutationAtBoundary` → `validateSubtree` 的拒绝已被 T1-AC2-1 与 T2-AC3-1 在同一接缝覆盖；registry+persistence+Yjs 装配属已验证链路的冗余覆盖。

### D-G 排除面保持（SA6 Q2 同裁）

枚举数值字面量不收窄：`enumContains` 严格相等（L162–165）保持，`e: 0 | 1` 收 `-0`（`-0 === 0`）现状 ok:true 维持，T1-AC5 以负控锁定。ADR 0021 决策 1 适用面列举为「裸 number 与 int/range 叶子」，未含枚举字面量；若 owner 未来要求枚举 SameValue 化属范围扩张，须另行裁决。

### D-H 既有 doc-runtime 测试影响面迁移（SA2 F1；ADR 0021 决策 5 的测试侧后果）

**事实**（B13）：3 处断言把「NaN 属 number 类型面」编码为「构造失败支路」的前置（① 逻辑校验 ok:true → ② detached 构造域拒绝）。收窄后 NaN 在 ① 即被拒（`materialize.ts` L130–131 / `replace.ts` L122–123 均 ① 先行），失败面上移。**处置原则：只迁移断言锚点，不放宽任何拒绝、不新增任何生产代码改动**；三用例的全部其余语义（零写入双证、旧内容原封、issues 等价、fail-fast 单条）逐条保留。

**逐用例修订规格**（实现者照此编写；SA1 不编写测试）：

| 用例 | 迭代 0 状态（旧语义锚） | 修订后断言（新语义锚） |
| --- | --- | --- |
| `materialize-root.test.ts` RAC-2 C-7 行（L841；`type ROOT = { n: number; };` + `{n:NaN}`） | 断言模板第 (1) 步（L853）`validateLogicalSnapshot(...).ok === true`——证明走构造失败支路；该前提被收窄作废 | **迁移出 RAC-2 构造失败矩阵**：① CASES 表删除 C-7 行，原位留一行注释记录迁移（「ADR 0021 收窄后 NaN @ number 叶在 ① 逻辑校验被拒，迁移至下方逻辑失败用例」）；② 同文件紧邻 RAC-2 处新增一个逻辑失败用例，按该文件既有逻辑失败模板（R3 注释：direct validate ok:false 恰 1 issue → materialize ok:false 恰 1 issue（引用零损透传 toEqual）+ 0 update + state 不变）：`validateLogicalSnapshot` `ok:false`、恰 1 条、path `['n']`、消息满足 D-D 规则①–④（NaN 值）；`materializeRoot` `ok:false` 且 `result.issues` 与直调结果 `toEqual`；0 update 事件；state 字节不变 |
| `replace-root-content.test.ts` L486–506（`type ROOT = { title: YLeaf<string>; count: YLeaf<number> };` + `{title:'t', count:NaN}`） | L489 前置 `ok:true`（「NaN 属 number 类型面」）；L499–501 恰 1 条 + path `['count']` + `toContain('non-finite number')`（构造域词，CONTEXT.md 标记类型惯例） | 用例名与前置翻转：`validateLogicalSnapshot` `ok:false`（① 拒）；`replaceRootContent` `ok:false`、恰 1 条、path `['count']`、消息满足 D-D 规则①–④（NaN 值）；`result.issues` 与直调结果 `toEqual`（零损透传，对齐同文件 G3-1 L478 锚型）；**删除 `toContain('non-finite number')` 断言**；保留 0 update、state 字节不变、旧内容原封（`root.get('title')==='old'` / `root.get('count')===1`）全部断言 |
| `replace-root-content.test.ts` L630–643（mat/rep 等价锚，同款输入） | L633 前置 `ok:true`（构造失败输入）；L642 `rep.issues` toEqual `mat.issues`（构造规则等价） | 前置翻转为 `ok:false`（逻辑失败输入）；**保留** NaN 输入与 `rep.issues` toEqual `mat.issues` 等价断言（两入口同在 ① 失败、透传同一逻辑 issues——失败面等价锚继续成立）；用例名/注释由「同一构造失败输入」改为「同一逻辑失败输入」；构造规则等价锚由同文件既有成功路径双侧提取用例（L609–628）继续承担 |

**裁决记录（SA2 F1 要求显式记录的二选一）**：

- **C-7 选择迁移而非删除**：保留「NaN @ number 位在 doc-runtime 接缝 loud 失败 + 零写入」的锚（ADR 0021 决策 5 在本接缝的可观察姿势，且锁定了 ①→materializeRoot 的零损透传链）；materialize-root C-3/C-4a/C-4b（`u: unknown` 位 NaN/±Infinity）继续覆盖「① 通过 → ② 构造域拒绝」支路——该支路对 number 叶结构性不可达，正是收窄要的闭合性质。
- **`toContain('non-finite number')` 选择删除而非改锚**：构造域六词不是冻结兼容面（packages/vfsl AGENTS 兼容面不含 doc-runtime 域词；detached-build 文案自由，B9 保持不动）；构造域拒绝行为本身仍由 C-3/C-4a/C-4b 结构性覆盖（消息非空形态）。不经 number 叶重新驱动该域词需新建用例，超出「最小受影响面修订」边界，不为本任务义务。
- **失准注释裁决（`materialize.ts` L128 / `replace.ts` L120「① 逻辑校验（值域宽域）」）**：**允许最小注释更正**——各 1 行、comment-only、零代码语义变化，建议措辞「① 逻辑校验（number 值域经 ADR 0021 收窄）」，列入 ALLOW。理由：同变更集文档纪律（docs/AGENTS.md「行为变更须同步修订 stated contract 变化的规范文档」的注释侧同构），保留与刚落地 ADR 直接矛盾的注释只会成为后续评审噪音。备选（记录为已知非规范滞后、不改）被拒绝——成本相同但留下已知矛盾。

**验证属实现/评审门**：修订后 3 用例在新语义下绿；`git diff` 中 doc-runtime 改动仅限本节列出的两测试文件（用例级）+ 两注释行；SA4 复核断言修订与新失败面一致（§12 F1 验收行）。

---

## 8. 接口、状态机和数据流

**接口变化**：无公共接口变化。`ValidateResult` / `ValidateIssue` 联合形状不变；`validateLogicalSnapshot` / `validateSubtree` / validate-patch 家族签名与同步纯函数契约不变；新增全部为 `validate.ts` 模块局部符号。

**状态机**：无状态机。校验器是同步纯函数；联合三段算法的段间数据流（候选集 / 距离数组 / 报告分支）结构不变，仅 number 谓词在段 1（`contradicts`）与段 2/下钻（`validateValue`/`countIssues`）同时收窄。

**数据流路线**（本变更影响的运行时数据路径；每跨模块/持久化边界单列一跳）：

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 普通写路径（doc-runtime） | 应用经 `NamespaceLease.mutateData()` 提交 mutation，payload 含四值之一 | 目标：Yjs 载体（经 guarded tx） | namespace-runtime S3 `snapshotMutation`+`copyFrozen`：NaN/±Inf 此处被既有契约拒（类 B 失败，零写入，`MUTATION_INPUT_NOT_PLAIN_DATA` 诊断）；`-0` 穿透 → doc-runtime `applyValidatedMutation` → `planMutationBoundary` → `applyMutationAtBoundary` → `validateSubtree`（**新拒点**） | 无写入（拒绝先于 detached 构造与 tx） | — | `{ok:false, issues:[收窄消息]}` → mutation-local `{kind:'fail'}` → write.ts R9 `validation/rejected` 透传 | 零 Yjs 写入（管线既有承诺）；无清理责任 | T1-AC2-1、T2-AC3-1 |
| R2 全量校验路径（rearm/替换/物化/建档） | `validateLogicalSnapshot`：materialize（L128 域）、mutation 重校验（L105/L112）、replace/schema-replace、registry create-document（L65/L108）、changelog record 校验（memory.ts L285） | 目标：无（纯校验）或后续 detached 构造 | `interpret` → `validateValue`（**新拒点**）；issues 引用零损透传 | — | 调用方 result 联合 | 四值 → `ok:false` 单条收窄 issue（精确 path）；record 校验面不受影响（record 字段经投影期 finite 过滤与 -0 归一，SA6 §10 行 5） | 调用方既有失败通道（零写入/不发 doc）；存量四值 doc 在重校验点 loud 失败 = ADR 决策 5 既定姿势 | T1-AC1-1~5 |
| R3 changelog 观测路线 | 合法写入的 `proposedBoundary` / emission `input.snapshot` | changelog record（内存/文件 adapter） | `jcs`（RFC 8785）→ digest（SHA-256）→ 四策略投影 | record（JSONL/sidecar——格式不动） | reader / replay | 合法写入 `capture:'full'` 且 digest=sha256(JCS)；四值快照对合法写入**结构性不可达**（R1/R2 已拒） | 机制锚保持：直投 NaN 快照 → `unavailable`+`input-projection-failed`；`-0` 与 0 digest 碰撞（AC3-4 解释机制，非红灯） | T2-AC3-1~5 |
| R4 读路径 | doc-runtime 读（schema-independent） | — | 不变：不重编译不重校验 | 存量 doc 中四值仍忠实存活（Yjs 二进制权威链） | 读回原值 | 零变化（非目标） | — | 既有读路径套件（不新增断言） |

**无运行时数据流变化的面的依据**：parser/IR/derived/codegen（纯文本求值产物，与运行时值无关，ADR 决策 6）；changelog record schema/JSONL（仅可达性变化，ADR 0014 格式冻结）；复制 wire（Yjs 二进制对四值忠实，非本任务面）。

## 9. 错误、恢复、并发和幂等

- **失败语义**：四值拒绝 = 普通 `ValidateResult` `ok:false` + 单条 issue（path 精确、消息满足 D-D 规则）。不新增 throw 面、不新增错误码、不触碰 E100 崩溃边界与 `WorkBudgetExceeded` 三重可区分终态。写路径拒绝 = 既有零写入管线（`{kind:'fail'}` / R9 `validation/rejected`）。
- **无静默 fallback**：正常路径不变量（JSON 可忠实表示数）缺失即 loud 拒绝；不存在降级放行分支。设计特别消除 D-C 的两类「静默错误」（-0 静默接受 / 0 伪报）。
- **恢复与重试**：纯函数无状态，无重试语义；调用方对 `ok:false` 的既有处理（零写入、issues 透传、运维认知 loud 失败）即为全部恢复路径。修正 payload 后重提交即成功（R6 整值替换修复语义不变）。
- **并发与幂等**：校验器同步纯函数、per-call Ctx；`NEG_ZERO_MEMO_KEY` 是不可变模块常量（与 `ISSUE_LIMIT` 同类），不携带跨调用数据；memo 语义在修复后保持「性能优化、非正确性依赖」（MEMO_CAP 清空重建路径不受影响）。判定确定性：同输入同输出，无时序/规模/概率依赖（SA6 §7）。
- **破坏性变更姿势**（ADR 决策 5）：含四值存量 doc 在 rearm/重校验触发点 loud 失败，视为数据损坏信号；不侦察、不迁移、不自动修复；发版说明显式告知 breaking（运营项，非代码项）。

## 10. 调用方影响矩阵

行为增量严格限定为「四值 @ 裸 number 叶子：ok:true → ok:false」。无返回类型/异步/生命周期变化；所有调用方的 `ok:false` 通道既有。

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
| --- | --- | --- | --- | --- |
| `validate-patch.ts`（finish L562–569 / validateBoundary L1012–1019） | 经 `validateSubtree` 消费判定；失败 → issues + prefix rebase | 同左；四值子树值 → 拒绝，消息/路径经同一 rebase | **零改动** | B4 |
| doc-runtime `mutation-local.ts`（L234/L267/L310/L366） | `!applied.ok → {kind:'fail', issues}` 零写入 | 同左；`-0`（及 vfsl 公共面直用者的 NaN/±Inf）在此被拒 | **零改动** | B8 |
| doc-runtime `materialize.ts`（L128 域）/`mutation.ts`（L105/L112）/`replace.ts`/`schema-replace.ts`/`create-initial-document.ts`（L150） | `validateLogicalSnapshot` 失败 → issues 引用零损透传 / root-invalid | 同左；存量四值 doc 在这些点 loud 失败（ADR 决策 5 既定） | **生产代码零改动**（仅 materialize.ts L128 / replace.ts L120 两行注释按 D-H 裁决更正，comment-only） | §2 调用方扫描；D-H |
| **测试级消费者**：`materialize-root.test.ts` C-7 / `replace-root-content.test.ts` L486、L630（把旧四值语义编码为构造失败支路前置） | 断言 `validateLogicalSnapshot(...NaN...).ok === true` 等旧语义（B13）；基线绿 | 收窄后 3 断言必红（NaN 在 ① 被拒、消息/支路前提均变） | **两测试文件用例级修订**（D-H 逐用例规格；ALLOW 限定；其余用例零改动） | B13；SA2 §9 契约影响表 |
| namespace-registry `create-document.ts`（L65/L108） | 校验失败 → 建档失败 | 同左 | **零改动** | 同上 |
| namespace-runtime `write.ts`（L205–209 R9）/`schema-write.ts`（L110） | 领域失败 → `validation/rejected` + issues 透传，零写入 | 同左；`-0` 输入在 S3 之后被 vfsl 拦下（NaN/±Inf 仍走 S3 既有拒绝） | **零改动** | B8 |
| namespace-diagnostic-log adapters/reader（record 校验，memory.ts L285 等） | `validateLogicalSnapshot(RECORD_SCHEMA)` 失败 = writer bug → 丢弃+健康上报 | record 值域不含 number 叶子域（计数/epoch/path 段投影期已 finite 过滤、-0 归一）→ 行为零变化 | **零改动** | SA6 §10 行 5 |
| doc-runtime 读路径 / 消费侧守卫（`extract.ts` L268–272、`detached-build.ts` L183–186） | 非有限数 loud 拒、`-0` 直通 | 同左（种子/直构面由消费侧判据继续兜底，ADR 决策 7） | **零改动** | B9 |
| persistence `seedForTest` / 手工 Y.Doc 直构 | 不经校验 | 不变（排除面） | **零改动** | SA6 §10 |
| 下游间接调用方（Hub/Peer 复制、Registry 生命周期） | 消费 ValidateResult 形状 | 形状不变；合法写入流不含四值 → ADR 0010 R2-4 判据的契约外形态进一步仅存种子/直构面 | **零改动** | SA8 §3 ADR 0010 行 |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
| --- | --- | --- |
| `packages/vfsl/src/validate.ts` | ① 新增模块局部辅助（`isJsonFaithfulNumber`/`renderNumberValue`/`scalarAccepts`/`scalarRejectMessage`/`NEG_ZERO_MEMO_KEY`/`memoKey`）；② `validateValue` scalar 分支与 `contradictsInner` scalar 分支改用 `scalarAccepts`/`scalarRejectMessage`；③ memo 三触点键归一化（L289/L312/L382）。不新增导出、不改计费 | 唯一生产改动点（B1–B3、B6；§7 D-A/D-B/D-C） |
| `packages/vfsl/test/validate-number-domain-narrowing.test.ts` | **新建** T1 红灯行为契约（SA6 §12 T1 断言规格 AC1-1~AC2-1/AC5/AC6/AC7 + 本设计新增 AC1-5 memo 序独立性块 + 联合位形态锁定） | AC1/AC2/AC5 + memo 回归；vitest include `packages/*/test/**/*.test.ts` 天然收录（vitest.config.ts L15），包 tsconfig 含 test（SA6 §14） |
| `packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts` | **新建** T2 观测闭合锁定（SA6 §12 T2 断言规格 AC3-1~AC3-4；AC3-5 = 既有 `input-capture.test.ts` 不改保持绿） | AC3；依赖方向正确（D-F Q4） |
| `docs/vfsl/v1-spec.md` | §8 第 3 条规则后插入「例外条款」引导行 + 「语义收窄例外」条款（ADR 0021 决策 4 逐字），其余零改动 | SA8 Required action 1 / ADR 0021 决策 4 / docs AGENTS「行为变更同步规范」纪律（§7 D-E） |
| `packages/doc-runtime/test/materialize-root.test.ts` | **用例级修订**（D-H）：RAC-2 CASES 删除 C-7 行 + 原位一行迁移注释 + 新增一个逻辑失败用例；其余用例零改动 | SA2 F1：C-7 前置断言旧四值语义，收窄后必红；不迁移则 AC6「全仓全绿」不可达（B13） |
| `packages/doc-runtime/test/replace-root-content.test.ts` | **用例级修订**（D-H）：L486 用例前置翻转 + 消息断言替换（删 `toContain('non-finite number')`）+ issues 零损透传断言 + 用例名更正；L630 用例前置翻转 + 用例名更正（等价断言保留）；其余用例零改动 | SA2 F1：两用例前置断言旧四值语义，收窄后必红（B13） |
| `packages/doc-runtime/src/materialize.ts`（L128）、`packages/doc-runtime/src/replace.ts`（L120） | 各 **1 行注释更正**：「① 逻辑校验（值域宽域）」→「① 逻辑校验（number 值域经 ADR 0021 收窄）」；comment-only，零代码语义变化 | SA2 F1 第 3 点裁决（D-H）：失准注释与同变更集 ADR 语义直接矛盾，按最小成本同变更集更正 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
| --- | --- | --- |
| `packages/vfsl/src/validate-patch.ts` | 写路径同口径的承载者 | 经 `validateSubtree` 共享解释器自动同口径；改动会引入第二判定实现（B4、SA6 §10） |
| `packages/vfsl/src/index.ts` | 公共 API 面 | 不新增导出（AGENTS.md「Add public API only through src/index.ts」+ ADR 0021 L133–134 无新增面） |
| `packages/vfsl/src/` 下 parser、tokenizer、evaluate、derived、schema-envelope 等 IR/codegen 相关文件 | 文本侧 `-0` E100 / int/range 的落点 | ADR 0020 不在决策集；SA8 §8-R3 排除；决策 6 冻结 IR/derived/codegen（SA6 探针 4：现状 `-0` 已 E100、`int/range` 已 E301） |
| `packages/vfsl/src/validate.ts` 的 `jsonTypeOf`/`preview`/`enumContains` 及计费常量 | 相邻诊断/渲染/枚举面 | 兼容行为面（多消息共用）；枚举不收窄（D-G）；计费语义冻结 |
| `packages/doc-runtime/**`（**除 ALLOW 列出的两测试文件与两注释行**） | 写/读路径与消费侧守卫 | 拒绝经既有 `{kind:'fail'}` 通道；读保持 schema-independent；守卫按决策 7 保持（B8/B9）。**修订（F1）**：本行由整包禁改收窄为「除 ALLOW 明列的 `test/materialize-root.test.ts`、`test/replace-root-content.test.ts`（均限 D-H 用例级修订）与 `src/materialize.ts` L128、`src/replace.ts` L120 两注释行外的一切 doc-runtime 路径」——src 生产语义（mutation-local/extract/detached-build/读路径等）仍零改动 |
| `packages/namespace-runtime/**` | S3 snapshotter 与 R9 通道 | S3 不改（NaN/±Inf 既有契约）；R9 通道既有（B8） |
| `packages/namespace-diagnostic-log/src/**` | changelog 语义/投影/schema | record schema/JSONL 冻结（ADR 0014；包 AGENTS.md）；仅可达性变化（B10） |
| `packages/namespace-diagnostic-log/test/input-capture.test.ts` | 既有投影契约测试 | AC3-5：不改一行保持绿——投影契约是观测侧故事，不属写路径收窄（B10） |
| `packages/persistence/**`（含 `seedForTest`） | 种子面 | ADR 0021 决策 7 明示排除 |
| `packages/vfsl/test/` 既有全部测试文件（含 `compile-schema-envelope.test.ts` 指纹 KAT、`validate-*.test.ts`、fixtures） | 零改动锁定的对照面 | AC4 逐字节零改动；基线绿是锁定证据（B12） |
| `docs/adr/**` | 决策冻结源 | ADR 0021 已 accepted；docs AGENTS「Amend or supersede explicitly」——本任务无修订需求 |
| `docs/vfsl/v1-spec.md` §8 以外章节 | 规范其他面 | SA8：被触碰文本收敛为 §8；扩面违反最小修订（D-E 备选拒绝理由） |
| `CONTEXT.md` | 共享词汇表 | SA8 R4 可选建议不采纳（§4 表末行理由） |
| 生成物 / fixtures / `pnpm-lock.yaml` / 工作流配置 | — | 决策 6 零影响；无新依赖 |

## 12. 验收与验证映射

可执行验收 = SA6 已批准契约（T1/T2）+ 本设计新增 AC1-5（memo 序独立性，v1 合法 schema 形）+ D-H 既有测试迁移验收（SA2 F1）；D1 为 review 门交付物。SA1 不编写/运行测试；下表是后续所需证据的完整规格。

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
| --- | --- | --- | --- |
| AC1 validate 四值全拒 + 消息细分 + 有限数放行（Issue L21） | 旧实现五面放行（SA6 §5）；反事实 104/104（§13） | T1-AC1-1（裸叶子逐值：`ok:false`、恰 1 条、path `['n']`、消息规则①–④、四值两两互异、`-0` 尾 token `-0`）；AC1-2（`0/0.5/-1/1e308/5e-324/MAX_SAFE_INTEGER/-2.5e-7` 逐值 ok:true）；AC1-3（嵌套位 `['list',0]`/`['rec','k']`/`['o','v']`/联合位——联合位按 D-B 锁恰 2 条且四值 detail 在场（`number | string` 序））；AC1-4（`{num:NaN,str:1,bool:'x'}` 恰 3 条、声明序） | 旧实现红 / 目标绿（SA6 §12 表逐格） |
| **memo 序独立性（本设计新增，D-C）** | 无（SA6 断言集未覆盖元素序相邻污染；JS 语义探针 B7） | **T1-AC1-5**（schema 为 v1 合法形，D-C「测试输入的 v1 合法形」：`type U = number | string; type ROOT = { xs: U[]; };`）：① `{xs:[0,-0]}` → `ok:false` 且 `['xs',1]` 有满足规则①–④ 的 issue（无 memo 修复的实现 = ok:true，红）；② `{xs:[-0,0]}` → `['xs',0]` 拒且**无** path `['xs',1]` 的 issue；③ `{xs:[0,NaN]}` 对照 → `['xs',1]` 拒（NaN 键无碰撞）；④（可选）`{xs:[0,0.5,-0,1]}` 混序仅 `['xs',2]` 拒；⑤ Record 值位同款（`type ROOT = { rec: Record<string, number | string>; };`，RecordType 实参为 TypeExpr、联合直接合法）：`{rec:{k1:-0,k2:0}}` 仅 `['rec','k1']` 拒 | 序无关：0 与 -0 的判定互不污染；schema 经 parser 产出 ok 派生物（无 E100） |
| AC2 validate-patch 写路径同口径（Issue L22） | 四类写路径共享 `validateSubtree` 实测（SA6 §5 H/B） | T1-AC2-1：`validatePatch`/`validateAppendToArray`/`validateInsertIntoArray`/`applyMutationAtBoundary`（set 边界与 array-insert）四值逐值 `ok:false`；消息与 AC1-1 **逐字节相同**；path rebase 各自正确、恰 1 条 | 全拒且同字面 |
| AC3 changelog 结构性闭合（Issue L23） | 机制三态实测（SA6 §13 证据 3） | T2（`packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts`，依赖 `@nomicore/vfsl` + 本包 emitter/helpers）：AC3-1 `applyMutationAtBoundary` 四值全拒；AC3-2 有限正控 `capture:'full'` + `digest===sha256Hex(jcs(proposedBoundary))` + 零 `input-projection-failed`；AC3-3 闭合不变量（写接受 ⇒ `capture!=='unavailable'`）；AC3-4 机制锚（直投 `{n:NaN}`→unavailable+事件、`-0`/`0` digest 相同——解释机制，新旧同绿）；AC3-5 既有 `input-capture.test.ts` 不改保持绿 | 合法写入不再触发数值分支 unavailable |
| AC4 IR/derived/codegen/fixture 指纹零改动（Issue L24） | 基线全绿 + `generate --check` exit 0（B12） | T1-AC6：实现后全仓 `pnpm test`（含指纹 KAT `compile-schema-envelope.test.ts`）+ `pnpm typecheck` + `pnpm generate --check` 全绿；fixtures/生成物 `git diff` 为空；`index.ts` 无新导出；无新错误码；**全仓 `git diff` 恰为枚举变更集**——`packages/vfsl/src/validate.ts`、两枚新建测试文件、`packages/doc-runtime/test/materialize-root.test.ts` 与 `replace-root-content.test.ts` 的 D-H 用例级修订、`materialize.ts`/`replace.ts` 各 1 注释行、`docs/vfsl/v1-spec.md` §8 插入段，除此之外零 diff（SA2 F1 验收门） | 逐字节零改动（IR/derived/codegen/fixtures）；测试面全绿可满足 |
| 排除面负控（SA8 R3） | 探针 4（E100/E301 现状） | T1-AC7：`-0` 字面量仍 `E100 未知记号: -`；`int/Int/range/Range` 仍 `E301`；parser/tokenizer/evaluate/derived、doc-runtime extract/detached-build、persistence seedForTest 文件零改动 | 不得扩散 |
| 相近负控（收窄不波及） | 负控 49/49 绿（SA6 §6） | T1-AC5：typeof 失配 5 类消息精确（前缀+尾 token）且不含收窄短语；`unknown` 叶 NaN 放行；null/string/boolean 分支不变；枚举 `-0`/`NaN` 行为不变（D-G） | 全绿 |
| AC5 包测试 + typecheck 全绿（Issue L25） | 基线（B12） | 实现后全仓 `pnpm test`（vitest run --typecheck）与 `pnpm typecheck` | 全绿 |
| F1 既有测试迁移（D-H；SA2 验收门） | B13（3 断言旧语义；逐行复读核对） | 实现后两测试文件按 D-H 逐用例规格修订：3 用例在新语义下绿（C-7 迁移用例：① 拒 + 恰 1 条 + path + 消息规则①–④ + 零损透传 + 0 update + state 不变；L486：① 拒 + 收窄消息 + 零写入 + 旧内容原封；L630：① 拒 + mat/rep issues 等价）；doc-runtime `git diff` 仅限 ALLOW 列出路径；SA4 复核断言修订与新失败面一致 | 旧断言红 → 迁移后绿；无第三种处置（不放宽、不删除覆盖） |
| §8 条款落文（SA8 R1） | 规范基线无例外条款（B11） | **D1 review 门（非可执行测试）**：§8 条款在场且与 ADR 0021 决策 4 语义一致；三条规则与「只增不改」表述未被改写；无 0020 保留名条款；`version` 不升、错误码不重编；`git diff --check` 干净；实现报告携带 §8 diff 供 SA8 复查 | 同变更集完成 |

## 13. 风险、回滚和残余问题

**风险与对策**

| 风险 | 评估 | 对策 |
| --- | --- | --- |
| memo `-0/0` 相邻污染（-0 静默接受 / 0 伪报） | **高**（若不修：AC1-3 被元素序击穿；设计已实证 JS 语义） | D-C 哨兵键 + T1-AC1-5 序矩阵（必做，非可选） |
| 联合位报告形态选择引入新不兼容 | 低：四值在旧实现被静默接受（零输出），一切新输出都是新行为，无既有 fixture 依赖（反事实 both 全绿） | D-B 锁定形态（`number | string` 序 → 汇总+四值 detail 恰 2 条）；T1-AC1-3 锁定 |
| 消息冻结粒度过紧阻碍实现 | 低：D-A 文案天然满足规则①–④；整句不冻结 | 维持 SA6 粒度（D-D）；实现期若需改①须重议 AC1「消息细分正确」判据并回 SA8 |
| 存量四值 doc 破坏性 loud 失败 | 既定（ADR 决策 5 owner 裁决；数据损坏信号） | 不缓解、不迁移；发版说明 breaking 告知（运营 follow-up，非本变更集代码项） |
| 破坏冻结面（指纹/IR/codegen/错误码/锚位） | 低：纯运行时谓词收窄，无文本/生成物路径 | T1-AC6 + `generate --check` + diff 核查；SA8 复查项 (c) |
| §8 条款措辞偏离 ADR | 低：逐字采用 + 引导行零规范性 | D1 review 门四查（在场/一致/不扩面/不重编） |
| **既有测试断言旧四值语义（F1 面）**：不迁移则 AC6「全仓全绿」不可达；无规格迁移则修订内容失控（违 DENY 或违 AC6 的两难） | **高**（SA2 判 BLOCKER；本迭代已收编为确定性规格） | D-H 逐用例迁移规格 + §11 ALLOW 限定（用例级/comment 级）+ §12 F1 验收行（SA4 复核 + 枚举变更集 diff 门） |

**回滚**：生产改动收敛于 `validate.ts` 单文件 + spec 单条款。回滚 = 恢复 `typeof` 谓词两分支与 memo 三触点、删除 §8 插入段与两枚测试文件、回退两枚 doc-runtime 既有测试的 D-H 用例修订与两注释行；无持久化格式、无数据迁移、无 wire 影响（本变更不写任何新形态数据）。回滚后旧口径（四值放行）恢复。

**残余问题 / follow-up（均非本任务内必要条件）**

1. `preview` 在其他消息分支对 `-0` 渲染为 `0`（如枚举消息尾）——既有行为，兼容面，不在本任务触碰；若未来统一可随文案自由度处理。
2. 枚举字面量 SameValue 化（Q2 范围扩张）与文本侧 `-0`/int/range（ADR 0020 落地时）——均待后续裁决/变更集。
3. CONTEXT.md 术语条目（SA8 R4 可选）——不采纳，理由见 §4；若 owner 要求共享词汇表收录「JSON 可忠实表示数」，另行小变更集。
4. 发版说明 breaking 告知——发布流程项（Runner Host/发布侧），非代码产物。

## 14. 评审修订映射

评审输入：`wiki/raw/task_issue-319_sa2_review.md`（SA2 设计攻击评审，裁决 reject：F1 BLOCKER + F2 MAJOR；其余受指派核查面——共享谓词/双判定点/memo 键消歧/§8 例外落文/排除面保持——经攻击核验成立）。逐条落实：

| Finding | 修订位置 | 处理结果 |
| --- | --- | --- |
| **F1**（BLOCKER：AC6「实现后全仓全绿」× DENY `packages/doc-runtime/**` × 调用方矩阵「零改动」联合不可满足——3 处既有 doc-runtime 测试断言旧四值语义未被识别） | §1 目标 7；§2 B12 注记 + 新增 B13；§3 新增「既有测试影响面」段；§5 新增 F1 行；§7 新增 D-H（逐用例迁移规格 + C-7 迁移/删除裁决 + 域词断言删除/改锚裁决 + 注释失准裁决）；§10 doc-runtime 生产行改「生产代码零改动（两注释行除外）」+ 新增测试级消费者行；§11 ALLOW 增 3 行（两测试文件用例级 + 两注释行 comment 级）、DENY doc-runtime 行收窄为例外制；§12 AC6 增枚举变更集 diff 门 + 新增 F1 验收行；§13 风险表新增行 + 回滚段扩充；D-F Q5 注记 | **已落实**：两测试文件纳入 ALLOW（用例级限定）并给出逐用例修订规格——C-7 裁决=**迁移**（保留 doc-runtime 接缝的 loud 失败 + 零写入锚；C-3/C-4a/C-4b 继续覆盖构造域支路）；`toContain('non-finite number')` 裁决=**删除**（构造域词非冻结兼容面，构造域行为由 unknown 位行结构性覆盖，理由在案）；`materialize.ts` L128 / `replace.ts` L120 注释裁决=**最小更正入 ALLOW**（comment-only，备选「记录滞后不改」被拒绝并记录理由）；AC6 全绿与文件范围联合可满足。核心生产设计（D-A/D-B/D-C/D-D/D-E/D-F/D-G）零变化 |
| **F2**（MAJOR：AC1-5 指定 schema `type ROOT = { xs: (number \| string)[] };` 非法——v1 文法注记 5 括号分组即 E100，`parse-vfsl-errors.test.ts` L51–57 已锁） | §3 根因示例改合法形；§7 D-C 新增「测试输入的 v1 合法形」段（文法与等价性依据）；§12 AC1-5 单元格（schema 全文 + ⑤ `Record<string, number \| string>`）；D-C 末行笔误 `{xs:[[-0,0]]}` → `{xs:[-0,0]}`；§5 新增 F2 行 | **已落实**：三处非法文本全部替换为 `type U = number | string; type ROOT = { xs: U[]; };`（TypeRef + `[]` 后缀合文法；array 分支 `resolveValues(t.element)` 经 refMemo 解析到同一 union 节点对象——memo 外键同一性与 `-0/0` 碰撞语义等价，validate.ts L136–138/L499 在案）；⑤ 用 Record 联合实参（TypeExpr 直接合法）；双层方括号笔误已修。修订后 AC1-5 输入经 parser 产出 ok 派生物（无 E100），测试可编写且敏感性保持（无 memo 修复必红） |

SA2 非阻塞观察知悉采纳（无需设计变更）：O1（ADR 0021 引 ADR 0008 行号偏差随逐字落文传播——留作未来 ADR 勘误项，本任务不偏离「逐字」要求）；O2（§8 插入点以文本锚为准、勿按行号盲插——D-E 已按文本锚表述「第 3 条规则之后、解释段之前」）。

## 15. 是否需要设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）**，与 SA8 §10 一致，触发条件（skill 判据「触碰冻结面 / 修订既有决策 / 失败语义变化」全部命中）：

1. **失败语义变化**：validate / validate-patch 双路径对四值从接受转为拒绝，且引入新消息形态——需实现后核对消息锚位、issue 顺序、单条量与文案规则（§7 D-A/D-D；SA8 复查项 (a)）。
2. **正式 override 落文**：v1-spec §8「只增不改」冻结纪律被 ADR 0021 决策 4 授权的例外条款修订——需核对文档与代码同变更集、语义一致、override 未扩大到 int/range 或文本侧、旧引用已更新（§7 D-E；SA8 复查项 (b)）。
3. **冻结面实际 diff**：指纹逐字节、IR/derived/codegen 零改动、错误码集合、公共 API 面——需实现后 diff 核对（§12 AC6；SA8 复查项 (c)）。F1 引入的 doc-runtime 既有测试用例级修订与两注释行进入同一 diff 核对范围（§12 AC6 枚举变更集；SA2 §15 同裁：F1/F2 均不构成新的 ADR 冲突面，doc-runtime 测试修订是 ADR 0021 决策 5 breaking 姿势的直接后果）。

设计层面无未决冲突、无缺失裁决权威、无阻塞；唯一 evolution-required 项（§8 条款）已在本设计中给出完整落地方案。

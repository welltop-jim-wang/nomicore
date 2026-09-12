# 设计 — issue #315：VFSL 三约束形态核心链（number & Int / Int<min,max> / Range<min,max>，ADR 0020）

- Dispatch：`sa-29e1b680-c65b-48c4-a8d9-d0c2345aee96`（mabf-sa1 / design / iteration 0）
- 基线 worktree：`/home/wangjian/nomicore-fix-issue-315`，分支 `mabf/issue-315`，HEAD `7b92af0048ee58817aada54efdb581b24a760a93`（#314/PR #326 与 #319/ADR 0021 已合入）
- 输入：任务简报 `wiki/raw/task_issue-315.md`（Issue body = 需求全集；REST comments snapshot 为空）、SA6 验收契约 `wiki/raw/task_issue-315_sa6_contract.md`、SA8 前置冲突门禁 `wiki/raw/task_issue-315_conflict_report.md` + `wiki/raw/task_issue-315_relevant_decisions.md`
- 无 `task_issue-315_sa2_review.md`（本 iteration 无评审输入，无评审修订映射章节）
- 本设计只做架构与实现设计；不实现代码、不编写验收测试（SA3 按 §12 契约落地）

---

## 1. 任务类型、目标与非目标

**任务类型：Feature（已裁决能力的端到端兑现）。** ADR 0020（决策 2/4/5/6/7/8/10）+ ADR 0021（决策 1/2/3）已裁决三约束形态；SA6 在 HEAD 上实证了能力缺口（§5/§8/§9）。本设计把该能力从 parser 文本层一路落到 IR / derived / validate / codegen / readData 投影 / 规范文档。

**目标（可观察行为）：**

1. `number & Int`、`number & Int<min, max>`、`number & Range<min, max>` 三形态在**一切类型位置**（对象字段、别名 RHS、Record 值位、YLeaf 实参、数组元素、联合成员、可选字段）解析 → IR → derived → validate 全链贯通；
2. `Int`/`Range` 进保留名集合（16→18）：别名占用 → E303、字段名位 → E100、裸用/脱离 `number &` 语境 → E100（镜像裸 Pattern）；
3. 交叉白名单 1 例扩 4 例（E100 文案更新）；arity 严格；Int 端点整数值限定；空区间（min > max，f64 比较）解析期 E100；
4. IR/derived 新增 `int`/`range` 叶子（`exactOptionalPropertyTypes` 条件键纪律；无 Int/Range 的既有 schema IR 与指纹逐字节不变）；
5. validate 三形态逐值判定：O(1) 比较、全收集、工作预算计费、四值（NaN/±Infinity/-0）按 ADR 0021 统一基线拒绝；
6. codegen 对 `int`/`range` 发射 `number` 原样；readData 投影按标量叶子透传（无新增拒绝路径/失败码）；
7. v1-spec §2/§3/§4 与 authoring guide 修订与实现**同一变更集**落地（ADR 0020 决策 10）。

**非目标（ADR 0020 决策 10「明确不做」+ SA6 §1 范围界定）：**

- 开放/半开区间语法；指数记号；品牌类型 codegen；十六进制等其它字面量形态；
- number 基线本体（已由 #319/ADR 0021 落地，本票只做继承）；
- tokenizer/字面量面改动（#314 已裁定文法与 `-0`/超双精度闸门，本票零改动）；
- `Int`/`Range` 之外的保留名增补；错误码新增（零新增，只复用 E100/E303）；
- 指纹前缀升版（保持 `sha256:v1:`，见 §6 U2 承接）。

---

## 2. 当前行为与证据锚点（HEAD 实证）

| # | 现状事实 | 锚点（本设计逐一核实） |
| --- | --- | --- |
| C-1 | 保留名集合 16 名，无 `Int`/`Range` | `packages/vfsl/src/parser.ts:79-84` |
| C-2 | 交叉白名单只认 `string & Pattern<…>`：`number` 首元返回 primitive 后，`&` 落入 `dispatchContinuation` 的 E100 分支（锚 `&` 记号） | `parser.ts:388-397`（`:392` E100 文案）、`:468-487`（primitive 分派；`number` 在 `:486` 直接返回） |
| C-3 | `string & Pattern` 主层识别 + `[]` 后缀结合先例（`parsePatternType`；AST `pattern` 节点 pos = `string` 记号） | `parser.ts:469-481`、`:549-565`、`:49` |
| C-4 | 别名声明名占用保留名 → E303（锚声明名）；字段名位保留名 → E100（锚该记号）——两处都查 `RESERVED_NAMES`，扩集合即自动覆盖新名 | `parser.ts:296-298`、`:622-626` |
| C-5 | 数字字面量闸门已在位：超双精度 E100（锚记号）、`-0` 值判定 E100（`Object.is`，锚记号）——端点闸门可直接复用 | `parser.ts:416-428`（`parsePrimaryType` number 分支；tokenizer `Token.num` 为 f64 值，`tokenizer.ts:24-25`） |
| C-6 | IR `VfslType` 与 derived `ValueSchema` 均无 `int`/`range`（pattern 叶子在 `ir.ts:66` / `derived.ts:50`） | `packages/vfsl/src/ir.ts:40-66`、`packages/vfsl/src/derived.ts:44-53` |
| C-7 | AST→IR 转换 `toIRType` 穷尽 switch（尾部 generic-diag throw）——新增 AstType 成员会被 typecheck 机械强制接线 | `packages/vfsl/src/semantic.ts:203-242` |
| C-8 | 形状归类两处 `localCls` 均无 default（scalar 组 = primitive/literal/pattern）——新增成员被 typecheck 强制 | `packages/vfsl/src/shapes.ts:111-132`、`packages/vfsl/src/resolve.ts:132-151` |
| C-9 | `evaluate` 三处消费点无 `int`/`range`：`structureOf`（穷尽 switch）、`valueOf`（穷尽 switch）、`walkDocs`（穷尽 switch）；`isNoChildTerminal` 是**布尔表达式非 switch**（typecheck 不强制，须显式改） | `packages/vfsl/src/evaluate.ts:85-142`、`:276-325`、`:387-428`、`:210-216` |
| C-10 | `validateValue`/`contradictsInner` 穷尽 switch 无 default——手造 `int` 叶子 14/14 静默放行（SA6 E3）；pattern 先例：`contradictsInner` 类型级（`typeof value !== 'string'`，`validate.ts:375-376`） | `packages/vfsl/src/validate.ts:501-572`、`:369-409` |
| C-11 | number 家族四值基线工具已在位：`isJsonFaithfulNumber`、`renderNumberValue`（-0 经 `Object.is` 渲染 `'-0'`）、`scalarAccepts`/`scalarRejectMessage`、memo `-0` 消歧哨兵 | `validate.ts:168-204`、`:60-69` |
| C-12 | codegen 叶子闸门显式只许 scalar/enum/pattern/union 值 kind（**if 判定非穷尽 switch**，typecheck 不强制）；`projectValue` 穷尽 switch（typecheck 强制）；手造 int/range → `structure/value desync` 响亮抛错（SA6 E4） | `packages/vfsl-codegen/src/emitter.ts:335-348`、`packages/vfsl-codegen/src/valuetype.ts:26-57` |
| C-13 | readData 投影侧**已 kind-agnostic**：`matchValueNode`/`collectAliasClosure` 的 default 分支把手造 `int`/`range` 叶子按值级终态原样透传（SA6 E6）；`cloneValueSchema` 穷尽 switch 无 default（typecheck 强制） | `packages/vfsl/src/resolve-schema-at-path.ts:289-290`、`:413-414`、`packages/namespace-runtime/src/read-schema-projection.ts:121-181` |
| C-14 | `VfslKind` 协议词汇表是**结构侧**五值（map/array/xml-fragment/leaf/plain）——int/range 物化为 `leaf`，协议面零改动 | `packages/vfsl-protocol/src/index.ts:5-6` |
| C-15 | validate-patch 值校验段共享 `validateSubtree`（同一解释器）；结构侧消费 StructureNode（int/range → leaf 不变） | `packages/vfsl/src/validate-patch.ts:35`、头注 §7 |
| C-16 | 全仓唯一 `.vfsl` schema 无 `\bInt\b`/`\bRange\b`（0/0）；既有 fixture 双指纹与 `generated.ts` sha256 钉值在 `number-literals-fixture-drift.test.ts:23-25` | SA6 §4 探针 P-C + 本门禁独立复核（`conflict_report.md` #1） |
| C-17 | 两处既有文本断言与本票相交：`validate-number-domain-narrowing.test.ts:422-426`（`it.each(['int','Int','range','Range'])` 断 E301——须按 §10 翻转）；`parse-vfsl-containers-markers.test.ts:287-303`（只断 E100 码前缀，文案更新不影响绿；describe 标题过时，可选更新） | 两测试文件原文 |
| C-18 | 「交叉类型仅允许 string & Pattern<…>」文案全仓只在 `parser.ts:392`/`:480` 两处生产文案，无测试钉死 | grep 全仓（src 外零命中） |
| C-19 | E100/E303 锚位既有先例：E303 @ 声明名（`parse-vfsl-errors.test.ts:163-167` 钉 `type string = number;` @ (1,6)）；E100 @ 构造起点记号（v1-spec §4 码表 E100 行）；Pattern arity/实参错误锚越界实参或 `&` 记号（`parser.ts:478`/`:480`/`:556-557`） | v1-spec.md:385、:397；parser.ts 上述行 |
| C-20 | tsconfig：`strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` 全开——条件键纪律与穷尽 switch 强制均生效 | `tsconfig.base.json` |

**模块规约承接**：`packages/vfsl/AGENTS.md`（同步确定、判别结果不抛、IR/derived 纯数据 JSON 可序列化、错误码/issue 顺序/锚位/指纹输入 = 兼容性行为、公共 API 只经 `src/index.ts`）、`packages/vfsl-codegen/AGENTS.md`（ADR 0005：不重推导语义、逐字节稳定、`generate --check` 检出陈旧物）、`packages/namespace-runtime/AGENTS.md`（公共 API 只暴露 detached projection）、`docs/AGENTS.md`（行为变化同步全部规范文档）、根 `AGENTS.md`（typed namespace writes 纪律——本票不触碰 `domains/vfs3-assets/**` 写路径）。

---

## 3. 能力缺口（承接 SA6 §8，Feature 口径）

| 层 | 缺口 | HEAD 证据 |
| --- | --- | --- |
| 文本层 | 三形态被交叉白名单闸门整体拒绝（13 例全部 E100 @ `&` 或相应位置）；裸 `Int`/`Range` 落 E301；`type Int = number;` 合法 | SA6 §5 P1-P9/G1-G4 探针；`parser.ts:388-397`/`:462-487` |
| IR/derived | 类型族无 `int`/`range` 承载形状 | C-6；SA6 E2（手造 int 叶子 → `evaluate` 静默丢 `value` 键） |
| validate | 无判定分支且无 default ⇒ 未知 kind 恒 `ok:true`（连 `"1"`/`null` 都放行） | C-10；SA6 E3（14/14 放行） |
| codegen | 叶子闸门拒绝新 kind（desync 响亮抛错） | C-12；SA6 E4 |
| 投影/克隆 | 值树克隆无 case（typecheck 将机械报缺）；resolve-schema-at-path 已 kind-agnostic 但需注释/测试锁定 | C-13 |
| 文档 | spec §2 白名单句/EBNF、§3 形状家族、§4 保留名 16 名、guide §6 无数值约束章节 | `docs/vfsl/v1-spec.md:33-34`/`:36-65`/`:407-415`；`docs/vfsl/schema-authoring-guide.md:131-153` |

**放大因素（SA6 §8 已登记，设计必须封死）**：若实现者只改 parser/IR 而不接 validate/codegen，会把两条「假绿」通道打开——`evaluate` 对未知 kind 静默丢键却 `ok:true`；`validateValue`/`contradictsInner` 对未知 kind 静默放行。本设计通过穷尽 switch 强制接线（typecheck）+ 判别性用例（C4g）双保险封死。

---

## 4. Owner 要求落实

`gh issue view 315 --json comments` 实测 `comments: []`（SA6 §2 与派工单双确认；labels `in-progress`/`feature`，state OPEN）。**无 Owner 评论级追加要求**——需求全集 = Issue body（5 条 Acceptance criteria）。

| Issue AC | 设计落点 |
| --- | --- |
| AC1 三形态正例（整数/小数/负端点）解析→IR→derived→validate 全链贯通，边界含端点 | §8.1-§8.4（parser/IR/derived/validate 设计）；§12 映射 C1/C3/C4 |
| AC2 各负例（arity、Int 浮点端点、空区间、裸用、保留名占用 E303）错误码与锚位正确 | §8.1 锚位总表 + §7 B2-B4 冻结；§12 映射 C2 |
| AC3 NaN/±Infinity/-0 入三形态均拒绝，入裸 number 同样拒绝（ADR 0021 统一基线） | §8.4 判定级联第 2 步（复用 `isJsonFaithfulNumber`/`renderNumberValue`）；§12 映射 C4c |
| AC4 无 Int/Range 的既有 fixture 指纹逐字节不变；含 Int/Range 新 fixture 指纹稳定 | §8.2 条件键纪律 + §9 指纹论证；§12 映射 C5 |
| AC5 包测试、typecheck 全绿 | §12 映射 C8（门禁清单） |

---

## 5. 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
| --- | --- | --- |
| 三形态 + 全局位置 13 例 HEAD 全部 E100，红因逐条落在 parser 交叉白名单闸门（`&` 续位分派） | SA6 §5 表 + `parser.ts:388-397`/`:469-487` | §8.1 在 `parseIdentType` 的 primitive-`number` 分支镜像 `string & Pattern` 主层识别新增 `parseIntType`/`parseRangeType` |
| 绕过 parser 手工构造 `int`/`range` 叶子：`evaluate` 静默丢键、validate 14/14 放行、codegen desync、联合/数组承载缺口遍及容器 | SA6 §9 E2-E5 | §8.2-§8.5 全链补 case；穷尽 switch 靠 typecheck 机械强制，两处非 switch 位点（`isNoChildTerminal`、emitter 叶子闸门）在设计中显式点名 |
| 投影侧已 kind-agnostic（`resolveSchemaAtPath` 透传 ok、`['v','x']` → `SCHEMA_PATH_NOT_FOUND`） | SA6 §9 E6；`resolve-schema-at-path.ts:289`/`:414` default 分支 | §8.6 零行为改动，仅注释更新 + C6b 锁定测试 |
| 既有文本断言基线：`validate-number-domain-narrowing.test.ts:419-425` 须翻转；`parse-vfsl-containers-markers.test.ts:288-291` 只断码不受文案影响 | SA6 §4 | §10 测试面（翻转是义务，不得删除 describe 规避） |
| 指纹/生成物基线钉值（`sha256:v1:7b6c19cb…` / `sha256:v1:b71be76e…` / `generated.ts` = `342d8c1f…`） | SA6 §4 探针 P-C；`number-literals-fixture-drift.test.ts:23-25` | §9 指纹零漂移论证；DENY LIST 禁改 `domains/vfs3-assets/**` 与 `fingerprint.ts` |
| `ISSUE_LIMIT=100`、`charge` 计费点、全收集截断标记 | SA6 §7；`validate.ts:54`/`:101-114`/`:649-655` | §8.4：int/range 判定进入 `validateValue` 既有计费/收集通道，零新增计费点 |
| 边界钉值项 B1-B6（ADR 未逐字钉死） | SA6 §12.11 | §7 显式冻结（SA8 Required action 3） |

上游事实与源码无矛盾；SA6 的锚位算术（MODULE 脚手架下 FORM 起点 (1,23)、`&` 列 30、`Int` 列 32）经本设计独立重算一致。

---

## 6. SA8 约束落实

冲突门禁裁决 **clear**（14 项对照：no-conflict 4 / implements-existing-decision 10 / evolution-required 0 / hard-conflict 0）。逐条落实：

| 决议或义务（SA8 conflict_report / relevant_decisions） | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
| --- | --- | --- | --- |
| #1 ADR 0020 决策 1 + v1-spec §8 保留名增补例外（首例已登记，条件 (a)(b)(c) 成立） | §8.1 RESERVED_NAMES 16→18 | 直接兑现已裁决例外；不再走例外流程 | 是（整体，见 §15） |
| #2 决策 2 三形态/白名单四例/E100 文案更新/判定顺序与 `[]` 结合镜像 Pattern | §8.1 | 白名单句、裸用判定、后缀结合全部镜像 `string & Pattern` 既有条款 | 是（整体） |
| #3 决策 4 arity 严格/Int 端点整数限定/空区间解析期 E100/零新增错误码；**arity 锚 = 构造起点记号，不得照搬 Pattern 实参锚** | §8.1 锚位总表 + §7 B2-B4 | 只用 E100/E303；arity/空区间锚 `Int`/`Range` 记号，端点违规锚该记号 | 是（整体） |
| #4 决策 5 + ADR 0021 决策 6 + `fingerprint.ts` D2 标记：IR 条件键、既有指纹全部不变、不升 `sha256:v2:` | §8.2 + §9 | 条件键构造；`fingerprint.ts` 零改动；U2 按已裁定保持 v1 | 是（整体） |
| #5 决策 6 + ADR 0021 决策 1/3：validate 标量叶子层判定、四值统一基线、-0 `Object.is`、消息文案不冻结、validate-patch 同口径 | §8.4 | 判定级联复用 `isJsonFaithfulNumber`/`renderNumberValue`；validate-patch 零改动共享解释器 | 是（整体） |
| #6 决策 7 + ADR 0005：codegen 发射 `number`、`generate --check` 字节稳定 | §8.5 | 叶子闸门放行 + `projectValue` 两 case | 是（整体） |
| #7 决策 8 + ADR 0016：投影按标量叶子、不新增拒绝路径与失败码、TS 类型 = `number` | §8.6 | 零行为改动；`cloneValueSchema` 补 case（detached 纪律） | 是（整体） |
| #8 决策 10 + `docs/AGENTS.md`：spec §2/§3/§4 与 guide 同 PR；§8 例外条款文字不改语义 | §8.7 | 文档修订清单与实现同一变更集；§8 零编辑（两类例外已并列登记） | 是（整体） |
| #9 v1-spec §4 判定顺序第 7 条 + §6 大小写契约：保留面恰 `Int`/`Range` 两名，大小写敏感 | §8.1 + §10 负控 | 小写 `int`/`range` 与近似名保持既有行为（E301/合法） | 是（整体） |
| #10 `packages/vfsl/AGENTS.md` + ADR 0003：兼容性行为、纯数据、判别结果不抛、单错误模型 | 全设计 | 无公共 API 签名变化；issues 恰 1 条；IR/derived 保持 JSON 纯数据 | 否（局部遵循） |
| §8 Required actions 1（文档同变更集） | §8.7 | 兑现 | 是（实现后核对项） |
| §8 Required actions 2（`validate-number-domain-narrowing` 翻转为义务） | §10 测试面 | 兑现（拆分 + 文案同步，零弱化） | 否 |
| §8 Required actions 3（设计显式冻结 §12.11 B1-B6，与 ADR 明文锚位一致） | §7 | 兑现（B1-B6 全部冻结） | 否（冻结值本身） |
| §8 Required actions 4（指纹纪律：v1 前缀、钉值逐字节、静态守卫不触碰） | §9 + DENY LIST | 兑现 | 否 |
| §8 Required actions 5（保留面精确性） | §8.1 + §10 负控组 | 兑现 | 否 |
| 非阻塞登记：CONTEXT.md「值 schema」词条可选补全；`parse-vfsl-containers-markers` describe 标题可选更新 | §8.7 / §10 | CONTEXT.md 补全纳入 ALLOW（低风险对齐）；describe 标题纳入可选测试面 | 否 |

---

## 7. 设计决策与边界冻结（B1-B6，SA8 Required action 3）

### 7.1 主设计决策

| # | 决策 | 依据 | 主要备选与拒绝理由 |
| --- | --- | --- | --- |
| D1 | `Int`/`Range` 作为**全局保留名**进入 `RESERVED_NAMES`（16→18），交叉形态在 `parseIdentType` 的 primitive-`number` 分支主层识别（镜像 `string & Pattern` 的 `parsePatternType` 先例） | ADR 0020 决策 1/2；`parser.ts:469-481` 结构先例；主层识别使 `[]` 后缀作用于整个约束类型（注记 1） | 语境关键字（不进保留集合、仅 `number &` 后特判）——ADR 0020 Considered Options 3 已拒绝（与 Pattern 全局保留先例不一致、`type Int = number; type T = number & Int;` 两可长尾） |
| D2 | AST/IR/derived 新增 `int`/`range` 叶子，**镜像 `pattern` 叶子**：AST 带 pos（= `number` 记号，构造起点）、IR/derived 无 pos、`min`/`max` 为条件键（裸 `Int` 两键皆缺席，`Int<min,max>` 两键皆在场——解析层保证不出现单键） | ADR 0020 决策 5；`ir.ts:66`/`derived.ts:50`/`parser.ts:49` 先例 | 用单形态 `{kind:'int', min:null\|undefined,…}` 恒带键——违反 exactOptionalPropertyTypes 条件键纪律、破坏 JSON 纯数据哨兵（C5 断言 `Object.keys` 恰 `['kind']`） |
| D3 | validate 判定进入 `validateValue` 标量叶子分支 + `contradictsInner` 类型级矛盾，判定级联 **typeof → 四值基线 → 整数性（仅 int）→ 区间**，每叶至多发 1 条 issue | ADR 0020 决策 6 + ADR 0021 决策 1/3；`validate.ts:505-511` scalar 先例（级联：typeof → 四值） | 值级硬矛盾（越界即矛盾）——见 B6 冻结；独立顶层入口绕开 `validateSubtree`——违反共享解释器单一来源（validate-patch/联合下钻全部失配） |
| D4 | codegen 只改两处：emitter 叶子闸门放行 `int`/`range` + `projectValue` 映射 `number`；结构侧零改动（int/range 物化 `leaf`，`VfslKind` 五值不变） | ADR 0020 决策 7；C-12/C-14 | 品牌类型发射——ADR 0020 明确不做（独立 ADR） |
| D5 | 投影/克隆零行为改动：`resolveSchemaAtPath` 仅注释；`cloneValueSchema` 补两 case（条件键逐键携带） | ADR 0020 决策 8 + ADR 0016；SA6 E6 | 新增拒绝路径/失败码——ADR 明文禁止 |
| D6 | 文档与实现同一变更集：spec §2/§3/§4 + guide §6/护栏 + CONTEXT.md 词条对齐 | ADR 0020 决策 10 + `docs/AGENTS.md` | 拆 PR——被 SA8 Required actions 1 明文禁止 |

### 7.2 边界冻结 B1-B6（实现前生效；冻结值与 ADR 0020 明文锚位规则一致）

| # | 边界 | **冻结值** | 依据与后果 |
| --- | --- | --- | --- |
| B1 | `Int` 端点「整数字面量」的判定口径 | **值判定**：`Number.isInteger(tok.num)`（对 tokenizer 产出的 f64 值判定）。`Int<1.0, 2>` → ok，IR `{kind:'int',min:1,max:2}`（与 `Int<1, 2>` 逐字节同 IR，文本形态不进指纹——SA6 U5 已接受）；小数下溢归一为整数的形态（如 `0.99999999999999999` ≡ 1）亦按值接受 | ADR 0020 决策 3「字面量与区间端点一律按 f64 语义解释」（全局规则，无上下文特判）；仓库数字判定先例为值判定（`-0` 闸门注释明言文本判定漏下溢形态，`parser.ts:421-424`）；EBNF 无独立「整数字面量」产生式。文本判定（`raw.includes('.')`）被拒：制造第二套数值语义、拒绝与 `Int<1, 2>` 语义全同的写法 |
| B2 | 空区间（`min > max`）E100 锚位 | **构造起点记号** = `Int`/`Range` 记号（MODULE 脚手架下 (1,32)） | 与 ADR 0020 决策 4 arity「锚定构造起点记号」同风格；`min>max` 是端点**对**的属性、非单记号属性。锚第二端点被拒（锚位规则分裂无依据） |
| B3 | 复合违规优先级 | **结构（arity）→ 源序端点值判定 → 空区间**：实参形状扫描先行（实参数量/分隔符/记号种类；读到第三实参记号或提前闭括号即报 arity，锚构造起点），形状合法后按源序对两端点做值闸门（有限性 → `-0` → Int 整数性，锚该记号），最后空区间（锚构造起点） | 与解析推进顺序自然一致；A6/A7 按「首个违规记号」钉；`Int<0.5>`（单实参 + 浮点）报 arity @ `Int`。改序只影响契约外的复合用例 |
| B4 | 非数字实参锚位 | **锚该实参记号**（镜像 Pattern 实参错误，`parser.ts:554-558`）：`Int<"a", 1>` 锚字符串记号、`Int<1,>` 锚 `>` 记号、EOF 锚 (1,1)（`err()` 对 undefined anchor 的既有回退）；`Int<>`（零实参）按 **arity 锚构造起点**（A4） | ADR 0020 决策 4「与 Pattern 实参错误同码同锚位风格」+ 既有标点锚惯例 |
| B5 | E100 交叉白名单文案 | 文案自由（**不进冻结面**），但两处生产文案（`parser.ts:392`/`:480`）同步更新为四例表述：`string & Pattern<…>`、`number & Int`、`number & Int<min, max>`、`number & Range<min, max>`；Int/Range 失配消息受 §8.4 内容不变量约束 | ADR 0020 决策 2「E100 文案更新」；ADR 0021 决策 3「消息文案不进冻结面」；C-18 证明无测试钉死 |
| B6 | 联合成员硬矛盾模型（`contradictsInner` 对 `int`/`range`） | **类型级**：`typeof value !== 'number'` ⇒ 矛盾（镜像 `pattern`，`validate.ts:375-376`）；越界/非整数按软失配走候选分支下钻报「联合成员 i/N」诊断 | ADR 0020 决策 6「与 pattern 叶子同层」。后果钉死：C4g `{v:5}`（`number & Int<1,3> \| string`）→ **1 条** issue（候选分支：`联合成员 1/2：` + int 失配消息）；`{v:true}` → **2 条**（无候选分支：`不匹配任何联合成员…` + 下钻）；两模型在 `{v:true}` 上同形、在 `{v:5}` 上分叉，本冻结取类型级 |

---

## 8. 设计变更（接口、数据结构、数据流）

### 8.1 parser.ts — 文本层

**(a) 保留名集合**（`parser.ts:79-84`）：

```ts
const RESERVED_NAMES = new Set([
  'type', 'Record', 'Pattern', 'Int', 'Range',          // +2（16→18，ADR 0020 决策 1/2）
  'string', 'number', 'boolean', 'null', 'unknown',
  'any', 'extends', 'interface',
  'YMap', 'YArray', 'YPlainArray', 'YLeaf', 'YXmlFragment',
]);
```

自动生效（零额外代码）：别名名占用 → E303 @ 声明名（`:296-298`，B10/B11）；字段名位 → E100 @ 该记号（`:622-626`，B12）。大小写敏感：`int`/`range`/`Integer`/`Range2` 不受影响（负控 N-1/N-2）。

**(b) AstType 新增两成员**（`parser.ts:35-49`，pattern 之后）：

```ts
| { kind: 'int'; min?: number; max?: number; pos: Pos }    // pos = 'number' 记号（构造起点，镜像 pattern pos = 'string'）
| { kind: 'range'; min: number; max: number; pos: Pos }
```

AST 层同样遵守条件键纪律（裸 `Int` 不带 `min`/`max` 键；参数形两键必在场——由 (d) 的解析路径构造性保证）。

**(c) `parseIdentType` 裸用判定**（并入 `:462-467` 的保留名误用分支，与 `type`/`Pattern` 并列）：

```ts
if (v === 'Int' || v === 'Range') {
  throw this.err(ErrCode.E100, `裸 ${v} 脱离 number & ${v}… 语境（判定顺序第 7 条）`, tok);
}
```

锚 = `Int`/`Range` 记号本身；不论后随 `<` 与否（裸 `Int`、裸 `Int<1, 2>`、裸 `Range`、裸 `Range<0, 1>` 全部 E100 @ 该记号，B1-B4 目标 (1,23)）。

**(d) `parseIdentType` primitive-`number` 分支主层识别**（镜像 `:469-481` 的 string&Pattern 块；`number` 非交叉残留 `&` 仍走 `dispatchContinuation` E100 @ `&`，文案随 B5 更新）：

```ts
if (v === 'number' && this.peekPunct('&')) {
  const p1 = this.peek(1);
  if (p1 !== undefined && p1.kind === 'ident' && (p1.value === 'Int' || p1.value === 'Range')) {
    const p2 = this.peek(2);
    const hasLt = p2 !== undefined && p2.kind === 'punct' && p2.value === '<';
    if (p1.value === 'Int' && !hasLt) return this.parseIntType(tok);   // 裸 number & Int：零参合法
    if (hasLt) return p1.value === 'Int' ? this.parseIntType(tok) : this.parseRangeType(tok);
    // Range 无实参 → E100 锚 Range 记号（A5）
    throw this.err(ErrCode.E100, 'Range 脱离 number & Range<min, max> 语境（判定顺序第 7 条）', p1);
  }
  throw this.err(ErrCode.E100, CROSS_WHITELIST_MSG, this.peek());      // 锚 '&'（B5/B8 及左元非 number 族）
}
```

`CROSS_WHITELIST_MSG` 提为模块常量（`:392`/`:480` 两处共用，B5）。左元白名单按**左元**判定：`string & Int<1,2>` → string 分支 p1 非 `Pattern` → E100 @ `&` (1,30)（B5 保持）；`boolean & Int`/`unknown & Int` → primitive 直接返回后 `dispatchContinuation` → E100 @ `&`（B6/B7 保持）；`number & Pattern<"a">` → p1 非 Int/Range → E100 @ `&` (1,30)（B8 保持，仅文案更新）；`number & int<1,2>`/`number & Integer<1,2>`（小写/近似名）→ E100 @ `&`（负控）。

**(e) `parseIntType(numTok)` / `parseRangeType(numTok)`**（镜像 `parsePatternType` `:549-565`；不调用 `claimDocs`——约束位非 doc 锚位，与 Pattern 一致，夹缝 doc 留 dangling → E305 既有语义）：

```ts
private parseIntType(numTok: Token): AstType {
  this.next(); // 消费 '&'
  const nameTok = this.next()!; // 消费 'Int'
  if (!this.peekPunct('<')) return { kind: 'int', pos: posOf(numTok) };   // 零参
  this.next(); // 消费 '<'
  const [minTok, maxTok] = this.parseConstraintArgs(nameTok, /* isInt */ true);
  return { kind: 'int', min: minTok.num!, max: maxTok.num!, pos: posOf(numTok) };
}

private parseRangeType(numTok: Token): AstType {   // 进入时已确认 '<' 在场
  this.next(); this.next(); // 消费 '&' 与 'Range'
  this.next(); // 消费 '<'
  const [minTok, maxTok] = this.parseConstraintArgs(/* nameTok */ …, false);
  return { kind: 'range', min: minTok.num!, max: maxTok.num!, pos: posOf(numTok) };
}
```

**(f) `parseConstraintArgs(nameTok, isInt)`** — B3/B4 冻结序的实现本体：

```
形状扫描（arity 先行）：
  args: Token[] = []
  循环 {
    t = next()
    t === undefined            → E100『期望数字字面量，实际 文件末尾』锚 t（err() 回退 (1,1)）
    t 是 punct '>' 且 args 空   → arity E100 锚 nameTok            // Int<> / Range<>
    args.length === 2          → arity E100 锚 nameTok            // 第三实参（Int<1,2,3>）——计数判定先于种类判定（B3）
    t.kind !== 'number'        → E100『实参须为数字字面量』锚 t     // B4：锚该实参记号
    args.push(t)
    sep = next()
    sep 是 ','                 → 继续循环
    sep 是 '>' 且 args.length === 2 → 形状完成，跳出
    sep 是 '>' 且 args.length !== 2 → arity E100 锚 nameTok        // Int<5> / Range<0>
    否则                       → E100『期望 ',' 或 '>'，实际 …』锚 sep
  }
值闸门（形状合法后，按源序 [min, max] 逐个；全部复用 #314 既有闸门语义）：
  tok.num === undefined || !Number.isFinite(tok.num) → E100『端点超出双精度上限…』锚 tok     // A12
  Object.is(tok.num, -0)                              → E100『端点 -0 不在可写值域…请改写为 0』锚 tok  // A10/A11
  isInt && !Number.isInteger(tok.num)                 → E100『Int 端点须为整数值…』锚 tok    // A6/A7（B1 值判定）
空区间（最后）：
  !(min.num <= max.num) → E100『空区间：min > max…』锚 nameTok                              // A8/A9（B2）
```

**锚位总表**（MODULE(FORM) := `type ROOT = YMap<{ v: ${FORM} }>;`，FORM 起点 (1,23)、`&` 列 30、`Int`/`Range` 列 32——与 SA6 §12.3 逐例一致）：

| 类别 | 锚点 | 用例 |
| --- | --- | --- |
| arity（`Int<5>`/`Int<1,2,3>`/`Range<0>`/`Int<>`） | `Int`/`Range` 记号 (1,32) | A1-A4 |
| `Range` 无实参 | `Range` 记号 (1,32) | A5 |
| Int 浮点端点 / `-0` 端点 / 超双精度端点 | 该违规数字记号（首个违规，源序） | A6 (1,36)、A7 (1,39)、A10 (1,36)、A11 (1,38)、A12 (1,36) |
| 空区间 | `Int`/`Range` 记号 (1,32) | A8/A9 |
| 非数字实参 | 该实参记号 | B4 冻结（契约 A 组外） |
| 裸用（任何类型位置） | `Int`/`Range` 记号 | B1-B4 (1,23) |
| 别名占用 | 声明名 | B10/B11 E303 (1,6) |
| 字段名位 | 该保留名记号 | B12 E100 (1,20) |
| 左元非 number / 右元非 Int/Range/Pattern / 第二段 `&` | `&` 记号 | B5 (1,30)、B6 (1,31)、B7 (1,31)、B8 (1,30)、B9 (1,41) |
| E311（ROOT 非 map 形）/ E306（Record 数值键）/ E304（YMap/YLeaf 实参形状） | 类型表达式/键类型/标记**记号**起点 = `number` 记号（AstType pos，经 `nodePos`） | B13 (1,13)、B14 (1,30)、E9 镜像 |

注意两套锚的分工：**parser E100（arity/端点/空区间）锚 `Int`/`Range` 记号**（ADR 0020 决策 4 明文「构造起点记号」）；**AST 节点 pos（供 E304/E306/E309/E311 语义相位锚定）= `number` 记号**（镜像 pattern 节点 pos = `string` 记号，`parser.ts:564`）。二者不得混用。

**(g) `[]` 后缀与续位**：`parsePostfixType`（`:358-380`）不变——int/range 节点返回后 `[` 循环照常包装（`number & Int<0, 9>[]` = 约束整数的数组，P7）；`number & Int<1,2> & string` → 第二个 `&` 落 `dispatchContinuation` → E100 @ 该 `&` (1,41)（B9）。union 成员位、可选字段、别名 RHS、Record 值位、YLeaf 实参零额外代码（`parseTypeExpr` 递归自然可达，G1-G4）。

**(h) walk/形状注释**：`semantic.ts:43-65` walk、`shapes.ts:46-72` walkModule、`:74-99` collectRefs、`:486-503` containsSyncMarker 的 default 分支已覆盖无子节点的新 kind——仅更新注释列举（无行为变化）。

### 8.2 ir.ts / semantic.ts — IR 层

`VfslType`（`ir.ts:66` pattern 之后）新增：

```ts
| { kind: 'int'; min?: number; max?: number }   // number & Int（裸：两键皆缺席——条件键纪律，键序 kind → min → max）
| { kind: 'range'; min: number; max: number }   // number & Range<min, max>
```

`toIRType`（`semantic.ts:203-242`，穷尽 switch → typecheck 强制）新增：

```ts
case 'int':
  return t.min !== undefined && t.max !== undefined
    ? { kind: 'int', min: t.min, max: t.max }
    : { kind: 'int' };
case 'range':
  return { kind: 'range', min: t.min, max: t.max };
```

条件键纪律：不补空槽、不二次规范化、键插入序恒 `kind → min → max`（新叶子只服务新文本——既有 schema IR 逐字节不变，§9）。

### 8.3 derived.ts / evaluate.ts / shapes.ts / resolve.ts — 派生层

**`ValueSchema`**（`derived.ts:50` pattern 之后）新增与 IR 同形两叶子（条件键纪律同 `pattern` 先例；类型 JSDoc 注明「number 家族四值基线适用」，ADR 0021 决策 1）。

**`evaluate.ts` 四处**（`structureOf`/`valueOf`/`walkDocs` 穷尽 switch → typecheck 强制；`isNoChildTerminal` 非 switch → **显式手改**）：

```ts
structureOf: case 'int': case 'range': 并入 primitive/literal/pattern 组 → { kind: 'leaf' }        // 结构树：标量叶
isNoChildTerminal: r.kind === 'primitive' || r.kind === 'literal' || r.kind === 'pattern'
                 || r.kind === 'int' || r.kind === 'range'                                          // ★ 手改（typecheck 不强制）
valueOf:   case 'int': 条件键构造（同 toIRType 形状）；case 'range': { kind, min, max }              // 值树叶子
walkDocs:  case 'int': case 'range': 并入终态 return 组（无 docs 槽、无子节点）                      // 新叶子不新增/挪用 doc 锚
```

`terminalOf`（`:218-226`）的非 marker 回退 `return { kind: 'leaf' }` 自动覆盖（注释更新）；`keyPatternOf`（`:331-337`）的 else-throw 对 int/range 保持 E306 不变量（手造 IR 防御；文本侧 `Record<number & Int<1,3>, …>` 已被 `strFormOf` → E306 在解析层拦截，B14）。

**`shapes.ts`**：`localCls`（`:111-132`，无 default → typecheck 强制）`int`/`range` 并入 `'scalar'` 组——E304（`YMap<number & Int<1,3>>` → E304 @ 标记记号）、E309（混合联合）、E311（`type ROOT = number & Int;` → E311 @ (1,13)）路径自动生效（SA6 E9）；`strFormOf`（`:419-433`）default → `false` 已覆盖（int/range 非 string 形 → E306，B14）——注释更新。

**`resolve.ts`**：`localCls`（`:132-151`，无 default → typecheck 强制）`int`/`range` → `'scalar'`；`fold`/`typeCls`/`computeCls` 无需改动（经 localCls 原子归类）。

### 8.4 validate.ts — 运行时判定

**判定助手**（单一事实源，镜像 `scalarAccepts`/`scalarRejectMessage` 纪律，置于 `:168-204` number 家族工具区）：

```
intRangeReject(kind, min, max, value) → 'ok' | 'type' | 'four-value' | 'integer' | 'range'   // 级联恰取首个失配维
  1. typeof value !== 'number'                        → 'type'
  2. !Number.isFinite(value) || Object.is(value, -0)   → 'four-value'     // ADR 0021 决策 1 统一基线（复用 isJsonFaithfulNumber 的否定式）
  3. kind === 'int' && !Number.isInteger(value)        → 'integer'        // B1 同口径的运行时对偶
  4. (min !== undefined) && !(min <= value && value <= max) → 'range'     // 闭区间含双端点；int 裸形无此步
```

**`validateValue`**（`:501-572`，穷尽 switch → typecheck 强制）新增两 case，判定与消息构造：

```ts
case 'int':
case 'range': {
  const v = intRangeReject(t.kind, t.min, t.max, value);
  if (v === 'type')          ctx.emit([...path], () => `类型不匹配：期望 number，实际 ${jsonTypeOf(value)}`);
  else if (v === 'four-value') ctx.emit([...path], () => `期望 number（有限数且非 -0），实际 ${renderNumberValue(value)}`);  // 逐字沿用 ADR 0021 域短语；-0 渲染 '-0'
  else if (v === 'integer')  ctx.emit([...path], () => `期望整数${t.kind === 'int' && t.min !== undefined ? `（${t.min} ≤ v ≤ ${t.max}）` : ''}，实际 ${renderNumberValue(value)}`);
  else if (v === 'range')    ctx.emit([...path], () => `期望${t.kind === 'int' ? '整数' : ''}区间 [${t.min}, ${t.max}]，实际 ${renderNumberValue(value)}`);
  break;
}
```

消息内容不变量（文案本身不冻结，C4d 只钉语义承载）：R1 普通 issue（非 E100 前缀、非预算终态）——走 `ctx.emit` 通道天然满足；R2 实际值经 `renderNumberValue` 渲染（`-0` 含 `-0` 且 ≠ 同位 `0` 的消息——`Int<1,100>` 下 0 走 `'range'` 维渲染 `0`、-0 走 `'four-value'` 维渲染 `-0`，两条消息可区分）；R3 `b=101` 消息含上端点 `100`，`b=1.5`（integer 维）与 `b=101`（range 维）消息互异。

**`contradictsInner`**（`:369-409`，穷尽 switch → typecheck 强制）新增（B6 类型级）：

```ts
case 'int':
case 'range':
  return typeof value !== 'number';   // 镜像 pattern（:375-376）；越界/非整数属段 2 软判定
```

**计费与全收集零新增**：`validateValue` 进入即 `charge(ctx,1)`（`:502`）、`emitIssue` 记账（`:108`）、`ISSUE_LIMIT=100` + 截断标记（`:649-655`）、memo `-0` 消歧（`:67-69`）全部继承——int/range 是常数次比较（`Number.isInteger` + 至多两次 `<=`），无引擎、无回溯、无预算耗尽新路径（ADR 0020 决策 6）。

**validate-patch.ts 零改动**：写路径值校验段共享 `validateSubtree`（`:35` import）→ 同口径自动继承（SA6 U3；C4f 锁定）。结构侧消费 StructureNode（int/range → leaf）不变。

### 8.5 vfsl-codegen — 生成层

- **`emitter.ts:335-348` 叶子闸门**（★ if 判定，typecheck 不强制，显式手改）：放行条件追加 `value.kind !== 'int' && value.kind !== 'range'`；随后落入 `return projectValue(value, tables.values)` → `'number'`。注释「scalar / enum / pattern / 标量联合」同步为「scalar / enum / pattern / int / range / 标量联合」。
- **`valuetype.ts:26-57` `projectValue`**（穷尽 switch → typecheck 强制）：`case 'int': case 'range': return 'number';`（与 `pattern → 'string'` 镜像，ADR 0020 决策 7）。
- 结构侧/协议侧零改动：int/range 物化 `leaf`，`VfslKind` 五值不变（C-14）；`unionKind`/`kindLiteral`/`projectUnionMembers` 调用面不变；`YPlainArray<number & Int<1,3>>` 经 `plain` 分支 `projectValue` → `number[]` 自动生效。

### 8.6 投影与克隆 — readData 面

- **`resolve-schema-at-path.ts` 零行为改动**：`matchValueNode` default（`:289-290`）与 `collectAliasClosure` default（`:413-414`）把手造/派生 `int`/`range` 叶子按**值级终态**处理（无匹配、不可下钻）——`['b']` 透传 int 叶、`['b','x']` → `SCHEMA_PATH_NOT_FOUND`（既有码，ADR 0020 决策 8 + ADR 0016 两失败码冻结）。仅更新两处注释的终态 kind 列举。
- **`namespace-runtime/src/read-schema-projection.ts` `cloneValueSchema`**（`:121-181`，穷尽 switch 无 default → typecheck 强制）新增：

```ts
case 'int': {
  const out: Extract<ValueSchema, { kind: 'int' }> = { kind: 'int' };
  memo.set(node, out);
  if (node.min !== undefined) out.min = node.min;   // 条件键逐键携带（缺席 = 整键不存在）
  if (node.max !== undefined) out.max = node.max;
  return out;
}
case 'range': {
  const out: Extract<ValueSchema, { kind: 'range' }> = { kind: 'range', min: node.min, max: node.max };
  memo.set(node, out);
  return out;
}
```

detached 深拷贝纪律（每读全新副本、共享节点保共享）由既有 memo 机制继承。

### 8.7 文档（与实现同一变更集，ADR 0020 决策 10）

| 文件 | 修订 |
| --- | --- |
| `docs/vfsl/v1-spec.md` §2 | (i) 白名单句（L33-34）「唯一允许的交叉类型」→ 四例；(ii) EBNF `PrimaryType` 增加 `IntType \| RangeType`，新增两生产式：`IntType = "number", "&", "Int" \| "number", "&", "Int", "<", NumberLiteral, ",", NumberLiteral, ">" ;`、`RangeType = "number", "&", "Range", "<", NumberLiteral, ",", NumberLiteral, ">" ;`（G4/G5/G6 保持 GREEN：`REQUIRED_LHS` 为子集检查、`Int`/`Range` 不匹配 `Y[A-Z` 坏名规则）；(iii) 注记 1 补 `number & Int<0, 9>[]` = 约束整数的数组；(iv) 微示例可加 `type Stock = number & Int<1, 99999>;` |
| §3 | (i) 形状归类三处标量形表述（L146-147、L157-163 标记成员归类、L189 YLeaf 实参行）补「含 Int/Range 约束」；(ii) Pattern 节（L244-252）后新增「### Int / Range（数值约束）」小节：三形态表（整数性 ∧ 区间正交）、arity 严格、Int 端点整数值限定（f64 值判定）、闭区间含双端点、空区间解析期 E100、锚位规则（构造起点/违规端点记号）、判定引用 §3「number 值域」家族基线；(iii)「number 值域」家族基线句（L271-273）措辞由「进入方言后」改为现在时；(iv) ROOT 约定标量形列举（L283-285）补 Int/Range |
| §4 | (i) 判定顺序第 7 条（L353-360）裸用示例补 `Int`/`Range`；(ii) E100 码表行（L385）条件列补 arity/浮点端点/空区间/裸用示例；(iii) 保留名集合（L407-409）16→18 名补 `Int`、`Range` |
| §8 | **零编辑**（两类例外条款已并列登记；不改语义——SA8 冻结面） |
| `docs/vfsl/schema-authoring-guide.md` | (i) §6「表达值约束」增数值约束段落：`type Stock = number & Int<1, 99999>;`、`type PageSize = number & Int;`、`type Ratio = number & Range<0, 1>;`、`type Temperature = number & Range<-40, 85>;`；注意事项：`>0` 类口径写 `Int<1, 上界>`（上界按领域选取；**无单侧开区间语法**——开放/半开区间明确不做）、闭区间含端点、Int 端点须为整数值（`Int<0.5, 1.5>` → E100）、空区间 E100、`-0` 端点 E100 写 `0`、四值基线同裸 number、`[]` 后缀结合；(ii) §6 注意列表补 Int/Range 行；(iii)「v1 语法护栏」（L220）「交叉类型（Pattern 特例除外）」→ 四形态表述 |
| `CONTEXT.md` | 「值 schema」词条（L60-61）列举补「整数 / 区间约束」（SA8 非阻塞登记项；对齐 `docs/AGENTS.md` 词汇纪律；无测试 needle 相交）。「标记类型」词条维持六名不变（Int/Range 非 marker） |

文档块机检约束：`spec-docs-anchor-m4-contract.test.ts` D2（spec §5 vfsl 块双 ok——本票不改 §5 示例块）、D3/D3b（guide §7/§8——不改挂载目标句）、D5（`三锚位` needle——不相交）保持绿；新增 guide §6 示例块若用 `vfsl` 围栏须为合法文本（实现合入后成立）。

### 8.8 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 编译链 | `compileSchemaEnvelope` / `parseVfsl`（schema 文本含三形态） | parser 产 int/range AST 节点（内存） | tokenizer（零改动）→ parser（§8.1）→ `toIRType`（§8.2）→ IR int/range 叶子 | 纯内存纯数据（JSON 可序列化） | `evaluate` → derived 两树（§8.3） | `ok:true`；structure 叶 + values int/range 叶 | 判别结果不抛（E100/E303 经 issues） | C1/C3 |
| R2 语义指纹 | envelope 编译（`fingerprint.ts` 单一生产者） | `semanticFingerprintOf(lang, version, module)` | `JSON.stringify` 域文档（int/range 条件键序列化） | `sha256:v1:<hex>` 字符串 | 消费方视为不透明（ADR 0017） | 新 fixture 两次编译指纹相等；**既有 fixture 逐字节不变** | 无失败路径 | C5 |
| R3 校验链 | `validateLogicalSnapshot(derived, snapshot)` / `validatePatch` | 无写入（纯只读遍历） | `validateValue` int/range case（§8.4）→ `contradictsInner` 类型级 | 无 | issue 收集器（全收集 100 + 截断） | 失配普通 issue（path/消息含区间与实际值）；四值拒绝 | 判别结果；预算/崩溃终态继承既有通道 | C4（含 C4f/C4g） |
| R4 生成链 | `generateProjection(derived)`（codegen CLI / `pnpm generate`） | 生成 `.ts` 文本 | emitter 叶子闸门放行 + `projectValue` → `number` | 生成物文件（如 `domains/*/generated.ts`——**本票零改写**） | tsc 编译消费 | Int/Range 字段投影 `number`（`number[]` 数组元素） | desync 响亮拒绝保留（闸门收窄只放行合法组合） | C6a + `generate --check` |
| R5 读投影 | `resolveSchemaAtPath(derived, path)` → namespace-runtime `readData` | 无写入 | default 终态透传（零行为改动）→ `cloneValueSchema` 深拷贝（§8.6） | detached 投影四件套 | 调用方只读 | int 叶原样透传；越段 `SCHEMA_PATH_NOT_FOUND`（既有码） | 可信域畸形 InternalError（既有） | C6b |

跨模块边界每跳数据形态均为纯 JSON 数据（vfsl 纯函数契约）；无持久化、无网络、无生命周期新增。

---

## 9. 错误、恢复、并发、幂等与指纹论证

- **错误语义**：零新增错误码（只用 E100/E303——SA8 冻结面）；单错误模型（parse 相位恰 1 条 issue）；锚位规则见 §8.1 总表。validate 侧失配是普通 issue（全收集），非崩溃、非预算终态。
- **崩溃边界不变**：parser `VfslSyntaxError` 顶层收编、`evaluate`/`validate`/`validate-patch` 顶层 catch → E100、`resolveSchemaAtPath` 可信域 InternalError——全部继承；int/range 手造畸形（如 `Record<int叶, V>`）落入既有 loud 路径（E306 不变量），无新增静默通道（§3 放大因素已封死）。
- **并发/幂等**：全链同步纯函数、调用局部中间态、无模块级缓存（`packages/vfsl/AGENTS.md`）——无并发面。同输入同输出（SA6 E7 两轮 diff 为空先例）。
- **指纹零漂移论证**：(i) envelope 域输入 = 四键信封，本票不触碰；(ii) semantic 域输入 = `{domain, lang, version, module}`，`module` 为 IR——无 Int/Range 的 schema 其 IR 构造路径逐字节不变（parser 只新增分支，既有分支产出不变；`toIRType`/`valueOf` 新 case 只在手造/新文本时触达）；(iii) `FINGERPRINT_PREFIX = 'sha256:v1:'` 不升版——D2 触发器（第二生产者/跨实现互认/v2 方言）无一命中，ADR 0020 决策 1 明确不引入 v2 方言、决策 5 冻结既有指纹（SA6 U2 已裁定；SA8 #4 同裁）。若 owner 另裁升版须另立 ADR，实现者不得静默升版。
- **回滚**：单一变更集；revert 即恢复 HEAD（指纹/生成物钉值测试守护回归）。

---

## 10. 调用方影响矩阵与测试面

### 10.1 调用方影响矩阵（生产调用方）

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
| --- | --- | --- | --- | --- |
| `parseVfsl`（`index.ts:151`）直接消费者：`schemasource.ts`/`envelope.ts` 编译链、`schema-check-cli.ts`、各测试 | 三形态 E100；`type Int = number;` ok | 三形态 ok 产 IR；`Int`/`Range` 别名 E303、字段名 E100、裸用 E100 | **零代码改动**（结果联合形状不变；行为变化即本票目标） | `packages/vfsl/src/index.ts` |
| `evaluate` 消费者（envelope 编译、codegen collect、测试） | 无 int/range 承载（手造则丢键） | structure `leaf` + values int/range 叶；手造 IR 的 loud 边界保留 | 零改动（穷尽 switch 由 typecheck 强制接线） | §8.3 |
| `validateLogicalSnapshot`/`validatePatch`（doc-runtime `mutation-local.ts` 经 `applyMutationAtBoundary` → `validateSubtree`；namespace-runtime 写路径；测试） | 未知 kind 静默放行 | int/range 真判定；四值/越界/非整数拒绝 | 零改动（共享解释器单源） | `validate-patch.ts:35`；`packages/doc-runtime/src/mutation-local.ts:18` |
| `generateProjection`（codegen CLI、`pnpm generate --check`、`domains/*/generated.ts` 消费） | int/range → desync 抛错 | 发射 `number`；既有生成物字节不变 | 两处 case（§8.5） | C-12；ADR 0005 |
| `resolveSchemaAtPath`（namespace-runtime readData 组合） | 手造 int/range 透传 ok | 同（零行为变化），克隆补 case | 一处克隆 case + 注释 | C-13；ADR 0016 |
| `VfslKind`/PathSchema 协议消费（`@nomicore/vfsl-protocol`） | 五值 kind | 不变（int/range → leaf） | 零改动 | C-14 |
| 既有测试断言（全仓） | — | 除 §10.2 明列一处翻转外零漂移 | §10.2 | C-16/C-17/C-18 |

无未覆盖调用方；无「调用方应自行适配」项——全部经共享单源继承。

### 10.2 测试面（SA3 落地；本设计只定映射与命名建议）

- **新增**（须被 `packages/*/test/**/*.test.ts` 发现面覆盖，`vitest.config.ts` include 零配置改动）：`packages/vfsl/test/parse-vfsl-int-range.test.ts`（C1/C2）、`packages/vfsl/test/validate-int-range.test.ts`（C3 前置段 + C4 含 C4f/C4g）、`packages/vfsl/test/int-range-fixture-drift.test.ts`（C5）、`packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（C6b）、`packages/vfsl-codegen/test/generate-int-range.test.ts`（C6a，经 `tsc-helper` `preEmitDiagnostics` 0 诊断——镜像 `generate-number-literals.test.ts` 装置）。
- **必须翻转（义务，非弱化）**：`packages/vfsl/test/validate-number-domain-narrowing.test.ts:422-426` —— `it.each(['int','Int','range','Range'])` 拆分：`int`/`range` 保持 E301 负控；`Int`/`Range` 断言 **E100 @ (1,23)**（锚该记号）；describe 描述文案同步（原「int/range 三形态不在本任务」由 #315 supersede）；AC1-AC6 四值负控零弱化、不得删除 describe 规避。
- **可选（非阻塞）**：`parse-vfsl-containers-markers.test.ts:287` describe 标题「唯一被接受的交叉形式」→ 四例表述（断言只钉 E100 码，仍绿）。
- 类型级（可选 `.test-d.ts`）：`PathValue`/`PathSchema` 对 Int/Range 字段投影 `number`，经 `vitest --typecheck` 发现。

---

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
| --- | --- | --- |
| `packages/vfsl/src/parser.ts` | RESERVED_NAMES +2；AstType +2 成员；裸用分支；number& 主层识别；`parseIntType`/`parseRangeType`/`parseConstraintArgs`；白名单文案常量 | §8.1 文本层 |
| `packages/vfsl/src/ir.ts` | `VfslType` +2 叶子（条件键 JSDoc） | §8.2 |
| `packages/vfsl/src/semantic.ts` | `toIRType` +2 case；walk 注释 | §8.2/§8.1(h) |
| `packages/vfsl/src/shapes.ts` | `localCls` scalar 组 +2；`strFormOf`/walk 族注释 | §8.3 |
| `packages/vfsl/src/resolve.ts` | `localCls` scalar 组 +2 | §8.3 |
| `packages/vfsl/src/derived.ts` | `ValueSchema` +2 叶子 | §8.3 |
| `packages/vfsl/src/evaluate.ts` | `structureOf`/`valueOf`/`walkDocs` +2 case；`isNoChildTerminal`/`terminalOf` 显式补 | §8.3 |
| `packages/vfsl/src/validate.ts` | `validateValue` +2 case 与判定助手；`contradictsInner` +2 case；消息构造 | §8.4 |
| `packages/vfsl/src/resolve-schema-at-path.ts` | 两处 default 注释更新（零行为） | §8.6 |
| `packages/vfsl-codegen/src/emitter.ts` | 叶子闸门放行 + 注释 | §8.5 |
| `packages/vfsl-codegen/src/valuetype.ts` | `projectValue` +2 case | §8.5 |
| `packages/namespace-runtime/src/read-schema-projection.ts` | `cloneValueSchema` +2 case | §8.6 |
| `docs/vfsl/v1-spec.md` | §2/§3/§4 修订（§8 零编辑） | §8.7 / ADR 0020 决策 10 |
| `docs/vfsl/schema-authoring-guide.md` | §6 数值约束 + 语法护栏四例化 | §8.7 |
| `CONTEXT.md` | 「值 schema」词条列举补全（一行） | §8.7（SA8 非阻塞登记项） |
| `packages/vfsl/test/validate-number-domain-narrowing.test.ts` | AC7 块拆分翻转（§10.2） | SA8 Required actions 2 |
| `packages/vfsl/test/parse-vfsl-int-range.test.ts`（新） | C1/C2 契约测试 | §10.2 |
| `packages/vfsl/test/validate-int-range.test.ts`（新） | C3/C4 契约测试 | §10.2 |
| `packages/vfsl/test/int-range-fixture-drift.test.ts`（新） | C5 指纹/漂移 | §10.2 |
| `packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（新） | C6b 投影透传 | §10.2 |
| `packages/vfsl-codegen/test/generate-int-range.test.ts`（新） | C6a codegen | §10.2 |
| `packages/vfsl/test/parse-vfsl-containers-markers.test.ts`（可选） | describe 标题四例化 | §10.2 可选项 |

（`validate-patch.ts`、`tokenizer.ts`、`pattern.ts`、`fingerprint.ts`、`envelope.ts`、`schemasource.ts`、`index.ts`、codegen `collect.ts`/`docs.ts`/`cli.ts`、doc-runtime 全部、vfsl-protocol 全部：**零改动**——分别由共享解释器、#314 冻结面、D2 守卫、公共面不变论证覆盖。）

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
| --- | --- | --- |
| `packages/vfsl/src/tokenizer.ts` | 字面量面已由 #314 裁定 | 冻结面（SA8 冻结表「tokenizer/字面量面」；红因不在词法层——SA6 H1） |
| `packages/vfsl/src/fingerprint.ts` | 指纹单一生产者 | D2-CONTRACT-MARKER 静态守卫 + 保持 `sha256:v1:`（SA8 #4/Required actions 4） |
| `packages/vfsl/src/pattern.ts` | Pattern 引擎 | 与数值约束无交集；引擎面冻结 |
| `packages/vfsl-protocol/**` | 协议词汇表 | `VfslKind` 五值不变（C-14）；协议冻结 |
| `domains/vfs3-assets/**`（`schema.vfsl` / `generated.ts`） | 既有 fixture 与生成物 | 逐字节钉值基线（AC4/C5/SA8 Required actions 4）；typed namespace writes 纪律（根 AGENTS.md） |
| `packages/vfsl/src/validate-patch.ts` | 写路径共享解释器 | 共享 `validateSubtree` 单源（SA6 U3）；旁路实现会红 C4f |
| `packages/vfsl/src/index.ts` | 公共 API 面 | 无新公共入口（SA8 冻结表「公共 API 面」） |
| `packages/doc-runtime/**`、`packages/namespace-runtime/**`（除 `read-schema-projection.ts`） | 间接消费方 | 经共享单源继承，零适配需求 |
| `docs/adr/0020-*.md`、`docs/adr/0021-*.md` | 母法 ADR | 已接受决策不改写（`docs/AGENTS.md`；supersede 标注已在仓） |
| `docs/vfsl/v1-spec.md` §5/§8 | doc 锚位契约 / 例外条款 | D2/D3/D5 needle 与两类例外结构冻结（SA8 冻结面） |
| `tests/acceptance/vfsl_spec_acceptance.py` | 规格机检 | 只读门禁；G4/G5/G6 须保持 GREEN 而非改检查 |
| `.github/workflows/ci.yml`、`vitest.config.ts`、`scripts/ci-test-shard.mjs` | 门禁与发现面 | 新测试文件零配置即被发现（SA6 §14）；门禁不因任务放宽 |

---

## 12. 验收与验证映射

（契约细则 = SA6 §12 C1-C8；本表为需求/风险 → 证据 → 所需行为测试 → 预期观察的设计侧映射，不指定执行角色。）

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
| --- | --- | --- | --- |
| AC1/C1 三形态 + 全局位置解析 → IR | HEAD 红（SA6 §5） | `parse-vfsl-int-range.test.ts`：§12.1 MODULE/FIXTURE 矩阵 + G1-G4 + 可选字段/联合成员位 + 无空白/注释 trivia/换行形态 | `ok:true`；IR `toEqual` 深比较（含 `Object.keys` 恰 `['kind']` / `hasOwn` 断言） |
| AC2/C2 负例码 + 锚 | HEAD 码同锚异（SA6 §5/§13） | 同文件 A1-A12/B1-B14 逐例钉码 + line/column；负控组（小写/近似名/B5-B8） | 恰 1 条 issue、`VFSL-E100/E303: ` 前缀、锚位列逐例（§8.1 总表）；负控零漂移 |
| AC1/C3 derived 契约 | HEAD 红（SA6 E2） | `validate-int-range.test.ts` 前置段：FIXTURE → evaluate → 字段名序/值叶形状/structure leaf/index 引用同一性/docs 空表/`JSON.parse(JSON.stringify(derived))` 深度相等 | 条件键缺席为「整键不存在」；无静默丢键 |
| AC3/C4 validate 判定 | HEAD 红（SA6 E3/E5） | C4a-C4g：合法矩阵（含端点）、失配矩阵（path/message 不变量）、四值矩阵 + 裸 number 负控、C4e 101 全收集、C4f validatePatch、C4g 联合 `{v:5}`=1 条 / `{v:true}`=2 条（B6 冻结） | 判定级联 §8.4；消息 R1/R2/R3 不变量 |
| AC4/C5 指纹/漂移 | HEAD 绿（SA6 §4 钉值） | `int-range-fixture-drift.test.ts`：既有 fixture 双指纹 + `generated.ts` sha256 逐字节 = 钉值；新 FIXTURE 两次编译 `semanticFingerprint` 相等且 `sha256:v1:` 前缀；IR JSON 往返深度相等；`pnpm generate --check` exit 0 | 既有零漂移、新指纹稳定不钉值 |
| C6a codegen | HEAD 红（SA6 E4） | `generate-int-range.test.ts`：生成文本含 `number`/`number[]`；写临时 `.ts` 经 `tsc-helper` `preEmitDiagnostics` 0 诊断 | 无 desync；投影 `number` |
| C6b 投影透传 | HEAD 绿（SA6 E6） | `resolve-schema-at-path-int-range.test.ts`：`['b']`/`['c']`/`['a']`/`['e']`/`['e',0]` 深等透传；`['b','x']` → `SCHEMA_PATH_NOT_FOUND` | 零新增拒绝路径 |
| C6c typecheck 强制 | 穷尽 switch 位点清单（C-7/C-8/C-9/C-10/C-12/C-13） | `pnpm typecheck` exit 0（14 工程）；两处非 switch 位点（`isNoChildTerminal`、emitter 闸门）由 C3/C6a 判别 | 机械接线完成 |
| C7 文档同 PR | 部分红（SA6 §13） | spec 机检 22/22 GREEN；`spec-docs-anchor` D2/D3/D5 绿；人工评审四例化/保留名 18/新小节 | 文档与实现语义一致 |
| AC5/C8 门禁 | HEAD 全绿（SA6 §4） | `pnpm typecheck`/`pnpm test`/`pnpm generate --check`/`git diff --check`/`python3 tests/acceptance/vfsl_spec_acceptance.py` + 焦点红灯→绿 + 翻转用例绿 | 全 exit 0；焦点文件实现前红、实现后绿；C2 负控与 C5 实现前后均绿 |

突变敏感性由 SA6 §12.10 矩阵覆盖（杀死只改 parser、只改 validateValue 漏 contradictsInner、文本判定端点、恒带 min/max 键、四值只查 isInteger、fail-fast 短路、消息吞 -0 等弱实现）。

---

## 13. 风险、回滚和残余问题

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| `isNoChildTerminal`（`evaluate.ts:210-216`）与 emitter 叶子闸门（`emitter.ts:337`）是**非 switch 位点**，typecheck 不强制，漏改 → 别名链字段位 int 叶在结构树被当 ref 终态 / codegen desync | 中 | 设计显式点名（§8.3/§8.5 ★ 标记）；C3 结构树断言 + C6a desync 测试判别；SA4 复核清单 |
| 保留名收窄是 breaking（外部生态 `type Int = number;` 变 E303） | 低（仓内） | ADR 0020 决策 1 例外条款 + 冲突排查证据在案（仓库唯一 schema 0 命中）；发版说明义务由 ADR 承担，不属本变更集代码 |
| 指纹意外漂移（如 IR 键序扰动、既有路径行为变化） | 中 | C5 钉值测试 + `generate --check` 双门禁；条件键与键序纪律在设计冻结（§8.2） |
| `-0` 渲染/消息回归（R2 不变量） | 低 | 复用 `renderNumberValue`（#319 已测）；C4d 对照断言 |
| 文档块机检回归（D2/D3/D5） | 低 | 不触碰 §5 示例块与挂载目标句；§8.7 已列约束 |
| 联合报告形态分叉（B6 两模型）被误实现为值级 | 低 | C4g `{v:true}` 对两模型同形（判别 `contradictsInner` 漏 case），`{v:5}` 条数按 B6 冻结钉 1 条 |

**残余问题 / follow-up（非本票必要条件）：**

1. 开放/半开区间语法、指数记号、品牌类型 codegen——ADR 0020 决策 10 明确不做，留独立裁决；
2. `parse-vfsl-containers-markers.test.ts` describe 标题措辞——可选项，随实现顺手更新；
3. `CONTEXT.md`「标记类型」词条维持六名（Int/Range 非 marker，不进该词条）——无需动作，登记防误扩；
4. 空区间/arity 的复合违规用例（B3 序的契约外形态，如 `Int<0.5>`）——SA3 可在 C2 文件补钉（期望 = arity @ `Int` 记号，B3 冻结值）。

无未解决的任务内必要条件；无阻塞。

---

## 14. 设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）。** 理由：本设计 (i) 触碰方言文本面（schema 语言 surface：新交叉形态 + 保留名集合 16→18）；(ii) 改变 IR/derived schema 形状（新 `int`/`range` 叶子）与 validate 失败语义（新叶子四值/区间判定 + 联合硬矛盾类型级模型 B6）；(iii) 落地正式冻结例外（保留名收窄，v1-spec §8 首例）的执行面；(iv) 同 PR 规范文档修订与既有测试语义翻转均待实现后核对。SA8 门禁 §10 已预登记「设计后复审与实现后复审应逐项核对：文档与代码同变更集、语义一致、override 未扩大、旧引用已更新、既有断言零弱化」。B1-B6 冻结值均在 ADR 0020/0021 授权裁量范围内、与明文锚位规则（「锚定构造起点记号」）一致，不构成新的决策演进——复查焦点应是执行保真而非决策冲突。

---

## 附：设计自查清单（实现者/评审对照）

1. RESERVED_NAMES 18 名；E303/E100 经既有查询点自动覆盖新名（零特判）；
2. parser E100 锚 `Int`/`Range` 记号 vs AST pos = `number` 记号——两套锚不得混用（§8.1 末注）；
3. `Int` 裸形 IR/derived/AST 三层均无 `min`/`max` 键（条件键，非 undefined 槽）；
4. `isNoChildTerminal`、emitter 叶子闸门两处手改位点（typecheck 盲区）；
5. `contradictsInner` 类型级（B6）；`validateValue` 级联 typeof → 四值 → 整数性 → 区间；
6. 消息经 `renderNumberValue`（-0 ≠ "0"）；`Int<1,100>` 失配消息含 `100`；
7. `fingerprint.ts`/`tokenizer.ts`/`validate-patch.ts`/`domains/**`/`vfsl-protocol/**` 零改动；
8. 文档四文件 + CONTEXT.md 与实现同一变更集；spec §5/§8 不动；
9. `validate-number-domain-narrowing.test.ts` AC7 翻转（义务）；AC1-AC6 零弱化；
10. 门禁六件套 + 焦点红→绿证据（SA6 §12.9 C8 清单）。

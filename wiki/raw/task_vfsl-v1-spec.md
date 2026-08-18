# 任务简报 — VFSL v1 方言规格文档 (issue #4)

- **仓库**: welltop-jim-wang/nomicore（Git Worktree: `/home/wangjian/nomicore-refactor-vfsl-v1-`）
- **分支**: `refactor/vfsl-v1-`（基于 main `7317237`）
- **run_id**: `issue-4-1787047439-2215`
- **任务类型**: 功能开发（交付物是文档，不是代码）
- **上游 PRD**: issue #3，已逐字归档于 `wiki/raw/20260818-prd-vfsl-v1.md`（含 issue #9 fixture 描述摘录）
- **下游任务**: issue #5~#9（parser 实现系列，均 blocked by #4 或其下游）

## What to build（issue #4 原文）

一份可评审、可直接作为实现依据的 VFSL v1 方言规格文档：

1. **EBNF 形式的语法子集**（v1 冻结子集，见 PRD #3 Implementation Decisions）
2. **六个标记类型的语义定义**：`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`（大小写是契约）。每个标记需定义：Yjs 物化含义 + 写入粒度 + PATCH 可否下钻
3. **禁止清单**（`any` / 自定义泛型 / 条件类型 / mapped type / interface 继承 / 递归引用）逐项列出，并定义违反时的**错误语义**（结构化错误，含行列）
4. **注释规则**：`//` 与 `/* */` 忽略；`/** */` 原文捕获及挂载位置（类型别名 / 属性 / 标记类型处）；`@tag` 不做机器解析、原文保留（ADR-0001：本方言无机器标签）
5. **信封形状**：`{ lang: "vfsl", version: 1, id, text }`；parser 只消费 `text`，信封解析与方言路由是后续引擎任务（出范围，须成文声明）
6. **大小写契约显式成文**（`YLeaf`，不是 `YLEaf`；`yleaf`/`ymap` 等大小写变体按未知名报错）

## Acceptance criteria（issue #4 原文，逐字）

- [ ] EBNF 覆盖 PRD #3 列出的全部允许语法，且能推出设计文档 §4 fixture 的每个构造
- [ ] 六个标记类型各有语义定义（Yjs 物化含义 + 写入粒度 + PATCH 可否下钻）
- [ ] 禁止清单逐项列出，并定义违反时的错误语义（结构化、含行列）
- [ ] 注释规则成文：忽略与捕获的边界、挂载目标节点
- [ ] 大小写契约显式成文（`YLeaf`，不是 `YLEaf`）

## 环境事实（总控侦察结论，SA 必读）

1. **本仓库是全新空仓库**：main 仅有 `LICENSE` + `.gitignore`（`.dsh/`）。无 `package.json`、无 `src/`、无 `docs/`、无 `scripts/test-lock.sh`、无任何测试基线。
2. **PRD 引用的文档在仓库中不存在**（已全盘核实：本 worktree、本机磁盘、GitHub 全部分支/issue/PR 均无）：
   - `CONTEXT.md` 不存在 → 术语直接以 PRD #3 归档为准；
   - `docs/adr/0001`、`docs/adr/0002` 不存在 → 仅知其主题（PRD 尾注）：ADR-0001 = 单一真相源、纯引擎仓库（schema 文本不入库、测试 fixture 除外；JSDoc 无机器标签）、ADR-0002 = 全新重写 yjs-server、authority 出范围；
   - 设计文档《yjs-server Namespace Schema 自描述体系》不存在 → 其 §4 fixture 仅能从 issue #9 描述还原：`vfs3.assets` 文本，含 `AssetId` 的 Pattern 键约束、`Audit`、判别联合 `AssetEntity`、`AssetsDoc` 与 JSDoc 原文。
3. **对 AC #1 的处理要求**：设计文档既然缺位，规格文档必须**自含 fixture**——把 `vfs3.assets` 的完整 VFSL 文本作为规格文档的组成部分（附录/§引用）成文定义，使 issue #9 将来可直接引用本规格的 fixture 作为正例。fixture 内容以 issue #9 描述 + PRD #3 语法子集为约束自洽构造，并标注「依据 issue #9 还原，原设计文档缺位」。
4. **规格文档的存放路径、章节结构、验收的机械化形态**（可执行检查还是清单评审）由 SA1 设计决定。
5. 本仓库无 tsc / pnpm test 可跑（无 package.json）。本地验证命令以 SA6 锚定的验收机制为准。

## 边界与纪律（对全体 SA 生效）

- 交付物是文档 + （如设计要求）最小验收机制；**不实现 parser**（issue #5~#9 的事），不引入 yjs / 网络 / 存储依赖。
- PRD #3 Out of Scope 全部沿用：不求值器、不路径索引、不 validateSnapshot、不信封解析/方言路由实现、不 JSDoc 标签结构化解析、不服务端。
- 方言 v1 冻结语义：「只增不改」——规格须成文声明方言演进规则（对历史文本的解释以文本自述版本为准）。
- 禁止 `git push`、禁止以 gh 命令开 PR、禁止改 PR base（PR 创建权独占于外部 check.sh）。
- 版本号 bump（Hard Gate #9）：本仓库无 package.json，无版本可 bump——此门禁在本任务形态下不适用，SA4 复核时确认即可。

---

## SA6 红灯契约锚定记录（2026-08-18）

### 机制形态决定

- 交付物是文档（无运行时）→ 验收机制采用**可执行检查脚本**（零依赖纯 stdlib，无端口、无测试包），不做清单评审。
- **规格契约路径：`docs/vfsl/v1-spec.md`**（downstream issue #5~#9 的引用锚点；`docs/` 与 PRD 所述 ADR 目录同源）。
- **验证命令**：`python3 tests/acceptance/vfsl_spec_acceptance.py`（退出码 0=绿 / 1=红）。
- **契约示例 fixture**：`tests/acceptance/exemplar/spec-exemplar-v1.md`（非交付物；供 SA3 对齐机器契约、SA4 复核绿路径）。
- `scripts/test-lock.sh`：本仓库不存在；本机制无端口、无测试包依赖 → 无需新增，SA4 复核确认即可。

### 为什么这是行为验证而非源码 GREP 伪测试（对 SA4 静态验尸的说明）

issue #4 的交付物是文档，文档没有运行时——文档内容即产品本身。本检查对交付物做**结构性解析**：EBNF 文法块做真实 tokenize + 递归下降语法校验；fixture 文本做词法级扫描（注释剥离、JSDoc 原文捕获、记号与相邻符号配对）；章节/表格按机器契约校验。没有任何一处读取"被测代码"做字符串形状断言。AC #1 的"EBNF 能推出 fixture 构造"在本任务以**两侧配对检查**机械化（文法生产式 ↔ fixture 构造两侧都要存在）；完整推导属 issue #5 parser 职责，出范围。

### 机器契约（SA3 撰写规格时须逐条满足）

| 域 | 契约 |
|---|---|
| 章节 | 标题含关键字：EBNF / 禁止 / 注释 / 大小写 / 信封 / 附录；六标记章节标题与 `YMap` `YArray` `YPlainArray` `YLeaf` `YXmlFragment` `Pattern` 完全相等 |
| 标记语义表 | 每标记三列表：`\| Yjs 物化含义 \| 写入粒度 \| PATCH 可否下钻 \|`；PATCH 列 ∈ {可下钻, 部分下钻, 不可下钻}，三列非空 |
| EBNF | `\`\`\`ebnf` 围栏块；结构合法（括号平衡/终止符/符号次序）；LHS 必含 TypeAlias, ObjectType, Field, UnionType, ArrayType, RecordType, PatternType, LiteralType, Comment, Marker；终元必含 string number boolean null unknown Record Pattern + 六标记标准拼写 + `?` |
| 禁止清单 | 表 `\| 禁止构造 \| 违反示例 \| 错误类型 \| 行列信息 \|`；六项逐行（any / 自定义泛型 / 条件类型 / mapped type / interface 继承 / 递归·循环引用）；错误类型为结构化错误码（VFSL- 前缀），行列信息非空（行/列/line/column） |
| 注释规则 | 含 `//`、`/* */`、`/** */` 三态；忽略 / 原文 / 捕获 / 挂载；挂载目标：类型别名 / 属性 / 标记类型；`@tag` 不机器解析（含「机器」字样，ADR-0001） |
| 大小写契约 | 六标记标准拼写 + 「未知名」变体报错字样 |
| 信封形状 | 章节内代码块含 `"lang": "vfsl"`、`"version": 1`、`"id"`、`"text"`；含「只消费」「方言路由」及「出范围 / out of scope」声明 |
| 方言演进 | 全文含「只增不改」与「自述」 |
| 附录溯源 | 附录含 `issue #9` / `还原` / `缺位`；fixture 位于附录内 `\`\`\`vfsl` 围栏块 |
| fixture 构造 | 六标记全用 + 无大小写变体（Y 大写开头的未知标记判失败）；含 AssetId / Audit / AssetEntity / AssetsDoc / vfs3.assets / `?:` / `\|` 联合 / `T[]` / `&`+`Pattern<` / `Record<` / `/** */` |

### 需求拆解 → 检查映射

| issue #4 验收标准 | 检查项 |
|---|---|
| EBNF 覆盖 PRD #3 全部允许语法，且能推出 §4 fixture 每个构造 | G3-G6（EBNF 真实语法校验 + LHS/终元覆盖）+ G15-G16（fixture 词法扫描，两侧构造配对） |
| 六标记类型各有语义定义（Yjs 物化含义 + 写入粒度 + PATCH 可否下钻） | G7 × 6 |
| 禁止清单逐项 + 结构化错误语义（含行列） | G8-G9 |
| 注释规则（忽略/捕获边界、挂载目标节点） | G10 |
| 大小写契约显式成文（`YLeaf`，不是 `YLEaf`） | G11 + G16 变体扫描 |
| （What to build #5 / 边界）信封形状 + 出范围声明 / 只增不改演进 | G12-G13 |
| （环境事实 #3）fixture 自含 + 溯源标注 | G14-G15 |

### 红灯运行证据（必须失败，2026-08-18）

命令（独立进程）：`python3 tests/acceptance/vfsl_spec_acceptance.py`
结果：**RED（验收未通过）: 0/16 项通过，16 项失败，exit=1**
关键输出（摘录）：
```
[FAIL] G1 交付物存在 — 规格文档缺失: docs/vfsl/v1-spec.md
[FAIL] G2 章节齐全 — 规格文档缺失，无法检查
...
RED（验收未通过）: 0/16 项通过，16 项失败
```
红灯性质：真实红——`docs/vfsl/v1-spec.md` 尚不存在，全部 16 项失败；SA3 交付规格前不可能转绿。

### 绿路径与判别力验证（证明契约可达成、检查非摆设）

- 契约示例绿路径：`python3 tests/acceptance/vfsl_spec_acceptance.py --spec tests/acceptance/exemplar/spec-exemplar-v1.md` → **GREEN 21/21，exit=0**。
- 变异判别力（删除 `### Pattern` 章节 + 删除 `UnionType` 生产式）→ **exit=1**，精确报出 `G2 缺少标记类型章节（Pattern）`、`G5 缺少生产式: UnionType`、`G7 标记语义定义·Pattern`——证明检查能区分"完整/残缺"规格，非永远通过。

### 交付物清单（本次 SA6 产出）

- `tests/acceptance/vfsl_spec_acceptance.py` — 验收检查脚本（纯 stdlib）
- `tests/acceptance/exemplar/spec-exemplar-v1.md` — 契约示例 fixture（非交付物）
- 本记录（测试设计 + 红灯证据）

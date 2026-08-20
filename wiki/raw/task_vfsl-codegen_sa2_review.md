# SA2 攻击评审报告 — 投影生成器 `@nomicore/vfsl-codegen` 设计（Issue #26 / F2）

> **R2 复审轮已完成（两轮）**：第一轮 R2 复审（「R2 复审记录」节）verdict **pass**；随后**第二独立轮复审**（「R2 复审 · 第二独立轮」节）经机器验证发现两项第一轮未覆盖的合法输入缺口（ref→ROOT 引用族、optional 字段配对路径）——**最终 R2 verdict: reject**（修订量：设计文档约两段文字 + 两行处置，不动任何已验证决策）。两轮的全部正面复验结论互不推翻，冲突点仅在于增量发现的处置定级，供总控裁决。
>
> **R3 复审已完成（合并终稿）**：对设计第三轮修订稿（644 行，R2-1 裁决 (a) 案定形）+ SA6 已落地 D/E/F 契约断言 + commit 008e34c 同形核验——**R3 Verdict: pass**（唯一 MEDIUM 必修项 = 实现侧 kindOf 引用位同形裁决缺口，随 SA3 返修同车路由；详见文末「R3 复审记录」）。

**Date**: 2026-08-20
**Verdict**: **reject**（窄域拒绝。架构、发射格式 v3、§7 接线、tsx 载体、依赖纪律、D2 归属、§10 探针证据均经本评审**独立机器复验成立**；拒绝根因集中在 §3.2「唯一算法骨架」的两个覆盖缺口——#1 两树不同形（设计自带 mapping fixture 即触发失配守卫，红测试结构性无法转绿）与 #2 合法 ROOT 形态无算法路径。修订面小、边界清晰，不推翻任何已验证决策。）

**评审对象**: `wiki/raw/task_vfsl-codegen_design.md`（474 行 §1–§12）
**红灯契约**: 简报「SA6 红灯测试记录」+ `packages/vfsl-codegen/test/` 四文件（R2 修订后版本）
**评审方法**: 全新视角 + 静态对账（ADR 0003/0004/0005、v1-spec、evaluate.ts/derived.ts/schemasource.ts、协议包源码、tsconfig 链、ci.yml）+ **独立动态复验**（12 组探针，命令与结果见「独立复验记录」；真仓零写入，全部探针在 /tmp 沙箱执行）
**评审过程注记**: 评审期间工作区同名文件出现一份并行评审稿；本报告为合并终稿——并行稿全部攻击点均经本会话独立复核（成立的保留并补证，不成立的剔除），并新增本会话独立发现（#9/#10/#11 与 #2 的 Record 子形态实证）。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|----------------------|
| 1 | **CRITICAL** | §3.2 结构×值配对表（「唯一算法骨架」） | **两树并非「同形」——设计自带的 mapping fixture 就会撞上失配守卫。** §3.2 前提「发射器对两棵树做同形并行走查」与 evaluate 冻结公共契约矛盾（`packages/vfsl/src/evaluate.ts` 文件头 L15-16 明文记录两树不对称：结构树侧 Record 值位解析、值 schema 侧 Record 值位仍 ref 终态）。**实测派生 schema**（探针 dump，真实 evaluate 输出）存在四类合法位置结构侧已解析终形、值侧仍是 `ref`，均不在 §3.2 表内：① `Record<K, 别名>` 值位 →（union 或 map, ref）——**SA6 mapping fixture 的 `byId: Record<Id, Entity>` 正是此类**（实测 `structure = …byId:map{<key>:union[map\|map]}`、`values.ROOT = …byId:obj{<key>:ref}`，即 (union, ref) 配对）；② 裸 ref 到 leaf 形别名字段 →（leaf, ref）（实测 `label: Id` → struct=leaf、value=ref）；③ `YMap<别名>` 实参位 →（map, ref）（实测 `meta: YMap<Meta>` → struct=map 内联、value=ref）；④ ref 到 plain/xml-fragment 形别名 →（plain/xml-fragment, ref）。§3.2 失配守卫（「kind 组合不在上表 → throw」）按字面实现会在 `ROOT.byId.<key>` 处 throw——**mapping 测试结构性无法转绿**；若 SA3 即兴按结构侧 union 键控发射内联联合，则违反 byId 正则 L127（`[^>]*['"]map['"]` 无法越过内联成员的 `>` 到达 'map'，实测验证）——双重失败。§3.9 的机器验证只验证了**输出文本**满足断言，从未验证**算法**能产出该文本。 | §3.2 增补**值侧 ref 优先规则**并修正失配守卫：「`emitNode` 首查值侧：`value.kind === 'ref'` → 一律发射 `PathSchema<别名名, kindOf(aliases[别名名])>`（引用位点的权威判定依据是值侧；此位结构侧可能是 ref 终态**或**已解析终形——两形同义，不属失配）。失配 throw 仅针对两侧均非 ref 的非法组合（如 leaf×object）」。同步在 §3.2 表加一行覆盖（X, ref）配对。已验证该修补精确复现 §3.9 样例（`byId: PathSchema<Record<string, PathSchema<Entity, 'map'>>, 'map'>`）。 |
| 2 | **HIGH** | §3.2 root 行 / §3.1 段③（ROOT 形态） | **v1-spec E311 接受的四种 map 形 ROOT 中，两种无算法路径。** E311（v1-spec L378）与解析测试（`parse-vfsl-root-convention.test.ts` L227/L237）明确接受：裸对象 / `YMap` / `Record` / 全 map 形联合。实测（探针 dump）：(a) **联合 ROOT** `type ROOT = { a: YLeaf<string> } \| { b: YLeaf<number> }` parse+evaluate ok，`root.node.kind = union`——§3.2 root 行「剥壳取内层 map」无定义，SA3 只能即兴（违反「SA3 按设计落包」纪律）；(b) **Record ROOT** `type ROOT = Record<Id, Meta>` ok，`root.node = map{<key>:…}`——按 §3.1「其字段进接口成员」逐字实现将发射**固定字面量成员 `'<key>'`**（合法运行时路径 `['asset-42']` 不在键空间 → 全落 UnknownPath，**静默错误投影**）；且其 `<key>` 值位同时踩 #1 的 (map, ref) 失配 → 失配守卫先崩（合法输入被拒）。Record ROOT 并非「天然安全形态」，需与联合 ROOT 同等明文处置。 | 二选一并明文写入 §3.2：(a) 指定发射规则——联合 ROOT：顶层成员 = 成员键集并集（每键值位 = 各成员子树联合；可选成员语义需界定）；Record ROOT：索引签名成员 `[k: string]: PathSchema<值位, 'map'>`（已验证协议包 `Step`/`MemberKeys` 对索引签名键空间成立，机制可用）；(b) 显式声明 F2 范围限界：仅支持裸对象/YMap ROOT，Record/联合 ROOT → 命名化 loud 错误（exit 2 + 规则消息）并登记后续票。**不允许**维持未提及状态——未指定的合法输入 = 隐式 crash 或静默错果。 |
| 3 | MEDIUM | §5.3 outPath 推导 | **idBase=目录名是 F2 自设的新约定，被错归于 F1；与 G 票预告目录冲突。** 设计称「id→目录映射依托 F1 脚手架约定（id base = 目录名）」——F1 无此约定：两级寻址一级 = 头部 `@id` 精确入册（权威），二级剥离后按目录名匹配仅为**诊断回退**，其决策树分支 4 显式容忍「目录名与 @id 背离」（load 仍可用，schemasource.ts L450-489 实证）。SchemaSource 信封只有 lang/version/id/text，不暴露来源目录——CLI 从 id 推 outPath 是接缝限制下的**新设不变式**。后果：ADR 0005 §2 示例头 `@id: vfs3.assets@1`（点号）+ 简报预告 G 票目录 `domains/vfs3-assets/`（连字符）→ idBase ≠ 目录名 → exit 2，F1 欣然服务的 schema 被 F2 CLI 拒绝。 | (i) 设计改述为「F2 施加的约定（非 F1 既有）」；(ii) exit 2 诊断消息写明规则本体；(iii) §5.3/§6 加 G 票交接注记（vfs3-assets ↔ vfs3.assets@1 冲突需 G 定夺一侧）。 |
| 4 | MEDIUM | §5.5 / §6 空领域集 | **`--check` 对零领域集的 vacuous pass 在 G 落地后掩蔽整体回归；`--domains` 路径打错也静默退 0。** 触发一：G 落地后 domains/ 被误删/改名/子模块未挂载 → `list()`=[] → `--check` 退 0「新鲜」（CI regen-diff 全绿掩盖总回归）。触发二（当下即存）：`pnpm generate --check --domains /typo/path` → scanDomains ENOENT 视为合法空集（schemasource.ts L303-306 实证）→ 退 0，仅一行 stderr 无法被脚本察觉。§6 TODO(#27) 只覆盖「种植前 vacuous pass」，未覆盖种植**后**的反向盲区。 | 增加阶段门 flag：`--check`/`generate` 遇零领域集时，除非显式 `--allow-empty-domains` 否则退非零并说明；CI 步骤 F2 阶段带该 flag + TODO(#27)（G 落地时移除）。SA6 既有 CLI 测试 hermetic fixture 均含一个领域，不受影响。若总控裁决接受风险，须在 §5.5 明文记录该决策而非沉默。 |
| 5 | MEDIUM | §2 / §8 依赖清单 | **devDependencies 缺 `@types/node`——typecheck 目前靠一条未声明的传递链成立。** 实测：按 §2 精确复刻包定义（无 @types/node）后 `tsc -p`（含 test）**通过**；但仅编译 codegen src（无 test 文件的 program）→ `TS2307: Cannot find module 'node:crypto'`。机制：test 导入 vitest，vitest 的 pnpm 变体 `vitest@3.2.7_@types+node@20.19.43`（peer 由 **packages/vfsl 的 @types/node devDep** 满足）把 @types/node 以环境声明拉进 program（program 级全局），使 src 的 `node:crypto`/`process` 与测试的 `node:child_process` 全部可解析。成立条件 = 兄弟包 devDep + pnpm 变体去重的**偶然**——vfsl 撤 @types/node、vitest/vite 升级改型或纯 src 编译即神秘 TS2307。兄弟包先例取错对象：vfsl（唯一有 node API src 的包）声明 `@types/node: ^20`，protocol（无 node API）才不声明；§2 抄了 protocol 的清单。 | §2/§8 devDependencies 补 `@types/node: ^20`（一行，与 vfsl 同版对齐）。零行为变化、消除隐性依赖链。 |
| 6 | MEDIUM-LOW | §5.3 / §5.4 错误映射 | **退出码表承诺「方言断言失败 → 2」，但流程未规定 catch 映射。** `assertVfslDialect`/`load`/`list` 抛 `SchemaSourceError`（如 list() 遇 missing-directive 整体 reject）；§5.3 流程未规定捕获——cli.ts 未处理 rejection 实际退 1，违背 §5.4 表。parse/evaluate 的 !ok → exit 2 已规定，SchemaSourceError 路径未规定。 | §5.3 补一句：cli.ts 顶层捕获 `SchemaSourceError` → 结构化 stderr + exit 2；§5.4 表不变。 |
| 7 | MEDIUM-LOW | §3.7 docs（测试覆盖缺口） | **fieldDocs/markerDocs 发射零红灯覆盖 + 纯值上下文 docs 未规定。** AC2 红测试只断言 aliasDocs 三条原文；§3.7 的 walkDocs 镜像（本评审已逐行核实与 evaluate.ts L356-400 文法一致——规则本身是对的）完全无断言，SA3 实现错了照样全绿。另：`YPlainArray<YMap<{…}>>` 实参内的 fieldDocs/markerDocs（walkDocs 产出 `…<item>.字段` 键）在 §3.2 plain 终态行无发射位，设计未规定保留还是丢弃。 | 设计补一句「纯值上下文内 docs 丢弃（v1 明示范围）」或规定保留方案；测试缺口以红线构想形式移交（见 #9），不强求 SA6 改契约文件。 |
| 8 | LOW-MEDIUM | AC3 编译级保证的盲区 | **生成物本身在 F2 内永不编译。** narrow test-d 是手写参照样板（自包含），生成器真输出只有文案级正则断言；若生成物有别名碰撞等编译错误，F2 全绿发现不了（推迟到 G dogfood）。缓解事实（已验证）：别名引用形 `PathSchema<Entity,'map'>` + `export type Entity = …` 与内联形经条件类型分布律**类型等价**，当前 fixture 形状无实际分歧。 | 设计 §9 补一句「SA3 自验：generateProjection 对 mapping fixture 的输出写临时文件过 `tsc --noEmit` 干跑（非 SA6 契约，SA3 自测纪律）」。 |
| 9 | MINOR（观察，SA6 侧） | §1.2 / §9.2 异议 #1 范围 | **L115 内联负例正则同样缺反引号（结构性永假负例），SA6 修订未覆盖。** `/attachments\s*:\s*PathSchema<Record<\$\{number\}/`（`.toBe(false)`）对任何合法 TS 永不命中——负例恒过、检测力为零（本评审探针实测：对 v3 样例恒 false 通过）。当前无害：孪生正例 L113 已覆盖 plain 终态语义。设计 §1.2 不可满足证明只圈 L102/L107/L133，漏了同缺陷的 L115。 | 无需设计修订；转 SA6 知悉（若顺手修订：`/attachments\s*:\s*PathSchema<Record</` 即可，无需模板键）。 |
| 10 | MINOR | §4 版本常量 / CLI 时序 | (a) `GENERATOR_VERSION` 常量与 package.json 版本靠手工同步——漏同步时头注对生成器版本说谎且 regen-diff 不报警。(b) `generate-cli-check.test.ts` 每 it 串行 spawn 2 次 `pnpm`+tsx，vitest 默认 5s/it 超时——慢 CI 有余量风险；SA6 文件冻结不可调，SA3 须保持 CLI 启动精简，SA7 留意。 | (a) §4 或纪律节明写「包版本 bump 时同步 GENERATOR_VERSION」checklist 项；(b) 登记 SA7 watch-item。 |
| 11 | MINOR | §12 ALLOW LIST | 未列 `wiki/raw/` 过程产物（SA5 报告、SA6 记录增订、本评审文件）——简报纪律「wiki/raw/ 产出文件必须随分支 commit」。 | ALLOW LIST 补一行 `wiki/raw/task_vfsl-codegen*.md`（过程产物，非实现范围）。 |

---

## 独立复验记录（机器验证——SA1 设计声称逐项复核，全部探针在 /tmp 沙箱，真仓零写入）

评审期间 SA6 异议 #1 正则修订已落工作区（L102/L107/L133 与设计 §9.2 建议稿逐字一致）。

### V1. §3.9 发射格式 v3 机器验证声称 —— **成立（且强于声称）**
- 方法：正则/字符串断言**从测试文件逐字节提取**（非手抄），v3 样例从 §3.9 围栏逐字节转写，全量执行。
- 结果：**32/32 PASS**（mapping 全部 23 项断言——含 R2 修订后的 tags/items/entityList 三正则、fieldKind×2、ROOT 负例、attachments plain 负例、aliasDocs×3、TSDoc 配平 opens=closes=4；emission 9 正则对 emission-fixture 输出全过）。设计声称「23 中 20 过」是针对修订前坏正则的历史口径——账目自洽；修订后为全满足。
- 附带证明：三条旧正则的结构性不可满足经原文核验成立（`Record<` 后紧跟 `${number}` 缺开头反引号 = 非法 TS；`[^,]*` 在元素子表首逗号截断）。

### V2. 两树形状实证（攻击点 #1/#2 的第一手证据）—— **成立**
以 `pnpm dlx tsx` 直接跑真实 `evaluate`（仓内 vfsl 源码）转储派生 schema：
- `byId: Record<Id, Entity>` → `structure = root(map{byId:map{<key>:union[map\|map]}})`、`values.ROOT = obj{byId:obj{<key>:ref}}` —— **(union, ref) 失配实锤**；
- `meta: YMap<Meta>` → 结构 map 内联 / 值 ref —— (map, ref) 失配；
- `label: Id`（Id = string & Pattern）→ 结构 leaf / 值 ref —— (leaf, ref) 失配；
- `type ROOT = Record<Id, Meta>` ok → `root.node = map{<key>:…}`（固定键语义 + 内部 (map, ref) 失配）；
- `type ROOT = { a… } | { b… }` parse+evaluate ok → **`root.node.kind = union`**。
另证实：内联联合发射无法满足 byId L127 正则（`[^>]*` 过不了成员内 `>`）——#1 的双重失败路径成立。

### V3. §10 探针证据真实性 —— **全部复现**
| §10 条目 | 复现方式 | 结果 |
|---|---|---|
| #1 空转绿 | /tmp 全尺寸仿真（按 §2/§7 精确搭建）注入故意类型错误 + 原配置 vitest | codegen test-d → **7 passed、Type Errors no errors**（错误隐形）；同错误投 vfsl-protocol test → 1 failed ✓ |
| #2 无链接 TS2307 | 合并 program 含未链接的 codegen test-d | `Cannot find module '@nomicore/vfsl-protocol'` 同根因复现 ✓ |
| #3 tsx 执行 .js 后缀 TS + 仓内 vfsl 真源 | `pnpm dlx tsx` 探针 | `helper-ok \| parseVfsl: function \| evaluate ok: true \| FileSchemaSource: function \| assertVfslDialect: function`，exit 0 ✓ |
| #4 workspace 软链 + exports 解析 | sa2sim 内 pnpm 布局软链 + `import '@nomicore/vfsl'` | 全符号加载、evaluate ok、exit 0 ✓ |
| #5 pnpm 参数转发 | `pnpm test __no_such_filter__ --passWithNoTests=false` | `No test files found, exiting with code 1` ✓ |
| #6 退出码上浮 | 同上 `echo $?` | exit=1 ✓ |
| #7 合并增广安全 | 见 V4 | ✓ |
| #8 tsx@node20 | `pnpm dlx tsx --version` → **v4.23.12**；ci.yml L18 matrix `node: [20,24]` 核对 | 依据成立（node 20 无 strip-types，排除理由正确；端到端 CI 兜底） |
| #9 v3 全断言 | 见 V1 | ✓ |

### V4. §7 test-d 接线 —— **端到端模拟验证成立（总控采纳方案的实证支撑）**
模拟 §7.2 全部三步（根 tsconfig.typecheck.json + vitest typecheck 重指 + workspace devDep 软链）：
- 注入类型错误的 codegen test-d：原配置 **7 passed 空转绿** → 重指后 **1 failed 真捕获**（接线把空转绿变为真编译）；
- 回滚注入后全量 typecheck：**narrow 6/6 真编译绿 + projection 16 绿 + empty-fail-closed 3 绿（3 文件 25 测试全过）**——「预期保持绿」由推测变为实证，既有 vfsl-protocol test-d **零回归**（§7.3 的 LocalEmptyMap 免疫 + 键路径特异断言审计属实）；
- 合并 program 纯 tsc 复核（40 文件：两包 src+test+三份 test-d 同项目）→ **exit 0 零错误**；
- §7.2.3 第三步 `tsc -p packages/vfsl-codegen/tsconfig.json` → exit 0（注：其成立依赖攻击点 #5 的偶然解析链）。

### V5. D2 宽度归属（§3.8）与 ADR 0004 一致性 —— **成立（类型级实证）**
「发射器不写 `\| undefined`、read 宽度由协议包 `PathValue` 产生」经合并 program 真编译验证：`PathValue<PathAt<Map,['entityList','0','url']>> = string | undefined` 的来源是协议包 `MemberLookup` 逐成员分发缺键补 undefined（`packages/vfsl-protocol/src/index.ts` L30-32、L39）；`PathPatchUnwrap` 取声明处 T。窄化（`UrlOf<Entity>` 非 never）、判别字段精确字面量联合、patch 拒 undefined（`@ts-expect-error` 真报错）均真编译通过。与 ADR 0004 D2「read → T\|undefined、patch → T、路径级窄化不做」逐条一致。别名引用形与内联形经分布律类型等价（攻击点 #8 的缓解事实）。

### V6. §3.7 walkDocs 文法镜像 —— **成立（源码逐行核对）**
evaluate.ts L356-400 与 §3.7 逐条对上：别名体以别名名为根（L360）、字段 `${path}.${name}`（L375）、Record 值位 `<key>`（L387-390）、数组元素 `<item>`（L384）、联合成员 `<member ${i}>`（L381）、YArray/YPlainArray 实参入 `<item>` 其余标记透明（L396）。

### V7. §5 CLI 流程与 FileSchemaSource 语义贴合 —— **成立（代码级核对 + fixture 求值探针）**
CLI 测试 fixture（`@id: demo@1` + 裸对象 ROOT）parse/evaluate ok ✓；漂移追加 `type Extra = {x:number}` evaluate ok 且 aliases 增 `Extra`（未引用别名照入表——§3.4「未引用别名也发射」有据）→ sourceText 哈希变化即保证 `--check` 退非零 ✓。信封/方言断言/两级寻址语义与 schemasource.ts 逐条核对一致 ✓。

### V8. 基线红状态 —— **复现**
`pnpm test`（真仓）：`Test Files 3 failed | 21 passed (24)`、`Tests 3 failed | 382 passed (385)`、`Type Errors no errors`——与 SA6 红证据逐字一致；narrow test-d 的 6 tests 在 382 绿内（空转绿现状）。

---

## 协议假设依据审查

- **章节存在性**：§10 存在，9 条假设逐条给出依据类型 + 实测命令 + 结果 ✓。
- **依据可验证性**：全部命令可重跑（本评审已重跑 #1–#5、#7、#9，#6 另有 SA6 spawnSync 254 旁证，#8 文档依据 + CI 端到端兜底）——无一「应该/通常/预计」类无据推断 ✓。
- **依据声称与输出**：实测声称均随附命令与输出，独立复现结果一致（V3）。
- **遗漏审查**：§10 唯一实质缺口 = **没有一条假设覆盖「结构树×值树在派生 schema 中的真实形状」**——§3.2 的「同形并行走查」前提本身是未验证的协议假设，而被 evaluate.ts 文件头明文记述证伪（攻击点 #1；本评审以真实 evaluate 转储补上了这项复验）。次要缺口：codegen node 内建类型解析依赖未显式化（攻击点 #5）。

## 错误处理链路审查

- **静默失败**：CLI 失败路径有退出码 + stderr（parse/evaluate/方言/冲突/orphan）✓；两处准静默：零领域集 exit 0（阶段态，见攻击点 #4 的 post-G 盲区与 typo 路径同退 0 的无区分信号）。
- **状态闭环**：无持久状态——纯重生成 + 逐字节 diff，写盘幂等（同输入同字节）✓，无缓存撕裂面、无竞态面（FileSchemaSource 每调用现扫恒新鲜）。
- **降级路径**：生成期零网络依赖；tsx 缺失 → pnpm 254 响亮 ✓；空领域集是唯一「降级样」路径且 F2→G 窗口内属合法阶段态（与 Domain scaffolds check vacuous pass 同构，设计已显式论证）——非虚假降级；但 G 之后转为回归掩蔽器，须补阶段门（#4）。
- **虚假降级识别**：§3.2 失配 throw 是正确的 loud 设计 ✓，但其触发集把四类**合法**配对当失配（#1）——「loud 错对象」：合法输入被当契约破坏拒绝。Record ROOT 的固定 `'<key>'` 成员路径是**静默错误投影**（#2b）——合法输入、无错、错果。`ValueContextCycleError`（纯值自引用环）loud ✓。
- **用户可感知性**：所有失败模式 stderr 有明确消息 ✓（#3/#6 要求诊断消息更精确）。

## §12 ALLOW/DENY 完备性

- ALLOW 覆盖设计所触全部实现文件（新包八文件 + 四 SA6 测试 + 根 package.json/vitest.config.ts/tsconfig.typecheck.json/ci.yml/lockfile + 设计文档）✓；#3–#6 的修订落点均在既有 ALLOW 项内（cli.ts/package.json/ci.yml 已列），无需扩容。缺口：wiki/raw/ 过程产物未列（#11）。
- DENY 对冻结面（两既有包 src+test+manifest、domains/**、docs/adr/**、pnpm-workspace.yaml、tsconfig.base.json）防护完整 ✓；「既有包零改动零 bump」与 §8 一致 ✓（vfsl 0.1.8 / protocol 0.1.0 确未触碰）。
- 附注：SA6 异议 #1 修订已按 §9.2 落地（L102/L107/L133 逐字核对一致），§9.3 落地顺序第 1 步已完成。

## 红线测试思路（对应攻击点）

1. **#1（CRITICAL）**：mapping fixture 的 byId 双正则已是天然红灯锚——字面实现 §3.2 会以 throw 失败（suite 红）或内联联合失败（L127 正则红）。建议 SA4 验证时补两个发射断言 fixture：`leafRef: Id` → 断言 `PathSchema<Id, 'leaf'>`；`metaRef: YMap<Meta>` → 断言 `PathSchema<Meta, 'map'>`——直接钉死值侧 ref 优先规则。
2. **#2（HIGH）**：hermetic fixture `type ROOT = { a: YLeaf<string> } | { b: YLeaf<number> }` 与 `type ROOT = Record<Id, Meta>` → 按修订后契约断言：或顶层成员/索引签名正确发射（方案 a），或命名化 unsupported 错误 / CLI exit 2 + stderr 规则断言（方案 b）——两案都必须**可断言**，不允许未定义行为；负例正则防静默 `'<key>'` 固定成员。
3. **#3（MEDIUM）**：hermetic fixture 目录 `demo` + 头部 `@id: other@1` → 断言 exit 2 且 stderr 含 id/目录名规则说明。
4. **#4（MEDIUM）**：hermetic 空目录（无 domains/）→ `pnpm generate --check --domains <dir>` → 修订后断言：无 `--allow-empty-domains` 退非零、带 flag 退 0；CI yaml 断言 F2 阶段步骤带 flag + TODO(#27)。
5. **#5（MEDIUM）**：静态断言（SA4）：codegen devDependencies 含 `@types/node`；行为断言：`tsc --noEmit` 仅 src 的 program（无 vitest 导入文件）编译通过——现行设计此项 TS2307。
6. **#7（MEDIUM-LOW）**：fixture 给字段/标记挂 docs（`/** 字段说明 */ label: YLeaf<string>`、YArray 标记 docs）→ `toContain` 断言出现在成员位 TSDoc；`YPlainArray<YMap<{…}>>` 内 docs → 断言设计规定的丢弃/保留 whichever SA1 定夺。
7. **#8（LOW-MEDIUM）**：SA3 自测（非 SA6 契约）：emission 输出写临时文件过 `tsc --noEmit` 干跑——捕获别名碰撞等编译级错误，G 票前移风险。
8. **#6（MEDIUM-LOW）**：hermetic fixture 头部抽掉 `@lang` 行 → 断言 exit **2**（非 1）且 stderr 含 `missing-directive` 结构化信息——钉死 SchemaSourceError 的 catch 映射。

## 结论

设计的**宏观决策全部经独立复验成立**：发射格式 v3（32/32 断言机器验证）、§7 test-d 接线（端到端实证：空转绿被真编译取代 + narrow 6/6 真绿 + 既有 test-d 零回归）、tsx 载体裁决（探针全复现，v4.23.12）、D2 宽度归属（类型级实证，ADR 0004 一致）、§4 头注哈希确定性（无时间戳/路径/环境变量；`--check` = 全量重生成 + 逐字节 diff，正确规避纯哈希盲区）、§3.7 docs 文法镜像（源码逐行核对）、§3.6 值投影九 kind 全覆盖、依赖最小化框架、§10 证据真实性与可复验性。SA1 两条异议（#1 正则不可满足、#2 空转绿）均经独立复现确认为真，处置正确且 #1 修订已落地。

**reject 的根因是攻击点 #1 与 #2**：#1——§3.2「同形并行走查」前提与 evaluate 冻结契约的两树不对称矛盾，四类合法配对落表外，失配守卫按字面实现会让**设计自带的 mapping fixture 崩溃**（红测试结构性无法转绿）——核心算法规格与已被机器验证的输出样例之间缺一条桥（值侧 ref 优先规则）；#2——四种合法 ROOT 形态中两种（联合/Record）无算法路径，其一含静默错误投影路径。修订量小（§3.2 一条值侧 ref 优先规则 + 守卫豁免 + root 行两形态处置；§2/§8 一行 @types/node；#3–#7 为增量修订），修订后预期可直接放行——本轮未发现任何架构级或格式级不可挽回缺陷。已受总控裁决的异议 #1（SA6 R2 已修复）与异议 #2（§7 方案）经独立复验均成立，不因本次 reject 回滚。

---

# R2 复审记录（R1 reject → SA1 修订稿 569 行 → 复审）

**R2 Verdict**: **pass**（R1 全部阻塞项经独立机器复验确认修复；#2 的 Record 形偏离经实证裁决**成立**；建议 A/C 程序验证可靠。4 项非阻塞残留登记于 R2.6，路由 SA3/SA6/SA7。）

**R2 评审范围**: §3.2 规则 0 重写、§3.2.1 ROOT 范围限界、§9.2.2 契约增补建议、§9.4 watch-items、文末 SA2 反馈逐条回应表；§5.3/§5.4/§5.5/§6/§8 联动修订；全文一致性抽查。

## R2.1 攻击点 #1（CRITICAL）规则 0 复核 —— **已消除（最强形式验证：算法-样例逐字节桥接）**

- **规则 0 落地核验**：§3.2 新增「规则 0 · 值侧 ref 优先」（emitNode 首查值侧 `value.kind === 'ref'` → 一律 `PathSchema<别名名, kindOf(别名名)>`，含别名链解析与环守卫）+ 配对表新增 `(任意 X, ref)` 行 + 失配守卫重写为「仅两侧均非 ref 时 throw」+ §3.2 引言重写为两树不对称前提（引 evaluate.ts L15-16 与四个解析点）。旧「同形并行走查」措辞经全文 grep 确认清除（残留 5 处「同形」均为合法他义：正则同形/D1 同形/联合同形状）。
- **算法-样例桥接独立复验（本评审核心证据）**：按 R2 §3.2 规则 0 + 配对表 + §3.4/§3.5/§3.6 布局规则**从零实现迷你发射器**（`/tmp/sa2_r2_bridge.ts`，约 150 行，非照抄样例），对**真实 `evaluate`** 产出的 mapping fixture 派生 schema 全量发射，与 §3.9 v3 样例逐字节比对 → **BYTE-IDENTICAL: PASS**。byId 值位（结构=已解析 union、值=`ref Entity`）经规则 0 产出 `byId: PathSchema<Record<string, PathSchema<Entity, 'map'>>, 'map'>`，与样例逐字一致——R1 指出的「样例文本与算法之间缺一座桥」已补上，样例不再是悬空断言。
- **五类配对实证（§10 行 10 复核）**：tsx 探针对真实 evaluate 转储——① byId 值位 (union, ref)（桥接探针内含）；② `leafRef: Id` (leaf, ref)；③ `ids: Id[]` 元素位 (leaf, ref)（struct=array[leaf]，元素值侧 ref）；④ `metaRef: YMap<Meta>` (已解析 map, ref)——**判别性用例**；⑤ `p: Plain` (plain, ref)。全部真实存在，与 §10 行 10 记载一致。
- **结论**：R1 的结构性红测阻塞（失配守卫在 `ROOT.byId.<key>` 处 throw → mapping 测试永红）已消除；§9.1 转绿路径成立。

## R2.2 攻击点 #2 ROOT 形态范围限界裁决 —— **已解决；Record 形偏离（SA1 超出 SA2 字面建议）裁决：成立**

SA1 选 (b) 案且将 Record 形 ROOT 也纳入拒绝（SA2 R1 曾把索引签名列为可选支持面 (a)）。两条超出 SA2 建议范围的论证均经本评审独立实证：

1. **索引签名 × 多域增广合并冲突（实证）**：tsc 探针——域 A（Record 形 ROOT）发射 `[k: string]: PathSchema<…, 'map'>` 索引签名增广 + 域 B 发射普通字段成员增广（接口合并 = VfslPathMap 多域机制的本意）→ **TS2411**：`Property 'label' of type 'PathSchema<string, "leaf">' is not assignable to 'string' index type 'PathSchema<Record<string, unknown>, "map">'`。SA2 R1 的 (a) 案（索引签名发射）在此场景**结构性不可行**——SA1 的额外论证是对的，SA2 采纳修正。
2. **联合 ROOT 顶层 D2 宽度丢失（实证）**：类型探针——联合 ROOT 若按「成员键并集 → 接口成员」发射，成员独有键 `a` 的 `PathValue<PathAt<Map,['a']>>` **恰为 `string`**（`Eq<ReadA, string>` 编译通过、`Eq<ReadA, string|undefined>` 编译失败即 `@ts-expect-error` 满足）——宽度 `| undefined` 丢失；该宽度只能由协议包 `MemberLookup` 在**穿越 union 节点**时合成，而顶层是接口（map 本体）非 union 节点，机制不可达。论证成立。
3. **四形态全覆盖**：裸对象/YMap 支持；Record/联合 → 命名化 `UnsupportedRootShapeError`（可断言消息 + CLI 捕获 → exit 2 + 后续票登记 + §5.3 G 票交接注记）。R1 要求「不允许任何合法输入处于未定义状态」满足；实测两种拒绝形态的 structure 形状（Record ROOT → `map` 恰一 `'<key>'` 字段；联合 ROOT → `union`）与 §10 行 11 一致。
- **裁决**：偏离成立且优于 SA2 原建议——F2 响亮拒绝 + 协议层扩展登记后续票是当前协议约束下唯一诚实解。

## R2.3 攻击点 #3–#6/#8 落实复核 —— **全部落实（逐项核验）**

| 项 | 修订位置 | 核验结论 |
|---|---|---|
| #3 idBase 定性 | §5.3「F2 施加的约定」段 + 诊断消息模板 + G 票交接注记 | ✅「依托 F1」错误归属已删；F1 语义定性正确（一级 @id 权威、二级仅诊断回退且容忍背离——schemasource.ts L158-163/L450-489 印证；信封不暴露来源目录）；vfs3.assets@1 ↔ vfs3-assets 冲突显式交 G 定夺 |
| #4 空领域集阶段门 | §5.4 表新增行 + §5.5 重写 + §6 CI flag + §9.3 步骤 3 | ✅ `--allow-empty-domains` 四处口径一致（12 处提及 grep 一致）；「F1 将 ENOENT 设计为合法空集」属实（schemasource.ts L303-306）；SA6 CLI 测试 hermetic fixture 均含一领域不受影响（R1 已核）；CI 带 flag + TODO(#27)，G 落地移除后零集复为响亮失败 |
| #5 @types/node | §2 包定义 + §8 表 | ✅ `@types/node: ^20` 显式声明（与 vfsl 同版对齐）；隐性依赖事实由 R1 探针 B 证实（仅 src 的 program → TS2307）。措辞小瑕：§8 归因「vitest→vite d.ts `/// <reference types="node" />`」的精确链路未逐字复现（grep 未命中该指令）——但「偶然传递依赖」的事实与补救均成立，非实质 |
| #6 SchemaSourceError catch | §5.3 步骤 7 + §5.4 硬错误行 | ✅ 顶层 catch 覆盖 SchemaSourceError/ENOTDIR/EACCES → 结构化 stderr + exit 2；「不捕获则退 1 违背承诺」的兑现路径写明 |
| #8a 版本常量自同步 | §4「运行时自同步」段 | ✅ 超出 SA2 建议的结构性解：惰性读本包 package.json（import.meta.url）；**tsx 载体下实证可解析**（探针：`self-version via import.meta.url: 0.1.0`，exit 0）；读/解析失败 loud throw；「不得回退硬编码」纪律入文 |
| #8b CLI 启动精简 | §5.2 注 + §9.4 watch-item 1 | ✅ 模块级零重活/参数解析先行/不叠加启动期 I/O；处置边界明确（可调 testTimeout 基础设施、不得改断言、不得加缓存） |

## R2.4 §9.2.2 契约增补建议 A/C 程序验证 —— **可靠，建议总控路由 SA6 采纳**

- **建议 A（leafRef/metaRef 断言钉死规则 0）——程序验证通过**：以扩展 fixture（mapping fixture + `leafRef: Id;` `metaRef: YMap<Meta>;` + `type Meta = YMap<{ m: YLeaf<number> }>;`）驱动真实 evaluate + 迷你发射器：配对实测 `leafRef: (leaf, ref(Id))`、`metaRef: (map, ref(Meta))`；规则 0 期望发射 `leafRef: PathSchema<Id, 'leaf'>;`、`metaRef: PathSchema<Meta, 'map'>;`（另有段② `export type Meta = { 'm': PathSchema<number, 'leaf'> };`）；两条建议正则逐字命中；**既有全部 23 条断言对扩展输出零回归（套件 27/27 pass）**——增字段不破坏任何现行断言（ROOT 负例/TSDoc 配平/aliasDocs/byId 正则族全过）。metaRef 位具判别性：按结构侧字面实现会内联 map、正则必挂。**建议采纳**。
- **建议 B（L115 负例正则）——SA6 R3 已完成**：现行 L115 = `expect(/attachments\s*:\s*PathSchema<Record</.test(out)).toBe(false);`——反引号缺陷已除、负例恢复检测力（对 v3/扩展输出仍正确为 false）；与本评审 27/27 套件中的 negRegex 检查一致。闭环。
- **建议 C（联合 ROOT toThrow）——程序验证通过**：§9.2.2 原文 fixture（含**前导 `|`** 的联合 ROOT）实测 parse ok + evaluate ok、`root.node.kind = union`；§3.2.1 规定消息含「ROOT 形态不支持」前缀，`toThrow(/ROOT 形态不支持/)` 可断言。**建议采纳**（把范围限界从设计文本升为契约，防 SA3 实现漂移）。

## R2.5 R2 复验证据（命令与结果，全部 /tmp 沙箱，真仓零写入）

| 探针 | 命令（要点） | 结果 |
|---|---|---|
| 算法-样例桥接 | `pnpm dlx tsx /tmp/sa2_r2_bridge.ts`（迷你发射器：规则 0+配对表+§3.4/3.5/3.6 布局 → 真实派生 schema 全量发射 → 与 §3.9 样例逐字节 diff） | **BYTE-IDENTICAL: PASS** |
| 五类配对补全 | `pnpm dlx tsx /tmp/sa2_r2_suggestions.ts` | ③ `ids: Id[]` → (array[leaf], 元素 ref)；⑤ `p: Plain` → (plain, ref)；④ metaRef (map, ref)、② leafRef (leaf, ref) 复确认 |
| 建议 A 断言套件 | `pnpm dlx tsx /tmp/sa2_r2_ext.ts`（扩展 fixture 发射 → 23 既有断言 + 2 新正则） | **27 pass, 0 fail**；`leafRef: PathSchema<Id, 'leaf'>;` / `metaRef: PathSchema<Meta, 'map'>;` 逐字命中 |
| 索引签名合并冲突 | sa2sim tsc 探针（域 A 索引签名增广 + 域 B 字段成员增广） | **TS2411**：`Property 'label' … not assignable to 'string' index type` |
| 联合 ROOT 宽度丢失 | sa2sim 类型探针（`Eq<ReadA, string>` ✓ / `Eq<ReadA, string\|undefined>` ✗） | ReadA **恰为 string**——顶层接口成员形态无 D2 宽度 |
| 版本自同步 | tsx 执行 `readFileSync(new URL('../package.json', import.meta.url))` 于包 src 内 | `self-version via import.meta.url: 0.1.0`，exit 0 |
| L115 R3 | grep 测试文件 L115 | 已修为 `/attachments\s*:\s*PathSchema<Record</` |
| 一致性抽查 | grep 设计全文（同形/规则 0/allow-empty-domains/UnsupportedRootShapeError） | 旧措辞清除 ✓；规则 0 ×14 处同义 ✓；阶段门 ×12 处口径一致 ✓；限界错误 ×9 处口径一致 ✓ |

## R2.6 非阻塞残留（登记路由，不构成 reject 依据）

1. **纯值上下文 docs 未规定**（R1 #7 未被回应——SA1 回应表编号沿用 8 项旧稿）：`YPlainArray<YMap<{…}>>` 实参内 fieldDocs/markerDocs（walkDocs 产出 `…<item>.字段` 键）在 §3.2 plain 终态行无发射位，设计未规定保留/丢弃；fieldDocs/markerDocs 发射仍零红灯覆盖（§3.7 规则本身经 R1 逐行核实正确）。**路由**：SA3 实现按「纯值上下文 docs 丢弃 + 代码注释标注 v1 范围」处理；SA6 后续契约增补可参考建议 A 形式补 docs 断言。
2. **异形联合成员**：§3.2 union 行「成员 = map×object 并行走查」措辞与 §3.4 kindOf(union)→恒 'map'——非 map 成员联合（如 `YArray<A> | YArray<B>` 字段位）为合法输入，成员走查可经各自行落地（本评审迷你发射器即如此），但节点 kind 会错标 'map'（影响 `PathKind`/序列编辑 API 门禁）。罕见形态。**路由**：SA3 可按「全员同形 → 该 kind；异形 → 响亮拒绝」防御性实现（一句注释级决策），或留待后续票。
3. **生成物 F2 内永不编译**（R1 #8 未被回应）：生成器真输出仅文案级断言。**路由**：SA7 动态验证补一项——将 `generateProjection` 对 mapping fixture 的输出写临时文件过 `tsc --noEmit` 干跑（约 3 行脚本），G 票前移编译级风险。
4. **§8 机制归因措辞**：「vitest→vite d.ts `/// <reference types="node" />`」精确链路未复现（grep 未命中）；隐性依赖的**事实**与补救不受影响。无需动作。

## R2 结论

R1 的两个 reject 根因均已消除且经最强形式复验：#1——规则 0 是 §3.9 样例文本的**真实算法来源**（迷你发射器逐字节复现），mapping fixture 的结构性永红解除；#2——四种合法 ROOT 形态全部有定义行为，Record 形偏离经 TS2411/宽度丢失双实证裁决成立（优于 SA2 原建议）。#3–#6/#8 逐项落实，§9.2.2 建议 A/B/C 全部程序验证可靠（B 已闭环）。设计已具备放行条件；4 项非阻塞残留已登记路由，不构成阻塞。

**R2 Verdict: pass**（放行至 SA3 实现阶段；残留项随路由消化，pass 不替代 SA4 静态评审与 SA7 动态验证）。

---
---

# R2 复审 · 第二独立轮（对前一轮 pass 结论的复审与增量攻击）

**Date**: 2026-08-20
**R2 Verdict（本轮，最终）**: **reject**（窄域、外科手术式：R1 全部阻塞项的修复经本轮独立复验确认成立，前一轮 pass 的全部正面结论本轮均独立复现、无一推翻；reject 根因是前一轮未覆盖的**两项冻结契约明文合法输入在「唯一算法骨架」中无路径**——① ref 目标为 `ROOT`（ADR 0003 §2 明文「ROOT 可被其他别名引用（既当根又当积木，合法）」）→ 生成物引用未声明名，**静默**破碎输出且全部红灯 fixture 掩盖；② `optional` 字段（`ValueSchema` 冻结 kind `'optional'`、v1 方言 `?:` 一等特性）在 §3.2 骨架/规则 0/配对表中无路径，字面实现对任何 `?:` 字段假报失配或落入未定义行为、零 fixture 覆盖。另附一项升级（异形容器联合 kind 误标）与两项打磨。修订量合计约两段文字 + 两行处置，不动任何已验证的宏观决策。）

**评审对象**: `wiki/raw/task_vfsl-codegen_design.md` R2（569 行）
**评审方法**: 全新视角 + 机器独立复验——7 个 tsx 探针（对真实 `evaluate` 源跑 30+ 边界 fixture：五类配对/环边界/ROOT 形态/ref-to-ROOT 触发面全谱/optional 包装/异形联合/交并 Record）+ 3 个 tsc 探针（§3.2.1 的 TS 合并与查找语义）+ 基线 `pnpm test` 复跑；全部探针在 /tmp 沙箱，真仓零写入（本报告除外）。

## A. 对前一轮 R2 复审（pass）的逐项复核 —— 正面结论全部认可并独立复现

| 前一轮结论 | 本轮独立复核方法 | 结果 |
|---|---|---|
| 规则 0 算法-样例桥接（迷你发射器逐字节一致） | 独立方法交叉验证：不重写发射器，而以探针对真实 evaluate 转储 byId 值位两树形态（结构=已解析 union+disc、值=`ref Entity`），按规则 0 + Record 行**逐步推演** → `PathSchema<Record<string, PathSchema<Entity, 'map'>>, 'map'>` 与 §3.9 样例 L244 逐字一致；五类配对另以自制 fixture（非复述 SA1 探针）独立复现，并**增证第六类 (xml-fragment, ref) 真实存在**（规则 0 列举已覆盖） | ✅ 认可（双方法互证） |
| §3.2.1 Record 形偏离裁决成立（TS2411 + 宽度丢失） | 本轮独立 tsc 探针复现 TS2411；类型探针证字面 `'<key>'` 成员下 `MemberLookup<MapA,'abc'> = undefined`（动态键全灭）；**另证索引签名单域下 `PathAt` 查找机制本身可达**（`MemberLookup` 对索引签名类型正常取 `V[Seg]`）——即阻塞项确为多域合并冲突而非查找机制，设计论证诚实精确未夸大；联合 ROOT 宽度不可达论证与协议源码 `MemberLookup`（唯一 undefined 合成点、仅 union V 分发）核对一致 | ✅ 认可（并补强） |
| §9.2.2 建议 A/C 程序验证可靠、B 已闭环 | A 期望发射独立验证（实测 `aliases[Id]=leaf`→kindOf='leaf'、`aliases[Meta]=map`→kindOf='map'）；增字段与现行断言无冲突逐条核对（'meta' fieldKind 正则不被 'metaRef' 前缀误配——`\s*:` 在 'R' 处失配；TSDoc 配平/ROOT 负例/byId/entityList/aliasDocs 不受影响）；B 现行文件 L115 核对已落地；C 联合 ROOT fixture（含前导 `\|`）本轮探针同样 parse+evaluate ok、`root.node.kind=union` | ✅ 认可 |
| #3–#6/#8 落实 | 本轮独立核对：idBase 三子项（归属/消息/G 交接）、阶段门 12 处口径、@types/node、步骤 7 错误映射、版本自同步机制 | ✅ 认可 |
| R2.6 残留 1（纯值上下文 docs 未规定） | 同意非阻塞：纯值终态丢弃 docs 无语义破坏，SA3 注释级处置可接受 | ✅ 同意路由 |
| R2.6 残留 2（异形联合成员） | **升级为本轮 #R2-3**（见 B）——kind 误标是语义级问题（PathKind/序列编辑 API 门禁失真），属设计级一行处置，不应留给 SA3 注释级即兴 | ⚠️ 定级上调 |
| R2.6 残留 3（生成物 F2 内永不编译） | 同意补 SA7 验证项；但**watch-item 只能兜住症状、兜不住规格**——本轮 #R2-1 的正确行为仍无设计定义，SA7 抓到症状后 SA3 仍须即兴。不能以此替代设计处置 | ⚠️ 部分同意 |
| R2.6 残留 4（§8 归因措辞） | 同意无需动作 | ✅ 同意 |

**基线复跑**：`pnpm test` → `Test Files 3 failed | 21 passed (24)`、`Tests 3 failed | 382 passed (385)`、`Type Errors no errors`——红状态与 R1/SA6 红证据逐字一致，R2 修订未扰动基线。

## B. 增量攻击点（前一轮 pass 未覆盖，本轮机器验证）

| # | 严重度 | 攻击面 | 具体漏洞（触发条件 + 影响，全部实测） | 修订要求（可执行） |
|---|--------|--------|--------------------------------------|----------------------|
| R2-1 | **HIGH** | §3.2 规则 0/引用行 × §3.1/§3.4「ROOT 除外」 | **ref 目标为 ROOT（ADR 0003 §2 明文合法）→ 生成物引用未声明名 `ROOT`，静默破碎。** ADR 0003 §2 原文：「`ROOT` 可被其他别名引用（既当根又当积木，合法）」。实测（探针对真实 evaluate，六种合法触发形态全谱）：① 字段位 `X=YMap<{r:ROOT}>`（(ref,ref) 行→`PathSchema<ROOT,'map'>`）；② 别名链 `Y=ROOT`（段② 走查→`export type Y = PathSchema<ROOT,…>`）；③ 数组元素 `X=YArray<ROOT>`；④ **Record 值位 `X=Record<string,ROOT>`——纯规则 0 位**（结构侧经解析点③内联为 map、仅值侧暴露 `ref:ROOT`）；⑤ **YMap 实参 `X=YMap<ROOT>`——纯规则 0 位**（解析点②内联、值侧仍 `ref:ROOT`）；⑥ 直引 `X=ROOT`。唯一不触发：YPlainArray 实参（E307 拒绝）。影响链：parse ok + evaluate ok + 生成 exit 0 + regen-diff 字节一致 → **全绿掩盖**；破碎只在下游编译生成物时以「GENERATED DO NOT EDIT 文件内 TS2304 Cannot find name 'ROOT'」现身，最大化误导。违反设计自己的 §3.2.1 原则（「不允许任何合法输入处于未定义状态」）与 loud-failure 哲学；且 §3.2.1 引 ADR 0003 §2 为 ROOT 形态枚举权威、却漏看同节 ROOT-as-积木条款 | §3.2 或 §3.4 增一段处置，二选一明文：(a) 命名化 loud throw（如 `UnsupportedRootReferenceError` → CLI exit 2 + 登记后续票）——与 §3.2.1 两限界同构；(b) 引用链抵达 ROOT 时一并发射 ROOT 具名声明（本轮已核 `export type ROOT = …` **不违反** ROOT 负例正则 `/^\s*['"]?ROOT['"]?\s*:/m`——该正则只匹配 `ROOT:` 成员形，`ROOT =` 声明形不命中；须同步一句话论证与 D5 的关系）。**不允许维持未提及**——与 R1 #2 同一裁决标准 |
| R2-2 | **MEDIUM** | §3.2 配对表/规则 0 × optional | **optional 字段在唯一算法骨架中无配对路径。** 实测：值树字段位恒为 optional 包装（`opt(ref:Meta)`/`opt(scalar)`——`ValueSchema` 冻结 kind `'optional'`「仅对象字段 ?: 包装」，v1 方言 `?:` 一等特性）。规则 0 首查 `value.kind==='ref'` 在包装上落空；配对表值 kind 列无 optional → (leaf, opt(scalar)) 撞失配守卫**假报**「structure/value desync」（错误指控求值器契约破坏 = R2 教训「loud 错对象」复发）；(ref, opt(ref)) 更糟——守卫前置「两侧均非 ref」不满足、表又无行 → **未定义行为**（SA3 即兴）。四个 SA6 测试文件零 `?:` 覆盖（grep 实证）→ 字面实现可全绿过门，G 首个含可选字段的域即崩 | §3.2 加一句骨架规则：**字段成员位先行剥离 optional**（可选性以键后 `?` 表达，§3.5；权威源 = `MapField.optional`——与值侧 optional 同源于 IR `f.optional`、恒同步，禁止双侧各判一次产生双 `?`），emitNode 恒收剥壳后的值；规则 0 与配对表声明「永不遇 optional kind」 |
| R2-3 | MEDIUM-LOW | §3.2 union 行 / §3.4 kindOf × 异形容器联合 | **联合节点 kind 硬编码 `'map'` 对非 map 成员联合是语义误标。** 实测合法输入：`u: YArray<YLeaf<string>> \| YArray<YLeaf<number>>` → structure `union(array\|array)`、value `union(arr\|arr)`（E309 只拒标量×容器混合，容器×容器联合合法；别名引用混合 `A\|B`〔A=map、B=array〕同样合法 → union(ref\|ref)）。按 §3.2 union 行/kindOf(union)→'map' 发射 → `PathKind` 报 'map' 而运行时值是数组 → 序列编辑三 API（`appendToArray` 等以 `PathKind==='array'` 门禁）全部「非 array 节点」误拒。`VfslKind` 五值词汇表无联合 kind——**不存在诚实单值**，必须显式处置而非默认 'map'。前一轮 R2.6 残留 2 已发现但定级「罕见/注释级」，本轮定级为设计级一行处置 | §3.2 union 行补一行处置规则（与 §3.2.1 同构）：「联合成员结构 kind 全员同形 → 发射该 kind；异形（如 array\|map 混合）→ 命名化 loud 拒绝（`UnsupportedUnionKindError` → exit 2 + 登记）」——禁止对异形联合默认 'map' |
| R2-4 | MINOR | §3.4 论据 (a) | 「自引用别名（`type A = YMap<{ next: A }>`）内联发射会无限递归，具名引用是唯一总量解」引用**不可达输入**——实测 E106 在 parse 层拒绝**一切**别名引用环（7 形态全拒：直接自引/字段位/经数组元素/经 YArray 实参/经 Record 值位/经 YMap 实参/间接 A→B→A）。决策（具名不内联）仍正确——真实依据是 byId 正则、aliasDocs 独立发射位、(X,ref) 配对与 ref 行；但论据失真误导 SA3/后续读者对环可达性的认知；kindOf 环守卫与 §3.6 `ValueContextCycleError` 同为对 parse 产物不可达的纵深防御（无害，但设计呈现为可达状态守卫） | §3.4 论据 (a) 改述为「解析层 E106 已保证别名图无环；具名引用的必要性来自 (b)(c) 与 (X,ref) 配对」；两处环守卫标注「纵深防御（正常输入不可达）」 |
| R2-5 | MINOR | §4 版本自同步守卫 | 「读/解析失败 → 命名化 loud throw」不覆盖「package.json 合法但 version 字段缺失/非串」→ 头注静默输出 `@nomicore/vfsl-codegen@undefined`——确定性仍在（无随机性）但**对版本说谎且 regen-diff 不报警**，恰是 §4 自同步要消除的失败模式残余 | 守卫扩为「version 须为非空 string，否则同命名化 loud throw」（一行） |
| 观察 1 | LOW（G 交接） | §3.1 多域安全声明 | 「多域生成文件同名别名零冲突」只覆盖别名（`export type` 模块作用域，属实）；未提 **VfslPathMap 接口成员跨域合并冲突**（两域同名顶层键不同类型 → TS2717）——D5 单接口载体机制使然，非 F2 可修 | 并入 §5.3 G 票交接注记一行：G 落地多域时须定夺顶层键命名规约（或协议层扩展归后续票） |
| 观察 2 | LOW | §3.2.1「登记后续票」 | Record/联合 ROOT 的协议层扩展「登记后续票」**无实票**（gh issue list 核对：无对应 open issue；#27 是 G dogfood 非协议扩展票）。约束本身已经 §5.3 交接 G，但协议层扩展诉求无实票会静默蒸发 | 开票（或明文指定由总控/G 票登记），把错误消息模板 `<后续票>` 占位符落为票号 |

## C. 本轮独立复验证据（命令与结果，全部 /tmp 沙箱，真仓零写入）

| 探针 | 验证目标 | 结果 |
|---|---|---|
| `tsx /tmp/sa2-r2-probe/pairs.mjs` | 五类 (已解析结构, 值 ref) 配对 + xml-fragment 第六类 | 全部复现 ✓（byId=(union,ref)、leafRef=(leaf,ref)、数组元素=(leaf,ref)、metaRef=(已解析 map,ref)、p=(plain,ref)、xf=(xml-fragment,ref)） |
| `tsx /tmp/sa2-r2-probe/cycles.mjs` | E106 环拒绝边界 + 别名链 kindOf 输入 | 7 种环形态全部 PARSE FAIL；`B=BC; BC=YMap<…>` → `aliases[B]=ref:BC`（链解析必要）✓ |
| `tsx /tmp/sa2-r2-probe/roots.mjs` | ROOT 四形态 + 非法形态 | 联合 ROOT→`root(union)`、Record ROOT→`root(map{<key>})`、`YMap<Record<…>>`→Record 形、非 map ROOT 全被 E311 拒 ✓ |
| `tsx /tmp/sa2-r2-probe/reftoroot.mjs` + `rootref-map.mjs` | **#R2-1 触发面全谱** | 六种 ref-to-ROOT 形态 parse+evaluate 全 OK、值树全部含 `ref:ROOT`（Record 值位/YMap 实参为纯规则 0 位）；YPlainArray 实参被 E307 拒 ✓ |
| `tsx /tmp/sa2-r2-probe/edge.mjs` | **#R2-2** optional 包装 + 交集 ROOT | `label?: string` → 结构 `label?:leaf`、值 `opt(scalar)`；`m?: Record<…>` → `opt(obj{<key>:ref})`；交集 ROOT 被 E100 拒 ✓ |
| `tsx /tmp/sa2-r2-probe/hetero.mjs` | **#R2-3** 异形联合 | `YArray\|YArray` → union(array\|array) 合法；`A\|B`（map 别名\|array 别名）→ union(ref\|ref) 合法；标量×容器混合被 E309 拒 ✓ |
| tsc 探针 `merge/{a,b,c,e}.ts` | **§3.2.1 裁决**：TS2411 / 索引签名可查找 / 字面键死灭 | TS2411 复现 ✓；`MemberLookup<{[k:string]:X}>,'abc'>` = X（单域机制可达）✓；`MemberLookup<{'<key>':X}>,'abc'>` = undefined（动态键死灭）✓ |
| `pnpm test`（真仓） | 基线红状态 | `3 failed \| 21 passed (24)`、`382 passed`、`Type Errors no errors`——与 R1/SA6 红证据逐字一致 ✓ |

## D. 红线测试思路（增量，对应 R2-1/R2-2/R2-3）

1. **R2-1**：hermetic fixture `type ROOT = YMap<{ a: YLeaf<string> }>; type Node = YMap<{ r: ROOT }>;` → `generateProjection` 断言（依 R3 选定处置）：(a) 案 → `toThrow(/ROOT/)` + CLI 层 exit 2 + stderr 消息；(b) 案 → 输出含 `export type ROOT` 声明且 `PathSchema<ROOT, 'map'>` 引用位在场。**任一案都必须可断言**——禁止无锚状态（与 R1 红线建议 2 同一标准）。
2. **R2-2**：hermetic fixture `type ROOT = YMap<{ title?: string; meta?: Meta }>; type Meta = YMap<{ m: YLeaf<number> }>;` → 断言：不抛（无假 desync）；`title?:` 键在场（`?` 单次、无双 `?`）；meta 位 `PathSchema<Meta, 'map'>`（规则 0 穿透 optional 包装）——同时钉死 optional×ref 交叉位。
3. **R2-3**：hermetic fixture `type ROOT = YMap<{ u: YArray<YLeaf<string>> | YArray<YLeaf<number>> }>;` → 断言（依 R3 选定处置）：同形联合 → 该 kind（本例两成员均 array → `'array'`）；或异形/无诚实单值 → `toThrow`。禁止默认 'map'。
4. 建议以上与 §9.2.2-A/C 同路由 SA6（作为建议 D/E/F，见下节路由结论）。

**§9.2.2 路由结论（本轮最终口径，承接前一轮）**：建议 A（采纳、路由 SA6——(leaf,ref)/(map,ref) 两子情形现行断言集零钉死，结构侧优先的错误实现可逃逸全部现行断言）；建议 B（SA6 R3 已落地，收编确认即可）；建议 C（采纳、路由 SA6——把 §3.2.1 升为契约）。**时点：须在 SA3 实现前或同步落地**（红灯契约变更，晚于 SA3 则锚定失效）。若 R3 落实本轮 R2-1/R2-2/R2-3，建议同机制追加 D/E/F 三条断言（见红线思路）。

## E. 结论与前一轮 pass 的冲突说明（供总控裁决）

本轮对前一轮 R2（pass）的**全部正面复验结论予以认可并独立复现**：规则 0 的算法-样例桥接成立（本轮以独立方法交叉验证——逐步推演与迷你发射器逐字节复现互证）；§3.2.1 对 Record 形的偏离裁决成立（本轮独立 TS2411/字面键死灭/索引签名可达性三探针，且补强了论证诚实性的核验）；建议 A/B/C 程序验证可靠；#3–#6/#8 落实无水分。

**reject 与 pass 的分歧不在任何已验证结论，而在两个前一轮未发现的增量缺口**：R2-1（ref→ROOT：ADR 0003 §2 冻结条款级合法输入 → 静默破碎输出，全绿掩盖——前一轮 R2.6 残留 3 的「生成物永不编译」watch-item 恰好是其掩盖机制而非其解药）与 R2-2（optional：冻结契约一等特性在唯一算法骨架中无路径 + 零 fixture 覆盖——字面实现对任何 `?:` 字段假报失配或未定义行为）。两者与 R1 #1/#2 同为「合法输入 × 骨架无路径 × 红灯零覆盖」类，按 R1 立下的同一标准（「不允许任何合法输入处于未定义状态」——该标准由设计 §3.2.1 自己接受并在 ROOT 形态上兑现，本轮要求在同一骨架的另两个输入族上同样兑现）必须先处置后放行。R2-3（异形联合 kind 误标）为同族第三例，量级一行处置。

**修订量预估**：§3.2/§3.4 约两段文字（R2-1 处置 + R2-2 剥壳规则）+ 两行（R2-3 kind 处置、R2-5 守卫）+ 论据改述（R2-4）+ 两条观察走 G 交接/开票——不动任何已验证的宏观决策（格式 v3 / §7 接线 / tsx 载体 / 阶段门 / 版本自同步 / 规则 0 本体）。**预期 R3 后可直接放行**；本轮仍未发现任何架构级或格式级不可挽回缺陷。

## R3 复审记录

**R3 Verdict**: pass

（pass 附 1 项 MEDIUM 必修路由项 + 4 项 MINOR 路由/文档项，见本节末「R3 结论与路由清单」——pass 的前提 = 路由项随 SA3/SA6/SA1 派发指令落实；唯一 MEDIUM 为**实现侧**偏离设计明文条文，设计规范本身完备，不构成设计 reject 依据。）

**合并终稿注记（沿 R1「并行稿合并」惯例）**：本节由两个独立 SA2 会话合并而成——并行实例先行填稿（其 R3-5.6 自记改写事件），本会话对其**全部增量攻击点逐条独立复验**：第 7 触发形态（`type U = A | ROOT` 独立别名内 → `values.U.<member 1>=ref:ROOT` + `aliases.U.<member 1>=ref:ROOT`，对照「ROOT 字段内联 `A|ROOT`」与「ROOT 直自引」均 E106 拒）、E307 纯值双拒（`YPlainArray<ROOT>` 与 `YPlainArray<Meta>` 均 PARSE FAIL E307）、kindOf 引用位误标（本会话独立探针复现同一实锤 `u: PathSchema<U, 'map'>`）、规则 1「恒为」措辞失实（非 optional 字段值侧裸形 `scalar` 本会话复证）、dispatch #17/#19/#20 的 (a)/(b) 时间线（21:36 (b) 交付 → 总控终裁 (a) → 21:55 SA6 D 块翻转，sa6-r5-fix.log `1 failed | 8 passed (9)` + `expected [Function] to throw an error` 亲核）——**全部成立，予以保留并补证**。本会话新增独立发现已并入：R2-5 守卫实现侧已落地（header.ts，路由减免）、optional 恒同步在 aliases 侧的实证、`e?: A | B` 解析层不可达（opt(union-direct) 无路径）、路由项 1② 的落点纠正（设计文档 erratum 归 SA1 而非 SA3）。两会话独立得出同一 verdict。

**复审基准**: R2 第二独立轮 reject（R2-1 ref→ROOT / R2-2 optional / R2-3 异形联合 kind + R2-4/R2-5 + 观察 1/2，见本文件 L193–256）。关键裁决背景 = R2-1 处置曾现 (a)/(b) 两稿（僵尸进程写过 (b) 按需具名发射稿），最终定稿为 **(a) 命名化 loud 拒绝**（UnsupportedRootReferenceError「ROOT 不可被引用」→ CLI exit 2 + 登记后续票），总控裁决采纳 (a)（与 §3.2.1 同一诚实策略、保 D5 单一载体语义）。

### R3-1 R2-1 (a) 案终稿核验 —— **通过（含一处形态枚举补遗）**

**裁决背景独立确认（本会话）**：R2-1 处置确曾现 (a)/(b) 两稿——dispatch #17（21:36）记录 SA1 R3 首次交付为 (b) 按需具名发射（明文「偏离总控提示的 (a) 建议，归 SA2 R3 裁决」）；随后总控终裁 (a)，设计 21:51 定稿翻转（§3.4 处置段「总控定夺 (a) 案，纠正前稿 (b)」）、SA6 建议 D 断言 21:55 整块翻转、任务简报 21:56 追「R5 纠偏」记录。**本复审以工作区现行 (a) 终稿为评审对象**（本会话唤醒指令中的 (b) 描述系纠偏前旧态，已按现行事实核验并以此为准）。

- **三检查点 × 触发形态覆盖（六形态值树本会话全部独立复现，probe2.mjs）**：① 字段位 `Node=obj{r:ref(ROOT)}`；② 别名链 `Y=ref(ROOT)`、`X=obj{f:ref(Y)}`；③ 数组元素 `X=obj{l:arr(ref(ROOT))}`；④ Record 值位 `X=obj{m:obj{<key>:ref(ROOT)}}`；⑤ YMap 实参 `X=obj{m:ref(ROOT)}`；⑥ 直引 `X=ref(ROOT)`——分别命中「值侧 ref 目标 ROOT」（规则 0 首查位）/「kindOf 链解析抵达」/「段② 走查」检查点，无漏网。**枚举补遗（本轮新发现，MINOR）**：实测存在**第 7 种合法触发形态——联合成员位**：`type U = A | ROOT; type X = YMap<{ u: U }>` → parse+evaluate ok、`U=un(ref(A)|ref(ROOT))`（注意：ROOT 自身字段内联 `A | ROOT` 被 E106 环检拒绝，独立别名 U 内则合法——本会话双探针对照实证）。「六种触发形态实测全谱」枚举不全，但三检查点**按位点设防而非按形态枚举**：联合成员位的成员发射走 emitNode 值侧 ref 分支（检查点 1）+ 成员 structureKind 解析 ref ROOT（检查点 2）双覆盖，处置安全性不受影响。一句话补遗路由：§3.4 处置段/§10 行 12 形态枚举补「联合成员位（独立别名内）」。
- **D5 论证成立**：(a) 保「接口成员为顶层唯一载体」单一载体语义（破例 `export type ROOT` 会让同一 map 双载体出现）；与 §3.2.1 Record/联合 ROOT 限界同一诚实策略（协议层扩展前响亮拒绝 + 登记后续票）；负例正则 `/^\s*['\"]?ROOT['\"]?\s*:/m` 在 (a) 下恒不命中（`ROOT:` 成员形与 `ROOT =` 声明形均永不出现）——正则安全论证成立。
- **全文无活性 (b) 残留（grep 实证）**：「按需具名发射」全文仅 3 处，均为裁决史语境（§3.4 标题「不采纳 (b)」、R3 汇总「前稿曾采 (b)」、R2-1 行「纠正前稿 (b)」），无活性 (b) 规则。
- **联动一致性（十处口径核对）**：§1.1（D5 决策行精化）、§3.1（段②「ROOT 除外——ROOT 不可被引用」注记）、§3.2 规则 0（ref 目标 ROOT → throw 行）、§3.2 root 行、§3.4 处置段（主落点）、§5.3 步骤 4、§5.4 硬错误行、§9.2.2 建议 D、§9.4 watch-item 5、§10 行 12——全部指向同一 (a) 定义，无矛盾；与 §3.2.1 不叠加（root 入口形态检查先于任何引用走查，错误次序确定：Record/联合 ROOT → UnsupportedRootShapeError 先抛）。
- **与 SA6 已落地建议 D 断言一致**：emission 测试 D 块（L107-123）fixture `type ROOT = YMap<{ a: YLeaf<string> }>; type Node = YMap<{ r: ROOT }>;` → `toThrow(/ROOT 不可被引用/)`，与设计 §9.2.2 建议 D (a) 稿逐字一致；消息模板前缀可断言。红证据亲复：`.mabf-bg/sa6-r5-fix.log` `Tests 1 failed | 8 passed (9)`、失败模式 `expected [Function] to throw an error`（008e34c 无拦截的真红，非伪红）；本会话全量 `pnpm test` = `1 failed | 406 passed (407)`、Type Errors no errors——唯一红即 D。既有 fixture 零 ref→ROOT（HEAD 版本 grep 实证）→ 「拦截补丁对现行断言零扰动」成立。
- **MINOR 路由**：设计建议 D 含 CLI 层断言（spawn `pnpm generate` → status 2 + stderr 含前缀），SA6 只落了 emission 层——二选一明示：SA6 补 CLI 层断言，或以 §9.4 watch-item 5（SA7 动态验证）兜底。

### R3-2 R2-2 规则 1 optional 剥壳核验 —— **通过（含一处措辞纠偏）**

- **机制完备性核验**：§3.2 规则 1（字段成员位先行剥壳、emitNode 恒收剥壳后值；可选性以键后 `?` 表达；权威源 MapField.optional；禁双侧各判一次 = 双 `?`）+ 失配守卫段「emitNode 永不遇 optional kind——非守卫输入、非配对表行」+ §3.5（键后 `?`）+ §3.6（optional→projectValue(内层)）口径一致。R2-2 指认的两条缺口路径均消除：(leaf, opt(scalar)) 剥壳后 → leaf×scalar 表行合法配对；(ref, opt(ref)) 剥壳后 → 规则 0 首查命中别名引用——「opt(ref) 交叉位剥壳后规则 0 恒可达」成立。
- **实测（probe.mjs）**：`a?: YLeaf<string>` → 值 `opt(scalar)`；`a?: Meta` → 值 `opt(ref(Meta))`——剥壳后分别落入 leaf×scalar 行与规则 0，与建议 E 期望发射吻合；实现侧 splitOptional 为条件剥壳（`kind === 'optional'` 才剥），对两形态均正确。
- **与建议 E 断言一致**：mapping 测试 E 块（fixture `title?: YLeaf<string>; meta?: Meta`（Meta 自备）→ `not.toThrow` + `/title\?:\s*PathSchema<string,\s*'leaf'>/`（键后单 `?`）+ `not.toMatch(/title\?\?/)`（禁双 `?`）+ `/meta\?:\s*PathSchema<Meta,\s*'map'>/`（规则 0 穿透 optional 包装））与设计 §9.2.2 建议 E 逐字一致；对 008e34c 为真绿（本会话全量 406 绿含 E 块）。
- **措辞纠偏（MINOR，一句话）**：规则 1「map 字段成员位的值侧形态**恒为** optional 包装」与实测不符——**非 optional 字段不包装**（P1a 实测 `a: YLeaf<string>` → 值 `scalar` 裸形；仅 optional 字段才包装，P1b/P1d）。机制不受影响（「先剥壳（opt → 内层值）」的自然读法即按 kind 条件剥壳，实现亦如此，E 契约已锚定行为）——但「恒为」作为事实陈述是错的，且沿袭自 R2-2 攻击文本自身的「值树字段位恒为 optional 包装」（本轮一并纠正）。修订：改为「**optional 字段**的值侧为 optional 包装（非 optional 字段不包装）——发射器在字段位按 kind 剥壳（opt → 内层值），emitNode 恒收剥壳后的值」。
- **附注（无动作）**：实现以值侧包装为 `?` 的判定源（splitOptional 取 `optional: '?'`），设计钦定权威源 = 结构侧 MapField.optional——两者同源于 IR `f.optional` 恒同步（设计自己的论证），可观测行为等价、无双 `?` 路径（E 契约已锚定禁双 `?`）；不构成分歧，仅源指定差异。
- **[本会话补证] optional 位置全谱 + 恒同步在 aliases 侧的独立实证**：optional 仅现于三种对象字段成员位（根接口字段 / 别名内层 map 字段 / 联合成员对象字段——`{ kind:"a"; x?: YLeaf<string> } | …` → 值 `opt(scalar)` 且**结构侧该 MapField.optional=true**，双侧同步实锤；发射 `'x'?: PathSchema<string, 'leaf'>` 单 `?`）；Record `<key>` 值位永非 optional；`e?: Meta | Meta`（字段位 optional × 直联合）解析层 E100 拒——opt(union-direct) 无路径，剥壳后必落 scalar/ref 两条已知配对。「字段位剥壳即全覆盖」声明与冻结契约实测一致。

### R3-3 R2-3 union 同形裁决核验 —— **设计条文通过；发现实现 kindOf 路径缺口（MEDIUM，本轮唯一必修项）**

- **设计条文核验（五处口径一致，条文本身完备正确）**：§3.2 union 行（成员结构 kind 全员同形 → 该 kind；异形 → `UnsupportedUnionKindError` 命名化 loud + 消息模板 + CLI exit 2 + **禁止默认 `'map'`** + 成员发射泛化「各成员按配对表行独立走查，不预设恒 map」）+ §3.2 规则 0 kindOf 映射（**union→同形裁决**）+ §3.4 kindOf 映射（同）+ §5.3 步骤 4 + §5.4 硬错误行——一致；消息前缀「联合成员结构 kind 异形」可断言。
- **与建议 F 断言一致**：emission F 块（同形 inline 联合 → 尾参 `'array'` 精确正则；异形 `A | B`（map 别名 | array 别名）→ `toThrow(/联合成员结构 kind 异形/)`)与设计 §9.2.2 建议 F 一致；对 008e34c 为真绿（inline/段② 路径的 unionKind 同形裁决已落地）。
- **❗增量缺口（kindof.mjs 探针实锤，MEDIUM）——kindOf 路径未落地同形裁决**：设计 §3.2 规则 0/§3.4 两处明文「kindOf(union 别名) = 同形裁决」，但 008e34c 的 `kindOfAlias` 终点 `kindLiteral` 把 union **无条件**映射 `'map'`（emitter.ts L286-290 `case 'map': case 'union': return 'map'`），未调 unionKind。实测（真实 generateProjection）：
  - **误标实锤**：`type U = YArray<YLeaf<string>> | YArray<YLeaf<number>>; type ROOT = YMap<{ u: U }>;`（合法输入，值侧 `ref(U)`——规则 0 位）→ 现实现发射 **`u: PathSchema<U, 'map'>`**（按设计应为 `'array'`）——同形 array 联合别名引用位 kind 误标，PathKind/序列编辑 API 门禁失真，与 R2-3 同类语义误标在引用位复发；
  - 异形联合别名按名引用（`type H = A | B; … { h: H }`）→ 现实现恰因**段② emitAlias 先行**走 unionKind 而响亮抛 `UnsupportedUnionKindError`（净结果正确，但命中检查点非设计条文的 kindOf 位——正确性依赖段② 先于段③ 的发射序，属侥幸对齐而非条文对齐）；
  - **红灯零覆盖**：建议 F 两断言均为 **inline** 联合，「联合别名按名引用位」零锚点——上述误标对现行全部 407 测试静默通过。
  - **必修路由项（随 SA3 D 拦截补丁同车，零额外派发成本）**：① SA3 修 `kindOfAlias`：union 节点改走 unionKind（对齐设计明文，函数级一处改动，落点 emitter.ts 在既有 ALLOW 项内）；② R3 修订汇总 R2-3 行「实现（commit 008e34c）已按本行落地」对齐声明纠偏（「inline/段② 路径已落地；kindOf 引用位路径未落地，随 SA3 返修」）——**落点 = SA1（设计文档 erratum，SA3/SA2 均不得改设计文档）或总控径改**；③ 建议 F 增补锚点（SA6）：fixture `type U = YArray<YLeaf<string>> | YArray<YLeaf<number>>; type ROOT = YMap<{ u: U }>;` → `/u\s*:\s*PathSchema<U,\s*'array'>/`——把规则 0 引用位的同形裁决升为契约。
  - **[本会话独立复现]**：本会话以独立探针（不经并行稿）得到同一实锤——`u: U` 位 structure=`ref`、`values.ROOT.u=ref:U`（规则 0 位）、008e34c 输出 `u: PathSchema<U, 'map'>;` 且段② `export type U = Record<…> | Record<…>`（声明形 array 联合 × 引用位 'map' 自相矛盾，误标无可争辩）；两会话互证。

### R3-4 R2-4/R2-5/观察 1/2 落实核验 —— **全部落实**

- **R2-4 论据 (a) 改述 ✅**：§3.4「解析层 E106 已保证别名图无环（SA2 实测七形态全拒：直接自引/字段位/经数组元素/经 YArray 实参/经 Record 值位/经 YMap 实参/间接 A→B→A）→ 自引用别名属正常输入不可达；具名引用的必要性来自 (b)(c) 与 (X,ref) 配对，不依赖环可达性（『内联发射会无限递归』仅在环可达假设下成立，保留为纵深防御余量）」——改述到位；两处环守卫（§3.2 规则 0 kindOf 环守卫、§3.6 ValueContextCycleError）均标「纵深防御，正常输入不可达（兜未来方言演进）」，与改述互证。本会话抽验补证：ROOT 自引用 `type ROOT = YMap<{ r: ROOT }>` 确被解析层拒绝（E106）✅。
- **R2-5 version 守卫 ✅**：§4「守卫扩界（R3）：`version` 须为非空 string（`typeof version === 'string' && version !== ''`）——缺失/非串/空串 → 同一命名化 loud throw」——`@nomicore/vfsl-codegen@undefined` 对版本说谎且 regen-diff 不报警的残余路径闭合。**[本会话补证·路由减免]**：实现侧已同步落地（header.ts L26-27 `typeof version !== 'string' || version === ''` → throw，commit 008e34c 含）——本项**无需 SA3 返修**，SA4 静态核对即可。
- **观察 1 ✅**：§5.3 G 票交接注记增「多域顶层键合并冲突：两域同名顶层键不同类型 → TS2717（D5 单接口载体机制使然，非 F2 可修）；G 落地多域时须定夺顶层键命名规约（或协议层扩展归后续票）」。
- **观察 2 ✅**：§5.3 登记路径定稿（Record/联合/**被引用** ROOT + 异形联合的协议层扩展「由总控开后续票登记」，收尾开 GitHub follow-up issue 承接；gh issue list 已核对当前无实票）+ 三处错误消息模板占位符统一落「由总控开后续票登记」（§3.2.1 / §3.2 union 行 / §3.4 R2-1）。
- **MINOR 路由注记（消息尾同步）**：实现侧两条错误消息尾现为「见后续票」（UnsupportedRootShapeError、UnsupportedUnionKindError——emitter.ts L39/L57 亲核），设计模板尾为「由总控开后续票登记」。设计已为前者标注「SA3 已实现消息尾为『见后续票』，路由 SA3 时同步本尾串」（§3.2.1），**后者（union 错误）无同步注记**——SA3 返修时一并同步（消息前缀已被 C/F 断言锚定，尾串同步零测试风险）。

### R3-5 建议 D/E/F 断言形状核验 + 增量攻击 —— **D/E/F 落地一致；两项增量新发现（1 MEDIUM 已并入 R3-3，余为 MINOR）**

- **建议 D**：(a) 案终稿断言已落地且逐字一致（emission 层，见 R3-1）；设计建议稿内含的 CLI 层断言未落地（MINOR 二选一路由，见 R3-1 末条）。
- **建议 E**：已落地、与设计 §9.2.2 建议 E 逐字一致、对 008e34c 真绿（见 R3-2）。
- **建议 F**：已落地、形状一致、真绿；锚点盲区 = 联合别名按名引用位（必修路由项③，见 R3-3）。
- **增量攻击清单（对 R3 新内容的独立攻击，全部 /tmp 沙箱探针）**：
  1. **第 7 触发形态**（联合成员位引 ROOT，独立别名内）——枚举不全但三检查点按位点覆盖，处置安全（见 R3-1，一句话补遗）。
  2. **kindOf 同形裁决缺口**——MEDIUM 必修项（见 R3-3，误标实锤 `u: PathSchema<U, 'map'>`）。
  3. **规则 1「恒为」措辞**与实测不符（非 optional 字段不包装）——MINOR 措辞纠偏（见 R3-2）。
  4. **纯值上下文 ref→ROOT 可达性**——攻击**未成立**（设计未在此设防属正确而非遗漏）：实测 `YPlainArray<ROOT>` 与 `YPlainArray<Meta>`（map 别名）均被 E307 拒（「别名经别名间接引入同步标记到纯值上下文」）——projectValue 的 ref 内联展开位不可达 ROOT，§3.6 无需 ROOT 检查点。
  5. **消息尾同步路由缺口**（union 错误无 SA3 同步注记）——MINOR（见 R3-4 末条）。
  6. **并发进程卫生（process）**：本 R3 复审期间评审文件骨架被并行 SA2 实例改写一次（本节即合并产物，沿 R1「并行稿合并终稿」惯例处理）；另总控唤醒指令中的 (b) 描述系 21:47-21:55 窗口的纠偏前旧态（见 R3-1 裁决背景）——后续轮派发前宜核对 worktree 活跃实例与最新落盘事实，避免双写与旧态指令。

### R3 结论与路由清单

**理由**：R2 最终 reject 的两项根因（「冻结契约合法输入 × 唯一骨架无路径 × 红灯零覆盖」）在 R3 (a) 终稿中均已消除——R2-1 三检查点按位点设防（含本轮新发现的第 7 触发形态，处置安全）、R2-2 规则 1 剥壳完备（两条缺口路径消除、E 契约锚定）、R2-3 设计条文五处一致且禁默认 `'map'`；R2-4/R2-5/观察 1/2 逐项落实。本轮增量攻击**未发现任何设计算法层缺口**：唯一 MEDIUM（kindOf 同形裁决缺口）是**实现**对设计明文条文的偏离（008e34c 早于 R3 定稿）+ 契约锚点盲区 + 修订汇总对齐声明失实——设计规范本身正确完备，SA3 按设计实现即自动闭合，且 SA3 返修（D 拦截补丁）本就待派，必修项同车零额外派发成本。宏观决策（格式 v3 / §7 接线 / tsx 载体 / 阶段门 / 版本自同步 / 规则 0 本体 / §3.2.1 限界）R2 已验证部分本轮零改动、维持成立。

| # | 级别 | 路由项 | 落点 |
|---|---|---|---|
| 1 | **MEDIUM（必修）** | ① `kindOfAlias` 同形裁决补丁（union 节点改走 unionKind，emitter.ts L286-290）；② R3 修订汇总 R2-3 行对齐声明纠偏（「已按本行落地」→「inline/段② 已落地；kindOf 引用位未落地，随 SA3 返修」）；③ 建议 F 增补「联合别名按名引用位」锚点（fixture `type U = YArray<YLeaf<string>> \| YArray<YLeaf<number>>; type ROOT = YMap<{ u: U }>;` → `/u\s*:\s*PathSchema<U,\s*'array'>/`） | ① SA3（随 D 拦截补丁同车）/ ② **SA1（设计文档 erratum）或总控径改——非 SA3**（SA3 不得改设计文档）/ ③ SA6（需总控路由） |
| 2 | MINOR | 规则 1「恒为」措辞纠偏（非 optional 字段不包装）+ §3.4/§10 行 12 触发形态枚举补「联合成员位（独立别名内）」 | SA1 两句话（或总控径改；纯文档准确性，无算法影响；可与路由项 1② 同批） |
| 3 | MINOR | UnsupportedUnionKindError 消息尾「见后续票」→「由总控开后续票登记」同步（与 §3.2.1 已注记的 UnsupportedRootShapeError 尾串同步同车） | SA3 |
| 4 | MINOR | 建议 D 的 CLI 层断言（exit 2 + stderr 前缀）二选一明示：SA6 补断言，或以 §9.4 watch-item 5（SA7 动态验证）兜底 | 总控定夺 |

**pass 不替代后续 SA4 静态评审（含路由项 ①③ 的落地核对）与 SA7 动态验证（含 watch-item 5）。**

### R3 验证证据（两会话并行取证，全部 /tmp 沙箱探针 + 只读命令，真仓零写入除本报告）

**并行会话取证**：

- `pnpm dlx tsx /tmp/sa2-r3-probe/probe.mjs` / `probe2.mjs`：六触发形态 + 第 7 形态（`U=un(ref(A)|ref(ROOT))`）parse+evaluate 全 ok 且值树含 `ref(ROOT)`；ROOT 自引用与 ROOT 字段内联 `A|ROOT` 被 E106 拒、独立别名内 `A|ROOT` 合法；`YPlainArray<ROOT>`/`YPlainArray<Meta>` E307 双拒（纯值上下文不可达 ROOT）；非 optional 字段值侧裸形（`obj{a:scalar}`）、optional 字段包装（`opt(scalar)`/`opt(ref(Meta))`）。
- `pnpm dlx tsx /tmp/sa2-r3-probe/kindof.mjs`（真实 generateProjection）：同形联合别名引用位发射 `u: PathSchema<U, 'map'>`（误标实锤，应 `'array'`）；异形联合别名按名引用 throw `UnsupportedUnionKindError`（段② 先行所致）；inline 同形联合 `'array'` 正常。
- `pnpm test`（真仓全量复跑）：`Test Files 1 failed | 23 passed (24)`、`Tests 1 failed | 406 passed (407)`、`Type Errors no errors`——唯一红 = 建议 D（真红：008e34c 无 ROOT 引用拦截，`.mabf-bg/sa6-r5-fix.log` 失败模式 `expected [Function] to throw an error` 亲核）。
- 逐字比对：emission D 块（(a) 版 toThrow）/ emission F 块（同形尾参 + 异形 toThrow）/ mapping E 块（剥壳四断言）与设计 §9.2.2 建议 D/F/E 一致；HEAD 版本既有 fixture grep 零 ref→ROOT；设计全文「按需具名发射」仅 3 处裁决史语境（无活性 (b) 残留）；emitter.ts L39/L57 消息尾「见后续票」亲核。
- dispatch 时间线核对（wiki/raw/task_vfsl-codegen_dispatch.md #17/#19/#20 + .mabf-bg/sa6-r5-fix.log）：21:36 SA1 R3 交付 (b) 案 → 总控终裁 (a) → 21:55 SA6 D 块整块翻转（真红 `expected [Function] to throw an error`）→ 22:09 R3 复审派发——裁决背景叙述成立。

**合并方（另一独立会话）取证**：

- **独立探针 /tmp/sa2-r3-probe/{main,opt,opt2,parallel}.ts（与并行会话探针互独立，同一仓内真源）**：
  - `main.ts`（对真实 evaluate + 真实 008e34c emitter）：D fixture NO THROW 且输出含 `export type Node = { 'r': PathSchema<ROOT, 'map'> };`（静默破碎实锤，toThrow 真红成立）；E 四断言 4/4 全过（输出 `title?: PathSchema<string, 'leaf'>;` / `meta?: PathSchema<Meta, 'map'>;` 真绿非弱化）；F 同形正则（尾参 `'array'`）命中 + 异形 toThrow 前缀命中；**kindOf 引用位误标独立复现**（`u: PathSchema<U, 'map'>` + 段② `export type U` 声明形自相矛盾）；六形态值树 ref:ROOT 位全谱 + Record 形 ROOT 被引用时 `UnsupportedRootShapeError` 先抛（形态检查先于引用走查，无叠加）；mapping fixture 六项关键断言对 008e34c 全过（规则 0 无回归）。
  - `opt.ts`/`opt2.ts`：optional 位置全谱（三种对象字段成员位；Record `<key>` 永非 optional；`e?: Meta | Meta` E100 拒）；联合成员内 `x?:` 的双侧同步（结构 `optional:true` ↔ 值 `opt(scalar)`）+ 发射单 `?`；根接口与 YMap 内层字段 optional 标记同步。
  - `parallel.ts`：并行稿三新主张独立复现——第 7 形态（`values.U.<member 1>=ref:ROOT` + `aliases.U.<member 1>=ref:ROOT`）、ROOT 字段内联 `A|ROOT`/直自引 E106 双拒、`YPlainArray<ROOT>`/`YPlainArray<Meta>` E307 双拒。
  - 只读核对：header.ts L19-29（R2-5 守卫已落地）、cli.ts L155-160（顶层 catch → exit 2 全硬错误族）、collect.ts idBase（§5.3 对齐）、emitter.ts L286-290（kindLiteral union→'map' 硬编码位）。

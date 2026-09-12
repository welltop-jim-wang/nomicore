# SA6 诊断与验收契约 — issue #315：VFSL 三约束形态核心链（number & Int / Int<min,max> / Range<min,max>，ADR 0020）

- Dispatch：`sa-5b7b2a79-fd76-466e-a3bf-e483424b4d68`（mabf-sa6 / acceptance-contract / iteration 0）
- 任务类型：**Feature**（能力缺口证明 + 目标行为验收契约；不虚构 Bug 根因）
- 基线 worktree：`/home/wangjian/nomicore-fix-issue-315`，分支 `mabf/issue-315`，HEAD `7b92af0048ee58817aada54efdb581b24a760a93`（#314 数字字面量拓宽 PR #326 已合入、#319/ADR 0021 number 基线收窄已合入）
- SA6 模式：**contract-only**（派工明文「不得实现或编写可执行测试」）——本报告是唯一交付物；红灯证据由 HEAD 上的最小复现探针取得（§5/§9），可执行测试由 SA3 按 §12 契约落地。
- 结论预告：**`verdict: approve`** —— 能力缺口稳定复现（三形态 + 全局位置共 13 例在 HEAD 全部 E100，红因逐条落在 parser 交叉白名单闸门）；绕过 parser 手工构造 `int`/`range` 叶子证明缺口覆盖 IR/derived/validate/codegen（`evaluate` 静默丢键、validate 静默放行、codegen 响亮 desync）；负控与全部门禁基线全绿；契约可执行、入口真实。

---

## 1. Task type and inputs

| 输入 | 路径 | 状态 / 关键内容 |
| --- | --- | --- |
| Host 任务简报 | `wiki/raw/task_issue-315.md` | 存在；Issue #315 body（What to build + 5 条 AC + `Blocked by #314`） |
| Owner comments | `gh issue view 315 --json comments` → `comments: []`（labels: `in-progress`, `feature`；state OPEN） | **空**——需求全集 = Issue body（§2） |
| relevant_decisions | `wiki/raw/task_issue-315_relevant_decisions.md` | **不存在**（本任务未生成；非阻塞） |
| conflict_report | `wiki/raw/task_issue-315_conflict_report.md` | **不存在**（本任务未生成；非阻塞） |
| SA8 产物（design / spec review / AC checklist） | `wiki/raw/task_issue-315_*` | **不存在**（除简报与本报告外无 315 产物；§3 以 ADR + spec + 源码 + CI 为可执行约束） |
| 权威决策 | `docs/adr/0020-vfsl-number-constraints.md`（已接受；决策 2/3/4/5/6/7/8/10 即本票依据；决策 9 已被 ADR 0021 supersede） | 三形态、arity/端点/空区间规则、IR/derived `int`/`range` 叶子、validate 判定、codegen `number`、投影按标量叶子 |
| 统一基线决策 | `docs/adr/0021-vfsl-number-domain-narrowing.md`（决策 1：number 家族统一收窄；决策 2：`-0` 字面量 E100） | 三形态运行时同受四值（NaN/±Infinity/-0）拒绝基线 |
| 前置实现 | #314（PR #326，HEAD 含）：数字字面量 `-?[0-9]+(\.[0-9]+)?`、`-0` 值判定 E100、超双精度 E100 | 三形态的端点/字面量已可写；本票不再动 tokenizer 字面量面 |
| 规范文档 | `docs/vfsl/v1-spec.md`（§2 交叉白名单仍写「唯一允许的交叉类型」、EBNF 无 Int/Range、§4 保留名 16 名）、`docs/vfsl/schema-authoring-guide.md`（§6 无数值约束章节） | 文档面按 ADR 0020 决策 10「与实现同 PR」落地（§12.8） |
| 模块规约 | 根 `AGENTS.md`、`packages/vfsl/AGENTS.md`、`packages/vfsl-codegen/AGENTS.md`、`packages/namespace-runtime/AGENTS.md`、`docs/AGENTS.md` | 错误码/锚位/指纹/API 兼容性纪律（§3） |
| 既有测试 | `packages/vfsl/test/**`（348 files / 3721 tests 全绿）、`packages/vfsl-codegen/test/**`、`tests/acceptance/vfsl_spec_acceptance.py`（22/22 GREEN） | 基线见 §4；两处既有文本断言须按 §10 翻转/保持 |

**范围界定（据 Issue body + ADR 0020/0021）**

- **在范围内**：`Int`/`Range` 进入保留名集合（E303/E100 判定族）；交叉白名单 1 例扩 4 例（E100 文案更新）；arity 严格；Int 端点整数限定；空区间（min > max，f64）解析期 E100；IR/derived 新增 `int`/`range` 叶子（`exactOptionalPropertyTypes` 条件键纪律）；validate 三形态逐值判定（O(1)、全收集、工作预算计费）；连带的 codegen `number` 原样发射、readData 投影按标量叶子处理、`sha256:v1:` 指纹零漂移、规范/指南同 PR 更新。
- **不在范围内**（ADR 0020「明确不做」）：开放/半开区间语法；指数记号；品牌类型 codegen；十六进制等其它字面量形态；number 基线本体（已由 #319/ADR 0021 落地）；`Int`/`Range` 之外的保留名增补。

---

## 2. Owner comment mapping

- `gh issue view 315 --json comments` 实测 `comments: []`（labels `in-progress`/`feature`，state OPEN），派工单亦确认 REST comments snapshot 为空。
- 因此**没有**超出简报正文的 owner 追加要求；契约必达项 = Issue body 的 5 条 Acceptance criteria + ADR 0020/0021 条款，映射如下：

| Issue AC | 契约条目 |
| --- | --- |
| AC1 三形态正例（整数/小数/负端点）解析→IR→derived→validate 全链贯通，边界含端点 | C1（§12.2）、C3（§12.4）、C4（§12.5） |
| AC2 各负例（arity、Int 浮点端点、空区间、裸用、保留名占用 E303）错误码与锚位正确 | C2（§12.3，逐例钉码 + 行列锚） |
| AC3 NaN/±Infinity/-0 入三形态均拒绝，入裸 number 同样拒绝（ADR 0021 统一基线） | C4（三形态四值全拒 + 负控保 #319 基线） |
| AC4 无 Int/Range 的既有 fixture 指纹逐字节不变；含 Int/Range 新 fixture 指纹稳定 | C5（§12.6） |
| AC5 包测试、typecheck 全绿 | C8（§12.9；含 codegen/投影/文档机检） |

---

## 3. SA8 constraints（继承与本契约的对应）

本 dispatch 无 SA8 产物（`wiki/raw/` 无 `task_issue-315_sa8*`、design、relevant_decisions、conflict_report）。可执行约束全部来自既有规范与 CI，逐条列为契约硬约束：

| # | 约束来源 | 内容 | 本契约落点 |
| --- | --- | --- | --- |
| S1 | `packages/vfsl/AGENTS.md` | 错误码、issue 顺序、行列锚位、指纹输入是兼容性行为；parser/evaluator/validate 同步、确定、公共畸形输入返回判别结果而非抛出；IR/derived 为环境无关、可 JSON 序列化纯数据 | C2 锚位逐例钉死；C3 断言 IR/derived 纯数据 JSON 往返；C4 不抛错 |
| S2 | `packages/vfsl-codegen/AGENTS.md` | 输出确定、逐字节稳定；`pnpm generate --check` 必须检出任何陈旧生成物；不得在生成器重推导 VFSL 语义 | C6a（`int`/`range` → `number`）+ C8（`generate --check`） |
| S3 | `packages/namespace-runtime/AGENTS.md` | 公共 API 只暴露 detached projection；`cloneValueSchema` 等值树克隆不得返回 undefined | C6c（typecheck 机械强制所有 switch 站点补 case） |
| S4 | `docs/AGENTS.md` | 代码行为变化必须同步更新所有陈述该契约的规范文档；不得发明实现行为 | C7（spec/guide 与实现同 PR） |
| S5 | ADR 0020 决策 1/4 | 保留名增补走 §8 窄例外；零新增错误码（全部复用 E100/E303） | C2 只用 E100/E303；C7 spec §8 既有例外条款不改 |
| S6 | ADR 0020 决策 5/7/8 | IR/derived 条件键纪律；既有语义指纹逐字节不变；codegen 生成 `number`；投影不新增拒绝路径 | C3/C5/C6b |
| S7 | ADR 0021 决策 1/2/3 | number 家族统一四值基线（含 -0 经 `Object.is` 识别）；`-0` 字面量（含端点）E100；消息不显示 -0 为 "0" | C4 四值矩阵；C2 `-0` 端点；C4 消息规则 R2 |
| S8 | `packages/vfsl/src/fingerprint.ts` D2-CONTRACT-MARKER | 第二生产者/跨实现互认前须升 v2 前缀；升级触发器清单含「v2 方言放开数值字面量语法」 | C5：ADR 0020 决策 1 明确**不引入 v2 方言**、决策 5 要求既有指纹不变 ⇒ 保持 `sha256:v1:`（§15 U2 登记为已裁定） |
| S9 | CI（`.github/workflows/ci.yml`） | `pnpm typecheck`；`vitest run --typecheck.only`；6 分片 `*.test.ts`；`codegen-freshness` = `pnpm generate --check` | C8 门禁清单；§14 发现面证据 |
| S10 | ADR 0020 决策 10 | spec §2/§3/§8 与 authoring guide 修订与实现**同 PR** | C7 |

---

## 4. Environment and baseline

| 项 | 值 |
| --- | --- |
| 环境 | Linux；Node `v24.13.0`；pnpm `10.28.2`；tsx `4.23.12`；vitest `3.2.7`；typescript `5.9.3` |
| 依赖 | `pnpm install --frozen-lockfile --offline` → exit 0（65 包全部 reused 自本地 store v10，零网络） |
| 生产实现改动 | **无**（起点 `git status --short` 仅 Host 未跟踪简报 + SA6 临时探针目录 `.sa6-tmp/`） |
| 全量类型检查 | `pnpm typecheck`（14 个 tsc 工程）→ **exit 0** |
| 全量测试 | `pnpm test`（`vitest run --typecheck`）→ **exit 0**：`Test Files 348 passed`、`Tests 3721 passed`、`Type Errors no errors`，599.25s |
| 生成物新鲜度 | `pnpm generate --check` → **exit 0**（`domains/vfs3-assets/generated.ts` 字节新鲜） |
| diff 卫生 | `git diff --check` → **exit 0**（无输出） |
| 规格机检 | `python3 tests/acceptance/vfsl_spec_acceptance.py` → **GREEN 22/22，exit 0** |

**既有 fixture 指纹基线（`FileSchemaSource(repoRoot)` → `load('vfs3-assets@1')` → `compileSchemaEnvelope`，探针 P-C 实测，与 #314 SA6 §4 及 `number-literals-fixture-drift.test.ts` 钉值逐字节一致）**

| 量 | HEAD 基线值 |
| --- | --- |
| `source.list()` | `["vfs3-assets@1"]` |
| `envelopeFingerprint` | `sha256:v1:7b6c19cbac93cbf104c055c320b5e4a5ba72e0db87342de0853c68bedff53f39` |
| `semanticFingerprint` | `sha256:v1:b71be76e3d3579670236b14a36373716db6238d86a15da440f44aecbb9b0631c` |
| `domains/vfs3-assets/generated.ts` sha256 | `342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707` |
| `domains/vfs3-assets/schema.vfsl` 中 `\bInt\b` / `\bRange\b` 出现次数 | `0` / `0`（ADR 0020 决策 1 冲突排查证据的可复核形态） |

**既有文本断言基线（与本票直接相关）**

- `packages/vfsl/test/parse-vfsl-containers-markers.test.ts:288-291`：`type A = number & string;` / `type A = string & number;` → 只断言 **E100 码**（不断言消息文案）⇒ §12.3 的 E100 文案更新不影响其绿。
- `packages/vfsl/test/validate-number-domain-narrowing.test.ts:419-425`（AC7 块）：`it.each(['int','Int','range','Range'])` 断言 `type ROOT = { n: ${name} };` → **E301 未知名引用**。本票保留名收窄后 `Int`/`Range` 变 E100、`int`/`range` 仍 E301 ⇒ **该用例必须按 §10 拆分/改写**（语义翻转，非弱化）。
- `packages/vfsl/test/parse-vfsl-errors.test.ts:163-167`：E303 锚声明名 `(1,6)`（`type string = number;`）——C2 的 E303 锚位镜像基准。
- `packages/vfsl/test/spec-docs-anchor-m4-contract.test.ts`：D2/D3 对 spec/guide 内 `vfsl` 文档块执行真实 `parseVfsl`+`evaluate`（文档块必须双 ok）；D5 needle = `三锚位`（与本票文档改动无交集）。

---

## 5. Positive reproduction（能力缺口：HEAD 红灯证据）

**探针装置**：`.sa6-tmp/probe-a-parse.ts`（`pnpm exec tsx` 直消费 `packages/vfsl/src/index.ts`，无构建产物依赖）；规范模块与锚位约定：

```
MODULE(FORM) := `type ROOT = YMap<{ v: ${FORM} }>;`     // 类型表达式起点 = 第 23 列
```

**HEAD 实测（探针两轮逐字节一致，§7）**：

| # | FORM（MODULE 内） | HEAD 实际 | 目标行为 |
| --- | --- | --- | --- |
| P1 | `number & Int<1, 100>` | `VFSL-E100: 交叉类型仅允许 string & Pattern<…>` @ (1,30) | ok；IR `{kind:'int',min:1,max:100}` |
| P2 | `number & Int` | E100 @ (1,30) | ok；IR `{kind:'int'}`（无 `min`/`max` 键） |
| P3 | `number & Range<0, 1>` | E100 @ (1,30) | ok；IR `{kind:'range',min:0,max:1}` |
| P4 | `number & Range<0.5, 1.5>` | E100 @ (1,30) | ok；IR `{kind:'range',min:0.5,max:1.5}` |
| P5 | `number & Range<-40, 85>` | E100 @ (1,30) | ok；IR `{kind:'range',min:-40,max:85}` |
| P6 | `number & Int<-10, 10>` | E100 @ (1,30) | ok；IR `{kind:'int',min:-10,max:10}` |
| P7 | `number & Int<0, 9>[]` | E100 @ (1,30) | ok；IR `{kind:'array',element:{kind:'int',min:0,max:9}}` |
| P8 | `number & Int<1, 1>`（单点区间） | E100 @ (1,30) | ok；IR `{kind:'int',min:1,max:1}` |
| P9 | `number & Range<0, 0>`（单点区间） | E100 @ (1,30) | ok；IR `{kind:'range',min:0,max:0}` |

**全局位置（同一构造应处处可用；只差位置，不差语义）**：

| # | 模块 | HEAD 实际 | 目标 |
| --- | --- | --- | --- |
| G1 | `type A = number & Int<1, 3>; type ROOT = YMap<{ v: A }>;` | E100 @ (1,17) | ok（别名 RHS） |
| G2 | `type ROOT = YMap<{ v: Record<string, number & Int<1, 3>> }>;` | E100 @ (1,45) | ok（Record 值位） |
| G3 | `type ROOT = YMap<{ v: YLeaf<number & Int<1, 3>> }>;` | E100 @ (1,36) | ok（YLeaf 实参；标量形容纳） |
| G4 | `type ROOT = YMap<{ v: number & Range<0, 1> }>;` | E100 @ (1,30) | ok（对象字段） |

**红因非环境/夹具/入口错误的反证**：

1. 同一探针装置上 `string & Pattern<"a">` → `ok:true {kind:'pattern',regex:'a'}`（C7），`-1 | 1` → ok，`.5` → E100 @ (1,23)（#314 负例仍绿）；即「交叉白名单只认 Pattern」是唯一分界，而非 tsx/vitest/入口故障。
2. 红因直接落在 `packages/vfsl/src/parser.ts:469-481`：

```
if (v === 'string' && this.peekPunct('&')) { … parsePatternType … }
if (this.peekPunct('<')) { … }
return { kind:'primitive', name:'number' }        // ← number 直接返回，& 留给续位分派
…
private dispatchContinuation(prev) {
  if (tok.kind === 'punct' && tok.value === '&') {
    throw this.err(ErrCode.E100, '交叉类型仅允许 string & Pattern<…>', tok);   // parser.ts:392
  }
}
```

3. 手工构造等价 IR（绕过 parser，`int` 叶子）经公共 `evaluate` **不抛错**但静默丢约束（§9-E2）——证明缺口不止于文本闸门，IR/derived 类型族本身无承载。

**关键实测输出（原样摘录，HEAD）**

```
P1  number & Int<1, 100>
    ok:false VFSL-E100: 交叉类型仅允许 string & Pattern<…> @ (1,30)
P2  number & Int
    ok:false VFSL-E100: 交叉类型仅允许 string & Pattern<…> @ (1,30)
P7  number & Int<0, 9>[]（后缀结合）
    ok:false VFSL-E100: 交叉类型仅允许 string & Pattern<…> @ (1,30)
N6  裸 Int
    ok:false VFSL-E301: 未知名引用: Int @ (1,23)
N18 type Int = number;（保留名占用）
    ok:true  fieldType={"kind":"primitive","name":"number"}
N20 字段名 Int
    ok:true  fieldType={"fields":["Int"]}
N21 字段名 Pattern（既有对照）
    ok:false VFSL-E100: 字段名位保留名: Pattern @ (1,20)
C1  type int = number;（小写非保留）
    ok:true  fieldType={"kind":"ref","name":"int"}
C7  string & Pattern<"a">（绿保持）
    ok:true  fieldType={"kind":"pattern","regex":"a"}
```

---

## 6. Negative control（相近负例 / 对照面，HEAD 已绿，必须保持）

| # | 控制 | HEAD 实测 | 实现后必须 |
| --- | --- | --- | --- |
| N-1 | `type int = number; type ROOT = YMap<{ v: int }>;`（小写非保留名） | ok | 保持 ok（保留名大小写敏感） |
| N-2 | `type Integer = number; … type Range2 = number; …`（近似名） | ok | 保持 ok（不得扩大保留面） |
| N-3 | `type ROOT = YMap<{ v: string & Pattern<"a"> }>;` | ok（IR pattern） | 保持 ok 且 IR 逐字节同形 |
| N-4 | `string & Pattern<"a">[]` | ok（array<pattern>） | 保持 ok（后缀结合先例） |
| N-5 | `string & Pattern`（& 后缺实参） | E100 @ (1,32)（锚 `Pattern`） | 保持同码同锚 |
| N-6 | `string & Pattern<1>` / `string & Pattern<>` | E100 @ (1,40)（锚实参记号） | 保持（Int/Range 的 arity 锚按 ADR 另钉构造起点，§12.3 B3） |
| N-7 | `number & string`、`string & number`、`unknown & Int` | E100 @ `&` | 保持 E100（码不定消息；`unknown & Int` 证明白名单按左元判定） |
| N-8 | `number & Pattern<"a">` | E100 @ (1,30) | 保持 E100（`number` 只配 Int/Range） |
| N-9 | `.5` / `1.` / `1e3` / `1..5` / 裸 `-` / `- 1` / `-/*c*/1` / `-.5` | E100 + 各自既有锚位（#314 契约） | 逐位保持（本票不动字面量面） |
| N-10 | `-0` / `-0.0` / `-00` / f64 下溢为 -0 的形态 | E100 锚该记号、消息引导写 `0` | 保持（#314 值判定） |
| N-11 | `'9'×309` / `-'9'×309`（超双精度） | E100 锚该记号（有限性闸门） | 保持 |
| N-12 | 裸 `number` 四值（NaN/±Infinity/-0）validate 拒绝、有限数放行 | #319 全绿 | 逐条保持（`validate-number-domain-narrowing.test.ts` AC1~AC6 不得弱化） |
| N-13 | `-1 | 1`、`0.5 | 1.5` 联合成员与 f64 严格相等枚举判定 | ok / 命中矩阵绿 | 保持（`validate-number-literals.test.ts`） |
| N-14 | 既有 `vfs3-assets@1` 指纹与 `generated.ts` 字节 | §4 钉值 | 逐字节不变（C5） |
| N-15 | `type string = number;` → E303 @ (1,6)（声明名锚先例） | 绿 | 保持（新保留名同锚风格） |

---

## 7. Stability, scale and timing

- 全链路为同步纯函数（`packages/vfsl/AGENTS.md`），无并发、无线程、无时钟、无 IO（探针仅 `FileSchemaSource` 的确定性文件读）；不适用重复次数/概率口径。
- **确定性证据**：规范探针连续两轮运行 `diff` 为空（`PROBE_A_DETERMINISTIC=yes`、`PROBE_C_DETERMINISTIC=yes`，含 34 例 parse 矩阵与指纹基线）。
- **数值边界（非性能）**：端点仍受 #314 既有闸门约束——目标行为下 `Range<-40, 85>` 合法（负端点）、`Int<`+'9'×309+`, 1>` → E100（超双精度）、`Int<-0, 1>` / `Range<-0.0, 1>` → E100（`-0` 值判定）；`min == max` 非空区间合法（P8/P9），`min > max` 解析期 E100（§12.3）。
- **O(1) 与预算**：`int`/`range` 判定是常数次比较（`Number.isInteger` + 至多两次 `<=`），无引擎、无回溯、无预算耗尽新路径；`validateValue` 每次进入 `charge(ctx,1)`（`validate.ts:502`）对叶子已计费，`emitIssue` 另 `charge(1)`（`validate.ts:108`），与 `pattern`/`scalar` 叶子同层。可观察代理：失配产出普通 issue（非 `校验工作预算耗尽…` / 非 `VFSL-E100: 内部错误` 终态）。
- **全收集规模**：`ISSUE_LIMIT=100`（`validate.ts:54`），101 个失配元素 ⇒ 100 条 issue + 1 条截断标记（`overflow=1`，`validate.ts:649-655`）；契约在 §12.5 C4e 钉死 `issues.length === 101`。

---

## 8. Root-cause chain / capability gap

| Step | Fact | Evidence | Confidence |
| --- | --- | --- | --- |
| 症状 | `type ROOT = YMap<{ v: number & Int<1, 100> }>;` → `ok:false` E100 @ (1,30) | 探针 P1~P9/G1~G4 实测（§5） | 确定 |
| 直接故障点 | parser 交叉白名单只认 `string & Pattern<…>`：`number` 首元返回后 `&` 落入 `dispatchContinuation` 的 E100 分支；`Int`/`Range` 不在 `RESERVED_NAMES`，裸用落 E301、别名声明落「合法」 | `parser.ts:79-84`（16 名集合）、`:388-397`（续位）、`:462-487`（类型位置分派）、`:469-481`（Pattern 主层识别） | 确定 |
| 触发条件 | 任一三形态文本出现在任一类型位置（字段、别名 RHS、Record 值位、YLeaf 实参、数组元素、联合成员） | G1~G4 位置矩阵 | 确定 |
| 最深根因（**能力缺口**） | ADR 0020 已裁决三形态，但实现端到端缺席：IR 类型族无 `int`/`range`（`ir.ts:40-66`）、derived 值树无对应 kind（`derived.ts:44-53`）、`evaluate` 的 `structureOf`/`valueOf`/`walkDocs` 无 case（`evaluate.ts:85-142, 260-300, 380-400`）、`validate` 无判定分支（`validate.ts:369-409, 501-572`）、codegen 叶子闸门显式只许 scalar/enum/pattern/union（`emitter.ts:335-348`）、namespace-runtime 值树克隆无 case（`read-schema-projection.ts:130-180`）；`shapes.ts`/`resolve.ts` 的标量归类也无 `int`/`range` | 探针 E2~E5（§9）逐点实测 | 确定 |
| 缺口边界 | readData 投影侧**已**kind-agnostic：`resolveSchemaAtPath` 对手造 `int`/`range` 叶子按终态原样透传（`ok:true, valueSchema` 原节点），无新增拒绝路径需求 | 探针 E6；`resolve-schema-at-path.ts:290, 414`（default 终态分支） | 确定 |
| 放大因素 | ① **静默放行**：未知 value kind 在 `validateValue`/`contradictsInner` switch 中落到无 case ⇒ 不 emit、恒 `ok:true`（连 `"1"`/`null` 都放行）；② **静默丢键**：`evaluate` 对手造 `int` 叶子产出 `{"name":"v"}`（`value` 键 undefined，JSON 序列化后消失）却报 `ok:true`。当前生产不可达（parser 不产这些 kind），但实现者若只改 parser/IR 不改 validate/codegen，会把这些「假绿」通道打开 | 探针 E2/E3/E4 实测；`validate.ts:501-572` 无 default；`evaluate.ts` `valueOf` 无 default | 确定 |
| 未证实假设 | 无关键假设。`Int<1.0, 2>` 的值判定/文本判定二义、空区间锚位、复合违规优先级 = ADR 未钉死的**边界钉值项**，列 §12.11 由设计显式冻结（不阻塞红灯：HEAD 全部红在同一处） | §12.11 | 高 |

**能力缺口（Feature 口径）**：`Int`/`Range` 三形态在文本层被交叉白名单闸门整体拒绝；即便文本可达，下游 IR/derived/validate/codegen 也无承载形状——本票要把「已裁决的能力」从 parser 一路落到 validate（及 codegen/投影/文档的连带面）。

---

## 9. Causal experiments

| # | 实验 | 控制变量 | 观察（HEAD 实测） | 结论 |
| --- | --- | --- | --- | --- |
| E1 | 同装置对照：`string & Pattern<"a">` vs `number & Int<1, 100>` | 只换构造 | Pattern 绿、Int 红 @ `&` | 红因 = 交叉白名单闸门，非环境/入口 |
| E2 | 手工 IR（绕过 parser）含 `{kind:'int',min:1,max:100}` → 公共 `evaluate` | 只绕 text 层 | `ok:true`，但 `derived.values.ROOT.fields[0]` = `{"name":"v"}`（**无 `value` 键**）；`structure` = `{kind:'map',fields:[{name:'v',optional:false}]}`（`node` 键亦丢） | IR→derived 无 `int`/`range` 承载；未知 kind 静默丢键（假绿红线） |
| E3 | 手工 derived 含 `int`/`range` 值叶 → `validateLogicalSnapshot` 14 例（含 101/1.5/`"1"`/`null`/NaN/±Inf/-0） | 只换值 | **14/14 全 `ok:true`**（含本应拒绝的全部） | validate 无判定分支且无 default ⇒ 静默放行；实现必须补 `validateValue` + `contradictsInner` |
| E4 | 同一手工 derived → `generateProjection` | 只换 int/range 两 kind | 响亮抛错：`structure/value desync at ROOT.v (structure=leaf, value=int)`（range 同） | codegen 叶子闸门拒绝新 kind ⇒ 必须补 `number` 发射（ADR 决策 7） |
| E5 | 手工 derived 的联合 `(number & Int<1,3>) \| string` 与数组 `int<0,9>[]` | 只换容器 | 联合/数组全部 `ok:true`（含 `true` 入联合、`[1,2,10]` 越界） | 承载缺口遍及容器/联合；候选过滤与全收集同样需接线 |
| E6 | 手工 derived → `resolveSchemaAtPath(['v'])` / `(['v','x'])` | 只换路径 | `['v']` → `ok:true` 且 `valueSchema` 原样 `{kind:'int',min:1,max:100}`；`['v','x']` → `SCHEMA_PATH_NOT_FOUND` | 投影侧已 kind-agnostic，**无新增拒绝路径**（ADR 决策 8）；测试只需锁定透传 |
| E7 | 探针两轮运行 `diff` | 同输入 | `diff` 空（parse 34 例 + 指纹基线） | 无时序/状态依赖 |
| E8 | 保留名锚位镜像：`type string = number;` → E303 @ (1,6)；`{ Pattern: number }` → E100 @ (1,20) | 既有先例 | 同码同锚 | `Int`/`Range` 的 E303/E100 锚位可据既有规则钉死（§12.3） |
| E9 | 形状分类镜像：`type ROOT = number;` → E311 @ (1,13)；`Record<number, string>` → E306 @ (1,30) | 只换键/根形 | 同码同锚 | 新构造被识别为标量形后，E311/E306 路径自动生效（§12.3） |

---

## 10. Impact surface

**预期实现面（SA3 辖域，供 SA4 复核范围）**

| 文件 | 预期改动 |
| --- | --- |
| `packages/vfsl/src/parser.ts` | `RESERVED_NAMES` +`Int`/`Range`（16→18；注释同步）；`AstType` 增 `{kind:'int';min?;max?;pos}`/`{kind:'range';min;max;pos}`；主层识别 `number & Int`/`number & Int<…>`/`number & Range<…>`（镜像 `parsePatternType` 的 `[]` 后缀结合）；arity/端点/空区间 E100；裸用镜像 `Pattern` 判定（裸 `Int`/`Int<…>`/`Range`/`Range<…>` → E100 锚该记号）；交叉白名单 E100 文案更新 |
| `packages/vfsl/src/shapes.ts` | `localCls`：`int`/`range` → `'scalar'`（`strFormOf` 走既有 `default:false`，无需改） |
| `packages/vfsl/src/semantic.ts` | `toIRType` 增 `int`/`range` case（条件键构造，`exactOptionalPropertyTypes`） |
| `packages/vfsl/src/resolve.ts` | `localCls`：`int`/`range` → `'scalar'` |
| `packages/vfsl/src/ir.ts` | `VfslType` 增 `{kind:'int';min?:number;max?:number}` 与 `{kind:'range';min:number;max:number}` |
| `packages/vfsl/src/derived.ts` | `ValueSchema` 增同形两叶子（条件键纪律同 `pattern` 先例） |
| `packages/vfsl/src/evaluate.ts` | `structureOf`/`valueOf`/`walkDocs` 增 case（结构树 `{kind:'leaf'}`、值树叶子、docs 终态） |
| `packages/vfsl/src/validate.ts` | `validateValue` 增 `int`/`range` 判定 + 失配消息；`contradictsInner` 增类型级硬矛盾（`typeof value !== 'number'`，镜像 pattern）；四值基线（含 -0 `Object.is`） |
| `packages/vfsl/src/validate-patch.ts` | 预计零改动（共享 `validateSubtree` 解释器）；由 C4f 写路径用例锁定 |
| `packages/vfsl-codegen/src/{emitter,valuetype}.ts` | 叶子闸门放行 + 值投影：`int`/`range` → `number` |
| `packages/namespace-runtime/src/read-schema-projection.ts` | `cloneValueSchema` 增 `int`/`range` case（返回值树副本，条件键逐键携带） |
| `docs/vfsl/v1-spec.md`、`docs/vfsl/schema-authoring-guide.md` | 按 ADR 0020 决策 10 同 PR 更新（§12.8） |

**必须不变（回归红线）**

- `packages/vfsl/src/tokenizer.ts`、`packages/vfsl/src/pattern.ts`、`packages/vfsl/src/fingerprint.ts`、`packages/vfsl-protocol/**`：零语义改动。
- `domains/vfs3-assets/**`（`schema.vfsl` / `generated.ts`）：逐字节不变；`FINGERPRINT_PREFIX` 保持 `sha256:v1:`。
- 既有错误码集合不新增（只复用 E100/E303）；`parse-vfsl-errors`、`parse-vfsl-forbidden-matrix`、`number-literals-*`、`validate-number-*` 既有断言（除 §10 明列的一处翻转）零漂移。

**测试面**

- 新增（建议路径，命名可调但须被 `packages/vfsl/test/**/*.test.ts` 发现）：`packages/vfsl/test/parse-vfsl-int-range.test.ts`（C1/C2）、`packages/vfsl/test/validate-int-range.test.ts`（C4 含联合/全收集/patch）、`packages/vfsl/test/int-range-fixture-drift.test.ts`（C5）、`packages/vfsl/test/resolve-schema-at-path-int-range.test.ts`（C6b）、`packages/vfsl-codegen/test/generate-int-range.test.ts`（C6a）。
- **必须修改（语义翻转，非弱化）**：`packages/vfsl/test/validate-number-domain-narrowing.test.ts:419-425` —— `['int','Int','range','Range']` 拆分：`int`/`range` 保持 E301（负控），`Int`/`Range` 断言 **E100 @ (1,23)**（保留名，锚该记号）；描述文案同步（原「int/range 三形态不在本任务」由 #315 supersede）。
- **可选（非阻塞）**：`parse-vfsl-containers-markers.test.ts:285` 的 describe 标题「string & Pattern<"…"> 是唯一被接受的交叉形式」措辞过时（其断言只钉 E100 码，仍绿）；建议随文案更新改为四例表述。

---

## 11. Ruled-out hypotheses

| # | 假设 | 排除证据 |
| --- | --- | --- |
| H1 | 「缺口在 tokenizer/数字字面量层（需照 #314 再拓字面量）」 | `-1 | 1`、`0.5 | 1.5`、`Range<-40, 85>` 的端点形态在 HEAD 均为合法 number 记号（#314 已落地）；红在 `&` 而非 `-`/`.`（§5 锚位） |
| H2 | 「下游链已具备 int/range 能力（类比 #314 的 IR literal 已可用）」 | E2/E3/E4 反证：手工 `int` 叶子 → evaluate 丢 `value` 键、validate 14/14 放行、codegen 抛 desync |
| H3 | 「缺口只是 parser 一处，改白名单即完成」 | E2~E5 证明 IR/derived/validate/codegen/克隆全链缺 case；`packages/vfsl/AGENTS.md` 要求全链行为验证 |
| H4 | 「保留名收窄会破坏仓内 schema / 生态」 | `domains/vfs3-assets/schema.vfsl` 中 `Int`/`Range` 出现 0 次；全仓唯一 VFSL 文本冲突 = `validate-number-domain-narrowing.test.ts:422`（本票计划内翻转）；ADR 0020 决策 1 的 §8 例外条款已存在 |
| H5 | 「新增 IR 叶子必须升 `sha256:v2:` 指纹前缀」 | ADR 0020 决策 1（不引入 v2 方言）+ 决策 5（既有语义指纹全部不变）；域文档形态（envelope 四键 / semantic `domain+lang+version+module`）未变；§4 实测既有指纹与 #314 钉值逐字节一致 |
| H6 | 「readData 投影需要新增拒绝路径/失败码」 | E6：对手造 `int`/`range` 叶子 `resolveSchemaAtPath` 原样透传 ok；ADR 0020 决策 8 明示不新增拒绝路径 |
| H7 | 「需要新增错误码」 | ADR 0020 决策 4「全部复用既有错误码，零新增」；C2 只用 E100/E303 |
| H8 | 「arity 锚位应照搬 Pattern 实参锚（锚越界实参记号）」 | ADR 0020 §4 明文「锚定构造起点记号」；Pattern 实测锚越界记号（`string & Pattern<1>` @ 实参）是**不同**锚风格——契约按 ADR 钉 `Int`/`Range` 记号，并登记为与 Pattern 的差异点（§12.3 注） |

---

## 12. Acceptance contract and test paths

### 12.0 契约测试总则（防伪红/伪绿）

1. 断言只观察公共接缝的**运行时输出**：`parseVfsl`、`evaluate`、`validateLogicalSnapshot`、`validatePatch`、`resolveSchemaAtPath`、`compileSchemaEnvelope`、`FileSchemaSource`、`generateProjection`（生成物文本即产品；须再经真实 TS 编译器证明可编译）。禁止 grep 源码/正则断言实现形状。
2. 正例必须使用**声明 ROOT 的完整模块**（`parseVfsl` 含语义/形状相位；缺 ROOT → E310，scalar ROOT → E311）。负例断言必须同时钉 **错误码 + 行列锚**（只断言 `ok:false` 不足以杀死过宽实现）。
3. 禁止 `skip`/`only`/`todo`/`failing`、env 开关、fallback、吞错、软化断言；禁止为过测试改动 `domains/vfs3-assets/**`、指纹前缀、`ISSUE_LIMIT`、错误码集合。
4. 消息文案**不进冻结面**（ADR 0021 决策 3 先例）：除 §12.5 C4d 明列的内容不变量外，只断言错误码与锚位/路径/计数。
5. 类型级断言（若加 `.test-d.ts`）：`PathSchema`/`PathValue` 对 Int/Range 字段投影为 `number`（ADR 决策 7/8），经 `vitest --typecheck` 发现。

### 12.1 规范模块与锚位约定

```
MODULE(FORM) := `type ROOT = YMap<{ v: ${FORM} }>;`     // FORM 起点 = (1,23)；`&` 列 = 30
FIXTURE（C3/C4/C5/C6）:
type ROOT = YMap<{
  a: number & Int;
  b: number & Int<1, 100>;
  c: number & Range<0.5, 1.5>;
  d: number & Range<-40, 85>;
  e: number & Int<0, 9>[];
  p: number & Int<1, 1>;
  q: number & Range<0, 0>;
}>;
```

### 12.2 C1 — 正例：三形态解析 → IR（**HEAD 红 → 目标绿**）

测试文件：`packages/vfsl/test/parse-vfsl-int-range.test.ts`（导入 `../src/index.js`）。断言 `parseVfsl(MODULE(FORM))` → `ok:true`，并断言 `module.aliases` 中 `ROOT` 内字段 `v` 的 IR：

| FORM | IR 断言（`toEqual` 深比较） |
| --- | --- |
| `number & Int` | `{kind:'int'}`（`Object.keys` 恰 `['kind']`；`Object.hasOwn(min/max)` 均 false） |
| `number & Int<1, 100>` | `{kind:'int',min:1,max:100}` |
| `number & Int<-10, 10>` | `{kind:'int',min:-10,max:10}` |
| `number & Int<1, 1>` | `{kind:'int',min:1,max:1}` |
| `number & Range<0, 1>` | `{kind:'range',min:0,max:1}` |
| `number & Range<0.5, 1.5>` | `{kind:'range',min:0.5,max:1.5}`（f64 原值） |
| `number & Range<-40, 85>` | `{kind:'range',min:-40,max:85}` |
| `number & Range<0, 0>` | `{kind:'range',min:0,max:0}` |
| `number & Int<0, 9>[]` | `{kind:'array',element:{kind:'int',min:0,max:9}}` |
| `number&Int<1, 2>`（无空白）/ `number & /*c*/ Int<1, 2>` / 换行形态 | 同 `{kind:'int',min:1,max:2}`（trivia 无关、无文本特判） |

全局位置（每例 `ok:true`）：G1 别名 RHS（`type A = number & Int<1, 3>;`，`A` 的 IR 为 int 叶）、G2 Record 值位、G3 `YLeaf<number & Int<1, 3>>` 实参、G4 对象字段、`v?: number & Int<1, 3>` 可选字段、联合成员位 `number & Int<1, 3> | string`（IR union 首成员为 int 叶）。

### 12.3 C2 — 负例：错误码 + 精确锚（**HEAD 红 → 目标绿；负控保持绿**）

同文件（`describe('invalid Int/Range forms')`），逐例断言 `ok:false`、`issues.length===1`、`message` 以 `VFSL-E100: `（或 `VFSL-E303: `）开头、`line===1`、`column===` 表中值（**不断言消息其余文案**）：

| # | 文本（MODULE 内 FORM，除注明） | 目标码 | 目标锚 | HEAD 实际（红因） |
| --- | --- | --- | --- | --- |
| A1 | `number & Int<5>` | E100 | (1,32) `Int` 记号（构造起点） | E100 @ (1,30) |
| A2 | `number & Int<1, 2, 3>` | E100 | (1,32) | E100 @ (1,30) |
| A3 | `number & Range<0>` | E100 | (1,32) `Range` 记号 | E100 @ (1,30) |
| A4 | `number & Int<>` | E100 | (1,32) | E100 @ (1,30) |
| A5 | `number & Range`（无实参） | E100 | (1,32) | E100 @ (1,30) |
| A6 | `number & Int<0.5, 1>` | E100 | (1,36) 首个小数记号 | E100 @ (1,30) |
| A7 | `number & Int<1, 2.5>` | E100 | (1,39) 小数记号 | E100 @ (1,30) |
| A8 | `number & Int<5, 1>`（空区间） | E100 | (1,32)（§12.11 B2 钉值） | E100 @ (1,30) |
| A9 | `number & Range<1, 0>`（空区间） | E100 | (1,32)（§12.11 B2 钉值） | E100 @ (1,30) |
| A10 | `number & Int<-0, 1>` | E100 | (1,36)（`-0` 值判定，ADR 0021 决策 2） | E100 @ (1,30) |
| A11 | `number & Range<-0.0, 1>` | E100 | (1,38) | E100 @ (1,30) |
| A12 | `number & Int<`+`'9'×309`+`, 1>` | E100 | (1,36)（超双精度闸门复用 #314） | E100 @ (1,30) |
| B1 | 裸 `Int` | E100 | (1,23) 该记号 | **E301 @ (1,23)** |
| B2 | 裸 `Int<1, 2>` | E100 | (1,23) | **E301 @ (1,23)** |
| B3 | 裸 `Range` | E100 | (1,23) | **E301 @ (1,23)** |
| B4 | 裸 `Range<0, 1>` | E100 | (1,23) | **E301 @ (1,23)** |
| B5 | `string & Int<1, 2>`（左元非 number） | E100 | (1,30) `&` | E100 @ (1,30)（码锚暂绿，须保持） |
| B6 | `boolean & Int<1, 2>` | E100 | (1,31) `&` | E100 @ (1,31)（保持） |
| B7 | `unknown & Int` | E100 | (1,31) `&` | E100 @ (1,31)（保持） |
| B8 | `number & Pattern<"a">` | E100 | (1,30) `&` | E100 @ (1,30)（保持；仅文案更新） |
| B9 | `number & Int<1,2> & string`（第二段 `&`） | E100 | (1,41) 第二个 `&` | E100 @ (1,30) |
| B10 | `type Int = number;`（+ 合法 ROOT） | E303 | (1,6) 声明名 | **ok:true** |
| B11 | `type Range = number;`（+ 合法 ROOT） | E303 | (1,6) | **ok:true** |
| B12 | `type ROOT = YMap<{ Int: number }>;`（字段名位） | E100 | (1,20) 字段名记号 | **ok:true** |
| B13 | `type ROOT = number & Int;`（ROOT 非 map 形） | E311 | (1,13) 类型表达式起点 | E100 @ (1,20) |
| B14 | `type ROOT = YMap<{ v: Record<number & Int<1, 3>, string> }>;`（数值键） | E306 | (1,30) 键类型起点 | E100 @ (1,37) |

**负控（HEAD 已绿，须保持）**：`type int = number;` / `type Integer = number;` / `type Range2 = number;` 保持 ok（E100/E303 不得波及小写与近似名）；`type ROOT = YMap<{ Range2: number }>;` 保持 ok（字段名不必保留）。

**注（与 Pattern 的锚风格差异，ADR 明文）**：Pattern 实参错误锚**越界实参记号**（实测 `string & Pattern<1>` → E100 @ (1,40)）；ADR 0020 §4 对本票三形态 arity 明文「锚定构造起点记号」⇒ A1~A5 锚 `Int`/`Range` 记号（(1,32)）。实现者不得照搬 Pattern 的实参锚。

### 12.4 C3 — derived 契约（**HEAD 红 → 目标绿**）

测试文件同上或 `validate-int-range.test.ts` 的前置段。`FIXTURE` → `parseVfsl` ok → `evaluate` ok，断言：

| 断言 | 期望 |
| --- | --- |
| `derived.values.ROOT.fields` 名序 | `a,b,c,d,e,p,q`（声明序） |
| `a.value` | `{kind:'int'}`（`Object.keys` 恰 `['kind']`） |
| `b.value` | `{kind:'int',min:1,max:100}` |
| `c.value` | `{kind:'range',min:0.5,max:1.5}` |
| `d.value` | `{kind:'range',min:-40,max:85}` |
| `e.value` | `{kind:'array',element:{kind:'int',min:0,max:9}}` |
| `p.value` / `q.value` | `{kind:'int',min:1,max:1}` / `{kind:'range',min:0,max:0}` |
| `derived.structure` | ROOT `{kind:'root', node:{kind:'map', fields:[…, {name:'a',optional:false,node:{kind:'leaf'}}, …]}}`（int/range 与 pattern 同层标量叶） |
| `derived.index['ROOT.b']` | `{match:'exact', node:<与 structure 字段同一对象引用>}`（既有引用同一性不变量） |
| `derived.aliasDocs` / `fieldDocs` / `markerDocs` | 无 doc 时 `ROOT`/各字段空数组（新叶子不新增/挪用任何 doc 锚） |
| **无 undefined 键** | `JSON.parse(JSON.stringify(derived))` 与 `derived` 深度相等（杀死 E2 的静默丢键；条件键缺席须为「整键不存在」而非 `undefined`） |

### 12.5 C4 — validate 契约（**HEAD 红 → 目标绿**）

测试文件：`packages/vfsl/test/validate-int-range.test.ts`。

**C4a 合法矩阵（`ok:true`）**：`{a:3,b:1,c:0.5,d:-40,e:[0,9,5],p:1,q:0}`；边界含端点 `{a:-3,b:100,c:1.5,d:85,e:[0],p:1,q:0}`；`d=-40`、`b=1`、`c=0.5` 等端点值逐一单测。

**C4b 失配矩阵（每例恰 1 条 issue，`path` 如表；消息按 C4d 规则）**：

| 字段 | 值 | path | 说明 |
| --- | --- | --- | --- |
| `a`（裸 Int） | `1.5` / `-0` / `NaN` / `Infinity` / `-Infinity` / `"3"` / `null` | `['a']` | 非整数 + 四值基线 + 非数 |
| `a` | `-3`、`0`、`3` | — | ok（整数可为负 / 含 0） |
| `b`（Int<1,100>） | `0` / `101` / `1.5` / `-0` / `NaN` / `Infinity` / `"50"` | `['b']` | 越界 + 非整数 + 四值 + 非数 |
| `b` | `1` / `100` / `50` | — | ok（闭区间含端点） |
| `c`（Range<0.5,1.5>） | `0.4999999999999999` / `1.5000000000000002` / `-0` / `NaN` / `-Infinity` / `"0.5"` | `['c']` | f64 相邻值越界（零 epsilon）+ 四值 + 非数 |
| `c` | `0.5` / `1.5` / `1` | — | ok（含端点） |
| `d`（Range<-40,85>） | `-40.00000000000001` / `85.00000000000001` | `['d']` | 负端点区间边界 |
| `d` | `-40` / `85` / `0` | — | ok |
| `e`（Int<0,9>[]） | `[1,2,10]` | `['e',2]` | 元素位全收集（恰 1 条） |
| `e` | `[1,"2"]` | `['e',1]` | 元素类型 |
| `e` | `[0,9,5]` | — | ok（元素边界含端点） |
| `p`/`q`（单点区间） | `p=1`/`q=0` ok；`p=2`/`q=0.5` → `['p']`/`['q']` | — | `min==max` 非空 |

**C4c 四值基线（AC3）**：上表 `-0`/`NaN`/`±Infinity` 入三形态全部拒绝；**负控**：同一 `FIXTURE` 外，`validate-number-domain-narrowing.test.ts` 的裸 `number` 四值拒绝与有限数放行逐条保持绿（ADR 0021 统一基线不回归）。

**C4d 消息内容不变量（文案不冻结，只钉语义承载）**：
- R1：message 不得以 `VFSL-E100` 开头（非崩溃收编）、不得是预算耗尽终态；
- R2：含实际值渲染——`101`/`1.5`/`NaN`/`Infinity`/`-Infinity` 各自成串；`-0` 必须经 `Object.is` 识别：message(`-0`) 含 `-0` 且 **≠** 同 schema 位 message(`0`)（`Int<1,100>` 下 0 与 -0 均失配，可直接对照）；
- R3：`b=101` 的 message 含 `100`（期望区间上端点，ADR 0020 决策 6「消息含期望区间/整数性描述」）；`b=1.5` 与 `b=101` 两条 message 互异（整数性/区间两维可分）。

**C4e 全收集与预算**：`e` 为长度 101 的全越界数组（`Array(101).fill(10)`）→ `ok:false`、`issues.length===101`（前 100 条 path 逐元素 `['e',i]` + 末条截断标记 `path:[]` 且 message 含 `另有 1 处问题未报告`）；失配产出普通 issue（非预算/崩溃终态）。

**C4f 写路径同口径（validatePatch）**：`validatePatch(derived, {a:3,b:1,c:0.5,d:-40,e:[],p:1,q:0}, ['b'], 101)` → `ok:false`、`path:['b']`；同 base 换 `['b'],50` → `ok:true`；换 `['b'],-0` → `ok:false`。**负控**：同 base 换 `['b'],1` → `ok:true`。

**C4g 联合/数组集成（杀死只改 `validateValue` 的实现）**：`type ROOT = YMap<{ v: number & Int<1, 3> | string }>;`：
- `{v:2}` / `{v:'x'}` → `ok:true`；
- `{v:5}` → `ok:false`、`path:['v']`、`issues.length>=1`（int 成员失配必须被报出）；**条数与文案取决于 §12.11 B6 的硬矛盾模型**（值级模型 → 2 条：`不匹配任何联合成员…` + 下钻；类型级模型 → 1 条：`联合成员 1/2：…`），设计冻结前不得钉死条数；
- `{v:true}` → `ok:false`、`issues.length===2`、首条 message 含 `不匹配任何联合成员`。**该例是 `contradictsInner` 必须补 `int`/`range` case 的判别性用例**：两种正确模型都走「无候选」分支（值级：`true` 不满足区间；类型级：`typeof !== 'number'`），而漏 case（switch 落到无 case ⇒ 恒非矛盾）会变 1 条 issue。探针 D 已实测该分支形态（`number|string` 收 `true` → 恰 2 条，首条含 `不匹配任何联合成员…距离`）。

### 12.6 C5 — 指纹 / 漂移（**HEAD 绿 → 必须保持**）

测试文件：`packages/vfsl/test/int-range-fixture-drift.test.ts`。

| 断言 | 钉值/规则 |
| --- | --- |
| `new FileSchemaSource(repoRoot).list()` | `['vfs3-assets@1']` |
| `compileSchemaEnvelope(load('vfs3-assets@1'))` 双指纹 | 逐字节 = §4 基线（`sha256:v1:7b6c19cb…` / `sha256:v1:b71be76e…`）；前缀 `sha256:v1:` 未升版 |
| `domains/vfs3-assets/generated.ts` sha256 | `342d8c1f…e6707` 逐字节不变 |
| 新 fixture（§12.1 `FIXTURE`）经 `compileSchemaEnvelope({lang:'vfsl',version:1,id:…,text:FIXTURE})` | `ok:true`；两次全新编译 `semanticFingerprint` 相等且以 `sha256:v1:` 开头（**稳定**，不钉具体值） |
| 无 `undefined` 的 IR | `JSON.parse(JSON.stringify(module))` 与 `module` 深度相等（新叶子条件键纪律的结构性哨兵） |
| `pnpm generate --check` | exit 0（CI 门禁，§12.9） |

### 12.7 C6 — codegen 与 readData 投影（**HEAD 红 → 目标绿**）

- **C6a**：`packages/vfsl-codegen/test/generate-int-range.test.ts` —— `generateProjection(evaluate(parseVfsl(FIXTURE).module).derived)` 生成文本含各字段的 `number` 投影（`a`/`b`/`c`/`d` 为 `number`；`e` 为 `number[]`），写入临时 `.ts` 后经仓内 `tsc-helper` 的 `preEmitDiagnostics` **0 条诊断**（镜像 #314 C4 装置；对 `int`/`range` 不得抛 `structure/value desync`）。
- **C6b**：`packages/vfsl/test/resolve-schema-at-path-int-range.test.ts` —— `resolveSchemaAtPath(derived, p)`：
  - `['b']` → `ok:true`、`valueSchema` 深等 `{kind:'int',min:1,max:100}`；
  - `['c']` → range 叶；`['a']` → `{kind:'int'}`；`['e']` → `{kind:'array',element:{kind:'int',min:0,max:9}}`；`['e',0]` → int 叶；
  - `['b','x']` → `ok:false`、`code:'SCHEMA_PATH_NOT_FOUND'`（标量叶不可下钻；**无新失败码**，ADR 决策 8）。
- **C6c**：`pnpm typecheck` 必须 0 错误 —— 新增 `ValueSchema` 成员使 `packages/namespace-runtime/src/read-schema-projection.ts::cloneValueSchema` 等无 default 的 switch 机械报缺；运行时投影（`PathValue` = `number`）由既有 namespace-runtime 类型面测试与 typecheck 覆盖（实现者若加投影 fixture，建议置于 `packages/namespace-runtime/test/`）。

### 12.8 C7 — 规范文档与实现同 PR（AC5 的文档面，ADR 0020 决策 10）

| 项 | 断言方式 |
| --- | --- |
| `docs/vfsl/v1-spec.md` §2 EBNF：新增 Int/Range 生产式（`IntType`/`RangeType` 或等价单产生式），`PrimaryType` 可达；`[]` 后缀结合规则说明 `number & Int<0, 9>[]` = 约束整数的数组 | `python3 tests/acceptance/vfsl_spec_acceptance.py` **G4/G5/G6 仍 GREEN（22/22）** |
| §2 交叉白名单句「`string & Pattern<"正则">`（唯一允许的交叉类型）」→ 四例（`string & Pattern<…>`、`number & Int`、`number & Int<…>`、`number & Range<…>`） | 人工评审 + 文档块机检 |
| §3 形状表「含 Pattern 约束」等标量形表述同步容纳 `int`/`range`（`YLeaf` 行、物化规则表） | 人工评审 |
| §4 保留名集合补 `Int`/`Range`（16→18）；E100 码表补 arity/浮点端点/空区间/裸用示例；判定顺序第 7 条既有措辞无需改语义 | 人工评审 + `spec-docs-anchor-m4-contract.test.ts` 的 D2/D3/D5 保持绿 |
| `docs/vfsl/schema-authoring-guide.md` §6 增数值约束章节（`>0` ≡ `Int<1, …>`、闭区间含端点、Int 端点整数限定）；「语法护栏」的「交叉类型（Pattern 特例除外）」四例化 | 人工评审 + 该测试 D3/D3b 文档块双 ok |
| 全仓旧措辞无残留 | `git diff --check` exit 0；`spec-docs-anchor` D5（`三锚位` needle）保持绿 |

### 12.9 C8 — 验证门禁（AC5）

实现完成后逐条给证据（命令 + 退出码 + 关键输出）：

1. `pnpm typecheck` → exit 0（14 工程；新 union 成员强制全 switch 站点接线）。
2. `pnpm test` → exit 0（HEAD 基线 348 files / 3721 tests；新文件自动入 vitest 与 CI 分片）。
3. `pnpm generate --check` → exit 0（`domains/vfs3-assets/generated.ts` 零漂移）。
4. `git diff --check` → exit 0。
5. `python3 tests/acceptance/vfsl_spec_acceptance.py` → exit 0（若改 spec）。
6. 焦点红灯→绿灯：
   `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test/parse-vfsl-int-range.test.ts packages/vfsl/test/validate-int-range.test.ts packages/vfsl/test/int-range-fixture-drift.test.ts packages/vfsl/test/resolve-schema-at-path-int-range.test.ts packages/vfsl-codegen/test/generate-int-range.test.ts --passWithNoTests=false`
   —— 实现前必须**红**（红在 C1/C3/C4/C6 目标断言：parse 步 E100 @ `&`），实现后必须**绿**；C2 负控组与 C5 漂移组实现前后均须**绿**。
7. 既有翻转用例：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test/validate-number-domain-narrowing.test.ts --passWithNoTests=false` → 改写后绿（`int`/`range` E301 负控 + `Int`/`Range` E100 新断言）。
8. 类型级（若加 `.test-d.ts`）：`NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck.only --passWithNoTests=false`。

### 12.10 突变敏感性矩阵（杀死弱实现）

| 弱实现 | 变红的契约项 |
| --- | --- |
| 只把 `number & Int` 白名单加入，裸用/别名占用不收窄 | B1~B4（E100）、B10/B11（E303）、B12（字段名 E100） |
| arity 检查缺失或宽松（`Int<5>` 当单点区间 / `Int<1,2,3>` 取前两参） | A1~A3（码 + 锚） |
| `Range` 无实参被当 `Int` 处理 | A5 |
| 端点用文本判定（`raw.includes('.')`）拒绝 `Int<1.0, 2>` | §12.11 B1 的设计冻结值（若设计裁定值判定则此实现红） |
| Int 端点只查左端点 / 只查首个违规 | A6/A7 锚列（首个违规记号） |
| 空区间不拒 / 用 `>=` 误拒单点区间 | A8/A9；P8/P9（单点区间正例红） |
| `-0` 端点放过（值判定写成文本判定或漏闸门） | A10/A11；A12（下溢形态另测） |
| 超双精度端点绕过有限性闸门 | A12 |
| IR 叶子键序/条件键不合规（补空槽、二次规范化、恒带 `min`/`max`） | C3（`Object.keys` 恰 `['kind']` / hasOwn 断言）+ C5 新指纹稳定 |
| derived 值树与结构树不同步（结构非 leaf / 值树缺 case） | C3 + C6a（desync）+ C8 typecheck |
| validate 只在 `validateValue` 补 case、漏 `contradictsInner` | C4g `{v:true}` 恰 2 条 issue |
| 只处理顶层字段、漏数组/联合/Record 值位 | C4b `e` 列、C4g、C1 全局位置 |
| 四值基线只查 `isInteger`（漏 `-0`）/ 漏 `Number.isFinite` | C4b `-0`/`NaN`/`±Infinity` 行 + C4d R2 |
| 失配短路（fail-fast、不收集）或误算预算 | C4e（101 条 = 100 + 截断标记） |
| 消息吞实际值 / 把 -0 显示成 "0" | C4d R2/R3 |
| codegen 叶子闸门未放行 / 发射非 `number` | C6a（desync 抛错 / tsc 诊断） |
| 投影侧新增拒绝路径或改写 valueSchema 形状 | C6b（透传深等 + `SCHEMA_PATH_NOT_FOUND` 既有码） |
| 改 `domains/vfs3-assets/**`、升 `sha256:v2:`、重排 IR 键序 | C5 全表 + C8 `generate --check` |
| 以 `skip`/软化断言/删既有用例过测试 | §12.0 纪律 + §10 既有用例翻转要求（SA4 复核） |

### 12.11 边界钉值项（ADR 未逐字钉死，**设计必须显式冻结**；本契约给出 SA6 建议）

| # | 边界 | SA6 建议（本契约默认） | 依据 | 若设计另裁 |
| --- | --- | --- | --- | --- |
| B1 | `Int` 端点的「整数」判定：值判定 vs 文本判定（`Int<1.0, 2>` / `Int<2.0, 3.0>`；含 f64 归一形态） | **值判定**：`Number.isInteger(tok.num)` ⇒ `Int<1.0, 2>` ok（`{kind:'int',min:1,max:2}`）；`Int<0.…01, 2>` 下溢为 0 亦按值 | ADR 0020 §3「字面量与区间端点一律按 f64 语义解释」；仓库数字判定先例为值判定（`-0` 闸门注释明确文本判定会漏下溢形态） | 文本判定则 C1 该例改 A 组负例（E100 锚 (1,36)）；其余用例不受影响 |
| B2 | 空区间（`min > max`）E100 的锚位 | **构造起点记号**（`Int`/`Range`，如 (1,32)） | 与 ADR §4 arity「锚定构造起点记号」同风格；`min>max` 是端点对的属性、非单点属性 | 若锚第二端点（如 (1,39)/(1,41)），只改 A8/A9 的期望列 |
| B3 | 复合违规优先级（arity + 端点形态 + 空区间同时命中） | arity 最先（解析期）→ 端点整数限定按**源序首个**违规记号 → 空区间最后 | 与解析推进顺序自然一致；A6/A7 已按「首个违规」钉 | 若改序，仅新增的复合用例受影响（契约 A 组均为单违规） |
| B4 | 非数字实参（`Int<"a", 1>` / `Int<1,>` 等）的锚位 | 锚该实参记号（镜像 Pattern 实参错误）；`Int<>` 按 arity 锚构造起点（A4） | ADR §4「与 Pattern 实参错误同码同锚位风格」+ 既有 parser 标点锚惯例 | 契约 A 组未含该例；设计冻结后补测 |
| B5 | E100 文案（四例白名单表述）与 Int/Range 失配措辞 | 文案自由，仅受 C2 码/锚与 C4d 内容不变量约束 | ADR 0020 决策 2「E100 文案更新」；ADR 0021 决策 3「消息文案不进冻结面」 | 不影响任何断言（契约不断言文案） |
| B6 | 联合成员硬矛盾模型（`contradictsInner` 对 `int`/`range` 是**类型级**「`typeof value !== 'number'` ⇒ 矛盾」还是**值级**「越界/非整数即矛盾」） | **类型级**（镜像 `pattern`，ADR 0020 决策 6「与 pattern 叶子同层」；越界/非整数按软失配报「最近成员」诊断） | `validate.ts:375-376` pattern 先例 vs `:373-374` enum 先例；探针 D 实测 enum 走值级、scalar 走类型级，两模型对 C4g `{v:true}` 均给 2 条 | 只影响 C4g `{v:5}` 的条数/文案（值级 → 2 条），C4g `{v:true}` 断言对两模型均成立 |

---

## 13. Red/green or baseline evidence

| 契约项 | HEAD 状态 | 说明 |
| --- | --- | --- |
| C1 正例（三形态 + 全局位置） | **红（真红）** | 探针 P1~P9/G1~G4：`ok:false` + E100 @ `&`/相应位置；任何 `ok:true`/IR 断言必红，红因 = 能力缺口本身 |
| C2 负例 A 组（arity/浮点端点/空区间/-0 端点/超域端点） | **红（码同锚异）** | HEAD 全部 E100 @ (1,30)（`&`）；契约锚在构造起点/违规记号，故按锚位断言必红 |
| C2 负例 B 组（裸用 E301→E100、E303、字段名 E100、E311/E306、第二段 `&`） | **红（码/锚异）** | B1~B4 HEAD E301；B10/B11 HEAD ok；B12 HEAD ok；B13 HEAD E100 @ (1,20)；B14 HEAD E100 @ (1,37)；B9 HEAD E100 @ (1,30)（目标锚 (1,41)） |
| C2 负控组（B5~B8 + 小写/近似名） | 绿（需保持） | HEAD 码/锚已符合（B8 只更新文案、不断言文案），实现后须零漂移 |
| C3 derived | **红** | 文本不可解析 ⇒ 断言链首步失败（前置 `parseVfsl` 携带实际 issues）；下游承载缺口已由 E2 证明 |
| C4 validate | **红** | 同上（文本不可达）；「未知 kind 静默放行」由 E3/E5 反证必须补 case |
| C5 指纹/漂移 | 绿（需保持） | §4 基线实测；实现后须逐字节不变 |
| C6 codegen/投影 | **红** | 文本不可达；codegen 对 int/range 叶抛 desync（E4），投影透传已绿（E6 须锁定） |
| C7 文档 | 部分红 | spec/guide 尚未含 Int/Range 生产式与保留名（ADR 0020 决策 10 要求同 PR） |
| C8 门禁 | 全绿 | §4 表（typecheck / 348 files·3721 tests / generate --check / diff --check / spec 22/22） |

**红灯根因确认**：C1/C3/C4/C6 的红是「parser 交叉白名单 + 全链无 `int`/`range` 承载」（直接故障点源码行 + 实测锚位 + 手工 IR 对照），**不是**环境、fixture、超时或测试入口错误——同一探针装置上 `string & Pattern`/`-1|1` 全绿（§6 N-3/N-13），全量基线与生成物门禁全绿（§4）。

---

## 14. Runner trigger evidence

- vitest 发现面（`vitest.config.ts`）：`include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts']`，`typecheck.include = ['packages/*/test/**/*.test-d.ts', …]`；新文件**无需改配置**即被发现。
- CI 分片器（`scripts/ci-test-shard.mjs`）：按磁盘枚举全部 `*.test.ts`（与 vitest include 同源）；新文件即使不在 `.github/ci/test-durations.json` 权重表也必然落入某分片、绝无静默漏跑；`*.test-d.ts` 由 CI typecheck 作业 `vitest run --typecheck.only` 集中执行。
- CI 另有显式门禁：`codegen-freshness` = `pnpm generate --check`；`contract-gates`（含 `domains-scaffold` 等）。
- 焦点入口实测（HEAD）：
  `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test/validate-number-domain-narrowing.test.ts packages/vfsl/test/parse-vfsl-containers-markers.test.ts packages/vfsl/test/number-literals-fixture-drift.test.ts --typecheck.enabled=false --passWithNoTests=false`
  → exit 0，`3 files / 87 tests passed`（690ms）——证明该目录测试器工作正常，且 §10 明列的既有断言当前为绿。
- 全量入口实测（HEAD）：`pnpm test` → 348 files / 3721 tests / no type errors / exit 0（599s）；`pnpm typecheck` exit 0；`pnpm generate --check` exit 0；`git diff --check` exit 0；spec 机检 22/22 GREEN。

---

## 15. Unknowns and blockers

- **U1（非阻塞，设计钉值项）**：§12.11 B1~B4 四项边界（`Int<1.0, 2>` 的值/文本判定、空区间锚位、复合违规优先级、非数字实参锚位）ADR 未逐字钉死。契约已给 SA6 默认值与依据；设计须在实现前显式冻结，冻结结果只影响对应单例的期望列，不改变红灯根因与整体契约。
- **U2（已裁定，登记备查）**：#314 SA6 §15-U2 悬置的指纹 v2 触发器（「放开数值字面量语法」）在本票的延伸问题——新增 IR 叶子种类是否触发。ADR 0020 决策 1 明确**不引入 v2 方言**（§8 窄例外）、决策 5 明确既有指纹全部不变；envelope/semantic 域文档形态未变（§4 实测逐字节等于既有钉值）⇒ 本契约按**保持 `sha256:v1:`、既有指纹零漂移**钉死。若 owner 另裁升版，须另立 ADR 决策并重估全仓指纹，不得由实现者静默升版。
- **U3（非阻塞，范围边界）**：`validate-patch` 写路径无独立实现（共享 `validateSubtree`），契约只以 C4f 单例锁定同口径；若实现另起旁路，C4f 会红。
- **U4（非阻塞，测试命名）**：§10 建议的测试文件名为 SA6 推荐；实现者可在同 include 面内改名，但禁用 `skip`/软化；`validate-number-domain-narrowing.test.ts` 的 AC7 翻转是**必达项**，不可删除该 describe 规避。
- **U5（已接受的行为，非缺陷）**：`Int<1.0, 2>` 若按值判定接受，IR 中 `min=1` 与 `a: number & Int<1, 2>` 的 IR 完全相同——端点字面量形态不进 IR（ADR 决策 5 只保留数值语义），指纹不区分写法。这与字面量「f64 归一」既有语义一致。
- **阻塞项**：无。环境（离线依赖可装、探针可跑、门禁基线全绿）与事实（锚位/码位/下游承载缺口）均足以建立可执行契约。

---

## 16. Temporary diagnostics cleanup

- 全部临时探针与输出位于未跟踪目录 **`.sa6-tmp/`**（`probe-a-parse.ts`、`probe-a2-pattern-anchors.ts`、`probe-a3-continuation.ts`、`probe-a4-shapes.ts`、`probe-b-chain.ts`、`probe-b2-chain.ts`、`probe-c-baseline.ts`、`probe-d-union.ts` 及 `*.out`），**收尾前整目录删除**（已执行，证据见下方 Cleanup verification；Appendix A 为删除前的实测摘录）；`git status --short` 仅余 Host 产物 `?? wiki/raw/task_issue-315.md` 与本报告。
- 未修改任何生产实现、测试、fixture、生成物、依赖清单；未改动 `domains/vfs3-assets/**`；未启动任何常驻服务/端口（全部门禁为前台命令或 `run_in_background` Job，均已收束）；未使用 nohup/setsid/PID 文件/轮询 marker。
- 清理证据：见本报告末尾「Cleanup verification」。

---

## Appendix A — 探针原始输出（HEAD，关键摘录）

> 探针脚本与 `*.out` 已按 §16 在证据留档后删除；以下为删除前实测输出摘录。

```
# .sa6-tmp/probe-a-parse.ts（两轮 diff 为空）
P1  number & Int<1, 100>      ok:false VFSL-E100: 交叉类型仅允许 string & Pattern<…> @ (1,30)
P2  number & Int              ok:false … @ (1,30)
P3  number & Range<0, 1>      ok:false … @ (1,30)
P4  number & Range<0.5, 1.5>  ok:false … @ (1,30)
P5  number & Range<-40, 85>   ok:false … @ (1,30)
P6  number & Int<-10, 10>     ok:false … @ (1,30)
P7  number & Int<0, 9>[]      ok:false … @ (1,30)
P8  number & Int<1, 1>        ok:false … @ (1,30)
P9  number & Range<0, 0>      ok:false … @ (1,30)
G1  别名 RHS                   ok:false … @ (1,17)
G2  Record 值位                ok:false … @ (1,45)
G3  YLeaf 实参                 ok:false … @ (1,36)
G4  对象字段                   ok:false … @ (1,30)
N1  Int<5> arity              ok:false … @ (1,30)
N2  Int<1,2,3> arity          ok:false … @ (1,30)
N3  Range<0> arity            ok:false … @ (1,30)
N4  Int<> arity               ok:false … @ (1,30)
N5  number & Range            ok:false … @ (1,30)
N6  裸 Int                    ok:false VFSL-E301: 未知名引用: Int @ (1,23)
N7  裸 Int<1, 2>              ok:false VFSL-E301: 未知名引用: Int @ (1,23)
N8  裸 Range                  ok:false VFSL-E301: 未知名引用: Range @ (1,23)
N9  string & Int<1,2>         ok:false … @ (1,30)
N10 boolean & Int<1,2>        ok:false … @ (1,31)
N11 number & Pattern<"a">     ok:false … @ (1,30)
N12 number & string           ok:false … @ (1,30)
N13 Int<0.5, 1>               ok:false … @ (1,30)
N14 Int<1, 2.5>               ok:false … @ (1,30)
N15 Int<5, 1>                 ok:false … @ (1,30)
N16 Range<1, 0>               ok:false … @ (1,30)
N17 number & Int<1,2> & string ok:false … @ (1,30)
N18 type Int = number;        ok:true  fieldType={"kind":"primitive","name":"number"}
N19 type Range = number;      ok:true  fieldType={"kind":"primitive","name":"number"}
N20 字段名 Int                ok:true  fieldType={"fields":["Int"]}
N21 字段名 Pattern            ok:false VFSL-E100: 字段名位保留名: Pattern @ (1,20)
C1  type int = number;        ok:true  fieldType={"kind":"ref","name":"int"}
C2  type Integer = number;    ok:true  fieldType={"kind":"ref","name":"Integer"}
C3  type Range2 = number;     ok:true  fieldType={"kind":"ref","name":"Range2"}
C4  -1 | 1                    ok:true  union [-1,1]
C5  .5                        ok:false VFSL-E100: 未知记号: . @ (1,23)
C6  -0                        ok:false VFSL-E100: 数字字面量 -0 不在可写值域…；请改写为 0 @ (1,23)
C7  string & Pattern<"a">     ok:true  fieldType={"kind":"pattern","regex":"a"}

# .sa6-tmp/probe-b-chain.ts（手工 IR/derived，绕过 parser）
B1 evaluate(手工 IR 含 int leaf)            ok:true，但 derived.values.ROOT.fields[0]={"name":"v"}（无 value 键）
B2 validate int 边界/越界/非整数/-0/NaN/±Inf/"1"  ok:true（14/14 全放行）
B3 validatePatch v=101 / 1.5 / NaN          ok:true（3/3 全放行）
B4 resolveSchemaAtPath ["v"]                ok:true, valueSchema={"kind":"int","min":1,"max":100}
B5 generateProjection(手工 derived 含 int/range)  THREW: structure/value desync at ROOT.v (structure=leaf, value=int)
B6 对照 scalar number v=101                 ok:true
B6 对照 scalar number v=NaN                 ok:false {"message":"期望 number（有限数且非 -0），实际 NaN","path":["v"]}
B7 parseVfsl(正例文本)                       [{"message":"VFSL-E100: 交叉类型仅允许 string & Pattern<…>","line":1,"column":30}]

# .sa6-tmp/probe-b2-chain.ts
B8 generateProjection(int/range/裸 int)     均 THREW desync（structure=leaf, value=int|range）
B9 union (number&Int<1,3>) | string         v=1.5/5/2/"abc"/true 全 ok:true（承载缺口）
B10 array int<0,9>[] v=[1,2,10]/[1,2,3]/[1,"2"] 全 ok:true（承载缺口）
B11 resolveSchemaAtPath []/["v"]/["v","x"]/["missing"]  透传 ok / NOT_FOUND / NOT_FOUND

# .sa6-tmp/probe-c-baseline.ts（两轮 diff 为空）
list = ["vfs3-assets@1"]
envelopeFingerprint = sha256:v1:7b6c19cbac93cbf104c055c320b5e4a5ba72e0db87342de0853c68bedff53f39
semanticFingerprint = sha256:v1:b71be76e3d3579670236b14a36373716db6238d86a15da440f44aecbb9b0631c
generated.ts sha256 = 342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707
schema.vfsl \bInt\b / \bRange\b = 0 / 0
alias Int 声明 => ok:true ; alias Range 声明 => ok:true ; 字段名 Int => ok:true
字段名 Pattern => [{"message":"VFSL-E100: 字段名位保留名: Pattern","line":1,"column":20}]

# .sa6-tmp/probe-d-union.ts（联合三段算法分支校准）
无候选分支 v=true => {"ok":false,"issues":[{"message":"不匹配任何联合成员（any-of 全拒绝）：失败距离最小的成员为联合成员 1/2（距离 1）","path":["v"]},{"message":"类型不匹配：期望 number，实际 boolean","path":["v"]}]}
number|string v=5 => {"ok":true}
唯一候选软失败（enum[2]|string）v=5 => 2 条（enum 走值级矛盾 ⇒ 无候选分支）；即 §12.11 B6 两模型在 `{v:true}` 上同形，在 `{v:5}` 上分叉
```

## Cleanup verification

- 收尾执行：`rm -rf .sa6-tmp` → 目录不存在；`git status --short` 输出仅 `?? wiki/raw/task_issue-315.md` 与本报告；`git diff --stat` 空（零生产/测试/fixture/生成物改动）。
- 无后台 Job 遗留；无监听端口/常驻进程（全部命令前台返回或 Job 已 `completed`）。

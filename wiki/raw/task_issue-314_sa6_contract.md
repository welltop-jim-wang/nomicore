# SA6 诊断与验收契约 — issue #314：VFSL 数字字面量拓宽（负号与小数，ADR 0020 决策 3）

- 任务类型：**Feature**（能力缺口 + 验收契约；不虚构 Bug 根因）。也含"纯拓宽不得回归"的回归契约面。
- HEAD：`29ff10f843a4d877866e963cedc8766d60194d33`（分支 `mabf/issue-314`）
- SA6 模式：**contract-only**（派工明文"不得实现代码或测试"）——本报告是唯一交付物；
  红灯证据由 HEAD 上的最小复现探针给出，测试由 SA3 按 §12 契约落地。
- 结论：`verdict: approve`（能力缺口可稳定复现、根因链可证、契约可执行、测试入口真实）。

---

## 1. Task type and inputs

| 输入 | 路径 | 状态 |
| --- | --- | --- |
| Host 任务简报 | `wiki/raw/task_issue-314.md` | 存在（33 行）；无 owner comments（正文 `## Comments` 为空） |
| relevant_decisions | `wiki/raw/task_issue-314_relevant_decisions.md` | **不存在**（本任务未生成） |
| conflict_report | `wiki/raw/task_issue-314_conflict_report.md` | **不存在**（本任务未生成） |
| SA8 产物（design / spec review / AC checklist） | `wiki/raw/task_issue-314_*` | **不存在**（除简报外无 314 产物）——非阻塞，契约以 ADR + spec + 源码为准 |
| 规范文档 | `docs/adr/0020-vfsl-number-constraints.md`（已接受，决策 3 即本 issue 依据）、`docs/vfsl/v1-spec.md`、`docs/vfsl/schema-authoring-guide.md` | 存在 |
| 模块规约 | `packages/vfsl/AGENTS.md`、`packages/vfsl-codegen/AGENTS.md`、`docs/AGENTS.md`、根 `AGENTS.md` | 存在 |

**范围界定（据简报正文）**：数字字面量从 `[0-9]+` 拓宽为 `-? [0-9]+ ('.' [0-9]+)?`，全局生效，
端到端（解析 → IR → derived → validate → codegen）。**不含** `number & Int` / `number & Range`
语法（ADR 0020 的其余决策；`Int`/`Range` 当前仍是普通标识符，`number & Int` 走既有 E100 交叉白名单路径）。
**不含** 运行时 number 基线收窄（NaN/±Infinity/-0 的运行期拒绝，归 ADR 0021 / issue #312；
ADR 0021 正文在本仓 **不存在**，仅 ADR 0020 决策 9 的 supersede 标注转述其存在）。

约束：SA6 不得修改生产实现；本报告不实现任何测试或代码。

---

## 2. Owner comment mapping

- Issue #314 的 comments 读取返回空数组（派工单已确认）；正文 `## Comments` 亦为空。
- 因此**没有**超出简报正文的 owner 追加要求；验收基线 = 简报 5 条 Acceptance criteria。
- 与仓库事实的映射（简报 AC → 契约条目）：

| 简报 AC | 契约条目 |
| --- | --- |
| 负整数、小数字面量可作联合成员并通过 validate 枚举判定（f64 严格相等） | C1（parse/IR）、C3（evaluate/validate） |
| `.5` / `1.` / `1e3` / 裸 `-` 各负例维持 E100 及正确锚位 | C2 |
| 超双精度字面量（含负值）E100 | C2（negative domain gate） |
| 既有 fixture 语义指纹零漂移；codegen 对浮点/负字面量联合发射合法 TS | C5（drift）、C4（codegen） |
| 包测试、typecheck、`git diff --check` 全绿 | C7（验证门禁） |

---

## 3. SA8 constraints

本 dispatch 无 SA8 产物。可执行约束全部来自既有规范与 CI，逐条列为契约硬约束：

1. `packages/vfsl/AGENTS.md`：错误码、issue 顺序、行列定位、指纹输入是兼容性行为（**不得变更**）；
   parser/evaluator/validate 同步、确定、公共畸形输入返回判别结果而非抛出；IR/派生 schema 为
   环境无关、可 JSON 序列化的纯数据。
2. `packages/vfsl-codegen/AGENTS.md`：输出确定、逐字节稳定，`pnpm generate --check` 必须检出
   任何陈旧生成物而不改写已接受源码；不得在生成器里重新推导 VFSL 语义。
3. `docs/AGENTS.md`：代码行为变化必须同步更新所有陈述该契约的规范文档；**不得发明实现行为**。
4. ADR 0020：决策 3（文法拓宽、负号紧邻、`.5`/`1.`/指数 E100、f64 语义、超双精度沿既有路径）、
   决策 5（IR 不变 ⇒ 既有语义指纹全部不变）、决策 7（codegen 生成 `number`，`generate --check`
   字节稳定基线不变）、决策 10（spec 与实现同 PR；明确不做指数记号）。
5. `packages/vfsl/src/fingerprint.ts` 头注 D2 契约标记：`FINGERPRINT_PREFIX` 与域文档形态是
   v1 冻结输入，**§15 未知项 U2** 专门讨论本 issue 是否触发其 v2 升级触发器。
6. CI 门禁（`.github/workflows/ci.yml`）：`pnpm typecheck`；`vitest run --typecheck.only`
   （`*.test-d.ts`）；6 分片 `*.test.ts`（分片表由磁盘枚举，新文件自动入片）；
   `codegen-freshness` = `pnpm generate --check`。

---

## 4. Environment and baseline

环境：Linux；Node `v24.13.0`；pnpm `10.28.2`；依赖经 `pnpm install --frozen-lockfile --offline`
从本地 store（v10）恢复成功（零网络）。探针经 `NODE_OPTIONS=--conditions=nomicore-source` +
仓内 `tsx` 直接消费 `packages/vfsl/src`（无构建产物依赖）。

HEAD 基线（全部在未改动的 worktree 上取得）：

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 依赖 | `pnpm install --frozen-lockfile --offline` | exit 0（65 包全部 reused） |
| 全量类型检查 | `pnpm typecheck` | **exit 0**（14 个 tsc 工程） |
| 全量测试 | `pnpm test`（`vitest run --typecheck`） | **exit 0**：`Test Files 319 passed`、`Tests 3383 passed`、`Type Errors no errors`，耗时 607s |
| 生成物新鲜度 | `pnpm generate --check` | **exit 0**（`domains/vfs3-assets/generated.ts` 字节新鲜） |
| diff 卫生 | `git diff --check` | **exit 0**（无输出） |
| 规格文档机检 | `python3 tests/acceptance/vfsl_spec_acceptance.py` | **GREEN 22/22，exit 0**（G4 EBNF 结构合法、G6 语法要素齐备均绿） |
| 焦点测试器 | `NODE_OPTIONS=… pnpm exec vitest run packages/vfsl/test/parse-vfsl-errors.test.ts --typecheck.enabled=false --passWithNoTests=false` | exit 0，19/19 通过（含第 58 行"负数字面量 E100"旧断言） |

既有 fixture 指纹基线（`FileSchemaSource(repoRoot).load('vfs3-assets@1')` → `compileSchemaEnvelope`）：

| 量 | HEAD 基线值 |
| --- | --- |
| `FileSchemaSource.list()` | `["vfs3-assets@1"]` |
| `envelopeFingerprint` | `sha256:v1:7b6c19cbac93cbf104c055c320b5e4a5ba72e0db87342de0853c68bedff53f39` |
| `semanticFingerprint` | `sha256:v1:b71be76e3d3579670236b14a36373716db6238d86a15da440f44aecbb9b0631c` |
| `domains/vfs3-assets/generated.ts` sha256 | `342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707` |

---

## 5. Positive reproduction（能力缺口稳定复现）

规范探针模块（下文 C1/C2 的锚位全部以此形状计；类型表达式起点 = 第 **23** 列）：

```
type ROOT = YMap<{ v: <FORM> }>;
```

HEAD 实测（探针 P1/P6，两次运行逐字节一致）：

| `<FORM>` | HEAD 实际 | 目标行为 |
| --- | --- | --- |
| `-1` | `VFSL-E100: 未知记号: -` @ (1,23) | ok；IR literal `-1` |
| `-1 \| 1` | E100 @ (1,23) | ok；union `[-1, 1]` |
| `0.5` | `VFSL-E100: 未知记号: .` @ (1,24) | ok；IR literal `0.5` |
| `0.5 \| 1.5` | E100 @ (1,24) | ok；union `[0.5, 1.5]` |
| `-0.5` | E100 @ (1,23) | ok；IR literal `-0.5` |
| `0.1 \| 0.2` | E100 @ (1,24) | ok；union `[0.1, 0.2]` |
| `00.5` | E100 @ (1,25)（`0` 记号后 `.` 未知） | ok；IR literal `0.5`（前导零已是合法形态：`00` HEAD 即 ok） |
| `-9007199254740993` | E100 @ (1,23) | ok；IR literal `-9007199254740992`（f64 舍入，与无符号 `9007199254740993` → `9007199254740992` 同规则） |
| `0.99999999999999999` | E100 @ (1,24) | ok；IR literal `1`（f64 舍入，非拒绝） |
| `-0.` + `'0'×322` + `1` | E100 @ (1,23) | ok；IR literal `-1e-323`（次正规、非 -0） |
| `-` + `'9'×308` | E100 @ (1,23) | ok；IR literal `-1e+308`（有限） |

其他**全局位置**（"字面量子集是全局规则、不做上下文特判"，ADR 0020 决策 3）：

| 模块 | HEAD 实际 | 目标行为 |
| --- | --- | --- |
| `type A = -1 \| 0.5; type ROOT = YMap<{ v: A }>;` | E100 @ (1,10) | ok（别名 RHS） |
| `type ROOT = YMap<{ v: -1 }>;` | E100 @ (1,23) | ok（对象字段） |
| `type ROOT = YMap<{ v: -1[] }>;` | E100 @ (1,23) | ok（数组元素字面量） |
| `type ROOT = YMap<{ v: YLeaf<-1> }>;` | E100 @ (1,23) | ok（YLeaf 实参） |
| `type ROOT = YMap<{ v: YArray<0.5> }>;` | E100 @ (1,24) | ok（YArray 实参） |
| `type ROOT = YMap<{ v: Record<string, -1 \| 0.5> }>;` | E100 @ (1,33) | ok（Record 值位） |
| `type ROOT = YMap<{ v: Record<-1, string> }>;` | E100 @ (1,23) | **E306** @ (1,30)（字面量被识别为数值形，键形违规——非 E100） |
| `type ROOT = YMap<{ v: -1 & string }>;` | E100 @ (1,23) | E100 @ (1,25)（交叉白名单锚 `&`；与无符号 `1 & string` @ (1,25) 同锚） |
| `type ROOT = -1 \| 0.5;` | E100 @ (1,13) | **E311** @ (1,13)（scalar ROOT 形；与无符号 `type ROOT = 1 \| 2;` 同码同锚） |

**下游链已具备能力（缺口定位证据）**：手工构造等价 IR（绕过 tokenizer/parser）——
`ROOT = YMap<{ v: -1 | 0.5 | 2 }>` 的 IR → `evaluate` 产出
`{"kind":"object","fields":[{"name":"v","value":{"kind":"enum","values":[-1,0.5,2]}}]}`；
`validateLogicalSnapshot` 对 `-1`/`0.5`/`2` 全 ok，对 `1`/`0.5000000000000001`/`2.0000000000000004` 报
`值不在枚举内：期望 -1 | 0.5 | 2，实际 number …`、`path: ["v"]`。
同构的无符号等价矩阵（`YLeaf<1>`、`YArray<1>`、`1[]`、`Record<string,1|2>`、别名 RHS `1|2`）
在 HEAD **全绿**（parse → evaluate → validate 端到端）。故缺口只在"记号扫描把 `-`/`.` 判为未知字符"，
post-parse 链无需为负号/小数做任何新语义。

---

## 6. Negative control（相近负例，HEAD 已绿，必须保持）

全部在规范模块形状下实测；"HEAD"列为当前行为，"目标"列为契约要求：

| `<FORM>` / 模块 | HEAD 实际 | 目标（必须保持） |
| --- | --- | --- |
| `.5` | E100 @ (1,23) `未知记号: .` | 同（小数点两侧 digits 必填） |
| `1.` | E100 @ (1,24) `未知记号: .` | 同 |
| `1e3` | E100 @ (1,24) `期望字段分隔符 ';' 或 ','，实际 标识符 'e3'` | 同（指数记号不做） |
| `1..5` | E100 @ (1,24) `未知记号: .` | 同 |
| `-` | E100 @ (1,23) `未知记号: -` | 同（裸 `-` 维持未知字符延迟错误记号路径） |
| `- 1` | E100 @ (1,23) `未知记号: -` | 同（负号须与数字**紧邻**；空白不得被吞） |
| `-/*c*/1` | E100 @ (1,23) | 同（trivia 不得被吞） |
| `-.5` | E100 @ (1,23) | 同（`.` 后必须 digit） |
| `--1` | E100 @ (1,23) | 同 |
| `-0` / `-0.0` / `-00` | E100 @ (1,23) | E100 @ (1,23)，消息引导写 `0`（ADR 0020 决策 3 的 ADR 0021 修订句） |
| `-0.` + `'0'×323` + `1`（f64 下溢为 **-0**） | E100 @ (1,23) | E100 @ (1,23)（**值判定** `Object.is(num,-0)`，非文本判定） |
| `-0.` + `'0'×400` | E100 @ (1,23) | E100 @ (1,23) |
| `'9'×309`（无符号超域） | E100 @ (1,23) `数字字面量超出可序列化数值域（双精度上限 ≈1.8e308；实现值域上限，非方言判定）` | 同（既有 `compile-schema-envelope-sentinel` RT-2 锚） |
| `-` + `'9'×309`（负超域） | E100 @ (1,23) `未知记号: -` | **E100 @ (1,23)，消息前缀同上**（沿 §7.3 既有路径） |
| `1e999`（sentinel RT-2） | ok:false，E 码 + 行列 | 同（不得静默接受） |

**已登记的锚位变化（唯一一处，非回归）**：`-1e3` HEAD 锚 `-` @ (1,23)；拓宽后 `-1` 是合法记号，
锚必然落在 `e3` @ (1,**25**)，`1e3` 锚 `e3` @ (1,24)——两者同构（同码 E100、同消息类别）。
契约按"拓宽后锚 `e3`"钉死，禁止实现者用特判把 `-1e3` 拉回 `-` 锚。

---

## 7. Stability, scale and timing

- 全链路为同步纯函数（`packages/vfsl/AGENTS.md`），无并发、无线程、无时钟依赖、无 IO（探针除
  `FileSchemaSource` 的确定性文件读）；不适用重复次数/概率口径。
- **确定性证据**：规范锚位探针（P6）连续两次运行输出 `diff` 为空（逐字节一致）。
- **规模边界**（数值域，非性能）：无符号 `'9'×308` 有限（ok）、`'9'×309` = Infinity（E100）；
  负号只改符号不改量级判定（`'-'+'9'×308` 有限；`'-'+'9'×309` 超域）。403 字符长字面量的
  扫描/判定无异常（`-0.` + 400 个 0 实测可达）。
- 资源风险：记号扫描已是 O(文本长度)；本 issue 不引入回溯、正则引擎或预算路径，无需性能基线曲线。

---

## 8. Root-cause chain / capability gap

| Step | Fact | Evidence | Confidence |
| --- | --- | --- | --- |
| 症状 | `type ROOT = YMap<{ v: -1 \| 0.5 }>;` → `ok:false` | P1/P6 实测：E100 @ (1,23) `未知记号: -` | 确定 |
| 直接故障点 | tokenizer 数字分支只接受 `[0-9]+`；`-`、`.` 落入文件末段"未知字符 → E100"分支并 `break scan` | `packages/vfsl/src/tokenizer.ts:200-215`（数字分支）、`:276-278`（未知字符）；`PUNCT` 集合不含 `-`/`.`（`:47`） | 确定 |
| 触发条件 | 意图表达负号或小数（任何类型位置：联合成员、字段、标记实参、Record 值位等） | P1/P4 位置矩阵 | 确定 |
| 最深根因 | **能力缺口**：v1-spec §2 注记 7 当时冻结"仅无符号十进制整数"，tokenizer/parser 据此实现；ADR 0020 决策 3 已裁决拓宽但实现未落地 | `docs/vfsl/v1-spec.md:63,83-84,118,358`；`docs/adr/0020-vfsl-number-constraints.md:88-108` | 确定 |
| 缺口边界 | post-parse 链（IR literal 数字 / derived enum / validate 严格相等 / codegen `String(number)`）**已支持**负值与小数的 f64 表示 | 手工 IR 探针 P3-D：enum `[-1,0.5,2]` 全链绿；无符号等价矩阵 P7 全绿 | 确定 |
| 放大因素 | 无（parse 阶段 loud 失败，无静默变形）。若未来实现放过 `-0`：`JSON.stringify(-0) === "0"`，IR/语义指纹层会把 -0 静默坍缩为 0（假失效方向） | `node -e "JSON.stringify({v:-0})"` → `{"v":0}`；`packages/vfsl/src/fingerprint.ts:47-57` canonical JSON | 确定 |
| 未证实假设 | 无关键假设。`analyze` 相位对新字面量无额外规则（E306/E311 均按既有形状规则裁决）已由无符号等价形与手工 IR 覆盖 | §5/§6 实测 | 高 |

---

## 9. Causal experiments

| # | 实验 | 控制变量 | 观察 | 结论 |
| --- | --- | --- | --- | --- |
| E1 | 手工构造 IR（绕过 tokenizer/parser）→ `evaluate` → `validateLogicalSnapshot` | 只换数值，不换结构 | enum `[-1,0.5,2]`；`-1`/`0.5`/`2` ok；`1`/`0.5000000000000001`/`2.0000000000000004` 拒 | 缺口定位在**文本记号层**；下游无需改动 |
| E2 | `Number()` 对 15 个原文形态求值 | 同一原语（实现将复用） | `-0`/`-0.0`/`-00`/`-0.0…0`(400)/`-0.0×323 1` 均为 **-0**；`-0.0×322 1` = `-1e-323`；`'-'+'9'×309` = -Infinity；`-9007199254740993` = `-9007199254740992`；`0.99999999999999999` = 1 | 值域判定必须用 `Number.isFinite` + `Object.is(v,-0)`；精度丢失是 f64 语义而非拒绝条件 |
| E3 | 无符号等价矩阵（`1`/`1\|2`/`YLeaf<1>`/`YArray<1>`/`1[]`/`Record<string,1\|2>`/别名 RHS）全链 | 与目标正例只差符号/小数 | HEAD 全绿（parse/evaluate/validate） | 目标行为的"期望结果"不是新语义 |
| E4 | 候选 EBNF 文本送 `tests/acceptance/vfsl_spec_acceptance.py` 的 `EbnfValidator`（同源调用） | 候选：`NumberLiteral = [ "-" ], digit, { digit }, [ ".", digit, { digit } ] ;` | 候选 0 错误；现行文法 0 错误 | 文档侧契约可执行（G4 不会因改写而红） |
| E5 | 手工 IR → `generateProjection` → 写临时 `.ts` → `tsc-helper.preEmitDiagnostics` | 含 `-1 \| 0.5 \| 2` 与 `0.0000001` | 发射 `PathSchema<-1 \| 0.5 \| 2, 'leaf'>`、`PathSchema<1e-7, 'leaf'>`；**tsc 诊断 0** | 生成物是合法 TS；`1e-7` 形态合法（非 VFSL 可回读，但不要求回读） |
| E6 | 下溢边界扫描 k=318..326（`-0.` + `'0'×k` + `1`） | 只有位数变 | k≤322 → 非零有限；k≥323 → -0 | 给出"值判定 vs 文本判定"的判别性用例对 |
| E7 | 确定性：P6 连续两次运行 | 同输入 | `diff` 空 | 无时序/状态依赖 |

---

## 10. Impact surface

**预期实现面（SA3 辖域，供 SA4 复核范围）**

| 文件 | 预期改动 |
| --- | --- |
| `packages/vfsl/src/tokenizer.ts` | 数字分支：`-`（仅后随 digit 时）+ `[0-9]+` + 可选 `.`（仅后随 digit 时）+ `[0-9]+`；记号 `value` 保留原文（含 `-`），`num = Number(value)`；文件头注释与 `:276` 未知字符示例中的 `-`/`.` 说明同步修正 |
| `packages/vfsl/src/parser.ts` | 数字字面量分支：既有 `!Number.isFinite(tok.num)` E100 保留；新增 `Object.is(tok.num,-0)` → E100 锚该记号（消息引导写 `0`）。若把 -0 判定合并进同一闸门亦可 |
| `docs/vfsl/v1-spec.md` | §2 EBNF `NumberLiteral`（第 63 行）、§2 注记 7（83-84）、§2 微示例（118：`type C = -1 \| 1;` 不再是 E100）、§4 E100 码表行（358："负数 / 小数字面量"须移出越界示例，改为 `-0`/`.5`/`1.`/指数记号） |
| `docs/vfsl/schema-authoring-guide.md` | 第 145 行"数字字面量仅支持无符号十进制整数"改写 |

**必须不变（回归红线）**

- `packages/vfsl/src/ir.ts`、`evaluate.ts`、`derived.ts`、`validate.ts`、`resolve-schema-at-path.ts`、
  `fingerprint.ts`、`packages/vfsl-codegen/**`：**零语义改动**（E1/E3/E5 证据）。
- `domains/vfs3-assets/schema.vfsl`、`domains/vfs3-assets/generated.ts`：**逐字节不变**
  （§4 指纹/哈希基线 + `pnpm generate --check`）。
- `FINGERPRINT_PREFIX = 'sha256:v1:'`：不得升版（见 §15-U2 的决策悬置）。
- 既有负例锚位（§6）除已登记的 `-1e3` 一处外零漂移；`compile-schema-envelope-sentinel.test.ts`
  RT-2 数值闸门、`spec-docs-anchor-m4-contract.test.ts` 文档锚不得弱化。

**测试面**

- 新增：`packages/vfsl/test/parse-vfsl-number-literals.test.ts`、
  `packages/vfsl/test/validate-number-literals.test.ts`、
  `packages/vfsl/test/number-literals-fixture-drift.test.ts`、
  `packages/vfsl-codegen/test/generate-number-literals.test.ts`（+ 建议 `.test-d.ts`）。
- **必须修改（语义翻转，非弱化）**：`packages/vfsl/test/parse-vfsl-errors.test.ts:58`
  （现断言 `parseVfsl('type A = -1;')` → E100 @ (1,10)；拓宽后该文本 → **E310** @ (1,1)。
  该用例须替换为 C1 的正例锚，并保留 `-0`/`.5`/`1.`/裸 `-` 负例锚）。

---

## 11. Ruled-out hypotheses

| # | 假设 | 排除证据 |
| --- | --- | --- |
| H1 | "IR/derived/validate 无法表示负/小数枚举，需要改动" | E1 手工 IR 全链绿；无符号等价矩阵 E3 绿 → 只需文本层 |
| H2 | "codegen 对负/小数字面量会发射非法 TS（如 `--1` 或精度丢失字符串）" | E5：`PathSchema<-1 \| 0.5 \| 2,'leaf'>`、`PathSchema<1e-7,'leaf'>` 经仓内 TS 编译器 0 诊断 |
| H3 | "拓宽必然导致既有语义指纹漂移" | 既有 fixture IR 规范 JSON 不含符号/小数字面量，IR 类型族零新增（ADR 0020 决策 5）；指纹基线在 §4 钉死，`generate --check` 绿 |
| H4 | "`1e3` 的负形锚该保持在 `-`" | 拓宽后 `-1` 是合法记号，`-1e3` 与 `1e3` 同构（E100 锚 `e3`）；强行保持 `-` 锚需要特判，违反"字面量全局规则、不做上下文特判" |
| H5 | "`-0` 可以放行、按 f64 与 0 严格相等" | ADR 0020 决策 3 已由 ADR 0021 决策 2 修订为解析期 E100；且放行会使 `JSON.stringify(-0)→"0"` 在 IR/指纹层静默坍缩（§8 放大因素） |
| H6 | "#314 需要同时拒绝运行时 -0（枚举成员或裸 number）" | 简报 AC 只要求"`-0` **字面量**解析期 E100"；`packages/vfsl/src` 运行期零 `Object.is(...,-0)`/有限性基线代码（grep 证据）；ADR 0021 正文不在仓内，运行期收窄归 issue #312。C3 明确列为**非目标**，避免错因红灯 |
| H7 | "`00`/`00.5` 应被拒绝（前导零非法）" | 文法 `[0-9]+` 未禁止前导零，`00` 在 HEAD 已 ok（P6）；契约把 `00.5` 列为正例以钉死"不额外收窄" |

---

## 12. Acceptance contract and test paths

### 12.0 契约测试总则（防伪红/伪绿）

1. 断言只观察公共接缝：`parseVfsl`、`evaluate`、`validateLogicalSnapshot`、`compileSchemaEnvelope`、
   `FileSchemaSource`、`generateProjection`（codegen 产物文本即产品，允许对生成物文本断言，但必须
   再经真实 TS 编译证明"合法 TS"）。禁止 grep 源码/正则断言实现形状。
2. 正例必须使用 **声明 ROOT 的完整模块**：`parseVfsl` 含语义相位，`type A = -1;` 在拓宽后是
   **E310**（缺 ROOT），不是正例；同理 `type ROOT = -1 | 0.5;` 是 E311。
3. 禁止 `skip`/`only`/`todo`/`failing`、env 开关、fallback、吞错、软化断言；禁止改动
   `domains/vfs3-assets/**` 与指纹前缀来"过测试"。
4. 负例断言必须同时钉 **错误码 + 行列锚**（只断言 `ok:false` 不足以杀死过宽实现）。

### 12.1 规范模块与锚位约定

```
MODULE(FORM) := `type ROOT = YMap<{ v: ${FORM} }>;`
类型表达式起点 = (1,23)
```

### 12.2 C1 — 正例：负/小数字面量全局可解析（红 → 绿）

测试文件：`packages/vfsl/test/parse-vfsl-number-literals.test.ts`（导入 `../src/index.js`）。
断言 `parseVfsl(MODULE(FORM))` → `ok:true`，并断言 IR 中的字面量**值**（`module.aliases` 内
`{kind:'literal', value}` / `union.members`）为数字：

| FORM | IR 断言 |
| --- | --- |
| `-1` | literal `-1` |
| `-1 \| 1` | union members `[-1, 1]` |
| `0.5` | literal `0.5` |
| `0.5 \| 1.5` | union members `[0.5, 1.5]` |
| `-0.5` | literal `-0.5` |
| `0.1 \| 0.2` | union members `[0.1, 0.2]` |
| `00` | literal `0`（既有行为，逐步） |
| `00.5` | literal `0.5` |
| `9007199254740993` | literal `9007199254740992`（f64 舍入，既有行为） |
| `-9007199254740993` | literal `-9007199254740992` |
| `0.99999999999999999` | literal `1` |
| `-0.` + `'0'×322` + `1` | literal `-1e-323` |
| `'9'×308` | literal `1e+308`（既有边界） |
| `-` + `'9'×308` | literal `-1e+308` |

全局位置断言（同一文件；每例 `ok:true`）：

| 模块 | 断言 |
| --- | --- |
| `type A = -1 \| 0.5; type ROOT = YMap<{ v: A }>;` | ok（别名 RHS） |
| `type ROOT = YMap<{ v: -1[] }>;` | ok，元素 literal `-1` |
| `type ROOT = YMap<{ v: YLeaf<-1> }>;` | ok |
| `type ROOT = YMap<{ v: YArray<0.5> }>;` | ok |
| `type ROOT = YMap<{ v: Record<string, -1 \| 0.5> }>;` | ok |
| `type ROOT = YMap<{ v: Record<-1, string> }>;` | **E306** @ (1,30)（识别为数值字面量后按键形规则拒绝） |
| `type ROOT = YMap<{ v: -1 & string }>;` | **E100** @ (1,25)（交叉白名单，锚 `&`） |

### 12.3 C2 — 负例对照：非法形态 E100 + 精确锚（绿 → 保持绿，具突变敏感性）

同文件（`describe('invalid number forms')`），逐例断言 `ok:false`、`message` 匹配
`/^VFSL-E100: /`、`line===1`、`column===` 表中值：

| FORM | 期望锚 | 备注 |
| --- | --- | --- |
| `.5` | 23 | 消息含 `未知记号: .` |
| `1.` | 24 | 消息含 `未知记号: .` |
| `1e3` | 24 | 指数记号不做（消息为字段分隔符/标识符 `e3`，钉现状） |
| `-1e3` | **25** | 与 `1e3` 同构（已登记锚位变化，§6） |
| `1..5` | 24 | |
| `-` | 23 | 裸 `-` 维持未知字符路径 |
| `- 1` | 23 | 负号必须紧邻 |
| `-/*c*/1` | 23 | trivia 不得被吞 |
| `-.5` | 23 | |
| `--1` | 23 | |
| `-0` | 23 | `message` 须含 `-0` 且引导写 `0` |
| `-0.0` | 23 | 同上 |
| `-00` | 23 | 同上 |
| `-0.` + `'0'×323` + `1` | 23 | **值判定**用例（`Object.is(-0)`） |
| `-0.` + `'0'×400` | 23 | 同上 |
| `'9'×309` | 23 | `message` 前缀 `VFSL-E100: 数字字面量超出可序列化数值域` |
| `-` + `'9'×309` | 23 | 同前缀（负值沿 §7.3 既有路径） |

### 12.4 C3 — validate：f64 严格相等枚举判定（红 → 绿）

测试文件：`packages/vfsl/test/validate-number-literals.test.ts`。
Fixture：`type ROOT = YMap<{ v: -1 | 0.5 | 2; d: 0.1 | 0.2 }>;` → parse ok → evaluate ok。

| 断言 | 期望 |
| --- | --- |
| `derived.values.ROOT` 值位 | 字段 `v` → `{kind:'enum', values:[-1, 0.5, 2]}`（**声明序**）；`d` → `[0.1, 0.2]` |
| `validateLogicalSnapshot(derived, {v:-1, d:0.1})` | `ok:true` |
| `{v:0.5, d:0.2}` / `{v:2, d:0.1}` | `ok:true` |
| `{v:1, d:0.1}` | `ok:false`；`path:['v']`；消息含 `期望 -1 \| 0.5 \| 2` |
| `{v:2.0000000000000004, d:0.1}` | `ok:false`（严格相等，零 epsilon） |
| `{v:-1, d:0.5000000000000001}` | `ok:false`，`path:['d']` |
| `{v:-1, d:0.30000000000000004}` | `ok:false`（`0.1+0.2` 不命中 `0.1 \| 0.2`） |
| `{v:-1, d:0.1}` | `ok:true`（精确 f64 值命中） |

**非目标（禁止在此文件断言）**：运行期 `-0`（对 `0` 成员或裸 `number`）的接受/拒绝语义属
ADR 0021 / issue #312；#314 只改文本侧。当前运行时行为（`enumContains` 的 `===`、裸
`number` 的 `typeof`）保持不变。

### 12.5 C4 — codegen：负/小数字面量发射合法 TS（红 → 绿）

测试文件：`packages/vfsl-codegen/test/generate-number-literals.test.ts`
（导入 `@nomicore/vfsl` + `@nomicore/vfsl-codegen` + `./tsc-helper.js`，与
`generate-mapping-table.test.ts`/`generate-protocol-import.test.ts` 同款装置）。

Fixture：

```vfsl
type ROOT = YMap<{
  v: -1 | 0.5 | 2;
  tiny: 0.0000001;
  neg: -1.5 | -0.25;
}>;
```

| 断言 | 期望 |
| --- | --- |
| `generateProjection(evaluate(parseVfsl(FIXTURE).module).derived)` | 返回 string，含 `PathSchema<-1 \| 0.5 \| 2, 'leaf'>`、`PathSchema<-1.5 \| -0.25, 'leaf'>`、`PathSchema<1e-7, 'leaf'>` |
| 生成文本写入临时 `.ts` 后 `preEmitDiagnostics([file])` | **0 条诊断**（真实 TS 编译器；即"发射合法 TS"） |
| 成员值语义 | 生成 text 中每个数值段 `Number(段) === IR 字面量`（或直接等值断言），`String()` 记法（如 `1e-7`）合法即可 |
| `pnpm generate --check` | exit 0（既有 `generated.ts` 零漂移） |

建议附加类型级文件：`packages/vfsl-codegen/test/generate-number-literals.test-d.ts`
（vitest `--typecheck.only` 发现），用 `PathSchema<-1 | 0.5 | 2, 'leaf'>` 做正例
（`-1`/`0.5`/`2` 可写入）与负例（`1`/`3` 被拒，负例用 `@ts-expect-error` 自我反转），
风格对齐 `packages/vfsl-codegen/test/generate-discriminated-narrow.test-d.ts`。

**明确非要求**：生成文本不要求可被 VFSL 重新解析（`1e-7` 是合法 TS 而 VFSL 指数记号仍 E100）；
"指数记号不做"约束只作用于 VFSL 文本侧。

### 12.6 C5 — 既有 fixture 零漂移（绿 → 保持绿）

测试文件：`packages/vfsl/test/number-literals-fixture-drift.test.ts`
（`new FileSchemaSource(repoRoot)` → `load('vfs3-assets@1')` → `compileSchemaEnvelope`）。

| 断言 | 钉死值（§4 基线） |
| --- | --- |
| `source.list()` | `['vfs3-assets@1']` |
| `envelopeFingerprint` | `sha256:v1:7b6c19cb…f39`（全值见 §4） |
| `semanticFingerprint` | `sha256:v1:b71be76e…31c`（全值见 §4） |
| `generate --check`（可经 `spawnSync` 或留给 CI 门禁） | exit 0 |
| `FINGERPRINT_PREFIX` 间接证据 | 上述指纹字符串仍以 `sha256:v1:` 开头 |

### 12.7 C6 — 规范文档与实现同 PR（AC5 的文档面）

| 断言 | 方式 |
| --- | --- |
| `docs/vfsl/v1-spec.md` §2 EBNF 含 `NumberLiteral = [ "-" ], digit, { digit }, [ ".", digit, { digit } ] ;` | `tests/acceptance/vfsl_spec_acceptance.py` **G4 必须仍 GREEN**（候选文法已实测 0 错误，E4） |
| §2 注记 7 不再声称"负数、小数不在 v1 子集"；`-0`/`.5`/`1.`/`1e3` 明确 E100 | 人工评审 + 该脚本 G4/G5/G6 绿（脚本不校验该句，属评审项） |
| §2 微示例第 118 行不再把 `type C = -1 \| 1;` 标为 E100 | 同上 |
| §4 E100 码表行不再以"负数 / 小数字面量"为越界示例 | 同上 |
| `docs/vfsl/schema-authoring-guide.md` 第 145 行同步 | 同上 |
| 全脚本 | `python3 tests/acceptance/vfsl_spec_acceptance.py` exit 0 |

### 12.8 C7 — 验证证据（AC5）

实现完成后必须逐条给证据（命令 + 退出码 + 关键输出）：

1. `pnpm test` → exit 0（新文件自动入 vitest 与 CI 分片；HEAD 基线 319 files/3383 tests）。
2. `pnpm typecheck` → exit 0。
3. `pnpm generate --check` → exit 0。
4. `git diff --check` → exit 0。
5. `python3 tests/acceptance/vfsl_spec_acceptance.py` → exit 0（若改动 spec）。
6. 焦点红灯→绿灯证据：
   `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/vfsl/test/parse-vfsl-number-literals.test.ts packages/vfsl/test/validate-number-literals.test.ts packages/vfsl/test/number-literals-fixture-drift.test.ts packages/vfsl-codegen/test/generate-number-literals.test.ts --passWithNoTests=false`
   —— 实现前必须**红**（红在目标断言：C1/C3/C4 的 ok/值断言），实现后必须**绿**；
   负控（C2/C5）实现前后均须**绿**。
7. 类型级（若加 `.test-d.ts`）：
   `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck.only --passWithNoTests=false`。

### 12.9 突变敏感性矩阵（杀死弱实现）

| 弱实现 | 变红的契约项 |
| --- | --- |
| 只在联合成员位特判 `-` | C1 全局位置（YLeaf/YArray/Record 值位/数组元素/别名 RHS） |
| 宽松正则 `-?[0-9]*\.?[0-9]*` | C2 `.5`、`1.`、`-.5`、`1..5`、`-`、`- 1` |
| 吞掉负号后的空白/注释 | C2 `- 1`、`-/*c*/1` |
| 放过 `-0` | C2 `-0`/`-0.0`/`-00` |
| 文本判定 `raw === '-0' \|\| raw === '-0.0'` | C2 下溢用例（`-0.`+`'0'×323`+`1`） |
| 用 `=== 0` / `Number.isNaN` 代替 `Object.is(v,-0)` | C2 下溢用例；且 `-0.`+`'0'×322`+`1` 会被误拒（正例红） |
| 负值跳过有限性闸门 | C2 `-`+`'9'×309` |
| 小数走 epsilon 比较 | C3 `0.5000000000000001` / `2.0000000000000004` |
| 生成器改用 `raw` 文本或四舍五入 | C4 tsc 诊断 / 成员值断言 |
| 新增 IR 节点或改 IR 键序 | C5 指纹钉 |
| 重新生成 `domains/vfs3-assets/generated.ts` | C5（`generate --check` 红） |
| 升 `FINGERPRINT_PREFIX` 到 v2 | C5 前缀断言 + ADR 0020 决策 5 |

---

## 13. Red/green or baseline evidence

| 契约项 | HEAD 状态 | 说明 |
| --- | --- | --- |
| C1 正例（含全局位置） | **红**（真红） | 实测 `ok:false` + E100 锚位（§5 表）；任何断言 `ok:true`/IR 值/`E306`/`E311` 的用例必红，红因 = 能力缺口本身，非环境/fixture/入口问题 |
| C2 负例 | 绿（需保持） | HEAD 已 E100；拓宽后 `-0` 家族与 `-1e3` 锚位变化点已在契约中钉死 |
| C3 validate | **红**（经文本 fixture） | 文本无法解析 → 断言链首步失败；下游语义已由 E1 证明可绿 |
| C4 codegen | **红**（经文本 fixture） | parse 失败 → 无 derived 可发射；发射能力已由 E5 证明可绿 |
| C5 drift | 绿 | §4 基线实测；实现后须保持 |
| C6 文档 | 部分红（文本仍写"负数、小数不在 v1 子集"） | spec 未更新即与实现矛盾（ADR 0020 决策 10 要求同 PR） |
| C7 门禁 | 全绿 | §4 表 |

红灯根因确认：C1 的红是"tokenizer 不收 `-`/`.`"（直接故障点，源码行号 + 实测锚位 + 手工 IR 对照），
不是环境、fixture、超时或测试入口错误——同一探针在无符号等价形上全绿。

---

## 14. Runner trigger evidence

- vitest 发现面（`vitest.config.ts:15-21`）：`packages/*/test/**/*.test.ts`、
  `domains/*/test/**/*.test.ts`、`apps/*/test/**/*.test.ts`；类型检查测试
  `packages/*/test/**/*.test-d.ts`、`domains/*/test/**/*.test-d.ts`（`tsconfig.typecheck.json`）。
  新文件**无需改配置**即被发现。
- CI 分片器（`scripts/ci-test-shard.mjs`）：按磁盘枚举全部 `*.test.ts`（与 vitest include 同源），
  新文件必然落入某一分片，权重表缺失只影响均衡、不会漏跑；`.test-d.ts` 由 CI `typecheck` 作业
  `vitest run --typecheck.only` 集中执行。
- CI 另有显式门禁：`codegen-freshness` = `pnpm generate --check`；`contract-gates` 中
  `domains-scaffold` 等（与 #314 无直接冲突，但 `domains/vfs3-assets` 不得修改）。
- 焦点入口实测（HEAD）：`vitest run packages/vfsl/test/parse-vfsl-errors.test.ts
  --typecheck.enabled=false --passWithNoTests=false` → 1 file / 19 tests passed，exit 0。
  证明该目录测试器工作正常，且第 58 行旧断言当前为绿（须按 §10 替换）。
- 全量入口实测（HEAD）：`pnpm test` → 319 files / 3383 tests / no type errors / exit 0。

---

## 15. Unknowns and blockers

- **U1（非阻塞，范围边界）**：ADR 0021 正文不在仓内（仅 ADR 0020 决策 9 的 supersede 标注引述
  其决策 2）。#314 只取"文本侧 `-0` 字面量解析期 E100"这一条；运行期 number 基线收窄
  （NaN/±Infinity/-0）归 issue #312。若评审认为运行期收窄须在本 issue 一并落地，需要新的
  ADR/契约——本契约按简报 AC 不含该项。
- **U2（决策悬置，需 SA1/ADR owner 明示）**：`packages/vfsl/src/fingerprint.ts` 头注与
  `wiki/raw/task_issue-72_design.md` §6.3 登记了升级触发器："**v2 方言**若放开数值字面量语法
  （负号/小数点/指数任一）⇒ semantic 域文档必须重审并升 v2 前缀"。ADR 0020 决策 1 明确
  **不引入 v2**（§8 窄例外、纯拓宽），决策 5 明确"既有语义指纹全部不变"；且本 issue 可达 IR 域
  仍排除坍缩类（`-0` 解析期拒、±Infinity 有限性闸门、NaN 文法不可写、指数记号不做）。
  因此本契约按"**保持 `sha256:v1:`、既有指纹零漂移**"钉死。若 owner 判定该触发器按字面
  "放开数值字面量"即触发，则应另立 ADR 决策并重估全仓指纹（破坏性），不得由实现者静默升版。
- **U3（非阻塞）**：`Int`/`Range` 语法（ADR 0020 决策 2/4/6/7/8）不在 #314；但小数端点是否为
  `Int` 端点（整数限定）留待其自身 issue 的契约，本契约不预判。
- **U4（已接受的行为，非缺陷）**：小数经 f64 归一后 codegen 可能发射指数记法（`0.0000001`
  → `1e-7`）。该文本是合法 TS；C4 只要求"合法 TS + 值等价"，不要求 VFSL 回读。
- **阻塞项**：无。环境（离线依赖可装、探针可跑、门禁基线全绿）与事实（锚位/值域/下游能力）
  均足以建立可执行契约。

---

## 16. Temporary diagnostics cleanup

- 全部临时探针与日志位于未跟踪目录 `.sa6-tmp/`（`probe-parse.ts`、`probe-chain.ts`、
  `probe-number.ts`、`probe-positions.ts`、`probe-codegen.ts`、`probe-canonical.ts`、
  `probe-equiv.ts`、`probe-root-shape.ts`、`gen-probe.ts`、`typecheck.log`、`test.log`、
  `det-1.txt`、`det-2.txt`），**收尾前整目录删除**；`git status --short` 仅余 Host 产物
  `?? wiki/raw/task_issue-314.md` 与本报告。
- 未修改任何生产实现、测试、fixture、生成物、依赖清单；未启动任何常驻服务/端口（无需停止/等待）；
  未使用 nohup/setsid/PID 文件/轮询 marker（全部门禁为前台或 `run_in_background` Job，已收束）。
- 清理证据：见报告末尾"Cleanup verification"。

---

## 附录 A — 最小复现探针（可原样重放）

探针编号对照（正文引用）：P1=符号/小数形态矩阵；P2=域边界与精度；P3=手工 IR 全链（D 段）；
P4=全局位置；P5=相邻性负控 + 下溢边界；P6=规范模块锚位表（含确定性双跑）；P7=无符号等价矩阵；
P8=`FileSchemaSource` 指纹 + 生成物 tsc 编译。

```ts
// .sa6-tmp/probe.ts —— 运行：
// NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/tsx .sa6-tmp/probe.ts
import { parseVfsl, evaluate, validateLogicalSnapshot } from '../packages/vfsl/src/index.js';
import { generateProjection } from '../packages/vfsl-codegen/src/index.js';
import { preEmitDiagnostics, formatDiagnostics } from '../packages/vfsl-codegen/test/tsc-helper.js';
import { writeFileSync } from 'node:fs';

const M = (f: string) => `type ROOT = YMap<{ v: ${f} }>;`;
const forms = [
  '-1', '-1 | 1', '0.5', '0.5 | 1.5', '-0.5', '00.5', '9007199254740993',
  '-9007199254740993', '0.99999999999999999', '-0.' + '0'.repeat(322) + '1',
  '9'.repeat(308), '-' + '9'.repeat(308),          // 目标：全部 ok
  '.5', '1.', '1e3', '-1e3', '1..5', '-', '- 1', '-/*c*/1', '-.5', '--1',
  '-0', '-0.0', '-00', '-0.' + '0'.repeat(323) + '1', '9'.repeat(309), '-' + '9'.repeat(309), // 目标：全部 E100
];
for (const f of forms) {
  const r = parseVfsl(M(f));
  console.log(f.slice(0, 20).padEnd(22), r.ok ? 'OK' : `E L${r.issues[0]!.line}:C${r.issues[0]!.column} ${r.issues[0]!.message}`);
}

// 下游能力（绕过文本层）：手工 IR → evaluate → validate
const mod = { kind: 'vfsl-module', aliases: [{ kind: 'alias', name: 'ROOT', docs: [], type: {
  kind: 'marker', marker: 'YMap', docs: [], arg: { kind: 'object', fields: [{ kind: 'field', name: 'v',
    optional: false, docs: [], type: { kind: 'union', members: [
      { kind: 'literal', value: -1 }, { kind: 'literal', value: 0.5 }, { kind: 'literal', value: 2 },
    ] } }] } } }] } as const;
const ev = evaluate(mod as never);
if (ev.ok) {
  for (const v of [-1, 0.5, 2, 1, 2.0000000000000004]) {
    const vr = validateLogicalSnapshot(ev.derived, { v });
    console.log('validate', v, vr.ok ? 'ok' : JSON.stringify(vr.issues));
  }
  const gen = generateProjection(ev.derived, { sourceText: 'probe' });
  writeFileSync('.sa6-tmp/gen-probe.ts', gen);
  const d = preEmitDiagnostics(['.sa6-tmp/gen-probe.ts']);
  console.log('tsc diagnostics:', d.length === 0 ? 'NONE' : formatDiagnostics(d));
}
```

## 附录 B — 关键原始观察（摘录，完整输出见 §5/§6 表）

- `parseVfsl('type ROOT = YMap<{ v: -1 | 1 }>;')` → `{ok:false, issues:[{message:'VFSL-E100: 未知记号: -', line:1, column:23}]}`
- `parseVfsl('type ROOT = YMap<{ v: 0.5 }>;')` → `{ok:false, issues:[{message:'VFSL-E100: 未知记号: .', line:1, column:24}]}`
- `parseVfsl('type ROOT = YMap<{ v: ' + '9'.repeat(309) + ' }>;')` → `VFSL-E100: 数字字面量超出可序列化数值域（双精度上限 ≈1.8e308；实现值域上限，非方言判定）` @ (1,23)
- 手工 IR `[-1, 0.5, 2]` → `values.ROOT = {"kind":"object","fields":[{"name":"v","value":{"kind":"enum","values":[-1,0.5,2]}}]}`
- `generateProjection` → `v: PathSchema<-1 | 0.5 | 2, 'leaf'>;` / `tiny: PathSchema<1e-7, 'leaf'>;` → `preEmitDiagnostics` 0 条
- `FileSchemaSource.list()` → `["vfs3-assets@1"]`；`semanticFingerprint` → `sha256:v1:b71be76e3d3579670236b14a36373716db6238d86a15da440f44aecbb9b0631c`
- `Number('-0.0' + '0'.repeat(323) + '1')` → `-0`（`Object.is(v,-0) === true`）；`'0'.repeat(322)` 版 → `-1e-323`
- `python3 tests/acceptance/vfsl_spec_acceptance.py` → `GREEN（验收通过）: 22/22`

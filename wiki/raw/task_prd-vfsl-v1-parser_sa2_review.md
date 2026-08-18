# SA2 攻击评审报告

**Date**: 2026-08-18
**Reviewer**: SA2（Wallfacer / 破壁人）
**Target**: `wiki/raw/task_prd-vfsl-v1-parser_design.md`（SA1 R1 架构设计）
**Red-light baseline**: `packages/vfsl/test/parse-vfsl.{happy-path,forbidden,cycle-detection,jsdoc}.test.ts`（4 套件，全红）
**Task type**: Feature（greenfield `@nomicore/vfsl` parser）

**Verdict**: **needs-redesign**

> 设计在数据模型、错误模型、环检测、doc 挂载、禁止清单等核心面上质量较高，与红灯 helper 的形状无关对齐基本成立。但存在一个 **CRITICAL 级别的内部矛盾**：设计自定的「green-bar 编排策略」被其同时冻结的测试入口直接架空——按设计执行，`pnpm test` 与 `scripts/test-lock.sh` 将**持续红**（dist 缺失 → import 解析失败，与当前红灯状态完全相同）。这直接挫败本任务的核心目标（红灯→绿灯），必须 redesign。另含若干 MEDIUM 契约自相矛盾与检测缺口需 SA1 闭合。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | CRITICAL | green-bar 编排 / 测试入口 | 设计 §13.1 声称「为确保 CI/pnpm test 自动构建，建议把 `packages/vfsl/package.json` 的 `test` 脚本改为 `tsc -p tsconfig.json && vitest run`」。但实际测试入口是 `pnpm --filter @nomicore/vfsl exec vitest run`（根 `package.json` `scripts.test` 与 `scripts/test-lock.sh` **两处硬编码**，`exec` 直接运行 vitest 二进制，**不触发** 包的 `test` 生命周期脚本）。故包 `test` 脚本里的 `tsc` 前置是**死代码**：`pnpm test` / `bash scripts/test-lock.sh` 仍以 `exec vitest run` 跑，dist 不构建 → `@nomicore/vfsl` 仍解析到不存在的 `dist/index.js` → 4 套件继续在 import 阶段失败。而所有可绕过此矛盾的路径均被设计自行冻结：根 `package.json`（DENY）、`scripts/test-lock.sh`（DENY）、`packages/vfsl/vitest.config.ts`（DENY，无法加 `resolve.alias` 指向 src）、`exports`→dist（§0.1 冻结）。设计在自己的冻结边界内**没有任何一条**能让 `pnpm test` 自动构建 dist 的可行路径。 | SA1 必须 redesign 编排边界，二选一：(A) 把根 `scripts.test` 与 `scripts/test-lock.sh` 改为 `pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run`，并**显式将这两处移出 DENY LIST**（标注为本次 ALLOW 的脚本变更）；或 (B) 在包内加 `pretest` 并改入口为 `pnpm --filter @nomicore/vfsl run test`。必须在设计里给出**经 `exec` 与 `run test` 语义差异验证**的依据（见协议假设审查），不得再以「建议」含糊带过。 |
| 2 | MEDIUM | 标识符分派 / 字面量类型 | §3 文法 `Literal := String \| Number \| 'true' \| 'false'` 与 §3.1 宽容点均允许 `true`/`false`/数字字面量类型；但 §4.2 标识符分派表（权威分派规则）**遗漏** `true`/`false`：表中 PrimaryType 的 identifier 值仅列五原始类型、`any`/`symbol`、`Record`+`<`、六 MarkerName、其他 Identifier→TypeRef。`true` 无 `<` → 落入「其他 Identifier → TypeRef」→ 不在 decl → §10.2 报「未知引用」。即按 §4.2 实现，`type A = { flag: true }` 会被错误拒绝，与 §3/§3.1 直接冲突。 | 在 §4.2 分派表中显式增加 `true`/`false` → Literal(boolean) 分派（与 `string`/`number` 原始类型分派并列），并指明优先级（在 TypeRef 之前匹配）。数字字面量同理（`number` token 不经 identifier 分派，需确认 tokenizer 产 `number` token 而非 identifier）。 |
| 3 | MEDIUM | Pattern 独立使用未禁止 | §6 声称 `Pattern` 「仅在 `string & Pattern<"lit">` 中使用」，但 §3 文法 `MarkerType := MarkerName ('<' MarkerArg? '>')?` 允许 `Pattern<"a">` 作为独立 PrimaryType 出现（如 `type A = Pattern<"a">`、`type A = { x: Pattern<"a"> }`），§9.7 仅在 Intersection 上下文检测「右非 Pattern / Pattern 参非 string」。故独立 Pattern 用法会**被静默接受**为合法 marker，违反 §6 契约——属于「以合法语法包装违反契约」的检测缺口。 | 在 §9 增加独立项：marker 节点 `name==='Pattern'` 且不在合法 intersection 上下文（即父节点非 `{kind:'intersection', left:{kind:'primitive',name:'string'}}`）→ 结构化错误。锚定到 Pattern token。 |
| 4 | MEDIUM | `Record`/MarkerName 不跟 `<` 的分派未定义 | §4.2 仅覆盖「`Record` 后跟 `<`」「MarkerName（六者精确匹配）」。未定义：`Record` **不跟** `<`（如 `type A = Record`、`{ x: Record }`）的分派；以及 `YMap`/`YArray`/`YPlainArray` 不跟 `<`（§6 要求恰好 1 参，但文法 `('<' MarkerArg? '>')?` 把 `<>` 设为可选）。`Record` 无 `<` 既非 RecordType（文法要求 `<`）也未被 §4.2 列为 MarkerName，实现会落入 TypeRef→未知引用，结果虽 ok=false 但语义不准；`YMap` 无 `<>` 文法解析为 0 参 marker，再由 §6 arity 报错——路径成立但设计未写明，SA3 易踩坑。 | §4.2 表补行：(a) `Record` 不跟 `<` → 非法（RecordType 必须带 `<...>`），锚定 `Record`；(b) 明确 MarkerName 无 `<>` 时仍构造 marker 节点、交由 §6 arity 强制判定（YMap/YArray/YPlainArray 0 参→错；YLeaf/YXmlFragment 0 参→合法）。 |
| 5 | MEDIUM | 非 leading 位置 `/** */` 致硬语法错误 | §2.5 规定 doc token「进入主流但**不被 `skipTrivia` 跳过**」。后果：任何出现在非 leading 位置的 `/** */`（如 trailing `name: string /** doc */;`、行间 `a: string; /** doc */ b: number`、游离于字段间）会令解析器在期待分隔符/`}` 处撞上 `doc` token → 触发 resync/误报。TS/JSDoc 允许 trailing doc，TASK.md 也只说 doc 挂到「相邻 IR 节点」。设计未覆盖此场景，SA3 若按字面实现会把合法-ish 输入误判为语法错误。 | 明确 doc token 的非 leading 处置：要么在 `skipTrivia` 中允许「当前不期待 doc」时跳过游离 doc（丢弃，不挂载），要么显式声明 trailing/inline doc 为 v1 不支持并归入语法错误（需在 §2.5 与 §9 注明）。二选一，不得留白。 |
| 6 | MEDIUM | 行列精度声称与红灯覆盖不匹配 | 设计多处声称「精确到行列」「锚定到触发 token」。但红灯实际仅对 `any` 一例断言 `line===3`，其余所有负例只走 `expectIssueShape`（断言 line∈[1,lineCount]、column∈[1,lineText.length+1] 的**范围**，不锁精确值）。故「精确到行列」是**未经验证的设计声称**。叠加：CRLF（`\r\n`）下行计数与 column 上界（`split('\n')` 残留 `\r` 使 lineText.length 偏大 1）、文件尾空行后 EOF token 的 line/column 规范——设计均未规定，SA3 易产出越界 column。 | (a) 在 §8/§2.2 明确 EOF token 位置规则（如 `(lineCount, max(1, lastLine.length+1))`，空尾行取 `(lineCount+1, 1)` 并证明落 `expectIssueShape` 范围内）；(b) 明确 CRLF 处理策略（归一化 `\r\n`→`\n` 或显式声明仅支持 `\n`）；(c) 降低「精确到行列」的绝对声称，或在 §12 标注「精确 column 未被红灯锁定，属实现质量而非契约」。 |
| 7 | LOW | 语法错误级联为伪未知引用 | §1 阶段依赖：「阶段 2 别名表不完整时，阶段 3 仍对已解析别名跑」。若语法错误导致某别名未被登记，则所有引用该别名的 ref 会被 §10.2 报「未知引用」——这是语法错误的**级联伪报**，会淹没真实错误、降低错误信息信噪比。对 ok=false 判定无影响，但影响错误模型可用性。 | 在 §10.2 增加门控：当阶段 2 已产生致命语法 issue 时，未知引用检查降级为「仅在 ref 名既不在 decl 又非明显笔误时报告」，或直接跳过未知引用检查（仅保留环检测），并在 issue 列表标注「因语法错误，语义检查不完整」。 |
| 8 | LOW | 重复别名声明的 decl map 保留策略未定 | §14.1 规定重复声明→第二处 loud issue，但未规定 `decl` map（环检测/ref 解析用）保留 first 还是 last。若保留 last，则第一处的类型表达式在 ref 解析时丢失，可能影响环检测锚点行号；若保留 first，第二处的 ref 语义被忽略。 | §14.1 明确：重复声明时 `decl` 保留**首次**声明（保证 ref 解析稳定），issue 锚定第二处；或显式声明重复声明后该别名不参与环检测。 |
| 9 | LOW | 嵌套泛型 resync 的 `>` 配对未细化 | §4.3 resync「跳过到当前字段结束或 `>` 配对」。对 `YMap<Record<string, YArray<A>>>` 这类深度嵌套，错误后的 `>` 配对恢复算法未给出，易误锚点后续 issue 或过度吞 token。红灯不要求精确 issue 数，影响有限。 | §4.3 给出嵌套 `<>` 深度计数 resync 规则，或显式声明「嵌套泛型内错误后 resync 到首个未配对 `>` 或字段边界，可能牺牲后续精度」。 |
| 10 | LOW | doc 内 `*/` 提前闭合的 fixture 一致性 | §14 承认 doc 正文含 `*/` 会提前闭合。需确认 fixture `vfs3-assets.vfsl` 与红灯正例的 doc 正文均不含 `*/`（当前 fixture doc 无 `*/`，安全）。但若未来 fixture/用户写入含 `*/` 的 doc，行为与 TS JSDoc 一致——可接受，建议在 §2.4 显式标注此为已知限制并补一条非红灯的边界用例思路。 | 仅记录，不阻断。 |

> 攻击点 1 是裁决 needs-redesign 的主因。攻击点 2–5 为契约/检测层面的自相矛盾或缺口，须 SA1 修订设计文本闭合。攻击点 6–9 为错误模型与健壮性增强项。攻击点 10 为已知限制记录。

---

## 协议假设依据审查（SKILL §3）

§16「协议假设依据」章节**存在**，声明无 HTTP/WS/端口/进程/第三方库运行时假设，仅涉及 `tsc`→`dist` 与 vitest 经 `exports` 解析 `@nomicore/vfsl` 到 dist。依据可验证性评估：

- **`tsc` 能把 src 编译到 dist**：依据为 TypeScript 官方行为 + `packages/vfsl/tsconfig.json` 已配 `outDir=dist`。可验证（`pnpm --filter @nomicore/vfsl run build`）。✅
- **vitest 经 `exports` 解析到 dist**：依据为红灯证据（dist 缺失 → import 失败，反向佐证解析目标为 dist）。可验证、可定位。✅

**但存在一处「无据推断」级缺陷（对应攻击点 1）**：§13.1 断言「把包 `test` 脚本改为 `tsc && vitest run`」可「确保 CI/pnpm test 自动构建」。该断言**未经验证且为假**——`pnpm test` 与 `test-lock.sh` 走 `exec vitest run`，语义上**不触发**包 `test` 脚本。这是「预计/应该」类无据推断（设计**预计**改包 test 脚本能被入口调用，但未验证 `pnpm exec` 与 `pnpm run` 的语义差异）。按 SKILL §3 立法，此类无据推断须 reject 并要求 SA1 给出可验证依据。

**修订要求**：SA1 须在 §16（或 §13.1）贴出 `pnpm exec <cmd>` vs `pnpm run <script>` 的语义差异依据（pnpm 官方文档引用或实测 `pnpm test` 后 `ls dist` 的命令+输出），并据此重新设计 green-bar 编排（攻击点 1 建议）。

---

## 错误处理链路审查（SKILL §4）

parseVfsl 是纯函数（无 UI、无异步、无外部服务），SKILL §4 的静默失败/状态闭环/降级路径条款大面积 N/A，但关键项结论如下：

- **静默失败**：§11 明确「所有错误转为 `{ok:false, issues}`」「不抛异常到调用方」。无静默失败路径。✅
- **状态闭环**：任一 issue 存在即返回 `{ok:false, issues}`，**不返回 module**（§1 错误聚合策略）。失败状态闭环完整。✅
- **降级路径**：无外部依赖可降级；空输入→`{ok:true, module:{declarations:[]}}` 是合法空结果，非失败。✅
- **🚨 虚假降级识别**：§11 末尾显式立法「拒绝虚假降级：parse 失败必须 loud 返回 `{ok:false, issues}`，不得静默返回空 module 或部分 module」；§14.1 重复别名声明「不静默覆盖、不静默合并，loud issue」。两项均合规，未发现把 bug 当降级处理的情形。✅
- **残留风险**：攻击点 7（语法错误级联伪未知引用）非虚假降级，但属错误信息质量退化，建议处理。

**结论**：错误处理链路本身合规；唯一与「失败可见性」相关的硬伤是攻击点 1——失败不是被静默，而是**绿灯永远不亮**（dist 永不构建），从「用户可感知性」角度等同于链路断裂。

---

## 红线测试思路（每漏洞对应的红灯测试编写方向）

> 红灯已有 4 套件覆盖正例/禁止/环/JSDoc。以下为针对本次攻击点**应追加**的红灯/边界测试思路（无需 SA2 亲自写代码，供 SA4/SA7 落地）。

1. **攻击点 1（CRITICAL）— green-bar 编排验证（IT）**：
   - 场景：`rm -rf packages/vfsl/dist && pnpm test`（或 `bash scripts/test-lock.sh`）→ 断言 exit 0 且 4 套件全绿。当前设计下此用例**必红**（dist 缺失）。这是验证编排修复的 gate 测试，须在 SA1 redesign 后由 SA4 实测贴输出。
   - 场景：`rm -rf dist && pnpm --filter @nomicore/vfsl run build && pnpm test` → 全绿（验证手动 build 路径仍可用）。

2. **攻击点 2 — `true`/`false`/数字字面量类型正例**：
   - `type A = { flag: true; code: 1 | 2 }` → 断言 `r.ok===true`，`collectStrings(flag)` 含 `'true'`，`code` 含 `'1'`/`'2'`。
   - 当前按 §4.2 实现会 ok=false（未知引用），用于暴露分派表遗漏。

3. **攻击点 3 — 独立 Pattern 拒绝**：
   - `type A = Pattern<"^a+$">` → 断言 `ok===false`，issue 形状合法。
   - `type A = { x: Pattern<"^a+$"> }` → 同上。
   - 合法对照 `type A = { x: string & Pattern<"^a+$"> }` → `ok===true`（已在 happy-path，防过度拒绝）。

4. **攻击点 4 — `Record`/marker 无 `<>` 处置**：
   - `type A = { x: Record }` → `ok===false`（明确报非法，而非泛泛未知引用）。
   - `type A = { m: YMap }` → `ok===false`（YMap 缺参，§6 arity）。
   - `type A = { leaf: YLeaf }` → `ok===true`（0 参合法，防过度拒绝）。

5. **攻击点 5 — trailing/inline doc 不崩溃**：
   - `type A = { name: string /** doc */ }` → 断言**不崩溃**且行为符合设计声明（或 ok=true 且 doc 挂载/丢弃一致，或 ok=false 且 issue 形状合法——以 SA1 闭合后的契约为准）。
   - `type A = { a: string; /** 中间 doc */ b: number }` → 同上，断言解析器不卡死、`b` 字段仍被解析或 issue 形状合法。

6. **攻击点 6 — 行列边界**：
   - CRLF 输入 `type A = any;\r\n` → 断言 `ok===false` 且所有 issue 满足 `expectIssueShape`（column 不越界）。
   - 文件尾空行 `type A = { x: string\n\n`（未闭合 `}`）→ 断言 issue 的 line/column 落源内合法范围（验证 EOF 锚点规则）。

7. **攻击点 7 — 语法错误级联**：
   - `type A = { x: ; type B = A`（语法错误 + 引用 A）→ 断言 `ok===false`，且 issue 列表含语法错误；若设计降级未知引用检查，则不应出现「未知引用 A」噪声。

8. **攻击点 8 — 重复别名声明**：
   - `type A = { x: string }; type A = { y: number }` → 断言 `ok===false`，issue 含「重复声明: A」，锚定第二个 A；并断言 ref 解析行为符合 §14.1 闭合后的保留策略。

9. **攻击点 9 — 嵌套泛型错误恢复**：
   - `type A = YMap<Record<string, YArray<>>>`（最内层缺参）→ 断言 `ok===false`，issue 形状合法，且不因 resync 死循环或栈溢出（加超时断言）。

10. **攻击点 10 — doc 含 `*/`**：
    - `type A = { x: string }` 前置 `/** doc with */ inside */` → 断言行为符合 §2.4 提前闭合声明（doc 截断到首个 `*/`），不崩溃。

---

## 与红灯测试对齐总评

- **happy-path 套件**：设计 §5.1 推荐 IR 形状与 helper（`collectNodes`/`nodeByName`/`collectStrings`）的形状无关断言**逐条对齐成立**（§5.2 表核对无误）：`.name` 字段匹配、primitive/marker `name` 值被收集、literal `value` 被收集、Pattern `argument` 原文保留、`optional` boolean 可被 `collectNodes().some(n=>n.optional===true)` 命中、doc 原文进 `doc` 字段被收集。✅
- **forbidden 套件**：§9 表覆盖全部 10 项负例 + 4 项矩阵负例，逐项锚点合理。✅（但攻击点 2/3/4 暴露 §9 与 §3/§4.2/§6 之间的契约缝隙，非红灯覆盖不足，而是设计自洽性不足。）
- **cycle-detection 套件**：§10.3 五用例（自环/经字段自环/互引/经字段互引/前向合法）DFS 三色算法**完备**——collectRefs 覆盖 array/record/union/intersection/object/marker-arg 全部分支，自环与互引用例锚点均落 `{1,2}`。✅ 算法正确性无懈可击。
- **jsdoc 套件**：§2.5 consumeLeadingDoc + most-recent-wins 对「相邻不串挂」五用例成立。✅（攻击点 5 是其未覆盖的 trailing 场景。）

**对齐结论**：除攻击点 1（编排使绿灯不可达）外，设计能让 4 套件在**手动 build 后**转绿。但任务要求的是经 `pnpm test`/`test-lock.sh` 的**标准入口**转绿，此点设计未达成。

---

## 裁决理由

**needs-redesign**。设计的数据架构、错误模型、环检测、禁止清单、doc 挂载质量高，与红灯对齐扎实——这些不需重做。但攻击点 1 是**目标级缺陷**：设计自行冻结了全部能触发自动构建的入口（根 `package.json`、`test-lock.sh`、`vitest.config.ts`、`exports`），又把唯一的 green-bar 建议（包 `test` 脚本加 `tsc`）建立在「`pnpm exec` 会调用包 `test` 脚本」这一**为假的假设**上。结果：严格按设计执行，`pnpm test` 与 `bash scripts/test-lock.sh` 将维持当前红灯状态（dist 缺失 → import 失败），核心目标落空。此缺陷须 SA1 redesign 编排边界（解冻并改写入口脚本，或给出另一条经验证的自动构建路径）并补协议假设依据后方可放行。攻击点 2–5 为契约自洽性缺口，建议在同次修订中一并闭合。

— SA2，评审完成，交 SA1 修订。

---

# 【R2 Verdict】（2026-08-18 复审）

**Reviewer**: SA2（Wallfacer / 破壁人）
**Target**: `wiki/raw/task_prd-vfsl-v1-parser_design.md` R2（§18 逐条回应表 + §16 实测证据）
**R1 Verdict**: needs-redesign（10 攻击点，攻击点 1 CRITICAL）
**R2 Verdict**: **pass** ✅ — SA3 可据此实现

> R1 的 CRITICAL 攻击点 1（编排边界/自动构建路径）已被 SA1 以**路径 A**（根 `package.json` + `scripts/test-lock.sh` 前置 `pnpm --filter @nomicore/vfsl run build`）闭合，且 SA1 在 §16 贴出的 P1–P7 实测证据**已被 SA2 独立复现确认**（非接受无据推断）。攻击点 2–10 在设计文本中均有实质改动闭合。下方给出逐条核验与新发现。

## 一、攻击点 1（CRITICAL）— 路径 A 实测复核

SA2 在 cwd=worktree 根（pnpm 11.1.3，deps 已装，`src/index.ts` 仍为 SA6 占位 `export {}`）独立执行以下命令，逐条比对设计 §16 的 P1–P7：

| 设计声称 | SA2 复核命令 | SA2 实测结果 | 结论 |
|---|---|---|---|
| P1：`exec vitest run` 不触发包 `test` 脚本、不构建 dist | `rm -rf dist && pnpm test`（当前入口仍为 `exec vitest run`） | 4 套件 `Failed to resolve entry for package "@nomicore/vfsl"`、`Tests no tests`；`ls dist` → 不存在 | ✅ 证伪 R1 死代码假设，复现 R1 缺陷 |
| P2：`run build` 产出 dist | `rm -rf dist && pnpm --filter @nomicore/vfsl run build` | `$ tsc -p tsconfig.json`；`ls dist` → `index.d.ts index.d.ts.map index.js` | ✅ |
| P3：build 后 import 解析成功（测试 fail on 断言非 import fail） | build 后 `pnpm --filter @nomicore/vfsl exec vitest run` | `Test Files 4 failed (4), Tests 37 failed (37)`，**无** `Failed to resolve entry`（37 测试实际运行并断言，如 `expect(r.ok).toBe(true)`） | ✅ import 缺口已闭合 |
| P4：路径 A 组合 `run build && exec vitest run` 从干净 dist 端到端 | `rm -rf dist && pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run` | build 产 dist、vitest 运行 37 测试（fail on 断言）、`dist/index.js` 存在 | ✅ 机制成立 |
| P5：`run test` 按 body 字面执行、不隐式 build | `rm -rf dist && pnpm --filter @nomicore/vfsl run test` | 输出 `$ vitest run`、import fail、`ls dist` → 不存在 | ✅ 佐证 exec/run 语义差 |
| test-lock.sh 同病同治 | `rm -rf dist && bash scripts/test-lock.sh` | `Failed to resolve entry`、`ls dist` → 不存在（当前无 build 前置） | ✅ 证明 test-lock.sh 需路径 A 同步加 build 前置 |

**路径 A 机制结论**：`pnpm test`（根）按 `scripts.test` body 字面执行（P1 已证 `pnpm test` 输出 ≡ `exec vitest run` 输出；P5 已证 `pnpm run test` 执行 body 字面值）。body 改为 `pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run` 后，等价于 P4 的组合命令——`run build` 产 dist（P2）、后续 `exec vitest run` import 解析成功（P3）。`bash scripts/test-lock.sh` 经 `cd` 到根后执行同一组合命令，同证。`exports`→dist 与 `vitest.config.ts` 保持冻结（未改），无新协议假设。**路径 A 闭合攻击点 1。**

> 诚实声明：SA3 尚未实现 `parseVfsl`，故上述 vitest 仍为 37 测试断言失败（红 on 断言，非红 on import）。`pnpm test`/`test-lock.sh` 的最终 exit 0 全绿须由 SA4 在「SA3 落地 parseVfsl + 路径 A 脚本实际改写入仓库」后以 `rm -rf dist && pnpm test` 与 `rm -rf dist && bash scripts/test-lock.sh` 实测 gate 确认。此为 SA4/SA7 职责，不阻塞设计放行——设计层面的「自动构建路径可行」已被实测证明。

## 二、攻击点 2–10 闭合核验

| # | R1 攻击点 | R2 闭合位置 | SA2 核验 | 结论 |
|---|---|---|---|---|
| 2 | `true`/`false`/数字字面量分派遗漏 | §4.2 补 `true`/`false`→Literal(boolean) 行，优先级 Primitive>true/false>MarkerName>Record>TypeRef；数字由 tokenizer 产 `number` token 直接构造 Literal(number) | 分派优先级消除「`type A={flag:true}` 误报未知引用」；数字 token 路径独立于 identifier 分派，无未知引用风险。优先级链与 §9 检测点一致 | ✅ |
| 3 | 独立 Pattern 静默接受 | §9.14 表项 + §9.15 细则：marker `name==='Pattern'` 且非「`string & Pattern<...>` 的 right」→ 结构化错误，锚定 Pattern token；合法形式不报 | 合法上下文判定精确（intersection.right 且 left==={primitive,string}）；§3 文法 `&` 仅 0/1 次使判定无歧义；覆盖 standalone/field/left/union-member 各非法位置 | ✅ |
| 4 | Record/MarkerName 不跟 `<>` 分派未定义 | §4.2 补两行 + §9.13/§9.16：(a) `Record` 不跟 `<`→禁止锚定 `Record` 不落 TypeRef；(b) MarkerName 无 `<>`→构造 0 参 marker 交 §6 arity（YMap/YArray/YPlainArray 0 参→错；YLeaf/YXmlFragment 0 参→合法） | 路径明确、与 §6 arity 契约一致、防过度拒绝（YLeaf 0 参合法） | ✅ |
| 5 | 非 leading `/** */` 致硬语法错误 | §2.5 R2：leading-position-only 挂载；非 leading doc token 经 `skipTriviaAndDoc()` 丢弃（不挂载、不报错）；声明为 v1 限制非虚假降级 | trailing/inline doc 不崩溃、不误报；`consumeLeadingDoc` 与 `skipTriviaAndDoc` 职责正交。属显式声明限制，合规 | ✅ |
| 6 | 行列精度/CRLF/EOF 未规范 | §2.2 R2：CRLF 扫描时 `\r` 不推进 column；EOF 位置=(line, max(1,lastLine.length+1)) 两例自证落范围；「精确到行列」下调为 line 精确(契约)/column 落范围(契约)/精确 column(实现质量) | CRLF 策略与 EOF 不变量成立（EOF column=lastLine.length+1 恒 ∈[1, lastLine.length+1]，与具体长度无关）；契约/实现质量分层合理 | ✅ |
| 7 | 语法错误级联伪未知引用 | §10.2 R2：`hasSyntaxIssue` 门控（内部 category 标签，返回前剥离），为真则跳过未知引用检查、仅留环检测、追加「语义检查已跳过」提示 issue 锚定 (1,1) | 门控逻辑闭环；环检测对 decl 不完整不敏感（`!decl.has(b)` continue）；category 剥离保证 §0.1 三字段不变；(1,1) 在非空输入下恒合法 | ✅ |
| 8 | 重复别名 decl 保留策略未定 | §14.1 R2：`decl` 保留首次声明（`!decl.has(name)` 守卫），第二处仅 loud issue 锚定第二处 | ref 解析/环检测锚点稳定指向首次声明，与「重复声明锚定第二处」语义不混淆 | ✅ |
| 9 | 嵌套泛型 resync `>` 配对未细化 | §4.3 R2：尖括号深度计数 resync 伪代码，跳到首个 depth=0 `>` 或字段边界或 EOF | 深度计数防误吞外层 `>>>`；已知限制（极复杂错误后牺牲精度）已声明，红灯不要求精确 issue 数 | ✅ |
| 10 | doc 内 `*/` 提前闭合 | §2.4 R2：显式标注 doc 遇首个 `*/` 闭合、正文含 `*/` 提前闭合（与 TS JSDoc 一致），v1 接受此限制；已核对 fixture 无 `*/` | 已知限制记录在案，非红灯覆盖项 | ✅（记录） |

**R1 全部 10 攻击点均已闭合**，无「承认但不改」条目。

## 三、R2 新发现（均 LOW / 非阻断，记录供 SA4/SA6 关注）

| # | 严重度 | 发现 | 说明与建议 | 是否阻断 |
|---|---|---|---|---|
| N1 | LOW | `pnpm-workspace.yaml` 含非标准 `allowBuilds: { esbuild: true }` 字段 | 任务简报「恢复说明」明确警告「不要在 pnpm-workspace.yaml 写非标准 allowBuilds 字段」。SA2 实测：pnpm 11.1.3 对该字段**静默忽略**（`pnpm install --frozen-lockfile` 无警告），esbuild 经 vitest 自带依赖可用（P3 transform 成功）——功能无害但属死配置。此为 SA6 骨架遗留，非 SA1 R2 引入；设计 §15 将该文件冻结于 DENY。建议 SA4/SA6 清理为标准 `onlyBuiltDependencies` 或直接移除（esbuild 由 vitest 自带，无需显式声明）。 | 否（骨架/SA6 范畴，不阻塞设计） |
| N2 | LOW | §2.5 `skipTriviaAndDoc` 伪代码引用 `lineComment`/`blockComment` token 类型 | §2.1 TokenType 不含这两类（`//`/`/* */` tokenizer 不产 token）。设计已自注「等价于只额外丢弃 doc」，意图清晰，SA3 实现时按「跳空白 + doc token」落地即可。属伪代码记号瑕疵，非设计缺陷。 | 否 |
| N3 | LOW | §2.2 EOF 示例字符计数偏差 | 示例 `type A = { x: string` 记 lastLine.length=19，实际为 20。但 EOF 不变量「column=lastLine.length+1 ∈ [1, lastLine.length+1]」与具体长度无关、恒成立，结论正确。仅示例数字笔误。 | 否 |
| N4 | LOW | `true`/`false` 作为别名名被字面量分派遮蔽 | 按 §4.2 优先级，`type true = string; type A = true` 中 `true` 走 Literal(boolean)，别名 `true` 不可达。与 TS 将 `true`/`false` 作关键字保留一致，行为合理；v1 未显式声明此保留。极端边缘、红灯未覆盖，非缺陷。可选在 §9 补「`true`/`false` 不得作别名名」明确化。 | 否 |

## 四、协议假设依据审查（R2 复核）

§16「协议假设依据」章节存在且 R2 已补全 P1–P7 实测证据。SA2 独立复核确认：
- P1–P5 均含**实测命令 + 输出**（非「应该/预计」类无据推断），且 SA2 已独立复现（见本报告第一节）。
- 依据可被 SA4 重跑验证（命令均为 cwd=worktree 根可重跑的标准 pnpm 命令）。
- 无 HTTP/WS/端口/进程生命周期/CI runner 资源假设；`exports`→dist 与 `vitest.config.ts` 冻结，未引入新协议假设。
- R1 指出的「§13.1 无据推断」缺陷已由 R2 实测证据闭合。✅

## 五、错误处理链路审查（R2 复核）

R1 结论维持：parseVfsl 纯函数，静默失败/状态闭环/降级路径合规，拒绝虚假降级立法完备。R2 无回退。攻击点 7 门控不引入静默路径（category 剥离 + loud 提示 issue）。✅

## 六、与红灯测试对齐（R2 复核）

R1 对齐结论维持：4 套件在手动 build 后可转绿。R2 路径 A 使**标准入口**（`pnpm test`/`test-lock.sh`）自动 build，红灯→绿灯路径可达。SA3 实现 parseVfsl 后，`pnpm test` 将：build 产 dist → 4 套件 import 解析 → 37 测试断言转绿 → exit 0。✅

## 裁决

**pass** ✅。

R1 CRITICAL 攻击点 1 已被路径 A 闭合，且**经 SA2 独立实测复现**（P1–P5 + test-lock.sh），非无据推断。攻击点 2–10 在 §4.2/§9/§2.5/§10.2/§14.1/§4.3/§2.4 均有实质改动闭合，与红灯对齐成立。R2 新发现 N1–N4 均为 LOW 非阻断（N1 属 SA6 骨架遗留、N2–N4 为伪代码/示例/边缘记号瑕疵），不构成 redesign 触发条件。

**SA3 可据此 R2 设计实现 `parseVfsl`**：落地四阶段流水线（tokenizer/parser/semantic/ir）+ 路径 A 脚本改写（根 `package.json` `scripts.test`/`scripts.test:vfsl` 与 `scripts/test-lock.sh` 前置 `pnpm --filter @nomicore/vfsl run build &&`）。实现后由 SA4 以 `rm -rf packages/vfsl/dist && pnpm test` 与 `rm -rf packages/vfsl/dist && bash scripts/test-lock.sh` 实测 gate 确认 exit 0 全绿。

— SA2，R2 复审完成，verdict=pass，放行 SA3 实现。

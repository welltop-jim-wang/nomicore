# SA7 动态验证报告

**Date**: 2026-08-18
**Reviewer**: SA7（Dynamic Verifier）
**Target**: SA3 实现 commit `6347bc1`（`@nomicore/vfsl` parser，四阶段流水线）
**SA4 verdict**: **pass** ✅（`task_prd-vfsl-v1-parser_sa4_review.md` 第 10 行）
**任务类型**: Feature（greenfield 纯引擎 parser）
**Worktree**: `/home/wangjian/nomicore-refactor-prd-vfsl-v1--parser`
**pnpm**: 11.1.3（与 SA4 一致）

## Verdict: **pass** ✅

> SA4 verdict=pass，SA7 在其基础上独立做活链路动态验证。双 gate（`pnpm test` + `bash scripts/test-lock.sh`）从干净 dist 实测 exit 0、37/37 全绿；40 项动态探针（经 dist 调用 `parseVfsl`）逐项验证纯函数确定性（含 50 路并发）、IR 可 JSON 序列化与可哈希、错误结构含 line/column 且落源内合法范围、越界输入与环检测运行时表现、六标记大小写契约运行时成立、零运行时依赖、超大输入性能——全部通过，未发现 SA4 未覆盖的运行时缺陷。SA7 未下调 SA4 verdict（pass→pass，符合「只能上发」约束）。

---

## Step 0：SA4 verdict 校对

读 `wiki/raw/task_prd-vfsl-v1-parser_sa4_review.md` 第 10 行：`**Verdict**: **pass** ✅`。

```
[SA7 Step 0 结论]
SA4 verdict: pass
操作: 进 Step 1/2 动态验证
```

SA4 已 pass，SA7 可进入动态验证；只能独立发现 fail 下调，不得洗白 SA4 reject（本任务不适用）。

---

## Step 1：双 gate 测试（独立进程，无 CI yml 故本地 gate 代替）

本任务 SA1 design 含 4 个 `*.test.ts`（happy-path / forbidden / cycle-detection / jsdoc），均位于 workspace package `@nomicore/vfsl`（`packages/vfsl`）。本 greenfield 仓库**无 `.github/workflows/` 目录、无任何 `.yml` CI 配置**（`ls .github/workflows/` → `No such file or directory`，`find . -name "*.yml" -not -path "*/node_modules/*"` 无命中）——SA4 §1.4 已确认。故按 SA4 §六.1 联动指示与总控 Hard Gate #14，SA7 改以本地双 gate 实测输出作为动态触发证据。

测试命令按 SKILL 测试执行规范起独立进程（`setsid nohup ... & disown`，纯函数单测、无端口、无外部服务）。

### Gate 1 — `rm -rf packages/vfsl/dist && pnpm test`

```
$ pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run
$ tsc -p tsconfig.json

 RUN  v3.2.7 .../packages/vfsl

 ✓ test/parse-vfsl.jsdoc.test.ts (5 tests) 6ms
 ✓ test/parse-vfsl.forbidden.test.ts (14 tests) 11ms
 ✓ test/parse-vfsl.happy-path.test.ts (13 tests) 13ms
 ✓ test/parse-vfsl.cycle-detection.test.ts (5 tests) 4ms

 Test Files  4 passed (4)
      Tests  37 passed (37)
   Duration  443ms
EXIT:0
```

### Gate 2 — `rm -rf packages/vfsl/dist && bash scripts/test-lock.sh`

```
$ tsc -p tsconfig.json

 RUN  v3.2.7 .../packages/vfsl

 ✓ test/parse-vfsl.jsdoc.test.ts (5 tests) 6ms
 ✓ test/parse-vfsl.forbidden.test.ts (14 tests) 11ms
 ✓ test/parse-vfsl.happy-path.test.ts (13 tests) 13ms
 ✓ test/parse-vfsl.cycle-detection.test.ts (5 tests) 4ms

 Test Files  4 passed (4)
      Tests  37 passed (37)
   Duration  464ms
EXIT:0
```

```
[SA7 Step 1 结论]
双 gate: 🟢 GREEN（exit 0，4 套件 37/37 全绿）
操作: 进入 Step 2 清单驱动验证
```

路径 A 编排（`run build` 前置产 dist → `exec vitest run` 经 exports 解析 `@nomicore/vfsl` 到 dist）经双 gate 从干净 dist 端到端实测闭合，与 design §16 P1–P4、SA4 §四一致。

---

## Step 2：清单驱动动态验证（SA4 §六 交 SA7 重点 + 运行时契约）

SA7 以动态探针（`/tmp/sa7-probe.mjs`，经 dist 调用 `parseVfsl`，40 项断言）逐条验证。**全部通过**，逐条结论如下。

### 2.1 纯函数确定性（design §11 / SA4 §三）

| 验证项 | 方法 | 结果 |
|---|---|---|
| 同一输入两次解析 deep equal | `JSON.stringify(parseVfsl(fx))` 两次比对 | ✅ |
| 错误输入确定性 | `type A = any;` 两次比对 | ✅ |
| 顺序 100× 重复确定性 | 100 次循环比对 | ✅ |
| 50 路并发确定性（SA4 §六.4） | `Promise.all` 50 个并行 parse，全等 base | ✅ 无共享状态泄露（parser 实例每次 `parseVfsl` 新建） |

### 2.2 IR 可 JSON 序列化与可哈希（design §5.3 / SA4 §三）

| 验证项 | 方法 | 结果 |
|---|---|---|
| fixture ok=true | `parseVfsl(fixture).ok` | ✅ |
| JSON 往返深等 | `JSON.parse(JSON.stringify(module))` 比对 | ✅ |
| 无 undefined 泄露 | 序列化串不含 `"undefined"` | ✅ |
| 无函数/Symbol 泄露 | 序列化串不含 `[object Function` | ✅ |
| 内容哈希稳定 | `sha256(canonicalJson)` 两次一致 | ✅ |
| 哈希形状合法 | 64-hex | ✅ |

### 2.3 错误结构含 line/column（design §0.1/§8 / SA4 §六）

15 项禁止清单负例（any/symbol/泛型/条件/mapped/interface/坏交叉/Pattern 非串/Record 单参/小写 ymap/索引签名/元组/未闭合注释/独立 Pattern/Record 无 `<>`）逐一经 `parseVfsl` 运行：

| 验证项 | 结果 |
|---|---|
| 全部 → `ok:false`，每条 issue 为 `{message:string(非空), line:integer, column:integer}` | ✅ |
| `any` 在第 3 行（`// c1\n// c2\ntype A = any;`）→ `issues.some(i => i.line === 3)`（§9.17 契约） | ✅ |
| 全部 issue `line ∈ [1, lineCount]`、`column ∈ [1, lineText.length+1]`（落源内合法范围） | ✅ |

### 2.4 越界输入与环检测运行时表现（design §10/§14 / SA4 §五）

| 用例 | 期望 | 结果 |
|---|---|---|
| 自环 `type A = A;` | ok:false | ✅ |
| 经字段自递归 `type A = { x: A }` | ok:false | ✅ |
| 互引用环 `A↔B` | ok:false | ✅ |
| 经字段互引用环 | ok:false | ✅ |
| 前向引用无环 `type A = B; type B = {...}` | ok:true（防过度拒绝） | ✅ |
| 经 marker 参数环 `YArray<B>; YMap<A>` | ok:false | ✅ |
| 空输入 `''` | ok:true, declarations:[] | ✅ |
| 仅注释 `// c\n/* b */` | ok:true | ✅ |
| CRLF `type A = any;\r\n` | ok:false, issue 落范围 | ✅ |
| EOF 未闭合 `type A = { x: string` | ok:false, issue 落范围 | ✅ |
| 嵌套泛型错误恢复 `YMap<Record<string, YArray<>>>` | ok:false, 无死循环/栈溢出 | ✅ |
| 14 个对抗输入（`///`/`{{{{`/`<<<<`/`""""`/`type A =`/...） | 不抛异常 | ✅ 0 throw |

### 2.5 六标记大小写契约运行时成立（design §6 / SA4 §二）

fixture 解析后 IR 序列化串包含全部六标记：`YMap`/`YArray`/`YPlainArray`/`YLeaf`/`YXmlFragment`/`Pattern` ✅。

| 运行时断言 | 结果 |
|---|---|
| 小写 `ymap<{}>` 被拒 | ✅ |
| 小写 `yarray<string>` 被拒 | ✅ |
| `YMap` 0 参被拒（arity=1 契约） | ✅ |
| `YArray` 0 参被拒 | ✅ |
| `YLeaf` 0 参合法（arity=0 契约） | ✅ |
| `YXmlFragment` 0 参合法 | ✅ |

### 2.6 零运行时依赖（design §0.2/§11 / SA4 §三）

对 dist 全部 6 个 `.js`（index/tokenizer/parser/semantic/types/errors）做运行时依赖扫描，正则 `require\(|node:|crypto|process\.|yjs|fetch\(|Math\.random|Date\.now` **无命中** ✅。`import type` 编译期擦除，dist 仅 `./...js` 自引用。探针自身 `import node:crypto` 仅供哈希验证，不属被测包运行时。

### 2.7 超大输入性能（SA4 §六.3 交 SA7 项）

| 验证项 | 结果 |
|---|---|
| 3000 别名（各含对象+YArray）解析 ok:true | ✅ |
| 3000 别名解析耗时 24ms（< 5s，无栈溢出） | ✅ |
| 200 深前向引用链 `A199→A198→...→A0`（非环）ok:true，无栈溢出 | ✅ |

> 探针编写中曾出现一次「200 深链报告未知引用 A198」的伪失败——经定位是探针构造链时误用赋值替换而非前置拼接，导致最终文本仅含 `type A199 = { child: A198 }` 单条声明、A198 未声明，parser 正确报「未知类型引用: A198」。修正探针为前置拼接后通过。此为探针缺陷，非 parser 缺陷；parser 行为正确（未知引用 loud 报错，符合 §10.2）。

---

## vitest 触发证据 (Hard Gate #14 — 2026-06-15 立法)

**事实陈述**：本 greenfield 纯引擎仓库**无 `.github/workflows/` 目录、无任何 `.yml` CI 配置文件**（SA4 §1.4 已确认；SA7 复核 `ls .github/workflows/` → `No such file or directory`、`find . -name "*.yml" -not -path "*/node_modules/*"` 无命中）。故 4 个 `*.test.ts` 在 PR/push 时无任何自动化 CI 触发——存在「测试存在但无 CI 自动运行」的 CI 黑洞风险，但**非 SA3 实现任务范围**（design §15 ALLOW/DENY 均不含 `.github/workflows/`），且路径 A 本地触发机制已验证成立。

按 SA4 §六.1 联动指示与总控 Hard Gate #14，SA7 **无法**经 `gh run view --log` 摘录 vitest 触发证据（无 CI run 可言），改以**本地双 gate 实测输出**作为动态触发证据，明示「无 CI yml，本地 gate 代替 `gh run view`」。

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| `@nomicore/vfsl` | 本地 `pnpm test`（路径 A：build + vitest） | ✓ 37 tests passed | `Test Files  4 passed (4)` / `Tests  37 passed (37)` / `EXIT:0` |
| `@nomicore/vfsl` | 本地 `bash scripts/test-lock.sh`（路径 A：build + vitest） | ✓ 37 tests passed | `Test Files  4 passed (4)` / `Tests  37 passed (37)` / `EXIT:0` |

涉及的 4 个 `*.test.ts`（均在 `@nomicore/vfsl`）：

| 测试文件 | 触发结果 | log 摘录 |
|---|---|---|
| `packages/vfsl/test/parse-vfsl.happy-path.test.ts` | ✓ 13 tests passed | `✓ test/parse-vfsl.happy-path.test.ts (13 tests)` |
| `packages/vfsl/test/parse-vfsl.forbidden.test.ts` | ✓ 14 tests passed | `✓ test/parse-vfsl.forbidden.test.ts (14 tests)` |
| `packages/vfsl/test/parse-vfsl.cycle-detection.test.ts` | ✓ 5 tests passed | `✓ test/parse-vfsl.cycle-detection.test.ts (5 tests)` |
| `packages/vfsl/test/parse-vfsl.jsdoc.test.ts` | ✓ 5 tests passed | `✓ test/parse-vfsl.jsdoc.test.ts (5 tests)` |

**verdict**: ✅ all-vitest-packages-triggered（本地双 gate 代替 CI；无 CI yml 的事实已明示）

> 失败处置说明：`vitest-package-not-triggered` 的字面判定（package 不在任何 workflow 范围）在此 greenfield-no-CI 语境下为假阳性——无 workflow 可言范围。SA3 的 parser 实现任务范围不含建立 CI yml，路径 A 本地触发已双 gate 验证成立，**不构成阻断**。建议回流 SA1/infra：新增 `.github/workflows/ci.yml` 运行 `pnpm install && pnpm test`，闭合 greenfield 无 CI 黑洞（与 SA4 §1.4 处置一致）。

---

## Step 3：E2E spec 触发证据

N/A——本任务无 `*.spec.ts`（E2E），仅有 `*.test.ts`（vitest 单元），走 Step 4（上方「vitest 触发证据」段）。

---

## 非阻断回流清单（与 SA4 一致）

- → SA1/infra：新增 `.github/workflows/ci.yml` 运行 `pnpm test`（路径 A 已含 build 前置），使 4 套件在 PR/push 自动触发；design ALLOW LIST 相应扩展含 `.github/workflows/*.yml`。
- → SA1/SA6：清理 `pnpm-workspace.yaml` 非标准 `allowBuilds` 字段（SA2 N1，确认无害，建议清理以符文件注释）。

均非阻断，不影响 SA7 verdict。

---

## 审核结论汇总

| # | 维度 | 结论 |
|---|---|---|
| 0 | SA4 verdict 校对 | ✅ pass（SA7 不下调） |
| 1 | 双 gate 测试 | ✅ exit 0，37/37 全绿（pnpm test + test-lock.sh） |
| 2 | 纯函数确定性 | ✅ 顺序 + 50 路并发均 deep equal |
| 3 | IR 可序列化与可哈希 | ✅ JSON 往返深等、无 undefined/函数/Symbol、内容哈希稳定 |
| 4 | 错误结构 line/column | ✅ 15 禁止项全 valid issue、any line===3、全落源内范围 |
| 5 | 环检测与越界运行时 | ✅ 自/互/字段/marker 环全拒、前向合法、14 对抗输入 0 throw |
| 6 | 六标记大小写契约 | ✅ 六标记入 IR、小写被拒、arity 运行时成立 |
| 7 | 零运行时依赖 | ✅ dist 6 个 .js 无 node:/crypto/process/yjs/fetch |
| 8 | 超大输入性能 | ✅ 3000 别名 24ms、200 深链无溢出 |
| 9 | vitest 触发证据 | ✅ 本地双 gate 代替 CI（无 CI yml 已明示） |

**Verdict: pass** ✅ — SA3 `parseVfsl` 运行时行为经活链路动态验证全部符合 SA1 R2 设计契约与 SA4 静态结论：纯函数确定性（含并发）、IR 可序列化与可哈希、错误模型行列精确且落源内、环检测与禁止清单运行时完备、六标记大小写与 arity 契约成立、零运行时依赖、超大输入无栈溢出/性能退化。双 gate 37/37 全绿。无 SA4 未覆盖的运行时缺陷。回流项均非阻断。

— SA7，动态验证完成，verdict=pass。

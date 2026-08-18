# SA4 静态验尸报告

**Date**: 2026-08-18
**Reviewer**: SA4（Red Team Hacker）
**Target**: SA3 实现 commit `6347bc1`（`@nomicore/vfsl` parser，四阶段流水线）
**设计契约**: `wiki/raw/task_prd-vfsl-v1-parser_design.md` R2（SA2 verdict=pass）
**任务类型**: Feature（greenfield 纯引擎 parser）
**红灯基线**: SA6 4 套件（`packages/vfsl/test/parse-vfsl.{happy-path,forbidden,cycle-detection,jsdoc}.test.ts`）

**Verdict**: **pass** ✅

> SA3 的实现严格遵循 SA1 R2 设计契约：四阶段流水线（tokenizer/parser/semantic/IR）落地完整，§4.2 标识符分派、§9 禁止清单、§10 DFS 三色环检测、§2.5 leading-position-only doc 挂载、§4.3 尖括号深度 resync、§14.1 重复别名保留首次、§10.2 语法错误级联门控均与设计一致并经实测复核。IR 纯 JSON 可序列化、零运行时依赖、纯函数确定性、不抛异常——全部经动态探针验证。路径 A 编排（根 `package.json` + `scripts/test-lock.sh` 前置 `run build`）经 `rm -rf dist && pnpm test` 与 `rm -rf dist && bash scripts/test-lock.sh` 双 gate 实测 exit 0、37/37 全绿。SA3 commit 严格落在 ALLOW LIST 内，无 scope creep。唯一需回流项为 SA2 N1（`pnpm-workspace.yaml` 非标准 `allowBuilds` 字段仍未清理，DENY 文件 SA4 不改，确认无害+建议 SA1/SA6 清理）与本 greenfield 仓库无 CI yml 的事实陈述（§1.4）。均非阻断。

---

## 一、前置上下文核验

已按 SKILL「前置步骤」顺序读取：任务简报 → SA1 design R2 → SA2 R1/R2 verdict（needs-redesign→pass，含 N1–N4 LOW 新发现）→ SA3 源码（6 文件）→ 4 测试套件 + helpers + fixture → 配置文件。cwd 为 worktree 根 `/home/wangjian/nomicore-refactor-prd-vfsl-v1--parser`，所有命令均指向该路径。

---

## 二、验尸清单逐项结论

### 1. 设计一致性审查

#### 1.1 文件清单 Scope Creep Guard

**ALLOW LIST 抽取**（design §15）：`packages/vfsl/src/{index,types,tokenizer,parser,semantic,ir,errors}.ts`、`packages/vfsl/test/*`（4 套件 + helpers + fixture，`[SA6 owned]`）、`packages/vfsl/package.json`、`packages/vfsl/tsconfig.json`、根 `package.json`、`scripts/test-lock.sh`。DENY：`vitest.config.ts`、`pnpm-workspace.yaml`、根 `tsconfig.json`、`TASK.md`/`LICENSE`/`.gitignore`、`wiki/**`、`dist/**`。

**SA3 commit `6347bc1` 实际改动**（`git show --stat`）：
```
package.json                  |  4 +-   (scripts.test 前置 build — ALLOW ✓)
packages/vfsl/package.json    |  2 +-   (version 0.1.0→0.1.1 — ALLOW ✓)
packages/vfsl/src/errors.ts   | 24 ++   (ALLOW ✓)
packages/vfsl/src/index.ts    | 29 +-   (ALLOW ✓)
packages/vfsl/src/parser.ts   | 628 ++  (ALLOW ✓；IR 并入 parser.ts，design §15 明示「SA3 可并入」)
packages/vfsl/src/semantic.ts | 110 ++  (ALLOW ✓)
packages/vfsl/src/tokenizer.ts| 200 ++  (ALLOW ✓)
packages/vfsl/src/types.ts    | 68 ++   (ALLOW ✓)
scripts/test-lock.sh          |  6 +-   (ALLOW ✓)
```

**结论：SA3 commit 100% 落在 ALLOW LIST，零 scope creep。** `ir.ts` 未单独创建（IR 构建并入 parser.ts），design §15 明示允许。

**全分支 diff（`origin/main..HEAD`）额外文件处置**（SA6/SA1 骨架提交引入，非 SA3 改动）：

| 文件 | 清单归属 | 处置 |
|---|---|---|
| `pnpm-lock.yaml` | whitelist | ✅ 豁免 |
| `wiki/raw/*` | whitelist | ✅ 豁免（SA 流水线档案） |
| `.gitignore` | DENY（仓库基线） | greenfield 骨架基线（SA6 commit `7317237`，仅忽略 `node_modules/dist/.dsh/.mabf-bg`），必要基础设施，非 SA3 改动。非阻断。 |
| `tsconfig.json`（根） | DENY | greenfield 骨架基线（SA6 创建），SA3 未改。非 SA3 creep。 |
| `packages/vfsl/vitest.config.ts` | DENY（冻结） | greenfield 骨架基线（SA6 创建），SA3 未改（include/environment 不变）。非 SA3 creep。 |
| `pnpm-workspace.yaml` | DENY（冻结） | greenfield 骨架基线（SA6 创建），SA3 未改。但含非标准 `allowBuilds` 字段——见 **SA2 N1** 专项。 |
| `TASK.md` | DENY（仓库基线） | **见下方专项判定**。 |

**TASK.md BLACKLIST 专项判定**：SKILL §1.1 5b BLACKLIST 含 `^TASK\.md$`（背景：issue-runner runtime 残留，PR #253 事故）。`TASK.md` 出现在全分支 diff 中，字面命中该 pattern。**但**：

1. 本仓库 `TASK.md` 内容为任务 PRD 正文（Problem Statement / User Stories / Implementation Decisions / Out of Scope），任务简报明示「TASK.md 是唯一真相源」「仓库为 greenfield（仅 LICENSE/.gitignore/TASK.md）」——它是仓库的源真相文档，**不是 issue-runner runtime 残留**。
2. design §15 DENY LIST 自身将 `TASK.md` 列为「仓库基线」——即设计者认定其为应存在的基线文件；greenfield 仓库基线须由 SA6 首建。
3. 该文件由 SA6（commit `b1a335f`）创建，SA3 commit 未触碰。

**裁定**：BLACKLIST `^TASK\.md$` 在本 greenfield 语境下为**假阳性**——pattern 命中但语义意图（issue-runner 残留）不适用。`TASK.md` 是声明的源真相 PRD，非 runtime 残留。**不构成 BLACKLIST 违反**。记录此判定以可审计；若总控认为 greenfield 仓库亦不应 commit TASK.md，属编排策略议题，非 SA3 实现缺陷。

**BLACKLIST 其余项**（`package-lock.json` / `yarn.lock` / `.DS_Store` / `*.bak`）：全分支 diff 均未命中。✅

#### 1.2 设计偏离审查

逐条对照 SA1 R2 设计决策与 SA3 实现：

| 设计契约 | SA3 实现 | 一致性 |
|---|---|---|
| §1 四阶段流水线 tokenize→parse→semantic→build IR | `index.ts` 依序调用 `tokenize`→`new Parser().parseModule()`→`runSemantic`→判 issues 返回 | ✅ |
| §0.1 公共接缝 `parseVfsl(text)→判别联合`、Issue 三字段 | `index.ts` 导出 `parseVfsl`，`toPublicIssue` 剥离 `category` 仅留 message/line/column | ✅ |
| §4.2 分派优先级 Primitive>true/false>MarkerName>Record>TypeRef | `parseIdentifierType` 顺序：五原始→any/symbol→true/false→Record→MarkerName→TypeRef | ✅ |
| §4.2 数字 token 直接构造 Literal(number) | tokenizer 产 `number` token；`parsePrimary` case 'number' → `Literal(Number(t.value))` | ✅ |
| §9 禁止清单 12+ 检测点 | parser 逐项实现（any/symbol/泛型/条件/映射/索引/元组/interface/交叉/Record 参/独立 Pattern/小写标记/Record 无 `<>`） | ✅（动态探针逐项验证，见 §五） |
| §9.15 独立 Pattern 检测（合法上下文唯一：intersection.right 且 left==string） | `checkPatternContexts`/`walkPattern`，intersection 传 `{left:type.left}` 给 right，其余传 null | ✅ |
| §10.1 DFS 三色环检测 + §10.4 按成员集合去重 | `semantic.ts` color Map + stack + reported Set，回边按 `stack.slice(idx).sort().join(',')` 去重 | ✅ |
| §10.2 hasSyntaxIssue 门控（category 内部标签，返回前剥离） | `runSemantic` 判 `issues.some(category==='syntax'\|\|'forbidden')`，为真跳过未知引用、追加 (1,1) 提示 issue | ✅ |
| §2.5 leading-position-only doc 挂载 + skipTriviaAndDoc 丢弃非 leading doc | `consumeLeadingDoc`（most-recent-wins）+ `skipTriviaAndDoc`（结构位置清场）+ `skipTrailingDocs`（保留后跟标识符的 leading doc） | ✅ |
| §2.2 CRLF `\r` 不推进 column；EOF=(line, max(1,lastLine.length+1)) | tokenizer `\r` 触发换行不 +column；EOF `column: Math.max(1, column)` | ✅（动态探针 CRLF/EOF 落范围） |
| §2.3 字符串保留转义原文（不反转义） | tokenizer `\` 转义：value += '\\' + next，保留双反斜杠 | ✅（happy-path `^[a-z0-9]+(\\.[a-z0-9]+)*$` 断言通过） |
| §14.1 重复别名 decl 保留首次 | `parseTypeAlias`：`isNew = !decl.has(name)`，仅 isNew 时 `decl.set`/`aliasTypes.set`，第二处仅 issue | ✅ |
| §4.3 尖括号深度计数 resync | `resyncTypeExpr`/`skipToEquals` depth 计数 | ✅ |
| §11 纯函数、不抛异常、零运行时依赖 | 见 §三、§四 | ✅ |
| §5.3 IR 纯 JSON（禁 undefined/函数/Symbol/Map/Date） | optional:boolean、doc:null、argument:null；DUMMY 仅 ok=false 时不返回 | ✅（动态探针无 undefined 泄露） |

**无危险偏离**。SA3 将 IR 构建并入 parser.ts（design 明示允许）、未单独建 `ir.ts`，属合理简化。

#### 1.3 E2E spec runner 触发性自检

N/A——本任务无 `*.spec.ts`（E2E），仅有 `*.test.ts`（vitest 单元），走 §1.4。

#### 1.4 vitest 触发性自检（Hard Gate #14 必含结论段）🚨

**触发条件命中**：SA1 design 含 4 个 `*.test.ts`（happy-path / forbidden / cycle-detection / jsdoc），均位于 workspace package `@nomicore/vfsl`（`packages/vfsl`）。

**门禁执行**：
1. 抽 design 涉及的 `*.test.ts` → 4 文件，所在 package = `@nomicore/vfsl`（`packages/vfsl/package.json` name 字段确认）。
2. grep 仓库根 `.github/workflows/*.yml` 中所有 vitest 调用（`vitest run`）以提取 `--filter`/`--project`/package 覆盖范围。
3. **事实陈述**：本 greenfield 纯引擎仓库**无 `.github/workflows/` 目录、无任何 `.yml` CI 配置文件**（`find . -name "*.yml"` 排除 node_modules 后无命中，`ls .github/workflows/` 确认不存在）。

**结论**：vitest 经 `pnpm test` / `bash scripts/test-lock.sh`（路径 A：`pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run`）本地触发，SA4 已双 gate 实测 exit 0、37/37 全绿。但**仓库无 CI workflow yml**，故 4 套件在 PR/push 时无任何自动化 CI 触发——存在「测试存在但无 CI 自动运行」的 **CI 黑洞风险**。

**风险定性**：此与 issue #289（PR #287/#288）的根因**形似而本质不同**。#289 是「workflow 已存在但未覆盖新增 package 的 vitest」（接线缺陷，§1.4 REJECT 的设计目标）；本任务是「greenfield 仓库尚未建立任何 CI 基础设施」（CI 缺位，非接线缺陷）。SA3 的 parser 实现任务范围不包含建立 CI yml（design §15 ALLOW/DENY 均不含 `.github/workflows/`），且路径 A 本地触发机制已验证成立。故**不构成阻断 SA3 实现的 REJECT**——`vitest-package-not-triggered` 的字面判定（package 不在任何 workflow 范围）在此 greenfield-no-CI 语境下为假阳性（无 workflow 可言范围）。

**处置**：
- **不阻断** SA3 verdict（CI 基础设施是独立编排议题，超出本 parser feature 范围）。
- **回流 SA1/infra**（建议）：为本 greenfield 仓库新增 `.github/workflows/ci.yml`，job 运行 `pnpm install && pnpm test`（路径 A 已含 build 前置），使 4 套件在 PR/push 自动触发。design ALLOW LIST 须相应扩展含 `.github/workflows/*.yml`。
- **SA7 联动提示**：因无 CI yml，SA7 动态验证阶段**无法**经 `gh run view --log` 摘录 vitest 触发证据；须改以本地 `rm -rf packages/vfsl/dist && pnpm test` 与 `bash scripts/test-lock.sh` 实测输出作为动态触发证据（SA4 已预跑，见 §四）。

#### 1.5 协议假设审查

SA2 R2 已复核 design §16 P1–P7 实测证据（`pnpm exec` vs `pnpm run` 语义、`tsc`→dist、vitest 经 exports 解析到 dist）。SA4 独立复跑路径 A 端到端（见 §四），与 §16 声称一致。无 HTTP/WS/端口/进程/第三方库运行时假设。✅

#### 1.6 契约改动连锁审查 (Contract Change Rippling)

design §17 已声明：`parseVfsl` 是 greenfield 全新 API，无既有 caller；SA3 脚本变更（根 `package.json`/`test-lock.sh` 前置 build）属编排变更，非 API 契约变更（无签名/返回/throw/sync-async 改动）。SA4 复核：SA3 commit 未改任何既有 export 函数的 throw/return 契约（全是新增函数），无 caller 连锁。✅ N/A。

#### 1.7 测试质量审查：源码 GREP 断言禁令

扫描 4 个 `*.test.ts`：均经 `parseVfsl(text)` 公共入口断言输入→输出（`expect(r.ok).toBe(...)`、`collectStrings/nodeByName` 形状无关断言、`expectIssueShape` 形状校验）。**无** `readFileSync(<源码>).toMatch/toContain` 反模式——`readFileSync` 仅用于读 fixture `vfs3-assets.vfsl`（数据输入，非源码字符串断言）。✅ 测试锚定运行时行为，非伪测试。

### 2. 读写路径一致性审查

parseVfsl 是纯函数：输入 `text`（只读）→ 输出 IR/issues。无外部数据源、无写路径、无读写分叉可能。内部四阶段通过 `issues: InternalIssue[]` 共享引用追加（tokenizer→parser→semantic 顺序写入同一数组），无状态分叉。✅

### 3. 静默失败专项扫描

逐路径 trace：
- 每个越界构造（§9）均 push 结构化 issue（loud），非静默丢弃。
- tokenizer 孤立 `/` 与无法识别字符 → loud 词法 issue（`无法识别的字符`），不静默丢弃。
- 未闭合注释/未终止字符串 → loud 词法 issue。
- ok=true 当且仅当 `issues.length === 0`（`index.ts` 判定）；任一 issue → `{ok:false, issues}`，**不返回 module**（§11 拒绝虚假降级）。
- §10.2 门控跳过未知引用检查时**追加** (1,1) 提示 issue（「语义检查已跳过，结果不完整」）——loud 标注，非静默。

**动态探针验证**：38 个对抗输入无一静默失败，所有 ok=false 路径均产出 ≥1 条结构化 issue。✅

### 4. 降级方案审查

- **DUMMY 占位节点**（`{kind:'primitive',name:'unknown'}`）：仅伴随 issue 出现在错误分支（如缺参 marker、resync 后字段），ok=false 时不返回 module，故 DUMMY **永不进入公共 IR**。动态探针确认所有 ok=true 结果无 DUMMY 污染。非虚假降级——是 best-effort resync 的内部占位，不掩盖错误。✅
- **重复别名保留首次**（§14.1）：loud issue + 首次声明保留，不静默覆盖/合并。✅
- **语法错误级联门控**（§10.2）：跳过未知引用检查是显式声明的信噪比优化，非掩盖——追加提示 issue 明示「结果不完整」。✅
- **无外部依赖可降级**：纯函数无网络/存储，无降级路径。✅

### 5. 极端条件攻击（动态探针验证）

SA4 以 38 个对抗输入动态探针（`/tmp/sa4-probe.mjs`，经 dist 调用 `parseVfsl`）验证：

| 攻击面 | 探针 | 结果 |
|---|---|---|
| `true`/`false`/数字字面量 | `type A = { flag: true; code: 1 \| 2 }` | ok=true ✅（攻击点 2 闭合） |
| 独立 Pattern（各非法位置） | standalone/field/union/left-of-& | ok=false，issue 锚定 Pattern token ✅（攻击点 3 闭合） |
| 合法 string & Pattern | `string & Pattern<"^a+$">` | ok=true ✅（防过度拒绝） |
| YLeaf/YXmlFragment 0 参 | `{ leaf: YLeaf }`、`{ xml: YXmlFragment }` | ok=true ✅（攻击点 4b 闭合） |
| YMap/YArray 0 参 | `{ m: YMap }`、`{ a: YArray }` | ok=false，arity 错误 ✅ |
| Record 无 `<>` | `{ x: Record }`、`type A = Record` | ok=false，锚定 Record ✅（攻击点 4a 闭合） |
| trailing/inline doc | `name: string /** doc */`、字段间 doc | ok=true，不崩溃 ✅（攻击点 5 闭合） |
| CRLF | `type A = any;\r\n`、多行 CRLF | issue column 不越界 ✅（攻击点 6 闭合） |
| EOF 未闭合 | `type A = { x: string`（无尾换行/带空行） | issue 落 (1,21)/(3,1)，均 ∈ expectIssueShape 范围 ✅ |
| 嵌套泛型错误恢复 | `YMap<Record<string, YArray<>>>` | ok=false，无死循环/栈溢出，锚定最内层 ✅（攻击点 9 闭合） |
| 空输入/仅注释 | `''`、`// c\n/* b */` | ok=true，declarations=[] ✅ |
| 自环/互环/经字段环 | 4 用例 | ok=false，环检测命中 ✅ |
| 前向引用合法 | `type A = B; type B = {...}` | ok=true ✅（防过度拒绝） |
| 重复别名 | `type A=...; type A=...` | ok=false，锚定第二处 ✅ |
| any 行号精确 | 前置 2 行注释 + `type A = any;` | issue.line===3 ✅（§9.17 契约） |
| marker 参数为 ref 的环 | `type A = YArray<B>; type B = YMap<A>` | ok=false，环检测命中（collectRefs 覆盖 marker-arg）✅ |
| doc 含 `*/` | `/** doc with */ inside */` | ok=false，doc 首个 `*/` 闭合，余 token 流入（§2.4 已知限制，TS JSDoc 一致）✅ |
| IR 可序列化 | 所有 ok=true 探针 `JSON.parse(JSON.stringify(module))` | 无 undefined/函数/Symbol 泄露 ✅ |
| 不抛异常 | 38 输入 | 0 throw ✅（§11 契约） |

**未发现漏洞**。所有边界行为符合设计契约。

### 6. 错误处理链路审查

所有分支（if/else、try/catch 无——纯同步无 try、提前 return、resync）均对应 issue 写入或合法返回。错误锚点均落源内合法位置（动态探针 38 例无一越界）。词法/语法/禁止/语义四类 issue 经 `category` 内部标签聚合，返回前剥离为三字段公共形状。✅

### 7. 架构死胡同检测

无触发退回 SA1 信号：SA3 实现未绕过架构约束（无硬编码绕过、无 `// FIXME`、无临时补丁）；数据流与 design §1 一致；无降级作为唯一可行路径；改动半径限于 `packages/vfsl/src` + 2 处入口脚本。✅

### 8. 过度设计审查

- 抽象层级：四阶段切分与 design §13 推荐一致，无多余 factory/class（仅 `Parser` 一个类，合理）。
- 防御过度：DUMMY 占位、resync 深度计数均对应真实错误恢复需求，非守护不可能边界。
- 变更半径：SA3 commit 仅触碰 parser 实现文件 + 入口脚本，未越界。
- 复杂度：628 行 parser 覆盖 §3 文法 + §9 十余检测点 + §2.5 doc 三态 + §4.3 resync，复杂度与设计契约匹配，非过度。✅

---

## 三、非功能硬约束复核

| 约束（§0.2） | 复核方法 | 结论 |
|---|---|---|
| 零运行时依赖 | `grep -rEn "node:\|crypto\|yjs\|process\.\|Date\.now\|Math\.random\|fetch\(\|require\(" packages/vfsl/src/` | 无命中；src 仅 `import` 自身 `./...js` 模块，`import type` 编译期擦除。dist 仅 6 个 `.js`。✅ |
| 纯函数 | 源码无 `Date.now`/`Math.random`/`process.*`/文件/网络读取；`parseVfsl(t)===parseVfsl(t)` 红灯断言通过 | ✅ |
| 可序列化 | 动态探针所有 ok=true 结果 `JSON.parse(JSON.stringify(module))` 深等；无 undefined/函数/Symbol/Map/Date | ✅ |
| 可哈希 | IR 纯 JSON 树，字段按解析顺序 push（稳定 key 序），`canonicalJsonify` 可行性满足（本任务不产哈希字段） | ✅（可行性） |

---

## 四、路径 A 编排与双 gate 实测（SA2 攻击点 1 闭合复核）

按 SKILL 测试执行规范（独立进程 `setsid nohup`）：

**Gate 1 — `rm -rf packages/vfsl/dist && pnpm test`**：
```
$ pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run
$ tsc -p tsconfig.json
 ✓ test/parse-vfsl.happy-path.test.ts (13 tests)
 ✓ test/parse-vfsl.jsdoc.test.ts (5 tests)
 ✓ test/parse-vfsl.forbidden.test.ts (14 tests)
 ✓ test/parse-vfsl.cycle-detection.test.ts (5 tests)
 Test Files  4 passed (4)
      Tests  37 passed (37)
EXIT:0
```

**Gate 2 — `rm -rf packages/vfsl/dist && bash scripts/test-lock.sh`**：
```
 Test Files  4 passed (4)
      Tests  37 passed (37)
EXIT:0
```

路径 A 闭合：`run build` 产 dist → `exec vitest run` 经 exports 解析 `@nomicore/vfsl` 到 dist → 4 套件 37/37 全绿、exit 0。与 design §16 P1–P4、SA2 R2 复核一致。✅

**Hard Gate #9 版本 bump 复核**：`packages/vfsl/package.json` version `0.1.0`（SA6 骨架）→ `0.1.1`（SA3 commit `6347bc1`），已做。✅
（注：design §15 曾称该文件「最终不修改」，但 Hard Gate #9 要求版本 bump；SA3 正确优先 Hard Gate。文件在 ALLOW LIST 内，非偏离。）

---

## 五、SA2 N1 专项处置（任务简报指定）

**N1**：`pnpm-workspace.yaml` 含非标准 `allowBuilds: { esbuild: true }` 字段。

**SA4 复核**：
- 字段**仍存在**（未清理）：文件内容含 `allowBuilds:\n  esbuild: true`，且文件自身注释写「不添加任何非标准字段（如 allowBuilds）」——**自相矛盾**（注释声明不添加，却实际添加了）。
- pnpm 11.1.3 对该字段**静默忽略**（SA2 N1 已实测；esbuild 经 vitest 自带依赖可用，dist transform 成功）——**功能无害**，属死配置。
- 该文件 design §15 列入 **DENY**（冻结），SA4 不修改生产/配置代码，**不自行清理**。
- 创建者为 SA6 骨架（commit `b1a335f`），非 SA1 R2 / SA3 引入。

**处置**：**确认无害**（死配置，pnpm 静默忽略，esbuild 经 vitest 自带依赖工作正常，双 gate 37/37 全绿佐证）。**非阻断**。建议 SA1/SA6 移除 `allowBuilds` 块以符文件自身注释意图（esbuild 由 vitest 自带，无需显式声明）。回流目标：SA1/SA6。

**SA2 N2–N4 复核**：
- N2（§2.5 伪代码引用 `lineComment`/`blockComment` token 类型）：SA3 实现未引入这两类 token（tokenizer `//`/`/* */` 不产 token），`skipTriviaAndDoc` 实际只丢弃 `doc` token——与 design 自注一致。✅ 已正确落地。
- N3（§2.2 EOF 示例字符计数偏差）：动态探针 EOF 锚点 (1,21)/(3,1) 落 expectIssueShape 范围，不变量成立。✅
- N4（`true`/`false` 作别名名被字面量分派遮蔽）：动态探针 `type A = { flag: true }` ok=true，行为符合 TS 关键字保留语义。v1 未显式声明此保留，极端边缘、红灯未覆盖，非缺陷。✅

---

## 六、动态审核重点（交 SA7）

SA4 静态验尸 + 动态探针已覆盖绝大多数风险点。以下交 SA7 在真实环境进一步确认：

1. **CI 触发证据（§1.4 联动）**：本仓库无 `.github/workflows/`，SA7 **无法**经 `gh run view --log` 摘录 vitest 触发证据。SA7 须改以本地 `rm -rf packages/vfsl/dist && pnpm test` 与 `bash scripts/test-lock.sh` 实测输出（exit 0 + 37/37）作为动态触发证据，并在报告明示「无 CI yml，本地 gate 代替」。
2. **pnpm 版本兼容**：路径 A 经 pnpm 11.1.3 验证。SA7 若在不同 pnpm 版本运行，确认 `pnpm --filter ... run build && ... exec vitest run` 语义不变（`exec` 不触发包 test 脚本的语义在 pnpm 9+ 一致）。
3. **超大输入性能**：SA4 探针未测超长文本（数千别名/深嵌套）。建议 SA7 以大 fixture 验证无栈溢出/性能退化（resync 深度计数、DFS 递归深度）。
4. **并发确定性**：纯函数已锚定 `toEqual`，SA7 可在高并发下重复跑确认无共享状态泄露（parser 实例每次 `parseVfsl` 新建，无静态可变状态——SA4 静态确认无共享）。

---

## 七、审核结论汇总

| # | 维度 | 结论 |
|---|---|---|
| 1 | 设计一致性 | ✅ 一致（SA3 commit 100% 落 ALLOW，零 scope creep；TASK.md BLACKLIST 为 greenfield 假阳性） |
| 2 | 读写路径一致性 | ✅ 一致（纯函数，无分叉） |
| 3 | 静默失败 | ✅ 无（38 探针无一静默） |
| 4 | 降级方案 | ✅ 安全（DUMMY 不入公共 IR；门控 loud 标注） |
| 5 | 极端攻击 | ✅ 安全（38 对抗输入无漏洞） |
| 6 | 错误处理 | ✅ 完整（四类 issue 聚合，三字段公共形状） |
| 7 | 架构评估 | ✅ 可行（无死胡同信号） |
| 8 | 过度设计 | ✅ 精简（复杂度与契约匹配） |

**回流清单**（均非阻断）：
- → SA1/SA6：清理 `pnpm-workspace.yaml` 非标准 `allowBuilds` 字段（SA2 N1，确认无害，建议清理以符文件注释）。
- → SA1/infra：新增 `.github/workflows/ci.yml` 运行 `pnpm test`，闭合 greenfield 无 CI 的黑洞风险（§1.4）；ALLOW LIST 相应扩展。
- → SA7：以本地双 gate 代替 `gh run view` 作为 vitest 触发证据（无 CI yml）。

**Verdict: pass** ✅ — SA3 实现符合 SA1 R2 设计契约，四套件 37/37 全绿经双 gate 实测，无静默失败/虚假降级/状态撕裂/契约违反，IR 可序列化与可哈希声称真实，环检测与禁止清单覆盖完备，错误模型行列精确，六标记大小写契约成立，parseVfsl 纯函数性成立，零运行时依赖经 grep 确认，Hard Gate #9 版本 bump 已做，路径 A 编排正确。SA7 可进入动态验证（以本地 gate 代替 CI 触发证据）。

— SA4，静态验尸完成，verdict=pass。

# SA2 攻击评审报告 — namespace-runtime Registry 专用受限生产构造 seam（issue #109）

**Date**: 2026-08-25
**Verdict**: **pass**（附 2 条 LOW、3 条 INFO 非阻塞发现；无 CRITICAL/HIGH。`pass` 仅表示设计通过审查，不替代 SA4/SA7 对实现与活链路的验证。）

- 被审对象：`wiki/raw/task_namespace-runtime-registry-seam_design.md`（SA1 R0 初版）
- ADR 约束基准：`wiki/raw/task_namespace-runtime-registry-seam_relevant_decisions.md`（ADR 0006/0007/0008/0009 摘录 + SA8 设计后复审 N1–N8）
- 评审方式：全新视角独立攻击；所有设计事实声明逐条对照 worktree HEAD `3451eca` 源码实测复核（证据见文末附录 A）；红灯验收测试独立复跑取证。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | LOW | AC5 审计正则盲区（设计 §D-F 所依赖的 SA6 审计机制） | 审计正则只匹配 `from '…'` 与 `import('…')` 两种形态：**裸副作用导入** `import '@nomicore/namespace-runtime/internal'`（无 `from` 子句）、`require(...)`/`createRequire` 形态、以及**非 TS 生产文件**（.js/.mjs/.cjs——walk 过滤器为 `/\.(ts\|tsx\|mts\|cts)$/`）均不可见。触发条件：未来任一生产文件以上述形态消费 subpath。影响：AC5 边界测试假绿，ADR 0009「只能由 Registry 生产代码消费」出现审计不可见的绕行通道。当前暴露面为零（已核实：仓内 packages/domains/apps 生产树无任何 .js/.mjs/.cjs 文件；现消费方为空集），且最常见的手写形态 `from '…'` 已被覆盖——故非阻塞 | 本 ticket 不要求改（测试文件 SA6-owned 且现无暴露）。登记为切片 5/6 落地前的审计加固项：经 SA6/总控授权扩展 `importRe`（补裸 import / require 形态）与文件扩展名过滤（补 .js/.mjs）。测试构想见「红灯测试思路」#1 |
| 2 | LOW | AC5 白名单粒度 vs ADR 0009「Registry **生产**代码」的字面/精神边界 | 白名单谓词 `packages/namespace-registry/src/` 前缀无法区分 Registry 包未来的**受控 testing subpath** 实现文件（ADR 0009 明言该包含 testing subpath；phase-4 文档「Testing subpath 仅允许替换 Runtime factory…」）。触发条件：切片 5/6 后 `packages/namespace-registry/src/testing.ts` 之类文件 import internal factory。影响：testing seam 文件会通过审计，但 ADR 0009 的措辞是「生产代码」——testing subpath 是否获豁免属未裁定地带，届时若无人显式裁决，边界语义被前缀谓词静默放宽 | 本 ticket 不阻塞（registry 包不存在，白名单前瞻空集是简报钦定形态）。要求：切片 5/6 的设计文档必须显式裁定「registry testing subpath 文件是否属『Registry 生产代码』」，并把裁定落进谓词（若否，排除 `src/testing*.ts` 或收窄到 Registry 核心子目录）。测试构想见「红灯测试思路」#2 |
| 3 | INFO | SA6 测试 helper `buildViaInternalFactory` 的 catch-fallback 掩蔽合法构造 throw | 该 helper 对两参调用 catch **一切** throw 后回退单对象形重调。两参形实现下，合法的 V1/V2 构造 throw（如 released handle 的 `HANDLE_NOT_USABLE`）会先落进 catch，再被 fallback 调用翻译成**另一个** throw（单对象形落入 V1 形状守卫的 `handle.getStatus 必须为 function` TypeError）——错误形态与 message 被混淆。触发条件：未来在 seam.test.ts 追加失败路径用例并复用该 helper。影响：仅测试诊断失真，不影响本 ticket 11 用例（现用例构造均成功，fallback 分支不触发） | 无需本 ticket 动作（SA6-owned）。切片 5/6 或后续失败路径用例应绕过 helper 直调 factory。测试构想见「红灯测试思路」#3 |
| 4 | INFO（已闭） | 版本 bump × CI `--frozen-lockfile` 的未声明交互 | 设计 §D-D bump 0.1.5→0.1.6 但未分析 `.github/workflows/ci.yml:33` 的 `pnpm install --frozen-lockfile` 是否因版本变更失效。**SA2 已实测闭合**：`grep '0\.1\.5' pnpm-lock.yaml` 零命中（lockfile 对 workspace 包只记 `link:` 与 specifier，不记自身版本），且全仓无任何包依赖 `@nomicore/namespace-runtime`（F4 复核）→ bump 不需要 lockfile 改动，frozen-lockfile 安全 | 无需修订。建议 SA1 在 R1（如有）§5 风险表补一行该分析结论，便于 SA4 免重复验证（可选） |
| 5 | INFO | §D-H 交卷门禁清单未覆盖 CI 附加步骤 | ci.yml 除 typecheck/test 外还跑 persistence-contract、domains-scaffold、materialize-root、`pnpm generate --check` 四个显式门禁。§D-H 只列了 4 条本地命令。已核实本改动（namespace-runtime 局部 + exports 映射）与四者零交集（不触 domains/codegen/persistence/doc-runtime）→ 非风险 | 无需修订设计。提醒 SA3：交卷以 AC7 全量 CI 为准，勿只跑 §D-H 四条 |

### 已攻击并证伪的候选点（记录攻击失败原因，防后续重攻）

| 候选攻击 | 证伪证据 |
|---|---|
| 「两条构造路径漂移」：internal.ts 重写守卫造成语义分叉 | §D-C 纯委托——设计代码体逐字符检查：唯一语句 `return createNamespaceRuntime(handle, notifyDirty)`，无自有分支；构造序在 runtime.ts 全仓仅此一份（274-279 行）。委托链第三跳 `createNamespaceRuntimeWithSeam({handle, notifyDirty})` 上 `p0Gate`/`compile` 缺席（captureSeamInput 只读显式键，runtime.ts:357-379）→ `compile` 缺省回落 `compileSchemaEnvelope`（runtime.ts:167）。AC2「注入面零效果」与 AC4「真实编译」由同一结构事实承载，攻击不成立 |
| 「两参形使 AC2 行为探针失去意义」：第 3 位置实参被 JS 天然忽略，探针恒过 | 探针本就不是 AC2 的主防线——类型面三重锚（`Allowed` 形状判别 / `LeakObj`/`LeakTwoArg` 负向判别 / `@ts-expect-error` 双副锚）+ 导出面键集恰一键（运行时探测）构成实际防线；行为探针是冗余第三锚。防线分层充分，攻击不成立。反向攻击「应选单对象形」亦不成立：单对象形需实现「记得」只取两键，弱于两参形的语言级保证（设计 §D-B 理由 2 成立） |
| 「类型负向判别有洞」：`LeakTwoArg` 对 widened 首参（如 `DocHandle \| SeamInput` 联合）因条件类型分配律得出 `boolean` → `extends true` 为 false → 漏检 | `Allowed` 判别先行拦截：widened 首参使 `FactoryParams extends [DocHandle, () => Promise<void>]` 为 false、单对象分支亦 false → `Allowed=false` → `shapeOk` 赋 `never` → TS2322 红。漏检路径不存在 |
| 「exports 加键破坏既有解析/消费方」 | 根 entry `"."` 映射逐字不动；F4 独立复核（git grep 全仓零包外 import）；exports-audit 其余三 it 断言对象是 `src/index.js` 模块 namespace（与 package.json 键集无关）。加法无断裂面，攻击不成立 |
| 「主 entry 加载图被 internal.ts 污染」 | index.ts 不 import internal.ts、internal.ts 不 import index.ts（设计 §D-A + 源码复核：internal.ts 为新文件，唯二导入为 `@nomicore/persistence`（type-only）与 `./runtime.js`）；runtime.ts 语义层零反向引用。无环、无污染 |
| 「本 seam 应自身防双构造（同一 handle 建第二个 Runtime 破坏 FIFO）」 | 这是 `createNamespaceRuntime` 的既有语义（V2 状态门只查瞬时状态，不查构造计数）；单 Runtime/namespace 不变量的执行者是未来 Registry 租约层（ADR 0009 §背景明言多 sequencer 风险由 Registry 消灭）。本 seam 按 ADR 只做「通道受限」（消费方边界审计），不做「调用计数受限」——职责划分与 ADR 一致，非设计缺陷。**注记**：切片 5/6 不得把本 seam 误当 FIFO 保证本身，单构造纪律在 Registry 侧兑现 |
| 「构造失败路径有静默副作用/半初始化」 | INV-N4 继承：V1/V2 一切 throw 前置于 enqueue、零副作用（runtime.ts:139-163 注释与实现核对一致）；internal.ts 无状态、无 catch、无 finally——失败路径不新增任何吞没点 |

---

## 协议假设依据审查（2026-06-13 立法）

**结论：合格。** §7 章节存在，P1–P5 五条假设全部有可验证依据，无「应该/通常/预计」类无据推断：

| 假设 | SA2 可验证性复核 |
|---|---|
| P1 vite/vitest subpath 解析 | ✅ 命令可重跑——SA2 本轮独立复跑红灯：`npx vitest run …seam.test.ts …type-guard.test-d.ts` → exit 1，vite `Missing "./internal" specifier in "@nomicore/namespace-runtime" package`（seam.test.ts:75 收集期失败），与简报记录及 P1 推导（「解析已抵达 exports map、仅缺键」）一致。修绿半环（模拟实现 11/11 绿）有简报 §修绿可行性验证记录 + 已回滚声明 |
| P2 tsc bundler resolution + typecheck 翻转 | ✅ 复跑红灯中 type-guard 文件以 `TypeCheckError: Cannot find module '@nomicore/namespace-runtime/internal'`（TS2307）失败于 :35——与引用一致；`tsconfig.base.json:6` 现为 `"moduleResolution": "bundler"`（本轮 read 复核） |
| P3 Node 20/24 自引用 + exports | ✅ ci.yml matrix `node: [20, 24]`（本轮 read）；Node 官方 self-referencing 语义引用成立；同一机制经 11/11 绿仓内运行佐证 |
| P4 动态 import namespace 只含值导出 | ✅ 先例引用真实：`runtime-acceptance-exports-audit.test.ts:29` 对 `import * as publicEntry from '../src/index.js'` 断言键集恰 `['RuntimeWriteFatalError']` 而该文件含 10 个 `export type`（src/index.ts:21-30）——同一机制现行全绿 |
| P5 exports 加键不破坏根 entry | ✅ F4/F7 独立复核成立（附录 A） |

依据类型分布：实测验证（仓内、命令+输出可重跑）×2、现有测试引用 ×1、机制依据+官方文档 ×1、实测+先例混合 ×1——全部可被 SA4 静态核验，无不可定位引用。

## 错误处理链路审查（2026-05-07 立法）

本任务为模块边界 feature，无用户交互面（无按钮/API 调用/异步任务链新增）；审查对象为构造通道的错误链路继承：

- **静默失败检查**：✅ 无。internal.ts 零 catch/零吞没；V1 形状守卫 loud `TypeError`、V2 状态门 loud `NamespaceRuntimeConstructionError`（`HANDLE_NOT_USABLE` + 观测状态值）全部在构造栈同步抛出，经 subpath 调用方直接可见。
- **状态闭环检查**：✅ 无异步状态引入（factory 全同步）；构造 throw 路径零副作用（INV-N4 继承，无半初始化 Runtime 外泄）；handle 所有权在 throw 时仍归调用方（ADR 0008 条款继承）。
- **降级路径检查**：✅ 本层无外部依赖可降级；`persistence-degraded` 是**能力语义**而非降级掩饰——V2 放行 `{ready, persistence-degraded}`、degraded 的拒绝面在写前 gate（ADR 0006 2026-08-22 修订归属），构造期放行 degraded 是 ADR 0009「degraded 不改 open 语义」的推论（SA8 T3 已裁）。
- **虚假降级识别**：✅ 无伪降级。设计 §D-B 明言「不提供默认 no-op」——`notifyDirty` 未绑定的写槽 S2 loud gate（#93 rev2 D6.4 立法）原样保留，未把构造方义务缺失伪装成静默空操作；runtime.ts:167 `??` 是「seam 提供 or 真实编译步」的二元选择而非异常吞没，且本通道上 seam 恒不提供。
- **用户可感知性**：✅ 调用方（未来 Registry）在每种失败模式下得到稳定 code/message（TypeError / `HANDLE_NOT_USABLE` / 写槽稳定码族 `RUNTIME_WRITE_DISABLED` 域）。

## 红灯测试思路（对应攻击点清单）

1. **#1 审计盲区加固（切片 5/6 前置，SA6 授权下）**：红灯用例「审计正则自检」——临时在 `packages/namespace-registry/src/probe.ts`（白名单内，合法）与 `packages/persistence/src/probe.ts`（白名单外）分别写入 `import '@nomicore/namespace-runtime/internal';`（裸副作用形态，无 `from`）：现正则下后者**不**被计入 importers → 消费方断言假绿——用该实验固化盲区存在性，再扩展 `importRe` 为 `import\s*'spec'\|from\s+'spec'\|import\('spec'\)\|require\('spec'\)` 并把两探针翻转为「外白名单者必红」。非 TS 文件盲区同法：投放 `packages/persistence/src/probe.mjs` 动态 import → walk 不扫描 → 断言扩展 `.mjs?/.js?` 过滤后必红。
2. **#2 白名单粒度裁决（切片 5/6 设计期）**：红灯用例「谓词自检 it」增补期望对：`isWhitelistedConsumer('packages/namespace-registry/src/testing.ts')` 应等于切片 5/6 ADR 裁决值（true/false 皆可，但必须是被裁定的常量而非前缀默认放行）——把「testing subpath 是否属生产代码」从模糊地带升为显式断言。
3. **#3 helper 掩蔽（后续失败路径用例编写纪律）**：红灯用例「released handle 经 internal factory 构造 → 断言 throw `NamespaceRuntimeConstructionError` 且 message 含 `HANDLE_NOT_USABLE`」——编写时**直调** `entry.createNamespaceRuntimeForRegistry(releasedHandle, notify)`，禁止经 `buildViaInternalFactory`（其 catch-fallback 会把该 throw 翻译成 V1 形状守卫 TypeError，message 断言失真）。此用例同时是 AC4「构造失败所有权归调用方」在 internal 通道上的补锚。
4. **#4/#5（非漏洞，验证性用例已足）**：无需新增红灯——CI frozen-lockfile 与四附加门禁由 AC7 全量 CI 承载；SA3 交卷时 `pnpm test` + `pnpm typecheck` + 聚合 tsc + CI 全绿即闭环。

既有 SA6 11 用例对本任务 AC1–AC6 的锚定密度充分（配置审计 + 运行时模块探测 + 类型三重判别 + 行为哨兵 + import 图审计 + 谓词自检 + 防空扫），SA2 无补充红灯要求。

---

## 总评

设计以「纯委托 + 模块边界」两招把 ADR 0009 冻结的四项要求（subpath 名 / factory 名 / 主 entry 封闭 / 消费边界审计）全部落成**结构性事实**而非约定：「逐字节保持」取最强形态（同一份代码）；AC2 最小输入面取语言级保证（两参形，注入面无处安放）；AC5 边界取静态审计；版本/配置改动收窄到单文件两 diff + 单 it 契约演进（简报预授权）。全部 8 项设计事实声明（F1–F8）与 SA8 裁定（N1–N8、T1–T5）经 SA2 独立复核无一失实。两条 LOW 均为前瞻性加固项（不阻塞本 ticket，责任落在切片 5/6），三条 INFO 已闭合或已有处置路径。

**Verdict: pass —— 同意放行进入 SA3 实现。**

---

## 附录 A：SA2 独立验证证据（命令 + 结果，2026-08-25 worktree HEAD 3451eca）

| # | 验证项 | 命令 | 结果 |
|---|---|---|---|
| A1 | ADR 0009 冻结原文 | `grep -n "createNamespaceRuntimeForRegistry" docs/adr/*.md` | 仅 0009:18 一处，逐字吻合设计/SA8 引文：「Registry 通过 `@nomicore/namespace-runtime/internal` 唯一导出的 `createNamespaceRuntimeForRegistry` 构造生产 Runtime；主 entry 不公开生产 Runtime 构造器。模块边界测试限制该 internal subpath 只能由 Registry 生产代码消费。」 |
| A2 | 设计行号引用准确性 | read `src/runtime.ts` | :167 `const compile = captured.compile ?? compileSchemaEnvelope;`；:274-279 `createNamespaceRuntime(handle, notifyDirty)` 两参形生产工厂；:278 委托链第三跳 `{ handle, notifyDirty }`（p0Gate/compile 缺席）——三处引用全部准确 |
| A3 | F2 主 entry 纪律 | read `src/index.ts` | 值导出恰 `RuntimeWriteFatalError`（:20），其余 10 键全为 `export type`；无 createNamespaceRuntime*/Seam re-export |
| A4 | F4 零包外消费方 | `git grep -n "namespace-runtime" -- 'packages/*.ts' 'packages/*/*.json' 'domains/*' 'apps/*' ':!packages/namespace-runtime'` | 仅 doc-runtime 注释文本 4 处命中，无任何 import 语句 |
| A5 | F7 全仓单 entry 形态 | `grep -A3 '"exports"' packages/*/package.json domains/*/package.json` | 7 包 + 1 domain 全部 `{"."}` 单键——`./internal` 为首个多 entry |
| A6 | 红灯复现 | `npx vitest run packages/namespace-runtime/test/runtime-registry-internal-seam.test.ts packages/namespace-runtime/test/runtime-registry-internal-type-guard.test-d.ts` | exit 1；seam.test.ts 收集期 vite `Missing "./internal" specifier`（:75 动态 import）；type-guard TS2307（:35）；AC5 审计三 it 现即绿（空集+谓词自检）——红根因与简报记录一致 |
| A7 | T1.4 定位与现状 | read `runtime-acceptance-exports-audit.test.ts` | 第 4 it 位于 56-66 行，现断言 `['.']`；其余三 it 断言对象 `src/index.js` namespace——§D-E 的演进 diff 与现状吻合、边界声明准确 |
| A8 | CI 形态 | read `.github/workflows/ci.yml` | Node matrix [20,24]；`pnpm install --frozen-lockfile`（:33）→ A9；附加四门禁与本改动零交集 |
| A9 | bump × frozen-lockfile 安全 | `grep -n "0\.1\.5" pnpm-lock.yaml` | 零命中——lockfile 不记录 workspace 包自身版本（importers 仅 `link:` + specifier），bump 无需 lockfile 改动 |
| A10 | 解析机制配置 | read `tsconfig.base.json` / `packages/namespace-runtime/tsconfig.json` / `tsconfig.typecheck.json` / `vitest.config.ts` | `moduleResolution:"bundler"`（base:6）、`verbatimModuleSyntax`（base:15，设计 D-C 擦除论证成立）；pkg tsconfig include `src/**/*.ts`（含 internal.ts）；typecheck 聚合与 vitest typecheck globs 均覆盖两个新测试文件——F6 无误 |
| A11 | P4 先例 | read exports-audit:29 | 对主 entry namespace 断言恰一键值导出而 index.ts 含 10 个 type export——机制先例属实 |
| A12 | D-G README 对齐点 | read `packages/namespace-runtime/README.md` | 第 9 行确为「Production assembly is performed by the owning server/registry layer through the package-internal factory. …」；phase-4 阶段门禁明言「package docs…一致」→ D-G 有门禁依据，**建议保留不砍**（设计自弃选项不必行使） |
| A13 | 非 TS 生产文件暴露面 | `find packages domains apps \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -not -path '*/node_modules/*'` | 零命中——发现 #1 当前零暴露 |
| A14 | SA6 测试契约面 | read 两测试文件全量 | 11 it 与简报 AC→锚点映射一致；`Allowed`/`LeakObj`/`LeakTwoArg` 条件类型推演复核（含 widened 首参分配律路径）无漏检；本报告攻击点 #3 的 catch-fallback 行为经两参形调用语义推演确认 |

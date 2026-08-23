# SA4 静态验尸报告

**Date**: 2026-08-22
**Verdict**: pass（附 1 项非阻塞登记义务 F1，指派 SA1/总控；零行为级缺陷、零 DENY 接触、零回归）
**修订**: R1a（2026-08-22，总控门禁合规修订轮）——补 Hard Gate #14 法定章节标记「1.4 vitest 触发性自检」与结论关键词 `all-vitest-packages-triggered`（2026-06-15 立法）。实质分析原报告第三节已覆盖且结论 PASS，本轮仅补法定节名与结论关键词（沿 task_rename-validate-logical-snapshot R2 同款补标先例）；Verdict 维持 pass 不变、无重审项、其余内容不动。

**被审对象**：实现 commit `7033490`（feat(vfsl): compileSchemaEnvelope）+ 哨兵 commit `c459c3c`（SA6 RT 哨兵）+ `70bcc9d`（dispatch log）
**审核基准**：`task_issue-72_design.md`（R2 定稿，§14 ALLOW/DENY LIST）、`task_issue-72_sa2_review.md`（verdict pass，M1(b) 处置义务）、`task_issue-72_relevant_decisions.md`（D1–D5 + D1 附注）、`task_issue-72.md`（SA6 验收锚定节）
**diff 口径**：MABF base = `mabf.base-branch` = `docs/doc-runtime-validation`（f07462d，简报 Parent PR #70）；任务 diff = `f07462d..HEAD` 共 13 文件。注意 `mabf.basebranch`（无连字符）未配置，技能模板回退 `origin/main` 会把整个父分支历史误当任务 diff——本次已按正确的 `mabf.base-branch` 取值审计。

---

## 一、Scope Creep Guard（§1.1 硬门禁）

**ALLOW LIST（设计 §14）vs 实际 diff（f07462d..HEAD）逐文件比对**：

| 实际文件 | 判定 |
|---|---|
| `packages/vfsl/src/fingerprint.ts`（新建 58 行） | ALLOW ✓（§14 第 1 条） |
| `packages/vfsl/src/envelope.ts`（+53 行，0 删除行） | ALLOW ✓（§14 第 2 条，纯增量实证见下） |
| `packages/vfsl/src/index.ts`（+84/-1 行） | ALLOW ✓（§14 第 3 条；唯一删除行 = import 行扩展加 `envelopeStrictGate`，设计 §2.4 明文「头部新增 import」） |
| `packages/vfsl/package.json`（0.2.0→0.2.1） | ALLOW ✓（§14 第 4 条，版本 bump 实证） |
| `packages/vfsl/test/compile-schema-envelope.test.ts`（新建） | ALLOW ✓（§14 第 5 条 `[SA6 owned]`；完整性见 §六） |
| `wiki/raw/task_issue-72*.md`（7 文件） | 白名单豁免 ✓（`^wiki/raw/task_` 模式） |
| `packages/vfsl/test/compile-schema-envelope-sentinel.test.ts`（新建） | **不在 ALLOW LIST** → **F1（登记义务，非生产越界）**，详见下 |

**F1 裁定依据（为什么不阻塞）**：
1. 该文件是**总控派发的 SA6 产物**，非 SA3 越界：dispatch log 第 7 行（12:19 SA6 修订轮排队 RT 哨兵）与第 9 行（13:01 新会话产出，commit c459c3c）完整记录派发链；
2. 设计与 SA2 评审**均预先预告该文件的存在形态**：设计 §6.3「处置分工 (c) RT-1b round-trip 保序哨兵 + RT-1c 异序边界钉死（**总控排队，SA6 修订轮或新内部测试文件**）」；SA2 处置表 M1(c)/N2 同款；SA2 红线测试思路明文「新增内部测试文件（vitest include 已覆盖 `packages/vfsl/test/**`）」——即文件路径级登记是 ALLOW LIST 定稿（R2，12:22）早于哨兵轮落地（13:01）的时序缺口，属**文档债而非范围失控**；
3. 测试专用文件、零生产码接触、零 DENY LIST 接触、已被 vitest include 与 CI 覆盖（§三）；
4. **处置**：要求 SA1 按本仓立法「ALLOW LIST 只增不删」补一行登记（`packages/vfsl/test/compile-schema-envelope-sentinel.test.ts — [SA6 owned] 哨兵测试，dispatch 第 7/9 轮派发，设计 §6.3(c) 预告」），随 PR 合入前闭合。回滚不可选（会销毁 SA2 M1(c) 义务的已交付履行）。

**BLACKLIST 扫描**（TASK.md / package-lock.json / yarn.lock / .DS_Store / *.bak）：**零命中** ✓
**DENY LIST 接触**：schemasource.ts / sha256.ts / evaluate.ts / 引擎十二内部件 / tsconfig×3 / vitest.config.ts / pnpm-lock / pnpm-workspace / `.github/workflows/**` / docs/adr / v1-spec / vfsl-codegen / vfsl-protocol / tests/acceptance——**全部零接触** ✓（任务 diff 13 文件逐一核对）
**纯增量实证**（DENY「index.ts 既有内容逐字不动」行为级护栏）：

```
$ git diff f07462d HEAD -- packages/vfsl/src packages/vfsl/package.json | grep -E "^-[^-]"
-  "version": "0.2.0",
-import { envelopeTextGate, vfslIssues, envelopeCrashIssue } from './envelope.js';
```

envelope.ts **0 删除行**；index.ts 唯一删除 = import 行扩展（设计 §2.4 明文）。`getCompiled`/`getCompiledWith`/`compiledCache`/`deepFreeze`/`parseVfsl`/`parseSchemaEnvelope` 逐字未动。worktree 干净（无未提交残留）。

---

## 二、设计一致性（含 M1(b) grep 静态门禁）

### 2.1 M1(b)/RT-1a grep 静态门禁（SA2 处置义务）— **PASS**

```
$ git grep -nE "semanticFingerprintOf|envelopeFingerprintOf" -- 'packages/vfsl/src'
packages/vfsl/src/fingerprint.ts:37:export function envelopeFingerprintOf(...)
packages/vfsl/src/fingerprint.ts:55:export function semanticFingerprintOf(...)
packages/vfsl/src/index.ts:58:import { envelopeFingerprintOf, semanticFingerprintOf } from './fingerprint.js';
packages/vfsl/src/index.ts:315:    const envelopeFingerprint = envelopeFingerprintOf(gate.envelope);
packages/vfsl/src/index.ts:316:    const semanticFingerprint = semanticFingerprintOf(
```

生产 src 范围**仅 fingerprint.ts（定义）+ index.ts（import + 唯一调用点）**，无第三文件 ✓。哨兵测试文件对 `semanticFingerprintOf` 的直连引用（`../src/fingerprint.js`）是 SA2 RT-1b 原文授权的 KAT 直连先例（同主测试文件直连 `sha256Hex`），不属 D2「第二生产者」（测试不产指纹入缓存/共享面）。
辅助验证：`FINGERPRINT_PREFIX`/`SEMANTIC_DOMAIN_TAG` 全仓仅 fingerprint.ts 内出现（零泄漏）✓；index.ts **无指纹构造函数 re-export**、package.json `exports` 仅 `"."`（无子路径导出）——D1「构造函数不上公共面」落实 ✓。

### 2.2 ENV-5 / 坍缩 / 域分离 / 深冻结 / 无缓存——与设计逐字对照

| 设计条款 | 实现落点 | 判定 |
|---|---|---|
| §2.3 `ENV_5: '5'` 注册 + `ENVELOPE_KEY_SET`（由 ENVELOPE_KEYS `.map` 派生，四键单源） | envelope.ts:28/90 | ✓ 逐字 |
| §3.2 坍缩取 `[0]`（ENV-2 > ENV-3，构造序天然保证） | envelope.ts:237-244 `shape.issues[0]` | ✓ |
| §3.3 ENV-5 判据 `Object.getOwnPropertyNames` 字符串自有键差集、消息 `信封多余键: ${extra.join('、')}（严格封闭：恰含 lang, version, id, text 四键）`、时机形状后方言前 | envelope.ts:247-266 | ✓ 逐字（消息模板与设计 §2.3 伪代码一致） |
| §3.4 symbol 键排除（getOwnPropertyNames 语义） | 同上（语义即排除） | ✓ |
| §4 dialect 复用 `dialectIssueOrNull`（ENV-4 readOnly true） | envelope.ts:268-272 | ✓ |
| §2.2 fingerprint.ts：`FINGERPRINT_PREFIX='sha256:v1:'`、`SEMANTIC_DOMAIN_TAG='vfsl-semantic'`、envelope 域字面量表序四键 JSON、semantic 域 `{domain,lang,version,module}` | fingerprint.ts:24/30/37-47/55-58 | ✓ 逐字 |
| §6.3 M1(a) 头注可 grep 的 D2 契约标记 | fingerprint.ts:7-13 `D2-CONTRACT-MARKER`（含升级触发器与 RT-1a 门禁自述） | ✓ 义务落实 |
| §5 编排五阶段顺序、evaluate 走 index.ts:56 顶部既有 import 绑定（vi.mock 模块图边）、parse 走 `parseVfslImplementation`（index.ts:122 同接缝）、指纹冻结前计算、一趟 `deepFreeze(result, new WeakSet())`、顶层 catch ENV-100 | index.ts:291-335 | ✓ 逐字 |
| §8 无缓存：编排体内零 `compiledCache` 引用（grep 实证 compiledCache 仅现于 getCompiledWith 辖域 239/256 行与私有声明 344 行） | ✓ | ✓ |
| §13 类型加法：`CompileSchemaEnvelopeOk`/`CompileSchemaEnvelopeResult`/`compileSchemaEnvelope` 三导出；`SchemaEnvelopeIssueCode` 并入 `'5'`，仓内零外部消费方、零 exhaustive switch（grep 实证 exit 1） | ✓ | ✓ |
| §14 版本 0.2.0→0.2.1（F1/H1 patch 先例） | package.json:3 | ✓ |

**D1–D5 逐条合规**：D1 双域同址单模块+构造函数封装 ✓；D2 canonical 四层+marker+无 RFC 8785 序列化器 ✓；D3 严格门定式+双门并存（envelopeTextGate 逐字不动，diff 0 删除行实证）✓；D4 顶层 catch 单条 ENV-100+不加 stage 字段+失败产物不冻结 ✓；D5 一趟原地冻结（无 clone-then-freeze）+evaluate 既有绑定+零缓存+纯增量 ✓。

**两处微偏离（均非缺陷，如实记录）**：
- fingerprint.ts 两处 `sha256Hex(canonical as string)` 断言收窄（设计伪代码无 `as string`）——内联注释已论证（对象字面量根值 JSON.stringify 运行时恒返回 string，断言仅收窄 lib 类型），零运行时语义差；
- envelope.ts +53 行 vs 设计预估 ~45（JSDoc 注释增量），非膨胀。

### 2.3 §1.6 契约改动连锁：N/A——零契约改动

全部既有函数签名/返回/throw 行为逐字不动（唯一删除行为 import 行扩展）；无 `return→throw` 类变化；新导出现无生产 caller（grep `compileSchemaEnvelope` 生产面仅 index.ts 定义+注释，消费方属 Phase 2 后续票，与设计 §13 一致）。

### 2.4 §1.5 协议假设：合规

设计 §12 章节在、依据栏全为实测/源码引用/现有测试引用（无「应该/通常」）。SA2 曾标注的唯一未实证断言「vitest 测试文件经 ESM 转换恒严格模式」——**本次以运行时证据闭合**：AC5#4 四处冻结赋值 `toThrow(TypeError)` 用例绿（28/28 复跑见 §五），严格模式假设成立。

---

## 三、Hard Gate #14：vitest 触发性自检（§1.4）— **PASS**

本任务新增 2 个 `*.test.ts`：

1. `vitest.config.ts` include = `['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts']` → `packages/vfsl/test/compile-schema-envelope.test.ts` 与 `compile-schema-envelope-sentinel.test.ts` **均命中** ✓；
2. `.github/workflows/ci.yml`（仓内唯一 workflow）`test` job：`pnpm test`（第 39 行）= `vitest run --typecheck`（root package.json scripts）→ 吃 vitest.config include 覆盖两文件 ✓；`pnpm typecheck`（第 36 行）含 `tsc -p packages/vfsl/tsconfig.json` ✓；触发面 `push: main` + 全部 `pull_request` ✓；node 20/24 矩阵；
3. 附加显式步骤（persistence 契约 / domains 脚手架 / regen-diff）与本任务无关，未受影响。

**SA7 动态侧义务**：从 `gh run view --log` 摘录两新测试文件在 Test 步骤出现的证据（见 §七 DA-1）。

---

## 1.4 vitest 触发性自检（Hard Gate #14 法定章节，R1a 补标）

> 2026-06-15 立法（issue #289 复盘）要求的标记节；实质分析 = 上文第三节（R1 原文，内容不动），本节为法定节名 + 结论关键词 + 逐文件明细。

**审查对象**：本任务新增/改动的全部测试文件（`git diff --name-only f07462d HEAD | grep -E '\.test\.ts$'`，均在 `packages/vfsl/test/`、均属既有 workspace package `@nomicore/vfsl`）。

**收集规则**（根 `vitest.config.ts` 实读）：`include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts']`。
**CI 触发链**（`.github/workflows/ci.yml` 实读）：`test` job → `pnpm test`（L39）= `vitest run --typecheck`（无 `--filter`/包级裁剪，收集域 = include 全域）；`pnpm typecheck`（L36）含 `tsc -p packages/vfsl/tsconfig.json`；触发面 `push: main` + 全部 `pull_request`，node 20/24 矩阵。
**本地替代口径注明**：PR push 后的 CI run 日志证据（`gh run view --log`）属 SA7 动态侧义务（DA-1）；本轮静态口径 = include/workflow 实读比对 + SA4 独立进程以**与 CI 同一入口同一 config** 本地亲跑（下表证据列）。

### 逐文件核对表

| # | 文件（均在 `packages/vfsl/test/`，package `@nomicore/vfsl`） | 改动 | 匹配 include | 本地亲跑证据（独立后台进程，CI 同入口） | 判定 |
|---|---|---|---|---|---|
| 1 | `compile-schema-envelope.test.ts` | 新增（SA6 owned 主测试，commit 7033490） | ✅ `packages/*/test/**/*.test.ts` | ✅ `✓ … (28 tests) 51ms`；全量 `pnpm test` exit 0 | 覆盖 |
| 2 | `compile-schema-envelope-sentinel.test.ts` | 新增（SA6 RT 哨兵，commit c459c3c） | ✅ `packages/*/test/**/*.test.ts` | ✅ `✓ … (7 tests) 23ms`；全量 `pnpm test` exit 0 | 覆盖 |

两文件运行计数合计 35（28+7），含于全量 704/704 绿（exit 0）。本任务无 `*.spec.ts`（§1.3 E2E spec 门不适用）；无新增 workspace package（两文件均落位既有 `@nomicore/vfsl`，根 `pnpm test` 收集域对其天然覆盖，无需 `--filter` 比对）。

**结论：all-vitest-packages-triggered**（本任务全部 vitest 测试文件命中 CI 触发面，无「测试存在但从未被触发」黑洞；CI run 日志证据由 SA7 按 DA-1 补验）。

---

## 四、§1.7 源码 GREP 断言禁令 — **PASS**

- 主测试文件唯一 `readFileSync`（:555-560）读 `../package.json` 断言 `dependencies ?? {}` toEqual `{}`——**清单契约**（简报 AC6#3 明文锚「package.json 零运行时依赖（清单契约）」），非源码字符串断言；
- 其余 28 用例全部为运行时行为断言（返回形状/精确摘要/冻结态/引用同一性/vi.mock 求值接缝观测）；哨兵文件 7 用例零 readFileSync、全运行时断言；
- 无「读 .ts 源码 + toMatch/toContain」反模式命中。

**SA6 owned 文件完整性**（SA3 commit 内首次入库，防断言弱化）：28 用例/7 describe 与简报记录**精确一致**；抽查关键锚与简报逐字对应——AC3 精确摘要（`sha256:v1:${sha256Hex(JSON.stringify({lang:'vfsl',version:1,id:'compile-fixture',text}))}`）、AC5 共享引用（`rootEntry.node toBe d.structure` / `bEntry.node toBe bField.node`）、AC5#4 四处赋值 toThrow(TypeError)、AC6#1 引用互异（`r1.envelope not.toBe r2.envelope`）、KAT 双向量（FIPS 'abc'/''）。断言强度与 SA6 Phase 1 红灯基线（26 红/2 绿）描述相符，无弱化痕迹。

---

## 五、独立复跑证据（技能规范：独立后台进程）

```
$ pnpm test（全量，独立 setsid 进程）        → exit 0（总控记录 704/704；exit 0 复核通过）
$ pnpm exec vitest run <两新测试文件>         → Test Files 2 passed (2) / Tests 35 passed (35)
                                               / Type Errors: no errors，exit 0
  ✓ compile-schema-envelope.test.ts (28 tests) 51ms
  ✓ compile-schema-envelope-sentinel.test.ts (7 tests) 23ms
```

数字闭环：全量 697（实现轮）+ 7（哨兵轮）= 704 与 dispatch log 第 8/9 行记录一致。

---

## 六、验尸清单结论

1. **设计一致性**：✅ 一致（§2.2 逐字对照表全绿；两处微偏离零语义差）
2. **读写路径一致性**：✅ 一致（纯函数零写入面；envelope 重建回显四键 → parse → evaluate → 指纹 → 冻结，单链无分叉；与 getCompiled 对象图不相交——AC6#1 引用互异锚绿）
3. **静默失败**：✅ 无（五阶段全部失败路径结构化 issues 返回，§5.2 判别式 kind+code+readOnly 可区分；无「无请求+无反馈」路径）
4. **降级方案**：✅ 安全（ENV-100 是崩溃边界非降级——不吞错续跑、不假成功；无任何 fallback 路径；零外部依赖零 I/O）
5. **极端攻击**：✅ 未发现可静态确认漏洞。已推演：Proxy ownKeys 谎报两向（隐藏向过门但多余键不可达产物——重建回显为数据面边界，RT-3 已锚；伪造向 ENV-5 保守拒绝）、ownKeys trap 抛出/返回重复键（Proxy 不变量 TypeError → 顶层 catch ENV-100）、敌意键名含行终止符（makeEnvelopeIssue sanitizer 单行化收编，ENV-5 消息经此唯一构造点）、boxed Number（typeof 'object' → ENV-3）、自有 `__proto__` 键（own 键差集捕获 → ENV-5）、冻结输入（零变异，重建副本）、version NaN/1.5（assertVfslDialect `!== 1` 严格相等 → ENV-4，指纹路径只见 version===1——JSON 数值确定性无坍缩面）、巨量多余键（消息 O(n) 无放大，调用方自担输入成本）。数值坍缩类（NaN/Infinity/-0）由 tokenizer `[0-9]+` + parser isFinite E100 两道闸门结构性挡在 IR 外（RT-2 已锚）
6. **错误处理**：✅ 完整（每条失败路径专属阶段码；`shape.issues[0]` 取值安全性——validateEnvelopeShape 全部 ok:false 返回恒含 ≥1 条 issue，实证于早出与聚合分支）
7. **架构评估**：✅ 可行（五阶段全复用既有单点资产，零 FIXME/TODO/绕过；不触发退回 SA1 信号）
8. **过度设计**：✅ 精简（fingerprint.ts 58 行 vs 预估 ~70；envelope +53 vs ~45；index +84 vs ~85；无额外抽象层，变更半径恰为 ALLOW 四文件）

---

## 七、动态审核重点（交 SA7）

| # | 风险点 | 验证入口 |
|---|---|---|
| DA-1 | CI 触发证据：两新测试文件须在 PR CI 的 Test 步骤真实执行（本报告为静态 include/命令比对 + 本地复跑） | `gh run view --log` 摘录 `compile-schema-envelope.test.ts (28 tests)` 与 `compile-schema-envelope-sentinel.test.ts (7 tests)` 行 |
| DA-2 | 矩阵差异：node 20/24 双矩阵下指纹/冻结/Proxy 不变量行为一致（sha256Hex 纯 TS 实现 + KAT 锚，预期低风险） | CI 两矩阵 job 全绿即证 |
| DA-3 | ENV-5 消息规模：巨量多余键输入的消息长度 O(n) 无放大确认（可选探针） | 构造 10^4 多余键信封，断言单条 ENV-5 且进程内存无异常增长 |
| DA-4 | 下游衔接：未来 NamespaceRuntime open 管线消费本产物（Phase 2 后续票），届时复核「指纹键 = 本票产物值形态」假设未被中途复制破坏 | 缓存票设计期对照 §7.4/§8 |

---

## 八、处置汇总

| 发现 | 级别 | 处置 | 承接方 |
|---|---|---|---|
| F1 哨兵测试文件未入设计 §14 ALLOW LIST（时序性文档债：ALLOW LIST 定稿早于总控派发的哨兵轮；设计 §6.3(c)/SA2 M1(c) 散文预告在案、dispatch 第 7/9 行派发链在案） | 非阻塞登记义务 | 按「只增不删」补一行 ALLOW LIST 登记后随 PR 闭合；不接受回滚（销毁 SA2 M1(c) 已交付履行） | SA1（总控裁量执行） |
| F2 fingerprint.ts 两处 `as string` 断言收窄（内联注释已论证，零运行时差） | 观察 | 无动作（未来清理票可选） | — |
| F3 ENV-5 消息 O(多余键数) 无放大 | 观察 | DA-3 可选探针 | SA7 |

**Verdict: pass。** 生产 diff 纯增量（0 删除行 + 设计明文的 import 行扩展）、§14 DENY 全零接触、M1(b) grep 门禁过、Hard Gate #14 vitest/CI 触发过、源码 grep 断言禁令过、35/35 新用例 + 全量 exit 0 独立复跑。SA7 可进入动态验证（DA-1 为其首要义务）。

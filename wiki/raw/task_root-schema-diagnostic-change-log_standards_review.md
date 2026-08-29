# Standards 轴独立终审 — issue #149（NamespaceRuntime ROOT/SCHEMA 写路径接入诊断变更日志）

- **审查者**：SA4（Red Team；独立 standards 终审，未参与 SA1–SA8/SA3 任一环节）
- **审查对象**：worktree `/home/wangjian/nomicore-fix-issue-149`，任务基线 `eaf0484` → HEAD `874cc10`（两 commit：`96cd085` 生产实现 + `874cc10` SA7 测试层），含未提交的 `wiki/raw/task_root-schema-diagnostic-change-log_ac_checklist.md`（git status 确认为唯一未提交文件）
- **审查轴**：审查标准（设计/词表/映射一致性）、测试与类型检查触发、ADR/工程约束、范围（scope creep）、回归风险
- **只读审查**：未修改任何生产代码 / 测试 / 配置 / package 文件；未 push（复核：`origin/fix/issue-149-on-docs-namespace-diagnostic-change-log` 不存在）
- **Date**: 2026-08-29

**Verdict: reject**（BLOCKER × 2，均一行/一断言级修复，可共同修复后按 §4 固定复验范围一轮复审；§2 九个审查项中其余 7 项全部通过）

---

## 0. 审查方法与独立验证证据（全部命令在独立进程执行，不采信 SA3/SA4/SA7 报告自述）

| # | 验证项 | 命令 | 结果 |
|---|---|---|---|
| V1 | 范围抽取 | `git diff --name-only eaf0484 HEAD` | 19 文件：生产 5（package.json / diagnostic.ts 新建 / runtime.ts / write.ts / schema-write.ts）+ 测试 2 + pnpm-lock + wiki 档案 11 |
| V2 | Scope Creep Guard | 逐集比对设计 §16 ALLOW LIST + DENY LIST + 技能 BLACKLIST | **通过**：生产/测试文件全在 ALLOW（SA7 测试文件见 A-2 裁决）；DENY（diagnostic-log/doc-runtime/sequencer/index/p0/close/status/projection/plain-data/errors/internal/registry/persistence/vfsl/clock）零触碰；无 package-lock.json/yarn.lock/TASK.md/*.bak/.DS_Store |
| V3 | `96cd085`→HEAD 生产零改动 | `git diff --name-only 96cd085 HEAD` | 仅测试 2 + wiki 4——`874cc10` 确为 test/archive-only |
| V4 | 红灯契约 | `npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts --typecheck.enabled=false`（隔离进程） | **14/14 通过**（451ms） |
| V5 | SA7 动态套件（隔离） | 同上（sa7 文件） | 16/16 通过（812ms）——**但见 B-1：6 轮中 2 轮失败** |
| V6 | 全仓 CI 等价 `pnpm test` | `pnpm test`（= CI `Test` 步，setsid 独立进程，约 8 分钟） | **exit 1**：`Test Files 2 failed / 140 passed (142)`、`Tests 3 failed / 1813 passed (1816)`、`Type Errors no errors`——3 失败 = **B-1（DV-2 对照，in-scope）** + `generate-cli-check.test.ts` ×2（负载诱发工件，与 #149 无关：该文件不在 diff、#23 遗产、隔离复跑 3/3 绿）；另有 2 条 `vitest-worker RPC Timeout "onTaskUpdate"`（SA3/SA7 已登记的同签名环境工件） |
| V7 | CI Typecheck 步 | `pnpm typecheck`（10 包） | **exit 0** |
| V8 | 测试文件类型面（SA7-F-1 闭环复核） | `npx tsc -p tsconfig.typecheck.json`（include 含 `packages/*/test/**/*.ts`；noEmit） | **exit 0**——SA7 修复后的 0 错误复现成立 |
| V9 | CI regen-diff 步 | `pnpm generate --check` | **exit 0** |
| V10 | CI Install 步（lockfile 一致性） | `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts` | **exit 0**——`workspace:*` 新依赖与 pnpm-lock 登记一致，`--frozen-lockfile` 不会红 |
| V11 | 触发性（收集面） | `cat .github/workflows/ci.yml` + `vitest.config.ts` + `tsconfig.typecheck.json` | 两个新测试文件均落 `packages/*/test/**/*.test.ts` include（CI `Test` 步 `pnpm test` 必收集）；测试文件类型面经 tsconfig.typecheck.json 进入同一 `pnpm test`（V6 `Type Errors no errors` 实证）。CI 单工作流 ci.yml，push/PR 双触发，node 20/24 矩阵 |
| V12 | 源码 grep 断言禁令 / only-skip | `grep readFileSync / \.only\(|\.skip\(|\.todo\(` 两测试文件 | 零命中——全部为运行时行为断言（真实 memory adapter + 记录形状 + carrier 重放 + trap 计数 + stats）；无 .only/.skip |
| V13 | 契约改动连锁 | `grep -rn "runRootWriteSlot\|runSchemaWriteSlot\|emitSlot\|emitAttempt\|createSlotDiag" packages/` | 槽函数 caller 仅 runtime.ts:275/311（可选第三参 additive；测试仅负向导出断言）；emit 挂点为**非包装附加反应**（`const settled = enqueue(...); void settled.then(emit, emit); return settled`）——返回 promise 身份/结算时点零变化，onErr 不重抛（无 unhandled rejection 新增面；抑制面为 SA4 I-4/SA7 DV-3 已登记项） |
| V14 | ADR-0011 §D 冒充红线（结构面） | `grep -rn "encodeStateAsUpdate\|encodeUpdate" packages/namespace-runtime/src/` | **零命中**——producer 无整文档编码路径；bytes 唯一来源 = `doc.on('update')` 捕获窗口（write.ts/schema-write.ts，仅 diag 装配时订阅、try/finally 对称退订） |
| V15 | 协议假设 P1/P2 复验 | `sed -n '355,372p' node_modules/.pnpm/yjs@13.6.32/.../Transaction.js` | 属实：`writeUpdateMessageFromTransaction(encoder, transaction)`（该事务增量）+ `if (hasContent)` 守卫（零内容不派发）+ `encoder.toUint8Array()` 新分配 |
| V16 | 词表/映射一致性 | diff 逐点对照设计 §9.1/§9.2 的 25 结局点 | **逐点一致**：R1–R13 / S1′–S7′ 每结局点恰一行 diag 写入，stage/code/sourcePhase/sourceModule/result/input 与冻结表无错位（R5/R8 `write-slot-internal`、R10 `err.phase` 透传、R7 `SCHEMA_UNAVAILABLE`、S4′a 首条结构化码、S4′b `schema-compile-throw` committed:false、S6′ fatal committed:true 等）；acceptance 两处公共入口同步 emit；errors.ts 零新码 |
| V17 | git 卫生 | `git diff --check eaf0484 HEAD` | exit 0（零空白错误） |
| V18 | 版本 bump 惯例核查 | 见 B-2 证据 | **违反**（BLOCKER-2） |

---

## 1. 发现清单

### BLOCKER-1【测试可靠性 / CI 门禁不稳定】DV-2 对照断言 `syncMs < 20` 为贴界墙钟断言，实测 ~1/3 失败率，`pnpm test`（CI `Test` 步）将随机红

- **位置**：`packages/namespace-runtime/test/runtime-root-schema-diagnostic-sa7.test.ts:314`（DV-2 对照 it「对照：快 emitter 同一拒绝路径同步耗时为微秒级」）
- **问题**：该断言对「close 后 mutateRoot 拒绝路径 + 一次真实 memory 管线 emit（inputPolicy:'full' → JCS 规范化 + SHA-256 + 记录构造）」的墙钟耗时设 **20ms 上界**。真实分布贴界：SA7 报告自测 22–27ms（SA3 终验补记 R2 已登记「本沙箱 scoped/隔离运行下处于边缘」）；本审查独立复现**两轮失败**：
  - 全量 `pnpm test`：`AssertionError: expected 24.73327300000028 to be less than 20`（V6，文件内 16 it 中仅此 1 it 红，直接导致 exit 1）
  - 隔离运行 5 连跑第 2 轮：`expected 20.645360999999866 to be less than 20`（V5 补充采样）
  - 失败率 2/6 ≈ 33%；CI 矩阵 node 20+24 每PR跑两遍，按此率单 PR 全绿概率 < 50%——**这不是环境工件，是断言本身把「亚毫秒级」预期写在了实际 14–25ms 量级的路径上**（注释「上限放宽防慢机 flaky」的 20ms 余量仍不足）。
- **影响**：CI `Test` 步随机红 → 阻塞合并流程、污染后续所有任务的 CI 观测（SA7 报告 DV-5 的「push 后补 run 级证据」将拿到红 run）。
- **回流目标**：**SA7**（测试 owned；SA6 范畴亦可）。修法已在 SA3 终验补记预登记，任选其一：(a) 上界放宽至 ≥100ms（断言语义从「微秒级」降为「无自旋量级」，与首测的 `>= SPIN_MS - 5` 下界断言仍构成完整对照）；(b) 对照测量前先经一次 warmup emit 再计时；(c) 改测相对差（快 emitter 耗时 < SPIN_MS/2）。同族其余墙钟断言均为下界型（慢机只会更高），稳健无需动作（A-1 留档）。
- **注意**：修复必须同步修正未提交 AC checklist 的 Gate summary 表述（其「exited 1 only for two documented vitest-worker RPC timeout environment artifacts」已被本审查证伪——存在第三个 exit-1 成因，即本断言）。

### BLOCKER-2【包卫生】namespace-runtime 漏 version bump（仓库「逐变更 patch bump」惯例）

- **位置**：`packages/namespace-runtime/package.json:3`（`"version": "0.1.7"`，diff 仅 +1 行依赖声明，版本行未动）
- **证据（git 实证，逐变更 patch bump 惯例）**：
  - namespace-diagnostic-log：0.1.0（`7ceede1` #156）→ 0.1.2（`8611e68` #159）→ 0.1.4（`eaf0484` #166）——**每个演进该包的 issue commit 都 bump，含纯增量演进**；
  - namespace-runtime：0.1.5（`5db6f83` #85）→ 0.1.7（`6472485` #105）；
  - doc-runtime：0.1.5 → 0.1.6（`f9994fa` #94 bugfix）；
  - 先例立法：issue #111 standards review BLOCKER-1（registry 漏 bump）明文「仓库惯例（逐变更 patch bump）」，且同 diff 内他包已 bump 而漏 bump 属遗漏非裁决。
- **本票演进面**（足以触发惯例）：dependencies +`@nomicore/namespace-diagnostic-log`、`NamespaceRuntimeSeamInput` +2 可选字段（构造期新增 loud 校验分支）、新模块 `diagnostic.ts`（291 行）、两写槽全部结局点诊断写入、emit 挂点。
- **核对无豁免裁决**：design/conflict_report/ac_checklist/dispatch 全档案 grep 无「豁免 bump」记录 → 遗漏。
- **修法**：`0.1.7 → 0.1.8` 一行（private 包不影响发布，惯例记账一致性；与 #111 BLOCKER-1 同款）。
- **回流目标**：**SA3**。

### ADVISORY / INFO（非阻塞）

- **A-1（INFO，留档）**：DV-2 首 it 的 `syncMs >= SPIN_MS - 5`（:275）与 DV-1 的 `>= 40-5ms` 均为墙钟**下界**断言（同步自旋保证达标，慢机只会更高）——稳健，与 B-1 的上界型不同族，无需动作。
- **A-2（INFO，留档）**：`runtime-root-schema-diagnostic-sa7.test.ts` 不在设计 §16 ALLOW LIST（ALLOW 仅列红灯测试文件）。判定**非越界**：(a) DENY 条款针对「既有冻结测试零改动」——本票对既有测试文件零改动（V1/V3 证实，仅新增文件）；(b) pipeline 先例：#85 单 commit（`5db6f83`）同时携带实现与 `runtime-close-sa7-dynamic.test.ts`/`runtime-mutate-root-sa7-dynamic.test.ts` 等 SA7 动态测试；(c) 总控 dispatch 行 16–17 明示 SA3 并入「SA7 test-only type fixes + 16 dynamic tests + SA4/SA7 reports」。建议 SA1 下轮例行把 SA7 动态测试文件补入 ALLOW LIST（纯档案同步）。
- **A-3（INFO，环境留档）**：全量并行下 `generate-cli-check.test.ts` 2 it 超时红（spawn pnpm+tsx 子进程，vitest 5s/it 默认超时；该文件 #23 遗产、不在本票 diff、隔离复跑 3/3 绿）+ 2 条 vitest-worker RPC Timeout——均为满载环境工件，与 #149 改动无关；但佐证 B-1 修复前不宜以「全量绿」作为稳定性证据。
- **A-4（INFO，移交后续票）**：unhandledRejection 抑制面（emit 附加反应使 fire-and-forget fatal 写的 rejection 被标记 handled）——SA4 I-4 / SA7 DV-3 已动态确认「生产面零依赖」，Registry 接线票知悉即可，本票无动作。

---

## 2. 逐审查项结论表

| # | 审查项 | 结论 | 要点 |
|---|---|---|---|
| 1 | 审查标准：设计一致性（冻结映射/词表） | **通过** | V16：25 结局点逐点一致、零新码零新词表、INV-DIAG 缺省组装仅 `r.ok===true`、acceptance issues 同源透传、emit 挂点为已记录的良性偏差（非包装附加反应——返回 promise 身份零变化，优于设计字面形态且已由 SA3 决策 1 记录在案） |
| 2 | 测试触发（vitest/E2E） | **通过** | V11：两测试文件均落 CI `Test` 步 include；无孤儿 spec；CI 单工作流，`push`/`pull_request` 双触发 |
| 3 | 类型检查触发 | **通过** | V7/V8：`pnpm typecheck`（src）与 `tsc -p tsconfig.typecheck.json`（test 文件，经 `pnpm test --typecheck` 入 CI）双面 exit 0——SA7-F-1（63 处测试类型错误曾致 CI 必红）修复闭环独立复现 |
| 4 | ADR/工程约束 | **通过** | ADR-0012 amendment C：emit 点 = settled 微任务（slot 释放后，P5 sequencer.ts:38-42 注册序复核）；ADR-0011 §D：src 零整文档编码（V14）+ 测试反向鉴别（`expectNoMaterializeWithoutBase`）；ADR-0007：公共返回形状/index.ts/internal.ts 零改动（V2/V3）；ADR-0008 码族/槽序零变化；P0/close 零 emit（排除面）；ADR-0011 §C 输入纪律：not-accessed/unsafe-input/单快照引用（AC5 Proxy trap 计数相等测试钉死）；包 AGENTS.md 边界（FIFO/快照/detached projection/seam 内部）全保持；observedAt 注入 Clock 成对 loud 校验、无 Date.now 缺省 |
| 5 | 范围 | **通过** | V2：ALLOW 全覆盖、DENY/BLACKLIST 零命中、既有测试零改动；SA7 文件裁决见 A-2 |
| 6 | 回归风险（业务面） | **通过** | 未装配 emitter 基线行为等价（diag 全可选链 + 挂点不包装）；时序敏感面（close-lifecycle/p0-sequencer/mutate-root-sequencer 等）随全量 1813/1816 绿（3 失败均非业务回归：B-1 + A-3 环境工件）；red 14/14 + sa7 15/16（唯一失败即 B-1） |
| 7 | 回归风险（CI 门禁稳定性） | **不通过** | **B-1**：DV-2 对照断言 ~33% 失败率将随机打红 CI `Test` 步；AC checklist 的 exit-1 归因表述需随之修正 |
| 8 | 包卫生 | **不通过** | **B-2**：漏 version bump（0.1.7 应 → 0.1.8）；lockfile 登记正确（V10）；导出面零意外扩张（index.ts/internal.ts 零改动；diagnostic.ts 模块级导出仅供包内三模块消费，不入公共面——与 sequencer.ts 同款惯例） |
| 9 | git 卫生 | **通过** | V17：`git diff --check` 零空白错误；无 runtime 残留文件；未提交区仅 AC checklist 一个 wiki 档案 |

---

## 3. 已核实的前轮结论（不再重复展开，终审背书）

- SA4 静态 review（pass + 5 INFO）与 SA7 动态 review（pass + SA7-F-1 已修复）的核心断言经抽查独立复现成立：P1/P2 yjs 源码（V15）、caller 审计（V13）、增量真实性结构面（V14）、tsc typecheck 0 错（V8）、红灯 14/14（V4）。
- SA7-F-1（`96cd085` 原样推送必红 CI 的 63 处测试类型错误）修复的必要性 + 修复后零错均独立复核成立——该问题已闭环，不属本轮 reject 面。

## 4. 固定复验范围（两项 reject 修复后，SA4 只复审以下范围及其直接影响面）

1. **B-1 修复**：`runtime-root-schema-diagnostic-sa7.test.ts` DV-2 对照 it（单文件隔离 ×3 + 全量 `pnpm test` ×1，全部绿 + `Type Errors no errors`）+ AC checklist Gate summary 措辞更新；
2. **B-2 修复**：`packages/namespace-runtime/package.json` version 行 `0.1.8` + `pnpm-lock.yaml` 无连锁变化（`pnpm install --frozen-lockfile` exit 0）。
3. 若修复 diff 超出上述两文件范围 → 视为新改动面，需另行声明审查范围。

其余 7 轴（§2 #1–#6、#9）本轮已 pass，复审不重开；两项修复均不触及生产代码语义（一个测试断言余量、一个版本行），不影响已 pass 的映射一致性/ADR 合规/业务隔离结论。

## 5. 结论

**Verdict: reject。** 实现本体（25 结局点映射、owned bytes 捕获、emit 挂点、四层缺口闭合、ADR 全线合规、范围零越界）经独立验证全部成立；但 (1) 新增 DV-2 对照测试的墙钟上界断言以 ~1/3 概率失败并已在本轮独立全量运行实际打红 `pnpm test`（CI `Test` 步），(2) namespace-runtime 违反仓库逐变更 patch bump 惯例漏 bump 版本。两项均为一行/一断言级修复（SA7 + SA3 各自回流），修复后按 §4 固定范围复验即可转 pass。

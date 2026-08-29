# Standards 轴终审报告 — Issue #153 Reopen streams, roll segments, and repair provable tails

**Date**: 2026-08-29
**Reviewer**: 终审 Standards 轴（独立会话，未与 Spec 轴交换上下文）
**审查 diff 范围**: R0 = `git diff 8611e68..001ff80`（worktree `/home/wangjian/nomicore-fix-issue-153`；24 文件，+4239/−100：packages/namespace-diagnostic-log 的 src×4 / test×7 / helpers / README / AGENTS / package.json + wiki/raw 档案×9）；R1 回流 = `git diff 8611e68..215a18e`（delta `001ff80..215a18e` 仅 2 文件 +20/−22，零行为变更）
**Verdict**: **pass**（R1 回流复审后生效：R0 的 3 条 hard violations + N1 逐项闭合、零新问题引入——见 §5；R0 原始结论 pass-with-issues 保留于 §1–§4 备查；10 条 non-blocking 中 N1 已闭合，余 9 条维持记档不阻塞）

---

## 0. 独立取证记录（命令 + 结果；全部只读或独立后台进程，未改任何文件）

| # | 命令 | 结果 |
|---|---|---|
| E1 | `git diff 8611e68..001ff80 --stat` / `--name-only` | 24 文件（src: file.ts +344/reader.ts +567/paths.ts +12/health.ts +15；test: reopen-roll-repair +1239（新）/sa7-repair-io +241（新）/sa7-dynamic +25/strict-reader +145/layout +27/mismatch +18/r2-supplemental +3/helpers-file +129；README +72/AGENTS +16/package.json 版本行；wiki/raw ×9）；DENY LIST（record/schema/vocabulary/pipeline/emission/sink/memory/frame/storage-gate/carrier/crc32c/canonical-json/digest/schema-patterns/index.ts/testing.ts）零命中 |
| E2 | `git diff --check 8611e68..001ff80` | 干净（零 whitespace 误差） |
| E3 | 仓库根 `pnpm vitest run --typecheck packages/namespace-diagnostic-log`（setsid nohup 独立进程，日志 `/tmp/standards-vitest-root.log`） | **Test Files 22 passed (22)；Tests 379 passed (379)；Type Errors: no errors；exit=0**（11.11s）——与 SA7 §1.5 口径（375 SA6 面 + 4 SA7 补验 = 379）对账闭合 |
| E4 | `pnpm typecheck`（包级 `tsc -p tsconfig.json`，noEmit；日志 `/tmp/standards-tsc.log`） | **exit=0**，零输出 |
| E5 | 通读根 AGENTS.md（31 行）/ CONTEXT.md（130 行）/ 包 AGENTS.md（84 行）/ 包 README.md（205 行）+ diff 全量（src 四文件逐段、test 两新文件逐行、helpers diff、README/AGENTS diff） | 核验记录见 §1–§4 |
| E6 | 通读设计定稿 670 行（§0–§18）、SA4 验尸（pass + LOW×3）、SA7 报告（pass + 计划外 ×3）、dispatch G1–G4、SA6 红灯报告、任务简报 | 档案内部一致；§13 锚 33 条 / SA6 红灯 119 锚 / 主测试文件 50 用例，三方数字对账闭合（grep `it(` 计数 = 50） |
| E7 | 注释计数核验：`MANIFEST_KEYS`（reader.ts:123-138）= 14 键；`buildManifest`（file.ts:169-198）= 17 键；`ROLL_TARGET_KEYS`（reader.ts:127）= 3 键 | 「17 键 = 14 + 三 target 原子扩展」宣称与代码一致（README:86、AGENTS.md:41、reader.ts:127 注均真）；**但 file.ts:6 头注仍称「恰 14 键」→ H1** |
| E8 | `grep -rn "\.only\|\.skip\|it\.todo\|xit\|xdescribe" test/` | 仅 `file-adapter-sa7-repair-io.test.ts:111/145/174/211` 四处 `it.skipIf(isRoot)`——显式条件 skip，且文件头注 :14-15 护栏注释完备（「EACCES 只在非 root 下成立…uid===0 环境 skip」）；无 .only、无裸 skip |
| E9 | 弱断言扫描（`toBeTruthy/toBeDefined/toBe(true)/not.toThrow/toBeGreaterThan(0)`） | 命中 26 处全部合法：`toBe(true)` 均为 `Buffer.equals`/`issues.some`/`statSync.isDirectory` 字节恒等与语义断言；`not.toThrow()` 2 处（:869/:903）断言 disabled 模式 emit 不抛（J6 契约面），均非同义反复；**§13.27 标题宣称未被断言覆盖 → N2** |
| E10 | `grep -n "process.env" src/` | 零命中——无 env-override 面 |
| E11 | 循环依赖排查：reader.ts:28 `import { UINT64_MAX } from './adapters/memory.js'`；memory.ts import 面无 reader/file 回边 | 无环；分层方向记 N9 |
| E12 | 导出面最小性：`cat src/index.ts` | 零新增公共导出（`analyzeStreamForResume`/`ResumeRepair`/`RotateCause` 仅模块级导出供包内 file.ts/health.ts 消费，index.ts 零 re-export）——符合设计 §4.1「不从 index.ts 导出」与 §16 DENY |
| E13 | 事件冻结管线：health.ts `freezeEvent`（:97-104）逐键 Object.freeze、`makeEventNotifier`（:137-147）构造后冻结 + safeNotify | 新事件成员（stream-tail-repaired/stream-generation-rotated）自动走同一冻结/隔离管线，与 §10.3 宣称一致 |
| E14 | 测试运行身份前提复核 | SA7 §1.2 实证本机 uid 1000、CI ubuntu-latest runner 非 root（uid 1001）；sa7 文件有 skipIf 护栏，**主测试文件 §13.32b 同款 EACCES 注入无护栏 → N1** |
| E15 | `paths.ts:8` 既有注释引用 `namespace-registry/src/identity.ts:70` | 实证该行即 `isMinimalSafeString` 定义——引用为真（既有注释，非本票新增） |

---

## 1. Hard violations（3 条——全部为「注释/代码事实不一致」与「死代码」的客观违例，行为面零缺陷）

### H1. file.ts 模块头注契约摘要过期：「恰 14 键」与代码矛盾

- **证据**：`src/adapters/file.ts:5-6`——头注「构造即建三件套：segments/（recursive mkdir）→ manifest.json（'wx' 不可变创建，**恰 14 键**）→ genesis（尽力）→ current.json…」；而本文件 `buildManifest`（file.ts:169-198）实际产出 **17 键**（E7 计数实证），且该函数自身 docstring（file.ts:167）已正确写「恰 14 键 + #153 三 roll target = 17 键」——**同一文件内两处注释互相矛盾**。
- **定性**：头注是模块契约摘要（本仓库注释承载 § 契约引用的纪律面），键计数宣称与代码事实相反；且整个头注（file.ts:1-22）对 #153 的 reopen/修复/滚动只字未提，仍自称「设计 §3/§4——issue #152」。
- **修法**：头注补 #153 段（或最小修复：删「恰 14 键」改「17 键（14 + 三 roll target）」并注明 reopen/修复路径）。琐碎但不修即为欺骗性注释。

### H2. `resumeStreamId` 公共配置 TSDoc 描写的是已删除的旧行为

- **证据**：`src/adapters/file.ts:65`——`/** 提供 → manifest 指纹匹配检查（§3.4；#152 无续写能力——四分支全落新建 generation）。 */`；而构造主流程（file.ts:950-1001）对显式 `resumeStreamId` 执行完整健康证明（`analyzeStreamForResume`）→ 续写或确定性 rotate，「四分支全落新建 generation」语义已被本票物理删除（旧 `readResumeManifest` 函数随 diff 移除）。
- **定性**：公共 API 配置字段的 docstring 与代码行为直接相反，且与本交付 README:121（「提供 → 显式续写目标；构造期健康证明通过 → 续写，失败 → 确定性 rotate」）自相矛盾——README 已更新、TSDoc 未更新。
- **修法**：改为 README 同义表述（显式续写目标 + 健康证明 + 失败 rotate 不回退 locator）。

### H3. 测试文件含零调用死代码 `rotatedProof`，且其 docstring 与函数体不符

- **证据**：`test/file-adapter-reopen-roll-repair.test.ts:121-137`——模块级函数 `rotatedProof`，grep 全文件**零调用点**（仅定义）；函数体是「恰一次 stream-generation-rotated + 新 streamId + current.json 愈合」的断言模板，与同文件 describe 内 `expectRotated`（:494-510，被 10 处调用）逐行重复；其 docstring（:121）却写「合法单 segment 记录主线（rec1 起、默认 targets；装配成 healthy stream 的基模）」——描述的是另一个不存在的 helper，疑似复制残留。
- **定性**：死代码 + 注释与函数体不符（欺骗性注释的测试面形态）。
- **修法**：删除 `rotatedProof`（:121-137 整段）。

---

## 2. Non-blocking judgement calls（10 条记档，不阻塞）

| # | 位置 | 内容 | 建议 |
|---|---|---|---|
| N1 | `test/file-adapter-reopen-roll-repair.test.ts:1174-1191`（§13.32b） | chmod 000 的 EACCES 注入**缺 `it.skipIf(isRoot)` 护栏**——同语义类别的注入在姊妹文件 sa7-repair-io（:108-111 等 4 处）均有护栏 + 头注说明；root 环境（root 可读 000 文件）下本用例会假红（analysis 读到空字节 → resume 而非期待的 rotate）。SA7 §1.2 已实证当前本机/CI 均非 root，故为潜伏可移植性缺口而非现患 | 补 `it.skipIf(isRoot)` 与同族头注一句，与 sa7 文件约定拉齐 |
| N2 | 同文件 :985-997（§13.27） | 标题宣称「首条 committed 至 max + **恰一次事件**、次条丢弃」，但用例未挂 observer、无事件计数断言（仅 `records == [MAX]`）——「恰一次」面未被本用例验证（segment 路径的恰一次由 §13.26a/b 覆盖；sequence 路径恰一次属 #152 既有锚） | 标题删「恰一次事件」半句，或补事件断言 |
| N3 | `src/adapters/file.ts:203-205` vs `src/reader.ts:140-142`；`file.ts:282-284` vs `:936-938` | `isRollTargetValue` 两模块逐字重复；三个 roll-target 默认值字面量（67108864/268435456/100000）在「解析赋值」与「loud 配置门」两处各写一份——单源缺失，未来改默认需改两处，漂移风险 | 默认值提为模块级常量复用；`isRollTargetValue` 可落户 paths.ts/共享原语 |
| N4 | `src/reader.ts:736-761` | `readSegmentJsonl`/`readSegmentBin` 函数体逐字节相同（仅 docstring 文件名不同） | 合并为单函数 `readSegmentFile` |
| N5 | `test/helpers/file.ts:333-341`（新增 variadic `concatU8`）vs `test/file-adapter-strict-reader.test.ts:1191`、`test/file-adapter-r2-supplemental.test.ts:477`（既有 2 参本地版） | 新 helper 入库后两份本地旧拷贝未收敛，同仓三份同义工具 | 后续票统一改引 helpers 版（本票 diff 未触该两处旧函数，非本票引入） |
| N6 | `test/helpers/file.ts:36-42`（`eventsOfTypeRaw`）、reopen-roll-repair :104-114（`RollConfigKeys`/`as` 断言）、layout.test.ts:164-168 | 过渡期「类型面冻结期可编译」脚手架；health.ts 现已含新成员、config 已含新键，前提已消失——但头注（:12-16）如实记档该策略且「SA3 加类型后仍编译」承诺成立（E3/E4 实证），属有意保留 | 可选清理：迁移到 typed `eventsOfType`、去掉 `as` 收敛 |
| N7 | `src/adapters/file.ts:220` | `resolveResumeCandidate` 用占位 streamId（`'log-' + '0'.repeat(32)`）经 `streamLayoutPaths` 派生 namespace 级路径（currentPath/streamsDir 实际不依赖 streamId）——功能正确但该间接无注释说明 | 加半行注释（占位 streamId 仅为取 namespace 级路径） |
| N8 | `src/reader.ts:1136-1139`（catch-all → `manifest-invalid`）+ segmentsDir readdir 失败同因 | 内部异常/IO 兜底统一归 `manifest-invalid`，归因粒度粗（读者会误以为 manifest 坏）；fail-safe 方向正确（保守 rotate），且 SA4 LOW-2 已记档「闭枚举内无更优 cause、实际不可达」 | 维持记档；不新增 cause（受封闭枚举约束） |
| N9 | `src/reader.ts:28` | reader（核心读面）反向 import `adapters/memory.js` 的 `UINT64_MAX`——分层方向倒置（file.ts → memory.js 同款既有）；无循环（E11），设计 §16 DENY 明示「复用不修改」属授权 | 后续票可把 UINT64_MAX/nextDecimal 提到共享常量模块 |
| N10 | `src/adapters/file.ts:715` | `let payload = prepared.payload` 声明后从未再赋值（`const` 足够；同行的 `let record` 有重投影再赋值，属真需求） | 琐碎：改 `const` |

---

## 3. 逐项核验记录（结论面）

### 3.1 仓库/模块纪律合规（根 AGENTS.md / CONTEXT.md / 包 AGENTS.md）

- **环境绑定面三处声明**（包 AGENTS.md:55-63）：diff 后 `node:fs` 仍仅现于 `adapters/file.ts` 与 `reader.ts`；`node:path` 仅 file.ts/reader.ts/paths.ts；`node:crypto`/`Buffer` 未扩散（新测试用 `Buffer.byteLength` 属 test 面，不受 src 声明约束）。✅
- **write-slot 纪律覆盖构造期**：AGENTS.md:36-37 与 README:105-107 已同步追加；构造期全部同步 fs 在构造函数内完成、构造级 crash 包络保留（file.ts:1004-1008）。✅
- **冻结面零触碰**：#148 冻结文件与 `index.ts`/`testing.ts` 零改动（E1）；`schema.ts` 未动 → schema-freeze 指纹钉测试无需同步（且全绿 E3）。✅
- **健康事件低基数白名单**：AGENTS.md:81-83 追加 `repair`/`truncatedBytes`/`cause` 且明示「streamId/segment/offset 刻意不进事件」；实现逐字段吻合（health.ts:84-95；构造点全部封闭枚举/计数，无 message/stack/record 内容）。✅
- **observer 故障隔离**：新事件走既有 freezeEvent + safeNotify + fallbackLog 管线（E13），未新增绕过通道。✅
- **CONTEXT.md**：diff 未改（设计 §16 DENY：无新术语——locator/segment group/orphan/exhausted 均 ADR-0012 既有词条）；README 改动与 CONTEXT.md「诊断日志 stream generation」「storage projection」等既有词条语义一致。✅
- **版本纪律**：package.json 0.1.2 → 0.1.3（硬门禁 9；README:159「旧 reader（0.1.2）」表述与之自洽）。✅

### 3.2 测试纪律

- **断言质量**：两新文件（1239+241 行）全部断言面向运行时产物（磁盘字节/事件/reader 返回），零源码文本断言（SA4 §1.7 已验，本轴抽核一致）；无同义反复断言（E9）；用例标题均带 §13 锚点与行为宣称，标题-断言一致性逐例抽核相符——仅 §13.27 半句过度宣称（N2）。
- **夹具卫生**：tempRoots 注册 + afterEach `rmTempRoot` 清扫（reopen-roll-repair :54-64）；sa7 文件 afterEach 先恢复 0444→0644 再清扫（:55-61，含 chmod 0444 文件的清理注释）；§13.32b 的 000 文件不影响清扫（unlink 只需目录写位）。模块级可变状态仅 tempRoots 数组且 splice 清空——无跨测试泄漏。✅
- **skip 纪律**：无 .only；4 处 `it.skipIf(isRoot)` 均有护栏注释（E8）；N1 记档一处同类注入缺护栏。
- **helpers**：`validManifest` 默认 17 键（本票 writer 产物形状）+ `legacyManifest` 14 键双形状分离，注释（helpers/file.ts:148-151/:176）与设计 §4.1/§13.18(b)/§13.19 互参一致；`writeStreamFixture` 的 segments/current 扩展注释与实现一致。✅

### 3.3 代码质量

- **死代码**：H3（测试面一处）；src 面无死代码——`walkCompletePrefixEnd` 是 SA4 裁定成立的备案偏差支撑（sa4_review §1.2.1），`reprojectSidecarCarrier`/`beforeCommit` 等新增函数全部有调用点。
- **env-override/fallback 软兜底**：零 env 读取（E10）；无静默钳制——roll targets 非法走 loud 配置门 disabled + 事件（file.ts:935-942，注释明示「绝不静默钳制」）。
- **错误吞咽**：逐点 catch 均有注释且去向响亮（locator 不可读→重扫、candidates 空→fresh、writeCurrent 清理失败→吞但有「残留合法」注释）；两处宽收敛（N7/N8）已记档；构造/emit 顶层包络 → pipeline-crashed 事件，非静默。
- **魔数**：`4122`（测试）= 25+4097 有出处注释（:84-86）；`25`/`0x0a`/`99999999`/`UINT64_MAX` 均有 §/ADR 出处；三 roll 默认值字面量重复出现（N3）但每处带「ADR 0012 §Segment rolling」注释出处。
- **导出面最小性**：index.ts 零新增（E12）；`analyzeStreamForResume` 模块级导出为包内消费最小必要。✅
- **注释真实性**：除 H1/H2/H3 外，抽核 20+ 处新注释的 § 引用/计数/行为宣称全部与设计定稿及代码一致（§5.4 行走四态、§6.2 判定序、§6.3 种子、§6.4 重投影、§7 双耗尽、§8.1 碰撞重试 ≤8、§9.1-9.3、§13.11 契约面等均逐条相符；「25B header」「17 键」「4122」计数全真）。

### 3.4 文档一致性（README/AGENTS/CONTEXT.md vs 实现）

- README 新增节（reopen/滚动/修复/耗尽/配置表/运维面）与实现逐条核对一致：locator 三分支与 `resolveResumeCandidate` 吻合；rotate 七 cause 与 `RotateCause` 联合逐一对应；「17 键 manifest/14 键 legacy 可读不可续写」与 `manifestKeyShape` + analysis 1d 步吻合；「耗尽=disabled 绝不新建 generation」与 `beforeCommit` 溢出分支吻合；三 target 默认值与代码一致；运维面「链中 orphan 时间窗处置」「current.json 愈合失败告警」与设计 §14 R1 行逐字对应。✅
- AGENTS.md 增量（构造期 write-slot、reopen/续写段、事件白名单追加）与实现一致。✅
- CONTEXT.md 无改动需求且未改。✅
- **文档面唯一缺口即 H1/H2**（src 内注释，非 markdown 文档）。

### 3.5 wiki 档案一致性（diff 内含 9 份）

- 设计定稿 §13 锚表、SA6 红灯报告（119 锚/50 用例）、SA4/SA7 报告与 dispatch G1–G4 数字互洽（E3/E6 对账闭合）；dispatch :23 明示 SA7 补验测试入 commit 001ff80（终审 diff 完整化）——与 diff 范围自洽。
- 注意（事实记档，非违例）：worktree 当前另有 **staged 未 commit** 的 `…_ac_checklist.md`（A）、`…_sa7_report.md`（A）、`…_dispatch.md`（M）三份流水线档案变更，不在本审查 diff 范围内；sa7_report 作为上下文档案已核读，内容与本轴独立取证（E3/E4/E14）一致。

---

## 4. 结论与处置建议（R0 原始结论——已被 §5 R1 回流复审 supersede）

**Verdict: pass-with-issues**（R0 时点）

- 交付在仓库纪律、冻结面边界、事件词表纪律、write-slot 扩展、测试触发/断言/夹具卫生、文档一致性各维度全面合规；独立复跑 379/379 + typecheck 0 错；SA4/SA7 的 LOW 记档（零字节修复事件语义、兜底归因粒度、repair-io 覆盖）均已闭环或记档，本轴无新增行为面/规格面发现。
- **3 条 hard violations 全部落在注释真实性与测试死代码**（H1 头注 14 键、H2 resumeStreamId TSDoc、H3 rotatedProof），均为单行/小段修复，建议在合入前修正（不修则以欺骗性注释入库，违反本仓库「注释承载契约」的纪律面）。
- 10 条 non-blocking 供后续票消化，其中 N1（§13.32b 补 skipIf 护栏）建议在下一轮顺手并入 H 组修复。

---

## 5. R1 回流 delta 复审（commit 215a18e；2026-08-29）

**范围**: `git diff 001ff80..215a18e`——2 文件 +20/−22（`src/adapters/file.ts` 注释两处；`test/file-adapter-reopen-roll-repair.test.ts` 头注 +3 行 / `isRoot` 常量 +3 行 / `rotatedProof` −14 行 / §13.32b 加 `skipIf`），零行为变更宣称经逐行 diff 核验**属实**（无执行路径改动：仅注释文本、删除未调用函数、包一层条件 skip）。

### 5.1 逐项闭合核验

| 项 | 修复内容 | 闭合证据 | 判定 |
|---|---|---|---|
| H1 | file.ts 头注：「17 键 = 恰 14 键 + #153 三 roll target」+ 新增 #153 reopen/滚动两条契约摘要 | `file.ts:6-15` 逐句对代码/设计复核：17 键计数与 `buildManifest`（:169-198）一致；locator 三分支与 `resolveResumeCandidate` 一致；「三类修复逐次上报/全有或全无」「任一 target ≥ 当前用量 → 下一记录前滚动」「99999999 溢出 = disabled + 恰一次 stream-exhausted 绝不新建 generation」均与实现/设计 §3/§5.5/§6/§7/§8 相符；与同文件 :167 注释矛盾消除 | ✅ 闭合 |
| H2 | `resumeStreamId` TSDoc 改为显式续写语义 | `file.ts:74-75`：「显式续写目标（§3.1 ①）：健康证明通过 → 从 lastCommittedSequence 续写；失败 → 确定性 rotate，绝不静默回退 locator」——与构造主流程（:959-1010）及 README:121 一致；§3.1 ① 引用为真（设计「显式处置优先」） | ✅ 闭合 |
| H3 | 删除 `rotatedProof` 死代码（含不符 docstring） | `grep -rn "rotatedProof" test/ src/` 零残留；删除后其引用的 `eventsOfTypeRaw`/`readJson`/`streamPaths`/`AssembledFileLog` 均仍被他处使用，无孤儿 import | ✅ 闭合 |
| N1 | §13.32b 补 `it.skipIf(isRoot)` + 文件头注护栏说明 + `isRoot` 常量注释 | `test:…reopen-roll-repair.test.ts:23-25`（头注记档运行身份前提 + SA7 §1.2 实证 + 与 sa7 文件同款约定）、`:77`（常量注释）、`:1162`（`it.skipIf(isRoot)`）；同文件其余注入面复核：§13.31/§13.32a/§13.33 均 EISDIR 类（目录占位）注入，root 下依然成立，无需护栏——32b 是唯一 chmod 类缺口，已补齐 | ✅ 闭合 |

### 5.2 无新问题引入核验（独立复跑）

| 命令 | 结果 |
|---|---|
| `pnpm vitest run --typecheck packages/namespace-diagnostic-log`（setsid nohup 独立进程，`/tmp/standards-r1-vitest.log`） | **Test Files 22 passed (22)；Tests 379 passed (379)；Type Errors: no errors**——测试计数与 R0 持平（本机 uid 1000，§13.32b 护栏不触发 skip；root 环境将显式 skip 而非假红/假绿） |
| `tsc -p packages/namespace-diagnostic-log/tsconfig.json`（直接调 `node_modules/.bin/tsc`，规避 corepack/pnpm 版本拦截——纯环境包装问题，非代码问题） | **exit=0** |
| `git diff --check 8611e68..215a18e` | 干净 |
| 修复后头注/TSDoc 全部新宣称逐句真实性复核（§ 引用、计数、行为描述） | 全部属实，零新增欺骗性注释 |

### 5.3 R1 结论

**Verdict: pass**——R0 全部 3 条 hard violations 与 N1 逐项闭合并经复跑实证（379/379 绿、tsc 0 错、diff-check 干净）；delta 零行为变更属实；无新问题引入。余 9 条 non-blocking（N2–N10）维持记档，不阻塞合入。

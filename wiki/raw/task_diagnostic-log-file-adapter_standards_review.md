# 终审 Standards 轴评审报告 — File diagnostic-log adapter（issue #152）

**Date**: 2026-08-28
**Reviewer**: 工程终审 Standards 轴（独立评审，无其它评审者上下文）
**Worktree**: /home/wangjian/nomicore-fix-issue-152（branch `fix/issue-152-on-docs-namespace-diagnostic-change-log`）

## 审查的精确 diff 范围

```text
$ git diff 7ceede1..HEAD
7 commits: 56ed694（实现）→ 0ec62e9（SA6 勘误）→ cb44bcd（SA4 R 修复轮）
         → 98d5280 / 5830612（wiki 归档）→ e311326（version 0.1.1 + health 注释同步）
         → 79ac342（SA7/AC 归档）
31 files, +6073/-11
  代码主体：packages/namespace-diagnostic-log/ 20 文件
    src 新建 5：adapters/file.ts(683) reader.ts(441) frame.ts(119) paths.ts(60) storage-gate.ts(111)
    src 只增修改 5：index.ts(+15) testing.ts(+37) health.ts(+33) carrier.ts(+26) AGENTS.md(+9-2)
    package.json(+1-1，version bump) / README.md(+48)
    test 新建 7+2 helper：file-adapter-{layout,inline-sidecar,genesis-results,strict-reader,
      mismatch-interference,r2-supplemental}.test.ts + helpers/{file,frame}.ts
  流程档案：wiki/raw/task_diagnostic-log-file-adapter*.md × 11（交付物一部分，非代码主体）
```

**基准文档**：任务简报（含 SA6 验收锚定）、设计 R2（含总控 G1–G6/J9 裁决）、SA4 R2（pass）、SA7（pass）均已通读并对照实现逐条复核。

**审查方法**：全量精读 5 个新 src 模块 + 5 个修改 src 文件的 diff + 全部 7 个新测试文件与 2 个 helper；关键纪律面以 grep/实测命令独立取证（非纸面推断）；包级与全仓测试在本 worktree 独立复跑。全部证据标注 `文件:行`。

## Verdict: **pass-with-issues**

**硬违规（reject 级 = 必须修复才能发布）：零。**

冻结面、红灯锚定、生命周期/防御纪律、单源纪律（Pattern 常量）、环境 IO 面收口、事件实质低基数纪律全部成立（证据见「核验通过面」）。下列 10 项均为非阻塞项——其中 N-1/N-2/N-3 建议随 R 修复轮一并闭合（均为 ≤3 行改动），其余为记录级。

---

## 一、非阻塞发现（按建议优先级排序）

### N-1（doc-sync；建议 R 轮修）环境绑定面声明与事实不符：`paths.ts` 实际 import `node:path`

- **证据**：
  - `packages/namespace-diagnostic-log/src/paths.ts:12` —— `import { join } from 'node:path'`（实测 grep 命中）；
  - 但包 `AGENTS.md:37-38` 声明「`node:fs` / `node:path` 仅出现于 `src/adapters/file.ts` 与 `src/reader.ts`——本包唯一 IO 面」；
  - 设计 §1.5 表（`wiki/raw/task_diagnostic-log-file-adapter_design.md:128`）同文，且明文「其余新模块（frame/paths/storage-gate）零环境绑定（纯 TS）」；
  - `paths.ts:1-2` 模块头注亦自称「纯 TS、零环境绑定」。
- **判定**：`node:path` 的 `join` 是纯字符串面（无 IO、无熵源），**纪律的保护意图（IO 面收口于 file.ts/reader.ts）未被破坏**——故非硬违规；但三处声明文本（AGENTS.md/设计/module 头注）与事实直接矛盾，而绑定面声明正是后续 agent 的边界契约文档。
- **建议**：一行声明修订（node:path 允许面列入 paths.ts，或表述改为「node:fs 仅出现于 file.ts/reader.ts；node:path 纯字符串面另出现于 paths.ts」）。

### N-2（doc-sync；建议 R 轮修）事件低基数百名单声明未同步 `code` 字段

- **证据**：
  - 包 `AGENTS.md:53-55`（Verification 段）：「观察者事件只允许低基数字段白名单字段（§8.2）：type/reason/stage/field/fromPolicy/recordKind/operation/schemaId/schemaFingerprint/issuePaths/projectedRecordBytes/queueDepth/issueCount」——**无 `code`**；
  - 该名单与 #148 设计 §8.2（`wiki/raw/task_diagnostic-log-v1-contract_design.md:957-966`）逐字一致，#148 白名单同样**无 `code`/`errno`**；
  - #152 新增三事件成员携带 `code` 字段：`health.ts:59-61`（stream-init-failed `code:'LOG_STREAM_INIT_FAILED'`）、`:63-72`（storage-validation-failed `code:string`）、`:74-79`（storage-write-failed `code:string`）；
  - 设计 §8（`…_design.md:653`）称「低基数字段白名单不变（type/reason/stage/recordKind/operation/code/errno…）」——相对 #148 §8.2 原文此表述不准确（实际是扩了 `code`，只是值仍为固定词表/稳定 errno）。
- **判定**：实质纪律完整保持——全部 `code` 取值为冻结词表或稳定 errno 码，禁 record/input/Base64/message/stack 的红线零触碰（逐成员核对）。属声明文本滞后于 SA6 锚定契约（简报 §1 即定义了带 `code` 的事件形状）。
- **建议**：AGENTS.md Verification 白名单追加 `code`（并同步 #152 设计 §8 的措辞为「扩展」而非「不变」）。

### N-3（测试覆盖；建议 R 轮修）file.ts 重建的 line 预算门**降级分支**零测试锚定

- **证据**：
  - `src/adapters/file.ts:388-398`：input full/redacted 超预算 → 降级 digest + `degraded` + `input-degraded` 事件（J10 自 memory.ts 重建的 ~10 行分支）；
  - 实测：`grep -rn "input-degraded" packages/namespace-diagnostic-log/test/file-adapter-*.test.ts` → **零命中**（7 个 file-adapter 测试文件无一触发降级分支）；
  - 对照：drop 分支已锚定（`file-adapter-r2-supplemental.test.ts:270-292` 注入 4 MiB → `record-dropped/line-budget-exceeded`）；memory 侧同款降级逻辑有 `line-budget.test.ts:30-49` 覆盖。
- **判定**：J10 的防漂移承诺是「双测试集锚定」，file 侧只锚定了一半。风险有缓冲：该分支为 #148 已测逻辑的直移植、且其后紧随 VFSL 门（形状错误会被门拒），故非阻塞；但一个静默错误的降级（如 `fromPolicy` 误填）当前无任何报警。
- **建议**：补一条用例（`inputPolicy:'full'` + 超预算 input → `input-degraded{fromPolicy:'full'}` + 落盘 record 为 digest+degraded 形），即可闭合。

### N-4（测试覆盖；记录级）reader `locator-invalid` 分支零锚定

- **证据**：`src/reader.ts:206-215`（入参 namespaceId/streamId 文法违规 → corrupt + `locator-invalid` + 零 fs 触达，总控 G5 裁决批准的设计行为）；实测 `grep -rn "locator-invalid" packages/namespace-diagnostic-log/test/` → **零命中**。23 码词表中唯一未被任何测试触发的码。
- **判定**：SA6 契约未锚定该分支（简报 §3 测试表无此条目），G5 为已批准的设计裁决——非违规；SA2 R1 攻击点驱动补了 15 条 R2 测试却漏了此面。一条三行用例（敌意 streamId 入参 → corrupt + locator-invalid + 目录零变化）即可闭合，记录备查。

### N-5（注释笔误；记录级）`file.ts:58`「毫秒级守卫」

- **证据**：`src/adapters/file.ts:58` —— `/** 单 update payload 硬上限（毫秒级守卫取 min(配置值, 0xFFFFFFFF)），默认 64 MiB。 */`。「毫秒级」为明显笔误（payload 字节上限与毫秒无关；设计 §1.3/J8 原文无此词）。
- **建议**：删「毫秒级」三字。

### N-6（流程档案死引用；记录级）简报引用的 SA6 详细存档未交付

- **证据**：简报 `wiki/raw/task_diagnostic-log-file-adapter.md:49`：「附：`task_diagnostic-log-file-adapter_sa6_red.md` 为同内容详细版存档」；实测 `ls wiki/raw/task_diagnostic-log-file-adapter_sa6_red.md` → 不存在（diff 31 文件无此文件；#148 有对应存档 `task_diagnostic-log-v1-contract_sa6_red.md`）。
- **判定**：简报同句自述「本简报为唯一权威记录」，故无权威内容损失；红灯证据（exit=1、72 failed 根因四条）在简报 §4 与 SA4/SA7 报告中均有独立留存。属死引用，补档或删引一行即可。

### N-7（重复代码 + 注释不实；记录级）test helper `eventsOfType` 双份

- **证据**：`test/helpers/file.ts:129-135` 的 `eventsOfType` 与 `test/helpers/base.ts:96-102` 逐字重复；所注理由「避免 helper 间彼此 import 循环」不成立——`file.ts:31` 已 import base.ts 的 `OBSERVED_AT`，而 base.ts（`:14-24`）不 import file.ts，单向依赖早已存在、无环可避。
- **判定**：测试夹具层 8 行重复，无行为影响；注释理由是错误陈述。改为一行 re-export 即可（或修正注释）。

### N-8（设计-实现对账；记录级）J10「两处注释互指」未落地

- **证据**：设计 §10-J10（`…_design.md:695`）承诺 line 预算/VFSL 门重建的防漂移措施为「两处注释互指 + 双测试集锚定」。实测：`file.ts:99-107`（measure/utf8Length）与 `:385`（line 预算门）注释均未指向 memory.ts；memory.ts 属 #148 冻结面（DENY）本就不可能加指针——设计该措辞部分不可执行。
- **判定**：实际防漂移依赖测试锚定，而 file 侧降级分支未锚（即 N-3）——N-3 闭合后此项自然消解。无独立修复需求，记录以对账设计措辞。

### N-9（过程备注；零行动）e311326 触碰设计 DENY LIST 文件 `package.json`

- **证据**：设计 §12 DENY LIST（`…_design.md:748`）列 `packages/namespace-diagnostic-log/package.json`（理由：零新增依赖）；commit `e311326` 将其 version 0.1.0 → 0.1.1，commit message 援引「硬门禁 9（Phase 4 前置，非阻塞 backlog 级）」授权。实测：`pnpm-lock.yaml` 零 diff、`dependencies` 段零变化、根 package.json 零 diff——DENY 的实质约束（零新增依赖）完整保持。
- **判定**：功能新增后的 patch bump 本身合理且经总控门禁授权；唯「硬门禁 9」的出处未归档进 wiki（dispatch log 无对应行），授权链只在 commit message。记录备查，无行动。

### N-10（过程备注；零行动）评审时 worktree 有一处未提交改动

- **证据**：`git status --porcelain` → ` M wiki/raw/task_diagnostic-log-file-adapter_dispatch.md`；diff 内容为 dispatch log 追加第 20/21 行（本次双轴终审派单记录，standards=d3e46a53 / spec=39053a1b，状态 pending）。
- **判定**：总控进行中的派单台账，预期内；随终审回执归档即闭合。无行动。

---

## 二、核验通过面（抽查均附实测证据）

### 1. 仓库约定 / 文档同步

- **AGENTS.md 纪律**：包 AGENTS.md Boundaries 段按设计 §1.5 改写为三条环境绑定面声明（diff 实为 +9/-2）；除 N-1/N-2 两处文本滞后外，声明面与实现逐条对合。
- **README 同步**：+48 行 File adapter 节（配置表、磁盘布局、best-effort 免责、R2 两声明——genesis 缺失判别法 §11-G10 与并发读写语义 §4.3-SA2#10），逐项与实现对账一致（默认值 4096/64MiB/1MiB、`resumeStreamId` 恒新建 generation 等均与 `file.ts:215-220`、§3.4 一致）。
- **CONTEXT.md**：零改动——既有词条（`:113-118`「诊断日志 stream generation / 语义 emission / update-omitted 词表」）已覆盖本票概念，设计「本票无需新词条」成立；冻结源 `docs/adr/**` 零 diff（实测 diff --stat 为空）。
- **环境绑定实质面**：`grep node:fs/node:crypto/Buffer` 实测——IO（node:fs）仅出现于 `file.ts:19` 与 `reader.ts:12`；`Buffer` 仅在 `carrier.ts`/`digest.ts`（及既有 emission/pipeline 基线）；frame.ts/storage-gate.ts 零环境绑定（声明属实）。唯一失真 = N-1 的 node:path。
- **健康事件联合只增不改**：`health.ts` diff 纯追加 4 成员，#148 既有 8 成员一字未动（diff 上下文逐行核对）；SA4 R2 backlog N-1（code 注释 5 值集滞后）已由 `e311326` 同步为 6 值集闭合。

### 2. 测试要求

- **红灯锚定**：简报 §4 红灯证据链完整（唯一命令、exit=1、72 failed、根因四条均为 src 缺失、夹具自检排除假红灯）；本评审独立复跑绿灯：
  ```text
  $ npx vitest run --typecheck packages/namespace-diagnostic-log   # node v24.13.0
   Test Files 18 passed (18) / Tests 256 passed (256) / Type Errors no errors / exit 0
  $ npx vitest run   # 全仓
   Test Files 136 passed (136) / Tests 1661 passed (1661) / Type Errors no errors / exit 0
  ```
  （覆盖 e311326 之后的 HEAD——SA7 实测基线为 cb44bcd，本评审把绿灯证据推进到发布候选 HEAD。）
- **断言质量**：字节级断言密集且独立——frame 25B header 逐字节 + CRC 输入域双重独立重算（`file-adapter-inline-sidecar.test.ts:54-62` 测试内联实现 vs `helpers/frame.ts:107-113` helper 实现 vs src `frame.ts:111-118`，三方同构互验）；manifest 恰 14 键键集 + 逐值 + emit 前后字节恒等（`layout:114-147,176-188`）；敌意注入全部断言「事件形状 + 零落盘」双要素；R 修复轮 4 条差分锚定（R-1a/R-1b/R-2a/R-2b）经 SA4 R2/SA7 双重实证「修复前相反结局」，非 vacuous。
- **无 vacuous / 反模式**：实测 `grep "expect(true)"` 零命中；无读源码文本断言（SA4 §1.7 已验，本次复核一致）；`expectTwin`（helpers/twin.ts）为真 JSON round-trip + 冻结 schema 全量校验，非装饰性调用。
- **弱断言两处（记录级，不列 finding 单条）**：strict-reader `:508-517` 前导零 sequence 用例断言到 corrupt+not-ok 为止、未钉 `vfsl-invalid` 码（同文件 frameOffset 孪生用例已钉码——SA6 契约原文即只要求 not-ok，达标但弱于兄弟用例）；`:149-170` flags/reserved 两用例以 `.some(code===A||code===B)` 合并断言。均属 SA6 契约授权形状。
- **CI 接线**：根 `package.json:11` `"test": "vitest run --typecheck"`、`:13` typecheck 链含本包；`.github/workflows/ci.yml:29-39` node 矩阵执行 typecheck+test（SA4/SA7 已验，复核一致）。

### 3. 生命周期 / 防御模式

- **crash 包络三层**：构造级 catch-all（`file.ts:664-668` → failed + 恰一次 `pipeline-crashed{stage:'adapter'}` + `streamId` 占位形状完备 `:671`）、append 面顶层 catch（`:518-525`）、注入面顶层 catch（`:534-541`）、reader 全函数兜底（`reader.ts:430-439` → corrupt，绝不抛）。R2 补充测试 clock 三连与 Proxy getter 陷阱注入锚定（`r2-supplemental:115-136,294-308`）。
- **错误抑制纪律**：逐一审计全部 10 处 `catch`——均转化为事件或状态码：`readResumeManifest` 两处 catch → missing/mismatch 信号（调用方发 stream-init-failed）；`writeCurrent` catch → 事件 + best-effort unlink 的内层空 catch 带注释「残留合法」（`:613-617`，设计 §2.3 授权）；`checkInjectedSidecarFrame` catch → frame-missing loud 事件；reader 各 catch → corrupt + 稳定码。唯一无事件静默分支为 `writeRecord:456`（jsonlPath/binPath 为 null 时的防御 return）——两个调用点（`:502/:532`）已先行同条件拦截，实践中不可达，记录级。
- **事件低基数实质纪律**：新 4 成员全部经 `makeEventNotifier`（freezeEvent + safeNotify）；`code` 取固定词表/errno（`errnoOf` 非 string 兜底 `'EUNKNOWN'`，不上抛 message——`file.ts:118-122`）；`streamId`/`namespaceId` 不进事件；observer 必 throw → fallback 稳定码行（`DIAGNOSTIC_LOG_OBSERVER_FAILED`，mismatch-interference:230-253 锚定）；exhausted 门闩恰一次 + 后续静默（r2-supplemental:186-212 锚定）；genesis 守卫跳过静默（G10 豁免备案 + README 判别法）。白名单声明文本滞后 = N-2。
- **单源纪律**：`P_DECIMAL/P_BASE64/P_STREAM_ID/P_SEGMENT/P_ISO_MS` 全部 import 自 `schema-patterns.ts` 冻结常量（SA4 R-3 已修 carrier.ts 字面量）；`isCanonicalDecimal` 单函数收口四个消费面（storage-gate.ts:26；reader :320/:372、file.ts :435/:442、testing.ts:112）；storage 校验原语 writer/reader 同源（storage-gate.ts）；路径派生 writer/reader 同源（paths.ts）。

### 4. 可维护性

- **模块边界**：依赖方向与设计 §1.1 一致——frame/paths/storage-gate 为近零依赖叶子（storage-gate → carrier/crc32c/frame/schema-patterns），无环；#148 冻结面（memory/pipeline/schema/record/emission/crc32c/digest/schema-patterns 等）实测零 diff；包外零消费者（SA4 §14 复核一致）。
- **有意为之的同构重复（豁免）**：`src/frame.ts` 与 `test/helpers/frame.ts` 的编解码同构——ADR「writer/reader/测试三方独立可校验」的交叉验证设计，简报 §3 明示；helper 的 `isCanonicalBase64` 字面量正则同理（故意独立于 src 防假红灯）。
- **三份 manifest 14 键键集**（writer `file.ts:155-170` 对象字面量 / reader `reader.ts:76-91` MANIFEST_KEYS / layout 测试 `:114-129` 期望数组）——无共享单源，但 layout 测试对键集做精确等值断言，漂移即红，可接受（记录备查）。
- **命名/形状**：`FILE_INTERNAL` Symbol 模式与 #148 `INTERNAL` 同款；`StrictReadRequest` 提取经 SA4 备案；config 全可选字段带 `| undefined` 显式联合（exactOptionalPropertyTypes 纪律）逐字段核对一致。

---

## 三、结论

代码主体在仓库约定、测试质量、生命周期防御、模块边界四面均达到发布水准；SA4/SA7 的 pass 结论经本轴独立复核与实测复跑（包 256/256、全仓 1661/1661、HEAD 含 e311326）确认成立。**零硬违规**；10 项非阻塞发现中 N-1（环境绑定面声明）、N-2（事件白名单声明）、N-3（降级分支测试锚定）建议随 R 修复轮闭合（合计约 1 行 AGENTS.md + 1 行设计措辞 + 1 条测试用例 + 3 字注释删除），N-4/N-5/N-6/N-7 为顺手级，N-8/N-9/N-10 为记录级。

**Verdict: pass-with-issues**（不阻塞发布；建议 R 轮闭合 N-1/N-2/N-3 后归档）。

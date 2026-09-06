# SA7 动态最终验证报告 — Issue #227（final-verification 轮，2026-09-06）

- 角色/阶段：SA7 final verification（流水线 SA5 → SA6 → SA1 → SA2 → SA3 → SA4 → **SA7**）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，基线 HEAD `ac91a6b` + 本 change 工作树未提交改动）
- 被验对象：SA3 实现 `wiki/raw/task_issue-227_sa3_impl.md` 所列全部改动（src 8 + 文档 2 + 测试 5）
- 权威契约：设计 `wiki/raw/task_issue-227_design.md`（R1.1，INV-227-1..10）；
  SA2 复审 `wiki/raw/task_issue-227_sa2_review.md`（approve + **K-1..K-4 binding**）；
  SA6 红灯 `wiki/raw/task_issue-227_sa6_red.md`（§2 命令 / §3.3 红基线 19 条）；
  SA5 复现 `wiki/raw/20260906-bug-issue-227.md` + `repro-20260906-issue-227.ts`；
  SA4 复审 `wiki/raw/task_issue-227_sa4_review.md`（approve）
- 验证方式：**全部独立重跑**——不沿用 SA3/SA4/SA6 任何运行声明；本轮亲读全部 diff 与
  改后关键函数全文，亲跑 7 组验证（§2），并附加**故障翻转独立证明**（§3：SA5 复现脚本
  在修复后代码上重跑，9 条故障断言按设计方向翻转）
- 边界：零生产代码改动、零测试改动、零 git 写操作；唯一写入 = 本文件
- 环境：Node v24.13.0、pnpm 10.28.2、vitest 3.2.7、`NODE_OPTIONS=--conditions=nomicore-source`

## Verdict

**approve**（`requiresConflictRecheck: false`）

- AC1–AC5 与 binding K-1..K-4 逐项独立核验**全部兑现**（§4/§5）；7 组验证命令全部
  达成预期退出码（§2）；故障翻转独立证明成立（§3）。
- 测试零削弱/零跳过掩盖（§6）；DENY 面零触碰（§1）；全部证据可用 §2 命令复现。
- 1 条非阻断观察项（§7 V-1：两改动包未 bump patch 版本——repo CI 立法明示版本提升
  属 release 流程非 PR 门禁，移交总控/release 流程裁量）。

---

## 1. 改动面独立审计（scope vs 设计 §0.2 ALLOW / §0.3 DENY）

`git status`（本轮亲证）：10 个修改 + 4 个新增测试文件 + wiki/raw 证据（未跟踪）。

| 路径 | 类型 | ALLOW 对照 |
|---|---|---|
| `packages/namespace-diagnostic-log/src/read-session.ts` | 修改 | ✅ 列名（§3.1 两常量 + enumerationFailed + renewIfDue） |
| `packages/namespace-diagnostic-log/src/reader.ts` | 修改 | ✅ 列名（session? / ④′ / 检查点 / vanished / unknown 第五成员） |
| `packages/namespace-diagnostic-log/src/adapters/file.ts` | 修改 | ✅ 列名（deleteGroupIfUnleased + P0 租约门） |
| `packages/namespace-diagnostic-log/src/retention.ts` | 修改（仅 JSDoc） | ✅ 列名（零形状变更） |
| `packages/namespace-diagnostic-log/src/index.ts` | 修改（+3 行 re-export） | ✅ 列名 |
| `apps/yjs-server/src/diagnostic-replay.ts` | 修改 | ✅ 列名（session 生命周期 + ④ 重写 + K-3/K-4） |
| `apps/yjs-server/src/index.ts` | 修改（+1 行类型 re-export） | ⚠️ ALLOW 未逐字列名——SA4 O-1 已裁「接受」（纯加性类型导出，DENY 零涉） |
| `packages/namespace-diagnostic-log/AGENTS.md` / `README.md` | 修改 | ✅ 列名（#227 增量段/示例同步——本轮亲读，内容与实现逐点相符） |
| `apps/.../diagnostic-replay-host-lifecycle-sa7.test.ts` | 修改（K-1 pin 改写） | ✅ 列名（§8.5 处置表） |
| 4 个新测试文件（A/B/C/D 红文件） | 新增 | ✅ 列名（§8.1–8.4） |

- **DENY 面 zero-diff 亲证**：`git diff HEAD --name-only -- src/schema.ts src/record.ts
  src/emission.ts src/pipeline.ts src/sink.ts src/adapters/memory.ts` → **空**；
  `CONTEXT.md` → **空**（SA4 O-2 理由成立：零 health 事件成员、零新 reason，AGENTS.md 已承载）。
- `deleteGroup` S1–S3 本体逐字未动（diff 亲证仅外围包装）；`analyzeStreamForResume`
  的 `enumerateSegmentGroups`（reader.ts:1181）为 DENY 保护面、零改动。
- **INV-227-2 独立 grep 亲证**：`enumerateSegmentGroups` 在 src 全部调用点 =
  read-session.ts:210（唯一枚举源）、reader.ts:1181（analyzeStreamForResume，DENY 面）、
  file.ts 六处（sweep）；`readStreamStrict` 函数体内**零**直呼——快照即枚举成立。

## 2. 本轮亲跑验证命令与结果（全部后台 Job 执行，2026-09-06 20:13–20:21）

| # | 命令（可逐字复现） | 结果 | 退出码 |
|---|---|---|---|
| CMD1 | `NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts packages/namespace-diagnostic-log/test/strict-reader-materialize-unknown.test.ts packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts apps/yjs-server/test/diagnostic-replay-lease-completeness-red.test.ts apps/yjs-server/test/diagnostic-replay-host-lifecycle-red.test.ts` | **Test Files 6 passed (6) / Tests 68 passed (68) / Type Errors no errors**（含 E1–E5 真实进程 E2E 37.5s） | **0** |
| CMD2 | `NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts -t "重点 4"` | **1 passed \| 5 skipped**；stdout 实测：`[SA7-DV] #227 重点 4 改写后语义实测：status=partial issues=[{"code":"update-unknown"}] lastSeq=2` | **0** |
| CMD2b | `... vitest run apps/yjs-server/test/diagnostic-replay-host-lifecycle-sa7.test.ts`（无过滤全文件） | **6 passed (6)**（重点 5 真实进程 NDJSON 全生命周期 6.09s 绿） | **0** |
| CMD3 | `... vitest run packages/namespace-diagnostic-log` | **Test Files 30 passed (30) / Tests 448 passed (448) / Type Errors no errors**（含 schema-freeze 指纹钉死＝设计 §9「schema 冻结自证」真实承载面） | **0** |
| CMD4 | `pnpm typecheck` | 14 个 tsconfig 顺序全过 | **0** |
| CMD5 | `pnpm test`（全量根套件，完成定义） | **Test Files 264 passed (264) / Tests 2906 passed (2906) / Type Errors no errors / 380.11s** | **0** |
| CMD6 | `NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/tsx wiki/raw/repro-20260906-issue-227.ts` | **7 PASS / 9 FAIL，exit 2**——预期签名：9 条失败恰为 SA5 故障断言的修复后翻转（§3） | **2（预期）** |

红灯基线可信性交叉核：SA6 在 HEAD `ac91a6b`（本 change 前）两次独立实测 19 条红
（`wiki/raw/task_issue-227_sa6_red.md` §3.3）；本轮 §3 的翻转证明独立闭环该链。

## 3. 故障翻转独立证明（CMD6——本轮新增证据，非 SA3/SA4 声明）

SA5 复现脚本逐字重跑于修复后代码：退出码 2（「故障复现不完整」），**9 条原故障断言
全部按设计方向翻转**，未翻转的 7 条均为「语义不变面」的对照腿——实现真实改变了
运行时行为，而非仅改测试：

| 原 SA5 断言（pre-fix 全 PASS） | 本轮实测（post-fix FAIL = 翻转成立） |
|---|---|
| A3 materialize(fatal-unknown) → none | `materialize={"kind":"unknown"}`（G4 闭合） |
| A4 replay complete/[] | `status=partial, issues=[{"code":"update-unknown"}]`（G3 闭合） |
| A5 lastSeq 推进至 4 | `lastAppliedSequence=2`（不推进过 fatal-unknown） |
| A6b 快照含 tail、缺 flag（静默丢失） | `snapshotBytes=65, hasTail=false`（前缀态，保真声明不再为假）；A6a PASS 行直接给出 `materialize=[1:update, 2:update, 3:unknown, 4:update]` |
| B3 materialize(effect 缺席) → none | `{"kind":"unknown"}`（F-1 闭合） |
| B5/B6 replay complete、推进至 7 | `partial + update-unknown`、lastSeq=2 |
| B7 K-2 形状链 complete 可达 | 非 complete（K-2 专项语义另由 D4c 钉：`partial + update-omitted + lastSeq='3'`，CMD1 绿） |
| D2 活跃租约下 P0 删 bin（orphanBinsDeleted=1、leaseBlockedGroups=0） | `orphanBinsDeleted=0, binExists=true, leaseBlockedGroups=1`（G2/AC2 闭合） |

不变面（仍 PASS，符合设计「零回退」承诺）：A1 strict 读 ok、B1 VFSL 接受 effect
缺席形状（schema 未动）、C1/C2 畸形必要 update 仍 VFSL fail-closed、D1/D4 会话快照事实。

## 4. AC1–AC5 逐项确认（代码锚点本轮亲读 + §2 亲跑证据）

| AC | 确认事实 | 证据 |
|---|---|---|
| **AC1** 全程持约、续租或诚实失败 | ✅ reader：①′ 防御门（身份不符→corrupt+locator-invalid、closed→corrupt+lease-expired，零 fs）；④′ 快照即枚举/自开自关（ownedSession 三出口 close：④′ 枚举失败/⑦/⑧）；每段读 jsonl 前 `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)` 检查点（bounded 拒续→lease-expired+break 保留已读）。replay：locator 后自开 session（非法供参 throw 面收敛 failed+replay-internal-error，K-3）、内层 try/finally 恒 close、物化前检查点（genesis/attempt 双点） | A1/A2/A4a/A4b/A5×2、D1 bounded/unbounded、D2 恒释放全绿（CMD1）；代码 reader.ts:411–440/:546–604/:659–662/:833–868、diagnostic-replay.ts:129–136/:226–229/:304–308 |
| **AC2** sweep 只删无 lease 组、无 TOCTOU | ✅ S0′ `deleteGroupIfUnleased`（S1 rename 前同 now 复查 segmentLeased；P1 :1266/P2 :1334 双门 + 前缀止步 break）；P0 orphan-BIN unlink 前租约门（:1171–1176，跳过计入 leaseBlockedGroups，N-3）；`segment-vanished` 兜底（ENOENT ∧（marker 在 ∨ bin 缺）；BIN-first 豁免臂逐字保留）；open 原子 + S0′ + marker 不可见三腿闭合 | A3a/A3b/A3c、B2×2、B3×2 绿（CMD1）；CMD6 D2 翻转（bin 幸存、leaseBlockedGroups=1）；deleteGroup 本体 diff 零改动 |
| **AC3** fatal/committed:true/unknown 不再推进至 complete | ✅ materialize 谓词（reader.ts:946–972 亲读）：omitted 无条件 → carrier 合取 → `fatal∧committed:true`（其余一切 effect 含缺席）→ `{kind:'unknown'}` → 余 none——**穷举无任何 committed:true 形状落 none**（INV-227-5）；replay switch `'unknown'` → `update-unknown` + `break entryLoop`、不推进（INV-227-6） | D3/D8 绿（CMD1）；K-1 改写 pin 绿（CMD2/CMD2b：partial/[update-unknown]/lastSeq=2）；CMD6 A4/A5/B5/B6 翻转 |
| **AC4** 缺失/omitted/unknown/不可解码 → 稳定 partial/failed + issue；complete 仅全证可达 | ✅ app 侧联合推导整体删除（-66 行，diff 亲证）、materialize 唯一分类源；连续性复核先于物化/omitted（N-1：D4d 实测 update-omitted 从 issue 集消失、sequence-gap 存续）；complete 门表达式逐字保留（INV-227-7）；omitted 双形状+K-2（D4a/b/c）、undecodable（D5）、断链（D6a）、畸形 carrier（D6b）、pre-genesis 损坏（D9：failed + frame-missing×4 + genesis-missing）、非法供参（K-3a/b：不抛 + failed + replay-internal-error） | CMD1 18/18 全绿（D 文件）；CMD6 C1/C2 维持 fail-closed |
| **AC5** 测试覆盖并发/到期续租/unknown/omitted/保真回归 | ✅ A1–A5（11）+ B2–B3（4）+ C1–C4（4）+ D1–D9+K-3+夹具自证（18）+ K-1 改写（1）+ 既有零回退面（read-session 9 + lifecycle-red 22 含真实进程 E2E）全部落地且绿；「并发」按设计 §8.0 三等价类构造（注入钟生命周期 / 公共 API 步进交错 / S0′+vanished 结构可观测）；D7 混合健康链 complete/issues=[]/lastSeq='6'/快照终态 保真回归绿 | CMD1（68/68）、CMD2b（6/6）、CMD3（448/448）、CMD5（2906/2906） |

## 5. binding K-1..K-4 逐项确认

| # | 约束（SA2 §4） | 本轮独立核验 | 结论 |
|---|---|---|---|
| **K-1** | SA7 重点 4 pin 废止改写为 D3 语义，与红文件同 change | diff 逐字亲读：旧断言（complete/issues:[]/lastSeq'4'/count=9）移除，新断言（partial/[update-unknown]/lastSeq'2'/count=5）+ 头注 4 号条目改写；`git status` 同批未提交改动。CMD2 绿（stdout 见 §2）；CMD2b 全文件 6/6 无姊妹扰动 | ✅ |
| **K-2** | D4 增 fatal/committed:false/omitted 手拼变体 pin（partial + update-omitted、不推进） | D4c 绿（CMD1：partial + [{update-omitted}] + lastSeq='3'）；materialize omitted 分支无条件（reader.ts:947–951，注释明示 K-2）；CMD6 B7 链不再 complete 佐证 | ✅ |
| **K-3** | replay session open throw 收敛 failed + replay-internal-error（零新码）+ 非法供参 pin | open 位于内层 try/finally 之外、顶层 catch 之内（diagnostic-replay.ts:129–136 vs :309–320 亲读）；K-3a/b 绿（不抛断言 + failed + [replay-internal-error] + lastSeq null + 无 snapshot）；grep `replay-internal-error` 仅顶层 catch 一处 push（零新码，INV-227-10） | ✅ |
| **K-4** | diagnostic-replay.ts 头注五条件措辞同 change 同步 | 头注 :12–15「（#227 K-4 措辞同步）必要条件收紧」段 + :22–27 租约生命周期段亲读，与实现语义一致 | ✅ |

（K-5 为 SA1 可选项：设计未再修订，SA2 复审文件本身即 annex——非本轮验面。）

## 6. 测试完整性审计（无削弱 / 无跳过掩盖）

- **零抑制标记**：5 个新增/改写测试文件 grep `.skip\|.only\|.todo\|passWithNoTests\|continue-on-error\|xit(` → **零命中**（本轮亲跑 grep，exit 1）。
- CMD2 的「5 skipped」是 `-t "重点 4"` **名称过滤**（SA6 §2 自定命令逐字复跑），非抑制；
  CMD2b 无过滤全文件 6/6 全绿证伪任何「过滤掩盖」假设。
- 全量 CMD5：264 文件 / 2906 用例**全部 passed**（vitest 无 skipped 报告）——本 change
  新增 37 用例（11+4+4+18）全部在集且执行。
- **K-1 改写是增强非削弱**：旧 pin 把缺陷行为钉为期望（complete/[]/'4'/9），新 pin 断言
  更严格的 fail-closed 语义（partial/[update-unknown]/'2'/5）——issue AC3 逐字要求。
- 断言纪律亲读：全部针对运行时产物（读/replay 报告、issue 码、磁盘文件、sweep 报告、
  `retention-swept` 事件、Y.Doc 解码快照）；零源码文本断言；时钟全注入（静态 T0 或每次
  now() 前进的步进假钟）；外部 session 用例 afterEach close + temp root 清理。
- 既有零回退面：T-C1..C8/T-B6（9/9）、R1–R11（22/22 含真实进程 E2E）、包级 30 文件
  448/448、全仓 264/2906——CMD1/CMD3/CMD5 亲证。

## 7. 观察项（非阻断，移交总控/release 流程知悉）

- **V-1（版本 bump 缺位）**：本 change 修改 `packages/namespace-diagnostic-log/src/**`（5 文件）
  与 `apps/yjs-server/src/**`（2 文件），但两包 `package.json`（0.1.6 / 0.1.3）未提升 patch 版本。
  事实链：(a) SKILL.md 硬门禁 9 要求改码模块 bump；(b) 历史上 d948ea5/41d4d6a/c8912a0/ac91a6b
  每次 src 变更均 bump（#226 的 SA3 亦明示「硬门禁 9」执行 bump）；(c) **repo CI 立法
  （.github/workflows/ci.yml L68–73）明文**：「不要把『与 registry 同版本 integrity 相等』
  ……当作源码 PR 门禁——**版本提升与 npm publish dry-run 属于 release 流程**」，且
  `NOMICORE_VERIFY_REGISTRY_INTEGRITY=0` 显式关闭同版本比对；(d) 本任务设计 §0.2 ALLOW
  白名单未列 package.json（SA2 批准的范围内本就不含 bump）。裁断：CI（发布真门禁）明示
  版本提升属 release 流程 → **不构成 PR 阻断**；建议总控在 finalize 或 release 流程中
  补 bump（namespace-diagnostic-log 0.1.6→0.1.7、yjs-server 0.1.3→0.1.4，lockfile 全
  `workspace:*` 无需变更——#226 先例亲证），或在发布时统一处理。
- **继承 SA4 O-1..O-4**（本轮复核均维持「接受/备案」）：O-1 apps/yjs-server/src/index.ts
  +1 类型 re-export；O-2 CONTEXT.md 未改（AGENTS.md 已承载词表备案）；O-3 marker
  `st.isFile()` 目录形态理论边界；O-4 设计 §9 `pnpm schema:check` 裸命令笔误（真实承载面
  = schema-freeze.test.ts，CMD3 内绿）。
- 流程记录：`task_issue-227_dispatch.md` 仅 SA1 一行（SA4 已备案；派发日志归总控补记，
  非 SA7 职权）。

## 8. 结论

实现与设计 R1.1、SA2 K-1..K-4 binding、INV-227-1..10 的兑现经本轮**全部独立重验**无偏差：
定向契约 68/68、K-1 pin 1/1（全文件 6/6）、包级 448/448、typecheck 14/14、全量 2906/2906
全部 exit 0；SA5 故障脚本 9 条断言按设计方向翻转（独立证明红→绿非空洞）；DENY 面零触碰、
零测试削弱、证据全部可由 §2 命令逐字复现。**SA7 裁定 approve，可进入收尾。**

Verdict: **approve**（`requiresConflictRecheck: false`）

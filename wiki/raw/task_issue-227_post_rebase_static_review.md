# 独立静态复审（post-rebase 权威实现 + 审计档案）— Issue #227（2026-09-07）

- 被审对象：rebase 后权威工作树 = HEAD **`ce196cd`**（「fix(diagnostics): lease strict replay
  and fail closed」）+ 全部未提交改动（8 修改 + 9 未跟踪 wiki 证据——SA7 H-3 所述 17 项集合，
  rebase 后原样保持）；branch `mabf/issue-227`（ahead 1 of `origin/docs/namespace-diagnostic-change-log`）
- 输入（全部亲读）：任务简报 `wiki/raw/task_issue-227.md`；**Issue #227 全部评论**（`gh api`
  独立核得：恰 1 条 owner 评论 id 5559458232，welltop-jim-wang，2026-09-06T13:14:31Z——PR #251
  评审反馈两条必修项；PR #251 state=open、comments=0、review_comments=0、reviews=0——**无第二条
  owner 指令、无新增评论**）；rev2 全档案（design R2.1 / design_conflict_report / sa2_review /
  sa6_red / sa3_impl / sa4_review / impl_conflict_recheck / sa7_report）+ R1 档案（sa4_review 含
  R2 追加、impl_conflict_recheck）；现文 reader.ts / read-session.ts / file.ts（DENY 面）/ 三测试文件
- 复审方式：**全部独立重验**——rebase 等价性以 git 对象级比较亲证（§1）；owner 两条必修以现文
  行号锚点逐点静态核验（§2/§3）；DENY zero-diff、词表、触发面、版本 bump 亲证（§4–§7）；
  定向三契约 35/35、包级+replay 505/505、`pnpm typecheck` 后台 Job 独立重跑（§8）
- 边界：零生产代码改动、零测试改动、零 git 写操作（不 commit/push/stage）；唯一写入 = 本文件
- 环境：Node v24 / pnpm / vitest 3.2.7、`NODE_OPTIONS=--conditions=nomicore-source`

## Verdict

**approve**（`requiresConflictRecheck: false`）——owner 两条必修在 rebase 后权威实现上逐点成立；
rev2 变更集经 rebase **字节级无损**；DENY 面 zero-diff；版本 bump、触发面、证据链完整自洽。
3 条非阻断观察（§9）。

---

## 1. Post-rebase 等价性（本轮专项——历史档案均以 `31ff694` 为基线，rebase 后需独立闭合）

| 核验点 | 亲证事实 | 裁决 |
|---|---|---|
| 实现代码树等价 | `git diff 31ff694 ce196cd -- packages/namespace-diagnostic-log/src packages/namespace-diagnostic-log/test apps/yjs-server/src apps/yjs-server/test` → **空**（诊断包与 yjs-server 的实现/测试内容 rebase 前后逐字节一致；两树差异仅基线侧 `packages/namespace-registry` 的 #248/#250 提交——非本票变更集） | ✅ |
| rev2 脏 diff 无损 | `git diff 31ff694 -- packages/namespace-diagnostic-log` 与 `git diff ce196cd -- packages/namespace-diagnostic-log` 的 `git patch-id --stable` **同为 `a8d3027ebdcb75aa132e0552f4b72ae0efba51ee`**——被 SA2/SA6/SA3/SA4/SA8/SA7 审过的 rev2 工作树变更集在 rebase 后逐字节保持 | ✅ |
| 工作树集合 | `git status` 恰 17 项：8 修改（src/reader.ts、src/adapters/file.ts、包 AGENTS.md、包 package.json、三测试文件、`task_issue-227_sa4_review.md` R2 追加）+ 9 未跟踪（R1 impl_conflict_recheck + rev2 八件）；`git diff --check` 干净 | ✅ |
| 结论 | 历史 rev2 证据链（红基线 4 failed \| 2913 passed → 全绿 2917）所依据的代码内容与 rebase 后权威工作树**等价**，证据链可无损承接；本轮另以后置重跑佐证（§8） | ✅ |

## 2. Owner 必修 (1)：自建臂取得点 + 统一 finally + manifest 阶段并发（O-1 → D8/D9/D10）

owner 原文（`gh api` 核得逐字）：「在路径安全检查后、第一次 manifest I/O 前取得 session；使用统一
`finally` 确保自建 session 最终释放；补充测试，证明 manifest read/gate 期间 lease 已注册，并覆盖该
阶段与 retention sweep 并发。」

| 核验点 | 现文亲证（reader.ts） | 裁决 |
|---|---|---|
| 取得点位置 | `readStreamStrict`（:413）时序：①′ 传入会话防御门（:424–450，纯字段校验）→ ① 路径安全（:452–463，`isSafeNamespaceId`/`isSafeStreamId` 纯文法、零 fs）→ `streamLayoutPaths`（纯 join 派生）→ **④″ 会话取得（:466–514）** → **② manifest `readFileSync`（:519，全函数首次 manifest I/O）** → ③ 门/policy（:562–602）→ ④′ 反应（:611–622）→ ⑤ 逐段（:677 检查点）。自建臂 `openDiagnosticReadSession({..., clock: request.clock})`（:481–486）；传入臂纯绑定（:477–478，不跑取得检查点——生产唯一调用方 `apps/yjs-server/src/diagnostic-replay.ts:139` 走传入臂，行为零变化） | ✅ |
| 注册先于受保护观察 | open 内部（read-session.ts 现文，DENY 未动）：枚举（:209–214）→ `openAt = clock.now()`（:215，注册前）→ 注册表登记（:229–247）——同一同步函数无 yield；④″ 后一切 manifest I/O 均在已注册会话保护下 | ✅ |
| 取得检查点 | `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)`（reader.ts:502）= 注册后、② 前唯一天然钟读位（renewIfDue 无条件先读钟，read-session.ts:157）；拒续 → `corrupt + lease-expired`、`manifest:null`、零进一步 IO | ✅ |
| **唯一 finally** | grep 亲证：`ownedSession` 全文件仅三处——声明（:419）、赋值（:487）、**`finally { ownedSession?.close() }`（:899）**；函数体内零 `close()` 直呼站点（原 ④′/⑦/⑧ 三处分散站点已在 diff 删除）。早退覆盖清单全部位于 try 体内：② manifest 缺失（:520–531）/JSON 损坏（:535–546）/非对象（:547–558）、③ schema-compile（:563–574）/**gate 失败 corrupt+incompatible 双臂（:576–588）**/policy（:591–602）、④″ open 防御 catch（:488–500）与检查点拒续（:502–513）、④′ enumerationFailed（:611–622）、⑤ break、⑦ 双返回、⑧ 异常逃逸——close 幂等（read-session.ts:162–166）；传入臂不 close（生命周期归调用方） | ✅ INV-227-11 |
| manifest 阶段并发测试 | **A6a**（strict-reader-lease.test.ts:425–451 亲读）：fake 钟 call#2（取得检查点位）回调内 probe `sweepRetention({now:T0})` → 断言 `leaseBlockedGroups ≥ 1 ∧ deletedGroups === 0`（manifest read/gate 期间 lease 已注册的直接运行时证据）+ `rmSync(manifest)` → 读取 `corrupt + [manifest-invalid] ∧ manifest===null`（钩子位于 ② 之前的判别性证据）；**A6b** 只 probe 不删 → 读取 `ok` 全量 `[1,2,3]`（并存臂）；**A7 ×5**（:478–568）manifest 缺失/JSON 损坏/gate corrupt 臂（version 篡改）/gate incompatible 臂（指纹篡改）/enumerationFailed 早退读后 sweep 断言注册表零残留（`deletedGroups===2 ∧ leaseBlockedGroups===0`，enum 形态 0/0）——对漏 finally 的新实现必红的结构 pin。本轮实跑全绿（§8） | ✅ |

## 3. Owner 必修 (2)：S0′ 提交时刻取时 + 到期放行（O-2 → D11 + G-227-5）

owner 原文（逐字）：「S0′ 复查时读取真正提交时刻的当前时间，不复用 sweep 起始时间；如需测试
确定性，注入 clock；增加测试：租约在 sweep 开始后、S1 rename 前到期时，应允许删除。」

| 核验点 | 现文亲证（file.ts） | 裁决 |
|---|---|---|
| S0′ 取时来源 | `deleteGroupIfUnleased`（:1100–1108）已弃 `now` 形参：`segmentLeased(..., clock.now())`——适配器闭包钟（`config.clock ?? {now: () => Date.now()}`，:313），调用点紧邻 `deleteGroup`（:1071 起，首步 = S1 `renameSync` jsonl→`.deleting`）——**提交门取时即刻先于 S1 rename**；P1（:1275–1281）/P2（:1343–1349）调用点均已弃实参 | ✅ INV-227-3 修订版 |
| 不复用 sweep 起始 now | P1 初查（:1266）/P2 初查（:1333）/年龄门（`now - maxAgeMs`，:1270）仍用 sweep 入参 now（策略面，INV-227-12 语义分工）；`sweepRetention(options?.now ?? clock.now())`（:1537）与构造期 `sweepNow(clock.now())`（:1525，T-A7）原样；**`Math.max` 在 file.ts 零命中**（grep 亲证）——无折衷修法、无回退取时 | ✅ INV-227-12 |
| G-227-5（P0 门采含） | P0 orphan-BIN unlink 门（:1181）同改 `clock.now()`；`hygieneStream` 弃 `now` 参（:1132 起，调用点 :1248）——SA2 §5.3 裁定采含，ADR L289 统辖全部删除面 | ✅ |
| 注入面 | 既有 `config.clock`（owner「注入 clock」承载，零新公共 API）+ reader 侧 `StrictReadRequest.clock?`（:47–52，G-227-6 平铺加性可选——先例 read-session.ts:34 / diagnostic-replay.ts:63 同构） | ✅ |
| 到期放行测试 | **B4a 主臂**（retention-lease-gate 亲读）：armed 后首个 `clock.now()` = P1 S0′ 提交位（fixture 无 orphan → P0 不触门；初查/年龄/字节全消费入参 now 零钟读）回调内注册 probe（ttl 5、独立静态钟 T_REG=T0+10 → until T0+15）后返回 T0+15 → `segmentLeased` 严格 `>`（read-session.ts:255）判过期 → 放行：`deletedGroups===1 ∧ leaseBlockedGroups===0 ∧ jsonl/bin 消失 ∧ probe.closed===false`（放行源于**到期**而非关闭——INV-4 字面证据；租约注册于 sweep 开始（now=T0）之后、S1 rename 之前——**owner 点名场景逐字兑现**）；**B4b control** 返回 T0+12 ∈ [T_REG, T_REG+5) → 仍活跃 → `deletedGroups===0 ∧ leaseBlockedGroups≥1`（反向钉死提交时刻语义）；**B5 ×2** 同机制双向钉 P0 门。本轮实跑全绿（§8） | ✅ |

## 4. T-C3/T-C4 夹具钟源对齐（SA8 F-1 → R2.1 处置）

- diff 亲读：`buildThreeGroups` 增可选 clock 透传（缺省分支省键 → 其余调用方零变化）；
  T-C3/T-C4 以**同一 `newClock(T0)` 对象引用**直传 writer 构造与会话 open（K-R2-3 same-object）；
  **断言行零改动**（`leasedUntil===T0+1000`/`===T0+3000` 自钉值、`deletedGroups===2`、
  `sweepRetention({now: clock.t})` 原样）——性质 = 夹具对齐（D11 下旧双钟构造形成「按策略时刻
  已过期、按提交时刻仍活跃」的合法阻塞），非断言削弱、非 TTL 延长、非 now 篡改。本轮 9/9 实跑绿。

## 5. ADR / 契约合规（policy/ADR compliance）

| 条款 | 核验 | 裁决 |
|---|---|---|
| ADR-0014-LOG L289（只删除无 reader lease 的 closed 组） | 提交门以提交时刻评估「没有 lease」（INV-4 在提交点字面复位）；持约范围扩至 manifest 阶段——兑现型，零 amendment（docs zero-diff 亲证） | ✅ |
| L291–295（删除协议 S1–S3/orphan 文法） | `deleteGroup` 本体零 hunk；S0′ 仍是 S1 前置门，仅取时来源变更 | ✅ 零触碰 |
| L297（短期 segment lease / 显式续租） | 缺省 maxLifetimeMs=null 显式续租臂维持（read-session.ts DENY 未动） | ✅ 兑现型收紧 |
| L301–318（strict/replay 行为与报告形状冻结） | ②③ 门语义与早退包络逐字节不动；`StrictStreamRead`/报告形状零变更；分类/complete 面零 hunk | ✅ 零触碰 |
| ADR-0011（重放五条件） | rev2 不触碰分类/complete 面 | ✅ 无涉 |
| 包 AGENTS.md | R2 增量段（取得点/统一 finally/提交时刻 + now 分工）与实现逐点相符；环境绑定面不变（node:fs 仍收口 file.ts/reader.ts；read-session/retention 纯 TS）；词表零增量（新码零；A6/A7 复用 `manifest-invalid`/`lease-expired`，B4/B5 复用既有报告计数） | ✅ |
| DENY zero-diff（vs HEAD） | `git diff ce196cd --name-only -- apps docs CONTEXT.md .github vitest.config.ts pnpm-lock.yaml package.json src/read-session.ts src/retention.ts src/index.ts src/schema.ts src/adapters/memory.ts README.md` → **空**；未跟踪文件全部位于 `wiki/raw/` | ✅ |

## 6. 版本 bump（version bump）

- `packages/namespace-diagnostic-log/package.json`：0.1.6 → **0.1.7**（45a22f0 / e6ddff1 / 31ff694 /
  ce196cd 均 0.1.6，工作树 0.1.7——本票唯一被改包，patch 级正确）。
- 依赖方 `apps/yjs-server` 为 `workspace:*` → pnpm-lock.yaml 无需变更（lockfile zero-diff 亲证）。
- `apps/yjs-server` 维持 0.1.3：rev2 对其零改动（DENY），维持 SA4-R2 §R2.4/冲突门禁 §7-O2 非阻断
  裁定（repo CI 立法：版本提升属 release 流程，非 PR 门禁）。

## 7. 测试触发面（test trigger coverage）

- `vitest.config.ts` `test.include = packages/*/test/**/*.test.ts + domains + apps`（maxWorkers:1、
  typecheck enabled）——三个改动测试文件全部在全量 `pnpm test` 触发面内；`.github/workflows/ci.yml`
  跑 `pnpm typecheck` + `pnpm test`（另加 4 个 `--passWithNoTests=false` 定向门禁，与本包无涉）。
- 触发面零改动：vitest.config.ts / 根 package.json scripts / `.github/**` / pnpm-lock.yaml 对 HEAD
  **zero-diff**。
- 零抑制：三测试文件 grep `.skip|.only|.todo|xit(|xdescribe|passWithNoTests|continue-on-error`
  **零命中**（本轮亲证）；零源码文本断言（全部断言运行时产物）。
- 新用例计数与 SA6 §1 清单一致：strict-reader-lease 18（+7：A6a/A6b/A7×5）、
  retention-lease-gate 8（+4：B4a/B4b/B5×2）、read-session 9（净增 0，仅夹具对齐）——本轮实测
  18+8+9=35 全绿。

## 8. 本轮独立重跑（后台 Job，post-rebase 工作树，2026-09-07 00:19–00:22）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run <三契约文件>` | Test Files 3 passed (3) / **Tests 35 passed (35)** / Type Errors no errors（18+8+9，1.24s） | **0** |
| `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-diagnostic-log apps/yjs-server/test/diagnostic-replay` | Test Files 33 passed (33) / **Tests 505 passed (505)** / Type Errors no errors（53.91s） | **0** |
| `pnpm typecheck` | **14 tsconfig 链全过**（vfsl/vfsl-protocol/vfsl-codegen/persistence/dsh-persistence/doc-runtime/namespace-runtime/clock/instance/namespace-registry/namespace-diagnostic-log/replication-protocol/ws-replication/apps-yjs-server，含本包与 yjs-server） | **0** |

与 SA4 §6 / 冲突门禁 §6 / SA7 §2 报告数值逐项互证一致（35/505/typecheck exit 0）；SA6 红基线
（4 failed \| 2913 passed）与 SA7 全量（2917 passed）互补闭合（2913+4=2917）自洽。本轮未重跑
6.5 分钟全量（final-verification 已由 SA7 CMD4 + R2.2 H-1 双跑佐证；§1 等价性 + §8 后置重跑
承接其证据链）。

## 9. 非阻断观察（移交总控，均已有归属登记）

| # | 项 | 定性 |
|---|---|---|
| O1 | `task_issue-227_dispatch.md` 仅 1 行（R1 SA1），rev2 各轮（SA8/SA1 R2.1/SA2/SA6/SA3/SA4/SA8/SA7×2）未补记 | 总控簿记债（设计 N-c / SA2 N-3 / SA4-R2 O1 / 冲突门禁 O3 / SA7 O1 五处已归属）；不影响证据链正确性 |
| O2 | 全部 rev2 档案的基线引用为 rebase 前 `31ff694`（rebase 发生在档案产出之后）；rebase 后无档案级复核记录 | 本轮（§1 对象级等价亲证 + §8 后置重跑）即该缺口的闭合：实现内容与被审变更集字节级一致，历史证据链可无损承接 |
| O3 | 根 `REPORT.md` 为早前 #155 任务的存量内容（基线分支已跟踪文件，不在本票 dirty diff 内） | 与 #227 变更集无涉；发布/收尾文案归总控与 publication 流程裁量 |

## 10. 结论

Owner 两条必修在 **post-rebase 权威工作树**（ce196cd + rev2 未提交变更集）上逐点静态成立并有
真实运行测试背书：(1) 自建臂 ④″ 取得点（① 路径安全后、② 首次 manifest I/O 前）+ 唯一 finally
（:899，覆盖 manifest 缺失/JSON 损坏/gate 失败双臂等一切早退）+ A6a/A6b/A7×5 并发与零泄漏契约；
(2) S0′/P0 提交门以 `clock.now()` 现值评估（不复用 sweep 起始 now、无 Math.max 折衷）+ B4a/B4b/
B5×2 到期放行契约。rev2 变更集经 rebase 字节级无损；DENY 面 zero-diff；版本 bump、触发面、证据
完整性（含 Issue 评论面恰一条 owner 指令的独立核得）全部验证通过。

**Verdict: approve（requiresConflictRecheck: false）**

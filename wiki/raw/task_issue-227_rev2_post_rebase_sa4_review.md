# SA4 独立静态实现复审（rev2 / post-rebase 权威工作树）— Issue #227

- 角色/阶段：SA4 implementation-review（post-rebase 轮；被审对象 = rebase 后权威工作树）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，HEAD **`ce196cd`**
  「fix(diagnostics): lease strict replay and fail closed」+ rev2 未提交变更集；`git rev-parse HEAD`
  亲证；分支 ahead 1 of `origin/docs/namespace-diagnostic-change-log` = `e6ddff1`）
- 被审对象：工作树对 HEAD 的全部未提交改动（8 修改 + 9 未跟踪，§5 亲证）——即 rev2
  （owner 两条必修）SA6 红灯 + SA3 实现的变更集
- 输入（全部亲读）：任务简报 `wiki/raw/task_issue-227.md`（AC1–AC5）；rev2 全档案
  （`task_issue-227_rev2_design.md` R2.1 / `_sa2_review.md` / `_sa6_red.md` / `_sa3_impl.md` /
  `_sa4_review.md` / `_impl_conflict_recheck.md` / `_sa7_report.md` /
  `task_issue-227_post_rebase_static_review.md`）；**Issue #227 评论面 `gh api` 独立重取**
  （§0）；现文 reader.ts / read-session.ts / file.ts / paths.ts / 三测试文件 / ADR-0012 L280–318
- 方式：**全部独立重验**——不沿用任何前轮运行声明：diff 逐 hunk 亲读 + 现文行号回读；
  grep 亲证（释放点/钟消费点/抑制标记/断言改动）；rebase 等价性 git 对象级亲证（§5）；
  定向 35/35、包级+replay 505/505、`pnpm typecheck` 14 tsconfig 全部**本机后台 Job 独立重跑**
  （§7，含 owner 命名场景 13 用例 verbose 按名亲证）
- 边界：零生产代码改动、零测试改动、零 git 写操作（不 commit/push/stage）；唯一写入 = 本文件
- 环境：vitest 3.2.7、`NODE_OPTIONS=--conditions=nomicore-source`、后台 Job（bash-1..bash-4）

## Verdict

**approve**（`requiresConflictRecheck: false`）

Owner 两条必修（Issue 评论 id 5559458232，2026-09-06T13:14:31Z，welltop-jim-wang——本轮
`gh api` 独立重取逐字核得）在 rebase 后权威工作树上逐点静态成立并有真实运行测试背书；
rev2 变更集经 rebase **字节级无损**（patch-id 亲证）；DENY 面 zero-diff；无测试抑制、无断言
削弱、无禁用修法（`Math.max` 零命中）；验收契约（AC1–AC5）、ADR-0012-LOG 冻结面、包
AGENTS.md 全部合规。4 条非阻断登记（§9）。

---

## 0. Owner 评论面独立核得（本轮 `gh api` 亲证）

```
gh api repos/welltop-jim-wang/nomicore/issues/227/comments
→ 恰 1 条：id 5559458232 / welltop-jim-wang / created=updated=2026-09-06T13:14:31Z
gh pr view 251 --json state,comments,reviews → {"state":"OPEN","comments":0,"reviews":0}
```

评论原文两条必修与任务简报转录逐字一致：(1) 「在路径安全检查后、第一次 manifest I/O 前
取得 session；使用统一 `finally` 确保自建 session 最终释放；补充测试，证明 manifest read/gate
期间 lease 已注册，并覆盖该阶段与 retention sweep 并发」；(2) 「S0′ 复查时读取真正提交时刻的
当前时间，不复用 sweep 起始时间；如需测试确定性，注入 clock；增加测试：租约在 sweep 开始后、
S1 rename 前到期时，应允许删除」。**无第二条 owner 指令、无新增评论/review。**

---

## 1. Owner 必修 (1)：取得点前移 + 唯一 finally + manifest 阶段并发契约

### 1.1 取得点位置（D8/D10）——代码亲证（现文行号）

`readStreamStrict`（reader.ts:413）时序独立亲读：

| 步骤 | 现文锚点 | 亲证 |
|---|---|---|
| ①′ 传入会话防御门 | :424–450 | 纯字段校验（身份不符 → `corrupt+locator-invalid`；已 close → `corrupt+lease-expired`），零 fs |
| ① 路径安全 | :452–463 | `isSafeNamespaceId`/`isSafeStreamId`——paths.ts:24–39 亲读为纯文法循环/正则，**零 node:fs**（paths.ts 唯一依赖 `node:path` join）；`streamLayoutPaths`（paths.ts:49–64）纯 join 派生 |
| **④″ 会话取得** | **:466–514** | 自建臂 `openDiagnosticReadSession({rootDir, namespaceId, streamId, clock: request.clock})`（:481–486）→ `ownedSession = session`（:487）→ 取得检查点 `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)`（:502，拒续 → `corrupt + lease-expired`、`manifest:null`、零进一步 IO）；传入臂纯绑定（:477–478，不跑检查点——A2 传入臂钟序列零漂移） |
| ② manifest 读取 | :516–558 | `readFileSync(paths.manifestPath)`（:519）= **全函数首次 manifest I/O，严格位于 ④″ 之后** |
| ③ 门/policy | :561–602 | schema-compile / 21 码门（corrupt+incompatible 双臂）/ policy 提取——全部在已注册会话保护下 |
| ④′ 反应半段 | :606–622 | enumerationFailed 包络原位（manifest 已读、包络冻结）；`segments := [...session.segments]`（:623） |
| ⑤ 逐段循环 | :672–831 | 逐段检查点 `renewIfDue`（:677，拒续 → `lease-expired` + break 保留已读） |

- **注册先于受保护观察**：open 内部（read-session.ts，DENY 零改动）时序亲读：校验（:191–204）
  → 枚举（:209–214）→ `openAt = clock.now()`（:215，注册前）→ 注册表登记（:229–247）——
  同一同步函数无 yield（原子）；④″ 返回后一切 manifest I/O 均在已注册会话保护下。
  **「先观察后注册」的静默丢失窗口（owner 指出的 G6）关闭。**
- **`request.clock` 消费面**：grep 亲证全函数唯一消费点 = :485（自建臂 open 透传）；
  `StrictReadRequest.clock?`（:47–52）为 G-227-6 裁定的平铺可选加性字段（先例
  read-session.ts:34 / diagnostic-replay.ts:63 同构），传入臂忽略。
- **生产零行为漂移**：缺省 ttl=15_000 / margin=1_000（read-session.ts:19/:22 单源）下检查点为
  `now+1000 < leasedUntil` 快路径真值（open 刚返回）；真实钟下纯通过、零副作用。

### 1.2 唯一 finally（D9，INV-227-11）——grep 亲证

```
grep -n "ownedSession" reader.ts → 恰三处：
  :419 声明 / :487 赋值 / :899 finally { ownedSession?.close() }
sed -n '413,899p' reader.ts | grep "\.close()" → 仅 :487 相对位（= 绝对 :899 的 finally 体）
```

函数体内**零** `close()` 直呼站点（原 ④′ enumerationFailed / ⑦ / ⑧ 三处分散站点已在 diff
删除——diff hunk 亲证）。早退覆盖清单全部位于 try 体内、经 finally 释放：② manifest 缺失
（:520–531）/ JSON 损坏（:535–546）/ 非对象（:547–558）；③ schema-compile（:563–574）/
**gate 失败 corrupt+incompatible 双臂（:576–588）**/policy（:591–602）；④″ open 防御 catch
（:488–500，ownedSession 尚 null → finally 幂等空操作）与检查点拒续（:502–513，真释放）；
④′ enumerationFailed（:611–622）；⑤ 各 break；⑦ 双返回（:859/:870）；⑧ 异常逃逸（catch
:880 后 finally 恒达——同步函数）。close 幂等（read-session.ts:162–166）。传入臂不 close
（生命周期归调用方——replay finally 唯一责任方，diagnostic-replay.ts 本轮 zero-diff）。

### 1.3 测试有效性（manifest 阶段持约 + 与 sweep 并发）——亲读 + 实跑

- **A6a**（strict-reader-lease.test.ts，红差分主证）：fake 钟 call#2（= 取得检查点位——
  rev2 §3.1.2 时序表：call#1 = open `openAt` 注册前、**call#2 = 检查点 `renewIfDue`（注册后、
  ② 前唯一钟读位**，read-session.ts:157 无条件先读钟、call#3+ = ⑤ 检查点）回调内：
  ① probe `sweepRetention({now:T0})` → 断言 `leaseBlockedGroups ≥ 1 ∧ deletedGroups === 0`
  （**manifest read/gate 期间 lease 已注册的直接运行时证据**——probe P1 初查（file.ts:1266，
  策略面入参 now）即被 until T0+15_000 的已注册租约阻）；② `rmSync(manifest)` → 读取
  `corrupt + [manifest-invalid] ∧ manifest === null ∧ records []`（钩子位于 ② 之前的判别性
  证据：若误挂 call#1 注册前 → probe 不阻 → 红；若挂 call#3+ → manifest 已读、rm 无从影响
  ② → 红）。probe sweep 内部零钟调用（fixture 无 orphan → P0 门不触；P1 初查即阻 → S0′
  不可达）——零重入、确定性。
- **A6b**（并存臂）：只 probe 不删 manifest → 读取 `ok` 全量 `['1','2','3']` + probe 零删
  ——「该阶段与 retention sweep 并发」并存零丢失。
- **A7 ×5**（唯一 finally 释放矩阵·结构 pin）：manifest 缺失 / JSON 损坏 / gate corrupt 臂
  （version 篡改）/ gate incompatible 臂（schemaFingerprint 篡改）/ enumerationFailed
  （rm segments/）五形态，读后立即 sweep → `deletedGroups === 2 ∧ leaseBlockedGroups === 0`
  （enum 形态 0/0）——注册表零残留 = finally 已释放的可观测证明；对「漏 finally 的新实现」
  必红（②③ 早退泄漏 → leaseBlockedGroups ≥ 1）。manifest 缺失/损坏两形态在验证 sweep 前
  恢复盘面 manifest = 披露的夹具必需（`scanSweepStreams` 对不可定序流保守跳过），断言强度
  零放宽。
- **红基线互证**：SA6 在 pre-rebase `31ff694` 上实测 4 failed（A6a/A6b/B4b/B5-control）|
  2913 passed；本轮工作树（= 同一变更集 + 实现）35/35 全绿（§7）——红→绿链闭合。

**结论：必修 (1) 三子项（取得点/统一 finally/并发测试）逐项落地。✅**

## 2. Owner 必修 (2)：S0′ 提交时刻取时 + 到期放行测试

- **`deleteGroupIfUnleased`**（file.ts:1100–1108）：签名已弃 `now` 形参；
  `segmentLeased(rootDir, namespaceId, streamId, segment, clock.now())` —— 适配器闭包钟
  （`const clock = config.clock ?? { now: () => Date.now() }`，:313 亲证）于 S1 rename 前
  即刻读取现值（门紧邻 `deleteGroup` :1071 起，首步 = S1 `renameSync(jsonl→.deleting)`）。
  P1（:1275–1281）/ P2（:1343–1349）调用点均已弃实参（diff hunk 头亲证 :1262→:1270、
  :1330→:1338）。**不复用 sweep 起始 now——owner 字面兑现。**
- **策略面语义分工（INV-227-12）**：P1 初查（:1266）/ P2 初查（:1333）/ 年龄门
  （`now - maxAgeMs`，:1270）/ 字节统计仍用 sweep 入参 now；`sweepRetention(options?.now ??
  clock.now())`（:1537）与构造期 `sweepNow(clock.now())`（:1525，T-A7 锚点）原样；
  `sweepRetention` JSDoc 收窄为「策略时刻」（:122–131）。
- **G-227-5（P0 门采含，SA2 §5.3 裁定）**：P0 orphan-BIN unlink 门（:1181）同改
  `clock.now()`；`hygieneStream` 弃 `now` 参（:1132 起，调用点 :1248）。
- **注入面**：既有 `config.clock`（零新公共 API）+ reader 侧 `StrictReadRequest.clock?`
  （加性可选）——owner「如需测试确定性，注入 clock」由既有面承载。
- **禁用修法排除**：`grep -c "Math\.max" file.ts` → **0**（无 `Math.max(now, clock.now())`
  折衷）；无回退取时；`deleteGroup`（S1–S3）本体 :1071–1090 零 hunk（diff 首 hunk 起点
  :1087/:1091 为 `deleteGroupIfUnleased` JSDoc）。
- **测试有效性**：
  - **B4a 主臂**（owner 点名场景逐字兑现）：armed 后首个 `clock.now()` = P1 S0′ 提交位
    （fixture 无 orphan → P0 门不触；初查/年龄/字节全消费入参 now 零钟读——file.ts 亲证）
    回调内注册 probe（ttl 5、独立静态钟 T_REG=T0+10 → until T0+15——注册时刻 **晚于** sweep
    起始 now=T0）后返回 T0+15 → `segmentLeased` 严格 `>`（read-session.ts:255）：
    `T0+15 > T0+15` 不成立 → **判过期 → 放行**：`deletedGroups===1 ∧ leaseBlockedGroups===0 ∧
    jsonl/bin 消失 ∧ probe.closed === false`（放行源于**到期**而非关闭——INV-4 字面证据）。
    即「租约在 sweep 开始后、S1 rename 前到期 ⇒ 允许删除」。
  - **B4b control**：返回 T0+12 ∈ [T_REG, T_REG+5) → 提交时刻仍活跃 → `deletedGroups===0 ∧
    leaseBlockedGroups≥1 ∧ 文件在`——反向钉死「提交门读的是提交时刻」（若读 sweep 起始
    now=T0 → probe until T0+15 > T0 判活跃 → 阻塞 → B4a 断言红）。
  - **B5 ×2**：P0 门位（P0 先于 P1，sweepNow :1248 先于 :1252+ 亲证）同机制主臂/control
    双向钉死 G-227-5 采含后的 P0 提交时刻语义。
  - **T-C3/T-C4**（SA8 F-1 处置）：diff 亲证**断言行零改动**（`git diff … | grep
    "^[-+].*expect"` → 零命中）；仅夹具钟源对齐 = **同一 `newClock(T0)` 对象引用**直传
    `buildThreeGroups`（makeWriter config）与会话 open（K-R2-3 same-object 兑现）；缺省分支
    省键 → 其余调用方零变化。新旧双向绿复核：旧实现初查/S0′ 同用入参 now（=共享钟推进值）
    → 过期放行；新实现 S0′ 读同一共享钟 → 同值过期放行——非伪绿。

**结论：必修 (2) 三子项（提交时刻取时/注入 clock/到期放行测试）逐项落地。✅**

## 3. 验收契约（AC1–AC5）映射核验

| AC | 核验 |
|---|---|
| AC1 枚举/读取/校验/物化期间取得并最终释放 lease、续租或诚实失败 | manifest 读取/门/policy（「读取、校验」）现全部在持约下（④″ 前移 + open 原子注册）；唯一 finally 恒释放（INV-227-11）；逐段 `renewIfDue` 检查点 + 取得检查点拒续 → `lease-expired` 诚实中止（保留已读）。owner 引用的 AC1 缺口（manifest 阶段）闭合 ✅ |
| AC2 sweep 只删无有效 lease 的 closed 组、无 TOCTOU 窗口 | 双向结构闭合：注册先于首次受保护观察（腿 4）；S0′/P0 提交门以提交时刻评估（腿 5，INV-227-12）——sweep 开始后注册且活跃 → 阻塞（B4b）；sweep 开始后注册、提交前到期 → 放行（B4a）；`deleteGroup` 本体 S1–S3 零 hunk ✅ |
| AC3/AC4 unknown committed effect / partial-failed 分类与 complete 门 | rev2 零触碰（分类/complete 面 DENY zero-diff：diagnostic-replay.ts、materialize、sa7 pin 均无改动）；R1 已审态维持 ✅ |
| AC5 测试覆盖并发/到期续租/unknown/omitted/complete 保真 | rev2 增量 A6a/A6b（manifest 阶段并发）、A7×5（零泄漏）、B4a/B4b/B5×2（到期放行/活跃阻塞）、T-C3/T-C4（过期放行/重租）+ 既有 R1 矩阵零回退（35/35、505/505 亲跑）✅ |

## 4. ADR / 包契约合规

- **ADR-0012-LOG L289**「retention 只删除已关闭且没有 reader lease 的 segment group」：提交门
  以提交时刻评估「没有 lease」——INV-4（过期租约永不阻塞）在提交点字面复位（兑现型诚实
  读法，零 amendment；`docs/**` zero-diff 佐证）。
- **L291–295**（删除协议 S1–S3 / orphan 清理文法）：`deleteGroup` 本体 :1071–1090 零 hunk；
  S0′ 仍是 S1 前置门，仅取时来源变更。
- **L297**（短期 segment lease / 显式续租）：持约范围明确扩至 manifest 阶段（AC1 完整兑现）；
  read-session.ts（DENY）零改动。
- **L301–318**（strict/replay 行为与报告形状冻结）：②③ 门语义与各早退包络逐字节不动
  （④′ 反应半段原位、包络冻结——diff 亲证）；`StrictStreamRead`/报告形状零变更。
- **包 AGENTS.md**：R2 增量段（取得点/统一 finally/提交时刻语义 + now 分工）与实现逐点相符；
  环境绑定面不变（node:fs 仍收口 file.ts/reader.ts；read-session/retention 纯 TS）；词表零增量
  （A6/A7 复用 `manifest-invalid`/`lease-expired`，B4/B5 复用既有报告计数——零新码/事件成员）。

## 5. 工作树稳定性与 rebase 等价性（本轮专项亲证）

- `git status --porcelain`：**恰 17 项** = 8 修改（src/reader.ts、src/adapters/file.ts、包
  AGENTS.md、包 package.json、三测试文件、`wiki/raw/task_issue-227_sa4_review.md` R2 追加）
  + 9 未跟踪（全部位于 `wiki/raw/`：R1 impl_conflict_recheck + rev2 八件 + post_rebase_static_review）。
  与被审 rev2 变更集（SA6 §1 / SA3 §1 / SA4 §4 / 冲突门禁 / SA7 §6 所列）**完全一致**，无多
  无少。`git diff --check` → 干净（exit 0）。
- **rebase 等价性（对象级）**：`git diff 31ff694 ce196cd -- packages/namespace-diagnostic-log/src
  packages/namespace-diagnostic-log/test apps/yjs-server/src apps/yjs-server/test` → **0 行**
  （实现/测试内容 rebase 前后逐字节一致；两 HEAD 树差异仅基线侧 #248/#250 提交）；脏 diff
  patch-id：`git diff ce196cd -- packages/namespace-diagnostic-log` 与 `git diff 31ff694 -- …`
  的 `git patch-id --stable` **同为 `a8d3027ebdcb75aa132e0552f4b72ae0efba51ee`** —— 被全部
  前轮（SA2/SA6/SA3/SA4/SA8/SA7）审过的 rev2 变更集在 rebase 后**字节级无损**，历史证据链
  可无损承接；本轮另以后置重跑佐证（§7）。
- **DENY zero-diff（vs HEAD）**：修改清单不含 `docs/**`、`CONTEXT.md`、`apps/**`、
  `src/read-session.ts`、`src/retention.ts`、`src/index.ts`、`src/schema.ts`（冻结指纹）、
  `src/adapters/memory.ts`、`vitest.config.ts`、根 `package.json`、`.github/**`、
  `pnpm-lock.yaml`——全部 zero-diff。版本 bump：`@nomicore/namespace-diagnostic-log`
  0.1.6 → 0.1.7（package.json diff 仅此一行——亲证）；依赖方 `workspace:*` → lockfile 无需
  变更（zero-diff）；`apps/yjs-server` 维持 0.1.3（rev2 对其零改动）。

## 6. 测试抑制/削弱/触发面排除

- 抑制标记：三测试文件 grep `.skip|.only|.todo|.fails|vi\.mock|process\.env` → **零命中**；
  整个测试 diff `grep -cE "^\+.*(\.skip|\.only|\.todo|xit\(|xdescribe)"` → **0**。
- 断言削弱：T-C3/T-C4 diff 断言行零命中（§2）；A6/A7/B4/B5 为纯新增用例。
- 零源码文本断言（全部断言运行时产物：读状态/issue 码/sweep 报告计数/盘面文件/会话状态机）。
- 触发面零改动：`vitest.config.ts` / 根 scripts / `.github/**` / `pnpm-lock.yaml` zero-diff；
  三个改动测试文件均在 `pnpm test` 触发面内（本轮 505/505 亲跑含其全部）；vitest
  `--typecheck` 生效（本轮运行均报 `Type Errors no errors`）。`passWithNoTests` 为既有仓库
  级配置（vitest.config.ts 零改动），非本 change 引入。

## 7. 本轮独立重跑（后台 Job，2026-09-07，post-rebase 工作树）

| # | 命令（可逐字复现） | 结果 | 退出码 |
|---|---|---|---|
| 1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run <三契约文件>` | Test Files 3 passed (3) / **Tests 35 passed (35)**（18+9+8）/ Type Errors no errors | **0** |
| 2 | 同上 `--reporter=verbose`（owner 命名场景按名核验） | **13/13 按名通过**：A6a、A6b、A7×5、T-C3、T-C4、B4a、B4b、B5×2 | **0** |
| 3 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-diagnostic-log apps/yjs-server/test/diagnostic-replay` | Test Files 33 passed (33) / **Tests 505 passed (505)** / Type Errors no errors（53.84s） | **0** |
| 4 | `pnpm typecheck`（14 tsconfig 链：vfsl…namespace-diagnostic-log…apps/yjs-server） | 全过 | **0** |

与前轮数值逐项互证一致（SA4 §6 35/505、冲突门禁 §6、SA7 CMD1–CMD3、post-rebase 复审 §8）；
SA6 红基线（4 failed | 2913 passed，全量 2917）互补闭合（2913+4=2917）。本轮未重跑 ~6.5 分钟
全量 `pnpm test`（final-verification 已由 SA7 CMD4 + R2.2 H-1 双跑佐证 + §5 等价性承接；
受审范围为静态复审 + 定向/包级/typecheck 亲跑已足）。

## 8. 审计证据链完整性

rev2 全链在档且相互自洽：SA8 设计门禁（reject 窄修型 → R2.1 免重开）→ SA2 approve
（K-R2-1..4；G-227-5 采含、G-227-6 平铺）→ SA6 红基线（4 failed 留证）→ SA3 impl → SA4
approve → 实施冲突门禁 clear → SA7 approve（2917/2917 + R2.2 终态复核）→ rebase →
post-rebase 静态复审 approve → **本轮 post-rebase SA4 复审（本文件）**。所有档案引用的基线
`31ff694` 经 §5 对象级等价亲证与现工作树一致。

## 9. 非阻断登记（移交总控）

| # | 项 | 定性 |
|---|---|---|
| N-1 | 全部 rev2 档案基线引用为 pre-rebase `31ff694`（rebase 发生在档案产出后） | 已由 §5 对象级等价（diff 0 行 + patch-id 同值）+ §7 后置重跑闭合；后续档案可直接引用 ce196cd |
| N-2 | `task_issue-227_dispatch.md` 稀疏（rev2 各轮未补记） | 总控簿记债（设计 N-c / SA2 N-3 / SA4 O1 五处归属）；不影响证据链正确性 |
| N-3 | `apps/yjs-server` 维持 0.1.3（R1 遗留 V-1）；package.json bump 越rev2 §0.2 白名单字面 | 前者维持前轮非阻断裁定（版本提升属 release 流程）；后者为 SA3 声明 + SA4/冲突门禁已裁接受（纯加性、workspace:*、lockfile zero-diff）——本轮维持 |
| N-4 | manifest 缺失流上自建臂多付一次 segments/ readdir（取得点前移固有代价） | 设计 R2-R2 备案；包络不变；可忽略 |

## 10. 边界声明

本轮零生产代码/测试改动、零 git 写操作（不 commit/push/stage/rebase）；唯一写入 = 本文件。
未运行 CI/发布链路；测试均以本地后台 Job 独立进程执行并收集退出码（bash-1..bash-4 全部
completed / exit 0）。`gh api` 仅只读查询 Issue/PR 评论面。

**Verdict: approve（requiresConflictRecheck: false）**

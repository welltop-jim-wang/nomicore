# SA7 动态最终验证报告（rev2/R2.1）— Issue #227（final-verification 轮，2026-09-06）

- 角色/阶段：SA7 final verification（rev2 轮：SA1 R2.1 设计 → SA2 approve → SA6 红灯 → SA3 实现 → SA4 approve → 实施冲突门禁 clear → **SA7**）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，HEAD `31ff694` + rev2 工作树未提交改动；`git rev-parse` / `git status` 亲证——恰 8 修改路径 + 8 未跟踪 rev2 wiki 证据）
- 输入（全部亲读）：任务简报 `task_issue-227.md`；rev2 设计 `task_issue-227_rev2_design.md`（R2.1，D8–D11 / INV-227-1 改写 / 3 修订 / 11 / 12）；SA2 `task_issue-227_rev2_sa2_review.md`（approve + K-R2-1..K-R2-4）；SA6 `task_issue-227_rev2_sa6_red.md`（红基线 4 failed | 2913 passed）；SA3 `task_issue-227_rev2_sa3_impl.md`；SA4 `task_issue-227_rev2_sa4_review.md`（approve）；实施冲突门禁 `task_issue-227_rev2_impl_conflict_recheck.md`（clear）
- Owner 要求原文（本轮 `gh api` 独立重取核得——Issue #227 唯一一条 welltop-jim-wang 评论 2026-09-06T13:14:31Z；PR #251 comments/reviews 均空，**无第二条 owner 指令、无新增评论**）：(1) strict reader 在路径安全检查后、首次 manifest I/O 前取得 session；统一 `finally` 确保自建 session 最终释放；补测试证明 manifest read/gate 期间 lease 已注册并覆盖该阶段与 retention sweep 并发；(2) S0′ 复查读取真正提交时刻的当前时间、不复用 sweep 起始时间；如需确定性注入 clock；增测试：租约在 sweep 开始后、S1 rename 前到期时应允许删除
- 验证方式：**全部独立重跑**——不沿用 SA3/SA4/SA6/冲突门禁任何运行声明；`git diff 31ff694` 逐 hunk 亲读 + 现文回读；6 组命令后台 Job 亲跑（§2）；owner 命名场景 13 用例按名逐一验证（§3）
- 边界：零生产代码改动、零测试改动、零 git 写操作（不 commit/push/stage）；唯一写入 = 本文件
- 环境：Node v24.13.0、pnpm 10.28.2、vitest 3.2.7、`NODE_OPTIONS=--conditions=nomicore-source`

## Verdict

**approve**（`requiresConflictRecheck: false`）

- Owner 两条必修经**代码静态亲证 + 真实测试动态验证**双面兑现（§1）；T-C3/T-C4 共享推进钟
  （同一对象引用）+ 断言字节级零改动（§4）；零测试抑制/零削弱/零触发面改动（§5）；
  6 组命令全部 exit 0，全量 2917/2917（§2）——与 SA6 红基线（4 failed | 2913 passed）
  恰好互补闭合红→绿链。DENY 面 zero-diff 亲证（§6）。
- 非阻断观察 3 项（§7，均与 SA4/冲突门禁登记一致，无新增）。

---

## 1. Owner 必修项动态核验（代码时序亲证 × 测试真实运行）

### 1.1 必修 (1)：取得点前移 + 唯一 finally + manifest 阶段并发

| 核验点 | 本轮独立亲证（现文行号） | 动态证据（本轮实跑） |
|---|---|---|
| 取得点位置 | `readStreamStrict`（reader.ts:413）时序：①′ 传入会话防御门（:424–450，纯字段校验）→ ① 路径安全（:452–463，`isSafeNamespaceId`/`isSafeStreamId`——paths.ts:24–39 亲读纯文法，零 node:fs）→ `streamLayoutPaths`（paths.ts 纯 join）→ **④″ 会话取得（:466–514）** → **② manifest `readFileSync`（:519 = 全函数首次 manifest I/O）** → ③ 门/policy（:562–602）→ ④′ 反应（:611–622）→ ⑤ 逐段（:677 检查点）。自建臂 open 透传 `request.clock`（:485）；传入臂纯绑定（:477–478，不跑取得检查点） | **A6a**：fake 钟 call#2（取得检查点 `renewIfDue`，:502）回调内 probe `sweepRetention({now:T0})` → `leaseBlockedGroups≥1 ∧ deletedGroups===0`（lease 已注册的直接运行时证据）+ `rmSync(manifest)` → 读取 `corrupt + [manifest-invalid] ∧ manifest===null`（钩子位于 ② 之前的判别性证据）——**实跑通过** |
| 注册先于检查点（call 序） | open 内部（read-session.ts 现文亲读，DENY 零改动）：校验（:191–204）→ 枚举（:209–214）→ `openAt = clock.now()`（:215，**注册前**）→ 注册（:229–247）——同一同步函数无 yield；`renewIfDue`（:154–160）**无条件先读钟**（:157）后做 margin 判定——call#2 = 注册后、② 前唯一天然钟读位，与 rev2 §3.1.2 时序表一致 | A6a 钩子挂 call#2 即命中该窗口（若误挂 call#1 注册前 → probe 不阻 → 红；若误挂 call#3+ → rm 无法影响 ② → 红）——两向判别性由测试构造钉死 |
| **单一 finally 释放** | `ownedSession` 全文件仅三处：声明（:419）、赋值（:487）、**`finally { ownedSession?.close() }`（:899）**——grep 亲证函数体内零 `close()` 直呼站点（原 ④′ enumerationFailed/⑦/⑧ 三处分散站点已在 diff 删除）；close 幂等（read-session.ts:162–166）；传入臂不 close（生命周期归调用方——diagnostic-replay.ts :129 session 先于 :139 `readStreamStrict`，finally :304–306 唯一责任方，DENY 零改动亲证） | **A7 ×5**（manifest 缺失 / JSON 损坏 / gate corrupt 臂（version 篡改）/ gate incompatible 臂（指纹篡改）/ enumerationFailed）：每次读取早退返回后立即 sweep → `deletedGroups===2 ∧ leaseBlockedGroups===0`（enum 形态 0/0）——注册表零残留 = finally 已释放的结构 pin；对「漏 finally 的新实现」必红——**实跑 5/5 通过** |
| manifest/gate 阶段并发覆盖 | A6b 只 probe 不删 manifest | **A6b**：读取 `ok` 全量 `[1,2,3]` + probe `deletedGroups===0`——manifest 阶段与 sweep 尝试并存零丢失——**实跑通过** |

### 1.2 必修 (2)：S0′ 提交时刻取时 + sweep 后 rename 前到期放行

| 核验点 | 本轮独立亲证（现文行号） | 动态证据（本轮实跑） |
|---|---|---|
| S0′ 取时来源 | `deleteGroupIfUnleased`（file.ts:1100–1108）签名已弃 `now` 形参；`segmentLeased(..., clock.now())`——适配器闭包钟（`const clock = config.clock ?? { now: () => Date.now() }`，:313 亲证）；紧邻 `deleteGroup`（:1071 起，首步 = S1 `renameSync(jsonl→.deleting)` :1082）——**提交门取时即刻先于 S1 rename** | **B4b control**：sweep 开始（入参 now=T0）后、S0′ 钟回调内注册 probe（ttl 5，T_REG=T0+10 → until T0+15），返回提交时刻 T0+12 ∈ [T_REG, T_REG+5) → 仍活跃 → `deletedGroups===0 ∧ leaseBlockedGroups≥1 ∧ jsonl/bin 在`——提交门读的是提交时刻（非 sweep 起始）的反向钉死——**实跑通过** |
| 不复用 sweep 起始 now | P1 初查（:1266）/P2 初查（:1333）/年龄门（`now - maxAgeMs`，:1270）/字节统计仍用 sweep 入参 now（策略面）；`sweepNow(options?.now ?? clock.now())`（:1537）与构造期 `sweepNow(clock.now())`（:1525，T-A7）原样；**`Math.max` 在 file.ts 零命中（grep 亲证）**——无折衷修法、无回退取时 | **B4a 主臂**：同构造但返回 T2=T_REG+5 → `T0+15 > T0+15` 不成立（`segmentLeased` 严格 `>`，read-session.ts 惰性过期亲证）→ 判过期 → 放行：`deletedGroups===1 ∧ leaseBlockedGroups===0 ∧ jsonl/bin 消失 ∧ probe.closed===false`（放行源于**到期**而非关闭——INV-4 字面证据；租约注册于 sweep 开始后、S1 rename 前——owner 点名场景逐字兑现）——**实跑通过** |
| G-227-5（P0 门采含） | P0 orphan-BIN unlink 门（:1181）同改 `clock.now()`；`hygieneStream` 弃 `now` 参（:1132–1136，调用点 :1248）——SA2 §5.3 裁定采含 | **B5 ×2**：P0 门位主臂（提交时刻已到期 → `orphanBinsDeleted===1 ∧ leaseBlockedGroups===0`）/control（仍活跃 → `leaseBlockedGroups≥1 ∧ orphanBinsDeleted===0 ∧ BIN 在`）——**实跑双向通过** |
| 注入面 | 既有 `config.clock`（owner「注入 clock」承载，零新公共 API）+ reader 侧 `StrictReadRequest.clock?`（G-227-6 平铺加性，:47–52——先例 read-session.ts:34 / diagnostic-replay.ts:63 同构） | B4/B5/A6 全部经该注入面确定性驱动 |

## 2. 本轮亲跑验证命令与结果（全部后台 Job 独立进程，2026-09-06 23:19–23:27 UTC）

| # | 命令（可逐字复现） | 结果 | 退出码 |
|---|---|---|---|
| CMD1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-diagnostic-log/test/strict-reader-lease.test.ts packages/namespace-diagnostic-log/test/file-adapter-retention-lease-gate.test.ts packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts` | **Test Files 3 passed (3) / Tests 35 passed (35) / Type Errors no errors**（3.84s；18+9+8 计数与 SA6 §1 清单一致） | **0** |
| CMD2 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-diagnostic-log apps/yjs-server/test/diagnostic-replay` | **Test Files 33 passed (33) / Tests 505 passed (505) / Type Errors no errors**（56.34s；含 replay sa7 pin 6/6、host-lifecycle-red 22/22、lease-completeness-red 18/18） | **0** |
| CMD3 | `pnpm typecheck`（14 tsconfig 链） | 全过（含 namespace-diagnostic-log 与 apps/yjs-server） | **0** |
| CMD4 | `pnpm test`（全量根套件 = 完成定义） | **Test Files 264 passed (264) / Tests 2917 passed (2917) / Type Errors no errors**（380.97s） | **0** |
| CMD5 | CMD1 + `--reporter=verbose`（按名核验 owner 命名场景） | **13 用例按名逐一通过**：A6a/A6b、A7 ×5、T-C3/T-C4、B4a/B4b、B5 ×2（§3 全列） | **0** |
| CMD6 | `git diff 31ff694 --check`；`gh api` 重取 Issue #227 comments / PR #251 comments+reviews | diff --check 干净；owner 评论原文逐字一致、无新增 | **0** |

红→绿链闭合：全量 2917 通过 vs SA6 红基线（`31ff694` 上）`4 failed | 2913 passed`（A6a/A6b/B4b/B5-control 四红）——2913+4=2917 恰互补，零回退零意外红。

## 3. Owner 命名场景按名验证（CMD5 verbose 实录，13/13 ✓）

- ✓ A6a call#2（取得检查点）内 probe sweep 被已注册租约阻塞 + rm manifest ⇒ corrupt + manifest-invalid（钩子位于 ② 之前）
- ✓ A6b call#2 内 probe sweep 阻塞零删、不删 manifest ⇒ 读取 ok 全量（manifest 阶段与 sweep 尝试并存零丢失）
- ✓ A7 ×5：manifest 缺失 / JSON 损坏 / gate corrupt（version 篡改）/ gate incompatible（指纹篡改）/ enumerationFailed 早退 ⇒ 读后 sweep 零租约阻塞（注册表零残留 = finally 已释放）
- ✓ T-C3 TTL 过期放行（时钟越过 leasedUntil ⇒ sweep 照删）；✓ T-C4 过期后 renew 重租（renew()===true、快照不变、closed false）
- ✓ B4a sweep 开始后注册、提交时刻已到期的租约 ⇒ 放行删除；✓ B4b 提交时刻仍活跃的租约 ⇒ 阻塞删除
- ✓ B5 主臂 P0 门位「届时已到期」租约 ⇒ orphan BIN 照常清理；✓ B5 control 提交时刻仍活跃 ⇒ unlink 阻塞

## 4. T-C3/T-C4 共享推进钟 + 伪绿路径攻击矩阵（本轮专项）

| # | 攻击面 | 本轮独立亲证 | 裁决 |
|---|---|---|---|
| P-1 断言削弱 | `git diff 31ff694 -- …/file-adapter-read-session.test.ts` 中 expect/toBe/toEqual/toBeGreaterThan 断言行 **grep 零命中**（diff 仅夹具行）；现文亲证：T-C3 钉 `leasedUntil===T0+1000`/`deletedGroups===2`/`leaseBlockedGroups===0`，T-C4 钉 `deletedGroups===2 ∧ renew()===true ∧ leasedUntil===T0+3000 ∧ closed===false ∧ segments 快照不变`；ttlMs 仍 1000；`sweepRetention({now: clock.t})` 原样 | ✅ 排除 |
| P-2 TTL 延长 | 自钉值 `===T0+1000`/`===T0+3000` 反向锁死 ttl（openAt=T0 单源） | ✅ 排除 |
| P-3 now 篡改 | 入参仍 `clock.t`（共享钟推进值 T0+1001/T0+2000），未换 T0 或他源 | ✅ 排除 |
| P-4 锁步双钟 | **同一 `newClock(T0)` 对象引用两处直传**：`buildThreeGroups(root, ns, clock)`（makeWriter `...extra` 展开在缺省恒定钟之后——覆盖次序亲证）与 `openDiagnosticReadSession({..., clock})`——非两个独立钟手动同步（K-R2-3 兑现）；缺省分支省键（`...(clock !== undefined ? { clock } : {})`）→ 其余调用方（T-C1/C2/C5..C8/T-B6）零漂移 | ✅ 排除 |
| 共享钟双向绿 | 新实现 S0′ 读同一共享钟（t=T0+1001/T0+2000 > until=T0+1000）→ 判过期 → 放行 → `deletedGroups===2`；T-C4 `renew()` 读共享钟 → `max(T0+2000,T0+1000)+1000=T0+3000`——CMD1/CMD5 实跑 9/9（含两用例）互证 | ✅ 亲证 |
| 错误修法 | `Math.max` file.ts 零命中；无回退取时；S0′ 直读 `clock.now()` | ✅ 排除 |

## 5. 测试抑制/削弱/触发面（零命中亲证）

- **抑制标记**：三测试文件 grep `.skip|.only|.todo|xit|xdescribe|passWithNoTests` → **零命中**。
- **`passWithNoTests: true`**（vitest.config.ts:16）为**既有仓库级配置**（`git diff 31ff694 -- vitest.config.ts` 零改动亲证），非本 change 引入；全量实跑 264 文件全部真实收集执行（2917 tests），无空转面。
- **触发面零改动**：`vitest.config.ts` / 根 `package.json` scripts / `.github/**` / `pnpm-lock.yaml` 对 `31ff694` **zero-diff**；`test.include = packages/*/test/**/*.test.ts` 覆盖三个改动测试文件（全部在 CMD4 全量触发面内实跑通过）；`typecheck` 14 tsconfig 链含本包与 yjs-server。
- **零源码文本断言**：A6/A7/B4/B5/T-C3/T-C4 全部断言运行时产物（读状态/issue 码/sweep 报告计数/盘面文件/会话状态机）。
- A7 manifest 缺失/JSON 损坏两形态在验证 sweep 前恢复盘面 manifest = 披露的夹具必需（`scanSweepStreams` 对不可定序流保守跳过——恢复仅为使 sweep 可枚举该流，把「注册表零残留」变成可观测断言），断言强度零放宽（仍钉满额删除 + 零阻塞）。

## 6. 改动面/DENY 复核

- `git diff 31ff694 --stat`：恰 8 路径（src/reader.ts 160 行、src/adapters/file.ts 34 行、包 AGENTS.md +16、包 package.json 0.1.6→0.1.7、三测试文件 +205/+213/+25、`wiki/raw/task_issue-227_sa4_review.md` 前轮 SA4 产物）——与 rev2 §0.2 ALLOW 逐项吻合（package.json bump 一项越白名单字面，SA3 声明 + SA4 §5/冲突门禁 §7-O1 已裁接受，本轮维持：纯加性、workspace:* 依赖、零行为面）。
- **DENY zero-diff 亲证**：`apps/**`（含 diagnostic-replay.ts / sa7 pin）、`src/read-session.ts`、`src/retention.ts`、`src/index.ts`、`src/schema.ts`、`docs/**`、`CONTEXT.md`、`.github/**`、`vitest.config.ts`、`pnpm-lock.yaml` → diff 空；`deleteGroup`（S1–S3）本体零 hunk。
- `git diff 31ff694 --check` → 干净。

## 7. 非阻断观察（与 SA4/冲突门禁登记一致，无新增）

| # | 项 | 定性 |
|---|---|---|
| O1 | `task_issue-227_dispatch.md` 稀疏（rev2 各轮未补记） | 总控簿记债（设计 N-c/SA2 N-3 已归属）；不影响证据链 |
| O2 | `apps/yjs-server` 维持 0.1.3（rev2 对其零改动故不扩 bump 面） | 维持 SA4-R2 §R2.4 非阻断裁定，归 release 流程裁量 |
| O3 | manifest 缺失流上自建臂多付一次 segments/ readdir | 设计 R2-R2 备案；包络不变 |

## 8. 结论

- **必修 (1)**：取得点（① 后 ② 前）+ 单一 finally（三处分散站点删除、:899 唯一释放）+ manifest 阶段并发契约（A6a/A6b/A7×5 实跑）——代码与测试双面兑现，owner 建议修复三子项逐条落地。
- **必修 (2)**：S0′ 提交时刻 `clock.now()`（不复用 sweep 起始 now、无 Math.max 折衷）+ 注入面（config.clock / StrictReadRequest.clock?）+ 到期放行测试（B4a 主臂 + B4b control + B5 ×2 实跑）——兑现；策略面（初查/年龄/字节）维持 sweep 入参 now 的语义分工经代码亲证。
- T-C3/T-C4 共享推进钟（same-object）+ 断言字节级零改动；零抑制/零削弱/零触发面改动；全量 2917/2917 + typecheck exit 0。

**Verdict: approve（requiresConflictRecheck: false）**

---

## 9. 追加轮 R2.2（final-verification iteration 2，2026-09-06 23:30–23:37 UTC+8）——硬门禁全量终态复核

背景：iteration 1 approve 后，Controller 硬门禁最终命令 `pnpm typecheck && pnpm test`（其后台 Job bash-27）尚在 running，不得 finalization；Host 派发本追加轮（sa-a94f75d5，child bc0b1b91）在 Controller 全量作业可得终态后重验。上一会话 Job 在本会话不可读（不得视为通过），故本追加轮**独立重跑同一硬门禁命令**。

| # | 复核项 | 本轮亲证（2026-09-06 23:30–23:37） |
|---|---|---|
| H-1 | 全量硬门禁（后台 Job bash-28，独立进程，终态 completed / exit 0） | `pnpm typecheck`（14 tsconfig 链）exit 0 + `pnpm test`：**Test Files 264 passed (264) / Tests 2917 passed (2917) / Type Errors no errors**（Duration 400.87s）——与 §2 CMD3/CMD4 完全一致，且与 SA6 红基线（4 failed \| 2913 passed）互补闭合（2913+4=2917）。仅承接既有 stderr 警告（vitest typecheck experimental / 第三参数 deprecation），零失败零跳过 |
| H-2 | Owner 评论面（gh api 独立重取 ×2） | Issue #227 评论仍恰 1 条（id 5559458232，welltop-jim-wang，2026-09-06T13:14:31Z，两条必修项原文不变）；PR #251 comments=0 / reviews=0——**无新增 Owner 要求** |
| H-3 | 工作树稳定性（测试运行前后双查） | HEAD `31ff694` 不变；`git status` 恒 17 项（8 修改 + 9 未跟踪，含 R2 预检 SA8 产物 impl_conflict_recheck）；`git diff 31ff694 --check` 干净——全量运行期间零改动，§6 改动面结论维持 |
| H-4 | 边界 | 零生产代码/测试改动、零 git 写操作；唯一写入 = 本文件本节 |

**追加轮结论：approve 维持（requiresConflictRecheck: false）**——Owner 两条必修项的证据链（§1）在终态全量绿（H-1）下复核成立，Controller 可凭本报告与作业事实进行本地完成事务。

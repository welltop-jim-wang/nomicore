# SA4 独立实现复审（rev2 / R2.1）— Issue #227：租约取得点前移、统一 finally 与提交时刻取时

- 角色/阶段：implementation-review（rev2 轮：SA1 R2.1 设计 → SA2 approve → SA6 红灯 → SA3 实现 → **本复审**）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，基线 HEAD **`31ff694`** + 本轮工作树未提交改动；`git rev-parse HEAD` 亲证）
- 被审对象：SA3 实现报告 `wiki/raw/task_issue-227_rev2_sa3_impl.md` 所列全部改动（src 2 + 包 AGENTS.md + package.json + 测试 3——测试为 SA6 产物，本轮一并复审其契约有效性）
- 输入：任务简报 `task_issue-227.md`（AC1–AC5）；rev2 设计 `task_issue-227_rev2_design.md`（R2.1，D8–D11 + INV-227-1 改写/3 修订/11/12）；SA2 窄域复审 `task_issue-227_rev2_sa2_review.md`（approve + K-R2-1..K-R2-4、G-227-5 采含、G-227-6 平铺）；SA6 红灯契约 `task_issue-227_rev2_sa6_red.md`（红基线 4 failed | 2913 passed）；owner PR #251 两条必修（经设计/SA2/SA6 转录）
- 方式：**全部独立重验**——`git diff 31ff694` 逐 hunk 亲读（reader.ts / file.ts / 三测试文件 / AGENTS.md / package.json）；read-session.ts（DENY 面）全文亲读（open 时序 :205–229 / renewIfDue :154–160 / 惰性过期 :252–256）；file.ts sweep 全路径亲读（P0 :1181 / P1 初查 :1266 + S0′ :1275 / P2 初查 :1333 + S0′ :1343 / sweepNow :1523–1537）；paths.ts 亲读（① 零 fs 亲证）；vitest.config.ts / 根 package.json scripts 亲读；定向与包级测试**本机独立后台重跑**（§6）
- 边界：**零生产代码改动、零测试改动、零 git 写操作**（不 commit/push/stash）；唯一写入 = 本文件

## Verdict

**approve** —— Owner 两条必修逐项在代码与测试双面落地并经本轮独立运验证实；改动面与 rev2 设计 §0.2 ALLOW 逐项吻合、DENY 面 zero-diff 亲证；T-C3/T-C4 夹具对齐 = 同一共享推进钟对象引用 + 断言字节级零改动（diff 断言行 grep 零命中）；未发现任何断言削弱 / TTL 延长 / now 篡改 / gate 绕过 / 禁用修法。**放行后续门禁（冲突复查豁免依据见 §8）。**

无阻断项。3 条非阻断登记（§9）。

---

## 1. Owner 必修 (1) 逐项核验：取得点前移 + 唯一 finally + manifest 阶段并发契约

### 1.1 取得点位置（D8/D10）——代码亲证

- `readStreamStrict`（reader.ts:413）时序亲读：①′ 传入会话防御门（:424–450，纯身份/已闭校验）→ ① 路径安全（:452–463，`isSafeNamespaceId`/`isSafeStreamId`——paths.ts:24–39 亲读为纯文法，零 fs）→ `streamLayoutPaths`（paths.ts:49–64，纯 `join` 派生）→ **④″ 会话取得（:466–514）** → ② manifest `readFileSync`（:519，全函数首次 manifest I/O）→ ③ 门/policy（:562–602）→ ④′ 反应半段（:611–622）→ ⑤ 逐段循环。
- 自建臂（request.session 缺席）：`openDiagnosticReadSession({rootDir, namespaceId, streamId, clock: request.clock})`（:481–486）——open 内部「枚举（read-session.ts:210）→ `openAt = clock.now()`（:215，注册前）→ 注册（:229–247）」同一同步函数无 yield（原子）；取得检查点 `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)`（reader.ts:502）= 注册后、② 前唯一天然钟读位（read-session.ts:157 无条件先读钟）——拒续 → `corrupt + lease-expired`、`manifest:null`、零进一步 IO（诚实失败臂前移到任何 fs IO 之前，与设计 §3.1.1 逐字一致）。
- `request.clock` 全函数唯一消费点 = :485（自建臂 open 透传）——传入臂纯绑定（:477–478，不跑取得检查点，A2 传入臂钟序列零漂移成立）。
- **生产零行为漂移论证复核**：缺省 ttl=15_000 / margin=1_000（read-session.ts:19/:22 单源亲证）下检查点为 `now+1000 < leasedUntil` 快路径真值（open 刚返回，无副作用）；真实钟下纯通过。

### 1.2 唯一 finally（D9，INV-227-11）——代码亲证

- `ownedSession` 全文件仅三处：声明（:419）、赋值（:487）、**唯一 `finally { ownedSession?.close() }`（:899）**——grep 亲证函数体内零 `close()` 直呼站点（原 ④′ enumerationFailed :591-592 / ⑦ :838-841 / ⑧ :868-871 三处分散站点已在 diff 中删除）。
- 覆盖清单亲证（全部位于 try 体内、经 finally 释放）：② manifest 缺失（:520–531）/ JSON 损坏（:535–546）/ 非对象（:547–558）；③ schema-compile 失败（:563–574）/ **gate 失败 corrupt+incompatible 双臂**（:576–588）/ policy 失败（:591–602）；④′ enumerationFailed 反应（:611–622）；④″ open 防御 catch（:488–501，此时 ownedSession 尚 null——finally 幂等空操作）与取得检查点拒续（:502–513，ownedSession 已赋值——finally 真释放）；⑤ 各 break；⑦ 两处正常返回；⑧ 异常逃逸（catch :883 后 finally 恒达——同步函数）。
- 传入臂不 close（生命周期归调用方——replay 的 finally 维持唯一责任方；diagnostic-replay.ts 本轮 zero-diff 亲证）。
- **包络等价复核**：②③ 早退在旧实现先于 session open、新实现后于 open+finally——返回包络逐字节等同（corrupt+manifest-invalid、manifest:null）；④″ 两失败臂 manifest:null 正确（manifest 尚未读取）；④′ 反应臂 manifest 已读、包络与旧自建/传入臂逐字节一致（含 manifest 字段）。代价 = manifest 缺失流多一次 segments/ readdir（设计 R2-R2 备案，可忽略）。

### 1.3 manifest 阶段与 retention sweep 并发契约——测试有效性核验

- **A6a**（strict-reader-lease.test.ts:425–451）：fake 钟 call#2（= 取得检查点位）回调内先 probe `sweepRetention({now:T0})` 后 `rmSync(manifest)`。注册时序亲证：open（call#1=openAt）已注册 → call#2 时 reader 会话 until T0+15_000 > T0 → probe P1 初查（file.ts:1266，策略面用入参 now）即阻 → `leaseBlockedGroups≥1 ∧ deletedGroups===0` = 「manifest read/gate 期间 lease 已注册」的直接运行时证据；rm 后读取 `corrupt+[manifest-invalid] ∧ manifest===null` = 钩子位于 ② 之前的判别性证据（若误挂 call#1 注册前 → probe 不阻 → 红；若挂 call#3+ → manifest 已读、rm 无从影响 → 红）。probe sweep 内部零 `clock.now()` 调用亲证（fixture 无 orphan → P0 门不触；P1 初查即阻 → S0′ 不可达）——无重入、确定性成立。
- **A6b**（:453–467）：只 probe 不删 → 读取 `ok` 全量 `[1,2,3]` + probe 零删——并存臂。
- **A7 ×5**（:478–568）：manifest 缺失 / JSON 损坏 / gate corrupt 臂（version 篡改）/ gate incompatible 臂（指纹篡改）/ enumerationFailed 五形态，读后立即 sweep 断言 `deletedGroups===2 ∧ leaseBlockedGroups===0`（enum 形态 0/0——segments/ 已删，sweep failedSteps 止步）——**注册表零残留 = finally 已释放**的可观测结构 pin；对「漏 finally 的新实现」必红（②③ 早退泄漏 → leaseBlockedGroups≥1）。manifest 缺失/损坏两形态在验证 sweep 前恢复盘面 manifest 是披露的夹具必需（`scanSweepStreams` 对不可定序流保守跳过——恢复只为让 sweep 可枚举该流），**断言强度零放宽**（仍钉满额删除 + 零阻塞）。
- 红差分机制在 `31ff694` 上的成立性静态复核：旧自建臂 open（旧 :571–575）无 clock 供参 → fake 钟零调用 → 钩子不触发 → `report` 恒 null → `expect(report).not.toBeNull()` 必红——与 SA6 §3.1 实测（4 failed | 31 passed，总 35）计数吻合（本轮绿 18+9+8=35，基线红 4 = A6a/A6b/B4b/B5-control）。

## 2. Owner 必修 (2) 逐项核验：S0′ 提交时刻取时

- **`deleteGroupIfUnleased`**（file.ts:1100–1108）：签名已弃 `now` 形参；`segmentLeased(rootDir, namespaceId, streamId, segment, clock.now())` —— S1 rename 前即刻读适配器闭包钟现值（`clock = config.clock ?? {now: () => Date.now()}`，:313 亲证；owner「如需确定性注入 clock」由既有 `config.clock` 承载，零新公共 API）。
- **调用点**：P1（:1275–1281）/ P2（:1343–1349）均已弃 `now` 实参；**P0 orphan-BIN unlink 门**（:1181）同改 `clock.now()`（G-227-5 采含——SA2 §5.3 裁定）；`hygieneStream` 弃 `now` 参（:1132–1136，调用点 :1248）。
- **策略面维持 sweep 入参 now**（INV-227-12 语义分工亲证）：P1 初查 :1266 / P2 初查 :1333 / 年龄门 `groupAgeExpired(..., now - maxAgeMs)` :1270 / 字节统计；构造期自动 sweep `sweepNow(clock.now())`（:1525，T-A7）与 `sweepRetention(options?.now ?? clock.now())`（:1537）原样；`sweepRetention` JSDoc 收窄为「策略时刻」（:122–131）。
- **禁用修法排除**：`Math.max` 在 file.ts 零命中（grep 亲证）——无 `Math.max(now, clock.now())` 折衷；无回退取时；`deleteGroup`（S1–S3）本体 zero hunk（diff 亲证）。
- **测试有效性**：
  - **B4a 主臂**：armed 后首个 `clock.now()` = P1 S0′ 提交位（fixture 无 orphan → P0 不触门；初查/年龄/字节全消费入参 now 零钟读——file.ts 亲证）回调内注册 probe（ttl 5、独立静态钟 T_REG=T0+10 → until T0+15）后返回 T0+15 → `T0+15 > T0+15` 不成立 → 判过期 → 放行 `deletedGroups===1 ∧ leaseBlockedGroups===0` ∧ jsonl/bin 消失 ∧ `probe.closed===false`（放行源于**到期**而非关闭——INV-4 字面证据）。租约注册于 sweep 开始（now=T0）之后、S1 rename 之前——owner 点名场景逐字兑现。
  - **B4b control**：返回 T0+12 ∈ [T_REG, T_REG+5) → 提交时刻仍活跃 → `deletedGroups===0 ∧ leaseBlockedGroups≥1` ∧ 文件在——反向钉死「提交门读的是提交时刻」。两臂合并在 `31ff694` 上构成红差分（旧 S0′ 用入参 now=T0、且无钟读 → 钩子不触发 → 无租约 → B4b 期望 0 实得 1 → 红）。
  - **B5 ×2**：P0 门位（P0 先于 P1——sweep 结构亲证 :1248 先于 :1252+）同机制主臂/control——`orphanBinsDeleted===1/0` 与 `leaseBlockedGroups` 双向钉死 G-227-5 采含后的 P0 提交时刻语义。

## 3. T-C3/T-C4 共享推进钟 + 伪绿路径攻击矩阵（本轮专项）

| # | 攻击面 | 核验结论 |
|---|---|---|
| P-1 断言削弱 | `git diff 31ff694 -- test/file-adapter-read-session.test.ts` 中 **expect 断言行零命中**（grep `-E "^[-+].*expect|toBe..."` 于 diff → 空）——T-C3 仍钉 `deletedGroups===2 ∧ leaseBlockedGroups===0`（:162–163）、`leasedUntil===T0+1000`（:159）；T-C4 仍钉 `deletedGroups===2 ∧ renew()===true ∧ leasedUntil===T0+3000 ∧ closed===false ∧ segments 快照不变`（:181–186）——字节级不动（K-R2-3 兑现） | ✅ 排除 |
| P-2 TTL 延长 | ttlMs 仍 1000（:156/:176）——`leasedUntil===T0+1000/===T0+3000` 自钉值反向锁死夹具 TTL | ✅ 排除 |
| P-3 now 篡改 | `sweepRetention({ now: clock.t })`（:161/:180）——仍用共享钟推进值，未换 T0 或他源 | ✅ 排除 |
| P-4 锁步双钟 | `const clock = newClock(T0)` **同一对象引用**两处直传：`buildThreeGroups(root, ns, clock)`（经 makeWriter config，:87–91 缺省分支保持恒定钟、其余调用方零变化）与 `openDiagnosticReadSession({..., clock})`（:157/:177）——非两个独立钟手动同步 | ✅ 排除 |
| P-5 gate 绕过 | A6/B4/B5 全部经真实 sweep/删除路径断言运行时产物（报告计数/盘面文件/会话状态），零源码文本断言、零 `.skip/.only/.todo/xit`（三文件 grep 零命中） | ✅ 排除 |
| 新旧双向绿复核 | 旧实现：初查/S0′ 同用入参 now=T0+1001/T0+2000 → 过期放行 → `deletedGroups===2`；新实现：S0′ 读同一共享钟（t 未再动）→ 同值过期放行 → 同断言；T-C4 `renew()` 读共享钟 T0+2000 → `max(T0+2000, T0+1000)+1000 = T0+3000` → 断言逐项成立。构造期 `clock.t` 恒 T0（`sweepOnOpen:false` + 推进在构造后）→ 零漂移 | ✅ 亲证 |

## 4. ADR 冻结面 / DENY zero-diff（亲证）

- `git diff 31ff694 --name-status`：全部改动 = `src/reader.ts`、`src/adapters/file.ts`、包 `AGENTS.md`、包 `package.json`、三测试文件、`wiki/raw/task_issue-227_sa4_review.md`（前轮 SA4 R2 复审产物，非本轮代码面）+ 未跟踪 rev2 wiki 证据 6 件——**与 rev2 设计 §0.2 ALLOW 白名单逐项吻合**。
- **DENY zero-diff**：`docs/**`、`CONTEXT.md`、`apps/**`（含 diagnostic-replay.ts / index.ts / sa7 pin）、`src/read-session.ts`、`src/retention.ts`、`src/index.ts`、`src/schema.ts`（冻结指纹）、`src/adapters/memory.ts` —— diff 空（亲证）。词表零增量（无新 issue 码/reason/事件成员——A6/A7 复用 `manifest-invalid`/`lease-expired`，B4/B5 复用既有报告计数）。
- ADR-0014-LOG L289「只删除已关闭且没有 reader lease 的 segment group」：提交门以提交时刻评估「没有 lease」——INV-4 在提交点字面复位（兑现型读法，零 amendment，docs zero-diff 佐证）；L297 持约范围覆盖 manifest 阶段（AC1 完整兑现）；L301–318 报告形状冻结（②③ 门语义/早退包络逐字节不动）。ADR-0011 无涉（本轮不触分类/complete 面）。

## 5. 包版本 bump 与触发范围

- **bump**：`@nomicore/namespace-diagnostic-log` 0.1.6 → **0.1.7**（package.json diff 亲证）——rev2 唯一被改包，patch 级正确；依赖方均为 `workspace:*`（apps/yjs-server package.json 亲证）→ pnpm-lock.yaml 无版本解析需变更（lockfile 零版本串亲证，无 stale）。`apps/yjs-server` 维持 0.1.3——rev2 对其零改动（DENY），符合「只 bump 被改包」；R1 遗留 V-1（yjs-server 0.1.3→0.1.4 建议项）维持 SA4-R2 §R2.4 裁定非阻断、归总控/release 裁量（见 §9-O2）。
- **触发范围**：vitest.config.ts `test.include` = `packages/*/test/**/*.test.ts` + domains + apps（maxWorkers:1、typecheck enabled）——三个改动测试文件全部在全量 `pnpm test` 触发面内；`pnpm typecheck` 14 tsconfig 顺序覆盖本包与 yjs-server。零 CI 工作流改动（`.github` zero-diff）。新用例计数：strict-reader-lease +7（A6a/A6b/A7×5）、retention-lease-gate +4（B4a/B4b/B5×2）、read-session 0 净增（仅夹具对齐）——与 SA6 §1 清单一致。

## 6. 本轮独立运验证（后台 Job，2026-09-06）

| 命令 | 结果 |
|---|---|
| 定向三契约文件（SA6 §2 命令 1） | `3 passed (3) / Tests 35 passed (35) / Type Errors no errors / exit 0`（含 A6a/A6b/A7×5/B4a/B4b/B5×2/T-C1..C8/T-B6 全绿） |
| `pnpm typecheck`（14 tsconfig） | exit 0 |
| `pnpm exec vitest run packages/namespace-diagnostic-log apps/yjs-server/test/diagnostic-replay` | `33 files / 505 tests passed / no type errors / exit 0`（53.5s）——与 SA6 红基线「505 中 4 红」互补吻合（501+4=505），零回退 |

与 SA3 报告 §4、总控独立三定向 run（exit 0）互证一致。

## 7. INV 清单静态核验

- **INV-227-1（改写版）** ✅：一切磁盘触达（②③⑤）均在未闭会话保护下；自建会话 ① 后 ② 前取得。
- **INV-227-2** ✅：segments 恒等于 `session.segments`（reader :623，`enumerateSegmentGroups` 在 readStreamStrict 函数体零直呼）。
- **INV-227-3（修订版）** ✅：P1/P2 每次 S1 rename 前 `segmentLeased` 复查且时刻 = `clock.now()` 现值；`'lease-blocked'` 恒前缀止步（:1287/:1357 break）。
- **INV-227-11** ✅：close 只存在于唯一 finally（§1.2）。
- **INV-227-12** ✅：一切删除提交门（S0′×2 + P0）以门点 `clock.now()` 评估；sweep 起始 now 仅候选/年龄/字节（§2）；等价刻画与 `segmentLeased` 严格 `>` 语义一致（`leasedUntil ≤ now` ⇒ 不阻塞——B4a 的 T2=T_REG+5 边界值亲证）。
- INV-227-4..10（R1 面）：本轮零触碰（分类/complete/vanished/词表不动），R1 SA4-R2 已审态维持。

## 8. 冲突复查豁免依据

本轮改动不新增任何 ADR 面、语义面、码面、事件成员或公共 API 形状（`StrictReadRequest.clock?` 为 SA2 §5.3 G-227-6 已裁定的加性可选字段）；改动面严格落在已批准 ALLOW 内、DENY zero-diff。**requiresConflictRecheck: false**（与 SA8 R2 对 R2.1 的豁免裁定同口径）。

## 9. 非阻断登记（移交总控）

| # | 项 | 定性 |
|---|---|---|
| O1 | `task_issue-227_dispatch.md` 稀疏（仅 R1 第 1 行；rev2 各轮未补记） | 总控簿记债（设计 N-c/SA2 N-3 已归属）；不影响实现正确性；建议 finalize 前补记 |
| O2 | `apps/yjs-server` 维持 0.1.3（R1 `31ff694` 改其 src 未 bump 的 V-1 遗留） | 维持 SA4-R2 §R2.4 非阻断裁定（repo CI 立法：版本提升属 release 流程，非 PR 门禁）；rev2 未改该包故不扩 bump 面；移交总控/release 裁量 |
| O3 | manifest 缺失流上自建臂多付一次 segments/ readdir（取得点前移的固有代价） | 设计 R2-R2 已备案；包络不变 |

## 10. 边界声明

- 本轮零生产代码/测试改动、零 git 写操作；唯一写入 = 本文件。
- 未运行 CI/发布链路；未读外网。测试均以本地后台 Job 独立进程执行并收集退出码（§6）。

**Verdict: approve（requiresConflictRecheck: false）**

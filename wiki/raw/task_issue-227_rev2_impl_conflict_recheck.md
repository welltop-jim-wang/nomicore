# 实施轮 ADR 冲突门禁（conflict recheck）— Issue #227 rev2（R2/R2.1 工作树变更集）

- 被审对象：工作树对基线 **`31ff694`** 的全部未提交改动（`git diff 31ff694`：src 2 文件 +
  包 AGENTS.md + package.json + 测试 3 文件 + `wiki/raw/task_issue-227_sa4_review.md`——即
  SA6 rev2 红灯契约 `task_issue-227_rev2_sa6_red.md` 与 SA3 rev2 实现
  `task_issue-227_rev2_sa3_impl.md` 所列改动的现工作树形态）
- 轮次定位：rev2 实施轮冲突门禁重开（rev2 §12 路由第 6 步；沿 R1
  `task_issue-227_impl_conflict_recheck.md` 先例）；历史材料（SA8 R2 设计门禁 reject（窄修型）
  → R2.1 → SA2 approve）仅作参照，本轮对**实施变更集**独立重验
- 冲突基准：`docs/adr/0014-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（ADR-0014-LOG，
  §Retention 与删除 L280–299 / §Strict reader 与诊断性 replay L301–318 本轮原文回读）、
  `docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`（L97–105 无涉面）、包
  `packages/namespace-diagnostic-log/AGENTS.md`（含 #227 R2 增量段）、根 `CONTEXT.md`、
  rev2 设计 `task_issue-227_rev2_design.md`（R2.1，§0.2 ALLOW / §0.3 DENY）
- 复审方式：**全部独立重验**——owner PR #251 评审评论**原文经 `gh api` 核得**（Issue #227
  唯一一条 welltop-jim-wang 评论，2026-09-06T13:14:31Z；#227/#251 无其他评论或 review）；
  reader.ts / file.ts 逐 hunk 亲读（全文 diff + 现文回读）；read-session.ts（DENY 面）现文
  亲读（open 时序 / renewIfDue 先读钟 / close 幂等 / segmentLeased 惰性过期）；paths.ts 亲读
  （① 纯文法零 fs）；三个测试文件 diff 与现断言逐行亲读；`Math.max` / 测试抑制 / DENY 面
  zero-diff grep 亲证；定向与包级套件**本机后台 Job 独立重跑**（§6）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，HEAD `31ff694`，
  `git rev-parse` 亲证；变更集为工作树未提交态）
- 边界：零生产代码改动、零测试改动、零 git 写操作（不 commit/push/stage）；唯一写入 = 本文件
- 时间：2026-09-06（implementation conflict-gate 轮，rev2）

## Verdict

**clear**（`requiresConflictRecheck: false`）

rev2 变更集对 ADR-0011 / ADR-0014-LOG 及全部模块契约**零冲突**：owner 两条必修（O-1 取得点
前移 + 唯一 finally + manifest 阶段并发契约；O-2 S0′ 提交时刻取时 + 到期放行契约）在代码与
测试双面落地并经本轮**独立运验证实**（定向 35/35、包级+replay 505/505、typecheck 14 包
exit 0）；改动面与 rev2 §0.2 ALLOW 逐项吻合（package.json bump 一项越白名单字面但已由
SA3 声明 + SA4 §5 复审接受，见 §7-O1）；DENY 面 zero-diff 亲证；词表 / 报告形状 / 事件
成员 / 分类面 / complete 门零触碰；T-C3/T-C4 夹具对齐 = 同一共享推进钟对象引用 + 断言
字节级零改动；无断言削弱、无 TTL 延长、无 now 篡改、无禁用修法（`Math.max` 零命中）、
无测试抑制。无任何条款要求二次冲突复审。

---

## 1. 变更面独立盘点（vs rev2 设计 §0.2 ALLOW / §0.3 DENY）

`git diff 31ff694 --stat` 亲证，恰 8 路径：

| 路径 | 与 ALLOW 对照 | 本轮亲读要点 |
|---|---|---|
| `src/reader.ts`（160 行） | ✅ 列名 | `StrictReadRequest.clock?`（G-227-6 平铺加性）；④″ 取得半段前移；④′ 反应半段原位；三处分散 close 删除 → 唯一 finally；**物化谓词/分类面零 hunk** |
| `src/adapters/file.ts`（34 行） | ✅ 列名 | `deleteGroupIfUnleased` 弃 now 参改 `clock.now()`；P1/P2 调用点弃实参；P0 门同改（G-227-5 采含）；`hygieneStream` 弃 now 参；sweepRetention JSDoc 收窄；`deleteGroup`（S1–S3）本体零 hunk |
| 包 `AGENTS.md`（+16 行） | ✅ 列名（文档义务 N-2） | R2 增量段三条与实现逐点相符，无虚构行为 |
| 包 `package.json`（1 行） | ⚠️ ALLOW 未逐字列名（0.1.6→0.1.7）——SA3 声明「必要 patch bump」+ SA4 §5 复审接受（rev2 §12 第 7 步 V-1 即建议 0.1.7）；纯加性、零 ADR 面，维持接受（§7-O1） | |
| `test/strict-reader-lease.test.ts`（+205 行） | ✅ 列名 | A6a/A6b/A7 ×5 + `withClock`/`manifestPathOf` 夹具（§3） |
| `test/file-adapter-retention-lease-gate.test.ts`（+213 行） | ✅ 列名 | B4a/B4b/B5 ×2 + `buildTwoGroups` 夹具（§4） |
| `test/file-adapter-read-session.test.ts`（25 行） | ✅ 列名（仅 T-C3/T-C4 夹具钟源对齐） | `buildThreeGroups` 增可选 clock 透传（缺省分支省键——其余调用方零变化）；断言行零改动（§5） |
| `wiki/raw/task_issue-227_sa4_review.md` | wiki 证据（SA4 R2 复审产物），非代码面 | |

**DENY 面 zero-diff 显式亲证**（`git diff 31ff694 --name-only -- <DENY 路径集>` → 空）：
`apps/**`（含 diagnostic-replay.ts / index.ts / sa7 pin）、`src/read-session.ts`、
`src/retention.ts`、`src/index.ts`、`src/schema.ts`、`src/adapters/memory.ts`、`docs/**`、
`CONTEXT.md`、`.github/**`、`vitest.config.ts`、`pnpm-lock.yaml`。

## 2. Owner 必修 (1) 独立核验：取得点前移 + 唯一 finally + manifest 阶段并发

**owner 原文（gh api 核得，逐字）**：「在路径安全检查后、第一次 manifest I/O 前取得 session；
使用统一 `finally` 确保自建 session 最终释放；补充测试，证明 manifest read/gate 期间 lease
已注册，并覆盖该阶段与 retention sweep 并发。」

| 核验点 | 本轮独立亲证 | 裁决 |
|---|---|---|
| 取得点位置 | 现文时序：①′ 传入防御门（:424–450，纯字段校验）→ ① 路径安全（:452–463，`isSafeNamespaceId`/`isSafeStreamId`——paths.ts:24–39 纯文法亲读，零 fs）→ `streamLayoutPaths`（paths.ts:49–64 纯 `join` 派生）→ **④″ 会话取得（:466–514）** → **② manifest `readFileSync`（:519，全函数首次 manifest I/O）** → ③ 门/policy（:562–602）→ ④′ 反应（:611–622）→ ⑤（:677 检查点原位）。自建臂 open 透传 `request.clock`（:485）；传入臂纯绑定（:477–478，不跑取得检查点——A2 零漂移） | ✅ |
| 取得先于注册后观察 | open 内部（read-session.ts 现文亲读，DENY 未动）：枚举（catch → enumerationFailed）→ `openAt = clock.now()`（注册前——leasedUntil 依赖 openAt）→ 注册条目——同一同步函数无 yield；④″ 后一切 manifest I/O 均在已注册会话保护下（「先观察后注册」窗口关闭，TOCTOU 腿 4） | ✅ |
| 取得检查点 | `renewIfDue(READ_SESSION_RENEW_MARGIN_MS)`（:502）= 注册后、② 前唯一天然钟读位（read-session.ts renewIfDue 无条件先读钟——call#1=openAt 注册前、call#2=此处、call#3+=⑤ 检查点，与 rev2 §3.1.2 时序表一致）；拒续 → `corrupt + lease-expired`、`manifest:null`、零进一步 IO；缺省 ttl 15s/margin 1s 下为快路径真值，生产行为零变化 | ✅ |
| **唯一 finally** | grep 亲证：`ownedSession` 全文件仅三处——声明（:419）、赋值（:487）、**`finally { ownedSession?.close() }`（:899）**；函数体内零 `close()` 直呼站点（原 ④′ enumerationFailed/⑦/⑧ 三处分散站点已在 diff 中删除）。早退覆盖清单逐点在 try 体内：② 缺失（:520–531）/JSON 损坏（:535–546）/非对象（:547–558）、③ schema-compile（:563–574）/**gate corrupt+incompatible 双臂**（:576–588）/policy（:591–602）、④″ open 防御 catch（:488–500）与检查点拒续（:502–513）、④′ enumerationFailed（:611–622）、⑤ break、⑦ 双返回（:859/:870）、⑧ 异常逃逸（:880–892 后 finally 恒达）。close 幂等（read-session.ts 亲证）；传入臂不 close（replay 责任方不变，apps zero-diff） | ✅ INV-227-11 |
| manifest 阶段并发契约 | A6a（strict-reader-lease.test.ts:425–451 亲读）：fake 钟 call#2 回调内 probe `sweepRetention({now:T0})` → 断言 `leaseBlockedGroups ≥ 1 ∧ deletedGroups === 0`（lease 已注册的直接运行时证据）+ `rmSync(manifest)` → 读取 `corrupt + [manifest-invalid] ∧ manifest===null ∧ records===[]`（钩子位于 ② 之前的判别性证据——误挂 call#1 则 probe 不阻、误挂 call#3+ 则 rm 无从影响 ②，两向皆红）；A6b（:453–467）只 probe 不删 → `ok` 全量 `[1,2,3]` + probe 零删（并存臂）；probe sweep 全链消费入参 now、fixture 无 orphan → P0 门不触 → 无 fake 钟重入（亲证）。A7 ×5（:478–568）manifest 缺失/JSON 损坏/gate corrupt 臂（version 篡改）/gate incompatible 臂（指纹篡改）/enumerationFailed 五形态读后 sweep 断言 `deletedGroups===2 ∧ leaseBlockedGroups===0`（enum 形态 0/0）——注册表零残留 = finally 已释放的结构 pin，对漏 finally 的新实现必红；manifest 缺失/损坏两形态恢复盘面是披露的夹具必需（scanSweepStreams 保守跳过不可定序流），断言强度零放宽 | ✅ |

## 3. Owner 必修 (2) 独立核验：S0′ 提交时刻取时 + 到期放行契约

**owner 原文（gh api 核得，逐字）**：「S0′ 复查时读取真正提交时刻的当前时间，不复用 sweep
起始时间；如需测试确定性，注入 clock；增加测试：租约在 sweep 开始后、S1 rename 前到期时，
应允许删除。」

| 核验点 | 本轮独立亲证 | 裁决 |
|---|---|---|
| S0′ 取时来源 | `deleteGroupIfUnleased`（file.ts:1100–1108）签名已弃 `now` 形参；`segmentLeased(..., clock.now())`——适配器闭包钟（`const clock = config.clock ?? { now: () => Date.now() }`，:313 亲证未动）。调用点紧邻 `deleteGroup`（其首步 = S1 `renameSync` jsonl→`.deleting`，:1071–1086 亲证）——**提交门取时即刻先于 S1 rename**。P1（:1275–1281）/P2（:1343–1349）调用点均已弃实参 | ✅ INV-227-3 修订版 |
| 不复用 sweep 起始 now | P1 初查（:1266）/P2 初查（:1333）/年龄门（`now - maxAgeMs`，:1270）/字节统计仍用 sweep 入参 now（策略面）；`sweepNow(options?.now ?? clock.now())`（:1537）与构造期 `sweepNow(clock.now())`（:1525，T-A7）原样。**`Math.max` 在 file.ts 零命中**（grep 亲证）——无 `Math.max(now, clock.now())` 折衷、无回退取时 | ✅ INV-227-12 |
| G-227-5（P0 门采含） | P0 orphan-BIN unlink 门（:1181）同改 `clock.now()`；`hygieneStream` 弃 `now` 参（:1132–1136，调用点 :1248）——SA2 §5.3 裁定采含，ADR L289 统辖全部删除面（SA8 R2 C10 两向无冲突） | ✅ |
| 到期放行契约 | B4a（file-adapter-retention-lease-gate.test.ts 亲读）：armed 后首个 `clock.now()` = P1 S0′ 提交位（fixture 无 orphan → P0 不触门；初查/年龄/字节全消费入参 now 零钟读——file.ts 亲证）回调内注册 probe（ttl 5、独立静态钟 T_REG=T0+10 → until T0+15）后返回 T0+15 → `T0+15 > T0+15` 不成立（`segmentLeased` 严格 `>` 亲证）→ 判过期 → 放行：`deletedGroups===1 ∧ leaseBlockedGroups===0` ∧ jsonl/bin 消失 ∧ `probe.closed===false`（放行源于**到期**而非关闭——INV-4 字面证据；租约注册于 sweep 开始（now=T0）之后、S1 rename 之前——owner 点名场景逐字兑现）；B4b control 返回 T0+12 ∈ [T_REG, T_REG+5) → `deletedGroups===0 ∧ leaseBlockedGroups≥1` ∧ 文件在（反向钉死「提交门读提交时刻」）；B5 ×2 同机制钉 P0 门（orphanBinsDeleted===1/0 双向） | ✅ |
| 注入面 | 既有 `config.clock`（owner「注入 clock」承载，零新公共 API）+ reader 侧 `StrictReadRequest.clock?`（SA2 G-227-6 裁定的平铺加性可选；先例 read-session.ts:34 / diagnostic-replay.ts:63 同构） | ✅ |

## 4. T-C3/T-C4 共享推进钟 + 伪绿路径攻击矩阵（本轮专项）

| # | 攻击面 | 独立核验 | 裁决 |
|---|---|---|---|
| P-1 断言削弱 | diff 中 expect 断言行零改动（diff 亲读）；现文亲证：T-C3 仍钉 `leasedUntil===T0+1000`/`deletedGroups===2`/`leaseBlockedGroups===0`，T-C4 仍钉 `deletedGroups===2 ∧ renew()===true ∧ leasedUntil===T0+3000 ∧ closed===false ∧ segments 快照不变`；ttlMs 仍 1000；`sweepRetention({ now: clock.t })` 原样 | ✅ 排除 |
| P-2 TTL 延长 | 自钉值 `leasedUntil===T0+1000`/`===T0+3000` 反向锁死 ttl=1000（openAt=T0 单源） | ✅ 排除 |
| P-3 now 篡改 | 入参仍 `clock.t`（共享钟推进值），未换 T0 或他源 | ✅ 排除 |
| P-4 锁步双钟 | `const clock = newClock(T0)` **同一对象引用**两处直传：`buildThreeGroups(root, ns, clock)`（经 makeWriter `...extra` 覆盖缺省恒定钟——spread 次序亲证）与 `openDiagnosticReadSession({..., clock})`——非两个独立钟手动同步（K-R2-3 兑现） | ✅ 排除 |
| P-5 其余调用方漂移 | `buildThreeGroups` 缺省分支 `...(clock !== undefined ? { clock } : {})` 省键 → makeWriter 恒定钟行为不变（T-C1/C2/C5..C8/T-B6 现文亲证仍走缺省臂）；构造期 `sweepOnOpen:false` + `clock.t` 推进在构造后 → 零漂移 | ✅ 排除 |
| 双向绿数学 | 旧实现：初查/S0′ 同用入参 now=T0+1001/T0+2000 → 过期放行 → `deletedGroups===2`；新实现：S0′ 读同一共享钟（t 未再动）→ 同值过期放行；T-C4 `renew()` 读共享钟 T0+2000 → `max(T0+2000, T0+1000)+1000=T0+3000` → 断言逐项成立（本轮 35/35 实测互证） | ✅ 亲证 |
| 错误修法 | `Math.max` 零命中；无回退取时；测试断言字节级未动 | ✅ 排除 |

## 5. ADR 冻结面 / 词表 / 报告与事件形状逐项

| 条款 | 本轮独立核验 | 裁决 |
|---|---|---|
| ADR-0014-LOG **L289**「只删除已关闭且没有 reader lease 的 segment group」 | 提交门（S0′×2 + P0）以提交时刻评估「没有 lease」——INV-4 在提交点字面复位（兑现型诚实化，零 amendment：docs zero-diff）；持约范围扩至 manifest 阶段 = 同句 reader lease 保护面完整兑现 | ✅ 兑现型 |
| **L291–295** 删除协议 S1–S3 / orphan 清理文法 | `deleteGroup` 本体零 hunk（diff 亲证）；S0′ 仍是 S1 前置门（仅取时来源变更）；`.deleting` 续走不加门（marker 组对会话枚举不可见）原样 | ✅ 零触碰 |
| **L297**「reader 通过 openReadSession() 获得短期 segment lease…最大 lease 时长或显式续租」 | 取得点位置非冻结面；缺省 maxLifetimeMs=null 显式续租臂维持（read-session.ts DENY 未动） | ✅ 兑现型收紧 |
| **L301–318** strict/replay 行为与报告形状冻结 | ②③ 门语义与早退包络逐字节不动（② 早退 manifest:null / ③ 早退 manifest 已设——与旧实现逐字节同）；`StrictStreamRead`/`DiagnosticReplayResult` 形状零变更；物化谓词与分类面零 hunk（reader.ts diff 无 materialize 段）；complete 门 INV-227-7 不动；取得检查点拒绝包络复用既有码 `lease-expired`（缺省参数下结构性不可达） | ✅ 零触碰 |
| ADR-0011 L97–105（重放五条件） | rev2 不触碰分类/complete 面（亲证） | ✅ 无涉 |
| 词表 / health 事件 / 报告计数 | 零新码（A6/A7 复用 `manifest-invalid`/`lease-expired`/`schema-fingerprint-mismatch`，B4/B5 复用既有报告计数）；`RetentionSweepReport`（retention.ts）与 `emitRetentionSweptIfAction` zero-diff；事件白名单零新成员 | ✅ 零增量 |
| INV-227-2 | `const segments = [...session.segments]`（:623）原样；`enumerateSegmentGroups` 在 readStreamStrict 函数体零直呼 | ✅ |
| CONTEXT.md 文档同步 | grep 亲证无 #227 租约/取得点成文面（「租约」命中均为 namespace-runtime 空闲保留，无涉）——同步义务仅包 AGENTS.md 一处，已落地且与实现相符 | ✅ |
| 测试规避 | 三文件 grep `.skip/.only/.todo/xit(/passWithNoTests/continue-on-error` **零命中**；vitest.config.ts / 根 scripts zero-diff（触发面不变）；零源码文本断言（全部断言运行时产物） | ✅ |

## 6. 本轮独立重跑证据（后台 Job，2026-09-06 23:13 UTC 起）

| 套件 | 结果 |
|---|---|
| 定向三契约文件（strict-reader-lease / file-adapter-retention-lease-gate / file-adapter-read-session） | **Test Files 3 passed (3) / Tests 35 passed (35) / Type Errors no errors / exit 0**（2.32s）——18+9+8 计数与 SA6 §1 清单一致（A6a/A6b/A7×5/B4a/B4b/B5×2 全绿，T-C1..C8/T-B6 全绿） |
| `pnpm exec vitest run packages/namespace-diagnostic-log apps/yjs-server/test/diagnostic-replay` | **Test Files 33 passed (33) / Tests 505 passed (505) / Type Errors no errors / exit 0**（54.16s）——与 SA6 红基线「505 中 4 红」互补吻合（501+4=505），零回退 |
| `pnpm typecheck`（14 tsconfig 链） | **exit 0** |

与 SA3 §4 / SA4 §6 报告互证一致；SA7 全量（2917）归 final-verification 轮，本轮不重复。

## 7. 非阻断观察项（移交总控知悉，非 ADR 冲突）

| # | 项 | 定性 |
|---|---|---|
| O1 | `package.json` bump 0.1.6→0.1.7 未逐字列入 rev2 §0.2 ALLOW | SA3 报告已显式声明 + SA4 §5 复审接受（rev2 §12 第 7 步 V-1 即建议 0.1.7）；纯加性、零 ADR/行为面、依赖均 `workspace:*`（lockfile 无需变更——zero-diff 亲证）；repo CI 立法版本提升属 release 流程非 PR 门禁——维持接受 |
| O2 | `apps/yjs-server` 维持 0.1.3（R1 `31ff694` 改其 src 未 bump 的 V-1 遗留） | rev2 对该包零改动（DENY）故不扩 bump 面；维持 SA4-R2 §R2.4 非阻断裁定，归 release 流程裁量 |
| O3 | `task_issue-227_dispatch.md` 稀疏（rev2 各轮未补记） | 总控簿记债（设计 N-c/SA2 N-3 已归属）；不影响本门禁证据链 |
| O4 | manifest 缺失流上自建臂多付一次 segments/ readdir（取得点前移固有代价） | 设计 R2-R2 备案；包络不变 |

## 8. 结论与边界

- rev2 变更集（工作树 vs `31ff694`）与 ADR-0011 / ADR-0014-LOG 全部被引条款、包 AGENTS.md
  契约、根 CONTEXT.md 词条**零冲突**：owner 两条必修为 L289/L297 的兑现型实施，冻结面
  （报告形状、complete 门、分类面、删除协议文法、schema/result 联合、事件白名单）逐字保持；
  DENY 面 zero-diff；INV-227-1（改写）/3（修订）/11/12 静态成立并经 35/35 + 505/505 独立
  运证动态佐证。
- 历史轮移交项闭环：SA8 R2 F-1（T-C3/T-C4 处置）经 SA6 共享钟对齐落地且断言字节级不动；
  SA2 K-R2-1..K-R2-4 逐项兑现（红基线证据在 SA6 §3、同 change 落地、same-object、fire-once）。
- 本轮零生产代码、零测试、零 git 写操作；测试经后台 Job 独立进程执行并收集退出码；
  owner 评论原文经 `gh api` 核得（无第二条 owner 指令）。

结构化结果：verdict **clear**、`requiresConflictRecheck: false`。

Verdict: **clear** — `requiresConflictRecheck: false`

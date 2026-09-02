# SA6 红灯锚定记录 — yjs-server: make stale root lock reclamation atomic

- **Issue**: #191（welltop-jim-wang/nomicore）
- **任务类型**: Bug 修复（红灯契约）
- **分支**: refactor/yjs-server-make-stale-root-lock-reclamation-atomic
- **Worktree**: /home/wangjian/nomicore-fix-issue-191
- **基线**: `b66615c`（main，PR #130 合入；工作树无任何生产/测试改动，仅本记录+新测试未跟踪）
- **Run ID**: issue-191-1788112074-447205（round 1）
- **日期**: 2026-08-30（UTC；本报告落盘于 2026-08-30T18:32Z）

## 结论摘要

按 SA1 R2 设计（`wiki/raw/task_191_sa1.md` §5）与 SA2 R2 复审移交要点
（`wiki/raw/task_191_sa2.md` R2.4 第 2 条）落盘唯一新测试文件：

- **文件**: `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`（11 用例；
  T3 拆 2 子用例（T3.1/T3.2 + T3.3-unwritable）、T6 拆 2 子用例（not-json + 空文件））
- **导入**: 冻结公共入口 `../src/index.js`，`verbatimModuleSyntax` 要求下全部类型导入
  用 `type` 形式（`type RootLockAcquireHooks`、`type RootLockHandle`）
- **确定性**: 零 sleep、零真并发、零进程 spawn、零 fake timer；唯一 fs 权限操作 =
  T3.3 目录 chmod 0o500 与 T9 文件 chmod 0o000，均带 try/finally 还原（SA2 攻击点 5）；
  `DEAD_PID = 2**31-1`（> Linux pid_max 4194304，本机实测 ESRCH）+ 各用例内前置断言
  `process.kill(DEAD_PID, 0)` 必抛；T3.3/T9 带 `process.getuid?.() === 0` skipIf 守卫
  （本机 uid 1000，两用例实际执行）
- **零改动**: 未触碰 `src/`、`main.ts`、任何既有测试、packages、配置；`git status`
  仅出现新测试文件与 wiki 记录

**当前基线（修复前）红灯验证结果：`5 failed | 6 passed (11)`，exit 1（真实、确定性红）**

| 契约 | 用例 | 基线（b66615c） | 修复后（预期） |
|---|---|---|---|
| T1 正常获取/幂等释放 + nonce schema pin | 1 | 🔴 | 🟢 |
| T2 单回收者 stale | 1 | 🟢 | 🟢 |
| T3 活 owner 双态 + 不可写 root | 2 | 🟢 | 🟢 |
| **T4** 双回收者恰一胜 + 败者 held + 胜者锁保全 | 1 | 🔴 | 🟢 |
| **T5** 迟到 release 不误删后继者 | 1 | 🔴 | 🟢 |
| T6 非法 JSON / 空文件视 stale | 2 | 🟢 | 🟢 |
| T7 守卫重读 ENOENT 回环（pin） | 1 | 🟢（假绿路径：seam 忽略后 flag:'w' 覆写） | 🟢（真回环路径） |
| **T8** 守卫拒绝「判定读→unlink 窗」顶替（seam②/RC1 直接红锚） | 1 | 🔴 | 🟢 |
| **T9** release 遇不可读锁文件 no-op（RC3 delta） | 1 | 🔴 | 🟢（非 root） |

## 红灯命令（真实执行，独立进程）

```bash
cd /home/wangjian/nomicore-fix-issue-191
pnpm exec vitest run apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts
# 执行形态：setsid nohup ... < /dev/null & disown（测试执行规范）；退出码 1
# 日志：/tmp/sa6-issue191-red.log（退出码 /tmp/sa6-issue191-red.exit = 1）
```

## 运行证据（2026-08-30T02:31:59Z，vitest 3.2.7，Node v24.13.0）

```
 RUN  v3.2.7 /home/wangjian/nomicore-fix-issue-191

 ❯ apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts (11 tests | 5 failed) 20ms
   × T1: … expected 'undefined' to be 'string'        ← nonce schema pin（现状 payload 无 nonce 键）
   ✓ T2: single reclaimer recovers a stale (dead-pid) lock and owns the root
   ✓ T3: live owner dual diagnostics are loud and verbatim
   ✓ T3: unwritable rootDir is loud (… chmod restored in finally)
   × T4: … expected [Function loserAttempt] to throw an error   ← 败者不抛（seam 被忽略）
   × T5: … late release must not unlink successor lock: expected false to be true  ← 误删后继者锁
   ✓ T6a: malformed (non-JSON) lock content is treated as stale and reclaimed
   ✓ T6b: empty lock file is treated as stale and reclaimed
   ✓ T7 (pin): competitor deleted the stale lock inside seam — recheck-ENOENT loop still acquires
   × T8: … expected [Function loserAttempt] to throw an error   ← 守卫缺失（seam② 被忽略）
   × T9: … unreadable lock must not be unlinked by release: expected false to be true  ← 无条件 unlink

 Test Files  1 failed (1)
      Tests  5 failed | 6 passed (11)
 Type Errors  no errors
```

**全部红锚补充证据**（同一基线、同批运行，探针 `tsx /tmp/sa6-probe191.ts`，仅作展示——
不进入测试文件，不出现在工作树）：

```
T4 anchors: returnedHandle=true (anchor1 red) | hookFired=0 (anchor2 expects 1)
            | winner=undefined (anchor3 expects defined) | survivor.instanceId=instance-A (expects 'instance-B')
T5 anchors: existsAfterLateRelease=false (expects true) | content=<gone>
T8 anchors: unlinkHookFired=0 (expects 1) | rawSeen=undefined (expects seedPayload)
            | survivor={"instanceId":"instance-A","pid":865357} (expects winnerPayload 字节)
T9 anchors: existsAfterRelease=false (expects true, non-root)
T1 anchors: keys=instanceId,pid (expects instanceId,pid,nonce) | nonce=undefined
```

即设计要求的全部红锚在基线上**逐条**为红（T4 三重红锚 / T8 四重红锚 / T5 逐字节 /
T9 文件残留 / T1 nonce 键），无一假绿。

## 锚点齐备清单（SA2 R2.4 移交要点逐条核对）

| 锚点要求 | 落点 | 状态 |
|---|---|---|
| T4 三重红锚（nothrow / hookFired===0 / survivor 字节） | `T4` 用例 3 条断言 | ✅ 齐备（基线红） |
| T5 逐字节断言（`toBe(successorPayload)`） | `T5` 用例 | ✅ 齐备（基线红） |
| T8 四重红锚（nothrow / unlinkHookFired===0 / rawSeen===seedPayload / survivor 字节） | `T8` 用例 4 条断言 | ✅ 齐备（基线红） |
| T6 双种子（not-json + 空文件） | `T6a`/`T6b` | ✅ 齐备 |
| T9 root-skip + try/finally 清理 | `it.skipIf(isRootUser)` + finally（含文件已删时的存在性守卫） | ✅ 齐备（基线红） |
| T3.3 try/finally 还原（chmod 0o700） | `T3-unwritable` | ✅ 齐备 |
| `import { …, type RootLockAcquireHooks }`（verbatimModuleSyntax） | 文件头 import | ✅ 齐备 |
| 护栏（MAX_RECLAIM_ATTEMPTS）无确定性用例、不得虚构 | 本文件无 churn 用例（§7.3 声明如实） | ✅ |

## 设计文字-矩阵冲突处置声明（SA6 裁决，请 SA2/SA4 知悉）

设计 §5 T1 文字明确要求 `typeof nonce === 'string'`（schema pin，§4.1）；同表红绿
矩阵却标 T1「🟢🟢（绿锚，修复前后均绿）」。两处冲突，SA6 以**文字**为准：T1 现状即
红（基线 payload 键 = `instanceId,pid`，无 nonce），修复后绿。理由：

1. nonce 是修复本体契约（§4.1），也是 SA2 R2 冻结面第 2 条「nonce 字节级所有权校验
   的 release（全等比较，非字段比较）」的载体；
2. T1 的 nonce 断言是**唯一** pin 住「nonce 存在」的锚：T4/T5/T8 在实现不带 nonce
   时仍可能全绿（T5 靠 instanceId 差异即判不等），漏掉 nonce 的实现可假绿；
3. 若维持矩阵的「T1 全绿」口径，等于把该锚从契约摘除——SA6 无权删减已批准契约的
   必选项；如 SA2/SA4 裁定摘除，再行修订。

（其余设计与实现完全一致，无其他偏离。）

## 类型面状态（预知红，非本文件缺陷）

`pnpm typecheck` 在基线对本文件预期红：`RootLockAcquireHooks` 尚未被 `index.ts`
re-export（SA1 §9：`index.ts` 增 1 行 re-export 属实现范围），且 `acquireRootLock`
签名尚未扩为 3 参。该红是「未实现契约」的红，与运行时红灯同源；SA3 实现后
`pnpm typecheck` 恢复。vitest 运行时侧无类型错误（`Type Errors no errors`；
`--typecheck` 段仅覆盖 `*.test-d.ts`）。

## 卫生与边界

- 测试隔离：每用例 `mkdtempSync` 独立 rootDir，`afterEach rmSync(recursive, force)`
  统一清理（沿 smoke 测试模式）；T3.3/T9 的权限变更先经用例内 finally 还原。
- T9 清理守卫说明：finally 中 `if (existsSync(lockFile)) chmodSync(lockFile, 0o600)`
  ——现状 release 会删文件（本用例红锚本体），文件已不在时无可还原；该守卫不改变
  任何断言语义（首版无守卫时 finally 撞 ENOENT 掩盖了断言失败，已修正）。
- 未提交、未触碰生产代码；`git status` 仅新增测试文件与四个 wiki 记录文件。
- 存量测试（smoke-skeleton-red / phase5-three-instance-acceptance-red /
  phase5-mgmt-verbs-sa7 / lifecycle-watchdog-red）零改动——按设计 §6.2 保持绿，
  本次未运行其全量（聚焦本文件），SA3 实现后由 SA4/SA7 统一把关。

## 移交

- **SA3**：按 `task_191_sa1.md` R2 §4.2/§4.3 实现（守卫+原子独占重取环、nonce、
  所有权校验 release、seam①②）；本套件 T4/T5/T8/T9 全绿 + T1 nonce 绿 = 修复完成锚。
- **SA4**：静态核对 §4.2 ⑤b 字节比对、continue 必经 attempt 计数、`flag:'w'` 零残留、
  seam JSDoc「测试编排用」、release「静默是刻意选择」注释、`index.ts` re-export。
- **SA7**：两个不可确定性窗口（§7.5 部分写窗、§7.1 变体 3 残余窗）归动态/推演域，
  本文件未虚构并发用例。

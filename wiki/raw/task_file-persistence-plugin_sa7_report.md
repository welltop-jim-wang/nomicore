# SA7 动态验证报告 — FilePersistence 插件（issue #58，P3）

**Date**: 2026-08-21
**Verdict**: **pass**

- 验证对象：commit `359a030`（SA3 实现；worktree HEAD `7c601ba` = SA4 报告 commit，实现之上仅 wiki 文档）
- 上游门禁：SA4 verdict **pass**（`wiki/raw/task_file-persistence-plugin_sa4_review.md` 第 4 行）→ SA7 准入成立
- 任务清单：SA4 报告 §8「动态审核重点」六项（本文 §2 逐项）
- 环境：Linux（非 root 用户 `wangjian`，chmod 语义真实生效）· Node v24.13.0 · vitest 3.2.7 · 独立进程运行，全部命令 EXIT 码落盘

---

## 1. Step 0 / Step 1 结论

```
[SA7 Step 0 结论] SA4 verdict: pass → 进入 Step 1（不允许的"下发"不存在：SA7 仅可维持或下调为 fail）
[SA7 Step 1 结论] SA6 红灯: 🟢 GREEN（红灯锚点已被实现转绿）→ 进入 Step 2
```

Step 1 独立复跑（不采信 SA3/SA4 自报）：

| 命令（独立进程） | 结果 |
|---|---|
| `pnpm test`（vitest run --typecheck） | **Test Files 33 passed (33) / Tests 493 passed (493) / Type Errors no errors / EXIT=0**（18:49 运行，含 SA6 锚点文件） |
| SA6 锚点文件 | `✓ packages/persistence/test/file-persistence.test.ts (13 tests) 1808ms` —— Phase-1 红灯（EXIT=1，收集期失败）现为全绿 |

与总控亲跑（493 passed）及 SA4 §0 独立复跑三方一致。

---

## 2. SA4 §8 动态审核重点逐项验证（六项全过）

### 2.1 sweep 吞错信号链端到端 —— ✅ 闭合（已固化为永久测试）

**方法**：真文件系统 + chmod。先在可写分区提交 `d1.snapshot`，写入遗留 `d1.snapshot.tmp`，随后 `chmod 555 users/alice`（r-x：读可行、unlink/write 必 EACCES）。

**证据链**（新永久用例 1，`file-persistence-sa7-dynamic.test.ts`）：

1. `loadDoc(alice, d1)` → **成功还原**（`ROOT.v='committed'`），且 `d1.snapshot.tmp` **仍在磁盘**——unlink 被尝试且 EACCES 被吞（证明是"吞错"而非"静默成功"）；`getStatus()='ready'`。
2. 随后 `saveDoc` → 被接受 → debounce 10ms 后 flush 的 `writeFile(tmp)` 撞上同一磁盘状况 → **`getStatus()='persistence-degraded'`**；旧提交态 `.snapshot` 完好未损。
3. degraded 后再次 `saveDoc` → `rejects.toThrow(/persistence-degraded/)`。

> 结论：「删除失败不阻断读、同一磁盘状况在下次 flush 响亮浮出」的信号闭合在运行时成立——sweep 的 best-effort 吞错没有丢失任何信号。

### 2.2 degraded 跨用户半径 —— ✅ 继承语义如实（已固化为永久测试）

**方法**：注入确定性 `ManualTimer`（不自动触发，由测试按序手动点火），`chmod 500 users/bob`。bob/alice 两 doc 先后 save（触发器全部挂起）。

**证据链**（新永久用例 2）：

1. 仅点火 bob 的 flush 触发器 → `writeFile` EACCES → 整个实例 `persistence-degraded`。
2. **半径跨用户**：alice 的 `saveDoc` 被拒（`/persistence-degraded/`）；carol 的**创建路径** `createFileHandleForTest` 同样被拒——`assertWritable` 全局生效。
3. 点火 alice（健康分区）的 flush 触发器 → 成功落盘 `users/alice/fine.snapshot`，**status 翻回 `ready`**——「任一无关 doc flush 成功即无条件恢复可写」逐字复现；bob 的 `doomed.snapshot` 始终不存在（从未提交）。
4. bob 仍在退避：手动点火其挂起的 retry 定时器 → doomed flush 再次 EACCES → **再次 degraded**（retry 机器活着，非死定时器）；dispose 后 `timer.pending === 0`（retry 定时器被正确清理）。

### 2.3 残留 tmp 钉死（按 (user, docId) 键控，非全树清扫） —— ✅（已固化为永久测试）

**证据**（新永久用例 3）：seed `d1.snapshot`（有效）+ `d1.snapshot.tmp` + `d2.snapshot.tmp`，**只 loadDoc d1** → d1.tmp 已删、d1 正常还原；**`d2.snapshot.tmp` 原样仍在**。清扫严格键控于所读 namespace，不做启动全树扫描——与设计 E.1 披露逐字一致。

### 2.4 模块入口纪律（F-1） —— ✅ 按约记录，非缺陷

**临时探针**（跑毕即删）：仅深导入 `../src/file.js`（不先经 index.js）的测试文件 → 收集期即崩：

```
TypeError: Class extends value undefined is not a constructor or null
 ❯ packages/persistence/src/memory.ts:24:40
```

与 SA4 F-1 表格「仅 `../src/file.js` → 崩溃点 memory.ts:24」**逐字吻合**——确认为已披露的入口次序约束（值环 TDZ），**非实现缺陷，不上报**。正方向：本报告全部补充测试与既有 33 个测试文件均 index-first，深路径 `../src/file.js` 导入正常工作。

### 2.5 rename/chmod 平台复跑 —— ✅ 通过（不另开攻击面，按 SA4 指示仅复跑）

Step 1 全量运行中 SA6 用例 8 复跑通过：

```
✓ FilePersistence > replaces a committed snapshot via atomic rename: a read-only committed file does not block the next flush  503ms
```

chmod 444 已提交快照 + tmp+rename 覆盖在本平台（Linux / Node v24.13.0 / 非 root）行为与 CI 锚定一致。

### 2.6 多实例同 rootDir —— ✅ 按约不记缺陷

**临时探针**（跑毕即删）：两实例同 rootDir 并发 save 同 `(alice, d1)`：

```
[SA7-DIAG] multi-instance same rootDir: winner = b
[SA7-DIAG] statuses after dispose: a = disposed , b = disposed
```

实测行为：无锁、last-writer-wins，落盘字节始终是**完整有效 Yjs update**（`Y.applyUpdate` 还原成功、META.docId 完好）、无崩溃、双双干净 dispose。与 ADR-0006 v1「调用方错误、不设防」披露一致——**不记为缺陷**；亦未固化为永久测试（避免把 v1 容忍行为钉死成契约，约束未来加锁设计）。

---

## 3. Spec / vitest 触发证据

### 3.1 E2E spec（Step 3 门禁）

**N/A** —— 本任务 SA1 设计与实现均无新增/改动 `*.spec.ts`（SA4 §2.3 同判）。

### 3.2 vitest 触发（Step 4 门禁）

**CI Run: 不存在** —— 分支 `fix/issue-58-on-adr-server-design` 未 push（`git ls-remote --heads origin` 无该分支；本地 `[origin/adr/server-design: ahead 3]`），且 SA7 依约不负责 push/建 PR/宣称 CI 绿。**此为环境事实，非实现问题。**

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| packages/persistence | `test`（node 20/24 矩阵，`ci.yml:39` `pnpm test`；另 `:44` 契约单跑步骤） | ✓ 本地等价证据（CI run 待 push 后生成） | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 收集本包全部测试文件；最终全量运行 `Test Files 34 passed (34) / Tests 496 passed (496) / EXIT=0` **已把新增 `file-persistence-sa7-dynamic.test.ts` 计入收集并全绿**——CI 的 `pnpm test` 同配置必然同样收集 |

**verdict**: ✅ all-vitest-packages-triggered（本地动态证据；CI 侧静态门禁已由 SA4 §2.4 核实 `ci.yml:39/:44` 覆盖，动态 CI log 证据待总控 push 后由后续环节摘录，SA7 不越权宣称）

---

## 4. 产物与残留

| 产物 | 路径 | 性质 |
|---|---|---|
| 补充性永久测试（§8.1/2.3/2.2 三用例） | `packages/persistence/test/file-persistence-sa7-dynamic.test.ts` | SA7 新增，进 CI 收集范围 |
| 本报告 | `wiki/raw/task_file-persistence-plugin_sa7_report.md` | SA7 新增 |
| 临时探针 ×2（§8.4/§8.6） | 已删除 | 跑毕即删，`git status --short` 仅余上两新增 + 总控侧 `.mabf-bg/sa3-verify.log`（非 SA7 改动）——**探针零残留** |

未改任何 `src/` 业务代码；未改 SA6 测试文件；未 push。

## 5. 最终复跑汇总

| 命令 | 结果 |
|---|---|
| `pnpm test`（含 SA7 补充文件，独立进程） | **Test Files 34 passed (34) / Tests 496 passed (496) / Type Errors no errors / EXIT=0**（493 基线 + SA7 新增 3） |
| `pnpm typecheck`（独立进程） | **EXIT=0** |
| SA7 补充文件单跑 | `✓ file-persistence-sa7-dynamic.test.ts (3 tests) 528ms / EXIT=0` |

## 6. 结论

**Verdict: pass**

- SA4 §8 六项动态审核重点全部通过：三项（sweep 信号链 / degraded 半径 / 残留 tmp 键控）已固化为永久补充测试进 CI；rename/chmod 复跑通过；入口纪律与多实例同 rootDir 按约记录、均非缺陷。
- 未发现任何新的静默失败、降级偏离或读写分叉；SA3 实现（commit `359a030`）在真实运行链路上与设计 R1 及 ADR-0006 披露一致。
- 回流件（非阻断，与 SA4 一致）：SA1 文档债两项（§6.4-① 勘误、§9 ALLOW/DENY 增补）不属 SA7 动态验证范围，维持 SA4 处置。

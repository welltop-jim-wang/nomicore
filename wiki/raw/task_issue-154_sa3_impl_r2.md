# SA3 实现报告 R2 — Issue #154：P2 字节遍历年龄门控修复（SA4 R1 reject 返工）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-154`（branch `fix/issue-154-on-docs-namespace-diagnostic-change-log`）
- **本轮提交**: `385a376` `fix(namespace-diagnostic-log): P2 byte sweep must not gate on age freshness (SA4 R1 #154)`（父提交 `c0f6cbc` = 首轮实现）
- **上游输入**: `wiki/raw/task_issue-154_sa4_review.md` §2（唯一阻断项 R1——P2 字节遍历被年龄前沿门控，字节上限在 `maxAgeMs ≠ null` 时（含默认 30d）完全不可执行）+ §5 复验范围（(a) `sweepNow` P2 块及两处注释）
- **修复面**（SA4 §3 逐字要求）：删除 `file.ts:1274` 整行条件；修正 `file.ts:1235-1236` 与 `:1288` 注释（移除「未过期」）；README 仅新增一句 R1 裁决说明（其原文本本就是正确语义，SA4 §3 注「README 无需改动」——本轮为明确化追加，不动既有表述）。

---

## 1. 改动 diff（本轮，`git show 385a376` 内容）

### `packages/namespace-diagnostic-log/src/adapters/file.ts`（+9/−3）

```diff
       // —— P2 字节遍历（maxBytes ≠ null 时；Σ 全部流全部组（含闭组字节——存在即占空间）；
-      //    候选序与 P1 同源；无可删候选（全被开组/租约/未过期/失败止步）→ 停）——
+      //    候选序与 P1 同源；SA4 R1 裁决：**字节遍历只以 closed ∧ unleased 为门**——年龄
+      //    新鲜度是 P1 年龄遍历的专属限制，字节预算必须可独立达标（两限制各自独立生效，
+      //    不互相门控、不双重执法）；无可删候选（全被开组/租约/失败止步）→ 停）——
       if (maxBytes !== null) {
         ...
               if (segmentLeased(config.rootDir, namespaceId, stream.streamId, segment, now)) {
                 report.leaseBlockedGroups += 1
                 break
               }
-              if (maxAgeMs !== null && !groupAgeExpired(stream.segmentsDir, segment, now - maxAgeMs, report)) break
+              // SA4 R1：无年龄新鲜度门（P1 专属）——字节预算下闭组即可删（前缀纪律仍生效：
+              // 首个不可删组即止步该流，绝不跳洞）
               const before = groupBytesBeforeDelete(stream.segmentsDir, segment)
               ...
-          if (!progressed) break // 无可删候选（开组/租约/未过期/失败全部止步）→ 停（INV-5 绝不动开组）
+          if (!progressed) break // 无可删候选（开组/租约/失败全部止步）→ 停（INV-5 绝不动开组）
```

语义变化（与 SA4 §2 推演一致）：
- **修复前**：`maxAgeMs ≠ null` 时 P2 内层扫描遇首个未过期组即 `break`，而 P1 已按同口径删尽过期闭组 ⇒ P2 删除数恒 0（死代码）；默认 30d+1GiB 下 30 天内磁盘可无界增长（字节界不可执行）。
- **修复后**：P2 只以 **closed ∧ unleased** 为门（止步原因收敛为 {开组、活跃租约、IO 失败}），字节预算独立于年龄达标；P1 年龄遍历与 P2 字节遍历**各自独立生效**（不互相门控）；两遍共用前缀纪律（首个不可删组即止步该流——INV-2 保留）。

### `packages/namespace-diagnostic-log/README.md`（+4，文档）

在 retention 节「`0` 的非无限语义」后新增一条（明确化；不改既有表述）：

```markdown
- **年龄与字节是两个独立限制（SA4 R1 裁决）**：年龄遍历（P1）按 `maxAgeMs` 筛选；
  字节遍历（P2）**只以 closed ∧ unleased 为门**——不按年龄新鲜度二次筛选（字节预算
  必须可独立达标，两限制各自生效、不互相门控）；两者的前缀纪律（首个不可删组即止步
  该流）与开组/租约保护相同。
```

### 未改动（零 diff）

- 其余 sweep 代码（P0 卫生 / P1 年龄 / 删除协议 / 租约 / 报告数据面）、reader、read-session、health、index、测试全部原样——**只删一行条件 + 更新注释/文档**。
- **未新增/修改任何测试**：SA4 §3-2 要求的钉死测试（建议 T-A9）归 SA6 新增（SA6 owned）；本轮不越权改测试（严守「不能修改测试代码」纪律——SA6 将在其专属测试文件中补钉死锚）。

---

## 2. 验证命令与结果（真实执行）

```bash
# 包级 tsc（零错误）
$ npx tsc -p packages/namespace-diagnostic-log/tsconfig.json
# exit 0

# SA6 五个契约文件（45 测试——含 T-A3/T-A5/T-B10 字节边界；全部绿）
$ npx vitest run packages/namespace-diagnostic-log/test/file-adapter-retention.test.ts \
    packages/namespace-diagnostic-log/test/file-adapter-retention-deletion-windows.test.ts \
    packages/namespace-diagnostic-log/test/file-adapter-read-session.test.ts \
    packages/namespace-diagnostic-log/test/file-adapter-namespace-deletion.test.ts \
    packages/namespace-diagnostic-log/test/file-adapter-retention-history.test.ts
# Test Files  5 passed (5)
#      Tests  45 passed (45)
# Type Errors  no errors

# 包级全量（非回归：381 既有 + 45 新 = 426）
$ npx vitest run packages/namespace-diagnostic-log/
# Test Files  27 passed (27)
#      Tests  426 passed (426)
# Type Errors  no errors
```

回归安全性（SA4 §3 预核 + 实测确认）：T-A3/T-A5/T-B10 以 `maxAgeMs: null|0` 构造（门不存在或恒过期——语义不变）；T-A7 数据 ≪ 1 GiB（P2 循环不进入）；T-B4/T-C* 的开组/租约止步分支先于被删行触发——**移除该行不破坏任何既有测试**（45 全绿佐证；含 schema-freeze / r2-supplemental / reopen-roll-repair 钉死面）。

## 3. 提交记录

- **本轮**: `385a376` `fix(namespace-diagnostic-log): P2 byte sweep must not gate on age freshness (SA4 R1 #154)`（2 files changed, 10 insertions(+), 3 deletions(-)）
- 提交内容 = `src/adapters/file.ts`（生产）+ `README.md`（文档）；wiki 任务元数据（含本文件）未提交（任务简报既定：REPORT.md/wiki 不提交）。
- 工作树仅剩 `wiki/raw/task_issue-154_*.md` 未跟踪文件（预期内）。

## 4. 剩余风险 / 交接

- **SA6 待补钉死测试**（SA4 §3-2，建议 T-A9）：`maxAgeMs` 非空非零（如缺省 30d 或 1000ms）+ 数据龄 0 + `maxBytesPerNamespace < total` ⇒ 最旧闭组被删至 ≤ 预算、开组原样、`retainedBytes` = 开组+阻塞组字节；另加反向锚：删后 `historyTrimmed` 报告正确。实现行为已随本修复就位，SA6 落笔后应转绿。
- SA4 §6-R1/R2 残余（Low 级，备案）：`.deleting` 态组不计入 total/retainedBytes（保守少删方向）；无 manifest 流不参与 sweep（保守方向）——均交 SA7 观测，不在本票修复面。
- 其余模块（reader/read-session/health/index/删除协议/文档）SA4 本轮已验，不在复验范围。

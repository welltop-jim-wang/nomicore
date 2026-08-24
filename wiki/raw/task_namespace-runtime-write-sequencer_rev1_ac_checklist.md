# AC 门禁核对表 — namespace-runtime write sequencer 修订轮 R1（issue #90 / PR #100）

- run_id: issue-90-1787537615-442625
- branch: fix/issue-90-on-docs-namespace-runtime
- round: 3（恢复轮总控执行）
- 核对时间：2026-08-24 16:13
- 前置状态：SA6 红灯锚定（3 红）→ SA3 实现 + 补漏 → 总控亲跑四通道全绿 → SA4 静态验尸 pass → SA7 动态验证 pass

## 逐条核对

### AC-R1-1：message 只含稳定 code/phase/committed 与固定处置说明 ✅

- 实现证据：`src/write.ts` `writeFatalMessage(phase, committed)` 剔除 detail 参数，模板尾段
  `原始异常证据引用：「${detail}」` 已删除；message = `NSRT-WRITE-FATAL` 前缀 +
  `phase=`/`committed=` 插值 + 固定处置说明（不补偿/不 fallback/不声称回滚/不得自动重试）。
- 测试证据：rev1 用例 1/2 泄漏负向断言（RAW_LEAK_MESSAGE/ROOT/SCHEMA/INPUT 四重 sentinel +
  「原始异常证据引用」模板段缺席）全绿。
- SA4 §1：五个 fatal 构造点（S2/S4/S5-branded/S5-unknown/S6）零 detail 残留；
  `RuntimeWriteFatalError` 类不拼 cause 文本。
- SA7：双 sentinel 种子各 140 断言全绿；message 跨进程逐字节稳定（sha 一致）。

### AC-R1-2：原始异常实例仅经标准 cause 保留（严格相等）✅

- 实现证据：全部 throw 点 `cause === undefined ? undefined : { cause }`；
  S5 branded 透传 `err` 本体（不再复制 `err.message`）；S5 unknown 传 `err`；S6 传 `err`。
- 测试证据：rev1 用例 1/2 `cause === rawErr`（同一引用）绿。
- SA7：运行时实测 Error/TypeError/thrown-string 三载体 cause 严格相等；`throw undefined`
  边界如实刻画（cause own-prop 缺席，L-2 注记，非缺陷）。

### AC-R1-3：status.fatal 稳定 {code,message} 摘要 ✅

- 实现证据：`markWriteFatal` 恒冻结 `FATAL_WRITE_INTERNAL_CODE/MESSAGE` 常量对，零插值。
- SA7：运行时实测 `status.fatal` 键集恰 `{code,message}`，无 cause/stack 字段，
  `JSON.stringify` 无泄漏；`fatalCause` 存闭包私有 state，公共面零暴露（SA4 复核）。

### AC-R1-4：回归测试覆盖双路径纪律 ✅

- `packages/namespace-runtime/test/runtime-write-fatal-message-rev1.test.ts` 3 用例：
  ① notifier-failure（notify-dirty-failed/committed:true）② unknown-pipeline-throw
  （committed:true 保守）③ P2 术语纪律。rejection 类别/cause 严格相等/message 无
  sentinel/ROOT/SCHEMA/input sentinel 全覆盖；3/3 绿。

### AC-R2-1：术语统一「永久禁用…写能力，读取仍保留」✅

- 改动面：`errors.ts` 双 FATAL 常量、`write.ts` S1 disabled 文案/模板/注释、三个既有测试
  文件措辞与断言同步。
- grep 证据：`packages/namespace-runtime` 内「永久关闭」残点仅 ① rev1 测试负向断言与
  说明注释 ② p0-sequencer L13 引用 ADR 原文的说明性注释（简报明示合法）；可观测
  message 面零命中。
- SA7 运行时取值：P0 fatal message 与 S1 gate RUNTIME_WRITE_DISABLED issue.message 均无
  「永久关闭」/closing/closed、含「禁用/读取/保留」。
- ADR 未动：`git diff HEAD -- docs/` 为空。

### AC-R2-2：验证门禁全绿 ✅

| 通道 | 命令 | 结果 |
|---|---|---|
| 定向 | `pnpm exec vitest run packages/namespace-runtime/test --no-typecheck` | exit 0，10 文件 50/50 |
| 全量 | `pnpm test`（vitest run --typecheck） | exit 0，80 文件 1053/1053 |
| 七包 | `pnpm typecheck` | exit 0 |
| 聚合 | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` | exit 0 |

日志：`.mabf-bg/verify-r3-nsrt.log` / `verify-r3-full.log` / `verify-rev1-tsc.log` /
`verify-rev1-tscagg.log`。Node 20/24 CI 腿按简报移交 runner/ciwatch（本地有效腿
Node v24.13.0）。

### AC-R2-3：版本 bump + 档案入库 + commit 纪律 ✅（commit 后闭环）

- `packages/namespace-runtime/package.json` 0.1.1 → 0.1.2 patch bump（仅 version 行）。
- wiki 档案：rev1 简报、dispatch log（追加至 #26）、rev1_sa4_review、rev1_sa7_report、
  本表随收尾 commit 入库。
- push/PR/标签/`.mabf-done` 由 Host 在 Runner 调 complete/publish 时执行（round 3 指令
  覆盖简报中的"SA3 push"措辞）。
- 收尾 commit 精确 path add，严禁 `git add -A`/`commit -a` 扫入 `.mabf-done`（删除态）、
  `REPORT.md`（修改态）、`.mabf/`（未跟踪）——SA4 L-5 / SA7 §5 纪律回流已落实。

## 结论

**AC 7/7 全过**（AC-R2-3 的 commit 动作随本次收尾完成）。SA4 pass + SA7 pass 双清，
无 C/H/M 阻断项；Low 观察项均已处置或如实记录（L-1/L-2/L-3 注记、L-4 移交 CI 腿、
L-5 commit 纪律已执行）。

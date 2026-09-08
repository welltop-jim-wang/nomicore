# SA7 动态验证报告 — issue #148 `@nomicore/namespace-diagnostic-log`

- **Date**: 2026-08-28（R4 轮后验收）
- **Verifier**: SA7（Dynamic Verifier）
- worktree: `/home/wangjian/nomicore-fix-issue-148`（branch `fix/issue-148-on-docs-namespace-diagnostic-change-log`，未提交工作树改动）
- **SA4 verdict 前置核对（Step 0）**: `task_diagnostic-log-v1-contract_sa4_review.md` 顶部总 Verdict = **pass（放行进入 SA5/SA7 验收）** → SA7 进入动态验证（无「下发洗白」问题）
- **总 verdict**: **pass**（5/5 AC pass；2 项非阻塞备案见 §6）

---

## 1. 验证链独立复跑（全部后台进程，日志 `.mabf-bg/sa7-*.log/.exit`）

| 步骤 | 命令 | exit | 关键输出 |
|---|---|---|---|
| 安装 | `pnpm install --frozen-lockfile` | **0** | `Scope: all 12 workspace projects` / `Lockfile is up to date` / `Done in 401ms using pnpm v10.28.2` —— R2/G-b1 CI 口径成立（新包 importer 段与 lockfile 一致） |
| 类型 | `pnpm typecheck`（根 script，10 包 tsc 链含 `packages/namespace-diagnostic-log/tsconfig.json`） | **0** | 全链静默通过，无错误输出 |
| 测试 | `pnpm test`（vitest run --typecheck，全仓） | **0** | `Test Files 130 passed (130)` / `Tests 1557 passed (1557)` / `Type Errors no errors` / `Duration 110.91s` |

**新包触发证据（Step 4 口径的本地侧）**：`sa7-test.log` 内 `packages/namespace-diagnostic-log/test/` 命中 12 行、全部 `✓`——
`identity.test-d.ts (9)`、`input-capture (18)`、`issues-projection (21)`、`schema-freeze (13)`、`record-vocabulary (27)`、`memory-adapter (9)`、`vfsl-gate (16)`、`emitter-isolation (8)`、`update-carrier (10)`、`line-budget (6)`、`identity (10)`、`observer-isolation (5)` = **152 用例全绿**（vitest include `packages/*/test/**/*.test.ts` + typecheck include `*.test-d.ts` 双接通）。

**SA6 红灯 → 绿灯（Step 1）**：SA6 红灯报告记录 12 文件全红（exit 1，src 缺失）；本轮同一测试面在实现后 152/152 绿，红灯翻转全部经由 src 实现，非测试弱化。

## 2. AC checklist 结论（详见 `task_diagnostic-log-v1-contract_ac_checklist.md`）

| AC | 结论 | 主锚 |
|---|---|---|
| AC1 emitter 全词表 + 零物理细节 | ✅ pass | record-vocabulary.test.ts:71-204（8 变体×6 operation 全矩阵）+ identity.test-d.ts:70-102（物理键黑名单 ∩=∅ 编译期锚） |
| AC2 四策略输入捕获 + 不重读 | ✅ pass | input-capture.test.ts:22-90（决策表 5×4 全格）+ :212-227（getter 单触达探针） |
| AC3 预算内确定性投影 + 降级 digest | ✅ pass | issues-projection.test.ts:24-198（4096/1024/256/1000 预算 + 段级 JSON-safe）+ line-budget.test.ts:13-82（降级→丢弃） |
| AC4 VFSL 门 + 低基数健康面 | ✅ pass | vfsl-gate.test.ts:59-110（9 类违规→只带 issuePaths + 白名单键集）+ observer-isolation.test.ts:14-95 |
| AC5 有界 adapter drop-newest/保序/永不 throw | ✅ pass | memory-adapter.test.ts:14-140 + identity.test.ts:82-131（exhausted 邻域） |

## 3. 指纹独立复现（SA4 §5-2）

探针：`.mabf-bg/sa7-fingerprint.mts`（干净 tsx 进程，仅从包公共面 `src/index.js` 导入），**exit 0**：

```text
RECORD_SCHEMA_ID      = nomicore.namespace-diagnostic-change-record@1
envelopeFingerprint   = sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070
fingerprint match     = true   （=== 期望钉死值）
envelope keys         = ["id","lang","text","version"]  key count = 4（恰四键 ✓）
envelope frozen       = true；compile ok = true
```

## 4. 性能量级抽测（SA4 §5-3；探针 `.mabf-bg/sa7-perf.mts`，exit 0，计时 `node:perf_hooks`）

**A. 默认 digest 策略，~256 KiB 安全快照 emit 1000 次**（快照 262,222 B / 1682 行 plain-data；24 次预热后计时；capacity 提至 4096 排除 queue-full 噪声，其余全默认）：

| 指标 | 值 |
|---|---|
| 总耗时 | 2997.6 ms |
| mean / emit | 2.998 ms |
| p50 / emit | 2.797 ms |
| p95 / emit | 4.126 ms |
| max / emit | 8.049 ms |
| stats | accepted=1024（24 预热+1000 计时），droppedTotal=0，全程同步无 IO/await |

**B. 1M 节点护栏边界**：900,000 节点（root+899,999 叶）emit 一次 **41.1 ms** → capture=`digest`（护栏内正常接纳）；1,000,005 节点 emit 一次 **49.3 ms** → capture=`unavailable` + **恰 1 次** `input-projection-failed` 事件，进程存活无崩溃。
**C. 栈深度收编**：60,000 层深嵌套 → emit **不 throw**，capture=`unavailable`（递归 RangeError 被 §5.4 catch 收编），事件 1 次。

结论：emit 全链（JCS 遍历→SHA-256→投影→VFSL 校验→入队）为纯同步 CPU 工作，256 KiB 快照量级 ~3 ms/emit、护栏边界 ~50 ms——量级与「无 IO/await 不阻塞」承诺一致（CPU 量级留档，不设硬门槛）。

## 5. C-4 行为演示（SA4 §5-4；探针 `.mabf-bg/sa7-c4-demo.mts`，exit 0）

message=`'…'.repeat(2048)`（U+2026×2048）经 emit：

```text
原始 message JSON 字面量   = 6144 B（2048 × 3B）
投影后 message JSON 字面量 = 4094 B ≤ 4096（1360×3B 前缀 + 14B marker）
ends with …[truncated]    = true；truncated=true；originalCount=1
两次 emit 投影逐字节相同（确定性）；records accepted=2；record-dropped 事件=0
```

R4 勘误（marker 13B→14B、删除 U+2026 记 2B 特例）生效：SA4 C-4 记录的「4096B 不截断、穿透 50%」路径已消除，现被确定性截断且 record 仍被接纳。实现侧运行时以 `jsonLiteralBytes(TRUNCATION_MARKER)` 动态计量（`src/projection/issues.ts:58-60`），测试侧 KAT 同步 14B（`issues-projection.test.ts:87`）。

## 6. 发现的问题（均非阻塞）

1. **[nano·文档] 设计文档残留 4 处旧「13B」措辞**：R4 已修正规范常量（设计头部状态行 + §6.1:798「marker JSON 字面量字节 = 14B」），但 §6.1:813（loud 断言注释「budget < marker 字节数（13B）」）、§6.1:826（「marker 全 ASCII：字面量 13B」——且 marker 含 `…` 非 ASCII，双重过时）、§9.4:1011（「< marker 13B」）、文末 R2 回应表:1149（历史表，可豁免）仍写 13B。**对实现与测试零影响**（实现运行时计量、测试已钉 14B，`budget=12 < 14` 仍 throw 语义不变）。建议 SA1 后续文档维护轮统一清掉；不构成本票 fail。
2. **[备案·流程] CI 侧动态证据尚未产生**：SA4 §5-1 要求的 node 20/24 矩阵 CI 日志属发布阶段（当前分支改动未 commit/push、无 PR）。本地链已复现 CI 同口径三步全绿（`--frozen-lockfile` exit 0 是 CI install 步的直接前置验证）；PR 生成后的 `gh run view` 摘录由 Host/发布阶段补留痕。SA7 纪律明确不 push、不建 PR、不宣称 CI 已绿。

## 7. 验证产物清单

| 产物 | 位置 |
|---|---|
| 验证链日志/退出码 | `.mabf-bg/sa7-install.{log,exit}`、`sa7-typecheck.{log,exit}`、`sa7-test.{log,exit}` |
| 指纹探针 | `.mabf-bg/sa7-fingerprint.mts` + `.log/.exit` |
| 性能探针 | `.mabf-bg/sa7-perf.mts` + `.log/.exit` |
| C-4 演示探针 | `.mabf-bg/sa7-c4-demo.mts` + `.log/.exit` |
| AC checklist | `wiki/raw/task_diagnostic-log-v1-contract_ac_checklist.md` |
| 本报告 | `wiki/raw/task_diagnostic-log-v1-contract_sa7_report.md` |

（探针均置于 `.mabf-bg/`，非仓内 tracked 文件；SA7 未改动 `packages/`、根配置、CONTEXT.md，无 git commit/push。）

## 8. Verdict

**pass** —— 验证链三步 exit 0（install 401ms / typecheck 0 错 / 全仓 130 文件 1557 测试绿含新包 152 用例）；5/5 验收标准证据齐备（机器锚 + 设计/ADR 章节 + SA7 独立动态复核）；指纹独立复现一致、信封恰四键；性能量级留档符合「同步不阻塞」承诺；C-4 R4 勘误行为验证成立。仅存 2 项非阻塞备案（设计文档 13B 残留措辞、CI 侧证据待发布阶段留痕）。

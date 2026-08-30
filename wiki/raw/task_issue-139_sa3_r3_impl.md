# SA3 R3 实现报告 — Issue #139 F1 修复（`verify-write` 有界物化等待）

**Date**: 2026-08-30
**Implementer**: SA3（TDD 实现执行者）
**Worktree**: `/home/wangjian/nomicore-fix-issue-139` @ branch `fix/issue-139-on-docs-phase-5-websocket-replication`
**基线 commit**: `4d9fff5`（SA4 B1/B2 修复后）
**本轮 commit**: `381b9fd` — `fix(apps/yjs-server): F1 verify-write 有界物化等待——已知集 ns 收敛期不再误报 write-failed（issue #139）`（2 files changed, 583 insertions(+), 3 deletions(-)；业务+测试，**未含** wiki/raw/REPORT）
**审核对象**: SA7 报告 `task_issue-139_sa7_report.md` F1 阻断（§2）+ 设计 `task_issue-139_design.md` §3.4/§5-T7/§8 ALLOW LIST

---

## 1. 变更摘要（对齐 SA7 §2.5 修复方向，窄面单函数 + 测试）

### 1.1 `apps/yjs-server/src/app.ts`（+45/-3，唯一业务文件）

**根因**（SA7 §2.2/§2.3 载荷级证据）：`opVerifyWrite` 对 `registry.open` 失败**立即** `write-failed`（旧 `app.ts:505-506`）。peer `ready` 事件在 `peer.start()` 后立即发射，此刻拨号/引导尚未完成、本地 ns 记录未物化 → 已知集 ns 的 `verify-write` 在 **~50ms** 内得到 `write-failed`（设计 §3.4 的 30s 有界等待从未生效，`verify-write-timeout` 对「已知集未物化」不可达）。

**修复**（三态 open + 共享 deadline）：

- 新增 `openWriteNamespace(namespaceId, ownerUserId, deadline)`：`registry.open` 的 `NAMESPACE_NOT_FOUND`（`persistence.loadDoc → null` = 复制收敛/恢复路径上的**瞬态**）在 op deadline 内以 `OPEN_RETRY_INTERVAL_MS=50` 间隔重试；返回三态 `ok`（拿 lease）/ `timeout`（deadline 达成仍未物化）/ `rejected`（**非** NOT_FOUND 的真实错误）。
- `opVerifyWrite` 改为单 deadline（`Date.now()+waitMs`，缺省 30s、op 级 `timeoutMs` 钳位 [1,120000] 不变——**有界等待总预算** 覆盖「open 重试 + 达成后 live 等待」两段，不再叠加）；`timeout` → `verify-write-timeout`（与「等待达成后仍未 live」同一稳定码，注册表零新增）；`rejected` → `write-failed`；mutateRoot `ok:false` → 仍 `write-failed`。
- **错误链语义**：`write-failed` 收缩为「物化后/真实错误」——`NAMESPACE_LOAD_FAILED`/`REGISTRY_NOT_ACCEPTING` 等真实错误不重试、不吞错、不冒充超时；正常收敛窗口内不再误报。
- 设计 §3.4 冻结措辞「等待该 ns state=live 的 deadline … 超时 → verify-write-timeout（不挂起、不静默）」现对**已知集但未物化** ns 成立（hub 侧直引 ns 未到达/peers 收敛中统一覆盖——SA7 §2.5 修复方向即为 peer 路径，此处扩展为两角色统一语义，仍符合设计冻结文本）。

### 1.2 `apps/yjs-server/test/stdin-error-chain-red.test.ts`（新建，538 行；设计 §8 ALLOW LIST 明列文件名，SA6 未交付 T7 → 本轮补齐）

| # | 用例 | 断言要点 | 对旧代码 |
|---|---|---|---|
| 1 | T7 错误链（① 非 JSON 行 ② `bogus` op ③ 未知 ns `read` ④ `add-target` 永不可 live ns ⑤ `verify-write{timeoutMs:500}` ⑥ `status`） | 每行恰一回执 + 稳定码 `malformed-line`/`unknown-op`/`namespace-unknown`/`verify-write-timeout`；进程不退出 | **确定性红**：⑤ 旧代码 ~50ms `write-failed`（实测 `expected 'write-failed' to be 'verify-write-timeout'`，1164ms 快速失败） |
| 2 | 收敛竞态（正常路径，directed repeated）：peer `ready` 后**零 settle** 4× 并发 `verify-write`（timeoutMs:15s），每轮全新 peer 进程 × 3 轮 | 全部 `ok:true` 收敛；hub 终读值 = 3 | 命中未物化窗口时旧代码 `write-failed`（概率性守卫） |
| 2b | **确定性竞态窗口**：peer 先于 hub 启动（hub v1 provision→停机→同 rootDir 直引 v2 未启动）→ peer ready 后立即 3× `verify-write{timeoutMs:20s}` → 800ms 内**零回执**（有界等待内挂起）→ hub v2 启动 → 收敛 `ok:true` + hub 终读 21 | 记录**保证**未物化，旧代码确定性 ~50ms 三连 `write-failed` | **确定性红**（实测 3×`{"ok":false,"code":"write-failed"}` @~50ms） |
| 3 | 高负载：peer ready 后立即 3× `verify-write`，同时 2× CPU 燃烧进程（2.5s 自终止、独立进程组） | 全部 `ok:true` 收敛 | 命中窗口时旧代码 `write-failed`（概率性守卫；SA7 §2.2 满载形状有界化） |

清理纪律：所有测试子进程 `detached:true` 独立进程组 + afterEach 组杀（`kill(-pid)`）——规避 SA7 §7-O2 的 tsx 包装层孤儿泄漏（本文件新增，既有测试文件未动）。用例 1 的 ⑤ 断言 `elapsedMs ≥ 450`（有界等待真正执行到 deadline）与 `< 8000`（不挂起）。

## 2. 证据（全部独立重跑；命令均于 worktree 根执行）

### 2.1 修复后：新增回归文件全绿（4 tests @35s，VITEST_EXIT=0）

```bash
./node_modules/.bin/vitest run apps/yjs-server/test/stdin-error-chain-red.test.ts
# Test Files  1 passed (1); Tests  4 passed (4); Type Errors  no errors
```

### 2.2 RED 基线复核（临时 `git checkout` 还原旧 app.ts 后跑同一文件，再恢复修复）

- 用例 1：`AssertionError: expected 'write-failed' to be 'verify-write-timeout'`（1164ms 快速失败）→ **确定性红**
- 用例 2b：`earlyReplies` 断言得 `[{"id":"f1-down-1","ok":false,"code":"write-failed"}, … ×3]` → **确定性红**（正是 SA7 §2.2 的 ~50ms `write-failed` 签名）
- 断言链条证明：测试对「旧行为 = 快速 write-failed」可红，非 settled-path 摆设。

### 2.3 全量定向套件 ×3 连绿（SA7 §2.5 重验门槛）

```bash
./node_modules/.bin/vitest run apps/yjs-server/test   # ×3 顺序执行
```

| 轮次 | 结果 | 明细 |
|---|---|---|
| run 1 | ✅ EXIT=0 | 7 files / 35 tests 全绿（99.32s） |
| run 2 | ✅ EXIT=0 | 7 files / 35 tests 全绿（100.29s） |
| run 3 | ✅ EXIT=0 | 7 files / 35 tests 全绿（97.96s） |

（6 个既有文件 + 新增 1；含 smoke-skeleton ×3 用例、T6 blocked-recovery、lifecycle-watchdog——F1 竞态窗口内不再出现 ~874ms 快速失败签名。）

### 2.4 类型检查（app 作用域，含新测试文件）

```bash
./node_modules/.bin/tsc -p apps/yjs-server/tsconfig.json   # TSC_EXIT=0（修复前后各 1 次 + 恢复后 1 次）
```

### 2.5 进程泄漏复核

每次套件结束后 `pgrep -af 'yjs-server/src/main.ts'` → 无残留（组杀生效；SA7 §7-O2 教训未复演）。

## 3. 范围与纪律核对

- ✅ 零 `packages/**` 改动（`git diff 4d9fff5..381b9fd --stat` = 仅 app.ts + 新测试文件）；DENY LIST 零触碰。
- ✅ 稳定码注册表零新增：复用 `verify-write-timeout`/`write-failed`（设计 §3.4 append-only）。
- ✅ 生产代码无 env-override/fallback/测试分支（修复为纯运行期重试逻辑，包 API 直调）。
- ✅ 未修改任何既有测试文件（只新增 ALLOW LIST 明列的 `stdin-error-chain-red.test.ts`）。
- ✅ 提交已排除 `wiki/raw/**`（本报告自身作为 SA 产物留在工作区未提交，与历轮惯例一致）。

## 4. 非阻断备注（记账，供 SA4/SA7 知悉）

- **O1（SA7 §7，MINOR，`opRead` 同形快速 `read-failed`）**：**未随本修复改动**——设计 §3.4 对 read 的冻结措辞仅「读取失败 → read-failed」，无 verify-write 同款的「已知集有界等待」契约；read 不属于 F1 阻断范围。若后续轮次认为 read 也应等待物化，属设计扩展（需 SA1/SA2 裁定），不在本轮窄面内。
- 全仓 `pnpm test`/`pnpm typecheck` 未在本轮重跑：SA7 已记录本机线程/进程预算上限（§7-O4）与 dsh 环境形失败，且本 diff 零 `packages/**`；SA7 §2.5 门槛（app 套件 ≥3 连绿 + 定向复现）已在本节满足。真实 CI 裁定仍需推送后观察（SA7 §8 阻塞项，非 SA3 边界）。

**Verdict: 修复完成（fail-needs-fix 已消解；F1 修复面 = `app.ts` 单函数区 + ALLOW LIST 内 1 个新测试文件，提交 `381b9fd`）**。

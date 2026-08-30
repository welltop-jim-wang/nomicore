# SA4 超时范围判定 — issue #172 final run 7×5s 超时与 diff 的因果审查

**Date**: 2026-08-30
**Verdict**: pass（7 个超时**不可归因于 issue #172 diff**；属共享 2 核机器负载饥饿下的环境性抖动）
**审查对象**: `.mabf-bg/issue-172-final.log`（HEAD `d171744`，2026-08-30 02:55:11 起，996.20s，176 文件 / 2043 用例，7 failed）
**审查方式**: 静态依赖/范围判定 + 同代码多运行点对照 + 跨 worktree 复现比对 + 隔离复跑取证（零代码修改）

---

## 0. 结论（先答问题）

**7 个 5 秒超时不可能由 issue #172 diff 导致。** 判定依据四条独立证据链（§2–§5），任何一条单独成立即足以排除，四条相互印证：

1. **静态不相交**：4 个失败测试文件本票零改动；其执行的全部生产代码要么零改动，要么仅注释级改动；diff 中唯一的行为改动（ws-replication 字段改名/缺省值/构造校验）不在任何一个失败测试的 import 传递闭包内。
2. **同代码不同结果**：与本 final run **逐字节相同的被测代码**（`3141884`；final HEAD `d171744` 与其仅差 5 个 wiki 文档文件，+404/−4）在本任务内已有**两次全量 2043/2043 全绿**记录（SA4 复跑 473s、SA7 全跑）；同代码下超时数在 0/2/7 之间随运行时刻漂移。
3. **跨 issue 复现**：issue-138 worktree（不同任务 diff、4 个失败测试文件**逐字节相同**、执行的生产 src 功能等价）在 08-29 21:25 的 rerun 中出现**同款 6 个 5s 超时，其中 5 个与本轮逐字相同**（同文件同用例），且同样伴随 2 个 `[vitest-worker]: Timeout calling "onTaskUpdate"`；而其 20:44 的首次运行（441s）**全绿**。
4. **失败集随负载漂移、不随代码变化**：本轮隔离复跑（仅 4 个文件、03:16、机器 load≈4–6）产生 **10 个**超时——**包含 final run 中通过的 3 个 dsh 用例**（5008–5022ms 压线超时）。失败集合是环境负载的函数，不是代码状态的函数。

---

## 1. 7 个超时的事实清单（final log）

| # | 文件 | 用例 | final 时长 | final run 中同文件通过者时长 |
|---|---|---|---|---|
| 1 | `packages/dsh-persistence/test/dsh-probe-cli.test.ts` | 可复制性：同一命令两次运行 stdout 逐字节一致 | 5077ms | 兄弟用例 3796/4362/4424/4609ms |
| 2 | 同上 | file profile：落盘快照 + 两次运行记录一致 | 5018ms | 同上 |
| 3 | `packages/namespace-registry/test/registry-phase5-replication-red.test.ts` | AC-6 persistence-degraded（Memory 恢复） | 6219ms | 兄弟用例 2–116ms |
| 4 | `packages/namespace-registry/test/registry-phase5-replication-session-red.test.ts` | AC-5 peer persistence-degraded | 8291ms | 兄弟用例 10–91ms |
| 5 | 同上 | 补锚 (a)：hub degraded 拒 raw apply | 7013ms | 同上 |
| 6 | `packages/vfsl-codegen/test/generate-cli-check.test.ts` | generate 后再 --check → 退出 0 | 6540ms | 兄弟用例 3135ms |
| 7 | 同上 | 源漂移后 --check → 退出非零 | 6506ms | 同上 |

伴随证据：**2 个 unhandled error `[vitest-worker]: Timeout calling "onTaskUpdate"`**（vitest 主进程↔worker RPC 超时——宿主机 CPU 饥饿的直接签名，非应用缺陷）；run 级耗时 996.20s（tests 715.60s / collect 112.38s）。

---

## 2. 证据链一：静态依赖不相交（scope 判定核心）

### 2.1 diff 事实（`ef19bae..d171744`，51 文件 +2776/−142）

生产代码改动**全部**枚举如下（`git diff --stat` 逐文件核对）：

| 文件 | 改动性质 |
|---|---|
| `packages/doc-runtime/src/{carrier,extract,materialize,read,replace}.ts` | **各 1 行，全部为文件头注释**（追加「规范权威：ADR-000x」指向；逐 diff 行核对，零可执行行变化） |
| `packages/namespace-runtime/src/replication-session.ts` | **4 行，全部为文件头注释**（同上） |
| `packages/ws-replication/src/{backpressure,defaults,types,validate,index}.ts` | 唯一行为改动：`controlReserveBytes`(64KiB) → `maxQueuedControlBytes`(8MiB) 字段改名 + 缺省值 + 构造期下界校验 |

其余 44 个文件为：ws-replication 测试（改名迁移/叙事修正）、8 个 namespace-registry 测试文件头注释去权威化、2 个 doc-runtime 测试头注释、test-d 类型断言、2 个 docs 文档、12 个 wiki/raw 流水线产物。

### 2.2 失败测试的依赖闭包 vs 改动面

4 个失败测试文件的 import（逐文件核对）：
- `dsh-probe-cli.test.ts` → `node:*` + **子进程 spawn `pnpm exec tsx packages/dsh-persistence/src/cli.ts`**（`dsh-persistence/src` 零改动）
- `generate-cli-check.test.ts` → `node:*` + **spawnSync `pnpm generate`**（`vfsl-codegen`、`vfsl`、`vfsl-protocol` src 零改动）
- 两个 registry red 测试 → `@nomicore/persistence`（零改动）、`@nomicore/namespace-registry/testing`（registry src 零改动）、`@nomicore/namespace-runtime/internal`（`internal.ts` 零改动）、`durable-snapshot-wait.ts` helper（零改动）、`@nomicore/namespace-runtime`（仅 `replication-session.ts` 注释级改动）

**无一 import `@nomicore/ws-replication`**——本票唯一的行为改动对 4 个失败文件完全不可达。被改的共享测试 helper（`registry-seam-audit.ts`）也不被任何失败文件 import（grep 证实）。

### 2.3 Scope Guard 正式结论

- ALLOW LIST 比对（design §7 提取 vs `git diff --name-only`）：**creep = 0**（除 `wiki/raw/` 白名单产物外全部落在 ALLOW）
- DENY LIST：`namespace-registry/src`、`persistence/src`、`dsh-persistence/**`、`replication-protocol/**`、ws-replication 行为文件（liveness/hub-connection/peer-* 等 11 个）、`docs/protocols/`、`CONTEXT.md`——**全部零触碰**（grep 证实）

### 2.4 失败用例的计时结构（为何它们是对负载最敏感的用例）

- **CLI 子进程类（#1/2/6/7）**：每用例 spawn 2 次 `pnpm`→`tsx`→TypeScript 即时编译子进程链，单次调用 2.5–4.6s，vitest 缺省 `testTimeout=5000ms`（`vitest.config.ts` 无任何 timeout/并发配置）→ **设计上零余量**。final run 中单次调用用例以 3796–4609ms 压线通过、双调用用例（两次运行一致性/两阶段 check）全部越线。
- **registry 降级类（#3/4/5）**：`makeMemoryStoreFixture` 用 `createTestScheduler` **虚拟时钟**（`flushAll`=60×`advanceBy(1000)`），`schemaReady`=400 次微任务循环——**零真实 sleep，墙钟时间=纯 CPU**。它们是各自文件里最重的用例（SA3 安静窗口单文件实测 2.8s/3.3s；本轮隔离复跑 7.2–7.9s），同样贴着 5s 线。

---

## 3. 证据链二：同代码不同结果（本任务内 4 个运行点）

被测代码完全等价的四个全量运行点（`3141884` 与 `d171744` 仅差 wiki 文档）：

| 运行点 | 时刻 | 结果 | 耗时 |
|---|---|---|---|
| SA3 首跑（sa3_impl.md §6） | 实现后 | 2041 passed / **2 failed**（session-red 两用例 5s 超时；单文件复跑 22/22 绿，用例各 ≈2.8s/3.3s） | — |
| SA4 复跑（sa4_review.md E7） | R2 复验 | **2043/2043 全绿**；exit 1 仅源自 2 个 vitest-worker RPC 超时 | **473s** |
| SA7 全跑（sa7_report.md §3） | 3141884 | **176 文件 / 2043 用例全绿** + typecheck 0 | — |
| **final run（本轮审查对象）** | 08-30 02:55 | 7 failed | **996.20s** |

final run 比 SA4 全绿那次**慢 2.1 倍**（996s vs 473s）——同一代码、同一命令，唯一变量是运行时刻的机器占用。超时数 0→2→0→7 的漂移与 diff 无关。

## 4. 证据链三：跨 issue 复现（issue-138 worktree）

`/home/wangjian/nomicore-fix-issue-138`（branch `fix/issue-138-on-docs-phase-5-websocket-replication`，不同任务 diff）：

- 08-29 20:44 首跑：**172 文件 / 1997 用例全绿**（441.08s）
- 08-29 21:25 rerun：**4 文件 / 6 用例 5s 超时**（878.91s）+ 2 个 `[vitest-worker]` RPC 超时
- 其超时用例与本轮**逐字相同的 5 个**：dsh-probe-cli「可复制性」「file profile」、replication-red「persistence-degraded」、session-red「peer persistence-degraded」「补锚 (a)」；第 6 个为 generate-cli-check「新鲜生成物 --check」（本轮亦失败）
- 代码关系（逐文件 diff 核对）：4 个失败测试文件在两 worktree **逐字节相同**；其执行的生产 src（`dsh-persistence/src`、`persistence/src`、`namespace-registry/src`、`namespace-runtime/src/internal.ts`）**全部相同**；唯一差异 `replication-session.ts` = 本票 4 行注释

不同 diff、相同测试、相同机器、不同时刻 → 同款超时：超时是**机器与时刻**的属性，不是任何一个 diff 的属性。

## 5. 证据链四：宿主机负载证据（final run 窗口内）

- **机器仅 2 核**（`nproc`=2）；vitest 无并发/timeout 调优，缺省按核数并行 176 个文件，其中 `validate-snapshot-sa7`(212s)、`validate-patch-sa7`(209s) 两个纯 CPU 大户独占核心约 7 分钟（两者均不在本票 diff 中）
- final run 窗口 02:55:11–约 03:11:47；**03:14:54 采样 load average = 3.78 / 5.30 / 5.69**——5 分钟均值 5.30 覆盖 03:09:54–03:14:54，**落在 final run 尾段内**，即 2 核机器在该窗口被超订 2.6 倍
- 当前机器仍有**其他 agent 会话的外来进程**在竞争 CPU（3 个 ~60% CPU 的 `grep -RIl`、`node --import`、a2a-session shell），佐证共享宿主机的常态超订
- 本轮隔离复跑（03:16:37，仅 4 文件）在 load≈4–6 下产生 **10 个**超时（dsh ×5 含 final run 通过的 AC4 完整性 5022ms、异常输入 5008/5011ms；generate ×2 6881/7681ms；session-red ×2 7848/7895ms；red ×1 7175ms）——**负载越高失败集越大且集合本身漂移**

（隔离复跑命令：`setsid nohup pnpm exec vitest run <4 文件>`，日志 `/tmp/sa4-timeout-scope.log`，exit 1；零代码修改。）

---

## 6. 审查清单结论（SA4 静态验尸口径）

1. 设计一致性：✅ 本票 diff 落在 design §7 ALLOW LIST 内（creep=0），DENY 全净
2. 读写路径一致性：N/A（本票无数据流改动；唯一行为改动是 ws-replication limits 字段改名，读写同源）
3. 静默失败：✅ 无新增路径（7 个超时均为环境性 wall-clock 超限，非断言失败、非应用 unhandled rejection）
4. 降级方案：N/A
5. 极端攻击：本票 diff 对 4 个失败文件的执行路径不可达（§2.2），无攻击面
6. 错误处理：N/A
7. 架构评估：✅ 无需退回 SA1
8. 过度设计：✅ N/A

## 7. 建议路由

1. **不回流 SA3 / SA1**：7 个超时与本票 diff 无因果关系；任何实现改动都无法消除环境性 CPU 饥饿，回流只会制造假动作。
2. **另立基建票（建议归口：SA6/测试所有者 + 总控排程）**，与本票 SA4 N3 / SA7 §3 既定处置一致（"若复现基建超时，另立票处理，不回流本票"）：
   - 为 CLI 子进程类测试（`dsh-probe-cli`、`generate-cli-check`、`schema-check-cli`、`dsh-file-probe-determinism` 等）与重负载 registry 降级用例设置 per-test timeout（如 30–60s）或在 `vitest.config.ts` 全局调高 `testTimeout`；
   - 或对 spawn 密集文件限制并行（`fileParallelism`/`maxWorkers`/独立 pool），避免 2 核共享机器上与其他 agent 会话互相挤压；
   - 排程侧：final 全量跑尽量单占机器窗口。
3. **本票复验口径（固定复验范围）**：安静窗口单占机器复跑全量（或先 4 文件）取得绿记录即可收口；同等效力的既有证据 = SA4（473s 全绿）与 SA7 在**同一被测代码**上的两次全量 2043/2043 绿记录（final HEAD 仅差 wiki 文档，不改任何被测行为）。
4. **CI 侧**：发布产生 PR run 后按 SA7 N3 既定动作确认 GitHub runner `pnpm test` 全绿；若 runner 复现同形超时，基建票升级处理。

## 8. 动态审核重点（交 SA7）

1. PR 发布后 CI runner（node 20/24 matrix、独占资源）上 `pnpm test` 是否全绿——环境性超时在独占 runner 上应消失（若复现则推翻本判定，回流重审）。
2. （基建票成立时的验收）`testTimeout` 调整后 4 个文件在满负载下的稳定性抽样。

---

### 附：证据可复现命令

```bash
WT=/home/wangjian/nomicore-fix-issue-172
git -C $WT diff --name-only ef19bae..HEAD                       # 51 文件清单
git -C $WT diff ef19bae..HEAD -- 'packages/*/src/*.ts'          # src 改动全量（注释为主）
git -C $WT diff --name-only 3141884..d171744                    # final HEAD 仅 wiki 文档
diff /home/wangjian/nomicore-fix-issue-138/packages/namespace-runtime/src/replication-session.ts \
     $WT/packages/namespace-runtime/src/replication-session.ts  # 4 行注释
grep -c "Test timed out in 5000ms" $WT/.mabf-bg/issue-172-final.log   # 7
grep -c "Test timed out in 5000ms" /home/wangjian/nomicore-fix-issue-138/.mabf-bg/issue138-final-rerun-test.log  # 6
nproc; uptime                                                   # 2 核；final run 窗口 load 5.30（5min 均值）
# 隔离复跑日志：/tmp/sa4-timeout-scope.log（10 failed / 48，失败集含 final run 通过者）
```

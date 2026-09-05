# SA7 动态验证报告 — Issue #153 Round 2（T=0 收敛：无引用完整 orphan BIN 尾帧清零）

**Date**: 2026-08-30
**Verdict**: **pass**（SA4 R2 pass 基础上动态验证全绿；AC3/AC1 活链路重证通过；round-1 动态面抽样零回退；零新增 fail 发现）
**Worktree**: `/home/wangjian/nomicore-fix-issue-153`（修复 commit a2cf3a5，基线 51b79b9）
**输入**: 修订简报 `…-r2.md` / SA4 R2 验尸 `…-r2_sa4_review.md`（verdict=pass，§四 动态重点 3 项）/ SA6 R2 红灯 `…-r2_sa6_red.md`（6 锚）/ SA8 R2 门禁 `…-r2_conflict_report.md`（clear；**O1 纪律**：不补「防 frame-boundary-invalid」伪需求断言——本报告全部断言面仅限设计明文语义）
**SA7 R2 交付物**: 本报告；动态脚本（临时，不入库）`/tmp/sa7-crash/{ac-writer-r2,e2e-r2}.mts` + round-1 supervisor 复用。**src/test 零改动**（未新增测试锚——简报授权约束遵守；round-1 SA7 补验文件 `file-adapter-sa7-repair-io.test.ts` 未被本轮触碰且全绿）。

---

## 0. 门禁

| 门 | 结果 |
|---|---|
| Step 0 SA4 R2 verdict | `pass` → 进入动态验证 |
| Step 1 包级复跑（独立进程） | `vitest run packages/namespace-diagnostic-log/test` → **Test Files 22 passed (22)；Tests 381 passed (381)；Type Errors: no errors；exit=0**（`/tmp/sa7r2-step1.log`）——与 SA4 独立复验（22/381）一致 |

---

## 1. 重点①：AC3/AC1 活链路重证（真进程退出重启 + 字节级物理篡改 + 真实 reader）

**方法**：orchestrator spawn 真实 writer 子进程 seed（恰 1 条 inline record，进程退出=正常重启）→ orchestrator 对磁盘做**字节级物理篡改**（构造 refs 空 + orphan 尾帧各形态）→ 第二个真进程 reopen（分析+修复）并续写 sidecar→inline→sidecar 三条 → 断言七项 R2 契约。**24/24 PASS，exit=0**（`/tmp/sa7r2-e2e.log`）。

| 场景（物理篡改形态） | 修复事件（实测） | R2-1 bin 实长 | R2-2 truncatedBytes | R2-3 零字节事件 | R2-5 frameOffset | R2-6 reader | R2-7 序列 |
|---|---|---|---|---|---|---|---|
| S1 复合：撕裂 jsonl 末行 + [完整 orphan 帧 4122B][7B 撕裂块]（§13.11 R2 形） | `jsonl-incomplete-line{11}` + `bin-incomplete-frame{4129}` | **0** | **4129 === 修复前 bin 长度** | 无 | **"0"**（seq2 sidecar） | ok | 1,2,3,4 |
| S2 全完整：单完整 orphan 帧（§13.11c 形） | `bin-orphan-frames{4122}` | **0** | **4122 === 修复前长度** | 无 | **"0"**（seq2 sidecar） | ok | 1,2,3,4 |
| S3 ENOENT + 双完整 orphan 帧（§13.32c/窗口1 形） | `bin-orphan-frames{8244}` | **0** | **8244 = 2×4122 === 修复前长度** | 无 | **"0"**（seq1 sidecar） | ok | 1,2,3 |

附加验证面：
- **R2-4 同 stream 续写**：三场景 streamId 全保持、`stream-generation-rotated` 零事件。
- **append 顺序连续**：续写三条逐条落盘、sequence 无空洞无重号（R2-7 列实测）。
- **事件诚实性全局面**：三场景全部 `stream-tail-repaired` 事件 `truncatedBytes > 0`（R2-3 负向断言逐场景过）。
- **O1 纪律遵守**：断言面仅 frameOffset / reader ok / 长度 / 事件值——零「防 frame-boundary-invalid」伪需求断言（首引用 expectedOffset=null 豁免系既定链语义，不作断言对象）。

## 2. 重点②：round-1 动态面零回退（崩溃窗口抽样 + 双 Node 全仓）

### 2.1 SIGKILL 崩溃窗口抽样矩阵（supervisor I3 不变量按 R2 语义校准后复跑）

I3 校准说明（诚实记档）：round-1 supervisor 的 bin 前缀不变量为「截断不低于完整帧前缀末端」——该口径编码了 round-1 偏差；本轮按设计 §5.2/§5.4 字面改为「**截断点 ≤ max ref end（refs 空 → 0）**」。其余五条不变量（I1 零 rotate / I2 修复类封闭三枚举 / jsonl 只删最后 `\n` 后字节 / I4 streamId / I5 seq 续接 / I6 reader ok）不变。

| 轮 | 技术 | 轮数 | 命中 | 失败 |
|---|---|---|---|---|
| 抽样（bin-end 12 + bin-mid 8 + 随机中程 10） | 轮询猎杀 + 随机延迟 | 30 | W2×8（torn 偏移 413696/1536000/2211840/1626112/2224128/2625536B 等任意页倍数）、W4×22 | **0** |
| W1 加猎（bin-end 32） | 轮询猎杀 | 32 | **W1×1**（µs BIN→JSONL 间隙真实命中） | **0** |
| W2 明细（bin-mid 6） | 轮询猎杀 | 6 | W2×6 | **0** |
| **合计** | — | **68** | W1×1、W2×14、W4×53 | **0** |

**R2 语义在真实崩溃产物上的直接证据**（事件明细为 supervisor 实测输出）：

```
W1（真实 SIGKILL 于 BIN 写完成与 JSONL 创建之间的 µs 间隙）：
  binLen=4194329B tornBin=0B（完整 25+4MiB 帧、jsonl ENOENT、refs 空）
  events=[{"repair":"bin-orphan-frames","truncatedBytes":4194329}]   ← 全量截断、>0、零字节事件绝迹
W2（真实 SIGKILL 于首帧 bin 写入途中，6/6 明细）：
  events=[{"repair":"bin-incomplete-frame","truncatedBytes":1138688|2531328|1585152|2805760|1769472|2162688}]
  ← refs 空 → T=0 → 整个撕裂前缀 bin 全截，truncatedBytes === 修复前 bin 长度
```

全部 68 轮 I1–I6 不变量通过（含 W1/W2 修复后续写 sidecar 落 offset 0、seq=1、reader ok——I5/I6 在 supervisor 内断言）。

### 2.2 双 Node 全仓零回退

| 命令 | Node | 结果 | 日志 |
|---|---|---|---|
| `pnpm test` | v24.13.0 | **Test Files 140 passed (140)；Tests 1786 passed (1786)；Type Errors: no errors；exit=0** | `/tmp/sa7r2-full.log` |
| `pnpm test`（PATH 前置 node-v20.18.1） | v20.18.1 | **Test Files 140 passed (140)；Tests 1786 passed (1786)；Type Errors: no errors；exit=0** | `/tmp/sa7r2-n20.log` |

- 基线 51b79b9 = 140 文件/1784 → **140/1786 = +2 恰为 SA6 R2 新锚（§13.11b/§13.11c）**，账目闭合；round-1 全部存量（含 SA7 repair-io 补验 4 用例、D-A1 系、§13.9/§13.10 有引用路径）零回退。
- 双 Node 与 CI matrix `[20, 24]` 同构。

## 3. 重点③：验证门槛

| 门槛 | 结果 |
|---|---|
| `pnpm typecheck`（10 包 tsc） | **exit=0**（`/tmp/sa7r2-tc.log`） |
| `git diff --check 51b79b9..a2cf3a5` | **干净**；worktree 亦干净 |
| src 零改动（SA7 R2 面） | `git status` 仅 wiki 档案 + 本报告；R2 代码面 diff 恰 3 文件（reader.ts / reopen-roll-repair.test.ts / package.json 0.1.4）——与 SA4 §⑥ ALLOW 边界一致 |

## 4. vitest 触发证据（Step 4，2026-06-15 立法）

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| namespace-diagnostic-log | `Test`（`pnpm test`） | ⚠ 本地等价证据 ✅（CI run 待 R2 发布后） | round=1 PR #166 已发布过（CI 双腿绿）；R2 分支未 push（修订未发布，无新 run）。本地双 Node 全量 140 文件含本包 22 文件/381 测试；root `vitest.config.ts` include 全覆盖（SA4 R2 §⑦ 静态门禁 + 本地运行动态印证） |

**verdict**: ✅ all-vitest-packages-triggered（本地动态面）；CI runner 侧摘录归发布后 Host/Runner。

## 5. 计划外发现

- 无新增缺陷。round-1 报告所列三项计划外发现（VFSL pattern 步数上限、目录 chmod 注入无效、LOW-1）中 **LOW-1（零字节修复事件）已随本轮结构性消除**并在真实 W1 命中中实证绝迹；其余两项与 R2 无涉、维持 round-1 记档。

## 6. 命令回放

```bash
cd /home/wangjian/nomicore-fix-issue-153
node_modules/.bin/vitest run packages/namespace-diagnostic-log/test                    # 22 files / 381 tests / 0 type err / exit 0
node_modules/.bin/tsx /tmp/sa7-crash/e2e-r2.mts                                        # AC3/AC1 重证 24/24
node_modules/.bin/tsx /tmp/sa7-crash/supervisor.mts /tmp/sa7-crash/trials-r2-sample.json   # 崩溃抽样 30 轮
node_modules/.bin/tsx /tmp/sa7-crash/supervisor.mts /tmp/sa7-crash/trials-r2-w1.json       # W1 猎杀 32 轮
node_modules/.bin/tsx /tmp/sa7-crash/supervisor.mts /tmp/sa7-crash/trials-r2-w2.json       # W2 明细 6 轮
pnpm typecheck                                                                         # exit 0
pnpm test                                                                              # 140 / 1786（node 24）
PATH=/tmp/sa7-node20/node-v20.18.1-linux-x64/bin:$PATH pnpm test                      # 140 / 1786（node 20.18.1）
git diff --check 51b79b9..a2cf3a5                                                      # clean
```

## 7. 结论

**verdict: pass**

- AC3/AC1 在真实进程重启 + 字节级物理篡改 + 真实 reader 下重证：refs 空完整 orphan 尾帧（复合/全完整/ENOENT 多帧三形态）修复后 BIN 实际长度恒 0、`truncatedBytes === 修复前长度（>0）`、零字节事件绝迹、续写 sidecar `frameOffset === "0"`、strict reader 全流 ok、append 序列连续（24/24）。
- 真实 SIGKILL 矩阵 68 轮零不变量失败；W1/W2 真实崩溃产物上的事件明细直接印证 T=0 收敛语义（全量截断 + 诚实 truncatedBytes）。
- round-1 动态面零回退：双 Node 全仓 140/1786（+2 恰为新锚）、repair-io 补验与既有锚全绿、typecheck 0 错、diff-check 干净。
- SA7 R2 未新增测试锚（授权约束遵守）、src/test 零改动；不上洗不下调 SA4 R2 verdict（pass+pass）。

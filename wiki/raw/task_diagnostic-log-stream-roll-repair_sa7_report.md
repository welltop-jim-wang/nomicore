# SA7 动态验证报告 — Issue #153 Reopen streams, roll segments, and repair provable tails

**Date**: 2026-08-29
**Verdict**: **pass**（SA4 pass 基础上动态验证全绿；5 项动态清单逐条闭环；AC1–AC5 活链路实证通过；零新增 fail 发现）
**Worktree**: `/home/wangjian/nomicore-fix-issue-153`（commit 3536360，基线 8611e68）
**输入**: 任务简报 / SA4 静态验尸（`…_sa4_review.md`，verdict=pass，§三 动态清单 5 项）/ SA1 设计定稿 / SA6 红灯报告
**SA7 交付物**:
- 本报告 `wiki/raw/task_diagnostic-log-stream-roll-repair_sa7_report.md`
- 补充测试 `packages/namespace-diagnostic-log/test/file-adapter-sa7-repair-io.test.ts`（4 用例，SA4 §三.1/LOW-3「repair-io-failure 零覆盖」补验）
- 动态驱动脚本（临时，不入库）：`/tmp/sa7-crash/{driver,supervisor,e2e-ac,ac-writer,large-stream}.mts`

---

## 0. Step 0/Step 1 门禁

| 门 | 结果 |
|---|---|
| Step 0 SA4 verdict 校对 | `sa4_review.md` 顶部 `**Verdict**: pass` → 允许进入动态验证 |
| Step 1 SA6 红灯面复跑 | `node_modules/.bin/vitest run packages/namespace-diagnostic-log/test`（独立后台进程）→ **Test Files 21 passed (21)；Tests 375 passed (375)；Type Errors: no errors；exit=0**（`/tmp/sa7-step1.log`，8.43s）——与 SA4 独立复验一致 |

---

## 1. SA4 §三 动态清单逐条回复

### 1.1 `repair-io-failure` 路径零测试覆盖 → ✅ 已动态补验（新增 4 用例全绿）

**注入选型修正（对 SA4 建议「chmod 555 目录」的实证纠正）**：POSIX 下 truncate 既存文件只需**文件自身写位**，不需目录写位。实测（node v24.18 内建 fs，uid 1000）：

```
dir 0555 + file 0644 → truncate OK（目录写位不需要）
file 0444 → truncate ERR（EACCES，注入有效）
```

故可靠注入 = **待截断文件 chmod 0444**（分析阶段只读不受影响，截断点 open(O_WRONLY) 得 EACCES）；目录 555 注入会静默不触发。

**新增测试文件** `test/file-adapter-sa7-repair-io.test.ts`（4 用例，全部 PASS，`--typecheck` 0 错，`/tmp/sa7-rio.log`）：

| 用例 | 断言要点 | 结果 |
|---|---|---|
| S7-R1 C1 目标 jsonl chmod 0444 | 恰一次 `stream-generation-rotated{cause:'repair-io-failure'}` + 零 `stream-tail-repaired` + 旧文件字节恒等（mode 仍 0444）+ 新 generation 承接 emit（seq 1）+ 新流 reader ok + 旧流 reader corrupt（历史未改写） | ✅ |
| S7-R2 C2 目标 bin chmod 0444 | 同上（bin 字节恒等） | ✅ |
| S7-R3 C1 成功 + C2 失败复合 | **前序修复保留**：恰一次 `stream-tail-repaired{jsonl-incomplete-line}`（截断真实落盘）+ 恰一次 rotated{repair-io-failure} + bin 恒等 + 旧 stream 零续写 + 新流承接 | ✅ |
| S7-R4 权限恢复后重开 | 同一 tail 现可修复（`repair-io-failure` 非粘性终态；显式 resumeStreamId 回原流 → 健康 resume + seq 2 + reader ok） | ✅ |

用例带 `it.skipIf(uid===0)` 护栏（root 下 EACCES 不成立时显式 skip 而非假绿）。

### 1.2 非 root 运行身份下 EACCES 有效性 → ✅ 成立（本地 uid 1000 实测 + runner 文档）

- 本机：`id -u` = **1000（wangjian）**——§13.32b（chmod 000 bin → EACCES 保守 rotate）与上述 0444 注入在本机真实生效，包级 375/375 绿即含 §13.32b/§13.32a。
- CI：本分支**尚未 push**（本地 ahead 1，无 PR/无 run），无法从 `gh run` 日志直接摘取 runner `id -u`（尝试拉取既有 run 日志：jobs/logs API 返回空/404，留存已过期）。替代证据：
  - `.github/workflows/ci.yml`：`runs-on: ubuntu-latest`（GitHub-hosted）——官方 runner 镜像以**非 root 用户 `runner`（uid 1001）**执行 job（[actions/runner-images #10936](https://github.com/actions/runner-images/issues/10936)：runner 用户 uid 1001 变更公告，佐证恒为非 root 专用账户）；
  - #152 分支既有 CI run（33193349672 等 6 run）全绿，其测试面含同款 EACCES/EISDIR 注入路径；
  - 我的补充测试在 root 环境显式 skip（不会假绿），发布后 CI 若出现 skip 会直接可见。

### 1.3 真实崩溃窗口（kill -9）而非磁盘写模拟 → ✅ 322 轮真实 SIGKILL 矩阵，0 不变量失败

**方法**：supervisor（独立 tsx 进程）spawn 真实 writer 子进程连续 emit（真实 `createFileDiagnosticLog` + 交替 inline/sidecar payload），按进程组 `kill -9`，对磁盘残骸做物理分类后**以新进程全新构造 reopen**，断言六条不变量（I1 零 rotate / I2 修复类 ∈ 封闭三枚举 / I3 截断点前缀字节恒等（jsonl 只删最后 `\n` 后字节、bin 不越过引用帧末端）/ I4 streamId 保持 / I5 续写 seq=已提交+1 / I6 reader 终态 ok）。

两代猎杀技术：随机延迟（162 轮）+ **跨进程文件尺寸轮询猎杀**（supervisor 侧 stat 观测 page-cache 逐页尺寸增长，命中窗口即杀——160 轮；进程内定时对同步 emit 无效，因 emit 阻塞事件循环）。

**结果**（全部日志 `/tmp/sa7-crash-{smoke3,full,r2,r3,hunt,hunt2}.log`，各轮 exit=0）：

| 轮 | 技术 | 轮数 | 真实窗口命中 |
|---|---|---|---|
| full/r2/r3 | 随机延迟 | 86+76+60 | bin-torn-mid ×2、orphan-mid ×1 |
| hunt/hunt2 | bin-mid / bin-end / jsonl-mid 轮询猎杀 | 69+28 | **W2 ×22**、**W1 ×3** |
| 合计 | — | **322**（含冒烟 3） | **28 个真实撕裂/窗口终态**，**322/322 不变量全过** |

窗口分类账（部分轮合计）：`W2:jsonl-ENOENT+torn-frame ×22`、`W1:jsonl-ENOENT+orphan-complete-frames ×3`、`bin-torn-mid ×2`（已提交行后撕裂帧 → C2 修复）、`orphan-mid ×1`（**BIN→JSONL µs 间隙真实命中**：完整 orphan 帧越过引用末端 → C3 修复）、`W4:clean-stop` 多轮（零修复健康续写）。每命中轮的修复事件、seq 续接与 reader ok 均在断言内验证（例：W1 轮 `binLen=4194329B`（恰 25+4MiB 完整帧）+ jsonl ENOENT → `bin-orphan-frames` 修复 → 续写 seq 1 → reader ok）。

**真实撕裂 ≡ 模拟夹具假设的验证**：W2 真实撕裂偏移实测 `274432/491520/724992/1015808/1351680/1368064/1937408/2936832B`——全部为**任意 4KiB 页倍数**（fatal-signal 在 `generic_perform_write` 页循环边界中断写回的内核语义），与 SA6 夹具的整洁 7B 撕裂形态迥异；修复机制对任意偏移全部正确收敛（truncate 至可证明边界、字节前缀恒等、reader ok）——模拟夹具是真实撕裂产物空间的真子集，等价性成立。

**W3（line-torn）单独说明（诚实记档）**：随机延迟与 jsonl-mid 轮询均未真实命中——jsonl 行宽受 VFSL Pattern 引擎步数上限约束（实测 inline payload ≤131072B 可过、≥262144B 被 `vfsl-validation-failed{$.result.update.base64}` 拒绝，行宽 ≤~180KB，单次 append ~0.1ms，占 emit 周期 ~0.3%），物理窗口 µs 级、本机不可靠竞速命中。等价性由三面覆盖：① 同一 appendFileSync 中断语义已在 bin 侧被 22×W2 真实证明（同 syscall 族、同页粒度撕裂）；② 修复机器同族（C1 = 截到最后 `\n`+1，即同一 append 的逆过程）；③ 跨进程物理撕裂 E2E S4a（真实字节截断 + 真实 reopen 修复 + seq 续接，见 §2）。

### 1.4 构造期 O(stream) 同步扫描量级 → ✅ 实测（线性；Host 接线面记档）

真实 writer 构建 + 真实 reopen（`/tmp/sa7-big.log`）：

| 规模 | 段数 | 构建 | **reopen 构造（全量交叉扫描，构造函数内同步）** | reader 全量 | 重启后 emit | streamId | rotate |
|---|---|---|---|---|---|---|---|
| 132.0 MiB | 3 | 1301ms | **841ms（≈157 MiB/s）** | 845ms | 3.8ms | 保持 | 0 |
| 196.0 MiB | 4 | 1801ms | **1166ms** | 1177ms | 1.9ms | 保持 | 0 |

- 规模 +48% → 构造 +39%：**线性 O(stream) 成立**，无超线性放大；重启后首条 emit 毫秒级（种子装配无劣化）。
- 记档（归 #149–151/#155）：默认 targets（jsonl 64MiB/bin 256MiB）下单段满载 ~256MiB 扫描约 1.6–1.8s，多段累加；README/AGENTS 已记档「Host 必须在 write-slot 外构造」（SA4 §12 核验过），长流场景 Host 需把构造预算纳入 slot 调度。

### 1.5 全仓 `pnpm test` + `pnpm typecheck` 复绿 → ✅ 双 Node 版本全绿

| 命令 | Node | 结果 | 日志 |
|---|---|---|---|
| `pnpm typecheck`（10 包 tsc） | v24.13.0 | **exit=0** | `/tmp/sa7-typecheck.log` |
| `pnpm test`（vitest run --typecheck 全量） | v24.13.0 | **Test Files 140 passed (140)；Tests 1784 passed (1784)；Type Errors: no errors；exit=0** | `/tmp/sa7-full-test.log` |
| `pnpm test`（PATH 前置 node-v20.18.1） | v20.18.1 | **Test Files 140 passed (140)；Tests 1784 passed (1784)；Type Errors: no errors；exit=0** | `/tmp/sa7-n20-test.log` |

- 基线对比：8611e68 = 138 文件/1719 测试 → SA3 交付 139/1780（SA4 口径）→ **+1 文件/+4 测试恰为本 SA7 补验文件**（139+1=140、1780+4=1784），对账闭合。
- 双 Node 20/24 与 CI matrix `[20, 24]`（`.github/workflows/ci.yml`）同构；本地双版本全绿。
- `git diff --check` 干净；`git status` 仅 `wiki/raw/*` 与本 SA7 测试文件，**src 零触碰**。

---

## 2. AC1–AC5 活链路实证（多进程 E2E：真实 writer/reader + 物理篡改 + 重启矩阵）

编排器 spawn 独立 tsx writer 子进程（**真进程退出 = 正常重启**），自身仅做字节级物理篡改与断言：**74/74 PASS，exit=0**（`/tmp/sa7-ac.log`）。

| AC | 场景（独立 namespace） | 断言（全部 PASS） |
|---|---|---|
| **AC1** | S1 健康重启 ×2（A 写 3 条退出 → B 续 2 → C 再续 2） | B/C streamId==A；B 首条 seq=4、C 首条 seq=6；全序 [1..7]；current.json 指向该流；零修复零 rotate；reader ok |
| **AC2** | S2 滚动跨重启（records target=2）；S3 边界（恰达 target 下一条前滚）；S3b 超大单条独占新组（jsonl target=100B） | 三段固定编号 1..3；组不拆对（bin ⊆ jsonl 段集；无 sidecar 段可无 .bin=惰性创建）；闭段恰 2 条=target；跨重启全序 [1..6]；B 首条落 00000002；逐条成段 + reader ok |
| **AC3** | S4a 撕裂末行（真实字节截断）；S4b refs 后撕裂 orphan 帧；S4c 完整 orphan 帧；S4b0 撕裂**被引用**帧 | S4a：C1+C3 级联（末行撕裂→其帧成未引用残渣，零字节残渣保留=LOW-1 语义）+同流续写 seq 2 + reader ok；S4b：`bin-incomplete-frame` 修复+seq 3；S4c：`bin-orphan-frames`+seq 3；S4b0：**撕裂被引用帧=中间损坏→corrupt rotate 零修复**（计划外固化验证） |
| **AC4** | S5 物理篡改矩阵：CRC 翻位 / 删中间行（sequence gap）/ 未知 frameVersion 尾帧 / 17 键篡改指纹 / 14 键 legacy / 冻结配置变更 | 每场景恰一次 rotated{stream-corrupt / stream-corrupt / stream-incompatible / stream-incompatible / legacy-manifest / frozen-policy-mismatch}+零修复+旧流 segments/manifest 字节恒等+新 generation 承接（seq 1、reader ok）+旧流 reader 按语义（corrupt/corrupt/ok/incompatible/ok） |
| **AC5** | S6a current.json 坏 JSON；S6b 删 locator+2 候选；§1.3 kill -9 矩阵 | S6a：重扫恢复同流续写 seq 3；S6b：`stream-init-failed{locator-ambiguous}`+文件数恒等（零写入）+emit 丢弃；崩溃窗口矩阵见 §1.3（W1/W2/W4 + bin-torn/orphan 真实命中 322 轮全绿） |

（AC2 补充：耗尽双路径 `exhaustedAtOpen('sequence'/'segment')`、`99999999` 段溢出不回绕、`invalid-roll-targets` 配置门由 SA6 锚 §13.26–28 在包级 375 内活链路覆盖，本节不重复构造。）

---

## 3. Spec 触发证据（Step 3，2026-06-09 立法）

本票设计/交付**无 `*.spec.ts`**（SA4 §1.3 N/A 复核一致）——表空，`spec-not-triggered` 不适用。

## 4. vitest 触发证据（Step 4，2026-06-15 立法）

| Workspace Package | CI Step Name | 触发结果 | 证据 |
|---|---|---|---|
| namespace-diagnostic-log | `Test`（`pnpm test`） | ⚠ 本地等价证据 ✅（CI run 待发布后） | 本分支未 push（无 PR/run）。本地双 Node 全量 `Test Files 140 passed (140)` 含本包 22 文件 379 测试（375 SA6 面 + 4 SA7 补验）；root `vitest.config.ts` include=`packages/*/test/**/*.test.ts` 全覆盖（SA4 §1.4 静态门禁 + 本地运行动态印证） |
| （全包） | `Typecheck` | 同上 | `pnpm typecheck` exit=0（10 包） |

**verdict**: ✅ all-vitest-packages-triggered（本地动态面）；CI runner 侧动态摘录归发布后 Runner/Host 观测（SA7 无 push 权责）。

---

## 5. 计划外发现（均非阻断、非 #153 缺陷）

1. **VFSL Pattern 引擎对超长 inline base64 的步数上限（#148/#152 既有面）**：实测 inline payload ≥262144B 被 `vfsl-validation-failed{$.result.update.base64}` 拒绝（≤131072B 可过）；memory adapter 与 file adapter 判定面一致（file 路径 bisect：131072 COMMITTED / 262144 REJECTED）。后果有二：① 真实 torn-jsonl 崩溃窗口 µs 级（见 §1.3 W3 说明）；② 大 update 恒走 sidecar（符合 ADR inline 阈值本意）。建议后续票在 README 记档该实际上限。
2. **注入精度**：目录 chmod 0555 无法阻断 truncateSync（POSIX 只查文件写位）——SA4 §三.1 建议的目录注入不可靠，已按文件 0444 修正并固化进补验测试头注。
3. **LOW-1 语义实测吻合**：真实 W1 命中轮输出 `bin-orphan-frames` 零字节修复事件（§13.29 窗口1 锚定行为），与 SA4 记档一致。

## 6. 残留与移交

- CI runner 侧动态证据（`gh run` log 摘录 + runner `id -u`）：本分支未 push，**待发布后由 Host/Runner 补录**；本地等价面已全绿（§1.2/§1.5/§4）。
- 构造期扫描量级记档移交 #149–151/#155（§1.4 数据）。
- `repair-io-failure` 补验测试已入 CI 面（root 环境显式 skip 护栏）。

## 7. 命令回放

```bash
cd /home/wangjian/nomicore-fix-issue-153
node_modules/.bin/vitest run packages/namespace-diagnostic-log/test                 # 375/375 + 0 type err
node_modules/.bin/vitest run packages/namespace-diagnostic-log/test/file-adapter-sa7-repair-io.test.ts --typecheck  # 4/4
pnpm typecheck                                                                     # exit 0（node 24）
pnpm test                                                                          # 140 files / 1784 tests（node 24）
PATH=/tmp/sa7-node20/node-v20.18.1-linux-x64/bin:$PATH pnpm test                   # 140 files / 1784 tests（node 20.18.1）
node_modules/.bin/tsx /tmp/sa7-crash/supervisor.mts /tmp/sa7-crash/trials-hunt2.json   # kill -9 矩阵（轮询猎杀）
node_modules/.bin/tsx /tmp/sa7-crash/e2e-ac.mts                                     # AC E2E 74/74
node_modules/.bin/tsx /tmp/sa7-crash/large-stream.mts                               # O(stream) 量级
git diff --check                                                                   # clean
```

---

## 8. 结论

**verdict: pass**

- SA4 五项动态清单全闭环：repair-io-failure 补验 4/4、EACCES 非 root 有效性实证、kill -9 真实崩溃矩阵 322 轮 0 失败（W1×3/W2×22/orphan-mid×1/bin-torn-mid×2/W4 若干，真实页粒度撕裂≠夹具整洁撕裂且全收敛）、O(stream) 线性实测、全仓双 Node 复绿。
- AC1–AC5 逐条活链路（多进程真实 writer/reader + 字节级物理篡改 + 真实重启矩阵 + 真实 SIGKILL）74/74 全 PASS；三次编排器预期偏差均为产品正确行为（组级滚动惰性 bin、撕裂行级联 C3、撕裂被引用帧=中间损坏 rotate），已固化为正向断言。
- 无新增 fail 项；计划外发现三项均记档非阻断。SA7 不下调/不上洗 SA4 verdict（pass+pass）。

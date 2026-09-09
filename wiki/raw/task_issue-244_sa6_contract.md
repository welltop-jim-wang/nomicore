# SA6 验收契约与红灯证据 — Issue #244（issue #233 切片 3）— iteration 1 修订（SA4-2 跨字段链生效口径收口）

- Dispatch：`sa-ebf76d12-bba9-4f8d-bab6-3074cef1ccea`（mabf-sa6 / acceptance-contract / iteration 1）
- 对象：issue #244「ws-replication：分块传输有界性加固与中止清理矩阵（issue #233 切片 3）」
- 本 iteration 工作 = 按 SA1 修订设计（`wiki/raw/task_issue-244_design.md` §7-D1/§12，2026-09-09 20:32 修订）与 SA8 设计复审（`artifacts/sa8-conflict-gate-issue-244-design-recheck.md`，clear，R15–R19）更新可执行验收契约：**补 R1c 红灯守卫 + N5/N6 绿负控**，锁 SA4-2 收口的「分块族链上键显式表达门」语义；保留 iteration 0 已批准的全部用例与行为（断言零改动）。
- 工作区：worktree `nomicore-fix-issue-244`，分支 `mabf/issue-244`，HEAD `e2178f3`；运行对象 = 实现基线树（SA3 iteration 0 全量落地 + iteration 1 SA4-1 槽位归还修复，未提交工作树）。
- 结论：**approve** —— SA4-2 语义缺口证据可信、补例契约可执行、红灯失败点恰在缺口断言（现行单键门）、负控全绿、测试入口真实、已批准行为零回归。

## 1. Task type and inputs

- 任务类型：**Feature 契约修订**（SA1 设计修订后的验收契约增量；不虚构 Bug 根因——R1c 红 = 现行实现与修订口径间的**能力缺口守卫**，红灯允许先于修复存在）。
- 输入清单（按 dispatch 指令实读）：
  - Host 简报 `wiki/raw/task_issue-244.md`（AC1–AC7；`## Comments` 空）。
  - Dispatch 快照 `wiki/raw/task_issue-244_dispatch.md`：`issue-comments: none (REST [])`。
  - SA1 修订设计 `wiki/raw/task_issue-244_design.md`：§7-D1（链生效口径裁决 + 边界语义表 + 被否方案）、§12（契约补例 R1c/N5/N6 定义与路由 = owner/SA6 dispatch，SA3 禁触冻结文件）、§11 ★ 行（门放宽 = hub/peer 构造器 + validate.ts 注释 + 协议 §17 口径句，实现轮同轮）。
  - SA8 设计复审 `artifacts/sa8-conflict-gate-issue-244-design-recheck.md`（clear；R15 单键/双键暂存分歧已路由、R17 N5 措辞精度、R18 补例所有权 = 本 dispatch、R19 锚点行号）；既有 `artifacts/sa8-conflict-gate-issue-244.md`（iteration 0 clear R7–R10）与 `artifacts/sa8-conflict-gate-issue-244-design.md`（clear R11–R14）。
  - 既有 SA6 契约（iteration 0 批准）：`packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts`（11 用例，断言冻结）+ 本报告旧版（iteration 0 approve @ e2178f3）。
  - SA2 评审（approve，W1/W2/R11–R14）、SA4 评审（reject：SA4-1 已由 SA3 iteration 1 修复闭环、SA4-2 本轮收口）、SA3 报告 + `artifacts/sa3-issue244-iter1-verify.log`。
- 权威规范：ADR 0013（配置表冻结面）、ADR 0010、`docs/protocols/instance-replication-v1.md`（§17 注记现登记单键门口径——落地序中随实现轮改双键口径，见 §10/§15）。

## 2. Owner comment mapping

- dispatch 声明与简报快照一致：issue #244 零评论（REST `[]`）——无 owner 追加要求/豁免。SA4-2 的补例授权来自 SA4 §9 路由 + SA1 设计 §12（写死「R1c/N5/N6 经 owner/SA6 契约修订 dispatch 落笔」）+ SA8 R18——本 dispatch 即该路由的执行。

## 3. SA8 constraints（iteration 1 落实面）

| SA8 注意项（design-recheck） | 本契约落实 |
|---|---|
| R15 · 现行实现单键门 vs 修订设计双键门的暂存分歧（hub-connection.ts:195-202 / peer-connection.ts:109-116） | **R1c = 落地序守卫**：单键门下红（现行不抛）、门放宽后转绿——保证「先契约后实现」（design §12 顺序写死）；协议 §17 L569 注记随实现轮联动（§15 记录义务，不伪造成运行时断言） |
| R17 · 表达式语义附注 | N5 措辞保持「零分块族键表达」的精确边界（LIMITS 四 legacy 键、无 maxChunkedUpdateBytes / maxChunksPerUpdate——用例内逐键断言），非「不含 maxChunkedUpdateBytes」的单键化回退 |
| R18 · 契约补例所有权依赖（R1c/N5/N6 未落笔前边界仅由设计文本+裁决承载） | 本 dispatch 落笔三用例（文件断言 + 报告）——依赖项关闭 |
| R19 · observer-red 锚点行号漂移 | 纯行号精度项，契约无引用——不适用 |
| R7/R8/R10（iteration 0，已落地） | aborted 事件断言（R3/R5a/R5b）已并入实现且绿；§17 文档义务随 R15 联动 |

## 4. Environment and baseline

- HEAD `e2178f3`（切片 2 #243 合入）；branch `mabf/issue-244`；node v24.13.0；vitest 3.2.7。
- 实现基线 = 设计 D1–D8 全量落地（SA3 iteration 0）+ SA4-1 槽位归还修复（SA3 iteration 1，`assemblySlotHeld` 置位两处 + `ws-replication-issue244-slot-reclaim-regression.test.ts` REG1–REG3）。
- **实测基线（本 iteration 起步，契约文件改前）**：
  - `ws-replication-issue244-ac-red.test.ts` → **11/11 passed**（Type Errors no errors；0.9s）——iteration 0 已批准契约在实现基线上全绿（R1a/R1b/R2–R5b/N1–N4）。
  - SA3 verify.log 在册：全包 62/448、根 300/3211、包 tsc 0——与本 iteration 全包复测衔接（§13）。
- 本 iteration 改动面：契约文件 = 头部文档注记（迭代史）+ 新增 R1c/N5/N6 三用例；断言行为层零改动；报告原位修订。**生产实现零触碰。**

## 5. Positive reproduction（新红灯守卫 R1c，SA4-2 缺口断言）

测试文件（同前）：`packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts`。R1c 为纯配置构造用例（`hubOptionsWith`/`peerOptionsWith` 桩：registry.open → `{ok:false}`、timer 桩——不启动任何连接/定时器；与 R1a/R1b/N1 同构）。

- **R1c（AC1 + SA4-2 收口，红灯）**：显式 `{maxChunksPerUpdate: 4}`（唯一显式键，其余全缺省）经 hub/peer 双构造入口必须**构造期 TypeError**——合并结果链②算术违例：`maxChunkedUpdateBytes(缺省 4MiB) > 4 × maxUpdateBytes(缺省 512KiB) = 2MiB`（链① 4MiB ≤ 4MiB 通过——用例精确隔离链②边界）。语义依据 = ADR 0013 L71 约束列 + SA1 §7-D1 边界表行 2（显式 maxChunksPerUpdate 激活链；`{maxChunksPerUpdate: N≤7}` 同违例）。实测：**现行单键门不抛**（`hasOwnProperty('maxChunkedUpdateBytes')` 为假 → `validateChunkedTransferChain` 不可达）——hub 入口断言红，恰为 SA4-2 批评的族内缺口（显式收紧 count 键 + 缺省 envelope 的链②违例静默）。
- R1c 内嵌**断言敏感度反证**（现行门下即绿）：同一合并结果（4MiB/4/512KiB）经**双键显式**（`maxChunkedUpdateBytes: 4MiB` + `maxChunksPerUpdate: 4`）表达时现行单键门已响亮 TypeError——证明链②算术违例真实存在、校验机制非空转；红精确落在「仅显式 maxChunksPerUpdate 未激活链」。期望值自检（冻结缺省 4MiB/512KiB 关系）防 fixture/缺省漂移伪红伪绿。

## 6. Negative control

- **N5（绿，SA4-2 非追溯边界）**：`{...LIMITS}`（显式下调既有键 maxQueuedUpdateBytes=1MiB 等、**零**分块族键表达——用例内 `Object.keys` 逐键断言零 maxChunkedUpdateBytes/maxChunksPerUpdate）hub/peer 双入口构造**不抛**。探针真实性自检：合并 envelope 4MiB > 显式 queued 1MiB（若激活即链①违例）——证明用例探到「非追溯」边界而非空转。现行单键门与目标双键门均绿（R2–R5/N2–N4 默认注入构型构造成功的兼容面锁定）。
- **N6（绿，激活键集闭合）**：`{...LIMITS, maxConcurrentAssembliesPerConnection: 2}` 双入口构造不抛——非链操作数键（并发钮，2 ≥ 1 值门合法）不激活字节链；合并结果同 N5 违链①（若并发键误入激活键集即红）。
- **既有负控与已批准行为全保留（实测绿）**：N1（合法链配置构造 + 端到端收敛 + 形状门回归）、N2（chunkCount === 64 边界接纳）、N3（完整 3-chunk transfer 收敛哨兵）、N4（停滞 20s < 30s 前窗零误报 + 释放后整笔收敛）；红灯族 R1a/R1b/R2–R5b 在实现基线上全绿（已批准能力的回归保护——门放宽轮若误伤任一即红）。

## 7. Stability, scale and timing

- R1c/N5/N6 为同步构造期断言（无连接、无定时、零 real sleep）——确定性 100%；虚拟时间用例（R2–R5/N2–N4）沿用既有 advanceBy 架构，本 iteration 零触碰。
- 红灯文件 4 次独立运行失败集逐名一致（改后 3 次连续 + 全包回归内 1 次）：`1 failed (R1c) | 13 passed (14)`；Type Errors no errors；单次 <1s。
- 全包回归：62 files / 451 tests（448 + 新 3）——唯一失败 = R1c；时长 36.7s。

## 8. Capability-gap chain（iteration 1 修订面；源码符号 + 运行证据）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | 显式收紧 `maxChunksPerUpdate`（分块族链上键）时跨字段链②违例静默——构造成功、无任何信号（SA4-2 批评模式在 count 键上原样存在） | R1c：`{maxChunksPerUpdate: 4}` 双入口零 throw | 高（运行） |
| 直接缺口 | 链激活门 = **单键**（`hasOwnProperty('maxChunkedUpdateBytes')`）——hub-connection.ts:195-202 / peer-connection.ts:109-116；validate.ts `validateChunkedTransferChain`（L216-228）链判据本身完整（两链、合并结果、`≤` 语义、绝不 clamp） | 源码直读 + R1c 红 / 双键显式反证绿 | 高（源码+运行） |
| 修订语义（目标） | 激活键集 = 两链不等式的分块族操作数 `{maxChunkedUpdateBytes, maxChunksPerUpdate}`（显式表达任一 → 合并结果响亮校验两链；值门无条件先于链；仅显式既有键/非链操作数键/旋钮不激活） | design §7-D1 边界语义表 + §12 + SA8 recheck §2/§4（缺省自洽 4MiB ≤ 4MiB ∧ 4MiB ≤ 64×512KiB=32MiB） | 高（三方一致） |
| 算术边界 | R1c 边界 = 链②缺省-显式混合违例点：`maxChunkedUpdateBytes(4MiB) > maxChunksPerUpdate(4) × maxUpdateBytes(512KiB)`；`N ≤ 7` 同族违例、`N ≥ 8` 缺省构型链②自洽 | SA8 recheck §4-4 复核 + R1c 内期望值自检（4 次运行） | 高（运行） |
| 不构成缺口的既有面 | 值门（新键 ≥1 无条件）、R1a（显式 6MiB bytes 键）单键门已覆盖的激活面、N1 合法链、链机制本身 | R1b/R1a/N1 + 反证全绿 | 高（运行） |

## 9. Causal experiments

- **对照 1（激活键集变量）**：同一合并结果（4MiB envelope / maxChunksPerUpdate 4 / maxUpdateBytes 512KiB），表达差异：仅显式 `maxChunksPerUpdate` → R1c 红（不抛）；双键显式（含 `maxChunkedUpdateBytes: 4MiB`）→ 抛 TypeError（绿断言）——归因 = 激活键集缺 maxChunksPerUpdate，非链判据/合并/值门问题。
- **对照 2（非追溯变量）**：`{...LIMITS}`（零分块族键）不抛（N5 绿）vs 显式 `maxChunkedUpdateBytes` 变体（R1a 6MiB 抛 / N1 256KiB 不抛）——激活由**表达式**（显式表达链上键）而非**合并值**决定；缺省 envelope 不被追溯性误判。
- **对照 3（键集闭合变量）**：`{...LIMITS, maxConcurrentAssembliesPerConnection: 2}` 不抛（N6 绿）——非链操作数键即使合并值违链①也不激活；值门无条件性由 R1b（0 → 抛）独立锁定。
- 全部对照在同一构造桩与断言形态下完成——差异仅在被测键/值。

## 10. Impact surface

- 实现轮（★ 行，SA3 承接——本报告不设计修复、不落实现）：门条件放宽（hub-connection.ts:195-202 / peer-connection.ts:109-116 由单键改双激活键 `hasOwnProperty('maxChunkedUpdateBytes') || hasOwnProperty('maxChunksPerUpdate')`）、validate.ts L207 注释口径同步、协议 §17 L569 注记改双键口径句——与契约 R1c 转绿同轮（design §12 顺序：先契约后实现；§7-D8 同轮落地防文档-行为漂移）。
- 契约面（本 iteration 已落）：R1c 红 → 门放宽后绿；N5/N6 全程绿；R1a/R1b/R2–R5b/N1–N4 保持绿（回归保护）。补例后契约 = 14 用例 → 目标 14/14。
- 未触碰面：生产实现、replication-protocol codec、DENY 面（issue243/233 套件、harness、ADR）、其他契约文件。

## 11. Ruled-out hypotheses

- 「红是 fixture/构造桩错误」：同一桩下 R1a/R1b/N1/N5/N6 全部按预期（抛/不抛）——桩形态健康；R1c 期望值自检防 fixture 漂移。
- 「链机制整体缺失/判据错」：双键显式反证（现行门即抛）+ R1a（6MiB 抛）证明链判据与合并语义已落地——缺口仅在激活键集。
- 「peer 入口差异」：hub/peer 两构造器同构（共享 validateLimits/validateChunkedTransferChain 路径）——R1c 双入口同断言。
- 「环境 flake」：4 次独立运行失败集逐名一致；同步构造断言零时序因素。
- 「补例与冻结用例矛盾」：全包 62 文件 451 用例实测唯一失败 = R1c——SA8 Q2 的「零存量绿面翻转」穷尽取证与本轮全包回归一致。

## 12. Acceptance contract and test paths

测试文件（真实包测试入口，根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 自动发现；tsc 干净）：
`packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts` —— 14 用例。

| 语义面（SA4-2 收口 + 兼容控制） | 可执行断言 | 用例 | 现行实现（单键门） | 门放宽后 |
|---|---|---|---|---|
| 显式 `maxChunksPerUpdate` 激活链 → 合并值链②算术违例 TypeError（R1c 边界：4MiB > 4×512KiB） | `{maxChunksPerUpdate: 4}` hub/peer 构造期 TypeError + 冻结缺省自检 + 双键显式反证（现行门即抛） | **R1c** | **红**（静默构造成功） | 绿 |
| 非追溯：零分块族键表达不激活链（兼容控制） | `{...LIMITS}` 双入口构造不抛 + LIMITS 零分块族键逐键断言 + 合并违链①探针 | **N5** | 绿 | 绿 |
| 激活键集闭合：非链操作数键不激活（兼容控制） | `{...LIMITS, maxConcurrentAssembliesPerConnection: 2}` 构造不抛 | **N6** | 绿 | 绿 |
| 已批准行为（iteration 0 契约 11 用例，断言逐字保留） | R1a/R1b/R2–R5b（能力面——实现基线上全绿，门放宽回归保护）；N1–N4（负控） | R1a…R5b/N1–N4 | 11/11 绿 | 绿（不得误伤） |

**转绿假设 A6（本 iteration）**：链激活 = 显式表达分块族链上键（`maxChunksPerUpdate` ∨ `maxChunkedUpdateBytes`）→ 对合并结果响亮校验两链；值门无条件先于链；仅显式既有键/非链操作数键/`chunkedUpdate` 旋钮不激活（A1–A5 已由实现基线满足，见文件头注记）。契约断言不锁实现形态（门条件写法/注释位置自由——只锁行为：R1c 抛 TypeError、N5/N6 不抛）。

## 13. Red/green or baseline evidence

精确可复现命令（worktree 根；证据日志 `artifacts/sa6-issue244-iter1-verify.log`）：

```
# 改前基线：11/11 绿（已批准契约在实现基线上全绿）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts
  Tests  11 passed (11)   Type Errors  no errors

# 补例后（R1c/N5/N6；4 次独立运行失败集逐名一致）
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts --reporter=verbose
  × 红灯 R1c（AC1 + SA4-2 收口）：显式 maxChunksPerUpdate（无 chunked 字节键）必须激活合并值链校验…
    → AssertionError: 显式 maxChunksPerUpdate=4 + 缺省 envelope 4MiB 必须构造期 TypeError
      （链②：4MiB > 4×512KiB=2MiB；现行单键门静默接受）
      ❯ ws-replication-issue244-ac-red.test.ts:726  .toThrow(TypeError)
  ✓ 红灯 R1a/R1b/R2/R3/R4/R5a/R5b   ✓ 绿负控 N1/N2/N3/N4/N5/N6
  Test Files  1 failed (1)   Tests  1 failed | 13 passed (14)   Type Errors  no errors
```

红灯归因：R1c 的失败断言 = 「显式 count 键收紧 + 缺省 envelope 的链②违例必须构造期 TypeError」——失败点恰为现行单键门缺口（`hasOwnProperty('maxChunkedUpdateBytes')` 为假 → 链不可达），非 fixture/环境/测试入口（同桩 N1/N5/N6 与反证按预期绿，§6/§9/§11）；实现允许（且要求）在修复前红。

相关绿灯基线（无回归；exit 0）：

```
$ NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/ws-replication/test
  Test Files  1 failed | 61 passed (62)    Tests  1 failed | 450 passed (451)   Type Errors  no errors   # 唯一失败 = R1c
$ pnpm exec tsc -p packages/ws-replication/tsconfig.json     # exit 0
```

## 14. Runner trigger evidence

- 测试入口真实：文件位于 `packages/ws-replication/test/`，被根 `vitest.config.ts` include 发现；§13 命令逐字运行成功（vitest 收集 14 用例，`Type Errors no errors`）。
- 无 skip/only/todo；无 env override；零源码 grep/字符串断言（R1c/N5/N6 全部为构造期 TypeError 行为与对象形状断言；运行面用例维持 wire 帧/事件/持久化断言）。
- 契约文件在当前类型面 `tsc -p packages/ws-replication` 干净（TSC_OK）；不引用未实现类型。
- 纪律：断言行为层对既有 11 用例零改动（diff = 头部注记 + 3 新增用例）——已批准行为的可审计保持。

## 15. Unknowns and blockers

- **门放宽落地（非阻塞，已路由）**：R1c 转绿依赖 SA3 实现轮把门放宽为双激活键（★ 行）并与协议 §17 L569 口径句同轮（design §12 顺序 + §7-D8；SA8 R15 暂存分歧的闭合方式）——本契约只锁行为不锁实现形态。
- **表达式语义（=缺省值亦激活）**：`{maxChunksPerUpdate: 64}`（= 缺省值）+ 显式下调既有键的构型在双键门下将抛——hasOwnProperty 触发的固有性质（SA8 R17 已附注、边界语义表行 2 文档化），非本契约补例范围（设计冻结补例 = R1c/N5/N6 三用例，目标 14/14）。
- **R9 条件项**：ADR 0013「提议」状态与父 PR #241 OPEN——SA8 判现行约束；方向性返工则复审本契约。
- 无环境缺失、无无法复现现象、无阻塞。

## 16. Temporary diagnostics cleanup

- 本 iteration 零临时诊断文件（R1c 即最终用例形态；反证为用例内嵌断言）；运行日志入 `artifacts/sa6-issue244-iter1-verify.log`（worktree evidence），过程输出存 /tmp。
- 生产实现零改动（SA6 权限线内）；未启动服务/长驻进程；无 PID 文件/marker 轮询。
- 工作树仅含设计/契约/实现各 SA 既定产物 + 本契约修订（git status 核对）。

## 附：artifactPaths（worktree-relative）

1. `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts` —— 可执行验收契约（iteration 0 的 11 用例断言冻结 + iteration 1 补例 R1c 红灯/N5/N6 绿负控；14 用例；tsc 干净）。
2. `wiki/raw/task_issue-244_sa6_contract.md` —— 本报告（iteration 1 修订）。
3. `artifacts/sa6-issue244-iter1-verify.log` —— 验证证据日志（基线 11/11、补例后 1 failed/13 passed ×4、全包 450/451、tsc 0）。

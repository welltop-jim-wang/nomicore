# 双轴终审 · Standards 轴 — PR #165 review 八项修订（issue #161 round 2）

**Date**: 2026-08-30 | **Reviewer**: 独立 Standards 终审（未参与本轮 SA1/SA2/SA3/SA5/SA6/SA4/SA7 任何产出）
**Worktree**: `/home/wangjian/nomicore-fix-issue-161`（branch `fix/issue-161-on-docs-phase-5-websocket-replication`）
**评审范围（reviewed range）**: `0a18661`（round-2 基线，round-1 双轴终审双 clear 封口点）→ HEAD `06db53c`，恰 3 个实现 commit、25 文件：

| commit | 内容 | 文件面 |
|---|---|---|
| `4bc57dd` | R1–R8 八项修订实现 + 15 红锚转绿 | 24 文件（8 src + 8 test + 3 docs + 5 wiki） |
| `218ca3a` | SA7 D1–D5 动态锚（D2 破坏性红灯冻结） | 仅 1 测试文件（+832 行，零生产/docs） |
| `06db53c` | F1 §D9 wipe-credit 修复 | 恰 5 src + 2 wiki（零测试/docs） |

**输入**: SA1 终版设计（R4/§D9，SA2 R4 pass）；SA4 静态验尸 + F1 复审（双 pass）；SA7 动态验证 + F1 复测（fail-needs-fix → 升级 pass）；SA3 实现报告（含 §4 五项校准账本）；SA8 AC 逐条核对表（8/8 PASS）；round-1 终审已 clear（不在本轮重开）。

## Verdict: **clear**（Standards 轴——无阻断项）

---

## 1. 逐轴核验结论

### 1.1 范围纪律（scope discipline）— ✅ clear

- `git diff --name-only 0a18661..HEAD` = 25 文件，逐一落入 SA1 §C ALLOW LIST（8 生产 src / 8 测试基建与锚 / 3 docs / 6 wiki 工件）——无 ALLOW 外文件。
- **DENY LIST 零触碰**（本轮独立实测 `git diff 0a18661..HEAD -- <deny>`）：`hub-connection.ts`（含 §D9 注记的「表达式体零文本改动」——L181 实测确为 `(message) => this.outbound.enqueueData(...)`，布尔自动回流）、`index.ts`、`liveness.ts`、`round-engine.ts`、`fence-watchdog.ts`、`error-mapping.ts`、跨包（replication-protocol/namespace-registry/namespace-runtime/persistence*）、`apps/**`、非条件允许面测试（ac3/ac4/ac5/ac7/sa4-r4-1）——全部零 diff。
- **blacklist 零命中**：package.json / pnpm-lock.yaml / TASK.md / *.bak 均不在 diff。
- commit 粒度与流水线阶段一一对应（实现 / SA7 冻结锚 / F1 修复三段互不夹带）；`218ca3a..HEAD -- test/` 零 diff（冻结锚字节不变）、`218ca3a..06db53c` 恰 5 src + 2 wiki（SA4/SA7 声称独立复核成立）。

### 1.2 API 边界 — ✅ clear

- **公共导出面冻结**：`src/index.ts` 零 diff——`ReplicationLimits` 加字段不触发放出变更；`OutboundQueue`/`UpdateChannelHost`/`HubChannelHost`/`PeerNamespaceHost` 均为非导出内部结构类型。
- **内部签名放宽有界**：`enqueueData`/`enqueueUpdate`/`sendData`（双侧）`void → boolean` 为返回类型扩展，既有调用方源兼容；全仓 `tsc --noEmit` 零错（本轮实测 exit 0）双证无遗漏 caller。
- **冻结面纪律保持**：`api.test-d.ts` 形状断言随 `maxQueuedControlBytes` 同步（L135）；harness `CONTRACT_LIMITS` 镜像逐值一致（8 MiB 与 DEFAULT 同值，注释标注 R2）。

### 1.3 代码质量与可维护性 — ✅ clear

- 全部新增逻辑带设计节引注（§D1–§D9 / PR #165 修订项 / 协议 §17-§18），不变量与例外（N6 单点重置、N7 终态旁路、R4-N1 排除引理、R4-N2 credit 双清零勿简化）均落为代码注释——可维护性高于基线。
- 无新增 `@ts-ignore`/`@ts-expect-error`/`eslint-disable`/`as any`/`: any`（本轮 diff grep 零命中）；无新增 FIXME/TODO/XXX；无包依赖变更。
- 结构性防御分支（peer-connection `namespaceId === undefined → false`、双侧 `enqueueUpdateFrame` 超限早退 → false）均注释标注「结构不可达 + 防御双门」，语义一致不扩半径。
- 复杂度增量有界且有终止性论证：R5 `consecutiveSkipped` 顶界取当前 `dataOrder.length`（收缩只收紧）；R2 emitTail FIFO ledger 在检查点单调裁剪（`flushed > 0` 防御不裁剪，只会高估不漏检）。
- validate/defaults 沿用既有 `positiveSafeInteger`/`assertCollKind` 响亮校验模式（构造期 TypeError，不运行时 clamp）。

### 1.4 测试完整性（test integrity）— ✅ clear

- **零 skip/伪绿**：`grep -rn "\.skip\|\.todo\|\.only" packages/ws-replication/test/*.test.ts` → 0（本轮实测）。
- **零 real sleep**：`setTimeout`（排除 clearTimeout）测试面 0 命中——全 fake scheduler。
- **零源码 grep 断言**：测试文件 `readFileSync` 0 命中；R7/R8 文档验收按设计走「评审核对 + 冻结 grep 锚」（报告内可复跑命令），不落运行时文本断言（SA6 §5 纪律保持）。
- **冻结锚不可变（commit 级证明）**：D2 破坏性锚在 `218ca3a` 以纯测试 commit 冻结为红；`06db53c` 零测试文件改动使其转绿（`git diff 218ca3a..HEAD -- packages/ws-replication/test/` = 0 行，本轮实测）——断言未被削弱的最强证据形态。D2 锚文本逐行复核：破坏性断言（恢复派发后 `pendingData() ≥ 0`）+ 逐子锚（L388/L392/L394/L400/L402/L403/L407/L418-420/L423/L430）原语义在场。
- **R1-3 构造精度**：8192B 字面 payload + 锚内自检断言（`8L + 512 > 64KiB`）在位——R2-N1 裕度要求落实为可执行护栏，非注释空话。
- **五项测试面校准**（SA3 §4 账本）逐项复核成立，判「必要 + 语义保持/更强」：
  - #1 R3-2 引用先捕获：hub 既有 `dropConnection` 使 connections[0] 重取必抛（DENY 文件不可改）——三断言谓词零改动，同一对象可见终态；
  - #2 R3-5 补 settle：纯测试时序构造缺陷（deadline 武装晚于 fake now 推进），断言零改动；
  - #3 sa7-dynamic D2 锚：旧「Y2 滞留」恰依赖被 R5 修复的早退缺陷——以临时窗口满重构滞留，判别属性（控制帧自身序不被数据污染）不变；
  - #4 AC5-SHED：`> 48KiB ∧ ≤ 64KiB` 不变量对——**更强**（上界即 R1 严格准入字节级不变量直测），shed 信号断言零改动；
  - #5 A2-1011：数据面（严格准入下恒 ≤ max）+ 控制帧（≪ 8MiB 独立额度）合计越总预算、单检查点规则 C 总量分支 1011——原判别分支精确保留，R2 独立分支不交叉弱化。
  五处均文件内留注释 + 报告登记——不属「unjustified calibration」。
- **红→绿链条**：15 锚（SA6 契约）+ D2（SA7 冻结）全部绿；本轮独立复跑包级 `npx vitest run packages/ws-replication` → **17 文件 / 131/131 passed / Type Errors 0**（两次），与 SA7 F1 复测 R4-N3 口径恰合。

### 1.5 MABF 门禁与静态标准 — ✅ clear（本轮全部独立复跑）

| 门禁 | 命令（本轮实测） | 结果 |
|---|---|---|
| 整仓测试 | `pnpm test` | **170 文件 / 2002/2002 passed / Type Errors 0 / exit 0**（见 §2 观察 1 的一次性偏差与两次干净复现） |
| 聚合类型 | `npx tsc --noEmit -p tsconfig.typecheck.json` | exit 0 |
| 空白检查 | `git diff --check 0a18661..HEAD`；工作树 `git diff --check` | 均干净 |
| R7 锚 1 | `grep -rn "512 跳\|TEST_DEFER\|DEFER_MICROTASK_HOPS" packages/ws-replication` | **0 命中** |
| R7 锚 3 | `grep -rn "queueMicrotask(" packages/ws-replication/src \| grep -v src/testing.ts` | **恰 1**（peer-connection.ts:36 defaultDefer） |
| R7 锚 4 | `git diff 0a18661..HEAD -- src/defaults.ts test/harness.ts \| grep -c "^[+-].*512 \* 1024"` | **0**（冻结值不动） |
| R8 叙事锚 | `grep -rn "红灯\|SA6 契约\|SA8 放行\|撤销 round" docs/phases docs/protocols`；`grep -rn "round-1\|round 1" …` | 均 **0 命中** |
| B3 doc-diff | `grep -n "高优先级\|每轮每 namespace最多一个" docs/protocols/instance-replication-v1.md` | §17 **L492 段首逐字节保留** |
| ADR append-only | `git diff 0a18661..HEAD -- docs/adr/0010-*.md` | 仅文末 **+13 行**，既有节零改动 |
| phase-5 改写面 | `git diff 0a18661..HEAD -- docs/phases/phase-5-websocket-replication.md` | 仅 L75/L81/L83 三处标题终态化，冻结词汇正文逐字保留 |
| CI 触发性 | `pnpm test` = `vitest run --typecheck`，include `packages/*/test/**` | 全部测试文件结构性覆盖；E2E spec 零改动不触发 |

---

## 2. 阻断发现（blocking）

**无。** 各轴均未发现需要改动代码/测试/文档的具象缺陷。

## 3. 非阻断观察（nonblocking，登记不动代码）

1. **一次性 vitest "Errors 1" 观测**：本轮**首次**整仓运行报 `Tests 2002/2002 passed` + `Errors 1 error` + pnpm ELIFECYCLE failed；同树随后两次整仓运行均干净（一次完整捕获：exit 0、无 Errors 行；SA7 留档 `/tmp/sa7f1-repo.log` 亦干净 2002/2002）。错误明细被 tail 截断不可回收，两次复现失败 + 全部测试通过 + 无 ws-replication 归因证据 → 判环境级瞬态（本机重载下 worker/未处理拒绝竞速），不构成对本 diff 的阻断；建议总控 push 后以 CI 动态日志门禁（SA7 §4 已列）顺带观察是否复现。
2. **15 锚红灯基线无独立 commit**（SA4 §8.4 已登记）：SA6 基线仅存于工作树历史，committed review-red 与契约文本的逐字节差分不可回放；缓解 = sa6_red.md 冻结契约文本逐锚比对（SA4 已做）+ D2 锚的 commit 级红→绿证明。残余、非阻断；后续轮次建议 SA6 基线独立 commit。
3. **工作树未提交工件**（controller 阶段产物，非评审范围）：`REPORT.md`（仍为 round-1 版，round-2 重写待总控）、`ac_checklist`（未跟踪）、SA4/SA7 报告文件（未跟踪）、设计 §D9/SA2 R4 节与 dispatch 尾行（未提交）。评审按 commit 范围判定不受影响；总控需将其落 commit 以保持工件链耐久。
4. **设计文案计数瑕疵**（SA4 F1.9 #1 已登记）：§C 称 enqueueData「三 return 点」，实现为 2 个显式 return（TS boolean 穷尽性兜底）——纯文案，无行为差。
5. **两项已登记移交**：D5 hello 超时孤儿传输跟踪票（AC 表记 #168，立项/豁免归总控）；CI 动态日志门禁待 push 后补录——均已有属主，非本轮缺陷。

## 4. 评审限制声明

- 本轴评审 = 代码质量/可维护性/测试完整性/API 边界/范围纪律/MABF 门禁/静态标准；**规范符合性（八项修订是否满足 PR #165 review 语义）属双轴终审 Spec 轴**，不在本 verdict 内重复裁决。
- 范围限定 round-2（`0a18661..06db53c`）；round-1 八 commit 已在其自身双轴终审 clear（`0a18661` 封口），不重开。
- 全部动态门禁证据为本轮独立复跑（非转引）；静态锚 grep 同。

---

**Verdict: clear** — round-2 三个实现 commit 在范围纪律、API 边界、代码质量、测试完整性、MABF 门禁与静态标准全部轴上独立复核通过；无阻断项；五项非阻断观察均已具名登记（含属主）。

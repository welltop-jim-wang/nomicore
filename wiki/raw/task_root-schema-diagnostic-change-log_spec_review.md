# SA2 最终独立 Specification 审查 — issue #149（ROOT/SCHEMA 写路径接入诊断变更日志）

- **审查者**：SA2（Wallfacer；独立 specification 终审，未参与 SA1–SA8/SA3 任一环节）
- **审查对象**：worktree `/home/wangjian/nomicore-fix-issue-149`，任务基线 `eaf0484` → HEAD `874cc10`（两 commit：`96cd085` 生产实现 + `874cc10` SA7 测试层），含未提交 wiki AC checklist
- **约束基准**：任务简报 AC1–AC5 / 设计 R3 版 §9 25 结局点冻结映射 / `task_root-schema-diagnostic-change-log_relevant_decisions.md`（ADR-0011/0012/0008/0007/0009 摘录）
- **Date**: 2026-08-29（审查窗口 15:53–16:40）
- **纪律**：未修改任何生产代码/测试/SA 文档；未 push（复核 `origin/fix/issue-149-on-docs-namespace-diagnostic-change-log` 不存在）；唯一写入 = 本文件

## Verdict: **reject**（条件性——两项阻断已在 worktree 落地但**尚未提交**；完成 R4 提交 + §5 固定范围复验后即可转 pass）

**裁决要点**：任务简报 5 条 AC 的**实质**（实现 + 测试）经独立核验**全部满足**（§2 逐条）；reject 不针对功能本体，针对三项「未满足项」：(1) 已提交 HEAD 中的 DV-2 墙钟断言以实测约 1/3 失败率打红 CI `Test` 步（本审查独立复现 2 次，与并行 standards review BLOCKER-1 收敛）；(2) namespace-runtime 漏 patch version bump（仓库逐变更 bump 惯例，standards review BLOCKER-2）；(3) 原版 AC checklist 的 exit-1 归因表述被证伪（现未提交版已修正）。三项的修复均已在未提交区呈现（R4 remediation，dispatch 行 19 pending），故为条件性 reject。

---

## 0. ⚠️ 审查状态声明：worktree 在审查窗口内被并发修改

本审查开始时（15:53）未提交区仅有 AC checklist（1491 字节，含后被证伪的 exit-1 归因）。**16:18–16:20 期间出现并行流水线产物**：并行 SA4「Final standards review R1」（dispatch 行 18，verdict: reject，16:55–17:10 记录）+ SA3「Final-review remediation R4」（dispatch 行 19，pending）的未提交修复：

| 文件 | 未提交改动 | 对应 |
|---|---|---|
| `packages/namespace-runtime/test/runtime-root-schema-diagnostic-sa7.test.ts` | DV-2 对照断言上界 20ms → 100ms（+注释：实测稳态 14–27ms、原 20ms 贴界 ~1/3 失败率） | standards BLOCKER-1 |
| `packages/namespace-runtime/package.json` | `0.1.7 → 0.1.8` | standards BLOCKER-2 |
| `wiki/raw/task_root-schema-diagnostic-change-log_ac_checklist.md` | Gate summary 重写：exit-1 归因修正 + standards 结论登记 | BLOCKER-1 附注 |
| `wiki/raw/..._dispatch.md` / `..._sa3_impl.md` / `..._standards_review.md`（新） | 派发行 18/19 + 报告更新 | — |

本报告对**两个断面**分别裁决：§2/§3 针对 HEAD `874cc10`（含原版 checklist 语义——其 exit-1 表述已被独立证伪）；§4 对未提交修复面做独立有效性预验证。**总控合并时必须以 R4 提交后的状态重走 standards review §4 固定复验范围**（dispatch 行 19 本就如此安排）。

## 1. 独立验证证据（全部命令本机真实执行，不采信 SA3/SA4/SA7 自述）

| # | 验证项 | 命令 | 结果 |
|---|---|---|---|
| E1 | 提交面 | `git log --oneline eaf0484..HEAD`；`git diff --name-only` | 2 commits；19 文件 = 生产 5 + 测试 2 + lockfile + wiki 11——与设计 §16 ALLOW LIST 逐集吻合（SA7 测试文件为 SA7 轮新增，standards A-2 已裁决非越界） |
| E2 | 红灯契约 | `npx vitest run .../runtime-root-schema-diagnostic-red.test.ts --typecheck.enabled=false` | **14/14 通过**（精确计数：`grep -c '^\s*it('` = 14） |
| E3 | SA7 动态套件 | 同上（sa7 文件） | **16/16 通过**（隔离；精确 it 计数 = 16） |
| E4 | 两文件合并 | `npx vitest run <red> <sa7> --typecheck.enabled=false` | **30/30 通过**（15.5s） |
| E5 | 全仓 CI 等价（**修复前 HEAD 态**） | `npx vitest run --typecheck`（901s） | **`Test Files 2 failed / 140 passed (142)`、`Tests 2 failed / 1814 passed (1816)`、Type Errors no errors** + 2 条 vitest-worker RPC Timeout。2 失败 = **DV-2 对照断言 27.36ms < 20ms 断言失败（in-scope，F-1）** + `generate-cli-check.test.ts` 5s 超时（#23 遗产、不在 diff、隔离复跑 3/3 绿——环境工件） |
| E6 | DV-2 失败复现（第二采样） | 三包合跑 `npx vitest run packages/namespace-runtime/test packages/namespace-diagnostic-log/test packages/doc-runtime/test --typecheck.enabled=false` | 同一断言再红：`expected 22.78 to be less than 20`（1 failed / 854 passed） |
| E7 | CI Typecheck | `pnpm typecheck`（10 包） | **exit 0** |
| E8 | 测试文件类型面（SA7-F-1 闭环） | `npx tsc -p tsconfig.typecheck.json` | **exit 0（0 错误）**——SA7 的 63 处类型错误修复独立复现成立 |
| E9 | CI regen-diff | `pnpm generate --check` | **exit 0** |
| E10 | 依赖登记 | `git diff eaf0484..HEAD -- pnpm-lock.yaml` | 恰 1 条：`@nomicore/namespace-diagnostic-log workspace:* → link:../namespace-diagnostic-log` |
| E11 | ADR-0011 §D 冒充红线（结构面） | `grep -rn "encodeStateAsUpdate\|encodeUpdate" packages/namespace-runtime/src/` | **零命中** |
| E12 | 25 结局点映射 | 逐行读 `git diff eaf0484..HEAD -- src/write.ts src/schema-write.ts src/runtime.ts` 对照设计 §9.1/§9.2 | **逐点一致**：R1–R13/S1′–S7′ 每结局点恰一行 diag 写入（或 S7 缺省组装）；stage/code/sourcePhase/result/input 无错位；`doc` 局部量捕获（runtime.ts:421）先于 on/off 校验（SA2 #1 修正落实） |
| E13 | sequencer 微任务序（amendment C） | 通读 `src/sequencer.ts` L38-42 + runtime.ts 附加反应挂点 | `settled = tail.then(run,run)`；noop（tail 接线）先注册、emitSlot 后注册、下一 thunk 挂 noop 产物之后——emit 严格槽间、序 ≡ FIFO ✓ |
| E14 | emitter 契约形状 | 读 `namespace-diagnostic-log/src/emission.ts` | producer 传参与 `EmissionInput`（not-accessed/unsafe-input/{snapshot}）及 `EmissionResult` 判别联合逐分支吻合；零新词表/零新码 |
| E15 | 公共导出面 | `grep -n diagnostic src/index.ts src/internal.ts` | 零命中——无诊断泄漏 |
| E16 | 未 push 复核 | `git branch -vv` | 分支领先 `origin/docs/namespace-diagnostic-change-log` 2 commits，无自有 upstream ✓ |
| E17 | **修复后**DV-2 稳定性（预验证） | 修复后 sa7 文件隔离 ×3 | **3 × 16/16 全绿**（100ms 上界 vs 实测 14–27ms，余量 ≥3.7×） |
| E18 | 版本 bump 连锁 | `grep namespace-runtime pnpm-lock.yaml` | importer 以 `link:` 解析、lockfile 不 pin workspace 自身版本——bump 无 lockfile 连锁（与 checklist 表述一致） |

## 2. Acceptance Criteria 逐条核验（任务简报 5 条——**实质全部满足**）

| AC# | 要求 | 核验结论 | 独立证据 |
|---|---|---|---|
| 1 | 每个既有结果路径发射冻结 operation/source/context/stage/code/issues/committed/effect | **✅ 满足** | E12：25 结局点（R1–R13 + S1′–S7′）逐点比对实现无遗漏无错位；E2/E3：主要路径行为钉死（committed/validation/acceptance/capability-gate×2/input-snapshot/schema-compile×2/fatal×3/队列满/emitter throw）；未钉死端点见 F-6（INFO，非 AC 违约——AC1 只要求发射，静态逐点已证） |
| 2 | 成功事务 = 精确事务 effect 的 detached owned bytes；no-op/update-omitted 显式；无 live Y.Doc 逃逸 | **✅ 满足** | 结构面 E11（src 零整文档编码——ADR-0011 §D 三冒充面不可触）；行为面 E2：`applyCarrier` 同源基态 + 依序增量链重放观察到该事务真实效果 + `expectNoMaterializeWithoutBase` 反向鉴别（整文档冒充必红）；bytes 唯一来源 `doc.on('update')` 捕获窗口（try/finally 对称退订）；noop 分支（零事件）与 update-omitted（adapter 词表）在 §7.3 判定表/emitSlot 显式存在；emission 载荷仅 Uint8Array/纯数据（E14） |
| 3 | acceptance/capability-gate 记录 input=not-accessed；后续记录只消费既有 detached 快照 | **✅ 满足** | E12：两 acceptance 入口同步 emitAttempt 带 `{status:'not-accessed'}`（full 策略下仍零访问——红灯 it 5 + SA7 DV-2 实测）；S3 后 `diag.input={snapshot}` 同一 frozen 引用；敌意 accessor `fired===0`（红灯 it 3）+ Proxy get-trap 计数与无日志基线相等（it 4） |
| 4 | logger throw/queue-full/validation/sink 故障不改变业务返回值、提交、写序、dirty 通知、capability | **✅ 满足** | 代码面：emitAttempt 全吞（diagnostic.ts:123-144）+ 附加反应不包装（E13）；行为面：emitter throw 用例（emitCalls===2 + 业务四不变）、队列满（stats accepted/dropped + FIFO + `fatal===null`）、SA7 DV-6（capacity=1 × inputPolicy=full：drop 无 input 投影副作用）；validation/sink 失败为 adapter 侧既有授权行为，由冻结的 diagnostic-log 包测试覆盖（`file-adapter-mismatch-interference.test.ts` VFSL/storage 违规丢弃 + 健康事件、file-adapter 系 I/O 面） |
| 5 | committed/rejected/fatal-before/fatal-after/Proxy-accessor + 零额外读取均有测试 | **✅ 满足** | E2/E3：五类全覆盖（红灯 14 it 精确对应 + SA7 16 it 补 9 个未钉结局点/seam 守卫/R8 不可达演示/DV-6）；测试质量：真实 memory adapter 装配、运行时行为断言、零源码 grep 断言、零 .only/.skip（standards V12 + 本审查抽读确认） |

## 3. SA4/SA7 证据与实现一致性核验（发现 2 处不一致）

**证实成立的证据链**（抽查独立复现）：SA7-F-1 修复必要性与闭环（E8）；红灯 14/14（E2）；typecheck/generate（E7/E9）；yjs 事务增量机制（结构面 E11 + 行为面反向鉴别）；sequencer 时序（E13）；25 结局点映射（E12）；三包 855 测试面（E6 复跑：66 文件/855 测试——与 SA7 数字一致）。

| # | 级别 | 不一致项 | 详情 |
|---|---|---|---|
| F-1 | **BLOCKER（与 standards BLOCKER-1 收敛；修复在未提交区）** | **AC checklist（原版）+ SA7 报告 §4 的「pnpm test 全过、exit 1 仅因 2 条 RPC 工件」被证伪** | E5：全仓 `vitest run --typecheck` 于 HEAD `874cc10` 实测 `2 failed / 1814 passed`——其中 DV-2 对照断言 `syncMs < 20` 失败于 27.36ms；E6 第二采样 22.78ms 再红。失败非环境噪声：断言把「亚毫秒级」预期写在实测 14–27ms 量级路径上（standards 实测 ~33% 失败率；CI node 20/24 矩阵下单 PR 全绿概率 < 50%）。**按 dispatched 审查基线（HEAD + 原版 checklist），此为 SA4/SA7 evidence 与真实可复现行为的实质不一致 + CI 门禁稳定性未满足项** |
| F-2 | **BLOCKER（与 standards BLOCKER-2 收敛；修复在未提交区）** | **namespace-runtime 漏 version bump** | HEAD diff 中 `package.json` 仅 +1 行依赖、版本行未动（0.1.7）。仓库逐变更 patch bump 惯例（git 实证：diagnostic-log 0.1.0→0.1.2→0.1.4 每演进票必 bump；#111 standards BLOCKER-1 先例立法）；本票演进面（新依赖 + seam 2 字段 + 291 行新模块 + 全结局点接线）充分触发；全档案无豁免裁决 |
| F-3 | INFO | **SA4 静态报告 §0「受影响三包 18 文件/252 测试」与实际范围不符** | 同一命令范围实测 66 文件/855 测试（E6；与 SA7 报告 §4 数字一致）。SA4 该行数字疑为误记/误截——其「全绿」结论不受影响（本审查 855 面亦绿，除 F-1 断言），但引用该行时需以 66/855 为准 |
| F-4 | INFO | AC checklist AC1 证据引用「SA4 review §1.3」指错节 | 25 结局点静态核对在 SA4 报告 **§1.2**（§1.3 是测试触发性自检）。纯引用笔误，不影响实质 |
| F-5 | INFO | effect:'noop' 生产者侧发射分支无行为测试钉死 | emitSlot 缺省组装零事件→noop（§7.3 判定表）已实现，但 30 it 中无一例断言 producer 发出 committed/noop（业务层 yjs set 恒产内容，分支当前或不可达）。AC5 五类不含 noop，非违约；建议后续票以受控 seam 注入零内容事务钉死，防未来回归 |
| F-6 | INFO | 25 结局点中 4 点仍无行为测试（R10/R11/S3′a/S5′b） | SA4 I-5 登记 12 点未钉、SA7 DV-4 已钉 9 点后余此 4 点（ROOT/SCHEMA 事务级 fatal 透传 + SCHEMA 敌意 accessor）。正确性由 SA4 静态逐点 + 本审查 E12 复核背书；设计 §13.7 已列为后续补测清单，非本票验收门槛 |
| F-7 | INFO | 审查窗口内并发修改（见 §0） | 本报告结论对 HEAD 断面与未提交断面分别标注；总控合并 R4 时须按 standards §4 固定范围复验，避免以「本报告 pass 项」覆盖未复验的未提交面 |

## 4. 未提交修复面的独立预验证（R4 remediation——支持条件性转 pass）

- **BLOCKER-1 修复有效性**：上界 20→100ms + 注释如实记载实测分布与原断言缺陷；语义从「微秒级」修正为「无自旋量级」，与慢 emitter 下界 `>= SPIN_MS-5`（25ms）的对照逻辑保留。E17：修复后隔离 ×3 全 16/16 绿（余量 ≥3.7×）。断言方向学健全：同族其余墙钟断言均为下界型（慢机只会更高）。
- **BLOCKER-2 修复**：`0.1.8` 一行；E18 证实 lockfile 无连锁（workspace importer 以 link 解析）。
- **AC checklist 修正版**：exit-1 归因已按 standards 修正（RPC 工件 + DV-2 断言双成因），standards 结论已登记——原 F-1 的「证据表述不实」在未提交版已消除。
- **未独立复现项**：checklist 声称的修复后「full pnpm test green」本轮仅部分预验证（隔离 ×3 + 定向门禁全绿；全仓修复后长跑未及在本审查窗口内完成）——这正是 standards §4 固定复验范围第 1 项，留给 SA4 R2 裁决。

## 5. 结论与转 pass 条件

**Verdict: reject**（针对 dispatched 基线 `eaf0484..874cc10` + 原版 AC checklist）。

- **功能实质**：任务简报 AC1–AC5 全部满足（§2，独立验证）；四层缺口（依赖/seam/emit/owned-bytes）闭合；ADR-0011/0012/0008/0007 约束全线合规（amendment C 槽外 emit、§D 零整文档编码、§F acceptance 入口记录、observedAt 注入 Clock 成对 loud 校验、公共返回面零改动、零新码零新词表）。
- **未满足项**（reject 依据）：F-1（已提交 HEAD 的 CI 门禁不稳定断言 + 证据表述证伪）、F-2（版本 bump 惯例违反）。两者修复已在未提交区完整呈现且经本审查预验证有效（§4），但**尚未提交**、SA4 R2 固定范围复验**尚未执行**（dispatch 行 19 pending）。

**转 pass 条件（全部满足即可，无需回炉功能面）**：
1. 将 R4 修复提交（恰两文件：sa7 测试断言 + package.json 版本行，含修正版 AC checklist 与 wiki 档案）；
2. 完成 standards review §4 固定复验：DV-2 单文件隔离 ×3 + 全量 `pnpm test`（全绿 + Type Errors no errors）+ `pnpm typecheck` exit 0 + `tsc -p tsconfig.typecheck.json` exit 0 + `pnpm install --frozen-lockfile` exit 0（本审查已预验证其中隔离 ×3、双 typecheck、generate --check 四项）；
3. push 后按 SA7 DV-5 补 `gh run view --log` CI run 级证据（原已登记的环境阻塞项）。

## 6. 复核命令附录（本报告全部证据可重放）

```bash
cd /home/wangjian/nomicore-fix-issue-149
git log --oneline eaf0484..HEAD                      # 2 commits
git diff --name-only eaf0484 HEAD                    # 19 文件 vs 设计 §16
npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-red.test.ts --typecheck.enabled=false   # 14/14
npx vitest run packages/namespace-runtime/test/runtime-root-schema-diagnostic-sa7.test.ts  --typecheck.enabled=false   # 16/16（修复后）
npx vitest run --typecheck                           # CI Test 步等价（修复前 HEAD: 2 failed 含 DV-2）
pnpm typecheck && npx tsc -p tsconfig.typecheck.json && pnpm generate --check   # 三门禁 exit 0
grep -rn "encodeStateAsUpdate\|encodeUpdate" packages/namespace-runtime/src/    # 零命中
grep -n "version" packages/namespace-runtime/package.json                        # 修复后 0.1.8
```

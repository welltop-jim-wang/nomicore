# Standards 轴独立终审 — issue #151（trusted replication / 复制管理写接入 namespace 诊断变更日志）

- **审查者**：Review-A（独立 standards 终审；未参与 SA1–SA8/SA6/SA3/SA4/SA7 任一环节——dispatch 行 17 指派的替代终审）
- **审查对象**：worktree `/home/wangjian/nomicore-fix-issue-151`，任务基线 `722bddf` → **最终 diff** = HEAD `b5b0cb8`（两 commit：`218a74e` 实现 + `b5b0cb8` SA4 R1 F1/F2 修复）+ worktree 未提交面（`git status`：wiki 档案 3 份修改 + 未跟踪 `runtime-replication-sa7-dynamic.test.ts` 与 `_sa7_report.md`）
- **审查轴**：工程标准、正确性、回归风险、测试质量、版本纪律、档案范围、SA4 R2 pass / SA7 pass 之后的最终变更
- **只读审查**：未修改任何生产代码/测试/配置/package 文件；未 push（分支未上 origin，SA7 §6 已登记环境态）
- **Date**: 2026-08-31

**Verdict: pass**

> 判定依据：九个审查轴全部通过（§2）；两项 advisory（A-1 SA7 测试文件的 ALLOW LIST 形式收编、A-2 谱系合并时的版本行冲突预登记）均为非阻塞档案/流程项，且有 #149 终审 A-2 先例与设计 §12 合并策略声明的既定处置路径。全量 CI 等价门禁中 4 例失败经三重定性（文件不在 diff、失败形态全为 5000ms spawn 超时、两文件最后改动远早于基线）确证为预存满载环境工件，与本票零关联（§0 V6/V7/V8）。

---

## 0. 审查方法与独立验证证据（全部命令独立进程执行，不采信 SA3/SA4/SA7 报告自述）

| # | 验证项 | 命令 | 结果 |
|---|---|---|---|
| V1 | 范围抽取 | `git diff --name-only 722bddf HEAD` + `git status --porcelain`（含未跟踪） | 36 文件：生产/测试 25 + wiki 档案 11；`git diff b5b0cb8 --stat -- packages/` = **空**（SA4 R2 复验对象之后生产/测试代码零漂移——SA7 之后的最终变更仅 SA7 测试文件 + wiki 档案，见 A-1/V12） |
| V2 | Scope Creep Guard（机械比对） | 设计 §18 ALLOW/DENY 反引号 token 抽取 vs `/tmp/final-files.txt` 全集 `comm -23` | 代码面 24/24 已提交文件全在 ALLOW（R2 修订后版本）；**唯一差集 = `runtime-replication-sa7-dynamic.test.ts`**（未跟踪新文件，SA7 owned——裁决见 A-1）；DENY 面（diagnostic-log/**、runtime index/sequencer/close/status/projection/plain-data/schema-write、registry testing.ts）**零触碰**（`git diff --name-only 722bddf HEAD -- <DENY 面>` = 0 文件）；BLACKLIST 五模式（package-lock/yarn.lock/.DS_Store/TASK.md/*.bak）零命中 |
| V3 | SA6 红灯契约（终态） | `pnpm exec vitest run packages/namespace-runtime/test/runtime-replication-diagnostic-red.test.ts`（两包全量运行内含） | **15/15 passed**；用例计数 grep 实证恰 15 个 `it(`；R-3.2 修订落地（`NSRT-FATAL-REPLICATION-APPLY-INTERNAL` ×4、旧字面量 `APPLY-WRITE-INTERNAL` ×0）；SA4 F2 补锚（enable committed `input {capture:'full', value:{replicationId}}`）在文件内 |
| V4 | SA4 探针 + SA7 动态套件 | 同上（两包全量运行内含） | 探针 **2/2**（F1：无 emitter 基线 apply 集成 ⇒ saveCalls 1→2；F2：enable input 快照）；SA7 动态 **4/4**（§15.7(b) update-omitted 活链路 / A-c runtime-close ×2 / 无诊断基线等价 sweep） |
| V5 | 两包全量回归 | `pnpm exec vitest run packages/namespace-runtime packages/namespace-registry` | 365 用例中 **364 passed**；唯一失败 = `registry-surface.test.ts` 1 例 **5000ms 超时**（非断言失败；该文件不在本票 diff）——隔离复跑 **12/12 exit 0**（V8 同族定性）；#151 全部测试文件（红/探针/SA7）满载下全绿；`Type Errors no errors` |
| V6 | 全仓 CI 等价 `pnpm test` | `pnpm test`（= CI `Test` 步命令，独立 setsid 进程） | **1833/1837 passed（145 文件），`Type Errors no errors`**；exit 1 的 4 例失败全部为 `Test timed out in 5000ms`：`dsh-persistence/test/dsh-probe-cli.test.ts` ×2 + `vfsl-codegen/test/generate-cli-check.test.ts` ×2 |
| V7 | V6 失败集的无关性证明（三重） | ① `git log -1 -- <两文件>`：最后改动 `ccd29c1`（#82）/ `526ee4f`（#23），**均远早于基线 `722bddf`，本分支零触碰**；② 失败形态 9/9 全为 spawn 型 5000ms 墙钟超时（隔离同跑复现同签名），零断言失败；③ 同款失败集已由 #149 终审 A-3/R2.2 与本票 SA7 B-4 环境注记预登记（spawn pnpm+tsx 子进程在满载沙箱超 5s/it 默认上限） | **预存满载环境工件，与本票改动零关联**——#149 终审同族同判（其 R2-V5 方法论复现成立） |
| V8 | 超时工件非回归交叉证据 | 隔离复跑 `registry-surface.test.ts`（V5 失败项） | **12/12 passed, exit 0**——且该文件在全量 `pnpm test`（V6）中亦绿（35.4s 完成）→ 非确定性负载敏感，非 #151 回归 |
| V9 | 类型双门禁 | `pnpm exec tsc -p tsconfig.typecheck.json --noEmit`（root，含 `packages/*/test/**`）+ `pnpm typecheck`（CI Typecheck 步，十包） | **双 exit 0，0 errors** |
| V10 | 版本纪律 | `git diff 722bddf..HEAD -- packages/*/package.json` + `git show origin/main:…` | 两触及包各恰 +1 行 version：runtime **0.1.8→0.1.9**、registry **0.1.3→0.1.4**（逐变更 patch bump 惯例，#167 `722bddf` 先例同款只 bump 触及包；#149 终审 B-2 立法的漏 bump 反例不适用——本票无漏）；`pnpm-lock.yaml` 零 diff（workspace 版本不入 lockfile，frozen install 面不受影响） |
| V11 | 测试质量门禁 | `grep -nE "\.only(\|\.skip(\|\.todo(\|readFileSync"` 三测试文件 + 逐行走读 | **零命中**——断言全锚运行时可观察行为（结果联合/saveCalls 计数/记录内容/doc 状态/yjs 链式重放 + 空 doc 不物化反向鉴别）；无墙钟上界断言（#149 B-1 反例家族零出现——时序控制全用 poll/deferred，非 sleep 计时） |
| V12 | SA4/SA7 之后的最终变更核验 | `git diff b5b0cb8 --stat -- packages/` + `git status --porcelain`（非 wiki 过滤） | 生产/测试代码与 SA4 R2 复验对象（`b5b0cb8`）**逐字节一致**；SA7 mutation check 残留扫描（`SA7-DIAG`/FIXME/XXX）零命中；最终增量 = SA7 测试文件（新）+ wiki 档案（dispatch 行 14–18 归档、SA4 review R2 节、SA6 red 修订记录、SA7 report）——全部属技能规定产出/档案面 |
| V13 | git 卫生 | `git diff --check 722bddf HEAD` | exit 0（零空白错误）；未提交区非 wiki 文件恰 1 个（SA7 测试，A-1 裁决面） |
| V14 | 触发性（CI 接线） | `.github/workflows/ci.yml` + 根 `vitest.config.ts` | CI `Test: pnpm test` → include `packages/*/test/**/*.test.ts` 覆盖本票全部三个新测试文件（红灯/探针/SA7 动态）+ 六个替身收容测试；`Typecheck: pnpm typecheck` 含两触及包——无孤儿测试（SA7 §6 静态接线复核成立；run-log 证据待 push 后由发布阶段摘录） |
| V15 | 冻结词表/映射抽查 | 设计 §9.1/§9.2/§9.3 vs `replication-write.ts`/`replication-session.ts`/`runtime.ts` 源码逐行 | 抽查全部吻合：enable E-a/E-e/E-g/E-h/E-i/E-j/E-k、bump B-a（input 省略）/B-e/B-e′/B-f（context {id,MAX}）/B-g、apply A-a/A-b/A-c（closedBy 码域分野）/A-d/A-e–A-m；input 三态（not-accessed/unavailable/省略→none）与 source/context/sourceModule 装配点逐点一致；INV-DIAG 缺省组装仅业务 ok:true |

## 1. 发现清单

### ADVISORY（非阻塞，留档）

- **A-1（INFO，档案形式收编）**：`packages/namespace-runtime/test/runtime-replication-sa7-dynamic.test.ts` 不在设计 §18 ALLOW LIST（R2 修订只收编了 SA4 探针）。判定**非越界**：(a) DENY 兜底条目的语义是「存量冻结行为测试零改动」——本票对既有测试文件的改动全部在 ALLOW（键集更新 + loud stub 收容），SA7 文件是**新增**文件且零触碰存量；(b) 该文件是 SA7 skill 规定产出（「SA7 补充测试」），dispatch 行 16 明示「4 additional dynamic tests delivered」；(c) 先例：#149 终审 A-2 对同型 SA7 动态测试文件作同判（非越界 + 建议 SA1 下轮例行补 ALLOW）。处置：**建议下一轮 SA1 文档修订按 `[SA4 owned]` 同款追加 `[SA7 owned]` 条目**（SA7 报告 §8 已自登记同一建议）——纯档案同步，代码不回滚。
- **A-2（INFO，合并时预登记）**：origin/main（Phase 5 谱系 `b66615c` 之后）的 namespace-runtime/namespace-registry 已在 **0.1.10 / 0.1.6**——本票 0.1.9/0.1.4 与之合并时版本行必现文本冲突。这是两谱系分叉的固有结果而非本票错误（分叉点 `b264aae` 时两包尚未到 0.1.9/0.1.4，双方各自推进）；设计 §12 合并策略声明已覆盖（物化两文件以主线版本覆盖、诊断接线按 §9 映射表重放），版本行取较高值即可。预登记给 Phase 5 合并票，本票无动作。
- **A-3（INFO，环境留档）**：满载并行下 `dsh-probe-cli` / `generate-cli-check` / `registry-surface`（一次性）的 5000ms spawn/导入超时——与本票无关（V7/V8 三重定性；#149 终审 R2.2 #1 同族登记）。若 push 后 CI（GitHub runner）仍偶红该两文件，属该预存负载敏感类，不应记到本票。

**无 BLOCKER。** 重点排查过的两类 #149 终审阻断反例均不成立：(1) 测试墙钟上界断言——本票三个新测试文件零此类断言（V11）；(2) 漏 version bump——两触及包均已 bump 且恰为逐变更 patch（V10）。

## 2. 逐审查轴结论表

| # | 审查轴 | 结论 | 要点 |
|---|---|---|---|
| 1 | 工程标准（代码/类型纪律） | **通过** | `exactOptionalPropertyTypes` 条件展开纪律贯穿（emitAttempt/emitSlot/source/context/input 五处）；append-only 稳定码注册表（15 码主线逐字，R-3.2 常量名/值分野正确）；INV-N14 构造栈一次成型（V2.5/V3c'''''/V3d''/V3f 顺序合 INV-N1）；WeakMap 登记零键污染（键集测试 12 键绿）；替身收容用 loud stub（`REPLICATION_NOT_STUBBED` 结果面拒绝，不静默伪装 ok）；无 FIXME/XXX/注释残渣 |
| 2 | 正确性（含 F1/F2 终态） | **通过** | F1 修复形态逐点核验（`replication-session.ts:554` 无条件挂接 / `:578-579` 无条件退订 / `:580` diag 赋值条件 / `:589` R6 门控读 capturedUpdate——探针 A + SA7 sweep 双行为锚绿）；F2（`replication-write.ts:309-311` E3 成功 snapshot freeze——探针 B + SA6 补锚双绿）；窗口订阅分化正确（enable/bump E5 窗口 diag 条件 + E6 无条件；apply R5 窗口无条件）；R2 事实源 = state.replication 投影链单点；fence 收敛（finalize 幂等 + 终态不降级 + Set 迭代删除限当前元素）；A-c closedBy 码域分野；owned bytes 单赋值 handler + try/finally 退订、catch 内分类读捕获值（非 diag.updateBytes 时序依赖，E-k/A-m 在 finally 之后读，顺序正确） |
| 3 | 回归风险（业务面） | **通过** | ROOT/SCHEMA 既有 emission 字节面零变化（diagnostic.ts 四点扩展全缺省兼容；#149 红灯 14/14 + SA7 16/16 随全量绿）；write.ts 'root'/'schema' 渲染逐字节不变（fatal-message-rev1 绿）；公共 status 七键不变（state.replication 不进 buildStatus）；internal 值导出恰两键（键集测试绿）；registry 公共 value 导出恰九个（type-only re-export 零运行时面，registry-surface 12/12 绿） |
| 4 | 回归风险（CI 门禁稳定性） | **通过** | V6 全量 `Type Errors no errors` + 1833/1837（4 失败全为预存 spawn 超时，V7 三重定性 + #149 R2-V5 同族先例）；本票新增 21 用例在满载全量下两轮全绿、零墙钟上界断言（V11）——#149 B-1 反例家族无新增成员 |
| 5 | 测试质量 | **通过** | 15+2+4 用例全部运行时行为断言（零源码 grep、零 .only/.skip）；红灯含 yjs 链式重放（prior 载体）与空 doc 不物化反向鉴别（真增量防冒充）；SA7 sweep 经 mutation check 反证具备真守卫力（F1 缺陷注入即红、还原即绿）；时序控制全 poll/deferred 型（无 sleep 计时断言） |
| 6 | 版本纪律 | **通过** | V10：两触及包逐变更 patch bump 与 #167 先例一致；lockfile 零 diff；无漏 bump（#149 B-2 反例不适用）；A-2 合并冲突预登记（非本票缺陷） |
| 7 | 档案范围 | **通过** | V1/V2/V12：11 份 wiki 档案链完整（brief/conflict×2/relevant_decisions/design/dispatch/sa2/sa3/sa4/sa6/sa7）；已提交代码面 24/24 全在 ALLOW；DENY/BLACKLIST 零命中；A-1 唯一形式缺口（SA7 文件）有先例裁决 + SA7 自登记建议 |
| 8 | SA4/SA7 后最终变更 | **通过** | V12：`git diff b5b0cb8 -- packages/` 为空——SA4 R2 pass 之后生产/测试代码零漂移；SA7 动态验证的 mutation 已还原零残留；最终增量仅技能规定产出（SA7 测试）+ 档案归档 |
| 9 | 只读审查纪律 | **通过** | 本审查零代码/配置改动；唯一写入 = 本报告文件 |

## 3. 已核实的前轮结论（终审背书，不再展开）

- **SA4 R2 pass**：F1/F2/F3 闭合矩阵的三项修复落点经本审查源码逐点复核仍成立（§2 #2）；探针 2/2 独立复现（V4）。
- **SA7 pass**：五项移交重点的交付物（§15.7(a) 对账结论、§15.7(b) update-omitted 活链路、A-c 路径、等价 sweep + mutation 反证、CI 静态接线）经本审查抽查（V4/V6/V14）成立；其 B-4 全量 1837/1837 自述与本审查 V6 的 1833/1837 差异**恰为 V7 定性的同族满载超时**（SA7 自身运行的 4 例 worker RPC 超时与本审查的 4 例 spawn 超时同为负载工件，非确定性漂移），不影响其结论有效性。
- **SA3 偏差登记诚实性**：4 项偏差（bump 重放锚/替身收容/index.ts re-export/§11 转绿声明修订）与实际 diff 逐项对得上（V1/V2）；loud stub 与 type-only re-export 的性质经逐 diff 核实与自述一致。

## 4. 结论

**Verdict: pass。**

实现本体（物化最小闭包 + 三 operation 诊断接线、33 结局点映射、owned bytes 捕获窗口、F1/F2 修复、词表/稳定码零新造、emit 纪律、业务隔离四防线）经本审查独立验证全部成立；版本纪律、档案范围、CI 触发、测试质量门禁全绿；SA4 R2 pass 与 SA7 pass 之后的最终变更仅技能规定产出与档案，零代码漂移。两项 advisory（A-1 ALLOW 形式收编、A-2 谱系合并版本冲突预登记）留给下一轮 SA1 文档例行修订与 Phase 5 合并票，不构成本票阻塞。

Standards 轴不持有阻塞项；#151 可进入发布流程（push/PR 后按 SA7 §6 登记的预期形态补 `gh run view --log` 触发证据）。

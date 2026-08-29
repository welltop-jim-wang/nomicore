# 最终 AC 门禁核查表 — Issue #172 Phase 5 WebSocket replication authoritative contracts

- **Date**: 2026-08-31
- **Verifier**: 最终 AC 门禁（对照任务简报逐条独立复核；不修改业务代码）
- **核查基线**: worktree `/home/wangjian/nomicore-fix-issue-172`，branch `fix/issue-172-on-docs-phase-5-websocket-replication`，实现范围 `ef19bae → 3141884`（c271476 SA3 实现 + 3141884 SA4 F1 窄域文档修复）+ 工作树内 SA4 R2 / SA7 报告落盘
- **上游判决**: SA4 R2 = pass（`_sa4_review.md` §R2-4）；SA7 = pass（`_sa7_report.md` §7）
- **核查方法**: 逐条 AC 以**独立重跑命令 + 文件行号证据**复核（非转抄上游报告）；关键命令与实测输出见每条内嵌代码块与 §VII

## 总表

| # | Acceptance criterion（简报原文） | 判定 | 关键证据（一手） |
|---|---|:--:|---|
| AC-1 | `wiki/raw` is historical evidence only, not an authoritative contract in source/specification | ✅ | AGENTS.md:5 + ADR-0010 #172 §2；权威措辞 grep 零命中；23+ 处双标注改写 |
| AC-2 | Public fields/defaults/error and close-code semantics map one-to-one between code and one authoritative document | ✅ | `maxQueuedControlBytes`=8MiB/链式下界/1011/1002 逐值 code↔protocol↔ADR 对齐；6 行偏差表闭环映射；anchors 17/17 绿 |
| AC-3 | Phase documentation identifies #163/#164 and `resetReplica` delivery/dependency status | ✅ | phase 文档切片表 L156–160 + 未交付边界 L187–195 + ADR-0010 #172 §3 |
| AC-4 | No contradictory repository guidance for control reserve, polling interval, pong timeout, `CLOSE_OK`, or `GOAWAY` | ✅ | 五主题全仓扫描：冻结值/当前实现/修复票三态在所有位点一致标注；唯一 `controlReserveBytes` 残留 = ADR 历史记述 |
| AC-5 | Tests describe current behavior and critical assertions are non-vacuous | ✅ | 4 组恒真断言全部加固（diff 逐处核对）；过时叙事 4 类改写；残留 2 处 `≥0` 经判定非恒真 |
| AC-6 | `git diff --check` passes; executable-contract changes include relevant typecheck/tests | ✅ | range/worktree diff-check exit 0；typecheck exit 0；ws-replication 23 文件 172 测试全绿（本门禁独立复跑） |

**结论：6/6 全部满足。无未满足项，无需退回任何 SA。** 两项流程性挂起项（CI 发布后摘证、R1-3 修复路由裁决）归总控，性质与依据见 §VI。

---

## I. AC-1 — `wiki/raw` 仅为历史证据，源码/规范中非权威契约 ✅

**证据 1（规范面声明已在位）**：
- `docs/AGENTS.md:5`：『Historical `wiki/raw/` artifacts are evidence, not normative contracts.』（Authority 节，规范级声明）
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md:320-323`（issue #172 修订节 §2）：『**`wiki/raw` 非规范**：源码与规范中的公共行为表述必须指向 `CONTEXT.md`、ADR 或 `docs/protocols/`…』

**证据 2（权威性措辞零残留，本门禁独立复跑）**：

```bash
$ git grep -nE "契约来源：wiki|设计基准：wiki|以 wiki/raw.*为准|以wiki/raw.*为准" -- 'packages/**' 'apps/**' 'docs/**' 'CONTEXT.md'
（零命中，exit 1）

$ git grep -nE "(公共契约|权威设计|authoritative design|frozen (public )?contract|contract source|规范来源|契约基准).{0,60}wiki|wiki.{0,60}(…同上…)" -- 'packages/**' 'apps/**' 'docs/**' 'CONTEXT.md' 'README.md' 'REPORT.md'
docs/adr/0010-…md:322: 仓库内以「冻结契约/权威设计/契约来源」措辞指向 `wiki/raw` 的源引用已改为权威指向   ← 即上述声明本身
```

**证据 3（23+ 处源引用改写为「权威指向 + 历史证据」双标注，diff 逐处抽样核对）**：

改写模式统一为——原『契约来源：wiki/raw/…』→『**规范权威：ADR-XXXX / docs/protocols / docs/phases**；设计记录（**历史证据，非规范**）：wiki/raw/…』。抽样位点（本门禁 `git diff ef19bae HEAD` 逐一目验）：
- `packages/ws-replication/src/types.ts:3-5`、`defaults.ts:4-6`、`index.ts:1-3` → 规范权威 = protocol §17/§18 + ADR-0010 #161/#172 修订节
- `packages/namespace-registry/test/registry-{create,open,idle,plugin,shutdown}.test.ts`、`registry-phase5-*.test.ts` → ADR-0009/ADR-0010
- `packages/doc-runtime/src/{carrier,extract,materialize,read,replace}.ts` → ADR-0007/0008
- `packages/namespace-runtime/src/replication-session.ts`、两包 `registry-seam-audit.ts` → ADR-0009/ADR-0010 #134
- `packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts`（原『以 wiki 为准』→ 断言即规范载体 + 历史证据降级）、`packages/vfsl/test/compile-schema-envelope-sentinel.test.ts`

**证据 4（无反例）**：
- `CONTEXT.md` 全文零 `wiki` 引用（grep 零命中）
- 残留的『冻结（设计），R3 PASS』字样全部位于显式『设计记录（历史证据，非规范）』标签块内（描述历史记录自身的冻结状态，非规范主张）；`README.md:83/108`、`REPORT.md:63` 对 wiki/raw 的定位均为『流水线审计轨迹/档案』= 历史证据用法

**判定**：满足。公共行为表述已全部改指 CONTEXT.md/ADR/docs/protocols；wiki/raw 残留引用均为历史证据用法且多数已双标注。

---

## II. AC-2 — 公共字段/缺省/错误与关闭码：code ↔ 单一权威文档一一对应 ✅

**权威文档链**：`docs/protocols/instance-replication-v1.md`（wire 契约权威，AGENTS.md Authority 节）+ `docs/adr/0010` #161/#172 修订节（决策记录，逐值镜像，无冲突）。代码头注释显式挂靠该链。

**逐值对照表（本门禁逐行核验）**：

| 公共语义 | 代码位点 | protocol 冻结值 | ADR-0010 | 一致 |
|---|---|---|---|:--:|
| 字段名 `maxQueuedControlBytes` | `packages/ws-replication/src/types.ts:29` | §17 L492 | #172 §1（L310-313） | ✅ |
| 缺省 8 MiB | `defaults.ts:28`（`8*1024*1024`） | §17『缺省 8 MiB』 | #172 §1 | ✅ |
| 链式下界（TypeError，同步、合并结果上校验） | `validate.ts:14`（`PROTOCOL_OVERHEAD_BYTES=128`）+ `:153-158` | §17 L504『≥ maxBootstrapBytes + protocol overhead』 | #172 §1 | ✅ |
| 记账判据读冻结字段；耗尽 → `CONNECTION_BACKPRESSURE` close **1011** | `backpressure.ts:88`；`hub-connection.ts:153` | §17 + §13.1 L352（retryable yes/1011） | #161/#172 | ✅ |
| `pingIntervalMs=30_000` / `pongTimeoutMs=10_000`；`pong<Interval` 构造期 TypeError | `defaults.ts:41-42`；`validate.ts:169-174` | §18 L524 | #161 | ✅ |
| ACK/CLOSE_OK 关联违规 → `ACK_STATE_VIOLATION` **1002** connection fatal（已交付面） | `hub-namespace.ts:454/533`、`peer-namespace.ts:486` | §10.2 + §13.1 L351 | #161 | ✅ |
| 测试镜像同步 | `test/harness.ts:54,139`（`CONTRACT_LIMITS` 8MiB）、`test/ws-replication-api.test-d.ts:135` | — | — | ✅ |

**偏差的一一映射（不漏、不静默）**：当前实现与冻结值的 6 处偏差全部在 `docs/phases/phase-5-websocket-replication.md` 已知偏差表（L164-171）+ ADR-0010 #172 §3（L327-331）登记，且每条都有可执行锚（`it.fails` 期望红灯）：checkpoint cadence → #169（A2-1/A2-2）；hub pong 1002 → #170（A3-1）；CLOSE_OK 静默忽略 / GOAWAY drain 静默窗口 / hub 停机零 GOAWAY → #171（A4-1/A4-2/A5-1/A5-2/A5-5）；严格接纳 pipeline 判据 → 待总控裁决（R1-3）。

**运行时证明（本门禁独立复跑）**：`pnpm exec vitest run packages/ws-replication/test --typecheck` → **23 文件 / 172 tests 全绿，Type Errors: no errors**——含 anchors 文件 17/17（A1-1 字段名/缺省、A1-2 链式下界、A1-2b 下界满足不拒、A1-3 冻结字段驱动记账四条现绿回归锁 + 8 条 it.fails 期望红 + D2-bis meta 守卫）。

**导出面**：`index.ts` diff 仅 2+/1−（头注释改挂；导出集零变化，SA4 E3 已核 + 本门禁 diff 复核）。

**判定**：满足。代码每个公共语义要么与权威文档逐值一致，要么作为已登记偏差闭环映射到修复票 + 期望红灯锚；无孤立语义、无第二矛盾权威。

---

## III. AC-3 — phase 文档登记 #163/#164 与 `resetReplica` 交付/依赖状态 ✅

**证据（`docs/phases/phase-5-websocket-replication.md`「交付现状与边界」节，issue #172 收口登记）**：

| 登记对象 | 文档位点 | 内容 |
|---|---|---|
| `resetReplica`（Registry 侧） | L123（切片 8 正文）+ L158（切片表） | 已交付；执行次序以 **ADR-0010 issue #133 round-2 修订节**为准，早期『close→archive→bootstrap』简写显式声明已被替换、不引用（简报边界陈述要求落实） |
| `resetReplica`（peer 侧编排） | L158 + L194-195（未交付边界） | 未交付：ws-replication 层未暴露 peer reset 面（`PeerReplication` 无 reset 编排 API）——known gap |
| #163 结构化 observability | L158（切片 8）+ L160（切片 10 依赖）+ L189-190 | 未交付：`HubReplication`/`PeerReplication` 公共 API 无 observer/metrics 事件面 |
| #164 apps/yjs-server + real adapter/composition | L157（生产 adapter 三面装配断言随 #164）+ L159（切片 9 未交付）+ L160 + L191-193 | 未交付：`apps/` 下无 composition root；`DuplexTransport` 三可选面生产装配期断言随 #164 交付 |

**交叉验证**：
- ADR-0010 #172 §3（L324-329）登记同款结论（peer resetReplica / #163 / #164 未交付），两文档一致；
- 代码现实吻合：`git diff --name-only ef19bae HEAD` 中 `apps/` 零文件（无 composition root 被创建）；SA7 §4 逐条源码实证（`PeerReplication` 无 reset 面、公共 API 无 observer 面）；
- 切片 10（L160）显式声明依赖 #163/#164/#169/#170/#171 —— 依赖状态可追溯。

**判定**：满足。三项边界的交付状态、依赖关系、权威依据（ADR #133 round-2）均在 phase 文档单点可查且与 ADR/代码一致。

---

## IV. AC-4 — 五主题无矛盾仓内指引 ✅

**方法**：对 control reserve / polling interval / pong timeout / CLOSE_OK / GOAWAY 五主题做全仓 grep（docs/ + packages/ + apps/ + CONTEXT.md + README.md + REPORT.md），逐一判定每个位点表述的是「冻结契约」还是「当前实现（已登记偏差）」。

| 主题 | 冻结值位点 | 当前实现位点 | 偏差登记位点 | 判定 |
|---|---|---|---|:--:|
| control reserve | protocol §17 L492（8MiB+下界）；ADR-0010 #172 §1 | `defaults.ts:28`、`backpressure.ts:88`（同值，无偏差） | —（已收敛） | ✅ |
| polling interval | protocol L492 + ADR-0010 #161（`max(1,floor(ackTimeoutMs/100))` 缺省 100ms） | `backpressure.ts:57`（固定 1_000）——**注释自带 #169 偏差标注**（L53-56） | phase L166 偏差行 → #169；anchors 头 G2 组现状描述 | ✅ |
| pong timeout | protocol §18 L524（close 1001） | peer：`peer-connection.ts:309` close(1001)（一致，已交付）；hub：`hub-connection.ts:261` close(1002)（偏差） | phase L168 偏差行 → #170；ADR-0010 #172 §3；A3-1 it.fails 锚（SA4/SA7 双独立翻转实验证实红因 `expected 1002 to be 1011`） | ✅ |
| CLOSE_OK | protocol §10.2（错误/多余 ACK 关联 → `ACK_STATE_VIOLATION` 1002 fatal） | 不匹配/多余 CLOSE_OK 静默忽略（`peer-namespace.ts:512` 一带） | phase L169 偏差行 → #171；A4-1/A4-2 it.fails 锚 | ✅ |
| GOAWAY | protocol §6.3 L149（drain 窗口停 OPEN/不开新 round；deadline 1001）+ §21 停机第 1 步（先发 GOAWAY） | peer 收侧 deadline close(1001) 已交付（`peer-connection.ts:410`）；`addTarget`/needs-resync 无 drain 门 + `HubReplication.close()` 零 GOAWAY（`hub-connection.ts:96-100`）为偏差 | phase L170-171 偏差行 → #171；**归属裁决 L183-185**：hub 停机 GOAWAY 发送属 ws-replication 包行为（修复票 #171），非 #164 composition 边界——显式裁决而非静默删除（简报 A5-5 要求落实）；A5-1/A5-2/A5-5 it.fails 锚 | ✅ |

**无矛盾佐证**：
- `controlReserveBytes`（旧名）全仓（排除 wiki）唯一命中 = `docs/adr/0010:314`，位于 #172 修订节内的**历史记述**（『PR #165 曾以 controlReserveBytes（64 KiB）落地…issue #172 收敛为冻结字段名』）——记述收敛事实，非活指引；
- `CONTEXT.md` / `README.md` / `REPORT.md` 对五主题零提及（grep 零命中）——不存在第四个相互矛盾的指导面；
- SA4 R1 曾拒绝的『同一 commit 内 phase 文档说已交付、测试说未实现』自相矛盾（F1-b）已在 3141884 闭合：phase 切片 6 行现为『部分交付*』+ 精确枚举已交付面（水位/Σ-queued shed/control 额度/单帧拒纳 R1-1/R1-2）与未接线面（pipeline 记账 + 幸存面同批丢弃），与 r1-r7 测试头陈述逐点一致（SA4 R2-3 + SA7 §4 三方对照复核）。

**判定**：满足。五主题在仓内每个位点的表述都明确属于三态之一（冻结契约 / 已交付 / 已登记偏差+修复票），无任何位点把偏差值写成契约或反之。

---

## V. AC-5 — 测试描述当前行为且关键断言非恒真 ✅

**恒真断言修复（简报点名的 4 组 7 处，diff + 现行文件逐处核对）**：

| 原位点 | 原断言（恒真） | 现断言（可失败） | 核对 |
|---|---|---|---|
| `ws-replication-ac4-reconcile.test.ts:71` | `expect(peerStep1At).toBeGreaterThanOrEqual(0)` | `expect(run.peerFrames('SYNC_STEP1').length,…).toBeGreaterThanOrEqual(1)` | ✅ 现场读取 L71 |
| `ws-replication-review-revisions-r1-r7-red.test.ts:428` | `expect(resyncCount(run),…).toBeGreaterThanOrEqual(0)` | `…'拒纳必须无条件 RESYNC 声明').toBeGreaterThanOrEqual(1)` | ✅ diff + 现行文件 |
| 同上 `:442` | `expect(channelPendingDataOf(…)).toBeGreaterThanOrEqual(0)` | `…'拒纳后 pendingData 归零…').toBe(0)` | ✅ |
| `ws-replication-sa7-round2-dynamic.test.ts:393/401/404` | 三处 `≥0` 护栏 | `toBe(i)`（循环期严格递增）/ `resyncs.length ≥ 1`（触发面显影）/ `toBe(0)`（幸存面清零） | ✅ diff 三处 |

**残留 `≥0` 全量扫描与判定（本门禁独立执行）**：`git grep -E "toBeGreaterThanOrEqual\(0\)" -- packages/ws-replication/test/**` 仅 2 处命中，均**非恒真**：
- `ws-replication-sa6-hardening-g3-g4-red.test.ts:607`：`closingIndex = observed.indexOf('closing')` 的在场断言（indexOf 缺席 = -1 → 可红），且其后紧跟更强的 `toEqual(['closing','closed'])`；
- `ws-replication-sa7-round2-dynamic.test.ts:436`：`pendingData()` **可为负**（D2 负记账缺陷的守卫锚，文件内注释 L429-434 明示『恢复派发后 pendingData 转负…−1』）——`≥0` 是真实可失败谓词。

**过时叙事修正（简报要求 4 的第二半，逐处核对）**：
- `ws-replication-issue137-ac1-ac7-red.test.ts:114-116`：原『当前实现：完全无视 bufferedAmount…本断言红』→ 现 L114『★ 回归锁（#137 已交付）…bufferedAmount 水位闸门已接入——issue #161 R2/PR #165』——与现状一致（该文件 4 用例现绿）；
- `ws-replication-issue137-r2-red.test.ts`：L25 头注释 + L388-391 构造点改为 `maxQueuedControlBytes: 64_000`（§17 冻结名）+ 追加 `maxBootstrapBytes: 1_024`（下界相容），文件内 `controlReserveBytes` 零残留；
- `ws-replication-sa6-hardening-g1-g2-red.test.ts` / `g3-g4-red.test.ts` 头部：原『当前全部无实现』→ 逐 AC 标注『已修复（回归锁）』/『已交付（#137/#161…）——现为回归锁』+ ⚠ 现状说明段；
- `ws-replication-issue172-contract-anchors.test.ts:10-27`：分组头逐组陈述当前实现 vs 冻结值（G1 已收敛现绿 / G2-G5 何者红、何者绿、归哪个修复票）——测试即当前行为的准确描述。

**已知缺口的测试呈现（不发明未实现行为）**：R1-3 以 `it.fails` 期望红灯注册（r1-r7:411）+ 文件头 KNOWN GAP 实测记载 + phase 文档验收锚段存在性登记（L177-181）；#169/#170/#171 九锚同机制。SA4 E8/E9 与 SA7 §2 各自独立翻转实验证实全部为断言级红、红因与登记逐字一致。

**判定**：满足。

---

## VI. AC-6 — `git diff --check` 通过；可执行契约变更含相关 typecheck/测试 ✅

**本门禁独立复跑结果（2026-08-31，node v24）**：

| 检查 | 命令 | 实测结果 |
|---|---|---|
| 工作树空白错误 | `git diff --check` | **exit 0**（零输出） |
| 实现区间空白错误 | `git diff --check ef19bae HEAD` | **exit 0**（SA4 R1-N2 报的 design.md EOF 空行已剥除） |
| 全仓 typecheck | `pnpm typecheck`（tsc -p 11 包串联） | **exit 0** |
| ws-replication 全套件（含类型检查） | `pnpm exec vitest run packages/ws-replication/test --typecheck --passWithNoTests=false` | **Test Files 23 passed (23)；Tests 172 passed (172)；Type Errors: no errors；exit 0**（91.67s） |
| 全量测试 | `pnpm test` | 见下方「全量套件复跑记录」 |

**全量套件复跑记录（四数据点，含本门禁独立复跑）**：SA3（2041/2043 + 2 例零改动文件负载超时）、SA4（2043/2043 + 2 个 vitest-worker RPC 超时）、SA7（2043/2043 + 2 个 RPC 超时）、**本门禁（2026-08-31 02:42，460.5s：Test Files 176 passed (176)；Tests 2043 passed (2043)；Type Errors: no errors；Errors 2——堆栈位于 `node_modules/.pnpm/vitest@3.2.7…/dist/chunks` 的 `Timeout._onTimeout`，与 N3 签名逐字同形）**。四数据点一致：**测试层面 100% 绿**，exit 异常均源于并行负载下的 vitest 基建 RPC 超时（非测试失败、非被测代码 unhandled rejection，超时文件本票零改动）——SA4 N3/SA7 §3 已立案归因。

**CI 触发面（可执行契约变更纳入 CI）**：`.github/workflows/ci.yml` L36 `pnpm typecheck`、L39 `pnpm test` → `vitest.config.ts` include `packages/*/test/**/*.test.ts` + `*.test-d.ts`——本票 22 个变更测试文件（21 改 1 新增）+ `ws-replication-api.test-d.ts` 全部落于 glob 内，**无 workflow 层触发缺口**（SA4 E2 + 本门禁复核 ci.yml/vitest.config.ts 行号）。

**判定**：满足。本地等价证据（同命令）全绿；CI run 本身见 §VI-开放项 1。

---

## VII. 开放项（非 AC 未满足——性质与归属判定）

| # | 事项 | 性质 | 归属/建议 |
|---|---|---|---|
| 1 | CI 绿证据（GitHub runner 上 `pnpm test` 全绿日志摘取） | **流程性挂起**：实现 commits 未推送、无 PR、无 CI run（SA7 §5 Step-4 分类 = `pending-publication`，非触发缺口）；本地同命令三数据点全绿 | **总控**：`mabf_task_publish` 产生 PR run 后摘取 `Test Files N passed` 原文；若 runner 复现 N3 形态基建超时，另立票（不回流本票、不退任何 SA） |
| 2 | R1-3 严格接纳 pipeline 判据缺口的修复路由 | **裁决挂起**：缺口本身已按 AC 要求三线登记（phase 偏差表 + it.fails 锚 + 验收锚段存在性契约），非登记缺失；仅「修到哪张票」待裁 | **总控/SA1**：裁决并入 #169 背压域扩 scope 或新立 issue；行为修复时由该票的 SA3 摘标 |
| 3 | SA7 O1：`ws-replication-sa7-r2-transport.test.ts` 标题/行内注释仍写『缺省额度』而实际为显式 64_000（#172 后缺省 = 8 MiB） | **叙事滞后（非阻断）**：行为断言正确且绿，不影响契约登记；SA7 按「仅新增」纪律未越 R2 固定范围改动 | 无需本票回流；建议随 #169 路由或下一次触碰该文件时由 **SA3（测试叙事）** 顺手对齐 |
| 4 | 全量套件并行负载下的 vitest-worker RPC 超时（SA4 N3/SA7 §3） | **既有基建敏感面**：三数据点错误形态一致、超时文件本票零改动 | 若 CI 复现则另立基建票处理 |

---

## VIII. 门禁结论

**6/6 Acceptance criteria 全部满足（✅），无未满足项，无需退回任何 SA。**

- 五项 scope 要求与六项 AC 的落点均有一手可复核证据（文件行号 / 独立重跑命令与输出）；
- 上游判决链完整：SA8×2 clear → SA6 16 锚 → SA1 R3 → SA2 R3 pass → SA3（c271476 + 3141884）→ SA4 R2 pass → SA7 pass（dispatch log L5-18）；
- 遗留事项全部为流程/裁决挂起项（§VII），均已正确登记归属，不构成本票 AC 缺陷；
- 建议总控：发布（补 CI 摘证）+ 裁决 R1-3 路由后合入。

## IX. 可重跑命令清单（本门禁验证用）

```bash
WT=/home/wangjian/nomicore-fix-issue-172; cd $WT
# AC-1 权威措辞门禁（预期：零命中）
git grep -nE "契约来源：wiki|设计基准：wiki|以 wiki/raw.*为准" -- 'packages/**' 'apps/**' 'docs/**' 'CONTEXT.md'
# AC-2/AC-4 值对齐位点
sed -n '29p' packages/ws-replication/src/types.ts          # maxQueuedControlBytes 字段注释
sed -n '28p;41,42p' packages/ws-replication/src/defaults.ts # 8MiB / 30_000 / 10_000
sed -n '153,158p' packages/ws-replication/src/validate.ts   # 链式下界 TypeError
sed -n '492p;504p;524p' docs/protocols/instance-replication-v1.md  # §17/§18 冻结值
sed -n '164,171p' docs/phases/phase-5-websocket-replication.md     # 已知偏差表 6 行
# AC-5 恒真扫描（预期：仅 2 处且均非恒真——indexOf 在场 / 负记账守卫）
git grep -nE "toBeGreaterThanOrEqual\(0\)" -- 'packages/ws-replication/test/**'
# AC-6（预期：exit 0 / 23 文件 172 测试全绿）
git diff --check; git diff --check ef19bae HEAD
pnpm typecheck
pnpm exec vitest run packages/ws-replication/test --typecheck --passWithNoTests=false
```

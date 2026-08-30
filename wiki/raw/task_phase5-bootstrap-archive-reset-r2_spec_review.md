# 终审报告（规格轴 / Spec reviewer）— issue #133 round=2「Phase 5: bootstrap import, archive, and guarded replica reset」

**Verdict**: blocking（1 项阻断发现：R2-AC-6 的 `git diff --check` 子项在 HEAD 不成立且 AC 门禁证据失实；其余全部规格维度核实通过，修复为文档级一行清理 + 门禁记录更正）

- **审查对象（diff 范围）**：`git diff 6784645..HEAD`（HEAD = `f34179d2922be9e7d406241b0b36bf4df8599b0e`；worktree `/home/wangjian/nomicore-fix-issue-133`）。
- **规格基准**：任务简报 `task_phase5-bootstrap-archive-reset-r2.md`（反馈 1/2/3 全文 + R2-AC-1..6）；定稿设计 `…r2_design.md`（R3，514 行）；SA2 R3 pass 红线清单（`…r2_sa2_review.md` L132-189）；SA4 全量 + 增量报告（`…r2_sa4_review.md`、`…r2_sa4_review_incremental.md`）；AC 门禁表 `…r2_ac_checklist.md`。
- **审查方式**：全 diff 逐块独立阅读（不采信前序报告结论）；关键实现与设计伪码逐行对照；测试断言强度核实；并**亲跑独立验证**（后台独立进程）：`pnpm test` → 147 文件 / 1757 用例全绿、Type Errors no errors、exit 0（`/tmp/spec-review-133/full-test.log`）；`pnpm typecheck` → exit 0（`/tmp/spec-review-133/typecheck.log`）；`git diff --check 6784645..HEAD` → **exit 2**（见发现 B-1）。本轮未修改任何文件（除本报告）。

---

## 一、阻断发现清单

| # | 严重度 | 发现 | 证据 | 要求处置 |
|---|:--:|---|---|---|
| B-1 | **BLOCKING（门禁诚实性；修复本身为 trivial 文档清理）** | R2-AC-6 明文子项「`git diff --check` 干净」在 HEAD **不成立**：`git diff --check 6784645..HEAD` 实际 exit 2——`wiki/raw/task_phase5-bootstrap-archive-reset-r2_sa7_report.md` 第 3/4/5/49 行存在行尾空白（markdown 双空格硬换行形态）。该空白由 SA7 报告提交 `24db0fa` 引入（`009c697` 已清理此前的 SA4 增量文件违规，`009c697` 处 diff --check 为 exit 0；`24db0fa` 与 `f34179d` 处均为 exit 2）。SA7 报告「非阻断记录」自陈 diff --check 返回 2 但归因于已被清理的 SA4 增量文件；AC 门禁表 R2-AC-6 证据栏却记录「`git diff --check 6784645..HEAD` exit 0」——**该记录在 HEAD 上与事实不符**。 | 本 reviewer 亲跑：`git diff --check 6784645..HEAD` exit 2，输出 4 处 trailing whitespace（全部位于 sa7_report.md）；逐 commit 复核：`6784645..009c697` exit 0、`6784645..24db0fa` exit 2、`6784645..f34179d` exit 2。 | ① 清理 sa7_report.md 第 3/4/5/49 行行尾空白（文档级、零行为影响；仓库本轮已有两次同类清理先例 `de446f9`/`009c697`）；② 更正 AC 门禁表 R2-AC-6 证据栏为清理后实测结果；③ 封口终验前重跑 `git diff --check 6784645..HEAD` 确认 exit 0。 |

**为何判 blocking 而非 clear**：R2-AC-6 把「`git diff --check` 干净」写为验收子项，AC 门禁是其唯一放行依据；门禁记录声称的 exit 0 在 HEAD 上可被任何人以一条只读命令证伪。规格轴终审的职责是在封口头前拦截失实的 AC 证据。该发现不影响任何行为正确性结论（下文全部维度核实通过），修复成本极低，故阻断范围严格限于本项。

## 二、非阻断观察（登记，不要求处置）

| # | 级别 | 观察 |
|---|:--:|---|
| N-1 | INFO | AC 门禁表 R2-AC-3 证据锚「registry.ts:1875-1878 入口零副作用快照」行号已漂移（R-FIX-1 提交使入口下移；HEAD 实际锚为 `registry.ts:1888-1892`）。证据实体真实存在且充分，仅行号引用陈旧，建议门禁记录更正时一并刷新。 |
| N-2 | INFO | SA3 修复轮对 R-FIX-1 采用 SA4 全量报告所列 A' 变体（`InvalidIdentityIssue.field` additive 扩展 `'expectedLocalIdentity'`，复用既有 `NAMESPACE_INVALID_IDENTITY` 码），而非 SA4 推荐的方案 B（新专用码）。SA4 增量复审已正式裁决该变体成立（`…sa4_review_incremental.md` §2：append-only、无 caller ripple、无未经评审的新冻结词汇）。规格面核实：该处置更贴近设计 §3.2 原文（「沿既有 `NAMESPACE_INVALID_IDENTITY`…处理」），未引入新 code/message，不构成冻结词汇违约。 |
| N-3 | INFO | `runResetSlot` ③ closing 分支 `await current.closePromise!` 失败路径（registry.ts:1599-1604）throw fatal 前不再派发 `lifecycle-slot-failed` observer 事件（round-1 同位有派发）；与设计 §3.4 伪码一致，属设计内行为演进，非偏离。 |

## 三、反馈处置逐项裁决

### 反馈 1（resetReplica 前置身份核对与竞态）→ **落实，证据真实充分**

- **破坏性动作前双源核对**：`runResetSlot` 冻结次序为 ① owner → ② capability 前置门（archive + committed probe + Runtime fence，registry.ts:1572-1595，缺失即 branded fatal committed:false、零 Persistence 触达）→ ③ closing generation 重评估（await 既有 closePromise → carrier 槽重读 → 仅一次非破坏性 probe 分类，registry.ts:1597-1631）→ ④ 无 entry probe 判别（registry.ts:1633-1642）→ ⑤ active generation 的 Runtime reset-fence 槽（registry.ts:1644-1662 → runtime.ts:231-281 `createBeginResetFence`：同一 FIFO 槽内 `await readPersisted()` 后取 live 投影，双源 exact equality 判定，全部先于任何 forceRelease/close/archive）。mismatch 唯一返回点 `fence.kind === 'mismatch'` → `RESET_IDENTITY_MISMATCH_ISSUE`（registry.ts:1658-1660），结构性先于 armed——armed 后无 mismatch 出口（⑦ 走 `mapArmedArchiveFailure`，registry.ts:1752-1769，与 §3.5.2 冻结矩阵逐行一致）。
- **不匹配零破坏、generation/lease 保持可用**：fence mismatch 时 Runtime lifecycle 未被触碰（arm 只在双源全等后同步发生，runtime.ts:270）；r2-red 测试 L357-446 三用例（lineage 不符/epoch 不符/live disabled）逐项断言 lease active、lifecycle ready、读路径可用、`archiveCalls === []`。
- **dirty 竞态测试真实性**：r2-red describe@L451：竞态 A（L504，expected=persisted 旧 / live 已 bump 至 epoch 2）与竞态 B（L534，expected=live 新 / persisted 仍旧）使用**真实 MemoryPersistence + hook store**，以 `decodeStoredIdentity(store, primaryKey)` 字节级解码断言 persisted 仍 = epoch 1（L529/L558）、无强制 flush、`store.has(primaryKey)`、lease/runtime 原样——真实覆盖，非 mock 凑数。严格双源口径冻结于设计 §2 R2-D1/D2 与 §3.1，并写入 ADR 0010 修订 §4。
- **persisted 真相源正确性**：probe 不经 cache-hit `loadDoc`（避免 live alias），新增只读 committed-snapshot probe（persistence/lifecycle.ts:377-437）：disposed 门 → io.read（同步 throw → adapter-violation）→ epoch 判别（operational vs read-aborted）→ missing → detached Y.Doc 解码（decode/META 载体/docId 违约 → Corrupt）→ `readPersistedReplicaFacts` 判据族（与归档 verify 同一函数）→ finally destroy。零 cell/handle/saveDoc/flush/archive。§3.3.1 三分类在 Registry 侧由 `mapProbeOrFenceFailureBeforeDestruction`（registry.ts:1729-1749）逐条映射：仅 Operational → `NAMESPACE_LOAD_FAILED`；Corrupt/Fatal/unknown → branded fatal committed:false。internal 测试 D（closing 矩阵 L500-593）/E（probe 映射 L597-643）/B（缺失 fence capability loud 门 L424-457）逐项锚定。
- **无自等待协议**：fence 槽内绝不创建/await close barrier；`startCloseAfterFence()` 由槽后 continuation 懒创建并与公共 `close()` 共用单 `closePromise` 幂等缓存（runtime.ts:363-369、466-471；close.ts:38-40 `enqueueCloseBarrier`）。runtime 测试 T2（同 Promise 两序）、T3（gate 挂起有界结算）、T4（arm 前窗口已接纳 bump 按 ADR-0008 排空）真实覆盖 SA2 R3 红线 1/2。

### 反馈 2（importReplica 绑定 Hub 广告身份）→ **落实，证据真实充分**

- **绑定方式**：`importReplica(owner, namespaceId, doc, expectedReplicationIdentity)` 第四参数（types.ts:508-513 公共签名；surface 类型锚 `registry-phase5-bootstrap-reset-r2-surface.test-d.ts` L37-45 锁四元组；round-1 surface 锚同步演进）。
- **核对冻结在 ownership 转移前**：公共入口先 `snapshotReplicationIdentityRef` 安全快照（registry.ts:252-280，proto 门/own data descriptor/正则/safe-integer/getter+Proxy throw 收编/冻结快照），失败 → `NAMESPACE_IMPORT_EXPECTED_IDENTITY_INVALID`，零 doc 访问（registry.ts:1888-1892）；槽内次序 ②a docId → ②b 格式 → **②c exact equality（registry.ts:1462-1469）→ ③ capability → ④ importDoc（首个 ownership 转移点）**。
- **拒绝测试真实性**：r2-red describe@L566：lineage 不符（L567-587）与 epoch 不符（L589-608）断言 `NAMESPACE_IMPORT_EXPECTED_IDENTITY_MISMATCH` + `importCalls === []` + loadDoc null + open → NOT_FOUND（零 entry）；真实 Memory 用例（L610-662）断言 store 零残留 + 正确 expected 重试成功（key 未毒化）。敌意 expected 16 形态矩阵（internal describe C @L461-499）断言零 doc.getMap/零 importDoc/零 entry。R-FIX-1 修复后 reset 侧同矩阵（internal describe @L647-677）以 `probeCalls === []` 分界锚断言零 Persistence 触达 + 重试成功；TOCTOU 冻结快照用例（L679-699）与 F-1 observer 用例（L704-738）均真实。

### 反馈 3（ADR 规范修订）→ **落实**

- **ADR 0006**（diff +12 行，`docs/adr/0006-server-persistence-docstore.md:206-216`）：追加节「复制导入、归档与只读身份探针修订（2026-08-28，issue #133 round-2；owner feedback 3 授权）」正式记录：① `importDoc` 排他创建契约 + Hub 广告等值核对为调用方前置条件（Persistence 不为策略引擎）；② `archiveDoc` 前置条件/守卫谓词/分类与 committed 语义；③ 归档布局 `{rootDir}/archive/users/{userId}/{docId}.snapshot` + tmp→rename 原子提交 + latest-wins + **提交边界 = 归档写 resolve**，remove 失败 = `DocArchiveFatalError('relocate-remove')` committed:true、Registry 原样传播、latest-wins 收敛重试；④ 只读 probe 契约（零副作用清单 + typed 拒绝面 + committed:false + 非 live 降级）。
- **ADR 0010**（diff +14 行，`docs/adr/0010-hub-peer-websocket-ydoc-replication.md:225-238`）：追加节「issue #133 round-2 reset/import identity precondition 修订（owner feedback 3 授权）」明示取代旧「先 close 再归档」次序与一般性 META 核对条款（§0 取代声明），正式记录：§1 reset 严格前置双源核对次序 + closing 重评估分类；§2 fence/close 二段无自等待协议与冻结成功次序；§3 import 绑定 Hub 广告身份 + 转移前完全一致 + 零写入零 entry；§4 dirty 非 durable 诚实表达；§5 归档 committed 诚实 + armed 后 §3.5.2 矩阵。
- 两段均为 append-only 修订体例（含 scope/取代/授权声明，与两 ADR 既有修订段格式一致），经 SA8 前置 + R2/R3-delta 三轮复审 clear（`…r2_design_conflict_report_r3.md` verdict clear）。`wiki/raw/*` 全程仅作流水线档案/历史证据，规范记录落在 ADR——反馈 3 第二句满足。

## 四、缺失/部分需求、scope creep、疑似不正确行为

- **缺失/部分需求**：未发现。R2-AC-1..5 全部有实现级 + 测试级证据；R2-AC-6 的测试/类型子项经本 reviewer 独立复跑证实（147/1757 绿、typecheck exit 0），唯 diff --check 子项失实（发现 B-1）。
- **Scope creep 审计**：diff 共 38 文件。生产改动全部落在设计 §8 ALLOW LIST；三处超清单改动均有授权链且非行为性：① `observer.ts` +6 行（`reset-archive-after-arm-failed` 事件——设计 §3.5.2 明文要求，SA4 关注项 4 追认为 §8 簿记缺口）；② 3 个 `package.json` patch bump（仓库既有惯例，SA4 F-6 登记）；③ round-1 测试校准 3 文件（4 参签名结构性强制全部既有调用点适配；总控 dispatch 注记明示授权；逐块核实为机械第 4 参 + stub probe fixture 补充 + sa7 动态机械适配；「并发 open+reset」一拆二为逐序精确断言并新增零归档/恢复锚——**强度增强而非削弱**，行为演进有 SA2 R1-1 冻结依据）。**DENY LIST 零命中**（replication-write.ts、replication-protocol、ws-replication、apps、lease.ts、phase-5 文档均未触碰；`namespace-runtime/src/index.ts` 零 diff——`beginResetFence` 以 non-enumerable 键挂载、不进公共 barrel，grep 证实；`packages/namespace-registry/src/index.ts` 零 diff）。
- **疑似不正确行为独立推演**（超出 SA4/SA7 清单的自查）：fence 挂起窗口 × idle-close 竞态由 fence 内 lifecycle 防御门 + Registry ③ 分支 + SA7 50 轮并发矩阵覆盖；armed 后 `startCloseAfterFence` 同步 throw/close reject 路径均有 fatal 通道；closing 分支 closePromise 失败不再派发 observer（N-3，设计内）；`mapProbeOrFenceFailureBeforeDestruction` 尾部两分支合并冗余但语义正确。未发现新的行为缺陷。
- **R-FIX-1（前轮必须修复项）**：已消解且经双轮验证——reset 入口快照（registry.ts:1912-1916）镜像 import 侧；internal 测试 15/15 由 SA4 增量亲跑、本 reviewer 复核断言文本属实。

## 五、R2-AC-1..6 逐条对账

| AC | 裁决 | 对账说明（证据锚实测） |
|---|:--:|---|
| R2-AC-1 | ✅ | registry.ts:1644-1662 fence 编排 + runtime.ts:231-281 beginResetFence；r2-red describe@L356 三用例（L357/395/423）拒绝码 + lease active + lifecycle ready + 零 archive 断言逐字核实。 |
| R2-AC-2 | ✅ | r2-red describe@L451：竞态 A@L504 / 竞态 B@L534，真实 Memory + hook store 字节级 decode（L489/499/529/558）；口径裁决冻结于设计 §2 R2-D2/§3.1 与 ADR 0010 修订 §4。 |
| R2-AC-3 | ✅ | 入口快照 registry.ts:1888-1892（AC 表行号 1875-1878 陈旧，见 N-1）；②c 等值核对 registry.ts:1462-1469 位于 ④ importDoc 之前；新码 append-only（types.ts:97-102、325-334）；表面锚 r2-surface.test-d.ts 全绿。 |
| R2-AC-4 | ✅ | r2-red describe@L566（L567/589/610 零写入零 entry + 真实 Memory 重试）；internal describe C@L461 敌意 16 形态；reset 侧 R-FIX-1 矩阵 internal@L647-677（probeCalls 空分界锚 L663/L674）。 |
| R2-AC-5 | ✅ | 实测 `git diff 6784645..HEAD docs/adr/`：0006 +12 行 / 0010 +14 行，内容与设计 §5.1/§5.2 逐条对应（importDoc/archiveDoc 契约、归档布局与原子语义、身份前置条件与冻结次序、probe 契约、committed 诚实、dirty 诚实）；append-only 体例 + 取代/授权声明齐备。 |
| R2-AC-6 | ⚠️ **部分不成立** | `pnpm test` 147 文件/1757 用例全绿 exit 0（本 reviewer 独立后台复跑证实，1757 = 1711 基线 + 46 净增：43 新运行时锚 + 1 并发用例拆分 + 2 类型锚）；`pnpm typecheck` exit 0（独立复跑证实）；**`git diff --check 6784645..HEAD` exit 2（sa7_report.md 行尾空白）——AC 表声称 exit 0 失实，见发现 B-1**。 |

## 六、审查的确切 diff 范围与证据锚记录

- **范围**：`git diff 6784645..HEAD`（HEAD = `f34179d`）；38 文件，+4727/−169。
- **关键证据锚（文件:行号，均为 HEAD 实测行号）**：
  - `packages/namespace-registry/src/registry.ts`:252-280（快照校验）、473-478（reset 敌意输入 issue）、1462-1469（②c Hub 等值核对）、1572-1595（capability 前置门）、1597-1631（closing 重评估）、1633-1642（无 entry probe）、1644-1662（fence 调用与 mismatch/missing 分类）、1668-1695（armed 后破坏段 + I2 记账）、1697-1704（armed archive）、1716-1720（probe 闭包）、1729-1749（pre-destruction 映射）、1752-1769（armed 映射 + observer 事件）、1888-1892 / 1912-1916（import/reset 入口快照）。
  - `packages/namespace-runtime/src/runtime.ts`:231-281（createBeginResetFence）、363-369（lazyCloseBarrier 幂等共享）、466-471（non-enumerable 挂载）；`close.ts`:38-40（enqueueCloseBarrier）。
  - `packages/persistence/src/lifecycle.ts`:377-437（probe 实现）；`contract.ts`（probe 类型与三错误分类，diff 段 226-296 区域）；`memory.ts:155-161` / `file.ts:114-120`（委托）；`testing.ts`（failNextRemove 故障槽）。
  - `packages/namespace-registry/src/types.ts`:97-102（两新 message 常量）、112-122（field 判别字扩展）、293-334（import issue 联合 append-only）、491-513（4 参签名）；`observer.ts`:49-52（新事件成员）。
  - `docs/adr/0006-server-persistence-docstore.md`:206-216；`docs/adr/0010-hub-peer-websocket-ydoc-replication.md`:225-238。
  - 测试：`registry-phase5-bootstrap-reset-r2-red.test.ts` L356/451/566/667；`registry-phase5-bootstrap-reset-r2-internal.test.ts` L343/424/461/500/597/647/704；`runtime-phase5-reset-fence-r2.test.ts` T0-T4（L126/151/174/219/267）；`persistence-phase5-bootstrap-reset-r2.test.ts` P1-P8（L136/171/184/279/349）；`registry-phase5-bootstrap-reset-r2-surface.test-d.ts` 全文件。
- **本 reviewer 亲跑验证**：`pnpm test`（147/1757 绿，exit 0，`/tmp/spec-review-133/full-test.log`）；`pnpm typecheck`（exit 0，`/tmp/spec-review-133/typecheck.log`）；`git diff --check 6784645..HEAD`（exit 2，唯一违规文件 sa7_report.md L3/4/5/49）；逐 commit 定位引入点 `24db0fa`。

---

# R2 复审段（B-1 修复 + R4 增量规格复审）

**Verdict**: clear

- **本轮审查的确切 diff 范围**：`git diff f34179d..HEAD`（HEAD = `f9c1b64570e3ec98a26e1556c48524b14c9d3af6`；12 commits：B-1 修复 `f2ae9c9`、双轴 R1 裁决 `4bd1c62`、R4 链 `9ca1d21`→`00f2fb2`→`e26ca94`→`1aa1994`→`d52130b`→`650c4d9`→`7a02474`→`6d33358`→`728a4c7`→`f9c1b64`）；并对全量范围 `git diff 6784645..HEAD` 复核 diff --check 与测试/类型声称。R1 段全部结论继续有效（R4 未触碰 fence/probe/import/ADR 路径，回归经亲跑证实）。

## 1. B-1 处置核验（三点要求）→ **全部满足**

| 要求 | 核验结果 |
|---|---|
| ① 清理 sa7_report.md 行尾空白 | ✅ `f2ae9c9` 移除 L3/4/5/49 行尾双空格（diff 实测）；后续 `7a02474`/`f9c1b64` 又清理了 SA4 R4 段新引入的同类空白（SA7 R4 §4 曾如实记录该处 exit 2，处理链完整） |
| ② 更正 AC 门禁表证据 | ✅ AC 表追加「更正记录（双轴终审规格轴 B-1 处置）」：明示原测量点为 `009c697`（当时 exit 0）、`24db0fa` 重新引入、HEAD 实测 exit 2 的发现属实与处置——事实陈述与本 reviewer 逐 commit 复核结论一致 |
| ③ 重跑确认 exit 0 | ✅ 本 reviewer 亲验：`git diff --check 6784645..HEAD` @ `f9c1b64` **exit 0**（零输出）。更正记录所述「封口终验重跑」按计划待封口执行，当前已无障碍 |

## 2. R4 对 D-1..D-4 的消解对账 → **全部闭合，无规格回归**

复审基准链：外部 SA2 delta reject（`…r2_sa2_review_delta.md` 第一轮，D-1..D-4）→ 注册总控裁决「采信方向、不采信产物、回退外部未提交改动、走注册链」（dispatch #24，技术主张独立核实属实——本 reviewer 复核该核实成立：R-FIX-1 的 A' 变体确实使 `field='expectedLocalIdentity'` 与恒定 message「owner.userId 或 namespaceId 不符合安全文法」自相矛盾，遗留同类误诊向量）→ SA1 R4 微设计 §3.6（`00f2fb2`）→ 注册链 SA2 R4 delta **pass**（`…r2_sa2_review.md` R4 段，行号引用 §3.6.1:293-304 与提交版实测一致——即被审版本就是压缩后的提交版）→ SA3 逐块审计采信外部候选 `1aa1994` + 追加锚 `d52130b` → SA4 R4 增量 pass → SA7 R4 定向复跑 pass。

| 项 | 消解证据（HEAD 实测） | 裁决 |
|---|---|---|
| D-1（共享 field 联合未授权扩宽） | `types.ts:117-121`：`InvalidIdentityIssue.field` 已回退并冻结为 `'owner.userId' \| 'namespaceId'` 二元；设计 §3.6.1 明文「不得把 `'expectedLocalIdentity'` 加入该共享 field 联合」；编译期锚 `r2-surface.test-d.ts:84-103` 以 `Equal` 恒等锁 Open/Create/Import/Reset 四公开联合的 field 仍为二元 | ✅ |
| D-2（message 与缺陷字段自相矛盾） | `types.ts:103-105`：新增 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID_MESSAGE`，文本与 SA2 delta D-2 建议逐字一致；`registry.ts:474-478`：`RESET_EXPECTED_IDENTITY_INVALID_ISSUE` 无 field 成员、判别完全由 code 承载（与 import 侧无 field 先例对称）；零插值零回显 | ✅ |
| D-3（测试未锚新分类学） | internal 测试 L663-680：16 敌意形态逐项完整 `toEqual({ok:false, code, message:导入常量})`（toEqual 拒绝任何多出 field）+ 逐形态 `probeCalls=[]/archiveCalls=[]/lease active/ready` 移入循环内 + L682-685 常量文本字面量锁；新增 owner/namespace 边界用例（L726-757）锚上游 `NAMESPACE_INVALID_IDENTITY` 二元 field 不被劫持；surface 类型锚锁新码可达且无 field 键 | ✅ |
| D-4（F-1 标题过宽） | internal 测试 F-1 `it` 标题已收窄为「cause 零身份值回显」，断言体不变 | ✅ |
| R4-F1（三码表 mismatch 措辞） | 设计 §3.6.2 触发条件已逐字采用 SA2 批准句「expected 合法但 live 或 persisted 任一 `identityEquals` 为 false（含该侧 disabled、身份不合规、值不等）」——与 §3.1 严格 AND 通过条件等价，SA6 竞态 A/B 语义不变 | ✅ |
| R4-F2（delta 引用形态） | 设计 §3.6.3/§SA2 回应表已改「SA2 delta §5 第 1/2 条」形态，无失准子节引用残留 | ✅ |

**规格回归排查**：R4 生产 diff 仅 `registry.ts`（issue 常量替换 + 入口注释更新 + F-2 注释修正）与 `types.ts`（常量新增 + field 回退 + ResetReplicaIssue append-only）；`runResetSlot`/fence/probe/import/ADR 零改动；严格双源语义经 SA2 R4 显式等价论证并经 SA6 race A/B 回归（本 reviewer 亲跑全量覆盖）。`NAMESPACE_RESET_IDENTITY_MISMATCH` 等 round-1 冻结词汇零漂移。

## 3. R4 scope 判定（规格轴）→ **在授权范围内**

- 触碰文件（registry.ts/types.ts/r2-internal/r2-red/r2-surface + wiki）全部落在设计 §8 ALLOW LIST 及 R4 注记内；`index.ts` barrel 零改动（新 message 常量不进 barrel、经既有公开 result alias 可达——设计 §3.6.1 明示纪律）。
- 新公开错误码属冻结词汇演进：任务简报设计约束要求「SA1 设计明确提出并经 SA2 评审通过」——§3.6 明确提出 + 注册链 SA2 R4 delta pass，程序闭环满足。
- 同轮顺带的标准轴 F-2/F-4 均为注释/措辞级清理（设计 §3.6.3 授权「不得扩大语义」），diff 核实零行为改动。
- 外部干预处置符合 Runner 边界纪律：采信方向、回退产物、注册链重做，dispatch #24 记录完整。

## 4. 更新后 R2-AC-6 声称独立复跑 → **真实**

| 声称 | 本 reviewer 独立复跑（后台独立进程） | 结果 |
|---|---|---|
| `pnpm test` 147 文件/1760 用例全绿 | `/tmp/spec-review-133/r2-full-test2.log`：`Test Files 147 passed (147)`、`Tests 1760 passed (1760)`、Type Errors no errors、exit 0（1760 = 1757 + R4 净增 3：internal +1 边界锚、surface +2 类型锚，diff 逐处核实） | ✅ |
| `pnpm typecheck` exit 0 | `/tmp/spec-review-133/r2-typecheck2.log`：exit 0 | ✅ |
| `git diff --check 6784645..HEAD` exit 0 | 亲验 @ `f9c1b64`：exit 0 零输出 | ✅ |

（注：本段首次全量复跑因本 reviewer 自身后台命令并发 pnpm 基建碰撞夭折，已清洁重跑取得上表结果；与 dispatch 日志记载的同类基建 flake 一致，非仓库问题。）

## 5. 非阻断观察（登记，不要求处置）

| # | 级别 | 观察 |
|---|:--:|---|
| R2-N-1 | INFO | AC 门禁表 R2-AC-6 行内证据数字仍为 1757（门禁时点真实测量，指向 `.mabf-bg/r2-fix-verify.log`）；R4 后 HEAD 实际为 1760（R4 链 SA3/总控/SA7 三处已各自记录 1760 并经本 reviewer 亲验）。实质声称（零回归/全绿/typecheck/diff-check）在 HEAD 全部成立；建议封口终验时刷新行内数字为 1760，保持证据链与 HEAD 对齐。 |
| R2-N-2 | INFO | `r2-surface.test-d.ts:24-27` 头注「临时形状声明」段落未随标准轴 F-4 一并更新（F-4 授权与设计 §3.6.3 仅覆盖 r2-red 头注）；该段为 SA6 期历史注记，锚本体为冻结形状，无行为影响。 |
| R2-N-3 | INFO | 设计文档 §4/§5/§6 在 `00f2fb2`（SA1 R4 提交）中随同 §3.6 增量做了编辑性压缩（+159/−124）：经逐块比对，压缩仅删减冗长英文释义，冻结决策/次序/锚映射零丢失（§5 压缩摘要与 R2 已交付的 ADR 文本一致——ADR 为规范记录本体）；注册链 SA2 R4 复审的行号引用（§3.6.1:293-304）与压缩后提交版一致，即被审对象确为该版本，不存在「审后偷改」。 |
| R2-N-4 | INFO | 新公开码 `NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID` 记录于设计 §3.6 但未入 ADR 0010 修订节。R2-AC-5 枚举（importDoc/archiveDoc/归档布局/身份前置条件与操作次序）不含输入校验码粒度，前置条件与次序已在 ADR 0010 §1 规范记录；登记备查，不构成缺口。 |

## 6. R2 复审结论

B-1 三点处置全部满足；R4 完整闭合 D-1..D-4 与 R4-F1/F2，未引入规格回归，变更在反馈授权与冻结词汇演进程序内；更新后 AC-6 三项声称经独立复跑全部证实。R1 段对 R2-AC-1..5 的 ✅ 裁决与证据锚在 HEAD 上继续有效。**规格轴对 `6784645..f9c1b64` 全量范围 verdict：clear，可进入封口终验。**

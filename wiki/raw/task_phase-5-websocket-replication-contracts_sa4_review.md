# SA4 静态验尸报告 — Issue #172 Phase 5 权威契约收敛

**Date**: 2026-08-31
**Reviewer**: SA4（Red Team，静态绿光验尸）
**被审对象**: 基线 `ef19bae` → HEAD `c271476`（SA3 实现全量 diff，47 文件 +2206/−142）
**设计基准**: `wiki/raw/task_phase-5-websocket-replication-contracts_design.md`（R3，SA2 R3 = pass）
**Verdict**: **reject（窄域：单一阻断簇 F1 + 2 项顺手修）** —— 代码与测试工作全部验证成立；阻断项是**文档交付物内部的归类失实**，恰好落在本票「契约收敛」的核心承诺上。修复为纯文档级（phase 文档 + impl 记录），无生产代码改动。

---

## 0. 验证方法与证据基线

本报告所有结论均有可重跑命令 + 实测输出支撑（关键实验逐条列出；全套复验命令见 §6）。
运行环境：worktree `/home/wangjian/nomicore-fix-issue-172`，分支 `fix/issue-172-on-docs-phase-5-websocket-replication`，HEAD = `c271476`。

| # | 验证项 | 方法 | 结果 |
|---|---|---|---|
| E1 | 范围护栏 | `git diff --name-only ef19bae HEAD` − design §7 ALLOW − 白名单；BLACKLIST/DENY 比对 | **零 creep、零黑名单、零 DENY 触碰**（47 文件全部落在 ALLOW + wiki 白名单内） |
| E2 | vitest 触发性 | `.github/workflows/ci.yml` L39 `pnpm test` → vitest include `packages/*/test/**/*.test.ts`；L36 `pnpm typecheck` 含 ws-replication tsconfig | 新增 anchors 文件 + test-d 均被 CI 覆盖 ✅（无 playwright spec 改动，§1.3 门禁 N/A） |
| E3 | G1 源码收敛 | 逐文件 diff 对照 design §3.1 | types/defaults/validate/backpressure/index **逐项吻合**（字段名/8MiB/链式下界 TypeError/记账判据/导出集零变化） |
| E4 | 设计 §5 门禁 ①②③ | grep 复跑 | ① `controlReserveBytes`（排除 wiki）= 仅 ADR-0010:314 历史记述 1 处（合规例外）；② 权威性措辞 = 零命中；③ `保守上界\|fail-safe` = 零命中 ✅ |
| E5 | ws-replication 全套件 | 独立进程 `pnpm exec vitest run packages/ws-replication/test --typecheck` | **23 文件 / 172 tests 全绿，Type Errors: no errors，exit 0**（含 anchors 17/17、r1-r7 14/14、r2-transport 真实 TCP 2/2） |
| E6 | 全量 typecheck | `pnpm typecheck`（12 包） | exit 0 ✅ |
| E7 | 全量测试 | `pnpm test`（473s） | **176 文件 / 2043 tests 全部通过**；exit 1 源自 2 个 `vitest-worker: Timeout calling "onTaskUpdate"` RPC 基建错误（非测试失败、非应用 unhandled rejection）——见 N3 |
| E8 | it.fails 双向翻转（独立复演 SA3 §4 自检） | 临时改锚 + 单文件运行 + `git checkout` 还原 | 见 §2 详细证据 |
| E9 | R1-3 KNOWN GAP 真实性 | 去掉 `.fails` 标记运行 + 源码阅读 | 锚确红且红因正确；缺口在代码中确认（见 §3 F1） |

---

## 1. 审核结论（八项总表）

1. **设计一致性**：⚠️ 偏离一处（F1，见 §3）——W-A/W-B/W-C/W-D 四工作流本体与设计逐项吻合（含 T4/T5/T9/T10/T11/T12、§3.4 去权威化 23 处、C1-a/C1-b/C2 落盘与草案逐字一致）；SA3 登记的 3 处实现偏差（impl §3.1/§3.2/§3.3）中，T6-D3b 的算术/⑥ 调整与 T7 触发点后移均验证合理（运行证据 E5 绿）；唯 T7/T8 的**归类陈述**失实（F1-a）。
2. **读写路径一致性**：✅ 无分叉——G1 改名为纯字段收敛，记账机制保留（`backpressure.ts:88` 判据读新字段、`onEmitted:124-127` 记账点、`enterPause/resume` 复位不动），与设计 D1「改动半径收窄」一致；类级直构 fixture（QUEUE_LIMITS/D4_LIMITS）同步改名。
3. **静默失败**：✅ 无新增——构造期新 throw 路径（validateLimits 链式下界）与既有 `pongTimeoutMs < pingIntervalMs` 同相位同步抛出，仓内生产 caller 为零（包 `private: true`、`apps/` 空置），全部 caller = 测试（设计 §9 caller 表逐条核对成立）。8 条 it.fails 的「吸收失败」弱点由 meta 守卫 + 运行证据钉死（E8）。
4. **降级方案**：✅ 无伪降级——D5 近似口径措辞四处（ADR/phase/defaults/backpressure 注释）统一为「净方向取决于冲刷进度」，门禁 ③ 零残留。
5. **极端攻击**：✅ 未发现新漏洞——下界校验对合并结果生效（resolve→validate 时序核对）；`maxQueuedControlBytes = maxBootstrapBytes + 128` 等值边界构造不抛（A1-2b/ D3a 运行验证）；缺省 8MiB 对零覆写用例的波及面（P10 两处）处置到位（r2-transport 显式 64_000、D3b 合法化重设）。
6. **错误处理**：✅ 完整——本票无运行时错误面新增；测试侧 4 组恒真断言全部加固为可失败谓词（ac4:71 `peerFrames('SYNC_STEP1').length >= 1`、r1-r7 `RESYNC >= 1` + `pendingData === 0`、sa7-round2 `toBe(i)`/`>= 1`/`toBe(0)`——逐处核对非真空）。
7. **架构评估**：✅ 可行——it.fails 注册机制 + D2-bis meta 守卫的「锚存在性/摘标同步/标题锚定」三方向反腐烂全部实测成立（E8）；机制选型经 SA2 三轮核验，无需退回 SA1。
8. **过度设计**：✅ 精简——W-A 恰 4 文件 + 5 注释文件；无新抽象层；D3b 重设保留原谓词全集的合法化等价形而非新造场景。

---

## 2. it.fails 完整性与可执行锚（重点验证，全部实测）

**注册面**：anchors 文件恰 8 条 `it.fails`（A2-1:177 / A2-2:187 / A3-1:306 / A4-1:374 / A4-2:407 / A5-1:436 / A5-2:451 / A5-5:522，冻结锚号在标题），8 条现绿锁 + 1 条 D2-bis meta 守卫（:555，`DEFERRED_ANCHORS` 8 项 + `it.fails(` 计数 + 锚号正则），共 17 用例——与设计 §5 矩阵一致。

**独立复演（本审查实测，每次实验后 `git checkout` 还原、工作区清洁）**：

| 实验 | 操作 | 结果 |
|---|---|---|
| 红→记绿方向 + **红因正确性** | A3-1 `it.fails(` → `it(`，单跑 anchors | 恰 2 failed：① A3-1 `pong 超时 close code 必须为 1001: expected 1002 to be 1001`——**与 SA6 任务简报记录的失败模式逐字一致**（断言级红，非 boot 崩溃）；② meta 守卫 `expected 7 to be 8` |
| 绿→记红方向 | A3-2 `it(` → `it.fails(`，单跑 anchors | 恰 2 failed：A3-2 绿被记红 + meta 守卫 `expected 9 to be 8` |
| R1-3 KNOWN GAP | r1-r7 `it.fails(` → `it(`，单跑该文件 | 恰 1 failed：`拒纳必须无条件 RESYNC 声明: expected 0 to be greater than or equal to 1`——**缺口真实、红因正确**（断言级） |

**结论**：it.fails 机制双向语义、meta 守卫三方向敏感性（计数 7≠8/9≠8、锚号正则）、8 锚当前红态与红因——全部独立证实。SA3 §1/§4 自检记录可复现。

---

## 3. 阻断项（单一簇，可共同修复）

### F1【reject】R1-3/T7-D2 新报 known gap 的**归类失实** + phase 文档交付现状未登记（回流目标：SA3 文档修订 + 总控/SA1 裁决路由）

**证据链（三条独立证据互证）**：

1. **协议冻结文本（权威）**：`docs/protocols/instance-replication-v1.md:492`（§17）原文：
   > 「总队列记账 = 每 namespace 排队字节 + socket `bufferedAmount`（**连接级 pipeline**）。溢出触发时按最大排队 namespace 整队丢弃至 queued 侧 ≤ low-water……；**严格接纳**：shed 后（或空队列时）接纳 incoming 仍会越限则拒纳该帧并同批丢弃该 namespace 幸存排队帧，以 needs-resync 声明显影（不静默吞、不静默纳）。」
2. **代码现状**：`packages/ws-replication/src/backpressure.ts:233-245` `enforceConnectionCap` 的记账 = `totalQueuedBytes()`（**仅 Σ 每 ns 排队字节，不含 bufferedAmount**）；暂停段入队路径（`update-channel.ts:67-94` `deliver` → 有界队列）无 pipeline 判据——E9 实测 R1-3 场景触发帧被接纳、RESYNC=0。pipeline 判据仅存在于 live 快速路径（`backpressure.ts:103-104` `tryEmitData` 的 projected 检查），暂停路径未接线。
3. **SA3 归类陈述**：`wiki/raw/task_..._sa3_impl.md:102`「**非冻结语义冲突**——§17 数据面判据口径为『未发送队列上限』，**Σ queued 实现与冻结文本兼容**；设计 P4 的 pipeline 读法是作者层面的偏差」——**该陈述与证据 1 直接矛盾**：L492 的连接级记账明文含 `bufferedAmount` 且协议文本自己使用了「pipeline」一词；「未发送队列上限」（L490）是 per-namespace 队列溢出段落，不是连接级口径。
4. **phase 文档交付现状**：本票同一 commit 落盘的 `docs/phases/phase-5-websocket-replication.md:156` 切片 6 行称「背压（水位/**严格接纳**/shed/control 保留额度）随 #137/#161 交付」，已知偏差表（5 行）**不含**严格接纳 pipeline 判据缺口——而同 commit 的测试文件头（r1-r7:5-7、sa7-round2-dynamic:394-399）登记了该 KNOWN GAP。同一 commit 内文档说「已交付」、测试说「未实现」。

**影响**：
- 违反本票 scope 要求 5 第二句「Do not invent unimplemented behavior. Distinguish current contract, known gap, and planned fixes」——新落盘的「交付现状与边界」节自序承诺「不把未合入行为表述为当前实现」，切片 6 行恰违反之；
- impl 记录的错误归类会误导总控的路由裁决（「兼容」⇒ 无需立项 ⇒ 缺口只存在于测试文件头注释中，无 issue、无 phase 登记、无守卫——三条追责线全断）；
- 该缺口不属 #169（checkpoint cadence）/#170（hub pong）/#171（CLOSE_OK/GOAWAY）任一验收锚范围。

**修复要求（固定复验范围）**：
- **SA3**（纯文档，无代码改动）：
  1. phase 文档切片 6 行追加严格接纳限定注记（单帧拒纳 R1-1/R1-2 + Σ-queued shed 已交付；pipeline 记账 + 拒纳幸存面同批丢弃未接线）；
  2. 已知偏差表追加一行：「严格接纳 pipeline 判据 | §17 L492：总队列记账含 bufferedAmount；拒纳 + 幸存面同批丢弃 + needs-resync | enforceConnectionCap 仅 Σ queued；暂停段入队无 pipeline 检查 | 修复路由：待总控裁决」；
  3. 「验收锚」段落同步登记 R1-3 锚（顺手闭合 N1 的登记面）；
  4. impl 记录 §3.1/§3.2 归类句更正为「冻结语义偏差（§17 L492 连接级 pipeline 记账 + 严格接纳幸存面语义）」。
- **总控/SA1**：裁决修复路由（建议并入 #169 的背压域扩scope 或新立 issue；R1-3 it.fails 锚随修复摘标）。
- **复验范围（SA4 下一轮只查这些）**：上述 4 处文档修订的 diff + 门禁 ①②③ 复跑 + `vitest run` anchors/r1-r7 两文件保持绿 + phase 文档与 r1-r7 测试头陈述一致。无生产代码与断言改动预期。

### 顺手修（随 F1 一并处理，不单独阻断）

- **N1**：R1-3 的 `it.fails` 无存在性守卫（D2-bis 守卫只读 anchors 文件自身，对 r1-r7 文件的 `.fails` 标记/删锚零信号）。处置：F1-3 的 phase 文档「验收锚」登记即为存在性契约（文档面兜底）；不建议为本票新造第二个 meta 守卫（避免过度工程）。
- **N2**：`git diff --check ef19bae HEAD` 报 `wiki/raw/task_..._design.md:594: new blank line at EOF`——SA3 记录「git diff --check 通过」仅对工作树形态成立，range-diff 对已提交产物报 EOF 空行。纯 wiki 产物、一行修复，随 F1 顺手剥除。

---

## 4. 非阻断观察（登记，交 SA7/总控）

- **N3（全量套件负载抖动 + CI 绿风险）**：SA3 记录全量 `pnpm test` = 2041 passed / 2 failed（`registry-phase5-replication-session-red.test.ts` 两用例 5s 超时；该文件本票零改动、单跑 22/22 绿）。本审查复跑 = **2043/2043 全部通过**，但 exit 1 源于 2 个 `vitest-worker: Timeout calling "onTaskUpdate"`（RPC 基建超时，非测试失败、非应用 unhandled rejection）。两次表现均指向**并行负载下的环境敏感性**，不可归因于本 diff（超时文件未触碰、ws-replication 新增测试仅 ~1s 负载）。**交 SA7/CI 观察**：确认 PR 在 GitHub runner（node 20/24 matrix）上 `pnpm test` 全绿；若复现，属既有基建敏感，另立票处理，不回流本票。
- **N4（版本 bump 裁决，总控问询项）**：`packages/ws-replication` 版本维持 `0.1.2` 未 bump。核查结论 = **非违规**：(a) 仓内无任何版本规约（AGENTS.md/CI/无 changeset/semantic-release 工具零命中）；(b) 包 `private: true`、无外部消费者（设计 §9 已核）；(c) 设计 §7 ALLOW LIST **不含** `package.json`——bump 反而构成 scope creep；(d) 直接先例：PR #165（落地被改名的 `controlReserveBytes` 字段的上一票）同样未 bump（历史上仅大特性切片如 PR #162 bump 过）。若总控希望建立「公共契约破坏性改名须 bump」规约，属新立法，不应追溯本票。
- **N5（it.fails 已登记弱点复核）**：`it.fails` 不区分「因正确原因红」与「因错误原因红」——设计 D2 已登记并接受；本审查以 E8 抽样证实当前 8 锚 + R1-3 均为断言级红（非 boot 崩溃），风险态与登记一致。

---

## 5. 动态审核重点（交 SA7）

1. **CI 绿证据**：PR 的 `pnpm test` 在 GitHub runner 上全绿（对应 N3——本地两次全量运行一次 2 超时、一次 2 RPC 超时，均为负载敏感面）。
2. **真实链路 quota 边界**：r2-transport 显式 `{maxBootstrapBytes: 1_024, maxQueuedControlBytes: 64_000}` 两侧（A 存活 / B 恰 1 ERROR + 1011）在真实 TCP 上复跑（本审查静态套件已含、绿——SA7 摘 CI 日志确认触发即可）。
3. **D3b 校准实测值漂移**：`C_live = 90_793`、ACK=57B、allowed=23、触发后累计 92_104 ≤ 92_128——slack 仅 24B，对 yjs 版本/编码微变敏感；若 CI 环境红，按设计 D4 回退规则升档（D4 校准门分支）。
4. **it.fails 摘标演练**（#169 落地时）：摘 A2-1/A2-2 标记须同步把 `DEFERRED_ANCHORS` 缩为 6 项，否则 meta 守卫反红——该信号即设计意图，SA7 验证时不误判为回归。
5. **F1 修复后的文档一致性**：phase 文档切片 6 行/偏差表与 r1-r7 测试头 KNOWN GAP 陈述一致（若 F1 已回流修复）。

---

## 6. 验证证据（可重跑命令清单）

```bash
WT=/home/wangjian/nomicore-fix-issue-172; cd $WT
# E1 范围护栏（预期：creep 空 / 黑名单空 / DENY 空）
git diff --name-only ef19bae HEAD | sort > /tmp/actual.txt   # 与 design §7 ALLOW 比对
# E4 设计 §5 三门禁（预期：①仅 ADR:314 一处；②③零命中）
git grep -n "controlReserveBytes" -- ':(exclude)wiki'
git grep -nE "契约来源：wiki|设计基准：wiki|以 wiki/raw.*为准" -- 'packages/**' 'apps/**' 'docs/**'
git grep -n "保守上界\|fail-safe" -- 'docs/**' 'packages/ws-replication/src/**'
# E5/E6 套件（预期：23 文件 172 绿 / 12 包 no errors）
pnpm exec vitest run packages/ws-replication/test --typecheck --passWithNoTests=false
pnpm typecheck
# E8 it.fails 翻转实验（改前备份，跑后 git checkout -- 还原）
sed -i "s/it\.fails('A3-1 RED：/it('A3-1 RED：/" packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts
pnpm exec vitest run packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts --passWithNoTests=false
#   预期：2 failed（A3-1 "expected 1002 to be 1011" + meta "expected 7 to be 8"）
git checkout -- packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts
# E9/F1 缺口证据（预期：R1-3 红 "expected 0 to be ≥1"；L492 文本在场）
sed -i "s/it\.fails('R1-3（B1 契约）/it('R1-3（B1 契约)/" packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts
pnpm exec vitest run packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts --passWithNoTests=false
git checkout -- packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts
sed -n '492p' docs/protocols/instance-replication-v1.md          # 总队列记账 = … + bufferedAmount（连接级 pipeline）
sed -n '233,245p' packages/ws-replication/src/backpressure.ts    # enforceConnectionCap = 仅 Σ queued
sed -n '156p' docs/phases/phase-5-websocket-replication.md       # 切片 6「严格接纳…已交付」
sed -n '100,104p' wiki/raw/task_phase-5-websocket-replication-contracts_sa3_impl.md  # 「Σ queued 与冻结文本兼容」
# N4 版本核查
grep -n '"version"\|"private"' packages/ws-replication/package.json   # 0.1.2 / private:true（未 bump = 非违规）
```

---

## 7. 裁决

**Verdict: reject（窄域）。**

- **成立面（全部实测通过）**：范围护栏零越界；G1 公共 API 收敛与 protocol §17 逐项一致；8 条延后锚 it.fails 注册完整、当前红态与红因经翻转实验独立证实、D2-bis meta 守卫三方向敏感；4 组恒真断言全部加固非真空；D3a/D3b/D3c 合法化重构成立（断言③的收口 ERROR 剔除口径与 `hub-connection.ts:397-415` 豁免互证）；去权威化 23 处 + 三道 grep 门禁干净；ws-replication 172 测试全绿 + 12 包 typecheck 零错误；版本 bump 判定非违规。
- **拒绝理由（F1 单一簇）**：本票是契约收敛票，交付物就是「current contract / known gap / planned fix」的准确登记。SA3 实测发现严格接纳 pipeline 判据未实现（真实缺口，R1-3 锚红因正确），但 (a) impl 记录将其归类为「与冻结文本兼容」——被 §17 L492 明文否定；(b) 同 commit 落盘的 phase 文档切片 6 仍把严格接纳整体列为「已交付」、已知偏差表不含该缺口——同一 commit 内文档与测试自相矛盾，违反票面 scope 5「不把未实现行为表述为当前实现」。
- **修复成本**：纯文档（phase 文档两行级修订 + impl 记录归类句更正 + R1-3 登记入验收锚段），加总控/SA1 的路由裁决；无生产代码、无断言改动。**回流目标：SA3（文档修订）+ 总控/SA1（缺口路由裁决）**；修复后 SA4 只复审 §3-F1 固定复验范围。

# SA10 Spec 审查 — issue #299（feat：#295 切片 1：0x42 kind 首字段单形态 codec + 聚合上限配置链）

- **dispatch**: sa-b4bd2bef-7ded-4000-88ed-1b634d428f76（mabf-sa10 / spec-review / iteration 0）
- **审查对象**: 已提交最终交付 commit `f63c2d2822cc19eb76a64d4a3923f26c3ce18c96`（`feat(replication): add kind-first update chunk codec`，分支 `mabf/issue-299`，父 = `eb380d7` = 设计/契约基线 HEAD）
- **Owner 要求**: 无（dispatch 声明 + SA8 §0 / SA6 §2 / SA2 §1 三方实测 REST comments = `[]`，一致）
- **Verdict**: **approve** — issue 正文 What to build 与 AC1–AC4 全部忠实落地；SA6 已批契约三文件 sha256 本轮复测与 §13 锁定值逐字节一致且 26/26 转绿、5 负控保持绿（SA3/SA7 日志）；规范（ADR 0019、协议 §5/§10.3/§17/§22、CONTEXT.md）逐条同源；SA8 R32–R41 全部吸收；无遗漏、无部分实现、无错误实现、无 scope creep。唯一 MINOR 观察项见 §7（不阻断）。

## 1. 审查输入

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报（issue 正文 + AC1–AC4） | `wiki/raw/task_issue-299.md` | 在库 |
| SA6 验收契约（approve） | `wiki/raw/task_issue-299_sa6_contract.md` | 在库；§13 sha256 锁定 |
| 设计（iteration 2，SA2 approve + SA4 M1 台账补正） | `wiki/raw/task_issue-299_design.md` | 在库 |
| SA2 / SA3 / SA4 / SA7 产物 | `wiki/raw/task_issue-299_sa{2_review,3_impl,4_review,7_report}.md` | 在库（全部 approve） |
| SA8 前置门禁 + 设计后复审 | `artifacts/sa8-conflict-gate-issue-299{,-design-recheck}.md` | 在库（clear，R32–R41） |
| 交付 diff | `git diff eb380d7..f63c2d2`（25 个生产/测试/文档文件 + 证据/报告） | 本轮逐文件审读 |
| 规范基线 | ADR 0019；协议 §5 L114–116 / §10.3 L307–345 / §17 L578–615 / §22 L698–701；CONTEXT.md L154–171 | 本轮实测原文 |
| 验证证据 | `artifacts/sa3-issue299-verification.log`、`artifacts/sa7-issue299-{probe-*,transport-suites,post-removal-verify}.log` | 在库（本轮复阅） |

本轮为静态审查（不运行测试、不启动服务）；动态结论引用 SA3/SA7 已提交证据日志并核对契约文件哈希。

## 2. Issue 正文要求逐条对照

| # | 正文要求 | 交付落点（commit f63c2d2 实测） | 裁决 |
|---|---|---|---|
| B1 | 0x42 改写为 kind 首字段单形态并正确编解码 | `payloads.ts` `decodeUpdateChunk`：`readVarUint()` 首读 + `∉{0,1,2}` 立即 `MALFORMED_FRAME`；五字段序不变；`encodeUpdateChunk` 镜像写序（kind 首位）。契约 R1/R2 逐字节往返绿 | 满足 |
| B2 | kind=1 首 chunk 绑定块 replicationId/replicationEpoch、kind=2 首 chunk 绑定块 syncRoundId，往返无损 | 绑定块位置 = totalBytes 之后、bytes 之前（decode 按位读、encode 按位写），与协议 §10.3 L323 逐字一致。契约 R3/R4 + encode-symmetry P2/P3 规范算术锁定向量绿 | 满足 |
| B3 | `kind ∉ {0,1,2}` 或绑定块位置违例（非首 chunk 携带 / kind=0 携带）→ `MALFORMED_FRAME` | decode：kind 门 + 绑定块仅 `kind≠0 ∧ chunkIndex=0` 按位读取（缺块/越位/尾随经 canonical reader 欠载与全消费检查收敛）；encode：iff 严格拒绝十分支。契约 R7–R10 + encode-symmetry ①–⑩ 绿 | 满足 |
| B4 | ADR 0013 六字段旧形态 golden vectors 本分支内改写为单形态 | `fixtures.ts` 三 golden 前缀 `00`/`01`/`02`（BASIC=kind0 / MULTIBYTE=kind1 / U32_MAX=kind2），`GOLDEN` 计数 21 锚不变；契约 R5（旧形态首字节 0x23=35 自动作废）/ R6（首字节 ∈{0,1,2} + 往返）绿 | 满足 |
| B5 | `maxChunkedBootstrapBytes`/`maxChunkedSyncDiffBytes`（缺省各 4 MiB）进入配置链 | `types.ts` 两必填 readonly number；`defaults.ts` 两键 4 MiB（键集 14→16）；`validate.ts` 两 `positiveSafeInteger` 值门；`plugin.ts` `LIMIT_KEYS` +2。契约 C1/C7、api.test-d 类型面绿 | 满足 |
| B6 | `maxChunksPerUpdate`/`maxConcurrentAssembliesPerConnection`/`assemblyTimeoutMs` 语义 kind 无关、键名不变 | 键名零漂移（C1 键集断言恰 16 键 + timeouts 10 键不动）；kind 无关语义在本切片为文档/注释面（协议 §17 已冻结；运行期按 kind 执行属 §8.1/§9.2 后续切片，SA6 §12 范围边界显式排除） | 满足（本切片范围内） |
| B7 | 启动校验链追加两条链②不等式，违例响亮拒绝、绝不运行时 clamp | `validate.ts` 新增 `validateChunkedBootstrapChain`/`validateChunkedSyncDiffChain`（`≤` 含等号、错误消息含三操作数）；hub/peer 构造器在 #244 门块后各加两条 `hasOwnProperty` 守卫，先于字段赋值。契约 C2/C3/C4（40 MiB 隔离违例 / 边界等号接纳 / off-by-one 拒绝 / 两键联立）绿；全 diff 零 clamp | 满足 |
| B8 | `maxQueuedControlBytes ≥ maxBootstrapBytes + 协议开销` 校验原样保留 | `validate.ts` L184/L202 两处置零改动（diff 无条目）；契约 C6（违例 / 边界恰好合法 / 插件既有键装配）绿 | 满足 |
| B9 | 未表达新键的存量配置不误判（非追溯性） | D6 窄门：每条 #295 链②仅由自身新键显式激活（SA8 R38 三层核实为唯一一致读法）；契约 C5(c) 零分块族键存量配置（含 `maxUpdateBytes=32KiB` 反例）接纳绿 | 满足 |
| B10 | 部署前提：同版本部署、无 capability 协商、无向前兼容面 | 全 diff 零 `CAP_CHUNKED_SYNC`/双形态/发送端 gating；0x42 解码侧协商门（payload 解析前 `UNSUPPORTED_MESSAGE_TYPE`，payloads.ts L917–920）原样保留（SA8 R34，负控 N1 绿） | 满足 |

## 3. 验收标准（AC1–AC4）对照

| AC | 要求 | 交付证据 | 裁决 |
|---|---|---|---|
| AC1 | 0x42 单形态 codec：kind 首字段恒在 + 绑定块（仅 kind≠0 ∧ chunkIndex=0）编解码；全字段 golden vectors 改写并冻结 | B1/B2/B4；契约 R1–R6 绿；`codec-issue299-ac-red.test.ts` 冻结向量 `KIND1_FIRST`/`KIND2_FIRST` 逐字节锁定绑定块形态（协议 §22 交付义务兑现） | 满足 |
| AC2 | codec 单帧规则：kind 非法值、绑定块缺失/越位 → `MALFORMED_FRAME` | B3；契约 R7–R10（每例前置相近正控防伪绿）+ R14 编码侧对称 + encode-symmetry ①–⑩/P1–P5 绿 | 满足 |
| AC3 | 两个聚合上限键 + 两条链②进入启动响亮验证；control reserve 校验不变；存量配置非追溯性测试 | B5/B7/B8/B9；契约 C1–C7 + api.test-d 2 类型面全绿 | 满足 |
| AC4 | 三种 kind 共用同一 transferId 计数器（作用域 (连接,方向,namespace) 严格递增不回绕）的语义在 codec/契约层锁定 | `messages.ts` `transferId` 注释升级为「三种 kind 共用同一计数器（ADR 0019）」；字段语义 codec 层锁定（契约 R11：tid=0 三 kind 一致拒；R12：0xffffffff 三 kind 一致接纳往返无损；同一字段位）。计数器本体（`update-channel.ts` 既有 `nextTransferId`）零改动 = DENY 保持，复用约束（不新增第二计数器）在设计 D8/SA6 §15.3 登记——AC4 措辞为「codec/契约层锁定」，与本切片交付精确一致 | 满足 |

## 4. SA6 契约符合性

- **契约三文件零改动**：本轮复测 sha256 = `3168f11c…` / `56a2337b…` / `171104c2…`，与 SA6 §13 锁定值逐字节一致——「不改一行 26/26」转绿判据对象未被触碰。
- **转绿证据**：SA3 日志 §2 契约 4 文件 31/31 绿（26 契约 + 5 encode-symmetry）+ `Type Errors no errors`；SA7 post-removal 52/52 绿复跑结果一致。负控 N1–N3/C5/C6 保持绿（协商门 / 选项急切校验 / 他域回归 / 非追溯性 / control reserve）。
- **契约范围边界遵守**：零新增错误码 / RESYNC reason / observer 事件（SA8 R36 冻结面：registry/observer 零 diff）；绑定块**内容**核对三码未实现（属 §8.1/§9.2，codec 只做 presence/position + 可编码性——与 SA6 §15.6 / 设计 D4 值域边界一致，无越界抢占后续切片语义）。
- **已知上游文档张力（不影响交付判定）**：SA6 契约 §10/§15.4 散文（宽门）与其可执行断言 C2/C3 边界族（窄门）内部不一致——SA8 R38 三层核实裁决窄门为唯一一致读法，设计 D6 诚实登记，实现按窄门落地且契约 26/26 绿。可执行契约是验收权威，散文偏差属 SA6 文档层记录项，非交付缺陷。

## 5. 规范一致性（ADR 0019 / 协议 / CONTEXT.md）

- 字段序 / 绑定块位置 / 单帧规则与协议 §10.3 字段表 + 单形态段**逐字同源**（本轮对照 L307–345 原文）；`kind ∈ {0,1,2}` 首字节即拒符合 ADR 0019「恶意声明在第一个字节流入前即可拒绝」。
- 配置链与 §17 L578–615 同源：两键缺省 4 MiB、两条链②不等式、「显式配置…时**对应**链式校验响亮生效；未表达新键的存量配置不误判」（窄门字面依据）、control reserve 原样保留、「不得运行时 clamp」。
- §22 L701 收口按 R39/D10 二分：codec 向量支「已交付」+ 指向在仓资产（`codec-issue299-ac-red.test.ts` + 改写后 golden）；传输层 kind=1/2 资产支维持「由 §8.1/§9.2 后续切片交付，本规范不预设其存在」——§22 内零「传输层资产已存在」表述；`0x42`/`0x00000001`/四资产文件名锚与 L707 义务句零改动；doc-contract 22/22 绿（SA3 日志 §3）。
- §5/§10.3 其余段 / §13.2 / §17 其余 / CONTEXT.md / ADR 全集零改动（DENY 核对通过）。

## 6. 范围审查（scope creep 检查）

- 交付 diff 25 个内容文件全部落在设计（iteration 2）§11 ALLOW 清单内；DENY 全清单（SA6 契约三文件、传输/assembly 五文件、ADR、协议其余节、CONTEXT.md、`apps/yjs-server/**`、错误码注册表/observer/canonical/envelope）本轮 `git diff --name-only` 逐条核对**零触碰**。
- 唯一曾越 ALLOW 台账的 `ws-replication-observer-red.test.ts` +2 行（编译期必改夹具字面量补全）：SA4 §4-A 五要素静态证明其正确/必要/最小，裁定 MINOR 路由 design；设计 iteration 2 已补 ALLOW 台账——**台账与 diff 现已一致**，闭环。
- SA2 F1–F3（MAJOR）全部落实并经 SA2 iteration 1 approve；SA4 M1 落实；无未闭合 BLOCKER/MAJOR。
- 无静默降级、无 skip/only/todo、无 env override、无 fallback（SA4 §9 / SA3 报告声明与本轮抽查一致）。

## 7. 观察项（MINOR，不阻断 approve）

- **M-Obs1（commit message 覆盖面）**：交付 commit 消息仅题「add kind-first update chunk codec」，未覆盖同 commit 的配置链半面（两聚合上限键 + 两条链② + 插件 allowlist）。改动内容本身完整正确；SA3 建议的详细消息未被采用。建议 PR 描述中补全配置面变更说明（披露义务见 §8）。
- **M-Obs2（上游文档精度，无需本切片行动）**：SA6 §10 对 observer-red 的「构造 0x42 的夹具」描述与事实（仅类型夹具）不符（SA4 N-Obs4）；issue 标题仍含已废弃措辞「CAP_CHUNKED_SYNC 协商 / 双形态」（SA8 R32，正文为准）——建议 reporter 改题，不阻塞。

## 8. PR 必须披露的未达成/移交项（全部为已批范围边界外，非本切片 AC 缺口）

1. **kind=1/2 传输层全链**：发送端（绑定块数据流 + 复用 `update-channel.ts` 既有 `nextTransferId` 共用计数器，不新增第二计数器）、接收端 kind 分派、按 kind 聚合上限运行期执行、绑定块内容核对三码（`REPLICATION_ID_MISMATCH`/`REPLICATION_EPOCH_MISMATCH`/`SYNC_STATE_VIOLATION`）、assembly kind 无关收口、head-of-line 发送端切片——属 #295 §8.1/§9.2 后续切片（SA6 §12 范围边界 / 设计 D8 / 协议 §22 传输层资产支明示）。
2. **AC4 计数器本体**：本切片仅 codec/契约层锁定字段语义（AC4 措辞即「codec/契约层锁定」）；共用计数器在 kind=1/2 发送端落地时执行已登记约束。
3. **接收面中间态**：本切片接收层不消费 `transferKind`，kind≠0 帧流经 live 路径——同版本部署假设下结构性不可达（SA8 R41 已登记；测试不构造该形态经传输层）。
4. **全仓 `pnpm test`（328 文件）**：SA7 技能边界外，按 SA4 §11-1 既定路由移交 Controller 合流前最终动态门；本切片已覆盖受影响两包全套件（protocol 213/213、ws-replication 500/500）+ 根 `pnpm typecheck` exit 0 + 真实 TCP/互通矩阵 41/41。
5. **`apps/yjs-server` 配置文件 allowlist 分块族 catch-up**（含两新键）：家族级 follow-up（设计 §13-2，先例自 #243 起滞后），本切片零改动。
6. **wire-change 新旧互通证据门豁免**：依据 = ADR 0019 同版本部署假设 + 旧六字段形态从未发布 + PR #241 OPEN（SA8 C4 三重实测）——互操作证据面为空集，已在设计 §12/SA3 报告登记。

## 9. 结论

**approve**。交付 commit `f63c2d2` 忠实满足 issue #299 正文与 AC1–AC4：单形态 codec（kind 首字段 + 绑定块 + 单帧规则 + 编码侧严格对称）、golden 改写冻结、配置五面 + 两条链②窄门启动响亮验证、control reserve 保留、非追溯性、AC4 契约层锁定——全部有锁定契约 26/26 绿与负控保持绿支撑；SA6 契约三文件逐字节未动；规范逐条同源；SA8 R32–R41 全吸收；无 scope creep、无未登记的偏差。§8 六项移交/披露项均为已批范围边界外事项，建议在 PR 描述中逐项披露。

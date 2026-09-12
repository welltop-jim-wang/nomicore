# SA8 冲突门禁报告 — issue #246（实现后冲突复审 / conflict-gate recheck）

- **dispatch**: sa-9be6fe7c-91bc-4b96-b3b8-ed8a91226887（mabf-sa8 / conflict-gate / iteration 1）
- **审查对象**: issue #246 已完成实现的当前 diff 与实现证据（基线 `mabf/issue-246` @ `d1888cc`，工作树 3 文档修改 + 2 未跟踪契约测试 + artifacts/wiki 证据）
- **门禁类型**: 设计后/实现后复审（前置门禁 `artifacts/sa8-conflict-gate-issue-246.md` R26–R31 的逐条复核 + 父/依赖上下文与父 PR 冲突面复查）
- **Issue comment REST snapshot**: `[]`（dispatch 声明派发前即时读取；无 owner 补充要求需并入；issue updatedAt `2026-09-10T00:56:27Z` 与简报快照一致）
- **裁决**: **通过（clear）——0 阻塞冲突 / 0 轻微冲突**；R26–R31 全部成立，父 PR 零冲突，3 条非阻塞注意项（见 §5）
- **方法**: 纯只读（git/grep/源码/测试/日志/gh REST 复核）；未改任何代码、文档或测试。技能目录未提供 `sa8-conflict-gate` 技能（加载报 unknown），按系统提示中的 SA8 角色定义执行：冲突基准 = ADR 全集 + CONTEXT.md，代码与 wiki 仅作佐证。

## 1. 冲突基准与效力判定（复核）

基准 = `CONTEXT.md` + `docs/adr/` 全集（14 篇）。全库 status 行复核：**无 ADR 处于 ADR 级被取代状态**（grep 命中均为正文内历史修订记录，与 #244/#245/#246 前置门禁连续裁定一致）；唯一状态变化 = **ADR 0013「提议」→「已接受」**——这正是本票 AC2 预设且前置门禁 C8 裁定为「义务-履行」关系的显式状态翻转，非静默矛盾。ADR 0010 零分块引用（实测 grep 零命中），无双重权威。

## 2. 当前 diff 概览（与 SA4 iteration 1 审查基线逐字一致）

`git diff --stat` = 3 files, 36 insertions(+), 8 deletions(-)；`git diff --check` 干净。md5 实测：File A `f5fc29e684acd0d111704a0946f4fb79`（357 行）/ File B `4e7716518ce5297c7629369a5281e8fb`（687 行）——与 SA4 iteration 1 approve 记录逐字节一致，**SA4 审查后零漂移**。`packages/`、`apps/`、`domains/` 生产面零改动（`git diff --stat -- packages/ apps/ domains/` 空）。

| 文件 | 变更 |
|---|---|
| `docs/protocols/instance-replication-v1.md` | §1 新增「实现代际」词条；§5 gating 注记改挂「v1 代际」；§10.3 占位句替换为完整跨帧契约（transfer 身份/发送端/接收端/错误码三分类/ACK 锚）；§22 两条目（资产全路径锚 + 实现代际互通矩阵） |
| `docs/adr/0013-chunked-live-update-transfer.md` | L4 状态「已接受」+ 两层权威让渡 + observer 词表单列 local seam；L122 关系节同步 |
| `CONTEXT.md` | L142 状态标注清理；UPDATE_CHUNK 词条改挂 §10.3；新增「实现代际」词条（含 _Avoid_） |
| `packages/replication-protocol/test/codec-issue246-doc-contract.test.ts`（新） | File A：D1–D6 文档契约 22 条；断言源仅 `docs/` + `CONTEXT.md`（头注显式禁读 `wiki/raw/**`，实测唯一命中即该纪律声明自身） |
| `packages/ws-replication/test/ws-replication-issue246-interop-matrix.test.ts`（新） | File B：M1/M2/M3 + 数学/分类锚；M2 四条对称回落腿（L564–567）+ interposer 字节对证据 + 三层确定性等同（L571–581） |

## 3. R26–R31 逐条复核（前置门禁约束 → 实现现状）

| # | 约束 | 复核证据（本轮实测） | 裁决 |
|---|---|---|---|
| **R26** | 收口定界：不重复登记、不动冻结面（消息码、字段序、错误码语义、事件键集、配置缺省与校验链） | diff hunk 仅落 §1/§5 注记/§10.3/§22——§5 注册表行（`0x42 UPDATE_CHUNK namespace either UPDATE_ACK`）、§6.1 capability 表（`0x00000001`）、§13.2 注册表与分类句（VIOLATION yes/no/failed、TOO_LARGE yes/config/failed）、§17 配置链（4 MiB/64/4/30_000 +「绝不运行时 clamp」+「ADR 0013 配置表为权威」保留）、§23.1 事件四型、§10.3 六字段序表**全部原样未动**（实测读档核对）。§10.3 新正文的错误码三分类为「触发→码」映射并显式注明「与 §13.2 注册表逐字同向，不得合并叙述」——注册表仍是唯一取值权威，非重登记。File A D5 组即「冻结面只校验」的绿锚载体。三方一致性抽查成立：ADR L58–63（首 chunk 四项校验/几何一致/chunkIndex===已收数量/收齐核对）↔ 新 §10.3 逐条同向 ↔ 实现锚（`update-transfer.ts` validateFirst：声明超限→`UPDATE_TRANSFER_TOO_LARGE`、几何不一致→violation；`update-channel.ts` chunkable 门控 = 已协商 ∧ 超限 ∧ ≤上限，未协商恒 false） | **无冲突** |
| **R27** | v1/v2 三层消歧，防「v2=协议版本 2」误读 | 协议 §1 L18 与 CONTEXT.md 同步新增「实现代际（implementation generation）」词条：`envelopeVersion` 恒 1、`protocolVersions` 不因代际变化、差异仅在 capability wire 位，双侧均带 _Avoid_（「把 v2 代际误读为协议版本 2 / 用代际推断版本变化」）；§5 注记与 §22 均改挂「v1 代际」并回指 §1。协议版本层（标题/§3/`protocolVersions`）零改动 | **无冲突** |
| **R28** | v1-hub 格二选一：testing seam 或等价性论证 + 逐字节断言 | 落地为等价性论证 + 测试域 interposer：生产面零 seam（`hub-connection.ts:64` `HUB_SUPPORTED_CAPABILITIES = CAP_CHUNKED_UPDATE` 原样、src 零 diff）；File B M2 以 interposer 剥除 HELLO capability 位扮演 v1 hub——`helloHubVisible.optionalCapabilities === 0`、`helloAck.selectedCapabilities === 0`（R28 指定断言逐条在位）、同会话原始/重写 HELLO 字节对（等长、差异全落 4 字节窗口 [0,0,0,1]→[0,0,0,0]、重编码等价）、四条对称回落腿（M1 全部行为断言在 v2 peer ↔ v1 hub 格逐条成立：发射侧 send-failed 恰一/接收侧 remote-declared 恰一/wire RESYNC_REQUIRED 恰一/零 UPDATE 与零 UPDATE_CHUNK/≥1 条 >8KiB SYNC_STEP2/收敛）。跨会话等同一律三层确定性形态（kind#sequence / 确定性字段 / Yjs 承载计数），零跨会话字节/长度相等项（SA4 复核 + 本轮文件纪律 grep：skip/only/todo/console.log 零命中） | **无冲突** |
| **R29** | 锚定既有资产，不造旧版包 harness | §22 互通矩阵条目引用五个资产全部实测在库且以仓库根全路径书写（N7 采纳）：`codec-messages-golden.test.ts`、`codec-issue242-ac-red.test.ts`、`codec-version-interop.test.ts`（锁定组合旧/新互通，R29 指定锚）、`ws-replication-issue233-repro.test.ts`（v1 基线）、`ws-replication-issue246-interop-matrix.test.ts`。File B 为 fake-duplex 自备组装 + interposer，零多版本安装机制 | **无冲突** |
| **R30** | 接受时点 vs 父 PR #241 未合并；若 #241 方向性返工须复审 | gh REST 实测：PR #241 仍 OPEN（head `feat/issue-233-chunked-update-base` → base `main`）。**父分支已前进一个 commit `2c95ddc`**（「test(yjs-server): 消除 #229 Hub 重启回归的 backoff 重拨竞态 (#241 CI 红)」）——仅触及 `.github/ci/test-durations.json` 与 `apps/yjs-server/test/hub-restart-static-target-red.test.ts`，与本票改动面（3 文档 + `packages/` 两测试）**文件交集为空**（comm 实测零重叠）；性质为 CI 假红修复，非分块设计方向性返工——R30 复审触发条件未命中。mergeable 字段返回 UNKNOWN（GitHub 未即时计算），以文件级分析为准 | **无冲突**（注意项 N1/N2） |
| **R31** | 两层权威边界显式刻画；「提议」零残留 | ADR L4 + L122 双处显式：wire 冻结值（消息码 `0x42`、payload 字段序、capability/错误码/reason 词表锁定值）→ 协议文档唯一权威；配置语义/设计理据/拒绝备选 → 保留本文「资源上限与配置链」；observer 事件词表单列为 local seam（协议 §23，非 wire 契约）——与 §23 头注零矛盾（F4 修复形态）。协议 §17 现文「issue #242 / ADR 0013 配置表为权威」原样保留，「唯一权威」未误伤配置表归属。过期术语实测全零：`提议`（docs/ + CONTEXT.md 零命中）、`属后续切片`/`后续切片承接`（零命中，占位句已由真契约替换）、ADR 0010 分块引用（零命中）；`git diff --check` 干净 | **无冲突** |

## 4. 父/依赖上下文与实现证据复核

- **依赖链**：#242/#243/#244/#245 全部 CLOSED/COMPLETED（gh REST 实测）；其交付 commits（`c20aeb0`/`e2178f3`/`733b3a7`/`d1888cc`）均在当前分支历史。父 issue #233 OPEN（伞票收尾中，正常）。blocked-by #245 满足。
- **实现证据**（SA3 iteration 3 留档，本轮抽查关键行属实）：File B 4/4 绿 + ×20 重复 20/20 exit=0；File A 绿 22/22 + 红面独立复现 12 failed \| 10 passed（stash 法，md5 还原全 OK）；#233 v1 基线 3/3 绿（AC3 末句）；根 `pnpm test` 304 files / 3261 tests 全绿 exit=0；两包 typecheck + 根 `pnpm typecheck` 绿；AC5 六项文档检查全零命中。
- **SA4 状态**：iteration 1 **approve**（0 BLOCKER / 0 MAJOR；issue246-SA4-F1 已解决并独立确认）——本轮 md5 复核其审查对象零漂移，approve 结论所指向的工作树即当前工作树。
- **交叉 ADR 检查**：ADR 0010（ACK durability/identity fencing/backpressure/停机序）——§10.3 新正文明文「ACK 计时锚 = 末 chunk 出站时刻（`ackTimeoutMs` 语义不变）」「中止复用既有机制」，零语义触碰；ADR 0012——HELLO 字段序冻结，interposer 仅测试域改写 4 字节 capability 窗口且断言其余逐字段相等；ADR 0011/0014、0001–0009 零交集。CONTEXT.md 三分块词条 + 新代际词条与协议用法一致（docs/AGENTS.md 词汇规则满足：新词已登记、双侧同步修订）。
- **零虚构行为**（docs/AGENTS.md「不得发明实现行为」）：§10.3 各条款均能在 ADR 0013 对应节或既有实现锚找到出处；本票零生产代码改动，文档描述的行为全部由切片 1–4 已落地实现承载。

## 5. 非阻塞注意项

- **N1 · 父分支前进 `2c95ddc`**：与本票零文件重叠、零语义交集（CI 假红修复）。合并/变基时无冲突面；总控按常规流程处理即可，无需返工。若 #241 后续再发生**分块传输设计方向性**改动，R30 连续条款仍适用（届时复审）。
- **N2 · PR #241 mergeable=UNKNOWN**：查询时 GitHub 未即时计算 mergeability；以上文件级分析（head 分支与 main 的关系未变 + 零重叠）不构成冲突证据缺口，仅为登记性说明。
- **N3 · 流程交接（非冲突）**：SA7 动态轮义务仍开放——M2 ≥20 次重复零假红的正式验收、真实 WebSocket transport 语境代际互通复核（本票矩阵为 fake-duplex 构型，头注已诚实登记边界）；N-OBS1（File A D2-3 错误码对调不红）已登记后续测试强化票。另：ADR 0013 接受日期登记为 2026-09-10（工作树落地日，SA4 N-OBS3 已接受）。

## 6. 结论

**门禁通过（clear）**。issue #246 的已实现交付与冲突基准零抵触：R26 冻结面全数原样（§5/§6.1/§13.2/§17/§23/字段序表未动，§10.3 为前置门禁认定的唯一实质新增且与 ADR 0013 及实现三方同向）；R27 代际词表三层消歧双侧登记；R28 以等价性论证 + 测试域 interposer 落地且生产零 seam；R29 资产锚全部在库；R30 父 PR 无冲突（前进 commit 零重叠、非方向性返工）；R31 两层权威边界自洽且过期术语零残留。ADR 0013 状态翻转是本票显式预设的接受闭环；依赖链满足；SA4 approve 且工作树零漂移；全量测试与文档验证证据齐备。无设计修订需要冲突复审（requiresConflictRecheck = false）。

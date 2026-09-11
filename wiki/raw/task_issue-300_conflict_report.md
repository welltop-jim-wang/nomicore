# SA8 冲突门禁报告 — issue #300（前置门禁）

- **dispatch**: sa-48b0a704-ca33-41c6-834f-fa453c297486（mabf-sa8 / conflict-gate / iteration 0）
- **审查对象**: issue #300 任务简报「feat(#295 切片 2): chunked snapshot / sync-diff 端到端：R1/R3 收敛绿灯」（任务要求来源 = issue body + ACs，与 `wiki/raw/task_issue-300.md` 快照逐字一致，`gh issue view 300` 实测核对）
- **门禁类型**: 前置门禁（SA 派发前：任务简报 vs ADR 全集 + CONTEXT.md + 规范协议 + 模块 AGENTS）
- **Issue comment REST snapshot**: `[]`（空——与 dispatch 声明一致）——无 owner 补充要求、无 owner 授权 override 需要并入
- **裁决**: **clear——0 hard-conflict / 0 evolution-required / 0 轻微冲突；核心请求全部为 `implements-existing-decision`**；6 条非阻塞就绪注意项（R42–R47）转交 SA1/总控。`requiresConflictRecheck: true`（wire/状态机/失败语义面尚待实现核对）。

## 1. Reviewed subject: task

issue #300 = ADR 0019（已接受，2026-09-15 冻结）的**传输层实现票**（切片 2/3）。请求行为：hub BOOTSTRAP_SNAPSHOT 超 `maxBootstrapBytes` 改道 kind=1 chunk 序列、双向 SYNC_STEP2 diff 超 `maxSyncDiffBytes` 改道 kind=2，均经 data 路径逐帧出站；接收端 assembler kind 泛化 + 首 chunk 绑定块核对 + 分配前二维校验 + 收齐一次 sequenced apply/排他复制导入 + 单 ACK 结算；四新错误码映射；R1/R3 收敛绿灯测试（刻画文件不动）。仅审任务要求与既有决策集的冲突，不评设计优劣与验收完成度。

## 2. Inputs and decision set

- 输入：`wiki/raw/task_issue-300.md`（简报快照）＋ issue #300 正文/AC（REST 实测逐字一致、comments 空）。
- 决策集：`CONTEXT.md` + `docs/adr/` 17 篇（无 ADR 级 superseded；ADR 0013 非目标 #4 条款级取代已显式登记于 L117）+ `docs/protocols/instance-replication-v1.md`（wire 冻结值唯一权威，HEAD 已含 #295 全部规范修订：`2ca06f6`+`eb380d7`+`605a48f`）+ `packages/ws-replication/AGENTS.md`、`packages/replication-protocol/AGENTS.md`（模块契约边界）。
- 关键效力事实：ADR 0019 的「落地时修订协议文档与 CONTEXT.md」义务**已在 docs 提交中兑现**——实现票面对的是**已冻结的目标契约**，不是待修订契约。摘录见 `wiki/raw/task_issue-300_relevant_decisions.md`。
- 依赖：Blocked by #299 成立且已满足——#299（PR #321，commit `605a48f`）为本分支 `mabf/issue-300` 的直接基点（`git merge-base --is-ancestor` 实测）。父 PR #298 的全部 docs 内容已在分支历史，沿用 #244/#245/#246/#299 连续裁定的分支链先例，不阻塞。
- 运行基线：工作树仅未跟踪简报快照，无未提交漂移。

## 3. Decision analysis

| Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| ADR 0019 | 决策 L12「恒用机制（非协商能力）：超过单帧上限的 snapshot / diff 一律分块传输」；发送端 L48 | 超 `maxBootstrapBytes`/`maxSyncDiffBytes` 改道 kind=1/kind=2，经 data 路径逐帧出站（独立 sequence、dataGateOpen、RR、整笔占 1 in-flight 槽、队列持完整载荷惰性切片、control reserve 零 chunk）；未超限仍走单帧路径（触发条件，非兼容回落）；AC3 帧上限/记账 | **implements-existing-decision** | ADR 0019 L12/L48；协议 §8.1 L200–202、§9.2 L236–238、§10.3 L327–332 逐字同源；现状未实现（`hub-namespace.ts` L521–524 仍 BOOTSTRAP_TOO_LARGE 终局、`round-engine.ts` 单帧） | 无——按冻结契约实现；R42/R43 边界约束 |
| ADR 0019 | 接收端/记账 L49–50 | assembler kind 泛化、作用域 (连接,方向,namespaceId,transferId)、bootstrap 期按 OPEN_NAMESPACE 已知 namespaceId 记账且无 Lease | **implements-existing-decision** | ADR 0019 L49–50；协议 §8.1 L202、§10.3 L334–338；#299 落地的 codec/配置为其基座 | 无 |
| ADR 0019 | round/epoch 绑定 L39–43；协议 §8.1/§9.2 | 首 chunk 绑定块核对：kind=1 replicationId/replicationEpoch 对 OPEN_OK 不符 → REPLICATION_ID_MISMATCH/REPLICATION_EPOCH_MISMATCH；kind=2 syncRoundId 不符 → SYNC_STATE_VIOLATION（AC4 前半「绑定块违例映射既有码」） | **implements-existing-decision** | ADR 0019 L41–42（epoch 码）+ 协议 §8.1 L202（id 码显式，wire 权威以协议为准——#299 门禁 R36 已预告归属本切片）；§9.2 L238；三码均在 §13.2 既有注册（L428 等） | 无——#299 设计复审已裁定 codec 层只管存在性/位置，内容核对归本切片，不得越界改 codec |
| ADR 0019 + ADR 0013 | 接收端二维校验/一次性分配/一次 apply L49；ADR 0013 L56–63 | 分配前校验（totalBytes ≤ 按 kind 聚合上限、chunkCount ≤ maxChunksPerUpdate）→ 按已验证上界一次性分配 detached buffer → 收齐长度精确核对 → **一次** sequenced apply / 排他复制导入；重组失败对 live Y.Doc 零写入（AC5 后半） | **implements-existing-decision** | ADR 0019 L49；协议 §8.1 L202、§9.2 L238、§10.3 L337–340（含几何一致校验 totalBytes ≤ chunkCount × maxUpdateBytes ∧ chunkCount ≥ 1——简报为摘要缩写，完整四条以协议为准）；CONTEXT.md「分块复制传输」L154 | 无——SA1 按协议全四条落地（见 R44） |
| ADR 0019 | ACK L47；协议 §8.2/§9.3 | BOOTSTRAP_ACK/SYNC_APPLIED 单 ACK 结算，导入/apply 完成后发出，durability 含义不变；AC1/AC2 的 ackedSequence = 末 chunk 帧序 | **implements-existing-decision** | ADR 0019 L47；协议 §8.2 L211、§9.3 L246、§10.3 L331/L339；ADR 0010 ACK 语义不变（ws-replication AGENTS 同款） | 无 |
| ADR 0019 | 错误码 L68；协议 §13.2 | 声明超限 → SNAPSHOT/SYNC_TRANSFER_TOO_LARGE（fatal/config/failed）；跨帧元数据违例 → SNAPSHOT/SYNC_TRANSFER_VIOLATION（fatal/no/failed）（AC4） | **implements-existing-decision** | ADR 0019 L68；协议 §13.2 L445–448/L450–452、§10.3 L340–342 分类结构（kind=1/2 替换 UPDATE_* 码、聚合上限按 kind） | 无——不得发明码外行为；发送端聚合超限分支见 R45 |
| ADR 0019 | 后果 L98–103；协议 §22 L701 | R1/R3 构型收敛绿灯新增、刻画测试文件不改（AC5）；R1 的 control 路径绕行消除 | **implements-existing-decision** | ADR 0019 L98–99/L103；协议 §22 L701「传输层 kind=1/2 测试资产由 §8.1/§9.2 后续切片交付」；`ws-replication-issue233-repro.test.ts` 在库未改 | 无 |
| ADR 0013 | 非目标 #5（L111：不修订已实现的 CAP_CHUNKED_UPDATE 协商与 v1 回落）；协议 §5 L114、§10.3 L345 | 简报不为 kind=1/2 新增协商/gating（「无协商」仅指不新增 bit）；kind=0 live 路径零触碰 | **no-conflict** | ADR 0019 L16/L111；协议 §5 L114（0x42 消息族协商门一体适用）、§10.3 L345 pre-parse 拒绝 | R43：接收端 kind 泛化必须保留 0x42 pre-parse 协商门（不分 kind），发送端 kind=1/2 出站沿既有 selectedCapabilities 面 |
| ADR 0013 | 非目标 #4（L117 已划除，由 ADR 0019 接替） | 简报请求的 snapshot/sync-diff 分块即该条款内容 | **no-conflict**（条款已被正式接替，不构成约束） | ADR 0013 L117 划线 + ADR 0019 L116；docs/AGENTS.md「Amend or supersede explicitly」 | 无 |
| ADR 0010 | ACK durability/identity fencing/backpressure 分层/停机顺序/排他复制导入（L57、L283 等）；ADR 0019 L116「基线架构 ADR 0010 不变」 | 分块不改导入语义（「与单帧路径同一导入语义」§8.1 L202）、epoch fence 期 partial 整体丢弃（§8.2 L213） | **no-conflict**（扩展而非修订） | ADR 0019 L43/L116；协议 §8.1 L204、§8.2 L213、§11 | 无 |
| ADR 0008 | 单序列器纪律 | 「一次 sequenced apply」恰为该纪律的分块形态 | **no-conflict** | ADR 0013 L61（同一措辞平移）；协议 §9.2 L238 | 无 |
| ADR 0009 | Registry/lease 边界 | bootstrap 分块记账显式无 Lease（协议层按 namespaceId 记账），不涉 Registry 变更 | **no-conflict** | ADR 0019 L50；协议 §8.1 L202 | 无 |
| ADR 0012 / 0018 / 0011 / 0014 / 0001–0007 / 0016 / 0017 | — | 简报不改 plugin 装配/所有权、schema re-arm、诊断日志、VFSL/投影/持久化面 | **no-conflict**（零条款交集） | 各 ADR 状态节；#299 复核第 3 节同款扫描 | 无 |
| CONTEXT.md | 「分块复制传输」L153–154、「同版本部署假设」L165–166 | 简报用词（kind=1/kind=2、恒用改道、单 ACK、partial 零写入）与词条逐字同源 | **no-conflict** | CONTEXT.md L153–166 | 无——本票不引入新术语 |
| ws-replication AGENTS | transport 不得直入 Runtime/Persistence/snapshot/live Y.Doc；导入经公共 Registry lease/ReplicationSession；控制/数据记账为可观测并发契约 | 接收端 assembler 只做字节重组，完整载荷交控制器走既有 apply/排他复制导入 seam（与单帧路径同一语义）；chunk 记账入 data 路 | **no-conflict** | `packages/ws-replication/AGENTS.md` Boundaries 5–7 条；协议 §8.1 L202「与单帧路径同一导入语义」；#243–#245 kind=0 同构先例 | 无 |
| replication-protocol AGENTS | 消息码/错误码 append-only、不得重编号或静默重释；公共 API 经 src/index.ts | 简报零新消息码（0x42 复用）、零新错误码（四码已注册）；codec 面已由 #299 冻结，本票不改 codec | **no-conflict** | `packages/replication-protocol/AGENTS.md`；协议 §5 L116、§13.2 L445–448 | 无——R47 禁止顺手改 codec |

**交叉事实核对**：简报未请求任何 ADR/协议未先修订的行为——所有请求点均能在已冻结文本中找到同源条款；反向核对（全库扫描）`BOOTSTRAP_TOO_LARGE`/`SYNC_DIFF_TOO_LARGE` 死码保留、`CAP_CHUNKED_SYNC` 零存活、双形态措辞零存活，与 ADR 0019 后果节一致。

## 4. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| （无新增 override） | — | — | — |

- 唯一涉及的既有偏离——ADR 0013 非目标 #4（sync 段不分块）与其「未协商端逐字节不变」纪律（限 sync 段）——**已由 ADR 0019 正文显式登记取代/偏离**（ADR 0013 L117 划线注记 + ADR 0019 L116），且协议/CONTEXT 修订已随 docs 提交落地。合法 override 三来源核对：Owner 评论（REST 空，无）、新 ADR（已有 = ADR 0019）、协议版本升级（协议文档已修订）。#300 无需也不得新增任何 override。

## 5. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result |
|---|---|---|---|
| 0x42 payload 形态 | kind 首字段单形态字段序 + 绑定块位置（totalBytes 后、bytes 前；仅 kind≠0 ∧ chunkIndex=0）；MALFORMED_FRAME 单帧规则 | 协议 §5 L116、§10.3 L313/L321/L323；#299 已冻结实现 | 简报仅消费，零改动请求 ✓ |
| Envelope / 消息注册表 | 一 WS message = 一完整 frame、20-byte 头；0x42 注册项（either 方向）；零新消息码 | 协议 §3/§5 L112；replication-protocol AGENTS | ✓ |
| BOOTSTRAP_ACK / SYNC_APPLIED payload | 字段集不变；ackedSequence = 末 chunk 帧序；无新 ACK 消息 | 协议 §8.2 L211、§9.3 L246 | ✓（AC1/AC2 同款表述） |
| 单帧路径 | 未超限 snapshot/diff 仍走单帧 BOOTSTRAP_SNAPSHOT/SYNC_STEP2（触发条件非回落）；不 fallback HTTP/bootstrap、不做无界拆分 | 协议 §8.1 L200、§9.2 L236；ADR 0019 L48 | 简报显式保留 ✓ |
| 错误码注册表（append-only） | 四新码语义/分类冻结；BOOTSTRAP_TOO_LARGE/SYNC_DIFF_TOO_LARGE 保留注册表但单帧路径不再触发；连接级 registry 零新增；RESYNC 词表 SYNC_TRANSFER_EXPIRED 冻结 | 协议 §13.2 L445–448/L452、§9.4 L270、§8.1 L202、§9.2 L236；ADR 0019 L68–69/L102 | ✓（AC4 恰为注册值） |
| Peer namespace 状态机 | 分块不新增状态；assembly 进度对状态机不可见；终态 channel 仅新连接重开 | 协议 §16 L556、§15；ws-replication AGENTS | ✓（assembler 泛化为传输层内部） |
| 配置链 | 两聚合上限键 + 三机制键 kind 无关、键名不变；链②启动响亮校验、绝不运行时 clamp；`maxQueuedControlBytes ≥ maxBootstrapBytes + 开销` 校验原样保留 | 协议 §17 L575–615；ADR 0019 L52–64；#299 已落地 | ✓（简报零新配置键） |
| Control/data 记账边界 | control 保留额度不承载任何 chunk；chunk 经 data 路径独立 sequence/dataGateOpen/RR | 协议 §8.1 L202、§9.2 L238、§17 L586/L615 | ✓（AC3 正面要求） |
| 0x42 解码侧协商门 | 未协商端 pre-parse `UNSUPPORTED_MESSAGE_TYPE` connection fatal，不分 kind；v1 代际端对 0x42 照旧 fatal | 协议 §5 L114、§10.3 L345、§22 L701；ADR 0019 非目标 #5 | 简报未触碰 ✓（实现不得绕过——R43） |
| transferId 计数器 | uint32、≥1、不回绕；(连接,方向,namespace) 域；**三 kind 共用同一计数器**，不设第二计数器 | 协议 §5 L116、§10.3 L315/L325；#299 设计复审裁定复用 `update-channel.ts` 既有 `nextTransferId` | 简报未述——实现须共用（R42） |
| ACK durability 语义 | ACK = 已落 live Y.Doc（导入/apply 完成后），非 flush/quorum | ADR 0019 L47；协议 §8.2 L213、§9.2 L238；ADR 0010/ws-replication AGENTS | ✓（简报显式「durability 含义不变」） |
| 刻画测试文件 | `ws-replication-issue233-repro.test.ts` 保留为现状基线、不改 | ADR 0019 L103；协议 §22 L700 | ✓（AC5 显式「刻画文件不动」） |
| Observer 注册表 | 第 29–36 型已登记；#300 不新增事件类型/词表（发射接线归 #301）；RESYNC/abort reason 词表零新词 | 协议 §23.1 L749–754/L783–784；issue #301 正文（实测） | 简报零 observer 请求 ✓（R46 中间态注记） |

## 6. Evolution requirements

**无。** 简报没有任何 `evolution-required` 项：全部请求行为对应的规范修订（协议 §1/§5/§8/§9/§10.3/§13.2/§16/§17/§18/§22/§23 与 CONTEXT.md 词条）已随 `2ca06f6` + `eb380d7` 落地，实现票与决策文本之间不存在待弥合的语义差。修订计划完备性检查（修订文件/新旧语义/兼容与迁移/失败语义/版本/验证/冻结面）不适用于本票——无契约变更待计划。

## 7. Hard conflicts

**无。** 未发现任何与既有决策不兼容且无合法 override 的请求点；简报与 ADR 0019/协议冻结文本逐条同源（见第 3 节）。与 #299 门禁的 R32（标题残留废弃措辞）不同，#300 的 issue 标题（「chunked snapshot / sync-diff 端到端：R1/R3 收敛绿灯」）不含已废弃术语。

## 8. Required actions（非阻塞；编号接续 #299 门禁 R32–R37 与 #299 设计复审 R38–R41）

- **R42 · transferId 单计数器共用**：kind=1/kind=2 发送端必须并入既有 (连接,方向,namespace) 域 `nextTransferId` 计数器（协议 §5 L116/§10.3 L325 三 kind 共用；#299 设计复审已裁定「复用 update-channel.ts 既有计数器、不新增第二计数器」）——简报未述，SA1 设计须显式覆盖并测试跨 kind 计数器单调性。
- **R43 · 解码侧 0x42 协商门不得因 kind 泛化而弱化**（#299 R34 的传输层延续）：接收端 kind=1/2 处理必须位于既有 pre-parse 协商门之后（未协商端对任何 0x42 帧 `UNSUPPORTED_MESSAGE_TYPE` connection fatal，§10.3 L345 不分 kind）；发送端 kind=1/2 出站沿既有 selectedCapabilities 面（同版本部署下恒协商成立），不得为 sync 段新增 bit 或 gating（ADR 0019 L16）。负控锚 `codec-issue242-ac-red.test.ts` 保持绿。
- **R44 · 首 chunk 校验按协议全四条落地**：简报「二维校验」为摘要；冻结集合 = `totalBytes` ≤ 按 kind 聚合上限 ∧ `chunkCount` ≤ `maxChunksPerUpdate` ∧ `totalBytes` ≤ `chunkCount` × `maxUpdateBytes` ∧ `chunkCount` ≥ 1（§10.3 L337；§8.1/§9.2 的 TOO_LARGE/VIOLATION 分类据此映射），后两条几何校验不得遗漏。
- **R45 · 发送端聚合超限分支与场景 14 改写义务**：hub 侧 snapshot 超 `maxChunkedBootstrapBytes` 的本端资源超限路径按 §23.3 L814 收口（hub `send-failed` → `SNAPSHOT_TRANSFER_TOO_LARGE` sent；「回归锚场景 14 由实现 ticket 改写」= 本票 `ws-replication-issue256-namespace-failed.test.ts` 场景 14）；双向 kind=2 发送端 diff 超聚合上限的收口（协议仅由接收端首 chunk 校验 + §23.3 peer `send-failed` 入口承载，未逐字冻结发送端预检）由 SA1 在冻结错误族（SYNC_TRANSFER_TOO_LARGE、retryable config）内显式设计。均属已冻结语义内的实现完备性，非冲突。
- **R46 · 切片边界中间态注记（observer/生命周期边缘归 #301）**：#301（blocked by #300，实测正文）承接 chunk 丢失/重复/错序/超时/close/GOAWAY/断线/epoch fence 丢弃矩阵、超时两向收口（BOOTSTRAP_FAILED 族 / RESYNC{SYNC_TRANSFER_EXPIRED}）与 observer 8 型接线（含 R21 改道归零）。#300 落地后、#301 落地前的中间态（分块结算点普通族事件/边缘清理未接线）是切片计划内的已知状态；SA1 设计须显式声明本票对 chunked 结算点 observer 行为的处置（发射零事件或维持现状），不得使 `ws-replication-issue256` 等既有 observer 回归锚红。
- **R47 · append-only 冻结面零顺手改**：本票不得改 codec 单帧规则/字段序（#299 已冻结）、不得重复登记或改写四码与 SYNC_TRANSFER_EXPIRED 语义、不得删除 BOOTSTRAP_TOO_LARGE/SYNC_DIFF_TOO_LARGE 注册表行（append-only 死码）、不得改 `update-transfer.ts` kind=0 既有行为（泛化须保持 kind=0 逐字节等价）。落地后文档同步义务：§22 L701 测试资产措辞收口 + §23.3 场景 14 锚更新 + `git diff --check` + 过期术语扫描（docs/AGENTS.md「Editing/Verification」）。
- **N6（环境观察，非本票冲突）· ADR 编号冲突存在于 origin/main**：main 领先提交 `b158f98`（#304/#305 VFSL 系 squash）新增 `docs/adr/0019-vfsl-union-member-docs.md`，与本基线的 `docs/adr/0019-chunked-sync-transfer.md` 同号并存（该提交不在本分支决策集内，实测 `git merge-base` 非祖先；主题零交集）。建议 owner/总控安排重编号（如 VFSL 篇改 0020）以保持「ADR 0019」引用无歧义；本报告所有「ADR 0019」均指 chunked-sync-transfer。另注：本仓为部分克隆，`git log --all` 跨引用遍历有 object 缺失告警，不影响本门禁证据。

## 9. Verdict

**clear。** issue #300 任务简报是 ADR 0019「后果/决策」节显式预设的传输层实现票：改道触发、data 路径逐帧出站与记账、control reserve 零 chunk、assembler kind 泛化与 bootstrap 无 Lease 记账、绑定块核对映射既有三码、分配前校验 + 一次性分配 + 收齐一次 apply/导入 + 单 ACK（末 chunk 帧序）、四新错误码分类、R1/R3 收敛绿灯且刻画文件不动——与 ADR 0019、协议 §5/§8/§9/§10.3/§13.2/§16/§17/§18/§22/§23 及 CONTEXT.md 词条逐条同源，分类全部为 `implements-existing-decision` 或 `no-conflict`；规范修订义务已在 docs 提交中兑现，无需新增 override 或演化计划；与 ADR 0010/0013 及其余 ADR、两包 AGENTS 契约边界零抵触；依赖 #299 已满足。R42–R47 为 SA1 设计与落地必须吸收的边界/完备性/文档同步项，转交后续阶段核对，不构成阻塞。

## 10. requiresConflictRecheck

**true。** 理由：本票将改动 wire 传输路径（0x42 kind=1/2 端到端）、namespace 状态机承载行为（bootstrapping/reconciling 分块传输）与失败语义（四新码终局/发送端收口）——这些冻结面尚待实现核对；按流程在 SA1 设计产出后做设计后复审，并在实现 diff 触碰协议/冻结面时按需做 implementation 复审（重点核对 R42–R45、R47 与 Frozen surfaces 表逐项）。

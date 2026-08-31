# 冲突门禁报告（设计后复审）

- 被审对象：SA1 设计 `wiki/raw/task_ws-replication-bound-early-frame-admission-in-accepttrusted_design.md`（issue #190，570 行全读）
- 冲突基准：`docs/adr/` 全集（10 篇，逐篇全读）+ `CONTEXT.md`（138 行全读）。代码与 wiki 其他文档仅作落点核验，不构成裁决依据。
- 前置：前置门禁 verdict `clear`（见同目录 `_conflict_report.md`）；本轮为 SA1 设计产出后的轻量复审，不重复全量盘点。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| ADR-0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 08-19/08-21 修订节） | 否 | 无冲突——设计不触碰 schema 文本、信封、方言、codegen |
| ADR-0002 | nomicore 全新重写，authority 出范围 | accepted | 否 | 无冲突——不涉及 authority 规则体系 |
| ADR-0003 | 求值器与派生 schema | accepted | 否 | 无冲突——不涉及 evaluate/ROOT/联合表示 |
| ADR-0004 | vfsl-protocol 类型投影 | accepted | 否 | 无冲突——不涉及类型协议包 |
| ADR-0005 | 投影生成管线 | accepted | 否 | 无冲突——不涉及 SchemaSource/生成器 |
| ADR-0006 | Cordis 持久化插件 DocPersistence | accepted（含 #64/#79/#131/#133 修订节） | 否 | 无冲突——不触碰 Persistence/saveDoc/flush/归档 |
| ADR-0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（Runtime/open/read 条款被 ADR-0008 部分取代） | 否 | 无冲突——不涉及校验/物化/mutation 管线 |
| ADR-0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132 修订节） | 邻近 | 无冲突——设计 §11 DENY 明确冻结 Runtime/sequencer/背压管线零触碰；改动封闭于 transport 接纳层（HubConnectionImpl 构造之前），「网络背压不得进入 Runtime sequencer」纪律不受影响 |
| ADR-0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订节） | 否 | 无冲突——不触碰 Registry/Lease/idle/shutdown |
| ADR-0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134 两轮 / #133 / #161 / #172 修订节） | **是** | 无冲突——设计是本 ADR「资源限制」纪律在 trusted 升级路径的对齐兑现：单帧界复用插件配置 `limits.maxFrameBytes`（C1，零新 knob）；upgrade 期帧限属 framing/认证级错误 → 整 transport close（C2 对齐「连接级错误才关闭整条连接」）；close code/observer reason 全部复用 wire contract 已文档化值，零文档变更（C3，见核验）；观察面零新事件类型（C4）；admission 界定位为纵深防御而非推翻 Host 授予责任（C5）；「wiki/raw 非规范」自认并遵守（C7） |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | 无 hard-conflict 点；下述两项为设计中可能被误读为冲突的边界项，已逐条裁决为 no-conflict |

**边界项裁决明细**（设计引入的新决策点逐条对照）：

| # | 设计决策点 | 涉及条款 | 对照 | 裁决 | 依据 |
|---|---|---|---|---|---|
| B1 | §3.4 拒绝路径 close 守卫：共享机制内 `transport.close(...)` 包 try/catch（唯一超越「accept() 现状原样收敛」的强化） | ADR-0010 §资源限制、§参考实现取舍 | 守卫不改变任何 close 语义（code/reason/时机全同），仅在 transport **契约外**形态（close 抛出）下把「promise reject + 重放流产」收窄为「resolve undefined」；契约内 transport（全部现存 fixture/生产 adapter）行为零变化 | no-conflict | 无任何 ADR 条款约束 transport.close 的异常面；方向与 §资源限制（被拒方有界账单）、§参考实现取舍（不照搬裸 handler）同向收紧；生产先例 `safeCloseTransport` 同款纪律。属实现层强化，非 ADR 演进 |
| B2 | C8/C9/P5/P6 以「phase5 R2 A2 / R3 N1 / §8.2-8.3 立法」为约束来源引用（phase5 design 位于 `wiki/raw/`） | ADR-0010 #172 修订节「`wiki/raw` 非规范：源码与规范中的公共行为表述必须指向 CONTEXT.md、ADR 或 docs/protocols/」 | 设计 C7 自认该纪律并声明「所有行为锚点引用源码/测试/协议文档」；其**规范性**锚点（1009/1008 close code、`upgrade-frame-limit` reason、`auth-upgrade-rejected` reason 闭集）经 SA8 核验确实指向并吻合 `docs/protocols/instance-replication-v1.md`（:341 FRAME_TOO_LARGE→1009、:389-390 粗分类、:636 reason 闭集含 `frame-too-large`/`early-frame-limit`）；phase5 引用仅承担**历史证据**（立法沿革）角色，非权威指向 | no-conflict | #172 约束的是「源码与规范中的公共行为表述」；设计文档本身是 wiki/raw 流水线产物，引用前序流水线证据合法。**非阻塞提醒**：SA3 落源码注释时（§10 第 4 条 MAX_EARLY_FRAMES 注释扩展、§3.1 机制 doc comment 均含 phase5 立法引用），须按 #172 既有实践执行「权威指向（docs/protocols）+ 历史证据」双标注，不得让源码把 wiki/raw 当唯一契约来源 |

**裁决分布**：no-conflict 10/10 条 ADR（含 B1/B2 两项边界裁决）；override-declared 0；evolution 0；hard-violation 0。

## 逐条对照明细（无冲突佐证）

| 设计决策 | 对照条款 | 结论 |
|---|---|---|
| 「两入口共用一个有界早到帧 admission 机制」（模块私有 `installEarlyFrameAdmission`，不导出） | ADR-0010 §包、应用与生命周期（ws-replication 包职责面） | 一致——纯包内实现收敛，零公共 API 变化（§8.3），无条款可违 |
| 单帧界复用 `limits.maxFrameBytes`、条数界维持 `MAX_EARLY_FRAMES=16` 模块常数（C8 零新 knob） | §资源限制「以下上限均为插件配置并提供安全默认值：最大 WS frame……」 | 一致——「最大 WS frame」确为插件配置且被复用；MAX_EARLY_FRAMES 不在 ADR 列举的上限清单内，前置门禁已裁决「ADR 未冻结其数值，无条款可违」；设计保持常数不配置化，未增删任何上限 |
| 帧限拒绝 → 整 transport `close(1009|1008, 'upgrade-frame-limit')`（C2） | §资源限制「普通超限以稳定错误关闭单个 channel；framing、认证等连接级错误才关闭整条连接」 | 一致——upgrade 接纳期无 channel 存在；帧超限属 framing 类连接级错误 → 关闭整条连接；且该分类已被 wire contract 文档化（:389-390），设计复用非新创 |
| close code / observer reason 零新码、零文档变更（C3/C4，§12 P1-P3） | §协议状态机「……close code、backpressure 和完整时序以 `docs/protocols/instance-replication-v1.md` 为唯一 wire contract」+ #172 | 一致——SA8 逐行核验 protocol doc：:341（FRAME_TOO_LARGE→1009）、:389（1008 身份或连接 policy 错误）、:636（`auth-upgrade-rejected` reason 闭集恰含两值、pre-connection 无 connectionId）。设计复用既有已文档化语义，「若需变更落点在 protocol doc」的衍生约束前提不触发（§11 DENY 明确该文档零改动） |
| 拒绝只发既有 `auth-upgrade-rejected` 事件 | §资源限制「复制插件提供结构化 observer seam 给日志/metrics/trace Adapter，不提供业务公共 update events」 | 一致——零新事件类型，观察面语义冻结 |
| trusted admission 界为纵深防御，不推翻 Host 授予责任（C5） | §NamespaceLease「所有 Lease 都可调用该入口……Host 搭建方负责只把 Lease 交给可信代码」 | 一致——收窄不可信输入的资源面，授予纪律原样 |
| 拒绝路径零 `HubConnectionImpl` 分配、恒 resolve `undefined`、拒绝后不可复活（I3/I4/I6） | §参考实现取舍 + §资源限制 | 一致——资源安全收紧方向，无反向条款 |
| listener 句柄 no-op 初始化 + 注册后同步收口段 detach（R3 N1 同步重放安全） | #161 修订节「连接收口同步静默订阅先于异步 drain」 | 一致——维持同步语义纪律同族做法 |
| accept() 行为逐字节等价收敛（§4）、token 验证路径零变化（AC4） | §认证「Bearer token 在 HTTP Upgrade 前认证……」+ #161「缺身份 accept = 响亮 TypeError」 | 一致——认证编排零触碰 |
| §11 文件清单：唯一生产文件 `hub-connection.ts`；`types.ts`（`DuplexTransport` 五成员、`acceptTrusted?` 可选签名）与全部邻接模块、`apps/yjs-server`、protocol doc 均 DENY | #161 修订节「transport 三可选面……缺面 dormant 语义」（方案 C 否决 transport 契约扩展）；#172（文档权威） | 一致——seam 契约零沉默扩权；caller 侧零改动 |
| 术语面：全篇 Hub/Peer/Host 措辞 | CONTEXT.md「Hub」「Peer」词条 _Avoid_ | 合规——grep 全文零 master/leader/slave/follower |

## 落点核验（佐证，非裁决依据）

- `packages/ws-replication/src/hub-connection.ts:46` `MAX_EARLY_FRAMES = 16` ✔、`:98-106` `emitUpgradeRejected` reason union 已含 `frame-too-large`/`early-frame-limit` ✔、`:241-261` `acceptTrusted` 现状确为无条件 `earlyFrames.push(bytes)` 无界保留 ✔——设计 §1 根因与 P5/P6 事实基础与代码现状吻合。
- `docs/protocols/instance-replication-v1.md` :341 / :389-390 / :636 逐行比对，设计 P1-P3 引用原文属实 ✔。

## 结论

**Verdict: clear — 放行，可进入 SA2 全维度攻击评审。**

- 无 hard-violation：设计没有任何条款与 accepted ADR 或 CONTEXT.md 直接冲突；全部改动封闭于 `hub-connection.ts` 单文件的 transport 接纳层。
- 无 override-declared：设计未声明推翻任何 ADR。
- 无 evolution：设计不意图修订任何既有决策——它是把 ADR-0010 §资源限制纪律与 phase5 已评审立法在 trusted 升级路径上的**对齐兑现**（收窄无界缓冲，方向与全部相关条款一致）。唯一超越现状的 §3.4 close 守卫经 B1 裁决为实现层强化而非行为变更（契约内零差异）。
- 非阻塞提醒（供 SA2/SA3 执行，不构成门禁条件）：
  1. **#172 双标注**：SA3 落源码注释引用「phase5 R2 A2 / R3 N1 立法」时，须按 #172 既有实践做「权威指向（`docs/protocols/instance-replication-v1.md`）+ 历史证据」双标注（B2 裁决附带的执行义务）。
  2. SA2 攻击评审重点可放在 §3.4 守卫的「契约内零差异」论证与 §5.1 检查序的完备性上——这两处是设计的新决策点，SA8 仅裁决其无 ADR 冲突，优劣判断属 SA2。

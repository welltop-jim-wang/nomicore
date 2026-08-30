# Issue #139 设计：可部署 Hub/Peer Cordis 应用（`apps/yjs-server`，Phase 5 切片 9）

- 任务类型：**Feature**（生产 composition root，纯新增组合层；零 `packages/**` 行为改动）
- 依据：TASK.md（issue #139 AC×7）、`docs/phases/phase-5-websocket-replication.md` §切片 9 / §场景 16-18、ADR 0010（§包、应用与生命周期 L169-181）、`docs/integration/cordis-plugin-hosting.md`（宿主接线与停机契约）。
- 结论先行：**READY（R2）**——全部待组合能力的公共导出已逐一源码核实（§2，含恢复 seam `notifyAuthChanged`）；唯一新增外部依赖 `ws` 经设计期验证可解析（§6-A1）；SA2 R0 的 4 项阻断级攻击点 + MINOR 项（R1 落实）与 SA2 R2 的 NB-1（peer blocked 显式恢复语义：stdin `notify-auth-changed` + 部署 runbook + T6/T3 改写）/NB-2（A6 引用修正）已全部落实（文末「SA2 反馈逐条回应」两表）。R3 为**实现后纯文档补注**（SA4 R2 O4 + R1 N2/N5 记账：tokens value 全表唯一、maxDirtyMs 上界与 watchdog 派生兼容、`reload-failed`/`app-stop-failed` 事件词条、停机序如实重述）——零代码改动、零既有设计决策变更，映射表见文末「R3 补注映射」。

> **取代说明（R0，替换未交付旧稿）**：本文件整体取代同路径旧稿。旧稿不可实施的关键错误：① app 命名 `apps/hub-peer-app` 违背 ADR 0010 L175 / phase 切片 9 / `apps/README.md` 预留的 `apps/yjs-server`；② peer targets 自创 `{instanceId, url, localOwners}`，违背冻结契约 `ReplicationTarget = {namespaceId, localOwner}` 精确两字段（ws-replication `types.ts:98-101`，ADR 0010「Peer 不与多实例互连」静态星型）；③ 自创 `admin|writer|reader` 角色矩阵，实际契约是 hub 侧 `verifyToken: token→peerInstanceId` + `authorize(instanceIdentity, namespaceId)→{localOwner, read, submit}`（`types.ts:84-111`）；④ 缺 `hubInstanceId`（`PeerReplicationOptions` 必填，缺则 peer 无法构造）；⑤ 单进程双角色双 root 配置违背「恰好一个静态角色」AC1 与 ADR 0010「每实例静态配置为 hub 或 peer」；⑥ 无真实 WS transport 设计（无 upgrade/认证/DuplexTransport 适配）；⑦ 手工七步 teardown 违背 hosting 文档「单一拆卸链」纪律。下文为全新设计。

> **R1 修订说明（2026-08-30，逐条落实 SA2 REJECT）**：在 R0 骨架上窄修正，骨架（组合面盘点/装配序/真实 WS transport/单一拆卸链/零 `packages/**`）未被 SA2 攻击、全部保留。核心变更：① authorization 双形式 + `ownerUserId` 必填/禁止规则（§3.2/§3.4，#1）；② provision+授权绑定**先于** `listen()`，NDJSON 启动序改 `provisioned → listening → ready`（§3.4/§3.5，#2）；③ stdin 控制通道错误链全量冻结：每行恰一回执 + 稳定 code 注册表 + 有界等待 + SIGHUP/provision 失败语义（§3.4/新增 §3.7，#3）；④ T3 增 restart-only 配置变更步骤、新增 T6/T7 红测（§5，#4）；⑤ 锁文件移入 rootDir 保留名（#5）、wrapWs 全成员枚举（#6）、认证面冻结 404/accept 单验（#7）、hub 拒 `backoff`（#8）、A3/A8/A11 引用修复 + §2/§3.6 的 sa7 引用改全名 + 新增 A12-A14（#9）、provision 累积量化警示（#10）。文件范围仅新增两个 SA6 红测文件，ALLOW LIST 只增不删（§8）。

> **R2 修订说明（2026-08-30，逐条落实 SA2 R2 REJECT：NB-1 CRITICAL + NB-2 MINOR）**：骨架不变，窄修。**NB-1**——R1 的「peer 收 GOAWAY 后按 backoff 重连」论证被冻结源码证伪：`hub.close()` 发的 GOAWAY reasonCode=`SERVER_SHUTTING_DOWN`（`hub-connection.ts:423,428`）使 peer 进入 `blocked` 且**不自动重拨**（`peer-connection.ts:518-521` 路由 `enterBlocked`、`:694` blocked 态 onClose 早退；drain 类重拨编排 `:718-742` 仅 `SERVER_RESTARTING`/未知类可达，而 hub 包从不发射 `SERVER_RESTARTING`——grep 全 src 零发射点）。修正为**显式恢复语义（冻结 SA2 建议 b+c 路线）**：① §3.4 动词表新增 peer 专属 `notify-auth-changed`（透传公共 API `PeerReplication.notifyAuthChanged()`，`types.ts:178-179` 冻结 seam）；② §3.4 启动序论证改锚**硬崩溃/backoff 循环/首拨**竞态（绑定先于 listen 的真实防护对象）；③ §3.6-1/§3.7-5/A13 的失实自动重连断言全量改写为如实陈述；④ T6 改写为 blocked-recovery 红测（hub SIGTERM → peer `blocked` 投影 → hub 重启 → 负例静默窗口 → `notify-auth-changed` → 有界收敛）；⑤ T3 换装步骤拨号来源显式化（一次性旧 token 进程 + 新 token 新进程 + 未通知旧 peer 保持 blocked 负例）；⑥ 部署文档新增「hub 正常重启 ⇒ peer 恢复 runbook」。**NB-2**——A6 改引 `persistence/src/service.ts:57-72,106-112`（`packages/persistence/src/` 实测无 plugin.ts）。全部修订经本 worktree 源码逐行复核（见 A13 重写 + 新增 A15）。

> **R3 补注说明（2026-08-30，post-implementation，落实 SA4 R2 O4 + R1 N2/N5 记账）**：纯文档轮——实现已由 SA3 R1–R3 交付，本轮**零代码改动、零既有设计决策变更**，只把已实现行为补写进设计文本：① §3.2 `hub.tokens` 的 **value 全表唯一**（SA4 B1：根除反查表 last-wins 静默身份别名）；② §3.2/§3.6 `persistence.schedule.maxDirtyMs` 上界 `MAX_MAX_DIRTY_MS=30_000` 及其与停机/换装总超时 watchdog（`STOP_WATCHDOG_MS=60_000`）的**派生兼容关系**（SA4 B2）；③ §3.5 事件清单补 `reload-failed`（SA3 R2 声明的换装链 error 事件，SA4 R2 O4-③）与 `app-stop-failed`（SA4 R1 N5 记账的实现期新增事件）词条；④ §3.6 停机序按实现**如实重述**（显式顺序编排 + file 排空窗——SA4 R1 N2「SA1 修订 §3.6 表述」处置项），§3.7 补 watchdog 覆盖面/失败模式事件分工/`reload-starting` 发射点澄清。R0–R2 全部决策（绑定先于接纳、单一拆卸链、blocked 显式恢复、零 `packages/**` 等）原样保留。

## §1. 需求推演（切入点）

切片 1–8 已交付 Registry/Lease/ReplicationSession/静态 role、protocol codec、ws-replication Hub/Peer 工厂（纯包、零 Cordis 依赖）。缺的只是 ADR 0010 L175 定义的 `apps/yjs-server` **最小 Cordis composition root**：配置校验、真实 WS transport、认证/授权注入、优雅停机、部署文档与冒烟验证。本设计 = 新增一个 app 包按冻结契约接线既有公共件，不改任何包。

## §2. 现有资产盘点（组合输入，全部只读消费公共入口）

| 能力 | 精确路径 | 关键公共 API（已核实源码） |
|---|---|---|
| Clock | `packages/clock/src/index.ts` | `createSystemClockPlugin` / `requireClock` |
| Cordis Timer | 外部包 `@deepseek-ai/cordis-plugin-timer`（已在 lockfile 1.1.3） | `new TimerService(ctx)`（hosting 文档 L42/57 先例） |
| Persistence | `packages/persistence/src/index.ts` | `createMemoryPersistencePlugin` / `createFilePersistencePlugin({rootDir, schedule})` |
| Registry+role | `packages/namespace-registry/src/plugin.ts:98-104,178-221` | `createNamespaceRegistryPlugin({idleTimeoutMs?, role?})`（role 已落地；切片 9 注记：生产必须显式传） |
| Hub 复制 | `packages/ws-replication/src/types.ts:113-148` | `createHubReplication({instanceId, registry, authorize, timer, verifyToken, limits?, timeouts?, observer?, clock?})`；`accept(transport, {token})`；`close()`（GOAWAY+drain，issue #174 语义）；`requestReauth(instanceIdentity)`（#175） |
| Peer 复制 | 同上 `types.ts:150-180` | `createPeerReplication({instanceId, hubInstanceId, registry, dial, timer, targets?, backoff?, ...})`；`start/stop/addTarget/removeTarget/notifyAuthChanged`（add/remove 幂等，ADR 0010 冻结） |
| 测试先例 | `packages/ws-replication/test/{harness,driver}.ts`、`sa7-*` 真实链路 | 真实 `ReplicationTimer` = node timer 桥（`ws-replication-sa7-r1-transport-auth.test.ts:68-71`，全文件名——R1 #9 修正）；token→instanceId verifier / authorizer 形态（`driver.ts:68-74`） |

## §3. 架构设计

### 3.1 新增 app：`apps/yjs-server/`（包名 `@nomicore/yjs-server`；ADR 0010 L175 专名）

```text
apps/yjs-server/
  package.json                 # deps: @deepseek-ai/cordis、cordis-plugin-timer、@nomicore/{clock,persistence,namespace-registry,ws-replication}、ws@^8；devDeps: @types/ws、typescript、vitest、@types/node
  tsconfig.json / AGENTS.md    # 沿 packages/* 模板；app 局部说明（apps/AGENTS.md 既有要求）
  src/
    index.ts                   # 公共库入口：createNomicoreApp、parseAppConfig、类型（嵌入宿主与测试用）
    main.ts                    # CLI：--config <path>（或 env NOMICORE_CONFIG）；信号处理（§3.6）；SIGHUP 换装入口（§3.7）；stdin NDJSON 控制通道（§3.4）
    config.ts                  # 配置解析 + 全量 loud 校验（§3.2），深冻结
    app.ts                     # createNomicoreApp(config)：按 hosting 文档顺序组装 Cordis fibers（§3.1 末）
    lifecycle.ts               # 有序停机编排（§3.6）+ SIGHUP 换装编排（§3.7）+ 结构化 NDJSON 事件面（§3.5）
    transport/ws-server.ts     # Hub：node:http + ws(noServer) upgrade 适配 → DuplexTransport
    transport/ws-client.ts     # Peer：ws 客户端拨号（Authorization 头）→ DuplexTransport
    replication/hub-plugin.ts  # app-local Cordis 插件：inject ['nomicoreRegistry','clock']；apply 内 createHubReplication + ctx.effect 有序 disposer
    replication/peer-plugin.ts # 同上：createPeerReplication；dial 闭包捕获 hub.url
  test/                        # SA6 红灯测试（§5）
```

组装序（严格按 hosting 文档 L51-73）：clock fiber → `new TimerService(ctx)` → persistence fiber（memory|file 按 config）→ registry fiber（**显式传 `role`，与部署角色一致**）→ hub/peer 复制插件。复制插件 `inject ['nomicoreRegistry']` 使其 fiber 位于依赖图下游 → 卸载时**先于** registry fiber（有序停机的机制载体，registry plugin.ts:185 同款）。**R1 #2 排序增补**：fiber 组装完成、registry ready 之后，先执行 §3.4 启动序（provision + 授权绑定表构建），**完成后才** `httpServer.listen()`（hub）/ `peer.start()` 拨号（peer）——任何网络端点开启之前授权查找已完备。

### 3.2 配置模型与校验（AC1；全部启动期同步 loud，registry 插件校验先例 `plugin.ts:155-168`）

```ts
type AppConfig = {
  role: 'hub' | 'peer';                      // 必填，无缺省（切片 9 注记：缺省 'hub' 不构成生产配置）
  instanceId: string;                        // ^[a-z][a-z0-9-]{0,62}$（ADR 0010 L156）
  persistence: { kind: 'memory' } | { kind: 'file'; rootDir: string; schedule?: { debounceMs; maxDirtyMs ≤ 30_000 } };  // R3：maxDirtyMs 上界 = MAX_MAX_DIRTY_MS（SA4 B2，见校验纪律末段）；debounceMs 不设上界
  idleTimeoutMs?: number;                    // 透传 registry 插件（其自校验）
  limits?; timeouts?;                        // Partial 透传 ws-replication（正数校验）；两角色共有
  backoff?;                                  // 【peer 专属】ReplicationBackoff Partial（正数校验）；role=hub 出现即拒（R1 #8：HubReplicationOptions 无 backoff 字段，透传即静默丢弃——types.ts:113-127）
  // ── hub 专属（peer 配置出现即拒；反之亦然）──
  hub?: {
    listen: { host: string; port: number };  // port 0..65535；0 = ephemeral（测试用，NDJSON 上报实际端口）
    tokens: Record<peerInstanceId, token>;   // 非空 map；key 合 instanceId 文法；value 非空且【全表唯一】（R3/SA4 B1，见校验纪律）；启动期建 token→instanceId 反查
    provision?: [{ id; ownerUserId; schema: {lang:'vfsl';version;id;text}; root }];  // 启动期 seed（§3.4）；【省略整键 = 零 seeding】（R1 #10）
    authorization: [{                        // R1 #1 重写：双形式 + owner 唯一来源规则
      peerInstanceId: string;                // 合 instanceId 文法
      namespaceId?: string;                  // 直引形式（生产主路径：ns 由宿主经 Registry API 创建、nsId 持久已知）
      provisionId?: string;                  // provision 形式；与 namespaceId 互斥（恰一）
      ownerUserId?: string;                  // 直引形式【必填且非空】；provision 形式【禁止出现】（防 owner 双源冲突）
      read: bool; submit: bool
    }];                                      // 精确匹配，无通配（phase 非目标）；(peerInstanceId, 解析后 nsId) 重复对 → 拒
  };
  // ── peer 专属 ──
  peer?: {
    hub: { url: string; hubInstanceId: string; token: string };  // url 仅 ws:/wss:、有 host、无 fragment；hubInstanceId 合文法；token 非空
    targets?: [{ namespaceId: ^ns-[0-9a-f]{32}$; ownerUserId }]; // 冻结两字段；nsId 重复即拒；ownerUserId 非空
  };
};
```

校验纪律：未知键一律 TypeError（防拼错静默忽略）；role×hub/peer 交叉字段互斥拒绝（**R1 #8 增补：role=hub 的 config 出现顶层 `backoff` → 拒**）；`authorization` 的 `provisionId` 必须解析到同 config 的 provision 条目，悬空即启动失败（零静默放行）；**R1 #1 增补**：authorization 条目 `namespaceId`/`provisionId` 恰一（都缺或都给 → 拒）；直引形式缺 `ownerUserId` 或空串 → 拒；provision 形式出现 `ownerUserId` → 拒（owner 唯一来源 = `provision.ownerUserId`）；`(peerInstanceId, 解析后 nsId)` 二元组重复 → 拒（直引×直引在 config 期查重；含 provision 形式的对在绑定表构建期查重，重复 = 启动失败，防静默遮蔽）；**R3 补注（SA4 B1）——`hub.tokens` 的 value 全表唯一**：任意两个键的 value 相同 → violation `duplicate token value (token values must be unique per peer)`，锚定 JSON 插入序中**靠后的键**（= last-wins 反查表的别名接受者，非数字型键插入序确定）；空/非字符串 value 不参与查重（避免与「非空 string」violation 双报），三重复时第 2、3 条均报。理由：反查表 `tokenToPeer` 是 Map（last-wins），重复 value 会让两个 peer 静默别名成靠后键的身份、授权按错误身份裁决——只能在配置校验层根除（§3.3 适配层零预检、包侧 verifyToken 均不可动）；boot 与 SIGHUP 换装前置验证（§3.7-2）共用本校验器，两条路径均 loud；**R3 补注（SA4 B2）——`persistence.schedule.maxDirtyMs` 上界 `MAX_MAX_DIRTY_MS = 30_000`**：file 停机/换装的排空窗 = `maxDirtyMs + DRAIN_MARGIN_MS(500)`（§3.6-3）必须**严格短于**总超时 watchdog `STOP_WATCHDOG_MS = 60_000`——越界（`> 30_000`）→ violation（reason 明示 watchdog 覆盖理由；`30_000` 恰过、`30_001` 拒），把「合法配置的干净停机被 watchdog 击穿、dirty flush 随 exit(1) 丢失」的数值矛盾在配置层 loud 根除（R1 反向靶 `maxDirtyMs: 60000` 从此 boot 即拒）。上界仅作用于显式 `schedule`：缺省 `DEFAULT_MAX_DIRTY_MS = 5_000`、memory 模式不受影响；`debounceMs` 不参与排空窗、不设上界；violations 汇总输出（字段路径+原因）后退出码 1。

### 3.3 WS transport 适配（新外部依赖 `ws@^8`；app 首个真实 WS 端点）

- Hub：`http.createServer`（`GET /healthz` → 200）+ `WebSocketServer({noServer:true})`；`server.on('upgrade')` 只做两件事（R1 #7 冻结）：路径 ≠ `/replication` → **404**（upgrade 前拒）；路径相符 → **一律完成 upgrade** 后 `hub.accept(wrapWs(ws), {token})`（token 自 `Authorization: Bearer <t>` 原样透传，头缺失 = `{token: undefined}`）。**适配层零凭据预检**：verifyToken 的唯一一次调用发生在包内 `accept` 路径——坏/缺 token 由包 `transport.close(1008,'upgrade-unauthorized')` 拒绝并产出 observer 事件 `auth-upgrade-rejected`（缺 token → `missing-token`；verifier 拒 → `invalid-credentials`；`hub-connection.ts:127-136,198-205`、reason 联合 `types.ts:365-377`）——观测面不缩水、无双调副作用。
- Peer：`dial = () => wrapWs(new WebSocket(hubUrl, { headers: { Authorization: 'Bearer '+token } }))`。
- `wrapWs` 全成员对齐 `DuplexTransport`（`types.ts:58-70` = **5 必填 + 3 可选**，R1 #6 修正枚举）：必填 `send`→`ws.send(bytes)`（binary；一 WS binary message = 一 frame，协议不变量 1）、`close(code,reason)`→`ws.close(code,reason)`、`closed` getter→`readyState===CLOSED` 投影、`onMessage`→`'message'` 事件（binary frame）、`onClose`→`'close'` 事件（code+reason）；可选 `bufferedAmount` getter（背压观察点，生产 adapter 必须暴露）、`ping`/`onPong` 直通（§18 活性面）。
- **为什么用 `ws` 而非手写 RFC6455**：masking/分帧/close 握手/ping-pong 手写 = 高风险重复造轮；`ws` 为事实标准且与 `DuplexTransport` 形状对齐。既有 sa7 测试用的是 node:net 裸 TCP 抽样，本 app 才是部署面真实 WS。

### 3.4 Provisioning、authorization 与运行期控制（AC2/AC3）

- **Hub provision**（config 驱动，启动一次）：registry ready 后 `registry.create({owner, schema, root})` → `lease.enableReplication()` → `lease.release()`；全链成功 → NDJSON `{"event":"provisioned","provisionId","namespaceId","replicationId"}`；**任一步 ok:false（如 schema 非法、REPLICATION_* 拒绝）→ NDJSON `{"event":"provision-failed","provisionId","code":<稳定 issue 码>}` 后 `exit(1)`**（R1 #3-⑤：属配置错误，零静默跳过、零部分启动）。非幂等（每次 boot 新 nsId）——bootstrap/演示 seed 语义：**file 模式下每次成功 boot 恰新增一个持久 ns，重启 N 次 = N 个累积 ns**（部署文档量化警示 + rootDir 清理指引；演示建议 memory persistence 或一次性 rootDir；**省略 `provision` 键 = 零 seeding**，R1 #10）；生产 ns 由嵌入宿主经 Registry API 创建（phase 非目标：无 REST/管理端点；peer 无法 enableReplication——角色权限，故复制 ns 必须诞生于 hub 侧）。
- **启动序（R1 #2 冻结：绑定先于接纳）**：fiber 组装完成 → registry ready → 逐条 provision 并完成授权绑定表构建（含 provisionId→nsId 解析与查重）→ **此后才** `httpServer.listen()`（hub）/ `peer.start()`（peer）。对应 NDJSON 事件序 **`provisioned(×N) → listening{实际 port} → ready`**（§3.5 同步改序）。依据（**R2 NB-1 改锚：竞态主体是硬崩溃/首拨/显式恢复重拨中的 peer，不是被 GOAWAY 优雅停下的 peer**）：① peer 侧 `failed` channel **仅在连接重建时恢复**（`onConnectionLost`：failed→disconnected，`onConnectionReady`：failed→targeted 重 OPEN——`peer-namespace.ts:671-684,710-716`），授权拒绝只终止单 channel 不关连接（`hub-connection.ts:487` terminateUnauthorized）；② hub **硬崩溃**（SIGKILL，无 GOAWAY）时 peer 走 `onTemporaryFailure` backoff **自动重拨循环**（`peer-connection.ts:694-716` → `:820`），重拨会命中**正在 boot 的 hub**；首拨 peer 与显式恢复重拨（§3.4 `notify-auth-changed`）同属「对 boot 窗口内的 hub 发起 dial」的入口（被 `SERVER_SHUTTING_DOWN` GOAWAY 优雅停下的 peer 进入 `blocked` 不拨号，A13——**不构成自动重连**）。若 listen 先于绑定：dial 成功 → token 有效握手成功 → channel OPEN → authorize miss → channel `failed` 且连接仍 `ready` → **永久停摆且无恢复路径**（①的 failed-only-on-rebuild + 活连接永不重建）。绑定先于 listen 使该窗口结构性不存在：authorize 只能由已接纳连接的 OPEN 触发，而接纳只能发生在 listen 之后。真未授权 target 的 `failed`-until-reconnect 是**正确终态**（防重试风暴），app 层不外加 channel 级强制重连；连接级恢复只用包冻结 seam（`notifyAuthChanged`，§3.4 动词表），绝不自建重拨。SIGHUP 换装（§3.7）的「装新」半程同此序。
- **verifyToken / authorize**（R1 #1 重写）：`verifyToken(token)` = tokens 反查 → `{ok:true, instanceId}` / `{ok:false}`。`authorize(instanceIdentity, namespaceId)` = 查启动期构建的绑定表 `Map<"peerInstanceId\u0000nsId", {ownerUserId, read, submit}>`：**直引条目启动即绑定**（owner = 规则显式 `ownerUserId`）；**provision 条目在 provision 完成时刻绑定**（owner = `provision.ownerUserId`）。miss → `{ok:false}`；命中 → `{ok:true, localOwner:{userId: 绑定表 ownerUserId}, permissions:{read, submit}}`——两种形式的 localOwner 都有**唯一确定来源**（`NamespaceAuthorization` ok:true 分支必填 `localOwner`，`types.ts:84-90`），无来源的配置在 §3.2 校验期即拒，运行期不可能出现无 owner 命中。
- **运行期控制通道 = 进程 stdin NDJSON**（本地运维面，零网络暴露；R1 #3 全量冻结错误链路）。**每读入一行恰产出一行回执，进程绝不因控制通道输入退出/崩溃**：
  - 包络：请求 `{"op":<verb>, "id"?: string|number, …参数}`；回执 `{"event":"reply","op":<verb>,"id"?,"ok":true,…载荷}` 或 `{"event":"reply","op":<verb>,"id"?,"ok":false,"code":<稳定码>}`。畸形行（非法 JSON / 非 JSON 对象 / 缺 `op` / `op` 非 string，含空行）→ `malformed-line`；未知 verb → `unknown-op`；参数形状/文法非法（nsId 不合 `^ns-[0-9a-f]{32}$`、`timeoutMs` 越界等）→ `invalid-op-args`。
  - 动词表：peer `add-target {namespaceId, ownerUserId}`（直通幂等 `peer.addTarget`；重复 add 恰一次 `target-added` 事件，回执均 ok）/ `remove-target {namespaceId}`（直通幂等 `peer.removeTarget`；未知 nsId = 幂等 ok 回执，无副作用）/ `notify-auth-changed {}`（**R2 NB-1 新增，peer 专属，本地恢复动词**：透传公共 API `peer.notifyAuthChanged()`——`types.ts:178-179` 冻结 seam「token/config 显式变化通知缝；blocked 仅在明确变化后恢复拨号」；包语义：仅 `blocked` 态生效（`peer-connection.ts:271-275` → `requestRebuild('auth-change')`：关旧 wire → 同步 `disconnected` → deferTask 异步 `dialNow`，`:842-858`），其余态为文档化 no-op、不抛错；回执 `ok:true` + 载荷 `connectionState`（调用后 `getConnectionState()` 快照——blocked 恢复路径上同步可见 `disconnected`，重建已排队）；用途冻结：**hub 正常重启/SIGHUP 换装完成且 peer 自身 config/token 未变**时的连接级恢复入口——hub 侧 GOAWAY(`SERVER_SHUTTING_DOWN`) 令 peer 进入 `blocked` 且不自动重拨（A13），peer 自身 token/config 变更仍走进程重启/SIGHUP 换装（restart-only，见下行））/ `verify-write {namespaceId, set, path, value, timeoutMs?}`；hub/peer 共有 `read {namespaceId, path}`、`status`、`shutdown`（回执 ok 后进入 §3.6 有序停机）；hub 另有 `request-reauth {instanceIdentity}`（#175 公共 seam 演示）。角色不适用动词（如 hub 进程收到 peer 专属 op、peer 进程收到 `request-reauth`）→ `unknown-op`（该进程动词表不含；稳定码注册表零新增，R2）。
  - **有界等待（R1 #3-②）**：`verify-write` 等待该 ns `state=live` 的 deadline 缺省 30000ms，op 级 `timeoutMs` 覆盖（钳位 [1,120000]）；超时 → `verify-write-timeout`（不挂起、不静默）。等待达成后本地 lease `mutateRoot`，ok:false → `write-failed`（透传稳定 issue 码）。
  - **未知 ns（R1 #3-③）**：`read`/`verify-write` 的 namespaceId 不在本进程已知集（hub = provision ∪ authorization 引用；peer = targets）→ **即时** `namespace-unknown`（不做 live 等待）；`read` 读取失败 → `read-failed`。
  - 稳定码注册表（append-only）：`malformed-line | unknown-op | invalid-op-args | namespace-unknown | verify-write-timeout | write-failed | read-failed`。
  - `verify-write/read` 是文档化的**部署自检动词**（默认不用）。**Hub URL/token/authorization 无任何运行期变更 op**——改动 = 重启（AC3；phase 文档 L124「hubUrl、token 和授权规则通过插件 update/restart 生效」；SIGHUP 换装语义见 §3.7）。
- **共享 FilePersistence root 拒绝（AC2；R1 #5 修正锁位置与写权限语义）**：file 模式启动时写 **rootDir 内保留名**锁文件 `<rootDir>/.nomicore-lock.json`（flag `wx`；内容 `{instanceId, pid}`；有序停机 / SIGHUP 换装完成时删除，崩溃残留走 stale 判定）。rootDir 本身必须可写（file persistence 写 `users/` 的前提），故锁**永不依赖父目录可写**——R0 的兄弟路径 `<rootDir>/../.…lock.json` 在「仅授予 rootDir 写权限」的加固部署会 EACCES，弃用。保留名零干扰依据：adapter 只触 `users/` 与 `archive/users/` 受控子树（`file.ts:203/218` 路径解析），顶层 `.nomicore-lock.json` 不在其列。语义：锁已存在且 `process.kill(pid,0)` 判定 pid 存活 → loud 退出（exit 1），文案区分「同实例重复启动」与「不同实例共享 root（unsupported，见部署文档）」并打印锁内 `{instanceId,pid}`；pid 已死 = stale 覆盖；写锁 EACCES/EPERM → loud 退出，文案指向部署文档（rootDir 可写性是 file 模式前置条件）。pid 复用误判（死 pid 被无关新进程复用）的残留风险在部署文档明示并给人工删锁指引。文档同步声明共享 root **unsupported**；`file.ts:27` 头注释「HMR must dispose and drain the old instance first」= §3.7 换装「先停旧再装新」顺序的包级依据。

### 3.5 可观测与脱敏

进程 stdout 输出 NDJSON 生命周期事件，**hub 启动序 = `provisioned(×N) → listening{实际 port} → ready`**（R1 #2：provision+授权绑定先于 listen，见 §3.4 启动序；peer 启动序 = `ready`（`peer.start()` 后））。全量事件面：`config-loaded / provisioned / provision-failed / listening / ready / target-added / reply（§3.4 控制回执）/ 连接与 ns 状态迁移 / replication-drained / registry-stopped / persistence-disposed / app-stopped / app-stop-failed（R3 补注）/ reload-starting / reload-ignored / config-error / reload-complete / reload-failed（§3.7-4，R3 补注）`。**`reload-failed` 词条（R3 补注，SA4 R2 O4-③；SA3 R2 声明的换装链 error 事件）**：载荷 `{reason:"watchdog-timeout", message}`，仅由换装总超时 watchdog 触发（§3.7）——stderr `reload watchdog timeout` → 本事件 → `exit(1)`，监督器重启兜底；与 `config-error`（前置验证失败、旧实例继续服务、**进程不退出**）分工互斥：换装链此前无独占 error 事件名，watchdog 超时臂需要独立词条。其余换装失败模式的事件分工见 §3.7-4。**`app-stop-failed` 词条（R3 补注；SA4 R1 N5 记账的实现期新增事件）**：`performStop` 任一步异常时先发本事件（载荷 message）再 rethrow——停机链失败的结构化可观测锚（§3.6-5）。复制域事件直接映射公共 `ReplicationObserver` 判别联合（`types.ts:258+` 已冻结脱敏面：无 token/owner 值/Yjs bytes/SCHEMA/ROOT 内容）；peer 侧 `goaway-received`(reasonCode) 与 `connection-state-changed`(from/to，含 `to:'blocked'`) 投影即 T6 的 blocked 断言锚（`types.ts:261,282`；发射点 = FSM 唯一迁移点 `peer-connection.ts:908-919`，边沿 exactly-once——R2 NB-1）；因 §3.3 适配层零凭据预检，`auth-upgrade-rejected`（`missing-token`/`invalid-credentials` 等）观测事件**可达**（R1 #7）。Clock 注入 `ReplicationClock`（issue #164「生产组合根注入并在装配期对缺省响亮断言」纪律）。

### 3.6 有序停机（AC4；phase 文档 L132 全序）

`SIGTERM/SIGINT` → `app.stop()`：

1. 停止接纳 + 复制 drain：hub `wsServer.close()`（listening socket **同步**关、healthz 下线、新 upgrade 拒绝；**不 await node `server.close()` 回调**——该回调要等全部既有连接结束、会在下一步 drain 之前死锁，R3 补注：实现核正，close 回调仅作无害收尾）→ `await hub.close()` / `await peer.stop()`（GOAWAY（reasonCode=`SERVER_SHUTTING_DOWN`，`hub-connection.ts:423,428` 实测字面量）→drain→deadline 后 WS 1001 硬收口；session close/channel teardown 由包完成，#174/#175 已测语义）。**R2 NB-1 如实陈述：peer 收 `SERVER_SHUTTING_DOWN` GOAWAY 后进入 `blocked` 且不自动重拨**（`peer-connection.ts:518-521` 路由 `enterBlocked`、`:694` blocked 态 onClose 早退；drain 类重拨编排 `:718-742` 仅 `SERVER_RESTARTING`/未知类可达，hub 包从不发射 `SERVER_RESTARTING`——grep 全 src 零发射点）。**hub 一次正常重启/停机即令全体在线 peer 进入 `blocked`**：恢复是显式运维动作——对 peer 发 stdin `notify-auth-changed`（§3.4）、peer 进程重启、或 peer SIGHUP 换装（部署文档 runbook + T6 验证）；app 不自建任何自动重连。§3.4 启动序对硬崩溃/backoff 重拨 peer 的保护不受影响（§3.4 改锚后论证）。SIGHUP 换装（§3.7）复用本序作为「停旧」半程。
2. `await registry.shutdown()`（lease release、已接纳 apply 排空、idle runtime 回收）→ NDJSON `registry-stopped`。
3. **file 模式排空窗（R3 补注）**：`await sleep((schedule?.maxDirtyMs ?? DEFAULT_MAX_DIRTY_MS=5_000) + DRAIN_MARGIN_MS=500)`——file adapter 的 dirty flush 走 debounce 调度（saveDoc → maxDirtyMs 内保证提交），`dispose()` 只 abort+destroy、**不冲刷 dirty**（`file.ts:27`「dispose and drain first」宿主义务）：不等此窗，「registry.shutdown 后立即拆 persistence fiber」会把停机前最后写入（如 provision 的 `enableReplication` META）丢失（实现期实测 = T6 首版红条件之一）；memory 模式无持久化语义、不等。
4. `await persistenceFiber.dispose()`（撤服务 → 级联等待依赖方 fiber 卸载 → adapter dispose 落盘）→ NDJSON `persistence-disposed`。
5. 根 `await ctx.fiber.dispose()`（Timer/Clock 最后）→ NDJSON `app-stopped`。任一步异常 → NDJSON `app-stop-failed`（载荷 message）后 rethrow（§3.5；SIGTERM/SIGINT 链在 main.ts catch → stderr + `exit(1)`，换装链见 §3.7-4）。

即（**R3 补注：按实现如实重述**——SA4 R1 N2 的「SA1 修订 §3.6 表述」处置项）：单一拆卸链 = `performStop` **显式顺序编排器**逐段 await——复制的 GOAWAY/drain 语义仍由包 `hub.close()`/`peer.stop()` 兑现（复制插件 fiber 的 `ctx.effect` disposer 保留同一幂等调用，根 fiber dispose 时为单飞 no-op；编排器先显式 await 一次，使 drain 确定性地发生在 registry 关停**之前**）、registry/persistence/timer 的卸载语义仍由各插件有序 disposer 兑现，编排器只决定**序**与**排空窗插入点**（纯 fiber 图级联无法在两级联卸载之间表达「等待」——这正是显式编排的动因）；`stop()` single-flight 幂等，绝不并发第二条拆卸链（hosting 文档 L168-181 纪律不变）。NDJSON 事件序（`replication-drained → registry-stopped → persistence-disposed → app-stopped`）= 停机序断言锚（与 R2 一致，零变更）。**总超时保护与派生兼容（R3 补注，SA4 B2）**：SIGTERM/SIGINT 停机与 SIGHUP 换装（§3.7）全程共用 `STOP_WATCHDOG_MS = 60_000` 总超时 watchdog（停机超时 stderr + `exit(1)`；换装超时另发 `reload-failed`，§3.5/§3.7-4）。合法配置的排空窗上界 = `MAX_MAX_DIRTY_MS(30_000) + DRAIN_MARGIN_MS(500) = 30_500ms`，**严格短于** 60_000——§3.2 的 maxDirtyMs 上界正是为该派生不变量而设：任何通过校验的配置（含上界值本身）其干净停机/换装的 dirty flush 永不被 watchdog 击穿，剩余 ≥29.5s 覆盖拆卸链其余各段（ws close + 包内 deadline 有界的复制 drain + registry.shutdown + fiber dispose，各段自有上界、总量级远低于余量）。跨文件数值不变量 `MAX_MAX_DIRTY_MS + DRAIN_MARGIN_MS < STOP_WATCHDOG_MS` 目前由常量选值 + 注释维持（`STOP_WATCHDOG_MS` 为 main.ts 模块私有常量）——SA4 R2 O1 已记测试债（导出常量 + 静态不变量断言，交后续任务，非本轮文档范围）。**ReplicationTimer 用 node timer 桥而非 `ctx.timeout`**：复制插件自身 fiber 卸载期（UNLOADING）内新武装 `ctx.timeout` 会抛 `INACTIVE_EFFECT`（registry plugin.ts:33-40 R5′ 残余窗口同构），而 `hub.close()`/`peer.stop()` 的 drain deadline 恰在卸载期需要武装；node timer 桥有 sa7 真实链路先例（`ws-replication-sa7-r1-transport-auth.test.ts:68-71` realTimer），句柄由包自持 `clearTimeout`。Registry 内部调度仍走其插件自带 `ctx.timeout` 桥（包自有测试行为，不动）。

### 3.7 SIGHUP 换装语义（R1 新增，#3-④/#4；AC3 restart 生效路径之一）

1. **单飞**：换装进行中或已处于停机中再收 SIGHUP → 忽略并输出 `{"event":"reload-ignored"}`（绝不并发第二条拆卸链，hosting L168-181 纪律）。
2. **先验证后拆卸**：重读 `--config`/`NOMICORE_CONFIG` 指向的文件 → 走 §3.2 同一全量校验器。**校验失败 → 输出 `{"event":"config-error","violations":[{path,reason}…]}` 并保持旧 ctx 继续运行**（既有连接/复制零中断；下一次 SIGHUP 可再试）——把「配置错误」与「运行期失败」分开：前者发生在任何破坏性动作之前。
3. **停旧 → 装新**（**R3 补注发射点澄清**：`reload-starting` 在换装入口（单飞门通过、watchdog 武装后）即发射，**先于**前置验证——事件语义 =「进入换装流程」而非「校验已通过」；坏 config SIGHUP 的可观测序 = `reload-starting → config-error`，旧 ctx 继续服务，T7 断言不受影响）：校验通过 → 严格按 §3.6 全序停旧 ctx（含锁文件删除、端口释放、NDJSON 停机序断言锚不变）→ 按 §3.1/§3.4 重组新 ctx（锁先删后取：停旧半程已删锁、装新半程 `wx` 重取；若残留锁仍在（pid 存活 = 本进程）→ 停机链异常 → 走 §3.7-4 loud `exit(1)`，绝不带锁强占）、provision、授权绑定）→ `listening`/`ready` → `reload-complete`。**R3 补注（SA4 B2「且」条款：reload 全链纳入同一 watchdog）**：单飞门后立即武装 `setTimeout(…, STOP_WATCHDOG_MS=60_000)`（`unref()`，不维持事件循环），覆盖**整条换装链**——① 前置重验证（同步读文件+解析+校验，不可挂）② 停旧 `await app.stop()`（含 file 排空窗，上界由 §3.2/§3.6 保证 < 60s）③ 锁删/重取（同步）④ 装新 `createNomicoreApp` + `await app.ready`；任一半程挂起 60s → §3.7-4 `reload-failed` + `exit(1)`，SIGHUP 无限静默停摆路径消除；`finally` 中 `clearTimeout`（成功与前置验证失败路径均回收定时器；`failBoot`/watchdog 的 exit 路径进程即终，无泄漏面）。
4. **运行期失败不回滚、loud 退出**：换装是 validate-then-swap，**不是事务**——停旧之后任何一步失败（provision 失败 → `provision-failed`；端口被占等装配失败）→ 输出对应 error 事件后 `exit(1)`（部署文档明示以进程监督器重启兜底；绝不允许半新半旧状态继续服务）。`file.ts:27`「HMR must dispose and drain the old instance first」即此顺序的包级依据。**R3 补注——失败模式与事件分工（SA4 R2 O4-③；N3 随包闭合）**：① 前置验证失败 → `config-error`（不退出，旧实例继续服务）；② 停旧失败 → app 层先发 `app-stop-failed`（§3.5）→ main.ts catch → stderr `reload stop-old failed: …` + `exit(1)`（不逃逸为 unhandled rejection；锁不释放——进程随即退出，残留锁由 stale-pid 覆盖路径兜底）；③ 锁重取失败 / 装新失败（provision 失败 → `provision-failed`；端口被占等）→ stderr + `exit(1)`；④ 整链挂起 60s → stderr `reload watchdog timeout` + NDJSON `reload-failed`(reason=`watchdog-timeout`) + `exit(1)`——`reload-failed` 为换装链运行期失败的独占 error 词条（§3.5），与 `config-error` 分工，监督器重启兜底。
5. 换装后的新 listener 满足 §3.4 启动序（绑定先于 listen）。**R2 NB-1 改写——换装期 peer 行为如实陈述**：换装「停旧」半程的 `hub.close()` 对在线 peer 发 `SERVER_SHUTTING_DOWN` GOAWAY → peer 进入 `blocked` 且**不自动重拨**（A13），因此「旧 token 拨号被拒」**必须显式构造拨号来源**——spawn 一次性旧 token peer 进程（或裸 ws 客户端）拨 `/replication`，断言 hub NDJSON `auth-upgrade-rejected`(reason=`invalid-credentials`)；换用新 token 的 peer 是**新进程**（或对旧 peer 做带新 config 的重启/SIGHUP 换装——peer 自身 config 变更本就是 restart-only）；未被通知、未重启的旧 peer 保持 `blocked`（文档化负例，T3 断言）。T3 换装步骤与 T6 blocked-recovery 红测分别验证（§5）。

## §4. 一致性与边界

- 零 `packages/**` 改动；app 只 import 各包公共入口（无 `/testing` 子路径、无内部模块）→ AC6 第三方 seam 由 app 自身形态证明，并由 §5-T4 独立测试**只** import 包公共面复刻 hosting 文档装配。
- 非目标遵守：无 REST 业务端点（仅 `/healthz` + `/replication` upgrade）、无通配授权/namespace 发现、无 TLS 终止（部署文档醒目要求外置 TLS，ADR 0010 L161）、单 hub 静态星型。
- 不推翻任何现有设计；Registry role、`addTarget/removeTarget` 幂等、`requestReauth/notifyAuthChanged` 等全部按冻结契约消费。组装中若发现包缺口 → 回报总控另开任务，不就地改包。
- **重启/换装语义（AC3，R1 #2/#4 + R2 NB-1）**：URL/token/授权配置变更的两条生效路径——进程重启与 SIGHUP 换装（§3.7）——都满足「授权绑定先于网络接纳」启动序（§3.4），由 T3 换装步骤（拨号来源显式化）+ T6/T7 显式验证；app 层不对 `failed` channel 外加强制重连（peer-namespace.ts:671-684/710-716 的 reconnect-重 OPEN 语义已足够，且防授权拒绝重试风暴）；连接级 blocked 恢复也**不绕过包自建重拨**——只透传冻结 seam `PeerReplication.notifyAuthChanged()`（§3.4 `notify-auth-changed` 动词，types.ts:178-179）。**hub 正常重启/停机 ⇒ 全体在线 peer 进入 `blocked`（A13 包语义）**，恢复路径 = peer `notify-auth-changed` / peer 重启 / peer 换装（部署文档 runbook，T6 验证）；hub 硬崩溃 ⇒ peer 按 backoff 自动重拨（包已测语义，非 app 设计路径，§3.4-②）。

## §5. 红灯测试计划（SA6，`apps/yjs-server/test/`；实现前 import 即失败 = 红基线）

| # | 文件 | 覆盖 AC | 要点 |
|---|---|---|---|
| T1 | `app-config-red.test.ts` | AC1 | 纯单元：缺 role/坏 instanceId 文法/坏 port/role×字段交叉（含 **role=hub 出现顶层 `backoff` → 拒**，R1 #8）/未知键/peer 缺 hub.url 或 hubInstanceId/url 非 ws(s)/target nsId 重复或坏文法/file 缺 rootDir → 全部 loud 拒绝；**authorization 形状（R1 #1）**：`namespaceId`/`provisionId` 都缺或都给 → 拒；直引形式缺 `ownerUserId`（或空串）→ 拒；provision 形式带 `ownerUserId` → 拒；provisionId 悬空 → 拒；`(peerInstanceId, 解析后 nsId)` 重复对 → 拒；合法双形式配置通过且深冻结（直引 owner=显式值；provision 形式 owner 由 provision 提供，配置留空） |
| T2 | `ws-transport-red.test.ts` | 前置 | loopback 真实 `ws`：帧回显、close code/reason 直通、bufferedAmount、ping/pong、**`closed` getter 翻转时序（R1 #6：close 生效前恒 false、生效后 true）** |
| T3 | `hub-peer-smoke-red.test.ts` | AC1/AC2/AC3/AC5/AC7 | 真进程（tsx spawn）：临时 rootDir×2 → hub **`provisioned` 先于 `listening` 先于 `ready`（R1 #2 事件序断言）**（port 0 实际值）→ peer ready → `add-target`（重复 add 幂等恰一事件）→ bootstrap live → peer `verify-write` → hub `read` 回读相等（端到端收敛）→ 错 token 拨号被拒且 NDJSON 出现 `auth-upgrade-rejected`(reason=`invalid-credentials`)（R1 #7 观测面锚点）→ SIGTERM 双进程 exit 0 + NDJSON 停机序严格递增；hub 同 rootDir 重启 `read` 仍=原值（durable 恢复；**亦隐证锁文件随干净停机删除**，否则重启被锁拒，R1 #5）；**共享 root 反例**：第二实例同 rootDir 启动被拒且文案区分；**restart-only 配置变更（R1 #4 + R2 NB-1 拨号来源显式化，AC3 第二分句）**：改 config 中 hub token（或 hub.url）→ SIGHUP 换装（§3.7）→ 断言换装前在线的 peer 收 `goaway-received`(reasonCode=`SERVER_SHUTTING_DOWN`) 后连接投影 `blocked`，且**负例静默窗口**（有界期内无任何 redial/backoff/`connection-state-changed` 事件——blocked 不自动重拨，A13）→ spawn **一次性旧 token peer 进程**（或裸 ws 客户端）拨 `/replication` → hub NDJSON `auth-upgrade-rejected`(reason=`invalid-credentials`)（新 listener 拒旧 token）→ **新 token peer 用新进程**拨号并 bootstrap live → 未通知、未重启的旧 peer 保持 `blocked`（文档化负例；测试收尾对旧 peer 注 `notify-auth-changed`（token 已换 → 拨号被拒回 blocked，验证动词链路）或直接 SIGTERM）。单测 timeout ≥120s |
| T4 | `third-party-composition-red.test.ts` | AC6 | 只 import `@nomicore/*` 公共入口 + cordis，复刻 hosting 文档最小装配（clock→TimerService→persistence→registry），`registry.create` + `lease.openReplicationSession` 成功（NamespaceLease/ReplicationSession 公共面证明；两 API 定义见 registry `types.ts:592,602`——hosting 文档 L118-160 仅 create/read/mutateRoot/release/open 用例先例，不含此两 API，R1 #9 修正指称）；文件零 app 内部 specifier（SA4 可静态比对 import 清单） |
| T5 | `ordered-shutdown-red.test.ts` | AC4 | 进程内 memory persistence：`createNomicoreApp`→`stop()`；断言 NDJSON 事件序 replication→registry→persistence→timer/clock + `registry.getStatus()==='stopped'` + 端口释放可重建 |
| T6 | `hub-restart-static-target-red.test.ts` | AC1/AC3 | **R2 NB-1 改写：blocked-recovery 红测（冻结 b+c 恢复路线）**：file 模式 hub 首次 boot（provision → 从 NDJSON 捕获 nsId）→ config v2 以**直引形式** authorization{该 nsId, ownerUserId} + peer **配置态静态 targets**（不经 add-target）→ bootstrap live 基线 → hub SIGTERM → 断言 peer NDJSON 依次出现 `goaway-received`(reasonCode=`SERVER_SHUTTING_DOWN`) 与 `connection-state-changed`(to=`blocked`)（观测面 `types.ts:261,282`）→ 同 rootDir 重启 hub（直引授权绑定先于 listen，§3.4）→ 等 hub `ready` → **负例静默窗口**（有界期内 peer 无 dial/backoff/状态迁移事件——blocked 不自动重拨）→ 对 peer stdin 注 `{"op":"notify-auth-changed"}` → 断言回执 `ok:true` 且载荷 `connectionState` 离开 `blocked`（重建排队）→ 有界轮询（≥30s deadline）channel 达 `live` 且 `verify-write`/`read` 收敛（端到端证明：直引形式 localOwner 可构造（R1 #1 生产主路径）+ hub 正常重启后显式恢复语义闭环（R2 NB-1））。**红条件**：R1 版设计（无 `notify-auth-changed` 动词、依赖伪自动重连）下本测红——peer 永久 blocked，「有界轮询达 live」永不成立；R0 事件序（listening 先于绑定）下亦红（notify 后 dial 命中未完成绑定的 listener → authorize miss → channel failed 且连接 ready、无恢复路径）。硬崩溃路径（SIGKILL → backoff 自动重拨收敛）为包已测语义（A13：`peer-connection.ts:694-716,820`），不属本 app 红测目标 |
| T7 | `stdin-error-chain-red.test.ts` | AC3 | **R1 #3 错误链红测**：真进程 stdin 依次注入 ① 非 JSON 行 ② `{"op":"bogus"}` ③ 对不存在 nsId 的 `read` ④ 对永不可 live ns 的 `verify-write`（`timeoutMs:500`）→ 断言**每行恰一 error 回执**（code 分别 = `malformed-line`/`unknown-op`/`namespace-unknown`/`verify-write-timeout`）且进程不退出、后续 `status` 回执 ok；SIGHUP 指向坏 config → `config-error` 事件 + 旧实例仍服务（原 token 连接仍被接纳）；换装进行中重复 SIGHUP → `reload-ignored` |

基建注（SA3 落实）：根 `vitest.config.ts` include 现仅 `packages/*`、`domains/*`（已核实）——须追加 `'apps/*/test/**/*.test.ts'`（ALLOW LIST）；根 `package.json` typecheck 脚本追加 app tsconfig；子进程经 `node_modules/.bin/tsx` 启动（根 devDep `tsx@^4`，`generate` script 同模式先例）。

## §6. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容 | 风险 |
|---|---|---|---|---|
| A1 | 新增外部依赖 `ws` 可安装 | 设计期实测 | 本 worktree 执行 `npm view ws version` → `8.21.3`（2026-08-30） | 低 |
| A2 | `ws` 客户端可带 Authorization 头；暴露 bufferedAmount / ping() / 'pong' / close(code,reason) | 官方文档 | ws@8 README（`new WebSocket(url,{headers})`、`websocket.bufferedAmount`、`ping(data)`、`'close'` 带 code+reason） | 低 |
| A3 | `DuplexTransport` = **5 必填**（send/close/closed/onMessage/onClose）**+ 3 可选**（bufferedAmount/ping/onPong），ws 事件可 1:1 适配 | 源码引用 | `packages/ws-replication/src/types.ts:58-70`（R1 #6 修正枚举；含 bufferedAmount「生产 adapter 必须暴露」与 ping/onPong 可选面注释） | 低 |
| A4 | `hub.close()` GOAWAY→drain→1001；`peer.stop()` 幂等；`requestReauth/notifyAuthChanged` 可用 | 现有测试引用 | `test/ws-replication-issue174-goaway-drain-red.test.ts`、`ws-replication-reauth-lifecycle-red.test.ts`（issue #174/#175 已合入，REPORT.md 记录 0d80a36） | 低 |
| A5 | 根 Context 用 `await ctx.fiber.dispose()` 有序拆卸 | 现有测试引用 + 文档 | `packages/clock/test/clock-plugin-lifecycle.test.ts:33-63`；hosting 文档 L176-179 | 低 |
| A6 | registry fiber 级联卸载先于 persistence dispose | 源码引用 | registry `plugin.ts:185`（inject 声明）+ persistence 有序 disposer **`service.ts:57-72`（设计注释：撤服务→await 依赖 fiber→finally adapter dispose）与 `:106-112`（实现：`:107` `await revoke()` 撤服务、`:111-112` finally `adapter.dispose()`）**（R2 NB-2 修正：`packages/persistence/src/` 实测无 plugin.ts——目录为 contract/file/index/lifecycle/memory/service/testing） | 低 |
| A7 | `ctx.timeout` 在 fiber UNLOADING 期新武装抛 `INACTIVE_EFFECT` | 源码引用 | registry `plugin.ts:33-40`（R5′ 残余窗口）→ §3.6 改用 node timer 桥的动机 | 中（已规避） |
| A8 | FilePersistence 单 rootDir 单实例（先 dispose 旧实例，HMR 同构）；adapter 仅触 `users/`、`archive/users/` 子树、无 rootDir 全枚举 | 源码引用 | `persistence/src/file.ts:27`（头注释，含「HMR must dispose and drain the old instance first」= §3.7 换装顺序依据）、`:203`/`:218`（按 doc 拼路径，无 readdir）→ **rootDir 内保留名 `.nomicore-lock.json` 零干扰**（R1 #5：弃兄弟路径，免父目录可写依赖） | 低 |
| A9 | port=0 → `server.address().port` 得实际端口 | 官方文档 | Node `net.Server.address()` 文档行为 | 低 |
| A10 | instanceId 文法 `^[a-z][a-z0-9-]{0,62}$`；namespaceId 文法 `^ns-[0-9a-f]{32}$` | 源码引用 | ws-replication `types.ts:74-76` + ADR 0010 L156；CONTEXT.md「namespaceId」条目 | 低 |
| A11 | registry.create/enableReplication/openReplicationSession 为公共 Lease API | 源码引用 | `namespace-registry/src/types.ts:592,602`（**API 定义所在**）；hosting 文档 L118-160 仅提供 create/read/mutateRoot/release/open 用例先例、**不含** enableReplication/openReplicationSession（R1 #9 修正：R0 引「hosting L120-160 用例」指称失实） | 低 |
| A12 | peer `failed` channel 仅在连接重建时恢复；活连接上无 channel 级重试；授权拒绝只终止单 channel 不关连接 | 源码引用 | `peer-namespace.ts:671-684`（onConnectionLost: failed→disconnected）+ `:710-716`（onConnectionReady: failed→targeted 重 OPEN）；`hub-connection.ts:487`（terminateUnauthorized 仅 channel 级） | 中（已由 §3.4 启动序结构性规避） |
| A13 | `hub.close()` 发 GOAWAY reasonCode=`SERVER_SHUTTING_DOWN` + 真实 drain 窗口；**peer 收该 GOAWAY 进入 `blocked` 且不自动重拨**；blocked 恢复唯一入口 = `notifyAuthChanged()`（仅 blocked 生效）或 blocked 态 `addTarget`；drain 类 GOAWAY（`SERVER_RESTARTING`/未知）才有 backoff 重拨编排，而 hub 包**从不发射** `SERVER_RESTARTING`；硬崩溃（无 GOAWAY、close code 非 1002/1008）→ `onTemporaryFailure` backoff 自动重拨 | 源码引用 | `hub-connection.ts:423,428`（`shutdownWithGoaway` 的 drainReason 赋值与 GOAWAY 帧字面量）；`peer-connection.ts:518-521`（SERVER_SHUTTING_DOWN/REAUTH_REQUIRED → `enterBlocked()`）、`:694`（backoff/blocked 态 onClose 早退不重拨）、`:694-716`+`:820`（非 1002/1008 close → onTemporaryFailure backoff）、`:271-275`（notifyAuthChanged 仅 blocked → `requestRebuild('auth-change')`）、`:245-246`（blocked 态 addTarget → `requestRebuild('config-change')`）、`:718-742`（onGoawayClosed backoff 重拨编排——仅 drain 类可达）；grep 全 src `SERVER_RESTARTING` 仅 `types.ts:286`（联合类型）与 peer 侧处理、**零 hub 发射点**；`types.ts:178-179`（notifyAuthChanged 冻结契约） | **高（已消解）**：peer 对 shutdown 类 GOAWAY 进入 blocked 不自动重拨——app 必须显式设计恢复路径（R2 NB-1：§3.4 `notify-auth-changed` 动词 + §3.6-1/§3.7-5 如实陈述 + 部署文档 runbook + T6 blocked-recovery 验证） |
| A14 | 坏/缺 token → 包内拒绝（WS 1008）+ observer `auth-upgrade-rejected`（missing-token / invalid-credentials） | 源码引用 | `hub-connection.ts:127-136,198-205`（emitUpgradeRejected 路径）+ `types.ts:365-377`（事件 reason 联合）→ §3.3 适配层零预检的依据 | 低 |
| A15 | peer 连接 FSM 迁移可观测（NDJSON blocked 投影断言锚）：`connection-state-changed`（from/to，含 `to:'blocked'`）、`goaway-received`（reasonCode 判别）、`connection-backoff-scheduled`（reason 含 `dial-failed`/`socket-closed`） | 源码引用 | `types.ts:261`（connection-state-changed 成员）、`:268`（connection-backoff-scheduled）、`:282`（goaway-received）；发射点 = FSM 唯一迁移点 `peer-connection.ts:908-919`（setState 边沿 exactly-once）→ T3 负例静默窗口与 T6 blocked 断言的观测依据（R2 NB-1） | 低 |

## §7. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅新增 `apps/yjs-server/**` 新模块、配置与文档；不修改任何既有函数签名、返回类型、throw 契约（零 `packages/**` 编辑）。既有 API 全部按冻结公共面消费（§2 表）；新增 API（`createNomicoreApp` 等）为全新函数，无存量 caller。

## §8. 文件清单（File Scope）

### ALLOW LIST
- `apps/yjs-server/package.json`、`apps/yjs-server/tsconfig.json`、`apps/yjs-server/AGENTS.md` — 新建，app 包骨架
- `apps/yjs-server/src/index.ts`、`src/main.ts` — 新建，公共入口 + CLI/信号/控制通道（§3.1/§3.4，约 200 行）
- `apps/yjs-server/src/config.ts` — 新建，strict 配置校验（§3.2，约 250 行）
- `apps/yjs-server/src/app.ts`、`src/lifecycle.ts` — 新建，组装与有序停机/NDJSON（§3.1/§3.5/§3.6，约 250 行）
- `apps/yjs-server/src/transport/ws-server.ts`、`src/transport/ws-client.ts` — 新建，WS 适配（§3.3，约 200 行）
- `apps/yjs-server/src/replication/hub-plugin.ts`、`src/replication/peer-plugin.ts` — 新建，复制插件（§3.1/§3.6，约 200 行）
- `apps/yjs-server/test/{app-config-red,ws-transport-red,hub-peer-smoke-red,third-party-composition-red,ordered-shutdown-red}.test.ts` — 新建，`[SA6 owned]` §5 红灯测试
- `apps/yjs-server/test/hub-restart-static-target-red.test.ts` — 新建，`[SA6 owned]`（**R1 追加**，SA2 攻击点 #2 授权理由）：file 模式 hub 重启 × peer 静态 targets 竞态红测（§5-T6）
- `apps/yjs-server/test/stdin-error-chain-red.test.ts` — 新建，`[SA6 owned]`（**R1 追加**，SA2 攻击点 #3/#4 授权理由）：stdin 错误链 / SIGHUP 坏 config / restart-only 配置变更红测（§5-T7）
- `docs/integration/hub-peer-deployment.md` — 新建，AC5：本机三进程（hub+两 peer、独立 rootDir、实例配置样例）、跨机器（hubUrl/DNS/防火墙）、**生产必须外置 TLS** 醒目条款（ADR 0010 L161）、配置参考、stdin 运维动词（含 **`notify-auth-changed`**，R2 NB-1）+ **回执/稳定码注册表**（§3.4）、provision/authorization 说明（含 R1 #1 双形式 owner 规则）、共享 root unsupported 声明、**锁文件语义与 rootDir 可写性前置条件 + pid 复用人工删锁指引**（#5）、**SIGHUP 换装语义与监督器重启兜底**（§3.7）、**provision 非幂等累积量化警示**（#10）、**hub 正常重启 ⇒ peer 恢复 runbook（R2 NB-1）**：peer 侧先观察 `goaway-received`(`SERVER_SHUTTING_DOWN`) → 连接 `blocked`（**不自动重拨，包冻结语义**）→ hub 回到 `ready` 后择一：对每个 peer 发 `{"op":"notify-auth-changed"}`（token 未变时）/ 重启或 SIGHUP 换装 peer（peer 自身 token/config 已变时，restart-only）；硬崩溃（SIGKILL）则 peer 自动 backoff 重拨、无需人工干预；明示「不对 blocked peer 发任何通知 ⇒ 复制静默停摆」的负例语义
- `vitest.config.ts` — 修改，include 追加 `'apps/*/test/**/*.test.ts'`（1 行）
- `package.json`（根） — 修改，typecheck 脚本追加 `tsc -p apps/yjs-server/tsconfig.json`（1 行）
- `apps/README.md` — 修改，apps 空置声明更新为指向 yjs-server（≤5 行）
- `pnpm-lock.yaml` — 生成物，`pnpm install` 随 `ws`/`@types/ws` 新增自动更新（PR 说明注明）

### DENY LIST
- `packages/**`（全部业务包源码与测试）— 冻结公共契约面，本任务零改动
- `packages/dsh-persistence/**` — DSH 开发/探针装配，非生产插件（hosting 文档 L7）
- `docs/adr/**`、`docs/phases/**`、`CONTEXT.md` — 领域文档属中心管辖，本任务不动
- `tests/acceptance/**`、`wiki/raw/**`（本设计文档自身除外）— 其他 SA 产出

## SA2 反馈逐条回应（R1，对 `task_issue-139_sa2_review.md` 攻击点 #1–#10 全量）

| SA2 攻击点 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 CRITICAL：authorization 无 owner 字段，直引（生产主路径）localOwner 无来源 | ✅ | §3.2 hub.authorization / §3.4 verifyToken·authorize / T1 / T6 | 条目改双形式显式建模：`namespaceId?`/`provisionId?` 恰一 + `ownerUserId?`（**直引形式必填非空、provision 形式禁止出现**，防双源冲突）；authorize 改查启动期绑定表 `Map<peerId\u0000nsId,{ownerUserId,read,submit}>`，直引启动即绑定（owner=显式值）、provision 在 provision 完成时刻绑定（owner=`provision.ownerUserId`）→ 两种形式 localOwner 均有唯一确定来源，无来源在 §3.2 校验期即拒。T1 增缺 owner 拒 / provision 带 owner 拒 / 恰一性 / 重复对四类用例；T6 端到端验证直引形式（生产式 ns）收敛 |
| #2 MAJOR：provision/listening 竞态，活连接 failed channel 无恢复 → 收敛停摆 | ✅ | §3.1 组装序 / §3.4 启动序 / §3.5 / §3.6-1 / T3 / T6 / A12 | 冻结**绑定先于接纳**：fiber 组装→registry ready→provision+绑定表构建→**才** `listen()`/`peer.start()`；NDJSON 序改 `provisioned → listening → ready`。机制依据落源码：`peer-namespace.ts:671-684,710-716`（failed 仅连接重建恢复）+ `hub-connection.ts:487`（授权拒绝不关连接）→ 窗口结构性不存在（authorize 只能由 listen 后接纳的连接触发）。SIGHUP 换装「装新」半程同序（§3.7-3）。T3 增事件序断言；新增 T6 竞态红测（file 重启×静态 targets 有界轮询达 live）。不外加 app 级强制重连（真未授权 failed 是正确终态，防重试风暴） |
| #3 MAJOR：stdin 错误链路未闭合（畸形/未知 verb/无 deadline/未知 ns/SIGHUP 坏 config/provision 失败） | ✅ | §3.4 运行期控制通道 / 新增 §3.7 / §3.5 事件面 / T7 | **每行恰一回执**：请求/回执包络 + 稳定码注册表（`malformed-line/unknown-op/invalid-op-args/namespace-unknown/verify-write-timeout/write-failed/read-failed`）；`verify-write` 有界等待（缺省 30s、op 级 `timeoutMs` 钳位 [1,120000]，超时回执）；未知 ns 即时 `namespace-unknown`；进程不因控制输入退出。SIGHUP：单飞（`reload-ignored`）→ 先验证后拆卸，坏 config → `config-error` + **旧 ctx 保持运行**；停旧后运行期失败（provision/listen）→ loud 事件 + `exit(1)`（非事务，监督器兜底）。provision 失败 → `provision-failed` + `exit(1)`。新增 T7 全链红测 |
| #4 MAJOR：AC3 第二分句（URL/token/授权 restart-only 变更）零测试覆盖 | ✅ | §3.7-5 / T3 / T7 | T3 增换装步骤：改 config token（或 hub.url）→ SIGHUP → 旧 token 拨号被拒（`auth-upgrade-rejected`）→ 新 token peer 重连 bootstrap live；T7 覆盖 SIGHUP 坏 config 与 reload-ignored。AC3 覆盖审计闭合（§9 映射更新） |
| #5 MINOR：锁文件兄弟路径父目录可写性 + pid 复用 | ✅ | §3.4 共享 root 拒绝 / A8 / T3 / 部署文档 | 锁文件移入 **rootDir 内保留名** `.nomicore-lock.json`（adapter 只触 `users/`、`archive/users/` 子树，`file.ts:203/218` 零干扰）→ 免父目录可写依赖；EACCES/EPERM → loud 退出 + 部署文档指引；干净停机/换装删锁（T3 重启步骤隐证）；pid 复用残留风险文档明示 + 人工删锁指引 |
| #6 MINOR：wrapWs「五成员」枚举不全（漏必填 `closed`/`onMessage`） | ✅ | §3.3 / A3 / T2 | 改「5 必填（send/close/**closed**/**onMessage**/onClose）+ 3 可选（bufferedAmount/ping/onPong）」并逐项给 ws 事件映射；T2 增 `closed` 翻转时序断言 |
| #7 MINOR：认证失败面歧义（401 预检 vs accept 拒） | ✅ | §3.3 / §3.5 / T3 / A14 | 冻结：路径不符 → 404；凭据校验**一律完成 upgrade 后交 `hub.accept`**（适配层零预检、verifyToken 单次调用在包内）→ 坏/缺 token 由包 1008 拒 + `auth-upgrade-rejected`（`missing-token`/`invalid-credentials`）观测事件可达；T3 以该 NDJSON 事件为断言锚 |
| #8 MINOR：hub config 接受无消费者的 `backoff` | ✅ | §3.2 / T1 | `backoff` 标注 peer 专属；role×字段交叉校验增补：role=hub 出现顶层 `backoff` → 拒（`HubReplicationOptions` 无该字段，types.ts:113-127）；T1 增用例 |
| #9 MINOR：引用失准（A11 hosting 指称 / sa7-r1 文件名+行号） | ✅ | §2 / §3.6 / A3 / A8 / A11 / T4 | A11 改「registry `types.ts:592,602`（API 定义）+ hosting L118-160 仅 create/read/mutateRoot/release/open 用例、不含该两 API」；sa7 引用改全名 `ws-replication-sa7-r1-transport-auth.test.ts:68-71`（出现于 §2 资产表与 §3.6；A7 行本身不含 sa7 引用、未动）；A3 行号改 `types.ts:58-70`；A8 补 `:218`。全部经本 worktree 重新 grep/sed 核实 |
| #10 MINOR：provision 每 boot 累积持久 ns | ✅ | §3.4 / 部署文档 | 量化警示（重启 N 次 = N 个累积 ns）+ rootDir 清理指引 + 演示建议 memory/一次性 rootDir + **省略 `provision` 键 = 零 seeding** 显式语义；NDJSON `provisioned` 带 nsId 供审计 |

## SA2 反馈逐条回应（R2，对 `task_issue-139_sa2_review_r2.md` NB-1/NB-2 全量）

| SA2 攻击点 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| NB-1 CRITICAL：R1 重启/换装收敛论证建立在失实 peer 重连前提上（`SERVER_SHUTTING_DOWN` → peer blocked 不自动重拨、hub 包从不发 `SERVER_RESTARTING`）；T6 结构性永久红；T3 换装缺拨号来源；app 无 peer 恢复动词 | ✅ | R2 修订说明 / §3.4 启动序依据 + 动词表 / §3.5 / §3.6-1 / §3.7-5 / §4 / T3 / T6 / A13 重写 + A15 新增 / 部署文档 bullet | **冻结 b+c 恢复路线**（设计文档级窄修，零包改动）：① §3.4 动词表新增 peer 专属 `notify-auth-changed`——透传公共 API `PeerReplication.notifyAuthChanged()`（`types.ts:178-179` 冻结 seam；仅 blocked 生效 `peer-connection.ts:271-275`，其余态文档化 no-op），回执 `ok:true` + `connectionState` 快照；角色不适用 → `unknown-op`（稳定码注册表零新增）；② §3.4 启动序论证**改锚硬崩溃/backoff 循环/首拨竞态**（`peer-connection.ts:694-716,820`），删除全部「GOAWAY 后自动重连」表述——被优雅停下的 peer 进 blocked 不拨号、明示不构成自动重连；③ §3.6-1 改为如实陈述 + **hub 正常重启 ⇒ 全体 peer blocked、恢复 = notify/重启/换装三选一**；④ §3.7-5 换装「旧 token 被拒」改**显式拨号来源**（一次性旧 token 进程/裸 ws 客户端）、新 token peer 用新进程、旧 peer 保持 blocked 负例；⑤ **T6 改写为 blocked-recovery 红测**（goaway-received→blocked 投影→hub 重启→负例静默窗口→`notify-auth-changed`→有界轮询达 live + verify-write/read 收敛；红条件 = R1 版无动词永久红 / R0 事件序 authorize miss 红）；⑥ T3 换装步骤同步改造（含负例静默窗口断言）；⑦ A13 全量重写（补引 `peer-connection.ts:518-521`、`:694`，风险列改「peer 对 shutdown 类 GOAWAY 进入 blocked 不自动重拨——app 必须显式设计恢复路径」）+ 新增 A15（`connection-state-changed`/`goaway-received`/`connection-backoff-scheduled` 观测锚，`types.ts:261,268,282` + 发射点 `:908-919`）；⑧ 部署文档新增 hub 重启 ⇒ peer 恢复 runbook（notify/重启/换装三分支 + 硬崩溃自动 backoff 说明 + 不通知即停摆负例）。**未发明任何新协议 reason code、未改 `packages/**`**（R2 指令遵守）；R1 回应表 #2 行的 T6 表述由本表 ⑤ 取代 |
| NB-2 MINOR：A6 引用失准（persistence 无 plugin.ts，注释实在 service.ts） | ✅ | §6-A6 | 改引 **`persistence/src/service.ts:57-72`（有序 disposer 设计注释）+ `:106-112`（实现：`:107` `await revoke()`、`:111-112` finally `adapter.dispose()`）**；注明 `packages/persistence/src/` 实测无 plugin.ts（目录 contract/file/index/lifecycle/memory/service/testing）。本轮引用经 grep -n 逐行核实（含 A13/A15 全部新行号） |

## §9. 结论

**READY（R2）**。七个 AC 全部映射：AC1→§3.2/T1；AC2→§3.4 共享 root 守卫+文档/T3 反例；AC3→§3.4 stdin 控制通道（含 R2 `notify-auth-changed` 恢复动词）+ §3.7 SIGHUP 换装 / T3 换装步骤（拨号来源显式化）+ T6 blocked-recovery + T7（**restart-only URL/token/授权变更 + hub 重启后 peer 恢复语义显式覆盖**，R1 #4 + R2 NB-1）；AC4→§3.6/T5；AC5→部署文档（含 hub 重启 ⇒ peer 恢复 runbook）/T3；AC6→§2/§4/T4；AC7→T3。全部组合件公共 API 已源码核实存在（含恢复 seam `PeerReplication.notifyAuthChanged`，`types.ts:178-179`）；唯一外部新增 `ws` 依赖经设计期验证可解析；SA2 R0 四项阻断级攻击点与 MINOR 项已落实（R1），SA2 R2 的 NB-1（失实自动重连论证 → 冻结 b+c 显式恢复路线：stdin `notify-auth-changed` 动词 + 部署 runbook + T6 blocked-recovery/T3 拨号来源显式化 + A13 如实重写）与 NB-2（A6 改引 `service.ts:57-72,106-112`）已全部落实并经本 worktree 源码逐行复核（新增依据 A15）；零新协议 reason code、零 `packages/**` 改动；文件范围较 R1 零新增（ALLOW LIST 只增不删、仅扩描述）；无阻塞项。R3 补注（实现后纯文档轮）不改变上述任一结论，仅补写已实现行为（见文首 R3 补注说明）。

## R3 补注映射（post-implementation；SA4 R2 O4 + R1 N2/N5 → 设计位置 → 实现锚点）

| 补注项 | 设计位置 | 实现锚点（本轮逐一核实） | 测试锚点 |
|---|---|---|---|
| ① tokens value 全表唯一（O4-① / B1） | §3.2 tokens 注 + 校验纪律 R3 段 | `config.ts` `validateTokens`：`seenTokenValues` Set 查重，violation `hub.tokens.<靠后键>: duplicate token value (token values must be unique per peer)`；boot 与 reload 前置验证共用 `parseAppConfig` → 双路径 loud；根除对象 = `app.ts` `bootHub` 的 `tokenToPeer` Map（last-wins 反查表） | `app-config-red.test.ts:238-254` |
| ② maxDirtyMs 上界 + watchdog 派生兼容（O4-② / B2） | §3.2 schedule 注 + 校验纪律 R3 段；§3.6 总超时保护段 | `config.ts:34` `export MAX_MAX_DIRTY_MS=30_000` + `validatePersistence` 越界 violation（30_000 恰过 / 30_001 拒）；`app.ts` `DEFAULT_MAX_DIRTY_MS=5_000`、`DRAIN_MARGIN_MS=500`、排空窗 sleep；`main.ts:24` `STOP_WATCHDOG_MS=60_000`（30_500 < 60_000，余量 ≥29.5s） | `app-config-red.test.ts:257-271`（双向边界）；`lifecycle-watchdog-red.test.ts`（`maxDirtyMs:60_000` boot 即 `config-error`+exit 1，输出无 `watchdog timeout`） |
| ③ `reload-failed` 词条（O4-③；附带 N5 `app-stop-failed`） | §3.5 词条句；§3.7-4 分工段 | `main.ts` reload watchdog 超时臂：stderr `reload watchdog timeout` → NDJSON `{"event":"reload-failed","reason":"watchdog-timeout",…}` → `exit(1)`；`app.ts` `performStop` catch → `app-stop-failed` → rethrow | watchdog 触发臂动态验证 = SA4 R2 O2/O3（交 SA7；stdout 管道截断风险留意） |
| ④ 停机序如实重述（R1 N2 处置） | §3.6 全节（5 步 + 「即」段） | `app.ts` `performStop` 显式顺序编排：wsServer.close（不 await close 回调）→ hub.close/peer.stop（插件 effect disposer 幂等同调）→ registry.shutdown → file 排空窗 → persistenceFiber.dispose → 根 fiber.dispose；异常 `app-stop-failed`+rethrow；`stop()` single-flight | T5/T3 的 NDJSON 停机序断言（事件序与 R2 一致） |
| 附：reload-starting 发射点澄清 | §3.7-3 | `main.ts` reload：单飞门 → 武装 watchdog → 发 `reload-starting` → 前置验证（坏 config 序 = `reload-starting → config-error`） | T7（`config-error` + 旧实例继续服务） |

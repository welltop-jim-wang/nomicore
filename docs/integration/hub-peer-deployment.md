# Hub/Peer 部署（`apps/yjs-server`）

`@nomicore/yjs-server` 是可部署的 Cordis 组合根：一个进程恰好承担一个静态角色
（`hub` 或 `peer`，配置必填、无缺省），显式组装 Instance identity、Clock、Cordis
Timer、Memory/File Persistence、NamespaceRegistry（角色来自 Instance service）、
对应角色的 WebSocket replication plugin（真实 `ws@^8` transport）、认证/授权、严格
配置校验与有序停机。它是 standalone 应用/CLI，不提供统一的嵌入式 yjs-server plugin；
第三方 Cordis 宿主应按 [Cordis plugin hosting 指南](./cordis-plugin-hosting.md) 组合角色专用插件。

## 安装与启动

仓库内开发/冒烟：

```bash
node_modules/.bin/tsx apps/yjs-server/src/main.ts --config <path/to/config.json>
# 或经环境变量
NOMICORE_CONFIG=<path> node_modules/.bin/tsx apps/yjs-server/src/main.ts
```

未发布 npm registry 前，执行 `pnpm pack:local` 会在 `artifacts/local-packages/` 生成完整编译包集，其中包括：

```text
nomicore-replication-protocol-<version>.tgz
nomicore-ws-replication-<version>.tgz
nomicore-yjs-server-<version>.tgz
```

`@nomicore/yjs-server` tarball 暴露 `nomicore-yjs-server` CLI。消费方安装完整本地依赖图后运行：

```bash
pnpm exec nomicore-yjs-server --config <path/to/config.json>
# 或
NOMICORE_CONFIG=<path> pnpm exec nomicore-yjs-server
```

这些包尚未发布时不能只安装 server tarball；必须按 `artifacts/local-packages/manifest.json` 将全部 `@nomicore/*` 依赖指向本地 tarball（或解包后的本地 package 目录），否则 package manager 会向 npm 查询未发布的传递依赖。应用方应消费 tarball 的 `dist`，不 link Nomicore `src`。

stdout 输出 NDJSON 生命周期事件（`config-loaded / provisioned / provision-failed /
listening / ready / target-added / replica-reset（reset-replica 仅成功路径发射）/
reply / connection-state-changed / goaway-received / … / replication-drained /
registry-stopped / persistence-disposed / app-stopped / reload-starting /
reload-ignored / config-error / reload-complete`）。复制域事件直接
映射公共 `ReplicationObserver` 判别联合（字段与包类型逐字一致），已脱敏：不含
token、owner 值、Yjs bytes、SCHEMA/ROOT 内容。

## 本机三进程示例

三个进程各用独立 rootDir（共享活跃 root **unsupported**，见下）。

**hub 配置**（`hub.json`）：

```json
{
  "role": "hub",
  "instanceId": "hub-1",
  "persistence": { "kind": "file", "rootDir": "/srv/nomicore/hub-data" },
  "hub": {
    "listen": { "host": "127.0.0.1", "port": 8080 },
    "tokens": { "peer-1": "secret-token-1", "peer-2": "secret-token-2" },
    "authorization": [
      { "peerInstanceId": "peer-1", "namespaceId": "ns-0123456789abcdef0123456789abcdef", "ownerUserId": "alice", "read": true, "submit": true }
    ]
  }
}
```

**peer 配置**（`peer-1.json`）：

```json
{
  "role": "peer",
  "instanceId": "peer-1",
  "persistence": { "kind": "file", "rootDir": "/srv/nomicore/peer1-data" },
  "peer": {
    "hub": { "url": "ws://127.0.0.1:8080/replication", "hubInstanceId": "hub-1", "token": "secret-token-1" },
    "targets": [
      { "namespaceId": "ns-0123456789abcdef0123456789abcdef", "ownerUserId": "alice" }
    ]
  }
}
```

启动顺序：hub → peer；停机的顺序相反，或直接对每个进程发 SIGTERM（各进程自行
执行有序停机）。

### provision（bootstrap seed）

`hub.authorization` 条目有两种形式，`namespaceId`/`provisionId` 恰一：

- **直引形式**（生产主路径）：`namespaceId` 明确引用一个已存在的 namespace
  （宿主经 Registry API 创建后持久已知），并**必须**携带非空 `ownerUserId`
  （localOwner 的唯一来源——是 persistence partition key，不是当前调用人）；
- **provision 形式**：`provisionId` 引用同一 config 的 `hub.provision` 条目，
  条目中**不得**出现 `ownerUserId`（owner 唯一来源 = provision 条目的
  `ownerUserId`）。每次合法 boot，每条 provision 在 Registry 中**新增**一个
  namespace（非幂等）：file 模式下重启 N 次 = N 个累积持久 namespace。演示/
  bootstrap 建议用 memory persistence 或一次性 rootDir，或省略 `provision` 键
  （= 零 seeding）；生产 namespace 由嵌入宿主经 Registry API 创建。`provisioned`
  事件报告 `namespaceId` 供后续使用；不想要的累积 namespace 需要清理 rootDir
  （`users/`、`archive/users/` 受控子树）后重新启动。

## 跨机器示例

- hub 配置 `listen.host` 改为 `0.0.0.0`（或内网地址），防火墙放行 `tcp/8080`；
- peer 配置 `peer.hub.url` 改为 `ws://<hub-dns-or-ip>:8080/replication`；
- hub 与 peer 必须使用各自的 API 密钥（`hub.tokens` / `peer.hub.token`）与各自的
  `hubInstanceId`（＝ hub 配置的 `instanceId`）；
- **生产必须外置 TLS**：应用本身不终止 TLS。生产环境在 hub 前挂反向代理做
  TLS 终止（或用企业内部 TLS 网关），peer 侧 `peer.hub.url` 使用 `wss://`。
  没有 TLS 时 bearer token 在网络上明文传输，只允许用于本机/受信内网联调。

## 配置参考（`parseAppConfig` 校验规则）

- `role`：必填 `'hub'|'peer'`（无缺省）；`instanceId`：`^[a-z][a-z0-9-]{0,62}$`；
  未知键一律 loud TypeError；
- role×字段互斥：hub 配置出现 `peer` 块 / peer 配置出现 `hub` 块 → 拒；
  顶层 `backoff` 是 **peer 专属**（role=hub 出现 → 拒）；
- `hub.listen.port` 0..65535（0 = ephemeral，实际端口经 NDJSON `listening` 事件
  上报）；`hub.tokens` 非空；`peer.hub.url` 仅 `ws:/wss:`、有 host、无 fragment；
- `peer.targets` 精确两字段 `{namespaceId: ^ns-[0-9a-f]{32}$, ownerUserId}`，
  nsId 重复 → 拒；
- `persistence.kind:'file'` 必须提供 `rootDir`；
- `limits`/`timeouts`/`backoff` 为正数校验的 Partial 透传（键集白名单）——
  值域语义以 `@nomicore/ws-replication` 冻结类型为准。

## stdin 运维控制通道（NDJSON）

向进程 stdin 每行写一个 JSON 请求，进程每行回一个回执（进程绝不因控制输入而
退出/崩溃）：

```jsonc
// 请求：{"op": <verb>, "id"?: string|number, …参数}
// 回执：{"event":"reply","op":<verb>,"id"?,"ok":true,…载荷}
//   或 {"event":"reply","op":<verb>,"id"?,"ok":false,"code":<稳定码>}
```

动词表：

| 动词 | 适用角色 | 参数 | 说明 |
|---|---|---|---|
| `status` | hub/peer | — | 回执携带 role/instanceId（peer 另有 `connectionState`） |
| `read` | hub/peer | `namespaceId, path` | 回执 `value`；未知 ns → `namespace-unknown` |
| `verify-write` | hub/peer | `namespaceId, set, path, value, timeoutMs?` | 等待该 ns 达 `live`（缺省 30s，op 级 `timeoutMs ∈ [1,120000]`）后本地 `mutateData({op:'set',path:set,value})`；部署自检动词（默认不用） |
| `shutdown` | hub/peer | — | 回执 ok 后进入有序停机 |
| `add-target` | peer | `namespaceId, ownerUserId` | 幂等：非终态通道（live/opening/…/closing/disconnected）短路，重复 add 不重复发 `target-added`；**终态通道（closed/conflicted/failed）的 add 走底层 re-add**（§14.1 整连接重建，发射 `target-added`）——reset-replica 后重引导失败的文档化恢复入口 |
| `remove-target` | peer | `namespaceId` | 幂等；未知 nsId = ok 回执、无副作用 |
| `notify-auth-changed` | peer | — | **hub 正常重启/SIGHUP 换装完成且 peer 自身 token 未变**时的连接级恢复入口（透传公共 API `PeerReplication.notifyAuthChanged()`；仅 `blocked` 态生效，其余态文档化 no-op） |
| `request-reauth` | hub | `instanceIdentity` | 对指定认证实例的全部连接发 GOAWAY(REAUTH_REQUIRED)（issue #175 公共 seam 演示） |
| `replace-schema` | hub | `namespaceId, schema, root?` | 本地 SCHEMA 写槽替换并单向传播（ADR 0010：SCHEMA 只允许 hub 本地修改）。`ok` 仅表示本地写槽完成——**不承诺**传播已发生或 dirty 已落盘（fenced/needs-resync 通道由复制状态机自行修复或等待运维 reset）。Peer 收到增量 SCHEMA 后，其当前 Runtime 的 active schema 不会热切换；在该 Peer 上按新字段发起本地业务写之前，必须通过受控 reset/re-bootstrap 或进程重启重新物化 Runtime，否则写入会诚实返回 `write-failed`。`root` 为可选 **plain JSON 对象**（ROOT 恒 Y.Map 物化）；`null`/数组/标量不是「未提供」而是 `invalid-op-args`（与 schema 形状错同码族，`write-failed` 只留给真实写失败）。不带 `root` 走引擎 keep-root 分支：**保留的旧 root 必须通过新 schema 校验**——schema 演进**新增必填字段**而旧 root 缺该字段时会响亮拒绝（折叠 `write-failed`），此时必须同时提供合规 `root`（满足新 SCHEMA 的完整 ROOT 对象）；兼容演进（新增可选字段 `?:`/放宽类型）不带 `root` 即成功 |
| `bump-epoch` | hub | `namespaceId` | 提升权威复制代际（epoch 递增，身份不变）。回执成功携带 `replicationEpoch`；`ok` = epoch 已提交，**fencing 是异步传播**（上界 `ackTimeoutMs`，缺省 10s）——双 peer 的 `identity-conflicted` 事件在回执之后观测 |
| `reset-replica` | peer | `namespaceId, ownerUserId, expectedReplicationId, expectedReplicationEpoch` | 受控副本重置（ADR 0010 #133 round-2 guarded reset）：registry 双源严格核对（mismatch → `NAMESPACE_RESET_IDENTITY_MISMATCH`、零通道动作）→ 通过后归档本地副本 → 收口旧 channel（**等 controller 收口结算完成**——CLOSE_OK/closeTimeout 兜底 ≤5s；结算超限 → `reset-replica-failed` 诚实回执）→ 重引导入队。`ok` = 归档完成 + 重引导已入队（编排确保全部交错下 addTarget 前 controller 已离开 closing——见「管理动词」）；重引导链随后的失败走既有 channel/连接 observer 事件，恢复入口 = `add-target`（终态通道不被幂等短路拦截）。重复调用（同 expected）→ `NAMESPACE_NOT_FOUND`（reset 成功不可重放，属正确行为） |

角色不适用动词（如 hub 收到 `add-target`、peer 收到 `request-reauth`）→
`unknown-op`。稳定码注册表（append-only）：`malformed-line | unknown-op |
invalid-op-args | namespace-unknown | verify-write-timeout | write-failed |
read-failed | NAMESPACE_INVALID_IDENTITY | REGISTRY_NOT_ACCEPTING |
NAMESPACE_NOT_FOUND | NAMESPACE_RESET_IDENTITY_MISMATCH | NAMESPACE_RESET_FAILED |
NAMESPACE_LOAD_FAILED | NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID |
reset-replica-failed`（后 8 码为 `reset-replica` 专用：7 个 registry 窄 issue 透传码 +
`reset-replica-failed`——branded fatal / 结构性防御边界 / 旧通道收口结算超限）。

### 管理动词（#140）

`replace-schema` / `bump-epoch` / `reset-replica` 是 Phase 5 收口的管理动词面，
宿主编排（composition root）职责，不引入新引擎语义；`packages/**` 零改动。

- **reset 编排冻结次序**（`reset-replica`）：① `registry.resetReplica` 前置核对
  （失败即透传回执、**零通道动作**）→ ② `peer.removeTarget`（收口旧通道，冲突/
  失败态立即、live 态 `closeTimeoutMs` 5s 兜底）→ ③ **等待 controller 收口结算
  完成**（离开 `closing`——CLOSE_OK 往返与回执竞争窗口；预算 = closeTimeoutMs +
  边距，超限 → `reset-replica-failed` 诚实回执，幂等集保持不含该 ns，`add-target`
  重试真正可达）→ ④ `peer.addTarget`（§14.1 整连接重建 → 重 OPEN → bootstrap）。
  次序不可交换：先 remove 再 reset 会把 mismatch 的「零破坏」收窄为「零数据破坏」
  并留下停摆通道。③ 的存在保证「`ok` = 重引导已入队」在**全部**交错下为真
  （F1 复验收编：不等待则该窗口内 addTarget 落入引擎合流分支、close 后无人
  再触发重建——通道永久 closed，第二/多轮 bump→fence→reset 循环断裂）。
- **整连接重建副作用**（§14.1 既定行为）：conflicted/closed 终态后的 re-add 触发
  `requestRebuild('re-add')`——同 peer 的**所有** namespace channel 一并重建；
  多 namespace peer 上执行 `reset-replica` 会导致同连接其余 channel 短暂重连
  （round 重新收敛，无数据丢失——bootstrap/reconcile 幂等）。
- **重复 reset 的幂等语义**：首次成功 = key 归档、bootstrap 资格；同一 expected
  再次到达 → ⑤ 无 entry committed probe → `NAMESPACE_NOT_FOUND`（正确行为，
  非缺陷；reset 成功不可重放）。
- **bump 后的完整恢复闭环**（S2）：bump(1→2) → 双 peer `identity-conflicted` →
  对 peer 发 `reset-replica`（expected = 本地旧身份 `{replicationId, epoch:1}`）→
  核对通过 → 归档 → 重引导 → hub 广告 epoch 2 → importReplica 继承新身份 → live。
- **reset 后重引导失败的恢复指引**：reset 回执 `ok` 之后的重引导链失败（bootstrap
  failed / hub 不可达 backoff / needs-resync）**不在回执域**（回执已 `ok`）——观测
  既有 `channel-state-changed` / `connection-state-changed` / `bootstrap-*` 事件；
  恢复入口 = `add-target`（**终态通道不被幂等短路拦截**——短路仅限非终态/活跃
  通道；重 add 必达底层 re-add 分支，`target-added` 事件为成功信号）。数据已归档
  零丢失，bootstrap 资格持续有效。
- **peer 停机窗口的已知偏差**：reset 回执发出与 `peer.stop()` 完成交错时，重引导
  可能被停机守卫静默拦截（回执仍 `ok`）——进程退出后重启按配置 `peer.targets`
  重引导，数据零丢失。

Hub URL/token/authorization **没有任何运行期变更 op**——改动走进程重启或
SIGHUP 换装（restart-only，见下）。

## SIGHUP 换装（restart-only 配置变更路径之一）

> 信号投递注意：开发运行器 `tsx` 会把脚本 fork 到子进程，且**不转发 SIGHUP**
>（SIGTERM/SIGINT 转发）。用 tsx 开发调试时须把 SIGHUP 发到实际脚本进程（如
> `pgrep -f 'yjs-server/src/main.ts'`）；生产用进程监督器直接管理 `node` 进程则
> 无此问题。

1. **单飞**：换装进行中/停机中再收 SIGHUP → `{"event":"reload-ignored"}`；
2. **先验证后拆卸**：重读 `--config` 指向文件 → 全量校验器；失败 →
   `config-error`（携带 `violations`）且旧实例继续服务（下一次 SIGHUP 可再试）；
3. 校验通过 → `reload-starting` → 按停机全序停旧（含锁文件删除、端口释放）→
   重组新 ctx（provision/授权绑定先于 `listening`）→ `reload-complete`。
4. 换装**不是事务**：停旧之后任何一步失败 → 对应 error 事件 + `exit(1)`，
   以进程监督器重启兜底（绝不允许半新半旧状态继续服务）。

## 锁文件与共享 root

file 模式启动时以 `rootDir/.nomicore-lock/` 非空目录作为权威锁（`mkdir`
是唯一获取线性化点），目录内 `owner.json` 写入 `{instanceId, pid, nonce}`；同时
刷新 `rootDir/.nomicore-lock.json` 诊断镜像，供运维读取。adapter 只触
`users/`、`archive/users/` 受控子树，零干扰。语义：

- 权威锁存在且 pid 存活 → loud `exit(1)`：同 pid/instanceId = 同实例未干净停机；
  不同实例 = **共享活跃 root unsupported**（每个进程必须独立 rootDir；
  hub 与 peer 各自 rootDir，两个 peer 也各自 rootDir）；
- pid 已死 = stale 回收：竞争者以原子 `rename` 将权威目录移到唯一墓碑路径，
  再以 `mkdir` 竞争新的权威目录；竞争败者重读胜者 owner 后 loud `exit(1)`。
  EACCES/EPERM → loud `exit(1)`（rootDir 可写性是 file 模式前置条件）；
- release 先以原子 `rename` 摘走权威目录，只在墓碑 owner 等于本 handle payload
  时删除；迟到 handle 无法按 canonical 路径删除后继者的目录；
- `.nomicore-lock.json` 只是诊断镜像，不是所有权 token；
- root 是当前进程的私有持久化实现，不是共享数据库：其他业务系统、脚本或管理工具不得同时打开同一 root、绕过锁或直接修改 `.snapshot`；跨进程数据修改应通过拥有者业务接口，或使用独立 root 的 Peer replication；
- 同一 root 的合法接管只发生在旧 owner 已完全停机并 dispose、权威锁已释放之后，用于重启或迁移，两个 owner 的运行期不得重叠；
- **pid 复用误判**：死 pid 被无关新进程复用会误报「存活」——人工确认原 owner 确已退出后，才可删除 `.nomicore-lock/` 继续接管。

## 停机顺序（AC4）

SIGTERM/SIGINT → 停止接纳（hub `httpServer.close()`）→ 复制 drain（GOAWAY
`SERVER_SHUTTING_DOWN` → drain 窗口 → WS 1001 硬收口）→ Registry shutdown →
Persistence dispose（落盘）→ Timer/Clock teardown；NDJSON 事件序 =
`replication-drained → registry-stopped → persistence-disposed → app-stopped`；
全程总超时保护（超时 `exit(1)`）。`stop()` 幂等（single-flight）。

## hub 正常重启 ⇒ peer 恢复 runbook

hub 一次正常重启/停机（SIGTERM/SIGHUP）会向全部在线 peer 发送
GOAWAY(`SERVER_SHUTTING_DOWN`)；peer 收到后进入连接态 `blocked`，**且不自动
重拨**（包冻结语义；NDJSON 依次出现 `goaway-received`(`reasonCode=
SERVER_SHUTTING_DOWN`) 与 `connection-state-changed`(to=`blocked`)）。

恢复三步（择一，均在 hub 回到 `ready` 之后执行）：

1. **peer 自身 config/token 未变**：对每个 blocked peer 注
   `{"op":"notify-auth-changed"}`（回执 `connectionState` 离开 blocked，
   有界收敛到 `live`）；
2. **peer 自身 token/config 已变**：重启 peer 进程或对 peer SIGHUP 换装
   （restart-only）；
3. 直接重启 peer 进程（最简单，但会短暂断开本地服务）。

对 blocked peer **不发任何通知 ⇒ 复制静默停摆**（负例语义：blocked 期间零
dial/backoff/状态迁移事件）。hub **硬崩溃**（SIGKILL，无 GOAWAY）则 peer 按
backoff **自动**重拨，无需人工干预。

## 生产要求摘要

- 必须外置 TLS（hub 前反向代理 / `wss://`）；默认配置零 TLS 假设；
- 每个进程独立 rootDir；共享活跃 FilePersistence root unsupported；
- 配置文件包含密钥（token），权限控制到仅服务账户可读；
- 用进程监督器（systemd/supervisor）托管进程 + SIGHUP 换装失败 `exit(1)` 的
  自动重启兜底。

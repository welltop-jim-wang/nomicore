# Hub/Peer 部署（`apps/yjs-server`）

`@nomicore/yjs-server` 是可部署的 Cordis 组合根：一个进程恰好承担一个静态角色
（`hub` 或 `peer`，配置必填、无缺省），组成 Clock、Cordis Timer、Memory/File
Persistence、NamespaceRegistry（静态角色）、真实 WebSocket 复制（`ws@^8`）、
认证/授权、严格配置校验与有序停机。

## 启动

```bash
# 仓库内（开发/冒烟）
node_modules/.bin/tsx apps/yjs-server/src/main.ts --config <path/to/config.json>
# 或经环境变量
NOMICORE_CONFIG=<path> node_modules/.bin/tsx apps/yjs-server/src/main.ts
```

stdout 输出 NDJSON 生命周期事件（`config-loaded / provisioned / provision-failed /
listening / ready / target-added / reply / connection-state-changed / goaway-received
/ … / replication-drained / registry-stopped / persistence-disposed / app-stopped /
reload-starting / reload-ignored / config-error / reload-complete`）。复制域事件直接
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
| `verify-write` | hub/peer | `namespaceId, set, path, value, timeoutMs?` | 等待该 ns 达 `live`（缺省 30s，op 级 `timeoutMs ∈ [1,120000]`）后本地 `mutateRoot({op:'set',path:set,value})`；部署自检动词（默认不用） |
| `shutdown` | hub/peer | — | 回执 ok 后进入有序停机 |
| `add-target` | peer | `namespaceId, ownerUserId` | 幂等；重复 add 恰一次 `target-added` 事件，回执均 ok |
| `remove-target` | peer | `namespaceId` | 幂等；未知 nsId = ok 回执、无副作用 |
| `notify-auth-changed` | peer | — | **hub 正常重启/SIGHUP 换装完成且 peer 自身 token 未变**时的连接级恢复入口（透传公共 API `PeerReplication.notifyAuthChanged()`；仅 `blocked` 态生效，其余态文档化 no-op） |
| `request-reauth` | hub | `instanceIdentity` | 对指定认证实例的全部连接发 GOAWAY(REAUTH_REQUIRED)（issue #175 公共 seam 演示） |

角色不适用动词（如 hub 收到 `add-target`、peer 收到 `request-reauth`）→
`unknown-op`。稳定码注册表（append-only）：`malformed-line | unknown-op |
invalid-op-args | namespace-unknown | verify-write-timeout | write-failed |
read-failed`。

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

file 模式启动时在 `rootDir/.nomicore-lock.json`（保留名，adapter 只触
`users/`、`archive/users/` 受控子树，零干扰）写入 `{instanceId, pid}`；干净停机
/换装删除。语义：

- 锁存在且 pid 存活 → loud `exit(1)`：同 pid/instanceId = 同实例未干净停机；
  不同实例 = **共享活跃 root unsupported**（每个进程必须独立 rootDir；
  hub 与 peer 各自 rootDir，两个 peer 也各自 rootDir）；
- pid 已死 = stale 覆盖；`wx` EACCES/EPERM → loud `exit(1)`（rootDir 可写性是
  file 模式前置条件）；
- **pid 复用误判**：死 pid 被无关新进程复用会误报「存活」——人工确认后删除
  `.nomicore-lock.json` 即可继续。

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

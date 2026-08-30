# SA2 攻击评审报告 — Issue #139（apps/yjs-server composition root）

**Date**: 2026-08-30
**Verdict**: **REJECT**（4 项阻断级设计缺陷，均为窄修正；§2 资产盘点、Cordis 组装可行性、真实 WS transport、停机语义总体成立）

评审对象：`wiki/raw/task_issue-139_design.md`（R0 取代稿）。评审基线：TASK.md issue #139 AC×7、`docs/phases/phase-5-websocket-replication.md` §切片 9/§场景 16-18、ADR 0010、`docs/integration/cordis-plugin-hosting.md`。无「相关决议」文档（本任务未产出 `_relevant_decisions.md`），以 ADR 0010 + 冻结类型源码为约束基准。

## 总体可行性核实（先给结论，再列攻击）

以下 SA1 关键声明**逐一源码核实为真**，构成设计可信度基础：

| 声明 | 证据（本 worktree 实测） |
|---|---|
| §2 全部公共导出存在 | clock `index.ts`（`createSystemClockPlugin`/`requireClock`）；persistence `index.ts`（`createMemoryPersistencePlugin`/`createFilePersistencePlugin`）；registry `index.ts:26-28`；ws-replication `index.ts`（`createHubReplication`/`createPeerReplication` + 全类型）✓ |
| Hub/Peer 工厂签名 | `ws-replication/src/types.ts:113-127`（Hub options：instanceId/registry/authorize/timer/verifyToken/limits?/timeouts?/observer?/clock?）、`:150-169`（Peer options：+hubInstanceId/dial/targets?/backoff?）、`:129-142`（accept/revoke/requestReauth/close）、`:171-180`（start/stop/addTarget/removeTarget/notifyAuthChanged）与设计 §2 逐字段一致 ✓ |
| `ReplicationTarget` 冻结两字段 | `types.ts:98-101` `{namespaceId, localOwner}`；`NamespaceOwner={userId}`（registry `types.ts:129-131`）✓ 设计 peer targets `{namespaceId, ownerUserId}` 映射正确 |
| Cordis 组装可行性 | hosting 文档 L51-73 装配序、L42/57 `new TimerService(ctx)`、L168-181 单一拆卸链；registry `plugin.ts:185` inject 先例；`pnpm-workspace.yaml` 已含 `apps/*`；lockfile 有 `@deepseek-ai/cordis-plugin-timer@1.1.3` ✓ |
| 真实 WS transport | `ws` 确不在 lockfile/node_modules（唯一新增外部依赖属实）；T2/T3 走 loopback 真实 `ws` ✓ |
| 停机序 | 设计 §3.6 与 ADR 0010 L179 停机序、phase L132、hosting L168-181 逐句对齐；「复制插件 inject `nomicoreRegistry` → 先于 registry fiber 卸载」机制与 `plugin.ts:185` 同构 ✓；node timer 桥动机（A7）与 `plugin.ts:33-40` R5′ 残余窗口吻合 ✓ |
| 基建声明 | 根 `vitest.config.ts` include 现仅 `packages/*`+`domains/*`（属实）；根 `package.json` 有 `tsx@^4` devDep + `generate` 先例；typecheck 脚本无 apps（属实）✓ |

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞（设计行 + 证据） | 建议 |
|---|---|---|---|---|
| 1 | **CRITICAL** | hub 授权配置模型自相矛盾 | §3.2 L62 声明 `authorization: [{ peerInstanceId; namespaceId \| provisionId(恰一); read; submit }]` —— **无 owner 字段**；但 §3.4 L84 要求 authorize 命中返回 `localOwner:{userId: provision.ownerUserId 或「规则显式 ownerUserId」}`，后者在 §3.2 冻结形状中**不存在**。对直接引用 `namespaceId`（非 provisionId）的授权条目——恰是设计自述的生产主路径（L83「生产 ns 由嵌入宿主经 Registry API 创建」）——hub 侧 localOwner **无来源**，`NamespaceAuthorization` ok:true 分支必填 `localOwner`（`ws-replication/src/types.ts:84-90`）无法构造 → 授权路径对生产 ns 不可实现。T1 也因形状缺字段而无法测此路径 | 窄修：authorization 条目增 `ownerUserId?: string`——`namespaceId` 形式必填、`provisionId` 形式禁止（提供即拒，防双源冲突）；provisionId 形式启动期取 provision.ownerUserId。T1 增两用例（namespaceId 缺 owner 拒 / provisionId 带 owner 拒） |
| 2 | **MAJOR** | provision 与 listening 竞态 | §3.5 L90 规定 NDJSON 事件序 `listening → ready → provisioned`，且 §3.4 L83 provision 在「registry ready 后」执行、provisionId→nsId 绑定（L84「启动期已解析成 nsId」）依赖 provision 先完成 → **upgrade 端点在授权绑定完成前即可接纳连接**。真实触发：hub 重启（AC3 明文支持的重启语义）→ GOAWAY(SERVER_RESTARTING) → peer 按 retryAfterMs 立即重连 → 命中未绑定授权 → authorize miss → channel `failed`；授权拒绝不关闭连接、活连接上 failed channel 是否重试未定义 → 收敛停摆。T3 用 stdin add-target 在 provisioned 之后才建 target，**结构上测不到该竞态** | 窄修：provision + 授权绑定完成**先于** `httpServer.listen()`（NDJSON 序改 `provisioned → listening → ready`，或至少绑定先于 upgrade 接纳）。红测：file 模式 hub 重启 + peer 配置态静态 targets（不 add-target）→ 断言 channel 最终 live（带超时轮询） |
| 3 | **MAJOR** | stdin 控制通道错误链路未闭合 | §3.4 L85（及 §3.1 L35）定义了 add/remove/verify-write/read/status/shutdown/request-reauth，但以下路径**行为未定义**：① 畸形 NDJSON 行/未知 verb；② `verify-write`「等待该 ns state=live」**无 deadline**——ns 永不 live（授权拒/身份冲突）即永久挂起且无回执 = 部署面静默失败；③ `read`/`verify-write` 对本地不存在 ns（registry.open ok:false issue）的回执；④ SIGHUP 重载时新 config 无效（exit? 保持旧实例?）；⑤ provision 启动失败（create 返回 ok:false issue，如 schema 非法）的出口。违反错误处理链路立法（静默失败检查/用户可感知性） | 窄修：**每行 stdin 输入恰产一回执**（ok 或带稳定 code 的 error）；verify-write/read 有界等待 + 超时 error 回执；SIGHUP 新 config 校验失败 → 输出 error 事件并保持旧 ctx 运行（或明示 loud exit 1，择一冻结）；provision 失败 → 启动失败 exit 1（属配置错误）。红测见下「红线测试思路」 |
| 4 | **MAJOR** | AC3 第二分句零测试覆盖 | AC3（TASK.md L17）=「targets 运行期幂等 add/remove」**且**「Hub URL/token/授权变更走 update/restart 语义」。§5 T3（L115）只测前者 + 重启恢复（同 config）；SIGHUP/换 config 重启（L85）**没有任何测试步骤**。AC 覆盖审计不闭合 | 窄修：T3 增一步——改 config 中 token（或 hub.url）→ SIGHUP/重启 → 旧 token 连接被拒、新 token 的 peer 重连收敛。SA4 门禁按此验收 AC3 |
| 5 | MINOR | 共享 root 锁文件兄弟路径可写性 | §3.4 L86 锁文件写 `<rootDir>/../.…lock.json` 假定 rootDir **父目录**可写；常见加固部署仅授予 rootDir 本身 → 启动期 EACCES 行为未定义。pid 复用可致假阳性「存活」拒启 | 明示 EACCES/EPERM 语义（loud 退出 + 文案指向部署文档），或允许 rootDir 内保留名锁文件——`file.ts:203/218` 证明 adapter 只触 `users/`、`archive/users/` 子树，顶层保留名零干扰 |
| 6 | MINOR | wrapWs「五成员」枚举不完整 | §3.3 L78 枚举 send/close/onClose/bufferedAmount/ping/onPong，遗漏**必填**成员 `closed`（getter）与 `onMessage`（`types.ts:58-70` 实为 5 必填 + 3 可选）。T2 回显测试隐式覆盖，但契约对齐陈述失真 | 设计补全枚举；T2 断言 `closed` 翻转时序 |
| 7 | MINOR | hub 认证失败面歧义 | §3.3 L76「解析 Bearer → verifyToken → hub.accept(...)」未定：坏 token 是 upgrade 前拒（HTTP 401）还是完成 upgrade 交 `accept` 拒。若适配层先拒，§3.5 L90「复制域事件直接映射 ReplicationObserver」对 `auth-upgrade-rejected`（`types.ts:365-377`）**永不触发**（观测面静默缩水） | 冻结：路径不符 → 404；凭据校验一律完成 upgrade 后交 `accept`（观测事件可达）；删除适配层冗余 verifyToken 预检或明示双调无副作用 |
| 8 | MINOR | hub config 接受无消费者的 `backoff` | §3.2 L56 `backoff?` 顶层透传，但 `HubReplicationOptions`（`types.ts:113-127`）**无 backoff**——hub 配置带 backoff 将被静默丢弃，违背「未知键一律 TypeError」同源的防拼错纪律 | role×字段交叉校验增补：role=hub 配置含 `backoff` → 拒；T1 增用例 |
| 9 | MINOR | 协议假设依据引用失准（A11/sa7-r1） | A11（L135）称 enableReplication/openReplicationSession 见「hosting 文档 L120-160 用例」——实测 hosting 文档**零提及**这两个 API（grep 0 命中；L120-160 是 create/read/mutateRoot/release/open 用例）；结论本身由 registry `types.ts:592,602` 支撑（真）。§2 L23/A7 引「sa7-r1-transport-auth.test.ts:79-81」——实际文件名 `ws-replication-sa7-r1-transport-auth.test.ts`，realTimer 在 **L67-71**。依据可定位性不达 SA4 复核标准 | 修正 A11 为「registry types.ts:592,602（API 定义）+ hosting L120-160（create/lease 用例先例）」；sa7-r1 引用改全名+正确行号 |
| 10 | MINOR | provision 每次 boot 新增持久 ns | §3.4 L83 已声明非幂等（demo seed），file 模式下每次重启累积一个永久 ns，长期运行垃圾增长 | 部署文档量化警示 + （可选）config 开关 `provision: false` 语义明示 |

## 协议假设依据审查（2026-06-13 立法）

- **章节存在**：§6 存在，11 条假设均含依据类型/内容/风险分级 ✓。
- **实测类依据**：A1 贴了命令与输出（`npm view ws version` → `8.21.3`）✓；本评审复核 `ws` 确不在 lockfile（新增依赖属实）。
- **无据推断**：未发现「应该/通常/预计」类空依据条目。
- **可验证性缺陷**：A11 引用内容与被引文档不符（hosting 文档无 enableReplication/openReplicationSession）、sa7-r1 文件名缩写 + 行号漂移（#9）——SA4 按图索骥会落空，须修正；其余 A2-A10 引用经抽查均可定位（A3 `types.ts:57-70`、A5 clock 测试 `ctx.fiber.dispose`、A6 `plugin.ts:185` + persistence 有序 disposer 注释、A7 `plugin.ts:33-40`、A8 `file.ts:27/:203`、A10 ADR L157 文法，均核实）。
- 三条新增外部行为假设（A1/A2/A9：ws 可装、ws 客户端 headers/bufferedAmount/ping、port 0 实际端口）均属低风险且 SA4 §1.4 可重跑验证。

## 错误处理链路审查

- **静默失败**：发现 1 处阻断级——stdin 控制通道 `verify-write` 等待 state=live 无 deadline、畸形输入/未知 verb 无回执定义（#3）；其余启动失败面（config 校验 violations+exit 1、端口冲突自然 loud crash）闭合。
- **状态闭环**：无 UI 状态机域；停机路径有总超时保护 + `exit(1)` 兜底 ✓；`remove-target` 未知 nsId 无副作用回执已定义 ✓。
- **降级路径**：`bufferedAmount`/`ping/onPong` 缺面语义（dormant）是协议契约设计，app 适配器**如实暴露**而非假降级 ✓；peer 断线重连走库级 backoff + NDJSON 事件可感知 ✓。
- **虚假降级识别**：未发现把正常路径前提缺失伪装成降级的模式；verifyToken miss → `{ok:false}` 是协议规定的拒绝通道，非 bug 掩盖 ✓。
- **竞态**：发现 1 处（#2 provision/listening 竞态）；停机链无并发双拆（单一拆卸链纪律落实，§3.6 L101 明示不手工调 registry.shutdown）✓。

## 红线测试思路（对应攻击点，供 SA6/SA4）

1. **（#1）** T1 增：authorization 条目 `namespaceId` 形式缺 `ownerUserId` → 启动拒；`provisionId` 形式同时提供 `ownerUserId` → 启动拒；合法双形式 → authorize 返回的 localOwner 分别等于显式值/provision.ownerUserId（可经 T3 端到端：peer 对生产式 ns（hub 预置、非 provision）target 后 verify-write 收敛）。
2. **（#2）** `hub-restart-static-target-red`：file persistence hub + 配置态 targets 的 peer；hub SIGTERM → 重启 → 断言 peer channel 在有界轮询内达 `live` 且 verify-write/read 收敛——当前设计下该测试红（授权未绑定窗口）。
3. **（#3）** `stdin-error-chain-red`：向进程 stdin 依次注入 ① 非 JSON 行 ② `{"op":"bogus"}` ③ 对不存在 nsId 的 `read` ④ 对永不可 live ns 的 `verify-write`（短超时配置）——断言**每行恰一 error 回执**（含稳定 code），且进程不退出、后续 `status` 仍可用；SIGHUP 后 config 非法 → 断言既定语义（error 事件 + 旧实例存活，或 exit 码）。
4. **（#4）** T3 增：改 hub token + SIGHUP → 旧 token 拨号被拒（connect/close 反例）、新 token peer 重连 live。
5. **（#5）** 只读 rootDir + 只写 rootDir 父目录不可写的部署形态（chmod 0500 父目录）→ 启动行为符合设计明示语义并输出可诊断文案。
6. **（#7）** 坏 token 升级 → 断言 NDJSON 出现 `auth-upgrade-rejected`（reason=invalid-credentials）映射事件（若采信 directive #7）。

## 结论

**REJECT**。设计的组合面盘点、Cordis 装配序、真实 WS transport、单一拆卸链停机、零 `packages/**` 边界全部经源码核实成立，测试基建声明属实——骨架是可实施的。但 #1（授权配置形状自相矛盾，生产 ns 授权路径不可实现）为 CRITICAL 内部矛盾，#2/#3 为部署面真实竞态与静默失败链，#4 为 AC 覆盖不闭合；四项均为窄修正（预计各 ≤10 行设计改动 + 对应红测条目），修完可直接重审。MINOR 项建议随修订一并处理（#9 的引用修正为 SA4 复核硬要求）。

pass 之外的说明：本 REJECT 不涉及对既有包契约的怀疑——全部冻结 API 已核实无误；阻断点均在 app 自身配置模型与运维面设计内部。

# SA8 冲突门禁报告（设计后复审）— issue #270 SA1 设计 vs ADR/CONTEXT 决议集

- 被审对象：`wiki/raw/task_issue-270_design.md`（SA1 架构设计，iteration 0，§15 自报 `requiresConflictRecheck: true`——本报告即该复审）
- 冲突基准：`docs/adr/` 全集 0001–0012、0014、0015（无 0013；前置门禁全量读取，本复审对核心关联条款 0006 L86、0008（单序列器/close barrier）、0009 L8/L16/L99–103/L118、0010 L90/L175/L179、0011 L129、0012 L5/L19/L29/L33/L35/L37、0014 L242/L363、0015 L18/L20/L32/L113/L165–178/L186/L210/L232 逐一重读原文核对）+ `CONTEXT.md`；停机语义按 ADR 0010 L179 并入 `docs/protocols/instance-replication-v1.md` §21（L582–591，下称 protocol §21，§n 引用）
- 复审类型：Phase 设计后复审（SA2 全维度攻击评审之前的冲突复核；不判断设计优劣/实现质量）
- 基线：HEAD `0b06050`（branch `mabf/issue-270`，= `origin/docs/rest-namespace-create`）；SA6 冻结契约 3 文件在场未改
- Issue comments：dispatch 前 REST 读为 `[]`（前置门禁两读 + SA6 两读同证）；本轮 dispatch 快照亦为 `[]`——无 owner 追加要求，验收口径 = Issue body
- 上游链：SA8 前置门禁 `wiki/raw/task_issue-270_sa8_gate.md`（verdict `clear`，advisory A1–A3 + 冲突点 4 状态注记）→ SA6 验收契约 `wiki/raw/task_issue-270_sa6_contract.md`（verdict `approve`，H1–H4 契约假设）→ SA1 设计（本复审对象）
- 技能加载注记：`sa8-conflict-gate` 技能在本环境技能目录（`.agents/skills/`）中不存在（skill 工具返回 unknown，与前置门禁同款）——本报告按 SA8 章程（冲突基准只有 ADR 全集 + CONTEXT.md；被 superseded 的 ADR 不构成约束；代码与 wiki 其他文档不构成自动阻塞依据）独立执行；代码锚点仅作事实核验、非阻塞依据

## Verdict

**`clear`** —— 设计与 ADR/CONTEXT 决议集零冲突，可进入 SA2 设计评审。

裁决分布：**0 hard-violation、0 evolution（需 override 的契约修订）、0 override-declared、5/5 复查面 no-conflict**
（4 个派发复查面：共享 Registry 观测面、REST/WS raw path 分流、有界 REST drain 先于 Registry shutdown、
close-session-before-Lease-release 保全 + observer 显式注入；1 个设计 §15 自报增量面：公共 API/事件增量与切片状态）；
另有 **2 条 advisory（R1 文档精度——设计 §6 与 §8 停机映射不一致，R2 双 503/500 占位的 FR-3 收敛登记义务；均不阻塞、
纯文字/登记性，随 SA2 评审修订一并落实）** 与 4 条解释性注记（N1–N4，无需动作）。

一句话理由：SA1 设计把前置门禁已放行的 issue #270 四条 AC 全部具体化为**既有条款的实例化**——`NomicoreApp.registry`
观测面是 ADR 0015 L20「共享同一引用、不运行时替换」在 composition root 自身 face 上的加法式投影（ADR 0012 L29
否决的是 plugin service 面暴露，域界不同）；raw path 分流严格落在 ADR 0015 L32 指定的 server 归属（REST router
不拥有 listener/drain，`HubListenAdapter` 包契约零改动）；有界 REST drain 插在 `registry.shutdown()` 之前正是
ADR 0015 L210「等待已接纳REST/WS工作……再shutdown Registry与Persistence」的唯一被 normatively 固定的位置，
其有界性（预算 + abort + 进程级 watchdog）恰是 protocol §21 L591 指派给宿主的有界退出责任；A1/A2 按 ADR 0010 L90
与 ADR 0015 L186 原样消费与显式注入，`packages/*` 全 DENY——零 wire 字节、零包公共契约变更、零状态机/错误码新边、
零所有权越界。

## 派发复查面逐项裁决

### 1. 共享 Registry 观测面（H2 → D2）—— no-conflict

| 设计动作 | 基线条款 | 复核结论 |
|---|---|---|
| `NomicoreApp` 增 `readonly registry: NamespaceRegistry \| undefined` getter，委托 `handle.registry` 私有字段（= boot 时 `requireNomicoreRegistry(ctx)` 取得的同一实例），构造注入 REST router 的即该字段，构造后零再赋值路径；`stop()` 后不清空 | ADR 0015 L20「composition root 构造 REST 与 WebSocket Module时注入并共享同一个 `NamespaceRegistry` 引用……不在运行时静默替换 Registry」；ADR 0009 L16（`ctx.nomicoreRegistry` 提供同一个 Registry）+ L118（REST、WS 和管理任务共享一个安全生命周期入口） | ✓ 加法式公共面增量；getter 终生同一实例正是「不运行时替换」的观测面投影。实证：当前公共面恰 4 成员（app.ts:103–112 `ready/stop/sink/handleControlLine`），无既有测试断言键集封闭（grep 无命中）——§10 调用方零改动主张成立 |
| 观测面落在 composition root 自身 face（app 对象），非任何 `@nomicore/*` 包或 WS plugin service 面 | ADR 0012 L29 被否决项「WebSocket plugin 暴露 raw Registry、ReplicationSession 或 live Y.Doc：扩大可信能力面」；L33「Composition root 拥有……Namespace Registry 的创建、配置和最终 teardown」 | ✓ 前置门禁 R5 已划定域界：L29 禁的是 **plugin 公共 service 面**向外暴露裸能力；composition root 是 Registry 的拥有者，其自身 face 暴露自身句柄与 `stop()`（可拆毁一切）同信任域，不属该否决域。包 DENY 全保持，无任何包公共面新增 Registry 暴露 |
| REST router 构造注入 `registry: this.registry`（D1/D5），router 不读 Cordis Context、不按请求查找 | ADR 0015 L20「核心 Module 不读取 Cordis Context，不按请求或消息重新查找 Registry」 | ✓ router 是 Host 无关普通 Module（ADR 0015 L18）；引用仅由 composition root 在 boot 期经 Cordis service 取得一次——「composition root 取得后直接注入」与「Registry plugin 经 `ctx.nomicoreRegistry` 服务面向 Cordis 宿主」两层无矛盾（前置门禁 R2 同款裁定） |
| 类型取 `\| undefined` 而非 SA6 H2 原案的裸 `NamespaceRegistry` | —（诚实类型化，非基线条款面） | ✓ registry fiber 就绪前返回 `undefined` 是事实语义；与 SA6 `appRegistry()` 结构窄化 `{ readonly registry?: NamespaceRegistry }` 结构兼容——SA6 §15「等价但不同名须适配」条款不触发（名称与语义均按原案，仅类型诚实化）。测试面零字节改动的最终成立性属 SA6/SA2 域，SA8 确认无 ADR 冲突 |

### 2. REST/WS raw path 分流（H1 → D3）—— no-conflict

| 设计动作 | 基线条款 | 复核结论 |
|---|---|---|
| hub 角色无条件构造 REST router 并挂载 plain-HTTP 分流；零新增配置键、无 opt-out；peer 无 listener 不构造 REST 面 | ADR 0015 L32「server 先按 raw path 选择 REST 与 WebSocket route family」；Issue body 该句为无条件句 | ✓ 分流义务落在 server（组合根单一 listener），正是 L32 指定的归属；无任何 ADR 要求配置门或 opt-in；SA6 H1 原案确认 → 不触发契约修订轮。role 单真相取 `requireNomicoreInstance(ctx).role`（D6）严于 ADR 0012 L33「Instance service 是 `instanceId + role` 的唯一生产来源」——同向收紧，非冲突 |
| plain 普通请求 REST family 优先（标准 Web `Request` 构造 → `restRouter.handle`）：`matched:true` → Response 写回；`matched:false` → 回落 listener 自有路由（`/healthz` 200 / 其余 404，与现行逐字节一致）；upgrade 维持 `/replication` 单一门（404/401/403/503 语义不改） | ADR 0015 L32（判别结果表达 route 是否匹配 + server 先选 family）；ADR 0012 L35（Hub plugin 只拥有 listener、controller、连接/channel 与 service） | ✓ 两族互不接管（M2′ 变异被 T2/N3 捕获）；REST path upgrade 404 = 现状（C3）；既有 listener 面/凭据门零漂移（N3 锚） |
| 实现 seam：`startHubWsServer`/`createNodeHubListenAdapter`/`createHubListenAdapter`（全部 app-owned 层）增可选 `handleRequest` 钩子，缺省路径逐字节保持；`HubListenAdapter` 包契约（plugin.ts:63–71）零改动 | ADR 0012 L35（plugin 拥有 listener 注入面但不新增 plain-HTTP 语义）；前置门禁「零契约变更交付」预测 | ✓ ws-replication 包全 DENY；plugin 所有权与注入契约不转移；直用 adapter 的既有测试（`node-hub-peer-live`、`ws-server-upgrade-admission` 等）零影响 |
| body 以流透传（`Readable.toWeb` + `duplex:'half'`），适配层不预读 body | ADR 0015 L94–99（有界收集在 endpoint/router 内）+ L113（body 读取阶段策略单点）；FR-1 limits/`Request.signal` 为后续票 | ✓ 保留 router 的 body 策略单一位置（FR-1 加法前提）；limits 延后属前置门禁 R6 已裁定的切片序（Issue「不等待完整错误契约」），且受信暴露边界已由 ADR 0015 L36 文档化——非冲突 |
| 停机期迟到普通请求 503 intake 门（server 层、pre-router、不进入任何 route family） | protocol §21 ①（停止接纳）；ADR 0015 L175 的 503 是 router 内 `REGISTRY_NOT_ACCEPTING` 的错误契约映射 | ✓ 两个 503 分属 server transport 层与 router 错误契约层，语义同向（不接纳、明确可稍后重试）；表面形状统一留 FR-3——advisory R2 登记 |

### 3. 有界 REST drain 先于 Registry shutdown（H3 → D4）—— no-conflict

| 设计动作 | 基线条款 | 复核结论 |
|---|---|---|
| `performStop()` 在 hubService.stop / listenerClosed / peer stop 之后、sink `replication-drained` 与 `registry.shutdown()` 之前插入 `await this.restHost.drain(REST_DRAIN_BUDGET_MS)`，等待已接纳（handlePlain 入口登记 in-flight）REST 工作结算 | ADR 0015 L210「按顺序停止intake、等待已接纳REST/WS工作、释放Lease/Session，再shutdown Registry与Persistence」；SA6 H3（已接纳 REST 工作必须在 `registry-stopped` 前完成提交且可从持久化恢复） | ✓ 被 normatively 固定的锚点是「已接纳工作 settle **先于** Registry shutdown」——设计把 drain 插在其唯一正确位置（registry.shutdown 之前）。不排空则 T3 红（SA6 §9-E2-M3 实证 `REGISTRY_NOT_ACCEPTING` rejection）正是该锚点的可执行证明；M5（registry 提前）被 T3 单点捕获 |
| drain 有界：预算常量 `10_000`ms（模块常量、无配置键）+ 超时对剩余 in-flight 逐个 abort（销毁 socket）；无 in-flight 时即时返回 | protocol §21 L591「宿主负责以进程级总停机 watchdog 提供整体有界退出」（包内 Runtime 域无取消 deadline——#229 临时措施句）；ADR 0011 L129 / ADR 0014 L242/L363（Host shutdown 不无限等待）；main.ts 60s watchdog；N2 `<15s` 锚 | ✓ 有界性正是 §21 指派给**宿主**的责任形态；设计未在 ws-replication 包内加任何 timeout（包 DENY，包内「已接纳 apply 无条件排空」语义零触碰）；10s < 60s watchdog；双 intake 门（503 + listener close）使竞态窗内迟到请求也 ≥400 |
| 超时 abort 的分层语义：仍在读 body 的请求（未过 Registry 接纳）→ 流错误结算、Registry 零触达；已进入 `registry.create` 的在途槽 → socket 销毁只断响应通道，create 不被取消、由 orchestration 等待 settle 并 release Lease，`registry.shutdown()` 的「等已接纳 lifecycle 槽结算」二次保障 | ADR 0015 L113「body读取阶段尊重`Request.signal`，中断后Registry零触达；调用Registry后不传播客户端取消，必须等待create settle并release Lease」；ADR 0009 L99（shutdown 等待此前已接纳 lifecycle 操作结算） | ✓ abort 针对的挂起 body 读取属 L113 前半句明确允许的「中断后 Registry 零触达」分支；已过接纳的 create 照常服务端结算（写回失败被吞）——「取消不传播、必须等待 settle 并 release」不变量保持；lease release 恰一次仍由 router 包内编排承担（#267 冻结面），drain 不注入任何取消 |
| drain 在 `performStop()` 单链内单点调用；`stop()` 单飞幂等（same-Promise）；diagnostics O(1) close 位置不动；不新增第二条拆卸链 | ADR 0012 L19/L37（composition root 拥有最终 teardown；Registry → Persistence → Timer/Clock 逆序释放）；ADR 0011 L129/0014 门槛 13；前置门禁 A3 | ✓ 现行链（C6：replication-drained → registry-stopped → diagnostics-closed → persistence-disposed → app-stopped）仅增量插入一步，Registry 先于 Persistence 维持（ADR 0009 L103）；N2 恒绿锚继续覆盖 |
| sink `replication-drained` 语义扩宽为「intake 已停 + 已接纳 REST/WS 工作已 settle + 会话/租约已释放」 | —（app 级 NDJSON 事件面：无 ADR/CONTEXT 条款冻结该事件语义；ADR 0015 L210 停机句的事件投影） | ✓ 事件名不变、无测试断言其排除 REST；app AGENTS.md 单链表述随 ALLOW LIST 一句式同步（docs/AGENTS.md「代码行为变化须同步规范文档」义务已承接） |
| 跨族执行序：WS 包停机（含包内 close session → release lease）先于 server 级 REST drain 执行 | ADR 0015 L210 四段式粗摘要；ADR 0010 L179/L321「composition root 只按 protocol §21 编排**包级**停机顺序」 | ✓ 见解释性注记 N1：被固定的锚点全部满足（intake 先行；两族已接纳工作均先于 Registry shutdown；Lease/Session 先于 shutdown；Registry 先于 Persistence）；REST settle 与 WS 会话/租约释放之间的**跨族**相对次序无条款固定（前置门禁 A1 已把「释放 Lease/Session」按集合式列举裁定）；包级次序（§21 ①→②→③ 包内经 `hubService.stop()` 原样、④⑤⑥ 照旧）逐字保持 |

### 4. close-session-before-Lease-release 保全 + observer 显式注入（A1/A2 → D4 步骤 2 / D5 / D6）—— no-conflict

| 设计动作 | 基线条款 | 复核结论 |
|---|---|---|
| 集成层只 `await hubService.stop()`（WS 1001 `'hub-shutdown'` + Runtime barrier），不重排、不绕过包内 `closeSessionAndRelease`；集成观测面 = 1001 clean close + `replication-drained < registry-stopped`；`packages/ws-replication/**` 全 DENY | ADR 0010 L90「Lease release 同步停止 session 接纳；channel 关闭先关闭 session，再释放 Lease」；protocol §21 ③（close sessions 并 release replication leases）；前置门禁 A1 | ✓ 实证 `hub-namespace.ts` L436 注释「严格保持 close session → release lease 的完成顺序」及 L434–452 实现；包内精确次序由包级契约锁死，#270 只消费不重排（C9）；M5 变异（registry.shutdown 提前）被 T3 捕获 |
| `bootHub()` 构造点显式注入两个 no-op observer：`createRestRouter({ role, registry, metricsObserver: () => {}, diagnosticObserver: () => {} })`；漏注入 → 构造期 `TypeError` → `ready` reject（fail loud） | ADR 0015 L186「构造时必须显式注入两个同步void observer；传no-op也必须是显式决定」；前置门禁 A2（Issue 豁免的是 observer **行为**验收，非构造期注入义务） | ✓ 实证 `rest.ts` L42–55/L122–138：observer 非函数即 `TypeError`（「必须显式注入（no-op 须显式）」）；M4 变异（删 `diagnosticObserver`）→ 7/7 启动点红已证敏感；不预发明事件形状（FR-4 后续票） |
| role 自 Instance service 读取后注入（D6），备选 `this.config.role` 被显式否决 | ADR 0012 L33「Instance service 是 `instanceId + role` 的唯一生产来源」 | ✓ 单真相纪律的更严读法；与 ws-replication plugin 的取值路径（同经 `requireNomicoreInstance`）同源，消除第二来源观感 |

### 5. 公共 API/事件增量与切片状态（设计 §15 自报第 1/2/4 项 + D8）—— no-conflict（含 advisory R2）

- **公共 API 增量**（`NomicoreApp.registry`、`handleRequest` 钩子、`RestHosting` 模块、REST drain 生命周期步）：全部
  `apps/yjs-server` app 级加法增量；零 `@nomicore/*` 包公共契约变更（DENY 全包；ADR 0015 L18「首版只公开 REST
  router」原样保持）。§10 调用方影响矩阵与实证一致（公共面无键集封闭断言、缺省 adapter 路径逐字节不变、
  main.ts 零改动）。✓
- **新增 app 级 NDJSON 事件 `rest-request-failed`**（D8）：落 app 自有 stdout 事件面（与 `app-stop-failed` 同族），
  实证无同名碰撞（app.ts sink 事件清单：listening/ready/provision-*/replication-drained/registry-stopped/
  diagnostics-closed/persistence-disposed/app-stopped/app-stop-failed/reply/target-added/replica-reset/
  namespace-deleted）；不触碰 protocol §23.1 ws-replication observer 词汇（不同 seam，append-only 词表无涉）。✓
- **D8 rejection → 500 `text/plain` 占位**：ADR 0015 L165–178 的 problem shape/`INTERNAL_ERROR` 映射属 FR-3；
  Issue「不等待完整错误契约」+ 前置门禁 R6/冲突点 4（切片序、ADR 0015 提议态 rides OPEN PR #158）下占位不构成
  违约；设计显式声明 FR-3 落地时以加法替换、且不做被禁止的静默 404 回落（已匹配路由的失败不得伪装「无此路由」）。
  收敛义务登记见 advisory R2。✓
- **H4 集成 seam**（设计 §15 未单列但属派发复审范围）：REST hosting 只落 `createNomicoreApp`（`main.ts` 唯一生产
  入口，拥有 Registry + Persistence 生命周期）——ADR 0012 L5「Standalone yjs-server 继续作为上层 composition
  root，显式组装 Instance → Clock → Timer → Persistence → Registry → role-specific WebSocket plugin」与 ADR 0010
  L175（最小 composition root）下，AC3「shutdown Registry 与 Persistence」只能在此兑现；遗留 `createYjsHubServer`
  （不拥有 Persistence）零改动，其冻结兼容面不受扰。装配序增量（registry fiber 就绪后、hub plugin listen 前构造
  restRouter/restHost）不改变 ADR 0012 的组装顺序。✓

## 前次门禁义务落实核验

| 前次门禁义务 | 设计落实 | 复核 |
|---|---|---|
| A1 停机「先 close session、后 release Lease」（ADR 0010 L90 / §21 ③） | §6/§7-D4 步骤 3：只 `await hubService.stop()`，包内次序原样消费；集成面以 1001 + 事件序观测 | ✓（复查面 4） |
| A2 构造期两个同步 void observer 显式注入（ADR 0015 L186） | §7-D5 显式 no-op 注入 + 构造期 TypeError fail-loud | ✓（复查面 4） |
| A3 停机有界、单一拆卸链（ADR 0011 L129 / ADR 0014 门槛 13） | §7-D4：drain 有界（预算 + abort）插在既有单链内；diagnostics O(1) close 位置不动；`stop()` 单飞不变 | ✓（复查面 3；N2 恒绿锚继续覆盖） |
| 冲突点 4：ADR 0015 提议态状态注记 | §6 末行两种读法同构声明；§15 第 3 项将 H1–H4 一并送审 | ✓（本复审即其收敛动作之一；PR #158 合入时状态自收敛） |
| R1–R6（要求项 no-conflict 前提下的零契约变更交付） | DENY 全 `packages/*`、`docs/adr/**`、`CONTEXT.md`、`docs/protocols/**`；ALLOW 仅 app 层 6 文件 | ✓（实证 DENY 面与设计 §11 一致） |

## H1–H4 仲裁复核

| 假设 | SA6 原案（§12.1） | SA1 裁决 | SA8 复核 |
|---|---|---|---|
| H1 默认承载 | hub listener 默认承载 REST + WS raw-path 分流，无 REST 必填新配置键 | **确认**：零新增配置键、无 opt-out（hub 无条件挂载；peer 无 listener） | no-conflict（复查面 2；不触发 SA6 修订轮） |
| H2 观测面 | `readonly registry: NamespaceRegistry`（ready 后可用），`appRegistry()` 唯一适配点 | **确认，类型诚实化** `\| undefined`（ready 前/启动失败 = 事实语义） | no-conflict（复查面 1；结构兼容 `appRegistry()` 窄化，SA6 §15 适配条款不触发） |
| H3 停止语义 | intake 停 → 已接纳 REST/WS settle → Lease/Session 释放 → `registry.shutdown()` → persistence dispose；已接纳 REST 提交须在 `registry-stopped` 前落盘可恢复 | **确认 + 补机制**：双 intake 门（503/ECONNREFUSED）+ 有界 drain（10s 预算 + abort）插于 registry.shutdown 前 | no-conflict（复查面 3；N1 跨族次序注记、R1 文档精度项） |
| H4 集成 seam | 部署组合根 `createNomicoreApp`（拥有 Registry + Persistence），遗留 `createYjsHubServer` 不在验收面 | **确认**：遗留面零改动、REST hosting 单落组合根 | no-conflict（复查面 5 末条；ADR 0012 L5/0010 L175） |

## Advisory（不阻塞；随 SA2 评审修订一并落实）

**R1（文档精度——设计 §6 与 §8 停机映射不一致，须修正设计文本并约束 AGENTS.md 补充句措辞）**：
设计 §6「protocol §21 六步梯子」行的 server 级投影写作「②=REST 排空 + 包内 apply 排空；③=包内
closeSessionAndRelease」——把 REST 排空归入 ② 并置于 ③ 之前；但 §8 停机状态机的实际执行序是 step 2
`await hubService.stop()`（包内一次完成 ②→③，protocol §21 L591「Hub replication close Promise 必须等待停机前
已接纳 apply 无条件排空、session close 与 replication lease release」）→ step 4 `restHost.drain()`——REST 排空
在包内 ③ **之后**执行。§21 梯子对 replication 包内次序与包级编排（④⑤⑥）是 normative 的（ADR 0010 L179/L321），
server 级 REST drain 本无梯子位；§6 现文若照抄进 `apps/yjs-server/AGENTS.md` 的一句式补充（ALLOW LIST 已列），
将登记实现不具备的次序，违反 docs/AGENTS.md「documentation-only wording changes must not invent implementation
behavior」。**修复**：§6 该行改为与 §8 一致的表述（例：「①=intake 停止 + WS 1001；②③（WS）=包内 apply 排空 +
closeSessionAndRelease（`hubService.stop()` 内完成）；server 级 REST drain 在 ③ 后、④ 前插入；④⑤⑥ 照旧」），
并确保 AGENTS.md 补充句同款。纯文字，不动任何决策语义，不构成阻塞。

**R2（表面收敛登记——FR-3 前置义务，不阻塞）**：同一 listener 将出现两个 503 来源（server intake 门 `text/plain`
vs router `REGISTRY_NOT_ACCEPTING` problem shape）与一个 500 占位（`text/plain` vs FR-3 `INTERNAL_ERROR` problem
shape）。ADR 0015 提议态 + Issue 切片句（「不等待完整错误契约」）下这不是违约；但 FR-3 落地票必须收敛两处表面
（intake 门 503 采用 problem shape，或显式登记为 transport 层拒绝、非 router 错误契约成员；500 占位按设计已声明的
加法替换）。建议在设计 §9/§13 或 follow-up 清单显式登记该收敛义务，防止占位被误当终态契约固化进规范文档。

## 解释性注记（无需动作）

- **N1（跨族次序读法）**：Issue/ADR 0015 L210/SA6-H3 的四段式箭头句被读作锚点集合而非跨族全序——被 normatively
  固定的是：intake 先行；两族已接纳工作均先于 Registry shutdown settle（REST 提交且落盘可恢复）；Lease/Session
  先于 shutdown 释放；Registry 先于 Persistence。REST settle 与 WS 会话/租约释放之间的跨族相对次序无条款固定
  （前置门禁冲突点 1/A1 已把「释放 Lease/Session」按集合式列举裁定；REST create 自身的 lease 由 router 编排在
  工作结算内释放——ADR 0015 L158–159 步骤 9，属「工作 settle」的一部分）。设计选 WS 先停（保持现行链 C6 最小
  增量）合规；协议梯子的包内/包级次序逐字保持。
- **N2（`NomicoreApp.registry` 信任域）**：getter 交付带 `shutdown()` 的活 Registry；消费面 = `main.ts` + 进程内
  宿主测试，与 `stop()` 同信任域。无 ADR 冻结 app face 键集；不构成 ADR 0012 L29 否决域（见复查面 1）。
- **N3（D7 根入口导入）**：ADR 0015 L18 规定「REST Adapter 由 `@nomicore/namespace-api/rest` 暴露」——包
  `index.ts:4` 头注自证「`.` 与 `/rest` 同面」且根入口导出 `createRestRouter`（index.ts:7）；子路径暴露面仍在，
  导入路径选择（规避 vitest alias 无子路径规则，C10 实证）不改变 ADR 所定暴露面。纯工具学裁决。
- **N4（CONTEXT.md 零变更成立）**：`registry` getter 是代码面非域术语；`rest-request-failed` 是 app 事件字面量
  非域术语（与 #254 复审 N2 同款推理）；设计 DENY `CONTEXT.md`/`docs/adr/**`/`docs/protocols/**` 正确——本设计
  是既有决策的实例化，无需 ADR 修订节（无任何 normative 文本的 stated contract 被改变；app AGENTS.md 同步已在
  ALLOW LIST）。

## 实证核验（前置事实，非阻塞依据；行号 = 基线 `0b06050`）

| 设计主张 | 证据 | 结论 |
|---|---|---|
| `NomicoreApp` 公共面恰 4 成员、无 registry | `apps/yjs-server/src/app.ts:103-112`（interface）、`162-172`（publicFace） | ✓ |
| boot 在 registry fiber 就绪后取得唯一 Registry 引用，再 bootHub/bootPeer | `app.ts:232-237`（`await registryFiber … this.registry = requireNomicoreRegistry(ctx) …`） | ✓ |
| 现行停机链与 drain 插入点前后文（replication-drained → registry.shutdown → … → app-stopped） | `app.ts:414-468`（performStop） | ✓ |
| listener 普通请求固定 `/healthz` 200 / 其余 404 | `transport/ws-server.ts:161-169` | ✓ |
| `createRestRouter` 构造期 observer 缺失即 `TypeError`（「必须显式注入（no-op 须显式）」） | `packages/namespace-api/src/rest.ts:42-55, 122-138` | ✓ |
| 根入口与 `/rest` 子路径同面、根导出 `createRestRouter` | `packages/namespace-api/src/index.ts:4, 7` | ✓ |
| 包内 close session → release lease 严格次序（含注释） | `packages/ws-replication/src/hub-namespace.ts:434-452` | ✓ |
| 根 vitest alias 仅覆盖 `@nomicore/<pkg>` 根入口 + `/testing` + `/internal`（`namespace-api/rest` 无规则） | `vitest.config.ts:7-12` | ✓ |
| `rest-request-failed` 无同名碰撞（app sink 事件清单逐一清点） | `app.ts` sink 调用点全清单 | ✓ |
| 无既有测试断言 app 公共面键集封闭 | grep `apps/yjs-server/test/**` 无 `Object.keys(app)`/`'registry' in` 命中 | ✓ |
| ADR/protocol 引文逐字性 | 0015 L20/L32/L113/L165-178/L186/L210/L232、0009 L8/L16/L99-103/L118、0010 L90/L175/L179、0012 L5/L19/L29/L33/L35/L37、0011 L129、0014 L242/L363、protocol §21 L582-591 均自原文直接读取核对 | ✓ |
| SA6 冻结契约在场未改、SA2 评审文件不存在（iteration 0） | `apps/yjs-server/test/issue270-*.ts` 三文件在场；`wiki/raw/task_issue-270_sa2_review.md` 不存在 | ✓ |

## 结论与后续门禁判定

**`clear`。** issue #270 SA1 设计的五个复查面（共享 Registry 观测面、REST/WS raw path 分流、有界 REST drain 先于
Registry shutdown、close-session-before-Lease-release + observer 显式注入保全、公共 API/事件增量与切片状态）全部
落在既有决议（ADR 0006/0008/0009/0010/0011/0012/0014/0015 + protocol §21 + CONTEXT.md）条款之内或为其加法式
实例化：零 wire 字节、零包公共契约变更、零错误码/注册表/状态机新边、零所有权越界、零拆卸链分叉。R1/R2 两条
advisory 仅涉及设计文本内部一致性与 FR-3 收敛义务登记，修复为纯文字增改，已具名到设计章节，随 SA2 评审修订
一并落实即可。

**`requiresConflictRecheck: false`** —— 前提：设计按本报告落入 R1（§6 §21 映射行与 §8 实际停机序对齐，并约束
app AGENTS.md 补充句措辞）与 R2（FR-3 表面收敛义务显式登记）；该等修订属文字/登记性变更，无需再开 SA8 门禁。
**重开条件**（任一即须新门禁）：停机链任何把 REST drain 移到 `registry.shutdown()` 之后、或交换 Registry 与
Persistence 次序的改动；Registry 经任何 `@nomicore/*` 包公共面暴露；H1 反转为显式 opt-in 配置键；触碰
`packages/*` 公共契约或 ws-replication 包内 close/release 次序；在 FR-3 之前把 problem shape 或占位 500 当终态
契约写入规范文档；ADR 0015 状态变化（被修订/superseded）导致本复审引用条款失效。

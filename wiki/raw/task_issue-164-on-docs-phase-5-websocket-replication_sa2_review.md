# SA2 攻击评审报告 — issue #164 切片 9（apps/yjs-server 组合根 + 真实 WebSocket adapter）

**Date**: 2026-08-30（R0）／ 2026-08-30（R1 增量复审）
**Reviewer**: SA2（Wallfacer）独立全新视角评审
**对象**: `wiki/raw/task_issue-164-on-docs-phase-5-websocket-replication_design.md`（R0 ~815 行 → R1 ~972 行）+ SA6 红灯契约（`apps/yjs-server/test/` 三件套，FS1–FS9 + TF1–TF3）
**任务类型**: Feature（功能开发）
**Verdict**: R0 = **reject**（4 攻击点）→ **R1 = PASS（附 1 条强制 SA3 约束 A5，见 §R1）**。架构面 R0 即认定成立，R1 零改动；A1–A4 全部核实落实；新发现 1 项 R1 引入的伪码级回归 A5（MEDIUM），以约束钉死于 SA3，不构成返工理由。

---

# R1 增量复审（2026-08-30，范围 = R0 A1–A4 + §11 回应；架构面不重开）

## R1.1 逐条核销

### A1（CRITICAL）——✅ 已落实，机制核实
- **单一逃逸机制落地**：§4.5 `escalate(err)` + `runLoud(f)` 双原语同语义（`queueMicrotask(() => { throw err; })`）；
  §4.4(f) cb 经 `runLoud(() => this.wireConnection(ws, token))` 包装；§4.4(f) 本地 catch 收窄为**专职
  ws 内部握手防御**（外部输入，destroy 即可，零 notify——cb 源异常到不了该 catch，注释准确）；
  D3 外层 `.catch` 删二次 notify、改 `escalate(err)` 原样转投。两路径（cb 同步 / 异步 reject）统一
  uncaughtException 域——R0 的语义撕裂消除。
- **全部 notify 调用点盘点**（SA2 全文 grep 复核）：§4.5(1)/(2) 在 runLoud 包装的 wireConnection 内 ✓；
  §4.5(3) accept rejection 显式 `runLoud(() => notify(...))`（R0 裸 notify → UHR 策略依赖路径，已修）✓；
  D3 → escalate ✓；§4.3 httpServer 相位 2 / wss `'error'` 两处**同步 EventEmitter 上下文**直调 notify
  ——throw 沿 emit 同步栈天然 uncaughtException，符合 §4.5 边界纪律条款，正确无需包装 ✓。
- **wireConnection totality 复核**：(1) 工厂 throw 本地 catch；(2) 断言 throw 本地 catch；
  (3) accept 为 async 函数（同步 throw → rejected promise → .then rejection 分支）；
  safeClose* 双吞二次异常——唯一逃逸源 = notify 缺省 throw，唯一边界 = runLoud。清理先行不变式
  （transport 收口 → 真 socket 收口 1011 → notify）在 (1)/(2) 逐行核实 ✓。SA6 冻结语义
  「缺省 = 抛 TypeError」逐字保留（改变的是谁接住它）✓；TF3（恒传 alert）行为不变 ✓。
- **P14 承载假设独立复测**（SA2 自跑，`node /tmp/sa2-p14-verify.mjs`，Node v24.13.0，四例）：
  ① `queueMicrotask(() => throw)` → `UNCAUGHT_EXCEPTION` ✓；② 对照 async throw →
  `UNHANDLED_REJECTION` ✓；③ `--unhandled-rejections=warn` 下 async throw 仍只走 UHR（可被策略
  熄灭）✓；④ 同配置下 microtask-throw 仍必达 `UNCAUGHT_EXCEPTION`（策略无关）✓。
  SA1 P14 实测与 SA2 独立复测同结论——runLoud 选择的确定性 fail-fast 通道成立。

### A2（MEDIUM）——✅ 已落实（甲案），但重写引入 A5（见 R1.2）
- §4.4(d) pre-auth 封顶：`Promise.race([verifyToken(…).then(ok, fold), timeout(helloTimeoutMs)])`；
  executor 同步武装 + `preauthHandle` 声明在先；`await` 后全出口 `clearTimeout`（verdict 赢清未触发、
  timeout 赢 no-op）；wrapper 永不 reject → 迟归不复活 + 零 unhandledRejection（镜像包内
  authRejected 语义）✓。状态映射 401/403/503 全落文（503 'Auth Timeout' 不污染凭据语义）✓。
- 私有装配面核实：`DEFAULT_REPLICATION_TIMEOUTS` 确从包 index 公共出口导出（index.ts:8-11 亲验）；
  `resolveTimeouts` 确不在公共出口——私有合并正当，语义与包内逐字段一致（整值替换缺省）✓；
  非法 timeouts 仍由 `createHubReplication`→validateTimeouts 在构造同步段响亮拒绝（字段初始化先于
  构造体，无绕过窗口）✓。决策记录含乙案否决理由，可复核 ✓。D5 防御条目同步更新 ✓。

### A3（LOW）——✅ 已落实
- §8 P13 补条：假设/依据类型/具体引用（Node docs + SA1 自跑 `/tmp/sa1-p13.mjs` 输出
  `{"headLen":5,"receivedLen":7,"totalPreserved":12,"lost":false}` ×2 + SA2 独立实测交叉引用）/
  风险注记（Node ≥20 稳定）——立法格式合规，SA4 可重跑复核 ✓。

### A4（LOW）——✅ 已落实
- (a) §4.3 相位路由：`pendingStart` 单点（listen 窗口 reject / 运行期 notify），listen 失败 reject 前
  `started = false` 复位（D15）；**并诚实连带修复 R0 未被攻击到的潜伏缺陷**——`once('error')` 在
  start 成功后残留、后续运行期 error 命中已 settle reject = 静默吞（R1 自检发现，加分项）。
- (b) `wss.on('error') → notify` 构造期订阅（D14，D1 同族）✓。
- (c) §10(6) 生产 bind 注记（全接口 `ws://` 裸监听 = 显式登记的生产反模式；必须显式 host 或网关
  收口）✓。

### §11 回应表——✅ 四行齐备（要求/是否落实/位置/摘要），一致性自检声明经 SA2 grep 复核属实
（「沿 upgrade 同步栈冒泡」旧表述已全部废除；D3/D4/D11/D13/D14/D15 与新机制无残留矛盾；
§5.1 十二用例映射零改动；§3 adapter 伪码与 R0 逐行一致——「架构面零改动」声明属实）。

## R1.2 新发现（R1 引入，非 R0 遗留）

| # | 严重度 | 攻击面 | 具体漏洞 | 处置 |
|---|--------|--------|---------|------|
| A5 | **MEDIUM** | §4.4(d) 伪码：sync-throw verifier 逃逸 403 折叠 | R1 把 R0 的 `try { await verifyToken } catch → 403` 重写为 `verifyToken(token).then(ok, fold)`——`.then` 的 rejection 分支只折**异步** throw；**同步** throw 的 verifier（非 async 宿主函数，如未防护的 `JSON.parse(token)`）在实参求值点直接抛出 → 穿透 handleUpgrade → 外层 `.catch` → `escalate` → **进程崩溃**。SA2 实测证实（`node /tmp/sa2-a5-check.mjs`）：async-throw → 403 ✓；sync-throw → `ESCAPED_TO_OUTER_CATCH (escalate → process crash)`；R0 形态两者皆 → 403；包内 gate 4（hub-connection.ts:202-207，try/catch 包住调用）两者皆折 invalid-credentials。**违反设计自身契约文本**（§4.4(d)「verifier 拒绝/抛错 → 403……与包 accept 的 throw→invalid-credentials 折叠一致」）+ 与包先例再次不对称（A2 同族）；token 是攻击者可控输入——宿主 verifier 若存在同步 throw 路径，单请求即成远程崩溃向量（响亮但可用性伤害）。冻结测试不覆盖（harness verifier 恒 async resolve） | **不构成 reject**（契约文本已正确、伪码单行缺陷）：以 §R1.3 约束 2 钉死 SA3 实现——verifyToken 调用求值必须使同步 throw 折入同一 `verifier-threw` → 403 分支（如 `new Promise((res) => res(this.config.verifyToken(token)))` 包住调用，或实参处 try/catch 映射同 outcome）。建议 SA1 择机单行编辑同步伪码（无需再评审）；SA4 静态锚 + SA7 测试锚见 §R1.4 |

## R1.3 SA3 就绪约束（最终版；与 R0 §5 合并更新，冲突处以本节为准）

1. **A1 机制照抄**：escalate/runLoud 双原语（§4.5），禁自创第三种；§4.4(f) cb 必须 runLoud 包装；
   §4.4(f) 本地 catch 仅 destroy（ws 内部握手失败，外部输入）；D3 外层 `.catch` = destroy + escalate；
   §4.5(3) accept rejection = safeCloseTransport + `runLoud(() => notify(...))`；§4.3 两处同步
   EventEmitter 上下文直调 notify（不包装）。notify 缺省 = 就地 throw TypeError（SA6 冻结逐字）。
2. **A5（强制）**：`verifyToken(token)` 的**调用求值**必须同步抛也折入 `verifier-threw` → 403 分支
   （承诺来源 = §4.4(d) 契约文本，伪码缺陷行以本约束为准）；实现形态二选一：
   `new Promise((res) => res(this.config.verifyToken(token))).then(ok, fold)` 或实参 try/catch 映射。
   SA4 须静态核对此折叠存在；SA7 须有 sync-throw verifier 用例（见 §R1.4）。
3. **A2 pre-auth 封顶照抄**：race + `this.timer.setTimeout(helloTimeoutMs)`（executor 同步武装、
   声明在先）；await 后全出口 clearTimeout；timeout → `respondHttp(503,'Auth Timeout')`；
   wrapper 永不 reject；verifier-threw / verdict.ok≠true → 403；缺凭据/非 Bearer → 401；
   停机（(a)/(e) 门）→ 503。
4. §4.1 eOPT 细则照抄（`| undefined` 联合 + 条件展开）；`resolvedTimeouts`/`maxFrameBytes` 私有
   装配面按 §4.1（DEFAULT_* 合并，整值替换）。
5. §3.2 adapter 精确行为（与 R0 §5.3 相同，逐锚核对 TF1）：ping 不设 closed 门；close 仅
   `readyState===OPEN` 时调 socket.close；onClose 恰一次守卫；text 帧/不明 binary 载体 → close(1002)
   零投递；'error' 最先订阅；send 竞态吸收 + ownClosed。
6. §4.5 顺序与零协议分配（transport 收口 → 真 socket 1011 → notify；拒绝路径不调 accept）。
7. §4.6 停机全序 + 幂等 same-Promise（与 R0 相同）。
8. §4.3 相位路由（pendingStart 挂/摘、失败复位 started、wss 'error' 订阅、closed 单向门）。
9. §6.1/§6.2 接线照抄；§6.2 降级预案触发须登记 dispatch log。
10. 零修改红线（packages/**、SA6 三件、vitest.config.ts、docs、根 tsconfig 基座）+ 验收命令
    （`npx vitest run apps/yjs-server/test` 12/12；`pnpm test` 全量绿；`pnpm typecheck` 0 errors）。

## R1.4 新增红灯测试锚（SA4/SA7 阶段承载，勿改 SA6 冻结文件）

1. **A5 红灯**：非 async verifier（同步 throw，如 `() => { throw new Error('sync') }`）+ 合法形态
   Authorization 头 → upgrade → 断言：HTTP **403**（非 101、非进程崩溃）；进程存活
   （`process.on('uncaughtException')` 计数 0）。对照 R1 伪码字面实现必红（崩进程）。
2. **A1 红灯**（R0 §4.1 方向保留，R1 机制下收紧断言）：无 alert + 缺面 transportFactory →
   `uncaughtException` 捕获 TypeError 含 `'bufferedAmount'`（**必须**走 uncaughtException 域——
   断言 unhandledRejection 处理器零触达，钉死 P14 通道选择）；零 HELLO_ACK；连接 1011 收口。
3. **A2 红灯**（R0 §4.2 方向保留）：永不 resolve 的 verifier → `helloTimeoutMs + slack` 内
   `wsUpgrade` resolve `{status:503, ws:undefined}`；进程存活。

## R1.5 R1 增量复审证据

| 项 | 命令/动作 | 结果 |
|---|---|---|
| P14 独立复测 | `node /tmp/sa2-p14-verify.mjs {1,2}` + `--unhandled-rejections=warn` 对照 | ①UNCAUGHT_EXCEPTION ②UNHANDLED_REJECTION ③UHR 可被 warn 策略吸收 ④microtask-throw 策略无关必达 uncaughtException ✓ |
| A5 实证 | `node /tmp/sa2-a5-check.mjs` | async-throw→403；sync-throw→逃逸至外层 catch（escalate 崩溃）；R0 形态→403；包 gate 4 两者皆折 ✓ |
| 包出口核验 | `sed -n '1,40p' packages/ws-replication/src/index.ts` | DEFAULT_REPLICATION_TIMEOUTS 公共导出 ✓；resolveTimeouts 不在出口（私有合并正当）✓ |
| 一致性 sweep | grep `this.notify(\|runLoud\|escalate(\|同步栈\|unhandledRejection` | 全部调用点边界纪律合规；旧表述零残留；§5.1/§3 与 R0 逐行一致 ✓ |

**R1 最终裁决：PASS（附 §R1.3 十条就绪约束，其中约束 2/A5 为强制）；SA3 可开工。**

---
（以下为 R0 原始评审，存档不改动）


## 0. 评审范围与验证基线

- 亲读：GitHub issue #164 全文（`gh issue view 164`）、SA6 三件红灯测试逐行、
  SA1 设计全文（§0–§11）、`docs/protocols/instance-replication-v1.md` §2/§17/§18/§21、
  ADR-0010 L155-190、`docs/phases/phase-5-websocket-replication.md` §9 + 交付现状表。
- 亲核源码引用（SA1 声称的行号全部核对，**零虚报**）：
  - `hub-connection.ts:48,116`（createHubReplication/accept）✓；`:117-239` 认证门 0–5 ✓；
    `:157-162` 早到帧超界→1009 ✓；`:194` verifyToken 二次消费 ✓；`:576-582` 身份恒等→1008 ✓；
    `:596-605` liveness 双面在场才武装 ✓；`:274-284,405-446` GOAWAY/drain ✓；`:828-838` onLivenessLost→close(1001,'pong-timeout') ✓
  - `hub-namespace.ts:271,590,673` NAMESPACE_UNAUTHORIZED ✓（连接不杀，仅 channel 终局）
  - `types.ts:60-72` DuplexTransport 三可选面 ✓；`validate.ts:55-88` validateHubOptions ✓；
    `defaults.ts` DEFAULT_REPLICATION_LIMITS/TIMEOUTS export ✓；`testing.ts:47` memory transport 零可选面 ✓
  - `namespace-registry/src/types.ts:672-684` shutdown 幂等 same-Promise + 同步段取消 idle timer ✓；
    `registry-shutdown.test.ts:313-343` AC8 同款 fixture 下 shutdown 无需 advanceBy 可结算 ✓（P11 成立）
  - `pnpm-workspace.yaml` 含 `apps/*` ✓；根 `package.json` typecheck 现有 11 项 tsc ✓（§6.2「只增不改」属实）；
    `vitest.config.ts` include 已含 `apps/*/test/**/*.test.ts`（SA6 owned）✓；
    包 exports 惯例 `"."→"./src/index.ts"` ✓（§6.1 与既有包一致）；`tsconfig.base.json` 确含
    `exactOptionalPropertyTypes` + `moduleResolution:"bundler"`（.js→.ts 解析成立）✓
- SA2 自有实测（Node v24.13.0，脚本 `/tmp/sa2-upgrade-test{,2,3}.mjs`，可复现）：
  「upgrade 事件 → 异步验证窗口 → 接管 socket」期间客户端流水线字节**不丢失**——
  与请求同段的字节进 `head`（实测 head.len=5）；窗口内到达的字节被暂停态缓冲、
  接管后照常投递（实测 received=5）。SA1 §4.4 尾注「零丢失、零乱序」**实测成立**（见 A3）。

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| A1 | **CRITICAL** | §4.4(f) × §4.5 notify 默认语义自相矛盾 → 静默降级 | 设计自宣「缺省 alert = 重抛 TypeError 沿 upgrade 事件同步栈冒泡为进程级异常 = 装配错误 fail-fast」（§4.5 notify 注释）。**但** §4.4(f) 对 `wss.handleUpgrade(req, socket, head, (ws) => this.wireConnection(ws, token))` 套了无条件 `catch { socket.destroy() }`。wireConnection 步骤 (1)/(2) 的 `notify()` 在 alert 缺席时抛出的 TypeError 会**同步穿透 cb → ws.handleUpgrade 内部 → 被 §4.4(f) 的 catch 捕获后静默吞掉**（只剩 destroy）。结果：缺省配置（生产最常见形态：不传 alert）下，缺面 transport / 工厂抛错只外显 WS close(1011)，**零宿主可见信号、零进程级 fail-fast**——恰好是 issue #164 R5 与 protocol §17「组合根在装配期对缺面做响亮断言（应用层缺面 = 配置错误，非运行时降级）」立法要消灭的静默降级形态。同时与 D3 路径行为不一致：D3（异步 bug）走 `.catch` → notify 抛 → void-ed promise → **unhandledRejection**（响亮、Node 缺省崩进程）；(f) 路径（同步 cb 抛）被吞（哑）。SA6 冻结契约文本 `alert?: (message: string) => void; // 结构化告警出口；缺省 = 抛 TypeError` 的「抛」语义在主路径上无法兑现。**冻结 12 用例测不到此缺陷**（TF3 恒传 alert），属测试盲区内的设计自毁 | 二选一并写死：(甲) cb 包装 `(ws) => { try { this.wireConnection(ws, token); } catch (err) { queueMicrotask(() => { throw err; }); } }`——cb 源异常（宿主缺陷）转进程级 uncaughtException，§4.4(f) 的 catch 专职 ws 内部握手失败（外部输入，destroy 即可，勿 notify）；(乙) §4.4(f) catch 内区分来源后**重抛** cb 源异常（外层 `.catch` 的 notify-throw 经 unhandledRejection 变响亮）。修订须同步改 §4.5 notify 注释、§5.2 D3、§9 表述，保证两条路径同一响亮语义，并在 §5.1/§5.2 追加防御条目 |
| A2 | **MEDIUM** | §4.4(d) 预验证 await 无界 vs 包内 auth-timeout 先例的不对称 | 组合根预验证 `await this.config.verifyToken(token)` **无任何封顶**：verifier 悬挂（宿主域缺陷）→ socket 悬挂至 close() 清扫。而**同一 verifier 的第二次消费**（accept 门 4）在包内有 `helloTimeoutMs` 认证等待封顶（hub-connection.ts:183-188）——第二层有界、第一层无界，防御不对称。SA1 以「受信域缺陷不设计降级」自辩，但其引用的包先例恰恰给受信 verifier 挂了封顶（auth-timeout 门是包内同类场景的既有立法），论据自相矛盾。触发条件：verifier 永不 resolve（宿主 bug 或下游依赖死锁）+ 客户端持续发起 upgrade → 每请求一个永久悬挂 socket（fd/内存泄漏，仅 close() 可回收） | SA1 明确表态并落文：(甲·推荐) 复用 `timeouts.helloTimeoutMs` 作预验证封顶（零新 knob，与包内同源同值；超时 → 503 + destroy——悬挂是服务侧问题，勿用 403 污染凭据语义）；或(乙) 显式登记「第一层无界」与包先例的分歧理由于 §8/§10，供 SA7 压力域豁免。二选一，不得含糊 |
| A3 | **LOW** | §8 P 表缺「upgrade→handleUpgrade 窗口字节保全」条目（2026-06-13 立法合规缺口） | §4.4 尾注声称「await verifyToken 期间……零丢失、零乱序，由 head 参数与 ws 内部读取统一承接」——这是 Node 流为态假设（流动态无监听即丢弃 vs 暂停态缓冲），属协议/运行时假设，按立法必须在 §N 协议假设依据表中给出可验证依据。P1–P12 无此条。SA2 已实测**结论成立**（Node v24.13.0：同段字节入 head；窗口字节暂停缓冲、接管后投递），故非行为缺陷，是**证据链缺口**——SA4 无法按表复核 | §8 追加 P13：假设「'upgrade' 事件后至 handleUpgrade 接管前，socket 处于暂停缓冲态，窗口内到达字节零丢失」；依据 = Node http/streams 文档（upgrade 事件移交语义）+ SA2 实测脚本与输出（本报告 §0）或 SA1 自跑等价命令贴输出；风险注记 Node ≥20 目标域内该语义稳定 |
| A4 | **LOW** | 工程硬化三则（不阻塞，随修订顺手落文） | (a) `start()` listen 失败（EADDRINUSE）reject 后 `started` 仍 true——重试报「已 start」误导诊断，建议 reject 前复位或文档注明「失败即弃用实例」；(b) `wss` 自身 `'error'` 事件未订阅（noServer 形态罕见但非零路径）——建议 `wss.on('error', …) → notify`，与 httpServer 'error' 同通道，防 EventEmitter 'error' 无监听进程崩溃的同类风险（D1 同族）；(c) `listen.host` 省缺时 Node 绑全接口——§2 已声明 TLS 归网关，建议 §10 显式注记生产必须显式 host 或网关收口 | §4.3/§5.2/§10 增补三行级说明即可 |

**未成立的攻击（防止后人重挖，记录排除依据）**：
- 「verify 悬挂窗口早到字节丢失」——实测证伪（§0），SA1 断言正确。
- 「§21 停机顺序违约」——设计 ①listen 关闭→hub.close（GOAWAY/drain/Runtime barrier 归包，:405-446）→清扫→④registry.shutdown，与 protocol §21 第 1–4 步及 phase §9 裁决一致；⑤/⑥ 无可编排对象（Persistence 经 Registry、timer 由包清）有据。
- 「FS6 destroy 与 close 帧冲刷竞态致断言失败」——FS6 只断言 `wire.closed !== undefined`，1001/1006 均过；设计已自注释。
- 「TF3 memory transport 与真 socket 无关联泄漏」——safeCloseSocket 关真 ws（1011），memory 端 GC，测试两 waitUntil 均可满足。
- 「ping 在收口后仍透传是 bug」——TF1 明确在 text 拒绝后断言 pingData 可写，设计有意不设 closed 门，与冻结测试一致。
- 「exactOptionalPropertyTypes 摩擦」——SA6 测试显式传 `limits: undefined`，设计 `| undefined` 联合 + 条件展开方案正确（base tsconfig 亲验）。

---

## 2. 协议假设依据审查（2026-06-13 立法）

- **章节存在性**：§8 存在，12 条（P1–P12），格式合规（假设/依据类型/具体引用/风险）。
- **依据可验证性**：整体**优良**。源码引用逐行核对全部属实（§0 清单）；设计期实测均附命令与结果（`npm view ws version`→8.21.3、红灯日志直证 .js→.ts 解析、registry-shutdown 先例）；「应该/通常/预计」类无据推断在承重条目上为零。
- **两处缺口**：
  1. P1 声称「cb 同步」仅引 ws README——SA4 须在 install 后以实测复核（可接受，已在风险列）；
  2. **§4.4 窗口字节保全断言未入 P 表（A3）**——SA2 已代为实测成立，但 SA1 必须补 P13 让证据链闭合可复核。
- 结论：**不触发「缺章节即 reject」条款**；A3 随修订补齐。

## 3. 错误处理链路审查（2026-05-07 立法）

- **静默失败检查**：发现 1 处真实静默失败 = **A1**（缺省 alert 下装配期 TypeError 被自身 catch 吞掉：无 alert 记录、无进程异常、仅 WS 1011 收口）。这是本设计唯一的静默失败路径，且恰在冻结测试盲区。
- **状态闭环检查**：良好。所有拒绝路径均收口 socket（401/403 原始状态行、404/503、1011 三面收口、accept reject 分支 D11）；close() 全序有终态承诺（registry stopped / httpClosed 必达，清扫兜底 D9）；幂等 same-Promise（D10）。
- **降级路径检查**：D1/D2（ws error 吸收、发送竞态吸收）= 外部网络故障，正当降级；D4（畸形 URL/握手→404/destroy 不触 loud 通道）= 外部输入，正当；D5（verifier 悬挂）有 close() 清扫兜底但无界（A2 升格处理）。
- **虚假降级识别**：**未发现伪降级**。TF2 的 dormant memory transport 是测试夹具而非生产路径，且 TF3 断言组合根对其响亮拒绝——「缺面 = 配置错误非运行时降级」的定性正确（问题只在 A1 使「响亮」在缺省配置下失真）。
- **用户（宿主运维）可感知性**：alert 在场时每条故障路径均有结构化文本（TF3 锚 'bufferedAmount'）；alert 缺席时按冻结语义应进程级 fail-fast——被 A1 破坏，须修复后方闭环。

## 4. 红线测试思路（每漏洞对应的 IT 编写方向）

1. **A1 红灯**（SA4/SA7 阶段新增，勿改 SA6 冻结文件）：
   组装 `createYjsHubServer` 时**不传 alert** + `transportFactory: () => createMemoryDuplexTransport().hub`；
   有效 token upgrade → 断言：(i) `process.once('uncaughtException'|'unhandledRejection')` 捕获到 TypeError 且
   message 含 `'bufferedAmount'`（`vi.waitFor` 有界等待）；(ii) `wire.frames` 无 HELLO_ACK；
   (iii) 连接以 1011 收口。**对照当前设计文本实现该测试必红**（异常被吞、process 级零事件）——即证明缺陷真实。
   同构第二用例：`transportFactory` 直接 throw（§4.5(1) 路径）→ 同断言。
2. **A2 红灯**（若 SA1 选甲案）：verifier 返回永不 resolve 的 Promise；
   upgrade → 在 `helloTimeoutMs + slack` 有界时间内断言 socket 被收口（RawWsClient.closed 或握手 503），
   且进程存活。若 SA1 选乙案（显式无界），此测试改为 SA7 压力域豁免登记项，静态审查改为核对 §8/§10 文本。
3. **A3**：非行为缺陷，SA4 静态门禁核对 §8 P13 存在且命令可重跑即可。
4. **A4(a)**：start() 传占用端口 → expect reject(EADDRINUSE)；随后再 start() → 断言错误信息明确指向失败根因（或实例弃用语义），不得误报「重复 start」。

## 5. SA3 可执行约束（SA1 修订获 SA2 复审通过后生效）

1. **A1 修复语义硬约束**：缺省 alert 下，wireConnection 内工厂抛错/缺面断言的 TypeError 必须到达进程级
   （uncaughtException 或 unhandledRejection 可捕获）；ws.handleUpgrade 内部失败（外部输入）保持干净拒绝
   （destroy，不 notify、不崩）。两路径语义按 SA1 修订版单一机制实现，禁止 SA3 自创第三种。
2. §4.1 exactOptionalPropertyTypes 细则照抄：可选属性 `| undefined` 联合；向 `createHubReplication`
   传参用条件展开（`HubReplicationOptions` 可选项无 `| undefined`，显式 undefined 非法）。
3. §3.2 adapter 精确行为：ping **不做** closed 门（TF1 顺序锚）；close 仅在 `readyState===OPEN` 下调
   `socket.close(code, reason)`；onClose 恰一次守卫；text 帧/不明 binary 载体 → `close(1002)` 零投递；
   'error' 事件最先订阅；send 竞态吸收 + ownClosed 标记。
4. §4.5 顺序固定：factory → assert（缺面即拒）→ accept；拒绝路径 = transport 收口 → 真 socket 收口(1011) →
   notify；**零协议分配**（不调 accept，零 HELLO_ACK/错误帧）；accept 的 rejection 分支必须存在（D11）。
5. §4.6 全序照抄：closed 先置位 → ①httpServer.close → await hub.close() → socket 清扫 destroy →
   wss.close() → ④await registry.shutdown()（reject 即上抛）→ await httpClosed。closePromise 幂等。
6. §6.1/§6.2 接线照抄：deps 集合、`exports:{".":"./src/index.ts"}`、根 typecheck 脚本只追加一段；
   §6.2 降级预案若触发必须显式登记 dispatch log，不得静默收窄。
7. 零修改红线：`packages/**`、SA6 三件测试、`vitest.config.ts`、docs、根 tsconfig 基座——ALLOW/DENY LIST 为准。
8. 验收命令（照 SA1 §6.4）：`npx vitest run apps/yjs-server/test` → 12/12；
   `pnpm test` → 全量绿（193 文件零回归）；`pnpm typecheck` → 0 errors。

## 6. 复审条件

SA1 提交 R1 修订：A1（必改）、A2（二选一表态落文）、A3（P13 补条）、A4（三行级注记），
并填写设计 §11「SA2 反馈逐条回应」表。SA2 仅复审增量，架构面不重开。

---

## 附：SA2 验证证据清单（命令 + 结果）

| 验证项 | 命令/动作 | 结果 |
|---|---|---|
| issue 全文 | `gh issue view 164 --repo welltop-jim-wang/nomicore --json body` | 取得全文（Scope/强制要求 A11/References） |
| SA1 源码引用抽查 | `read`/`sed -n` 核 hub-connection/hub-namespace/liveness/validate/defaults/testing/types | 全部属实（§0 列表） |
| P11 registry 停机先例 | `sed -n '300,360p' packages/namespace-registry/test/registry-shutdown.test.ts` + types.ts:672-684 | 幂等 same-Promise、同步段取消 idle timer、AC8 同 fixture 下 await 可结算 ✓ |
| 工程接线 | `cat pnpm-workspace.yaml vitest.config.ts` + grep 根 typecheck | apps/* 在列；include 已加；typecheck 11 项 ✓ |
| 窗口字节保全（A3 核查） | `node /tmp/sa2-upgrade-test{,2,3}.mjs`（Node v24.13.0） | 同段字节入 head（len=5）；窗口字节缓冲后投递（received=5）；SA1 断言实测成立 |
| A1 逻辑复核 | 逐行追设计 §4.4(f) catch 与 §4.5 notify 抛错路径 | 同步 cb 抛 → 被 catch 吞（确认）；D3 异步路径 → unhandledRejection（确认不一致） |

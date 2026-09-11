# SA2 设计攻击评审 — issue #270：Server 集成验收（REST 与 WebSocket 共享 Registry + 有序停止）

> 阶段：design-review（iteration 1 —— 修订轮复审）。Dispatch：`sa-012f83db-5c71-40fa-a6c6-f1555d8694b4`（mabf-sa2）。
> 技能：`attack-design` 已加载并按本报告执行。
> 本轮派发指令：复审修订后的 SA1 设计——逐条核验前轮 SA2 MAJOR finding 是否真实落实
> （停机次序文档、boot 窗口停机的 REST drain 安全性、response/error 行为覆盖），并确认未削弱
> SA6 已批契约与 SA8 约束。Issue comments 派发前 REST 快照 = `[]`（无 Owner 追加要求）。

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（Issue #270 body + comments `[]`） | `wiki/raw/task_issue-270.md` | 已读；本轮派发快照 comments = `[]`、owner requirements = Issue body 之外无附加（与 SA8 gate/SA6/SA8 recheck 各轮快照一致） |
| SA1 设计（被审对象，**iteration 1 修订轮**） | `wiki/raw/task_issue-270_design.md` | 已读全文（512 行）；头注声明逐条落实 F1–F4，映射见其 §14 |
| 前轮 SA2 评审（iteration 0，verdict `reject`：F1–F3 MAJOR + F4 MINOR） | `wiki/raw/task_issue-270_sa2_review.md` | 已读（本文件前版）；本轮原位更新 |
| SA6 验收契约（verdict `approve`，H1–H4 契约假设） | `wiki/raw/task_issue-270_sa6_contract.md` | 已读全文；**冻结契约 3 文件 sha256 本轮复算 = SA6 §13.4 逐字节一致**（见 §12） |
| SA8 前置门禁（verdict `clear`，advisory A1–A3 + 冲突点 4） | `wiki/raw/task_issue-270_sa8_gate.md` | 已读全文（附录 A 决议摘录 = `_relevant_decisions` 等价产物） |
| SA8 设计后复审（verdict `clear`，advisory R1/R2，`requiresConflictRecheck:false` 以 R1/R2 落实为前提 + 5 条重开条件） | `wiki/raw/task_issue-270_sa8_recheck.md` | 已读全文；本轮逐条核验重开条件未被触发（见 §5） |
| 派发记录 | `wiki/raw/task_270_dispatch.md` | 已读（round 1 conflict-gate 记录） |
| 源码基线（HEAD `0b06050`，branch `mabf/issue-270`） | `apps/yjs-server/src/{app,main}.ts`、`src/transport/ws-server.ts`、`packages/namespace-api/src/{rest,create-namespace,index}.ts`、`packages/namespace-registry/src/registry.ts`、`packages/ws-replication/src/{hub-namespace,hub-connection}.ts`、`packages/instance/src/index.ts`、`vitest.config.ts`、`apps/yjs-server/package.json`、`apps/yjs-server/test/issue270-*` | 逐锚点核验，含修订新增事实锚 C11（boot 窗口）与 protocol §21 L591 原文（见 §5/§7 证据列） |
| 决策基准 | `docs/adr/0015`（L32/L210 本轮逐字复核）、`docs/protocols/instance-replication-v1.md` §21（L575-600 原文复核）、`docs/AGENTS.md` L13、`apps/AGENTS.md`、`apps/yjs-server/AGENTS.md`、`packages/namespace-api/AGENTS.md` | 已读相关条款原文 |
| 工作树状态 | `git status --short`：生产代码零改动（仅 SA6 契约 3 文件 + wiki 产物未跟踪）；`git log -1` = `0b06050` | 与 SA6 §16/SA8 recheck 基线一致；`rest-hosting-behavior.test.ts` 尚不存在（待 SA3 新建，无既有文件冲突） |

## 2. Verdict

**`approve`** —— 前轮三条 MAJOR（F1 停机映射文档失真、F2 停机链 boot 窗口未防护、F3 验收测试路径
越出 ALLOW LIST）与一条 MINOR（F4 503/500 表面收敛登记）**全部真实落实并经本轮源码级复核**（§13
逐条验收条件核验）；修订未引入新的 BLOCKER/MAJOR；SA6 已批契约零削弱（冻结 3 文件哈希逐字节一致、
H1–H4 全部按原案确认、无修订轮触发）、SA8 约束零削弱（A1/A2/A3 保全、recheck R1/R2 已兑现、5 条
重开条件零触发）。设计可安全进入实现。

`requiresConflictRecheck: false` —— 本轮修订均为文字对齐（F1）、守卫补齐（F2，反而排除一个
TypeError 失败源）、清单增补（F3，新测试文件不触任何生产契约）与登记义务（F4）；SA8 recheck 所列
重开条件（REST drain 移到 `registry.shutdown()` 之后、Registry 经包公共面暴露、H1 反转 opt-in、
触碰 `packages/*` 契约或包内 close/release 次序、占位写成终态契约、ADR 0015 状态变化）逐条核验
均未触发。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1 集成测试证明 REST 与 WS Module 持有同一 `NamespaceRegistry` 引用（不经 Cordis Context、不运行时替换） | §7-D1/D2/D5、§8 装配序 | ✓ 覆盖（iteration 0 已核；本轮无回退）：构造注入同一 `this.registry` 字段引用（app.ts:233 唯一赋值点，源码复核）；router 源码零 Cordis Context 访问；`NomicoreApp.registry` getter 终生同一实例。T1-A/T1-B 冻结契约承接 |
| AC2 raw path 正确分流 REST 与 WS route family | §7-D3、§8 ws-server 增量 | ✓ 覆盖：plain 请求 REST 优先 + `matched:false` 回落（含 query-string 精确等值语义显式化——O1 已落实）；upgrade 维持 `/replication` 单一门（ws-server.ts:192-194 现状核验）。T2/N3 锚定 |
| AC3 停止顺序：停 intake → 等已接纳工作 → 释放 Lease/Session → shutdown Registry 与 Persistence | §7-D4（步 0–7）、§8 停机状态机 | ✓ 覆盖且**本轮一致性问题已消除**：§6 梯子投影行按实际执行序重写（F1），§7-D4 与 §8 步骤号 0–7 一一对应（O4 落实）；boot 窗口守卫入步 4（F2）；插入点与 app.ts:414-468 现行链结构吻合（源码复核） |
| AC4 WebSocket Module 不依赖 REST create | §1 非目标、§7、§12 N1 | ✓ 覆盖：WS 路径零改动；N1 恒绿锚钉住 |
| Issue 范围句：基于骨架 router 落地、不等待完整错误契约/observer 行为、后续 ticket 不破坏本验收 | §1 非目标、§7-D5、§7-D8、§9、§12 N1–N3 | ✓ 覆盖：rejection→500 占位不预发明 problem shape（D8 + §13 FR-3 登记）；observer 显式 no-op；FR-3 表面收敛义务 (a)(b)(c) 登记使「后续 ticket 收敛」有显式交接面 |
| 任务类型承接（Feature：ADR 0015 server 集成验收本体未落地） | §1/§3 | ✓ 与 SA6 §8 缺口链一致 |

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| （无） | — | — | Issue comments REST 快照 = `[]`（SA8 gate 两读 + SA6 两读 + SA8 recheck 一读 + 本轮派发快照均为空）；owner requirements = Issue body 之外无附加。设计 §4 声明与之一致，无遗漏评论 |

## 5. 上游事实与SA8约束

设计 §2 C1–C11 逐条独立核验为真（含本轮新增 C11，见 §7）；SA8 gate A1–A3 与 SA8 recheck R1/R2、
5 条重开条件逐条复核：

| Fact or constraint | Design response | Assessment |
|---|---|---|
| C1–C10（组合根/公共面/listener/router 骨架/停机链/registry.shutdown/依赖/包内次序/alias 解析） | §7-D1–D8 | ✓ 本轮全部复核仍为真（app.ts:188-238/414-468、ws-server.ts:161-169/289-312、rest.ts:119-179、create-namespace.ts:31-81、registry.ts:2120-2169、hub-namespace.ts:1163-1188、hub-connection.ts:398-402、instance/src/index.ts:39、vitest.config.ts:7-12、namespace-api/src/index.ts:7 逐一比对） |
| **C11（新增，F2 依据）**：main.ts:210-212 在 `createNomicoreApp` 返回后即挂 SIGTERM/SIGINT；boot 首个 await（app.ts:195）让出事件循环；boot 各 await 边界 `if (this.stopRequested) return`（app.ts:196/211/232/277/281/304/309）；现行 `performStop` 对全部可能未构造服务守卫（app.ts:414-453） | §7-D4 步 4 守卫理由、§8 装配序/步 4、§9 | ✓ **逐行号复核为真**：七个早退检查点与守卫清单（`hubListener?.close()`@418、`hubService !== undefined`@419、`peerService !== undefined`@423、`registry !== undefined`@428、`diagnostics?.close()`@436/466、`persistenceFiber !== undefined`@448）全部命中——boot 窗口停机真实可达且现行链确有守卫纪律，F2 修复与之同构 |
| protocol §21 L591（「Hub replication close Promise 必须等待停机前已接纳 apply 无条件排空、session close 与 replication lease release」） | §6 梯子投影行（本轮重写） | ✓ **原文逐字复核**（instance-replication-v1.md L591）：②③ 由 `hubService.stop()` 包内一次完成的表述与协议一致；server 级 REST drain 定性为「非梯子成员、无梯子位」符合「composition root 只按 §21 编排包级停机次序」（ADR 0010 L321） |
| **SA8 A1**（先 close session 后 release Lease；ADR 0010 L90/§21 ③） | §8 步 2、§6 A1 行 | ✓ 保全：只 `await hubService.stop()`，不重排不绕过（hub-namespace.ts closeSessionAndRelease 源码复核：`session.close()` 先、`lease.release()` 后）；`packages/ws-replication/**` DENY |
| **SA8 A2**（构造期两 observer 显式注入；ADR 0015 L186） | §7-D5 | ✓ 保全：显式 no-op；rest.ts:137-144 构造期 TypeError fail-loud 路径源码复核 |
| **SA8 A3**（停机有界、单链；ADR 0011 L129/0014 门槛 13） | §7-D4、§8 | ✓ 保全：10s 预算 < main.ts `STOP_WATCHDOG_MS=60_000`（main.ts:30 复核）；单链单点插入、diagnostics O(1) close 位置不动（app.ts:432-437 现状核验）；N2 锚 |
| **SA8 recheck R1**（§6/§8 停机映射一致 + AGENTS.md 措辞约束） | §6 投影行重写、§11 AGENTS.md 行 | ✓ **已兑现（= F1）**：§6 行改为「②③（WS 包内）由 hubService.stop() 一次完成；server 级 REST 排空在 ③ 后、④ 前插入，非梯子成员」——与 SA8 recheck R1 建议措辞同款；AGENTS.md 补充句受同款约束并显式禁止两种失真表述 |
| **SA8 recheck R2**（503/500 表面收敛义务登记） | §13「FR-3 表面收敛义务登记」(a)(b)(c)、§7-D3 规则 1、§7-D8、§9、§11 (c) 约束 | ✓ **已兑现（= F4）**：(a) intake 门 503 定性 transport 层拒绝、(b) 500 占位 FR-3 加法替换、(c) AGENTS.md 不得固化占位 body 形状——三款登记齐备，满足 recheck `requiresConflictRecheck:false` 前置条件 |
| **SA8 recheck 5 条重开条件** | §15 第 2 项逐条自查 | ✓ 本轮独立复核零触发：REST drain 仍在 `registry.shutdown()` 前（§8 步 4 < 步 6）；Registry 仅经 app face 暴露；H1 未反转（D3 零配置键）；`packages/*` DENY 且包内次序零触碰；占位反向受 F4(c) 加固；ADR 0015 状态未变 |
| ADR 0015 状态 = 提议（冲突点 4） | §6 末行、§15 第 3 项 | ✓ 两读法声明保持；SA8 recheck 已裁 no-conflict |
| #229 `hub-restart-static-target-red` 既有 flake | §12 回归行排除说明 | ✓ 与 SA6 §14 三角验证口径一致 |

**H1–H4 仲裁复核（与 iteration 0 相同结论，修订未反转任何一项）：**

| 假设 | SA1 裁决 | SA2 复核 |
|---|---|---|
| H1 hub listener 默认承载 REST，零新增配置键 | 确认（D3） | ✓ 成立：issue 文本为无条件句；`config.ts` 无 REST 键；ALLOW 不触 config.ts；不触发 SA6 修订轮 |
| H2 `NomicoreApp.registry` 观测面，类型诚实化 `\| undefined` | 确认（D2） | ✓ 成立：contract-support.ts:220-226 以 `as unknown as { readonly registry?: NamespaceRegistry }` 结构窄化读取（本轮源码复核）——与 `\| undefined` getter 结构兼容，「测试零字节改动」主张成立；SA6 §15 适配条款不触发（名称与语义均按原案） |
| H3 停止顺序语义 | 确认 + 补机制（双 intake 门 + 有界 drain + **boot 窗口守卫**） | ✓ §7-D4/§8/§6 三处表述本轮一致（F1 修复后）；机制被 T3/M3/M5 锚定 |
| H4 集成 seam = `createNomicoreApp` | 确认（D1） | ✓ 成立：遗留 `createYjsHubServer` 零改动（index.ts 冻结面不受扰）；ALLOW/DENY 一致 |

## 6. 设计内部一致性

| 检查点 | 结论 | 证据 |
|---|---|---|
| §6 梯子投影行 ↔ §7-D4 ↔ §8 停机状态机 ↔ §11 AGENTS.md 措辞 | ✓ **一致（F1 已修复）** | 全文档 grep 复核：REST 排空在所有表述中均位于包内 ②③ 之后（§6「③ 之后、④ 之前」、§7-D4 步 4、§8 步 4、R3 路线、§10 registry.shutdown 行、§11 AGENTS.md 行）；不存在任何把 REST 排空归入 ② 或置于 ③ 之前的残留表述 |
| §7-D4 步骤号 ↔ §8 状态机步骤号 | ✓ 一一对应 0–7（O4 落实） | 两处均为：0 stopRequested/503 门、1 listener close、2 hubService.stop、3 listenerClosed+peer、4 restHost?.drain、5 replication-drained、6 registry.shutdown、7 尾段 |
| §7-D4 步 2 ↔ protocol §21 原文 | ✓ 一致 | L591 原文逐字比对（「已接纳 apply 无条件排空、session close 与 replication lease release」） |
| §7-D3/§8 raw-path 分流 ↔ rest.ts 判别契约 | ✓ 一致 | `{matched:false}`/`{matched:true;response}`；405/403/201 路径齐备（rest.ts:155-176 源码复核） |
| §7-D5 构造注入 ↔ C5/rest.ts | ✓ 一致 | role/registry/两 observer 四必填项 |
| §11 ALLOW LIST ↔ §12 建议测试 | ✓ **一致（F3 已修复）** | §12 全部四例行为测试落位 `apps/yjs-server/test/rest-hosting-behavior.test.ts`（ALLOW 已列）；其余引用均为 SA6 冻结三文件（既有、非新增改动） |
| §13 风险/残余 ↔ 正文 | ✓ 一致 | 导入解析、100-continue、body 无界、boot 窗口竞态（F2 已闭合）、语义扩宽、FR-3 登记逐项对位；回滚行「七文件」与 ALLOW 行数一致 |
| §10 调用方矩阵 ↔ 源码 | ✓ 一致 | main.ts 消费面（main.ts:60-90 shutdown 链复核）；三个直用 adapter 测试文件在场（`node-hub-peer-live`/`ws-server-upgrade-admission`/`ws-replication-issue190-sa7-real-transport`，目录盘点确认） |
| §14 修订映射 ↔ 实际文本 | ✓ 一致 | F1–F4 与 O1/O2/O4/O6 的落点章节逐一在正文找到对应文字 |

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1（=前轮 F2） | boot 进行中（registry fiber/provision/authorization/plugin install 任一 await 边界），`restHost` 尚未构造 | SIGTERM/SIGINT/控制通道 `shutdown` → `stop()` → `performStop()` | 停机链对未构造服务全部守卫 → 干净 `app-stopped`、main.ts exit 0 | ✓ **已修复**：§7-D4 步 4/§8 步 4 均为 `await this.restHost?.drain(...)`，守卫理由与备选否决（`if` 分支等价、不提前构造）齐备；C11 事实锚逐行号复核为真；peer 角色（`bootPeer` 无 restHost）同款跳过；行为测试例 3 锚定 | 无 |
| S2 | 运行期，普通请求已过 `handlePlain` 入口（已登记 in-flight），`stop()` 并发发起 | 双 intake 门 + drain | 门 A（`isStopping()` → 503，不登记）拦新请求；已登记者由 drain 等待结算 | ✓ 无缺口（Node request 事件同步派发——要么已登记要么被 503，无中间态；`stopRequested` 在 `stop()` 入口同步置位） | 无 |
| S3 | drain 预算耗尽，仍有 in-flight 挂起 body 读取 | 超时 abort | 逐个 `req.socket.destroy()` → 流错误结算 → 客户端传输层失败；迟到结算 no-op；drain 幂等 | ✓ 无缺口（诚实失败、有界返回；`registry.shutdown()` 二次保障已接纳 create——C7 源码复核：runShutdown 等待 admittedCreates/carrier tail） | 无 |
| S4 | 二次 `stop()` | stopPromise 单飞 | 同一 Promise，不产生第二条链 | ✓ 无缺口（N2 锚；app.ts:407-412 现状核验） | 无 |
| S5 | 已接纳 create 已进入 `registry.create`，drain 超时销毁 socket | create 不被取消 | orchestration 等待 settle 并恰一次 `lease.release()`（create-namespace.ts:31-81 源码复核：恰一次 awaited release、catch 后仍 201）；registry.shutdown 等已接纳槽 | ✓ 无缺口（ADR 0015 L113「调用 Registry 后不传播客户端取消」保持） | 无 |
| S6 | keep-alive 既有连接在 `hubListener.close()` 后塞入新请求 | 门 A | 503（≥400） | ✓ 无缺口（adapter close 只关 listening socket 不等连接——ws-server.ts:237-248 注释核验，双门兜底） | 无 |
| S7 | `Expect: 100-continue` 请求头到达、无 `checkContinue` 监听 | Node 自动回 100 | 100 到达 ⟺ 头已解析并接纳 → 登记 in-flight | ✓ 无缺口（SA6 §9-E1 实测；T3 admission 锚） | 无 |
| S8（新增攻击：守卫的静默降级面） | boot 成功后运行期，restHost 因缺陷意外为 undefined（如构造顺序回归） | `stop()` | optional chaining 将静默跳过 drain | ✓ 设计已显式封堵：§9「F2 的 optional chaining 不是正常路径 fallback」——运行期不变量由构造一次冻结 + fail-loud 构造面（D5 TypeError）保障；restHost 构造先于 listener 存在（§8 装配序），listener 接纳请求 ⟹ restHost 已构造，运行期不存在「已接纳请求而 restHost 缺位」态 | 无 |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | `restRouter.handle` rejection（malformed JSON、VFSL issues、`REGISTRY_NOT_ACCEPTING` 窄 issue…） | D8：in-flight 注销 + `rest-request-failed` sink 事件 + `500 text/plain internal error\n`；不静默回落 404 | ✓ 形态正确；**本轮新增自动化验收**：行为测试例 1（canonical path 畸形 JSON body → 500 + 事件恰一次 + 进程存活 + 后续请求不受影响），落位 ALLOW 内 `rest-hosting-behavior.test.ts`（F3 修复后路径合法） | 无 |
| E2 | 响应写回失败（socket 已亡） | 静默收口 + in-flight 注销 | ✓ 可接受（观测已在 onRejection/事件面；onRejection 回调 throw 被 try/catch 隔离——§8 模块纪律） | 无 |
| E3 | 客户端断连（req 流错误） | `request.json()` rejection → 同 500 路径 → 写回失败被吞 → 注销 | ✓ 无半提交（registry.create 未过接纳即无副作用；create-namespace.ts 源码复核） | 无 |
| E4 | boot 失败（observer 漏注入 → 构造 TypeError） | `ready` reject（fail loud） | ✓ M4 已证 7/7 启动点红 | 无 |
| E5 | 停机链任一步 throw | `app-stop-failed` + rethrow（现行）；F2 修复后 drain 步不再自造新 throw 源 | ✓ 保持；main.ts:83-86 `shutdown failed` → exit(1) 影响链源码复核（前轮 F2 影响主张成立） | 无 |
| E6 | drain 超时后进程仍在途的 registry 槽 | `registry.shutdown()` 等已接纳槽结算（C7）；整体有界由 main.ts 60s watchdog | ✓ 分层正确（进程内宿主测试无 watchdog，drain 自身 10s 有界） | 无 |
| E7 | boot 窗口早停 | §9 显式条目：restHost 未构造 ⇒ drain 步跳过，`stop()` 干净结算、无 `app-stop-failed`——与现行早停行为零回归 | ✓ 已闭合（F2；行为测试例 3 锚定：不 await `ready` 即 `stop()` → resolve、无 `app-stop-failed`、事件链收敛 `app-stopped`） | 无 |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `NomicoreApp` +`registry` getter（`\| undefined`） | 无遗漏：main.ts 消费面不变；公共面无键集封闭断言；SA6 `appRegistry()` cast 读取结构兼容（contract-support.ts:220-226 源码复核） | app.ts:103-112/162-172 | 无 |
| `createNodeHubListenAdapter(observer?, handleRequest?)` 可选参扩展 | 公共面加法：既有调用不传第二参 → 缺省路径逐字节不变（ws-server.ts:161-169 现状即缺省路径）；三个直用测试在场零影响；已经 SA8 recheck 复查面 2/5 裁 no-conflict | ws-server.ts:253-282；测试目录盘点 | 无 |
| `createHubListenAdapter(options?)` 签名从无参到可选参 | app 内部使用（未导出于 index.ts）；加法 | ws-server.ts:289-312 | 无 |
| `HubListenAdapter` 包契约 / `packages/*` 公共面 | 零改动承诺成立（plugin 契约不含 plain-HTTP 面；handleRequest 注入发生在 app-owned adapter 内部） | plugin.ts 契约；DENY 全包 | 无 |
| 遗留 `createYjsHubServer` | 保持 404 占位不动（H4）；冻结兼容面不受扰 | index.ts | 无 |
| sink 事件面（stdout 严格 NDJSON 通道） | 新增 `rest-request-failed` 与 `app-stop-failed` 同族（app.ts:456-459 同款形态）；事件增量随 ALLOW 的 AGENTS.md 一句式同步且措辞受 F1/F4(c) 双约束——app AGENTS「严格 NDJSON 生命周期事件通道」纪律保持 | app AGENTS.md；设计 §11 | 无 |
| `rest-hosting-behavior.test.ts` 新测试文件 | 不与任何 DENY glob 相交（非 `issue270-*` 命名）；命中根 vitest include glob `apps/*/test/**/*.test.ts`；文件当前不存在，无覆盖冲突 | vitest.config.ts:16；目录盘点 | 无 |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| listener/raw-path 分流、intake 门、REST 有界排空、in-flight 记账 | server（组合根；ADR 0015 L32「REST router 不拥有 listener…graceful drain」） | `apps/yjs-server/src/rest-hosting.ts`（新 app 模块）+ app.ts 装配 | ✓ 归属正确（本轮复核 ADR 0015 L32 原文逐字） |
| WS 停机次序（②③ 包内） | `@nomicore/ws-replication` | 集成层只 `await hubService.stop()` | ✓ 只消费不重排（C9 源码复核） |
| role 单真相 | Instance service（ADR 0012 L33） | D6 `requireNomicoreInstance(ctx).role` | ✓（instance/src/index.ts 公共导出复核） |
| Registry 创建/teardown | composition root | boot 取引用一次注入；performStop 单链 teardown | ✓ |
| 停机次序的文档表述 | §8 状态机（= 实现蓝图） | §6 投影行、§11 AGENTS.md 句 | ✓ **前轮「高漂移风险」已消除**：三处表述同源且与 protocol §21 原文一致 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 有界排空 + 异常安全收口 | `hubService.stop()`（包内 close Promise；protocol §21 L591） | `restHost.drain(budgetMs)`（预算 + abort + 幂等） | 一致 | ADR 0015 L32 drain 归 server；分层同构 |
| 停机链生命周期步插入 | diagnostics O(1) close 步（app.ts:432-437，#155 先例） | drain 插入 replication-drained sink 前 | 一致（单链定点插入、不动 diagnostics 位置） | ADR 0011 L129 |
| SA6 绿灯模拟件形态 | SA6 §9-E1 | 本设计 = 该形态生产化 | 一致 | SA6 §13.2 7/7 绿 |
| HTTP in-flight 记账 | 无 app 级既有等价（grep 复核） | rest-hosting 内 `Set` 记账 | 一致（无平行机制可复用） | 新 app 级机制有据 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| Registry 实例 | `this.registry`（app.ts:233 唯一赋值） | router 构造注入引用、getter 委托 | 低（零再赋值路径） |
| role | Instance service | boot 期读出注入 router | 低 |
| 停机状态 | `stopRequested` + `stopPromise` | rest-hosting 经 `isStopping()` 回调读 | 低（回调委托） |
| 停机次序的文档表述 | §8 状态机 | §6 投影行、AGENTS.md 一句式 | **低（F1 修复后三处同源）** |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| bootHub 构造 restRouter/restHost（构造一次冻结；boot 窗口 `undefined` 与 hubService 等同款可选生命周期） | performStop 步 4 `restHost?.drain()`（boot 窗口跳过） | 构造期失败 → ready reject（fail loud）；boot 窗口早停 → 干净结算 | ✓ 对称（F2 修复后） |
| stop() 单飞 | stopPromise 同实例 | `app-stop-failed` + rethrow | ✓ |
| drain() | 幂等（二次 no-op） | 超时 abort 后迟到结算 no-op | ✓ |

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二条拆卸链 | 无（单链为 app AGENTS.md 硬约束——本轮注入的 apps/yjs-server/AGENTS.md 复核「Single disposal chain…Never trigger a second concurrent teardown chain」） | drain 插入既有单链 | 非重复 ✓ |
| app 级第二 HTTP 面 | 无（单一 listener 是 Issue 文本与 ADR 0015 L32 要求） | 同一 listener 双 route family | 非重复 ✓ |
| 包内 REST 逻辑 | 无（REST 归 namespace-api；包 AGENTS 复核：router owns no listener/drain） | app 只做 bridge/记账 | 非重复 ✓ |
| 第二 drain worker/定时器 | 无 | 预算常量 + abort，无常驻 worker | 非重复 ✓ |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW 七文件与 §7/§8 改动面吻合（app.ts、rest-hosting.ts 新增、ws-server.ts、package.json、pnpm-lock.yaml、AGENTS.md、rest-hosting-behavior.test.ts 新增）；DENY `packages/*`、main.ts、index.ts、冻结契约、决策文档与「零包改动/遗留面不动」主张一致 | §11 ↔ §7/§10 逐条比对；`rest-hosting-behavior.test.ts` 不与任何 DENY glob 相交（非 issue270 命名，DENY 行已注明 glob 含义 = 冻结三文件零例外） | 无（**前轮 F3 已修复**） |
| AGENTS.md 一句式措辞约束（F1/R1 + F4/R2(c)）已嵌入 ALLOW 行 | §11 AGENTS.md 行：「不得表述为 REST 排空先于包内 session/lease 收口或归入 §21 ②；不得把 503/500 占位 body 形状写成终态契约」 | 无 |
| ALLOW 无无理由扩张；vitest.config.ts 维持 DENY（例外路径已注明须经修订轮） | §11 | 无 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1/AC2/AC3/AC4 + SA8 A2/A3 | SA6 冻结契约 T1-A/T1-B/T2/T3 + N1/N2/N3（**本轮 sha256 复算：`5cea9d4e…`/`06e0bfe3…`/`2060e130…` 与 SA6 §13.4 逐字节一致**——测试零改动主张实证）；断言均为运行时行为观测；红灯真实（4 红 3 绿 3/3）；M1–M6 全捕获 | ✓ 无缺口 | 无 |
| D8 rejection→500 + `rest-request-failed` 恰一次 | 行为测试例 1（canonical path 畸形 JSON body）：500 + 事件恰一次 + 进程存活 + 后续请求不受影响 | ✓ **已覆盖（F3 修复后路径合法入 ALLOW）** | 无 |
| D4 drain 超时（有界停机 + socket 销毁） | 行为测试例 2：admitted 请求不发 body → `stop()` → 预算+余量内完成、连接被销毁、`app-stopped` 恰一次 | ✓ 已覆盖（注意 O7 超时预算注记） | 无 |
| F2 boot 窗口早停 | 行为测试例 3：不 await `ready` 即 `stop()` → resolve、无 `app-stop-failed`、事件链干净收敛 | ✓ 已覆盖（确定性场景：`createNomicoreApp` 返回时 boot 悬于首个 await，停机链全守卫路径确定执行） | 无 |
| O1 回落精确匹配 | 行为测试例 4：`GET /healthz?x=1` → 404（精确等值语义含 query 行为） | ✓ 已覆盖 | 无 |
| 回归面 | 全 app 套件 + `tsc -p apps/yjs-server/tsconfig.json` + 根 `pnpm typecheck`/`pnpm test`（§12 回归行）——真实仓库入口 | ✓（#229 flake 排除口径与 SA6 §14 一致） | 无 |
| SA6 契约不削弱 | 冻结三文件哈希一致；H1–H4 全部按原案确认（无适配/修订轮触发）；设计 §12 全部既有契约行均「测试字节不变」 | ✓ | 无 |

## 13. Required revisions（本轮）

**无 BLOCKER / MAJOR / MINOR 阻断项。** 前轮 finding 逐条核验结果（保留稳定 ID 作修订映射；均不再
为阻断项）：

| Finding ID | 前轮严重度 | 本轮核验 | 证据 |
|---|---|---|---|
| F1 停机次序文档失真（§6 投影行与 §8 矛盾） | MAJOR | ✓ **已落实** | 验收条件逐项满足：全文档（§5–§13，本轮 grep 全量扫描「②/③/REST 排空」共 20 处命中）不存在任何把 REST 排空置于包内 ③ 之前或归入 ② 的表述；§6 新行「②③（WS 包内）由 `hubService.stop()` 一次完成…server 级 REST 排空在 ③ 之后、④ 之前插入…非 §21 梯子成员」与 §7-D4/§8/R3/§10 五处一致；protocol §21 L591 原文逐字比对通过；§11 AGENTS.md 行加同款约束并显式禁列两种失真表述；无决策语义变动（满足 SA8 recheck R1） |
| F2 boot 窗口停机未防护（`restHost.drain` 无守卫 → TypeError → exit 1） | MAJOR | ✓ **已落实** | 验收条件逐项满足：§7-D4 步 4 与 §8 步 4 均为 `await this.restHost?.drain(...)`；新增事实锚 C11 逐行号源码复核为真（main.ts:210-212、app.ts:195/196/211/232/277/281/304/309、performStop 守卫 414-453）；「boot 窗口早停」条目入 §9 幂等/并发清单；行为测试例 3 锚定（不 await ready 即 stop → 干净结算）；备选（提前构造到 boot 起点——会引入 listener 先于 Registry 就绪的新中间态）被显式否决；F2 影响链（stop() reject → main.ts `shutdown failed` exit(1)，main.ts:83-86）源码复核成立 |
| F3 验收测试路径越出 ALLOW（+issue270 命名落入 DENY glob 自缠绕） | MAJOR | ✓ **已落实** | 验收条件逐项满足：§11 ALLOW 新增 `apps/yjs-server/test/rest-hosting-behavior.test.ts`（非 issue270 命名——与 DENY glob `issue270-*.ts` 零相交，本轮目录盘点确认该文件不存在、无冲突；命中根 vitest include glob）；四例行为测试（rejection→500 / drain 超时 / boot 窗口早停 / healthz query 精确匹配）全部落位该文件；DENY 行注明 glob 含义 = 冻结三文件零例外；§12 引用的每个路径均在 ALLOW 或为既有冻结契约——SA3/SA4 可无歧义执行 |
| F4 intake 门 503 与 FR-3 收敛义务未登记 | MINOR | ✓ **已落实** | 验收条件逐项满足：§13「FR-3 表面收敛义务登记」(a)(b)(c) 齐备——(a) intake 门 503 定性 server transport 层拒绝（§7-D3 规则 1 同款）、(b) 500 占位 FR-3 加法替换（D8 交叉引用）、(c) AGENTS.md 不得固化占位 body 形状（§11 ALLOW 行约束）；满足 SA8 recheck 对 R2 的前置条件 |

## 14. Non-blocking observations

- **O7（行为测试例 2 的用例级超时预算）**：drain 预算为模块常量 `REST_DRAIN_BUDGET_MS = 10_000`，例 2
  的 `stop()` 实测耗时 ≈ 10s + 余量，而 vitest 默认 `testTimeout` 为 5s——§12 未注明该用例需显式
  per-test timeout（如 `test('…', { timeout: 20_000 })` 或仓库等价机制）。属测试编写细节，SA3 落笔时
  处理、SA4 复核；不阻断设计。
- **O8（`restHost.handle` 方法引用传递）**：§8 装配序以 `handleRequest: restHost.handle` 传递方法
  引用——`createRestHosting` 为工厂函数（闭包形态）时无 `this` 丢失问题；SA3 若改用原型方法须绑定。
  实现细节，SA4 抽查即可。
- 前轮 O1–O6 处置确认：O1（回落精确匹配含 query）已显式化并入行为测试例 4；O2（matched 早返回不
  消费 body）已登记 §13 follow-up（随 FR-1 票）；O3（公共面加法过 SA8 复审）确认性注记维持；O4
  （步骤编号 0–7 对齐）已落实；O5（H2 兼容源码级确认）维持；O6（`replication-drained` 语义扩宽）
  已由 §7-D4 步 5 措辞 + AGENTS.md 同步承接。全部闭环，无遗留动作。

## 15. 结论

修订轮四条 finding（F1–F4）全部真实落实：停机次序在 §6/§7-D4/§8/§10/§11 五处表述同源且与
protocol §21 原文一致（F1）；boot 窗口早停经 optional-chaining 守卫 + C11 事实锚 + 行为测试例 3
闭合，且不构成运行期静默 fallback（F2）；全部行为测试获得合法 ALLOW 落点、DENY glob 零例外（F3）；
FR-3 表面收敛义务 (a)(b)(c) 显式登记（F4）。SA6 冻结契约三文件哈希逐字节一致、H1–H4 按原案确认，
无契约削弱或修订轮触发；SA8 A1/A2/A3 保全、recheck R1/R2 兑现、五条重开条件零触发。设计可安全
进入实现（SA3/SA4）；`pass` 仅指设计通过审查，实现与活链路验证由 SA4/SA7 承担。

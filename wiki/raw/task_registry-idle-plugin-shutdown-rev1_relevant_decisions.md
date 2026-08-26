# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出（round 2 修订轮，issue #112）。只摘录，不裁决；引用编号与原文，
> 需要时按编号回查 ADR 全文。冲突裁决见同目录 `_rev1_conflict_report.md`。
>
> 被审对象：`wiki/raw/task_registry-idle-plugin-shutdown-rev1.md`（3 项 spec 审查高风险修复）。
> 冲突基准：`docs/adr/` 全集 9 份（逐个全读）+ `CONTEXT.md`；上一轮档案
> `wiki/raw/task_registry-idle-plugin-shutdown*.md` 作为任务级冻结决策摘录（非 ADR，
> 见文末节）。

## 相关 ADR

### ADR-0009 NamespaceRegistry、调用方租约与 Cordis Host 生命周期（accepted）

与本任务的关联点：本任务全部三项修复的权威依据（idle 保留 / Shutdown / Plugin 有序
dispose 均由本 ADR 冻结）。

核心条款（原文摘录）：

- 强依赖（:26）：「缺失任何依赖均在 plugin 启动时响亮失败，不 fallback 到 `Date.now()`
  或全局 timer。」
- 空闲保留（:48）：「最后一个 lease 释放后，Runtime 进入 idle，而不是立即 close。
  Registry 使用 `ctx.timeout()` 启动完整的 `idleTimeoutMs`，默认 300,000 ms；每次 active
  再次进入 idle 都重置完整时限。配置必须是 `0..2_147_483_647` 的有限整数；零仍异步调度，
  不在 release 调用栈同步 close。」
- idle/open 交互（:50）：「idle 期间 open 同步取消 timer、转回 active 并签发 lease。若
  timer callback 先同步将 entry 转为 closing，则该转换不可逆；后续 open 等待同一个 close
  Promise 结算，再 load 并建立新 generation。fatal 和 persistence-degraded 只改变 Runtime
  capability，不改变 open 或 idle retention 语义。」
- 确定性测试（:83）：「Persistence 和 Registry 都依赖外部 Clock 与 Cordis Timer，不各自
  实现或 fallback 到系统 timer。……确定性测试使用 manual Clock 状态与 fake timer协调推进。」
- observability（:95）：「公开 issue/error message不包含 owner/namespace原值、SCHEMA全文、
  ROOT/input数据、原始异常文本或stack。Registry核心通过内部结构化 observer seam上报生命
  周期与故障；event可携带受控 identity和exact cause，由日志/metrics/trace Adapter负责访问
  控制、脱敏与采样。v1不提供公共事件订阅。」
- Shutdown（:99-101）：「首次 shutdown 在调用栈内同步进入 `shutting-down` 并停止接纳
  open/create……shutdown 取消全部 idle timer，等待此前已接纳的 lifecycle 操作结算，然后
  主动 close 全部 active/idle Runtime，不等待外部 lease release。Runtime close 自己排空
  已接纳写。/ 已在途 idle close 与 shutdown共享同一个 close Promise。所有 Runtime 都尝试
  close；release failure时 Runtime仍为closed。shutdown 最终以稳定
  `NamespaceRegistryShutdownError` 聚合 close failures，不因第一项失败跳过其余 Runtime。
  open/create自身的结果只交付原调用者，不重复进入 shutdown aggregation。重复 shutdown
  返回 exact same Promise。」
- Plugin dispose（:103，问题 3 的直接依据）：「Plugin用一个有序 async disposer等待
  Registry shutdown后再撤销service，避免把多个 async effects当作清理顺序机制。Cordis依赖图
  保证 Registry先于Persistence停止。」
- 公共接口（:111-114）：「`getStatus`，只表达 `running | shutting-down | stopped`……
  v1不公开list、entry status、lease count、queue、timer handle、explicit eviction、按key
  close或公共events。测试 seam只位于受控 testing subpath，允许替换Runtime/document
  factory、Clock、timeout和observer，但不允许读取内部entry结构。」

### ADR-0008 NamespaceRuntime 读写能力与单序列器（accepted；:111 取代 ADR-0007 open/read 条款）

与本任务的关联点：问题 1/2 收编的 `runtime.close()` 语义与失败通道由本 ADR 冻结；
SA7-P2 断言的 cause 链稳定码注册于本 ADR 修订节。

核心条款（原文摘录）：

- close 语义（:93）：「`close()` 幂等。首次调用同步进入 `closing`，立即停止接纳公共
  read 和 write，并在队尾加入 close barrier；此前已接纳任务无条件排空，不取消、不设
  内部 timeout。barrier 只调用一次 `handle.release()`；无论 release 成败，Runtime 都进入
  `closed`，失败时 close Promise reject，后续 close 返回同一个已结算 Promise。」
- 稳定码注册修订（:119-121）：「`RUNTIME_WRITE_DISABLED` 码域澄清：该码是写停接纳/写
  禁用的统一码族，覆盖四类零写入、零输入访问的拒绝……」「close 拒绝稳定码
  `NSRT-CLOSE-RELEASE-FAILED`：release 失败时 close Promise 的 rejection 携带该稳定码
  （包内 branded rejection 类，`cause` 保留原始异常……）」
- 注：本 ADR 未规定 `close()` 是否可能同步 throw（既未承诺恒返回 Promise，也未禁止）；
  Registry 侧对同步 throw 的收编属 Registry 自身 shutdown 聚合职责（ADR-0009:101）。

### ADR-0006 Cordis 持久化插件——DocPersistence 接口与 doc 三条目内容布局（accepted；含 #64 / #79 两节 owner 裁决修订）

与本任务的关联点：问题 3 的 persistence 边界裁决基准——「Persistence 停止」的字义、
dispose 职责、以及若触及 persistence src 时必须遵守的共享 core 纪律。

核心条款（原文摘录）：

- release 语义（:37，close 排空链的下游）：「release = 不再使用通知：调用方在短 scope
  的 finally 中调用 handle.release()；持久层在引用归零后可触发/等待 dirty doc 的 flush，
  且仅在保存成功、缓存/空闲策略满足后才真正释放实例，调用方不直接控制释放时刻。」
- 插件实现边界（:83）：「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import
  DSH 或 NomicoreServer app**。」
- dispose 与宿主职责（:86）：「dispose 时释放文件句柄、后台任务和 Y.Doc 缓存；宿主负责
  按依赖逆序停止插件。」——「Persistence 的停止 = 其 dispose（释放句柄/任务/缓存）」的
  字义来源。
- 共享 core 纪律（:157-159，#64 修订节）：「create/load 同键协调与 flush 调度收敛为
  adapter 共享的 persistence lifecycle core（MemoryPersistence 与 FilePersistence 共用，
  不得复制状态机）；两 Adapter 必须通过同一组 createDoc shared contract tests。」
- 共享 core 纪律（:196，#79 修订节）：「entry 状态解析收敛于 adapter 共享的 persistence
  lifecycle core（两 Adapter 不得复制状态机）；MemoryPersistence 与 FilePersistence 以
  平行验收套件覆盖同一状态契约。」

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted；open/read 由 ADR-0008 取代）

与本任务的关联点：无直接关联（写管线/校验域）；仅 :54「Yjs observer 不得向事务调用栈
抛异常」与本轮问题 2「不逃出 timer callback」精神同源但域不同（ADR-0007 约束的是 Yjs
事务 observer，Registry 的 timer callback 收编属 ADR-0009 域）。不构成本任务约束。

### ADR-0001 / 0002 / 0003 / 0004 / 0005（均 accepted）

与本任务的关联点：无（VFSL 唯一真相源 / 重写定位 / 求值器与派生 schema / 类型投影协议 /
投影生成管线——全部处于 schema 语言与投影域，不触及 registry/idle/shutdown/persistence
编排）。已在冲突报告盘点表中逐一核过，不构成本任务约束。

## CONTEXT.md 相关术语与惯例

- **空闲 Runtime（idle Runtime）**（:26 原文）：「当前没有调用方租约、但仍由
  NamespaceRegistry 暂时保留的 namespace Runtime；保留期内重新打开会复用同一 Runtime，
  保留期届满才关闭。fatal 或 persistence-degraded 只改变能力，不改变空闲保留语义。
  _Avoid_: 已关闭 Runtime、无人引用即可立即销毁」——问题 2 的 idle close 失败收编不得
  改变该语义。
- **停接纳（stop-acceptance）**（:84）：Runtime 域的读/写停接纳纪律（`RUNTIME_READ_DISABLED`
  / `RUNTIME_WRITE_DISABLED` 码族）——Registry 域的停接纳（`REGISTRY_NOT_ACCEPTING`）在
  ADR-0009:99；两域不得互借失败码。
- **写序列器（write sequencer）**（:74）：close 排空的对象——「前项完成 dirty
  notification 后下一项才执行；读取不进入该序列」。
- **P0（schema preparation）**（:78）：与 shutdown 排空次序相关的队首任务定义。

## 上一轮档案冻结决策摘录（任务级，非 ADR——round 2 触及项已标注）

> 以下为 round 1 设计/评审/攻击验证在 `wiki/raw/task_registry-idle-plugin-shutdown*.md`
> 中冻结的任务级决策。它们不是 ADR，不构成自动阻塞依据；但 SA1 若修订其中任何一条，
> 必须在设计文档中显式记录修订与理由（本轮简报明文要求）。

### 状态机不变量（设计 §2.B）

- I1：「`phase==='idle' ⟺ idleTimerHandle !== undefined`……域限定：本等价在
  `acceptance==='running'` 期间成立；shutdown 同步段取消全部 idle timer 后至 §2.D 步骤 2
  关闭发起段翻相前……是唯一豁免窗口」。
- I2：「`phase==='closing' ⟹ closePromise !== undefined`」——本轮问题 2 要求同步 throw
  也走 I2 许可的 closing 语义（closePromise 以 rejected Promise 落位），为**保持**而非修订。
- I4（arm-token 判别）：「idle timer 回调仅在『本次武装闭包捕获的 handle ===
  `entry.idleTimerHandle` 当前值』时生效，失配即 no-op。」

### idle-close 失败通道（设计 §2.C，AC7）

- 「零 unhandled rejection」「observer 事件 `{ type: 'idle-close-failed'; identity;
  generation; cause }`——exact cause……恰一次（close 发起侧单点）」「settle（成败皆然）→
  `removeOnlySelf`」「后续 open 不被污染」——本轮问题 2 将该通道扩展到同步 throw，四条
  通道结构不变。

### shutdown 状态机（设计 §2.D）

- 三相迁移点、「状态机仍先到 `'stopped'` 再 throw——失败不回滚终态」「幂 same-Promise」
  「在途 idle close 与 shutdown 共享同一 Promise；其 rejection 双通道各恰一次——发起侧
  observer + shutdown 聚合收录（两通道不同受众，非重复上报）」——问题 1 的收编在
  该框架内补同步 throw 路径。

### plugin 头注契约（设计 §2.F）——**问题 3 的修订对象**

- 第 2 条（round 1 冻结）：「AC11 时序解读（R1/O1）：『先于 Persistence dispose』=
  **fiber 级**保证——Registry fiber 卸载完成……先于 persistence fiber 卸载完成……；
  **adapter 级**排空次序……不在此保证内，为 §8 R1 残余并发声明。」
- 同节：「残余并发……是 persistence 包既有注册形态的产物，本票不改 persistence src
  （DENY LIST）。」
- §8 R1：「根治（persistence 将 adapter dispose 串行化进 provide disposer 之后）超出本票
  DENY 边界，建议后续票。」开放问题 2：「persistence 侧 dispose 串行化（R1 根治）是否立
  后续票。」

### 机制证据（设计 §5，源自 Cordis 4.0.1 构建产物源码亲核）

- #5：「`ctx.provide` 的 disposer 实现 =『delete store[key] → notify → await
  Promise.allSettled(fibers.map(f => f.await()))』——依赖 fiber（Registry）settle 先于
  provider（persistence）fiber 卸载完成」。
- #6：「fiber `_unload` 以 `Promise.all(...)` **并发**运行本级 disposables……跨 fiber
  卸载无严格串行」——adapter dispose（persistence fiber 本级 effect）与 Registry shutdown
  并发的根源；registry plugin 侧无法重排 persistence fiber 内部的 disposer 次序。

### round 1 DENY LIST（设计 §4，任务范围决策）

- 「`packages/persistence/**`——persistence 插件的 adapter dispose 注册形态（§5 残余并发
  根源）不属本票」——round 2 简报已显式重启该边界并委托 SA8/SA1 裁决。

### SA7 动态验证固化（_sa7_report.md）——**问题 3 的修订对象**

- SA7-P2：「persistence fiber 先 dispose（R1 残余并发通道）：close 写排空撞『已销毁
  handle』（release reject）→ 依赖级联触发 registry fiber 卸载 → 聚合错误通道真实工作
  ……」——把「close 撞已销毁 persistence handle → 聚合失败」固化为预期；round 2 要求
  删除或改写该假设（探针次序改为 registry-shutdown-settled 先于
  persistence-adapter-disposed）。

---

## 设计后复审追加（round 2 设计 rev1 引入的新决策点，2026-08-27）

> SA8 设计后复审摘录自 `wiki/raw/task_registry-idle-plugin-shutdown-rev1_design.md`。
> 设计级决策（非 ADR），供 SA2 评审 / SA3 实现 / SA4 静态 / SA7 动态复用；裁决见
> `_rev1_design_conflict_report.md`。

- **D1（P1 同构聚合，设计 §2.A）**：runShutdown 关闭发起分支 try/catch——同步 throw
  合成 `Promise.reject(cause)` 落位 `entry.closePromise`（I2 许可），同一同步段
  `void promise.catch(() => {})` 消除 floating window（Node unhandledRejection 检查点，
  设计 §5#9）；聚合循环/终态推进（`entries.clear()` + `acceptance='stopped'`）逐字
  不动——同步 throw 与 rejection 共用同一 failures 通道（exact cause、恰一次、插入
  序）。零新 observer 事件（维持 round 1「shutdown 不加事件」冻结）。
- **D2（P2 同步段挂接，设计 §2.B）**：beginIdleClose try/catch——同步 throw 同样合成
  rejected closePromise；I2 先落位后翻相（同一同步段）、I4 token 收缴次序不动；④⑤
  `.then` 两臂在同一同步段挂接（无跨 await 间隙，无需空 catch）；idle-close 失败
  四通道（零 unhandled / observer exact cause 恰一次 / removeOnlySelf / 后续 open 新
  generation）结构不变、扩展到同步 throw。
- **D3（P3 路径丙，设计 §2.C.0–.2）**：persistence 侧有序 disposer——`service.ts` 新增
  共享 wiring helper `bindPersistenceAdapterLifecycle(ctx, adapter, label)`（generator
  effect：`yield revoke` re-parent + `yield drainStep`（`await revoke()` 撤服务→级联
  依赖 fiber 卸载 settle，`finally` 兜底 `adapter.dispose()`），逆序串行）；memory/file
  两 Adapter `apply` 改调 helper（单源，无状态机复制）；`PersistenceLifecycle` 零改动。
  路径甲（纯 plugin 侧编排）以源码证据判结构性不可行（registry 侧对 persistence
  fiber `_disposables` 无杠杆 + 探针挂 dispose 入口）；路径乙（handle 排空钩子）因
  微任务次序洞 + 触碰共享 core 最敏感区拒绝。
- **D4（adapter 级保证的边界，设计 §8 R1′）**：次序保证覆盖 **fiber 卸载路径**（AC11
  规范路径）；宿主**直调** `adapter.dispose()` 的编排（dsh-persistence profile 形态）
  是宿主职权（ADR-0006:86），不在保证内——`dispose()` 直调语义与幂等性零变化。
- **D5（头注契约改写，设计 §2.C.5）**：plugin.ts 头注第 2 条由「fiber 级限定 + §8 R1
  残余并发」改写为「adapter 级真实保证」（纯注释，plugin.ts 代码零改动）；round 1
  §8 R1「建议后续票」与开放问题 2 由本轮收口（形态恰为 R1 预言的「adapter dispose
  串行化进 provide disposer 之后」）。
- **D6（DENY 窄解除，设计 §4）**：rev1 边界 = `persistence/src/{service,memory,file}.ts`
  + `persistence/package.json`（patch bump 0.2.1）；`lifecycle.ts`/`contract.ts`/
  `index.ts`/`testing.ts` 仍禁（ADR-0006 约束 1/4 落点）；namespace-registry 侧公共
  面/事件面/注入面/导出面零增量。
- **D7（聚合通道覆盖保持，设计 §7）**：SA7-P2 旧假设删除后，ADR-0009:101 聚合错误
  通道的测试覆盖由 19（三 key rejection 聚合）/19b（同步 cause 聚合）/15a/18 继续锚定
  （前置门禁关注项闭合）。

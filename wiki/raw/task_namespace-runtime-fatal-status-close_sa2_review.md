# SA2 攻击评审报告

**Date**: 2026-08-25
**Verdict**: pass（附 1 项 MEDIUM + 3 项 LOW 修订要求，均不推翻设计方向；详见攻击点清单与「修订要求汇总」）

**被审对象**：`wiki/raw/task_namespace-runtime-fatal-status-close_design.md`（R1，697 行，§0–§13 / D1–D11 / INV-C1..C12）
**攻击基准**：ADR-0008（唯一行为契约源，经 relevant_decisions 摘录 + SA8 设计后复审追加节 1–9 为约束基准）、ADR-0006/0007 关联条款、任务简报 AC1–AC9 与红灯锚定要求、SA6 两个锚文件的真实断言面、HEAD 588fa2b 源码事实。
**审查方法**：假装全新开局；逐条攻击点均以源码/测试文件实读验证（非沿用 SA8 结论）；SA8 冲突门禁已 clear，本评审专注 SA8 职责外的设计攻击面（竞态/死锁/状态撕裂/契约污染/错误链路/锚覆盖缺口）。

---

## 一、攻击前的独立事实核验（SA2 自证，全部实读）

以下设计事实声明经本评审独立复核，**全部为真**（这是攻击可信度的前提）：

| # | 设计声明 | SA2 核验结果 |
|---|---|---|
| V1 | sequencer enqueue 经 `.then` 微任务排程（barrier 不在 close() 调用栈内同步执行）；链尾恒绿 `settled.then(noop, noop)` | ✅ `sequencer.ts:23-26/30-42` 实读属实 |
| V2 | `disabled()` 共享构造 / S1 fatal gate / `markWriteFatal` / `rejectWithWriteFatal` 现状与「零改写」承诺 | ✅ `write.ts:76-79/169-217`、`schema-write.ts` S1 实读属实；SCHEMA 槽复用 `disabled` 结构兼容（`issues: unknown[]` 双侧） |
| V3 | §12 #8「既有 8 处 fakeHandle 全部提供 release 函数」 | ✅ `grep -rn "release:" packages/namespace-runtime/test` → **恰 8 处**（7 文件，close-lifecycle 占 2） |
| V4 | §13「包外零消费者」 | ✅ `grep -rln "@nomicore/namespace-runtime"` 排除本包后**零命中** |
| V5 | §13「seam caller = 2 src + 14 test」 | ✅ `grep -rln createNamespaceRuntimeWithSeam` → 16 文件，与声明一致 |
| V6 | `RuntimeState` 唯一构造点 runtime.ts:113（+`lifecycle` 必填字段零连锁） | ✅ grep 全集确认无第二构造点 |
| V7 | §8.1「ownership 锚断言面零改动仍全绿」 | ✅ 逐行实读：L104-114 仅键存在性+禁止键（无九键精确锁）、L134-162 无六键精确锁（仅 notContain queue/sequence/taskType）、L141 `lifecycle==='ready'` 在未 close 场景三态下仍真、L158-161 ready 期 read.enabled true 与新公式一致。**简报「该测试需随之更新」的预期过虑，设计以代码级核实推翻之，SA2 确认设计正确**（见攻击点 #5/INFO） |
| V8 | rev1 措辞锚（`expectNoClosingWording`）辖域 | ✅ `runtime-write-fatal-message-rev1.test.ts:133-136` 只断言 fatal 域 message（`.not.toContain('closing'/'closed')`）；close 域新字符串（read/write 接纳拒绝、CLOSE_RELEASE_FAILED_MESSAGE）不进该断言面；`CLOSE_RELEASE_FAILED_MESSAGE` 实文不含 'stack' 子串（case 5 `JSON.stringify` 断言面安全） |
| V9 | `contract.ts` release 签名 `Promise<void>`；包版本 0.1.4（bump 0.1.5 有效）；vitest typecheck 双通道配置 | ✅ 实读属实 |
| V10 | SA6 两锚文件全部断言与设计行为逐拍对照 | ✅ 8 运行时用例 + 3 类型面用例逐条推演无冲突（关键拍：case 2 同步 closing/同实例 Promise/read 同步拒；case 3 接纳拒绝即时 settle 且 stateBytes 不变、A 不被取消；case 4 read 拒不等待 P0、P0 无条件排空；case 5 closeIssue 先于 throw 注册、摘要无哨兵泄漏、同 reason 身份；case 6 fatal 后 read.enabled true→close 后 false；case 7 排空期 fatal committed:true + notifier 恰一次 + 链尾恒绿保 barrier；case 8 七键恰集 + 无数组值字段） |

---

## 二、攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **MEDIUM** | D7 裁决无验收锚（锚覆盖缺口） | D7「getter（getSchemaEnvelope/getMetadata/getActiveSchema/getStatus）post-close 继续可用」是本设计引入的**解释性新决策**（relevant_decisions 追加节 2，SA8 已裁决 no-conflict 并声明「后续收紧须升级总控」）——但 SA6 两锚文件与设计 §8/§9 映射表中**没有任何用例锁定该行为**（case 8 仅断言 getStatus；getSchemaEnvelope/getMetadata/getActiveSchema 的 post-close 行为零覆盖）。触发条件：任何后续任务「顺手」给 getter 加 lifecycle gate 或抛错。影响：无红灯拦截 → D7 裁决可在无声中漂移，而该裁决按 SA8 登记恰是需要「升级总控才能反转」的受保护决策——保护缺执行面。 | 二选一（均低成本）：(a) SA6 修订轮在 case 8 增补 2–3 行断言：close 后 `getSchemaEnvelope()` 非 null 且四键原值、`getMetadata()` 返回与闭前 toEqual、`getActiveSchema()` 非 null、均 `not.toThrow()`；(b) SA1 在设计 §10-O2 条目下登记「D7 现状无行为锚——首个触碰 getter 面的任务必须先补锚」。推荐 (a)+(b) 同时做。 |
| 2 | LOW | §6.2 边界 #13 论证失实 + 重入语义未定义 | 「close() 在写槽/notifier 回调内调用 → 公共 API 不可达（槽体无 runtime 引用）」不成立：seam 注入的 notifier 闭包可经可变盒子在构造后捕获 runtime（seam 是包内导出的确定性注入面，生产 notifier=saveDoc 不会，但 seam 面可达）。行为本身良定义（同步调用 → FIFO 队尾，barrier 挂当前槽后，无害）；但若 notifier `await runtime.close()` 后才 resolve，则构成**自等待死锁**（A 等 notifier → notifier 等 barrier → barrier 等 A）→ close 永挂起。这与「release 永不 settle → 永挂起」（edge #5）同族（ADR 无 timeout 契约行为），但设计未列。 | §6.2 #13 改写为：「可达（经 seam 闭包捕获）。同步调用 close() = FIFO 队尾语义，良定义无害；在 notifier 内 await close() = 自等待死锁，属契约行为（不取消、无 timeout），文档化于 close JSDoc 即可」。无需代码变更。 |
| 3 | LOW | 注释漂移：p0.ts ① 扩展位注释未列入演进 | D5.2 只把 write.ts:81 / schema-write.ts 的扩展位注释更新为「lifecycle gate 已兑现于接纳层」裁决标注；但 `p0.ts:74-75` ① 注释仍写「真实写槽将在此步检查 lifecycle/fatal（文档位）」——#92 后该陈述与 D5.2 裁决直接矛盾（lifecycle 半边已移至接纳层，槽内只留 fatal 半边）。§11 ALLOW 对 p0.ts 限定「类型级」，SA3 按清单执行将留下自相矛盾的注释。 | §11 ALLOW 的 p0.ts 条目放寬为「类型级 + ① 注释级刷新（≤2 行）」，与 write.ts/schema-write.ts 同款裁决标注。 |
| 4 | LOW | D3 thenable 守卫把 function-thenable 误判为契约违背 | 守卫判定 `typeof releaseResult !== 'object' \|\| …then !== 'function'` → throw TypeError。按 ECMAScript 语义，**函数**若带可调用 `.then` 也是 thenable；守卫将合规但罕见的 function-thenable 返回误判为「adapter 契约违背」并走失败通道（close reject + 摘要注册）——release 实际可能已成功。现实 DocHandle 实现返回原生 Promise，触发概率趋零，但守卫既以契约执法为名，判定式与规范不一致本身就是不精确执法。 | 判定式增加 `typeof releaseResult === 'function'` 分支，或注释显式声明「有意收紧：仅接受对象形态 thenable（native Promise 族）」。后者零代码成本即可。 |
| 5 | INFO | §8.1 与简报「既有锚演进注意」的出入 | 简报 L53 预期 `runtime-public-surface-ownership.test.ts`「需随之更新（预期变更）」；设计经代码级核实断言（SA2 复核为真，见 V7）该锚无精确键集锁、断言面零改动全绿。这不是设计漏洞，而是设计正确地推翻了简报的过虑预期。 | 无动作。记录在案：SA3/SA6 不得据简报字面「顺手」修改该冻结锚的断言（SA6 owned 文件，修订须走 SA6 修订轮）。 |

**未成立的攻击（攻击后排除，记录以证非放水）**：

- **竞态/撕裂**：`lifecycle` 写点恰 2 处（D2 close() 同步段 / D3 barrier）、`closeIssue`/`closeCause` 写点恰 1 处（D3 catch），全部位于同步段；JS run-to-completion 下接纳门 check-then-enqueue 与 close() transition 无交错窗口（§12 #6 依据成立）。无撕裂观测点。
- **死锁（结构性）**：barrier 经既有 enqueue 挂接，前项 settle（含 reject，链尾恒绿 V1）后方启；唯一死锁族是「被 gate 挂住的已接纳任务永不放行」与 edge #5/#13 的永挂起——均为 ADR「不取消、不设内部 timeout」的契约行为，设计已登记。
- **close() 非全函数风险**：`sequencer.enqueue` 同步段仅 `.then` 接线（无 throw 路径），「lifecycle 已写 closing 但 closePromise 未赋值」的中间态不可达。
- **幂等性**：closePromise 闭包缓存不依赖 state；并发/已结算后同实例成立（case 2/3/5 断言面覆盖）。
- **接口签名误用面**：`close: () => Promise<void>` 无参数无重载；read 联合加法（新分支与 PATH_NOT_ALLOWED 变体结构同族，`code/path/message` 齐备）对 §13-B 全部 11 文件消费者编译兼容（实读确认判定式均为 `if (read.ok)` 判别后访问）。
- **虚假降级排查**：D3 thenable 守卫是 anti-伪降级正面立法（契约违背→loud 失败通道，不静默当成功）；D6 closing/closed 短路 handle 观察不是降级（post-release handle 状态对能力真话无信息增益，且 ready 期观察契约逐字节保留）；`readDisabled` 的 spread-catch→`[]` 是敌意输入防御非常态 bug 掩盖。未发现任何「前提条件缺失被降级掩盖」形态。
- **既有路径污染**：ready 期 read 透传、buildStatus 公式、写槽槽序、fatal 分类表全部逐字节/逐语义不变（V2/V7/V8 核实）；sequencer/projection DENY 与「零改动」声明一致。

---

## 三、协议假设依据审查

**结论：通过。**

- **章节存在**：§12「协议假设依据 (Protocol Assumption Evidence)」存在，9 条假设逐条给出「假设 / 依据类型 / 具体引用 / 风险等级」。
- **依据可验证性**：全部依据为可重跑命令（grep 命中数）、可定位源码行号（sequencer.ts:23-26/30-42、contract.ts release、status.ts:12-14、vitest.config.ts）、规范语义引用（ECMAScript PromiseJobs / Promise resolve / run-to-completion）与 SA6 实测红灯记录——**SA2 逐条独立复核，无一条虚报**（V1/V3/V4/V5/V9）。
- **无据推断**：未发现「应该/通常/预计」类空依据条目；唯一推测性表述（§12 #1 的「同时成立」）附有机制根源（INV-N1 + 5 文件冻结锚实证），且 SA6 case 2「close() 返回前 lifecycle==='closing'」+ case 3「release 在 A settle 前为 0」两断言已把该假设变成可红绿的验收事实。
- **SA4 可重验性**：引用行号在当前 HEAD 均可定位（本评审已定位）。

---

## 四、错误处理链路审查

| 检查项 | 结论 |
|---|---|
| **静默失败** | 无。close 的三种异常结局全有显式通道：release reject/同步 throw/非 thenable → 同一失败通道（closed + closeIssue 冻结注册先于 throw + 稳定 rejection 送达 closePromise）；release 永不 settle → close 永挂起（ADR 明文契约，JSDoc 文档化 R2）。read/write 停接纳走结果联合（非吞没）。 |
| **状态闭环** | `lifecycle` 恒达 'closed'：成功路（D3 await 后）、失败路（D3 catch 先写 closed 再注册摘要再 throw）双路收敛；`closeIssue` 在 rejection 送达调用方**之前**的同步段注册（case 5「rejection 送达时 getStatus().close 已可观测」由 markWriteFatal 同步先行哲学保证）。 |
| **降级路径** | 唯一依赖（handle.release）失败时无任何降级尝试——符合 ADR「不补偿、不 fallback」族纪律；adapter 契约违背（非 thenable）被 loud 收敛为失败通道而非静默成功。 |
| **用户可感知性** | 双通道：closePromise rejection（稳定 `NamespaceRuntimeCloseError`，恒定 message + `cause` 零信息损失）+ `getStatus().close` 稳定 `{code,message}` 摘要（不含原始 Error/stack/哨兵文本——case 5 JSON.stringify 断言面已核）。 |
| **虚假降级识别（三度立法）** | 见「未成立的攻击」节：D3 守卫为正面立法；D6 短路非降级；readDisabled catch 为敌意输入防御。**未发现伪降级**。 |
| **遗留契约风险** | R1（close rejection 未 catch → unhandled rejection）已登记：AC7 明文要求 reject、与 fatal rejection 同款 API 责任归属，属调用方契约而非设计缺陷。接受。 |

---

## 五、红线测试思路（按攻击点逐一配武器）

1. **攻击点 #1（D7 无锚）——getter post-close 可用性锚**：
   场景：ready runtime（真实 vfsl 文本 fixture）→ `await close()` → 断言 `expect(() => runtime.getSchemaEnvelope()).not.toThrow()` 且返回非 null、四键值与闭前 `toEqual`；`getMetadata()` 与闭前 `toEqual`；`getActiveSchema()` 非 null 且五字段身份与闭前相同；`getStatus()` 七键真话。红灯条件：任何给 getter 加 lifecycle gate/throw 的未来改动。

2. **攻击点 #2（重入语义）——notifier 内同步 close() 的 FIFO 锚**：
   场景：notifier 首次调用时同步执行 `box.runtime.close()`（不 await），断言：当前写照常 settle {ok:true}、release 恰一次且晚于该写 settle、close resolve、lifecycle closed。红灯条件：未来任何「接纳门重入拒绝」或 barrier 越序。可选第二拍：notifier `await close()` 后 resolve 的用例**不写**（契约性永挂起无法在 vitest 超时内表达，文档化即可）。

3. **攻击点 #4（thenable 守卫）——function-thenable 判定用例**（若采纳规范一致分支）：
   场景：fakeHandle.release 返回 `{ then: (r: () => void) => { r(); } }` 的**函数**形态（`const fn = () => {}; fn.then = ...`）→ 断言 close resolve、closed、close 摘要 null（当前设计预期为 reject + NSRT-CLOSE-RELEASE-FAILED——若 SA1/SA3 采纳修订则翻转断言）。若不采纳修订，则反向锚定现状：断言 function-thenable 走失败通道且 close 摘要稳定——把「有意收紧」变成显式契约而非隐性边界。

4. **补强（SA6 锚已覆盖，列举备查）**：case 3 的 stateBytes 零变化 + SCHEMA/ROOT 原值（接纳拒绝零副作用）、case 5 的哨兵/stack 缺席 + 同 reason 身份、case 7 的 notifier 恰一次 + 提交值保留——三者已是本评审认定的关键红线，SA3 修绿时不得弱化。

---

## 六、修订要求汇总（随 pass 一并交付 SA1/SA3/SA6）

| # | 严重度 | 责任方 | 要求 |
|---|---|---|---|
| R-1 | MEDIUM | SA6（修订轮）或 SA1（登记） | D7 行为补锚或登记无锚状态（攻击点 #1，方案 a/b） |
| R-2 | LOW | SA1（文档） | §6.2 #13 论证改写 + 自等待死锁文档化（攻击点 #2） |
| R-3 | LOW | SA1（§11 ALLOW 放宽） | p0.ts ① 注释级刷新入清单（攻击点 #3） |
| R-4 | LOW | SA1（D3 注释或判定式） | function-thenable 处置显式化（攻击点 #4） |
| R-5 | INFO | 全链 | 简报 L53 的「ownership 锚需更新」预期已被设计推翻（SA2 复核确认）；SA3/SA6 不得据此改冻结锚断言 |

**裁决理由**：全部攻击点均不动摇设计的核心结构（D1/D2/D3/D5/D6 的状态机、幂等、排空、失败通道与 SA6 十一用例逐拍吻合；ADR 兑付关系经 SA8 冲突门禁 clear 且本评审独立复核关键代码事实无虚报）。无 CRITICAL/HIGH；1 MEDIUM 为验收覆盖缺口而非设计错误，且给了不阻塞流水线的兑现路径。

**pass** —— 同意放行 SA3 实现。SA3 实现期间应顺带兑现 R-2/R-3（文档/注释级，零行为变更）；R-1 走 SA6 修订轮或 SA1 增补登记；R-4 由 SA1/SA3 择一兑现。本 pass 不替代 SA4 静态验证与 SA7 活链路审计。

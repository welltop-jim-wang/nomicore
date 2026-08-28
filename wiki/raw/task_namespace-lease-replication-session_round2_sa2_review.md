# SA2 攻击评审报告 — issue #134 Round 2 设计增补（`_round2_design.md`，618 行）

**Date**: 2026-08-28
**Verdict**: **reject**（窄门：2 项必修——#1 HIGH、#2 MEDIUM；其余为非阻断修订建议。机制骨架本身经全维攻击后成立，无需架构返工）

评审边界声明：SA8 两道门禁（round2_conflict_report / round2_design_conflict_report）已 clear 的 ADR 一致性问题不在本评审重开范围；本评审以全新视角攻击设计自身的正确性、完备性与冻结文本的自洽性。攻击方法 = 逐面源码对照（replication-session.ts 660 行 / runtime.ts 476 行 / replication-write.ts 426 行 / lease.ts 438 行 / plugin.ts 208 行 / registry.ts 1340 行 / sequencer.ts / write.ts）+ 29 用例红锚逐条转绿路径推演 + round-1 既有 52 用例的隐藏冲突扫描 + 微任务跳数独立复算。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **HIGH** | §4 泵 × subscribeOwnedUpdates 公共契约 | 投递集语义发生未登记的漂移：泵按**交付时刻**的 listener 快照投递队列项 ⇒ 晚订阅者可收到**订阅前**入队的 update（让步窗口 ~20+ 跳，慢消费者积压下可长达 16 项排空全程）；退订→重订周期内可**重复收到**同一未投递项。round-1 同步扇出下该语义结构性不存在（事件时刻快照）。设计通篇声称「语义不变」（§4.2 要点 4/5、§11「INV-S4 原文继续成立」）、§19 审计断言「无公共函数签名/返回类型……变化（全部为加法/内部精化）」——但这是一个公共能力面的**可观测行为契约增量**，未在 §4/§14/§19 任何位置冻结，SA6 亦未锚定 ⇒ 语义将沦为 SA3 实现的偶然产物 | 必修。二选一并冻结：(A) 明文登记「交付集 = 交付时刻 listener 快照；晚订阅者可收订阅前入队项；跨退订重订可重复交付（Yjs apply 幂等吸收）」→ §4.2 新增要点 + §14 D-1 ADR 增补句 + §19 契约改动表新增一行 + SA3 锚 ×2（积压期订阅收到积压项 / 退订重订重复交付幂等）；或 (B) 订阅屏障（入队项携带订阅序号，晚订阅者不收订阅前项——保持 round-1 精确语义，代价为 channel 增计数面）。推荐 (A)（切片 6 transport 语义 at-least-once 天然契合、成本一行注释） |
| 2 | **MEDIUM** | §5.2 规则表（冻结文本）× §5.1 代码 | **冻结规则表与代码自相矛盾**：§5.2 表「Y.Text / Y.XmlText 等异构容器 → toJSON() 投影类型分叉 → 不等 → 拒」，末行「其它实例保守判已改变」。但 §5.1 代码 `a instanceof Y.AbstractType` 分支**先于**契约外 fallthrough 命中——Y.Text/Y.XmlText/Y.XmlElement 均 instanceof AbstractType ⇒ **同型等内容时 toJSON 投影相等 → 放行**（例：live 与 scratch 同为 Y.Text("abc") → "abc" === "abc" → equal）。「分叉→拒」只在**跨形态**（一侧 AbstractType 另一侧 plain/异型）时成立。该表声明「冻结 + 锁定测试」且 §14 D-3 要把「§5.2 规则表全文」逐字入 ADR——照抄即冻结错误规则；SA3 按表写锚（Y.Text 等值 → expect 拒）则 §5.1 代码实现必红，SA3 陷入冻结文本内战 | 必修。二选一并使 §5.1/§5.2/§14-D3 三处一致：(A) 修正表行为实际语义：「同为 AbstractType 且 toJSON 投影相等 → 允许（含 Y.Text 同型等值——契约外**存量**值未变即放行）；跨形态分叉 → 拒」+ SA3 锚；或 (B) 保守路线：`instanceof` 分支收窄白名单 `Y.Map / Y.Array`，其余 AbstractType 走保守拒，§5.1 代码同步。触发条件（供 SA1 权衡）：该场景仅当 live META 已含契约外 Y.Text（合法写路径结构性不可达，仅直接 doc 操纵/种子可构造）时可达——round-1 此类文档被全拒，round-2 (A) 下 ROOT-only 更新放行 |
| 3 | MEDIUM | §4.3(d) 时序裕度声称 | red #9（64 突发写 < 400ms 墙钟）裕度声称「≥ 70ms」偏乐观：按独立复算，交付数 D 随每写跳数在 ~15（6 跳/写）至 ~22（9 跳/写）间摆动 ⇒ 墙钟 ≈ 225–330ms + 64 次写开销（0.2–2ms/次，CI 负载敏感）⇒ 悲观端 ~350–390ms，距 400ms 上限仅 ~10–50ms。设计已把该面路由给 SA7（R-1'/R-2'）但数字表述需诚实化，且未说明 20 让步常数是**双向 load-bearing**（公平性下界 / flush 预算上界——§18 已含区间 [16,24] 推演，正文未引用） | 非阻断。§4.3(d) 裕度改写为区间表述（~50–160ms，随跳数与写开销漂移）；SA7 动态验证协议中明确 red #9 须在 forks 池满载下复跑 ≥3 次取最坏值 |
| 4 | LOW | §2/§3 Set 迭代中删除 | fenceStale/terminateAll「遍历 channel 集合 + finalize（内含 fanout.detach → Set.delete）」——删除**当前被访元素**在 JS Set 迭代语义下安全，但若未来 finalize 摘除**非当前** channel（如终态级联）将静默跳过未访元素。当前不可达，属实现脆弱性 | §2.1/§3.1 加一句实现不变量注记（「finalize 只摘除自身 channel；迭代期删除限当前元素」）；§2.3 已计划的「幸存者不存在」多 channel 锚足以锁定 |
| 5 | LOW | §6.1 敌意 thenable 尾巴 | `void closing.catch(() => {})`：若敌意 `catch` 方法**返回一个 rejecting promise**（非真 Promise 语义），void 丢弃后成 unhandled rejection。F-5 类型化注入面（close: Promise<void>）内不可达（真 rejecting Promise 被 catch 回调吞没 ✓）；仅超类型面的病态替身可达 | 非阻断。可选加固：`void Promise.resolve(closing).catch(() => {})` 或保持现状并在注释声明类型面边界 |
| 6 | LOW | §7 除外注记方向性 | 复合敌意（beforeTransaction listener 先变异后抛）除外已登记，但未写明失败**方向**：该情形 txStarted=false ⇒ `committed:false` 而 mutation 已发生——是**虚假 negatives**（比过报危险方向：调用方可能据此跳过 reconciliation）。ADR 0008 L84 纪律只强制过报方向 | 非阻断。D-4 ADR 注记补一句「除外情形的失败方向为 under-report（committed:false 但可能已变异）」 |
| 7 | LOW | §4.2 泵 IIFE 兜底面 | `void (async …)()` 无最外层 catch：listener 已逐个隔离、`item.slice()`/`shift()` 结构性不可抛，但未来任何编辑引入非 listener 抛点将直接变 unhandled rejection（T-4 有进程级 watchdog 会抓到，但语义应显式） | 非阻断。最外层加 `catch { channel.failures += 1; }` 兜底或注释声明零抛点论证 |
| 8 | LOW | §5 性能注记缺位 | fanout 两级复制有 ADR 性能注记（§14 D-1），R2-4 深比较无对应登记：每 apply 每 META 键 `toJSON()` 递归投影 ×2（live + scratch）+ 键集 sort——O(META 体量) 每次受保护检查执行（scratch 全量 clone 为既有成本，深比较为新增） | 非阻断。§14 D-3 增补一句性能注记，与 fanout 注记同款 |

**已攻击且成立的声称**（不构成发现，供 SA3/SA7 复用）：§4.2 单飞守卫 finally 复位与 while 退出同同步段——「无丢失唤醒」结构性成立（退出判定与复位间零 await，run-to-completion 封闭）；§4.3(b) 自延伸链公平性成立（任一时刻至多一个挂起续体，新 thunk 恒插在泵下一续体之后至多让步 1 跳）；§2.1「bump 后无幸存 channel」成立（open 冻结 epoch ≤ 当前 facts，facts 只经 bump 单调前进且 bump 即 fence）；§2.1「enable 槽不 fence」论证成立（disabled 文档结构性无 session；已启用 enable 幂等零写零 E5）；E5.5 失败路径无半态（facts 整替与 fenceStale 同步段无 await 间隔，notifyDirty 失败时 fence 已完成）；§3.3 closedBy 记账全序无竞态（conflicted 不降级 / 显式 close 先手保持 closedBy=undefined / Runtime-close 先手保持 'runtime-close'，A1 映射逐序核过）；§3.3 既有锚相容（runtime round-1 L719-736 message 子串 `close 已停止接纳会话 apply` 与 registry round-1 L1287-1289 `RUNTIME_WRITE_DISABLED` 在 A1 新分支下逐字节保持——同一 writeDisabledMessage('lifecycle') 模板）；§7 探针注册次序论证成立（槽内注册恒为最后 listener，Yjs 按注册序派发；finally 恒执行）；§9 根因实证（registry.ts L1333-1339 展开确缺 `role` 键、createRegistryInternal L528-529 已支持——转发缺口为真）；§13.1 空占位零引用（全域 grep 仅定义点）；§15 测试矩阵零改形声称成立（round-1 flush 预算 runtime 60/registry 40/特例 80 ≥ 首投递 ~23-26 跳；round-1 受保护字段锚全部为 primitive 真改变，与深比较无冲突；T-3 L342-344 无 flush 直读恰与 F-3 锚值 0 演进自洽；§15.4 计数 1689+21=1710 ✓）；§16 版本基线 ✓（0.1.9/0.1.5 实测）；§19 审计 grep 可复现 ✓。

---

## 协议假设依据审查

§18 章节存在 ✓，6 行假设全部给出可验证依据类型与具体引用：Yjs beforeTransaction 次序 → SA6 #13/#14 行为锚（可重跑）；微任务 FIFO → ECMAScript PromiseJobs + sequencer.ts:35-37 头注同源 + 跳数分解（我按 sequencer.ts:38-41 实现独立复算：enqueue `.then` 1 跳 + notifyDirty 续体 1-2 + adoption 1-2 + 调用方 await 1-2 ≈ 5-8 跳，与声称一致）；toJSON 投影 → yjs 公共 API + round-1 同源实测；跳数区间 [16,24] 推演自洽。唯一保留：第 2 行风险「中」诚实路由 SA7 ✓；第 4 行「低」的裕度表述见攻击点 #3（数字乐观端偏紧，不影响依据可验证性）。**无「应该/通常/预计」类无据推断；无需补章节。** 本设计无 HTTP/WS 端点类假设（R2-3 队列域与 L151 WS 域分界声明 ✓）。

## 错误处理链路审查

- **静默失败**：未发现新增静默失败面。needsResync = loud 可观测标记（status 第 11 字段）；observerFailures 计数语义保持；泵内 listener throw 逐个自捕获。
- **状态闭环**：fatal 路径（markWriteFatal 先行 → committed 分支 → RuntimeWriteFatalError）全序保持；R2-6 二分只精化 committed 布尔，fatal 置位在两分支均达成（red #13 断言 `fatal !== null` 转绿路径成立）。
- **降级路径**：无新增降级。
- **虚假降级识别**：§6.1 的 catch 隔离**不是**虚假降级——隔离条件（session seam 抛错）是评审指定的 hostile seam 场景而非正常路径前提缺失，且 onReleased 无条件执行、释放事实（①②）先于 seam 调用完成、idle 武装不依赖 seam——guaranteed cleanup 显式设计 ✓。§4 溢出丢弃是 ADR 0010 L113 字面契约落地（观测信号 loud）✓。**结论：无虚假降级。**

## 红线测试思路（逐发现）

1. **#1（HIGH）**：`(a)` 慢消费者（15ms 自旋 listener A）+ 突发写制造积压 → 积压排空前 `subscribeOwnedUpdates(B)` → flush 后断言 B 收到≥1 项**订阅前**入队 update（锁 (A) 语义）或断言 B 仅收订阅后项（锁 (B) 屏障）；`(b)` 订阅 → 退订 → 立即重订（积压未排空窗口）→ 断言重订后可重复收到未投递项 + `Y.applyUpdate` 幂等性断言（replay 副本状态不变）。
2. **#2（MEDIUM）**：种子 doc 直接 `meta.set('note', new Y.Text())`（trusted-domain 种子面）→ ROOT-only update → 断言放行（锁 (A)）或 REPLICATION_PROTECTED_FIELDS_CHANGED（锁 (B)）；对照组：live Y.Text("abc") vs update 改写为 plain string "abc" → 断言拒（跨形态分叉两路线一致）。
3. **#3（MEDIUM）**：SA7 动态协议——red #9 在 vitest forks 池 + 并行满载下复跑 ≥3 次记录 elapsed 分布，断言最坏值 < 400ms 且与 §4.3(d) 修正后区间一致。
4. **#4（LOW）**：双 channel（一 stale 一幸存谓词构造）bump → 断言两者均被 fence、无跳过（§2.3 已计划锚的加严版）。
5. **#5（LOW）**：hostile core `close: () => ({ catch: () => Promise.reject(...) }) as never` → release 后进程级 unhandledRejection 计数为 0（沿 T-4 watchdog 模式）。
6. **#6（LOW）**：文档性修订，无新测试（除外方向入 D-4 注记文字）。
7. **#7（LOW）**：文档/防御性修订；可选锚：注入抛错 isTerminal 替身（仅包内 seam 可达）→ observerFailures 递增而非 unhandled rejection。
8. **#8（LOW）**：文档性修订；可选：大 META（100 键嵌套结构）apply 延迟基准锚（非阻断性 perf 冒烟）。

## 修订放行条件（reject → 复审范围）

仅 #1、#2 阻断放行。SA1 修订后只需复审 §4.2/§5.1/§5.2/§14/§19 的修订增量（预计 ≤ 40 行文本），无需全量重审；#3–#8 可随本轮顺手采纳或登记 SA3/SA7 注意项后放行。

---

## 验证证据（命令 + 结论摘要）

- `grep -n flushMicrotasks` round-1 两测试文件：runtime 预算 60（L142，特例 80/40）、registry 预算 40（L372）——§4.3(c) 预算声称属实；全部 events 断言前有 flush（唯一例外 T-3 L343 = 已登记锚值演进点）。
- round-1 受保护字段锚（runtime test L742-809）：全为 primitive 真改变（SCHEMA 新键 / replicationId / createdAt / replicationEpoch）——与深比较无隐藏冲突，「round-1 仅 1 锚值演进」声称成立。
- runtime round-1 L719-736 / registry round-1 L1273-1291 锚文核对：A1 新分支沿用 `writeDisabledMessage('lifecycle')` 同一模板 → 两锚零改动保持绿 ✓。
- `grep NAMESPACE_REGISTRY_PLUGIN_CONFIG_MESSAGE`：types.ts:74-75 定义 + plugin.ts 两处 throw + registry-plugin.test.ts:240 唯一精确文案锚 ✓（§9.1-3/§19 声称属实）。
- `grep PEER_ALLOWED_META_KEYS packages/**`：仅 replication-session.ts:219 定义及其注释——零引用 ✓（§13.1 删除零涟漪）。
- registry.ts L1327-1339 读码：`createNamespaceRegistry` 展开确缺 `role`；L513-529 `createRegistryInternal` 已收 `options?.role` → §9.1-2 根因实证 ✓。
- §19 审计 grep 复跑（本报告评审期）：applyRemoteUpdate 生产调用点 = lease.ts wrapCore（L248-255）唯一 ✓；SessionFanout/ReplicationWriteEnv 均包内 ✓。
- package.json 版本实测：namespace-runtime 0.1.9 / namespace-registry 0.1.5——§16 bump 基线 ✓。
- phase-5 文档 C-1 注记在场（切片 3 落地对账节）、CONTEXT.md 现无 needs-resync 词条——§14 改写/增补目标真实存在 ✓。
- `registry-phase5-replication-session-surface.test-d.ts`：getStatus 声明为 `Readonly<Record<string, unknown>>`，无全形锁——§17 DENY「零改动已核对」✓。

## 结论

机制设计（fence/terminate/finalize 终态机、自延伸泵、规范化深比较、doRelease 直调、探针二分、plugin 贯通）经 adversarial 推演全部成立，测试矩阵与既有锚的相容性声称经逐条核验属实。两项必修均为**冻结文本层的登记/自洽缺口**而非机制错误：#1 是公共能力面（subscribeOwnedUpdates 交付集语义）的未登记行为契约增量，#2 是 §5.1 代码与 §5.2 冻结规则表在 Y.Text 同型等值格上的直接矛盾。SA1 完成两处修订后本评审即可翻绿。

---

# SA2 R2.1 复审追节（设计就地修订后 — 同文件 `_round2_design.md`，653 行）

**Date**: 2026-08-28（R2 首版评审同日）
**Verdict**: **pass**（两项必修全部合格落实；6 项非阻断全部采纳且与正文一致；回应表经逐行抽查属实。附 2 条纳米级非阻断备注供 SA3 参考，不影响放行）

复审范围 = 首版裁定的收窄范围（§4.2 要点 8 / §5.1 / §5.2 / §14 / §19 / §15.2 + #3–#8 落实核验 + 回应表真实性抽查）。复审方法 = R2.1 版全文重读 + 修订增量逐行对照首版要求 + 新引入面的二次攻击（含 §5.1 白名单代码的敌意种子推演、§6.1 加固形式的逐病态走查、§4.2 catch-all 与无丢失唤醒证明的交互）。

## 必修项复核

### #1（HIGH）交付集语义冻结 — **合格**（选路 A，四处联锁）

- §4.2 要点 8（L190–194）完整冻结：交付集 = **交付时刻** listener 快照；三段推论（晚订阅者收积压项 / 跨退订重订重复交付 / `Y.applyUpdate` 幂等吸收锚）+ 登记落点四联（正文要点 + §14 D-1 ADR 句 + §19 审计行 + §15.2 锚 ×2）。与泵代码 L165 注释互引 ✓。
- 「语义不变」过度声称收敛：要点 4 限定「INV-S4 的**字节面**」、要点 5 限定「**计数面**不变」并显式指引要点 8、§11（L436）同步 carve-out ✓。
- §14 D-1 冻结句（L485）与要点 8 措辞逐字同源（at-least-once + 幂等吸收）✓。
- §19（L609 总述修正 + L614 新行）合格：新行含改动前后语义对照、caller 面、既有锚相容性论证。**相容性论证独立复核属实**：round-1/round-2 全部 events 断言均为「订阅先于写」时序，唯一涉退订锚（runtime round-1 L920-941）为「订阅→写→退订→写」且**无重订**——快照时点漂移在该锚下不可观测 ✓。
- §15.2 锚 ×2（L535）：积压期订阅收积压项 / 退订重订重复交付 + replay 幂等断言——与首版红灯测试思路 (a)/(b) 一一对应 ✓。

### #2（MEDIUM）Y.Text 一致化 — **合格**（选路 B，三处对齐）

- §5.1 代码（L233–246）重写为 `aContainer/bContainer` 白名单分支（`instanceof Y.Map || instanceof Y.Array`）。**逐 case 独立走查**：Y.Map↔Y.Map → 投影深比较 ✓；Y.Map↔primitive / Y.Map↔Y.Text → 单侧白名单 → false ✓；**Y.Text↔Y.Text 同型等值 → 双侧非白名单 → typeof 'object' 落入 return false 保守拒** ✓（前版矛盾正中此处，已消除）；null/primitive/undefined → 原语义保持 ✓。
- §5.2 表（L274–288）：契约外容器行改写为「不参与投影比较、虽同型等内容未变亦拒」+ 新增跨形态分叉行 + 新增嵌套归一化边界行 + 两级裁决 bullet——与代码逐字一致 ✓。
- §14 D-3（L485）同步白名单语义 + 嵌套归一化边界 + 性能注记 ✓。
- §5.3 锚（L294）：种子 Y.Text ROOT-only 拒 / Y.Text vs plain 跨形态拒 / 嵌套放行——对应首版思路并补齐对照 ✓。
- 路线裁决段（L270）论证质量合格：(B) 的「物化域对齐合法值域」论证成立；**二次攻击（敌意种子面）**：live 侧被注入覆写 toJSON 的 Y.Map 子类 → scratch 侧恒为诚实物化的真 Y.Map → 投影必不匹配 → 拒（保守方向闭合，无比对绕行面）✓；嵌套归一化边界与 L252「删后同值重写」同族，投影判据内在自洽 ✓。

## 非阻断项 #3–#8 落实核验（全部 ✅）

| # | 落点 | 核验结论 |
|---|------|---------|
| 3 | §4.3(d)（L201） | 裕度区间化（240–390ms / 10–160ms，替换「≥70ms」）；20 常数双向 load-bearing + 合法区间 [16,24] 引 §18；SA7 满载复跑 ≥3 次协议；needsResync 确定性与墙钟解耦标注 ✓ |
| 4 | §2.1（L60）/ §3.1（L92）注记 + §2.3（L71）/ §15.2 双 channel 正反锚 | 「finalize 只摘除自身 channel / 迭代删除限当前元素 / SA3 禁级联、如需改快照迭代」与首版判定（当前安全、防未来漂移）精确一致 ✓ |
| 5 | §6.1（L316–321, L336） | `void Promise.resolve(closing).catch(() => {})` **逐病态走查闭合**：非 thenable 假 catch 对象 → 被 Promise.resolve 当值包裹 → 敌意 catch 方法不再被调用；敌意 then getter 同步 throw → 落入外层 try 隔离；敌意 then 异步 reject → 原生 .catch 吸收；真 Promise → `Promise.resolve` 恒等短路零成本。SA6 锚零影响声称属实（其 closeImpl 为同步 throw / 真 Promise）✓ |
| 6 | §7.1（L374）+ §14 D-4 | under-report 方向明文（committed:false 而可能已变异、调用方可能跳过 reconciliation、L84 只强制过报方向）✓ |
| 7 | §4.2（L170–173） | 最外层 `catch { channel.failures += 1; }` + 零抛点注释；**与无丢失唤醒证明的交互复核**：catch-all 路径仍经 finally 复位 pumpScheduled——无丢失唤醒性质不因兜底引入而退化 ✓（见备注 N-1） |
| 8 | §14 D-3（L485） | 性能注记（每 apply 每受保护键 toJSON ×2 + 键集 sort，O(META 体量)/次，与 fanout 注记同款）✓ |

## 回应表真实性抽查（文末「SA2 反馈逐条回应」，L640–653）

8 行逐一与正文修订比对：#1–#8 的「修订位置/摘要」列全部与实测行级修订吻合；「不变项」声明（机制骨架 / F-1..F-6 / §15.1 零改形 / ALLOW-DENY 边界仅 §15.2 规模 250–350→280–380）经抽查一致（§17 L572 同步为 ~280–380）✓。未发现虚报落实或位置错引。

## 纳米级备注（非阻断，供 SA3 执行参考）

- **N-1**：§4.2 catch-all 将 `observerFailures` 的捕获面从「listener throw」扩至「泵执行面一切非预期 throw」（要点 5 文字仍定义为 listener throw）。防御性不可达路径 + 代码注释已声明，可接受；建议 SA3 在锚（isTerminal 抛错 → failures 递增）旁加一行注释指向该捕获面宽化，或将来把要点 5 措辞补「含兜底面」三字。不构成冻结文本矛盾（catch-all 注释即真相源）。
- **N-2**：§5.2 跨形态分叉行的锚清单未显式含「Y.Map ↔ Y.Array 双白名单互斥」（代码经 deepEqualPlain 类型分叉 → 拒，方向保守正确）；建议 SA3 规则矩阵顺手补一条（一行成本），非义务。

## R2.1 复审结论

两项必修以「四处联锁登记」（#1）与「三处逐字对齐 + 敌意面二次攻击闭合」（#2）的质量落实，6 项非阻断全部采纳且无新引入矛盾；回应表如实。**SA2 R2.1 复审放行——设计可进 SA3 TDD 实现。** 残余验证义务不变：R-1'/R-2'（Yjs 次序假设、跳数/墙钟推演）仍属 SA7 动态复核（§4.3(d) 满载复跑协议已就位）；N-1/N-2 为 SA3 执行层参考，无需回炉 SA1。

---

# SA2 R2.2 复审追节（设计第三轮 — SA3 交付 commit 8a68d82 后；`_round2_design.md` 710 行）

**Date**: 2026-08-28
**Verdict**: **pass**（附 1 项合并前文字必修 M-1 + 4 条纳米备注 N'-1..N'-4——均不阻断 SA6 执行 §15.3 同步清单）

复审范围 = R2.2 增量三项裁决 + 两项另核。复审方法 = 设计增量逐行读 + SA3 实现逐行 diff + ADR L273 原文核对 + **独立实测三件**（yjs 存储前提探针 / round-2 两红文件全跑 / red #9 隔离单跑）+ AC-2 ③ 现状读码推演。

## 逐项结论

### 裁决 1（§5.1 白名单前提修正）— **成立**，附 M-1 文字必修

**① 五方一致性**：设计 §5.1 代码（`isWhitelistedValueContainer`/`protectedValueEqual`/`projectOf`/`deepEqualPlain`）与 SA3 实现（replication-session.ts L750–809）**逐行 diff 一致** ✓；§5.2 表（白名单行拆分为显式容器行 + plain 原样存储行【R2.2】+ Date/Map/Set 拒行 + 嵌套边界行限定「plain 容器内不可达」）与代码一致 ✓；§14 D-3（「显式构造容器 ∪ plain 原样存储域」口径 + 性能注记）一致 ✓；**ADR 0010 round-2 小节 L273：白名单构成与全部比较规则一致，但残留一处矛盾短语 → M-1**（见下）。判别次序核过：实现 L751 `instanceof Y.Map/Y.Array` 先于 L754 AbstractType 拒（Y.Map/Y.Array 自身是 AbstractType——次序正确，否则白名单自击穿）✓。

**② #2 已关闭攻击面未重开**：
- 保守边界：Y.Text/Y.XmlText 等顶级容器 → L754 AbstractType 拒 → 落入 return false 保守拒 ✓（R2.1 关闭点原样保持）。
- 跨形态分叉：单侧白名单即拒（L769-771 同构）✓。
- 嵌套归一化边界：登记维持并精细化——「plain 容器内不可达（plain 存储域不含 AbstractType）」经推演属实（writeAny 无法把 Y.Text 完整 round-trip 进 plain 容器，仅 garbled plain 数据）✓。
- 敌意 toJSON 覆写：lying `Y.Map` 子类在 live 侧 → scratch 恒诚实物化 → 投影不匹配 → 拒 ✓（R2.1 闭合在新代码下保持）。
- **proto 污染面（新面）闭合** ✓：`proto === Object.prototype || proto === null` 精确门——Date/Map/Set/RegExp（原型非白名单）拒、子类实例拒、跨 realm 对象拒（保守方向）；null-proto 有意放行（JSON 数据域惯例）；`Object.prototype.toJSON` 污染免疫（projectOf 只对 Y.Map/Y.Array 实例调 toJSON，plain 值直递）。

**③ 证据链诚实**：§18 双源行（SA3 实现期实测 + SA1 R2.2 复测）属实，且本复审**独立探针为第三源确认**——`labels: isArray=true / instanceofYArray=false`、`extra: proto=Object.prototype / instanceofYMap=false`、round-trip 后仍 plain、显式 `new Y.Map()` 可并存（yjs 13.6.32）。**附带确认**：R2/R2.1 前提确错——若按 R2.1 版白名单实现，red #10/#11 的 plain 种子（`meta.set('labels', ['a','b'])`）恒拒、红锚不可转绿；前提修正是可行性的必要条件，SA1 裁决理由成立。另诚实记录：R2.1 复审的 #2 核验止于「文本自洽 + 敌意面推演」，未对 §18 声称的「round-1 同源实测」做存储形态实测——该盲区与 SA1 同源，由 SA3 实现现实纠正，流程结果正确。

### 裁决 2（§19 相容性声称作废 + AC-2 ③ fixture 演进授权）— **成立**

- **事实复核**：registry round-1 AC-2 ③（L726–751）现状读码确认——L729 `await mutateRoot(n→8)` 后至 L738 订阅之间**全为同步语句**（encodeDiff/expect/makeReplica，零 await）⇒ 订阅完成于泵首投递（≥20 跳）之前 ⇒ 交付时刻快照含晚订阅者 ⇒ 收到订阅前入队的 n→8 项 ⇒ `received.length===2 ≠ 断言 1`。机理与 at-least-once 冻结（§4.2 要点 8）精确互证 ✓。
- **一行演进零断言语义变化验证**：写后、订阅前插入 `await flushMicrotasks()`（预算 40 ≥ 首投递 ~26 跳）⇒ n→8 积压排空（投给空 listener 快照、零观察效应）⇒ 订阅回到「先于写」时序域 ⇒ L745 `received.length===1` 与 L746-747（received[0] = ext 增量）语义原样恢复；①/②/④ 段零影响 ✓。
- **§19 cell 重写诚实** ✓：round-2 与 round-1 runtime 侧锚时序声称经我两轮扫描属实；唯一例外点名准确、「断言与实现两锚同真、错在相容性声称」的定性正确、处置（演进授权）最小。§15.3-3/§17 条目同步自洽 ✓。
- **本复审自认**：R2.1 追节「round-1/round-2 全部 events 断言均为订阅先于写——独立复核属实」存在扫描盲区（只覆盖 fanout 专用用例与退订用例，未覆盖 AC-2 ③ 能力用例 ②→③ 的写先于订阅边界）——SA3 的发现同时修正了该结论，特此记录。

### 裁决 3（spin fixture 收尾授权）— **成立，且获本复审独立实证**

- **机理与算术**：泄漏量 = 前测未清队排队项自旋总和；本复审实测整文件跑 red #9 = **584.4ms**，正落 SA3 预告窗口 584–607ms（≈ 自身 ~190 + 泄漏 400）✓；**隔离单跑 = 227ms 通过**（SA3 报告区间 187–227 上沿）——「跨测泄漏而非泵缺陷」诊断成立；收尾机制（close → finalize 清队 + 泵下一让步点退出）零断言改形、与生产语义无涉的论证成立 ✓。
- **冻结常数与断言零改动**：src `FANOUT_CHANNEL_QUEUE_CAPACITY=16` / `FANOUT_DELIVERY_DEFERRAL_MICROTASKS=20` 在位 ✓；red 阈值 250/250/400 与全部断言未动 ✓；red #7/#8 现无测试末 close（SA6 待执行——与授权时序一致）✓；§4.3(d) 测试隔离义务注记 + §15.3-4 条目齐备 ✓。
- **红→绿总况（本复审实测）**：round-2 两红文件 29 用例 **28 绿**（registry 侧 12/12 全绿，含 hostile seam / plugin role / R2-9 竞态）；唯一失败 = red #9 整文件跑泄漏（上条），SA6 收尾后应全绿——SA7 满载复跑协议在收尾落地后执行，时序正确。

### 另核 1 / 另核 2 — **认可**

- 偏离 2（新文件规模）：认可合理（行为面不缩水、DENY 零触碰为准绳）；实测 691 行 / 22 用例 vs 文本「~740 行」——纳米偏差（N'-4），裁决理由不受影响。
- 偏离 3（SA2 #5 可选锚 → SA7 承接）：依赖方向论证成立（runtime 包测试 import registry 违反既有纪律）；`Promise.resolve` 同化为语言级结构事实、运行时锚非义务（SA2 原判「可选」）——承接安排合理。

## 合并前文字必修（不阻断 SA6/SA3）

- **M-1（ADR L273 残留矛盾短语）**：ADR 0010 round-2 小节 D-3 段中 Y.Map/Y.Array 括注仍为已作废前提原句——「（合法 plain value 经 Yjs 物化的仅有两种本地形态——`toJSON()` 递归投影参与比较）」——与**同句下一分句**（writeAny 原样存储、round-trip 仍 plain）自相矛盾，也与设计 §5.1/§5.2/§14-D3 的「显式构造容器」口径不一致；设计裁决 1 落位所称「与 ADR L273 逐字对齐（核验一致）」因此不成立（**白名单口径与比较规则五方一致，唯此描述语残留**）。修正 = 该节（本轮自产 append-only 产物，合并前可改）一处短语改写为「显式构造容器——`toJSON()` 递归投影参与比较（plain 值不物化为容器，见下款）」；改后设计的「逐字对齐」声称自然成立。SA1 随文档收口完成、SA4 静态验尸核验。

## 纳米备注（不阻断）

- **N'-1**：`deepEqualPlain` 以 `Object.keys` 递归——无自有可枚举属性的实例（Date/RegExp）投影为空对象 ⇒ 嵌套于白名单容器内的此类契约外子值对判等「不可见」（live Date vs scratch 轮转摊平 `{}` 恒等）。属已登记嵌套归一化边界（「更深预投影类型巡检不采纳」）的已知角落；顶级已被 proto 门拒、合法写路径不可达——注记即可；SA3 现有「Date/Map/Set 非 plain 实例拒」锚覆盖顶级面。
- **N'-2**：比较层抛错面（live META 内敌意 getter/Proxy 经 `instanceof`/`Object.getPrototypeOf`/`Object.keys` 触发 throw）自 R2.1 起逐步扩大、未包 try/catch——种子/信任域 only（raw apply 物化产物恒为新鲜 plain 值，无 getter），与 Y.Text 种子同信任边界；若追求 INV-R7 二通道完备可未来加固（comparison 包裹 → `rejectWithWriteFatal('write-slot-internal')`）或 SA7 可选直构验证。本轮不要求。
- **N'-3**：裁决 3 文本「单用例 187–227ms 落在 §4.3(d) 预估区间 240–390ms 内」算术不实——187–227 **低于**区间下界（更优方向，因隔离跑交错投递数少于估算）；本复审隔离实测 227ms 与 SA3 报告吻合。一词修正（「低于区间下界——更优」）即可。
- **N'-4**：§15.2/§17「实际 ~740 行」vs 实测 691 行——估算口径纳米偏差，不影响偏离 2 认可理由。

## R2.2 复审结论

三项裁决的事实核验、机制论证与处置选择全部成立，且核心事实（yjs 前提 / 泄漏机理 / AC-2 ③ 时序）经本复审独立实测三源确认；红→绿面 28/29 实测（唯一失败为已裁决待 SA6 收尾的测试隔离项，隔离单跑绿）。唯一实质缺口 = M-1（ADR 一处残留矛盾短语 + 设计「逐字对齐」声称的如实化）——纯文字层、合并前完成即可。**SA2 R2.2 复审放行：SA6 可随即执行 §15.3 同步清单（fixture needsResync / AC-2 ③ 一行演进 / red #7/#8/#9 spin 收尾 close）；M-1 由 SA1 随文档收口、SA4 核验；N'-1..N'-4 记录在案。**

---

## R2.2 追节更正记录（2026-08-28——SA4 静态验尸 F-1 附带指证，本 SA2 复核确认后作废 N'-1 交叉验证声称）

- **N'-1 末句作废**：「SA3 现有『Date/Map/Set 非 plain 实例拒』锚覆盖顶级面」——**该锚当时不存在**（本 SA2 复核确认：SA3 新文件 22 用例与两红套件全域 grep 零命中；SA3 报告 §1 自述 6 新锚亦不含它）。错误根因：R2.2 复审把设计 §15.2 的**锚清单承诺**当成了**交付事实**引用，未对交付文件 grep 该锚——属可检未检的交叉验证失实（与本文件 R2.1 自认的 AC-2 ③ 扫描盲区同类）。
- **SA4 探针事实（替代性正确表述）**：`Date`/`undefined`/`bigint` 种子面可测——Date 顶级拒绝实际经**跨形态分叉分支**（scratch round-trip 摊平为 plain `{}` ⇒ 单侧白名单 ⇒ 拒；proto 门是前置成因而非触发分支——N'-1「顶级已被 proto 门拒」的分支描述一并更正），三条可行锚**已由 SA4 F-1 回流补齐**；`Map`/`Set`/function 值经 yjs `set` 时即 loud throw（`Unexpected content type`）——比较层结构性不可达，**种子面 loud throw 豁免由 SA1 登记**。
- 对 R2.2 判定的影响：pass 判定所依赖的三项裁决事实（均本复审独立实测）不受影响；N'-1 失实部分如上作废，其「deepEqualPlain 无自有键实例投影不可见 = 已登记嵌套归一化边界角落」的定性仍成立（未被 SA4 F-1 推翻）。

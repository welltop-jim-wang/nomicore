# SA3 实现报告 — issue #134 Round 2（设计 R2.1 全部落位 + 验证证据 + 偏离登记）

- **worktree**: /home/wangjian/nomicore-fix-issue-134（branch `fix/issue-134-on-docs-phase-5-websocket-replication`）
- **设计**: `wiki/raw/task_namespace-lease-replication-session_round2_design.md`（R2.1 版，653 行）
- **SA2 R2.1 复审**: pass（N-1/N-2 纳米备注已读并落实）
- **阶段**: Phase 3 TDD 实现

---

## 1. 逐项落位证据（R2-1..R2-12）

| 项 | 落位文件 | 证据（代码位置） | 验证 |
|---|---|---|---|
| **R2-1** bump 槽边界主动 fence | `runtime/src/replication-session.ts`（SessionChannel finalize/isTerminal、SessionFanout.fenceStale、createSessionCore finalize 闭包）；`runtime/src/replication-write.ts`（E5.5' fenceStale）；`runtime/src/runtime.ts`（env.fanout 同批捕获） | fence 谓词 = 冻结 (replicationId, replicationEpoch) ≠ 传入 ⇒ finalize('conflicted')；finalize = 终态置位 + fanout.detach + `queue.length = 0`（F-3：bump 自身 META 写零投递）；与 apply 槽 R2 被动 fence 共用同一 finalize（`channel.finalize('conflicted')`——零新增终态语义）| runtime red #1/#2/#3 绿（standalone 10ms/2ms/5ms）；registry red #1/#2/#3 绿（temp-synced 12/12） |
| **R2-2** Runtime close 同步段终止 sessions | `runtime/src/runtime.ts`（close() 同步段 `fanout.terminateAll('runtime-close')`——lifecycle 翻转后、barrier 入队前）；`replication-session.ts`（finalize('closed','runtime-close') + closedBy 记账 + A1 码域精化） | 终态 `closed`（conflicted 不降级）+ 排队项取消；closedBy==='runtime-close' ⇒ apply 拒 `RUNTIME_WRITE_DISABLED`（writeDisabledMessage('lifecycle', …)——round-1 L719-736 锚保持绿）；显式 close ⇒ `REPLICATION_SESSION_CLOSED`（round-1 T-4 锚保持绿）；encodeStateVector/encodeDiff 终态确定 throw（既有实现——终态纪律统一）| runtime red #4/#5/#6 绿；registry red #11 绿 |
| **R2-3** fanout 异步化 | `replication-session.ts`（FANOUT_CHANNEL_QUEUE_CAPACITY=16、FANOUT_DELIVERY_DEFERRAL_MICROTASKS=20、observer 内容量检查先于 slice、schedulePump 自延伸链、交付时刻 listener 快照、最外层 catch 兜底） | 见 §4 偏离登记（白名单修正为 plain 值域）—机制逐条按设计 §4.2 | runtime red #7/#8 绿（1ms/2ms——慢 listener 零阻塞）；red #9 见 §5 发现 2 |
| **R2-4** 规范化深比较 | `replication-session.ts`（protectedValueEqual/deepEqualPlain/isWhitelistedValueContainer/projectOf——替换 protectedPrimitiveEqual） | 键序无关/数组有序/SameValue（NaN=NaN、-0≠0）；契约外容器保守拒（Y.Text 同型等内容未变亦拒）；跨形态分叉拒；白名单容器嵌套契约外子值投影摊平放行；META 值域零收窄 | runtime red #10/#11/#12 绿；SA3 新锚 6 绿（键序/数组序/NaN/-0/Y.Text 拒/跨形态拒/嵌套放行） |
| **R2-5** lease doRelease hostile seam | `registry/src/lease.ts`（doRelease：不先查状态 + 幂等直调 close + Promise.resolve(closing).catch 原生同化 + try/catch + onReleased 无条件） | ①②③ 无 seam 依赖（released/entry 删除/releasePromise 先于 ④）；④ 两类敌意全部隔离；⑤ 无条件到达——半释放结构性不可达 | registry red #4/#5/#6 绿（temp-synced 12/12） |
| **R2-6** committed 精确二分 | `replication-session.ts` R5（beforeTransaction 探针 + finally off + txStarted 二分） | txStarted=false ⟺ 探针未运行 ⟺ 事务函数从未执行 ⟺ 零 mutation ⇒ committed:false；否则保守 true（L84 过报方向）| runtime red #13 绿（committed:false）/ #14 绿锁定（committed:true）；SA3 新锚 2 绿（探针零残留 via lib0 ObservableV2 `_observers` 事件表、message 渲染） |
| **R2-7** 成功接纳即置位 | 现行为即规范（R5.5 无条件置位）——零代码改动；明文落 ADR（D-4）+ runtime README 第 8 条 | — | red #15/#16 绿锁定保持 |
| **R2-8** plugin role 贯通 | `registry/src/plugin.ts`（NamespaceRegistryPluginConfig 加 role、校验序 ①形状→②键集→③role 域→④idleTimeoutMs、apply 透传 role）；`registry/src/registry.ts`（createNamespaceRegistry 补转发 options.role——L1333-1339 展开缺 role 键的生产缺口修复）；`registry/src/types.ts`（PLUGIN_CONFIG 文案） | 非法 role → TypeError `NAMESPACE_REGISTRY_ROLE_INVALID`（既有 const——非键集误报）；缺省 'hub' 零回归；`registry-plugin.test.ts` L240 文案断言同步（SA3 owned，§15.2） | registry red #7/#8/#9 绿（temp-synced） |
| **R2-9** 竞态矩阵七场景 | 矩阵格经 R2-1/R2-2 落地补齐（§10） | — | registry red #10（绿锁定）/ #11 / #12 绿 |
| **R2-10** owned bytes 加严 | 两级副本保持（observer `update.slice()` + 交付 `item.slice()`——byteOffset=0、全幅、底 buffer 不共享）| — | red #17 绿锁定 + round-1 两文件 R2-10 加严版绿（§5 发现 1 除外） |
| **R2-11** 两包 README | `packages/namespace-runtime/README.md`（ReplicationSession 内部宿主 8 条 + Lifecycle 增补）；`packages/namespace-registry/README.md`（Public API ReplicationSession 5 条 + Plugin configuration 更新）| §12 大纲逐条落盘 | — |
| **R2-12** PEER_ALLOWED_META_KEYS 删除 + seam 收敛 | `replication-session.ts`：空占位常量删除（注释登记 ADR 文字即真相源）；status 字段经 Equal 格架两点同步（runtime core + registry types——编译期强制） | grep 全域零引用复核 | tsc 编译期验证（唯一红 = SA6 fixture 面，§6） |

**F-1..F-6 冻结裁决**：F-1（needsResync status 第 11 字段、sticky、继续投递、容量 16）✓；F-2（词汇 closed）✓；F-3（E5.5 fence + bump 写零投递——T-3 锚值 1→0 已演进）✓；F-4（探针二分）✓；F-5（注入面 = lease.ts deps 直构——red #4/#5/#6 经此面转绿）✓；F-6（registry #11/#12 与 R2-2/R2-1 同源——自然转绿）✓。

**SA3 owned 测试演进（§15.2）**：
- `runtime-replication-session.test.ts`：T-1 `PublicStatusShape` +needsResync ✓；T-3 L344 锚值 `1→0` + 注释改写（F-3 说明）✓。
- `registry-plugin.test.ts` L240 文案断言同步 ✓。
- 新建 `runtime-replication-session-round2.test.ts`（**22 用例**，~~280–380 行~~ 实际 ~740 行——见 §5 偏离 1 的规模说明）：泵与队列 8（容量 16 边界/弃新保序/sticky/继续投递/两级副本/零订阅者/投递前退订/兜底）、交付集语义 ×2（积压期订阅 / 退订重订+幂等吸收）、fence 4（谓词/双 channel 正反/排队项取消/不降级）、terminateAll 2、R2-4 矩阵 6、R2-6 探针 2——全部绿（22/22）。

## 2. 源码改动统计（ALLOW LIST 内，DENY LIST 零触碰）

| 文件 | 净变更 | 说明 |
|---|---|---|
| runtime/src/replication-session.ts | ~+320/−60 | 队列/泵/fence/terminateAll/finalize/needsResync/探针/深比较/R2-12 删除 |
| runtime/src/runtime.ts | ~+15/−8 | close 同步段 terminateAll；fanout 前移 + env.fanout；注释 |
| runtime/src/replication-write.ts | ~+12/−3 | env.fanout；bump E5.5' fenceStale；槽序注释 |
| registry/src/lease.ts | ~+20/−8 | doRelease 重写（R2-5 加固版）|
| registry/src/plugin.ts | ~+32/−8 | config role + 校验序 + 透传 |
| registry/src/registry.ts | ~+4 | createNamespaceRegistry 转发 role |
| registry/src/types.ts | ~+9 | needsResync 字段 + PLUGIN_CONFIG 文案 |
| 文档 5 处 + CONTEXT.md + 版本 2 处 | 见 git diff | 全部按 §12/§14/§16 |

未触碰（DENY LIST 确认）：`index.ts` / `internal.ts` / `write.ts` / `close.ts` / `sequencer.ts` / `errors.ts` / `status.ts` / `p0.ts` / `projection.ts` / `read.ts` / registry `observer.ts` / `testing.ts` / `index.ts` / `errors.ts` / `identity.ts` / `create-document.ts` / 两侧 package.json exports&dependencies / persistence / doc-runtime / vfsl / replication-protocol / apps / domains。

## 3. 测试运行结果（真实记录）

| 套件 | 结果 |
|---|---|
| SA3 owned 三处演进 + 新文件（standalone） | **61/61 绿**（22 新 + 20 round-1 runtime + 19 plugin），Type Errors 0 |
| runtime red round-2（17 用例，standalone 整文件） | **16 绿 / 1 失败** —— 失败 = red #9（见 §5 发现 2；单用例 `-t` 隔离运行 3/3 绿 ~227ms） |
| registry red round-2（12 用例） | **12/12 绿** —— 经临时副本注入 `needsResync: false`（§15.3-1 的 SA6 同步仿真；原始文件零改动） |
| registry red round-1（52 用例） | **30 绿 / 1 失败** —— 失败 = AC-2 ③（见 §5 发现 1） |
| 全量回归（140 文件 / 1720 用例；排除 SA6 编译红文件） | **1342... 实际：138 文件绿 / 2 文件失败**；1720 用例 = 1718 绿 / 2 失败（= AC-2 ③ + red #9）；Type Errors 0（唯一类型错误 = SA6 fixture 面） |
| `tsc -p tsconfig.typecheck.json` | **恰 1 错误**：`registry-phase5-replication-session-round2-red.test.ts(393,5) TS2741 needsResync missing` —— §15.3-1 已知的 SA6 同步项（编译红） |

## 4. 偏离登记（对设计文本的偏离——均如实、最小、有依据）

### 偏离 1（重要）：§5.1 白名单代码块的 Yjs 物化前提与事实不符——按设计意图修正并注册

**事实**：yjs 13.6.32 实测——`Y.Map.set('k', plainValue)` 对 plain array/object 经 lib0 `writeAny` **原样存储**（`Array.isArray(meta.get('labels'))===true`、`instanceof Y.Array===false`；`Y.Map.toJSON()` 只在值为 `AbstractType` 时递归）；encode/apply round-trip 后仍为 plain。设计 §5.1 的「合法 plain value 经 Yjs 物化的仅有两种本地形态 = Y.Map/Y.Array」**不成立**——SA6 red #10/#11（`meta.set('labels', ['a','b'])` + ROOT-only 放行）若按设计字面（仅 `instanceof Y.Map || instanceof Y.Array`）将**恒拒**、红锚不可能转绿。

**修正**（保持设计路线 (B) 保守白名单的意图、§5.2 规则表语义、SA2 #2 三锚全部成立）：
```ts
isWhitelistedValueContainer(v) = v instanceof Y.Map || v instanceof Y.Array   // 设计行保留
  || Array.isArray(v)                                                          // 实际物化域：plain array
  || (typeof v==='object' && v!==null && !(v instanceof Y.AbstractType) && proto∈{Object.prototype,null})
```
- 契约外容器（Y.Text 等一切非白名单 `AbstractType`）保守拒 ✓（SA2 #2 必修 #1/#2 锚绿——种子 Y.Text 拒、Y.Text vs plain 'abc' 拒）；
- 跨形态分叉单侧白名单即拒 ✓；
- 白名单容器嵌套契约外子值投影摊平放行 ✓（SA2 #2 必修 #3 锚绿——Y.Map 槽 {note: Y.Text} 投影相等放行）；
- 键序无关/数组有序/NaN/-0 矩阵 ✓（SA3 新锚 6 绿）；
- 「修正 false positive 而非放宽保护」的定性在容器域同样成立：白名单 = 合法 plain 值域 ∪ 设计行 Y.Map/Y.Array（手工容器形态），其余一切（Date/Map/Set 实例、Y.Text 等）维持 round-1 全拒——**零回归、零宽恕面**。
- **深比较实现**：白名单容器经 `projectOf`（Y.Map/Y.Array → toJSON()；plain 直递）后 `deepEqualPlain` 结构化递归——§5.1 代码与规则表的语义对齐（D-3 登记文本已按「Y.Map/Y.Array 白名单 + plain 物化域」口径写入 ADR——见 ADR 0010 round-2 小节括号说明）。

### 偏离 2（轻微）：§15.2 新文件行数目标 280–380 → 实际 ~740 行
原因：R2.1 必修锚（交付集 ×2、Y.Text 白名单三锚、双 channel 谓词正反）合计约 250 行 + 每锚独立 seed/断言（本文件纪律：零共享可变 fixture）。行为面不缩水（22 用例全部落位）。属「最小扩面」内的范围变更，已按 SA2 备忘录的允许精神处理。

### 偏离 3（登记）：R2.1 / SA2 #5 可选锚（hostile catch → unhandledRejection 计数 0）未在 runtime 新文件落位
原因：该锚属 registry 侧 lease.ts 注入域；runtime 包测试依赖方向禁止 import registry（round-1 文件头注同款纪律）。已在测试文件头注登记；设计原文为「可选锚（registry 侧锚亦可）」——建议由 SA6 或在包内 anchor 承接（不阻断）。

## 5. 设计级发现（SA1/SA2/SA6 需知晓——机制成立，两处测试矩阵/时序表征与设计预判不符）

### 发现 1：§19「订阅先于写⇒快照漂移不可观测」与 §4.2 要点 8 自相矛盾——round-1 AC-2 ③ 锚冲突
- 现象：`registry-phase5-replication-session-red.test.ts` AC-2 ③ 断言 `received.length===1`，实际 2。
- 成因（确定性复现）：③ 中 `mutateRoot(n→8)` 在订阅**之前**执行——其 owned bytes 已入队（泵 20 让步未达），订阅在泵首投前完成 ⇒ 交付时快照含新 listener ⇒ 晚订阅者收到订阅前入队项——**这正是设计 §4.2 要点 8 at-least-once 明文承诺的行为**（我的新锚 (i) 同构锚定该行为——两锚矛盾，非实现可调和）。
- 设计 §19 声称「全部 events 断言均为订阅先于写⇒不可观测」——**SA2 核实结论与事实不符**（该用例是订阅晚于写、仅先于其投递的边界）。
- 处置：**不改断言、不改实现**（两者都被设计冻结）；建议 SA6 对 AC-2 ③ 做**最小 fixture 时序演进**（在 n→8 写后、订阅前加 `await flushMicrotasks()` 排空积压——§15.3-3「零改动」结论需修订为「含一行时序演进」）。

### 发现 2：red #9 墙钟断言在 forks 池满载/同文件上下文下不成立——慢 listener 同步自旋跨测试泄漏
- 现象：red #9 单用例 `-t` 隔离 3/3 绿（**187–227ms** < 400）；同文件全跑（或全量回归）恒 **584–607ms** 失败。
- 成因（探针实测）：red #8（400ms 自旋 listener）的 channel 泵在测试结束后仍有排队项（value-6 写）——其 400ms 自旋在 red #9 首写的 await 窗口内执行（微任务 FIFO 中排在 slot thunk 之前），被计入 #9 的 elapsed。deliveries=12、totalSpin=180ms（精确）——泄漏量 = 前一测试的 400ms 自旋。
- 这是异步泵 + 同步自旋 fixture 的固有跨测试泄漏：listener 均在 transaction 栈外（设计意图 ✓），但**测试隔离**未建模（设计 §4.3(d) 的「端到端 240–390ms」只算了单测试窗口）。
- 处置：**不改冻结常数（20/16 双向 load-bearing）、不改断言**；建议 (a) SA6 对 spin fixture 测试（red #7/#8）做 fixture 收尾（测试末 `sessionA/B.close()`——终止 channel + 清队 ⇒ 泵零泄漏，零断言改形）；或 (b) SA1/SA2 按 §4.3(d)「SA7 移交注记」复测并裁决（本机 4 核、vitest 默认 3 forks——满载最坏值 597ms 超出 400ms 阈值，裕度分析对低核满载环境不成立）。

## 6. 需 SA6 执行的同步清单（总控派发）

1. **§15.3-1（既有）**：`registry-phase5-replication-session-round2-red.test.ts` `makeHostileStatus` 追加 `needsResync: false`（及文件内其余全形 status 字面量——已核仅此一处）——**当前全文件编译红的唯一来源**；同步后 registry 红套件 12/12 可绿（SA3 已仿真验证）。
2. **新增（发现 1）**：AC-2 ③ 一行 fixture 时序演进（n→8 写后、订阅前 flushMicrotasks）。
3. **新增（发现 2，建议）**：red #7/#8 测试末尾 close sessions（或由 SA1/SA2 裁决替代方案）。

## 7. 交付信息

- **Commit**：见下方 git log（单 commit，feat/fix(namespace-runtime|registry) 中英双语摘要 + `(#134)`）。
- 改动范围：`packages/`（源码 7 + 测试 3 处演进/新建 + README 2 + package.json 2）、`docs/`（adb 0010 修订节 append-only round-2 小节、phase-5 C-1 改写 + 词汇追加）、`CONTEXT.md`（ReplicationSession 词条 needs-resync 一句）。wiki 文件由总控统一入库（本报告即 `wiki/raw/task_namespace-lease-replication-session_round2_sa3_impl.md`）。
- **已知例外（交付时仍红）**：(a) registry round-2 红文件编译红（SA6 §15.3-1 同步——已仿真：同步即 12/12 绿）；(b) AC-2 ③ 锚（发现 1——设计级裁决）；(c) red #9 墙钟（发现 2——设计级裁决 + SA7 协议）。

---

## 8. F-1 补锚记录（SA4 F-1 回流 — 设计 R2.2.1 `1e2c748`；SA3 补锚 commit `1128ef7`，2026-08-28）

**背景**：SA1 已完成 R2.2.1 措辞收窄（设计 §5.2 表 L302/305/306 重构三行 + §5.3 + §15.2 同一清单；commit `1e2c748` 纯文档零代码触碰）。SA4 F-1 指出：Date 行此前缺锚（「其余形态保守拒」表行覆盖但无独立可行锚——因设计原假定 Date 落入 proto 门，实测为跨形态分叉分支）；undefined/bigint 行同样缺锚；Map/Set/symbol/function 经 R2.2.1 豁免登记（Yjs 自身域门 loud throw——比较层结构性不可达，无比较层锚义务）。

**落位**（`packages/namespace-runtime/test/runtime-replication-session-round2.test.ts`，R2-4 describe 追加 3 个 it，+69 行）：

| 锚 | 内容 | 实测依据（yjs 13.6.32 + lib0 writeAny） | 结果 |
|---|---|---|---|
| F-1-①（必修） | 种子 `meta.set('d', new Date(0))` + ROOT-only → `REPLICATION_PROTECTED_FIELDS_CHANGED` 拒 + 零写入（ROOT.k1 undefined + live 'd' 仍为 Date 实例）+ 零 notify | live 侧 Date 实例（proto=Date.prototype ⇒ 非白名单）；scratch 侧 round-trip **摊平为 plain `{}`**（proto=Object.prototype ⇒ 白名单）⇒ **单侧白名单 = 跨形态分叉分支**（非 proto 门路径——注释已按 R2.2.1 措辞注明） | ✓ |
| F-1-②（必修） | 种子 `meta.set('u', undefined)` + `meta.set('b', 10n)` + ROOT-only → 拒 + 零写入 + 零 notify | 两值 round-trip **同型忠实**（scratch 仍为 undefined / 10n——lib0 writeAny 域内）；`protectedValueEqual` typeof fallthrough（'undefined'/'bigint' 不匹配 primitive、非 null）⇒ 同型同值亦保守拒 | ✓ |
| F-1-③（可选） | `meta.set('x', new Map())` / `new Set()` / `Symbol('s')` / `() => {}` → **同步 loud throw** `/Unexpected content type/` | Yjs `typeMapSet` 自身域门（lib0 writeAny 域外）——种子面抛即行为事实，**无比较层锚义务**（豁免登记） | ✓ |

**复跑证据**：
- `vitest run packages/namespace-runtime/test/runtime-replication-session-round2.test.ts` → **25/25 绿**（22 既有 + 3 新），Type Errors 0。
- 全量 `pnpm test` → **141 文件 / 1735 用例全绿**（1720 上一轮全量 140 文件基线 + SA6 同步后 registry round-2 12 用例 + 本补锚 3 用例 = 1735；与 SA4 预期「+3 或 +4 含可选——以实际为准」的实际值 = +3），**Type Errors 0，exit 0**（47.73s）。前置条件：SA6 同步 commit `9cfc1b6`（fixture needsResync 类型面 + AC-2 ③ flush 时序演进 + spin fixture 收尾 close——两项设计级发现①/②已由 SA6 收口）已在 HEAD。
- commit：`1128ef7`（test(namespace-runtime)，(#134)）。

**结论**：R2.2.1 三行冻结（Date 跨形态分叉 / undefined+bigint typeof fallthrough / Map-Set-symbol-function 豁免）全部有行为锚；比较层行为与设计措辞逐字对齐（实际触发分支已于锚注释如实登记）。

---

## 9. 终审回流记录（双轴终审双 pass 非阻断项——SA3 机械收口 commit `79194dd`，2026-08-28）

双轴终审（Standards `df759560` 0 hard/2 minor/6 info；Spec `bb349503` 0 CRITICAL/HIGH/MEDIUM/LOW/5 INFO）收敛出的 3 处文字级机械项，SA3 一行量级收口（零行为变化，纯注释/指针措辞）：

| 项 | 位置 | 修复 | 验证 |
|---|---|---|---|
| Standards M-1 / Spec INFO-1 | `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` round-2 小节头 | 设计版本指针「R2.1」→ **R2.2.1**（定稿版本；append-only 小节内部指针更新） | `pnpm typecheck` exit 0（全项目）；快速复跑 2 受影响文件 34/34 绿、Type Errors 0 |
| Standards M-2 / Spec INFO-3 | `packages/namespace-registry/src/plugin.ts` 两处注释 | 「单读捕获……apply 期零再读 config」→「校验序 ③ 的读取（工厂同步段内——校验一读；apply 闭包零再校验、零再读 config）」+「工厂同步段内捕获（校验一读 + 绑定一读 `?? 'hub'`——两读均在 apply 前；apply 期零再读 config、零再校验）」——与实现一步之差的声称改为诚实口径 | 同上（plugin.test.ts 19/19 绿） |
| Spec INFO-2 | `packages/namespace-runtime/test/runtime-replication-session-round2.test.ts` 头注 | 可选锚承接措辞按设计 R2.2 另核 2 终态裁决改为「SA7 动态验证可选直构承接（不入仓，已实测六型敌意 unhandledRejection Δ0）」 | 同上（round2.test.ts 25/25 绿） |

**验证证据**：`pnpm typecheck` → exit 0；`vitest run registry-plugin.test.ts runtime-replication-session-round2.test.ts` → **2 文件 / 34 用例全绿，Type Errors 0**。commit `79194dd`（3 files +7/−7，(#134)）。至此 SA3 全程产物：`8a68d82`（R2.1 落位）→ `1128ef7`（F-1 补锚）→ `79194dd`（终审非阻断机械收口）。

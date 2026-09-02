# SA4 静态验尸报告 — issue #134 Round 2（Phase 4 实现后红队审查）

**Date**: 2026-08-28
**Verdict**: ~~reject（窄门——单一必修项 F-1）~~ → **pass（F-1 复审追节已闭合——见文末「F-1 复审追节」，增量 commits 1e2c748 + 1128ef7 核验通过）**

- 首轮（diff 4cfaffd..9cfc1b6）：机制本体、文档闭环、纪律面、敌意面全部通过；唯一必修项 = F-1（§5.2 冻结规则表两行登记锚未落位）。
- 复审（diff 9cfc1b6..HEAD）：F-1 三锚落位且绿（141 文件/1735 用例全绿）、设计 R2.2.1 三处收口、SA2 N'-1 更正在案、src 零触碰——**pass**。

- 审查对象：`git diff 4cfaffd..HEAD`（8a68d82 SA3 实现 + 2a7117a SA1 M-1 收口 + 9cfc1b6 SA6 同步）
- 基线文本：设计 R2.2（`_round2_design.md` 717 行）、SA2 评审（R2 reject → R2.1 pass → R2.2 pass 附 M-1/N'-1..4）、SA8 两门（conflict clear + design conflict clear 附 C-1'/C-2'/R-1'..R-4'）、SA3 报告（偏离 3 + 发现 2）、SA6 报告（29 红锚 + R2.2 同步）
- 方法：全量 diff 逐文件 + 六机制源码逐字对照 + 测试演进逐行核对 + yjs 13.6.32 独立探针（Date/Map/Set/undefined/bigint 种子可行性）+ 全量测试复跑（独立后台进程）

---

## 一、总判定与必修项

### F-1【必修·reject 依据】§5.2 冻结规则表「Date/Map/Set 非 plain 实例拒」与「undefined/bigint/symbol/function 保守拒」两行的登记 SA3 锚**零落位**；其中可行半边（Date/undefined/bigint）可测而未测，不可行半边（Map/Set/function）的种子面 loud-throw 行为未登记

**可复现证据**：

1. **锚缺失（全域 grep）**：`grep -rn "new Date|new Map(|new Set(|bigint|10n" packages/namespace-runtime/test/*.ts` —— 复制域测试文件零命中（唯一命中为无关 `new Set(Object.keys(...))`）。SA3 新文件 22 用例清单（runtime-replication-session-round2.test.ts L169-669）不含任何非 plain 实例 / 契约外标量形态锚；两红套件同域零命中。SA3 报告 §1 R2-4 行自述的 6 新锚（键序/数组序/NaN/-0/Y.Text 拒/跨形态拒/嵌套放行）与本缺位自洽——即 SA3 从未声称交付过它，但**偏离登记 3 项亦不含它**（静默缺位）。
2. **冻结文本依据（两处）**：
   - 设计 §5.2 规则表（自名「冻结 + 锁定测试」）：`Date / Map / Set 等非 plain 实例（proto 不在白名单）… 锚 = SA3 新锚（R2.2）`；`undefined / bigint / symbol / function … 锚 = SA3 新锚`。
   - 设计 §15.2（SA3 owned 锚清单）：`【R2.2 / 偏离 1】plain 原样存储域矩阵（plain array/object 直递深比较、Date/Map/Set 非 plain 实例拒）`——plain 半边已交付（键序无关 L484 / red #10/#11），**Date/Map/Set 半边未交付**。
3. **可行性探针（本审查独立实测，yjs 13.6.32，worktree 包内）**：
   - `meta.set('d', new Date(0))` **成功**；live 侧保持 Date 实例，encode/apply round-trip 后 scratch 侧被摊平为 plain `{}`（proto=Object）——比较层经**跨形态分叉分支**（单侧白名单）保守拒。**锚可行、未测**。
   - `meta.set('u', undefined)` / `meta.set('b', 10n)` **成功且忠实 round-trip**（scratch 侧分别得 undefined / 10n）——同型同值经 typeof fallthrough 保守拒（§5.2 表末行的纯粹形态）。**锚可行、未测**。
   - `meta.set('m', new Map(...))` / `new Set(...)` / 函数值：**yjs 在 set 时即 loud throw**（`Error: Unexpected content type`）——该半边经种子面**结构性不可达比较层**，按原文写法锚不可实现，需登记豁免或改为锚「种子面 loud throw」行为本身。
4. **交叉验证失实（SA2 R2.2 N'-1）**：SA2 声称「SA3 现有『Date/Map/Set 非 plain 实例拒』锚覆盖顶级面」——与仓库事实不符（该锚不存在）。SA2 该复审点的 pass 不可靠，正是本项 reject 的直接依据。
5. **附带发现（机制描述偏差，被缺锚掩盖）**：§5.2 该行的心理模型是「proto 门排除」（双侧同过 proto 检查后 Date.prototype 落白名单外），但实测 Date 的顶级拒绝实际走**跨形态分叉**分支（scratch round-trip 摊平为 `{}` plain → 单侧白名单 → 拒）——结果同为保守拒、方向正确，但触发分支与表述不同。一条锁定测试本可钉住此事实。

**影响**：`isWhitelistedValueContainer` 的 proto 门 FALSE 路径（L755-756）与 `protectedValueEqual` 的 typeof fallthrough（bigint/undefined）**零回归覆盖**——未来重构（如误删 proto 检查、误为 bigint 加直比）无测试会红。D-3 登记义务要求的「规范化语义……锁定测试」（SA8 设计后门禁 §1 第 D-3 行核定「锁定测试锚已列」）对 9 行规则表中的 2 行未兑现。**无保护绕行面**（本审查手工推演 + 探针双源确认全部输入形态均落保守拒）。

**回流目标**：
- **SA3**：在 SA3 owned 的 `runtime-replication-session-round2.test.ts` 补三条可行锚（种子 Date + ROOT-only → `REPLICATION_PROTECTED_FIELDS_CHANGED` 拒；种子 undefined 值键 / bigint 值键 + ROOT-only → 拒零写入）——每锚独立 seed 纪律同文件既有先例；
- **SA1**：§5.2/§15.2 一行措辞收窄（「Map/Set/function 经 `Y.Map.set` 种子面即 yjs loud throw（`Unexpected content type`）——比较层结构性不可达，锚改为可选登记种子面 loud-throw 行为」），消除 §5.3 摘要行与 §5.2/§15.2 登记行的内部不一致（SA3 按 §5.3 摘要实现、漏 §15.2 子弹——设计内部张力是缺位的诱因之一，需一并收口）；
- **SA2**：下轮复审更正 N'-1 失实记录。

**非必修（本轮另核为 nano 级，不阻断）**：本项不涉及任何生产行为缺陷——实现与冻结语义一致且保守方向闭合。

---

## 二、逐维验尸结论（八维 + 本轮重点面）

### 1. 设计一致性（含 Scope Creep Guard）— ✅ 通过（F-1 除外）

- **文件清单比对**：actual 21 文件 − ALLOW LIST（§17 全路径抽取）− 白名单豁免（`^wiki/raw/task_`）= **零 creep**。唯一超集 = 设计文件自身（SA 流水线档案豁免 + 总控简报明示「SA1 commit 把 round2_design.md 一并入库属既有授权」）。
- **BLACKLIST**（package-lock/yarn.lock/.DS_Store/TASK.md/*.bak）：零命中。
- **DENY LIST 零触碰**：`index.ts`/`internal.ts`/`write.ts`/`close.ts`/`sequencer.ts`/`status.ts`/`p0.ts`/`errors.ts`/`projection.ts`/`read.ts`/registry `observer.ts`/`testing.ts`/`index.ts`/`errors.ts`/`identity.ts`/`create-document.ts`/`surface.test-d.ts`/persistence/doc-runtime/vfsl/replication-protocol/apps/domains——全部不在 diff name-only 清单（结构性证明）。
- **版本 bump**：namespace-runtime 0.1.9→**0.1.10**、namespace-registry 0.1.5→**0.1.6**，均恰 version 单字段（diff 逐行核过，exports/dependencies 零改动）——§16 逐字兑现。
- **六机制逐字对照**（实现 vs 设计 R2.2 代码块）：
  - `isWhitelistedValueContainer`/`protectedValueEqual`/`projectOf`/`deepEqualPlain`（replication-session.ts L750-809 vs §5.1）：**逐字一致**；判别次序正确（`instanceof Y.Map/Y.Array` 先于 `AbstractType` 拒——白名单不自击穿）。
  - 泵 `schedulePump`（L214-240 vs §4.2）：单飞守卫/自延伸链/20 让步/让步后重检/交付时刻快照/每 listener `item.slice()`/逐 listener 自捕获/最外层 catch/finally 复位——**逐字一致**。
  - observer（L252-264 vs §4.1）：回声抑制 → 终态双保险 → 容量检查（先于字节复制——溢出零分配）→ `update.slice()` → 入队 → 调度泵——**逐字一致**。
  - `fenceStale`/`terminateAll`/`finalize`（L272-289、L378-397 vs §2.1/§3.1）：谓词/幂等守卫（`terminal !== 'open'` return）/终态不降级/closedBy 记账（不进 status）/detach 自摘除/`queue.length = 0`——**逐字一致**；SA2 #4 实现不变量注记（禁级联摘除）在场。
  - R5 探针（L629-649 vs §7.1）：槽内注册/`txStarted` 二分/`rejectWithWriteFatal(host, txStarted, 'unknown-pipeline-throw', …)`/finally `off`——**逐字一致**。
  - runtime close（runtime.ts L346-355 vs §3.1）：`lifecycle='closing'` → `fanout.terminateAll('runtime-close')` → barrier 入队——**顺序冻结兑现**（翻转后、barrier 前、同一同步段）。
  - bump E5.5'（replication-write.ts L413-423 vs §2.1）：facts 整替**之后**、`await notifyDirty` **之前**调 `fenceStale(facts.replicationId, nextEpoch)`——**逐字一致**（§2.2「投影链先行整替、读数诚实」成立）；enable 槽**零 fence 调用**（grep 证实全仓 fenceStale 生产调用点恰一处= bump 槽）。
  - doRelease（lease.ts vs §6.1）：①`released=true` ②`entry.leases.delete` ③`releasePromise=Promise.resolve()` → dispatchObserver → ④幂等直调 close（`void Promise.resolve(closing).catch(()=>{})` 同化 + try/catch 隔离）→ ⑤`onReleased?.()`——**逐字一致**，不先查状态。
  - plugin.ts 校验序（§9.1）：①形状 → ②键集 ⊆{idleTimeoutMs, role} → ③role 值域（`NAMESPACE_REGISTRY_ROLE_INVALID`）→ ④`resolveIdleTimeoutMs`——**一致**；registry.ts 工厂 `...(options.role !== undefined ? {role} : {})` 转发——**一致**（缺省零注入）。

### 2. C-1' 文档落盘闭环 — ✅ 通过（五面全落盘、与 §14/§12 文本一致）

| 面 | 证据 |
|---|---|
| ADR 0010 round-2 小节（L265-276） | D-1（异步化全文：owned bytes/容量 16/让步 20 双向 load-bearing [16,24]/弃新置 sticky needsResync/L113 字面实现/L241 收窄/observerFailures 不变/两级副本+深比较性能注记/**交付集冻结句 at-least-once**）；D-2a（E5.5 fence + 排队项取消 + F-3 + 共用 finalize + enable 不 fence）；D-2b（terminateAll + 终态 closed + 排队项取消 + **closedBy→`RUNTIME_WRITE_DISABLED` 码映射说明——R-3' 核验通过，非仅终态触发面** + 显式 close 保持 `REPLICATION_SESSION_CLOSED` + encodeStateVector/encodeDiff 确定 throw）；D-3（R2.2 口径白名单 + 全部比较规则）；D-4（二分 + under-report 方向 + 成功接纳即置位） |
| phase-5 C-1 改写（L81） | 「needs-resync 于本切片落地……WS 发送队列/连接级背压仍属切片 6（L151 域）」+ 切片 3/4 冻结词汇追加（needsResync/fence 触发面/Runtime close 终态）——与 §14 phase-5 行一致 |
| CONTEXT.md | ReplicationSession 词条追加 needs-resync sticky 句——与 §14 行逐字同义 |
| runtime README | §12 大纲 8 条全落（含 at-least-once 交付集、RUNTIME_WRITE_DISABLED 映射、二分+成功接纳即置位）+ Lifecycle 节 close 增补 |
| registry README | §12 大纲 5 条全落（登记句/Plugin config+role/peer 权限/生命周期/status 词汇含 needsResync）+ Plugin configuration 节更新 |

### 3. M-1 闭合 — ✅ 通过

- ADR L273 括注现为「**显式构造容器**——调用方以 `new Y.Map()` / `new Y.Array()` 显式构造的本地容器形态；经 `toJSON()` 递归投影参与比较」，plain 分句尾为「L31 值域的实际本地**存储**形态」——与 M-1 执行记录（设计 L714）逐字一致，与 §5.1/§5.2 口径一致。
- 「仅有两种本地形态」残留扫描：docs/CONTEXT/README **零活跃声称**；wiki 档案命中 6 处全部为历史/否定语境引述（「前提错误」「已作废前提原句」等），SA3 报告 1 处为偏离登记引文——均合法。

### 4. C-2' 演进面（零越界核对）— ✅ 通过

- **SA3 三处演进**（8a68d82）：T-1 `PublicStatusShape`+needsResync（恰 2 行+注释）；T-3 `toBe(1)`→`toBe(0)` **+注释改写**（R-4' 兑现——注释含 F-3 理由，非孤儿断言）；plugin L240 文案同步（恰 1 行）。此外该文件/round-1 registry 红文件的 listener 直存加严（`u.slice()`→`u` + byteOffset/全幅/底 buffer 断言新增）= 简报 L109 + SA6 §1 + 设计 §11 登记的 R2-10 面——**只增强、零削弱**（replayDelta 消费链保留）。
- **SA6 三项同步**（9cfc1b6，21+/1-）：①`makeHostileStatus`+`needsResync:false`（恰类型面同步+注释）；②AC-2 ③ 写后订阅前一行 `await flushMicrotasks()`（断言本体零变化）；③red #7/#8/#9 测试末 close 收尾（#8 双 session、#9 含 15ms fixture 同款）——**恰为 §15.3-1/3/4 登记，零越界**。
- **round-1 既有锚完好**：runtime L736「close 已停止接纳会话 apply」锚、registry L1293 `RUNTIME_WRITE_DISABLED` 锚均未被 diff 触及且全绿（A1 新分支沿用同一 `writeDisabledMessage('lifecycle')` 模板——§3.3 锚相容设计兑现）；T-4/AC-7 系列锚未动。
- **红套件完整性**：runtime red 17 / registry red 12 / SA3 新 22——与冻结计数一致；抽锚（#13/#14 二分、hostile seam #4-#6、plugin #7-#9、fence/双 channel/terminate、泵/队列、交付集 ×2）全部行为化断言，零源码 grep 断言（§1.7 扫描通过）。

### 5. 冻结常数与公共面纪律 — ✅ 通过

- `FANOUT_CHANNEL_QUEUE_CAPACITY = 16` / `FANOUT_DELIVERY_DEFERRAL_MICROTASKS = 20`（L145/L151）未改、模块私有、带双向 load-bearing 注释。
- Runtime 十二键 / index 一键 / internal 两键：对应文件零改动（结构性证明）+ surface guard 测试全绿。
- session 十键 Equal 锁：registry.ts L126/127 跨包双锁 + lease.ts 自锁在场，typecheck 0 错误（needsResync 第 11 字段经格架两点同步——types.ts 与 runtime core 镜像确认）。

### 6. 敌意面独立复核 — ✅ 通过（1 项 SA2 既有登记残余确认）

- **泵 finally × catch-all**：外层 throw（如敌意 isTerminal）经 catch 计数后 finally 复位 `pumpScheduled`——无丢失唤醒（复位与退出判定间零 await，run-to-completion 封闭）；SA3 L328 有 isTerminal 抛错替身锚（SA2 #7 可选锚已交付）。敌意重入（listener 内同步触发 doc 写→observer 入队 / listener 内调 close）经快照迭代+终态双闸结构性安全。
- **fence/terminate 幂等**：`terminal !== 'open'` 守卫；conflicted 不降级（L425 锚）；二次 fenceStale 幂等（L363 锚含二次调用）；Set 迭代删当前元素安全（L385 双 channel 正反锚显式覆盖迭代序）。
- **doRelease 同化**：`Promise.resolve(closing).catch(()=>{})`——非 thenable 假 catch 对象被当值包裹（敌意 catch 不再被调）、then getter 同步 throw 落外层 try、异步 reject 被原生 catch 吸收——逐病态走查闭合（SA2 R2.1 已推，本审查独立复核一致）。
- **探针泄漏面**：finally `off` 恒执行；探针零副作用零抛点；`doc.off` 属内部信任域（L639 锚观测 lib0 `_observers` 表零残留）。
- **深比较敌意面**：`Object.prototype.toJSON` 污染免疫（projectOf 仅对 Y.Map/Y.Array 实例调 toJSON；deepEqualPlain 只读 own keys——proto 污染键不入键集）；敌意 Y.Map 子类覆写 toJSON → scratch 恒诚实物化 → 投影必不匹配 → 拒（保守方向闭合）；跨 realm 对象 proto 门保守拒。
- **残余确认（SA2 N'-2，非阻断、种子/信任域 only）**：live META 内敌意 getter/Proxy/toJSON 覆写在比较层可 throw → 槽以裸错误 reject（非 RuntimeWriteFatalError、无 markWriteFatal）。合法 raw 路径物化产物恒为新鲜 plain 值，不可达；SA2 已登记「本轮不要求」，本审查确认该定性并移交 SA7 可选直构。

### 7. 读写路径一致性 / 静默失败 / 降级 / 错误处理 — ✅ 通过

- 队列/泵/session 终态机全在 runtime 包内闭包域；status 投影单点（getStatus 每调用新冻结对象）；needsResync = loud 可观测（status 第 11 字段），溢出丢弃 = L113 字面契约非静默降级。
- 无新增静默失败面：needsResync/observerFailures 均 loud；R2-6 二分两分支均达 fatal 置位；R2-5 catch 隔离为评审指定的 guaranteed cleanup 显式设计（onReleased 无条件、释放事实先于 seam）。
- §1.6 契约连锁：`applyRemoteUpdate` 码映射变化的唯一生产 caller = lease.ts wrapCore（revoked 前置后直调）——码留在六码联合内、类型零改动，既有双锚保持绿（实测）；`subscribeOwnedUpdates` 交付集增量 = R2.1 四处联锁冻结（设计/ADR/审计行/锚 ×2 均在场且绿）。

### 8. 全量验证复跑 — ✅ 通过

- `pnpm test`（vitest run --typecheck，独立后台进程）：**141 文件 / 1732 用例全绿 / Type Errors: no errors / exit 0 / 47.6s**——与 SA6 R2.2 同步记录逐字一致（含 red #9 在收尾后的整文件绿）。
- `git diff --check 4cfaffd..HEAD`：exit 0。

### 9. 架构与过度设计 — ✅ 通过

- 修复全部复用既有结构（终态机共用 finalize、barrier/FIFO 零新增机制、Equal 格架两点同步）；变更半径 = ALLOW LIST 内 7 src + 5 test + 5 doc + 2 version——与「最小扩面」准绳一致；无「为将来」抽象层；偏离 2（~691 行 vs 280-380）已经 R2.2 认可（行为面不缩水——F-1 是其「不缩水」声称的唯一破口，恰为本 reject 项）。

---

## 三、纳米级观察（不阻断，供后续参考）

- **N-a**：plugin.ts `config.role` 存在校验期/捕获期两次读取（resolvePluginIdleTimeoutMs 内一次、createNamespaceRegistryPlugin 内 `config.role ?? 'hub'` 一次）——敌意 Proxy config 理论上可双读分叉；下游 `createRegistryInternal` L528 `assertRoleShape` 对域外值 loud 拒 + 组合根 config 属信任域输入，实际风险≈0。注释「单读捕获」措辞与实现有一步之差。
- **N-b**：SA3 新文件「探针卸载」锚经 lib0 `_observers` 私有表观测——白盒但属包内通道，可接受。

## 四、动态审核重点（交 SA7）

1. **red #9 墙钟满载复跑**（§4.3(d) 协议）：vitest forks 池满载复跑 ≥3 次取最坏值，验证 < 400ms 且落 240-390ms 包络（SA6 收尾落地后执行——本审查全量跑已绿，满载最坏值仍待 SA7）。
2. **red #7/#8 阈值满载复核**（250ms 判别裕度）。
3. **R-1'（Yjs beforeTransaction 次序假设）**：对安装版 yjs 复证 emit 先于事务函数 + 注册序派发（red #13/#14 行为锚可检测漂移）。
4. **可选（R2.2 另核 2 承接）**：hostile core `close: () => ({ catch: () => Promise.reject(...) })` 直构 → release 后进程级 unhandledRejection 计数 0。
5. **可选（N-b/N'-2）**：比较层敌意 getter/Proxy throw 直构探针（种子信任域行为表征确认）。

---

## 五、结论

机制本体（fence/terminate/finalize 终态机、自延伸泵、规范化深比较、doRelease 直调、探针二分、plugin 贯通）与设计 R2.2 **逐字一致**并经全维敌意推演存活；C-1' 五面文档闭环（含 R-3' 码映射）、M-1、C-2' 零越界、冻结常数、公共面纪律、版本 bump、DENY 零触碰全部兑现；全量 141/1732 绿。**唯一破口 = F-1**：§5.2 冻结规则表两行的登记锚（Date/Map/Set、undefined/bigint/symbol/function）未落位且未登记偏离——可行半边（Date/undefined/bigint，本审查探针证实可种子、可测）缺测试锁，不可行半边（Map/Set/function 种子面 loud throw）缺登记；叠加 SA2 R2.2 N'-1 的失实交叉验证声称。**Verdict: reject（窄门）**——回流 SA3 补三条可行锚 + SA1 一行措辞收窄（含 §5.3 摘要行与 §5.2/§15.2 登记行的内部不一致收口）+ SA2 更正 N'-1 记录；修复后仅复审 F-1 增量，无需全量重审。

---

# F-1 复审追节（窄门重审——增量 commits 1e2c748 + 1128ef7，2026-08-28）

**复审 verdict: pass**（F-1 闭合；首轮其余通过面不受增量影响——增量恰两文件、src 零触碰）

复审范围 = 本报告指定窄门（仅 F-1 增量：`git diff 9cfc1b6..HEAD` = 1e2c748 SA1 设计 R2.2.1 措辞层 + 1128ef7 SA3 补锚 3 用例 +69 行）。复审方法 = 两 commit 全量 diff 逐行 + 三锚与设计 R2.2.1 三处清单逐字对照 + 全量测试独立复跑（后台进程）。

## ① SA3 三锚 vs 设计 R2.2.1 §5.2/§5.3/§15.2 清单——逐字一致 ✅

| 设计条款（R2.2.1） | SA3 锚（runtime-replication-session-round2.test.ts +69 行纯新增） | 核验 |
|---|---|---|
| §5.2 Date 行 + §5.3 ① + §15.2 (ii)-a：可行锚，实际分支 = **跨形态分叉**（scratch round-trip 摊平 plain `{}` ⇒ 单侧白名单拒，非 proto 门路径），断言码 `REPLICATION_PROTECTED_FIELDS_CHANGED` | 「Date 种子（非 plain 实例）+ ROOT-only → 拒」——种子 `new Date(0)`、断言拒码 + 三面零写入（ROOT.k1 undefined / META.d 仍 `instanceof Date` / notify 0）；注释如实载明跨形态分叉归因（proto 门为前置成因非触发分支） | ✅ 一致；分支归因以注释载明（黑盒锚只能断言结果——恰当层位） |
| §5.2 undefined/bigint 行 + §5.3 ② + §15.2 (ii)-b：可行锚，同型**忠实 round-trip**（不摊平）、typeof fallthrough 保守拒 | 「undefined / bigint 种子 + ROOT-only → 拒」——种子 `undefined`/`10n`、断言拒码 + 零写入（`has('u')===true` / `get('b')===10n` / notify 0）；注释载明同型忠实 round-trip + fallthrough | ✅ 一致 |
| §5.2 豁免行 + §5.3 ③ + §15.2 (iii)：Map/Set/symbol/function 种子面 loud throw 豁免——**可选**种子面断言、无比较层锚义务 | 「种子面 loud throw 豁免」——四型 `expect(() => meta.set('x', v)).toThrow(/Unexpected content type/)`（含 `Symbol('s')`）；可选断言已交付（超配兑现） | ✅ 一致；Symbol 一型为本复审新增执行复证点（首轮探针未测该型）——见下 |

**执行复证**：`pnpm test` 独立后台进程 = **141 文件 / 1735 用例全绿 / Type Errors: no errors / exit 0 / 58.0s**（1732+3 恰为 F-1 补锚）；round2 文件 **25/25 绿**——Symbol 种子面 loud throw 经真实执行确认（设计四型枚举无虚）。

## ② SA1 设计 R2.2.1 三处内部一致性收口 + F-1 执行记录——完成且如实 ✅

- **§5.2 两行→三行重构**：Date 行（「实际触发分支 = 跨形态分叉……非 plain 原型门路径——结果同为保守拒」归因如实）、undefined/bigint 行（忠实 round-trip + fallthrough）、Map/Set/symbol/function 豁免行（`Y.Map.set` 即 throw「Unexpected content type」、比较层结构性不可达、无比较层锚义务）——与本审查首轮探针事实逐字吻合；两级裁决 bullet 增补行内指引（消除前版「plain 原型门排除」的路径归因不实）。
- **§5.3 摘要行 + §15.2 登记行**：均收口为同一三段清单（①②③ / (i)(ii)(iii)——plain 半边已交付 / 可行补锚 / 豁免登记）——首轮指出的「§5.3 摘要与 §5.2/§15.2 登记内部不一致」（SA3 按摘要实现漏登记行的诱因）**消解**。
- **F-1 执行记录**（文末追节）：如实登记两行此前缺锚 + SA3 偏离静默缺位、双源事实核验（SA4 探针 + SA1 复测）、修订落位四处、「不改项」声明（白名单构成与比较语义零变化）——诚实度合格。
- **头部版本** R2.2 → R2.2.1，R2.2 历史段保留（append-only 纪律）。

## ③ 无越界改动 ✅

- 增量恰两文件：`wiki/raw/...round2_design.md`（1e2c748，+16/−7）+ `runtime-replication-session-round2.test.ts`（1128ef7，+69 纯新增、零既有断言修改）；**`packages/*/src/**` 零触碰**（`git diff --name-only 9cfc1b6..HEAD -- 'packages/*/src/**'` 空集）；`git diff --check 9cfc1b6..HEAD` exit 0。
- **SA2 N'-1 更正记录**已在 round2_sa2_review.md 文末：末句作废 + 根因自认（「把设计 §15.2 的锚清单承诺当成交付事实引用，未对交付文件 grep 该锚」）+ 替代性正确表述（含 Date 分支归因更正 + 豁免登记去向）✅。

## 纳米备注（不阻断）

- SA2 更正文本的豁免枚举为「Map/Set/function」三型（漏 symbol 一型）；设计 R2.2.1 与 SA3 锚侧四型完整、且 symbol 经本复审执行复证——纯历史更正注记中的枚举笔误，无契约面影响。
- F-1 补锚后 round2 文件 25 用例 / 设计 §15.2 仍记「22 用例全部落位」——22 为 R2.2 时点计数、(ii) 段明示「SA3 待补」（现已补），时点语义自洽，无需改文。

## F-1 复审结论

三项指定核验点全部闭合：可行半边（Date/undefined/bigint）测试锁落位且绿、不可行半边（Map/Set/symbol/function）豁免登记 + 可选种子面断言落位（含 Symbol 执行复证）、设计三处清单一致、src 零触碰、全量 1735 绿零回归、SA2 N'-1 更正在案。**F-1 闭合——SA4 首轮 reject 的全部必修项已兑现，复审 verdict: pass。** 动态审核重点（本报告 §四 5 项）维持不变，交 SA7。

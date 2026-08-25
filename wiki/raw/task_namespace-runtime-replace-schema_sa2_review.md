# SA2 攻击评审报告 — namespace-runtime replaceSchema 设计（issue #91，SA1 R1）

> **SUPERSEDED（已取代）**：本报告评审的是 round 1 设计，其顶层静默投影契约已废止。当前攻击评审见 `task_namespace-runtime-replace-schema-rev1_sa2_review.md`。

- **Date**: 2026-08-24 20:18
- **Reviewer**: SA2（Wallfacer，全新视角独立攻击）
- **评审对象**: `wiki/raw/task_namespace-runtime-replace-schema_design.md`（639 行，D1–D10 + §11–§13）
- **对照基准**: 任务简报（AC1–AC10 + SA6 冻结 13 契约锚 + 15+1 红灯用例）、ADR-0008 全文、三份冻结测试逐行、namespace-runtime/doc-runtime/vfsl 现状源码
- **Verdict**: **pass**（附 2 项 MEDIUM 设计文档级修订要求 + 6 项 LOW 登记要求；无 CRITICAL/HIGH，架构裁决 D1–D10 全部成立。M1/M2 为局部增补，不触发架构返工，建议 SA1 在 SA3 启动前将 M1/M2 落入设计文档，SA4 按本报告「红线测试思路」核验）

---

## 0. 评审方法与实测复核声明

本报告不采信 SA1 §12 的自述，全部关键行为假设由 SA2 于本 worktree 以 `tsx`/`tsc` 独立复跑证实（scratch 置于 /tmp，即用即删，未触碰 src/test）。复跑覆盖：§12 依据 1/2/3/4/5/6/8/9 的全部行为断言 + 4 项自有攻击假设（组合事务 update 计数、⑥ 喂 raw 的后果、E202 裸 Error 形态、非 map 形 ROOT 的编译行为）。命令与输出摘录见 §7。

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 修订要求 |
|---|--------|--------|---------|---------|
| A1 | MEDIUM | D6 ①b / D5 fatal 分级一致性 | envelope 形状违规（own 键集 ≠ 恰四键 / text 非 string / version 非 number）经 `assertCompiledShape` 漏检后，由 seam ①b 降级为**普通 ok:false**——与 D5 自述「沿 P0 三级分级哲学（畸形 ok:true → internal fatal）」自相矛盾；internal 产物劣化被伪装成调用方领域失败 | 在 S4' 守卫（或 assertCompiledShape 消费点）增补「envelope 恰四键封闭 + 四值型」检查，畸形 → `schema-compile-throw` fatal（committed:false）；seam ①b 保留为 doc-runtime 外部调用方的纵深防御 |
| A2 | MEDIUM | D7 / D1 公共契约面 | 顶层未声明键被**静默剥离**是冻结锚 15 强制的语义，但设计只登记在设计文档 D7/R1，未要求落到 SA3 将写的公共类型 JSDoc 契约面；顶层（静默丢弃）与嵌套（loud 拒绝）的不对称是调用方脚枪（typo 键名无声蒸发，ok:true 无任何反馈通道） | 要求 `ReplaceSchemaInput.root` 的 JSDoc 明示「未声明顶层键不进入新 generation；嵌套未声明键响亮拒绝」；在 CONTEXT.md 术语节登记该不对称；后续 advisory 通道另立 issue（冻结结果联合无携带位） |
| A3 | LOW | D8 / D9 fatal 后果登记 | E201（⑤-S/⑤-R/⑥）/E203（事务逃逸）fatal 时 SCHEMA/ROOT 已提交**新** generation 而 installActive 未执行 → `getActiveSchema()` 永久停留**旧** schema、`read()`/`getSchemaEnvelope()` 观察**新** generation——active 与 committed 永久撕裂。D8 只登记了 notify 失败的正向交织（tools 已装），未登记此反向撕裂 | D8/D9 增补一句登记：fatal 后 activeInfo 可能描述 stale generation，读取以 live doc 为准；SA7 动态验证面补观察点 |
| A4 | LOW | D6 ① 崩溃边界规格完备性 | D6 ① 只写明 ①a → E204；但 `projectDeclaredRootKeys` 内 `makeRefResolver` 与 `buildTopEntries` 对伪造派生物可抛 `DerivedInvariantError`（环/缺名）与非 map 形 ROOT 的裸 Error——若 SA3 的 catch 未镜像 `replace.ts prepareReplace` 的 `instanceof DerivedInvariantError → E204` 分支，伪造派生物诊断被降级为 E200 ok:false | D6 ① 显式写明 catch 镜像 prepareReplace 的 DerivedInvariantError→E204 分支（替换模块名制 E200） |
| A5 | LOW | §12 可复现性形式 | 声称「设计期实测」且贴了结果摘要与命令**形态**，但逐条命令非 verbatim、scratch「即用即删」——SA4 无法逐字重跑。SA2 已代为复跑全部证实为真，故不构成 reject 依据 | 建议（非阻断）：scratch 脚本留档 wiki 或在设计文档贴逐条完整命令，对齐 PR #188/#189 复盘立法 |
| A6 | LOW | D7 实现纪律 | `projectDeclaredRootKeys` 手写 `fields.length===1 && fields[0].name==='<key>'` 判定，而 detached-build 已导出 `recordSlotOf`（@internal，同款约定单点）——约定漂移风险 | 裁决为消费 `recordSlotOf(node)`，不复制约定 |
| A7 | LOW | D2/D3 措辞与共享名目 | ① D2 末句「若观测到 preparing + activeTools 缺失，与 write.ts S4 同款 loud fatal」易误导 SA3 在 S4' 加 schemaState 门（那将直接违反 D4/AC8——unavailable 必须放行）；② 共享 `disabled()`/`snapshotMutation` 的 issue 名目挂 RootMutationIssue，§11 未说明泛化方式（两 Result 结构同一，实际零风险） | D2 末句改为「S4' 不设任何 schemaState 门；preparing 结构不可达性由 FIFO 保证」；§11 一句话说明共享件返回形状按结构兼容复用 |
| A8 | LOW | D3 显式 undefined 裁决 | `{schema, root: undefined}` 落 `MUTATION_INPUT_NOT_PLAIN_DATA`——裁决本身已登记且与 exactOptionalPropertyTypes 一致（类型层先行拒绝），但「数据非 plain」码承载「形状」语义，诊断面略错位 | 维持裁决；建议 message 中明示「显式 undefined 值（root 的提供性以键存在性判定）」 |

**无 CRITICAL / HIGH**。总控提示的六大重点攻击面逐一核验结论见 §2。

---

## 2. 重点攻击面核验结论（总控提示逐项）

| 攻击面 | 结论 | 依据 |
|---|---|---|
| D6 组合 seam 自开事务 vs #88 E202 前置 | **成立，不可击穿**。#88 设计 §5/D6 第 3 条逐字预授权「包内组合 seam 自开 doc.transact、事务体内直接消费 buildTopEntries 产物执行 SCHEMA clear+四键重写 + ROOT clear+install、届时无需放宽 ⓪ 也无需 owner 裁决」（原文已核对，459–462 行）；seam 只被 sequencer 槽同步调用，槽外干净语境 ⓪ 实测通过；事务内误用 → E202 为**裸 Error**（实测非 branded）→ 槽内按未知异常保守 committed:true，符合 ADR 过报方向强制，且不靠 message 嗅探（#88 R2/#3 立法）。单事务原子性实测：SCHEMA clear+四键 + ROOT clear+install 同一 `doc.transact` → **恰 1 次 update**、SCHEMA/ROOT 双 identity 保持 | §7 [4]/[E202]/[E202b] |
| D7 顶层投影 vs 锚 15 / F7 张力 | **裁决被迫且正确，边界登记完整**。实测证明任何「先验证/先构造 raw」管线都无法让锚 15 转绿（validate 与 build 双双响亮拒绝未声明键 b，消息逐字核对）；⑥ 必须喂 narrowed（喂 raw 实测落 E201 变体 D——SA1 依据 3 的推论由 SA2 实证）。投影不破坏「完整最终 logical ROOT」语义的论证成立：keep-root 分支的兼容性证明本就只对声明域投影做（实测：ROOT 含未声明 live 键 extra 时 v2b 提取得 {a,n} 且验证通过——两分支对称）。残留问题是公共契约面未显式化 → A2 | §7 [1]/[2]/[A15]/[A15f]/[9] |
| D4 unavailable 恢复的状态推导 | **成立**。S4' 零读 activeTools/schemaState；成功路径 installActive 一次写齐 activeInfo（五字段直引 compile 产物）+ activeTools + schemaState='ready' + delete schemaIssue；P0 调用点该字段恒 undefined → no-op（P0 unavailable 分支不调 installActive，源码核实）；status.ts 六键零改动即满足全部冻结断言（schemaWrite=!fatal&&writableNow 在 unavailable 仍 true；rootWrite 随 schemaState 迁移自动恢复）——逐条对过冻结测试第 11/12 例断言 | p0.ts/status.ts 源码 + 冻结测试 699–734 |
| AC6 时序（install 先于 await notify） | **成立**。installActive 同步位于 seam ok 返回之后、`await notifyDirty()` 之前；notifier 挂住窗口内 getActiveSchema/getSchemaEnvelope/read 均已观察新 generation、后项 mutateRoot 未启动（FIFO + S6 同槽 await 构成屏障）。⑤-S/⑤-R/⑥ 位于事务与 install 之间——ADR「transaction 返回后立即安装」的语义锚是「先于 notify」，⑤⑥ 属 seam 第 4 步管线内（#88 契约），合规 | 冻结测试 414–464 时序逐行推演 |
| fatal 分类表完备性 | **基本完备**。compile throw / ok:false 零 issues / 畸形 ok:true → schema-compile-throw committed:false（结构上先于一切 doc 写——诚实）；branded 透传 committed/phase；未知异常（含 E202 误用）保守 true；notify 失败 true 不重试。两处缺口：A1（envelope 形状违规的分级漂移）、A3（fatal 后 active/committed 撕裂未登记） | D9 表 + §7 实测 |
| snapshotter 共享与输入形状 | **成立**。S3 复用 copyFrozen（R2 立法后的数组四查/descriptor 先于值读取次序原样）；五类负例全部命中；gate 先于快照 → disabled 路径输入零访问（Proxy 计数为 0 可满足）；形状检查（非对象/缺 schema/未知键）在快照后追加，path:[]。残留 A7/A8 措辞级问题 | write.ts 源码 + 冻结测试 634–670 |
| §12 协议假设依据 | **9/9 复核为真**（详见 §6）——包括类型层依据 6：SA2 以正确方向（接口扩展要求孪生成员可赋给设计成员）独立 tsc 验证通过；并发现反方向（设计→孪生）**不**可赋值（`unknown[]` → `ReplaceSchemaIssue[]`），冻结测试用双 as 断言故不受影响，但值得在设计文档登记一句（调用方读取 issues 需自行窄化） | §7 [TWIN] |

---

## 3. 错误处理链路审查

- **静默失败**：未发现。所有失败路径收敛为三通道之一：ok:false（issues 非空、零写入五件套）、RuntimeWriteFatalError rejection（markWriteFatal 同步先行 → status.fatal 立即可观测）、构造期 throw（入队前零副作用）。成功 = live commit + dirty 登记双信号，无「提交成功但永无登记」路径（S2 未绑定 notifier 即 loud 拒绝）。
- **状态闭环**：fatal 状态在 notifier 挂住窗口内即可观测（markWriteFatal 先于 best-effort notify）；disabled 在 S1/S2 即时返回；unavailable→ready 的状态迁移单点（installActive）且 schemaIssue 同步清除。唯一未闭环登记项 = A3（fatal 撕裂态）。
- **降级路径**：persistence-degraded / prior fatal → RUNTIME_WRITE_DISABLED + 输入零访问 + 零写入 + 队列持续流转（链尾恒绿）；degraded 不阻止 P0/read（P0 无写门，现状语义）。gate 瞬时观察（检查后降级不撤销已提交事务）与 ADR 一致。
- **虚假降级识别**：逐项筛查——①「SCHEMA 载体异型 → ok:false」不是伪降级：与 #88 冻结的 ROOT 载体异型处置（G3-3 ok:false）同族，且保留「用 replaceSchema 修复坏 doc」的可达性；读面同形态是 loud throw（projection INV-N13），族内一致。②「S4' 不设 schemaState 门」不是伪降级：AC1/AC8 明文要求。③「显式 root:undefined 拒绝」是 loud 拒绝且已登记。④**A1 是一处真实的分级伪装面**（internal 产物劣化 → ok:false），已按虚假降级处置原则要求改为 fatal loud——因其触发面仅限注入 seam/未来 vfsl 回归，降为 MEDIUM 而非 CRITICAL。

---

## 4. 协议假设依据审查（2026-06-13 立法）

- **章节存在**：§12 存在，9 条假设逐条给出依据类型与具体引用（源码行号 / 实测结果 / 既有设计法则），无「应该/通常/预计」类无据推断。
- **实测可验证性**：SA2 已全部独立复跑证实（§7）。依据 3（⑥ 必须喂 narrowed）在 SA1 处是源码推论，SA2 补上了行为实证（喂 raw → E201 变体 D，消息逐字）。依据 6 的机理描述（属性语法 + 参数逆变）正确，SA2 以接口扩展的判定方向独立验证 `TYPE-CHECK PASS`。
- **形式缺口**（A5，不阻断）：逐条命令非 verbatim、scratch 已删。复跑命令形态（`packages/namespace-runtime/` 下 `../../node_modules/.bin/tsx <scratch>.ts` 直入包内模块）经 SA2 验证可操作。

---

## 5. 红线测试思路（供 SA4 验尸 / SA7 动态补锚）

1. **A1（envelope 分级）**：seam 注入 `compile` 返回 `{ok:true, envelope:{lang,version,id,text,extra:1}, envelopeFingerprint:'x', semanticFingerprint:'x', module:{}, derived:<真实 compile 产物>}` → 断言 `replaceSchema` 以 `RuntimeWriteFatalError` rejection（phase=`schema-compile-throw`、committed=false、status.fatal 非空、0 update、0 notifier）；若落 ok:false 即 A1 未修。同理变体：text 非 string / version 非 number。
2. **A2（投影契约文档化）**：SA7 动态面向调用方做边界确认——`replaceSchema({schema: v2b, root:{n:1,a:'x',b:true}})` ok:true 后 `read(['b'])===undefined`（generation 不含 b）；`{schema: 嵌套schema, root:{inner:{x:1,y:2}}}` → ok:false 且 issue message 含「未声明字段 "y"」（实测消息已锚，§7 [2c]/[2d]）；union 形 ROOT × 未声明键 → loud 失败（R6 边界）。JSDoc 存在性由 SA4 静态核验。
3. **A3（fatal 撕裂态）**：doc 级 observer 在提交后改坏 SCHEMA 四键 → E201；断言 rejection 后 `getActiveSchema()?.id` 仍为旧 id 而 `getSchemaEnvelope()?.id` 为新 id、`read()` 观察新 ROOT、rootWrite/schemaWrite 均 false、后续写 RUNTIME_WRITE_DISABLED。此测试同时是 SA6 备注移交的「replaceSchema 自身 fatal 通道确定性锚」的落点（SA1 R2 已给出注入路径，SA2 认可无需新注 seam）。
4. **A4（E204 分支）**：seam 注入 compile 返回 ok:true 但 derived 为手造环 ref 结构 → 断言 rejection phase=`pre-commit-internal`（E204）而非 ok:false DOCRT-E200。
5. **组合事务原子性回归**（已有冻结锚，SA4 复核时留意）：真实 Persistence 下 `updates.count===1` 且崩溃注入点位于事务后 → 跨实例读不到半新半旧状态。
6. **A7（防误导）**：SA4 静态核验 schema-write.ts 的 S4' 无任何 `schemaState` 读取（grep `schemaState` 于 schema-write.ts 应零命中）。

---

## 6. §12 逐条复核结论

| # | SA1 声称 | SA2 复核 | 结果 |
|---|---|---|---|
| 1 | validate 对未声明键发 issue | 复跑，消息逐字一致 | ✅ |
| 2 | buildTopEntries 每层 map F7；缺必填不在此报 | 复跑（含嵌套层 F7 补测） | ✅ |
| 3 | ⑥ 喂 raw → E201 | SA2 行为实证：branded `post-commit-verification` committed=true，e201D「scratch 构造失败（触发类④）」 | ✅（由推论升级为实证） |
| 4 | 单事务 SCHEMA+ROOT → 恰 1 update、identity 保持 | 复跑组合事务 | ✅ |
| 5 | envelope 恰四键 + 五件套冻结 | 复跑 | ✅ |
| 6 | 签名与冻结孪生兼容 | tsc 独立验证（正确方向）；登记反向不可赋值 | ✅ |
| 7 | tx-guard 三窗口（yjs@13.6.32） | 源码核对 | ✅ |
| 8 | getMap 惰性创建零 update | 复跑（updates=0、state bytes 不变） | ✅ |
| 9 | keep-root 提取兼容性 / v3 载体错位 | 复跑，v3 消息与冻结测试 ENV3 负例逐字对应 | ✅ |

---

## 7. SA2 复核证据（命令 + 输出摘录）

命令形态：`cd /home/wangjian/nomicore-fix-issue-91/packages/namespace-runtime && ../../node_modules/.bin/tsx /tmp/sa2-verify/verify.ts`（scratch 即用即删，未入 src/test）；类型验证 `../../node_modules/.bin/tsc --noEmit --strict --exactOptionalPropertyTypes --target ES2022 --module ESNext --moduleResolution bundler /tmp/sa2-verify/twin2.ts` → exit 0。输出摘录：

```
[1]  validate raw {n,a,b} vs v2b: {"ok":false,"issues":[{"message":"未知字段 \"b\"：封闭对象不接受未声明键","path":["b"]}]}
[2]  buildTopEntries raw vs v2b: ISSUE: 快照含结构树未声明字段 "b"——拒绝静默丢键
[2c] buildTopEntries 嵌套未声明键 y: ISSUE: 快照含结构树未声明字段 "y"——拒绝静默丢键
[4]  组合事务 updates = 1 | SCHEMA identity: true | ROOT identity: true   [4c] ⑤⑥ 通过
[8]  SCHEMA 缺席 getMap → updates = 0 | bytes unchanged: true
[9]  extract v2b: {"a":"x","n":1}  [9c] extract v3: Yjs 载体错位（ROOT.a）：期望 Y.Array，实际 plain value
[A15c] 投影产物: {"n":999,"a":"x"}  [A15d] 投影后 validate: {"ok":true}
[A15e] 投影路径 updates = 1 | ROOT.n = 999 | keys: a,n
[A15f] ⑥ 喂 raw：throw branded phase=post-commit-verification committed=true DOCRT-E201: …scratch 构造失败（触发类④）…
[E202]  槽外（干净语境）⓪ 通过
[E202b] 事务内 ⓪：throw DOCRT-E202? true | instanceof DocRuntimeFatalError: false   ← 裸 Error，保守 committed:true 走线成立
[RE]  同 envelope clear+set → updates = 1
[NONMAP] compile `type ROOT = string;`: ok:false VFSL-E311 ROOT 别名非 map 形   ← E204 不可由合法编译触达
[REC] Record 形投影：{"a":1,"b":2}（原样保留）
[TWIN] tsc exit=0（孪生成员可赋给设计成员——接口扩展方向）
```

其他静态核对：`grep implements NamespaceRuntime` 全仓仅 runtime.ts:121 一处实现（§13 caller 审计声明属实）；`runtime-write-fatal-message-rev1.test.ts` 全部 toContain 子串锚（writeFatalMessage 参数化安全）；doc-runtime `public-surface-guard.test.ts` 五项必需导出 + `/^applyValidatedMutation$/` 唯一性正则不受新名影响；聚合通道 `tsc -p tsconfig.typecheck.json --noEmit` 现状恰 2 错（均为类型守卫缺失成员，与 SA6 红灯证据一致）；版本基线 namespace-runtime 0.1.2 / doc-runtime 0.1.8（§7.3 bump 目标正确）。

---

## 8. 结论

设计在六个重点攻击面上全部站得住：组合 seam 载体有 #88 逐字预授权、顶层投影是锚 15 强制的唯一通路且 ⑥ 喂 narrowed 的推论被实证、单事务原子性与 identity 实测成立、fatal 分类延续「分类权归捕获位置」且过报方向符合 ADR、snapshotter/gate 次序满足零访问断言、§12 九条依据全部复跑为真。15+1 冻结用例逐条推演均可由本设计转绿。2 项 MEDIUM（A1 fatal 分级一致性、A2 投影契约面显式化）与 6 项 LOW 为文档/规格级增补，不构成架构缺陷，**pass 放行**；M1/M2 请 SA1 于 SA3 启动前落入设计文档，A3/A4 由 SA4 按第 5 节红线思路核验。

# SA4 静态验尸报告 — issue #93 round 2（Phase 3：红灯转绿后独立静态审查）

- **Date**: 2026-08-25（round 2 Phase 3）
- **被审对象**: `git diff 151d09c...HEAD`（两 commit：526edc2 实现 + 56d38c5 T3.4 负载重标定；35 文件：8 src/doc + 20 test + CONTEXT.md + 7 wiki）
- **契约基准**: `…-rev1_design.md`（R2.1 冻结版 D-1..D-7、§10 ALLOW/DENY、§13 零回归 18+1）、`…-rev1_sa2_review.md`（R1+R2）、`…-rev1_sa6_anchor.md`（红绿总表 + T3.4 两轮偏差）
- **Verdict**: **pass**（无 MUST 级问题；3 项 LOW 观察记录不回流）

## 0. 结论速览

| 审查面 | 结论 |
|---|---|
| 设计符合性 D-1..D-7 | ✅ 逐文件对照通过（细节见 §1） |
| DENY LIST 核验 | ✅ 零触碰（§2） |
| Scope creep / blacklist | ✅ 无越界、无黑名单文件（§2） |
| 对抗性静态推演 | ✅ 无旁路、无泄漏、无消息漂移（§3） |
| 回归锚独立复跑 | ✅ 18 文件 122 用例全绿 + typecheck 七包 exit 0（§4） |
| HG#14 §1.4 触发性 | ✅ all-vitest-packages-triggered（§5） |
| 测试行为质量 | ✅ 零源码 grep 断言反模式（§6） |
| 文本质量 | ✅ 无漏网旧表述（1 项 LOW：errors.ts 头注，§7-L1） |

## 1. 设计符合性（逐文件 diff 对照 D-1..D-7）

### D-1 公共面收口（index.ts）——✅

- 值导出**恰一键** `export { RuntimeWriteFatalError } from './errors.js'`（index.ts:20）✓（§1.2）。
- 类型导出恰 **11 个**：NamespaceRuntime / NamespaceRuntimeReadResult / RuntimeReadDisabledResult / NamespaceRuntimeStatus / ActiveSchemaInfo / RuntimeWriteFatalPhase / RootMutationIssue / MutateRootResult / ReplaceSchemaInput / SchemaReplacementIssue / ReplaceSchemaResult——逐一点数与裁决 G 清单一致 ✓。
- 删除项恰两处：seam 值导出行 + `NamespaceRuntimeSeamInput` 类型 ✓；头注「公共面纪律」段与设计 §1.4 模板**逐字一致** ✓。
- seam 撤出方式：`createNamespaceRuntimeWithSeam`（runtime.ts:134 区域）与 `NamespaceRuntimeSeamInput` 保留 runtime.ts 模块级，diff 证实 runtime.ts 对二者零改动（仅 getter 门禁 + import + JSDoc）✓（§1.3）。
- 18 个测试文件 import 切换：grep 证实 `from '../src/index.js'` 的 seam 具名导入**零残留**、19 个文件经 `'../src/runtime.js'`（18 切换 + production-assembly 新建消费生产工厂）✓（§1.5）；2 个 .test-d.ts 仅类型导入零改动（name-status 证实不在 diff）✓。
- package.json 零改动（不在 diff）✓；T1.4 配置审计锚按设计落位（exports 键集恰 `['.']`）。

### D-2 三 getter 停接纳（runtime.ts + errors.ts）——✅

- **门禁位置**：三 getter 方法体首行 `if (state.lifecycle !== 'ready') throw new RuntimeReadDisabledError(<getter>, state.lifecycle)`——key **仅** lifecycle，不读 fatal/schemaState/handle；拒绝先于 `projectSchemaEnvelope(doc,'public')` / `projectMetadata(doc)` / `state.activeInfo`（getActiveSchema 不触 doc）✓（§2.2 三硬边界逐条兑现）。与设计 §2.2 伪代码逐行一致（含注释）。
- **RuntimeReadDisabledError 形状**（errors.ts:55-68）：code = 既有常量 `RUNTIME_READ_DISABLED`；message 模板 `${CODE}: ${getter} 已停接纳——Runtime lifecycle 为 ${lifecycle}（close 已停止接纳公共数据投影读取）；本调用不触碰 live Y.Doc`——与设计 §2.3 模板**逐字节一致**；插值仅来自两闭集 ✓；类不导出（index 无、无其他 re-export 通道，grep 证实仅 runtime.ts 消费）✓。
- `owner`/`namespaceId`/`read()`/`getStatus` 零改动（diff 证实仅三 getter 方法体变化）✓——身份投影/结果联合/观测面按 §2.2 保留。
- 接口 JSDoc 三 getter 追加行 + 十键注释块「read/write 与三数据投影 getter 的接纳门」句——与 §2.5 一致 ✓。
- fatal 期照常负向锚（T2.3）、closing 窗口（T2.2）、F-3 门禁先于递归（T2.4）均落位（§8 复核）。

### D-3 schema-replace 两级 fatal 制——✅

- **E204 分支逐字节保留**：sentinel catch 分支消息模板与基线 byte-equal（diff 显示该 throw 体未动，仅上方注释微调）✓。
- **E206 新分支**：消息模板与设计 §3.3② **逐字节一致**（`DOCRT-E206: replaceSchemaAndRoot 写前未知内部异常（意外抛出）：「${detail}」——非领域失败、非 DerivedInvariantError sentinel，按 internal fatal 分级（ADR-0008「未知异常保守视为」哲学；本 round 撤销资源极限例外）；唯一事务尚未开始，确定零写入（doc 状态不因本调用改变）；不补偿、不 fallback`）；`committed:false`；`{cause: err}` ✓。
- **E200 分支删除**：`DOCRT-E200: replaceSchemaAndRoot 内部错误` 消息与 return 分支不复存在；文件内残留「E200」字样全部为解释性注释（「已删除…服务各自直接调用方」）与码位说明，无活分支 ✓。
- `probeSchemaMap` 第五态 throw 注释 → E206 ✓；头注按 §3.4 重写（作用域限定句「snapshotter 前置闸只作用于 provide-root 公共面输入」在位；无虚假不变量进生产注释）✓；`@throws` 增 E206 行 ✓。
- **透传通道零改动**：schema-write.ts 不在 diff；S5 catch（:167-174）`instanceof DocRuntimeFatalError` → `rejectWithWriteFatal(env, err.committed, err.phase, err, 'schema')` 既有通道原样承接 E206 ✓。

### D-4 载体分流（projection.ts + errors.ts）——✅

- 判据次序：① `!doc.share.has('SCHEMA')` → null（双模式）；② getMap throw → **public throw `SchemaProjectionError('NSRT-SCHEMA-E2', …)` / p0 `return null`**；③ 四键投影照常。消息模板与设计 §4.3 逐字节一致（含观测异常插值与「拒绝把载体损坏静默映射为缺席 null」句）✓。
- `SchemaProjectionError` 宽化：code 联合 `'NSRT-SCHEMA-E1' | 'NSRT-SCHEMA-E2'`、构造器首参 code、name 不变、类不导出——与 §4.2 一致 ✓；E1 唯一构造点（projection.ts:102-107）加首参 `'NSRT-SCHEMA-E1'`，**message 逐字节不动** ✓。
- 头注 SCHEMA 行按 §4.5 改写（缺席/异型分流/p0 数据级收编 + runP0 catch 结构性不可达说明）✓；函数 JSDoc ② 同步 ✓。
- p0.ts 零改动（不在 diff）✓。

### D-7 plain-data.ts 原语层 + 两消费面——✅（含本轮最锋利的等价性细节）

- 五分事实 `OwnDataFact`（missing / non-enumerable∧value / accessor / undefined-value / ok）与 §7.1 类型逐字一致；`isPlainRecord`/`putPlainKey`/`yjsFamilyWord`/`describePlainValue` 为纯提取（isPlainRecord 与基线 projection.ts 副本逐字节同体；putPlainKey = 同一 defineProperty 调用）✓。
- **判据次序（关键攻防点）**：`ownDataFact` 取 **missing → accessor → non-enumerable → undefined-value → ok**，源码注释明文「accessor 先于 non-enumerable——非枚举 accessor 在数组元素面现行 violation『数组下标 accessor 不可读取』须逐字节保留，判据次序即消息面」。我独立推演五 kind × 三消费面全格等价：
  - **readableArrayElement**（数组元素面）：enumerable accessor → accessor violation（旧同）；**non-enumerable accessor → accessor violation（旧同——若 ownDataFact 把 non-enumerable 判在 accessor 之前，此格会漂移为『数组位置 undefined 不可投影』，SA3 选序正确）**；non-enumerable∧value=5 → ok(5)（旧同，不查枚举——T7.2 场景①）；**non-enumerable∧value=undefined → 『数组位置 undefined 不可投影』（旧同——R2.1 子情形，代码显式分支 + 注释）**；undefined-value → 同名 violation（旧同）✓。
  - **readableOwnDataValue**（对象键面）：missing/non-enumerable/accessor → skip（旧序 missing→非枚举→accessor→…，non-enumerable accessor 两版皆 skip，结局等价）；undefined-value → undefined；ok → ok ✓。三分 message 逐字节不变 ✓。
  - **write.ts copyFrozen**：数组 ①symbol→②names/keys→③ownDataFact 全表扫（missing/accessor/non-enumerable throw，**undefined-value 放行**）→④→⑤值读取期 throw `数组元素 undefined（index i）`——①②③④⑤ 查序逐位保留，③ 仍先于任何 `v[i]` 值读取（SA2 R2 #2 锁定面）✓；对象分支 per-key missing/accessor throw 消息逐字节保留 + non-enumerable 防御分支（消息沿 ② 全局拦截字面量，结构性不可达）+ undefined-value 维持 ⑤ 次序 ✓；产物写入 `putPlainKey(out, k, copyFrozen(...))` = 原 defineProperty 四真调用 ✓；symbol 键/names-keys 比对/单级原型判据/祖先集**留在 write.ts** ✓。
- copyMetaValue 递归体（F-3 深递归 → 原始 RangeError 路径）位置与形态不动（diff 证实仅 helper 名替换）✓。
- 头注「不统一遍历器」纪律段在位；模块零 yjs 依赖、不 import 包内模块（防环）✓。

### D-5 / D-6 测试落点（SA6 owned）——✅

- production-assembly 新建：`import { createNamespaceRuntime } from '../src/runtime.js'`，文件内 grep `WithSeam` = 0（构造哲学隔离 ✓）；Memory/File 双全链 + crash-restart + dirty 计数 + post-close getter throw（T5.1/T5.2）。
- fullchain AC5 追加 U-1..U-4 四用例（U-3 经生产工厂；U-2 durable 零写入 restart；U-4 P0 fatal 真实持久化）——与 §6.2 断言面逐项对齐。
- T3.4（ε）：DEEP=6_000 + timeout 60_000 + 程序生成非循环别名链 schema（SA6 §4-3 fixture 补全）+ 预检 + E 层吸收正则 + 零写入/fatal null/双写位 enabled + provide-root 修复尝试的**偏差锚**（诚实断言 branded rejection，见 §7-L2）。

## 2. DENY LIST / Scope Creep / Blacklist——✅

- `git diff --name-status 151d09c...HEAD` 全集 = 8 src/doc（恰 §10 ALLOW：index/runtime/errors/projection/write/plain-data/schema-replace + CONTEXT.md）+ 20 test（恰 §10 逐一列举）+ 7 wiki（白名单 `^wiki/raw/task_`）。
- DENY 逐项 grep diff 文件名：docs/adr/*、package.json、sequencer/status/close/schema-write/p0.ts、packages/persistence/**、packages/vfsl/**、TASK.md、replace/materialize/mutation.ts——**零命中**（schema-replace.ts 命中为 `replace\.ts` 正则误伤，其在 ALLOW）。
- Blacklist（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）：零命中。
- 13 个初筛「creep」文件经人工比对全部为 §10 ALLOW LIST 以 basename 形式列举的测试文件 + CONTEXT.md——提取器假阳性，无真实越界。

## 3. 对抗性静态推演——✅ 无漏洞

1. **三 getter 门禁旁路**：`projectSchemaEnvelope` 全仓 caller 仅两处——runtime.ts:212（public，门禁后）与 p0.ts:91（p0 模式）✓ 无未门禁公共通道；`owner`/`namespaceId` 构造期冻结身份投影（设计 §2.2 明示不在停接纳面）；`read()` 走既有结果联合（diff 零触碰）；`getStatus` 完全不动（status.ts 不在 diff）。
2. **类身份泄漏审计**：`RuntimeReadDisabledError` grep 全仓仅 errors.ts 定义 + runtime.ts 消费；index.ts 零导出、无其他 re-export——公共面唯一获取通道是 throw 出的对象本身（code+message 字符串消费，与 ConstructionError/CloseError 先例一致）✓。
3. **E206 cause 不进公共 message**：`rejectWithWriteFatal`（write.ts:198-216）构造 `RuntimeWriteFatalError(phase, committed, writeFatalMessage(slot, phase, committed), {cause})`——`writeFatalMessage` 恒定模板（errors.ts fatal 文案注释明文「不插值原始异常」）；E206 的「${detail}」插值只存在于 DocRuntimeFatalError.message（doc-runtime 层证据引用惯例）并经 `cause` 零损失保留 ✓。
4. **p0 分支 return null 真不可 throw**：p0 模式下 projectSchemaEnvelope 的可抛面仅 ② 异型分支（该分支 p0 return null）——E1 值域守卫 p0 模式键省略不 throw、① 缺席 return null；runP0 的 ③ 之后可抛点（assertCompiledShape/零 issues 守卫）与载体态无关 → `NSRT-FATAL-P0-INTERNAL` 对载体异型结构性不可达 ✓（p0.ts 零改动佐证）。
5. **契约改动涟漪（技能 §1.6）**：三 getter 新 throw 路径的生产 caller = **零**（grep apps + packages/*/src 证实）；测试 caller 唯一 post-close 面已按 §9.3 改锚。`replaceSchemaAndRoot` 唯一消费方 schema-write.ts:162 位于 try/catch 内、branded 透传 + 未知保守 committed:true 双分支 + sequencer 链尾消化——无 unhandled rejection 面 ✓。
6. **ownDataFact 等价性**：见 §1-D-7 全格矩阵（含 non-enumerable accessor 的选序攻防——SA3 处置正确且有注释锚定）。
7. **T3.4 深度边际**：6_000 对 extract ~2_000 / clear ~2_200 阈值 3×/2.7× 边际，±100 漂移带内安全；CI matrix node [20,24] 与标定环境（Node 24）同族栈容量量级——若未来引擎栈容量 ×3 级变化需重标定（测试注释已含标定数据，LOW 不回流）。

## 4. 回归锚独立复跑（setsid nohup 后台纪律）——✅ 全绿

| 批次 | 命令 | 结果 |
|---|---|---|
| 批 1（13 文件：snapshotter-array / boundary-supplementary(F-3) / write-fatal-message-rev1 / replace-schema-sa7-dynamic(A4 γ + T3.4) / materialize-root-rev2(E200) / degraded-two-adapter / metadata-proto-key(T7.2) / close-lifecycle / schema-carrier-split / production-assembly / exports-audit / fullchain / public-surface-ownership） | `npx vitest run --typecheck <13 files>` | **13 文件 86 用例全绿，Type Errors no errors，exit 0**（/tmp/sa4-anchors.log） |
| 批 2（p0-sequencer / sync-read-face / 两 .test-d.ts type-guard / doc-runtime extract-yjs-snapshot） | 同上 | **5 文件 36 用例全绿，Type Errors no errors，exit 0**（/tmp/sa4-anchors2.log） |
| typecheck | `pnpm typecheck` | **七包 exit 0**（/tmp/sa4-typecheck.log） |

§13 关键锚独立复核：#1 snapshotter 四查 ✓、#2 F-3 原始 RangeError（ready 期）✓、#3 fatal message rev1 ✓、#4 A4 γ sentinel→E204 ✓、#10 unavailable/preparing 期 getter 照常（T2.5 保留锚）✓、#13 meta proto-key 四真 + T7.2 双场景 ✓、#14 materialize-root-rev2 E200 面零回归 ✓、#15 degraded 双 Adapter ✓、#18 类型面双 guard ✓、#19 T3.4 E 层吸收新锚 ✓。与总控 verify-rev1b（92 文件 1118 用例全绿）交叉一致。

## 5. HG#14 §1.4 触发性自检——✅ all-vitest-packages-triggered

- 本轮新增/改动的全部 `*.test.ts`（含新建 production-assembly / schema-carrier-split）位于 `packages/namespace-runtime/test/`，包名 `@nomicore/namespace-runtime`。
- `.github/workflows/ci.yml`（matrix node [20,24]）Test job = `pnpm test` → 根 `vitest run --typecheck`，vitest.config.ts include `packages/*/test/**/*.test.ts` + typecheck include `packages/*/test/**/*.test-d.ts`——**本包全部测试文件落在 CI glob 覆盖内，无未接通包**。
- 执行证据链（三重）：SA6 锚定跑（逐文件 + --typecheck，§3）→ SA3 转绿跑 → 总控 verify-rev1b 全量（92 文件 1118 用例）→ **本 SA4 独立复跑**（18 文件 122 用例 + 七包 typecheck）。结论标记：**all-vitest-packages-triggered**。

## 6. 测试行为质量（技能 §1.7 源码 grep 断言禁令）——✅

- 20 个触碰测试文件扫描 `readFileSync + toMatch/toContain` 反模式：**零命中**。
- exports-audit 的 readFileSync 用例为 **package.json 配置审计**（JSON.parse 后断言 exports 键集——设计 T1.4 明文指定形态「配置审计非源码文本审计」），非源码字符串断言；其余断言全部为运行时模块导出探测 / throw code+message / 生命周期窗口观察等行为断言。
- 红灯红因（SA6 §1.1 逐字摘录）与契约缺失一一对应；T7.2 场景②伪红（SA2 R2.4-A 建议的空描述符对既有下标不生效）被 SA6 实测发现并当场修正登记——红灯纪律可信。

## 7. LOW 观察（记录，不回流）

- **L1（文档漂移）**：errors.ts 头注 :6 括注「公共入口只暴露 seam 构造器与类型」在 D-1 后失实（现行公共面 = 恰一键值导出 + 11 类型，seam 已撤出）。该头注为既有文字、不在设计 §10 明令修订范围（errors.ts 仅要求类追加），index.ts 权威头注正确且相邻——LOW，建议未来顺手轮修正。
- **L2（T3.4 修复面语义，SA6 已登记偏差）**：6_000 深 doc 上 provide-root 原地修复因 yjs `ROOT.clear()` destroy 递归溢出得 branded rejection（committed:true）——「修复通道开放」在运行时级成立（fatal null + 双写位 enabled 已断言），doc 级原地修复该深度不成立（带外重建为正确形态，设计 §3.2.3.4 已含该分支）。偏差锚诚实断言真实行为并登记于 sa6_anchor §4-1——无需处置。
- **L3（fixture 形态）**：T3.4 沿用 fake-handle 夹具而非设计字面「→ createDoc」——SA6 §4-3 形态注已登记（全部断言为 runtime 公共面可观测行为、无持久层参与），等价性成立。

## 8. 动态审核重点（交 SA7）

无 MUST 级新增面。可选动态确认两点：(a) CI node 20 matrix 上 T3.4 双相（E 层吸收 + clear 溢出）触发确定性（标定在 Node 24，20 为同族栈容量量级，预期稳定）；(b) File 面 U-2/U-3 restart durable 断言在真实 CI 磁盘环境下复现（本地已绿）。

— SA4（Red Team），round 2 Phase 3

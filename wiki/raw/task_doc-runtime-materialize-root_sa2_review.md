# SA2 攻击评审报告 — materializeRoot 设计（issue #74）

**Date**: 2026-08-22 19:52
**Verdict**: **pass**（附 3 条 MINOR 修订要求，建议 SA1 在 SA3 开工前顺手落实；均不阻塞放行）

- 评审对象：`wiki/raw/task_doc-runtime-materialize-root_design.md`（SA1，907 行）
- 行为锚点：`packages/doc-runtime/test/materialize-root.test.ts`（SA6 冻结 13 用例，未收窄）
- ADR 基准：`task_doc-runtime-materialize-root_relevant_decisions.md`（ADR 0007 直接上游；0001/0002/0003/0006 间接）
- 评审方法：全新视角通读设计 → 逐条对照源码（carrier.ts / extract.ts / validate.ts / xml.ts / evaluate.ts / shapes.ts / derived.ts）→ 独立复跑实证（红灯基线 + SA1 原型 T1-T14 + 9 项 yjs 行为假设自证）→ 多维漏洞扫描

## 评审前独立验证证据（SA2 自跑，非转抄设计）

| # | 命令 | 结果 | 核验对象 |
|---|---|---|---|
| V1 | `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts` | `Test Files 1 failed / Tests 13 failed (13)` | SA6 红灯基线未被破坏（§1.3 声明属实） |
| V2 | `node_modules/.bin/tsx /tmp/sa1-proto-materialize.mjs`（worktree: packages/doc-runtime） | T1–T14 全部输出与设计 §11.3 **逐字吻合**（含 T4 `目标 ROOT 非空`、T7 `threw="observer-boom" updates=1`、T11 五组 XML、T14 空 ROOT） | 设计附录 B 实测声明真实可复现 |
| V3 | SA2 自写脚本 `/tmp/sa2-verify.mjs`（node v24 + yjs@13.6.32） | A9 `threw=observer-boom updates=1 title=t`；A10 `getMapThrew=true stateUnchanged=true`；B15 `state 2→2 bytes, updates=0`；A19 `storedIsSameRef=true`；A12 `alt="an "alt" & <tag>"`（截断实证）；B2 `updates=0`；A20 NaN 可存；B7 嵌套 detached 单事务 `updates=1` 且集成后可读；A4 detached `keys=[]` | P2/P3/P4/P5/P6/P10/P11/P12/P15/P16 独立复证 |
| V4 | 源码逐行比对 | validate.ts unknown 恒接受（L460 区）/ present()（L158）/ isPlainObject 无原型检查（L153）/ Record `'<key>'`（evaluate.ts:107）/ 封闭对象未知键拒绝 / ISSUE_LIMIT=100+截断+E100 顶层收编 / xml.ts 属性值引号到引号字面量+实体宽松（L9-10, L77-81）/ E311 全 map 形联合（shapes.ts:622-639，clsOf synthesize）/ carrier.ts probeRoot 四级级联与 `{carrier,map}` 形状 / extract.ts makeRefResolver 位于 L229-251 | §1.3 现状盘点与 D3/D8/D9 的事实基础全部属实 |

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | MINOR | §4.3 `rootEntries` 联合分支：**注释与伪代码自相矛盾** | 注释写「非 map/union 成员**跳过**」，但按伪代码结构，`rootEntries(member)` 对非 map/union 成员（如 array/leaf）会落到函数末尾 `throw new Error('ROOT 结构节点非 map 形…')` → E200，而非跳过后继续试验下一成员。触发条件：手造派生物的 ROOT 联合含非 map 形成员（合法 derived 被 E311/shapes.ts:637 的 clsOf-synthesize 挡死，仅手造可达）。影响：同一输入类存在两个都「响亮」但 issue 形态不同的冻结规格（E200 vs F6），SA3 照注释或照代码实现产生可观测分歧——规格漂移地雷 | 一句话修订：删除「非 map/union 成员跳过」注释，明示「非 map/union 成员 → throw → E200（对齐 B11 手造派生物 loud 边界）」。代码语义（throw）本身正确，注释错 |
| 2 | MINOR | §4.4 D5 / F6：union 全拒时**丢弃成员级失败细节** | extract 的 `walkUnion`（extract.ts:162-168）全拒时报告「声明序首个真 issue」（保留错位词/键名）；materialize 的 F6 模板只报 `N 个成员的结构形状均不符`，首个失败成员的形状词/未声明键/域违规词全部蒸发。触发条件：union 全拒（对抗输入或结构-值树错位）排障时。影响：纯诊断质量——F6 path 锚定 union 节点但 message 无差异线索，SA7/用户排障要多走一轮。非正确性问题（fail-fast 单 issue 契约不破） | F6 message 追加首个成员 issue 摘要：`联合节点无可构造成员（{path}）：{N} 个成员的结构形状均不符（首个失败：{word/键}）`——与 extract 的「首真 issue」纪律对称 |
| 3 | MINOR | §11.2 附录：B 段断言脚本未内联全量 + 原型脚本仅存 /tmp | 附录 A 只内联 A 段节选与 U-unknown 段；B1-B15 的脚本「按 §11.1 表逐行可重建」但无逐条文本；`/tmp/sa1-*.mjs` 重启即失（设计自述不落仓）。影响：SA4 静态门禁重跑时需自行重建 B 段脚本——所幸 B 段输出已内联、A 段模板单行化明显、且本次 SA2 已独立复验 9 条关键假设（见 V3），故降为 MINOR | 二选一：(a) 在 §11.2 补一张「B 段断言 ↔ A 段模板行」的一行式映射表；(b) 明示 B 段关键断言（B1/B2/B3/B7/B12/B15）由 SA1 在 SA3 完成后并入 SA7 活链路验证清单重证。不得留「同法可重建」的口头承诺 |
| 4 | INFO（登记，非缺陷） | 设计新增的响亮行为无冻结测试覆盖 | NaN/Date@map/Y.Map@unknown 拒绝（T9）、XML attr 双引号拒绝（T11-5）、Record `'__proto__'` 键（T10）、union ROOT（T12）、E200 手造派生物（B11）均为设计新增行为，SA6 冻结 13 用例不覆盖。这不是设计缺陷（SA6 契约允许「仅可补充」），但活链路回归面为零 | 转入下方「红线测试思路」→ SA7 阶段落 IT；不要求本任务扩测试文件（test 文件 SA6 owned 冻结） |

未发现 CRITICAL / MAJOR 级漏洞。关键攻击面逐一核销：

- **竞态/TOCTOU**：①②③④ 同步顺序执行，JS run-to-completion 封死 y-protocols 远端 update 插入窗口；③ 与 ④ 之间无任何可触发 observer 的调用（getMap 惰性创建零事件，B15 已自证）。对抗 Proxy 双读发散已预落文（B10：构造以自身读到的数据为准，垃圾形状/域违例响亮单 issue，E200 兜底）——处置正确且非伪降级（Proxy 属契约外输入，见「虚假降级审查」）。
- **状态撕裂**：④ 单 `doc.transact` = 单 update 单元（V3 B7 复证：嵌套 detached 子树 + plain 混装一事务 `updates=1`）；不存在「部分构造落 doc」路径（② 全 detached，失败即弃垃圾）。
- **极端输入 crash**：深嵌套 → RangeError → ② catch → E200 单 issue；对抗 getter/Proxy 抛出 → E200；`doc` 非 Y.Doc → probeRoot 抛 → E200。④ 事务体内无可抛载荷（copyJsonDomain 产物 + detached 类型 set 不抛，A19/A6 实证），唯一抛源 = observer/引擎缺陷 → INV-5 原样外抛（V3 A9 复证：`threw=observer-boom, updates=1, title=t`）。
- **Feature 契约污染**：公共面纯新增（index.ts +2 行导出）；extract.ts 仅 makeRefResolver 纯移动（48 绿用例回归锚）；carrier.ts/vfsl/persistence 零触碰（DENY LIST 与 §1.3 一致性自检吻合）。接口签名 `materializeRoot(derived, snapshot: unknown, doc): MaterializeResult` 与 SA6 冻结接缝逐字一致，无收窄。
- **AC-1~AC-6 ↔ 冻结锚点**：§5 映射表 13 行逐条核对成立（U1 引用透传使 `toEqual` 平凡成立；U6 键集由快照键迭代天然满足；U8 单事件；U13 `toThrow`+1 update+值落盘）。D6 六词域与 extract copyPlainValue（extract.ts:261-308）逐词对齐，INV-9 两侧同表。
- **ADR 合规**：0007 编排顺序/零写入/不覆盖不合并不 fallback/observer fatal 语义（D1 的「原样抛出」诠释与 AC-6 冻结行为一致）；0003 ROOT map 形（rootEntries throw 分支）/载体词表/ref 不内联；0006 只写 ROOT（probeRoot 单点触碰）；0002 三步管线；0001 SCHEMA 零接触。

## 协议假设依据审查

- **章节存在性**：✅ §11「协议假设依据 (Protocol Assumption Evidence)」存在，P1–P18 十八条假设逐条登记（依据类型/内容/风险），无 HTTP/端口/进程级假设（全部为 yjs 库行为假设——与任务性质相符）。
- **依据可验证性**：✅ 全部标注「实测」且附录 A 内联可运行脚本 + 关键输出（2026-08-22，node v24.13.0，yjs@13.6.32）；SA4 可重跑。SA2 本次独立复验 9 条（V3）+ 原型 T1-T14 整体重跑（V2），全部吻合——依据不是「应该/通常/预计」类无据推断。
- **瑕疵**：仅攻击点 #3（B 段脚本未逐条内联）——因输出已内联且 SA2 已代为复验，不构成 reject 依据，按 MINOR 修订要求登记。

## 错误处理链路审查

本对象为库函数（无 UI/网络依赖），按库语义四查：

- **静默失败**：无。所有失败路径产出结构化 issue（F1 完整透传 / F2-F9 恰 1 条、message 非空、path 锚定）或原样抛出（F10）；不存在「无返回值信号 + 无异常」的路径。B12 空 entries → `ok:true` + 0 update 是**正确语义**（空快照物化 = 合法零写入，U5 延伸），非静默失败。
- **状态闭环**：`{ok:false}` 恒携带 issues（F1-F9）；`ok:true` 恒表示 ④ 已提交（或合法空事务）。observer 抛错路径不产生伪 ok（④ 零捕获，异常离开函数体）。
- **降级路径**：无任何 fallback。B1-B12 对照表逐条把「merge/overwrite/部分安装/Date 投影 `{}`/NaN 顺手存/内嵌 Y 集成/attr 转义尽力而为/observer 吞错/union 兜底成员/未声明键跳过」全部判响亮拒绝——与 ADR-0007「不覆盖、不合并、不 fallback」逐条对齐。
- **虚假降级识别**：✅ 无伪降级。逐一拷问：
  - `undefined` 值键跳过（present 惯例）：validate/extract/materialize 三方同语义（undefined=缺席，JSON 序列化本就丢弃），非 bug 掩盖；
  - B12 空 entries ok:true：空 ROOT 的正确物化语义，非前提缺失；
  - union 成员声明序 first-fit（重叠成员时载体选择随声明序）：ADR-0003 any-of「重叠成员不构成错误」的冻结语义，且与 extract 试验序对称（往返一致，T12/T13 实证）——不是降级是规格；
  - unknown 位 NaN/bigint/Date 拒绝（F5）：设计把它从「静默可存」（A20 实证 yjs 存得下）翻转为响亮拒绝，恰是**反**伪降级的标杆处置（INV-9：写读域对称，否则产出 extract 永远读不回的脏文档）。

## 红线测试思路

> 冻结 13 用例之外的补充 IT（建议 SA7 活链路阶段落，SA6 文件已冻结不扩）；每条对应上文攻击点或设计新增响亮行为。

1. **（对应攻击点 #1）** 手造派生物：`derived.structure.node = {kind:'union', members:[{kind:'array',...}, legitMap]}` → 断言 `ok:false` 恰 1 条且 message 含 `DOCRT-E200`（throw 语义）或 `联合 ROOT 无可构造成员`（skip 语义）——**先由 SA1 定谳修订，再按定谳断言**；两侧不可混。
2. **（对应攻击点 #2）** union 全拒快照（如 `AssetEntity` 位放 `{kind:'image', url:1}`——三成员均拒）→ 断言单 issue message 含首个失败成员的差异词（修订后生效）。
3. **（值域可达性，§2.2）** `type ROOT = { u: unknown; arr: unknown[] }` + 快照 `{u: 10n, arr:[undefined]}` → 断言 `ok:false` 恰 1 条（F5 bigint/undefined）+ 0 update + state 逐字节不变 + `validateLogicalSnapshot` 直调 `ok:true`（锚定「宽域校验 × 窄域构造」的不变式不被未来回退）。
4. **（NaN number 位）** `type ROOT = { n: YLeaf<number> }` + `{n: NaN}` → ① `ok:true`（typeof NaN==='number'）→ materialize `ok:false` 单 issue `non-finite number` + 零写入。
5. **（Date @ map 位）** `type ROOT = { d: unknown }` + `{d: new Date(0)}` → 单 issue 含 `constructor: Date`（B3 反投影）。
6. **（XML attr 双引号，D7 规则 3）** `type ROOT = { body: YXmlFragment<{}> }` + `<img alt='an "alt"'>` → ① `ok:true`（单引号值内 `"` 合法）→ materialize F8 单 issue + 零写入——锚定「校验通过的串仍可被构造期响亮拒绝」的域分离。
7. **（Record `__proto__` 键）** `Record<AssetId, unknown>` + `{'__proto__': 'v'}`（Object.defineProperty 造 own 键）→ 物化成功 + `root.keys()` 含 `__proto__` + extract 回读键值正确（T10 行为锚）。
8. **（union ROOT，T12）** 全 map 形联合 ROOT 两成员 → 各自快照分别物化成功、键集正确。
9. **（多键 ROOT + observer 中途抛错，INV-5 深水区）** ROOT 两键 + observer 在首键后抛错 → 断言 `toThrow` + update 恰 1 次 + **部分键已落盘**（不清理、不回滚）——13 用例只覆盖单键，此测试锁死「不事后清理」承诺。
10. **（嵌套事务，B12/P13）** 调用方先 `doc.transact(() => materializeRoot(...))` → 外层单 update 提交、`ok:true`。

## 结论

设计在最高危的三个架构点（崩溃边界切分 D1、往返域对称 INV-9、方向不对称 D9）上均给出可实证的强方案；全部协议假设有实测依据且经 SA2 独立复验；13 用例锚点无收窄；ADR 0001/0002/0003/0006/0007 逐条合规；无伪降级、无静默失败、无契约污染。3 条 MINOR 修订要求（注释矛盾 / F6 诊断细节 / B 段脚本可复现性）建议 SA1 修订登记后即可放行 SA3 实现——**verdict: pass**。

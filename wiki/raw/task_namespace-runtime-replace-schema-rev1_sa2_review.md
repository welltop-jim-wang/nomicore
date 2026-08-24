# SA2 攻击评审报告 — replaceSchema provided-root 静默投影偏差修复（issue #91 round 2 / rev1 设计）

**Date**: 2026-02-20（round 2 修订轮）
**Verdict**: **pass**
**被审对象**: `wiki/raw/task_namespace-runtime-replace-schema-rev1_design.md`（SA1 修订设计）
**约束基准**: `task_namespace-runtime-replace-schema-rev1_relevant_decisions.md`（ADR 0008 §SCHEMA write 第 3 条 / 失败语义 :75 / 单序列器槽序 :45 / 快照时点 :43；ADR 0007 底层决策经 0008 :111 沿用；CONTEXT.md 封闭对象 :90-91 / 零写入 :81-82）

---

## 审查方法与验证证据

全新视角独立复核，非背书式通读。对设计全部承重论断逐条回源验证（命令 + 结果）：

| # | 验证项 | 命令 / 出处 | 结果 |
|---|---|---|---|
| V1 | R2-1 红灯在当前代码真实红（设计前提成立） | `./node_modules/.bin/vitest run --no-typecheck packages/namespace-runtime/test/runtime-replace-schema-sa7-dynamic.test.ts packages/namespace-runtime/test/runtime-replace-schema-sequencer.test.ts` | **1 failed（R2-1，sa7-dynamic:461 `expected {ok:true} to match {ok:false}`）\| 21 passed**——与 SA6 记录（简报 :88-95）一致 |
| V2 | D2 `narrowed` 无外部引用、类型模块私有 | `grep -rn "narrowed" packages/` → 仅 schema-replace.ts :89/:128/:170/:188；`index.ts:23-24` 只导出 `replaceSchemaAndRoot`/`SchemaReplaceInput`/`SchemaRootPlan` | ✓ 更名无公共面影响，字段保留（ready 载荷携带）是既有模式 |
| V3 | D3 同族先例 | `replace.ts:106` `verifySnapshotIntact(derived, snapshot, doc)`——snapshot 即 caller 原样入参，prepare ①② 同源消费 | ✓ 先例属实，两 seam ⑥ 喂值纪律归一 |
| V4 | validate 结构盲（E204 论证前提） | `vfsl/validate.ts:4-6` 头注 + `:649-651` `interpret(derived.values, derived.values['ROOT'], snapshot)`——全函数只读 `derived.values` | ✓ γ 假派生物只污染 structure/aliases（test :346-350），values 为真编译产物 → validate 对 `{n:999,a:'x'}` ok:true 通过 |
| V5 | E204 可达链 | `detached-build.ts:46`（root 检查）→ `:51` `makeRefResolver` → `rootEntries:65` `resolve(node)` → `resolve.ts:25` inFlight 环守卫（**先于** memo 命中 :26）`throw DerivedInvariantError` → `schema-replace.ts:190-203` catch instanceof → E204 pre-commit-internal committed:false | ✓ 与修订前同一 catch、同一 phase/committed、同一 cause 链；γ 用例（sa7-dynamic :333-389）全部断言保持 |
| V6 | 顶层未声明键 path 语义 | `validate.ts:573-578` 封闭对象未知键 `ctx.emit([...path, k])`，顶层基点 `[]`（`:602`）→ path=`['b']`，message 含 `"b"` | ✓ 满足 R2-1 断言（path.length===1 && path[0]==='b'）；validate 先于 build（D1 次序），validate 首发 |
| V7 | 零回归清单逐项核对 | 见下「零回归清单复核」 | 14 项处置全部成立，无漏项 |
| V8 | ALLOW/DENY 完备性 | `grep -rn "replaceSchemaAndRoot\|replaceSchema(" --include="*.ts" packages apps domains`（排除测试）→ 生产 caller 唯一 `schema-write.ts:161`；`replaceSchema(` 测试侧仅 4 个已知文件；`grep -rn "顶层声明域投影\|静默剥离" docs/ README.md TASK.md` → 零命中；两包无 CHANGELOG 文件；版本现值 0.1.9 / 0.1.3 | ✓ caller 审计无遗漏，文档面无残留，bump 目标正确 |
| V9 | 快照不可变前提 | `write.ts:246-353` 受控 snapshotter 递归冻结复制；`vfsl/index.ts:34/:278-298` compile 五件套深冻结 | ✓ D3-2 的「合规调用者不可变」成立 |
| V10 | S5 失败链路闭环 | `schema-write.ts:174` `if (!result.ok) return {ok:false, issues}`——先于 `installActive`（S5.5）与 `await notifyDirty()`（S6） | ✓ R2-1 的 0 notifier / active 不变 / 非 fatal / schemaWrite 仍 enabled 由现有结构天然满足 |

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | MINOR | D3 恒等式论证作用域 | 「成功路径 raw ≡ narrowed」对**合规调用者**（namespace-runtime 路径：snapshotter 递归冻结 + compile 深冻结，V9 已证）成立，我逐向量核验：map 全声明形、Record 形（旧投影 :323 本就整段返回）、union 形（:322）、非 plain 输入（:325-326）、undefined 值（`present()`=hasOwn&&≠undefined，validate.ts:158；mapEntries :153 skip；⑥ 只比 extract 产物）、null 原型对象、`__proto__` own 键、枚举序——全部恒等。**但** doc-runtime 直调路径（①b 登记的信任边界）的调用方可传未冻结 getter/Proxy snapshot：旧投影的拷贝顺带把顶层「双读发散」物化收敛（三消费者读同一拷贝），新管线三处重读原引用。发散结局仍 loud（install-verify.ts:124-125 既有哲学：scratch 侧 issue/throw → E201 变体 D；build 发散不抛 → (3) C 支）且嵌套层同向量在旧代码本就暴露（投影只拷顶层、嵌套值按引用透传）——**无静默失败、零写入承诺不破、非回归**。设计 D5 对 :45-47 的替换文案已写「scratch 确定性重放」，建议补半句显式作用域：「确定性以输入可重读为前提（冻结 plain 数据）；对抗性双读发散由 ⑥ E201-C/D 收编（与嵌套层同向量同哲学）」，防 SA3/SA4 把恒等式读成无条件 | 设计补一句作用域声明（注释层），无需结构改动 |
| 2 | MINOR | §3/§4#11 fatal 分类「保持」的精确边界 | 环 ref derived × **域非法 root** 的组合输入：旧管线投影内 resolver 先掷 → E204；新管线 validate 先行 → `ok:false` 域失败。两者皆零写入、皆 loud、该组合无任何现存测试（γ fixture 用合法 root，不受影响——V4/V5 已证）。这是「更廉价的检查先报告」的优先级翻转，方向合理（域失败比 internal fatal 信息量更高、且不触发永久禁写），但 §4 #11「fatal 三分类…保持」严格说只对 γ fixture 输入类成立 | §4 #11 加作用域注「以 γ fixture（合法 root）为限；组合非法输入下域失败优先于 E204 报告，两者皆零写入」；可选补一条特征化测试（见红线思路 T2） |
| 3 | NIT | SA6 已暂存测试注释的废止 D7 残留 | sa7-dynamic `:69`「顶层节点 kind=union → D7 不投影」、`:514` 用例标题「A2-union 不投影」、`:527`「（D7 边界登记）」仍以被废止的 round-1 D7 为论据（行为结论——union 形 loud——在新管线下自然成立，与 D7 无关）。`:437-438` 描述废止本身、无碍 | SA3 按 §7 ALLOW LIST 的「可同步注释措辞」授权顺手清理，非阻塞 |
| 4 | NIT | §3 引文精度 | 环守卫消息写成字面 `DerivedInvariantError('结构 ref 环（SA7CYC）')`，实为模板 `` `结构 ref 环（${cur.name}）` ``（resolve.ts:25），SA7CYC 是 γ fixture 别名。无实质影响 | 无需动作（SA4 复核时按行号定位即可） |
| 5 | NIT | §6.1 门禁背书失准 | 「tsconfig.typecheck.json 含 noUnusedLocals 语义时」会报未用导入——本仓 tsconfig 全集（base/typecheck/packages/*）均未设 `noUnusedLocals`（已核），三道门禁**都不会**拦截 D4 遗漏的未用导入。D4 清理正确但无门禁背书 | SA4 静态核对改用 grep（见红线思路 T5），勿依赖编译器报错 |
| 6 | INFO | 新契约的 seam 级测试覆盖 | R2-1 仅经 namespace-runtime E2E 锚定；doc-runtime 直调 `replaceSchemaAndRoot` 的未声明顶层键 → `ok:false` path=[k] 无 seam 级用例（①b 纵深防御定位下的直接受益方）。persistence/type-guard 零影响已证（V8） | 可选加固（本票或后续票）：补 doc-runtime 直调用例（见红线思路 T6） |

**无 CRITICAL / MAJOR 级发现。** 六个攻击点全部为文档精度 / 测试加固类，不影响设计的正确性、ADR 合规性与最小 diff 结构。逐攻击面结论：

- **D2 更名处置**：正确（V2）。字段不删、语义翻转、模块私有、无残留引用；diff 最小且类型层无法从 ready 窄化 input.root 的论证属实。
- **D3 恒等性**：成立（V3/V9 + 攻击点 #1 的逐向量核验）。round-1「必须喂 narrowed」的前提（validate/build 消费 narrowed）确随投影废止消失；单形态纪律使三消费者同引用，⑥ 喂原样是 prepare-build 的确定性重放；与 replace.ts:106 姊妹 seam 对齐消除包内双纪律。
- **E204 γ 可达性**：成立（V4/V5）。validate 结构盲、buildTopEntries 内环守卫掷 `DerivedInvariantError`（非裸 Error、非别的分类）、落点同一 catch；「非 map 形」裸 throw → E200 的分类不变；throw 源类别集合净变化论证（同类同源 makeRefResolver）属实。
- **零回归 14 项**：无漏项（V7，明细见下节）。controller 点名的三处：⑥ E201-D 通道——schema-replace 无既有 E201-D 专项测试（doc-runtime 侧 materialize-rev2 测试不涉本 seam），新管线下该通道仅对抗性发散可达、结局 loud，无测试回归；.persistence 集成测试——:129/:185 root 均为 ENV2 全声明 `{n,a,b}`，恒等映射下零影响；persistence.test.ts 行为——E2E 断言（跨实例读回新 SCHEMA+ROOT）只依赖全声明幸福路径，保持绿。
- **ALLOW/DENY**：完备（V8）。生产 caller 唯一、导出面验证、docs 无同类表述、round-1 档案不改写的处置与简报 :51 一致、REPORT.md 总控专属边界一致。

### 零回归清单复核明细（设计 §4 十四项逐条）

1. keep-root 零触碰 ✓（D1 只动 ①d replace-root 分支；ADR 0008 第 2 条提取投影仅限 keep-root 的读取正确）
2. ⓪①a①b①c 零触碰 ✓（D1 代码块从 `input.root.snapshot` 起）
3. ② 事务体零触碰 ✓（消费 ready 载荷；entries 构造源 narrowed→raw 对到达 ② 的输入恒等）
4. ③⑤-S / ④⑤-R 零触碰 ✓（verifySchemaFourKeys / verifyInstall 均不消费 snapshot）
5. ⑥ 喂值换原样语义保持 ✓（攻击点 #1 作用域注）
6. 嵌套 loud 恒等 ✓（旧投影只动顶层 :330；A2-嵌套用例实跑绿）
7. union loud 恒等 ✓（旧 :322 整段返回；A2-union 实跑绿）
8. Record 形恒等 ✓（旧 :323 整段返回）
9. 幸福路径保持 ✓（persistence :47/:129/:185、sequencer :429/:549/:618/:756/:790、sa7-dynamic :217/:363/:416/:566/:611 全部全声明输入——我逐 call site 扫描，V8）
10. 槽序/快照时点零触碰 ✓（R2-3 修订后输入 `{n:1,a:'x'}` 对槽起点 ns-2b 全声明，快照时点断言原样，实跑绿）
11. fatal 三分类保持 ✓（以 γ fixture 为限——攻击点 #2）
12. E202 不变 ✓（⓪ guard 位置不动）
13. `__proto__`/present 惯例 ✓（validate `Object.keys`+present、mapEntries own 数据属性遮蔽（T10 锚）、copyJsonDomain defineProperty :211 三方一致；少一个拷贝点）
14. 全量门禁 ✓（SA6 全量对照 76 files/1021 tests 仅 R2-1 一败；我聚焦复跑 V1 一致）

## 协议假设依据审查

- **§8 章节存在** ✓，声明「无协议级假设」——属实：纯 TS 修订 + JSDoc/术语文档，无 HTTP/WS/端口/进程时序/第三方库行为假设。
- 三条行为级论断全部给源码引用且我逐一复核为真：validate 结构盲（validate.ts:4-6，另经 :649-651 只读 `derived.values` 交叉证实）；顶层未知键 path=[k]（validate.ts:573-578 + 嵌套同族先例 sa7-dynamic :486-512 实跑绿）；γ E204 可达（detached-build.ts:46/:51/:65 + resolve.ts:25-33 源码追踪 + SA6 设计期红绿对照）。
- 无「应该/通常/预计」类无据推断；无声称实测却缺命令输出的条目（SA6 红灯实跑证据在简报 :84-95，命令可重跑——V1 已重跑复核）。
- **结论：PASS**。依据可被 SA4 静态验证（行号可定位、命令可重跑）。

## 错误处理链路审查

- **静默失败**：本修复的对象正是教科书级静默失败（笔误键剥离 + `ok:true` 无反馈 → 永久数据丢失）。修订后失败面 `ok:false` + path 定位该键（V6）；未发现新增静默路径（删代码不引入新路径；⑥ 换喂值的可达面变化见攻击点 #1，结局均 loud）。
- **状态闭环**：失败 → S5 `result.ok===false` → schema-write.ts:174 提前 return → installActive/notifyDirty 不执行 → active tools/SCHEMA/ROOT/双写位/非 fatal 全不变（V10 结构性保证，R2-1 断言组逐条可满足——实跑佐证：红灯仅倒在 ok:true vs ok:false 单点，其余断言在旧代码下已因 ok:true 短路）。fatal 面（α/β/γ/A1）透传接线零变化（§9 caller 表核实）。
- **降级路径**：无外部服务依赖，N/A。0 Yjs update / 0 dirty notifier / state 字节不变由「一切验证先于 transaction」的槽序保证（ADR 0008 :45 槽序 + :75 失败语义）。
- **虚假降级识别**：旧投影正是「伪降级」样本——正常路径的前提不匹配（调用方多传键）被包装成设计行为（锚 15）。设计 §1 正确定性为契约违约而非降级场景，处置是**删除根因**（恢复 loud 契约）而非加 advisory 补丁；round-1 登记的「被剥离键 advisory 上报」随语义消亡作废（§D7）——处置方向正确，符合「溯源上流修真 bug」纪律。
- **结论：PASS**。

## 红线测试思路（供 SA4/SA7 与后续票）

- **T1（攻击点 #1，可选登记）**：doc-runtime 直调 `replaceSchemaAndRoot`，root 为顶层 Proxy（首次读返回合法视图、后续读发散：如第二读起多出未声明键 / 值变域违规）→ 断言结局二选一且绝不 `ok:true`+错内容：若 build 侧 F7 拦截 → `ok:false` path=[k]；若 build 通过而 scratch 发散 → `RuntimeWriteFatalError` E201 变体 C/D、committed 诚实。锚定「对抗双读 loud 不假成功」在新管线下对顶层同样成立。
- **T2（攻击点 #2，特征化）**：注入 γ 环 ref derived × root 含未声明顶层键 `{n:999,a:'x',b:true}` → 断言 **resolved `ok:false`**（域失败优先）而非 E204 rejection——把新优先级锚定为有意行为，防未来「顺手调整次序」造成分类漂移而无测试报警。
- **T3（D2 更名回归）**：修订后 `grep -n "narrowed\|projectDeclaredRootKeys\|D7" packages/doc-runtime/src/schema-replace.ts` 应只剩 rev1 语境「废止」说明（§6.2/§6.3 自检项，SA4 执行留痕）。
- **T4（攻击点 #5，SA4 门禁替代）**：`grep -n "makeRefResolver\|plainObjectOf\|recordSlotOf" packages/doc-runtime/src/schema-replace.ts` 应**零命中**（D4 imports 清理无编译器背书，V5 已证 noUnusedLocals 缺席）。
- **T5（present 惯例恒等，廉价锚）**：可选字段 schema × root `{a:1, opt:undefined}` → `ok:true` 且安装后键集不含 `opt`（validate present / mapEntries skip / ⑥ extract 三方同规的回归锚）。
- **T6（攻击点 #6，seam 级加固）**：doc-runtime 直调：ns-2b × root 含 `b` → `ok:false`、issue path=`['b']`、update 计数 0——把 ①b 纵深防御受益方的契约在 seam 层钉住（当前仅 E2E 覆盖）。

## 结论

设计在攻击下存活：ADR 0008/0007 条款逐条对齐（provided-root 原样封闭校验、失败前置零写入、槽序不变）；D1–D8 变更面精确最小（单文件删函数 + 换喂值 + 注释/文档/版本）；三个关键论证（D2 更名、D3 恒等、E204 可达）全部源码级核验通过；零回归清单与 ALLOW/DENY 无漏项。六个攻击点均为 MINOR/NIT/INFO 级文档精度与测试加固建议，不构成放行障碍——已登记供 SA3 实现注释、SA4 静态门禁与后续票消化。

**Verdict: pass**（`pass` 仅指设计通过本轮审查；实现与活链路验证归 SA4/SA7）。

# SA2 攻击评审报告

**Date**: 2026-08-23（R1）/ 2026-08-23（R2 复审）/ 2026-08-23（R3 定点复审，见文末追加段）
**Reviewer**: SA2（Wallfacer，全新视角独立攻击；未参与 SA1 设计与 SA8 门禁）
**被审对象**: `wiki/raw/task_doc-runtime-transaction-fatal_design.md`（R1 = 595 行；R2 = 705 行；R3 = 752 行）
**任务简报**: `wiki/raw/task_doc-runtime-transaction-fatal.md`（issue #87，功能开发）
**ADR 约束基准**: `task_doc-runtime-transaction-fatal_relevant_decisions.md`（ADR 0001–0008 + W1–W5 红线）
**R1 Verdict**: **reject**（攻击点 #1/#2 为 CRITICAL、#3 为 MAJOR——R1 记录完整保留于下，供溯源）
**R2 Verdict**: **reject（第二次）**——#2/#3/#4–#8 已真实落实（逐条核验见文末 R2 段），#1 的 transactGuarded 半边已修，但**同一伪造 fatal 家族在两处「保留透传面」残留**（R2-1，CRITICAL；其论证含与代码事实相悖的断言，PoC 实证可达）。修订面已收敛为单一残留项。
**R3 Verdict**: **pass（附 2 项落文修正条件——C-R3-1 必修 / C-R3-2 复核点，均 SA4 静态门禁可核验，无需 SA2 再审）**——R2-1 在全部四个声明复核面真实落实（方案 A 结构化、全库零 instanceof 透传、两条 PoC 投递路径锚入 §4.5），R3 闭环仿真验证通过，未发现新攻击面；残留仅为 §15 文件清单两处陈旧交叉引用（见 R3 段）。

---

## 0. 评审方法与独立实证（本报告全部攻击点均经代码/运行时独立复核，非纸面推演）

SA2 在本 worktree 独立复跑了设计的关键协议假设与攻击点 PoC（node v24.13.0 / yjs@13.6.32 / vitest@3.2.4 实装）：

| # | 独立实证项 | 命令 | 结果 |
|---|---|---|---|
| E-1 | P-2 yjs observer 抛错自 `doc.transact` 同步逃逸、写入保留、单 update | `node -e`（packages/doc-runtime 下直跑）：`root.observe(throw Error)` + `doc.transact(set×2)` | `threw=observer-boom observeCalls=1 updates=1 title=t` ✓ 设计主张成立 |
| E-2 | observer 抛错后 cleanup 队列状态 | 同上脚本 | `cleanups.length=0 _transaction=null`——**队列被 yjs 正常重置**，无 E202-B 残留副作用（设计未依赖此点，良性） |
| E-3 | P-3 observer 先挂载 ⇒ 首次事务即触发（§8 fixture 缺陷判定） | 同上脚本 doc3 | `seedTxn threw=mutation-observer-boom fired=true` ✓ §8 诊断成立 |
| E-4 | 非 Error thrown 值（string）原样传播、写入保留 | 同上脚本 doc2 | `typeof=string val=observer-string-boom title=t` ✓ |
| E-5 | `Y.Map.prototype.clear` 存在（§7.2 (H) clear+set 前提） | 同上脚本 | `typeof clear=function` ✓ |
| E-6 | P-1 vitest `toThrow(string)` = 子串包含 | `sed -n 1410,1470p node_modules/.pnpm/@vitest+expect@*/.../dist/index.js` | `def(["toThrow","toThrowError"], …)` 对 string 入参委托 `this.throws(expected)`（chai 核心，子串语义）✓ U13 演进机制成立 |
| E-7 | P-4 ES2022 target/lib + strict 三开关 | `sed -n 1,10p tsconfig.base.json` | `target ES2022 / lib ES2022 / exactOptionalPropertyTypes / noUncheckedIndexedAccess / verbatimModuleSyntax / isolatedModules` ✓ |
| E-8 | P-7 E203/E204/E205 码未被占用 | `grep -rn "DOCRT-E203\|E204\|E205" --include='*.ts' packages apps` | 生产代码 0 命中（仅本任务测试注释）✓ |
| E-9 | 攻击点 #2 PoC：naive 赋值写 `'__proto__'` 新 Record 键 | `node -e`（见 §2 #2） | 标量值：**own 键静默不存在**（`Object.hasOwn=false`、`Object.keys=['a']`、无任何异常）→「ok:true 谎报成功」实证；对象值：**原型被劫持**（`getPrototypeOf !== Object.prototype`） |
| E-10 | 攻击点 #2 PoC：中间段沿原型链读键 | `node -e` | `nav['constructor']` / `nav['toString']` 均取到 function（原型成员）→「已存在键」误判向量实证 |
| E-11 | (E) JSON 往返克隆对 own `'__proto__'` 键保真 | `node -e` | defineProperty 建的 own 键经 `JSON.parse(JSON.stringify())` 保留（`hasOwn=true, value=v`）——克隆步不引入新丢键向量；整数型键顺序在对象创建时已归一，往返保序 |
| E-12 | 既有锚盘点 | grep | E201 锚 13+24=37 处、E202 锚 5+12=17 处、E200 锚仅 rev2 Minor-2；既有测试**无** `constructor.name` 断言；rev2 `toBeInstanceOf(Error)` 4 处与 branded 子类兼容 ✓ 与设计 §9/SA8 V3–V6 一致 |
| E-13 | `makeRefResolver` 双副本 | read extract.ts:233 / resolve.ts | 双副本逐字相同 ✓（V1 成立，§4.3 副本隔离主张可信） |
| E-14 | Record 形 ROOT 可表达 + 读侧 `__proto__` 纪律先例 | `grep -rn "Record<" test/`；read `extract-record-keyspace.test.ts` | `type ROOT = Record<string, YLeaf<string>>` 合法；该文件（issue #73 SA6 F-1）**明文记载**：赋值式写入对 `'__proto__'` Record 动态键「端到端零信号静默丢失 / 原型劫持」，已用 `putSnapshotKey`（defineProperty）修复读侧——攻击点 #2 正是同一危害类在写侧的复现 |

**经攻击后仍站得住的设计面**（SA2 确认无需修改，供 SA4/SA7 复用）：

- §3.2 phase 三值冻结表 + committed 恒定值随 phase 冻结——判据自洽（committed 是管线**位置事实**），W2'/W3 落实；
- §4 E200 拆分判据（信任边界 = 损坏方）——类 A/B/C 三分与 sentinel 4 落点全枚举经代码核对成立，类 C（rev2 Minor-2 RangeError）留守保绿灯；
- §5 E202 不 fatal 化——语义归类正确（调用方契约破坏 ≠ internal failure），17 处既有锚零触碰；
- §6 U13 演进机制——`toThrow` 子串语义（E-6）+ E203 message 携带原文 + cause 原实例，四断言保持绿；
- §8 fixture 时序缺陷诊断——E-3 独立复现证实；当前 worktree 已按 §8 对齐（apply 文件 seed→expect→observe 时序，注释「SA1 设计 §8 对齐」），SA6 修订轮记录与之互证；
- §11 caller 审计——`materializeRoot` 生产 caller 0（grep 证实），return→throw 变更半径封闭成立；
- W4 分层（fatal.ts 仅 yjs）、W5 收窄方向（fatal 化仅类 A）——合规。

**与 SA8 门禁（verdict=clear）的关系**：本报告不与 SA8 冲突——SA8 审的是 ADR 文本冲突面（W1–W5 逐条合规，SA2 复核认同）；本报告的攻击点 #1–#3 是**设计内部的契约完整性漏洞**（静默失败、可伪造分类），其中 #1/#2 各自有 ADR 条款违反面（见下），属 SA8 轻量复审未展开的全维度攻击面。**特别地：SA8 D3 裁决中「防御性 instanceof 透传杜绝双重包装」一句正是攻击点 #1 的病灶**，SA1 修订时应一并推翻该论证（详见 #1）。

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议修订 |
|---|--------|--------|---------|---------|
| 1 | **CRITICAL** | §3.3 `transactGuarded` 的 `instanceof DocRuntimeFatalError` 透传——fatal 分类可被 observer 伪造 | 见 §1.1 | 删除该透传（无条件包装），或改用包内私有 brand 识别内部 fatal；同步推翻 SA8 D3 的该句论证 |
| 2 | **CRITICAL** | §7.3 `placeSet` 写入/导航机制未指定——`'__proto__'` Record 键静默丢键 + `value:undefined` 隐式删除 + 信封未知键忽略 | 见 §1.2 | 冻结 own-key 纪律（defineProperty 写入 + `Object.hasOwn` 导航）+ (A) 增补 `value` 缺失/undefined 与信封未知键的响亮拒绝 |
| 3 | **MAJOR** | §7.2 (G)/(H) clear+rebuild 静默丢弃 live ROOT 未声明键并返回 ok:true（R-4 缓解不成立） | 见 §1.3 | 增补写前响亮预检（live 键集 ⊆ 重建键集，违者单 issue 拒绝）；对齐 materializeRoot 自己的 F7「拒绝静默丢键」纪律 |
| 4 | MINOR | §7.2 ⓪ 复用 `assertOutermostTransactionContext` 的三条 E202 消息硬编码「materializeRoot」函数名 | 见 §1.4 | mutation.ts 自持三条消息常量（指名 applyValidatedMutation）；materialize 侧逐字不动 |
| 5 | MINOR | §7.4/(F)(G) 双读窗口：对抗性 value 的「校验读 #1 / 构造读 #2」发散可安装未经校验值且 ok:true | 见 §1.5 | 设计登记该窗口（与 ⑥ 缺席合并移交），或 (F) 后对构造产物做一次终读仲裁 |
| 6 | MINOR | E203 message 原样内嵌原始异常文本——原始消息含「已回滚/rolled back」时 fatal 文本面误中 ROLLBACK_CLAIM 类过滤 | 见 §1.6 | 登记 AC-4 文本锚的适用边界（仅包装层自述 claims；被携带原文是证据引用），或给引用段加明确引号定界 |
| 7 | MINOR | E204 拆分判据仅 1/4 sentinel 落点有红灯锚（prepare 首检 :448）；:204/:497/resolve.ts:23/:31 无回归锚 | 见 §1.7 | SA6/SA4 补 1–2 个 sentinel 变体锚（ref 环 → E204 committed:false） |
| 8 | NIT | §10 P-7 记录 grep「exit 0」；实际 `git grep` 无命中时 exit 1（SA8 V2 已如实记录） | 证据精度 | 落文时按 V2 修正；不影响结论 |

---

### §1.1 攻击点 #1（CRITICAL）：`transactGuarded` 的 instanceof 透传使 fatal 分类可被 observer 伪造

**设计原文**（§3.3）：

```ts
} catch (err) {
  if (err instanceof DocRuntimeFatalError) throw err; // 防御：绝不双重包装
  throw new DocRuntimeFatalError('observer-cleanup-throw', true, `DOCRT-E203: …`, { cause: err });
}
```

**触发条件**（全部要素均已实证可达）：

1. `DocRuntimeFatalError` 经 §3.5 成为**公共导出**——任何 observer 代码（测试、Runtime 自有 observer、经 doc 引用挂载的任何回调）都可 `new` 一个；
2. observer 在 cleanup 派发期抛出**伪造 branded fatal**，如 `new DocRuntimeFatalError('pre-commit-internal', false, 'spoof')`；
3. 异常自 `doc.transact` 逃逸（E-1/E-4 实证逃逸路径）→ `transactGuarded` 命中 `instanceof` → **原样透传**。

**关键论证——该透传守卫对内部路径是死代码、对外部路径是活漏洞**：按设计自身的 D10 论证（§3.2 注、§2.1 注），事务体只含 copyJsonDomain 产物 + detached 类型上的 `set`/`clear`（E-5），**物理上不可能抛出 branded fatal**——即 `instanceof` 命中的唯一可达来源就是 observer（或引擎缺陷）抛出的**外来** branded。守卫防的「双重包装」对象（内部 branded 自事务体逃逸）不存在，放行的却是攻击面本体。

**影响链**（违反两条 ADR 条款 = CRITICAL 级）：

- **ADR-0007 失败边界**：「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal」——条款要求对 observer 抛错**统一按 internal/fatal 分类**；透传把分类权交给抛错方，交付的 phase/committed 由 observer 任选，直接违反「视为」的归类义务；
- **ADR-0008 / W3 / AC-5 保守语义**：「`committed:true` 或未知异常保守视为可能已提交」——伪造 `committed:false` 交付时**事务实际已提交**（E-1：title 已落盘、update 已发出），committed 事实被降格为 false；下游 Runtime 按契约「committed:false 不调用 dirty notifier」→ **已提交写丢失 dirty notification → 持久化失步**（ADR-0006 链路），或反向伪造 phase 诱导错误的槽处置。
- 本任务是**冻结 fatal 契约**的任务——把可伪造的分类面冻结进 v1 契约，等于冻结一个错误契约。

**修订要求**（二选一，推荐 A）：

- **A（推荐）**：`transactGuarded` 删除 `instanceof` 透传，**无条件包装**为 E203（cause 携带原值——伪造 fatal 作为 cause 原样保留，零信息损失）。论证自洽性：内部 branded 不可能自事务体逃逸（D10），故无条件包装在现设计下永不双重包装；⑥ 与 mutation 外层 catch 的 instanceof 透传**保留**（那里的 branded 来自 doc-runtime 自己的 ⑤⑥/E203/E204 throw 点，透传正确且必要——SA2 已核对 ⑥/mutation 的 try 块内无 observer 派发路径，透传面精确）；
- **B**：以 fatal.ts 模块私有 `Symbol` brand 标记**内部产生**的 fatal（构造函数内部打 brand），`transactGuarded` 仅透传带 brand 者，其余一律包装。为未来「事务体内出现内部 branded」留正确分类通道，代价是多一个包内接缝。

同步要求：SA1 修订时明确推翻 SA8 D3 中「防御性 instanceof 透传杜绝双重包装」的论证（该「防御」防的是不存在的内部威胁，开的是真实的外部漏洞）。

**与红灯锚兼容性**：SA6 17 个红灯场景的 observer 只抛 `Error`/`string`（E/F 场景）→ 包装路径不受影响，全部锚保持可转绿。修订零锚冲突。

---

### §1.2 攻击点 #2（CRITICAL）：`placeSet` 写入/导航机制未指定——合法输入下的静默成功谎报 + 隐式删除越权

**设计原文**（§7.3）：「终段：父节点为 plain object → **赋值**（已存在键 / 缺失键均可——缺失键合法性由 (F) 仲裁：optional 缺失字段 ✓、**Record 新键 ✓**、封闭 map 未声明键 → (F)/(G) 拒绝）」；「中间段导航：当前节点为 plain object → 下一段须为**已存在**的 string 键」。(A) 形状校验仅列「非 plain object / op !== 'set' / path 非 string|number[]」。

**四个具体漏洞**（E-9/E-10/E-14 PoC 实证；Record 形 ROOT `type ROOT = Record<string, YLeaf<string>>` 为合法 schema，`extract-record-keyspace.test.ts:67` 在锚）：

| # | 触发条件（全部合法输入，无需敌意代码） | 实际行为（naive 实现的默认路径） | 影响 |
|---|---|---|---|
| a | Record ROOT + `set(['__proto__'], 'v')`（ADR-0007 冻结语义「新 Record 键」明确放行的键名） | `proposed['__proto__'] = 'v'` 命中 `Object.prototype` setter，标量被忽略（E-9：`hasOwn=false`，无任何信号）→ (F) 校验通过 → (G) `Object.keys` 不见该键 → (H) 重建不含它 → **返回 ok:true，请求的写没发生** | **静默成功谎报**，违反 ADR-0007「最终目标可为……新 Record 键」冻结条款与「成功只返回 {ok:true}」的诚实前提；对象值变体则**劫持 proposed 原型**（E-9：`getPrototypeOf ≠ Object.prototype`），污染后续所有读取 |
| b | 中间段键为 `'constructor'`/`'toString'` 等原型成员名 | `obj[k]` 沿原型链取值（E-10：取到 function/Object）→ 误判「键已存在」→ 下钻后按「路径穿越不可下钻终态」拒绝 | 误诊断（键实际不是 own 键），诊断质量劣化；与 (a) 同根：导航未用 own-key 判定 |
| c | `{ op:'set', path:['r','k'] }`（**漏写 value**，或显式 `value: undefined`）——(A) 校验清单不含「value 缺失」 | placeSet 赋 undefined → present 惯例 → (G) mapEntries 跳过 undefined 值键 → 键**静默清除/未创建** → optional/Record 目标下 (F) 通过 → **ok:true** | 调用方笔误（`val` 代替 `value`）→ 静默清键 + 成功信号；且「set(undefined) ≡ delete」**走私了 ADR-0007 冻结给 delete 独立操作的限制语义**（delete 禁 ROOT/required/下标，set-undefined 可绕开其中 optional/Record 面） |
| d | `{ op:'set', path, value, extra: 1 }`（信封含未知键） | (A) 不校验未知键 → 静默忽略 | 与 (c) 同族：信封校验不闭环，笔误零反馈 |

**先例**：这是仓库**已经付过学费的危害类**——extract 侧同类问题（issue #73 R2.2/F-1）以 `putSnapshotKey`（defineProperty）修复并留有整份回归测试（`extract-record-keyspace.test.ts` 明文：「`out['__proto__'] = v` 命中 Object.prototype.__proto__ accessor：标量值被 setter 静默忽略……端到端零信号静默丢失」「对象值原型被劫持」）；materialize 侧同款纪律在 `materialize.ts:629-631`（defineProperty 安全写入，D13）。**§7.3 对写侧第三条通道（placeSet）只字未提该纪律**。

**修订要求**（写入 §7.3/(A)，随本设计一并冻结）：

1. **终段写入一律 `Object.defineProperty`**（own 数据属性，enumerable/writable/configurable，对齐 extract `putSnapshotKey` / materialize D13）——杜绝 (a)/(b)；
2. **中间段导航键存在性判定一律 `Object.hasOwn`**（命中 own 键才可下钻；原型成员名按「中间容器缺失」单 issue 拒绝）——杜绝 (b)；
3. **(A) 增补**：`value` 缺失或 `=== undefined` → 领域单 issue 响亮拒绝（「set 需携带非 undefined value；清除字段属 delete 操作语义（独立任务面）」）——杜绝 (c)；
4. **(A) 增补**：mutation 信封含未知键 → 领域单 issue 响亮拒绝（或如坚持忽略须在设计显式登记忽略语义并说明为何与 (c) 不同判）——杜绝 (d)。

**与红灯锚兼容性**：SA6 锚只用 `{op:'set', path:['title'], value:'t2'}`（合规信封）→ 修订零锚冲突。

---

### §1.3 攻击点 #3（MAJOR）：clear+rebuild 静默丢弃 live ROOT 未声明键并返回 ok:true——R-4 的「生产面不可达」缓解在当前公共 API 现实下不成立

**触发条件**：封闭 map 形 schema（如 `type ROOT = { title: string; count: number }`）+ live ROOT 含结构树未声明键（**公共 API 直接可达**：`doc.getMap('ROOT').set('rogue', 1)`——SA6 自己的 apply 用例 4 正是以直接 Yjs 写入模拟外部注入，证明该场景在本任务的测试宇宙内是建模对象）+ 任一 `set` mutation。

**行为链**：(C) `extractYjsSnapshot` 按 D4「缺失字段与未知键不报不进快照」**静默滤掉** rogue 键 → (E) 克隆产物无 rogue → (H) `rootMap.clear()` 清空 live → 重建仅含投影键 → (I) verifyInstall 通过（size/identity 与 entries 一致）→ **ok:true，rogue 键无声消失**。

**为什么 R-4 的缓解不成立**：

1. 「生产面不可达」依赖的是**未来** Runtime 的编排边界（ADR-0007「业务调用方不得取得可写 Y.Doc 引用」）——但 `@nomicore/namespace-runtime` 尚未建（SA8 实证），`applyValidatedMutation` **现在**就是公共导出，其唯一消费者恰是「能直接摸 Y.Doc 的人」；
2. 本设计让 doc-runtime 写面出现**第二条通道与其自身纪律相悖**：materializeRoot 对快照未声明键是 **F7「拒绝静默丢键」**（`materialize.ts:576`，注释明言「写侧若按声明字段迭代……会被静默丢弃（**数据丢失伪降级**）」——仓库自己的伪降级判语）；mutation 的 clear+rebuild 却对 live 侧同类键**静默丢弃**。同一包内同一条纪律一正一反；
3. 「ok:true」承诺被弱化成「ok:true（可能顺手删了些你没问的键）」——这正是任务简报 AC-4/W1 要防的静默形态的变体：不是虚假回滚，是**虚假成功**。

**修订要求**（写入 §7.2，(H) 之前）：

- 增补**写前响亮预检**：`[...rootMap.keys()]`（live 顶层键集）相对 (E) 重建键集的差集非空（即 clear+rebuild 将丢弃的 live 键）→ 返回领域单 issue（零写入、消息指名被丢弃键集，对齐 F7 措辞纪律：「拒绝静默丢键——未声明键处置属 validated-mutation 独立任务面」）；
- 嵌套子树内的未声明键若 v1 不检测，须在 §7.5 移交清单显式登记检测面边界（顶层检出 / 嵌套移交），不得笼统写「未声明键处置已登记」；
- R-4 风险条目改写：从「生产面不可达」改为「响亮预检拒绝 + 嵌套面移交」。

**与红灯锚兼容性**：SA6 用例 2/3 的 ROOT 只含声明键（title/count）、用例 4 期望 ok:false——预检不触发，零锚冲突。

---

### §1.4 攻击点 #4（MINOR）：E202 消息复用导致 mutation 侧指认错误的函数名

`E202_MSG_A/B/C`（materialize.ts:117-123）逐字含「调用 **materializeRoot**」「@nomicore/doc-runtime 声明的 yjs 版本兼容性」等语境，且三变体消息被 17 处既有锚 + 「消息逐字定稿」的自我约束锁死。§7.2 ⓪「同款（materialize.ts @internal 导出）」直接复用 → 在 `applyValidatedMutation` 的未闭合事务/派发窗口语境下抛出的 E202 会**指认 materializeRoot**——诊断撒谎 + 未来 mutation 侧 E202 测试锚到谎言。修订：mutation.ts 自持三条消息常量（函数名替换为 applyValidatedMutation，其余措辞对齐），materialize 侧逐字不动；`assertOutermostTransactionContext` 本体可参数化函数名导出（materialize 调用点传 'materializeRoot' 保逐字）。

### §1.5 攻击点 #5（MINOR）：(F) 校验读与 (G) 构造读的双读窗口

(F) `validateLogicalSnapshot(derived, proposed)` 读 value 引用第 1 次，(G) `buildTopEntries` → `copyJsonDomain` 第 2 次读——对抗性 value（Proxy/getter 按读次发散）可使**构造产物 B 未经过校验**（校验的是读 #1 的 A），(I) verifyInstall 只对照 B vs B → ok:true 落库未校验值。materializeRoot 侧同窗口存在但多一层 ⑥（scratch 再读一次，rev2 R-5 论证覆盖「发散但不抛」形态）；mutation 无 ⑥，窗口更宽。设计已在 §7.4/§7.5 登记 ⑥ 移交——但应把「双读窗口」作为独立条目登记（最小缓解：(F) 之后、(G) 之前不做任何 value 再读取的保证不可行，可考虑 (G) 产物回读仲裁或登记接受），并注明与 W1 的关系（W1 管响应形态不管检测宽度——本攻击点是检测宽度缺口，不构成 W1 违反，SA1 的论证方向正确但论据应补全）。

### §1.6 攻击点 #6（MINOR）：E203 内嵌原文与「不声称回滚」文本锚的边界未登记

E203 message 以 `原始异常原样携带：${errDetailOf(err)}` 内嵌原文（U13 子串锚的机制基础，必须保留）。若 observer 抛 `new Error('已自动回滚')` / `new Error('rolled back')`，包装后的 fatal message 会命中 `ROLLBACK_CLAIM` 类正则（`(?:已|已经)自动回滚|自动回滚|rolled\s*-?\s*back`）——fatal 自身并未声称回滚，携带的是证据引用。SA6 现行场景消息（'observer-boom' 等）不触发，但契约文本面（AC-4）与未来 Runtime 侧文本过滤都可能误伤。修订：设计 §3.3/§6.3 登记 AC-4 文本锚的适用边界（约束对象 = 包装层自述 claims；被携带原文为证据引用，豁免），或给引用段加显式引号定界（如「原始异常原样携带：「…」」）并在登记中说明。

### §1.7 攻击点 #7（MINOR）：E204 拆分判据的 sentinel 落点覆盖缺口

红灯锚仅覆盖 prepare 首检（:448，场景 G）。§4.3 另三处 sentinel 落点（buildTopEntries :204 的 prepare 供给链、rootEntries :497、resolve.ts:23/:31 的环/缺名）无任何回归锚——拆分判据「类 A → E204 committed:false」只被 1/4 落点锁定，SA3 若在某落点漏改（仍抛裸 Error → 被 catch-all 收编回 E200 ok:false），**无锚变红**，W3 的 committed:false 交付静默丢失。结构论证（同一 catch）成立但不可机读。修订：SA6（或 SA4 阶段补锚）增加 1–2 个变体锚——手造 ref 环（`structure` 内自引用别名）→ 断言 E204 / committed:false / phase 互异于另两相 / 0 update + state 字节不变。

### §1.8 攻击点 #8（NIT）：P-7 证据的 exit code 笔误

设计 §10 P-7 记 `git grep … → 0 命中（exit 0 无输出）`；`git grep` 无命中时 exit 1（SA8 V2 已如实记录 exit 1）。E-8 复核结论不变（0 命中成立）。落文时按 V2 修正。

---

## 2. 协议假设依据审查（2026-06-13 立法）

- **章节存在性**：§10 存在，P-1…P-7 七项，覆盖设计全部外部行为假设（vitest 匹配语义 / yjs observer 逃逸与不回滚 / 挂载时序 / ES2022 ErrorOptions / yjs 内部字段 / JSON 往返域 / 错误码占用）——**合规**。
- **依据可验证性**：无「应该/通常/预计」类无据推断。SA2 独立重跑 P-1（E-6 源码定位）、P-2/P-3（E-1/E-3/E-4 node 实跑，输出与设计记载一致）、P-4（E-7）、P-7（E-8）——全部成立且可复现。P-5（零改动依赖现状）与 P-6（源码引用）经文件核对成立。
- **精度瑕疵**（不构成 reject 项）：P-2 的复现脚本未逐字粘贴（结果摘要有、命令体可重构——E-1 已代为复现，结论一致）；P-7 exit code 笔误（攻击点 #8）。
- **新增假设的缺口**：§7.3 placeSet 隐含「plain object 赋值语义足以承载终段写入」假设——该假设**错误**（E-9/E-10/E-14 实证），即攻击点 #2；§7.2 (H) 隐含「clear+rebuild 不丢失 live 可见状态」假设——不成立（攻击点 #3）。修订后 §10 应补 P-8（own-key 写入纪律先例：extract-record-keyspace.test.ts + putSnapshotKey）与 P-9（live 键集 ⊆ 重建键集预检）。

## 3. 错误处理链路审查（2026-05-07 立法）

- **静默失败检查：发现 3 处**——#2(a) `'__proto__'` Record 键静默丢键后 ok:true（合法输入、零信号）；#2(c) value 缺失/undefined 静默清键后 ok:true；#3 live 未声明键被 clear+rebuild 静默抹除后 ok:true。三处均为「无 issue、无 throw、无状态变化可感知」的成功面谎言，**必须修**。
- **状态闭环**：fatal 通道（E203/E201/E204）全程 throw、领域失败全程 ok:false+issues，无异步无悬挂 promise——闭环 ✓；唯一缺口即上述三处**成功面**漏洞（错误处理链路审查同样覆盖虚假成功）。
- **降级路径**：本任务无降级设计（库层 loud 文化）✓；E200 类 B/C 留守领域联合是 ADR-0008 条款面（「普通、可预期且零写入」），**非**伪降级 ✓；#3 的「生产面不可达」论证是以「前提恒成立」掩护静默丢失——按虚假降级判语（materialize 自己的 F7 注释原文「数据丢失伪降级」）该缓解**不成立**，已按 MAJOR 令修订。
- **用户可感知性**：修订后每条拒绝路径均为精确单 issue / branded fatal（消息指名键集与语义边界）✓。

## 4. 红线测试思路（每漏洞对应红灯 IT 编写方向，供 SA6/SA4 落锚）

1. **#1 伪造 fatal 透传**：materialize 侧——挂 observer 抛 `new DocRuntimeFatalError('pre-commit-internal', false, 'spoof')`；断言交付 fatal `committed === true`（写入实际已提交：`root.get('title')==='t'`、updateCount≥1）且 `phase === 'observer-cleanup-throw'`（或至少 ≠ 'pre-commit-internal'）、`err.cause === spoof 实例`。apply 侧同款（seed → 挂伪造 observer → set → 同断言）。若实现保留 instanceof 透传，本用例恒红。
2. **#2(a) `__proto__` 静默丢键**：`type ROOT = Record<string, YLeaf<string>>` 铺底 `{a:'x'}`；`set(['__proto__'],'v')` → 断言**不得** ok:true 且无变化（按修订定稿：ok:false 单 issue，或 ok:true 且 extract 读回键集含 own `'__proto__'`）；同时断言 `Object.getPrototypeOf` 劫持变体（value 为对象）被拒或安全落 own 键。
3. **#2(b) 原型链导航**：path `['r','constructor','x']` → 断言单 issue「中间容器缺失」类（非「穿越不可下钻终态」）——锁定 own-key 判定。
4. **#2(c)/(d) 信封校验闭环**：`{op:'set',path:['r','k']}`（无 value）→ 断言 ok:false 单 issue、extract 读回原值不变（键未被静默清除）；`{op:'set',path,value,extra:1}` → 按定稿断言拒绝或显式登记。
5. **#3 未声明键静默抹除**：`type ROOT = { title: string }`；`root.set('rogue',1)` 直接注入；`set(['title'],'v2')` → 断言 ok:false 单 issue（消息含 'rogue'）或按定稿处置；**绝不** ok:true + rogue 消失（对照断言：`root.has('rogue')` 保持 true、state 字节不变）。
6. **#4 E202 语境指认**：在未闭合外层 `doc.transact` 内调 `applyValidatedMutation` → 断言 message 含 'applyValidatedMutation' 且不含 'materializeRoot'。
7. **#5 双读窗口**（移交登记型）：对抗 value 用计数 Proxy（首读合法、次读发散）→ 断言按定稿（拒绝或 ⑥ 移交登记），并断言不出现「校验值 ≠ 落库值且 ok:true」的未登记行为。
8. **#6 文本锚边界**：observer 抛 `new Error('已自动回滚')` → 断言交付 fatal 仍为 E203 / committed:true / phase 'observer-cleanup-throw'（文本豁免登记落地）。
9. **#7 sentinel 覆盖缺口**：手造 ref 环派生物 → 断言 E204 / committed:false / 0 update / state 字节不变 / phase 与 E203、E201 两相互异。

## 5. 裁决与放行条件

**Verdict: reject。**

- CRITICAL × 2（#1 fatal 分类可伪造——冻结即冻结错误契约，含 ADR-0007 失败边界与 ADR-0008/W3 保守语义违反面；#2 placeSet 静默成功谎报——合法输入可达、违反 ADR-0007「新 Record 键」冻结条款，且为仓库已付学费的危害类在写侧复现）；
- MAJOR × 1（#3 静默丢键伪缓解）；
- MINOR × 4 + NIT × 1（#4–#8）。

**放行条件**（SA1 修订设计后 SA2 复审，预计复核面收敛）：

1. §3.3 按攻击点 #1 修订（方案 A 或 B）+ 推翻 SA8 D3 对应论证句；
2. §7.3/(A) 按攻击点 #2 冻结 own-key 写入/导航纪律与 value/信封校验闭环；
3. §7.2 按攻击点 #3 增补写前响亮预检 + §7.5/R-4 改写（含嵌套面登记）；
4. #4–#7 一并处置（#5/#6/#7 允许以登记/补锚方式闭环，#4 须修订消息方案）。

修订不触碰任何既有绿灯锚与 SA6 17 红灯锚的预期转绿路径（逐条核对见各攻击点「与红灯锚兼容性」）——SA1 的架构骨架（phase 冻结表、E200 拆分、E202 不 fatal 化、U13 演进、双副本隔离、§8 fixture 诊断）经攻击后成立，修订均为外科手术式，不动骨架。

---
---

# R2 复审段（2026-08-23 追加；R1 记录完整保留于上，供溯源）

**被审对象**: SA1 R2 修订版设计（705 行，41 处 R2 标注；「SA2 反馈逐条回应」表声称 #1–#8 全部 ✅）
**复审方法**: R2 版全文重读（全新视角，不预设 R1 结论成立）→ grep 一致性核验（`instanceof DocRuntimeFatalError` 5 处命中与设计自检段逐一比对，transactGuarded 活代码确无透支行 ✓）→ 对「透传守卫的精确保留面」表的两项事实断言做代码路径核对 → **两个残留通道 PoC 实证**（node v24.13.0 直跑，伪造 branded fatal 类模拟 §3.1 公共导出形态）→ R2 新增拒绝面（(A1-A5)/(G½)/own-key 纪律/「」定界/E202 参数化）逐一做新攻击面扫描。

## R2.1 逐条落实核验（是否真实落实，非承认式）

| R1 # | SA1 声称 | SA2 核验结论 | 依据 |
|---|---|---|---|
| #1 transactGuarded 删除 instanceof 透传 + 推翻 SA8 D3 | ✅ | **半落实**：transactGuarded 半边**真实修复**——§3.3 活代码确无透支行（grep 实证 :178 为删除标记注释），方案 A（无条件包装）+ 五点论证 + 明文推翻 SA8 D3 末句 ✓；**但「透传守卫的精确保留面」表（§3.3）两行的事实断言错误**，同一伪造 fatal 家族在 mutation 外层 catch 与 ⑥ 三 catch 残留——见 R2-2（CRITICAL） | grep + PoC-1/PoC-2 |
| #2 placeSet own-key 纪律 + 信封闭环 | ✅ | **真实落实**：§7.3 终段一律 `Object.defineProperty`（own 数据属性）、中间段一律 `Object.hasOwn`（原型成员 → 「中间容器缺失」诚实诊断）、(A2) 信封 own 键集恰为 {op,path,value}（未知键/笔误 val 响亮拒绝）、(A5) value 须 hasOwn 且 ≠undefined（杜绝 set(undefined) 走私 delete 语义）——四条 R1 子漏洞 (a)(b)(c)(d) 全闭；P-8 依据入表；Record `'__proto__'` 全路径走查（(F) 校验 → (G) mapEntries own 读 → (G½) 键集含 → (H) yjs Map 内部存储无原型语义 → extract 读回 putSnapshotKey）自洽 ✓；与 SA6 锚（合规信封）零冲突 ✓ | 代码路径走查 + R1 E-9/E-10/E-11/E-14 |
| #3 (G½) 写前预检 + 嵌套面移交 + R-4 改写 | ✅ | **真实落实**：(G½) live 顶层键集 − 重建键集非空 → 领域单 issue（指名键集、零写入、F7 措辞对齐）；§7.5 「live 未声明键处置」行拆顶层=预检拒绝 / 嵌套=显式移交（非笼统）；R-4 明文撤回「生产面不可达」论证；P-9 判据依据入表；锚兼容（用例 2/3 只含声明键 dropped 为空；用例 4 在 (C)/(D) 即返 ok:false）✓ | 代码路径走查 |
| #4 E202 消息参数化 | ✅ | **真实落实**：`assertNoActiveTransaction(doc, fnName)`（A/B 变体代入函数名；C 变体原文共享——经核对 E202_MSG_C 确不含函数名 ✓）；materialize 侧代入 `'materializeRoot'` 承诺逐字节同一 + §12.6 增补 diff 复核命令 ✓ | 消息常量核对 |
| #5 双读窗口独立登记 | ✅ | **可接受闭环**（R1 放行条件明示允许登记/补锚）：§7.5 独立行 + W1 关系注明（响应形态 vs 检测宽度）+ 本切片后果收敛（getter 抛出 → E205；发散不抛 → 移交）+ 补锚思路 #5 | — |
| #6 E203 引用定界 + 文本锚边界 | ✅ | **真实落实**：「」定界 + 「（证据引用，非本 fatal 自述）」标注 + §6.3 边界段（约束对象 = 包装层自述）；U13 子串锚不受「」影响（'observer-boom' 仍为子串）；包装层自述「写入已提交，不回滚、不补偿」仍不命中 ROLLBACK_CLAIM ✓ | 消息文本核对 |
| #7 sentinel 锚覆盖缺口登记 + 补锚 | ✅ | **可接受闭环**（同上）：§4.5 如实登记 1/4 缺口 + ref 环 → E204 补锚建议 + SA4 结构性核对兜底 + §15 测试文件条目更新 | — |
| #8 P-7 exit code | ✅ | **已修**：改为「无输出，exit 1」并注明修正出处 | §10 P-7 行 |

**结论：#2/#3/#4/#6/#8 五项真实落实，#5/#7 以 R1 明示允许的登记/补锚形式闭环；唯 #1 存在 CRITICAL 残留（R2-2）。**

## R2.2 残留攻击点 R2-1（CRITICAL）：「透传守卫的精确保留面」两行断言与代码事实相悖——伪造 fatal 家族在 mutation 外层 catch 与 ⑥ 三 catch 仍可透传

**设计断言（§3.3 表，R2 新增）与事实核对**：

| 表行 | 设计断言 | SA2 核验 | 结论 |
|---|---|---|---|
| mutation 外层 catch | 「外部执行面**仅 (H) 事务体**，已被 transactGuarded 无条件包装收口，**伪造 branded 到达 mutation catch 前必已被重铸为 E203**」 | **错误**。mutation 的 try 块 (A)–(G) 大量读取**调用方敌意对象**：(A1) `plainObjectOf(mutation)` 调 `Object.getPrototypeOf`（Proxy trap 可抛）、(A2) `Object.keys(mutation)`（ownKeys trap）、(A5) 读 `mutation.value`（getter 可抛）、(F) `validateLogicalSnapshot` 经 proposed **引用直读** hostile value（getter/Proxy trap）、(G) `copyJsonDomain` 二读——这些全是**事务体之外的外部代码执行面**，抛出的伪造 branded **未经任何重铸**直达 catch 的 `instanceof DocRuntimeFatalError → throw err` 透传 | PoC-1 实证 |
| ⑥ 三 catch | 「⑥ try 块内**无外部代码执行面**……branded 在此不可达——**无伪造面**」 | **错误**。⑥ 的 try (3) 调 `makeRefResolver(derived)`（读 `derived.aliases[cur.name]`）与 `productEqual(derived.structure.node, …)`（二次访问 derived.structure）——**derived 是调用方入参**（本任务建模宇宙内：SA6 场景 G 本身就手造 derived）。计数型 Proxy `aliases`（第 1 次读返回合法节点通过 prepare 的同款解析器机制、第 2 次读抛伪造 branded）或 structure 上的计数 getter，可使伪造 branded 恰在 ⑥ try 内抛出 → ⑥ 的 instanceof 守卫原样透传 | PoC-2 实证 |

**PoC（本 worktree node 直跑，模拟 §3.1 公共导出类形态）**：

```
Site1 (mutation catch passthrough): delivered = FORGED fatal passthrough: committed=false phase=pre-commit-internal
Site2 (⑥ catch passthrough, count-based derived.aliases): delivered = FORGED fatal passthrough: committed=false
```

- PoC-1：hostile value getter 在 (F) 读时抛 `new DocRuntimeFatalError('pre-commit-internal', false, 'spoof')` → mutation catch 透传原样交付；
- PoC-2：计数型 `derived.aliases` Proxy 在 ⑥ 的第二次解析读时抛同款伪造 → ⑥ catch 透传原样交付。

**影响链**（与 R1 #1 同族，两条具体伤害路径）：

1. **Site 1（mutation catch）——用户数据 → 写能力永久关闭的 DoS**：伪造 fatal 被原样交付 → Runtime 按 ADR-0008「internal fatal → 永久关闭该 Runtime 全部写能力」处置 → **调用方一次敌意 mutation value 即可永久杀死 namespace 写入**。这违反设计自己的 §4.1 类 B 判据（「敌对输入是可预期失败——Runtime 不得因用户数据永久关闭写」）——try 内 hostile 读抛出的非 branded 异常落 E205 领域联合（✓ 正确），唯独抛 branded 时被透传升格为 fatal（✗ 分级权外泄给敌意数据）。对外泄露方向（伪造 committed:true / phase:'observer-cleanup-throw'）则为本调用零写入却交付已提交 fatal——同为伪造分类。
2. **Site 2（⑥ catch）——R1 #1 的原始谎报链原样复现**：⑥ 运行于事务提交后，伪造 `committed:false` 交付时**事务实际已提交** → Runtime 按契约「committed:false 不调用 dirty notifier」→ 已提交写丢失 dirty notification（ADR-0006 持久化失步）。这正是 R1 #1 定为 CRITICAL 的同一条影响链。

**对照佐证（正确先例就在本设计内）**：prepare 的 catch **无** instanceof-DocRuntimeFatalError 透传——hostile snapshot getter 抛出的伪造 branded 在 prepare 内落 E200 ok:false（类 B 正确分级）。只有 ⑥ 与 mutation catch 保留了透传面；且 §3.3 论证 1 对 transactGuarded 的判语「对内死代码、对外活漏洞」同样适用于这两处——⑥ try 内今日无内部 branded 可达（④⑤ 在其外抛出）、mutation try 内的内部 branded 仅 (H)/(I) 产出——守卫防的内部威胁不存在或可结构性消除，放行的外部伪造面真实存在。

**修订要求（二选一，R3 复审只验此一项）**：

- **方案 A（结构化，与 materializeRoot 自身纪律同构，推荐）**：mutation 的 (H)/(I) 移出 try 块（对齐 materializeRoot「④⑤⑥ 物理位于一切 catch 之外」的结构）——catch 只覆盖 (A)–(G)（该区间无内部 fatal 源：sentinel 由 catch 自产 E204，transactGuarded/verifyInstall 均在其外）→ **删除** catch 内 `instanceof DocRuntimeFatalError` 透传，伪造 branded 落 E205 ok:false（类 B 正确分级）；⑥ 三 catch 的 instanceof 守卫**删除**（今日无内部 branded 可达；外来 branded 被 e201D 包装为 branded committed:true——⑥ 位置事实，诚实且保留 cause）。
- **方案 B（内部 brand）**：`DocRuntimeFatalError` 构造函数打模块私有 Symbol brand，三处透传一律改为 `isInternalFatal(err)` 判定（仅内部产生者透传；外来 branded 落各语境本地重分级：transactGuarded→E203、⑥→e201D、mutation catch→E205）。

无论哪种方案，须同步：① 重写 §3.3「透传守卫的精确保留面」表两行（删除「外部执行面仅 (H)」「⑥ 无外部代码执行面/无伪造面」两处与代码事实相悖的断言，改为「try 块内存在调用方对象读取面（envelope/value/derived），读取即执行外部代码」的正确前提）；② §4.5 补锚 #1 增补敌意读投递路径锚——伪造 fatal 自 value getter 在 (F) 抛出 → 断言落 E205 ok:false（非 fatal 透传）；伪造 fatal 自计数型 derived.aliases 在 ⑥ 抛出 → 断言落 e201D/按结构化方案的重分级（非伪造 phase/committed 交付）。

**与红灯锚兼容性**：SA6 17 红灯场景无 hostile-branded 投递（场景 E/F 抛 Error/string、场景 G 手造 derived 直落 prepare）→ 两方案均零锚冲突；(H)/(I) 移出 try 不改变任何抛出行为（本来就在 catch 的透传下原样上抛）。

## R2.3 R2 新增面的新攻击面扫描（其余各项——无新洞）

- **(A1-A5) 信封校验**：符号键对 Object.keys 不可见（无害，不读）；冻结信封可正常校验；envelope Proxy trap 抛非 branded → E205 ✓、抛 branded → R2-1 Site 1（已并入残留项）；defineProperty 写入 extensible 的 JSON 克隆不可抛 ✓。
- **(G½) 预检**：`dropped ⊆ 未声明键` 的 P-9 表述在 union ROOT 仲裁翻转情形下不严格（另一成员声明的键可落在接受投影外）——但行为（响亮拒绝而非静默丢键）保守正确、消息文本「结构树投影外的键……clear+重建将丢弃」对投影事实的描述准确；**精度 nit**，落文时把 P-9 判据改为「dropped ⊆ 重建键集之外的 live 键（含 union 仲裁投影差）」即可，不构成攻击面。
- **own-key 纪律**：Record `'__proto__'` 全路径（(F)→(G)→(G½)→(H)→(I)→extract 读回）逐环走查自洽；own 键遮蔽原型 accessor 有 materialize.ts:572 注释 + 实证 T10 背书 ✓。
- **「」定界**：不破坏 U13 子串锚（P-1 语义）；原文含 `」` 无转义（纯诊断文本，无结构语义）——nit 不列。
- **E202 参数化**：fnName 代入错拼风险由 §12.6 逐字节 diff 复核命令覆盖 ✓。
- **§7.6 用例 4 走查归因 nit**：`count='not-a-number'` 为 leaf 载体合法的 string（extract copyPlainValue 不做逻辑类型检查，逻辑域归 validateLogicalSnapshot）——实际拒绝点为 **(D)** 而非表中所写 (C)；用例断言（ok:false + issues + state 不变）在两归因下均通过，仅文档精度问题，落文时修正。

## R2.4 R2 裁决

**Verdict: reject（第二次）。**

- **已认可（不再复核）**：R1 #2/#3（CRITICAL/MAJOR）、#4/#6/#8（MINOR/NIT）真实落实；#5/#7 以 R1 明示允许的登记/补锚形式闭环；#1 的 transactGuarded 半边 + SA8 D3 推翻真实落实。R1 三条放行条件的第 2/3/4 条已满足。
- **唯一阻塞项**：R2-1（CRITICAL）——§3.3「透传守卫的精确保留面」表两行断言与代码事实相悖，伪造 branded fatal 在 mutation 外层 catch（(A)/(A5)/(F)/(G) 敌意读投递面）与 ⑥ 三 catch（计数型 derived.aliases/structure 二次读投递面）仍可原样透传，影响链含「用户数据 → 写能力永久关闭 DoS」（违反设计自身 §4.1 类 B 判据）与「committed:false 谎报于已提交事务 → notifyDirty 丢失 → 持久化失步」（R1 #1 同链，PoC-2 实证）。
- **R3 放行条件（仅此一项）**：按 R2.2 方案 A 或 B 修订两处保留透传面 + 重写该表两行事实断言 + §4.5 补锚增补敌意读投递路径锚。预计 R3 复审为定点复核（§3.3 表 + §7.2 catch 结构 + §3.4 ⑥ 守卫 + 补锚清单四处），不再全量重审。

---
---

# R3 定点复审段（2026-08-23 追加；R1/R2 记录完整保留于上，供溯源）

**被审对象**: SA1 R3 修订版设计（752 行，17 处【R3】标注；按 R2.2 处方方案 A 结构化落实 R2-1）
**复审范围**: 按 R2.4 声明的四定点——§3.3 表 / §7.2 catch 结构 / §3.4 ⑥ 守卫 / §4.5 补锚（不做全量重审；R2 已认可面仅做零回退抽查）
**复审方法**: 四定点全文精读 + grep 透传残留核验（`instanceof DocRuntimeFatalError` 全文 7 处命中逐一判别活代码/非活代码）+ **R3 catch 形状闭环仿真**（对 R2 PoC-1/PoC-2 两个投递载荷重放，验证分级结果）+ R3 变更面新攻击面扫描。

## R3.1 四定点逐面核验（是否真实落实）

| 定点 | SA1 声称 | SA2 核验 | 结论 |
|---|---|---|---|
| **① §3.3 表** | 「保留面」表作废 → catch 分级总表（前提=读取即执行外部代码） | §3.3（:211-229）：总表四行齐备——transactGuarded（无条件包装，R2 定稿不变）/ **prepareMutation**（sentinel→E204、**其余一律 E205**，无透传）/ prepare（先例对照，本就无透传）/ **⑥ 三 catch（守卫删除** → 外来 branded 被 e201D 重分级 committed:true，cause 保伪造实例）；前导原则「全库零 instanceof 透传——内部 fatal 靠结构传递、外来按捕获位置重分级」+ **正确前提**（R2 两行错误断言的更正原文明示「读取即执行外部代码」，投递路径枚举与 SA2 PoC-1/PoC-2 一致）；方案 A 四点论证（同构性 / Symbol brand 劣势 / **⑥「防未来演化」论证明文作废** / e201D 包装诚实性）完整 | **真实落实** |
| **② §7.2 catch 结构** | (H)/(I) 物理移出 try + prepareMutation 收窄 catch 无透传 | §7.2（:453-518）：公共主体 = ⓪（注释「一切 catch 之外」）→ prepareMutation → fail 即返 → **(H) transactGuarded 与 (I) verifyInstall 物理位于一切 catch 之外**（:459-464，与 materializeRoot「⓪/④⑤⑥ 在外」双同构）；`prepareMutation` 助手 try 覆盖 (A)–(G½)，catch 仅两支——sentinel→E204 / **其余一律 E205 ok:false**（含伪造 branded，「」定界携带原文；**无 instanceof DocRuntimeFatalError 透传**，注释明示「本 try 内无内部 fatal 源」）；E203/E201/E204 自 throw 点直接上抛不经任何 catch | **真实落实** |
| **③ §3.4 ⑥ 守卫** | 三 catch instanceof 守卫删除 + e201D cause 必选 | §3.4（:256-262）：e201D catch 包装路径 cause 从「可选」升**必选**（「外来/伪造 branded 的实例保留面」）；**⑥ 三 catch 明确不加守卫**（R2 保留决定明文推翻，理由 = derived 二次读面 + PoC-2 实证）；INV-5 演进声明增「mutation 侧 (H)/(I) 同构」；§12.3 实现步骤同步（「⑥ 三 catch 不加 instanceof 守卫」） | **真实落实** |
| **④ §4.5 补锚** | 增补 PoC-1/PoC-2 两条敌意读投递路径锚 | §4.5（:366-367）：**锚 a**（mutation 信封/value 路径）——hostile value getter 在 (F) 抛伪造 branded → 断言 **ok:false + 单 issue（E205）**、零写入（state 字节不变）、非 fatal 交付、message「」定界含 'spoof'；**锚 b**（⑥ derived 二次读路径）——计数型 aliases Proxy 第 2 读抛伪造 → 断言交付 **e201D**：instanceof / `committed===true`（⑥ 位置事实，updateCount≥1）/ `phase==='post-commit-verification'` / `cause===伪造实例` / 非伪造 phase/committed 交付——两条断言集与 SA2 R2.2② 处方**逐项对应** | **真实落实** |

**两 nit 落实核验**: P-9 措辞（§7.2 (G½) 注 :505-506 + §10 P-9 :629——「dropped = 重建键集之外的 live 键（主要为未声明键，亦含 union 仲裁翻转下的投影差）」）✓；§7.6 用例 4 归因修正为 **(D)**（:567 + §7.2 (C)/(D) 注释同步——'not-a-number' 为 leaf 载体合法 string，载体面通过、逻辑错位在 (D) 拒绝）✓。

**透传残留 grep 判别**（全文 7 处 `instanceof DocRuntimeFatalError` 命中）: :186（transactGuarded 内 R1 病灶删除标记注释，非活代码）/ :213（总表「零透传原则」陈述）/ :222（总表 ⑥ 行 PoC 路径描述）/ :262（§3.4 守卫删除论证，引述 R2 病灶）/ :384（§5 Runtime 层 fatal gate 判据登记——**Runtime 消费面非本包 catch**，正当）/ :510（prepareMutation catch 注释「无透传」声明，非活代码）/ :748（R3 自检段）。**本包任何 catch 活代码均无透传分支** ✓——与设计自检声明一致，SA2 独立判别无出入。

## R3.2 闭环仿真验证（R2 两个 PoC 载荷在 R3 catch 形状下的分级结果）

```
PoC-1 under R3: {"ok":false,"e205":true,"fatal":false}                          // hostile value getter → E205 ok:false，非 fatal 交付 ✓
PoC-2 under R3: instanceof=true | committed=true (forged claimed:false) |
                phase=post-commit-verification | cause===forged instance=true |
                spoof text preserved=true                                        // 计数型 aliases → e201D 重分级，cause 保留 ✓
```

（仿真按设计 §3.1 类形状——`super(message, options)` 原生 cause 转发；首轮 stub 漏转发系仿真脚本瑕疵，已修正重跑，设计代码无此问题。）

两条 R2 伤害链均被切断：**「用户数据 → Runtime 永久关写 DoS」**（伪造 branded 现落 E205 领域联合，类 B 分级恢复）与 **「committed:false 谎报于已提交事务 → notifyDirty 丢失 → 持久化失步」**（⑥ 位置事实 committed:true 恒诚实）。

## R3.3 R3 变更新攻击面扫描（无新洞）

- **sentinel instanceof 判定的可伪造性**：`DerivedInvariantError` 仅模块级导出（fatal.ts），不经 index.ts；package.json `exports` 封闭子路径（仅 `"."`）——敌意外部数据无法取得同原型实例伪造 E204；hand-made 同名类 instanceof 不命中（原型身份判定）→ 落 E205 ✓。
- **(H)/(I) 移出 catch 后**：E203/E201 直接上抛（与 materializeRoot ④⑤ 同构），无降格路径 ✓。
- **⑥ 无守卫后 e201D 包装一切外来值**：含 sentinel（R1 以来既有位置分类行为，不变）与伪造 branded（R3 新分级）✓；committed:true 为 ⑥ 位置事实恒诚实 ✓。
- **e201D/E205 message 的 errDetail 嵌入段「」定界**：既有 37 处 E201 锚均为子串/正则形态（SA8 V4 实证）——定界引号不破坏锚；E205 为新码无锚 ✓（复核点 C-R3-2）。
- **R2 已认可面零回退抽查**：own-key 纪律（§7.3 全文未动）、(G½)（§7.2 保留）、E202 参数化（§7.2 ⓪/§12.6 保留）、「」定界（§3.3/§6.3 保留）、P-7（§10 保留）✓。

## R3.4 残留项（非阻塞；落文修正条件）

- **C-R3-1（必修文档修正——SA3 落文前修正，SA4 静态门禁核验）**：§15 ALLOW LIST 两处**陈旧交叉引用**——(a) `materialize.ts` 条目（:710）变更清单仍列 **「⑥ catch instanceof 守卫」**，与 §3.3 总表 / §3.4 / §12.3 的「⑥ 三 catch **不加** instanceof 守卫」**直接矛盾**（R2 时代残留，R3 改了规范章节漏改文件清单；设计自检段 :749 声称「§7.2/§11/§12 三处一致」漏检 §15）；(b) `mutation.ts` 条目（:709）仍为 R2 描述（~280 行、未提 `prepareMutation` 助手结构；§12.4 已为 ~290 行 + R3 结构）。两处均为摘要层陈旧短语，**不构成攻击面**（规范章节一致、SA4 按 §12.3 可核验），但若 SA3 依 §15 字面落文会加上已被废除的 ⑥ 守卫——必须修正为与 §3.4/§12.3 一致。
- **C-R3-2（nano 复核点）**：⑥ e201D 与 E205 的 errDetail 嵌入段「」定界落文时，SA4 按既有 37 处 E201 锚的子串/正则形态复核定界不破坏锚（V4 已证形态，风险极低）。

## R3.5 R3 裁决

**Verdict: pass（附 2 项落文修正条件）。**

- R2-1（唯一阻塞项）在四个声明复核面**全部真实落实**（R3.1 表）：方案 A 结构化（(H)/(I) 移出 try + prepareMutation 收窄无透传 + ⑥ 守卫删除 + e201D cause 必选）、catch 分级总表以正确前提（「读取即执行外部代码」）取代 R2 错误断言表、两条 PoC 投递路径锚按 SA2 处方逐项落入 §4.5 补锚清单。
- R3 闭环仿真验证（R3.2）确认两条 R2 伤害链被切断；变更面新攻击面扫描（R3.3）无新洞；R2 已认可面零回退。
- 残留仅 C-R3-1/C-R3-2 两项文档级修正（§15 陈旧短语 + 定界锚复核），均 SA4 静态门禁可核验，**无需 SA2 再审**——符合 R2.4「R3 为定点复核」的预告。
- **放行 SA3 实现**；SA4/SA7 后续按 §12 自检命令 + §4.5 补锚清单 + C-R3-1/C-R3-2 修正项验收。SA2 对本设计的攻击评审闭环（R1 reject → R2 reject → R3 pass）。

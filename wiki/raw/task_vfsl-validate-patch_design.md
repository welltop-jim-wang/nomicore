# 设计文档：validatePatch——路径级写入校验 + 数组三操作（issue #53 / Phase 2 H2）

- Issue: #53 (welltop-jim-wang/nomicore) · Parent: PR #51 · Branch: `fix/issue-53-on-phase-2-engine-gaps` · Task Type: 功能开发
- 语义基准（按 `task_vfsl-validate-patch_relevant_decisions.md`，指针混写已纠正）：**ADR 0003 §3/§4/§5 + ADR 0004 D1/D2 + ADR 0002（两步判定、authority 出范围）+ CONTEXT.md「重建校验/结构树/路径索引/零写入/封闭对象/整文档校验」**。「统一写入管线 §7」以 Feishu 设计文档 §7 为语义出处（v1-spec §7 是信封形状，不当写入管线规格读）。
- 红灯契约：`packages/vfsl/test/validate-patch.test.ts`（SA6，36 用例，全红根因 = 四函数未导出）。SA6 四条设计备注（命名契约 / insert 上界自由 / 守卫 path 取完整尝试路径 / 值校验 path 取绝对路径）全部吸收进下文决策表。
- SA8 前置观察落实：观察②（xml-fragment 终态位补入拒绝矩阵）→ §3.2 拒绝矩阵含 xml-fragment 行；观察③（不得改动派生 schema 公共形状）→ 本设计对 `DerivedSchema` **只读消费**，零形状变更（§8.3）。
- **R2 修订（2026-08-21，落实 SA2 R1 全部攻击点 F1–F7）**：F1 值树游标 ref 归一化（HIGH）、F2 base 段检查改「形态 + 在场」两段式——消除 spread 塌缩静默 ok:true（MEDIUM）、F3 节点集身份去重与工作量界 O(L×N)（MEDIUM）、F4–F6 消息取序/非 Array 目标行/E100 path 冻结（LOW）、F7 计数勘误。修订均为定点条款（R2 冻结①–④ + 矩阵行 11/12 + D13–D18），**架构骨架（两段正交 / 一算法三透镜 / interpret() 抽取 / D1–D12 / SA8 已裁决项）不回退**；逐条回应见文末表。

---

## §1. 任务范围与不做什么

**做**：`validatePatch` + 数组三操作（append/insert/delete）四个公共导出——ADR 0002「结构 → 值」两步判定的运行时核心（增量形态）；顺手收敛 resolve 双份（§4）。

**不做**（护栏，违者即 scope creep）：

| 不做 | 依据 |
|---|---|
| 不碰 yjs / server / WS / HTTP 400 通道语义 | 简报「Phase 2 本票明确不碰 yjs」；零写入语义的 400/通道层属 PRD |
| 不引入任何 authority 式不变式（enum/range/conditional/state-machine 规则） | ADR 0002 核心条款：authority 体系完全出范围 |
| 不改 `DerivedSchema` / `StructureNode` / `ValueSchema` 公共形状 | ADR 0003 后果「形状变更须走设计修订流程」+ SA8 观察③ |
| 不改 `@nomicore/vfsl-codegen`、`domains/`、CI regen-diff 面 | ADR 0005 无关性裁定 |
| 不把序列编辑塞进下标替换语义 | ADR 0004 D1：三操作是专用 API 的运行时判定面 |
| 不复活 resolveChild 三级前缀匹配 | CONTEXT「路径索引」Avoid 行 |
| 不新增运行时依赖 | phase-2-engine-gaps 纪律「纯引擎、零新运行时依赖」 |

---

## §2. 现状盘点与需求推演

### 2.1 现状（实读核实）

1. **解释器已存在**：`validate.ts`（#31 产物）是值 schema 树解释器——`validateSnapshot(derived, snapshot)` 对整份快照跑一遍。联合三段算法（判别式缓存跳转 → 候选过滤 → 接受扫描 → 最小距离报告）、全收集上限（100 条 + 截断标记）、工作预算（2×10⁸）、E100 崩溃边界齐备。**本票的值校验段 = 复用它，不是重写它。**
2. **resolve 双份并存**（#28/#31 评审留档欠账，实读核实）：
   - `resolve.ts:67 resolveChain(t, bodies)`——**IR 域**（`VfslType`），求值期使用，Map 查表，报错 `引用环: X` / `未声明别名 X`（无冒号）；
   - `validate.ts:122 resolveValues(t, ctx)`——**派生域**（`ValueSchema`），校验期使用，`Object.hasOwn` 守卫查表（#31 SA4 评审 F2 修复——原型链污染守卫，与本票 SA2 R1 的 F2 编号无关），报错 `值树引用环: X` / `值树未声明别名: X`（有冒号），带 refMemo。
   - 两份是**同一算法**（迭代 ref 链 + in-flight 环检测 + 未知名 loud）在两个类型域上的手写复制。ADR 0003 §4「解析动作由包内共享解析器完成」+ 后果「一切遍历经包内共享解析器」——现状双份本就是对齐欠账。
3. **patch 面不存在**：`index.ts` 无四函数导出，36 用例全红。
4. **结构守卫无先例消费结构树**：`validate.ts` 头注明确「结构树零消费（两树正交）」——本票的结构守卫是结构树的**第一个**消费者，正交纪律由「守卫只查结构树、值校验只走值树」保持（§3.1）。

### 2.2 需求推演（Feature 切入点）

写入管线的判定核心需要一个**路径级**入口：调用方持有 `derived`（编译缓存值）、当前 `base`（ROOT 快照值）、目标 `path`（段数组）与写入 `value`。两段判定的职责切分：

- **结构段（守卫）**回答「这个路径在这个 schema 的 Yjs 物化里存不存在、能不能下钻」——纯结构树问题，与值无关；
- **值段（重建校验）**回答「写进去之后，被写的那团数据还满足子 schema 吗」——判别联合只有看到判别字段才知道按哪个变体验（CONTEXT「重建校验」），所以必须**在最近结构边界重建整值**后整体过子 schema。

两段正交的工程红利：守卫不需要看 base 的值语义（只需 presence 与数组长度做下标判定）；值段不需要重复路径存在性判定（守卫已放行）。

### 2.3 为什么「最近结构边界」不能是「整份快照」

朴素实现 = `applyPath(base, path, value)` 后调 `validateSnapshot`——等价性测试（AC3#2/AC5）能绿，但被三件事否决：

1. **CONTEXT「重建校验」的定义性措辞**是「在最近结构边界合并当前值」，整快照重建违反定义；
2. **性能语义**：每次字段写入重校验整文档 = O(文档)，写入管线热路径不可接受；
3. **职责语义（零写入管线）**：patch 校验的是「这次写入」，不是「整份文档体检」。边界外的存量坏数据不是本次写入的责任（边界内存量坏数据**是**——重建值是一个必须整体合法的新值，AC6#2 的 149 个残留坏元素即证）。

---

## §3. 语义设计

### 3.1 公共接缝（AC1，签名与 SA6 锚定逐字对齐）

```ts
// index.ts 追加导出（四函数均：同步、纯函数、不抛错；结果纯 JSON 值）
export function validatePatch(
  derived: DerivedSchema,
  base: unknown,                        // 当前 ROOT 快照值（与 validateSnapshot 的 snapshot 同形状）
  path: Array<string | number>,         // 段数组；顶段即 ROOT 字段（ADR 0004 D5，不含 ROOT 前缀）
  value: unknown,                       // 写入值（替换语义）
): ValidateResult;

export function validateAppendToArray(derived: DerivedSchema, base: unknown, path: Array<string | number>, value: unknown): ValidateResult;
export function validateInsertIntoArray(derived: DerivedSchema, base: unknown, path: Array<string | number>, index: number, value: unknown): ValidateResult;
export function validateDeleteFromArray(derived: DerivedSchema, base: unknown, path: Array<string | number>, index: number): ValidateResult;

// ValidateResult / ValidateIssue 复用 validate.ts 既有导出（issue 恰含 message + path，无行列）
```

结果形状纪律（AC1 断言逐条对应）：成功字面量 `{ ok: true }`（恰一键）；失败字面量 `{ ok: false, issues }`（键序 ok → issues）；issue 恰含 `message: string` 与 `path: Array<string|number>`；JSON 往返全等；同输入两次调用输出全等；`derived` 与 `base` 不被修改。

**两段正交的落点**：结构守卫只消费 `derived.structure` + `derived.aliases`（结构树域）与 base 的 presence/长度；值校验只消费 `derived.values`（值树域，经共享解释器）。`derived.index` 零消费——它是**语法路径**键（`ROOT.assets.<key>` 这类含合成段的键），与运行时路径（`['assets','img1']` 含真实键名）不同键空间，直接查表不可行；结构树游走即路径索引语义的运行时形态（exact 字段 / `'<key>'` pattern 段 / array `<item>` 段），且不复活三级前缀匹配。

### 3.2 结构守卫（AC2）：结构树节点集游走

**数据事实**（evaluate.ts 实读）：结构树叶含 8 kind——`root/map/array/xml-fragment/leaf/plain/union/ref`；字段位 ref 按链终点分流（无子终态 plain/leaf/xml-fragment **内联**、结构形保持 `{kind:'ref',name}`，决策 F4）；Record 物化为 `map` + 单字段 `'<key>'`；全标量联合在结构树折叠为 `leaf`（两树正交的第一现场）。

游走以**节点集**推进（穿过 union 后一个位置可能有多个候选形状）：

```
guardWalk(derived, base, path, op):
  输入规整（§3.6）→ 三游标并行：
  S = 节点集（起点：derived.structure 必须 {kind:'root'}，取 .node，经共享结构树透镜解析 ref）
  V = 值树游标（起点：derived.values['ROOT']，先归一化——R2 冻结①；只游到边界为止，见 §3.3）
  b = base 游标（起点：base，须为 plain object，否则拒绝「当前文档值缺失或不是对象」）

  for i in 0 .. path.length-1:
    seg = path[i]; isFinal = (i == path.length-1)
    # —— 结构段判定（纯结构树，先于一切 base 检查：路径不存在时无需看 base）——
    if 本次下钻穿过了 union（S 中候选经成员展开才命中）: 记录 firstUnionCross = i（首次即冻结）
    S' = drill(S, seg)：                    # S/S' 均为对象身份去重 Set（R2 冻结③）
      每个候选节点 n（先经共享结构树透镜解析 ref）：
        n=union   → 递归各成员（「任一成员出现即存在」，ADR 0003 §3）
        n=map     → 先精确字段名匹配；未中且存在 '<key>' 字段 → Record 动态键放行（键 Pattern 属值级，见 §3.3 规则 2）
        n=array   → seg 须为整数 number（越界不在此判——越界是 base 长度问题，见下）
        n=leaf|plain|xml-fragment → ∅（终态拒绝下钻）
    S' 为空 → 拒绝（单 issue；path = 完整尝试路径；消息按 R2 冻结④的取序查拒绝矩阵）
    # —— base 段检查（结构放行后才查；R2 冻结②：形态 + 在场两段式）——
    ① 形态检查（对父容器 b）：seg 为 string → b 须为 plain object；seg 为 number → b 须为 Array。
       形态依据 = 接受该段的存活候选（map 形 → object；array 形 → Array；同一步接受候选恒同形态，
       见 R2 冻结④）。不满足 → 拒绝（矩阵行 11：消息含期望形态与 jsonTypeOf 实况）
    ② 在场/越界检查（对子值 b[seg]）：
       中间段（i < path.length-1）：object 形 → present(b, seg)；array 形 → seg ∈ [0, b.length)。
         缺失/越界 → 拒绝（矩阵行 11）
       终段 replace：object 形不查在场（写入即创建/覆盖）；array 形查越界（seg < b.length，
         界内即在场）→ 越界拒绝（矩阵行 4）
       终段数组三操作：查在场且子值须为 Array（append/insert/delete 作用于在场数组）→
         缺失或非 Array → 拒绝（矩阵行 12，F5）
    # —— 值树游标推进（仅当 i < 边界深度；越界即冻结，见 §3.3）——
    V 随段推进：当前游标先归一化（R2 冻结①），按 kind 取子——object 字段精确名 / '<key>' 槽 /
      array element；取出的子节点同样先归一化（解 optional（仅字段位）→ 经值树透镜解析 ref 链）
      再作下一游标
    结构树放行而值树无对应、或归一化后游标非 object/array 无法按段取子（手造/篡改派生物的
      两树分歧）→ InternalError → E100（loud，不静默降级）
```

**R2 冻结条款①（F1，HIGH）——值树游标归一化**：V 游标在**初始化与每次取子前后**都归一化——`(a)` 字段位取出的子节点先解包 optional（仅 object 字段值可为 optional 包装，D10）；`(b)` 再经**共享值树透镜**（`walkRefChain` + `derived.values` 查表，`Object.hasOwn` 守卫）解析 ref 链至非 ref 节点（memo 为 validatePatch 调用局部 Map，用后即弃——纯函数契约）；`(c)` 游标初始化 `values['ROOT']` 同样先解析（ROOT 身体可为 ref——`type ROOT = SomeMapAlias` 形）。由此**边界产出节点恒为归一化节点**（非 ref、非 optional）——解释器入口的 `resolveValues` 对其为恒等操作，与「边界保持 ref 委托解释器解析」语义等价；冻结取「恒归一化」以使推进规则无例外。**依据**（SA2 探针实证）：合法 schema `type ROOT = { profile: P }` 的 `values['ROOT'].fields[profile].value = {kind:'ref',name:'P'}`——值树字段位/`'<key>'` 槽/array 元素位常态为 ref 节点（IR 同态、永不展开，evaluate.ts `valueOf` ref 行）；不规定归一化则最普通的深层字段写入在合法派生物上产出假 E100。归一化后游标非 object/array（无法按段取子）= 两树形状分歧（手造派生物）→ InternalError → E100。

**R2 冻结条款②（F2，MEDIUM）——base 段检查两段式（形态 + 在场）**：base 检查不再只查 presence——每步先对**父容器 b** 做形态判定（string 段 → plain object；number 段 → Array），再对子值做在场/越界判定。这一改动封死 R1 的唯一静默 ok:true 路径（推演闭合）：`base={assets:42}` 写 `['assets','k']`——步 0（'assets'，中间段）父容器 = base 为 plain object ✓、在场 ✓ 放行，b 前进到 42；步 1（'k'，终段 replace）虽免在场，但**父容器形态检查命中**（'k' 为 string 段 → 父须 plain object → 42 是 number）→ loud 拒绝（行 11）；`base={profile:42}` 写 `['profile','displayName']` 同理在步 1 形态检查拒绝。合并基值（边界位值）由此必然是通过过形态检查的容器——`{...42, k:1}` 式 spread 塌缩不可达。终段 replace 的对象位**免在场但仍查父形态**（创建/覆盖语义只豁免「键已存在」，不豁免「父容器是容器」）。R1 矩阵行 11 与伪代码的矛盾（承诺「类型不符拒绝」却只查 presence）就此闭合。

**R2 冻结条款③（F3，MEDIUM）——节点集去重与工作量界**：S/S' 恒为**按节点对象身份去重的 Set**；drill 内的 union 成员递归展开同样带每步身份去重 visited 集（一个节点每步至多展开一次）。ref 目标按对象身份共享（`derived.aliases` 与 index 条目为同对象引用，derived.ts 不可变契约），故菱形/嵌套 union-of-ref 链（`U2 = U1 | {c}` 单步多级展开，SA2 探针实证可达）的去重有效。工作量界：每步 ≤ O(N)（N = 派生物内结构树节点总数），总界 **O(路径长 × N)**——公共 API 输入 O(L) 路径 + O(文本) 派生物不可放大出超线性工作量，DoS 面封顶。无去重的列表式实现按步乘法增长最坏 O(M^L)，禁止。

**R2 冻结条款④（F4，LOW）——混合候选的消息取序与检查归属**：S' 为空时消息按失败候选的**冻结 kind 序**取第一个命中形态：**leaf > plain > xml-fragment > array > map**（终态下钻失败最具体、优先报；array 形段类型/越界次之；map 形段类型/未知键最后）。归属消歧不需要「任一满足」条款——**同一步的接受候选恒同形态**：map 形候选只接受 string 段、array 形候选只接受 number 段、终态候选什么都不接受，故对任一给定 seg，接受者要么全 map 形（含 Record/union-of-maps）、要么全 array 形，形态/在场检查无归属歧义（比「任一满足即过」更强的结构性消歧；该性质同时使 E309 允许的 map|array 混合联合在 `['m',0]`/`['m','x']` 上各自无歧义放行、在 `['m',1.5]` 上按 array 形消息拒绝）。

**拒绝矩阵**（SA8 观察②：xml-fragment 终态位在列；所有守卫拒绝 = 恰 1 条 issue，path = 完整尝试路径，SA6 备注 3；多失败形态并存时消息按 R2 冻结④的取序 leaf > plain > xml-fragment > array > map）：

| # | 位置形态 | 段 | 判定 | issue path | 消息（冻结措辞） |
|---|---|---|---|---|---|
| 1 | 封闭 map（无此字段、无 `'<key>'`） | string | **拒绝** | 完整路径 | `路径不存在：未知字段 "<k>"（封闭对象不接受未声明键）` |
| 2 | Record map（`'<key>'` 在） | string | 放行（动态键空间） | — | — |
| 3 | `array`（YArray） | 整数 number ∈ [0, len) | 放行 | — | — |
| 4 | `array` | 整数 ≥ len（终段替换） | **拒绝**（D1 越界归运行时） | 完整路径 | `数组下标越界：下标 <n> 超出当前长度 <len>（替换语义要求 0 ≤ n < len）` |
| 5 | `array` | 非整数 / 负数 / string | **拒绝** | 完整路径 | `路径段类型错误：数组位置需要整数 number 下标段，收到 <实况>` |
| 6 | map / Record | number 段 | **拒绝** | 完整路径 | `路径段类型错误：对象位置需要 string 键段，收到 <实况>` |
| 7 | `leaf` | 任意 | **拒绝**（终态） | 完整路径 | `路径不存在："<k>" 位是原生叶子（leaf）终态，不接受下钻` |
| 8 | `plain` | 任意 | **拒绝**（终态，D1「YPlainArray 只能整体替换」） | 完整路径 | `路径不存在："<k>" 位是 YPlainArray 纯值终态，只能整体替换` |
| 9 | `xml-fragment` | 任意 | **拒绝**（终态，ADR 0003 §5） | 完整路径 | `路径不存在："<k>" 位是 YXmlFragment 不透明终态，路径下钻守卫到此为止（ADR 0003 §5）` |
| 10 | `union` | 任一成员放行即放行 | **任一成员出现即存在**（ADR 0003 §3） | — | — |
| 11 | 中间位/终段父容器 base 缺失或**形态不符**（R2 冻结②） | — | **拒绝** | 完整路径 | `路径穿越缺失或类型不符的容器：段 "<k>" 需要 <plain object\|数组>，实际 <jsonTypeOf>（字段级写入不自动创建/修复中间容器；请整体写入该容器值）` |
| 12 | 数组三操作目标缺失或当前值非 Array（F5，R2 新增） | — | **拒绝** | 完整目标路径（= path 参数原样） | `目标数组缺失或当前值不是数组：实际 <jsonTypeOf>（append/insert/delete 需要在场数组值）` |

推演锚点（36 用例中的守卫侧）：`['zzz']`/`['profile','nickname']` → 未知字段行；`['name','deep']` → leaf 行；`['attachments',0]` → plain 行；`['assets','text1','body','deep']` → xml-fragment 行（守卫跑完整路径后才拒绝，边界捕获不触发值校验）；`['items',5]` → 越界行；`['attachments']` 整值替换放行（终态位整值写合法）。

**presence 语义**复用 validate.ts 冻结的 `present()`（hasOwn 且值 ≠undefined——undefined 视同缺席）。

### 3.3 边界判定（值校验的重建点——本设计核心决策）

**判定规则**（按优先级，命中即止）：

| # | 条件 | 边界 | 依据 |
|---|---|---|---|
| 1 | 游走**穿过了 union**（union 是被穿越的中间位，含数组三操作路径穿过 union 的情形） | **第一个被穿越的 union 位** | 判别联合需整值可见（CONTEXT「重建校验」）；且值树游标无法静态穿越 union（成员选择依赖运行时值）——第一个 union 就是值树游标能到达的最深重建点。取**第一个**而非最后一个：更深的候选边界都在 union 之内，静态不可达 |
| 2 | 无 union 穿越，replace 且父容器是 **Record map**（终段经 `'<key>'` 放行） | **Record 位** | 键空间是运行时数据（键 Pattern 属 Record 值语义，validateObject Record 形逐键检查）；新建/覆盖条目 = 对 Record 容器的写入，键合法性必须随写入判定。成本 O(条目数)，v1 显式接受（决策 D4） |
| 3 | 无 union 穿越，replace 且父容器是 **array**（下标写入） | **数组位** | AC6#2 冻结：重建后 149 个残留坏元素 + 截断标记 = 整数组重建；数组是位置语义的整体 |
| 4 | 无 union 穿越，数组三操作 | **目标数组位** | 操作语义作用于数组整体（append/insert/delete 改变长度与下标） |
| 5 | 其余（终态整值替换 / 封闭对象字段写入 / union 位整值替换） | **目标位本身** | 封闭对象字段互相独立（键空间由 schema 冻结，无运行时键校验需求）；终态位写入即整值 |

**封闭 map 字段写入（规则 5）与 Record 条目写入（规则 2）的不对称是刻意的**：封闭对象的键空间由 schema 声明冻结（守卫的未知字段行已兜住），字段值只需自身合法；Record 的键空间是运行时数据，键 Pattern 只能在 Record 级值校验里判。同理**数组元素写入（规则 3）与封闭字段写入（规则 5）的不对称由 AC6#2 测试冻结**（`['items',0]` 写入后重建数组必须报出全部 149 个残留坏元素——元素写入的重建单位是数组，不是元素）。

**边界锚定推演**（全部 36 用例）：

| 用例路径 | 穿越位 | 边界 | 重建值 |
|---|---|---|---|
| `['profile','displayName']` | 无 | 目标位 | `'bob'`（整值，无合并） |
| `['name']` / `['attachments']` / `['m']` | 无 | 目标位 | 写入值本身 |
| `['items',0..1]` | 无 | `['items']` | base.items 下标替换后 |
| `['assets','img1','body']` | 穿 `['assets','img1']` union | `['assets','img1']` | `{...img1, body:'<p>x</p>'}` |
| `['m','y']` / `['m','x']`（UNION_FIXTURE） | 穿 `['m']` union | `['m']` | `{...m, y:'yy'}` 等 |
| append/insert/delete `['items']` | 无 | `['items']` | 追加/插入/删除后的数组 |
| `['assets','newKey']`（新键，未测但须闭合） | 无 | `['assets']`（规则 2） | `{...assets, newKey: v}` → 逐键 Pattern 检查覆盖新键 |
| `['u','x']` 嵌套 union（`m` 位 union 内字段又是 union，未测但须闭合） | 穿 `['m']` union | `['m']`（第一个，不是更深的） | 整个 m 值 + 相对路径 apply → union 全量校验兜住内层 |

**穿透 union 的数组操作**闭合（如 `['assets','file1','tags']` append）：规则 1 优先于规则 4——边界 = `['assets','file1']`，相对路径 `['tags']` 上执行 append，重建整个 file1 值过 AssetEntity 联合。若该成员根本没有 tags 字段（如对 img1 append tags），守卫在步 2 命中矩阵行 11/12（目标数组缺失）loud 拒绝，不静默。

**R2 补注（F2 联动）——合并基值的容器性由守卫保证**：边界位值（合并基值）在相对路径非空时必为「被下一段消费过的父容器」——R2 冻结②的逐步形态检查（每步对父容器 b 判定形态）覆盖了从 base 到边界的每一跳，故 rebuildOp 收到的基值必然是 plain object 或 Array，`{...非容器, k:v}` 式 spread 塌缩在入口处不可达；相对路径为空（整值替换）时基值不参与合并、无此约束。

### 3.4 值校验段（AC3/AC5/AC6）：共享解释器 + 路径 rebase

```
值校验（守卫全放行后执行）:
  1. boundaryValueNode = V 游标在边界处的值 schema 节点——R2 冻结①保证其恒为归一化节点
     （非 ref、非 optional；解释器入口 resolveValues 对其为恒等操作，语义与「保持 ref 委托
     解释器解析」等价）
  2. rebuilt = rebuildOp(baseAtBoundary, relativePath, op, payload)   // §3.5 拷贝式重建
  3. sub = validateSubtree(derived.values, boundaryValueNode, rebuilt) // validate.ts 新内部导出，§4.2
  4. sub.ok === true → { ok: true }
     否则 → { ok: false, issues: sub.issues.map(rebase) }
     rebase(issue) = { message 不动, path: boundaryPrefix ++ issue.path }（含截断标记）
```

- **单一来源**：`validateSubtree` 与 `validateSnapshot` 走**同一个** `interpret()` 主体（§4.2 抽取）——联合三段算法、判别式缓存透明性（ADR 0003 §3）、no-match「失败距离最小成员 + 联合成员 i/N」、全收集、100 条上限 + 截断标记、2×10⁸ 工作预算、E100 崩溃边界**逐字共享**。AC3#2/AC5 的全等断言因此由构造保证：子树校验的 issue 与整快照校验对同重建值的 issue 是同一台机器在同一相对根上的输出，patch 侧只做路径前缀拼接。
- **rebase 正确性推演**（AC3#2）：整快照路径报 `['assets','img1','body']`；patch 侧边界 `['assets','img1']`，子树相对 issue path `['body']`，拼得同一路径；message（含「联合成员 1/3：」前缀，由解释器 dive 生成）两侧同源。AC5 同理（相对 `[]` + 边界 `['profile','displayName']`）。
- **上限语义**（AC6#2）：子树跑满 100 条真实 issue 后第 101 条为截断标记（`/截断|truncat/i`），标记 path 按绝对路径纪律 rebase 为边界前缀（测试仅锚 isArray，取 rebase 保持「值校验 issue 按绝对路径」的一致性，SA6 备注 4）。
- **判别式缓存透明**（AC3#6）：解释器段 0 仅加速静默接受，`stripDiscriminators` 后输出全等——共享机器继承该性质，零新增代码。

### 3.5 数组三操作（AC4，D1 专用 API 的运行时判定面）

| op | index 域 | 越界/非法判定 | 元素类型校验 |
|---|---|---|---|
| `validateAppendToArray` | 无 index 参数 | — | 重建 `[...arr, v]` 过边界子 schema，坏元素报 `path + [len]`（新元素下标） |
| `validateInsertIntoArray` | `[0, len]` **含 len**（末尾 append 位；上界 > len 属设计自由，本设计冻结为闭区间上界 len——拒绝 index > len，与 append 语义无缝衔接且不引入「跳空插入」） | index 非整数 / 负 / > len → 守卫拒绝，issue path = `path ++ [index]` | 重建 `arr[0:index] ++ [v] ++ arr[index:]`，坏元素报重建后下标 |
| `validateDeleteFromArray` | `[0, len-1]` | index 非整数 / 负 / ≥ len → 守卫拒绝，issue path = `path ++ [index]` | 重建删除后数组过子 schema——**残留元素也校验**（AC4：badBase `['a',42]` 删 0 → 残留 `[42]` 拒绝，path 按重建后下标 `['items',0]`） |

三操作守卫前置判定：目标位（path 终点）经解析后须为 `array`（节点集含 array 候选即可，union-of-arrays 经规则 1 由值校验兜住）；`leaf` 位 → 拒绝（`['name']` 用例，矩阵行 7）；**`plain` 位 → 拒绝**——YPlainArray 是纯值终态，只接受整体替换，无序列编辑语义（D1，矩阵行 8）；目标在 base 中缺失或当前值非 Array → 拒绝（**矩阵行 12**，F5 冻结：path = 完整目标路径，消息含 jsonTypeOf 实况）。

**rebuildOp**（统一重建原语，四种 op 共用）：

```
rebuildOp(v0, relPath, op, payload):
  relPath 为空 → op 直接作用于 v0：replace→payload；append→[...v0, payload]；
    insert→切片拼接；delete→去下标切片（数组操作在此形态下 v0 必须 Array，守卫已保证）
  relPath 非空 → 沿 relPath 拷贝式下降（对象用 computed-key spread `{...o, [k]: 下层}`，
    数组用切片），在末端应用 op —— 全程零原地突变（纯函数契约）
```

**原型污染防护（安全纪律，必写进 SA3 注意事项）**：重建一律使用**计算键**展开（`{ ...o, [k]: v }`）或 `Object.defineProperty`，禁止字面 `__proto__:` 形式与点赋值——patch 键 `'__proto__'` 必须落为**自有属性**而非原型设置；读取侧一律 `Object.hasOwn` 守卫（复用 present()）。

### 3.6 输入规整与 loud 边界（AC1「不抛错」的兑现面）

守卫入口最先执行的规整判定（全部以结果返回，绝不 throw）：

| 输入 | 判定 | 消息 |
|---|---|---|
| `path` 非数组 / 空数组 / 含非 string-number 段 | 拒绝（issue path = `[]`——无合法尝试路径可报，F6 冻结） | `patch 路径无效：须为非空 string\|number 段数组` |
| `base` 非 plain object（含 null） | 拒绝（issue path = 完整尝试路径） | `当前文档值（base）缺失或不是对象：无法定位 ROOT 容器`（AC1 base=null 用例） |
| replace/append/insert 的 `value === undefined` | 拒绝（issue path = 完整尝试路径） | `patch 值不能为 undefined（JSON 值域外；数组删除请用 validateDeleteFromArray）`——undefined 在 present() 语义下等同缺席，写入它会制造「幽灵键」，必须 loud 拒绝而非静默吞 |
| insert/delete 的 `index` 非有限整数 | 拒绝（issue path = 完整尝试路径） | `数组下标无效：须为整数，收到 <实况>` |
| `derived.structure` 非 root 形 / `derived.values['ROOT']` 缺席 / 两树形状分歧（R2 冻结①归一化后游标非 object\|array） | InternalError → **E100**（手造派生物，loud 崩溃边界，与 validateSnapshot 同款；**issue path = `[]`**，F6 冻结） | `VFSL-E100: 内部错误（意外异常）: …` |

**R2 冻结（F6）——issue path 取值总表**：守卫拒绝（矩阵行 1–12）= 完整尝试路径；规整拒绝 = 完整尝试路径（path 本身非法时 = `[]`）；**E100（含 InternalError 类规整与顶层 catch 收编的一切异常）= `[]`**——与 validateSnapshot 的 E100 path 取值同款，SA3/SA7 无自由发挥空间。

守卫/重建/解释器全程包在顶层 try/catch：任何内部异常（篡改派生物的环、未知名、深嵌套栈溢出）收编为单条 E100 结果——「拒绝虚假降级」红线的落点：这里不存在静默 ok:true 路径，一切异常都变 loud 的 ok:false。

---

## §4. 解释器单一来源与 resolve 收敛（AC5 后半）

### 4.1 收敛形态：一算法 + 三透镜（设计自由的选择与弃案）

**选择**：`resolve.ts` 新增泛型共享解析核心 `walkRefChain<T>`（迭代 ref 链 + in-flight 环检测 + 未知名 loud + 可选 memo），三个类型域各提供一个**透镜**（lens，纯参数化、零算法复制）：

| 透镜 | 域 | 查表 | 环报错 | 缺席报错 | memo |
|---|---|---|---|---|---|
| IR 透镜（`resolveChain` 内部改用） | `VfslType` | `bodies.get(name)`（Map） | `引用环: X` | `未声明别名 X`（无冒号） | 无（现状） |
| 值树透镜（`resolveValues` 内部改用） | `ValueSchema` | `Object.hasOwn(ctx.values, n) ? … : undefined`（#31 SA4 F2 原型链守卫保持） | `值树引用环: X` | `值树未声明别名: X`（有冒号） | `ctx.refMemo`（next-hop 语义原样传入） |
| 结构树透镜（本票新增，validate-patch.ts 内） | `StructureNode` | `Object.hasOwn(derived.aliases, n) ? … : undefined` | `结构树引用环: X` | `结构树未声明别名: X` | 无（游走以路径长度为界） |

**「不得再添第三份」的论证**：结构树透镜不是第三份 resolve 循环——while 循环算法全仓从此**恰一份**（`walkRefChain`），透镜是它的参数化实例（isRef/nameOf/lookup/两个报错工厂）。这与 shapes.ts 的 clsOf/memo「同模式基础设施」先例同构（ADR 0003 §4 措辞）。

**弃案**（SA2 预答）：

- *值树走 IR 解析器*：不可行——校验期只有派生物，IR（`VfslModule`）不在手；且两域节点类型不同构。
- *派生物内联展开 ref 消灭解析*：违反 ADR 0003 §4（按名引用不内联；派生物 O(文本规模)；菱形 2^N 爆炸）；且改派生 schema 公共形状，触 SA8 观察③红线。
- *保留双份 + 结构树写第三份循环*：正是简报「不复制第三份」禁止项。

### 4.2 validate.ts 的两处机械改动（零行为变化）

```ts
// (1) resolveValues 变为薄包装（算法体移入 walkRefChain；报错文案经透镜工厂逐字节还原）:
function resolveValues(t: ValueSchema, ctx: Ctx): ValueSchema {
  return walkRefChain(t, valueLens(ctx), ctx.refMemo);   // memo 语义：next-hop，与现状逐位一致
}

// (2) 抽取共享解释器主体（validateSnapshot 与 validateSubtree 单一来源）:
function interpret(values: Record<string, ValueSchema>, root: ValueSchema | undefined, value: unknown): ValidateResult {
  try {
    if (root === undefined) throw new InternalError('值树缺少 ROOT 别名');   // 原 validateSnapshot 行为原样移入
    const ctx = createCtx(values);
    validateValue(root, value, [], ctx);
    if (ctx.overflow > 0) ctx.issues.push({ /* 截断标记，措辞原样 */ });
    return ctx.issues.length === 0 ? { ok: true } : { ok: false, issues: ctx.issues };
  } catch (err) { /* WorkBudgetExceeded / E100 两分支，措辞原样 */ }
}

export function validateSnapshot(derived: DerivedSchema, snapshot: unknown): ValidateResult {
  return interpret(derived.values, derived.values['ROOT'], snapshot);
}

/** 内部件（不进公共面）：子树校验——validatePatch 值校验段的单一来源。
 *  issue path 相对于子树根（[] 起步）；上限/预算/E100 与 validateSnapshot 同一实现。 */
export function validateSubtree(values: Record<string, ValueSchema>, node: ValueSchema, value: unknown): ValidateResult {
  return interpret(values, node, value);
}
```

**零行为变化承诺**（SA3 验收锚）：`validateSnapshot` 的可观测行为（issue 消息、顺序、上限、E100 文案）逐字节不变——现有 `validate-snapshot.test.ts`（35 例）+ `validate-snapshot-sa7.test.ts`（**14** 例，R2 勘误：R1 误写 10）+ fullchain-e2e（16 例）= 65 例绿基座（SA2 R1 复跑实证）+ 全仓既有测试全绿是硬门禁；本票对既有测试文件**零改动**。

### 4.3 walkRefChain 伪代码（冻结）

```ts
export interface RefChainLens<T> {
  isRef(node: T): boolean;
  nameOf(node: T): string;                 // 仅在 isRef 为真时被调用
  lookup(name: string): T | undefined;     // 调用方负责 own 守卫 / Map.get
  cycleError(name: string): Error;
  missingError(name: string): Error;
}

/** 包内共享解析核心（resolve.ts；不进公共面）：迭代沿 ref 链走到非 ref。
 *  环 → lens.cycleError（loud）；未知名 → lens.missingError（loud）；
 *  memo（可选）按 next-hop 语义逐访问节点读写——与 #31 resolveValues 现状逐位一致。 */
export function walkRefChain<T>(node: T, lens: RefChainLens<T>, memo?: Map<T, T>): T {
  const inFlight = new Set<string>();
  let cur = node;
  while (lens.isRef(cur)) {
    if (memo) { const hit = memo.get(cur); if (hit !== undefined) { cur = hit; continue; } }
    const name = lens.nameOf(cur);
    if (inFlight.has(name)) throw lens.cycleError(name);
    inFlight.add(name);
    const next = lens.lookup(name);
    if (next === undefined) throw lens.missingError(name);
    if (memo) memo.set(cur, next);
    cur = next;
  }
  return cur;
}
```

`resolveChain`（IR 侧）保留原签名与 undefined→TypeError 行为，内部委托 `walkRefChain`；报错经 IR 透镜工厂逐字节还原（含「未声明别名 X」无冒号的现状格式）——`evaluate.ts` 零改动。

---

## §5. 决策表（设计自由度的冻结）

| # | 决策点 | 冻结结果 | 依据 |
|---|---|---|---|
| D1 | 四函数命名 | 与 SA6 测试导出名逐字一致（`validatePatch` / `validateAppendToArray` / `validateInsertIntoArray` / `validateDeleteFromArray`） | SA6 备注 1（转绿契约） |
| D2 | insert 下标上界 | 闭区间 `[0, len]`（len = append 位）；index > len 拒绝 | SA6 备注 2（未冻结，属设计自由）；与 append 无缝衔接、不留「跳空插入」语义洞 |
| D3 | 守卫拒绝的 issue path | **完整尝试路径**（含失败点之后的段；数组操作的越界拒绝 = path ++ [index]） | SA6 备注 3 |
| D4 | Record 条目写入的边界 | Record 位（规则 2）——键 Pattern 随写入判定；O(条目数) 成本显式接受 | §3.3；键空间是运行时数据 |
| D5 | 值校验 issue path | 绝对路径（ROOT 起）= 边界前缀 ++ 相对路径，含截断标记 | SA6 备注 4 |
| D6 | 守卫拒绝 issue 数 | 恰 1 条（first-failure）；全收集语义只属于值校验段（共享解释器） | 守卫是存在性判定，单一失败原因即足以拒绝；AC6 的多 issue 用例全是值级 |
| D7 | 段类型严格性 | map/Record 位只收 string 段；array 位只收整数 number 段；拒绝一切静默 coerce（`'0'` 不当下标、`0` 不当键名） | D1 词表的运行时面是段数组；静默 coerce 制造双表示歧义 |
| D8 | 穿越 Record 时的键 Pattern | 不复检（守卫与规则 1 边界都不查存量键的 Pattern）——存量键按「可信文档」模型（每次写入经本管线/快照经 validateSnapshot）；新键由规则 2 的 Record 级重建覆盖 | 正交纪律 + 性能；AC3#2 全等性恰依赖此（整快照与 patch 对 validSnapshot 基座输出一致） |
| D9 | 空 path / undefined 值 / 非对象 base | 拒绝（§3.6 规整表），不抛错 | AC1 异常输入以结果返回 |
| D10 | optional 字段写入 | 合法（`notes?: …` 声明即存在，optional 是值级在场语义非结构存在性）；值树游标在字段位解包 optional | MapField.optional 是声明信息；守卫管存在性 |
| D11 | 字段清除（写 undefined） | v1 无此操作：undefined 值一律拒绝 | JSON 值域外 + present() 幂等语义；清除语义留待 PRD 层（不在本票） |
| D12 | `derived.index` | 零消费（语法路径键空间 ≠ 运行时路径） | §3.1；不复活三级前缀匹配 |
| D13（R2/F1） | 值树游标归一化 | 初始化与每次取子前后恒归一化：解 optional（仅字段位）→ 值树透镜解析 ref 至非 ref；边界产出节点恒归一化（与「委托解释器解析」等价，取无例外规则）；memo 调用局部 | SA2 探针实证：值树字段位/`'<key>'` 槽/元素位常态为 ref（valueOf IR 同态不展开）；不归一化则合法 schema 深层写入产假 E100 |
| D14（R2/F2） | base 段检查两段式 | 每步先形态（父容器：string 段→plain object / number 段→Array，按接受候选——恒同形态）后在场/越界；终段 replace 对象位免在场但**仍查父形态**；合并基值容器性由此入口保证，spread 塌缩静默 ok:true 清零 | R1 矩阵行 11 与伪代码矛盾的闭合；零静默接受路径承诺兑现 |
| D15（R2/F3） | 节点集去重 | S/S' 恒为对象身份去重 Set；union 递归展开带每步 visited；总界 O(路径长 × 结构树节点数) | 公共 API DoS 面封顶；无去重的 O(M^L) 列表式实现禁止 |
| D16（R2/F4） | 混合候选消息取序 | S' 为空时按 leaf > plain > xml-fragment > array > map 取第一命中形态；接受候选恒同形态（map 收 string/array 收 number 互斥）→ 检查归属无歧义 | E309 允许 map\|array 混合联合；SA3/SA7 输出确定性锚 |
| D17（R2/F5） | 三操作非 Array 目标 | 目标缺失或当前值非 Array → 矩阵行 12：path = 完整目标路径，消息 `目标数组缺失或当前值不是数组：实际 <jsonTypeOf>…` | SA2 指出 R1 矩阵无此行，SA3 自由发挥面清零 |
| D18（R2/F6） | E100 / 规整 issue path | E100 = `[]`（与 validateSnapshot 同款）；规整拒绝 = 完整尝试路径（path 非法时 `[]`）；守卫拒绝 = 完整尝试路径 | SA3/SA7 无自由发挥空间 |

---

## §6. 36 用例转绿推演（设计自证）

| 组 | 用例 → 设计行为 | 判定 |
|---|---|---|
| AC1×6 | 四函数经 index.ts 导出；成功 `{ok:true}`/失败 `{ok:false,issues}` 键序与形状按 §3.1 字面量构造；JSON 往返（结果纯 JSON）；纯函数（三游标只读 + 拷贝式重建 + ctx 调用局部）；不抛错（§3.6 规整 + 顶层 catch → E100；base=null → 规整拒绝） | ✅ |
| AC2×9 | 未知键（ROOT 层/深层）→ 矩阵行 1；leaf/plain/xml 下钻 → 矩阵终态行 7/8/9（path 全取完整尝试路径，`toContainEqual` 锚定）；越界 `['items',5]` → 矩阵行 4；plain 整值替换合法（终态位整值写）与非法（重建后 `期望数组，实际 string` 于 `['attachments']`）→ §3.3 规则 5 + 共享解释器；合法深层替换 → 规则 5 边界 + 字段值校验 | ✅ |
| AC3×6 | 交叉写入：边界 `['assets','img1']`（规则 1），重建后三成员全拒 → 解释器 no-match/候选分支报「联合成员 1/3」+ dive 字段级 issue → rebase 得 `['assets','img1','body']`；同源全等：同一 interpret() 相对输出 + 同一前缀拼接 ⇒ `toEqual` 成立；双向交叉（UNION_FIXTURE）距离最小成员 1/2、2/2（解释器 argmin 平局声明序）；自身字段类型错（`联合成员 1/2` + `类型不匹配` 同 message）；合法写入 → 判别式快路径静默接受；缓存透明 → 解释器段 0 性质继承 | ✅ |
| AC4×11 | 下标替换合法/类型错（规则 3 边界，path 含下标段）；append 合法/类型错（新下标 `['items',2]`）/非数组路径（守卫 leaf 行）；insert 中位/末位（D2 闭区间）/类型错（重建后下标）；delete 中末位/残留非法（整数组重建报 `['items',0]`）/越界（`['items',5]`）/非数组路径 | ✅ |
| AC5 | 非联合等价：边界 = 目标位，相对 `[]` rebase `['profile','displayName']`，与 validateSnapshot 同 interpret 输出全等 | ✅ |
| AC6×2 | 全收集：边界 = 目标位 `['m']`，重建整对象过 union → 字段级 2 issue（`['m','x']`/`['m','extra']`）恰 2 条非短路；上限：边界 `['items']` 整数组重建，149 坏元素 → 100 真实 + 截断标记 = 101 条，`['items',1]` 在列，标记消息含「截断/truncated」 | ✅ |

**R2 不变性核验（F1–F6 修订对 36 用例的影响 = 零）**：SA2 R1 已独立复核 R1 推演全部吻合，并实证三个 fixture 系统性避开了 R2 补规定缝隙——GUARD 内联对象（无 mid-walk ref）、FIXTURE 的值树 ref（`Audit`/`AssetEntity`）恰冻结在边界产出位（R1 §3.4「ref 不解析」条款本就覆盖该位，R2 冻结①的恒归一化在此位行为等价——解释器 resolveValues 恒等作用）、UNION 无别名。R2 修订逐条核对：①归一化对三 fixture 的 V 推进路径不引入新行为（原已到达的节点集合不变）；②两段式 base 检查对全部合法基座（validSnapshot/BASE/badBase 均为形态正确的容器）零新增拒绝；③去重是纯性能语义（候选集合不变）；④⑤⑥的消息/path 冻结不触碰 36 断言锚定的行为。**结论：§6 全表判定不变。**

**SA2 红线 fixture 家族的 R2 行为**（供 SA7/后续票对账，36 用例外）：`type P = { d: string }; type ROOT = { p: P; po?: P }` 深层写 `['p','d']`/`['po','d']`（mid-walk ref + optional ref）→ 归一化后正常放行/校验（不再假 E100），且与 validateSnapshot 同重建值 issue 全等；`type ROOT = { assets: Record<string, number> }` + `base={assets:42}` 写 `['assets','k']` → 矩阵行 11 loud 拒绝；`base={profile:42}` 写 `['profile','displayName']` → 同；`m: A|B`（A=map、B=array）混合联合 `['m',0]`/`['m','x']` 放行、`['m',1.5]` 恰 1 issue 按 array 形消息；`validateAppendToArray(derived, {items:42}, ['items'], 1)` → 矩阵行 12（path=`['items']`）；手造派生物（删 `values['ROOT']`）→ E100 且 `issues[0].path = []`。

---

## §7. 影响评估

1. **validateSnapshot 零行为变化**（§4.2 机械抽取 + 透镜委托，报错文案逐字节还原）——现有全仓测试（含 validate-snapshot 35 例 + validate-snapshot-sa7 **14** 例、fullchain-e2e 16 例，合计 65 例绿基座）零改动全绿是 SA3/SA7 的硬验收。
2. **公共面纯增量**：index.ts 只追加四函数导出；`DerivedSchema` 及全部既有类型零变更（SA8 观察③）。
3. **性能**：单次 validatePatch = 守卫 O(路径长 × 候选集) + 重建 O(边界子树) + 子树校验（共享预算 2×10⁸、memo、正则缓存全继承）；无模块级状态、无新增缓存失效面。
4. **并发/一致性**：纯函数、无共享可变态——天然线程安全（与 validateSnapshot 同纪律）。
5. **下游**：Phase 2 写入管线（WS/HTTP 入口）后续以本四函数为判定核心（零写入承诺的引擎侧兑付）；本票不暴露任何通道语义。

---

## §8. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/validate-patch.ts` — **新建**（~450 行）：四公共函数、输入规整、结构守卫节点集游走（R2 冻结③去重 Set）、base 两段式检查（R2 冻结②形态+在场）、边界判定、值树游标（R2 冻结①归一化）、rebuildOp（拷贝式 + 计算键防原型污染）、rebase、结构树透镜、顶层 E100 catch（R2 冻结 F6 path=[]）。
- `packages/vfsl/src/validate.ts` — **修改**（净 ~+60 行）：① `resolveValues` 改薄包装委托 `walkRefChain`（报错文案逐字节还原）；② 抽取 `interpret()` 共享主体；③ 新增内部导出 `validateSubtree`；④ **头注措辞随票更新**（SA2 R1 观察项）：「结构树零消费」收窄为「validate.ts 文件内零消费（结构树首消费者为本票 validate-patch.ts，两树正交纪律不变）」——防 SA4 静态门禁以全仓 grep「structure 消费」实现时误伤合法消费。`validateSnapshot` 可观测行为零变化。
- `packages/vfsl/src/resolve.ts` — **修改**（净 ~+50 行）：新增 `RefChainLens<T>` 接口 + `walkRefChain<T>` 泛型核心（包内导出，不进公共面）；`resolveChain` 内部委托、签名与报错不变。
- `packages/vfsl/src/index.ts` — **修改**（~+15 行）：追加四函数导出与 JSDoc（公共接缝说明）。
- `packages/vfsl/test/validate-patch.test.ts` — `[SA6 owned]` 验收红灯测试（已存在）。SA1/SA3 不改断言；仅允许 SA3 修测试基础设施级问题（如 import 路径），断言逻辑冻结。

### DENY LIST

- `packages/vfsl/src/evaluate.ts` — 求值器稳定；`resolveChain` 签名不变故零改动（实读核实其只经 `Resolver` 接口消费）。
- `packages/vfsl/src/derived.ts` — 派生 schema 公共形状冻结（ADR 0003 后果 + SA8 观察③）。
- `packages/vfsl/src/shapes.ts` / `ir.ts` / `parser.ts` / `semantic.ts` / `tokenizer.ts` / `pattern.ts` / `xml.ts` / `errors.ts` / `schemasource.ts` — 本任务不触碰的生产件。
- `packages/vfsl/test/` 下除 `validate-patch.test.ts` 外的一切测试文件 — 既有行为零变化的对账锚，改即违约。
- `packages/vfsl-codegen/**`、`packages/vfsl-protocol/**`、`domains/**` — ADR 0005 无关性裁定。
- `docs/**`、`.github/**`、根配置 — 不在工程任务范围。

## §9. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计仅涉及纯引擎层 TypeScript 代码（新增函数 + 包内机械重构），不包含 HTTP/WS 端点行为、端口/进程生命周期、跨进程资源假设或第三方库行为假设。全部行为依据为仓内源码实读（validate.ts / resolve.ts / evaluate.ts / derived.ts / index.ts / validate-patch.test.ts）与已接受 ADR 条款。

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计不修改任何既有函数的对外契约——

| 函数 | 改动性质 | 契约变化 |
|---|---|---|
| `resolveChain`（resolve.ts，内部件） | 内部委托 `walkRefChain` | **无**：签名 `(t: VfslType \| undefined) => VfslType`、TypeError/报错文案逐字节不变。唯一调用族：`evaluate.ts`（经 `buildResolver` 闭包，实读核实 **5** 处 `R.resolveChain(` 调用点——行 57/91/106/143/330，R2 勘误：R1 误写 7 处；另有 `R.typeCls(` 2 处，签名均不变）——零改动 |
| `resolveValues`（validate.ts，私有函数） | 内部委托 + 透镜 | **无**：私有（非导出），报错文案/memo 语义逐字节不变；无外部 caller |
| `validateSnapshot`（公共导出） | 主体抽取进 `interpret()` | **无**：签名、结果形状、issue 消息、上限/E100 行为逐字节不变。caller：`index.ts:57`（重导出）+ 全部经公共面的既有测试 |
| `validateSubtree`（**新增**内部导出，validate.ts） | 新函数 | 新接缝，**唯一 caller = validate-patch.ts**（本票新建）；不进 index.ts 公共面 |
| 四公共函数（**新增**） | 新函数 | index.ts 追加导出（纯增量公共面）；caller = 测试 + 下游 Phase 2 管线（未来） |

无 `return → throw`、无同步变异步、无 nullable 收紧——SA4 §1.5 五类清单零命中。

---

## SA2 反馈逐条回应（R2 · 2026-08-21）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| F1 (HIGH)：V 游标中途 ref 解析未规定——合法 schema 深层写入产假 E100 | ✅ | §3.2 R2 冻结① / §3.4 步骤 1 / D13 | 冻结：初始化与每次取子前后恒归一化（解 optional（仅字段位）→ 共享值树透镜解析 ref 至非 ref，memo 调用局部）；边界产出恒归一化节点，与「委托解释器解析」语义等价（解释器 resolveValues 恒等作用）——取无例外规则。归一化后非 object/array = 两树分歧 → E100。§6 R2 不变性核验：三 fixture 系统性避开 mid-walk ref（SA2 实证），36 用例判定不变；红线 fixture 家族（`p`/`po?` ref 字段、双层 ref 链）行为已写入 §6 |
| F2 (MEDIUM)：矩阵「类型不符拒绝」vs 伪代码 presence-only 矛盾；spread 塌缩静默 ok:true | ✅ | §3.2 R2 冻结② / 矩阵行 11 / §3.3 R2 补注 / D14 | 采纳方案 (a)：base 检查改两段式——每步先形态（父容器按接受候选：string 段→plain object / number 段→Array）后在场/越界；终段 replace 对象位免在场但仍查父形态。`{assets:42}` 写 `['assets','k']`、`{profile:42}` 写 `['profile','displayName']` 均在形态检查 loud 拒绝（推演写入冻结②）；合并基值容器性由守卫入口保证（§3.3 补注）——全设计静默 ok:true 路径清零 |
| F3 (MEDIUM)：节点集无去重语义 → O(M^L) DoS 面 | ✅ | §3.2 R2 冻结③ / D15 | 冻结：S/S' 恒为对象身份去重 Set，union 递归展开带每步 visited（ref 目标对象身份共享使嵌套 union-of-ref 链去重有效）；每步 ≤ O(N)、总界 O(路径长 × N)；列表式无去重实现明文禁止 |
| F4 (LOW)：混合候选拒绝消息不唯一 + presence 归属未写明 | ✅ | §3.2 R2 冻结④ / 矩阵注 / D16 | 冻结取序 leaf > plain > xml-fragment > array > map（S' 为空时取第一命中形态）；归属消歧采更强论证：同一步接受候选恒同形态（map 收 string / array 收 number 互斥、终态不收）——无需「任一满足」条款，`['m',0]`/`['m','x']`/`['m',1.5]` 行为已定 |
| F5 (LOW)：三操作「在场但非 Array」无矩阵行 | ✅ | 矩阵行 12 / §3.5 / D17 | 新增行 12：目标缺失或非 Array → 拒绝，path = 完整目标路径（path 参数原样），消息冻结 `目标数组缺失或当前值不是数组：实际 <jsonTypeOf>（append/insert/delete 需要在场数组值）` |
| F6 (LOW)：E100 issue path 未冻结 | ✅ | §3.6 R2 冻结 / D18 | 冻结总表：E100 = `[]`（与 validateSnapshot 同款）；规整拒绝 = 完整尝试路径（path 非法时 `[]`）；守卫拒绝 = 完整尝试路径 |
| F7 (LOW)：计数漂移 | ✅ | §4.2 / §7.1 / §10 | validate-snapshot-sa7 10→**14** 例（65 例绿基座）；resolveChain 调用点 7→**5** 处（行 57/91/106/143/330；typeCls 2 处另注） |
| 观察项（不计 severity）：validate.ts 头注「结构树零消费」语义收窄 | ✅ | §8 ALLOW validate.ts 条目④ | 头注措辞随票更新为「validate.ts 文件内零消费」，防 SA4 全仓 grep 静态锚点误伤 validate-patch.ts 合法消费 |

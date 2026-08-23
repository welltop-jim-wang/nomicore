# SA1 设计 — materializeRoot 修订轮 rev1（PR #84 owner Review 闭环：observer 重入语义定谳 + 验收强化）

- Issue: [#74](https://github.com/welltop-jim-wang/nomicore/issues/74)（修订轮 rev1，功能开发/验收强化混合）
- 分支：fix/issue-74-on-docs-doc-runtime-validation（Worktree: /home/wangjian/nomicore-fix-issue-74；run_id: issue-74-1787396362-3288866）
- 任务简报：`wiki/raw/task_doc-runtime-materialize-root-rev1.md`（owner Review 反馈全文 + 总控研判 + RAC-1~RAC-6）
- ADR 约束基准：`wiki/raw/task_doc-runtime-materialize-root-rev1_relevant_decisions.md`（SA8 摘录；ADR 0001–0007 全集 accepted）
- 冲突门禁：`wiki/raw/task_doc-runtime-materialize-root-rev1_conflict_report.md`（verdict=clear；**设计红线 W1/W2/W3 必须遵守**）
- 前序设计基线：`wiki/raw/task_doc-runtime-materialize-root_design.md`（D1–D10 / INV-1~INV-9 / F1–F10 / U1–U13 锚，本轮对照复用，不重复论证）
- 评审履历：R1（2026-08-22）经 SA2 攻击评审 **reject（窄幅）**——RD1/RD2~RD6 主体架构全部经受住攻击，#1 必修（⑤ 时点前提 R-7）+ #2~#5 顺带 + #6 nit；**R2 修订（本文）逐条落实**（§15 逐条回应表），核心架构与行为规格零变更。评审全文：`wiki/raw/task_doc-runtime-materialize-root-rev1_sa2_review.md`
- 设计期实测：本轮新增 27 项（yjs observer/事务语义 11 项含 R2 补测 N1/N2 + vfsl 接受域 10 项 + 现实现行为 13 项 + CI 命令 1 项；SA2 独立复验 P-1~P-7 另计，§9 全部命令与输出内联，SA4 可重跑）

---

## 摘要（一页看懂）

本轮是 PR #84 owner Review 的修订轮：前轮已实现并通过全链流水线（SA4/SA7 双清、AC 6/6），
owner 在合并前指出 6+1 项验收与契约缺口。经对**现实现**的逐项实测（§9.3）：RAC-2/3/4 要求的
**行为**已在基线实现中达标（copyJsonDomain 六词拒绝 / attr-`"` 构造拒绝 / 全量 round-trip /
clone 隔离——全部实测 `ok:false 恰 1 issue / 0 update / state 逐字节不变` 或 round-trip 语义等价），
缺口是**测试锚定**；RAC-1 存在真实**实现缺口**（`materializeRoot` 在 ④ 后无条件 `{ok:true}`，
observer 同步重入修改 ROOT 顶层后仍返回成功）；RAC-5 是断言收紧；RAC-6 是 CI 步骤缺席。

**本轮核心裁决（RD1，RAC-1 P1）**：`ok:true` 成功语义定谳为**出口 A——检测偏离响亮失败**，
形态为**事务后顶层完整性校验 + throw**（W1 唯一相容形态）。新增阶段 ⑤ `verifyInstall`：在
`doc.transact` 正常返回后、`return {ok:true}` 前，断言 **ROOT 顶层键数 === 计划 entries 数 且
每个计划键的值与安装值严格同一（`===`）**；任何偏离 ⇒ `throw Error('DOCRT-E201: …')`（fatal
家族，不回滚、不补偿、不返回 ok:false）。`ok:true` 的完整语义升级为 INV-10（§2.2）。出口 B
（文档化「仅承诺计划 set 已提交」）被否决：它把「返回成功但文档可能已腐蚀」制度化——正是本仓
反虚假降级立法禁止的静默降级形态（§2.1 六维对照）。

**检测面的诚实边界（明文登记，不夸大；R2 修订后边界登记共五处）**：⑤ 是对「ROOT 顶层」这一
**可精确构造不变量**的完整覆盖（exact-by-construction），不是「全部可能腐蚀」的宣称；检测基准是
**身份同一性**（`===`）而非语义等价——语义等价的异实例重插亦触发 E201，有意保守（R-8）。
**契约前提（R-7，R2 修订增补，SA2 #1）**：materializeRoot 的事务必须是 doc 的**最外层事务**——
调用方在未闭合外层事务内调用时 observer 延迟至外层 cleanup 执行、⑤ 空转（实测 §9.1 N1 + SA2 P-1：
atVerify fired=0 → afterOuter keys=["count","extra"]）；此前提以 JSDoc 前置条件段成文（§2.4）并以
characterization 用例 T-1 锁定（§10），**不采用** `doc._transaction` 运行时 guard（SA2 定谳）。
残余面（§2.3）：已安装子树内部的嵌套就地修改（G6 实证：顶层同一性保持而嵌套内容已变）、
observer 抛错路径（⑤ 不运行，F10 原样传播语义不变）、事务返回后的异步修改（契约时点=
「materializeRoot 返回时」，任何同步 API 都无法承诺返回后不变）。

### 决策总表（rev1 决策 RD*；基线 D1–D10 全部维持不变）

| # | 决策 | 一句话理由 | 依据 |
|---|---|---|---|
| RD1 | RAC-1 选**出口 A**：⑤ `verifyInstall` 顶层完整性校验（size + 逐键值同一性双断言），偏离 ⇒ `throw DOCRT-E201`；`ok:true` 语义升级为 INV-10；JSDoc 契约文档化（R2 增前置条件段，R-7），**零 ADR 修订** | 唯一与「失败⟹文档不变」「不虚假降级」全相容的响亮形态是 throw（W1）；顶层检测 exact-by-construction（前提：本函数事务为 doc 最外层事务 R-7；基准为身份同一性 R-8）；O(entries) 成本 | W1 红线；§9.1 G1–G8 + N1/N2 实测；§2 六维对照 |
| RD2 | RAC-2 锚定 8 行构造失败矩阵（unknown 位 Date/bigint/NaN/±Infinity/Yjs 类型/数组内 undefined + number 标量 NaN + XML attr-`"`）：先断言 `validateLogicalSnapshot ok:true`，再断言 ok:false + 恰 1 issue + 0 update + state 字节不变 | AC-4 零写入证明在「逻辑校验通过但构造失败」支路的直接验收缺口；现行为已达标（§9.3 实测），测试锁定 | 基线 D6/INV-9/F5/F8；§9.2/§9.3 |
| RD3 | RAC-3 定谳：**attr 值含 `"` 是有意的 materialization 约束**（维持现状，测试锁定）；wellFormedXml 与构造器的接受域差异**恰此一处**（DOCTYPE 两侧同拒）；表驱动 17 成功行 + 8 逻辑失败行 + 1 构造失败行，成功行断言为**语义等价比较器**（W2：canonical 解析 + 属性排序无关 + 引号归一 + last-wins，禁逐字断言） | yjs 序列化器不转义属性值（A12）：含 `"` 属性值必产出不可再校验文档（INV-9 破坏）；转义替代策略破坏逐字 span 可再校验性 | ADR-0003 校验下限条款；SA8 裁决二；§9.2/§9.4 X 系列 |
| RD4 | RAC-4 用 `extractYjsSnapshot` 做**全量语义比较**（union 三 variant 全比 / Record 键集 / Y.Array 逐元素含顺序 / leaf 值 / XML 经语义比较器——W3）+ 嵌套 plain object/array clone 隔离（unknown 位嵌套深结构 + YPlainArray，行为断言：突变输入后 extract 不变） | instanceof 断言可能假绿；语义比较是 ADR 既有入口（extractYjsSnapshot）的正用；W3 禁退化为字节相等 | 基线 INV-7/INV-9/U6/U7；§9.3 实测 |
| RD5 | RAC-5 收紧 observer 抛错测试：`toThrow('observer-boom')`（message 精确匹配）+ `observeCalls === 1`（单事务恰一次 type-observer 回调）+ 保留 updates===1 与「值未回滚」断言 | 泛化 `toThrow()` 可被任何异常满足；调用次数断言锚定 yjs 批处理语义（一次事务一次回调） | §9.1 V6/V8 实测 |
| RD6 | RAC-6 在 `ci.yml` test job 追加 materialize 专项存在性门禁步骤（brief 原文命令，含 `--typecheck --passWithNoTests=false`），置于「Domain scaffolds check」之后 | 防测试文件被删/未收集后静默假绿；同款先例 L43-44/L46-49；命令已本地实测通过 | §9.5 实测；ci.yml 现状 |

RAC-5（总控研判 #5「单次 update 不能单独证明构造先于事务」）按总控处置**并入 RD2**：以构造失败
矩阵的「0 update + state 字节不变」为原子性主锚，方法论说明写入 §3.3。

不变式清单（全文引用锚；INV-1~INV-9 见基线，零改动）：

- **INV-10（顶层安装完整性，本轮新增）**：⑤ 在 ④ 正常返回后、`return {ok:true}` 前执行：
  `rootMap.size === entries.length` 且对每个 `[key, value] ∈ entries` 有 `rootMap.get(key) === value`。
  任何偏离 ⇒ throw `DOCRT-E201`（不回滚、不补偿、不返回 ok:false；doc 保持 observer 留下的实际
  状态）。**`ok:true` 的完整语义**：(a) 全部计划 set 已在单次 `Y.transact` 提交（INV-2）且
  (b) 函数返回时 ROOT 顶层与计划逐键同一（本条）。

---

## §1. 背景、授权链与现状盘点

### 1.1 设计红线（SA8 冲突门禁 W1–W3，全文档约束基准）

| 红线 | 内容 | 本设计落位 |
|---|---|---|
| **W1** | RAC-1 出口 A 唯一与 ADR-0007 相容的形态是 **throw**（类比 internal/fatal、异常原样离开函数）；「事务提交后返回 ok:false / 结构化失败」「补偿修复写入」「声称已回滚」三种形态分别落入「零写入承诺」「不覆盖、不合并、不 fallback / 不尝试 fallback」「不虚假声称自动回滚」的违反面——即升级 hard-violation。「防止」类机制（抑制/延迟 observer 回调）无 ADR 依据亦无禁令，属设计评审面 | §2.2：⑤ 只 throw，无 ok:false 返回路径、无补偿写、message 明示「写入已提交、不回滚、不补偿」；防止类机制因 yjs 无 observer 抑制 API 而不可行（§2.1 第 6 维），未采用 |
| **W2** | XML 断言不得收紧为字符串逐字相同（ADR-0007 只承诺语义等价 round-trip）；失败场景保持单 issue + 零 update + state 不变 | §4.3：语义比较器（canonical 解析后比较）；全部失败行断言恰 1 issue + 0 update + state 字节不变 |
| **W3** | 「完整语义比较」对 XML 叶子必须经语义归一化比较（初轮 U12 锚同款），不得退化为字节相等 | §5：RAC-4 全量比较中 XML 路径经 §4.3 同款语义比较器 |

### 1.2 ADR 授权链（本轮触碰面）

摘自 relevant_decisions（编号可回查原文）：

1. **ADR-0007**（直接上游）：`materializeRoot` 条款（validate → detached 构造 → 确认空 → 单
   `Y.transact`；验证或构造失败零写入；不覆盖、不合并、不 fallback）；失败边界（「零写入承诺覆盖
   所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常……事务开始后若未知
   observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」）；
   「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同」；「成功只返回
   `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型」；Runtime 编排边界（「业务调用方不得取得
   可写 Yjs 引用或绕过该入口」——observer 纪律的归属层）。
   **SA8 裁决一**：`ok:true` 的 observer-后语义是 ADR **未定义空间**，出口 B 与条款直接相容，
   出口 A 受 W1 约束（仅 throw 形态）——两个出口均合法，裁决权在本设计。
2. **ADR-0003**：`xml-fragment` 终态节点、「运行时校验仅要求良构 XML」（**校验下限**条款——
   SA8 裁决二：不冻结物化构造接受域，校验域 ⊋ 构造域不违反任何条款）；ROOT 固定 Y.Map；联合
   any-of。
3. **ADR-0002**：「结构 → 值 → 单事务提交」三步纪律是失败语义（失败 ⟹ 文档不变）的上游依据；
   RAC-1 处置不得演化为 authority 式运行时不变式（⑤ 是完整性**检测**，不是运行时不变式执行器——
   检测到偏离只报告不修复）。
4. **ADR-0006**：三条目布局（RAC-2/3 的「state 字节不变」断言面覆盖整个 Y.Doc）；「事务原子性由
   Y.transact（单 update 单元）保证」。
5. **ADR-0001/0004/0005**：本轮零触碰（SCHEMA 信封、类型投影轨道、生成管线均无涉）。

### 1.3 实现现状盘点（本轮全部实测，§9.3；实现 = 前轮 ac0f487）

| 反馈项 | 实现现状 | 本轮动作 |
|---|---|---|
| RAC-1 | `materialize.ts:57-60`：④ 后无条件 `return { ok: true }`——observer 重入修改 ROOT 顶层后仍返回成功（owner 指认属实） | **实现变更**：新增 ⑤（RD1，§2.2）+ JSDoc 契约 |
| RAC-2 | 构造失败支路已实现且行为达标：unknown 位 Date/bigint/NaN/±Infinity/Yjs 类型/数组内 undefined、number 标量 NaN → 全部 `ok:false 恰 1 issue + 0 update + state 逐字节不变`（§9.3 实测 8/8）；XML attr-`"` 同款（F8） | **测试锚定**（SA6 新增 8 行矩阵） |
| RAC-3 | xml-parse.ts 已实现全部矩阵行为：17 类成功输入 round-trip 语义等价 + revalidate ok；attr-`"` 构造拒绝（§9.3/§9.4 实测）；attr 字母序重排/单双引号归一/self-closing 展开均为 yjs 投影 | **测试锚定**（表驱动 + 语义比较器）+ **定谳登记**（attr-`"` 有意约束） |
| RAC-4 | 全量 round-trip 与嵌套 clone 隔离已达标（§9.3 实测：嵌套深结构突变后 extract 不变） | **测试锚定**（instanceof → 语义比较 + 嵌套隔离行为断言） |
| RAC-5 | U13 现为泛化 `toThrow()` + updates===1 + 值未回滚 | **断言收紧**（SA6） |
| RAC-6 | ci.yml 无 materialize 专项步骤（现有 Test 步骤跑全量，但无「文件被删即红」的存在性门禁） | **CI 变更**（RD6） |

**关键现状结论**：本轮唯一的生产代码变更是 `materialize.ts` 的 ⑤ + JSDoc（约 +45 行，单文件）；
其余全部是测试锚定与 CI 步骤。基线 D1–D10/INV-1~INV-9/F1–F10 全部维持（F 表新增 F11 一行，§8）。

### 1.4 测试文件现状（SA6 冻结契约）

`packages/doc-runtime/test/materialize-root.test.ts`（405 行，13 用例 U1–U13，前轮全绿）。
本轮 SA6 将**同文件扩展**（决策：不新建文件——RAC-6 门禁命令以该文件为靶，全部 rev1 用例落位
同文件使存在性门禁覆盖本轮全部验收面）+ 收紧 U13。既有 12 用例断言零改动（U13 仅收紧断言强度，
语义不变：toThrow() ⊂ toThrow('observer-boom')）。

---

## §2. RD1 — RAC-1 裁决：observer 重入不抛错时的 `ok:true` 语义（P1）

### 2.1 出口 A vs 出口 B 六维对照（裁决依据）

owner 给出的两个出口（简报 §1）：

- **出口 A**：`ok:true` 保证返回时 ROOT 与输入物化结果一致 → 检测 observer 重入修改，偏离时响亮失败；
- **出口 B**：observer 修改属允许的事务后续反应 → ADR/API 明确 `ok:true` 仅表示计划 set 已提交。

| 维度 | 出口 A（检测 + 响亮失败） | 出口 B（文档化弱承诺） | 裁决倾向 |
|---|---|---|---|
| 1. 反虚假降级立法 | 偏离 = 「本应总为真的条件被破坏」（④ 与 ⑤ 之间无异步窗口，ROOT 顶层的唯一写入者就是本函数的 set 循环——§9.1 G1/G7 实证 observer 同步重入修改全部在 transact 返回前落定）→ 按「拒绝虚假降级」立法必须 loud assert，禁静默文档化 | 把「返回成功但文档可能已腐蚀」的歧义写进契约 = 制度化静默降级 | **A** |
| 2. 检测可精确性 | 顶层检测 **exact-by-construction**：不变量「rootMap 内容 === 本函数自己安装的 entries」完全由 ④ 的 set 循环确定，与 schema 形状无关（退化重叠联合等 extract 怪癖不影响顶层键集——基线 §6 已知边界只缩嵌套键不缩顶层）；于身份不变量无假阳性（G4：delete+同值**同实例**重插不误报；语义等价异实例替换属有意保守触发，R-8）；无假阴性于顶层向量（G1/G2/G3/G5/G7 全测） | —（不做检测） | **A** |
| 3. ADR 相容性与文档成本 | W1 下 throw 形态零 ADR 修订（fatal 家族的未定义空间延伸，SA8 裁决一第 3 点）；JSDoc 即可 | 必须 ADR-0007 带日期修订节（owner 原文「ADR/API 必须明确」+ SA8 W1「若以修订 ADR-0007 文本的方式执行出口 B，必须循 owner 裁决放行的带日期修订节惯例」） | **A** |
| 4. 残余腐蚀面 | 顶层全覆盖；嵌套就地修改不覆盖（§2.3 明文登记，交 ADR-0007 observer 纪律与 Runtime 编排治理） | 全部向量都不覆盖（顶层也不） | **A** |
| 5. 成本 | O(entries) 次只读 `get`/`size`，创建路径低频（基线 §8），可忽略 | 零 | **A**（成本不构成否决理由） |
| 6. 可行性（「防止」类机制） | yjs 无 observer 抑制/延迟 API（不可卸载他人 observer、无事务静默模式）——「防止」不可行，只能「检测」；W1 将防止类机制归设计评审面，本设计显式不采用（无机制支撑的承诺 = 虚假承诺） | — | 检测是 A 的唯一可实现形态 |
| 7. 与未来 Runtime 编排的一致性 | NamespaceRuntime 串行化写入把 fatal 作为进程级处置点（ADR-0007 Runtime 编排边界 + 失败边界）——⑤ 把「数据腐蚀」升级为「可处置的 fatal 信号」，与 F10（observer 抛错 fatal）同构，Runtime 无需为「静默腐蚀」单设通道 | Runtime 必须额外定义「ok:true 但文档已腐蚀」的处置通道（契约税） | **A** |

**对出口 B 最强反论的正视**：「检测永远不完整（嵌套就地修改测不到），A 给的是虚假安全感」。
回应：⑤ 的承诺面**从不说「全覆盖」**——它精确承诺「ROOT 顶层与计划逐键同一，偏离必 throw」，
这是可精确构造、于身份不变量无假阳性的最强不变量；残余面明文登记（§2.3）并由 ADR observer 纪律治理。比较
之下 B 连顶层向量（owner 点名的 delete/overwrite/insert extra key——恰全部在检测面内）都不设防。
**定谳：出口 A。**

### 2.2 ⑤ verifyInstall：算法、伪代码与精确性论证（W1 合规落地）

**编排变更**（基线 D1 四阶段 → 五阶段；①②③ 共享 E200 崩溃边界、④ 零捕获均不变）：

```ts
export function materializeRoot(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): MaterializeResult {
  const ready = prepare(derived, snapshot, doc);      // ①②③ + E200 崩溃边界（不变）
  if (ready.kind === 'fail') return { ok: false, issues: ready.issues }; // INV-3/INV-4（不变）
  // ④ 单事务安装 —— 零捕获（INV-5 不变）：observer 抛错 → 原异常 loud 传播（F10），⑤ 不运行
  doc.transact(() => {
    for (const [key, value] of ready.entries) ready.rootMap.set(key, value);
  });
  verifyInstall(ready);                               // ⑤ 新增（RD1/INV-10）：顶层完整性校验——
                                                      // 只读、无副作用、不在任何 try/catch 内
  return { ok: true };                                // ok:true 语义 = INV-2 + INV-10（JSDoc §2.4）
}

/**
 * ⑤ 事务后顶层完整性校验（RD1，INV-10）。双断言缺一不可（G5 实证：observer 同轮
 * delete 计划键 + insert 额外键可保持 size 相等而同一性破坏——只查 size 会漏报）。
 * 只读；任何偏离 → throw DOCRT-E201（W1 唯一相容形态：不返回 ok:false——事务已提交，
 * 「失败⟹文档不变」只覆盖验证/构造失败域；不补偿修复——「不覆盖、不合并、不 fallback」；
 * 不声称已回滚——message 明示写入已提交、doc 保持 observer 留下的实际状态）。
 */
function verifyInstall(ready: { rootMap: Y.Map<unknown>; entries: Array<[string, unknown]> }): void {
  const { rootMap, entries } = ready;
  if (rootMap.size !== entries.length) {
    // 覆盖向量：delete 计划键（size 减）/ insert 额外键（size 增）/ 组合
    throw new Error(
      `DOCRT-E201: ROOT 顶层安装完整性偏离：期望 ${entries.length} 个键，事务提交后实际 ` +
      `${rootMap.size} 个（实际键集：${JSON.stringify([...rootMap.keys()])}）——疑似 observer ` +
      `同步重入修改 ROOT；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
    );
  }
  for (const [key, value] of entries) {
    if (rootMap.get(key) !== value) {
      // 覆盖向量：overwrite 计划键（值不同一）/ delete 后重插异值 / delete 单键（size 断言亦会抓，
      // 此处兜底）。严格同一性（===）对标量（不可变）与引用类型（yjs set 按引用存储，A19/G5 实证
      // 集成后 get 返回同一实例）均正确：同值重插（G4）不误报。
      throw new Error(
        `DOCRT-E201: ROOT 顶层安装完整性偏离：键 "${key}" 的值在事务提交后与安装值不同一——` +
        `疑似 observer 覆写或删除后重插异值；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
      );
    }
  }
}
```

**精确性论证（身份不变量无假阳性 + 顶层无假阴性；前提 R-7）**：

1. **不变量的构造性（前提：本函数事务 = doc 最外层事务，§2.3 R-7）**：④ 与 ⑤ 在同一同步调用内
   顺序执行（run-to-completion），ROOT 顶层的唯一计划写入者就是 set 循环本身；任何第三方同步
   写入只能来自事务回调栈内的 observer。**在最外层事务前提下**，observer 的重入写在
   `doc.transact` 返回前全部落定且可见（§9.1 G1：delete 后 size=1 于 transact 返回后立即可见；
   G7：doc 级 `update` observer 的重入写同样在返回前可见）——若调用方在未闭合外层事务内调用，
   observer 延迟至外层 cleanup 执行，⑤ 空转，该论证不成立（§2.3 R-7 + §9.1 N1 复现）。
2. **鸽笼断言（额外键检测）**：entries.length 个键全部 present 且值同一 ⇒ Map 键唯一性 ⇒ 无任何
   额外键（G3：insert extra → size=2≠1 被抓）。
3. **双断言必要性（G5）**：observer 同轮 `delete('title') + set('extra','x')` → size=1 ===
   entries.length=1 而 `get('title') !== 't'`——size 断言单独漏报，identity 断言兜住；反向
   （只查 identity 不查 size）对 delete+insert 恰好也兜住（title 消失 → identity 破坏），但 size
   断言提供更早的失败点与更可诊断的 message（键集打印）。两断言并存。
4. **无假阳性（于「不触顶层」与「同实例同值重插」两类）**：诚实 observer（不触 ROOT 顶层）不可能
   破坏该不变量；语义等价的重入（delete + 同值重插**同实例**，G4 实测 identityOk=true）通过——
   检测的是**偏离**不是**活动**。注意 ⑤ 检测的是**身份级**（`===`）而非语义级偏离：语义等价的
   **异实例**替换（delete + 重插 deep-equal 的不同实例）也会触发 E201——有意保守，见 §2.3 R-8。
5. **不可检测面不做不可靠检测**：嵌套就地修改（G6：`inner.set('a', 999)` 后顶层同一性保持）需要
   全树语义比较才能抓，而 extract 语义怪癖（封闭对象未知 live 键跳过、联合全软拒不回退成员 0 的
   退化 schema 缩键——基线 §6 已知边界）会使全树比较在合法退化 schema 上**假阳性**——假阳性的
   fatal throw 违反响亮失败工具的诚实性，故不做（残余面登记 §2.3）。

**错误码命名空间注记**：`DOCRT-E201` 沿 doc-runtime 前缀序（E100=extract 内部、E200=materialize
意外异常、**E201=materialize 后验完整性偏离**）。vfsl 词法层另有裸 `E201`（`packages/vfsl/src/errors.ts:19`），
无前缀、不同命名空间，日志检索以 `DOCRT-E201` 全串为锚不冲突。

### 2.3 残余面与边界情形（明文登记，不夸大检测面）

| # | 情形 | 行为 | 定性 |
|---|---|---|---|
| R-1 | observer 对已安装子树**内部**就地修改（同一 Y.Map/Y.Array 实例内容变更 / 存量 plain 值容器内容变更） | ⑤ 不可见（G6 实证：topIdentityOk=true 而 inner 已改） | **残余面**。精确检测需全树语义比较，因 extract 怪癖会假阳性（§2.2 论证 5）故明确不做；治理归属：ADR-0007 observer 纪律（「Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报」+ Runtime 编排边界「业务调用方不得取得可写 Yjs 引用」） |
| R-2 | observer **抛错**（无论是否先做了修改） | ④ 的 `doc.transact` 原样抛出 observer 错误（F10，零改动）；**⑤ 不运行**——若 observer 先改后抛，doc 留有修改且不产生 E201 | F10 语义冻结（ADR-0007「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal」）；错误优先级：observer 原始错误 > 完整性报告 |
| R-3 | observer **异步**修改（setTimeout 等，transact 返回后才执行） | ⑤ 已通过、函数已返回 `ok:true`；之后 doc 被改不在任何同步 API 的承诺面内 | 契约时点定义为「**materializeRoot 返回时**」（owner 原文「返回时 ROOT 与输入物化结果一致」同款措辞）；返回后变更归调用方并发治理 |
| R-4 | observer **无界重入写**（无 guard，每次回调再写） | yjs 引擎层无限递归 → `RangeError: Maximum call stack size exceeded` 自 `doc.transact` 逃逸（G8 实证）→ F10 家族原样传播 | 引擎自毁式 loud 失败，materializeRoot 不额外包装；测试纪律：测试 observer 必须 one-shot/guarded（§10） |
| R-5 | observer 重入写产生**额外 update 事件**（重入写开启新事务） | updates 计数 = 1（本函数事务）+ observer 重入事务数（G1: 2 / G4: 3） | INV-2「成功路径恰 1 次 update」的语义澄清：指**本函数发起的事务**恰 1 次；RAC-1 测试断言「≥1 且首事务已提交」，不锁总数（observer 行为非本函数契约）；U8 既有断言（无 observer 场景）不变 |
| R-6 | entries 为空（全 optional 空快照，B12/T14 合法零写入成功） | size 0 === 0 恒过，⑤ 无操作 | 基线 §4.7 语义不变 |
| **R-7** | **调用方在未闭合的 Y.Doc 事务内调用 materializeRoot（契约前提破坏）** | yjs 事务归并：本函数的 `doc.transact` 并入外层事务，observer 与 update 事件延迟至**外层 cleanup** 才触发——⑤ 在 inner transact 返回时执行，observer 尚未运行（实测 §9.1 N1 / SA2 P-1：⑤ 位置 `fired=0 updates=0` 双断言空转通过 → `ok:true` 返回），随后外层 cleanup 中 observer 删改 ROOT 且**无 E201**；且返回时 INV-10(a)「已在单事务提交」亦为假（updates=0，尚未提交）——owner P1 要消灭的「返回成功但文档已（将）腐蚀」形态在此侧门复活 | **契约前提（非运行时 guard）**：materializeRoot 的事务必须是 doc 的**最外层事务**——调用方不得在未闭合事务内包裹调用（JSDoc §2.4 前置条件段成文）。不采用读 `doc._transaction` 的运行时 guard（SA2 #1 定谳：私有 API 耦合，风险大于收益；文档化前提 + 边界 characterization 测试 T-1 即 W1 相容的诚实形态）。高概率触发形态预警：未来 create 流程（ADR-0006 三条目 SCHEMA+META+ROOT 单 update 单元）若把 materializeRoot 包进一个外层事务即落入本边界——届时须先改设计再动实现（characterization 用例红灯即门禁） |
| **R-8** | observer 做语义等价的**异实例**替换（delete 计划键 + 重插 deep-equal 的不同实例） | size 相等、identity（`===`）破坏 → **E201**（文档语义与计划完全等价仍抛） | **有意保守（登记非缺陷）**：⑤ 检测的是**身份级**偏离——身份不变量可精确构造（§2.2 论证 1），语义比较会引入 extract 怪癖假阳性（论证 5 同款理由）；E201 message「疑似 observer 覆写」的措辞在此情形下偏保守但不错误（确有重入改写活动）。配套可选用例 T-4（§10）测试化 |

### 2.4 API/ADR 文档化方案（RD1 的契约面落地）

**JSDoc（唯一文档化载体；`materialize.ts` 公共入口 doc comment 增补，SA3 落地）**：

```ts
/**
 * 唯一公共物化入口（ADR-0007）：同步、错误经返回值传递（④/⑤ 的异常是唯一例外——D1/RD1）。
 *
 * ⚠️ 前置条件（契约前提，R2 修订增补）：本函数的事务必须是该 Y.Doc 的**最外层事务**——
 * 调用方不得在未闭合的 doc.transact 内调用。若被外层事务包裹，本函数事务并入外层，
 * observer 与 update 延迟至外层 cleanup 才执行：⑤ 完整性校验将空转通过并返回 ok:true，
 * 随后 observer 的 ROOT 删改不受检测（且返回时计划 set 尚未提交）——检测面失效。
 *
 * 成功语义（ok:true 的完整承诺，PR #84 owner Review 修订轮 R1 定谳 / INV-10）：
 * 1. 全部计划 set 已在单次 Y.transact 提交（ADR-0006 单 update 单元）；
 * 2. 本函数返回时，ROOT 顶层恰为计划键集且逐键值与安装值严格同一——在上述前置条件成立的
 *    前提下，任何同步重入的 observer 对 ROOT 顶层的 delete / 覆写 / 插入额外键都会被
 *    ⑤ verifyInstall 检测，检测到偏离即 throw DOCRT-E201（Runtime internal/fatal 家族：
 *    写入已提交、不回滚、不补偿、不返回 ok:false；doc 保持 observer 留下的实际状态）。
 *
 * 检测面边界（明文）：⑤ 覆盖 ROOT 顶层（exact-by-construction），检测基准是**身份同一性**
 * （===）而非语义等价——语义等价的异实例重插亦触发 E201（有意保守）。不覆盖：observer 对
 * 已安装子树内部的嵌套就地修改、异步修改（契约时点 = 本函数返回时）、以及前置条件被破坏时
 * 的全部 observer 反应——该面由 ADR-0007 observer 纪律治理（Yjs observer 不得向事务调用栈
 * 抛异常；Runtime 编排边界：业务调用方不得取得可写 Yjs 引用）。observer 抛错时错误原样
 * 传播（F10），⑤ 不运行。
 */
```

**零 ADR 修订的理由**（对照 SA8 W1 尾注与裁决一第 2/3 点）：

1. owner 的 ADR/API 文档化要求是**条件式**：「如果 observer 修改属于允许的事务后续反应，则
   ADR/API 必须明确 ok:true 仅表示……」——该条件在出口 A 下不成立（observer 顶层修改**不是**
   允许的后续反应，而是被检测并 fatal 的偏离）。
2. 出口 A 是 ADR-0007 fatal 家族在未定义空间的**延伸**（SA8 裁决一第 3 点原文：「把 fatal 语义
   按类比扩展到该情形是对未定义空间的延伸，不修订既有条款」），throw 形态与既有条款零触碰；
   ADR-0007「成功只返回 { ok:true }」不变（⑤ 偏离时**不返回**，throw）。
3. ADR 修订节惯例（owner 裁决放行的带日期增量修订）保留给出路 B 的假设情形；本轮 `docs/adr/**`
   零改动（DENY LIST 明示）。

### 2.5 F10 与 F11 的分界（失败分类学收口）

| 情形 | observer 抛错？ | 顶层偏离？ | 出口 | 分类 |
|---|---|---|---|---|
| 事务内 observer 抛错 | 是 | （可能已改） | **原异常原样传播**（⑤ 不运行） | F10（既有，零改动） |
| observer 不抛错、顶层偏离 | 否 | 是 | **throw DOCRT-E201**（⑤ 检测） | **F11（本轮新增，§8）** |
| observer 不抛错、仅嵌套就地修改 | 否 | 否 | `ok:true`（残余面 R-1） | 非失败类（ADR observer 纪律治理） |
| 调用方包裹于未闭合外层事务（前提破坏，R-7） | 否 | 返回时无、外层 cleanup 后有 | `ok:true` 已返回（⑤ 空转，无 E201） | 非失败类——契约前提破坏（R-7；characterization 用例 T-1 锁定，未来改动须走设计评审） |
| 无 observer 干扰 | — | 否 | `ok:true` | 成功（INV-2 + INV-10） |

---

## §3. RD2 — RAC-2：detached 构造失败零写入测试矩阵（High #2 + Medium #5 并入）

### 3.1 载体可达性（全部实测，§9.2/§9.3）

构造失败支路的前提是**逻辑校验通过**（AC-4 的「构造失败」分支才被触达）。可达载体及其验证通过
依据：VFSL `unknown` 原语在 leaf 位无条件接受一切值（`validate.ts:460` `t.type === 'unknown' ?
true`——Date/bigint/NaN/±Infinity/function/symbol/Yjs 实例/数组内 undefined 全部 `ok:true`，
基线 P17 + 本轮 §9.2 复测）；`typeof NaN === 'number'` 使 NaN 通过 number 标量位（§9.2）；
XML attr-`"` 通过 `wellFormedXml`（引号内字面量，§9.2）。**即：以下每一行都是「① 绿 → ② 红」
的真实构造失败路径，不是逻辑失败。**

### 3.2 测试矩阵（8 行，SA6 落位于 materialize-root.test.ts 新 describe）

统一断言模板（每行全部执行，顺序即断言顺序——**先证前置再证失败**，owner 反馈 #2 原文要求）：

```ts
// (1) 前置：逻辑校验通过（证明走的是构造失败支路，而非逻辑失败支路）
expect(validateLogicalSnapshot(derived, snapshot).ok).toBe(true);
const before = stateBytes(doc); const events = countUpdates(doc);
// (2) 物化失败
const result = materializeRoot(derived, snapshot, doc);
expect(result.ok).toBe(false);
// (3) 恰 1 条 materialization issue（INV-3 fail-fast；message 非空 + path 数组形态）
expect(result.issues).toHaveLength(1); // + message 非空字符串 / Array.isArray(path)
// (4) 零写入双证：0 update 事件 + Y.encodeStateAsUpdate 逐字节不变
expect(events.count).toBe(0);
expect(stateBytes(doc)).toEqual(before);
```

| # | fixture（VFSL 文本） | snapshot 载体值 | 预期 issue 类（基线 F 表） |
|---|---|---|---|
| C-1 | `type ROOT = { u: unknown };` | `u: new Date(0)` | F5 纯值域违规（non-plain object，constructor: Date） |
| C-2 | 同上 | `u: 10n` | F5（bigint） |
| C-3 | 同上 | `u: NaN` | F5（non-finite number） |
| C-4 | 同上 | `u: Infinity`（另跑 `-Infinity` 同款行） | F5（non-finite number） |
| C-5 | 同上 | `u: new Y.Map()`（Yjs 类型；`new Y.Array()` 同款行） | F5（内嵌 Y 类型，载体词 Y.Map） |
| C-6 | `type ROOT = { u: unknown; arr: unknown[] };` | `arr: [undefined]`（数组内 undefined） | F5（undefined，内部位置 `[0]`） |
| C-7 | `type ROOT = { n: number };` | `n: NaN`（number 标量位：typeof NaN === 'number' 过 ①） | F5（non-finite number，标量拆支） |
| C-8 | `type ROOT = { body: YXmlFragment<{ p: string }> };` | `body: '<p title=\'a"b\'>x</p>'`（XML parser 构造期拒绝分支） | F8 XML 解析失败（属性值含双引号） |

（`YXmlFragment<{ p: string }>` 语法合法性依据：`packages/vfsl/test/evaluate-derived-schema.test.ts:325`
同款 fixture 先例。）C-1~C-7 现实现行为已实测达标（§9.3 RAC2 段 8/8 `ok:false nIssues=1
updates=0 stateEq=true`）；C-8 同款（§9.3 RAC3 attr-quote 行）。**SA3 若实现有缺口则修——本轮
实测无缺口，预期零生产变更。**

### 3.3 原子性主锚方法论（owner 反馈 #5 并入，总控研判裁定不单独立项）

`events.count === 1`（U8）只证成功路径单事务，不能排除「构造发生在事务内、失败时留部分写入」。
**原子性主锚 = 本矩阵的「0 update + state 字节不变」双断言**（构造失败 ⇒ 事务从未开启 ⇒ 无任何
写入痕迹——这从反证面锁定「全部构造成功后才执行 transaction」）。补充说明（不新增测试）：基线
D1 的结构性保证（prepare 与 transact 是两个函数体，② 的产物全 detached、对 doc 零触碰）是构造
先于事务的**构造性**证明，U8+C 矩阵共同构成行为锚。owner 建议的「transaction/observer
instrumentation 验证事务开始前 ROOT 未被写入」被 C 矩阵的反证面覆盖（若实现偷懒把构造塞进事务，
C 行的 0 update/state 不变必然红），不需要独立 instrumentation 测试。

---

## §4. RD3 — RAC-3：xml-parse 表驱动矩阵 + 接受域差异定谳（High #3）

### 4.1 定谳：attr 值含 `"` 是**有意的 materialization 约束**（维持现状 + 测试锁定）

owner 问：`<p title='a"b'>x</p>` 通过逻辑校验却在 materialize 阶段失败——是有意约束还是缺陷？

**定谳：有意约束（初轮 D7 规则 3 的既有决策，本轮显性化 + 测试锁定 + 接受域差异清点）。** 论据：

1. **yjs 序列化器不转义属性值**（基线实测 A12：`alt='an "alt" & <tag>'` 输出
   `alt="an "alt" & <tag>"`——引号截断、产出非良构 XML；本轮 §9.4 复测确认投影行为）。
   任何含 `"` 的属性值经 extract 的 `toString()` 投影必产出**不可再校验**的 XML 字符串——写入即
   制造 extract 侧永远无法整读回的文档（INV-9 往返域对称被破坏，基线 §2.2 的系统性脏数据源论证）。
2. **替代策略均更劣**：(a) 存储时转义为 `&quot;`——文本域已有的字面 `&quot;`（规则 1 逐字保留，
   §9.4 X 系列实证 `&amp;`/`&lt;` 字面往返）与转义产物无法区分，语义等价承诺被破坏；(b) extract
   侧反转义——extract 的 XML 投影是 yjs 内建 `toString()`，doc-runtime 无法在不重写序列化器的
   前提下注入转义（重写序列化器 = 另一轮大改，超出本轮范围且引入新投影面）；(c) 放宽（接受 `"`）——
   即接受「写入后 extract 产出非良构字符串、revalidate 必挂」的文档，最劣。
3. **ADR 合规**：ADR-0003「运行时校验仅要求良构 XML」是**校验下限**条款，不冻结构造接受域
   （SA8 裁决二第 1 点：「校验域 ⊋ 构造域不违反任何条款」）；ADR-0007 明文预期「校验通过但
   detached 构造失败」这一类（「零写入承诺覆盖所有验证失败和 **detached 构造失败**」）。
   `ok:false + 恰 1 issue + 0 update + state 字节不变` 正是该失败类的规定出口。

**锁定方式（双锚）**：C-8（RAC-2 矩阵行，§3.2）+ X-F（本矩阵构造失败行，§4.2）。

### 4.2 接受域差异全量清点（wellFormedXml vs xml-parse 扫描器）

两侧文法骨架逐条镜像（基线 D7「文法镜像同步义务」维持）。本轮对 `packages/vfsl/src/xml.ts`
与 `packages/doc-runtime/src/xml-parse.ts` 全文比对 + `§9.2/§9.4` 实测：

| 输入类 | `wellFormedXml`（① 校验域） | xml-parse 扫描器（② 构造域） | 分歧 |
|---|---|---|---|
| 注释 `<!--…-->` / CDATA / PI | 接受（配对扫描） | 接受（逐字 XmlText 承载） | 无 |
| 未闭合注释/CDATA/PI | 拒绝（① 逻辑失败） | 不可达（① 已拒；扫描器同款守卫为防御纵深） | 无 |
| `<!DOCTYPE` | **拒绝**（'DOCTYPE 声明不支持'） | **拒绝**（同款 reason，xml-parse.ts:119-120） | **无**（两侧同拒——DOCTYPE 是逻辑失败不是构造失败，实测 §9.2） |
| **属性值含 `"`（单引号包裹）** | **接受**（引号到引号字面量，xml.ts:9-10 注释成文） | **构造期拒绝**（xml-parse.ts:177-181，F8） | **唯一分歧（有意，§4.1）** |
| 属性值含 `<` `>` `&` `'`（双引号包裹 `'`） | 接受 | 接受（实测 `<p title="a<b&c">x</p>` 与 `<p title="a'b">x</p>` round-trip 语义等价 + revalidate ok，§9.4） | 无 |
| 多根 fragment / 顶层文本 / 空串 | 接受（片段语义 R2 放宽成文） | 接受（顶层多子节点 / 空 fragment） | 无 |
| 属性未加引号 / 缺 `=` / 引号未闭合 / 标签不匹配 / 未闭合 / 裸 `<` | 拒绝（①） | 不可达（① 已拒） | 无 |
| 属性引号形态（单/双）与重复属性 | 均接受（重复属性扫描侧 last-wins 是构造语义非分歧点） | 单双引号均解析；重复 last-wins（yjs setAttribute 覆盖） | 无（投影差异归 §4.3 语义比较器处理） |

**结论**：接受域差异**恰一处**（attr-`"`，有意约束）。除此之外两域同构；「文法镜像同步义务」
（两侧字符集/惰性 span 识别同步演化）继续由两文件头注互相登记（零代码改动）。

### 4.3 表驱动矩阵（SA6 落位；成功 17 行 + 逻辑失败 8 行 + 构造失败 1 行）

**成功行断言模板（W2 合规——语义等价，禁逐字）**：

```ts
const doc = new Y.Doc();
const events = countUpdates(doc);
expect(materializeRoot(dXml, { body: input }, doc).ok).toBe(true);
expect(events.count).toBe(1);                        // 单事务（U8 语义在 XML 面的锚定）
const ex = extractYjsSnapshot(dXml, doc);            // ex.ok === true 前置
expectXmlSemanticallyEqual((ex.snapshot as {body: string}).body, input); // 与【输入】语义比较
expect(validateLogicalSnapshot(dXml, ex.snapshot).ok).toBe(true);        // revalidate（AC-5 主锚）
```

| # | 输入（input） | 锁定语义（yjs 投影差异已在实测中观察，断言不锁投影） |
|---|---|---|
| X-1 | `<p title="a<b&c">x</p>` | 属性值含裸 `<` `&`：引号内字面量往返（实测字节还原，断言语义） |
| X-2 | `<e k='v'/>` | 单引号属性 → 双引号重排（实测 `<e k="v"></e>`） |
| X-3 | `<p title="a'b">x</p>` | 双引号包裹单引号值（实测字节还原） |
| X-4 | `<e b="2" a="1"/>` | **属性字母序重排**（实测 → `<e a="1" b="2">`）——比较器必须排序无关 |
| X-5 | `<e k=""/>` | 空属性值（yjs 投影 `k=""`） |
| X-6 | `<p>x<!-- note -->y</p>` | 注释逐字承载（元素内） |
| X-7 | `<![CDATA[a < b]]>` | 顶层 CDATA 逐字承载 |
| X-8 | `<?pi data?>` | 顶层 PI 逐字承载 |
| X-9 | `<p>a</p><p>b</p>` | 多根 fragment |
| X-10 | `top text <b/>` | 顶层文本 + 混合内容 |
| X-11 | `''`（空 XML） | 空 fragment → `''`（wellFormedXml('')===null 合法） |
| X-12 | `<e/>` | self-closing → 显式闭合展开（实测 `<e></e>`） |
| X-13 | `<e></e>` | 空元素 |
| X-14 | `<e k='v' k='w'/>` | **重复属性 last-wins**（实测 → `k="w"`）——比较器解析侧同款 last-wins |
| X-15 | `<p>\n  <b>x</b>\n</p>` | 格式化 whitespace（文本 span 逐字保留） |
| X-16 | `<p>x &amp; y &lt; z</p>` | 实体字面量逐字保留（规则 1：不解码） |
| X-17 | `<ns:item-2.x/>` | 元素名字符集宽域（基线 B9：`[A-Za-z_:][A-Za-z0-9_.:-]*`） |

**逻辑失败行断言模板**（这些输入在 ① 就被拒。R2 修订（SA2 #2）：追加**恰 1 条双断言**——
RAC-3 简报原文「失败场景**单 issue** + 零 update + state 不变」的字面锚定；X-F1~X-F8 全部是
**单违规输入**，实测（SA2 P-6，8/8）与 §9.2 直调均为恰 1 条，锁的是这 8 行的行为而非 validate
的全收集语义——多违规输入的全收集由 U1 锚不变地守护）：

```ts
const direct = validateLogicalSnapshot(dXml, { body: bad });
expect(direct.ok).toBe(false);
if (!direct.ok) expect(direct.issues).toHaveLength(1); // 恰 1（单违规输入——RAC-3 字面锚，SA2 P-6 8/8）
const result = materializeRoot(dXml, { body: bad }, doc);
expect(result.ok).toBe(false);
if (!result.ok) {
  expect(result.issues).toHaveLength(1);               // 恰 1（透传侧同锁）
  expect(result.issues).toEqual(direct.issues);        // 引用零损透传（D2/F1）
}
expect(events.count).toBe(0);
expect(stateBytes(doc)).toEqual(before);
```

| # | 输入 | 拒绝原因（validate.ts:513 携带 wellFormedXml detail） |
|---|---|---|
| X-F1 | `<p>` | 标签未闭合 |
| X-F2 | `<p></b>` | 结束标签与开始标签不匹配 |
| X-F3 | `<!--` | 未闭合的注释 |
| X-F4 | `<![CDATA[a` | 未闭合的 CDATA 段 |
| X-F5 | `<?pi` | 未闭合的处理指令 |
| X-F6 | `<!DOCTYPE x>` | DOCTYPE 声明不支持（两侧同拒，§4.2） |
| X-F7 | `x < y` | 文本中裸 `<` 后非合法标签起点 |
| X-F8 | `<e k=v/>` | 属性值必须加引号 |

**构造失败行（定谳锁定行，与 C-8 同锚不重复实现——SA6 落一条即可，断言模板同 §3.2）**：

| # | 输入 | 出口 |
|---|---|---|
| X-F9 | `<p title='a"b'>x</p>` | preValidate ok:true → materialize ok:false 恰 1 issue（F8）+ 0 update + state 字节不变——**§4.1 定谳的测试锁定** |

### 4.4 测试侧语义比较器（W2 合规的落地件，SA6 在测试文件内实现）

`expectXmlSemanticallyEqual(actual, expected)`（测试局部 helper，约 40 行）：

1. **解析**：两侧各过一遍测试侧 mini 扫描器（文法镜像 vfsl wellFormedXml 的 token 识别：元素 /
   属性（单双引号等价、**重复属性 last-wins 入 Map**）/ 文本 run / 注释·CDATA·PI 作为不透明
   逐字 token）产出 token 树（fragment = 有序子节点列表）。
2. **canonical 序列化**：元素 → `<name k1="v1" k2="v2" …>`（属性**按名排序**、一律双引号、
   空 元素/self-closing 统一显式闭合）+ 递归子节点；文本与不透明 token **逐字**输出（不解码、
   不折叠空白——规则 1/2 逐字保留是设计承诺，逐字即语义）。
3. **比较**：canonical 串全等。

该比较器覆盖实测观察到的全部投影差异（X-2 引号重排 / X-4 字母序 / X-12 闭合展开 / X-14
last-wins），且**不锁 yjs 序列化器输出**（yjs 升级改投影形态，只要语义等价测试仍绿——恰为
ADR-0007「只承诺语义等价」的测试化）。**禁止**在断言中出现 `expect(out).toBe(input)` /
`toBe('<e k="v"></e>')` 式的投影冻结（W2）；唯一例外是逐字保留承诺本身（文本/实体/注释 span）
经 canonical 比较天然覆盖，无需逐字断言。

---

## §5. RD4 — RAC-4：extractYjsSnapshot 完整语义比较 + 嵌套 clone 隔离（Medium #4）

### 5.1 全量语义比较（instanceof 假绿的对治）

**用例 A（全形态 fixture，复用 DERIVED/EXPECTED_SNAPSHOT）**：materialize → `extractYjsSnapshot`
→ 与输入**逐域完整比较**（owner 原文「分别覆盖各 union variant、Record 全部 key、Y.Array 元素与
顺序、leaf 值和 XML 内容」）：

| 比较域 | 断言（extract 产物为纯 JSON） |
|---|---|
| Record 全部 key | `Object.keys(extracted.assets)` 键集 `{img1, doc1, f1}`（顺序不断言——extract 按 yjs 插入序，语义上是无序键集） |
| union variant 1（image） | `extracted.assets.img1` `toEqual({ kind:'image', url:…, width:10, height:20, audit:{createdBy:'alice', createdAt:111} })`（整对象全量） |
| union variant 2（text） | `extracted.assets.doc1` 除 body 外全量 `toEqual`；`body` 经 `expectXmlSemanticallyEqual(…, '<p>Hello <b>world</b></p>')`（**W3**：XML 叶子语义归一化，禁退化为字节相等） |
| union variant 3（file） | `extracted.assets.f1` `toEqual({ kind:'file', name:…, size:12, tags:['a','b'], audit:… })`——**tags 顺序敏感**（`toEqual` 数组序即断言序，owner「Y.Array 元素与顺序」） |
| 顶层 map 字段 | `extracted.audit` `toEqual({createdBy:'root', createdAt:999})`；`extracted.attachments` `toEqual(['x','y'])`（plain 纯值）；`extracted.keywords` `toEqual(['k1','k2'])`（顺序敏感） |
| leaf 标量 | 上述 toEqual 内含（url/width/height/name/size/createdAt/createdBy 全部标量值比对） |
| revalidate | `validateLogicalSnapshot(DERIVED, extracted).ok === true`（U12 主锚保留） |

**用例 B（深层多形态 fixture，最小化）**：`type ROOT = { m: YMap<{ a: YLeaf<number> }>;
tags: YArray<YLeaf<string>>; body: YXmlFragment<{ p: string }>; blob: YPlainArray<YLeaf<string>>;
u: unknown };` + 快照 `{ m:{a:1}, tags:['x','y'], body:'<p>Hi <b>there</b></p>', blob:['p1','p2'],
u:{nested:{deep:[1,'two',null]}} }` → materialize ok → extract → **整树语义比较**：非 XML 域
`toEqual` 原值（含 `u` 嵌套深结构 `toEqual`），XML 域语义比较器（实测达标，§9.3 RAC4 行）。

### 5.2 嵌套 plain object/array clone 隔离（行为断言，owner「不只验证扁平 attachments 数组」）

**用例 C**（fixture 同用例 B）：materialize 成功后**突变输入**的三个嵌套点：

```ts
input.blob.push('MUTATED');                       // plain 数组（YPlainArray 声明位）
(input.u as …).nested.deep.push('MUTATED');       // unknown 位嵌套深数组（copyJsonDomain 数组分支）
(input.u as …).nested.inner = { hacked: true };   // unknown 位嵌套对象改写（对象分支 + defineProperty）
```

再 `extractYjsSnapshot` 断言 doc 侧**逐字节回到原值**（`blob` toEqual `['p1','p2']`；`u` toEqual
原始深结构）。这是 SA6 冻结纪律的直接延伸（「`ymap.set(k, plainObj)` 按引用存储 → 深拷贝必须
行为断言」——引用不等断言（`stored !== input`）只证顶层实例分离，**行为断言**证全深度隔离）。
实测达标（§9.3 RAC4 iso 行：push 后 extract 不变）。

---

## §6. RD5 — RAC-5：observer 抛错测试收紧（Low #6）

U13（SA6 owned 文件内，本轮收紧，断言语义不变仅增强）：

| 断言 | 现状（U13） | 收紧后 | 依据 |
|---|---|---|---|
| 抛错形态 | `expect(() => …).toThrow()`（任意异常即过） | `expect(() => …).toThrow('observer-boom')`（message 子串精确匹配——F10 原样传播契约：异常必须是 observer 的原始错误，非包装/E200/E201） | owner #6；V8 实测 `threw=observer-boom` |
| observer 调用次数 | 无 | `observeCalls === 1`（单事务恰一次 type-observer 回调；**3 个 set 也只回调一次**——yjs 事务级批处理，V6 实测 `observeCalls=1 updates=1`） | owner #6；V6 实测 |
| update 次数 | `events.count === 1` | 保留 | 不变 |
| 值未回滚 | `root.get('title') === 't'` | 保留 | 不变（「不虚假承诺回滚」的测试化） |

**与 RD1 的叠加语义**：observer 抛错时 ⑤ 不运行（§2.3 R-2）——U13 场景不变地走 F10；RAC-1 新
用例（§10）走 F11，两族互不侵蚀。收紧后 U13 的 `toThrow('observer-boom')` 同时是「⑤ 未把 observer
错误改写成 E201」的守卫（若实现错误地在 ⑤ catch/包装，message 匹配失败）。

---

## §7. RD6 — RAC-6：CI 存在性门禁（建议 #7）

`/.github/workflows/ci.yml` test job（matrix node 20/24 双腿、两腿同跑）追加一步，**紧随 L49
（「Domain scaffolds check」的 run 行）之后、在 L51-56「Generated projection freshness
(regen-diff)」注释块之前**——存在性门禁聚簇连续（persistence-contract → domain-scaffolds →
materialize），评审可见性同款惯例：

```yaml
      # PR #84 owner review（issue #74 修订轮）：materializeRoot 专项存在性门禁——防测试
      # 文件被删/改名/未收集后静默假绿（vitest.config 默认 passWithNoTests=true）；
      # --typecheck 同步覆盖测试文件类型面（与 persistence-contract 门禁 L43-44 同款）。
      - name: Materialize root tests
        run: pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false
```

依据：(a) 同款先例——`Persistence contracts`（ci.yml:43-44，`--typecheck
--passWithNoTests=false` 组合）与 `Domain scaffolds check`（ci.yml:46-49，`--passWithNoTests=false`）；
(b) **命令本地实测通过**（§9.5：`1 passed (1) / 13 passed / Type Errors no errors / exit 0`，
耗时 523ms，CI 代价可忽略）；(c) rev1 全部新用例落位同文件（§1.4），该门禁覆盖本轮全部验收面。

---

## §8. 失败分类总表更新（基线 F1–F10 → +F11；F1–F10 零改动）

| # | 失败类别 | 阶段 | issues 形态 | path | message 模板 |
|---|---|---|---|---|---|
| F1–F10 | （基线 §4.8 全表维持不变——F1 logical 透传 / F2 ROOT 异型 / F3 ROOT 非空 / F4 形状错位 / F5 值域六词 / F6 union 全拒 / F7 未声明键 / F8 XML 解析失败 / F9 E200 崩溃边界 / F10 observer 抛错原样传播） | | | | |
| **F11** | **observer 同步重入修改 ROOT 顶层（不抛错：delete/overwrite/insert extra）** | **⑤** | **不返回——throw**（INV-10） | — | `DOCRT-E201: ROOT 顶层安装完整性偏离：{detail}——疑似 observer 同步重入修改 ROOT；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态` |

F10 与 F11 同属「事务已开始/已提交后不返回结构化结果」的 fatal 家族（W1 合规）；F11 的 throw
发生在 `doc.transact` **正常返回之后**（⑤ 阶段），F10 发生在事务内部——阶段边界即分类边界
（§2.5 表）。

---

## §9. 设计期实测证据（全部命令与输出内联；环境：node v24.13.0，yjs@13.6.32，worktree 根）

### 9.1 yjs observer/事务语义（RD1/RD5 依据；脚本 /tmp/sa1-rev1-verify2.mjs，完整可重跑）

脚本骨架：`import * as Y from '<worktree>/node_modules/.pnpm/yjs@13.6.32/node_modules/yjs/dist/yjs.mjs'`
（**必须 import dist 入口**——import src/index.js 会与 doc-runtime 的 'yjs' 解析形成双实例，
`rootMap.set(detached)` 即抛 'Unexpected content type'，首轮探针实测踩过）；one-shot observer =
`let done=false; root.observe(()=>{ if(!done){ done=true; …一次性修改… } })`（无 guard 的重入写
会无限递归，G8）。

```
G1-delete-oneshot   → updates=2 observeFired=2 size=1 sizeOk=false identityOk=false title=undefined count=7
G2-overwrite-oneshot → updates=2 get=HACKED identityOk=false
G3-insert-oneshot   → updates=2 size=2 sizeOk=false keys=["title","extra"] identityOk=true
G4-reinsert-oneshot → updates=3 identityOk=true（delete+同值重插：不误报）
G5-combo            → updates=3 keys=["extra"] sizeOk=true   ← size 相等而 identity 破坏：双断言必要性
G6-nested-mutation  → updates=2 topIdentityOk=true innerA=999（顶层检查不可见嵌套就地修改——残余面实证）
G7-doc-update-observer → size=2 sizeOk=false keys=["title","extra"]（doc 级 update observer 的重入写同样返回前可见）
G8-unbounded-recursion → threw=RangeError keys=["title","extra"] len=2（无 guard 重入写：引擎层栈溢出，自 transact 逃逸）
V6-observe-count    → observeCalls=1 updates=1（3 个 set 单事务：恰一次 type-observer 回调）
V8-throw            → threw=observer-boom updates=1 title=t
V7-nested           → updates=1 outerIdentityOk=true（调用方外层事务包裹下 set 即时生效于本地态、
                       ⑤ 同一性断言仍可读——**仅证可见性，无 observer**；observer 时序见 N1，R2 修正标注）
V5-identity         → identityAll=true innerRead=1（detached Y.Map/plain/scalar 集成后 get 与安装值同一）
```

R2 修订补测（攻击点 #1 的边界证据；脚本 /tmp/sa1-rev1-r2-verify.mjs，SA2 P-1 独立复现同结论）：

```
N1-nested-bypass    → atVerify: fired=0 updates=0 sizeOk=true identityOk=true（⑤ 空转通过）
                      | afterOuter: fired=3 updates=3 keys=["count","extra"] title=undefined extra=E
                      ← 调用方未闭合外层事务内调用：observer 延迟至外层 cleanup，⑤ 位置双断言
                        空转 → ok:true 返回 → ROOT 随后被删改且无 E201（R-7 边界 + T-1 用例依据；
                        且返回时 updates=0——INV-10(a) 亦为假）
N2-outermost-control → sizeOk=true identityOk=false keys=["count","extra"]（最外层前提成立：
                       同款 delete+insert 偏离被 identity 断言抓出 → E201——与 G5 同型互证）
```

### 9.2 vfsl 接受域（RD2/RD3 依据；tsx 直调 `packages/vfsl/src/index.js`，/tmp/sa1-rev1-vfsl.mts）

```
xml "<p title='a\"b'>x</p>" → ok=true        ← 定谳锚：校验接受、构造拒绝（唯一分歧）
xml "<p title=\"a'b\">x</p>" → ok=true        xml "<!--c--><![CDATA[a<b]]><?pi d?>" → ok=true
xml "" → ok=true   "<p>a</p><p>b</p>" → ok=true   "top text <b/>" → ok=true   "<e k='v' k='w'/>" → ok=true
xml "<p>\n  <b>x</b>\n</p>" → ok=true   "<e/>" → ok=true   "<e></e>" → ok=true
malformed '<p>' → ok=false | YXmlFragment 值不是良构 XML：标签未闭合
unknown Date/bigint/NaN/Infinity/YMap-instance → ok=true（5/5）；arr[undefined] → ok=true
n=NaN number标量 → ok=true；nested-obj@unknown → ok=true
```

### 9.3 现实现行为探针（RD2/RD3/RD4「实现已达标」结论依据；tsx 直调 doc-runtime src，/tmp/sa1-rev1-impl.mts）

```
RAC2 Date:      preValidate=true → ok=false nIssues=1 updates=0 stateEq=true | 纯值域违规（ROOT.u）…
RAC2 bigint:    preValidate=true → ok=false nIssues=1 updates=0 stateEq=true
RAC2 NaN:       preValidate=true → ok=false nIssues=1 updates=0 stateEq=true
RAC2 Inf:       preValidate=true → ok=false nIssues=1 updates=0 stateEq=true
RAC2 YMap:      preValidate=true → ok=false nIssues=1 updates=0 stateEq=true
RAC2 undef-arr: preValidate=true → ok=false nIssues=1 updates=0 stateEq=true
RAC2 nNaN:      preValidate=true → ok=false nIssues=1 updates=0 stateEq=true
RAC3 attr-quote: preValidate=true → ok=false nIssues=1 updates=0 stateEq=true
RAC3 ""→ok out="" revalidate=true                      "<p>a</p><p>b</p>"→ok 同串 revalidate=true
RAC3 "top text <b/>"→out="top text <b></b>" revalidate=true
RAC3 "<!--c--><![CDATA[a<b]]><?pi d?>"→out 同串 revalidate=true
RAC3 "<e k='v' k='w'/>"→out="<e k=\"w\"></e>" revalidate=true（last-wins）
RAC3 "<p>\n  <b>x</b>\n</p>"→out 同串 revalidate=true   "<e/>"→"<e></e>"   "<e></e>"→"<e></e>"
RAC3 "<p title=\"a'b\">x</p>"→out 同串 revalidate=true
RAC4 full: matOk=true exOk=true exDeepU={"nested":{"deep":[1,"two",null]}}
RAC4 iso: matOk=true exBlob=["p1","p2"] exU={"nested":{"deep":[1,"two",null]}}  ← 突变输入后 doc 不变
```

### 9.4 XML 矩阵补充行（/tmp/sa1-rev1-xml2.mts）

```
"<p title=\"a<b&c\">x</p>" → ok out 同串 revalidate=true（属性值含裸 < & 往返）
"<p>x<!-- note -->y</p>"  → ok out 同串 revalidate=true（X-6 元素内注释；R2 补录——SA2 评审 P-5
                            独立复现，/tmp/sa2-impl-probe.mts，2026-08-22，输出经其报告内联可查）
"<e b=\"2\" a=\"1\"/>"     → ok out="<e a=\"1\" b=\"2\"></e>" revalidate=true（字母序重排）
"<img src=\"a.png\" alt=\"plain\"/>" → out="<img alt=\"plain\" src=\"a.png\"></img>"（重排+显式闭合）
"<p>x &amp; y &lt; z</p>"  → ok out 同串 revalidate=true（实体字面保留）
"<p title='a>b'>x</p>"     → ok out="<p title=\"a>b\">x</p>" revalidate=true（引号归一）
```

### 9.5 RAC-6 命令实测（worktree 根）

```
$ pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false
 Test Files  1 passed (1)
      Tests  13 passed (13)
Type Errors  no errors
   Duration  523ms            # exit 0
```

---

## §10. SA6 测试计划总表（全部落位 `packages/doc-runtime/test/materialize-root.test.ts`）

| 用例组（新增 describe） | 覆盖 | 行数估算 | 断言模板 |
|---|---|---|---|
| `R1 observer 重入不抛错（F11）` | RAC-1：delete / overwrite / insert extra / combo(delete+insert) 四向量 + 正向对照（observer 不触 ROOT → ok:true + ROOT===snapshot）+ 同值重插不误报（G4） | 6 用例 | 每向量：`expect(() => materializeRoot(…)).toThrow('DOCRT-E201')` + `events.count >= 1`（首事务已提交；**不锁总数**——observer 重入事务数非本函数契约，§2.3 R-5）+ 最终 ROOT 状态逐键断言（owner「明确断言返回结果和最终 ROOT 状态」：delete → title undefined 且 count 仍 '7'；overwrite → 'HACKED'；insert → extra 键在；正向 → 全键等 snapshot）。observer 一律 one-shot（G8 纪律） |
| `R1 嵌套事务边界 characterization（T-1，R2 增补）` | R-7 契约前提破坏边界的测试化（SA2 #1/T-1）：明文登记的边界不得静默漂移 | 1 用例 | `derivedOf('type ROOT = { title: string; count: number };')` + one-shot 偏离 observer（首回调 `delete('title'); set('extra','E')`）+ **在调用方外层事务内调用**：`doc.transact(() => { result = materializeRoot(…, doc); })`；断言 (a) `result.ok === true`（⑤ 空转——R-7 边界的 characterization）；(b) 外层事务返回后 `title === undefined && extra === 'E'`（偏离确已发生且无 E201）；(c) 用例注释标明「契约前提：materializeRoot 必须在最外层事务调用（§2.3 R-7 / JSDoc）」。**若未来实现改为 loud-guard 或检测到该场景，本用例须随设计同步更新**——边界变化必须走设计评审（characterization 目的，SA2 T-1 原文） |
| `R1 身份级保守（T-4，可选）` | R-8：语义等价异实例替换亦 E201（有意保守）的测试化 | 1 用例（可选） | one-shot observer `delete('u'); set('u', { …同深值异实例 })` → `toThrow('DOCRT-E201')`——把「身份级而非语义级」的保守性一并锁定（与 §2.3 R-8 登记行配套；SA2 T-4 原文） |
| `R1 空快照 + observer` | INV-10 对空 entries 的退化（size 0===0 恒过 → ok:true） | 1 用例 | ok:true + updates===0（B2/T14 语义 + ⑤ 无操作） |
| `R2 构造失败零写入` | RAC-2：§3.2 C-1~C-8（±Infinity/-Infinity 与 Y.Array 各一行 → 共 10 行） | ~10 用例 | §3.2 模板（前置 validate ok:true → ok:false + 恰 1 issue + 0 update + state 不变） |
| `R3 xml-parse 表驱动` | RAC-3：§4.3 X-1~X-17（成功）+ X-F1~X-F8（逻辑失败）+ X-F9（构造失败定谳锁定） | 26 行（表驱动 it.each） | §4.3 两模板 + `expectXmlSemanticallyEqual`（§4.4 helper，测试文件内实现） |
| `R4 全量语义比较 + 嵌套隔离` | RAC-4：§5.1 用例 A/B + §5.2 用例 C | 3 用例 | §5 模板 |
| U13 收紧（既有用例原地增强） | RAC-5：§6 表 | 0 新用例 | toThrow('observer-boom') + observeCalls===1 + 保留两断言 |

**测试纪律**：既有 U1–U12 断言零改动；U13 仅增强；新用例不读源码不 grep 实现文本（黑盒可观测
输出锚定，SA6 冻结纪律延续）；`expectXmlSemanticallyEqual` 是测试局部件（不进 src，不进公共面）。

---

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/materialize.ts` — 修改：新增 ⑤ `verifyInstall`（size + 逐键同一性双断言 → throw DOCRT-E201，§2.2 伪代码，约 +30 行）+ `materializeRoot` JSDoc 契约文本（§2.4，约 +15 行）+ 模块头注一行登记 ⑤。**唯一生产代码变更**
- `packages/doc-runtime/test/materialize-root.test.ts` — `[SA6 owned]` 新增 R1/R2/R3/R4 用例组 + `expectXmlSemanticallyEqual` helper + U13 收紧（§10，约 +420 行）。SA3 仅可改测试基础设施，不得改断言逻辑
- `.github/workflows/ci.yml` — 修改：test job 追加「Materialize root tests」存在性门禁步骤（§7，+5 行含注释）
- `packages/doc-runtime/package.json` — 修改：版本 bump 0.1.2 → 0.1.3（repo 先例：行为增补随交付 patch bump，前轮 0.1.1→0.1.2 同款；仅 version 字段）

### DENY LIST

- `docs/adr/**` — 本轮零 ADR 修订（出口 A 落地不触碰 ADR 文本，§2.4；出口 B 才需要带日期修订节）
- `packages/vfsl/**` — 校验域接受面不动（attr-`"` 定谳=维持校验侧现状；wellFormedXml 不导出维持）
- `packages/doc-runtime/src/xml-parse.ts` — attr-`"` 定谳=锁定现状，零改动（§4.1）
- `packages/doc-runtime/src/carrier.ts` / `src/resolve.ts` / `src/extract.ts` — 探针/解析器/读侧零触碰（基线 D3/D8 冻结）
- `packages/doc-runtime/src/index.ts` — 导出面零变化（无新类型无新入口；E201 是 throw 的 Error message 前缀，非导出实体）
- `packages/doc-runtime/test/extract-*.test.ts`（5 文件）— 既有 48 用例回归锚，任何 SA 不动
- `packages/persistence/**`、`packages/dsh-persistence/**` — 持久层零触碰（ADR-0006/0007）
- `packages/vfsl-protocol/**`、`packages/vfsl-codegen/**` — 编译期轨道无涉
- `.github/workflows/ci.yml` 既有步骤与 `vitest.config.ts`、根/包 `tsconfig*.json` — 仅按 §7 追加一步，其余 CI/构建配置零改动

## §12. 协议假设依据 (Protocol Assumption Evidence)

无 HTTP/端口/进程级假设；本表全部为第三方库（yjs/vfsl/vitest）行为假设，依据类型统一为**设计期
实测验证**（§9 内联命令与输出，SA4 可复制重跑；脚本骨架与双实例陷阱注记见 §9.1）。

| # | 假设 | 依据类型 | 依据内容（实测编号 + 关键输出） | 风险 |
|---|---|---|---|---|
| P-R1 | observer 同步重入的 ROOT 修改在 `doc.transact` 返回前全部落定且可见（⑤ 检测时点有效；含 doc 级 `update` observer 的重入写）。**限定（R2 修订，SA2 #1）：仅当本函数事务为 doc 最外层事务时成立**——调用方未闭合外层事务包裹下 observer 延迟至外层 cleanup，⑤ 空转（契约前提 R-7，非本假设成立域） | 设计期实测（R2 双源） | 成立域：§9.1 G1（delete 后 size=1 立即可见）/ G7（doc-update observer → sizeOk=false）/ N2（最外层对照，identity 抓出偏离）；边界域：§9.1 N1 + SA2 评审 P-1（独立复现，fired=0 updates=0 atVerify → afterOuter keys=["count","extra"]） | 低（前提已 JSDoc 成文 + T-1 characterization 锁定） |
| P-R2 | observer 重入写开启新事务 → 产生额外 update 事件（本函数事务之外） | 设计期实测 | §9.1 G1/G3 updates=2、G4 updates=3 | 低（测试断言 updates≥1 不锁总数） |
| P-R3 | 单事务恰一次 type-observer 回调（多 set 批处理为一次） | 设计期实测 | §9.1 V6 `observeCalls=1 updates=1`（3 set） | 低 |
| P-R4 | 无 guard 的 observer 重入写 → 引擎无限递归 RangeError 自 transact 逃逸 | 设计期实测 | §9.1 G8 `threw=RangeError` | 低（测试纪律：observer 必须 one-shot） |
| P-R5 | delete+同值重插保持值同一性（⑤ 不误报） | 设计期实测 | §9.1 G4 `identityOk=true` | 低 |
| P-R6 | size 与逐键同一性双断言缺一不可（组合向量 size 相等而同一性破坏） | 设计期实测 | §9.1 G5 `sizeOk=true` + keys=["extra"]（title 已删） | 低 |
| P-R7 | 嵌套就地修改对顶层同一性不可见（残余面 R-1 实证） | 设计期实测 | §9.1 G6 `topIdentityOk=true innerA=999` | 低（登记不改行为） |
| P-R8 | 集成后的 detached Y.Map 与 plain/scalar 安装值 `get(k) === v`（⑤ 同一性断言的语义基础；含嵌套事务场景） | 设计期实测 | §9.1 V5 `identityAll=true`、V7 `outerIdentityOk=true`；基线 A19（按引用存储） | 低 |
| P-R9 | vfsl `unknown` 位/number 标量位接受非 JSON 载体（Date/bigint/NaN/±Infinity/Yjs 实例/数组内 undefined/嵌套对象全部 validate ok:true） | 设计期实测 | §9.2 unknown 段 8/8 true（+基线 P17 同口径） | 低 |
| P-R10 | `wellFormedXml` 接受属性值含 `"`（单引号包裹）；DOCTYPE 两侧同拒 | 设计期实测 | §9.2 xml 段（`<p title='a"b'>x</p>` ok=true；malformed/DOCTYPE ok=false） | 低 |
| P-R11 | RAC-3 成功矩阵全部 17 行行为在现实现达标（round-trip 语义等价 + revalidate ok；attr 字母序/引号归一/self-closing 展开/last-wins 为 yjs 投影）。R2 修订：X-6（元素内注释）原清单缺席，由 SA2 评审 P-5 独立补测同串往返 + revalidate ok（§9.4 已补录）——「全部」宣称现有 17/17 证据 | 设计期实测（SA1 16 行 + SA2 补测 1 行） | §9.3 RAC3 段 + §9.4（含 X-6 补录行、`<e b="2" a="1"/>` → `<e a="1" b="2">`）+ SA2 评审报告 P-5 | 低 |
| P-R12 | RAC-6 命令（含 `--typecheck --passWithNoTests=false`）在 vitest 当前版本可用且退出码 0 | 设计期实测 + 类比已有 job | §9.5（13 passed / no type errors / 523ms）；ci.yml:43-44 同款先例 | 低 |
| P-R13 | `YXmlFragment<{ p: string }>` 为合法最小 fixture 语法 | 现有测试引用 | `packages/vfsl/test/evaluate-derived-schema.test.ts:325` 同款 fixture | 低 |

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `materializeRoot` | `packages/doc-runtime/src/materialize.ts:51` | `{ok:true} \| {ok:false; issues}`；唯一 throw 路径 = 事务内 observer/引擎异常（F10 原样传播） | 返回类型联合**不变**；**新增一条 throw 路径**：事务正常返回后顶层完整性偏离 → throw `DOCRT-E201`（⑤/F11）。`ok:true` 语义强化为 INV-2+INV-10（§2.2）。原有 ok:false 域、F10 语义、同步性、参数零变化 |

（新增 throw 路径 = 触发条件五类清单中「新增 unconditional throw 在原本 return 的路径上」——
审计必须列全 caller。）

### Caller 清单

抓取命令：`git grep -n "materializeRoot" -- 'packages/**/*.ts' 'apps/**/*.ts' '.github/**'`
（排除定义文件/导出文件/测试文件后）→ **生产 caller = 0**（唯一命中为 `packages/vfsl/src/validate.ts:640`
的 doc comment 文字提及，非调用）。

| Caller | 文件:行号 | 是否 await（同步函数→是否直接调用） | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| （无生产 caller） | — | — | — | — | 下游 `applyValidatedMutation` / NamespaceRuntime 尚未实现（ADR-0007 将来时）；未来消费者按 JSDoc 契约（§2.4）感知 E201 fatal 通道 |
| `materialize-root.test.ts`（测试 caller，SA6 owned） | 全文件 13 既有 + 新增用例 | 直接调用 | U13/R1 用例 `expect(() => …).toThrow(…)` 包裹 | — | 既有 U1–U12 场景无 observer → ⑤ 恒过，零影响；U13 observer 抛错在 ④ 内传播，⑤ 不运行（§2.3 R-2），既有断言不变绿；R1 新用例显式断言 E201 |

### 风险评估

- **遗漏 caller 的代价**：E201 未捕获冒泡至调用方顶层——当前生产 caller 为零，风险面为测试与
  未来消费者；JSDoc（§2.4）是未来消费者的契约载体。
- **throw 语义与「不虚假声称」的一致性**：E201 message 明示「写入已提交，不回滚、不补偿，doc
  保持 observer 留下的实际状态」——调用方不会误读为可重试的干净失败（W1 三禁全避）。
- 无 `return→throw` 于既有 return 路径、无同步变异步、无 catch 语义变化（prepare 的 E200 崩溃
  边界、④ 的零捕获均不变）。

---

## §14. Owner 反馈逐条回应（PR #84 Review 7 项 → 设计落位）

| # | owner 反馈（级别） | 是否落实 | 修订位置 | 落实摘要 |
|---|---|:--:|---|---|
| 1 | P1：observer 重入不抛错时 `ok:true` 语义未定谳（两个出口二选一并落实 + 回归测试） | ✅ | §2（RD1）/§8（F11）/§10（R1 用例组） | **定谳出口 A**：⑤ verifyInstall 顶层完整性检测 + throw DOCRT-E201（W1 唯一相容形态）；`ok:true` 语义升级 INV-10；JSDoc 文档化（零 ADR 修订，理由 §2.4）；R1 用例组 6 向量（delete/overwrite/insert/combo/正向/不误报）断言返回结果 + 最终 ROOT 状态 |
| 2 | High：detached 构造失败零写入证明缺口（unknown 载体 + XML 构造拒绝） | ✅ | §3（RD2）/§10（R2 组） | 8 类载体矩阵（Date/bigint/NaN/±Infinity/Yjs×2/数组内 undefined/number 标量 NaN/attr-`"`），先证 validate ok:true 再证 ok:false + 恰 1 issue + 0 update + state 字节不变；现实现已实测达标（§9.3），测试锁定 |
| 3 | High：XML round-trip 表驱动 + validator/materializer 接受域差异定谳 | ✅ | §4（RD3）/§10（R3 组） | 定谳：attr-`"` **有意约束**（§4.1 三论据）+ 接受域差异全量清点（**恰一处**，DOCTYPE 两侧同拒，§4.2）；17 成功 + 8 逻辑失败 + 1 构造失败表驱动；语义比较器（§4.4）保 W2 |
| 4 | Medium：AC-3 instanceof 假绿 → extractYjsSnapshot 完整语义比较 + 嵌套 clone 隔离 | ✅ | §5（RD4）/§10（R4 组） | union 三 variant 全量 toEqual + Record 键集 + 数组顺序敏感 + leaf 标量 + XML 语义比较（W3）；unknown 位嵌套深结构 + YPlainArray 双载体行为断言（突变输入 → extract 不变） |
| 5 | Medium：单次 update 不能单独证明构造先于事务 | ✅（并入 #2） | §3.3 | 以 #2 的「0 update + state 字节不变」为原子性主锚（反证面锁定）；总控研判已裁定并入不单独立项 |
| 6 | Low：observer 抛错测试收紧 | ✅ | §6（RD5）/§10（U13 收紧） | `toThrow('observer-boom')` + `observeCalls===1`（P-R3 批处理实证）+ 保留 updates===1 与值未回滚断言 |
| 7 | 建议：materialize 专项 CI 存在性门禁 | ✅ | §7（RD6）/§11（ALLOW: ci.yml） | brief 原文命令（含 `--typecheck --passWithNoTests=false`）追加至 test job 存在性门禁聚簇；命令本地实测 exit 0（§9.5）；rev1 新用例同文件落位使门禁全覆盖（§1.4） |

---

## §15. SA2 反馈逐条回应（R1 评审 reject → 本 R2 修订落实记录）

> SA2 R1 评审（2026-08-22，`wiki/raw/task_doc-runtime-materialize-root-rev1_sa2_review.md`）：
> 窄幅驳回——RD1 出口 A / ⑤ 双断言 / throw 形态与 RD2~RD6 矩阵架构全部经受住攻击（无需返工），
> #1 必修 + #2~#5 顺带 + #6 nit。下表逐条落实；修订前 SA1 已独立复现 #1 边界（§9.1 N1/N2，
> 与 SA2 P-1 同结论）。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1（HIGH 必修）：⑤ 时点假设缺「本函数事务 = doc 最外层事务」前置条件——R-7 登记 + JSDoc 前置条件段 + 无条件宣称改限定 + P-R1 限定词 + T-1 characterization 用例；不采用 `doc._transaction` guard | ✅（五点全落 + 两处一致性延伸） | §2.3 R-7 行 / §2.4 JSDoc 前置条件段与限定措辞 / §12 P-R1（成立域+边界域双源引证）/ §10 T-1 用例行 / 摘要边界段 / §2.2 论证 1 前提化 / §2.5 分界表 R-7 行 / §9.1 N1+N2 复现块 + V7 标注修正 | R-7 成文（含未来 create 流程三条目单 update 单元的触发预警）；JSDoc 增「⚠️ 前置条件」段、「任何……都会被检测」改为「在上述前置条件成立的前提下」；P-R1 拆成立域（G1/G7/N2）与边界域（N1 + SA2 P-1）；T-1 characterization 断言 (a) ok:true (b) 外层后 title 删/extra 在 (c) 前提注释；`doc._transaction` guard 明文不采用（引 SA2 定谳）；论证 1 标题加前提、V7 实测标注改为「仅证可见性，无 observer」（证据与宣称错位的自纠）；§2.5 表补 R-7 行使出口分界收口 |
| #2：X-F 模板追加 toHaveLength(1) 双断言（direct + result） | ✅ | §4.3 逻辑失败模板 + 前置说明改写 | 模板加 `expect(direct.issues).toHaveLength(1)` 与 `expect(result.issues).toHaveLength(1)`（引 SA2 P-6 8/8 实测）；前置说明改写为「锁的是这 8 个单违规输入的行为而非 validate 全收集语义（多违规输入由 U1 锚守护）」——RAC-3「单 issue」字面锚定 |
| #3：§3.2 C-1~C-8 与 §5.1 用例 B fixture 补 VFSL 终止分号 | ✅ | §3.2 表（C-1/C-6/C-7/C-8）+ §5.1 用例 B | 5 个独立 fixture 文本全部补 `;`（C-2~C-5 为「同上」引用 C-1，随 C-1 生效——SA2 计 9 处按独立文本计为 5 处，覆盖等价）；依据：无分号 fixture parseVfsl 即 `VFSL-E100 别名缺少终止分号`（SA2 P-2） |
| #4：登记 ⑤ 检测身份级偏离（语义等价异实例替换亦 E201，有意保守）+ T-4 可选用例 | ✅ | §2.3 R-8 行 / §2.2 论证 4 尾句 / §10 T-4 可选用例行 / §2.4 JSDoc 检测面边界段 | R-8 成文（保守理由：身份不变量可精确构造、语义比较引入 extract 怪癖假阳性——论证 5 同款）；论证 4 标题限定为「两类」并指向 R-8；JSDoc 明示「检测基准是身份同一性（===）而非语义等价」；T-4 spec 入 §10 |
| #5：§9.4 补 X-6 实测行或改 P-R11 措辞 | ✅（双落） | §9.4 X-6 补录行 + §12 P-R11 措辞与证据面更新 | §9.4 引 SA2 P-5 输出补录 X-6（标注独立复现来源与脚本名）；P-R11 改为「17/17 证据（SA1 16 行 + SA2 补测 1 行）」，消除「全部宣称 vs 16 行证据」的缺口 |
| #6（nit）：CI 步骤插入位置明示 | ✅ | §7 首段 | 明示「紧随 L49（Domain scaffolds check 的 run 行）之后、在 L51-56 regen-diff 注释块之前」 |

**R2 修订不变式自检**：RD1 出口 A 裁决、⑤ 双断言算法与伪代码（§2.2）、DOCRT-E201 命名、F11
分类、零 ADR 修订立场、RD2 十行矩阵、RD3 定谳与语义比较器、RD4 用例 A/B/C、RD5 收紧表、
RD6 CI 步骤——全部零改动（SA2「保留不动」清单逐项对应）；本轮全部修订是**登记/限定/断言补强**
（R-7/R-8/JSDoc 前置条件/T-1/T-4/X-F 长度断言/fixture 分号/X-6 补录/位置明示），无任何行为规格
变更——§2.2 伪代码与 §11 ALLOW/DENY 零变化。

---

### 一致性自检声明

- 「⑤ / verifyInstall / DOCRT-E201 / INV-10 / F11」五称谓全文同指一处机制：§2.2 定义（唯一行为
  规格伪代码）、§2.3 残余面、§2.4 JSDoc、§2.5 分界表、§8 F11 行、§10 R1 用例、§11 ALLOW（materialize.ts
  唯一生产变更）、§12 P-R1~R8、§13 契约审计——无第二处行为定义。
- 「ok:true 语义」三处同口径（INV-2 + INV-10）：§2.2 伪代码注释、§2.4 JSDoc 文本、§2.5 表末行。
- W1 三禁（不返回 ok:false / 不补偿 / 不声称回滚）在 §2.2 伪代码注释、§2.4 JSDoc、§8 F11 模板、
  §13 风险评估四处的 message/行为表述一致。
- 检测面边界表述三处一致（顶层 exact / 嵌套就地+异步不覆盖 / observer 抛错 ⑤ 不运行）：§2.2
  论证 5、§2.3 R-1~R-3、§2.4 JSDoc「检测面边界」段。
- attr-`"` 定谳三处同口径（有意约束 + 锁定现状 + 测试锁定）：§4.1、§4.2 差异表、C-8/X-F9 双锚。
- 「本轮唯一生产代码变更 = materialize.ts」在 §1.3、§11 ALLOW、§14 #1 行一致；xml-parse.ts 的
  定谳是**零改动锁定**（§4.1 vs §11 DENY 不矛盾：DENY 表述为「attr-`"` 定谳=锁定现状，零改动」）。
- 基线锚复用无断言收窄：U1–U12 零改动、U13 仅增强（toThrow() ⊂ toThrow('observer-boom')，
  §6）；INV-2 的语义澄清（R-5：恰 1 次指本函数事务）不改 U8 断言（U8 场景无 observer，实测 1）。
- 文件清单与正文一一对应：ALLOW 4 文件 ↔ §2.2/§2.4（materialize.ts）/§10（test）/§7（ci.yml）/
  §11（package.json bump）；DENY 与 §1.3「其余全部是测试锚定与 CI 步骤」一致。

R2 修订追加（2026-08-22，SA2 R1 六项落实后自检）：

- **R-7 前提五处同口径**（「本函数事务 = doc 最外层事务 / 调用方不得在未闭合事务内包裹」）：
  §2.2 论证 1（前提化标题）、§2.3 R-7、§2.4 JSDoc 前置条件段、§2.5 表 R-7 行、§10 T-1 用例
  断言 (c)——摘要与 §12 P-R1 限定词同款措辞；「无条件检测宣称」全文已清零（JSDoc 改「在上述
  前提条件成立的前提下」，摘要/论证 1 同步限定）。
- **R-8 身份级保守四处同口径**（「检测基准是身份同一性（===）而非语义等价；语义等价异实例
  替换亦 E201，有意保守」）：摘要边界段、§2.2 论证 4、§2.3 R-8、§2.4 JSDoc 检测面边界段——
  「无假阳性」字样已全部收窄为限定形态（论证 4「于两类」）或删除（JSDoc）。
- **T-1 断言与 N1 实测对齐**：T-1 (a) ok:true ↔ N1 `sizeOk=true identityOk=true（⑤ 空转通过）`；
  T-1 (b) title 删/extra 在 ↔ N1 `afterOuter keys=["count","extra"]`。
- §9.1 证据序改为 G1–G8 + V5–V8 + N1/N2 三组，N 组为 R-7 边界与 T-1 的唯一行为依据；V7 标注
  已修正（「仅证可见性，无 observer」）——SA2 指出的「证据与宣称错位」消除。
- X-F 模板「恰 1 双断言」与 §3.2 构造失败模板、X-F9/C-8 的「恰 1」三处同口径；fixture 分号
  全文清零（§3.2/§5.1 共 5 处独立文本）。

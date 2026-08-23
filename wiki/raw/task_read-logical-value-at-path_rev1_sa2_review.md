# SA2 攻击评审报告 — rev1 设计（readLogicalValueAtPath Phase B union value-first 硬化）

**Date**: 2026-08-22
**Verdict**: **pass**（附 2 项不阻塞的文档勘误修订要求，见攻击点 #1/#2——纯文档措辞层，不触及任何 normative 行为条款；SA1 应在 SA3 落地前顺手修正）

- **被审对象**：`wiki/raw/task_read-logical-value-at-path_rev1_design.md`（SA1 rev1，D16/D17/D18/D13 重述/§3.5 观测等价定理）
- **评审人**：SA2（Wallfacer）；任务类型 Bug 修复（发布后修订轮 rev1）
- **ADR 约束基准**：`task_read-logical-value-at-path_rev1_relevant_decisions.md`（ADR-0003/0007 直接相关；任务族内规 extract INV-8 / read D4-D15；首轮冻结契约 FC-1..6）
- **SA8 移交注记执行**：本报告对观测等价定理、四步归谬、INV-12 完备性论证做了**独立重推与源码逐行对照**（§「核心论证独立攻击记录」），非复述 SA5 结论。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | MINOR | §1.3 动机论证（「为什么必须修」）的演化例证 2/3 不成立 | 设计声称「未来任何一项演化（放宽 E309、新增带异构段消耗的节点 kind、yjs 允许 undefined 元素）都会**静默**打开可达面」。经独立推演：**仅「异构段消耗的节点 kind」真正威胁归谬（破坏第 2 步段消耗无跳跃）**。另两项归谬对此鲁棒——(a) 放宽 E309：混合联合 `YLEAF \| {foo:YLEAF}` 下，标量成员在有剩余段时走 M10 终态下钻 reject、零剩余段时走终点 walkUnion（不经中段仲裁），中段 missing 三源不变，第 1/4 步（live 导航确定性、同深度同 live）不受成员形状同构性影响；(b) yjs 允许 undefined 数组元素：现行 read.ts:340-341 **不检查界内元素 undefined**，直接 `resolveLive(element, undefined)` 下钻，下一深度 `carrierOf(undefined) ≠ Y.Map/Y.Array/plain value` → reject（非 missing）——即 undefined 元素产生的是 reject 而非 missing，不构成「前序 missing 遮蔽后序 value」的前提；即便其抵达终点（walk 对 undefined 输入 mismatch → reject），归谬第 1 步保证全体成员同见同一 undefined live，后序成员仍无法产出 value。SA5 原文仅将 E309 列为第 3 步「辅助」事实（正确），设计 §1.3 将其拔高为「放宽即打开可达面」（无据）。**影响**：不影响修订正当性（硬化价值由「构造保证优于事实依赖」+ 异构段消耗演化风险独立支撑），但夸大的脆弱性叙事会误导未来维护者对归谬边界的理解。 | 修正 §1.3 表述：将三项演化例证收敛为「异构段消耗节点 kind（破坏第 2 步）」为主例，E309/yjs-undefined 降级为「三源枚举与终点快照论证的事实前提」或给出具体可达反例（不存在则删除该宣称）。**纯措辞修订，不阻塞放行。** |
| 2 | MINOR | §3.4 SUP-2 护栏参数引用错误 | 设计两处称「SUP-2 护栏（**22 层**重叠联合 + 末段全拒/required 缺席路径 <2s）」。实际 `read-logical-value-at-path-supplementary.test.ts:96` 为 `const CHAIN_DEPTH = 26`（注释「层数取 26，SA2 复审观察 #1」，首轮口径一致）。**影响**：SA4 按 §3.4 引用到测试文件对账「22」会扑空；护栏论证的实质（该构造最坏路径不含 missing 短路受益）不受影响——本报告已核实 SUP-2 三例在 value-first 下试探集与原相同（末段全拒走 Phase A；required 缺席路径成员结局全 reject，无 missing；正向对照首 value 即短路）。 | 将 §3.4 与 §4 中「22 层」改为「26 层」。**纯勘误，不阻塞放行。** |
| 3 | MINOR（建议） | §3.4 成本论证的护栏缺口：value-first 的新成本面无测试锚 | 设计正确论证「单次 union 访问最坏试探界不变（全拒时本就试全体成员）」，但 value-first 真正的**新增**成本面是「中段 missing 后继续试探整棵后序成员子树」（现行首 ok 短路直接跳过）。现有 SUP-2 fixture 全部字段 required（`{x, t1} \| {x, t2}`），**该新成本面在护栏构造上不存在**——SUP-2 维持有效≠新成本面被锚定。memo 摊销后渐近界确实安全（每 (节点, live, i) 至多计算一次，链式结构线性），但这是论证而非护栏。 | 在 §8.1 可选 `-rev1-hardening.test.ts` 清单中补一条：26 层链 × 中段 optional 缺席路径（如 `{x?, t1} \| {x, t2}` 变体 + live 中段缺 x）耗时 <2s 的绿灯护栏，直接锚定 H-1/§3.4 渐近界声明。SA4/SA7 裁量，非义务。 |
| 4 | NOTE | §3.3.2 mixed 裁决的行为锚单向覆盖 | normative 条款「value > missing > reject」的 mixed 行为锚仅有 R4-3（missing 先：`{foo?} \| {bar}` + live `{}` → undefined）。reject-先反序（`{bar} \| {foo?}`）设计已自列为可选锚点（§4）。本报告推演其增量检测力：对「循环遇 reject 提前终止」类实现漂移提供第二锚（R4-3 已锁第一锚——错误实现「见 reject 即整体 reject」在 R4-3 转红）；对「首 missing 即返回」错误（恰为现行 bug 行为）**两序均无检测力**——这不是缺口，是观测等价的必然（该错误在合法输入上不可区分，SA5 (c) 已成文降级）。 | 接受设计的「可选」分级；建议 SA4/SA7 落地时优先纳入（一行 fixture + 一断言成本），与攻击点 #3 同文件。 |
| 5 | NOTE | 嵌套 union 语义未显式成文 | D17 仲裁在嵌套 union（成员经 ref → union 或直接嵌套）下经 `resolveLive` 递归自然传播：子 union 聚合 missing 后外层记 `sawMissing` 继续——语义自洽，伪代码结构自明，但设计未显式一句成文。vfsl evaluate 是否产出嵌套 union 节点属实现细节，风险极低。 | 建议在 §3.2 加一句「嵌套 union 位经递归聚合：子 union 的 missing/reject/value 结局按 D17 同规则参与外层记账」。可选。 |

**无 CRITICAL / MAJOR 级攻击点。**

---

## 核心论证独立攻击记录（SA8 移交域：定理与归谬有效性）

本节是本报告的主攻击域。结论：**四步归谬、观测等价定理、INV-12 完备性论证经独立重推全部成立**，未找到反例。

### 1. 四步归谬独立重推（结构性不可达）

- **第 1 步（live 导航确定性）**：与 read.ts 现行结构逐行对照成立——`navigate` 对 live 的读取仅 `ymap.get(seg)`（L323/329）、`ya.get(seg)`/`ya.length`（L339-341）、`carrierOf(live)`（L315/338），全部以 `(live, seg)` 为参数，成员形状零参与；union 位所有成员从同一 `(live, i)` 出发（L345-346），存活到深度 k 的成员看到同一 `live_k = child 链(live_i, segs[i..k-1])`。✓
- **第 2 步（段消耗无跳跃）**：map/array 下钻 `i+1`（L325/334/341），root/union/ref 零消耗（L312/346/makeRefResolver 先解析）——value 的唯一产出点是 `i === segs.length` 的 walk 分支（L304-308），不存在深度 k<n 产出 value 的分支。✓
- **第 3 步（三源皆 live 缺席事实）**：`{ok:true, value:undefined}` 在现行 navigate 中恰好三处产出（L324 Record / L331 optional / L340 越界），逐行核实无第四源；到达终点的 live 值在中段每步已过滤 undefined（三源先行拦截），walk 构造点枚举（extract.ts L104-112 Record→`{}` / L115-123 封闭→`{}` / L128-134 数组→`[]` / L137-138 xml→串 / L140-143+copyPlainValue JSON 值域）实读核实恒非 undefined。✓
- **第 4 步（归谬）**：成员 j 以 missing 胜出 ⟹ j 停在深度 k<n（live_k 在 segs[k] 缺席，无法取得 child）；任一后序成员 m′ 从同一 (live, i_union) 出发，产出 value 必须经过深度 k（第 2 步），到深度 k 面对同一缺席 live_k（第 1 步）——map 形得 missing/reject（M1/M2/M4/M7）、array 形得 missing/reject（M3/M6）——不可能下钻过 k，不可能到终点。**无逃逸分支。∎** ✓
- **对抗性反例搜索（本报告新增）**：尝试了 map 显式 undefined 值（SA5 探针 b1——D4 先收，两成员同见同判）、嵌套 union 递归聚合、异构载体联合、终点=union 整树投影、空路径、零成员 union（中段空循环 reject，两仲裁一致）、空 doc 惰性 map——均在归谬框架内，无「前序 missing + 后序 value」可构造输入。唯一分叉面确如设计 §3.5 边界所载：手造派生物 E100 域（H-2 场景推演成立：missing 后继续试探可触达旧短路跳过的违规 ref/深层零成员 union 终点 walkUnion throw——中段零成员 union 两版均空循环不 throw，throw 仅发生在终点 walk 委托，与 H-2 表述一致）。

### 2. 观测等价定理三 case 重推

- Case 1（首 ok = 真值 X）：j 前全 reject 两版同序同判；j 处旧 `{ok:true, value:X≠undefined}` ⟺ 新 `{kind:'value', value:X}`（INV-12 的映射可逆性）→ 同返 X。✓
- Case 2（首 ok = missing）：依赖归谬第 4 步——后序成员至多 missing/reject，新仲裁落入 `sawMissing=true` → 顶层 `{ok:true, value:undefined}`，与旧顶层逐字一致（含 FC-3 value 键显式构造）。后序试探的 memo 状态差异不可观测（per-call 局部，纯读取零副作用——probeRoot 仅 Phase B 前调用一次，不随成员试探重复）。✓
- Case 3（全拒）：reject 结局映射不变 → 同一 `notAllowed(path, '路径无法在 live 数据上解析（不变量外输入）')`，message 逐字一致。✓
- 定理域「合法 derived × **任意** live doc（含不变量外）」：归谬不依赖 live 满足不变量，三 case 在 C2 域输入上同样成立。✓

### 3. INV-12 完备性论证

三态完备互斥的支点「`kind:'value'` 的 value 恒非 undefined」论证链完整：中段 undefined 全拦截（三源）+ 终点 walk 构造点枚举（源码行号实读核实）。设计 §3.2 伪代码产出 missing 恰好三处（L128/L135/L144），与 M1-M3 一一对应，无遗漏分支；`kind:'value'` 仅终点一处。**memo 哨兵安全性**：memo 存储 outcome 对象引用（read.ts:277-278 `hit !== undefined` 判对象引用），三态对象恒非 undefined——值域扩展不破坏哨兵。✓

### 4. D17 伪代码与现行 read.ts 逐行 diff 对照

§3.2 伪代码 L110-162 vs 现行 read.ts L295-357：分支全覆盖（root/map/array/union/leaf/plain/xml-fragment/ref），「未标注行与现行逐字一致」声明逐行核实成立；十处 `// rev1` 标注与结局编码改写（reject×7 / missing×3 / value×1 + union 仲裁循环 + 顶层三分支）无行为遗漏。顶层映射 FC-3（value 键显式构造）与 reject→notAllowed 措辞均保持。✓

### 5. D18 调和表 vs extract.ts 实读

「首个接受者胜」（L167）/「全拒→声明序首真 issue」（L168/170）/「全软拒→回退成员 0 提交提取」（L171-174）/「封闭 map 缺必填置软标记不中断、真 issue 立即拒」（L206-216）/「Record 形成员试验=直接 walk」（L197-201）/「判别式零读取」（walkUnion 全文无 discriminator 消费）——调和表六维与「extract.ts:158-175」引注逐条准确。两层接缝单一（路径耗尽）论证成立：终点 walk 委托逐字继承，SUP-1 XML 情形不经中段循环。✓

### 6. 实证基线（本报告实测）

```
$ node_modules/.bin/vitest run packages/doc-runtime/test/read-logical-value-at-path-rev1-union-arbitration.test.ts \
    packages/doc-runtime/test/read-logical-value-at-path.test.ts \
    packages/doc-runtime/test/read-logical-value-at-path-supplementary.test.ts
Test Files  3 passed (3) / Tests  66 passed (66) / Type Errors  no errors
```

18（rev1）+ 20（首轮）+ 28（supplementary，12 it 含 it.each 展开）= 66 全绿——「现行实现下观测等价的实证基线」成立，SA6 18 例计数核实（`grep -c "it("` = 18）。版本 bump 前提核实：`packages/doc-runtime/package.json` 现值 `0.1.2` ✓。caller 清单核实：`grep -rn "readLogicalValueAtPath" packages/ apps/` 命中 8 文件——src 三文件（read.ts 本体 / index.ts 转出口 / extract.ts JSDoc 提及）+ 测试四文件 + vfsl/index.ts（注释提及）；**无真实调用点**，设计 §6 caller 审计结论成立（extract.ts/vfsl-index 两处为 JSDoc 注释级提及，非调用，可在 §6 措辞中补一句澄清，不义务）。

---

## 协议假设依据审查

- **章节存在性**：§5 存在，且明示「无新增协议级假设」（纯包内类型/控制流重构，无 HTTP/WS/端口/进程/第三方库行为假设）——与本修订性质相符。✓
- **依据可验证性**：六行假设表全部带具体依据——源码行号引用（extract.ts L105/L115/L118、L104-112/L115-123/L128-134/L137-138/L140-143、read.ts:277-278，本报告抽查全部命中）或 SA5 设计期实测（yjs-undefined 探针输出原文、E309 探针输出原文、map 显式 undefined 探针 b1 输出）。**无「应该/通常/预计」类无据推断。**「实测验证」栏引用的命令与输出摘录位于 SA5 Evidence 节（`=== 汇总: 24/24 PASS ===`、探针异常消息原文），SA4 可按 SA5 报告重跑定位。✓
- **风险自评**：两行标「低」的假设（`Y.Map.get` 缺键判据、memo 哨兵）均有现存代码与 48+18 用例基线背书，分级合理。✓

## 错误处理链路审查

- **静默失败**：无。本修订是纯同步只读函数内部仲裁策略，无 UI/异步任务面；一切失败收束 `PATH_NOT_ALLOWED + message`（D6/D11 不变），顶层 try/catch 收编一切异常（含 H-2 的 E100 面——结构化返回不外抛）。✓
- **状态闭环**：纯函数、无跨调用状态（memo/patternCache 均 per-call 局部）；无 `exStatus` 类状态机义务。✓
- **降级路径**：无外部依赖服务；不变量外输入的防御映射（C2）维持 loud 单通道。✓
- **虚假降级识别（重点核查）**：
  - M4 required 缺席 → **reject**（非 missing）：AC3 白名单不含 required，设计显式援引 2026-05-07 立法拒绝虚假降级（H-4 风险条目 + SUP-2 Phase B 既有锁：26 层 required 缺席 → PATH_NOT_ALLOWED 非 undefined）。✓
  - mixed 裁决 missing > reject **不构成虚假降级**：union any-of 语义下，reject 成员（如 required 缺席的 `{bar}`）的「拒绝」是成员回退信号参与 any-of 试验——与 extract `trialMember` 软拒让位同构（extract.ts L209/L216），非不变量破坏被冒充合法缺席；且该裁决与现行行为一致（SA5 实证 5a/5c + R4-3 锁）。✓
  - 攻击点 #1 中「yjs undefined 元素 → reject 而非 missing」的现行行为同样不是降级掩盖（undefined 元素属不变量外活数据态，reject → C2 单通道 loud）。✓

## 红线测试思路

对应攻击点与既有护栏的测试方向（供 SA4/SA7；SA3 不编写）：

1. **攻击点 #3（成本护栏缺口）**：`-rev1-hardening.test.ts` 补「26 层重叠联合 × 中段 optional 缺席」护栏——fixture 将 SUP-2 链式形状的外层字段改 optional（`{ x?: L2; t1: YLeaf } | { x: L2; t2: YLeaf }` 递归 26 层），live 构造到第 13 层后缺 `x`：读 `['e', ...x×12]` 深层路径 → 断言 `ok:true, value:undefined` 且 `elapsed < 2000ms`。红灯触发条件：实现丢失 memo 或 value-first 试探未摊销（指数回潮）。
2. **攻击点 #4（mixed 反序锚）**：`type U = { bar: YLeaf<string> } | { foo?: YLeaf<string> }` + live `x = Y.Map({})` 读 `['x','foo']` → 断言 `ok:true` + value 键显式存在且 undefined（reject 先、missing 后仍 missing 胜）。红灯触发条件：实现「循环遇 reject 提前终止」或 sawMissing 记账写反。
3. **M4 伪降级哨兵（既有，保持）**：SUP-2 Phase B 例即红线性护栏——任何把 required 缺席归 missing 的实现立即转红（PATH_NOT_ALLOWED → undefined）。
4. **INV-14 三态不泄漏（既有，保持）**：test-d 冻结形态锁——实现若把 missing/reject 并入公共联合即类型层转红。
5. **AC-R5 全绿护栏（既有，保持）**：66 例 = 观测等价定理的行为锚——任一转红即定理被实证推翻，按真实状态上报（设计 §4 明文禁止调测试迁就实现）。

## 结论

SA1 rev1 设计的核心论证（四步归谬、观测等价定理、INV-12 完备性）经 SA2 独立重推与源码逐行对照**全部成立**；D16/D17/D18/D13 重述与 ADR-0003/0007、首轮冻结契约、extract 声明序规则零冲突；owner AC-R1..R5 与四规则逐条兑现；66 例全绿实测锚定行为不变基线。攻击点 #1/#2 为文档勘误级（要求 SA1 修正但不阻塞），#3/#4/#5 为建议级。

**Verdict = pass，同意放行进入实现（SA3）。**

# SA1 设计文档 — Parser 容器与标记类型：T[] / Record / 六标记 / string & Pattern

> 任务：task_vfsl-parser-containers-markers ｜ Issue #6 ｜ 类型：功能开发（在 #5 最小端到端之上做加法）
> 设计者：SA1 ｜ 日期：2026-08-19 ｜ 状态：**R5（按 SA2 R4 评审 reject 修订；R4-1/R4-2 两点已逐条落实，见「SA2 反馈逐条回应（R4 轮）」）**
> Worktree：`/home/wangjian/nomicore-fix-issue-6`（分支 `fix/issue-6-on-refactor-docs-add-mabf-multi-repo-monito`）

**设计输入**（已全文阅读）：

| 输入 | 角色 |
|---|---|
| `docs/vfsl/v1-spec.md`（frozen） | v1 方言唯一规范来源：§2 EBNF + 注记（ArrayType/RecordType/Marker/PatternType 产生式、注记 1 优先级、注记 6 转义）、§3 标记语义（默认物化表、三分类、纯值上下文、实参形状约束表）、§4 19 码 + 判定顺序 + 分相位、§6 大小写契约、§9 未冻结项、§10 fixture |
| `wiki/raw/task_vfsl-parser-containers-markers.md` | 本任务简报（含 §7 SA6 红灯记录：33 条，25 红 / 8 绿锁，及 §7.5 边界提示） |
| `wiki/raw/20260818-prd-vfsl-v1.md` | PRD 归档：`parseVfsl(text)` 接缝冻结、零运行时依赖、IR 可 JSON 序列化 |
| `wiki/raw/task_vfsl-parser-min-e2e_design.md` | #5 设计（R3 定稿）：§8 切片外构造拒绝策略、§4.2 记号全集 Day 1 齐备、§7.3 IR 判别联合扩展位、§15 资源界——本设计逐项兑现 |
| `wiki/raw/task_vfsl-parser-containers-markers_sa2_review.md` | **【R5】SA2 R4 轮评审（verdict: reject；攻击点 R4-1 HIGH——环 SCC 分量池「任意深度」分解口径未定义，须顶层分解钉死；R4-2 LOW——§11.4 T-R3-1c 括注锚点笔误）——本修订的指令来源**；R3 轮（M1/M2/M3）、R2 轮（N1/N2/N3）、R1 轮（#1~#8）为同文件历史存档（历轮攻击点均已被 R4 轮评审确认修复） |
| `packages/vfsl/src/`（tokenizer 252 行 / parser 409 / semantic 181 / ir 45 / errors 31 / index 53） | #5 交付现状，本任务在其上做加法（逐文件已读；R2 期复核了 parser.ts `parseGenericDiag`/`parsePostfixType` 与 semantic.ts walk/E106 的现状行为） |
| `packages/vfsl/test/`（4 文件 70 用例：#5 交付 37 绿 + 本任务 33） | SA6 红灯契约（25 条红灯锚点已逐条脚本复核，见 §11）；R2 期 grep 复核 #5 三文件无 `X<T>[]` 族输入（§1.2 迁移行的判读依据） |
| `CONTEXT.md`、`docs/adr/0001`、`docs/adr/0002` | 术语（标记类型大小写契约、判别联合、封闭对象）与架构红线（纯引擎仓库、无机器标签） |

**R5 修订记录**（【R5 · SA2 R4-#】为修订点标记，正文各节就地标注；R4 及更早的修订记录保留于下表）：

| 攻击点 | 严重度 | 修订落点（摘要） |
|---|---|---|
| R4-1 §5.2 环 SCC 分量池的「（ref / 叶，任意深度）」分解口径未定义——容器介导环（声明体为内联 ObjectType 等容器叶、环介导 ref 藏于其字段位联合内）三种可辩读法观测面分歧（P1：(a) 顶层分量 **E106@A@(2,15)** vs (b) 任意深度全收集 **E304@YMap@(1,10)**；P3：(a) E106@(2,15) vs (b)/(c) E304@(1,10)）；字面读法 (b) 对**内联 ObjectType 实参**报「非对象形」——与规格 §3 约束表 E304 触发条件直接冲突，且与非环分支自相矛盾（非环 `type C = { x: string \| number };` 经 localCls 恒 'map'，同一形状加深一条自引用即翻 'mixed'）；规格 §4 规范自引用示例恰属此输入族而 R4 电池 50 断言与现行 70 条测试对该族全部盲区 | HIGH | §5.2 环 SCC 求值伪码分量池行改写为**顶层分解**（选 SA2 推荐选案 (a)：体为 ref → 该 ref；体为联合 → 顶层成员（ref/叶）；体为叶 → 该叶 localCls；容器叶内部嵌套 ref 仅作图边不入池）+「与非环分支成员分量同一分解 notions，环与非环 Cls 语义仅在切除环内 ref 一点上不同」注记 + R5 专段（P1/P3 三读法推演 + 非环对照实证）+ 承载机制对照表补行 + 图边职责注记；§8-18「全部分量」→「顶层分量」；**§8-19 新增登记**（分解定义 + P1/P3 观测面写死 + (b)/(c) 否证）；§11.4 T-R4-1/T-R4-2/T-R4-3（+T-R4-4 判读辅助）；§9-3 memo 纪律补分量池实现注记；R5 电池补容器介导环用例（P1/P3/P5 + 规格规范示例 + P4 多体变体 + 非环对照；三读法并列实现 37 断言全过，历轮环拓扑回归与 R4 登记值逐项一致） |
| R4-2 §11.4 T-R3-1c 括注锚点笔误：候选池第三项 (3,26) 实为 (3,27)（`M2` 比 `M` 多一字符，第三行 `boolean` 全行右移一位；胜出断言 E309@M@(1,10) 不受影响） | LOW | §11.4 T-R3-1c 括注改 **(3,27)** 并标注勘误依据（脚本核算）；SA6 补测以本值为准 |

**R4 修订记录**（【R4 · SA2 M#】为修订点标记，正文各节就地标注；R3 及更早的修订记录保留于下表）：

| 攻击点 | 严重度 | 修订落点（摘要） |
|---|---|---|
| M1 §5.6 E309 扫描谓词六值原始不等比较——容器桶内差异（'map' vs 'container'）被当作「形状类别不同」：`type T = { a: string } \| string[];`（v1 合法，规格 §3 三分类第二行明文多态物化）被 E309 错拒；次生缺口 1b：first=c='mixed' 的组合联合（mixed\|mixed）不触发，报告锚漂移 | HIGH | §5.6 扫描伪码重写为规格三分类**桶级折叠**（bucket(map)=bucket(container)=容器桶；'mixed' 恒异类、含 mixed\|mixed；等价谓词 `(∃scalar ∧ ∃container) ∨ ∃mixed`）+ **mixed 成员锚规则**（首个 mixed 成员本身即异类锚——含其为首成员）；§8-17 登记（含 E304 维持精确值不受折叠影响的界分）；§11.4 T-R3-1a~1d。设计期模拟：1a/1b ok:true、1c E309@M@(1,10)、1d E309@number@(1,26)，并复现 R3 现状（1a 被错拒 E309@string@(1,26)、1c 锚漂移 (2,26)） |
| M2 §5.2 computeCls 环上名（经联合介导的 SCC）Cls 值指派依赖声明顺序——根迭代序决定环内谁先遇灰回边：`type X = YMap<T>;\ntype T = U1;\ntype U1 = T \| number;` 与其 2/3 行互换版分别报 E304@(1,10) / E106@(2,11)，违反规格 §4「别名解析与声明顺序无关」（明文适用于 E304）并证伪 §3.3 自身声称；且伪码未规定根迭代序，SA3 即兴空间无界 | HIGH | §5.2 全节重写：**迭代 Tarjan SCC 分解 + SCC 弹出即求值**，环 SCC 全成员取**切环合成的均匀值**（选 SA2 方案①：环上全部体分量、环内 ref 记 'cycle' 分量、eff 移除）——表与表值 = 引用图的函数（起点序/声明序任意）；灰集机制整体退役（R2 #1a/b/c 簿记缺陷结构性消灭，#2/#4/N1 语义经 comp() 已声明检查 / 前置归一 / 第 2 步入表原样继承）；§3.3 声称由机制兑现；§8-9 'cycle' 授予范围 R4 化 + §8-18 新增（选案①论证、否决案②三理由、cls/strForm 口径差异的机制论证、min-position 文本位注记）；§9-3 Tarjan 迭代纪律、§9-10 断言更新为声明排列属性自检；§11.4 T-R3-2（A/B 两序同码同位 E304@(1,10)，R3 现状 A E304/B E106 复现）。strForm 侧不动（SA2 已核实无此缺陷，T-z/T-t 回归验证不受影响） |
| M3 §5.2 闭环证明「'unknown' ⟸ ……｜多体名（必产 E302 候选）」bullet 与伪码前置归一条款冲突——多体名得确定合成值而非恒 'unknown' | LOW | 闭环证明改述：多体名单列——Cls 为虚拟联合合成值（**确定值**，是否 'unknown' 取决于分量：`type B = string; type B = number;` → 'scalar'），安全性依据 = E302 候选在场（非值恒 'unknown'）；结论（只在必 ok:false 模块出现）不变 |

**R3 修订记录**（【R3 · SA2 N#】为修订点标记，正文各节就地标注；R2 及更早的修订记录保留于下表）：

| 攻击点 | 严重度 | 修订落点（摘要） |
|---|---|---|
| N3 §5.4 strForm 多体分支指数复杂度挂起 | CRITICAL | §5.4 全节重写为**两步法**：cycNames（on-cycle 灰 DFS + 反向传播，架构同构 §5.5 containsSync）预填 ⊥ + 名字级 memo 帧栈迭代求值（无环名折叠规则原文保留）；「灰命中仅 ⊥ 分量」读法修正为「环触达 ⊥ 不裁决」（§8-10 R3，与 §8-9 一致化，T-z 锁定观测面）；§9-3 迭代 + memo 纪律显式纳入 computeStrForm；§5.1/§5.4/§7 三处「浅层迭代 / 无深递归」绝对表述删除；§11.3 T-R2-4/T-R2-5/T-z；设计期同构复现 R2 指数（k=8..16 → 767/3071/12287/49151/196607 步，严格 ×2/级 = 3·2^k−1）并验证 R3 线性（k=40 → 124 步 1.6ms） |
| N1 §5.3 E304 查询位 cls 表覆盖缺口（prose 称「表覆盖一切被引用名」而伪码根仅已声明名、⑤ 不下降） | HIGH | §5.1 新增**统一查询助手 clsOf**（ref → 表 + 未声明 'unknown'；union → synthesize；否则 localCls）；§5.2 **根集扩展**（根 = 已声明名 ∪ walk 全部 ref 出现名，未声明者经守卫 ② memo 'unknown'）——§3.3 声称由构造成立；§5.3/§5.6 查询位全部改经 clsOf（memberCls 并入）；§11.3 T-R2-1 |
| N2 §5.1/§5.2 localCls 缺 union 行（`YLeaf<string\|number>` v1 明文合法被 E304 错拒；直接联合归类未登记） | HIGH | clsOf 增加 **union 行**（= synthesize(成员 clsOf)，与 §5.2 ④ / §8-10 多体虚拟联合同一规则）；**§8-16 登记**从宽口径（规格 §3 YLeaf 行「其联合」+ §3「YMap」节「T 为对象形联合」双料文义 + 单调性论证）；§11.3 T-R2-2/T-R2-3/T-R2-3b |

**R2 修订记录**（【R2 · SA2 #N】为修订点标记，正文各节就地标注）：

| 攻击点 | 严重度 | 修订落点（摘要） |
|---|---|---|
| #1 computeCls 灰集簿记 | CRITICAL | §5.2 全节重写：ref 分支 memo 先于灰；五条路径统一 pop 清灰；根帧入栈加灰；不变量升级「灰 ≡ 栈内名字集 且 栈为 DFS 路径」（单待定入栈——**强于 SA2 字面修复**：批量入栈下兄弟拓扑仍假环，已一并消除）；反例入 §11 T-m/T-n |
| #2 未声明名的输入域 | CRITICAL | §5.1 增 'unknown' 类；§5.2 帧级守卫 ②（未声明名显式 memo 'unknown'，先于取体）；synthesize 主导传播；E304/E309 不裁决；§5.4 strForm 未声明从 false 改为不下裁决（统一口径，登记 §8-13）；E301 通道独占错误身份 |
| #3 generic-diag 缺分派行 | HIGH | §5.2 localCls、§5.3/§5.6 查询、§5.4 strForm 终端、§5.5 pvCheck 全部显式列 generic-diag → 'unknown' / 不下裁决 / 跳过；登记 §8-14 |
| #4 E302 多体的 Cls/strForm 取体 | MEDIUM | §5.2 前置归一（扁平虚拟联合 + synthesize 结合律）；§5.4 strForm 多体规则；位置竞争写死（§8-10：T-t → E302@(2,6)；前向引用变体 → E306@(1,17)） |
| #5 E309 检查位集合 vs 规格适用位枚举 | MEDIUM | 选 SA2 选项①（仍检查，登记 + 规格文义论证，§8-15）：「适用于…」枚举系默认物化表第 5 行（多态物化位）而非 E309 豁免；E309 适用域 =「同步物化上下文」= PV 补集；pvCheck 仍下降键（「子树内一切」绝对文义 + E306 支配观察）；T-u 注册 E309@(1,21) 胜出 |
| #6 自反对象形缺正例锁 | LOW | §11 T-v：`YMap<YMap<{ x: string }>>` → ok: true |
| #7 实测依据不可复跑 | LOW | §13 + §5.2 改「设计期一次性证据（定性）+ 口径可按述重建 + 运行面由 SA7 以 T-l 动态兑现」；R2 期对终版算法重跑（17 拓扑 + 20k 三链 16.6~37.3ms + 递归对照爆栈） |
| #8 锚点迁移族未入行为表 | LOW | §1.2 表新行：generic-diag 后随 `[]` 族 E100 锚 `[`→`<`（实测 (2,21)→(2,13)）；§11 T-w 锁定新锚 |

---

## §1 任务定位与设计承诺

### 1.1 交付物（不变量延续 + 增量）

公共接缝零变更：`parseVfsl(text)` → `{ ok: true; module } | { ok: false; issues }`，同步、纯函数、不抛错（#5 §14/§15 契约原样延续，资源界机制见 §4.6 修订）。本任务的交付全部发生在**接缝内侧**：

1. **语法层**：解析 `T[]`、`Record<K, V>`、六标记 `YMap/YArray/YPlainArray/YLeaf/YXmlFragment<…>`、`string & Pattern<"正则">`（四类 v1 合法构造，#5 §8 表中「本切片未实现 → E100 拒绝」的行在本任务转正）。
2. **语义层**：引入四个引用/语义相位错误码 **E304 / E306 / E307 / E309**（#5 §9 延后清单按简报 §7.5.1 兑现）。
3. **IR 层**：`VfslType` 判别联合追加 4 个成员（§6），标记及其包裹目标、Record 键约束、解码后正则原文全部进入 IR。

### 1.2 切片承诺与单向收敛

**本切片构造，全语义**（沿用 #5 §1.2 不变量）：四类新构造在 v1 规格下的全部可适用条款——语法推导、标记实参形状（E304）、Record 键 string 形（E306）、纯值上下文（E307，含经别名间接）、混合联合三分类（E309，含别名解析后判定）、锚点行列、判定时机（模块全量解析后）——都在本切片兑现，不留暗坑。

**单向收敛承诺**（简报约束 3 的设计侧表述）：#5 拒绝的 v1 合法文本（`T[]`、`Record<…>`、标记、`string & Pattern<…>` 四族的 E100「本切片未实现」）转 `ok: true`；#5 已接受的行为无一翻转——具体地：

| #5 行为 | 本任务后 | 性质 |
|---|---|---|
| `type A = YMap<string>;` → E100「本切片未实现」 | → E304（实参非对象形） | 单向收敛：真错误浮出（#5 §8 已预言该文本全 v1 是 E304） |
| `type A = string[];` → E100 | → `ok: true` | 单向收敛 |
| 裸保留名（`type A = YMap;`、`string<number>`、`string & Pattern;`）→ E100 | 不变（判定顺序第 7 条） | 零变化 |
| 标记大小写变体（`yleaf`/`YLEaf`）未声明 → E301 | 不变（generic-diag 路径） | 零变化 |
| 既有 37 条 #5 测试 | 全部保持绿（已逐条核对输入，无一断言与新构造冲突，§10.3） | 零破坏 |
| **【R2 · SA2 #8】generic-diag 后随 `[]` 族**（`type Box = string;\ntype T = Box<number>[];`）→ E100 锚 `[`@旧切片立即抛（实测 (2,21)） | E100 锚**迁移**至 generic-diag 终判的 `<`@(2,13)（规格判定顺序第 6 条正锚；`[` 被正常消费为数组后缀） | **锚点迁移**：同为 ok:false + E100，仅锚点回归规格第 6 条；#5 三文件 grep 无此族输入（§10.3），无绿测冲突。SA4 行为面对比时按本行判读，勿误判为翻转 |

### 1.3 明确不做（与简报对齐）

- 不实现：`/** */` 文档注释原文捕获与挂载、**E305**（随 JSDoc issue 交付——fixture 的 7 条文档注释本切片仍按忽略型 trivia，`ok: true`，与 #5 行为一致）；求值器、信封解析、方言路由。
- 不动：`src/tokenizer.ts`（零改动，见 §3.2——这是 #5「记号全集 Day 1 齐备」承诺的兑现验证点）、`src/index.ts`（编排与公共面不变）。
- 不引入：任何 runtime 依赖、任何构建产物。

---

## §2 需求推演（Feature）

### 2.1 AC → 设计要点映射

| AC（简报 §二） | 设计落点 | 红灯锚定 |
|---|---|---|
| AC1 六标记正例进 IR + 嵌套 | §4.2 Marker 解析、§6 IR `marker` 节点（包裹目标不折叠） | SA6 12 条（正例 + 可区分性锚 + fixture 端到端） |
| AC2 Record 键与 Pattern 键约束进 IR | §4.2 Record 解析、§5.4 E306、§6 IR `record` 节点（键 TypeExpr 原样入 IR，别名不内联） | SA6 6 条 |
| AC3 `string & Pattern<"正则">` 唯一交叉 | §4.3 PatternType **主层识别**（注记 1 的必然性论证）、其余 `&` 族一律 E100 | SA6 8 条 |
| AC4 大小写契约 | §4.5：变体拼写仍走 generic-diag → E301（判定顺序第 6 条路径不变） | SA6 4 条 |
| 形状/上下文边界（E304×4 / E306×2 / E307×2 / E309×1） | §5.3~§5.6 | SA6 9 条 |

### 2.2 与 #5 扩展位的兑现关系（#5 设计原文 → 本设计）

| #5 预留扩展位 | 本设计兑现 |
|---|---|
| §4.2「记号全集 Day 1 即为 v1 全量，为 #6~#9 铺路」（`< > & [ ] ,` 本切片用不到也产出） | **tokenizer 零改动**——`T[]`/`Record<,>`/标记/交叉所需的全部记号已存在 |
| §5.2「parser 的 PrimaryType 分发表留扩展位」 | parseIdentType 的 Record/标记分支从「E100 拒绝」改「完整解析」（§4.2） |
| §7.3「IR 以 kind 判别联合预留全部 v1 节点（追加 array / record / pattern / ymap / …）——纯加法」 | §6：追加 `array` / `record` / `marker` / `pattern` 四成员 |
| §8「#6~#9 落地后：`T[]` → ok:true + IR 增 array；`Record` → ok:true + E306 引入；`string & Pattern` → ok:true + IR 增 pattern；六标记 → ok:true + E304/E307/E309 引入」 | 逐行兑现（E306 一并引入系简报 §7.5.1 明示） |
| §15 资源界（深度预算 + 迭代 DFS + 顶层兜底） | §4.6 预算口径扩展 + §5.2 新图遍历全部迭代化（同一纪律） |

### 2.3 关键推演：为什么 PatternType 必须在**主层（primary）识别**而不是续位分派

#5 的 `dispatchContinuation` 在 `parsePostfixType` 的 `[` 循环**之后**检查 `&`。规格 §2 注记 1 冻结：`string & Pattern<"a">[]` 是「**约束字符串的数组**」——`[]` 后缀作用于整个 PatternType，且 EBNF 中 `PatternType` 本身就是 `PrimaryType` 的一个产生式分支。若维持 #5 的续位读法，`string & Pattern<"a">[]` 会先被 `[` 循环包装成 `array(string)`，再在续位遇 `&` → E100——**把 v1 合法文本错拒**。因此 `string & Pattern<…>` 的完整形态识别必须前移到 parsePrimaryType 的 `string` 分支内（识别成功返回单一 pattern 主类型节点，随后 `[]` 后缀自然作用于它）。这是本任务对 #5 parser 结构的唯一一处**重排**（不是行为翻转：#5 在该位置本来就是 E100 拒绝，重排后合法形态转正、非法 `&` 族的码与锚点全部保持，§4.3 四案例）。

---

## §3 总体架构：分层不变，两处增量

### 3.1 模块布局（#5 §3.1 的 6 文件 → 7 文件）

```
src/
  index.ts      零改动（编排 tokenize → parse → analyze 不变；VfslType 新成员经 ir.ts 再导出自动生效）
  errors.ts     +4 码（E304/E306/E307/E309 进注册表）
  tokenizer.ts  零改动（验证 #5「Day 1 全量记号」承诺）
  parser.ts     修改：4 类新构造解析 + AST 4 新节点 + 统一嵌套预算（§4）
  semantic.ts   修改：walk 扩展（新节点的 ref/E308/E106 边收集 + generic-diag 全位访问，§9-10）
                + 调 shapes.ts 入池 + toIR 扩展
  shapes.ts     新建：形状解析（cls：R4 迭代 Tarjan SCC 分解 + 完成即求值，环 SCC 切环合成均匀指派；
                分量池顶层分解【R5 · SA2 R4-1，§8-19】——与非环分支同一分解 notions）
                + 统一查询助手 clsOf（§5.1 R3）+ E309 桶级扫描（§5.6 R4：六值→规格三分类折叠）
                + strForm 两步法（cycNames + 名字级 memo + strFormOf，§5.4 R3，不变）
                + E304/E306/E307/E309 候选收集（§5；
                R2：输入域完备——未声明名/generic-diag/多体显式进入分类域；
                R3：查询侧界面闭环——一切查询位经 clsOf/strFormOf；
                R4：环上名值规范化——表值与声明序无关，§5.2/§8-18）
  ir.ts         修改：VfslType 追加 4 成员（纯加法）
```

分层与公共契约关系不变：只有 `index.ts` 导出面是公共契约；shapes.ts 与 parser 内部件一样不导出。

### 3.2 数据流（两相位模型不变，语义相位扩容）

```
text ──tokenizer（零改动）─▶ Token[]
     ──parser─────────────▶ AST（+array/record/marker/pattern 节点）｜首个语法相位 issue
     ──semantic───────────▶ 候选池：E301/E302/E106/E308/generic-diag 终判（#5 既有）
                             + E304/E306/E307/E309（shapes.ts 新增）
                             → (line, column, 错误码数值) 最小 → 唯一 issue
     ──toIR───────────────▶ VfslModule（+4 节点种类）
```

相位语义严格对齐规格 §4：新四码全部是引用/语义相位（判定时机 = 模块全量解析成功后、别名解析后），与 #5 既有四码同池聚合，**不引入新相位、不改聚合规则**。

### 3.3 判定时机一致性（规格 §4「别名解析与声明顺序无关」条款对新码的适用）

规格明文：该解析时机条款适用于 E301/E304/E306/E307/E309（全部引用/语义层错误）。实现上四个新检查全部依赖**两张全局表**（构建于模块全量解析之后）：

- `declared: Map<名, 别名体[]>`（E302 重复声明时一体多体，取体口径见 §8-10【R2】）；
- `cls: Map<名, Cls>` 与 `containsSync: Set<名>`（§5.1~§5.2，迭代计算；**表覆盖模块内出现的一切被引用名——R3 起由构造成立**【R3 · SA2 N1】：computeCls 覆盖已声明名 ∪ walk 收集的全部 ref 出现名（与 semantic.ts E301 收集器同源遍历，§9-10 扩展位），未声明名显式记 'unknown'（R4 第 2 步入表）；查询侧统一助手 clsOf 的 `?? 'unknown'` 退化为防御性带保险。**表值与声明序无关——R4 起由机制成立**【R4 · SA2 M2】：cls 由 SCC 分解 + 完成即求值计算（§5.2），环 SCC 全成员取切环合成的均匀值（§8-18），不含任何遍历序分量——R3 的 worklist 口径下该声称被 SA2 以「行序互换即 E304↔E106 漂移」反例证伪）；
- `strCls: Map<名, 三值>`（§5.4 R3 两步法预计算：环触达名 ⊥ + 无环名 memo 求值；查询侧 O(1) 助手 strFormOf）。

前向引用天然合法：`type R = Record<AssetId, string>; type AssetId = string & Pattern<"a">;`——键形状在全局表就绪后判定，与声明序无关 ✓（**R4 起对含环模块同样成立**：环上名的值是 SCC 图函数，T-R3-2 的 2/3 行互换对产出完全相同的错误码与位置）。

---

## §4 Parser 设计（递归下降的加法扩展）

### 4.1 内部 AST 新节点（AstType 追加 4 成员，均带 pos）

```ts
| { kind: 'array';   element: AstType; pos: Pos }                       // T[]；pos = 构造起始（primary 起点）
| { kind: 'record';  key: AstType; value: AstType; pos: Pos }           // pos = 'Record' 记号
| { kind: 'marker';  marker: 'YMap'|'YArray'|'YPlainArray'|'YLeaf'|'YXmlFragment'; arg: AstType; pos: Pos }  // pos = 标记名记号
| { kind: 'pattern'; regex: string; pos: Pos }                          // pos = 'string' 记号（PatternType 构造起点）
```

- `pos` 用途：E304 锚 = 标记名记号（`marker.pos`）；E306 锚 = 键类型起点（`nodePos(key)`）；E309 锚 = 成员起点（`nodePos(member)`）；E307 锚 = 标记/引用记号。`nodePos()` 对 array 取 `element` 链的起点（构造起点语义），generic-diag 仍取 namePos（#5 既有）。
- 不为 Marker 拆五个 kind：子判别字段 `marker` 足够，switch 穷尽性由 TS 保证，未来 JSDoc 挂载（§5 规格挂载点含「标记类型 Marker 记号处」）也只需一个挂载位。
- **【R2 · SA2 #3】marker 实参 / Record 键 / 联合成员在语法上完全可以是 generic-diag 节点**（`type A = YMap<Foo<1>>;`：parseGenericDiag 消费 `<1>` 后外层 parseMarkerType 正常闭合 `>`，模块语法相位成功）。AST 与全部下游分发表必须把它当作合法输入（§5 各查询、§9-10 walk）。

### 4.2 分发伪代码（parseIdentType / parsePostfixType 增量）

```text
parseIdentType(tok):                              # 「类型位置」的 Ident 分派（判定顺序不变）
  'interface'/'extends'/'any' → E105/E103/E101（锚该记号，#5 既有，不变）
  'Record':
    后随 '<' → parseRecordType(tok)               # ★ 新增：完整解析（原 E100「本切片未实现」分支删除）
    否则     → E100 裸保留名（第 7 条，锚该记号，不变）
  六标记标准拼写（MARKER_NAMES）:
    后随 '<' → parseMarkerType(tok)               # ★ 新增
    否则     → E100 裸保留名（不变；`type A = YMap;` 仍 E100）
  'type'/'Pattern' → E100 族（第 7 条，不变；裸 Pattern 脱离语境仍锚 'Pattern' 记号）
  五原始类型名:
    'string' 且后随 '&':                          # ★ PatternType 主层识别（§2.3）
        前瞻 Ident 'Pattern' + '<' → parsePatternType(tok)
        前瞻 Ident 'Pattern' 非 '<' → E100「Pattern 脱离语境」锚 'Pattern' 记号（R2 既有口径，不变）
        前瞻其他 → E100「交叉类型仅允许 string & Pattern<…>」锚 '&' 记号（不变）
    后随 '<'（非 '&' 路径）→ E100 锚该原始类型名记号（第 7 条，不变）
    否则 → { kind:'primitive' }
  非保留名 Ident:
    后随 '<' → generic-diag（§5.4 路径整体不变：`yleaf<…>`/`YLEaf<…>`/`Foo<…>` → E301@name 或 E100@'<'）
    否则 → { kind:'ref' }

parseRecordType(tok):                             # 已确认 'Record' + peek '<'；锚 tok = 'Record' 记号
  预算守卫（§4.6，锚 tok）
  消费 '<'
  key   ← parseTypeExpr()                         # 键是完整 TypeExpr（EBNF；可为 ref/pattern/联合/generic-diag【R2 · SA2 #3】）
  期望 ',' 否则 E100 锚实际记号                    # 违反期望记号口径（#5 §5.5 表同族）
  value ← parseTypeExpr()
  期望 '>' 否则 E100 锚实际记号
  return { kind:'record', key, value, pos: posOf(tok) }

parseMarkerType(tok):                             # 已确认标记拼写 + peek '<'；锚 tok = 标记名记号
  预算守卫（§4.6，锚 tok）
  消费 '<'
  arg ← parseTypeExpr()                           # 任意 TypeExpr（YArray/YPlainArray 无形状约束；可为 generic-diag【R2】）
  期望 '>' 否则 E100 锚实际记号
  return { kind:'marker', marker: tok.value, arg, pos: posOf(tok) }

parsePostfixType:                                 # ArrayType 位：原「遇 [ → E100 未实现」改为解析
  t ← parsePrimaryType
  k ← 0
  while 下一记号 = '[':
    k += 1
    预算守卫（§4.6：depth + k 超限 → E100 资源口径，锚该 '[' 记号）
    消费 '['；期望 ']' 否则 E100 锚实际记号        # `string[x]` / EOF 同口径
    t ← { kind:'array', element: t, pos: nodePos(t) }
  dispatchContinuation(t)                         # 残留 '&'：prev 现在恒非 primitive-string（string&…已在主层
                                                  # 消化或抛错）→ 一律 E100 锚 '&'（含 pattern 后第二段 '&'，
                                                  # 即多段交叉）；'extends' → E103（不变）
  返回 t
```

要点核对：

- **`YArray<YArray<string>>` / `YMap<Record<string, YLeaf<string>>>` 嵌套**：parseTypeExpr 递归自然展开；`>>` 由单字符 `>` 记号序列正确配对（tokenizer 零改动的直接受益）。
- **前导 `|` 与联合成员内的新构造**：`| { kind: "image"; … } | …`（fixture AssetEntity）按 parseUnionType 逐成员走 parsePostfixType，无需特判。
- **E104 不受影响**：字段名位遇 `[` 仍在 parseObjectType 字段名槽即报（判定顺序第 4 条），与 postfix `[`（primary 之后）位次不同，二者由位置天然区分。
- **判定顺序第 6 条不变性**：Record 与六标记是保留名，`Record<`/`YMap<` 永远不进 generic-diag；非保留名 + `<`（`yleaf<`、`Foo<`）照旧进 generic-diag → 语义相位终判（未声明 E301 锚引用记号 / 已声明 E100 锚 `<`）。
- **【R2 · SA2 #8】generic-diag 后随 `[]`**：`Box<number>[]` 的 `[` 现被正常消费（array 包裹 generic-diag），错误延迟到终判 E100@`<`——锚点迁移族已入 §1.2 行为表，供 SA4 判读。

### 4.3 PatternType 解析与 `&` 族四案例（AC3 的 parser 侧）

```text
parsePatternType(strTok):                         # 已消费 'string'，确认 & Pattern <
  消费 '&'、'Pattern'、'<'
  记号 = string 字面量 → regex = 解码后文本（tokenizer 已按 §2 注记 6 解码：\"→"、\\→\）
  记号 = 其他（含 number）→ E100「Pattern 实参须为字符串字面量」锚该记号
  期望 '>' 否则 E100 锚实际记号
  return { kind:'pattern', regex, pos: posOf(strTok) }
```

| 案例（SA6 反例） | 行为 | 锚点 |
|---|---|---|
| `string & Pattern<"a">`（完整形态） | `ok: true`，pattern 节点，regex=`"a"` 的解码文本 | —（正例） |
| `number & string`（左元非 string） | E100（dispatchContinuation，prev 非 string） | `&` 记号（R2 既有，不变） |
| `string & number`（右元非 Pattern） | E100（主层前瞻失败） | `&` 记号（不变） |
| `string & Pattern`（缺实参括号） | E100（第 7 条「脱离语境」） | `Pattern` 记号（不变，实测 (1,19)） |
| `string & Pattern<1>`（实参非字符串字面量） | E100（parsePatternType 内） | 该实参记号（`1`@27，脚本核算；未冻结角落登记 §8-8） |
| `string & Pattern<"a"> & number`（多段交叉） | E100（pattern 节点后 dispatchContinuation 遇 `&`） | 第二个 `&` 记号（@32，核算；角落登记 §8-8） |
| `string & Pattern<"[">`（非法正则） | **`ok: true`**（规格 §9.1：正则合法性不在方言层校验） | — |
| `string & Pattern<"\\\\d+">`（双写反斜杠） | `ok: true`，regex = `\\d+`（解码后单反斜杠原文进 IR） | — |

**注记 1 优先级的完整兑现**：`string & Pattern<"a">[]` → 主层 pattern 节点 → `[` 后缀包装 → **约束字符串的数组**（合法，§12 T-h 构想锚定）；对照 `string[] & Pattern<"a">` → `string` 先被 `[` 包装为 array，续位 `&` 的 prev 非 string → E100 锚 `&`（交叉左元必须是裸 `string`）。

### 4.4 判定顺序映射增量核对表（SA2 复核点）

| 规格条款 | #5 行为 | 本设计行为 | 一致性 |
|---|---|---|---|
| 第 6 条：`<` 前标识符非 Record/标记/保留名 → 未声明 E301 / 已声明 E100@`<` | generic-diag 延迟终判 | **不变**（Record/标记现自行消费 `<`，永不落入 generic-diag） | ✅ `yleap<`/`YLEaf<` → E301@引用记号 |
| 第 7 条：裸保留名 / 保留名后随 `<`（`string<number>`）→ E100 | 各分支锚保留名记号 | **不变**（五原始类型、`type`、裸 `Pattern` 分支原样） | ✅ |
| 第 7 条：裸标记（`type A = YMap;`）→ E100 | 锚标记记号 | **不变** | ✅ |
| E104：字段名位 `[` | parseObjectType 字段名槽 | **不变** | ✅ |
| E303：声明名位保留名（`type Record = …`） | E303@声明名 | **不变**（`Record` 等在类型位的行为与声明位互不影响） | ✅ |

### 4.5 大小写契约（AC4）的实现路径

变体拼写（`yleaf`、`ymap`、`YLEaf`、`YXMLFRAGMENT`…）不是保留名（规格 §6），词法上是普通 Ident。**generic-diag 路径天然给出正确行为**：`ymap<{x}>` → 非保留名 + `<` → generic-diag → 未声明 → **E301 锚该引用记号**；已声明（`type yleaf = string;` 后用 `yleaf<number>`）→ E100 锚 `<`（第 6 条「已声明别名带实参使用」）。零新增机制。

### 4.6 🚨 资源界修订：统一类型嵌套预算（对 #5 §15.2 的显式扩展）

#5 的 `MAX_OBJECT_DEPTH = 100` 计数对象 = 「唯一使 parseTypeExpr 递归的入口」。本任务引入**新的递归入口**（marker 实参、record 键/值）与**新的 AST 深度源**（`[]` 后缀串），若不扩展预算口径，`YArray<YArray<…>>`×5000 将击穿「不抛错」契约（parser 递归爆栈 / toIRType 递归爆栈 / JSON.stringify 深度超限）。修订如下（**常量值 100 与「v1 生命周期内不得调升/调降」承诺不变**，变更的是计数口径——本节即 #5 §15.2 所要求的「如需变更须回总控走设计修订」的设计侧修订记录）：

- **常量**：`MAX_TYPE_NESTING = 100`（parser.ts 顶部，不导出；由 MAX_OBJECT_DEPTH 更名并扩口径）。
- **计数对象**：类型容器构造的嵌套层数——`parseObjectType`、`parseMarkerType`、`parseRecordType` 入口 +1 / try-finally 出口 -1（递归栈维度）；`parsePostfixType` 的第 k 个 `[` 检查 `depth + k > MAX`（AST/IR 深度维度——`[]` 循环本身不叠解析栈，但 array 节点链使 toIRType 递归与 JSON 序列化按深度计费）。
- **超限行为**：E100 三态口径的第三态（「实现资源上限，非方言判定」），锚 = **预算耗尽处的容器构造起始记号**（`{` / 标记名 / `Record` / 该 `[`）——#5 锚规则的直接推广。
- **余量复核**（沿用 #5 §15.0 实测基线：爆栈 2912 层、JSON.stringify ≈4456 层）：解析栈 100 层 × ~5 帧 ≈ 500 ≪ 2912（≥5.8×）；序列化最坏 ~4 JSON 层/容器层 × 100 = 400 ≪ 4456（≥11×）。纯对象输入的行为与 #5 完全一致（对象仍逐层计数，#5 §16 T1 构想的 (1,310) 锚不变）。
- **语义相位图遍历的栈安全**：别名链深度无界，#5 仅 E106 DFS 迭代化；本任务新增的 cls / containsSync 两个图查询**同样必须迭代**（§5.2，设计期实测证伪了递归路线）；AST 局部的树遍历（walk / pvCheck / e309Walk / toIRType）深度 ≤ 预算，保持递归（#5 §15.3 同款论证）。

---

## §5 shapes.ts：形状体系与四个新错误码

### 5.1 形状分类体系（Cls 六值）与统一查询助手【R2 · SA2 #2/#3：增 'unknown'；R3 · SA2 N1/N2：增 clsOf（含 union 行）】

别名解析后的**物化形状类别**，是 E304/E309 的共同基础（规格 §3「默认物化规则」「标记成员的形状归类」两表的机械化）：

| Cls | 成员（解析到该层的节点） | 规格依据 |
|---|---|---|
| `scalar` | primitive（含 `unknown`）/ 字面量 / pattern / `YLeaf<…>` / `YPlainArray<…>` / 全标量形联合 | §3「容器内的原始类型/字面量及其联合 → 原生叶子值」「YPlainArray 在同步物化上下文按标量形」 |
| `map` | ObjectType / `Record<…>` / `YMap<…>` / 全 map 形联合 | §3「裸对象 → YMap 物化」「Record → Y.Map」「对象形联合（键空间并集）」 |
| `container` | `T[]` / `YArray<…>` / `YXmlFragment<…>` / 全容器形（map+container 混合）联合 | §3「容器形」大类中非 map 者 |
| `mixed` | 标量形与容器形并存的联合（含成员为 mixed 的传播） | §3 三分类第三类（E309 的形状侧事实） |
| `cycle` | 纯环（环 SCC 切环合成 eff 为空，如 `type Z = W; type W = Z;`）及其经 ref 链的传播【R4 措辞更新：R2/R3 的「解析路径回到灰集」机制已随灰集退役，值语义见 §5.2 R4】 | 角落登记 §8-9/§8-18：环模块由 E106 拒绝，'cycle' 不下裁决；环 SCC 含确定分量者取均匀合成值、正常参与裁决（同样只在必含 E106 候选的模块中） |
| **`unknown`**【R2】 | **未声明名 / generic-diag 节点 / 含上述成员的联合（主导传播）** | **输入域完备性（SA2 #2/#3）：这些名字/节点不构成「可判定的物化形状」——它们各自必产 E301 / generic-diag 终判候选，错误身份由那些通道独占；形状查询一律不下裁决** |

**关键化简（设计的核心杠杆）**：除联合外，一切节点的 Cls **局部可定**（不依赖子节点）——marker 的类别由标记名决定、record 恒 map、array 恒 container（generic-diag 例外：恒 'unknown'，§5.2 localCls）。联合是唯一的非局部节点，其归类（synthesize）与深链的两种介导方式——**裸引用链**（`type A2 = A1;`）与**联合成员引用**（`type Uk = Ok | U(k-1);`）——都由同一次迭代 SCC 分解 + 完成即求值消化【R4 · SA2 M2：R3 的单名 worklist 升格为 SCC 求值单位，消除环上名的入口方向偏置】；环 SCC 的分量池取归一体的**顶层分量**——与非环分支同一分解 notions，环与非环的 Cls 语义仅在「切除环内 ref」一点上不同【R5 · SA2 R4-1，§5.2/§8-19】。由此三个查询归一：

- **object-form**（YMap/YXmlFragment 实参约束）⟺ `clsOf(arg) === 'map'`（object / record / YMap / 全 map 联合——**直接联合与经别名联合同一规则**【R3 · SA2 N2，登记 §8-16】；恰为规格「对象形：内联 ObjectType，或解析到 ObjectType / 对象形联合的别名」+ SA6 边界提示 2 的 Record + 自反的 YMap——自反正例由 §11 T-v 锁定【R2 · SA2 #6】）；
- **scalar-form**（YLeaf 实参约束）⟺ `clsOf(arg) === 'scalar'`；
- **string-form**（E306 键约束）：不可归约（string 与 number 同为 scalar），独立预计算（§5.4 R3 两步法：环触达集 + 名字级 memo 三值表；查询侧 O(1) 助手 strFormOf）。

**统一查询助手 `clsOf`**【R3 · SA2 N1/N2】——E304 实参（§5.3）与 E309 成员（§5.6）的一切查询位**只经此助手**取类（禁止绕过直查 cls 表、禁止在查询位直调 localCls——R2 的两处缺口正源于这两条裸查询路径）：

```text
clsOf(node):
  ref R  → R 已声明 ? (cls[R] ?? 'unknown') : 'unknown'   # 表完备（§5.2 R4 第 2 步未声明名入表）——?? 为防御性带保险
  union  → synthesize(成员.map(clsOf))                    # ★ N2 union 行：与 §5.2 ④ 别名联合、§8-10 多体
                                                          #   虚拟联合同一规则；联合成员恒非联合（flat 展开
                                                          #   不叠深，§4.6）→ clsOf 深度 ≤ 2，无递归风险
  否则   → localCls(node)                                 # 叶子分派（§5.2；generic-diag → 'unknown'）
```

R2 缺口对照（SA2 N1/N2 的两个反例，设计期模拟均验证修复）：`type A = YMap<Foo>;`（Foo 未声明）——R2 的 `cls(arg)` 直查表取 undefined，`undefined !== 'map'` 为真 → E304@YMap@(1,10) 压制 E301@Foo@(1,15)；R3：clsOf → 'unknown' → 不裁决 → **E301 胜出**。`type A = YLeaf<string | number>;`（规格 §3 YLeaf 行「其联合」明文合法）——R2 的 localCls 无 union 行 → `undefined === 'scalar'` 为假 → 错拒 v1 合法文本；R3：clsOf(union) = synthesize(['scalar','scalar']) = 'scalar' → **ok: true**。

### 5.2 Cls 解析器（迭代 Tarjan SCC 分解 + SCC 完成即求值；SA3 禁止递归实现）【R4 全节重写 · SA2 M2：环上名 SCC 值规范化（选案①）；R3 · SA2 N1 表覆盖语义继承；R2 · SA2 #1/#2/#4 缺陷历史存档】

R3 终版算法（单名 worklist + 灰集）经 SA2 R2 轮逐帧推演确认修复了灰集簿记与输入域，但 R3 轮 **M2** 指出其环上名的值指派仍依赖声明顺序：worklist 从哪个根进入环，环内谁的回边就先命中灰集——`type X = YMap<T>;` / `type T = U1;` / `type U1 = T | number;` 与其仅 2/3 行互换的语义等价版，分别报 E304@(1,10) 与 E106@(2,11)（SA2 独立模拟复现，本设计期模拟同步复现），违反规格 §4「别名解析与声明顺序无关」（该条款明文适用于 E304）并证伪 §3.3 的「与声明序无关 ✓」声称；且 R3 伪码未规定根迭代序，两个都「忠实」的实现（声明序 vs 任意序根）对同一模块给出不同行为。**R4 把求值单位从「单名」升格为「SCC（缩点 DAG 节点）」——表与表值都是引用图的函数**：

历轮攻击点 → R4/R5 承载机制对照（历轮修复**语义**全部保留，承载机制升级；末行为 R4 轮攻击点的 R5 承载）：

| 历轮攻击点（摘要） | R4 承载机制 |
|---|---|
| #1a/#1b/#1c 灰集簿记（检查次序倒置 / pop 不清灰 / 批量入栈假环——R2 以 memo 先于灰 + 五路径清灰 + 单待定入栈修复，SA2 R2 逐帧核验通过） | **结构性消灭**：R4 无灰集——环结构由第 0 步 SCC 分解一次性给出，不存在「运行中判环」的簿记；R2 的三条不变量（memo 优先 / 灰 ≡ 栈内 / 栈为 DFS 路径）不再需要，假环类缺陷无载体 |
| #2 / N1 未声明名输入域（三路即兴事故：TypeError→假 E100 / 不 memo→无限循环 / 草率 memo）＋表覆盖一切被引用名 | `comp(R)` 的已声明检查（未声明 → 'unknown' 分量/终值）+ 第 2 步显式入表——R2 帧级守卫 ② 与 R3 根集扩展的语义原样继承；generic-diag 仍经 localCls → 'unknown' |
| #4 E302 多体取体 | 前置归一不变：扁平虚拟联合 + synthesize 结合律（§8-10） |
| N1/N2 查询侧界面（裸 `cls[...]` / 直调 localCls） | 不变：一切查询位仍只经 §5.1 clsOf |
| **#7【R4 · SA2 M2】环上名值指派依赖声明顺序** | 如上：SCC 均匀合成指派（选案①，论证与否决案②理由登记 §8-18） |
| **R4-1【R5 · SA2 R4-1】环 SCC 分量池「任意深度」无分解定义**（容器介导环三读法分歧，P1/P3） | **顶层分解钉死**（选案 (a)，与非环分支同一 notions）：分量池 = 顶层分量，容器叶内部嵌套 ref 仅作图边不入池、容器叶自身经 localCls 原子入池（§5.2 伪码 + §8-19；T-R4-1/T-R4-2 锁定，历轮环拓扑回归零变化——其介导 ref 均在顶层，(a) 即 R4 原意的钉死） |

```text
computeCls(declared: Map<名, 体列表>) → Map<名, Cls>    # O(名数 + 引用边数 + 体节点数)；全程迭代；
                                                       # ★ R4 不变量：表与表值 = 引用图的函数（起点序/声明序任意）
  前置归一（不变）：|体列表| > 1 的名 → 扁平虚拟联合 union(各体)（某体本身是联合则其成员直接拼入；
        synthesize 是多重集折叠（结合律成立），扁平化与分层合成等价）
  图 G：节点 = 已声明名；边 N → R = 归一体[N] 任意深度的 ref（R 已声明；未声明 ref 不入图，
        分量求值时经 comp 直取 'unknown'）。【R5 · SA2 R4-1】容器叶内部嵌套 ref 的职责止于图边
        （环归属与缩点依据）——不入分量池（分量池 = 顶层分量，见环分支求值）
  ── 第 0+1 步：迭代 Tarjan SCC 分解，SCC 弹出即求值 ──
  Tarjan（显式帧栈：帧 = { name, 出边游标, low, onStack }；SA3 禁递归——#5 §15.3 同款纪律）:
    对每个已声明名（起点序任意——值与起点序无关，见 R4 不变量）未被访问者做迭代 DFS；
    Tarjan 标准性质：SCC 的弹出序 = 缩点 DAG 的依赖在前序——S 弹出时，S 引用的一切其他 SCC
    均已弹出并求值 ✓（这是「弹出即求值」合法性的唯一依据，SA3 不得改成弹出后另行排序）
    SCC S 弹出时即刻求值:
      S 非环（|S| = 1 且归一体不含指向自身的 ref）:
        body = 归一体[N]（N = S 单名）
        body = ref R    → memo[N] = comp(R)              # R 的 SCC 必已弹出（缩点序）✓
        body = union    → memo[N] = synthesize(成员分量：ref → comp(R)；叶 → localCls(叶))
        body = 叶       → memo[N] = localCls(body)        # generic-diag → 'unknown'
      S 环（|S| > 1，或 |S| = 1 且自环）:
        分量池 = ∪_{M∈S} 归一体[M] 的顶层分量            # ★ R5 · SA2 R4-1：顶层分解钉死（选案 (a)）——
              体为 ref  → 该 ref                          #   与上方非环分支的「成员分量」同一分解 notions
              体为联合 → 其顶层成员（ref / 叶）           #  （环与非环的 Cls 语义仅在「切除环内 ref」一点上不同）
              体为叶   → 该叶
        （容器叶内部的嵌套 ref 仅作图边——环归属与缩点依据——不入分量池）
        每分量：ref R → R ∈ S ? 'cycle' 分量 : comp(R)    # ★ 顶层环内 ref 一致记 cycle 分量（S 外 SCC 已求值 ✓）
                 叶节点 → localCls(叶)                    # 容器叶按 localCls 原子归类（内部联合/ref 不参与）
        v = synthesize(分量池)（eff 移除 'cycle' 分量）
        ∀M ∈ S: memo[M] = v                              # ★ SCC 均匀指派——图函数，两序同值
  comp(R) = R ∈ declared ? (memo[R] ?? 'unknown') : 'unknown'   # 未声明 → 'unknown'（#2 语义继承）；
                                                                # ?? 为防御性带保险（表见第 2 步后完备）
  ── 第 2 步：未声明名显式入表（N1「表覆盖一切被引用名」承诺的 R4 等价兑现）──
  对 walk 收集的每个 ref 出现名 R ∉ declared: memo[R] = 'unknown'

synthesize(成员 cls 列表):           # 不变
  任一 'unknown' → 'unknown'        # ★ 主导传播（#2）：含未声明/未定形成员 → 整体无定义，不下裁决
  eff = 去除 'cycle'；eff 空 → 'cycle'
  任一 'mixed' → 'mixed'；全 'scalar' → 'scalar'；全 'map' → 'map'；
  全 ∈ {map, container} → 'container'；否则（scalar 与 container/map 并存）→ 'mixed'

localCls(node):                     # 不变（generic-diag 显式入表）
  primitive / literal / pattern → 'scalar'
  object / record → 'map'；array → 'container'
  marker: YMap → 'map'；YArray / YXmlFragment → 'container'；YLeaf / YPlainArray → 'scalar'
  generic-diag → 'unknown'          # ★ 该节点必产自己的语义相位终判候选（E100@'<' / E301@名）
```

**【R5 · SA2 R4-1】分量池的分解口径 = 顶层分解（选案 (a)，钉死）**：R4 伪码的「（ref / 叶，任意深度）」对**容器介导环**（声明体为内联 ObjectType / 数组等容器叶、环介导 ref 藏于其字段位 / 元素位联合内）无分解定义，三种可辩读法观测面分歧——设计期三读法并列模拟（§13 R5 电池，37 断言全过）：**(a) 顶层分量**（如上伪码）；**(b) 任意深度全收集**（容器叶自身与其内部叶双重计入）；**(c) 任意深度 ref + 顶层叶**。**P1** `type T = YMap<A>; type A = { x: A | number };`：(a) 池 = {localCls(内联 ObjectType)='map'} → cls(A)='map' → E304 不裁决 → 报 **E106@A@(2,15)**；(b) 池 = {'cycle','map','scalar'} → 'mixed' → **E304@YMap@(1,10)** 以 (1,10) 胜出；(c) 池 = {'cycle','map'} → 'map' → 同 (a)。**P3**（A 体联合第二成员改 ref D，另加 `type D = number;`）：(a) 报 **E106@A@(2,15)**；(b)/(c) 'mixed' → 报 **E304@(1,10)**。否证：(b) 对**内联 ObjectType 实参**报「非对象形」，与规格 §3 约束表「对象形：内联 ObjectType，或解析到 ObjectType / 对象形联合的别名」直接冲突（错误身份错报），且与非环分支自相矛盾——非环 `type C = { x: string | number };` 经 localCls 三读法同值恒 'map'（模拟证实），同一形状加深一条自引用即在 (b) 下翻 'mixed'；(c) 在 P1（同 (a)）与 P3（同 (b)）间摇摆，非自洽。故钉死 **(a)**：环与非环的「成员分量」**同一分解 notions**，环与非环的 Cls 语义**仅在「切除环内 ref」一点上不同**（非环分支：体为叶 → localCls 原子值，内部联合 / ref 不参与；环分支：同一分解，仅顶层环内 ref 改记 'cycle' 分量后 eff 移除）。观测面写死入 §8-19；红灯 T-R4-1 / T-R4-2（分辨位 = YMap 查询）+ T-R4-3（规格规范示例回归）+ T-R4-4（判读辅助）。

**R4 不变量（取代 R2/R3 的灰集不变量；SA3 开发期自检建议见 §9-10；R5 补注：分量 = 顶层分量，分解定义见上段）**：每个 SCC 的值只依赖 (a) 其成员归一体的顶层分量、(b) 各分量属于 S 内/S 外、(c) 已弹出的其他 SCC 的值——三者都是引用图的性质，不含任何遍历序分量；非环名的值经缩点序递归，同理由归纳无序依赖。推论一：**任意声明排列（行互换）产出逐名相同的 cls 表**（设计期全排列自检：3 名环模块 6/6、4 名双环模块 24/24 排列一致，§13）。推论二：R3 版「灰命中 ⟺ 真环回边」的不变量不再需要——环归属由 SCC 分解静态给出，无假环载体（M2 反例中 T=U1='scalar' 两序同值，E304 均可裁决）。

**终止性与复杂度**：Tarjan 显式栈每名/每边至多访问一次，O(名数 + 引用边数)；每个 SCC 弹出时求值 O(其分量总数)，总量 ≤ O(体节点数)。全程无递归、无灰集、无重入——**不抛错且必终止**（#2 的挂起/崩溃路径仍在输入域层面消灭——未声明名经 comp 直取 'unknown'，不存在「取 undefined 体」的路径；设计路径不依赖 #5 §15.4 顶层兜底的承诺维持）。

**与 §5.4 的共享与口径差异（防 SA3 混同）**：第 0 步的环 SCC 成员并集 ≡ §5.4 第一步 1a 的 on-cycle 集（同为「非平凡 SCC 成员 ∪ 自环名」这一图性质）——实现可共用同一遍 Tarjan；§5.4 1a 的帧段标记法与 Tarjan 求出的环 SCC 恒等，两节伪码各自独立成立。**两表对环的口径差异是折叠语义差异的忠实反映，非不一致**：cls 对环上名取切环合成值——synthesize 是交换、结合的分量折叠，对「同一 SCC 的全部内边一致切除」良定义（切法唯一 ⟹ 值唯一）；strForm 对环触达名整块 ⊥——其 fold（任一 false → false，否则任一 ⊥ → ⊥）不满足该性质，穿环值依查询入口路径而变（§5.4 `type Q = A | string; type A = Q | number;` 例证）。各自是其折叠语义下唯一良定义的规范化（登记 §8-18）。

**不裁决的类别永不导致静默 ok:true**（历轮共同闭环证明的 R4 版；【R4 · SA2 M3 措辞修订】——R3 版把多体名列入 'unknown' 蕴含链是与前置归一条款冲突的机制性误述，本版改述，结论不变）：

- `'unknown'` ⟸ 解析触及未声明名（其每个 ref 出现已产 E301 候选）｜generic-diag 节点（必产终判候选）——含二者为分量的名经 synthesize 主导传播同为 'unknown'；
- **多体名**：其 Cls 为前置归一虚拟联合的**合成值（确定值）**——是否 'unknown' 取决于分量（`type B = string; type B = number;` → 'scalar'；分量含未声明名/generic-diag 才经主导传播得 'unknown'）；其安全性**不依赖取值**——多体名 ⟹ E302 候选在场 ⟹ 模块必 ok:false，形状检查对其裁决与否都只在必败模块内参与 min-position 竞争；
- `'cycle'` ⟸ 环 SCC 的切环合成 eff 为空（纯环，如 `type Z = W; type W = Z;`、自环 `type A = A;`）或经 ref 链传播自 'cycle' 名 ⟹ 引用图存在环 ⟹ E106 候选在场；**含确定分量的环 SCC 取均匀合成值、正常参与裁决**——但环的存在已保证 E106 候选在场（模块必 ok:false），其裁决产物同样只在必败模块内竞争（设计期模拟：多环交叉模块 E304 入池、报告位由 min-position 文本位决定）。

'unknown' / 'cycle' 两类标签（及多体名、环上名的任何值）只在**必然 ok:false** 的模块中出现——跳过或下裁决都不产生「非法文本被接受」的静默路径。语义上这不是降级：未声明名/generic-diag/多体不是「网络断开」式的异常路径，而是**已注册错误通道（E301/终判/E302）的伴随输入**——形状层对它们不下裁决是把错误身份归还给正确的通道，不是吞错。

**设计期实测依据**（【R2 · SA2 #7】口径修订：一次性定性证据，口径可按伪码逐行重建，运行面由 SA7 兑现）：R2 期对当版算法的同构 Node 模拟（17 拓扑 + 20k 三型深链 16.6~37.3ms + 递归对照爆栈）与 R3 期合并电池（36 拓扑：SA6 11 锚 + T-m~T-y 回归 + T-R2-1~5 + 未声明/gdiag/多体/环触达角落；20k 链 cls 20,003 步 / strCls 40,004 步线性）为历史存档——其**拓扑回归期望全部由 R4 电池重新覆盖**。**R4 期（2026-08-19）同构重跑**（按本节 R4 伪码 + §5.6 R4 桶级扫描逐行实现的合并电池，50 断言全过）：M1——T-R3-1a/1b `ok:true`、T-R3-1c E309@M@(1,10)、T-R3-1d E309@number@(1,26)，并复现 R3 现状（T-R3-1a 在 R3 六值比较下被错拒 E309@`string`@(1,26)；T-R3-1c 在 T 位不触发、仅体内兜底 (2,26)）；M2——T-R3-2 模块 A/B 同报 E304@(1,10)（候选池各含 E106@(3,11)/(2,11)），T=U1='scalar' 两序同值，并复现 R3 现状（A 报 E304@(1,10)、B 报 E106@(2,11)）；纯环/自环 'cycle'、环名联合分量 eff（`Y3 = Z | number` → 'scalar'）、多环交叉（SCC{X,X2}='scalar'，SCC{Q,R} 经 comp(X)='scalar'，E304 入池）、环+未声明（'unknown' 主导、E301 在池）；**声明序全排列自检**：M2 模块 3!=6/6、双环模块 4!=24/24 排列 cls 表逐名一致；回归——T-m/T-x/T-n/T-y/T-t/T-u/T-z/T-R2-1~3b/T-q/T-r/T-d/SA6 用例 1/4/9 与 T-v 全过（strForm/E307 侧零变化）；规模——20k 裸引用链 `ok:true`（cls 40,003 步 / ~330ms 线性，无 RangeError）、k=40 E302 双体链正常返回（cls 83 步 / strForm 124 步 / ~4ms）。**R5 期（同日）增量电池（容器介导环——R4 电池盲区补齐，SA2 R4-1 点名 P1/P3/P5；三读法并列实现 + #5 同款灰 DFS E106 回边 + 全候选池 minBy 判定器，37 断言全过）**：P1——(a) **E106@A@(2,15)**（cls(A)='map'）/ (b) E304@YMap@(1,10)（cls(A)='mixed'）/ (c) E106@(2,15)（'map'）；P3——(a) **E106@A@(2,15)** / (b)/(c) E304@(1,10)（'mixed'）；P5（取 R4 轮红线表判读辅助位 T-R4-4 的输入 `type T = YLeaf<A>; type A = { x: A | number };`）——三读法同值 **E304@YLeaf@(1,10)**（cls(A)='map'/'mixed'/'map' 均 ≠ 'scalar'）；规格 §4 规范自引用示例 `type A = { x: A };` / `type A = { x: A[] };`——三读法同值 E106@A@(1,15)（T-R4-3 回归，#5 绿锁族兼容）；P4 多体变体（`type A = { x: A | number }; type A = { y: string };`——前置归一虚拟联合 {object,object} → 'map'，E106 行为不变）；非环对照 `type C = { x: string | number }; type T = YMap<C>;` → `ok: true` 且三读法同值 cls(C)='map'（(b) 下同形状加一条深层自引用即翻 'mixed' 的自相矛盾实证）；回归——T-R3-2 A/B 同报 E304@(1,10)、T-m E304@(5,10)、T-x E304@(4,10)、T-y E106@(2,11)（(a) 下与 R4 登记值逐项一致——既有环拓扑的介导 ref 均在顶层，顶层分解 = R4 原意的钉死，零行为面变化）；P1 声明序排列 2!/2 cls 表逐名一致。

### 5.3 E304：标记实参形状（锚 = 标记记号；沿别名链判定）【R3 · SA2 N1/N2；R2 #2/#3 语义继承】

对 AST 中**每个** marker 节点（模块级 walk 收集，与上下文无关——角落登记 §8-6）：

| 标记 | 检查（一律经 §5.1 clsOf） | 违反 |
|---|---|---|
| `YMap` / `YXmlFragment` | `clsOf(arg) === 'map'` | E304@`marker.pos` |
| `YLeaf` | `clsOf(arg) === 'scalar'` | E304@`marker.pos` |
| `YArray` / `YPlainArray` | 无形状约束（任意 TypeExpr） | — |

`clsOf(arg)` ∈ **{'cycle', 'unknown'}** → **不下裁决**（错误身份归还 E301 / E106 / 终判通道，闭环证明见 §5.2/§5.4）。R2 的两处查询侧缺口（SA2 N1/N2）由 R3 从机制上消灭：

- **未声明 ref**（N1）：`type A = YMap<Foo>;` → clsOf(ref Foo) = 'unknown'（§5.2 第 2 步入表保证 Foo 必在表、值为 'unknown'【R4 承载，R3 为根集扩展】）→ 不裁决 → **E301@Foo@(1,15) 胜出**——非 E304@YMap@(1,10)（§11.3 T-R2-1；变体 `YXmlFragment<Foo>` → E301@(1,23)）。R2 的 prose（§11 T-o）与伪码矛盾（伪码下 T-o 不成立）已消除——**机制现在实现 prose**；
- **直接联合实参**（N2）：`type A = YLeaf<string | number>;` → clsOf(union) = synthesize = 'scalar' → **ok: true**（规格 §3 YLeaf 行「其联合」明文允许，T-R2-2）；`type A = YMap<{ x: string } | { y: number }>;` → 'map' → **ok: true**（§8-16 从宽登记，T-R2-3）；`type A = YMap<{ x: string } | number>;` → 'mixed' ≠ 'map' → **E304@(1,10)**（T-R2-3b——从宽的边界：混合联合不在宽侧）；
- arg 为 **generic-diag**（`type A = YMap<Foo<1>>;` / `type A = YPlainArray<Foo<1>>;`）→ 终判 E301@Foo——**非 E304/E307**（§11 T-r/T-s；§8-14）；
- 上述各 ok:false 已由 E301/终判候选保证——与 §5.4 strForm、§5.5 pvCheck 对未声明名的处理**同文档同标准**（统一登记 §8-13/§8-14）。

别名链由 cls 表天然穿透：`type B = { x: number }; type A = YLeaf<B>;` → `clsOf(ref B)='map' ≠ 'scalar'` → E304@`YLeaf`@(2,10) ✓（SA6 用例）。

### 5.4 E306：Record 键 string 形（锚 = 键类型起点）【R3 全节重写 · SA2 N3；R2 #2/#3/#4 的三值语义继承】

对每个 record 节点：`strFormOf(key)` 为 false → 候选 E306@`nodePos(key)`。三值语义（true / false / ⊥ 不下裁决）继承 R2；**机制 R3 全部重写**——R2 的「各体分别续跑本查询」读法在多体链上是**每级 ×2 的递归展开**（设计期同构复现：k 级 E302 双体链 k=8/10/12/14/16 → 767/3071/12287/49151/196607 步 = 3·2^k−1，严格 ×2/级；k=40 外推 3·2^40 ≈ 3.3e12 子查询 → `parseVfsl` 永不返回，违反 #5 §14「不抛错且必终止」契约，且顶层 catch 无法转化挂起）。R3 = **两步预计算 + O(1) 查询助手**：

```text
—— 查询侧（对每个 record 节点的 key；禁绕过助手直查表）——
strFormOf(node):
  ref R    → R 已声明 ? strCls[R] : ⊥                # 未声明 → ⊥（§8-13：E301 通道独占）
  primitive 'string' → true；pattern → true          # string 形 = 二者（§8-4）
  generic-diag → ⊥                                   # §8-14：终判通道独占
  其余（number/unknown/字面量/对象/数组/record/marker/联合）→ false   # §8-4：联合与字面量非 string 形

—— 预计算侧：strCls: Map<名, true/false/⊥>（模块级两步；全程迭代，SA3 禁递归）——
第一步 cycNames（环触达名集 = 引用闭包含环的名字集）:
  1a on-cycle 检测：对声明名做迭代灰 DFS（帧循环与 #5 E106 的 semantic.ts:106-131 同构）；
     回边（目标为灰祖先）→ 该祖先到栈顶的帧段全员标记 on-cycle（帧段即一条真实环路径）
  1b 反向传播（与 §5.5 containsSync 同款 worklist）：种子 = on-cycle；
     边 = 参照边取反（被引用名 → 引用名；参照边取全部体并集，§8-10）
     → cycNames = on-cycle ∪ 传递引用者
第二步 名字级 memo 迭代求值:
  strCls[N] = ⊥（∀N ∈ cycNames —— 预填，不裁决【§8-10 R3】；这些名永不进入求值域）
  对每个已声明名 N ∉ cycNames（声明序；strCls 已含则跳过）:
    帧栈 ← [帧(N)]；帧 = { name, 体队列（全部体——多体名亦然）, 已收值[] }
    while 帧栈非空:
      f = 栈顶
      f.体队列非空:
        b = 出队
        b 为 terminal → f.已收值.push(strFormOf(b))   # 复用查询助手终端表（此时 b 恒非 ref）
        b 为 ref R → R 未声明 → 收 ⊥
                      strCls 已含 R → 收 strCls[R]     # cycNames 已预填 ⊥ → 环触达引用在此即收 ⊥
                      否则 → push 帧(R)                # 引理（下）保证 R ∉ cycNames 且 R 不在帧栈上
      否则 → strCls[f.name] = fold(f.已收值)；pop     # ★ memo-on-completion：值收齐才写
  fold(vs) = 任一 false → false；否则任一 ⊥ → ⊥；否则 true    # §8-10 无环名折叠（R2 语义原文保留）
```

**引理（帧无环 ⟹ 终止性与线性）**：N ∉ cycNames ⟹ N 的任一体引用 R ∉ cycNames（否则 R 的引用闭包 ⊆ N 的闭包含环 ⟹ N ∈ cycNames，矛盾）。推论：第二步的隐式依赖图为 DAG——帧只压「未 memo 且非 cycNames」的名，每名至多成帧一次、恰在全部体值收齐时 memo；总步数 O(名数 + 体引用边数)。20k 裸引用链实测 40,004 步 / 237ms 线性；k=40 双体链 124 步 / 1.6ms（§13）。

**为什么环触达名必须整块预填 ⊥（对 SA2「环上名字不 memo」的正面回应）**：穿环名的 strForm 值**依查询入口路径而变**——例 `type Q = A | string; type A = Q | number;`：以 Q 为根的链式查询得 **false**（number 分量折叠压过 ⊥ 分量），而 Q 作为自身求值栈内的祖先回边时贡献 **⊥**。名字级 memo 无法对这类名给出唯一真值——这正是 R2 伪码被迫「逐体续跑」递归展开、进而指数爆步的根因。R3 把「环触达」（环上名 + 其传递引用者）从求值域整块切除：求值域退化为纯 DAG，memo-on-completion 良定义且无需灰集。**观测面不变量**：环触达 ⟹ 模块必含 E106 候选（环 ⟹ 回边 ⟹ E106）⟹ ok:false 不变；不裁决只影响环内报告码选择——与 §8-9 既有登记口径一致。R2「灰命中仅为 ⊥ 分量、可被 false 折叠压过」的读法在穿环拓扑下会产出 E306 候选，偏离 §8-9 的不裁决口径，R3 一并修正（登记 §8-10；§11.3 T-z 锁定：E106@(3,10) 胜出，非 E306@(1,17)）。

**不裁决（⊥）的闭环证明（与 §5.2 同款）**：⊥ ⟸ 未声明名（每个 ref 出现已产 E301 候选）｜generic-diag 终端（必产终判候选）｜环触达（E106 候选在场）——三类只在必然 ok:false 的模块出现，跳过裁决无静默 ok:true 路径。

锚点核对（R2 版全数保留，R3 机制不影响任何锚）：`type R = Record<number, string>;` → 键起点 `number`@(1,17) ✓；`type B = number; type R = Record<B, string>;` → `B`@(2,17) ✓（SA6 两用例——均为已声明键）。`Record<AssetId, …>`（AssetId → pattern）与 `Record<string & Pattern<…>, …>`（直接 pattern）均 true → `ok: true` ✓（SA6 正例）。多体键的位置竞争写死于 §8-10（T-t：E302@(2,6) 胜出；前向引用变体：E306@(1,17) 胜出——R3 模拟复验两向不变）；E302 双体深链的挂起防线为 §11.3 T-R2-4/T-R2-5。

### 5.5 E307：同步标记位于纯值上下文（含经别名间接）【R2 · SA2 #3/#5】

两步法——**闭包判定与锚点走查分离**，各自栈安全：

**第一步 `containsSync: Set<名>`（反向可达性，迭代 worklist，无环隐患）**：

```text
种子 = 体内容直接含同步标记节点（YMap/YArray/YXmlFragment，任意 AST 深度）的别名
     # 注意：嵌套 YPlainArray 不屏蔽——禁令绝对覆盖整个子树（规格 §3「子树内一切…禁止出现同步标记」）
反向边 = { 引用者 → 被引用名 }（每别名体内全部 ref，任意深度，去重；多体名取全部体并集，§8-10）
worklist 自种子沿反向边传播 → containsSync = 传递含同步标记的名字集    # O(引用边数)
```

**第二步（每个 YPlainArray 节点，走查其文本实参子树；AST 局部递归，深度 ≤ 预算）**：

```text
pvCheck(node):                                    # 不穿越 ref——穿越已由 containsSync 预计算
  marker 同步（YMap/YArray/YXmlFragment）→ 候选 E307@node.pos；return（不下降）
  marker YPlainArray / YLeaf → pvCheck(arg)        # 值语义标记在纯值上下文合法
  generic-diag → return（跳过，不下裁决）           # ★ R2（#3）：终判通道独占（E301/E100@'<'）
  ref R: R 已声明 且 R ∈ containsSync → 候选 E307@node.pos   # 锚 = 实参文本内的引用记号
        （R 未声明 → 跳过；E301 候选已在池——#2 统一口径）
  object → 逐字段类型递归；array → element；record → key 与 value；union → 逐成员（不查 E309）
  primitive / literal / pattern → 无事
```

**record 键位仍下降**（SA2 #5 选项①，登记 §8-15）：依据规格「子树内**一切**按普通 JSON 值解释……禁止出现同步标记」的绝对文义（与嵌套 YPlainArray 不屏蔽同一条款），键位引用不豁免。附支配性观察（§8-15 证明）：凡 acyclic 键位的 E307 候选，同锚处必有 E306 候选（`containsSync(K) ⟹ strForm(K)=false`）且码号 306 < 307——观察行为恒为 E306，不产生错误身份。

**锚点规则**：标记记号直接出现 → 该标记记号；经别名引入 → **实参文本子树内最外层引入含同步标记子树的引用记号**。规格 §3 原文锚定「实参中引入该别名的引用记号」——单层链（SA6 用例）二者同体；多层链（`YPlainArray<M>`, `M = S`, `S 含 YMap`）取 M（实参文本内）而非 S（别名体内），为规格文义（「实参**中**的引用记号」）的自然推广，登记 §8-5。两用例核对：`YPlainArray<YMap<{x}>` → E307@`YMap`@(1,22) ✓；`type A = YMap<…>; type B = YPlainArray<A>;` → E307@`A`@(2,22) ✓。

### 5.6 E309：同步物化上下文混合联合（锚 = 首个与首成员形状**类别**不同的成员起点记号；类别 = 规格三分类）【R2 · SA2 #2/#3/#5；R4 · SA2 M1：桶级折叠 + mixed 成员锚，登记 §8-17】

**豁免边界 = 文本位**：模块级 AST walk 携带 `inPV` 旗标——仅当进入 `YPlainArray` 的文本实参子树时置真；别名体恒按同步上下文检查（walk 不穿越 ref，别名体内 union 在其自身声明处检查）。**walk 下降集**【R2 明示】：object 逐字段 / union 逐成员 / array.element / record.key **与** value（键位联合仍查——§8-15 登记）/ marker.arg；pattern 与 generic-diag 无子节点（generic-diag 仍被 visit——终判候选靠它）。对每个 `inPV = false` 的 union 节点（成员取类**一律经 §5.1 clsOf**【R3 · SA2 N1/N2】——R2 的 memberCls 已并入统一助手：ref 行 = 表查询 + 未声明 'unknown'，union 行 = synthesize，其余 = localCls）——**类别比较按规格三分类做桶级折叠**【R4 · SA2 M1】：

```text
bucket(c) = c = 'scalar' → 标量桶 S
            c ∈ {'map','container'} → 容器桶 C          # ★ M1 折叠：map 与 container 同桶——规格 §3 三分类
                                                        #   第二行把对象/数组/Record 全部归入容器形、
                                                        #   「按命中成员的形状物化」（对象→Y.Map、数组→Y.Array），
                                                        #   容器桶内差异是物化细分（E304 域），非「形状类别」差异
            c = 'mixed' → M（恒异类，含 mixed|mixed）
            c ∈ {'cycle','unknown'} → ⊥
b0 = bucket(clsOf(成员[0]))
b0 = ⊥ → 不裁决（首成员无确定类别——R2/R3 既有口径，T-q/T-y 锁定；错误身份归还 E301/E106/终判通道）
anchor = null
自左向右 i = 0..n-1:
  bi = bucket(clsOf(成员 i))
  bi = ⊥ → continue                                   # 不确定成员透明跳过（R2 既有；不阻断后续确定成员比较）
  bi = M 且 anchor = null → anchor = i；break          # ★ mixed 成员本身即异类锚（含其为首成员——
                                                       #   mixed 不属于任何单一类别，mixed|mixed 亦触发）
  bi ≠ M 且 bi ≠ b0 且 anchor = null → anchor = i；break   # ★ 桶级比较（S vs C）——容器桶内差异不触发
anchor ≠ null → 候选 E309@nodePos(成员 anchor)         # 每联合至多一候选；锚 = 规格原文「首个与首成员
                                                       # 「形状类别」不同的成员」——类别 = 三分类（§8-17）
```

等价谓词（SA2 M1 建议原文）：**触发 ⟺ (∃标量桶 ∧ ∃容器桶) ∨ ∃mixed**。**R3 缺陷对照**（设计期模拟复现）：R3 的六值原始不等比较把容器桶内差异当作类别差异——`type T = { a: string } | string[];`（v1 合法，多态物化正例）first='map'、c='container' → 被错拒 E309@`string`@(1,26)；且与 §5.1 自相矛盾——synthesize 早已把 map+container 合成 'container'（非 'mixed'），同一联合在合成侧合法归类、在扫描侧被拒。次生缺口（M1-1b）：first = c = 'mixed' 的组合联合（`type T = M | M2;`，M/M2 双 mixed 别名）在原始比较下 `c ≠ first` 为假 → T 位漏报，报告锚漂移到 M 体内 (2,26)；R4 的 mixed 恒异类锚使 T 位触发且锚定更早的 `M`@(1,10)。桶级修复**不放松**标量/容器并存（T-R3-1d E309@`number`@(1,26)，SA6 (1,31) 用例同族回归）。**E304 不受折叠影响**：YMap/YXmlFragment 的对象形判定维持 `clsOf === 'map'` 精确值（`YMap<{a} | string[]>` → synthesize 'container' ≠ 'map' → E304 正确——对象形不含数组成员，规格约束表；SA2 独立核实，R4 维持）。

**为什么豁免是文本位而非「经别名传播进 PV」（SA2 预答，规格未冻结角落的确定性选择）**：

1. 规格对 E307 的别名传播是**显式单列**的（「同步标记可经别名间接进入纯值上下文」——该段唯一目的就是扩展 PV 穿过别名，且只点名同步标记）；E309 的豁免条（「纯值上下文不适用」）无此扩展文义，「YPlainArray 子树」按文本读法。
2. **单调性**：文本位口径下，解析成败不随「添加一条无关声明」翻转。若按语义位豁免（别名体进 PV 即免查），`type M = {a} | number;` 单独存在报 E309、加了 `type P = YPlainArray<M>;` 反而变 `ok: true`——非单调；且 M 同时被字段引用时（`{x: M}` 同步物化）漏检真实的混合联合。
3. **单向收敛对齐**：从严口径若未来被证实过严（语义位读法才是本意），放松 = 把 E309 转 `ok: true`，属「未实现→实现」的单向收敛（#5 §8 已祝福的方向）；反向（先宽后严）则是已发布行为翻转，被规格 §8 禁止。从严是唯一可逆错的方向。
4. 别名体联合仍被检查的位置 = 其自身声明处（锚在别名体内成员记号上，规格锚条款的字面满足）。

**Record 键位的适用域**（【R2 · SA2 #5】选项①，全论证与胜出顺序登记 §8-15）：规格 §3 默认物化表末行「适用于字段类型、数组元素、Record 值位与标记实参」的枚举绑定的是**该行（多态物化）的适用位**，不是 E309 的豁免清单——键不物化（键空间约束，E306 域），故缺席于物化枚举；缺席 ≠ 豁免。E309 的适用域按其条文自身 =「同步物化上下文」= 纯值上下文之补。直接键位联合（`Record<{a:1} | string, V>`）仍被 walk 检查，但被 E306 支配（位置证明见 §8-15）——观察行为恒 E306；别名声明体联合（`type K = {a:1} | string; type R = Record<K, string>;`）按文本位检查，T-u 注册 E309@(1,21) 胜出 E306@(2,17)（min-position）；文本序倒置时 E306 胜出（§8-15 示例）——两向皆确定。

用例核对（R4 桶级口径；锚点全部脚本核算）：`type T = { x: { a: string } | number };` → 字段位联合，`{…}`=容器桶、`number`=标量桶 → 首个异类 `number`@(1,31) → E309@(1,31) ✓。fixture `AssetEntity` 三成员全 map → 无 E309 ✓；`YArray<string | number>` 实参联合全标量桶 → 无 E309 ✓。`type T = Foo | number;`（Foo 未声明）→ b0 = ⊥ → 不裁决 → E301@Foo（§11 T-q，非 E309）✓。**【R4 · SA2 M1】桶级新用例**：`type T = { a: string } | string[];` → 容器桶+容器桶 → 无异类 → **ok: true**（T-R3-1a）；经别名介导 `E | A`（E=对象形、A=数组）→ clsOf 'map'/'container' 同桶 → **ok: true**（T-R3-1b）；`type T = M | M2;`（双 mixed 别名）→ 首成员 M 即 mixed 锚 → **E309@M@(1,10)**（T-R3-1c）；`type T = { a: string } | number;` → 标量/容器并存 → **E309@number@(1,26)**（T-R3-1d）。

### 5.7 候选聚合（#5 §6.2 机制不变，新码入池）

```
candidates = E301×n + E302×n + E106×n + E308×n + generic-diag 终判×n
           + E304×n + E306×n + E307×n + E309×n          # ★ 新增四源
issue = minBy(candidates, (line, column, 错误码数值))      # 位置并列按码号升序（#5 既有确定性兜底）
```

相位优先于位置（语法相位任一错误先于一切语义相位错误）由既有 throw 通道保证，不变。**E307 不下降进同步标记实参**、**E309 每联合至多一候选**：被跳过节点的文本位置必然晚于已产出候选的锚（containment 关系），min-position 语义不受影响。§5.2/§5.3/§5.4/§5.6 的「不裁决」跳过不改变 candidates 的非空性（跳过只发生在必含其他候选的模块，§5.2 闭环证明；§5.4 的 ⊥ 三源——未声明 / generic-diag / 环触达——分别由 E301 / 终判 / E106 候选兜底，§5.4 闭环证明）。

---

## §6 IR 扩展（`VfslType` 追加 4 成员，纯加法）

```ts
export type VfslType =
  | { kind: 'primitive'; name: … }            // #5 既有
  | { kind: 'literal'; value: string | number }
  | { kind: 'ref'; name: string }
  | { kind: 'object'; fields: VfslField[] }
  | { kind: 'union'; members: VfslType[] }
  | { kind: 'array'; element: VfslType }                              // ★ T[]
  | { kind: 'record'; key: VfslType; value: VfslType }                // ★ Record<K,V>（键约束原样入 IR）
  | { kind: 'marker'; marker: 'YMap'|'YArray'|'YPlainArray'|'YLeaf'|'YXmlFragment'; arg: VfslType }  // ★ 标记及其包裹目标
  | { kind: 'pattern'; regex: string };                               // ★ 解码后正则原文
```

设计理由（逐条对 SA6 断言策略 §7.3）：

1. **别名不内联（ref 保留）**：`Record<AssetId, n>` 的键 IR = `{kind:'ref', name:'AssetId'}` ≠ `Record<string, n>` 的 `{kind:'primitive'}`——可区分性锚（AC2）由结构直接满足；同时 IR 深度有界（`type A20000 = A19999;` 每别名 IR 深 ≈3）、内容哈希对别名拓扑稳定。
2. **标记包裹不折叠**：`YMap<{x:string}>` = marker(object(…)) ≠ object(…)——AC1 可区分性锚。
3. **正则以解码后原文进 IR**：`pattern.regex` = tokenizer 解码文本（`\\\\`→`\\`）；fixture 的 `^[A-Za-z0-9_\\-]{1,64}$`（双写）→ IR 中 `^[A-Za-z0-9_\-]{1,64}$`（单反斜杠），JSON 往返对反斜杠稳定（`\\` 转义对称）——SA6 `jsonContainsString` 两用例满足。
4. **可序列化 / 确定性**：新成员均为纯数据（string 判别 + string/子节点载荷），无 pos、无 Map/Set/undefined；IR 不携行列（#5 §7.3 口径延续——marker/record/pattern 同样不进位置）。
5. **JSON 天然区分**：`pattern` 与 `primitive string`、`marker` 与其 `arg`、`record` 的 key/value 各自成对——SA6 全部 `expectDistinct` 对（9 组）逐一满足（§10.2 核对表）。

---

## §7 错误码实现范围清单

### 本切片实现（18 / 19）

| 码 | 实现位 | SA6 红灯 | 备注 |
|---|---|---|---|
| E100~E105、E201~E203、E301~E303、E106、E308 | #5 既有（parser/tokenizer/semantic） | ✅ 37 条既有全绿保持 | 行为零变化（§1.2 表；generic-diag+`[]` 锚点迁移族除外，已登记） |
| **E304** | shapes.ts §5.3（clsOf(arg) ≠ map / ≠ scalar） | ✅ 4 用例 | 锚标记记号；cycle/**unknown** 不裁决；**R3：查询一律经 clsOf（含 union 行，§5.1）** |
| **E306** | shapes.ts §5.4（strFormOf(key) 假） | ✅ 2 用例 | 键类型起点；**R3：两步法预计算（cycNames + 名字级 memo 三值表）+ O(1) 查询助手 strFormOf**（⊥ 不裁决） |
| **E307** | shapes.ts §5.5（containsSync + pvCheck） | ✅ 2 用例 | 直接锚标记记号；经别名锚实参内引用记号；pvCheck 跳过 generic-diag |
| **E309** | shapes.ts §5.6（文本位非 PV 联合的**桶级**异类扫描，成员经 clsOf，六值→规格三分类折叠【R4 · M1】） | ✅ 1 用例 | 首个异类成员起点（桶级——容器桶内差异不触发；mixed 成员本身即锚）；cycle/unknown 成员跳过 |

### 明确延后（1 个）

| 码 | 依赖构造 | 延后理由 |
|---|---|---|
| E305 | `/** */` 挂载机制 | 文档注释本切片仍按忽略型 trivia（#5 §8 既有）；捕获、挂载与悬空判定随 JSDoc issue 一并交付。fixture 的 7 条文档注释全部可挂载，即使 E305 在也无一触发——延后无观测面损失 |

---

## §8 未冻结角落的确定性选择登记表（集中；§4.3 孤立 `\r` 先例同款纪律）【R2：行 9/10 修订，行 13~15 新增；R3：行 9/10/13/14 措辞与机制化修订，行 16 新增；R4：行 9 措辞修订，行 17/18 新增；R5：行 18 分解口径修订，行 19 新增】

| # | 角落 | 选择 | 理由 / 风险方向 |
|---|---|---|---|
| 1 | 「对象形」的边界：`YXmlFragment<…>` / `T[]` / `YArray<…>` 作 YMap/YXmlFragment 实参 | **非对象形 → E304**（对象形 = object / record / YMap / 全 map 联合） | §3「对象形」按物化 Y.Map（封闭键空间）读；XmlFragment/数组无键空间语义。从严；可单向放松。**自反侧（YMap 实参）由 §11 T-v 正例锁定**【R2 · SA2 #6】 |
| 2 | 「标量形」的边界：`YLeaf<YLeaf<…>>` / `YLeaf<YPlainArray<…>>` | **合法**（scalar-form 含 YLeaf / YPlainArray 标记，§3「标记成员的形状归类」标量侧） | 与 §3 三分类对标记闭合的文义一致 |
| 3 | YPlainArray 的 Cls 恒 `scalar`（上下文无关） | 是 | 所有 cls 查询均发自同步位检查；PV 位不做分类查询，无二义 |
| 4 | E306 的 string 形：字面量（`Record<"a", V>`）与联合（`Record<string \| Pattern, V>`） | **非 string 形 → E306**（string 形 = primitive string / pattern，沿裸引用链） | 规格枚举「string / string & Pattern / 其别名」；字面量是具体值非 string 型。从严；可单向放松 |
| 5 | E307 经**多层**别名链的锚 | 实参文本子树内**最外层**引入引用记号 | 规格「实参**中**引入该别名的引用记号」的自然推广；单层链（受测形态）两读法同体 |
| 6 | E304/E306 在纯值上下文内是否豁免 | **不豁免**（节点局部无条件检查） | 规格仅给 E309 写明 PV 豁免；E304/E306 条款无条件。PV 内同步标记同时命中 E304+E307 同锚时按码号 304<307 报 E304（§5.7 既有 tiebreak），确定性无歧义 |
| 7 | E309 的 PV 豁免边界 | **文本位**（仅 YPlainArray 的文本实参子树；别名体恒查） | §5.6 四点论证（规格文义 / 单调性 / 单向收敛对齐 / 锚条款字面） |
| 8 | 新 E100 族的锚：Record/Marker 实参后期望 `,`/`>` 违反、Pattern 实参非字符串字面量、多段交叉第二 `&`、`[` 后非 `]` | **违反期望的实际记号**（`string & Pattern<1>` 锚 `1`@27；多段锚第二个 `&`@32） | #5 §5.5「违反期望的记号」口径同族；SA6 对应用例均 code-only 断言，无锚冲突 |
| 9 | 别名解析遇环时形状检查的裁决 | **Cls='cycle' / strForm 环触达 ⊥ → E304/E306/E309 不裁决；E307 依 containsSync 闭包照常**（R2 措辞修订：R1 的「containsSync 该边不传播」与 SA2 核实通过项 7 的闭包语义（种子+全反向可达 =「恰好传递含同步标记」）不一致，以闭包为准） | 环模块必被 E106 候选拒绝（ok:false 不变）——不裁决只影响环内报告码选择，不影响 ok 判定。**【R4 · SA2 M2】'cycle' 的授予范围 = 环 SCC 切环合成（环内 ref 记 'cycle' 分量）后 eff 为空者（纯环/自环）及其经 ref 链的传播值**（§5.2 R4）——R2/R3 的「回边命中灰集者」口径随灰集机制退役：该口径下环上名的值依赖入口方向（= 根迭代序 = 声明序），已被 M2 反例证伪；环 SCC 含确定分量者现取均匀合成值、正常参与裁决（仍在必含 E106 候选的模块内竞争，论证见 §8-18）。strForm 侧的「环」= 环触达名集 cycNames（§5.4 第一步：on-cycle 灰 DFS + 反向传播，与 §5.2 R4 的环 SCC 成员并集同源），预填 ⊥——R2 链式灰读法在「环 + false 分量」拓扑（如 `type Q = A \| string; type A = Q \| number;`）下会给 Q 记 false 并产出 E306 候选，偏离本行不裁决口径；R3 后该类模块只报 E106/E301 族（T-z，R4 回归验证维持） |
| 10 | E302 重复声明的多体在 cls/containsSync/E106/strForm 中的取体【R2 · SA2 #4 修订；R3 · SA2 N3 机制重写】 | **全部声明体并集**（E106 引用边 / containsSync 反向边，#5 §6.1 既有口径）；**Cls = 各体经扁平虚拟联合合成**（§5.2 前置归一，synthesize 结合律保证与分层合成等价）；**strForm 折叠规则原文保留：任一体 false → false；否则任一体 ⊥ → ⊥；否则 true**（§5.4 R3 两步法对**无环名**的名字级 memo 求值）；**环触达名（引用闭包含环）一律 ⊥ 不裁决** | 位置竞争写死：`type B = string;\ntype B = number;\ntype R = Record<B, string>;` → 候选 E302@B@(2,6) 与 E306@B@(3,17)，**E302@(2,6) 胜出**（min-position，§11 T-t；R3 模拟复验不变）；前向引用变体 `type R = Record<B, string>;\ntype B = number;\ntype B = string;` → **E306@(1,17) 胜出** E302@(3,6)——两向皆确定，无 SA3 即兴空间。多体模块必含 E302 候选 → 不裁决不产生静默 ok:true。【R3 · SA2 N3】R2 的「各体分别续跑」读法：① 每级 ×2 递归展开（k=40 → 3·2^40 步挂起，设计期复现严格 ×2/级）；② 「灰命中仅为 ⊥ 分量」的折叠读法在穿环拓扑下偏离 §8-9 不裁决口径、且使名字级 memo 不可定义（值依查询入口路径而变，§5.4 论证）——R3 两步法（环触达预填 ⊥ + DAG 上 memo-on-completion）两个问题一并消灭；环触达 ⟹ E106 候选在场 ⟹ ok:false 不变（T-z） |
| 11 | `[` 预算超限锚 | 该 `[` 记号 | #5 §15.2「预算耗尽处构造起始记号」的直接推广 |
| 12 | 未被任何位置引用的别名体内混合联合 | **仍检查**（节点位检查，与引用拓扑无关） | §5.6-2 单调性论证的直接推论；与 #5「切片内构造全语义」立场一致 |
| 13 | **未声明名在形状查询中的口径**【R2 · SA2 #2 新增；R3 · SA2 N1 措辞统一】 | **统一 'unknown' / ⊥，不下裁决；错误身份由 E301 通道独占**：computeCls 帧级守卫 ②（先于 declared 取体）+ 根集含全部 ref 出现名（表由构造完备）；查询侧统一助手 clsOf（ref → 未声明 'unknown'，`??` 为带保险）与 strFormOf（ref → ⊥）；pvCheck 未声明 ref → 跳过 | R1 内部双标（strForm 未声明 → false，其余跳过）已统一为「不裁决」。行为口径变更登记：strForm 从 false 改 ⊥——位置分离拓扑下（`type R = Record<Bar, string>; type Bar = Foo;`）R1 会以 E306@Bar 压制后文 E301@Foo，R2 起报 E301（错误归属正确）。SA6 锚定用例全部为已声明键，零影响。每个未声明 ref 必产 E301 候选 → 不裁决 ⟹ 无静默 ok:true（§5.2/§5.4 闭环证明） |
| 14 | **generic-diag 节点在 shapes.ts 的分派**【R2 · SA2 #3 新增；R3 · SA2 N1 措辞统一】 | **全查询显式入表，一律不下裁决**：localCls → 'unknown'；clsOf（含 union 行 synthesize）→ 'unknown' 主导；E304 检查跳过；strForm 终端 → ⊥；pvCheck → 跳过（不下降）；synthesize 成员扫描按 'unknown' 主导传播 | 依据：该节点**必产自己的语义相位终判候选**（#5 §5.4 不变量：generic-diag 不可能进 ok:true 分支）——错误身份由终判通道（E301@名 / E100@`<`）独占，形状层不得以更早的 E304/E307 锚压制（`YMap<Foo<1>>` → E301@Foo@(1,15) 而非 E304@YMap@(1,10)，§11 T-r/T-s） |
| 15 | **E309 / E307 对 Record 键位的适用域**【R2 · SA2 #5 新增，选项①】 | **①仍检查 + 胜出顺序登记**：(a) 直接键位联合（`Record<{a:1} \| string, V>`）被 walk 检查，但 **E306 支配**——E306 锚 = 键子树起点，E309 锚 = 首个异类成员起点 ⊂ 键子树且恒严格靠后（成员间必有 `\|` 分隔）→ min-position 恒报 E306（本例 E306@`{`@(1,17) 压制 E309@string@(1,28)）；(b) 别名声明体联合（键用别名）按文本位检查：`type K = { a: 1 } \| string;\ntype R = Record<K, string>;` → **E309@string@(1,21) 胜出** E306@K@(2,17)（§11 T-u）；文本序倒置（`type R = Record<K, string>;` 在前）→ **E306@K@(1,17) 胜出**——E306 域可达，两向确定；(c) pvCheck 仍下降 record 键（「子树内一切」绝对文义），且 acyclic 键位 E307 候选被 E306 支配：`containsSync(K) ⟹ strForm(K)=false`（strForm 为 true ⟹ 解析终点是 string/pattern ⟹ 链上无同步标记 ⟹ containsSync 假；多体时「任一体 false → false」同结论），同锚 306 < 307——观察行为恒 E306；环上键名的 E307 可浮现（闭包语义，§8-9），模块必有 E106 候选，ok 判定不变 | 规格文义论证：§3 三分类第三类自述适用域为「**同步物化上下文**」（其唯一被定义的补集是纯值上下文）；「适用于字段类型、数组元素、Record 值位与标记实参」的枚举绑定于**默认物化表第 5 行（多态物化的适用位）**——键不物化（键空间约束，E306 域）故不在物化枚举中，**缺席于物化枚举 ≠ 豁免于混合联合拒绝**。单调性：按「仅用作键则豁免」的语义位读法，`type K = …` 单独存在报 E309、加一条 `Record<K,…>` 反而变 E306——报告码随无关声明翻转，正是 §5.6-2 拒绝的病理。从严方向可单向放松（与 §8-4/§8-7 同向） |
| 16 | **查询位直接联合实参的形状归类（clsOf 的 union 行）**【R3 · SA2 N2 新增】 | **从宽：`clsOf(union) = synthesize(成员 clsOf)`——直接联合与经别名联合同一规则**：`YMap<{ x: string } \| { y: number }>` → 'map' → **ok: true**（T-R2-3）；`YLeaf<string \| number>` → 'scalar' → **ok: true**（T-R2-2，规格明文）；`YMap<{ x: string } \| number>` → 'mixed' → **E304**（T-R2-3b——混合联合仍在严侧） | 规格依据双料：①§3 约束表 YLeaf 行「标量形：原始类型 / 字面量 / **其联合** / 含 Pattern 约束」——「其联合」无别名限定；②§3「YMap」节正文「`YMap<T>` 的 T 为对象形（形状约束表）；**T 为对象形联合时**，键空间为各成员字段键集之并集（封闭）」——直接对实参 T（非仅别名）立法对象形联合的语义，约束表的「别名」措辞是到达路径描述而非限制。机制一致性：与 §5.2 ④ 别名联合、§8-10 多体虚拟联合同一 synthesize（规格自己祝福的「解析到对象形联合的别名」路径即走此规则）。单调性：从严读法（直接联合 E304、别名联合 ok:true）使同一语义内容的两语法形结论相反，且新增一条无关声明即翻转 verdict——§5.6-2 拒绝的病理。方向声明：本行**非新增放宽，而是兑现 R1/R2 既有登记**（§5.1 'map' =「全 map 形联合」、§8-1「对象形含全 map 联合」——R2 之前正是有登记无机制，N2 的根因）；若未来规格冻结从严读法，属规格级澄清 → 回总控走 spec §8 修订流程，与 §8-1「全 map 联合」行同源同担 |
| 17 | **E309 扫描谓词的类别粒度（六值 Cls → 规格三分类桶）与 mixed 成员锚**【R4 · SA2 M1 新增】 | **桶级比较**：bucket('scalar')=标量形、bucket('map')=bucket('container')=**容器形（同桶）**、'mixed' 恒为异类（含 mixed\|mixed）；'cycle'/'unknown' 不裁决口径不变（首成员不确定 → 整联合不裁决；中位不确定成员透明跳过——R2/R3 既有，T-q/T-y 锁定）。触发 ⟺ (∃标量桶 ∧ ∃容器桶) ∨ ∃mixed；锚 = 自左向右首个异类成员起点——**首个 bucket=mixed 的成员本身即异类锚（含其为首成员）**，否则首个与首成员桶不同的成员（左者胜） | 规格文义：§3 三分类第二行明文「全部容器形（对象/数组/Record）→ **按命中成员的形状物化**……对象成员 → Y.Map、**数组成员 → Y.Array**」——对象+数组混合联合是多态物化**正例**，E309 的条件是「标量形与容器形并存」；'map'/'container' 是容器形内部的物化细分（服务于 E304 的 YMap 键空间判定），不构成 E309 意义上的「形状类别」差异；**规格锚条款原文即「首个与首成员形状「类别」不同的成员」——类别 = 三分类，伪码必须显式完成六值→三桶折叠**（SA2 M1 注记）。机制一致性：§5.1 synthesize 已把 map+container 合成 'container'（非 'mixed'）——R3 的六值原始比较使同一联合在合成侧合法、扫描侧被拒（自相矛盾，M1 反例 `type T = { a: string } \| string[];` 被错拒 E309@`string`@(1,26)）。mixed 锚规则：mixed 成员不属于任何单一类别（其自身即「标量形与容器形并存」在该联合中的出现位），与任何成员（含另一 mixed）比较均为异类——首个 mixed 成员即锚（T-R3-1c 锚 @`M`@(1,10)；若其之前已有桶级 S/C 异类则以更左者为准）。界分：E304/E306 查询**不做**桶折叠（YMap/YXmlFragment 维持 `clsOf==='map'` 精确值——`YMap<{a}\|string[]>` → 'container' ≠ 'map' → E304 正确保留，规格对象形不含数组成员；SA2 独立核实）。单调性/方向：桶级修复是纠正「扫描比规格更严」的错拒，非放宽拒绝域——标量/容器并存（T-R3-1d）与混合联合（T-R2-3b）仍在严侧 |
| 18 | **环上名（环 SCC 成员）的 Cls 值指派**【R4 · SA2 M2 新增，选案①】 | **SCC 均匀合成**：环 SCC S 的全成员取同一值 v = synthesize(∪_{M∈S} 归一体[M] 的**顶层分量**【R5 · SA2 R4-1：分解定义与观测面写死见 §8-19】；S 内 ref → 'cycle' 分量；S 外 ref → comp(R)（缩点弹出序下必已求值）；未声明 ref → 'unknown' 分量)，eff 移除 'cycle' 分量；纯环（eff 空）→ 'cycle'。**表值 = 引用图的函数：与声明序/起点序/入口方向无关**（§5.2 R4 不变量 + 全排列自检）；求值依赖序 = Tarjan 弹出序（缩点 DAG 依赖在前），多环模块各 SCC 独立指派、跨 SCC 引用经 comp 取已求值 | 选案论证（① vs ②）：**(a) 图函数性**——v 只依赖 SCC 结构与缩点序，无遍历序分量：M2 反例 A/B 两序均 T=U1='scalar'、均报 E304@(1,10)（T-R3-2，设计期模拟与 SA2 独立模拟同结论）。**(b) 语义延续**——兑现 R2 已登记并经 SA2 R2 逐帧核验的 eff 语义（「环经联合：含非环成员者 eff 后有定义」），把 R3 逐遍历的 eff 移除升级为对整个 SCC 一致切除，消除入口方向偏置。**(c) 否决案②（环上名整块 'cycle'）的三点理由**：②丢弃 eff 信息——含确定分量的环名（U1 = T\|number）由「eff 后有定义」退化为 'cycle'，与 (b) 冲突且减少有价值的裁决；②下 T-R3-2 的 A/B 虽同码（E106）但锚随回边文本位漂移（(3,11) vs (2,11)——E106 锚 = 回边引用记号，且 E106 **不在**规格 §4 声明序无关条款的明文枚举（E301/E304/E306/E307/E309）内），①下 A/B 报告**码与位置全同**（胜出者 E304 锚定两模块共有的第 1 行）——SA2 红线字面要求「完全相同的错误码与位置」仅①满足；②的实现增益（免 Tarjan）不抵语义损失。**(d) 与 strForm 环口径的差异是机制差异的忠实反映**：synthesize 是交换、结合的分量折叠，对「同 SCC 全部内边一致切除」良定义（切法唯一 ⟹ 值唯一）→ 取切环合成值；strForm 的 fold 不满足（穿环值依入口路径而变，§5.4 Q/A 例证）→ 环触达整块 ⊥——各自是其折叠语义下唯一良定义的规范化。**(e) 不裁决闭环**：'cycle'（纯环）⟹ E106 候选在场；含确定分量环名的裁决发生在必含 E106 候选的模块——任何裁决产物只在必败模块内竞争，无静默 ok:true（§5.2 闭环证明）。**min-position 注记**：值规范化保证「码的可裁决性与表值」序无关，报告胜出仍按文本位竞争——胜出候选所在行随文本移动（多环交叉模块中回边早于标记位时 E106 胜出，E304 在池，设计期模拟）——这是位置语义的固有属性，非解析序敏感。风险方向：若未来规格冻结对环名的另一种物化读法，回总控走 spec §8 修订 |
| 19 | **环 SCC 分量池的分解口径（顶层分解）**【R5 · SA2 R4-1 新增】 | **顶层分量，与 §5.2 非环分支的「成员分量」同一分解 notions**：分量池 = ∪_{M∈S} 归一体[M] 的顶层分量——体为 ref → 该 ref；体为联合 → 其顶层成员（ref / 叶）；体为叶 → 该叶 localCls；**容器叶（object / array / record / marker）内部的嵌套 ref 仅作图边（环归属与缩点依据），不入分量池**。环与非环的 Cls 语义仅在「切除环内 ref」一点上不同：非环分支体为叶 → localCls 原子值（内部联合 / ref 不参与）；环分支同一分解，仅顶层环内 ref 改记 'cycle' 分量后 eff 移除 | 观测面写死（三读法并列模拟，§13 R5 电池 37 断言）：**P1** `type T = YMap<A>;\ntype A = { x: A \| number };` → **E106@A@(2,15)**（(a) 顶层分解：cls(A) = localCls(内联 ObjectType) = 'map' → E304 不下裁决，错误身份归还 E106 回边）；字面读法 (b)（任意深度全收集，容器叶自身与其内部叶双重计入）得 cls(A)='mixed' → E304@YMap@(1,10) 以 (1,10) 胜出——对**内联 ObjectType 实参**报「非对象形」，与规格 §3 约束表「对象形：内联 ObjectType，或解析到 ObjectType / 对象形联合的别名」直接冲突，且与非环分支自相矛盾（非环 `type C = { x: string \| number };` 三读法同值恒 'map'，同一形状加深一条自引用即在 (b) 下翻 'mixed'——模拟实证）；读法 (c)（任意深度 ref + 顶层叶）P1 下同 (a)、P3 下同 (b)——非自洽。**P3** `type T = YMap<A>;\ntype A = { x: A \| D };\ntype D = number;` → **E106@A@(2,15)**（环外嵌套 ref D 不入池：其对分量的贡献仅在 D 为某成员体的**顶层**分量时经 comp(D) 生效，D 藏于容器叶内部故只承担图边职责——缩点依赖与环归属）。规格 §4「递归与循环引用检测」的规范自引用示例（`type A = { x: A };`、含经容器包裹的 `type A = { x: A[] };`）三读法同值 E106@A@(1,15)——顶层分解的钉死不改变规格点名输入的既有行为（T-R4-3 回归锁，#5 r3-regression 绿锁族兼容）。红灯：T-R4-1 / T-R4-2（**分辨位 = YMap 查询**）+ T-R4-4（判读辅助：`type T = YLeaf<A>;` 同拓扑三读法同值 E304@YLeaf@(1,10)——该用例通过**不**证明口径正确，防 SA3 以对照位通过误判已钉死）。风险方向：若未来规格对容器介导环的形状语义另行冻结，回总控走 spec §8 修订 |

---

## §9 SA3 实现注意（TDD 与类型严格模式）

1. **修绿顺序建议**：`errors.ts`（+4 码）→ `ir.ts`（+4 成员）→ `parser.ts`（四类构造 + 预算更名；先跑 SA6 AC1/AC3 正例 12 条）→ `shapes.ts`（cls SCC 解析器【R4：Tarjan + 完成即求值】+ clsOf → E304 → strForm 两步法 + strFormOf → E306 → containsSync + pvCheck → E309【R4：桶级扫描】；跑形状反例 9 条）→ `semantic.ts`（walk 扩展 + 入池 + toIR）→ `pnpm typecheck` → `pnpm test`。**验收判读：70/70 全绿**（37 既有 + 33 新增；简报 §7.4 红灯基线 25 红 + 45 绿）。【R3/R4】SA6 若补 §11 R2/R3/R4 构想（T-m~T-y、T-R2-1~5、T-z、T-R3-1a~1d、T-R3-2），同文件同跑。
2. **TS 严格模式陷阱**（#5 §10.2 全部适用）：`noUncheckedIndexedAccess`（栈帧/成员访问显式 undefined 处理）、`exactOptionalPropertyTypes`（IR 字段一律必填）、`verbatimModuleSyntax`（`import type`）、`.js` 后缀内部导入。
3. **栈安全 + memo 纪律（硬性）**：`computeCls`【R4：迭代 Tarjan——显式帧栈（name/出边游标/low/onStack），SCC 弹出即求值，弹出序 = 缩点 DAG 依赖在前序（标准 Tarjan 性质，**不得**改成弹出后另行排序）】/ `containsSync` / `computeStrForm`（第一步 on-cycle 灰 DFS + 反向传播 worklist、第二步帧栈求值）必须**显式栈/工作队列迭代**，禁止函数递归跟链（实测依据：递归 cls 在 20k 链爆栈【#5 §15.3 同构】；R2 strForm 的多体递归在 40 级 E302 双体链上 3·2^40 步挂起——设计期复现严格 ×2/级：k=8..16 → 767/3071/12287/49151/196607 步，R3 同输入 k=40 全管线 124 步【R3 · SA2 N3】；R4 Tarjan 版同输入 cls 83 步 / 全管线 ~4ms）。**memo 纪律【R4 · SA2 M2；R5 · SA2 R4-1 补分量池实现注记】**：cls 表的环上名值 = SCC 均匀合成——**禁止**任何按遍历/声明序给环上名单独指派的实现残留（R3 worklist 灰集读法即此类，M2 病灶）；**分量池收集仅取归一体的顶层分量**（体为 ref → 该 ref；体为联合 → 顶层成员；体为叶 → 该叶）——**禁止**把容器叶（object / array / record / marker）内部的嵌套 ref 或内部叶展开进分量池：内部 ref 已在图边集内承担环归属与缩点依据，「任意深度」展开读法（R4-1 的 (b)/(c)）在容器介导环上会把对象形实参误判 'mixed' → 对内联 ObjectType 报 E304（错误身份），且与非环分支 localCls 原子语义不一致（T-R4-1 / T-R4-2 红灯拦截；T-R4-4 为判读辅助位——其通过**不**证明口径正确，分辨位是 YMap 查询）；strCls 仅在名字完成（全部体值收齐）时写入，环触达名（cycNames）**预填 ⊥、永不进入求值域**——禁止在求值中给环触达名写 memo（其值依查询入口路径而变，§5.4 论证）。AST 局部遍历（walk/pvCheck/e309Walk/toIRType）允许递归但**不得穿越 ref 展开**（穿越只发生在预计算表中）。
4. **预算纪律**：`MAX_TYPE_NESTING = 100` 不导出、不进公共面、v1 生命周期内不得调升/调降（#5 §15.2 承诺延续；如需变更回总控走设计修订）。
5. **锚点纪律**：E304 锚标记名记号（非实参、非 `<`）；E306 锚键类型起点（非 `Record` 记号——受测反例 `Record<number,…>` 锚 (1,17) 非 (1,10)）；E307 直接锚标记记号、经别名锚实参内引用记号；E309 锚首个异类成员起点。禁止任何迁就性偏移实现。
6. **公共面纪律**：`index.ts` 零改动——新类型成员经既有 `export type { … } from './ir.js'` 自动生效；shapes.ts 不导出至公共面。
7. **零依赖纪律**：不新增任何第三方 import；`package.json` 唯一允许改动 = `version` patch 位（0.1.1 → 0.1.2，HG9，§13 授权）。
8. **E100 消息口径**：删除「本切片未实现」族消息（对应分支已转正）；保留真越界与资源上限两态。新 E100 分支消息如实描述（如「期望 '>'，实际 …」「Pattern 实参须为字符串字面量」）。
9. **【R2 · SA2 #2；R3 · SA2 N1/N2 扩展；R4 · SA2 M2 承载更新】输入域完备纪律（硬性）**：shapes.ts 任何 `declared[name]` 取体前必须先过「已声明」守卫（R4 承载：computeCls 的 `comp(R)` 已声明检查 + 第 2 步 walk ref 出现名显式入表）；**查询侧一律经统一助手 `clsOf` / `strFormOf`**（§5.1/§5.4）取值——禁止绕过助手直查 cls/strCls 表、禁止在查询位直调 localCls（R2 的两处缺口 N1/N2 均源于裸查询路径：未声明 ref 的 undefined 比较、直接联合的 undefined 分类）；禁止 `body.kind` 直取未声明名的体。未声明名 / generic-diag / 多体 / 环触达不是降级场景，而是已注册错误通道（E301 / 终判 / E302 / E106）的伴随输入——**禁止**静默吞掉（不产出任何候选）、**禁止**伪造形状（错误分类）、**禁止**依赖 #5 §15.4 顶层兜底（设计路径永不触及：无限循环与假 E100@(1,1) 的路径已在 §5.2 输入域层面消灭；挂起路径已在 §5.4 求值域层面消灭）。
10. **【R2 · SA2 #3】walk 扩展清单**：semantic.ts walk 对新节点下降——object.fields / union.members / array.element / record.key **与** value / marker.arg；pattern 无子节点；**generic-diag 无子节点但必须被 visit**（终判候选靠它——嵌在 marker 实参 / record 键 / 联合成员任何深度的 generic-diag 都要走 #5 既有终判分支）。computeCls 的 R4 不变量（表值与声明序/起点序无关）建议以**开发期属性自检**：对固定 fixture 对（如 T-R3-2 的 A/B 与 M2 模块声明行排列）断言 cls 表逐名相等（排列对在测试内以行重排构造，O(一次重跑)）；Tarjan 帧栈纪律（每名至多入栈一次、SCC 弹出时其依赖 SCC 均已 memo）可以 O(1) 断言随循环自检，发布构建可保留（无渐进开销）。【R4 · SA2 M2】R2/R3 的灰集不变量（灰 ≡ 栈内名字集 + 栈为 DFS 路径）已随灰集机制退役，不再适用。

---

## §10 红灯锚点逐字核算表（SA6 33 条中带精确锚者 + 设计期补充；全部脚本核算，非口算）

### 10.1 SA6 受测锚点复核（1 起列、`\n` 行分隔、Unicode 码点列）

| # | 输入 | 断言 | 核算 | 本设计行为 |
|---|---|---|---|---|
| 1 | `type A = YMap<string>;` | E304 (1,10) | ✅ `YMap`@10 | cls(string)=scalar≠map → E304@marker ✓ |
| 2 | `type A = YLeaf<{ x: string }>;` | E304 (1,10) | ✅ `YLeaf`@10 | cls(object)=map≠scalar ✓ |
| 3 | `type A = YXmlFragment<number>;` | E304 (1,10) | ✅ `YXmlFragment`@10 | cls(number)=scalar≠map ✓ |
| 4 | `type B = { x: number };\ntype A = YLeaf<B>;` | E304 (2,10) | ✅ `YLeaf`@L2C10 | cls(B)=map（别名链）✓ |
| 5 | `type R = Record<number, string>;` | E306 (1,17) | ✅ `number`@17（`Record`@10、`<`@16） | strForm=false → 锚键起点 ✓ |
| 6 | `type B = number;\ntype R = Record<B, string>;` | E306 (2,17) | ✅ `B`@17 | 链展开到 number ✓ |
| 7 | `type A = YPlainArray<YMap<{ x: string }>>;` | E307 (1,22) | ✅ `YMap`@22（`YPlainArray`@10-20、`<`@21） | pvCheck 直接标记 ✓ |
| 8 | `type A = YMap<{ x: string }>;\ntype B = YPlainArray<A>;` | E307 (2,22) | ✅ `A`@L2C22 | containsSync(A)=true → 锚 ref ✓ |
| 9 | `type T = { x: { a: string } \| number };` | E309 (1,31) | ✅ `number`@31 | 首成员 map、首个异类 scalar ✓ |
| 10 | `type A = ymap<{ x: string }>;` | E301 (1,10) | ✅ `ymap`@10 | generic-diag 未声明 ✓ |
| 11 | `type A = YLEaf<string>;` | E301 (1,10) | ✅ `YLEaf`@10 | 同上 ✓ |

### 10.2 SA6 可区分性锚（expectDistinct 9 组）结构满足核对

| 文本对 | IR 差异来源 |
|---|---|
| `YMap<{x:string}>` vs `{x:string}` | marker 包裹 vs 裸 object |
| `YArray<string>` vs `string` | marker vs primitive |
| `YPlainArray<number>` vs `number` | marker vs primitive |
| `YLeaf<string>` vs `string` | marker vs primitive |
| `YXmlFragment<{title}>` vs `{title}` | marker vs object |
| `string & Pattern<"…">` vs `string` | pattern vs primitive |
| `string[]` vs `string` | array vs primitive |
| `Record<string, number>` vs `number` | record vs primitive |
| `Record<AssetId, n>` vs `Record<string, n>` | key: ref vs primitive（别名不内联） |
| `YMap<Record<string, YLeaf<string>>>` vs `…YLeaf<number>` | 最内层 arg 叶值 |

### 10.3 既有 37 条零破坏核对

逐条读过 4 个测试文件：#5 三文件（parse-vfsl 11 / parse-vfsl-errors 19 / parse-vfsl-r3-regression 7）的输入**无一**包含本任务转正的四类构造（其 E100 用例全部是括号分组 / 负数 / 保留名 `<` / 缺分号族——§4.4 核对表证明这些分支零变化）；**【R2 · SA2 #8】grep 复核：#5 三文件亦无 `X<T>[]`（generic-diag 后随 `[]`）族输入**（仅 `string<number>`@errors:66 与声明位 `Box<T>`@errors:90，两者锚点路径零变化）——§1.2 的锚点迁移族无绿测冲突。新文件 8 条绿锁（AC3 反例、E301 变体、裸标记）在本设计下行为不变。

---

## §11 红灯测试构想（供 SA6 后续补测；非本切片阻塞项）

### 11.1 R1 构想（R2 维持不变，锚点未复核出偏差）

全部经 `parseVfsl` 公共入口；锚点均脚本核算（构造方式与 §10 同款）。归属 `[SA6 owned]`，SA3 不得自写断言覆盖。

| # | 输入 | 期望 | 锚点（核算值） |
|---|---|---|---|
| T-a | `type A = YMap<YXmlFragment<{ a: string }>>;` | E304（xml 非对象形，§8-1） | `YMap`@(1,10) |
| T-b | `type A = YMap<{ a: string }[]>;` | E304（数组非对象形） | `YMap`@(1,10) |
| T-c | `type R = Record<"a", string>;` | E306（字面量非 string 形，§8-4） | `"a"`@(1,17) |
| T-d | `type S = YMap<{ x: string }>;\ntype M = S;\ntype T = YPlainArray<M>;` | E307 经多层链，锚最外层实参引用（§8-5） | `M`@(3,22) |
| T-e | `type M = { a: string } \| number;\ntype P = YPlainArray<M>;` | E309（文本位豁免口径，§8-7——别名体恒查） | `number`@(**1,26**)（M 体内） |
| T-f | `'type A = ' + 'YArray<'.repeat(101) + 'string' + '>'.repeat(101) + ';'` | E100 资源口径（预算扩至标记，§4.6），不抛 RangeError | 第 101 个 `YArray`@(1,**710**)（= 10 + 100×7） |
| T-g | 同 T-f 构造 N=100 | `ok: true`；JSON 往返深等 | 预算边界正例 |
| T-h | `type A = string & Pattern<"a">[];` | `ok: true`，且 IR ≠ `type A = string[];` 的 IR（注记 1：约束字符串的数组） | — |
| T-i | `type Box = string;\ntype T = Box<number>[];` | E100（第 6 条已声明带实参；postfix 不影响 generic-diag 终判） | `<`@(2,13) |
| T-j | `type A = YPlainArray<YMap<string>>;` | E100 前缀；**E304 胜出**（同锚 (1,22) 并列按码号 304<307，§8-6） | `(1,22)` |
| T-k | `type A = YLeaf<YPlainArray<{ a: string }>>;` | `ok: true`（scalar-form 含 YPlainArray，§8-2；PV 内无同步标记） | — |
| T-l | `'type A0 = string;'` + `'type A' + i + ' = A' + (i-1) + ';'`×20000 再加 `type R = Record<A20000, string>;` | `ok: true`（E306 strForm 链展开迭代、E106/cls 图查询迭代——栈安全回归；兼 SA2 #7 的运行时栈安全动态验证位） | — |

### 11.2 R2 增补构想（采纳 SA2 红线 T-S2-1~11 + SA1 补充 2 条；锚点全部经脚本逐位核算）

**【锚点核算勘误】** SA2 评审报告 T-S2-2 的 `(5,14)` 与 T-S2-9 的 `(1,20)` 经脚本逐位核算为 **(5,15)**（`{` 前有一位空格，列 15 起）与 **(1,21)**（`{ a: 1 }` 内 `a:` 间无空格，`string` 列 21 起）——SA6 补测时以本表核算值为准，勿照抄评审报告数字。其余 T-S2 锚点（(5,10)/(1,15)/(1,10)×2/(1,15)/(1,22)/(2,6)/(2,13)）核算一致。

| # | 来源 | 输入 | 期望 | 锚点（核算值） | 锁定对象 |
|---|---|---|---|---|---|
| T-m | T-S2-1 | `type T = M \| N;\ntype M = A \| string;\ntype N = A;\ntype A = number;\ntype X = YMap<N>;` | **E304@(5,10)**（N 解析为 number，非对象形）。R1 灰集缺陷下假 cycle → ok:true | `YMap`@(5,10) | #1 灰集修复（假环 → E304 复现） |
| T-n | T-S2-2 | 同上四行 + 第五行 `type Y2 = N \| { a: 1 };` | **E309@(5,15)**（`{` 起点；N=scalar 与 map 并存）。假 cycle 下被吞 | `{`@(5,15)（**勘误**：SA2 报 (5,14)） | #1 灰集修复（假环 → E309 复现） |
| T-o | T-S2-3 | `type A = YMap<Foo>;` | **E301@(1,15)**（未声明名；非 E304@(1,10)） | `Foo`@(1,15) | #2 未声明不裁决 |
| T-p | T-S2-4 | `type M = Foo \| number;` | **E301@(1,10)**，且调用**正常返回**（不挂起、无 `内部错误` E100@(1,1)） | `Foo`@(1,10) | #2 防无限循环/兜底掩盖 |
| T-q | T-S2-5 | `type T = Foo \| number;` | **E301@(1,10)**（非 E309——未声明成员不参与三分类） | `Foo`@(1,10) | #2 unknown 跳过 E309 |
| T-r | T-S2-6 | `type A = YMap<Foo<1>>;` | **E301@(1,15)**（generic-diag 终判胜出；非 E304@(1,10)） | `Foo`@(1,15) | #3 |
| T-s | T-S2-7 | `type A = YPlainArray<Foo<1>>;` | **E301@(1,22)**（非 E307） | `Foo`@(1,22) | #3 |
| T-t | T-S2-8 | `type B = string;\ntype B = number;\ntype R = Record<B, string>;` | **E302@(2,6)**（E306@B@(3,17) 亦产出，min-position 胜出者写死，§8-10） | `B`@(2,6) | #4 多体口径 |
| T-u | T-S2-9 | `type K = { a: 1 } \| string;\ntype R = Record<K, string>;` | **E309@(1,21)**（键位口径①：K 声明体联合按文本位检查，胜出 E306@K@(2,17)；§8-15） | `string`@(1,21)（**勘误**：SA2 报 (1,20)） | #5 |
| T-v | T-S2-10 | `type A = YMap<YMap<{ x: string }>>;` | **ok: true** | — | #6 自反对象形正例（锁 §8-1 自反读法） |
| T-w | T-S2-11 | `type Box = string;\ntype T = Box<number>[];` | **E100@(2,13)**（锚 `<`；锁锚点迁移族 §1.2，防 SA4 误判翻转；与 T-i 同输入互补视角） | `<`@(2,13) | #8 |
| T-x | SA1 补充 | `type T = M \| N;\ntype N = M;\ntype M = number;\ntype X = YMap<N>;` | **E304@(4,10)**（N=scalar≠map；无环、无未声明名——兄弟引用拓扑：R2 以「单待定入栈」修复（SA2 字面修复的批量入栈 + pop 清灰下此输入仍假 cycle → ok:true）；【R4】SCC 分解下该类假环结构性消灭，本条转为回归锁） | `YMap`@(4,10) | #1 强化（R2 攻击点 #1c；R4 承载见 §5.2 对照表） |
| T-y | SA1 补充 | `type T = U1;\ntype U1 = T \| number;` | **E106@(2,11)**（环经联合：模块被 E106 拒绝；**非** E309——【R4 措辞更新】环 SCC 切环合成 T=U1='scalar'，U1=T\|number 两成员同属标量桶、不判异类；§8-9/§8-18 口径锁定） | `T`@(2,11)（U1 体内回边引用） | #1/#9 环语义 |

### 11.3 R3 增补构想（采纳 SA2 R2 红线 T-R2-1~5 + SA1 补充 T-R2-3b/T-z；锚点全部经脚本逐位核算，设计期模拟全过）

| # | 来源 | 输入 | 期望 | 锚点（核算值） | 锁定对象 |
|---|---|---|---|---|---|
| T-R2-1 | T-R2-1 | `type A = YMap<Foo>;`；变体 `type A = YXmlFragment<Foo>;` | **E301@Foo**（非 E304@标记记号——**机制保证**：clsOf 未声明 → 'unknown' 不裁决 + §5.2 表完备（R3 根集扩展，R4 承载为第 2 步入表）；兑现 §11.2 T-o 的机制化） | `Foo`@(1,15)；变体 (1,23)（`YXmlFragment` 12 字符占 10-21 列，`<`@22） | N1 |
| T-R2-2 | T-R2-2 | `type A = YLeaf<string \| number>;` | **ok: true**（规格 §3 YLeaf 行「其联合」明文允许——锁 clsOf union 行） | — | N2 |
| T-R2-3 | T-R2-3 | `type A = YMap<{ x: string } \| { y: number }>;` | **ok: true**（§8-16 从宽登记：全 map 直接联合 = 对象形；E309 侧同质联合不触发） | — | N2 |
| T-R2-3b | SA1 补充 | `type A = YMap<{ x: string } \| number>;` | **E304@(1,10)**（混合联合 → 'mixed' ≠ 'map'——从宽的边界：混合不在宽侧，防 SA3 借 union 行过度放松） | `YMap`@(1,10) | N2 |
| T-R2-4 | T-R2-4 | k=40 双体链（测试内构造式生成）：`for i in 0..39` 两行 `type B{i} = B{i+1};`，加 `type B40 = string;` 与 `type R = Record<B0, string>;`（2k+2 = 82 行） | **有限时间正常返回**：ok:false **E302@(2,6)**（vitest 默认 5s 超时即红灯——挂起即失败；strCls(B0)=true → 无 E306，E302 的最小位置锚 = B0 第二条声明） | `B`@(2,6) | N3 |
| T-R2-5 | T-R2-5 | k=21 同构链（2k+2 = 44 行快测版，另断言耗时 < 1s） | 同上正常返回（防 SA3 只在大输入上凑巧线性） | 同上 | N3 |
| T-z | SA1 补充 | `type R0 = Record<Q, string>;\ntype Q = W \| number;\ntype W = Q;` | **E106@Q@(3,10)**（环触达 ⊥ → **无** E306@Q@(1,17)；R2「false 分量折叠压过 ⊥」读法下 E306 会以 (1,17) 胜出——锁 §8-10 R3 环口径） | `Q`@(3,10)（W 体内回边引用） | N3 / §8-9 |

（T-R2-4/T-R2-5 兼作 SA7 动态验证位：与 §11.1 T-l 同跑，覆盖「E302 多体 × 深链」这一 T-l 未覆盖的挂起面；§11.2 勘误注继续适用——SA6 补测以本表核算锚点为准。）

### 11.4 R4 增补构想（采纳 SA2 R3 红线 T-R3-1a~1d / T-R3-2；**R5 追加 SA2 R4 红线 T-R4-1~4**；锚点全部经脚本逐位核算，设计期模拟全过——R4 合并电池 50 断言 + R5 增量电池 37 断言含本表全部用例）

| # | 来源 | 输入 | 期望 | 锚点（核算值） | 锁定对象 |
|---|---|---|---|---|---|
| T-R3-1a | SA2 M1 | `type T = { a: string } \| string[];` | **ok: true**（全容器形联合多态物化，规格 §3 三分类第二行明文「数组成员 → Y.Array」）。R3 六值比较现状：E309@`string`@(1,26)（`string[]` 的 nodePos = 元素链起点）错拒 | —（R3 错误锚仅供对照，勿据以断言） | M1 桶级折叠（§8-17） |
| T-R3-1b | SA2 M1 | `type E = { a: string };\ntype A = string[];\ntype T = E \| A;` | **ok: true**（经别名介导的 map+container 混合——锁查询位 clsOf 同按桶折叠，防实现只对直接叶折叠） | — | M1 |
| T-R3-1c | SA2 M1 | `type T = M \| M2;\ntype M = { a: string } \| number;\ntype M2 = { b: string } \| boolean;` | **E309@`M`@(1,10)**（组合联合 mixed\|mixed 亦触发——mixed 成员锚规则：首成员 M 即 mixed、本身即异类锚）。R3 现状：T 位不触发、仅 M/M2 体内兜底 → 报 E309@`number`@(2,26)——锚漂移可观测（候选池 (1,10)/(2,26)/**(3,27)**【R5 · SA2 R4-2 勘误：原 (3,26) 系笔误——`M2` 比 `M` 多一字符，第三行 `boolean` 全行右移一位，脚本核算 27；胜出断言不受影响】，min-position 取 (1,10)） | `M`@(1,10) | M1 / §8-17 mixed 锚 |
| T-R3-1d | SA2 M1 | `type T = { a: string } \| number;`（回归锁） | **E309@`number`@(1,26)**（桶级修复不得放松标量/容器并存——SA6 既有 (1,31) 用例的同族非嵌套姊妹） | `number`@(1,26) | M1 回归 |
| T-R3-2 | SA2 M2 | 模块 A：`type X = YMap<T>;\ntype T = U1;\ntype U1 = T \| number;`；模块 B = 同三行**仅 2/3 行互换**（`type X = YMap<T>;\ntype U1 = T \| number;\ntype T = U1;`） | **A 与 B 产出完全相同的错误码与位置：E304@`YMap`@(1,10)**（选案①：SCC{T,U1} 切环合成 = 'scalar' → E304 可裁决且两序同值；候选池各含 E304@(1,10) + E106@回边（A (3,11) / B (2,11)），min-position 同报 E304@(1,10)——两模块第 1 行共有）。R3 现状：A 报 E304@(1,10)、B 报 E106@(2,11)（设计期与 SA2 独立模拟双重复现）——声明序敏感 | `YMap`@(1,10) | M2 / §8-18（两序同码同位） |
| T-R4-1 | SA2 R4-1 | `type T = YMap<A>;\ntype A = { x: A \| number };` | **E106@A@(2,15)**（A 的声明体是内联 ObjectType → 顶层分解 cls(A)='map' → E304 不下裁决，错误身份归还 E106 回边。「任意深度」字面读法 (b) 现状会报 E304@YMap@(1,10)——红灯钉死顶层分解；设计期三读法模拟复现两向） | `A`@(2,15) | R4-1 分量池顶层分解（容器介导环**分辨位**） |
| T-R4-2 | SA2 R4-1 | `type T = YMap<A>;\ntype A = { x: A \| D };\ntype D = number;` | **E106@A@(2,15)**（同上；额外锁「环外嵌套 ref（D）不入分量池」——读法 (c) 下会报 E304@(1,10)，设计期模拟复现） | `A`@(2,15) | R4-1（环外嵌套 ref 只作图边） |
| T-R4-3 | SA2 R4-1 | `type A = { x: A };` ＋ `type A = { x: A[] };`（规格 §4 两条规范自引用示例，兼 #5 绿锁族） | 各 **E106@A@(1,15)**（三读法同值——回归锁：顶层分解的钉死不改变规格点名输入的既有行为；设计期三读法模拟证实） | `A`@(1,15)（两条同锚） | R4-1 回归 |
| T-R4-4 | SA2 R4-1 判读辅助 | `type T = YLeaf<A>;\ntype A = { x: A \| number };` | **E304@YLeaf@(1,10)**（对照位：标量形查询下 cls(A)='map'（(a)）/'mixed'（(b)）/'map'（(c)）均 ≠ 'scalar'——三读法同值。**判读说明**：本用例通过**不**证明分量池口径正确，分辨位是 YMap 查询（T-R4-1/T-R4-2）——防 SA3 以本用例通过误以为口径已钉死） | `YLeaf`@(1,10) | R4-1 判读辅助 |

（SA1 补充自检位——非红灯、属 §9-10 开发期属性断言的依据：M2 模块声明行全排列 3!=6 种、双环模块 4!=24 种的 cls 表逐名一致，设计期已验；【R5】P1 容器介导环模块排列 2!=2 亦已验。T-R3-2 与 T-R4-1/T-R4-2 兼作 SA7 动态验证参考位（声明序不变性 + 容器介导环正确性），与 T-l / T-R2-4/5 同文件跑。锚点核算口径同 §10.1：1 起列、`\n` 行分隔、Unicode 码点；T-R4-1~4 全部锚点经脚本逐位核算，与 SA2 R4 轮红线表数值逐项一致。）

---

## SA2 反馈逐条回应（R4 轮：R4-1/R4-2——本 R5 修订的指令）

**评审**：`wiki/raw/task_vfsl-parser-containers-markers_sa2_review.md`「R4 轮」章节（2026-08-19，verdict: reject；M1/M2/M3 确认全部修复，本轮仅剩 R4-1/R4-2）。按 SKILL「SA2 反馈修订协议」逐条 mapping 如下——每条均落到设计章节的**实质改动**（伪代码/登记行/红灯/纪律注记），非承认性注记；修法经设计期三读法并列模拟验证（R5 增量电池 37 断言全过，§13）：

| 要求（攻击点） | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| R4-1 (HIGH) 环 SCC 分量池「（ref / 叶，任意深度）」分解口径未定义——二选一并落 §5.2/§8-18：**推荐 (a) 顶层分解**（体为 ref → 该 ref；体为联合 → 顶层成员（ref/叶）；体为叶 → 该叶 localCls；容器叶内部的嵌套 ref 仅作图边（环归属与缩点依据），不入分量池）并补「与 §5.2 非环分支的成员分量同一分解 notions——环与非环的 Cls 语义仅在切除环内 ref 一点上不同」；或显式选 (b)/(c) 并给规格文义论证；§8-18 补登记行（分量分解定义 + P1/P3 观测面写死：P1 `type T = YMap<A>; type A = { x: A \| number };` → E106@A@(2,15)；P3 加 `type D = number` 后同报 E106@(2,15)）；§11.4 增红灯（锚点按 R4 轮红线表）；§9-3 memo 纪律补实现注记；R4 电池补容器介导环用例 P1/P3/P5 | ✅ **选案 (a)（SA2 推荐并论证的唯一可自洽选案，逐字落实钉死）** | §5.2（伪码分量池行改写为顶层分解 + 图 G 边集职责注记 + 「同一分解 notions / 仅在切除环内 ref 一点上不同」注记于伪码与专段两处 + R5 专段：P1/P3 三读法推演 + (b)/(c) 否证 + 非环对照实证 + 承载机制对照表补行 + R4 不变量措辞同步 + 实测依据段补 R5 电池）、§8-18（「全部分量」→「顶层分量」+ 指引 §8-19）、**§8-19（新增登记行**：分解定义 + P1/P3 观测面写死 + (b) 规格冲突与 (c) 非自洽的否证 + T-R4-4 判读定位）、§9-3（memo 纪律补分量池实现注记：禁止展开容器叶内部 ref/叶）、§11.4（T-R4-1/T-R4-2/T-R4-3 + T-R4-4 判读辅助，锚点与 R4 轮红线表逐项一致）、§13（R5 电池 37 断言）、§3.1/§5.1/§12/§14（一致性同步） | 分量池钉死为**顶层分量**：体为 ref → 该 ref；体为联合 → 其顶层成员（ref/叶）；体为叶 → 该叶 localCls；**容器叶内部的嵌套 ref 仅作图边（环归属与缩点依据），不入分量池**——与 §5.2 非环分支的「成员分量」**同一分解 notions**，环与非环的 Cls 语义**仅在「切除环内 ref」一点上不同**（两处原文照录：伪码注记 + §5.2 R5 专段 + §8-19）。三读法并列模拟（37 断言全过）：**P1** (a) **E106@A@(2,15)**（cls(A)='map'）vs (b) E304@YMap@(1,10)（'mixed'——对内联 ObjectType 报「非对象形」，与规格 §3 约束表冲突 + 非环分支自相矛盾：非环 `type C = { x: string \| number };` 三读法同值恒 'map'）；**P3** (a) **E106@A@(2,15)** vs (b)/(c) E304@(1,10)——(c) 在 P1/P3 间摇摆非自洽、(b) 预判无法自洽（SA2 论证成立，模拟证实）。观测面按评审原文写死入 §8-19（P1/P3 数值逐字一致）。历轮环拓扑回归（T-R3-2 A/B、T-m/T-x/T-y、规格规范示例、#5 绿锁族）在 (a) 下与 R4 登记值逐项一致——既有环的介导 ref 均在顶层，顶层分解 = R4 原意的钉死，**零行为面变化**；P1 声明序排列 2!/2 cls 表逐名一致。红灯 T-R4-1/T-R4-2（分辨位 = YMap 查询）+ T-R4-3（规格 §4 两条规范自引用示例回归，三读法同值 E106@(1,15)）+ T-R4-4（判读辅助：三读法同值 E304@YLeaf@(1,10)，防以对照位通过误判口径已钉死）。电池补齐 R4 盲区：P1/P3/P5（P5 取 R4 轮红线表 T-R4-4 输入——SA2 未定义 P5 具体输入，本设计显式取判读辅助位并注明）+ P4 多体变体 + 非环对照 |
| R4-2 (LOW) §11.4 T-R3-1c 括注锚点笔误：(3,26) → (3,27) | ✅ | §11.4 T-R3-1c 期望列 | 括注改 **(3,27)** 并就地标注勘误依据（`M2` 比 `M` 多一字符、第三行 `boolean` 全行右移一位；脚本核算 27 与 SA2 独立模拟池一致）。胜出断言 E309@`M`@(1,10) 不受影响；SA6 补测以本值为准 |

**一致性自检**（R5，SKILL 要求，已执行）：全文检索「任意深度」——分量池语境的表述已全部清除（§5.2 伪码与 §8-18 两处均改「顶层分量」）；保留的「任意深度」均为图边/闭包语义、与分量收集无关（§5.2 图 G 边集 + 职责注记「止于图边」、§5.5 containsSync 种子与反向边两处——strForm/E307 侧 R4 零改动）。「顶层分量/顶层分解」在 §3.1/§5.1/§5.2（伪码 + 专段 + 对照表 + 不变量 + 实测依据）/§8-18/§8-19/§9-3/§11.4/§13 九处同源；「同一分解 notions / 仅在切除环内 ref 一点上不同」在 §5.1/§5.2（伪码注记 + 专段）/§8-19 四处一致；P1/P3 观测面（E106@A@(2,15)）在 §5.2 专段、§5.2 实测依据、§8-19、§11.4 T-R4-1/T-R4-2、§13 五处同值；T-R4-4「三读法同值、非分辨位」的判读定位在 §8-19/§9-3/§11.4 一致；非环分支（§5.2 单名 SCC 求值三分支：ref→comp / union→顶层成员 / 叶→localCls）与环分支的分解现已同构——§5.1「除联合外局部可定」的 prose 与两分支伪码一致；§5.7 聚合无冲突（环 ⟹ E106 候选在场的闭环不变，ok 判定与 R4 相同）；§11.4 新增四行期望与 §5.2/§8-19 逐条同源（设计期三读法模拟 37/37 全过，锚点脚本核算与 SA2 R4 轮红线表逐项一致）。

---

## SA2 反馈逐条回应（R3 轮：M1/M2/M3——本 R4 修订的指令）

**评审**：`wiki/raw/task_vfsl-parser-containers-markers_sa2_review.md`「R3 轮」章节（2026-08-19，verdict: reject）。按 SKILL「SA2 反馈修订协议」逐条 mapping 如下——每条均落到设计章节的**实质改动**（伪代码/表格/登记行），非承认性注记；关键修法均经设计期同构模拟验证（R4 合并电池 50 断言，§13）：

| 要求（攻击点） | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| M1 (HIGH) E309 扫描谓词六值原始不等比较：降到规格三分类桶级（bucket(map)=bucket(container)=容器形、'mixed' 恒异类含 mixed\|mixed、等价谓词 `(∃scalar ∧ ∃container) ∨ ∃mixed`）+ mixed 成员锚规则 + §8 登记 + T-R3-1a~1d | ✅ | §5.6（扫描伪码全重写：bucket 折叠 + 双异类锚规则 + R3 缺陷对照段 + 用例核对更新）、§8-17（新增登记：桶级口径、mixed 成员锚、与 E304 精确值查询的界分、单调性论证）、§7（E309 行）、§11.4（T-R3-1a~1d）、§3.1（shapes.ts 布局） | 按建议原文落实：`{ a: string } \| string[]` → 容器桶+容器桶 → ok: true（T-R3-1a，R3 现状 E309@`string`@(1,26) 错拒已在设计期复现）；别名介导同桶（T-R3-1b）；mixed\|mixed 组合位触发且首成员即锚 @`M`@(1,10)（T-R3-1c，R3 锚漂移 (2,26) 复现）；标量/容器并存不放松（T-R3-1d @`number`@(1,26)）。规格依据入 §8-17：三分类第二行明文多态物化（「数组成员 → Y.Array」）+ 锚条款原文即「形状**类别**」（= 三分类）+ 与 §5.1 synthesize 的 map+container → 'container' 自洽（R3 的自相矛盾消除）。E304 维持 `clsOf==='map'` 精确值不折叠（SA2 已独立核实 `YMap<{a}\|string[]>` → E304 正确，R4 保持） |
| M2 (HIGH) computeCls 环上名 Cls 值指派依赖声明顺序：SCC 值规范化二选一（① synthesize(环上全部体分量，环内 ref 记 cycle 分量 eff 移除) / ② 环上名整块 'cycle'）并登记 §8-9/§8-18 + T-R3-2 | ✅ **选案①** | §5.2（全节重写：迭代 Tarjan SCC 分解 + SCC 弹出即求值 + 环 SCC 均匀合成；历轮攻击点 → R4 承载机制对照表；灰集退役）、§3.3（「与声明序无关」由机制兑现 + 含环模块注记）、§5.1（'cycle' 行/关键化简措辞）、§8-9（'cycle' 授予范围 R4 化）、§8-18（新增：五点论证）、§9-3/§9-9/§9-10（Tarjan 纪律 + 排列属性自检 + 灰集断言退役）、§11.4 T-R3-2、§13（R4 模拟数据） | **选①**（SA2 例中 T=U1='scalar'，A/B 均报 E304@(1,10)——与本设计期模拟一致）。实现：迭代 Tarjan（显式帧栈，O(名数+边数)），SCC 弹出即求值（弹出序 = 缩点 DAG 依赖在前序——求值时一切被引用 SCC 已有值，起点序任意、值不变）；环 SCC 全成员 = synthesize(全成员归一体分量池；S 内 ref → 'cycle' 分量；S 外 ref → comp(R)；未声明 → 'unknown')；纯环 eff 空 → 'cycle'。**否决②三点理由**（§8-18c）：②丢弃 eff 信息、与 R2 已核验语义（「含非环成员者 eff 后有定义」）冲突；②下 T-R3-2 A/B 同码但锚随回边文本位漂移（(3,11)/(2,11)，E106 不在规格声明序无关条款枚举内）——SA2 红线字面「完全相同的错误码与位置」仅①满足；②实现增益不抵语义损失。附带消除「伪码未规定根迭代序」问题（起点序任意、值不变——不变量 + 3!/4! 全排列自检 6/6、24/24）。strForm/E307 侧零改动（SA2 已核实无此缺陷；T-z/T-t/T-d 回归验证维持） |
| M3 (LOW) 闭环证明「'unknown' ⟸ ……｜多体名」bullet 与前置归一条款冲突——按建议改述 | ✅ | §5.2 闭环证明（多体名单列改述） | 按建议原文改述：「多体名：其 Cls 为虚拟联合合成值（**确定值**，是否 'unknown' 取决于分量——`type B = string; type B = number;` → 'scalar'）；安全性依据 = E302 候选在场（非值恒 'unknown'），裁决与否都只在必败模块内参与 min-position 竞争」。结论（只在必 ok:false 模块出现）不变；'cycle' 行同步 R4 化（纯环 eff 空 ⟹ E106 在场） |

**一致性自检**（R4，SKILL 要求，已执行）：全文检索「灰/灰集」（R4 伪码无灰集机制——残留仅两处存档口径：§5.2 历轮攻击点对照表（明标「结构性消灭」）与 §9-10「已退役，不再适用」注记，无活性引用）、「桶/bucket」（§5.6 定义、§7 E309 行、§8-17、§11.4 四处同源；E304/E306 查询明确**不做**折叠——§5.3 `clsOf === 'map'` 原文未动，§8-17 有界分条款）、「SCC」（§3.1/§3.3/§5.1/§5.2/§8-9/§8-18/§9-3/§13 一致：Tarjan 弹出序 = 依赖在前、环 SCC 均匀值、纯环 'cycle'）、「cycle」（§5.1 行、§5.2 synthesize eff、§8-9/§8-18、T-y 单元格全部为 R4 口径，「回边命中灰集」残留仅 §8-9 的历史引述且已标注退役）、「声明序」（§3.3 声称 ↔ §5.2 R4 不变量 ↔ T-R3-2 机制闭环——prose 与伪码一致，M2 指出的自相矛盾消除）；§5.7 聚合与 R4 闭环证明无冲突（不裁决/裁决产物均不改变候选池在必败模块的非空性）；§11.4 期望与 §5.6/§8-17/§8-18 逐条同源（设计期模拟 50/50 全过，含 R3 现状对照复现）。

---

## SA2 反馈逐条回应（R2 轮：N1/N2/N3——R3 修订的指令，历史存档）

**评审**：`wiki/raw/task_vfsl-parser-containers-markers_sa2_review.md`「R2 轮」章节（2026-08-19，verdict: reject）。按 SKILL「SA2 反馈修订协议」逐条 mapping 如下——每条均落到设计章节的**实质改动**（伪代码/表格/登记行），非承认性注记；关键修法均经设计期同构模拟验证（§13）：

| 要求（攻击点） | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| N1 (HIGH) E304 查询位 cls 表覆盖缺口：「统一 clsOf 助手」**或**「补机制（种子 = walk 全部 ref 出现）」——二选一，声称与伪码必须一致 | ✅ **两个选项都做** | §5.1（clsOf 定义 + R2 缺口对照）、§5.2（缺陷清单第 6 条 + 伪码根集扩展 + 守卫②注释）、§5.3（检查表改经 clsOf + N1/N2 反例行为写死）、§5.6（memberCls 并入 clsOf）、§3.3（声称改「由构造成立」+ 新增 strCls 表行）、§8-13/§8-14（措辞统一）、§11.3 T-R2-1 | 两选项不互斥且互补：**统一助手**消灭两条裸查询路径（N1 的直接病灶——`cls(arg)` 直查表的 undefined 比较）；**根集扩展**（根 = 已声明名 ∪ walk 全部 ref 出现名）让 §3.3 的「表覆盖一切被引用名」由构造成立，助手的 `?? 'unknown'` 退化为防御性带保险（与 §5.6 R2 既有「作带保险」口径同款）。`type A = YMap<Foo>;` 模拟验证：cls = {A:'map', Foo:'unknown'} → 不裁决 → E301@Foo@(1,15)（T-R2-1）；变体 `YXmlFragment<Foo>` → (1,23)；嵌套位未声明 ref（`YMap<{ x: Foo }>`、联合成员位）同被根集覆盖（§5.2 第 6 条） |
| N2 (HIGH) localCls 缺 union 行：(a) clsOf(union)=synthesize(memberCls) 并入统一助手 (b) §8 登记行——YLeaf 侧从宽、YMap/YXmlFragment 侧明确选择+理由+方向 (c) §11 正例红灯 | ✅ | §5.1（clsOf union 行 + 深度 ≤ 2 论证）、§8-16（新增登记行）、§11.3（T-R2-2/T-R2-3/T-R2-3b）、§5.3（直接联合三例行为） | (a) 按建议并入统一助手（memberCls 因此并入 clsOf，§5.6）；(b) **选择从宽**——理由三层：规格文义双料（§3 约束表 YLeaf 行「其联合」无别名限定；§3「YMap」节正文「`YMap<T>` 的 T 为对象形……**T 为对象形联合时**键空间取并集」直接对实参 T 立法）、机制一致性（与 §5.2 ④ 别名联合、§8-10 多体虚拟联合同一 synthesize——别名路径从宽 + 直接路径从严 = 同一语义两结论且随无关声明翻转，§5.6-2 病理）、方向诚实（本行兑现 R1/R2 既有登记 §5.1「全 map 形联合」/§8-1，非新增放宽；混合联合仍在严侧）；(c) 三条红灯入 §11.3（含 SA1 补充的从严边界锁 T-R2-3b） |
| N3 (CRITICAL) strForm 多体分支指数挂起：(a) 名字级 memo 迭代（memo 仅完成时写、环上名不 memo）或前置归一 (b) §9-3 显式纳入 strForm (c) 删「无深递归」绝对表述 (d) T-R2-4/T-R2-5 | ✅ | §5.4（全节重写：两步法 + strFormOf + 引理 + 环触达论证 + 闭环证明）、§8-10（R3 机制与环口径登记）、§8-9（机制化注记）、§5.1/§7（「浅层迭代 / 无深递归」表述全部删除改述）、§9-3（computeStrForm 入硬性清单 + memo 纪律）、§11.3（T-R2-4/T-R2-5/T-z）、§13（R3 期模拟数据）、§1.2 无触及（无 #5 行为面变化） | (a) 选名字级 memo（SA2 第一方案）。「前置归一为一次性合成」对 strForm **不保语义**：strForm 的多体折叠 ≠ 联合终值（`type B = string; type B = string;` 折叠 = true，而联合节点终值 = false）——SA2 N3 注记同样排除了违反 §8-10 登记语义的读法。**对「环上名字不 memo」的落实与论证**（§5.4 专段）：穿环名的值依查询入口路径而变（例证 `type Q = A \| string; type A = Q \| number;`：根查询 = false、栈内祖先回边贡献 = ⊥）——R3 将环触达名集（cone 含环者，**含环上名的传递引用者**，强于「环上名不 memo」）整块**预填 ⊥、逐出求值域**：求值域退化为纯 DAG，memo-on-completion 良定义、无需灰集、每名至多成帧一次（引理 + 20k 链 40,004 步线性实测）；观测面不变量：环触达 ⟹ E106 候选在场 ⟹ ok:false 不变（与 §8-9 一致化，T-z 锁定）；(b) §9-3 清单扩展 + memo 纪律（禁止给环触达名写 memo）；(c) §5.1/§5.4/§7 三处绝对表述删除；(d) T-R2-4（k=40 构造式 82 行）/ T-R2-5（k=21 快测）+ SA1 补充 T-z。设计期证据：R2 旧多体递归同构复现严格 ×2/级（k=8..16：767/3071/12287/49151/196607 步 = 3·2^k−1）；R3 全管线 k=40 → 124 步 1.6ms；36 拓扑电池全过 |

**一致性自检**（R3，SKILL 要求，已执行）：全文检索「clsOf」（§3.3/§5.1 定义/§5.3 E304/§5.6 E309/§8-13/§8-14/§8-16/§9-9——查询位无任何绕过助手的裸 `cls[...]` / 直调 localCls 残留：§5.2 伪码内的 `memo[R]` 是**预计算侧**取值，非查询位）、「strForm」（§5.1/§5.4 定义两步法与 strFormOf；§7/§8-4/§8-9/§8-10/§8-13/§8-15 引用一致——「浅层」「无深递归」字样已全部清除）、「memberCls」（已并入 clsOf，仅 §5.6 过渡说明与 N1 回应表中以历史口径出现）、「环」（Cls 'cycle' = §5.2 灰集语义、strForm 环触达 = §5.4 cycNames 预填 ⊥——两机制各自独立且均以「不裁决 + E106 兜底」闭环，§8-9 同一行登记）、「union 行」（§5.1 clsOf 与 §8-16 登记互指，无第二处冲突定义）；§5.7 聚合与 §5.2/§5.4 两份闭环证明无冲突（不裁决不改变候选池非空性）；§11.3 与 §5.3/§5.4/§8-10/§8-16 的期望行为逐条同源（全部经设计期模拟复核，36/36）。

---

## SA2 反馈逐条回应（R1 轮：#1~#8——R2 修订的指令，历史存档）

**评审**：`wiki/raw/task_vfsl-parser-containers-markers_sa2_review.md` 上半部（2026-08-19，verdict: reject）。按 SKILL「SA2 反馈修订协议」逐条 mapping 如下——每条均落到设计章节的**实质改动**（伪代码/表格/登记行），非承认性注记：

| 要求（攻击点） | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 (CRITICAL) 灰集簿记：检查次序倒置 / pop 不清灰 / 根帧不加灰 | ✅ | §5.2 全节重写；§11 T-m/T-n/T-x | ①③ 分支 memo 命中优先于灰命中；①②③④⑤ 每条完成路径统一 `灰 -= f`；根帧入栈即 `灰 += 名`；不变量「灰 ≡ 栈内名字集 且 栈为 DFS 路径」。**超出 SA2 字面修复**：SA2 (b)(c) 的「灰 ≡ 栈内集合」在 R1 批量入栈下仍漏兄弟拓扑假环（`type T = M \| N; type N = M;`），已改单待定入栈一并消灭（§5.2 缺陷清单第 3 条 + T-x + 模拟验证 cls(N)='map'）。SA2 反例入 T-m/T-n，cls(N)='scalar' 已模拟证实 |
| #2 (CRITICAL) 未声明名输入域：declared miss 的三路事故 + E304 压制 E301 | ✅ | §5.1（'unknown' 类）、§5.2（守卫② + synthesize 主导传播 + 闭环证明）、§5.3（不裁决）、§5.4（strForm 未声明 false→⊥ 的口径统一）、§5.6（memberCls ?? 'unknown'）、§8-13、§9-9、§11 T-o/T-p/T-q | 未声明名在帧级守卫 ② 显式 memo 'unknown'（先于任何 declared 取体——TypeError/无限循环/错分类三路全堵，不依赖 #5 §15.4 兜底）；'unknown' 在 synthesize 主导传播；E304/E309/E306 查询一律不裁决，错误身份由 E301 通道独占；闭环证明：'unknown'/'cycle' 只在必含 E301/E106/E302/终判候选的模块出现 → 无静默 ok:true |
| #3 (HIGH) shapes.ts 分派表缺 generic-diag 行 | ✅ | §5.2（localCls）、§5.3（E304 跳过）、§5.4（strForm 终端 ⊥）、§5.5（pvCheck 跳过）、§5.6（memberCls 'unknown'）、§8-14、§9-10、§11 T-r/T-s | 全部查询显式入表：localCls/memberCls → 'unknown'；E304 检查跳过；strForm 终端 → ⊥；pvCheck 不下降；该节点必产终判候选故永不静默 ok |
| #4 (MEDIUM) E302 多体的 Cls/strForm 取体未定义 | ✅ | §5.2（前置归一：扁平虚拟联合 + synthesize 结合律论证）、§5.4（strForm 多体规则）、§8-10（位置竞争写死）、§11 T-t | Cls = 各体合成（等价于虚拟联合）；strForm = 任一 false→false、否则任一 ⊥→⊥、否则 true；T-t 写死 E302@(2,6) 胜出，前向变体 E306@(1,17) 胜出亦登记——无 SA3 即兴空间 |
| #5 (MEDIUM) E309 检查位集合 vs 规格适用位枚举；pvCheck 键位存疑 | ✅ | §8-15（新增，选项①完整登记）、§5.5（键位仍下降 + 支配性观察）、§5.6（键位联合仍查 + 文义论证）、§11 T-u | 选①：规格文义论证（「适用于…」绑定默认物化表第 5 行多态物化位，非 E309 豁免；E309 适用域 = 同步物化上下文 = PV 补集）+ 单调性论证（语义位读法使报告码随无关声明翻转）；直接键位联合与 PV 内键位引用均被 E306 支配（两个位置/码号证明）；T-u 注册 E309@(1,21) 胜出（锚点经核算勘误） |
| #6 (LOW) 自反对象形缺正例锁 | ✅ | §11 T-v（= SA2 T-S2-10）、§8-1（标注正例锁定）、§5.1（自反正例注记） | `YMap<YMap<{ x: string }>>` → ok: true 入红灯构想 |
| #7 (LOW) §5.2/§13 实测依据不可复跑 | ✅ | §13（第三行定性修订 + R2 重跑数据）、§5.2（实测依据段重写：设计期一次性证据（定性）+ 口径可按伪码逐行重建 + 运行时由 SA7 以 T-l 兑现） | 采纳 SA2 给出的第二方案（标注定性 + T-l 运行面兜底）；另以 R2 期对**终版**算法的重跑更新数字（17 拓扑全对 + 20k 三链 16.6~37.3ms + 递归对照爆栈），不再援引 R1 未存档脚本作为依据 |
| #8 (LOW) §1.2 行为表未涵盖锚点迁移族 | ✅ | §1.2（新行）、§10.3（grep 复核无绿测冲突）、§11 T-w | 「generic-diag 后随 `[]` 族：E100 锚 `[`→`<`（实测 (2,21)→(2,13)；SA2 报告的旧锚 (2,18) 经核算为 (2,21)）」供 SA4 判读；T-w 锁新锚 |

**一致性自检**（R2 轮执行，历史存档；R3 轮自检见上节）：全文检索「未声明」（§5.2/§5.3/§5.4/§5.5/§5.6/§8-13 口径统一为不裁决/'unknown'/⊥——R1 的 strForm→false 已消除）、「灰」（仅 §5.2 定义 + §8-9 引用，不变量单一表述）、「cycle」（§5.1/§5.2/§5.3/§5.6/§8-9 与 synthesize eff 规则无矛盾）、「generic-diag」（§4.1/§4.2/§5.2/§5.4/§5.5/§5.6/§8-14/§9-10 全部为 'unknown'/⊥/跳过，无残留 undefined 比较）、「多体」（§3.3/§5.2/§5.4/§5.5/§8-10 单一口径：并集边 + 虚拟联合合成 + strForm 三段规则）；§5.7 聚合与 §5.2 闭环证明无冲突（不裁决不改变候选池非空性）。

---

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/parser.ts` — 修改：AST +4 节点、parseIdentType 四分支转正（Record/标记/`string & Pattern` 主层识别）、parsePostfixType `[` 解析、`MAX_OBJECT_DEPTH` → `MAX_TYPE_NESTING` 扩口径（§4.6；估算 +130 行 → ~540 行）
- `packages/vfsl/src/shapes.ts` — 新建：cls SCC 解析器（§5.2 R4：迭代 Tarjan + SCC 弹出即求值 + 环 SCC 均匀合成）+ 统一查询助手 clsOf（§5.1 R3）+ E309 桶级扫描（§5.6 R4：六值→规格三分类折叠）+ strForm 两步法（§5.4 R3：cycNames + 名字级 memo + strFormOf）+ containsSync 反向可达 + E304/E306/E307/E309 候选收集（§5；估算 ~380 行——R2 较 R1 +40 行源于守卫与 generic-diag 分派，R3 较 R2 +40 行源于两步法与双查询助手，R4 较 R3 +40 行源于 Tarjan SCC 分解与桶级扫描、灰集机制退役净 -20）
- `packages/vfsl/src/semantic.ts` — 修改：walk 扩展（新节点 ref/E308/E106 边收集 + generic-diag 全位访问，§9-10）、调用 shapes 入池、toIR +4 映射（估算 +75 行 → ~255 行）
- `packages/vfsl/src/ir.ts` — 修改：`VfslType` 追加 `array` / `record` / `marker` / `pattern` 四成员（+4 行，纯加法）
- `packages/vfsl/src/errors.ts` — 修改：ErrCode 注册表 +4 码（E304/E306/E307/E309，+4 行）
- `packages/vfsl/test/parse-vfsl-containers-markers.test.ts` — `[SA6 owned]` 本任务验收红灯（33 条；R2 后如补 §11 T-m~T-y 构想亦在此文件）。SA3 仅可改测试基础设施，不可改断言
- `packages/vfsl/test/parse-vfsl.test.ts`、`parse-vfsl-errors.test.ts`、`parse-vfsl-r3-regression.test.ts` — `[SA6 owned]` #5 交付 37 条绿锁；SA3 不得触碰（零破坏承诺的测试侧护栏）
- `packages/vfsl/package.json` — **仅限 `version` patch 位一行**（0.1.1 → 0.1.2）：MABF HG9（改过代码的模块必须 bump patch）× 总控派发惯例（#5 R3 已确立同款授权先例）。其余字段不在授权内，仍受下方 DENY 约束

**【R2 说明】SA2 八点修订全部落在既有 ALLOW 文件内（shapes.ts/semantic.ts/parser.ts 的 R2 增量已在各条目行数估算中体现），无新增文件、无 DENY 解除——ALLOW/DENY 集合较 R1 零变化，按「只增不删」规则无需扩展。**

**【R3 说明】SA2 R2 三点修订（统一 clsOf / union 行 / strForm 两步法）同样全部落在 shapes.ts 这一条既有 ALLOW 条目内（增量已并入行数估算），无新增文件、无 DENY 解除——ALLOW/DENY 集合较 R2 零变化。**

**【R4 说明】SA2 R3 三点修订（E309 桶级折叠 / computeCls SCC 规范化 / 闭环证明措辞）同样全部落在 shapes.ts 这一条既有 ALLOW 条目内（Tarjan + 桶级扫描增量已并入行数估算），无新增文件、无 DENY 解除——ALLOW/DENY 集合较 R3 零变化。**

**【R5 说明】SA2 R4 两点修订（分量池顶层分解 / §11.4 括注勘误）同样全部落在 shapes.ts 这一条既有 ALLOW 条目内（顶层分解是分量收集的条件收窄，无行数增量）与设计文档自身（§11.4 红灯构想归 `[SA6 owned]` 测试文件的既有条目），无新增文件、无 DENY 解除——ALLOW/DENY 集合较 R4 零变化。**

### DENY LIST

- `packages/vfsl/src/tokenizer.ts` — **零改动**：本任务所需记号（`< > & [ ] ,`、字符串解码、行列基准）#5 已 Day 1 齐备；tokenizer 保持原样是 #5 §4.2 承诺的兑现验证点。若实现中发现词法缺口，回总控走设计修订，不得就地改
- `packages/vfsl/src/index.ts` — 零改动：编排与公共导出面不变（`VfslType` 新成员经 ir.ts 再导出自动生效；`parseVfsl` 签名/行为契约不变）
- `packages/vfsl/package.json` 的结构性字段（`exports` / `dependencies` / `devDependencies` / `scripts` / `name` / `private` / `type`）— 零运行时依赖红线载体，`exports` 直指 `src/index.ts` 维持现状，禁动（HG9 授权仅覆盖 version patch 位，#5 R3「单向豁免」口径延续）
- `docs/vfsl/v1-spec.md` — 冻结规格，任何 SA 不得动
- `packages/vfsl/tsconfig.json`、`tsconfig.base.json`、`vitest.config.ts`、根 `package.json` — 配置已满足任务，禁动
- `pnpm-lock.yaml`、`pnpm-workspace.yaml` — 无新增依赖，禁动
- `wiki/raw/**`、`CONTEXT.md`、`docs/adr/**` — 文档输入，禁动（本设计文档自身除外，其属 SA1 唯一产出）
- `apps/**`、`tests/**`、`.github/**` — 与本任务无关

---

## §13. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计是进程内纯函数库的内部扩展（零运行时依赖、无网络/端口/进程生命周期/跨 job 资源/第三方库行为假设），仅涉及字符串→数据的变换与既有 #5 接缝的载荷扩容。最接近的三项均非协议假设且各有行为依据：

| 项 | 定性 | 依据 |
|---|---|---|
| IR 的 JSON 序列化往返（新增 4 类节点） | JS 语言内建行为 | #5 SA6 `parse-vfsl.test.ts:63-65` 已锚定同款断言且全绿；新节点均为纯 string/子节点载荷（§6 理由 4）；本任务 SA6 红灯 12 条 `expectJsonRoundTrip` 已在红跑中被收集执行（简报 §7.4） |
| vitest include 覆盖新测试文件 | 仓库既有配置 | 根 `vitest.config.ts` include `'packages/*/test/**/*.test.ts'`（#5 设计期读源确认）；本任务红跑实测 70 用例被收集（25 红 / 45 绿） |
| 迭代图查询的栈安全声明（§5.2/§5.4/§5.6）【R2 · SA2 #7：定性修订；R3 · SA2 N3 扩及 strForm；R4 · SA2 M1/M2 扩及 Tarjan 与桶级扫描；R5 · SA2 R4-1 扩及分量池分解口径】 | 实现资源域声明，非外部协议；**设计期一次性证据（定性）** | R2 期（2026-08-19）对 §5.2 终版算法的同构 Node 模拟：17 组对抗拓扑与手推一致、20k 三型深链 16.6~37.3ms 无 RangeError、递归对照 `RangeError: Maximum call stack size exceeded`。**R3 期（同日）合并电池 36 拓扑全过**（SA6 11 锚 + T-m~T-y 回归 + T-R2-1~5 + 未声明/gdiag/多体/环触达角落）；挂起对照：R2 旧 strForm 多体递归同构复现 k=8..16 → 767/3071/12287/49151/196607 步（= 3·2^k−1，严格 ×2/级），R3 两步法 k=40 全管线 124 步 / 1.6ms。**R4 期（同日）对 §5.2 R4（迭代 Tarjan SCC + 完成即求值）+ §5.6 R4（桶级扫描）+ §5.4 R3 的合并电池：50 断言全过**——M1/M2 全部新用例（T-R3-1a~1d、T-R3-2 A/B 同报 E304@(1,10)）+ R3 现状对照复现（T-R3-1a 错拒、T-R3-2 声明序漂移）+ 纯环/自环/多环交叉/环+未声明角落 + **声明序全排列自检（3!=6/6、4!=24/24 cls 表逐名一致）** + 历轮全部拓扑回归（T-m~T-y/T-t/T-u/T-z/T-R2-1~3b/T-q/T-r/T-d/SA6/fixture 族）；规模：20k 裸引用链 ok:true（cls 40,003 步 / ~330ms 线性）、k=40 E302 双体链 cls 83 步 / strForm 124 步 / ~4ms。脚本未随库存档（SA1 唯一产出是本设计文档），**口径可按 §5.1/§5.2/§5.4/§5.6 伪码逐行重建**；**R5 期（同日）增量电池 37 断言全过（容器介导环——R4 电池盲区补齐，SA2 R4-1 点名 P1/P3/P5）：三读法（顶层分解 (a) / 任意深度全收集 (b) / 任意深度 ref+顶层叶 (c)）并列实现 + 全候选池 minBy**——P1：(a)/(c) E106@A@(2,15)、(b) E304@YMap@(1,10)；P3：(a) E106@(2,15)、(b)/(c) E304@(1,10)；P5（取 R4 轮红线 T-R4-4 输入）三读法同值 E304@YLeaf@(1,10)；规格规范自引用示例（`type A = { x: A };` / `type A = { x: A[] };`）三读法同值 E106@A@(1,15)；T-R3-2/T-m/T-x/T-y 回归在 (a) 下与 R4 登记值逐项一致；P1 声明序排列 2!/2 cls 表逐名一致；非环对照 `type C = { x: string \| number };` 三读法同值 'map'（(b) 自相矛盾的实证）**；**运行时栈安全与必终止由 SA7 以 §11 T-l（20k 链）+ §11.3 T-R2-4/T-R2-5（E302 双体深链）+ §11.4 T-R3-2（声明序不变性）/ T-R4-1/T-R4-2（容器介导环）动态兑现** |

---

## §14. 契约改动连锁审计 (Contract Change Caller Audit)

**无既有契约改动**：本设计不修改任何既有函数的签名 / 返回类型 / 抛错行为——`parseVfsl` 的接缝形状、`VfslIssue` 字段、错误码前缀格式、单错误模型、不抛错承诺全部原样。全部产出为**新增**（新 AST/IR 节点种类、新错误码、新内部模块 shapes.ts），属「新增函数/类型微调」豁免类。R2 修订（§5.2 重写等）、R3 修订（§5.1 clsOf / §5.4 两步法等）、R4 修订（§5.2 Tarjan SCC / §5.6 桶级扫描等）与 R5 修订（§5.2 环 SCC 分量池顶层分解钉死）均为 shapes.ts **新建文件内部**的设计变更，不引入新的契约面——R3 强化了「不抛错且必终止」这一既有契约的资源界侧（N3 的挂起路径在求值域层面消灭，§5.4），R4 强化其**确定性**侧（cls 表值与声明序无关，规格 §4 条款由机制兑现，§8-18），R5 把确定性补完到分量分解口径（环/非环同一 notions，容器介导环的裁决唯一化，§8-19）。两处需要 SA4 §1.5 留意的**类型面与行为面事件**（均非契约变更，列表供比对）：

### 类型面：`VfslType` 判别联合追加成员（编译期穷尽性影响）

| 消费方 | 文件:位置 | 影响与处置 |
|---|---|---|
| `toIRType` switch | `packages/vfsl/src/semantic.ts:156`（#5 现状） | TS 穷尽性检查强制新增 4 分支——编译期保证，无遗漏风险 |
| SA6 测试 | `packages/vfsl/test/*.test.ts`（4 文件） | 全部以 `module: unknown` 消费（已读源核对），类型加法零影响 |

（仓库内无其他 `VfslType` 消费方：`git grep -n "VfslType" -- 'packages/**'` 仅 ir.ts 定义 / index.ts 再导出 / semantic.ts 映射；求值器等下游尚不存在。）

### 行为面：#5 已拒绝文本的单向收敛（`ok: false` → `ok: true` / E100 → 专属码）与锚点迁移

| 受影响行为 | 消费方 | 处置 |
|---|---|---|
| 四类构造的 E100「本切片未实现」 | 仅 SA6 测试（无生产消费方；#5 §14 已确认公共面无下游） | 简报约束 3 明示预期（「#5 拒绝的 v1 合法文本转为 ok:true，属单向收敛」）；既有 37 条测试无一断言这些文本（§10.3 核对） |
| **【R2 · SA2 #8】generic-diag 后随 `[]` 族的 E100 锚点迁移（`[`→`<`）** | 仅 SA6 测试（同上） | 同为 ok:false + E100，仅锚点变化（§1.2 行 + §11 T-w 锁定新锚）；#5 三文件 grep 无此族输入（§10.3），零绿测冲突——SA4 行为面对比按 §1.2 判读 |
| `parseVfsl` 不抛错契约 | 全部 caller（4 个测试文件 + 未来引擎层） | 资源界机制随新递归入口同步扩展（§4.6/§5.2），契约不弱化；**R2 强化**：未声明名路径的挂起/崩溃在输入域层面消灭（§5.2 守卫②），设计路径不依赖 #5 §15.4 顶层兜底 |

---

（本文件为 SA1 唯一产出；R5 修订完成——SA2 R4 轮两个攻击点（R4-1/R4-2）已逐条落实并附回应表；R4-1 选案 (a) 顶层分解经设计期三读法并列模拟验证（R5 增量电池 37 断言全过：P1/P3/P5 容器介导环三读法观测面与评审数值逐项一致 + 规格规范示例回归 + 历轮环拓扑回归与 R4 登记值逐项一致 + P1 声明序排列自检），R4-2 括注勘误经脚本核算。交出控制权，等待 SA2 本轮重审。）

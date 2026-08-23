# SA1 设计 — materializeRoot 修订轮 rev2（PR #84 owner Review 闭环：transaction guard + 成功语义定谳）

- Issue: [#74](https://github.com/welltop-jim-wang/nomicore/issues/74)（修订轮 rev2，缺陷修复性质——运行时 guard 缺失导致假成功）
- 分支：fix/issue-74-on-docs-doc-runtime-validation（Worktree: /home/wangjian/nomicore-fix-issue-74；run_id: issue-74-1787396362-3288866；rebase 后基线 origin/docs/doc-runtime-validation = 8a42501）
- 任务简报：`wiki/raw/task_doc-runtime-materialize-root-rev2.md`（owner 反馈 issuecomment-5383810572 + SA6 红灯锚定小节）
- ADR 约束基准：`wiki/raw/task_doc-runtime-materialize-root-rev2_relevant_decisions.md`（SA8 摘录，ADR 0001–0007 全集 accepted）
- 冲突门禁：`wiki/raw/task_doc-runtime-materialize-root-rev2_conflict_report.md`（verdict=clear；**边界红线 W1/W2'/W2/W3/W4 必须遵守**）
- 前序设计基线：初轮 `task_doc-runtime-materialize-root_design.md`（D1–D10 / INV-1~INV-9 / F1–F10 / U1–U13）+ rev1 `task_doc-runtime-materialize-root-rev1_design.md`（RD1–RD6 / INV-10 / F11，对照复用，不重复论证）
- SA6 红灯契约（Phase 1 已落盘）：`packages/doc-runtime/test/materialize-root.test.ts`（T-1 已整块替换为拒绝测试）+ `packages/doc-runtime/test/materialize-root-rev2.test.ts`（Medium ×3 攻击 + 1 正向对照；Minor-1 混合内容；Minor-2 极深树）
- **评审履历**：R1（2026-08-23）SA2 攻击评审 **reject（窄幅）**——RD7 三窗口 guard 架构 / RD8 出口 1 方向 / RD9 / RD10 / RD11 / throw 形态 / E202 家族**全部经受住攻击**；驳回面收敛于 #1（⑥ 比较器对重叠联合假阳性，CRITICAL）+ #2（窗口 B/C 零测试锚定，HIGH）+ #3/#4（窗口 C 谓词收敛、afterAllTransactions 例外登记）+ #5–#10 登记项。**R2 修订逐条落实**（R2 回应表）。R2 复审（同日）**reject（第二轮窄幅）**——R1 十项中 8.5 项合格落实、修订面之外零越权；唯一必修 **F-R2-1**：R2 union 行 any-of「diff 后继续 + 任一 equal 即胜」被**有损成员掩盖**（窄成员掩盖宽成员声明键 / 必填缺席成员掩盖 Record 动态键 / 判别联合经 ref 掩盖成员独有字段——仓内 vfs3.assets 同款 idiom，⑥ 对成员独有字段检测整体失效）+ **F-R2-2** 文本（§3.1 C 行括注与伪代码矛盾，O2 残留）。**R3 修订（本文）采纳 SA2 已十场景验证的「无损锚定 any-of」**（R3 回应表）。R3 复审（同日，跳出循环规则第 3 轮后 meta-judgement：**F-R3-1 判定为设计层比较基准缺陷**，继续 SA1 R4；循环风险已向 Jim 标记）**reject（第三轮窄幅）**——总控交办四项核验点全部合格、修订面外零越权；唯一必修 **F-R3-1**：R3 无损准入以**攻击后的 P** 为判定基准——observer **删除**声明键使 P 缩水（缩水 P 对宽松成员平凡无损 + extract 仲裁漂移），两形态（D1 宽严格联合 delete k / D2 判别联合经 ref delete body 走软拒回退）实测假阴性。**R4 修订（本文）采纳 SA2 十五场景已验证的方案 b「对称重物化」**（extract(real) ≡ extract(scratch)；三值 cmp/无损谓词整体退役；R4 回应表），评审全文：`wiki/raw/task_doc-runtime-materialize-root-rev2_sa2_review.md`（R1 含 E1–E6，R2 节十场景，R3 节十五场景 + 三 nit）
- 设计期实测：R1 轮 3 组（yjs 事务窗口三态 / window-B 假成功复现 / yjs 类型面核实）；R2 轮 2 组（E4 重叠联合独立复现 + 比较器仿真——scratch 未解析 ref，证据保真度缺口，已修复）；R3 轮 2 组（忠实仿真含 ref 解析 + 无损锚定判据十一场景——该判据后被 F-R3-1 击穿，留作演进史证据）；**R4 轮新增 1 组**（方案 b 忠实仿真含 ref 解析——**十七场景全对**（诚实 10 equal / 攻击 7 diff，含 D1/D2 删除与插入翻转），超出 SA2 十五场景（补 D1/D2 诚实对照）；§9.5 内联）。SA2 独立实测 E1–E6 / R2 十场景 / R3 十五场景另计并在 §9 引用

---

## 摘要（一页看懂）

本轮修 owner Review 三项缺口。**P1**：materializeRoot 的「最外层事务」前置条件从 JSDoc 声明升格为
**运行时 guard（RD7）**——函数入口第一句、先于 ①②③④ 一切读写、在任何 try/catch 之外，检测 yjs
内部事务状态的两个窗口（A：`doc._transaction !== null` 外层 transact 未闭合；B：
`doc._transactionCleanups.length > 0` 事务 cleanup/observer 派发中——**实测 window B 同样产生
`ok:true` 假成功**，只查 `_transaction` 会漏；**R2/#4**：`afterAllTransactions` 回调为明文安全例外
——此时队列已重置 `[]`，该窗口内新开 transact 自含完整 cleanup 生命周期（SA2 E2b 实测），⑤⑥ 检测
面有效，放行正确），检测到即 **throw `DOCRT-E202`**（新增错误码；W1 澄清下写入前触发、throw 与
ok:false 两形态均相容，定稿 throw §3.5），本函数零写入。检测形态异常 → 同码变体 C **fail-closed**。
rev1 SA2「不采用 `_transaction` guard」定谳由 owner Review 显式推翻（§3.3，T-1 预登记更新路径即本轮）。

**Medium**：成功语义定谳为**出口 1——完整逻辑快照语义校验（RD8）**。新增阶段 ⑥
`verifySnapshotIntact`：⑤ 顶层身份校验通过后、`return {ok:true}` 前，用同包公共读入口
`extractYjsSnapshot` 读回整树，与输入快照做 **schema-parallel 三值投影比较**（XML 叶子经共享扫描器
canonical 语义归一化——W3），偏离 → **throw `DOCRT-E201`**（变体 C）、校验未能运行 → 变体 D。
`ok:true` 语义升级为 INV-11。**R2/#1（CRITICAL）修订**：原「键集相等」比较基准对**重叠联合**
（ADR-0003 明文合法）假阳性——② build 成员试验拒未声明键（F7）而 extract 忽略未声明键（D4），
两侧仲裁不对称使诚实路径读回投影 ≠ 原始输入（C1/C2/C3 三形态，SA2 E4 + SA1 §9.3 双独立复现）。
修订为**按成员投影的 any-of 比较**（封闭 map 成员只比声明字段、Record 全键）。R3 再修订为**无损锚定
any-of**（equal 仲裁须成员对读回投影无损——闭合 R2 三掩盖形态的值攻击假阴性）。**R4/F-R3-1（CRITICAL）
终版定稿：对称重物化**——R3 的无损准入以**攻击后的 P** 为基准，observer **删除**声明键使 P 缩水
（缩水 P 对宽松成员平凡无损 + extract 仲裁漂移到另一成员），两形态（D1 宽严格联合 delete k / D2
判别联合经 ref delete body 走软拒回退）实测假阴性——三轮缺陷（R1 假阳性 / R2 值攻击掩盖 / R3 删除
攻击放宽）同根于**在单侧锚上做联合仲裁推理**。⑥ 定稿为 **`extract(real) ≡ extract(scratch)`**：
scratch = 同一输入经同一物化管线（② 同款构造 + ④ 同款单事务安装）装入一次性 `new Y.Doc()`（零
observer、事务后即弃），对两个 doc 各跑公共 `extractYjsSnapshot` 后做**同管线产物比较**（全键集 +
逐元素 + XML canonical——W3；三值 cmp / 无损谓词整体退役，规格净简化）。仲裁在两侧构造性一致，
值改/删除/插入翻转类攻击整体绝迹——SA2 十五场景 + SA1 §9.5 十七场景双验证全对（诚实 10 equal /
攻击 7 diff）。
检测面边界如实定稿：INV-11 = **extract 投影等价**（对 extract 输出无影响的修改不在检测面——继承自
extract 既定语义，§4.4 明文）。出口 2 被否决（§4.1）；出口 1 **零 ADR 触碰**（对称重物化是出口 1
内的实现机制替换，非方向变更）。

**Minor-1（RD9）**：CDATA/PI/comment 的 lexical-token 定性以 JSDoc 措辞落文（载体特征 +
characterization 锁定，**不升格公共逐字 round-trip 承诺**——W2），零行为改动。**Minor-2（RD10）**：
确认 SA6 的 20_000 层极深树方案充分，**不引入受控 seam**。**版本（RD11）**：package.json
0.1.4 → 0.1.5。**R2/#2**：窗口 B/C 测试锚定补齐——RT-2（窗口 B 拒绝 + afterAllTransactions 安全
对照组）/ RT-3（窗口 C fail-closed ×3）测试规格落 §7.1，与 RT-1（重叠联合正/负）一并交付总控派
SA6 落地；**R3** 补 RT-1.5（三掩盖形态负对照 + 诚实对照）；**R2/#3**：窗口 C 谓词收敛为与 §3.4
伪代码逐分支等价的 fall-through 单一口径（R3/F-R2-2 修正 C 行括注残留）；**R2/#5–#10**：E202-B
消息补 wedge 诊断分支、三变体「doc 零写入」改「本函数零写入」、R-1 措辞
如实化、R-7 残余登记等（R2 回应表）。

### 决策总表（ev2 决策 RD7–RD11；初轮 D1–D10 与 rev1 RD1–RD6 基线全部维持，唯 rev1 R-7 处置按 §3.3 显式演进）

| # | 决策 | 一句话理由 | 依据 |
|---|---|---|---|
| **RD7** | P1 = ⓪ 运行时 transaction guard：机制选 **(a) yjs 内部字段检测**（`_transaction` 窗口 A + `_transactionCleanups` 窗口 B + 不可判定 fail-closed 窗口 C——R2/#3 收敛为 fall-through 单一口径），触发点 = `materializeRoot` 函数体第一句（prepare 之前、一切 try/catch 之外），形态 = **throw `DOCRT-E202`**（三变体消息 §3.4，R2/#5/#8 修订措辞），本函数零写入 | 只查 `_transaction` 漏 window B（实测假成功复现 §9.2）；机制 (b) 在 W4 下无法对裸 `Y.Doc` 入口成立（§3.2）；W1 澄清两形态相容、throw 与 E201「fatal 家族」纪律同构（§3.5）；rev1 SA2 定谳被 owner Review 显式推翻（§3.3）；afterAllTransactions 安全例外登记（R2/#4） | 简报 P1；W1/W4；SA8 重点裁决一；§9.1/§9.2 实测 + SA2 E1/E2b/E3/E6 |
| **RD8** | Medium = **出口 1**：新增 ⑥ `verifySnapshotIntact`——**R4/F-R3-1 定稿：对称重物化比较**（extract(real) ≡ extract(scratch)，scratch = 同一输入经同一管线装入一次性 doc、零 observer；三值 cmp/无损谓词退役），偏离 → throw `DOCRT-E201` 变体 C / 构造或比较异常 → 变体 D（触发类④ scratch 构造异常）；⑤ 顶层身份校验保留为前置；`ok:true` 语义升级 INV-11（**管线产物投影等价**）；XML 面复用 xml-parse.ts 共享扫描器 canonical 归一 | 保证面完整且落地面存在；**比较基准必须两侧构造性对称**——单侧锚（原始输入 / 攻击后 P）在联合仲裁下三轮被击穿（R1 假阳性 SA2 E4 / R2 值攻击掩盖 F-R2-1 / R3 删除攻击放宽 F-R3-1——根因同源）；对称重物化使仲裁漂移类攻击构造性绝迹（SA2 十五场景 + SA1 §9.5 十七场景双验证全对）；零 ADR 触碰；成本 = 成功路径 +1 次构造安装 +1 次提取 + 简单比较（create-time 入口可承受） | 简报 Medium；SA8 重点裁决二；W1/W3；SA6 Medium ×3；SA2 #1/#6/#9 + F-R2-1 + F-R3-1 |
| **RD9** | Minor-1 = JSDoc/公共契约措辞：CDATA/PI/comment 为 raw `Y.XmlText` 逐字 span 的 **lexical-token 载体特征**（characterization 锁定），公共承诺面维持 ADR-0007 语义等价 round-trip | ADR-0003 opaque 终态节点立场的显性化；W2 禁升格逐字承诺；现行为已达标（SA6 Minor-1 绿），零代码改动 | 简报 Minor；W2；SA8 重点裁决三 |
| **RD10** | Minor-2 = 确认极深树（20_000 层）方案充分，**不加受控 seam** | 确定性触发已达成（② 装配溢出 → E200 + 0 update + state 不变，SA6 绿）；seam = 生产代码测试后门，反模式 | 简报 Minor；ADR-0007 零写入条款；SA6 Minor-2；SA2 攻击面 6 通过 |
| **RD11** | `packages/doc-runtime/package.json` version 0.1.4 → 0.1.5；materialize.ts/index.ts JSDoc 契约同步（guard、INV-11 投影语义、lexical-token 措辞） | 简报发布要求第 4 项；行为硬化 + 文档澄清，无 API 签名变更 → patch；仓内先例 0.1.1→0.1.4 均 patch 推进 | 简报；git log 包版本惯例 |

不变式清单（全文引用锚；INV-1~INV-9 见初轮、INV-10 见 rev1，除下述升级外零改动）：

- **INV-10（顶层安装完整性，rev1，语义保留）**：⑤ 双断言（size + 逐键身份同一性）偏离 → throw
  DOCRT-E201（变体 A/B 消息不变）。**时点前提由「JSDoc 契约 + characterization」升格为「⓪ 运行时
  guard 兑现」**（RD7）——INV-10 的成立域从「诚实调用方」扩展为「全部调用方」。
- **INV-11（逻辑快照投影完整性，本轮新增；R2 投影语义 → R3 无损限定 → **R4/F-R3-1 终版措辞**）**：
  ⑥ 在 ⑤ 通过后、`return {ok:true}` 前执行**对称重物化校验**：把同一输入经同一物化管线（② 同款
  构造 + ④ 同款单事务安装）装入一次性 scratch doc（零 observer），双侧各跑
  `extractYjsSnapshot`，做同管线产物比较（全键集 + 逐元素 + XML canonical——W3）；**相等方准
  `ok:true`**（即：返回时 `extract(doc)` 与同一输入经同一管线的未修改安装读回投影语义等价）；不等
  → throw DOCRT-E201（变体 C）；scratch 构造/提取/比较异常 → throw DOCRT-E201（变体 D 触发类④，
  消息明示「不代表已检测到偏离」）。**检测面 = extract 输出**：对 extract 读回无影响的 doc 修改
  （D4 投影外键）不在检测面——该边界继承自 extract 公共读入口的既定投影语义（ADR-0007 冻结），
  R1–R4 四版判据同宽；投影外的修改由 ADR-0007 observer 纪律治理。**契约时点 = 本函数返回时**；
  返回后的异步修改不在承诺面（rev1 相同时点边界，明文保留）。

---

## §1. 背景与问题解剖

### 1.1 owner P1：活动外层 transaction 内调用的假成功链

现行实现（`materialize.ts:73-85`）只有 JSDoc 前置条件（`:54-57`），无运行时检测。调用方在未闭合
`doc.transact` 内调用时的失败链（简报原文 6 步）：

1. materializeRoot 内部 `doc.transact` **并入外层事务**（yjs 嵌套 transact 归并——`_transaction`
   指针不变，不产生新事务，实证 §9.1 场景 2b）；
2. observer/update cleanup **尚未发生**（挂在外层事务的 cleanup 队列上）；
3. ⑤ `verifyInstall` 在 observer 执行前运行 → **空转通过**；
4. 函数返回 `{ok:true}`；
5. 外层事务结束后 observer 才删改 ROOT；
6. INV-10 成功保证与 DOCRT-E201 检测面**全部失效**——「返回成功但文档（将）腐蚀」。

SA6 红灯实证（简报表）：同场景 `{"result":{"ok":true},"events":3,"stateChanged":true,
"keys":["count","extra"]}`。

### 1.2 设计期新发现：window B（cleanup/observer 派发窗口）是同构的第二漏洞

owner 简报与 rev1 R-7 只描述了 window A（外层 transact 未闭合）。本轮设计期实测发现**第二个
产生同款假成功的窗口**（§9.2，命令与输出全文内联）：

在**事务 cleanup/observer 派发期间**（即事务事件回调内——此时 `doc._transaction === null`，
但 `doc._transactionCleanups.length > 0`）调用 materializeRoot：

```
"OTHER-obs enter cleanups=1",                                 ← observer 窗口：tx=null, cleanups=1
"OTHER-obs materialize returned ok=true keys=[\"title\",\"count\"]",  ← 假成功返回
"ROOT-obs round1 keys=[\"title\",\"count\"] cleanups=2",       ← ROOT observer 在返回后才派发
"ROOT-obs attack done keys=[\"count\",\"extra\"]",             ← 偏离落地，无 E201
result.ok=true ... final ROOT keys=[\"count\",\"extra\"]       ← 调用方被告知成功
```

机理：cleanup 窗口内新开的 transact 会作为**新事务追加进 cleanup 队列**（cleanups 1→2），其
observer 在 materializeRoot 返回后才派发——⑤⑥ 检测面同样空转。**只检测 `_transaction !== null`
的 guard 修不住这个窗口**。guard 必须同时覆盖两个窗口（RD7 检测谓词 §3.4）。

SA2 逐事件探针（评审 E1）进一步确认覆盖完备性：yjs@13.6.32 全部事务生命周期事件中，
`beforeAllTransactions`/`beforeTransaction` 落窗口 A，`afterTransaction`/`afterTransactionCleanup`/
`update`/`updateV2`/`subdocs` 落窗口 B，**唯一例外 `afterAllTransactions`**（队列已重置，见 §3.1
R2/#4 例外条款）——未发现第四个假成功窗口。

### 1.3 Medium：⑤ 的顶层检测面盲区（与 R2/#1 的比较器缺口）

⑤ 只断言 ROOT 顶层 size + 逐键身份同一性（`===`）。同步 observer 保持顶层引用不变、仅原地修改
已安装子树（`u.set('n', 2)` / `tags.insert(1,['z'])` / `body.insert`）→ ⑤ 通过 → `ok:true`，但
logical snapshot 已偏离输入（SA6 Medium ×3 红灯实证）。

**R2/#1 补充（CRITICAL）**：⑥ 若按 R1 的「原始输入 vs 读回」键集相等基准比较，则在**零 observer
的诚实路径**上对重叠联合（ADR-0003 明文「重叠成员不构成错误」）假阳性——② build 的成员试验对
未声明键**拒绝**（mapEntries F7「拒绝静默丢键」），extract 的成员试验对未声明键**忽略**（D4
「未知键不报不进快照」）：build 选中**后**成员（全量安装）、extract 选中**前**成员（窄投影丢键），
`extractYjsSnapshot(doc) ≠ input` 在无任何 observer 时即成立（SA2 E4 + SA1 §9.3 双独立复现，
C1/C2/C3 三形态）。⑥ 语义与比较器基准按 §4.2 修订为**按成员投影比较**。

### 1.4 Minor-1 / Minor-2 现状

- Minor-1：CDATA/PI/comment 以 raw `Y.XmlText` 逐字 span 承载（`xml-parse.ts` 规则 2 已实现），
  行为正确、SA6 混合内容 round-trip 绿——缺口是**公共契约措辞**（简报：「请明确这是
  lexical-token round-trip 而非结构化 XML 节点语义」）。
- Minor-2：构造失败矩阵（RD2/C-1~C-8）未确定性覆盖「detached XML/Yjs assembly 抛异常 → E200 →
  仍零写入」。SA6 已用 20_000 层极深树补上（绿：ok:false + E200 单 issue + 0 update + state 不变；
  标定：② 装配溢出点 ~10_000，④ 安装溢出点 <2_000，取 20_000 留 2× 余量）。SA2 攻击面 6 独立
  复核通过（栈溢出点环境方差只影响「② 是否更早溢出」——仍 E200 仍绿）。

---

## §2. 现行实现锚定（改动基线）

`materialize.ts` 现行编排（rev1 定稿）：`materializeRoot` = `prepare(①②③)` → ④ 单事务安装 →
⑤ `verifyInstall` → `return {ok:true}`；`prepare` 是唯一 try/catch（意外异常 → E200 单 issue
ok:false）；④⑤ 无 try/catch（INV-5：observer 抛错原样传播）。错误身份现状：DOCRT-E200
（①②③ 崩溃边界，ok:false）/ DOCRT-E201（⑤ 写后偏离，throw，消息变体 A=size / B=identity）/
DOCRT-E100（extract 崩溃边界——本包另一入口）。本轮在既有骨架上**只增不改既有语义**：新增 ⓪ 与
⑥ 两个阶段 + E202 一个新错误码 + E201 两个新消息变体。

---

## §3. RD7 —— P1 运行时 transaction guard

### 3.1 检测目标与覆盖面（三窗口模型；R2/#3/#4 修订）

| 窗口 | 谓词（yjs@13.6.32；与 §3.4 伪代码**逐分支等价**——R2/#3 收敛为单一口径） | 语境 | 危害 | 处置 |
|---|---|---|---|---|
| **A：外层 transact 未闭合** | `doc._transaction !== null && doc._transaction !== undefined`（truthy 即命中——含 truthy 垃圾值，消息事实性宣称「`doc._transaction` 非空」为真） | 调用点在某 `doc.transact(f)` 的 `f` 体内（含任意嵌套层——嵌套不新建事务），或 `beforeAllTransactions`/`beforeTransaction` 回调内（SA2 E1） | 内部事务并入外层；observer 延迟至外层 cleanup；⑤⑥ 空转（owner P1 原文场景） | throw E202 变体 A |
| **B：cleanup/observer 派发中** | `Array.isArray(doc._transactionCleanups) && doc._transactionCleanups.length > 0`（在 A 检查之后） | 调用点在 `afterTransaction` / `afterTransactionCleanup` / `update` / `updateV2` / `subdocs` 等回调或任一 type observer 回调内（SA2 E1 逐事件实测）。**明文排除：`afterAllTransactions` 回调**——此时 `_transactionCleanups` 已重置 `[]`（`Transaction.js:391-393` 先重置再 emit，SA2 E1 实测 `{"tx":"null","cl":0}`），该窗口内新开 transact **自含完整事务生命周期**（其实例 observer 在 transact 返回前派发完毕——SA2 E2b 实测 `["ROOT-obs","INNER-obs","aat:inner-transact-returned"]`），⑤⑥ 检测面有效，**放行是正确行为而非漏判** | 安装事务追加进 cleanup 队列，其 observer 在本函数返回后才派发；⑤⑥ 空转（§9.2 实证复现） | throw E202 变体 B |
| **C：不可判定（fail-closed）** | **剩余全部形态**（fall-through 定义，无独立前置谓词；R3/F-R2-2 修正括注）：`tx === undefined` **且 B 未命中**（`cleanups` 非 Array 或为空数组——字段缺失/改名漂移于干净语境/手造 stub），或 `tx === null && cleanups` 非 Array | yjs 版本漂移 / 手造 `Y.Doc` stub | guard 失去判定基础 | throw E202 变体 C |

**R2/#3 收敛说明**：R1 版窗口 C 行曾写「`_transaction` 非 null 非 Transaction 形态」——与伪代码
（无形态嗅探）在两处分歧（`tx===undefined`+非空队列；truthy 垃圾 tx）。R2 定稿**保留无形态检查的
伪代码、窗口 C 收敛为 fall-through 定义**（SA2 推荐项 a），并删去「Transaction 形态」字样：guard
是**只读布尔谓词，不做 Transaction 形态嗅探**（§3.2 缓解④）。两个残余形态的定性与可辩护性：
① truthy 垃圾 tx → 按 **A** 报（消息宣称「`doc._transaction` 非空」事实为真）；② `tx === undefined`
+ 非空 Array 队列 → 按 **B** 报（消息宣称「`_transactionCleanups` 非空」事实为真；真实 yjs doc 上
该状态即真实窗口 B——若因单字段改名漂移而至，调用方确在回调内，整改指引正确；仅手造 stub 会收到
偏移指引，属可接受残余，登记于 R-1）。真实漂移形态（单字段改名于顶层调用时：`tx undefined +
cleanups=[]` 或 `tx null + cleanups undefined`）均正确落入 C（SA2 #3 推演）。

**不覆盖面（明文）**：guard 是**写路径（materializeRoot）专属**前置条件检查。`extractYjsSnapshot` /
`readLogicalValueAtPath` 为只读入口，在事务/observer 内调用**合法**（observer 读快照是正常用法），
不加 guard——scope 纪律。子 doc（subdoc）场景：materializeRoot 只治理传入 `doc` 自身的事务状态；
父 doc 的事务不属于本谓词判定面（yjs 子 doc 有独立事务状态，依据 §9 协议表源码行）。嵌套
`afterAllTransactions` 的调用方自递归 transact 风险归调用方（yjs 既定行为，非本函数面）。

### 3.2 机制选型：(a) yjs 内部字段检测 —— 定稿；(b) Runtime 包装层 —— 否决

**选 (a)**。六维对照：

| 维度 | (a) yjs 内部字段检测 | (b) Runtime 包装层 transaction context |
|---|---|---|
| **覆盖完备性** | 引擎级真相：任何来源（裸 `doc.transact`、observer 回调、未来 Runtime、第三方 provider）的活动事务都被看见 | 只能看见**经包装入口**的事务；裸 `doc.transact()`（yjs 公共 API，谁都能调）对记账层不可见 → guard 退化为咨询性（advisory），非强制 |
| **W4 分层合规** | 天然合规：guard 完全位于 doc-runtime 包内，零新依赖（yjs 已是直接依赖） | Runtime → doc-runtime 依赖方向不可倒置（W4）；context 只能放 doc-runtime（模块级 WeakSet/计数器）——但 doc-runtime 无从知道谁在裸调 `doc.transact`，记账必须靠调用方自觉调 enter/exit API → 新增公共 API 面 + 遗忘即失效 |
| **公共入口保证力** | `materializeRoot(derived, snapshot, doc)` 接受裸 `Y.Doc`——(a) 对任意传入 doc 都能判定 | (b) 只对「被记过账的 doc」有保证；简报原文要求「保证该公共入口不可在活动 transaction 中调用」，裸 `Y.Doc` 参数使记账方案**原理上无法闭环** |
| **落地时点** | 即刻成立 | 仓内**尚无 NamespaceRuntime 包**（relevant_decisions 实证：「该层是 ADR 预留的将来层」）——(b) 要么现在就在 doc-runtime 造投机性脚手架，要么等 Runtime 落地才兑现（保证洞开到未来） |
| **耦合风险** | 读取 yjs 私有（下划线约定）字段——**已缓解**：① 版本锚定 `^13.6.30`（约束安装面；**对私有字段的实际保护 = 窗口 C fail-closed + 测试锁定，非 semver 承诺**——R2/#10 如实化措辞）；② 类型面公开（`dist/src/utils/Doc.d.ts:49/53` 声明 `_transaction: Transaction \| null` / `_transactionCleanups: Array<Transaction>`，非 `any` 强转）；③ 窗口 C fail-closed（漂移 → E202-C loud，失败方向安全）；④ **只读布尔谓词、属性读取、无 `instanceof` 类身份依赖、不依赖内部结构细节**——对双 yjs 实例加载形态免疫（SA2 E6 实测：双路径 import 会击穿 `instanceof` 使包内 `carrierOf` 误报，而属性读取不受影响——R2/#10 补充）；⑤ P1 拒绝测试 + RT-2/RT-3（R2/#2 补齐）锁行为——漂移即 CI 红 | 无 yjs 耦合，但把保证力押在「所有写入方都走包装」这个**未被强制的前提**上——与 owner 修的 bug 同构（前提未被运行时兑现） |
| **成本** | 每次调用 2 次属性读 | 新公共 API + 包装层组合逻辑 + 文档义务 |

**结论**：(b) 的保证力在裸 `Y.Doc` 入口面前**原理性不足**，且其完整形态依赖尚不存在的 Runtime 层；
(a) 以受控、fail-closed 的耦合换取引擎级完备覆盖——这正是 owner「优先运行时响亮拒绝」的意图。
ADR 层面两机制均无条款障碍（SA8 重点裁决一第 5 点），(a) 不触碰 W4（不 import Runtime、不新增
第二物化入口）。

### 3.3 rev1「不采用 `_transaction` guard」定谳的显式演进

rev1 R-7 行明文：「不采用读 `doc._transaction` 的运行时 guard（SA2 #1 定谳：私有 API 耦合，风险
大于收益；文档化前提 + 边界 characterization 测试 T-1 即 W1 相容的诚实形态）」。**本轮推翻该权衡，
依据与程序**：

1. **权威升级**：rev1 定谳是 SA2 在「owner 未表态」前提下的评审权衡；rev2 owner Review 明文要求
   「优先运行时响亮拒绝……不能只依赖 JSDoc」——owner 反馈是更高权威，且 JSDoc-only 方案已被
   实证击穿（SA6 P1 红灯 + §9.2 window-B 复现）。
2. **预登记的更新路径**：rev1 T-1 characterization 用例自带触发条款——「**若未来实现改为
   loud-guard 或检测到该场景，本用例须随设计同步更新**——边界变化必须走设计评审」。SA6 已按
   简报把 T-1 整块替换为拒绝测试——正是该条款的兑现，非静默漂移。
3. **风险已被缓解到可承受**（§3.2 耦合行五点）：rev1 定谳时「风险大于收益」的收益侧此后被 owner
   显式定价（契约健壮性），风险侧由 fail-closed + 类型化访问 + 版本锚定 + 测试锁定（R2 后含 B/C
   窗口锚定）压低。
4. **演进不改判任何 ADR 条款**：guard 是 ADR-0007「一次 `Y.transact` 安装」前提的运行时兑付
   （SA8 重点裁决一第 2 点），无 evolution、无 override。

### 3.4 guard 规格（精确；伪代码经 R2/#3 确认为唯一规范锚）

**触发点**：`materializeRoot` 函数体**第一句**——先于 `prepare(①②③)`（即先于一切校验/构造/探针
读），**不在任何 try/catch 内**（绝不落入 E200 崩溃边界被收敛成 ok:false）。precedence 定谳：
语境违规 > 一切数据域失败——活动事务语境下调用方连「数据是否合法」都不该得到回答（语境本身是
编程错误）；SA6 P1 用例的快照合法，两序在该用例无分歧。

**伪代码（唯一规范锚；§3.1 表格与之逐分支等价）**：

```ts
/** ⓪ 活动 transaction 语境 guard（rev2 RD7 / P1）。调用契约：materializeRoot 第一句，
 * 任何 try/catch 之外。窗口模型与字段依据见设计 §3.1/§3.4/§9（yjs@13.6.32 源码 + 实测）。
 * R2/#3 定稿：只读布尔谓词，无 Transaction 形态嗅探；窗口 C 为 fall-through。 */
function assertOutermostTransactionContext(doc: Y.Doc): void {
  // yjs 类型面公开声明（dist/src/utils/Doc.d.ts:49/53）：
  //   _transaction: Transaction | null          —— null = 无未闭合 transact（嵌套归并，指针不变）
  //   _transactionCleanups: Array<Transaction>   —— cleanup 队列（observer 派发窗口非空；链尾重置 []）
  const tx = doc._transaction;
  const cleanups = doc._transactionCleanups;
  if (tx !== null && tx !== undefined) {
    throw new Error(E202_MSG_A);            // 窗口 A：外层 transact 未闭合（truthy 即命中）
  }
  if (Array.isArray(cleanups)) {
    if (cleanups.length > 0) throw new Error(E202_MSG_B);  // 窗口 B：cleanup/observer 派发中
    if (tx === null) return;                // 干净语境：tx===null 且队列空 —— 唯一放行口
  }
  throw new Error(E202_MSG_C);              // 窗口 C（fall-through）：tx undefined / cleanups 非 Array → fail-closed
}
```

**错误消息定稿（DOCRT-E202，三变体，全文逐字；R2/#5/#8 修订——「本函数零写入」措辞 + B 变体
wedge 诊断分支）**：

```
E202_MSG_A:
DOCRT-E202: 在未闭合的外层 doc.transact 内调用 materializeRoot（运行时检测：doc._transaction
非空）——内部事务将并入外层、observer 延迟至外层 cleanup，成功保证与 DOCRT-E201 检测面失效；已在
任何写入前拒绝，本函数零写入（doc 状态不因本调用改变）。请将调用移出外层事务回调后重试

E202_MSG_B:
DOCRT-E202: 在 Yjs 事务 cleanup/observer 派发期间调用 materializeRoot（运行时检测：
doc._transactionCleanups 非空）——本函数安装事务的 observer 将延迟派发，成功保证与 DOCRT-E201
检测面失效；已在任何写入前拒绝，本函数零写入（doc 状态不因本调用改变）。请勿在 observer/事务事件
回调内调用，移至事务外重试；若调用点确不在任何回调内：该 doc 的事务 cleanup 队列异常残留（此前
update/afterTransactionCleanup 等回调抛异常所致），事务派发机制已损坏——请勿继续复用该 doc 实例

E202_MSG_C:
DOCRT-E202: 无法确认 doc 的事务状态（yjs 内部字段 _transaction/_transactionCleanups 缺失或形态
异常，疑似 yjs 版本漂移或非 genuine Y.Doc）——按活动事务处置，已在任何写入前拒绝，本函数零写入
（doc 状态不因本调用改变）。请核对 @nomicore/doc-runtime 声明的 yjs 版本兼容性（^13.6.30）
```

（实现中为单行字符串常量；三变体均以 `DOCRT-E202:` 起头——T-1 占位断言 `/DOCRT-/` 命中，定稿后
按 R2 建议收紧为 `/DOCRT-E202/`（§7.1 RT-6）。B 变体末句诊断分支依据 SA2 E3 wedge 实测（§8 R-7）：
update 回调抛异常会使 cleanup 队列永久卡死（`finally` 块内抛出、排空尾部代码不执行），此后无辜
顶层调用永吃 E202-B——fail-closed 方向可辩护（doc 派发机制已死、update 永不发 = 持久化黑洞，
拒绝写入是安全侧），缺陷仅在诊断误导，以消息分支补齐。）

**零写入论证**：guard 先于 ①②③④ 一切 doc 触碰（含 `probeRoot` 的惰性 getMap），throw 时本函数
未对 doc 做任何变更、0 update 事件、ROOT 保持原状——SA6 P1 用例断言面（0 update / state+vector
字节不变 / ROOT 空置 / observer 未触发）全部成立（§7 对齐表）。

**错误码衔接**：E100=extract 崩溃边界（既有）、E200=materialize ①②③ 崩溃边界（既有）、
E201=写后偏离 fatal 家族（既有，本轮增变体）、**E202=transaction 语境拒绝（本轮新增，写前 throw）**。
编号单调、语义互斥：E202 属「调用语境违规」类（caller programming error），与 E201 同走 throw 通道
但发生在写前（W1 澄清的两相容形态中选 throw，论证 §3.5）。

### 3.5 拒绝形态定稿：throw（否决 {ok:false, issues}）——R1 定稿经 SA2 攻击后维持

W1 澄清下两形态均合规，定稿 **throw**，五点论证：

1. **错误类别归属**：`{ok:false, issues}` 通道在 materializeRoot 契约中承载**数据域失败**
   （① 逻辑校验 issues / ②③ 构造 fail-fast / E200 崩溃边界）——输入数据问题，调用方可报告、可修数据。
   语境违规是**调用方编程错误**（precondition violation），与 E201「Runtime internal/fatal」同类；
   把编程错误装进数据域返回值会诱导调用方写出「重试/降级」业务分支——而语境违规是确定性的，重试
   必然再撞同一 guard，正确修复只有一种：把调用点移出事务（E202 消息末句明示）。
2. **与 E201 家族同构**：rev1 已确立「fatal 家族 = throw、绝不 ok:false」的纪律（W1）；guard 违规
   与写后偏离同属「契约破坏、无法以数据修复」类，形态一致降低调用方心智模型成本。
3. **可见性**：throw 携带栈轨迹直指事务内调用点；ok:false 可能被泛化 issue 处理吞掉——与「响亮
   拒绝」的 owner 措辞强度匹配的是 throw。
4. **测试占位两态相容**：SA6 P1 用例已写成 throw/返回两支自适应；定稿 throw 后占位断言原样成立。
5. **ADR 一致性**：ADR-0007 mutation 条款「成功只返回 `{ok:true}`」——被拒调用不在成功出口面；
   「验证或构造失败时目标 doc 零写入」以 doc 未变成立；无任何条款要求语境拒绝走返回值。

---

## §4. RD8 —— Medium 成功语义：出口 1（完整逻辑快照投影校验）

### 4.1 出口 1 vs 出口 2 选型论证（R1 定稿经 SA2 攻击后维持）

| 维度 | 出口 1：完整语义校验（定稿） | 出口 2：顶层 keyset+identity 有限保证 |
|---|---|---|
| **保证面** | `ok:true` ⟹ 返回时完整 logical snapshot 的 extract 投影与输入投影语义等价（INV-11）——owner 识别的假成功洞**当下关闭** | `ok:true` ⟹ 仅顶层 keyset+identity；嵌套偏离仍可发生——洞被**文档化**而非关闭 |
| **与反虚假降级立法** | 检测即响亮（E201-C） | 「返回成功但快照可能已偏」靠文档声明豁免——rev1 §2.1 已裁定同类「出口 B」是把腐蚀制度化，本仓立法禁止 |
| **落地层** | 全部落在 doc-runtime 现有文件（⑥ + 比较器）——**即刻生效** | 三腿之一「Runtime 禁止 observer/业务方取得可写子树引用」需 Runtime 层执行——**仓内无此包**（ADR-0007 预留将来层），保证洞开到 NamespaceRuntime 落地 |
| **ADR 触碰** | **零**（未定义空间的收紧式补全；方向只在 INV-10 之上收紧——SA8 裁决二第 4 点明文允许） | 「在 ADR 中明确」须走 W2' owner 带日期修订节（SA1 只能提案、Jim 签认入文）——流程延迟 + 结果不确定 |
| **成本** | 成功路径 +1 次 extract 读回 +1 次 schema-parallel 投影比较（O(doc size)，create-time API 非热路径） | 近零运行时成本，但欠下 Runtime 层实现债 + ADR 治理流程债 |
| **SA6 测试对齐** | Medium ×3 攻击用例按 `/DOCRT-E201/` 断言**原样成立**（§7）；正向对照绿 | 需把 3 个攻击用例改写为 characterization——把攻击向量重新合法化 |

**裁决**：出口 1。出口 2 的「省成本」以「保证降级 + 洞延期」为代价，与本仓 loud-fail 文化、owner
「明确并**测试** observer 对嵌套子树的就地修改边界」的措辞相悖。出口 1 不触碰 W2'（零 ADR 修订）。

**出口 2 中仍有价值的成分，本轮一并落位**：
- 「公共 API 明确」→ materialize.ts/index.ts JSDoc 更新为 INV-11 投影等价承诺 + 检测基准与
  不覆盖面明文（§4.4，R2/#9 修订）。
- 「Runtime 禁止取得可写引用」→ 本就是 ADR-0007 既有条款（「业务调用方不得取得可写 Yjs 引用」），
  属未来 NamespaceRuntime 的执行义务，**本轮零动作**（无落地层；设计只登记归属，不造脚手架）。

### 4.2 ⑥ verifySnapshotIntact —— 对称重物化比较（R4/F-R3-1 定稿；判据演进第四版）

> **⚠️ 判据演进史与退役声明（R4）**：⑥ 的比较判据历经四版——R1「原始输入 vs 读回 键集相等」
> （重叠联合**假阳性**，SA2 E4）；R2「按成员投影 any-of」（有损成员掩盖 → **值攻击假阴性**，
> F-R2-1）；R3「无损锚定 any-of」（无损准入以**攻击后的 P** 为基准——observer 删除使 P 缩水、
> 平凡无损 + extract 仲裁漂移 → **删除攻击假阴性**，F-R3-1 D1/D2）；R4「**对称重物化**」
> （本节，SA2 十五场景 + SA1 §9.5 十七场景双验证全对）。三轮缺陷同根：**在「输入/攻击后读回」
> 这类**单侧锚**上做联合仲裁推理**——两侧管线产物一旦构造性对称，仲裁漂移类攻击（值改/删除/
> 插入翻转）整体绝迹，**三值 cmp / 逐 kind 可走查谓词 / 无损谓词表 / union 准入规则整体退役**
> （§4.2.1 保留历史复盘引用，不再是现行规范）。出口 1 方向不变——对称重物化是出口 1 的**实现
> 机制替换**，非方向变更。

**位置**：⑤ `verifyInstall` 之后、`return {ok:true}` 之前（不变）。⑤ 保留为顶层廉价快速检测。

**算法（对称重物化）**：

```ts
/** ⑥ 安装后完整逻辑快照校验（rev2 RD8 / Medium 出口 1；R4/F-R3-1 对称重物化）。
 * 比较基准 = extract(real) ≡ extract(scratch)——scratch 是同一输入经同一物化管线在一次性
 * doc 上的**未修改**安装；两侧构造性对称，仲裁在两侧一致。
 * 写后检测面 → W1 唯一相容形态 throw（E201 变体 C=检测到偏离 / D=校验未能运行）。 */
function verifySnapshotIntact(derived: DerivedSchema, snapshot: unknown, doc: Y.Doc): void {
  // (1) scratch 侧：重新执行 ② 同款构造（同一 derived + 同一 snapshot，fresh detached 实例——
  //     yjs 类型单 doc 集成约束 ⇒ 不能复用 entries_real，必须重建；resolver 复用同一实例或新建等价）
  //     并经 ④ 同款单事务装入一次性 scratchDoc = new Y.Doc()（零 observer、零外发事件、事务后即弃，
  //     GC 回收——detached doc，零真实 doc 副作用）。
  //     构造/安装异常（throw 或 issue 返回）→ throw e201D（触发类④ scratch 构造异常——理论不可达，
  //     防御性收敛；对抗 Proxy 双读使第二次 build **发散但不抛**时落在 (3) 的 C 支，见 R-5）。
  // (2) 双侧提取：exReal = extractYjsSnapshot(derived, doc)（公共读入口，INV-6 不外抛）；
  //     exScratch = extractYjsSnapshot(derived, scratchDoc)。
  //     exReal 失败 → throw e201C（提取失败支——已安装子树载体被 observer 改坏）；
  //     exScratch 失败 / 任一 throw → throw e201D（触发类④——理论不可达，防御性收敛）。
  // (3) 比较：productEqual(derived, exReal.snapshot, exScratch.snapshot)——两个**同管线产物**的
  //     相等判定（逐 kind 规则见下表）。不相等 → throw e201C（detail 报首个差异 path + 两侧摘要；
  //     措辞涵盖 observer 修改与输入对抗性双读发散——R-5）。
}
```

**productEqual —— 同管线产物相等判定（R4 新规；替代退役的三值 cmp）**。两侧均为 extract 产物
（纯 JSON 逻辑快照、出自同一确定性管线），比较的是**可观测产物整体**——投影过滤语义随 input-vs-
product 基准一并退役（R2/R3 的掩盖机理因此**结构性不可达**：无投影即无「被投影滤掉的键」）：

| 节点 kind | 判定规则 |
|---|---|
| `root` / `ref` | `resolve` 下钻递归（环/缺名 → ⑥ 变体 D） |
| `map`（封闭形与 Record **同规**） | 两侧均 plain object；**全键集相等**（undefined 值视同缺席，双侧同规）+ 逐共有键递归——不做声明字段过滤（产物键集即 extract 仲裁的可观测结果，键集差异本身即偏离：D1 型删除使 real 侧键集缩水、插入翻转使 real 侧键集增大，均在全键集比较下立判） |
| `array` | 两侧均 Array；长度相等 + 逐元素递归（顺序敏感） |
| `xml-fragment` | 两侧均 string → **canonical 语义等价**（§4.3 共享扫描器；W3——两侧产物虽出自同管线，observer 对 real 侧 XML 的**语义等价改写**（如属性重排）不得误报，故仍禁字节直接比较） |
| `leaf` / `plain` | 深度结构相等：标量 `===`；plain object 全键集 + 递归；array 逐元素 |
| `union` | **角色分发 any-of**：按声明序取首个使 `productEqual(member, a, b)` 为真的成员即等价；全拒 → 不等。成员仅决定子位的 canonical/exact 角色（xml vs leaf）——**无准入游戏**（无损/可走查谓词已退役）：两侧同管线产物在诚实路径字节一致（任意成员判定一致）；攻击使产物分歧时，全键集/逐元素比较在任意成员下都能看见键集与值差，角色分歧仅影响 string 位的 canonical 与否（登记为 R-8 残余：需联合同时含 `leaf<string>` 与 `xml-fragment` 成员、且攻击恰为 canonical 等价而字节不等的 leaf 字符串改写——**构造可达但触发面对抗性自造 schema + 精确 canonical 等价改写，且终态在 W3 语义下等价**〔R4 后 nit 修订如实化：原「工程上不可达」措辞偏强〕，详 §8 R-8） |

**E201 消息变体（R4 更新 C 的 detail 措辞与 D 的触发枚举；变体 A/B 既有不动）**：

```
E201 变体 C（检测到偏离——对照管线读回不等）：
DOCRT-E201: ROOT 逻辑快照安装后语义校验偏离：<detail>（<renderPath(path)>）——疑似 observer 修改
已安装子树（与同一输入经同一管线的未修改安装读回不等）；写入已提交，不回滚、不补偿，doc 保持
observer 留下的实际状态
  · detail 例：键 "u" 读回 {"n":2} 与对照安装读回 {"n":1} 不等价
  · detail 例（键集支）：键 "u" 读回键集 ["x"] 与对照安装读回键集 ["x","k"] 不等——疑似 observer
    删除（或插入后仲裁翻转）
  · detail 例（提取失败支）：提取失败（ROOT.u 期望 Y.Map 实际 plain value）——已安装子树载体与
    结构树不符
  · R-5 关联：输入含对抗性 getter/Proxy 且第二次构造发散时，亦落本支（loud，绝不假成功）

E201 变体 D（校验未能运行，不代表偏离）：
DOCRT-E201: ROOT 安装后完整性校验无法完成（<detail>）——写入已提交，不回滚、不补偿；此形态
不代表已检测到偏离，仅代表校验防线未能运行
  · 触发类枚举（R4 补④）：① 深栈溢出（提取/比较递归）；② 比较器自身异常；③ XML canonical
    扫描失败（如 observer 向已安装 XmlElement 注入含 `"` 属性值 / 裸 `<` 文本 span）；④ **scratch
    构造/安装/提取异常**（同一输入第二次构造抛出或失败——理论不可达：② 已在 real 侧成功；
    防御性收敛归 D，不谎报偏离）
```

变体 D 的诚实性要求（防谎报）：「没测成」一律归 D，消息明示与 C 的区别——E201 家族是 fatal 声明，
但 fatal 的**原因**必须真实。RT-5 锁定「不可扫描也绝不 ok:true」。

### 4.2.1 判据演进史 + 对称重物化双向论证（R4/F-R3-1 重写；R2/R3 论证显式标注为历史）

**三轮缺陷复盘（历史，非现行规范——现行判据见 §4.2）**：

| 轮 | 判据 | 缺陷（实测击穿向量） | 根因 |
|---|---|---|---|
| R1 | 原始输入 vs 读回，键集相等 | 重叠联合诚实路径假阳性（C1–C3：build 走 F7 拒未声明键的**后**成员、extract 走忽略未声明键的**前**成员 → 读回投影 ⊊ 输入） | 单侧锚（原始输入）+ build/extract 仲裁不对称（PA-8） |
| R2 | 按成员投影 any-of：任一成员两侧可走查且投影相等即等价 | 值攻击假阴性（F-R2-1 三形态：窄成员/必填缺席成员/判别联合未选中成员的**有损 equal** 掩盖投影内真偏离） | 有损成员的 equal 只证明窄子投影 |
| R3 | 无损锚定 any-of：equal 且 lossless(M,P) 才构成等价 | **删除攻击**假阴性（F-R3-1 D1/D2：observer 删除声明键 → P 缩水 → 缩水 P 对宽松成员**平凡无损** + extract 仲裁漂移到另一成员；§4.2.1 引理「lossless(M_e,P) 恒真」隐含 M_e 不变假设，删除使其落空） | 无损准入以**攻击后的 P** 为基准——基准本身可被攻击塑形（插入方向 P 增大→无损更严→本就捕获；单向不对称恰证根因） |
| **R4（现行）** | **对称重物化：extract(real) ≡ extract(scratch)** | —（SA2 十五场景 + SA1 §9.5 十七场景全对：诚实 10 equal / 攻击 7 diff，含 D1/D2/插入翻转） | 基准改为**未修改输入经同一管线的产物**——判据不再消费任何攻击可塑形的单侧锚 |

**D1/D2 实测形态（F-R3-1；R3 判据均误判 equal，方案 b 全部正确 diff；scratch 对照实证可观测性）**：

| 形态 | schema（联合在嵌套字段位，⑤ 盲区） | observer 攻击 | extract(real) | extract(scratch) | R3 判据 | 方案 b |
|---|---|---|---|---|---|---|
| D1 宽严格联合 + 删除宽成员声明键 | `{ u: { x: YLeaf<number>; k: YLeaf<number> } \| { x: YLeaf<number> } }`，输入 `{u:{x:1,k:2}}` | `uRef.delete('k')` | `{u:{x:1}}`（仲裁漂移到 `{x}`） | `{u:{x:1,k:2}}`（member[0]） | equal ✗ | **diff** ✓ |
| D2 判别联合（vfs3.assets 同款，经 ref）+ 删除成员独有字段 | `{ asset: TextAsset \| ImageAsset }`，输入 `{asset:{kind:'text',body:'<p>hello</p>'}}` | `assetRef.delete('body')` | `{asset:{kind:'text'}}`（双软拒 → walkUnion 回退成员 0） | `{asset:{kind:'text',body:'…'}}` | equal ✗ | **diff** ✓ |

**方案 b 双向论证**：

- **无假阳性（诚实路径 ⇒ ok:true）**：无 observer 修改时，real 与 scratch 是**同一确定性管线**
  （同 derived、同 snapshot、同 ②③④ 序列）在两个独立 doc 上的产物——② 构造/④ 安装/extract 仲裁
  逐位确定性 ⇒ `extract(real) ≡ extract(scratch)`（含 C1–C4 重叠联合：两侧同样走过 build-后成员/
  extract-前成员的不对称仲裁，产物逐位一致；§9.5 实测 10 诚实场景全 equal）。对抗性双读
  （R-5）：第二次构造**发散但不抛** → 两侧产物不等 → E201-C（loud、绝不假成功——与 R1 轮 F7
  立场同向）；**抛出/失败** → E201-D 触发类④。
- **无假阴性（可观测偏离 ⇒ E201-C）**：**可观测性的非循环定义**（修复 R3 版循环性——R3 把
  「可观测偏离」定义为「P ≠ 输入的任何无损成员投影」，与判据循环）：**extract(real) ≠
  extract(scratch)** 即可观测偏离——scratch 是未修改输入的管线产物，独立于任何判据存在。
  任何使两侧 extract 输出不同的 doc 修改（值改 / 删除 / 插入 / 载体破坏——载体的直接比较；
  键集差异在全键集比较下立判（D1 缩水、插入翻转增大）；值差异在逐元素/canonical 比较下立判
  （RT-1.4、Shape A/B/C）。**检测面边界（如实登记，不变其宽）**：对 extract 输出**无影响**的
  doc 修改（D4 投影外键——extract 不读的未声明键）不在检测面（scratch 与 real 的 extract 都
  看不见它们）——该边界继承自 extract 公共读入口既定语义（ADR-0007 冻结），R1–R4 四版判据同宽，
  方案 b 既未收窄也未扩大。
- **成本**：成功路径 +1 次 scratch 构造（② 同款）+1 次单事务安装 +1 次 extract + 简单比较
  （较 R3 版省去无损判定遍历）。materializeRoot 是「ROOT 空置」的 create-time 入口（③ 限定），
  非热路径；scratch 为 detached doc、事务后即弃（GC 回收），零真实 doc 副作用、零事件外发
  （fresh doc 无监听者）。⑤ 廉价顶层身份校验保留为快速前置。

### 4.3 XML canonical 归一化：复用 xml-parse.ts 共享扫描器

`xml-parse.ts` 阶段① 扫描器（显式标签栈、**零递归**、骨架逐条镜像 vfsl `xml.ts`）已是包内 XML
token 文法的**单一事实源**。⑥ 的比较器**不得另造词法**（SA2 攻击面：两套扫描器漂移）。改动：

- `xml-parse.ts` 新增模块内部导出（**不进 index.ts 公共面**）：

```ts
/** canonical 语义归一化键（模块内部件，materialize ⑥ 专用；不进公共面）：
 * 复用 scan() 中间树 → 确定性渲染：元素名原序、属性按名排序 + 重复 last-wins（scan 已按源序
 * 收集，渲染前 Map 归并）、值双引号（② 已拒属性值含 `"`，C-8/X-F9——归一化无歧义）、自闭合与
 * 空元素统一渲染 <n></n>、文本/注释/CDATA/PI span 逐字。同语义 ⇔ 同 canonical（W3 落地件）。
 * 扫描失败（未闭合/裸 < 等）→ { ok:false, reason }——调用方（⑥）按变体 D 处置，不谎报偏离。 */
export function canonicalXmlOf(text: string): { ok: true; canonical: string } | { ok: false; reason: string };
```

- 扫描失败（任一侧）→ ⑥ 变体 D（R2/#7：输入侧曾过 ② 扫描、提取侧来自 yjs toString——失败即
  防线未运行或 observer 注入不可扫描内容；RT-5 锁定「不可扫描也绝不 ok:true」）。
- **W2 合规声明**：canonical 化是**内部比较基准**，不构成公共逐字 round-trip 承诺；公共承诺面
  维持 ADR-0007「语义等价」。span 逐字（文本/CDATA/PI/comment）在 canonical 内保留——与 SA6
  测试比较器（同款设计）一致，即 lexical-token 载体特征在比较语义里的体现（RD9 措辞与此对齐）。

### 4.4 契约文档（JSDoc）定稿措辞（R2/#1/#9 修订；R4/F-R3-1 措辞终版）

`materialize.ts` 头部/入口 JSDoc 四处更新（`index.ts` 入口注释同步精简版）：

1. **前置条件段改写**（原「⚠️ 前置条件（契约前提，R2 修订增补）」段）：由纯文档声明改为
   「**运行时强制（RD7）**：本函数在入口检测活动 transaction 语境（外层 transact 未闭合 / 事务
   cleanup·observer 派发中），命中 → throw `DOCRT-E202`，本函数零写入；检测不到可靠事务状态时
   fail-closed 同码拒绝」。
2. **成功语义段升级（R4 终版）**：`ok:true` 承诺 = INV-2 + INV-10 + **INV-11（管线产物投影等价）**
   ——返回时 `extractYjsSnapshot(derived, doc)` 的读回投影与**同一输入经同一物化管线在一次性
   doc（零 observer）上的未修改安装读回投影**语义等价；检测基准 = **语义等价**（XML 经 canonical
   归一化）而非身份同一性；身份级保守仍由 ⑤ 在顶层保留；偏离 → E201（A/B/C/D 四变体）。
3. **检测面边界段改写（R2/#9，R4 微调）**：「嵌套就地修改由 ⑥ 以**语义等价基准**覆盖（语义等价
   的嵌套重写不触发——保证对象是 logical snapshot 投影而非引用身份，明文）；**检测基准 = extract
   读回输出（D4：结构树未声明的键不入 extract 投影，亦不入检测面）——observer 向封闭子树注入
   未声明键不在 ⑥ 可见范围，由 ADR-0007 observer 纪律治理**。仍不覆盖：返回时点之后的异步修改
   （契约时点 = 返回时）、observer 在 ④ 内抛错（F10 原样传播，⑤⑥ 不运行）、顶层语义等价异实例
   重插（⑤ 身份基准有意保守，rev1 R-8 锁定）。
4. **xml-fragment 分支 + lexical-token 措辞（RD9）**：「CDATA / 处理指令 / 注释以逐字
   `Y.XmlText` span 承载，是 **lexical-token（词法记号）round-trip 的载体特征**——它们作为不透明
   文本段往返，**不是**结构化 XML 节点（ADR-0003 终态节点 + 不定义结构映射立场）；公共承诺面仍为
   ADR-0007 语义等价 round-trip，**不承诺字符串逐字相同**」。

### 4.5 成本与深栈残余风险（诚实登记；R4/F-R3-1 随对称重物化更新）

- **成本（R4）**：成功路径 +1 次 scratch 构造（② 同款 build）+1 次单事务安装 +1 次 extract +
  简单产物比较（O(n)，n = ROOT 子树大小）+ XML 叶子 canonical 化——较 R3 版**省去无损判定遍历**
  （三值 cmp/无损谓词退役，比较器退化为产物深度相等 + 角色 dispatch）。materializeRoot 被 ③
  限定为「ROOT 空置」的初始化式入口（不覆盖、不合并），非热路径；scratch 为 detached doc、事务后
  即弃（GC 回收，零真实 doc 副作用、零事件外发——fresh doc 无监听者）；成本可承受，不设预算开关
  （开关 = 检测面可选降级，反 pattern）。
- **深栈残余**：⑥ 新增 scratch 构造/提取各一次 JS 递归——与 real 侧 ②④/extract 同深度（同一
  输入），real 侧已通过即 scratch 侧同过；成功安装深度上界仍由 ④ yjs 集成递归**先行**卡死
  （SA6 标定：depth=2_000 已溢出在 ④，② 装配容忍 ~10_000——④ 是最浅闸门；XML 内部深度对
  extract 是 opaque 字符串、深度 1）。理论残余：极深但侥幸通过 ④ 的嵌套在 ⑥ 任一侧溢出 →
  变体 D loud（fail-safe 方向）。登记为 R-3。
- **输入侧重读（R4 措辞）**：⑥ 的 scratch 构造重新读输入 snapshot（含 getter/Proxy 重读）。
  对抗性双读**发散但不抛**（第二次 build 产出不同值）→ 两侧产物不等 → E201-C loud——失败方向
  安全（绝不假成功），承接 R-5（与初轮 F7「对抗 Proxy 双读发散」同款立场）；第二次构造**抛出/
  失败** → E201-D 触发类④。登记为 R-5 残余。
- **R-2 前提句（四轮如实化终版）**：R1 版前提（「①② 构造保证 extracted ≡ input」）被 SA2 E4
  证伪（build/extract 仲裁不对称）；R2 版规则（按成员投影 any-of）被 F-R2-1 证伪（有损 equal
  掩盖）；R3 版规则（无损锚定）被 F-R3-1 证伪（无损基准本身可被删除攻击塑形）。**R4 终版**：
  「⑥ 假阳性的理论源 = 双侧管线**不对称**——对称重物化下两侧走同一确定性管线，诚实路径产物
  逐位一致（§9.5 十诚实场景全 equal）；假阴性的理论源 = 产物差异落入比较盲区——全键集/逐元素/
  canonical 比较下仅剩 string 角色分歧边角（R-8 登记）。RT-1/RT-1.5/RT-1.6 正负用例为三代击穿
  向量的红绿锚」。

---

## §5. RD9 / RD10 —— Minor 定稿

### 5.1 RD9（Minor-1：lexical-token 措辞）

**零行为改动**（SA6 Minor-1 混合内容 round-trip 已绿——现行为即 lexical-token 语义）。动作 =
§4.4 第 4 条 JSDoc 措辞（materialize.ts 两处 + index.ts 入口注释一句）。**W2 红线合规**：措辞
明示「载体特征 + characterization 锁定，非公共逐字承诺」；不出现「round-trip 逐字保真」类字样。
SA6 用例即该特征的 characterization 锚（语义比较器内 span 逐字），无需增改。

### 5.2 RD10（Minor-2：E200 零写入确定性覆盖）

**确认 SA6 极深树方案充分，否决受控 seam**（SA2 攻击面 6 独立复核通过）：

- **充分性论证**：20_000 层 `<p>` 嵌套确定性落在 ② detached 装配支路（SA6 scratch 标定 ② 溢出
  ~10_000，2× 余量；用例并前置断言 `validateLogicalSnapshot ok:true` 证明触发点不在 ① 逻辑支路）
  → `prepare` 共享崩溃边界收编为 E200 单 issue + ok:false + 0 update + state 字节不变——「detached
  构造失败零写入」（ADR-0007 明文承诺面）的确定性验收**已达成**。栈溢出点环境方差只影响「② 是否
  更早溢出」——仍 E200 仍绿（SA2 复核）。
- **否决 seam**：受控 seam（注入点/测试钩子）= 为可测性在生产代码开后门——与 ADR-0007「未来原始
  Yjs update 必须另设受控验证通道」的受控面最小化纪律相悖。极深树已满足确定性，无需 seam。
- **残余**（R-4）：若未来引擎栈上限提升 >2×，② 可能不再溢出 → 用例以「非 E200 形态失败」显式
  变红（④ 溢出 raw throw + 部分写入，INV-5 预期行为），不会静默假绿——失败方向仍是 loud。

---

## §6. RD11 —— 版本 bump 与发布面

- `packages/doc-runtime/package.json`：`"version": "0.1.4"` → `"0.1.5"`（patch：行为硬化 + 契约
  文档，无公共 API 签名变更、无新公共符号——guard 与比较器均为模块内部件；沿仓内 0.1.1→0.1.4
  均 patch 推进的惯例）。
- 不 commit（简报发布要求由总控/SA3 流程处理）；本设计文档为 SA1 唯一产出。

---

## §7. SA6 红灯用例逐条对齐（R2/#1/#2 扩充：RT-1/RT-2/RT-3 入表）

| 用例 | 红灯/绿灯断言 | 本设计落点 | 对齐结论 |
|---|---|---|---|
| **P1 T-1 拒绝测试**（materialize-root.test.ts:717-780）：未闭合 `doc.transact` 内调用 | `result?.ok` 不为 true（主锚）；throw 支 `instanceof Error` + `/DOCRT-/`；0 update；state/vector 字节不变；ROOT 空置；observer 未触发 | ⓪ guard（§3.4）在 prepare 前触发 → **throw E202-A**；零 doc 触碰 → 全部零写入断言成立 | **对齐**：throw 支占位断言生效；RT-6 建议收紧 `/DOCRT-E202/`（§7.1） |
| **RT-1.1–1.3 重叠联合诚实路径（R2/#1 新增，SA6 落地）** | ① validate ok 前置断言 → materializeRoot **不得 throw、ok:true**；characterization 锁定 extract 投影（C1 `{a:'x'}`——D4 仲裁现状） | ⑥ 对称重物化（§4.2）：scratch 侧同管线产物与 real 侧逐位一致（重叠联合的不对称仲裁在两侧同样发生）→ equal → ok:true | **对齐**（§9.5 仿真 equal；R1 单侧锚基准在此三例假阳性——演进史 §4.2.1） |
| **RT-1.4 重叠联合负对照（R2/#1 新增）** | C2 schema + one-shot observer `uRef.set('a','HACKED')` → `toThrow(/DOCRT-E201/)` | ⑤ 过（顶层引用未变）→ ⑥ 对称重物化：real 读回 `{u:{a:'HACKED'}}` vs scratch 对照读回 `{u:{a:'x'}}` → 产物不等 → E201-C | **对齐**（§9.3/§9.5 仿真 diff——检测未弱化；攻击键在两成员投影内均可见，无掩盖成分） |
| **RT-1.5 掩盖形态负对照（R3/F-R2-1 新增，SA6 落地；R4 去留定论：保留**——R2 判据的击穿向量，方案 b 下天然 diff（值改使 real 侧产物值变 → 逐元素/键集比较立判，§9.5 攻击 3/3 diff），作为**判据演进回归锚**永久锁定，防未来判据回退重开值攻击掩盖面） | 三掩盖形态（窄成员掩盖宽成员声明键 / 必填缺席成员掩盖 Record 动态键 / 判别联合经 ref 掩盖成员独有字段——vfs3.assets idiom）× 攻击+诚实对照 → 攻击 `toThrow(/DOCRT-E201/)`、诚实 ok:true | ⑥ 对称重物化：攻击使 real 侧产物偏离 scratch 侧 → E201-C；诚实路径双侧同管线产物一致 → ok:true | **对齐**（§9.5：攻击 3/3 diff、诚实 3/3 equal；R2 判据在此三形态假阴性、R3 修复值攻击——演进史 §4.2.1） |
| **RT-1.6 删除负对照（R4/F-R3-1 新增，SA6 落地）** | D1（宽严格联合 delete 宽成员声明键）/ D2（判别联合经 ref delete 成员独有字段——vfs3.assets idiom）× 攻击+诚实对照 → 攻击 `toThrow(/DOCRT-E201/)`、诚实 ok:true | ⑥ 对称重物化：删除使 real 侧 extract 产物**键集缩水**（且仲裁可能漂移/回退），与 scratch 侧全键集产物不等 → E201-C（键集支 detail）；诚实路径双侧一致 → ok:true | **对齐**（§9.5：D1/D2 攻击 diff、诚实对照 equal；R3 判据在此两形态假阴性——正是 R4 修订对象） |
| **RT-2 窗口 B 拒绝 + afterAllTransactions 对照（R2/#2 新增，SA6 落地）** | 见 §7.1 RT-2 规格 | ⓪ guard 窗口 B（§3.1 B 行：cleanup 队列非空）→ throw E202-B；afterAllTransactions 内调用 → 队列已重置 → 放行 → ok:true | **对齐**（把 #4 例外与安全论证测试化，防 SA3 误把 afterAllTransactions 也拒掉） |
| **RT-3 窗口 C fail-closed（R2/#2 新增，SA6 落地）** | 见 §7.1 RT-3 规格 | ⓪ guard fall-through（§3.1 C 行 + §3.4 伪代码单一口径）→ throw E202-C（含 `{}` 垃圾 tx 按 A 的收敛口径断言） | **对齐**（fail-closed 兜底首次有测试锚） |
| **Medium Y.Map**：observer `u.set('n',2)` | `toThrow(/DOCRT-E201/)`；顶层引用未变；uN=2 落地；≥1 update | ⑤ 过 → ⑥ 对称重物化：real 读回 `{u:{n:2}}` vs scratch 对照读回 `{u:{n:1}}` → diff → **throw E201-C** | **对齐**（正则命中变体 C；「写已提交、偏离保留」与用例后置断言一致） |
| **Medium Y.Array**：`tags.insert(1,['z'])` | `toThrow(/DOCRT-E201/)`；`['a','z','b']` 落地 | ⑥ array 逐元素顺序敏感比较 → diff → E201-C | **对齐** |
| **Medium Y.XmlFragment**：`body.insert` 追加 | `toThrow(/DOCRT-E201/)`；`'<p>x</p>HACKED'` 落地 | ⑥ xml canonical 比较：提取侧多一文本 span → diff → E201-C | **对齐**（canonical 内 span 逐字——追加即语义偏离） |
| **Medium 正向对照**：observer 只读 | `ok:true` + extract 语义等价 + revalidate ok | ⑤ 过 → ⑥ 双侧同管线产物一致 → ok:true；用例自身的 extract 断言与 ⑥ scratch 侧同基准 | **对齐**（防过度拒绝守卫） |
| **Minor-1 混合内容 round-trip** | ok + 单事务 + 语义等价 + revalidate ok（绿现状） | 零行为改动（RD9）；⑥ 对该路径额外校验同一投影语义（必过） | **对齐**（维持绿） |
| **Minor-2 极深树 20_000 层** | `ok:false` + 恰 1 issue `/DOCRT-E200/` + 0 update + state 不变（绿现状） | ⓪ guard 干净放行 → ① 过 → ② 装配溢出 → E200（RD10 确认现状方案） | **对齐**（维持绿） |

**既有 materialize-root.test.ts 其余用例（U1–U13 / G 系 / C 矩阵 / T-4 / 空 entries）零回归预期**：
⓪ 只在事务语境触发（全用例均不在事务内调用，唯 T-1 已改）；⑥ 在 ⑤ 过后运行——G 系 E201 用例在
⑤ 即 throw；正向用例（含空 entries：`{} vs {}` 相等；T-4 在 ⑤ 即 throw；G4 同值重插语义等价 →
⑥ 过；既有 union 用例（U 系 fixture 三成员互斥判别）投影比较与旧键集语义一致——互斥成员下投影=
全键）均维持绿。SA3 必须全量跑绿作为实现门禁（§8 验证节）；RT-1 落地后重叠形态亦有红绿锚。

### §7.1 新增测试规格（R2/#2 交付——总控派 SA6 落地；文件均在 ALLOW LIST，`[SA6 owned]`）

以下规格源自 SA2 评审「红线测试思路」节 + 本设计落点定稿；断言精确到消息正则与触发手法。落地文件：
`materialize-root-rev2.test.ts`（RT-1/RT-2/RT-3/RT-5 新 describe）+ `materialize-root.test.ts`
（RT-6 收紧 T-1 占位正则，一处）。

**RT-1（#1 配套——重叠联合正/负四用例）**：
1. 诚实正路径：`type ROOT = { a: YLeaf<string> } | Record<string, YLeaf<string>>;` + 输入
   `{a:'x',k:'y'}`（前置断言 `validateLogicalSnapshot ok:true`）→ `expect(result.ok).toBe(true)`
   **且不 throw**；characterization 锁定 extract 投影 `{a:'x'}`（D4 仲裁现状，防未来静默漂移）。
2. 嵌套形态：`{ u: { a: YLeaf<string> } | Record<string, YLeaf<string>> }` + `{u:{a:'x',k:'y'}}`
   → 同上。
3. 双封闭成员子集重叠：`{ a: YLeaf<string> } | { a: YLeaf<string>; k: YLeaf<string> }` +
   `{a:'x',k:'y'}` → 同上。
4. 负对照：同 2 的 schema，one-shot observer 于安装后 `uRef.set('a','HACKED')`（顶层引用不变，
   ⑤ 盲区）→ `expect(() => materializeRoot(...)).toThrow(/DOCRT-E201/)`——证明投影比较未弱化检测。

**RT-1.5（R3/F-R2-1 配套——掩盖形态负对照三用例，各配诚实对照；**R4 去留定论：保留**——R2 判据
的击穿向量作为判据演进回归锚永久锁定；schema 均联合在嵌套字段位使 ⑤ 盲区，one-shot observer 改
成员独有/动态/宽成员声明键——R2 版判据在此三形态假阴性，**对称重物化（方案 b）下须全部
`toThrow(/DOCRT-E201/)`**（§9.5 实证攻击 3/3 diff））：
1. 形态 A（窄成员掩盖宽成员声明键）：`type ROOT = { u: { x: YLeaf<number>; k: YLeaf<number> } | { x: YLeaf<number> } };`
   + 输入 `{u:{x:1,k:2}}`（前置断言 ① validate ok）——攻击：one-shot observer
   `uRef.set('k', 9)`（k 是宽成员声明键、窄成员未声明）→ `toThrow(/DOCRT-E201/)`；诚实对照（无
   observer）→ `ok:true` + characterization 锁定 extract 投影 `{u:{x:1,k:2}}`。
2. 形态 B（必填缺席成员掩盖 Record 动态键）：`type ROOT = { u: { b: YArray<YLeaf<string>> } | Record<string, YLeaf<string>> };`
   + 输入 `{u:{q:'z'}}`——攻击：`uRef.set('q', 'HACKED')` → `toThrow(/DOCRT-E201/)`；诚实对照
   → `ok:true` + 投影 `{u:{q:'z'}}`。
3. 形态 C（判别联合经 ref——**仓内 vfs3.assets fixture 同款 idiom**）：
   `type TextAsset = { kind: YLeaf<string>; body: YXmlFragment<{ p: string }> }; type ImageAsset = { kind: YLeaf<string>; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number> }; type AssetEntity = TextAsset | ImageAsset; type ROOT = { asset: AssetEntity };`
   + 输入 `{asset:{kind:'text', body:'<p>hello</p>'}}`——攻击：one-shot observer
   `bodyRef.insert(bodyRef.length, [new Y.XmlText('HACKED')])`（body 是 text 成员独有字段、image
   成员未声明——image 的有损 equal 在**任意声明序**均构成 R2 版掩盖向量，本 fixture 取
   text-first 亦同）→ `toThrow(/DOCRT-E201/)`；诚实对照 → `ok:true` +
   extract 投影 body 语义等价 `'<p>hello</p>'`（经语义比较器，W2/W3）。
   （该形态同时锚定：⑥ 比较器的 **ref 解析**（AssetEntity 经 type ref 进 ROOT）与 XML canonical
   比较——R2 版 SA1 仿真脚本因未解析 ref 对该形态误得 diff，SA2 R2 评审指出证据保真度缺口，
   R3 已修复并以忠实仿真复验 §9.3/§9.5。）

**RT-1.6（R4/F-R3-1 配套——删除负对照两用例，各配诚实对照；R3 判据的击穿向量，方案 b 下须
`toThrow(/DOCRT-E201/)`）**：
1. D1（宽严格联合 + 删除宽成员声明键）：`type ROOT = { u: { x: YLeaf<number>; k: YLeaf<number> } | { x: YLeaf<number> } };`
   + 输入 `{u:{x:1,k:2}}`（前置断言 ① validate ok）——攻击：one-shot observer
   `uRef.delete('k')`（删除宽成员声明键 → real 侧 extract 产物键集缩水且仲裁漂移到窄成员）→
   `toThrow(/DOCRT-E201/)`（消息可锚键集支 `/键集/` 或 E201 主码）；诚实对照（无 observer）→
   `ok:true` + characterization 锁定 extract 产物 `{u:{x:1,k:2}}`。
2. D2（判别联合经 ref + 删除成员独有字段——**仓内 vfs3.assets fixture 同款 idiom**）：
   schema/输入同 RT-1.5.3——攻击：one-shot observer `assetRef.delete('body')`（text 成员独有字段
   被删 → 双成员软拒 → extract walkUnion 回退成员 0，产物键集缩水）→ `toThrow(/DOCRT-E201/)`；
   诚实对照 → `ok:true` + extract 产物含 body 且语义等价 `'<p>hello</p>'`。
   （两用例合并锁定「删除向量」全形态：宽成员声明键删除（仲裁漂移）与成员独有字段删除（回退
   成员 0）；插入翻转向量已由 §9.5 仿真覆盖，如 SA6 需要可同款加嵌套位插入用例——可选。）

**RT-2（#2 配套——窗口 B 拒绝 + 安全对照）**：
- 主用例（触发手法照 SA1 §9.2：观察 `OTHER` map 触发回调、materialize 到空 ROOT，避免观察 ROOT
  自身引入安装与触发耦合）：`doc.getMap('OTHER').observe` one-shot 回调内（由
  `doc.transact(() => other.set('seed', 1))` 触发）——回调入口记录 `stateBytes(doc)` → 调
  materializeRoot → 捕获 throw，断言 `/DOCRT-E202/` 命中且消息含窗口 B 文本锚
  （`/派发期间/`）；断言 stateBytes 跨调用逐字节不变（本函数零写入）、ROOT 键集保持空置
  （外层只写 OTHER）、`update` 事件计数不因 materializeRoot 增加。
- 对照组：`doc.on('afterAllTransactions', once)` 内调用 → **ok:true** + extract 投影语义等价
  （§3.1 B 行例外条款 + SA2 E2b 安全论证的测试化——防 SA3 误把 afterAllTransactions 也拒掉）。

**RT-3（#2 配套——窗口 C fail-closed 三形态）**：fresh `Y.Doc()`：
- `delete (doc as any)._transaction` → `toThrow(/DOCRT-E202/)` 且消息含「无法确认」与「版本兼容性」
  （变体 C 文本锚）；
- `doc._transactionCleanups = {} as any`（非 Array，tx 保持 null）→ 同上；
- `doc._transaction = {} as any`（truthy 垃圾）→ `toThrow(/DOCRT-E202/)`，变体按 §3.1 收敛口径
  **断言 A**（消息含「doc._transaction 非空」——R2/#3 定稿：truthy 即 A，不做形态嗅探）。
- 零写入断言：三形态均断言 stateBytes 不变。

**RT-4（#5 可选——wedge characterization）**：注册一次性抛异常 `update` 回调 → 外层 transact
抛出被捕获（cleanup 队列卡死，SA2 E3）→ 顶层再调 materializeRoot → 断言 throw `/DOCRT-E202/`
（锁 loud 方向，永不 ok:true）；消息断言按修订后 B 变体诊断分支（含「队列异常残留」提示）。

**RT-5（#7 可选——不可扫描也绝不假成功）**：one-shot observer 对已安装 XmlElement
`setAttribute('q','x"y')`（含双引号）→ 断言**不得 ok:true**（`toThrow(/DOCRT-E201/)`，变体 C 或 D
皆可——主锚「绝不假成功」；按 §4.3 应落变体 D「canonical 扫描失败」）。

**RT-6（既有面对齐）**：T-1 占位 `/DOCRT-/` 收紧为 `/DOCRT-E202/`（三变体消息已逐字定稿，
SA2 #2 建议）；Medium ×3 保持 `/DOCRT-E201/`（变体 C 命中）。

---

## §8. 风险与回退（R2/#5/#10 修订 + R-7 新增）

| # | 风险 | 等级 | 缓解 / 失败方向 | 回退 |
|---|---|---|---|---|
| R-1 | yjs 内部字段漂移（`_transaction`/`_transactionCleanups` 改名/缺失/语义漂移/minify 改名/双实例） | 低 | 缓解五点（§3.2 耦合行，R2/#10 如实化）：① 版本锚定 `^13.6.30`——**约束安装面；对私有字段的实际保护 = 窗口 C fail-closed + 测试锁定，非 semver 承诺**；② 类型面公开（d.ts:49/53）；③ 漂移形态全景（SA2 #10 定谳）：改名/缺失 → C fail-closed；同名语义漂移 → 全量用例响亮变红（过拒绝，非假成功）；minify 一致改名 → yjs 自毁在前，不一致 → C；双实例 → 属性读取免疫（E6，对照 carrierOf 的 instanceof 会被击穿）；④ 只读布尔谓词、无形态嗅探；⑤ T-1 + RT-2/RT-3 锁 A/B/C 三窗行为。**残余**（§3.1 R2/#3）：`tx undefined + 非空队列` 的手造 stub 收到 B 指引（真实 yjs doc 上该状态即真窗口 B，指引正确） | 单包回退即恢复 rev1 行为（同时重开 owner 阻塞缺陷——回退需 owner 知情） |
| R-2 | ⑥ 比较器假阳性/假阴性（判据错误） | 低（R4 对称重物化后） | **四轮演进终版（F-R3-1 根因修复）**：比较基准改为**双侧管线产物**（extract(real) ≡ extract(scratch)）——单侧锚上的一切联合仲裁推理（R1 键集 / R2 投影 any-of / R3 无损锚定）整体退役，仲裁漂移类攻击构造性绝迹（§4.2.1 演进史 + §9.5 十七场景全对：诚实 10 equal / 攻击 7 diff 含 D1/D2/插入翻转）；RT-1.1–1.3 / RT-1.4 / RT-1.5 / RT-1.6 为四代击穿向量的红绿锚（判据演进回归锚，防回退） | ⑥ 独立阶段，可单点禁用回退（rev1 语义）——但违反 owner 出口 1 要求，须走设计评审 |
| R-3 | ⑥ 深栈溢出（极深成功安装上 extract/比较溢出） | 极低（④ 集成递归是最浅先行闸门，SA6 标定 2_000<② 容忍 10_000；XML 深度对 extract 为 opaque 字符串） | 变体 D loud fatal（诚实归 D，不谎报偏离）；不假成功 | 同 R-2 单点结构 |
| R-4 | Minor-2 引擎栈上限漂移（未来 ② 不再溢出） | 极低 | 用例以非 E200 形态**显式变红**（④ raw throw），不静默假绿（SA2 攻击面 6 复核） | 用例常量 DEPTH 随标定更新（SA6 owned） |
| R-5 | 输入 snapshot 对抗性双读发散（getter/Proxy：① 读值与 ⑥ scratch 构造读值不同） | 极低 | **发散但不抛** → 两侧产物不等 → E201-C loud（§4.2 变体 C R-5 关联措辞）；**抛出/失败** → E201-D 触发类④——两分支均 loud、绝不假成功；与初轮 F7 立场一致。**对齐形态登记（O-R4-4，R4 后 nit 修订顺带采纳）**：攻击者同时控制输入 getter（①② 读 X、⑥ 读 Y）与 observer（把 real doc 改成 pipeline(Y)）可使两侧产物相等 → ok:true、终态为 ① 未验证的 Y——但攻击者即输入所有者，同等终态可由其**返回后直接改 doc** 达成（契约时点外明文不覆盖）——**自伤等价，出威胁模型**（SA2 R4 观察项 4 定性），登记防未来误报为漏洞 | 无需回退（防御目标本身） |
| R-6 | E202 throw 引入未预期调用方破坏 | 无（仓内零生产 caller——§10 审计） | 仅 SA6 测试调用，均已按两态占位写成 | — |
| **R-8（R4 新增；R4 后 nit 修订如实化措辞）** | ⑥ union 角色分发的 string 位分歧边角：联合同时含 `leaf<string>` 与 `xml-fragment` 成员、且攻击恰为 canonical 等价而字节不等的 leaf 字符串改写（如属性重排的 XML 形文本存在 leaf<string> 位）——角色 dispatch 取 xml 位时该改写不被判 diff | **构造可达、触发面对抗性**（需对抗性自造 schema（leaf 与 xml 同槽联合）+ 精确 canonical 等价改写两个条件同时成立；两侧同管线产物在诚实路径字节一致，角色分歧仅出现于攻击形态；且**终态在 W3 语义下等价**——与 xml 位本就允许的 canonical 等价重排同款，非数据破坏） | 登记为已知残余（§4.2 union 行）——不设角色嗅探（会重新引入仲裁复刻，SA2 R4 核验认可）；可选：SA6 落地 1 条 characterization（同槽联合 + canonical 等价改写 → `ok:true` + 终态 canonical 等价断言）锁定该残余形态 | 无需回退 |
| **R-7（R2/#5 新增）** | **cleanup 队列 wedge**：`update`/`afterTransactionCleanup` 等回调抛异常 → 异常自 `cleanupTransactions` 的 `finally` 块内抛出 → 队列排空尾部代码不执行 → `_transactionCleanups` 永久非空（SA2 E3 实测：卡 length 1，第二次 transact 后 2，observer 永不再派发）；此后一切无辜顶层调用永吃 E202-B | 低（触发前提 = 监听者抛异常且未被其自身捕获——ADR-0006 模式的正当监听者如持久层 saveDoc 落盘失败即可能触发） | **fail-closed 定性可辩护**：doc 事务派发机制已死、后续写入的 update 事件永不发出 = 持久化黑洞，拒绝写入是安全侧；缺陷仅诊断误导——已以 E202-B 末句诊断分支补齐（「若调用点确不在任何回调内：队列异常残留……请勿继续复用该 doc 实例」）；RT-4（可选）锁定 loud 方向 | 无运行时回退面（guard 行为不变）；wedge doc 本身不可恢复复用，处置归调用方（弃用实例） |

**回退总策略**：全部改动收敛在 doc-runtime 单包 5 文件（文末清单），无持久层/schema/codegen 牵连，
`git revert` 单提交即回 rev1 行为。**回退的代价 = 重开 owner 阻塞缺陷（P1 假成功 + Medium 盲区）**，
故任何回退须 owner 知情。

**验证命令**（SA3/SA4/SA7 复跑锚）：

```bash
pnpm --filter @nomicore/doc-runtime typecheck
node_modules/.bin/vitest run packages/doc-runtime/test/materialize-root.test.ts \
  packages/doc-runtime/test/materialize-root-rev2.test.ts
pnpm typecheck && pnpm test   # rebase 前置硬约束第 5 项（简报）
```

---

## §9. 协议假设依据 (Protocol Assumption Evidence)

本设计的协议级假设集中于 **yjs 事务生命周期内部字段**（RD7 检测谓词）、**window B 危害机理**、
**afterAllTransactions 例外安全性**（R2/#4 新增）与 **build/extract 成员仲裁不对称**（R2/#1 显式
化——R1 版该假设未登记且被 SA2 E4 证伪，本轮补登）。逐条依据：

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| PA-1 | `doc._transaction` 活动 transact 期间非 null；嵌套 transact 归并不新建事务；idle 为 null | 源码引用 + 设计期实测（SA1）+ SA2 独立复验 | yjs@13.6.32 `src/utils/Doc.js` 构造器初始化 `this._transaction = null`；`src/utils/Transaction.js:412-429` `transact()`：`if (doc._transaction === null)` 才 `new Transaction` 并 push（否则复用=归并）；SA1 §9.1 场景 1/2/2b 实测；SA2 E1 逐事件探针一致 | 低 |
| PA-2 | observer/事务事件回调执行期间（cleanup 派发窗口）`doc._transaction === null` 但 `doc._transactionCleanups.length > 0`；全链收尾重置 `[]` | 源码引用 + 设计期实测（SA1）+ SA2 独立复验 | `Transaction.js:432-435` 外层 finally 先置 null 再 `cleanupTransactions`；`:392` 链尾重置 `[]`；SA1 §9.1 场景 3；SA2 E1（`afterTransaction`/`afterTransactionCleanup`/`update`/`updateV2`/`subdocs` 均 `tx null + cl 1`） | 低 |
| PA-3 | cleanup 窗口内新开 transact 会追加为新事务（cleanups +1），其 observer 延后派发——materializeRoot 在该窗口调用产生与 window A 同构的假成功 | 设计期实测（SA1 scratch） | §9.2 window-B2 攻击实验：`OTHER-obs enter cleanups=1` → `materialize returned ok=true` → ROOT observer 在**返回后**才派发并攻击 → 无 E201，终态腐蚀 | 低（已实测复现） |
| **PA-8（R2/#1 新增——R1 未登记而被证伪的隐含假设，显式化）** | **build 与 extract 对联合成员的仲裁谓词不对称**：② mapEntries 封闭 map 遇未声明键拒（F7）；extract 成员试验忽略未声明键（D4「未知键不报不进快照」+ trialMember 封闭 map 只遍历声明字段）→ 重叠联合诚实路径读回投影 ≠ 原始输入；⑥ 比较基准必须以 extract 投影语义为锚 | 源码引用 + 设计期实测（SA1 + SA2 双独立） | `extract.ts:8`（「缺失字段与未知键不报不进快照（D4）」）+ trialMember 三结局实现；`materialize.ts` mapEntries F7（「快照含结构树未声明字段……拒绝静默丢键」）；SA2 E4（C1/C2/C3/C4 四形态）+ SA1 §9.3 独立复现（输出一致：C1–C3 投影丢键、C4 对照相等）+ 修订比较器仿真 4/4 equal / 负对照 diff | 低（双独立实测；修复已仿真验证） |
| **PA-9（R2/#4 新增）** | `afterAllTransactions` 回调执行时 `_transactionCleanups` 已重置 `[]`（先重置再 emit）；该窗口内新开 transact **自含完整事务生命周期**（其实例 observer 在 transact 返回前派发完毕）→ guard 放行安全、⑤⑥ 检测面有效 | 源码引用 + SA2 实测（E1/E2b） | `Transaction.js:391-393`：`doc._transactionCleanups = []` 先于 `doc.emit('afterAllTransactions', ...)`；SA2 E1（aat 处 `{"tx":"null","cl":0}`）+ E2b（顺序 `["ROOT-obs","INNER-obs","aat:inner-transact-returned"]`——新事务 observer 在 transact 返回前派发完） | 低 |
| PA-4 | yjs 类型面公开声明两字段（TS 可类型化访问，非 any 强转） | 源码引用 | `yjs/dist/src/utils/Doc.d.ts:49` `_transaction: Transaction \| null`；`:53` `_transactionCleanups: Array<Transaction>`；SA2 直接核对属实 | 低 |
| PA-5 | ⑥ 用 `extractYjsSnapshot` 读回不外抛（异常收敛 E100 结构化返回） | 源码引用 | `extract.ts:16`（「全函数体顶层 try/catch → DOCRT-E100 结构化返回，绝不外抛（INV-6）」）+ `:51-74` 实现 | 低 |
| PA-6 | XML canonical 比较基准与 yjs 序列化投影一致（属性重排/引号归一/自闭合显式闭合——语义等价而非逐字；双侧均不解码实体、逐字往返） | 源码引用 + 现有测试 | `xml-parse.ts` 头部规则 1–4（yjs 实测依据 A12-A22）；rev1 RD3/RD4 语义比较器同款已全量绿；SA2 复核：canonical 五要素与规则 3「拒属性值含 `"`」自洽、实体不对称不存在 | 低 |
| PA-7 | ④ 安装期是最浅深栈闸门（成功安装深度被其先行限制） | 现有测试引用（SA6 标定）+ SA2 复核 | 简报 SA6 小节 Minor-2 行：scratch 实证 depth=2_000 溢出点落在 ④、depth≥10_000 落在 ②；环境方差只影响 ② 提前溢出（仍 E200） | 低 |
| **PA-10（R2/#5 新增）** | 事务事件回调抛异常会使 cleanup 队列永久卡死（wedge）：异常自 `cleanupTransactions` 的 `finally` 块内抛出，排空尾部代码（含 `_transactionCleanups = []` 重置）不执行；此后 observer 永不派发、队列只增不减 | SA2 实测（E3）+ 源码机理 | SA2 E3：一次性抛异常 update 回调 → transact 抛出被外层捕获后 `{"tx":"null","cl":1}`；第二次干净 transact 后 `cl:2`、W-observer fired 0；`Transaction.js` cleanupTransactions 的 try/finally 结构（finally 内 emit，异常逃逸即跳过重置） | 低（登记以支撑 E202-B 诊断分支与 R-7） |

**§9.1 yjs 事务窗口实测**（SA1 于本 worktree 执行，2026-08-23；yjs@13.6.32 / Node v24.13.0）：

```
脚本：.mabf/sa1/yjs-tx-windows.mjs（node 直跑；本地 scratch，不入仓）
$ node .mabf/sa1/yjs-tx-windows.mjs
1 idle                    : {"tx":"null","cleanups":0}
2 in outer transact      : {"tx":"NON-null","cleanups":1}
2b in nested transact    : {"tx":"NON-null","cleanups":1}
3 observer window states  : ["{\"tx\":\"null\",\"cleanups\":1}"]
3b after all             : {"tx":"null","cleanups":0}
4 windowB log            : ["obs:keys=[\"first\"] state={\"tx\":\"null\",\"cleanups\":1}",
                            "obs:after-set state={\"tx\":\"null\",\"cleanups\":2}",
                            "obs:keys=[\"first\",\"nested\"] state={\"tx\":\"null\",\"cleanups\":2}"]
```

**§9.2 window-B materializeRoot 假成功复现**（tsx 直跑现实现）：

```
脚本：.mabf/sa1/window-b2.ts（$ node_modules/.bin/tsx .mabf/sa1/window-b2.ts）
[
 "OTHER-obs enter cleanups=1",
 "OTHER-obs materialize returned ok=true keys=[\"title\",\"count\"]",
 "ROOT-obs round1 keys=[\"title\",\"count\"] cleanups=2",
 "ROOT-obs attack done keys=[\"count\",\"extra\"]",
 ...
]
result.ok=true rootObserverRounds=3
final ROOT keys=["count","extra"]
```

**§9.3 重叠联合 E4 独立复现 + 修订比较器仿真**（R2 新增，SA1 于本 worktree 执行，2026-08-23；
输入 schema 经 parseVfsl/evaluate 产出真实 DerivedSchema，materialize/extract 为现实现，比较器为
R2 §4.2 规格的仿真实现）：

```
脚本：.mabf/sa1/r2-union-probe.ts（$ node_modules/.bin/tsx .mabf/sa1/r2-union-probe.ts）
C1: validate.ok=true materialize={"ok":true} extract={"a":"x"} input={"a":"x","k":"y"}   ← 仲裁不对称复现
C2: validate.ok=true materialize={"ok":true} extract={"u":{"a":"x"}} input={"u":{"a":"x","k":"y"}}
C3: validate.ok=true materialize={"ok":true} extract={"a":"x"} input={"a":"x","k":"y"}
C4 对照: validate.ok=true materialize={"ok":true} extract={"q":"z"} input={"q":"z"}       ← 互斥成员不受影响
--- 修订比较器仿真（结构树来自真实派生物）---
C1: 修订比较器 = equal（期望 equal——诚实路径不假阳性）
C2: 修订比较器 = equal（期望 equal——诚实路径不假阳性）
C3: 修订比较器 = equal（期望 equal——诚实路径不假阳性）
C4 对照: 修订比较器 = equal（期望 equal——诚实路径不假阳性）
RT-1.4 负对照(嵌套): materialize.ok=true extract={"u":{"a":"HACKED"}}                    ← 现实现无 ⑥ = 红灯基线
  比较器=diff（期望 diff——投影比较未弱化检测）
```

（RT-1.4b 顶层联合 + observer 改顶层标量键：现实现 ⑤ 即 throw E201-B——顶层覆写属 ⑤ 身份面，
非 ⑥ 投影面；⑥ 负对照须用嵌套子树形态（RT-1.4 主用例），设计已据此定稿 §7.1。**R2 版仿真脚本
`.mabf/sa1/r2-union-probe.ts` 未解析 ref**（cmp 无 ref 分支，ref 节点落入 default JSON 比较）——
SA2 R2 评审指出系证据保真度缺口（形态 C 假阴性只在 ref 被解析时出现），R3 已以忠实仿真修复（下
节）。scratch 在 `.mabf/sa1/` 本地留存供复核——`.mabf/` 不入仓；SA2 探针另存
`.mabf/sa2-attack/`（E1–E6 / r2-*.mts 十场景，评审报告 §实测复验记录内联）。「Yjs was already
imported」警告为 scratch 双路径 import 伪影，与观测语义无关——SA2 评审同款陷阱注记互证。）

**§9.4 无损锚定判据忠实仿真（R3/F-R2-1 新增，SA1 于本 worktree 执行，2026-08-23；比较器为 R3
§4.2 规格忠实实现——三值 cmp + **ref 解析（复用包内 `makeRefResolver`）** + 无损谓词 + 无损锚定
union；materialize/extract 为现实现、真实派生物结构树）**：

```
脚本：.mabf/sa1/r3-lossless-probe.ts（$ node_modules/.bin/tsx .mabf/sa1/r3-lossless-probe.ts）
场景                                        | R3 无损锚定 | 期望
C1 诚实（顶层 [closed{a}|Record]）             | equal       | equal ✓
C2 诚实（嵌套）                                | equal       | equal ✓
C3 诚实（双封闭子集重叠）                           | equal       | equal ✓
C4 诚实（[closed{b}|Record]）                | equal       | equal ✓
RT-1.4 攻击（C2 + u.a→HACKED）               | diff        | diff  ✓
Shape A 攻击（[{x,k}|{x}] + u.k→9）          | diff        | diff  ✓   ← R2 版判据 equal（假阴性，SA2 实测）
Shape A 诚实对照                             | equal       | equal ✓
Shape B 攻击（[{b}|Record] + u.q→HACKED）    | diff        | diff  ✓   ← R2 版判据 equal（假阴性）
Shape B 诚实对照                             | equal       | equal ✓
Shape C 攻击（判别联合经 ref + body 篡改）          | diff        | diff  ✓   ← R2 版判据 equal（假阴性）
Shape C 诚实对照                             | equal       | equal ✓
—— 十一场景全对，与 SA2 r2-fix-verify.mts 十场景独立一致 ——
```

**Shape C 的 YXmlFragment 载体变体**（RT-1.5.3 规格先实测；`.mabf/sa1/r3-shapeC-xml.ts`）：

```
$ node_modules/.bin/tsx .mabf/sa1/r3-shapeC-xml.ts
validate ok = true
诚实对照 : ok:true P={"asset":{"kind":"text","body":"<p>hello</p>"}}
攻击     : ok:true P={"asset":{"kind":"text","body":"<p>hello</p>HACKED"}}   ← 现实现假成功（红灯基线）；
                                                                            R3 判据下 image 成员有损 equal 被跳过、
                                                                            text 成员 body canonical diff → E201-C
```

（形态 C 判据推演：image 成员 cmp=equal（kind 同值、url/width/height 两侧均缺席）但
`lossless(image, P) = false`——P 在场键 `body` 非其声明字段 → 跳过；text 成员 body 比较不等 →
diff → E201-C。诚实对照：text 成员 equal 且无损（P 的键 {kind, body} ⊆ 其声明集）→ ok:true。）

> **R4 注记**：以上 §9.3/§9.4 为 R2/R3 判据的演进证据（R3 无损锚定判据后被 F-R3-1 的删除向量
> 击穿——D1/D2 见 §4.2.1 演进史），保留为判据演进史；**现行判据（对称重物化）的证据是 §9.5**。

**§9.5 对称重物化（方案 b）忠实仿真（R4/F-R3-1 新增，SA1 于本 worktree 执行，2026-08-23；
比较器为 R4 §4.2 规格忠实实现——productEqual【全键集 map / 逐元素 array / union 角色分发
any-of；**canonical xml 在探针中以字面比较代替**——本组 17 场景无 XML 语义等价差（攻击均为字面差：
span 追加/键删除/值改），字面比较对场景结论无影响；XML canonical 面由 §4.3 生产规格 +
SA6 语义比较器（RT-1.5.3 / RT-1.6 的 XML 断言）+ 既有 RAC-3/RD4 语义比较器全量绿锚定
〔R4 后 nit 修订如实化标注〕】+ **ref 解析（复用包内 `makeRefResolver`）**；scratch 侧 = 同一
derived/snapshot 在独立 doc 上的同管线安装（零 observer——等价于 ⑥ 内部「② 同款构造 + ④ 同款
单事务安装」的 scratch 构造）；real 侧带攻击 observer）**：

```
脚本：.mabf/sa1/r4-optionb-probe.ts（$ node_modules/.bin/tsx .mabf/sa1/r4-optionb-probe.ts）
场景                                  | 方案b 判定 | 期望
C1 诚实（顶层重叠）                        | equal      | equal ✓
C2 诚实（嵌套）                          | equal      | equal ✓
C3 诚实（双封闭子集重叠）                     | equal      | equal ✓
C4 诚实（互斥对照）                        | equal      | equal ✓
RT-1.4 值攻击（u.a→HACKED）             | diff       | diff  ✓
Shape A 值攻击（k→9）                   | diff       | diff  ✓   ← R2 判据击穿向量
Shape A 诚实                         | equal      | equal ✓
Shape B 值攻击（q→HACKED）              | diff       | diff  ✓   ← R2 判据击穿向量
Shape B 诚实                         | equal      | equal ✓
Shape C 值攻击（判别联合 ref，body 篡改）      | diff       | diff  ✓   ← R2 判据击穿向量
Shape C 诚实                         | equal      | equal ✓
D1 删除攻击（uRef.delete k）             | diff       | diff  ✓   ← R3 判据击穿向量（F-R3-1）
D1 诚实对照                            | equal      | equal ✓
D2 删除攻击（assetRef.delete body）      | diff       | diff  ✓   ← R3 判据击穿向量（F-R3-1）
D2 诚实对照                            | equal      | equal ✓
插入翻转攻击（嵌套 [{a,k}|{a}] 插 k=9）       | diff       | diff  ✓
插入翻转 诚实                            | equal      | equal ✓
—— 17/17 全对（诚实 10 equal / 攻击 7 diff），超出 SA2 r3-optionb-verify.mts 十五场景
（补 D1/D2 诚实对照），攻击/诚实判定与 SA2 逐场景一致 ——
```

（scratch 构造以现实现 `materializeRoot(scratchDoc)` 承载：其 ①②③④ 与 ⑥ 内部 scratch 构造
（② 同款 build + ④ 同款单事务安装）在「同一 derived + 同一 snapshot + 零 observer」上等价——
⑤ 在 scratch 侧的运行为现实现附带行为，不参与比较，对证据无影响；生产实现按 §4.2 规格内部重建，
**不得递归调用 materializeRoot**（会触发 ⓪/⑤/⑥ 自身——登记为实现注意点）。插入翻转攻击须设在
嵌套字段位（⑤ 盲区）——顶层插入属 ⑤ 身份面（scratch 首测误设顶层即被 ⑤ E201 先抓，实证 ⑤/⑥
职责边界）。）

---

## §10. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `materializeRoot` | `packages/doc-runtime/src/materialize.ts:73` | 同步返回 `MaterializeResult`；throw 仅两条路径（④ observer 异常原样传播 / ⑤ E201）；活动事务内调用 → 假 `ok:true` | 同步返回不变；**新增两条 throw 路径**：⓪ 语境违规 `DOCRT-E202`（写前）；⑥ 投影偏离/校验未运行 `DOCRT-E201` 变体 C/D（写后，原本返回 ok:true 的路径）；签名/返回类型零变更 |

（`assertOutermostTransactionContext` / `verifySnapshotIntact` / scratch 构造内部件（§4.2 (1)——
**不得递归调用 materializeRoot**）/ `productEqual` / `canonicalXmlOf` 均为**新增模块内部件**，不进
公共导出面——无既有 caller。〔R4 后 nit 修订：原列名 `firstSemanticDifference` 系 R2/R3 轮比较器
旧名，R4 对称重物化已更名 `productEqual` 并新增 scratch 构造部件〕）

### Caller 清单

（`git grep -n "materializeRoot" -- 'packages/**/*.ts' 'apps/**/*.ts'` 全量；仓内无 apps 消费方）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| 包入口再导出（非调用） | `packages/doc-runtime/src/index.ts:20` | N/A（同步） | N/A | N/A | 无动作（签名零变更） |
| SA6 P1 拒绝测试 | `packages/doc-runtime/test/materialize-root.test.ts:750`（doc.transact 体内） | N/A | ✅ 用例自带 try/catch 捕捉形态（throw/返回两支自适应） | N/A | 定稿 throw 支生效；RT-6 收紧正则（§7.1） |
| SA6 Medium/Minor 测试 | `packages/doc-runtime/test/materialize-root-rev2.test.ts:260,279,297,312,340,381` | N/A | ✅ `expect(...).toThrow(/DOCRT-E201/)` / 返回值断言 | N/A | 变体 C 命中正则；正向/Minor 用例零影响 |
| SA6 既有用例（materialize-root.test.ts 其余） | 全文件（U/G/C/T 系列） | N/A | 部分 `toThrow` / 部分返回值 | N/A | §7 零回归论证 + RT-1 重叠形态锚 + SA3 全量跑绿门禁 |
| **SA6 新增 RT-1/RT-1.5/RT-1.6/RT-2/RT-3（±RT-4/RT-5）** | 两测试文件新增 describe（§7.1 规格） | N/A | ✅ 按规格自带捕获/正则断言 | N/A | R2/#2 + F-R2-1 + F-R3-1 交付，总控派 SA6 落地 |
| **生产 caller** | **无**（grep 实证：仓内零调用；`@nomicore/doc-runtime` 无下游 import 方——NamespaceRuntime 为 ADR 预留将来层） | — | — | — | 新 throw 路径零涟漪；未来 Runtime 接入时 E202/E201 语义已在 JSDoc 成文 |

### 风险评估

- **遗漏 caller 的代价**：未列 caller 依赖「活动事务内调用返回 ok:true」或「重叠联合输入 ok:true 但
  无 ⑥ 校验」→ 升级后收到 throw。grep 全量 + 仓内零生产消费方 → 当前无此风险面。
- **throw 未捕获的传播面**：materializeRoot 是同步库函数，throw 由调用方测试/调用栈显式暴露——
  本包无 fire-and-forget / 进程级 handler 牵连（非 yjs-server 运行时路径）。

---

## §11. 一致性自检记录（SA1 R2 交稿前）

- 全文检索 `DOCRT-E20` 族：E100/E200/E201/E202 四码语义互斥、无混用（E202 仅写前语境拒绝；E201
  仅写后含 C/D；E200 仅 ①②③ 崩溃边界；E100 属 extract 入口）。
- 全文检索「出口 1 / 出口 2」：摘要/§4.1/§7 三处口径一致（定稿出口 1；出口 2 仅作对照与成分回收）。
- 全文检索「窗口 A/B/C」：§1.2/§3.1/§3.4/§7/§9 五处一致——A=transact 未闭合（truthy 即命中）、
  B=cleanup 派发（含 afterAllTransactions 明文例外）、C=fall-through 不可判定（**§3.1 表格与
  §3.4 伪代码逐分支等价，R2/#3 单一口径**；全文无「Transaction 形态嗅探」残留表述）。
- guard 触发点表述：摘要/§3.4/§7/文末清单一致（函数体第一句、prepare 前、try/catch 外）。
- **比较判据口径（R4/F-R3-1 终版 = 对称重物化）**：§4.2（算法 + productEqual 表）/ §4.2.1
  （演进史 + 双向论证）/ INV-11 / 摘要 / RD8 行 / §4.4 第 2·3 条 / §4.5 / §7 表（RT-1/RT-1.5/
  RT-1.6 行）/ §7.1（RT-1.6 规格）/ §8 R-2/R-5/R-8 / §9.5 十二处一致——比较基准 =
  **extract(real) ≡ extract(scratch)**（双侧同管线产物；全键集 + 逐元素 + XML canonical；union
  仅角色分发）；三值 cmp / 无损谓词 / union 准入规则全文退役（仅存于 §4.2 演进史表、R2/R3 回应表
  历史档案与 §9.3/§9.4 演进证据，均带显式「历史/退役」标记，无现行规范残留）。
- **判据演进史登记（R1→R2→R3→R4）**：四轮缺陷向量（R1 重叠联合假阳性 / R2 值攻击掩盖 / R3 删除
  攻击放宽 / R4 现行）与对应实测证据（E4 / §9.3 / §9.4 / §9.5）在 §4.2.1 演进史表一一对应；
  RT-1/RT-1.5/RT-1.6 为三代击穿向量的永久回归锚（§7 表 R4 去留定论：RT-1.5 保留）。
- 消息措辞（R2/#8）：三处 E202 变体均为「本函数零写入（doc 状态不因本调用改变）」；E202 面无
  「doc 零写入」残留（E201 家族语义相反——「写入已提交」，不受影响）。
- W1/W2'/W2/W3/W4 五红线逐条核对：W1（写后唯一 throw——⑥ 变体 C/D 均 throw；写前 E202 throw 属
  澄清后相容形态）✓；W2（lexical-token 不升格逐字承诺——§4.3/§4.4/§5.1）✓；W2'（零 ADR 触碰
  ——出口 1 不需要）✓；W3（XML 比较经 canonical 归一化——§4.2/§4.3，禁字节比较明文）✓；W4
  （零 import Runtime、不新增第二物化入口——§3.2/§3.4）✓。
- **R2 修订一致性**：#1（§1.3/§4.2/§4.2.1/§4.4/§4.5/INV-11/§7/§8/§9 PA-8）、#2（§7 表三行 +
  §7.1 规格）、#3（§3.1 C 行 + §3.4 收敛说明）、#4（§3.1 B 行例外 + PA-9）、#5（E202-B 消息 +
  R-7 + PA-10 + RT-4）、#6（§4.2 逐 kind 谓词表）、#7（变体 D 枚举 + §4.3 + RT-5）、#8（消息
  措辞 + 登记项）、#9（INV-11 投影等价 + §4.4 第 3 条）、#10（R-1 + §3.2 耦合行）——R2 回应表
  逐条可对；R3 修订（F-R2-1/F-R2-2，R3 回应表——判据部分已被 R4 取代，见演进史）；**R4 修订一致性**：
  F-R3-1（§4.2 对称重物化重写 + productEqual 表 / §4.2.1 演进史与双向论证 / INV-11 终版措辞 /
  摘要 / RD8 行 / §4.4 第 2·3 条 / §4.5 成本与前提句 / §7 表 RT-1.5 去留定论 + RT-1.6 行 /
  §7.1 RT-1.6 规格 / §8 R-2/R-5/R-8 / §9.5 十七场景仿真）+ 三 nit（RT-1.5.3 括注 / R2 回应表
  历史标记 / §8 R-2 行）——R4 回应表逐条可对。

---

## SA2 反馈逐条回应（R2 修订）

> **⚠️ 历史档案标记（R4 加注）**：本表 #1 行内描述的 R2 版判据（「任一成员两侧可走查且投影相等即等价」）与 #3 行内引用的旧括注，均已被后续修订取代（#1 判据 → R3 无损锚定 → **R4 对称重物化（现行）**，见 §4.2/§4.2.1 演进史与 R4 回应表；#3 括注 → R3/F-R2-2 已修正）。本表按修订时点原样保留，**勿当现行规范**。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **#1 CRITICAL**：⑥ 比较器对重叠联合假阳性——比较基准改按成员投影（或对称重物化）；§4.2 表改写；R-2 前提句如实化；§4.4 措辞同步；§7 对齐表加 RT-1 | ✅ | §1.3 / §4.2（三值 cmp + 逐 kind 谓词表）/ **§4.2.1（新增：C1–C4 + RT-1.4 逐步推演 + 假阴性论证）** / §4.4 第 2·3 条 / INV-11（投影等价）/ §7 表 RT-1.1–1.4 行 / §8 R-2 / §9 PA-8 + §9.3 仿真 | 采纳**方案 (a) 并按 any-of 精化**：比较基准 = extract 投影语义——封闭 map 成员只比声明字段（未声明键两侧忽略，D4 镜像）、Record 全键、union 声明序 any-of（任一成员两侧可走查且投影相等即等价；diff 记首诊断后**继续**下一成员）。逐步推演：C1 build 走成员 2（F7 拒 k）/ extract 走成员 1（D4 忽略 k）→ ⑥ 成员 1 投影 `{a}` vs `{a}` equal → **PASS**；C2/C3/C4 同证；RT-1.4 负对照（嵌套 `uRef.set('a','HACKED')`）成员 1 值 diff + 成员 2 键集 diff → **E201-C**。假阴性论证：⑥ 判据 = ∃M: project(M,input)≡P——投影内真偏离必破坏一切成员等价而捕获；投影外（D4 未声明键/未选中成员独有键）不在检测面，属 extract 既定投影语义（#9 边界一体化登记）。**实证**：§9.3 真实派生物结构树仿真 4/4 equal + 负对照 diff。（对 SA2 方案 a 的精化理由：单成员定夺在理论边角上仍有假阳性面，any-of 与 ADR-0003「至少一个成员接受即接受」同构且不弱化检测——被 any-of 接受 ⟺ 读回==输入某合法投影 ⟺ 无可观测偏离；首成员命中时与方案 a 行为一致，C1/C3 仿真即首成员 equal） |
| **#2 HIGH**：窗口 B/C 零测试锚定——新增 RT-2/RT-3 规格 + 更新 §7 对齐表（SA6 落地）；顺带收紧 T-1 正则 | ✅ | §7 表 RT-2/RT-3 行 + **§7.1（新增测试规格节：RT-1~RT-6，断言精确到消息正则与触发手法）** + §10 caller 表新增行 | RT-2（触发手法照 SA1 §9.2：观察 OTHER map、materialize 到空 ROOT；断言 `/DOCRT-E202/` + 窗口 B 文本锚 `/派发期间/` + stateBytes 逐字节不变 + update 计数不增 + ROOT 空置 + **afterAllTransactions 对照组 ok:true**）；RT-3（`delete _transaction` / `cleanups={}` → 变体 C 文本锚「无法确认」「版本兼容性」；`_transaction={}` 垃圾 → 按 #3 收敛口径断言 A；三形态 stateBytes 不变）；RT-6 收紧 `/DOCRT-E202/`。落地文件均在 ALLOW LIST（`[SA6 owned]`），交付总控派 SA6 |
| **#3 MEDIUM**：§3.1 窗口 C 表格谓词与 §3.4 伪代码两处分歧收敛为单一规范 | ✅ | §3.1 C 行（重写为 fall-through 定义）/ §3.4（伪代码确认为唯一规范锚 + 收敛说明段） | 采纳 SA2 推荐项 (a)：保留无形态检查的伪代码，窗口 C 改为 fall-through——「C = `tx === undefined`（任意 cleanups 形态）或 `tx === null && cleanups` 非 Array」；删去「非 Transaction 形态」字样；两个残余形态定性明示（truthy 垃圾 tx → A，消息事实为真；tx undefined + 非空队列 → B，真实 doc 上即真窗口 B——仅手造 stub 收到偏移指引，登记 R-1 残余） |
| **#4 MEDIUM**：§3.1「任一回调内」表述过宽——登记 afterAllTransactions 例外 + 安全论证 | ✅ | §3.1 B 行（明文排除条款 + E2b 安全论证）/ §1.2（SA2 E1 逐事件覆盖面）/ §9 PA-9（Transaction.js:391-393 + E1/E2b）/ §7.1 RT-2 对照组 | B 行措辞改为事件枚举（afterTransaction/afterTransactionCleanup/update/updateV2/subdocs + type observer）+「**明文排除：afterAllTransactions 回调**——队列已重置 `[]`（先重置再 emit），该窗口内新开 transact 自含完整 cleanup 生命周期（E2b：observer 在 transact 返回前派发完毕），⑤⑥ 检测面有效，放行是正确行为而非漏判」；例外测试化（RT-2 对照组断言 ok:true，防 SA3 误拒） |
| #5 MEDIUM-LOW：cleanup 卡死（wedge）误诊——E202-B 补诊断分支 + 登记 + 可选 RT-4 | ✅ | §3.4 E202_MSG_B 末句（诊断分支全文）/ §8 R-7（新增行：E3 实测 + fail-closed 定性）/ §9 PA-10 / §7.1 RT-4（可选 characterization） | 采纳全部三点：消息补「若调用点确不在任何回调内：队列异常残留……请勿继续复用该 doc 实例」；R-7 登记触发前提（update/afterTransactionCleanup 回调抛异常——ADR-0006 持久层 saveDoc 失败即可能）与 fail-closed 可辩护性（派发机制已死 = 持久化黑洞，拒绝写入安全侧）；RT-4 规格 ×1 |
| #6 MEDIUM-LOW：§4.2「结构匹配」谓词未定义——展开逐 kind 判定表，指名复用 extract trialMember 语义 | ✅ | §4.2 逐 kind 表（可走查谓词列 + 比较语义列，八 kinds 全覆盖含 union 嵌 union 经由成员递归、leaf/plain 恒可走查不做类型嗅探——值域归 ①）+ 表尾注「与 extract trialMember 的接受语义镜像（对 plain 值的投影版）」 | 与 #1 一体定稿；谓词不留白：封闭 map=plainObjectOf 同款守卫 + 在场键声明性、Record=recordSlotOf 同款判定、array=Array.isArray、xml=typeof string（可扫描性在 canonical 化验、失败归 D）、leaf/plain=恒可走查 |
| #7 LOW：变体 D 触发枚举漏「提取侧 XML 不可扫描」——补第三类 + 可选 RT-5 | ✅ | §4.2 变体 D 触发类枚举（①深栈 ②比较器异常 ③**canonical 扫描失败——observer 注入含 `"` 属性值/裸 `<` span**）/ §4.3（扫描失败 → D，不谎报偏离也不静默跳成员）/ §7.1 RT-5 | 采纳；RT-5 主锚「不得 ok:true」（变体 C 或 D 皆可，按 §4.3 应落 D） |
| #8 LOW：消息面三点——(a)「doc 零写入」→「本函数零写入」；(b) 值摘要入错误文本登记；(c) 无结构化 code 字段登记 | ✅ (a)；✅ 登记 (b)(c) | (a) §3.4 三变体消息全文改「本函数零写入（doc 状态不因本调用改变）」+ §11 自检项；(b) §4.2 偏离报告段登记（E201-A 键集先例、截断 120 字符有界）；(c) §4.2 登记段（与仓内 message 正则惯例一致；未来程序化分型可加 `err.code`，非本轮） | 全部按建议处置；(c) 明示「非本轮」防止 scope creep |
| #9 LOW：INV-11 措辞防过度解读——显式声明投影等价边界（D4） | ✅ | INV-11（定稿为「逻辑快照**投影**完整性……检测面 = extract 投影（D4）」）/ §4.4 第 3 条（追加「检测基准 = extract 投影语义（D4：结构树未声明的键不入投影，亦不入检测面）……由 ADR-0007 observer 纪律治理」）/ 摘要 / §4.2.1 假阴性论证段 | 与 #1 一体落文；边界含重叠联合未选中成员独有键的显式例（C2 中 `u.k`）——继承自 D4 既定语义，非本轮弱化 |
| #10 NIT：R-1 版本锚定措辞过载 + 私有字段耦合综述收口 | ✅ | §8 R-1 缓解①（改「约束安装面；实际保护 = 窗口 C fail-closed + 测试锁定，非 semver 承诺」+ 漂移全景四形态）/ §3.2 耦合行（补「属性读取、无 instanceof 类身份依赖——对双 yjs 实例加载形态免疫（E6，对照 carrierOf）」） | 采纳 SA2 综述定谳并落入设计正文，供 SA4/SA7 引用 |

**未采纳/驳回项**：无——#1–#10 全部采纳（其中 #8(b)(c) 与 #10 为登记/措辞级；#1 在采纳方案 a 基础
上按 ADR-0003 any-of 精化，精化理由与等价性论证见 §4.2.1）。
**约束遵守声明**：RD7 guard 架构、三窗口判定域、throw 形态、E202/E201 家族、RD8 出口 1 方向、
RD9/RD10/RD11、RD11 版本面**零改动**（本轮驳回面仅 ⑥ 比较器语义与 B/C 测试锚定两处 + 文本收敛），
符合 SA2 放行条件与总控约束。

---

## SA2 反馈逐条回应（R3 修订）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **F-R2-1 CRITICAL**：⑥ union 行「diff 后继续 + 任一 equal 即胜」被有损成员掩盖（三形态实测假阴性：窄成员掩盖宽成员声明键 / 必填缺席成员掩盖 Record 动态键 / 判别联合经 ref 掩盖成员独有字段——vfs3.assets idiom）；修复二选一（推荐无损锚定）；同步修订 §4.2 union 判据、§4.2.1 假阴性论证（修正 ∀/∃ 混淆）、INV-11 措辞、§7.1 RT-1.5 三掩盖负对照、§9.3 仿真补 ref 解析与掩盖形态 | ✅ | §4.2 union 行（无损锚定 any-of）+ **无损谓词表（新增）** / **§4.2.1（R2 缺陷三形态表 + ∀/∃ 混淆复盘 + 修正版论证 + 「当且仅当」按无损限定重写 + 检测面边界与掩盖修复的区分）** / INV-11（「存在任一**对读回投影无损**的联合成员」）/ 摘要 + RD8 行 / §7 表 RT-1.5 行 + §7.1 RT-1.5 规格（三形态 schema/攻击/断言逐字 + 各配诚实对照，形态 C 用 YXmlFragment 载体并锚 ref 解析）/ §9.4（忠实仿真：**含 ref 解析（复用包内 makeRefResolver）** + 无损锚定判据，十一场景全对 + Shape C XML 载体变体实测；R2 版脚本 ref 缺口已注明并修复） | 采纳**推荐方案 1：无损锚定 any-of**（SA2 十场景已验证 + SA1 §9.4 忠实仿真 11/11 双独立复核）。判据：成员 `r='equal'` **且 `lossless(member, P)`（proj(M,P)≡P）**才构成联合等价；有损成员的 equal 按跳过（不入诊断）；diff 仍记首诊断继续；毕无「equal 且无损」→ E201-C（报文区分有损 equal / 全 incompatible）。修正论证：引理 `lossless(M_e,P)` 恒真（P 是 M_e 投影产物、投影幂等）⇒ 投影内偏离必使 M_e 取 diff 且掩盖成员无法以有损 equal 获胜——假阴性消除；诚实路径 M_e 必为合格成员——假阳性不回归。「为何不用方案 a」三点论证（最小 delta / 诊断语言 / 方案 a 需复刻 extract 仲裁、违单一事实源纪律）。RT-1.4 补注（攻击键两成员均可见、无掩盖成分——掩盖负对照归 RT-1.5） |
| **F-R2-2 MEDIUM-LOW**：§3.1 C 行括注「tx===undefined（任意 cleanups 形态）」与伪代码/收敛说明/RT-3 矛盾（tx undefined + 非空 Array 应判 B）——一句话修正 | ✅ | §3.1 C 行（括注改为「`tx === undefined` **且 B 未命中**（`cleanups` 非 Array 或为空数组……），或 `tx === null && cleanups` 非 Array」并标 R3/F-R2-2） | 按建议措辞收敛：C = tx undefined 且 B 未命中（cleanups 非 Array 或空数组），或 tx null 且 cleanups 非 Array——三处文本（表格/伪代码/收敛说明）与 RT-3 断言现在逐分支一致，§11「逐分支等价」自检成立。规范锚未变（伪代码）、实现与 RT-3 断言均不受影响（纯文本收敛） |

**未采纳/驳回项**：无——F-R2-1/F-R2-2 全部采纳（F-R2-1 用推荐方案 1；方案 2（extract 仲裁单锚）
作为对照论证保留于 §4.2.1，未采用理由三点在文）。
**约束遵守声明**：RD7 guard、三窗口判定域、throw 形态、E202/E201 家族、出口 1 方向、⑤ 前置保留、
RD9/RD10/RD11、R1 #2–#10 的全部 R2 修订**零改动**——R3 修订面严格收敛于 ⑥ union 准入规则（无损
锚定）与 §3.1 C 行括注一处文本，符合 SA2 R2 放行条件与总控约束。

---

## SA2 反馈逐条回应（R4 修订）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| **F-R3-1 CRITICAL**：R3 无损准入以攻击后的 P 为基准——observer 删除声明键使 P 缩水（平凡无损 + extract 仲裁漂移），D1/D2 两形态实测假阴性；采纳 SA2 已验证的方案 b 对称重物化（extract(real) ≡ extract(scratch)）；同步：§4.2 整体改写（三值 cmp/无损谓词退役 + 废弃标注）、三个移交规格点（scratch 异常归置 / INV-11 措辞 / RT-1.6）、§4.2.1 论证重写（历史标注）、§9.5 仿真 ≥15 场景、§7 表与 RT-1.5 去留论证 | ✅ | **§4.2（整体重写：退役声明 banner + 对称重物化算法 + productEqual 逐 kind 表 + E201 C/D 更新——C 的 detail 措辞改对照管线基准 + 键集支，D 补触发类④ scratch 构造异常）** / **§4.2.1（重写：四轮演进史表（R1 键集→R2 投影 any-of→R3 无损锚定→R4 对称重物化，各轮缺陷向量与根因）+ D1/D2 实测形态表 + 双向论证（无假阳性=同管线确定性 ⇒ 产物逐位一致；无假阴性=**非循环可观测性定义** extract(real)≠extract(scratch)，修复 R3 版循环定义）+ 检测面边界四版同宽声明）** / INV-11（终版措辞：与同一输入经同一管线的未修改安装读回投影语义等价）/ 摘要 + RD8 行 / §4.4 第 2·3 条 / §4.5（成本 +1 构造安装提取、省无损遍历；R-2 前提句四轮终版；R-5 双分支） / §7 表（RT-1.5 **去留定论：保留**——R2 击穿向量作判据演进回归锚永久锁定 + 新增 RT-1.6 行）/ §7.1 RT-1.6 规格（D1/D2 + 诚实对照，断言到消息正则）/ §8 R-2/R-5 更新 + R-8 新增（string 角色分歧边角）/ §9.5（**忠实仿真 17/17 全对**：诚实 10 equal / 攻击 7 diff 含 D1/D2/插入翻转，超出 SA2 十五场景补 D1/D2 诚实对照；含 ref 解析；scratch 承载方式与「不得递归调用 materializeRoot」实现注意点登记） | 采纳**方案 b**（SA2 十五场景 + SA1 §9.5 十七场景双验证）。关键定稿：① scratch 构造/提取/比较**异常（throw 或 issue 返回）→ E201 变体 D 触发类④**（总控定稿；诚实性纪律「没测成归 D」——对抗双读**发散但不抛**自然落 C 支，措辞明示 R-5 关联）；② 比较器 productEqual：map **全键集**（封闭/Record 同规，无投影过滤——R2/R3 掩盖机理结构性不可达）+ array 逐元素 + xml canonical（W3 保留）+ union **角色分发 any-of**（成员仅决定 string 位 canonical/exact，无准入游戏；残余 R-8 登记）；③ RT-1.5 保留定论：值攻击向量在方案 b 下天然 diff（§9.5 实证），作为判据演进回归锚防未来判据回退重开掩盖面 |
| nit 1：RT-1.5.3 括注「声明序 image 在前」与 schema 字面序（TextAsset \| ImageAsset）不一致 | ✅ | §7.1 RT-1.5.3 括注 | 改为「image 的有损 equal 在**任意声明序**均构成 R2 版掩盖向量，本 fixture 取 text-first 亦同」——与 schema 字面序一致，且保留判据区分力说明 |
| nit 2：R2 回应表 #1/#3 行保留旧判据/旧括注无废弃标记 | ✅ | R2 回应表表头 | 表头加「⚠️ 历史档案标记（R4 加注）」：#1 行 R2 版判据 → R3 → R4 演进链、#3 行旧括注已修正——原样保留按修订时点、勿当现行规范 |
| nit 3：§8 R-2 行未随判据演进更新（仍写按成员投影 any-of） | ✅ | §8 R-2 行 | 更新为四轮演进终版（对称重物化 + §9.5 十七场景 + RT-1/1.5/1.6 四代红绿锚）；R-5 行同步双分支措辞；新增 R-8（union 角色分歧残余）；§11 自检从「八处一致」收敛为本版口径 |

**未采纳/驳回项**：无——F-R3-1 与三 nit 全部采纳。**实现注意点登记（移交 SA3）**：⑥ 的 scratch
构造**不得递归调用 materializeRoot**（会触发 ⓪/⑤/⑥ 自身）——按 §4.2 规格内部「② 同款构造 +
④ 同款单事务安装」直建；scratch doc 事务后即弃、零监听者。
**约束遵守声明**：RD7 guard、三窗口、throw 形态、E202/E201 家族、**出口 1 方向（对称重物化是出口 1
内的实现机制替换，非方向变更）**、⑤ 前置保留、RD9/RD10/RD11、R1/R2/R3 全部已合格修订**零改动**——
R4 修订面严格收敛于 ⑥ 比较判据（对称重物化替换）+ 三 nit，符合 SA2 R3 放行条件与总控约束。

---

## SA2 反馈逐条回应（R4 后 nit 修订——SA2 R4 pass 报告「非阻塞 nit 4 项」顺手修）

| nit | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| nit 1：§10 内部件清单陈旧名 `firstSemanticDifference` | ✅ | §10 括注 | 更新为现行部件清单（`assertOutermostTransactionContext` / `verifySnapshotIntact` / **scratch 构造内部件（含不得递归注意点）** / `productEqual` / `canonicalXmlOf`）+ 标注旧名系 R2/R3 轮比较器、R4 已更名 |
| nit 2：§12 ALLOW list「三值投影比较器」陈旧描述 | ✅ | §12 materialize.ts 条目 | 更新为「⑥ verifySnapshotIntact（**对称重物化**：scratch 构造 + 双侧 extract + productEqual，~150 行，§4.2/§4.3）」+ 行数估计随规格净简化和下调的标注 |
| nit 3：§9.5 表头 canonical 保真度标注 + 悬空引用 `r4-optionb-xml.ts` | ✅ | §9.5 表头 + 探针注释（scratch） | 表头如实化：「canonical xml 在探针中以**字面比较代替**——本组 17 场景无 XML 语义等价差（攻击均为字面差），对结论无影响；XML canonical 面由 §4.3 生产规格 + SA6 语义比较器（RT-1.5.3/RT-1.6）+ 既有 RAC-3/RD4 全量绿锚定」；探针注释删除不存在的 `r4-optionb-xml.ts` 引用（XML 载体场景实内含于本脚本 Shape C），探针回归重跑 **17/17 全对** |
| nit 4：R-8「工程上不可达」措辞偏强 | ✅ | §4.2 union 行 + §8 R-8 行 | 如实分级：「**构造可达、触发面对抗性**（对抗性自造 schema + 精确 canonical 等价改写）且**终态在 W3 语义下等价**」；R-8 登记可选 characterization（SA6：同槽联合 + canonical 等价改写 → ok:true + 终态 canonical 等价断言） |
| （顺带）O-R4-4 对齐形态登记（SA2 R4 观察项 4 建议） | ✅ | §8 R-5 行 | 补登记：攻击者同控输入 getter 与 observer 的「对齐式」形态 → **自伤等价，出威胁模型**（同等终态可由返回后直接改 doc 达成，契约时点外明文不覆盖）——防未来误报为漏洞 |

**性质声明**：本轮全部为**文档措辞/标注级修订**，零现行规范判据改动（SA2 R4 pass 的全部判据
——对称重物化 / productEqual / E201 C/D / guard 三窗口——原样保留）。

---

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/doc-runtime/src/materialize.ts` — 修改：新增 ⓪ guard（~20 行，§3.4）+ ⑥ verifySnapshotIntact（**对称重物化**：scratch 构造（② 同款 build + ④ 同款单事务安装）+ 双侧 `extractYjsSnapshot` + `productEqual` 产物比较，~150 行，§4.2 算法与 productEqual 表 / §4.3）+ JSDoc 四处更新（§4.4）+ E202/E201-C/D 消息常量〔R4 后 nit 修订：原「三值投影比较器 ~170 行」为 R2/R3 轮口径——R4 退役三值 cmp/无损谓词后规格净简化，行数估计随之下调〕
- `packages/doc-runtime/src/xml-parse.ts` — 修改：新增模块内部导出 `canonicalXmlOf`（~40 行，§4.3；不进公共面）+ 头部 JSDoc 一句登记新用途
- `packages/doc-runtime/src/index.ts` — 修改：materializeRoot 入口注释同步（guard / INV-11 投影语义 / lexical-token 一句，~10 行；**导出面零变更**）
- `packages/doc-runtime/package.json` — 修改：version 0.1.4 → 0.1.5（RD11）
- `packages/doc-runtime/test/materialize-root.test.ts` — `[SA6 owned]` P1 T-1 拒绝测试（已落盘）+ **R2 增补：RT-6 收紧 T-1 占位正则 `/DOCRT-E202/`（一处）**；不得改断言语义
- `packages/doc-runtime/test/materialize-root-rev2.test.ts` — `[SA6 owned]` Medium/Minor 红灯（已落盘，本设计定稿后断言原样成立）+ **R2 增补（总控派 SA6 落地，§7.1 规格）：RT-1 重叠联合正/负四用例、RT-2 窗口 B 拒绝 + afterAllTransactions 对照、RT-3 窗口 C fail-closed 三形态、可选 RT-4 wedge characterization / RT-5 不可扫描不假成功；R3 增补：RT-1.5 掩盖形态负对照三用例（各配诚实对照，形态 C 含 ref 解析与 YXmlFragment 载体）；R4 增补：RT-1.6 删除负对照两用例（D1/D2 各配诚实对照）**

### DENY LIST

- `packages/vfsl/**` — 逻辑校验/wellFormedXml 零触碰（W2 词法镜像义务反向侧不动）
- `packages/persistence/**`、`packages/dsh-persistence/**` — ADR-0006 持久层，修订轮零触碰
- `packages/vfsl-codegen/**`、`packages/vfsl-protocol/**` — 编译期轨道无交集
- `docs/adr/**` — 出口 1 零 ADR 触碰（W2' 不触发）；SA1 无 ADR 写权
- `.github/workflows/**` — rev1 已含 materialize 专项门禁，rev2 无 CI 变更需求
- `packages/doc-runtime/src/extract.ts` / `read.ts` / `carrier.ts` / `resolve.ts` — 只读入口与共享件零改动（⑥ 仅**调用** extract / resolve，不改其实现——PA-8 的仲裁不对称是 extract 既定公共语义，按投影基准在 ⑥ 侧适配，不动 extract）

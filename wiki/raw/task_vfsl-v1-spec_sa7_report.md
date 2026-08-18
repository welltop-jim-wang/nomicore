# SA7 动态验证报告 — VFSL v1 方言规格文档（issue #4）

**Date**: 2026-08-18
**被验对象**: commit `c1fc25b`（交付物 `docs/vfsl/v1-spec.md` + SA6 验收机制 `tests/acceptance/`）
**Worktree**: `/home/wangjian/nomicore-refactor-vfsl-v1-`
**SA4 终审**: pass（R2，`task_vfsl-v1-spec_sa4_review.md` §8）。SA4 §6 称「无 SA7 动态验证项」——本报告**未采信该结论**，按总控指定的四项形态独立执行动态验证，并按职责只做「上发」：SA4 pass 基础上独立发现 fail。

---

## 0. Step 0 校对与验证方法

- SA4 终审：**pass**（R2，2026-08-18）→ 允许进入动态验证；SA7 仅可独立发现 fail，不下调。
- **干净检出**：`git -C <worktree> archive c1fc25b | tar -x -C /tmp/sa7-clean` —— 恰 10 个文件（`LICENSE`、`.gitignore`、8 个交付文件），**零 untracked 内容**（`TASK.md`、`.mabf-bg/`、SA4 报告均不在树中）——「不依赖任何未入库文件」由运行环境本身保证。
- **字节级同一性**：worktree 磁盘副本 == `HEAD` == 干净检出（`cmp` 零差异）；`git diff HEAD -- docs/ tests/` 为空 → 干净树结论可直接回推 worktree。
- **进程规范**：全部测试命令按 SKILL 以 `setsid nohup` 独立进程 + 轮询退出码文件执行。
- **端口**：本验收机制零端口、零服务（SA6 锚定记录成文）——无端口可释放，且按本 SA 纪律不盲用 `fuser -k`，未执行清场。
- 环境：Python 3.12.3（/usr/bin/python3），Linux 6.8.0-90-generic。
- Step 3（E2E spec 触发）/ Step 4（vitest 触发）：触发条件为 SA1 design 含 `*.spec.ts` / `*.test.ts`——本任务无此类文件、无 CI/push（任务纪律禁止 push/建 PR）→ **N/A**，不虚列触发证据。

---

## 1. V1 — 干净检出绿路径实跑 ✅

```
$ cd /tmp/sa7-clean && python3 tests/acceptance/vfsl_spec_acceptance.py   # 独立进程
exit code = 0
[PASS] ×21，[FAIL] ×0
尾行: GREEN（验收通过）: 21/21 项全部通过
```

- 运行树只含 `c1fc25b` 入库内容（§0），**不依赖任何未入库文件**得证。
- 与 SA4 R1 §0 / R2 §8.2 实跑口径一致（GREEN 21/21，exit=0），交叉复确认。

---

## 2. V2 — 红路径判别力独立复现 ✅（8/8 变异精确变红）

SA7 **自选变异集，与 SA4 的 17 变异体刻意不重叠**（全部落在不同检查路径上），在 /tmp 副本上施加，交付物未动：

| # | 变异（SA7 原创） | 预期 | 实际（exit / 命中） | |
|---|---|---|---|---|
| S1 | EBNF `FieldList` 产生式删组闭括号 `)`（文法结构破坏的新路径；SA4-M3 删的是终止符 `;`） | G4 | exit=1，仅 1 FAIL：`G4 — 1 处语法错误: 第47行: 缺少 ")"（( 组不闭合）` | ✅ |
| S2 | `YArray` 节语义表**表头**「写入粒度」→「写入单位」（丢「粒度」关键字；SA4-M4 改的是 PATCH 列**数据值**） | G7(YArray) | exit=1，仅 1 FAIL：`G7·YArray — 缺少三列语义表` | ✅ |
| S3 | 禁止清单 any 行**行列信息 cell** 去 `line/column` 字样（打 G9 的行列路径；SA4-M5 打的是码前缀路径） | G9 | exit=1，仅 1 FAIL：`G9 — any: 行列信息缺失或不符合（行/列/line/column）` | ✅ |
| S4 | 删禁止清单「递归 / 循环引用」行（SA4-M13 删的是 mapped type 行） | G8 | exit=1，仅 1 FAIL：`G8 — 缺少条目: 递归/循环引用` | ✅ |
| S5 | fixture `notes?:` 去可选 `?` | G16 | exit=1，仅 1 FAIL：`G16 — 缺少 ?: 可选属性` | ✅ |
| S6 | fixture `keywords: YLeaf<string>[]` 去 `[]` 后缀 | G16 | exit=1，仅 1 FAIL：`G16 — 缺少 T[] 数组后缀` | ✅ |
| S7 | `Field = Ident, [ "?" ], ":"` 删 `[ "?" ]`（文法仍结构合法 → G4 仍绿，隔离 G6；SA4-M15 删的是终元 `unknown`） | G6 | exit=1，仅 1 FAIL：`G6 — 缺少要素: ?（可选属性）` | ✅ |
| S8 | spec 文件缺失（复现 SA6 锚定记录的原始红灯形态） | 16 项全 FAIL | exit=1，16 FAIL，`G1 — 规格文档缺失` | ✅ |

- **判别力结论**：8/8 变异 exit=1 且精确命中预测检查组；单点变异均只红 1 项（S8 全红），无级联误伤、无恒绿。SA4 的「17 变异体全分辨」结论在**不相交的变异空间**上独立复现并加强。
- **插曲（如实记录）**：S3 首跑意外全绿——诊断为**SA7 驱动脚本锚点 bug**（`VFSL-E101` 在文中首次出现于 L260 正文示例而非 L278 表格行，replace 落空 → 副本实际未被变异）。修正锚点后 S3 如愿精确变红。教训已入报告：**判别力测试的绿灯必须与「变异确实生效」的 diff 证据配对**，否则会产生假阳性「通过」。此插曲不涉及交付物任何缺陷。

---

## 3. V3 — 交付物 EBNF 手工推导 fixture 构造 ✅（并交叉发现 F-1）

### 3.1 手工推导（5 个不同构造，按 §2 十四个产生式逐步展开）

**推导 1 — `type AssetId = string & Pattern<"^[A-Za-z0-9_\\-]{1,64}$">;`**
`Module → TypeAlias → "type" Ident("=") TypeExpr(";")`；`TypeExpr → UnionType → ArrayType → PrimaryType → **PatternType** → "string" "&" "Pattern" "<" StringLiteral ">"`。StringLiteral 内容含 `\\-`（注记 6 两个合法转义之一，双写反斜杠）、无行终止。✅ 可推导。

**推导 2 — `type Audit = YMap<{ createdBy: YLeaf<string>; createdAt: YLeaf<number> }>;`**
`PrimaryType → **Marker**（"YMap" "<" TypeExpr ">"）`；实参 `→ ObjectType → "{" [FieldList] "}"`；`FieldList → Field { (";"|",") Field }`（无尾分隔符，注记 3 合法）；字段类型 `→ Marker（"YLeaf" "<" PrimitiveType ">"）`。语义一致性：YMap 实参对象形 ✓（E304 表）、YLeaf 实参标量形 ✓。✅ 可推导。

**推导 3 — 判别联合 `type AssetEntity = | { kind: "image"; … } | {…} | {…};`**
`UnionType → ["|"] ArrayType {"|" ArrayType}`——**前导 `|`** 由 `[ "|" ]` 冻结（注记 2）；成员各为 ObjectType；`"image"` → `LiteralType → StringLiteral`；`Audit` → `TypeRef → Ident`；`tags: YArray<YLeaf<string>>` 为嵌套 Marker。语义一致性：三成员全容器形 → 多态 Y.Map，**非** E309（与附录声明一致）。✅ 可推导。

**推导 4 — `type Attachments = YPlainArray<YLeaf<string>>;`**
`Marker` 产生式第五分支。语义一致性：YPlainArray 子树为纯值上下文，禁**同步**标记（YMap/YArray/YXmlFragment → E307），`YLeaf` 是值语义标记、允许出现（§3「纯值上下文」）——fixture 用法与条款吻合。✅ 可推导。

**推导 5 — 复合根 `type AssetsDoc = YXmlFragment<{ … }>;`**
- `notes?: YLeaf<string>` → `Field → Ident [ "?" ] ":" TypeExpr`（`?` 可选）；
- `keywords: YLeaf<string>[]` → `ArrayType → PrimaryType {"[" "]"}`（注记 1 后缀紧贴 PrimaryType）；语义一致性：元素标量形 → 原生叶子元素（§3 三分类）；
- `assets: Record<AssetId, AssetEntity>` → `RecordType → "Record" "<" TypeExpr "," TypeExpr ">"`；E306 一致性：键 `AssetId` 经别名链解析为 `string & Pattern<…>` → string 形 ✓；
- `/** @semantic … */` 位于 `audit: Audit;` 分隔符与字段 `notes?` 之间——按**注记 9**（空白与注释是词法 trivia，可出现于任意记号边界、不参与语法推导）不破坏 FieldList 推导，且按 §5 挂载到下一声明性节点（属性 `notes?`，挂载表 L400 吻合）；E305 一致性：末条 JSDoc 有可挂载后续节点，非悬空。

✅ 可推导。附录 7 条 JSDoc 全部有挂载点（§5 挂载表 L392-400 与 fixture 逐条对得上）。

### 3.2 机械交叉核对（一次性诊断工具，未入库，worktree 零改动）

SA7 按 §2 EBNF + 注记 1/2/3/6/7/8/9/10 独立实现递归下降推导器（`/tmp/sa7-v3/derive.py`，纯诊断用），对三组样本实跑：

| 样本 | 结果 |
|---|---|
| 附录 fixture 全文 | **可推导：5 个别名**（AssetId, Audit, AssetEntity, Attachments, AssetsDoc），无残留记号 ✅ |
| §2 微示例（合法块，5 别名） | 全部可推导 ✅ |
| §2 微示例（非法块）逐条 | A `( … )[]` → 拒绝（`(` 不可推导，E100 类）✅ 与标注一致；B `Pattern<"a\d">` → 拒绝（E202 非法转义）✅ 一致；C `-1 \| 1` → 拒绝（`-` 不可推导，E100）✅ 一致；**D `type D = true \| false;` → 语法可推导（AST = union(ref true, ref false)）⚠ 与标注 E100 冲突 → 发现 F-1（§5）** |

**结论**：AC #1「EBNF 覆盖全部允许语法且能推出 fixture 每个构造」在**真推导**层面成立（验收脚本 G15/G16 只做两侧配对，不做推导——本节填补的正是该缺口）；3/4 负对照与规格标注一致；第 4 条暴露规格自身的错误码归属矛盾（下节）。

---

## 4. V4 — python3 依赖面检查 ✅

| 检查 | 证据 | 结果 |
|---|---|---|
| 导入面（AST 解析，非 grep） | `import` 集合 = `['os', 're', 'sys']`；网络/进程/线程类（socket/subprocess/urllib/http/…）零命中 | 纯 stdlib ✅ |
| 隔离模式 | `python3 -I tests/acceptance/vfsl_spec_acceptance.py`（忽略 PYTHONPATH 与 user site-packages） | GREEN 21/21，**exit=0** ✅ |
| cwd 无关 | 自 `/` 以绝对路径调用（`REPO_ROOT` 由 `__file__` 推导） | GREEN 21/21，**exit=0** ✅ |
| 字节码禁写 | `PYTHONDONTWRITEBYTECODE=1` | GREEN 21/21 ✅ |
| 端口/测试包 | 零端口、零测试包、无网络 | 与 SA6 锚定记录「无需 scripts/test-lock.sh」一致 ✅ |

---

## 5. F-1【FAIL-NEEDS-FIX】`true` / `false` 的错误码归属：规范文本自相矛盾（E100 vs E301）

### 5.1 现象（可复现）

规格自己的非法微示例（§2 L117）：

```
type D = true | false;   // VFSL-E100：布尔字面量不在 v1 字面量联合
```

按交付物 §2 文法机械推导：`true` / `false` 词法上匹配 `Ident = letter { letter | digit | "_" }`（L64，ASCII 冻结），而 `TypeRef = Ident`（L57）无任何排除条款 → `type D = true | false;` **语法可推导**为两个 TypeRef 的联合（SA7 推导器实跑 AST：`('D', ('union', [('ref','true'), ('ref','false')]))`）。

### 5.2 矛盾的两端（全部为交付物规范性文本）

**端 1 —— 标注 E100（以「不可推导」为前提）：**
- L117 微示例 D 注释：`VFSL-E100：布尔字面量不在 v1 字面量联合`；
- L336 错误码总表 E100 行：「越界语法：**不可从 §2 文法推导的任何构造**（…**布尔字面量联合**…）」——「布尔字面量联合」被显式列为 E100 条件，但该输入**恰恰可从 §2 文法推导**（见 5.1）。

**端 2 —— 机制给出 E301：**
- 判定顺序（L293-315）第 1~7 条对类型位置的裸 `true`：均不命中（非 `interface`/`extends`/`any`/`[`/声明名位；无后随 `<`，第 6 条不适用；第 7 条只覆盖**保留名**）；
- 保留名集合（L356-358，16 项穷举）：**不含** `true` / `false`；
- E301 条款（L346）：「未知名引用：引用未声明别名…**仅适用于非保留名的标识符**」——`true` 是非保留名标识符、未声明 → E301；
- §6 先例（L408-412）：与 `true` 完全同构的 `yleaf`（非保留名拼写）被明文处理为「未声明 → E301，且 `type yleaf = string;` 是合法别名声明」。`true` 无任何被区别对待的条款依据。

**加重项**：判定顺序第 7 条尾注（L314-315）明文允许「keyword 记号」与「统一 Ident + 后置查表」两种 tokenizer 设计并声称二者「产出相同的错误码与锚点」——该等价保证只对第 1~7 条穷举的保留名成立。`true`/`false` 既不在保留名集合、又不在等价保证内 → **tokenizer 设计选择（规格明文放行的自由度）直接翻转该输入的错误码**（keyword 设计 → E100；统一 Ident 设计 → E301）。

### 5.3 溯源与既往审查覆盖

- 缺陷源头在 SA1 基线：design L586 / L805 与交付物 L117 / L336 逐字同款；design L269-274 记录 SA2 曾问「`true | false` 联合合法吗？」，SA1 的决定只落在「不进入 LiteralType」（即注记 8），**从未处理 `true` 仍是合法 Ident → TypeRef 的引用路径**。
- SA2 两轮（F7 覆盖 yleaf/E301、未覆盖 true/false）与 SA4 R1/R2（N1~N5 触发例推演、未含布尔字面量）均未检出。SA7 经真机械推导发现——正是 SA4 §6「无动态验证项」结论被本报告推翻的直接证据。

### 5.4 影响（为何阻塞）

1. **错误码是冻结契约**：§8 L443「错误码稳定：已发布错误码的条件与含义不变」；L260-263 明文「issue #5 起的测试应以前缀（`VFSL-E<编号>:`）为断言锚」。同一输入两个可辩护的码 → issue #5 的断言锚不确定。
2. **强制下游静默决定**：§9 L451-452 要求 issue #5~#9「不得做静默决定」，而本条迫使实现者在 E100/E301 间自行挑选——规格自己制造了它禁止别人做的事。
3. **「唯一答案」声明被打破**：规格对判定顺序的立论（SA4 §1.5 亦引为依据「逐条推演均有唯一答案」）在该输入上不成立。
4. **时机敏感**：§8 L445-447 允许「首次发布前」修订不受只增不改约束——**必须在本任务闭环内修**；v1 冻结发布后再改 E100 行条件或保留名集合将违反「只增不改」。

### 5.5 修复建议（SA3 最小修复，二选一；SA7 不代选语义立场）

- **方案 A（统一 Ident 路线，与 §6 yleaf 先例对齐）**：L336 E100 行删去「布尔字面量联合」；L117 注释改为 `// VFSL-E301：true/false 未声明（布尔字面量不进入 LiteralType，注记 8；按未知名报错）`；可在注记 8 补一句「`true`/`false` 词法上是 Ident：未声明引用按 E301，亦可被声明为普通别名（与 §6 `yleaf` 同构）」。
- **方案 B（关键词路线）**：把 `true` / `false` 纳入保留名集合（L356-358）并同步判定顺序第 7 条保留名清单——则裸 `true` 于类型位置落第 7 条 E100（锚 `true` 记号）、`type true = string;` 落 E303；L117/L336 原文保留。改动点比 A 多一处（第 7 条），并需明文 `type true = string;` → E303。
- **验收机制兼容性**（SA7 已核对）：两案均不触碰 G1~G16 任一检查的扫描面（G8/G9 只读「禁止清单」表；G4 只校 EBNF 围栏块；G11 只查大小写节六拼写 +「未知名」；无检查读错误码总表或微示例注释）→ **修复后验收仍应 GREEN 21/21**。
- **修复后复核口径**：① 复跑 `python3 tests/acceptance/vfsl_spec_acceptance.py` = GREEN 21/21 / exit=0；② `type D = true | false;` 的错误码在全部规范性条款（文法、判定顺序、保留名集合、E301、§6）下有唯一答案；③ SA4 复核两处文本与既有条款无新矛盾。

---

## 6. 验证汇总

| 验证项 | 形态 | 结果 |
|---|---|---|
| V1 干净检出绿路径 | git archive c1fc25b → 独立进程实跑 | GREEN 21/21，exit=0，零未入库依赖 ✅ |
| V2 红路径判别力 | 8 个 SA7 原创变异（与 SA4 17 变异体不相交） | 8/8 exit=1 精确命中，无级联、无恒绿 ✅ |
| V3 EBNF 推导 | 5 构造手工推导 + 独立推导器交叉核对 | fixture 5 别名全可推导；3/4 负对照一致 ✅；第 4 负对照暴露 **F-1** ⚠ |
| V4 依赖面 | AST 导入 + `-I` 隔离 + cwd 无关 + 禁字节码 | 纯 stdlib（os/re/sys），全绿 ✅ |
| Step 3/4（CI 触发证据） | 无 `*.spec.ts`/`*.test.ts`、无 push/PR | N/A（如实声明，不虚列） |
| **F-1** | true/false 错误码归属矛盾 | **fail-needs-fix（唯一阻塞项）** |

SA6 验收机制本身（V1/V2/V4）经独立验证无弱化、无摆设、零依赖；交付物文法对 fixture 的推导能力（AC #1）在真推导层面成立。唯一阻塞项为 F-1：交付物（规格文本自身）一处规范性自相矛盾，修复为一处局部文字消歧（两案任一，均为段落级改动），且必须在 v1 首次发布前落地。

**Verdict（R1，已被 §7 R2 终验取代）**: fail-needs-fix

---

## 7. R2 终验（F-1 修复后增量复核，2026-08-18）

**被验对象**: commit `1599241`（SA3 按 §5.5 方案 A 修复 F-1；SA4 R3 终审 pass）。
**职责边界**: 按总控指定只做三项增量——§5.2 推演闭合复核、干净检出重跑验收、V2 判别力抽验；不重做 V1~V4 全量。

### 7.0 前置与修复面精确性

- **Step 0**：SA4 最新 verdict = **pass**（R3，`sa4_review.md` §9.7）→ 允许终验；SA7 仅可独立发现 fail，不下调。
- **干净检出**：`git archive 1599241` → `/tmp/sa7-r2-clean`，恰 10 文件、零 untracked；worktree 磁盘副本与干净检出 `cmp` 零差异（spec 31694 字节，与 SA4 §9.3 口径一致）。
- **修复面 diff**（`/tmp/sa7-clean` 的 c1fc25b 留档 vs 1599241 干净检出）：恰 19 行、**四处落点**逐处核对——注记 8 增补（L87-89「词法上是普通 Ident…E301…亦可被声明为普通别名」）、微示例 D 注释（L119，E100→E301）、判定顺序第 7 条尾注（L318-321「keyword 记号的分类以保留名集合为完备边界…两种 tokenizer 设计对非保留名标识符一律按普通 Ident 读法处理」）、E100 总表行（L342 删「布尔字面量联合」）——无任何其他改动。
- **围栏级比对**（脚本实跑）：`ebnf`、`vfsl`（fixture）、`json` 三类围栏 c1fc25b→1599241 **逐字 identical=True**，仅 `ts` 非法块样本 D 注释变化 → R1 推导器的文法前提（§2 EBNF）仍成立，复用合法。
- **端口**：验收机制零端口（R1 §0 口径）；SKILL 模板 `fuser` 行经 `ss` 复核为 no-op（8000/8081/3005 无监听），未误伤任何进程。

### 7.1 §5.2 推演闭合复核 ✅（三读法收敛，exit=0）

一次性诊断工具 `/tmp/sa7-r2-v3/adjudicate_r2.py`（未入库，worktree 零改动），三种**互相独立**的裁决：

- **读法 U**（统一 Ident + 后置查表）：R1 真推导器（tokenize/Parser 复用，文法前提已证）+ 语义层（未声明且非保留名 → E301；裸保留名引用 → E100；声明名位保留名 → E303，均按判定顺序第 7 条）；
- **读法 K**（keyword tokenizer）：独立模拟——保留名集合**自规格现文跨行解析**（16 项，不硬编码），按修订后尾注「完备边界」分类：集合内 → kw、集合外（含 true/false）→ 普通 ident；位置感知走查第 1/3/5/7 条后落语义相位；
- **规格标注**：非法微示例块行内 `// VFSL-Exxx` 自现文解析。

| 样本（规格非法块） | 规格标注 | 读法 U | 读法 K | 收敛 |
|---|---|---|---|---|
| A `type A = ( string \| number )[];` | E100 | E100 | E100 | ✅ |
| B `type B = string & Pattern<"a\d">;` | E202 | E202 | E202 | ✅ |
| C `type C = -1 \| 1;` | E100 | E100 | E100 | ✅ |
| **D `type D = true \| false;`（原第 4 条）** | **E301** | **E301** | **E301** | ✅ |

4/4 负对照三读法一致——R1 §5.2 的矛盾两端（标注 E100 vs 机制 E301）已收敛为**唯一答案 E301**。附加 7 探针全过：P1/P2 `type true = string;`、`type false = number;` 两读法同判合法（注记 8「亦可被声明为普通别名」活证据）；P3 先声明后引用的模块引用闭合（OK）；P4 `yleaf` 同构（E301）；P5 `type T = type;` 两读法同归 E100（第 7 条类型位置侧）；P6 primitive 基线（OK）；P7 `type any = string;` 两读法同归 E303（第 7 条声明名位侧）。

规格现文四要素在场性（harness 自现文断言）：E100 行无「布尔字面量联合」✅；保留名集合 16 项不含 `true`/`false` ✅；第 7 条 keyword 完备边界尾注在场 ✅；注记 8「词法上是普通 Ident」在场 ✅。R1 §5.2「加重项」——tokenizer 设计选择翻转错误码的豁口——由该尾注明文闭合，且经 K 模拟实跑证实收敛。

**§5.5 复核口径对照**：①验收复跑见 7.2；②唯一答案成立（文法、判定顺序、保留名集合、E301 条款、§6 yleaf 先例五类规范性条款下 `type D = true | false;` 唯一归 E301，两种 tokenizer 读法一致）；③SA4 R3 §9 已逐处复核四处落点与既有条款无新矛盾，SA7 侧 diff 佐证（无 EBNF/表格结构改动，仅段落级增补与措辞替换）。

**工具迭代如实记录**：harness 历经三轮自修——(a) 保留名集合单行正则截断为 7/16 项（规格列表跨行）；(b) `collect_refs` 只递归 tuple，union 成员 list 被整体丢弃致样本 D 引用收集为空；(c) K 声明名识别误按 ident 记号类型判（K 下 `type` 是 kw）；(d) K 第 5/7 条线性规则误伤合法 primitive 与声明名位保留名（改为位置感知）；(e) 联合续联未在产生式内部完成致 D/P3 误报 E100。全部为 **harness 自身缺陷**；交付物侧证据自首轮起稳定（A~D 收敛），最终版 exit=0。K 走查范围如实声明：第 2/4/6 条（E102/E104 族）未实现，本复核的样本与探针均不触发。

### 7.2 干净检出重跑验收 ✅

`python3 tests/acceptance/vfsl_spec_acceptance.py`（`/tmp/sa7-r2-clean`，独立进程）：**21 PASS / 0 FAIL，尾行 `GREEN（验收通过）: 21/21 项全部通过`，exit=0** —— §5.5 复核口径①满足，与 SA4 §9.4 双路径实跑及 R1 §5.5「两案均不触碰 G1~G16 扫描面」预判一致。

### 7.3 V2 判别力抽验 ✅（2/2 原变异复打，无退化）

| # | 变异复刻（R1 原创集） | 生效证据 | 实跑结果 | 对比 R1 |
|---|---|---|---|---|
| S1 | L47 EBNF `FieldList` 删组闭括号 `)` | diff `47c47` 单行 | exit=1，**仅 1 FAIL**：`G4 — 1 处语法错误: 第47行: 缺少 ")"（( 组不闭合）` | 逐字同形 ✅ |
| S3 | L280 禁止清单 any 行列 cell 去 `line/column` | diff `280c280` 单行 | exit=1，**仅 1 FAIL**：`G9 — any: 行列信息缺失或不符合（行/列/line/column）` | 同形 ✅ |

按 R1 §2 S3 教训，本次变异施加配齐三件套：**唯一锚点串 + 替换计数断言（=1）+ diff 生效证据**。修复四处落点均不在 G4/G9 扫描面，抽验证实判别力不因修复退化（2/8 抽样，其余 6 条变异所打路径的扫描面同样未被修复触碰——围栏级比对佐证）。

### 7.4 R2 汇总

| 项 | 形态 | 结果 |
|---|---|---|
| R2-1 §5.2 推演闭合 | 三读法独立裁决（真推导器 + keyword 模拟 + 规格标注） | 4/4 负对照 + 7/7 探针收敛，`type D = true \| false;` 唯一归 E301 ✅ |
| R2-2 干净检出验收 | git archive 1599241 独立进程实跑 | GREEN 21/21，exit=0 ✅ |
| R2-3 V2 判别力抽验 | S1/S3 复打（三件套证据） | 2/2 exit=1 精确命中，无级联、无恒绿 ✅ |
| 新问题扫描 | 修复 diff + 围栏比对 + 验收脚本 cmp | 恰四处落点、EBNF/fixture 围栏零变、验收机制字节级未动，无新阻塞 ✅ |

F-1 已按 §5.5 方案 A 精确闭合，R1 唯一阻塞项消除；三项增量验证全部通过，未发现任何新问题。

**Verdict**: pass

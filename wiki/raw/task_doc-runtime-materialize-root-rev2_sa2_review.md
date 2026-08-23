# SA2 攻击评审报告（rev2 第二阶段：设计攻击与破壁）

**Date**: 2026-08-23
**Verdict**: reject（窄幅驳回：**#1（CRITICAL，必修）+ #2（HIGH，必修）+ #3/#4（MEDIUM，随驳回一并修订）**；RD7 三窗口 guard 架构 / RD8 出口 1 方向 / RD9 / RD10 / RD11 / throw 形态定稿 / E202 错误码家族**全部经受住独立攻击，无需返工——不得借此推翻 guard、回退出口 2、或恢复受控 seam**）

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev2_design.md`（SA1 rev2 设计，607 行，RD7–RD11 / INV-11 / E202 / E201 变体 C-D）
- ADR 约束基准：`wiki/raw/task_doc-runtime-materialize-root-rev2_relevant_decisions.md`（ADR 0001–0007 全 accepted + RD7–RD11 登记 + W1/W2'/W2/W3/W4 红线）
- 评审方法：全新视角独立攻击 + 关键声明逐项实测复验（本报告 §实测复验记录 E1–E6，全部命令与输出内联，SA4/SA7 可重跑；探针脚本 `.mabf/sa2-attack/*.mts` 本地留存、不入仓；yjs 单实例加载经 dist 入口——SA1 §9 双实例陷阱注记有效，本人首轮探针即踩中该陷阱并以 dist 入口修正）
- SA8 移交观察项 O2（§3.1 窗口 B 表格谓词 vs §3.4 伪代码在 `tx===undefined + cleanups 非空` 情形报 B 还是 C）：已定性为本报告 **#3（MEDIUM，必修于文）**——两处规范文本确有出入，但 fail-closed 性质在所有分支成立（详见 #3 论证）。
- 红灯基线独立复跑：`vitest run` 两测试文件 = **4 failed（P1 T-1 + Medium ×3）/ 62 passed**——与 SA6 锚定表逐条一致（正向对照 / Minor-1 / Minor-2 绿），红灯契约属实。

## 结论一览

SA1 rev2 的两大主裁决（RD7 机制 (a) + 三窗口 throw E202；RD8 出口 1 + ⑥ 完整语义校验 + throw E201 变体 C/D）**方向与架构经独立攻击后成立**：

- **三窗口模型完备性（攻击面 2）——通过**。本人逐事件探针实测（E1）：yjs@13.6.32 全部事务生命周期事件中，`beforeAllTransactions`/`beforeTransaction` 处 `_transaction !== null`（窗口 A 覆盖），`afterTransaction`/`afterTransactionCleanup`/`update`/`updateV2`/`subdocs` 处 `tx===null && cleanups>0`（窗口 B 覆盖）；唯一例外 `afterAllTransactions`（此时 cleanups 已重置 `[]`，guard 放行）经实测（E2b）证明**真的安全**——该窗口内新开 transact 自含完整生命周期（其 observer 在 transact 返回前派发完毕），⑤⑥ 检测面有效。**未发现第四个假成功窗口**。误报面（正常最外层调用被误判）：干净语境三谓词均不命中，正常调用零误报（62 个既有用例全绿佐证）。
- **yjs 私有字段耦合（攻击面 1）——通过（带 #10 措辞修订）**。字段改名/缺失/双实例全部落入 fail-closed 或响亮过拒绝（见 #10 论证）；guard 用属性读取而非 `instanceof`，对双 yjs 实例反而比包内 `carrierOf` 更鲁棒（本人实测：双路径 import yjs 会击穿 `instanceof` 判定使 carrierOf 误报 plain value，但属性读取不受影响）。
- **⑥ 的 ⑤→⑥ TOCTOU（攻击面 3 子项）——不成立（设计无洞）**：⑤ 与 ⑥ 均为纯读、不触发任何 yjs 回调（yjs observer 全同步、只在 transact/cleanup 栈内派发），两阶段之间无用户代码可运行；异步修改被 INV-11 契约时点（= 返回时）明文排除。**此项确认设计正确**。
- **RD10 极深树 20_000 / CI 稳定性（攻击面 6）——通过**。栈溢出点环境方差只影响「② 是否更早溢出」（仍然 E200，测试仍绿）；唯一破坏向（② 容忍度翻倍到 >20_000）已被 R-4 登记且失败方向 loud（④ raw throw 变红，不静默假绿）。内存/耗时 ~140KB 字符串 + 2 万层装配，CI 可承受。
- **但 RD8 ⑥ 的比较器语义有一处实测证实的 CRITICAL 漏洞（#1）**：合法的重叠联合输入（ADR-0003 明文「重叠成员不构成错误」）在**零 observer、零攻击**的诚实路径上，extract 读回投影 ≠ 输入快照——⑥ 按设计 §4.2 表格的键集相等语义必然 throw E201-C，把合法 create 变成 fatal 假指控。R-2 的前提「①② 构造保证二者同源」被实测证伪。且 SA6 既有/新增用例**零覆盖**该形态（fixture 联合三成员互斥判别），SA3 全量跑绿门禁无法暴露——若不修，缺陷静默上线。
- **RD7 的窗口 B / 窗口 C 行为没有任何测试锚定（#2）**：§7 对齐表只覆盖窗口 A（T-1）；设计自证的漂移缓解「P1 拒绝测试锁行为——漂移即 CI 红」实际只锁了窗口 A——窗口 B（本轮设计的头号新发现）与窗口 C（fail-closed 兜底）无红灯、无绿灯、无任何断言。

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议（可执行修订要求） |
|---|--------|--------|---------|------|
| 1 | **CRITICAL（必修）** | RD8/⑥ firstSemanticDifference union·map 行 / R-2 前提 / INV-11 正向路径 | **重叠联合（overlapping union）合法输入在诚实路径上被 ⑥ 误报 E201-C（假阳性 fatal）。** 机理：② build 的成员试验对未声明键**拒绝**（mapEntries F7「拒绝静默丢键」），extract 的成员试验对未声明键**忽略**（D4「未知键不报不进快照」+ trialMember 封闭 map 只遍历声明字段）——两套仲裁谓词不对称：build 选中**后**成员（全量安装），extract 选中**前**成员（窄投影丢键），`extractYjsSnapshot(doc) ≠ input` 在**无任何 observer** 时即成立。实测复现（E4，当前实现，零 observer）：`type ROOT = { a: YLeaf<string> } \| Record<string, YLeaf<string>>;` + 输入 `{a:'x',k:'y'}` → ① validate ok:true → materialize ok:true（安装 `{a,k}`）→ extract 投影 **`{a:'x'}`（k 被丢）**；嵌套联合（`{ u: {a} \| Record<...> }`）与双封闭成员子集重叠（`{a} \| {a,k}`）同款复现（E4 C2/C3）；互斥联合对照组投影相等（E4 C4）——问题精确落在重叠成员。按设计 §4.2 表逐行推演：member1（封闭 `{a}`）输入侧含未声明键 k → 结构不匹配；member2（Record）两侧匹配但动态键集 `{a,k}` vs `{a}` 不等 → 全拒 → **throw E201-C**，消息指控「疑似 observer 对已安装子树的嵌套就地修改」——对诚实调用方是假指控；写入已提交不可重试（③ ROOT 非空拒再入），**该 schema 形态的 create 被整体废掉**。后果链：(a) R-2「假阳性唯一理论源 = extracted ≁ input，而 ①② 构造保证二者同源」前提**被证伪**；(b) §7 零回归论证与 SA6 全部用例（fixture 三成员互斥判别联合 + Medium 封闭 map）都不覆盖重叠形态 → SA3 门禁绿≠正确；(c) INV-11 承诺对合法输入反向违约 | **修订比较器语义（推荐方案 a）**：(a) union 行改为**按成员投影比较**——按声明序取首个「extracted 侧被该成员接受（镜像 extract trial 语义：封闭 map 只看声明字段、Record 全键）」的成员 M，把**输入侧按 M 的投影语义投影**（封闭 map：只取声明键 + undefined 视同缺席；Record：全键）后与 extracted 比较，相等即过（对 Medium 攻击仍有效：声明键值变 → 两投影不等 → E201-C；对 C1/C3 诚实路径：member1 投影 `{a}` vs `{a}` → ok）；或 (b) 对称重物化比较——把输入经同一 ②③④ 物化进一次性 scratch Y.Doc 再 extract 双侧比较（构造性对称，成本 2×）；或 (c) 等价精度的其他方案，但**必须**以「extract 投影语义」而非「原始输入」为比较基准。同时：① §4.2 表 union 行与 map 行相应改写；② R-2 前提句改为如实表述（build/extract 仲裁不对称 + 比较基准=投影）；③ §4.4 JSDoc 成功语义措辞同步（见 #9）；④ §7 对齐表新增重叠联合正/负用例（见红线测试 RT-1） |
| 2 | **HIGH（必修）** | RD7 窗口 B/C 测试锚定 / §7 对齐表 / R-1 缓解声明 | **窗口 B 与窗口 C 的 guard 行为零测试覆盖。** §7 对齐表 7 行全部落在窗口 A（T-1）与 ⑥/E200 面；SA6 双测试文件（本人全读）亦无任何 B/C 用例。R-1 缓解列明文「P1 拒绝测试锁行为——漂移即 CI 红」——实际只锁窗口 A：若未来 yjs 在 13.x 内改 cleanup 队列重置时点（`_transactionCleanups = []` 提前/延后），窗口 B 检测静默失效（假成功回归）或误报面扩大，CI 均不变红；窗口 C 的 fail-closed 兜底（RD7 摘要的核心安全声明「版本漂移的失败方向是安全侧」）同样无断言。SA3 实现 B/C 后无绿灯可对、SA7 活链路无锚可验 | §7 对齐表新增两行并落测试（SA6 owned 或 SA3 增补，测试文件仍在 ALLOW list）：**RT-2 窗口 B 拒绝**（one-shot ROOT observer 内调用 materializeRoot → throw `/DOCRT-E202/` 且消息含 cleanup/observer 提示；observer 入口处 stateBytes 与调用后逐字节不变——本函数零写入；ROOT 保持外层写入原状）；**RT-3 窗口 C fail-closed**（`new Y.Doc()` 后 `delete (doc as any)._transaction` → E202 变体 C；`_transactionCleanups = {}` 非 Array → 变体 C；断言消息含「无法确认…事务状态」与版本核对指引）。可顺带把 T-1 占位 `/DOCRT-/` 收紧为 `/DOCRT-E202/`（设计已注明非必需，建议本轮一并做，三变体消息已逐字定稿） |
| 3 | **MEDIUM（必修于文）** | RD7 §3.1 窗口 C 表格谓词 vs §3.4 伪代码（SA8 移交 O2；总控重点攻击项） | **两处规范文本存在两处分歧，SA3 以伪代码为锚会继承与表格相悖的分类。** 分歧一（O2 原案）：`tx === undefined && cleanups 为非空 Array` → 表格判 C（「含 undefined/缺字段」），伪代码判 **B**（skip A → Array.isArray 通过 → length>0 → E202_MSG_B）。分歧二（本人补充）：`tx` 为 truthy 垃圾值（如 `{}` / `'x'` / `false` 之外的垃圾对象）→ 表格判 C（「非 null 非 Transaction 形态」），伪代码判 **A**。fail-closed 性质不受影响——**每个实际抛出的分支里，消息的事实性宣称都为真**（A 支「doc._transaction 非空」在 truthy 垃圾时为真；B 支「_transactionCleanups 非空」在 undefined-tx + 非空队列时为真），且真实漂移形态（单字段改名 → tx undefined + cleanups=[] 或 tx null + cleanups undefined）实测推演均正确落入 C；但 (a) 规范内部不自洽（表格承诺了「Transaction 形态检查」，而 §3.2 缓解④明言「只读布尔谓词，不依赖内部结构细节」——表格与伪代码各说一边）；(b) 手造 stub（tx undefined + 非空队列）会收到 B 的错误整改指引（「请勿在 observer 回调内调用」），南辕北辙 | 二选一收敛（推荐前者）：(a) **保留无形态检查的伪代码，改写 §3.1 窗口 C 行**为与伪代码逐分支等价的 fall-through 定义——「C = `tx === undefined`（任意 cleanups 形态下 `tx !== null` 即不放行）或 `cleanups` 非 Array」；并删去「非 Transaction 形态」字样，明示「不做 Transaction 形态嗅探（§3.2 缓解④），truthy 异常 tx 按 A 报（消息事实为真：_transaction 非空）」；(b) 或在伪代码 A 检查前加 `if (tx === undefined) throw E202_MSG_C;` 并同步表格删除「非 Transaction 形态」承诺。定稿后 §3.1/§3.4/摘要三处口径一致 |
| 4 | **MEDIUM（必修于文）** | RD7 §3.1 窗口 B 描述完备性 / afterAllTransactions 第四态 | **`afterAllTransactions` 回调内 `cleanups` 已被重置为 `[]`（E1 实测：`{"tx":"null","cl":0}`）——guard 放行，但调用点确在事务事件回调内**，与 §3.1 窗口 B 行「调用点在**任一** observer/事务事件回调内」的描述矛盾（该行宣称 B 覆盖一切回调，实际 afterAllTransactions 例外）。本人实测（E2b）证明该例外**安全**：afterAllTransactions 内新开 transact 自含完整事务生命周期（ROOT-obs → INNER-obs 均在 transact 返回前派发完），⑤⑥ 检测面有效——即三窗口模型的实际判定域正确，**但设计未登记该例外与安全论证**。SA4/SA7 按文索骥会把「afterAllTransactions 放行」误判为漏洞（本人初审亦险些误判）；且嵌套 afterAllTransactions 会再次 emit（yjs 既定行为，调用方自递归风险归调用方） | §3.1 窗口 B 行追加排除条款：「明文排除：`afterAllTransactions` 回调——此时 `_transactionCleanups` 已重置 `[]`（Transaction.js:392 先重置再 emit），该窗口内新开 transact 自含完整 cleanup 生命周期（实测 E2b：其 observer 在 transact 返回前派发完毕），⑤⑥ 检测面有效，放行是正确行为而非漏判」；§9 协议表可加一行 PA（依据：Transaction.js:391-393 + 实测） |
| 5 | **MEDIUM-LOW** | RD7 窗口 B 误报面 / cleanup 队列残留（wedge） | **事务 cleanup 队列可被永久卡死，此后一切干净顶层调用永吃 E202-B 且整改指引错误。** 实测（E3）：`update` 回调抛异常（如持久层 saveDoc 落盘失败——ADR-0006 模式的正当监听者）→ 异常从 cleanupTransactions 的 **finally 块内**抛出 → 队列排空尾部代码不执行 → `_transactionCleanups` 永久非空（实测卡在 length 1）；此后任何干净顶层 transact 静默追加队列（实测第二次 transact 后 length 2）且 **observer 永不再派发**（实测 W-observer 计数 0）。此状态下 guard 对完全无辜的顶层 materializeRoot 调用报 E202-B，消息指引「请勿在 observer/事务事件回调内调用，移至事务外重试」——调用方根本不在回调内，整改方向全错。注：fail-closed 方向本身**可辩护**（doc 的事务派发机制已死，后续写入的 update 事件永不发出 = 持久化黑洞，拒绝写入是安全侧），缺陷仅在诊断误导 + 未登记 | ① E202_MSG_B 末句追加诊断分支：「若调用点确不在任何回调内：该 doc 的事务 cleanup 队列异常残留（此前 update/afterTransactionCleanup 回调抛异常所致），事务派发机制已损坏——请勿继续复用该 doc 实例」；② §8 登记 R-7 残余（wedge 形态、实测编号 E3、fail-closed 定性）；③ 可选 RT-4 characterization 锁定 loud 方向 |
| 6 | **MEDIUM-LOW** | RD8 §4.2 union 行「两侧结构均匹配」谓词未定义 | 比较器核心谓词只有六个字，未给出 per-kind 定义（封闭 map 成员：在场键是否须全部声明？必填缺席如何判？Record 成员：单字段 '<key>' 判定；union 嵌 union；leaf/plain 成员是否恒「匹配」）。即使 #1 修复后，SA3 仍需自行发明该谓词——发明错向即回到 #1 的假阳性或产生假阴性。仓内已有两套成熟先例（build 的 mapEntries/buildUnion 形状断言、extract 的 trialMember 三结局），设计应指名复用哪套语义，不留白 | §4.2 union 行把「结构匹配」展开为逐 kind 判定表（与 #1 修复方案 a 的投影语义一体定稿）：封闭 map = 在场键全部有声明字段（present 惯例）+ 载体 plain object；Record = recordSlotOf 同款判定；array = Array.isArray；xml-fragment = string；leaf/plain = JSON 域直入；并注明「与 extract trialMember 的接受语义镜像（对 plain 值的投影版）」 |
| 7 | **LOW** | RD8 变体 C→D 降级面 / §4.2 变体 D 触发枚举 | observer 可把检测从 C 降级为 D：向已安装 XmlElement `setAttribute('a','x"y')`（含双引号——② 只拦输入侧，observer 侧无拦）或注入裸 `<` 文本 span → extract 侧字符串不可扫描 → canonicalXmlOf 失败 → E201-D（「不代表已检测到偏离」）。仍是 loud throw、绝不 ok:true（owner 底线守住），但 §4.2 变体 D 的触发枚举（「深栈溢出、比较器自身异常」）漏了「提取侧 XML 不可扫描」这一**可达且由攻击者主动触发**的类，SA7 活链路排查时会对不上号 | 变体 D 触发枚举补第三类：「提取侧 XML 无法完成 canonical 扫描（如 observer 注入含 `"` 属性值/裸 `<` 文本）——防线未运行，不谎报偏离」；可选 RT-6 锁定「不可扫描也绝不 ok:true」 |
| 8 | **LOW** | E202/E201 消息面（总控攻击面 4） | 三点：(a) E202-B「doc 零写入」在窗口 B 语境下有歧义——外层事务的写入已在 store 内，宜改「本函数零写入」（A/C 变体同理可顺带）；(b) E201-C detail 内嵌两侧值摘要 ≤120 字符——文档数据进错误文本（E201-A 键集先例在，截断有界，可接受，登记即可）；(c) C/D/E202 变体只能靠 message 正则区分（无结构化 code 字段）——与仓内既有约定一致，不强求，未来若调用方需要程序化分型可加 `err.code`（非本轮）。变体 C/D 的区分设计本身（D 明示「不代表已检测到偏离」）经攻击确认**不存在可滥用面**：D 无法被调用方当作「其实没偏」的依据——消息明示防线未运行 | (a) 三变体「doc 零写入」→「本函数零写入」；(b)(c) 登记不动 |
| 9 | **LOW** | INV-11 措辞 / extract-D4 投影边界 | INV-11「完整逻辑快照语义等价」会被读者过度解读为「doc 内不含任何多余内容」：extract D4 使 observer 向已安装**封闭 map 增未声明键**（值合法与否皆可）完全不可见（extract 不读、⑥ 不比、validate 不见）——⑥ 的保证是**投影等价**而非载体洁净。该边界继承自 D4（非本轮新增缺陷），但 INV-11 升格后必须显式声明，否则与 owner「明确边界」的措辞不符 | §4.4 第 3 条追加一句：「检测基准 = extract 投影语义（D4：结构树未声明的键不入投影，亦不入检测面）——observer 向封闭子树注入未声明键不在 ⑥ 可见范围，由 ADR-0007 observer 纪律治理」（与 #1 修复后的比较基准措辞一体） |
| 10 | **NIT** | R-1 版本锚定措辞 / 私有字段耦合综述（总控攻击面 1 收口） | R-1「版本锚定 ^13.6.30（锁定 13.x）」略有过载：semver 不保护下划线私有字段，13.x 内的 minor 完全可改内部字段——真正的保护是窗口 C fail-closed + 测试锁定（两者都在），措辞应如实。综述定谳（攻击面 1 收口，供 SA4/SA7 引用）：(i) 字段**改名/缺失**（单字段或双字段）→ 实测推演全部落入 C fail-closed；(ii) 同名**语义漂移**（idle 期 tx 恒非空 / cleanups 恒非空）→ 全量用例响亮变红（过拒绝，非假成功）；(iii) **minify/打包**：属性改名若一致作用于 yjs 内部则 yjs 自毁在前，不一致则 doc-runtime 侧读到 undefined → C；(iv) **双 yjs 实例**（dual-package）：guard 属性读取不受类身份影响（对照：包内 carrierOf 的 instanceof 判定会被双实例击穿——本人实测 E6），当前仓内单版本 13.6.32（pnpm store 唯一），未来多版本共存时跨实例 doc 的字段若同名同义 guard 仍有效、改名则 C | R-1 缓解列①改写为「版本锚定 ^13.6.30（约束安装面；对私有字段的实际保护 = 窗口 C fail-closed + 测试锁定，非 semver 承诺）」；§3.2 耦合行可补一句「guard 为属性读取、无 instanceof 类身份依赖——对双 yjs 实例加载形态免疫（对照包内 carrierOf）」 |

（#5–#10 为修订建议与登记项，不计入驳回理由；#1/#2 必修，#3/#4 必须随驳回一并修订文本后放行。）

## 协议假设依据审查

- **章节存在性**：§9 存在，PA-1~PA-7 七条，依据类型标注（源码引用 + 设计期实测）并内联 §9.1/§9.2 命令与输出。✅
- **依据可验证性（本人独立复验）**：PA-1/PA-2（事务窗口三态）——源码核对（`Doc.js:75/79` 初始化、`Transaction.js:412-435` 归并/收尾/reset）+ 本人逐事件探针 E1 独立复现（含 PA 未列的 afterAllTransactions 态，见 #4）；PA-3（cleanup 窗口新开 transact 追加队列 + observer 延后派发）——源码机理核对（push 至 `transactionCleanups`、`finishCleanup===false` 时不触发 cleanup）+ 本人 E3 队列卡死实验间接复证（队列只增不排空时 observer 永不派发）；PA-4（`Doc.d.ts:49/53` 公开类型声明）——本人直接核对属实，`package.json` `yjs: ^13.6.30` 与声明一致；PA-5（extract INV-6 不外抛）——`extract.ts` 顶层 try/catch 在文；PA-6（XML 语义规则 4）——`xml-parse.ts` 头部规则 1–4 在文，canonical 归一化五要素（属性排序/last-wins/引号/自闭合/span 逐字）与规则 3「拒属性值含 `"`」自洽（值域无 `"` 使双引号渲染无歧义），实体不对称不存在（双侧均不解码、逐字往返，A13/A22 依据链在文）；PA-7（④ 最浅闸门标定）——与简报 SA6 小节一致。✅
- **无据推断**：未发现「应该/通常/预计」类空依据条目。⚠️ 但存在**一条未登记且被证伪的隐含假设**：R-2/§4.2 全部的「extracted ≡ input 同源」前提（#1）——它甚至没有以 PA 形式登记，而恰是全设计唯一被实测击穿的假设。#1 修复时应将其显式登记为 PA 并给出投影基准依据（extract.ts trialMember/map 走读 D4 + E4 实测）。
- **实测声称有命令有输出**：§9.1/§9.2 内联完整；本人复验输出见下文本节，SA4 可对表重跑。

## 错误处理链路审查

（对象为同步库函数，无 UI/异步任务面；按立法项逐条）

- **静默失败检查**：写前语境违规（A/B/C 三窗口）全部 loud throw E202 且本函数零写入——owner P1 的「ok:true 假成功」在契约时点内**不再有静默通道**（三窗口完备性经 E1/E2b 逐事件验证 + afterAllTransactions 例外安全论证；wedge 形态 loud 见 #5；异步修改被契约时点定义显式排除并成文）。写后偏离 ⑥ 变体 C/D 均 loud throw，D 的诚实性措辞（「不代表已检测到偏离」）经攻击确认无谎报面——唯一缺口是 #7 的 D 触发枚举漏类与 #1 的**反向**问题（把无偏离诚实路径谎报为 C 偏离——这是 #1 定 CRITICAL 的原因之一：E201-C 消息对诚实调用方构成事实指控）。
- **状态闭环**：不适用（无 exStatus 类状态机）；E100/E200/E201（A-D）/E202 五码写前/写后、throw/ok:false 通道分立经全文检索互斥无混用（设计 §12 自检 + 本人抽验属实）。
- **降级路径**：无运行时降级开关（「不设预算开关」明文，反 pattern 规避正确）；R-2 的「单点禁用回退」为登记式应急杠杆且须走设计评审，非运行时降级。外部依赖（yjs）行为假设全部源码+实测锚定。
- **虚假降级识别**：出口 2 否决论证（「把『返回成功但快照可能已偏』制度化」= 伪降级）成立且彻底；RD10 拒 seam（生产代码测试后门）与 loud-fail 文化同向；**未发现新伪降级**。特别核验：窗口 C fail-closed 不是伪降级（检测不可信即拒，方向安全侧）；#5 wedge 拒绝不是伪降级（doc 派发机制已死，拒绝写入有实质安全收益）。
- **极端异常输入**：⓪ guard 只读两属性 + throw，无 panic 面；⑥ 对提取/比较异常收敛 C/D（R-3 深栈归 D 诚实）；对抗 Proxy 双读发散 → E201-C loud（R-5 立场与初轮 F7 一致）。

## 红线测试思路（SA6/SA3 落地参考；每攻击点至少一条）

- **RT-1（#1，CRITICAL 配套——重叠联合正/负三用例，SA6 或 SA3 增补）**：
  1. 诚实正路径：`type ROOT = { a: YLeaf<string> } | Record<string, YLeaf<string>>;` + 输入 `{a:'x',k:'y'}`（① validate 前置断言 ok）→ materializeRoot **不得 throw**、`ok:true`；并 characterization 锁定 extract 投影 `{a:'x'}`（D4 仲裁现状，防未来静默漂移）。
  2. 嵌套形态：`{ u: { a: YLeaf<string> } | Record<string, YLeaf<string>> }` + `{u:{a:'x',k:'y'}}` → 同上。
  3. 双封闭成员子集重叠：`{ a: YLeaf<string> } | { a: YLeaf<string>; k: YLeaf<string> }` + `{a:'x',k:'y'}` → 同上。
  4. 负对照（检测不弱化）：同 1 的 schema，one-shot observer `uRef`/root 子树改声明键值（`set('a','HACKED')`）→ `toThrow(/DOCRT-E201/)`——证明 #1 修复（投影比较）没有把 Medium 检测面修没。
- **RT-2（#2，窗口 B 拒绝测试）**：`root.observe` one-shot 回调内：记录入口 stateBytes → 调 materializeRoot → 捕获 throw，断言 `/DOCRT-E202/` 命中且消息含 cleanup/observer 提示；断言 stateBytes 跨调用逐字节不变（本函数零写入）、ROOT 键集保持外层写入原状；`update` 事件计数不因 materializeRoot 增加。对照组：`doc.on('afterAllTransactions')` one-shot 内调用 → **ok:true** + extract 语义等价（把 #4 的例外与安全论证测试化，防 SA3 实现误把 afterAllTransactions 也拒掉）。
- **RT-3（#2，窗口 C fail-closed 测试）**：`const d = new Y.Doc(); delete (d as any)._transaction;` → `toThrow(/DOCRT-E202/)` 且消息含「无法确认」「版本兼容性」；`d._transactionCleanups = {}`（非 Array）→ 同上；`{}` 垃圾 tx（`d._transaction = {} as any`）→ E202（按 #3 定稿后的变体断言：A 或 C，与修订文本一致）。零写入断言：对 fresh doc 断言 stateBytes 不变。
- **RT-4（#5，可选 characterization）**：注册会抛异常的 `update` 回调 → 捕获外层 transact 异常 → 顶层再调 materializeRoot → 断言 throw `/DOCRT-E202/`（锁 loud 方向，永不 ok:true）；消息断言按修订后的诊断分支（含「队列残留」提示）。
- **RT-5（#7，可选）**：one-shot observer 对已安装 XmlElement `setAttribute('q', 'x"y')` → 断言**不得 ok:true**（`toThrow(/DOCRT-E201/)`，变体 D 或 C 皆可，主锚「绝不假成功」）。
- **RT-6（既有面对齐复查）**：T-1 收紧 `/DOCRT-E202/`；Medium ×3 保持 `/DOCRT-E201/`（变体 C 命中）——SA6 已就位，SA3 落地后全量跑绿。

## 实测复验记录（本人独立执行，2026-08-23，yjs@13.6.32 / Node v24.13.0，探针留存 `.mabf/sa2-attack/`）

**E1 —— yjs 事务生命周期逐事件三态探针**（`node --input-type=module`，doc 上挂全事件监听后 `ROOT.set('a',1)`）：

```
beforeAllTransactions : {"tx":"NON","cl":1}   → 窗口 A ✓
beforeTransaction     : {"tx":"NON","cl":1}   → 窗口 A ✓
afterTransaction      : {"tx":"null","cl":1}  → 窗口 B ✓
afterTransactionCleanup:{"tx":"null","cl":1}  → 窗口 B ✓
update                : {"tx":"null","cl":1}  → 窗口 B ✓
afterAllTransactions  : {"tx":"null","cl":0}  → guard 放行（#4：实测安全例外）
idle after            : {"tx":"null","cl":0}
```

**E2b —— afterAllTransactions 内新开 transact 自含性**（one-shot）：

```
cleanups in afterAllTransactions: {"tx":"null","cl":0}
order: ["ROOT-obs","INNER-obs","aat:inner-transact-returned"]   ← 新事务的 observer 在 transact 返回前派发完毕
final idle: {"tx":"null","cl":0}
```

（注：afterAllTransactions 内无 one-shot 守卫的自递归 transact 会触发 yjs 层无限重入 RangeError——调用方侧风险，非 materializeRoot 面。）

**E3 —— cleanup 队列卡死（wedge）**：

```
注册一次性抛异常 update 回调 → transact 抛 'persistence flush failed' 被外层捕获
after catch, doc state: {"tx":"null","cl":1}                     ← 队列未排空
第二次干净顶层 transact: ok，但 W observer fired: 0              ← observer 永不再派发
state now: {"tx":"null","cl":2}                                  ← 队列只增不排空（永久卡死）
```

**E4 —— 重叠联合投影不对称（#1 核心证据；tsx 直跑现实现，零 observer）**：

```
C1 ROOT = { a: YLeaf<string> } | Record<string, YLeaf<string>>;  input {a:'x',k:'y'}
   ① validate ok: true   materialize: {"ok":true}   extract 投影: {"a":"x"}   input: {"a":"x","k":"y"}
C2 ROOT = { u: { a: YLeaf<string> } | Record<string, YLeaf<string>> };  input {u:{a:'x',k:'y'}}
   ① validate ok: true   materialize: {"ok":true}   extract 投影: {"u":{"a":"x"}}   input: {"u":{"a":"x","k":"y"}}
C3 ROOT = { a: YLeaf<string> } | { a: YLeaf<string>; k: YLeaf<string> };  input {a:'x',k:'y'}
   ① validate ok: true   materialize: {"ok":true}   extract 投影: {"a":"x"}   input: {"a":"x","k":"y"}
C4 对照（互斥成员）ROOT = { b: YArray<...> } | Record<string, YLeaf<string>>;  input {q:'z'}
   materialize ok   extract 投影: {"q":"z"}  == input ✓   ← 问题精确落在重叠成员
结构树核对：union members = [map{a}, map{'<key>'}]（Record 即单字段 '<key>' map）——
build 走 member2（member1 因 F7 拒未声明键 k），extract trial 走 member1（D4 忽略 k 先接受）。
```

**E5 —— 红灯基线复跑**：`node_modules/.bin/vitest run packages/doc-runtime/test/materialize-root.test.ts packages/doc-runtime/test/materialize-root-rev2.test.ts` → **4 failed（T-1 主锚 762 行 expected true not to be true + Medium ×3 toThrow 未抛）/ 62 passed**——与 SA6 锚定表一致。

**E6 —— 双实例陷阱旁证**：探针经 `yjs/src/index.js` 与 dist 双路径 import 时，`carrierOf` 对真 Y.Map 误报 plain value（instanceof 类身份断裂），而 `_transaction`/`_transactionCleanups` 属性读取不受影响——#10 中「guard 对双实例免疫、carrierOf 不免疫」论断的实测依据。

**复验命令**（SA4/SA7 可重跑）：

```bash
cd <worktree>/packages/doc-runtime
node --input-type=module -e "<E1/E2b/E3 内联脚本>"        # 事务窗口/自含性/wedge
node_modules/.bin/tsx <worktree>/.mabf/sa2-attack/probe3.mts   # E4 重叠联合（脚本留存）
cd <worktree> && node_modules/.bin/vitest run packages/doc-runtime/test/materialize-root.test.ts \
  packages/doc-runtime/test/materialize-root-rev2.test.ts      # E5 红灯基线
```

## 放行条件（SA1 修订后重新送审口径）

1. #1：比较器 union/map 语义按投影基准重写（§4.2 表 + R-2 前提句 + §4.4 措辞 + RT-1 用例入 §7 对齐表）。
2. #2：§7 对齐表补窗口 B/C 两行 + RT-2/RT-3 测试落点（SA6 owned 或 SA3 增补，文件均在 ALLOW list）。
3. #3：§3.1 窗口 C 行与 §3.4 伪代码收敛为单一口径（推荐保留伪代码、改写表格行）。
4. #4：§3.1 登记 afterAllTransactions 例外 + 安全论证（E2b 依据）。
5. #5–#10：按清单修订/登记（非阻塞，但 #5 消息分支与 #9 措辞与 #1 修复一体落文最顺）。

RD7 机制选型、三窗口判定域、throw 形态、E202/E201 家族、RD9/RD10/RD11、RD11 版本面均**无需改动**——本轮驳回面收敛在 ⑥ 比较器语义与 B/C 测试锚定两处。

---

# SA2 R2 评审（2026-08-23，第二轮——R1 reject 后复审 SA1 修订稿）

**Verdict: reject（第二轮窄幅——唯一必修 F-R2-1：⑥ union 行 any-of「diff 后继续 + 任一 equal 即胜」引入可达假阴性；F-R2-2 一处文本收敛残留随驳修订。其余 10 项中 8.5 项全部合格落实，修订面之外零越权改动）**

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev2_design.md` R2 修订稿（607 → 843 行，R2 修订点全文标注 + 文末 10 项逐条回应表）
- 评审方法：对 R2 修订面逐项核验 + **对修订比较器规格做忠实仿真实测**（含 ref 解析——设计 §4.2 表第一行；SA1 §9.3 仿真脚本未解析 ref，见 F-R2-1 附注）+ 修复方案十场景验证
- 探针：`.mabf/sa2-attack/r2-masking-probe.mts` / `r2-masking-probe2.mts` / `r2-fix-verify.mts`（本地留存，不入仓；tsx 经 dist 单实例 yjs）

## R1 十项落实核验

| R1 # | 落实判定 | 核验依据 |
|---|---|---|
| #1 CRITICAL（重叠联合假阳性） | **半落实——假阳性已消除，但引入假阴性（F-R2-1，本轮唯一必修）** | §4.2.1 C1–C4 推演 + §9.3 仿真与本人 E4 独立复现一致（4/4 equal）；但 union 行「diff 记首诊断后**继续下一成员**、任一成员 equal 即胜」的 any-of 精化使**有损成员可掩盖投影内真偏离**——三种形态实测复现（下表），RT-1.4/§9.3 负对照组合无任何掩盖形态 |
| #2 HIGH（窗口 B/C 测试锚定） | ✅ 合格 | §7 表新增 RT-1/RT-2/RT-3 三行 + §7.1 六条规格断言到消息正则与触发手法；RT-2 触发设计（观察 OTHER map 避免与 ROOT 安装耦合）与 afterAllTransactions 对照组（once 守卫——无守卫会无限重入，E2 首测实证）技术可行；RT-3 三形态与收敛后口径一致；update 计数基线可落地（外层 update 在 observer 返回后才发） |
| #3 MEDIUM（窗口 C 谓词收敛） | **近合格——一处括注残留（F-R2-2）** | §3.4 伪代码 объявлен唯一规范锚 + 收敛说明两残余形态定性正确；但 §3.1 C 行括注「`tx === undefined`（**任意 cleanups 形态**）」仍与伪代码/收敛说明/RT-3 矛盾（tx undefined + 非空 Array → 伪代码与收敛说明判 **B**，该括注判 C）——恰是 O2 原案情形；§11「逐分支等价」自检在该括注下不成立 |
| #4 MEDIUM（afterAllTransactions 例外） | ✅ 合格 | §3.1 B 行明文排除条款 + E2b 安全论证 + PA-9（Transaction.js:391-393 先重置再 emit）+ RT-2 对照组测试化 |
| #5 MEDIUM-LOW（wedge 误诊） | ✅ 合格 | E202-B 末句诊断分支逐字落文 + R-7 登记（E3 实测 + fail-closed 可辩护定性）+ PA-10 + RT-4 可选 |
| #6 MEDIUM-LOW（「结构匹配」谓词） | ✅ 合格（表已展开，但其封闭 map「未声明键忽略」行正是 F-R2-1 掩盖机理的组成——谓词本身合理，union 准入规则须修） | §4.2 逐 kind 可走查谓词 + 比较语义两列八 kinds 全覆盖 |
| #7 LOW（D 触发枚举） | ✅ 合格 | 变体 D 枚举补③ canonical 扫描失败（observer 注入含 `"` 属性值/裸 `<`）+ §4.3 + RT-5 |
| #8 LOW（消息面） | ✅ 合格 | 三变体「本函数零写入（doc 状态不因本调用改变）」；(b)(c) 登记 |
| #9 LOW（INV-11 投影边界） | ✅ 合格（措辞需随 F-R2-1 一体再改） | INV-11 定稿投影等价 + §4.4 第 3 条检测面边界明文 |
| #10 NIT（R-1 措辞） | ✅ 合格 | semver 免责 + 漂移四形态全景 + 双实例免疫（E6）入 §3.2/§8 |

**修订面之外核验（总控交办）**：RD7 机制 (a)/触发点/try-catch 外/throw 形态、三窗口判定域（A 行「truthy 即命中」为 R1 伪代码既有语义的表格化，非行为变更）、E202/E201/E200/E100 四码分立、RD8 出口 1 方向、⑤ 前置保留、RD9/RD10/RD11、版本面、文件清单（5 文件 + SA6 owned 测试）、DENY 对 extract.ts 的显式保护（PA-8 不对称在 ⑥ 侧适配、不动 extract——正确的 scope 纪律）——**零越权改动**；§3.5 论证 4 措辞裁剪与 §4.1 表格压缩无语义变更。

## F-R2-1（CRITICAL，必修）——union 行 any-of「任一 equal 即胜」引入投影内真偏离的可达假阴性

**漏洞**：§4.2 union 行规定「'diff' → 记为首诊断、**继续下一成员**（存在任一成员使两侧可走查且投影相等即等价）」。当一个**有损成员**（其对提取侧值 P 的投影丢弃 P 中信息的成员——典型：封闭 map 成员未声明 P 的某些键，或必填字段在两侧均缺席的成员）对两侧比较平凡相等时，它在该成员处即返回 equal，**掩盖了 extract 选中成员投影内的真实偏离**——P（公共读入口 extractYjsSnapshot 的投影，ADR-0007 冻结的「逻辑 ROOT」定义）已可观测偏离输入，⑥ 仍放行 ok:true。

**三种实测形态**（忠实仿真 §4.2 规格含 ref 解析；materialize/extract 均现实现；输出见 §R2 实测记录）：

| 形态 | schema（联合在嵌套字段位，⑤ 盲区） | observer 攻击 | extract P（可观测） | R2 规格判定 | 应然 |
|---|---|---|---|---|---|
| A 窄成员掩盖宽成员声明键 | `{ u: { x: YLeaf<number>; k: YLeaf<number> } \| { x: YLeaf<number> } }`，输入 `{u:{x:1,k:2}}` | `uRef.set('k',9)` | `{u:{x:1,k:9}}` ≠ 输入 | **equal → ok:true** | E201-C |
| B 必填缺席成员掩盖 Record 动态键（C4 自身形态嵌套化） | `{ u: { b: YArray<...> } \| Record<string, YLeaf<string>> }`，输入 `{u:{q:'z'}}` | `uRef.set('q','HACKED')` | `{u:{q:'HACKED'}}` ≠ 输入 | **equal → ok:true** | E201-C |
| C 判别联合成员独有字段（**仓内 vfs3.assets fixture 同款 idiom**，经 `type AssetEntity = …` ref） | `{ asset: AssetEntity }`（image/text 判别），输入 `{asset:{kind:'text',body:'<p>hello</p>'}}` | body 追加 `'HACKED'` | `{asset:{kind:'text',body:'<p>hello</p>HACKED'}}` ≠ 输入 | **equal → ok:true** | E201-C |

机理（以形态 C 为例）：image 成员在声明序先被试验——其声明字段 `url/width/height` 在两侧（text 值）均缺席（「两侧均缺席 → 过」）、`kind` 同值 → cmp=**equal** → 联合立即等价，text 成员的 `body` 篡改从未被比较。形态 A/B 同理（`k`/`q` 未声明于掩盖成员 → 忽略）。**这不是边角**：判别联合是 VFSL 的主役联合 idiom（U 系 fixture 即是），⑥ 对「成员独有字段」的检测在该规格下整体失效。

**设计论证缺陷**：§4.2.1 假阴性论证「observer 修改若落在**任一**可走查成员的投影内且值 ≠ 输入投影值 → 该成员 diff；仅当**所有**可走查成员均 diff 或不可走查时才 E201-C」——结论要求全成员 diff，但掩盖成员**根本看不见被改的键**（未声明 → 忽略），永远返回 equal，E201-C 永不触发；∃/∀ 混淆。同段「被 any-of 掩盖的形态当且仅当『读回 == 输入的某合法成员投影』，即不存在可观测偏离」亦不成立：形态 A 中 P=`{u:{x:1,k:9}}` 不等于输入的任何成员投影（M1 投影 `{x:1,k:2}`、M2 投影 `{x:1}`），却被掩盖——可观测偏离存在（P 是公共 extract 投影）。该论证只在「成员对 P 无损」时为真。

**证据面缺陷（总控交办「§9.3 仿真证据是否可信」的答复）**：§9.3 的 materialize/extract 输出与本人 E4 双独立一致（可信）；仿真比较器对 C1–C4 + RT-1.4 的判定亦与规格一致。但 (a) 负对照组合（RT-1.4 用 C2 schema）的攻击键 `a` 恰在**两个成员的投影内都可见**（M1 声明 a、M2 Record 全键）——无掩盖成员，故不能证伪掩盖形态；(b) SA1 仿真脚本（`.mabf/sa1/r2-union-probe.ts`）**未解析 ref**（其 cmp 无 ref 分支，ref 节点落入 default JSON 比较）——而设计规格明确「ref → resolve(node) 下钻」且仓内主役 fixture 正是 ref 形联合；形态 C 的假阴性只在 ref 被解析时出现（本人首测未解析 ref 时亦得到 diff——与 SA1 仿真同款假象，修正后复现 equal）。仿真 ≠ 规格的保真度缺口本身即证据面问题。

**与 R1 #1 的关系**：R1 要求「投影内偏离仍必捕获」（负对照不弱化）——假阳性面修复合格，但 any-of 精化把检测面收窄到了 R1 要求之下。**SA2 方案 a（单成员定夺）无此缺陷**：以 extract 仲裁成员（或首个接受 P 的成员）为锚比较 proj(M,input) vs P，三形态均正确捕获（形态 C：锚= text 成员 → body diff）。

**修订要求（二选一，推荐前者）**：
1. **无损锚定 any-of**（对 R2 规格的最小 delta，保留 any-of 结构）：union 行 equal 的仲裁准入加一条——**成员 M 必须对提取侧值无损（proj(M,P) ≡ P：封闭 map 层级 P 的每个在场键均须为 M 的声明字段，逐层递归；Record 恒无损；array 逐元素；union 递归）**才准以 equal 判联合等价；有损成员的 equal 不构成等价（按跳过处理），diff 仍记首诊断。本人十场景实测验证该准则**全对**（见下表）——诚实路径 C1–C4/形态 A/C 诚实对照全 equal，攻击 RT-1.4/形态 A/B/C 全 diff。正确性梗概：诚实路径上 build 保序安装后，extract 选中成员 M_e 对自身投影 P 恒无损且 proj(M_e,input)≡P（build 按 F7 拒绝丢键 ⇒ doc 键集=输入键集 ⇒ 任意成员对两侧投影一致）→ 必有无损成员 equal → 不回退 R1 假阳性；修复后「当且仅当」宣称成立可证（掩盖 ⟺ P ≡ 输入某无损成员投影 ⟺ 无可观测偏离）。
2. SA2 R1 方案 a（extract 仲裁单锚：首个按 trial 语义接受 P 的成员为锚，输入侧不可走查则顺延），本人推演十场景亦全对；实现上少一个无损判定遍历、但放弃 any-of 形式。

同步修订：① §4.2 union 行 + §4.2.1 假阴性论证重写（现∀/∃ 混淆句与「当且仅当」句按修复后语义改写或删除）；② INV-11 措辞（「存在任一联合成员」→「存在任一**对读回无损**的联合成员」或方案 a 表述）；③ §7.1 RT-1 增补 **RT-1.5 掩盖形态负对照三用例**（形态 A/B/C：嵌套联合 + one-shot observer 改成员独有/动态/宽成员声明键 → `toThrow(/DOCRT-E201/)`，各配诚实对照 ok:true）；④ §9.3 仿真补掩盖形态与 ref 解析（脚本须按规格解析 ref——现脚本未解析，是证据保真度缺口）。

## F-R2-2（MEDIUM-LOW，随驳修订）——§3.1 C 行括注仍与伪代码/收敛说明自相矛盾（O2 残留）

§3.1 C 行「**剩余全部形态**（fall-through 定义）」正确，但随附枚举「`tx === undefined`（**任意 cleanups 形态**——字段缺失/改名漂移/手造 stub）」越界：`tx === undefined && cleanups 为非空 Array` 时伪代码（§3.4）与收敛说明（§3.1 R2/#3 段②「按 B 报」）均判 **B**，该括注判 C——恰是 O2 原案情形，三处文本仍不一致，§11「§3.1 表格与 §3.4 伪代码逐分支等价」自检在该括注下不成立。**修订**：删去该括注枚举或改为「`tx === undefined` 且 B 未命中（cleanups 非 Array 或为空数组），或 `tx === null && cleanups` 非 Array」；§11 自检句随后成立。（规范锚已单一化为伪代码、RT-3 断言正确——实现不受影响，纯文本收敛残留。）

## R2 实测记录（本人独立执行，2026-08-23；脚本 `.mabf/sa2-attack/r2-*.mts` 留存可重跑）

**十场景对照表**（`r2-fix-verify.mts`：R2 规格忠实仿真【含 ref 解析】vs 无损锚定修正案；materialize/extract 均现实现、真实派生物结构树）：

```
场景                                  | R2 原规格 | 无损锚定修正案 | 期望
C1 诚实（顶层 [closed{a}|Record]）      | equal    | equal         | equal ✓
C2 诚实（嵌套）                        | equal    | equal         | equal ✓
C3 诚实（双封闭子集重叠）               | equal    | equal         | equal ✓
C4 诚实（[closed{b}|Record]）           | equal    | equal         | equal ✓
RT-1.4 攻击（C2 嵌套 + a→HACKED）      | diff     | diff          | diff  ✓
Shape A 攻击（[{x,k}|{x}] + k→9）      | equal ✗  | diff          | diff  ✓
Shape A 诚实                           | equal    | equal         | equal ✓
Shape B 攻击（[{b}|Record] + q→HACKED） | equal ✗  | diff          | diff  ✓
Shape C 攻击（判别联合(ref) + body 篡改）| equal ✗  | diff          | diff  ✓
Shape C 诚实                           | equal    | equal         | equal ✓
```

（✗ = R2 规格假阴性：extract P 可观测偏离输入仍判 equal。复现命令：`cd packages/doc-runtime && node_modules/.bin/tsx /home/wangjian/nomicore-fix-issue-74/.mabf/sa2-attack/r2-fix-verify.mts`。形态 C 的 ref 解析差异：SA1 仿真脚本无 ref 分支时该形态误得 diff——证据保真度缺口见 F-R2-1。）

## R2 放行条件（SA1 完成 R3 修订后复审口径，预计窄幅文本+规格 delta）

1. F-R2-1：union 行按无损锚定（或方案 a）重写 + §4.2.1 论证修正 + INV-11 措辞同步 + §7.1 RT-1.5 三掩盖负对照入规格 + §9.3 仿真补掩盖形态与 ref 解析。
2. F-R2-2：§3.1 C 行括注修正（一句话）。

RD7 guard、三窗口、throw 形态、E202/E201 家族、RD9/RD10/RD11、出口 1 方向、R1 #2–#10 的全部修订**均无需再动**——本轮驳回面收敛于 ⑥ union 准入规则一处 + 一句文本。

---

# SA2 R3 评审（2026-08-23，第三轮——R2 reject 后复审 SA1 R3 修订稿）

**Verdict: reject（第三轮窄幅——总控交办四项核验点全部合格落实、修订面之外零越权；但本人对 R3 判据的独立攻击发现一处新可达假阴性 F-R3-1：observer 删除攻击缩水 P 使无损准入被重新放宽。修复方案（对称重物化）已由本人十五场景实测验证并随文移交。三项文档 nit 非阻塞）**

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev2_design.md` R3 修订稿（843 → 991 行，R3 标注 + R3 回应表）
- 评审方法：四项交办核验逐项复验 + SA1 双探针独立重跑 + **对 R3 判据做对抗性外推攻击**（删除/插入变体——R2 轮只攻击了值修改变体）
- 探针：`.mabf/sa2-attack/r3-deletion-probe.mts` / `r3-optionb-verify.mts`（本轮新增，留存可重跑；本人首轮探针有 root 未下钻 bug，修正后结论以本报告为准——bug 本身与 SA1 无关）

## 总控交办四项核验（全部合格）

| 核验点 | 结论 | 依据 |
|---|---|---|
| (a) 无损锚定闭合 R2 三掩盖形态 | ✅ | SA1 `r3-lossless-probe.ts` 本人独立重跑：Shape A/B/C 攻击 3/3 diff（含 ref 解析）；与本人 R2 轮 `r2-fix-verify.mts` 十场景独立一致。§4.2 union 行「equal ∧ lossless(member,P) 才构成等价、有损 equal 按跳过」与本人 R2 修复方案 1 逐条对应 |
| (b) 不重新引入 R1 假阳性（C1–C4 诚实仍 equal） | ✅ | 双仿真一致（C1–C4 + 形态 A/C 诚实对照全 equal）；§4.2.1 幂等引理成立（P 是 M_e 投影产物 ⇒ lossless(M_e,P) 恒真 ⇒ M_e 必为合格成员）；C4 演示「首位有损 equal 被跳过、后续无损成员接管」路径正确 |
| (c) §9.4 仿真保真度（ref 解析复用包内 makeRefResolver） | ✅ | 本人核对脚本源码：`import { makeRefResolver } from '.../src/resolve.ts'` 属实、调用点真实；11 场景独立重跑输出与设计 §9.4 内联表**逐行一致**。两处仿真级简化（XML 面以字面代替 canonical——其 Shape C 用 YLeaf 载体无 XML 比较；lossless-union 分支 try/catch 吞 ref 异常）不影响场景结论，且 XML 载体变体由 `r3-shapeC-xml.ts` 真实现补锚（其「R3 判据下 E201-C」为分析性结论——body 值追加在任意 canonical 下必不等，结论可靠，RT-1.5.3 落地将测试化） |
| (d) 逐 kind 无损谓词表完备性 / union 递归终止性 | ✅（表本身） | 九 kinds 全覆盖（root/ref 下钻、封闭 map 在场键声明性、Record 全键递归、array 逐元素、xml/leaf/plain 恒无损、union ∃递归）；终止性：合法派生物 ref 无环（E301/E106）+ P 数据有限；手造环 → makeRefResolver throw → ⑥ D（表行明示）。union ∃-语义与 equal 仲裁路径自洽（equal 判定路径逐层经无损成员，∃ 必真——无假跳过） |

**F-R2-2（§3.1 C 行括注）**：✅ 收敛——新括注「`tx === undefined` 且 B 未命中（cleanups 非 Array 或为空数组），或 `tx === null && cleanups` 非 Array」与 §3.4 伪代码逐分支等价（本人五形态枚举核对：tx undefined+非空 Array → B ✓；tx undefined+空 Array → C ✓；tx undefined+非 Array → C ✓；tx null+非 Array → C ✓；tx null+空 Array →干净放行 ✓），§11「逐分支等价」自检成立。

**修订面之外**：guard 伪代码/E202 三消息/§3.5/§4.3/RD9-11/文件清单零改动（抽查锚点逐字一致）；R3 变更严格收敛于 ⑥ union 行 + 无损谓词表 + §4.2.1 + INV-11 + RT-1.5 + §9.4 + 回应表——符合 R2 放行条件的授权面。

## F-R3-1（CRITICAL，必修）——observer **删除**攻击缩水 P，无损准入以「缩小后的 P」为基准被重新放宽

**漏洞**：无损谓词 `lossless(M, P)` 以**攻击后的 P** 为判定基准——observer **删除**输入的声明键使 P 缩水，缩水后的 P 对宽松成员**平凡无损**（键越少越容易「每个在场键均声明」），且 extract 的成员仲裁因删除而漂移（严格成员缺必填软拒 → 宽松成员/回退成员 0 当选）。§4.2.1 引理「`lossless(M_e,P)` 恒真——与修改无关」隐含「M_e 在修改前后不变」假设：删除使 extract 重新仲裁到**另一个**成员 M_e'（其对缩水 P 无损、且输入在该成员投影下恰好相等）——引理的「M_e 取 diff」保证落空。R2 的三形态是值修改（P 键集不变 → 无损过滤有效）；删除形态 P 键集缩水 → 过滤失效。**插入方向无此洞**（P 增大 → 无损更难满足，实测捕获）——单向不对称恰证明洞在「以攻击后 P 为基准」。

**两形态实测**（`r3-deletion-probe.mts`：R3 §4.2 规格忠实仿真含 ref 解析 + 现实现 materialize/extract；本人首轮探针 root 未下钻致假 diff，修正后如下）：

| 形态 | schema（联合在嵌套字段位，⑤ 盲区） | observer 攻击 | extract P（公共读入口可观测） | R3 判据 | 应然 |
|---|---|---|---|---|---|
| D1 宽严格联合 + 删除宽成员声明键 | `{ u: { x: YLeaf<number>; k: YLeaf<number> } \| { x: YLeaf<number> } }`，输入 `{u:{x:1,k:2}}` | `uRef.delete('k')` | `{u:{x:1}}`——k 消失（仲裁漂移到 `{x}`；调用方读回不再是自己装入的内容） | **equal → ok:true** | E201-C |
| D2 判别联合（vfs3.assets 同款，经 ref）+ 删除成员独有字段 | `{ asset: TextAsset \| ImageAsset }`（text 在前），输入 `{asset:{kind:'text',body:'<p>hello</p>'}}` | `assetRef.delete('body')` | `{asset:{kind:'text'}}`——body 消失（TextAsset/ImageAsset 双软拒 → walkUnion 回退成员 0） | **equal → ok:true** | E201-C |

D1 逐成员追踪：member[0]（`{x,k}`）cmp=**diff**（k 输入在场 vs P 缺席——偏离**已被看见并记录**）；member[1]（`{x}`）cmp=equal 且 `lossless({x}, {x})`=**true**（缩水 P 平凡无损）→ 联合 equal。D2 同机理（ImageAsset 对 `{kind}` 无损 equal 掩盖 TextAsset 的 diff）。

**为何不属已登记检测面边界**：§4.2.1 边界登记的是「对**一切**成员投影均**不可见**的修改」（C2 型：extract 输出不变）。D1/D2 的删除对严格成员**可见**（diff 已记录）、extract 输出相对未攻击安装**已改变**（scratch 对照实证）——按设计自己在边界节使用的可观测性标准（extract 输出不变性）这是可观测偏离，却被 any-of 掩盖。§4.2.1 修正版论证把「可观测偏离」定义为「P ≠ 输入的任何无损成员投影」——该定义与判据**循环**（判据检不出的一律定义 为不可观测），边界节的非循环标准（extract 输出不变性）下 D1/D2 是违约。**威胁现实性**：删除是一等 observer 攻击向量（rev1 G5 特征化用例即「observer 同轮 delete 计划键 + insert 额外键」；owner 原始 P1 叙述的攻击也是删键）；D2 用仓内旗舰 fixture idiom。RT-1/RT-1.5 全部为值修改向量——删除形态零覆盖，不修则静默上线。

**与本人 R2 建议的关系（诚实登记）**：R2 推荐方案 1（无损锚定）与方案 a（仲裁单锚）**均**漏 D1（方案 a 锚随攻击后仲裁漂移）——本人 R2 报告已把对称重物化列为「方案 (b)：构造性对称」备选，当时以成本 2× 未作首选；本轮实证证明只有方案 b 对全部向量闭合。SA1 按本人首选实施无过错，缺陷属建议面。

**修订要求（方案 b：对称重物化——唯一已验证闭合的判据）**：⑥ 比较基准改为 **`extract(real) ≡ extract(scratch)`**——scratch = 把 ② 的同一 entries 经 ④ 同款单事务安装进一次性 `new Y.Doc()`（无 observer），对两个 doc 各跑一次公共 `extractYjsSnapshot`，比较两个**同管线产物**（深度相等 + XML canonical，W3 保留）。机理：scratch 侧从**未修改的输入**经同一确定性管线产出「P 应然值」，extract 的仲裁/回退在两侧一致——仲裁漂移类攻击（删除/插入翻转）构造性消除；**整套三值 cmp / 无损谓词表 / union 准入规则可整体删除**（比较器退化为投影深度相等——规格净简化，三轮仲裁推理类缺陷一并绝迹）。本人十五场景实测**全对**（`r3-optionb-verify.mts`，输出内联下节）：C1–C4 + 形态 A/B/C 诚实 + 插入翻转诚实全 equal；RT-1.4 + 形态 A/B/C 值攻击 + D1/D2 删除 + 插入翻转攻击全 diff。**成本**：成功路径 +1 次 scratch 安装 +1 次 extract + 简单比较（设计已定价 1 次 extract 可承受；scratch 为 detached doc、事务后即弃，GC 回收，零真实 doc 副作用）；⑤ 廉价身份校验保留为顶层快速检测。**随附规格点**（SA1 定稿时需钉死）：(i) scratch 物化/提取异常（理论不可达；对抗 Proxy 双读使第二次 build 发散时可达）→ E201 归 C 或 D 二选一定稿（两向均 loud，建议归 C 承接 R-5）；(ii) INV-11 措辞改为「返回时 extract(doc) 与同一输入经同一管线的未修改安装读回投影语义等价」；(iii) §4.2/§4.2.1 重写（三轮判据演进史 + 方案 b 构造性论证）、§7.1 新增 **RT-1.6 删除负对照两用例**（D1/D2，各配诚实对照）、§9.5 仿真十五场景、成本节如实更新。

## R3 十五场景实测记录（方案 b 验证 + R3 判据对照；2026-08-23，`.mabf/sa2-attack/r3-optionb-verify.mts` / `r3-deletion-probe.mts`）

```
场景                               | 方案b 判定 | 期望 |   | R3 判据（对照）
C1–C4 诚实 ×4                       | equal ×4   | equal ✓ | equal ×4（假阳性不回归——R3 合格面）
RT-1.4 攻击（值改 a→HACKED）        | diff       | diff ✓  | diff
Shape A/B/C 值攻击 ×3               | diff ×3    | diff ✓  | diff ×3（R2 缺陷已修——R3 合格面）
Shape A/B/C 诚实 ×3                 | equal ×3   | equal ✓ | equal ×3
D1 删除攻击（uRef.delete k）        | diff       | diff ✓  | equal ✗← F-R3-1
D2 删除攻击（assetRef.delete body） | diff       | diff ✓  | equal ✗← F-R3-1
插入翻转攻击（[{a,k}|{a}] 插 k=9）  | diff       | diff ✓  | diff（R3 本就捕获——插入方向无损更严）
插入翻转 诚实                       | equal      | equal ✓ | equal
—— 方案 b 十五场景全对；R3 判据十三对两漏（恰为删除向量）——
复现：cd packages/doc-runtime && node_modules/.bin/tsx \
  /home/wangjian/nomicore-fix-issue-74/.mabf/sa2-attack/r3-optionb-verify.mts（及 r3-deletion-probe.mts）
```

## 非阻塞 nit（随下一轮顺手修，不计驳回）

1. **RT-1.5.3 括注与 schema 字面序不一致**：括注称「声明序 image 在前构成掩盖成员」，schema 字面为 `TextAsset | ImageAsset`（text 在前）。两种排序均正确区分 R2/R3 判据（本人验证 text-first：TextAsset diff → ImageAsset 有损 equal 被跳过 → E201-C ✓），测试不受影响；括注改为「image 的有损 equal 在任意声明序均构成 R2 版掩盖」或统一 schema 为 image 在前。
2. **R2 回应表历史措辞无废弃标记**：#1 行保留 R2 版判据（「任一成员两侧可走查且投影相等即等价」）、#3 行保留旧括注——均为已被 R3 修正的历史记录，建议表头或行内加「（R3 已修正，见 R3 回应表）」防快速读者误当现行规范（规范锚 §4.2/§3.1 已正确）。
3. **§8 R-2 行未随 R3 更新**：缓解列仍写「按成员投影 + any-of」且未提 RT-1.5；§11 把 R-2 列入「八处一致」偏宽。改为提无损锚定/方案 b + RT-1.5/RT-1.6 或从该自检清单移除。

## R3 放行条件（R4 修订后复审口径）

1. F-R3-1：⑥ 比较基准改为方案 b（extract(scratch) ≡ extract(real)）——§4.2 重写（三值 cmp/无损谓词整体退役为「判据演进史」）、INV-11 措辞、§7.1 RT-1.6 两删除负对照、§9.5 十五场景仿真、成本节与 R-2/R-5 登记、scratch 异常归置（C/D 二选一）定稿。
2. 三 nit 顺手修。

RD7 guard、三窗口、throw 形态、E202/E201 家族、RD9/RD10/RD11、出口 1 方向、R1/R2 全部已合格修订**均无需再动**。R3 的四项交办内容本身全部合格——本轮驳回面收敛于「删除向量下判据失守」一处，修复方案已验证移交。

---

# SA2 R4 评审（2026-08-23，第四轮——R3 reject 后复审 SA1 R4 修订稿；最终轮）

**Verdict: pass**（四轮收敛：F-R3-1 按本人验证的方案 b 落地且经受住本轮独立攻击；三 nit 全修；剩余 4 项均为文档打磨级 nit/观察项，不阻塞实现。**pass 仅表示设计通过 SA2 攻击审查——不替代 SA4 静态验尸与 SA7 活链路验证**；RT-1~RT-1.6/RT-2/RT-3 落地后的全量红绿仍归 SA3/SA6/SA7 门禁。）

- 被审对象：`wiki/raw/task_doc-runtime-materialize-root-rev2_design.md` R4 修订稿（991 → 994 行，R4 标注 + R4 回应表）
- 评审方法：总控交办四项逐一独立核验 + §9.5 探针独立重跑 + 对 R4 判据做第四轮对抗外推（scratch 面攻击、union 角色分发、对齐式对抗输入、仲裁面残余）
- 探针：SA1 `.mabf/sa1/r4-optionb-probe.ts`（本人重跑 17/17 与 §9.5 内联表逐行一致，含 P_real 明细列）；本人 R3 轮 `r3-optionb-verify.mts` 十五场景独立一致

## 总控交办四项核验（全部合格）

| 核验点 | 结论 | 依据 |
|---|---|---|
| (1) 对称重物化完备性——scratch 构造是否引入新攻击面/不确定性 | ✅ | scratch = ⑥ 内部 `new Y.Doc()`（④ 的 observer 已派发完毕后才创建，外部不可能持有引用 → 零 observer 可注册；fresh doc 零监听者 → 零事件外发）；管线确定性经 17 场景双验证；「不得复用 entries_real（yjs 单 doc 集成约束）」与「生产实现不得递归调用 materializeRoot（防 ⓪/⑤/⑥ 自触发）」两个实现注意点均已登记（§4.2 算法注 + §9.5 注 + R4 回应表）；输入重读双分支落 R-5（发散不抛 → C、抛出/失败 → D④）；内存/成本如实定价。**未发现新攻击面**（对抗性输入与 doc 修改「对齐」的形态见观察项 O-R4-4——自伤等价，出威胁模型） |
| (2) productEqual union 角色分发残余 R-8 是否可达假阴性 | ✅ 可达但可接受、已如实登记 | 残余精确限定在 string 位双语义（leaf 精确 vs xml canonical）：非 string 位成员无关（全键集/逐元素在任意成员下都可见差异）；诚实路径双侧产物字节一致 → 无假阳性。R-8 场景（`leaf<string> \| xml-fragment` 同槽联合 + canonical 等价而字节不等的字符串改写）本人推演确认**构造可达**——设计措辞「工程上不可达」偏强（见 nit 4），但触发面为对抗性自造 schema + 精确 canonical 改写，且终态在 W3 语义下等价（与 xml 位本就允许的 canonical 等价重排同款），登记处置正当、不设角色嗅探的决策正确（会重引仲裁复刻） |
| (3) §9.5 仿真保真度 | ✅（含一处标注 nit） | 探针存在、import 包内 `makeRefResolver`、productEqual 按规格实现（全键集 map/逐元素 array/union 角色分发）；本人独立重跑 **17/17 全对**（诚实 10 equal / 攻击 7 diff 含 D1/D2/插入翻转），输出与 §9.5 内联表逐行一致。scratch 承载方式（`materializeRoot(scratchDoc)` 等价于 ⑥ 内部直建、⑤ 为附带行为不参与比较）的等价性论证成立且有「生产不得递归」注意点。**nit 3**：探针 `canon = identity`（无 XML 值差场景以字面代替——17 场景结论不受影响，攻击均为字面差），而 §9.5 表头宣称「canonical xml」为忠实实现组成，且注释引用的 `r4-optionb-xml.ts` 不存在（悬空引用）——标注级修正即可 |
| (4) 规格净简化后无规范空洞 | ✅ | productEqual 表九 kinds 全覆盖（root/ref 下钻、封闭与 Record 同规全键集、array、xml canonical、leaf/plain 深度相等、union 角色分发）；INV-11 终版措辞自洽（对照管线基准 + C/D 分立 + 契约时点）；E201-C detail 更新到位（对照管线基准 + 键集支 + R-5 关联）；D 触发枚举含 ④ scratch 异常；RT-1.6 规格精确可落地（D1/D2 schema/攻击/断言到消息正则 + 诚实对照 + 键集支锚）；RT-1.5 保留定论（判据演进回归锚）论证成立。三值 cmp/无损谓词退役后无现行规范残留（§4.2 banner + §4.2.1 演进史表 + R2 回应表历史标记三重防误读）。**两处退役后未同步的陈旧描述见 nit 1/2** |

**三 nit（R3 轮）**：全部修复——RT-1.5.3 括注改为「任意声明序均构成 R2 版掩盖向量，本 fixture 取 text-first 亦同」✓；R2 回应表表头加「⚠️ 历史档案标记」✓；§8 R-2 行更新为四轮演进终版 + R-5 双分支 + R-8 新增 ✓。

**修订面之外**：⓪ guard 伪代码/§3.1 三窗口表/E202 三消息（「本函数零写入」11 处一致）/§3.5/§4.3 canonical/RD9/RD10/RD11/文件清单骨架零改动；R4 严格收敛于 ⑥ 判据替换 + 三 nit——符合 R3 放行条件与总控约束。

## 第四轮对抗外推记录（本人执行，均未击穿）

1. **scratch 面攻击**：⑥ 内部创建的 scratch doc 无外部引用路径（④ observer 派发完毕后创建）——observer 无法注册其上；fresh doc 零监听者 → 安装事务零事件外发。✓ 无面。
2. **extract(real) 失败分流**：归 C（载体改坏=真偏离倾向）与 scratch 侧失败归 D④ 的不对称分类正确。✓。
3. **仲裁面残余**：observer 使 real 侧仲裁漂移/回退（D1/D2/插入翻转）→ 全键集比较立判（17/17 实证）；extract 不可见修改（D4 投影外键）→ 四版判据同宽的既定边界，scratch 侧同样不可见——无循环定义。✓。
4. **对齐式对抗输入**（观察项 O-R4-4，非缺陷）：输入 getter 在 ①② 读值 X、⑥ scratch 构造读值 Y，且 observer 把 real doc 改成 pipeline(Y) → 两侧产物相等 → ok:true，doc 终态为 ① 未验证的 Y。**定性：攻击者即输入所有者（同时控制输入对象与 observer），同等终态可由其返回后直接改 doc 达成（契约时点外明文不覆盖）——自伤等价，出威胁模型**，与 R-5「对抗性双读」处置哲学一致。建议（可选）：R-5 行补一句登记此对齐形态的定性，防未来误报为漏洞。
5. **productEqual map 行「封闭与 Record 同规全键集」**：两侧均为 extract 产物（封闭位键集=声明∩在场，Record 位=全键），全键集比较对称无过滤——R2/R3 掩盖机理（投影滤键）结构性不存在。✓。
6. **深栈/内存**：scratch 构造与 real ②④ 同深度（real 已过即 scratch 同过，R-3）；scratch 瞬时内存 ~doc 规模、GC 回收，成本节如实。✓。

## 非阻塞 nit（4 项，SA1 可在 SA3 交付前顺手修或登记，不影响 pass）

1. **§10 内部件清单陈旧名**：仍列 `firstSemanticDifference`（R4 比较器已更名 `productEqual`，且新增 scratch 构建内部件）——§10 括注更新为现行部件名。
2. **§12 ALLOW list materialize.ts 描述陈旧**：仍写「⑥ verifySnapshotIntact 与**三值投影比较器**（~170 行……R2 扩投影语义）」——更新为「⑥ verifySnapshotIntact（对称重物化：scratch 构造 + 双侧 extract + productEqual）」并复核行数估计。
3. **§9.5 表头保真度标注**：canonical 在探针中为 identity 替代（17 场景无 canonical 依赖成立），表头「忠实实现——…canonical xml…」宜加注「canonical 以字面代替（本组场景无 XML 语义等价差；XML 面由 SA6 语义比较器与 RT-1.5.3/RT-1.6 实测锚定）」；删除悬空引用 `r4-optionb-xml.ts` 或补该探针。
4. **R-8 措辞**：「工程上不可达」→「构造可达但需对抗性 schema（leaf<string> 与 xml-fragment 同槽联合）+ 精确 canonical 等价改写；终态在 W3 语义下等价」——如实分级；可选补 1 条 characterization 用例锁定该残余形态（ok:true + 终态 canonical 等价）。

## 四轮收敛结论（评审档案收口）

- **判据演进**：R1 原始输入键集相等（假阳性，E4）→ R2 按成员投影 any-of（值攻击掩盖，F-R2-1）→ R3 无损锚定（删除攻击放宽，F-R3-1）→ **R4 对称重物化（现行，17/17 + 15/15 双验证）**。三轮缺陷同根（单侧锚上的联合仲裁推理），R4 以构造性对称根除该缺陷类——productEqual 无投影过滤、无准入谓词、无仲裁复刻，规格复杂度净下降。
- **测试资产**：RT-1（重叠正/负 4）/ RT-1.5（掩盖值攻击 3+3）/ RT-1.6（删除 2+2）/ RT-2（窗口 B+aat 对照）/ RT-3（窗口 C×3）/ RT-4/RT-5（可选）/ RT-6（收紧）+ T-1 拒绝 + Medium×3/正向 + Minor×2——四代击穿向量 + 三窗口 + guard 全部有红绿锚；RT-1.5 作为判据演进回归锚保留的设计决策正确。
- **SA1 程序合规**：四轮均窄幅驳回→窄幅修订，无越权面扩散，历史档案标记完整，演进史诚实（每轮缺陷向量与根因留痕）。

**设计放行（SA2 终）**：RD7（⓪ guard 三窗口 + E202 throw）/ RD8（出口 1 + ⑥ 对称重物化 + E201 C/D）/ RD9 / RD10 / RD11 全部通过四轮攻击审查。后续门禁归位：SA3 实现（§4.2 算法 + productEqual 表 + 实现注意点）、SA4 静态验尸（§9 协议假设 PA-1~PA-10 可重跑锚）、SA6 落地 RT-1~RT-1.6/RT-2/RT-3、SA7 活链路（红灯基线 4 failed → 全绿转化验证）。

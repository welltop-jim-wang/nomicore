# SA2 攻击评审报告 — issue #93 round 2（rev1 设计攻击评审 R1）

- **Date**: 2026-08-25（Phase 2，SA8 设计后复审 clear 之后）
- **被审对象**: `wiki/raw/task_namespace-runtime-integration-acceptance-rev1_design.md`（749 行，D-1..D-7 + 测试矩阵 T1–T7 + 改锚清单 + 零回归 18 项）
- **裁决基准**: SA8 Phase 0 裁决 A–F + G/H/I（`…-rev1_conflict_report.md`）+ ADR 0001–0008 + CONTEXT.md；本评审不越裁决边界（不要求恢复 E200 例外、不要求新稳定码、不要求改 ADR）。
- **Verdict**: **reject**（1 项 MUST——D-3 代价审计含虚假事实前提且将写入生产代码注释；4 项 SHOULD + 2 项 NICE 随修订顺手处置。D-1/D-2/D-4/D-5/D-6/部分 D-7 经独立复核坚实，无需返工。）

## 0. 独立复核记录（设计声明的事实逐项验证）

以下设计声明经本评审独立读源码/测试复核**全部属实**（列示以供 SA6/SA3/SA4 免重查）：

| 设计声明 | 复核证据 |
|---|---|
| index.ts 现状：:17 seam 值导出、类型块含 `NamespaceRuntimeSeamInput`、值导出恰 2 键 | index.ts:17-29 逐行 ✓ |
| 类型导出 12 项 − seam 类型 = 11 项（与 SA8 G 清单一致） | index.ts:19-29 计数 ✓ |
| 20 个 `../src/index.js` 导入文件 = 17 具名 seam 值导入 + 1 namespace 导入（exports-audit）+ 2 仅类型（.test-d.ts 只 `import type { NamespaceRuntime }`） | grep 全集 ✓；§1.5 全部 18 行号逐一核对无误（close-lifecycle:34 / fullchain:36 / mutate-root-sa7-dynamic:27 / replace-schema-sa7-dynamic:41 / write-fatal-message-rev1:40 均为 seam+`RuntimeWriteFatalError` 同行——确需拆分）✓；包外零消费方（doc-runtime public-surface-guard 导入的是自身包入口）✓ |
| package.json exports 恰 `{"."}` | package.json ✓ |
| runtime.ts:183-231 十键闭包 / :195-197 三 getter 单行 / :186-194 read / :240-245 生产工厂 `(handle, notifyDirty)` / :236-238 Registry 注释 | 逐行 ✓ |
| errors.ts:49 `RUNTIME_READ_DISABLED_CODE` 常量；`MetaProjectionError` E1\|E2 双码一类先例（:103-111）；`SchemaProjectionError` 现为单码 `(message)` 构造 | 逐行 ✓ |
| read() 停接纳 message（runtime.ts:263-264）与 D-2 新 getter message 码族一致、分域可判别 | read 分支 message 含「公共读取」无 getter 名；getter message 含 getter 名与「公共数据投影读取」——两 message 无包含关系、互可判别 ✓ |
| close-lifecycle 现行锚：:184-187 闭前捕获（注释写「四 getter」实捕三）/ :212-221 post-close `not.toThrow`+值相等 / :216 envBefore 四键 / :191/:203-207/:210/:222 getStatus / :153-177 十键 / :375-412 七键 / :414-441 fatal×close | 逐行 ✓ |
| post-close getter 调用面唯一（close-lifecycle:185-221） | close-sa7-dynamic 全文零 getter 调用；degraded-two-adapter 零 getter 零 close；fullchain getter 调用（:110/142/145/213/222）全部先于各自 close；closing 排空窗口内零 getter 调用 ✓ |
| T2.5 保留锚：p0-sequencer:183-197（unavailable 期 `getSchemaEnvelope()` 投影/`getActiveSchema()` null）、sync-read-face:87-97（preparing 期 getter 照常） | 逐行 ✓ |
| sa7-dynamic:378-379（γ fatal 期 getter 照常）与 :333-388（E204 A4 红线）现状 | 逐行 ✓ |
| schema-replace.ts 现状：prepare :136-208；catch :188-207（sentinel→E204 / 其余→E200 ok:false）；E204 消息与设计 §3.3① 逐字节一致；probeSchemaMap :244-261（第五态 :260 裸 throw）；①c 异型 → ok:false 单 issue（:150-155，消息 `SCHEMA 载体不是 Y.Map（期望 Y.Map，实际 …）`） | 逐行 ✓ |
| schema-write.ts:162 调用、:167-174 `instanceof DocRuntimeFatalError` 透传（E206 走既有通道）；S3 :130-131 对**整个 input（含 provided root）**先过 `snapshotMutation` | 逐行 ✓ |
| `snapshotMutation`（write.ts:247-256）整体 try/catch：copyFrozen 一切 throw（含栈溢出/Proxy trap throw）→ `MUTATION_INPUT_NOT_PLAIN_DATA` ok:false——provide-root 深输入前置闸成立 | 逐行 ✓ |
| E 码占用：E100/E200–E205 在用、**E206 空闲** | grep 计数 ✓ |
| δ 注入路径：`assertCompiledShape`（p0.ts:178-210）不查 derived.structure；`validateLogicalSnapshot` 只读 `derived.values`（validate.ts `interpret(derived.values, …)`）；`makeRefResolver.resolve(42)` 不进 ref 循环不 throw；detached-build rootEntries 末尾裸 throw「ROOT 结构节点非 map 形（手造派生物）」 | 逐点 ✓（δ 结构性可达，红灯可造） |
| D-4 机械保证：p0 分支 return null → runP0 catch（p0.ts:120）对该载体态不可达 → ENV-1；`compileSchemaEnvelope(null)` → envelopeStrictGate ENV_1（code '1'）→ `SCHEMA_ENVELOPE_1` | vfsl index.ts:303 + envelope.ts:24/:103 ✓ |
| projection.ts 现状：:64-66 缺席→null、:67-73 异型→null（改流点）；:85-88 唯一 E1 构造点；:206-208 putMetaKey；:217-238 isPlainRecord（32 层上限）；:245-263/:267-285 两 descriptor 读取器 | 逐行 ✓ |
| write.ts 现状：数组分支 ③（:296-304）与 ⑤（:307-313）、对象分支 R1（:333-337）与值读取（:342）、产物 defineProperty（:346-351）——§7.2 所引消息字面量逐字节核对一致 | 逐行 ✓ |
| U-1 断言面：schema 槽 fatal 码 `NSRT-FATAL-SCHEMA-WRITE-INTERNAL`（errors.ts:31）；U-4 P0 fatal 后 `schema.state` 保持 'preparing'（p0.ts:127-128 注释） | ✓ |
| `replaceSchemaAndRoot` 全仓消费方 = schema-write.ts:162 + doc-runtime index re-export，无直接单测；nsrt 测试对 E200 零断言（仅注释） | grep ✓ |
| ADR-0008 引文（L24/L28-32/L45/L59/L79/L81-87/L91/L93/L95/L107/L117/L119/L125）与 `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md` 逐字一致；NSRT-SCHEMA-E2 落 errors.ts 符 L125 注册机制（ADR 枚举非穷尽），零改动声明成立 | 逐条 ✓ |
| CONTEXT.md L75-77 现行文字与设计 §2.7「旧文」引用一致；新文字与 D-2 契约一致（码/throw 通道/message 分域/getStatus 保留/_Avoid_ 收窄） | ✓ |
| P2 术语纪律锚（write-fatal-message-rev1）只覆盖 fatal 域 message 与 S1 gate 文案——D-2 新 message 含 lifecycle 字面量不触锚（现行 `lifecycleWriteRefusal` 已含 'closing'/'closed' 且全绿，存在性证明） | ✓ |
| 测试矩阵对 7 项评审的兑付面：1→D-1/T1、2→D-5/T5、3→D-6/T6（Memory+File 双覆盖）、4→D-2/T2、5→D-3/T3、6→D-4/T4、7→D-7/T7——无缺项 | ✓ |

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 修复要求 |
|---|--------|--------|---------|---------|
| 1 | **MUST** | D-3 §3.2.2 代价审计事实前提虚假（keep-root doc 深度） | 「keep-root 的 doc 深度由既往全部经受控写入建立（每笔都过快照闸）」为假——见下文推演链 | 修订 §3.2.2/§3.4/§11 三处文字 + 增补决策记录与锚（见 §1.1） |
| 2 | SHOULD | D-4 T4.1 fixture 陷阱（伪红风险） | `doc.getText('SCHEMA')` 在已存在同名 Y.Map 时 throw——设计未声明 fixture doc 必须不含 SCHEMA 载体 | 见 §1.2 |
| 3 | SHOULD | D-7 §7.2 ownDataFact kind 映射不完备（数组元素面 'non-enumerable'/'undefined-value' 在 ③ 阶段处置未写明） | 「消费端 kind → message 映射逐条对齐现行字面量」的等价论证有两个洞 | 见 §1.3 |
| 4 | SHOULD | §4.4 ↔ §8 交叉引用错位（T4.2/T4.3） | 组合锚（unavailable + getter E2 throw）在 §4.4 写作「锚 T4.3」，§8 矩阵中该组合在 T4.2、T4.3 是缺席对照 | 改 §4.4 引用为 T4.2 |
| 5 | NICE | T1.4 红灯标记失实 | 断言当前 package.json 真实现状（exports 恰 `['.']`），首跑必绿——标「**红**（新增）」违反 round 1「不伪造红灯/如实标注」纪律 | 改标「绿（存量审计锚）」 |
| 6 | NICE | §9.5 标签与内容不符 | 「其余 14 个**纯切换**文件」清单内含 3 个拆分行（mutate-root-sa7-dynamic / replace-schema-sa7-dynamic / write-fatal-message-rev1）——非纯切换（`RuntimeWriteFatalError` 须留 index import）；SA8 A1 已指出 §1.5 计数口径问题，§9.5 复制了同款混乱 | §9.5 改「14 个仅动 import 行文件（其中 3 个为拆分行，见 §1.5 备注列）」 |

### 1.1 攻击点 #1（MUST）：D-3 撤销的代价审计建立在虚假前提上，且该前提将逐字写入生产代码注释

**触发条件**：任一 doc 的初始内容未经 runtime 受控写面建立（两种真实通道：① 构造侧 `persistence.createDoc(owner, docId, preBuiltYDoc)`——预构建 Y.Doc 可含任意深度嵌套；② `loadDoc` 从磁盘恢复——持久化文件可被其他程序写入，ADR-0006 #64 修订节明文「持久层仍仅校验 `META.docId === docId`」），随后对其调用 `replaceSchema({schema})`（keep-root，不提供 root）。

**推演链（逐路径）**：
1. keep-root 分支在 doc-runtime `prepareSchemaReplace` ①d（schema-replace.ts:158-164）执行 `extractYjsSnapshot(derived, doc)` + `validateLogicalSnapshot`——两者按 doc 实际嵌套深度递归；
2. **该分支对 doc 内容不存在任何 snapshotter 前置闸**：`snapshotMutation`（write.ts S3，schema-write.ts:130）只冻结**调用方输入** `{schema, root?}`，从不遍历 live Y.Doc；设计 §3.2.2 的闸论证只覆盖 provide-root 输入面；
3. 深度足够（数千层以上）→ `extractYjsSnapshot` 递归栈溢出 RangeError → 落入 prepare catch → 按 D-3 新边界 → `DOCRT-E206` fatal（committed:false）→ 该 Runtime **永久禁写**；
4. 后果放大：fatal 同时关闭 provide-root `replaceSchema` 修复通道——而 provide-root 分支本身**从不读取旧 doc 深度**（只 validate/build 调用方快照 + probeRoot 载体判定 + clear+install + 对新内容 verifySnapshotIntact），是深损坏 doc 的唯一原地修复路径。即：**先试 keep-root（替换 schema 的自然第一步）→ fatal → 修复路径被永久锁死**；旧 E200 行为下 keep-root 仅 ok:false、provide-root 修复仍可用。

**证据（虚假前提三源对质）**：
- 设计 §3.2.2：「keep-root 的 doc 深度由既往全部经受控写入建立（每笔都过快照闸）」——「既往」无法覆盖 doc 的**初始**内容：Runtime 构造要求已存在 handle（runtime.ts V2 状态门），doc 在 Runtime 之前就已由 createDoc/loadDoc 建立；
- 设计 §11 协议假设表第 3 行**自认**：「createDoc 接受预构建 Y.Doc（**含任意顶层条目形态**）｜现有测试引用 fullchain:57-79（makeDoc → createDoc）」——与 §3.2.2 直接互斥；fullchain:57-72 的 makeDoc 正是用 Yjs API 直接构建初始内容、全程不过快照闸的实例；
- SA8 Phase 0 裁决 C 的授权论证（conflict_report L65）逐字复述了同一假前提（「keep-root 分支的 doc 深度由既往全部经受控写入建立」→「残余可达面是边际的」→「这授权回退方向」）——即「代价有限」的结论部分建立在 false fact 上，而设计 §3.4 又计划把「深输入经 Runtime 公共面先被 snapshotter 受控快照闸拦截……残余可达面为递归帧成本差的边际带」**逐字写入 schema-replace.ts 生产头注**，把虚假不变量固化进代码。

**影响评估（定级为 MUST 的理由）**：不是要求推翻裁决 C 的方向——「未知异常保守 fatal」在诚实事实下依然 ADR 相容（过报方向钦定）；MUST 针对的是**设计文本的事实完整性**：(a) 载荷性论证虚假且将进生产注释，误导后续维护者与 SA4/SA7 的验证预期；(b) 深损坏/深构造 doc × keep-root 的修复路径牺牲是**未被意识到的副作用**（对比：SCHEMA 载体异型的修复路径保留被 SA8 D 明文裁决保护——同类哲学在 ROOT 深损坏上因假前提而被无意识放弃）；(c) 测试矩阵对此零锚——该行为变化（keep-root 深溢出从 E200 ok:false 变 E206 fatal）完全不可观测。

**修复要求（全部在裁决 C 边界内，不要求恢复 E200、不要求判别器）**：
1. §3.2.2 改写 keep-root 论证为诚实版本：doc 深度仅对「全部历史经本 Runtime 受控写面建立」的 doc 有闸保证；createDoc 预构建 doc 与 loadDoc 恢复 doc（ADR-0006 仅校验 META.docId）的初始深度**不受任何前置闸约束**——keep-root 分支的残余带 = 任何 doc 源深度的 extract/validate 溢出，非「帧成本差边际带」；
2. §3.4 头注文字同步修正（删除或限定「snapshotter 先拦截」句的作用域为 provide-root 公共面输入）；
3. 增补一条**有意识的决策记录**：深损坏 doc × keep-root → E206 fatal → 永久禁写（含修复通道关闭；provide-root 先行仍可修复）；如接受，明示「跨程序损坏文件的写修复不在本轮保护面」并与 CONTEXT「载体投影读取」词条的排除声明对齐；
4. 测试矩阵增锚（建议 T3.4）：迭代构建深嵌套 ROOT 的预构建 doc → createDoc → keep-root `replaceSchema` → 断言 E206 fatal rejection + 零写入（把新行为从不可观测变为 SA7 可验）；或至少以 seam δ 同款机制锚定等价分类；
5. §11 协议假设表补一行 doc 深度假设的修订。

### 1.2 攻击点 #2（SHOULD）：T4.1 fixture 的 yjs 类型约束未声明——复用含 SCHEMA Y.Map 的 makeDoc 将造出测试自身错误（伪红）

**触发条件**：SA6 按 T4.1 字面「createDoc 后 live 注入 `doc.getText('SCHEMA').insert(0,'x')`」落锚时，若 fixture 沿用仓内标准 makeDoc（fullchain:57-72 / public-surface-ownership:66-79 均预建 `doc.getMap('SCHEMA')` 四键），则 `doc.getText('SCHEMA')` 因同名条目已是 Y.Map 而 **throw（yjs 类型不匹配——正是 projection.ts:67-73 依赖的同一机理）**——红因将是 fixture 构造错误而非「异型载体 → E2」契约缺失，构成伪红，且红灯期噪音会误导 D-4 的兑付判断。

**证据**：yjs `getText(name)` 对既有异型同名条目 throw 是本包既有依赖事实（projection.ts:67-73 注释「实测 §12 #2」；schema-replace.ts probeSchemaMap 四级探针同机理）；仓内既有异型注入先例均从**缺席**起步（doc-runtime extract-yjs-snapshot.test.ts:518 `doc.getArray('SCHEMA').insert(...)` 在全新无 SCHEMA doc 上执行）。设计引用的「F-3:72 同款技术」实为向**已存在**的 META Y.Map set 值（boundary-supplementary:72）——与「创建异型同名条目」不是同款前提。

**修复要求**：§8 T4.1 场景描述补一句 fixture 前提：「fixture doc 预先**不含** SCHEMA 载体（persistence permissive 接受，见 T4.5/共享套件），createDoc 后经 `handle.doc.getText('SCHEMA')` 创建 Y.Text 异型条目；若 doc 已含 SCHEMA Y.Map，getText 将 throw 致 fixture 自身错误」。

### 1.3 攻击点 #3（SHOULD）：D-7 ownDataFact 的 kind→行为映射在数组元素读取面有两处未定义——「机械等价」论证不完整

**触发条件**：SA3 按 §7.2 实现 `ownDataFact` 适配时遇到两个设计未映射的 kind：
1. **projection `readableArrayElement`（:267-285）**：现行代码**不检查 enumerable**——下标上 non-enumerable data descriptor（值为 5）现行返回 `{kind:'ok', value:5}`（可读出）。`ownDataFact` 按其规格序会把它归为 `'non-enumerable'` kind；§7.2 对 readableOwnDataValue 给了映射（→skip），对 readableArrayElement 只写了「missing/accessor/undefined-value」三种 violation 消息——`'non-enumerable'` 映射缺失。若 SA3 依 readableOwnDataValue 先例映射为「键空间外」或依 violation 语义映射为拒绝，均改变现行行为（现行：照常读值）。
2. **write.ts 数组分支 ③（:296-304）**：现行 per-index 只查 missing/accessor，不查 non-enumerable（全局 ② names/keys 比对先行拦截）；§7.2 对象分支标注了 non-enumerable 的防御性处置，数组分支未标注。另外 ③ 阶段 `ownDataFact` 会提前产出 `'undefined-value'` kind——设计意图是「undefined 留在 ⑤ 值读取期」，但映射表未写明 ③ 阶段对该 kind 放行（两处消息字面量相同 `数组元素 undefined（index i）`，行为等价，但 SA3 需要明确指令才能不发明行为）。

**影响**：经 yjs ContentAny 存储重构的 plain 数组在实际上不可达这些 descriptor 形态（yjs 读回值均为标准 enumerable 下标），故为**理论上**的等价性破洞；但 §7.3 的验收主张是「同输入 → 同 kind、kind → message 映射逐条对齐」的**完备**机械等价——两处未定义 kind 使该主张不成立，且给 SA3 留下自由裁量点（重构最忌裁量）。

**修复要求**：§7.2 补两行映射：① readableArrayElement：`'non-enumerable'` → 维持现行「照常读值」（返回 ok+value）——与 readableOwnDataValue 的 skip 语义**有意不同**（数组元素无键空间概念）；② write 数组 ③：`'non-enumerable'` → 防御性 throw「数组携带非枚举 own 键」（与 ② 全局拦截消息对齐，结构性不可达）、`'undefined-value'` → ③ 阶段放行、维持 ⑤ 值读取期 throw 次序。

### 1.4 攻击点 #4（SHOULD）：§4.4「锚 T4.3」与 §8 矩阵错位

SA8 D 的明示义务（「unavailable + getSchemaEnvelope() throw E2 可观测组合须明示」）在 §4.4 末尾标注「锚 T4.3」，但 §8 D-4 矩阵中该组合锚是 **T4.2**（「组合锚：同 doc getSchemaEnvelope() throw E2」），T4.3 是**缺席对照**（无 SCHEMA doc → null + ENV-1）。SA6 若按 §4.4 落锚会锚到缺席对照用例上，组合锚落空。修复：§4.4 引用改为 T4.2（矩阵本身正确，不动）。

## 2. 协议假设依据审查（技能立法 2026-06-13）

- **章节存在性**：§11 存在，六行假设逐行给出依据类型与具体引用（源码行号/现有测试行号/ADR 条款）✓。
- **依据可验证性**：全部引用经本评审定位复核（projection.ts:62-73/67-73、schema-replace probeSchemaMap:244-259、fullchain:57-79/:84-98/:186-203、boundary-supplementary:72、ADR-0006 #64）✓ 可重跑。
- **「应该/预计」类无据推断**：无。唯一估计值「约 2–4 倍帧成本差」已被 SA8 A4 降级为非载荷备注 ✓。
- **引擎依赖**：D-3 选整体撤销后设计明示「无引擎假设」✓（唯一候选 V8 消息串已随例外一并消除）。
- **结论**：本节通过——但 §11 第 3 行与 §3.2.2 的内部矛盾（攻击点 #1）说明假设表与论证体未对账，修订时须一并处理。

## 3. 错误处理链路审查（技能立法 2026-05-07）

- **静默失败**：未发现新增静默失败面。D-2 getter 拒绝是 loud throw 稳定码；D-4 public 模式异型 loud throw；D-1 收缩公共面无行为通道变化。
- **状态闭环**：fatal 摘要（status.fatal）在 U-1/T3.2 各断言面闭环；close 摘要与 getStatus 全周期可用有锚（T2.2/T2.6）✓。
- **降级路径**：D-4 p0 模式「异型 → null → ENV-1 → unavailable」是 SA8 D 明文裁决的数据级收编（非虚假降级——终点可观测且 getter 面 loud）✓；**唯一虚假降级嫌疑在攻击点 #1 的反面**：深损坏 doc 的修复通道被 fatal 无意识关闭，属「本可修复的失败被升级为永久禁用」——不是降级而是过报，ADR 钦定方向容忍，但须按 #1 要求转为有意识决策。
- **虚假降级识别**：D-4 将「载体损坏 → null」改为 loud（正是消除虚假降级）✓；本设计无新增伪降级。
- **对抗输入推演**（任务指定的四向量）：深嵌套 root（provide-root）→ snapshotter 前置闸拦截 ✓（write.ts:247-256 整体 catch，栈溢出同收编）；大 envelope → compile 五阶段结果联合（ENV-100 顶层兜底「绝不外抛」）✓；敌意 Proxy → descriptor/get trap throw 均被 snapshotter catch 收编 ✓；循环引用 → copyFrozen 祖先集 → issue ✓。**唯一漏网向量 = doc 源深度 × keep-root（攻击点 #1）**。

## 4. 红线测试思路（每漏洞对应的测试方向）

- **#1（MUST）**：`runtime-replace-schema-sa7-dynamic.test.ts` 新增 ε 路径（或独立 T3.4）：迭代循环构建 N 层嵌套 plain 值 → 预构建 Y.Doc 逐层 `getMap` 嵌套安装 → createDoc → `replaceSchema({schema})`（keep-root）→ 断言 rejection `RuntimeWriteFatalError`、`phase==='pre-commit-internal'`、`committed===false`、cause 含 `DOCRT-E206`、零 update/字节不变、fatal 后读照常——把「doc 源深度也走 fatal」从隐性行为变为显性契约锚（深度取值需在 Node 20/24 双栈下稳定溢出，建议 ≥50_000 层并先以 read 侧溢出做对照标定；若深度不稳定，改用 seam 注入 extract-throw 等价分类锚）。
- **#2（SHOULD）**：T4.1 fixture 前置断言：注入前 `handle.doc.share.has('SCHEMA')===false`（防回归到「含 Map 的 makeDoc + getText throw」伪红形态）。
- **#3（SHOULD）**：D-7 提取后新增（或扩展 metadata-proto-key）：`Object.defineProperty(arr, 0, {value:5, enumerable:false})` 的 META 数组值 → getMetadata 照常投影该元素（锁定现行 non-enumerable 数组下标可读语义，防 SA3 适配时发明行为）。
- **#4（SHOULD）**：无需新测试——修引用即可；SA6 落锚时以 §8 矩阵为准。
- **#5/#6（NICE）**：无测试影响；标签/措辞修正。

## 5. 结论

D-1/D-2/D-4/D-5/D-6 的契约精确性、锚完备性、与 SA8 裁决的一致性经独立复核**坚实**（拒 绝形状无二义、SA6 可直接写红灯；改锚清单与 grep 全集一致；零回归 18 项抽查属实）；D-7 除 kind 映射两处缺口外方向正确。**Verdict = reject**：仅要求处置攻击点 #1（MUST，D-3 代价审计的事实修正 + 决策记录 + 锚）与 #2/#3/#4（SHOULD，设计文本级修订，无方向变更）；#5/#6 随手修正。修订后无需重新走 SA8 前置门禁（全部修订在裁决 A–F+G/H/I 边界内、不触碰方向与 ADR），建议 SA1 修订后交 SA2 复审 R2 快速确认。

— SA2（Wallfacer），round 2 R1

---

# SA2 R2 复核（同任务 issue #93 round 2；被审对象 = SA1 R2 修订版设计，787 行 + 回应表 #1–#6）

- **Date**: 2026-08-25（R2）
- **Verdict**: **pass**（R1 六项全部核实落实；#1 的关键事实修正经独立证实为真——含 SA2 对自身 R1 推演链一处错误的诚实纠正。遗留 1 项 SHOULD + 2 项 NICE，均为一句话级补全/落锚提示，交 SA6 红灯前由 SA1/总控顺手处置，不构成返工轮。）

## R2.1 #1 [MUST] 复核（重点）

### R2.1.1 两层崩溃边界的独立核实（SA1 事实修正 2 的根基）——**均证实**

1. **`extractYjsSnapshot`（extract.ts:52-82）**：全函数体顶层 try/catch 属实。`try` 块覆盖其**全部**递归与可抛面——`walk`（:90-151，map/array/xml-fragment/leaf/plain/union/ref 八 kinds 的递归分发）、`walkUnion`（:159-176）、`trialMember`（:186-225）、`copyPlainValue`（:266-313，含深拷贝递归）、`makeRefResolver` 返回的 `resolve` 环/缺名 throw（:242/:250）、`mismatchIssue` 不可达态 throw（:365）、`probeRoot` 入口调用（:58）。catch → `DOCRT-E100: 内部错误（意外异常）: ${detail}` 结构化 ok:false（:69-81），头注 :16/:50 明文 INV-6「绝不外抛」。**栈溢出语义成立**：RangeError 从递归深处 unwind 至顶层帧被同一 try 的 catch 捕获（JS 异常传播不消耗新帧，unwind 到达时栈已释放，catch 体内字符串插值栈空间充足）。
2. **vfsl `interpret`（validate.ts:598-632 区域）**：全函数体 try/catch 属实。`validateValue(root, value, [], ctx)`（全部递归解释器，含字段下钻/union/Record/Pattern）在 try 内；catch 双分支——`WorkBudgetExceeded` → 「校验工作预算耗尽…上限 200000000」ok:false（:612-621），其余 → `VFSL-E100: 内部错误（意外异常）` ok:false（:622-629）。文件头注 :13 **明文**「（栈溢出）RangeError 经顶层 catch 收编为 `{ ok:false, issues:[VFSL-E100 …] }`」——溢出收编是该边界的显式设计意图，非偶然。`validateLogicalSnapshot` 即 `interpret(derived.values, …)` 薄入口（:652-654）。
3. **keep-root 分支 ①d 递归面封闭性**：schema-replace.ts:158-164 keep-root 只调 `extractYjsSnapshot` + `validateLogicalSnapshot`，两者的 `!ok` 均以 `{kind:'fail'}` **return**（:161/:163）、不经 prepare catch；`buildTopEntries`/`probeRoot`（ROOT 面）确认仅在 provide-root 分支（:171-173）；extract 内部的 `probeRoot` 在其自身 try 内。**「keep-root × E206 = 结构性空集」成立**（修正 3 的组件盘点属实：残余可抛面仅 probeSchemaMap 第五态与 envelopeShapeIssue 的 Proxy ownKeys——前者公共 API 造不出，后者经公共面 envelope 恒为 compile 深冻结产物）。

### R2.1.2 SA2 自我纠错登记

R1 §1.1 推演链第 3 步「深度足够 → extractYjsSnapshot 递归栈溢出 RangeError → **落入 prepare catch** → E206 fatal」**被证伪**：溢出确实发生，但被 extractYjsSnapshot 自身顶层 catch 先吸收为 DOCRT-E100 ok:false（validate 同理），不会传播到 prepare 的 catch。R1 只核实了「keep-root 无前置闸」与「初始 doc 深度不受闸约束」——这两点**仍然为真**（SA1 修正 1 亦确认并撤回 R1 版假前提）；R1 未下钻核实 extract/validate 的自有边界，致推演链结论（「锁修复通道」）错误。SA1 R2 的落点刻画（「比 SA2 R1 推演链更早被吸收」）准确。

### R2.1.3 #1 五条修复逐条核对

| 要求 | 落实 | 核对结论 |
|---|---|---|
| ① §3.2.2 诚实版 | ✅ :256-265 整体重写（三条 R2 事实修正） | 修正 1（闸作用域）/修正 2（双层吸收）/修正 3（可达面=空集）逐条与源码对账一致；「帧成本差边际带」明文撤回；对 SA8 C 授权论证的继承关系如实声明（方向不依赖假前提，依据 = 判别器闭环 + 真实可达面）——**不越 SA8 裁决边界** ✓ |
| ② §3.4 头注作用域 | ✅ :314-330 | 「snapshotter 先拦截」句限定为 provide-root 公共面输入；keep-root 面改为「双层自有边界吸收 + 本 catch 为纵深防御」+ 指向 §3.2.3——虚假不变量不再进生产注释 ✓ |
| ③ 有意识决策记录 | ✅ §3.2.3（:267-274） | 接受面三条（δ 面 fatal 化 / 未来无边界组件一律 fatal 的有意识默认 / 与 CONTEXT「载体投影读取」排除声明对称的写面边界声明）+ 修复操作指引（疑似深/损坏 doc 直接 provide-root）——把 R1 要求的「有意识决策」完整落位，且与 CONTEXT 对齐方式不触碰词条本体（无越界）✓ |
| ④ T3.4 锚 | ✅ §8 T3.4（:594） | **改锚真实行为是 R1 要求 4 的正确兑现**：R1 原案「锚 E206」的前提（溢出到达 prepare catch）已被证伪——锚 E206 是永不通过的伪锚；T3.4 锚「resolved ok:false + `/DOCRT-E100\|VFSL-E100\|预算/` + 零写入 + fatal 零置位 + **同 runtime provide-root 修复成功**」把 R1 #1 的根本关切（深损坏 doc 修复通道开放）从隐性行为变为显性契约（与 §13 #19 双保险）；「哪层吸收非契约面」的断言写法诚实；弃「seam 注入 extract-throw」（无外抛点，注入面不存在）论证成立；E206 分类面由 δ（T3.1）覆盖——分工自洽；含 DEEP 不稳回退预案 ✓ |
| ⑤ §11 补行 | ✅ :716 | 「doc 源深度无前置闸」行与 §3.2.2 对账，消除 R1 指出的 §11↔§3.2.2 内部矛盾 ✓ |

**结论：#1 [MUST] 完全落实，且修正质量高于 R1 要求的最低线**（不仅修正了假前提，还把 R1 未发现的「双层自有边界」事实纳入设计，T3.4 的行为锚比 R1 原案的 fatal 锚更有验收价值）。

## R2.2 #2–#6 逐条核对

| # | 要求 | 落实 | 核对结论 |
|---|---|---|---|
| #2 [SHOULD] T4.1 fixture 前提 | ✅ §8 T4.1（:600） | 补全四要素（预置不含 SCHEMA / 勿复用标准 makeDoc / getText-throw 机理警示 / `share.has('SCHEMA')===false` 前置断言）；先例引用修正为 extract-yjs-snapshot.test.ts:518（R1 已核实该处确为「从缺席起步创建异型」先例；「F-3:72 同款技术」的不当引用被撤回——F-3 是向已存在 Y.Map set 值）✓ |
| #3 [SHOULD] ownDataFact 映射补全 | ✅（留一处残余缺口，见 R2.4-A） | §7.1 类型修订（'non-enumerable' 携带 value——支撑数组面照常读值）；§7.2 两处显式映射 + §7.3 等价论证补全声明 + T7.2 语义锁定锚——R1 指出的两处缺口主体闭合 ✓；**新发现一句话级子缺口见 R2.4-A** |
| #4 [SHOULD] §4.4 引用 | ✅ :413 | 「锚 T4.2（R2 修正标注）」；矩阵未动 ✓ |
| #5 [NICE] T1.4 标记 | ✅ :573 | 「绿（存量审计锚）——防未来回潮的锁定锚」+ 首跑必绿如实标注 ✓ |
| #6 [NICE] §9.5 标签 | ✅ :664 | 「14 个仅动 import 行文件（其中 3 个为拆分行…）」✓ |

## R2.3 全书重扫（新矛盾检查）

- **T3.4 ↔ §13 #19 一致性**：两处表述逐字同向（ok:false + E 层吸收 + 零写入 + fatal 零置位 + 修复通道开放；extract.ts/validate.ts 双双列入本轮零触碰）✓ 无矛盾。
- **§3.2.2 修正 2/3 ↔ T3.1（δ 锚 E206）自洽性**：修正 3 明确「E206 真实可达面 = provide-root 的 buildTopEntries 裸 throw（δ）+ doc-runtime 直接调用方垃圾输入」——δ 属 provide-root 分支（buildTopEntries 只在该分支），与「keep-root E206 = 空集」不矛盾 ✓。
- **§3.2.1 候选三插入句**（:252「深输入溢出直达 catch 场景经 R2 事实核对本就已被吸收」）与修正 2 一致 ✓。
- **R2 未偷改 R1 已验收契约**：23 处 R2 标记的行号分布（§3.2/§3.4/§4.4 引用行/§7/§8 矩阵 T1.4/T3.4/T4.1/T7.2/§9.5/§11/§13/自检/回应表）全部落在攻击点相关区域；§1（D-1）/§2（D-2）/§5（D-5）/§6（D-6）契约面零 R2 标记，抽查 U-3/U-4 原文未动 ✓。
- **T7.2 live 注入可行性**：ContentAny 机理核实——本地 transaction 的 `ymap.set(k, v)` 使 item 持**原引用**（F-3 循环对象存活即同一机理的存在性证明），getMetadata 经 `meta.get()` 取原引用 → non-enumerable 下标存活；「编解码会把 descriptor 标准化」准确指 **loadDoc decode 重建面**（编码导出只读值不换引用）——T7.2 的 fake-handle 通道可行 ✓。补充说明见 R2.4-C。

## R2.4 遗留项（不阻塞 pass；SA6 红灯前顺手处置）

- **A [SHOULD] 映射①漏「non-enumerable ∧ value===undefined」子情形（R2 修订引入的一句话级规格缺口）**。现行 `readableArrayElement`（projection.ts:281-283）**不检查 enumerable**：desc 存在、无 accessor、`value===undefined` → violation「数组位置 undefined 不可投影」——对 non-enumerable∧undefined 下标同样走此 violation。ownDataFact 规格序把 non-enumerable 判定置于 undefined-value 之前，R2 映射①无条件 `'non-enumerable' → ok+fact.value` → 该子情形被投影为 ok+undefined → `copyMetaValue(undefined)` 改抛 `…值域违规：undefined`（现行：`…值域违规（数组位置 undefined 不可投影）`）。两案同为 MetaProjectionError/NSRT-META-E1、同 keyPath、同 loud——**仅消息措辞漂移 + 中间链路不同**，无降级无静默化；可达性与 T7.2 同级（`Object.defineProperty(arr, 1, {})` 一行即造出该形态：缺省 value=undefined、enumerable=false）。§7.3「SA3 无自由裁量点」的主张因该缺口不完全成立。**修复（一句话）**：§7.2 映射①补「`fact.value === undefined` 时维持现行 violation『数组位置 undefined 不可投影』」（non-enumerable 携带 value 的 R2 类型修订恰为此提供了判据材料）；建议 T7.2 增一姊妹断言（`defineProperty(arr, 1, {})` → getMetadata throw E1 且 message 含「数组位置 undefined 不可投影」）锁现行消息。注意对象面**无**此缺口（现行对象键面 non-enumerable → skip 先于 undefined 判定，R2 映射一致）。
- **B [NICE] T3.4 的 O(depth²) 成本与 vitest 默认 timeout**：extract walk 每层 `[...path, key]` 复制使深嵌套提取呈 O(depth²) 时间/内存（50_000 层、溢出点 ~2 万层时 path 复制总量 ~2×10⁸ 元素）——可能数秒级耗时 + GC 压力，vitest 默认单测 timeout 5s 有超时风险（超时红会被误读为行为红）。建议 SA6 给 T3.4 用例显式设较大 timeout（如 30–60s）或直接按回退预案取 20_000（rev2 先例值）；fixture 预检（浅路径 read + P0 ready）设计已含 ✓。
- **C [NICE] T7.2 注入通道表述补充**：「fake handle + live Y.Doc」是**充分**通道；该文件现有 makeHandle 模式（真实 MemoryPersistence + createDoc **前** set）同样保持原引用（createDoc 编码导出不替换本地 item 的 ContentAny 引用；handle.doc 与预构建 doc 同一实例——fullchain :136 起仍在原 doc 上监听即证）。SA6 二选一皆可，核心纪律只有一条：**不经 loadDoc decode 读回**。建议落锚注释写明该机理，防后续维护者误以为必须 fake handle。

## R2.5 结论

R1 六项（1 MUST + 3 SHOULD + 2 NICE）全部落实且质量到位；#1 的关键事实修正（extract.ts:52-82 INV-6 / validate.ts interpret :598-646 双层全函数体崩溃边界）经 SA2 独立源码级证实，keep-root 递归面封闭性（①d 仅 extract+validate，buildTopEntries/probeRoot 仅 provide-root 分支）确认无遗漏；T3.4 改锚真实行为正确兑付「行为可观测化」要求（R1 原案锚形态随前提证伪而修正，SA2 认可该择一声明）。R2 修订未引入方向性新矛盾，未偷改 R1 已验收契约面。遗留 A（SHOULD，一句话映射补全 + T7.2 姊妹断言）/B/C（NICE）交 SA6 红灯前处置。

**Verdict: pass**（设计可进入 SA6 红灯锚定；A 项须在 SA3 实现 plain-data.ts 前由 SA1/总控补入 §7.2，避免 SA3 按 R2 现文实现出消息级回归）。

— SA2（Wallfacer），round 2 R2

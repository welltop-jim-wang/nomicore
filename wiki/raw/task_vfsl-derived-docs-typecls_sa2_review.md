# SA2 攻击评审报告

**Date**: 2026-08-19
**Verdict**: **reject**（2 个需修改设计的实质漏洞：§4.5 对账表错漏、§3.4/§7 手造 IR 边界承诺与伪码不符。算法主体、三表定形、typeCls 收敛方案、§6 裁决均经独立攻击后**予以确认**，SA1 修订时不得借机改形。）

评审方法声明：本报告未转引 SA1 的推演，全部关键声明由 SA2 独立重做——含 FIXTURE/SYNTH 两模块按 §3.2 规则表的**全量手工走查**、设计所引 20+ 处源码行号逐一比对、`typeCls`/`DerivedSchema` 消费面 grep 复跑、253 存量用例逐文件计数、spec §10 与测试内嵌 fixture 逐字比对、tsconfig 严格标志核查。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **HIGH** | §4.5 fixture 全量对账表（设计自证的验证性产物） | FIXTURE `markerDocs` 表漏 3 键：`AssetEntity.<member 2>.name`（YLeaf）、`AssetEntity.<member 2>.size`（YLeaf）、`AssetEntity.<member 2>.tags.<item>`（YArray 实参位 YLeaf）。真值 **18 项**，表中 15 项。表内部自相矛盾：member 1 的同形链 `body`→`paragraphs`→`paragraphs.<item>` 三层全列，member 2 的 `name`/`size`（与 member 0 的 `url/width/height` 完全同形）及 `tags.<item>`（与 `paragraphs.<item>` 完全同形）却被截断——是走查疏漏而非规则差异。**触发条件**：SA3 按 §4.5 尾注指令 `Object.keys(derived.markerDocs).length` 对照清点「22 / 15」时，正确实现产出 18 ≠ 15 → 假红自检；SA4/SA7 若以本表为对账 oracle（设计明确邀请此举），正确实现被误判缺陷。**影响**：不改算法、不改测试也不会漏绿（红灯 8 断言未锚定总键数），但该表是 §0 结论 6 的核心交付物，错表直接污染下游验证链。 | 修正 §4.5 markerDocs 表为 18 项并补 3 键；清点指令改「22 / 18」；建议把清点命令升级为排序全键集合 diff（见红灯测试思路 #1），杜绝计数对但键集错的可能。 |
| 2 | **MEDIUM** | §3.4 / §7 手造 IR loud 边界（错误处理状态闭环） | 设计两处承诺「docs 缺失/形状异常 → collectDocs 内 TypeError → 顶层 catch → E100，无静默降级」，但 §4.1 伪码该承诺**仅 marker 锚成立**：`appendDocs` 内 `[...[], ...undefined]` 确抛 TypeError；而 `tables.aliasDocs[a.name] = a.docs` 与 `tables.fieldDocs[p] = f.docs` 对 `undefined` **是普通赋值，不抛**——派生物静默携带 `undefined` 值（违反 derived.ts:68「纯数据、可 JSON 序列化」纪律，`JSON.stringify` 直接丢键），E100 不闭环。且「形状异常」在 marker 锚也不成立：非数组 truthy 值（如字符串 `'foo'`）被 `[...'foo']` **字符级静默展开**为 `['f','o','o']`，无 TypeError。**触发条件**：手造 IR 绕过 parser（evaluate.ts:41-43 JSDoc 明文将此类输入划入 loud 边界范围——非 SA1 可自行收窄的边界）。**影响**：合法输入零影响（IR 必填 docs 由构造保证），但设计把一个只在 1/3 锚位成立的性质写成已验证的全局不变量，SA4 按 §7 表格做 diff 审查时会放行一个两锚静默的实现。 | 三锚统一经一个 `put(table, key, docs)` 助手：`if (!Array.isArray(docs)) throw new TypeError('docs 缺失/非数组（手造 IR）')` 后再赋值/串联。§3.4/§7 措辞随之真实成立，改动约 +3 行。禁止改为静默规范化（`docs ?? []`）——那是把 loud 边界换成静默降级，方向相反。 |
| 3 | LOW | §5.2/§8 改动清单完备性 | typeCls 方法化后，`evaluate.ts:106/:140` 的 `ctx.R.cls` 传参消失，`evaluate.ts:21` `import type { Resolver, Cls }` 中 `Cls` 成为未用导入。已核 tsconfig.base.json 无 `noUnusedLocals` → **typecheck 不拦、非门禁失败**，仅整洁问题（`verbatimModuleSyntax` 下保留合法）。 | §5.2 补一句：类型导入行同步去 `Cls`（`import type { Resolver } from './resolve.js'`）。 |
| 4 | LOW | §2.1 理由 3 依据口径 | 「对已按旧形状哈希的任何缓存，新版本产出仅在尾部追加三个键」——仓内不存在任何对 derived 做内容哈希/编译缓存的消费方（grep 全仓无），这是对未来消费者的**假设性依据**，被表述为既存事实。键序固定（§4.2）本身正确且必要，不受影响。 | 措辞改为「为未来 F2 编译缓存保持旧形状序列化前缀稳定」或将该半句删去；不影响实现。 |

**裁决理由**：#1 是设计自证体系（§0 结论 6「fixture 全量对账表」+ 设计期自测声明「fixture/SYNTH 全量对账」）的事实性错误，且被明确定位为 SA3 自检与下游对账的权威输入——必须改设计；#2 是 2026-05-07 立法「错误状态须在所有失败路径闭环」的直接违反（承诺的 E100 闭环在 2/3 锚位不成立）——必须改设计（伪码 + 两处措辞）。两项修订均为局部手术，**不触及**承载位置定形、路径文法、typeCls 方案、§6 裁决。

---

## 经攻击后确认成立的设计要点（SA1 修订时不得推翻）

以下各项由 SA2 独立验证，**不是**转引 SA1 论证：

1. **三表承载位置定形（§2）确认**。已核 `evaluate-derived-schema.test.ts` 全部形状锚：`:326`/`:355` 终态 `toEqual({kind})`、`:431-437` MapField 三键、`:356-359`/`:534-540` 值 schema 精确对象、`:444`/`:451` `hasOwnProperty('discriminator')` 反向锚——在节点上加必填 docs 键必违约其中至少一批；顶层三表是同时满足 AC1（必填纪律）与 AC5（存量形状零改动）的唯一承载。存量测试对 `derived` 顶层键集无穷尽断言（仅 `:279` 自比较、`:284` 自往返、`:485` `Object.keys(derived.aliases)`）——已逐条确认新键无害。
2. **§3.2 路径文法与红灯 8 断言一致**。SA2 手工全量走查 FIXTURE 与 SYNTH：红灯断言 1–5 涉及的每一键（含 `Entity.<member 1>.body.paragraphs` 的 YMap 透明链、`AssetEntity.<member 2>.tags` 的成员序、`ROOT.keywords.<item>` 的裸数组元素位）均按规则表精确命中，值逐字相符；SYNTH 的 §4.5 全量表（aliasDocs 3 / fieldDocs 9 / markerDocs 7）SA2 独立重算后逐键一致。
3. **键位唯一性论证成立**。标识符字符集 `[A-Za-z0-9_]` 且字母起始（tokenizer.ts:53-58，已核）——字段名不含 `.`/`<`/空格，合成段不可碰撞；别名名不可为纯数字（字母起始），`aliasDocs` 键无整数式重排风险；E308 保证对象内字段名唯一（errors.ts 已核在册）；ref 不穿越（ADR 0003 §4 原文已核）使每 IR 节点恰访问一次、菱形链 O(文本规模)。唯一共享路径的透明标记链由 §3.3 按源序串联定形，且 parser 侧 `claimDocs` 在任意标记记号处（含嵌套实参位）可挂 docs（parser.ts parseMarkerType 已核）——碰撞形真实可达，§3.3 定形必要且策略（无丢失 + 源序确定）正确。
4. **递归与资源界成立**。`MAX_TYPE_NESTING = 100`（parser.ts:24）在 object（parseObjectType）、record、marker、`[]` 后缀四处计费（:278/:404/:435/:504 已核）——IR 嵌套深度有界，walkDocs 深度 ≤ 已付费界；walkDocs 对 ref 全盲（不查 bodies），即使手造环形 IR 也无环遍历风险，强于设计所述。
5. **typeCls 收敛方案（§5/§11）确认**。grep 复跑：源内调用点恰为 evaluate.ts:106/:140 + 内部递归 :144，无其他消费方（红灯测试仅做 `mod.typeCls` 导出断言）；resolve.ts 不经 index.ts 透传（内部件），去 export 非公共 API 破坏；`Resolver` 纯增方法成员；语义零变化（闭包委托 + `fold`/`localCls` 不动，红灯断言 8 的 S/M/U/ROOT 四例按现行为推演全部相符）；遗漏 caller 由 typecheck 编译期拦截（「编译期自愈」论证成立）。
6. **§6 观察项不纳入的裁决确认**。`discriminator` 确在派生 JSON 内且 `:444`/`:451` 存在「不得携带」的反向敏感锚（已核）；无红灯锚点的可观测输出变更违反本票 TDD 纪律，论证成立。`detectDiscriminator`（evaluate.ts:220-257，行号核实）零改动护栏应予保留。
7. **存量与版本**。253 存量计数 SA2 逐文件复算一致（37+33+16+19+79+7+7+36+8+11）；+8 = 261；版本 0.1.5→0.1.6 符合 Hard Gate 9；spec §10 与两测试文件内嵌 fixture 逐字一致。
8. **并发/撕裂维度不适用**：纯同步纯函数、无共享可变状态、无 IO——无竞态、无死锁、无缓存-存储撕裂面。附加确认：collectDocs 位于 buildResolver 之后（重复别名先被既有 InternalError 拦截）、顶层 try 之内（可抛路径均收编 E100——除 #2 所述两锚静默位）。

---

## 协议假设依据审查

- **章节存在**：§10「协议假设依据」在位，声明无协议级假设。本票为纯代码/类型层 bugfix（TS 类型扩展 + 求值器纯函数内新增遍历 + 内部件方法化），与 HTTP/WS/端口/进程/第三方库无涉——声明与改动面相符。**通过**。
- **依据可验证性**：唯一运行时行为依赖（evaluate「不抛错 + E100 收编」，引 evaluate.ts:62-65）SA2 已核为真（catch 全类型异常 → `makeIssue(ErrCode.E100, …)`）。
- **「应该/通常」类无据推断**：协议节本身无。但 §2.1 理由 3 把假设性未来缓存（仓内无此消费方）表述为既存事实——已列为攻击点 #4（LOW），建议修正口径，无需重跑实测。

## 错误处理链路审查

- **静默失败**：合法输入路径无静默失败（红灯 8 断言锚定可观测输出）。**手造 IR 路径存在**：攻击点 #2——alias/field 锚 docs 缺失静默落 `undefined`（无 E100、无日志、JSON 丢键）；marker 锚非数组 docs 字符级静默腐蚀。须按 #2 建议统一 loud 化。
- **状态闭环**：`ok:false + E100` 在既有路径（环/未声明名/重名/非 map 形 ROOT）全部闭环（resolve.ts/evaluate.ts 已核）；**新增 collectDocs 路径闭环缺口即 #2**，修订后闭环。
- **降级路径**：纯函数无外部依赖，不适用。
- **虚假降级识别**：逐项检查——`fieldDocs['…<key>']` 恒空数组**不是**虚假降级：IR record 节点确无 docs 槽（ir.ts:47 类型已核），属真实无数据并如实记载；union/array 节点同。未发现把「正常流程应恒满足的前提缺失」伪装成降级的设计。**通过**。

## 红灯测试思路

1. **（对 #1）markerDocs 全键集对账（SA7 补充测试方向）**：求值 FIXTURE 后 `expect([...Object.keys(derived.markerDocs)].sort()).toEqual([<§4.5 修正后 18 键的排序字面量>])`；fieldDocs 同款 22 键全集断言。比计数清点更强：计数对而键集错（本次事故形态）也能拦截。可再加性质断言：遍历 IR 统计 marker 节点总数 N，断言「同路径零碰撞模块中 `Object.keys(markerDocs).length === N`」（fixture 即零碰撞），从结构上封死「漏走某个标记位」类缺陷。
2. **（对 #2）手造 IR 三例 E100 红灯**：不经 parseVfsl 直接构造 module——(a) 某别名 `docs: undefined as any`；(b) 某字段 `docs: undefined as any`；(c) 某标记 `docs: 'foo' as any`（非数组）。每例断言 `result.ok === false` 且 `issues[0].message` 以 `VFSL-E100` 冻结前缀开头。附正向对照：合法 FIXTURE 求值仍 `ok:true`，防校验误伤正常路径。
3. **（对 #2 的序列化面）无 undefined 值性质断言**：对 FIXTURE 与 SYNTH 的 derived 做全树遍历，断言任何层级不出现 `undefined` 值（JSON 往返 `toEqual` 对对象内 undefined 键不敏感，此断言补上该盲区）。
4. **（对 #3）**：现有红灯三件套已覆盖 typeCls 收敛，无需新增；SA4 静态审查时核对 `Cls` 未用导入被清理即可。
5. 既有红灯 8 断言转绿路径已由 SA2 独立走查确认与 §3.2 规则表一致——SA3 实现须以**不修改红灯断言**为前提转绿（设计 §9 已锚定，重申）。

---

## 给 SA1 的修订范围（最小手术）

1. §4.5：markerDocs 表补 `AssetEntity.<member 2>.name` / `.size` / `.tags.<item>` 三键，15 → **18**；清点指令「22 / 15」→「22 / 18」（建议改排序全键集 diff）。
2. §3.4 + §4.1 伪码 + §7 行：三锚统一 `put` 助手 + `Array.isArray` 守卫抛 TypeError，使「缺 docs/形状异常 → E100」在全部三锚真实成立；§4.1 行数估算微调。
3. §5.2：补类型导入行去 `Cls` 一句（#3）。
4. §2.1 理由 3：缓存口径措辞修正（#4）。

以上修订不触及 §2 定形、§3 文法、§5 方案、§6 裁决、§8–§9 清单主体。修订后本轮评审对骨架部分的确认继续有效，SA2 复审仅需核上述四点。

*SA2 评审依据：worktree 40c1be0 + 未跟踪红灯测试文件（git status 已核；`M TASK.md` 为调度器工作区文件，与本评审无涉，重申不得进入分支 commit）。*

---

# SA2 攻击评审报告 — R2 复审

**Date**: 2026-08-20
**Verdict**: **pass**（R1 四攻击点经独立复核**全部真实消除**；对 R2 增量改面的攻击未发现新的实质漏洞。R1 已确认的骨架项——§2 三表定形、§3.2 路径文法、§5 typeCls 方案、§6 观察项裁决——经比对确认 R2 零改动，R1 确认继续有效。SA3 可按 R2 设计实现。）

R2 复审方法声明：不采信 SA1「逐条回应」表的落实声明，全部关键点由 SA2 本轮独立重做——含 spec §10 fixture **全量重新手工走查**（fresh 读入，三表逐键重算）、红灯测试文件 8 断言逐条重对、§4.5 排序全键集字面量**逐键逐字符比对**（UTF-16 字典序）、§4.1 伪码与 §3.2 规则表逐行一致性核验、evaluate.ts/resolve.ts/derived.ts/ir.ts/index.ts 源码行号复核、typeCls/DerivedSchema 消费面 grep 复跑、tsconfig 标志与版本号核查、253+8 测试计数复算、SYNTH 模块独立走查（3/9/7 逐键）。

## R1 四攻击点逐条复核

| # | R1 要求 | 复核结论 | 独立验证依据 |
|---|---|---|---|
| 1 | §4.5 markerDocs 表补 3 键（15→18）、清点指令升级为全键集 diff | **真实消除** | SA2 对 spec §10 重新全量走查：markerDocs 恰 **18** 键（Audit 组 3 + member 0 组 3 + member 1 组 3 + member 2 组 4 + Attachments 组 2 + ROOT 组 3），R2 表逐键相符，含 R1 指出的 `AssetEntity.<member 2>.name`/`.size`/`.tags.<item>`；fieldDocs **22**、aliasDocs **5** 同法重算一致（AssetId 两项挂载经 spec 挂载规则表核实——文件首个悬空 doc 归相邻下一声明）。排序字面量三段逐键逐字符比对：键集与我的走查集合**完全相等**，字典序全部正确（`AssetEntity`<`AssetId` 第 6 字符、`Attachments` 插于两者之间、`createdAt`<`createdBy` 第 8 字符、前缀短者先行、`ROOT` 组序）。清点指令已按 R1 建议升级为排序全键集 `toEqual` diff + 「marker 节点计数 = 键数」性质断言（fixture 零碰撞经我方独立计数确认：18 个标记节点路径两两互异）。SYNTH 3/9/7 独立重走查逐键一致（含红灯未锚定的第 7 键 `Entity.<member 1>.body.paragraphs.<item>`——设计表多列不冲突，属正确超集）。 |
| 2 | 三锚统一 `Array.isArray` 守卫抛 TypeError → E100；禁止静默规范化 | **真实消除** | §4.1 伪码：`put`（alias/field/record 合成位三处）与 `appendDocs`（marker 位）**先守卫后赋值/展开**——`undefined` 与非数组真值（含 `'foo'`）均在守卫处抛 TypeError，R1 指出的「字符串被 `[...'foo']` 字符级展开」漏洞被结构性堵死（展开行仅在守卫通过后可达）。§3.3 伪码、§3.4 重写、§7「手造 IR 边界」行三处口径一致成立。TypeError 落点经源码核实：collectDocs 位于 `evaluate` 顶层 try 内（evaluate.ts:46-65），catch 全类型异常 → `makeIssue(E100)`（:62-65）。`docs ?? []` 静默规范化禁令被设计显式收录（§3.4）。守卫粒度声明（数组性、不逐元素校验）与仓内既有边界粒度一致（resolve.ts:61-64 `resolveChain` 仅守 undefined）。 |
| 3 | §5.2 补 `Cls` 未用导入清理一句 | **真实消除** | §5.2 已含 `evaluate.ts:21` 条目（`import type { Resolver, Cls }` → `import type { Resolver }`），§8 改动清单③同步。已核 tsconfig.base.json:12 `verbatimModuleSyntax`、无 `noUnusedLocals`——确属整洁性而非门禁，定性与 R1 一致。 |
| 4 | §2.1 理由 3 缓存口径修正 | **真实消除** | 措辞已改为「为未来的 F2 编译缓存等**潜在**消费者保持前缀稳定」并显式注明仓内现存无此消费方——假设性表述不再伪装既存事实。键序固定（§4.2）设计本身未动。 |

## R2 增量攻击（新改面）

对 R2 新增/改写的每一块均做了针对性攻击，**未发现实质漏洞**：

1. **排序字面量块（§4.5 新增）**：除上述键集/序比对外，攻击了「字面量与实际产出错位」的可能——三段字面量与 §4.5 上文表、我的独立走查三方一致；排序注（两处易错序）本身正确。`<member 10>` 类字典序陷阱在 fixture/SYNTH（≤3 成员）不可达，字面量仅服务本 fixture，无泛化义务。
2. **`put` 单值位直接引用 IR 数组（§4.2 纯度注）**：攻击了突变交叉污染与序列化面——与 derived.ts:9-13 不可变契约 JSDoc 及 index 条目 node 共享对象引用的既有显式设计选择同纪律（源码已核）；`toEqual`/JSON 往返对引用 vs 拷贝无差别（红灯断言 5 路径不受影响）。
3. **fieldDocs 静默覆盖窗口**：攻击了「两条 field 条目同路径 → `put` 后者覆盖前者且无 loud 错误」——树走查下单值链不增段、分叉必增互异段，合法 IR 下两 object 节点不可能同路径；唯一理论入口（手造 IR 的 record 键位为 object，键值两位同路径递归）在到达 collectDocs 前必被 `valueOf` record 分支的 `keyPatternOf`（evaluate.ts:282/:317-322，E306）抛 InternalError → E100 拦截（collectDocs 位于 values 循环之后）——静默覆盖不可达，唯一性论证成立。
4. **§4.2 插入点时序**：collectDocs 位于 values 循环后、return 前、try 内（与 evaluate.ts:59-61 实际结构吻合）；重名别名先被 buildResolver 拦（resolve.ts:41-45 InternalError），「重复别名不静默后者覆盖 aliasDocs」成立。
5. **walkDocs 穷尽性**：switch 覆盖 ir.ts:40-57 全部 9 个 kind，无遗漏分支；ref 不穿越（终态）与 ADR 0003 §4 一致。
6. **typeCls/DerivedSchema 消费面**：grep 复跑——`typeCls` 源内调用点恰为 evaluate.ts:106/:140 + 内部递归 resolve.ts:144，无其他消费方；index.ts 无 resolve 透传（已核）；`DerivedSchema` 消费方 = index.ts:36 `export type` 透传 + evaluate.ts:23 类型导入 + 两测试文件自有局部结构类型（只读，必填加键不破坏结构可赋值性）。§11 审计表与源码事实一致，「编译期自愈」论证成立。
7. **存量锚点复抽**：:279 同输入全等、:284 JSON 往返、:326/:355 终态精确 `toEqual`、:431-437 MapField 三键、:444/:451 discriminator 反向锚、:485 `Object.keys(derived.aliases)`、:534-540 `values['Audit']` 精确对象——三表全部为顶层新增键，无一触碰；测试计数逐文件复算 253 + 8 = 261。版本 0.1.5（已核 package.json:3）→ 0.1.6 符合 Hard Gate 9。
8. **ALLOW LIST 扩展（SA7 audit 文件）**：`[SA7 owned]` 条目带「SA3 不得以此文件替代红灯 8 断言转绿义务」护栏，且「SA7 不落地则空转（SA4 warning 容忍）」不构成硬依赖——闭环而无可推诿空间，无漏洞。

## 协议假设依据审查（R2）

§10 章节在位，声明无协议级假设，与本票改动面（类型扩展 + 纯函数内新增遍历 + 内部件方法化）相符。**通过**。R1 攻击点 #4 的口径问题已修正，本轮无新增「应该/通常」类无据推断。

## 错误处理链路审查（R2）

- **静默失败**：合法输入路径无静默失败（红灯 8 断言锚定可观测输出）；手造 IR 三锚（R1 #2 缺口）已全部 loud 化，`undefined`/非数组均 → TypeError → E100，无静默落表、无 JSON 丢键、无字符级腐蚀。
- **状态闭环**：`ok:false + E100` 在新增 collectDocs 全部可抛路径闭环（守卫 TypeError 收编于顶层 catch）；设计期已为 SA7 登记三例手造 IR E100 红灯 + 正向对照（§8 方向 #2），验证闭环齐备。
- **降级路径**：纯函数无外部依赖，不适用。
- **虚假降级识别**：`fieldDocs['…<key>']` 恒空数组非虚假降级（IR record 节点确无 docs 槽，ir.ts:47 已核，真实无数据如实记载）；守卫禁令显式排除了把 loud 边界换成 `docs ?? []` 伪降级的方向。**通过**。

## 零影响观察项（不构成修订要求，供 SA3/SA4 参照）

1. §5.2 表述「两调用点方法化后 evaluate.ts 不再引用 `Cls`」微欠精确：`Cls` **当前**就未被 evaluate.ts 引用（:106/:140 用的是 `ctx.R.cls` 属性而非该类型；grep 已核仅 :21 import）。所开处方（:21 去 `Cls`）与事实完全一致，实现零影响。
2. 引用行号微瑕：嵌套计费点实为 parser.ts:278/:405/:436/:505（R1 报告自身写 :278/:404/:435/:504，差一位；R2 §4.3 引 :436-441 属真实计费位）。`MAX_TYPE_NESTING = 100`（parser.ts:24）与「界已付费」结论不受影响。
3. worktree 出现未跟踪目录 `.mabf-bg/`（基线跑批脚本产物：baseline.sh/pid/log 等）。非设计问题，但**不得进入分支 commit**——提请总控与 SA4 diff 范围核查（与 TASK.md 同款纪律）。

## R2 红线测试思路

R1 五条红灯思路中 #1–#3 已被设计完整转录为 §8「SA7 动态补充方向」+ §4.5 排序字面量（转录忠实，已核）；#4/#5 为既有红灯与静态审查义务，维持原判。R2 无新增漏洞，无新增红灯需求。SA7 如落地 audit 文件：三例手造 IR 构造须绕过 `parseVfsl` 直构 module（否则 E305/E302 先拦，测不到守卫）；性质断言「无 undefined 值」须自写递归遍历（JSON 往返 `toEqual` 对该盲区不敏感）。

---

**R2 结语**：R1 的 reject 由两项实质漏洞支撑，R2 均以最小手术真实修复且未借机改形（§2/§3.2/§5/§6 骨架逐节比对未动，R1 确认清单继续锁死）。设计的事实性交付物（对账表、排序字面量、守卫伪码、caller 审计）本轮经 SA2 全量独立复算无一处失真。**同意放行**；`pass` 不替代 SA4 静态门禁与 SA7 活链路验证。

*SA2 R2 评审依据：worktree 40c1be0（HEAD 已核）+ 未跟踪红灯测试文件与 wiki/raw 四文件（git status 已核）；`.mabf-bg/` 未跟踪目录已标记不得入分支。*

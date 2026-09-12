# 冲突报告 — task_issue-334（前置门禁）

- **Reviewed subject**: task（Issue #334 `[shape-budget] T1: 值通道形状预算——载体投影读取三参化与截断省略`，parent PR #332）
- **Reviewer**: SA8（mabf-sa8，dispatch `sa-b6d2f416-1110-4a72-b5cd-31935dcdc8ce`，phase conflict-gate，iteration 0）
- **日期**: 2026-09-12
- **裁决问题**: 三参 `readLogicalValueAtPath(doc, path, options?)` 形状预算行为是否架构清晰、与既有决策集冲突

## 1. Inputs and decision set

| 项 | 内容 |
|---|---|
| 任务简报 | `wiki/raw/task_issue-334.md`（issue body + 5 条 AC；untracked，由 dispatch 固化） |
| Issue 评论快照 | REST 读评论成功、**零评论**——无 Owner override 需要应用（comment IDs: none） |
| 决策集 | `docs/adr/` 现存 20 份 ADR 全部 accepted；无整份 superseded；ADR-0007 read/open 条款被 0008 部分取代（自述标注）；**ADR-0020/0021 在未合并分支，不入决策集**；0015/0023 从未存在 |
| 直接治理 | **ADR-0024（已接受，2026-09-12，本分支 commits `50d52a1`→`7679c57`→`ba11f32` 已入库）**——本任务是其验收节的「载体单元（doc-runtime 公共面）」切片 |
| 术语基准 | `CONTEXT.md` 形状预算/截断省略/截断清单/语义 schema 投影/载体投影读取词条（前四者已随 ADR-0024 程序更新在位） |
| 模块纪律 | `packages/doc-runtime/AGENTS.md`（schema 无关读取、index.ts 唯一公共出口、surface guard 全覆盖） |
| 规范协议 | `docs/protocols/instance-replication-v1.md` 等无读取面接触（ADR-0024 影响包不含 wire 面） |
| 现行事实核对 | `packages/doc-runtime/src/read.ts`（双参签名 L53-56、两态联合 L44-46、E100 顶层捕获、`projectValue`/`copyPlainStrict` 双递归）；全仓 `maxChildrenPerNode`/`READ_OPTIONS_INVALID`/`DeepOptional` 零命中（全新落地面，无先行实现） |

## 2. Decision analysis

| Decision | Clause | Subject behavior | Classification | Evidence | Required action |
|---|---|---|---|---|---|
| ADR-0024 决策 1（API 与参数语义） | depth/maxChildrenPerNode ≥0 整数、递归内生效、未展开分支零物化、`depth:0` 骨架（同形空容器+单条截断项）、终态 no-op、options 封闭形状（负数/非整数/非有限数/非对象/未知键响亮拒绝 → `READ_OPTIONS_INVALID`，不借路径/生命周期码）、不传 options 逐字节现行为 | 简报 L17 逐点复述决策 1；AC1（depth/width 形态、depth:0 骨架、终态 no-op）、AC4（非法 options 走新失败分支）、AC5（无 options 逐字节回归锚） | **implements-existing-decision** | `docs/adr/0024` L20–31 vs 简报 L17/L21-25；ADR-0024 验收节「载体单元」条 L126 | 无——照 ADR 实现 |
| ADR-0024 决策 2（截断省略为值内唯一截断形态） | depth/width 同一值内形态=键省略；消歧靠清单；E1 吸收纪律不动摇；无「键在值 undefined」第三态、无魔法哨兵、无同形空占位（`depth:0` 目标唯一例外） | 简报「截断省略为值内唯一截断形态(depth 与 width 同形态,键省略)」；AC4「缺席吸收语义……不破」 | **implements-existing-decision** | `docs/adr/0024` L33–40 vs 简报 L17、AC4 L24 | 无 |
| ADR-0024 决策 3（截断清单） | 条目 `path`/`kind`/`omitted`；depth 条目 path 尾段=被裁键名；width 只记父路径单条；**omitted=直接子项数（O(1)，非后代总数，钉死）**；条目不携带子键列表 | 简报「omitted = 直接子项数(O(1),非后代总数)」；AC2「截断事实(位置/裁因/直接子项数计数)随结果返回,可供 runtime 组合消费」 | **implements-existing-decision** | `docs/adr/0024` L42–56 vs 简报 L17、AC2 L23 | 无（注 A：见 §8 D-1——doc-runtime 层落形属 SA1 设计粒度） |
| ADR-0024 决策 6（公共面归属） | 载体投影读取公共面扩展为三参 `readLogicalValueAtPath(doc, path, options?)`；两条投影路径（Yjs 容器递归与 plain 域拷贝）携带预算；不新增第二条读路径 | 简报标题与 What-to-build 的落点=doc-runtime 公共面三参化；正对 read.ts 现行 `projectValue`/`copyPlainStrict` 双递归 | **implements-existing-decision** | `docs/adr/0024` L85–87 vs 简报 L5/L17；`read.ts` 头注 D6 双递归 | 无 |
| ADR-0024 修订节（ADR-0016 条款 2） | 「签名加法扩展为三参（`options?`），**无 options 时签名与语义逐字不变**」 | 简报「无 options 时行为逐字节不变」+ AC5 回归锚 | **implements-existing-decision** | `docs/adr/0024` L102 vs 简报 L17、AC5 L25 | 无 |
| ADR-0016 §分层与兼容面 L74（修订前原文） | 「`readLogicalValueAtPath(doc, path)` 签名与语义不变」 | 简报三参化直接触碰该句字面 | **no-conflict**（按修订后决策集） | ADR-0016 L74 已被 ADR-0024 L100-104 显式修订（四处登记，非静默矛盾）；后 ADR 显式修订=合法演进路径 | N-1（非阻塞 docs 镜像同步，见 §8） |
| ADR-0008 §读取能力（继续有效面） | 缺键/越界成功返回 `undefined`、中间缺失立即结束；段纪律；XmlFragment 语义字符串终态；own enumerable data property；同步结果联合、仅 internal bug 抛；读观察已提交瞬间 | 简报 AC4「缺席吸收语义与敌意 path 纪律不破(零 throw)」；AC3 零物化哨兵以现行 plain 域响亮失败面为反证 | **no-conflict** | `docs/adr/0008` L18–30 vs 简报 AC3/AC4 L23-24；`read.ts` L79/85/94/101 现状一致 | 无 |
| ADR-0008 §读取能力 L27（修订前原文） | 「空 path 深拷贝完整 ROOT；非空 path 只转换目标子树」 | 预算读使该句在带 options 时不再是字面完整深拷贝 | **no-conflict**（按修订后决策集） | ADR-0024 L99 显式修订：「不传预算 = 完整投影（既有语义作为默认保留）」；成本界改「实际返回部分」 | 无 |
| ADR-0003（ValueSchema 9-kind 冻结联合） | 冻结语义联合不得扩展 | T1 为纯值通道，零触碰 ValueSchema/派生 schema；截断标记走投影包装（决策 5）属后续切片 | **no-conflict**（冻结面零接触） | `docs/adr/0024` L77 明文不扩展 0003 冻结面；简报范围为 doc-runtime 值通道 | 无 |
| ADR-0024 决策 4/5/7 + 文档负控（readData 恒五键、resolveSchemaAtPath 三参化、DeepOptional、registry 正则、docs/integration「恰三键」注记） | 后续切片面 | 简报范围=doc-runtime 载体单元面（AC1「doc-runtime 单元面」），未抢先实现 runtime/vfsl/vfsl-protocol/registry 面 | **no-conflict**（范围纪律一致，同 issue #273 先例） | `docs/adr/0024` L58-69/L71-83/L89-95/L105；`docs/integration/cordis-plugin-hosting.md:340`（恰三键注记属 readData 面修订） | 无——T 系列后续票落 |
| ADR-0007（被取代 read 条款） | schema-aware `readLogicalValueAtPath(derived, doc, path)` | 不构成约束 | **no-conflict**（被取代面无接触） | ADR-0007 状态行 + L26 自注「已由 ADR 0008 取代」 | 无 |
| CONTEXT.md 词条（形状预算/截断省略/截断清单/语义 schema 投影/载体投影读取） | 预算语义、键省略形态、清单条目、消歧规则、_Avoid_ 清单 | 简报术语与词条逐字同源（同出 ADR-0024）；无任何词条与三参化/截断省略矛盾 | **no-conflict** | CONTEXT.md L41-55、L97-99 vs 简报 L17 | N-2（非阻塞可选：载体投影读取词条补三参形态句，见 §8） |
| `packages/doc-runtime/AGENTS.md` | 读取保持 schema 无关；公共 API 仅经 `src/index.ts`；public-surface guard 须覆盖每个导出；read 契约变更跑 root typecheck/test | T1 新增 options 参数、截断事实类型、新失败分支——全部经 index.ts 公共面且入 surface guard | **no-conflict**（义务被承接） | AGENTS.md L9/L14/L19 vs 简报 AC5「全套包门禁 + root typecheck/test」 | 无 |
| 协议/规范面（instance-replication-v1 等 wire 契约） | wire 冻结值以协议文档为权威 | T1 零 wire 面（ADR-0024 影响包不含协议面；简报无协议条目） | **no-conflict**（零接触） | ADR-0024 状态行影响包列表；简报全 AC 无 wire 项 | 无 |

**裁决分布**：implements-existing-decision ×5；no-conflict ×9；evolution-required ×0；hard-conflict ×0。

## 3. Overrides

| Old decision | Override authority | Scope | New obligation |
|---|---|---|---|
| —（无需 override） | — | — | — |

无 Owner 评论（快照零评论）。ADR-0016 L74 / ADR-0008 L27 与简报的字面张力**不需要 override**：ADR-0024 本身即合法修订载体（「新 ADR 修订/废弃旧 ADR」路径），其「对既有 ADR 的修订」节已显式登记——这是已完成的决策演进，不是待申请的例外。

## 4. Frozen surfaces

| Surface | Must remain unchanged | Evidence | Actual result（实现前基线） |
|---|---|---|---|
| 无 options 行为 | 逐字节现行为：成功两键 `{ok:true, value}`、失败 `PATH_NOT_ALLOWED` 单码、投影字节零变化 | ADR-0024 L29（决策 1）+ L102（0016 修订条款 2「逐字不变」）+ 简报 AC5 | `read.ts:44-46` 两态联合在库；SA6 行为/类型锚在库（含 `...test-d.ts` 签名锚） |
| 缺席吸收语义 | 缺键/越界/键空间外 ≡ `ok:true, value:undefined`；中间缺失立即结束；E1 键省略纪律 | ADR-0008 L23 + ADR-0024 L40（「既有缺席吸收语义不变」「E1 保持」） | `read.ts:79/85/94/101` 现状一致 |
| 零 throw 纪律 | 预期失败（含非法 options）同步结果联合返回；仅 internal bug 抛（E100 顶层捕获兜底） | ADR-0008 L28 + ADR-0024 L30（「同步、不抛」） | `read.ts` 顶层 try/catch 在库；guards 测试锚定 |
| `PATH_NOT_ALLOWED` 码域 | 路径/载体缺陷专用；预算缺陷不借用（也不借 `RUNTIME_READ_DISABLED`） | ADR-0024 L30 | 现行单失败码——新分支须新码 `READ_OPTIONS_INVALID`（待实现核对） |
| 终态语义 | `Y.XmlFragment` 语义字符串投影、标量原样；终态目标预算 no-op 的判定基座 | ADR-0008 L26 + ADR-0024 L31 | `read.ts` xml/scalar 分支现状一致 |
| 值域纪律 | 无「键在值 undefined」第三态、无魔法哨兵、无同形空占位（`depth:0` 目标自身唯一例外） | ADR-0024 L40 | 值通道现状无此类形态（新增形态须守住该面） |
| ValueSchema 9-kind 冻结联合 | 不扩展、不混入传输形态 | ADR-0003 + ADR-0024 L77（明文不采用扩展方案） | T1 零触碰（保持） |
| doc-runtime 公共面纪律 | 导出仅经 `src/index.ts`；surface guard 全覆盖每个导出 | `packages/doc-runtime/AGENTS.md` L14 | 现导出面将加法扩展（options/截断类型/失败分支）——实现后逐项核对 |
| 写路径/sequencer/persistence/wire/runtime readData 形状 | T1 只读 doc-runtime 单元面：写面、`readData` 三键→五键、registry lease 透传、投影通道裁剪全部不动 | ADR-0024 决策 4/5 归属 + 简报范围（AC1「doc-runtime 单元面」） | 零接触（保持）——越界即范围违约 |

## 5. Evolution requirements

**无未决 evolution。** 本任务所需的全部决策演进已随 ADR-0024 完成并入库（accepted，本分支三 commits）：

- ADR-0008 读语义修订（L99 登记）：「完整深拷贝 → 预算内投影 + 截断清单」，不传预算=完整投影默认保留；
- ADR-0016 四处修订（L100-104 登记）：含分层兼容面三参加法条款（无 options 逐字不变）；
- 修订计划七要素（修订文件/新旧语义/兼容迁移=0.x minor bump 破坏面论据/失败语义=READ_OPTIONS_INVALID/版本/验证=验收节红绿契约/冻结面=ValueSchema 不动）在 ADR-0024 内自成闭环。

**非阻塞 docs 同步债（登记，不构成 evolution-required）**：ADR-0008 / ADR-0016 正文尚未携带 ADR-0024 的镜像修订节（仓内惯例可参照 ADR-0008 之于 0016/0017/0018 的镜像节、ADR-0016 之于 0019 的镜像节）。ADR-0024 自身的显式登记（「四处显式登记，不静默矛盾」）已满足「显式修订不静默矛盾」纪律，决策集无歧义——按修订后文本裁决即得唯一结论，故不阻塞。

## 6. Hard conflicts

无。未发现任何与现有决策不兼容且无合法修订路径的条款。简报是 ADR-0024 验收节「载体单元」切片的忠实落地票：What-to-build 五要素与决策 1/2/3 逐点对应，五条 AC 全部可在 ADR-0024 文本内找到直接依据，无任何推翻或再修订既有决策的意图。

## 7. 架构清晰性判定（dispatch 裁决问题）

**三参 `readLogicalValueAtPath(doc, path, options?)` 形状预算行为架构清晰，可进入设计。** 依据：

1. **落点条款明确**：ADR-0024 决策 6 钉死公共面归属（doc-runtime 三参化、两条投影路径携带预算、不新增第二条读路径），与 ADR-0008 读域分层（读取 schema 无关、不进 sequencer）无一处抵触——预算被显式定性为「schema 无关的投影概念」。
2. **语义面完备**：depth/width 计层、终态定义、depth:0 骨架、截断省略形态、清单条目字段、omitted 计数口径、失败码、无 options 逐字节不变——全部在决策 1/2/3 内钉死，无待 Owner 裁决的开放分叉（开放问题四项——字节预算/maxTotalNodes/子键列表/L2 透传——均被 ADR-0024 明文划出 v1 范围）。
3. **与被修订 ADR 的关系合法且无歧义**：0008/0016 的修订前原文张力已被 ADR-0024 显式登记消解；后续切片面（决策 4/5/7、文档负控）与 T1 边界清晰，简报未越界。
4. **基线事实干净**：无先行实现、无陈旧引用、冻结锚在库可作回归基座；AC3 零物化哨兵与现行 plain 域响亮失败面构成行为级判别，退化实现无法偷渡。

## 8. Required actions

| # | 类型 | 内容 | 归属 |
|---|---|---|---|
| N-1 | 非阻塞 docs 跟进 | 为 ADR-0008/ADR-0016 正文补 ADR-0024 镜像修订节（或等价 stale-wording 标注），与仓内镜像惯例对齐 | 后续 docs 收口票或 T 系列末切片（非 T1 义务） |
| N-2 | 非阻塞 docs 可选 | CONTEXT.md「载体投影读取」词条可补三参形态一句（词条现不冻结签名，无矛盾） | 同上 |
| D-1 | SA1 设计输入注记（非冲突） | doc-runtime 结果联合如何携带截断事实，须同时满足三约束：AC2 可供 runtime 组合消费；AC5 + 0016 修订条款 2 的无 options 逐字节/逐字不变（两键成功形态不动）；0024 决策 1 新失败分支不借路径码。ADR 未预设 doc-runtime 层落形——属设计粒度 | SA1 |
| D-2 | SA1 设计输入注记（非冲突） | options 校验自身的失败边界归属（非法 options 在 G0/N0 之前或之后的定序、其零 throw/E100 覆盖、失败分支字段构成如是否携带 path）须在设计中成文并锚定 | SA1 |
| D-3 | 实现后复查清单 | §4 冻结面逐项核对实际 diff（尤其：无 options 逐字节锚全绿、PATH_NOT_ALLOWED 码域未混用、公共导出面经 index.ts 且 surface guard 覆盖、越界零接触） | 实现后 SA8 复查（见 §10） |

## 9. Verdict

**clear** —— 放行。

全部对照项为 no-conflict 或 implements-existing-decision；无 hard-conflict；无未决 evolution-required；无需 override。任务简报实质是 ADR-0024（已接受、已入库）验收节「载体单元」切片的实现落地票。

## 10. requiresConflictRecheck

**true**。理由：本任务扩展公共 API（`readLogicalValueAtPath` 三参签名、`ReadLogicalValueResult` 联合扩展、新导出类型面）并新增失败语义分支（`READ_OPTIONS_INVALID`）——公共 API 与失败语义面尚待 SA1 设计与 SA3 实现核对（§8 D-1/D-2/D-3）。设计产出后应运行 design 复审；实现触碰公共读取面后按 §4 冻结面逐项复查。

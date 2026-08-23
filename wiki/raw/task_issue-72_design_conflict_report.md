# 冲突门禁报告（设计后复审）

- 被审对象：`wiki/raw/task_issue-72_design.md`（SA1 设计 R1，2026-08-22，852 行）
- 冲突基准：`docs/adr/0001–0007` 全集（7 份，均 accepted，无 superseded）+ `CONTEXT.md`——盘点复用前置门禁（`task_issue-72_conflict_report.md`，本会话已逐份全文读取，无变更）
- 复审性质：轻量复审——设计与 ADR 决策一致性；全维度攻击评审属 SA2，不在本报告范围
- 特别专项：前置报告备注 **N2**（envelope/semantic 双指纹 domain separation 是否在设计中显式构造）的落实质量

## Verdict

`clear`

## 设计 vs ADR 逐条对照（仅列相关 ADR；边界确认类 0002/0004/0006 见结论段）

| ADR 条款（原文关键句） | 设计落点 | 对照结论 |
|---|---|---|
| ADR-0007「新增纯函数 `compileSchemaEnvelope(input: unknown)`：输入必须是严格封闭且恰含 `lang/version/id/text` 的信封；按 envelope、dialect、parse、evaluate、internal 分阶段返回结果联合」 | §2.4 签名 `compileSchemaEnvelope(input: unknown): CompileSchemaEnvelopeResult`，同步纯函数不抛错；§3 严格门（恰四键 + ENV-5 多余键拒绝）；§5.1/§5.2 五阶段顺序与可观测判别表 | no-conflict。五阶段全部可观测区分（kind+code 判别式）；「internal 为顶层 catch 横切兜底而非第五个串行判定」（§5.1-4）不违反「分阶段返回结果联合」——ADR 冻结的是阶段化失败语义，非判定排布方式，见备注 O2 |
| ADR-0007「编译成功产物包含冻结的 envelope、IR module、DerivedSchema、`envelopeFingerprint` 与 `semanticFingerprint`」 | §2.4 ok 分支五件套；§7 一趟深冻结覆盖容器 + envelope + module + derived | no-conflict。冻结容器超出条款下限（更严不违） |
| ADR-0007「指纹使用 SHA-256、UTF-8、canonical JSON 和带版本的 domain separation（`sha256:v1:<hex>`）」 | §6.1/§6.2：sha256Hex（FIPS KAT 锚定）、UTF-8 单射字节化、`sha256:v1:` 前缀（v1 = 算法+域文档形态联合版本号）、canonical 三层 + 单一生产者插入序（§6.5 范围声明：非 RFC 8785） | no-conflict。四要素逐一兑付；「canonical JSON」的解释属设计自由度且显式声明升级路径（v2 前缀），见备注 O1 |
| ADR-0007「envelope fingerprint 覆盖四键」 | §6.1 四键字面量表序全参与摘要；lang/version 恒定由精确摘要断言间接锚定 | no-conflict |
| ADR-0007「semantic fingerprint 覆盖 `lang + version +` 规范 IR，忽略空白和普通注释，保留 JSDoc、声明顺序及其他 VFSL 语义，并排除谱系标签 `id`」 | §6.2 域文档 `{domain:'vfsl-semantic', lang, version, module}`（无 id 键）；§6.4 敏感性矩阵逐行映射（trivia 丢弃/docs 原文进 IR/数组保序），§12 V1c/V2/V3 实测 | no-conflict。恒定域标签不改变覆盖性（lang+version+IR 任一变化仍必变摘要）；「lang/version 变化」成功路径不可达系方言门禁结构事实，非设计削减 |
| ADR-0007「module/derived 递归深冻结后才允许未来跨 namespace 共享；本阶段不实现编译缓存」 | §7 深冻结 + 明禁复制式冻结；§8 零模块级状态、不读不写 `compiledCache` | no-conflict（N1 落实） |
| ADR-0007「`@nomicore/vfsl` 继续保持无 Yjs 依赖」 | §14 文件清单仅 `packages/vfsl`，零新依赖（dependencies 恒 `{}`） | no-conflict |
| ADR-0007「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」 | §1.2/TH-3：失败联合 `SchemaParseIssue[]` 与 H1/H3 同型，不新增第三种 issue 形状、不加 stage 字段 | no-conflict |
| ADR-0001「解释行为由信封自述的方言版本决定……未知方言 loud-fail 只读」 | §4 ENV-4（readOnly true、消息前导「未知方言」），未知方言时 parse 零调用零 tokenize | no-conflict |
| ADR-0001「全部 JSDoc 标签……为文档性质」（JSDoc 保留的根基） | §6.4：docs 原文进 IR 参与 semantic 指纹（V2 实证） | no-conflict |
| ADR-0003「`evaluate(module: VfslModule) → …`（公共接缝）」「派生 schema……纯数据、可 JSON 序列化、可内容哈希」 | §5.3 编排走 index.ts 既有 `'./evaluate.js'` import 绑定（vi.mock 锚定的模块图边）；semantic 指纹 JSON 序列化 IR 依赖该纪律成立 | no-conflict |
| ADR-0003「引用**不内联展开**」（ref 按名共享） | §7.2 原地冻结保持共享引用同一性，明禁 clone-then-freeze（SA3 硬约束） | no-conflict（与前置报告 N 系列关注的深冻结-共享引用冲突面正面对齐） |
| ADR-0003「parse 接受集收窄：E310/E311 在解析层」 | §5 parse 阶段原生 issues 零损透传（与 parseVfsl 同输入深相等） | no-conflict |
| ADR-0005「**id 是标签不是键**」 | §6.2 semantic 域文档无 id 键；§6.4 仅 id 变 → envelope 指纹变、semantic 不变 | no-conflict |
| ADR-0005「`lang`/`version` 是方言身份」「消费方首动作 = 方言断言」 | §5.1 envelope 之后、parse 之前方言裁决；§4 断言单点复用 | no-conflict |
| ADR-0002（authority 出范围）/ ADR-0004（协议包零运行时、不进引擎包）/ ADR-0006（持久层不触） | §14 DENY LIST 显式冻结 vfsl-protocol/vfsl-codegen、无持久层文件、无 authority 残留 | no-conflict（边界确认） |
| CONTEXT.md 术语与惯例（求值器/派生 schema/validateLogicalSnapshot/标记类型大小写） | §1.5/N3：散文用「派生 schema」、compile 仅指组合入口、既有命名零触碰（§13 逐字不动清单含 validateLogicalSnapshot） | no-conflict |

## N2 落实质量专项评估（前置门禁必答收紧点）

**结论：显式、构造性、可审计地落实——达标。**

1. **显式构造**（非简报字面复述）：§6.2 三层落实表——外显格式层（共用 `sha256:v1:` 前缀，v1 = 算法 + 域文档形态联合版本号）、文档域层（两域文档语言构造性不相交）、用途层（观察信封变化 vs 共享语义产物，混用后果明示）。
2. **构造性保证**：envelope 域文档首键恒 `"lang"`、semantic 域文档首键恒 `"domain"` ⇒ 两域哈希输入字符串恒不等，双指纹互异非概率性；「反向也不可伪造：不存在任何信封使两域摘要相同」——论证在字符串层成立（`JSON.stringify` 按插入序发射键，首键字面量即异）。
3. **semantic 侧自述域标签**：新定义的域文档从第一天携带 `domain:'vfsl-semantic'`，防未来其他哈希用途（DocScope 缓存键演进、投影指纹）构造同形文档跨域碰撞；envelope 侧不加标签的理由充分（v1-spec §7 冻结形状自述身份 + 精确摘要锚锁死输入不可加）。
4. **第三域隔离**：与 H3 `getCompiled` 缓存键（裸 hex 无前缀）三哈希域两两不同源，预防冒用混淆。
5. **单文件审计点**：双域构造 + 前缀常量 + 域标签同址 `fingerprint.ts`（§2.2）；设计期实测 V12（两域文档恒不等、双指纹互异）留证。
6. **版本语义兜底**：任一层演进（摘要算法/域文档形态）→ 升 v2 前缀，旧指纹天然失效不混淆。

## 冲突点

无。裁决分布：全部相关条款 no-conflict；override-declared 0、evolution 0、hard-violation 0。设计自我定位为实现票（§1.1「ADR-0007 实现票」），未声明推翻任何 ADR，未呈现修订既有决策的意图；双门并存（§3.5）显式把未来收敛交给 ADR 层裁决——正确的分层姿态，非演进逃逸。

## 说明性备注（非冲突，O1 移交 SA2 重点关注）

| # | 事项 | 定性 |
|---|---|---|
| O1 | 「canonical JSON」兑付为冻结键序 + 紧凑序列化 + 单射字节化 + **单一生产者插入序不变式**，非 RFC 8785 排序规范化（§6.3/§6.5 范围声明） | 非冲突。ADR-0007 未定义 canonical 的具体规范；设计在单实现域内确定性成立（同语义 ⇒ 同指纹），跨实现互认诉求当前不存在（指纹消费方为 DocScope 缓存键等仓内用途），且 v2 前缀升级路径已预埋。属术语解释的设计裁决，质量判断（单一生产者不变式的守卫强度、§6.3 签名约束是否足够防第二生产者）归 SA2 攻击评审。 |
| O2 | internal 阶段实现为全函数体顶层 catch（横切兜底），非第五个串行判定（§5.1-4） | 非冲突。ADR-0007「按……internal 分阶段返回结果联合」冻结的是失败语义的阶段可区分性，设计以 ENV-100 单条 + 判别式（§5.2）完整交付；排布方式属实现自由度。 |
| O3 | 设计对既有 H1/H3 契约零触碰、对既有公共面纯增量（§10.2/§13/§14） | 非冲突，正向证据。代码层断言（「逐字不动」「grep 实证无穷尽消费方」）不属 SA8 基准，由 SA4/SA7 diff 与测试复核。 |

## 结论

**Verdict: clear，放行。** 设计 R1 与 ADR 全集 + CONTEXT.md 无冲突：ADR-0007 全部条款（签名、严格封闭、五阶段、五件套、指纹四要素、深冻结、无缓存、无 Yjs）逐条兑付，ADR-0001/0003/0005 支撑条款一致，边界（0002/0004/0006）未越界，术语惯例（N3）落实。**N2（双指纹 domain separation）以「构造性文档语言不相交 + 显式域标签 + 三域隔离 + 单文件审计」显式落实，质量达标**——超出简报字面、符合前置门禁收紧要求。无需 override，无需 Jim 裁决条目。

O1（canonical JSON 的解释边界）建议 SA2 在全维度评审中攻击「单一生产者不变式」的守卫强度，SA3/SA7 以相关决议文档 D1–D5 为实现与验收契约基准。

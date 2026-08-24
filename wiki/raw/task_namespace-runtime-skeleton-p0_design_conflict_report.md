# 冲突门禁报告（设计后复审）

- 被审对象：`wiki/raw/task_namespace-runtime-skeleton-p0_design.md`（SA1 设计，issue #89；任务类型 feature）
- 冲突基准：`docs/adr/0001`–`0008` 全集 + `CONTEXT.md`（8/8 全读本会话完成；已核实 ADR 与 CONTEXT 自前置门禁以来零改动——`git status` 干净，基准仍有效）
- 前置报告：`task_namespace-runtime-skeleton-p0_conflict_report.md`（verdict `clear`）。按技能纪律，本报告**不重复前置门禁全量盘点**，聚焦设计新增面与设计引入的新决策点。
- 复审范围：设计全文 622 行（§0–§13 + 交付声明）逐节对照 ADR 条款；设计的 §1.1「ADR-0008 条款→设计落点」映射表经逐行核验。

## Verdict

`clear`

## ADR 盘点（设计后复审增量结论）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源（含修订节） | accepted | 相关 | no-conflict：设计 §0 明文禁止 src 运行时代码内置 schema 文本（`TEXT_VALID`/`TEXT_BAD` 仅存于 SA6 测试，属「测试 fixture 除外」豁免）；方言 loud-fail 经 `compileSchemaEnvelope` 单源保持，未被绕开 |
| 0002 | nomicore 是全新重写，authority 出范围 | accepted | 弱相关 | no-conflict：设计未引入任何 authority 式不变式机制 |
| 0003 | 求值器与派生 schema | accepted | 相关 | no-conflict：P0 零接触 ROOT（INV-N3，边界条件 #9）；编译链路只消费既有 parse/evaluate 公共接缝，未改派生 schema 纪律 |
| 0004 | vfsl-protocol 类型投影 | accepted | 不相关 | no-conflict：未触碰协议包/类型投影 |
| 0005 | 投影生成管线 | accepted | 不相关 | no-conflict：未触碰 SchemaSource/codegen/domains |
| 0006 | Cordis 持久化 DocHandle（含 #64/#79 修订节） | accepted | 相关 | no-conflict：按 #79 修订后形状消费 DocHandle（owner/docId/doc/getStatus()/release()）；构造门接受 degraded、拒绝 released/disposed/未知值，与「获得并信任**有效** DocHandle」及冻结状态词表一致；同 entry 共享 live Y.Doc 实例语义（D3 引用捕获一次）被正确依赖；无持久层契约改动（§13 零契约改动声明核验属实——唯一既有文件触点是根 package.json 构建脚本） |
| 0007 | 逻辑验证与 Yjs Runtime Bridge（open/read 条款被 0008 取代） | accepted | 相关 | no-conflict：`compileSchemaEnvelope` 单源消费（严格门 ENV-1/2/3/5/4→parse→evaluate→双指纹→深冻结），验证决策点未在 Runtime 侧复制；零写入与 observer no-rollback 在零写路径子集自然满足；`DocRuntimeFatalError` 保留给写事务管线（冲突点 #4 分析） |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted | 直接相关 | no-conflict：设计 §1.1 映射表 13 行逐行核验属实；延后项（两类真实写/close barrier/完整 status/Registry）按原条款预留扩展位、未预写相悖形状（§0 表 + D6 七步文档位与 ADR 槽顺序逐字一致） |

## 冲突点

无 hard-violation、无 override-declared、无 evolution、无需 Jim 裁决条目。以下为设计新增面的逐条对照记录（均判 no-conflict），含四处需要文本细读的疑点拆解：

| # | 严重度 | ADR 条款 | 设计决策 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | info | ADR-0008「`getSchemaEnvelope()` 从顶层 `SCHEMA` Y.Map 投影 `lang/version/id/text` 四个 primitive string，忽略额外键，不 coercion 或补默认值」 | D4 原始投影：值原样带出（version 按 vfsl 契约为 number；类型错值不转换）、键缺席即省略、额外键结构性不出现 | no-conflict | 条款的规范性内容是「恰四键 + 忽略额外键 + 不 coercion + 不补默认」。若把「primitive string」读成值类型强制并做转换，反而违反**同句**的「不 coercion」；CONTEXT.md 信封定义用词为「四个**字符串键**」（键为字符串），未规定值类型。原始投影是唯一同时满足整句的读法。畸形 doc 的部分投影已在 §10 R2 显式登记 |
| 2 | info | ADR-0008「生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」 | D8'：`createNamespaceRuntimeWithSeam` 从 index 导出（@internal）；生产工厂 `createNamespaceRuntime` 包内不导出（AC1 锁定缺席） | no-conflict | 条款约束（a）生产构造器不公开——设计以测试锁定 `entry.createNamespaceRuntime === undefined`；（b）seam 由包提供、确定性注入——注入 handle 正是条款明文列举的 seam 能力。条款未规定 seam 的出口形态；SA6 冻结测试经 `../src/index.js` 导入，seam 自 index 可达是冻结测试契约的必要条件。公共面宽度权衡移交 SA2 |
| 3 | info | ADR-0008「`getMetadata()` 深拷贝顶层 `META` Y.Map 的全部键；META 是开放键空间，但值只允许 JSON-compatible plain value，不允许嵌套 Yjs shared type；v1 不提供 META 写」 | D5：值域违规（嵌套 Yjs/NaN/±Inf/非 plain 对象等）→ 抛 `MetaProjectionError`（loud），绝不静默跳键 | no-conflict | 条款规定的是 META **值域不变量**（创建/写方责任，v1 无 META 写），未规定不变量被破坏时读取投影的行为。设计显式选择 loud 而非静默降级/跳键，与任何条款不相悖；深拷贝防污染有实测依据（§12 #1④） |
| 4 | info | ADR-0008「`@nomicore/doc-runtime` 必须提供 branded `DocRuntimeFatalError`，至少包含 `committed` 与稳定 `phase`。任何 internal fatal——无论 committed 与否——都永久关闭该 Runtime 的全部写能力并保留读取」 | §1.2/D7 ⑦：P0 internal fault 不经 `DocRuntimeFatalError`（P0 零 Yjs transaction，committed 维度不适用），走自有稳定摘要 `NSRT-FATAL-P0-INTERNAL` | no-conflict | 条款要求 doc-runtime **提供**该类型（#87 已交付，服务写事务管线）；未规定非事务型 fault 必须以该类型表示。fatal **行为协议**逐项兑现：永久关写（D9 位公式 fatal 短路）、保留读取、不调 dirty notifier（对应 committed:false 分支）、不补偿不 fallback、原始异常不进公共投影（INV-N7） |
| 5 | info | ADR-0008「发布后 read 立即可用，早期写排在 P0 后」+「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write仍可修复」 | D9：preparing 期 `rootWrite.enabled=true`（早期写可接纳排队）；unavailable 后 `schemaWrite.enabled` 仍可为 true | no-conflict | 位值是能力真话：两条款分别明文「早期写排在 P0 后」（可接纳）与「SCHEMA write 仍可修复」；本任务无公共写方法，位值无实际写路径承载，`writableNow` 瞬时观察与「gate 是瞬时观察」一致 |
| 6 | info | ADR-0008「`persistence-degraded`……不阻止 read 或不写 Y.Doc 的 P0」+ ADR-0006 #79 冻结 `DocHandleStatus` 词表与优先级 | D1 V2：构造接受 `ready`/`persistence-degraded`，拒绝 `released`/`disposed`/未知值（loud） | no-conflict | degraded 不阻止 read/P0 ⇒ 构造期放行是条款直接推论；released/disposed 非「有效 DocHandle」；未知值 loud 拒绝正是消费冻结词表的正确姿态（不猜测降级） |
| 7 | info | ADR-0008「Runtime 提供结构化瞬时 capability status，而不是单一扁平枚举……status 不暴露队列长度、任务类型或 sequence。v1 不提供公共事件订阅」 | D9：六键结构化 status（无 close 摘要；lifecycle 类型仅 `'ready'` 字面量）；全设计无事件订阅 | no-conflict | close 摘要与 close() 同属简报显式延后子集（前置门禁边界注记 1 已裁定：部分 status 不得固化扁平枚举形状——设计交付的正是结构化形状且无队列内部字段，前向兼容完整投影） |
| 8 | info | ADR-0008「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器」 | D2：七键闭包对象 + `Object.freeze`；三投影均返回普通对象/深拷贝/冻结身份 | no-conflict | getSchemaEnvelope/getMetadata 每次产出全新普通对象，getActiveSchema 返回冻结身份，module/derived/validator 不出现在任何公共面（D8/SA6 锚点锁定三键 undefined） |
| 9 | info | ADR-0008「每个真正写任务的槽依次执行：lifecycle/fatal gate、`DocHandle.getStatus()` writable gate、输入快照、领域校验和 detached 构造、一次 Yjs transaction、`await notifyDirty()`，然后才释放给下一任务」 | §0/D6 写槽扩展位（仅文档）：七步顺序逐字复刻 + close barrier 队尾挂接点 | no-conflict | 顺序、步骤、释放时机与条款逐字一致；snapshotter/notifyDirty 未提前实现，仅留挂接点（符合前置门禁边界注记 2） |
| 10 | info | ADR-0008「已排队的后续写仍按 FIFO 取得槽，且不访问输入、零写入返回 `RUNTIME_WRITE_DISABLED`」 | D6：promise-chain 前项 settle（含 reject）后项方启、链尾恒绿 | no-conflict | FIFO 不断裂语义正是该条款的前置结构；RUNTIME_WRITE_DISABLED 属后续写面返回值，设计未预写 |
| 11 | info | ADR-0008「Runtime 发布前，P0 已作为 write sequencer 的真实队首节点入队……P0 只读取 SCHEMA 标准四键、调用 `compileSchemaEnvelope` 并构造 schema-dependent tools，不读取、提取或验证 ROOT，也不捕获跨时间 prepared mutation」+「P0 结算后出队，只保留 preparing/ready/unavailable」 | D6/D7：return 前入队 + 微任务起步（INV-N1）；P0 与公共投影同源单点读四键；INV-N3 零 ROOT 接触；INV-N6 三态封闭、终态锁定；结算即出队 | no-conflict | 逐项对应；seam `p0Gate` 是测试可控延迟，非「跨时间 prepared mutation」；fatal 停留 preparing 使三态集合保持封闭 |
| 12 | info | ADR-0006「跨 Adapter/HMR reload 的 foreign handle、已释放 handle 的 saveDoc 都响亮拒绝」（saveDoc 拒绝面） | D1：外部违约 `handle.release()` 后读取面继续、lifecycle 不变、写位瞬时观察转 false | no-conflict | 条款约束持久层 saveDoc 拒绝面，未规定 Runtime 读取面在租约被外部违约释放后的行为；设计显式记录 v1 边界（§10 R3）并移交 close() 后续 issue，未与任何条款相悖 |

**门禁范围外事项（登记不裁决）**：§7.1 tsconfig include src-only（偏离六包惯例）、§7.2 根 typecheck 脚本追加——ADR/CONTEXT 无对应条款，属构建层惯例与设计权衡，归 SA2 攻击评审与 SA4 比对；§12 协议假设（yjs/ECMAScript 行为实测）为事实性依据，非决策冲突面。

## 结论

**Verdict `clear`：放行。** 设计与 ADR 全集 + CONTEXT.md 一致性核验通过：0 hard-violation、0 override-declared、0 evolution、需 Jim 裁决条目 0。设计未推翻、修订或规避任何既有决策；四处文本细读疑点（#1 primitive string 措辞、#2 seam 导出形态、#3 META 违规行为、#4 P0 fatal 表示）经逐条拆解均落在 ADR 未规定域或条款自身的一致读法内，无一是对决策的实质偏离。

移交 SA2 的注意力清单（非冲突，供攻击评审聚焦）：

1. **#2 seam 公共面宽度**：seam 构造器自 index 导出使任意消费方可绕过未来 Registry 直接构造——ADR 未禁止，但这是设计自行选择的宽松落点，SA2 可攻击其边界。
2. **#1 畸形 doc 投影偏差**：`getSchemaEnvelope` 对畸形 doc 返回部分投影/null，与类型声明 `SchemaEnvelope` 存在运行时偏差（设计 §10 R2 已自登记）。
3. **§7.1 include 收窄**：六包惯例偏离的依据链是否充分（SA6 冻结测试类型不符 + tsc 实测 TS2322）。
4. **§10 R4 fatal 原始异常丢弃**：ADR-0008 明文观测面属后续 issue，但排障信息缺失的代价已由设计自评为中风险。

配套更新：`task_namespace-runtime-skeleton-p0_relevant_decisions.md` 已追加「设计引入的新决策点」一节（seam 出口/构造门/null 三分支/META loud/P0 fatal 表示/外部 release 边界/status v1 形状/sequencer 链语义/能力位语义/写槽扩展位/构建层决策），供 SA3/SA4/SA7 实现与验收对照。

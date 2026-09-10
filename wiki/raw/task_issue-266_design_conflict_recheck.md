# 设计后冲突复审（design post-recheck）— Issue #266：VFSL 内容寻址 schema ID（sc1-）

## 任务标识

- 复核对象：`wiki/raw/task_issue-266_design.md`（SA1 设计，dispatch
  `sa-35ad400b-ff6d-4e0e-a76a-e1f856131355`，iteration 0，phase design，671 行）。
- 本轮：SA8 设计后复审（dispatch `sa-3246a326-11e8-4e4e-b863-fe9b7714177c`，iteration 1，
  phase conflict-gate）。触发依据：设计 §16 自评 `requiresConflictRecheck = true`（新增公共
  API + envelope 相位新失败语义 + 前置门禁 B1 明文要求设计后复核）。
- 前置冲突证据：`wiki/raw/task_issue-266_conflict_report.md`（前置门禁，verdict `clear`，
  9 项冲突点全 no-conflict，附 B1/B2/B3 三项设计期边界条件移交）。
- Issue #266 评论：派发注记 REST 读取为空、无 Owner 追加要求（本轮无新评论面）。
- 冲突基准（**只有**以下两源；代码与 wiki 其他文档不构成自动阻塞依据）：
  - `docs/adr/` 全集 14 文件（0001–0012、0014、0015；0013 编号空洞；无 superseded ADR，
    被取代条款不参与裁决）。本轮全读 0001/0003/0005/0006/0007/0008/0015，其余 7 件
    （0002/0004/0009/0010/0011/0012/0014）经条款级 grep 核验非相关性（`sc1-`/`内容寻址`
    仅 0015 命中；`schema id/fingerprint` 仅 0014 L214 observer 观测字段命中——消费而非
    定义引擎 ID 格式）。
  - 根 `CONTEXT.md` 全读（「语义指纹」L70-71、「内容寻址 schema ID」L73-75 为核心词条）。
- 执行说明：`sa8-conflict-gate` 技能在本会话 `.agents/skills/` 目录不可用（与前两轮门禁
  所见一致），按 SA8 角色章程与仓库既有先例方法论（`task_238_design_conflict_recheck` 同款
  四级裁决口径 no-conflict / override-declared / evolution / hard-violation）执行；除本报告外
  零文件改动、零业务代码触碰。

## 复核方法

1. 设计全部规范性断言逐条对照 ADR/CONTEXT 原文独立推导（不采信设计自评）。
2. 前置门禁 B1/B2/B3 三项边界条件**独立重验**（含代码锚点实读：`envelope.ts` 注册表与
   `ENVELOPE_KEYS`、`index.ts` getCompiled 缓存键、fixture 锚 L91）。
3. 设计的事实面锚点抽验：SA6 红灯矩阵是否确实要求拒绝 `SC1-`/`sc2-`（D3 的任务侧依据）；
   全仓 `sc<digits>-` 族 id 零回归面；v1-spec 无 ENV 码记载（B3②）。
4. `packages/vfsl/AGENTS.md` 工程纪律面（公共 API 仅经 index.ts、稳定码/排序/严格性/指纹输入
   为兼容行为）对照设计 §12 文件范围。

## Verdict

`clear`

SA1 设计与 ADR 决策集 + CONTEXT.md **无冲突**。13 项逐条对照全部 **no-conflict**
（逐字兑现 5、既定框架内扩展 4、边界条件落实 3、工程纪律 1）；override-declared 0、
evolution 0、hard-violation 0。前置门禁移交的 B1/B2/B3 三项边界条件经独立重验**全部满足**。
设计是 ADR 0015 §「内容寻址 schema ID」+ §「测试决策」的兑现型切片，未重开任何已决条款
（B2）、未把「id 可校验」外溢为引擎正确性依赖或 doc/复制身份（B1）、新码落点正确（B3）。
附 3 项非阻断登记（N1 保留族词汇登记建议、N2 ENV_7 判定相位结构注记、N3 fixture 锚修订
路由确认），均不阻塞设计进入 SA2 攻击评审。

## 一、逐条对照（设计面 → 基准条款）

| # | 设计面（设计章节） | 基准条款（原文锚点） | 裁决 | 依据 |
|---|---|---|---|---|
| R1 | D1/§8.1 窄接口 `deriveSchemaIdentity(text: string)`：text-only（lang=vfsl/version=1 上下文常量）、不接收 provisional envelope ID、不暴露 IR/派生 schema/validator、非 REST endpoint、ok 分支恰三键、同步纯函数不抛错（E100 镜像崩溃边界） | ADR 0015 L119-125（窄 Module interface 逐字：输入 lang/version/text；「不接收 provisional envelope ID，不暴露IR、派生schema或validator……它不是REST endpoint」「复用现有VFSL编译pipeline，返回semantic fingerprint和schema ID，或VFSL issues」） | **no-conflict（逐字兑现）** | 形状/失败面/四不暴露逐项对应；采纳 SA6 H1 假设签名（前置门禁冲突点 1 同源）；「或VFSL issues」= 失败联合 `{ok:false; issues: VfslIssue[]}` |
| R2 | D2 窄接口相位 = parse-only（复用 `parseVfslImplementation` + `semanticFingerprintOf`，不跑 evaluate） | ADR 0015 L125「复用现有VFSL编译pipeline」；ADR 0007 L17（semantic fingerprint 定义输入 = `lang + version +` 规范 IR——evaluate 产出不是身份输入） | **no-conflict（读法核验通过）** | 「复用」约束机制（单一 parser/指纹生产者，D2 单生产者不变式保持），非相位广度；无任何决策要求 evaluate 参与身份派生；诚实边界已声明（derive ok ⇏ evaluate ok，权威门 = 完整 envelope 编译/Registry create）——与 ADR 0015 L142「首版有意接受两次编译」的编排互恰；备选（parse+evaluate）只会掺入与身份无关的求值 issue，反而偏离「或VFSL issues」失败面 |
| R3 | D8/§8.2 sc1- 冻结格式：恰 `sc1-`（大小写敏感）+ 52 位小写 `[a-z2-7]`、无 `=`、pad 位为零（末字符 ∈ {a,q} 为数学推论）；payload = semantic fingerprint 完整 256-bit digest 不截断，与 `sha256:v1:<64 hex>` 同 digest | ADR 0015 L127-133 逐字（`sc1-<52位小写 RFC 4648 Base32>`；「不截断、无`=`padding」「它与`sha256:v1:<64 lowercase hex>`携带相同digest信息」）；CONTEXT.md L74 词条逐字（「v1 canonical 形式为 sc1- + 52 位小写 RFC 4648 Base32（无 padding）」）；ADR 0007 L17（`sha256:v1:` domain separation） | **no-conflict（逐字兑现）** | 三处文本一致；不产生第二套摘要语义（同 digest 双 canonical 编码）；「sc1- 表示 schema ID 格式版本」（L133）为 D3 族规则的种子条款 |
| R4 | D4 两稳定码 `ENV_6`（格式）/`ENV_7`（语义不匹配）：envelope.ts `EnvelopeErrCode` append 式注册表追加；冻结前缀 `VFSL-ENV-E<码>: `；`readOnly=false`；`{kind:'envelope'}` 单条 | ADR 0015 L144（「格式错误和语义不匹配使用两个稳定VFSL issue code，具体编号由实施时按错误注册表分配」——显式授权）；ADR 0008 L131（`SCHEMA_ENVELOPE_<code>` 动态族 = vfsl envelope 相位码的不透明透传，码域归上游注册表，runtime 零注册零改动） | **no-conflict（B3 自然读法落实）** | 编号 6/7 沿注册表既有次序取未占用值，恰为授权所及；envelope 码空间与方言层 21 码冻结表互斥（envelope.ts L22-30 实读核实）；readOnly 不变量保持（仅 ENV-4 true）；「VFSL issue code」泛称不被误读为挤进方言层表——前置门禁 B3① 注意点已被设计吸收 |
| R5 | D5 相位放置：格式步入 `envelopeStrictGate` 步骤⑤（形状→封闭→方言→**sc1- 格式**，envelope 相位、先于 parse）；mismatch 步在 parse 成功后、evaluate 前；组合序 = ENV-6 先于 parse issues、ENV-7 后于 parse 先于 evaluate | ADR 0007 L15（`compileSchemaEnvelope`「按 envelope、dialect、parse、evaluate、internal 分阶段返回结果联合」）；ADR 0015 L144（必须验证「canonical 格式**及其与text semantic fingerprint的精确匹配**」——语义指纹按定义需要规范 IR ⇒ 匹配判定必然在 parse 之后） | **no-conflict（既定框架内加法）** | 见结构注记 N2：相位模型是失败类别联合，不强制全部 envelope 类判定先于 parse；ADR 0015 自身定义迫使 ENV_7 的最早可判定点在 parse 成功后，设计取最早可行点且不扰动既有 fail-fast 锚（新步在方言断言之后，既有顺序锚不受扰）；parse 失败文本 + canonical id → 原生 vfsl issues（SA6 N3 绿锚）与「精确匹配」义务不矛盾（无规范 IR 即无指纹可匹，编译仍 ok:false） |
| R6 | D3 保留族触发器 `/^sc[0-9]+-/i`：族内仅恰 `sc1-` + canonical payload 合法，其余（`SC1-`/`Sc1-`/`sC1-`、`sc2-`、`sc10-`、空/51/53 字、大写、`=`、字母表外、内嵌空白、pad 位非零）一律 ENV_6；族外（含 `mysc1-provisional-id`、`sc-`、全部旧式标签）零触及 | ADR 0015 L144（「任何输入envelope一旦使用`sc1-`前缀……必须验证canonical格式」「旧式SCHEMA id继续兼容」）；CONTEXT.md L74（「任何 `sc1-` id 都必须与同信封 text 的 semantic fingerprint 精确匹配」+ Avoid 清单）；ADR 0006 L70（旧式 id = `命名空间@schema版本` 谱系标签例举） | **no-conflict（决策未涉空间的设计自由度 + 任务侧契约要求）** | (a) 无任何决策要求接受 `sc2-`/`SC1-` 形态——它们既非 `sc1-` 前缀亦非旧式谱系标签，属 ADR 未定义空间；(b) 拒绝是冻结 canonical 形状的防仿冒执行（`SC1-<52字>` 视觉冒充内容地址；`sc1-` 的 `1` 是格式版本，`sc2-` 是尚不存在的未来版本——设计 §14.3 明示升版本需新决策）；(c) SA6 红灯矩阵明文锁死该行为（文件 1 十六红含「前缀大小写 ×3、`sc2-`」，L215「格式版本错误 sc2-」实读核实）——任务验收契约要求；(d) 零回归面实证（本轮 grep：`sc[0-9]+-` 仅存在于 SA6 两契约文件与参考件，生产 src/domains/apps/既有测试零命中）；(e) 设计显式论证并拒收 fixture 迎合型启发式（§7 D3 备选 b）——该启发式若被采纳将真正违反 ADR 0015 L144「任何 sc1- 前缀必须验证」。附词汇登记建议 N1（非阻断） |
| R7 | D6 义务面边界：仅 `compileSchemaEnvelope` 加 sc1- 校验；`parseSchemaEnvelope`/`getCompiled` 行为不变，getCompiled 缓存键保持纯文本哈希 | ADR 0015 L144（义务主语 =「VFSL完整envelope编译」——含 evaluate 与双指纹的成功路径） | **no-conflict（读法核验通过）** | 「完整 envelope 编译」自然读法 = `compileSchemaEnvelope`（ADR 0007 L15 同一术语）；不扩面是保守方向，扩面才需新决策；B1 侧 getCompiled 键纯文本哈希（index.ts L260 `sha256Hex(text)` 实读核实——id 不参与）一并保持 |
| R8 | B1 纪律落实（§7 D3/§9）：校验真实性（格式 + 与同信封 text digest 相等）而非唯一性；同一 sc1- id 合法出现于多 namespace；doc/复制身份仍为 namespaceId/replicationId；不读不写 compiledCache | ADR 0005 §1（「id 是标签不是键：引擎正确性不依赖 id 唯一性……id 的用途是人读标签、管理端谱系追踪、**工具链寻址**。信封 id ≠ doc 地址」）；ADR 0010 L50/CONTEXT.md L129-131（replicationId ≠ SCHEMA 信封 id；Avoid「用 SCHEMA id 充当文档实例身份」） | **no-conflict（B1 复核通过，见下节）** | sc1- 是已登记扩展（CONTEXT.md 词条整合两制），非矛盾；引擎正确性仍不依赖 id——id 错只导致该信封被拒（loud），不产生错误编译结果 |
| R9 | 指纹算法零改动（空白/普通注释稳定、JSDoc/声明顺序敏感、排除 id 全继承；sc1- 只是同一 digest 另一编码） | ADR 0007 L17 逐字；CONTEXT.md L71「语义指纹」词条逐字；ADR 0001 L11（语义层无机器标签——JSDoc 保留在指纹是内容身份事实，不复活机器标签） | **no-conflict（逐字兑现）** | 前置门禁冲突点 3 同向；`fingerprint.ts` 两构造函数语义不动，仅追加内部 digest 提取件（格式知识单源，不新增第三引用文件——RT-1a 守卫辖域内核验） |
| R10 | ENV-4 优先于 ENV-6（`SC1-` 族 + 未知方言组合 → ENV-4 先出） | CONTEXT.md L12（方言「一经发布冻结……未知方言 loud-fail 只读」）；ADR 0001（方言冻结纪律） | **no-conflict** | 未知方言 = 全盘只读拒收，先于 id 值域裁定；既有 ENV-4 测试面零扰动（envelope.ts L34-39 readOnly 语义保持） |
| R11 | §12 文件范围：ALLOW = `packages/vfsl/src/{schema-id(新),envelope,fingerprint,index}.ts` + 一处测试锚更名（明示由 SA6 修订轮执行、非 SA3）；DENY 护 errors.ts/管线本体/schemasource/package.json/两契约测试/下游 packages/v1-spec/ADR 0015/CONTEXT.md/domains | B2（不重开条款）、B3（不触方言层表与规范文档）、`packages/vfsl/AGENTS.md`（公共 API 仅经 src/index.ts；稳定码/排序/严格性/指纹输入为兼容行为；公共类型变更须跑根 typecheck+test）、ADR 0015 L125（复用而非改管线） | **no-conflict（工程纪律执行面）** | 新导出仅经 index.ts（§8.1 + 头注补记）；编码件/digest 提取件不进公共面；既有码/排序/严格性零改（负控 N1/N2 + 557 绿守护）；验收含根门禁（§13）；DENY 明示 ADR 0015 与 CONTEXT.md 零改动——与「词条已是目标态」核验一致（L73-75 实读） |
| R12 | §14.1 fixture 缺陷诚实报告：SA6 文件 1 L91 锚 `id: 'sc1-fixture-anchor'` 与自身 16 红语义结构性互斥；生产语义按规范义务裁决，锚更名（一处字符串）移交 Controller 路由 SA6 契约修订轮；SA1 不改测试 | ADR 0015 L144「任何输入envelope一旦使用`sc1-`前缀……必须验证」+ CONTEXT.md L74「任何 `sc1-` id 都必须……精确匹配」 | **no-conflict（规范义务优先于 fixture 迎合——方向正确）** | 锚缺陷实读核实（test L89-97 helper + L100-105 模块作用域基准，`expect(r.ok).toBe(true)` 于模块收集期失败 ⇒ 整文件 error）；若为迁就该锚而开洞（内容启发式），将构成对 L144/L74 文义的实质违反——设计拒收该备选正是冲突避免；路由方式（SA6 修订轮、SA1 不改测试）符合分工硬门禁 |
| R13 | 公共面新增导出的接缝合法性（新 Interface 与既有公共观察点并存） | ADR 0003 L14（「PRD #3『唯一公共测试接缝』的早期措辞废止；parseVfsl / evaluate / validateSnapshot / validatePatch 及数组写入校验入口均以各自 Interface 作为公共观察点」） | **no-conflict** | 各 Interface 各自冻结是既定纪律；新公共导出不撤销、不改动任何既有公共面（§11 调用方影响矩阵全零改动核验） |

裁决分布：**no-conflict 13**（逐字兑现 5：R1/R3/R9 + R4/R7 读法直兑；既定框架内扩展/读法核验 5：
R2/R5/R6/R10/R13；边界条件落实 2：R8/R11；方向裁决 1：R12）；**override-declared 0，
evolution 0，hard-violation 0**。

## 二、前置门禁边界条件独立重验（B1/B2/B3）

### B1（ADR 0005 D1 交叉卫生：「id 可校验」不得外溢）——满足

- **不外溢为引擎正确性依赖**：sc1- 校验的输出只有「放行/拒绝」，不参与任何编译产物构造；
  族外 id 路径字节不动；`getCompiled` 缓存键 = `sha256Hex(text)`（index.ts L260 实读），
  id 不进键——「指纹算法独立于 id」既有事实保持。
- **不外溢为唯一性依赖**：设计明示校验真实性（digest 相等）而非全局唯一；同一 sc1- id
  合法出现于多 namespace（内容寻址要义）；无任何注册表/唯一性索引引入。
- **不进入 doc/复制身份**：doc/复制身份仍是 namespaceId/replicationId（ADR 0010、CONTEXT.md
  「复制谱系」词条 Avoid 清单）；envelope fingerprint 仍覆盖四键（含 id）不变——两制并存
  语义与 ADR 0007 L17 逐字保持。
- **已登记扩展**：CONTEXT.md L73-75 词条已把「旧式兼容 + sc1- 强校验」整合为单一义务句；
  非静默演进。遗留卫生点（ADR 0015 → 0005 交叉注记）维持前置门禁原建议：PR #158 收口或
  翻 accepted 时补一行（总控收尾清单，设计 §14.3 已登记）。

### B2（ADR 0015 为 governing、不重开已决条款；状态流转归收官）——满足

- 设计 §1 非目标明示「不重开 ADR 0015 已决条款」；§12 DENY LIST 明示 ADR 0015 零改动；
  全部条款（L119-144/L196）以兑现方式引用，无一改写。
- 「提议 → accepted」翻转移交总控收尾清单（§14.3），SA1 不越权处理。
- ADR 0015 随 PR #158 在途、#266 挂其分支实现 = 集成 PR 纪律既定模式（前置门禁冲突点 7
  裁定不变）。

### B3（新 issue code 落点与规范同步）——满足

- 两码落 envelope 层 `VFSL-ENV-E<码>:` 注册表（envelope.ts 既有 append 式注册表，
  L22-30 实读：ENV_1–5/100，与方言层 21 码互斥的注释纪律在文件头明示）；
  `errors.ts` 方言层冻结表与 `docs/vfsl/v1-spec.md` §4 零触及（DENY LIST 明示）。
- 规范同步核验：本轮 grep `docs/vfsl/` 全目录——**零 ENV 码记载**，envelope 注册表维持
  source-resident 既有模式 ⇒「若新码记入规范文档须同步」的前提不成立，无待同步项（设计
  §6 B3② 判断核实）。
- 「稳定 VFSL issue code」以冻结 message 前缀 + envelope `code` 字段表达（`makeEnvelopeIssue`
  唯一构造点纪律保持）；下游 `SCHEMA_ENVELOPE_6/7` 经 ADR 0008 L131 动态族零注册透传。

## 三、非阻断登记（供总控/SA2 知悉，不构成冲突）

1. **N1（保留族词汇登记建议）**：D3 把 `sc<digits>-` 定为内容寻址 ID 保留命名族（族内仅
   canonical `sc1-` 合法）——这是**引擎级新增值域规则**，超出 ADR 0015 字面文本（字面只锁
   「sc1- 前缀触发义务」与「旧式兼容」）。本轮裁决 no-conflict 的根据是：(a) 无决策要求接受
   族内其余形态（未定义空间的设计自由度）；(b) SA6 红灯矩阵（任务验收契约）明文锁死该行为；
   (c) 与冻结 canonical 形状的防仿冒意图同向；(d) 零回归面实证。**建议**：ADR 0015 翻
   accepted 时（或届时经 CONTEXT.md 词条）补一行登记「`sc<digits>-` 为内容寻址 ID 保留命名
   族」，使引擎规则与决策词汇同步（docs/AGENTS.md「update CONTEXT.md when introducing or
   changing a domain term」精神；与 B1 交叉注记同款收官卫生项，移交总控）。SA2 对 D3 的攻击
   评审为优先项（设计 §15 已自登记）。
2. **N2（ENV_7 判定相位结构注记）**：ENV_7 是 envelope 类码但判定点在 parse 成功之后——
   与 ADR 0007 L15 相位序（envelope → dialect → parse → evaluate → internal）的表层张力由
   ADR 0015 L144 自身定义消解（「与 text semantic fingerprint 精确匹配」按 ADR 0007 L17
   必然需要规范 IR）。相位模型是失败类别联合而非「全部 envelope 判定先于 parse」的强制；
   设计取最早可行判定点（parse 后、evaluate 前）且冻结可观察优先级链（§8.5）。记录推导
   备查，无条款违反。
3. **N3（fixture 锚修订为文件 1 验收必要前置）**：设计 §14.1 裁决与路由（Controller 排
   SA6 契约修订轮更名锚 id，一处字符串、零断言语义变化）经本轮核实为任务内必要条件而非
   follow-up；文件 2 与生产实现不受该缺陷影响可先行。总控路由时以此为准。

## 四、事实面锚点抽验汇总

| 设计断言 | 核验方式 | 结果 |
|---|---|---|
| envelope 注册表现为 ENV_1–5/100、readOnly 仅 ENV-4、`ENVELOPE_KEYS` 对 id 只查 typeof | `packages/vfsl/src/envelope.ts` L22-39/L82-87 实读 | 一致 |
| getCompiled 缓存键 = sha256(文本)，id 不参与 | `packages/vfsl/src/index.ts` L260/L266/L278 实读 | 一致 |
| SA6 红灯矩阵含前缀大小写 ×3 与 `sc2-` 拒绝 | 契约测试 L215（「格式版本错误 sc2-」）等实读 | 一致（D3 任务侧依据成立） |
| fixture 锚 `sc1-fixture-anchor` 位于 L91、模块作用域基准 L100-105 | 契约测试实读 | 一致（§14.1 缺陷成立） |
| 全仓生产/domains/既有测试零 `sc<digits>-` 族 id | grep `packages/`、`domains/`：仅 SA6 两契约文件 + 参考件命中 | 一致（零回归面成立） |
| `docs/adr/` 中 sc1-/内容寻址仅 0015 提及；0014「schema id/fingerprint」为 observer 观测字段 | grep `docs/adr/` | 一致（基准面无遗漏） |
| v1-spec 无 ENV 码记载（envelope 注册表 source-resident） | grep `docs/vfsl/` | 一致（B3② 成立） |
| `mysc1-provisional-id`（含 sc1 子串非前缀）走旧式路径 | 触发器 `/^sc[0-9]+-/i` 语义推演 + 契约 L289 负控 | 一致 |

## 结论

**Verdict: `clear`** —— 设计通过设计后冲突复审，无 ADR/CONTEXT 冲突、无条款重开、无
override/evolution/hard-violation；B1/B2/B3 全部满足。设计可进入 SA2 全维度攻击评审
（D3 保留族触发器与 D5 组合序为设计自登记的优先核对项）。本轮不要求设计修订
（`requiresConflictRecheck = false`）；N1 收官登记项与 N3 修订轮路由移交总控。

审查日期：2026-09-08（dispatch `sa-3246a326-11e8-4e4e-b863-fe9b7714177c`，iteration 1，
设计后复审）。

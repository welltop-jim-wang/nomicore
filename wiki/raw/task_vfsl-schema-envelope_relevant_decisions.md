# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_vfsl-schema-envelope.md`（Issue #52：`parseSchemaEnvelope` 信封解析与方言路由，功能开发）
> 冲突基准：`docs/adr/` 全集 5 份（0001–0005，全部 accepted，无 superseded）+ `CONTEXT.md`

## 相关 ADR

### ADR-0001 VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中（accepted；含 2026-08-19 修订节与 2026-08-21 命名修订）

- 与本任务的关联点：信封四键结构、doc 内 `SCHEMA` 键名、方言冻结与未知方言 loud-fail 只读——本任务是这三条决策的运行时兑付（引擎侧接缝）。
- 核心条款（原文摘录）：
  - 「schema 用 VFSL（受限 TypeScript 子集 + 标记类型）+ JSDoc 语义标签描述，以信封 `{ lang, version, id, text }` 作为数据存进 doc 的 `SCHEMA`；解释行为由信封自述的方言版本决定，方言只增不改，未知方言 loud-fail 只读。」
  - 「**本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。**」
  - 修订（2026-08-19）：「本 ADR 的其余条款（无机器标签、方言冻结、编译缓存、演进为运行时管理操作）不变。」
  - 命名修订（2026-08-21，owner 决策）：「信封在 doc 中的键名由 `__schema__` 改为 **`SCHEMA`**——与 `ROOT` 保持统一命名（doc 顶层两个具名条目：`SCHEMA` 信封 + `ROOT` 数据）。信封内部结构 `{lang, version, id, text}` 不变；设计文档（Feishu）中的 `__schema__` 表述以本修订为准。」
  - （对照提示：任务简报「修订（2026-08-21，owner 决策）」节与本命名修订同源同文，二者一致。）

### ADR-0003 求值器与派生 schema——evaluate 接缝、ROOT 根别名约定、联合的分支列表表示（accepted）

- 与本任务的关联点：公共导出接缝纪律（ok-union、可失败、纯函数）；`parseVfsl` 的行列锚定与 E 码错误表归属——本任务透传 `parseVfsl` 并要求信封错误身份与其可区分。
- 核心条款（原文摘录）：
  - 「新增公共导出 `evaluate(module: VfslModule) → { ok: true; derived } | { ok: false; issues }`。派生 schema 延续 IR 全部纪律：纯数据、可 JSON 序列化、可内容哈希、不携带行列位置。可失败是前向兼容设计：调用方从第一天写 ok 检查，将来引入求值期失败模式（如展开资源预算）不构成破坏。PRD #3「唯一公共测试接缝」措辞相应修订为两个公共观察点（`parseVfsl` 与 `evaluate` 的入参/出参）。」
  - 「检查位于 **parseVfsl 语义相位**——E310（缺 ROOT，锚模块起始）/ E311（ROOT 非 map 形，锚 ROOT 类型表达式起点）；行列锚定只有解析层做得到（IR 无行列是内容哈希纪律）。」
  - 「规格修订：§3 新增 ROOT 约定小节、§4 错误表新增 E310/E311（19 → 21 码）、§10 fixture `AssetsDoc` 改名 `ROOT`；」
  - 「evaluate 结果联合的 issues 形状复用 `VfslIssue`」

### ADR-0005 投影生成管线——SchemaSource 接缝、生成器输入契约、生成物入仓（accepted）

- 与本任务的关联点：信封（SchemaEnvelope）形状与方言身份语义、「消费方首动作 = 方言断言」、「id 是标签不是键」——本任务验收条款的直接契约依据。
- 核心条款（原文摘录）：
  - 接缝定义（原文代码块）：

    ```ts
    interface SchemaSource {
      load(id: string): Promise<SchemaEnvelope>;  // { lang, version, id, text }
      list(): Promise<string[]>;                  // CI 枚举全部领域
    }
    ```
  - 「**async 从第一天起**：DocSchemaSource 终态走网络；接缝按终态设计，不按脚手架现状设计；」
  - 「**返回完整信封**而非裸文本：`lang`/`version` 是方言身份；」
  - 「**消费方首动作 = 方言断言**（`lang==='vfsl' && version===1`，否则响亮失败）——方言冻结纪律焊进生成管线；」
  - 「**id 是标签不是键**：引擎正确性不依赖 id 唯一性（自包含设计消灭了注册表）；id 的用途是人读标签、管理端谱系追踪、工具链寻址。信封 id ≠ doc 地址（终态 doc 寻址键是房间名/guid）。」
  - 脚手架文件格式节（阶段态，供信封组装参照）：「行注释是方言 trivia → 整个文件 `parseVfsl` 可直接解析，零预处理、零微格式；」「三键全部必需，缺失或方言不符 → 响亮拒绝（防错冗余：拿错文件 = 当场报错，不是静默按错规则处理）；」「FileSchemaSource 组装信封：`text` = 整个文件原文（含头部），内容哈希直接；」

### ADR-0002 nomicore 是全新 yjs-server 重写，authority 完全出范围（accepted）——登记为不相关

- 本任务不触及 authority 规则体系与 `@invariant` 标签（该标签已随 authority 一并移除），无对照条款需要摘录。

### ADR-0004 vfsl-protocol 类型协议包——编译期路径投影（accepted）——登记为不相关

- 本任务是引擎侧运行时函数，不进协议包；D3「纯类型 + 接口，零运行时」「不进引擎包」的领地边界不受本任务影响。

## CONTEXT.md 相关术语与惯例

- `信封（envelope）`：「`SCHEMA` 键（doc 顶层具名条目，原 `__schema__`——与 ROOT 统一命名）里的 `{ lang, version, id, text }`；单字符串值，原子替换、可哈希、可 diff。」
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」
- `命名空间（namespace）`：「一个 Y.Doc 连同自带的 `SCHEMA` 信封与数据；schema 随数据走，不依赖代码模块。」
- `VFSL`：「受限 TypeScript 子集 + 标记类型构成的 schema 语言；同一段文本既是编译期类型源、又是运行期解释器输入。」
- 用语提示（CONTEXT.md「求值器」条 _Avoid_）：「编译器（compiler）——该词留给『文本 → IR → 派生 schema』的组合入口（Phase 1 contract 包）」——命名新接缝时避免占用「compiler」一词。

---

## 设计引入的新决策点（2026-08-21，Phase 2 设计后复审追加）

> 来源：SA1 设计 `task_vfsl-schema-envelope_design.md`（R1）。以下为设计层冻结点（非 ADR 条款），
> 已通过 SA8 一致性复审（见 `task_vfsl-schema-envelope_design_conflict_report.md`）。
> SA2/SA3/SA4 以设计文档为准；此处仅登记供全链快速回查。

1. **模块布局**：内部件归新模块 `packages/vfsl/src/envelope.ts`（形状校验 + 方言路由转译 + ENV 码构造）；编排函数 `parseSchemaEnvelope` 本体落 `index.ts` 与 `parseVfsl` 同址（避免模块环）。公共面新增恰 2 项：值导出 `parseSchemaEnvelope` + 类型导出 `ParseSchemaEnvelopeResult`；`validateEnvelopeShape` / `dialectIssueOrNull` / `envelopeCrashIssue` / `makeEnvelopeIssue` / `EnvelopeErrCode` 保持模块内部（设计 §2）。
2. **编排顺序即语义**：形状（typeof 门）→ 方言断言（先于文本解析）→ `parseVfsl` 透传；未知方言时 `parseVfsl` 不被调用——「只读 loud-fail、不解释文本」为控制流事实（设计 §5）。
3. **信封层独立错误码空间 `VFSL-ENV-E<码>`**（ENV-1/2/3/4/100），不进 `errors.ts` 方言层 21 码注册表；前缀机械上不匹配 `/^VFSL-E\d+:/`（设计 §6.1）。
4. **坐标哨兵**：信封层 issue 恒 `line: 0, column: 0`；文本层 issue 恒 `line ≥ 1`——与消息前缀构成双正交判别器（设计 §6.2/§6.3）。
5. **形状负例全收集**：缺键归一条 ENV-2 列全 + 类型错归一条 ENV-3 列全（至多 2 条）；「单错误冻结」裁为方言层纪律、不辖信封层（设计 §6.5，SA2 可复议项，预留修订空间）。
6. **形状/方言分界线 = typeof**：`version:'1'`（string）是形状错 ENV-3；`version: 2/NaN/1.5`（number）是方言自述完好但不认识 ENV-4。own-key 判定用 `Object.hasOwn`（原型链来源拒绝）；包装对象按 typeof 'object' 拒（纯数据裁定）（设计 §3.2/§3.3）。
7. **恰四键回显**：形状通过后重建新对象，多余键容忍忽略但不进 `envelope` 返回值（设计 §3.4）。
8. **方言断言复用 `assertVfslDialect` 单点**（schemasource.ts 既有资产），`SchemaSourceError('dialect-mismatch')` 就地转译 ENV-4；schemasource.ts 零改动（DENY LIST）（设计 §4/§12）。
9. **ok:false 为混合通道联合**：信封拒绝与 parseVfsl 文本错误共用 `issues: VfslIssue[]`（形状同构），通道判别靠前缀 + 哨兵而非类型分叉；单次调用永不同时含两通道（编排短路）（设计 §6.4）。
10. **收尾边界**：`packages/vfsl` 版本 0.1.8 → 0.1.9；codegen `collect.ts` 手工流程本票不迁移（未来演进票）；`CONTEXT.md` 公共接缝补录（若需）属收尾票（设计 §12 / §11）。

# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 任务：建立 `@nomicore/doc-runtime` 并实现 `extractYjsSnapshot(derived, doc)`（Issue #73）。
> ADR 基线：`docs/adr/0001`–`0007`（7 篇全读；无 superseded 状态文件，0006 的早期 createDoc 条款已被其文末修订节取代，现行文本有效）。

## 相关 ADR

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted）——本任务直接依据

- 与本任务的关联点：本任务就是实现本 ADR「Yjs bridge 独立为 `@nomicore/doc-runtime`」中的 `extractYjsSnapshot` 能力；其余三入口（materializeRoot / readLogicalValueAtPath / applyValidatedMutation）不在本任务范围。
- 核心条款（原文摘录）：
  - 「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`」
  - 「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META。」
  - 「路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。」
  - 「XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同。」
  - 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。」
  - 「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」
  - 「namespace 创建、打开、读取和更新拥有清晰且可组合的验证链；YArray 与 plain array 的逻辑值相同，但实际 Yjs 载体仍被严格区分。」
  - Runtime 编排边界（背景约束，非本任务实现项）：「NamespaceRuntime 将来按 namespace 串行化所有业务写入……业务调用方不得取得可写 Yjs 引用或绕过该入口」「普通 open 必须依次完成 schema 编译、META 身份检查、ROOT 载体提取和逻辑校验」

### ADR-0003 求值器与派生 schema（accepted）——extract 的结构树依据

- 与本任务的关联点：`extractYjsSnapshot(derived, doc)` 的 `derived` 即本 ADR 定义的派生 schema；ROOT 物化、联合/ref 遍历、XML 终态语义全部来自这里。
- 核心条款（原文摘录）：
  - 根指定：「每个模块必须恰好声明一个名为 `ROOT` 的别名（大小写是契约，`root` / `Root` 不算），且必须 **map 形**（clsOf = map：裸对象 / `YMap` / `Record` / 全 map 形联合）——ROOT 固定物化为 Y.Map，`YArray` / `YXmlFragment` 与标量形一律拒绝。」「Yjs 映射为 `doc.getMap('ROOT')`。」
  - 联合表示：「基础表示：`{ kind: 'union'; members: StructureNode[] }`；匹配语义 **any-of**（至少一个成员接受即接受——重叠成员不构成错误）；路径存在性为**任一成员出现即存在**」
  - 判别式缓存：「缓存的缺失/存在不得改变任何可观测行为（含错误输出）——映射未命中回流同一诊断生成器」
  - 别名引用：「派生 schema 照搬 IR 的模块形状：别名表 + ref 节点 `{ kind: 'ref'; name }`；引用**不内联展开**，解析动作由包内共享解析器完成（复用 shapes.ts 的 clsOf/memo 模式）」
  - 遍历纪律：「结构树/值 schema 节点类型含 `ref` 成员，一切遍历经包内共享解析器（shapes.ts 已有同模式基础设施）」
  - YXmlFragment：「`xml-fragment` 是结构树的**终态节点**：无 children、路径下钻守卫到此为止；JSON 快照中其值为 XML 字符串（与 `Y.XmlFragment.toJSON()` 投影一致），运行时校验仅要求良构 XML。不定义实参字段与 XML 结构的映射——实参字段为文档性质。」

### ADR-0006 Cordis 持久化插件（accepted，含 2026-08-21 修订节）——doc 布局与依赖边界

- 与本任务的关联点：extract 只读 ROOT 的边界依据；Persistence 不得新增 VFSL/doc-runtime 依赖的依据。
- 核心条款（原文摘录）：
  - doc 三条目布局：「Y.Doc ├── SCHEMA 信封（lang, version, id, text）…… ├── META 元信息（Y.Map：docId, createdAt）——我是谁 └── ROOT 数据根——内容本体」
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外（校验只作用 ROOT 子树）。」
  - 「**持久层 = Y.Doc 的存储引擎（store + cache 一体）**，看得见 Y.Doc（结构、update 事件、state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」
  - 「插件实现只依赖 Cordis、Yjs 与持久化 contracts，**不得 import DSH 或 NomicoreServer app**」

### ADR-0005 投影生成管线（accepted）——包位置惯例

- 与本任务的关联点：新 workspace 包 `@nomicore/doc-runtime` 的落位惯例（可复用库 → `packages/`）。
- 核心条款（原文摘录）：
  - 「`packages/` = 可复用库，`apps/` = 可执行体，`domains/` = 业务 schema 包（schema.vfsl + generated.ts + 挂载点 + dogfood 测试）。」
  - （对照参考）生成器包命名形态：「生成器包：`@nomicore/vfsl-codegen`（协议包按 ADR 0004 D3 不含生成器）。」

### ADR-0001 VFSL 单一真相源（accepted，2026-08-19 修订）——仓库纪律

- 与本任务的关联点：行为测试中使用的 schema 文本只能是测试 fixture；loud-fail 精神与错误信息回带语义。
- 核心条款（原文摘录）：
  - 「**本仓库是纯引擎仓库：代码库不含 schema 文本（测试 fixture 除外）。**」
  - 「全部 JSDoc 标签（`@format` / `@role` / `@example` / `@values` / `@unit` / `@since` / `@deprecated` / `@entity` / `@key`）为文档性质，未识别仅 warn；语义层的价值收敛为 AI/人类可读说明与校验错误信息回带语义。」

### ADR-0002 nomicore 重写定位、authority 出范围（accepted）——边界备忘

- 与本任务的关联点：负向边界——本任务不得引入 authority 式不变式校验。
- 核心条款（原文摘录）：
  - 「旧系统既有的 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine）**完全排除在范围外，不保留接口**——统一写入管线收敛为『结构 → 值 → 单事务提交』三步。」

### ADR-0004 vfsl-protocol 类型协议包（accepted）——边界备忘

- 与本任务的关联点：负向边界——`doc-runtime` 是运行时包，不得把运行时逻辑放进协议包；纯类型投影与本任务无关。
- 核心条款（原文摘录）：
  - 「全部内容为类型空间产物……编译后为空模块，零依赖、零运行时代码」「不含生成器（票 F 职责）、不含工厂/默认值、不进引擎包。」

## CONTEXT.md 相关术语与惯例

- `ROOT`：「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的 `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根 `getMap('ROOT')`。其余无人引用的别名是惰性积木，不进数据面。」（_Avoid_: 隐式根、汇点推导）
- `标记类型（marker types）`：「`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`；tsc 视角恒等别名，引擎视角是 Yjs 物化语义标记。」（_Avoid_: `YLEaf`、`yleaf` 等变体拼写——大小写是契约的一部分）
- `结构树（structure tree）`：「Yjs 物化语义（kind / storage / opaque），供路径下钻守卫；与值语义正交。」
- `派生 schema（derived schema）`：「求值器的产出：结构树、值 schema、路径索引的打包；与 IR 同纪律——纯数据、可 JSON 序列化、可内容哈希；别名按名引用（`ref`）保留，不内联展开（ADR-0003 §4）。」
- `逻辑快照校验（validateLogicalSnapshot）`：「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证 Yjs 载体。创建前校验、迁移后体检、测试与管理端点共用该入口。」（_Avoid_: validateSnapshot——容易误解为可校验 live Yjs 文档）
- `判别联合（discriminated union）`：「字面量联合字段（如 `kind`）区分的变体；引擎自动识别判别字段并按变体验证。」
- `封闭对象（closed object）`：「子集内对象类型默认封闭：未声明字段拒绝。」
- `零写入（zero-write）`：「校验失败 → 400 且文档不变；所有写入口走同一条管线。」（extract 为只读操作，天然满足）
- `方言（dialect）`：「`lang + version` 决定的 VFSL 语法子集与语义规格；一经发布冻结，引擎只增不改，未知方言 loud-fail 只读。」

---

## 设计引入的新决策点（SA8 设计后复审追加，2026-08-22）

> 来源：`task_doc-runtime-extract-yjs-snapshot_design.md`（SA1 R1）。以下为**设计层决策**（非 ADR 决议），
> 中性摘录供 SA2 评审 / SA3 实现 / SA4 复核 / SA7 回归复用。SA8 对其与 ADR-0001–0007 + CONTEXT.md
> 的一致性裁决见 `task_doc-runtime-extract-yjs-snapshot_design_conflict_report.md`（verdict: clear）。

- D3（ROOT 缺席语义）：「ROOT 缺席 → `getMap('ROOT')` 惰性空 map，snapshot `{}` / 空字段」——实测零 update 事件（设计 §4.2 / 依据 P4；SA6 冻结契约 F6 锚定「ROOT 缺失按空 map，不外抛」）。
- D4（缺失/未知键）：「缺失字段（required 与 optional 同等）与未知键：**不报、不下钻、不进快照**」——两步分离：缺失/未知键属 validateLogicalSnapshot 逻辑域（设计 D4 / §6 B3–B5）。
- D5（union 试验语义）：「声明序 + 三结局（接受 / 真 issue / 软拒=缺必填字段），首个接受者胜；全拒 → 首个真 issue；全软拒 → 回退成员 0」；判别式「结构树提取永不读取」（INV-4 构造性兑现 ADR-0003 判别式缓存条款）（设计 §4.5）。
- D6（plain 值快照）：「快照 plain 值 = **显式深拷贝 + JSON 值域断言**」——实测 yjs 对 plain 值 `get()` 返回原引用（P15/P15b）；内嵌 Y 类型 / undefined 数组元素 / function / symbol / bigint → 真 issue（设计 §4.6）。
- D7（XML 快照值）：「XML 快照值 = `Y.XmlFragment.toString()`」——实测与 `toJSON()` 投影一致（P6/P6b；对齐 ADR-0003「JSON 快照中其值为 XML 字符串（与 Y.XmlFragment.toJSON() 投影一致）」）（设计 D7）。
- D8（ref 解析自建）：「结构树 ref 解析：包内迭代链走查（`derived.aliases`）+ inFlight 环守卫 + 每调用 memo」——镜像 vfsl `resolve.ts` `walkRefChain` 语义；**不动 vfsl 公共面**（AC1 / DENY `packages/vfsl/**`）（设计 §4.4）。
- D9（崩溃边界，设计自申报偏离）：「崩溃边界：`DOCRT-E100: 内部错误（意外异常）: …`，`expected/actual = 'internal'`（词汇表显式偏离，报 SA4 复核）」——五值词汇表冻结于 SA6 契约 F4（任务层，非 ADR/CONTEXT 条款）；E100 仍为 ExtractIssue 四字段 fail-fast 单 issue 形状（设计 §4.7/§4.8）。
- D10（值域零消费）：「提取器**零消费** `derived.values` / `derived.index` / `derived.aliasDocs` 等值域与文档域」（设计 D10；ADR-0002 authority 出范围同向）。
- D11（无工作预算）：「v1 无显式工作预算，论证 + 登记为已知界」——遍历深度 ≤ `MAX_TYPE_NESTING = 100`（设计 §4.10）。
- INV-1/INV-2（快照纪律）：「ok:true ⇒ snapshot 是纯 JSON 值（`JSON.stringify` 往返全等，零 Yjs 引用）」「与 live doc 完全解耦」（设计 §2）。
- INV-7（名字空间纪律）：「`SCHEMA` / `META` 名字空间零接触」（设计 §2；与 ADR-0006 三条目布局「校验只作用 ROOT 子树」同向）。

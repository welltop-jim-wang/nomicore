# ADR 0007：逻辑验证与 Yjs Runtime Bridge 分层

日期：2026-08-22
状态：已接受（Runtime/open/read 条款由 ADR 0008 部分取代）

## 背景

创建、打开和更新 namespace 时同时涉及两类不同事实：普通 JSON 逻辑值是否符合 VFSL 值语义，以及 live Y.Doc 中 `Y.Map` / `Y.Array` / `Y.XmlFragment` / plain value 的实际载体是否符合派生结构树。现有 `validateSnapshot` 只解释 `DerivedSchema.values`，但名称容易误导为可直接校验 live Yjs 文档；若把两类校验合并，读取、物化、写入和持久化边界都会变得含混。

## 决策

### 逻辑层留在 `@nomicore/vfsl`

- `validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通 JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。
- 新增纯函数 `compileSchemaEnvelope(input: unknown)`：输入必须是严格封闭且恰含 `lang/version/id/text` 的信封；按 envelope、dialect、parse、evaluate、internal 分阶段返回结果联合。
- 编译成功产物包含冻结的 envelope、IR module、DerivedSchema、`envelopeFingerprint` 与 `semanticFingerprint`。
- 指纹使用 SHA-256、UTF-8、canonical JSON 和带版本的 domain separation（`sha256:v1:<hex>`）。envelope fingerprint 覆盖四键；semantic fingerprint 覆盖 `lang + version +` 规范 IR，忽略空白和普通注释，保留 JSDoc、声明顺序及其他 VFSL 语义，并排除谱系标签 `id`。
- module/derived 递归深冻结后才允许未来跨 namespace 共享；本阶段不实现编译缓存，缓存生命周期留给 NamespaceRuntime/Registry。

### Yjs bridge 独立为 `@nomicore/doc-runtime`

`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl + yjs`，提供：

- `extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META。
- `materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行 `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT 为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不 fallback。
- `readLogicalValueAtPath(derived, doc, path)`：本阶段冻结的 schema-aware 读取签名；已由 ADR 0008 取代为 schema-independent `readLogicalValueAtPath(doc, path)`。读取按实际载体同步投影目标子树，不重复 VFSL 编译或校验。
- `applyValidatedMutation(derived, doc, mutation)`：同步完成当前 ROOT 结构/逻辑检查、在普通 JSON 副本中模拟 mutation、完整 ROOT 逻辑校验、目标值的 detached 子树构造和单次 Yjs transaction；普通非空路径 mutation 在 live ROOT 上只修改目标 carrier（`Y.Map.set/delete` 或 `Y.Array.insert/delete`），不重建无关 carrier。只有 `set([])` 走完整 ROOT 清空与重装。不公开可跨时间执行的 prepared mutation，避免 TOCTOU。transaction 返回后重新提取 live ROOT，并与已校验的 proposed logical ROOT 做完整一致性校验；偏离属于已提交 fatal，不回滚、不补偿。

路径统一为 `readonly (string | number)[]`：map/object/Record 使用 string，Y.Array 使用 number；禁止点号字符串与 JSON Pointer。leaf、plain、XML 是不可下钻终态。XML string 与 Y.XmlFragment 只承诺语义等价 round-trip，不承诺字符串逐字相同。

首版 mutation 仅支持 `set`、`delete`、`array-insert`、`array-delete`：

- `set([])` 允许整体替换 ROOT；旧 Yjs 子类型引用失效，不做 identity-preserving diff。
- set 不自动创建中间容器；最终目标可为已有字段、缺失 optional 字段或新 Record 键。
- delete 禁止 ROOT、required 字段和数组下标；只允许 optional 字段与 Record 动态键。
- array insert/delete 使用严格非负整数边界，不 clamp、不接受空 insert、count=0 或越界 no-op。
- 当前 ROOT 已损坏时普通 mutation 失败，不承担 recovery。
- 成功只返回 `{ ok:true }`，不返回 snapshot、Yjs update 或内部类型。

### Runtime 编排边界

NamespaceRuntime 将来按 namespace 串行化所有业务写入：轮到 mutation 时先检查 writable gate，同步调用 `applyValidatedMutation`，成功后立即调用 persistence `saveDoc` 标脏。业务调用方不得取得可写 Yjs 引用或绕过该入口；未来原始 Yjs update 必须另设受控验证通道。

本阶段原定普通 open 依次完成 schema 编译、META 身份检查、ROOT 载体提取和逻辑校验后才注册 Runtime；该 open/read 编排已由 ADR 0008 取代：Runtime 信任有效 DocHandle，发布前仅把 schema preparation P0 放入单一 write sequencer，发布后立即开放 schema-independent read，写入仍负责建立并维持完整不变量。

底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry 再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast。

### ADR 0008 取代范围

ADR 0008 取代本文 schema-aware `readLogicalValueAtPath(derived, doc, path)` 以及“普通 open 完成 schema 编译、META 检查、ROOT 提取和 logical validation 后才注册 Runtime”的 Runtime/open/read 条款。本文关于 logical validation、detached materialization、validated mutation、零写入与 observer no-rollback 的底层决策继续有效。

## 失败边界

零写入承诺覆盖所有验证失败和 detached 构造失败。Yjs observer 不得向事务调用栈抛异常；Runtime 自有 observer 必须记录或异步上报。事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback。

## 后果

- namespace 创建、打开、读取和更新拥有清晰且可组合的验证链；YArray 与 plain array 的逻辑值相同，但实际 Yjs 载体仍被严格区分。
- 普通读取成本与目标 path 子树规模相关。validated mutation 为正确性继续执行完整 ROOT 提取与逻辑校验，因此其校验 CPU/内存成本仍与 ROOT 规模相关；提交阶段只修改目标 carrier，使 owned Yjs update 与实际变更规模相关，而不再随完整 ROOT 放大。继续优化完整校验成本时必须保留行为等价测试。
- Persistence 仍只管理 Y.Doc 存储、cache、flush 与 retry；VFSL 仍是纯逻辑引擎；Server/NamespaceRuntime 负责组合二者。

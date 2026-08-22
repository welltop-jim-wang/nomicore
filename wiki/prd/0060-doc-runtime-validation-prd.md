# PRD：Namespace Doc Runtime 验证与 Yjs Bridge 前置能力

状态：待实现
日期：2026-08-22
设计依据：ADR 0007

## 目标

在实现 NamespaceRuntime 与 NamespaceRegistry 前，补齐 schema 编译、逻辑值校验、Yjs 载体验证、JSON↔Yjs 物化、按路径读取和统一 mutation 六项基础能力。完成后，namespace create/open/update 能维持以下不变量：

1. schema 信封结构、方言、语法与派生语义均有效；
2. live Y.Doc 的 ROOT 载体与 DerivedSchema.structure 一致；
3. ROOT 逻辑值与 DerivedSchema.values 一致；
4. 所有业务更新都在验证通过后才进入单次 Yjs transaction；
5. 普通读取不重复验证，只按 path 提取目标子树；
6. VFSL、doc runtime 和 persistence 三层依赖方向清晰，无语义反向污染。

## 非目标

- NamespaceRuntime / NamespaceRegistry 实现；
- REST、WS、presence 或原始 Yjs update 协议；
- SchemaCompileCache、LRU、容量与 Host dispose；
- schema migration/recovery 管理通道；
- persistence、WAL 或文件布局变更；
- mutation 的 move、merge、increment、compare-and-set、XML 增量编辑和批量事务。

## 公共能力

### 1. `validateLogicalSnapshot`

现有 `validateSnapshot` 直接更名，不保留 alias。所有源码、测试、文档、导出和调用方一次性迁移；行为、issues、资源预算和零写入纯函数契约保持不变。JSDoc 明确输入是普通 JSON logical ROOT snapshot，不接受 live Yjs 类型。

### 2. `compileSchemaEnvelope`

```ts
compileSchemaEnvelope(input: unknown): CompileSchemaEnvelopeResult
```

- 输入严格封闭且恰有 `lang/version/id/text` 四键；字段缺失、多余、类型错误均在 envelope stage fail-fast。
- 方言未知在 dialect stage fail-fast。
- parse/evaluate 沿用原生 issues 数组；canonical encode/hash/deep-freeze 等不变量失败归 internal 单 issue。
- 成功产物含冻结 envelope、IR module、DerivedSchema、envelopeFingerprint、semanticFingerprint。
- SHA-256 + UTF-8 + canonical JSON；格式为 `sha256:v1:<lowercase hex>`。
- 不引入模块级缓存或 Host 生命周期状态。

### 3. `extractYjsSnapshot`

位于新包 `@nomicore/doc-runtime`：

```ts
extractYjsSnapshot(derived, doc): ExtractYjsSnapshotResult
```

- 固定读取 ROOT；不读取 SCHEMA/META。
- structure root/map/array/xml-fragment/leaf/plain/union/ref 均有确定遍历语义。
- Y.Array 与 plain Array、Y.Map 与 plain object 必须严格区分。
- 首个结构不匹配立即返回单 issue，path 精确到错误节点；错误节点不继续下钻。
- 成功返回与 live doc 解耦的普通 logical ROOT snapshot。
- XML 提取保证语义等价与可再次通过逻辑验证，不承诺逐字序列化相同。

### 4. `materializeRoot`

```ts
materializeRoot(derived, snapshot, doc): MaterializeRootResult
```

- 唯一公共物化入口，内部强制先运行 `validateLogicalSnapshot`。
- 目标 ROOT 必须为空；非空响亮失败，不 overwrite/merge/fallback。
- 对 plain JSON 深复制；按 structure tree 构造 detached Y.Map/Y.Array/Y.XmlFragment 等。
- detached 构造全部成功后，单次 transaction 安装到目标 ROOT。
- logical 失败返回完整 issues；materialization 失败返回单 issue；两者均保证目标 doc 零写入。
- observer 抛错不纳入虚假回滚承诺，按 ADR 的 internal/fatal 边界处理。

### 5. `readLogicalValueAtPath`

```ts
readLogicalValueAtPath(derived, doc, path): ReadLogicalValueResult
```

- 同步 API；不执行 I/O，不重复结构/逻辑验证。
- path 为 `readonly (string | number)[]`；空 path 明确读取整个 ROOT。
- 只转换目标子树，返回与 live doc 解耦的普通值副本；不返回 Yjs 类型。
- schema 不允许的路径返回 `PATH_NOT_ALLOWED`。
- 合法 optional/Record 缺键和非负整数数组越界返回 `ok:true, value:undefined`。
- 负数、非整数或字符串数组下标非法。
- leaf/plain/XML 均不可下钻；plain 数组不支持元素级读取。

### 6. `applyValidatedMutation`

```ts
applyValidatedMutation(derived, doc, mutation): ApplyValidatedMutationResult
```

- 同步完成，内部不得 await；不依赖 persistence。
- 每次先 `extractYjsSnapshot` 并用 `validateLogicalSnapshot` 确认当前 ROOT 完整合法；损坏数据不能用普通 mutation 顺便修复。
- 在普通 JSON 副本中模拟 mutation，对拟议完整 ROOT 执行 `validateLogicalSnapshot`。
- 新值所需 Yjs 子树先 detached 构造，成功后才以一次 transaction 提交。
- 支持 set/delete/array-insert/array-delete；严格遵循 ADR 0007 的路径、缺失、ROOT 替换和数组边界语义。
- 成功只返回 `{ok:true}`；structure/path/operation/materialization 单 issue，logical 保留完整 issues。

## 依赖与交付切片

1. **直接更名逻辑快照验证器**（refactor）——无 blocker。
2. **严格编译 schema 信封与双指纹**（feature）——blocked by 1。
3. **建立 doc-runtime 并实现 Yjs ROOT 提取**（feature）——blocked by 1。
4. **实现验证后安全物化 ROOT**（feature）——blocked by 1、3。
5. **实现同步按路径逻辑读取**（feature）——blocked by 3。
6. **实现统一 validated mutation**（feature）——blocked by 3、4、5。

第 2、3 项在第 1 项后可并行；第 6 项为最终 tracer bullet，打通 open/update 所需的完整数据平面能力。

## 总体验收

- 所有新增公共函数有行为测试而非源码 grep 伪锚点；
- Y.Array/plain Array、Y.Map/plain object、XML、Record、union、ref、optional、ROOT 空路径和特殊字符路径均覆盖正反例；
- 验证或 detached 构造失败前后 Y.Doc state/update 不变；
- 全量测试、typecheck 和 Node 20/24 CI 通过；
- 新 workspace package 被根 typecheck 与 CI 显式覆盖；
- `@nomicore/vfsl` 不新增 yjs 依赖；`@nomicore/persistence` 不新增 VFSL/doc-runtime 依赖；
- 不提交 `.mabf-bg/**`、`TASK.md` 或运行日志。

## 后续讨论

本 PRD 完成后继续设计 NamespaceRuntime/NamespaceRegistry：create/open 合流、长期 persistence DocHandle、NamespaceHandle lease、active/idle/eviction、按 path read 包装、每 namespace 串行写队列、writable gate、DocScope 与编译缓存生命周期。

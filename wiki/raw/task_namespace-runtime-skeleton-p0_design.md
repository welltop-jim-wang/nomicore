# 设计文档 — @nomicore/namespace-runtime：Runtime 骨架、同步读取与队首 P0（issue #89）

- 任务类型：feature（功能开发）
- 修订史：R1 初版 → **R2 修订（落实 SA2 reject 评审 `task_namespace-runtime-skeleton-p0_sa2_review.md` 全部 7 个攻击点：#1/#2 CRITICAL、#3/#4 MEDIUM 阻断项逐条落实，#5/#6/#7 非阻断建议一并采纳；差异段标注「R2 修订」；文件范围零变化，SA6 冻结测试零触碰；逐条回应表见「SA2 反馈逐条回应」节）**
- 契约基准：ADR-0008（全集条款）+ ADR-0006/0007（继续有效条款）+ SA6 冻结契约（三测试文件）
- 前置交付：#86 `readLogicalValueAtPath(doc, path)`（已合入 2d805e9）、#87 `DocRuntimeFatalError` committed-aware 契约（已合入 1543ab3）
- 设计产出：本文件。SA3 按此实现 `packages/namespace-runtime/src/**`；SA2 评审攻击面即本文件。

---

## §0. 任务定位与交付边界

本任务交付 ADR-0008 的**显式子集**：Runtime 骨架（独占 DocHandle + 封闭公共面）、同步读取面（read / getSchemaEnvelope / getMetadata / getActiveSchema / getStatus）、队首 P0 schema preparation（真实 write sequencer 节点）。

**延后项（后续 issue，本设计只留扩展位、不写死形状、不写死相悖行为）**：

| 延后项 | 本任务的态度 |
|---|---|
| `mutateRoot` / `replaceSchema` 两类真实写 | sequencer 骨架提供通用 FIFO 槽执行器（§4 D6），写槽七步顺序（lifecycle/fatal gate → `getStatus()` 写门 → 输入快照 → 领域校验/detached 构造 → 一次 transaction → `await notifyDirty()` → 释放）以文档形式预留挂接点；不实现、不预写空壳枚举 |
| close barrier | 不实现 `close()`；`lifecycle` 恒 `'ready'`（类型上仅声明 `'ready'` 字面量，未来加 `'closing'/'closed'` 属新公共面版本）；sequencer 尾部 barrier 挂接点预留（D6） |
| 完整 status 投影 | 本任务 status 面已是**结构化**形状（lifecycle/read/rootWrite/schemaWrite/schema/fatal），非扁平枚举、无队列内部字段——与完整投影形状前向兼容（SA8 边界注记 1） |
| Registry / 生产构造器出口 | 生产工厂 `createNamespaceRuntime` 保留包内（src 内部函数），**不从 index 导出**（AC1 测试锁定其缺席） |

**禁止事项（SA8 冲突门禁边界注记 2/3）**：不引入绕过 sequencer 的写旁路；不以公共事件订阅替代包内 seam；src 运行时代码不内置任何 schema 文本（ADR-0001「仓库不含 schema 文本（测试 fixture 除外）」——SA6 测试内的 `TEXT_VALID`/`TEXT_BAD` 属测试豁免，src 中不得出现）。

---

## §1. 契约来源与现状盘点

### 1.1 ADR-0008 条款 → 本设计消费映射

| ADR-0008 条款（摘） | 本设计落点 |
|---|---|
| 「Runtime 获得并信任有效 DocHandle 后，在对外发布前把 P0 放入 write sequencer 队首，同时立即开放同步读取；读取不等待 P0 或任何写任务，也不进入 sequencer」 | D6（入队先于 return + microtask 起步）、D3（读取面零 sequencer 交互） |
| 「`readLogicalValueAtPath(doc, path)` …（schema-independent 载体投影）」 | D3 纯透传（#86 已交付，零包装） |
| 「`getSchemaEnvelope()` 从顶层 SCHEMA Y.Map 投影 lang/version/id/text 四键，忽略额外键，不 coercion 或补默认值」 | D4 投影 + 值域守卫（null 三分支 + live 引用零出站，R2 修订） |
| 「`getMetadata()` 深拷贝顶层 META Y.Map 的全部键；值只允许 JSON-compatible plain value，不允许嵌套 Yjs shared type」 | D5 深拷贝 + 载体/值域双 loud throw（R2 修订） |
| 「`getActiveSchema()` 返回 …lang/version/id 与 envelope/semantic fingerprints，不暴露 module、derived 或 validator」 | D8 五字段身份投影 + 内部 tools 保留 |
| 「P0 只读取 SCHEMA 标准四键、调用 compileSchemaEnvelope 并构造 schema-dependent tools，不读取、提取或验证 ROOT」 | D7 槽体（唯一触碰 `doc.share.get('SCHEMA')` 的路径与公共投影同源单点） |
| 「P0 结算后出队，只保留 preparing / ready 与 active schema tools / unavailable 与稳定 schema issue 摘要」 | D7 + 状态机表（§4 D7.4） |
| 「正常 compile result failure 仅使 ROOT write unavailable；SCHEMA write 仍可修复。P0 抛出结果联合之外的 internal exception 则永久关闭该 Runtime 的所有写」 | D7 失败分级 + D9 能力位公式 |
| 「persistence-degraded …不阻止 read 或不写 Y.Doc 的 P0」 | D1 构造门接受 degraded；D6 P0 槽无写门；D9 写位瞬时观察 |
| 「Runtime 成功构造后独占一个 DocHandle；构造失败时所有权仍归调用方。Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META live 引用或生产构造器」 | D1（同步校验先行、失败零副作用）+ D2（七键闭包对象） |
| 「Runtime 提供结构化瞬时 capability status …status 不暴露队列长度、任务类型或 sequence」 | D9（无 queue/sequence/taskType 键、无数组值字段） |
| 「Runtime 公开冻结的 owner.userId 与 namespaceId 身份投影」 | D1/D2（`Object.freeze({ userId })`） |
| 「测试通过包内确定性 seam 注入可控 P0、dirty notifier、handle 与 fault」 | D8'（seam 形状冻结；dirty notifier 注入随写面后续 issue 扩展为 seam 可选字段——非破坏性增广） |

### 1.2 前置交付消费面（已核实源码）

- `@nomicore/doc-runtime` 公共导出：`readLogicalValueAtPath`、`ReadLogicalValueResult`（`packages/doc-runtime/src/index.ts:11-12`）；结果联合 `{ ok:true; value } | { ok:false; code:'PATH_NOT_ALLOWED'; path; message? }`（`read.ts:43-45`）。**同步、不抛错**（顶层 E100 收编，`read.ts:127-133`）。
- `@nomicore/vfsl` 公共导出：`compileSchemaEnvelope(input: unknown): CompileSchemaEnvelopeResult`（`index.ts:303-347`）——严格封闭门（ENV-1/2/3 坍缩单条 → ENV-5 多余键 → ENV-4 方言）→ parse → evaluate → 双指纹 → 递归深冻结五件套；**顶层崩溃边界 ENV-100，绝不外抛**；`SchemaEnvelope = { lang: string; version: number; id: string; text: string }`（`schemasource.ts`，注意 **version 是 number**）。
- `@nomicore/persistence` 公共导出：`DocHandle`（`owner/docId/doc/getStatus()/release()`）、`DocHandleStatus = 'ready'|'persistence-degraded'|'released'|'disposed'`、`User`、`createMemoryPersistence`（`contract.ts:13-30`、`index.ts:9-14`）。
- #87 `DocRuntimeFatalError`：**本任务 P0 不产生 Yjs transaction**，P0 internal fault 不经 DocRuntimeFatalError（该 branded fatal 服务写事务管线，后续写面消费）；P0 fatal 走 namespace-runtime 自有稳定摘要（D7.3）。

### 1.3 SA6 冻结契约归纳（三测试文件的可观测锚点，SA3 只可补充不可收窄）

| 锚点 | 出处（测试断言） |
|---|---|
| `entry.createNamespaceRuntime === undefined`；`entry.createNamespaceRuntimeWithSeam` 为 function | public-surface:84-88 |
| seam 同步返回（不 await）；`owner.userId`、`Object.isFrozen(owner)`、`namespaceId === handle.docId` | public-surface:90-98 |
| `runtime` 上 `doc/handle/docHandle/yDoc/sequencer/persistence` 五键 `in` 全 false（own+原型链） | public-surface:100-115 |
| released handle 构造 `toThrow`；失败后 handle 状态原样、doc 可读、同 entry 可重新 load 并构造成功 | public-surface:117-132 |
| `getStatus()`：对象非数组；`lifecycle === 'ready'`；read/rootWrite/schemaWrite 三槽为 `{enabled:boolean}`；schema.state ∈ 三态；keys 不含 queue/sequence/taskType；无数组值字段；ready 后 `read.enabled true`、`fatal null` | public-surface:134-162 |
| 五方法返回值均非 Promise | public-surface:164-177 |
| p0Gate 未 resolve：构造后同步 `schema.state === 'preparing'`、五个读取面立即可用且值正确、`getActiveSchema() null`；25ms 后仍 preparing；resolve 后转 ready | sync-read-face:84-107 |
| `getSchemaEnvelope()` toEqual 四键 fixture；额外键（含 null 值键）不出现；有额外键时真实编译仍 ready | sync-read-face:109-129 |
| `getMetadata()` toEqual fixture；突变/删除返回副本不影响重读 | sync-read-face:131-146 |
| `read(['nope'])` → `{ok:true, value:undefined}`；`read(['n',0])` → `{ok:false, code:'PATH_NOT_ALLOWED'}` | sync-read-face:148-161 |
| 构造后同步 preparing；poll 到 ready；active 五字段与 `compileSchemaEnvelope` 同信封产物逐字节一致；module/derived/validator 三键 undefined | p0-sequencer:87-119 |
| 注入 compile 收到的信封 toEqual 恰四键投影；注入返回 ok:false → unavailable | p0-sequencer:121-136 |
| ROOT 为 Y.Text 仍 ready；`read([])` → `PATH_NOT_ALLOWED` | p0-sequencer:138-149 |
| ROOT 内容违反 schema 仍 ready；违规值原样读出 | p0-sequencer:151-161 |
| TEXT_BAD 真实编译失败 → unavailable + issue{code,message} 非空字符串、无 stack/cause、摘要稳定；rootWrite false / schemaWrite true / fatal null / activeSchema null；读取保留 | p0-sequencer:163-193 |
| 注入 compile throw → 构造不抛；fatal{code,message} 非空、message 不含原始哨兵文本、无 stack/cause；rootWrite/schemaWrite 永久 false；读取保留；schema.state 仍在三态集合 | p0-sequencer:195-235 |
| 结算后 state 收敛稳定（5 次采样恒 ready） | p0-sequencer:237-252 |

---

## §2. 需求推演（Feature）：不变量清单

切入点的唯一性判断：本任务是**新建包**，与既有代码的接缝全部是「只读消费既有公共导出」（doc-runtime read / vfsl compile / persistence DocHandle 类型）。不存在对既有包任何文件的修改（唯一例外：根 `package.json` 的 typecheck 脚本追加，见 §7.2）。因此设计风险不在回归面，而在**新包自身的行为正确性 + 时间线正确性 + 公共面封闭性**。

不变量（SA4/SA7 验收时可逐条对照）：

- **INV-N1（发布前入队）**：`createNamespaceRuntimeWithSeam` 返回前，P0 已是 sequencer 队列唯一节点（pending）；构造调用栈内 P0 槽体零执行。
- **INV-N2（读取不等待）**：五个读取方法自构造返回瞬间起同步可用；它们不 await、不查询、不阻塞于 sequencer/P0 任何状态。
- **INV-N3（P0 三读纪律）**：P0 全程只读 `SCHEMA` 条目四标准键；不触碰 `ROOT`/`META`；不写 doc、不发事件、不调用 notifyDirty（P0 是零 Y.Doc 写任务）。
- **INV-N4（失败所有权不转移）**：构造 throw 路径零副作用——不入队、不在任何位置存储 handle、不触碰 doc；调用方 handle/doc/持久层条目原样。
- **INV-N5（公共面封闭）**：runtime 对象 own 与原型链上只有七键（owner/namespaceId/read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus）；handle/Y.Doc/sequencer/state 只存在于闭包。
- **INV-N6（状态机封闭）**：`schema.state` 只取 `preparing|ready|unavailable`；一旦离开 preparing 终态锁定（ready/unavailable 不再迁移）；fatal 一经置位永久为真。
- **INV-N7（摘要稳定性）**：`schema.issue` 与 `fatal` 是冻结的 `{code,message}` 纯字符串对——不含原始 Error 对象、stack、cause、SCHEMA 全文、ROOT 数据；同一 Runtime 重复采样值恒等。
- **INV-N8（双指纹同源）**：active schema 身份的 `envelopeFingerprint/semanticFingerprint` 直接取自 compile 产物引用，不经重组/重算。
- **INV-N9（写位瞬时观察）**：rootWrite/schemaWrite 的 enabled 是调用瞬时的推导：`!fatal &&（rootWrite 另需 schema.state!=='unavailable'）&& handle.getStatus()==='ready'`。
- **INV-N10（透传零包装）**：`read(path)` 返回值与 `readLogicalValueAtPath(handle.doc, path)` 逐字节同源（同一函数调用结果直通）。
- **INV-N11（无队列泄漏）**：getStatus 产物无 queue/sequence/taskType 键、无数组值字段。
- **INV-N12（零 unhandled rejection）**：P0 任务 promise 永不 reject（槽体全 catch → 结构化状态迁移）；sequencer 链以 noop 吞前项 reject（为后续写任务保留 FIFO 不断裂语义）。
- **INV-N13（公共读取面零 live Yjs 引用）【R2 修订，SA2 #1】**：read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus 的任何返回值（含嵌套）不含 live writable Yjs 引用（`Y.AbstractType` 实例或持有它的容器）——SCHEMA 四键持有非 primitive 值时 `getSchemaEnvelope()` loud throw（`NSRT-SCHEMA-E1`）而非带出；P0 送入 compile 的信封同样不含 live 引用（违规键省略，由 compile 严格门报缺键）。
- **INV-N14（seam 输入单读 + env 一次成型）【R2 修订，SA2 #4】**：seam 输入对象的每个字段在构造栈内**只读取一次**（V1 校验读取后立即捕获为局部常量），P0 的 env 对象在构造栈内一次成型；入队 thunk 是纯调用（`() => runP0(env)`），零属性读取、零求值面——flaky getter 无法在入队后影响 runtime。

---

## §3. 包结构与模块职责

```
packages/namespace-runtime/
├── package.json          # SA6 已登记（deps: doc-runtime/persistence/vfsl/yjs）——本任务不改
├── tsconfig.json         # 新建（SA3）：include 仅 src/**（§7.1 实测依据）
├── test/                 # SA6 冻结三测试文件——本任务不改
└── src/
    ├── index.ts          # 公共入口：类型导出 + createNamespaceRuntimeWithSeam（@internal）
    ├── runtime.ts        # Runtime 状态 + 公共面七键闭包对象构造 + 生产工厂（包内不导出）
    ├── sequencer.ts      # 写序列器 FIFO 骨架（promise-chain；写槽/close-barrier 扩展位）
    ├── p0.ts             # P0 槽体（gate → 四键投影 → compile → 安装/分级失败）
    ├── projection.ts     # SCHEMA 四键投影（双模式 + 值域守卫，R2 修订）+ META 深拷贝
    │                     # （载体/值域双 loud，R2 修订）
    ├── status.ts         # getStatus 组装（writableNow 瞬时观察）
    └── errors.ts         # 构造错误 / SCHEMA 投影守卫错误 / META 违规错误 / 稳定 code 注册表
```

模块合并自由度：status.ts/errors.ts 可并入 runtime.ts/projection.ts（SA3 自由度，保持职责注释完整即可）；index.ts 的导出形状**不可**收窄（AC1 锚定）。

---

## §4. 核心设计决策

### D1 构造：同步校验、失败零副作用、所有权转移时机（AC1）

`createNamespaceRuntimeWithSeam(input)` 全同步，序：

```
V1 形状守卫（loud TypeError，任何不满足即 throw，此时零副作用）：
   - input.handle 为对象且 getStatus 为 function（防御 seam 调用方传残缺 handle）
   - handle.owner 为对象且 owner.userId 为 string；handle.docId 为 string；
     handle.doc 为对象【R2 修订，SA2 #3：原设计「不深验其余成员」导致残缺 handle
     （如 { getStatus: () => 'ready' }）的 throw 滞后到 owner/docId 解引用点——
     R1 §5 伪代码中该解引用晚于 P0 入队，违反 INV-N4。V1 增补三项类型校验 +
     §5 伪代码重排（owner/docId 捕获提前到入队前）双保险，任何 throw 均在入队前】
   - input.p0Gate 若提供必须是 thenable（Promise）；input.compile 若提供必须是 function
V2 状态门：s = handle.getStatus()
   - 'ready' | 'persistence-degraded' → 放行（读与 P0 不受 degraded 影响，ADR-0008 明文）
   - 'released' | 'disposed' → throw NamespaceRuntimeConstructionError
     （code 'HANDLE_NOT_USABLE'，message 含观测状态值；类不导出，稳定 message 供诊断）
   - 其它未知值 → 同 throw（DocHandleStatus 词表冻结于 ADR-0006；未知值 = adapter 契约
     违背，loud 而非猜测降级）
V3（通过后）所有权实际转移，序内全部求值完成于入队之前【R2 修订，SA2 #3】：
   a. 身份与载体一次捕获：userId = handle.owner.userId；docId = handle.docId；
      doc = handle.doc（三者均为 V1 已验类型的最后一读——此后不再触碰 handle 的这三成员）
   b. seam 输入一次读取并捕获局部：p0Gate = input.p0Gate；compile = input.compile ??
      compileSchemaEnvelope【R2 修订，SA2 #4：单读纪律——V1 校验读取 + 此处捕获即闭包，
      thunk/槽体不再读 input.*，flaky getter 无二次读取面】
   c. state 初始化（schema.state='preparing'）；env 一次成型 = { doc, state, p0Gate, compile }
   d. P0 入队（D6）：enqueue(() => runP0(env)) —— thunk 纯调用，零求值面
   e. 构造并返回 runtime 七键对象（owner = freeze({ userId })，namespaceId = docId）
```

关键点：**所有权转移的判定时点是 V2 放行**。V1/V2 的任何 throw 都发生在入队与任何 doc 触碰之前——INV-N4 由「校验全部前置 + 身份捕获前置（V3a）」结构性保证，无需补偿逻辑。测试锚点 public-surface:117-132（released 后 throw；handle 状态原样；doc 可读；同 entry reload 成功构造）。【R2 修订，SA2 #3 红灯形态：残缺 handle 构造 throw 后注入 compile 计数器必须为零——P0 从未触碰 doc。】

owner 投影：`Object.freeze({ userId })`（userId 为 V3a 捕获的局部量，不再二次解引用 handle）——只投影 userId（ADR-0008「公开冻结的 owner.userId」）；`namespaceId = docId`（V3a 捕获，string 原始值，天然不可变）。

外部 release 后的行为（v1 边界，显式记录）：runtime 独占的是构造时取得的那份租约；调用方越过 runtime 直接 `handle.release()` 属调用方违约（租约已独占移交）。后果仅体现为 D9 的写位瞬时观察转 false；读取面继续观察 live Y.Doc 引用（不崩、不静默换源）。生命周期位不因外部 release 改变（`close()` 属后续 issue，届时引入真正的生命周期迁移）。

### D2 公共面：七键闭包对象 + freeze（AC2）

Runtime 用**对象字面量 + 闭包**构造（非 class 实例）：

- 原型链是 `Object.prototype`——`'doc' in runtime`、`'sequencer' in runtime` 等在 own 与原型链任一层均 false（测试 public-surface:112-114 用 `in` 检查，class 私有字段/方法也安全，但字面量+闭包最简且把 handle/state 完全收进闭包作用域，无 `#private` 反射面）。
- `Object.freeze(runtime)`：公共面发布后不可增删键（防属性注入；未来 `close()` 是新公共面版本，由新构造函数产出新形状对象，不受当前 freeze 约束）。
- 七键恰好：`owner`、`namespaceId`、`read`、`getSchemaEnvelope`、`getMetadata`、`getActiveSchema`、`getStatus`。
- 生产工厂 `createNamespaceRuntime(handle)`：包内函数（runtime.ts 内，v1 为 seam 默认参数薄壳），**index.ts 不 re-export**——AC1 锁定 `entry.createNamespaceRuntime === undefined`。

### D3 `read(path)`：纯透传（AC3 / INV-N10）

```
read: (path) => readLogicalValueAtPath(handle.doc, path)
```

零包装、零前置检查、零结果改写。live Y.Doc 引用在构造时经 `handle.doc` 捕获一次（ADR-0006：同一 entry 的所有 handle 共享同一 live 实例，引用稳定）。缺键 `ok:true undefined`、Y.Map 数字段 `PATH_NOT_ALLOWED` 等语义全部继承 #86 交付（测试 sync-read-face:148-161 逐字对应）。读取面不做 schema 重校验（ADR-0008「读取不重复校验」；测试 p0-sequencer:151-161 违规值原样读出）。

### D4 `getSchemaEnvelope()`：四标准键投影 + 值域守卫（AC4）【R2 修订】

返回类型 `SchemaEnvelope | null`，三分支；③ 含**值域守卫（R2 修订，SA2 #1 CRITICAL）**：

```
projectSchemaEnvelope(doc, mode: 'public' | 'p0'):
  ① 载体缺席：doc.share.has('SCHEMA') === false → null（两模式同）
     （不惰性 getMap——缺席时连惰性空 map 都不创建，零副作用；share 为 yjs 公开
      typed 属性，Doc.d.ts:44；实测见 §12 #3）
  ② 载体异型：doc.getMap('SCHEMA') throw（同名 Y.Text 等，实测 §12 #2）→ null
     （两模式同；SCHEMA 缺席/异型经 createDoc 合法可达——persistence 只校验 META.docId，
      §12 #14——故 null 是可观测的合法缺席信号而非 bug 掩盖，与 META 的 D5 处置相对）
  ③ Y.Map 存在 → 四键投影（含值域守卫，R2 修订）：
     out = {}
     for k of ['lang','version','id','text']:        # 固定四标准键，唯一键集
        v = sc.get(k)
        if (v === undefined) continue                # 键缺席/显式 undefined → 键省略
        if ((typeof v === 'object' && v !== null)     # 覆盖一切 Y.AbstractType/类实例/
            || typeof v === 'function'                # 函数/symbol——live 引用与可执行体
            || typeof v === 'symbol'):
             mode 'public' → throw SchemaProjectionError（code 'NSRT-SCHEMA-E1'，
                             message 含键名与观测 typeof，不含值内容——INV-N13：公共
                             读取面绝不带出 live writable Yjs 引用，调用方无从绕过
                             sequencer 改写 doc）
             mode 'p0'     → continue（违规键省略：live 引用绝不进入 compile 输入——
                             SA2 红灯形态「注入 compile 收到的信封 JSON.stringify 可
                             序列化」；缺键由 compile 严格门 ENV-2 收编报「信封缺少
                             必需键」，数据级失败 → unavailable，SCHEMA write 可修复）
        out[k] = v                                    # primitive 值（string/number/boolean/
                                                      # null/bigint）原样带出——类型错由
                                                      # compile ENV-3 收编，不在本层收窄
     return out                                       # 额外键结构性不出现（不枚举全 keys）
```

设计要点：

- **【R2 修订，SA2 #1】值域守卫三分层**：(a) **非 primitive 值**（`typeof v === 'object' && v !== null`、function、symbol——覆盖一切 `Y.AbstractType`，实测可存可读，§12 #13）是**安全边界**：公共面 loud throw（`SchemaProjectionError`，errors.ts 注册，与 `MetaProjectionError` 同级），P0 面键省略——两模式都绝不把 live writable Yjs 引用交出去。ADR-0008 L91 明文「Runtime 不公开 handle、Y.Doc、**ROOT/SCHEMA/META live 引用**或生产构造器」；无守卫时 `sc.set('version', new Y.Map())` 经 `getSchemaEnvelope().version` 直接把可写 doc 引用交给调用方，单序列器模型被公共读取面击穿。(b) **primitive 值类型错**（version 存 string 等）是**数据质量问题**：原样带出，验证权单源在 `compileSchemaEnvelope` 严格门（ENV-3 收编）——ADR-0008「不 coercion 或补默认值」的直接语义；SA2 红灯形态亦反向锁定此分支「不 throw、原样带出（防修订过度收窄）」。(c) **键缺席** → 省略（ENV-2 收编）。
- **投影器不是验证器，但必须是安全器**（R2 修订后的精确表述）：验证决策点单源在 compile 严格门；投影器只承担一条不可下放的纪律——live 引用零出站（INV-N13）。类型声明 `SchemaEnvelope` 描述合规 doc（契约域）下的形状；primitive 类型错的投影是显式记录的行为（§10 R2），调用方需要有效性判定时看 `status.schema.state`，不看本投影。
- **键省略而非补默认**：四键任一缺席（或 P0 模式下违规省略）即从投影中省略（不写 `undefined` 值键——`toEqual` 与键枚举测试都要求干净四键形状）。
- **双模式同源单点**：P0 与公共面共用 `projectSchemaEnvelope`（mode 参数区分出站纪律），SCHEMA 读取/键集/缺席语义不可能分叉；测试 p0-sequencer:121-136 注入 compile 收到的信封恰四键（fixture 全 primitive，两模式行为相同）。**P0 对违规 SCHEMA 的分级是 unavailable 而非 fatal**：毒化 SCHEMA 是 out-of-contract 数据（类比被外部程序改坏的持久化文件），非 runtime 自身 bug；「P0 抛出结果联合之外的 internal exception → fatal」不适用于守卫的确定性省略路径——省略后 compile 照常返回结果联合，正常失败通道（unavailable，SCHEMA write 可修复）才是对调用方可修复性的正确答案。
- version 是 number（vfsl 契约）；fixture 以 number 存入（`sc.set('version', 1)`），投影原样带出。
- **冻结测试零影响**：三 fixture 的 SCHEMA 四键全 primitive、无缺席——值域守卫分支不可达；`toEqual(ENVELOPE_FIXTURE)` 与键集断言逐字保持。

### D5 `getMetadata()`：全键深拷贝 + 载体/值域双 loud（AC4）【R2 修订】

返回类型 `Record<string, unknown>`【R2 修订，SA2 #2：删除 nullable——载体异常不再是合法返回值】；Y.Map 存在 → 逐键深拷贝；**载体缺席/异型 → loud throw（`MetaProjectionError`，code `NSRT-META-E2`）**：

```
projectMetadata(doc):
  ① 载体缺席（doc.share.has('META') === false）
       → throw MetaProjectionError('NSRT-META-E2',
           'META 条目缺席：经 createDoc/loadDoc 生产路径不可达（两者均强制 META.docId
            匹配校验，缺席 doc 直接被拒）；仅 seedForTest 测试设施可造——生产 handle 上
            出现即上游 bug，拒绝静默 null')
  ② 载体异型（doc.getMap('META') throw，同名 Y.Text 等）
       → throw MetaProjectionError('NSRT-META-E2'，message 含观测到的载体异常信息)
       （异型同样过不了 createDoc 的 getMap('META').get('docId') 校验——生产不可达）
  ③ Y.Map 存在 → 逐键深拷贝（copyMetaValue，值域违规 → NSRT-META-E1 loud throw）
```

**【R2 修订，SA2 #2】为什么 META 载体异常是 loud 而 SCHEMA 载体缺席是 null——不对称的可达性依据**（同一条判据，两种可达性结论）：

- **META 载体在生产路径必然存在且为 Y.Map**：persistence `createDoc` 与 loadDoc 恢复路径都强制 `doc.getMap('META').get('docId') === docId`（`lifecycle.ts:385-391` validateCreateDoc、`lifecycle.ts:396-403` restoreAndValidate；共享套件 `testing.ts:493-500` 锁定「Missing META entirely is also a mismatch」）。META 缺席或异型都在校验处直接被拒——**生产可达的 doc 恒有健康 META**；唯一例外是 `seedForTest`（`lifecycle.ts:229-246`，测试设施）。按 2026-05-07 立法判据「功能完备系统里该条件应恒真吗？YES → 不是降级场景，是 bug」：R1 的静默 null 让调用方拿到语义不可区分的 null（无 META？数据撕裂？持久层 bug？），且 status 面无任何 META 可观测字段——**静默失败通道，虚假降级立法命中**。R2 改为 loud throw。
- **SCHEMA 载体缺席经生产路径合法可达**：`validateCreateDoc` 只校验 META.docId，**完全不触碰 SCHEMA**（`lifecycle.ts:385-391`；共享套件 `testing.ts:502-507`「Permissive: correct docId, no SCHEMA, no ROOT」显式锁定宽容）。无 SCHEMA 的 namespace 是合法数据形态（P0 → ENV-1 → unavailable 可观测）——null 是合法缺席信号，非降级。

**深拷贝必要性是实测事实不是防御姿态**：yjs 以 ContentAny 存储平面值，`get` 返回**同一对象引用**，突变返回值会污染存储内容（§12 #1④ 实测：`arr.push('MUTATED')` 直接改掉存储）。测试 sync-read-face:139-145 正是锚定此点。

值域纪律（ADR-0008「值只允许 JSON-compatible plain value，不允许嵌套 Yjs shared type」）——违规时**抛 `MetaProjectionError`（loud），绝不静默跳键**：

```
copyMetaValue(v, keyPath):
  null | string | boolean        → 直通
  number                         → Number.isFinite(v) ? v : throw（NaN/±Inf 非 JSON 值）
  bigint | undefined | function | symbol → throw
  Y.AbstractType 实例            → throw（嵌套 Yjs shared type；显式 new Y.Map() 可存进
                                    Y.Map，实测 §12 #1⑤）
  Array                          → 逐元素递归（稀疏空洞/在界 undefined → throw，位置语义
                                    与 doc-runtime read.ts D4 同款：不可省略）
  plain object                   → 原型链判据（Object.prototype/null 链尾；Date/类实例 →
                                    throw）+ own enumerable data property 递归
```

判定理由（拒绝虚假降级立法，R1 已立、R2 补齐一致性）：META 由受控创建路径保证 JSON 值域（createDoc 套件锁定 META.docId 校验；v1 无 META 写）。功能完备系统里本条件恒真 → 违规是上游 bug → loud throw（code `NSRT-META-E1`，message 含键路径与违规 typeof），**不设计静默降级/跳键**。【R2 修订，SA2 #2：R1 对「值域违规 loud」与「载体异常静默 null」用了同一条论证链却得出相反处置——R2 把载体缺席/异型并入同一 loud 纪律（`NSRT-META-E2`），一个哲学、一种标准；两个 code 并列注册于 errors.ts。】

### D6 写序列器骨架：promise-chain FIFO + P0 真实队首（AC5/AC8/INV-N1/N12）

```
// sequencer.ts —— 通用 FIFO 槽执行器（唯一排序机构）
class WriteSequencer {
  private tail: Promise<void> = Promise.resolve();

  /** 入队：前项 settle（含 reject）后本项才开始执行；返回值即本项完成信号。 */
  enqueue(run: () => Promise<void>): Promise<void> {
    const settled = this.tail.then(run, run);      // 前项失败不阻断 FIFO（后续写按 ADR-0008
                                                   // 仍取得槽——扩展位语义与此一致）
    this.tail = settled.then(noop, noop);          // 链尾恒绿：队列永不因单项失败断裂
    return settled;
  }
  /** 只供未来 close barrier 挂接的队尾观察（v1 内部持有，不导出）。 */
}
```

P0 入队与「绝不构造栈内结算」的机制根源：

- 入队即 `tail.then(runP0, runP0)`。**ECMAScript 规范语义：`.then` 回调永远作为微任务（PromiseJobs）执行，绝不在 enqueue 调用栈内同步运行**（§12 #5）。因此无需手动 `setTimeout`/`queueMicrotask`，构造栈内 P0 槽体零执行是规范级保证，不是时序巧合。
- **【R2 修订，SA2 #4】入队 thunk 是纯调用**：`enqueue(() => runP0(env))`——env 已在构造栈内一次成型（D1 V3c），thunk 内零属性读取、零对象字面量构造、零求值面。R1 形态 `enqueue(() => runP0({ doc, state, p0Gate: input.p0Gate, compile: input.compile ?? … }))` 的 env 字面量在 thunk 内求值且二次读取 seam 输入——flaky getter（首读过 V1、次读 throw，SA2 实测复现）会让 thunk 同步 throw、reject 被链尾接线吞掉、P0 **永久卡死 preparing 零诊断**（活性洞）。R2 把全部求值前置到构造栈（INV-N14），thunk 只剩函数调用与实参传递，**不存在可抛点**——INV-N12 的「槽体全 catch」覆盖从此是结构事实而非愿望。
- 构造序（INV-N1）：`state 初始化 → env 一次成型 → sequencer.enqueue(() => runP0(env)) → 返回 runtime`。在 return 与首个微任务之间不存在任何可观测窗口使 P0 已执行——同步调用 `getStatus()` 必见 `'preparing'`（测试 p0-sequencer:92、sync-read-face:90 构造后同步断言）。
- P0 pending 于 `await p0Gate` 时：队列头挂起、读取面完全自由（INV-N2，读取不进 sequencer）。25ms 宏任务窗口后仍 preparing（sync-read-face:99-101）；`gate.resolve()` → 微任务续体 → compile → 终态迁移 → `expect.poll` 捕获。
- 死锁面审计：P0 若被同步执行，`await p0Gate`（未 resolve）会挂死构造栈（SA6 测试注释所述可观测死锁）——本设计的微任务起步使该路径不存在。P0 无 timeout、无取消（与 close「无条件排空」纪律前向一致）。

扩展位（SA8 边界注记 2，只文档不预写代码）：真实写任务 = `enqueue(七步槽体)`——槽内顺序 lifecycle/fatal gate → `handle.getStatus()==='ready'` 写门 → 输入快照（受控 snapshotter）→ 领域校验/detached 构造 → 一次 `doc.transact` → `await notifyDirty()` → 槽释放（即 promise resolve，下一项自动开始）；close barrier = `enqueue(release 槽)`。`enqueue` 的「前项 settle 后项方启」+「返回完成信号」两个性质恰好是这两个挂接点需要的全部。

### D7 P0 槽体：投影 → compile → 安装；失败三级分级（AC5/AC6/AC7）

```
// p0.ts —— runP0 整体包在 try/catch（INV-N12：永不向 sequencer 抛出）
async function runP0(env): Promise<void> {
  try {
    // ① [扩展位：lifecycle/fatal gate]——P0 是队首首个任务，构造门已验 handle，
    //    v1 无前置 fatal 可能；真实写槽将在此步检查 lifecycle/fatal（文档位）
    // ② [扩展位：写门]——P0 零 Y.Doc 写，不受 persistence-degraded 阻止（ADR-0008 明文）；
    //    构造接受的 degraded handle 上 P0 照常执行
    if (env.p0Gate !== undefined) await env.p0Gate;   // 编译前可控门（reject → ⑦ fatal）
    // ③ 四键投影（与公共 getSchemaEnvelope 同源单点，D4 双模式；唯一触碰 SCHEMA 的路径）
    //    【R2 修订，SA2 #1】mode 'p0'：违规（非 primitive）键省略——live 引用绝不进入
    //    compile 输入（信封恒 JSON.stringify 可序列化，SA2 红灯形态）；缺键由 ENV-2 收编
    const projection = projectSchemaEnvelope(env.doc, 'p0');   // SchemaEnvelope 形状 | null
    // ④ compile（env.compile 已在构造栈捕获为局部函数引用——不再读 seam 输入，SA2 #4）
    const result = env.compile(projection as SchemaEnvelope);
       // 原始投影直入——校验权单源在 compile 严格门：null → ENV-1（实际收到 null）、
       // 缺键 → ENV-2、错型 → ENV-3，全部结构化 ok:false，绝非异常。
       // `as` 收窄是记录「投影是原始数据，验证不在此层」的类型层声明。
    if (result.ok) {
       // ⑤ 最小形状守卫（防注入 seam 返回畸形 ok:true——结果联合之外的值按 internal
       //    fault 分级，loud）：envelope/module/derived 与双指纹存在且类型正确，否则 ⑦
       installActive(result);        // state='ready'；activeInfo=五字段冻结身份（D8）；
                                     // activeTools=module/derived 内部保留（不暴露）
    } else {
       // ⑥ 正常 compile failure → unavailable（结果联合内的失败，非 fatal）
       if (result.issues.length === 0) → ⑦            // ok:false 且零 issue = 结果联合外的
                                                      // 契约违背（vfsl 各失败阶段恒产出 ≥1 条，
                                                      // §1.2 源码佐证）→ internal fault，loud
       state.schema = 'unavailable'
       state.schemaIssue = freeze(首条 issue → {code, message})   // D7.4 派生规则
    }
    // 结算即出队：promise settle，任务节点随链推进消失（无残留任务记录）
  } catch (err) {
    // ⑦ internal fault → fatal（permanent）
    state.fatal = freeze({ code: 'NSRT-FATAL-P0-INTERNAL',
                           message: 'P0 schema preparation internal fault：编译通道产生结果联合之外的异常；'
                                  + '本 Runtime 全部写已永久关闭，读取保留。' })
    state.fatalCause = err      // 【R2 修订，SA2 #6】包内诊断锚点：闭包 state 私有字段，
                                // 不出现在任何公共面（INV-N5/N7 不变）——供未来观测面
                                // issue（日志/metrics/trace）与调试器消费；排障不再只有复现一途
    // 恒定文案：不插值原始异常（测试锁定 message 不含哨兵文本 BOOM，p0-sequencer:217）；
    // schema.state 保持 'preparing'（P0 未结算成 ready/unavailable——仍在三态集合内，
    // 测试 p0-sequencer:224 只要求 ∈ 三态）
    // 原始 err 不进任何公共投影（INV-N7）；公共可观测性属后续观测面 issue（§10 R4：
    // 已登记为该 issue 的显式验收点——fatalCause 必须被消费/上报，不得长期沉默）
  }
}
```

D7.4 unavailable issue 摘要派生规则（首条 issue，稳定映射）：

| compile 失败首条 issue | `schema.issue.code` | `schema.issue.message` |
|---|---|---|
| `{kind:'envelope', issue:{code, message}}` | `'SCHEMA_ENVELOPE_' + String(issue.code)`【R2 修订，SA2 #5：code 作不透明段透传——R1 的 `'E' + code` 拼接假设数字串，seam 注入任意字符串时产出 `SCHEMA_ENVELOPE_EENV_TEST` 类语义漂移串；现分隔符语义明确：前缀 + 原样段。vfsl 闭集码读作 `SCHEMA_ENVELOPE_5`/`SCHEMA_ENVELOPE_100`；注入 `ENV_TEST` 读作 `SCHEMA_ENVELOPE_ENV_TEST`——**运行时不校验码域**（测试注入必须能流过），分类意义仅对 vfsl 闭集码成立（注记）】 | `issue.message` 原文（vfsl 冻结前缀 `VFSL-ENV-E<码>:` 已自带分类；单行 sanitizer 由 vfsl 构造点保证） |
| `{kind:'vfsl', issue:{message, line, column}}` | `'SCHEMA_TEXT_INVALID'` | `issue.message` 原文（含行列诊断；不含 SCHEMA 全文——vfsl parse 错误只引局部片段，满足 INV-N7） |

摘要一经结算冻结，后续 `getStatus()` 返回值恒等（测试 p0-sequencer:192 `toEqual` 稳定性）。

D7.5 状态机（INV-N6）：

```
                 ┌──────────────────────────────┐
  构造返回 ──► preparing ──compile ok──► ready（终态，active tools 已安装）
                 │   │
                 │   └─compile ok:false──► unavailable（终态，issue 摘要已冻结；
                 │                           rootWrite 关 / schemaWrite 可修复）
                 └─internal fault──► fatal 置位（schema.state 停留 preparing；
                                       全部写位永久 false；读取面不动）
```

ready/unavailable 互斥且不可逆（本任务无 SCHEMA write，不存在 unavailable→ready 修复路径——那是 replaceSchema 后续 issue 的槽内迁移）。

### D8 active schema：五字段身份投影 + 内部 tools 保留（AC5 / INV-N8）

```
activeInfo = Object.freeze({
  lang:      compiled.envelope.lang,        // 三身份字段取自 compile 产物的 envelope
  version:   compiled.envelope.version,
  id:        compiled.envelope.id,
  envelopeFingerprint: compiled.envelopeFingerprint,   // 直接引用，零重算——
  semanticFingerprint: compiled.semanticFingerprint,   // 「与 compileSchemaEnvelope 产物
})                                                     //  逐字节一致」的结构性保证
activeTools = { module: compiled.module, derived: compiled.derived }  // 内部保留（后续
                                                       // ROOT write 消费）；不出现在任何公共面
```

- 五键恰好（测试 p0-sequencer:116-118 锁定 module/derived/validator 三键 undefined）。
- `getActiveSchema()`：preparing/unavailable/fatal 期返回 `null`；ready 期返回 activeInfo（每次调用可返回同一冻结引用或同值副本——值相等恒成立）。

### D9 `getStatus()`：结构化瞬时能力投影（AC3/AC7 / INV-N9/N11）

```
getStatus(): NamespaceRuntimeStatus   // 每次调用构造全新对象（无共享可变引用）
{
  lifecycle: 'ready',                          // v1 子集恒 ready（close 属后续；类型仅声明此字面量）
  read:      { enabled: true },                // v1：成功构造后读取恒可用（close 将来才 gate）
  rootWrite: { enabled: !fatal && schema.state !== 'unavailable' && writableNow() },
  schemaWrite:{ enabled: !fatal && writableNow() },   // unavailable 后仍可修复（ADR-0008）
  schema:    { state, ...(issue 仅在 unavailable 时存在) },   // exactOptionalPropertyTypes：无 issue
                                                              // 键，不写 undefined 值键
  fatal:     fatalSummary | null,
}
// writableNow() = handle.getStatus() === 'ready'   // 瞬时观察（ADR-0008「gate 是瞬时观察」）：
//   persistence-degraded → 写位 false（degraded 阻止全部 Y.Doc 写），读不受影响
//   released/disposed（外部违约 release）→ 写位 false；handle.getStatus() 自身 throw 则
//   原样传播（adapter bug，loud——本方法契约同五方法：sync，可抛错于 internal bug）
```

- preparing 期 rootWrite.enabled = true（handle ready 时）：**这是忠实语义**——ADR-0008「早期写排在 P0 后」，即 preparing 期写是可接纳的（排队等待），不是不可用。本任务无写方法，位值仅是能力真话。
- 键集恰好六键；无 queue/sequence/taskType；无数组值字段（INV-N11，测试逐项断言）。
- `fatal === null` 在正常路径（preparing/ready/unavailable 均 null——fatal 只来自 internal fault）。

### D8' testing seam（AC8）

```ts
/** @internal 包内确定性测试接缝（沿 vfsl getCompiledWith 先例，index 导出 + @internal 标注） */
export interface NamespaceRuntimeSeamInput {
  readonly handle: DocHandle;
  readonly p0Gate?: Promise<void>;          // P0 编译前 await 的可控门（resolve 控制）
  readonly compile?: (envelope: SchemaEnvelope) => CompileSchemaEnvelopeResult;
                                            // 抛错 = internal fault 注入；缺省 compileSchemaEnvelope
                                            // （后续写面 issue 将增补可选 notifyDirty 字段——
                                            //  可选字段增广，非破坏）
}
export function createNamespaceRuntimeWithSeam(input: NamespaceRuntimeSeamInput): NamespaceRuntime;
```

seam 是**唯一导出构造路径**（生产工厂包内不导出）。注意：注入 compile 的运行时返回值不被码域校验（测试注入 `ENV_TEST`/缺 `readOnly` 的字面量——TS 层面该字面量与 vfsl 类型不符（§7.1 实测），运行时按不透明结构消费，恰好锚定「issue.code 是任意字符串」的宽容契约）。

---

## §5. 关键伪代码（SA3 实现蓝本）

```ts
// runtime.ts —— 构造与公共面（示意；模块划分见 §3）【R2 修订，SA2 #3/#4：身份捕获与 env
// 成型全部前置到入队之前；seam 输入单读纪律落地——除 V1/断言的一次校验读取外，后续只用局部量】
export function createNamespaceRuntimeWithSeam(input: NamespaceRuntimeSeamInput): NamespaceRuntime {
  // V1 形状守卫（D1，含 owner.userId/docId/doc 三项类型校验）——任何 throw 此处均零副作用
  assertSeamInputShape(input);                       // errors.ts：TypeError / NamespaceRuntimeConstructionError
  const handle = input.handle;
  const status0 = handle.getStatus();                // V2 状态门
  if (status0 !== 'ready' && status0 !== 'persistence-degraded') {
    throw new NamespaceRuntimeConstructionError(
      `HANDLE_NOT_USABLE: DocHandle 状态 ${status0} 不可构造（接受 ready/persistence-degraded）`);
  }
  // V3a 身份与载体一次捕获（SA2 #3：全部解引用完成于入队之前——残缺 handle 的任何 throw
  //     都发生在 enqueue 前，INV-N4 结构成立；此后不再触碰 handle 的这三成员）
  const userId = handle.owner.userId;
  const docId = handle.docId;
  const doc = handle.doc;                            // live Y.Doc 引用捕获一次（ADR-0006 同实例）
  // V3b seam 输入一次读取并捕获局部（SA2 #4：单读纪律——这是 input.p0Gate/input.compile
  //     的最后一次求值；V1 形状校验的读取之外无二次读取面）
  const p0Gate = input.p0Gate;
  const compile = input.compile ?? compileSchemaEnvelope;

  // 运行态（闭包私有；唯一可变源）
  const state: {
    schemaState: 'preparing' | 'ready' | 'unavailable';
    schemaIssue?: Readonly<{ code: string; message: string }>;
    activeInfo?: Readonly<ActiveSchemaInfo>;
    activeTools?: { module: VfslModule; derived: DerivedSchema };   // 内部，永不导出
    fatal?: Readonly<{ code: string; message: string }>;
    fatalCause?: unknown;                            // 【R2 修订，SA2 #6】包内诊断锚点（不进公共面）
  } = { schemaState: 'preparing' };

  // V3c env 一次成型（SA2 #4：thunk 内零求值——env 是纯数据闭包，不含任何 input.* 引用）
  const env = { doc, state, p0Gate, compile };

  // V3d sequencer + P0 入队（INV-N1：return 前 P0 已是队首 pending 节点；微任务起步；
  //     thunk = 纯调用 () => runP0(env)，无属性读取/无字面量构造/无可抛点）
  const sequencer = new WriteSequencer();
  void sequencer.enqueue(() => runP0(env));

  // V3e 公共面（SA2 #3：owner/namespaceId 由 V3a 捕获的局部量构造，不再解引用 handle）
  const owner = Object.freeze({ userId });
  const runtime: NamespaceRuntime = {
    owner,
    namespaceId: docId,
    read: (path) => readLogicalValueAtPath(doc, path),          // D3 纯透传
    getSchemaEnvelope: () => projectSchemaEnvelope(doc, 'public'),  // D4（null 三分支 + 值域守卫 loud）
    getMetadata: () => projectMetadata(doc),                    // D5（深拷贝 / 载体与值域双 loud）
    getActiveSchema: () => state.activeInfo ?? null,            // D8
    getStatus: () => buildStatus(handle, state),                // D9（handle 仅用于 writableNow 瞬时观察）
  };
  return Object.freeze(runtime);
}
```

```ts
// p0.ts（槽体全貌见 §4 D7；此处补 installActive 与形状守卫）
function installActive(compiled: CompileSchemaEnvelopeOk, state): void {
  const info = Object.freeze({
    lang: compiled.envelope.lang, version: compiled.envelope.version, id: compiled.envelope.id,
    envelopeFingerprint: compiled.envelopeFingerprint, semanticFingerprint: compiled.semanticFingerprint,
  });
  state.activeInfo = info;
  state.activeTools = { module: compiled.module, derived: compiled.derived };
  state.schemaState = 'ready';
}
function assertCompiledShape(c: CompileSchemaEnvelopeOk): void {   // D7 ⑤ 最小守卫：
  // lang:string / version:number / id:string / 双指纹:string / module/derived 为对象
  // ——任一不满足按 internal fault 走 ⑦（结果联合外的畸形返回，loud 分级）
}
```

```ts
// status.ts
function buildStatus(handle: DocHandle, state): NamespaceRuntimeStatus {
  const writableNow = handle.getStatus() === 'ready';    // 瞬时观察（throw 原样传播）
  const fatal = state.fatal ?? null;
  return {
    lifecycle: 'ready',
    read: { enabled: true },
    rootWrite: { enabled: fatal === null && state.schemaState !== 'unavailable' && writableNow },
    schemaWrite: { enabled: fatal === null && writableNow },
    schema: state.schemaState === 'unavailable' && state.schemaIssue
      ? { state: state.schemaState, issue: state.schemaIssue }
      : { state: state.schemaState },
    fatal,
  };
}
```

---

## §6. 边界条件、并发与时序分析

### 6.1 时间线（AC8 关键场景逐 tick）

| 时刻 | 事件 | 可观测状态 |
|---|---|---|
| T0 | 构造栈：V1/V2 校验 → state preparing → enqueue(P0)（then 回调入微任务队列）→ return runtime | 同步 `getStatus().schema.state === 'preparing'`；五个读取面立即可用且值正确；`getActiveSchema() null` |
| T0+µ₁ | P0 槽开始：`await p0Gate`（未 resolve → 挂起，队列头 pending） | 任意宏任务窗口（测试 25ms）后仍 preparing；读取面照常 |
| T1 | `gate.resolve()` → 微任务续体：投影 → compile → 迁移 | poll 捕获 ready（或 unavailable/fatal） |
| T2+ | 终态锁定 | 5 次采样恒 ready（p0-sequencer:244-251） |

### 6.2 边界条件清单

| # | 条件 | 行为 | 依据 |
|---|---|---|---|
| 1 | `p0Gate` 是 rejected promise | `await` 抛 → catch ⑦ → fatal（seam 注入物异常属 internal fault 域） | D7 |
| 2 | 注入 `compile` throw（任意 thrown 值，含非 Error） | catch ⑦ → fatal；恒定文案不含原始文本；构造与调用方零裸异常 | D7（测试 195-235） |
| 3 | compile 返回 `ok:false` 且 `issues` 为空数组 | fatal（结果联合外状态：vfsl 各失败阶段恒 ≥1 条；空 = 契约违背，loud） | D7 ⑥ |
| 4 | 注入 compile 返回畸形 `ok:true`（缺指纹等） | 最小形状守卫失败 → fatal | D7 ⑤ |
| 5 | SCHEMA 条目缺席（share 无键） | 投影 null → compile(null) → ENV-1「实际收到 null」→ unavailable（**不是 fatal**——数据级失败；生产路径合法可达，§12 #14） | D4/D7 |
| 6 | SCHEMA 为 Y.Text 等异型载体 | 投影 null（getMap throw 收编）→ 同 #5 → unavailable | D4（实测 §12 #2） |
| 7 | 四键部分缺席/**primitive 类型错**（version 存 string 等） | 部分投影原样入 compile → ENV-2/ENV-3 → unavailable；`getSchemaEnvelope` 返回部分投影（原始投影语义，§10 R2）——**不 throw**（SA2 红灯反向锁定） | D4 |
| 8 | SCHEMA 含额外键（任意值，含 null） | 投影键集结构性恰四键；编译照常（严格门只看四键） | D4（测试 109-136） |
| 9 | ROOT 为 Y.Text / 内容违反 schema | P0 零接触 ROOT → 照常 ready；read 按载体纪律 `PATH_NOT_ALLOWED` / 违规值原样读出 | INV-N3（测试 138-161） |
| 10 | META **值**含嵌套 Yjs/非有限数/非 plain 对象/undefined 值键 | `getMetadata` 抛 `MetaProjectionError`（`NSRT-META-E1`，loud；绝不跳键、绝不静默 `{}`） | D5 |
| 11 | handle 外部 release（违约） | 写位瞬时观察转 false；读取面继续（live doc 引用未失效）；lifecycle 不变 | D1/D9 |
| 12 | 构造后 handle 状态 degraded | 写位 false、读 true、P0 不受影响（可能已 ready） | D9（ADR-0008 明文） |
| 13 | `handle.getStatus()` 在 getStatus() 内 throw | 原样传播（adapter bug，loud；五方法契约：sync，internal bug 可抛） | D9 |
| 14 | 读取面在 P0 compile 执行期间被并发调用 | 纯读无共享可变态（投影器零 memo/零订阅），无干扰 | D4/D5 |
| 15 | 两个 Runtime 同 handle（seam 调用方违约） | 不检测、不防御——独占性是租约移交契约（v1 无 Registry；ADR-0006 lease 模型），测试纪律下不出现 | D1 |
| 16 | unhandled rejection | 不存在：P0 槽体全 catch；sequencer 链尾 noop 吞前项 reject；`void enqueue(...)` 的返回 promise 永不 reject | INV-N12 |
| 17 | 【R2 修订，SA2 #1】SCHEMA 四标准键持**非 primitive 值**（`new Y.Map()`/类实例/function/symbol） | 公共面：`getSchemaEnvelope()` 抛 `SchemaProjectionError`（`NSRT-SCHEMA-E1`，含键名+typeof，不含值）——live 引用零出站（INV-N13）；P0 面：违规键省略 → compile 收 JSON 可序列化信封 → ENV-2 缺键 → **unavailable**（SCHEMA write 可修复，非 fatal——毒化 SCHEMA 是 out-of-contract 数据）；其余四个读取面不受影响 | D4 值域守卫（实测 §12 #13） |
| 18 | 【R2 修订，SA2 #2】META 载体缺席或异型（Y.Text 同名） | `getMetadata()` 抛 `MetaProjectionError`（`NSRT-META-E2`，含观测载体形态）——生产路径不可达（createDoc/loadDoc 强制 META.docId 校验，`lifecycle.ts:385-403`），仅 `seedForTest` 测试设施可造；其余四个读取面照常（loud 无横向副作用） | D5（源码 §12 #14） |
| 19 | 【R2 修订，SA2 #4】seam 输入带 flaky getter（首读过 V1、后续读取 throw） | 入队后零影响：V3a/V3b 单读捕获后，thunk/槽体/公共面不再触碰 `input.*`（INV-N14）——getter 的任何后续行为对 runtime 不可观测；不存在「P0 卡死 preparing 零诊断」路径 | D1 单读纪律/D6 纯调用 thunk |
| 20 | 【R2 修订，SA2 #3】残缺 handle（如 `{ getStatus: () => 'ready' }`，缺 owner/docId/doc） | V1 三项类型校验 throw（零副作用、未入队）；即便实现漏检，V3a 解引用也前置于 enqueue——任何 throw 都在入队前，P0 微任务不可能启动 | D1 V1/V3a |

### 6.3 数据一致性

- 读取只观察调用瞬间已提交的 live Y.Doc（readLogicalValueAtPath 语义继承）；P0 与读取互不写任何共享可变态（state 仅 P0 终态迁移单点写入，JS 单线程内无竞态窗口；读取方法只读 state 的 activeInfo/无写）。
- `getMetadata`/`getSchemaEnvelope` 每次调用产出全新对象/深拷贝，调用方突变不污染 runtime 内部与后续读数（测试 131-146 锚定）。

---

## §7. 构建集成与类型纪律

### 7.1 tsconfig include 决策（实测依据，关键）

**决策：`packages/namespace-runtime/tsconfig.json` 为 `{ "extends": "../../tsconfig.base.json", "include": ["src/**/*.ts"] }`——不含 `test/**`，偏离六包惯例。**

依据链（全部实测/源码锚定，详见 §12）：

1. 六个既有包 tsconfig 均 `include: ["src/**/*.ts", "test/**/*.ts"]`（惯例源）。
2. SA6 冻结测试 `runtime-p0-sequencer.test.ts:125` 注入 `issue: { code: 'ENV_TEST', message: 'seam rejection' }` 且缺 `readOnly` 字段——与 vfsl `SchemaEnvelopeIssue`（`code: SchemaEnvelopeIssueCode` = `'1'|'2'|'3'|'4'|'5'|'100'` 闭集 + `readOnly: boolean` 必填，envelope.ts:23-39）**类型不符**。
3. 设计期 tsc 实测（命令与输出见 §12 #9）：`error TS2322: Type '"ENV_TEST"' is not assignable to type 'SchemaEnvelopeIssueCode'`——include test/** 则 `tsc -p` 必红。**【R2 修订，SA2 #7：排除论证】该 TS2322 位于测试文件自身的返回类型注解（`injectedCompile` 的 `: CompileSchemaEnvelopeResult` 注解下的返回字面量），与 namespace-runtime 的 seam 参数类型无关——放宽 seam 类型（甚至把 compile 入参改成 `unknown`）救不了测试文件内部的类型错误；SA2 已独立复核同结论。故「调整 seam 类型以保全 test/** include」不是可选路径，include 收窄是唯一解。**
4. 测试文件是 SA6 冻结验收锚（本任务任何 SA 不得改）；vitest 对 `.test.ts` 不做类型检查（vitest.config.ts typecheck.include 仅 `*.test-d.ts`），运行期按不透明结构消费注入物恰好是 seam 的宽容契约。
5. 故唯一同时满足「测试冻结不改 + `pnpm typecheck` 绿」的方案是 include 收窄为 src/**。

**回归路径（登记于 §10 R1）**：若未来 SA6 测试字面量改入码域（或 vfsl 开放 code 域——与 21 码冻结注册表相悖，不建议），恢复 `test/**` include。

### 7.2 根 typecheck 脚本（必要的单行修改）

根 `package.json:13` 的 `typecheck` 逐包枚举六包。新包不在列则其 src **无任何类型检查覆盖**（vitest 经 esbuild 转译零类型检查）——静默类型空洞。故 ALLOW 修改根 `package.json`：

```
"typecheck": "… && tsc -p packages/doc-runtime/tsconfig.json && tsc -p packages/namespace-runtime/tsconfig.json"
```

### 7.3 依赖与 lockfile 核对（零改动验证）

`packages/namespace-runtime/package.json`（SA6 登记）已含全部所需依赖：`@nomicore/doc-runtime`（read/ReadLogicalValueResult）、`@nomicore/persistence`（DocHandle/User/DocHandleStatus 类型 + 测试 MemoryPersistence）、`@nomicore/vfsl`（compileSchemaEnvelope/SchemaEnvelope/CompileSchemaEnvelopeResult/VfslModule/DerivedSchema）、`yjs`（Y.AbstractType/Doc/Map 载体判别）。pnpm-lock.yaml importer 已由 SA6 登记——**无新依赖、lock 零改动**。

### 7.4 测试收集与 CI

- vitest include `packages/*/test/**/*.test.ts` 通配命中新包三测试文件，零配置改动。
- CI（.github/workflows/ci.yml）：Node 20/24 矩阵跑 `pnpm typecheck` + `pnpm test`——7.2 落地后新包自动入 CI；CI 其余步骤（persistence-contract / domains-scaffold / materialize-root / regen-diff）与本章无关，零改动。

---

## §8. 全局兼容与影响评估

| 面 | 影响 |
|---|---|
| 既有六包源码/测试 | **零改动**（全链只读消费公共导出；红灯证据：全量基线 1002 用例零回归） |
| pnpm-lock.yaml | 零改动（importer 已由 SA6 登记） |
| 根 package.json | 仅 typecheck 脚本追加一段（§7.2，非函数契约） |
| vitest.config.ts / tsconfig*.json（根）/ CI workflow | 零改动（通配已覆盖，§7.4） |
| ADR 一致性 | 无推翻：实现 ADR-0008 显式子集；延后项按 ADR 原条款预留扩展位（SA8 冲突门禁 verdict clear） |
| 架构一致性 | 新包边界与 ADR-0008「组合 doc-runtime/vfsl/Persistence 窄接缝；不承担 Registry/鉴权/REST/WS/Persistence 实现/原始 Yjs 同步」逐字一致；校验决策点单源复用 vfsl 严格门（envelope.ts 单点哲学同源）；载体探针沿 doc-runtime carrier.ts 先例 |

---

## §9. 验收标准映射

| AC | 设计条目 | 测试锚（SA6 文件:行） |
|---|---|---|
| AC1 独占 handle、构造器不导出、失败所有权不转移 | D1（V1/V2 前置 + 零副作用）、D2（工厂包内）、§3（index 不导出） | public-surface:84-88/117-132 |
| AC2 冻结 owner/namespaceId；不公开 handle/Y.Doc/writable 引用 | D1（owner 投影）、D2（七键闭包 + freeze） | public-surface:90-115 |
| AC3 五方法同步只读、读取不等 P0 | D3/D4/D5/D9、INV-N2、D6 时间线 | public-surface:164-177、sync-read-face:84-107 |
| AC4 getSchemaEnvelope 四键投影忽略额外键；META 全 plain JSON 键 | D4（投影 + 值域守卫 INV-N13）、D5（深拷贝 + 载体/值域双 loud） | sync-read-face:109-146 |
| AC5 P0 真实队首、只读/编译 SCHEMA、构造 active tools、不碰 ROOT | D6（微任务起步队首）、D7 槽体、INV-N3、D8 | p0-sequencer:87-161 |
| AC6 compile failure → unavailable；internal throw → fatal 永久关写保读 | D7 分级 + D7.4 摘要 + D7.5 状态机、D9 位公式 | p0-sequencer:163-235 |
| AC7 结算后出队，三态收敛 | D6（promise settle 即出队）、D7.5、INV-N6 | p0-sequencer:237-252、public-surface:134-162 |
| AC8 包内 seam 控制 P0 resolve/reject、P0 pending 时读取立即可用 | D8' seam、D6/D7 p0Gate、时间线 §6.1 | sync-read-face:84-107、p0-sequencer:121-136/195-235 |
| 全量 typecheck/test + Node 20/24 CI | §7.1-7.4（tsconfig include 决策 + 根脚本 + 通配收集） | 红灯证据（简报 §红灯证据） |

---

## §10. 风险登记与开放问题

| # | 风险/边界 | 评级 | 处置 |
|---|---|---|---|
| R1 | tsconfig include src-only 偏离六包惯例（SA4/SA2 可能挑战） | 低 | §7.1 实测依据链完整（tsc TS2322 复现命令在 §12 #9 + R2 补充的排除论证）；登记回归路径；SA4 比对时以本节为锚。R2 注记：SA2 评审已独立复现 TS2322 并确认「非 seam 类型可消解」，本决策经攻击后成立 |
| R2 | `getSchemaEnvelope` 对畸形 doc 返回部分投影，类型声明 `SchemaEnvelope` 存在运行时/类型偏差 | 低 | 【R2 修订，SA2 #1 后收窄表述】偏差域已收窄到 **primitive 类型错**（version 存 string/bigint 等——原样带出，compile ENV-3 收编）；**非 primitive 值已改为 loud throw**（INV-N13，`NSRT-SCHEMA-E1`），不再进入返回值。残留偏差是 ADR「不 coercion 或补默认值」的直接后果，非本设计可改；调用方有效性判定走 `status.schema`（D4 文档化） |
| R3 | 外部违约 release 后读取仍可用（无生命周期迁移） | 低 | v1 显式边界（D1）；close 后续 issue 引入真正迁移 |
| R4 | fatal 摘要不含原始异常（排障信息缺失） | 中→低 | 【R2 修订，SA2 #6】ADR-0008 明文「稳定且不含原始 Error」约束的是 status 投影；R2 已增补包内诊断锚点 `state.fatalCause`（闭包私有，不进任何公共面）——排障不再只有复现一途。「fatalCause 的消费/上报」已登记为后续观测面 issue（日志/metrics/trace）的显式验收点：不得长期沉默 |
| R5 | `p0Gate` reject 与畸形 compile 返回归入 fatal 的语义选择（另一种观点：reject 视作「取消」） | 低 | ADR 无取消语义（close 也「不取消」）；seam 注入物异常一律 internal fault 是唯一与「确定性 fault 注入」seam 目的（AC8「控制 P0 resolve/reject」——reject 即 fault 注入）自洽的分级。R2 注记：SA2 详述确认此分级（错误处理链路审查「状态闭环检查 ✅」） |
| R6 | 后续写面 issue 需要的 notifyDirty/persistence 接缝未在本任务预留代码位 | 信息 | 文档扩展位（D6/D8'）；seam 可选字段增广非破坏 |
| R7 | 【R2 新增】SCHEMA 四键值域守卫把「非 primitive 值」从公共面剔除——若未来出现合法的非 primitive 信封键形态（如结构化 version），需 ADR 层演进 | 低 | ADR-0007 冻结信封恰四键 `{lang:string, version:number, id:string, text:string}`——四键全 primitive 是既有契约，守卫不引入新约束，只执行既有约束的安全边界 |

---

## SA2 反馈逐条回应（R2 修订）

评审来源：`wiki/raw/task_namespace-runtime-skeleton-p0_sa2_review.md`（verdict reject，2026-08-23）。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 CRITICAL：D4 四键原始投影泄漏 live Yjs 引用 → 加值域守卫 loud throw | ✅ | §2 INV-N13、§4 D4（③ 值域守卫 + 设计要点三分层）、§5（getSchemaEnvelope 传 mode 'public'）、§6.2 #7/#17、§10 R2/R7、§12 #13 | 投影循环增加守卫：非 primitive 值（object≠null/function/symbol，覆盖一切 Y.AbstractType）→ 公共面抛 `SchemaProjectionError`（`NSRT-SCHEMA-E1`，含键名+typeof，不含值内容）；P0 面（mode 'p0'）违规键省略——live 引用绝不进 compile 输入（信封恒 JSON 可序列化），缺键由 ENV-2 收编 → unavailable（非 fatal，数据级失败、SCHEMA write 可修复）；primitive 类型错维持原样带出（SA2 红灯反向锁定「不 throw」）；冻结测试零影响（fixture 全 primitive） |
| #2 CRITICAL：D5 getMetadata 载体缺席/异型静默 null 是虚假降级 | ✅（选方案 a：loud throw） | §4 D5（projectMetadata 三分支重写 + 不对称可达性论证）、§6.2 #18、§10 R2 注记、§11 errors.ts 条目、§12 #14 | 载体缺席/异型 → 抛 `MetaProjectionError`（新 code `NSRT-META-E2`，message 含观测载体形态）；返回类型删 nullable（`Record<string, unknown>`）；补齐不对称论证：META 生产不可达（lifecycle.ts:385-403 强制 META.docId）→ loud；SCHEMA 缺席生产合法可达（createDoc 宽容，testing.ts:502-507）→ null 保留——同一条判据、两种可达性结论，消除 R1「一个哲学两种标准」的自相矛盾 |
| #3 MEDIUM：§5 伪代码 owner/docId 解引用晚于 P0 入队，违反 INV-N4 | ✅（双保险：重排 + V1 增补） | §4 D1（V1 增补 owner.userId/docId/doc 三项类型校验；V3 拆为 a-e 子步，身份捕获全部前置到入队前）、§5 伪代码（V3a 局部捕获 + V3e 用局部量构造 owner/namespaceId）、§6.2 #20 | 残缺 handle 的任何 throw（V1 校验或 V3a 解引用）都发生在 enqueue 之前——P0 微任务不可能启动；同步写入 SA2 红灯形态（注入 compile 计数器为零）作为 INV-N4 的可观测断言 |
| #4 MEDIUM：env 字面量 thunk 内求值 + seam 输入二次读取 → P0 可静默卡死 preparing 零诊断 | ✅（选主方案：env 一次成型 + 单读纪律） | §2 INV-N14、§4 D1 V3b/V3c、§4 D6（入队 thunk 纯调用要点）、§5 伪代码（V3b/V3c/V3d）、§6.2 #19 | seam 输入每字段只读一次（V1 校验读取 + V3b 捕获局部即闭包）；env 在构造栈一次成型（纯数据闭包，不含 input.* 引用）；thunk = `() => runP0(env)` 纯调用，零属性读取/零字面量构造/**无可抛点**——flaky getter 入队后对 runtime 不可观测，「槽体全 catch」从愿望变为结构事实 |
| #5 LOW：D7.4 `'E' + code` 拼接假设数字串，seam 注入任意串语义漂移 | ✅（采纳） | §4 D7.4 表第一行 | 改为 `'SCHEMA_ENVELOPE_' + String(issue.code)`——code 作不透明段透传，分隔语义明确；注记分类意义仅对 vfsl 闭集码成立 |
| #6 LOW：fatal 原始异常显式丢弃，无排障通道 | ✅（采纳） | §4 D7 ⑦（`state.fatalCause = err` 包内诊断锚点）、§5 state 类型、§10 R4 | 闭包 state 私有字段 `fatalCause`（不进任何公共面，INV-N5/N7 不变）；「fatalCause 消费/上报」登记为后续观测面 issue 的显式验收点（不得长期沉默） |
| #7 LOW：§7.1 缺「seam 类型放宽救不了」排除论证 | ✅（采纳） | §7.1 依据链第 3 条 | 补句：TS2322 位于测试文件自身返回类型注解（非 seam 参数类型可消解）；引 SA2 独立复核同结论 |

**一致性自检（修订后全文过检）**：①「loud vs null」两处投影器处置已统一为「生产不可达 → loud / 生产合法可达 → 可观测缺席信号」单一判据（D4/D5 对照表）；②「seam 单读」在 D1 V3b/D6/§5 三处表述一致（ INV-N14 锚定）；③伪代码与 D1 子步骤序号一一对应（V3a-e）；④冻结测试锚点（§1.3）零触碰——三 fixture 均 SCHEMA 全 primitive + META 健康，R2 新增 throw 分支全部不可达。

---

## §11. 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-runtime/src/index.ts` — 新建，公共入口：类型导出 + `createNamespaceRuntimeWithSeam`（@internal）；不导出生产工厂（AC1 锁定）
- `packages/namespace-runtime/src/runtime.ts` — 新建，Runtime 状态 + 七键公共面构造 + 包内生产工厂（§5，约 120 行）
- `packages/namespace-runtime/src/sequencer.ts` — 新建，写序列器 FIFO 骨架（§4 D6，约 30 行；可与 p0.ts 合并，SA3 自由度）
- `packages/namespace-runtime/src/p0.ts` — 新建，P0 槽体与失败分级（§4 D7，约 90 行）
- `packages/namespace-runtime/src/projection.ts` — 新建，SCHEMA 四键投影 + META 深拷贝（§4 D4/D5，约 110 行）
- `packages/namespace-runtime/src/status.ts` — 新建，getStatus 组装（§5，约 30 行；可并入 runtime.ts）
- `packages/namespace-runtime/src/errors.ts` — 新建，构造错误（NamespaceRuntimeConstructionError/HANDLE_NOT_USABLE）/META 违规错误（MetaProjectionError，`NSRT-META-E1` 值域 + `NSRT-META-E2` 载体【R2 修订，SA2 #2】）/SCHEMA 投影守卫错误（SchemaProjectionError，`NSRT-SCHEMA-E1`【R2 修订，SA2 #1】）/fatal code 注册表（约 40 行；可并入对应模块）
- 【R2 修订注记：本清单与 R1 完全同集——R2 修订只改设计文档内容，文件范围零变化；ALLOW 只增不删原则下无新增亦无删除】
- `packages/namespace-runtime/tsconfig.json` — 新建，typecheck 项目（include 仅 src/**，§7.1 实测依据）
- `package.json`（仓库根） — 修改，typecheck 脚本追加 `&& tsc -p packages/namespace-runtime/tsconfig.json`（一行，§7.2）
- `packages/namespace-runtime/test/runtime-public-surface-ownership.test.ts` — `[SA6 owned]` 已存在（冻结验收锚，本任务不改；转绿即验收）。SA3 不得改断言逻辑
- `packages/namespace-runtime/test/runtime-sync-read-face.test.ts` — `[SA6 owned]` 同上
- `packages/namespace-runtime/test/runtime-p0-sequencer.test.ts` — `[SA6 owned]` 同上

### DENY LIST

- `packages/doc-runtime/**` — 前置交付物（#86/#87）稳定，本任务只消费 `readLogicalValueAtPath` 公共导出
- `packages/vfsl/**`、`packages/vfsl-protocol/**`、`packages/vfsl-codegen/**` — 编译契约消费方，不改（21 码注册表/ENV 码域冻结）
- `packages/persistence/**`、`packages/dsh-persistence/**` — 持久层契约稳定，只消费类型与 MemoryPersistence 测试设施
- `packages/namespace-runtime/package.json` — SA6 已登记且依赖完备（§7.3），无需改动
- `pnpm-lock.yaml` — importer 已由 SA6 登记，无新依赖
- `.github/workflows/ci.yml` — CI 已覆盖（pnpm typecheck/test 通配进新包，§7.4）
- `vitest.config.ts`、`tsconfig.base.json`、`tsconfig.typecheck.json` — include 通配已覆盖新包，无需改动
- `docs/adr/**`、`CONTEXT.md` — 决策文本，工程任务不动

---

## §12. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| 1 | yjs 平面 array/object set 进 Y.Map 后 `get` 返回**同一普通对象引用**（ContentAny 透明存储）；突变返回引用会污染存储；显式 `new Y.Map()` 会以集成 Yjs 类型存储 | 设计期实测验证 | `node /tmp/sa1-verify/yjs-probe.mjs`（yjs@13.6.32，Node 24）：`① tags back is Array: true, same ref: true`、`① nested ctor: Object`、`④ mutating returned ref affects stored: ["v1","v2","MUTATED"]`、`⑤ nested Y.Map stored, get ctor: YMap` → getMetadata 深拷贝必要性的直接依据（D5） | 低 |
| 2 | `doc.getMap('SCHEMA')` 在同名异型（Y.Text）条目上 throw | 设计期实测验证 + 源码引用 | 同上脚本：`② getMap on Y.Text: THROWS -> Error Type with the name SCHEMA has already been defined with a di…`；先例：doc-runtime `carrier.ts:52-58` probeRoot 四级探针同款机制（F5） | 低 |
| 3 | `doc.share` 是公开 typed 属性（`Map<string, AbstractType>`），`share.has(name)` 可无损检测条目缺席；惰性 `getMap` 不发 update 事件但会翻转 share.has | 设计期实测验证 + 源码引用 | 同上脚本：`③ share.has absent SCHEMA: false / after lazy create: true / lazy getMap update events: 0`；yjs `dist/src/utils/Doc.d.ts:44: share: Map<string, AbstractType<YEvent<any>>>`；本设计缺席路径直接 return null 不惰性创建（D4 ①） | 低 |
| 4 | `Y.Map.set(k, undefined)` 后 `has(k)===true` 且 `keys()` 含 k、`get(k)===undefined` | 设计期实测验证 | 同上脚本：`⑥ set undefined then get: undefined, has: true, keys: ["lang"]` → 四键投影以 `get(k)!==undefined` 判键省略（D4 ③），不枚举 keys() | 低 |
| 5 | `.then` 回调恒以微任务执行，绝不在 enqueue 调用栈内同步运行 | 官方文档引用 | ECMAScript 规范 PromiseJobs/NewPromiseResolveThenableJob 语义（then 回调经 EnqueueJob 排程）；这是 INV-N1「P0 绝不在构造栈内结算」的机制根源，无需额外调度原语 | 低 |
| 6 | `compileSchemaEnvelope` 对 null/缺键/错型/多余键输入返回结构化 `ok:false`（ENV-1/2/3/5/4），顶层崩溃边界 ENV-100 绝不外抛；各失败阶段 issues 恒非空 | 源码引用 | `packages/vfsl/src/index.ts:303-347`（严格门 + 顶层 catch ENV-100）；`envelope.ts:101-176` validateEnvelopeShape（ENV-1 早出/ENV-2+3 聚合）；`envelope.ts:232-268` envelopeStrictGate（ENV-5 单条、ENV-4）→ P0 投影直入无异常路径（D7 ④） | 低 |
| 7 | vitest `--typecheck` 仅对 `*.test-d.ts` 做类型检查；`.test.ts` 由 esbuild 转译执行、零类型检查 | 源码引用（仓内配置） | `vitest.config.ts:7-11`：`typecheck: { enabled: true, include: ['packages/*/test/**/*.test-d.ts', …] }`；根 `package.json:11`：`"test": "vitest run --typecheck"` → SA6 测试中的类型不合规字面量（#9）不影响 `pnpm test` | 低 |
| 8 | 根 typecheck 逐包枚举，新包不入列则零类型覆盖 | 源码引用 | 根 `package.json:13`：六包 `tsc -p` 显式串联，无通配 → §7.2 追加必要性 | 低 |
| 9 | SA6 测试注入字面量 `{ code: 'ENV_TEST', message: 'seam rejection' }` 与 vfsl `SchemaEnvelopeIssue` 类型不符 | 设计期实测验证 | `pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --target ES2022 --module ESNext --moduleResolution bundler /tmp/sa1-verify/probe.ts`（probe.ts 复刻 runtime-p0-sequencer.test.ts:122-127 的注解与字面量）→ `probe.ts(7,61): error TS2322: Type '"ENV_TEST"' is not assignable to type 'SchemaEnvelopeIssueCode'` → §7.1 include 决策的直接依据 | 中（已消解：include 收窄） |
| 10 | MemoryPersistence `createDoc` 返回 handle 持有调用方传入的同一 live Y.Doc 实例；初始 entry 状态 ready | 现有测试引用 | `packages/persistence/src/testing.ts:241-244`：`expect(handle.doc).toBe(doc)`、`expect(handle.owner).toBe(owner)`；issue #79 套件（`persistence/test/issue-79-*.test.ts`）锁定 `getStatus()` entry 级语义 | 低 |
| 11 | CI 以 Node 20/24 矩阵执行 `pnpm typecheck` + `pnpm test` | 源码引用 | `.github/workflows/ci.yml`：`matrix: node: [20, 24]`，steps `pnpm typecheck` → `pnpm test` | 低 |
| 12 | 测试相对导入 `../src/index.js` 可解析（.js→.ts 映射） | 类比已有 job 验证 | 六包既有测试同款约定（如 `doc-runtime/test/read-logical-value-at-path-schema-independent.test.ts` 相对导入 `../src/index.js` 全量绿）——SA6 红灯证据亦证明该路径已被 vitest 收集（红因模块不存在而非路径不解析） | 低 |
| 13 | 【R2 新增，SA2 #1】SCHEMA 四标准键可持有集成 Yjs shared type 且经 `get` 原样读出（`sc.set('version', new Y.Map())` → `sc.get('version') instanceof Y.AbstractType === true`）——公共投影若无值域守卫即泄漏 live writable 引用 | 设计期实测验证（双源） | 本设计 probe #1⑤（Y.Map 内嵌 `new Y.Map()` 存取，get ctor YMap——同机制）；SA2 评审期独立复现（`sc.set('version', new Y.Map())` + instanceof 断言，见 SA2 报告「验证证据索引」第 1 行）→ D4 值域守卫（INV-N13）的直接依据 | 低（已消解：值域守卫） |
| 14 | 【R2 新增，SA2 #2】persistence 生产路径的 SCHEMA/META 可达性不对称：`createDoc`/loadDoc 恢复均强制 `META.docId` 匹配（META 缺席/异型直接被拒），但完全不校验 SCHEMA（缺席/异型 doc 合法可入） | 源码引用 + 现有测试引用 | `packages/persistence/src/lifecycle.ts:385-391`（validateCreateDoc：仅 `doc.getMap('META').get('docId')` 校验）、`lifecycle.ts:396-403`（restoreAndValidate 同款）；共享套件 `testing.ts:493-500`（Missing META → reject）、`testing.ts:502-507`（no SCHEMA → permissive 接受）；`seedForTest`（`lifecycle.ts:229-246`）是唯一无 META doc 来源（测试设施）→ D5 载体异常 loud（生产不可达=bug）与 D4 SCHEMA 缺席 null（生产合法可达）的不对称处置依据 | 低 |

---

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅涉及【新建包内全部新增函数（createNamespaceRuntimeWithSeam 及内部模块）】+【根 package.json typecheck 脚本追加（构建脚本，非函数契约）】。不修改任何既有函数的签名、返回类型、throw 行为、async 性或 catch 语义；对 doc-runtime/vfsl/persistence 的消费全部是既有公共导出的只读调用，不存在 caller 侧连锁。

（声明性章节：SA4 §1.5 比对时，本任务 diff 中唯一触及既有文件的是根 package.json 的 scripts.typecheck 字符串——无函数契约面。）

---

## 附：交付声明（R2）

本设计覆盖简报全部 8 条验收标准（§9 映射）、遵守 SA8 冲突门禁三条边界注记（§0/§4 D6/D8'）、锚定 SA6 三测试文件全部可观测断言（§1.3）。**R2 修订落实 SA2 reject 评审全部 7 个攻击点**（4 阻断 + 3 建议，逐条回应表见上）；修订后公共读取面满足 live 引用零出站（INV-N13）、构造序满足零副作用与单读纪律（INV-N4/N14）、META 载体异常脱离静默通道。SA6 冻结测试零触碰、文件范围零变化。交出控制权，等待 SA2 复审（按其声明只需复审差异段：D1/D4/D5/D6/D7/§5/§10）。

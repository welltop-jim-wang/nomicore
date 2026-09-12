# ADR 0025：条件写（guarded mutation）

日期：2026-09-12
状态：已接受

## 背景与动机

静态约束（VFSL 结构/值校验）回答的是「当前这份值是否符合当前 schema」——快照可判定。业务上还存在一类**跨状态**的动态约束：业务 version 只能递增、业务 updatedAt 不能回退、状态机只能沿转移表跳转。这类约束的判定需要旧值与写入意图，ADR 0002 已把旧系统 authority 规则体系（`__authority__` manifest：enum / range / conditional / state-machine 的规则语言）完全排除在引擎范围外。

在 authority 排除的前提下，这类约束目前只能落在宿主 typed adapter 的读-验-写（read-check-write）：先 `readData` 旧值、检查、再 `mutateData`。该模式有两个结构性缺陷：

1. **TOCTOU 窗口**：读取不进写序列器（CONTEXT.md「写序列器」：读取不进入该序列），而 mutation 信封是纯数据、无「期望旧值」形态——检查与提交之间可插入其他受控写，两个并发调用可基于同一旧值分别通过检查、先后提交。
2. **审计缺口**：adapter 层拒绝发生在写槽接纳之前，不进 namespace 诊断变更日志的 rejected 变更尝试流。

本 ADR 提供最小机制补丁：给受控 ROOT mutation 信封增加可选前置条件（guard）。**机制而非策略**——引擎只断言「指定路径的 committed 当前逻辑值」，不含状态机、单调性、时间等任何领域词表；转移表与业务规则仍住在调用方（typed adapter）代码里。

## 决策

### 信封形态

四个操作（`set` / `delete` / `array-insert` / `array-delete`）统一可携带可选 `guard` 键，**单条件对象**：

```ts
type MutationGuard =
  | { path: readonly (string | number)[]; equals: unknown }
  | { path: readonly (string | number)[]; absent: true };
```

```ts
// 状态机转移：仅当当前状态是 draft 才提交
await lease.mutateData({
  op: 'set', path: ['tasks', id, 'status'], value: 'reviewing',
  guard: { path: ['tasks', id, 'status'], equals: 'draft' },
});
// create-if-absent：仅当条目不存在才创建
await lease.mutateData({
  op: 'set', path: ['tasks', id], value: draft,
  guard: { path: ['tasks', id], absent: true },
});
```

- `equals`：与投影逻辑值**结构深相等**（undefined 键过滤，与读取面 D4 缺席吸收语义一致）；比较对象是 `readLogicalValueAtPath` 投影出的普通逻辑值。
- `absent`：读失败（`PATH_NOT_ALLOWED`）或投影值为 `undefined`（缺键吸收）均满足。
- guard 路径段纪律同 mutation path（string = 键、number = 数组下标）；路径语义整体跟随载体投影读取（ADR 0008 域）：穿越 XML 等「不可下钻终态」→ 读失败 → `equals` 不满足 / `absent` 满足；指向 XML 终点则与其投影值比较。**guard 路径不允许为 `[]`**（ROOT 整树 CAS 是 read-modify-write 反模式的变体，v1 拒绝）。

### 评估位置与原子性

- 评估在 doc-runtime `applyValidatedMutation` 的 prepare 阶段：**信封解析成功后、局部/legacy 管线分叉前**；`set([])` legacy 管线同样生效。
- **原子性来自写序列器 FIFO 独占（ADR 0008），不来自 Yjs 事务**：本槽独占期间无其他受控写，guard 读到的 committed 值在本槽提交前不会改变。guard 评估是纯读（零写入、零事件），放进 `transactGuarded` 事务不增加任何保证（Yjs 事务无隔离承诺）——把检查放进事务只会混淆「谁保证原子」的归属。
- guard 评估**先于** schema 校验管线：CAS 竞争是预期中的高频拒绝路径，必须最便宜；竞争赢了之后才暴露新值非法，符合业务顺序（先确认旧值没变，再谈新值合法性）。
- guard 看到的是序列器视角的最新 committed 值，看不到排队中的后续写。

### 错误域（两态）

| 态 | 触发 | 形态 | 调用方处置 |
|---|---|---|---|
| 形状错误 | guard 非对象、`equals`/`absent` 非恰其一、缺 `path`、`absent` 非 字面 `true`、`path` 为 `[]`、`equals` 含非有限数 | `parseMutation` 信封校验拒绝，沿用现有无码信封错误风格，零写入 | 调用方缺陷，**不可重试** |
| 评估不满足 | 条件读到的当前值不满足断言 | 零写入 `ok:false`，单 issue（v1 单条件，无组合短路问题），稳定码 **`MUTATION_GUARD_MISMATCH`**（doc-runtime 定义并从 `index.ts` 导出——该包首个领域拒绝稳定码）；`issue.path` = guard 条件路径；message 含期望/实际摘要（截断防爆） | CAS 竞争，**可重试**（重读旧值重构造） |

诊断：guard 拒绝经写槽现有 R9 透传（stage=validation、result=rejected）自动进 namespace 诊断变更日志——这是把检查移进槽内的审计收益，namespace-runtime 写槽零改动。guard 评估自身无 fatal 面，fatal 通道不变。

### 边界与不承诺

- **只约束受控写**：复制 apply（replication-unvalidated，ADR 0010 / ADR 0007 issue #237 修订节）不受 guard 拦截；`replaceSchema` 是另一信封，不适用。
- **跨实例是约定不是强制**：离线双写的两个副本可各自通过同一 guard（各自看到相同旧值）分别提交；Yjs 合并点无拒绝通道，终态由 CRDT 元素语义决定——「每一步都 guarded 合法、终态仍违反业务期望」可能发生（例：A 写 version 6、B 写 7，LWW 终态可能是 6）。单实例、或全部业务写经同一 Hub 写序列器，才是强制级。
- **guard 不解决生成器权威**：updatedAt 防回退的正解仍是「调用方不提供、提交方生成」；guard 是校验通道，不是生成通道。

### 与 ADR 0002 的关系

**不 supersede。** ADR 0002 否决的是 authority 规则语言/manifest 进引擎；本 ADR 提供的是无领域语义的条件原语（`equals` / `absent` 两个谓词，词表封闭），策略词表仍留在调用方代码。ADR 0007 的 mutation 信封由此增加一个可选键，双管线（issue #237 局部 / legacy）与零写入承诺不变。

## Considered Options

- **adapter 层读-验-写（现状）**：TOCTOU + 审计缺口，被否（见背景）。
- **事务内条件读**：Yjs 事务无隔离承诺，不增加保证，混淆原子性归属，被否。
- **读-改-写组合子（`increment`/`max`）与宿主槽内钩子**：表达力更强，前者把值变换语义引入信封、后者使策略离开可序列化数据——与 guard 正交的演进方向，独立 ADR 再议。
- **多条件与 and/or 组合子**：组合语义复杂度高，v1 砍掉，留作词表演进。
- **复活 authority 规则语言**：ADR 0002 已否决，不重开。

## Consequences

- mutation 信封演进：四 op 的信封校验接受可选 `guard`；旧调用方不受影响（可选键）；携带 guard 的信封对旧运行区按「未知信封键」loud 拒绝，不破译。
- doc-runtime 公共面新增 `MutationGuard` 类型导出与首个领域拒绝稳定码 `MUTATION_GUARD_MISMATCH`；公共面审计测试同步（包 AGENTS.md 纪律）。
- CONTEXT.md 新增「条件写（guarded mutation）」词条；`.agents/skills/nomicore/typed-access.md` 增补 guard 使用小节（CAS 状态机转移与 create-if-absent 范式、可重试语义）。
- 上层动态约束（状态机转移、version 递增、防回退）以「readData → guard `equals` 旧值 → mutateData（+ adapter 重试循环）」表达；策略与重试仍在上层。
- 实现验证门槛：doc-runtime mutation/read/public-surface 测试、namespace-runtime 写槽透传与序列器竞争测试、根 `pnpm typecheck` + `pnpm test`。

## 开放问题

1. 谓词词表演进（`exists`、数字比较、`neq`、多条件与 and/or 组合、guard 路径放开 `[]`）——须过设计评审（仿诊断日志 update-omitted 受控词表先例：词表封闭、新增须显式决策）。
2. 读-改-写组合子（`increment`/`max`，消除重试循环）——与 guard 正交，独立 ADR。
3. 跨实例执法（复制 apply 后检测 + violated 状态、写权威拓扑）——本 ADR 明确不做，仅声明约定级边界。

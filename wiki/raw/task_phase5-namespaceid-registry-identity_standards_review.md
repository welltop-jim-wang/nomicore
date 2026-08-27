# Standards 终审（终轴一）— issue #131（Phase 5 切片 1：generate namespaceId and migrate Registry identity）

- **审查轴**：Standards（仓库惯例 / 文档与测试要求 / 生命周期与防御式模式规则 / 可维护性）
- **审查 diff 范围**：`980b16a..HEAD`（基线 980b16a = `origin/docs/phase-5-websocket-replication` 顶端；HEAD = `9ec3eef`）
- **提交序列**：`b21de27`（feat 主体）→ `b0962e9`（红灯锚定 fixture 修复）→ `7296c1e`（dispatch log）→ `9ec3eef`（SA7 动态回归 + AC 核对表）
- **Worktree**：`/home/wangjian/nomicore-fix-issue-131`（分支 `fix/issue-131-on-docs-phase-5-websocket-replication`）
- **审查日期**：2026-08-27
- **审查人**：Standards 终审 reviewer（独立终审，不复读 SA4/SA7 结论）

## 只读验证结果（本 reviewer 亲跑）

| 验证 | 命令 | 结果 |
|---|---|---|
| 包 typecheck | `pnpm typecheck`（根，9 包 tsc 链） | ✅ 通过 |
| 包测试 | `npx vitest run packages/namespace-registry`（含 `--typecheck`） | ✅ 16 文件 / 190 用例全绿，0 type errors |
| 完整门禁 | `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit` | ✅ 通过 |
| 全仓测试 | `pnpm test`（根，`vitest run --typecheck`） | ✅（见文末验证注记） |
| Persistence 零改动 | `git diff 980b16a..HEAD -- packages/persistence` 为空（AC checklist AC-5 复核） | ✅ |

## 合规确认（无违规项，择要记录）

1. **descriptor-only / 零副作用接纳**：`acceptCreateIdentity`（identity.ts:163-190）保持纯 descriptor 判别——`namespaceId` 键以 `Object.getOwnPropertyDescriptor` 存在性检查拒绝（accessor 零 getter 执行），owner 形状门沿用既有判别式；拒绝路径零随机源消耗、零 carrier/entries/Persistence 副作用。符合「descriptor-only 读取 / 零副作用校验」纪律。
2. **注入 capability 纪律**：`randomBytes` 为 `CreateNamespaceRegistryOptions` / `NamespaceRegistryTestingOverrides` **必需**注入（types.ts:194-199, 372-375；testing.ts:48-50）；构造期形状门禁 `assertRandomBytesShape`（registry.ts:147-153）固定 TypeError、message 逐字常量、零回显，**禁全局 crypto/Math.random fallback**；生产实现只在 Host-facing 适配层（plugin.ts:68-76）桥接 `node:crypto` 并拷贝为独立 Uint8Array（防 Buffer 池化语义外泄）。检查顺序 clock → scheduler → idleTimeoutMs → randomBytes 有注释明示且不漂移既有用例文案。符合 ADR 0009 依赖纪律。
3. **窄 issue / 错误常量面**：新稳定 message `NAMESPACE_REGISTRY_RANDOM_REQUIRED_MESSAGE` 入 types.ts 单点表（types.ts:76-78）；`NAMESPACE_ALREADY_EXISTS` code/message 按 ADR 0009 修订节第 3 条保留于公共联合（types.ts:230-233），运行时产出点全部删除（registry.ts:245-247 注释明示，切片 2 复用）。ID 生成失败的 `new Error('NAMESPACE_ID_*')` 均为 fatal **cause**（非 issue message），与既有 `'closing entry 缺少 closePromise'` 先例同款——不进稳定 message 注册表，合规。
4. **observer 事件纪律**：新事件 `create-id-generation-failed`（observer.ts:34-41）经 `dispatchObserver` 隔离单点分发（registry.ts:527-532 `throwIdGenerationFatal`），每终局恰一次；逐次碰撞重试不发事件（注释明示）。事件载荷为冻结 owner 投影 + attempt + cause，不含内部计面。
5. **生命周期**：shutdown 屏障 D-9（registry.ts:514-519 `admittedCreates` + runShutdown 1125-1132）恒绿尾跟踪、公共入口同步注册/终局异步注销，shutdown 同步段关门后集合只减不增——快照等待安全，零 unhandled rejection。open 的 owner 核对谓词先于 phase 分派（registry.ts:802-806）及 recheck（824-827），统一 `NOT_FOUND_ISSUE` 常量，零 loadDoc/零新 Runtime——存在性零泄露，与 ADR 0009 修订节第 1 条逐字对应。
6. **重试预算算术**：`MAX_NAMESPACE_ID_RETRIES = 8`（registry.ts:143），耗尽分支 `retry > 8` 先于生成 ⇒ 总生成 ≤ 9（首生成 + 8 次重试），与 ADR 0010/0009 修订节一致；耗尽 cause message 的 `attempts=9` 插值一致。随机源 throw/形状违约立即 fatal **不消耗预算**（registry.ts:536-573），注释给出理由（能力契约缺陷 ≠ 瞬态碰撞）。
7. **文档对齐（ADR 层）**：ADR 0009 追加修订节（0009:131-143，6 条）、ADR 0006 追加对齐说明（0006:201-208），均声明日期/状态/分支，且不改动既有契约条款本体；CONTEXT.md 113-115 词条在基线已对齐（本 diff 零改动，设计 D-11 核实一致）。
8. **测试要求**：新增红锚 20 运行时 + 5 类型面用例、SA7 动态 4 用例；既有套件（create/open/idle/shutdown/plugin/persistence-contract/surface 冻结等）全部迁移并绿；测试用**确定性剧本随机源**（无真实熵源依赖，除 D3 专项）；Memory/File 平行契约套件保持。commit message 遵循 `type(scope): subject (issue #N) / 中文` 双语惯例。
9. **包面**：`package.json` exports 恰 `.`/`./testing` 不变；版本 0.1.3 → 0.1.4 随契约变更递增；`RegistryRandomBytes` 为 type-only 导出，运行时 export-keys 冻结面（恰九个）不破。

## 发现

### Hard violations

**H-1｜`docs/integration/cordis-plugin-hosting.md` 的 create 契约示例与叙述已客观失效（文档与代码契约不一致）**

- 证据：
  - `docs/integration/cordis-plugin-hosting.md:118-121`：quick-start 示例 `registry.create({ owner, namespaceId: 'notes', schema, root })` 仍携带调用方 `namespaceId`——按本 diff（identity.ts:173-176），该输入在接纳段同步返回 `NAMESPACE_CREATE_INVALID_INPUT`，**示例代码对当前实现必然响亮失败**。
  - 同文件 `:150`：`open({ userId: 'acme-user' }, 'notes')` 的重开流程依赖调用方已知 ID；普通 create 的 ID 现由 CSPRNG 生成，调用方只能经 `created.lease.namespaceId` 获知——示例叙事链断裂。
  - 同文件 `:158`：「`create()` 是排他创建，已存在时返回 `NAMESPACE_ALREADY_EXISTS`」——普通 create 的 ALREADY_EXISTS 产出点已全部删除（registry.ts:245-247, 1058-1060：entry 碰撞/DOC_DUPLICATE 改为换 ID 重试，耗尽为 fatal），该句对普通 create 不再为真。
- 判据：根 `AGENTS.md` 将该文档指定为第三方 Cordis 宿主集成时**必须遵循**的指南（"follow `docs/integration/cordis-plugin-hosting.md`"）；仓库文档与公共契约一致性是 Standards 轴底线。被指定遵循的指南其主示例必然失败，属客观矛盾，非措辞偏好。接受的设计 R2 §8（D-11）将文档对齐范围限定为 ADR 0006/0009 + package contracts、未含本文档——这是设计范围裁决，但不能使「指南示例必然抛错」这一事实状态合规；修复量小（示例删 `namespaceId` 键、改经 `lease.namespaceId` 重开、删 ALREADY_EXISTS 句或注明切片 2 受信任导入专用）。

**H-2｜`packages/namespace-registry/README.md` 核心保证句与错误列举已过期**

- 证据：
  - `README.md:3`：「guarantees one active runtime and one write sequencer per `(owner.userId, namespaceId)`」——entry key 已迁移为**仅 namespaceId**（identity.ts key=namespaceId；ADR 0009 修订节第 1 条），旧复合键退役。README 首句描述的中心不变量与实现直接矛盾。
  - `README.md:33`：「Expected open/create failures use narrow result issues such as … `NAMESPACE_ALREADY_EXISTS` …」——普通 create 不再 resolve 该码（见 H-1）；保留注册位仅供切片 2 受信任导入，现句对当前 create 契约误导。
- 判据：README 是包公共文档，且被 cordis-plugin-hosting.md 指为权威来源（"以 README 与 `NamespaceRegistryPluginConfig` 类型为准"）；AC-7 核对表声称「registry README/package contracts 随 b21de27 对齐」——README 实际未在本 diff 中变更，该声称与事实不符。首句保证的事实性错误属硬违规（非措辞偏好）。

### Judgement calls（非阻断）

**J-1｜`types.ts:311-316` `NamespaceRegistry` 接口级 JSDoc 未同步**
接口头部契约叙事仍写「resolve 领域窄 issue（含 duplicate 四源同码 ALREADY_EXISTS）」与「构造期同步 TypeError（Clock/scheduler 形状门禁）」——前者已被切片 1 废止（重试/耗尽 fatal 取代），后者漏列 randomBytes 门禁。`create` 方法级 JSDoc（types.ts:326-331）已正确更新为恒三键。方法级正确、接口级滞后；建议顺手修订，不阻断。

**J-2｜`identity.ts:15-16` 模块头注释的历史表述**
「#111 起 input 顶层 owner/namespaceId 读取同为 descriptor-only」——create 接纳现对 namespaceId 只做存在性拒绝（不再读取其值交校验）。表述仍大致符合「descriptor-only、accessor 零执行」事实，仅精度滞后；不阻断。

**J-3｜`NAMESPACE_CREATE_INVALID_INPUT_MESSAGE` message 文案变更（types.ts:55-56）**
由「恰含 owner、namespaceId、schema 与 root」改为「恰含 owner、schema 与 root」。code 不变；仓库纪律本就要求调用方按 `code` 分支、不匹配 message 文本（cordis-plugin-hosting.md:160 亦自述），故属契约变更下的合理随行修改。记录备查，不阻断。

**J-4｜SA7 D3 统计性 CSPRNG 测试的 CI 代价与残余 flake**
`registry-sa7-phase5-dynamic.test.ts:227-258`：60,000 次真实 `node:crypto` 抽样 + 字节频率 ±6σ 界（注释自评 flake 概率 ~5e-7/界）。测试意图（观证生产桥接熵源质量）有价值，注释对残余风险的披露诚实；代价为每次 CI ~秒级耗时与极小 flake 概率。属可接受工程权衡，不阻断。

**J-5｜`CreatePreparedState` 中 `schema`/`root` 字段冗余**
preparedBox 缓存的 `schema`/`root`（registry.ts:966-971）在 `buildInitialDocument` 调用中透传，但值即可由 `inputRef` 快照路径再取；当前写法为「一次/create 快照」语义的显式载体，可读性可接受。仅提示，无需动作。

## Conclusion: blocking

阻断项（均为文档-契约一致性，修复量小）：

1. **H-1**：更新 `docs/integration/cordis-plugin-hosting.md` §「创建、读取、修改和重新打开」（:118-121、:150、:158）——create 示例去除调用方 `namespaceId`、重开改经 `lease.namespaceId`、删除或限定 `NAMESPACE_ALREADY_EXISTS` 叙述。
2. **H-2**：更新 `packages/namespace-registry/README.md:3`（保证句改为按 namespaceId 唯一索引）与 `:33`（错误列举移除或限定 `NAMESPACE_ALREADY_EXISTS`）；同时校正 AC 核对表 AC-7 行「README 随 b21de27 对齐」的不实声称。

代码本体（identity/registry/create-document/observer/plugin/testing/types）在 Standards 轴无硬违规：防御式模式、capability 注入、observer 纪律、错误常量面、生命周期屏障、测试覆盖与 ADR 层文档对齐均符合仓库惯例。Judgement calls J-1..J-5 非阻断，可随 H-1/H-2 修复顺带处理。

---

### 验证注记

- `pnpm typecheck`（根）：9 包 tsc 链全过。
- `npx vitest run packages/namespace-registry`：Test Files 16 passed (16)，Tests 190 passed (190)，Type Errors: no errors。
- `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit`：通过（README「Contract and verification」列示的第三道门禁）。
- 全仓 `pnpm test`（`vitest run --typecheck`）：Test Files 121 passed (121)，Tests 1431 passed (1431)，Type Errors: no errors（2026-08-27 本 worktree 实测）。

---

## R2 复审节（修复后重审，2026-08-27）

- **复审范围**：`9ec3eef..HEAD`（HEAD = `69055f7`；修复提交 `67da92d` + wiki 记录提交 `69055f7`）；整体范围仍为 `980b16a..HEAD`。
- **复审输入**：SA3 终审修复轮 R1（commit `67da92d`）——针对本文件首轮 H-1/H-2，并顺带处理 J-1/J-2；AC 核对表校正随 `69055f7` 入库。

### H-1 复核（cordis-plugin-hosting.md）——✅ 闭合

- `docs/integration/cordis-plugin-hosting.md:118-121`：create 示例已三键化（删除 `namespaceId: 'notes'`），并加注释说明 ID 由注入 CSPRNG 生成（`ns-`+32 小写 hex）、调用方不得提供、经 `lease.namespaceId` 获知——与 identity.ts 接纳段（namespaceId 键出现即拒）及 registry.ts 生成编排一致。
- `:136`（`const notesId = lease.namespaceId`）+ `:152-154`：重开改用生成 ID，注释补充 owner 核对/mismatch NOT_FOUND 零泄露——与 open 第一谓词实现（registry.ts:802-806）一致。
- `:162`（原 :158 叙述）：已改写为「碰撞内部重生成换 ID 重试（至多 8 次）、耗尽 reject `NamespaceRegistryFatalError`（`committed:false`、`phase: 'namespace-id-generation'`）、普通 create 不再返回 `NAMESPACE_ALREADY_EXISTS`（保留公共联合供后续受信任导入切片）」——与实现（MAX_NAMESPACE_ID_RETRIES=8、耗尽 committed:false fatal、types.ts 保留注册位）逐条相符。

### H-2 复核（README）——✅ 闭合

- `README.md:3`：保证句改为 per `namespaceId`，并注明 ADR 0010 依据与 owner 的新角色（持久化分区属性 + 复用时核对）——准确。
- `README.md:33-35`：§Errors 列举以 `NAMESPACE_INVALID_IDENTITY` 替换 `NAMESPACE_ALREADY_EXISTS`，并新增专段说明 ALREADY_EXISTS 的保留定位、普通 create 的内部重试/耗尽 fatal 语义、三键 CREATE_INVALID_INPUT 拒绝面与 open owner mismatch NOT_FOUND——与代码事实一致。
- AC 核对表 AC-7 行已校正为 ⚠️→修复轨迹的诚实记录（含「首轮声称不实，特记」），结论行改为「双轴复审转 clear 后方可封口」——本轮 Standards 轴复审即该封口的本轴部分。

### J-1 复核（types.ts 接口级 JSDoc）——✅ 修复准确

`types.ts:307-320`：`NamespaceRegistry` 接口头部已重写——owner-only 接纳、生成编排循环（碰撞/DOC_DUPLICATE 换 ID 重试 ≤8 次、耗尽 committed:false fatal）、attempt slot 经 carrier FIFO、create-document 拆分 prepare + build、三通道列举移除 ALREADY_EXISTS、fatal phase 词表补 `namespace-id-generation`、构造门禁补 randomBytes。与方法级 JSDoc 及实现一致。

### J-2 复核（identity.ts 模块头）——✅ 修复准确

`identity.ts:1-26`：模块头追加 #131 增量段——key = namespaceId 本体（长度前缀复合键退役）、`validateOwnerIdentity` 抽出复用、`acceptCreateIdentity` owner-only 重写（namespaceId 键出现即拒、零随机/零 carrier/零 Persistence）；并补充 open 文法零改动、旧格式 namespaceId 继续可用的兼容注记。历史段落保留但定位清晰，无误导。

### R2 只读验证（HEAD = `69055f7` 实测）

- `npx vitest run packages/namespace-registry`：Test Files 16 passed (16)，Tests 190 passed (190)，Type Errors: no errors。
- `./node_modules/.bin/tsc -p tsconfig.typecheck.json --noEmit`：通过。
- 本轮源码改动仅注释级（identity.ts/types.ts JSDoc），行为面无变更；文档改动如上逐项核对。

### 最终结论

**Conclusion: clear**

首轮阻断项 H-1/H-2 均已闭合并经逐行核对；J-1/J-2 顺带修复准确；J-3/J-4/J-5 维持首轮「非阻断」判定。Standards 轴（终审轴一）对 `980b16a..69055f7` 无遗留阻断项。

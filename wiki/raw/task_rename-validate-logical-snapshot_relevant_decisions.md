# 相关决议 (Relevant Decisions) — 全链 SA 复用

> SA8 前置门禁产出。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 被审对象：`wiki/raw/task_rename-validate-logical-snapshot.md`（Issue #71，refactor：
> `validateSnapshot` → `validateLogicalSnapshot` 一次性更名迁移，不保留 deprecated alias）。
> ADR 基线：`docs/adr/0001`–`0007` 全读（7/7），状态均为 accepted，无 superseded 条目。

## 相关 ADR

### ADR-0007 逻辑验证与 Yjs Runtime Bridge 分层（accepted，2026-08-22）

- 与本任务的关联点：**本任务就是该 ADR「逻辑层」决策中更名条款的直接落地**；新名语义、
  不留 alias、JSDoc 边界全部由本 ADR 规定。
- 核心条款（原文摘录）：
  - 背景：「现有 `validateSnapshot` 只解释 `DerivedSchema.values`，但名称容易误导为可直接校验
    live Yjs 文档；若把两类校验合并，读取、物化、写入和持久化边界都会变得含混。」
  - 「`validateSnapshot` 直接更名为 `validateLogicalSnapshot`，不保留兼容 alias；它只接受普通
    JSON logical ROOT snapshot，不接受 Y.Doc/Y.Map/Y.Array。」
  - 「`@nomicore/vfsl` 继续保持无 Yjs 依赖；持久层继续不理解 VFSL。」
  - 「`materializeRoot(derived, snapshot, doc)`：唯一公共物化入口；内部先执行
    `validateLogicalSnapshot`，再构造未集成到任何 doc 的 detached Yjs 子树，确认目标 ROOT
    为空后以一次 `Y.transact` 安装。验证或构造失败时目标 doc 零写入；不覆盖、不合并、不
    fallback。」
  - 「`extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格验证实际 Yjs 载体并提取普通
    逻辑 ROOT；首个结构错误立即停止，不读取或验证 SCHEMA/META。」
  - 「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型；NamespaceRuntime/Registry
    再映射成稳定的 create/open/mutation 上层错误。逻辑校验保留完整 issues，Yjs 结构与
    路径/操作错误 fail-fast。」
  - 「零写入承诺覆盖所有验证失败和 detached 构造失败。」
- 对本任务的含义（中性提示）：更名后 `@nomicore/doc-runtime` 内部调用点
  （`materializeRoot` 等）应已是新名或需随迁移统一；issues 结果联合形状、纯函数与零写入
  行为不得随更名改变。

### ADR-0003 求值器与派生 schema（accepted，2026-08-19）

- 与本任务的关联点：其「evaluate 接缝」条款的公共观察点清单以旧名 `validateSnapshot`
  行文（早于 ADR-0007）；本任务更名后该清单的现行有效名称以 ADR-0007 为准。
- 核心条款（原文摘录）：
  - 「`parseVfsl` / `evaluate` / `validateSnapshot` / `validatePatch` 及数组写入校验入口均以
    各自 Interface 作为公共观察点，不再使用易失效的序号描述。」
  - 背景：「三者共同决定派生 schema 的节点形状——`validateSnapshot`、路径守卫、AI
    namespace card 的公共地基。」
  - 「派生 schema 的形状变更须走设计修订流程（公共契约）；」
  - 「evaluate 结果联合的 issues 形状复用 `VfslIssue`；」
- 对本任务的含义（中性提示）：本任务只是改公共接缝的**名称**，不触派生 schema 形状或
  issues 形状；若涉及则超出 refactor 范围、须走设计修订流程。

### ADR-0006 server 持久化与 docstore（accepted，2026-08-21，含 createDoc/owner 修订节）

- 与本任务的关联点：「校验面」条款以旧名 `validateSnapshot` 行文；其**决策内容**
  （校验只作用 ROOT 子树）与名称无关，本任务不得改变该范围语义。
- 核心条款（原文摘录）：
  - 「META/SCHEMA 作为 ROOT 的兄弟条目，天然在 validateSnapshot/validatePatch 的校验面之外
    （校验只作用 ROOT 子树）。」
  - 「持久层 = Y.Doc 的存储引擎（store + cache 一体），看得见 Y.Doc（结构、update 事件、
    state vector），看不见 schema 语义（VFSL/校验规则属引擎领地）。」
- 对本任务的含义（中性提示）：迁移时持久层（MemoryPersistence/FilePersistence）不应因
  更名引入对 VFSL 校验的任何新依赖（持久层不理解 VFSL）。

### ADR-0001 / 0002 / 0004 / 0005

- 与本任务无接触点（详见冲突报告盘点表）。唯一边角：ADR-0001 的「语义层不设机器标签」
  约束的是 **schema 文本内的 JSDoc 标签**，不约束本任务要写的**代码 API JSDoc 注释**
  （验收项「JSDoc 明确 logical JSON 与 live Yjs 载体的边界」属后者，不受该条款限制）。

## CONTEXT.md 相关术语与惯例

- `逻辑快照校验（validateLogicalSnapshot）`（原文摘录）：
  「对普通 JSON 逻辑 ROOT 快照运行完整值语义校验；不接收 Y.Doc / Y.Map / Y.Array，也不验证
  Yjs 载体。创建前校验、迁移后体检、测试与管理端点共用该入口。
  _Avoid_: validateSnapshot（容易误解为可校验 live Yjs 文档）」
  ——本任务即把该术语契约落进代码面：全仓消灭 `validateSnapshot` 旧名。
- `ROOT`（原文摘录）：
  「命名空间根别名的保留名（大小写是契约）：每个模块必须恰好声明一个 map 形的
  `type ROOT = …`（裸对象 / `YMap` / `Record`），ROOT 固定物化为 Y.Map，Yjs 映射为 doc 根
  `getMap('ROOT')`。」——「logical ROOT snapshot」的 ROOT 即此保留名。
- `零写入（zero-write）`（原文摘录）：
  「校验失败 → 400 且文档不变；所有写入口走同一条管线。」——任务要求「零写入行为保持
  不变」的基准表述。
- `求值器（evaluator）` _Avoid_ 条款与 `派生 schema` 条款：本任务不触求值器与派生物形状，
  仅在引用时保持术语一致。

## 全链复用提示（中性，不构成裁决）

1. 更名的**唯一权威依据**是 ADR-0007「逻辑层」条款 + CONTEXT.md 术语条目；任何 SA 环节
   不得以「兼容性」为由恢复 deprecated alias（ADR-0007 明文「不保留兼容 alias」）。
2. 行为基线：值语义、issues 形状（复用 `VfslIssue`）、资源预算行为、纯函数、零写入——
   全部「保持不变」，回归以既有行为测试为对照（任务验收项 2）。
3. 旧名残留的已知文字位置（供 SA3 迁移清单参考，非阻塞；grep
   `validateSnapshot|validateLogicalSnapshot` 于 docs/adr 全集共 6 处命中）：ADR-0003
   L8（背景）/L14（§决策1 清单）、ADR-0006 L73（「校验面」条款行文）含旧名；
   ADR-0007 L8（背景动机）/L14（更名决策，两名并陈）/L25（`materializeRoot` 内部
   调用，新名）。ADR-0001/0002/0004/0005 零命中。ADR 是历史决策记录，是否随
   「文档迁移」改写其行文由 SA1/SA2 在设计阶段定夺，SA8 不裁决。

---

## 设计后复审追加（Phase 2，R1 设计 §3 决策冻结表 D1–D9）

> 被审对象：`wiki/raw/task_rename-validate-logical-snapshot_design.md`（§0–§12）。
> 以下为设计引入、与基准有交互且下游 SA（SA3/SA4/SA7）须复用的任务级决策点（中性摘述；
> 冲突裁定见 `_design_conflict_report.md`，全部 no-conflict）。

- **D1 更名半径最小化**：仅三类改动（符号 token 全字替换 / `validate.ts` 函数 JSDoc 整块
  替换 / 注释与活文档行文）；函数体、`interpret`、`validateSubtree`、消息字面量逐字节不动；
  局部变量名不改。
- **D2 不留 alias**：禁止 `export { validateLogicalSnapshot as validateSnapshot }` 及任何兼容
  绑定——ADR-0007「不保留兼容 alias」的直接落实；AC2 红灯 `toBeUndefined` 为活守卫。
- **D3 JSDoc 载体边界逐字文本**：设计 §4.1(b) 逐字文本（logical JSON / 不接受 Y.Doc·Y.Map·
  Y.Array / 载体校验属 Yjs Runtime 层 / 不提旧名）——AC3 与 ADR-0007 L8/L14 语义载体。
- **D4 不改文件名**：`validate-snapshot.test.ts` / `validate-snapshot-sa7.test.ts` 路径名保留
  （AC1/AC2 验收域为符号非路径）；若 SA2 裁定必须改，须显式扩展 ALLOW LIST 并解除
  contract.ts 冻结的单点修订，不得顺手为之。
- **D5 历史档案不迁移**：`docs/adr/**`、`wiki/prd/**`、`wiki/raw/` 历史文件、`TASK.md` 行文
  不改写——行使本文件上节（前置门禁注记）授予 SA1/SA2 的裁量并已闭环；ADR-0007 L14 更名
  决策本身须两名并陈，docs/adr 零旧名在逻辑上不可达。
- **D6 SA6 双文件零改动**：`validate-logical-snapshot.test.ts`（29 条红灯锚）与
  `validate-logical-snapshot.contract.ts`（27 条共享断言集，非 `*.test.ts` 不被 vitest 收集）
  一个字符不动（简报 SA3 迁移提示明示）。
- **D7 版本 bump**：`packages/vfsl` 0.1.10 → 0.2.0（删除公共导出 = semver 破坏性变更纪律
  信号；无 ADR/CONTEXT 条款约束版本纪律）。
- **D8 CONTEXT.md 不动**：术语条目已终态（规范名 + `_Avoid_` 含旧名是执行机制）。
- **D9 单提交原子迁移**：全改动一次 commit，落地前过设计 §6 三门 G1（代码面符号 grep 全零，
  白名单仅 SA6 双文件）/ G2（活文档 grep 全零）/ G3（`pnpm test` + `pnpm typecheck`）。

SA3 执行硬禁令（设计 §8 复述）：不加 alias；不动函数体与消息字面量；不动 SA6 双文件；不动
docs/adr、wiki/**、TASK.md、CONTEXT.md；不改任何文件名；不改局部变量名。

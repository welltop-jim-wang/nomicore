# SA6 诊断与验收契约报告 — issue #267：REST router 骨架（Hub create 成功路径 + Peer role gate + Lease 生命周期）

> 阶段：acceptance-contract（Feature 红灯固化，iteration 2；iteration 1 原位修订并收尾）。
> 前置：SA8 冲突门禁 `clear`（`wiki/raw/task_issue-267_conflict_report.md`）+
> `requiresConflictRecheck: true`（B-1/B-2/B-3 待设计后复审）。
> Issue comments REST snapshot：空（`[]`）——无 Owner 追加要求、无 override 授权。
> 结论：能力缺口已实证——当前 HEAD 无 `@nomicore/namespace-api` 包、无 REST router 任何实现；
> 35 个用例（30 契约用例 + 5 支撑/负控绿锚；其中 create 契约按 MemoryPersistence 与
> FilePersistence 参数化双跑）已固化为**可执行红灯契约**：
> 清空临时诊断件后 `3 failed | 1 passed`（红灯基线 3/3 复跑逐位一致），红灯只来自
> `../src/rest.js` 模块缺失与 `package.json` 未建立两处能力缺口；同一契约在临时
> 「未来绿灯模拟件」下 **35/35 全绿**（可满足性），10 例定点变异 **全部被目标断言捕获**
> （断言敏感性），模拟件已清理并留下哈希/清理证据。
> Verdict：**`approve`**（详见 §17）。

## 0. 交付物

| 文件 | 内容 | 状态 |
|---|---|---|
| `packages/namespace-api/test/rest-contract-harness.ts` | 契约共享 fixture/harness：真实 MemoryPersistence/FilePersistence + 真实 Registry testing 入口；观测包装（create 输入/lease release 计数/DTO 复制探针）、poison registry（零触达）、trapped Request（body 零消费）。非 `*.test.ts`，不被 vitest 收集 | 新增（iteration 1 建，本轮注释原位修订） |
| `packages/namespace-api/test/rest-create-hub-contract.test.ts` | Hub 成功路径契约：AC1/AC3/AC4/AC5，MemoryPersistence 与 FilePersistence 双跑（8 用例 × 2 适配器 + 1 File-only durability = 17 用例） | 新增（红灯） |
| `packages/namespace-api/test/rest-role-gate-routing-contract.test.ts` | Peer role gate 顺序 + route/method 匹配 + 构造配置门（12 用例） | 新增（红灯） |
| `packages/namespace-api/test/rest-contract-support.test.ts` | 契约支撑负控/绿锚：同一 SCHEMA envelope 直接经 Registry.create 双适配器走通、Request 构造自证（5 用例，恒绿） | 新增（绿） |
| `packages/namespace-api/test/rest-public-seam-wiring.test.ts` | `./rest` 公共 seam 接线锚（manifest + 源文件存在性；非行为替代）（1 用例） | 新增（红灯，能力缺口锚） |
| `wiki/raw/task_issue-267_sa6_contract.md` | 本报告 | 新增 |

无生产实现改动；无 commit/push/PR。临时诊断件（iteration 1 的「未来绿灯模拟件」）已删除，见 §16。

## 1. Task type and inputs

- **任务类型：Feature**（ADR 0015 的 `@nomicore/namespace-api` REST vertical 本体兑现，不是 Bug 修复）。
  因此本契约证明**能力缺口**并固化目标行为，不虚构 Bug 根因。
- 输入（固定位置）：
  - 任务简报 `wiki/raw/task_issue-267.md`（issue #267，State: open，updated 2026-09-10T17:00:20Z；
    Parent = PR #158 `docs/rest-namespace-create`；Blocked by #266；AC1–AC6）；
  - 派发记录 `wiki/raw/task_267_dispatch.md`（唯一上游 SA8 phase 记录：conflict-gate iter 0，
    Issue comments REST snapshot: none (`[]`)）；
  - 相关决策摘录 `wiki/raw/task_issue-267_relevant_decisions.md`（ADR 0015 §1.1–1.7、ADR
    0009/0010/0012/0006、CONTEXT.md 词条、工程门）；
  - 冲突门禁报告 `wiki/raw/task_issue-267_conflict_report.md`（verdict `clear`，13 项
    implements-existing-decision/no-conflict，0 evolution-required、0 hard-conflict；
    冻结面 9 项；移交 B-1/B-2/B-3 三项边界条件）；
  - governing 决策：`docs/adr/0015-vertical-rest-namespace-create.md`（提议）；
    `docs/adr/0009/0010/0012/0006`（已接受）；根 `CONTEXT.md`；
  - 上游代码事实：`packages/vfsl/src/index.ts` 公共 `deriveSchemaIdentity(text)`（#266 已交付，
    HEAD `8fa85d2`）、`packages/namespace-registry` 公共 `NamespaceRegistry.create({owner,schema,root})`
    与 `NamespaceLease`、`@nomicore/persistence` 的 `MemoryPersistence` / `FilePersistence`。
- 仓库基线：HEAD `8fa85d2`（`fix(#266): … (#276)`），branch `mabf/issue-267`
  （= `origin/docs/rest-namespace-create`）；`packages/namespace-api` 目录下**无任何生产文件**
  （`git grep namespace-api` 仅命中 docs/wiki 文本）。
- 迭代历史（诚实记录）：
  - iteration 0：SA8 冲突门禁（`clear`）+ 相关决策摘录；无设计文档（`task_issue-267_design.md`
    不存在）、无既有 SA6 报告。
  - iteration 1：落契约测试 4 文件 + harness，并落一个自标注「临时诊断件（SA6 未来绿灯模拟）
    — 非交付、非设计产物；跑完即删」的最小 router（`packages/namespace-api/src/rest.ts`、
    `src/index.ts`、`package.json`），用其证明契约可满足；随后中断，未写报告、未清理。
  - iteration 2（本报告）：原位修订测试注释与证据链，重建红/绿对照与变异矩阵，**清理模拟件**，
    复跑红灯基线与发现性入口。

## 2. Owner comment mapping

| Owner 输入 | 内容 | 契约落实 |
|---|---|---|
| Issue comments REST snapshot | **空（`[]`）** | 无 Owner 追加要求/override 可映射；验收口径 = 简报 AC1–AC6 + ADR 0015 条款 |
| 简报 What to build | 包/子路径/普通 Module/判别结果/构造冻结/TypeError；Hub create 纵向骨架；Peer 403 顺序；Lease 语义 | §12 逐条映射，全部落为运行时断言 |
| 简报 AC1–AC6 | 201 恰含 namespaceId + schema identity（`sc1-`）／Peer 403 + `INSTANCE_ROLE_FORBIDDEN` 不解析 owner 不读 body／Memory+File 双持久化同契约／DTO 复制先于 release、release 恰一次、失败仍 201／新建 `replication-disabled`／route 大小写敏感 + 无尾随斜杠 + 405 `Allow: POST` | §12（覆盖 6/6） |
| 简报「本票只做成功路径与 role gate」（延后项） | 请求形状校验、limits、Registry 失败映射、observer 事件契约 | 契约**不**断言延后项行为；只按 SA8 B-2 冻结 observer 构造参数存在性（显式 no-op） |

## 3. SA8 constraints（本契约的落实）

| SA8 约束 | 本契约落实 | 证据 |
|---|---|---|
| B-1 role 单真相（role 值须同源自 composition root 的 Instance identity） | 测试只消费构造注入的 `role: 'hub' \| 'peer'`（H1），不制造第二份 role 配置；role 来源核对属设计后复审项，契约不越权断言 | `rest-role-gate-routing-contract.test.ts` peerRouter/hubRouter |
| B-2 构造面冻结：必须显式注入两个同步 void observer（no-op 须显式） | 构造门契约要求缺失 `metricsObserver` / `diagnosticObserver` 任一 → 普通 `TypeError`；显式 no-op 可构造成功 | 「构造配置错误抛普通 TypeError」用例 |
| B-3 固定顺序不被骨架 reorder | 已实测：method gate 先于 role gate（Peer 非 POST → 405，M10 变异被捕获）；role gate 先于 owner 解析/body 读取（无 body、`text/plain`、percent-encoded owner、trapped body 四路仍 403，M1 变异被捕获）；success DTO 复制先于 release（M3）；`release()` settle 先于 Response 返回（M2） | §9 变异矩阵 |
| 冻结面：201 形状（恰 `namespaceId` + `schema{lang,version,id}`，无 `Location`） | 键集排序深比较 + `location === null` + `sc1-` 正则 + 与 `deriveSchemaIdentity` 逐字一致 | AC1 用例 |
| 冻结面：`sc1-` 格式（52 位小写 Base32 无 padding） | 只消费 #266 公共窄接口 `deriveSchemaIdentity`，不重算 digest、不锁内部实现 | AC1 用例 + 支撑文件 |
| 冻结面：`INSTANCE_ROLE_FORBIDDEN` / 405 + `Allow: POST` | 逐字断言 code / 状态 / Allow 头 | AC2/AC6 用例 |
| 冻结面：Registry 公共面与 Lease 契约不变 | 全部经 `NamespaceRegistry` 公共接口与 Registry 受控 testing 入口；不读 entry map / Runtime / Y.Doc 私有对象 | harness（观测包装只走公共成员） |
| 冻结面：新建 namespace 默认 `replication-disabled` | `lease.getStatus().runtime.replication === {state:'disabled'}` + `openReplicationSession` → `REPLICATION_NOT_ENABLED`（ADR 0010 #134 O-7） | AC5 用例 |
| 流程项（ADR 0015 提议→已接受、新包 AGENTS.md） | 非 SA6 权限范围，登记给总控/后续阶段（§15） | — |

## 4. Environment and baseline

- 运行环境：node `v24.13.0`、pnpm `10.28.2`、vitest `3.2.7`、TypeScript `5.9.3`；
  依赖已安装（本地 store），无网络访问需求。
- 测试入口（仓库真实入口）：根 `package.json` `test = NODE_OPTIONS=--conditions=nomicore-source
  vitest run --typecheck`；根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', …]`，
  `maxWorkers: 1`；`@nomicore/*` 经 vitest `resolve.alias` 指向各包 `src/index.ts` /
  `src/testing.ts`（无需包级 node_modules 链接）。
- 工作树基线：契约测试 5 文件（4 `*.test.ts` + 1 harness）为本票唯一改动；
  `packages/namespace-api/` 下无 `package.json`、无 `src/`（§16 清理后复核）。
- 现有测试基线：本契约文件之外无任何改动；支撑文件在同一次红灯跑中 5/5 绿，证明
  Registry/Persistence/VFSL/Request 既有能力在 HEAD 可用（§6）。

## 5. Positive reproduction（Feature 能力缺口：目标断言红灯）

命令（仓库真实入口 + 路径过滤）：

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/namespace-api/test
# 等价入口（含 --typecheck，root pnpm test 同款）：
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
```

实测（两次入口结果一致，exit=1）：

```
 ✓ packages/namespace-api/test/rest-contract-support.test.ts (5 tests) 28ms
 ❯ packages/namespace-api/test/rest-public-seam-wiring.test.ts (1 test | 1 failed) 3ms
   × issue #267 公共 seam 接线契约（ADR 0015 L18） > REST Adapter 由 ./rest 子路径暴露，nomicore-source 条件指向存在的源文件
     → 能力缺口：packages/namespace-api/package.json 不存在（@nomicore/namespace-api 尚未建立）

⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯
 FAIL  packages/namespace-api/test/rest-create-hub-contract.test.ts
 Error: Cannot find module '../src/rest.js' imported from '…/rest-create-hub-contract.test.ts'
 FAIL  packages/namespace-api/test/rest-role-gate-routing-contract.test.ts
 Error: Cannot find module '../src/rest.js' imported from '…/rest-role-gate-routing-contract.test.ts'

 Test Files  3 failed | 1 passed (4)
      Tests  1 failed | 5 passed (6)
Type Errors  no errors
```

- 红灯分布：2 个行为契约 suite 因 `packages/namespace-api/src/rest.ts` 不存在而整文件构造性红灯
  （同 #266 窄接口契约先例：静态 import 尚不存在模块）；1 个接线锚以显式能力缺口消息红灯；
  1 个支撑/负控 suite 绿。
- 该红**不是**环境/fixture/超时/入口错误：同一入口下支撑 suite 5/5 绿、`Type Errors: no errors`、
  无未处理拒绝噪声；§9 的可满足性实验证明把最小实现放回 `src/rest.ts` 后 35/35 全绿。

## 6. Negative control（相近负控，恒绿）

1. **支撑负控文件** `rest-contract-support.test.ts`（不 import router，5 用例，红灯基线下 5/5 绿）：
   - `deriveSchemaIdentity(SCHEMA_TEXT)` → `ok:true` 且 `schemaId` 命中 `^sc1-[a-z2-7]{52}$`（身份锚）；
   - 同一 SCHEMA envelope/root 直接 `Registry.create`（ADR 0015 step 7 的下游）在
     MemoryPersistence 与 FilePersistence 上成功：lease active、`replication === {state:'disabled'}`、
     `openReplicationSession` → `REPLICATION_NOT_ENABLED`、release 后 `{lease:'released',runtime:null}`、
     后续 `open` 读回 `title='hello'` 与原文 `SCHEMA.text`；
   - FilePersistence 重启后同一 namespace 仍可 open（durability 下限）；
   - 契约 `Request` 是标准 Web `Request`（url/method/headers/body 可读；percent-encoded owner 在
     URL 中保持 raw 形态）。
2. **变异矩阵中的 `none` 对照**：不施加任何变异的探针链 → 34/34 绿（探针本身不产生红）。
3. **M10 反向顺序对照**：把 role gate 上移到 method gate 之前 → 恰 1 例红
   （Peer 非 POST 405 用例），证明顺序断言不是恒真。
详见 §9/§13。

## 7. Stability, scale and timing

- **红灯稳定性**：同一命令连续 3 次 → `Test Files 3 failed | 1 passed (4)` 逐次一致
  （Tests `1 failed | 5 passed`，`Type Errors: no errors`）。
- **绿灯可满足性稳定性**：模拟件存在时整包 35/35 绿（4/4 文件），两次运行一致；
  变异矩阵 11 次运行（`none` + 10 变异）结果确定、无抖动。
- **时序/规模条件**：全套 <2s；无 sleep、无轮询等待；FilePersistence 使用 tmpdir 真实
  文件系统与受控 scheduler（`advanceBy` 确定性推进），每个用例 `finally` 关闭 registry/
  persistence 并删除临时目录；release-await 用例用 5s 上限的 `setImmediate` 自旋 +
  release 门 promise（不是固定 sleep），红灯/绿灯都确定。
- **无竞态/无规模依赖**：本票不涉及吞吐/并发契约；单 namespace 顺序路径。

## 8. Capability gap（替代 Bug 根因链）

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | `packages/namespace-api/test` 行为契约红灯 | §5 实测输出 | 确证 |
| 直接故障点 | `packages/namespace-api/src/rest.ts` 不存在 → `createRestRouter` 无任何导出 | `Cannot find module '../src/rest.js'`；`git grep namespace-api` 仅 docs/wiki | 确证 |
| 包装线缺口 | `packages/namespace-api/package.json` 不存在 → `./rest` 公共 seam 未建立 | 接线用例显式错误消息 | 确证 |
| 触发条件 | 任何消费 `Request → Response` REST create seam 的调用（本票 AC1–AC6） | 契约测试 4 文件 | 确证 |
| 最深根因 | ADR 0015 的 REST vertical 本体（包、router、create 编排、role gate、Lease 编排）**尚未实现**；不是缺陷回归 | HEAD `8fa85d2` 无该包；ADR 0015 为「提议」随 PR #158 在途 | 确证 |
| 放大因素 | 上游 Blocked-by #266 已合入（`deriveSchemaIdentity` 可用）⇒ 唯一缺口就是本票范围 | `packages/vfsl/src/index.ts` 公共导出（#266/PR #276） | 确证 |
| 未证实假设 | H1–H4 契约假设（构造签名/判别结果/`src/rest.ts` 布局/身份取值），待 SA1/SA2 仲裁 | §12 头注 | 待设计确认（不阻塞红灯） |
| 排除项 | 环境、依赖安装、fixture、Persistence 适配器、VFSL 接口、Request 构造、测试入口 | §11 | 确证 |

结论：这是 **Feature 能力缺口**，不是 Bug；契约红灯的方向正确（缺失模块/缺失包接线），
且失败点只落在本票目标面。

## 9. Causal experiments

### E1 可满足性（绿灯模拟，因果对照：唯一变量 = 模块是否存在）

- 方法：把按 ADR 0015 最简形状的临时 router 放回 `packages/namespace-api/src/rest.ts`
  （+ 同批诊断件 `src/index.ts`、`package.json`；自标注「非交付、跑完即删」），**测试文件字节不变**。
- 结果：`Test Files 4 passed (4)` / `Tests 35 passed (35)` / `Type Errors: no errors`。
- 推论：红/绿唯一差异 = 模块存在性 ⇒ 红灯因果归因于能力缺口，而非测试缺陷/环境。
- 清理：模拟件哈希 `rest.ts f5245ee6…`、`index.ts 92d41609…`、`package.json f84c0d16…`；
  运行后删除（§16）。

### E2 断言敏感性（定点变异矩阵，10 例）

探针：对模拟件做定点文本替换（`old` 必须恰好出现一次，杜绝静默错变异），逐例重跑
`rest-create-hub-contract` + `rest-role-gate-routing-contract` + `rest-contract-support`
（34 用例），记录失败用例集合。

| # | 变异（对 ADR 0015 条款的反证） | 被捕获断言 | 失败数 |
|---|---|---|---|
| M1 | role gate 下移到 body 读取之后（破坏 step 2 先于 3/4） | Peer 无 body 403／`text/plain` 403／trapped body 零消费 | 3 |
| M2 | `release()` 不 await（破坏 step 9 等待语义） | AC4/step 9「Response 在 release settle 之后才返回」 | 2（双适配器） |
| M3 | success DTO 在 release 之后才读取（破坏 step 8 复制前移） | AC4/step 8「release 后变异不进入 response」 | 2 |
| M4 | 完全不调用 `release()`（破坏「恰一次」） | AC4 恰一次/等待/release 失败组 | 6 |
| M5 | 重复调用 `release()`（破坏「恰一次」） | AC4「恰一次且真进入 released 通道」 | 2 |
| M6 | 405 缺少 `Allow: POST` | AC6 + AC2/step 1 两处 405 断言 | 2 |
| M7 | regex 接受尾随斜杠（破坏 canonical path） | AC6「尾随斜杠/非 canonical 不匹配」 | 1 |
| M8 | regex 加 `i` 旗标（破坏大小写敏感） | AC6 两处不匹配断言 | 2 |
| M9 | response schema id 改为伪 `sc1-` 常量（破坏派生身份） | AC1 形状/`create` 输入/AC3 open 与 durability（身份一路传导） | 7 |
| M10 | role gate 上移到 method gate 之前（破坏 step 1 先于 step 2） | AC2/step 1「Peer 非 POST 仍 405」 | 1 |
| — | 无变异（对照） | —（34/34 绿） | 0 |

- 每例变异都被**目标断言**捕获，且失败集合与因果预期一致；无「变异后仍全绿」的断言盲区。
- 敏感度覆盖：HTTP 状态/头/形状（M6–M9）、编排顺序（M1/M3/M10）、Lease 生命周期与次数
  （M2/M4/M5）、route 匹配（M7/M8）。

### E3 边界未被 mock；观测纪律

- harness 不用假 Registry：create 路径全部走真实 `NamespaceRegistry`（Memory/File 真实 adapter）；
  只在公共 seam 外层做观测包装（记录输入、包装 lease 的 release 计数/门/失败注入/DTO 变异探针）。
- `createPoisonRegistry`（任何成员调用即 throw）证明未匹配 route / 405 / Peer 403 分支**零 Registry 触达**；
- `trappedBodyRequest`（body 消费成员被调用即记录并 throw）证明 Peer 403 前**零 body 读取**；
- 不读 Registry entry map / Runtime / Y.Doc 私有对象（ADR 0015 §测试决策 + ADR 0009）。

## 10. Impact surface

- 新增测试面：`packages/namespace-api/test/`（5 文件）。**零生产实现改动**（`git status` 证据）。
- 既有公共面零修改：`@nomicore/vfsl`（只消费 `deriveSchemaIdentity`）、`@nomicore/namespace-registry`
  （只消费公共 `open/create` 与 lease 成员、testing 入口）、`@nomicore/persistence`（只消费
  Memory/File adapter 与 testing scheduler）、`@nomicore/instance`（role 类型只读）。
- 实现落地（SA3）后预期变化：本目录 2 个行为 suite + 1 个接线锚转绿；支撑 suite 恒绿。
- 延后项（本票不断言，后续 ticket 叠加）：请求形状校验（owner 文法/percent-encoding/query/
  Content-Type/Encoding/body 上限）、limits、Registry 失败映射、observer **事件**契约、
  `Location` 之外的后续资源面。
- 流程项（登记，不属 SA6）：ADR 0015 状态由「提议」翻「已接受」；`packages/namespace-api/AGENTS.md`
  按 12 个既有包惯例建立（SA8 §8 移交项）。

## 11. Ruled-out hypotheses

| 假设 | 排除证据 |
|---|---|
| 红灯由依赖缺失/别名解析导致 | 支撑 suite 在同一次运行 5/5 绿；`@nomicore/vfsl`、`/namespace-registry(/testing)`、`/persistence(/testing)` 全部解析成功；`Type Errors: no errors` |
| 红灯由 fixture/Persistence adapter 缺陷导致 | 双适配器（Memory + File，含重启 durability）在支撑文件与模拟件绿灯跑中全绿 |
| 红灯由测试入口/配置错误导致 | `vitest list --filesOnly packages/namespace-api` 列出 4 个 `*.test.ts`；根 include 命中；无 tsconfig/typecheck 阻塞（`--typecheck` 入口同样只红在契约面） |
| 红灯由超时/flake/竞态导致 | 3/3 复跑逐位一致；无 sleep；release 门用显式 promise；全套 <2s |
| 伪绿（临时模拟件残留把契约点绿） | 模拟件已删除；最终树 `packages/namespace-api` 仅剩 test 文件；红灯复跑 3/3 |
| 伪红（测试自身 import 写错路径） | E1：把实现放到 `src/rest.ts`（H3 路径）后 35/35 绿，证明 import 指向正是契约要求的 seam；E2 变异全部定向捕获 |
| 源码字符串/正则断言替代行为验证 | 行为断言全部观测运行时（HTTP 状态/头/body、Registry 公共输入、lease 状态）；唯一读文件的是接线锚（读 `package.json` manifest + 源文件存在性），显式声明为非行为替代 |
| skip/only/todo/env override/吞错制造伪结果 | `grep -nE '\.(only|skip|todo)\(|process\.env' packages/namespace-api/test/*.ts` → 无命中；无 `--conditions` 之外的 env 注入（`--conditions` 是仓库 `pnpm test` 既有条件） |

## 12. Acceptance contract and test paths

### 12.1 契约假设（PROPOSAL，待 SA1/SA2 仲裁；若设计另有裁决须回写测试并走修订轮）

- **H1**：`@nomicore/namespace-api/rest` 导出 `createRestRouter(options)`，
  `options = { role, registry, metricsObserver, diagnosticObserver, limits? }`（ADR 0015 L22–28）；
- **H2**：`router.handle(request): Promise<{matched:false} | {matched:true; response}>`
  （ADR 0015 L32「判别结果表达 route 是否匹配」）；
- **H3**：`./rest` 子路径背后的模块文件为 `packages/namespace-api/src/rest.ts`
  （镜像既有包 `src/testing.ts` 承载 `./testing` 的布局惯例）；
- **H4**：201 的 schema identity 取自 step 6 派生的 envelope；namespaceId 取自
  `Registry.create` 返回的 lease（201 不表示 P0 ready / 不表示复制启用）。

### 12.2 AC → 断言映射

| 简报 AC | 断言（行为级） | 测试文件 |
|---|---|---|
| AC1 Hub 完整走通、201 恰含 namespaceId + `sc1-` schema identity | 状态 201、`content-type: application/json`、`location` 为 null、body 键集恰 `{namespaceId,schema}`、`schema` 键集恰 `{id,lang,version}`、`lang='vfsl'`、`version=1`、`id` 命中 `^sc1-[a-z2-7]{52}$` 且与 `deriveSchemaIdentity(SCHEMA_TEXT).schemaId` 逐字相等；`Registry.create` 恰一次收到 `{owner:{userId},schema:{lang,version,id,text:原文},root}`（step 6–7） | `rest-create-hub-contract.test.ts` |
| AC2 Peer 匹配后立即 403 + `INSTANCE_ROLE_FORBIDDEN`，不解析 owner、不读 body | 无 body / `text/plain` / percent-encoded owner / malformed body+trapped 四路均 403 且 code 逐字；poison registry 零触达；未匹配 route → `matched:false`；Peer 非 POST → 405（method gate 先于 role gate） | `rest-role-gate-routing-contract.test.ts` |
| AC3 同一契约在 Memory 与 File 上运行；断言 HTTP 结果、持久化事实、Lease 释放、后续 open；不读内部结构 | 两适配器参数化全部用例；`release` 后 lease `{lease:'released',runtime:null}`；后续 `registry.open` 读回 ROOT 与原文 `SCHEMA.text`；File 分支加重启 durability；只经公共接口 | 两个契约文件（参数化 `MemoryPersistence` / `FilePersistence`） |
| AC4 DTO 在 release 前复制；release 恰一次；失败仍 201 | release 后 namespaceId 变异哨兵不进入 response 且 response id 仍可 open；`releaseCalls === 1`；gate 场景 Response 在 release settle 后才返回；注入 release 失败 → 仍 201、仍恰一次、lease 已 released | `rest-create-hub-contract.test.ts` |
| AC5 新建 namespace 为 `replication-disabled` | `getStatus().runtime.replication === {state:'disabled'}`；`openReplicationSession` → `{ok:false, code:'REPLICATION_NOT_ENABLED'}` | `rest-create-hub-contract.test.ts` |
| AC6 route 大小写敏感、仅无尾随斜杠 canonical path；已知 path 非 POST → 405 + `Allow: POST` | `GET/PUT/PATCH/DELETE/OPTIONS` → 405 + `allow: POST`（Hub 与 Peer 两处，零 Registry 触达）；`V1`/`Namespaces`/尾随斜杠/额外段/短路径 → `matched:false`；大小写变体 + 非 POST 同样不匹配（path 匹配先于 method 判定） | `rest-role-gate-routing-contract.test.ts` |
| 简报 What to build（构造面） | 非法 role / 缺 options / 缺任一 observer → 普通 `TypeError`（B-2）；构造后改写调用方 `options.role` 不改变行为（构造时复制） | `rest-role-gate-routing-contract.test.ts` |
| ADR 0015 L18（公共 seam） | `exports['./rest']` 存在且 `nomicore-source` 指向存在的源文件（接线锚，非行为替代） | `rest-public-seam-wiring.test.ts` |

### 12.3 测试路径

```
packages/namespace-api/test/rest-contract-harness.ts            （fixture，非测试）
packages/namespace-api/test/rest-create-hub-contract.test.ts
packages/namespace-api/test/rest-role-gate-routing-contract.test.ts
packages/namespace-api/test/rest-public-seam-wiring.test.ts
packages/namespace-api/test/rest-contract-support.test.ts       （负控/绿锚）
```

## 13. Red/green or baseline evidence

### 13.1 最终红灯基线（清理模拟件后，最终测试字节）

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/namespace-api/test
 Test Files  3 failed | 1 passed (4)
      Tests  1 failed | 5 passed (6)
Type Errors  no errors
# 3 次复跑逐位一致；exit=1
```

红灯点：
- `rest-create-hub-contract.test.ts` → `Cannot find module '../src/rest.js'`（整文件构造性红灯）；
- `rest-role-gate-routing-contract.test.ts` → 同上；
- `rest-public-seam-wiring.test.ts` → `能力缺口：packages/namespace-api/package.json 不存在`；
- `rest-contract-support.test.ts` → 5/5 绿（恒绿锚）。

### 13.2 可满足性绿灯锚（临时模拟件，测试字节不变）

```
 Test Files  4 passed (4)
      Tests  35 passed (35)
Type Errors  no errors
```

### 13.3 变异矩阵（最终测试字节复跑）

`none 34/34 绿`；M1..M10 分别 3/2/2/6/2/2/1/2/7/1 例红，且全部为 §9 表列目标断言。
无「变异后仍全绿」的断言。

### 13.4 最终测试文件哈希（sha256）

```
0549f11bd8ace50f2436d3d17dfec43e19e1459d286f436ee6caf830cbe66581  rest-contract-harness.ts
b812b38b1f91ce0d9875f30354b2f318cabbf41c41c224c03c1a3fe8d01abaf5  rest-contract-support.test.ts
181449a069211e127b7cce905692c4633823259485d8f4987fa101eb6bb611ee  rest-create-hub-contract.test.ts
e61a23eb7eaa108e6810c516b78610150cd5fa69b124c48bf53067a81d9ba87d  rest-public-seam-wiring.test.ts
1010b6169e92c2127a400db1a842d0fa06a661e2314c9f72608a4ae1f9320794  rest-role-gate-routing-contract.test.ts
```

iteration 1 与 iteration 2 的差异仅在文件头注释（状态/证据引用），断言体未变；红灯、绿灯、
变异三组证据均在最终字节上复跑。

## 14. Runner trigger evidence

- 发现性（根配置 include `packages/*/test/**/*.test.ts`）：

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest list --filesOnly packages/namespace-api
packages/namespace-api/test/rest-contract-support.test.ts
packages/namespace-api/test/rest-create-hub-contract.test.ts
packages/namespace-api/test/rest-public-seam-wiring.test.ts
packages/namespace-api/test/rest-role-gate-routing-contract.test.ts
```

- `rest-contract-harness.ts` 未被收集（fixture 身份正确）。
- 仓库真实入口触发（含 `--typecheck`，与根 `pnpm test` 同款参数）：

```
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
 Test Files  3 failed | 1 passed (4)
      Tests  1 failed | 5 passed (6)
Type Errors  no errors
```

- 无 skip/only/todo；无 env override（`--conditions=nomicore-source` 是仓库 `pnpm test` 既有条件，
  非契约专用开关）；无吞错/软化断言。

## 15. Unknowns and blockers

- **设计文档尚未产出**（`wiki/raw/task_issue-267_design.md` 不存在）：H1–H4 是契约假设，
  必须由 SA1 设计与 SA2 评审确认；若设计裁定不同（如 handle 返回形状、subpath 源文件布局），
  测试须走修订轮同步，不能由实现方擅自改契约。
- **B-1（role 单真相）**：契约只断言构造注入值的行为，无法在测试层证明 role 值来自 composition
  root 的 Instance identity；该点留给设计后 SA8 复审。
- **B-2 延后边界**：本票契约只冻结「两个 observer 构造参数必须显式存在」，不断言事件发射；
  observer 事件契约由后续 ticket 叠加。
- **延后行为不测**：owner 文法/percent-encoding/query/Content-Type/body 上限/limits/Registry 失败
  映射（本票范围外）；Hub 对非法请求形状的行为留待后续 ticket，避免提前锁死。
- **迭代 1 遗留的假设来源已核实**：模拟件为 SA6 自建诊断件（非 SA3 交付），其删除不影响任何
  设计/实现事实；`packages/namespace-api` 目前只有测试面，SA3 需一并建立 `package.json`、
  `src/rest.ts` 与包级 `AGENTS.md`。
- 无阻塞红灯契约建立的环境或事实缺口。

## 16. Temporary diagnostics cleanup

| 临时件 | 处理 | 证据 |
|---|---|---|
| `packages/namespace-api/src/rest.ts`（未来绿灯模拟 router） | **已删除** | 删除前 sha256 `f5245ee6f0e137628fd3c479ea84f9b025c8a705af57dda0da04df88a4072c1c`；最终 `find packages/namespace-api -type f` 无 `src/` |
| `packages/namespace-api/src/index.ts`（模拟件再导出，自标注临时） | **已删除** | 删除前 sha256 `92d4160946b604b5f253d0236143cb2b4aeae731121442fa87080eebcd5d32cc` |
| `packages/namespace-api/package.json`（模拟件接线） | **已删除** | 删除前 sha256 `f84c0d16617fed17bd418efacd65165e652846d381af7855b05b0b5b95a83ac6` |
| 变异探针脚本（`mutate.py` + 运行器 + 原始备份） | 仅存在于 worktree 之外 `/tmp/sa6-267-evidence/`，不进交付树 | `git status` 无相关条目 |

清理后复核：`packages/namespace-api` 仅 5 个 test 面文件（§13.4 哈希）；红灯基线 3/3 复跑一致；
无 `nohup`/`setsid`/PID/轮询 marker；无后台服务残留（测试全部同步收尾，FilePersistence
临时目录经 `mkdtemp` + `rm(recursive)` 清理）。

## 17. Verdict

**`approve`**

- 能力缺口可信且因果闭合：唯一变量实验（同一测试字节 + 有/无实现模块）给出红→绿对照；
  10 例定点变异证明断言对 ADR 0015 各条款敏感；相近负控恒绿；3/3 复跑稳定。
- 契约可执行且被仓库真实入口发现（`vitest list` + `--typecheck` 入口）。
- 红灯只落在本票目标面（缺失的 router 模块与包接线），`Type Errors: no errors`，无伪红/伪绿。
- 临时诊断件已清理，工作树交回测试面 + 本报告。

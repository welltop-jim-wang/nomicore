# 设计文档 — issue #267：REST router 骨架（Hub create 成功路径 + Peer role gate + Lease 生命周期）

> SA1（mabf-sa1）设计产物，iteration 0。任务 worktree：`/home/wangjian/nomicore-fix-issue-267`
> （branch `mabf/issue-267`，HEAD `8fa85d2`）。
> 上游输入（固定位置，全部已读）：任务简报 `wiki/raw/task_issue-267.md`（Issue #267，
> State: open，updated 2026-09-10T17:00:20Z；**Issue comments REST snapshot 为空 `[]`，无 Owner
> 追加要求、无 override 授权**）；SA6 验收契约 `wiki/raw/task_issue-267_sa6_contract.md`
> （verdict `approve`，35 用例红灯契约已固化）；SA8 决策摘录
> `wiki/raw/task_issue-267_relevant_decisions.md` 与冲突门禁
> `wiki/raw/task_issue-267_conflict_report.md`（verdict `clear`，`requiresConflictRecheck: true`，
> 边界条件 B-1/B-2/B-3）。无既有 `task_issue-267_design.md`（本文件为初版）；SA2 评审已在
> 迭代 0 后续产出（`approve`，0 BLOCKER / 0 MAJOR / 4 MINOR），Finding 修订映射见 §14。

## 1. 任务类型、目标与非目标

**任务类型：Feature（能力兑现型切片，非 Bug 修复）**——ADR 0015《纵向 REST namespace create 与
内容寻址 schema ID》（状态：提议，随集成 PR #158 在途）设计的 `@nomicore/namespace-api` REST
vertical 本体在 HEAD 上完全缺失（SA6 §8 能力缺口已实证）。

**目标**：

1. 建立 `@nomicore/namespace-api` 包：REST Adapter 由 `./rest` 子路径暴露，首版只公开 REST
   router；create 编排保持包内私有（ADR 0015 L18）。
2. Router 是 Host 无关的普通 Module（非 Cordis plugin），标准 Web `Request → Response` 接口 +
   判别结果（discriminated result）表达 route 是否匹配；不拥有 listener、authentication、
   authorization、CORS、TLS、Request ID、全局并发、graceful drain（ADR 0015 L20–32）。
3. `POST /v1/owners/{ownerUserId}/namespaces` 纵向骨架：Hub 上完整走通 route/method 匹配 →
   role gate → 派生 schema identity → 组装完整 SCHEMA envelope → `Registry.create({owner,
   schema, root})` → 成功 201（恰含 `namespaceId` 与 `schema{lang,version,id}`，不返回
   `Location`）。Peer 相同 route 形状，在匹配 method/raw path 后、解析 owner 或读取 body 前
   返回 403 + 稳定 code `INSTANCE_ROLE_FORBIDDEN`。
4. Lease 编排：成功后先把 namespaceId 与 schema identity 复制为 owned plain DTO，再恰一次
   调用并等待 `lease.release()`；release 失败不改变已知创建事实（仍 201、不重复 release）。
5. 构造面：配置构造时读取、校验、复制并冻结；构造配置错误用普通 `TypeError`；两个同步 void
   observer 必须显式注入（no-op 须显式）。
6. 让 SA6 已固化的 35 用例红灯契约（`packages/namespace-api/test/` 5 文件）整体转绿，且恒绿
   支撑文件保持绿。

**非目标（本票明确延后，后续 ticket 叠加；SA6 契约已按同口径不断言）**：

- 请求形状校验（owner 安全文法/percent-encoding 拒绝/query 拒绝/Content-Type 415/
  Content-Encoding/顶层形状/数字范围）与 limits（body/schemaText/depth/nodes/issues 预算与
  `Request.signal` 中断语义）；
- Registry 失败映射（422/503/500 problem shape、issues 截断）与 observer 事件契约（事件形状、
  发射时机、throw 隔离）；`Location` 之外的后续资源面；
- ADR 0015 状态由「提议」翻「已接受」（阶段收官流程项，Controller/Host 所有，SA8 冲突报告
  行 11 + SA6 §10 已登记）。

## 2. 当前行为与证据锚点（HEAD `8fa85d2`）

| # | 事实 | 锚点 |
|---|---|---|
| 1 | `packages/namespace-api/` 只有 SA6 交付的 5 个 test 面文件；无 `package.json`、无 `src/`、无 `AGENTS.md` | `git status`（untracked `packages/namespace-api/`）；SA6 §4/§16 |
| 2 | 红灯基线：`3 failed \| 1 passed`（2 个行为 suite 因 `Cannot find module '../src/rest.js'` 构造性红灯；1 个接线锚红灯「package.json 不存在」；支撑文件 5/5 绿）；3/3 复跑一致，`Type Errors: no errors` | SA6 §5/§13.1；命令 `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/namespace-api/test` |
| 3 | 上游窄接口已交付（Blocked-by #266 已合入）：`deriveSchemaIdentity(text)` → `{ok:true; semanticFingerprint; schemaId} \| {ok:false; issues: VfslIssue[]}`，同步、纯、不抛错；`schemaId = sc1-<52 位小写 Base32>` | `packages/vfsl/src/index.ts` L225–272 |
| 4 | Registry 公共面：`create(input: CreateNamespaceInput)`，输入恰 `{owner; schema: unknown; root: unknown}`（无 namespaceId）；结果 `{ok:true; lease} \| CreateNamespaceIssue`（领域窄 issue resolve）；内部故障以 branded `NamespaceRegistryFatalError` **reject**；构造期依赖形状门禁同步 `TypeError` | `packages/namespace-registry/src/types.ts` L252–310、L681–691；`packages/namespace-registry/src/index.ts` 导出白名单 |
| 5 | `NamespaceLease`：`namespaceId: string`、`release(): Promise<void>`（首次同步标记 released、幂等、exact same Promise）、`getStatus()`、`getSchema()` 等；是调用方唯一能力入口 | `packages/namespace-registry/src/types.ts` L628–661；ADR 0009 |
| 6 | `InstanceRole = 'hub' \| 'peer'` 由 `@nomicore/instance` 定义并由 `@nomicore/namespace-registry` 公共 re-export（类型白名单内） | `packages/instance/src/index.ts` L4；`packages/namespace-registry/src/index.ts` type 导出块 |
| 7 | 新建 namespace 默认无复制身份 → `runtime.replication = {state:'disabled'}`；`openReplicationSession` → `REPLICATION_NOT_ENABLED`；这是 Registry 既有机制的自然导出，REST 零新增行为 | ADR 0010 L120、#134 修订节 O-7；SA6 支撑文件在 HEAD 5/5 绿亲证 |
| 8 | 包布局/接线惯例：每包 `package.json`（`exports` 带 `nomicore-source`/`types`/`import` 三条件；`.` 与 `./testing` 子路径）、`tsconfig.json`（extends 根 base、include `src/**`）、`AGENTS.md`、`README.md`；根 `package.json` `typecheck` 脚本逐一列出 **13 个包 + 1 个 app（14 项 tsconfig）**；`pnpm-workspace.yaml` glob `packages/*` | `packages/namespace-registry/package.json`；根 `package.json` `scripts.typecheck`；`packages/namespace-registry/tsconfig.json`；各包 `AGENTS.md`/`README.md`（SA2 F-M1 计数勘误） |
| 9 | 测试解析：根 `vitest.config.ts` `resolve.alias` 把 `@nomicore/<pkg>` 与 `@nomicore/<pkg>/testing` 直接指向各包 `src/index.ts` / `src/testing.ts`（无需包级 node_modules 链接）；include `packages/*/test/**/*.test.ts` | `vitest.config.ts` L6–16 |
| 10 | CI 门禁：typecheck 作业跑 `pnpm install --frozen-lockfile` + `pnpm typecheck` + `vitest --typecheck.only`；test 分片同样 `--frozen-lockfile` → **新增带依赖的 workspace 包必须同步再生成 `pnpm-lock.yaml`**，否则 CI 安装即失败 | `.github/workflows/ci.yml` L36–44 及 5 处 `--frozen-lockfile` |
| 11 | `Request`/`Response`/`Headers` 全局在仓库 tsconfig 家族（lib ES2022 + `@types/node ^20`）下可解析：`@types/node@20` 经 `web-globals/fetch.d.ts`（`index.d.ts` 引用）声明全局 `Request/Response/Headers/fetch`，SA2 以仓库 strict 选项 + 该 typeRoot 的 tsc 探针独立实证 exit 0；**operative 门 = 根 `pnpm typecheck` 链**（本包 tsconfig 已入链，覆盖 `src/**`）。SA6 的「`--typecheck` 报 no errors」不构成该结论的证据（vitest typecheck include 仅 `*.test-d.ts`，本包无） | SA2 §13 F-M3（独立 tsc 探针）；`tsconfig.base.json`；根 `package.json` `scripts.typecheck`；`@types/node` 包声明 |

## 3. 根因 / 能力缺口（承接 SA6 §8）

| Step | 事实 | 证据 | 置信 |
|---|---|---|---|
| 症状 | `packages/namespace-api/test` 行为契约红灯 | SA6 §5 | 确证 |
| 直接故障点 | `packages/namespace-api/src/rest.ts` 不存在 → `createRestRouter` 无任何导出 | `Cannot find module '../src/rest.js'` | 确证 |
| 包装线缺口 | `packages/namespace-api/package.json` 不存在 → `./rest` 公共 seam 未建立 | 接线锚显式错误消息 | 确证 |
| 最深根因 | ADR 0015 的 REST vertical 本体（包、router、create 编排、role gate、Lease 编排）尚未实现——是设计已定、本体未建，不是缺陷回归 | HEAD 无该包；ADR 0015 为「提议」在途 | 确证 |
| 放大因素 | 上游 Blocked-by #266 已合入（`deriveSchemaIdentity` 可用）⇒ 唯一缺口就是本票范围 | `packages/vfsl/src/index.ts` L255 | 确证 |

设计响应：直接补齐包本体 + 公共 seam；不触碰任何上游包。

## 4. Owner 要求落实

Issue comments REST snapshot 为空（`[]`）——**无 Owner 评论可映射**。适用输入 = Issue 正文
（最高优先级）+ 其引用的 ADR 0015 条款。正文要求 → 设计位置：

| 要求（Issue 正文） | 设计位置 |
|---|---|
| 建 `@nomicore/namespace-api`，REST Adapter 由 `/rest` 子路径暴露，首版只公开 REST router，create 编排包内私有 | §7 D1、§8.1 |
| router 为 Host 无关普通 Module（非 Cordis plugin）、标准 `Request → Response` + 判别结果；不拥有 listener/auth/CORS/TLS/RequestID/全局并发/drain | §7 D1/D3、§8.2 |
| 配置构造时读取、校验、复制并冻结；构造配置错误普通 `TypeError` | §7 D2、§8.3 |
| Hub 完整走通 匹配 → role gate → 派生 → 组装 envelope → `Registry.create({owner,schema,root})` → 201 恰含 `namespaceId` + `schema{lang,version,id}`、无 `Location` | §8.4、§8.5 |
| Peer 相同 route 形状，匹配 method/raw path 后、解析 owner 或读取 body 前返回 403 + `INSTANCE_ROLE_FORBIDDEN` | §8.2、§8.4 |
| 新建 namespace 默认 `replication-disabled` | §9.5（零新增行为，Registry 机制自然导出） |
| Lease：先复制 DTO、恰一次调用并等待 `release()`；release 失败仍 201、不重复调用 | §8.5 |
| 本票只做成功路径与 role gate；形状校验/limits/失败映射/observer 契约延后 | §1 非目标、§7 D5/D7、§12 |
| AC1–AC6 | §12 验收与验证映射（6/6 覆盖） |

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 能力缺口因果闭合：唯一变量实验（有/无实现模块）红→绿 35/35；10 例定点变异全被目标断言捕获 | SA6 §9 E1/E2、§13 | 实现形状直接对准契约断言面（本设计 §8 的每个可观察行为都有对应红灯用例）；不改变测试字节 |
| 红灯只落在缺失模块 + 缺失包接线两处；`Type Errors: no errors` | SA6 §5/§11 | 新增源码必须保持 typecheck 干净（`import type`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 纪律） |
| Registry/Persistence/VFSL/Request 既有能力在 HEAD 可用（支撑文件恒绿） | SA6 §6 | 全部经公共接口消费；不 mock、不读内部结构 |
| 契约假设 H1–H4 待 SA1 仲裁 | SA6 §12.1 | **本设计逐条仲裁：全部确认**（§7 D1–D4）；SA2 评审复核后契约测试无需回写 |

## 6. SA8 约束落实

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| B-1 role 单真相：注入 router 的 role 值必须同源自 composition root 的 Instance identity，不得成为第二份独立 role 配置 | §7 D8、§8.1、§11 ALLOW（AGENTS.md） | 类型层只认 `InstanceRole` 联合（自 `@nomicore/namespace-registry` 公共 re-export 导入）；包内零 role 默认值、零独立 role 配置源；AGENTS.md + JSDoc 写明「composition root 必须传 Instance service 的 role 值」。本票无 composition root（无 server 包在范围），义务以文档 + 类型钉住，待 server 装配票落地 | 是（SA8 复审核对） |
| B-2 observer 构造面冻结：必须显式注入两个同步 void observer，no-op 须显式；延后范围限定为**事件发射契约** | §7 D7、§8.3 | 构造签名含 `metricsObserver` / `diagnosticObserver`（缺失/非函数 → 普通 `TypeError`）；本票不发射任何事件（SA6 §3 已按此口径不断言）；签名零参 `() => void`，后续事件化收窄不破坏既有调用方（少参函数可赋给多参签名） | 是 |
| B-3 固定顺序不被骨架 reorder：role gate 先于 owner 解析/body 读取；DTO 复制先于 release；method gate 先于 role gate | §8.2、§8.4、§8.5 | 实现顺序逐字落 ADR step 1→2→(3–5 无分支)→(4 最小读取)→6→7→8→9→10；Hub 侧不产生任何先于 role gate 的 owner/body 错误分支（延后的 step 3–5 在骨架中根本不产生 Response，无从反序）；Peer 侧 role gate 前零 body 成员调用、零 Registry 触达 | 是 |
| 冻结面：201 恰含 `namespaceId` + `schema{lang,version,id}`、无 `Location` | §8.5 | 显式构造两键/三键 DTO（不从 envelope 展开——envelope 含 `text`，绝不能进 response）；不设 `location` 头 | — |
| 冻结面：`sc1-` 格式 | §8.4 | 只消费 `deriveSchemaIdentity`，不重算 digest | — |
| 冻结面：`INSTANCE_ROLE_FORBIDDEN` / 405 + `Allow: POST` | §8.2 | 逐字常量；`allow: 'POST'` 恰值 | — |
| 冻结面：Registry 公共面与 Lease 契约不变 | 全文 | 只调用 `registry.create` / `lease.namespaceId` / `lease.release`；不扩 Registry、不改 release 语义（恰一次由调用纪律保证，不依赖 Lease 幂等） | — |
| 冻结面：新建 namespace 默认 `replication-disabled` | §9.5 | REST 不触 META/复制身份；201 不表示复制启用 | — |
| 流程项：ADR 0015 收官翻「已接受」；新包建 `AGENTS.md` | §11、§13 | `AGENTS.md` 随包建立（ALLOW LIST）；ADR 状态翻转归 Controller 收官清单（DENY LIST + follow-up FR-2） | — |
| Typed Namespace writes 强制条款不适用（REST 经 `Registry.create` 整体提交，router 不持 lease 写数据） | §1、§9.6 | 不做 codegen、不做 `mutateData` 类型化写；写者是 Registry 自身管线 | — |

## 7. 设计决策与主要备选方案

### D1 包与公共 seam（仲裁 H1/H3）

- 新建 `packages/namespace-api`，manifest 镜像既有包惯例（`packages/namespace-registry/package.json`
  同款）：

```json
{
  "name": "@nomicore/namespace-api",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "nomicore-source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./rest": {
      "nomicore-source": "./src/rest.ts",
      "types": "./dist/rest.d.ts",
      "import": "./dist/rest.js"
    }
  },
  "scripts": { "typecheck": "tsc -p tsconfig.json", "build": "node ../../scripts/build-package.mjs" },
  "dependencies": {
    "@nomicore/namespace-registry": "workspace:*",
    "@nomicore/vfsl": "workspace:*"
  },
  "devDependencies": { "@types/node": "^20", "typescript": "^5.9.3", "vitest": "^3.2.4" }
}
```

  （license/repository/files/publishConfig 等打包字段照 registry manifest 补齐。）
  接线锚断言 `exports['./rest']['nomicore-source']` 为字符串且文件存在 → `./src/rest.ts` ✓。
  **SA3 实现轮补记（范围注记，非设计变更）**：SA6 harness 静态 import `@nomicore/persistence`
  与 `@nomicore/persistence/testing`，而 `tsconfig.typecheck.json` include `packages/*/test/**/*.ts`
  → CI typecheck 作业（`vitest run --typecheck.only`）在新包落 manifest 后要求该 import 在包内
  可解析。实际 manifest 因此增列 **devDependency** `@nomicore/persistence: workspace:*`
  （test-only，镜像 `packages/ws-replication` 的 devDependency 先例）；`dependencies` 与运行时
  公共面不变（零新增运行时依赖、零 exports 变化）。证据见
  `wiki/raw/task_issue-267_sa3_impl.md`「Deviations」。
- 文件布局：`src/rest.ts`（公共 REST router 面：路由匹配、method gate、role gate、Response
  构造、`createRestRouter` 与公共类型）；`src/create-namespace.ts`（**包内私有** create 编排，
  不进 `exports` 白名单，仅被 `rest.ts` 相对导入——外部消费者被 exports 白名单结构性阻断，
  「create 编排保持包内私有」由打包面而非注释保证）；`src/index.ts`（只 re-export `./rest.js`
  的公共 router 面）；`tsconfig.json`（`extends ../../tsconfig.base.json`、`include:
  ["src/**/*.ts"]`，同 registry 款）。
- 依赖：`@nomicore/vfsl` 为运行时依赖（`deriveSchemaIdentity` 被调用）；`@nomicore/namespace-registry`
  仅类型导入（`InstanceRole` / `NamespaceRegistry`），按包惯例记常规依赖。
- **接线配套（必须，否则 CI 断）**：根 `package.json` `scripts.typecheck` 链在
  `packages/namespace-registry` 项后插入 `&& tsc -p packages/namespace-api/tsconfig.json`（13 包
  惯例：每包逐一列出）；同时执行一次 `pnpm install` 再生成 `pnpm-lock.yaml`（新 importer 条目），
  否则 CI 的 `pnpm install --frozen-lockfile` 直接失败。`packages/namespace-api/node_modules/`
  为安装产物（gitignore）。
- 备选方案（未选）：(a) 不进根 typecheck 链、只靠 vitest `--typecheck`——被否决：`--typecheck.only`
  只对 `*.test-d.ts` 报告，src 类型面会逃出 CI 门禁，违反 13 包惯例；(b) 单文件 `src/rest.ts`
  承载编排——可行（SA6 绿灯模拟即此形状）但把「编排私有」降级为约定，后续 limits/错误映射/
  observer 票都会改同一文件；拆私有模块给延后切片稳定生长点。

### D2 构造面（仲裁 H1；AC「构造配置门」）

`createRestRouter(options: RestRouterOptions): RestRouter`，构造期同步完成**读取 → 校验 → 复制
→ 冻结**，之后零动态更新：

```ts
import type { InstanceRole, NamespaceRegistry } from '@nomicore/namespace-registry';

/** limits 为预留构造面（ADR 0015 L22–28 五项注入之一）；本票不校验、不执行（见 D7 备注）。 */
export interface RestRouterLimits {
  readonly maxBodyBytes?: number;
  readonly maxSchemaTextBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxJsonNodes?: number;
  readonly maxIssues?: number;
  readonly maxIssueMessageBytes?: number;
  readonly maxIssuesTotalBytes?: number;
}

export interface RestRouterOptions {
  readonly role: InstanceRole;
  readonly registry: NamespaceRegistry;
  /** 同步 void observer；事件契约延后（零参签名：后续事件化收窄不破坏少参调用方）。 */
  readonly metricsObserver: () => void;
  readonly diagnosticObserver: () => void;
  readonly limits?: RestRouterLimits;
}

export type RestHandledResult =
  | Readonly<{ matched: false }>
  | Readonly<{ matched: true; response: Response }>;

export interface RestRouter {
  handle(request: Request): Promise<RestHandledResult>;
}
```

校验规则（全部普通 `TypeError`，不承诺稳定文案——ADR 0015 L30）：

| 输入 | 判定 |
|---|---|
| `options` 缺失 / 非 object | `TypeError` |
| `role` 非 `'hub' \| 'peer'` | `TypeError` |
| `registry` 非 object / 其 `create` 非函数 | `TypeError`（形状级即可，与 ADR 0009 依赖纪律同款；poison registry 形状完整可通过——契约测试依赖这一点） |
| `metricsObserver` 或 `diagnosticObserver` 缺失 / 非函数 | `TypeError`（B-2：no-op 必须显式传入） |
| `limits` | 本票不校验不执行（`limits` 票叠加校验 + 执行；保留参数位使后续 ticket 不必改公共构造签名——B-2 同款逻辑） |

复制与冻结：`role` 等值读入内部 frozen record（`Object.freeze`）；`limits` 存在时浅复制后冻结。
契约「构造后改写调用方 `options.role` 不改变行为」由值拷贝满足。

### D3 路由模型（AC6）

- 匹配基于 `new URL(request.url).pathname`（**raw path，不 decode、不 lowercase**），单一冻结
  匹配器：

```ts
const CREATE_NAMESPACE_ROUTE = /^\/v1\/owners\/([^/]+)\/namespaces$/;
```

- 语义逐条对 AC6/ADR L65–68：大小写敏感（无 `i` 旗标 → `/V1/…`、`/Namespaces` 不匹配）；无尾随
  斜杠（`$` 锚 → `…/namespaces/` 不匹配）；段数恰 5（`[^/]+` 不跨 `/` → 短路径/额外段不匹配；
  空 owner 段 `/v1/owners//namespaces` 不匹配——fail closed）；owner 段以 raw 形态捕获
  （`%61lice` 在 route 层视为合法段 → matched → 走 role gate，percent-encoding 的**拒绝**属
  step 3 延后项，不在路由层做）；query 不参与匹配（`url.pathname` 天然排除 query；query 的
  **拒绝**属 step 3 延后项）。
- 判定顺序（AC2/AC6 + 变异 M8/M10 的既证顺序）：**path 匹配先于 method 判定**——不匹配 →
  `{matched:false}`（任何 method）；匹配且 method ≠ `POST`（大小写敏感全等比较，含 HEAD/
  OPTIONS）→ `{matched:true, response: 405}`；匹配且 `POST` → role gate。
- 备选方案（未选）：`URLPattern`——默认大小写不敏感（与 AC6 相反）且 Node 基线可用性需另证，
  直接违反冻结面；路由表抽象类层——单路由场景过度设计，route family 表待第二个 route 出现
  再引入。

### D4 handle 判别结果与响应形状（仲裁 H2/H4）

`router.handle(request)` 返回 `Promise<RestHandledResult>`；未匹配返回 `{matched:false}` 交还
server 按 raw path 选其他 route family（ADR 0015 L32「server 先按 raw path 选择 route family」
的配套语义）；`{matched:true, response}` 的三个骨架响应：

| 分支 | 状态 | 头 | body（JSON） | 冻结性 |
|---|---|---|---|---|
| 已知 path 非 POST | 405 | `allow: 'POST'`（恰值）、`content-type: application/json` | `{ code: 'METHOD_NOT_ALLOWED' }` | 状态 + `Allow` 头冻结（ADR L68）；`code` 值**临时**（错误契约票定稿，契约测试未断言——不构成冻结面） |
| Peer + 已匹配 POST | 403 | `content-type: application/json` | `{ code: 'INSTANCE_ROLE_FORBIDDEN' }` | code 逐字冻结（ADR L41，全决策集唯一定义点） |
| Hub 成功 | 201 | `content-type: application/json`；**不设 `location`** | `{ namespaceId, schema: { lang: 'vfsl', version: 1, id } }` 恰两键/三键 | v1 冻结（ADR L77–90） |

错误 body 本票取最小 `{code}` 形状（无 message/issues）——完整 problem shape 属延后的错误契约
票，向 body 增键是加法演进，不破坏冻结面（「恰含」只冻结 201 成功面）。

### D5 未映射结局策略（延后切片的诚实边界）

本票只实现成功路径与 role gate。凡 Registry/解析/派生的**非成功结局**，一律 **fail loud**：
`handle` 以 rejection 结算，不发明任何 HTTP 映射、不静默降级、不伪 500：

| 结局 | 骨架行为 | 延后归属 |
|---|---|---|
| `registry.create` resolve `ok:false`（领域窄 issue，如 `NAMESPACE_SCHEMA_INVALID`） | `handle` reject：抛内部 `Error`，message 携带 issue `code`、`cause` 携带原 issue 对象（rejection 形状**非契约**） | 422/503/400 problem 映射票 |
| `registry.create` reject（branded `NamespaceRegistryFatalError`） | 原样再抛（传播 rejection，不包装不吞） | 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN` / `NAMESPACE_CREATE_FAILED` 票 |
| body 读取 / JSON 解析抛错（`request.json()` reject） | 传播底层异常 | 400/415 票 |
| 顶层非 object / `schemaText` 非 string / `root` 缺失 | 抛内部 `Error`（机械提取前置失败，loud）——**不是** step 5 校验策略（那产生 400 Response），只是拒绝在缺输入时编造成功 | 400 形状校验票 |
| `deriveSchemaIdentity` → `ok:false` | 抛内部 `Error`（携带 issues 引用） | 422 VFSL issues 映射票 |

备选方案（未选）：(a) 立即实现完整错误映射——越权冻结未经评审的 code/形状，违反切片纪律；
(b) 统一 500 `INTERNAL_ERROR` 兜底——发明语义、把可映射的客户端错误伪装成内部故障、且掩盖
「映射缺失」这一事实本身。fail-loud rejection 让未映射面显式可见，后续票以 Response 替换
rejection 是纯加法（B-3：不 reorder 任何已实现可观察顺序）。

### D6 Lease 编排（AC4 / ADR step 7–10）

成功路径固定顺序（§8.5 伪码）：`create` ok → **立即**把 `lease.namespaceId`（string 值拷贝）
与派生 identity 组装为 frozen owned DTO → `await lease.release()` **恰一次**（try/catch 吞
release 失败，绝不重试、绝不二次调用）→ release settle（正常或异常）之后才从 **DTO** 构造
201 Response。变异 M2/M3/M4/M5 的对应防御：Response 构造点在 `await release()` 之后（settle
语义）；`namespaceId` 在 release 前读入本地（release 后 getter 变异不进 response）；release
调用点唯一且在 try 块内恰一次；失败路径沿用同一已构造 DTO 返回 201。

### D7 Observability（B-2 边界内的全部内容）

构造面收两个显式同步 void observer（缺失 → `TypeError`）；**本票不发射任何事件**（SA6 §3
 ratified 口径：延后的是事件发射契约）。ADR L161「release 失败经 diagnostic observer 上报」的
义务随观测票落地；本票保持其业务不变量（release 失败仍 201、不重复 release），丢失的只是
best-effort 诊断信号（与 ADR 0011「emit 不改变业务结局」的观测定位一致，不构成静默 fallback）。
`limits` 同理：参数位保留、不校验不执行（见 D2 表）——受信开发环境（ADR L36）下 body 读取
暂无上限，风险登记 §13 R4。

### D8 role 单真相（B-1）

包内不定义自己的 role 联合：`RestRouterOptions.role: InstanceRole`，类型自
`@nomicore/namespace-registry` 公共 re-export 导入（与 `@nomicore/instance` L4 同一联合的
结构性等价投影，免引第三个依赖）。`AGENTS.md` 与 `createRestRouter` JSDoc 写明：**值必须由
composition root 从 Instance service（`instanceId + role` 唯一生产来源，ADR 0012）读取后注
入**，禁止从环境变量/第二份配置文件取值。本票无 composition root 消费者，义务以类型 + 文档
钉住，server 装配票落地时按此接线。

### D9 无状态与并发

router 除 frozen config 外零状态；`handle` 为普通异步函数，无内部队列/锁/串行化——并发请求
天然并行（ADR L208「并发请求不在 router 全局串行」），namespace 生命周期不变量由 Registry
carrier 按 key 串行维持。无监听器、无定时器、无随机源（CSPRNG 留在 Registry 内）。

## 8. 接口、状态机和数据流

### 8.1 模块图

```
server (未来, 不在本票) ──构造注入 role(源: Instance service)/registry/observers──▶ createRestRouter
        │ handle(Request)                                                                     │
        ▼                                                                                     ▼
   @nomicore/namespace-api/rest ──相对导入──▶ src/create-namespace.ts（私有编排）
        │                                        │ deriveSchemaIdentity(text)   ──▶ @nomicore/vfsl（公共窄接口）
        │                                        │ registry.create({owner,schema,root}) ──▶ @nomicore/namespace-registry
        │                                        │                        └─▶ Persistence / Runtime（Registry 内部管线）
        ▼
   RestHandledResult
```

### 8.2 handle 主流程（伪码，`src/rest.ts`）

```ts
async function handle(request: Request): Promise<RestHandledResult> {
  const { pathname } = new URL(request.url);            // raw path；非法 URL → TypeError 传播（fail loud）
  const match = CREATE_NAMESPACE_ROUTE.exec(pathname);
  if (match === null) return { matched: false };        // path 先于 method（AC6；大小写/尾随斜杠/段数全在此消化）
  if (request.method !== 'POST') {
    return { matched: true, response: methodNotAllowedResponse() };   // 405 + allow:'POST'（先于 role gate——M10）
  }
  if (config.role !== 'hub') {
    return { matched: true, response: roleForbiddenResponse() };      // 403 + INSTANCE_ROLE_FORBIDDEN；
  }                                                                   // 至此零 owner 解码、零 body 成员调用、零 Registry 触达
  const ownerUserId = match[1] ?? unreachable();        // raw 段；decode/文法校验 = step 3 延后
  return { matched: true, response: await orchestrateCreateNamespace(config.registry, ownerUserId, request) };
}
```

### 8.3 构造伪码（`src/rest.ts`）

```ts
export function createRestRouter(options: RestRouterOptions): RestRouter {
  if (options === null || typeof options !== 'object') throw new TypeError('rest router options 必须是对象');
  const { role, registry, metricsObserver, diagnosticObserver, limits } = options as RestRouterOptions;
  if (role !== 'hub' && role !== 'peer') throw new TypeError('role 必须是 hub | peer');
  if (registry === null || typeof registry !== 'object' || typeof registry.create !== 'function')
    throw new TypeError('registry 必须是 NamespaceRegistry');
  if (typeof metricsObserver !== 'function') throw new TypeError('metricsObserver 必须显式注入（no-op 须显式）');
  if (typeof diagnosticObserver !== 'function') throw new TypeError('diagnosticObserver 必须显式注入（no-op 须显式）');
  const config = Object.freeze({                        // 复制 + 冻结；limits 存在时浅复制冻结（预留，未消费）
    role, registry, metricsObserver, diagnosticObserver,
    ...(limits === undefined ? {} : { limits: Object.freeze({ ...limits }) }),
  });
  return Object.freeze({ handle });                     // handle 为闭包，只读 config
}
```

### 8.4 create 编排伪码（`src/create-namespace.ts`，私有）

```ts
import { deriveSchemaIdentity } from '@nomicore/vfsl';
import type { NamespaceRegistry } from '@nomicore/namespace-registry';

export async function orchestrateCreateNamespace(   // 仅被 src/rest.ts 相对导入；不进 exports 白名单
  registry: NamespaceRegistry, ownerUserId: string, request: Request,
): Promise<Response> {
  const body: unknown = await request.json();               // step 4 最小读取（有界/严格 UTF-8/signal = limits 票）
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    throw new Error('unmapped request shape（400 映射延后）');   // 机械提取前置，非 step 5 策略
  const record = body as { schemaText?: unknown; root?: unknown };
  if (typeof record.schemaText !== 'string' || !('root' in record))
    throw new Error('unmapped request shape（400 映射延后）');   // 仅查键存在与 string 类型；root 值的领域
                                                              // 合法性归 Registry/VFSL（ADR L75「REST 不预设其
                                                              // 具体形状」——null 等显式值原样透传，由 Registry 窄
                                                              // issue 拒绝后走 D5 fail-loud 通道）
  const schemaText: string = record.schemaText;               // 上一行已收窄为 string
  const derived = deriveSchemaIdentity(schemaText);          // step 6：公共窄接口；同步、不抛
  if (!derived.ok) throw new Error(`unmapped VFSL issues（422 映射延后）`, { cause: derived.issues });
  const envelope = { lang: 'vfsl', version: 1, id: derived.schemaId, text: schemaText };  // 完整 SCHEMA envelope（四键）
  const created = await registry.create({                    // step 7：恰三键输入
    owner: { userId: ownerUserId }, schema: envelope, root: record.root,
  });
  if (!created.ok) throw new Error(`unmapped registry issue: ${created.code}`, { cause: created });
  const lease = created.lease;
  const dto = Object.freeze({                                // step 8：release 前复制 owned plain DTO
    namespaceId: lease.namespaceId,                          // string 值在 release 调用前读入本地
    schema: Object.freeze({ lang: 'vfsl', version: 1, id: derived.schemaId }),
  });
  try {
    await lease.release();                                   // step 9：恰一次、等待 settle；失败不重试
  } catch {
    /* release 失败不改变已知创建事实：仍 201（diagnostic 上报 = 观测票）*/
  }
  return new Response(JSON.stringify(dto), {                 // step 10：settle 后从 DTO 构造（M2/M3）
    status: 201, headers: { 'content-type': 'application/json' },
  });                                                        // 不设 location（AC1）
}
```

（实现须遵守 `verbatimModuleSyntax`（`import type`）、`noUncheckedIndexedAccess`（`match[1]` 收窄）
等根 tsconfig 纪律；伪码中 `Error(..., {cause})` 为示意，rejection 形状非契约。）

### 8.5 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| Hub create（唯一运行时数据创建路线） | server 调 `router.handle(POST Request)`；body `{schemaText, root}` | Registry create 管线内（Persistence createDoc；REST 自身无写入点） | ①raw pathname 路由捕获 owner 段（不 decode）→②`request.json()` 解析→③`deriveSchemaIdentity`（跨模块同步调用，纯函数）→④组装 envelope（REST 内存）→⑤`registry.create`（跨模块异步；Registry 内部快照/深冻结/Persistence 落盘/Runtime 构造——均在 Registry 契约内）→⑥DTO 复制（REST 内存，frozen） | FilePersistence：owner 分区目录 + 受控 scheduler（契约测试注入 `debounceMs:1/maxDirtyMs:1` + `advanceBy` 确定性 flush）；MemoryPersistence：内存结构 | ⑥′`lease.namespaceId` 读入 DTO→⑦`release()`→⑧Response JSON | 201 + 持久化 namespace 事实；后续 `registry.open` 读回 ROOT 与原文 SCHEMA.text；重启后仍可 open（File） | Registry `ok:false`/fatal → D5 fail-loud rejection（零部分提交由 Registry 原子性保证）；release 失败 → 吞 + 仍 201；测试清理：registry.shutdown + fixture.dispose + tmpdir rm（harness `finally`） | `rest-create-hub-contract.test.ts` 8×2 + 1；`rest-contract-support.test.ts` |
| Peer role gate（零数据路线） | server 调 `handle(POST Request)` | 无 | raw path 匹配 + method 判定后读 frozen `config.role`；不解码 owner、不触 body 成员、不触 registry | 无 | 无 | 403 + `{code:'INSTANCE_ROLE_FORBIDDEN'}` | 无需清理（无资源获取） | `rest-role-gate-routing-contract.test.ts` 前 7 用例（poison registry / trapped body 证明零触达） |
| 405 / matched:false（零数据路线） | server 调 `handle(任意 Request)` | 无 | path→method 判定 | 无 | 无 | 405 + `allow:'POST'` 或 `{matched:false}` | 无 | 同一文件后 5 用例（3 route/method + 2 构造门；SA2 F-M2 分组计数勘误） |

无其他运行时数据流变化：router 不缓存、不投影、不销毁任何持久数据；`root`/`schemaText` 的
快照与冻结责任在 Registry 接纳段（`CreateNamespaceInput` JSDoc §4 第 4 步），REST 不深拷贝
（ADR L101「JSON parse 产生本请求独占数据，REST 不再深拷贝」）。

## 9. 错误、恢复、并发和幂等

1. **失败语义总表**：见 §7 D5（未映射结局 → rejection）+ §7 D6（release 失败 → 仍 201）。
   构造错误 → 同步 `TypeError`（D2）。
2. **恢复与重试**：REST 侧唯一重试敏感点是 release——**恰一次、失败不重试**（AC4；ADR L161）。
   Registry create 的内部 ID 碰撞重试是 Registry 契约（至多 8 次），REST 不感知。调用方对
   rejection 的重试策略属后续错误契约票（ADR L182 已定 v1 无 idempotency）。
3. **回滚**：无需 REST 侧回滚——create 原子（要么 committed 要么否），成功后唯一附加动作是
   release（幂等、吞失败）；201 之前的任何 rejection 都对应零 Response，无半成品 HTTP 状态。
4. **并发**：D9——router 无串行化；同 owner 并发 create 产生多个 namespace（namespaceId 由
   Registry CSPRNG 生成、内部处理碰撞），符合 ADR「普通 REST create 不应返回
   NAMESPACE_ALREADY_EXISTS」。
5. **replication-disabled 默认**（AC5）：REST 不触 META/复制身份（`CreateNamespaceInput` 恒三
   键，无 META 通道；CONTEXT.md「createdAt：REST 只传 schema + root，不触 META」）→ 新建
   namespace 无 `replicationId/epoch` → `{state:'disabled'}` + `openReplicationSession` →
   `REPLICATION_NOT_ENABLED`（ADR 0010 L120、#134 O-7）。201 response 不声明复制状态（ADR L90）。
6. **Typed Namespace writes 不适用**：router 不持有 lease 做数据写；`root` 经
   `Registry.create` 整体提交，Writer 是 Registry 管线（SA8 冲突报告行 12）。
7. **客户端取消**：本票不接 `Request.signal`（body 有界读取 + signal = limits 票）；Registry
   接纳后的取消不传播——`handle` 无条件 await create + release（与 ADR L113 后半句一致）。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| 未来 server / composition root（尚不存在；ADR 0015 L20 设想的消费者） | 无（模块不存在） | 构造 `createRestRouter`（role 取自 Instance service）、按 `{matched}` 判别路由族、把 Response 交给传输层 | 无（本票交付被调方；接线义务写入 AGENTS.md，D8） | `git grep namespace-api` 仅 docs/wiki 命中；无任何 ts 源引用 |
| `@nomicore/vfsl` | 被 #266 消费面 | 零改动；新增一个只读消费者（`deriveSchemaIdentity`） | 无 | `packages/vfsl/src/index.ts` L255；SA8 行 5 |
| `@nomicore/namespace-registry` / `@nomicore/persistence` / `@nomicore/instance` | — | 零改动；只读公共面（`create`、类型、testing 入口属测试侧） | 无 | SA8 行 6–8/13；§2 锚点 4–6 |
| 根 `package.json` `typecheck` 消费者（CI typecheck 作业、开发者、packaging 脚本） | 13 包链 | 链上 +1 项（`namespace-api`） | 根 `package.json` 一行追加 + `pnpm-lock.yaml` 再生成 | `.github/workflows/ci.yml` L36–39；根 `package.json` scripts |
| SA6 契约测试（5 文件） | 红灯 | 全绿（2 行为 suite + 1 接线锚转绿；支撑恒绿） | **零测试文件改动**（设计仲裁 H1–H4 与契约假设一致） | SA6 §12/§13 |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/namespace-api/package.json` | 新建（§7 D1 manifest：name/exports（`.` + `./rest` 三条件）/scripts/deps/打包字段） | 公共 seam 接线锚唯一红灯点之一；ADR 0015 L18 |
| `packages/namespace-api/tsconfig.json` | 新建（extends 根 base，include `src/**`） | 13 包惯例；根 typecheck 链消费 |
| `packages/namespace-api/src/rest.ts` | 新建（公共 router：`createRestRouter`、`RestRouterOptions`/`RestRouter`/`RestHandledResult`/`RestRouterLimits` 类型、路由匹配器、403/405/构造门） | 行为契约 import 目标（H3）；接线锚 `nomicore-source` 指向 |
| `packages/namespace-api/src/create-namespace.ts` | 新建（私有 create 编排 §8.4） | ADR L18「create 编排保持包内私有」的结构化落点 |
| `packages/namespace-api/src/index.ts` | 新建（re-export `./rest.js` 公共面） | 包 `.` 入口惯例；vitest alias `@nomicore/namespace-api` 解析目标 |
| `packages/namespace-api/AGENTS.md` | 新建（包契约：Host 无关普通 Module、公共 API 只经 index/`./rest`、编排私有、构造冻结 + TypeError、role 单真相义务、未映射结局 = rejection、延后切片清单、验证门） | 根 AGENTS.md 模块纪律 + 13 个既有包惯例（SA8 §8-4、SA6 §15 明示随包建立；SA2 F-M1 计数勘误） |
| `packages/namespace-api/README.md` | 新建（包契约摘要 + 公共 API + Lease 语义 + 延后范围 + 验证入口，照 registry/vfsl README 惯例） | SA2 F-M4：13/13 既有包均有 README，显式纳入 ALLOW 以闭合惯例偏离 |
| 根 `package.json` | `scripts.typecheck` 链插入 `tsc -p packages/namespace-api/tsconfig.json`（置于 namespace-registry 项后） | CI `pnpm typecheck` 覆盖新包源码（13 包逐一列出惯例） |
| `pnpm-lock.yaml` | 由 `pnpm install` 再生成（新 importer 条目） | CI 五处 `--frozen-lockfile`；缺此步 CI 安装即失败 |
| `wiki/raw/task_issue-267_design.md` | 本设计文档 | SA1 交付物 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/namespace-api/test/*`（5 文件） | 已固化的 SA6 验收契约（红灯基线） | 契约测试属 SA6 产物；本设计仲裁 H1–H4 与其假设一致，零回写需求；任何改动必须走 SA6 修订轮，实现方不得擅自改契约 |
| `packages/vfsl/**`、`packages/namespace-registry/**`、`packages/persistence/**`、`packages/instance/**`、`packages/namespace-runtime/**` 等 13 个既有包 | 上游被消费面 | 公共面零修改（SA8 冻结面表；只读消费） |
| `docs/adr/0015-vertical-rest-namespace-create.md` | governing 决策（状态：提议） | 状态翻转「已接受」是阶段收官流程项，归 Controller/Host（SA8 行 11 移交；docs/AGENTS.md Authority）；实现链不得自行翻转 |
| `CONTEXT.md` | 共享词汇表 | 本票零新域词：REST router/包名是 ADR 0015 已有设计的模块工件；涉及域词（owner、namespaceId、内容寻址 schema ID、信封、Hub/Peer、lease）均已存在（CONTEXT.md L74 等） |
| `vitest.config.ts` | 测试解析配置 | 契约测试经相对路径 import `../src/rest.js` + 根 alias 解析 `@nomicore/*`，无需新 alias；`@nomicore/namespace-api/rest` 跨包消费者出现前加 alias 是死配置（出现时随消费者票加） |
| `docs/**`（protocols/phases/vfsl 等） | 规范文档 | 实现不改变任何规范文档所述契约（ADR 0015 描述的就是本实现的目标行为） |
| `wiki/raw/task_issue-267_*`（sa6_contract / relevant_decisions / conflict_report / 简报） | 上游产物 | 只读输入（SA6/SA8/Host 所有） |
| `apps/**`、`domains/**`、`scripts/**`、`.github/**` | 无关 | 本票不触 server/领域/打包脚本/CI 工作流定义（CI 消费根 package.json 的既有入口） |

## 12. 验收与验证映射

SA1 不编写/运行测试；下表为已交付契约（SA6，红灯基线 3/3 稳定）→ 实现后预期观察。验证入口
（SA6 §5/§14 同款，实现后由执行角色运行）：

```
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test
pnpm install && pnpm typecheck          # 根链含 namespace-api 后必须全绿
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck.only --passWithNoTests=false  # CI typecheck 作业同款
```

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 Hub 201 恰含 namespaceId + schema identity（`sc1-`、与 `deriveSchemaIdentity` 逐字一致）、无 `Location` | 红灯（模块缺失） | `rest-create-hub-contract.test.ts`「AC1: 201 response…」 | 201、键集恰 `{namespaceId,schema}`/`{id,lang,version}`、`location === null`、id 匹配 `^sc1-[a-z2-7]{52}$` |
| AC1 step 6–7 Registry.create 输入 | 红灯 | 「AC1: Registry.create 恰一次收到 {owner, 完整 SCHEMA envelope, root}」 | 恰一次、逐键相等（envelope 四键含原文 text、owner `{userId}`、root 原值） |
| AC2 Peer 403 顺序（先于 owner 解析/body 读取/Registry 触达） | 红灯 | `rest-role-gate-routing-contract.test.ts` 前 7 用例（含 poison registry、trapped body、percent-encoded owner、无 body、`text/plain`） | 全部 403 + code 逐字；`bodyConsumptionAttempts === []`；poison registry 零触达 |
| AC3 双持久化同契约 + 后续 open + durability | 红灯（行为）/绿（支撑） | 两契约文件 MemoryPersistence × FilePersistence 参数化 + File-only restart 用例 | 两适配器全绿；`readData(['title'])` = `'hello'`；`getSchema()` 含原文；重启后同 namespace 可 open |
| AC4 DTO 复制先于 release / release 恰一次 / settle 后返回 / 失败仍 201 | 红灯 | 「AC4: lease.release 恰一次…」「AC4/step 9…」「AC4: release 失败仍返回 201…」「AC4/step 8…」 | `releaseCalls === 1`；gate 未放开前 `handle` 未 settle；release 失败仍 201 且 lease 已 released；哨兵 namespaceId 不进 response 且 response id 可 open |
| AC5 replication-disabled | 红灯 | 「AC5: 新建 namespace 默认 replication-disabled…」 | `runtime.replication = {state:'disabled'}`；`openReplicationSession` → `{ok:false, code:'REPLICATION_NOT_ENABLED'}` |
| AC6 route 匹配 + 405 | 红灯 | `rest-role-gate-routing-contract.test.ts` 后 5 用例（3 route/method + 2 构造门；SA2 F-M2 分组计数勘误） | 大小写变体/尾随斜杠/段数错误 → `matched:false`；已知 path 非 POST → 405 + `allow: 'POST'`（双 role） |
| 构造门（B-2/构造冻结） | 红灯 | 「构造配置错误抛普通 TypeError…」「构造时复制并冻结配置…」 | 非法 role/缺 options/缺任一 observer → `TypeError`；构造后改 `options.role` 行为不变 |
| 公共 seam 接线（ADR L18） | 红灯 | `rest-public-seam-wiring.test.ts` | `exports['./rest'].['nomicore-source']` 指向存在的 `src/rest.ts` |
| 支撑负控恒绿 | 绿（5/5） | `rest-contract-support.test.ts` | 保持 5/5（实现零回归于 Registry/Persistence/VFSL/Request 既有能力） |
| 类型面干净 | 根 `pnpm typecheck` 链（15 项 = 14 个包 + 1 个 app，含本包 `src/**`；SA2 F-M3 定其为 operative 门） | 根 `pnpm typecheck`（含新包；vitest `--typecheck` 仅覆盖 `*.test-d.ts`，不构成本包类型门） | 零类型错误；`import type`/`exactOptionalPropertyTypes` 纪律保持 |
| CI 可安装性 | —（新风险） | `pnpm install --frozen-lockfile`（CI 同款） | lockfile 与新 package.json 同步，安装成功 |
| 变异敏感性（防实现走样） | SA6 §9 E2：M1–M10 全捕获 | 不需新增测试；实现不得落入任一变异形态 | （回归护栏，非新证据需求） |

无新增测试文件需求：SA6 35 用例已完整覆盖 AC1–AC6 + 构造面 + 接线；本设计零测试字节改动。

## 13. 风险、回滚和残余问题

| # | 风险/残余 | 等级 | 缓解/归属 |
|---|---|---|---|
| R1 | 未映射结局以 rejection 暴露：Hub 收到非法 schema/body 或 Registry 拒绝时无 HTTP 错误响应，调用方看到异常而非 4xx/5xx | 中（受信环境可接受； Owner 切片明示延后） | D5 fail-loud 为有意设计；错误契约票替换为 problem shape（加法）；在此之前 AGENTS.md 明示「骨架仅成功路径」 |
| R2 | release 失败的诊断信号暂缺（observer 未发射事件） | 低（best-effort 观测，不影响业务结局） | 观测票落地 ADR L161 义务；业务不变量（仍 201、恰一次）已由契约钉死 |
| R3 | CI 断链风险：漏改根 `package.json` typecheck 链或漏再生成 `pnpm-lock.yaml` → CI 安装/类型门失败 | 中（流程性，易漏） | ALLOW LIST 显式列出两处 + §12 验证命令含 `pnpm install && pnpm typecheck` |
| R4 | body 读取暂无上限、不接 `Request.signal`（limits 延后） | 中（仅受信 localhost/内网暴露——ADR L36 前提） | limits 票叠加；AGENTS.md 写明首版受信环境约束，禁止公网暴露 |
| R5 | 405 body 的 `code:'METHOD_NOT_ALLOWED'` 为临时值，错误契约票可能改名 | 低（测试未断言、非冻结面） | D4 表显式标注「临时」；错误契约票定稿时统一 |
| R6 | H1–H4 仲裁若被 SA2 推翻（如 handle 返回形状改判）→ 契约测试需回写 | 低（四假设均有 ADR 条款直证） | 走 SA6 修订轮同步测试，实现方不得擅改（DENY LIST 第一行） |
| R7 | 回滚 | 低 | 本票改动全部为**新增文件 + 两处配置追加**（root package.json 一行、lockfile 再生成）；回滚 = 删 `packages/namespace-api/`（保留 test 目录即回到红灯基线）+ 还原两配置；无上游行为耦合 |

**任务内必要条件**（不伪装成 follow-up）：上表 R1–R6 均为已裁决的延后切片或流程登记，无未决
设计缺口。**明确的 follow-up**（后续 ticket / Controller 清单，非本票）：

- FR-1 请求形状校验 + limits + signal 中断（ADR step 3–5、L103–115）；
- FR-2 ADR 0015 状态「提议 → 已接受」（Controller 收官清单，延续 #266 B2）；
- FR-3 Registry 失败映射 + 错误 problem shape + issues 截断（ADR §错误契约）；
- FR-4 observer 事件契约（metrics 低基数事件、diagnostic 三类事件、throw 隔离）；
- FR-5 server composition root：共享同一 Registry 引用装配 REST 与 WS、role 自 Instance
  service 注入（B-1 的消费者侧闭环）、集成验收（ADR L210）。

## 14. 评审修订映射

`wiki/raw/task_issue-267_sa2_review.md`（SA2，iteration 0，verdict `approve`：0 BLOCKER / 0 MAJOR /
4 MINOR）已产出，其 BLOCKER/MAJOR 修订义务为空；四条 MINOR 均为文字精度/惯例补全，设计语义零
变更，由 SA3 在实现轮随实现一并落实（SA8 设计后复审 `task_issue-267_design_conflict_report.md`
verdict `clear`、`requiresConflictRecheck: false`——其前提即「SA2 修订仅落入 A-1/A-2 文字勘误或
已裁定设计边界内微调」）。

| Finding ID | Severity | 修订位置 | 落实内容 |
|---|---|---|---|
| F-M1 | MINOR | §2 锚点 8、§11 ALLOW（`AGENTS.md` 行） | 「逐一列出 13 个 tsconfig」→「13 个包 + 1 个 app（14 项 tsconfig）」；「12 包惯例」→「13 个既有包惯例」 |
| F-M2 | MINOR | §8.5 数据流表、§12 映射表 | role suite「后 6 用例」→「后 5 用例（3 route/method + 2 构造门）」；分组计数 7 + 3 + 2 = 12 |
| F-M3 | MINOR | §2 锚点 11、§12「类型面干净」行 | 全局 `Request/Response/Headers` 的 operative 证据改为 `@types/node` web-globals 全局声明 + 根 `pnpm typecheck` 链（本包 tsconfig 已入链）；不再引用 SA6 `--typecheck` 输出作为可解析性证据（其 include 仅 `*.test-d.ts`） |
| F-M4 | MINOR | §11 ALLOW LIST | 显式纳入 `packages/namespace-api/README.md`（13/13 既有包 README 惯例补全），实现随包建立 |

§14 原记「无评审输入，本节留空」由本表取代。

## 15. 是否需要设计后 ADR 冲突复查

**需要（`requiresConflictRecheck: true`）**。理由：

1. 本设计新建公共 REST API 面：`@nomicore/namespace-api` 包 exports（`.` + `./rest`）、
   `createRestRouter` 构造签名与 `handle` 判别结果契约——公共 API 变化；
2. 新增 HTTP 失败语义落地：403 `INSTANCE_ROLE_FORBIDDEN`、405 + `Allow: POST`、release 失败
   仍 201 的 Lease 编排时序——失败语义与生命周期面；
3. SA8 前置门禁已置 `requiresConflictRecheck: true` 并移交 B-1（role 单真相）/B-2（observer
   构造面）/B-3（固定顺序不被 reorder）三项边界条件，须逐项在设计后复审闭合（本设计 §6 已
   给出对应落点：D8 / D7+D2 / §8.2–8.5）；
4. ADR 0015 现为「提议」状态，本票是其首个体实现——设计对提议条款的解释（如「判别结果」
   的具体形状、`./rest` 的源文件布局、observer 零参签名的演进兼容论证）应经复审确认不构成
   对在途决策的隐性修订。

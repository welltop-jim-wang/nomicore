# SA4 实现评审 — issue #267：REST router 骨架（Hub create 成功路径 + Peer role gate + Lease 生命周期）

> SA4（mabf-sa4）实现静态审查，iteration 0。dispatch：`sa-a0b74efa-4d52-46e2-9cdd-20cff3806cc2`。
> 被审对象：SA3 交付的实现（`packages/namespace-api/` 本体 + 根接线），基线 HEAD `8fa85d2`
> （branch `mabf/issue-267`）。审查方式：只读静态审查（源码、测试源码、设计、ADR、Git
> status/diff、manifest/lockfile、CI 配置逐一实读）；按 SA4 纪律不运行测试、不启动服务、
> 不创建临时进程。
> Issue comments REST snapshot：空（`[]`）——无 Owner 追加要求、无 override 授权。

## 1. Reviewed inputs

| 输入（固定位置） | 状态 |
|---|---|
| `wiki/raw/task_issue-267.md`（任务简报，AC1–AC6，updated 2026-09-10T17:00:20Z） | 已读 |
| `wiki/raw/task_issue-267_design.md`（SA1 设计 + SA3 落实的 F-M1–F-M4 修订与 D1 范围注记） | 已读（568 行全读） |
| `wiki/raw/task_issue-267_sa2_review.md`（SA2，`approve`，0 BLOCKER / 0 MAJOR / 4 MINOR） | 已读 |
| `wiki/raw/task_issue-267_sa6_contract.md`（SA6，`approve`，35 用例红灯契约 + §13.4 哈希 + M1–M10 变异矩阵） | 已读 |
| `wiki/raw/task_issue-267_conflict_report.md`（SA8 前置门禁 `clear`；B-1/B-2/B-3；冻结面 9 项） | 已读 |
| `wiki/raw/task_issue-267_design_conflict_report.md`（SA8 设计后复审 `clear`；重开条件 5 项） | 已读 |
| `wiki/raw/task_issue-267_relevant_decisions.md`（ADR 0015/0009/0010/0012/0006 + CONTEXT.md 摘录） | 已读 |
| `wiki/raw/task_issue-267_sa3_impl.md`（SA3 实现报告） | 已读 |
| 实现本体：`packages/namespace-api/{package.json,tsconfig.json,AGENTS.md,README.md}`、`src/{rest.ts,create-namespace.ts,index.ts}` | 逐文件全读 |
| 契约测试 5 文件（`packages/namespace-api/test/`） | 逐文件全读 + sha256 复核 |
| 上游锚点：`packages/namespace-registry/src/{index.ts,types.ts}`（`InstanceRole` re-export L40、`CreateNamespaceInput` L252、`create` L691）、`packages/vfsl/src/index.ts`（`deriveSchemaIdentity`）、`packages/persistence/src/{index,testing}.ts`、`packages/ws-replication/package.json`（devDep 先例）、`packages/namespace-registry/package.json`（manifest 惯例） | 已读/已 grep |
| 工程接线：根 `package.json` diff、`pnpm-lock.yaml` diff、`tsconfig.base.json`、`tsconfig.typecheck.json`、`vitest.config.ts`、`pnpm-workspace.yaml`、`.gitignore`、`.github/workflows/ci.yml`、`scripts/{ci-test-shard,package-catalog,build-package}.mjs` | 已读/已 diff |
| governing 决策 `docs/adr/0015-vertical-rest-namespace-create.md`（模块装配 / 受信环境与角色 / HTTP 契约 / 执行顺序与 Lease / Observability / 测试决策各节） | 已读 |

## 2. Verdict

**`approve`** —— 无 BLOCKER、无 MAJOR、无需回流的设计偏离。

一句话理由：实现是批准设计的逐条兑现——判定顺序（raw path → method 405 → role 403 →
owner 捕获 → body 读取 → 派生 → envelope → `Registry.create` → DTO 复制 → 恰一次
awaited release → settle 后 201）、三个响应形状（405 + `allow:'POST'` 恰值、403 +
`INSTANCE_ROLE_FORBIDDEN` 逐字、201 恰两键/三键无 `Location`）、D2 构造面（读取→校验→
复制→冻结 + 普通 `TypeError`）、D5 fail-loud（未映射结局一律 rejection，仅 release 失败
被吞）、D6 Lease 编排（DTO 在 release 前复制、Response 在 settle 后构造）与设计 §8 伪码
及 ADR 0015 L18–32/L38–41/L65–90/L148–161/L186 逐字对齐；冻结面零触碰、SA6 契约测试
字节零改动（sha256 逐位一致）、上游 13 包零修改、文件范围恰为 ALLOW LIST；工程接线
（根 typecheck 链 +1、lockfile 再生成、persistence devDep 有 ws-replication 先例）闭合；
SA2 F-M1–F-M4 与 SA2 §14 观察 1 均已落实；静态未发现落入 SA6 M1–M10 任一变异形态。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| Issue 正文：建 `@nomicore/namespace-api`，`/rest` 子路径，首版只公开 router，create 编排包内私有 | `package.json` exports 恰 `.` + `./rest` 三条件；`src/create-namespace.ts` 不进 exports、不被 `src/index.ts` re-export，仅 `rest.ts` 相对导入；接线锚 `rest-public-seam-wiring.test.ts` 断言面满足 | ✓ |
| Issue 正文：router 为 Host 无关普通 Module（非 Cordis plugin）、`Request → Response` + 判别结果；不拥有 listener/auth/CORS/TLS/RequestID/并发/drain | `rest.ts` 头注 + 实现：零 Cordis 依赖（manifest deps 仅 registry + vfsl）；`RestHandledResult` 判别联合；无 listener/timer/队列 | ✓ |
| Issue 正文：配置构造时读取、校验、复制并冻结；构造配置错误普通 `TypeError` | `createRestRouter` L119–153：对象/role/registry.create/两 observer 校验全 `TypeError`；`Object.freeze(config)`（limits 浅复制冻结） | ✓ |
| AC1：Hub 完整走通并返回 201，恰含 `namespaceId` + schema identity（`sc1-`），无 `Location` | `create-namespace.ts` L67–80：frozen DTO 恰 `{namespaceId, schema{lang,version,id}}`（identity 取 `derived.schemaId`，非 envelope 展开）；`headers` 仅 content-type，不设 location | ✓ |
| AC2：Peer 在 route 匹配后立即 403 + `INSTANCE_ROLE_FORBIDDEN`，不解析 owner、不读 body | `rest.ts` L161–166：path 匹配 → method 判定 → `config.role !== 'hub'` → 403；403 分支前零 body 成员调用、零 owner decode、零 Registry 触达（poison registry / trapped body 契约面覆盖） | ✓ |
| AC3：同一契约 Memory/File 双持久化、断言持久化事实/Lease 释放/后续 open、不读内部结构 | 契约测试（冻结字节）参数化双适配器 + 重启 durability；harness 只走公共/testing 面；实现不依赖内部结构 | ✓ |
| AC4：DTO 在 release 前复制；release 恰一次；release 失败仍 201 | L64–75：`lease.namespaceId` 在 release 调用前读入 frozen DTO；release 调用点唯一（try 块内恰一次）；catch 吞失败后仍构造 201；Response 构造点在 `await release()` settle 之后 | ✓ |
| AC5：新建 namespace 为 `replication-disabled` | REST 恒三键输入（owner/schema/root），无 META/复制身份通道；Registry 既有机制自然导出（零新增行为） | ✓ |
| AC6：route 大小写敏感、无尾随斜杠 canonical；已知 path 非 POST → 405 + `Allow: POST` | `CREATE_NAMESPACE_ROUTE = /^\/v1\/owners\/([^/]+)\/namespaces$/`（无 `i` 旗标、`$` 锚、`[^/]+` 段约束）；`methodNotAllowedResponse()` 状态 405 + `allow: 'POST'` 恰值；path 匹配先于 method 判定 | ✓ |
| Issue 正文：本票只做成功路径与 role gate（形状校验/limits/失败映射/observer 延后） | 无任何 4xx/5xx 映射分支（除冻结的 405/403）；limits 参数位保留未消费；零事件发射；延后面以 rejection 不实现而非错实现 | ✓ |
| SA2 F-M1–F-M4（4 MINOR） | 设计 §2 锚点 8 / §8.5 / §12 / §11 已按修订映射落实；`README.md` 已建并入 ALLOW | ✓ |
| SA2 §14 观察 1（D5 fail-loud 写入包契约） | `AGENTS.md` Boundaries：「Unmapped outcomes … **reject** `handle` — this skeleton never invents HTTP error mappings」 | ✓ |
| Owner 评论 | Issue comments REST snapshot 为空（`[]`）——无映射义务 | — |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1 包与公共 seam（manifest 镜像 registry 惯例、私有编排、tsconfig、根链 +1、lockfile 再生成） | `package.json`（与 `packages/namespace-registry/package.json` 逐字段同款：三条件 exports/scripts/build 脚本/打包字段）；`tsconfig.json` extends base + include `src/**`；根 `package.json` diff 在 namespace-registry 后插入 namespace-api；lockfile 新增 importer（2 deps + 4 devDeps 与 manifest 逐项一致） | ✓ | — |
| D1 SA3 范围注记：`@nomicore/persistence` devDependency（test-only） | manifest devDeps 含 `@nomicore/persistence: workspace:*`；先例实证 `packages/ws-replication/package.json` devDependencies 同款；`packages/persistence/src/{index,testing}.ts` 存在、`packages/namespace-api/node_modules/@nomicore/{persistence,registry,vfsl}` 链接就位 | ✓ 范围内 manifest 细节（`tsconfig.typecheck.json` include `packages/*/test/**` 要求包内可解析；`dependencies`/exports 零变化） | — |
| D2 构造面（校验表 + 复制冻结 + 普通 TypeError） | `rest.ts` L119–153：五项判定顺序与 D2 表逐行一致；`limits` 未校验未消费（设计明示切片边界 N-1） | ✓ | — |
| D3 路由模型（单一冻结 regex、path 先于 method） | `rest.ts` L77、L156–163：regex 与设计逐字相同；`match === null → {matched:false}` 先于 `request.method !== 'POST'` | ✓ | — |
| D4 handle 判别结果与三响应形状 | `RestHandledResult` 联合；`methodNotAllowedResponse`（405 + allow:'POST' + content-type + `{code:'METHOD_NOT_ALLOWED'}` 临时值有代码注释标注 N-3）；`roleForbiddenResponse`（403 + 逐字冻结 code）；201（见 D6） | ✓ | — |
| D5 未映射结局 fail loud | `create-namespace.ts`：body 非 object/缺 schemaText/root 键/派生 `ok:false`/create `ok:false` 一律 `throw new Error`（两处带 `cause`）；无兜底 catch、无 500 伪装；body·JSON 异常原样传播 | ✓ | — |
| D6 Lease 编排 | `create-namespace.ts` L64–80：DTO（string 值 + frozen）在 release 前构造；`await lease.release()` 恰一次于 try 块；catch 吞失败；Response 在 settle 后从 DTO 构造 | ✓（SA6 M2/M3/M4/M5 变异形态均未落入） | — |
| D7 Observability（B-2 边界） | 两 observer 必选 + `TypeError`；零参 `() => void`；包内零调用点（零事件发射）；ADR L161 诊断上报延后 FR-4 而业务不变量完整 | ✓ | — |
| D8 role 单真相（B-1） | `import type { InstanceRole } from '@nomicore/namespace-registry'`（公共 re-export L40 实证）；包内零默认值、零 `process.env`（grep src 零命中）；JSDoc + AGENTS.md 写明 composition root 注入义务 | ✓ | — |
| D9 无状态与并发 | frozen config 外零状态；`handle` 普通异步闭包；无队列/锁/监听器/定时器 | ✓ | — |
| §8.4 create 编排伪码 | 实现逐语句对应（`request.json()` → 机械提取 → `deriveSchemaIdentity` → 四键 envelope → 恰三键 create → DTO → release → 201）；差异仅 `record['schemaText']` 括号取值（语义等价的风格差异） | ✓ | — |
| §12 验证命令 | SA3 报告 §Verification 1–9 记录命令与输出（含首跑 CI typecheck 入口红 → 修复 → 转绿的诚实基线对照）；静态核对其与树状态一致（链 +1、链接就位、哈希一致） | ✓ | — |

设计明确但实现缺失项：**无**。

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 路由/method/role 判定 + 403/405/201 构造 | `@nomicore/namespace-api`（ADR 0015 指定） | `src/rest.ts` | ✓ |
| schema identity 派生 | `@nomicore/vfsl` 窄接口 | 仅消费 `deriveSchemaIdentity`，零重算 | ✓ |
| namespace 创建/namespaceId/原子性/CSPRNG | Registry | 仅 `registry.create` 调用 | ✓ |
| 快照/深冻结/持久化 | Registry 管线 + Persistence | REST 不深拷贝（root 原值透传） | ✓ |
| role 值生产 | Instance service（FR-5 消费者侧） | 类型 + 文档钉住；包内零生产点 | ✓ |
| listener/auth/CORS/TLS/drain | 未来 server | 明确不拥有 | ✓ |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 普通模块工厂 + 构造期形状门禁 + 冻结配置 | `createNamespaceRegistry(options)`（ADR 0009 纪律） | `createRestRouter(options)` | 一致 | 同款 TypeError 门禁 + freeze |
| manifest/子路径/私有编排 | 13 既有包 `.`(+`./testing`) 三条件 exports | `.` + `./rest` 三条件；无 `./testing`（无测试入口需求，不预建空 seam） | 一致 | registry manifest 逐字段镜像；SA8 S1 复核同款 |
| test-only workspace devDep | `packages/ws-replication` devDependencies | `@nomicore/persistence: workspace:*` devDep | 一致 | 先例实证；运行时 dependencies 不变 |
| Host 装配层 | `apps/yjs-server`（Cordis host） | router 非 plugin、零 Cordis 依赖 | 一致（有意分界） | ADR 0015 L20；FR-5 才装配 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 实例 role | Instance service（composition root） | frozen `config.role` 值拷贝 | 低：类型只认 `InstanceRole`；包内零默认/零 env（grep 证）；B-1 消费者侧归 FR-5 |
| namespaceId | Registry CSPRNG | DTO 内 string 值拷贝（release 前读入） | 无（M3 防御形态未落入） |
| schema identity | `deriveSchemaIdentity` | envelope `id` 与 DTO `schema.id`（同一 `derived.schemaId`） | 无（单一派生调用点） |
| 路由表 | 单一冻结 regex 常量 | — | 无 |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| router 构造（零资源获取） | 无需 dispose（接口即无 dispose） | 构造失败 → 同步 `TypeError`，零残留 | ✓ 对称 |
| lease（create 成功签发） | `release()` 恰一次；create-ok 与 release 调用点之间无 throw 点（DTO 由字面量 + freeze 组成不可失败） | release 失败 → 吞 + 仍 201（ADR L161） | ✓ 对称（SA2 S12 复核成立） |
| 无订阅/后台任务/缓存 | — | — | ✓ 无泄漏面 |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二套 retry/cleanup worker | Registry 内碰撞重试 ≤8（Registry 契约） | REST 零重试循环（release 失败亦不重试） | 非重复 |
| 第二状态字段/镜像 | 无 | frozen config 外零状态 | 非重复 |
| 第二 role 配置源 | Instance service | 零（类型 + 文档钉住） | 非重复 |
| 第二套 HTTP router | 全仓无先例 | 首例（`grep ': Request\b'` 仅本域命中） | 记录：无凭空惯例声明 |

## 6. 文件范围审查

`git status --porcelain --untracked-files=all`（实测）与 ALLOW LIST 逐项对照：

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/namespace-api/package.json`（新建） | §11 第 1 行（§7 D1 + SA3 范围注记） | 公共 seam + 依赖声明 | ✓ |
| `packages/namespace-api/tsconfig.json`（新建） | §11 第 2 行 | 包类型门 | ✓ |
| `packages/namespace-api/src/rest.ts`（新建） | §11 第 3 行 | 公共 router 面（契约 H3 import 目标） | ✓ |
| `packages/namespace-api/src/create-namespace.ts`（新建） | §11 第 4 行 | 私有 create 编排 | ✓ |
| `packages/namespace-api/src/index.ts`（新建） | §11 第 5 行 | `.` 入口 re-export | ✓ |
| `packages/namespace-api/AGENTS.md`（新建） | §11 第 6 行 | 包契约 | ✓ |
| `packages/namespace-api/README.md`（新建） | §11 第 7 行（F-M4 增补行） | README 惯例 | ✓ |
| `package.json`（根，修改） | §11 第 8 行 | typecheck 链插入 namespace-api（diff 实测恰一行、位置在 namespace-registry 后） | ✓ |
| `pnpm-lock.yaml`（修改） | §11 第 9 行 | 新 importer（diff 实测 +22 行、与 manifest 逐项一致） | ✓ |
| `wiki/raw/task_issue-267_design.md`（SA3 依 dispatch 落实 F-M1–F-M4 + D1 注记） | §11 末行 + dispatch 指令 | 文字修订，零语义变更 | ✓ |
| `wiki/raw/task_issue-267_sa3_impl.md`（新建） | 技能固定产物 | 实现报告 | ✓ |
| `packages/namespace-api/node_modules/`（安装产物） | — | 根 `.gitignore` `node_modules/` 命中（实测） | ✓ 不入库 |

DENY LIST 核对：`packages/namespace-api/test/*` 5 文件 sha256 与 SA6 §13.4 **逐位一致**
（`0549f11b…`/`b812b38b…`/`181449a0…`/`e61a23eb…`/`1010b616…`，本轮 sha256sum 实测）——
零测试字节改动；上游 13 包、`docs/adr/*`（ADR 0015 状态未翻转）、`CONTEXT.md`、
`vitest.config.ts`、`docs/**`、`apps/**`、`domains/**`、`scripts/**`、`.github/**` 均零改动
（git status 实测仅上表条目）。无范围外文件、无 `dist/`/`tsconfig.build.json`/临时诊断件残留。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| `@nomicore/namespace-api`（新公共面 `createRestRouter`/`handle`） | 无既有调用方（`grep -r namespace-api` 于 packages/apps/domains/scripts 的 ts/json/mjs 零命中，实测） | 被调方交付；接线义务（role 取自 Instance service、`{matched}` 判别路由族）写入 AGENTS.md/README/JSDoc | 无 | — |
| `@nomicore/vfsl` `deriveSchemaIdentity` | 新增只读消费者 | `ok:true` 消费 `schemaId`；`ok:false` → fail-loud rejection（cause: issues） | 无 | — |
| `@nomicore/namespace-registry` 公共面 | 新消费者 | 只调用 `create`/`lease.namespaceId`/`lease.release`；类型 `InstanceRole`/`NamespaceRegistry` 只读导入；Registry/Lease 语义零扩展 | 无 | — |
| 根 `package.json` typecheck 链消费者（CI typecheck 作业/开发者/packaging） | 链 14→15 项 | diff 实测恰 +1 项；`pnpm typecheck` 语义闭合 | 无 | — |
| `pnpm install --frozen-lockfile`（CI 五处） | 新 importer | lockfile 已再生成且与 manifest 逐项一致（diff 实测） | 无 | — |
| CI test 分片（`scripts/ci-test-shard.mjs`） | 新测试文件 | 磁盘枚举（脚本 L11/L37 实测）自动纳入 4 个 `*.test.ts` | 无 | — |
| `tsconfig.typecheck.json`（CI `--typecheck.only` 作业） | harness 静态 import `@nomicore/persistence(/testing)` | devDependency 使包内可解析（`packages/namespace-api/node_modules/@nomicore/persistence` 链接实测就位）；SA3 记录首跑红→修复→绿的基线对照 | 无 | — |
| SA6 冻结契约测试 | 实现本体 | 契约字节零改动（哈希实证）；H1–H4 仲裁与实现公共面逐字段同形 | 无 | — |
| 打包/发布（`scripts/package-catalog.mjs`） | namespace-api 未登记 `publishPackages` | 不打包不发布（静态列表实测）；SA3 已登记 Controller follow-up | 低（流程登记，非本票义务） | — |

## 8. 错误、恢复与并发

静态逐路径核对（实现源码 + SA6 M1–M10 变异口径）：

- **吞错/伪装成功**：唯一 catch 是 release 失败（`create-namespace.ts` L71–75），且吞后仍
  返回真实 201（创建事实已成立）——ADR L161 冻结行为，非静默降级；无其他 catch，无
  fire-and-forget，无伪 500。✓
- **部分完成诚实报告**：create 原子性由 Registry 保证；201 仅在 create ok + release settle
  之后；任何 rejection 对应零 Response。✓
- **重试幂等**：REST 侧零重试——release 失败不重试不二次调用（调用点唯一、try 块内恰一次）；
  Registry 内部碰撞重试不外泄。✓
- **回滚**：无需 REST 侧回滚；DTO 构造点（字面量 + `Object.freeze`）在 create-ok 与
  release 调用点之间无 throw 点 ⇒ 成功路径 release 恒被调用，无 lease 泄漏。✓
- **并发**：frozen config 外零状态；`handle` 无串行化（ADR L208）；无 TOCTOU 面（配置冻结、
  每请求独立 Request）。✓
- **构造后变异**：config 值拷贝 + freeze（契约「改 `options.role` 行为不变」由实现满足）。✓
- **迟到回调/失败后复活**：无后台任务/定时器；`await release()` 无条件等待（S6 逐字行为）。✓
- **进程重启**：FilePersistence durability 由契约测试 + fixture.flush 覆盖；router 无持久状态。✓
- **`new URL(request.url)`**：非法 URL → TypeError 传播（fail loud，设计 §8.2 明示）。✓
- **`match[1]` 收窄**：`noUncheckedIndexedAccess` 下显式 undefined 检查 + throw（不可达分支
  fail loud，不编造 owner）。✓

静态无法确认的运行时风险列入 §11（后续动态验证项）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `rest-create-hub-contract.test.ts`（8×2 + 1 = 17） | AC1 201 形状/键集/无 Location/`sc1-` 与派生逐字一致；create 恰一次逐键输入（envelope 四键含原文 text）；AC4 release 恰一次/门 settle/失败仍 201/DTO 复制探针；AC3 后续 open 读回 ROOT 与原文 text；AC5 replication-disabled + `REPLICATION_NOT_ENABLED`；File-only 重启 durability | 根 vitest include `packages/*/test/**/*.test.ts` + CI 分片磁盘枚举 | 无 | — |
| `rest-role-gate-routing-contract.test.ts`（7+3+2 = 12） | Peer 五路 403（canonical/无 body/`text/plain`/percent-encoded/trapped body 零消费）+ poison registry 零触达；method gate 先于 role gate（Peer 非 POST → 405）；路径先于 method（`/V1/…` GET → `matched:false`）；构造门（缺 options/非法 role/缺任一 observer → `TypeError`；构造后改 role 行为不变） | 同上 | 无 | — |
| `rest-contract-support.test.ts`（5，恒绿锚） | `deriveSchemaIdentity` 身份锚；同 envelope 直接 Registry.create 双适配器全链（release/open/replication）；File 重启 durability；标准 Request 构造自证 | 同上 | 无 | — |
| `rest-public-seam-wiring.test.ts`（1） | manifest `exports['./rest'].nomicore-source` 指向存在源文件（显式声明为接线锚，非行为替代） | 同上 | 无（行为断言由另两 suite 承担） | — |
| `rest-contract-harness.ts`（fixture） | 真实 Registry/Persistence 委派 + 公共 seam 外观测包装 + poison/trapped 探针 | 非 `*.test.ts`，不被收集（SA6 `vitest list` 实证） | 无 | — |

SA6 红灯契约保持性：5 文件 sha256 与 SA6 §13.4 逐位一致（零字节改动）；无
`.only/.skip/todo`（grep 实测零命中）、无 `process.env` 注入（grep 实测）；断言全部为运行时
行为（状态/头/body/公共 seam 输入），唯一读文件的是接线锚且已显式声明；fixture 在 `finally`
中 `registry.shutdown + fixture.dispose + fixture.cleanup`（tmpdir `rm`）隔离清理；测试被仓库
真实入口发现（根 include + CI 分片磁盘枚举实测）。**测试未被真实 runner 触发或验收被弱化的
形态均不存在。** SA3 报告 35/35 绿（5 次复跑时间戳）与其静态事实链一致；SA4 按纪律未复跑，
动态确认列入 §11。

## 10. Required revisions

无。未发现 BLOCKER 或 MAJOR；MINOR 级观察见 §12（均不阻断 `approve`）。

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 契约套件实际绿灯（SA4 未运行测试；SA3 证据为 5 次复跑记录） | Controller 路由的动态验收（SA7/CI） | `NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run --typecheck packages/namespace-api/test` → 4 文件 35 用例全绿、`Type Errors: no errors` | 任一用例红或支撑文件回归 |
| 仓库全量测试与 CI 矩阵（test 分片 Node 20/24 + typecheck 作业 + `--frozen-lockfile` 安装） | CI | typecheck 作业 exit 0；分片纳入 4 个新测试文件且全绿；安装成功 | 分片漏跑/安装失败/类型红 |
| 根 `pnpm typecheck` 链 15 项全绿（含新包 src） | CI typecheck 作业/开发者 | exit 0 | 新包或既有包类型红 |
| 打包/发布目录登记（`scripts/package-catalog.mjs` 未含 namespace-api） | Controller follow-up（SA3 已登记） | 发布票显式决定登记或保持不发布 | 未登记却预期发布 |
| B-1 消费者侧闭环（role 实际取自 Instance service） | FR-5 server composition root 票 | 装配代码从 Instance service 读 role 注入 router | 出现第二 role 配置源 |

## 12. Non-blocking observations

1. `RestRouterConfig` 中两个 observer 经校验冻结但本票零调用——B-2 参数位保留的刻意设计
   （JSDoc/AGENTS.md 明示「本版不发射事件」），非死代码异味；FR-4 落地时成为唯一事件出口。
2. 设计 §8.3 伪码用条件展开省略 `limits` 键，实现用显式 `limits: undefined` 属性——内部
   frozen config 的等价形式（消费点为零），对外零可观察差异。
3. 构造期 registry 校验为形状级（仅 `create` 为函数）——设计 D2 明示决策（契约 poison
   registry 兼容依赖此点）；后续票若收紧需同步契约测试修订轮。
4. 405 body `code:'METHOD_NOT_ALLOWED'` 为临时值——代码注释与 SA8 N-3 已标注，非冻结面，
   FR-3 定稿；契约未断言。
5. SA3 Deviation-1（`@nomicore/persistence` devDep）经静态复核成立：`tsconfig.typecheck.json`
   include `packages/*/test/**` 要求 harness import 包内可解析、ws-replication 先例同款、
   `dependencies`/exports 零变化、设计 D1 已留范围注记——属范围内 manifest 细节，非设计偏离。
6. Hub 侧过渡期接受面（非 JSON Content-Type、额外 body 键、query、percent-encoded owner）
   在本票被接受或走 fail-loud rejection——全部为简文明示延后的 step 3–5（FR-1/FR-3），
   AGENTS.md/README 已如实披露，非静默扩大。

---

审查日期：2026-09-11（dispatch `sa-a0b74efa-4d52-46e2-9cdd-20cff3806cc2`，iteration 0，
implementation-review）。

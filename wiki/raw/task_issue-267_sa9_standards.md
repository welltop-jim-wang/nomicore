# SA9 标准评审 — issue #267：REST router 骨架（Hub create 成功路径 + Peer role gate + Lease 生命周期）

> SA9（mabf-sa9）独立标准评审产物，iteration 0。dispatch：`sa-5b673179-0de2-4b6a-b21e-453640cc40bf`。
> 被审对象：**committed HEAD `dc658e5e8564f60b20545111e275a18f9ded7085`**（branch `mabf/issue-267`，
> commit subject `feat(namespace-api): add REST namespace create router`）。
> 亲验基线：Parent PR #158 权威基座 `docs/rest-namespace-create@8fa85d27b0231e72d23f41fbcbfd1affe4c2ee1d`
> **是 HEAD 的直接父提交**（`git merge-base --is-ancestor` 实测成立；HEAD 恰为基座上 +1 commit）。
> Issue comments REST snapshot 为空（`[]`，派发指令与任务简报/SA6/SA8 四方同证）——无 Owner 追加
> 要求、无 override 授权。
> 审查方式：只读静态审查（HEAD 内容、`git diff 8fa85d2..dc658e5` 全量、固定位置上游产物逐一实读）；
> 按 SA9 纪律不运行测试、不启动服务、不修改任何代码/设计/测试。
> 本评审只判断标准符合性与交付就绪；Issue 需求完整实现与否归 SA10，冲突裁决归 SA8。

## 1. Reviewed inputs（固定位置证据，全部实读）

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-267.md`（任务简报：AC1–AC6、Parent PR #158、Blocked by #266、comments 空） | 已读 |
| `wiki/raw/task_267_dispatch.md`（SA8 conflict-gate iter 0 派发日志） | 已读 |
| `wiki/raw/task_issue-267_relevant_decisions.md`（SA8 决策摘录：ADR 0015 §1.1–1.7、0009/0010/0012/0006、CONTEXT.md） | 已读 |
| `wiki/raw/task_issue-267_conflict_report.md`（SA8 前置门禁 `clear`，13 项裁决，冻结面 9 项，B-1/B-2/B-3 移交） | 已读 |
| `wiki/raw/task_issue-267_design.md`（SA1 设计 + SA3 落实的 F-M1–F-M4 修订与 D1 范围注记，568 行） | 已读 |
| `wiki/raw/task_issue-267_design_conflict_report.md`（SA8 设计后复审 `clear`，`requiresConflictRecheck: false`，重开条件 5 项，A-1/A-2、N-1–N-3） | 已读 |
| `wiki/raw/task_issue-267_sa2_review.md`（SA2 `approve`，0 BLOCKER / 0 MAJOR / 4 MINOR） | 已读 |
| `wiki/raw/task_issue-267_sa6_contract.md`（SA6 `approve`，35 用例红灯契约 + §13.4 sha256 基线 + M1–M10 变异矩阵） | 已读 |
| `wiki/raw/task_issue-267_sa3_impl.md`（SA3 实现报告：验证记录 1–9、Deviation-1、follow-up 登记） | 已读 |
| `wiki/raw/task_issue-267_sa4_review.md`（SA4 `approve`，0 BLOCKER / 0 MAJOR，静态复核） | 已读 |
| HEAD 实现本体：`packages/namespace-api/{package.json,tsconfig.json,AGENTS.md,README.md}`、`src/{rest.ts,create-namespace.ts,index.ts}` | 逐文件全读 |
| HEAD 契约测试 5 文件 sha256 实测 | 与 SA6 §13.4 五组哈希**逐位一致**（零测试字节改动） |
| `git diff 8fa85d2..dc658e5` 全量（22 文件，+3458/−1） | 逐文件核对 |
| 根 `AGENTS.md`、根 `CONTEXT.md`（无 diff 实证）、`packages/namespace-api/AGENTS.md`（随包新建）、`docs/agents/issue-tracker.md` | 已读 |
| 工程惯例锚点：`packages/namespace-registry/package.json`（manifest 镜像源）、`tsconfig.base.json`、`.github/workflows/ci.yml`（无 diff）、`pnpm-workspace.yaml`、`.gitignore`、git log 提交信息惯例 | 已读/已核对 |

## 2. Verdict

**`approve`** —— 0 BLOCKER / 0 MAJOR / 0 MINOR。

一句话理由：committed HEAD 是批准设计与 SA8 冻结面的逐字兑现——交付面恰为设计 §11 ALLOW
LIST（新包 8 文件 + 根 `package.json` 一行 + `pnpm-lock.yaml` 再生成 + 设计/实现报告），SA6
冻结契约 5 测试文件以**字节零改动**入库（sha256 与 §13.4 逐位一致），上游 13 包 / `docs/**` /
`CONTEXT.md` / `vitest.config.ts` / `.github/**` 全部零 diff；实现满足包级 AGENTS.md 全部
Boundaries、ADR 0015 各冻结条款与 B-1/B-2/B-3 顺序义务；单一事实源、生命周期对称、模块责任
归属、既有工程惯例（manifest 镜像、typecheck 链逐一列出、lockfile 同步）逐项闭合；SA8 设计后
复审列举的 5 项冲突重开条件在实现层**无一命中**；测试质量标准继承 SA6 已批准基线（变异敏感、
无 skip/only/env、真实 runner 入口发现）。

## 3. 仓库 AGENTS 与模块纪律符合性

| 标准 | 证据（HEAD 实测） | 结论 |
|---|---|---|
| 根 AGENTS.md「改 `packages/` 前读最近嵌套 AGENTS.md；新包随包建立契约文件」 | `packages/namespace-api/AGENTS.md` 随包新建（Contract/Boundaries/Verification 三节，与 registry/vfsl 等 13 包同款惯例） | ✓ |
| 包 AGENTS.md Boundaries：公共面恰 `src/index.ts` + `./rest`；`create-namespace.ts` 包内私有 | manifest exports 恰 `.` + `./rest` 两 subpath；`src/index.ts` 只 re-export `./rest.js` 公共面（`createRestRouter` + 4 类型）；`create-namespace.ts` 不进 exports、不被 index re-export、仅 `rest.ts` 相对导入——私有性由打包面结构性保证 | ✓ |
| 构造读取/校验/复制/冻结 + 普通 `TypeError`；两 observer 必选显式注入 | `rest.ts` L119–153：options 对象/role 联合/registry.create 函数/两 observer 函数五项判定全 `TypeError`；`Object.freeze(config)`（limits 浅复制冻结）；observer 零参 `() => void`、包内零调用点（本票零发射，符合「this version emits no events」自约） | ✓ |
| role 单真相（ADR 0012 / B-1） | `role: InstanceRole` 类型自 `@nomicore/namespace-registry` 公共 re-export 导入（`import type`，与 `@nomicore/instance` 同一联合的结构投影）；grep `process.env` 于 src/test **零命中**；包内零 role 默认值、零第二配置源；JSDoc + AGENTS.md + README 三处钉住「值须由 composition root 从 Instance service 注入」；本票无 composition root 消费者（消费者侧闭环登记 FR-5） | ✓ |
| 固定顺序不 reorder（B-3） | `rest.ts` L155–176：raw path 匹配 → method gate（405 + `allow:'POST'`）→ role gate（403）→ owner 捕获 → `orchestrateCreateNamespace`；`create-namespace.ts` L36–80：body 读取 → 机械提取 → `deriveSchemaIdentity` → 四键 envelope → `registry.create` 恰三键 → DTO 复制 → 恰一次 `await lease.release()` → settle 后构造 201；Peer 分支在 role gate 前零 owner 解码/零 body 成员调用/零 Registry 触达 | ✓ |
| 201 恰含 `namespaceId` + `schema{lang,version,id}`、无 `Location`；release 失败仍 201 不重复调用 | DTO 显式两键/三键 frozen（不从含 `text` 的 envelope 展开）；`headers` 仅 content-type；release 调用点唯一且在 try 块内恰一次，catch 吞失败后沿用同一 DTO 返回 201 | ✓ |
| 未映射结局一律 `handle` rejection，不发明 HTTP 错误映射 | `create-namespace.ts`：顶层形状/schemaText 类型/派生 `ok:false`/create `ok:false` 均 `throw new Error`（两处带 `cause`）；body·JSON 异常原样传播；`rest.ts` `new URL` 非法 URL → rejection；无兜底 catch、无 500 伪装 | ✓ |
| 延后切片不提前实现（形状校验/limits/signal/失败映射/observer 事件） | 无任何 4xx/5xx 映射分支（除冻结的 405/403）；`limits` 参数位保留、不校验不消费；零事件发射；不接 `Request.signal` | ✓ |
| Typed Namespace writes 强制条款 | **不适用**（SA8 前置门禁行 12 同款裁决）：router 不持 lease 做 `mutateData()` 类型化写；`root` 经 `Registry.create` 整体提交，写者是 Registry 管线 | ✓ |
| 测试纪律（包 AGENTS.md：契约测试不得为迎合实现而修改） | 5 测试文件 sha256 与 SA6 §13.4 逐位一致——零字节改动入库 | ✓ |

## 4. ADR / CONTEXT.md 符合性

| 决策条款 | HEAD 落实 | 结论 |
|---|---|---|
| ADR 0015 L18–32（模块与装配：`/rest` 暴露、首版只公开 router、编排私有、普通 Module 非 Cordis plugin、`Request→Response` + 判别结果、不拥有 listener/auth/CORS/TLS/RequestID/并发/drain、构造冻结 + `TypeError`） | manifest `.` + `./rest`；零 Cordis 依赖（deps 仅 registry + vfsl）；`RestHandledResult` 判别联合；无 listener/timer/队列；D2 构造面逐项 | ✓ |
| ADR 0015 L36–43（Peer 403 + `INSTANCE_ROLE_FORBIDDEN` 先于 owner/body；新建默认 `replication-disabled`） | role gate 位置与零触达顺序逐字；REST 恒三键输入无 META 通道，`replication-disabled` 为 Registry 既有机制自然导出（零新增行为） | ✓ |
| ADR 0015 L49–90（HTTP 契约：大小写敏感 canonical 无尾随斜杠、405 + `Allow: POST`、201 恰两键/三键无 `Location`） | `CREATE_NAMESPACE_ROUTE = /^\/v1\/owners\/([^/]+)\/namespaces$/`（无 `i` 旗标、`$` 锚、段数恰 5、空段 fail closed）；`allow: 'POST'` 恰值；201 形状见 §3 | ✓ |
| ADR 0015 L148–161（执行顺序 step 1→2→…→10；release 失败仍 201 不重复调用） | 见 §3 固定顺序行；step 3–5 延后面以 rejection 结算、不产生任何 HTTP 可观察顺序（无从反序） | ✓ |
| ADR 0015 L119–144（`sc1-` 只消费不重算；先派生→完整四键 envelope→Registry create） | 单一 `deriveSchemaIdentity` 调用点；envelope 恰 `{lang:'vfsl',version:1,id,text}` 四键；`registry.create({owner:{userId},schema,root})` 恰三键 | ✓ |
| ADR 0015 L186（两同步 void observer 必须显式注入，no-op 须显式） | 构造签名必选 + 缺失/非函数 → `TypeError` | ✓ |
| ADR 0015 L194–210（测试 seam：双 Persistence 同契约、不读内部结构） | 契约测试字节零改动（SA6 已批准基线继承） | ✓ |
| ADR 0009（Registry 公共面与 Lease 契约不变） | 只调用 `create`/`lease.namespaceId`/`release`；零 Registry 扩展、零 release 语义修改；「恰一次」由调用纪律保证（不依赖幂等，更严且相容） | ✓ |
| ADR 0010 L28/L120 + #134 O-7（namespaceId 由 Registry CSPRNG；复制身份仅 Hub 管理操作安装） | REST 不传 namespaceId、不触复制身份 | ✓ |
| ADR 0012（instanceId + role 单真相） | 见 §3 role 单真相行；类型 + 文档钉住，消费侧归 FR-5 | ✓ |
| ADR 0015 状态「提议」不得由实现链自行翻转（DENY LIST；FR-2 归 Controller） | `docs/adr/0015` 在 `8fa85d2..dc658e5` 零 diff，L4 仍「状态：提议」 | ✓ |
| CONTEXT.md 零新域词 | `CONTEXT.md` 零 diff；实现只用既有词条（owner/namespaceId/信封/内容寻址 schema ID/Hub·Peer/lease） | ✓ |

## 5. 架构惯例、单一事实源、生命周期对称性

### 5.1 工程惯例

| 惯例 | HEAD 证据 | 结论 |
|---|---|---|
| manifest 镜像既有包（三条件 exports/scripts/打包字段） | 与 `packages/namespace-registry/package.json` 逐字段同款（diff 实测仅 name/version/subpath/deps 的正当差异）；`./rest` 替代 `./testing` 属设计明示（无 testing 入口需求，不预建空 seam） | ✓ |
| tsconfig 惯例 | `extends ../../tsconfig.base.json` + `include: ["src/**/*.ts"]`（registry 同款） | ✓ |
| 根 `pnpm typecheck` 逐包列出惯例 | diff 实测**恰一行**：`tsc -p packages/namespace-api/tsconfig.json` 插入 namespace-registry 项后（链 14 → 15 项），位置与设计 §7 D1 一致 | ✓ |
| lockfile 同步（CI 五处 `--frozen-lockfile`） | `pnpm-lock.yaml` +22 行：`packages/namespace-api` importer（2 deps + 4 devDeps）与 manifest 逐项一致；SA3 验证记录 2 实测 `pnpm install --frozen-lockfile` exit 0 | ✓ |
| test-only workspace devDep 先例 | `@nomicore/persistence: workspace:*` 为 **devDependency**（镜像 `packages/ws-replication` 先例，SA4 §4 实证）；`dependencies`/exports 零变化——SA3 Deviation-1 属范围内 manifest 细节，设计 D1 已留范围注记，非设计偏离 | ✓ |
| `.gitignore` 覆盖安装产物 | 根 `.gitignore` `node_modules/` 命中包级 node_modules；HEAD 无 `dist/`/`tsconfig.build.json`/临时诊断件入库（`git ls-files` 实测） | ✓ |
| CI/测试入口零改动 | `.github/**`、`vitest.config.ts`、`scripts/**` 零 diff；新测试文件经根 include + CI 分片磁盘枚举自动纳入（SA2/SA4 已核） | ✓ |
| 提交信息惯例 | `feat(namespace-api): add REST namespace create router` 符合仓库并存的 `type(scope): …` 款（先例 `feat(vfsl-codegen)`/`fix(ws-replication)`/`perf(doc-runtime)`）；追溯性经 branch `mabf/issue-267` + 集成 PR #158 保持 | ✓（见 §8 观察 1） |

### 5.2 单一事实源

| 事实 | 权威源 | HEAD 派生态 | 漂移风险 |
|---|---|---|---|
| 实例 role | Instance service（composition root 注入） | frozen `config.role` 值拷贝；类型只认 `InstanceRole`；零 env/零默认 | 低（消费侧接线归 FR-5，已登记） |
| schema identity | `deriveSchemaIdentity`（@nomicore/vfsl） | envelope `id` 与 DTO `schema.id` 同源同一 `derived.schemaId`；零重算 | 无 |
| namespaceId | Registry CSPRNG | release 前 string 值拷贝入 DTO | 无 |
| 路由表 | 单一冻结 regex 常量 | — | 无 |
| envelope 上下文常量 | `SCHEMA_LANG`/`SCHEMA_VERSION` 常量（create-namespace.ts L18–19） | 单点定义 | 无 |

### 5.3 生命周期对称性

| 获取 | 释放 | 失败恢复 | 结论 |
|---|---|---|---|
| router 构造（零资源获取：无监听器/定时器/句柄/订阅） | 无需 dispose（接口即无 dispose，JSDoc 明示） | 构造失败 → 同步 `TypeError`，零残留 | ✓ 对称 |
| lease（`registry.create` 成功签发） | `await lease.release()` 恰一次；create-ok 与 release 调用点之间无 throw 点（DTO 由字面量 + `Object.freeze` 组成，不可失败） | release 失败 → 吞 + 仍 201（ADR L161 冻结行为）；release 前的任何失败对应 lease 未签发（create 未 ok） | ✓ 对称，无 lease 泄漏面 |
| 无后台任务/缓存/队列 | — | — | ✓ 无泄漏面 |

## 6. 文件范围审查（HEAD diff vs 设计 §11 ALLOW/DENY）

`git diff 8fa85d2..dc658e5 --name-only` 全量 22 文件逐项核对：

| 类别 | 文件 | 核对 |
|---|---|---|
| ALLOW 内交付 | `packages/namespace-api/{package.json,tsconfig.json,AGENTS.md,README.md}`、`src/{rest.ts,create-namespace.ts,index.ts}`、根 `package.json`（恰一行）、`pnpm-lock.yaml`（+22 行）、`wiki/raw/task_issue-267_design.md`（F-M1–F-M4 + D1 注记，零语义变更）、`wiki/raw/task_issue-267_sa3_impl.md` | ✓ 与 ALLOW LIST 9 项 + 技能固定产物一一对应 |
| SA6 冻结契约入库 | `packages/namespace-api/test/` 5 文件 | ✓ sha256 与 SA6 §13.4 逐位一致——「禁止修改」指内容冻结，入库不改变字节；且契约必须入库才能被 CI 分片发现执行 |
| 上游 SA 产物入库 | `wiki/raw/task_issue-267_{sa2_review,sa4_review,sa6_contract,conflict_report,design_conflict_report,relevant_decisions}.md` | ✓ 内容为其所有 SA 各自产出、本 commit 零改写；`wiki/raw` 入库是仓库既定惯例（`git ls-files wiki` 实测 1108 个已跟踪文件） |
| DENY LIST 越界 | 上游 13 包、`docs/adr/*`（含 ADR 0015 状态）、`CONTEXT.md`、`vitest.config.ts`、`docs/**`、`apps/**`、`domains/**`、`scripts/**`、`.github/**`、契约测试内容 | ✓ **零 diff**（diff name-only + ADR L4 状态实测复核） |

无范围外文件、无未声明的新增依赖、无打包/发布面静默扩张（`scripts/package-catalog.mjs`
未登记 namespace-api → 本票不发布该包，SA3 已如实登记 Controller follow-up）。

## 7. 测试质量标准

| 维度 | 证据 | 结论 |
|---|---|---|
| 契约真实性/敏感性 | 继承 SA6 已批准基线：唯一变量红→绿对照、M1–M10 定点变异全被目标断言捕获、3/3 复跑稳定；SA9 实测字节与 SA6 §13.4 哈希逐位一致 ⇒ 该质量结论对 HEAD 同一字节继续成立 | ✓ |
| 弱化形态排查 | grep 实测 `.(only|skip|todo)(`、`process.env` 于 src/test **零命中**；无快照断言、无字符串/正则替代行为验证（唯一读文件的接线锚已显式声明非行为替代） | ✓ |
| 真实 runner 入口发现 | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` + CI 分片磁盘枚举（SA2/SA4 已核脚本实测）；harness 非 `*.test.ts` 不被收集 | ✓ |
| 隔离与清理 | fixture `finally` 中 `registry.shutdown + dispose + tmpdir rm`（SA4 §9 复核）；双适配器（Memory/File + 重启 durability）真实持久化、不读内部结构 | ✓ |
| 绿灯证据链 | SA3 验证记录：契约入口 35/35 ×5 次复跑、包级 + 根 typecheck 链（15 项）exit 0、CI typecheck 作业同款入口 136/136 exit 0、`--frozen-lockfile` 安装 exit 0、基线对照（移出实现后同入口 23 errors 复红，排除伪绿）；SA4 静态复核与树状态一致 | ✓（SA9 按纪律不复跑；动态终验归 SA7/CI，见 §9） |

## 8. Non-blocking observations（不阻断 approve）

1. **提交信息未带 `#267` 引用**：subject `feat(namespace-api): …` 采用仓库并存的 scope 款
   （先例 `feat(vfsl-codegen): … (#222)`、`fix(ws-replication): … (#231)`），未采用
   `feat(#256)`/`fix(#266)` 的 issue 款；仓库两种惯例均有先例、`docs/agents/issue-tracker.md`
   不规定提交信息格式，追溯性由 branch `mabf/issue-267` + Parent PR #158 挂靠保持。仅登记，
   不构成 finding。
2. **`JSON_CONTENT_TYPE` 在两文件各自私有定义**（`rest.ts` L85、`create-namespace.ts` L21）：
   协议字面量的模块内自含，非跨模块事实源分叉，无漂移面。琐碎级，仅记录。
3. **Host 所有的两份输入仍未跟踪**（`wiki/raw/task_267_dispatch.md`、`task_issue-267.md`）：
   属 Host/runner 职责域，不在本票交付范围，不影响 HEAD 评审。
4. **已登记 follow-up（非本票义务，全部如实披露于设计 §13 / SA3 §Deferred）**：FR-1 形状校验 +
   limits + signal；FR-2 ADR 0015 状态翻转（Controller）；FR-3 失败映射 + problem shape（含
   405 body `code:'METHOD_NOT_ALLOWED'` 临时值定稿）；FR-4 observer 事件契约；FR-5 server
   composition root（B-1 消费侧闭环）；`scripts/package-catalog.mjs` 发布目录登记（Controller）。
   无一项被伪装成已完成，无一项掩盖本任务必要工作。

## 9. 交付就绪评估（delivery readiness）

| 就绪项 | 状态 |
|---|---|
| 基座正确性 | ✓ HEAD 直接父 = 权威基座 `8fa85d2`（PR #158 head），单 commit 增量，无杂散提交 |
| 工作树状态 | ✓ `git status` 仅两份 Host 所有未跟踪输入；HEAD 内容与评审证据链（SA3 验证时的树状态 + SA4 静态复核）一致 |
| 标准符合性 | ✓ §3–§7 全维度闭合；0 BLOCKER / 0 MAJOR / 0 MINOR |
| 冲突门禁链 | ✓ SA8 前置 `clear` + 设计后复审 `clear`（`requiresConflictRecheck: false`）；本评审复核其 5 项重开条件在实现层无一命中（冻结面零变化、无延后语义提前实现、role 来源无偏离、文件范围零越界、无解释性重设计）——无需重开冲突门 |
| 动态终验归属 | 契约绿灯/全仓测试/CI 矩阵（Node 20/24 分片 + typecheck 作业 + frozen-lockfile 安装）的最终动态裁决归 SA7/CI；静态证据链（SA3 实测记录 + SA4 复核 + 本评审字节级一致性核验）支持就绪结论 |
| SA10 边界 | 本评审不裁决 Issue 需求完整实现度；AC1–AC6 的实现覆盖已由 SA2 §3 / SA4 §3 逐条确认，SA10 终验无标准层前置阻塞 |

## 10. Findings

无。0 BLOCKER / 0 MAJOR / 0 MINOR —— 按 Finding 规则 verdict 为 `approve`。

---

审查日期：2026-09-11（dispatch `sa-5b673179-0de2-4b6a-b21e-453640cc40bf`，iteration 0，standards-review）。

# SA10 Spec 审查 — issue #267：REST router 骨架（Hub create 成功路径 + Peer role gate + Lease 生命周期）

> SA10（mabf-sa10）独立 Spec 审查，iteration 0。dispatch：`sa-805637c1-07be-4b4b-9429-ae5b405895ad`。
> 被审对象：committed HEAD `dc658e5e8564f60b20545111e275a18f9ded7085`（branch `mabf/issue-267`）。
> 权威基线：Parent PR #158 `docs/rest-namespace-create@8fa85d27b0231e72d23f41fbcbfd1affe4c2ee1d`，
> 经 `git merge-base --is-ancestor` 实证为 HEAD 祖先。
> Issue comments REST snapshot：空（`[]`，简报/派发日志/SA6/SA8 四方同证）——无 Owner 追加要求、
> 无 override 授权；适用口径 = Issue 正文 + AC1–AC6 + 其引用的 ADR 0015 条款。
> 审查方式：只读静态审查（Issue 简报、设计、SA2/SA3/SA4/SA6/SA8 产物、实现源码、冻结契约测试、
> manifest/lockfile/根接线逐一实读 + sha256/git diff 实证）。按 SA10 纪律不运行测试、不启动服务、
> 不修改任何代码/设计/测试。

## 1. Reviewed inputs

| 输入（固定位置） | 状态 |
|---|---|
| `wiki/raw/task_issue-267.md`（任务简报；Issue #267 正文 + AC1–AC6；updated 2026-09-10T17:00:20Z） | 已读 |
| `wiki/raw/task_267_dispatch.md`（SA8 conflict-gate iter 0 记录） | 已读 |
| `wiki/raw/task_issue-267_design.md`（SA1 设计 568 行 + SA3 落实的 F-M1–F-M4 修订与 D1 范围注记） | 已读（全文） |
| `wiki/raw/task_issue-267_sa2_review.md`（SA2，`approve`，0 BLOCKER / 0 MAJOR / 4 MINOR） | 已读（全文） |
| `wiki/raw/task_issue-267_sa3_impl.md`（SA3 实现报告 + 验证证据 + Deviations） | 已读（全文） |
| `wiki/raw/task_issue-267_sa4_review.md`（SA4，`approve`，0 BLOCKER / 0 MAJOR） | 已读（全文） |
| `wiki/raw/task_issue-267_sa6_contract.md`（SA6，`approve`，35 用例冻结契约 + §13.4 哈希 + M1–M10 变异矩阵） | 已读（全文） |
| `wiki/raw/task_issue-267_conflict_report.md`（SA8 前置门禁 `clear`；冻结面 9 项；B-1/B-2/B-3） | 已读（全文） |
| `wiki/raw/task_issue-267_design_conflict_report.md`（SA8 设计后复审 `clear`；A-1/A-2；N-1–N-3；重开条件 5 项） | 已读（全文） |
| `docs/adr/0015-vertical-rest-namespace-create.md`（governing 决策，提议状态，231 行） | 已读（全文） |
| 实现本体：`packages/namespace-api/{package.json,tsconfig.json,AGENTS.md,README.md}`、`src/{rest.ts,create-namespace.ts,index.ts}` | 逐文件全读 |
| 冻结契约测试 5 文件（`packages/namespace-api/test/`） | 逐文件全读 + sha256 复核（与 SA6 §13.4 逐位一致） |
| 上游公共面：`packages/vfsl/src/index.ts`（`deriveSchemaIdentity` L225+）、`packages/namespace-registry/src/{index.ts,types.ts}`（`InstanceRole` re-export L40、`CreateNamespaceInput` 恰三键 L252–256、`create` L691）、`packages/instance/src/index.ts`（`InstanceRole` L4） | 已 grep/实读 |
| 工程接线：根 `package.json` diff、`pnpm-lock.yaml` diff、`vitest.config.ts`、`tsconfig.base.json`、`.gitignore`、`git ls-files`/`git status` | 已 diff/实测 |

## 2. Verdict

**`approve`** —— 无关键 AC partial/unmet/unachievable；无未披露的范围扩张；冻结契约字节零改动。

一句话理由：HEAD 是 Issue 正文与 AC1–AC6 的忠实兑现——`@nomicore/namespace-api` 包按 ADR 0015
L18 建立（`.` + `./rest` 三条件 exports，create 编排 `src/create-namespace.ts` 由打包面结构性保持
包内私有）；router 为 Host 无关普通 Module（零 Cordis 依赖、标准 `Request → Response` +
`{matched}` 判别结果、不拥有 listener/auth/CORS/TLS/RequestID/并发/drain）；构造面读取→校验→
复制→冻结、配置错误普通 `TypeError`；Hub 成功链（raw path 匹配 → method gate 405+`Allow: POST`
→ role gate → `deriveSchemaIdentity` 派生 → 四键 SCHEMA envelope → `Registry.create({owner,
schema,root})` → release 前复制 frozen DTO → 恰一次 awaited `lease.release()`（失败吞、不重试）→
settle 后 201 恰 `{namespaceId, schema{lang,version,id}}` 无 `Location`）与 Peer 403 +
`INSTANCE_ROLE_FORBIDDEN`（先于 owner 解析/body 读取/Registry 触达）逐字落在冻结条款内；
新建 namespace `replication-disabled` 为零新增行为的自然导出；延后切片（形状校验/limits/失败映射/
observer 事件）以 fail-loud rejection + 参数位保留的方式**不实现而非错实现**，且在
README/AGENTS.md/设计/SA3 报告中全部显式披露。SA6 冻结契约 5 文件 sha256 逐位一致（零测试改动），
SA3 报告绿灯证据（35/35、5 次复跑）与静态事实链一致；SA2 四条 MINOR 与 §14 观察 1 均已落实；
文件范围恰为设计 §11 ALLOW LIST + 流程产物，无 scope creep。

## 3. Acceptance criteria 逐条裁决

| AC | 要求 | 实现证据（静态） | 冻结契约断言面 | 裁决 |
|---|---|---|---|---|
| AC1 | Hub 上 POST create 完整走通并返回 201，response 恰含 namespaceId 与 schema identity（`sc1-` id） | `src/rest.ts` L155–176（hub 分支编排调用）+ `src/create-namespace.ts` L36–80：`request.json()` → 机械提取 → `deriveSchemaIdentity(schemaText)` → 四键 envelope（`lang:'vfsl'/version:1/id:derived.schemaId/text:原文`）→ `registry.create({owner:{userId},schema,root})` → 201 恰两键/三键 DTO、`content-type: application/json`、**不设 `location`**；`sc1-` 只消费派生结果不重算 | `rest-create-hub-contract.test.ts` AC1 两用例：键集排序深比较、`location === null`、`^sc1-[a-z2-7]{52}$`、与 `deriveSchemaIdentity(SCHEMA_TEXT).schemaId` 逐字相等、create 恰一次逐键输入（envelope 含原文 text） | ✓ MET |
| AC2 | Peer 在 route 匹配后立即返回 403 + `INSTANCE_ROLE_FORBIDDEN`，不解析 owner、不读取 body | `src/rest.ts` L157–166：path 匹配 → method 判定 → `config.role !== 'hub'` → 403；owner 捕获（L167 `match[1]`）与 body 读取（`orchestrateCreateNamespace` 内 `request.json()`）均在 gate 之后；403 分支零 Registry 触达（registry 仅在编排内触达）；`new URL(request.url)` 只是 raw path 匹配所必需，非 owner 解析 | role 契约前 7 用例：canonical/无 body/`text/plain`/percent-encoded owner/trapped body（`bodyConsumptionAttempts === []`）五路 403 + code 逐字；poison registry 零触达；未匹配 → `matched:false` | ✓ MET |
| AC3 | 相同 create 契约在 MemoryPersistence 与 FilePersistence 上运行，断言 HTTP 结果、持久化事实、Lease 释放与 Registry 后续 open；不读内部结构 | 实现只经 `Registry.create` 公共面提交（不触 Persistence/Runtime 内部）；harness 用真实 Memory/File adapter + Registry 受控 testing 入口，观测包装只走公共成员 | 双适配器参数化（8 用例 × 2）+ File-only 重启 durability；`readData(['title'])` = `'hello'`、`getSchema()` 含原文 text、release 后 `{lease:'released',runtime:null}`、后续 `registry.open` 成功；imports 实测仅公共/testing 面 | ✓ MET |
| AC4 | success DTO 在 release 前复制；release 恰一次；release 失败仍 201 | `src/create-namespace.ts` L64–80：`lease.namespaceId`（string 值）与派生 identity 在 release 调用前组装为 `Object.freeze` DTO；`await lease.release()` 调用点唯一且在 try 块内恰一次；catch 吞失败（不重试、不二次调用）；Response 在 settle 后从 DTO 构造 | AC4 四用例：`releaseCalls === 1` + lease 进入 released 通道；release 门未放开前 `handle` 不 settle；注入 release 失败仍 201 且恰一次；release 后 namespaceId 变异哨兵不进 response 且 response id 可 open | ✓ MET |
| AC5 | 新建 namespace 为 `replication-disabled` | REST 恒三键输入（owner/schema/root），无 META/复制身份通道；Registry 既有机制自然导出（ADR 0010 L120 + #134 O-7）；零新增行为 | AC5 用例：`getStatus().runtime.replication === {state:'disabled'}` + `openReplicationSession` → `{ok:false, code:'REPLICATION_NOT_ENABLED'}` | ✓ MET |
| AC6 | route 大小写敏感，只接受无尾随斜杠的 canonical path；已知 path 的非 POST 方法返回 405 并携带 `Allow: POST` | `src/rest.ts` L77 单一冻结匹配器 `/^\/v1\/owners\/([^/]+)\/namespaces$/`（无 `i` 旗标、`$` 锚、`[^/]+` 段约束、空 owner 段 fail closed）；path 匹配先于 method 判定；`methodNotAllowedResponse()` 状态 405 + `allow: 'POST'` 恰值 | AC6 三用例：`/V1/…`/`…/Namespaces`/尾随斜杠/短路径/额外段 → `matched:false`；GET/PUT/PATCH/DELETE/OPTIONS → 405 + `allow` 恰 `'POST'`（Hub 与 Peer 双 role）；大小写变体 + 非 POST 同样不匹配（path 先于 method） | ✓ MET |

## 4. Issue 正文（What to build）逐条裁决

| 正文要求 | 实现证据 | 裁决 |
|---|---|---|
| 建立 `@nomicore/namespace-api`，REST Adapter 由 `/rest` 子路径暴露 | `packages/namespace-api/package.json`：`name` 恰值；exports 恰 `.` + `./rest` 三条件（`nomicore-source` → `./src/index.ts` / `./src/rest.ts`）；接线锚契约断言面满足 | ✓ |
| 首版只公开 REST router；create 编排保持包内私有 | `src/create-namespace.ts` 不进 exports、不被 `src/index.ts` re-export（`index.ts` 仅 re-export `./rest.js` 公共面），仅 `rest.ts` 相对导入——私有性由打包面结构性保证 | ✓ |
| Host 无关普通 Module（非 Cordis plugin）；标准 Web `Request → Response` + 判别结果 | manifest deps 仅 `@nomicore/namespace-registry` + `@nomicore/vfsl`（零 Cordis）；`RestHandledResult = {matched:false} \| {matched:true; response}`；`handle(request): Promise<RestHandledResult>` | ✓ |
| 不拥有 listener/authentication/authorization/CORS/TLS/Request ID/全局并发/graceful drain | 实现零 listener/定时器/队列/锁；frozen config 外零状态；头注 + AGENTS.md 显式声明不拥有 | ✓ |
| 配置构造时读取、校验、复制并冻结；构造配置错误用普通 `TypeError` | `createRestRouter` L119–153：options 对象性/role 联合/registry.create 函数性/两 observer 函数性五项判定全 `TypeError`；`Object.freeze(config)`（limits 浅复制冻结、预留未消费）；`Object.freeze({handle})` | ✓ |
| Hub 纵向骨架：匹配 → role gate → 派生 → 完整 envelope → `Registry.create({owner,schema,root})` → 201（恰 namespaceId + schema，无 Location） | 见 AC1 行；顺序与 ADR step 1→2→6→7→8→9→10 逐字对齐（step 3–5 延后，骨架中不产生任何 Response，无从反序） | ✓ |
| Peer 相同 route 形状，匹配 method/raw path 后、解析 owner 或读取 body 前 403 + `INSTANCE_ROLE_FORBIDDEN` | 见 AC2 行；code 为逐字常量（全决策集唯一定义点 ADR 0015 L41） | ✓ |
| 新建 namespace 默认 `replication-disabled` | 见 AC5 行 | ✓ |
| Lease：先复制 DTO、恰一次调用并等待 `release()`；release 失败仍 201、不重复调用 | 见 AC4 行 | ✓ |
| 本票只做成功路径与 role gate；形状校验/limits/Registry 失败映射/observer 契约延后 | 无任何 4xx/5xx 映射分支（除冻结的 405/403）；未映射结局一律 `handle` rejection（fail loud，带 `cause`）；limits 参数位保留未校验未执行；两 observer 必选（B-2 构造面）但零事件发射；延后项在 README「Deferred scope」/AGENTS.md「Boundaries」/设计 §1/§13 显式披露 | ✓（延后 = 不实现而非错实现） |

## 5. Owner 评论映射

Issue comments REST snapshot 为空（`[]`）——无 Owner 追加要求、无 override 授权，无映射义务。
适用输入 = Issue 正文 + AC1–AC6 + ADR 0015 条款，已在 §3/§4 全覆盖（6/6 AC + 11/11 正文要求）。

## 6. 冻结面与 SA8 边界条件复核

| 冻结面/边界 | 实现核对 | 裁决 |
|---|---|---|
| 201 恰含 `namespaceId` + `schema{lang,version,id}`、无 `Location` | DTO 显式两键/三键字面量构造（不从含 `text` 的 envelope 展开）；headers 仅 content-type | ✓ |
| `sc1-` 格式只消费不重算 | 单一派生调用点 `deriveSchemaIdentity`；envelope `id` 与 DTO `schema.id` 同一 `derived.schemaId` | ✓ |
| `INSTANCE_ROLE_FORBIDDEN` / 405 + `Allow: POST` | 逐字常量；`allow: 'POST'` 恰值 | ✓ |
| Registry 公共面与 Lease 契约不变 | 只调用 `registry.create` / `lease.namespaceId` / `lease.release`；上游 13 包零改动（git diff 实证） | ✓ |
| 新建 namespace 默认 `replication-disabled` | 零新增行为（恒三键输入无 META 通道） | ✓ |
| B-1 role 单真相 | `role: InstanceRole` 类型自 registry 公共 re-export 导入（与 instance 同一联合）；包内零默认值/零 `process.env`（grep 零命中）；JSDoc + AGENTS.md 钉住 composition root 注入义务；消费者侧闭环登记 FR-5 | ✓ |
| B-2 observer 构造面 | 两 observer 必选、缺失/非函数 → `TypeError`；零参 `() => void`；本票零发射（延后仅限事件契约） | ✓ |
| B-3 固定顺序不 reorder | path → method → role → owner 捕获 → body 读取 → 派生 → create → DTO → 恰一次 release → 201；Peer 403 前零 owner 解码/零 body 成员调用/零 Registry 触达 | ✓ |
| SA6 冻结契约字节零改动 | sha256 五组与 SA6 §13.4 **逐位一致**（本轮实测） | ✓ |
| SA8 设计后复审重开条件（5 项） | 逐项核对均不命中：冻结面无变化；未提前实现延后语义；role 来源无偏离；文件范围未越界；无对 ADR 0015 的解释性偏离 | ✓ 无需重开 |

## 7. 文件范围与 scope creep 审查

`git diff 8fa85d27 HEAD --stat` 实测（22 文件，+3458/−1）：

| 类别 | 路径 | 裁决 |
|---|---|---|
| 新包本体 | `packages/namespace-api/{package.json,tsconfig.json,AGENTS.md,README.md,src/{rest.ts,create-namespace.ts,index.ts}}` | ✓ 设计 §11 ALLOW 第 1–7 行 |
| SA6 冻结契约 | `packages/namespace-api/test/*`（5 文件） | ✓ 哈希逐位一致（DENY 首行保护成立：实现方零改动） |
| 根接线 | `package.json`（typecheck 链在 namespace-registry 后恰 +1 项 namespace-api）、`pnpm-lock.yaml`（+22 行新 importer，与 manifest 逐项一致） | ✓ ALLOW 第 8–9 行；CI `--frozen-lockfile` 可安装性闭环 |
| 流程产物 | `wiki/raw/task_issue-267_{conflict_report,design,design_conflict_report,relevant_decisions,sa2_review,sa3_impl,sa4_review,sa6_contract}.md` | ✓ 工作流固定产物（与 #266 等先例同款入库） |

DENY 面实测零触碰：上游 13 包、`docs/adr/*`（ADR 0015 状态未自行翻转）、`CONTEXT.md`、
`vitest.config.ts`、`apps/**`、`domains/**`、`scripts/**`、`.github/**`。`git ls-files` 实证新包
仅 12 个预期文件，无 `dist/`/`tsconfig.build.json`/临时诊断件；包级 `node_modules/` 被 `.gitignore`
命中未入库；`git grep namespace-api` 于包外 ts/json/mjs 仅命中根 `package.json` 接线行。
**无 scope creep。**

## 8. PR 必须披露的未达成/延后项（均已在产物中如实披露，核对一致）

以下为 Issue 正文显式延后或流程登记的条目——**全部是「不实现而非部分实现」**，且已在
README/AGENTS.md/设计 §13/SA3「Deferred verification」中披露；本审查确认披露与实际状态一致，
PR 描述应原样转述：

1. **请求形状校验 + limits + `Request.signal` 未实现**（FR-1）：Hub 侧过渡期接受面（非 JSON
   Content-Type、额外 body 键、query、percent-encoded owner、超限 body）被接受或走 fail-loud
   rejection；body 读取暂无上限、不接 signal——首版仅受信 localhost/内网暴露（ADR 0015 L36 前提，
   AGENTS.md 明示禁止公网暴露）。
2. **Registry 失败映射 / 错误 problem shape 未实现**（FR-3）：未映射结局（body/JSON 异常、顶层形状
   不合规、`deriveSchemaIdentity` `ok:false`、Registry 窄 issue/fatal）一律 `handle` rejection
   （通用 `Error` + `cause`，无稳定形状承诺），不产生任何 HTTP 错误 Response；405 body 的
   `code:'METHOD_NOT_ALLOWED'` 为**临时值**（SA8 N-3，FR-3 定稿，非冻结面）。
3. **observer 事件契约未实现**（FR-4）：两 observer 构造必选（ADR L186 构造面已冻结）但本票零
   发射；release 失败的 diagnostic 上报义务（ADR L161 后半）随 FR-4 落地，业务不变量（仍 201、
   恰一次）完整。
4. **`limits` 构造参数不校验不执行**（SA8 N-1）：参数位保留；L113「未知键/越界值构造期
   TypeError」义务随 FR-1 落地并届时复审。
5. **ADR 0015 状态「提议 → 已接受」未翻转**（FR-2）：Controller 收官清单项，实现链按 DENY 不
   自行翻转。
6. **新包未登记 `scripts/package-catalog.mjs` 发布目录**：本票不打包/不发布
   `@nomicore/namespace-api`（SA3 已登记 Controller follow-up；`scripts/**` 属 DENY）。
7. **B-1 消费者侧闭环待 FR-5**：本票无 composition root 消费者；role 值须取自 Instance service
   的接线义务以类型 + 文档钉住，server 装配票落地。
8. **动态验证归属**：契约套件绿灯（SA3 报告 35/35、5 次复跑 + 修复前后基线对照）与全仓
   测试/CI 矩阵（typecheck 作业、test 分片、`--frozen-lockfile` 安装）的最终动态裁决属 SA7/CI；
   SA10 按纪律未运行测试，本 approve 基于静态逐条对齐 + 上游证据链一致性。

## 9. Non-blocking observations（MINOR，不阻断 approve）

1. 405 body `code:'METHOD_NOT_ALLOWED'` 为标注在案的临时值（代码注释 + 设计 D4 + SA8 N-3）；
   契约未断言，FR-3 定稿时统一。
2. 两 observer 经校验冻结但本票零调用——B-2 参数位保留的刻意设计（JSDoc/AGENTS.md 明示），
   非死代码；FR-4 成为唯一事件出口。
3. `limits` 浅复制冻结后未消费——设计明示的切片边界（D2/D7 + SA8 N-1），非违约。
4. 未映射结局的 rejection 使用通用 `Error`（中文 message，两处带 `cause`）——D5 明示 rejection
   形状非契约；FR-3 以 Response 替换为纯加法。
5. SA3 Deviation-1（`@nomicore/persistence` devDependency，test-only）：有 `ws-replication` 先例、
   `dependencies`/exports 零变化、设计 D1 已留范围注记；属 CI typecheck 作业可解析性的必要接线，
   非公共面扩张。
6. 构造期 registry 校验为形状级（仅 `create` 为函数）——设计 D2 明示决策（契约 poison registry
   兼容依赖此点）；后续收紧需走契约修订轮。

## 10. 结论

- 6/6 AC **MET**；11/11 Issue 正文要求 **MET**；0 项 partial/unmet/unachievable。
- Owner 评论为空，无遗漏输入；Blocked-by #266 已合入（基线 `8fa85d2` 实证）。
- 冻结面 9 项 + B-1/B-2/B-3 全部保持；SA6 冻结契约字节零改动（sha256 逐位一致）。
- 无 scope creep；延后/未达成项 8 条全部已披露，供 PR 转述。
- MINOR 观察 6 条，均不阻断。

**Verdict：`approve`**

---

审查日期：2026-09-11（dispatch `sa-805637c1-07be-4b4b-9429-ae5b405895ad`，iteration 0，
spec-review）。被审 HEAD `dc658e5e8564f60b20545111e275a18f9ded7085`。

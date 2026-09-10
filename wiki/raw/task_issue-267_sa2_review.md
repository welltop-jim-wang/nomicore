# SA2 设计攻击评审 — issue #267：REST router 骨架（Hub create 成功路径 + Peer role gate + Lease 生命周期）

> SA2（mabf-sa2）评审产物，iteration 0。被审对象：`wiki/raw/task_issue-267_design.md`
> （SA1 设计，iteration 0）。审查基线：HEAD `8fa85d2`（branch `mabf/issue-267`），
> 工作树实测（`git status`：`packages/namespace-api/` 仅 5 个 test 面文件，全部 untracked）。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-267.md`（任务简报，Issue #267，State: open，updated 2026-09-10T17:00:20Z；AC1–AC6；Blocked by #266） | 已读 |
| `wiki/raw/task_267_dispatch.md`（SA8 conflict-gate iter 0；Issue comments REST snapshot：空 `[]`） | 已读 |
| `wiki/raw/task_issue-267_relevant_decisions.md`（SA8 决策摘录：ADR 0015 §1.1–1.7、0009/0010/0012/0006、CONTEXT.md 词条、工程门） | 已读 |
| `wiki/raw/task_issue-267_conflict_report.md`（SA8 前置门禁：`clear`，13 项裁决，冻结面 9 项，B-1/B-2/B-3 移交） | 已读 |
| `wiki/raw/task_issue-267_sa6_contract.md`（SA6 契约：`approve`，35 用例红灯固化，M1–M10 变异矩阵） | 已读 |
| `wiki/raw/task_issue-267_design_conflict_report.md`（SA8 设计后复审：`clear`，B-1/B-2/B-3 闭合，advisory A-1/A-2，`requiresConflictRecheck: false`） | 已读 |
| SA6 冻结契约测试 5 文件（`packages/namespace-api/test/`，逐文件实读 + 用例计数复算） | 已读 |
| `docs/adr/0015-vertical-rest-namespace-create.md`（governing 决策，提议状态，231 行全读） | 已读 |
| 上游代码事实独立复核：`packages/vfsl/src/index.ts`（`deriveSchemaIdentity`）、`packages/namespace-registry/src/types.ts`（`CreateNamespaceInput`/`CreateNamespaceIssue`/`NamespaceLease`/`NamespaceRegistry`）、`packages/namespace-registry/src/index.ts`（导出白名单含 `InstanceRole`）、`packages/instance/src/index.ts`（`InstanceRole` L4） | 已读 |
| 工程接线独立复核：根 `package.json`（typecheck 链 14 项）、`vitest.config.ts`（alias/include）、`pnpm-workspace.yaml`、`tsconfig.base.json`、`tsconfig.typecheck.json`、`packages/namespace-registry/package.json`/`tsconfig.json`/`AGENTS.md`、`.github/workflows/ci.yml`（5 处 `--frozen-lockfile`）、`scripts/ci-test-shard.mjs`（磁盘枚举分片）、`.gitignore`、13 包 AGENTS/README 普查、`CONTEXT.md` 词条 | 已读 |
| 独立实证：`@types/node@20.19.43` `web-globals/fetch.d.ts` 全局声明 + 严格模式 tsc 探针（详见 §12/§13 F-M3） | 已做 |

Issue comments REST snapshot 为空（简报/SA6/SA8/派发日志四方一致）——无 Owner 评论可映射、无 override 授权。

## 2. Verdict

**`approve`** —— 无 BLOCKER、无 MAJOR。设计可安全实施。

一句话理由：设计是 ADR 0015 各冻结条款的逐字兑现型具体化，每个可观察行为
（路由大小写/无尾随斜杠/段数、path→method→role 判定顺序、Peer 403 +
`INSTANCE_ROLE_FORBIDDEN` 先于 owner 解析/body 读取、201 恰两键/三键无 `Location`、
DTO 复制先于恰一次 release、release settle 后构造 Response、release 失败仍 201、
`sc1-` 只消费不重算、replication-disabled 零新增行为）都与 SA6 冻结契约逐字段同形、
与 ADR 0015 原文逐字对齐；延后面（错误映射、limits 执行、observer 事件、signal）以
fail-loud rejection / 参数位保留的方式不实现而非错实现；上游公共面零修改；工程接线
（根 typecheck 链 + lockfile 再生成）与 CI 真实门禁闭合。SA8 移交的 B-1/B-2/B-3
边界条件在设计层全部闭合。发现的 4 条 MINOR 均为文字精度/惯例补全项，不阻断实施。

## 3. 需求覆盖

| Requirement（Issue 正文/AC） | Design section | Assessment |
|---|---|---|
| 建 `@nomicore/namespace-api`，REST Adapter 由 `/rest` 暴露，首版只公开 router，create 编排包内私有 | §7 D1、§8.1、§11 | ✓ manifest exports 恰 `.` + `./rest` 三条件；`src/create-namespace.ts` 不进 exports 白名单、仅 `rest.ts` 相对导入——私有性由打包面结构性保证；接线锚契约（`nomicore-source` → 存在的 `src/rest.ts`）被 D1 manifest 满足（实测 `rest-public-seam-wiring.test.ts` 断言面） |
| router 为 Host 无关普通 Module（非 Cordis plugin）、标准 `Request → Response` + 判别结果；不拥有 listener/auth/CORS/TLS/RequestID/全局并发/drain | §7 D1/D3/D9、§8.2 | ✓ 零 Cordis 依赖（manifest deps 仅 registry + vfsl）；`RestHandledResult` 判别联合与契约 H2 同形；D9 无状态无监听无定时器 |
| 配置构造时读取、校验、复制并冻结；构造配置错误普通 `TypeError` | §7 D2、§8.3 | ✓ 校验表逐项 + `Object.freeze` 复制；契约构造门用例（缺 options/非法 role/缺任一 observer）全部被 D2 判定覆盖 |
| Hub 完整走通 匹配→role gate→派生→envelope→`Registry.create({owner,schema,root})`→201 恰含 `namespaceId`+`schema{lang,version,id}`、无 `Location` | §8.2/§8.4/§8.5、D6 | ✓ envelope 恰四键含原文 `text`（契约 `create` 输入断言逐键相等）；201 从 DTO（非 envelope 展开）构造，`text` 绝不进 response；不设 `location` |
| Peer 相同 route 形状，匹配 method/raw path 后、解析 owner 或读取 body 前返回 403 + `INSTANCE_ROLE_FORBIDDEN` | §8.2、D3 | ✓ 403 分支在 owner 捕获与 body 读取之前；契约 poison registry + trapped body + 无 body + `text/plain` + percent-encoded 五路验证面全部被设计顺序覆盖 |
| 新建 namespace 默认 `replication-disabled` | §9.5 | ✓ 零新增行为：`CreateNamespaceInput` 恒三键无 META 通道，Registry 既有机制（ADR 0010 L120 + #134 O-7）自然导出；代码事实独立复核一致 |
| Lease：先复制 DTO、恰一次调用并等待 release；release 失败仍 201、不重复调用 | §7 D6、§8.4 | ✓ DTO（string 值 + frozen）在 release 前构造；release 恰一次于 try 块内、catch 吞失败；Response 构造点在 `await release()` settle 之后 |
| 本票只做成功路径与 role gate；形状校验/limits/失败映射/observer 契约延后 | §1 非目标、D5/D7、§12 | ✓ 延后清单与简报逐项一致；SA6 契约按同口径不断言（实测确认无越权断言）；无静默扩大 |
| AC1–AC6 | §12 映射表 | ✓ 6/6（逐条对到契约用例，见 §12 验收设计审查） |
| Blocked by #266 | §2 锚点 3/§3 | ✓ 已合入（HEAD `8fa85d2` = `fix(#266) … (#276)`；`deriveSchemaIdentity` 公共导出实测在场） |

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| —（Issue comments REST snapshot 为空 `[]`） | — | §4 自记「无 Owner 评论可映射」 | ✓ 简报 L39–40 `## Comments` 节为空、派发日志/SA6/SA8 三方同证；无遗漏输入。适用口径 = Issue 正文 + ADR 0015 条款，已在 §3 覆盖 |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| B-1 role 单真相（role 值同源自 composition root 的 Instance identity，ADR 0012；CONTEXT.md「实例角色」Avoid） | §7 D8、§8.1、§11（AGENTS.md + JSDoc 钉住；类型只认 `InstanceRole` 联合，自 registry 公共 re-export 导入——实测 `packages/namespace-registry/src/index.ts` 类型导出白名单确含 `InstanceRole`，与 `packages/instance/src/index.ts` L4 同一联合）；包内零 role 默认值/零独立配置源；消费者侧接线归 FR-5 | ✓ 设计层闭合。类型 re-export 是同一联合的结构性投影，不构成第二真相源；本票无 composition root 消费者（实测 `git grep namespace-api` 于 ts/json/mjs 零命中），无违约面 |
| B-2 observer 构造面冻结（ADR 0015 L186：两同步 void observer 必须显式注入，no-op 须显式；延后仅限事件发射契约） | §7 D2/D7、§8.3：`metricsObserver`/`diagnosticObserver` 必选、缺失/非函数 → 普通 `TypeError`；零参 `() => void`；本票零事件发射 | ✓ 闭合。与 L186 逐字一致；零参签名的事件化演进论证类型学成立；SA6 契约构造门实测在场；ADR L161 诊断上报义务随 FR-4 落地而业务不变量（仍 201、恰一次）保持 |
| B-3 固定顺序不被骨架 reorder（method gate 先于 role gate；role gate 先于 owner 解析/body 读取；DTO 复制先于 release） | §8.2（path→method 405→role 403→owner 捕获→body 读取）、§8.4（派生→envelope→create→DTO→恰一次 release→settle 后 201） | ✓ 闭合。Hub 侧延后的 step 3–5 在骨架中不产生任何 Response（无从反序，D5 fail-loud rejection 无 HTTP 可观察顺序）；Peer 侧 role gate 前零 body 成员调用、零 Registry 触达；契约 M1/M2/M3/M10 变异口径全部由设计顺序满足 |
| 冻结面：201 恰含 `namespaceId` + `schema{lang,version,id}`、无 `Location` | §7 D6、D4 表 | ✓ 显式两键/三键 DTO；不从 envelope 展开（envelope 含 `text`）；契约键集排序断言面吻合 |
| 冻结面：`sc1-` 格式 | §8.4 | ✓ 只消费 `deriveSchemaIdentity`（`{ok:true; semanticFingerprint; schemaId}` 实测），不重算 digest；契约 `^sc1-[a-z2-7]{52}$` 由上游保证 |
| 冻结面：`INSTANCE_ROLE_FORBIDDEN` / 405 + `Allow: POST` | §7 D4、§8.2 | ✓ 逐字常量；`allow: 'POST'` 恰值（契约 `get('allow')).toBe('POST')` 吻合）；全决策集唯一 code 定义点实测确认（仅 ADR 0015 一处） |
| 冻结面：Registry 公共面与 Lease 契约不变 | 全文 | ✓ 只调用 `registry.create` / `lease.namespaceId` / `lease.release`；「恰一次」由调用纪律保证而非依赖 Lease 幂等（与 ADR 0009「重复 release 同一 Promise」相容的更严纪律） |
| 冻结面：新建 namespace 默认 replication-disabled | §9.5 | ✓ 恒三键输入无 META 通道；实测支撑契约在 HEAD 5/5 绿亲证机制既有 |
| 流程项：ADR 0015 收官翻「已接受」；新包建 AGENTS.md | §11 DENY（ADR）+ FR-2；ALLOW（AGENTS.md） | ✓ 状态翻转归 Controller；实现链不自行翻转；AGENTS.md 随包建立（SA8 §8-4 移交项落实） |
| Typed Namespace writes 强制条款不适用（写者是 Registry create 管线） | §9.6 | ✓ 与前置门禁行 12 裁决一致；router 不持 lease 做 `mutateData()` 类型化写；契约测试只用 `readData`（读侧动态接口，条款明示允许） |
| 工程事实：CI 五处 `--frozen-lockfile` → 新包必须再生成 lockfile；根 typecheck 链逐包列出 | §2 锚点 10、§7 D1 接线配套、R3、§11 ALLOW | ✓ 实测 ci.yml L36/72/101/144/166 + `pnpm typecheck`（L39）；设计把根 `package.json` 一行追加与 `pnpm-lock.yaml` 再生成均列入 ALLOW 与验证命令 |
| 工程事实：CI 测试分片按磁盘枚举 | （设计未显式引用，但结论不受影响） | ✓ 实测 `scripts/ci-test-shard.mjs`：「文件列表永远由磁盘枚举决定——新增测试文件即使不在权重表里……绝无静默漏跑」——新契约测试自动入片，无需改 CI |

## 6. 设计内部一致性

| 检查点 | 结论 |
|---|---|
| 正文 ↔ 伪码 ↔ 接口 ↔ 验收映射交叉核对 | ✓ §1 目标 1–6、§7 D1–D9、§8.1–8.5、§12 映射表四方一致：构造签名（D2 = 契约 H1）、判别结果（D4 = H2）、`src/rest.ts` 布局（D1 = H3）、201 取派生 identity（D6 = H4）、405/403/201 三响应形状（D4 表 = §8.2/8.4 伪码 = 契约断言） |
| 死引用 / 旧 API | ✓ 未发现：`CreateNamespaceInput` 三键、`NamespaceOwner = {userId}`（types.ts 实测）、`deriveSchemaIdentity` 单参签名均与 HEAD 一致 |
| H1–H4 仲裁与冻结契约一致性 | ✓ 逐字段复核（见 §12）：`createRestRouter({role, registry, metricsObserver, diagnosticObserver, limits?})`、`handle → Promise<{matched:false}\|{matched:true;response}>`、`../src/rest.js` 相对导入、201 schema identity 取派生 envelope——设计公共面与契约同形，零测试回写结论成立 |
| 状态/伪修订检查 | ✓ 无「附录承认但正文未改」形态；R1–R7 与正文切片边界互证；§14 修订映射如实留空（iteration 0 无评审输入） |
| 用例计数口径 | ✗ 两处引用计数不精（§2 锚点 8「13 个 tsconfig」——实际链 14 项（13 包 + `apps/yjs-server`）；§11「12 包惯例」——实际 13 个既有包；§8.5/§12「后 6 用例」——实际 role suite 结构 7+3+2，「后」为 5）→ F-M1/F-M2（MINOR，操作性结论均真，纯数字勘误；SA8 设计后复审 A-1/A-2 已同款登记） |
| 锚点 11 证据链（Request/Response/Headers 全局可解析） | ⚠ 结论真、证据弱：SA6「`--typecheck` 报 no errors」对 `.test.ts` 是空证据（vitest typecheck include 仅 `*.test-d.ts`，namespace-api 无；逐包 tsc 仅 include `src/**`）——但结论经独立实证成立（见 F-M3） |

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | Peer router（frozen role='peer'） | canonical POST + 巨大/无/trapped/`text/plain` body | 匹配 path+method 后立即 403，零 body 成员调用、零 Registry 触达 | 无（§8.2 403 分支先于 owner 捕获与 `request.json()`；契约 poison registry/trapped body 五路验证） | — |
| S2 | Hub router | `request.json()` reject（malformed/已消费 body） | `handle` rejection 传播（fail loud，不伪 500） | 无（D5 行 3 明示传播） | — |
| S3 | Hub create 中 | `registry.create` resolve `ok:false`（窄 issue） | rejection 携带 cause，零 Response | 无（D5 行 1；`CreateNamespaceIssue` 全变体含 `code`，实测） | — |
| S4 | Hub create 中 | `registry.create` reject（branded fatal） | 原样再抛不包装 | 无（D5 行 2） | — |
| S5 | create 已成功，DTO 已复制 | `lease.release()` reject | 吞失败、仍 201、release 计数仍恰 1 | 无（§8.4 try/catch 恰一次；契约注入失败用例吻合） | — |
| S6 | create 已成功 | `lease.release()` 永不 settle | `handle` 永不 settle（不超时、不放弃） | 无——这是 ADR 0015 L113「必须等待 create settle 并 release Lease」的逐字行为，非缺口 | — |
| S7 | 单 router 实例 | 并发 `handle()` | 天然并行，无 router 级共享可变状态 | 无（D9：frozen config 外零状态、无队列/锁；namespace 生命周期由 Registry carrier 串行） | — |
| S8 | Hub create 成功后、release 前 | 进程崩溃 | Registry create 原子性（committed 或否）；router 无部分提交面 | 无（§9.3；201 之前任何 rejection 对应零 Response） | — |
| S9 | 构造后、registry 已 shutdown | `handle(POST)` | `create` → `REGISTRY_NOT_ACCEPTING` 窄 issue → D5 rejection | 无（fail loud，503 映射属 FR-3） | — |
| S10 | 构造成功后 | 调用方改写 `options.role` | 行为不变（构造时复制） | 无（D2 值拷贝 + freeze；契约变异用例吻合） | — |
| S11 | 同一 Request 重复 `handle` / 双读 body | 第二次 `json()` reject | rejection 传播 | 无（Request 一次性是平台语义；router 不缓存 request） | — |
| S12 | create 成功、DTO 构造点 | DTO 构造能否抛错导致 release 被跳过（lease 泄漏） | 不能：DTO 由 string/number 字面量组成，`Object.freeze`/`JSON.stringify` 在该输入上不抛；release 调用点紧跟且在 try 外无中间 throw 点 | 无（顺序设计上 DTO 构造不可失败 ⇒ 成功路径 release 恒被调用） | — |

无非法状态转换面：router 无自有状态机（frozen config 之外零状态）；生命周期状态全部属于 Registry/Lease 契约域。

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | Registry 窄 issue / fatal / VFSL issues / body·JSON 异常 / 顶层形状不合规 | 一律 `handle` rejection（D5），不发明 4xx/5xx、不静默降级、不伪 500 | 低：受信开发环境 + Owner 切片明示延后；fail-loud 让「映射缺失」显式可见；后续以 Response 替换 rejection 是纯加法（B-3 无反序面） | —（R1 已登记 + AGENTS.md 明示「骨架仅成功路径」） |
| E2 | release 失败（唯一被吞的错误） | 吞 + 仍 201 + 不重复 release | 低：ADR 0015 L161 冻结行为；丢失的仅 best-effort 诊断信号（FR-4），与 ADR 0011「emit 不改变业务结局」观测定位一致，非静默 fallback | —（R2 已登记） |
| E3 | 部分完成伪成功 | 201 仅在 create ok + release settle 后；create 原子（Registry 契约），fatal committed:true 走 rejection 而非伪 201 | 低 | — |
| E4 | 构造配置错误 | 同步普通 `TypeError`，不承诺稳定文案（ADR L30） | 低 | — |
| E5 | body 读取无上限 / 不接 `Request.signal`（limits 延后） | 有界读取属 FR-1；受信环境前提（ADR L36） | 中（R4 已登记；AGENTS.md 将写明禁止公网暴露） | —（切片边界已被简报 + SA8 N-1 裁定） |
| E6 | 405 body `code:'METHOD_NOT_ALLOWED'` 临时值 | 显式标注临时（D4），错误契约票定稿 | 低（契约未断言、非冻结面） | —（R5/N-3 已登记） |
| E7 | 未知结局（undici 内部异常等） | 传播（handle 无兜底 catch） | 低：fail loud，诚实 | — |

无「正常路径不变量被伪降级掩盖」面：成功路径唯一（create ok → DTO → release → 201），全部失败面显式。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `@nomicore/namespace-api`（新增公共面） | 无既有调用方：`git grep -l namespace-api -- '*.ts' '*.json' '*.mjs'` 零命中（仅 docs/adr/0015 + wiki）；设计 §10 调用方矩阵如实登记「未来 server/composition root 尚不存在」并把接线义务（role 取自 Instance service）写入 AGENTS.md/JSDoc（D8） | 实测 git grep | — |
| `@nomicore/vfsl` `deriveSchemaIdentity` | 新增只读消费者；上游零改动；失败面（`ok:false`）被 D5 显式处理为 fail-loud | vfsl/src/index.ts L225–272 实测（同步、纯、不抛） | — |
| `@nomicore/namespace-registry` 公共面 | 只读消费 `create`/`NamespaceLease.namespaceId`/`release` + `InstanceRole` 类型 re-export；不扩 Registry、不改 release 语义 | types.ts + index.ts 导出白名单实测 | — |
| 根 `package.json` `typecheck` 消费者（CI typecheck 作业/开发者/packaging） | 已识别：链上 +1 项（置于 namespace-registry 项后）；`pnpm-lock.yaml` 再生成——两处均入 ALLOW + 验证命令 + R3 | ci.yml L36–44 实测；typecheck 链实测 14 项 | — |
| SA6 冻结契约测试（5 文件） | 零改动承诺成立：H1–H4 仲裁与冻结假设逐字段一致（本评审独立复核）；DENY LIST 首行保护 + 修订轮纪律 | 契约文件实读 | — |
| CI test 分片（`scripts/ci-test-shard.mjs`） | 无需改动：文件列表磁盘枚举，新测试自动入片（实测脚本注释与 `listTestFiles` 逻辑） | scripts/ci-test-shard.mjs | — |
| `vitest.config.ts` alias | 无需改动：`@nomicore/([^/]+)$` 通配已覆盖新包（如被引用）；契约测试走相对导入 `../src/rest.js` | vitest.config.ts L6–16 实测 | —（DENY 理由核实成立） |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| 路由/method/role 判定 + 403/405/201 响应构造 | `@nomicore/namespace-api`（ADR 0015 指定新 Owner） | `src/rest.ts` | ✓ |
| schema identity 派生 | `@nomicore/vfsl` 窄接口 | 经 `deriveSchemaIdentity` 消费 | ✓ 不复制指纹逻辑 |
| namespace 创建/namespaceId 生成/原子性/CSPRNG | Registry | `registry.create` | ✓ |
| 持久化/快照/深冻结 | Registry 管线 + Persistence | REST 不深拷贝（ADR L101） | ✓ |
| role 值生产 | Instance service（composition root 注入） | D8 类型 + 文档钉住；FR-5 闭环 | ✓（本票无消费面） |
| listener/auth/CORS/TLS/drain | server（未来） | 明确不拥有 | ✓ |

应用层（router）只编排，未复制底层状态机、未持有第二份权威状态。

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 普通模块工厂 + 构造期形状门禁 + 冻结配置 | `createNamespaceRegistry(options)`（`packages/namespace-registry/src/registry.ts`；ADR 0009 依赖纪律：缺失/非函数 → 构造期同步 `TypeError`） | `createRestRouter(options)` D2 同款纪律 | 一致 | 设计明示引用同款；契约构造门用例与该先例形态相同 |
| 窄公共 seam + 包内私有实现 | `deriveSchemaIdentity`（#266：窄 Module interface，内部 pipeline 不暴露）；各包 `src/index.ts` 导出白名单 + `./testing` 受控子路径 | `./rest` subpath + `src/create-namespace.ts` 不进 exports | 一致 | 打包面结构性私有，比注释更强 |
| Host 装配层 | `apps/yjs-server`（Cordis host：transport/lifecycle/shutdown） | router 非 Cordis plugin、零 Cordis 依赖 | 一致（有意分界） | ADR 0015 L20 明文；FR-5 才是装配票 |
| 既有 HTTP/REST router | 未找到（全仓无第二套 Request→Response 路由实现；`grep ': Request\b'` 仅命中本票契约测试） | 本票为首例 | 记录：无可比 router 先例，设计以 ADR 0015 条款 + 契约测试为规范源，无凭空惯例声明 | — |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 实例 role | Instance service（composition root 读取后注入） | frozen `config.role`（值拷贝） | 低：类型只认 `InstanceRole` 联合 + AGENTS.md/JSDoc 禁止第二配置源；无环境变量/文件读取点 |
| namespaceId | Registry CSPRNG | DTO 中的 string 值拷贝 | 无（release 前拷贝，契约 M3 防御） |
| schema identity | `deriveSchemaIdentity` | envelope `id` 与 DTO `schema.id` | 无（单一派生调用点，不重算） |
| 路由表 | 单一冻结 regex 常量 | — | 无 |
| 复制状态 | Registry META/runtime | 201 不声明复制状态 | 无 |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| router 构造（无资源获取：无监听器/定时器/句柄） | 无需 dispose（D9） | 构造失败 → 同步 `TypeError`，零残留 | ✓ 对称（无所获取即无所释放） |
| lease（`registry.create` 成功签发） | `lease.release()` 恰一次（成功路径恒被调用——DTO 构造不可失败，无中间 throw 点，S12） | release 失败 → 吞 + 仍 201（ADR L161） | ✓ 对称 |
| 无订阅/后台任务/缓存 | — | — | ✓ 无泄漏面 |

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二套 retry/cleanup worker | 无（Registry 内部碰撞重试 ≤8 次是 Registry 契约） | REST 零重试循环 | 非重复 |
| 第二状态字段/镜像状态 | 无 | frozen config 外零状态 | 非重复 |
| 第二评论读取/API wrapper/仅服务单 Issue 的通用抽象 | 无 | 单文件私有编排 + 单路由 regex | 非重复（route family 表延后至第二 route，D3 备选论证成立） |

阻断项检查：无行为落在错误 Owner、无绕过既有能力、无第二事实源、生命周期对称、无相似能力协议分叉——四类阻断条件均不命中。

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW LIST 9 项逐项核对：package.json/tsconfig.json/src 三文件/AGENTS.md/根 package.json 一行/pnpm-lock.yaml/设计文档——均被设计正文（D1/D2/§8/SA8 §8-4）支撑，无无理由扩张 | 设计 §11 + §7 D1 | — |
| DENY LIST 与正文无冲突：契约测试零改动（H1–H4 仲裁一致，本评审复核成立）；上游 13 包只读；ADR 0015 状态翻转排除（FR-2）；`vitest.config.ts` 无需改（alias 通配实测覆盖）；`scripts/**`/`.github/**` 不触（CI 分片磁盘枚举实测，新测试自动入片） | 设计 §11 + 实测 ci-test-shard.mjs/ci.yml | — |
| follow-up（FR-1–FR-5）不掩盖本任务必要项：R1–R6 均为已裁决延后切片或流程登记 | §13 | — |
| 惯例补全缺口：13/13 既有包均有 `packages/<pkg>/README.md`（实测普查），设计 ALLOW LIST 仅列 AGENTS.md 未列 README | §11 ALLOW + 13 包普查（AGENTS 12/13、README 13/13） | F-M4（MINOR）：把 `packages/namespace-api/README.md` 加入 ALLOW（或显式记录偏离惯例的理由） |
| `packages/namespace-api/node_modules/` 安装产物 | 根 `.gitignore` `node_modules/` 实测（无前导斜杠，任意层级命中） | — |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1 201 形状/无 Location/`sc1-` 与派生逐字一致 | `rest-create-hub-contract.test.ts`「AC1: 201 response…」（键集排序断言 + `location === null` + id 正则 + `deriveSchemaIdentity` 比对）——实测在场 | 无 | — |
| AC1 create 输入（恰一次、envelope 四键含原文） | 「AC1: Registry.create 恰一次收到 {owner, 完整 SCHEMA envelope, root}」`toEqual` 逐键 | 无 | — |
| AC2 Peer 403 顺序 | 前 7 用例：canonical/无 body/`text/plain`/percent-encoded/trapped body（`bodyConsumptionAttempts === []`）+ poison registry 零触达 + 非 POST 405（method gate 先于 role gate）+ 未匹配 `matched:false` | 无 | — |
| AC3 双持久化 + 后续 open + durability + 不读内部结构 | 双适配器参数化（8×2）+ File-only 重启用例；harness 只走公共/testing 面（imports 实测：`@nomicore/persistence(/testing)`、`@nomicore/namespace-registry(/testing)`） | 无 | — |
| AC4 DTO 复制先于 release/恰一次/settle 后返回/失败仍 201 | 四个专项用例（release 门自旋 + settle 断言 + 失败注入 + 哨兵变异探针）——断言面与 D6 逐条对应 | 无 | — |
| AC5 replication-disabled | `getStatus().runtime.replication === {state:'disabled'}` + `openReplicationSession` → `REPLICATION_NOT_ENABLED` | 无 | — |
| AC6 路由匹配 + 405 | 大小写/尾随斜杠/段数变体 → `matched:false`（Hub+Peer）；已知 path 非 POST → 405 + `allow: 'POST'`（双 role） | 无 | — |
| 构造门（B-2/冻结） | 缺 options/非法 role/缺任一 observer → `TypeError`；构造后改 `options.role` 行为不变 | 无 | — |
| 公共 seam 接线 | `rest-public-seam-wiring.test.ts`（manifest + 源文件存在性；显式声明为非行为替代） | 无 | — |
| 红灯基线真实性 | SA6 §5/§13.1（3 failed \| 1 passed，3/3 复跑）+ SA8 设计后复审独立复跑逐位一致 | 无 | — |
| 断言敏感性 | SA6 §9 E2：M1–M10 全被目标断言捕获（无变异后全绿盲区） | 无 | — |
| 类型面 | 根 `pnpm typecheck`（链 +1 项后覆盖 `src/**`）+ `vitest --typecheck`（仅 `*.test-d.ts`，本包无） | ⚠ 锚点 11 引「SA6 --typecheck no errors」为证据系空证据；实质结论经独立实证成立（F-M3） | F-M3（MINOR）：更正锚点 11 证据链 |
| CI 可安装性/发现性 | `pnpm install --frozen-lockfile` + 分片磁盘枚举（实测自动纳入新测试） | 无 | — |
| D5 fail-loud rejection 语义 | 契约不测（SA6 §15 明示延后行为不测，避免提前锁死） | 观察项：SA3 若改以 500 Response 实现延后面，35 用例仍绿、设计 D5 被静默违反——依赖 SA4/SA7 对照设计审查 | 非阻断观察（见 §14）：AGENTS.md 应把「未映射结局 = rejection」写成包契约，使后续错误契约票有显式替换点 |

无新增测试文件需求结论成立：35 用例覆盖 AC1–AC6 + 构造面 + 接线，且全部落在仓库真实测试入口（根 vitest include + CI 分片枚举实测）。

## 13. Required revisions

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance |
|---|---|---|---|---|---|
| F-M1 | MINOR | 根 `package.json` `scripts.typecheck` 实测 14 项（13 个 `packages/*` + `apps/yjs-server`）；`packages/` 实测 13 个既有包。设计 §2 锚点 8 称「逐一列出 13 个 tsconfig」、§11 称「12 包惯例」 | 两处引用计数不精（操作性结论「逐包列出」「每包建 AGENTS.md」均真，纯数字勘误；SA8 设计后复审 A-1 同款登记） | 设计文字更正为「13 包 + 1 app（14 项 tsconfig）」/「13 个既有包」 | 修订后数字与根 package.json/目录普查一致 |
| F-M2 | MINOR | `rest-role-gate-routing-contract.test.ts` 实测结构：7（role gate 顺序）+ 3（route/method）+ 2（构造门）= 12。设计 §8.5 数据流表与 §12 映射表把 role suite 引作「前 7 + 后 6」（7+6=13 ≠ 12） | 用例分组计数勘误（总数 35 不受影响；SA8 设计后复审 A-2 同款登记） | 更正为「7 + 3 + 2」或「前 7 + 后 5」 | 修订后分组计数之和等于 12 |
| F-M3 | MINOR | `vitest.config.ts` `typecheck.include` 仅 `*.test-d.ts`（本包无）；各包 tsconfig `include` 仅 `src/**`——SA6 红灯跑「Type Errors: no errors」从未对 `.test.ts` 中的 `Request/Response/Headers` 做过类型检查。独立实证：`@types/node@20.19.43` 经 `web-globals/fetch.d.ts`（index.d.ts L42 引用）声明全局 `Request/Response/Headers/fetch`；以仓库 strict 选项 + `@types/node` typeRoot 的 tsc 探针 exit 0；设计 manifest devDeps 含 `@types/node ^20`（pnpm 链接后默认 typeRoots 命中包级 `node_modules/@types`） | 锚点 11 的证据链是空证据（结论本身成立）；若 SA3 误把 `vitest --typecheck` 当作本包类型门，会得到虚假的「类型干净」 | 更正锚点 11 证据：改为引 `@types/node` web-globals 全局声明 + 根 `pnpm typecheck` 链（设计已把新包加入该链，其为 operative 门） | 修订后锚点 11 不再引用 SA6 `--typecheck` 输出作为全局可解析的证据 |
| F-M4 | MINOR | 13 包普查：README 13/13、AGENTS 12/13。设计 §11 ALLOW LIST 含 AGENTS.md 不含 `packages/namespace-api/README.md` | 与既有包惯例（每包 README）存在一处未声明的偏离；SA8 移交义务只提 AGENTS.md，故非违约，但惯例补全应有显式决定 | 二选一：把 `packages/namespace-api/README.md` 加入 ALLOW LIST（内容：包契约摘要 + 构造/验证入口，照 registry/vfsl README 惯例）；或在 §11 显式记录「本票不建 README」的理由 | ALLOW LIST 与决定一致；实现不出现范围外文件 |

无 BLOCKER、无 MAJOR —— 依据 Finding 规则不构成 `reject` 条件。

## 14. Non-blocking observations

1. **D5 fail-loud rejection 语义无契约断言**（SA6 §15 明示延后行为不测，属裁定过的切片边界）：SA3 若把未映射结局实现为 500 Response 而非 rejection，35 用例仍全绿。建议（非阻断）：新包 `AGENTS.md` 把「未映射结局一律 `handle` rejection，不产生任何 HTTP 错误 Response」写成显式包契约，使 FR-3 错误契约票有明确替换点、SA4/SA7 有对照锚。设计 R1 已含「AGENTS.md 明示骨架仅成功路径」，本建议是其自然延伸。
2. **Hub 侧过渡期接受面**：非 JSON `Content-Type`、额外 body 键、query 存在、percent-encoded owner（Hub 侧）在本票均被接受或走 fail-loud rejection——全部属简文明示延后的 step 3–5（FR-1/FR-3），设计 D3/D5 已如实披露，非静默扩大。
3. **锚点 11 的实质结论已被本评审独立加固**：除 tsc 探针外，Node 20 与 24 均在 CI test 矩阵中，全局 `Request/Response/Headers` 自 Node 18 起可用，SA6 绿灯模拟（E1，35/35）亦已在 node v24.13.0 实测运行时可用性。
4. **SA8 遗留非阻断登记维持**：worktree git 配置残留（`mabf.issue=74` 等历史标记）与历史对象库局部缺损两项仓库级观察不构成本评审冲突基准，归 runner/总控。
5. **本评审无需重开 ADR 冲突门禁**：四条 MINOR 均为文字精度/惯例补全，不触碰 SA8 设计后复审列举的任一重开条件（冻结面、提前实现延后语义、role 来源、文件范围越界、解释性偏离）。

---

审查日期：2026-09-11（dispatch `sa-8d55f6f4-4ccf-499f-a6d3-d8c42ee94966`，iteration 0，design-review）。

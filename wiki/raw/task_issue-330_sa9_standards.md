# SA9 Standards Review（仓库与工程标准轴）— Issue #330 nomicore 服务表面 getter 化（ADR 0023 落地）

- 派发：`sa-7e412843-f264-415c-a67b-d11a779fc8fa`（role `mabf-sa9`，phase `standards-review`，iteration 0）
- **Verdict：`approve`**（无 BLOCKER、无 MAJOR；MINOR 4 项不阻断，见 §7）
- 审查对象：最终已提交 diff `83581b30be81…`（母 PR #329 head，ADR 0023 文档落地）→ `a7e294a2bc32534467be1dcbf8d9489d5f2d7cd9`（`fix: expose frozen services through proxy-safe getters`，branch `mabf/issue-330` HEAD）
- Worktree：`/home/wangjian/nomicore-fix-issue-330`；`git status` 跟踪面零改动（工作树 == HEAD），未跟踪仅任务简报与 6 份证据日志（见 §7-O1）
- Issue-comments REST：`[]`（无 Owner 评论来源的 override/附加义务，无 comment ID/时间戳可应用）——与简报、SA6/SA8 记录一致
- 审查方式：静态实读 + 只读命令独立复核（`git diff`/`git diff -w`/hunk 定位/全仓 grep/`git diff --check`/日志抽读）。**未运行测试、未启动服务、未修改任何代码/设计/测试**——绿证据采信已入库报告 + worktree 内日志原文，本审查只对证据链真实性做抽验。

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| 任务简报 `wiki/raw/task_issue-330.md`（Issue 正文 AC1–AC8；Comments 空） | 已读 |
| 母法 `docs/adr/0023-proxy-consumable-frozen-service-surfaces.md`（决策 L45–62、姿态 L64–74、实现注意 L78、验收 L90–93） | 已读全文 |
| 术语面 `CONTEXT.md` L129–131（「服务表面」+ Avoid 两条红线） | 已读（实读现行文本） |
| 设计 `task_issue-330_design.md`（§7.2 S1–S5、R1–R6、§7.3/§7.4/§7.6/§7.7、§11 ALLOW/DENY、§12、§15） | 已读 |
| SA2 `approve`（MINOR O1–O3）、SA3 实现报告 + 4 日志、SA4 `approve`（MINOR O1–O4）、SA6 契约 `approve`、SA7 `approve` | 已读 |
| SA8 前置门禁 `clear`（`requiresConflictRecheck=true`）+ 实现后复查 `clear`（`=false`，10 冻结面闭合） | 已读 |
| 三包 `AGENTS.md`（clock / namespace-registry / ws-replication）、`docs/AGENTS.md`、根 `AGENTS.md`、`.agents/WORKTREES.md` | 已读（注入 + 实读） |
| 最终 diff 全部 16 文件（4 源文件 + 3 新测试 + 9 wiki 报告） | 已读/实跑复核 |

## 2. 独立复核（非转述 SA 声明）

| 复核项 | 命令/方法 | 实测结果 |
|---|---|---|
| diff 范围 | `git diff --name-only 83581b3 a7e294a` | 恰 16 文件：4 ALLOW 源文件 + 3 ALLOW 新测试 + 9 wiki 报告；DENY 面（types.ts/contract.ts/接口区块、docs、configs、CI、scripts、package.json、apps/domains/其余 packages）零触碰 |
| 方法体逐字平移 | `git diff -w` 语义残渣过滤 | 残渣仅为：声明形态行（方法简写/内联箭头 → `const x = … =>`）、ADR 0023 注释、R4 显式注解、1 空行（registry）；无任何行为改动夹带 |
| `Object.freeze` 保留 | grep 五构造点 | system.ts:12、manual.ts:52、plugin.ts:435/536、registry.ts:2282 五处 freeze 原样 |
| getter 形态（R2） | grep `get <m>() { return <const> }` | 18 个改造成员全部为裸 return 稳定闭包；hub/peer `status` 两既有值 getter 逐字未动 |
| teardown reverse-yield | 实读 plugin.ts L446–448 / L552–555 | `ctx.effect` 块（`yield revoke; yield stop;`）逐字未动；`stop` 命名 const 零提升 |
| 接口面零变化 | hunk 定位 | registry hunk 恰 1 个在 L2176+；plugin.ts hunk 全在 L428+/L502+（接口区块 L35–56 未触碰）；manual.ts hunk 在 L31+（`ManualClock` 接口 L17–20 未触碰）；types.ts/contract.ts 零 diff |
| 数据载荷不误伤 | 实读 registry.ts L760–772 | `clonePlainData` `writable:false` defineProperty 原样；hunk 区间不重叠；`namespace-runtime` 零改动 |
| 服务面审计完备 | 全仓 `ctx.provide(` 盘点 | 恰 6 站点（clock contract、instance、registry、persistence、hub、peer）；5 个「冻结字面量+函数成员」表面全部在 diff 内；`nomicoreInstance`（纯数据）/`nomicorePersistence`（class 原型）按 ADR L37–38 排除正确——无第六个遗漏表面 |
| AC4 审计分支 | `grep -rn "\bwritable\b" 三包 --include="*.ts" \| grep -v writableLength` | 恰 2 命中：types.ts:518（注释词）、registry.ts:766（clonePlainData 数据载荷）——确无服务成员 `writable === false` 形态断言，审计分支选择正确，SA3 报告 §AC4 已记录在案 |
| 测试削弱扫描 | grep `.(skip|only|todo)(` 三新文件 | 零命中 |
| 测试入口真实 | 实读 vitest.config.ts L15/L20 | `packages/*/test/**/*.test.ts` include glob 命中三新文件；包 tsconfig 含 `test/**` 进 typecheck 门禁 |
| helper 包内复制（AC6） | 三文件实读比对 | `guardProxy` 各文件内联（逐字同款 SA6 §12.3/设计 §7.6），无新建共享测试设施/模块/导出 |
| 导入惯例 | 比对兄弟测试 | clock 新文件用 `../src/index.js`+`../src/testing.js`（同 clock 既有测试）；registry 新文件用 `@nomicore/namespace-registry`+`/testing` 公共面（同 registry-plugin.test.ts）；ws 新文件用 `../src/index.js`+公共 provide——公共 API 边界惯例保持 |
| diff 卫生 | `git diff --check 83581b3 a7e294a` | 零输出（干净） |
| 证据链真实性 | 抽读未跟踪日志原文 | `_sa3_red.log`（13:29，8 用例全红，含原始 ECMA-262 不变量错误消息——不可能由改造后代码产生）→ `_sa3_green.log`（13:31，8/8 绿 + Type Errors none）→ `_sa3_root-test.log`（13:43，341 文件/3596 用例全绿）→ `_sa3_pack-local.log`（exit 0，14 tgz）；红→绿次序与内容真实 |
| 探针残留 | `ls packages/ws-replication/.sa6*/.sa7*` | 无残留 |

## 3. 标准符合性逐项

### 3.1 ADR 0023（母法）—— ✅ 逐项符合

| 条款 | 符合性 | 证据 |
|---|---|---|
| L45–62 决策：函数成员一律访问器属性（稳定闭包 + getter + freeze 保留 + 方法体一行不动） | ✅ | §2 复核：18 成员全 getter 裸 return；`diff -w` 证明体逐字平移；五 freeze 原样 |
| L30–41 影响面：恰改 5 受影响行；instance/persistence/timer/lease 返回值/信封排除 | ✅ | 6 个 provide 站点盘点 + `decorateLease`/NOOP_DIAG/信封常量零触碰 |
| L64–74 姿态对照：赋值拒/重定义拒/类型面不变/引用缓存不变/枚举性保持 | ✅ | 三新测试 `expectAccessorPosture` 断言块（无 value 槽/get 函数/set undefined/configurable false/enumerable true/isFrozen/赋值与 defineProperty 均 TypeError）逐成员覆盖 18+2；`m === m` 稳定闭包断言；`Object.keys` 键序断言 |
| L78 实现注意：deepFreeze 访问器注意 | ✅ | diff 零触碰任何 deepFreeze 实现；仓内 deepFreeze 不消费五服务（SA8 核验成立） |
| L90–93 验收：每服务 guard-proxy 回归（包内 seam + 包内 helper）、形态断言、门禁、tarball | ✅ | 三新文件齐备；helper 三份包内复制；SA3 全门禁日志在案（三包 typecheck、root typecheck/test、pack:local 三 tgz + dist getter 形态）；DSH 侧联动按 ADR 划为仓外 |

### 3.2 CONTEXT.md 术语与 Avoid 红线 —— ✅ 无违规

五表面全部兑现 L129–131「含函数成员的对象字面量服务一律访问器属性 + 保留 freeze」纪律；未新增任何「冻结字面量 + 数据属性方法」形态；未为可包装性去 freeze（两条 Avoid 红线均无触碰）；术语无借用/重定义，无需文档演进。

### 3.3 模块责任与三包 AGENTS.md —— ✅ 无违规

- **clock**：无新公共 API；`index.ts`/`testing.ts` 零 diff，ManualClock 仍仅经 `@nomicore/clock/testing`；无调度行为引入（只观察时间）；生产装配仍走 system-clock plugin。
- **namespace-registry**：生命周期次序（停接纳 → drain → 取消 idle timer → 关 runtime → 聚合失败）在逐字平移的闭包体内保持；`shutdown` 非 async exact-same-Promise 契约注释随体平移（现行 L2268–2270 区）；owner 检查/门禁未弱化；公共 API 只经 index.ts。
- **ws-replication**：wire 零触碰（docs/protocols、帧/状态机/错误码不在 diff）；插件仍只拥有 listener/dialer、replication controller、连接/通道与其发布的服务；ADR 0012 reverse-yield teardown 逐字保持；上游服务 teardown 仍在组合根。
- 闭包提升点均在拥有实例状态的构造点（registry 工厂 / apply / clock 模块与工厂）——无行为移出事实 Owner，无应用层参与。

### 3.4 单一事实源 —— ✅ 无违规

每个方法实现恰一份（提升闭包）；getter 只 return 该 const，无第二实现/镜像状态；冻结姿态唯一事实源为 `Object.freeze` + 描述符断言，无 marker/标签反推；`service.m === service.m` 断言锁死。

### 3.5 生命周期对称性 —— ✅ 零变化

`ctx.provide`/revoke 配对不变；hub/peer `ctx.effect` reverse-yield（revoke → stop）逐字；`stop`/`shutdown` 缓存 Promise 一次性结算语义不变；registry 三相接纳态机、idle timer、`liveWaits` 结算访问序不变；测试均以 `ctx.fiber.dispose()` 收尾。无新建未配对资源、无 teardown 次序漂移。

### 3.6 文件范围 —— ✅ 符合

diff 恰为设计 §11 ALLOW 7 路径（4 源 + 3 测试）+ 技能强制 wiki 报告（9 份，wiki/raw 大量先例的惯例面）；DENY 面逐项零触碰（§2 复核）；无无理由扩张、无顺手改造（`status` getter、`stop` const、`decorateLease`、fake timer shim 均按排除面保持）。

### 3.7 测试质量标准 —— ✅ 符合

三新文件每用例三重对照（敏感性正控：helper 对冻结 data 形态必抛 TypeError，防空洞绿；诚实 Proxy 负控：失败不来自 Proxy/冻结本身；被测断言）；行为直通断言观察运行时结果（deep-equal 信封、same-Promise 恒等、manual 错误语义透传后读数不变、注入 timer + stop() 触发 settle——无真实 sleep/轮询）；姿态断言块逐成员；键序断言；无 skip/only/todo、无 env override、无源码字符串断言；红→绿证据链真实（§2 抽验）；文件被 root runner 真实收集（root-test log 实录 341 文件）。

## 4. 文档标准（docs/AGENTS.md）—— ✅ 无违规

本 diff 零规范文档改动且无需改动：ADR 0023（母 PR 已落地）自身描述改前/改后两形态；CONTEXT.md 术语已预先登记；无契约被静默矛盾、无 stale 引用产生；`git diff --check` 干净。wiki/raw 产物按 authority 节属证据面，与既有任务档案惯例一致。

## 5. 上游结论链核对

SA2 `approve`（O1 已按建议处置——实现 `waitForLive` 注解正确）→ SA3 全门禁绿 → SA4 `approve`（O1–O4 非阻断）→ SA8 实现后复查 `clear`（10 冻结面闭合，`requiresConflictRecheck=false`）→ SA7 `approve`（62/62 动态观察 ×4 次稳定、post-removal 复跑一致）。本审查独立复核未发现任何与其矛盾的事实；结论链可追溯、无「先改后补票」。

## 6. Required revisions

无 BLOCKER、无 MAJOR。

## 7. Non-blocking observations（MINOR，不阻断 approve）

| ID | 观察 | 证据 | 建议处置 |
|---|---|---|---|
| O1（MINOR） | 已入库的 SA3/SA6/SA7 报告引用的 6 份证据日志（`_sa3_red/green/root-test/pack-local.log`、`_sa6_red_probe.log`、`_sa7_dynamic_probe.log`）与任务简报 `task_issue-330.md` 共 7 文件仍为未跟踪；既有任务（issue-239/242/254、vfsl-codegen-hardening 等 11 份 .log）有将引用日志入库的先例 | `git status --short`；`git ls-files wiki/raw \| grep .log` | 收尾/finalize 时将简报与日志一并入提交，消除悬挂引用；不属本 diff 的代码面问题 |
| O2（MINOR，承接 SA4-O1） | ws 测试两处契约字面偏差：hub 未断言「listener close 恰一次」、peer `status` 未与直连 deep-equal（hub 侧有）；红灯断言本体（sweep+行为+姿态+键面）完整，SA7 已以动态证据补证（D12 close=1、E4/E11 字段级） | `ws-replication-guard-proxy-consumption.test.ts` L137–138/L179–180；SA7 §8 | 后续维护时补 `expect(guarded.status).toEqual(service.status)`（peer）与 close 计数断言（hub）；非本票阻断项 |
| O3（MINOR） | 提交信息 `fix: expose frozen services through proxy-safe getters` 未带 `#330`/ADR 0023 引用；仓库先例两种并存（`fix(#254):…`、`feat(#282):…` vs `fix: make published CLI bins…`） | `git log -1` | 无需返工；后续 commit 建议带 issue 引用以便追溯 |
| O4（备注，host 侧、diff 范围外） | 本 worktree `/home/wangjian/nomicore-fix-issue-330` 为仓库同级目录，与 `.agents/WORKTREES.md`「常规 worktree 建于 `.worktrees/` 下」不符；属编排侧基础设施，非交付 diff 内容 | `git worktree list` | 记录备案；由 host/编排侧处置，本流水线无需动作 |

## 8. 裁决

**`approve`**。最终交付 diff 是 ADR 0023 的忠实机械落地：仓库 AGENTS/ADR/模块责任/既有架构惯例/单一事实源/生命周期对称性/文件范围/测试质量八个标准轴全部符合，无 BLOCKER、无 MAJOR；四项 MINOR 均不构成本票合并障碍。无新的 ADR 冲突风险（不提交 `requiresConflictRecheck`；SA8 实现后复查已闭合且本审查未发现新决策面）。

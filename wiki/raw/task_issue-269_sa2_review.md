# SA2 设计攻击评审 — Issue #269：REST create 的 Registry 失败语义、取消边界与双 observer 契约

> 阶段：design-review（iteration 0）。派发：`sa-bb343860-7b7b-44b6-bad6-aa7d4a5655b8`（mabf-sa2）。
> 评审对象：SA1 实施设计 `wiki/raw/task_issue-269_design.md`（iteration 0，派发 `sa-0b806535…`）。
> 评审基线：worktree HEAD `0b06050d9518c66ef166751064c95ed9557c9532`（branch `mabf/issue-269`，实测一致）。
> dispatch 点名四项专项：`committed:false` 映射、取消/读取段排序边界、observer 契约、required ADR updates——均已独立复核（§7/§8/§11 专项小节）。

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（issue #269 body + AC1–AC6） | `wiki/raw/task_issue-269.md` | 已读；与 SA6/SA8 引用一致 |
| SA1 实施设计 | `wiki/raw/task_issue-269_design.md`（437 行） | 已全文读 |
| SA6 验收契约（approved，29 用例冻结） | `wiki/raw/task_issue-269_sa6_contract.md` | 已全文读 |
| SA8 前置门禁（clear，OBS-1/2/3） | `artifacts/sa8-conflict-report-issue-269.md` | 已全文读 |
| SA8 设计后复审（clear，OBS-R1-1 等 6 项） | `artifacts/sa8-conflict-report-issue-269-design-recheck.md` | 已全文读 |
| 派发记录 | `wiki/raw/task_issue-269_dispatch.md` | 已读；Issue-comment REST snapshot `[]` |
| 冻结测试（SA6 5 文件） | `packages/namespace-api/test/rest-{registry-failure-mapping,abort-boundary,observer,failure-contract-support}*.test.ts` + `rest-failure-contract-harness.ts` | 已全文读（mapping 349 行 / abort 233 行 / observer 563 行 / harness 411 行） |
| 冻结测试（#267 4 文件） | `rest-{create-hub,role-gate-routing,contract-support,public-seam-wiring}*.test.ts` + `rest-contract-harness.ts` | 已读关键断言（observer 用法 / 构造门 / seam 接线） |
| 生产源码 | `packages/namespace-api/src/{rest,create-namespace,index}.ts`、`packages/namespace-registry/src/{types,errors,registry}.ts`、`packages/vfsl/src/index.ts`（deriveSchemaIdentity） | 已读并逐锚点核对 |
| 决策基准 | `docs/adr/0015`（L100–200 全读）、`docs/adr/0009`（§Create/§Persistence 错误演进/§Fatal/§Shutdown）、`docs/adr/0010`（经 SA8 引用）、包 `AGENTS.md`、`README.md` | 已读 |

固定位置缺失项：`wiki/raw/task_issue-269_conflict_report.md`、`task_issue-269_relevant_decisions.md` 不存在（SA8 产物实际在 `artifacts/`；SA6/SA8/设计均已登记，SA8 OBS-E）。按技能规则以现有证据继续，不构成安全性判断缺口——替代证据链完整且实测可核。

## 2. Verdict

**`approve`** —— 无 BLOCKER、无 MAJOR。阻断 finding 数 0；非阻断观察 4 条（§14）。

四项 dispatch 专项独立复核结论（细节见对应节）：

1. **`committed:false` 映射（R1）**：fatal `committed:false` → 500 `INTERNAL_ERROR` 是三候选中唯一与 ADR 0009 §Create L70 / §Persistence 错误演进（「Registry 只把 typed operational error 映射为公开 create issue」「Persistence fatal 的 committed 事实原样传播；unknown exception 不能伪装为运营失败」）和 ADR 0015 L175–L178 不矛盾的落位；`committed` 为唯一二分判别子与 `registry.ts` 实测矩阵（`lifecycle-slot-internal` 的 committed 可真可假）匹配，四个 phase 全覆盖无死角。**通过**。
2. **取消/读取段排序边界（R3/H-A/R2）**：入口同步判定 + raced read + 胜出同步再核对的三道闸门是对 ADR 0015 L113 的忠实实现展开；「读返回 → `registry.create` 之间零异步窗口」经源码实测成立（`deriveSchemaIdentity` 为同步导出函数）；abort 以有界 rejection 结算不伪造 HTTP status 与「不发明未评审 problem shape」纪律一致。**通过**。
3. **observer 契约（H-M/H-D）**：类型事件化兼容 #267 冻结零参 observer（TS 少参函数可赋多参签名，实测 `NOOP_OBSERVER = (): void => {}`）；发射矩阵与冻结 D2/D4/D5/D6 逐键逐词一致；diagnostic owner 措辞的诚实性限定保留。**通过**。
4. **required ADR updates**：设计锚定 ADR-0015 blob `64daa16a43ef2718f7f8d692f77a82ac7517e341` / sha256 `3a75f99b…148`（本次实测逐字节一致）、声明「0015 修订 → 重过门禁」触发器、DENY `docs/adr/**`（接受流程归父 PR #158）——与 SA8 两轮 clear 裁决一致。唯一残余：SA8 OBS-R1-1 的「R1/H-A/R3 须在 0015 接受时折入 ADR 文本」义务未在 §13 残余清单中点名（MINOR，§14-OBS-3）。**通过（带一条非阻断补记建议）**。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| 失败映射：`REGISTRY_NOT_ACCEPTING` → 503（零提交、可稍后重新请求） | §7.1 T1；§8 失败投影 | 覆盖；ADR 0015 L175 逐字；不加 `Retry-After`（AC/ADR 均未要求，不发明）——正确 |
| typed operational → 500 `NAMESPACE_CREATE_FAILED`（code 语义保证 committed:false） | §7.1 T2 | 覆盖；窄 issue 通道专属映射，零 diagnostic（非 L190 三类事件）——正确 |
| fatal `committed:true` → 500 `NAMESPACE_CREATE_OUTCOME_UNKNOWN`（不得自动重试） | §7.1 T6；§9（无补偿动作） | 覆盖；`instanceof` + `.committed` 判别 |
| fatal `committed:false` 落位（ADR 欠规格，SA8 OBS-2 交设计钉死） | §7.1 T7 + §7.2 R1 论证链 | 覆盖；见 §7 专项 |
| unknown exception / 内部契约违例 → 500 `INTERNAL_ERROR` | §7.1 T8 + T3/T4（R4） | 覆盖；`INVALID_INPUT`/`ALREADY_EXISTS` → 安全 500 + diagnostic `unknown-exception`（L178 同类分组，三类 kind 无第四类） |
| REST 不返回 `NAMESPACE_ALREADY_EXISTS`（碰撞 Registry 内部处理） | §7.1 T4；§2 锚点 9 | 覆盖；映射为 INTERNAL_ERROR 而非透传 |
| 取消边界：body 读取尊重 `Request.signal`、中断后 Registry 零触达 | §7.3 三道闸门 + 零异步窗口论证 | 覆盖；见 §8 专项 |
| 调用 Registry 后不传播取消、等待 settle 并 release | §7.3「接纳后零观察」；§7.8 | 覆盖；release 恰一次 |
| Observability：两 observer 显式注入、throw 隔离 | §7.4.3 helper；§9 | 覆盖；D1 门保持（`typeof === 'function'` 不变） |
| metrics 低基数无敏感字段 | §7.4.1 键集 + §7.4.2 发射矩阵 | 覆盖；见 §11 专项 |
| diagnostic 仅三类事件、无 schema/root/完整 issues；Host 负责访问控制/采样/脱敏 | §7.4.1/§7.4.2；§8（Host 敏感运维 Adapter） | 覆盖；cause 恒为对象引用，不序列化不展开 |
| 文档同步（包 AGENTS.md deferral / README） | §1 目标 4；§11 ALLOW | 覆盖（精度建议见 §14-OBS-2） |
| AC1–AC6 六条验收 | §12 验收映射 | 6/6 对应 SA6 冻结断言（§12.3） |
| Blocked by #267 | §2 锚点 10 | 依赖已解除（#267 CLOSED，PR #296 = HEAD `0b06050` 实测） |

目标与非目标无静默扩大：非目标显式排除 #268 的 4xx/422 族、`rejected` 发射策略、listener/server/drain、ADR 状态变更、Registry/Persistence/VFSL 变更——与 issue 家族切片和包 AGENTS.md 边界一致。

## 4. Owner评论覆盖

| Comment ID | Updated at | Design section | Assessment |
|---|---|---|---|
| （无）Issue #269 comments REST snapshot = `[]` | — | §4（设计明示「空（`[]`）」） | 无评论级 owner 要求可映射。三源一致：任务简报 Comments 节空、dispatch 日志（SA8 conflict-gate iter 0）记录 `[]`、SA8 两轮报告实测 0 条。验收口径 = issue body What to build + AC1–AC6。**一致** |

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA6 红灯基线 `17 failed \| 47 passed (64)`、`Type Errors: no errors`（3/3 一致） | §2 锚点 11；§5 引用；§12 转绿预期 | 引用无失真（红灯点分布与冻结文件断言面吻合） |
| SA6 绿灯可满足性（同字节 64/64）+ 14 组变异全捕获 | §5；§7 决策逐条对应 M1–M13 | 设计与模拟件语义同构，风险集中在边界细节——经 §7.8 伪代码逐分支核对，未见偏差 |
| Node 24 运行时事实：pre-aborted + 完整 body 时 `json()` 仍 resolve；mid-read abort 不自行结算 | §3 放大因素；§7.3「不得依赖平台、必须显式观察」 | 与 `rest-failure-contract-support.test.ts` 恒绿锚（L150–178）实测一致 |
| SA8 F1–F4 / C1–C2 / O-1–O-3（15/15 一致） | §6 表逐条落实（§7.1/§7.3/§7.4/§7.5/§9） | 逐条对上；T1/T2 零 diagnostic 的裁决与「NOT_ACCEPTING 不访问输入」「typed operational 非三类事件」的 ADR 事实匹配 |
| SA8 OBS-1（ADR-0015 提议状态，须锚定修订） | 文档头 + §13（HEAD/blob/sha256 + 修订触发器） | 锚定本次实测复核一致（§12 专项四）；触发器有效 |
| SA8 OBS-2（fatal committed:false 落位交设计） | §7.2 R1 确认（含 A1/A2 拒绝理由） | 见 §7 专项 |
| SA8 OBS-3（与 #268 共享读取段，声明 seam 裁决） | §7.6 排序不变量（R3/C5）+ 纯加法边界 | 见 §8 专项 |
| SA8 设计后复审（iteration 1，clear；四条上报理由逐条裁决为计划内加法或诚实填补） | §14（设计自报 `requiresConflictRecheck: true`，已被 SA8 复审消化） | 复审结论与本次独立核验一致；无新 ADR 冲突面被引入 |
| committed 事实矩阵（registry.ts 实测） | §2 锚点 8：id-generation 恒 false（L897）；create-document-internal = `DocRuntimeFatalError.committed` 或 false（L1469/1471）；lifecycle-slot-internal 原样传播（L1539/1547）；runtime-construction 恒 true（L1583）；operational → 窄 issue（L1517–1523 区段） | **本次逐行实测一致**；「按 phase 推断提交事实是错误设计」的论断由此成立 |

## 6. 设计内部一致性

- **映射表 ↔ 伪代码 ↔ 冻结测试三方一致**：§7.1 T1–T11 与 §7.8 伪代码逐分支同构，且与冻结断言逐条对上（T1↔B1、T2↔B2、T3/T4↔B5/B6+D5(c)(d)、T6↔B3/D5(a)、T7↔B4/D5(b)、T8↔B7、T9↔C1/C2/C5、T10↔D2、T11↔D4/D3(d)、T5↔负控零断言面）。每分支 metrics 事件的 outcome/code/status 与 `assertSingleMetricsEvent` / D6 计数（1×succeeded、1×unavailable、5×failed、1×aborted）逐位吻合。
- **diagnostic cause 引用面一致**：fatal 分支 = `NamespaceRegistryFatalError` 实例本身（非 `fatal.cause`）——与 B3/B4/D5 的 `expect(event['cause']).toBe(fatal)`（fatal = create 结算值）一致。
- **无死引用/旧 API**：§2 全部行号锚点本次实测命中（rest.ts L15–20/L44–47/L53–55/L137–144→实测 L44–47/L53–55/L137–144；create-namespace.ts L36/L61–63/L71–75；types.ts L275–310；errors.ts L21–45）。
- **接口环引用安全**：rest.ts 运行时导入 create-namespace.js；create-namespace 以 `import type` 引事件类型——TS 类型环安全擦除，运行时依赖保持单向。成立。
- **一处措辞级不精确**（非阻断，§14-OBS-1）：§7.4.2 概括句「恰一个 metrics 事件/orchestration」与 §8 路线表「恰一事件/orchestration」对 T5（`NAMESPACE_INVALID_IDENTITY`/`SCHEMA_INVALID`/`ROOT_INVALID`）与 body/形状/派生族 rejections 不成立——这些路径在过渡期零事件。§7.4.2 的枚举（T1–T4、T6–T8、T9、T10、T11 + 403/405/未匹配零发射）与 T 表本身是精确的，仅概括句过宽；冻结契约不要求该族发射（D6 仅「出现即合规」），故为措辞问题非语义缺口。

## 7. 状态机与并发攻击（专项一：`committed:false` 映射）

R1 裁决（fatal `committed:false` → 500 `INTERNAL_ERROR`，`committed` 为唯一判别子）攻击复核：

| 攻击 | 结论 |
|---|---|
| 改判 → 500 `NAMESPACE_CREATE_FAILED`？ | 违反 ADR 0009「Registry 只把 typed operational error 映射为公开 load/create issue」——FAILED 的 code 承诺专属窄 issue 通道，fatal 走 branded rejection 通道；且 L182 允许 FAILED「可修正后重新发起」，内部故障不应获此语义。SA6 M1 变异证明契约会捕获。设计拒绝正确 |
| 改判 → 500 `OUTCOME_UNKNOWN`？ | OUTCOME_UNKNOWN 全部含义是「可能已提交、不得自动重试」（L177 + ADR 0009 §Create L70「以 committed:true fatal reject」）；committed:false 时结局确定，报 UNKNOWN 不诚实。M2 捕获。设计拒绝正确 |
| 以 phase 代替 committed 判别？ | `lifecycle-slot-internal` 的 committed 原样传播自 `DocCreateFatalError`，**可真可假**（registry.ts L1539/L1547 实测）——按 phase 推断必然在某一分支错分。设计以 committed 为唯一判别子后四 phase 全覆盖。正确 |
| fatal 走 catch-all（T8）而非专属分支？ | T6/T7 专属分支携带 operation/phase/committed 诊断字段；instanceof 失配的 wrapped fatal 落 T8 仍是 500 + diagnostic `unknown-exception`（诚实、非静默，A4 备选已论证）。安全降级可接受 |
| INTERNAL_ERROR 的 diagnostic kind 用 `registry-fatal` 与 T7 一致吗？ | 一致：T7 发 `{kind:'registry-fatal', committed:false, …}`（B4 断言 kind + cause 引用 + 条件 committed）；T3/T4（窄 issue 注入）用 `unknown-exception`（R4，L178 同类分组）——两类不可混淆，冻结断言分别锁定 |

**判定：R1 站得住，无缺口。**

### 状态机与并发攻击总表

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| SM-1 | 请求进入 `handle`，signal 已 aborted | pre-abort | 入口同步判定 → abort 结算，零 Registry 触达 | 无（§7.3 步骤 1；C1/C5 锁定；Node 24 平台放大因素已实测背书） | — |
| SM-2 | body 读取中 | mid-read abort | race 的 abort 事件结算，有界 rejection | 无（§7.3 步骤 2；C2 锁定；不依赖平台读自行失败） | — |
| SM-3 | 读胜出、待核对 | abort 与 json() resolve 同 tick | 胜出后同步再核对 `signal.aborted` → abort 优先 | 无（§7.3 步骤 3 同步读 flag，无微任务窗口） | — |
| SM-4 | 读返回后、create 调用前 | 任意时刻 abort | 「零异步窗口」结构保证被观察的 abort 必在触达前 | 无（形状检查/`deriveSchemaIdentity`（实测同步导出）/envelope 组装全同步） | — |
| SM-5 | create 在途 / release 在途 | 客户端 abort | 不传播取消；等待 settle；release 恰一次；仍 201 + metrics succeeded | 无（§7.3 接纳后零观察；C3/C4 锁定；M8 变异防回归） | — |
| SM-6 | race 结束（json 败方悬挂） | server 断连后 json() 才 reject | 败方已挂接反应，无 unhandled rejection；监听器 finally 移除 | 无（§7.3 卫生条款；不 cancel 已锁流，清理归 server 票——与 ADR L32 router 无 listener 一致） | — |
| SM-7 | `registry.create` 同步 throw | 病态 registry | try 块捕获 → T8 500 + diagnostic | 无（§7.8 try 包裹调用表达式，同步 throw 同样入 catch） | — |
| SM-8 | T5/body 族（unmapped） | 窄 issue / 形状 / 派生失败 | 保持 #267 现状 rejection（错误文案逐字保留） | 无（§7.8 default 分支与现状 `unmapped registry issue: <code>` 一致） | — |
| SM-9 | malformed JSON 与 abort 同现 | json() rejection 先胜 | rejection 原样传播（#268 族），Registry 零触达仍成立 | 无阻断：结局归类差异（无 metrics 事件 vs aborted）由 §7.6 不变量约束 #268（「任何读取期结局发射前必须再核对 signal」），见 §14-OBS-4 备注 | — |
| SM-10 | router 长期运行 | 并发请求 | 构造后零共享可变状态；每请求独立闭包 + 一次性监听器随请求结算清理 | 无（§8/§9；与 #267 冻结「不全局串行」一致） | — |

## 8. 错误与恢复攻击（专项二：取消/读取段排序边界）

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| ER-1 | Registry shutdown 中 create | T1 503 + `unavailable`，零 diagnostic（NOT_ACCEPTING 不访问输入 ⇒ 零提交语义成立） | 无——ADR 0009 §Shutdown 实测背书 | — |
| ER-2 | release 失败 | T11：仍 201、不重试、不二次调用、diagnostic `lease-release-failure`（namespaceId 取 release 前冻结 DTO 副本） | 无——ADR 0015 L161 逐字；DTO 先复制后 release 防变异（harness `mutateNamespaceIdOnRelease` 探针存在） | — |
| ER-3 | observer throw | 全调用点经同步 try/catch helper 隔离，不改 HTTP 结果 | 无——结构性保证（§7.4.3「仅在个别分支包裹」被正确拒绝）；D3 四分支 × 双 observer 锁定 | — |
| ER-4 | 非 Request（缺 signal）/ 病态入参 | 自然 TypeError fail-loud，不静默当「永不中断」 | 无——诚实失败优于伪降级 | — |
| ER-5 | fatal `committed:true`（已提交） | T6 OUTCOME_UNKNOWN + 无补偿动作；已提交 namespace 由 Registry 保留、后续可 open | 无——ADR 0009 §Create「不得补偿删除、fallback 或声称 rollback」逐字遵循 | — |
| ER-6 | 内部契约违例（INVALID_INPUT/ALREADY_EXISTS 到达 REST） | 安全 500 + diagnostic（issue message 不入任何 client 面） | 无——B5/B6 的哨兵不泄漏断言锁定 | — |
| ER-7 | abort 与 413（#268 limits）同现 | abort 优先：入口判定先于任何读取期检查；#268 byte 判定须嵌 raced read 内部或其后、发射前再核对 | 无阻断——R3 是对 ADR 未规定交互的填补（L113 signal 义务范围 = 读取阶段；L172 413 映射不被否定）；C5 可执行锁定且两票合入后均须绿 | — |
| ER-8 | #268 step-3 4xx（如 415）与 pre-abort 同现 | step-3 结局可先于 abort 结算（ADR L150–153 冻结顺序：step 3 在 step 4 之前） | 无——设计不 reorder 冻结顺序，与 #267 B-3 及包 AGENTS.md 固定顺序逐字一致 | — |
| ER-9 | abort 伪造 HTTP Response（499/408） | 被拒（H-A）：有界 rejection + metrics `aborted` 为唯一分类面 | 无——ADR 全文无 abort status 定义；发明未评审 status 违反骨架纪律 | — |
| ER-10 | 5xx body 携带 message/issue 投影 | 最小 `{"code":…}` 面；完整 problem shape 归 #268 | 无——不违反 L165 已钉死约束（稳定 code 分支、无 schema/root 片段）；SA8 OBS-B 备案 | — |

**排序边界专项判定**：abort 观察的三道闸门（入口同步 / race / 胜出再核对）+ 接纳后零观察 + step-3 先行不受触及——与 ADR 0015 L113、L150–153、L156–159 逐条吻合，与 C1–C5 冻结断言同构。**通过**。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `RestRouterOptions.metricsObserver/diagnosticObserver` 类型收窄（`() => void` → `(event) => void`） | 无缺口：#267 冻结 `NOOP_OBSERVER = (): void => {}`（create-hub L55/L93–94、role-gate L47–48/L56–57）按 TS 少参可赋值规则保持编译；构造期 `typeof === 'function'` 门不变（D1） | rest.ts L137–144 实测；role-gate L169–202 构造 TypeError 断言 | — |
| 新导出 `RestMetricsEvent`/`RestDiagnosticEvent`（rest.ts 定义 + index.ts re-export） | 无缺口：`rest-public-seam-wiring.test.ts` 只断言 `./rest` 子路径存在与指向源文件（实测全文 50 行），**不是**导出集合快照；package.json exports 白名单不动（`exports` 实测恰 `.` 与 `./rest`，类型经既有入口流出） | package.json exports 实测 | — |
| `handle` 新结局族（503/500 Response + abort rejection） | 调用方矩阵已覆盖：composition root/#270 须把 503/500 作为终局回复、abort rejection 视为连接级取消（不得记 500 或重试）；abort 判别子（私有 `RestBodyReadAbortedError` 不导出）显式留 #270 以加法提升 | §10 行 1；§13 残余 1 | —（过渡期 rejection 值形状非契约面，声明充分） |
| `orchestrateCreateNamespace` 签名改对象 deps | 无缺口：包私有（package.json exports 结构性阻断），唯一调用方 rest.ts 同票更新 | §7.7；create-namespace.ts 头注 L2–3 | — |
| #268 共享 `readRequestBody` seam | 约束已显式传递：§7.6 排序不变量 + C5 双票合入后保持绿；#268 设计评审应引用（SA8 OBS-R3-1 同向） | §10 行 5 | —（跨票治理已登记给总控） |
| Registry（被调方） | 零变化：判别输入全部为公共面（窄 code 联合 / branded fatal instanceof / catch-all） | §7.1；types.ts/errors.ts 实测 | — |

## 10. 架构一致性与惯例审查（并入 §11/§12 以避免重复，见下）

## 11. 文件范围审查（专项三：observer 契约；§10 架构一致性并入本节及下节）

### 责任归属（§10）

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| HTTP 失败投影（code/status/body） | REST Adapter（拥有 HTTP seam） | `create-namespace.ts` 映射终局（包私有） | 正确——Registry 语义零改动，投影不复制底层状态机 |
| committed 事实判别 | Registry（唯一事实源） | REST 只读 `fatal.committed` | 正确——无第二份提交状态，无从 phase/影子字段推断 |
| owner 事实 | route 捕获段（本票）/ #268 step-3 校验 | diagnostic `owner` 字段，措辞限定「提交给 Registry.create 的 owner」 | 正确——诚实措辞保留（SA8 OBS-D），#268 合入后歧义自然消除 |
| role 事实 | composition root（Instance service） | 不触碰；注入语义与 #267 冻结一致 | 正确——ADR 0012 无第二 role 源 |
| 访问控制/采样/脱敏 | Host | §8「Host 敏感运维 Adapter」 | 正确——ADR L190 义务归属未挪动 |

### 相似能力对照（§10）

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 最小 problem body | rest.ts 403/405 既有 `{code}` + `content-type: application/json` 先例（L96–109 实测） | `errorResponse(code, status)` 同构 | 一致 | 复用既有 body 形状，完整 problem shape 归 #268（家族切片） |
| 同步 void observer 隔离 | ADR 0011/0014 诊断日志「emit never throws、不改变业务结局」纪律（emit 包 try/catch 的 dispatch 先例见 registry.ts `dispatchObserver`） | `emitMetrics`/`emitDiagnostic` 同步 try/catch helper | 一致 | 同向纪律；REST observer 与 namespace 级诊断日志相互独立、无交叉污染（SA8 §4.5 已核） |
| 读取段 seam | #267 骨架裸 `request.json()`（唯一读取点） | 收敛为单一私有 `readRequestBody`，#268 复用 | 一致 | 不建平行读取路径；两票结局族不相交、纯加法互不改写 |
| abort 结算先例 | 无（本票为首创面） | 有界 rejection + metrics `aborted` | 一致（诚实读法） | ADR L188 词表含 aborted、无 status；不发明 499/408 |

### 单一事实源 / 生命周期对称性 / 平行机制（§10）

- **单一事实源**：无重复缓存、无镜像状态、无 marker 文件；`committed` 来自 fatal 对象、namespaceId 来自 Registry DTO、owner 来自 route 捕获——全部单一来源，无漂移风险面新增。
- **生命周期对称**：abort 监听器 add ↔ finally removeEventListener；lease acquire（create 成功）↔ 恰一次 awaited release；构造校验 ↔ TypeError；无定时器/worker/队列需 teardown（router 构造后零状态保持）。
- **平行机制**：未发现第二套 cleanup worker、重试循环、任务状态、日志格式或 API wrapper；发射 helper 为包内私有函数而非新框架。

### 文件范围

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW LIST 6 项（create-namespace.ts / rest.ts / index.ts / 包 AGENTS.md / README.md / 设计自身） | 每项均对应正文条款（§7.1/§7.3/§7.4/§7.7/§7.8/§1 目标 4）；无无理由扩张 | — |
| DENY LIST（test/** 9 文件、namespace-registry/**、package.json、docs/adr/**、vfsl/persistence/instance、4xx/422/limits 实现、CONTEXT.md、docs/protocols） | 与包 AGENTS.md「frozen acceptance contract」纪律、SA6 §15 修订轮纪律、ADR 治理边界逐项吻合；正文无一处与 DENY 冲突（T5 保持 rejection 即是遵守「4xx 归 #268」DENY 的体现） | — |
| follow-up（abort 判别子 / `rejected` 发射 / message 字段 / ADR 接受流程） | 均为真实后续票义务，未掩盖本票必要项 | — |
| AGENTS.md/README 文档同步精度 | 包 AGENTS.md 除 deferral 句外还有「this version emits no events」「Unmapped outcomes … never invents HTTP error mappings」两处将因本票失效的表述；README L21 同理——ALLOW 行仅点名 deferral 清单 / Public API / Deferred scope 段 | MINOR（§14-OBS-2）：建议 ALLOW 行补注「同步修订两文件中因本票失效的全部既有表述」，防字面化实施留下自相矛盾的包契约文档 |

### observer 契约专项判定（dispatch 点名）

- **类型面**：`RestMetricsEvent` 键集 ⊆ `{operation, outcome, code?, status?}`、`RestDiagnosticEvent` 三类 kind + `cause: unknown` + 可选 owner/operation/phase/committed/namespaceId——与 H-M/H-D 及 D2/D4/D5/D6 白名单/词表/哨兵扫描逐键一致；`operation` 恒 `'namespace-create'` 满足 D6 `operations.size === 1`。
- **发射矩阵**：非 2xx 的 metrics `code` = body 稳定 code（B1–B8 逐例锁定）；abort 无 code 无 status（无 Response 存在，code=body 不变量无法诚实满足——正确处理）；成功省略 code（SA6 §15 留白面的设计裁决，基数最小）；T1 `unavailable`、其余 5xx `failed`、成功 `succeeded`（D6 计数 1/1/5/1 吻合）。
- **diagnostic 字段诚实性**：仅 `lease-release-failure` 携带 namespaceId（DTO 副本）；fatal/unknown 不携带（`NamespaceRegistryFatalError` 判别面无 namespaceId，无从诚实获知——不编造即诚实，与 L190「错误本身已知的 namespaceId」匹配）；cause 恒对象引用（D5 引用相等断言）；绝不携带 schema/root/完整 issues（D6 哨兵扫描）。
- **注入门与隔离**：D1 门保持；全调用点 helper 化使「全分支隔离」成为结构性保证。
- **兼容性实测**：#267 冻结 observer 全部零参（实测），类型收窄不破坏编译；seam-wiring 测试不锁导出集合。

**判定：通过。**

## 12. 验收设计审查（专项四：required ADR updates；§10 架构一致性之余项并入）

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1 四分支映射 + committed 语义 | B1–B4/B7（真实 shutdown / 真实 `DocCreateOperationalError` / 真实 fatal 二分 / 注入 unknown）；B4 正向 + B2/B3 同断言点反向排除；M1/M2 双向变异 | 无——断言观察 HTTP 状态/形状/值与 observer 实参，非源码文本 | — |
| AC2 内部违例安全 500 + diagnostic | B5/B6 + D5(c)(d)：issue message 哨兵不入任何 client 面、cause 引用相等 | 无 | — |
| AC3 取消边界 | C1/C2/C5（零触达 `invocations===[]`、有界 race、aborted 非 413）+ C3/C4（gate promise 时序锚 + release 计数） | 无——时序锚为 pull/release 计数而非 sleep | — |
| AC4 注入门/低基数/三类 diagnostic | D1（TypeError 门）/D2/D6（键白名单 + 词表 + operation 常量 + 哨兵 + `ns-` 扫描）/D4/D5 | 无 | — |
| AC5 observer throw 隔离 | D3 四分支（201/503/500/201）× 双 observer 同 throw | 无 | — |
| AC6 覆盖面 | 29 用例 + 支撑 9 + #267 冻结（legacy 35，运行时计数经循环生成用例吻合）+ M0 对照 | 无 | — |
| 红灯真实性 / 绿灯可达性 | SA6 §13.1（3/3 逐位一致）+ §13.2（临时模拟件 64/64）+ 13 组变异全捕获；SA8 复审独立复跑红灯基线一致 | 无——红→绿唯一变量 = 目标语义存在 | — |
| 测试入口真实性 | `vitest run --typecheck packages/namespace-api/test`（包 AGENTS.md 既有验证命令）；`vitest list` 发现性已证 | 无 | — |
| 回归（#267 冻结 35 + 类型面 0 error） | legacy 两基线均绿；`--typecheck` + 两 tsc 入口 | 无——类型收窄兼容性本次实测确认 | — |

### required ADR updates 专项判定（dispatch 点名）

- **锚定有效性（实测）**：`git hash-object docs/adr/0015-…` = `64daa16a43ef2718f7f8d692f77a82ac7517e341`、sha256 = `3a75f99b85c6bbba54086359bc71df52d94aaecb3f44d5212d0f98421082d148`——与设计文档头、SA6 §3.1 逐字一致，ADR 文本未被移动。
- **不修改 ADR 的正当性**：ADR-0015 状态流转属父 PR #158 治理；`docs/adr/**` 入 DENY 与 SA8 两轮 clear 裁决及 `docs/AGENTS.md` 纪律一致。R1/H-A/R3 是对欠规格面的填补而非对正文的改写，SA8 设计后复审已逐条裁决为「计划内纯加法或诚实填补、无冲突」。
- **修订触发器**：「0015 接受前被修订 → 设计+契约重过 SA8 门禁 + 修订轮」——有效且必要。
- **唯一残余（MINOR）**：SA8 OBS-R1-1 要求 0015 正式接受时把 R1（fatal committed:false → INTERNAL_ERROR）、H-A（abort rejection 结算）、R3（abort 优先于 413）折入 ADR 正文或修订节；设计 §13 残余 3 仅写「ADR-0015 正式接受的治理流程（父 PR #158）」未点名该内容义务。建议补记（§14-OBS-3），避免票据关闭后义务只剩 SA8 报告孤本。

## 13. Required revisions

无 BLOCKER / MAJOR finding。阻断修订清单为空。

## 14. Non-blocking observations

| ID | 观察 | 建议 |
|---|---|---|
| OBS-1 | §7.4.2 概括句「恰一个 metrics 事件/orchestration」与 §8 路线表「恰一事件/orchestration」对 T5 与 body/形状/派生族 unmapped rejections 不成立（过渡期零事件，直至 #268 接管 4xx/422 族及其 `rejected` 发射策略）。T 表与 §7.4.2 枚举本身精确，仅概括句过宽；冻结契约不要求该族发射 | 实施时不必改语义；若设计文档再有修订轮，将概括句改写为「每个 #269 拥有的终局路径恰一事件；unmapped 族（T5/body）与 403/405/未匹配零事件（过渡期）」 |
| OBS-2 | 包 `AGENTS.md` 的 Boundaries 节有两处将因本票失效的表述（「this version emits no events」「Unmapped outcomes … never invents HTTP error mappings」），README L21「未映射结局一律以 handle rejection 结算」同理；ALLOW 行仅点名 deferral 清单 / Public API / Deferred scope 段，字面化实施可能留下自相矛盾的包契约文档 | 实施时同步修订上述失效表述（本属 §1 目标 4「文档同步」的应有之义）；SA7 标准审查可将「包契约文档与实现零矛盾」作为检查点 |
| OBS-3 | SA8 OBS-R1-1 的内容义务（0015 接受时把 R1/H-A/R3 折入 ADR 文本或修订节）未在 §13 残余清单点名，仅泛写「治理流程」 | 在残余清单补记该义务的具体内容与去向（父 PR #158 或后续 ADR 修订节），使义务不依赖 SA8 报告孤本传递 |
| OBS-4 | malformed JSON × abort 同现时 `json()` rejection 先胜则原样传播（#268 族、零事件），结局归类与 aborted 不同但 Registry 零触达均成立；§7.6 不变量（「任何读取期结局发射前必须再核对 signal.aborted」）已在 seam 层约束 #268 的 400/413 发射 | 无需改设计；建议 #268 派发面传递该不变量时一并点名 malformed-JSON 分支（与 SA8 OBS-R3-1 同向） |

---

## 附：评审方法与证据边界

- SA2 未修改任何生产代码、测试、设计文档；未运行测试/服务/临时进程；全部源码行号、哈希、测试断言均为静态读取实测（工具：read/grep/sha256sum/git hash-object）。
- 测试计数口径：#267 legacy 35 用例为运行时计数（role-gate 文件含 `for…of` 循环生成用例，实测 L117/L135/L153），静态 `it(` 行数（26）与之不矛盾；SA6/SA8 记录的 vitest 基线（64 用例）为权威。
- 本评审不替代 SA4（实现审查）与 SA7（活链路验证）；`approve` 仅表示设计足以安全进入实施。

*本报告为 SA2 唯一产物。*

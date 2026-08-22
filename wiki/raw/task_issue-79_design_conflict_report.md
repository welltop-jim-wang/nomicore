# 冲突门禁报告 — task_issue-79（Phase 2 设计后冲突复审）

- 被审对象：`wiki/raw/task_issue-79_design.md`（SA1 设计 R0，2026-08-22）
- 冲突基准：`docs/adr/` 全集 7 份（0001–0007）+ 根目录 `CONTEXT.md`。本复审按技能约定**不重复前置门禁全量盘点**：0001–0005 维持前置判读（与本任务持久层范围无关联条款，且设计未越入其领地——见盘点表）；两份相关 ADR（0006/0007）与 CONTEXT.md **逐字全读复核**
- 前置裁决：`task_issue-79_conflict_report.md` — verdict `conflict`，0 hard-violation、1 evolution（冲突点 #1：DocHandle 接口扩展 `getStatus()` + ADR 0006 职责条款补充）。**总控已放行**（dispatch #4，dispatch 指令明示「冲突点 #1 evolution 已放行」）
- 复审焦点（dispatch 指定）：① 设计对 ADR 0006 演进的引用正确性；② §6 修订节草案体例；③ 是否引入新冲突
- 裁决人：SA8 Conflict Gatekeeper，2026-08-22

## Verdict

`clear`

- 裁决分布：**hard-violation = 0，override 需求 = 0，新 evolution = 0，no-conflict = 全部对照行**。
- 前置冲突点 #1（evolution）已放行，本设计是其合规落地：显式声明承载演进（设计输入基线节）、接口扩展为纯增量（§2.1）、ADR 修订以修订节草案落地（§6，体例核验通过，见下）。演进条目在本次复审中不再构成冲突。
- 判 `clear` 而非 `conflict`：冲突点表为空——无 hard-violation、无待裁演进、无未声明 override；唯一遗留的是一条**记录准确性备注**（R1，非阻塞，见结论），不属四级裁决中的任何冲突级。

## ADR 盘点（复审口径）

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本单一真相源 | accepted（含 2026-08-19 修订节） | 否 | 设计改动面（persistence contract/lifecycle、dsh-persistence 探针、测试、ADR 0006 修订节）不触及 schema 文本、信封内容、方言冻结；无冲突 |
| 0002 | 全新重写、authority 出范围 | accepted | 否 | 设计不引入任何 authority/不变式规则；无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 设计不触及 evaluate / ROOT 约定 / 联合表示；无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 设计不触及类型协议与投影机制；无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 设计不触及 SchemaSource / 生成器 / CI 新鲜度；无冲突 |
| 0006 | Cordis 持久化插件 | accepted（含 createDoc/owner 修订节 + supersede 裁决撤销节） | **是**（全读复核） | 设计全部引用与现行条款一致；演进落地合规（§2 纯增量扩展冻结契约面、§6 修订节草案）；调度纪律属边界判读而非违反（见新冲突扫描 #1）；无冲突 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge 分层 | accepted（全读复核） | **是** | 「轮到 mutation 时先检查 writable gate……成功后立即调用 saveDoc 标脏」与设计 §1.4 职责表互为具体化；「Persistence 仍只管理 Y.Doc 存储、cache、flush 与 retry」——`getStatus()` 定性为该范围内 flush/retry 管理状态的只读暴露（设计 §2.2 明文钉死），不引入 schema 语义、不实现 Runtime（设计明确「本任务只提供查询面」）；无冲突 |

无任何 ADR 处于 superseded-by-NNNN 状态。ADR 0006 内部两处早期条款（「创建 = 首个 saveDoc」、决策节旧接口代码块 `DocHandle.user`/二方法签名）已被修订节明文取代——**设计经逐处核验未引用任何被取代条款**：§2.1 与 §6 草案的接口块均以现行冻结契约（`owner`/`docId`/`doc`/`release` + createDoc 三方法）为基面，仅追加 `getStatus()`。

## 冲突点

（无——hard-violation 0、override 0、待裁 evolution 0。前置冲突点 #1 已放行并转为合规落地行，新引入决策点的扫描结论如下，均为 no-conflict。）

### 前置冲突点 #1（evolution）的二次核对结果 — 引用正确性 ✅

| 核对项 | 设计位置 | 核对结果 |
|---|---|---|
| 接口基面 | §2.1 `contract.ts` 改动 | ✅ 以现行冻结契约为基（`readonly owner: User` 注释逐字同 ADR 0006 修订节接口块），仅追加 `getStatus(): DocHandleStatus` 成员与 `DocHandleStatus` 类型导出；纯增量，不删不改既有成员 |
| 引文准确性 | §1.2/§1.3/§2.2/§3.3/§3.4/§7.1 | ✅ 逐条与 ADR 0006/0007 原文比对：「saveDoc = 脏状态通知……返回仅表示脏状态已登记」「失败事务保留在同一 live Y.Doc 中，由持久层内部 retry 持久化」「拒绝**后续** REST/WS 写入」「保留读/查询」「rename 成功即完成一次 flush」「单飞 flush + generation 保序」「不设外部 flush/cron 协调器」「持续高频写入最多 5s 必定尝试一次保存」「foreign handle、已释放 handle 的 saveDoc 都响亮拒绝」及 ADR 0007 两条 Runtime/Persistence 边界条款——**全部逐字命中原文，无改写、无断章** |
| 演进声明 | 输入基线节、§7.1 倒数第二行 | ✅ 显式声明「本设计显式承载该演进」，标注总控放行依据（dispatch #4）；符合「放行 + 记录」的处置要求 |
| 前置边界提醒落实 | §2.2 四态语义表、§6 修订节第 1 条 | ✅ 前置报告要求的「状态词与返回形状随 ADR 0006 修订节一并冻结措辞」已落实：四态语义 + 优先级（`disposed` > `released` > entry 状态）+ 瞬间性无承诺语义全部进入 §6 冻结条款；「状态查询 = flush/retry 管理状态的只读暴露」边界判读也写入修订节 |
| 代码事实引用（佐证） | §0/§3/§8 | ✅ 与 `packages/persistence/src/lifecycle.ts` 实况核对一致：L200 saveDoc degraded throw、L211 seedForTest degraded throw、L26/L128 聚合三态 getStatus（`'ready' \| 'persistence-degraded' \| 'disposed'`，无 `released`）、L34 entry 级 `degraded`、L444 flush finally 重排条件、L456 retry 退避上限 `Math.min(Math.max(delay*2,1), maxDirtyMs)`、L484-485 dispose 清 retryTimer——设计论证所依赖的事实全部属实 |

### §6 修订节草案体例核验 ✅

对照 ADR 0006 既有「createDoc 与 owner 语义修订」节（2026-08-21，issue #64）：

| 体例要素 | 既有先例（ADR 0006 L114-165） | §6 草案 | 结论 |
|---|---|---|---|
| 节标题 | `### createDoc 与 owner 语义修订（2026-08-21，issue #64；演进经 owner 裁决放行）` | `### DocHandle entry status 与 saveDoc 职责修订（2026-08-22，issue #79；演进经 owner 裁决放行）` | ✅ 同构（主题 + 日期 + issue 号 + 演进放行标注）；标题断言的准确性见结论 R1 |
| 开篇效力声明 | 「本节修订上方两处早期决策条款，取代关系如下；未提及的条款维持原文效力。」 | 「本节为**增量演进**……除下列明示条款外，未提及的条款（含『createDoc 与 owner 语义修订』节全部条款）维持原文效力。」 | ✅ 同款；且明确不侵蚀前修订节，增量/取代边界自陈清晰 |
| 结构 | 编号加粗条目（创建语义/接口契约/实施注记）+ 明示被取代条款 | 编号加粗条目（接口契约/saveDoc 职责/实施注记）+ 明示被修订条款（「saveDoc = 脏状态通知」与「save 失败按 doc 只读降级」的边界） | ✅ 同构 |
| 接口代码块 | 现行冻结契约全文 | 以现行冻结契约为基、仅追加 `getStatus()`，其余成员（含 `owner` 注释）逐字保留 | ✅ 无被取代条款回流 |
| 落点 | 既有修订节位于文末（「## 关联」之后） | 「追加于『supersede 裁决撤销』节之后」——该节（L161-165）即当前文末，追加点正确 | ✅ 同款文末追加 |

### 是否引入新冲突 — 逐项扫描（均 no-conflict）

| # | 设计新决策 | 涉及条款 | 判读 | 裁决 |
|---|---|---|---|---|
| 1 | **§3.4 降级窗口调度纪律**：retry 计时器在途时 `scheduleFlush` 不另武装 debounce/maxDirty（retry 退避即唯一调度源，上限 `maxDirtyMs`） | ADR 0006「持久层内部调度：不设外部 flush/cron 协调器。第一次 dirty 启动 max-dirty 计时器……每次 saveDoc 重置 debounce 计时器……持续高频写入最多 5s 必定尝试一次保存」+「retry 同属持久层内部，以退避策略重试直到成功或插件停止」 | 健康窗口调度纪律逐字维持；降级窗口由 retry 条款治理——ADR 两条款并存下，失败后立即按 500ms debounce 再试与退避纪律自相矛盾，「retry 即调度」是唯一自洽读法。硬性频次上界不降级：retry 于失败时刻 f 排定、延迟 ≤ maxDirtyMs，故任意 t ≥ f 的 saveDoc 必在 ≤5s 内见到一次 flush 尝试，「最多 5s 必定尝试一次保存」成立。无外部协调器引入（retry 仍属持久层内部）。且 §6 修订节第 2 条末款将此判读明文成文（「降级等待期内 retry 退避即该 entry 的唯一 flush 调度……『不设外部 flush/cron 协调器』不变」），随演进一并受裁决覆盖 | **no-conflict**（边界判读，已明文入修订节） |
| 2 | **§3.3 `seedForTest` 收窄**（degraded entry 上签发租约从 throw 改 resolve） | ADR 0006「失败后 namespace 进入 `persistence-degraded`，**保留读/查询**与已同步状态」 | `seedForTest` 是 `[TEST_FACTORY]` 测试 seam，不在 ADR 0006 接口契约面内，其行为不构成冲突基准；且语义依据与「保留读/查询」条款一致（读路径租约签发在降级期合法） | **no-conflict** |
| 3 | **§4 探针词表演进**（`write-rejected` → `save-degraded`）+ S4 哨兵重写 | 无——ADR 0006 仅在实施顺序提及「DSH 开发 profile + inspector 探针」，未冻结任何探针事件词表；`write-rejected` 锚定的是旧代码行为（前置已裁：代码偏离不构成冲突基准） | 探针是旧契约的观察者，契约翻转后观察面随动；探针事件词表非 ADR 冻结面 | **no-conflict** |
| 4 | **§2.2 状态优先级**（`disposed` > `released` > entry 状态）与「flush 在途 = ready」 | ADR 0006 冻结契约（演进放行范围内新增面） | 新增契约细节，落在已放行演进的接口扩展范围内，且按前置边界提醒随 §6 修订节冻结措辞 | **no-conflict** |
| 5 | **§7.1 末行：状态契约以平行套件覆盖（Memory/File 两文件），shared suite 化留给 SA6 后续** | ADR 0006 createDoc 修订节「两 Adapter 必须通过同一组 createDoc shared contract tests」 | 该条款限定于 **createDoc** shared contract tests；设计不触碰 `testing.ts`（DENY LIST），既有 createDoc shared suite 不受影响。状态契约是新增面，ADR 未对其施加 shared-suite 要求；设计如实标注差距与后续路径 | **no-conflict** |
| 6 | **§3.1 不可达分支 loud throw** | ADR 0006「响亮拒绝」纪律（foreign/released 条款同款精神） | 实现层选择，与既有拒绝面纪律同向（绝不静默降级）；无条款被违反 | **no-conflict** |
| 7 | **§2.2 Adapter 聚合 `getStatus` 保持三态不动** | 无（聚合状态面非 ADR 冻结条款） | 纯保持现状；AC2 仅以其反衬 entry 粒度 | **no-conflict** |
| 8 | **DENY：`CONTEXT.md` 不动** | CONTEXT.md 术语表 | `DocHandleStatus`/`save-degraded` 属接口细节与开发工具词表，非领域术语；CONTEXT 收录的是 VFSL/schema 领域词汇，判断成立 | **no-conflict** |

## 结论

**Verdict: `clear`——设计后复审通过，无停止原因、无需新的 override、无待裁演进。** 放行 SA2 全维度攻击评审。

- 前置冲突点 #1（evolution）二次核对通过：演进引用（接口基面、全部 ADR 引文、放行声明、前置边界提醒落实、代码事实）逐项属实；§6 修订节草案与 ADR 0006 既有修订节体例逐要素同构，落点（「supersede 裁决撤销」节之后 = 文末）正确。
- 新冲突扫描 8 项全部 no-conflict：最有实质的两项——§3.4 调度纪律与 §3.3 seedForTest——分别是「ADR 两并存条款的自洽读法（且 5s 尝试上界不降级）」与「非 ADR 契约面的测试 seam」；§4 探针词表、§2.2 优先级等均无 ADR 冻结面被违反。调度纪律判读已由 §6 修订节明文成文，随演进一并受裁决覆盖。
- **R1（记录准确性备注，非阻塞，转交总控/SA3）**：§6 草案节标题断言「演进经 owner 裁决放行」——本复审收到的 dispatch 指令为「冲突点 #1 evolution 已放行」，设计记录的放行依据是「总控 dispatch #4：循 `task_persistence-create-doc` 先例放行」。若该放行系总控循先例作出而非 Jim 本人直接裁决，SA3 落回 ADR 0006 前须补齐 owner 确认，或将标题标注措辞对齐实际放行依据（ADR 0006 既有修订节标题的「演进经 owner 裁决放行」对应的是 owner 直接裁决先例）。这是记录完整性问题，不构成冲突级别条目。
- 转交 SA2 的边界提醒（非裁决）：§3.4 的「三态互斥调度不变式」论证、§8.1 AC7 全 trace、§7.2 钉死值安全性（dsh n=0 `events=28`）属设计正确性维度，归 SA2 攻击评审；ADR 一致性维度本门禁已裁毕。

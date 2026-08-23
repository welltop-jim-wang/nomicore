# 冲突门禁报告（设计后复审）

- 被审对象：`wiki/raw/task_doc-runtime-atomic-root-replace_design.md`（SA1 设计，D1–D11 决策 + §9 协议假设依据 + §10 caller 审计 + §12 ALLOW/DENY LIST）
- 冲突基准：`docs/adr/0001`–`0008` 全集 + `CONTEXT.md`（自 Phase 0 前置门禁以来零变动，mtime 复核一致；Phase 0 已全量逐份读取，本次按技能做轻量复审，不重复全量盘点）
- 上游结论：Phase 0 前置门禁 verdict `clear`（`task_doc-runtime-atomic-root-replace_conflict_report.md`）
- 复审日期：2026-08-23（SA8）

## Verdict

`clear`

## ADR 盘点（轻量：仅设计与各 ADR 的实际触碰点）

| 编号 | 状态 | 设计触碰点 | 对照结论 |
|---|---|---|---|
| ADR-0001 | accepted | 无直接触碰（设计不涉 schema 文本/真相源；SCHEMA 键名仅在 SCHEMA write 前瞻引用） | no-conflict |
| ADR-0002 | accepted | 无触碰 | no-conflict |
| ADR-0003 | accepted | D5 顶层 identity（ROOT 固定物化 Y.Map / `doc.getMap('ROOT')`）；② 构造规则含 YXmlFragment 终态不透明语义（§9 RA 无关，设计沿用既有 carrier 语义） | no-conflict |
| ADR-0004 | accepted | 无触碰（编译期投影轨道，§12 DENY 明确零交集） | no-conflict |
| ADR-0005 | accepted | 无触碰 | no-conflict |
| ADR-0006 | accepted | D4 单事务语义锚「事务原子性由 Y.transact（单 update 单元）保证」；§12 DENY 持久层零触碰；SCHEMA/META 兄弟条目（③ 探针只碰 ROOT） | no-conflict |
| ADR-0007 | accepted（Runtime/open/read 条款被 ADR-0008 部分取代；**detached materialization / validated mutation / 零写入 / observer no-rollback 继续有效——本设计的全部行为面落在此区间**） | D1–D9（见下明细）；materializeRoot 公共契约零变化 | no-conflict（含一处已澄清的解读点，见 N1） |
| ADR-0008 | accepted（**本设计的行为授权来源**） | D1–D6 全部锚定其「必要的底层演进」第 3 条与 SCHEMA write 第 3/4 步条款 | no-conflict |
| CONTEXT.md | 现行 | ROOT / 零写入 / 逻辑快照校验 / 标记类型 / 路径纪律等术语用法 | no-conflict |

## 冲突点

（无——裁决分布：no-conflict × 全部；override-declared × 0；evolution × 0；hard-violation × 0）

逐条对照明细（设计决策 → 冲突基准条款 → 裁决）：

| # | 设计决策 | 对照基准条款 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | D1：`replaceRootContent` 经 index.ts 公共导出，同步结果联合；E202/E201 throw 为唯一例外 | ADR-0008「普通、可预期且零写入的读取或写入失败使用领域化结果联合」；ADR-0008 演进第 3 条（doc-runtime 契约演进：可复用 helper）；ADR-0007 失败边界 | no-conflict | 结果联合与 throw 例外面同向；公共导出见 N1 澄清 |
| 2 | D2：②⓪⑤⑥ 收敛为三包内 seam，逐字纯移动，不经 index.ts；materializeRoot 公共契约零变化 | ADR-0008「3. SCHEMA replacement 可复用 detached builder 与原子 ROOT-content replacement helper，不复制 materialization 逻辑」；ADR-0007「唯一公共物化入口……不覆盖、不合并、不 fallback」（materializeRoot 侧逐位保持） | no-conflict | 单源收敛即 ADR-0008 原文要求；创建路径契约未被触碰 |
| 3 | D3：替换路径 ③ 无「ROOT 空置」判定（非空/空/缺席 ROOT 均可） | ADR-0008「在同一 transaction 内清空并安装已 detached 构造的内容」；ADR-0007 空置判定条款属 materializeRoot 自身契约（未被修改） | no-conflict | 职责二分：创建路径仍强制空置；替换路径清空-安装由 ADR-0008 明文授权（Phase 0 已裁决同点） |
| 4 | D4：clear+install 恰一个 doc.transact；update 计数 = 变更集非空 ? 1 : 0 | ADR-0008「在一个 transaction 中原子替换 SCHEMA 与必要的 ROOT generation」「在同一 transaction 内清空并安装」；ADR-0006「事务原子性由 Y.transact（单 update 单元）保证」 | no-conflict | 空变更集 0 update 为 yjs 零操作事务自然语义，与「凡产生实际变更则单事务提交」不矛盾 |
| 5 | D5：原实例 clear 保持顶层 identity；旧子类型失效、无补偿 diff | ADR-0008「保留顶层 `doc.getMap('ROOT')` identity……其下旧 Yjs 子类型 identity 可失效」；ADR-0007「旧 Yjs 子类型引用失效，不做 identity-preserving diff」；CONTEXT.md ROOT | no-conflict | AC-4 的机制化兑现，逐字同向 |
| 6 | D6：`replaceRootContent` 最外层语境专用；嵌套 → 写入前 throw E202 零写入；SCHEMA write 同事务组合 = 未来组合 seam 自开事务消费 `buildTopEntries` | ADR-0008 SCHEMA write 第 4 步（同事务组合需求）；ADR-0007「验证或构造失败时目标 doc 零写入」+ 失败边界（observer no-rollback） | no-conflict | 组合需求由预留单源构造点满足、可满足性保持；E202 写入前拒绝 = 零写入纪律；不放开嵌套不违反任何条款（见 N2） |
| 7 | D6 边界声明：ADR-0008 演进第 2 条（committed-aware branded fatal contract）不在本任务建设 | ADR-0008「Runtime 实现前先完成以下 doc-runtime 契约演进」第 2 条（Runtime 前置项，非单票义务）；任务简报 AC-6 仅要求「服从」契约 | no-conflict | 分票推进不构成违反；登记为 open 前置项（N3，非阻塞） |
| 8 | D7/D8：E202 消息 `${api}` 插值（materializeRoot 侧渲染字节同一）；E201 沿用 generic 文案 | 无 ADR 消息级约束；既有 materializeRoot 契约面保持 | no-conflict | 消息措辞属实现细节，不触 ADR 条款 |
| 9 | D9：逻辑失败完整 issues 引用透传；构造/载体失败恰 1 issue fail-fast；独立 `ReplaceIssue` 类型 | ADR-0007「逻辑校验保留完整 issues，Yjs 结构与路径/操作错误 fail-fast」「底层能力各自保留领域化结果联合，不合并成巨型 issue 类型」；CONTEXT.md 逻辑快照校验（共用 validateLogicalSnapshot 入口） | no-conflict | 逐字同向 |
| 10 | §4.2 E200 崩溃边界：①②③ 意外异常（含深栈溢出）→ `{ok:false}` 单 issue + 零写入 | ADR-0007「零写入承诺覆盖所有验证失败和 detached 构造失败」 | no-conflict | 异常收编为构造失败面仍属零写入承诺；与 materializeRoot 既有同族边界一致 |
| 11 | §4.4：④⑤⑥ 在一切 try/catch 之外；observer 抛错原样传播、写入已提交不虚假回滚；⑤⑥ 偏离 throw E201 不补偿 | ADR-0007「事务开始后若未知 observer 抛错，视为 Runtime internal/fatal，不虚假声称自动回滚，也不尝试 fallback」；ADR-0008「不补偿、不 fallback、不声称 rollback」 | no-conflict | committed-aware no-rollback 契约（任务 AC-6）的直接服从面 |
| 12 | §4.2③：缺席 ROOT 经探针惰性创建空 map（零 update），与空 ROOT 同 happy path | CONTEXT.md ROOT（固定物化为 Y.Map、doc 根 getMap('ROOT')）；无 ADR 条款禁止惰性创建 | no-conflict | yjs 语义内行为，零写入纪律不受影响 |
| 13 | D10/D11：版本 bump 0.1.5→0.1.6；零新第三方依赖、DAG 无环 | ADR-0007「新包 `@nomicore/doc-runtime` 依赖 `@nomicore/vfsl` + `yjs`」（依赖边界不变） | no-conflict | 依赖面未扩大 |
| 14 | §12 ALLOW/DENY：改动收敛于 `packages/doc-runtime`；DENY 覆盖 `docs/adr/**`、vfsl/persistence 等全部其余包 | ADR-0007（vfsl 无 Yjs 依赖领地）；ADR-0006（持久层领地）；ADR-0001–0005 轨道零交集 | no-conflict | 领地纪律同向；无 ADR 修订需求（ADR-0008 已直接授权） |

补充核对（解读澄清，均裁决 no-conflict）：

- **N1「唯一公共物化入口」解读**：ADR-0007 称 materializeRoot 为「唯一公共物化入口」。设计新增第二个公共写入口 `replaceRootContent`。裁定不构成冲突：该条款刻画的是**创建路径物化**（空 ROOT、不覆盖不合并不 fallback）的唯一公共性——设计的 materializeRoot 契约逐位零变化；而替换入口由更晚接受的 ADR-0008「必要的底层演进」第 3 条以「doc-runtime 契约演进」名义明文授权（「可复用 detached builder 与原子 ROOT-content replacement helper」）。ADR 语料整体读法：后接受的 ADR 在重叠处生效，且 ADR-0008 只保持 ADR-0007 的**行为性**底层决策有效（detached materialization / 零写入 / no-rollback），设计对这四类决策全部服从。设计未声明也无需要 override，不属 evolution。
- **N2 嵌套禁令与 SCHEMA write 组合需求**：ADR-0008 要求「在一个 transaction 中原子替换 SCHEMA 与必要的 ROOT generation」。设计以「未来组合 seam 自开事务、消费 `buildTopEntries` 产物」满足（builder 收敛即预留的单源构造点），不在本接缝放开嵌套调用。ADR-0008 约束的是行为（同事务原子切换），不指定承载函数；可满足性保持，无冲突。前瞻注记：该未来组合票须继续「不复制 materialization 逻辑」——设计已将构造单源收敛于 detached-build，结构上支持。
- **N3 open 前置项（非阻塞登记）**：ADR-0008 演进第 1 条（schema-independent `readLogicalValueAtPath`）已在基线完成（设计 §3.1 公共面佐证）；第 2 条（committed-aware branded fatal contract）与第 3 条（本任务）为并列前置项。第 2 条明确不在本票范围——namespace-runtime 实现前仍需补齐，建议总控登记票项跟踪。同理，ADR-0007 规划的 `applyValidatedMutation`（validated mutation 公共入口）在基线上尚不存在，属后续票项；本设计未移除或改写任何其规划面，无冲突。

## 结论

**Verdict：`clear`——放行，可派 SA2 全维度攻击评审。**

- 冲突点数：0；裁决分布：no-conflict × 14 项设计决策对照 + 3 项解读澄清（N1–N3）；override-declared × 0；evolution × 0；hard-violation × 0。
- 设计的行为面完整落在 ADR-0007 继续有效条款（detached materialization / 零写入 / observer no-rollback / issues 纪律 / 路径纪律）与 ADR-0008 授权条款（演进第 3 条 + SCHEMA write 第 3/4 步语义）的交集内；materializeRoot 公共契约零变化。
- 无需 override 声明、无演进（evolution）条目上报 Jim 裁决。
- 给总控的非阻塞登记：N3（ADR-0008 演进第 2 条 branded fatal contract 为 namespace-runtime 前置项，尚无票承接）。
- 相关决议文档已同步追加设计决策点锚定（`task_doc-runtime-atomic-root-replace_relevant_decisions.md` 末节）。

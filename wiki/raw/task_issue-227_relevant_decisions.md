# 相关决议 (Relevant Decisions) — Issue #227 全链 SA 复用

> conflict-gate 轮产出（2026-09-06）。只摘录，不裁决；引用编号与原文，需要时按编号回查 ADR 全文。
> 冲突裁决本体见 `wiki/raw/task_issue-227_design_conflict_report.md`（verdict: clear）。

## 任务标识

- 任务：Issue #227 — 保证 strict replay 的读取租约与完整性判定（实施缺口修复）
- 简报：`wiki/raw/task_issue-227.md`（AC1–AC5）；设计：`wiki/raw/task_issue-227_design.md`（SA1 R1.1）
- Worktree：`/home/wangjian/nomicore-fix-issue-227`（branch `mabf/issue-227`，父链 PR #142 `docs/namespace-diagnostic-change-log`）
- 冲突基准：`docs/adr/` 全部 12 个文件（编号 0001–0010 + 两个 0012）+ 根 `CONTEXT.md`；本轮核心 = ADR-0011 / ADR-0014-LOG / 包与 app 的 AGENTS.md
- 编号消歧：`docs/adr/` 存在两个 0012——`0014-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`（本任务核心基准，下称 **ADR-0014-LOG**）与 `0012-instance-identity-and-websocket-plugin-ownership.md`（与本任务无关）。下游引用一律带文件名。

## 相关 ADR

### ADR-0011 Best-effort namespace 诊断变更日志（accepted；产品语义权威）

`docs/adr/0011-best-effort-namespace-diagnostic-change-log.md`

- 与本任务的关联点：**L97–105 诊断性重放成功五条件**是 AC3/AC4 收紧的规范源头。
- 核心条款（原文摘录）：
  1. L97–105「只有同时满足以下条件时，工具才可声明一次诊断性重放成功：1. 有可用 genesis；2. 所选 stream 的 committed records 按 emitter sequence 连续；3. **每个非-noop committed record 都携带可解码的 Yjs update**；4. 未观察到已知 gap、截断、损坏或不兼容 record version；5. 重放后的受控 identity 与请求目标一致。」（必要条件框架——收紧永不违约）
  2. L33–38 结局词表：`committed` / `rejected` / `fatal`（必须携带已知 `committed` 事实）/ `unknown`；L37「不由日志层重新分类」。
  3. L20–24 best-effort 隔离红线（emit/排队/持久化/背压/丢弃失败不得改变业务结果；non-throwing emitter seam）——本票纯读路径，无涉但为边界。
  4. L91–93「只有同时满足以下条件…才可声明诊断性重放成功」同源；committed update bytes 是重放权威 effect。
- 对本任务影响：fatal-committed-true-unknown（及 effect 缺席）记录无法证明条件 3 在场 ⇒ 不允许 complete——设计 §4 分类收紧方向与 ADR 同向；complete 门表达式冻结（INV-227-7）。

### ADR-0014-LOG VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式（accepted；含 2026-08-28 first slice amendment）

`docs/adr/0014-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`

- 与本任务的关联点：**§Retention 与删除（L280–299）**是 AC1/AC2 租约接线的规范源头；**§Strict reader 与诊断性 replay（L301–318）**是 AC3/AC4 的规范源头。
- 核心条款（原文摘录）：
  1. **L289**「retention只删除已关闭且没有reader lease的segment group，绝不删除当前open group。删除协议以JSONL为group提交标记」——统辖全部 retention 删除面（含 L295 orphan BIN 步骤）；P0 卫生遍历的「无条件」指不受年龄/字节限制约束，非租约豁免。
  2. **L291–295** 删除协议 S1（jsonl 原子 rename `.deleting`）/S2（删 bin）/S3（删 marker）/启动续走/orphan BIN 清理。
  3. **L297**「reader通过`openReadSession()`获得短期segment lease，retention只删除无lease group；长期reader必须有最大lease时长**或**显式续租」——G1/G2 缺口的规范依据；G-227-4 缺省 `maxLifetimeMs=null`（显式续租臂）有明文授权。
  4. **L301–305**「默认strict reader对每条record执行JSON parse、VFSL validation及storage/frame交叉校验…replay强制strict」「未知VFSL dialect…不得近似解释、跳过未知记录后继续声称连续」——联合外/不可证形状 fail-closed 的纪律来源。
  5. **L307–316** replay 报告形状冻结 `{status:'complete'|'partial'|'failed', lastAppliedSequence, issues, snapshot?}`——设计零变更（INV-227-7 保持 complete 门 `issues===[] ∧ applied>0 ∧ readStatusOk ∧ !historyTrimmed`）。
  6. **L318**「只有存在有效genesis、records连续、所有必要updates可解码且校验通过、无已知gap/截断/损坏/不兼容，并且重放后受控identity匹配时才能返回complete。retention裁剪、update omitted、缺genesis或generation断裂只能返回partial/failed」——必要条件框架 + 非穷举的 partial/failed 成因列举。
  7. **L69–89** result 严格判别联合（六形状）：committed+noop / committed+update / committed+update-omitted / rejected / fatal+committed:false / **fatal+committed:true，effect 为 `update | update-omitted | unknown`**；L89「rejected 与 fatal committed:false 禁止携带 update」。（注：L87 枚举是 writer 侧规范联合；VFSL 机器面无法锁死 committed:true ⇒ effect 存在——schema.ts `AttemptResult` 第 5 成员无 effect，effect 缺席形状盘面可达、落在 ADR 枚举之外，消费侧须 fail-closed。）
  8. **L240/L272–278** BIN-first 崩溃窗口（完整 orphan frame/不完整尾/不完整 JSONL 尾行均合 best-effort）与尾部恢复边界——`segment-vanished` 豁免矩阵（bin 在 ∧ marker 不在 → 零行零 issue）的保留依据。
  9. **L218**「File adapter沿用单进程独占根目录的部署约束，不实现跨进程锁」——INV-9 进程内注册表的部署依赖。
  10. **L214**「append 前 VFSL validation failure 是日志 writer bug：丢弃 record…不改变业务结果」——本票零写路径涉及。
  11. **L196–212** VFSL record schema 单源 + manifest 内嵌信封；改 schema 即版本变更（id 升 `@2`、新 generation、旧 stream 只读）——本票 DENY `schema.ts` 的依据（修消费侧而非 schema）。
- 对本任务影响：全部五缺口（G1–G5）均为该 ADR 已决条款的实施缺口；设计不新增/修订任何 ADR 条款（零 amendment 需求——收紧经消费侧分类发生，报告形状与 complete 门冻结）。

### 包契约 `packages/namespace-diagnostic-log/AGENTS.md`（非 ADR，但为模块权威）

- schema 指纹冻结（`schema-freeze.test.ts` 钉死；改任何字符 = 版本变更）——DENY 面。
- 「新增 update-omitted reason 属词表演进，须过设计评审并同步 CONTEXT.md」——INV-227-10 零新增 reason；新码 `update-unknown` 属 replay 工具域（app 侧），非包 reason 词表。
- 环境绑定面：`node:fs` 仅 file.ts 与 reader.ts；read-session.ts/retention.ts 纯 TS——§3.1 增量维持。
- INV-9（进程内注册表）/ INV-12（namespace 删除压过租约——`releaseNamespaceLeasePartition` 不动）/ INV-13（`.deleting` 文法不可达——新检测沿用 statSync 直查，不新增枚举）。
- 健康事件白名单（#154 `retention-swept` 计数类成员等）——N-3 备案：形状/白名单零变更，仅频率语义。
- 「契约测试 SA6 owned——改实现不改测试断言」——SA7 重点 4 pin 改写须经 SA6 同 change 落地（R-5）。

### 应用契约 `apps/yjs-server/AGENTS.md`

- 「Consume only package public exports」——§4.3 删 app 侧 result 联合推导、以包公共 `materializeStrictRecordUpdate` 为单源，强化该边界。
- replay 工具自身头契约（diagnostic-replay.ts:4–17）：纯同步、绝不抛、五条件 complete、owned snapshot——N-B（readSession 选项不可抛保持）与 N-C（头注释措辞同步）的守卫对象。

### 根 `CONTEXT.md` 词条

- 「namespace 诊断变更日志」：连续 committed updates 可用于诊断性重放，不承诺完整性——收紧后措辞仍准确，无需改词条本体；#227 增量段随 SA3 落地（ALLOW 已列）。
- 「语义 emission」：update-omitted reason 三值受控词表——零触碰。

## 与设计决策的映射（速查）

| 设计决策 | 权威来源 | 冲突裁决 |
|---|---|---|
| D1 reader 自租约/传入 session、快照驱动枚举 | ADR-0014-LOG L297 | clear |
| D2 S0′ 提交点复查 `deleteGroupIfUnleased` | L289（结构化而非调度依赖） | clear |
| D3 P0 orphan-BIN 租约门 | L289 统辖 L295（解释性裁定） | clear |
| D4 `StrictRecordUpdate` 加 `unknown` 第五成员 | 非 ADR 冻结面；包纪律经 §5 评审 + 文档同步 | clear |
| D5 replay 分类单源化（`unknown` → issue + break） | ADR-0011 L97–105 条件 3 / ADR-0014-LOG L318 | clear（收紧方向） |
| D6 replay 全程持约 try/finally | L297 | clear |
| D7 冻结常量 + `renewIfDue`（bounded 诚实失败） | L297 双臂 | clear |
| R-4 残差维持（fatal-committed:false+effect:'update' → none） | L89「fatal committed:false 禁止携带 update」 | clear |
| N-1/N-2/N-3 备案 | 非穷举成因列举 + 白名单纪律 | clear（已备案） |
| N-A（本轮新登记，见冲突报告 §4） | L87 枚举联合外形状的保守处置 | clear（建议补备案） |

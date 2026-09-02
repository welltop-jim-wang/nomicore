# Standards 终审（终轴一）— issue #132（Phase 5: enable replication identity and epoch management）

- **审查轴**：Standards（仓库惯例一致性 / 文档与测试要求 / 生命周期与防御式模式规则 / 可维护性）
- **审查 diff 范围**：`7425164..26cd94b`（基线 7425164 = 上游 issue #131 合并提交；HEAD = `26cd94b`）
- **提交序列**：`8113083`（feat 主体 + SA6 红灯两文件 + wiki 设计/决议/评审档案）→ `ec83429`（SA6 红灯锚 harness 修订）→ `c2b23ab`（SA7 动态用例 + SA4/SA7 报告）→ `c012235`（AC 核对清单）→ `26cd94b`（dispatch log 终审派遣记录，wiki 1 行）
- **Worktree**：`/home/wangjian/nomicore-fix-issue-132`（分支 `fix/issue-132-on-docs-phase-5-websocket-replication`）
- **审查日期**：2026-08-27
- **审查人**：Standards 终审 reviewer（独立终审；已通读 SA4 静态验尸报告但全部结论独立复核，未照抄）

## 只读验证结果（本 reviewer 亲跑，独立进程）

| 验证 | 命令 | 结果 |
|---|---|---|
| 包 typecheck | `pnpm typecheck`（根，9 包 tsc 链） | ✅ exit 0 |
| 复制面五文件定点 | `npx vitest run --typecheck`（red 14 + surface 6 + channels 14 + runtime-replication-write 9 + sa7-dynamic 4） | ✅ 5 文件 / 47 用例全绿，Type Errors: no errors |
| diff 文件清单 | `git diff --name-only 7425164..HEAD` | 38 文件：生产 11 + 包版本 2 + 测试 14 + wiki 11；零越界（对照设计 §7 ALLOW/DENY LIST 与 R3 版本 bump 注记） |
| DENY LIST 零命中 | 同上核对 `persistence/**`、`doc-runtime/**`、`vfsl*`、`internal.ts`、`sequencer.ts`、`close.ts`、`projection.ts`、registry `testing.ts/plugin.ts/observer.ts/identity.ts/create-document.ts/errors.ts`、`apps/**`、`docs/**`、`CONTEXT.md`、`pnpm-lock.yaml` | ✅ 全部零改动 |
| 新测试源码 grep 断言扫描 | 对 4 个新测试文件 grep `readFileSync`/源码文本断言模式 | ✅ 零命中（全行为锚定） |
| proto-key 扫描 | 新生产代码 grep 动态 plain-object 键写入 | ✅ 零命中（仅固定字面量键写 Y.Map） |

## 合规确认（无违规项，择要记录，附证据）

### A. 仓库惯例一致性

1. **文件头注释规范**：新模块 `replication-write.ts:1-33`、三个新测试文件头部均带完整模块头（职责、槽序、不变量、边界声明），沿既有 `write.ts`/`schema-write.ts` 风格。修改文件的头部同步更新（`runtime.ts:1-35` 十键→十二键叙述、`status.ts:1-24` 七键→八键、`lease.ts:1-19` 增 #132 段）。
2. **中英双语 commit message**：五条提交均合规。主提交 `8113083` 标题英文 + 正文中英双语分段——与 #131 主提交（`7425164` 内 feat 提交同款英文标题 + 双语正文）先例一致；后续四条（`ec83429`/`c2b23ab`/`c012235`/`26cd94b`）标题均 `英文 / 中文` 双语。
3. **稳定错误码/消息词汇纪律**（对照 `errors.ts` 既有模式）：
   - `NSRT-FATAL-REPLICATION-WRITE-INTERNAL`（`errors.ts:38-44`）append-only 增列，code+message 成对、恒定文案、不插值原始异常（INV-N7），与 ROOT/SCHEMA 两写槽码同构；`write.ts:70` `WriteSlot` 词表扩 `'replication'`，缺省 `'root'` 渲染逐字节不变（`runtime-write-fatal-message-rev1.test.ts` 子串锚保持绿）；`writeFatalMessage`（`write.ts:238-244`）三名词参数化。
   - `NSRT-REPLICATION-META-CORRUPT`（`errors.ts:147-169`）：类模块级导出但 **index 不 re-export**（`index.ts:24` 值导出仍恰 `RuntimeWriteFatalError` 一键——本 reviewer 核对 `grep ^export` 输出），code+message 字符串消费，沿 `MetaProjectionError` 先例；message 含违约类别与观测 typeof（`describeOf`，`replication-write.ts:146-150`），零值回显。
   - 结果面四码（`REPLICATION_EPOCH_OVERFLOW`/`REPLICATION_NOT_ENABLED`/`REPLICATION_INPUT_INVALID`/`REPLICATION_META_ABSENT`，`errors.ts:171-179`）message 恒含码前缀、恒带「本调用零写入」处置说明、零值回显；registry 侧 `REPLICATION_RANDOM_SOURCE_INVALID_MESSAGE` 入 `types.ts:80-81` 稳定 message 单点表（邻 `NAMESPACE_REGISTRY_RANDOM_REQUIRED_MESSAGE`）。
   - `RuntimeWriteFatalPhase` 零新增（复用 `write-slot-internal`/`unknown-pipeline-throw`/`notify-dirty-failed` 三相位，`errors.ts:185-193`）。
4. **package.json 版本 bump（硬门禁 #9）**：`namespace-runtime` 0.1.7→0.1.8、`namespace-registry` 0.1.4→0.1.5，均仅 `version` 一行、patch 位；先例链完整（`7425164` 0.1.3→0.1.4、`6472485`、`5db6f83`）；设计 §7 已按 SA4 L1 以 R3 惯例注记收口（`task_phase5-replication-identity-epoch_design.md:723-731`）。`pnpm-lock.yaml` 零改动。

### B. 文档与测试要求

5. **新公共 API 文档**：runtime 接口两新键（`runtime.ts:138-153` JSDoc 含幂等语义、拒绝通道、fatal 通道、接纳门）、Lease 两方法（`types.ts:329-341`）、`readReplicationFacts`（`replication-write.ts:97-115` 四出口契约）、全部新类型（`replication-write.ts:54-95`、`types.ts:136-144/290-298`）均有 JSDoc；registry/runtime 两 `index.ts` 头部更新公共面叙述。
6. **测试锚定可观察行为**：47 条复制面用例全部锚定可观察事实——META `has()/get()` 状态、saveDoc 计数与通知时刻快照次序（`[1,2,3]` FIFO）、status 投影值、rejection 通道（`instanceof RuntimeWriteFatalError` + phase/committed）、磁盘 committed 字节直读（sa7-dynamic）；**零源码 grep 断言**（本 reviewer 独立 grep 复核，与 SA4 §1.7 结论一致）。类型面锚（`registry-phase5-replication-surface.test-d.ts`）锁 Lease 方法存在性、status 复制域两态联合、无通用 META 写面、无原始引用逃逸。
7. **wiki/raw 档案完整性**：任务简报 / relevant_decisions / design（R3，818 行）/ design_conflict_report / sa2_review / sa6_red / conflict_report / dispatch / sa4_review / sa7_report / ac_checklist 共 11 件齐备；dispatch log 16 行完整记录 SA8→SA6→SA1→SA2→SA3→SA4→SA7→AC→双轴终审链；AC checklist 6/6 ✅ 逐条附证据。

### C. 生命周期/防御式模式规则（对照 ADR 0006/0008/0009/0010 与设计 §5 不变量）

8. **close/fatal 纪律**：复制槽与 close barrier 共享同一 `WriteSequencer`（`runtime.ts:311/318` vs close `runtime.ts:329+`），已接纳任务无条件排空（ADR 0008），red AC-6 close 竞态与 SA7 真实计时器用例实测通过；E1 fatal gate 零输入访问（`replication-write.ts:161-163/285-287`）；E6 notify-dirty 失败 → `markWriteFatal` 先行 + `RuntimeWriteFatalError('notify-dirty-failed', committed:true)` rejection，E5.5 已更新事实**不回滚**（诚实 committed，ADR 0008「不补偿、不 fallback、不声称 rollback」）；fatal 后读取保留、后续写 `RUNTIME_WRITE_DISABLED`（runtime-replication-write.test.ts:214-246 实测）。
9. **冻结/深拷贝投影纪律**：`readReplicationFacts` 三出口均返回 `Object.freeze` 新对象（`replication-write.ts:117/126/142`）；`state.replication` 仅构造栈与槽 E5.5 两写入点（`p0.ts:56-59` 注释立法）；`buildStatus` 每次调用 `Object.freeze({...state.replication})` 全新深冻结子对象（`status.ts:77`）；lease getStatus 外层再冻结（`lease.ts:141-143`）；red AC-5 突变探针用例实测不逃逸。
10. **proto-key 安全**：新代码零动态 plain-object 键写入——META 写入只用固定字面量键 `meta.set('replicationId'|'replicationEpoch', …)`；`drawReplicationId` 只产字符串。投影层 `projection.ts` 未动（既有 `putPlainKey` 纪律原样覆盖新键）。
11. **敌意输入处理**：E3 单读捕获（`replication-write.ts:193-215`，恰一次属性读 + `Object.keys` 探测全 try/catch）——Proxy get trap 双读分叉/ownKeys/getter trap throw 全部收编为 `REPLICATION_INPUT_INVALID` 结果联合结算，绝不裸 reject、绝不升格 fatal（防「一次敌意 value → 永久禁写」DoS）；runtime-replication-write.test.ts (a)/(b)/(b2)/(c) 四型实测（含 `reads===1` 与 rejection 通道为空断言）。`drawReplicationId`（`registry.ts:585-617`）对 randomBytes throw/非 16 字节/编码违约三型收编为结果面 issue，永不 throw。
12. **loud failure 而非静默降级**（ADR 0006 `META.docId` 同族立法）：损坏 META 四族（恰一键存在 / 键存在而值显式 undefined / 格式违约 / 载体异型）一律 loud——构造期 V2.5 构造 throw（`runtime.ts:203-208`，零副作用 INV-N4）→ Registry `runtime-construction` fatal rejection + observer 事件；槽内 E4 → internal fatal committed:false（`replication-write.ts:220-226/311-315`）。`disabled` 仅限两键真缺席或载体缺席（事实性真命题，非降级）。META 载体缺席时 enable **拒绝**而非凭空造载体（`replication-write.ts:235-239`，防产生无 docId 的 META 真实损坏）。notifyDirty 未绑定 → loud gate 拒绝（杜绝「提交成功但永无 dirty 登记」静默失信）。
13. **溢出与单调**：`epoch >= Number.MAX_SAFE_INTEGER` 判据先于任何 +1 运算（`replication-write.ts:321-329`），MAX+1 永不被计算/存储，零回绕面（ADR 0010「拒绝提升不回绕」）；MAX-1 边界用例实测（red AC-4）。
14. **注入纪律**：随机源唯一注入点 = Registry 构造（`randomBytes`，#131 交付），`drawReplicationId` 复用同一受控源；核心零全局 crypto（ADR 0009 修订节 3）；`/internal` 工厂 2 参签名零改动。

### D. SA4 报告交叉复核（独立结论）

15. SA4 发现 L1（版本 bump 超 ALLOW）→ 已由设计 R3 注记收口，本轴确认闭环；L2（channels 用例标签措辞）→ 本轴独立确认属实，转入下方 J-2；L3（registry-surface 零改动）→ 本轴核实该文件无 `NamespaceRuntime`/`NamespaceRuntimeStatus` 显式定型 fake（`grep` 仅命中注释与运行时探测），符合设计 §4.10 判定标准，非偏离；L4（载体异型可选用例）→ SA7 已补（sa7-dynamic 重点 5，含 yjs 去特化实证 INFO S7-2）。SA4 的 D-1..D-12 对位表与本轴抽样复核一致；本轴对 SA4 verdict: pass 无异议。

## 发现清单

### Hard violations

**无。**

### Judgement calls（非阻断）

**J-1｜两包 README 的写面叙述滞后于新公共复制管理写（文档完整性滞后，非客观矛盾）**

- 证据：
  - `packages/namespace-runtime/README.md:3`「exposes synchronous reads plus serialized ROOT/SCHEMA writes」与 `:17-22`「### Writes」节仅列 `mutateRoot`/`replaceSchema` 两子弹、`:21` 的 FIFO 共享枚举（"P0, ROOT writes, SCHEMA writes, and the close barrier"）未含复制槽——本 diff 新增的两个公共写方法（`enableReplication`/`bumpReplicationEpoch`，runtime.ts:138-153）在包主文档零提及。
  - `packages/namespace-registry/README.md:13`「A lease is the caller capability for reads and controlled ROOT/SCHEMA writes」同款遗漏（Lease 两新方法见 types.ts:329-341）。
  - `packages/namespace-runtime/README.md:30-32`「Contract sources」仅引 CONTEXT.md + ADR 0008；复制谱系/epoch 行为的规范来源是 ADR 0010「复制谱系与 epoch」节。
- 判据：逐句核对两 README，**无任何句子被本 diff 证伪**（无 #131 H-2 式「与实现直接矛盾」；ADR 0008「v1 公开两个窄方法」是被 ADR 0010 扩展的历史决策记录，非 README 现行承诺）——按 #131 终审确立的判别线（客观矛盾 = 硬违规；精度/完整性滞后 = 非阻断，对照 #131 J-1 接口级 JSDoc 滞后先例），本条属消费者可发现性损失：第三方宿主仅读 README 不会发现 ADR 0010 的 Hub 复制管理面已落地。AC checklist 未声称 README 已对齐（无 #131 的不实声称情节）。建议修订轮顺带补：runtime README Writes 节增复制管理写一条 + Contract sources 引 ADR 0010；registry README :13 lease 能力句补复制管理写。修复量小，不阻断本轮。

**J-2｜channels 测试用例标签与实际种子形态不一致（SA4 L2 独立确认）**

- 证据：`registry-phase5-replication-channels.test.ts:295` 标签「仅 id 无 epoch（恰一键存在）」，但种子构造在 `:309-310` 对两键一律 `meta.set`（epoch 值为显式 `undefined`）——实际进入 `replication-write.ts:133-135`「键存在而值显式 undefined」分支，而非 `:127`「恰一键存在」分支。
- 判据：契约矩阵无缺口——「恰一键存在」分支在槽内 E4 面由 `runtime-replication-write.test.ts:220`（构造后仅 set replicationId）真实覆盖；构造期 V2 面的真·单键缺席种子无人覆盖，但两个消费方共享同一读取器单点，分支级动态覆盖已存在。仅标签措辞误导后续读者；建议修订轮改标签或改 `hasOwnProperty` 条件种子。不阻断。

**J-3｜enable/bump 两槽 E1/E2 门面逻辑逐字重复（约 25 行 ×2）**

- 证据：`replication-write.ts:160-184` vs `:284-307`（fatal gate、writable gate、notifier 绑定检查、disabled 文案均逐字重复）。
- 判据：与 `write.ts`/`schema-write.ts` 既有「每槽自携完整门序」的局部惯例一致（可读性优先于 DRY）；且两槽 E3/E4/E5 差异真实存在。属仓库既定风格内的可接受重复，仅记录备查。同样记录：registry/runtime 双份 `REPLICATION_ID_PATTERN`（`registry.ts:152` / `replication-write.ts:52`）与 `drawReplicationId` hex 编码 6 行重复——均为设计明文决策（跨包值导出会击穿恰一键冻结审计；失败通道不同故不共享实现），注释互相引用，合规。

**J-4｜dispatch log 终审行的 diff 范围记录滞后一位**

- 证据：`task_phase5-replication-identity-epoch_dispatch.md:23`（第 16 行）记「diff 7425164..c012235」，而 `26cd94b`（该行自身的入库提交）使 HEAD 前进一位。
- 判据：`c012235..26cd94b` 增量恰为 dispatch log 一行终审派遣记录，零代码面；本报告按任务指派范围 `7425164..26cd94b` 全量审查。簿记精度注记，无需动作。

## Conclusion: clear

无 hard violation。仓库惯例（文件头/双语 commit/稳定码注册/版本 bump 硬门禁 #9）、文档与测试要求（公共 API JSDoc、行为锚定测试零源码 grep、wiki 档案 11 件齐备）、生命周期与防御式模式（close/fatal 纪律、冻结投影、proto-key 安全、敌意输入收编、loud failure 拒绝虚假降级）全部符合仓库既有纪律与 ADR 0006/0008/0009/0010 及设计 §5 不变量。Judgement calls J-1..J-4 非阻断：J-1（两包 README 写面叙述补复制管理写）建议修订轮顺带处理；J-2 标签措辞、J-3 备查、J-4 簿记注记均无需动作。

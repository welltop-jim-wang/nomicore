# Spec 轴终审报告 — Phase 5: enable replication identity and epoch management（issue #132）

- **审查轴**: engineering/code-review 门禁 Spec 轴（最终发布前）
- **审查 diff 范围**: `7425164..26cd94b`（基线 7425164 = 上游 issue #131 合并提交；HEAD = 26cd94b）
- **审查对象**: 上述范围内 38 文件（生产 13 + 测试 14 + wiki 簿记 11），`git diff --name-only` 全量核对
- **规格基准**:
  1. Issue 规格 `TASK.md`（issue #132 全文，6 条 AC）
  2. 已接受设计 `wiki/raw/task_phase5-replication-identity-epoch_design.md`（R3，SA2 R2 pass + SA8 clear）
  3. AC 核对表 `wiki/raw/task_phase5-replication-identity-epoch_ac_checklist.md`（本报告独立复核其证据，未照抄）
  4. 规范源 ADR 0010「复制谱系与 epoch」节（docs/adr/0010:41-60/120）与 ADR 0008 写纪律
- **独立验证动作（本审查实跑，非转述）**:
  - `npx vitest run <phase-5 五测试文件> --typecheck` → **5 文件 47/47 绿、Type Errors 无**
  - `pnpm test` 全仓 → **126 文件 1478/1478 绿、Type Errors 无**（与 AC 核对表声明的 1478/1478 逐数字一致）

---

## 一、6 条 AC 逐条结论表

| AC# | Issue 条文 | 结论 | 实现位置（独立核实） | 测试证据（独立核实并实跑绿） |
|---|---|---|---|---|
| AC-1 | META reserves and projects replicationId and replicationEpoch with the formats frozen by ADR 0010 | ✅ 落地 | 格式冻结单点 `replication-write.ts:41`（`REPLICATION_ID_PATTERN=/^[0-9a-f]{32}$/`）+ epoch 判据 `Number.isSafeInteger(v)&&v>=1`（replication-write.ts `readReplicationFacts`）；事实读取以 `has()` 区分键存在/缺席，恰一键/显式 undefined/格式违约/载体异型 → `NSRT-REPLICATION-META-CORRUPT` loud（拒绝虚假降级）；投影面 `getMetadata` 经既有 `projectMetadata` 深拷贝自动携带两 plain 字段（未启用时键缺席）；status 第八键 `status.ts:49-52` | red.test.ts AC-1 两条（:273 格式+身份区分面、:307 未启用 disabled）；channels 测试损坏种子族 **恰 7 型**（:289-296）+ 两键真缺席反向守卫（:333）+ 双读者一致性（:345）；surface.test-d.ts 类型锚 2 条——与核对表声明逐字相符 |
| AC-2 | enableReplication atomically installs a random 128-bit lineage ID and epoch 1 through the namespace write sequencer and dirty notification | ✅ 落地 | Lease 接纳段同步抽取（lease.ts:154-163 → `deps.drawReplicationId`，registry.ts:585-618 注入式 CSPRNG、形状门禁、结构守卫、零重试环、核心零全局 crypto）；值输入传入 runtime 槽 `runEnableReplicationSlot`（replication-write.ts:166-251）：E5 **单 `doc.transact` 两键同事务**原子安装、E6 同槽 `await notifyDirty()`；与 mutateRoot/replaceSchema 共享同一 `WriteSequencer` 实例（runtime.ts:303-313 接纳层 `sequencer.enqueue`） | red.test.ts AC-2 两条：:322（通知时刻 META 已含两字段、saveDoc 恰一次）、:344（并发 [enable,bump,bump] 通知序恒 [1,2,3]、单一身份不漂移）——实跑绿 |
| AC-3 | Re-enabling an enabled namespace is idempotent or returns a stable documented result without changing identity | ✅ 落地（取幂等路径，设计 D-5 文档化稳定结果） | E4 读到 `enabled` → `return {ok:true}` 幂等：零事务、零 notifyDirty、身份/epoch 不变；调用方 id 弃用（replication-write.ts:219-224；设计 §4.2/§4.9-3 明文） | red.test.ts AC-3（:373）：二次 enable 身份不变 epoch 不重置；bump 到 2 后再 enable 仍 2——实跑绿 |
| AC-4 | bumpReplicationEpoch is Hub-only, sequenced, monotonic, rejects overflow, and preserves committed/fatal facts | ✅ 落地 | Hub-only 可锚定面 = 独占写面：META 两键唯一写入口为 Lease 两管理操作；普通写 zero-touch 为结构性事实（`applyValidatedMutation` 读写面钉死 ROOT 重建，`['META','replicationEpoch']` 路径经封闭校验领域拒绝零写入）；sequenced = 同一 FIFO sequencer；monotonic+overflow = E4 判据 `epoch >= MAX_SAFE_INTEGER` **先于任何 +1**，结果面 `REPLICATION_EPOCH_OVERFLOW` 拒升不回绕（replication-write.ts:287-291）；committed/fatal = E6 notify-dirty 失败 → `markWriteFatal('replication')` + `RuntimeWriteFatalError('notify-dirty-failed', committed:true)`，META 已提升不回滚、status.fatal 独立码 `NSRT-FATAL-REPLICATION-WRITE-INTERNAL`、后续写 `RUNTIME_WRITE_DISABLED`、读取保留 | red.test.ts AC-4 四条（:406 zero-touch+monotonic、:443 overflow、:460 MAX-1 边界、:479 fatal committed:true 事实保留）+ runtime-replication-write.test.ts 9 例（含 :214 槽内 E4 corrupt fatal committed:false、:248 fatal 后复制事实不回滚）——实跑绿 |
| AC-5 | Open and Runtime status can distinguish replication-disabled, enabled identity, and identity change without exposing mutable META references | ✅ 落地 | status 第八键 `replication: {state:'disabled'} \| {state:'enabled'; replicationId; replicationEpoch}` 两态联合（status.ts:49-52；registry 侧 `NamespaceLeaseReplicationStatus` 结构复制型 types.ts:138-145 与 `NamespaceRuntimeStatusProjection` 同步扩域，lease.ts Equal 断言编译期锁死）；identity change 判别面 = 两读值比较（无第三态——SA8 复审确认语义）；构造期 V2.5 纯读预投影（runtime.ts:203-211）使 status 从 t=0 诚实；`buildStatus` 每次调用 `Object.freeze({...state.replication})` 全新深冻结子对象（status.ts:77），getMetadata 深拷贝 | red.test.ts AC-5 两条（:533 判别链 disabled→enabled(id,1)→(id,2)、:554 新鲜对象+冻结/突变不逃逸探针）+ surface.test-d.ts 两条类型锚（含 Phase-1 回流修订后的 `LeaseActiveRuntime` 无分布判别，锚定语义不变）——实跑绿 |
| AC-6 | Tests cover concurrent enable/bump, persistence-degraded, close/fatal races, retry behavior, and Memory/File persistence recovery | ✅ 落地（覆盖矩阵 5/5） | —（测试义务本身） | 并发 enable/bump：red :344 FIFO [1,2,3]；persistence-degraded：red :662（gate 降级 → bump `RUNTIME_WRITE_DISABLED` 零写入 → 恢复 retry 覆盖 → bump 成功 → Memory 恢复可见）；close/fatal 竞态：red :637（enable 已接纳后 shutdown 排空 + 真实持久化恢复）+ AC-4 fatal :479 + SA7 动态 :180（真实计时器零 fake scheduler shutdown 排空）；retry：red :662 恢复段；Memory/File 恢复：red :637/:662（Memory 新实例）+ :717（FilePersistence 全链重启，issue #108 durable-snapshot-wait 模式）+ SA7 动态 :231（磁盘级 undefined META round-trip 拒绝 + :270 反向守卫）+ :313（live 异型载体 Y.Text META open 拒绝）——全部实跑绿 |

**AC 总结论**: 6/6 真正落地，每条均有实现位置 + 真实测试用例支撑；AC 核对表的证据声明经逐条独立复核**全部属实**（含「损坏种子族 7 型」「126 文件 1478/1478 绿」等可计数声明，均与实测一致）。

---

## 二、范围蔓延检查（对照设计 §7 ALLOW/DENY LIST）

- **ALLOW LIST 符合性**: 生产 11 文件 + 版本 bump 2 文件 + 键集锁/定型 fake 迁移测试 + SA3-owned 两新测试文件——逐一在 diff 中找到对应，行量级与设计估算相符。
- **DENY LIST 零触碰（`git diff --name-only 7425164..26cd94b` 全量核对）**: `packages/persistence/**`、`packages/doc-runtime/**`、`packages/vfsl*/**`、`internal.ts`、`sequencer.ts`、`close.ts`、`projection.ts`、`plain-data.ts`、`testing.ts`、`plugin.ts`、`observer.ts`、`identity.ts`、`create-document.ts`、registry `errors.ts`、`packages/clock/**`、`packages/dsh-persistence/**`、`apps/**`、`docs/adr/**`、`docs/phases/**`、`CONTEXT.md`、`docs/protocols/**` ——**全部零改动**。
- **无跨包生产消费者**（`apps/` 空壳）被牵连；registry 主入口运行时导出九值不变（registry-surface 审计绿）、runtime 值导出恰一键冻结（exports-audit 绿，禁止清单已按可选加固项追加三槽体名）。
- 两项 ALLOW LIST 之外的新增，均经流水线记录、非静默蔓延（详见发现清单 N-2/N-3）：SA7 动态测试文件（dispatch #13 登记）与 SA6-owned 两锚文件的 Phase-1 回流修订（sa6_red.md R1 + dispatch #10 登记）。

## 三、疑似错误行为核对（vs ADR 0010 / ADR 0008）

逐项核对实现语义，**未发现不符**：

1. **ADR 0010 格式冻结**: replicationId=128-bit 随机 32 位小写 hex、replicationEpoch 从 1 安全整数、达 `MAX_SAFE_INTEGER` 拒升不回绕——`REPLICATION_ID_PATTERN` + E4 判据先于 +1（MAX+1 永不计算/存储）✓。
2. **ADR 0010「hub 显式 enableReplication() 原子写入复制身份并登记 dirty；连接不得静默补写旧文档」**: 单槽单事务两键原子 + 同槽 notifyDirty 恰一次；旧文档（两键真缺席）open 正常且 status=disabled、零补写（channels 反向守卫 :333 实跑绿）✓。
3. **ADR 0010「META 两保留键只能由 hub 显式复制管理操作修改」**: 本票可锚定面 = 独占写面（普通写结构性 zero-touch + `['META','replicationEpoch']` 触达领域拒绝，red :433-440 实跑绿；类型面无通用 META 写，surface 保持性守卫绿）；peer 角色拒绝属后续切片（设计 §4.1 明文排除）✓。
4. **ADR 0008 槽序/排空纪律**: E1–E7 逐位镜像 ROOT 槽 S1–S7（fatal gate → writable+notifier gate → 输入校验 → 事实读取 → 单事务 → 同槽 await notifyDirty → 释放）；lifecycle 接纳门在公共方法层（D5.1 同款），槽内不设、已接纳任务无条件排空（red :637 shutdown 排空用例实跑绿）✓。
5. **ADR 0008 committed-fatal 纪律**: notify-dirty 失败 → `RuntimeWriteFatalError('notify-dirty-failed', committed:true)`、E5.5 已更新事实不回滚、fatal 只禁写读保留、fatal 摘要独立码不失真（`NSRT-FATAL-REPLICATION-WRITE-INTERNAL`，root/schema 渲染逐字节不变）✓；E5 未知异常保守 committed:true（unknown-pipeline-throw），INV-R5 例外窗口已登记 ✓。
6. **INV-R7 二通道纪律**: 一切拒绝经结果联合或 RuntimeWriteFatalError rejection 结算；敌意 Proxy trap throw 收编为 `REPLICATION_INPUT_INVALID` 结果面（绝不裸 reject 原始 TypeError、绝不升格 fatal——runtime 单测 (b)/(b2) 断言 rejection 通道为空，实跑绿）✓。
7. **注入纪律（ADR 0009 修订节 3）**: 随机源唯一注入点 = Registry 构造期已门禁的 `randomBytes`；Runtime 包零随机依赖、`/internal` 工厂 2 参签名不变；违约 = 结果面 `REPLICATION_RANDOM_SOURCE_INVALID`（不同步 throw）✓。

## 四、消费者文档一致性

公开面变化：Lease +两方法（enableReplication/bumpReplicationEpoch）、status 第八键（runtime `NamespaceRuntimeStatus` 与 registry 投影双侧同构）、类型导出（runtime type-only +5、registry type-only +3，值导出面双侧零新增）。

- **CONTEXT.md**: 复制谱系/epoch 词汇已由父 PR #130 就位（:117-122），与本实现语义一致；未被本 diff 修改（符合设计 D-12 零改动决策）。
- **README**: 根 README 无 Lease/status 形状叙述，无失配。
- **失配点（非阻断，见 N-1）**: 两处包 README 与 CONTEXT.md 停接纳词条的枚举性句子未跟上新公共面。
- **类型导出与声明图纪律**: 新增导出全部 type-only；registry declaration 禁词审计、runtime 恰一键值导出审计均绿（全仓 1478/1478 内含）✓。

---

## 五、发现清单

### Blocking 发现

**无。**

### 非阻断发现 / 观察

| # | 级别 | 发现 | 证据 | 处置建议 |
|---|---|---|---|---|
| N-1 | LOW | 消费者文档三处枚举性句子轻微滞后于新公共面（不影响行为契约，且在已接受设计 D-12/DENY LIST 明示的零改动范围内）：① runtime README:3「serialized ROOT/SCHEMA writes」与 :21「P0, ROOT writes, SCHEMA writes, and the close barrier share one FIFO sequencer」未含 replication 写槽；② registry README:13「A lease is the caller capability for reads and controlled ROOT/SCHEMA writes」未含两复制管理方法；③ CONTEXT.md:84 停接纳词条的写枚举仅列 mutateRoot/replaceSchema | packages/namespace-runtime/README.md:3,21；packages/namespace-registry/README.md:13；CONTEXT.md:84 | 后续 docs 切片顺手补齐；本票不阻塞（设计已裁决零改动，复审门禁不应推翻已接受设计） |
| N-2 | INFO | `registry-sa7-phase5-replication-dynamic.test.ts`（349 行新建）不在设计 §7 ALLOW LIST 原文内——系设计定稿后 SA7 动态验证阶段产物，dispatch #13 与 sa7_report.md 已登记，内容为 AC-6 族测试、纯加法 | dispatch #13；commit c2b23ab | 属流水线标准阶段的 ALLOW LIST 事后扩展，记录完整，无需回流 |
| N-3 | INFO | SA6-owned 两锚文件（red.test.ts / surface.test-d.ts）在 ec83429 被修订（+14/-1 与判别结构重写）——非静默：sa6_red.md「修订记录 R1」逐条记载（R1-1 类型锚分布式判别恒 never 缺陷、R1-2 FilePersistence flush/rename 与 dispose abort 竞态，接入 issue #108 durable-snapshot-wait），dispatch #10 登记 SA6 亲修、锚定语义不变；本审查实跑确认 20/20 绿 | sa6_red.md:206-256；red.test.ts:744-748 注释；surface.test-d.ts:50-60 修订注记 | 流程合规，无需处置 |
| N-4 | INFO | AC 核对表「SA7 登记 S7-1（INFO）」：CI runner log 摘录因分支未 push 环境阻塞，以本地同命令链实跑替代并登记发布阶段补证——本审查已独立实跑全仓 1478/1478 绿复核，该缺口不影响 AC 结论 | ac_checklist.md:19；本报告「独立验证动作」 | 发布阶段按登记补 CI 证据即可 |
| N-5 | INFO | 设计 ALLOW LIST 列 `registry-surface.test.ts` 预备迁移，实际零改动——核实该文件无 `NamespaceRuntime`/`NamespaceRuntimeStatus` 显式定型 fake（grep 仅命中禁词审计行），符合设计 §4.10 判定标准「显式定型处必补」，零改动正确 | registry-surface.test.ts:11/39-43/245 | 无需处置 |

---

## 总结

diff `7425164..26cd94b` 与 issue #132 六条 AC、已接受设计 R3（含 §7 ALLOW/DENY 清单）、ADR 0010 复制谱系节与 ADR 0008 写纪律**逐条相符**；AC 核对表证据独立复核全部属实（含本审查实跑全仓 126 文件 1478/1478 绿、phase-5 五文件 47/47 绿 + typecheck 无错误）；零 blocking 发现；非阻断发现 1 条 LOW（消费者文档枚举滞后，在已接受设计零改动决策范围内）+ 4 条 INFO 流程性观察。

Conclusion: clear

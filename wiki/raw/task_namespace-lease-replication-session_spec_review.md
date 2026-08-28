# Spec 轴终审报告 — issue #134（Phase 5: expose trusted NamespaceLease ReplicationSession）

- **Date**: 2026-08-28（双轴终审 · Spec 轴）
- **审查对象**: `git diff ebc5419..HEAD`（HEAD=08b49fd = 实现 666f9b1 + SA6 R2 测试修复 08b49fd）；branch `fix/issue-134-on-docs-phase-5-websocket-replication`；worktree `/home/wangjian/nomicore-fix-issue-134`
- **权威链**: ADR 0010（第一权威，含本 diff 纯增补的 issue #134 修订节）→ ADR 0008（含 #93/#132 修订节）→ ADR 0009（含 #131 修订节 + 本 diff 两注记）→ ADR 0006（#79 修订节）→ ADR 0007 → `docs/phases/phase-5-websocket-replication.md` §切片 3/4 → CONTEXT.md；冲突门禁 clear + 相关决议 O-1..O-12 全链
- **流水线档案**: conflict_report / design(R1) / sa2_review / sa2_review_r2 / sa6_red / sa3_impl / sa4_review / sa7_report / ac_checklist（9 份全读）
- **审查方法**: 独立复核——逐 AC 抽查测试断言与实现路径（不接受口头映射）；ADR 0010 四节逐条款对照实现；scope 文件级筛查；结构性 grep 核验；全量测试/typecheck 亲跑复现

## Conclusion: **pass**

0 CRITICAL / 0 HIGH / 1 MEDIUM / 2 LOW / 2 INFO。7 条 AC + SA8 O-5 两补锚全部有真实实现与确定性契约测试证据；ADR 0010 四节语义逐条落位；scope creep 零；SA6 R2 修复零语义削弱；文档四件套与代码一致；SA4 6 INFO + SA7 2 观察项全部有归属。MEDIUM/LOW 为测试锚完备性缺口（实现经静态核验正确、无契约违反），附具体补锚建议，不构成阻断。

---

## 一、AC 逐条复核表（7 AC + O-5 两补锚）

| AC | 结论 | 实现锚（独立核验） | 测试锚（断言真实性抽查） | 规格锚 |
|---|---|---|---|---|
| **AC-1** openReplicationSession、每 Lease 一活跃 session、冻结 role/remote/lineage/epoch | ✅ | lease.ts:321–366（①released→②输入→③role 匹配→④活跃计数→⑤internal seam→⑥wrapCore，全同步 check-then-set）；core 冻结四域 replication-session.ts:248–263；O-9 终态释放槽位（lease.ts:344 只数 `state==='open'`） | red 用例 1（四域与 status 投影事实一致 + apply 走通）、用例 2（二次 open 三形态行为可区分锚——实现为更严的 REPLICATION_SESSION_EXISTS 拒绝）、用例 3（released→`NAMESPACE_LEASE_RELEASED`）、用例 17（fence 终态后同 Lease 再 open 冻结新 epoch）；SA3 open 门序 4 用例（含 UNSUPPORTED/NOT_ENABLED/lifecycle） | ADR 0010 L73–81；修订节 L236/L245 |
| **AC-2** 六项窄能力 + 不暴露 doc/handle/sequencer/live types | ✅ | core 十键（replication-session.ts:108–119）；扇出只投 `update.slice()` 字节（L156–178）；SV/diff/订阅/apply/status/close 闭包不外泄 doc | red 用例 4：SV 与 `Y.encodeStateVector(liveDoc)` **逐字节相等**；diff 重放写前副本得 n=8（真实 Yjs 语义）；订阅字节重放得 ext=7、unsubscribe 停投；apply 后 live 可见；status 含 `replication-unvalidated`；close 幂等同值 + close 后 apply 非.ok 零写入。用例 5：FORBIDDEN 属性/键探测 + 能力键齐。surface test-d 5 探针（HasSessionCaps/HasForbiddenRefs/HasOpenReplicationSession/HasLeaseRawApply 对真实导出类型求值） | ADR 0010 L81–88；修订节 L241 |
| **AC-3** 唯一 write sequencer + 槽内完成 dirty notification | ✅ | **结构性**：`new WriteSequencer` 全仓唯一（runtime.ts:241）；host 捕获同一闭包实例（runtime.ts:247–257）；apply 槽 `host.sequencer.enqueue`（replication-session.ts:335）；R6 同槽 `await notifyDirty()` 先于 R7 resolve（L496–510） | red 用例 6：提交序 [apply,业务写,apply] → saveEvents 快照序逐槽累计（k1=1/n=42 → n=9 → k2=2）且 apply A resolve 时其 saveDoc 快照已存在——FIFO 相对序 + dirty 先于 resolve 双锚 | ADR 0010 L96–103；ADR 0008 L36/L45；CONTEXT 写序列器 |
| **AC-4** hub scratch-check SCHEMA/保留 META；ROOT raw 不做 VFSL 预校验（replication-unvalidated） | ✅ | R4 预演先于 R5 live apply（replication-session.ts:467–476）；`RAW_PROTECTED_FIELDS` 冻结常量 hub={schema,meta} / peer={meta}（L211–214）；判据 (a) 内容投影相等（protectedContentEvaluated L529–585：全量装载+装载待审+全键投影比对，非 primitive 保守判变）；R5.5 只置不清 | red 用例 7（hub SCHEMA 变更拒：零写入+saveEvents 零新增+重复稳定）、8（META.replicationId 变更拒：保留字段不变）、9（违反 schema 的 raw ext='zzz' **仍接受** ok:true + 标记 + saveDoc+1 + 后续业务写被拒零写入；合法 raw 同样标记）、10（peer 收 hub：SCHEMA.note/ROOT.ext 允许、META.replicationEpoch 仍拒）。SA3 R4 矩阵补判据 (a) 边界（删后同值重写允许）与畸形字节拒绝 | ADR 0010 L105/L107/L115–121；修订节 L249–255（hub 侧全 META 收紧为已登记的收紧而非放宽——增补节 L254 明示） |
| **AC-5** peer degraded 只允许 authenticated hub→peer trusted apply；业务写仍禁 | ✅ | O-1 五条件合取（replication-session.ts:447–465：degraded ∧ direction 冻结 hub-to-peer ∧ notifyDirty 绑定；lifecycle/fatal 由 A3/R1 前置）；「authenticated」本切片等价物 = 冻结方向 + 可信 Host（O-6 裁决，ADR L79）；notifier 未绑定一律拒（L461–464） | red 用例 11：真实 MemoryPersistence 两阶段（writer 落盘→main 磁盘打开）；degraded 后业务写 `RUNTIME_WRITE_DISABLED`+零写入；hub→peer apply ok:true + 内存 ext=7 + saveCount+1（#79）+ 磁盘 reader 无 ext（内存/磁盘区分）→ 恢复后 fresh reader 落盘合一。SA7 探针 C 补真实 FilePersistence 全链 16/16 | ADR 0010 L131–139；ADR 0006 #79 L190–195；修订节 L263 |
| **AC-6** 单 observer 扇出 immutable owned updates、排除源 origin、observer 失败不伤已提交事务 | ✅ | **结构性**：`doc.on('update')` 全 src 唯一（replication-session.ts:158，构造期挂接 runtime.ts:249）；唯一排除谓词 `origin === channel.applyOrigin`（L160）；每 listener 独立副本 + try/catch 自捕获计数（L161–166）；计数投影 observerFailures（L372） | red 用例 14：双 Lease 双 session 本地写均投（字节重放 n=7）；apply@A → A 不投/B 投（重放 ext=7）；已交付字节 fill(0xff) 后 live 不受影响 + 后续写继续投。用例 15：抛错 observer → 事务仍 ok、fatal null、另一 session 照收、后续写照常。SA3 fanout 三锚 + SA7 探针 D（3002 次精确计数、副本隔离） | ADR 0010 L109–113；ADR 0007 L54（T-2 和解） |
| **AC-7** release/close/Runtime close/idle/shutdown/apply race/epoch fence/fatal committed facts 确定性契约测试 | ✅（一处证据映射见 MEDIUM-1） | close barrier 恒绿空槽体 + 幂等 same-promise（replication-session.ts:375–393）；R2 fence → 终态 conflicted + 同步 detach（L417–430）；R6 失败 → `RuntimeWriteFatalError(committed:true)`（L498–507）；A3 lifecycle 接纳门（L328–333） | red 用例 4（close 幂等+barrier）、16（shutdown 后 apply `RUNTIME_WRITE_DISABLED` 零写入）、17（epoch 冻结不漂移/fenced 零写入零新增/新 session epoch=2 正常）、18（idle 窗口复用同 Runtime 观察旧写状态）、19（notify 失败→rejected `RuntimeWriteFatalError.committed===true` + ext=7 事实保留 + 后续写禁 + 读保留）、20（FilePersistence 重启 SV 逐字节一致 + apply 可用）、6（apply 竞态 FIFO）；SA3 T-3/T-4（barrier 结算序 + unhandledRejection 0） | ADR 0010 L53/L55/L90/L98/L136/L179；ADR 0009 L42–50/L99–101；ADR 0008 #132 L136 |
| **O-5(a)** hub degraded 拒 peer→hub raw apply；读/身份/SV 交换保留 | ✅ | R3 非 ready 且非 bypass 五条件 → 拒（replication-session.ts:447–459；hub 方向 direction='peer-to-hub' 恒不满足 bypass） | red 用例 12：degraded hub apply 非.ok 零写入；`lease.read` ok；SV 与 live 逐字节一致；冻结身份未被降级破坏。SA3「hub degraded（peer→hub 方向）」用例（零写入、session 未终态、SV 照常、getStatus 恰一次） | ADR 0010 L125–129 |
| **O-5(b)** peer 本地 replaceSchema 稳定角色权限错误 | ✅ | O-4 角色注入（registry.ts:188–192 assertRoleShape 第五门、缺省 'hub'、非法 TypeError `NAMESPACE_REGISTRY_ROLE_INVALID`）；peer 的 replaceSchema/enable/bump Lease 接纳段常量 issue 拒（lease.ts:299/311/319，`REPLICATION_ROLE_PERMISSION` 冻结常量——两次调用 JSON 逐字节相同） | red 用例 13：peer replaceSchema 两次 ok:false 且 JSON 逐字节相同、SCHEMA 载体完整、ROOT 业务写不受影响、enable hub-only；hub 对照 replaceSchema ok:true | ADR 0010 L118/L120；修订节 L260 |

## 二、实现语义 vs ADR 0010 逐节对照（无偏差结论）

| ADR 0010 节 | 对照结论 |
|---|---|
| §NamespaceLease 与 ReplicationSession（L71–90） | ✅ 所有 Lease 可调用、无 capability、JSDoc 明示绕过 VFSL（types.ts:468–472）；每 Lease 首版至多一个 duplex（O-9 活跃词义）；创建冻结四域；六项窄能力逐项在位；release 同步停接纳（doRelease 同步 close 既有 session，lease.ts:224）；网络状态不入 Runtime status（status.ts 不在 diff，replication 域仍两态） |
| §Trusted raw update 与现有不变量（L92–113） | ✅ 六步逐位：gate（A3 lifecycle + R1 fatal + open 冻结角色 + R2 身份/epoch）→ R4 受保护检查 → R5 一次 `Y.applyUpdate(doc, bytes, symbol origin)` → observer 产出 owned bytes+受控 origin → R6 `await notifyDirty` → R7 释槽；无「先 apply 再 rollback」路径；拒绝 message 只在真正零写入路径声明零写入 |
| §SCHEMA 与 META 权限（L115–121） | ✅ peer 本地 replaceSchema 稳定拒绝；enable/bump hub-only；受保护集合为冻结常量（raw caller 不可逐次自定义）；hub SCHEMA update 向 peer 单向复制（peer 侧 SCHEMA 放行）；peer META 白名单首版空集（`PEER_ALLOWED_META_KEYS`，零运行时差分占位——SA4 INFO-1）；hub 侧全 META 保护为增补节 L254 登记的收紧（较 L105 最小集更严，方向安全） |
| §Persistence degraded 语义（L123–139） | ✅ hub degraded 拒 raw + 读/身份/SV 保留（用例 12）；peer degraded 拒业务写 + hub→peer 内存 apply + `saveDoc` 仍登记 + retry 落盘（用例 11 + SA7 File 路）；bypass 只属冻结 hub-to-peer session（五条件合取）；closing/fatal/handle 失效（released/disposed）不得绕过（R1/R3/A3 + SA3 released/disposed 用例）；内存/磁盘区分（`memoryCaughtUp`/`diskCaughtUp:false` 字面量——结构性永不声称 durable） |
| §修订节冻结词汇（L228–263，本 diff 纯增补 39 行、0 删除） | ✅ open 七码/apply 六码闭集与实现逐字一致；status 十一字段形状一致（memoryCaughtUp 初值 false、置位不回落）；O-9 生命周期词义（终态释放槽、close barrier 永不 reject、双摘除点共用）；O-12 判据 (a) 含「删后同值重写=允许」边界点名；O-4/O-7/internal 两键/回灌踩坑注记全部落位 |

## 三、Scope creep 筛查：**零**

| 非目标（任务简报边界） | 证据 |
|---|---|
| WS/连接与 namespace 状态机/认证授权（切片 6/7） | diff 文件清单零 WS 依赖；role/方向为纯本地冻结值；无 token/hello/序列号代码 |
| resetReplica/archive（切片 2/8） | 零实现（grep 无 resetReplica/archiveDoc 生产代码） |
| 改 `@nomicore/replication-protocol` | `git diff --name-only -- packages/replication-protocol` = 0 文件 |
| Runtime status 增 session/网络/队列/sync 状态 | status.ts 不在 diff；session status 为独立查询面（T-4 锚） |
| 第二种 transport / transport-independent seam 抽取 | 零抽取；session 为包内机制 + internal 第二值导出（ADR 0010 L261 登记的显式裁决） |
| raw update 完整 VFSL 校验/自动 rollback | 明示例外实现（replication-unvalidated 只置不清）；无 rollback 路径 |
| needs-resync 队列/背压（切片 6） | 未实现；phase-5 文档 C-1 对账注记原文在场（L81） |
| 其他包越界 | persistence/doc-runtime/vfsl/dsh-persistence/clock/apps/domains 均 0 文件改动 |

diff 文件全集 = 实现两包 8 个 src 文件 + 4 个测试文件（含 registry-open.test.ts 1 行键集锁演进，SA4 INFO-2 已声明）+ 文档四件套（全纯增补）+ wiki 档案。`git diff --check` 干净。

## 四、测试-需求映射真实性

- **SA6 20 行为锚**：抽查全部为真·行为断言——真实 Yjs round-trip 重放（SV/diff/订阅字节）、saveEvents 快照序（FIFO/dirty 时序）、JSON 逐字节稳定（角色错误）、真实 MemoryPersistence 两阶段磁盘（degraded）、FilePersistence 重启、双 Registry 对照（角色）；零源码 grep 断言、零形状空转。
- **SA6 5 类型探针**：条件类型对真实导出求值（非文本匹配）；含保持性守卫（Lease 无裸 raw apply 旁路）。
- **SA3 30 包内锚**：T-1..T-8 + open 门序 + R 门序短路（含 statusCount 恰一次 gate 访问计数）+ R4 矩阵（含判据 (a) 边界）+ fanout 三锚 + 唯一 FIFO——锚点均为设计冻结契约点（O-*/D-*/INV-S-*），非实现偶发细节；runtime 测试未反向 import registry 包（SA2 R2 §5 禁令遵守）。
- **R2 修复零语义削弱复核（08b49fd）**：①saveEvents 绝对计数→基准化后仍为**精确计数**（`=== saveBaseline+3`/`+1`/`=== saveBaseline` 零新增——基准含 enable/bump 既有 E6 notify，机械上绝对计数本就错误）；②AC-5 磁盘断言 `ext===7 && n===2` 原样保留（freshReader 仅绕开 MemoryPersistence 活单元缓存）；③fixture dispose 透传（纯助手）；④类型窄化（锚定码不变）。无一处放宽。

## 五、文档-代码一致性（抽查通过）

- ADR 0010 增补节码表/词汇 = types.ts:330–417 + errors.ts:191–227 逐字（含 `NSRT-FATAL-REPLICATION-APPLY-INTERNAL` 分码——write.ts L80 append-only + 既有三槽渲染逐字节不变，rev1 测试零改动绿佐证）。
- phase-5 切片 3/4 锚定：六能力方法名、open 两域、role 注入（含切片 9 必传注记）、status 词汇、受保护常量与白名单空集、C-1 注记——与实现一致。
- CONTEXT.md：ReplicationSession 词条方法名扩写 + 新增「实例角色」词条 = 实现行为（SA4 INFO-3 的 Hub/Peer 词条指针差异为措辞落位，语义已完整在册）。
- ADR 0009 两注记：internal 两键（internal.ts:47–55 键集锁同步演进）+ Lease 第十四成员与 released 通道行 = lease.ts 实现。
- `INSTANCE_ID_PATTERN`（lease.ts:145）与 replication-protocol INSTANCE_ID_RE 为双副本结构守卫（注释互指，避免本切片引入切片 6 依赖）——见 INFO-1。

## 六、发现分级清单

| # | 级别 | 位置 | 发现 | 规格锚 | 建议 |
|---|---|---|---|---|---|
| MEDIUM-1 | MEDIUM（不阻断） | lease.ts:224（doRelease 同步 close 既有 session）、lease.ts:249（wrapCore `isRevoked()` → apply 拒 `NAMESPACE_LEASE_RELEASED`） | **ADR 0010 L90「Lease release 同步停止 session 接纳」的「既有 session」半边无任何确定性 CI 测试锚**：red 用例 3 只锚 released 后的 **open** 通道；全测试树无「open session → lease.release() → session state='closed' / apply → `NAMESPACE_LEASE_RELEASED` / 存量订阅停投」用例（grep 证实 0 命中）。ac_checklist AC-7 行的证据串「release 同步停止 session 接纳 + doRelease 同步 close 既有 session」映射到用例 3，属部分口头映射。实现本身经静态核验正确且与设计 O-9/D-7 冻结一致；SA7 探针 A2 只动态覆盖 open 通道 | ADR 0010 L90；修订节 L246 | 补一个红灯用例：open session + 订阅 → `lease.release()` → 断言 `session.getStatus().state==='closed'`、`applyRemoteUpdate` → `{ok:false, code:'NAMESPACE_LEASE_RELEASED'}`、订阅零新投递（可并入 red 套件或切片 6 前置锚） |
| LOW-1 | LOW | lease.ts:321–356（open 编排 ②③④） | Lease 层三个 open 拒绝码 `REPLICATION_SESSION_INPUT_INVALID` / `REPLICATION_ROLE_MISMATCH` / `REPLICATION_SESSION_EXISTS` 无直接 CI 锚（red 用例 2 刻意三形态松锚；SA6 §6.2 声明「未锚定具体码」；敌意 options 的 INPUT_INVALID 仅 SA7 动态探针覆盖，不在 CI 面）。runtime 侧 open 码（NOT_ENABLED/UNSUPPORTED/RUNTIME_WRITE_DISABLED）已由 SA3 锚定 | 修订节 L236（append-only 码注册表） | 三行断言级补锚（各一 open 调用 + code 精确匹配），锁死冻结词汇防未来漂移 |
| LOW-2 | LOW | red 用例 13（L1062–1087） | O-5b 锚定了行为契约（ok:false + JSON 逐字节稳定 + SCHEMA 完整 + hub 对照）但未断言冻结码字面 `REPLICATION_ROLE_PERMISSION`——稳定词汇未被测试锁死（SA6 §6.2 已声明此松锚为可接受） | 修订节 L260 | 在 LOW-1 补锚中一并断言 message 含 `REPLICATION_ROLE_PERMISSION` |
| INFO-1 | INFO | lease.ts:145–151 vs packages/replication-protocol/src/constants.ts | `INSTANCE_ID_PATTERN` 双副本（互指注释的结构守卫）存在静默漂移风险——切片 6 接线时应收敛为单一真相源或加跨包一致性测试 | ADR 0010 L156 | 切片 6 接线时收敛；不阻断 |
| INFO-2 | INFO | 遗留登记核对 | SA4 6 INFO（占位常量/键集锁 D3/CONTEXT 词条指针/expect.poll/symbol 键/scratch 步骤 1 分类）与 SA7 2 观察项（encodeDiff 畸形 SV 照实抛=设计声明可信域契约；scratch O(doc) 成本=ADR 已登记基线）**全部有归属**：→ 切片 6（INFO-1/5/6、O-1/2）、切片 9（INFO-3）、SA1 流程回流（INFO-2）、非必须统一（INFO-4）。无暗藏阻断项 | — | 照归属流转即可 |

**CRITICAL: 0；HIGH: 0。** MEDIUM-1/LOW-1/LOW-2 为测试锚完备性缺口（实现静态核验正确、AC 字面已各有确定性测试），按分级纪律不阻断合入；建议在切片 6 开工前补锚。

## 七、验证证据（本审查亲跑）

```text
# 全量测试（资源受限池，与 SA7/总控基线一致）
pnpm test --pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 \
  --testTimeout=60000 --hookTimeout=60000
→ Test Files 138 passed (138)；Tests 1679 passed (1679)；Type Errors: no errors；exit 0
  （.mabf-bg/spec-full-test.log）

# 10 包 typecheck 链（复跑完成：无 tsc 残留进程、日志零 error TS、pnpm 成功横幅——与 SA7 基线 exit 0 一致）
pnpm typecheck → 0 error TS（.mabf-bg/spec-typecheck.log）

# 结构性核验
grep -rn "new WriteSequencer" packages/*/src/   → 唯一 runtime.ts:241
grep -rn "\.on('update'" packages/*/src/        → 唯一 replication-session.ts:158
git diff --name-only -- packages/replication-protocol packages/persistence \
  packages/doc-runtime packages/vfsl apps domains → 0 文件
git diff ebc5419..HEAD -- docs/adr/0010-*.md | grep -c "^-[^-]" → 0（纯增补）

# 测试锚覆盖 grep（MEDIUM-1/LOW-1 证据）
grep -rn "NAMESPACE_LEASE_RELEASED" <两新测试文件> → 仅 red:625（open 通道）
grep -rn "REPLICATION_SESSION_EXISTS|REPLICATION_ROLE_MISMATCH|REPLICATION_SESSION_INPUT_INVALID" \
  packages/*/test/*.ts → 0 直接锚
```

## 八、结论

**Conclusion: pass。** 7/7 AC + 2/2 O-5 补锚以真实实现与确定性契约测试满足；ADR 0010 四节及修订节冻结条款逐条落位无偏差；切片 3/4 边界外零实现；SA6/SA3 锚点真实锚定需求行为且 R2 修复零削弱；文档四件套与代码一致；SA4/SA7 遗留全部归属清楚。1 MEDIUM + 2 LOW 建议于切片 6 前补锚（不阻断本切片合入）。`pass` 不替代 SA4/SA7 已完成的实现与活链路验证结论。

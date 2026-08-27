# AC 门禁清单 — issue #134（Phase 5: expose trusted NamespaceLease ReplicationSession）

- round 1 · 基线 ebc5419 → HEAD 08b49fd（实现 666f9b1 + 测试修复 08b49fd）
- 证据链：SA8 clear → SA6 红灯锚定（20 行为红 + 2 类型红）→ SA1 设计 R1.1（SA2 R1 reject → R2 pass）→ SA3 实现 → SA6 R2 修复 → 总控亲验三档全绿 → SA4 静态验尸 pass → SA7 动态验证 PASS
- 总控核对日期：2026-08-28

## AC 逐条核对

| AC | 结论 | 证据 |
|---|---|---|
| AC-1 NamespaceLease exposes openReplicationSession with one active session per Lease and explicit role, remote instance, lineage, and epoch binding | ✅ | `NamespaceLease.openReplicationSession(options)` 落位（types.ts/lease.ts）；每 Lease 至多一**活跃** session（closed/conflicted 终态释放槽位，O-9 裁决）；session 冻结四域 localRole/remoteInstanceId/replicationId/replicationEpoch（只读属性，bump 不漂移）。锚：SA6 用例 1/2/3 + 17（epoch 冻结）；SA4 §一.1 设计符合性 |
| AC-2 Session provides state-vector/diff encoding, owned update subscription, trusted apply, status, and idempotent close without exposing Y.Doc, DocHandle, sequencer, or live shared types | ✅ | 六能力：encodeStateVector/encodeDiff/subscribeOwnedUpdates/applyRemoteUpdate/getStatus/close；session 十键冻结对象零 doc/handle/sequencer 引用（属性探测 + 类型键集双层锚）；close 幂等 + barrier 语义 + never-reject（R1）。锚：SA6 用例 4/5 + surface 探针；SA3 包内 T-5/T-6；SA7 ① close barrier 17/17 |
| AC-3 Remote apply shares the existing write sequencer and completes dirty notification before resolving | ✅ | apply 槽 R1–R7 经 runtime.ts V3d 唯一 WriteSequencer 闭包实例 enqueue（结构性无第二队列）；R6 同槽 await notifyDirty 后才 resolve。锚：SA6 用例 6（saveEvents 相对序 + dirty 先于 resolve）；SA4 §一.2（同一实例结构性成立） |
| AC-4 Hub applies scratch-check Peer updates for SCHEMA and reserved META mutation before live apply; normal ROOT raw updates remain replication-unvalidated rather than receiving full VFSL validation | ✅ | hub 方向 apply 槽 R3 scratch clone 判据 (a) 内容投影相等（SameValue 数值、非 primitive 保守判变；受保护常量：SCHEMA 全容器 + META 全键）；违例 → 零写入稳定拒绝；ROOT raw 从不 VFSL 预校验，置位 `replication-unvalidated`（永不清）；peer 方向放行 ROOT/SCHEMA、META 保留仍拒。锚：SA6 用例 7/8/9/10；SA2 攻击实证（同值重写允许/删键拒/畸形字节拦）；SA7 ② scratch O(doc) 实测无泄漏 |
| AC-5 Peer persistence-degraded permits only authenticated Hub-to-Peer trusted apply while ordinary business writes remain disabled | ✅ | O-1 五条件合取谓词（lifecycle ready ∧ fatal 无 ∧ direction=hub-to-peer 冻结 ∧ handle=persistence-degraded ∧ notifyDirty 绑定）；「authenticated」本切片等价物 = 冻结方向 + 可信 Host（O-6）；业务写仍 RUNTIME_WRITE_DISABLED；saveDoc 仍登记（#79）；内存/磁盘区分（durability.memoryCaughtUp/diskCaughtUp:false 字面量，结构性不声称 durable）；Runtime closing/fatal/released/disposed 不得绕过。锚：SA6 用例 11；SA7 ③ Memory+File 两路 16/16 |
| AC-6 One Runtime observer fans out immutable owned updates to multiple sessions and excludes the source origin without observer failures affecting committed transactions | ✅ | 构造期恰一个 doc.on('update') fanout；同 namespace 多 Lease 多 session 扇出；排除谓词 = origin===本 session token（null origin 本地业务写恒投——Yjs 实测）；每 listener 独立 Uint8Array 副本 + try/catch 自捕获（observerFailures 计数），不回滚 transaction、不 fatal、扇出不断。锚：SA6 用例 14/15；SA7 ④（3002 次投递计数精确）+ ⑤（origin 行为 13.6.32 实测 19/19） |
| AC-7 Lease release, session close, Runtime close, Registry idle/shutdown, apply races, epoch fencing, and fatal committed facts have deterministic contract tests | ✅ | release 同步停止 session 接纳 + doRelease 同步 close 既有 session；session close 幂等/barrier；Runtime close/shutdown → apply RUNTIME_WRITE_DISABLED；idle 窗口复用；apply 竞态由 FIFO+槽内重读确定；epoch fencing（冻结不漂移+bump 后 fenced+新 session 正常）；fatal committed facts（notify 失败 → RuntimeWriteFatalError committed:true + 事实保留 + 写禁读留）；FilePersistence 重启 SV 逐字节一致。锚：SA6 用例 3/16/17/18/19/20；SA3 T-1..T-8；SA7 ①③ |

## O-5 补锚（SA8 登记的 AC 覆盖缺口）

| 补锚 | 结论 | 证据 |
|---|---|---|
| O-5(a) hub persistence-degraded 拒绝 peer→hub raw apply（ADR 0010 L125–129） | ✅ | degraded 矩阵五角：hub 方向 degraded 拒 apply 零写入、读/SV 交换保留；SA6 用例 12 |
| O-5(b) peer 本地 replaceSchema() 稳定角色权限错误（ADR 0010 L118） | ✅ | 实例角色经 Registry 构造 options.role 注入（O-4）；peer 的 replaceSchema/enable/bump 在 Lease 接纳段以 REPLICATION_ROLE_PERMISSION 常量 issue 拒绝（两次调用逐字节相同）；hub 对照正常。锚：SA6 用例 13 |

## 非目标越界检查（切片 3/4 边界）

| 非目标 | 结论 |
|---|---|
| WS/连接与 namespace 状态机/认证授权（切片 6/7） | ✅ 零实现（grep 无 WS 依赖；role/方向为纯本地冻结值） |
| resetReplica/archive（切片 2/8） | ✅ 零实现 |
| 改 @nomicore/replication-protocol | ✅ 零改动（diff 不含该包） |
| Runtime status 增加 session/网络/队列/sync 状态 | ✅ getStatus 八键不变；session status 独立查询面 |
| 第二种 transport / transport-independent seam | ✅ 零抽取 |
| raw update 完整 VFSL 校验 / 自动 rollback | ✅ 明示例外实现（replication-unvalidated），无 rollback 代码路径 |
| needs-resync 队列/背压（切片 6） | ✅ 未实现且已对账（设计 §10 C-1 注记落位 phase-5 文档） |

## 公共面纪律核对

- runtime index.ts 值导出恰一键（RuntimeWriteFatalError）：✅（diff 不触碰 index.ts）
- runtime 十二键对象面不变：✅（十二键锁测试零演进）
- internal subpath 恰两值导出（+openReplicationSessionCoreForRegistry）：✅（键集锁按既有先例演进一键）
- registry 主入口 type-only 追加、exports 不变：✅
- 文档同步四件套（ADR 0010 增补节含 C-1/判据 (a) 边界/META 收紧登记/observerFailures 显式化/回灌注记；ADR 0009 两注记；phase-5 切片 3/4；CONTEXT.md）：✅ SA4 §一.6 逐字落位核验

## 门禁结论

**AC 门禁 7/7 + O-5 补锚 2/2 全部通过；非目标零越界；公共面纪律零突破。** 进入双轴终审。

## 终审后补记（2026-08-28 R3）

双轴终审双 pass 后的非阻断项收口（终审报告：standards_review.md / spec_review.md）：
- Spec MEDIUM-1（lease release→既有 session close/拒绝/停投 无 CI 锚）→ SA6 R3 补锚（red 套件 20→22 用例，直接绿）；
- Spec LOW-1/LOW-2（三个 open 拒绝码精确匹配 + REPLICATION_ROLE_PERMISSION 冻结码字面）→ SA6 R3 同批补锚锁死；
- Standards minor×2（死导出去 export、CONTEXT/phase-5 措辞笔误）→ SA3 R2 机械修复；
- 终审后最终验证（HEAD 04849fe，总控亲跑）：`git diff --check` exit 0、`pnpm typecheck` exit 0、全量 `pnpm test` **138 文件 / 1681 测试 / Type Errors 0 / exit 0**（.mabf-bg/final-{typecheck,test}.log）。
- 其余 INFO 项归属：切片 6（INSTANCE_ID_PATTERN 双副本收敛、PEER_ALLOWED_META_KEYS 启用、needs-resync 队列、scratch 演进位）、切片 9（role 显式配置）、知情接受（Equal/AssertTrue 多副本=包边界必要代价、observerFailures 无界计数=已显式登记）。

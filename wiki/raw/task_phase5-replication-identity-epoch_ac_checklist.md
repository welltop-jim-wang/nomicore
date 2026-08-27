# AC 逐条核对清单 — Phase 5: enable replication identity and epoch management（issue #132）

- **核对时间**: 2026-08-27（round 1）
- **核对人**: 总控（Phase 3.5 AC 门禁）
- **基线→HEAD**: 7425164 → c2b23ab（commits: 8113083 实现 / ec83429 红灯锚修订 / c2b23ab SA7 动态用例）
- **验证基线**: `pnpm test` 全仓 126 文件 1478/1478 绿、Type Errors 无（SA7 CI 同链实跑）；总控亲验 125 文件 1474/1474 绿（SA7 新用例入库前，.mabf-bg/green-verify.log，exit 0）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC-1 | META reserves and projects replicationId and replicationEpoch with the formats frozen by ADR 0010 | ✅ | `readReplicationFacts`（packages/namespace-runtime/src/replication-write.ts）has() 判别 + 格式校验（`/^[0-9a-f]{32}$/`、从 1 安全整数；部分存在/undefined/格式违约 → NSRT-REPLICATION-META-CORRUPT loud）；getMetadata 深拷贝投影两字段（未启用时缺席）；status 第八键（status.ts:49-52）。用例：red.test.ts AC-1 两条 + surface.test-d.ts 两条类型锚；channels 测试损坏种子族 7 型 + 双读者一致性 | 已落地，测试绿 |
| AC-2 | enableReplication atomically installs a random 128-bit lineage ID and epoch 1 through the namespace write sequencer and dirty notification | ✅ | lease.enableReplication()（lease.ts:154-163）→ Registry 层 CSPRNG 抽取（drawReplicationId，#131 注入随机源）→ runtime 复制写槽 E1-E7（replication-write.ts runEnableReplicationSlot）与 mutateRoot/replaceSchema 共享唯一 WriteSequencer；单 Yjs transaction 原子写两键；同槽 await notifyDirty。用例：red.test.ts AC-2 两条（通知时刻 META 已含两字段、saveDoc 恰一次；并发 [enable,bump,bump] 通知序恒 [1,2,3]） | 已落地，测试绿 |
| AC-3 | Re-enabling an enabled namespace is idempotent or returns a stable documented result without changing identity | ✅ | 设计 D-5：重复 enable → `{ok:true}` 幂等、零写入零通知（稳定文档化结果，设计 §4/§5 明文）。用例：red.test.ts AC-3（二次 enable 身份不变、epoch 不重置；bump 到 2 后再 enable 仍 2） | 已落地，测试绿 |
| AC-4 | bumpReplicationEpoch is Hub-only, sequenced, monotonic, rejects overflow, and preserves committed/fatal facts | ✅ | Hub-only 独占写面：META 两保留键只能经 Lease 两管理操作修改（普通写 zero-touch；`['META','replicationEpoch']` 路径触达领域拒绝零写入；类型面无通用 META 写）；sequenced：唯一 WriteSequencer FIFO；monotonic + overflow：epoch+1 判据先于运算，MAX 结果面 ok:false 拒升不回绕（含 MAX-1 边界）；committed/fatal：notify-dirty 失败 → RuntimeWriteFatalError committed:true + META 已提升不回滚 + 后续写 RUNTIME_WRITE_DISABLED + 读保留。用例：red.test.ts AC-4 四条 + runtime-replication-write.test.ts 9 例 | 已落地，测试绿 |
| AC-5 | Open and Runtime status can distinguish replication-disabled, enabled identity, and identity change without exposing mutable META references | ✅ | status 第八键 `replication: {state:'disabled'} 或 {state:'enabled'; replicationId; replicationEpoch}` 两态联合（NamespaceRuntimeStatus 与 NamespaceLeaseStatus.active.runtime 投影同构，类型锚锁定）；identity change 判别面 = 两读值比较（SA8 设计复审确认语义）；每次调用全新对象 + 深冻结子对象（突变不逃逸）；getMetadata 深拷贝。用例：red.test.ts AC-5 两条 + surface 类型锚两条 | 已落地，测试绿 |
| AC-6 | Tests cover concurrent enable/bump, persistence-degraded, close/fatal races, retry behavior, and Memory/File persistence recovery | ✅ | 并发 enable/bump：red AC-2 并发用例（[enable,bump,bump] FIFO）；persistence-degraded：red AC-6 degraded 用例（gate 降级 → bump RUNTIME_WRITE_DISABLED 零写入；恢复 retry 覆盖；Memory 恢复可见）；close/fatal 竞态：red AC-6 close 竞态（shutdown 排空 + Memory 恢复）+ AC-4 fatal 用例 + SA7 动态用例（真实计时器 shutdown 排空）；retry：degraded 用例恢复段；Memory/File 恢复：red AC-6 两条（Memory 新实例恢复、FilePersistence 全链重启恢复）+ SA7 磁盘级 round-trip 用例。覆盖矩阵 5/5 子项 | 已落地，测试绿 |

## 结论

6/6 全部 ✅，无 ❌ 条目，零回流。附注：SA7 登记 S7-1（INFO 流程项）——CI runner log 触发证据摘录因分支未 push 环境阻塞，已以本地 CI 同命令链（`pnpm test` 126/1478 全绿）替代并登记发布阶段补证义务（非 AC 缺口）。

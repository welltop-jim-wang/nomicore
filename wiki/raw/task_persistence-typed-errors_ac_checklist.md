# AC Checklist — issue #108 persistence：typed load/create 错误与 committed-aware create fatal

- run_id: issue-108-1787670535-603033
- 评审基线: base ba1b6b4 → 工作树（未提交 diff，提交后 = HEAD）
- 门禁输入: SA6 红灯（21 红构造性）→ SA3 实现 → SA4 pass（F-1/F-2 闭合）→ SA7 pass（7 项零放弃）
- 总控亲验: persistence 94/94（exit 0）、全仓 1223/1223（exit 0）、pnpm typecheck 八包（exit 0）

| AC | 要求 | 状态 | 证据 |
|---|---|---|---|
| AC1 | 稳定 typed load operational error，保留原始 cause 且稳定 message 不拼接 cause | ✅ | `DocLoadOperationalError`（code `DOC_LOAD_OPERATIONAL` 字面字段，contract.ts §1.1 逐字）；lifecycle `routeOwnedRead` ReadError 分支唯一包装点（cells.delete 清理在前、exact cause identity、同 ticket 共享同一包装实例）；EC1（Memory+File 双 Adapter）：instanceof + code + cause `toBe` 注入实例 + N3 负锁（message/name/stack/JSON.stringify 不含哨兵串）+ N4 稳定 message 字面量全等 + 并发双 load 同一实例 + heal 自愈；SA7 自由攻击 A-1：300 轮高压 identity 300/300 |
| AC2 | 稳定 typed create operational error，并明确 `committed:false` | ✅ | `DocCreateOperationalError`（code `DOC_CREATE_OPERATIONAL`、`readonly committed: false = false` 字面类字段）；唯二构造点 R1（claim 段 probe read 拒绝，epoch current）/W2（io.write 拒绝，epoch current）均在提交点前（不变量 I-1）；EC3（W2 类）/EC4（R1 类）双 Adapter：committed === false 全等 + cause identity + N3/N4 + doc.isDestroyed===false + store 零提交 + 同 key 重试成功（无 stale claim）；SA7 攻击 A-3/A-4（memory+真实 File IO 重试零残留） |
| AC3 | committed-aware create fatal，至少携带稳定 phase、`committed` 与原始 cause | ✅ | `DocCreateFatalError`（code `DOC_CREATE_FATAL`）+ `DocCreateFatalPhase` 四值 `'probe-read'\|'snapshot-encode'\|'store-write'\|'post-commit'`（与 ADR-0009 L89–L93 Registry 三值零词面重叠，SA8 亲证）+ export 冻结映射 `DOC_CREATE_FATAL_PHASE_COMMITTED`（post-commit 唯一 true，committed 由映射派生不可构造矛盾实例，I-2）+ cause exact；EC5（post-commit/true）/EC6（probe-read/false）/EC7（store-write/false）/EC9（snapshot-encode/false）/EC10（委托模型 true 自洽）全绿 |
| AC4 | duplicate 保持独立稳定类型，不与 operational/fatal 混合 | ✅ | `DocDuplicateError` 逐字节不变（SA4 核 diff 零删除行）；无共享基类（四类型两两 instanceof 互斥，§1.4 YAGNI 裁决）；EC8 双 Adapter：四 code 去重 size=4 + duplicate not-instanceof 三新类型 + 三新类型实例 not-instanceof DocDuplicateError 双向互斥；dsh probe `instanceof DocDuplicateError` 消费面零改动（§10 审计 + probe CLI 双跑逐字节一致） |
| AC5 | FilePersistence 的 create 提交点与可能 post-commit failure 分类准确，不虚假声称 rollback | ✅ | File 提交点 = rename 逐字节不变（writeCommittedSnapshot 三道 throwIfAborted 全在 rename 前，SA4 亲证）；EC5(File)：holdNextWriteAfterCommit（真实 rename 完成后挂起）→ dispose → `DocCreateFatalError phase='post-commit' committed=true`；SA7 磁盘探针补证：hold.entered 时刻 `.snapshot` 71B 在盘、无 .tmp 残留、Yjs 可解码 ROOT 值；N5 rollback 负锁（message 不 match /rollback\|compensat\|undo/i）+ 行为证伪（fresh 读回已提交内容、重试 create 得 DOC_DUPLICATE、不删 store）；message 无 rollback 字样 |
| AC6 | unknown Adapter/internal exception 不被降级为 operational error | ✅ | encode 失败 → fatal 'snapshot-encode' 非 operational（EC9，vi.mock yjs 部分 mock）；restore/validate 损坏（Y 损坏/META.docId 不匹配）→ 裸传不变（EC2 + N6 not-instanceof 三新类型 + /META\.docId/ 正则锚）；dispose 竞态 → fatal（R2/R3/W3）或裸传（L2/L0/C0），绝不 operational；integrity 自检裸传不变；§1.2 Boundary JSDoc + §3.1 seam 契约（违约=adapter bug，AC6 by contract）；SA2 R1 A-5 闭合亲证 |
| AC7 | Memory/File 两 Adapter 通过同一组 load/create 错误契约、exact cause 与敏感文本负锁测试 | ✅ | `describePersistenceErrorContract` 共享套件（testing.ts）被 memory-persistence.test.ts 与 file-persistence.test.ts 以同一断言组（N1–N6）接入，EC1–EC8 ×2 Adapter 同跑；fault seam `createPersistenceIoFaultSeam` 为两 fixture 共用唯一注入机制（「同一组」的机制保证）；exact cause = `toBe` 同一对象引用；敏感文本负锁 N3：哨兵串 TOP-SECRET-CAUSE-TOKEN-7f3a + 伪造路径在 err.message/name/stack/JSON.stringify 四面均不出现，File 用例 rootDir 实值不回显；EC10 委托模型 committed:true 公共面自洽锚 |
| AC8 | 通过全量 typecheck/test 与 Node 20/24 CI | ✅（本地门槛） | 总控亲跑：`pnpm test` = 102 文件 1223 passed / 0 failed（exit 0，含 vitest typecheck no errors）；`pnpm typecheck` = 八包 tsc exit 0；persistence 94/94 在 Node 24 ×5 连跑 + Node 20.20.2（docker 非 root）×1 全绿、0 unhandled errors；SA7 DOMException 探针三版本实测。**Node 20/24 CI 矩阵属外层门禁**（Host 发布后 ci-watch 核对），本地证据已双版本覆盖 |

## 结论

**AC 8/8 全 ✅，无 ❌ 条目。** 评审双清达成（SA4 pass + SA7 pass，verdict 与各自报告顶部逐字一致）。可进入提交 + 双轴终审 + 完成事务。

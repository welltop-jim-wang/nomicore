# AC 门禁（Round 2）— issue #134 修订轮：PR #146 评审 12 项逐条核对

- **日期**: 2026-08-28
- **基线 diff**: `4cfaffd..HEAD`（round-2 全部变更：8a68d82 SA3 实现 + 2a7117a M-1 文字收口 + 9cfc1b6 SA6 同步 + 1e2c748 设计 R2.2.1 + 1128ef7 F-1 补锚）
- **门禁输入**: 评审 12 项（round2.md 简报逐字收录）；设计 R2.2.1；SA2 pass（R2.1 + R2.2 两轮）；SA4 pass（F-1 回流闭合）；SA7 PASS（0 契约缺陷）
- **判定方法**: 每项核对「修复落位 + 回归测试锚 + 文档登记」三面；证据均可在 worktree 复核

## 阻断项（1–5）：全部修复 + 回归测试

| # | 评审要求 | 处置 | 证据 | 结论 |
|---|---|---|---|---|
| 1 | Epoch fencing 立即停止旧 session outbound fanout | **修复**：bump 槽 E5.5（同步投影步）`fanout.fenceStale(id, epoch)` 主动 fence——旧 session finalize('conflicted') + detach + 取消未投递排队项（bump 自身 META 写对旧 session 零投递，F-3）；与 apply 槽 R2 被动 fence 共用同一 finalize | 代码：replication-write.ts E5.5' / replication-session.ts fenceStale/finalize；测试：runtime round2-red #1（bump 后零投递）/#2（conflicted 可观测）/#3（apply A→bump→apply B FIFO）；registry round2-red #1/#2/#3（Lease 面同款 + 再 open）；SA3 包内 fenceStale 谓词/排队项取消/双 channel 正反锚；ADR：修订节 D-2a 增补 | ✅ |
| 2 | Runtime close 终止并摘除现存 sessions | **修复**：close() 同步段（lifecycle 翻转后、barrier 入队前）`fanout.terminateAll('runtime-close')`——终态 `closed` + detach + 排队项取消；closedBy 记账使后续 apply 拒 `RUNTIME_WRITE_DISABLED`（#93 第 (4) 类域，round-1 两码锚零改动保持绿）；已接纳 apply 槽无条件排空（ADR 0008 L93/L179） | 代码：runtime.ts close 段 / replication-session.ts terminateAll；测试：runtime round2-red #4（终态）/#5（零投递）/#6（在途 apply 先于 barrier 排空 FIFO）；registry round2-red #11（shutdown × in-flight）；SA3 包内 terminateAll 锚；ADR：修订节 D-2b 增补（含 closedBy 码映射——SA8 R-3' 经 SA4 核验） | ✅ |
| 3 | 复制 subscriber 不得同步阻塞 write sequencer | **修复**：observer 内只做回声抑制谓词 + 容量检查 + owned bytes 复制（`update.slice()`）+ 入队 + 调度泵；listener 调用全部移出 transaction 栈——每 channel 有界队列（容量 16 冻结常量）+ 自延伸微任务泵（每项投递前让步 20 微任务，双向 load-bearing）；溢出丢弃新项 + 置 sticky `needsResync`（ADR 0010 L113 字面落地）；交付集 at-least-once 语义明文冻结（§4.2 要点 8） | 代码：replication-session.ts createSessionFanout/schedulePump；测试：runtime round2-red #7（慢 listener 400ms 自旋不阻塞 mutateRoot 槽）/#8（不阻塞 apply 槽与后续槽）/#9（溢出可观测 + 突发零阻塞）；SA3 包内泵/队列 9 锚 + 交付集语义 ×2；SA7 实测：写/apply 槽 1–2ms 不被 400ms 自旋阻塞、red #9 forks 满载 ×3 最坏 202ms<400ms | ✅ |
| 4 | 受保护字段内容投影相等支持允许结构值 | **修复**（SA8 放行路径 a）：`protectedPrimitiveEqual` 替换为 `protectedValueEqual`/`deepEqualPlain`/`projectOf` 规范化深比较——白名单 = plain array/object（yjs 原样存储形态）∪ Y.Map/Y.Array（显式容器），toJSON 递归投影 + 键序无关/数组有序/SameValue；契约外容器（Y.Text 等）与非 plain 实例保守拒；META 值域零收窄（ADR 0008 L31 红线未触） | 代码：replication-session.ts §5.1 实现；测试：runtime round2-red #10/#11（object/array 存量 ROOT-only 放行）/#12（真改仍拒）+ SA3 包内规则矩阵（键序/数组序/NaN/-0/Y.Text 拒/跨形态拒/嵌套放行/Date/undefined/bigint/豁免四型）；ADR：修订节 D-3（M-1 修正后口径一致） | ✅ |
| 5 | Lease release 不得因 session seam 抛错半释放 | **修复**：doRelease 不先查状态——① released 标记 ② entry 删除 ③ releasePromise 缓存 + observer（均无 seam 依赖）先于 ④ 无条件幂等直调 `activeSession.close()`（同步 throw try/catch 隔离 + `Promise.resolve(closing).catch` 原生同化异步敌意）→ ⑤ `onReleased` 无条件到达（half-release 结构性不可达） | 代码：lease.ts doRelease；测试：registry round2-red #4（getStatus 抛错）/#5（close 抛错）/#6（终态仍直调）三红转绿；SA7 可选直构：六型敌意 close 下 release 恒绿 + onReleased 恰一次 + unhandledRejection 总计 0 | ✅ |

## 需要明确并验证（6–8）：全部明确 + 验证

| # | 评审要求 | 处置 | 证据 | 结论 |
|---|---|---|---|---|
| 6 | applyUpdate 异常 committed 标记诚实 | **修复（精确二分，无需保守过报）**：R5 内挂 beforeTransaction 探针（槽内注册恒为最后 listener）——`txStarted=false` ⟺ 事务函数从未执行 ⟹ `committed:false`；`txStarted=true` ⟹ 保守 `committed:true`（L84 过报方向）；复合敌意例外 + under-report 方向明文登记（D-4） | 测试：runtime round2-red #13（beforeTransaction 抛错 → committed:false + 零变更）/#14（afterTransaction → committed:true 绿锁定）+ SA3 探针卸载/message 渲染锚；SA7 R-1' 复核 11/11（yjs 13.6.32 源码 + 行为双源）；ADR：修订节 D-4 | ✅ |
| 7 | 空/重复 no-op update 状态语义明确 | **明确为「成功接纳即置位」**（SA8 放行方向，当前实现即满足——零代码改动）：明文规范入 ADR 修订节 D-4 + runtime README 第 8 条 | 测试：runtime round2-red #15/#16 绿锁定（重复/空效果 update 成功 apply 后置位不回落）；ADR 文字落盘经 SA4 核验 | ✅ |
| 8 | 生产 Cordis plugin peer role 装配缺口 | **修复（贯通路）**：plugin config `role` 键 + 校验序（①形状→②键集→③role 域 `NAMESPACE_REGISTRY_ROLE_INVALID`→④idleTimeoutMs）+ apply 透传；**并修复生产工厂 `createNamespaceRegistry` 漏转发 `options.role` 的第二根因**（SA1 实证 registry.ts L1333-1339）；README + 装配测试 | 代码：plugin.ts/registry.ts/types.ts；测试：registry round2-red #7（config 接受 role）/#8（非法值 ROLE_INVALID）/#9（peer 装配 + 本地 replaceSchema 以 REPLICATION_ROLE_PERMISSION 拒）三红转绿；registry-plugin.test.ts 文案同步 | ✅ |

## 测试与文档收口（9–12）：全部完成

| # | 评审要求 | 处置 | 证据 | 结论 |
|---|---|---|---|---|
| 9 | AC7 竞态矩阵七场景补齐 | **补齐**：SA6 盘点（round2_sa6_red.md §5）——既有覆盖 3 场景（session close/真实 idle expiry/committed fatal），本轮补 4 场景（accepted apply→Lease release #10 绿锁定、Runtime close #11、epoch bump #12、Registry shutdown 经 #11 联动） | registry round2-red #10/#11/#12；SA7 fence/terminate 活链路 18/18 | ✅ |
| 10 | owned bytes 测试直存原始参数断言 | **加严**：round-1 两文件 listener 内 `u.slice()` 先复制后断言全部改为直存 callback 原始参数 + 断言数组互异/byteOffset=0/全幅/buffer 不共享（52 用例全绿零回归）；round-2 red #17 绿锁定同口径 | diff 9cfc1b6 前 SA6 改造（runtime-replication-session.test.ts + registry red 文件）；SA7 两级副本独立性复核 | ✅ |
| 11 | 两包 README 更新 | **落盘**：runtime README 新增「ReplicationSession（内部宿主）」节（8 条：宿主/能力面/trusted raw 例外/异步投递+needs-resync/degraded apply/生命周期边界等）+ Lifecycle 增补；registry README Public API ReplicationSession 5 条 + Plugin configuration role 文档 | 两 README diff；SA7 冒烟在场核验 | ✅ |
| 12 | PEER_ALLOWED_META_KEYS 删除/实用 + seam 类型收敛 | **删除**（零外部引用 grep 复核；空集是 ADR 0010 L253 语义冻结非代码占位义务——注释如实登记）；seam 类型收敛 = Equal 锁格架保留（两点同步 + 编译器强制——R2.1 §13.2 方案，status 第 11 字段 `needsResync` 经该格架两点同步演示） | replication-session.ts L329 注释；types.ts L388 needsResync；lease.ts/registry.ts Equal 断言锁编译期绿 | ✅ |

## 流水线门禁链（round 2）

- SA8 前置门禁 **clear**（12/12 no-conflict + D-1..D-4 登记义务）→ SA8 设计复审 **clear**（C-1'/C-2' 放行条件全部兑现并经 SA4 核验；R-1'..R-4' 残留全部闭合：R-1'/R-2' SA7 实测、R-3'/R-4' SA4 核验）。
- SA2 攻击评审：R2 **reject**（HIGH+MEDIUM 窄门）→ R2.1 **pass** → R2.2（SA3 偏离/发现裁决后）**pass**（M-1 文字必修已闭合）。
- SA4 静态验尸：首轮 **reject**（F-1 窄门：规则表两行锚缺位）→ F-1 回流（SA1 措辞收窄 + SA3 补锚 + SA2 更正）→ **pass**。
- SA7 动态验证：**PASS**（0 契约缺陷；N 级表征 4 条登记不阻断）。
- 非目标零越界：DENY LIST 零触碰；公共面（Runtime 十二键/index 一键/internal 两键/session 十键 Equal 锁）零突破；版本 bump 恰 version 字段（0.1.10/0.1.6）。

## 遗留事项（全部登记归属，不阻断）

- SA7 §十 N 级表征 4 条（跨 channel 墙钟交错、Proxy 种子延迟域、RAW_UPDATE_INVALID 码语义面向、突发弃新计数）——记录在设计 §18/SA7 报告，属知情接受。
- SA2 N'-1..N'-4 纳米备注、SA4 纳米备注（SA2 更正文本漏 symbol 一型）——记录在案。
- needs-resync 的消费面（transport reset/bootstrap 清零路径）属切片 6（ADR 0010 L151 域分界维持）。

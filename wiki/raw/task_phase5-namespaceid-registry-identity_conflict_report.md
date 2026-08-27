# 冲突门禁报告

- 被审对象：`wiki/raw/task_phase5-namespaceid-registry-identity.md`（前置门禁，任务简报，issue #131，round 1）
- 冲突基准：`docs/adr/` 0001–0010 全集（10 份，逐个全读）+ `CONTEXT.md`；`docs/phases/phase-5-websocket-replication.md` 为任务声明的补充设计基准（交付计划，非 ADR，不单独构成阻塞依据）
- 审查日期：2026-08-29（SA8 前置门禁，run_id issue-131-1787792522-3529662）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（2026-08-19 修订节） | 否 | 无冲突（schema/方言主题，本任务不触及） |
| 0002 | 重写定位、authority 出范围 | accepted | 否 | 无冲突 |
| 0003 | 求值器与派生 schema | accepted | 否 | 无冲突 |
| 0004 | vfsl-protocol 类型投影 | accepted | 否 | 无冲突 |
| 0005 | 投影生成管线 | accepted | 否 | 无冲突 |
| 0006 | 持久化插件与 owner 分区 | accepted（含 #64/#79 修订节） | 是 | 无冲突：owner 分区、`createDoc` 排他创建/`DOC_DUPLICATE`、`META.docId` 校验、安全文法、v1 无 list 均被任务遵守且不需改动（AC-2/AC-5/AC-6） |
| 0007 | 逻辑验证与 Yjs bridge | accepted（Runtime/open/read 条款由 0008 部分取代） | 否 | 无冲突（余留有效条款属校验层，本任务不触及） |
| 0008 | Runtime 读写能力与单序列器 | accepted（含 #93 稳定码修订） | 是 | 无冲突：Runtime 冻结投影 `owner.userId`+`namespaceId` 的条款与 AC-4「project owner」一致 |
| 0009 | Registry、租约与 Host 生命周期 | accepted（**Registry identity 条款被 ADR 0010 显式修订**） | 高度 | 无冲突：被 0010 修订的三处条款（entry key / create 输入含 namespaceId / duplicate 映射）以 0010 为准，任务与 0010 逐句一致；其余条款（lifecycle 串行、lease、fatal、shutdown、测试 seam）任务均遵守 |
| 0010 | Hub/Peer 复制与最终一致 | accepted | 高度 | 无冲突：本任务是「Namespace identity、owner 与复制范围」节的直接实现票，AC-1..AC-5 与该节及 §取代与关联逐句对应 |

## 冲突点

无 hard-violation、无 override-declared、无 evolution。以下为逐条对照后判定为 no-conflict 的关键张力点（留档供复核）：

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | 中 | ADR 0009「Registry key 是 `(owner.userId, namespaceId)`」 | AC-3：lifecycle serialization 与 Runtime reuse 仅按 namespaceId | no-conflict | ADR 0010 §取代与关联显式修订：「本 ADR 修订 ADR 0009 的 Registry identity：entry key由`(owner.userId, namespaceId)`改为仅namespaceId」。任务实现的是最新已接受决策，非未声明演进 |
| 2 | 中 | ADR 0009「create 输入只包含 owner、namespaceId、schema 和完整 logical ROOT」 | AC-1：普通 create 不接受调用方 namespaceId | no-conflict | ADR 0010：「普通 `Registry.create()` 不再接受调用方指定 namespaceId」——同一显式修订节内 |
| 3 | 中 | ADR 0009「active、idle、并发或 persisted duplicate 统一映射为 `NAMESPACE_ALREADY_EXISTS`」 | AC-2：碰撞内部重试至多 8 次，耗尽 `committed:false` Registry fatal | no-conflict | ADR 0010：「撞到当前 Registry entry 或目标 Persistence duplicate 时最多重试 8 次，耗尽以 `committed:false` Registry fatal 失败」+「复制 bootstrap 使用内部受信任导入保留 Hub namespaceId，不是普通 create」——普通 create 的 duplicate 面被 0010 重试语义取代 |
| 4 | 低 | ADR 0009 fatal phase「初始 phase 是：runtime-construction / create-document-internal / lifecycle-slot-internal」 | AC-2 需要新的 ID 生成耗尽 fatal phase | no-conflict | ADR 0009 明言「**初始** phase 是」（开放清单）；ADR 0010 已裁决耗尽 fatal 存在。新 phase 命名属任务内授权的 SA1 设计点，非 ADR 修订 |
| 5 | 低 | ADR 0009 Registry plugin 依赖清单（Timer/Clock/Persistence，缺失响亮失败不 fallback） | AC-1「injected 128-bit CSPRNG」+ phase 切片 1「核心不得直接调用不受控全局crypto」 | no-conflict | 依赖集合扩展由 ADR 0010「由注入的受控 128-bit CSPRNG 生成」授权；注入纪律沿用 0009 既有条款模式 |
| 6 | 低 | ADR 0006「userId 与 namespaceId 共用安全文法 `^[a-z][a-z0-9-]{0,62}$`」 | AC-1：生成 `ns-`+32 小写 hex | no-conflict | 生成的 ID 共 35 字符，首字符 `n`，字符集 `[a-z0-9-]`，满足文法，可直接作目录/META/REST path/WS room |
| 7 | 低 | ADR 0006「存储按用户分区，namespaceId 在用户目录内唯一」+「v1 不提供 list」 | AC-5：Persistence 继续 owner 分区、不加跨 owner catalog | no-conflict | 与 ADR 0010「Persistence 不维护跨 owner 全局 catalog或原子唯一约束」及 0006 原文一致；概率全局唯一由 Registry 生成策略承担，存储层无全局唯一承诺（CONTEXT namespaceId 词条 Avoid 项） |
| 8 | 低 | ADR 0006 #64 修订：`createDoc(owner, docId, doc)` 排他创建、`DOC_DUPLICATE`、duplicate 路径绝不覆盖 | AC-2：以 target-owner Persistence duplicate 为再生成信号 | no-conflict | Persistence 契约零改动；Registry 消费 duplicate 错误信号后换 ID 重试，不进入写路径，与「绝不覆盖已提交内容」一致 |
| 9 | 低 | ADR 0009 Open「invalid identity、not found…使用窄 `OpenNamespaceIssue`」 | AC-4：owner mismatch 返回既有 not-found 结果 | no-conflict | ADR 0010：「不匹配统一返回 `NAMESPACE_NOT_FOUND`」+「owner mismatch不泄露存在性」——复用既有稳定码，无新公共面 |

## 结论

**Verdict: clear。** 任务简报的全部要求（AC-1..AC-7）是 ADR 0010「Namespace identity、owner 与复制范围」节及其对 ADR 0009 的显式修订的直接实现，无一处需要新的 override 或构成未声明的 ADR 演进；ADR 0006/0008 的有效条款均被遵守且不需改动。总控可放行，SA1 可直接进入设计。

留档观察（不阻塞，供总控/SA1 参考）：

1. **范围观察**：phase-5 切片 1 还含 `META.replicationId`/`replicationEpoch` 投影与 Hub 管理操作（`enableReplication()`/`bumpReplicationEpoch()`），本任务 AC 未包含——属总控拆片决定，非冲突；相关决议文档已收录 ADR 0010 复制身份边界条款（bootstrap 受信任导入≠普通 create）防止后续切片误用普通 create。
2. **文档卫生观察**：ADR 0009 状态行未标注「Registry identity 条款由 ADR 0010 修订」（对比 ADR 0007 的「由 ADR 0008 部分取代」标注惯例）；修订本身已在 ADR 0010 §取代与关联正式声明，构不成冲突。AC-7 的对齐对象是 implementation-facing docs 与 package contracts，不要求改 ADR 正文；是否为 ADR 0009 补状态标注属 owner 文档决策，超出本门禁职权。
3. **设计注册点**：新 fatal phase 命名、`NAMESPACE_ALREADY_EXISTS` 对普通 create 不可达后的错误注册表处理、随机源 capability 注入纪律——三项均已列入相关决议文档「事实性提示」，属 SA1 设计职权内。

Verdict: clear

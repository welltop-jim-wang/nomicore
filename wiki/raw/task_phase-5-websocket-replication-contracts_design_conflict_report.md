# 冲突门禁报告（设计后复审）

- **被审对象**：SA1 设计 `wiki/raw/task_phase-5-websocket-replication-contracts_design.md`（Issue #172，R1，509 行）
- **冲突基准**：`docs/adr/` 全部 10 份 ADR（逐个全读，无抽样）+ 根 `CONTEXT.md`。代码、`docs/phases/`、wiki 其他文档不构成自动阻塞依据；`docs/protocols/instance-replication-v1.md` 经 ADR-0010 L151 明文让渡（「……backpressure和完整时序以`docs/protocols/instance-replication-v1.md`为唯一wire contract」）作为 ADR 锚点的延伸核验面读取。
- **配套产出**：`wiki/raw/task_phase-5-websocket-replication-contracts_relevant_decisions.md` 已追加「设计后复审追加」节（D1–D7/C2 新决策点摘录，供 SA2/SA3/SA7 复用）。
- **复审性质**：轻量设计后复审——只裁设计与 ADR/CONTEXT 决策一致性；设计优劣属 SA2，实现质量属 SA4/SA7。

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（含 2026-08-19/08-21 修订节） | 无关（schema 真相源域；设计仅触及 vfsl 测试头注释 §3.4#20 的权威指向 ADR-0004，正确） | no-conflict |
| 0002 | nomicore 是全新 yjs-server 重写，authority 出范围 | accepted | 无关（仓库定位域） | no-conflict |
| 0003 | 求值器与派生 schema | accepted | 无关（Phase 0b 域） | no-conflict |
| 0004 | vfsl-protocol 类型协议包 | accepted | 边缘（设计 §3.4#20 把 vfsl 测试头权威指向改指本 ADR——纯注释改写，方向正确） | no-conflict |
| 0005 | 投影生成管线 | accepted | 无关（Phase 1 生成域） | no-conflict |
| 0006 | Cordis 持久化插件 | accepted（含 #64/#79/#131/#133 修订节） | 边缘（设计 C1 切片 2 行陈述 importDoc/archiveDoc/probe 交付状态，引 ADR-0006 #133 修订节，措辞一致；DENY LIST 保护 `packages/persistence/**` 零改动） | no-conflict |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（open/read 条款由 ADR-0008 部分取代） | 边缘（设计 §3.4#5-#9 把 doc-runtime 源文件头注释权威指向改指本 ADR/ADR-0008——纯注释，被取代条款不在触碰面） | no-conflict |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含 #93/#132/#134 修订节） | 边缘（设计仅改 `replication-session.ts` 头注释权威指向 ADR-0010 #134 修订节；#132 冻结词汇零触碰） | no-conflict |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted（含 #131/#134 修订节） | 边缘（设计不动 Registry 面；C1 切片 8 陈述 Registry 侧 resetReplica 已交付，与 #134 修订节一致） | no-conflict |
| 0010 | Hub/Peer WebSocket Y.Doc 复制与最终一致 | accepted（含 #134/#133 round-2/#161 修订节） | 高度相关（设计全部裁决落在其管辖域） | no-conflict：设计是**执行** ADR-0010 的权威归属与 #161 冻结值，而非修订任何条款（逐项见下） |

无任何 ADR 处于整体 superseded 状态；ADR-0007 仅有 open/read 条款被 ADR-0008 取代，且不在设计触碰面内。

## 冲突点

**0 条。** 裁决分布：no-conflict 10 / override-declared 0 / evolution 0 / hard-violation 0。

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | — | （无冲突点） |

### 设计决策 ⇄ 基准条款逐项对照（正面依据）

| 设计决策 | 基准条款（原文） | 对照结论 |
|---|---|---|
| **D1** G1 字段收敛：`maxQueuedControlBytes` 缺省 8 MiB、构造期链式下界 `≥ maxBootstrapBytes + 协议开销`（TypeError、不运行时 clamp）、耗尽 `CONNECTION_BACKPRESSURE` close 1011、记账判据换读新字段 | ADR-0010 #161 修订节：「控制独立保留额度 maxQueuedControlBytes 缺省 8MiB」「1011 终止」；protocol §17：「缺省 8 MiB；必须 ≥ `maxBootstrapBytes` + 协议开销」「耗尽为 `CONNECTION_BACKPRESSURE`（close 1011）」「配置启动时响亮验证……不得运行时 clamp」（校验块 L504 逐字核验） | 设计收敛方向 = 向冻结值对齐（改代码不改冻结值），正是前置门禁提示 1 要求的方向。no-conflict |
| **D1-a** 缺省 8 MiB ≥ 缺省 `maxBootstrapBytes` 4 MiB + 128 | 同上链式下界 | 缺省组合天然合法（8,388,608 ≥ 4,194,432）。no-conflict |
| **G2/G3/G4/G5 偏差延后**：checkpoint 公式、hub pong close(1001)、CLOSE_OK 关联 `ACK_STATE_VIOLATION`(1002)、GOAWAY drain 静默窗口、hub 停机先发 GOAWAY → 分别登记 #169/#170/#171，锚以 `it.fails` 保留 | protocol §17「水位检查点间隔 = `max(1, floor(ackTimeoutMs / 100))`」、§18「pong 超时按临时失败处理：关闭传输（close code 1001）」、§10.2+§13.1「Unknown……的 ackedSequence 属 connection fatal `ACK_STATE_VIOLATION`」（1002）、§6.3「收到 GOAWAY 后停止 OPEN，不开始新 sync round」、§21 第 1 步「replication停止接纳连接/target并发送GOAWAY」；ADR-0010 L147「gap、repeat或错误ACK关联关闭连接」、#161「peer pong 超时 close(1001)」「GOAWAY……相对drain timeout」 | 设计**未改写任何冻结值**，也未删除/弱化锚——偏差按任务简报「用途归口」节显式登记为 known gap（§3.3 C1 状态表 + it.fails 期望红）。交付状态登记 ≠ 契约修订。no-conflict |
| **D3** hub 停机 GOAWAY 归属 ws-replication 包（#171），非 #164 composition 边界 | protocol §21 第 1 步主语「replication」；ADR-0010 L179「停止顺序为：**复制插件**停止接纳连接/target……」；ADR-0010 L171-175 把 GOAWAY/背压/observer 归 `@nomicore/ws-replication` 包职责，`apps/yjs-server` 只做编排 | 无任何 ADR/protocol 条款把 GOAWAY 发送指派给 composition root；设计读法与 §21 主语一致，且按任务简报要求显式标注而非静默删锚。no-conflict |
| **D5** 记账口径：暂停段出站 control 实编码字节累计 = 「按 socket 缓冲内未冲刷控制字节计」的保守上界代理（偏高估计 → 偏向提前 1011） | protocol §17「额度按 socket 缓冲内未冲刷控制字节计」；ADR-0010 #161「控制独立保留额度 maxQueuedControlBytes 缺省 8MiB」 | 见下「重点裁决说明 1」——冻结值与耗尽语义零改写、偏差方向保守（fail-safe）、经 C2 走 ADR append-only 正式登记路径。no-conflict |
| **D6** 去权威化：wiki/raw 仅历史证据；src/测试头权威指向改指 ADR/protocol/CONTEXT | ADR-0010 L151 让渡条款（protocol 为唯一 wire contract）；docs/AGENTS.md Authority：「Historical `wiki/raw/` artifacts are evidence, not normative contracts」 | 无任何 ADR 授予 wiki/raw 权威地位，移除相关表述无条款可违（与前置门禁结论同向）。no-conflict |
| **D7** protocol 文档、CONTEXT.md、replication-protocol 错误注册表零改动；`PONG_TIMEOUT` 入册与否归 #170 | 前置门禁提示 1（冻结值不得以代码现状改写）；CONTEXT.md 词汇面 | 设计拒绝预写 #170 的设计决定 = 「不发明未实现行为」的执行。no-conflict |
| **C2** ADR-0010 append-only 追加「issue #172 修订」节 | 任务简报要求 2 明文授权「Reconcile …… ADR-0010 ……」；本仓 ADR 修订惯例 = append-only 修订节（#134/#133/#161 同款），非 supersede | 见下「重点裁决说明 2」。no-conflict |
| **C1** phase 文档插入「交付现状与边界」节（current contract / known gap / planned fix 三分） | ADR-0010 L167/L171-175（observer、apps/yjs-server 为目标交付物）+ #133 round-2 修订节（resetReplica 现行有效文本） | 交付状态报告，不改目标契约；resetReplica 陈述以 #133 round-2 修订节为准（正文 L57 旧次序不引用），执行前置门禁提示 3。no-conflict |
| **D2** 8 条延后锚 `it.fails` 注册 | 无 ADR 条款管辖测试注册机制（基准外）；ADR-0010 §22 conformance 面不受净减（断言体逐字节不动） | 基准外事项（机制优劣属 SA2）。no-conflict |
| **D4/D4-bis** fixture 合法化（追加 `maxBootstrapBytes: 1_024`）与真实 TCP 测试显式额度迁移 | ADR-0010 L165「以下上限均为插件配置并提供安全默认值」 | 显式小额度配置是协议允许的插件配置用法；1_024 ≥ 实测快照 345B 满足既有 `maxBootstrapBytes ≤ maxFrameBytes − overhead` 校验。no-conflict |
| **词汇纪律**（C1/C2/全文） | CONTEXT.md 各词条 _Avoid_ 列表 | 全文 grep 核验：零 master/slave/leader/follower；零 durable 虚假声明；Hub/Peer/复制谱系/代际/ReplicationSession/replication-unvalidated 用法与词条一致。no-conflict |

### 重点裁决说明（三处边界判断的依据）

1. **D5 代理口径 ≠ evolution**。判定链条：(a) 冻结值（字段名/8 MiB/下界/1011）与耗尽语义零改写——被审对象改的是「如何观察」而非「契约是什么」；(b) 偏差方向为保守上界（偏高估计 → 提前触发 1011），永不欠触发，不产生「按文档应为 1011 而实现放行」的反向背离；(c) 设计没有绕过声明——口径经 C2 第 1 条写入 ADR-0010 append-only 修订节，即本仓既有正式修订路径（#134/#133/#161 同款），并在代码注释现场显影。三项合取 ⇒ 不落入「意图修订决策但未走正式声明」的 evolution 桶。**边界条件**：该 no-conflict 以 C2 第 1 条（含代理口径句）随设计原样落盘为前提——若 SA3/SA2 裁掉 C2 的口径登记而保留代理实现，未登记的实现偏差即变成未声明演进，须回 SA8 复审。
2. **C2 ADR 追加 ≠ 演进**。任务简报要求 2 明文把 ADR-0010 列入收敛对象；C2 自陈「wire 冻结值不变，正文与既有修订节效力不变」，登记内容为收敛事实、口径声明与交付边界——不取代、不修订任何既有条款。这是对 #161 修订节冻结值的**执行登记**，与前序 #134/#133/#161 修订节的性质一致。若后续任何轮次把 C2 改写为修正文/改冻结值，即触发 evolution/hard-violation 重裁。
3. **延后 ≠ 违反**。G2–G5 五组偏差的冻结语义（checkpoint 公式、1001、ACK_STATE_VIOLATION 1002、GOAWAY 静默窗口、停机 GOAWAY）全部原样保留在 protocol/ADR 与 phase 文档目标契约中；设计产出的是「current contract / known gap / planned fix」三分登记 + 可执行锚，恰是任务 AC「Distinguish current contract, known gap, and planned fixes」的执行。任何把冻结值改写为代码现状（8 MiB→64 KiB、1001→1002、公式→固定 1_000ms）的落盘都将落入 hard-violation。

## 结论

**Verdict = clear，0 冲突点，设计后复审放行。** 设计不需要任何 override，也没有需要 Jim 裁决的演进条目。前置门禁的四条提示全部被设计执行：向权威文档+冻结值对齐（D1/D7）、权威不回到 wiki/raw（D6）、resetReplica 以 #133 round-2 修订节为准（C1 切片 8）、词汇纪律（全文核验通过）。

### 门禁提示（非裁决，供 SA2/SA3/总控参考）

1. **C2 与 D5 绑定落盘**：SA3 落地时 C2 修订节第 1 条的代理口径句不得裁剪（见重点裁决说明 1 的边界条件）。
2. **it.fails 属 SA2 评审域**：D2 机制（不区分「因正确原因红」与「因错误原因红」）是设计自登记的弱点，其风险承受判断不属冲突门禁；唯一 ADR 相邻约束是 ADR-0010 §22 conformance 测试面不得净减——8 锚断言体逐字节不动即满足。
3. **SA3 冻结值红线重申**：§3.1/§3.2 的任何落地偏离（如为迁就 fixture 反向调 `PROTOCOL_OVERHEAD_BYTES`、改 protocol §17 文本、把 A3-1 锚改回 1002）= hard-violation，须立即回 SA8。
4. **§5 grep 门禁自洽性已核验**：`docs/` 现状零 `controlReserveBytes` 命中；packages 现有 12 个命中文件与设计 ALLOW 清单逐一对应，改后零命中预期可达成（文件集完备性复核属 SA2/SA4）。

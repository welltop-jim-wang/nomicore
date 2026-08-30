# @nomicore/namespace-diagnostic-log

namespace 诊断变更日志 v1 的语义 emission 接缝、冻结 VFSL record schema 与有界内存
adapter（issue #148 / ADR 0011 / ADR 0012）。

> **定位**：叶子 observability 模块——从 namespace 创建开始尽力记录所有变更尝试及其
> 结构化结局的可选诊断流；**不构成 Persistence 真相源**（ADR 0011 §Interface），
> 日志不参与业务提交、不承诺完整性或恢复能力。
> _Avoid_: 审计账本、WAL、event sourcing、可靠恢复日志（ADR 0011 _Avoid_ 清单）。
> 消费方 [`@nomicore/namespace-runtime`](../namespace-runtime)、
> [`@nomicore/namespace-registry`](../namespace-registry) 与复制路径（#149/#150/#151 接线）。

## 公共 API 速览

```ts
import {
  createBoundedMemoryDiagnosticLog,   // emitter + sink 一体装配（本票交付物）
  createDiagnosticChangeEmitter,      // 可复用语义管线（#152 复用，只换 sink）
  getRecordSchemaCompilation,         // 冻结 schema 编译（指纹单源）
  RECORD_SCHEMA_ENVELOPE,             // 恰四键深冻结信封（#152 manifest 内嵌）
  observedAtFrom,                     // producer 侧 Clock 兼容 helper
} from '@nomicore/namespace-diagnostic-log'

const log = createBoundedMemoryDiagnosticLog({
  inputPolicy: 'digest',   // 默认 'digest'（ADR 0011）
  issuesPolicy: 'full',    // 默认 'full'
  updateCapture: false,    // committed Yjs update 捕获默认关闭（ADR 0011 §数据保护）
})

// producer 提交语义 emission（同步、不 throw、不阻塞；所有权移交后不得再变异）
log.emitter.emit({
  operation: 'root-mutation',
  stage: 'transaction',
  observedAt: observedAtFrom(() => Date.now()),
  source: { kind: 'local' },
  input: { snapshot: { /* 操作已生成的同一份 detached frozen plain-data 快照 */ } },
  result: { kind: 'committed', effect: 'update', updateBytes },
})

log.records()      // 冻结引用数组（sequence 升序；含 streamId/sequence/recordKind 的最终 record）
log.stats()        // accepted / dropped by reason / dropped by operation×reason / queueDepth / lastSequenceAssigned
```

`@nomicore/namespace-diagnostic-log/testing`（确定性 RandomSource、事件收集型
observer、final-record 直通注入、自定义 envelope 工厂、sequence 预置工厂与纯 helper）——
仅测试可用性服务，不是产品面。

## 配置（DiagnosticLogConfig，全部带默认）

| 键 | 默认 | 说明 |
|---|---|---|
| `inputPolicy` | `'digest'` | `none` / `digest` / `redacted` / `full`（ADR 0011 输入捕获） |
| `issuesPolicy` | `'full'` | `none` / `full` / `redacted`（issues 统一投影策略） |
| `updateCapture` | `false` | committed update 捕获（Host 明确启用，ADR 0011 §数据保护） |
| `lineBudgetBytes` | `1 MiB` | 最终 record 紧凑 JSON UTF-8 字节硬上限（不含结尾 `\n`） |
| `payloadMaxBytes` | `64 MiB` | 单个 update payload 字节硬上限（≤ uint32） |
| `capacity` | `1024` | 内存队列容量（条数） |
| `observer` | — | 低基数健康观察者（同步；故障经 fallbackLog 隔离） |
| `fallbackLog` | `console.error` | observer 故障的单行稳定码 fallback logger |
| `randomSource` | `node:crypto` | CSPRNG 注入接缝（仅 streamId/attemptId 用途；测试注入确定性源） |

## 容量与预算上界

- **驻留上界**：`capacity × lineBudgetBytes`（每条已接纳 record 必过 line 预算；
  最坏 ≈ 1024 × 1 MiB ≈ 1 GiB）。按业务调整 `capacity`/`lineBudgetBytes`。
- **line 预算顺序**（ADR 0012 §投影）：超限先降级 input（full/redacted → digest +
  `degraded:'projected-input-too-large'`）；仍超限则丢弃整条 record 并健康上报，
  不影响业务。无 sidecar 环境大 update（Base64 后超预算）必走丢弃分支
  （`§10-J9` 备案；#152 文件 adapter 的 sidecar 天然免除该分支）。
- **超预算更新**：超 `payloadMaxBytes` 的 update 转
  `update-omitted` + 稳定 reason（见 AGENTS.md 词表），attempt metadata 保留。

## File adapter（issue #152：ADR 0012 §File adapter）

```ts
import { createFileDiagnosticLog } from '@nomicore/namespace-diagnostic-log'

const log = createFileDiagnosticLog({ rootDir, namespaceId: 'ns-…', updateCapture: true })
log.emitter.emit(/* 同一语义 emission */)
```

### 磁盘布局（{rootDir}/namespaces/{namespaceId}/…）

```text
current.json                        # 恰三键 locator；temp + rename 原子替换（仅保存 format/version/streamId——可重建 locator 而非完整性证明）
streams/{streamId}/manifest.json    # 不可变（'wx' 创建；17 键——含冻结 VFSL 四键信封 + 三 roll targets；14 键 legacy 产物可读不可续写）
streams/{streamId}/segments/00000001.jsonl   # JSONL record（UTF-8、无 BOM、\n 结尾）
streams/{streamId}/segments/00000001.bin     # NDCL v1 25-byte frame + payload（首 sidecar 时惰性创建）
streams/{streamId}/segments/00000002…        # 滚动 segment（#153；8 位定宽十进制、JSONL/BIN 成对、无「关闭标记」文件）
```

- `streamId` = `log-` + 32 位小写 hex（CSPRNG；注入随机源可确定性复现）。
- 同步写契约：emit 返回 = 字节已入文件；每 emit 至多一条 final JSONL record 的有界
  同步 append（sidecar 则 BIN-first 至多一帧），无队列、无 batch、**无 fsync**
  （ADR 0012 「真正 fsync 可配置且默认关闭」——本适配器不暴露开关）、无常驻 fd；
  「有界」只指数据量/操作数受 payload/line 预算与单 record/单帧限制，**不承诺磁盘
  延迟上界**。同步 append 完成不构成 fsync 或掉电持久性承诺。属 **best-effort**
  诊断流：崩溃/断电可留下最后一条不完整行或孤儿帧（ADR 明文允许），
  **#153 起构造期自动修复三类「可证明尾部」**（不完整尾 JSONL 行 / 不完整尾 frame /
  完整未引用尾 orphan frames——见下「reopen 与尾部修复」）；中间损坏一律不修复，
  由 strict reader 诚实判定。
- **write-slot 接线纪律（ADR 0012 amendment MUST）**：File adapter `emit` 同步且可能
  阻塞——任何接入 namespace 生命周期的调用点必须位于 NamespaceRuntime write
  sequencer slot 之外或该 slot 释放之后；slot 内执行同步 File adapter emit 为不合规
  （接线归 #149–#151/#155 等票）。**该纪律同样覆盖构造期**（#153 起构造含 reopen
  健康证明与尾部修复的全部同步 fs 操作，O(stream 总字节)）——Host 必须在 slot 外
  构造 adapter。
- R2 提交点纪律：definitive pre-commit append 失败（open 期 EISDIR/EACCES/ENOENT，
  零字节可证明）复用同一 sequence candidate 恢复；ambiguous outcome（write 期失败等）
  保守封闭旧 generation 并保留「sequence N may not be persisted」证据，绝不在旧
  stream 写第二条相同 sequence。
- 每 record 过 line 预算 → VFSL → storage（Base64 canonical / length / CRC /
  sidecar 帧交叉）门后才落盘；sidecar 恒 BIN-first（帧先于 JSONL 引用）。

### 配置（FileDiagnosticLogConfig；内存 adapter 的字段语义相同，另增/覆写）

| 键 | 默认 | 说明 |
|---|---|---|
| `rootDir` / `namespaceId` | 必填 | 日志根目录 / namespace 段（安全文法校验后才进路径；违规 → 不启用 + `stream-init-failed`） |
| `genesisUpdateBytes` | — | 提供 → **新** stream 先尽力写 genesis-baseline（sequence 1）；resume 路径忽略（重写会伪造基线时点） |
| `resumeStreamId` | — | 提供 → 显式续写目标；构造期健康证明通过 → 续写，失败 → 确定性 rotate（`stream-generation-rotated{cause:…}`），绝不静默回退 locator |
| `inlineUpdateMaxBytes` | `4096` | inline/sidecar 分界（≤ 内联，> sidecar；冻结进 manifest） |
| `payloadMaxBytes` | `64 MiB` | 单 update payload 硬上限（守卫取 `min(配置值, 0xFFFFFFFF)`） |
| `targetJsonlSegmentBytes` | `64 MiB` | JSONL segment 滚动 target（≥1 整数；非法 → disabled + `stream-init-failed{reason:'invalid-roll-targets'}`；冻结进 manifest） |
| `targetBinSegmentBytes` | `256 MiB` | BIN segment 滚动 target（同上） |
| `targetRecordsPerSegment` | `100,000` | segment record 数滚动 target（同上） |
| `clock` | `Date.now` | 注入时钟（manifest `createdAt` 与 genesis `observedAt` 同源；异常被构造级 crash 包络收编） |

### reopen、segment 滚动与尾部修复（#153：ADR 0012 §打开现有 stream / §Segment rolling / §打开与尾部恢复）

- **构造期 locator 解析（确定性，禁 wall-clock 猜测）**：`resumeStreamId` 显式优先 →
  `current.json`（format/version/streamId 三键且目标 manifest 存在）→ manifests 扫描
  「恰一候选」恢复 → 空命名空间 fresh → ≥2 候选 **disabled + `stream-init-failed
  {reason:'locator-ambiguous'}`**（零文件写入、绝不猜测）。显式目标证明失败 →
  rotate（不回退 locator）。
- **健康证明 ⇔ 续写**：reopen 时构造期执行全量交叉扫描（与 strict reader 同源的
  manifest 门 / 逐行 VFSL/storage/policy / 跨 segment sequence 连续性状态机）——
  判健康 ⇒ 从 `lastCommittedSequence` 续写（sequence 跨进程可证明地唯一）；
  任一损坏/不兼容/冻结配置改变/14 键 legacy ⇒ **确定性 rotate**：恰一次
  `stream-generation-rotated{cause:…}`（`manifest-missing` / `manifest-invalid` /
  `legacy-manifest` / `frozen-policy-mismatch` / `stream-corrupt` /
  `stream-incompatible` / `repair-io-failure`）+ 新 generation 承接，旧 stream
  永久只读、字节恒等、无数据丢失。
- **三类可证明尾部修复**（仅最大有文件 segment；全有或全无——任何中间损坏 → 零修复
  rotate）：不完整尾 JSONL 行（缺 `\n` → 截到最后 `\n`；全文无 `\n` → 截 0 字节）、
  不完整尾 frame（<25B 残块或合法头 + payload 越界）、完整未引用尾 orphan frames。
  每类逐次上报 `stream-tail-repaired{repair,truncatedBytes}`（`jsonl-incomplete-line`
  / `bin-incomplete-frame` / `bin-orphan-frames`）。修复是续写前置条件：清除残块后
  新帧 fresh-stat 恰好衔接引用链末端（链安全）。
- **segment group 滚动**：任一 roll target（jsonl 字节 / bin 字节 / record 数）达到
  「当前用量 ≥ target」→ 写下一记录前滚入下一 8 位编号 segment（JSONL/BIN 成对、
  惰性创建、无关闭标记文件）；单条合法 record 可让新组超 target（ADR 允许），
  绝不空转滚动。**耗尽 = disabled（丢弃 + 恰一次 `stream-exhausted`），绝不新建
  generation**：segment `99999999` 溢出 与 sequence `UINT64_MAX` 两条路径共用
  exhausted 门闩；reopen 已耗尽的 stream 在构造期再上报恰一次。
- **17 键 manifest**：三 roll targets 冻结进 manifest（创建后不可变）；14 键 legacy
  manifest 仍可读（strict reader 双形状）但不可续写（缺冻结 targets 无法证明续写
  策略一致）。**升级顺序：reader 先于 writer 部署**——新 reader 读写两形状，旧
  reader（0.1.2）只读旧形状；先升 reader 则读写两侧均安全。

#### 运维面（#153 R1 记档）

- **writer 自产「链中 orphan」**：同段已有 committed sidecar 引用后，一次瞬时
  JSONL definitive 故障（`storage-write-failed{stage:'jsonl',code:EISDIR/EACCES/
  ENOENT}`）+ 故障清除 + R2 candidate 复用续写 → 新帧 fresh-stat 跳过孤儿，引用链
  断（strict reader `frame-boundary-invalid`）→ 此后每次重启必然
  `stream-corrupt` rotate（该段历史永久只读、后续日志另起 generation；无数据丢失、
  业务零影响）。**可执行处置（抢时间窗）**：收到 definitive
  `storage-write-failed{stage:'jsonl'}` 事件后、**后续 sidecar append 提交前**尽快
  重启进程——此刻 orphan 仍位于可证明尾部（最后被引用帧末尾之后），重启后 C3
  自动截断、健康续写；期间 inline append 不移动 bin 尾、不破坏该窗口。若后续
  sidecar append 已提交（orphan 已成链中），手工处置不可行，重启按 corrupt rotate。
- **current.json 愈合失败**（`storage-write-failed{stage:'current'}`，temp+rename
  失败）：续写不受影响；未愈合窗口内每次重启会按 locator 权威再次重走证明——
  所指为 rotate 成因流时每次重启铸造一个新 generation 直到某次写成功愈合；期间
  current.json 彻底损坏/丢失 + ≥2 候选 → `locator-ambiguous` disabled。
  **该告警持续出现即处于未愈合窗口，应触发运维处置**。

### retention、读会话租约与 namespace 逻辑删除（#154：ADR 0012 §Retention 与删除）

#### 配置（`FileDiagnosticLogConfig.retention`；仅运行时生效——**不冻结进 manifest、不产生新 generation**）

```ts
log.sweepRetention({ now })            // 显式 sweep：卫生遍历（遗留 .deleting 完成 + orphan BIN）
                                       // → 年龄遍历 → 字节遍历；同步、绝不 throw，返回 RetentionSweepReport
```

| 键 | 默认 | 说明 |
|---|---|---|
| `maxAgeMs` | `30 天`（2_592_000_000） | 年龄上限：组内最晚 `observedAt` 距 now ≥ 该值即过期（含等号）。`null` = 关闭年龄限制；`0` = 一切闭组立即过期（**非无限**，绝不触开组） |
| `maxBytesPerNamespace` | `1 GiB` | 每 namespace 字节上限（JSONL+BIN 跨全部 stream generation 合计）。`null` = 关闭；`0` = 裁掉全部可删闭组 |
| `sweepOnOpen` | `true` | 构造完成后自动执行一次 sweep（`now` = `config.clock.now()`） |

- **值域**：`number` 必须为非负 safe integer；负数/NaN/∞/小数/非数字 → **retention 失活**
  + 恰一次 `retention-config-invalid{field}`，stream 照常工作（配置错不杀死日志能力）。
- **`0` 的非无限语义**：`maxAgeMs: 0` → 每次 sweep 时所有闭组已过期（cutoff = now）；
  `maxBytesPerNamespace: 0` → 字节遍历把「闭组字节」压到 0，下限 = 开组 + 被租约/开组
  阻塞的组。两者皆 `null` → 无限制驱动删除，**卫生遍历仍执行**（协议卫生不属「限制」）。
- **删除资格（AC-2）**：仅**closed + unleased** 的 segment group 可删。闭组 = writer
  当前 `currentSegment` 之前的组（sealed generation 的全部组皆闭）；开组（含 BIN-first
  写帧后、JSONL 提交前的瞬态）任何路径不碰（INV-1）。流内**前缀纪律**：首个不可删组
  即止步该流——幸存组恒为连续后缀，绝不跳洞（INV-2）。
- **删除协议（JSONL-as-commit-marker，跨重启可恢复）**：rename `{seg}.jsonl` →
  `{seg}.deleting`（意图提交点）→ unlink `{seg}.bin` → unlink `{seg}.deleting`。
  JSONL 先行 → 任何中间态都落在 reader 既有合法窗口（bin-无-jsonl），删一半的流永不
  产生 `frame-missing`/`sequence-gap`；崩溃后构造期/下次 sweep 的卫生遍历自动续走
  （`deletingMarkersCompleted`）；orphan BIN（闭组、无 jsonl、无 marker、有 bin）直接
  unlink（开组绝对豁免）。
- **触发点（write-slot 外）**：仅构造期自动一次（`sweepOnOpen`）+ Host 显式
  `log.sweepRetention()`——**绝不挂在 `emit`/`beforeCommit`**（INV-14：每 emit 至多
  一条 record + 至多一帧 BIN 的「有界」纪律）。
- **报告**：`RetentionSweepReport`（sweptStreams / deletedGroups / reclaimedBytes /
  orphanBinsDeleted / deletingMarkersCompleted / leaseBlockedGroups / openProtectedStops /
  failedSteps / retainedBytes / earliestRetained / historyTrimmedStreams）——仅当
  「有动作」时恰一次 `retention-swept` 健康事件（全零动作不发）。

#### 读会话租约（AC-3；短期可续租、过期不阻塞）

```ts
const session = openDiagnosticReadSession({ rootDir, namespaceId, streamId, ttlMs: 15_000 })
session.segments    // open 时刻枚举的 segment 快照（升序；新滚出段不在内）
session.renew()     // 续租（越界 maxLifetimeMs/已 close → false）；默认无总时长上限 = 显式续租模式
session.close()     // 立即释放（幂等）
```

- 租约覆盖 open 时刻快照的全部组；**过期租约永不阻塞删除**（TTL 过即视同无租约，
  AC-3 核心）；已 rename `.deleting` 后的续租不能中止该组删除（marker 即提交点）。
- 注册表**进程内**按 `(rootDir, namespaceId)` 共享（INV-9）——与 adapter 实例无亲缘；
  正确性依赖 ADR 0012「单进程独占根目录」部署约束。裸 `readStreamStrict` 仍是
  静态/离线工具（其契约不承诺与并发 retention 的一致性）；会话包装是受支持的并发读路径。
- **劝告锁语义**：`renew() === true` 不保证快照仍完整（过期窗口内数据可能已被裁剪），
  调用方仍须容忍 ENOENT/裁剪。

#### namespace 日志逻辑删除（AC-4；无 secure-erase 暗示面）

```ts
deleteNamespaceDiagnosticLog({ rootDir, namespaceId })
// → { status: 'deleted', streamsRemoved } | { status: 'absent' } | { status: 'failed', code, step }
```

- 协议（幂等、可重入）：namespaceId 安全文法 → `deletion.json`（temp+rename 原子，
  意图线性化点）→ unlink `current.json`（+ `current.json.tmp` 残留）→ 逐 stream
  `{s}` → `{s}.deleting` → rm（N3 残部直接 rm）→ rm namespaceDir → 释放该 namespace
  的租约分区（全部会话置 closed）。
- **半态门（INV-8）**：`deletion.json` 落盘后，任何构造 → `mode='disabled'` + 恰一次
  `stream-init-failed{reason:'namespace-log-deleted'}` + 零写入——绝不 resume/新建
  generation（删除半态不得复活）；重入 `deleteNamespaceDiagnosticLog` 是唯一完成路径。
  删除完成后重新构造 = fresh 新 lineage（新 streamId + genesis，合法）。
- **只承诺活跃存储的逻辑删除**：不暗示 SSD 削除、备份/快照/对象存储版本回收——结果
  词汇/事件/文档均无 erased/purged/wiped/secure 字样，删除后无 tombstone 残留。
- **前置条件（Host 责任）**：调用时该 namespace 无存活 writer 实例（否则 writer 会
  重建文件树）；v1 不提供 quiesce 钩子——存活 emitter 实例不强制停摆，其后续写入
  随目录删除逐步 ENOENT → definitive pre-commit failure → `storage-write-failed` 事件
  + 记录丢弃（ADR 0011 隔离：日志故障不影响业务）；Host 应在删除后关闭/换装 adapter。

#### 裁剪历史报告与 reader/resume 兼容（AC-5；防「裁剪 → rotate 风暴」）

- `readStreamStrict` 增 `historyTrimmed`（最低幸存段 ≠ `00000001`）与
  `earliestRetainedSequence`（首条可枚举 record 的 sequence；无 record → null）。
  `historyTrimmed === true` 的流：连续性锚以首条身份可解释 record **重定基**，前缀
  跨越**不产生** `sequence-gap`（状态仍 `ok`）；`false` 时行为与现状逐字节等同
  （首 record > 1 的单段流仍判 `sequence-gap/corrupt`——组内行丢失 = 真损坏）。
- resume 侧同款锚容差（§7.5）：裁剪后重开**不 rotate**（无 `stream-generation-rotated`），
  续写 sequence 接续最后幸存记录——否则每次重启都 rotate 新 generation，retention 自毁。
- mid-deletion 态（`.deleting` + bin）从 reader/resume/session 枚举中**整体剔除**
  （jsonl 与 bin 均不可见）——不产生 roll-target-violation/sequence-gap/frame-missing。
- 中段真缺口（段 1、3 在、段 2 无；最低段仍 = `00000001`）仍按 `sequence-gap` →
  `corrupt` / resume rotate——**trim 感知不得弱化既有 gap 检测**（T-E2/T-E3/T-E5 锚）。
- **全裁剪收敛（备案行为）**：闭组删尽 + 开组零记录 ⇒ resume 于空流
  （`currentSegment='00000001'`、seq 自 1）——与「manifest 落盘后首 record 前崩溃」态
  同构；同一 `streamId` 内 sequence 字面量跨裁剪可复用（best-effort 日志无审计连续性
  承诺；ADR 明文禁止持久 retention 状态——earliest retained 恒由扫描重建）。

### 两个声明（R2 起）

- **genesis 缺失判别法**：host 显式提供 `genesisUpdateBytes` 后若被守卫跳过
  （0 字节 / 超 `min(payloadMaxBytes, uint32)` 上限），stream 照常可用但**不写
  genesis 记录也不发事件**——读 JSONL 首行 `recordKind ≠ 'genesis-baseline'` 即知
  无 genesis（缺失是「尽力」语义的合法终态，非故障）。
- **strict `ok` 的语义边界（R2 起）**：`readStreamStrict.status === 'ok'` 只表示
  「在本次静态读取中，已解析的该 stream v1 物理 records 自 sequence 1 连续（或——
  `historyTrimmed === true` 的最低保存活段 ≠ `00000001` 时——自首条幸存 record 连续，
  见上「裁剪历史报告」），且通过 manifest/storage/frame 校验」——绝不表示业务变更
  完整、无业务 attempt gap 或可恢复 namespace；该限定同时适用于 replay 的成功文案
  （其另附 ADR 0011 既有限定）。物理删除中间 record（如 `[1,3]`）会被判
  `sequence-gap/corrupt`（第 1 段存活时）；前缀整组被 retention 裁剪为可解释的
  `historyTrimmed`（非损坏）。
- **并发读写语义**：JSONL 行的 `appendFileSync` 在内核侧可能拆为多个 `write(2)`，
  与活跃 writer 并发运行的 reader 可能读到半行（误判 invalid-json）。
  `readStreamStrict` 面向**静态 stream**（writer 停写后 / 离线拷贝上使用），
  不承诺与活跃 writer 的并发一致性。

## 契约与纪律

- 冻结 v1 record schema：`RECORD_SCHEMA_ID` +
  `RECORD_SCHEMA_ENVELOPE`（指纹 `sha256:v1:dedad2ab…`，单源 `src/schema.ts`）。
  文本任何改动 = 新 schema 版本（`@2` + 新 stream generation + 旧 stream 只读）。
- `emit` / `append` 同步、**绝不 throw**、绝不阻塞；全部失败路径走健康 observer
  （低基数白名单字段），不改业务结果。
- 存储投影（inline/sidecar/segment/frame/offset/CRC/Base64）归 adapter；emitter 只做
  语义投影。本包内存 adapter 只产出 inline 形状，记录 JSON 与文件 JSONL 逐字段同构。
- best-effort：进程中断的尝试直接缺失（不落 `result:'unknown'`；ADR 0011/0012 拼接
  结论 `§11-G3`）；replay 不得把缺失推断为任何结局。

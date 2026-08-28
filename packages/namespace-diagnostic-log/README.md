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

### 两个声明（R2 起）

- **genesis 缺失判别法**：host 显式提供 `genesisUpdateBytes` 后若被守卫跳过
  （0 字节 / 超 `min(payloadMaxBytes, uint32)` 上限），stream 照常可用但**不写
  genesis 记录也不发事件**——读 JSONL 首行 `recordKind ≠ 'genesis-baseline'` 即知
  无 genesis（缺失是「尽力」语义的合法终态，非故障）。
- **strict `ok` 的语义边界（R2 起）**：`readStreamStrict.status === 'ok'` 只表示
  「在本次静态读取中，已解析的该 stream v1 物理 records 自 sequence 1 连续，且通过
  manifest/storage/frame 校验」——绝不表示业务变更完整、无业务 attempt gap 或可恢复
  namespace；该限定同时适用于 replay 的成功文案（其另附 ADR 0011 既有限定）。
  物理删除中间 record（如 `[1,3]`）会被判 `sequence-gap/corrupt`。
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

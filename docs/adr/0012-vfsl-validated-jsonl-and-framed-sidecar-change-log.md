# ADR 0012：VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式

日期：2026-08-28
状态：已接受

## 背景

ADR 0011 冻结了 best-effort namespace 诊断变更日志的产品语义，但未决定落盘格式。多数 Yjs update 很小，若每个 update 建立独立 blob 文件会造成大量 inode、目录扫描与垃圾回收负担；若全部 Base64 内联 JSONL，大 update 又会放大体积并产生超长行。日志还必须在 append 前验证结构，避免 writer 漂移产生无法解释的记录，同时保持日志故障不影响业务结果。

本 ADR 决定 File adapter 的 stream、JSONL、二进制 sidecar、VFSL record schema、恢复、retention 与 replay 契约。它不把诊断日志升级为 WAL、审计账本或 namespace Persistence 真相源。

## 决策

### Stream 与 generation

每个 namespace 拥有独立日志空间，并可随时间产生多个 stream generation。`streamId` 使用受控 128-bit CSPRNG 生成：

```text
log- + 32 位小写 hex
```

碰撞时有限重试；耗尽只使日志能力不可用并上报健康故障，不改变 namespace 业务结果。正常重启继续健康 stream；首次启用、旧 stream 无法安全续写、冻结配置改变、显式 rotate/reset 时建立新 stream。每个新 stream 尽力先记录当前完整 Y.Doc 的 genesis baseline，使该 stream 可独立诊断性重放；genesis 未成功写入时 stream 仍可记录诊断事实，但不得声称完整重放。工具不自动串联多个 generation。

日志启用与配置是本地 Host/Registry 旁路状态，不写入 namespace `SCHEMA`、`META` 或 `ROOT`，也不随 Hub/Peer 复制。初始化失败不影响 namespace create；独立健康 observer 上报 `LOG_STREAM_INIT_FAILED`。后续重试成功时以当时 Y.Doc 建立新 stream，其 genesis 只代表从该时点开始，不能伪称从 namespace 创建时起连续。

### File adapter 布局

首版 File adapter 使用：

```text
namespaces/{namespaceId}/
  current.json
  streams/
    {streamId}/
      manifest.json
      segments/
        00000001.jsonl
        00000001.bin
        00000002.jsonl
```

`.bin` 在该 segment 首次出现 sidecar payload 时惰性创建。namespaceId、streamId 与 segment 名必须按各自安全文法校验后才能进入路径；不符合时日志不启用并上报，不通过编码、hash 或替换字符静默另存。

`current.json` 使用 temp + rename 原子替换，只保存 format/version/streamId，是可重建 locator 而非完整性证明。locator 损坏时不得按 wall clock 静默猜测最新 stream；扫描 manifests 后必须作确定性恢复或要求显式处置。

`manifest.json` 创建后不可变，至少保存：

- manifest format/version；
- streamId、namespaceId 与 createdAt；
- 完整 record schema VFSL 四键信封；
- record、frame 与 schema 版本；
- committed update capture、input capture policy；
- inline threshold 与 JSONL line 上限。

owner、instanceId、replicationId 与 replication epoch 不冻结在 manifest；适用时由每条记录的受控 context 表达。

### JSONL record

JSONL 使用 UTF-8、无 BOM、每行一个紧凑 JSON object，并以 `\n` 结束。writer 使用固定构造顺序方便人工查看，但格式不承诺 canonical JSON bytes，reader 不得依赖键顺序。

首版默认每次变更尝试只写一条最终 `attempt` record，不写 `attempt-started`。进程在最终 emission 前终止时，该尝试可以完全缺失，属于 ADR 0011 的 best-effort 语义。记录身份是 `(streamId, sequence)`，不另设 recordId。`attemptId` 由最外层 producer 复用已有受控关联 ID，缺失时使用 128-bit CSPRNG 生成：

```text
att- + 32 位小写 hex
```

writer 准备 append 时才分配 stream sequence。JSONL 以无前导零的十进制字符串表示 sequence，frame 以 uint64 big-endian 表示；sequence 不回绕，仅代表该 stream 的 append 顺序，不证明业务尝试无缺，也不是跨副本全局顺序。达到 uint64 最大值后 stream 进入 exhausted，后续日志 emission 丢弃并上报，业务不受影响。

v1 operation 是封闭词表：

```text
namespace-create
root-mutation
schema-replacement
replication-apply
replication-enable
replication-epoch-bump
```

新增 operation 需要新的 record schema 版本与 stream generation。result 使用严格判别联合：

- committed + `noop`；
- committed + `update`；
- committed + `update-omitted`；
- rejected；
- fatal + `committed:false`；
- fatal + `committed:true`，effect 为 `update | update-omitted | unknown`。

rejected 与 fatal committed:false 禁止携带 update。payload 超限时保留 attempt metadata，记录 `update-omitted` 与稳定 reason，而不是丢掉整条记录。顶层诊断 `stage` 使用日志 schema 的封闭枚举；`code` 与 `sourcePhase` 使用安全 Pattern 字符串并标注 source module，不复制 Registry、Runtime、Persistence 与 replication 的全部错误枚举，也不发明 retryable、rollback 或提交事实。

v1 source/context 仅定义：

```ts
source:
  | { kind: 'local' }
  | {
      kind: 'replication'
      direction: 'hub-to-peer' | 'peer-to-hub'
      remoteInstanceId: string
    }

context: {
  correlationId?: string
  runtimeGeneration?: string
  replicationId?: string
  replicationEpoch?: number
}
```

首版不定义 actor，等待授权主体模型稳定。

`observedAt` 由完成操作的 producer 使用注入 Clock 生成 UTC ISO 8601；`durationMs` 只在存在可靠 monotonic duration 来源时可选记录。首版不记录 appendedAt，排序以 sequence 为准，不按 wall clock 排序。

### 输入、issues 与资源投影

日志不得为了生成 record 额外访问调用方输入：

- gate 前拒绝记录 `input.capture = not-accessed`；
- 快照成功后只消费所属操作已经生成的 detached frozen snapshot；
- 快照失败记录 `unavailable/unsafe-input`，不得重读 Proxy、accessor 或循环对象；
- 默认 input capture 为 digest；digest 对安全 snapshot 的 RFC 8785 JCS bytes 计算 SHA-256；
- full/redacted 只消费安全 snapshot，超出 line 预算时降级为 digest，并记录 `projected-input-too-large`。

issues 只保存统一投影：

```ts
type DiagnosticIssue = {
  code?: string
  message: string
  path: (string | number)[]
}
```

`none | full | redacted` 描述该统一投影的捕获策略；full 不表示保留任意底层对象字段。每条 message 最大 4 KiB UTF-8，path 最多 256 个 segment，string segment 最大 1 KiB UTF-8，issues 最多 1000 条；超限时确定性截断并记录 `truncated` 与 `originalCount`。资源限制统一按 UTF-8 bytes 计算，截断不得拆分 Unicode code point。

最终 JSONL line 默认硬上限 1 MiB，可配置。输入导致超限时先降级为 digest；去掉输入后 record 仍超限则丢弃整条 record并通过健康面上报，不影响业务。

### Inline 与 sidecar

默认 `inlineUpdateMaxBytes` 为 4 KiB，可配置；该阈值只影响物理表示：

- update 大小小于等于阈值时，以 RFC 4648 标准 Base64 内联，必须有正确 padding，禁止空白与换行；
- 大于阈值时，append 到当前 segment 共享 `.bin`；
- inline 与 sidecar 均记录 payloadLength 与 CRC32C；
- sequence 与 frameOffset 在 JSONL 中为十进制字符串；uint32 范围内的 payloadLength 为 JSON number。

单个 sidecar payload 默认硬上限 64 MiB，可配置但不得超过 uint32。namespace 以结构化数据为主，不以巨大二进制载荷为目标；即便结构化批量操作、genesis 或 replication diff 产生大 update，超限也只记录 `update-omitted/payload-too-large`，不改变原业务提交。

sidecar 引用形状为：

```json
{
  "storage": "sidecar",
  "format": "yjs-update-v1",
  "segment": "00000001",
  "frameOffset": "12345",
  "payloadLength": 8160
}
```

frameOffset 指向 frame magic 的第一个字节，不保存可推导的 frameLength。

### Binary frame v1

每个 sidecar payload 使用固定 25-byte header：

```text
magic          4 bytes   ASCII "NDCL"
frameVersion   1 byte    0x01
payloadType    1 byte    0x01 = yjs-update-v1
flags          1 byte    0x00
reserved       2 bytes   0x0000
sequence       8 bytes   uint64 big-endian
payloadLength  4 bytes   uint32 big-endian
crc32c         4 bytes   uint32 big-endian
payload        N bytes   raw Yjs update
```

frame 总长度是 `25 + payloadLength`。v1 禁止压缩；payload 是原始 Yjs update bytes，非零 flags/reserved、未知 frameVersion 或 payloadType 均响亮判为 incompatible，不猜测解释。

CRC 使用标准 CRC-32C/Castagnoli：

```text
poly    0x1EDC6F41
init    0xFFFFFFFF
refin   true
refout  true
xorout  0xFFFFFFFF
check("123456789") = 0xE3069283
```

结果以 uint32 big-endian 写入 header。CRC 输入是 header 前 21 bytes（magic 至 payloadLength）直接连接 payload，不包含 crc32c 字段。inline update 同样保存 8 位小写 hex CRC32C，reader 严格解码 Base64 后核对 payloadLength 与 CRC。

### VFSL record schema

VFSL 只定义一条最终 JSONL storage record，不定义 JSONL 文件、binary frame、segment 连续性或 retention。schema 使用固定已发布的 VFSL v1 方言，不引用 “latest”，id 为：

```text
nomicore.namespace-diagnostic-change-record@1
```

writer 启动时编译一次内建 schema 并缓存。manifest 内嵌同一完整四键信封以便离线解释，但 manifest 不得改变运行中 writer 的规则。打开现有 stream 时，manifest format/version 和 schema fingerprint 必须与内建冻结版本匹配；不匹配则旧 stream 保持只读，建立新 generation，不改写旧 manifest。

VFSL 负责校验封闭对象、判别联合、literal enum、Pattern、decimal 字面形式、Base64 与 CRC 字面形状。storage validator 另行负责：

- 严格 Base64 decode；
- decoded length 与 payloadLength 一致；
- inline/frame CRC 正确；
- JSONL 与 frame 的 sequence、format/payloadType、payloadLength 一致；
- offset、segment、frame 边界与 stream 连续性。

业务 producer 只提交 semantic emission，不构造 segment/offset/Base64 等物理表示。日志 adapter 独占 storage projection：先决定 inline/sidecar并构造最终 record，再运行 VFSL。首版不为 semantic emission 建立第二份 VFSL，避免双 schema 漂移。

append 前 VFSL validation failure 是日志 writer bug：丢弃 record、增加低基数 metric并向独立结构化 observer 上报，不改变业务结果。observer只包含稳定 code、schema id/fingerprint、operation、source module、VFSL issue codes/paths与 projected record byte size；不包含原 record、input、Base64、update bytes、底层 message、Error/cause或stack。同一 JSONL中不写递归 health record。

### Writer、append 与背压

日志 adapter 提供有界、non-blocking emitter，内部每个 stream 同时最多一个逻辑 writer queue。File adapter沿用单进程独占根目录的部署约束，不实现跨进程锁；多 Runtime generation 共享 namespace stream 的同一 writer queue，stream不绑定 Runtime generation。文件句柄可由LRU管理。

Inline append：

```text
构造最终 record
→ VFSL validation
→ storage validation
→ append JSONL
```

Sidecar append：

```text
取得当前 segment 与预计 frameOffset
→ 构造最终 record
→ VFSL validation
→ storage validation
→ append 完整 BIN frame
→ append JSONL
```

BIN-first 避免完整 JSONL 引用尚不存在的 frame，但崩溃可能留下完整 orphan frame、不完整尾 frame 或不完整 JSONL 尾行；这些均符合 best-effort 语义。writer queue 满时 drop newest，保留已排队顺序；不得为了记录 drop 再挤占同一队列。按 operation/reason 增加低基数 dropped metrics，并走独立 observer。

默认周期 batch flush，不逐条 fsync；真正 fsync 可配置且默认关闭。write/flush完成不构成掉电持久性承诺。flush失败只改变日志健康，不影响业务。shutdown可best-effort drain，但不得无限等待日志 sink或阻塞Registry/Persistence停止。

#### Amendment — File adapter first slice（2026-08-28，issue #152 round 2）

本 ADR 上文「日志 adapter 提供有界、non-blocking emitter，内部每个 stream 同时最多一个逻辑 writer queue」及「默认周期 batch flush，不逐条 fsync；真正 fsync 可配置且默认关闭」两句，**在首切片 File adapter 的当前实现范围内被以下条款取代**：

每个 `emit` 在调用栈内执行至多一条 final JSONL record 的有界同步 append；若其携带 sidecar，则额外执行至多一帧 BIN append，顺序为 BIN-first。该首切片不维护 writer queue、不做 batch flush、不提供 fsync 开关，也不保持常驻 file descriptor。同步 append 完成不构成 fsync 或掉电持久性承诺。

此处「有界」仅指 adapter 主动处理的数据量与操作数量受配置 payload/line limits 和单-record/单-frame 范围限制；它**不**表示底层文件系统延迟有时间上界，亦不表示 `emit` 可在任意调用点不阻塞。**任何将 File adapter 的 `emit` 接入 namespace 生命周期的调用点，必须位于 NamespaceRuntime write sequencer slot 之外，或在该 slot 已释放之后；不得在 slot 内执行同步 File adapter `emit`。** 不满足该条件的接线为不合规，必须由 #149–#151/#155 或后续接线票修复后方可启用。本首切片 `emit` 保持 `void`、non-throwing、不得返回 durability promise，并以 catch-and-health-report 处理 adapter 故障（ADR 0011 emitter seam 不变）。

queue/batch 是目标演进形态而非与首切片并列的当前要求：未来切片可在不改变 emitter 公共 seam、record schema、manifest policy 或上述 write-slot 隔离条件的前提下，以每 stream 至多一个逻辑 writer queue 替换同步 append，并采用有界队列、drop/health 语义和周期 batch flush；该切片须另行定义 close/shutdown、flush、队列满与 fsync 配置语义。**retention、queue 容量、batch/flush 策略、fd cache 与 metrics sampling 可动态调整**的既有条款对首切片继续成立（首切片未提供即可调整项，仅指未来切片）。

### Segment rolling 与耗尽

JSONL/BIN作为一个segment group成对滚动，默认targets为：

```text
targetJsonlSegmentBytes = 64 MiB
targetBinSegmentBytes   = 256 MiB
targetRecordsPerSegment = 100,000
```

均可配置。任一target达到时，在写入下一条record前关闭当前group并开启新group；单条合法record可让新group超过target，但不得超过record/payload硬上限。

segment从`00000001`开始，`00000000`保留，固定8位十进制，不回绕。达到`99999999`后stream进入exhausted，后续日志丢弃并上报，业务不受影响。

影响记录解释的配置在stream创建时冻结；包括record/schema/frame版本、committed update capture、input capture policy、inline threshold与line上限。冻结项改变时新建stream generation。retention、queue容量、batch/flush策略、fd cache与metrics sampling可动态调整。

### 打开与尾部恢复

打开既有 stream 时，writer交叉扫描JSONL与BIN。只自动修复可以证明的最终尾部：

- 截断最终不完整 JSONL 行；
- 截断最终不完整 frame；
- 截断完整但未被任何完整 JSONL record引用的尾部 orphan frames。

自动修复通过observer上报。以下情况不尝试修复中间数据：中间坏JSON行、VFSL失败、CRC错、sequence/type/length不符、JSONL引用不存在frame、offset越界/重叠、未知format/dialect/frame/payload。旧stream标为corrupt或incompatible并保持只读，创建新generation；不得从BIN猜回丢失的JSONL attempt语义。

### Retention 与删除

File adapter内置可配置retention，默认：

```text
maxAge = 30 days
maxBytesPerNamespace = 1 GiB
```

两者先到者生效；显式`null`关闭某个限制，`0`不表示无限。retention只删除已关闭且没有reader lease的segment group，绝不删除当前open group。删除协议以JSONL为group提交标记：

1. 将关闭group的`.jsonl`原子rename为`.deleting`；
2. 删除对应`.bin`；
3. 删除`.deleting`；
4. 启动时继续完成遗留`.deleting`；
5. 无对应JSONL的孤立BIN按orphan清理。

manifest不承担频繁变化的retention状态；earliest retained sequence通过扫描重建，查询明确报告历史已裁剪。reader通过`openReadSession()`获得短期segment lease，retention只删除无lease group；长期reader必须有最大lease时长或显式续租。

日志生命周期不与namespace snapshot Persistence自动绑定。提供按namespace彻底删除日志的管理能力，覆盖current locator、manifests、JSONL、BIN与adapter索引。该能力只承诺活跃存储中的逻辑删除，不承诺SSD、备份、对象存储版本中的物理secure erase；备份、磁盘加密与密钥销毁归部署策略。Host执行数据删除请求时必须同时调用日志删除能力。

### Strict reader 与诊断性 replay

默认strict reader对每条record执行JSON parse、VFSL validation及storage/frame交叉校验。显式metadata-only或unsafe-fast模式可用于检查/导出，但不得声称可重放；replay强制strict。

未知VFSL dialect、record format、frameVersion或payloadType使该stream为incompatible；reader可展示manifest和原始文件元数据，但不得近似解释、跳过未知记录后继续声称连续。不同stream互不连带。

replay不暴露live Y.Doc，只返回owned snapshot bytes与结构化报告：

```ts
{
  status: 'complete' | 'partial' | 'failed'
  lastAppliedSequence: string | null
  issues: ReplayIssue[]
  snapshot?: Uint8Array
}
```

只有存在有效genesis、records连续、所有必要updates可解码且校验通过、无已知gap/截断/损坏/不兼容，并且重放后受控identity匹配时才能返回complete。retention裁剪、update omitted、缺genesis或generation断裂只能返回partial/failed。即便complete也只证明重放了该best-effort stream所持有的记录，不证明与生产namespace完全一致。

## 被否方案

- **每个update一个`.bin`文件**：大量小文件导致inode、目录扫描、备份与GC成本。
- **全部Base64内联JSONL**：大update产生明显膨胀与超长行。
- **裸payload sidecar**：无法独立校验边界、sequence与随机损坏；首版选择固定frame header。
- **默认started/completed双记录**：正常流量近似翻倍，而best-effort emitter仍不能证明started必达；首版只写最终record。
- **让producer构造offset/segment**：泄漏物理布局并形成浅interface；storage projection归日志adapter。
- **只用TypeScript类型、不做VFSL验证**：无法在append前发现运行时record漂移，也削弱manifest自描述能力。
- **让manifest schema决定writer规则**：损坏或篡改manifest可改变运行时行为；writer只信任内建冻结schema。
- **跨记录hash chain或签名**：会暗示防篡改审计与完整性保证，不符合best-effort定位。
- **每条fsync或业务await日志append**：把observability延迟/故障引入业务提交路径。
- **在不修订 ADR 的前提下把同步 append 称为现行 queue/batch 的实现细节**：文本会同时要求 queue/batch 和无 queue/batch，无法审计。
- **允许同步 File adapter `emit` 在 namespace write slot 内执行**：慢文件系统仍可无限延长业务写槽，直接违反 ADR 0011/0008 的业务隔离。
- **把「有界」解释成对磁盘 latency 的承诺**：文件系统延迟不可由 payload/line budget 限定。
- **现在直接实现异步 queue/batch 以回避文本修订**：会引入内存—磁盘状态、关闭/flush/队列满和 EISDIR 恢复语义，超出首切片纪律（本 ADR 修订仅记录取舍，演进留后续切片）。
- **自动修复中间损坏或从BIN重建JSONL**：无法恢复attempt、stage、issues与input等语义，会制造虚假连续性。

## 后果

- 小update保持单行可读，大update聚合进分段sidecar，文件数量随segment而非变更次数增长。
- JSONL与frame双重结构及CRC提供较强的随机损坏、错位和坏尾诊断，但不构成防篡改或可靠恢复保证。
- VFSL成为record逻辑形状的单一真相源；stream/file不变量继续由storage validator负责，避免让schema承担它无法表达的跨记录事实。
- manifest自描述有利于离线工具解释旧日志，代价是必须长期保留冻结dialect/schema reader。
- retention默认有界，可能主动裁剪诊断历史并使replay不完整；reader必须诚实展示partial/failed。
- writer、reader、frame codec、尾部恢复、retention和删除形成独立深模块；业务调用方只依赖semantic emitter，不学习JSONL/BIN布局。
- **首切片取舍（2026-08-28 amendment）**：同步有界 append 保持同步可观察性、无常驻 fd——简化 EISDIR 占位恢复、消除内存—磁盘孪生状态；代价是调用方线程可能被文件系统延迟阻塞。因此只有 write-slot 外规范性接线可以保持 ADR 0011 的业务隔离；未来 queue/batch 切片可改善 producer 延迟，但必须独立设计其故障与寿命语义，且不得改变 emitter 公共 seam、record schema 或 manifest policy。

## 验收门槛

实现至少验证：

1. 小update内联并通过VFSL、Base64、length、CRC round-trip；
2. 大update写frame并通过offset/type/sequence/length/CRC交叉验证；
3. 恰4KiB内联、4KiB+1 sidecar；
4. rejected、fatal、committed/noop/update/update-omitted各判别分支；
5. gate拒绝保持input `not-accessed`，日志对Proxy/accessor零额外读取；
6. VFSL失败、队列满、磁盘失败、stream初始化失败均不改变业务结果；
7. BIN-first/JSONL-second各崩溃窗口；
8. 最终坏尾自动修复，中间损坏新建stream且旧stream只读；
9. segment滚动、sequence/segment耗尽与retention成对删除；
10. manifest envelope不匹配时新建stream，不改旧manifest；
11. strict reader/replay对未知dialect/frame/payload、缺BIN、CRC错、retention裁剪、update omitted给出诚实状态；
12. Runtime reopen/多generation仍经单writer有序append；
13. Host shutdown不无限等待日志；
14. full/redacted超line上限降级digest；
15. 按namespace日志删除覆盖locator、manifest、JSONL、BIN与索引。

## 关联

本ADR实现并细化ADR 0011的日志存储与校验选择，不改变其best-effort、输入零额外读取、数据保护或诊断性重放条件。它不修改ADR 0006的snapshot Persistence、ADR 0008的单write sequencer与dirty notification、ADR 0009的Registry生命周期、ADR 0010的replication ACK与transport observability，也不把日志配置带入namespace复制数据面。

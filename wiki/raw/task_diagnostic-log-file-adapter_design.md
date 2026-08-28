# Design: File diagnostic-log adapter — VFSL 校验 JSONL + NDCL v1 sidecar + strict reader（issue #152）

> SA1 出品（**R2 修订**：落实 SA2 R1 评审必修 #1–#4 + MINOR #5–#9 + INFO #10 + API 备注，并回写总控 G1–G6/J9 裁决；修订点以「R2 修订（SA2 #N）」标注）。任务类型：feature。
> 主规范：`docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md`；语义基线：ADR 0011。
> 红灯契约：SA6 Phase 1 五测试文件 + 两 helper（`packages/namespace-diagnostic-log/test/file-adapter-*.test.ts`、`test/helpers/{file,frame}.ts`），exit=1 红灯已验证（`.mabf-bg/sa6-red.log`，Tests 72 failed | 165 passed）。
> 上游冻结资产：#148（PR #156，commit 7ceede1，已在本分支基线）——emitter 管线、冻结 VFSL schema（指纹 `sha256:v1:dedad2ab…e070`）、crc32c、carrier、health 接缝、testing 工具。
> 本设计的权威锚定序位：ADR 0012/0011 条款 > SA6 红灯契约（简报 §1–§5）> 本设计的选择性裁决（§10/§11）。与 SA6 契约的分歧全部集中在 §11 显式列出，交总控裁决，默认按本设计标注的「默认取值」执行。

## 目录

- §1 模块定位与公共接缝
- §2 磁盘布局与物理格式契约
- §3 Writer 初始化与新 generation 建立
- §4 Writer append 管线（attempt + genesis）
- §5 NDCL v1 frame codec（`src/frame.ts`）
- §6 storage 校验门与共享原语
- §7 strict reader（`src/reader.ts`）
- §8 健康事件增量
- §9 测试映射（SA6 红灯 ↔ 设计锚点）
- §10 judgement calls 清单
- §11 规格缺口 / 对 SA6 契约的异议与裁决建议
- §12 文件清单（File Scope）
- §13 协议假设依据 (Protocol Assumption Evidence)
- §14 契约改动连锁审计 (Contract Change Caller Audit)
- SA2 反馈逐条回应（R1 初版占位）

---

## §1 模块定位与公共接缝

### 1.1 位置与依赖方向

本票在 **既有包** `packages/namespace-diagnostic-log/` 内新增 File adapter（SA6 契约明示「包内位置：packages/namespace-diagnostic-log/」）。不建新包、不改 #148 冻结面、不建第二份 VFSL（ADR 0012 明文禁令）。

新增内部模块（文件名实现期可微调，职责与导出面不变）：

```text
src/adapters/file.ts    # createFileDiagnosticLog：初始化状态机 + append 管线 + 落盘（node:fs 唯一写面）
src/reader.ts           # readStreamStrict：strict reader（node:fs 唯一读面）
src/frame.ts            # NDCL v1 25-byte frame 编解码（纯 TS：Uint8Array + DataView，零环境绑定）
src/paths.ts            # 路径安全文法 + 布局路径派生（writer/reader 共享；纯 TS）
src/storage-gate.ts     # storage 校验共享原语（canonical Base64 判定 / inline 全量校验 / sidecar 引用自检）
```

依赖方向（单向，无环；沿用 #148 设计 §1.2 纪律）：

```text
adapters/file.ts ──→ pipeline.ts（emitter 管线复用，只换 sink）
      │  ──→ schema.ts（getRecordSchemaCompilation / RECORD_SCHEMA_ENVELOPE / RECORD_SCHEMA_ID）
      │  ──→ carrier.ts（buildInlineCarrier + 新增 decodeBase64Strict）
      │  ──→ crc32c.ts / digest.ts（randomSource 默认实现）
      │  ──→ health.ts（makeEventNotifier）
      │  ──→ frame.ts / paths.ts / storage-gate.ts
      │  ──→ adapters/memory.ts（仅 import 导出面：nextDecimal / UINT64_MAX——不改该文件）
      └──→ emission.ts / record.ts（类型）
reader.ts ──→ schema.ts / storage-gate.ts / frame.ts / paths.ts / crc32c.ts / record.ts（类型）
frame.ts / paths.ts / storage-gate.ts ──→ 零包内依赖（叶子；storage-gate → carrier.ts / crc32c.ts）
```

### 1.2 公共导出增量（SA6 契约逐字）

`src/index.ts` 追加（既有 8 类导出一字不动）：

```ts
export {
  createFileDiagnosticLog,
  type FileDiagnosticLog,
  type FileDiagnosticLogConfig,
} from './adapters/file.js'
export {
  readStreamStrict,
  type StrictStreamRead, type StrictReadStatus, type StrictReadIssue, type StrictRecordRead,
} from './reader.js'
```

`src/testing.ts` 追加（§6.3）：

```ts
export function injectFinalRecordFile(log: FileDiagnosticLog, record: DiagnosticChangeRecord): void
```

`src/health.ts` 的 `DiagnosticLogHealthEvent` 联合追加**四成员**（只增不改，#148 设计 §8.1 备案的演进方式）：SA6 契约三成员 + 总控 J9 裁决的 `{ type: 'stream-exhausted' }`（详见 §8）。

### 1.3 FileDiagnosticLogConfig（逐字段：类型 / 默认 / 去向）

SA6 契约形状逐字采用；全部可选项带 `| undefined` 显式联合（exactOptionalPropertyTypes 装配模式，对齐 #148 `DiagnosticLogConfig`）。

| 字段 | 类型 | 默认 | 去向 / 说明 |
|---|---|---|---|
| `rootDir` | `string` | 必填 | 日志根目录；单进程独占（ADR 0012 §Writer），不做跨进程锁 |
| `namespaceId` | `string` | 必填 | §2.6 安全文法校验后才能进入路径；违规 → 日志不启用（§3.1） |
| `genesisUpdateBytes` | `Uint8Array \| undefined` | — | 提供 → 新 stream 先尽力写 genesis-baseline（sequence 1，§4.2） |
| `resumeStreamId` | `string \| undefined` | — | 提供 → manifest 指纹匹配检查；四分支见 §3.4 |
| `inputPolicy` | `'none'\|'digest'\|'redacted'\|'full' \| undefined` | `'digest'` | emitter 管线配置；冻结进 manifest `inputCapturePolicy` |
| `issuesPolicy` | `'none'\|'full'\|'redacted' \| undefined` | `'full'` | emitter 管线配置（#148 J6 同款默认） |
| `updateCapture` | `boolean \| undefined` | `false` | attempt 的 update 捕获；冻结进 manifest `committedUpdateCapture`。与 genesis 正交（§10-J4） |
| `lineBudgetBytes` | `number \| undefined` | `1048576` | 最终 JSONL line 紧凑 JSON UTF-8 字节硬上限（不含结尾 `\n`，与 #148 measure 同基）；冻结进 manifest `jsonlLineLimitBytes` |
| `payloadMaxBytes` | `number \| undefined` | `67108864` | 单 update payload 硬上限；守卫取 `min(配置值, 0xFFFFFFFF)`（§10-J8） |
| `inlineUpdateMaxBytes` | `number \| undefined` | `4096` | inline/sidecar 分界（≤ 内联，> sidecar）；冻结进 manifest `inlineUpdateMaxBytes` |
| `observer` | `DiagnosticLogHealthObserver \| undefined` | — | 健康观察者（#148 同一接缝） |
| `fallbackLog` | `((line: string) => void) \| undefined` | `console.error` | observer 故障 fallback（#148 §8.3 同款） |
| `randomSource` | `RandomSource \| undefined` | node:crypto CSPRNG | 仅 streamId 用途（attemptId 由 emitter 管线用同一注入源） |
| `clock` | `{ now(): number } \| undefined` | `Date.now` | **两处同源**：manifest `createdAt`（§2.2）与 genesis `observedAt`（§4.2）；R2 修订（SA2 API 备注）：异常（throw/NaN/超域）被构造级 crash 包络收编（§3.1-0），不从构造函数外抛 |

**不设 `capacity`**：#152 落地同步写、无队列（§4.3），queue-full 背压路径 vacuous（`record-dropped.reason` 两值词表不动）。

### 1.4 FileDiagnosticLog 形状（SA6 契约逐字）

```ts
interface FileDiagnosticLog {
  emitter: NamespaceDiagnosticChangeEmitter   // #148 同一管线（createDiagnosticChangeEmitter，只换 sink）
  readonly streamId: string                   // CSPRNG 生成 log-+32hex；实例寿命内稳定；disabled 模式也有值（§10-J6）
  readonly rootDir: string
  readonly namespaceId: string
}
```

无 `records()`/`stats()` 读面——读面是 `readStreamStrict`（ADR 0011：「完整查询、导出…属于日志存储/工具模块的 interface」）。

### 1.5 环境绑定面扩展（AGENTS.md 增补，SA3 落地）

#148 AGENTS.md 声明「`node:crypto`/`Buffer` 仅出现于 `src/digest.ts` 与 `src/carrier.ts`——本包唯一环境绑定面」。File adapter 物理上必须触达文件系统，绑定面**显式扩展**（不改既有两模块的边界）：

| 模块 | 允许的环境 API | 理由 |
|---|---|---|
| `src/digest.ts`、`src/carrier.ts` | node:crypto / Buffer（不变） | #148 冻结 |
| `src/carrier.ts`（扩展） | Buffer Base64 **decode**（新增 `decodeBase64Strict`） | Base64 编解码双侧收口在同一模块，reader/storage-gate 不得自起炉灶 |
| `src/adapters/file.ts`、`src/reader.ts` | node:fs / node:path | 唯一 fs IO 面 |
| `src/paths.ts` | **node:path**（仅 `join`——布局路径派生） | **R3 勘误（终审 N-1）**：R2 声明误列「其余新模块（frame/paths/storage-gate）零环境绑定」——paths.ts 实际 import `node:path`（仅 `join`、零 node:fs）；更正为三模块绑定声明；其余新模块（frame/storage-gate）零环境绑定（纯 TS） |

`packages/namespace-diagnostic-log/AGENTS.md` Boundaries 段相应改写为三行绑定面声明（列入 §12 ALLOW LIST）。`node:fs`/`node:path` 是 Node 内置模块——**零新增依赖**，`pnpm-lock.yaml` 与包 `package.json` 均不动（SA6 约束 §5.5「无新增依赖」达成）。

---

## §2 磁盘布局与物理格式契约

### 2.1 布局（SA6 契约 = ADR 0012 §File adapter 布局）

```text
{rootDir}/namespaces/{namespaceId}/current.json          # 恰三键 locator；temp + rename 原子替换
{rootDir}/namespaces/{namespaceId}/streams/{streamId}/manifest.json   # 不可变（'wx' 创建）
{rootDir}/namespaces/{namespaceId}/streams/{streamId}/segments/00000001.jsonl
{rootDir}/namespaces/{namespaceId}/streams/{streamId}/segments/00000001.bin   # 惰性
```

#152 writer 恒写 segment `00000001`（rolling/耗尽归 #153）；reader 面向布局而非 writer，扫描全部 `^[0-9]{8}$` segment（§10-J11）。`00000000` 保留不用。

### 2.2 manifest.json（恰 14 键；`format:'ndcl-manifest'` / `version:1`）

| 键 | 取值 | 来源 |
|---|---|---|
| `format` | `'ndcl-manifest'` | 常量 |
| `version` | `1` | 常量 |
| `streamId` | 本 stream id | |
| `namespaceId` | 构造参数 | |
| `createdAt` | `observedAtFrom(clock.now)`（P_ISO_MS） | ADR「createdAt」 |
| `schema` | `RECORD_SCHEMA_ENVELOPE`（恰四键 lang/version/id/text） | #148 冻结信封逐字节内嵌（ADR「manifest 内嵌同一完整四键信封以便离线解释」） |
| `recordVersion` | `1` | ADR「record…版本」 |
| `frameVersion` | `1` | ADR「frame…版本」 |
| `schemaId` | `RECORD_SCHEMA_ID` | |
| `schemaFingerprint` | `sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070` | #148 冻结常量 |
| `committedUpdateCapture` | `updateCapture` 配置 | ADR「committed update capture」 |
| `inputCapturePolicy` | `inputPolicy` 配置 | ADR「input capture policy」 |
| `inlineUpdateMaxBytes` | `inlineUpdateMaxBytes` 配置 | ADR「inline threshold」 |
| `jsonlLineLimitBytes` | `lineBudgetBytes` 配置 | ADR「JSONL line 上限」 |

manifest **创建后不可变**：只在新建 stream 时以 `writeFileSync(path, bytes, { flag: 'wx' })` 写一次（EEXIST → 碰撞重试路径 §3.3）；此后任何路径（含 resume、mismatch、genesis 失败、append 失败）不得再打开它写。owner/instanceId/replicationId/epoch 不进 manifest（ADR 明文，由每条 record 的 context 表达）。

### 2.3 current.json（恰三键；原子替换）

`{ format:'ndcl-current', version:1, streamId }` 恰三键。写法：`writeFileSync(namespaceDir + '/current.json.tmp', bytes)` → `renameSync(tmp, current.json)`（ADR 0012 明文「temp + rename 原子替换」；ADR 0006 snapshot 同款已验证模式）。写于 genesis 之后（§3.2）；失败只发 `storage-write-failed{stage:'current'}`，不禁用 stream（locator 是可重建的派生物，不是完整性证明）。

**R2 修订（SA2 #9）——tmp 残留语义**：写/失败分支做 best-effort 清理——`try { unlinkSync(tmp) } catch { /* ENOENT 及其他一律吞——清理失败不升级 */ }`（ENOENT 容忍；清理自身失败静默，残留是合法遗物不作故障上报）。若清理未成或进程在 rename 前崩溃，`current.json.tmp` 残留**合法**：locator 恢复（#153）只按主名 `current.json` 工作，tmp 固定名不参与定位、人工删除安全。

### 2.4 JSONL line 纪律

UTF-8、无 BOM、每行一个紧凑 JSON object（`JSON.stringify`）、以 `\n` 结束。writer 用固定对象字面量构造顺序（assemble 顺序：recordKind/streamId/sequence/attemptId/operation/stage/observedAt/durationMs?/source/context?/code?/sourcePhase?/sourceModule?/issues?/input/result），但**不承诺 canonical JSON bytes**，reader 不依赖键顺序（ADR 0012 §JSONL record 逐字）。`sequence`/`frameOffset` 为十进制无前导零字符串；`payloadLength` 为 JSON number。

### 2.5 NDCL v1 frame（25-byte header + payload；writer/reader/测试三方同构）

```text
magic          4B   ASCII "NDCL"（0x4E 0x44 0x43 0x4C）
frameVersion   1B   0x01
payloadType    1B   0x01 = yjs-update-v1
flags          1B   0x00
reserved       2B   0x0000
sequence       8B   uint64 big-endian（record.sequence 十进制字符串的数值）
payloadLength  4B   uint32 big-endian
crc32c         4B   uint32 big-endian
payload        NB   原始 Yjs update bytes
```

- frame 总长 `25 + payloadLength`；`frameOffset` 指向 magic 首字节，不存可推导的 frameLength。
- **CRC 输入域 = header 前 21 bytes（magic 至 payloadLength）直接连接 payload**，不含 crc32c 字段（ADR 0012 逐字；SA6 frame helper 已按此实现并自检）。
- CRC 参数复用 `src/crc32c.ts`（#148 交付，KAT `check("123456789")=0xE3069283`）；inline carrier 的 `crc32c`（8 位小写 hex）与 frame 的 uint32 BE 是同一 CRC 值的两种字面形。
- v1 禁止压缩；非零 flags/reserved、未知 frameVersion/payloadType → reader 响亮 incompatible（§7.2）。

### 2.6 路径安全文法（进入路径前校验；三组件）

| 组件 | 文法 | 违规处置 |
|---|---|---|
| `namespaceId` | 非空串 ∧ ≠ `.`/`..` ∧ 无 C0/C1 控制字符（U+0000–001F、U+007F–009F）∧ 无 `/` `\` | 日志不启用 + `stream-init-failed{reason:'invalid-namespace-id'}`；**零** fs 触达（连 `namespaces/` 目录都不建） |
| `streamId` | `^log-[0-9a-f]{32}$`（复用 `P_STREAM_ID` 常量，§10-J12） | 提作 `resumeStreamId` 时违规 → 日志不启用 + `invalid-stream-id`；writer 自生成值恒合法；reader 入参违规 → `locator-invalid`（§7.1） |
| segment 名 | `^[0-9]{8}$`（`P_SEGMENT`） | writer 侧自产恒合法；reader 侧经 VFSL P_SEGMENT 先行拒绝 |

namespaceId 判定逻辑与 `packages/namespace-registry/src/identity.ts:70 isMinimalSafeString` 同纪律（SA6 简报 §2 明示对齐）；在 `src/paths.ts` 内实现同款函数（不 import registry——本包不依赖 registry，ADR/AGENTS 边界）。**不编码、不 hash、不替换字符静默另存**（ADR 0012 明文）。

---

## §3 Writer 初始化与新 generation 建立

### 3.1 初始化状态机

```text
createFileDiagnosticLog(config):                       // R2 修订（SA2 #2）：整体包 try/catch——构造级 crash 包络
  try:
    streamId = 'log-' + bytesToHex(randomSource.randomBytes(16))   // 第一件事（后续任何成败都有它）
    ① namespaceId 文法 ✗ → disabled 模式 + notify(stream-init-failed{code:'LOG_STREAM_INIT_FAILED',
         reason:'invalid-namespace-id'})（恰一次）→ 返回
    ② resumeStreamId 提供且文法 ✗ → disabled + stream-init-failed{reason:'invalid-stream-id'}（恰一次）
    ③ 内建 schema 编译（getRecordSchemaCompilation，模块级缓存）失败 → failed 模式 +
         schema-compile-failed（#148 §4.1 步骤 0′ 同款；正常不可达——writer bug）
    ④ resumeStreamId 提供且文法 ✓ → 读旧 manifest（只读，绝不写旧 stream 目录）：
         ENOENT / 不可读            → notify(stream-init-failed{reason:'manifest-missing'}) → 走⑤新建
         JSON 不可解析 / 非对象       → notify(stream-init-failed{reason:'manifest-mismatch'}) → 走⑤新建
         format≠'ndcl-manifest' ∨ version≠1 ∨ schema 信封≠RECORD_SCHEMA_ENVELOPE
           ∨ schemaFingerprint≠冻结常量                    → manifest-mismatch 同上 → 走⑤新建
         全匹配 → （#152 无续写能力，§3.4；总控 G1 裁决：静默，不扩词表）→ 走⑤新建
    ⑤ 新 generation：
         mkdirSync(streams/{streamId}/segments, { recursive: true })
           失败（EACCES/EROFS/ENOTDIR…）→ disabled + storage-write-failed{stage:'manifest', code:errno}
         manifest = §2.2 十四键（createdAt = observedAtFrom(clock.now)）；
         writeFileSync(manifestPath, JSON.stringify(manifest), { flag:'wx' })
           EEXIST → 碰撞：重新生成 streamId 重试 ⑤（≤8 次；耗尽 → disabled +
             storage-write-failed{stage:'manifest', code:'EEXIST'}，§3.3）
           其他 errno → disabled + storage-write-failed{stage:'manifest', code:errno}
         genesis（genesisUpdateBytes 提供）→ §4.2（尽力；失败不禁用 stream）
         current.json temp+rename（§2.3；失败仅事件）
    ⑥ ready 模式：emitter = createDiagnosticChangeEmitter(
         { inputPolicy, issuesPolicy, observer, fallbackLog, randomSource }, sink = appendFile 管线 §4)
  catch:                                                // —— 构造级 catch-all（R2 新增）——
    failed 模式 + 恰一次 notify({ type:'pipeline-crashed', stage:'adapter' })   // #148 既有成员，零扩词表
    （涵盖：clock.now throw / 返回 NaN / epoch 超域使 observedAtFrom 抛 RangeError；randomSource.randomBytes
     throw；config 形状垃圾（rootDir 非串等）引发的 TypeError；未列举 errno 形态——ADR 0012「初始化失败
     不影响 namespace create」的构造面对称防线，与 §4.1 append 面的顶层 catch 同款）
  finally:
    streamId ??= 'log-' + '0'.repeat(32)                // randomSource 即抛时形状完备占位（文法合法、零磁盘产物）
    返回 { emitter: 静默 sink（mode ≠ ready），streamId, rootDir, namespaceId }   // J6 形状完备纪律
```

disabled/failed 模式：emitter 照常构造（emit 同步、不抛——intake/投影照跑，sink 静默丢弃，不逐条发事件；init 失败已在构造期一次性上报——与 #148 failed 模式的事件抑制纪律一致）。

模式汇总表：

| 输入条件 | 模式 | 事件（恰一次） | 磁盘产物 |
|---|---|---|---|
| namespaceId 文法 ✗ | disabled | `stream-init-failed/invalid-namespace-id` | **零文件零目录** |
| resumeStreamId 文法 ✗ | disabled | `stream-init-failed/invalid-stream-id` | 零 |
| 内建 schema 编译失败 | failed | `schema-compile-failed` | 零（正常不可达） |
| resume manifest ENOENT | ready（新 generation） | `stream-init-failed/manifest-missing` | 新 stream 全套 |
| resume manifest 不可解析/不匹配 | ready（新 generation） | `stream-init-failed/manifest-mismatch` | 新 stream全套；旧 stream 字节恒等 |
| resume manifest 全匹配 | ready（新 generation） | 无（总控 G1 裁决：静默，不扩词表） | 新 stream 全套；旧 stream 字节恒等 |
| 其余（首次启用） | ready | 无 | 新 stream 全套 |
| **init 期未预见异常**（clock throw/NaN/超域、randomSource throw、config 垃圾、未列举 errno 形态）【R2 修订（SA2 #2）】 | failed | `pipeline-crashed{stage:'adapter'}` | 不保证零产物（mkdir 可能已发生；绝无半写 manifest——`'wx'` 原子创建） |

### 3.2 创建顺序与原子性依据

`segments/ 目录 → manifest('wx') → genesis → current.json(temp+rename)`。理由：

- manifest 先于任何 record：JSONL/BIN 落盘前 stream 已自描述（`'wx'` = O_CREAT|O_EXCL 语义，创建原子且天然检测碰撞）。
- genesis 先于 current.json：locator 最后指向一个已完成基线尝试的 stream；若中间崩溃，`current.json` 仍指旧 stream 或缺失——都可由 #153「扫描 manifests 确定性恢复」重建，不产生虚假完整性。
- 每个 emit 的落盘本身即持久（同步 write，§4.3），无 flush 延迟窗口；不 fsync（ADR 0012「真正 fsync 可配置且默认关闭」——#152 不暴露 fsync 开关，固定关）。

### 3.3 streamId 生成与碰撞

`'log-' + bytesToHex(randomSource.randomBytes(16))`（与 #148 memory adapter 同式）。碰撞检测不靠预 `existsSync`，而靠 manifest `'wx'` 的 EEXIST（消除 check-then-create 竞态；单进程约束下是防御纵深）。重试 ≤ 8 次换新 id；耗尽 → disabled + `storage-write-failed{stage:'manifest', code:'EEXIST'}`（ADR「碰撞时有限重试；耗尽只使日志能力不可用并上报健康故障」——事件走既有 storage-write-failed 成员，不为它发明新 reason）。注入确定性随机源时 8 次同 id 重试后干净失败，不死循环（SA6 `createDeterministicRandomSource` 循环供应语义下的有界性）。

### 3.4 resume 边界裁决（#152 对「打开既有 stream」的支持程度）

**裁决：#152 的 `resumeStreamId` 只做指纹匹配检查，不做任何续写；四种可判定的 resume 结局全部落到「新建 generation，旧 stream 只读、字节恒等」。** 依据：

1. ADR 0012「正常重启继续健康 stream」的**安全**续写依赖「打开与尾部恢复」的全部机制——交叉扫描 JSONL 与 BIN、截断最终不完整 JSONL 行/帧、清尾部 orphan frames（#153 范围，简报 §5.3 明示归属）。
2. 无修复的续写会主动制造永久中间损坏：崩溃遗留的不完整尾行若不被修复，续写 append 会把「最终尾部损坏」变成「中间损坏」，此后 strict reader 对该 stream 永远 corrupt——直接违反 ADR「只自动修复可以证明的最终尾部；中间损坏不尝试修复」的对称纪律。**半吊子续写比不续写更糟。**
3. 因此在 #152 的能力边界内，「旧 stream 无法安全续写」恒为真 → 按 ADR「旧 stream 无法安全续写…时建立新 stream」落新建 generation。这是 ADR 条款的诚实适用，不是偏离。

与 SA6 契约的一致性：SA6 只锚定 mismatch 分支（新 generation + 旧 manifest 字节恒等 + current.json 指向新 stream + 旧 stream reader 判 incompatible——§3.1 ⑤ 全部满足）；「指纹匹配时的安全续写归 #153」与「SA1 若实现续写需自洽」均不触发。匹配分支**无事件**——总控 G1 裁决（2026-08-28）：批准静默、不扩 reason 词表，可诊断性损失记 REPORT 遗留风险（§11-G1 + 文末裁决表）。

---

## §4 Writer append 管线

### 4.1 总数据流（ADR 0012 §Writer 两个 append 序列的落地）

```text
appendFile(semantic: DiagnosticSemanticRecord):      // sink；整函数 try/catch → pipeline-crashed{stage:'adapter'}
  mode ≠ ready      → 丢弃（静默；init 失败已一次性上报）
  exhaustedLatch    → 丢弃（静默——转换时刻已发过 stream-exhausted；R2 修订 SA2 #4/总控 J9 裁决回写）
  sequence = allocate()        // null→'1'，否则 nextDecimal(lastSequence)；lastSequence = sequence
                          // ADR「writer 准备 append 时才分配 stream sequence」；
                          // 此后任何丢弃都消耗该 sequence → JSONL 出现诚实 gap（SA6 §5.2 裁决）
  if sequence === UINT64_MAX:  // —— exhausted 转换时刻（总控 J9 裁决；R2 回写）——
      exhaustedLatch = true
      notify({ type: 'stream-exhausted' })   // 恰一次（bool 门闩，零附加字段；不逐条发）
      // 转换时刻 = 产出 UINT64_MAX 的 sequence 分配完成——无论该 record 后续守卫/门/落盘成败
      // （sequence 已分配即计数）；该 record 本身继续正常走门与落盘（UINT64_MAX 是合法 sequence）；
      // 此后所有 append 走首行分支静默丢弃
  record = assembleAttempt(semantic, sequence)
                          // 三守卫（#148 §7.4 同款，顺序不变）：
                          //   bytes.length===0        → update-omitted/empty-update
                          //   !updateCapture         → update-omitted/update-capture-disabled
                          //   bytes.length>payloadCap → update-omitted/payload-too-large
                          //   （守卫保留 record + attempt metadata；不是丢弃）
  // —— storage projection（adapter 独占；producer 永不构造物理键）——
  if record.result 携带 update bytes b（守卫后仍为 update）:
      if b.length ≤ inlineUpdateMaxBytes:
          carrier = buildInlineCarrier(b)                     // 复用 #148 carrier.ts（inline）
      else:
          offset = planFrameOffset(binPath)                   // R2 修订（SA2 #1 CRITICAL）——fresh stat，无缓存：
                        //   const st = statSync(binPath, { throwIfNoEntry: false })
                        //   offset = (st !== undefined && st.isFile()) ? st.size : 0
                        //   stat 自身 throw（EACCES 等）→ 无法规划 → storage-write-failed{stage:'bin',
                        //   code:errno} + 丢弃（未尝试 append，零副作用）
                        // 预计 frameOffset（ADR sidecar 顺序第一步）；EISDIR 目录占位时 isFile()=false
                        // → offset=0，随后 append 必抛 EISDIR → record 连同该 offset 一并丢弃——
                        // 绝无「目录 st_size(4096) 当文件长」的错位引用
          carrier = { storage:'sidecar', format:'yjs-update-v1',
                      segment:'00000001', frameOffset:String(offset),
                      payloadLength:b.length, crc32c:crc32cHex(b) }
  effective = lineBudgetGate(record)
                          // 超限 → input full/redacted 降级 digest+degraded（input-degraded 事件）；
                          // 仍超限 → 丢弃 + record-dropped/line-budget-exceeded（#148 §5.5 同款，
                          // 在 file.ts 内重建 ~40 行——§10-J10）
  vfslGate: validateLogicalSnapshot(compiled.derived, effective)
                          // 失败 → vfsl-validation-failed（只带 issuePaths/schemaId/指纹/字节数，
                          // #148 §8.2 纪律）→ 丢弃
  storageGate(effective)  // §6；失败 → storage-validation-failed → 丢弃
  line = JSON.stringify(effective) + '\n'
  if carrier.inline:
      appendFileSync(jsonlPath, line)            // 'a'；失败 → storage-write-failed{stage:'jsonl', code:errno} → 丢弃
  else:
      frame = encodeFrame(sequence, payloadBytes)   // §5；自检 decode+CRC（writer bug 防线，§6.3）
      appendFileSync(binPath, frame)                // 'a'——.bin 惰性创建；
                                                    // 失败 → storage-write-failed{stage:'bin', code:errno}
                                                    //        → 丢弃（JSONL 绝不引用未落盘帧 = BIN-first）
                                                    //        → 无缓存状态需要重同步（R2 修订 SA2 #1：offset
                                                    //          恒来自下一次 append 前的 fresh stat，故障后自愈）
      appendFileSync(jsonlPath, line)               // 失败 → storage-write-failed{stage:'jsonl'} → 丢弃
                                                    //（orphan frame 留存——ADR 明文 best-effort 崩溃窗口）
```

关键不变量：

- **BIN-first**：JSONL 引用落盘时，其 frame 已完整存在（append 成功返回后）。崩溃可留 orphan/不完整 frame——ADR 明文允许。
- **offset 无内存-磁盘孪生状态（R2 修订 SA2 #1）**：sidecar 的 `frameOffset` 恒取自该 record append 前对 `.bin` 的 fresh stat（文件感知：`statSync(binPath, { throwIfNoEntry:false })` + `isFile()`，非常规文件按 0 计且随后 append 必败而连同 record 丢弃）。单进程单 writer（ADR 部署约束）内无 TOCTOU；任何写失败/外部截断/EISDIR 目录占位之后的下一次 append 自动从真实文件尾续写——**瞬态故障不再固化为永久错位**（R1 的 binLength 缓存重同步把「失败后状态未知」伪装修复完成，属虚假恢复，已废除；「statSync(目录) 返回非零 st_size 不抛错」的行为假设已补登 §13）。
- **emit 返回 = 落盘完成**（§4.3）。
- 每条 record 的 JSONL/BIN 写都是**独立 open-append-close**，无常驻 fd（§4.3/J2）。
- **exhausted 单向门闩（R2 回写总控 J9 裁决）**：转换时刻恰一次 `stream-exhausted`；此后 append（含 `injectFinalRecordFile` 注入）静默丢弃，不逐条发事件（§10-J9）。

### 4.2 genesis 内部构造（不改 schema；#148 §10-J1 备案的落地）

触发：`config.genesisUpdateBytes !== undefined`。构造于新 stream 初始化期（§3.2 ⑤），走与 attempt **同一条** final-record 管线（line 预算 → VFSL → storage 门 → 落盘），仅 assemble 不同：

```text
genesis 守卫（先于 record 构造；genesis 无 update-omitted 逃生门——schema 强制 update: UpdateCarrier）：
  genesisUpdateBytes.length === 0          → 跳过 genesis（sequence '1' 已消耗 → attempt 从 '2' 起，§10-J3）
  genesisUpdateBytes.length > payloadCap   → 跳过 genesis（同上；ADR「genesis 超限只记录 update-omitted/
                                              payload-too-large，不改变原业务提交」在 genesis 侧的可表达上限
                                              就是「无 genesis 记录、不虚假完整重放」）
record = {
  recordKind: 'genesis-baseline', streamId, sequence: allocate(),
                          // R2 修订：与 attempt 同一 allocate()（null→'1'，否则 nextDecimal）——
                          // 新 stream 即 '1'（SA6 断言），预置接缝（§6.3）下与 attempt 路径一致推进，
                          // 无硬编码特例；预置 + genesis 组合时转换时刻可能在构造期触发（一致性无损）
  observedAt: observedAtFrom(clock.now),    // 结构兼容注入 Clock；默认 Date.now；异常被 §3.1 构造级
                                            // catch-all 收编（R2 修订 SA2 #2）
  source: { kind: 'local' },                // 无 context / 无 attemptId / operation / stage / result / input
  update: carrier,                          // inline/sidecar 判定与 attempt 同一规则（> inlineUpdateMaxBytes
                                            // → sidecar，offset 取 fresh stat——新 stream 恒 0）
}
```

- genesis 的 inline/sidecar 选择、CRC、VFSL、storage 门、落盘顺序与 attempt 完全同一代码路径——只有 record 构造形状不同（`DiagnosticChangeRecord` 联合的另一成员）。
- genesis 与 `updateCapture` 配置**正交**（§10-J4）：`updateCapture` 管的是 attempt 的 result update 捕获策略；`genesisUpdateBytes` 是 Host 显式提供的 stream 基线，提供即意图。
- genesis 任何失败（守卫跳过 / IO 失败）都**不禁用** stream：attempt 照常、无虚假完整重放（ADR「genesis 未成功写入时 stream 仍可记录诊断事实」）。IO 失败发 `storage-write-failed{stage:'bin'|'jsonl'}`（operation 缺省——genesis 无 operation）。
- **R2 修订（SA2 #7）——守卫跳过的可观察性备案（豁免，§11-G10）**：守卫跳过（empty/超 payloadCap）不发事件。理由：(a) ADR 对 genesis 的措辞是「尽力先记录」——缺失是合法终态而非故障，与 ADR 0012「丢弃**并上报**」仅约束 record 丢弃路径不同；(b) 可判别性已有工具面出口：读 JSONL 首行 `recordKind ≠ 'genesis-baseline'` 即知无 genesis（README 判别法，§12）；(c) 静默面收窄到「Host 配置自洽可查」的两种输入（0 字节 / 超 `min(payloadMaxBytes, uint32)`——两者都是 Host 已知量）；(d) 事件词表冻结纪律（总控 G1 同款保守取向）。若总控要求事件化，属词表演进（新联合成员），非本票默认。
- 字节所有权：genesis 在构造函数返回前同步消费完毕，Host 构造后变异不影响已落盘内容（无需额外 slice；emit 路径的 intake 复制隔离由 #148 管线保证）。

### 4.3 同步落盘契约（SA6 实现期约束 #1 的采纳）

**裁决：#152 writer 为「每 record 同步 write、无队列、无 batch、无 fsync、无常驻 fd」。**

| 设计点 | 取值 | 依据 |
|---|---|---|
| emit 返回时落盘 | 是（`appendFileSync` 返回 = 字节已入文件） | SA6 §5.1 明文允许「可为无 fsync 的同步 write」；红灯测试全部以 emit 后即读文件断言 |
| 队列 | 无 | 同步写使队列退化为直通；ADR「writer queue 满时 drop newest」vacuous；`record-dropped.reason` 两值词表不动 |
| batch/flush | 无 | ADR「默认周期 batch flush」是异步部署形态的默认；本票按 SA6 锚定取同步形态，公共面（emitter/config）不变，后续票可在同一面后替换为队列+后台 flush |
| fsync | 恒关 | ADR「真正 fsync 可配置且默认关闭」；#152 不暴露开关（YAGNI，留给需要持久性承诺的部署票） |
| 文件句柄 | 每 record open-append-close，无常驻 fd、无 LRU | (a) EISDIR 占位恢复测试要求：目录移除后下一次 append 必须成功——常驻 fd 会继续写已 unlink 的 inode；(b) ADR「文件句柄可由 LRU 管理」是可选优化；(c) 诊断日志频度下 per-record open 成本可接受 |

emit 的有界性：单次 append 的 CPU+IO 以 `lineBudgetBytes`（默认 1 MiB）+ payload 上限为界；`emit` 同步、void、不抛（整管线 try/catch；顶层 `pipeline-crashed{stage:'adapter'}` 兜底）——ADR 0011 emitter seam 契约完整保持。**接线期注意（SA8 设计后复审备案，转 #149–#151）**：同步 emit 含有界磁盘 IO，emit 调用点须置于 namespace write sequencer 槽外或槽后（ADR 0011「adapter 慢…不得延长 write slot」）；默认 `updateCapture:false` 下常规 emit 载荷仅 ≤1 MiB JSONL 行。

**R2 修订（SA2 #10，INFO）——并发读写语义声明**：`appendFileSync` 的 1 MiB 级行在内核侧可能拆为多个 `write(2)`，**并发运行中的 reader 可能读到半行**（→ `invalid-json` 误判）。ADR 未对日志施加快照一致性要求；本票契约：strict reader 面向**静态 stream**（writer 停写后/离线拷贝上使用），不承诺与活跃 writer 的并发一致性。此声明落 README（§12）。

### 4.4 每阶段失败语义表（事件 / record 去留 / sequence 消耗）

| 阶段 | 失败样例 | 事件 | record | sequence |
|---|---|---|---|---|
| 三守卫 | empty / disabled / too-large | 无（转 update-omitted，record 保留） | 落盘 | 消耗（在 record 内） |
| line 预算 | 降级后仍超限 | `record-dropped/line-budget-exceeded` | 丢弃 | 消耗（gap） |
| 降级 | input full/redacted → digest | `input-degraded` | 落盘（降级形） | 消耗（在 record 内） |
| VFSL 门 | 形状违规（writer bug） | `vfsl-validation-failed`（只带 issuePaths） | 丢弃 | 消耗（gap） |
| storage 门 | inline base64/length/crc/streamId；sidecar 引用自检 | `storage-validation-failed` | 丢弃 | 消耗（gap） |
| offset 规划【R2 修订 SA2 #1】 | `planFrameOffset` 的 stat throw（EACCES 等） | `storage-write-failed{stage:'bin', code:errno}` | 丢弃（未尝试 append） | 消耗（gap） |
| BIN append | EISDIR/ENOSPC/EROFS | `storage-write-failed{stage:'bin', code:errno}` | 丢弃（无 JSONL 引用） | 消耗（gap） |
| JSONL append | EISDIR/ENOSPC | `storage-write-failed{stage:'jsonl', code:errno}` | 丢弃（orphan frame 可能留存） | 消耗（gap） |
| exhausted 门闩【R2 修订 SA2 #4】 | 转换后到达的 append（含注入） | 无（转换时刻已发 `stream-exhausted`，不逐条） | 丢弃 | 不消耗（无分配发生） |
| manifest/current 初始化 | EEXIST/EACCES | `storage-write-failed{stage:'manifest'\|'current'}` | —（流级） | — |
| 顶层异常（append 面） | 任意 throw | `pipeline-crashed{stage:'adapter'}` | 丢弃 | 可能已消耗（gap） |
| 顶层异常（构造面）【R2 修订 SA2 #2】 | clock throw/NaN/超域、randomSource throw、config 垃圾 | `pipeline-crashed{stage:'adapter'}`（恰一次） | —（failed 模式） | — |

所有事件走 `makeEventNotifier`（构造后冻结 + `safeNotify` 隔离——observer 必 throw 测试由此通过：emit 不抛、`DIAGNOSTIC_LOG_OBSERVER_FAILED` 行进 fallbackLog）。

---

## §5 NDCL v1 frame codec（`src/frame.ts`）

纯 TS（Uint8Array + DataView + 既有 `crc32c`），零环境绑定：

```ts
export const FRAME_HEADER_BYTES = 25
export const PAYLOAD_TYPE_YJS_UPDATE_V1 = 1

export function encodeFrame(sequence: string /* 十进制 */, payload: Uint8Array,
                            opts?: { frameVersion?: number; payloadType?: number;
                                     flags?: number; reserved?: number }): Uint8Array
export interface DecodedFrame { magic: string; frameVersion: number; payloadType: number; flags: number;
                                 reserved: number; sequence: bigint; payloadLength: number;
                                 crc32c: number; payload: Uint8Array }
export function decodeFrame(bin: Uint8Array, offset: number): DecodedFrame   // 越界 throw（调用方先做界内判定）
export function frameCrcOf(bin: Uint8Array, offset: number): number          // header前21B+payload 重算
```

- sequence 以 **BigInt** 装载（uint64 全域无 number 失真；与 #148 `nextDecimal` 的十进制字符串纪律同源——JSONL 侧字符串、frame 侧 uint64 BE，两域互译不经 number）。
- `encodeFrame` 允许注入非默认 frameVersion/payloadType/flags/reserved 仅服务**测试夹具已经存在的同构实现**；生产路径恒用默认 v1 值（writer 侧无注入点）。
- 与 SA6 `test/helpers/frame.ts` 的实现三方同构（writer/reader/测试各自独立可校验——ADR「JSONL 与 frame 双重结构及 CRC 提供较强的随机损坏、错位和坏尾诊断」的交叉验证基础）。

---

## §6 storage 校验门与共享原语

ADR 0012 分工：VFSL 负责封闭对象/判别联合/literal enum/Pattern/十进制字面/Base64 与 CRC **字面形状**；storage validator 负责**严格 decode、长度一致、CRC 正确、跨域一致、offset/segment/边界/连续性**。本票 storage 校验原语收口在 `src/storage-gate.ts` + `src/carrier.ts`（decode 侧），writer 门与 reader 复用同一实现（防双份漂移）。

### 6.1 canonical Base64 判定（`carrier.ts` 新增 `decodeBase64Strict`）

```text
decodeBase64Strict(s): Uint8Array | null
  s 为空 / length % 4 ≠ 0 / 含 [^A-Za-z0-9+/=] / padding 位置非法 → null
  decoded = Buffer.from(s, 'base64')          // Node 解码器宽松（跳过非法字符）——不可单独信任
  Buffer.from(decoded).toString('base64') ≠ s → null      // decode→re-encode 恒等 = canonical 判定
                                                                    //（拒 'AB==' 类非规范 pad bits、内部空白）
  return decoded
```

依据：Node `Buffer.from(s,'base64')` 是宽松解码器（RFC 4648 之外的输入也被吞掉）；SA6 helper `isCanonicalBase64`（`test/helpers/frame.ts:117`）即此算法，红灯测试 'AB==' 与「内部空白」两用例锚定该判定为契约。Base64 的 Buffer 使用收口在 carrier.ts（§1.5）。

### 6.2 inline 全量校验（writer 预落盘门 = reader 事后校验，同一函数）

```text
validateInlineCarrier(carrier, expectStreamId): 'ok' | 'base64-invalid' | 'base64-length-mismatch' | 'crc-mismatch'
  bytes = decodeBase64Strict(carrier.base64)   → null ⇒ 'base64-invalid'
  bytes.length ≠ carrier.payloadLength          ⇒ 'base64-length-mismatch'
  crc32cHex(bytes) ≠ carrier.crc32c             ⇒ 'crc-mismatch'
  （streamId 交叉在调用方：record.streamId ≠ 本 stream ⇒ 'stream-mismatch'）
```

writer 在 **append 之前** 对 inline record 运行（AC3「Final physical records pass … storage validation before append」——injectFinalRecordFile 四类 storage 违规全部零落盘即此门）；reader 对每条 inline record 运行同一函数（§7.3）。

### 6.3 sidecar 校验的双面分工

- **writer 预落盘（emission 路径）**：frame 尚不存在——门内容为「自检」：`encodeFrame` 后立即 decode + CRC/length/sequence 复核（writer bug 防线，失败 → `storage-validation-failed{code:'crc-mismatch'}`，正常不可达）。随后 BIN-first 落盘。
- **writer 预落盘（`injectFinalRecordFile` 注入路径）**：record 携带现成 sidecar 引用而无 payload 源——门内容为「存在性交叉」：按引用读 bin、按 §7.4 全量校验该帧（sequence/length/CRC 与引用一致）→ 通过则 append JSONL（BIN-first 天然满足：帧已存在）；不通过（帧缺失/不符）→ 丢弃 + `storage-validation-failed{code:'frame-missing'}`（R2 注：code 词表第 5 值已获总控 G3 裁决批准，§11-G3 + 文末裁决表）。
- **reader 事后**：§7.4 全量交叉。

`injectFinalRecordFile` 语义（复制 #148 `injectFinalRecord` 全部门序，R2 修订 SA2 #6）：`mode ≠ ready`（disabled/failed/exhausted 门闩）→ **静默丢弃**；ready 模式下直通 storage projection 后半段——**line 预算门（含 input full/redacted 降级 + `input-degraded`/`record-dropped` 事件，与 #148 `appendFinal`→`gateAndEnqueue` 同款）→ VFSL 门 → storage 门 → 落盘**；**不分配 sequence、不推进 lastSequence**（注入 record 自带 streamId/sequence；测试用接缝，重复 sequence 可能性由测试自负）；亦不触碰 exhausted 门闩（无分配即无转换）。经 `FILE_INTERNAL` Symbol 访问 file adapter 内部（与 #148 `INTERNAL` 同款模式）。

**R2 新增（SA2 #4 红灯构想配套）——sequence 预置接缝**：`testing.ts` 追加导出

```ts
export function createFileDiagnosticLogPresetSequence(
  config: FileDiagnosticLogConfig, lastSequence: string): FileDiagnosticLog
```

实现 = 内部工厂 `createFileLog(config, { presetLastSequence })`（镜像 #148 `createMemoryLog` 的 options 模式；生产构造器内部函数化，options 不进公共面）。用途：预置 `lastSequence = UINT64_MAX − 1` → 首次 emit 落盘 sequence = UINT64_MAX 且恰一次 `stream-exhausted`；再 emit 零落盘且不再发该事件。

---

## §7 strict reader（`src/reader.ts`）

### 7.1 算法总流程

```text
readStreamStrict({ rootDir, namespaceId, streamId }): StrictStreamRead   // 纯同步函数，不抛
                                                       // R2 修订（SA2 #3）：全函数 try/catch 兜底（见⑧）
  ① 路径安全：namespaceId 安全文法 ✗ 或 streamId 文法 ✗
       → { status:'corrupt', manifest:null, records:[], issues:[{code:'locator-invalid'}] }（零 fs 触达）
  ② manifest = tryReadJson(manifestPath)
       ENOENT/不可读/JSON ✗/非对象 → { status:'corrupt', manifest:null, records:[],
                                      issues:[{code:'manifest-invalid'}] }        // 不解释无法自描述的 stream
  ③ manifest 门（对照内建冻结常量——「manifest 不得改变运行中 writer 规则」的 reader 对称面：
     reader 只信任内建冻结 schema，manifest 只作声明被核对）：
     —— 结构严格度【R2 修订 SA2 #8，裁决记 §11-G8】：恰 14 键（键集精确等于 §2.2 表——多余键/缺失键均拒）
        + 每键类型核对（streamId/namespaceId 为 string 且过各自文法、createdAt 过 P_ISO_MS、schema 为
        恰四键对象、committedUpdateCapture 为 boolean、inputCapturePolicy ∈ 四值词表、
        inlineUpdateMaxBytes/jsonlLineLimitBytes 为 finite number、schemaFingerprint 为 string……）
        ——任何类型/结构违规 → corrupt + manifest-invalid + records:[]（唯一例外：schemaFingerprint 是
        string 但 ≠ 冻结常量 → 归 schema-fingerprint-mismatch，见下）
     —— 身份互核【R2 修订 SA2 #5，裁决记 §11-G7】：
        manifest.streamId ≠ 实参 streamId ∨ manifest.namespaceId ≠ 实参 namespaceId
                                   → corrupt + stream-mismatch（stream 级）+ records:[]（身份误归因
                                     风险下不逐条解释；manifest 仍展示）
     —— 版本/信封核对：
       format ≠ 'ndcl-manifest' ∨ version ≠ 1                    → corrupt + manifest-invalid + records:[]
       schema.lang ≠ 'vfsl' ∨ schema.version ≠ 1                → incompatible + dialect-unknown + records:[]
       schema 信封 ≠ RECORD_SCHEMA_ENVELOPE（四键逐字）
         ∨ schemaFingerprint ≠ 冻结常量 ∨ schemaId ≠ manifest.schema.id（自述不自洽）
                                                                 → incompatible + schema-fingerprint-mismatch + records:[]
       recordVersion ≠ 1                                        → incompatible + record-version-unknown + records:[]
       frameVersion ≠ 1                                         → incompatible + frame-version-unknown + records:[]
     （incompatible 分支 manifest 仍原样展示——ADR「reader 可展示 manifest 和原始文件元数据」）
  ④ segmentFiles 枚举【R2 修订 SA2 #3——fs 错误包络】：
       readdirSync(segmentsDir) throw（ENOENT/EACCES/ENOTDIR/EISDIR…）
                                   → corrupt + manifest-invalid + records:[]（构造协议保证 segments/ 与
                                     manifest 同时创建——§3.2 顺序；其缺失/不可读与 manifest 缺失同属
                                     「stream 自描述结构不可用」；裁决记 §11-G9）
       正常 → 文件名去扩展后匹配 ^[0-9]{8}$ 的基名集合（jsonl/bin 任一存在即算存在），升序（8 位定宽
              十进制 → 字典序 = 数值序）
  ⑤ 逐 segment（升序）、逐行（split('\n')，尾随空块丢弃；无 '\n' 结尾的残尾块按一行处理——JSON parse
     大概率失败 → invalid-json，崩溃窗口的诚实呈现）：
       jsonl 读语义【R2 修订 SA2 #3】：
         readFileSync(jsonl) ENOENT → 该 segment 按零行处理、无 issue（合法崩溃窗口：BIN-first 先帧后行，
           「有 bin 无 jsonl」的段是设计内残态——④ 的存在性集合已计入 bin-only segment）
         readFileSync(jsonl) 其他 throw（EISDIR 目录占位/EACCES…）
                                   → stream 级 issue invalid-json（segment 归因——StrictReadIssue.segment）、
                                     该段零 record 条目；其余可读段照常报告（multi-segment 前向兼容）
       A. JSON.parse ✗ → recordRead{ ok:false, record:null, sequence:'', issues:[invalid-json] }
       B. VFSL：validateLogicalSnapshot(compiled.derived, parsed) ✗ → vfsl-invalid（含前导零 sequence：
          P_DECIMAL 拒 '01'；词表外 operation；坏 streamId 字面……）
       C. storage 交叉（VFSL 过后才做）：
          record.streamId ≠ streamId 实参                        → stream-mismatch
          inline carrier → §6.2（base64-invalid / base64-length-mismatch / crc-mismatch）
          sidecar carrier → §7.4 帧交叉
       D. recordRead.record = parsed（可解析即报告，ok 与 issues 表达判定；「不近似解释」指不假装连续/可重放，
          不指隐瞒已解析对象）
  ⑥ stream 级：跨 segment 拼接后 sequence 必须严格递增（BigInt 数值比较；乱序/重复 → sequence-out-of-order，
     stream 级 issue）；**gap 合法**（「sequence 仅代表 append 顺序，不证明业务尝试无缺」——丢弃记录留 gap 是
     设计内诚实信号，SA6 §5.2 明示 reader 不接受 gap 为错误）
  ⑦ 聚合：streamIssues = stream 级 ∪ 全部 record 级镜像（带 sequence/segment/offset 归因）
       any(code ∈ INCOMPATIBLE_SET) → status 'incompatible' 且 records 置 []（不近似解释、不声称连续）
       else any(issue)              → 'corrupt'（records 保留逐条判定）
       else                          → 'ok'
  ⑧ 兜底【R2 修订 SA2 #3】：readStreamStrict 全函数 try/catch——任何未归类异常（畸形 fs 状态的意外错误
     形态、reader 自身 bug）→ { status:'corrupt', manifest:已读到的|null, records:[],
     issues:[已积累的 ∪ {code:'manifest-invalid'}] }——损坏诊断工具绝不在损坏状态下自己崩；绝不抛
     （兜底码取 manifest-invalid 的「自描述结构不可用」伞义，§7.5 行注记）
```

`INCOMPATIBLE_SET = { dialect-unknown, schema-fingerprint-mismatch, record-version-unknown, frame-version-unknown, frame-payload-type-unknown, frame-flags-nonzero, frame-reserved-nonzero }`（SA6 词表边界逐字）。

### 7.2 「不近似解释」的落点

- incompatible → `records: []`：不逐条猜测、不跳过未知记录后继续声称连续（ADR 0012 §Strict reader 逐字）；manifest 照常展示（含被篡改的 schema.text——测试锚定）。
- manifest 不可解析 → 同样 `records: []`（无法自描述的 stream 不进入逐条解释；corrupt + manifest-invalid）。
- 不同 stream 互不连带：`readStreamStrict` 单 stream 作用域，无跨 stream 状态。

### 7.3 record 级校验顺序（短路链）

`JSON parse → VFSL（内建冻结 schema）→ streamId 交叉 → carrier 交叉`。顺序依据：逻辑形状先于物理交叉（ADR 分工）；测试锚定：'AB==' 过 P_BASE64（VFSL 层不拒）→ 由 storage 层 canonical 判定拒（base64-invalid）；内部空白过不了 P_BASE64 → vfsl-invalid（测试只断言 record not ok，两码皆可，取 vfsl-invalid）。

### 7.4 sidecar 帧交叉与边界语义（per-segment 状态机）

对每个 segment 维护 `expectedOffset: bigint | null`（初始 null）。record 引用 `(segment, frameOffset, payloadLength, crc32c)` 时按序判定：

bin 内容与尺寸的读取是**文件感知**的（R2 修订 SA2 #3）：`statSync(binPath, { throwIfNoEntry:false })` 非非常规文件（缺失/目录/不可 stat）⇒ 该 record 直接 `frame-missing`；stat 成功但 `readFileSync` throw（EACCES/EISDIR…）⇒ 同样 `frame-missing`（引用的帧不可读 = 帧事实缺失，ADR 门槛 11「缺BIN」的推广；裁决记 §11-G9）。

```text
1. segment ∉ segmentFiles                                  → reference-invalid（停）
2. bin 缺失 / 非常规文件 / 不可读（ENOENT·EISDIR·EACCES…）    → frame-missing（停）  // ADR 门槛11「缺BIN」
3. offset + 25 > binSize                                    → frame-missing（停）        // offset 越界
4. expectedOffset ≠ null 且 offset ≠ expectedOffset         → frame-boundary-invalid（停，不解释该帧；
                                                               expectedOffset 不变）        // gap/overlap
5. magic ≠ 'NDCL'                                           → frame-magic-invalid（停）
6. frameVersion ≠ 1                                         → frame-version-unknown（停，incompatible）
7. payloadType ≠ 1                                          → frame-payload-type-unknown（停，incompatible）
8. flags ≠ 0                                                → frame-flags-nonzero（停，incompatible）
9. reserved ≠ 0                                             → frame-reserved-nonzero（停，incompatible）
10. offset + 25 + frame.payloadLength > binSize             → frame-length-mismatch（停）// 截断帧
11. frame.sequence ≠ record.sequence（BigInt 比较）          → frame-sequence-mismatch（停）
12. frame.payloadLength ≠ carrier.payloadLength             → frame-length-mismatch（停）
13. frameCrcOf(bin, offset) ≠ frame.crc32c                  → frame-crc-mismatch（停）
14. crc32cHex(frame.payload) ≠ carrier.crc32c               → crc-mismatch（停）          // JSONL 侧声明与实际
15. 全过 → expectedOffset = offset + 25 + payloadLength；record ok
```

边界语义与 SA6 §2 逐字对齐：**首个被引用帧**（expectedOffset 为 null）不做 boundary 检查、先验 magic（「首个 frame 校验前先验 magic」）；**前一个帧校验通过后**，下一 record 的 offset ≠ 前帧 end → frame-boundary-invalid（判定先于 magic——offset 131 落在 payload 垃圾区也不误报 magic-invalid）。校验失败的帧不推进 expectedOffset（后续引用与其比较仍以前一合法帧 end 为准）。inline record 不触碰 expectedOffset。

### 7.5 issue code 全词表 → 触发条件映射（23 码封闭；SA6 词表逐字）

| code | 层 | 触发条件（本设计落点） | 归并 |
|---|---|---|---|
| `invalid-json` | record / stream | 行 JSON.parse 失败（含无 `\n` 结尾残尾块、BOM 首行）；【R2】segment jsonl 存在但读失败（EISDIR/EACCES——stream 级、segment 归因） | corrupt |
| `vfsl-invalid` | record | 内建冻结 schema 校验失败（形状/词表/Pattern/十进制字面） | corrupt |
| `base64-invalid` | record | inline carrier 非 canonical Base64（decode-re-encode 不恒等） | corrupt |
| `base64-length-mismatch` | record | decoded length ≠ payloadLength | corrupt |
| `crc-mismatch` | record | inline CRC ≠ decoded payload CRC；或 sidecar carrier.crc32c ≠ 帧 payload CRC | corrupt |
| `frame-missing` | record | bin 缺失 / 非常规文件 / 不可读【R2】/ offset+25 越界 | corrupt |
| `frame-magic-invalid` | record | offset 处 4 字节 ≠ 'NDCL' | corrupt |
| `frame-sequence-mismatch` | record | 帧 sequence ≠ record sequence | corrupt |
| `frame-length-mismatch` | record | 帧声称 payload 越EOF / 帧 payloadLength ≠ carrier payloadLength | corrupt |
| `frame-crc-mismatch` | record | 帧 CRC 重算 ≠ 存储 CRC | corrupt |
| `frame-boundary-invalid` | record | 非首帧 offset ≠ 前一合法帧 end | corrupt |
| `reference-invalid` | record | 引用 segment 不在 segmentFiles | corrupt |
| `sequence-out-of-order` | stream | 跨 segment 文件序 sequence 非严格递增（含重复） | corrupt |
| `stream-mismatch` | record / stream | record.streamId ≠ 实参 streamId；【R2】manifest 身份字段（streamId/namespaceId）≠ 实参（stream 级） | corrupt |
| `manifest-invalid` | stream | manifest 缺失/不可读/不可解析/键集或类型违规【R2：恰 14 键 + 类型核对】/format·version 异常；【R2】segments 目录缺失或不可读；【R2】reader 兜底（未归类异常的伞义码） | corrupt |
| `schema-fingerprint-mismatch` | stream | 信封/指纹字段/schemaId（自述不自洽）≠ 内建冻结常量 | **incompatible** |
| `dialect-unknown` | stream | schema.lang/version ≠ vfsl@1 | **incompatible** |
| `record-version-unknown` | stream | manifest.recordVersion ≠ 1 | **incompatible** |
| `frame-version-unknown` | record | 帧 frameVersion ≠ 1（manifest.frameVersion ≠ 1 同） | **incompatible** |
| `frame-payload-type-unknown` | record | 帧 payloadType ≠ 1 | **incompatible** |
| `frame-flags-nonzero` | record | 帧 flags ≠ 0 | **incompatible** |
| `frame-reserved-nonzero` | record | 帧 reserved ≠ 0 | **incompatible** |
| `locator-invalid` | stream | 入参 namespaceId/streamId 文法违规（零 fs 触达） | corrupt |

---

## §8 健康事件增量（`src/health.ts` 只增不改）

**R2 修订（SA2 #4）：四成员** = SA6 契约三成员（逐字）+ 总控 J9 裁决的第四成员 `{ type: 'stream-exhausted' }`（#148 §8.1 的 8 成员一字不动；「联合成员追加」演进方式）：

```ts
| { type: 'stream-init-failed'; code: 'LOG_STREAM_INIT_FAILED';
    reason: 'invalid-namespace-id' | 'invalid-stream-id' | 'manifest-mismatch' | 'manifest-missing' }
| { type: 'storage-validation-failed'; recordKind: 'attempt' | 'genesis-baseline';
    operation?: Operation; code: string }   // code ∈ { base64-invalid | base64-length-mismatch | crc-mismatch |
                                            //        stream-mismatch | frame-missing }
                                            //（前四值 SA6 锚定；frame-missing 总控 G3 裁决扩值——注入 sidecar
                                            //  引用帧缺失的 loud 拒绝，复用 reader 词表既有稳定码）
| { type: 'storage-write-failed'; stage: 'bin' | 'jsonl' | 'manifest' | 'current';
    operation?: Operation; code: string }   // code = 稳定 errno 码（'EISDIR'/'ENOSPC'/'EEXIST'…），不含底层 message
| { type: 'stream-exhausted' }              // 【R2 回写总控 J9 裁决】零附加字段；exhausted 转换时刻恰发一次
                                            //（bool 门闩 + 事件抑制，与 failed 模式同纪律，不逐条发）
```

纪律保持：全部经 `makeEventNotifier`（freezeEvent + safeNotify）；低基数字段白名单不变（type/reason/stage/recordKind/operation/code/errno——均为固定词表或稳定 errno）；`streamId`/`namespaceId` 不进事件（#148 §8.2）；同一 JSONL 中不写递归 health record（本票日志面只写 storage record）。`operation` 在 genesis 与词表外注入时缺省（与 #148 R4/C-5 形状事实一致）。errno 提取：`(err as NodeJS.ErrnoException).code`（string 则原样，否则 `'EUNKNOWN'` 兜底字面量——不上抛 message）。

---

## §9 测试映射（SA6 红灯 ↔ 设计锚点）

| SA6 测试文件 / 组 | 锚定设计节 | 关键机制 |
|---|---|---|
| `file-adapter-layout.test.ts` AC1 | §2.1–§2.3、§3.1–§3.3 | 构造即建三件套；manifest 14 键（信封 === `RECORD_SCHEMA_ENVELOPE`、指纹钉死）；恰三键 current；无 tmp 残留；emit 前后 manifest 字节恒等（只在 `'wx'` 写一次）；.bin 惰性（appendFileSync 'a'）；确定性随机源同 id；6 敌意 namespaceId → 零文件 + 恰一次 `stream-init-failed/invalid-namespace-id` + emit 不抛（disabled 模式静默 sink） |
| `file-adapter-inline-sidecar.test.ts` 门槛 1/2/3 | §4.1、§5、§6.2 | 4096B inline 逐字段 + canonical Base64 + CRC + VFSL 孪生 + 无 BOM/\n 结尾；4097B sidecar 25B header 逐字节 + CRC 输入域 + payload 恒等；双帧 offset 递推（**R2：fresh stat 前值 + 帧长**）；BIN-first 帧完整性；4096↔4097 与自定义 7↔8 边界（≤ 内联、> sidecar） |
| `file-adapter-genesis-results.test.ts` 门槛 4 + genesis | §4.1–§4.2 | 8 result 分支落盘且过 VFSL 孪生；rejected/fatal+false 无 update 键（schema 封闭对象机器强制）；三守卫 update-omitted 保 metadata 且 empty-update 无 vfsl-validation-failed；genesis sequence 1 / 形状（无 attemptId/operation/stage/result/input）/ 固定时钟 observedAt / 大 update 走 sidecar offset 0；不提供 genesis → attempt 从 1 起 |
| `file-adapter-strict-reader.test.ts` AC4 | §7 全节 | 正例 ok；六类 incompatible（records 空 + manifest 展示）；JSON/VFSL/stream-mismatch/inline 四类；sidecar 帧九类（缺 bin/越界/magic/sequence/length/CRC/边界/引用段不存在/纯侧车正例）；sequence 乱序/重复/前导零；manifest 不可解析 |
| `file-adapter-mismatch-interference.test.ts` 门槛 10 + AC3/AC5 | §3.1④、§3.4、§4.4、§6.3、§8 | VFSL 门注入（issuePaths + 零落盘）；storage 门四类注入（零落盘）；注入与合法 emit 互不干扰 + reader ok；.bin EISDIR → 不抛 + 零 sidecar 引用 + `storage-write-failed{stage:'bin'}` + 恢复后交叉一致（**R2：offset 恒 fresh stat——恢复后新帧引用真实落点 0** + gap 合法）；jsonl 占位同；observer 必 throw → fallback 稳定码行；resume 指纹不匹配 → 新 generation + 旧 manifest 字节恒等 + 旧 segments 零写入 + current 指新 stream + 旧 stream reader incompatible |

### R2 补充测试映射（SA6 域外；SA2 R1 红灯构想，SA3 实现期落地）

| 补充测试（源：SA2 攻击点） | 锚定设计节 | 关键断言 |
|---|---|---|
| EISDIR 恢复变体（#1）：成功帧(125B) → EISDIR → 恢复 → 再写；外部 `truncate(bin,50)` 后再写 | §4.1 offset 不变量 | 新帧 `frameOffset === "125"`（truncate 变体 === 真实 EOF）且 reader ok——fresh-stat 自愈语义 |
| 构造 crash 三连（#2）：`clock: {now: () => {throw}}` / `() => NaN` / `() => 8.64e15+1` | §3.1 构造级 catch-all | 不抛；`log.streamId` 合法；events 恰一次 `pipeline-crashed{stage:'adapter'}`；emit 不抛且零落盘 |
| reader fs 包络（#3）：删 segments 目录 / jsonl 目录占位 / bin 目录占位 | §7.1④⑤、§7.4 | `readStreamStrict` 不抛 + corrupt + 稳定码（manifest-invalid / invalid-json{segment} / frame-missing） |
| exhausted 转换（#4）：`createFileDiagnosticLogPresetSequence(config, UINT64_MAX−1)` | §4.1 转换时刻、§6.3 预置接缝 | 首次 emit 落盘 sequence=UINT64_MAX 且恰一次 `stream-exhausted`；第二次零落盘且不再发；reader 对首条 ok |
| manifest 身份/严格度（#5/#8）：manifest.streamId/namespaceId 篡改（空 records）；第 15 键；`inlineUpdateMaxBytes:"4096"` | §7.1③ | 前者 corrupt + stream 级 `stream-mismatch` + records []；后两者 corrupt + `manifest-invalid` |
| 注入超预算（#6）：`injectFinalRecordFile` 大 record | §6.3 | 零落盘 + `record-dropped/line-budget-exceeded`（对齐 #148 appendFinal） |

SA6 红灯失败根因四条（缺导出/缺 injectFinalRecordFile/缺三事件成员/级联 any）全部由 §1.2/§6.3/§8 的导出面直接消解（第四成员 `stream-exhausted` 为总控 J9 裁决增补，红灯不锚定、仅预置接缝可触达）。

---

## §10 judgement calls 清单

| # | 决策 | 性质 | 风险与缓解 |
|---|---|---|---|
| J1 | 同步写契约：无队列、无 batch、emit 返回即落盘（不 fsync） | 依 SA6 §5.1 明文授权 | ADR「默认周期 batch flush」是异步形态默认；公共面（emitter/config）不变，后续票可在同面后替换；emit 有界性由 line 预算+payload 上限保证 |
| J2 | 无常驻 fd：每 record open-append-close | 判断 | EISDIR 恢复语义的必要条件（常驻 fd 写已 unlink inode）；per-record open 成本换正确性；ADR LRU 是可选优化 |
| J3 | sequence 分配即消耗（含 genesis 守卫跳过、全部丢弃路径） | 依 SA6 §5.2 裁决 + ADR「准备 append 时才分配」 | gap 是诚实信号、reader 不视 gap 为错；genesis 失败后 attempt 从 '2' 起（SA6 明示未锚定、属 SA1 空间） |
| J4 | genesis 与 updateCapture 正交 | 判断（SA6 未锚定） | `genesisUpdateBytes` 是 Host 显式意图；updateCapture 管 attempt 捕获策略；若总控否决，改为一处守卫（+3 行） |
| J5 | resume 指纹匹配 → 静默新建 generation | 判断（§3.4 论证） | 无事件的可诊断性缺口以 §11-G1 显式备案交总控；#153 落地真续写后该分支消失 |
| J6 | disabled 模式仍生成 streamId | 判断 | 对象形状完备（readonly 三字段恒有值）；无磁盘产物；确定性随机源下无副作用 |
| J7 | manifest 碰撞经 `'wx'` EEXIST 检测，≤8 次重试，耗尽 disabled + `storage-write-failed{stage:'manifest',code:'EEXIST'}` | 依 ADR「碰撞时有限重试；耗尽只使日志能力不可用并上报」 | 不发明新 reason（词表冻结）；确定性随机源下有界退出不死循环 |
| J8 | payload 守卫取 `min(payloadMaxBytes, 0xFFFFFFFF)` | 依 ADR「可配置但不得超过 uint32」 | 物理上限 clamp，非静默降级（frame 无法表达的配置值无合法语义） |
| J9 | **R2 回写总控裁决（2026-08-28）**：exhausted = 独立成员 `{ type:'stream-exhausted' }`（零附加字段），转换时刻（allocate 产出 UINT64_MAX 的那次 append，无论该 record 后续落盘成败）恰发一次，此后静默（bool 门闩 + 事件抑制，与 failed 模式同纪律） | 依总控 J9 裁决（#148 §10-J13 预授权的联合成员追加）+ ADR 0012「丢弃**并上报**」 | 物理不可达（~10¹⁹ 次 append）；仅 testing 预置接缝（§6.3）可驱动；内存 adapter 维持既有 stats 计数不动（裁决原文） |
| J10 | line 预算/VFSL 门逻辑在 file.ts 重建（~40 行），不从 memory.ts 提取共享 | 判断 | #148 冻结面（memory.ts/pipeline.ts）不可改是更强约束；两处注释互指 + 双测试集锚定防漂移 |
| J11 | reader 扫描全部 `^[0-9]{8}$` segment（writer 恒写 00000001） | 判断 | reader 面向布局而非 writer 版本史；#153 rolling 落地时 reader 契约零改动 |
| J12 | 三组件文法复用 `schema-patterns.ts` 常量（P_STREAM_ID/P_SEGMENT/P_DECIMAL） | 依 #148 §3.2 单源纪律 | schema Pattern 与 TS 校验永不漂移；namespaceId 安全文法在 paths.ts 实现（对齐 registry isMinimalSafeString，不 import registry） |
| J13 | JSONL line 用 `JSON.stringify`（固定构造顺序、不承诺 canonical bytes） | 依 ADR「writer 使用固定构造顺序…reader 不得依赖键顺序」 | reader 全程不依赖键序（VFSL 按形状校验） |

---

## §11 规格缺口 / 对 SA6 契约的异议与裁决建议

> **R2 注**：G1–G6 已由总控 2026-08-28 裁决（见文末「总控裁决」表）：六项全部批准设计默认取值，其中 G3 的 `frame-missing` 扩值获批。下表为 R1 原文（备查）；G7–G10 为 R2 新增定稿行（SA2 授权 SA1 定稿）。

| # | 缺口/异议 | 本设计默认取值 | 备选与建议 |
|---|---|---|---|
| G1 | **resume 指纹匹配时无事件**：SA6 `stream-init-failed.reason` 四值词表无「匹配但因 #152 无续写能力而新建」的位；静默 forking 健康 stream 有可诊断性损失 | 匹配 → 静默新建 generation（严格落在 SA6 冻结词表内；红灯测试不受影响） | 建议总控裁决是否在 #152 即追加第 5 reason（如 `'resume-unsupported'`，TS 联合只增不改、零测试影响）；若否，#153 落地续写时该分支自然消失。**SA1 不擅自扩词表** |
| G2 | genesis 失败的 sequence 消耗（SA6 明示属 SA1 空间、未锚定） | 分配即消耗：genesis 守卫跳过后 attempt 从 '2' 起（gap 诚实信号，与 attempt 丢弃路径同构） | 备选：守卫前置跳过不消耗（attempt 从 '1' 起）——两态都满足 SA6 断言；取本设计是为单一「分配即消耗」纪律 |
| G3 | `storage-validation-failed.code` 词表（SA6 注释锚定 4 值）无法表达注入 sidecar carrier 的帧缺失拒绝 | 注入 sidecar 引用帧不存在 → 丢弃 + `code:'frame-missing'`（复用 reader issue 词表既有稳定码；loud 优于静默——测试装配缺陷不应静默吞） | 若总控否决扩值：退回静默丢弃（不推荐，违背「拒绝虚假降级」立法精神）；类型本为 `code: string`，扩值零破坏 |
| G4 | manifest 自身 format/version 异常（非 schema 面）无专属 incompatible 码 | `manifest-invalid`（corrupt）+ records:[]——不发明 `manifest-version-unknown` | 词表演进留给真需要区分的票；corrupt 语义已诚实（无法自描述） |
| G5 | reader 对敌意入参（namespaceId/streamId 文法违规）无锚定 | `corrupt + locator-invalid` + 零 fs 触达（防御性路径检查优先于任何磁盘访问） | 与 writer 侧「不启用」对称；不存在静默另存路径 |
| G6 | writer 无队列 → ADR「writer queue 满时 drop newest」在 #152 vacuous | 如实文档化（§4.3/J1）；`record-dropped.reason` 两值不动 | #153+ 若引入异步 writer，需同步引入 queue-full 事件与背压测试（不在本票） |

**R2 修订新增行（源：SA2 R1 MINOR #3/#5/#7/#8——SA2 明示「SA1 定稿并记 §11」授权；总控复审时可推翻）：**

| # | 缺口/裁决 | 定稿取值 | 理由 |
|---|---|---|---|
| G7（SA2 #5） | manifest 身份字段与实参的互核无锚定 | `manifest.streamId ≠ 实参 ∨ manifest.namespaceId ≠ 实参` → corrupt + **stream 级 `stream-mismatch`** + records:[]（manifest 仍展示）；`schemaId ≠ manifest.schema.id`（自述不自洽）→ 并入 `schema-fingerprint-mismatch`（incompatible） | 复用 23 码词表既有两码，零扩码；身份误归因风险下不逐条解释（与 manifest-invalid 同纪律）；stream-mismatch 的「身份不符」语义天然覆盖 manifest 层 |
| G8（SA2 #8） | manifest 严格度（多余键/类型错误是否拒） | **恰 14 键 + 每键类型核对**（§7.1③）：第 15 键/缺键/类型不符（如 `inlineUpdateMaxBytes:"4096"`）→ corrupt + `manifest-invalid` + records:[]；唯一例外：`schemaFingerprint` 为 string 但值 ≠ 冻结常量 → `schema-fingerprint-mismatch`（incompatible——身份面归身份码） | 严格形消除「`"4096"` 字符串过门 → ok」的假阳性；manifest 是 writer 单一构造点产物（§2.2），任何偏差都是损坏/篡改信号，宽忍无收益 |
| G9（SA2 #3） | reader fs 错误的码映射（词表封闭约束下） | segments 目录缺失/不可读 → `manifest-invalid`（构造协议保证其存在——§3.2；与 manifest 缺失同属「自描述结构不可用」伞义）；segment jsonl 读失败（EISDIR/EACCES）→ stream 级 `invalid-json`（segment 归因；该段零 record 条目）；jsonl **ENOENT** → 零行无 issue（合法 BIN-first 崩溃残态）；bin 缺失/非常规文件/不可读 → `frame-missing`（引用帧不可读 = 帧事实缺失）；全函数 try/catch 兜底 → corrupt + `manifest-invalid` | 23 码内复用、零扩码；每码与既有语义面最大贴合；「jsonl ENOENT 合法 vs segments 目录 ENOENT corrupt」的区分依据 = writer 构造协议对两者的不同保证（目录协议保证存在、文件惰性创建） |
| G10（SA2 #7） | genesis 守卫跳过（empty/超 payloadCap）零可观察性 | **豁免备案**：不发事件。判别法文档化——读 JSONL 首行 `recordKind ≠ 'genesis-baseline'` 即知无 genesis（README 声明，§12）；静默面收窄到 Host 配置自洽可查的两种输入（0 字节 / 超 `min(payloadMaxBytes, uint32)`） | (a) ADR 对 genesis 措辞是「尽力先记录」，缺失是合法终态而非故障——与 record 丢弃路径的「丢弃**并上报**」义务不同源；(b) 词表冻结纪律（总控 G1 同款保守取向）；(c) IO 型 genesis 失败已有 `storage-write-failed` 事件（§4.2），静默的仅守卫前置跳过；(d) 若总控要求事件化，属新联合成员的词表演进，非本票默认 |

---

## §12 文件清单（File Scope）

### ALLOW LIST

- `packages/namespace-diagnostic-log/src/adapters/file.ts` — 新建，File adapter 主体：初始化状态机 + 构造级 crash 包络（§3）+ append 管线 + exhausted 门闩（§4）+ FILE_INTERNAL 直通接缝（估 ~420 行）
- `packages/namespace-diagnostic-log/src/reader.ts` — 新建，`readStreamStrict` 含 fs 错误包络与全函数兜底（§7，估 ~400 行）
- `packages/namespace-diagnostic-log/src/frame.ts` — 新建，NDCL v1 codec（§5，估 ~120 行）
- `packages/namespace-diagnostic-log/src/paths.ts` — 新建，路径安全文法 + 布局派生（§2.6，估 ~80 行）
- `packages/namespace-diagnostic-log/src/storage-gate.ts` — 新建，storage 校验共享原语（§6，估 ~110 行）
- `packages/namespace-diagnostic-log/src/index.ts` — 修改，追加 §1.2 两组导出（+~12 行，只增不改）
- `packages/namespace-diagnostic-log/src/testing.ts` — 修改，追加 `injectFinalRecordFile` + `createFileDiagnosticLogPresetSequence`（§6.3，+~25 行，只增不改）
- `packages/namespace-diagnostic-log/src/health.ts` — 修改，`DiagnosticLogHealthEvent` 联合追加**四成员**（SA6 三成员 §8 + 总控 J9 裁决 `stream-exhausted`；+~24 行，只增不改）
- `packages/namespace-diagnostic-log/src/carrier.ts` — 修改，新增 `decodeBase64Strict`（§6.1，+~25 行；Buffer decode 收口于此）
- `packages/namespace-diagnostic-log/AGENTS.md` — 修改，Boundaries 段环境绑定面三行声明增补（§1.5，~5 行）
- `packages/namespace-diagnostic-log/README.md` — 修改，追加 File adapter 配置表/磁盘布局/best-effort 免责一节（~40 行）；R2 增补两段声明：genesis 缺失判别法（读 JSONL 首行 recordKind，§11-G10）与并发读写语义（reader 面向静态 stream，§4.3）
- `packages/namespace-diagnostic-log/test/**` — `[SA6 owned]` 测试域（含本票 5 个 `file-adapter-*.test.ts` + `helpers/{file,frame}.ts` 及 #148 既有测试）；SA3 仅可改测试基础设施（hook/fixture 隔离），**不得改断言逻辑**
- `wiki/raw/task_diagnostic-log-file-adapter_design.md` — 本设计文档

### DENY LIST

- `packages/namespace-diagnostic-log/src/schema.ts` — 冻结 schema/信封/指纹（任何字符改动 = 版本变更 = 违反「不改 schema」）
- `packages/namespace-diagnostic-log/src/adapters/memory.ts`、`src/pipeline.ts`、`src/emission.ts`、`src/record.ts`、`src/sink.ts`、`src/vocabulary.ts`、`src/crc32c.ts`、`src/digest.ts`、`src/schema-patterns.ts`、`src/canonical-json.ts`、`src/projection/**` — #148 冻结面，只 import 不改（165 既有测试必须保持绿）
- `packages/namespace-diagnostic-log/package.json`、根 `package.json`、`pnpm-lock.yaml` — 零新增依赖（node:fs/node:path 内置；exports 子路径已存在；typecheck script 已含本包）
- `packages/vfsl/**`、`packages/namespace-runtime/**`、`packages/namespace-registry/**`、`packages/doc-runtime/**`、`packages/persistence/**`、`packages/clock/**` — 只消费公共接缝或不依赖
- `docs/adr/**`、`docs/vfsl/**`、`CONTEXT.md` — 规范冻结源/词汇表（本票无需新词条；冲突走 §11 裁决）
- `apps/**`、`domains/**`、`tests/**` — 与本票无关

（SA6 owned 测试文件不进 DENY LIST；`pnpm-workspace.yaml` 通配已覆盖，无需改动。）

---

## §13 协议假设依据 (Protocol Assumption Evidence)

本设计无 HTTP/WS 端点、端口、跨进程生命周期类协议级假设（进程内库 + 本地文件系统）。存在以下运行时库行为假设，逐条给出依据：

| 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|
| `fs.appendFileSync(path, data)` 以 append 语义写，**文件不存在则创建**（.bin 惰性创建的机制） | 官方文档 + 现有测试引用 | Node docs `fs.appendFile`：「append data to a file, creating the file if it does not exist」；SA6 红灯 `file-adapter-layout.test.ts:190`（`.bin 惰性创建`用例）直接锚定该行为 | 低 |
| `fs.writeFileSync(path, data, { flag: 'wx' })` 在路径已存在时抛 `EEXIST`（manifest 不可变创建 + 碰撞检测） | 官方文档 | Node docs flag `'wx'`：「Open file for writing. Fails if the path exists」（O_CREAT\|O_EXCL 语义）；EEXIST 经 `err.code` 提取（§8） | 低 |
| 对**目录**路径 `appendFileSync`/`open` 抛 `EISDIR` 且 `err.code === 'EISDIR'` | 现有测试引用（最强锚） | SA6 红灯 `file-adapter-mismatch-interference.test.ts:170`（`mkdirSync(p.binPath)` 占位 → 断言 `storage-write-failed{stage:'bin'}` + 恢复）与 `:216`（jsonl 占位）已把该行为钉进契约 | 低 |
| `fs.renameSync(old, new)` 对同目录目标为原子替换（current.json temp+rename） | ADR 明文 + 仓内先例 | ADR 0012 §File adapter 布局：「current.json 使用 temp + rename 原子替换」；ADR 0006 snapshot 写入 `{namespaceId}.snapshot.tmp` 后原子 rename 覆盖——同一已验证模式（相关决议文档 ADR-0006 节引文） | 低 |
| `Buffer.from(s, 'base64')` 是**宽松**解码器（跳过非法字符/空白）→ canonical 判定必须 decode→re-encode 恒等比较 | 现有测试引用 + 源码先例 | SA6 `test/helpers/frame.ts:117 isCanonicalBase64` 即此算法（含 `Buffer.from(s,'base64')` 后重编码比较）；红灯用例 'AB=='（`file-adapter-strict-reader.test.ts:235`）与注入门用例（`mismatch:75`）锚定非 canonical 必须被拒 | 低 |
| `fs.readFileSync` 对缺失文件抛 `ENOENT`、`err.code` 可提取（resume manifest-missing 分支） | 官方文档 | Node docs `fs.readFileSync` 异常传播 `err.code`；仓内 Node ≥20（root package.json engines） | 低 |
| `fs.mkdirSync(path, { recursive: true })` 幂等（已存在不抛） | 官方文档 | Node docs：「with recursive: true, no error is thrown if the directory exists」 | 低 |
| **【R2 补登（SA2 #1 强制）】`fs.statSync(目录路径)` 成功返回非零 `st_size`（目录条目尺寸，实测 4096）且 `isFile() === false`，不抛错、不返回 0**；`statSync(缺失, { throwIfNoEntry: false })` 返回 `undefined` | 官方文档 + 设计期实测 | Node docs `fs.stat`（目录 size 语义依文件系统而定，POSIX 下为目录条目尺寸）；SA2 附录 A-1 实测（2026-08-28 本 worktree `node -e`：`statSync(目录).size=4096`、`isFile=false`、不抛）。**R1 曾依赖该行为却未登记，导致 binLength 重同步把目录尺寸当文件长的 CRITICAL 缺陷**——R2 起 fresh-stat + `isFile()` 判定后，该行为只用于「排除目录」，不再取目录尺寸当文件长度 | 低（登记后） |
| `JSON.stringify` 输出紧凑、无 BOM、UTF-8 安全（JSONL line 构造） | 源码先例 | #148 `src/adapters/memory.ts:60-62 measure()` 同款 `JSON.stringify` + TextEncoder 计量；`file-adapter-inline-sidecar.test.ts:104-108` 无 BOM/`\n` 结尾断言 | 低 |

---

## §14 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

**无**。既有函数（`createMemoryLog`、`createDiagnosticChangeEmitter`、`buildInlineCarrier`、`crc32c*`、`getRecordSchemaCompilation`、`safeNotify`、`makeEventNotifier`、`injectFinalRecord` 等）签名、返回类型、throw 行为、时序**零改动**。本设计只新建模块 + 追加导出 + 扩展一个联合类型。

### 类型演进：`DiagnosticLogHealthEvent` 联合 +4 成员（只增不改；R2：+3 → +4，总控 J9 裁决追加 `stream-exhausted`）

消费者审计（取证命令与结果，2026-08-28 于本 worktree 执行）：

```bash
$ git grep -ln "namespace-diagnostic-log" -- 'packages/**' 'apps/**' 'domains/**' | grep -v 'packages/namespace-diagnostic-log/'
（空——包外零引用；#149/#150/#151 是未来接线方）
$ git grep -n "DiagnosticLogHealthEvent" -- 'packages/**' 'apps/**' 'domains/**' | grep -v namespace-diagnostic-log
（空——事件类型无包外消费者）
$ grep -rn "switch" packages/namespace-diagnostic-log/src packages/namespace-diagnostic-log/test --include='*.ts'
src/pipeline.ts:105:  switch (r.kind) {     # 唯一 switch——按 result.kind（非事件 type）判别
```

| 消费者 | 位置 | 消费方式 | 联合 +4 成员的冲击 |
|---|---|---|---|
| `makeEventNotifier`/`safeNotify` | `src/health.ts:83-109` | 事件透传（不判别成员） | 无 |
| `createMemoryLog` 等构造点 | `src/adapters/memory.ts`、`src/pipeline.ts` | 只构造既有 8 成员字面量 | 无（不触新成员） |
| 测试 observer | `test/**`（filter/`toMatchObject`，非穷举 switch） | 结构过滤 | 无（红灯即消费新成员） |
| 包外调用方 | ——（grep 为空） | —— | 无 |

**结论**：联合只增不改在仓内零破坏（无 exhaustive switch、无包外消费者）；新增导出面（`createFileDiagnosticLog`/`readStreamStrict`/`injectFinalRecordFile`/`createFileDiagnosticLogPresetSequence`）为纯增量。若未来消费者对事件 type 做 exhaustive switch，+4 成员将产生编译期提示——这正是「只增不改」演进方式的设计意图（loud，非静默）。

### 风险评估

- 遗漏 caller 的代价：无既有 caller 可遗漏（grep 证据如上）。
- 新面自身的 caller：SA6 红灯测试（5 文件）即首批消费者；#149–#151 接线时依赖的 emitter 接缝形状由 #148 冻结、本票不触碰。

---

## SA2 反馈逐条回应

### R2 轮（对 SA2 R1 评审 `task_diagnostic-log-file-adapter_sa2_review.md`，verdict=reject）

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1（CRITICAL）：binLength 失败重同步在 EISDIR 场景把目录 st_size 当文件长，恢复后永久错位、必败 ns-binfirst-1；建议 (a) 文件感知 stat 或 (b) fresh-stat 弃缓存；§13 补登 stat-目录假设 | ✅ 修（采纳建议 b，更优解） | §4.1（offset = `planFrameOffset(binPath)`：`statSync(binPath,{throwIfNoEntry:false})` + `isFile()`，stat throw → `storage-write-failed{stage:'bin'}` + 丢弃；删除 binLength 缓存与「重同步」两处）、§4.1 不变量（「offset 无内存-磁盘孪生状态」）、§4.4（新增「offset 规划」行）、§9（mismatch 行改 fresh-stat）、§13（补登 stat-目录行为 + R1 缺陷自记） | 彻底废除缓存——每次 sidecar append 前 fresh stat 取预计 offset；EISDIR 目录占位时 `isFile()=false` → offset 0 → append 必败 → record 连同 offset 丢弃，绝无「目录尺寸当文件长」的错位引用；恢复/外部截断后下一次 append 自动从真实文件尾续写（自愈）；红灯 ns-binfirst-1 语义推演：恢复后新帧 offset=0=真实落点，reader ok ✓ |
| #2（MAJOR）：构造函数无 crash 包络——clock throw/NaN/超域从 `createFileDiagnosticLog` 外抛，违反「初始化失败不影响 namespace create」 | ✅ 修 | §3.1（整体 try/catch：任何未预见异常 → failed 模式 + 恰一次 `pipeline-crashed{stage:'adapter'}`（#148 既有成员，零扩词表）+ finally 返回形状完备对象；`streamId ??= 'log-'+'0'×32` 占位）、§3.1 模式表（新增「init 期未预见异常」行：不保证零产物，但 `'wx'` 保证绝无半写 manifest）、§1.3 clock 行、§4.2 observedAt 注、§4.4（构造面顶层异常行） | 与 §4.1 append 面顶层 catch 对称的构造级防线；ADR 0012「初始化失败不影响 namespace create」闭合 |
| #3（MAJOR）：reader 无 fs 错误包络——「不抛」无实现面；readdir/readFileSync/bin 读取分支未定义 | ✅ 修 | §7.1 ④（readdir throw → corrupt + `manifest-invalid` + records:[]）、⑤（jsonl ENOENT → 零行无 issue——合法 BIN-first 崩溃残态；其他 throw → stream 级 `invalid-json` + segment 归因 + 该段零条目）、⑧（全函数 try/catch 兜底 → corrupt，绝不抛）、§7.4（bin 缺失/非常规文件/不可读 → `frame-missing`）、§7.5（四行触发条件更新）、§11-G9（码映射定稿） | 损坏诊断工具在损坏状态下不再自崩；三类分支 + 兜底全部收敛到 corrupt/incompatible，23 码内零扩码 |
| #4（MAJOR）：总控 J9 裁决未回写正文（§4.1/§8/§10-J9/§12 仍写旧决策） | ✅ 修（五处回写 + 转换时刻精确定义 + 测试接缝） | §4.1（`exhaustedLatch` 门闩 + `sequence === UINT64_MAX` 转换时刻恰一次 `stream-exhausted`——定义：产出 UINT64_MAX 的分配完成即触发，无论该 record 后续落盘成败；此后含注入在内静默丢弃）、§4.1 不量表、§4.4（exhausted 行：不消耗——无分配）、§8（第四成员）、§10-J9（裁决回写）、§12（health.ts 四成员）、§9（R2 补充测试：预置接缝驱动转换）、§6.3（`createFileDiagnosticLogPresetSequence` 接缝）、§1.2/§14（+3 → +4） | 正文与文末裁决一致；SA3 按正文实现即符合已生效裁决 |
| #5（MINOR）：manifest 身份字段与实参互核缺失 | ✅ 修 | §7.1③（身份互核：streamId/namespaceId ≠ 实参 → corrupt + stream 级 `stream-mismatch` + records:[]；`schemaId ≠ manifest.schema.id` → 并入 `schema-fingerprint-mismatch`）、§7.5、§11-G7 | 23 码内复用，零扩码；消除「stream A 目录改名 stream B → 假 ok」的身份误归因 |
| #6（MINOR）：`injectFinalRecordFile` 缺 line 预算门（#148 appendFinal 含）；disabled 模式行为未声明 | ✅ 修 | §6.3（完整门序：`mode ≠ ready` 静默丢弃；line 预算门含 input 降级 + `input-degraded`/`record-dropped` 事件 → VFSL 门 → storage 门 → 落盘；不触碰 exhausted 门闩——无分配即无转换）、§9（R2 补充测试：注入超预算） | 与 #148 `appendFinal`→`gateAndEnqueue` 语义对齐；SA6「复制 #148 injectFinalRecord 语义」完整达成 |
| #7（MINOR）：genesis 守卫跳过零可观察性（与 J9 同型） | ✅ 备案豁免（SA2 给出的备选项之二） | §4.2（豁免备案段）、§11-G10（四点理由：ADR「尽力」措辞 / 判别法文档化——JSONL 首行 recordKind / 静默面收窄到 Host 自洽可查输入 / 词表冻结纪律）、§12（README 声明行） | 不扩词表；判别出口在工具面（reader/README）；IO 型失败仍有事件（§4.2） |
| #8（MINOR）：manifest 严格度未定义（第 15 键 / 类型篡改过门） | ✅ 修（严格形） | §7.1③（恰 14 键 + 每键类型核对，任何违规 → `manifest-invalid`；唯一例外 schemaFingerprint string-but-wrong → fingerprint 码）、§7.5、§11-G8、§9（R2 补充测试） | 消除 `"4096"` 字符串过门的假阳性；manifest 是 writer 单一构造点产物，宽忍无收益 |
| #9（MINOR）：current.json tmp 残留语义 | ✅ 修 | §2.3（失败分支 best-effort `unlinkSync`（ENOENT 及其他一律吞）；残留合法——locator 恢复只按主名工作，固定名不参与定位、人工删除安全） | 崩溃/失败路径行为定义完毕，#153 兼容 |
| #10（INFO）：并发读写语义未声明 | ✅ 修 | §4.3（新增「并发读写语义声明」段：1 MiB 行可拆多个 write(2)，并发 reader 可见半行 → invalid-json 误判；契约 = reader 面向静态 stream，不承诺并发一致性）、§12（README 声明） | ADR 无快照一致性要求，如实文档化 |
| API 备注（不设 severity）：§1.3 clock 注释与 §2.2 createdAt 同源矛盾 | ✅ 修 | §1.3 clock 行（「两处同源：manifest createdAt（§2.2）与 genesis observedAt（§4.2）」+ crash 包络指引） | 表述对齐 |
| §13 补登要求（并入 #1） | ✅ 修 | §13（新增 stat-目录行为假设行，含 R1 缺陷自记） | 「登记即自曝」补课 |

**驳回项**：无——R1 评审 10 项 + 1 备注 + 1 补登要求全部采纳落实（#7 按 SA2 提供的「备案豁免 + README 判别法」备选项处理）。

### R1 轮

R1 初版交付时无 SA2 评审反馈（占位），本表自 R2 起逐条填写。

---

**一致性自检（R2 交付前重跑）**：`sequence 分配即消耗`在 §4.1/§4.2/§4.4/§10-J3/§11-G2 五处一致（exhausted 后续丢弃为「无分配即无消耗」——不冲突，§4.4 行注记）；`BIN-first`在 §4.1/§6.3/§9 三处一致（写帧成功才写引用）；`offset 恒 fresh stat`在 §4.1 伪代码/§4.1 不变量/§4.4 表/§4.2 genesis 注/§9 两行五处一致（`binLength` 仅在 R2 修订说明与 §13 假设行作为 R1 缺陷的历史引用出现，无任何存活设计用法）；`exhausted 四处一致`：§4.1 门闩+转换、§8 第四成员、§10-J9 裁决回写、§12 四成员——与文末总控 J9 裁决逐字对齐；`构造级 crash 包络`在 §1.3/§3.1（伪代码+模式表）/§4.2/§4.4 四处一致；`reader fs 包络`在 §7.1④⑤⑧/§7.4/§7.5/§11-G9 五处一致；`事件成员数`在 §1.2/§8/§9 注记/§12/§14 统一为「四成员」；`resume 四分支`在 §3.1/§3.4/§10-J5 一致（G1 裁决：匹配静默）；`incompatible 七码集`在 §7.1/§7.5 与 SA6 词表逐字一致；对 #148 冻结面「只 import 不改」在 §1.1/§10-J10/§12 DENY 三处一致。无死引用：文中引用的全部 #148 符号（`nextDecimal`/`UINT64_MAX`/`buildInlineCarrier`/`getRecordSchemaCompilation`/`RECORD_SCHEMA_ENVELOPE`/`RECORD_SCHEMA_ID`/`makeEventNotifier`/`observedAtFrom`/`createDiagnosticChangeEmitter`/`INTERNAL` 模式）均已存在于基线源码；新增引用（`statSync` 的 `throwIfNoEntry`/`isFile`、`unlinkSync`）已登 §13 或为标准 fs 面。

---

## 总控裁决（2026-08-28，§11 六项，SA8 复审/SA2 评审的基准）

| # | 裁决 | 理由 |
|---|---|---|
| G1 | **批准设计默认**：resume 指纹匹配 → 静默新建 generation，**不扩 reason 词表**（不引入第 5 值） | #152 无续写能力时新建 generation 是 ADR 0012 明文允许的诚实行为（「旧 stream 无法安全续写…时建立新 stream」）；词表演进留到 #153 落地真续写时自然消失。可诊断性损失记入 REPORT 遗留风险 |
| G2 | **批准设计默认**：genesis 守卫跳过消耗 sequence，attempt 从 '2' 起 | 单一「分配即消耗」纪律优于两态并存；gap 是诚实信号，reader 不视 gap 为错 |
| G3 | **批准扩值**：`storage-validation-failed.code` 增 `'frame-missing'` | 类型本为 `code: string`，零破坏；loud 优于静默，注入侧装配缺陷必须可诊断 |
| G4 | **批准设计默认**：manifest format/version 异常 → `manifest-invalid`（corrupt），不发明新码 | corrupt 语义诚实（无法自描述）；词表封闭优先 |
| G5 | **批准设计默认**：reader 敌意入参 → `corrupt + locator-invalid`，零 fs 触达 | 与 writer 侧对称；安全优先 |
| G6 | **批准设计默认**：无队列 → drop-newest vacuous，如实文档化 | 与 ADR 字面不冲突；异步 writer 归 #153+ |

六项全部生效。SA2 评审应攻击设计本身，不重审已裁决项（有反证除外）。

## 总控裁决（2026-08-28，SA8 设计后复审冲突点 #1 / §10-J9）

**裁决：取选项 (c)**——`DiagnosticLogHealthEvent` 联合新增独立成员 `{ type: 'stream-exhausted' }`（零附加字段），writer 在 lastSequence 达 uint64 max **进入 exhausted 的转换时刻恰发一次**（与 failed 模式事件抑制同纪律，不逐条发；内存 adapter 维持既有 stats 计数不动）。

依据：
1. #148 设计 §10-J13 已预授权：「`sequence-exhausted` 由 #152 文件路径实际落地耗尽语义时以**联合成员追加**方式引入（§8.1 备案），TS 事件类型只增不改、VFSL schema 不受影响」——本裁决是执行已备案的演进计划，非新开口子；
2. ADR 0012「丢弃并上报」是无条件行为要求——(a) 缓期在已确认缺口下属隐匿，否；
3. (b) 扩 `record-dropped.reason` 需为 exhausted 伪造 projectedRecordBytes/queueDepth 两必填字段，语义扭曲，否；(c) 独立成员零字段、低基数（每 stream 恰一次）、满足 §8.2 白名单纪律；
4. 契约审计（§14）已证联合只增不改零破坏；SA6 红灯测试不触及该成员（物理不可达路径，仅 testing 预置接缝可触达，可在实现期补一条转换测试）。

## 总控裁决（2026-08-28，双轴终审回流——§11 追加）

| # | 裁决 | 理由 |
|---|---|---|
| G11（spec F-3） | **背书现状**：`StrictRecordRead` 不携带 `recordKind` | SA6 锚定形状对 invalid-json 行本不可满足（JSON 不可解析时无 recordKind 可言）；实现取舍合理，属流程漏登记而非缺陷。以此裁决回写补登记 |
| G12（spec F-4） | **不增加数值配置校验**，登记为已知限制 | 误配置非静默：NaN lineBudgetBytes 冻结进 manifest 后自家 reader 判 manifest-invalid，可诊断；ADR 0012 未要求配置校验。录入 REPORT 遗留风险 |
| G13（spec F-1） | **必须修复**（非登记）：genesis 路径消耗 UINT64_MAX 必须触发 exhausted 门闩与恰一次 `stream-exhausted` | J9 裁决的精神是「exhausted 必上报」；留一条 testing 接缝可达的静默超域落盘路径与该裁决矛盾。4 行最小修在 SA3 lane |

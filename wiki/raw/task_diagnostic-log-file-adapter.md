# MABF Task: Persist and strictly read VFSL-validated JSONL and sidecars

## Issue #152

## Parent

PR #142（docs/namespace-diagnostic-change-log）

## What to build

Provide a File diagnostic-log adapter that turns semantic emissions into self-describing, VFSL-validated segmented JSONL records with inline small updates and framed binary sidecars for larger updates. A strict reader can round-trip and cross-check stored records, while format, validation, queue, and storage failures remain confined to logger health.

## Acceptance criteria

- [ ] A new namespace stream has an immutable manifest containing the frozen VFSL envelope and format policy, plus an atomically replaceable current-stream locator.
- [ ] Updates at or below the configured threshold are stored as padded standard Base64 with payload length and CRC32C; larger updates use the shared NDCL v1 sidecar frame and a correlated JSONL reference.
- [ ] Final physical records pass the built-in VFSL schema and storage validation before append, and sidecar frames are appended before their JSONL references.
- [ ] The strict reader validates JSON, VFSL, Base64, lengths, CRC32C, frame metadata, references, offsets, formats, and stream sequence without approximately interpreting unknown versions.
- [ ] Public adapter tests cover inline and sidecar round trips, the exact threshold boundary, every result branch, malformed references and frames, schema-envelope mismatch, and non-interference with producer results.

## Blocked by

- #148（已由 PR #156 合入，commit 7ceede1 在本分支基线中）

## Working Directory

/home/wangjian/nomicore-fix-issue-152

## Branch

fix/issue-152-on-docs-namespace-diagnostic-change-log

## Task Type

feature（功能开发）

## 上下游事实（总控注入）

- 上游 #148 已交付 `@nomicore/namespace-diagnostic-log` 包：冻结 v1 词表/record 类型、内建冻结 VFSL schema（id `nomicore.namespace-diagnostic-change-record@1`）、envelope 指纹 `sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070`、emitter 管线、内存 adapter、crc32c、carrier（Buffer Base64 inline）、health 事件联合、testing 工具。
- #148 遗留风险 1：GenesisBaselineRecord 形状是设计裁决；v1 冻结 emission/sink 面无 genesis 构造路径——#152 需增设 adapter 内部构造，**不改 schema**。
- 主规范：docs/adr/0012-vfsl-validated-jsonl-and-framed-sidecar-change-log.md（354 行）；背景：docs/adr/0011。
- 上游设计档案：wiki/raw/task_diagnostic-log-v1-contract_design.md（1157 行）。
- 本票只做 File adapter（manifest / current-stream locator / segmented JSONL / inline carrier / NDCL v1 sidecar frame / strict reader）。#153（滚动/修复）、#154（retention）、#155（replay）不在范围，除非 ADR 0012 明确归属本票。

---

## SA6 Phase 1 验收锚定（红灯测试）— 2026-08-28

> 附：`task_diagnostic-log-file-adapter_sa6_red.md` 为同内容详细版存档（本简报为唯一权威记录）。

### 1. SA6 定义的 File adapter 公共契约（SA1 设计/SA3 实现必须满足；分歧走总控裁决）

**包内位置**：`packages/namespace-diagnostic-log/`（复用 #148 的 emitter 管线 / 冻结 schema / crc32c / health 接缝，不改 schema、不建第二份 VFSL）。

**index.ts 新增导出（SA6 契约）**：

```ts
export {
  createFileDiagnosticLog,
  type FileDiagnosticLog,
  type FileDiagnosticLogConfig,
} from './adapters/file.js'
export {
  readStreamStrict,
  type StrictStreamRead, type StrictReadStatus, type StrictReadIssue, type StrictRecordRead,
} from './reader.js'   // 文件名可调；导出面固定
```

**FileDiagnosticLogConfig**（全部默认值带 `| undefined` 显式联合——对齐 DiagnosticLogConfig 的 exactOptionalPropertyTypes 装配模式）：

```ts
interface FileDiagnosticLogConfig {
  rootDir: string                       // 日志根目录（单进程独占根目录约束，无跨进程锁）
  namespaceId: string                   // 必须符合安全文法（见 §2 路径安全）
  genesisUpdateBytes?: Uint8Array       // 提供 → 新 stream 先尽力写 genesis-baseline（sequence 1）
  resumeStreamId?: string               // 提供 → manifest 指纹匹配检查；不匹配 → 新 generation（旧只读）
  inputPolicy?: 'none' | 'digest' | 'redacted' | 'full'
  issuesPolicy?: 'none' | 'full' | 'redacted'
  updateCapture?: boolean
  lineBudgetBytes?: number
  payloadMaxBytes?: number
  inlineUpdateMaxBytes?: number         // 默认 4096（ADR 0012 §Inline 与 sidecar）
  observer?: DiagnosticLogHealthObserver | undefined
  fallbackLog?: ((line: string) => void) | undefined
  randomSource?: RandomSource | undefined
  clock?: { now(): number } | undefined // genesis observedAt 用（默认 Date.now）
}

interface FileDiagnosticLog {
  emitter: NamespaceDiagnosticChangeEmitter   // #148 同一管线
  readonly streamId: string
  readonly rootDir: string
  readonly namespaceId: string
}
```

**strict reader（AC4）**：

```ts
readStreamStrict(opts: { rootDir: string; namespaceId: string; streamId: string }): StrictStreamRead

type StrictReadStatus = 'ok' | 'corrupt' | 'incompatible'
interface StrictReadIssue  { code: string; sequence?: string; segment?: string; offset?: number }
interface StrictRecordRead { sequence: string; recordKind: 'attempt' | 'genesis-baseline'; ok: boolean;
                             issues: readonly StrictReadIssue[]; record: Readonly<Record<string, unknown>> | null }
interface StrictStreamRead { status: StrictReadStatus; namespaceId: string; streamId: string;
                             manifest: Readonly<Record<string, unknown>> | null;   // incompatible 时也可展示
                             records: readonly StrictRecordRead[];                  // incompatible → 空（不近似解释）
                             issues: readonly StrictReadIssue[] }
```

**testing.ts 新增接缝（SA6 定义）**：

```ts
injectFinalRecordFile(log: FileDiagnosticLog, record: DiagnosticChangeRecord): void
// 直通 storage projection → VFSL 门（内建冻结 schema）→ storage 校验 → 落盘。
// 仅 inline 形状（sidecar 注入无 payload 源，边界归 #153）；复制 #148 injectFinalRecord 语义
// （不分配 sequence、自管 streamId/sequence）。
```

**health.ts 事件联合新增成员（只增不改，#148 设计 §8.1 备案）**：

```ts
| { type: 'stream-init-failed'; code: 'LOG_STREAM_INIT_FAILED'; reason: 'invalid-namespace-id'
    | 'invalid-stream-id' | 'manifest-mismatch' | 'manifest-missing' }
| { type: 'storage-validation-failed'; recordKind: 'attempt' | 'genesis-baseline'; operation?: Operation; code: string }
  // code ∈ { base64-invalid | base64-length-mismatch | crc-mismatch | stream-mismatch }
| { type: 'storage-write-failed'; stage: 'bin' | 'jsonl' | 'manifest' | 'current'; operation?: Operation; code: string }
  // code = 稳定 errno 码（'EISDIR' / 'ENOSPC' …），不含底层 message
```

### 2. 磁盘布局与物理格式（SA6 契约常量；ADR 0012 逐条落实）

```text
{rootDir}/namespaces/{namespaceId}/current.json          // {format:'ndcl-current',version:1,streamId} 恰三键
{rootDir}/namespaces/{namespaceId}/streams/{streamId}/manifest.json
{rootDir}/namespaces/{namespaceId}/streams/{streamId}/segments/00000001.jsonl
{rootDir}/namespaces/{namespaceId}/streams/{streamId}/segments/00000001.bin   // 惰性
```

**manifest.json（恰 14 键；格式常量 `ndcl-manifest`/version 1）**：
`format, version, streamId, namespaceId, createdAt, schema(四键信封 lang/version/id/text),
recordVersion:1, frameVersion:1, schemaId, schemaFingerprint, committedUpdateCapture,
inputCapturePolicy, inlineUpdateMaxBytes, jsonlLineLimitBytes`。
`schemaFingerprint === 'sha256:v1:dedad2ab93d9df9224960ca094924168f8bcc1c0512dfdd0a03dc6e66613e070'`（#148 冻结常量，实测一致）。

**JSONL line**：UTF-8 无 BOM、每行一个紧凑 JSON object 以 `\n` 结束；sequence 十进制无前导零字符串；payloadLength 为 JSON number；frameOffset 为十进制字符串；inline Base64 为 RFC 4648 标准（正确 padding、无空白换行）。

**NDCL v1 frame（25-byte header + payload）**：magic `NDCL`/frameVersion `0x01`/payloadType `0x01`=yjs-update-v1/flags `0x00`/reserved `0x0000`/sequence uint64 BE/payloadLength uint32 BE/crc32c uint32 BE；CRC 输入 = header 前 21B 直接连接 payload（不含 crc32c 字段）；`frameOffset` 指向 magic 首字节。

**reader issue code 词表（稳定、低基数）**：`invalid-json | vfsl-invalid | base64-invalid |
base64-length-mismatch | crc-mismatch | frame-missing | frame-magic-invalid |
frame-sequence-mismatch | frame-length-mismatch | frame-crc-mismatch |
frame-boundary-invalid | reference-invalid | sequence-out-of-order | stream-mismatch |
manifest-invalid | schema-fingerprint-mismatch | dialect-unknown | record-version-unknown |
frame-version-unknown | frame-payload-type-unknown | frame-flags-nonzero |
frame-reserved-nonzero | locator-invalid`。
→ incompatible 触发：`dialect-unknown / schema-fingerprint-mismatch / record-version-unknown /
frame-version-unknown / frame-payload-type-unknown / frame-flags-nonzero / frame-reserved-nonzero`；
其余 → corrupt。**边界语义**：首个 frame 校验前先验 magic（offset 非 0 且非 magic → frame-magic-invalid）；
前一 frame 校验通过后，下一 record 的 offset ≠ 前一 frame end → frame-boundary-invalid（不解释该帧）。

**路径安全文法**（namespaceId/streamId/segment 进入路径前必须校验；不符 → 日志不启用 + health 上报，不编码/不替换静默另存）：namespaceId 拒绝空串、`.`、`..`、控制字符（C0/C1）、`/`、`\`（对齐 registry identity.ts 的 isMinimalSafeString 纪律）；streamId 拒绝非 `^log-[0-9a-f]{32}$`；segment 拒绝非 `^[0-9]{8}$`。

### 3. 交付物（仅测试，src 零改动）

| 文件 | AC/门槛 | 契约锚点摘要 |
|---|---|---|
| `test/helpers/frame.ts` | 夹具 | NDCL v1 frame 编解码/CRC 重算/严格 Base64 判定（零缺失接缝依赖，已独立自检通过：CRC KAT e3069283、round-trip、AB==/空白/缺 padding 判定） |
| `test/helpers/file.ts` | 夹具 | 临时根、布局路径、JSON/JSONL 读写、manifest/current 标准夹具、fake stream 写入、装配工厂 |
| `test/file-adapter-layout.test.ts` | AC1 | 布局三件套；streamId 三处一致 + `log-`+32hex + 确定性随机源；current.json 恰三键 + 无 tmp 残留；manifest 14 键逐项（含四键信封 === RECORD_SCHEMA_ENVELOPE、指纹钉死、配置值冻结）；manifest emit 前后字节恒等；.bin 惰性创建；6 种敌意 namespaceId → 零文件 + stream-init-failed + emit 不抛 |
| `test/file-adapter-inline-sidecar.test.ts` | 门槛 1/2/3 | 4096B inline 逐字段 + canonical Base64 + CRC + VFSL 孪生 + 无 BOM/\n 结尾；4097B sidecar 帧逐字节（magic/version/type/flags/reserved/sequence BE/payloadLength BE/crc BE）+ CRC 输入域 + payload 恒等；双帧 offset 递推；BIN-first 帧完整性；4096↔4097 与自定义 7↔8 阈值边界；frame 编解码双工自校验 |
| `test/file-adapter-genesis-results.test.ts` | 门槛 4 + genesis | 8 结果分支逐字段（rejected/fatal+false 无 update 键）；三守卫 update-omitted（empty-update 无 vfsl-validation-failed、update-capture-disabled、payload-too-large 保 metadata）；genesis-baseline 首条 sequence 1 + 无 attemptId/operation/stage/result/input + 固定时钟 observedAt；genesis 大 update 走 sidecar offset 0 |
| `test/file-adapter-strict-reader.test.ts` | AC4 | 正例 ok；incompatible 六类（dialect/record-version/frame-version/payloadType/flags/reserved/schema 指纹不匹配 → records 空、manifest 仍可展示）；corrupt 十二类（坏 JSON、VFSL 败、stream-mismatch、AB== 非规范尾位、length 不符、inline CRC、空白 Base64、frame-missing、offset 越界、magic 偏移、frame sequence/length/CRC 不符、边界不连续、reference 段不存在、sequence 乱序/重复/前导零、manifest 不可解析） |
| `test/file-adapter-mismatch-interference.test.ts` | 门槛 10 + AC3/AC5 | VFSL 门注入（vfsl-validation-failed 只带 issuePaths + 零落盘）；storage 门注入四类（base64-invalid/base64-length-mismatch/crc-mismatch/stream-mismatch → storage-validation-failed + 零落盘）；合法 emit 不受注入干扰；.bin 占位（EISDIR）→ emit 不抛 + 零 sidecar 引用 + storage-write-failed{stage:'bin'} + 恢复后帧/JSONL 交叉一致（reader ok）；jsonl 占位 → 不抛 + 事件 + 恢复；observer 必 throw → 不抛 + fallback 稳定码行；manifest 指纹不匹配 → 新 generation、旧 manifest 字节恒等、旧 segments 零写入、current.json 指向新 stream、旧 stream reader 判定 incompatible |

共 5 个 `.test.ts` + 2 个共享 helper；**测试总数变 17 文件（+5）**，包内既有 12 文件 165 测试不受影响。

### 4. 红灯验证证据

- 命令（唯一，后台独立进程）：`npx vitest run --typecheck packages/namespace-diagnostic-log`
- 日志/退出码：`.mabf-bg/sa6-red.log` / `.mabf-bg/sa6-red.exit` —— **exit=1（红灯 ✅）**
- 结果：`Test Files 5 failed | 12 passed (17)；Tests 72 failed | 165 passed (237)；Errors 20 errors`
- 失败根因（全部为 #152 未实现，无测试自身语法缺陷；`tsc -p tsconfig.typecheck.json` 仅 21 条同类错误）：
  1. `src/index.js` 缺 `createFileDiagnosticLog` / `FileDiagnosticLog` / `FileDiagnosticLogConfig` / `readStreamStrict`；
  2. `src/testing.js` 缺 `injectFinalRecordFile`；
  3. `src/health.ts` 的 `DiagnosticLogHealthEvent` 缺 `stream-init-failed` / `storage-validation-failed` / `storage-write-failed` 三成员；
  4. 两条隐式 any 为上述缺失的级联（无独立问题）。
- 自检：frame 夹具独立执行 `FRAME-HELPER-SELFCHECK: ALL OK`（CRC KAT/round-trip/规范 Base64 判定），排除夹具自身造成假红灯。

### 5. 实现期约束（SA1/SA3 请注意；本票范围边界）

1. **同步可观察性**：`emit` 返回时该 record 的 write 已完成（可为无 fsync 的同步 write；batch 缓冲若影响测试可观察性，须另设 flush 接缝并让本测试集可见——SA6 按同步 write 契约实现，SA1 如有异步设计须在 SA1 设计与本测试集之间达成协调，否则走总控裁决）。
2. **临界点语义裁决（SA6 定义，SA1 可提异议）**：序列分配失败也消耗（已有 gap 诚实信号，reader 不接受 gap 为错误）；observer 只收到独立低基数事件（与 #148 一致）；genesis 失败（如 payload > payloadMaxBytes）的 sequence 消耗属 SA1 设计空间——SA6 只断言「无 genesis 记录、attempt 照常、无虚假完整重放」（本次未锚定该场景的 sequence 值）。
3. **resume 边界**：本票只锚定「指纹不匹配 → 新 generation、旧 manifest/segments 字节不变 + current.json 指向新 stream」；指纹匹配时的安全续写（尾部扫描/sequence 续接）归 #153「打开与尾部恢复」，SA1 若在 #152 实现 resume 续写，需自洽且不得违反本测试集。
4. **不做**：#153（segment rolling/耗尽、打开与尾部恢复修复）、#154（retention/删除）、#155（replay）；本测试集不锚定门槛 5/6/7/8/9/11/12/13/14/15（分别属 #148 或 #153/#154/#155）。
5. **无新增依赖、无新端口、无 scripts/test-lock.sh**（本仓无该脚本）：测试仅用 node:fs/os/path + 既有 vitest；`pnpm-lock.yaml` 未改动。
6. **SA6 未改任何 src/生产文件**（`git status` 仅测试 + wiki）。

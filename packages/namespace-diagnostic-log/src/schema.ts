/**
 * v1 冻结 VFSL record schema（设计 §3——冻结信封与指纹获取；issue #148 冻结）。
 *
 * `RECORD_SCHEMA_TEXT` 逐字符等于设计 §3.3 围栏内文本 + 尾随 `\n`——`envelopeFingerprint`
 * 为冻结身份键（`sha256:v1:dedad2ab…`；schema-freeze.test.ts 钉死编译期常量）。
 * 变更纪律（§3.4）：文本任何改动（含 JSDoc——文档注释进 semantic fingerprint）都会改变
 * 指纹 → 等价于新 record schema 版本：id 升 `@2`、新 stream generation、旧 stream 只读。
 *
 * 单源纪律（§3.2）：全部 Pattern 字符串经 schema-patterns.ts 常量插值——TS intake
 * 校验与 VFSL Pattern 永不漂移。全部 Pattern 零反斜杠。
 */
import { compileSchemaEnvelope } from '@nomicore/vfsl'
import type { CompileSchemaEnvelopeOk, SchemaParseIssue } from '@nomicore/vfsl'
import {
  P_BASE64,
  P_BOUNDED_STR,
  P_CRC32C_HEX,
  P_DECIMAL,
  P_ISO_MS,
  P_SEGMENT,
  P_SHA256_HEX,
  P_STABLE_CODE,
  P_STREAM_ID,
} from './schema-patterns.js'

/** 冻结 schema id（ADR 0012 逐字；lang 固定 `vfsl@1`，「不引用 latest」同节）。 */
export const RECORD_SCHEMA_ID = 'nomicore.namespace-diagnostic-change-record@1' as const

/** 冻结 VFSL schema 文本（设计 §3.3 逐字符 + 尾随 \n）。 */
export const RECORD_SCHEMA_TEXT = `/** namespace 诊断变更日志 v1 存储 record 契约（issue #148 冻结）。
 *  单条最终 JSONL line 的逻辑形状；ADR 0011/0012 为规范来源。
 *  物理事实（segment/frame/offset 连续性、retention、跨记录不变量）不在本 schema，
 *  由 storage validator 负责（ADR 0012 §VFSL record schema 分工）。 */

/** record 身份的 stream 半段：log- + 32 位小写 hex，128-bit CSPRNG 生成（ADR 0012 §Stream 与 generation） */
type StreamId = string & Pattern<"${P_STREAM_ID}">;

/** record 身份的顺序半段：无前导零十进制字符串，uint64 值域；仅代表本 stream 的 append 顺序，
 *  不证明业务尝试无缺，也不是跨副本全局顺序（ADR 0012 §JSONL record） */
type Sequence = string & Pattern<"${P_DECIMAL}">;

/** 变更尝试关联 ID：producer 复用的既有受控关联 ID，或 writer 生成的 att- + 32 位小写 hex；
 *  有界且不含行终止符（\`.\` 语义），杜绝 JSONL 行注入 */
type AttemptId = string & Pattern<"${P_BOUNDED_STR}">;

/** producer 侧完成时刻：UTC ISO 8601、毫秒精度、Z 后缀；由完成操作的 producer 用注入 Clock 生成 */
type ObservedAt = string & Pattern<"${P_ISO_MS}">;

/** 稳定诊断码：ASCII 受控字符集、≤128 字符；顶层 code/sourcePhase 与 update-omitted reason 共用。
 *  「安全 Pattern 字符串」（ADR 0012）——低基数、无控制字符、无自由文本 */
type StableCode = string & Pattern<"${P_STABLE_CODE}">;

/** CRC-32C（Castagnoli）8 位小写 hex：inline 与 sidecar update payload 的完整性侧写（ADR 0012 §Binary frame v1） */
type Crc32cHex = string & Pattern<"${P_CRC32C_HEX}">;

/** RFC 4648 标准 Base64（含必须 padding、无空白换行）：inline update 的物理表示（ADR 0012 §Inline 与 sidecar） */
type Base64 = string & Pattern<"${P_BASE64}">;

/** sidecar 所在 segment 名：固定 8 位十进制，00000001 起，00000000 保留（ADR 0012 §Segment rolling） */
type SegmentName = string & Pattern<"${P_SEGMENT}">;

/** sidecar frame 起点：指向 frame magic 首字节，十进制无前导零字符串；首 frame 偏移可为 0 */
type FrameOffset = string & Pattern<"${P_DECIMAL}">;

/** SHA-256 小写 hex（64 位）：安全快照 RFC 8785 JCS bytes 的摘要（ADR 0012 §投影） */
type Sha256Hex = string & Pattern<"${P_SHA256_HEX}">;

/** committed Yjs update 的两种物理表示；inline 阈值只影响物理表示，不改语义。
 *  rejected 与 fatal committed:false 的 record 形状不声明 update 字段（封闭对象）→ 携带 update 即被拒绝，
 *  机器强制 ADR 0012「rejected 与 fatal committed:false 禁止携带 update」 */
type UpdateCarrier =
  | {
      storage: "inline";
      format: "yjs-update-v1";
      /** payload 字节数；与 Base64 解码长度的一致性归 storage validator（ADR 0012 分工） */
      payloadLength: number;
      crc32c: Crc32cHex;
      base64: Base64;
    }
  | {
      storage: "sidecar";
      format: "yjs-update-v1";
      segment: SegmentName;
      frameOffset: FrameOffset;
      payloadLength: number;
      crc32c: Crc32cHex;
    };

/** v1 封闭 operation 词表（ADR 0012 §JSONL record 逐字；新增 operation 需新 record schema 版本与 stream generation） */
type Operation =
  | "namespace-create"
  | "root-mutation"
  | "schema-replacement"
  | "replication-apply"
  | "replication-enable"
  | "replication-epoch-bump";

/** 结局所属阶段的封闭枚举（ADR 0011 §变更尝试与结局 8 值逐字；不折叠为统一 failed） */
type Stage =
  | "acceptance"
  | "capability-gate"
  | "input-snapshot"
  | "schema-compile"
  | "validation"
  | "identity"
  | "transaction"
  | "dirty-notification";

/** 稳定 code 的来源模块封闭枚举（ADR 0012：Registry、Runtime、Persistence 与 replication） */
type SourceModule =
  | "registry"
  | "runtime"
  | "persistence"
  | "replication";

/** 变更来源：本地写路径或可信复制路径（ADR 0012 §JSONL record 逐字形状）。
 *  remoteInstanceId 有界无换行：复制身份受控，violation 由 intake 拒绝（结构性，§4） */
type LogSource =
  | { kind: "local" }
  | {
      kind: "replication";
      direction: "hub-to-peer" | "peer-to-hub";
      remoteInstanceId: string & Pattern<"${P_BOUNDED_STR}">;
    };

/** 受控关联上下文（ADR 0012 逐字形状）：全可选，缺失即未提供；
 *  owner/instanceId/epoch 不冻结在 manifest，按记录表达（同上） */
type LogContext = {
  correlationId?: string & Pattern<"${P_BOUNDED_STR}">;
  runtimeGeneration?: string & Pattern<"${P_BOUNDED_STR}">;
  replicationId?: string & Pattern<"${P_BOUNDED_STR}">;
  replicationEpoch?: number;
};

/** issues 统一投影单条（ADR 0012 §投影 逐字形状）。message/path 的字节预算由确定性投影施加（截断+标记），
 *  不用 Pattern 表达——截断标记可能包含任意原文字符，Pattern 会误杀合法截断结果 */
type PathSegment = string | number;

type DiagnosticIssue = {
  /** 所属模块稳定码；ADR TS 快照即 plain string，预算由投影施加（256 字节截断） */
  code?: string;
  /** ≤4 KiB UTF-8，超限确定性截断且不拆分 code point */
  message: string;
  /** ≤256 段；string 段 ≤1 KiB（截断+标记） */
  path: PathSegment[];
};

/** issues 投影容器：policy 标明捕获策略（防误认脱敏内容为原始 issue，ADR 0011 §数据保护）；
 *  truncated/originalCount 仅在实际发生预算截断时出现（presence 语义） */
type IssuesProjection = {
  policy: "none" | "full" | "redacted";
  items: DiagnosticIssue[];
  truncated?: boolean;
  originalCount?: number;
};

/** 输入捕获：四策略 × 可得性的七值封闭（ADR 0011 §输入捕获 + ADR 0012 §投影）。
 *  digest 恒为安全快照 JCS bytes 的 SHA-256；degraded 仅在 digest 变体上出现，
 *  presence ⇔ full/redacted 投影超 line 预算降级（v1 唯一原因 projected-input-too-large） */
type InputCapture =
  | { capture: "none" }
  | { capture: "not-accessed" }
  | { capture: "unavailable" }
  | { capture: "unsafe-input" }
  | { capture: "digest"; digest: Sha256Hex; degraded?: "projected-input-too-large" }
  | { capture: "full"; value: unknown; digest: Sha256Hex }
  | { capture: "redacted"; value: unknown; digest: Sha256Hex };

/** 结局严格判别联合（ADR 0012 §JSONL record 六形状展开为 8 个具体成员）。
 *  判别字段 kind + effect 均为字符串字面量（VFSL v1 字面量仅 string/number）；
 *  fatal 的 committed 事实以显式 boolean 携带——VFSL 无法机器锁死「committed:true ⇒ effect 存在」
 *  （v1-spec §2 注记 8），该相关性由 TS 字面量类型 + emitter 唯一构造点 + 契约测试三重强制（§10-J2） */
type AttemptResult =
  | { kind: "committed"; effect: "noop" }
  | { kind: "committed"; effect: "update"; update: UpdateCarrier }
  | { kind: "committed"; effect: "update-omitted"; reason: StableCode }
  | { kind: "rejected" }
  | { kind: "fatal"; committed: boolean }
  | { kind: "fatal"; committed: boolean; effect: "update"; update: UpdateCarrier }
  | { kind: "fatal"; committed: boolean; effect: "update-omitted"; reason: StableCode }
  | { kind: "fatal"; committed: boolean; effect: "unknown" };

/** 最终 attempt record：一次变更尝试的完整结局；首版不写 attempt-started（ADR 0012）。
 *  记录身份是 (streamId, sequence)，不另设 recordId；无 namespaceId 字段——
 *  namespace 关联由 stream 归属（文件布局 namespaces/{namespaceId}/streams/{streamId}）表达 */
type AttemptRecord = {
  recordKind: "attempt";
  streamId: StreamId;
  sequence: Sequence;
  attemptId: AttemptId;
  operation: Operation;
  stage: Stage;
  observedAt: ObservedAt;
  /** 仅存在可靠 monotonic duration 来源时记录，毫秒（ADR 0012 §JSONL record） */
  durationMs?: number;
  source: LogSource;
  context?: LogContext;
  /** 所属模块已有稳定 code；与 sourceModule 成对出现（emitter 强制，schema 残差见 §10-J3） */
  code?: StableCode;
  sourcePhase?: StableCode;
  sourceModule?: SourceModule;
  issues?: IssuesProjection;
  input: InputCapture;
  result: AttemptResult;
};

/** 新 stream 的 genesis 基线 record：当时的完整 Y.Doc update，不是变更尝试
 *  （ADR 0012 §Stream 与 generation「每个新 stream 尽力先记录 genesis baseline」；
 *  形状裁决见设计 §11-G2——无 attemptId/operation/stage/result/input，诚实表达非尝试身份） */
type GenesisBaselineRecord = {
  recordKind: "genesis-baseline";
  streamId: StreamId;
  sequence: Sequence;
  observedAt: ObservedAt;
  source: LogSource;
  context?: LogContext;
  update: UpdateCarrier;
};

/** 根：attempt 与 genesis-baseline 两族 record 的封闭联合（全 map 形联合，满足 v1-spec §3 ROOT 约定） */
type ROOT = AttemptRecord | GenesisBaselineRecord;
`

/** 冻结信封：恰四键、深冻结（#152 manifest 内嵌用；设计 §3.1）。 */
export const RECORD_SCHEMA_ENVELOPE = Object.freeze({
  lang: 'vfsl' as const,
  version: 1,
  id: RECORD_SCHEMA_ID,
  text: RECORD_SCHEMA_TEXT,
})

/** 编译产物（冻结五件套）与失败形状（§3.4）。 */
export type RecordSchemaCompilationResult =
  | CompileSchemaEnvelopeOk
  | { ok: false; issues: SchemaParseIssue[] }

let cachedCompilation: RecordSchemaCompilationResult | null = null

/**
 * 内建冻结 schema 的编译（设计 §3.4）：模块级单次缓存（惰性一次编译）；
 * 同步纯函数不抛错；失败 return { ok:false, issues }（构造期 failed 模式信号，
 * writer bug——正常不可达，§4.1 步骤 0′）。
 */
export function getRecordSchemaCompilation(): RecordSchemaCompilationResult {
  if (cachedCompilation === null) {
    cachedCompilation = compileSchemaEnvelope(RECORD_SCHEMA_ENVELOPE) as RecordSchemaCompilationResult
  }
  return cachedCompilation
}

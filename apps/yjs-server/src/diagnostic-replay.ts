/**
 * #155（§5.6/§4-D9/§4-D12）离线 strict 诊断重放工具——`replayNamespaceDiagnosticLog`。
 *
 * 契约（ADR-0012-LOG §Strict reader 与诊断性 replay，冻结报告形状）：
 * - **replay 强制 strict**：唯一读取模式 = `readStreamStrict`（绝不近似解释、绝不
 *   自动拼接多个 stream generation——只重放 current.json 指向的当前 generation）。
 * - **五条件 complete**：有可用 genesis、连续 committed updates、无裁剪、身份相符、
 *   可解码——`status:'complete'` 仅当 `issues === []` ∧ applied>0 ∧ reader ok ∧
 *   未裁剪；缺陷 → partial（有重放基：genesis 已应用、至少一个前缀）或 failed
 *   （无重放基：locator 缺失/不可解析、stream incompatible、无有效 genesis）。
 * - **best-effort disclaimer**：即便 complete 也只证明重放了该 best-effort stream
 *   所持有的记录，不证明与生产 namespace 完全一致（ADR-0011）。
 * - 返回 **detached owned snapshot bytes**（每次调用全新 `Y.encodeStateAsUpdate`），
 *   不暴露 live Y.Doc、不改动磁盘日志流（只读工具）。
 * - **纯同步、绝不抛**：一切错误收敛进 issues（全收敛映射表见实现）；违规
 *   namespaceId 经包内单源安全文法前置门 → `failed{locator-missing}`、零 fs 触达。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import {
  isSafeNamespaceId,
  isSafeStreamId,
  materializeStrictRecordUpdate,
  readStreamStrict,
} from '@nomicore/namespace-diagnostic-log';

export interface DiagnosticReplayIssue {
  readonly code: string;
}

export interface DiagnosticReplayResult {
  readonly status: 'complete' | 'partial' | 'failed';
  readonly lastAppliedSequence: string | null;
  readonly issues: readonly DiagnosticReplayIssue[];
  /** 已应用记录重放到 detached Y.Doc 后的全量 state（owned 副本）；无重放基时缺席。 */
  readonly snapshot?: Uint8Array;
}

export type ReplayNamespaceDiagnosticLogRequest = { rootDir: string; namespaceId: string };

const LOCATOR_PATH = ['namespaces', 'current.json'] as const;

/**
 * 重放 namespace 诊断日志（纯同步、绝不抛；详见文件头契约）。
 *
 * 离线使用（reader 契约面向静态流——活跃 writer 并发一致性不在本工具承诺内）。
 */
export function replayNamespaceDiagnosticLog(request: ReplayNamespaceDiagnosticLogRequest): DiagnosticReplayResult {
  // 已累计状态在顶层 catch-all 亦可见（M1：按已累计状态走 failed/partial 判定）
  const issues: DiagnosticReplayIssue[] = [];
  let applied = 0;
  let lastSeq: string | null = null;
  let readStatusOk = false;
  let historyTrimmed = false;
  let snapshot: Uint8Array | undefined;
  try {
    // ① 前置门（m3/D10 单源原语）：namespaceId 无法构成安全路径 ⇒ 视同目标不存在——
    //   违规 → failed{locator-missing}，零 fs 触达（'../..' 之类输入不可使读取逃逸 rootDir）。
    if (!isSafeNamespaceId(request.namespaceId)) {
      return { status: 'failed', lastAppliedSequence: null, issues: [{ code: 'locator-missing' }] };
    }
    // ① locator（ADR-0012 冻结布局；与 file.ts resolveResumeCandidate 同一物理契约）
    const currentPath = join(request.rootDir, LOCATOR_PATH[0], request.namespaceId, LOCATOR_PATH[1]);
    let raw: string;
    try {
      raw = readFileSync(currentPath, 'utf8');
    } catch (err) {
      // M1 fs errno 收敛：ENOENT（真缺失）→ locator-missing；其余 errno →
      // locator-unreadable（EACCES/EISDIR/EPERM/EMFILE/EROFS…——绝不抛）
      const errno = (err as NodeJS.ErrnoException | null)?.code;
      return {
        status: 'failed',
        lastAppliedSequence: null,
        issues: [{ code: errno === 'ENOENT' ? 'locator-missing' : 'locator-unreadable' }],
      };
    }
    let locator: unknown;
    try {
      locator = JSON.parse(raw);
    } catch {
      return { status: 'failed', lastAppliedSequence: null, issues: [{ code: 'locator-invalid' }] };
    }
    if (locator === null || typeof locator !== 'object' || Array.isArray(locator)) {
      return { status: 'failed', lastAppliedSequence: null, issues: [{ code: 'locator-invalid' }] };
    }
    const loc = locator as { format?: unknown; version?: unknown; streamId?: unknown };
    if (loc.format !== 'ndcl-current' || loc.version !== 1 || !isSafeStreamId(loc.streamId)) {
      return { status: 'failed', lastAppliedSequence: null, issues: [{ code: 'locator-invalid' }] };
    }
    const streamId = loc.streamId;
    const strictRequest = { rootDir: request.rootDir, namespaceId: request.namespaceId, streamId };

    // ② replay 强制 strict（唯一读取模式；自身绝不抛——P5）
    const read = readStreamStrict(strictRequest);
    if (read.status === 'incompatible') {
      // 未知格式：不近似解释（records 空）；总括码 + reader 原生码逐条并列透传
      return {
        status: 'failed',
        lastAppliedSequence: null,
        issues: [{ code: 'stream-incompatible' }, ...read.issues.map((issue) => ({ code: issue.code }))],
      };
    }
    readStatusOk = read.status === 'ok';
    historyTrimmed = read.historyTrimmed;

    // ③ 预扫描：stream 级事实全量透传（historyTrimmed → history-trimmed；reader
    //   stream/record 镜像 issues 逐条透传——record 级语义截断由 ④ 的逐 entry 扫描
    //   承担，本层不逐条去重：报告是「该流 + 截至停止点的重放」事实的并集）
    if (read.historyTrimmed) {
      issues.push({ code: 'history-trimmed' });
    }
    for (const issue of read.issues) {
      issues.push({ code: issue.code });
    }

    // ④ 逐 entry strict 重放（detached Y.Doc；不暴露；连续性本地复核）
    const doc = new Y.Doc();
    let expectedNext: bigint | null = null;
    let genesisSeen = false;
    let attemptSeen = false;
    for (const entry of read.records) {
      // m2：各停止分支一律 break（非 continue）——停止点之后的 entry 级发现不再
      // 进入 issues（报告描述「截至停止点的重放事实」）
      if (!entry.ok) {
        for (const issue of entry.issues) {
          issues.push({ code: issue.code });
        }
        break;
      }
      const record = entry.record;
      if (record === null || typeof record !== 'object' || Array.isArray(record)) {
        issues.push({ code: 'invalid-json' });
        break;
      }
      const rec = record as Record<string, unknown>;
      if (rec.recordKind === 'genesis-baseline') {
        // M2：mid-genesis（含前置 attempt 记录——哪怕全部因无基被跳过）拒作基线
        if (genesisSeen || applied > 0 || attemptSeen) {
          issues.push({ code: 'genesis-misplaced' });
          break;
        }
        const m = materializeStrictRecordUpdate(strictRequest, entry);
        if (m.kind !== 'update') {
          issues.push({ code: m.kind === 'invalid' ? m.code : 'vfsl-invalid' });
          break;
        }
        try {
          Y.applyUpdate(doc, m.bytes);
        } catch {
          issues.push({ code: 'update-undecodable' });
          break;
        }
        genesisSeen = true;
        applied += 1;
        lastSeq = entry.sequence;
        expectedNext = BigInt(entry.sequence) + 1n;
        continue;
      }
      if (rec.recordKind !== 'attempt') {
        issues.push({ code: 'invalid-json' });
        break;
      }
      attemptSeen = true; // M2：前置 attempt 事实先记（无论本条后续是否被跳过/停止）
      const result = rec.result;
      if (result === null || typeof result !== 'object' || Array.isArray(result)) {
        issues.push({ code: 'vfsl-invalid' });
        break;
      }
      const res = result as Record<string, unknown>;
      const committed = res.kind === 'committed' || (res.kind === 'fatal' && res.committed === true);
      const effect = res.effect;
      if (committed && effect === 'update-omitted') {
        // materialize kind='omitted' 同源：committed 非-noop 且 update 被省略
        issues.push({ code: 'update-omitted' });
        break;
      }
      // 连续性复核（BigInt 逐条比对；reader 已保证十进制 canonical——无 throw 面）
      if (expectedNext !== null && BigInt(entry.sequence) !== expectedNext) {
        issues.push({ code: 'sequence-gap' });
        break;
      }
      const hasUpdateCarrier =
        committed &&
        effect === 'update' &&
        res.update !== null &&
        typeof res.update === 'object' &&
        !Array.isArray(res.update);
      if (hasUpdateCarrier) {
        if (!genesisSeen) {
          // 无基不虚构状态：跳过应用（issues 由 ⑤ genesis-missing 兜底），lastSeq 不动
          continue;
        }
        const m = materializeStrictRecordUpdate(strictRequest, entry);
        if (m.kind !== 'update') {
          issues.push({ code: m.kind === 'invalid' ? m.code : 'vfsl-invalid' });
          break;
        }
        try {
          Y.applyUpdate(doc, m.bytes);
        } catch {
          issues.push({ code: 'update-undecodable' });
          break;
        }
        applied += 1;
        lastSeq = entry.sequence;
        expectedNext = BigInt(entry.sequence) + 1n;
      } else if (genesisSeen) {
        // 其他（committed noop / rejected / fatal-无-update）：连续记录计数推进
        lastSeq = entry.sequence;
        expectedNext = BigInt(entry.sequence) + 1n;
      }
    }

    // ⑤ 无有效 genesis（含 misplaced 被拒场景——无重放基）
    if (!genesisSeen) {
      issues.push({ code: 'genesis-missing' });
    }
    // ⑥ 身份复核（applied>0 时；docId 缺席/非 string → 视同不符）
    if (applied > 0) {
      const docId = doc.getMap('META').get('docId');
      if (docId !== request.namespaceId) {
        issues.push({ code: 'identity-mismatch' });
      }
    }
    // ⑦ 三态（D9：failed = 无重放基；partial = 有基不完整；complete = 五条件全满足）
    const status: DiagnosticReplayResult['status'] =
      issues.length === 0 && applied > 0 && readStatusOk && !historyTrimmed
        ? 'complete'
        : applied > 0
          ? 'partial'
          : 'failed';
    // ⑧ owned snapshot（每次调用新编码 = owned 副本——R2 篡改无关性）
    if (applied > 0) {
      snapshot = Y.encodeStateAsUpdate(doc);
    }
    return {
      status,
      lastAppliedSequence: lastSeq,
      issues,
      ...(snapshot !== undefined ? { snapshot } : {}),
    };
  } catch {
    // M1 顶层 catch-all（结构性不可达——①–⑧ 各步均已收敛）：不冒充可解释状态
    issues.push({ code: 'replay-internal-error' });
    return {
      status: applied > 0 ? 'partial' : 'failed',
      lastAppliedSequence: lastSeq,
      issues,
      // N1（SA2 R1 残留）：防御路径不承诺快照
      ...(snapshot !== undefined ? { snapshot } : {}),
    };
  }
}

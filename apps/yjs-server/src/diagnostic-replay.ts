/**
 * #155（§5.6/§4-D9/§4-D12）离线 strict 诊断重放工具——`replayNamespaceDiagnosticLog`。
 * #227（2026-09-06）：全程 read-session 租约 + 完整性判定收紧（AC1–AC5）。
 *
 * 契约（ADR-0014-LOG §Strict reader 与诊断性 replay，冻结报告形状）：
 * - **replay 强制 strict**：唯一读取模式 = `readStreamStrict`（绝不近似解释、绝不
 *   自动拼接多个 stream generation——只重放 current.json 指向的当前 generation）。
 * - **五条件 complete**：有可用 genesis、连续 committed updates、无裁剪、身份相符、
 *   可解码——`status:'complete'` 仅当 `issues === []` ∧ applied>0 ∧ reader ok ∧
 *   未裁剪；缺陷 → partial（有重放基：genesis 已应用、至少一个前缀）或 failed
 *   （无重放基：locator 缺失/不可解析、stream incompatible、无有效 genesis）。
 * - **（#227 K-4 措辞同步）必要条件收紧**：完整性不可证的 committed 记录（`fatal ∧
 *   committed:true` 且 effect ∉ {'update','update-omitted'}——字面 `'unknown'` 或
 *   effect 字段缺席）产生 `update-unknown` issue 并 break，**永不**按无更新记录推进
 *   lastSeq——complete 仅在每条必要 committed update 的必要性均可证时可达（INV-227-5）。
 * - **best-effort disclaimer**：即便 complete 也只证明重放了该 best-effort stream
 *   所持有的记录，不证明与生产 namespace 完全一致（ADR-0011）。
 * - 返回 **detached owned snapshot bytes**（每次调用全新 `Y.encodeStateAsUpdate`），
 *   不暴露 live Y.Doc、不改动磁盘日志流（只读工具）。
 * - **纯同步、绝不抛**：一切错误收敛进 issues（全收敛映射表见实现）；违规
 *   namespaceId 经包内单源安全文法前置门 → `failed{locator-missing}`、零 fs 触达。
 * - **（#227 §3.4）租约生命周期**：locator 解析成功取得 streamId 后自开一个 read-session
 *   （ttl 缺省 DEFAULT_READ_SESSION_TTL_MS、maxLifetimeMs 缺省 null 显式续租、时钟可注入），
 *   枚举/读取/校验/逐条物化全程持约；逐条物化前跑 renewIfDue 检查点（bounded 拒续 →
 *   `lease-expired` 诚实中止）；**所有返回路径 finally close**（恒释放——INV-227-8）。
 *   调用方 `readSession` 供参非法（ttlMs/maxLifetimeMs 非 safe integer ≥1）→ open
 *   抛面由顶层 catch 收敛为 `failed` + 既有 `replay-internal-error`（零新码——K-3/N-B）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import {
  DEFAULT_READ_SESSION_TTL_MS,
  READ_SESSION_RENEW_MARGIN_MS,
  isSafeNamespaceId,
  isSafeStreamId,
  materializeStrictRecordUpdate,
  openDiagnosticReadSession,
  readStreamStrict,
  type DiagnosticReadSession,
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

/** #227：replay 自开 read-session 的供参（增量、可选——零破坏；缺省 = 冻结缺省）。 */
export interface DiagnosticReplayReadSessionOptions {
  /** 单次租期 ms；缺省 DEFAULT_READ_SESSION_TTL_MS（15_000）；须 ≥1 safe integer。 */
  readonly ttlMs?: number | undefined;
  /** 最长可续租总时长（自 open 起）；缺省 null = 显式续租模式（ADR 允许项之二）。
   *  bounded（数字）时续租越界 → 解释性拒续 → `lease-expired` 诚实中止（AC1 失败臂）。 */
  readonly maxLifetimeMs?: number | null | undefined;
  /** 测试确定性注入面；缺省真实时钟。 */
  readonly clock?: { now(): number } | undefined;
}

export type ReplayNamespaceDiagnosticLogRequest = {
  rootDir: string;
  namespaceId: string;
  /** #227 增量（可选）：replay 自开会话的供参（ttl/maxLifetime/clock）。 */
  readSession?: DiagnosticReplayReadSessionOptions | undefined;
};

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
    // ① locator（ADR-0014 冻结布局；与 file.ts resolveResumeCandidate 同一物理契约）
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

    // #227 §3.4.2 会话取得（locator 解析成功后）：open 失败（K-3/N-B：非法供参抛面）
    // → 顶层 catch 收敛 failed + replay-internal-error（零新码）；成功 → 内层
    // try/finally 恒释放（INV-227-8——含 incompatible 早退与 ④ 各 break 分支）。
    const readSessionOptions = request.readSession;
    const session: DiagnosticReadSession = openDiagnosticReadSession({
      rootDir: request.rootDir,
      namespaceId: request.namespaceId,
      streamId,
      ttlMs: readSessionOptions?.ttlMs ?? DEFAULT_READ_SESSION_TTL_MS,
      maxLifetimeMs: readSessionOptions?.maxLifetimeMs ?? null,
      clock: readSessionOptions?.clock,
    });
    try {
      // ② replay 强制 strict（唯一读取模式；自身绝不抛——P5；#227：枚举/读取/校验全程持约）
      const read = readStreamStrict({ ...strictRequest, session });
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

      // ④ 逐 entry strict 重放（detached Y.Doc；不暴露；连续性本地复核——#227 §4.3：
      //    以 materializeStrictRecordUpdate 为唯一分类源——app 侧 result 联合推导整体删除）
      const doc = new Y.Doc();
      let expectedNext: bigint | null = null;
      let genesisSeen = false;
      let attemptSeen = false;
      // entryLoop 标签：materialize switch 内的终止分支（omitted/unknown/invalid）须
      // break 整个 entry 循环（switch 的 break 只出 switch——D3 首版实现漏网实证）。
      entryLoop: for (const entry of read.records) {
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
          // #227：物化前续租检查点（bounded 拒续 → lease-expired 诚实中止）
          if (!session.renewIfDue(READ_SESSION_RENEW_MARGIN_MS)) {
            issues.push({ code: 'lease-expired' });
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
        // 连续性复核（BigInt 逐条比对；reader 已保证十进制 canonical——无 throw 面）。
        // #227（N-1 备案）：先于物化/omitted 判定——断链是更早的事实，停止点由
        // continuity 命中（乱序 ∧ omitted 的 issue 码翻转 pin：sequence-gap 存续、
        // update-omitted 不再进入报告）。
        if (expectedNext !== null && BigInt(entry.sequence) !== expectedNext) {
          issues.push({ code: 'sequence-gap' });
          break;
        }
        // #227：物化前续租检查点（每条 attempt 物化都受租约保护——sidecar 重读同窗）
        if (!session.renewIfDue(READ_SESSION_RENEW_MARGIN_MS)) {
          issues.push({ code: 'lease-expired' });
          break;
        }
        // #227 §4.3：materialize 为唯一分类源——kind/committed/effect 判定归包内单源
        const m = materializeStrictRecordUpdate(strictRequest, entry);
        switch (m.kind) {
          case 'update': {
            if (!genesisSeen) {
              // 无基不虚构状态：跳过应用（issues 由 ⑤ genesis-missing 兜底），lastSeq 不动
              continue;
            }
            try {
              Y.applyUpdate(doc, m.bytes);
            } catch {
              issues.push({ code: 'update-undecodable' });
              break entryLoop; // 停止点：必要 update 不可解码 → 不继续处理后续 entry
            }
            applied += 1;
            lastSeq = entry.sequence;
            expectedNext = BigInt(entry.sequence) + 1n;
            break;
          }
          case 'omitted': {
            // 必要但省略（effect='update-omitted'——含 fatal-committed:false 手拼残差 K-2）
            issues.push({ code: 'update-omitted' });
            break entryLoop;
          }
          case 'unknown': {
            // #227 AC3：fatal ∧ committed:true ∧ effect ∉ {'update','update-omitted'}
            // （字面 'unknown' 或 effect 缺席）——完整性不可证 → 止步、不推进（INV-227-6）
            issues.push({ code: 'update-unknown' });
            break entryLoop;
          }
          case 'none': {
            // 可证无更新（noop/rejected/fatal-committed:false）：连续记录计数推进
            if (genesisSeen) {
              lastSeq = entry.sequence;
              expectedNext = BigInt(entry.sequence) + 1n;
            }
            break;
          }
          case 'invalid': {
            issues.push({ code: m.code });
            break entryLoop;
          }
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
      // ⑦ 三态（D9：failed = 无重放基；partial = 有基不完整；complete = 五条件全满足。
      //    #227 INV-227-7：complete 门表达式与 #155 逐字相同——收紧只经分类/issue 通道发生）
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
    } finally {
      // #227 INV-227-8：恒释放——replay 自开会话在所有返回路径（含 ④ break 早退与
      // 顶层 catch 异常逃逸）上 close（同步工具不抛——finally 恒达）。
      session.close();
    }
  } catch {
    // M1 顶层 catch-all（结构性不可达——①–⑧ 各步均已收敛；#227 K-3/N-B：session open
    // 的非法供参 throw 面亦在此收敛）：不冒充可解释状态
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

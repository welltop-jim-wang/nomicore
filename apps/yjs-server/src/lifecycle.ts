/**
 * 应用生命周期编排基建（设计 §3.5/§3.6/§3.4 锁守卫）：
 *
 *  - NDJSON 事件 sink：stdout 是全应用生命周期事件面（每事件一行 JSON 对象）；
 *  - FilePersistence 锁守卫：`<rootDir>/.nomicore-lock.json`（`wx` 独占创建，
 *    内容 `{instanceId, pid, nonce}`），共享活跃 root 被 loud 拒绝（AC2
 *    unsupported）；干净停机删除；崩溃残留经 pid 存活性判定为 stale 后以
 *    「守卫重读字节全等 → unlink → `wx` 原子重取」回环回收（issue #191：
 *    所有权转移永不经过非独占覆写，release 只删内容仍等于本 handle payload
 *    的锁文件）。
 *
 * 事件对象经 sink 输出时**不得**携带 token/owner 值/Yjs bytes/SCHEMA/ROOT 内容
 * （复制域事件直接映射公共 `ReplicationObserver` 判别联合——包已脱敏）。
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type EventSink = (event: Readonly<Record<string, unknown>>) => void;

/** 生产 sink：每事件一行 NDJSON 到 stdout。 */
export function createStdoutEventSink(): EventSink {
  return (event) => {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  };
}

/** rootDir 内保留名锁文件（adapter 只触 `users/`、`archive/users/` 受控子树，零干扰）。 */
export const ROOT_LOCK_FILE_NAME = '.nomicore-lock.json';

export interface RootLockHandle {
  release(): void;
}

function lockPath(rootDir: string): string {
  return join(rootDir, ROOT_LOCK_FILE_NAME);
}

/** 原始锁文件字节 → 字段挑选解析（吞 parse 错 → {}，现状语义保留；`nonce` 键天然忽略）。 */
function parseLockInfo(raw: string): { instanceId?: unknown; pid?: unknown } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { instanceId: parsed.instanceId, pid: parsed.pid };
  } catch {
    return {};
  }
}

function isPidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 测试编排 hooks（issue #191 红灯契约）。可选参数；生产调用方（main.ts 两参
 * 调用）不传 → 行为零差异。**测试编排用、生产调用方不得传。**
 */
export interface RootLockAcquireHooks {
  /**
   * seam①：`wx` 撞 EEXIST 之后、stale 判定读之前同步回调。
   * 用于确定性注入「另一竞争者恰在此窗口完成重取」的交错（SA1 §5 T4）。
   * seam 内抛出的异常原样向外传播（不吞）。
   */
  beforeStaleReclaimDecision?: () => void;
  /**
   * seam②（SA2 RC1）：判定读已完成、pid 已判死、护栏未触发，RC1 内容守卫
   * 重读之前同步回调，携带判定读读到的原始字节（grounding 依据，测试可断言
   * 其等于种子内容）。用于确定性注入「竞争者在判定读与 unlink 之间完成回收」
   * 的交错（SA1 §5 T8）。seam 内抛出的异常原样向外传播（不吞）。
   */
  beforeStaleUnlink?: (rawStaleContent: string) => void;
}

/**
 * 回收回环护栏：每轮 continue 的必要条件是「有他人在本轮内完成 取锁→死亡→
 * 被顶替」的完整周期；8 轮远超现实竞争方数量，超限 = churn 异常 → loud
 * （禁止 boot 期死循环）。护栏不是可调配置。
 */
const MAX_RECLAIM_ATTEMPTS = 8;

/** rootDir 不可写（EACCES/EPERM）→ loud 错误（文案与现状逐字一致，指向部署文档）。 */
function loudUnwritable(errno: string): Error {
  return new Error(
    `cannot write ${ROOT_LOCK_FILE_NAME} in rootDir (${errno}): file persistence requires a writable rootDir — see docs/integration/hub-peer-deployment.md`,
  );
}

/**
 * 独占获取 rootDir 锁。冲突（现存锁且 pid 存活）→ loud throw（文案区分「同实例
 * 重复启动」与「不同实例共享 root（unsupported）」并打印锁内 `{instanceId,pid}`）；
 * pid 已死 = stale 回收：判定读（grounding 字节）→ seam②（可选）→ 守卫重读
 * （字节全等才删）→ unlink → `wx` 原子重取回环（护栏 = MAX_RECLAIM_ATTEMPTS
 * 轮），竞争败者回环重判读到胜者活 pid → loud；
 * `wx`/unlink 的 EACCES/EPERM（rootDir 不可写）→ loud throw 并指向部署文档
 * （rootDir 可写性是 file 模式前置条件）。所有权转移永不经过非独占覆写：
 * `flag:'w'` 在本函数中不存在（issue #191 I1）。
 */
export function acquireRootLock(
  rootDir: string,
  instanceId: string,
  hooks?: RootLockAcquireHooks,
): RootLockHandle {
  const payload = JSON.stringify({ instanceId, pid: process.pid, nonce: randomUUID() });

  // ① rootDir 缺省语义 = 创建（保持现状）；EACCES/EPERM → loud 不可写诊断（同现文案）。
  try {
    mkdirSync(rootDir, { recursive: true });
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
    throw error;
  }

  for (let attempt = 0; ; attempt += 1) {
    // ② 首选路径：独占创建。成功 = 持锁（fresh 或「他人已把 stale 清走」后的重试）。
    try {
      writeFileSync(lockPath(rootDir), payload, { flag: 'wx' });
      break; // ← 唯一的持锁出口，全部经 O_EXCL 裁决
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      if (errno !== 'EEXIST') throw error;
    }

    // ③ EEXIST：先给测试 seam① 一个确定性编排点（生产无操作），再做判定读。
    hooks?.beforeStaleReclaimDecision?.();

    // 判定读（RC1）：一次性取原始字节——守卫比对的 grounding 依据。读失败 → ''，
    // 与现状 readLockInfo「读失败/parse 失败同归 {}」语义等价（不可读/消失均作 stale
    // 判定输入）。
    let raw = '';
    try {
      raw = readFileSync(lockPath(rootDir), 'utf8');
    } catch {
      // 读失败 → ''（下行 parse 亦失败 → {} → 判 stale；后续走向见下方守卫/护栏）。
    }
    const info = parseLockInfo(raw); // '' / 非法 JSON → {instanceId:undefined,pid:undefined}（现状语义保留）
    const owner = `{instanceId: ${JSON.stringify(info.instanceId)}, pid: ${JSON.stringify(info.pid)}}`;
    if (isPidAlive(info.pid)) {
      // 活 owner：loud 双态文案（逐字保留）。竞争败者在下一轮回环走到这里 → "sees held"。
      throw new Error(
        info.instanceId === instanceId
          ? `rootDir lock ${ROOT_LOCK_FILE_NAME} is held by the same instance (${owner}): previous instance did not shut down cleanly — remove the lock file manually if you are certain it is stale (pid reuse caveat: see docs/integration/hub-peer-deployment.md)`
          : `shared file persistence root is unsupported: another instance holds ${ROOT_LOCK_FILE_NAME} (${owner}) — each process needs its own rootDir (see docs/integration/hub-peer-deployment.md)`,
      );
    }

    // ④ 活锁护栏：每轮 continue 都要求「有他人在本轮内完成 取锁→死亡→再被顶替」
    //    的全周期；超限 = churn 异常 → loud（禁止 boot 期死循环）。
    if (attempt >= MAX_RECLAIM_ATTEMPTS) {
      throw new Error(
        `root lock reclaim for ${ROOT_LOCK_FILE_NAME} did not converge after ${MAX_RECLAIM_ATTEMPTS} attempts (concurrent reclaim churn on this rootDir) — retry boot`,
      );
    }

    // ⑤ 原子重取（RC1 守卫 + 两步独占，绝不使用 flag:'w' 非独占覆写）：
    //    5a. seam②（测试编排点，生产无操作）：携带 grounding 原始字节，置于守卫重读之前
    //        （T8 在此把锁文件整体替换为胜者 payload，模拟「判定读→unlink 窗内被顶替」）。
    hooks?.beforeStaleUnlink?.(raw);

    //    5b. RC1 内容守卫：紧贴 unlink 重读原始字节，与 grounding 字节全等才允许删。
    //        竞争者 B 在 A 的 kill 探测/簿记期间完成「unlink stale + wx 建新锁」时，此重读
    //        必不等 → 回环重判 → 读到 B 活 pid → loud held（最可几变体就此关闭，§7.1）。
    //        重读失败（消失/不可读）同样回环（② wx 可能直接成功）。
    let recheck: string;
    try {
      recheck = readFileSync(lockPath(rootDir), 'utf8');
    } catch {
      continue;
    }
    if (recheck !== raw) continue; // 内容已被换 → 判死结论过期 → 回环重判

    //    5c. 删 stale 文件；ENOENT = 他人已删/已换 → 回环重判（不是错误）。
    try {
      unlinkSync(lockPath(rootDir));
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') continue;
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }
    //    5d. 独占创建。EEXIST = 输掉重取竞争（胜者已持锁）→ 回环 → ③ 读到胜者活 pid → loud held。
    try {
      writeFileSync(lockPath(rootDir), payload, { flag: 'wx' });
      break; // 赢得重取
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'EEXIST') continue; // 败者回环，不覆写胜者
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }
  }

  // ⑥ release：所有权校验删除（I3——只删内容仍等于本 handle 写入的 payload 的锁）。
  return {
    /**
     * 释放本 handle 的锁（幂等、永不 throw）。所有权校验：读锁文件并与本次
     * 获取写入的 payload 字节串全等才 unlink；否则不动磁盘。文件不存在 /
     * 不可读 → 吞错（现状幂等语义保留）。内容不等时**静默 no-op 是刻意选择**：
     * 正常流程中 release 时文件必然是自己写的，不等只可能来自真实竞争/接管，
     * 此时不动磁盘恰是保守正确行为（绝不误删后继者的锁）。
     */
    release(): void {
      try {
        const current = readFileSync(lockPath(rootDir), 'utf8');
        if (current !== payload) return; // 后继者（或任何人）持锁 —— 绝不误删（I3）
        unlinkSync(lockPath(rootDir));
      } catch {
        // 文件不存在/不可读 —— 释放幂等（现状语义保留）。
      }
    },
  };
}

/** 稳定码注册表（设计 §3.4，append-only；app 运行期控制通道回执用）。
 * #140（Phase 5 管理动词）追加：registry `resetReplica` 窄 issue 七码透传 +
 * `reset-replica-failed`（branded fatal / 结构性防御边界）。 */
export const STABLE_OP_ERROR_CODES = Object.freeze([
  'malformed-line',
  'unknown-op',
  'invalid-op-args',
  'namespace-unknown',
  'verify-write-timeout',
  'write-failed',
  'read-failed',
  'NAMESPACE_INVALID_IDENTITY',
  'REGISTRY_NOT_ACCEPTING',
  'NAMESPACE_NOT_FOUND',
  'NAMESPACE_RESET_IDENTITY_MISMATCH',
  'NAMESPACE_RESET_FAILED',
  'NAMESPACE_LOAD_FAILED',
  'NAMESPACE_RESET_EXPECTED_IDENTITY_INVALID',
  'reset-replica-failed',
]);

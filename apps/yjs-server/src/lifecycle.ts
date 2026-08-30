/**
 * 应用生命周期编排基建（设计 §3.5/§3.6/§3.4 锁守卫）：
 *
 *  - NDJSON 事件 sink：stdout 是全应用生命周期事件面（每事件一行 JSON 对象）；
 *  - FilePersistence 锁守卫：`<rootDir>/.nomicore-lock.json`（`wx` 独占创建，
 *    内容 `{instanceId, pid}`），共享活跃 root 被 loud 拒绝（AC2 unsupported）；
 *    干净停机删除；崩溃残留经 pid 存活性 stale 覆盖。
 *
 * 事件对象经 sink 输出时**不得**携带 token/owner 值/Yjs bytes/SCHEMA/ROOT 内容
 * （复制域事件直接映射公共 `ReplicationObserver` 判别联合——包已脱敏）。
 */
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

function readLockInfo(rootDir: string): { instanceId?: unknown; pid?: unknown } {
  try {
    const parsed = JSON.parse(readFileSync(lockPath(rootDir), 'utf8')) as Record<string, unknown>;
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
 * 独占获取 rootDir 锁。冲突（现存锁且 pid 存活）→ loud throw（文案区分「同实例
 * 重复启动」与「不同实例共享 root（unsupported）」并打印锁内 `{instanceId,pid}`）；
 * pid 已死 = stale 覆盖；`wx` EACCES/EPERM（rootDir 不可写）→ loud throw 并指向
 * 部署文档（rootDir 可写性是 file 模式前置条件）。
 */
export function acquireRootLock(rootDir: string, instanceId: string): RootLockHandle {
  const payload = JSON.stringify({ instanceId, pid: process.pid });
  try {
    // rootDir 须存在（file adapter 的 `users/` 子树前提）；缺省语义 = 创建（部署文档：
    // rootDir 可写性是 file 模式前置条件）。
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(lockPath(rootDir), payload, { flag: 'wx' });
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === 'EEXIST') {
      const info = readLockInfo(rootDir);
      const owner = `{instanceId: ${JSON.stringify(info.instanceId)}, pid: ${JSON.stringify(info.pid)}}`;
      if (isPidAlive(info.pid)) {
        const sameInstance = info.instanceId === instanceId;
        throw new Error(
          sameInstance
            ? `rootDir lock ${ROOT_LOCK_FILE_NAME} is held by the same instance (${owner}): previous instance did not shut down cleanly — remove the lock file manually if you are certain it is stale (pid reuse caveat: see docs/integration/hub-peer-deployment.md)`
            : `shared file persistence root is unsupported: another instance holds ${ROOT_LOCK_FILE_NAME} (${owner}) — each process needs its own rootDir (see docs/integration/hub-peer-deployment.md)`,
        );
      }
      // stale（pid 已死）：覆盖重取。
      writeFileSync(lockPath(rootDir), payload, { flag: 'w' });
    } else if (errno === 'EACCES' || errno === 'EPERM') {
      throw new Error(
        `cannot write ${ROOT_LOCK_FILE_NAME} in rootDir (${errno}): file persistence requires a writable rootDir — see docs/integration/hub-peer-deployment.md`,
      );
    } else {
      throw error;
    }
  }
  return {
    release(): void {
      try {
        unlinkSync(lockPath(rootDir));
      } catch {
        // 已删除/不存在——释放幂等。
      }
    },
  };
}

/** 稳定码注册表（设计 §3.4，append-only；app 运行期控制通道回执用）。 */
export const STABLE_OP_ERROR_CODES = Object.freeze([
  'malformed-line',
  'unknown-op',
  'invalid-op-args',
  'namespace-unknown',
  'verify-write-timeout',
  'write-failed',
  'read-failed',
]);

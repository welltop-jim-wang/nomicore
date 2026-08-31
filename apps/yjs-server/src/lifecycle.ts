import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export type EventSink = (event: Readonly<Record<string, unknown>>) => void;

export function createStdoutEventSink(): EventSink {
  return (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
}

/** Compatibility mirror used by diagnostics and process tooling. */
export const ROOT_LOCK_FILE_NAME = '.nomicore-lock.json';
const ROOT_LOCK_DIRECTORY_NAME = '.nomicore-lock';
const ROOT_LOCK_OWNER_FILE_NAME = 'owner.json';

export interface RootLockHandle {
  release(): void;
}

function legacyLockPath(rootDir: string): string {
  return join(rootDir, ROOT_LOCK_FILE_NAME);
}

function lockDirectoryPath(rootDir: string): string {
  return join(rootDir, ROOT_LOCK_DIRECTORY_NAME);
}

function ownerPath(lockDirectory: string): string {
  return join(lockDirectory, ROOT_LOCK_OWNER_FILE_NAME);
}

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

function loudUnwritable(errno: string): Error {
  return new Error(
    `cannot write ${ROOT_LOCK_FILE_NAME} in rootDir (${errno}): file persistence requires a writable rootDir — see docs/integration/hub-peer-deployment.md`,
  );
}

function heldError(instanceId: string, raw: string): Error | undefined {
  const info = parseLockInfo(raw);
  if (!isPidAlive(info.pid)) return undefined;
  const owner = `{instanceId: ${JSON.stringify(info.instanceId)}, pid: ${JSON.stringify(info.pid)}}`;
  return new Error(
    info.instanceId === instanceId
      ? `rootDir lock ${ROOT_LOCK_FILE_NAME} is held by the same instance (${owner}): previous instance did not shut down cleanly — remove the lock file manually if you are certain it is stale (pid reuse caveat: see docs/integration/hub-peer-deployment.md)`
      : `shared file persistence root is unsupported: another instance holds ${ROOT_LOCK_FILE_NAME} (${owner}) — each process needs its own rootDir (see docs/integration/hub-peer-deployment.md)`,
  );
}

function readOwner(lockDirectory: string): string {
  try {
    return readFileSync(ownerPath(lockDirectory), 'utf8');
  } catch {
    return '';
  }
}

function publishLegacyMirror(rootDir: string, payload: string): void {
  try {
    writeFileSync(legacyLockPath(rootDir), payload, { flag: 'wx' });
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === 'EEXIST') {
      try {
        unlinkSync(legacyLockPath(rootDir));
        writeFileSync(legacyLockPath(rootDir), payload, { flag: 'wx' });
        return;
      } catch (retryError) {
        const retryErrno = (retryError as NodeJS.ErrnoException).code;
        if (retryErrno === 'EACCES' || retryErrno === 'EPERM') throw loudUnwritable(retryErrno);
        throw retryError;
      }
    }
    if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
    throw error;
  }
}

/**
 * The lock directory itself is the ownership token. `mkdir` is the acquisition
 * linearization point. Stale directories are atomically detached with rename;
 * release removes only its detached directory, never a successor pathname.
 */
export function acquireRootLock(rootDir: string, instanceId: string): RootLockHandle {
  const payload = JSON.stringify({ instanceId, pid: process.pid, nonce: randomUUID() });
  const canonical = lockDirectoryPath(rootDir);

  try {
    mkdirSync(rootDir, { recursive: true });
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
    throw error;
  }

  for (;;) {
    try {
      mkdirSync(canonical);
      try {
        writeFileSync(ownerPath(canonical), payload, { flag: 'wx' });
        publishLegacyMirror(rootDir, payload);
        break;
      } catch (error) {
        rmSync(canonical, { recursive: true, force: true });
        throw error;
      }
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      if (errno !== 'EEXIST') throw error;
    }

    const raw = readOwner(canonical);
    const held = heldError(instanceId, raw);
    if (held !== undefined) throw held;

    const tombstone = join(rootDir, `${ROOT_LOCK_DIRECTORY_NAME}.reap-${randomUUID()}`);
    try {
      renameSync(canonical, tombstone);
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT' || errno === 'EEXIST' || errno === 'ENOTEMPTY') continue;
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }

    const movedRaw = readOwner(tombstone);
    if (movedRaw !== raw) {
      // The pathname changed after our stale decision: we detached a successor's
      // live lock. Never leave canonical absent while that owner is alive. First
      // restore it; if another owner already acquired canonical, keep the
      // detached evidence and fail closed instead of allowing two live owners.
      try {
        renameSync(tombstone, canonical);
      } catch {
        const movedHeld = heldError(instanceId, movedRaw);
        if (movedHeld !== undefined) throw movedHeld;
      }
      continue;
    }
    rmSync(tombstone, { recursive: true, force: true });
  }

  let released = false;
  return {
    release(): void {
      if (released) return;
      const detached = join(rootDir, `${ROOT_LOCK_DIRECTORY_NAME}.release-${randomUUID()}`);
      try {
        renameSync(canonical, detached);
      } catch {
        return;
      }
      const detachedPayload = readOwner(detached);
      if (detachedPayload !== payload) {
        // Do not delete another owner's directory. It is detached, so attempt a
        // no-overwrite restore; if a successor exists this fails safely.
        try {
          renameSync(detached, canonical);
        } catch {
          // Successor owns canonical; preserve detached evidence.
        }
        return;
      }
      try {
        unlinkSync(ownerPath(detached));
        rmdirSync(detached);
      } catch {
        return;
      }
      try {
        const mirror = readFileSync(legacyLockPath(rootDir), 'utf8');
        if (mirror === payload) unlinkSync(legacyLockPath(rootDir));
      } catch {
        // Compatibility mirror is best-effort on release.
      }
      released = true;
    },
  };
}

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

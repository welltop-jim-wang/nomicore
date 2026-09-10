import { randomUUID } from 'node:crypto';
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export type EventSink = (event: Readonly<Record<string, unknown>>) => void;

export function createStdoutEventSink(): EventSink {
  return (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
}

/** Compatibility mirror used by diagnostics and process tooling. */
export const ROOT_LOCK_FILE_NAME = '.nomicore-lock.json';
const ROOT_LOCK_DIRECTORY_NAME = '.nomicore-lock';
const ROOT_LOCK_OWNER_FILE_NAME = 'owner.json';

// Module-private rootDir-top-level artifact families (D1/D1′/D6; none exported):
const ROOT_LOCK_STAGING_PREFIX = '.nomicore-lock.acquire-'; // staging dir (CAS unit)
const ROOT_LOCK_REAP_CLAIM_FILE_NAME = '.nomicore-lock.reap-claim'; // claim gate path
const ROOT_LOCK_REAP_CLAIM_STAGING_PREFIX = '.nomicore-lock.reap-claim.staging-'; // claim link source
const ROOT_LOCK_REAP_CLAIM_TOMB_PREFIX = '.nomicore-lock.reap-claim.reaped-'; // dead-claim takeover tomb
const ROOT_LOCK_CLAIM_WAIT_LIMIT_MS = 5_000; // D6 claim-gate liveness budget

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

function readFileOrEmpty(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readOwner(lockDirectory: string): string {
  return readFileOrEmpty(ownerPath(lockDirectory));
}

/** D6: single new loud failure of the claim gate (never touches claim/canonical). */
function claimStuckError(claimRaw: string): Error {
  const info = parseLockInfo(claimRaw);
  const owner = `{instanceId: ${JSON.stringify(info.instanceId)}, pid: ${JSON.stringify(info.pid)}}`;
  return new Error(
    `root lock reclaim claim ${ROOT_LOCK_REAP_CLAIM_FILE_NAME} is still occupied by a live pid (${owner}) after ${ROOT_LOCK_CLAIM_WAIT_LIMIT_MS}ms without turnover: the holder is frozen or its pid was reused — verify that pid, then remove the claim file once you are certain it is stale (pid reuse caveat: see docs/integration/hub-peer-deployment.md)`,
  );
}

/** D3: read-only presence probe used to classify CAS EPERM/EACCES. */
function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === 'ENOENT' || errno === 'ENOTDIR') return false;
    throw error;
  }
}

/** `''`-evidence classification of the canonical pathname (zero side effects). */
function classifyCanonical(canonical: string): 'absent' | 'empty-dir' | 'stray-nondir' | 'dir-empty-owner' {
  try {
    const stat = lstatSync(canonical);
    if (!stat.isDirectory()) return 'stray-nondir';
    try {
      const entries = readdirSync(canonical);
      return entries.length === 0 ? 'empty-dir' : 'dir-empty-owner';
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') return 'absent';
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === 'ENOENT' || errno === 'ENOTDIR') return 'absent';
    if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
    throw error;
  }
}

/**
 * Claim sub-protocol (D1′): acquiring the gate is an atomic hard link of the
 * privately built claim payload — the claim name never exists without full
 * content (fixes the legacy empty-window unlink, SA6 A1①). EEXIST means a
 * competitor holds the gate: a live holder is a bounded denial via the D6
 * hooks; a dead holder is taken over by a single-winner rename-detach plus a
 * content re-check before the tombstone is removed (never a bare unlink).
 */
function takeReapClaim(
  claimPath: string,
  claimStaging: string,
  rootDir: string,
  instanceId: string,
  claimDenied: (claimRaw: string) => void,
  claimWaitReset: () => void,
): boolean {
  try {
    linkSync(claimStaging, claimPath);
    claimWaitReset();
    return true;
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno !== 'EEXIST') {
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }
    const claimRaw = readFileOrEmpty(claimPath);
    if (heldError(instanceId, claimRaw) !== undefined) {
      claimDenied(claimRaw); // D6: may throw claimStuckError after the budget
      return false;
    }
    // Dead-holder takeover: rename-detach is single-winner; the detached bytes
    // are re-checked before deletion (replaces the legacy unconditional unlink).
    const claimTomb = join(rootDir, `${ROOT_LOCK_REAP_CLAIM_TOMB_PREFIX}${randomUUID()}`);
    try {
      renameSync(claimPath, claimTomb);
    } catch (error) {
      const renameErrno = (error as NodeJS.ErrnoException).code;
      if (renameErrno === 'ENOENT') {
        claimWaitReset(); // another contender already took over → re-check
        return false;
      }
      if (renameErrno === 'EACCES' || renameErrno === 'EPERM') throw loudUnwritable(renameErrno);
      throw error;
    }
    const tombRaw = readFileOrEmpty(claimTomb);
    if (heldError(instanceId, tombRaw) !== undefined) {
      // A claim that turned out live was detached by the racing takeover —
      // restore it, or discard when the pathname was already re-occupied.
      try {
        renameSync(claimTomb, claimPath);
      } catch {
        // Path occupied by a fresh claim; tombstone residue is inert.
      }
      claimWaitReset();
      return false;
    }
    try {
      unlinkSync(claimTomb);
    } catch {
      // Discard (O-4): out-of-protocol shapes (e.g. tampered into a directory)
      // are private, unread by anyone, and do not block the protocol.
    }
    claimWaitReset();
    return false; // next loop iteration re-links as the single winner
  }
}

/** Content-checked claim release (same shape as the legacy finally block). */
function releaseReapClaim(claimPath: string, payload: string): void {
  try {
    if (readFileSync(claimPath, 'utf8') === payload) unlinkSync(claimPath);
  } catch {
    // Claim cleanup is best-effort; a stale claim is reclaimed below.
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
 * The lock directory itself is the ownership token. Acquisition publishes a
 * fully built private staging directory with one atomic `rename` to the
 * canonical path (I1: the canonical name never exists without its complete
 * owner.json), so success is bound to that rename event alone (I2). CAS
 * publishers and stale reclaimers all serialize on the `.reap-claim` gate
 * (I0): claim acquisition is an atomic hard link, dead holders are taken over
 * by a single-winner rename-detach with content re-check, and waiting for a
 * live holder is bounded (I3) — one unchanged occupancy for more than
 * ROOT_LOCK_CLAIM_WAIT_LIMIT_MS fails loudly with claimStuckError instead of
 * spinning forever; the gate is never taken by force. Release removes only
 * its detached directory, never a successor pathname.
 */
export function acquireRootLock(rootDir: string, instanceId: string): RootLockHandle {
  const payload = JSON.stringify({ instanceId, pid: process.pid, nonce: randomUUID() });
  const canonical = lockDirectoryPath(rootDir);
  const claimPath = join(rootDir, ROOT_LOCK_REAP_CLAIM_FILE_NAME);

  try {
    mkdirSync(rootDir, { recursive: true });
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
    throw error;
  }

  // NEW ① Private staging built once per call: the CAS publication unit and
  // the claim-link source both exist complete before any competitor can
  // observe them; nothing on this path is judged by others.
  const staging = join(rootDir, `${ROOT_LOCK_STAGING_PREFIX}${randomUUID()}`);
  const claimStaging = join(rootDir, `${ROOT_LOCK_REAP_CLAIM_STAGING_PREFIX}${randomUUID()}`);
  let published = false;
  try {
    try {
      mkdirSync(staging);
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }
    try {
      writeFileSync(ownerPath(staging), payload, { flag: 'wx' });
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }
    try {
      writeFileSync(claimStaging, payload, { flag: 'wx' });
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }

    // D6 claim-gate liveness budget. Accounting is per call and keyed by the
    // claim occupancy content (nonce = occupancy identity): a changed content
    // (legal handover) or an absent claim resets the accounting; the same
    // live occupancy denied for >= ROOT_LOCK_CLAIM_WAIT_LIMIT_MS aborts loud.
    let deniedClaimRaw: string | undefined;
    let deniedSince = 0;
    const claimWaitReset = (): void => {
      deniedClaimRaw = undefined;
    };
    const claimDenied = (claimRaw: string): void => {
      if (claimRaw !== deniedClaimRaw) {
        deniedClaimRaw = claimRaw;
        deniedSince = performance.now();
        return;
      }
      if (performance.now() - deniedSince >= ROOT_LOCK_CLAIM_WAIT_LIMIT_MS) {
        throw claimStuckError(claimRaw); // I3: bounded loud exit, never seizes the gate
      }
    };

    for (;;) {
      // NEW ② Claim gate: every canonical mutator (CAS publisher or reaper)
      // must hold it. A live holder only delays within the D6 budget;
      // dead-holder takeover runs inside the claim sub-protocol.
      if (!takeReapClaim(claimPath, claimStaging, rootDir, instanceId, claimDenied, claimWaitReset)) {
        continue;
      }
      claimWaitReset();
      try {
        // NEW ③ Acquisition = atomic CAS; this rename is the only success exit.
        try {
          renameSync(staging, canonical);
          published = true;
        } catch (error) {
          const errno = (error as NodeJS.ErrnoException).code;
          if (errno === 'EACCES' || errno === 'EPERM') {
            // D3: read-only probe classifies EPERM — canonical present means
            // contention (ladder below); absent means genuinely unwritable.
            if (!pathExists(canonical)) throw loudUnwritable(errno);
          } else if (errno !== 'EEXIST' && errno !== 'ENOTEMPTY' && errno !== 'ENOTDIR') {
            throw error; // incl. ENOENT: honest, same as the legacy mkdir arm
          }
        }
        if (published) {
          // Claim-gated: no contender can occupy canonical in this window, so
          // cleanup below can only ever remove our own just-published directory.
          try {
            publishLegacyMirror(rootDir, payload);
          } catch (error) {
            rmSync(canonical, { recursive: true, force: true }); // sole exception (D4 #10)
            throw error;
          }
          break;
        }

        // NEW ④ Evidence-gated ladder (every step under the claim gate).
        const raw = readOwner(canonical);
        const held = heldError(instanceId, raw);
        if (held !== undefined) throw held;

        if (raw !== '') {
          // Main stale-reap path: only a non-empty dead payload (unique nonce
          // = identity) may detach a directory. Existing guard chain inlined
          // unchanged: re-read equals the judged evidence, single-winner
          // rename detach, detached-bytes comparison, restore on mismatch.
          const tombstone = join(rootDir, `${ROOT_LOCK_DIRECTORY_NAME}.reap-${randomUUID()}`);
          try {
            const claimedRaw = readOwner(canonical);
            const claimedHeld = heldError(instanceId, claimedRaw);
            if (claimedHeld !== undefined) throw claimedHeld;
            if (claimedRaw !== raw) continue;
            renameSync(canonical, tombstone);
          } catch (error) {
            const errno = (error as NodeJS.ErrnoException).code;
            if (errno === 'ENOENT' || errno === 'EEXIST' || errno === 'ENOTEMPTY') continue;
            if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
            throw error;
          }
          const movedRaw = readOwner(tombstone);
          if (movedRaw !== raw) {
            try {
              renameSync(tombstone, canonical);
            } catch {
              const movedHeld = heldError(instanceId, movedRaw);
              if (movedHeld !== undefined) throw movedHeld;
            }
            continue;
          }
          rmSync(tombstone, { recursive: true, force: true });
          continue;
        }

        // `''` evidence never detaches a directory by rename. It is dispatched
        // to conditional primitives only: absent → CAS retry; empty directory
        // (L1 legacy residue) → rmdir; stray non-directory → single-winner
        // rename detach; L2 `{owner.json: ''}` / stray entries → gated cleanup.
        try {
          const kind = classifyCanonical(canonical);
          if (kind === 'absent') {
            continue; // no canonical → straight back to the CAS loop
          }
          if (kind === 'empty-dir') {
            rmdirSync(canonical); // L1: rmdir is empty-directory-only by
            continue; // semantics; it cannot remove a published canonical
          }
          if (kind === 'stray-nondir') {
            // D2: restore takeover parity for files/symlinks squatting on the
            // canonical name (CAS rename onto them fails with ENOTDIR).
            const strayTomb = join(rootDir, `${ROOT_LOCK_DIRECTORY_NAME}.reap-${randomUUID()}`);
            renameSync(canonical, strayTomb);
            unlinkSync(strayTomb); // file or symlink; rmSync(force) refuses symlink-to-dir
            continue;
          }
          // kind === 'dir-empty-owner': L2 residue or stray entries inside the
          // directory. Under the claim gate no protocol participant can
          // publish into it, so removal targets only these legacy shapes.
          for (const entry of readdirSync(canonical)) {
            const entryPath = join(canonical, entry);
            if (lstatSync(entryPath).isDirectory()) {
              rmSync(entryPath, { recursive: true, force: true }); // single pass; no maxRetries
            } else {
              unlinkSync(entryPath);
            }
          }
          rmdirSync(canonical);
          continue;
        } catch (error) {
          // #11 errno contract: ENOENT/ENOTEMPTY mean progress or a new
          // occupant — re-check from the loop top; EACCES/EPERM map to the
          // existing loud unwritable error; anything else rethrows honest.
          const errno = (error as NodeJS.ErrnoException).code;
          if (errno === 'ENOENT' || errno === 'ENOTEMPTY') continue;
          if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
          throw error;
        }
      } finally {
        releaseReapClaim(claimPath, payload);
      }
    }
  } finally {
    // NEW ⑤ Any exit removes this call's two private artifacts (best effort);
    // after a successful publish the staging directory was consumed by rename.
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // Best effort on a private unique name.
    }
    try {
      unlinkSync(claimStaging);
    } catch {
      // Best effort on a private unique name.
    }
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

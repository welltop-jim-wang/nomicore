/**
 * [SA6 owned] 红灯契约 —— issue #191：apps/yjs-server 根锁 stale 回收原子化。
 *
 * 权威：TASK.md + wiki/raw/task_191_sa1.md（SA1 R2 设计 §5 T1-T9）+
 * wiki/raw/task_191_sa2.md（SA2 攻击评审 R2 复审：RC1-RC3 关闭、六项冻结面、
 * 移交要点 2 "SA6 落盘必须齐备 T1-T9 全部锚点"）。
 *
 * 被测面：`apps/yjs-server/src/lifecycle.ts` 的 acquireRootLock / release（经冻结
 * 公共入口 `../src/index.js`，先例 issue164-slice9-red.test.ts:18）。
 *
 * 全部断言锚在可观察运行时行为（锁文件内容 / existsSync / throw 文案 /
 * 返回 handle 的释放副作用），零源码 grep、零 sleep、零真并发、零进程 spawn、
 * 零 fake timer——唯一 fs 权限操作是 T3.3（目录 chmod 0o500）与 T9（文件 chmod
 * 0o000）的权限编排 + try/finally 还原（SA2 攻击点 5 hygiene）。
 *
 * 红/绿矩阵（现状 main b66615c vs 修复后）：
 *   T1  nonce schema pin        🔴（现状 payload 无 nonce）   🟢
 *   T2  单回收者 stale          🟢                            🟢
 *   T3  活 owner 双态 + 不可写   🟢                            🟢
 *   T4  双回收者恰一胜（核心红） 🔴（seam 被忽略 → 无 throw）  🟢
 *   T5  迟到 release 不误删（红）🔴（无条件 unlink）           🟢
 *   T6  非法 JSON / 空文件       🟢                            🟢
 *   T7  守卫重读 ENOENT 回环 pin 🟢（seam 忽略覆写也绿）       🟢
 *   T8  守卫直接红锚（核心红）   🔴（seam 被忽略 → 无 throw）  🟢
 *   T9  release 不可读文件       🔴（无条件 unlink 删文件）    🟢（非 root）
 *
 * 注（设计文字与矩阵的冲突处置）：设计 §5 T1 文字明确含 `typeof nonce === 'string'`
 * （schema pin，§4.1 nonce 为修复本体契约、SA2 §6 冻结面第 2 条），故 T1 在现状即
 * 红——按文字执行，不以 §5 红绿矩阵的 "T1 🟢🟢" 摘除该锚。
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireRootLock,
  ROOT_LOCK_FILE_NAME,
  type RootLockAcquireHooks,
  type RootLockHandle,
} from '../src/index.js'; // 冻结公共入口（SA1 §5 通用约定；类型导入 verbatimModuleSyntax 下必须 type 形式）

// ─────────────────────────── 通用约定（SA1 §5） ───────────────────────────

/** 恒为死 pid：> Linux pid_max(2^22=4194304)，process.kill(pid, 0) 恒 ESRCH。 */
const DEAD_PID = 2 ** 31 - 1;

function lockPathOf(rootDir: string): string {
  return join(rootDir, ROOT_LOCK_FILE_NAME);
}

/** 用例内前置断言（SA1 P4 兜底）：DEAD_PID 在任何正常环境都必须不可运行。 */
function expectDeadPidUnrunnable(): void {
  expect(() => process.kill(DEAD_PID, 0)).toThrow();
}

function readLockPayload(rootDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(lockPathOf(rootDir), 'utf8')) as Record<string, unknown>;
}

const rootDirs: string[] = [];

function makeRootDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yjs-server-rootlock-'));
  rootDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of rootDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** root 环境跳过守卫（T3.3 / T9；CI ubuntu 非 root，与存量 T3 同风险水平——SA2 N3）。 */
const isRootUser = typeof process.getuid === 'function' && process.getuid() === 0;

// ─────────────────────────── T1-T9 契约 ───────────────────────────

describe('root lock atomic stale reclaim (issue #191, SA1 §5 T1-T9)', () => {
  it('T1: normal acquire writes own payload (incl. nonce) and release is idempotent', () => {
    const root = makeRootDir();
    const lockFile = lockPathOf(root);

    const h = acquireRootLock(root, 'instance-A');
    expect(existsSync(lockFile)).toBe(true);

    const payload = readLockPayload(root);
    expect(payload.instanceId).toBe('instance-A');
    expect(payload.pid).toBe(process.pid);
    expect(typeof payload.nonce).toBe('string'); // schema pin（§4.1：修复后 payload 必含 nonce）

    h.release();
    expect(existsSync(lockFile)).toBe(false);

    // 幂等释放（现状语义保留）：第二次 release 不得抛。
    expect(() => h.release()).not.toThrow();
    expect(existsSync(lockFile)).toBe(false);
  });

  it('T2: single reclaimer recovers a stale (dead-pid) lock and owns the root', () => {
    expectDeadPidUnrunnable();
    const root = makeRootDir();
    const lockFile = lockPathOf(root);

    // 种子 stale 锁（pid 已死）。
    writeFileSync(lockFile, JSON.stringify({ instanceId: 'dead-instance', pid: DEAD_PID }), { flag: 'w' });

    const h = acquireRootLock(root, 'instance-A'); // 不传 hooks（生产形态）
    expect(existsSync(lockFile)).toBe(true);

    // 文件内容为本进程 payload（解析比对 instanceId/pid，不比对 nonce——§5 T2）。
    const payload = readLockPayload(root);
    expect(payload.instanceId).toBe('instance-A');
    expect(payload.pid).toBe(process.pid);

    h.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it('T3: live owner dual diagnostics are loud and verbatim (same instance / shared root)', () => {
    const root = makeRootDir();
    const lockFile = lockPathOf(root);

    // 活 owner + 同 instanceId：held-by-same-instance + pid-reuse caveat 文案（§4.5 逐字 pin）。
    writeFileSync(lockFile, JSON.stringify({ instanceId: 'instance-A', pid: process.pid }), { flag: 'w' });
    const sameInstanceAttempt = () => acquireRootLock(root, 'instance-A');
    expect(sameInstanceAttempt).toThrow(/held by the same instance/);
    expect(sameInstanceAttempt).toThrow(/pid reuse caveat/);

    // 活 owner + 异 instanceId：shared-root unsupported + another instance holds（§4.5 逐字 pin）。
    writeFileSync(lockFile, JSON.stringify({ instanceId: 'instance-B', pid: process.pid }), { flag: 'w' });
    const sharedRootAttempt = () => acquireRootLock(root, 'instance-A');
    expect(sharedRootAttempt).toThrow(/shared file persistence root is unsupported/);
    expect(sharedRootAttempt).toThrow(/another instance holds/);
  });

  it.skipIf(isRootUser)(
    'T3: unwritable rootDir is loud (cannot write ... writable rootDir), chmod restored in finally',
    () => {
      const root = makeRootDir();
      chmodSync(root, 0o500); // r-x：目录不可写（root 环境跳过，前有 skipIf 守卫）
      try {
        const attempt = () => acquireRootLock(root, 'instance-A');
        expect(attempt).toThrow(/cannot write \.nomicore-lock\.json/);
        expect(attempt).toThrow(/writable rootDir/);
      } finally {
        // 断言先抛也必须还原 0o700，afterEach 的 rmSync 才能清得动目录（SA2 攻击点 5）。
        chmodSync(root, 0o700);
      }
    },
  );

  it('T4: two stale reclaimers — exactly one acquires, loser reports held, winner lock untouched (CORE RED)', () => {
    expectDeadPidUnrunnable();
    const root = makeRootDir();
    const lockFile = lockPathOf(root);

    // 种子 stale 锁 F1：两个回收者都观察到同一个死 pid 锁。
    writeFileSync(lockFile, JSON.stringify({ instanceId: 'dead-instance', pid: DEAD_PID }), { flag: 'w' });

    let winner: RootLockHandle | undefined;
    let hookFired = 0;
    const loserAttempt = () =>
      acquireRootLock(root, 'instance-A', {
        // seam①（SA1 §4.2）：EEXIST 之后、判定读之前。竞争者 B 在此窗口完成完整重取。
        beforeStaleReclaimDecision: () => {
          hookFired += 1;
          if (hookFired === 1) {
            // B: wx→EEXIST(种子 F1) → 读 DEAD_PID 判死 → unlink F1 → wx 成功 → 持锁。
            winner = acquireRootLock(root, 'instance-B');
          }
        },
      });

    // 红锚 1（nothrow）：败者必须 loud「held」，绝不静默返回 handle；现状 seam 被忽略 →
    // 不抛 + flag:'w' 覆写成功 → 本锚确定性红。
    expect(loserAttempt).toThrow(/another instance holds|shared file persistence root is unsupported/);
    // 红锚 2（hookFired === 0）：seam 必须真的被走到；现状为 0。
    expect(hookFired).toBe(1);
    // 红锚 3（survivor 字节）：恰好一个回收者（B）持锁；现状 winner undefined。
    expect(winner, 'exactly one reclaimer acquires').toBeDefined();

    const survivor = JSON.parse(readFileSync(lockFile, 'utf8')) as Record<string, unknown>;
    expect(survivor.instanceId).toBe('instance-B');
    expect(survivor.pid).toBe(process.pid);

    winner!.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it('T5: late/stale handle cannot unlink a successor lock; successor bytes survive (CORE RED)', () => {
    const root = makeRootDir();
    const lockFile = lockPathOf(root);

    const stale = acquireRootLock(root, 'instance-A'); // 本 handle 获取时的 payload（含 nonce₁）
    const successorPayload = JSON.stringify({
      instanceId: 'instance-B',
      pid: process.pid,
      nonce: 'successor',
    });
    writeFileSync(lockFile, successorPayload, { flag: 'w' }); // 模拟后继者已顶替

    stale.release();

    // 红锚：现状 release 无条件 unlinkSync → 文件被删 → 本锚确定性红。
    expect(existsSync(lockFile), 'late release must not unlink successor lock').toBe(true);
    // 逐字节相等（SA2 §3 加固：不只查 instanceId）。
    expect(
      readFileSync(lockFile, 'utf8'),
      'successor payload byte-identical after late release',
    ).toBe(successorPayload);

    rmSync(lockFile); // 清理
  });

  it('T6a: malformed (non-JSON) lock content is treated as stale and reclaimed', () => {
    const root = makeRootDir();
    const lockFile = lockPathOf(root);

    writeFileSync(lockFile, 'not-json', { flag: 'w' });

    const h = acquireRootLock(root, 'instance-A');
    const payload = readLockPayload(root);
    expect(payload.instanceId).toBe('instance-A');
    expect(payload.pid).toBe(process.pid);

    h.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it('T6b: empty lock file is treated as stale and reclaimed (partial-write window projection pin, RC2)', () => {
    const root = makeRootDir();
    const lockFile = lockPathOf(root);

    writeFileSync(lockFile, '', { flag: 'w' });

    const h = acquireRootLock(root, 'instance-A');
    const payload = readLockPayload(root);
    expect(payload.instanceId).toBe('instance-A');
    expect(payload.pid).toBe(process.pid);

    h.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it('T7 (pin): competitor deleted the stale lock inside seam — recheck-ENOENT loop still acquires', () => {
    expectDeadPidUnrunnable();
    const root = makeRootDir();
    const lockFile = lockPathOf(root);

    writeFileSync(lockFile, JSON.stringify({ instanceId: 'dead-instance', pid: DEAD_PID }), { flag: 'w' });

    const hooks: RootLockAcquireHooks = {
      // seam①：模拟竞争者在「EEXIST → 判定读」窗口内删完 stale 但还没建新锁。
      beforeStaleReclaimDecision: () => {
        rmSync(lockFile);
      },
    };

    // 判定读失败（'' → {} → 判死）→ 守卫重读 ENOENT → 回环 → wx 直取成功（§4.2 关键点 7「消失」分支）。
    const h = acquireRootLock(root, 'instance-A', hooks);
    const payload = readLockPayload(root);
    expect(payload.instanceId).toBe('instance-A');
    expect(payload.pid).toBe(process.pid);

    h.release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it('T8: guard refuses unlink when a winner replaced the lock between decision read and unlink (CORE RED)', () => {
    expectDeadPidUnrunnable();
    const root = makeRootDir();
    const lockFile = lockPathOf(root);

    const seedPayload = JSON.stringify({ instanceId: 'dead-instance', pid: DEAD_PID });
    writeFileSync(lockFile, seedPayload, { flag: 'w' }); // 种子 stale 锁 F1

    const winnerPayload = JSON.stringify({ instanceId: 'instance-B', pid: process.pid, nonce: 'winner' });
    let rawSeen: string | undefined;
    let unlinkHookFired = 0;

    const loserAttempt = () =>
      acquireRootLock(root, 'instance-A', {
        // seam②（SA1 §4.2 ⑤a，R2/RC1）：判定读之后、守卫重读之前，携带 grounding 原始字节。
        beforeStaleUnlink: (rawStaleContent) => {
          unlinkHookFired += 1;
          rawSeen = rawStaleContent;
          if (unlinkHookFired === 1) {
            // 模拟竞争者 B 恰在 A 的「判定读 → unlink」窗内完成完整回收
            // （B: unlink F1 + wx 建新锁；测试侧以整体替换等价模拟——生产代码无 flag:'w'）。
            writeFileSync(lockFile, winnerPayload, { flag: 'w' });
          }
        },
      });

    // 红锚 1（nothrow）：守卫必须拒绝删除 → 回环重判 → loud「held」；现状 seam 被忽略 →
    // 不抛 + flag:'w' 覆写成功 → 本锚确定性红。
    expect(loserAttempt).toThrow(/another instance holds|shared file persistence root is unsupported/);
    // 红锚 2（unlinkHookFired === 0）：seam② 必须真的被走到；现状为 0。
    expect(unlinkHookFired).toBe(1);
    // 红锚 3（rawSeen === seedPayload）：grounding 字节 = 判定读原始字节；现状 undefined。
    expect(rawSeen, 'grounding bytes = seed payload').toBe(seedPayload);
    // 红锚 4（survivor 逐字节）：胜者锁被 A 的守卫保全；现状文件被覆写为本进程 payload。
    expect(readFileSync(lockFile, 'utf8')).toBe(winnerPayload);

    rmSync(lockFile);
  });

  it.skipIf(isRootUser)(
    'T9: release on an unreadable lock file is a no-op and leaves the file (RC3 delta anchor)',
    () => {
      const root = makeRootDir();
      const lockFile = lockPathOf(root);

      const h = acquireRootLock(root, 'instance-A');
      chmodSync(lockFile, 0o000); // 属主不可读（root 环境跳过，前有 skipIf 守卫）
      try {
        // 红锚：现状 release 不读内容、无条件 unlink（unlink 只需父目录写权限）→ 文件被删
        // → 本锚确定性红；修复后语义 = 读失败吞错 no-op → 锁残留（§7.6 RC3 接受 delta）。
        expect(() => h.release()).not.toThrow();
        expect(existsSync(lockFile), 'unreadable lock must not be unlinked by release').toBe(true);
      } finally {
        // 断言先抛也必须还原 0o600，afterEach 的 rmSync 才能清得动（SA2 攻击点 5）。
        // 仅当文件仍在时还原：现状 release 会删掉文件（本用例红锚本体），此时无可还原。
        if (existsSync(lockFile)) chmodSync(lockFile, 0o600);
      }
    },
  );
});

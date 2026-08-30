/**
 * [SA4 B2 targeted] — 总超时 watchdog 与配置排空窗的数值矛盾（issue #139 fix round）。
 *
 * 背景：file 停机/换装「停旧」的排空窗 = `maxDirtyMs + 500ms`（app.ts），必须严格
 * 短于 main.ts 的固定总超时 watchdog（`STOP_WATCHDOG_MS = 60_000`）。修复前
 * `maxDirtyMs ≥ ~59_500` 的配置通过全部校验，但每次干净 SIGTERM 都死在排空 sleep
 * 中途（watchdog exit(1) 先于 persistence dispose，受保护的 dirty flush 随进程终止
 * 丢失）。修复（config.ts `MAX_MAX_DIRTY_MS` 上界 = 30_000）后，这类配置在启动期
 * 即被 loud 拒绝（`config-error` + violations + exit 1），不再存在「合法配置被
 * 不兼容硬编码 watchdog 击穿」的路径。本用例锚定该可观测行为（SA4 §R-B2 反向靶：
 * `maxDirtyMs: 60000` 下不再观测到 60s 后 exit(1)，而是 boot 即 loud 拒绝）。
 *
 * RED 基线：修复前该配置正常 boot（零拒绝），本用例在等待 exit 处超时失败。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const MAIN_TS = join(REPO_ROOT, 'apps', 'yjs-server', 'src', 'main.ts');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Proc {
  child: ChildProcess;
  raw: string[];
  stderr: string[];
  exitCode: number | null;
}

const liveProcs: Proc[] = [];

function spawnApp(configPath: string): Proc {
  const child = spawn(TSX_BIN, [MAIN_TS, '--config', configPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  const proc: Proc = { child, raw: [], stderr: [], exitCode: null };
  child.stdout!.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed) proc.raw.push(trimmed);
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    proc.stderr.push(chunk.toString('utf8'));
  });
  child.on('exit', (code) => {
    proc.exitCode = code;
  });
  liveProcs.push(proc);
  return proc;
}

async function waitForExit(proc: Proc, timeoutMs: number, what: string): Promise<number> {
  const start = Date.now();
  while (proc.exitCode === null) {
    if (Date.now() - start > timeoutMs) {
      proc.child.kill('SIGKILL');
      throw new Error(`timeout ${timeoutMs}ms waiting for ${what} to exit`);
    }
    await sleep(50);
  }
  return proc.exitCode;
}

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yjs-server-watchdog-'));
  tmpDirs.push(dir);
  return dir;
}

function writeConfig(dir: string, config: Record<string, unknown>): string {
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

afterEach(() => {
  for (const proc of liveProcs) {
    if (proc.exitCode === null) {
      proc.child.kill('SIGKILL');
    }
  }
  liveProcs.length = 0;
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('B2: total-timeout watchdog vs configured dirty-flush drain window (SA4 §R-B2)', () => {
  it(
    'boot rejects maxDirtyMs above the stop-watchdog budget loudly (config-error + exit 1, never a watchdog-killed flush)',
    async () => {
      const hubRoot = makeTmpDir();
      const configPath = writeConfig(hubRoot, {
        role: 'hub',
        instanceId: 'hub-1',
        persistence: {
          kind: 'file',
          rootDir: hubRoot,
          schedule: { debounceMs: 250, maxDirtyMs: 60_000 },
        },
        hub: {
          listen: { host: '127.0.0.1', port: 0 },
          tokens: { 'peer-1': 'token-1' },
        },
      });

      const proc = spawnApp(configPath);
      const exitCode = await waitForExit(proc, 30_000, 'boot-time config rejection');
      expect(exitCode).toBe(1);

      const everything = [...proc.raw, ...proc.stderr].join('\n');
      expect(everything).toContain('config violation persistence.schedule.maxDirtyMs');
      expect(proc.raw.some((line) => line.includes('"event":"config-error"'))).toBe(true);
      // 反向靶：绝不允许进程在排空窗中途被 watchdog exit(1) 击穿（该配置不再能 boot）。
      expect(everything).not.toContain('watchdog timeout');
    },
    60_000,
  );
});

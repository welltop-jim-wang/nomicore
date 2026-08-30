/**
 * `@nomicore/yjs-server` CLI（设计 §3.1/§3.4/§3.6/§3.7）。
 *
 *  - `--config <path>`（或 env `NOMICORE_CONFIG`）读入 JSON 配置 → §3.2 同一全量
 *    校验器（违规 → `config-error` + violations + exit 1）；
 *  - file persistence：启动先取 `<rootDir>/.nomicore-lock.json` 独占锁（共享活跃
 *    root loud 拒绝），干净停机/换装删除；
 *  - stdout NDJSON 生命周期事件面；stdin NDJSON 控制通道（每行恰一回执，进程绝不
 *    因控制输入退出）;
 *  - SIGTERM/SIGINT → 有序停机 exit 0；SIGHUP → 换装（§3.7：单飞、先验证后拆卸、
 *    运行期失败 loud exit(1)）；全程总超时保护。
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  ConfigValidationError,
  createNomicoreApp,
  parseAppConfig,
  type AppConfig,
  type NomicoreApp,
} from './index.ts';
import { acquireRootLock, createStdoutEventSink, type RootLockHandle } from './lifecycle.ts';

const STOP_WATCHDOG_MS = 60_000;

function resolveConfigPath(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length - 1; i += 1) {
    if (argv[i] === '--config') return argv[i + 1];
  }
  if (process.env.NOMICORE_CONFIG !== undefined && process.env.NOMICORE_CONFIG.length > 0) {
    return process.env.NOMICORE_CONFIG;
  }
  return undefined;
}

function readConfigRaw(configPath: string): unknown {
  return JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
}

interface CliState {
  sink: ReturnType<typeof createStdoutEventSink>;
  configPath: string;
  app: NomicoreApp;
  lock: RootLockHandle | undefined;
  shuttingDown: boolean;
  reloading: boolean;
}

function emitViolations(violations: readonly Readonly<{ path: string; reason: string }>[]): void {
  for (const violation of violations) {
    process.stderr.write(`config violation ${violation.path}: ${violation.reason}\n`);
  }
}

function failBoot(state: CliState, message: string, violations?: readonly Readonly<{ path: string; reason: string }>[]): never {
  process.stderr.write(`${message}\n`);
  if (violations !== undefined) emitViolations(violations);
  process.exit(1);
}

async function shutdown(state: CliState, exitCode: number): Promise<void> {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  const watchdog = setTimeout(() => {
    process.stderr.write('shutdown watchdog timeout: force exit(1)\n');
    process.exit(1);
  }, STOP_WATCHDOG_MS);
  watchdog.unref();
  try {
    await state.app.stop();
    state.lock?.release();
    process.exit(exitCode);
  } catch (error) {
    process.stderr.write(`shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

/** SIGHUP 换装（设计 §3.7）：单飞 → 先验证后拆卸 → 停旧（§3.6 全序）→ 装新（§3.4 启动序）。 */
async function reload(state: CliState): Promise<void> {
  if (state.reloading || state.shuttingDown) {
    state.sink({ event: 'reload-ignored' });
    return;
  }
  state.reloading = true;
  try {
    state.sink({ event: 'reload-starting' });
    // ① 先验证：任何破坏性动作之前完成（失败 → config-error，旧 ctx 继续运行）。
    let nextConfig: AppConfig;
    try {
      nextConfig = parseAppConfig(readConfigRaw(state.configPath));
    } catch (error) {
      const violations =
        error instanceof ConfigValidationError
          ? error.violations
          : [{ path: '$', reason: error instanceof Error ? error.message : String(error) }];
      state.sink({ event: 'config-error', violations });
      return; // 保持旧实例继续服务；下一次 SIGHUP 可再试。
    }
    // ② 停旧（含锁文件删除、端口释放、NDJSON 停机序）。
    await state.app.stop();
    state.lock?.release();
    // ③ 装新（锁先删后取；残留锁（pid 存活）→ loud exit(1)，绝不带锁强占）。
    if (nextConfig.persistence.kind === 'file') {
      try {
        state.lock = acquireRootLock(nextConfig.persistence.rootDir, nextConfig.instanceId);
      } catch (error) {
        failBoot(state, `reload cannot acquire root lock: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      state.app = createNomicoreApp(nextConfig, { emitter: state.sink });
      await state.app.ready;
    } catch (error) {
      failBoot(state, `reload failed after teardown (process supervisor restart advised): ${error instanceof Error ? error.message : String(error)}`);
    }
    state.sink({ event: 'reload-complete' });
  } finally {
    state.reloading = false;
  }
}

function attachControlChannel(state: CliState): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    void (async () => {
      try {
        const reply = await state.app.handleControlLine(line);
        if (reply === undefined) return; // 结构性不可达（每行恰一回执）
        state.sink(reply);
        if (reply.op === 'shutdown' && reply.ok === true) {
          await shutdown(state, 0);
        }
      } catch (error) {
        // 进程绝不因控制通道输入退出（设计 §3.4）。
        state.sink({ event: 'reply', ok: false, code: 'unknown-op', message: String(error) });
      }
    })();
  });
}

function main(): void {
  const configPath = resolveConfigPath(process.argv.slice(2));
  if (configPath === undefined) {
    process.stderr.write('usage: tsx src/main.ts --config <path> (or set NOMICORE_CONFIG)\n');
    process.exit(1);
  }
  const sink = createStdoutEventSink();
  let config: AppConfig;
  try {
    config = parseAppConfig(readConfigRaw(configPath));
  } catch (error) {
    const violations =
      error instanceof ConfigValidationError
        ? error.violations
        : [{ path: '$', reason: error instanceof Error ? error.message : String(error) }];
    sink({ event: 'config-error', violations });
    emitViolations(violations);
    process.exit(1);
  }
  sink({ event: 'config-loaded', role: config.role, instanceId: config.instanceId });

  let lock: RootLockHandle | undefined;
  if (config.persistence.kind === 'file') {
    try {
      lock = acquireRootLock(config.persistence.rootDir, config.instanceId);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }

  const state: CliState = {
    sink,
    configPath,
    app: createNomicoreApp(config, { emitter: sink }),
    lock,
    shuttingDown: false,
    reloading: false,
  };
  attachControlChannel(state);

  process.on('SIGTERM', () => void shutdown(state, 0));
  process.on('SIGINT', () => void shutdown(state, 0));
  process.on('SIGHUP', () => void reload(state));

  state.app.ready.catch((error) => {
    process.stderr.write(`boot failed: ${error instanceof Error ? error.message : String(error)}\n`);
    state.lock?.release();
    process.exit(1);
  });
}

main();

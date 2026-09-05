import { describe, expect, it, vi } from 'vitest';
import { runWithShutdownWatchdog } from '../src/shutdown-watchdog.js';

function never(): Promise<void> { return new Promise(() => {}); }

describe('production shutdown watchdog helper', () => {
  it('clears the watchdog after stop settles', async () => {
    const handle = { unref: vi.fn() };
    const clearTimeout = vi.fn();
    await runWithShutdownWatchdog(
      async () => {},
      60_000,
      {
        setTimeout: () => handle,
        clearTimeout,
        writeError: vi.fn(),
        exit: vi.fn((code: number): never => { throw new Error(`exit:${code}`); }),
      },
    );
    expect(handle.unref).toHaveBeenCalledOnce();
    expect(clearTimeout).toHaveBeenCalledWith(handle);
  });

  it('forces exit(1) when an accepted apply keeps stop pending', async () => {
    let fire!: () => void;
    const exit = vi.fn((code: number): never => { throw new Error(`exit:${code}`); });
    const writeError = vi.fn();
    void runWithShutdownWatchdog(
      () => never(),
      60_000,
      {
        setTimeout: (callback) => { fire = callback; return { unref() {} }; },
        clearTimeout: vi.fn(),
        writeError,
        exit,
      },
    );
    expect(() => fire()).toThrow('exit:1');
    expect(writeError).toHaveBeenCalledWith('shutdown watchdog timeout: force exit(1)\n');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

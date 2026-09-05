export interface ShutdownWatchdogPlatform {
  setTimeout(callback: () => void, delayMs: number): { unref(): void };
  clearTimeout(handle: { unref(): void }): void;
  writeError(message: string): void;
  exit(code: number): never;
}

export async function runWithShutdownWatchdog(
  stop: () => Promise<void>,
  timeoutMs: number,
  platform: ShutdownWatchdogPlatform,
): Promise<void> {
  const watchdog = platform.setTimeout(() => {
    platform.writeError('shutdown watchdog timeout: force exit(1)\n');
    platform.exit(1);
  }, timeoutMs);
  watchdog.unref();
  try {
    await stop();
  } finally {
    platform.clearTimeout(watchdog);
  }
}

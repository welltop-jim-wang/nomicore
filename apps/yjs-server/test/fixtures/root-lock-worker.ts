import { acquireRootLock } from '../../src/lifecycle.js';

const [rootDir, instanceId, holdMsText] = process.argv.slice(2);
if (rootDir === undefined || instanceId === undefined || holdMsText === undefined) {
  throw new Error('usage: root-lock-worker <rootDir> <instanceId> <holdMs>');
}

try {
  const handle = acquireRootLock(rootDir, instanceId);
  process.send?.({ type: 'acquired', instanceId });
  setTimeout(() => {
    handle.release();
    process.send?.({ type: 'released', instanceId });
    process.exit(0);
  }, Number(holdMsText));
} catch (error) {
  process.send?.({ type: 'rejected', instanceId, message: (error as Error).message });
  process.exit(2);
}

/**
 * issue #228 — SA7 动态验证（SA4「动态审核重点」第 7 项）：诊断 retirement 面
 * （AD-4）在真实文件系统上的迟到流量封堵证据。
 *
 * 钉住的裁决：
 * - 删除流程 retirement 之后，任何迟到 `runtimeEmitterFor(ns)` 一律返回
 *   `'namespace-deleted'` 丢弃桩（**先于** ensureAdapter——绝不对已删目录重建
 *   adapter/重新建流写 genesis）；迟到 emit 只产生计数事件
 *   `{event:'diagnostic-log-emission-dropped', reason:'namespace-deleted', namespaceId}`，
 *   日志目录树不被重建（ADR-0011 隔离：丢弃不改业务结果）。
 * - `initStream` 先 un-retire 再 ensureAdapter（O2）：同进程内以同 namespaceId
 *   重建（运维显式重建语义）时新 namespace 正常建流——retirement 不外溢。
 *
 * 黑盒纪律：真实 File adapter（真实 tmp 目录、真实文件产物），sink 为数组捕获；
 * 零 mock、零 skip。与 `diagnostic-replay-host-lifecycle-sa7.test.ts`（#226 轮
 * SA7）同款 import 面（app 自身 src 的公共工厂）。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createHostDiagnosticsManager } from '../src/diagnostics.js';

const NOW_MS = Date.parse('2026-09-07T00:00:00.000Z');
const NS = 'ns-deadbeefdeadbeefdeadbeefdeadbeef';

type SinkEvent = Record<string, unknown>;

const tempRootDirs = new Set<string>();
function freshRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRootDirs.add(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempRootDirs) rmSync(dir, { recursive: true, force: true });
});

let attemptCounter = 0;
function emissionFor(): {
  operation: 'root-mutation';
  stage: 'transaction';
  observedAt: string;
  attemptId: string;
  source: { kind: 'local' };
  result: { kind: 'committed'; effect: 'update'; updateBytes: Uint8Array };
} {
  attemptCounter += 1;
  const hex = attemptCounter.toString(16).padStart(32, '0').slice(0, 32);
  const doc = new Y.Doc();
  doc.getMap('ROOT').set('n', attemptCounter);
  return {
    operation: 'root-mutation',
    stage: 'transaction',
    observedAt: new Date(NOW_MS).toISOString(),
    attemptId: `att-${hex}`,
    source: { kind: 'local' },
    result: { kind: 'committed', effect: 'update', updateBytes: Y.encodeStateAsUpdate(doc) },
  };
}

function namespaceDirOf(rootDir: string): string {
  return join(rootDir, 'namespaces', NS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('issue #228 — SA7 动态验证：诊断 retirement 封堵 diag-pump 迟到重建（AD-4）', () => {
  it('迟到流量：建流→删除目录树→retire→runtimeEmitterFor 返回丢弃桩且 emit 只计数、目录树不被重建；initStream un-retire 后同 id 重建走全新流', async () => {
    const rootDir = freshRoot('sa7-228-retire-');
    const events: SinkEvent[] = [];
    const manager = createHostDiagnosticsManager(
      { enabled: true, rootDir, updateCapture: true, inputPolicy: 'digest' },
      { sink: (e) => void events.push(e), now: () => NOW_MS },
    );

    // 前置：正常建流（genesis 物化、locator 落盘）
    const genesis = new Y.Doc();
    genesis.getMap('ROOT').set('n', 1);
    manager.binding.initStream!(NS, Y.encodeStateAsUpdate(genesis));
    await expect
      .poll(() => existsSync(join(namespaceDirOf(rootDir), 'current.json')), { interval: 10, timeout: 5_000 })
      .toBe(true);
    expect(
      events.filter((e) => e.event === 'diagnostic-log-emission-dropped' && e.reason === 'namespace-deleted'),
      'retirement 前不得有 namespace-deleted 丢弃',
    ).toHaveLength(0);

    // 模拟删除工作流的落盘结局（deleteNamespaceDiagnosticLog 成功形态）：目录树消失
    rmSync(namespaceDirOf(rootDir), { recursive: true, force: true });
    expect(existsSync(namespaceDirOf(rootDir))).toBe(false);
    // 删除编排 ①（AD-3）：retirement 先行
    manager.retireNamespace(NS);

    // 迟到流量（diag-pump 在 close drain 后仍可投递的形态）：runtimeEmitterFor 必须命中
    // 丢弃桩（先于 ensureAdapter），emit 只计数、绝不重建目录
    const lateEmitter = manager.binding.runtimeEmitterFor!(NS);
    expect(lateEmitter, 'retired ns 必须解析到丢弃桩（非 undefined、非 adapter emitter）').toBeDefined();
    lateEmitter!.emit(emissionFor());
    const drops = events.filter(
      (e) => e.event === 'diagnostic-log-emission-dropped' && e.reason === 'namespace-deleted' && e.namespaceId === NS,
    );
    expect(drops, '迟到 emit 必须产生 namespace-deleted 计数事件').toHaveLength(1);

    // 让出若干 macrotask（若存在任何异步重建路径，此处会暴露）
    await sleep(100);
    expect(existsSync(namespaceDirOf(rootDir)), '已删目录树绝不被迟到流量重建').toBe(false);
    expect(
      events.filter((e) => e.event === 'diagnostic-log-manager-failed'),
      '迟到流量不得触发 manager 失败事件',
    ).toHaveLength(0);

    // un-retire（AD-4/O2）：同 id 重新 initStream = 运维显式重建语义 → 全新流正常建立
    manager.binding.initStream!(NS, Y.encodeStateAsUpdate(genesis));
    await expect
      .poll(() => existsSync(join(namespaceDirOf(rootDir), 'current.json')), { interval: 10, timeout: 5_000 })
      .toBe(true);
    const rebuiltEmitter = manager.binding.runtimeEmitterFor!(NS);
    expect(rebuiltEmitter, '重建后必须解析到真实 adapter emitter').toBeDefined();
    rebuiltEmitter!.emit(emissionFor());
    expect(
      events.filter((e) => e.event === 'diagnostic-log-emission-dropped' && e.reason === 'namespace-deleted'),
      'un-retire 后不得再产生 namespace-deleted 丢弃',
    ).toHaveLength(1);

    manager.close();
  }, 30_000);

  it('manager close 优先于 retirement：close 后迟到流量按 manager-closed 计数（既有语义零回归）', async () => {
    const rootDir = freshRoot('sa7-228-retire-close-');
    const events: SinkEvent[] = [];
    const manager = createHostDiagnosticsManager(
      { enabled: true, rootDir, updateCapture: true, inputPolicy: 'digest' },
      { sink: (e) => void events.push(e), now: () => NOW_MS },
    );
    manager.retireNamespace(NS);
    manager.close();
    const lateEmitter = manager.binding.runtimeEmitterFor!(NS);
    lateEmitter!.emit(emissionFor());
    const closedDrops = events.filter(
      (e) => e.event === 'diagnostic-log-emission-dropped' && e.reason === 'manager-closed' && e.namespaceId === NS,
    );
    expect(closedDrops, 'close 后迟到流量按 manager-closed 计数').toHaveLength(1);
    expect(existsSync(namespaceDirOf(rootDir)), 'close 后不得建任何目录').toBe(false);
  }, 30_000);
});

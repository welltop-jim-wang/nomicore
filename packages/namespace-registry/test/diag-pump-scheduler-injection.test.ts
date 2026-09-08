import { describe, expect, it } from 'vitest';
import { createDiagPump } from '../src/diag-pump.js';
import type { NamespaceDiagnosticChangeEmission } from '../../namespace-diagnostic-log/src/index.js';

const NS = 'ns-000000000000000000000000000000d1';

function emission(attemptId: string): NamespaceDiagnosticChangeEmission {
  return {
    operation: 'namespace-create',
    stage: 'transaction',
    observedAt: '2026-09-07T00:00:00.000Z',
    attemptId,
    source: { kind: 'local' },
    input: { status: 'not-accessed' },
    result: { kind: 'committed', effect: 'noop' },
  };
}

describe('diagnostic pump scheduler capability', () => {
  it('defers delivery through the injected macrotask scheduler', () => {
    const pending: Array<() => void> = [];
    const delivered: string[] = [];
    const pump = createDiagPump({
      defer: (callback) => {
        pending.push(callback);
      },
      initStream: () => undefined,
      resolveEmitter: () => ({
        emit: (item) => {
          delivered.push(item.attemptId ?? '?');
        },
      }),
    });

    pump.enqueueEmit(NS, emission('first'));
    pump.enqueueEmit(NS, emission('second'));

    expect(pending).toHaveLength(1);
    expect(delivered).toEqual([]);

    pending.shift()?.();

    expect(delivered).toEqual(['first', 'second']);
  });

  it('rolls back singleflight state when the injected scheduler rejects scheduling', () => {
    const pending: Array<() => void> = [];
    let schedulingAttempts = 0;
    const pump = createDiagPump({
      defer: (callback) => {
        schedulingAttempts += 1;
        if (schedulingAttempts === 1) throw new Error('scheduler unavailable');
        pending.push(callback);
      },
      initStream: () => undefined,
      resolveEmitter: () => ({ emit: () => undefined }),
    });

    expect(() => pump.enqueueEmit(NS, emission('first'))).not.toThrow();
    expect(() => pump.enqueueEmit(NS, emission('second'))).not.toThrow();

    expect(schedulingAttempts).toBe(2);
    expect(pending).toHaveLength(1);
  });
});

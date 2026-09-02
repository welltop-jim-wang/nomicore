import { describe, it } from 'vitest';
import type {
  NamespaceLease,
  NamespaceLeaseMutateDataResult,
  NamespaceLeaseReadDataResult,
  NamespaceLeaseSchema,
} from '@nomicore/namespace-registry';

// @ts-expect-error removed ROOT-oriented lease result
import type { NamespaceLeaseMutateRootResult } from '@nomicore/namespace-registry';
// @ts-expect-error removed ambiguous read result
import type { NamespaceLeaseReadResult } from '@nomicore/namespace-registry';
// @ts-expect-error removed envelope-oriented schema projection name
import type { NamespaceLeaseSchemaEnvelope } from '@nomicore/namespace-registry';

declare const lease: NamespaceLease;

describe('NamespaceLease exposes Data, Schema, and Metadata concepts', () => {
  it('uses readData/mutateData/getSchema and removes obsolete methods', () => {
    const read: NamespaceLeaseReadDataResult = lease.readData(['items', 'a', 'quantity']);
    const write: Promise<NamespaceLeaseMutateDataResult> = lease.mutateData({
      op: 'set',
      path: ['items', 'a', 'quantity'],
      value: 2,
    });
    const schema: NamespaceLeaseSchema = lease.getSchema();
    const metadata = lease.getMetadata();
    void read;
    void write;
    void schema;
    void metadata;

    // @ts-expect-error old ambiguous read interface removed
    lease.read(['items']);
    // @ts-expect-error ROOT carrier terminology removed from public lease
    lease.mutateRoot({ op: 'set', path: ['items'], value: {} });
    // @ts-expect-error envelope projection terminology removed from public lease
    lease.getSchemaEnvelope();
  });
});

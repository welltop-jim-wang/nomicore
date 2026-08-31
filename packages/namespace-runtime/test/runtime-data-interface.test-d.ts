import { describe, it } from 'vitest';
import type {
  DataMutationIssue,
  MutateDataResult,
  NamespaceRuntime,
  NamespaceRuntimeReadDataResult,
} from '@nomicore/namespace-runtime';

// Breaking public interface: ROOT carrier terminology does not cross the Runtime seam.
// @ts-expect-error removed public type
import type { RootMutationIssue } from '@nomicore/namespace-runtime';
// @ts-expect-error removed public type
import type { MutateRootResult } from '@nomicore/namespace-runtime';

declare const runtime: NamespaceRuntime;

describe('NamespaceRuntime exposes Data, Schema, and Metadata concepts', () => {
  it('uses readData/mutateData/getSchema and removes ROOT-oriented names', () => {
    const read: NamespaceRuntimeReadDataResult = runtime.readData(['items', 'a', 'quantity']);
    const write: Promise<MutateDataResult> = runtime.mutateData({
      op: 'set',
      path: ['items', 'a', 'quantity'],
      value: 2,
    });
    const schema = runtime.getSchema();
    const metadata = runtime.getMetadata();
    void read;
    void write;
    void schema;
    void metadata;

    // @ts-expect-error old ambiguous read interface removed
    runtime.read(['items']);
    // @ts-expect-error ROOT is an implementation carrier, not the public data interface
    runtime.mutateRoot({ op: 'set', path: ['items'], value: {} });
    // @ts-expect-error envelope is an implementation projection term
    runtime.getSchemaEnvelope();
  });

  it('exports Data-named mutation issue and result types', () => {
    const issue = null as unknown as DataMutationIssue;
    const result = null as unknown as MutateDataResult;
    void issue;
    void result;
  });
});

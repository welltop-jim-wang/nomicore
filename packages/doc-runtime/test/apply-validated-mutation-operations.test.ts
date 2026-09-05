import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';
import { applyValidatedMutation, materializeRoot } from '../src/index.js';

function derivedOf(text: string): DerivedSchema {
  const parsed = parseVfsl(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) throw new Error(JSON.stringify(evaluated.issues));
  return evaluated.derived;
}

function fixture(text: string, snapshot: unknown): { derived: DerivedSchema; doc: Y.Doc } {
  const derived = derivedOf(text);
  const doc = new Y.Doc();
  expect(materializeRoot(derived, snapshot, doc).ok).toBe(true);
  return { derived, doc };
}

function bytes(doc: Y.Doc): number[] {
  return [...Y.encodeStateAsUpdate(doc)];
}

function expectZeroWrite(fx: { derived: DerivedSchema; doc: Y.Doc }, mutation: unknown): void {
  const before = bytes(fx.doc);
  const result = applyValidatedMutation(fx.derived, fx.doc, mutation as never);
  expect(result.ok).toBe(false);
  expect(bytes(fx.doc)).toEqual(before);
}

describe('applyValidatedMutation incremental carrier contract', () => {
  it('small nested set preserves unrelated carriers and emits a small owned update', () => {
    const large = 'x'.repeat(700_000);
    const fx = fixture(
      'type ROOT = { large: string; nested: { value: number }; values: YArray<number> };',
      { large, nested: { value: 1 }, values: [1, 2, 3] },
    );
    const root = fx.doc.getMap('ROOT');
    const nested = root.get('nested');
    const values = root.get('values');
    const updates: Uint8Array[] = [];
    fx.doc.on('update', (update) => updates.push(update));

    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'set', path: ['nested', 'value'], value: 2 }).ok).toBe(true);

    expect(root.get('nested')).toBe(nested);
    expect(root.get('values')).toBe(values);
    expect(root.get('large')).toBe(large);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.byteLength).toBeLessThan(1_000);
  });

  it('array mutations preserve the target Y.Array and scale with the changed slice', () => {
    const initial = Array.from({ length: 100_000 }, (_, index) => index);
    const fx = fixture('type ROOT = { values: YArray<number>; sibling: { stable: string } };', {
      values: initial,
      sibling: { stable: 'yes' },
    });
    const root = fx.doc.getMap('ROOT');
    const values = root.get('values') as Y.Array<unknown>;
    const sibling = root.get('sibling');
    const updates: Uint8Array[] = [];
    fx.doc.on('update', (update) => updates.push(update));

    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'array-insert', path: ['values'], index: 50_000, values: [-1] }).ok).toBe(true);
    expect(root.get('values')).toBe(values);
    expect(root.get('sibling')).toBe(sibling);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.byteLength).toBeLessThan(1_000);

    updates.length = 0;
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'array-delete', path: ['values'], index: 50_000, count: 1 }).ok).toBe(true);
    expect(root.get('values')).toBe(values);
    expect(root.get('sibling')).toBe(sibling);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.byteLength).toBeLessThan(1_000);
  });

  it('navigates the current member of same-carrier unions and refs', () => {
    const fx = fixture(
      'type Choice = { kind: "a"; a: number } | { kind: "b"; b: number }; type ROOT = { choice: Choice };',
      { choice: { kind: 'b', b: 1 } },
    );
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'set', path: ['choice', 'b'], value: 2 }).ok).toBe(true);
    expect((fx.doc.getMap('ROOT').get('choice') as Y.Map<unknown>).toJSON()).toEqual({ kind: 'b', b: 2 });
  });

  it('replaces a union subtree when set switches members', () => {
    const fx = fixture(
      'type Choice = { kind: "a"; a: number } | { kind: "b"; b: number }; type ROOT = { choice: Choice };',
      { choice: { kind: 'a', a: 1 } },
    );
    const before = fx.doc.getMap('ROOT').get('choice');
    expect(applyValidatedMutation(fx.derived, fx.doc, {
      op: 'set', path: ['choice'], value: { kind: 'b', b: 2 },
    }).ok).toBe(true);
    const after = fx.doc.getMap('ROOT').get('choice');
    expect(after).not.toBe(before);
    expect((after as Y.Map<unknown>).toJSON()).toEqual({ kind: 'b', b: 2 });
  });

  it('treats YPlainArray as a terminal carrier', () => {
    const fx = fixture('type ROOT = { plain: YPlainArray<number>; sync: YArray<number> };', {
      plain: [1, 2], sync: [1, 2],
    });
    expectZeroWrite(fx, { op: 'array-insert', path: ['plain'], index: 1, values: [9] });
    expect(applyValidatedMutation(fx.derived, fx.doc, {
      op: 'set', path: ['plain'], value: [1, 9, 2],
    }).ok).toBe(true);
    expect(fx.doc.getMap('ROOT').get('plain')).toEqual([1, 9, 2]);
  });

  it('each incremental operation commits through exactly one Yjs transaction', () => {
    const fx = fixture('type ROOT = { optional?: number; values: YArray<number> };', {
      optional: 1, values: [1, 2],
    });
    let transactions = 0;
    fx.doc.on('afterTransaction', (transaction) => {
      if (transaction.local && transaction.changed.size > 0) transactions += 1;
    });
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'set', path: ['optional'], value: 2 }).ok).toBe(true);
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'delete', path: ['optional'] }).ok).toBe(true);
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'array-insert', path: ['values'], index: 2, values: [3] }).ok).toBe(true);
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'array-delete', path: ['values'], index: 2, count: 1 }).ok).toBe(true);
    expect(transactions).toBe(4);
  });

  it('validation failure emits no update', () => {
    const fx = fixture('type ROOT = { value: number; required: string };', { value: 1, required: 'yes' });
    let updates = 0;
    fx.doc.on('update', () => updates += 1);
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'set', path: ['value'], value: 'bad' }).ok).toBe(false);
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'delete', path: ['required'] }).ok).toBe(false);
    expect(updates).toBe(0);
  });
});

describe('applyValidatedMutation four-operation contract', () => {
  it('delete only accepts optional fields and Record dynamic keys', () => {
    const optional = fixture('type ROOT = { required: string; optional?: string };', { required: 'r', optional: 'o' });
    expect(applyValidatedMutation(optional.derived, optional.doc, { op: 'delete', path: ['optional'] }).ok).toBe(true);
    expect(optional.doc.getMap('ROOT').has('optional')).toBe(false);

    const record = fixture('type ROOT = { entries: Record<string, number> };', { entries: { a: 1, b: 2 } });
    expect(applyValidatedMutation(record.derived, record.doc, { op: 'delete', path: ['entries', 'a'] }).ok).toBe(true);
    expect((record.doc.getMap('ROOT').get('entries') as Y.Map<unknown>).has('a')).toBe(false);
  });

  it('delete rejects ROOT, required fields, and array indices with zero writes', () => {
    expectZeroWrite(fixture('type ROOT = { required: string };', { required: 'r' }), { op: 'delete', path: [] });
    expectZeroWrite(fixture('type ROOT = { required: string };', { required: 'r' }), { op: 'delete', path: ['required'] });
    expectZeroWrite(fixture('type ROOT = { values: YArray<number> };', { values: [1, 2] }), { op: 'delete', path: ['values', 0] });
  });

  it('array-insert inserts non-empty JSON values at strict boundaries', () => {
    const fx = fixture('type ROOT = { values: YArray<number> };', { values: [1, 3] });
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'array-insert', path: ['values'], index: 1, values: [2] }).ok).toBe(true);
    expect((fx.doc.getMap('ROOT').get('values') as Y.Array<unknown>).toArray()).toEqual([1, 2, 3]);
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'array-insert', path: ['values'], index: 3, values: [4] }).ok).toBe(true);
    expect((fx.doc.getMap('ROOT').get('values') as Y.Array<unknown>).toArray()).toEqual([1, 2, 3, 4]);
  });

  it.each([
    { op: 'array-insert', path: ['values'], index: -1, values: [9] },
    { op: 'array-insert', path: ['values'], index: 1.5, values: [9] },
    { op: 'array-insert', path: ['values'], index: 3, values: [9] },
    { op: 'array-insert', path: ['values'], index: 0, values: [] },
  ])('array-insert rejects invalid boundary %# with zero writes', (mutation) => {
    expectZeroWrite(fixture('type ROOT = { values: YArray<number> };', { values: [1, 2] }), mutation);
  });

  it('array-delete removes a positive in-bounds count', () => {
    const fx = fixture('type ROOT = { values: YArray<number> };', { values: [1, 2, 3, 4] });
    expect(applyValidatedMutation(fx.derived, fx.doc, { op: 'array-delete', path: ['values'], index: 1, count: 2 }).ok).toBe(true);
    expect((fx.doc.getMap('ROOT').get('values') as Y.Array<unknown>).toArray()).toEqual([1, 4]);
  });

  it.each([
    { op: 'array-delete', path: ['values'], index: -1, count: 1 },
    { op: 'array-delete', path: ['values'], index: 0.5, count: 1 },
    { op: 'array-delete', path: ['values'], index: 0, count: 0 },
    { op: 'array-delete', path: ['values'], index: 0, count: 1.5 },
    { op: 'array-delete', path: ['values'], index: 2, count: 1 },
    { op: 'array-delete', path: ['values'], index: 1, count: 2 },
  ])('array-delete rejects invalid/no-op boundary %# with zero writes', (mutation) => {
    expectZeroWrite(fixture('type ROOT = { values: YArray<number> };', { values: [1, 2] }), mutation);
  });
});

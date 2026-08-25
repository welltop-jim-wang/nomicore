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

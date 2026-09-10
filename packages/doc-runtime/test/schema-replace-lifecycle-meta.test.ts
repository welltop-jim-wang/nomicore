/**
 * issue #282 / ADR-0017 — @nomicore/doc-runtime `replaceSchemaAndRoot` 组合 seam 的
 * schema 生命周期元数据（META.schema.updatedAt）契约测试。
 *
 * 锚定契约：
 * - 同一事务：SCHEMA 四键 + META.schema.updatedAt（+ 可选 ROOT）恰一个事务原子提交；
 * - 载体纪律：既有嵌套 Y.Map 原实例复用（身份保持）；缺席（legacy）/异型原值（损坏）
 *   → 修复性安装全新 Y.Map；META 载体异型 → ok:false 零写入；
 * - 输入守卫：schemaUpdatedAt 非空 string，违者 ok:false 单 issue path=[] 零写入；
 * - 写后核验：observer 在事务 cleanup 窗口篡改 META.schema → post-commit-verification
 *   committed:true fatal（不回滚、不补偿）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { compileSchemaEnvelope } from '@nomicore/vfsl';
import type { DerivedSchema, SchemaEnvelope } from '@nomicore/vfsl';
import { DocRuntimeFatalError, replaceSchemaAndRoot } from '../src/index.js';

const TEXT_V1 = 'type ROOT = { n: number; a: string; };\n';
const ENV1: SchemaEnvelope = Object.freeze({ lang: 'vfsl', version: 1, id: 'seam-ns-1', text: TEXT_V1 });
const TEXT_V2 = 'type ROOT = { n: number; a: string; b?: boolean; };\n';
const ENV2: SchemaEnvelope = Object.freeze({ lang: 'vfsl', version: 1, id: 'seam-ns-2', text: TEXT_V2 });
const T0_ISO = '2023-11-14T22:15:23.456Z';
const T1_ISO = '2024-01-02T03:04:05.678Z';

function compiled(envelope: SchemaEnvelope): { envelope: SchemaEnvelope; derived: DerivedSchema } {
  const c = compileSchemaEnvelope(envelope);
  if (!c.ok) throw new Error(`fixture 前置编译失败：${JSON.stringify(c.issues)}`);
  return c;
}

/** 种子文档（SCHEMA 四键 + META docId/createdAt[+schema] + ROOT；schemaLifecycle 控制载体形态）。 */
function seedDoc(schemaLifecycle: 'genesis' | 'legacy' | 'corrupt' = 'genesis'): Y.Doc {
  const doc = new Y.Doc();
  const sc = doc.getMap('SCHEMA');
  sc.set('lang', ENV1.lang);
  sc.set('version', ENV1.version);
  sc.set('id', ENV1.id);
  sc.set('text', ENV1.text);
  const meta = doc.getMap('META');
  meta.set('docId', 'seam-ns-1');
  meta.set('createdAt', T0_ISO);
  if (schemaLifecycle === 'genesis') {
    const schemaMeta = new Y.Map<unknown>();
    schemaMeta.set('updatedAt', T0_ISO);
    meta.set('schema', schemaMeta);
  } else if (schemaLifecycle === 'corrupt') {
    meta.set('schema', 'not-a-map');
  }
  doc.getMap('ROOT').set('n', 1);
  doc.getMap('ROOT').set('a', 'x');
  return doc;
}

describe('issue #282：replaceSchemaAndRoot × META.schema.updatedAt', () => {
  it('keep-root：SCHEMA 四键 + META.schema.updatedAt 恰一事务提交；既有嵌套 Y.Map 原实例复用', () => {
    const doc = seedDoc('genesis');
    const existingSchemaMeta = doc.getMap('META').get('schema');
    const c = compiled(ENV2);
    let txCount = 0;
    doc.on('afterTransaction', () => {
      txCount += 1;
    });
    const result = replaceSchemaAndRoot(doc, {
      envelope: c.envelope,
      derived: c.derived,
      root: { kind: 'keep-root' },
      schemaUpdatedAt: T1_ISO,
    });
    expect(result).toEqual({ ok: true });
    expect(txCount).toBe(1); // 单事务原子提交
    expect(doc.getMap('SCHEMA').get('id')).toBe('seam-ns-2');
    const schemaMeta = doc.getMap('META').get('schema');
    expect(schemaMeta).toBe(existingSchemaMeta); // 载体身份保持（原实例复用）
    expect((schemaMeta as Y.Map<unknown>).get('updatedAt')).toBe(T1_ISO);
    // ROOT 零修改
    expect(doc.getMap('ROOT').get('n')).toBe(1);
  });

  it('replace-root：SCHEMA + ROOT + META.schema.updatedAt 同事务提交', () => {
    const doc = seedDoc('genesis');
    const c = compiled(ENV2);
    let txCount = 0;
    doc.on('afterTransaction', () => {
      txCount += 1;
    });
    const result = replaceSchemaAndRoot(doc, {
      envelope: c.envelope,
      derived: c.derived,
      root: { kind: 'replace-root', snapshot: { n: 1, a: 'x', b: true } },
      schemaUpdatedAt: T1_ISO,
    });
    expect(result).toEqual({ ok: true });
    expect(txCount).toBe(1);
    expect(doc.getMap('ROOT').get('b')).toBe(true);
    expect((doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt')).toBe(T1_ISO);
  });

  it('legacy 文档（无 META.schema）→ 修复性安装全新嵌套 Y.Map', () => {
    const doc = seedDoc('legacy');
    const c = compiled(ENV2);
    const result = replaceSchemaAndRoot(doc, {
      envelope: c.envelope,
      derived: c.derived,
      root: { kind: 'keep-root' },
      schemaUpdatedAt: T1_ISO,
    });
    expect(result).toEqual({ ok: true });
    const schemaMeta = doc.getMap('META').get('schema');
    expect(schemaMeta).toBeInstanceOf(Y.Map);
    expect((schemaMeta as Y.Map<unknown>).get('updatedAt')).toBe(T1_ISO);
  });

  it('损坏原值（schema 键非 Y.Map）→ 修复性替换为全新 Y.Map', () => {
    const doc = seedDoc('corrupt');
    const c = compiled(ENV2);
    const result = replaceSchemaAndRoot(doc, {
      envelope: c.envelope,
      derived: c.derived,
      root: { kind: 'keep-root' },
      schemaUpdatedAt: T1_ISO,
    });
    expect(result).toEqual({ ok: true });
    const schemaMeta = doc.getMap('META').get('schema');
    expect(schemaMeta).toBeInstanceOf(Y.Map);
    expect((schemaMeta as Y.Map<unknown>).get('updatedAt')).toBe(T1_ISO);
  });

  it('schemaUpdatedAt 形状违规（空串/非 string/undefined）→ ok:false 单 issue path=[]，零写入', () => {
    for (const bad of ['', 42, undefined] as const) {
      const doc = seedDoc('genesis');
      const c = compiled(ENV2);
      let txCount = 0;
      doc.on('afterTransaction', () => {
        txCount += 1;
      });
      const result = replaceSchemaAndRoot(doc, {
        envelope: c.envelope,
        derived: c.derived,
        root: { kind: 'keep-root' },
        schemaUpdatedAt: bad as unknown as string,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.length).toBe(1);
        expect(result.issues[0]?.path).toEqual([]);
      }
      expect(txCount).toBe(0); // 零写入
      expect(doc.getMap('SCHEMA').get('id')).toBe('seam-ns-1');
      expect((doc.getMap('META').get('schema') as Y.Map<unknown>).get('updatedAt')).toBe(T0_ISO);
    }
  });

  it('META 载体异型（同名 Y.Text）→ ok:false 零写入', () => {
    const doc = new Y.Doc();
    doc.getText('META').insert(0, 'corrupt');
    const sc = doc.getMap('SCHEMA');
    sc.set('lang', ENV1.lang);
    sc.set('version', ENV1.version);
    sc.set('id', ENV1.id);
    sc.set('text', ENV1.text);
    doc.getMap('ROOT').set('n', 1);
    doc.getMap('ROOT').set('a', 'x');
    const c = compiled(ENV2);
    const result = replaceSchemaAndRoot(doc, {
      envelope: c.envelope,
      derived: c.derived,
      root: { kind: 'keep-root' },
      schemaUpdatedAt: T1_ISO,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBe(1);
      expect(String((result.issues[0] as { message: string }).message)).toContain('META 载体不是 Y.Map');
    }
    expect(doc.getMap('SCHEMA').get('id')).toBe('seam-ns-1'); // 零写入
  });

  it('observer 事务 cleanup 窗口篡改 META.schema.updatedAt → post-commit-verification committed:true', () => {
    const doc = seedDoc('genesis');
    const c = compiled(ENV2);
    let tampered = false; // 一次性篡改（沿 installDocProbe 先例——重复篡改会无限递归新事务）
    doc.on('afterTransaction', () => {
      if (tampered) return;
      tampered = true;
      (doc.getMap('META').get('schema') as Y.Map<unknown>).set('updatedAt', 'evil');
    });
    let thrown: unknown;
    try {
      replaceSchemaAndRoot(doc, {
        envelope: c.envelope,
        derived: c.derived,
        root: { kind: 'keep-root' },
        schemaUpdatedAt: T1_ISO,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DocRuntimeFatalError);
    if (thrown instanceof DocRuntimeFatalError) {
      expect(thrown.phase).toBe('post-commit-verification');
      expect(thrown.committed).toBe(true);
    }
  });

  it('observer 事务 cleanup 窗口替换 META.schema 载体为非 Y.Map → post-commit-verification committed:true', () => {
    const doc = seedDoc('genesis');
    const c = compiled(ENV2);
    let tampered = false; // 一次性篡改
    doc.on('afterTransaction', () => {
      if (tampered) return;
      tampered = true;
      doc.getMap('META').set('schema', 'evil');
    });
    let thrown: unknown;
    try {
      replaceSchemaAndRoot(doc, {
        envelope: c.envelope,
        derived: c.derived,
        root: { kind: 'keep-root' },
        schemaUpdatedAt: T1_ISO,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DocRuntimeFatalError);
    if (thrown instanceof DocRuntimeFatalError) {
      expect(thrown.phase).toBe('post-commit-verification');
      expect(thrown.committed).toBe(true);
    }
  });
});

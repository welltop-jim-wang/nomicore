/**
 * SA6 红灯锚定 — issue #111：@nomicore/doc-runtime 公共组合 seam
 * `createInitialDocument`（设计 §6/§9 R2-H1 三分支 + 成功面 + observer 篡改面）。
 *
 * 规范权威：ADR-0009（create 域）+ ADR-0007（ROOT 载体域）；设计记录（历史证据，非规范）：
 * wiki/raw/task_namespace-registry-create_design.md（冻结，R3 PASS）
 * - §6：公共签名
 *   createInitialDocument({ envelope, derived, meta: { docId, createdAt }, root }):
 *     | { ok:true; doc:Y.Doc }
 *     | { ok:false; kind:'input-invalid'; issues: readonly unknown[] }
 *     | { ok:false; kind:'root-invalid'; issues: readonly unknown[] }
 *   自持 new Y.Doc()；input-invalid = 直接调用方领域失败面（envelope own 键恰
 *   {lang,version,id,text} 且四值型正确、META docId 非空 string / createdAt string）；
 *   手造 derived → DerivedInvariantError → DocRuntimeFatalError('pre-commit-internal',
 *   false)；root-invalid 原样透传 validateLogicalSnapshot/buildTopEntries issues；
 *   单 transaction（transactGuarded）；fresh-map 空置断言；SCHEMA/META/ROOT 三组
 *   写后核验（observer 篡改 → committed:true fatal）。
 * - §9 seam 行：seam 直调三分支；fresh-map 空置；afterTransaction=1；observer 篡改。
 *
 * 红灯说明：基线 doc-runtime 主入口无 createInitialDocument → 本文件经命名空间
 * any-bridge 取用（值不存在 → typeof 断言失败/调用于运行期 TypeError 抛错，全部
 * 用例红——断言失败形态，非框架超时）；SA3 实现并导出后全部转绿。本文件不预设
 * 实现内部结构（不读源码、不 grep 文本形状），全部断言锚定可观测输出。
 *
 * 观测手法（设计 §9「先安装 observer 后调用 seam」）：seam 自持 doc，测试无法在
 * 事务前拿到 doc 引用——按 §6「三者以 getMap 惰性取得」的冻结机制，经
 * Y.Doc.prototype.getMap 包装器在首次探针时注册 afterTransaction（计数器/篡改器）
 * 并记录 fresh-map 空置；每次安装后 restore（零 real sleep、零跨用例污染）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { compileSchemaEnvelope, validateLogicalSnapshot } from '@nomicore/vfsl';
import type { DerivedSchema, SchemaEnvelope } from '@nomicore/vfsl';
import {
  DocRuntimeFatalError,
  extractYjsSnapshot,
  readLogicalValueAtPath,
} from '../src/index.js';
import * as docRuntime from '../src/index.js';

// ── seam 类型（设计 §6 冻结签名的测试侧表达）────────────────────────────────

interface CreateInitialDocumentInput {
  envelope: unknown;
  derived: unknown;
  meta: { docId: string; createdAt: string };
  root: unknown;
}

type CreateInitialDocumentResult =
  | { ok: true; doc: Y.Doc }
  | { ok: false; kind: 'input-invalid' | 'root-invalid'; issues: readonly unknown[] };

/** any-bridge：基线无该导出（undefined）；SA3 实现后即真实 seam 函数。 */
const createInitialDocument = (docRuntime as Record<string, unknown>).createInitialDocument as
  | ((input: CreateInitialDocumentInput) => CreateInitialDocumentResult)
  | undefined;

// ── fixture ────────────────────────────────────────────────────────────────────

const ENVELOPE: SchemaEnvelope = Object.freeze({
  lang: 'vfsl',
  version: 1,
  id: 'seam-ns-1',
  text: 'type ROOT = { n: number; };\n',
});

const DOC_ID = 'seam-ns-1';
const CREATED_AT = '2023-11-14T22:15:23.456Z';
const ROOT = Object.freeze({ n: 42 });

function compiledDerived(): DerivedSchema {
  const c = compileSchemaEnvelope(ENVELOPE);
  if (!c.ok) throw new Error(`fixture 前置 compileSchemaEnvelope 失败：${JSON.stringify(c.issues)}`);
  return c.derived;
}

/** 手造非 root 派生物（R2-H1：derived.structure.kind !== 'root' 必须 fail-loud）。 */
function handCraftedDerived(): DerivedSchema {
  const real = compiledDerived();
  return {
    ...real,
    structure: { kind: 'map', fields: [] }, // 手造：类型上仍满足 DerivedSchema（any 桥接）
  } as DerivedSchema;
}

function input(overrides: Partial<CreateInitialDocumentInput> = {}): CreateInitialDocumentInput {
  return {
    envelope: ENVELOPE,
    derived: compiledDerived(),
    meta: { docId: DOC_ID, createdAt: CREATED_AT },
    root: ROOT,
    ...overrides,
  };
}

// ── Yjs 观测 instrument（§9 seam 行：fresh-map 空置 + afterTransaction 计数 + 篡改）──
//
// per-doc 锚定（总控 R-fix 裁决 7）：afterTransaction 计数按 doc 单个登记
// （WeakMap），`probe.txCount` 只锚定**目标 doc**（首个经 SCHEMA/META/ROOT 探针的
// doc——即安装事务发生的 fresh doc）。seam 写后校验若经共享 verifySnapshotIntact
// 在 scratch doc 上做对称重物化，其事务计入 scratch 自身条目、不影响目标锚——
// 目标安装事务恰 1 的锚在「镜像无 scratch」与「复用共享 verify（有 scratch）」两种
// 实现下都成立。tamper one-shot 只对目标 doc 的首次 afterTransaction 触发。

interface DocProbe {
  /** 目标 doc（首个探针）的 afterTransaction 计数——安装事务恰 1 锚。 */
  txCount: number;
  schemaSizeAtProbe: number;
  metaSizeAtProbe: number;
  rootSizeAtProbe: number;
  tamper: null | ((doc: Y.Doc) => void);
}

function installDocProbe(): { probe: DocProbe; restore: () => void } {
  const probe: DocProbe = {
    txCount: 0,
    schemaSizeAtProbe: -1,
    metaSizeAtProbe: -1,
    rootSizeAtProbe: -1,
    tamper: null,
  };
  const counts = new WeakMap<Y.Doc, number>();
  let targetDoc: Y.Doc | undefined;
  const seen = new WeakSet<Y.Doc>();
  const originalGetMap = Y.Doc.prototype.getMap;
  Y.Doc.prototype.getMap = (function getMapProbe(this: Y.Doc, name: string) {
    const map = originalGetMap.call(this, name);
    if (name === 'SCHEMA' || name === 'META' || name === 'ROOT') {
      const slot =
        name === 'SCHEMA'
          ? ('schemaSizeAtProbe' as const)
          : name === 'META'
            ? ('metaSizeAtProbe' as const)
            : ('rootSizeAtProbe' as const);
      if (probe[slot] === -1 && map.size === 0) {
        probe[slot] = map.size;
      }
      if (!seen.has(this)) {
        seen.add(this);
        if (targetDoc === undefined) {
          targetDoc = this; // 目标 doc = 首个被探针的 fresh doc（安装事务宿主）
        }
        this.on('afterTransaction', () => {
          const next = (counts.get(this) ?? 0) + 1;
          counts.set(this, next);
          if (this === targetDoc) {
            probe.txCount = next; // 只锚定目标 doc 的计数（scratch 事务不入目标条目）
            if (probe.tamper !== null) {
              probe.tamper(this);
              probe.tamper = null; // one-shot：防嵌套事务无限递归
            }
          }
        });
      }
    }
    return map;
  }) as unknown as typeof Y.Doc.prototype.getMap;
  return {
    probe,
    restore() {
      Y.Doc.prototype.getMap = originalGetMap;
    },
  };
}

let activeRestore: (() => void) | null = null;

afterEach(() => {
  activeRestore?.();
  activeRestore = null;
});

/** 断言运行时值面：SEAM 存在性（红锚：基线 import 面无该导出）。 */
describe('createInitialDocument 三分支红灯（§6/§9 R2-H1）', () => {
  it('公共入口存在 createInitialDocument 且为函数（值导出）', () => {
    expect(Object.prototype.hasOwnProperty.call(docRuntime, 'createInitialDocument')).toBe(true);
    expect(typeof createInitialDocument).toBe('function');
  });

  it('畸形 envelope（缺 text / 多键）→ {ok:false, kind:\'input-invalid\', issues[path:[]]} 且零 doc 出站', () => {
    expect(createInitialDocument).toBeTypeOf('function'); // 前置：值面存在
    const fn = createInitialDocument as (i: CreateInitialDocumentInput) => CreateInitialDocumentResult;
    const missingText = input({ envelope: { lang: 'vfsl', version: 1, id: 'x' } });
    const extraKey = input({ envelope: { ...ENVELOPE, extra: 1 } });
    for (const [name, i] of [
      ['missing text', missingText],
      ['extra key', extraKey],
    ] as const) {
      const result = fn(i);
      expect(result.ok, `${name} → input-invalid`).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('input-invalid');
        expect(result.issues.length).toBe(1);
        const issue = result.issues[0] as { path?: unknown };
        expect(issue.path).toEqual([]); // 单 issue path=[]
        expect('doc' in result).toBe(false); // 零 doc 出站
      }
    }
  });

  it('畸形 META（空 docId / 非 string createdAt / 非 string docId）→ input-invalid 单 issue path=[]，零 doc 出站', () => {
    const fn = createInitialDocument as (i: CreateInitialDocumentInput) => CreateInitialDocumentResult;
    const cases: Array<[string, { docId: string; createdAt: string }]> = [
      ['empty docId', { docId: '', createdAt: CREATED_AT }],
      ['non-string createdAt', { docId: DOC_ID, createdAt: 123 as unknown as string }],
      ['non-string docId', { docId: 42 as unknown as string, createdAt: CREATED_AT }],
    ];
    for (const [name, meta] of cases) {
      const result = fn(input({ meta }));
      expect(result.ok, `${name} → input-invalid`).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('input-invalid');
        expect(result.issues.length).toBe(1);
        expect((result.issues[0] as { path?: unknown }).path).toEqual([]);
        expect('doc' in result).toBe(false);
      }
    }
  });

  it('手造 derived（structure.kind !== root）→ DocRuntimeFatalError pre-commit-internal committed:false', () => {
    const fn = createInitialDocument as (i: CreateInitialDocumentInput) => CreateInitialDocumentResult;
    let thrown: unknown;
    try {
      fn(input({ derived: handCraftedDerived() }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DocRuntimeFatalError);
    if (thrown instanceof DocRuntimeFatalError) {
      expect(thrown.phase).toBe('pre-commit-internal');
      expect(thrown.committed).toBe(false);
      expect(thrown.cause).toBeInstanceOf(Error);
    }
  });

  it('ROOT validate 失败 → {ok:false, kind:\'root-invalid\', issues 与直接 validateLogicalSnapshot 深等}，零 doc 出站', () => {
    const fn = createInitialDocument as (i: CreateInitialDocumentInput) => CreateInitialDocumentResult;
    const derived = compiledDerived();
    const direct = validateLogicalSnapshot(derived, { n: 'x' });
    if (direct.ok) throw new Error('fixture 前置 validateLogicalSnapshot 应失败');
    const result = fn(input({ root: { n: 'x' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('root-invalid');
      expect(result.issues).toEqual(direct.issues); // verbatim 深等（message/path/数量/顺序）
      expect('doc' in result).toBe(false);
    }
  });
});

describe('createInitialDocument 成功面（§6/§9：单事务、SCHEMA/META/ROOT 内容与空置、读回）', () => {
  it('成功：恰一 transaction、fresh-map 空置、SCHEMA 四键/META 二键/ROOT 完整、verify 后读回', () => {
    const fn = createInitialDocument as (i: CreateInitialDocumentInput) => CreateInitialDocumentResult;
    const { probe, restore } = installDocProbe();
    activeRestore = restore;
    const result = fn(input());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const doc = result.doc;
    expect(doc).toBeInstanceOf(Y.Doc);

    // fresh-map 空置（§6：三 map 首次安装前 size===0）
    expect(probe.schemaSizeAtProbe).toBe(0);
    expect(probe.metaSizeAtProbe).toBe(0);
    expect(probe.rootSizeAtProbe).toBe(0);
    // 单 transaction（§9：先安装 observer 后调用 seam，计数恰 1）
    expect(probe.txCount).toBe(1);

    // SCHEMA 严格四键（§6 单事务 clear+set）
    const schemaMap = doc.getMap('SCHEMA');
    expect(schemaMap.size).toBe(4);
    expect([...schemaMap.keys()].sort()).toEqual(['id', 'lang', 'text', 'version']);
    expect(schemaMap.get('lang')).toBe('vfsl');
    expect(schemaMap.get('version')).toBe(1);
    expect(schemaMap.get('id')).toBe('seam-ns-1');
    expect(schemaMap.get('text')).toBe(ENVELOPE.text);
    // META 严格二键
    const metaMap = doc.getMap('META');
    expect(metaMap.size).toBe(2);
    expect([...metaMap.keys()].sort()).toEqual(['createdAt', 'docId']);
    expect(metaMap.get('docId')).toBe(DOC_ID);
    expect(metaMap.get('createdAt')).toBe(CREATED_AT);
    // ROOT 完整内容
    const rootMap = doc.getMap('ROOT');
    expect(rootMap.get('n')).toBe(42);

    // verify 后读回：公共只读接口（readLogicalValueAtPath 与 extractYjsSnapshot）
    expect(readLogicalValueAtPath(doc, ['n'])).toEqual({ ok: true, value: 42 });
    const extract = extractYjsSnapshot(compiledDerived(), doc);
    expect(extract.ok).toBe(true);
    if (extract.ok) {
      expect(extract.snapshot).toEqual({ n: 42 });
    }
  });
});

describe('createInitialDocument observer 篡改面（§6/§9：SCHEMA/META/ROOT 破坏 → committed:true fatal）', () => {
  it('afterTransaction 内改 SCHEMA 多一键 → DocRuntimeFatalError post-commit-verification committed:true', () => {
    const fn = createInitialDocument as (i: CreateInitialDocumentInput) => CreateInitialDocumentResult;
    const { probe, restore } = installDocProbe();
    activeRestore = restore;
    probe.tamper = (doc) => {
      doc.getMap('SCHEMA').set('evil', 1);
    };
    let thrown: unknown;
    try {
      fn(input());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DocRuntimeFatalError);
    if (thrown instanceof DocRuntimeFatalError) {
      expect(thrown.phase).toBe('post-commit-verification');
      expect(thrown.committed).toBe(true);
    }
  });

  it('afterTransaction 内改 META 多一键 → DocRuntimeFatalError post-commit-verification committed:true', () => {
    const fn = createInitialDocument as (i: CreateInitialDocumentInput) => CreateInitialDocumentResult;
    const { probe, restore } = installDocProbe();
    activeRestore = restore;
    probe.tamper = (doc) => {
      doc.getMap('META').set('evil', 1);
    };
    let thrown: unknown;
    try {
      fn(input());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DocRuntimeFatalError);
    if (thrown instanceof DocRuntimeFatalError) {
      expect(thrown.phase).toBe('post-commit-verification');
      expect(thrown.committed).toBe(true);
    }
  });

  it('afterTransaction 内改 ROOT 多一键 → DocRuntimeFatalError post-commit-verification committed:true', () => {
    const fn = createInitialDocument as (i: CreateInitialDocumentInput) => CreateInitialDocumentResult;
    const { probe, restore } = installDocProbe();
    activeRestore = restore;
    probe.tamper = (doc) => {
      doc.getMap('ROOT').set('evil', 1);
    };
    let thrown: unknown;
    try {
      fn(input());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DocRuntimeFatalError);
    if (thrown instanceof DocRuntimeFatalError) {
      expect(thrown.phase).toBe('post-commit-verification');
      expect(thrown.committed).toBe(true);
    }
  });
});

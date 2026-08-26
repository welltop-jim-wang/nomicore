/**
 * @nomicore/doc-runtime —— 初始文档组合 seam（issue #111 设计 §6 DQ-2 / §9）：
 * `createInitialDocument(input)` —— Registry 私有 create-document 的公共构造步。
 *
 * 职责边界（冻结）：doc-runtime 负责全部 Yjs 机械——自持 `new Y.Doc()`（Registry
 * 永不获得失败时的 partial doc）、prepare（envelope/META 形状、derived 不变量、
 * 原样封闭校验、detached 构造）、fresh-map 空置断言、**恰一个** transactGuarded
 * 事务（SCHEMA 严格四键 + META 严格二键 + ROOT clear+安装）、三组写后核验
 * （verifySchemaFourKeys / verifyMetaTwoKeys / verifyInstall / verifySnapshotIntact
 * 镜像——复用/镜像既有 install-verify 机械，不复制构造规则）。Registry 负责 schema
 * 编译、createdAt 生成、结果映射、Persistence 与 Runtime。
 *
 * 三分支结局（R2-H1 定稿）：
 * - **input-invalid**：doc-runtime 直接调用方的领域失败面——envelope 非 own 键恰
 *   {lang,version,id,text} 且四值型正确，或 META 的 `docId` 非非空 string /
 *   `createdAt` 非 string → 返回单 issue `path:[]`，零 doc 出站；
 * - **root-invalid**：`validateLogicalSnapshot` / `buildTopEntries` 失败 → 原样
 *   verbatim 透传完整 issues（message/path/数量/顺序不改），零 doc 出站；
 * - 手造 `derived.structure.kind !== 'root'` → `DerivedInvariantError` 收编
 *   `DocRuntimeFatalError('pre-commit-internal', false)`（E204 纪律：绝不伪装为
 *   input issue——沿 replaceSchemaAndRoot 的两级信任边界）。
 *
 * fatal phase 严格以现行 fatal.ts 三相为准：prepare/空置异常 =
 * pre-commit-internal,false；transactGuarded observer cleanup 逃逸 =
 * observer-cleanup-throw,true；写后四类 verify 偏离 = post-commit-verification,true。
 *
 * 实现注（§9 观测锚定）：三 map 以 `doc.getMap` 惰性取得（fresh doc 结构性缺席；
 * 不复制 replace seam 的多载体 probe——异型分支对 fresh doc 不可达）；安装事务前
 * 显式断言三 map size===0（偏离 = pre-commit-internal fatal）。⑥ 写后校验直接复用
 * install-verify 的共享 `verifySnapshotIntact`（与 verifyInstall 同模块同源——总控
 * R-fix 裁决：不保留镜像比较器）：其 scratch-仲裁（extract(real) ≡ extract(scratch)，
 * scratch = 同一输入同一管线在一次性 doc 上的未修改安装）对初始安装同样成立——目标
 * doc 即该管线的唯一安装；scratch 重放事务经 per-doc 观测锚定归入 scratch 自身条目，
 * 目标 doc 的 afterTransaction 恰 1 锚保持。
 */
import * as Y from 'yjs';
import type { DerivedSchema, SchemaEnvelope, StructureNode } from '@nomicore/vfsl';
import { validateLogicalSnapshot } from '@nomicore/vfsl';
import { buildTopEntries } from './detached-build.js';
import { DerivedInvariantError, DocRuntimeFatalError, transactGuarded } from './fatal.js';
import { verifyInstall, verifySnapshotIntact } from './install-verify.js';

/** seam 输入（§6 冻结；envelope/derived 必须来自同一 compile 产物——深冻结五件套）。 */
export interface CreateInitialDocumentInput {
  readonly envelope: SchemaEnvelope;
  readonly derived: DerivedSchema;
  readonly meta: { readonly docId: string; readonly createdAt: string };
  readonly root: unknown;
}

/** seam 结果（§6/§9 R2-H1 三分支）：成功仅携带自持 doc；领域失败零 doc 出站。 */
export type CreateInitialDocumentResult =
  | { readonly ok: true; readonly doc: Y.Doc }
  | {
      readonly ok: false;
      readonly kind: 'input-invalid' | 'root-invalid';
      readonly issues: readonly unknown[];
    };

/** 领域 issue 形状（只读 path 渲染用，不承载 yjs 类型）。 */
interface SeamIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** prepare 结局（单事务所需载荷齐备 → ready；领域失败 → fail 零写入）。 */
type PreparedInitial =
  | {
      kind: 'ready';
      doc: Y.Doc;
      schemaMap: Y.Map<unknown>;
      metaMap: Y.Map<unknown>;
      rootMap: Y.Map<unknown>;
      entries: Array<[string, unknown]>;
      snapshot: unknown;
    }
  | { kind: 'fail'; issueKind: 'input-invalid' | 'root-invalid'; issues: readonly unknown[] };

/**
 * **初始文档唯一组合 seam**：同步完结；可预期失败经返回值传递（领域三分支），
 * internal 不变量破坏经 DocRuntimeFatalError（三相如实）。
 *
 * @throws `pre-commit-internal,false`（手造 derived / fresh-map 空置偏离，零写入）/
 *   `observer-cleanup-throw,true`（transactGuarded observer 逃逸，已提交）/
 *   `post-commit-verification,true`（写后四类 verify 偏离，已提交）。
 */
export function createInitialDocument(input: CreateInitialDocumentInput): CreateInitialDocumentResult {
  const prepared = prepareInitial(input);
  if (prepared.kind === 'fail') {
    return { ok: false, kind: prepared.issueKind, issues: prepared.issues };
  }

  // ② 单事务原子提交（transactGuarded 物理位于一切 catch 之外——observer/引擎异常
  //    唯一抛源 → 无条件包装 observer-cleanup-throw committed:true）。事务体只含对
  //    已验证载荷的 clear + set 循环（引擎级操作，不可能使 yjs 抛错）。
  const { doc, schemaMap, metaMap, rootMap, entries } = prepared;
  transactGuarded(doc, () => {
    schemaMap.clear(); // 【原实例】clear（安装后 identity 保持——Y.Map 同实例）
    schemaMap.set('lang', input.envelope.lang);
    schemaMap.set('version', input.envelope.version);
    schemaMap.set('id', input.envelope.id);
    schemaMap.set('text', input.envelope.text);
    metaMap.clear();
    metaMap.set('docId', input.meta.docId);
    metaMap.set('createdAt', input.meta.createdAt);
    rootMap.clear();
    for (const [key, value] of entries) rootMap.set(key, value);
  });

  verifySchemaFourKeys(schemaMap, input.envelope);
  verifyMetaTwoKeys(metaMap, input.meta);
  verifyInstall({ rootMap, entries });
  // ④ ⑥：共享 verifySnapshotIntact（同模块同源——install-verify 的 scratch-仲裁：
  //    compare = extract(real) ≡ extract(scratch)，scratch = 同一输入同一管线在一次性
  //    doc 上的未修改安装；数据侧以 per-doc 观测锚定，scratch 重放事务计入 scratch
  //    自身条目，目标 doc 的 afterTransaction 恰 1 锚保持——SA6 R-fix 总控裁决 2）。
  verifySnapshotIntact(input.derived, prepared.snapshot, doc);

  return { ok: true, doc };
}

/** ① prepare（唯一 try/catch 崩溃边界——两级 fatal 制，沿 replaceSchemaAndRoot E204/E206
 *  纪律）。领域失败全部返回 fail（零写入）；DerivedInvariantError 与其余意外异常进入
 *  pre-commit-internal,false（手造派生物 = 合规调用者不可达；未知异常保守视为 internal）。 */
function prepareInitial(input: CreateInitialDocumentInput): PreparedInitial {
  try {
    // ①a envelope 形状守卫（直接调用方领域面：own 键集恰四 + 四值型）
    const envelopeIssue = envelopeShapeIssue(input.envelope);
    if (envelopeIssue !== null) {
      return { kind: 'fail', issueKind: 'input-invalid', issues: [envelopeIssue] };
    }
    // ①b META 形状守卫（docId 非空 string / createdAt string）
    const metaIssue = metaShapeIssue(input.meta);
    if (metaIssue !== null) {
      return { kind: 'fail', issueKind: 'input-invalid', issues: [metaIssue] };
    }
    // ①c derived 不变量（手造派生物 loud 收编 → pre-commit-internal,false）
    if (input.derived.structure.kind !== 'root') {
      throw new DerivedInvariantError('derived.structure 非 root（手造派生物）');
    }
    // ①d 原样封闭校验（verbatim issues）+ detached 构造（Registry 不直调本函数）
    const logical = validateLogicalSnapshot(input.derived, input.root);
    if (!logical.ok) {
      return { kind: 'fail', issueKind: 'root-invalid', issues: logical.issues };
    }
    const top = buildTopEntries(input.derived, input.root);
    if (top.kind === 'issue') {
      return { kind: 'fail', issueKind: 'root-invalid', issues: [top.issue] };
    }
    // ①e prepare 成功后才自持 new Y.Doc()；fresh doc 的 SCHEMA/META/ROOT 结构性缺席，
    //    三者以 getMap 惰性取得；显式断言首次安装前 size===0（偏离 = pre-commit-internal）。
    const doc = new Y.Doc();
    const schemaMap = doc.getMap('SCHEMA');
    const metaMap = doc.getMap('META');
    const rootMap = doc.getMap('ROOT');
    if (schemaMap.size !== 0 || metaMap.size !== 0 || rootMap.size !== 0) {
      throw new DocRuntimeFatalError(
        'pre-commit-internal',
        false,
        'DOCRT-E204: 初始文档 SCHEMA/META/ROOT 非空置（fresh doc 不变量破坏，疑似未来 hook/重构走私既有内容）——本调用零写入',
      );
    }
    return {
      kind: 'ready',
      doc,
      schemaMap,
      metaMap,
      rootMap,
      entries: top.entries,
      snapshot: input.root,
    };
  } catch (err) {
    if (err instanceof DerivedInvariantError) {
      throw new DocRuntimeFatalError(
        'pre-commit-internal',
        false,
        `DOCRT-E204: 写前 internal 不变量破坏（${err.message}）——合规调用者不可达；本调用零写入`,
        { cause: err },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new DocRuntimeFatalError(
      'pre-commit-internal',
      false,
      `DOCRT-E206: createInitialDocument 写前未知内部异常（意外抛出）：「${detail}」——按 internal fatal 分级；唯一事务尚未开始，确定零写入`,
      { cause: err },
    );
  }
}

/** ①a envelope 形状守卫（own 键集恰 {lang,version,id,text} + 四值型）。违者恰 1 issue path=[]。 */
function envelopeShapeIssue(envelope: unknown): SeamIssue | null {
  if (typeof envelope !== 'object' || envelope === null) {
    return {
      message:
        'SCHEMA 信封形状违规：期望普通对象（own 键集恰 {lang, version, id, text} 且值型正确）——无法构造初始文档',
      path: [],
    };
  }
  const e = envelope as Record<string, unknown>;
  const keys = Object.keys(e);
  const keysOk =
    keys.length === 4 &&
    Object.prototype.hasOwnProperty.call(e, 'lang') &&
    Object.prototype.hasOwnProperty.call(e, 'version') &&
    Object.prototype.hasOwnProperty.call(e, 'id') &&
    Object.prototype.hasOwnProperty.call(e, 'text');
  const valuesOk =
    typeof e.lang === 'string' &&
    typeof e.version === 'number' &&
    typeof e.id === 'string' &&
    typeof e.text === 'string';
  if (!keysOk || !valuesOk) {
    return {
      message:
        'SCHEMA 信封形状违规：own 键集与四值型必须恰为 {lang: string, version: number, id: string, text: string}——无法构造初始文档',
      path: [],
    };
  }
  return null;
}

/** ①b META 形状守卫（docId 非空 string / createdAt string）。违者恰 1 issue path=[]。 */
function metaShapeIssue(meta: { readonly docId: string; readonly createdAt: string }): SeamIssue | null {
  const m = meta as unknown as Record<string, unknown>;
  if (typeof m.docId !== 'string' || m.docId.length === 0) {
    return { message: 'META 形状违规：docId 必须为非空 string——无法构造初始文档', path: [] };
  }
  if (typeof m.createdAt !== 'string') {
    return { message: 'META 形状违规：createdAt 必须为 string——无法构造初始文档', path: [] };
  }
  return null;
}

/**
 * ③-1 ⑤-S：SCHEMA 写后顶层完整性校验（镜像 schema-replace 的 verifySchemaFourKeys；
 * size===4 + 四键值与 envelope 严格同一，双断言缺一不可）。偏离 → throw
 * post-commit-verification,true（写入已提交，不回滚、不补偿）。
 */
function verifySchemaFourKeys(schemaMap: Y.Map<unknown>, envelope: SchemaEnvelope): void {
  if (schemaMap.size !== 4) {
    throw new DocRuntimeFatalError(
      'post-commit-verification',
      true,
      `DOCRT-E201: SCHEMA 顶层安装完整性偏离：期望 4 个键，事务提交后实际 ${schemaMap.size} 个` +
        `（实际键集：${JSON.stringify([...schemaMap.keys()])}）——疑似 observer 同步重入修改 SCHEMA；` +
        `写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
    );
  }
  const expected: ReadonlyArray<[string, unknown]> = [
    ['lang', envelope.lang],
    ['version', envelope.version],
    ['id', envelope.id],
    ['text', envelope.text],
  ];
  for (const [key, value] of expected) {
    if (schemaMap.get(key) !== value) {
      throw new DocRuntimeFatalError(
        'post-commit-verification',
        true,
        `DOCRT-E201: SCHEMA 顶层安装完整性偏离：键 "${key}" 的值在事务提交后与安装值不同一——` +
          `疑似 observer 覆写或删除后重插异值；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
      );
    }
  }
}

/** ③-2 ⑤-M：META 写后顶层完整性校验（size===2 + docId/createdAt 严格同一；对称补齐
 * verifySchemaFourKeys 的诚实性）。偏离 → throw post-commit-verification,true。 */
function verifyMetaTwoKeys(
  metaMap: Y.Map<unknown>,
  meta: { readonly docId: string; readonly createdAt: string },
): void {
  if (metaMap.size !== 2) {
    throw new DocRuntimeFatalError(
      'post-commit-verification',
      true,
      `DOCRT-E201: META 顶层安装完整性偏离：期望 2 个键，事务提交后实际 ${metaMap.size} 个` +
        `（实际键集：${JSON.stringify([...metaMap.keys()])}）——疑似 observer 同步重入修改 META；` +
        `写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
    );
  }
  const expected: ReadonlyArray<[string, unknown]> = [
    ['docId', meta.docId],
    ['createdAt', meta.createdAt],
  ];
  for (const [key, value] of expected) {
    if (metaMap.get(key) !== value) {
      throw new DocRuntimeFatalError(
        'post-commit-verification',
        true,
        `DOCRT-E201: META 顶层安装完整性偏离：键 "${key}" 的值在事务提交后与安装值不同一——` +
          `疑似 observer 覆写或删除后重插异值；写入已提交，不回滚、不补偿，doc 保持 observer 留下的实际状态`,
      );
    }
  }
}

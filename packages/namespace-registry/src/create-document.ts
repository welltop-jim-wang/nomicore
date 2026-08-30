/**
 * @nomicore/namespace-registry —— 私有 create-document 编排（issue #111 设计 §6 DQ-2；
 * phase-5 切片 1 §4.5 拆分：prepare + build 两段）。
 *
 * 职责边界（冻结）：本模块负责 schema 编译与 ROOT 原样封闭校验（verbatim issue
 * 透传——DQ-4 裁决）；Yjs 构造/单事务安装/写后核验全部委托 doc-runtime 公共组合
 * seam `createInitialDocument`（自持编辑器文档实例，Registry 永不获得失败时的 partial
 * doc）。Registry 不直调 buildTopEntries（设计 §6）；本模块以 registry 相对内部
 * 模块调用 doc-runtime public entry——主入口可达声明图不含编辑器文档类型名文本（doc 载荷以
 * any-bridge 停留运行期，#110 §8 same discipline）。
 *
 * 拆分（§4.5，D-8）：`prepareCreateDocument`（compile + 封闭校验，**一次/create**，
 * ID 无关——跨重试候选复用）与 `buildInitialDocument`（构造步，**一次/候选**：
 * META.docId = 候选 namespaceId；testing seam 按候选调用）。原单入口 `createDocument`
 * 删除（唯一调用方 registry.ts 同步迁移；无测试直接 import 本模块）。
 *
 * 任何 throw（seam internal fatal 或注入 factory throw）原样向上传播——registry.ts
 * 在 slot catch 中保留 DocRuntimeFatalError.committed 原值（create-document-internal/
 * <原 committed>，§7），未知异常按 committed:false。
 */
import { compileSchemaEnvelope, validateLogicalSnapshot } from '@nomicore/vfsl';
import type { DerivedSchema, SchemaEnvelope } from '@nomicore/vfsl';
import { createInitialDocument } from '@nomicore/doc-runtime';

/** create-document 领域失败 kind（§6 三面：schema 编译 / ROOT 校验构造 / 不可达 input）。 */
export type CreateDocumentIssueKind = 'schema-invalid' | 'root-invalid' | 'input-invalid';

/**
 * Registry 私有 create-document 结果（§6 冻结）：成功仅携带 doc（any-bridge——
 * 编辑器文档实例只停留运行期，主入口可达声明图不得出现编辑器文档类型名文本）；领域失败携带
 * verbatim 完整 issues（readonly unknown[]，DQ-4：不深克隆/改写/sanitize）。
 */
export type CreateDocumentGatewayResult =
  | { readonly ok: true; readonly doc: any }
  | {
      readonly ok: false;
      readonly kind: CreateDocumentIssueKind;
      readonly issues: readonly unknown[];
    };

/**
 * 构造工厂形状（testing 注入面经 testing.ts 暴露 4 参形态；内部调用额外携带已编译
 * 五件套供默认 seam 直接消费——注入工厂忽略多余参数即可，JS 语义安全）。
 */
export type CreateDocumentFactory = (
  namespaceId: string,
  createdAt: string,
  schema: unknown,
  root: unknown,
  compiled?: { readonly envelope: SchemaEnvelope; readonly derived: DerivedSchema },
) => CreateDocumentGatewayResult;

/** 默认构造工厂：compile → 封闭校验 → doc-runtime 公共 seam（自持 doc，零 partial 出站）。 */
const defaultDocumentFactory: CreateDocumentFactory = (
  namespaceId,
  createdAt,
  _schema,
  _root,
  compiled,
) => {
  if (compiled === undefined) {
    // 只在被单独调用（无预编译上下文）时自行编译——正常槽路径总是携带预编译产物。
    const c = compileSchemaEnvelope(_schema);
    if (!c.ok) return { ok: false, kind: 'schema-invalid', issues: c.issues };
    const logical = validateLogicalSnapshot(c.derived, _root);
    if (!logical.ok) return { ok: false, kind: 'root-invalid', issues: logical.issues };
    return createInitialDocument({
      envelope: c.envelope,
      derived: c.derived,
      meta: { docId: namespaceId, createdAt },
      root: _root,
    });
  }
  return createInitialDocument({
    envelope: compiled.envelope,
    derived: compiled.derived,
    meta: { docId: namespaceId, createdAt },
    root: _root,
  });
};

/** compile + 封闭校验的共享产物（深冻结五件套；跨重试候选复用——ID 无关）。 */
export interface PreparedDocumentBundle {
  readonly envelope: SchemaEnvelope;
  readonly derived: DerivedSchema;
}

export type PrepareCreateDocumentResult =
  | { readonly ok: true; readonly bundle: PreparedDocumentBundle }
  | {
      readonly ok: false;
      readonly kind: 'schema-invalid' | 'root-invalid';
      readonly issues: readonly unknown[];
    };

/**
 * compile + 封闭校验（§4.5；一次/create，ID 无关）。compile/validate 本身是结果联合、
 * 零 throw——失败面属 Registry 私有层，verbatim issues 完整透传。
 */
export function prepareCreateDocument(
  schema: unknown,
  root: unknown,
): PrepareCreateDocumentResult {
  const compiled = compileSchemaEnvelope(schema);
  if (!compiled.ok) {
    return { ok: false, kind: 'schema-invalid', issues: compiled.issues };
  }
  const logical = validateLogicalSnapshot(compiled.derived, root);
  if (!logical.ok) {
    return { ok: false, kind: 'root-invalid', issues: logical.issues };
  }
  return { ok: true, bundle: { envelope: compiled.envelope, derived: compiled.derived } };
}

/**
 * 构造步（§4.5；一次/候选）：META.docId = 候选 namespaceId；testing 注入 factory
 * 完全替代构造步（seam 的 input-invalid 在 Registry 路径结构性不可达）。默认经
 * doc-runtime `createInitialDocument`（envelope/derived 来自 prepare 的同一编译产物
 * ——五件套深冻结、共享引用）。
 */
export function buildInitialDocument(
  factory: CreateDocumentFactory | undefined,
  namespaceId: string,
  createdAt: string,
  schema: unknown,
  root: unknown,
  bundle: PreparedDocumentBundle,
): CreateDocumentGatewayResult {
  const build = factory ?? defaultDocumentFactory;
  return build(namespaceId, createdAt, schema, root, {
    envelope: bundle.envelope,
    derived: bundle.derived,
  });
}

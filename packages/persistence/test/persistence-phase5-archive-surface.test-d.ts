/**
 * SA6 红灯锚定（类型面）— issue #133（Phase 5: bootstrap import, archive, and
 * guarded replica reset）AC-2/AC-3/AC-5：Persistence 公共面的归档 seam 与受控
 * 复制导入 seam 类型契约（运行时行为锚见 persistence-phase5-archive-red.test.ts /
 * persistence-phase5-import-red.test.ts）。
 *
 * 锚定机制（vitest --typecheck 下红/绿翻转）：
 * - 【红（R-2 回流——设计 D-4）】`ReplicaPersistence`（required 派生接口）必须
 *   暴露 phase 文档冻结名的 `archiveDoc(owner, docId, expectedReplicationIdentity)`
 *   （AC-3：受身份前置条件保护的归档 seam）。基线上：`ReplicaPersistence` 尚不
 *   存在 → import 报 TS2305（模块无此导出；错误位置 = 本文件锚位）+ 条件类型
 *   求值 never → `true` 赋值 TS2322 → 红；SA3 新增该类型并实现 → 绿。为何不锚
 *   `DocPersistence`：设计 D-4 把复制能力建模为 optional 成员（13 个既有 stub +
 *   三成员绿守卫 + wrapIo 字面量零回归），`T extends {archiveDoc: F}` 对 optional
 *   成员不可赋值——required 保证面在派生接口上，锚指派生接口（语义更强）。
 * - 【红】`ReplicaPersistence` 必须暴露受控复制导入 seam（临时契约名 `importDoc`，
 *   待 SA1 冻结——行为锚：排他创建永久副本、duplicate 稳定分类、永不覆盖/合并）
 *   → 当前类型面无 → 红。
 * - 【绿（保持性守卫）】`DocPersistence` 不暴露未受身份守卫的通用删除/枚举/移动
 *   面（removeDoc/deleteDoc/listDocs/enumerateDocs/moveDoc——ADR 0006 排他纪律
 *   与 ADR 0010「Persistence 不增加跨 owner catalog」）→ 现契约已满足，防回潮。
 * - 【绿（保持性守卫）】既有 createDoc/loadDoc/saveDoc 公共面与 DOC_DUPLICATE
 *   稳定错误族不变（导入/归档必须复用而非替换既有排他与错误纪律；optional 成员
 *   下三成员字面量仍合法——零改动）。
 *
 * 临时形状声明：`expectedReplicationIdentity` 的参数形状
 * `{ replicationId: string; replicationEpoch: number }` 为测试侧结构声明
 * （N-1 待 SA1 定义映射）；成功返回形状 `Promise<{ok:true}>` 亦为临时
 * （测试锚行为而非返回值——归档语义经 loadDoc/恢复面观测）。
 */
import { describe, it } from 'vitest';
import type * as Y from 'yjs';
import type { DocHandle, DocPersistence, ReplicaPersistence, User } from '@nomicore/persistence';

/** 复制身份引用（临时形状，N-1 待 SA1 冻结）。 */
type ReplicationIdentityRef = Readonly<{ replicationId: string; replicationEpoch: number }>;

type HasArchiveDoc<T> = T extends {
  readonly archiveDoc: (
    owner: User,
    docId: string,
    expectedReplicationIdentity: ReplicationIdentityRef,
  ) => Promise<Readonly<{ ok: true }>>;
}
  ? true
  : never;

type HasImportDoc<T> = T extends {
  readonly importDoc: (owner: User, docId: string, doc: Y.Doc) => Promise<DocHandle>;
}
  ? true
  : never;

type HasUnguardedStoreFace<T> = T extends
  | { readonly removeDoc: unknown }
  | { readonly deleteDoc: unknown }
  | { readonly listDocs: unknown }
  | { readonly enumerateDocs: unknown }
  | { readonly moveDoc: unknown }
  ? true
  : false;

describe('类型面：ReplicaPersistence 归档 seam（AC-3/AC-5，phase 文档冻结名 archiveDoc；R-2 回流——设计 D-4：DocPersistence 新成员为 optional、required 保证面由派生接口 ReplicaPersistence 表达，锚指派生接口）', () => {
  it('ReplicaPersistence 暴露 archiveDoc(owner, docId, expectedReplicationIdentity)', () => {
    const anchored: HasArchiveDoc<ReplicaPersistence> = true;
    void anchored;
  });

  it('ReplicaPersistence 暴露受控复制导入 seam importDoc(owner, docId, doc)（临时名，待 SA1 冻结）', () => {
    const anchored: HasImportDoc<ReplicaPersistence> = true;
    void anchored;
  });
});

describe('类型面：Persistence 无未受身份守卫的删除/枚举旁路（AC-2/AC-5 保持性守卫）', () => {
  it('DocPersistence 无 removeDoc/deleteDoc/listDocs/enumerateDocs/moveDoc 成员', () => {
    const guarded: HasUnguardedStoreFace<DocPersistence> extends true ? never : true = true;
    void guarded;
  });

  it('DocPersistence 既有三主方法 createDoc/loadDoc/saveDoc 面不变（排他与错误族复用纪律）', () => {
    const persistence: DocPersistence = {
      createDoc: (owner: User, docId: string, doc: Y.Doc) => Promise.resolve({
        owner, docId,
        doc,
        getStatus: () => 'ready' as const,
        release: () => Promise.resolve(),
      }),
      loadDoc: () => Promise.resolve(null),
      saveDoc: () => Promise.resolve(),
    };
    expectTypeOfSurface(persistence);
  });
});

function expectTypeOfSurface(_persistence: DocPersistence): void {
  // 仅是守卫编译面的形状断言载体（运行期零断言）。
}

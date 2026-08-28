/**
 * SA6 红灯锚定（类型面）— issue #133（Phase 5: bootstrap import, archive, and
 * guarded replica reset）AC-1/AC-2/AC-4：NamespaceRegistry 的 resetReplica 编排
 * 面与内部受信任 bootstrap 导入面的类型契约（运行时行为锚见
 * registry-phase5-bootstrap-reset-red.test.ts）。
 *
 * 锚定机制（vitest --typecheck 下红/绿翻转）：
 * - 【红】`NamespaceRegistry` 必须暴露 phase 文档 §实施切片 8 冻结名的
 *   `resetReplica(owner, namespaceId, expectedLocalIdentity)`（AC-4：编排
 *   close→archive→允许 bootstrap）→ 当前类型面无该方法 → 条件类型求值 never →
 *   `true` 赋值 TS2322 → 红；SA3 落位 → 绿。
 * - 【红】`NamespaceRegistry` 必须暴露内部受信任 bootstrap 导入面
 *   `importReplica(owner, namespaceId, doc)`（临时契约名，待 SA1 冻结——ADR
 *   0010 只称「内部受信任导入/受控复制导入能力」；行为锚：保留 Hub
 *   namespaceId、detached 完整 update 应用、META 复制身份核对先于 persistence
 *   ownership 转移、排他不覆盖不合并）→ 当前类型面无 → 红。
 * - 【绿（保持性守卫）】`NamespaceRegistry` 不暴露通用按 key 管理/删除面
 *   （removeNamespace/deleteNamespace/evict/closeNamespace/forceClose——
 *   ADR 0009 v1 公共面纪律 0009:114：不公开按 key close 或公共 list/entry
 *   status；resetReplica 是 ADR 0010 授权的新编排入口，不是通用管理面）；
 *   普通 create 仍不接受调用方 namespaceId（#131 冻结
 *   `NAMESPACE_CREATE_INVALID_INPUT` 四键输入拒绝——CreateNamespaceInput 恒
 *   三键）→ 现契约已满足。
 *
 * 临时形状声明：`expectedLocalIdentity` 参数形状
 * `{ replicationId; replicationEpoch }` 为测试侧结构声明（N-1 待 SA1 定义
 * expectedLocalIdentity / expectedReplicationIdentity 的映射与核对时点）；
 * 结果联合的字段集（{ok:true} / {ok:false;code;message}）仿 open/create 窄
 * 结果先例——SA1 若另行冻结结果形状，本锚只需保持 `ok` 判别面即可。
 */
import { describe, it } from 'vitest';
import type * as Y from 'yjs';
import type {
  CreateNamespaceInput,
  NamespaceLease,
  NamespaceOwner,
  NamespaceRegistry,
} from '@nomicore/namespace-registry';

/** 本地复制身份引用（临时形状，N-1 待 SA1 冻结）。 */
type ReplicationIdentityRef = Readonly<{ replicationId: string; replicationEpoch: number }>;

type HasResetReplica<T> = T extends {
  readonly resetReplica: (
    owner: NamespaceOwner,
    namespaceId: string,
    expectedLocalIdentity: ReplicationIdentityRef,
  ) => Promise<Readonly<{ ok: boolean }>>;
}
  ? true
  : never;

type HasImportReplica<T> = T extends {
  readonly importReplica: (
    owner: NamespaceOwner,
    namespaceId: string,
    doc: Y.Doc,
    expectedReplicationIdentity: ReplicationIdentityRef,
  ) => Promise<Readonly<{ ok: true; lease: NamespaceLease }> | Readonly<{ ok: false; code: string }>>;
}
  ? true
  : never;

type HasGenericKeyManagement<T> = T extends
  | { readonly removeNamespace: unknown }
  | { readonly deleteNamespace: unknown }
  | { readonly evictNamespace: unknown }
  | { readonly closeNamespace: unknown }
  | { readonly forceCloseNamespace: unknown }
  | { readonly listNamespaces: unknown }
  ? true
  : false;

/** 普通 create 恒三键输入（#131 冻结：不带 namespaceId——调用方指定即拒）。 */
type CreateInputIsThreeKeyed = CreateNamespaceInput extends {
  readonly owner: unknown;
  readonly schema: unknown;
  readonly root: unknown;
}
  ? keyof CreateNamespaceInput extends 'owner' | 'schema' | 'root'
    ? true
    : never
  : never;

describe('类型面：NamespaceRegistry resetReplica / importReplica（AC-1/AC-2/AC-4）', () => {
  it('NamespaceRegistry 暴露 resetReplica(owner, namespaceId, expectedLocalIdentity)（phase 文档冻结名）', () => {
    const anchored: HasResetReplica<NamespaceRegistry> = true;
    void anchored;
  });

  it('NamespaceRegistry 暴露内部受信任 bootstrap 导入 importReplica(owner, namespaceId, doc, expectedReplicationIdentity)（round-2 演进：第 4 参数 = Hub 广告身份，与 r2 surface 锚一致）', () => {
    const anchored: HasImportReplica<NamespaceRegistry> = true;
    void anchored;
  });
});

describe('类型面：Registry 无通用按 key 管理/删除面（AC-4 保持性守卫，ADR 0009 v1 公共面纪律）', () => {
  it('NamespaceRegistry 无 removeNamespace/deleteNamespace/evict/closeNamespace/forceClose/listNamespaces 成员', () => {
    const guarded: HasGenericKeyManagement<NamespaceRegistry> extends true ? never : true = true;
    void guarded;
  });

  it('普通 create 输入恒三键（namespaceId 仅经注入受控 CSPRNG 生成——导入路径不改变 create 接纳）', () => {
    const threeKeyed: CreateInputIsThreeKeyed = true;
    void threeKeyed;
  });
});

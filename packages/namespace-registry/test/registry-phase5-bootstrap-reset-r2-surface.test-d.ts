/**
 * SA6 红灯锚定（类型面，round=2）— issue #133（Phase 5: bootstrap import,
 * archive, and guarded replica reset）R2-AC-3：NamespaceRegistry.importReplica
 * 必须接收（或以等价类型面可靠绑定）Hub 广告的 expected `{replicationId,
 * replicationEpoch}` 身份（运行时行为锚见
 * registry-phase5-bootstrap-reset-r2-red.test.ts）。
 *
 * 锚定机制（vitest --typecheck / tsc -p tsconfig.typecheck.json 下红/绿翻转）：
 * - 【红】`importReplica` 的第 4 参数（ReplicationIdentityRef 形状）当前不存在：
 *   `Parameters<NamespaceRegistry['importReplica']>` 求值为 3 元组
 *   `[NamespaceOwner, string, YjsDoc]`——**不** extends 4 元组
 *   `[NamespaceOwner, string, YjsDoc, ReplicationIdentityRef]` → 条件类型求值
 *   never → `true` 赋值 TS2322 → 红；SA3（按 SA1 冻结签名）落位 → 绿。
 *   （注意：不能用「方法签名赋值条件类型」表达本锚——TS 函数参数数量逆变规则
 *   下 3 参数方法可赋给 4 参数契约，条件类型会误判 true；参数元组 `Parameters`
 *   捕获的是**声明形状**，无此误判。）
 * - 【红】round-1 基线（3 参数）在本锚下恒红 → 本锚是「round-1 已绿的存在性锚」
 *   之上的新增演化锚，二者共存（round-1 锚不变，本锚推进签名）。
 * - 【绿（保持性守卫）】`resetReplica` 公共签名必须保持 round-1 冻结的
 *   3 参数形状（`owner / namespaceId / expectedLocalIdentity`）——R2-AC-1 的
 *   行为变更只发生在编排内部（核对次序），公共签名不得因本轮演进漂移。
 *
 * 临时形状声明：第 4 参数的 `ReplicationIdentityRef` 取包公共类型面
 * （round-1 冻结字段形状 `{ replicationId: string; replicationEpoch: number }`）；
 * 若 SA1 冻结的绑定面不是「第 4 参数」形态（如构造期绑定/独立 setter），本锚按
 * round-1 SA6 回流惯例校准（行为锚不变）。
 */
import { describe, it } from 'vitest';
import type {
  NamespaceOwner,
  NamespaceRegistry,
  ReplicationIdentityRef,
} from '@nomicore/namespace-registry';
import type { YjsDoc } from '@nomicore/persistence';

/** R2-AC-3 类型锚：importReplica 声明面必须接收 Hub 广告 expected 身份（第 4 参数）。 */
type HasExpectedIdentityImport<T extends { readonly importReplica: (...args: never[]) => unknown }> =
  Parameters<T['importReplica']> extends [
    NamespaceOwner,
    string,
    YjsDoc,
    ReplicationIdentityRef,
  ]
    ? true
    : never;

/** 保持性守卫：resetReplica 公共签名保持 round-1 冻结 3 参数形状（不因本轮漂移）。 */
type HasResetReplicaSignature<T extends { readonly resetReplica: (...args: never[]) => unknown }> =
  Parameters<T['resetReplica']> extends [
    NamespaceOwner,
    string,
    ReplicationIdentityRef,
  ]
    ? true
    : never;

describe('类型面：NamespaceRegistry.importReplica 绑定 Hub 广告 expected 身份（R2-AC-3）', () => {
  it('importReplica 声明面接收 expected {replicationId, replicationEpoch}（第 4 参数，临时形状待 SA1 冻结）', () => {
    const anchored: HasExpectedIdentityImport<NamespaceRegistry> = true;
    void anchored;
  });
});

describe('类型面：resetReplica 公共签名保持 round-1 冻结形状（R2-AC-1 保持性守卫）', () => {
  it('resetReplica(owner, namespaceId, expectedLocalIdentity) 三参数形状不漂移', () => {
    const guarded: HasResetReplicaSignature<NamespaceRegistry> = true;
    void guarded;
  });
});

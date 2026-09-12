/**
 * SA6 红灯验收契约（类型面）— issue #299（#295 切片 1）：两聚合上限键进入公共类型面。
 *
 * 契约锚点：ADR 0022「资源上限与配置链」+ docs/protocols/instance-replication-v1.md §17。
 * `ReplicationLimits` 是 `@nomicore/ws-replication` 公共冻结契约面（`Partial<ReplicationLimits>`
 * 是 hub/peer/插件配置的 limits 覆盖类型）——两新键必须以与既有分块键同形的**必填 readonly
 * number** 进入该接口（缺省由 `DEFAULT_REPLICATION_LIMITS` 提供，覆盖经 Partial 合并），
 * 否则调用方只能靠 cast 表达新键、配置链在类型面断裂。
 *
 * 红灯条件（实现前必须失败）：`ReplicationLimits['maxChunkedBootstrapBytes']` 等四处在当前
 * HEAD 不存在 → vitest --typecheck 报类型错误（本文件不参与运行时断言，纯编译期契约）。
 * 转绿条件：实现把两键加入 `ReplicationLimits` 与冻结 `DEFAULT_REPLICATION_LIMITS`，本文件不改即绿。
 */
import { describe, expectTypeOf, it } from 'vitest';
import {
  DEFAULT_REPLICATION_LIMITS,
  type ReplicationLimits,
} from '@nomicore/ws-replication';

describe('issue #299 类型面：聚合上限两键进入 ReplicationLimits', () => {
  it('两键为必填 number（与既有分块键同形；缺省值由 DEFAULT_REPLICATION_LIMITS 提供）', () => {
    expectTypeOf<ReplicationLimits['maxChunkedBootstrapBytes']>().toEqualTypeOf<number>();
    expectTypeOf<ReplicationLimits['maxChunkedSyncDiffBytes']>().toEqualTypeOf<number>();
    expectTypeOf<
      (typeof DEFAULT_REPLICATION_LIMITS)['maxChunkedBootstrapBytes']
    >().toEqualTypeOf<number>();
    expectTypeOf<
      (typeof DEFAULT_REPLICATION_LIMITS)['maxChunkedSyncDiffBytes']
    >().toEqualTypeOf<number>();
  });

  it('两键可经 Partial<ReplicationLimits> 覆盖（配置链入口类型不变、无逐 kind 变体键）', () => {
    // 配置覆盖入口（hub/peer/插件 limits 的公共类型）：显式两键字面量必须无 cast 通过
    const override = {
      maxChunkedBootstrapBytes: 4 * 1024 * 1024,
      maxChunkedSyncDiffBytes: 4 * 1024 * 1024,
    } satisfies Partial<ReplicationLimits>;
    expectTypeOf(override).toMatchTypeOf<{
      maxChunkedBootstrapBytes: number;
      maxChunkedSyncDiffBytes: number;
    }>();
    // kind 无关推广：机制键名保持不变（不得出现 maxChunksPerSnapshot 之类逐 kind 变体）
    expectTypeOf<ReplicationLimits['maxChunksPerUpdate']>().toEqualTypeOf<number>();
    expectTypeOf<ReplicationLimits['maxConcurrentAssembliesPerConnection']>().toEqualTypeOf<number>();
  });
});

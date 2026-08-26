/**
 * @nomicore/namespace-registry/testing —— 受控依赖替换 seam（issue #110 设计 §8.2）。
 *
 * 只导出 overrides 接口与 testing 工厂；仍不导出 entry map、queue carrier、lease
 * count、timer handle、Runtime/DocHandle/Y.Doc 实例。本 subpath 的 declaration 中
 * Runtime/DocHandle 只作为类型 import 出现（内部 import，非主入口 re-export）。
 *
 * 注入面（§8.2）：runtimeFactory 替换 Runtime 构造；observer 观察内部事件（exact
 * cause）；diagnostics 仅测试诊断事件（不可逆 keyDigest + generation，不返回或读取
 * carrier/entry map）。#111/idle 的 createDocumentFactory/scheduler seam 不在本切片
 * 预留（rev2 合并前清理）：待真实实现引入具体类型与注入路径时再加入。
 */
import type { DocHandle, DocPersistence } from '@nomicore/persistence';
import type { NamespaceRuntime } from '@nomicore/namespace-runtime';
import { createRegistryInternal } from './registry.js';
import type { RegistryDiagnosticsSink, RegistryObserver } from './observer.js';
import type { NamespaceRegistry } from './types.js';

/** 受控依赖替换（§8.2 冻结面；diagnostics 类型单点取自 observer.ts）。 */
export interface NamespaceRegistryTestingOverrides {
  readonly runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => NamespaceRuntime;
  readonly observer?: RegistryObserver;
  /** 仅测试诊断事件，不返回或读取 carrier/entry map。keyDigest 非 raw identity。 */
  readonly diagnostics?: RegistryDiagnosticsSink;
}

/** testing 工厂：生产依赖（Runtime 构造/observer/diagnostics）全部可经 overrides 替换。 */
export function createNamespaceRegistryForTesting(
  persistence: DocPersistence,
  overrides: NamespaceRegistryTestingOverrides = {},
): NamespaceRegistry {
  const internal: {
    runtimeFactory?: (handle: any, notifyDirty: () => Promise<void>) => any;
    observer?: RegistryObserver;
    diagnostics?: RegistryDiagnosticsSink;
  } = {};
  if (overrides.runtimeFactory !== undefined) {
    internal.runtimeFactory = overrides.runtimeFactory;
  }
  if (overrides.observer !== undefined) {
    internal.observer = overrides.observer;
  }
  if (overrides.diagnostics !== undefined) {
    internal.diagnostics = overrides.diagnostics;
  }
  return createRegistryInternal(persistence, internal);
}

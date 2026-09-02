/**
 * @nomicore/namespace-registry/testing —— 受控依赖替换 seam（issue #110 设计 §8.2；
 * issue #111 设计 §8 DQ-8；issue #112 设计 §2.J）。
 *
 * 只导出 overrides 接口与 testing 工厂 + createRegistryTestScheduler；仍不导出 entry
 * map、queue carrier、lease count、timer handle、Runtime/DocHandle/Y.Doc 实例。本
 * subpath 的 declaration 中 Runtime/DocHandle 只作为类型 import 出现（内部 import，
 * 非主入口 re-export）。
 *
 * 注入面（§8.2）：runtimeFactory 替换 Runtime 构造；observer 观察内部事件（exact
 * cause）；diagnostics 仅测试诊断事件（不可逆 keyDigest + generation，不返回或读取
 * carrier/entry map）。#111 增量（§8）：`clock` 为必需（与生产同款式构造期形状门禁，
 * 便于 manual clock 精确锚定）；`createDocumentFactory` 注入 create-document 构造步
 * （返回成功 doc 或领域失败；throw 即模拟 internal）。#112 增量（§2.J）：`scheduler`
 * 为**必需**（同生产形状门禁：无缺省——release 即武装 timer，缺省会静默掩盖 idle
 * 行为；拒绝虚假降级）；`idleTimeoutMs` 可选。主入口不 re-export 本子路径。
 */
import type { Clock } from '@nomicore/clock';
import type { DocHandle, DocPersistence } from '@nomicore/persistence';
import type { NamespaceRuntime } from '@nomicore/namespace-runtime';
import { createRegistryInternal } from './registry.js';
import type { RegistryDiagnosticsSink, RegistryObserver } from './observer.js';
import type { CreateDocumentGatewayResult } from './create-document.js';
import type {
  InstanceRole,
  NamespaceRegistry,
  RegistryRandomBytes,
  RegistryTimeoutScheduler,
} from './types.js';

/** 受控依赖替换（§8.2 冻结面；#111 增量 clock/createDocumentFactory；#112 增量
 * scheduler/idleTimeoutMs；phase-5 切片 1 增量 randomBytes（必需）；diagnostics
 * 类型单点取自 observer.ts）。 */
export interface NamespaceRegistryTestingOverrides {
  readonly runtimeFactory?: (handle: DocHandle, notifyDirty: () => Promise<void>) => NamespaceRuntime;
  readonly observer?: RegistryObserver;
  /** 仅测试诊断事件，不返回或读取 carrier/entry map。keyDigest 非 raw identity。 */
  readonly diagnostics?: RegistryDiagnosticsSink;
  /** 必需 Clock（§8）：缺失/null/now 非函数 → 构造期同步固定 TypeError（同生产门禁）。 */
  readonly clock: Clock;
  /** create-document 构造步注入（§8）：返回成功 doc 或领域失败；throw 即模拟 internal。 */
  readonly createDocumentFactory?: (
    namespaceId: string,
    createdAt: string,
    schema: unknown,
    root: unknown,
  ) => CreateDocumentGatewayResult;
  /** 必需 Scheduler（#112 §2.J）：缺失/坏形状 → 构造期同步固定 TypeError（同生产门禁，
   * 检查顺序在 clock 之后）；禁缺省——release 即武装 idle timer。 */
  readonly scheduler: RegistryTimeoutScheduler;
  /** 可选 idleTimeoutMs（#112 §2.J）：缺省 300_000；测试常用小值或直接驱动 fake。 */
  readonly idleTimeoutMs?: number;
  /** 必需受控随机源（phase-5 切片 1；同生产门禁——缺失/非函数 → 构造期同步固定
   * TypeError，禁全局 crypto fallback）。 */
  readonly randomBytes: RegistryRandomBytes;
  /** 实例静态角色（issue #134 O-4；同生产同形——可选，缺省 'hub'；非法值 → 构造期
   * 同步固定 TypeError，检查顺序与生产一致（randomBytes 之后）。 */
  readonly role?: InstanceRole;
}

/**
 * #112 确定性 fake scheduler（§2.J，持久化 createTestScheduler 蓝本）：到期序逐个
 * 触发 + 3 层微任务展开；`pending()` 即时返回计面。纯 map 队列 fake—零 native timer
 * 调用（§2.M 静态守卫零豁免成立）。
 */
export interface RegistryTestScheduler extends RegistryTimeoutScheduler {
  /** 推进虚拟时钟：按到期序逐个触发到期的 callback 并做有限微任务展开。 */
  advanceBy(milliseconds: number): Promise<void>;
  /** 当前已武装未触发（含未取消）的 timer 数；即时返回（不展开微任务）。 */
  pending(): number;
}

/** 创建确定性 fake scheduler（时间全经 advanceBy 驱动，零 real sleep）。 */
export function createRegistryTestScheduler(): RegistryTestScheduler {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    // 属性箭头形态（§2.M 静态守卫判别力样本表：`setTimeout(` 裸调用非法、
    // `setTimeout: (…)=>` 属性位合法——禁止对象方法简写，理由同 persistence
    // HOST_GLOBAL_TIMER 正则的双向阀门设计）。
    setTimeout: (callback, delayMs) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout: (timer) => {
      timers.delete(timer as number);
    },
    pending: () => timers.size,
    advanceBy: async (milliseconds) => {
      const deadline = now + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= deadline)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (due === undefined) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
        for (let index = 0; index < 3; index += 1) await Promise.resolve();
      }
      now = deadline;
      for (let index = 0; index < 3; index += 1) await Promise.resolve();
    },
  };
}

/** testing 工厂：生产依赖（Runtime 构造/observer/diagnostics/Clock/scheduler/create-document）
 * 全部可经 overrides 替换。Clock/Scheduler 均必需（§8/#112 §2.J）；omitted/null/坏形状 →
 * 内部构造期同步固定 TypeError（同生产门禁）。 */
export function createNamespaceRegistryForTesting(
  persistence: DocPersistence,
  overrides: NamespaceRegistryTestingOverrides | undefined = undefined,
): NamespaceRegistry {
  const internal: {
    runtimeFactory?: (handle: any, notifyDirty: () => Promise<void>) => any;
    observer?: RegistryObserver;
    diagnostics?: RegistryDiagnosticsSink;
    clock: Clock;
    scheduler: RegistryTimeoutScheduler;
    randomBytes: RegistryRandomBytes;
    idleTimeoutMs?: number;
    role?: InstanceRole;
    createDocumentFactory?: (
      namespaceId: string,
      createdAt: string,
      schema: unknown,
      root: unknown,
    ) => CreateDocumentGatewayResult;
  } = {
    clock: overrides?.clock as Clock,
    scheduler: overrides?.scheduler as RegistryTimeoutScheduler,
    randomBytes: overrides?.randomBytes as RegistryRandomBytes,
  };
  if (overrides?.runtimeFactory !== undefined) {
    internal.runtimeFactory = overrides.runtimeFactory;
  }
  if (overrides?.observer !== undefined) {
    internal.observer = overrides.observer;
  }
  if (overrides?.diagnostics !== undefined) {
    internal.diagnostics = overrides.diagnostics;
  }
  if (overrides?.createDocumentFactory !== undefined) {
    internal.createDocumentFactory = overrides.createDocumentFactory;
  }
  if (overrides?.idleTimeoutMs !== undefined) {
    internal.idleTimeoutMs = overrides.idleTimeoutMs;
  }
  if (overrides?.role !== undefined) {
    internal.role = overrides.role;
  }
  return createRegistryInternal(persistence, internal);
}

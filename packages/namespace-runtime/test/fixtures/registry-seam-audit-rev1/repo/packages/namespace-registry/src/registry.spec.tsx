/**
 * 【审计探针固定装置 · 反例】`*.spec.*` 文件名（测试文件，非生产代码）。
 * 白名单必须按文件名拒绝：存在此消费 → 审计判违规。
 */
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';

export const registrySpecConsumer = createNamespaceRuntimeForRegistry;

/**
 * 【审计探针固定装置 · 反例】Registry src 下的 mock 子目录属非生产目录（mock 载体）。
 * 白名单必须拒绝：存在此消费 → 审计判违规。
 */
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';

export const mockConsumer = createNamespaceRuntimeForRegistry;

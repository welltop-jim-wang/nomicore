/**
 * 【审计探针固定装置 · 反例】`src/testing/` —— ADR-0009 §公共 Interface 点名的
 * 「受控 testing subpath」类非生产代码（注入替代 factory/Clock 等的测试 seam 载体）。
 * 白名单必须拒绝：存在此消费 → 审计判违规。
 */
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';

export const testingConsumer = createNamespaceRuntimeForRegistry;

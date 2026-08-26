/**
 * 【审计探针固定装置 · 负例】非 Registry 生产代码消费 internal subpath（这里是
 * persistence 包的 src 模拟文件）→ 白名单之外 → 审计判违规。
 */
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';

export const storeConsumer = createNamespaceRuntimeForRegistry;

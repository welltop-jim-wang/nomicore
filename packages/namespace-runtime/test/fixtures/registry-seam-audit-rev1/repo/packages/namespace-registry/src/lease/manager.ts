/**
 * 【审计探针固定装置 · 正例】Registry 生产子目录（路径段不含 testing/test/__tests__/
 * fixtures/mock 等非生产段、文件名不含 .test./.spec.）→ 白名单放行。
 * 证明目标：`src/<生产子目录>/*.ts` 属合法消费者，审计判为合规。
 */
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';

export const makeRuntimeFromLease = createNamespaceRuntimeForRegistry;

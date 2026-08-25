/**
 * 【审计探针固定装置 · 正例】白名单内 Registry 生产模块对 internal subpath 的合法消费。
 *
 * 本文件仅是审计 helper 的 fixture 树输入：位于 packages/namespace-runtime/test/ 下
 * （真实全仓门禁的扫描跳过域），永不进入真实门禁。
 * 证明目标：消费方落在白名单内 → 审计「检测到该消费，但判为合规（非 violator）」。
 */
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';

export const registryFactory = createNamespaceRuntimeForRegistry;

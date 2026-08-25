/**
 * 【审计探针固定装置 · 反例】`*.test.*` 文件名（测试文件，非生产代码；如 src/ 下伴随
 * 测试文件）。白名单必须按文件名拒绝：存在此消费 → 审计判违规。
 *
 * 载体用 .tsx：审计扩展名集合覆盖 .tsx；同时避免被 vitest（只拾取 *.test.ts）与
 * tsc（include 只匹配 *.ts）当作真实测试/类型检查对象。
 */
import { createNamespaceRuntimeForRegistry } from '@nomicore/namespace-runtime/internal';

export const registryTestConsumer = createNamespaceRuntimeForRegistry;

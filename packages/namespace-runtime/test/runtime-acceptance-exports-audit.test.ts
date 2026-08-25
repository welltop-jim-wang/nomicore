/**
 * 验收测试 — issue #93 AC6：公共 exports 审计（模块级运行时探测）。
 *
 * 契约来源：
 * - 任务简报（issue #93）AC6：「公共 exports 审计确认不暴露生产构造器、DocHandle/Y.Doc/
 *   writable Yjs reference 或包内 detached/testing seam」；
 * - docs/adr/0008（所有权与公共面）：「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META
 *   live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性
 *   seam 注入可控 P0、dirty notifier、handle 与 fault」；
 * - src/index.ts 头注（公共面纪律）：只导出类型 + @internal seam 构造器
 *   createNamespaceRuntimeWithSeam；生产构造器 createNamespaceRuntime 保留包内；
 *   RuntimeWriteFatalError 是 ADR-0008 点名的稳定 rejection 形状，例外值导出。
 *
 * 断言全部为运行时模块探测（import 作用域的可观测导出表），不读源码文本。
 * 验收记录：本文件首次运行即「已绿/存量能力」证据。
 */
import { describe, expect, it } from 'vitest';
import * as publicEntry from '../src/index.js';

describe('AC6：公共 exports 审计（模块级导出表精确性）', () => {
  it('值导出键集恰为文档化公共面——无生产构造器/运行态/包内 seam 泄漏', () => {
    // 运行时模块导出探测：任何未文档化值导出（createNamespaceRuntime、WriteSequencer、
    // runP0、PersistenceHandle、packages 内部类……）都会使键集断言失败。
    expect(Object.keys(publicEntry).sort()).toEqual(['RuntimeWriteFatalError', 'createNamespaceRuntimeWithSeam']);
  });

  it('生产构造器与包内运行态模块级缺席（运行时导入探测）', () => {
    const entry = publicEntry as Record<string, unknown>;
    for (const forbidden of [
      'createNamespaceRuntime', // 生产工厂保留包内（ADR-0008；未来 Registry 使用）
      'WriteSequencer', // 运行态不导出
      'runP0', // P0 槽体不导出
      'runRootWriteSlot', // 写槽体不导出
      'runSchemaWriteSlot', // SCHEMA 写槽体不导出
      'runCloseBarrier', // close barrier 不导出
      'buildStatus', // 状态组装不导出
      'PersistenceHandle', // 持久层租约实现不导出
      'MemoryPersistence',
      'FilePersistence',
    ]) {
      expect(entry[forbidden], `模块级导出 ${forbidden} 应缺席`).toBeUndefined();
    }
  });

  it('seam 构造器是唯一导出构造路径（模块级值导出形状探测：两值导出均为 function；十键冻结语义由 runtime-close-lifecycle.test.ts 覆盖）', async () => {
    const entry = publicEntry as Record<string, unknown>;
    expect(typeof entry.createNamespaceRuntimeWithSeam).toBe('function');
    expect(typeof entry.RuntimeWriteFatalError).toBe('function');
  });
});

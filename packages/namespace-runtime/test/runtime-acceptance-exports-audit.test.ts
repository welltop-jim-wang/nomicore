/**
 * 验收测试 — issue #93 AC6：公共 exports 审计（模块级运行时探测）。
 *
 * 契约来源：
 * - 任务简报（issue #93）AC6：「公共 exports 审计确认不暴露生产构造器、DocHandle/Y.Doc/
 *   writable Yjs reference 或包内 detached/testing seam」；
 * - docs/adr/0008（所有权与公共面）：「Runtime 不公开 handle、Y.Doc、ROOT/SCHEMA/META
 *   live 引用或生产构造器。生产工厂保留包内，由未来 Registry 使用；测试通过包内确定性
 *   seam 注入可控 P0、dirty notifier、handle 与 fault」；
 * - src/index.ts 头注（公共面纪律，rev2 收口）：值导出恰 RuntimeWriteFatalError；
 *   seam（createNamespaceRuntimeWithSeam + NamespaceRuntimeSeamInput）与生产工厂
 *   createNamespaceRuntime 一并保留 runtime.ts 模块级、不经本入口；本入口对二者零
 *   re-export——seam 输入类型含 DocHandle，随值一并撤出公共面（AC6 点名对象）。
 *
 * 断言全部为运行时模块探测（import 作用域的可观测导出表）/package.json 配置审计，
 * 不读源码文本。
 * 验收记录：本文件首次运行即「已绿/存量能力」证据。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as publicEntry from '../src/index.js';

describe('AC6：公共 exports 审计（模块级导出表精确性）', () => {
  it('值导出键集恰为一键——seam 已撤出公共面（AC6 rev2）', () => {
    // 运行时模块导出探测：任何未文档化值导出（createNamespaceRuntimeWithSeam、
    // createNamespaceRuntime、WriteSequencer、runP0、PersistenceHandle、packages
    // 内部类……）都会使键集断言失败。【rev2 红灯】：现 2 键 → 绿：恰
    // ['RuntimeWriteFatalError']（D-1/裁决 A：seam 值撤出 index.ts）。
    expect(Object.keys(publicEntry).sort()).toEqual(['RuntimeWriteFatalError']);
  });

  it('生产构造器、测试 seam 与包内运行态模块级全体缺席（运行时导入探测）', () => {
    const entry = publicEntry as Record<string, unknown>;
    for (const forbidden of [
      'createNamespaceRuntime', // 生产工厂保留包内（ADR-0008；未来 Registry 使用）
      'createNamespaceRuntimeWithSeam', // 【rev2】seam 一并撤出公共面——包内模块通道消费
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

  it('唯一值导出 RuntimeWriteFatalError 是 function；seam 经包内模块通道 ../src/runtime.js 消费（模块级值导出形状探测；十键冻结语义由 runtime-close-lifecycle.test.ts 覆盖）', () => {
    const entry = publicEntry as Record<string, unknown>;
    expect(typeof entry.RuntimeWriteFatalError).toBe('function');
  });

  it('T1.4（存量审计锚）：package.json exports 键集恰 [. ]——无 ./testing 子路径（配置审计，防未来回潮）', () => {
    // 配置审计（package.json 是配置元数据，非被测源码文本；断言当前真实现状——首跑必绿）。
    // 契约：D-1/裁决 A——seam 撤出以「包内模块通道（相对导入）」兑现，绝不新增 "./testing"
    // 子路径 export（private:true 无包外消费方，子路径没有兑付对象）。
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    expect(pkg.exports).toBeTypeOf('object');
    const keys = Object.keys(pkg.exports as Record<string, unknown>).sort();
    expect(keys).toEqual(['.']);
  });
});

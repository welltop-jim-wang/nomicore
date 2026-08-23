/**
 * SA6 红灯测试 — validateLogicalSnapshot：更名验收锚（issue #71 / ADR-0007）。
 *
 * 任务：`validateSnapshot` → `validateLogicalSnapshot` 全仓一次性更名，零行为变化、
 * 不保留 deprecated alias；新名语义 = 普通 JSON logical ROOT snapshot 校验（不接收
 * Y.Doc/Y.Map/Y.Array，也不验证 Yjs 载体）。
 *
 * 本文件锚定更名后的**公共导出面**：
 *   - `validateLogicalSnapshot` 存在（函数）——当前红灯：index.ts 尚未导出该名；
 *   - 旧名 `validateSnapshot` 在模块导出中**不存在**（不保留兼容 alias）——当前
 *     红灯：旧名仍在导出（模块级导出断言，真·模块级锚，有牙；非源码 grep）。
 *
 * 行为回归（issues 语义 / 资源预算 / 纯函数 / 零写入）由共享断言集
 * `validate-logical-snapshot.contract.ts` 以新名执行——本文件全部测试当前必然失败
 * （新名缺失即红灯，非伪红）；SA3 完成更名迁移后转绿，即证明既有校验契约零回归。
 * 断言全部锚定可观测输出（结果形状 / issue 内容 / path 段数组 / 输入状态），不读取
 * 源码、不 grep 文本形状。
 */
import { describe, expect, it } from 'vitest';
import * as vfsl from '../src/index.js';
import { registerBehaviorRegression } from './validate-logical-snapshot.contract.js';
import type { ValidateFn } from './validate-logical-snapshot.contract.js';

// 命名空间取成员（ESM 缺名导出绑定为 undefined，不做任何 fallback——软兜底即伪红）。
const validateLogicalSnapshot = (vfsl as unknown as Record<string, unknown>).validateLogicalSnapshot;
const validateSnapshot = (vfsl as unknown as Record<string, unknown>).validateSnapshot;

describe('validateLogicalSnapshot — 公共导出面（更名验收，issue #71 / ADR-0007）', () => {
  it('AC1：validateLogicalSnapshot 为包公共导出（函数）', () => {
    expect(typeof validateLogicalSnapshot).toBe('function');
  });

  it('AC2：旧名 validateSnapshot 不再存在于模块导出（不保留 deprecated alias）', () => {
    expect(validateSnapshot).toBeUndefined();
  });
});

// 行为回归契约以新名执行（当前红灯：新名缺失 → 全部失败；SA3 更名后转绿）。
registerBehaviorRegression(validateLogicalSnapshot as unknown as ValidateFn);

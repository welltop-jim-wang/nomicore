import { describe, expect, it } from 'vitest';
import { parseSchemaEnvelope } from '../src/index.js';

describe('parseSchemaEnvelope', () => {
  const valid = {
    lang: 'vfsl',
    version: 1,
    id: 'vfs3.assets@2',
    text: 'type AssetsDoc = YMap<{ assets: { byId: Record<AssetId, AssetEntity> } }>;',
  };

  it('接受结构合法的对象信封', () => {
    expect(parseSchemaEnvelope(valid)).toEqual(valid);
  });

  it('接受 JSON 字符串形式的信封（__schema__ 单字符串值，设计文档 §6）', () => {
    expect(parseSchemaEnvelope(JSON.stringify(valid))).toEqual(valid);
  });

  it('对缺失/非法输入返回 undefined 而不是抛错（§10.3 accessor 降级）', () => {
    expect(parseSchemaEnvelope(undefined)).toBeUndefined();
    expect(parseSchemaEnvelope(42)).toBeUndefined();
    expect(parseSchemaEnvelope('not json {')).toBeUndefined();
  });

  it('拒绝 lang 不是 vfsl 的信封（未知语言由上层决定只读）', () => {
    expect(parseSchemaEnvelope({ ...valid, lang: 'zod' })).toBeUndefined();
  });

  it('拒绝非法 version（非整数 / 小于 1 / 非数字）', () => {
    expect(parseSchemaEnvelope({ ...valid, version: 0 })).toBeUndefined();
    expect(parseSchemaEnvelope({ ...valid, version: 1.5 })).toBeUndefined();
    expect(parseSchemaEnvelope({ ...valid, version: '1' })).toBeUndefined();
  });

  it('拒绝空 id 或空 text', () => {
    expect(parseSchemaEnvelope({ ...valid, id: '' })).toBeUndefined();
    expect(parseSchemaEnvelope({ ...valid, text: '' })).toBeUndefined();
  });
});

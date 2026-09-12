/**
 * SA6 绿→保持绿契约 — issue #315 C5：既有 fixture 指纹零漂移 + 含 Int/Range 新 fixture 稳定。
 *
 * ADR 0020 决策 5：新增 `int`/`range` IR 叶子只服务新文本——无 Int/Range 的既有 schema
 * IR 逐字节不变、既有语义指纹（`sha256:v1:`）全部不变；决策 7 + ADR 0005：`generate --check`
 * 基线不变。本文件把 SA6 §4 的 HEAD 基线值逐字节钉死为任务域独立哨兵（与
 * `number-literals-fixture-drift.test.ts` 的 #314 哨兵同款、互不替代）：任何 IR 键序变化、
 * 指纹前缀升版（v2）、`domains/vfs3-assets/**` 改写都会在这里先红。
 *
 * 新 fixture 侧：两次全新编译 `semanticFingerprint` 相等且保持 `sha256:v1:` 前缀（稳定，
 * 不钉具体值）；IR JSON 往返深度相等（条件键纪律结构性哨兵）。
 *
 * 断言纪律：只观察公共接缝（`FileSchemaSource` / `compileSchemaEnvelope`）与生成物文件字节；
 * 不 skip / 不软化 / 不 grep 源码。`pnpm generate --check`（生成物陈旧检测）由门禁命令另证。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileSchemaEnvelope, FileSchemaSource } from '../src/index.js';

/** 仓根（`domains/` 的父目录；`FileSchemaSource` 入参语义）。 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** SA6 §4 HEAD 基线（逐字节钉死值）。 */
const ENVELOPE_FINGERPRINT = 'sha256:v1:7b6c19cbac93cbf104c055c320b5e4a5ba72e0db87342de0853c68bedff53f39';
const SEMANTIC_FINGERPRINT = 'sha256:v1:b71be76e3d3579670236b14a36373716db6238d86a15da440f44aecbb9b0631c';
const GENERATED_SHA256 = '342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707';

/** SA6 §12.1 规范 fixture（含 Int/Range 三形态）。 */
const NEW_FIXTURE = `type ROOT = YMap<{
  a: number & Int;
  b: number & Int<1, 100>;
  c: number & Range<0.5, 1.5>;
  d: number & Range<-40, 85>;
  e: number & Int<0, 9>[];
  p: number & Int<1, 1>;
  q: number & Range<0, 0>;
}>;
`;

function newEnvelope(id: string): { lang: string; version: number; id: string; text: string } {
  return { lang: 'vfsl', version: 1, id, text: NEW_FIXTURE };
}

describe('C5 — 既有 fixture 指纹零漂移（sha256:v1: 前缀保持）', () => {
  it('FileSchemaSource.list() 恰为 [vfs3-assets@1]', async () => {
    const source = new FileSchemaSource(repoRoot);
    await expect(source.list()).resolves.toEqual(['vfs3-assets@1']);
  });

  it('envelope / semantic 指纹逐字节等于 SA6 §4 基线（IR 键序与域文档形态不变）', async () => {
    const source = new FileSchemaSource(repoRoot);
    const envelope = await source.load('vfs3-assets@1');
    const compiled = compileSchemaEnvelope(envelope);
    expect(compiled.ok, `编译应成功：${JSON.stringify(compiled.ok ? [] : compiled.issues)}`).toBe(true);
    if (!compiled.ok) throw new Error('compileSchemaEnvelope 失败');
    expect(compiled.envelopeFingerprint).toBe(ENVELOPE_FINGERPRINT);
    expect(compiled.semanticFingerprint).toBe(SEMANTIC_FINGERPRINT);
    expect(compiled.envelopeFingerprint.startsWith('sha256:v1:')).toBe(true);
    expect(compiled.semanticFingerprint.startsWith('sha256:v1:')).toBe(true);
  });

  it('domains/vfs3-assets/generated.ts 逐字节不变（重新生成即此处先红）', () => {
    const bytes = readFileSync(new URL('../../../domains/vfs3-assets/generated.ts', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(GENERATED_SHA256);
  });
});

describe('C5 — 含 Int/Range 新 fixture：编译 ok、指纹稳定、IR 无 undefined 槽', () => {
  it('compileSchemaEnvelope ok:true，两次全新编译 semanticFingerprint 相等且前缀 sha256:v1:', () => {
    const first = compileSchemaEnvelope(newEnvelope('int-range-fixture@1'));
    expect(first.ok, `编译应成功：${JSON.stringify(first.ok ? [] : first.issues)}`).toBe(true);
    if (!first.ok) throw new Error('首次编译失败');
    const second = compileSchemaEnvelope(newEnvelope('int-range-fixture@1'));
    expect(second.ok, `编译应成功：${JSON.stringify(second.ok ? [] : second.issues)}`).toBe(true);
    if (!second.ok) throw new Error('第二次编译失败');
    expect(first.semanticFingerprint).toBe(second.semanticFingerprint);
    expect(first.envelopeFingerprint).toBe(second.envelopeFingerprint);
    expect(first.semanticFingerprint.startsWith('sha256:v1:')).toBe(true);
    expect(first.envelopeFingerprint.startsWith('sha256:v1:')).toBe(true);
  });

  it('新 fixture 的 IR 经 JSON 往返深度相等（条件键 = 整键不存在，无 undefined 槽）', () => {
    const compiled = compileSchemaEnvelope(newEnvelope('int-range-fixture@1'));
    if (!compiled.ok) throw new Error('编译失败');
    expect(JSON.parse(JSON.stringify(compiled.module))).toEqual(compiled.module);
  });
});

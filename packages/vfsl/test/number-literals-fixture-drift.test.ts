/**
 * SA6 绿→保持绿契约 — issue #314 C5：既有 fixture（`vfs3-assets@1`）语义指纹与生成物零漂移。
 *
 * 拓宽只增加可达 IR 值（负 / 小数字面量），IR 类型族零新增 —— ADR 0020 决策 5 要求既有
 * 语义指纹**全部不变**、ADR 0020 决策 7 要求 `generate --check` 基线不变。本文件把
 * SA6 §4 的 HEAD 基线值逐字节钉死为任务域独立哨兵（既有 `parse-vfsl-union-member-docs`
 * 的指纹 pin 为另一任务域，互不替代）：任何 IR 键序变化、指纹前缀升版（v2）、
 * `domains/vfs3-assets/**` 改写都会在这里先红。
 *
 * 断言纪律：只观察公共接缝（`FileSchemaSource` / `compileSchemaEnvelope`）与生成物文件
 * 字节；不 skip / 不软化。`pnpm generate --check`（生成物陈旧检测）由 C7 门禁命令另证。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { compileSchemaEnvelope, FileSchemaSource } from '../src/index.js';

/** 仓根（`domains/` 的父目录；`FileSchemaSource` 入参语义）。 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** SA6 §4 HEAD 基线（逐字节钉死值）。 */
const ENVELOPE_FINGERPRINT = 'sha256:v1:7b6c19cbac93cbf104c055c320b5e4a5ba72e0db87342de0853c68bedff53f39';
const SEMANTIC_FINGERPRINT = 'sha256:v1:b71be76e3d3579670236b14a36373716db6238d86a15da440f44aecbb9b0631c';
const GENERATED_SHA256 = '342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707';

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
    // FINGERPRINT_PREFIX 未升版（D2 触发器裁定：v2 方言未引入 ⇒ 保持 sha256:v1:）
    expect(compiled.envelopeFingerprint.startsWith('sha256:v1:')).toBe(true);
    expect(compiled.semanticFingerprint.startsWith('sha256:v1:')).toBe(true);
  });

  it('domains/vfs3-assets/generated.ts 逐字节不变（重新生成即此处先红）', () => {
    const bytes = readFileSync(new URL('../../../domains/vfs3-assets/generated.ts', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(GENERATED_SHA256);
  });
});

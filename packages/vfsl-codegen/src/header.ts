/**
 * 生成文件头注 + 源文本哈希（§4）。
 *
 * 确定性：无时间戳、无路径、无环境变量；同（输入, 包版本）→ 逐字节同输出。
 * Generator 行版本 = 运行时自同步：惰性读取本包 package.json 的 version 字段并缓存
 * （`new URL('../package.json', import.meta.url)` 相对本文件解析）——版本 bump 后头注
 * 自动随之变化，regen-diff 自动报警，消除「手工同步 GENERATOR_VERSION 常量」的漏报
 * 失败模式。读/解析失败 → 响亮 throw，绝不静默回退旧值或硬编码值。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

let cachedGeneratorVersion: string | null = null;

function generatorVersion(): string {
  if (cachedGeneratorVersion === null) {
    let pkg: unknown;
    try {
      pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as unknown;
    } catch (err) {
      throw new Error(
        `[vfsl-codegen] 无法读取本包 package.json（版本自同步）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const version = (pkg as { version?: unknown }).version;
    if (typeof version !== 'string' || version === '') {
      throw new Error('[vfsl-codegen] 本包 package.json 缺少 version 字段（版本自同步失败）');
    }
    cachedGeneratorVersion = version;
  }
  return cachedGeneratorVersion;
}

/** §4 头注块。`sourceText` 缺失时写 `sha256:&lt;未提供&gt;`（仍确定性）。 */
export function buildHeader(sourceText: string | undefined): string {
  const hash =
    sourceText === undefined ? '<未提供>' : createHash('sha256').update(sourceText, 'utf8').digest('hex');
  return [
    '/**',
    ' * GENERATED FILE — DO NOT EDIT.',
    ` * Generator: @nomicore/vfsl-codegen@${generatorVersion()}`,
    ` * Source hash: sha256:${hash}`,
    ' * Regenerate with: pnpm generate',
    ' */',
  ].join('\n');
}

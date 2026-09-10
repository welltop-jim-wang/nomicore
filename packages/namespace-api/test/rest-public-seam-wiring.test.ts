/**
 * SA6 契约（wiring 锚，非行为替代）— issue #267：ADR 0015 L18 要求 REST Adapter
 * 由 `@nomicore/namespace-api/rest` 子路径暴露；本文件断言该公共 seam 的打包接线
 * 存在（package.json exports + `nomicore-source` 条件指向存在的源文件）。
 *
 * 这不是行为验证的替代：router 行为契约在 rest-create-hub-contract.test.ts /
 * rest-role-gate-routing-contract.test.ts 经 `../src/rest.js`（= subpath 的源文件，
 * 契约假设 H3）执行；本文件只防「实现存在但未按 ADR 暴露 subpath」的静默缺口。
 *
 * 状态（iteration 1）：`packages/namespace-api/package.json` 不存在 → 红灯（能力缺口锚）；
 * SA3 落地包与 exports 后转绿。本文件只做 manifest/接线断言，不替代行为契约
 * （行为契约见同目录 rest-create-hub-contract.test.ts / rest-role-gate-routing-contract.test.ts）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

interface PackageManifest {
  readonly name?: unknown;
  readonly exports?: Record<string, unknown>;
}

function readManifest(): PackageManifest {
  const manifestPath = join(PACKAGE_ROOT, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      '能力缺口：packages/namespace-api/package.json 不存在（@nomicore/namespace-api 尚未建立）',
    );
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
}

describe('issue #267 公共 seam 接线契约（ADR 0015 L18）', () => {
  it('REST Adapter 由 ./rest 子路径暴露，nomicore-source 条件指向存在的源文件', () => {
    const manifest = readManifest();
    expect(manifest.name).toBe('@nomicore/namespace-api');
    const restExport = manifest.exports?.['./rest'];
    expect(restExport).toBeDefined();
    if (restExport === null || typeof restExport !== 'object') {
      throw new Error('契约违例：exports["./rest"] 必须是带条件的 export 对象');
    }
    const sourceTarget = (restExport as Record<string, unknown>)['nomicore-source'];
    expect(typeof sourceTarget).toBe('string');
    if (typeof sourceTarget !== 'string') throw new Error('契约违例：缺少 nomicore-source 条件');
    expect(existsSync(join(PACKAGE_ROOT, sourceTarget))).toBe(true);
  });
});

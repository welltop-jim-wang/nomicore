/**
 * AC5 — 仓内脚手架校验（issue #25 / F1 §6.1）。
 *
 * 载体形态：vitest include（`packages` 下各包 `test/` 目录的 `*.test.ts`）命中 → 普通
 * `pnpm test` 自动跑到；另被 ci.yml 的 `Domain scaffolds check` 步骤显式点名
 * （`--passWithNoTests=false`——防本测试文件被删/改名后显式步骤静默假绿）。两条路径跑
 * 同一文件，无双重实现。
 *
 * 校验语义（设计 §6.1）：
 * - **经接缝消费**（脚手架纪律的 dogfood）：`new FileSchemaSource(repoRoot)` 先 `list()`
 *   （任一领域损坏/方言不符 → reject → 红），再对每个 id `load(id)` 并
 *   `parseVfsl(env.text)` ok——「全部领域文件可解析 + 头部三键齐备」恰是 load 内建校验
 *   + parseVfsl 的组合，CI 也是消费方、经接缝取文本，零解析逻辑重复实现；
 * - **空集行为**：`domains/` 不存在或 0 文件 → pass + console.log 显式 notice（F1 先于
 *   G 合入，domains/ 尚不存在属设计内状态；notice 保证「忘了建 domains/」在 CI 日志里
 *   不静默）；
 * - **断言助手锚点**：`assertVfslDialect({lang:'vfsl',version:1})` 不抛、
 *   `{lang:'yaml',version:1}` 抛结构化 `dialect-mismatch`——消费方首动作的最小运行时
 *   锚点（SA6 测试未直接覆盖该导出）。
 *
 * repoRoot 推导（R2 #11b 写死 API）：`fileURLToPath(new URL('../../..', import.meta.url))`
 * ——自 `packages/vfsl/test/` 上溯三级到仓根；必须用 `node:url` 的 `fileURLToPath`，
 * 不得直取 `URL.pathname`（百分号编码路径下产出错误路径）。
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  assertVfslDialect,
  FileSchemaSource,
  parseVfsl,
  SchemaSourceError,
} from '../src/index.js';

/** 仓根（domains/ 的父目录；FileSchemaSource 入参语义 = 包含 domains/ 的根目录）。 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('AC5 — 仓内脚手架校验（经 SchemaSource 接缝消费）', () => {
  it('domains/ 下全部领域 schema 可经接缝加载且 parseVfsl 直接可解析（空集 = pass + notice）', async () => {
    const source = new FileSchemaSource(repoRoot);
    const ids = await source.list();
    if (ids.length === 0) {
      // F1 期 domains/ 尚不存在或为空（G 票才种首个领域）→ pass + 显式 notice（CI 日志可查）
      console.log('[domains-scaffold] 0 domain schemas found（domains/ 不存在或为空——G 票落地后此处自然非空）');
      return;
    }
    for (const id of ids) {
      const env = await source.load(id);
      expect(env.lang).toBe('vfsl');
      expect(env.version).toBe(1);
      const result = parseVfsl(env.text);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`期望 ok: true，实际 ok: false（id: ${id}, issues: ${JSON.stringify(result.issues)}）`);
      }
    }
  });

  it('assertVfslDialect 锚点：vfsl/1 放行；方言不符 → 结构化 dialect-mismatch', () => {
    expect(() => assertVfslDialect({ lang: 'vfsl', version: 1 })).not.toThrow();
    try {
      assertVfslDialect({ lang: 'yaml', version: 1 });
      expect.unreachable('方言不符应抛 dialect-mismatch');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaSourceError);
      expect(err).toMatchObject({ kind: 'schema-source', code: 'dialect-mismatch' });
    }
  });
});

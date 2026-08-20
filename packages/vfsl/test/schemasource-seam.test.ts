/**
 * SA6 红灯测试 — SchemaSource 接缝 + FileSchemaSource + 方言断言（issue #25 / F1）。
 *
 * 契约来源：
 * - docs/adr/0005-projection-generation-pipeline.md → §1 接缝形状、§2 脚手架文件格式
 *   （本票冻结契约）：`SchemaSource { load(id): Promise<SchemaEnvelope>; list(): Promise<string[]> }`、
 *   信封 `{ lang, version, id, text }`、头部指令注释 `// @lang: / @id: / @version:`、
 *   `text` 与之逐字节一致、三键缺失/方言不符/未知 id → 响亮拒绝（结构化错误，非静默兜底）；
 * - docs/adr/0001-vfsl-single-source-of-truth.md → 修订节「脚手架纪律」：一切消费方经
 *   SchemaSource 接缝取文本，阶段实现 = 仓内文件源（FileSchemaSource 本体）；
 * - docs/vfsl/v1-spec.md → §1 注记 9/10：行注释是词法级 trivia，不出现在任何语法产生式
 *   右部，因此带头部指令注释的 `.vfsl` 文本可直接被 `parseVfsl` 解析，零预处理；
 * - CONTEXT.md → 信封/方言/脚手架纪律用词。
 *
 * F1 当前状态下被测切面尚不存在 → 本文件 `import { FileSchemaSource, ... } from '../src/index.js'`
 * 在 import 阶段即抛出「不存在导出」错误 → 整个文件必然全红（构造性红灯论证，见简报记录）。
 *
 * 契约定形（本文件是 SA3 实现的唯一行为锚点）：
 * - 接缝经 `../src/index.js` 公共入口导出（与既有 parseVfsl 同入口新增导出，不新建公共面）；
 * - `load(id)` 与 `list()` 均返回 Promise（ADR §1 async-from-day-one）；
 * - `load(id)` 成功返回**完整信封** `{ lang, version, id, text }`，非裸文本；
 * - 响亮失败经 Promise **rejection** 传递（`load` 签名返回 `Promise<SchemaEnvelope>`，
 *   非结果联合，故拒绝走 reject 而非 `{ok:false}`）；reject 值为带判别字段的**结构化错误**
 *   （`kind` + `code`）：`missing-directive` / `dialect-mismatch` / `unknown-id`，**绝不静默兜底**
 *   （不 resolve 降级值、不吞错）；
 * - `FileSchemaSource` 构造入参为领域根（目录下含 `domains/<domain>/`），扫描 `domains/<domain>/` 下全部 `.vfsl`。
 */
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSchemaSource, parseVfsl } from '../src/index.js';

/** ADR 0005 §1 结冻结的接缝形状（公共契约）。 */
interface SchemaSource {
  load(id: string): Promise<SchemaEnvelope>;
  list(): Promise<string[]>;
}

/** CONTEXT.md / ADR 0005 结冻结的信封形状。 */
interface SchemaEnvelope {
  lang: string;
  version: number;
  id: string;
  text: string;
}

/** 响亮拒绝的结构化错误契约（判别字段 kind + code，SA3 必须遵守）。 */
interface SchemaSourceError extends Error {
  kind: 'schema-source';
  code: 'missing-directive' | 'dialect-mismatch' | 'unknown-id';
  id?: string;
}

/**
 * hermetic fixture：在临时目录中内联生成 `domains/<domain>/` 结构，全部文件内容由测试自行写入，
 * 不依赖仓内尚不存在的 `domains/` 真实文件、不依赖网络/端口、不新增 npm 依赖（node 内置只用）。
 */
async function makeDomainsFixture(): Promise<{
  root: string;
  domainsDir: string;
  files: Record<'assets' | 'audit', { id: string; rel: string; body: string }>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'vfsl-schemasource-'));
  const domainsDir = join(root, 'domains');

  const files = {
    assets: {
      id: 'vfs3.assets@1',
      rel: 'vfs3.assets/schema.vfsl',
      body: [
        '// @lang: vfsl',
        '// @id: vfs3.assets@1',
        '// @version: 1',
        '',
        '/** vfs3.assets — 资产领域 */',
        'type Info = { name: string; size?: number };',
        'type ROOT = {};',
        '',
      ].join('\n'),
    },
    audit: {
      id: 'vfs3.audit@1',
      rel: 'vfs3.audit/schema.vfsl',
      body: [
        '// @lang: vfsl',
        '// @id: vfs3.audit@1',
        '// @version: 1',
        '',
        '/** vfs3.audit — 审计领域 */',
        'type ROOT = {};',
        '',
      ].join('\n'),
    },
  };

  for (const f of Object.values(files)) {
    const parent = join(domainsDir, f.rel.split('/')[0] as string);
    await mkdir(parent, { recursive: true });
    await writeFile(join(domainsDir, f.rel), f.body, 'utf8');
  }

  return {
    root,
    domainsDir,
    files: files as Record<'assets' | 'audit', { id: string; rel: string; body: string }>,
  };
}

/** 断言 reject 的是我们契约定义的结构化扇亮失败错误。 */
async function expectStructuredReject(
  promise: Promise<SchemaEnvelope>,
  code: SchemaSourceError['code'],
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(Error);
  await expect(promise).rejects.toMatchObject({ kind: 'schema-source', code });
}

describe('AC1 — 接缝形状：async、完整信封、list 枚举', () => {
  it('FileSchemaSource 暴露 load 与 list，二者均返回 Promise（async from day one）', async () => {
    const fx = await makeDomainsFixture();
    const source: SchemaSource = new FileSchemaSource(fx.root);

    // 用返回值类型证明 async：实例化后 load/list 必为函数且返回 Promise
    const listPromise = source.list();
    expect(listPromise).toBeInstanceOf(Promise);
    const loadPromise = source.load('vfs3.assets@1');
    expect(loadPromise).toBeInstanceOf(Promise);

    await listPromise;
    await loadPromise;
  });

  it('load(id) 返回完整信封 { lang, version, id, text }，非裸文本', async () => {
    const fx = await makeDomainsFixture();
    const source: SchemaSource = new FileSchemaSource(fx.root);

    const env = await source.load('vfs3.assets@1');

    expect(env).toBeTypeOf('object');
    expect(env).toEqual(
      expect.objectContaining({
        lang: 'vfsl',
        version: 1,
        id: 'vfs3.assets@1',
        text: expect.any(String) as unknown,
      }),
    );
    // 信封恰好四键，不夹带额外成员（形状被 frozen）
    expect(Object.keys(env).sort()).toEqual(['id', 'lang', 'text', 'version']);
  });

  it('list() 枚举 domains/*/ 下多个 .vfsl 的 id', async () => {
    const fx = await makeDomainsFixture();
    const source: SchemaSource = new FileSchemaSource(fx.root);

    const ids = await source.list();

    expect(ids).toContain('vfs3.assets@1');
    expect(ids).toContain('vfs3.audit@1');
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AC2a — 响亮拒绝：头部三键缺失（逐键缺 / 全缺 / 未知且缺失）', () => {
  it('缺 lang：load 拒绝为 missing-directive 结构化错误，不静默兜底', async () => {
    const fx = await makeDomainsFixture();
    const domainsDir = join(fx.root, 'domains');
    const rel = 'broken.lang/schema.vfsl';
    await mkdir(join(domainsDir, rel.split('/')[0]!), { recursive: true });
    // 缺 `// @lang: `，其余两键在
    await writeFile(
      join(domainsDir, rel),
      [
        '// @id: broken.lang@1',
        '// @version: 1',
        'type ROOT = {};',
        '',
      ].join('\n'),
      'utf8',
    );

    const source: SchemaSource = new FileSchemaSource(fx.root);
    await expectStructuredReject(source.load('broken.lang@1'), 'missing-directive');
  });

  it('缺 id：load 拒绝为 missing-directive 结构化错误', async () => {
    const fx = await makeDomainsFixture();
    const domainsDir = join(fx.root, 'domains');
    await mkdir(join(domainsDir, 'broken.id'), { recursive: true });
    // 缺 `// @id: `，其余两键在
    await writeFile(
      join(domainsDir, 'broken.id/schema.vfsl'),
      [
        '// @lang: vfsl',
        '// @version: 1',
        'type ROOT = {};',
        '',
      ].join('\n'),
      'utf8',
    );

    const source: SchemaSource = new FileSchemaSource(fx.root);
    await expectStructuredReject(source.load('broken.id@1'), 'missing-directive');
  });

  it('缺 version：load 拒绝为 missing-directive 结构化错误', async () => {
    const fx = await makeDomainsFixture();
    const domainsDir = join(fx.root, 'domains');
    await mkdir(join(domainsDir, 'broken.version'), { recursive: true });
    // 缺 `// @version: `，其余两键在
    await writeFile(
      join(domainsDir, 'broken.version/schema.vfsl'),
      [
        '// @lang: vfsl',
        '// @id: broken.version@1',
        'type ROOT = {};',
        '',
      ].join('\n'),
      'utf8',
    );

    const source: SchemaSource = new FileSchemaSource(fx.root);
    await expectStructuredReject(source.load('broken.version@1'), 'missing-directive');
  });

  it('头部三键全缺：load 绝不静默兜底，必以结构化错误拒绝（missing-directive 或 unknown-id）', async () => {
    const fx = await makeDomainsFixture();
    const domainsDir = join(fx.root, 'domains');
    await mkdir(join(domainsDir, 'broken.all'), { recursive: true });
    await writeFile(
      join(domainsDir, 'broken.all/schema.vfsl'),
      [
        '/** 没有任何头部指令注释 */',
        'type ROOT = {};',
        '',
      ].join('\n'),
      'utf8',
    );

    const source: SchemaSource = new FileSchemaSource(fx.root);
    // 全缺时文件无从注册 id；用（若声明过则）对应的 id 去 load —— 契约要点是「绝不 resolve 完整信封」，
    // 必须以带 kind 判别字段的结构化错误拒绝（SA3 可落地为 missing-directive 或 unknown-id 任一，皆响亮）。
    const promise = source.load('broken.all@1');
    await expect(promise).rejects.toBeInstanceOf(Error);
    await expect(promise).rejects.toMatchObject({ kind: 'schema-source' });
  });
});

describe('AC2b — 响亮拒绝：方言不符（lang 或 version 非契约值）', () => {
  it('lang !== vfsl：load 拒绝为 dialect-mismatch 结构化错误', async () => {
    const fx = await makeDomainsFixture();
    const domainsDir = join(fx.root, 'domains');
    await mkdir(join(domainsDir, 'mismatch.lang'), { recursive: true });
    await writeFile(
      join(domainsDir, 'mismatch.lang/schema.vfsl'),
      [
        '// @lang: yaml',
        '// @id: mismatch.lang@1',
        '// @version: 1',
        'type ROOT = {};',
        '',
      ].join('\n'),
      'utf8',
    );

    const source: SchemaSource = new FileSchemaSource(fx.root);
    await expectStructuredReject(source.load('mismatch.lang@1'), 'dialect-mismatch');
  });

  it('version !== 1：load 拒绝为 dialect-mismatch 结构化错误', async () => {
    const fx = await makeDomainsFixture();
    const domainsDir = join(fx.root, 'domains');
    await mkdir(join(domainsDir, 'mismatch.version'), { recursive: true });
    await writeFile(
      join(domainsDir, 'mismatch.version/schema.vfsl'),
      [
        '// @lang: vfsl',
        '// @id: mismatch.version@1',
        '// @version: 2',
        'type ROOT = {};',
        '',
      ].join('\n'),
      'utf8',
    );

    const source: SchemaSource = new FileSchemaSource(fx.root);
    await expectStructuredReject(source.load('mismatch.version@1'), 'dialect-mismatch');
  });
});

describe('AC2c — 响亮拒绝：未知 id', () => {
  it('load 未知 id（不在任何头部注册）：拒绝为 unknown-id 结构化错误', async () => {
    const fx = await makeDomainsFixture();
    const source: SchemaSource = new FileSchemaSource(fx.root);

    await expectStructuredReject(source.load('no.such.domain@1'), 'unknown-id');
  });
});

describe('AC3 — trivia 性质：带头部指令注释的 .vfsl 文本 parseVfsl 直接 ok', () => {
  it('带 // @lang/@id/@version 头部的合法 vfsl 文本，parseVfsl 直接 ok，零预处理零微格式', () => {
    const text = [
      '// @lang: vfsl',
      '// @id: vfs3.assets@1',
      '// @version: 1',
      '',
      '/** vfs3.assets — 资产领域 */',
      'type Info = { name: string; size?: number };',
      'type ROOT = {};',
      '',
    ].join('\n');

    const result = parseVfsl(text);
    // 行注释是词法级 trivia（v1-spec 注记 9/10），不出现在语法产生式右部 → 解析必须成功
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`期望 ok: true，实际 ok: false（issues: ${JSON.stringify(result.issues)}）`);
    }
    // 最小锚点：模块确实表达了 ROOT 与 Info 别名（不锁 IR 内部形状）
    expect(JSON.stringify(result.module)).toContain('Info');
  });
});

describe('AC4 — text 与文件原文逐字节一致；id/version 解析自头部', () => {
  it('text === 文件原文（含头部，逐字节一致，内容哈希可直接）', async () => {
    const fx = await makeDomainsFixture();
    const source: SchemaSource = new FileSchemaSource(fx.root);

    const env = await source.load('vfs3.assets@1');

    // fixture 写盘用的正是同一 body → 逐字节一致
    expect(env.text).toBe(fx.files.assets.body);
    // text 必须包含头部（不是剥离头部的裸正文）
    expect(env.text).toContain('// @lang: vfsl');
    expect(env.text).toContain('// @id: vfs3.assets@1');
    expect(env.text).toContain('// @version: 1');
  });

  it('id 与 version 解析自头部，而非硬编码', async () => {
    const fx = await makeDomainsFixture();
    const source: SchemaSource = new FileSchemaSource(fx.root);

    const env = await source.load('vfs3.audit@1');

    expect(env.id).toBe('vfs3.audit@1');
    expect(env.version).toBe(1);
    expect(env.lang).toBe('vfsl');
    // version 是数值类型（信封契约），不是字符串
    expect(env.version).toBeTypeOf('number');
  });
});

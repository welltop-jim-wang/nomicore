/**
 * SA6 红灯契约 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）Suite D。
 *
 * 契约来源：`wiki/raw/task_issue-309_sa6_contract.md` §12.2（逐字转写）+ §12.1（冻结
 * 运行时观察）+ 设计 `wiki/raw/task_issue-309_design.md` §7-D4/D7/D8。AC1/AC2/AC3/AC4
 * 的可执行判据：文档面（v1-spec §5、编写指南 §7/§8/检查表）即交付物本体。
 *
 * 判据形态（SA6 §12.2）：
 * - D1：§5 四类锚位 + M4 子规则 20 needle 事实链齐备（合取）；
 * - D2：§5 `vfsl` 示例块 ≥1、每块经 wrapper 规则 `parseVfsl`+`evaluate` 双 ok、
 *   至少一块 `memberDocs` 非空、逐块自跟随核对（期望值取自文档自身）；
 * - D3：指南 §7/§8 各自恰一个 `vfsl` 块、双 ok、块内成员 doc-`|` 配对 ≥2、自跟随
 *   `memberDocs` 核对（逐块谓词，不弱化为按节聚合）；
 * - D3b：钉住含「必须紧邻」的挂载目标句本身（四类挂载目标齐备）；
 * - D4：提交前检查表至少一条覆盖 M4；
 * - D5：① tracked − `wiki/` − `dist/` 的旧措辞计数必须为 0（needle 以 join 构造防自命中）；
 *   ② `git diff --check` exit 0 且 stdout 空。
 *
 * 断言纪律：无 skip/only/todo/env override/fallback；D2/D3 经真实公共入口
 * `parseVfsl` → `evaluate` 执行，期望值取自文档自身（自跟随），失败 loud。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluate, parseVfsl } from '../src/index.js';
import type { DerivedSchema } from '../src/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPEC = 'docs/vfsl/v1-spec.md';
const GUIDE = 'docs/vfsl/schema-authoring-guide.md';

// —— 通用工具（SA6 §12.2「通用工具」）——

function readSection(file: string, startHeading: string, endHeading: string): string {
  const lines = readFileSync(join(repoRoot, file), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith(startHeading));
  if (start < 0) throw new Error(`${file} 缺少起始标题「${startHeading}」`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith(endHeading));
  if (end < 0) throw new Error(`${file} 缺少结束标题「${endHeading}」`);
  return lines.slice(start, end).join('\n');
}

/** 提取围栏块正文（不含围栏行）；未闭合即 loud。 */
function fencedBlocks(section: string, lang: string): string[] {
  const lines = section.split('\n');
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (current === null) {
      if (line.trim() === '```' + lang) current = [];
      continue;
    }
    if (line.trim() === '```') {
      blocks.push(current.join('\n'));
      current = null;
      continue;
    }
    current.push(line);
  }
  if (current !== null) throw new Error(`未闭合的 \`\`\`${lang} 围栏块`);
  return blocks;
}

/** 显式 wrapper 规则：块内无 `type ROOT` 声明时前置 `type ROOT = {};`（§7/§5 片段）。 */
function execBlock(block: string): DerivedSchema {
  const text = /\btype\s+ROOT\b/.test(block) ? block : `type ROOT = {};\n${block}`;
  const parsed = parseVfsl(text);
  if (!parsed.ok) {
    expect.fail(`parseVfsl 必须 ok（wrapper 规则后）：${JSON.stringify(parsed.issues)}`);
  }
  const evaluated = evaluate(parsed.module);
  if (!evaluated.ok) {
    expect.fail(`evaluate 必须 ok（wrapper 规则后）：${JSON.stringify(evaluated.issues)}`);
  }
  return evaluated.derived;
}

interface DocPipePair {
  /** doc 行去掉前缀 `/**` 与后缀 `*​/` 后的逐字原文（与 parser 捕获值逐字相等）。 */
  doc: string;
}

/**
 * 自跟随配对谓词（SA6 §12.2 精确化）：trimStart 后以 `/**` 开头且以 `*​/` 结尾的单行
 * doc，其下一非空行 trimStart 后首字符为 `|`。
 */
function docPipePairs(block: string): DocPipePair[] {
  const lines = block.split('\n');
  const pairs: DocPipePair[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trimStart();
    if (!line.startsWith('/**') || !line.endsWith('*/') || line.length < 5) continue;
    let j = i + 1;
    while (j < lines.length && (lines[j] ?? '').trim() === '') j += 1;
    const next = (lines[j] ?? '').trimStart();
    if (!next.startsWith('|')) continue;
    pairs.push({ doc: line.slice(3, -2) });
  }
  return pairs;
}

function memberDocValues(derived: DerivedSchema): string[] {
  const values: string[] = [];
  for (const docs of Object.values(derived.memberDocs ?? {})) values.push(...docs);
  return values;
}

// —— D1 needle 契约（SA6 §12.2 D1：20 needle，合取）——

const ANCHOR_NEEDLES = ['四类', '类型别名', '属性', '标记类型', '联合成员'] as const;

const SUBRULE_CHAINS: readonly (readonly string[])[] = [
  ['前导', '|', '锚位'],
  ['首成员', '起始记号'],
  ['连续', '同一成员'],
  ['坍缩', 'E305'],
  ['夹缝', 'E305'],
  ['优先', '不双挂'],
  ['既有', '不变'],
];

describe('Suite D — issue #309 文档契约（v1-spec §5 四类锚位 + M4）', () => {
  it('D1 §5 四类锚位 + M4 子规则 20 needle 事实链齐备', () => {
    const section = readSection(SPEC, '## 5.', '## 6.');
    const missing: string[] = [];
    for (const needle of ANCHOR_NEEDLES) {
      if (!section.includes(needle)) missing.push(needle);
    }
    for (const chain of SUBRULE_CHAINS) {
      if (!chain.every((needle) => section.includes(needle))) missing.push(chain.join('+'));
    }
    expect(missing, '§5 缺失要素').toEqual([]);
  });

  it('D2 §5 联合成员挂载示例：块 ≥1、逐块双 ok、memberDocs 非空、自跟随核对', () => {
    const section = readSection(SPEC, '## 5.', '## 6.');
    const blocks = fencedBlocks(section, 'vfsl');
    expect(blocks.length, '§5 至少一个 ```vfsl 示例块').toBeGreaterThanOrEqual(1);

    const derivedList = blocks.map((block) => execBlock(block));
    expect(
      derivedList.some((derived) => memberDocValues(derived).length > 0),
      '§5 至少一块的 memberDocs 存在非空条目',
    ).toBe(true);

    let pairCount = 0;
    for (let i = 0; i < blocks.length; i += 1) {
      const pairs = docPipePairs(blocks[i] ?? '');
      pairCount += pairs.length;
      const values = memberDocValues(derivedList[i] as DerivedSchema);
      const missing = pairs.filter((pair) => !values.includes(pair.doc)).map((pair) => pair.doc);
      expect(missing, `§5 第 ${i + 1} 个 vfsl 块的成员 doc 未出现在 memberDocs 值中`).toEqual([]);
    }
    expect(pairCount, '§5 联合成员示例须采用多行前导 `|` 布局（doc-`|` 对 ≥1）').toBeGreaterThanOrEqual(1);
  });
});

describe('Suite D — issue #309 指南契约（§7/§8 逐成员 doc、挂载目标句、检查表）', () => {
  it('D3 指南 §7/§8 示例：逐块恰一块、双 ok、逐块 doc-`|` 配对 ≥2、自跟随 memberDocs', () => {
    const sections: readonly (readonly [string, string])[] = [
      ['§7', readSection(GUIDE, '### 7.', '### 8.')],
      ['§8', readSection(GUIDE, '### 8.', '## v1 语法护栏')],
    ];
    for (const [label, section] of sections) {
      const blocks = fencedBlocks(section, 'vfsl');
      expect(blocks.length, `${label} 恰含一个 \`\`\`vfsl 示例块（旧示例块替换，非增补）`).toBe(1);
      const block = blocks[0] as string;
      const derived = execBlock(block);
      const pairs = docPipePairs(block);
      expect(pairs.length, `${label} 块内成员 doc-\`|\` 配对须 ≥2`).toBeGreaterThanOrEqual(2);
      const values = memberDocValues(derived);
      const missing = pairs.filter((pair) => !values.includes(pair.doc)).map((pair) => pair.doc);
      expect(missing, `${label} 成员 doc 未出现在 memberDocs 值中`).toEqual([]);
    }
  });

  it('D3b 挂载目标句（含「必须紧邻」）已四类化并含「联合成员」', () => {
    const text = readFileSync(join(repoRoot, GUIDE), 'utf8');
    const index = text.indexOf('必须紧邻');
    expect(index, '指南正文须存在含「必须紧邻」的挂载目标句').toBeGreaterThanOrEqual(0);

    const from = text.lastIndexOf('\n\n', index);
    const to = text.indexOf('\n\n', index);
    const paragraph = text.slice(from < 0 ? 0 : from + 2, to < 0 ? text.length : to);
    for (const needle of ['类型别名', '对象字段', '标记类型', '联合成员']) {
      expect(paragraph, `挂载目标句须含「${needle}」`).toContain(needle);
    }
  });

  it('D4 提交前检查表覆盖 M4（联合/枚举 × 成员 × JSDoc/文档注释）', () => {
    const text = readFileSync(join(repoRoot, GUIDE), 'utf8');
    const start = text.indexOf('## 提交前检查表');
    expect(start, '指南须含「提交前检查表」').toBeGreaterThanOrEqual(0);
    const items = text
      .slice(start)
      .split('\n')
      .filter((line) => line.trimStart().startsWith('- [ ]'));
    const hits = items.filter(
      (item) =>
        (item.includes('联合') || item.includes('枚举')) &&
        item.includes('成员') &&
        (item.includes('JSDoc') || item.includes('文档注释')),
    );
    expect(hits.length, '检查表须至少一条覆盖逐成员 doc 的条目').toBeGreaterThanOrEqual(1);
  });
});

describe('Suite D — issue #309 措辞清扫与 diff 卫生', () => {
  it('D5① 旧措辞在 tracked − wiki/ − dist/ 内无残留', () => {
    const needle = ['三', '锚位'].join('');
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const scoped = out
      .split('\0')
      .filter((file) => file.length > 0)
      .filter((file) => !file.startsWith('wiki/') && !file.startsWith('dist/') && !file.includes('/dist/'));

    const hits: string[] = [];
    for (const file of scoped) {
      const buffer = readFileSync(join(repoRoot, file));
      if (buffer.includes(0)) continue; // 二进制跳过
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        continue; // 非 UTF-8 文本跳过
      }
      const count = content.split(needle).length - 1;
      if (count > 0) hits.push(`${file}(${count})`);
    }
    expect(hits, '旧措辞残留').toEqual([]);
  });

  it('D5② git diff --check 干净', () => {
    const result = spawnSync('git', ['diff', '--check'], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.error, `git diff --check 无法执行：${result.error?.message ?? ''}`).toBeUndefined();
    expect(
      result.status,
      `git diff --check 退出码非零：${result.stdout ?? ''}${result.stderr ?? ''}`,
    ).toBe(0);
    expect(result.stdout, 'git diff --check stdout 须为空').toBe('');
  });
});

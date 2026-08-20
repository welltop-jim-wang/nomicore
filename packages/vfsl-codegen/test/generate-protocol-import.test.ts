/**
 * SA6 红灯测试 — Issue #45 契约①（AC-1/AC-2）：生成器对任意域（含零别名域）恒定发射
 * `import type { PathSchema } from '@nomicore/vfsl-protocol';`，生成物原样（孤立 program）
 * `tsc --noEmit` 可编译（N1 缺 import 行 TS2304/TS2664 + N2 零别名域 script 退化遮蔽协议
 * 模块 TS2305 的双愈锚）。
 *
 * 缺陷实证（SA5 报告 §Reproduction，本 worktree 基点 5907dc3 复现确认）：
 * - N1：生成物段②/段③ 引用 `PathSchema<…>` 但全文无 import → 孤立 program TS2304 ×3 +
 *   TS2664（增广目标不在 program）；
 * - N2：零别名域（aliases 仅 ROOT）生成物无 export 语句 → script 形 → `declare module`
 *   退化为整体环境声明并遮蔽真实协议模块 → 同 program 消费方 `import { PathAt }` TS2305。
 * 修复契约（AC-1 字面 + Owner 裁定）：任意域生成物首非注释行 = 该 import 行（一贴即 module，
 * 双愈 N1/N2）；孤立 program 编译零诊断。
 *
 * 红灯现状（实测）：两 fixture 生成物均无 import 行（首非注释行 = `export type Box …` /
 * `declare module …`）→ 文案断言红；孤立 program 诊断 4 条（n1 形态）/ 3 条（n2 形态 +
 * 消费方）→ 编译断言红。绿灯形态 = SA5 p1-fixed/p2-fixed 对照（手工补一行 import 即 0 诊断，
 * probe4 复验）——本文件断言即该对照的自动化。
 *
 * 断言对象 = `generateProjection` 的发射输出与生成物的**编译行为**（可观测运行时行为），
 * 不读生成器源码、不 grep 源码文本。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import { generateProjection } from '@nomicore/vfsl-codegen';
import type * as TS from 'typescript';
import { formatDiagnostics, preEmitDiagnostics, ts } from './tsc-helper.js';

/** AC-1 字面冻结的 import 行（任意域恒定发射的完整行文本）。 */
const IMPORT_LINE = `import type { PathSchema } from '@nomicore/vfsl-protocol';`;

/** 具名别名域（N1 形态）：段② export 别名 + 段③ 增广均引用 PathSchema。 */
const ALIAS_FIXTURE = `/** 根 */
type ROOT = YMap<{ label: YLeaf<string>; box: Box }>;
type Box = YMap<{ n: YLeaf<number> }>;
`;

/** 零别名域（N2 形态）：aliases 仅 ROOT——ADR-0003 最小合法域。 */
const ZERO_ALIAS_FIXTURE = `type ROOT = { label: string };
`;

/** 协议消费方（N2 遮蔽实证的他文件：同 program 内 import 协议导出）。 */
const CONSUMER_FIXTURE = `import { PathAt, VfslKind } from '@nomicore/vfsl-protocol';
export type K = VfslKind;
export type P = PathAt<import('@nomicore/vfsl-protocol').VfslPathMap, ['label']>;
`;

function derive(fixture: string): import('@nomicore/vfsl').DerivedSchema {
  const parsed = parseVfsl(fixture);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`parseVfsl 失败：${JSON.stringify(parsed.issues)}`);
  const result = evaluate(parsed.module);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`evaluate 失败：${JSON.stringify(result.issues)}`);
  return result.derived;
}

/** 生成物首个非注释行（剥头注块后首非空行）——AC-1 锚点「首非注释行 = import 行」。 */
function firstCodeLine(out: string): string {
  const lines = out.split('\n');
  const headerEnd = lines.findIndex((l) => l.trim() === '*/');
  const body = headerEnd === -1 ? lines : lines.slice(headerEnd + 1);
  return body.map((l) => l.trim()).find((l) => l !== '') ?? '';
}

/** 把若干文本文件写进临时目录并对全部 rootNames 建孤立 program 编译；返回诊断 + 清理。 */
function compileInTempDir(files: Array<{ name: string; text: string }>): {
  diagnostics: readonly TS.Diagnostic[];
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'vfsl-codegen-tsc-'));
  const rootNames = files.map((f) => {
    const p = join(dir, f.name);
    writeFileSync(p, f.text, 'utf8');
    return p;
  });
  return {
    diagnostics: preEmitDiagnostics(rootNames),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('AC-1/AC-2 — 生成器对任意域恒定发射协议 import 行（文案锚，含零别名域）', () => {
  it('具名别名域：生成物首非注释行 = import type { PathSchema } from \'@nomicore/vfsl-protocol\';', () => {
    const out = generateProjection(derive(ALIAS_FIXTURE), { sourceText: ALIAS_FIXTURE });
    expect(typeof out).toBe('string');
    expect(firstCodeLine(out)).toBe(IMPORT_LINE);
  });

  it('零别名域（aliases 仅 ROOT）：同样恒定发射 import 行（N2 script 退化双愈锚）', () => {
    const out = generateProjection(derive(ZERO_ALIAS_FIXTURE), { sourceText: ZERO_ALIAS_FIXTURE });
    expect(typeof out).toBe('string');
    expect(firstCodeLine(out)).toBe(IMPORT_LINE);
  });

  it('import 行全文恰好一条（任意域不重复、不缺失）', () => {
    for (const fx of [ALIAS_FIXTURE, ZERO_ALIAS_FIXTURE]) {
      const out = generateProjection(derive(fx), { sourceText: fx });
      const matches = out.match(/^import type \{ PathSchema \} from '@nomicore\/vfsl-protocol';$/gm) ?? [];
      expect(matches).toHaveLength(1);
    }
  });
});

describe('AC-1 — 生成物原样（孤立 program）tsc --noEmit 可编译（编译级锚）', () => {
  it('具名别名域生成物孤立编译零诊断（N1：TS2304/TS2664 治愈锚）', () => {
    const out = generateProjection(derive(ALIAS_FIXTURE), { sourceText: ALIAS_FIXTURE });
    const { diagnostics, cleanup } = compileInTempDir([{ name: 'generated.ts', text: out }]);
    try {
      expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it('零别名域生成物 + 协议消费方同 program 编译零诊断（N2：script 遮蔽治愈锚——消费方不被毒化）', () => {
    const out = generateProjection(derive(ZERO_ALIAS_FIXTURE), { sourceText: ZERO_ALIAS_FIXTURE });
    const { diagnostics, cleanup } = compileInTempDir([
      { name: 'generated.ts', text: out },
      { name: 'consumer.ts', text: CONSUMER_FIXTURE },
    ]);
    try {
      expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

/**
 * SA6 红灯测试 — Issue #45 契约③（AC-4）：emitter.ts 三处错误消息尾串「由总控开后续票
 * 登记」→「见 #44」（Owner 裁定 3；SA5 E8 定位：UnsupportedRootShapeError /
 * UnsupportedRootReferenceError / UnsupportedUnionKindError 三消息，L39/L58/L76）。
 *
 * 测试锚 = 三类错误的**运行时消息文本**（驱动真实生成路径捕获 err.message 断言尾串），
 * 非源码 grep——错误消息是用户可见的诊断输出（CLI 顶层 catch 原样进 stderr），属可观测
 * 行为。三条触发路径的 fixture 均经本 worktree 实测钉死（probe1/probe2）：
 * - UnsupportedRootShapeError：联合形 ROOT（F2 仅支持封闭 map 形）；
 * - UnsupportedRootReferenceError：死别名 X 字段引用 ROOT（值侧 ref 目标 = ROOT，检查点①；
 *   注意 `type X = ROOT` 直引会被解析层 E106 循环拒绝，本形态不构成循环）；
 * - UnsupportedUnionKindError：map 别名 | array 别名 异形联合（E309 只拒标量×容器，
 *   map×array 合法存在——既有 generate-discriminated-emission.test.ts L140 同款 fixture）。
 *
 * 红灯现状（实测）：三条消息尾串均为「由总控开后续票登记」→ endsWith('见 #44') 全红；
 * CLI 端异形 ROOT 域 stderr 尾串同红。绿灯 = 尾串替换为「见 #44」（前缀已被既有契约
 * 断言锚定，尾串替换零既有测试风险——SA5 锚点建议 3）。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, parseVfsl } from '@nomicore/vfsl';
import { generateProjection } from '@nomicore/vfsl-codegen';
import { repoRoot } from './tsc-helper.js';

/** AC-4 冻结的尾串。 */
const TAIL = '见 #44';

/** 联合形 ROOT → UnsupportedRootShapeError。 */
const ROOT_SHAPE_FIXTURE = `type ROOT = YMap<{ a: YLeaf<string> }> | YMap<{ b: YLeaf<number> }>;
`;

/** 死别名 X 的字段引用 ROOT（值侧 ref 目标 = ROOT）→ UnsupportedRootReferenceError。 */
const ROOT_REF_FIXTURE = `type ROOT = YMap<{ a: YLeaf<string> }>;
type X = YMap<{ r: ROOT }>;
`;

/** map 别名 | array 别名 异形联合 → UnsupportedUnionKindError。 */
const UNION_KIND_FIXTURE = `type A = YMap<{ x: YLeaf<string> }>; type B = YArray<YLeaf<number>>; type ROOT = YMap<{ u: A | B }>;
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

/** 驱动 generateProjection 到抛错，返回错误（未抛 → 断言失败）。 */
function captureError(fixture: string): Error {
  let err: unknown = null;
  try {
    generateProjection(derive(fixture), { sourceText: fixture });
  } catch (e) {
    err = e;
  }
  expect(err, '应抛错（fixture 触发对应 emitter 错误）').toBeInstanceOf(Error);
  return err as Error;
}

describe('AC-4 — emitter 三处错误消息尾串「见 #44」（生成器级）', () => {
  it('UnsupportedRootShapeError：消息尾串 = 见 #44', () => {
    const err = captureError(ROOT_SHAPE_FIXTURE);
    expect(err.name).toBe('UnsupportedRootShapeError');
    expect(err.message.endsWith(TAIL)).toBe(true);
  });

  it('UnsupportedRootReferenceError：消息尾串 = 见 #44', () => {
    const err = captureError(ROOT_REF_FIXTURE);
    expect(err.name).toBe('UnsupportedRootReferenceError');
    expect(err.message.endsWith(TAIL)).toBe(true);
  });

  it('UnsupportedUnionKindError：消息尾串 = 见 #44', () => {
    const err = captureError(UNION_KIND_FIXTURE);
    expect(err.name).toBe('UnsupportedUnionKindError');
    expect(err.message.endsWith(TAIL)).toBe(true);
  });
});

describe('AC-4 — CLI 端到端：错误消息尾串经结构化 stderr 可见（exit 2）', () => {
  it('异形 ROOT 域经 pnpm generate → exit 2 且 stderr 消息尾串 = 见 #44', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vfsl-codegen-tail-'));
    const domainDir = join(dir, 'domains', 'unionroot');
    await mkdir(domainDir, { recursive: true });
    await writeFile(
      join(domainDir, 'schema.vfsl'),
      `// @lang: vfsl\n// @id: unionroot@1\n// @version: 1\n${ROOT_SHAPE_FIXTURE}`,
      'utf8',
    );
    const r = spawnSync('pnpm', ['generate', '--domains', dir], { cwd: repoRoot, encoding: 'utf8' });
    const stderr = r.stderr ?? '';
    expect(r.status, `exit 应为 2（硬错误通道），实际 ${String(r.status)}；stderr: ${stderr}`).toBe(2);
    expect(stderr.trim().endsWith(TAIL)).toBe(true);
  });
});

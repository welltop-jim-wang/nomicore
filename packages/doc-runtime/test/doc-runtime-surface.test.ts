/**
 * SA6 红灯锚定 — issue #111：@nomicore/doc-runtime 公共入口新增
 * `createInitialDocument` 的 surface / declaration 审计（设计 §2.2/§6/§8/§9；
 * 冲突报告新攻击面-2 的独立 API/surface 测试）。
 *
 * 契约来源：
 * - 设计 §2.2：doc-runtime 主入口增加值导出 createInitialDocument 与其输入/结果
 *   类型（自持 new Y.Doc()，Registry 永不获得失败时的 partial doc）；
 * - 设计 §8：Registry 主入口不得 re-export 或经 type alias 间接可达该 seam；
 *   doc-runtime 自身主入口**可合法**出现 Y.Doc（createInitialDocument 返回值）——
 *   本文件对 doc-runtime 侧做「合法 Y.Doc surface」的独立审计；
 * - 冲突报告 MINOR-10 / 新攻击面-2：package 级公共扩张应有独立 API/surface 测试。
 *
 * 断言面：
 * - 运行时值：主入口命名空间存在 createInitialDocument 且为函数（红灯：基线未导出）；
 * - declaration emit（ts compiler API 实际产出 .d.ts）：主入口可达声明图包含
 *   createInitialDocument 文本、且含 Y.Doc（doc-runtime 自身合法出现——对照
 *   namespace-registry 的禁词审计，本包是正向 fixture）；
 * - 主入口声明不出现 namespace-registry 内部 subpath / 其它跨包内部通道。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as docRuntime from '../src/index.js';

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
const ns = docRuntime as Record<string, unknown>;

describe('doc-runtime 公共入口：createInitialDocument 值导出（§2.2）', () => {
  it('主入口存在 createInitialDocument 值导出且为函数', () => {
    expect(Object.prototype.hasOwnProperty.call(ns, 'createInitialDocument')).toBe(true);
    expect(typeof ns.createInitialDocument).toBe('function');
  });
});

describe('declaration emit：doc-runtime 主入口合法出现 createInitialDocument 与 Y.Doc（§8 正向 fixture）', () => {
  function emitDeclarations(): { entry: string; files: string[] } {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-runtime-dts-'));
    const configPath = path.join(PKG_DIR, 'tsconfig.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      PKG_DIR,
      undefined,
      configPath,
    );
    parsed.options.noEmit = false;
    parsed.options.declaration = true;
    parsed.options.emitDeclarationOnly = true;
    parsed.options.outDir = outDir;
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const emitResult = program.emit();
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .concat(emitResult.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error));
    expect(
      errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')),
      `declaration emit 必须零错误：${parsed.fileNames.join(',')}`,
    ).toEqual([]);
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.d.ts')) files.push(full);
      }
    };
    walk(outDir);
    const entry = files.find((f) => f.endsWith('index.d.ts'));
    expect(entry, '必须产出 index.d.ts').toBeDefined();
    return { entry: entry ?? '', files };
  }

  /** 从入口 .d.ts 出发按相对 specifier BFS 收集本包可达声明文件。 */
  function reachableFrom(entryFile: string, emitted: string[]): string[] {
    const set = new Set<string>([entryFile]);
    const queue = [entryFile];
    while (queue.length > 0) {
      const file = queue.shift() as string;
      const text = fs.readFileSync(file, 'utf8');
      const specifiers: string[] = [];
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
      const visit = (node: ts.Node): void => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier !== undefined &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          specifiers.push(node.moduleSpecifier.text);
        }
        node.forEachChild(visit);
      };
      sf.forEachChild(visit);
      for (const spec of specifiers) {
        if (!spec.startsWith('.')) continue;
        const base = spec.replace(/\.js$/, '');
        const candidate = path.normalize(path.join(path.dirname(file), `${base}.d.ts`));
        if (emitted.includes(candidate) && !set.has(candidate)) {
          set.add(candidate);
          queue.push(candidate);
        }
      }
    }
    return [...set];
  }

  it('主入口可达声明图包含 createInitialDocument 且合法出现 Y.Doc（正向 fixture）', () => {
    const { entry, files } = emitDeclarations();
    const reachable = reachableFrom(entry, files);
    const texts = reachable.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(texts).toContain('createInitialDocument');
    expect(texts).toContain('Y.Doc'); // §8：doc-runtime 自身主入口可合法出现 Y.Doc
    // 不出现跨包内部通道（registry 内部 subpath / runtime internal 均不得被 doc-runtime 声明携带）
    expect(texts).not.toContain('@nomicore/namespace-registry/internal');
    expect(texts).not.toContain('@nomicore/namespace-runtime/internal');
  }, { timeout: 30_000 });
});

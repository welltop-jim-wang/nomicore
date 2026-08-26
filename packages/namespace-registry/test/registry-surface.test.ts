/**
 * SA6 红灯锚定 — issue #110：包 surface / 导出纪律 / declaration 泄漏审计 /
 * 模块边界活链路（设计 §2.2/§8.2/§9 surface 行 + SA2 B3）。
 *
 * 断言面：
 * - package.json exports 恰为 `.` 与 `./testing`；主入口运行时 export keys 恰三个
 *   公共 value（工厂 + 两个错误类），无 Runtime/DocHandle/Y.Doc/internal 值；
 * - declaration emit（ts compiler API 实际产出 .d.ts）：主入口可达声明图无
 *   `NamespaceRuntime`/`DocHandle`/`Y.Doc`/`@nomicore/namespace-runtime/internal`
 *   文本；testing 入口为受控内部类型 import（§8.2 允许）；
 * - REPO_ROOT relPath 模块边界活链路：真实 `packages/namespace-registry/src/registry.ts`
 *   的 internal import 被收集（非 fixture-only）且 violators=[]；仅该文件消费 internal
 *   subpath（testing.ts 不得消费）。扫描器为本包 test/helpers 下的逐字副本
 *   （provenance 注释指向 namespace-runtime 包内权威实现——真实 gate 由 rev1 测试
 *   单实现承担，本副本仅供自包断言，消除跨包深相对导入，双轴终审第 6 项）；
 * - 根 package.json typecheck 链已含新包。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  auditInternalSubpathImporters,
  isWhitelistedConsumer,
} from './helpers/registry-seam-audit.js';

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
// 禁用标识符按「标识符词边界」判定（NamespaceRuntimeStatusProjection 是设计 §3.1
// 冻结的公开别名，其名含 NamespaceRuntime 前缀但并非该标识符本身）；
// internal subpath 以字面量判定。
const BANNED_DECL_TOKENS: Array<{ label: string; re: RegExp }> = [
  { label: 'NamespaceRuntime 标识符', re: /\bNamespaceRuntime\b/ },
  { label: 'DocHandle 标识符', re: /\bDocHandle\b/ },
  { label: 'Y.Doc 标识符', re: /\bY\.Doc\b/ },
  { label: 'internal subpath 字面量', re: /@nomicore\/namespace-runtime\/internal/ },
];

describe('package surface：exports 面与运行时 export-key 审计', () => {
  it('package.json exports 仅 "." 与 "./testing"', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(pkg.exports ?? {}).sort()).toEqual(['.', './testing']);
  });

  it('主入口运行时 export keys 恰三个公共 value；无 Runtime/DocHandle/Y.Doc 值泄漏', async () => {
    const main = await import('@nomicore/namespace-registry');
    const keys = Object.keys(main).sort();
    expect(keys).toEqual([
      'NamespaceLeaseReleasedError',
      'NamespaceRegistryFatalError',
      'createNamespaceRegistry',
    ]);
    for (const key of keys) {
      const value = (main as Record<string, unknown>)[key] as unknown;
      expect(typeof value, `${key} 必须是函数/类`).toBe('function');
      // 泄漏探测：被导出的值不得具备 Runtime/DocHandle 形状
      expect((value as { readonly namespaceId?: unknown })?.namespaceId).toBeUndefined();
      expect((value as { readonly mutateRoot?: unknown })?.mutateRoot).toBeUndefined();
      expect((value as { readonly doc?: unknown })?.doc).toBeUndefined();
      expect((value as { readonly release?: unknown })?.release).toBeUndefined();
    }
    // 命名面：不得出现内部对象名（类型面不存在于运行时，直接按键名断言）
    for (const forbidden of [
      'createNamespaceRegistryForTesting',
      'createRegistryInternal',
      'removeOnlySelf',
      'testing',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('testing subpath 仅导出 createNamespaceRegistryForTesting', async () => {
    const testing = await import('@nomicore/namespace-registry/testing');
    expect(Object.keys(testing).sort()).toEqual(['createNamespaceRegistryForTesting']);
  });
});

describe('declaration emit 审计：主入口可达声明图无 Runtime/DocHandle/Y.Doc / internal subpath', () => {
  function emitDeclarations(): { outDir: string; files: string[] } {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'namespace-registry-dts-'));
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
    return { outDir, files };
  }

  /** 从入口 .d.ts 出发按相对 specifier BFS 收集本包可达声明文件。 */
  function reachableFrom(entryFile: string, emitted: string[]): string[] {
    const outDir = path.dirname(entryFile);
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
        if (!spec.startsWith('.')) continue; // 外部包的声明不在本包审计面内
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

  it('主入口可达声明图文本不包含任何禁用标识符，且审计本身非空（覆盖 wrapper 链）', () => {
    const { files } = emitDeclarations();
    const entry = files.find((f) => f.endsWith('index.d.ts'));
    expect(entry, '必须产出 index.d.ts').toBeDefined();
    if (entry === undefined) return;
    const reachable = reachableFrom(entry, files);
    const rel = (f: string): string => path.basename(f);
    // 非空覆盖：wrapper 链（index/registry/errors/types/observer/identity 都在可达图内）
    for (const expected of ['index.d.ts', 'registry.d.ts', 'errors.d.ts', 'types.d.ts', 'observer.d.ts', 'identity.d.ts']) {
      expect(reachable.some((f) => rel(f) === expected), `可达图应包含 ${expected}`).toBe(true);
    }
    // lease/testing 必须不进入主入口可达图（内部实现模块）
    expect(reachable.some((f) => rel(f) === 'lease.d.ts')).toBe(false);
    expect(reachable.some((f) => rel(f) === 'testing.d.ts')).toBe(false);
    for (const file of reachable) {
      const text = fs.readFileSync(file, 'utf8');
      for (const token of BANNED_DECL_TOKENS) {
        expect(text, `${path.basename(file)} 不得包含声明文本 ${token.label}`).not.toMatch(token.re);
      }
    }
  }, { timeout: 30_000 });

  it('主入口 index.d.ts：新增 create 类型导出在、被替换的 RegistryOperationUnavailableIssue 不在（§2.3）', () => {
    const { files } = emitDeclarations();
    const entry = files.find((f) => f.endsWith('index.d.ts'));
    expect(entry, '必须产出 index.d.ts').toBeDefined();
    if (entry === undefined) return;
    const text = fs.readFileSync(entry, 'utf8');
    // §2.3 精确增量：type-only 新增 trio 进入主入口导出声明
    for (const name of ['CreateNamespaceInput', 'CreateNamespaceIssue', 'CreateNamespaceResult']) {
      expect(text, `index.d.ts 应导出 ${name}`).toContain(name);
    }
    // §2.3：被替换的占位结果别名不再经由主入口导出（shutdown 内部使用保留于
    // types.d.ts——该检查只约束入口导出面，不做全图禁词扫描）
    expect(text).not.toContain('RegistryOperationUnavailableIssue');
  }, { timeout: 30_000 });

  it('testing 入口声明允许内部类型 import（Runtime/DocHandle 仅出现在受控子路径）', () => {
    const { files } = emitDeclarations();
    const testing = files.find((f) => f.endsWith('testing.d.ts'));
    expect(testing, '须产出 testing.d.ts').toBeDefined();
    if (testing === undefined) return;
    const text = fs.readFileSync(testing, 'utf8');
    // §8.2：受控 subpath 的 declaration 内 Runtime/DocHandle 作为内部 import 出现
    expect(text).toContain('NamespaceRuntime');
    expect(text).toContain('DocHandle');
    // 但不得从主入口 re-export——本文件是 testing 入口自身，无主入口 re-export 链
    expect(text).not.toContain('@nomicore/namespace-runtime/internal');
    // §8（#111）：testing seam 新增必需的 clock 与 createDocumentFactory
    expect(text).toContain('clock:');
    expect(text).toContain('createDocumentFactory');
  }, { timeout: 30_000 });
});

describe('模块边界活链路（SA2 B3；REPO_ROOT relPath，非 fixture-only）', () => {
  it('真实生产树扫描收集 registry.ts 的 internal import 且 violators=[]', () => {
    const scan = auditInternalSubpathImporters();
    expect(scan.prodFiles).toBeGreaterThan(0);
    expect(scan.importers).toContain('packages/namespace-registry/src/registry.ts');
    expect(scan.violators).toEqual([]);
  });

  it('Registry 包内仅 registry.ts 消费 internal subpath（testing.ts 不消费）', () => {
    const scan = auditInternalSubpathImporters();
    const registryImporters = scan.importers.filter((p) =>
      p.startsWith('packages/namespace-registry/'),
    );
    expect(registryImporters).toEqual(['packages/namespace-registry/src/registry.ts']);
  });

  it('白名单谓词矩阵：Registry src 放行；testing/test/其它包/文件名拒绝', () => {
    expect(isWhitelistedConsumer('packages/namespace-registry/src/registry.ts')).toBe(true);
    expect(isWhitelistedConsumer('packages/namespace-registry/src/testing.ts')).toBe(true);
    expect(isWhitelistedConsumer('packages/namespace-registry/src/index.ts')).toBe(true);
    expect(isWhitelistedConsumer('packages/namespace-registry/test/seam-probe.ts')).toBe(false);
    expect(isWhitelistedConsumer('packages/namespace-runtime/src/index.ts')).toBe(false);
    expect(isWhitelistedConsumer('packages/persistence/src/store.ts')).toBe(false);
    expect(isWhitelistedConsumer('packages/namespace-registry/src/registry.test.ts')).toBe(false);
  });
});

describe('根 typecheck 链（§2.1）', () => {
  it('根 package.json typecheck 链含 packages/namespace-registry/tsconfig.json', () => {
    const root = JSON.parse(
      fs.readFileSync(path.join(PKG_DIR, '..', '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(root.scripts?.typecheck ?? '').toContain('tsc -p packages/namespace-registry/tsconfig.json');
  });
});

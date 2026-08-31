/**
 * SA6 红灯锚定 — issue #110：包 surface / 导出纪律 / declaration 泄漏审计 /
 * 模块边界活链路（设计 §2.2/§8.2/§9 surface 行 + SA2 B3）。
 *
 * 断言面：
 * - package.json exports 恰为 `.` 与 `./testing`；主入口运行时 export keys 恰九个
 *   公共 value（#112 冻结清单：工厂 + 两个既有错误类 + ShutdownError + plugin 工厂
 *   + plugin 面常量 + DEFAULT_IDLE_TIMEOUT_MS + provide/require），无
 *   Runtime/DocHandle/Y.Doc/internal 值；
 * - declaration emit（ts compiler API 实际产出 .d.ts）：主入口可达声明图无
 *   `NamespaceRuntime`/`DocHandle`/`Y.Doc`/`@nomicore/namespace-runtime/internal`
 *   文本；testing 入口为受控内部类型 import（§8.2 允许）；plugin.d.ts 进入可达图
 *   且不含禁词（§2.M/§2.G 声明面纪律）；
 * - REPO_ROOT relPath 模块边界活链路：真实 `packages/namespace-registry/src/registry.ts`
 *   的 internal import 被收集（非 fixture-only）且 violators=[]；仅该文件消费 internal
 *   subpath（testing.ts 不得消费）。扫描器为本包 test/helpers 下的逐字副本
 *   （provenance 注释指向 namespace-runtime 包内权威实现——真实 gate 由 rev1 测试
 *   单实现承担，本副本仅供自包断言，消除跨包深相对导入，双轴终审第 6 项）；
 * - 根 package.json typecheck 链已含新包。
 *
 * #112 增量（冻结设计 §2.G/§2.M）：主入口 9 值、testing 子路径 2 值、
 * cordis import 白名单守卫（src 除 plugin.ts 外零 cordis specifier）、
 * host-global-timer 守卫（全部 src/*.ts 含 testing.ts 零豁免——正反样本先证
 * 判别力再扫）。
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
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
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

  it('主入口运行时 export keys 恰九个公共 value（#112 冻结清单）；DEFAULT_IDLE_TIMEOUT_MS/NOMICORE_REGISTRY_SERVICE 常量值锚；无 Runtime/DocHandle/Y.Doc 值泄漏', async () => {
    const main = await import('@nomicore/namespace-registry');
    const keys = Object.keys(main).sort();
    expect(keys).toEqual([
      'DEFAULT_IDLE_TIMEOUT_MS',
      'NOMICORE_REGISTRY_SERVICE',
      'NamespaceLeaseReleasedError',
      'NamespaceRegistryFatalError',
      'NamespaceRegistryShutdownError',
      'createNamespaceRegistry',
      'createNamespaceRegistryPlugin',
      'provideNomicoreRegistry',
      'requireNomicoreRegistry',
    ]);
    // #112 常量值锚：DEFAULT_IDLE_TIMEOUT_MS = 300_000（M3 单点化定义在 registry.ts，
    // plugin.ts re-export、index 沿 plugin 链转出——本断言锚定导出链末端值）；
    // NOMICORE_REGISTRY_SERVICE = 'nomicoreRegistry'（issue #104 冻结名）
    expect((main as Record<string, unknown>).DEFAULT_IDLE_TIMEOUT_MS).toBe(300_000);
    expect((main as Record<string, unknown>).NOMICORE_REGISTRY_SERVICE).toBe('nomicoreRegistry');
    for (const key of keys) {
      if (key === 'DEFAULT_IDLE_TIMEOUT_MS' || key === 'NOMICORE_REGISTRY_SERVICE') continue;
      const value = (main as Record<string, unknown>)[key] as unknown;
      expect(typeof value, `${key} 必须是函数/类`).toBe('function');
      // 泄漏探测：被导出的值不得具备 Runtime/DocHandle 形状
      expect((value as { readonly namespaceId?: unknown })?.namespaceId).toBeUndefined();
      expect((value as { readonly mutateData?: unknown })?.mutateData).toBeUndefined();
      expect((value as { readonly doc?: unknown })?.doc).toBeUndefined();
      expect((value as { readonly release?: unknown })?.release).toBeUndefined();
    }
    // 命名面：不得出现内部对象名（类型面不存在于运行时，直接按键名断言）
    for (const forbidden of [
      'createRegistryTestScheduler',
      'createRegistryInternal',
      'removeOnlySelf',
      'testing',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('testing subpath 仅导出 createNamespaceRegistryForTesting 与 createRegistryTestScheduler', async () => {
    const testing = await import('@nomicore/namespace-registry/testing');
    expect(Object.keys(testing).sort()).toEqual([
      'createNamespaceRegistryForTesting',
      'createRegistryTestScheduler',
    ]);
    expect(typeof (testing as Record<string, unknown>).createRegistryTestScheduler).toBe('function');
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

  it('主入口可达声明图文本不包含任何禁用标识符，且审计本身非空（覆盖 wrapper 链，含 #112 plugin.ts）', () => {
    const { files } = emitDeclarations();
    const entry = files.find((f) => f.endsWith('index.d.ts'));
    expect(entry, '必须产出 index.d.ts').toBeDefined();
    if (entry === undefined) return;
    const reachable = reachableFrom(entry, files);
    const rel = (f: string): string => path.basename(f);
    // 非空覆盖：wrapper 链（index/registry/errors/types/observer/identity 都在可达图内）
    for (const expected of [
      'index.d.ts',
      'registry.d.ts',
      'errors.d.ts',
      'types.d.ts',
      'observer.d.ts',
      'identity.d.ts',
      'plugin.d.ts', // #112（§2.M/§2.G）：plugin.ts 进入主入口可达声明图
    ]) {
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

  it('主入口 index.d.ts：#112 增量类型/值导出在（ShutdownError/PluginConfig/ShutdownFailure/RegistryTimeoutScheduler/plugin 工厂）；RegistryOperationUnavailableIssue 删除后不在', () => {
    const { files } = emitDeclarations();
    const entry = files.find((f) => f.endsWith('index.d.ts'));
    expect(entry, '必须产出 index.d.ts').toBeDefined();
    if (entry === undefined) return;
    const text = fs.readFileSync(entry, 'utf8');
    // §2.3 精确增量：type-only 新增 trio 进入主入口导出声明
    for (const name of ['CreateNamespaceInput', 'CreateNamespaceIssue', 'CreateNamespaceResult']) {
      expect(text, `index.d.ts 应导出 ${name}`).toContain(name);
    }
    // #112 §2.G：值新增（plugin 工厂、ShutdownError、plugin 面常量/函数）与类型新增
    for (const name of [
      'createNamespaceRegistryPlugin',
      'NamespaceRegistryShutdownError',
      'DEFAULT_IDLE_TIMEOUT_MS',
      'NOMICORE_REGISTRY_SERVICE',
      'provideNomicoreRegistry',
      'requireNomicoreRegistry',
      'NamespaceRegistryPluginConfig',
      'NamespaceRegistryShutdownFailure',
      'RegistryTimeoutScheduler',
    ]) {
      expect(text, `index.d.ts 应导出 ${name}（#112 冻结清单）`).toContain(name);
    }
    // §2.H：被删除的占位类型不再进入主入口导出面（连 types.ts 内部定义一并删除）
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

describe('模块边界静态守卫（#112 设计 §2.M）：cordis import 白名单 + host-global-timer 禁令（零豁免）', () => {
  // 剥注释与字符串/模板字面量（保留模块 specifier——`from`/`import(` 之后的字面量
  // 是 specifier 本体，留在代码文本内可匹配；transliterate persistence
  // module-graph-regression 的 COMMENTS_AND_STRINGS 先例（否定 lookbehind：V8/Node≥8.10）。
  const COMMENTS_AND_STRINGS =
    /(?<!from\s|\(\s*)(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;

  /** 条 1：src 模块文本（剥注释/字符串后）含 cordis 系 specifier。 */
  function hasCordisSpecifier(source: string): boolean {
    const code = source.replace(COMMENTS_AND_STRINGS, ' ');
    // 精确 specifier 面（`@deepseek-ai/cordis` 与 `@deepseek-ai/cordis-plugin-timer`
    // 均以 `@deepseek-ai/cordis` 为前缀；plugin.ts 是唯一白名单成员）
    return code.includes("'@deepseek-ai/cordis") || code.includes('"@deepseek-ai/cordis');
  }

  /** 条 2：host 全局 timer API 三正则（transliterate persistence HOST_GLOBAL_TIMER）：
   * ① 裸调用（负向 lookbehind 排除 `scheduler.`/`timer.` 等属性调用与 property-signature
   *    成员位——`readonly setTimeout: (…) => unknown` 因 `:` 阻断 `\s*\(` 不命中）；
   * ② 显式 `globalThis.…`；③ `Date.now(`。 */
  const HOST_GLOBAL_TIMER_BARE = /(?<![\w$.])(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/;
  const HOST_GLOBAL_TIMER_GLOBALTHIS = /\bglobalThis\s*\.\s*(?:setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/;
  const DATE_NOW = /\bDate\s*\.\s*now\s*\(/;

  function hasHostGlobalTimerApi(source: string): boolean {
    const code = source.replace(COMMENTS_AND_STRINGS, ' ');
    return (
      HOST_GLOBAL_TIMER_BARE.test(code) ||
      HOST_GLOBAL_TIMER_GLOBALTHIS.test(code) ||
      DATE_NOW.test(code)
    );
  }

  it('cordis import 白名单：判别样本先证（注释/字符串/裸提及 0 命中；import/export specifier 命中），再扫全部 src/*.ts 除 plugin.ts 外零命中', () => {
    // 判别力样本表（正反先证后扫）
    const legalSamples = [
      "// a comment mentioning @deepseek-ai/cordis is fine",
      "const note = 'import type { Context } from @deepseek-ai/cordis inside a string is fine'",
      "const url = `see @deepseek-ai/cordis in a template literal`",
      "import { x } from '@nomicore/persistence'",
    ];
    const illegalSamples = [
      "import type { Context } from '@deepseek-ai/cordis'",
      "import { Context } from '@deepseek-ai/cordis'",
      "import type {} from '@deepseek-ai/cordis-plugin-timer'",
      "export { provideNomicoreRegistry } from '@deepseek-ai/cordis'",
    ];
    for (const sample of legalSamples) {
      expect(hasCordisSpecifier(sample), `legal sample flagged: ${JSON.stringify(sample)}`).toBe(false);
    }
    for (const sample of illegalSamples) {
      expect(hasCordisSpecifier(sample), `illegal sample missed: ${JSON.stringify(sample)}`).toBe(true);
    }

    const offenders: string[] = [];
    for (const fileName of fs.readdirSync(SRC_DIR)) {
      if (!fileName.endsWith('.ts') || fileName === 'plugin.ts') continue; // 白名单 = {plugin.ts}
      const source = fs.readFileSync(path.join(SRC_DIR, fileName), 'utf8');
      if (hasCordisSpecifier(source)) offenders.push(fileName);
    }
    expect(offenders).toEqual([]); // registry.ts/lease.ts/observer.ts/types.ts/errors.ts/identity.ts/create-document.ts/testing.ts 零 cordis
  });

  it('host-global-timer 守卫：正反样本先证，再扫全部 src/*.ts（含 testing.ts，零豁免——R1/m3）零裸 setTimeout/setInterval/clearTimeout/Date.now', () => {
    // 判别力样本表（B1 教训：属性调用 / property-signature 成员位 / 注释字符串均合法）
    const legalSamples = [
      'this.scheduler.setTimeout(callback, 10)', // 属性调用：scheduler 缝
      'readonly setTimeout: (callback: () => void, delayMs: number) => unknown', // 接口 property-signature 成员位
      'setTimeout: (callback, delayMs) => ctx.timeout(callback, delayMs)', // 桥接箭头形态（plugin.ts）
      'this.scheduler.clearTimeout(handle)',
      '// a comment mentioning setTimeout(cb, 10) is fine',
      "const note = 'setTimeout(cb, 10) inside a string is fine'",
      "const named = `globalThis.setTimeout(cb, 10) in a template literal`",
      "readonly now: () => number", // Clock property-signature 成员位（Date.now 同名无关位）
    ];
    const illegalSamples = [
      'setTimeout(callback, 10)',
      'globalThis.setTimeout(cb, 10)',
      'setInterval(cb, 10)',
      'clearTimeout(x)',
      'globalThis.clearInterval(x)',
      'Date.now()',
    ];
    for (const sample of legalSamples) {
      expect(hasHostGlobalTimerApi(sample), `legal sample flagged: ${JSON.stringify(sample)}`).toBe(false);
    }
    for (const sample of illegalSamples) {
      expect(hasHostGlobalTimerApi(sample), `illegal sample missed: ${JSON.stringify(sample)}`).toBe(true);
    }

    // 全部 src/*.ts 零豁免（testing.ts 的 createRegistryTestScheduler 是纯 map 队列
    // fake，零 native timer 调用——豁免无必要；未来确需豁免须注明具体成员与理由）。
    const offenders: string[] = [];
    for (const fileName of fs.readdirSync(SRC_DIR)) {
      if (!fileName.endsWith('.ts')) continue;
      const source = fs.readFileSync(path.join(SRC_DIR, fileName), 'utf8');
      if (hasHostGlobalTimerApi(source)) offenders.push(fileName);
    }
    expect(offenders).toEqual([]);
  });
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

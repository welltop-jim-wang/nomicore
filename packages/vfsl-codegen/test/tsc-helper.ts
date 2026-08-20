/**
 * SA6 共享测试辅助（Issue #45 三项契约的红灯测试共用）——仓内 TypeScript 编译器 API：
 * 孤立 program 编译（AC-1「生成物原样 tsc --noEmit 可编译」的可观测载体）与协议导出面
 * 枚举（AC-3「领域别名 × 协议导入名碰撞」的守卫对象域 = `@nomicore/vfsl-protocol` 实测导出）。
 *
 * 为什么经编译器 API 而非子进程 tsc：typescript 是仓内既有 devDependency（根与
 * vfsl-codegen 双份），`ts.createProgram` + `ts.getPreEmitDiagnostics` 与 `tsc --noEmit`
 * 同一语义（SA5 探针 p1/p2/p3 用子进程 tsc 实证的诊断码，本辅助用 API 复现同款——probe3
 * 实测 4/3 条诊断与 SA5 逐码一致）；不新增任何依赖与端口。
 *
 * 编译选项对齐 tsconfig.base.json 主键（strict/ESNext/bundler）+ `paths` 把
 * `@nomicore/vfsl-protocol` 指向仓内协议包源码——生成物 import 的解析目标与 SA5
 * 探针 program 相同（生成物孤立可编译的判据 = 增广目标真实入 program 且 PathSchema 绑定
 * 到协议导出）。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type * as TS from 'typescript';

const require = createRequire(import.meta.url);

/** 仓内 typescript（类型以 `typeof import('typescript')` 标定，避开 verbatimModuleSyntax 下 CJS 默认导入禁令）。 */
export const ts = require('typescript') as typeof import('typescript');

/** 仓根（pnpm generate / node_modules 解析基准，与 generate-cli-check.test.ts 同款推导）。 */
export const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** 协议包入口（孤立 program 的 paths 目标；12 名导出面的真实来源文件）。 */
export const protocolEntry = fileURLToPath(new URL('../../vfsl-protocol/src/index.ts', import.meta.url));

/** vfsl 核心包入口（paths 目标——协议包自身依赖的解析用）。 */
const vfslEntry = fileURLToPath(new URL('../../vfsl/src/index.ts', import.meta.url));

/** 孤立 program 编译选项（SA5 p1-p3 探针同款：noEmit + strict + bundler + paths）。 */
function compileOptions(): TS.CompilerOptions {
  return {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    types: [],
    paths: {
      '@nomicore/vfsl-protocol': [protocolEntry],
      '@nomicore/vfsl': [vfslEntry],
    },
  };
}

/** 对给定根文件建孤立 program 并取 pre-emit 诊断（等价 `tsc --noEmit -p <program>` 的诊断面）。 */
export function preEmitDiagnostics(rootNames: readonly string[]): readonly TS.Diagnostic[] {
  const program = ts.createProgram({ rootNames: [...rootNames], options: compileOptions() });
  return ts.getPreEmitDiagnostics(program);
}

/** 诊断的可读格式化（断言失败消息：`文件:行:列 TS<code> <text>`）。 */
export function formatDiagnostics(diags: readonly TS.Diagnostic[]): string {
  return diags
    .map((d) => {
      const where =
        d.file === undefined
          ? ''
          : `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}`;
      return `${where} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    })
    .join('\n');
}

/**
 * 协议包实测导出面（AC-3 守卫对象域，SA5 锚点 2：「以 packages/vfsl-protocol/src/index.ts
 * 实测导出为准，勿凭文档回忆」）。协议包是纯类型模块（零运行时值导出），运行时
 * `Object.keys` 取不到——经 checker.getExportsOfModule 枚举（probe5 实测 12 名，与
 * SA5 清单逐名一致）。协议导出面漂移时本枚举自动跟随，测试不须手工同步名单。
 */
export function protocolExportNames(): string[] {
  const program = ts.createProgram({ rootNames: [protocolEntry], options: compileOptions() });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(protocolEntry);
  if (sf === undefined) {
    throw new Error('protocolExportNames: 协议包入口源文件未找到');
  }
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (moduleSymbol === undefined) {
    throw new Error('protocolExportNames: 协议包模块符号未找到');
  }
  return checker.getExportsOfModule(moduleSymbol).map((s) => s.getName());
}

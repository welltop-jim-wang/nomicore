/**
 * 【provenance】本文件是 packages/namespace-runtime/test/helpers/registry-seam-audit.ts
 * 的逐字副本（2026-08-26 双轴终审第 6 项：消除跨包深相对导入的边界泄漏；本包没有
 * 跨包 test 深导入先例）。权威门禁实现仍是 namespace-runtime 包内的同一份代码
 * （rev1 测试以默认 roots 单实现双输入：探针 fixture + 真实全仓）——issue #110 SA2-B3
 * 「真实 gate 活链路」语义由 rev1 测试权威承担，本副本仅供本包 surface 断言自包内
 * 消费同一扫描语义。如任一实现修订，两处须同步（来源文件为本文件的上游）。
 */
/**
 * 共享审计 helper — issue #109 Round 2（R1 设计）：`@nomicore/namespace-runtime/internal`
 * subpath 模块边界审计（ADR-0009 §模块与 Cordis service 第 18 行：internal subpath 只能由
 * Registry 生产代码消费）+ Registry 生产白名单收窄（ADR-0009 §公共 Interface「测试 seam 只
 * 位于受控 testing subpath」——该载体属非生产代码，不在白名单内）。
 *
 * 设计基准：wiki/raw/task_namespace-runtime-registry-seam-rev1_design.md（R1）§D-A–§D-D。
 * 真实全仓门禁与探针 fixture 共用同一份实现（roots 参数化，单一实现双输入）：
 * - 消费形态识别 = TS compiler API AST 五形态（ImportDeclaration 含副作用导入 /
 *   ExportDeclaration moduleSpecifier 再导出 / import = require() / import('…') /
 *   require('…')），天然免疫注释与字符串字面量误报；扩展名 .ts/.tsx/.mts/.cts/.js/.jsx/
 *   .mjs/.cjs 全覆盖（排 .d.ts）。
 * - 白名单谓词 = 纯函数 `isWhitelistedConsumer`：ADR-0009 前瞻前缀
 *   `packages/namespace-registry/src/`（Registry 包尚未存在）+ 非生产目录段拒绝
 *   {testing,test,__tests__,fixtures,mock}（大小写不敏感段比较，E2）+ 测试文件名拒绝
 *   （.test./.spec.）。
 * - `auditInternalSubpathImporters(roots?)`：roots 缺省 = 单一仓根 REPO_ROOT + walk 顶层
 *   目录白名单 {packages, domains, apps}（方案 A：其余顶层条目在扫描根层剪枝）——
 *   `importers` 相对**各自扫描根**的 POSIX 路径：默认门禁下 packages/** 文件带 packages/
 *   顶层段、与谓词前缀对齐（P7），与 fixture `repo/` 显式根下同路径文件**逐字符同构**
 *   （「探针证明 = 门禁行为」的等价性有结构保证）。
 *
 * 零 vitest 依赖：仅 node:fs / node:path / node:url + typescript（既有 devDependency，
 * 导入形态先例 domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts:34，同链现行绿）。
 * 本文件位于 test/ 下（真实全仓扫描的包级 test 剪枝域）→ 审计器不审计自己、fixture 隔离。
 */
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RegistrySeamAuditResult {
  /** 被审计的生产候选文件总数（跨全部 roots 累计；防空扫锚点——>0 才证明扫描真实发生）。 */
  prodFiles: number;
  /** 检测到消费 internal specifier 的文件，相对各自扫描根的 POSIX 路径。 */
  importers: string[];
  /** 违规清单 = importers 中未通过白名单谓词的路径（契约字面）。 */
  violators: string[];
}

const INTERNAL_SPECIFIER = '@nomicore/namespace-runtime/internal';
// ADR-0009 前瞻前缀（Registry 包尚未存在；切片 5/6 落地后谓词自动放行其生产 src）。
const REGISTRY_SRC_PREFIX = 'packages/namespace-registry/src/';
// 非生产目录段下界（冲突报告注 1 单向边界：只可扩充，不得缩减/放宽）。段比较大小写不敏感。
const NON_PROD_SEGMENTS = new Set(['testing', 'test', '__tests__', 'fixtures', 'mock']);
// 文件名级测试文件拒绝：含 .test. / .spec.（如 registry.test.tsx、manager.spec.ts）。
const TEST_FILENAME_RE = /\.(?:test|spec)\./;
// 审计扩展名集合（反馈 1：.js/.jsx/.mjs/.cjs 载体覆盖）。
const AUDITED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
// 方案 A：默认门禁的顶层目录白名单——walk 从仓根起，仅进此三顶层目录（其余顶层条目剪枝）。
const TOP_LEVEL_SCAN_DIRS = new Set(['packages', 'domains', 'apps']);
// 无条件剪枝目录（任何深度；依赖/文档/构建产物目录）。
const ALWAYS_SKIP_DIRS = new Set(['node_modules', '.git', '.mabf-bg', 'dist', 'coverage', 'docs', 'wiki']);
// 条件剪枝目录（SA2 #2 修复）：test/tests/__tests__ 仅在 src 子树外剪枝——src 子树内照常
// 扫描（存在消费 → 检测 + 判违规 fail-closed），包级 test 树整树跳过（fixture 隔离）。
const SRC_CONDITIONAL_SKIP_DIRS = new Set(['test', 'tests', '__tests__']);
const SKIP_FILES = new Set(['package.json', 'README.md']);
// 仓根（层级 helpers→test→包→packages→仓根，与旧 AC5 实现同款语义）。
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** 是否属于被审计的生产候选文件（扩展名集合内且非 .d.ts/.d.mts/.d.cts 声明文件）。 */
function isAuditedFile(name: string): boolean {
  if (/\.d\.[cm]?ts$/.test(name)) return false;
  return AUDITED_EXTENSIONS.has(path.extname(name));
}

/**
 * 单文件消费识别器（纯谓词）：TS compiler API AST 下行遍历，识别对
 * `@nomicore/namespace-runtime/internal` 的五形态消费（语法节点类别枚举，零正则参与
 * 说明符判定，天然免疫注释/字符串字面量误报）：
 * ① ImportDeclaration（含无绑定副作用导入、具名/默认/命名空间/import type——模块图边
 *    即边界事实）；② ExportDeclaration moduleSpecifier（export * from / export {…} from /
 *    export * as ns from）；③ ImportEqualsDeclaration + ExternalModuleReference
 *    （import x = require('…')）；④ 动态 import('…')（ImportKeyword callee）；⑤
 *    require('…')（Identifier callee 精确名匹配；递归遍历使其与语法位置无关）。
 * 属性访问 require（module.require 等）不在五形态内（R1 残差项，见设计 §D-B）。
 */
function consumesInternalSpecifier(sourceText: string, fileName: string): boolean {
  // scriptKind 由 createSourceFile 按扩展名内部推断（.tsx/.jsx→JSX、.ts/.mts/.cts→TS、
  // .js/.mjs/.cjs→JS）——语义同 ts.getScriptKindFromFileName（该函数导出运行时存在但
  // 未入 typescript@5.9.3 公开 .d.ts，故不显式传入；实测 8 扩展名推断值逐一致）。
  const sf = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ false,
  );
  let found = false;
  const isInternal = (e: ts.Expression | undefined): boolean =>
    e !== undefined && ts.isStringLiteral(e) && e.text === INTERNAL_SPECIFIER;

  const visit = (node: ts.Node): void => {
    if (found) return; // 命中即短路（纯谓词，无副作用）
    if (ts.isImportDeclaration(node)) {
      // 形态①：全部静态 import（importClause 为 null 的副作用导入同样命中）。
      if (isInternal(node.moduleSpecifier)) found = true;
    } else if (ts.isExportDeclaration(node)) {
      // 形态②：再导出（export {…} 无 moduleSpecifier 时自然不命中）。
      if (isInternal(node.moduleSpecifier)) found = true;
    } else if (ts.isImportEqualsDeclaration(node)) {
      // 形态③：import x = require('…')（内部命名空间形态无字符串说明符，自然不命中）。
      if (ts.isExternalModuleReference(node.moduleReference) && isInternal(node.moduleReference.expression)) {
        found = true;
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        // 形态④：动态 import('…')（import.meta 是 MetaProperty，不进此分支）。
        if (node.arguments.length > 0 && isInternal(node.arguments[0])) found = true;
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        // 形态⑤：require('…')——callee 为精确名 Identifier 'require'（属性访问不进此分支）。
        if (node.arguments.length > 0 && isInternal(node.arguments[0])) found = true;
      }
    }
    if (!found) node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/**
 * 递归收集被审计文件（readdir 排序 → 扫描顺序确定；statSync 跟随符号链接，与旧实现同语义）。
 * @param filterTopLevel 默认模式（true）：仅当前层为扫描根时应用顶层白名单——fixture
 * 显式根（repo/、bypass/）不受此过滤，根下直挂文件照常审计。显式 roots 不做存在性过滤
 * （路径写错 → readdirSync ENOENT 响亮红，防空扫断言的第二层兜底）。
 */
function collectAuditedFiles(root: string, filterTopLevel: boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string, atScanRoot: boolean, inSrc: boolean): void => {
    for (const name of [...readdirSync(dir)].sort()) {
      if (SKIP_FILES.has(name)) continue;
      if (atScanRoot && filterTopLevel && !TOP_LEVEL_SCAN_DIRS.has(name)) continue;
      if (ALWAYS_SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const isDir = statSync(full).isDirectory();
      if (isDir) {
        // 条件剪枝：src 子树内不剪 test/tests/__tests__（谓词 deny 兜底 = fail-closed）。
        if (SRC_CONDITIONAL_SKIP_DIRS.has(name) && !inSrc) continue;
        walk(full, false, inSrc || name === 'src');
      } else if (isAuditedFile(name)) {
        out.push(full);
      }
    }
  };
  // SA2 R1 复审 LOW 观察项 O-1 一行加固：初始 inSrc 纳入扫描根自身名判定——
  // 显式传 …/src 为根的用法下，其下 test/tests/__tests__ 不再被误剪（谓词 deny 兜底）。
  walk(root, true, path.basename(root) === 'src');
  return out;
}

/**
 * 递归扫描生产候选文件并审计 internal subpath 消费（单一实现双输入：真实门禁缺省 roots
 * = 方案 A 单根仓根 + 顶层白名单；探针显式 roots = fixture 根 repo/、bypass/）。
 */
export function auditInternalSubpathImporters(roots?: readonly string[]): RegistrySeamAuditResult {
  // 方案 A（SA2 #1 修复）：默认 = 单根 REPO_ROOT + 顶层目录白名单——relPath 统一相对
  // 扫描根，默认门禁下 packages/** 的 relPath 带 packages/ 顶层段 → 谓词前缀可达（P7），
  // ADR-0009 L18 首句授权的 Registry 生产构造路径在门禁下可达；与 fixture repo/ 根下
  // 同路径文件逐字符同构。无 existsSync 过滤（缺席顶层名天然不出现在 readdir 结果）。
  const isDefaultMode = roots === undefined;
  const scanRoots: string[] = isDefaultMode ? [REPO_ROOT] : [...roots];
  let prodFiles = 0;
  const importers: string[] = [];
  for (const root of scanRoots) {
    for (const file of collectAuditedFiles(root, isDefaultMode)) {
      prodFiles += 1;
      if (consumesInternalSpecifier(readFileSync(file, 'utf8'), file)) {
        importers.push(path.relative(root, file).replace(/\\/g, '/'));
      }
    }
  }
  const violators = importers.filter((p) => !isWhitelistedConsumer(p));
  return { prodFiles, importers, violators };
}

/**
 * 白名单收窄谓词（反馈 2 的直接实现；纯函数，三条确定性字符串规则，无吞错/无 fallback）：
 * ① 仅 Registry 生产前缀（大小写敏感，精确段；src2/ 不匹配）；② 路径段级非生产
 * 目录拒绝（大小写不敏感精确段比较，防 Windows FS 大小写变体与子串误伤；
 * testing-utils ≠ testing、mockery ≠ mock）；③ 文件名含 .test./.spec. 拒绝（不论目录位置）。
 */
export function isWhitelistedConsumer(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/'); // Windows 分隔符归一
  if (!p.startsWith(REGISTRY_SRC_PREFIX)) return false;
  const segments = p.split('/');
  if (segments.some((seg) => NON_PROD_SEGMENTS.has(seg.toLowerCase()))) return false;
  const base = segments[segments.length - 1] ?? '';
  return !TEST_FILENAME_RE.test(base);
}

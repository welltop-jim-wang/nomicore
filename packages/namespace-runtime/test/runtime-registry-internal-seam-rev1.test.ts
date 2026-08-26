/**
 * SA6 红灯锚定 — issue #109 Round 2 修订轮 RAC1/RAC2 —
 * 模块边界审计（全形态探针）+ Registry 白名单收窄（正反例矩阵）。
 *
 * 契约来源：
 * - ADR-0009 §模块与 Cordis service 第 18 行：「模块边界测试限制该 internal subpath
 *   只能由 Registry 生产代码消费」；
 * - 修订简报（task_namespace-runtime-registry-seam-rev1.md）反馈 1【阻塞】——现有 AC5
 *   审计只匹配 `from '…'` 与字面量 `import('…')`、只扫 .ts/.tsx/.mts/.cts：副作用导入 /
 *   再导出 / require() / import = require() / .js-.jsx-.mjs-.cjs 载体全部漏检；
 *   反馈 2【中】——白名单 `packages/namespace-registry/src/` 前缀无目录排除，会把
 *   src/testing/、src/__tests__/、fixture 等非生产代码视为合法消费者。
 *
 * 锚定对象（探针目标）：共享审计 helper `test/helpers/registry-seam-audit.ts`——
 * 真实全仓门禁与探针共用同一份实现（简报设计方向约束 1）。
 *
 * 【当前红灯（2026-08-25，HEAD=0a4d460，Round 1 之后）】
 * - 该 helper 尚不存在（审计逻辑仍是 runtime-registry-internal-seam.test.ts 内嵌的
 *   弱正则实现）→ 本文件对 `./helpers/registry-seam-audit` 的 import 在运行时模块
 *   解析与 typecheck（TS2307）双通道失败 = 探针目标缺席 → 真红；
 * - 修绿信号：SA3 按本文件锚定的 helper 契约实现（AST 全形态识别 + 扩展名覆盖
 *   .ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs + 白名单收窄谓词 + violators 判定），
 *   本文件全部 it 转绿；真实全仓门禁（默认 roots）在仓内无非白名单消费方的前提下
 *   必须保持绿。
 *
 * 断言纪律：全部断言锚定 helper 的**运行时行为**（对 fixture 树的扫描结果 + 白名单
 * 谓词纯函数矩阵），零源码文本 grep；fixture 树位于 test/ 下（真实全仓扫描跳过域），
 * 不持有 package.json（避免污染包内自引用解析）。
 *
 * SA3 落地清单（本文件契约 ⇒ 实现义务，另见简报 §SA6 锚定记录）：
 * 1. helper 契约（路径 test/helpers/registry-seam-audit.ts）：
 *    - `auditInternalSubpathImporters(roots?: readonly string[]): RegistrySeamAuditResult`
 *      ——roots 缺省 = 仓库 packages/domains/apps（真实全仓门禁）；扫描扩展名集合
 *      .ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs（排除 .d.ts）；跳过
 *      test/tests/__tests__/docs/wiki/node_modules/.git/.mabf-bg/dist/coverage 目录；
 *      `importers` 为相对各自扫描根的 POSIX 路径；
 *    - `isWhitelistedConsumer(relPath): boolean` ——白名单谓词（见 RAC2 矩阵）；
 *    - `violators = importers.filter(p => !isWhitelistedConsumer(p))`；
 *    - 消费形态识别（AST 或同强度实现，禁止只匹配 `from`/`import(` 文本）：
 *      ImportDeclaration（含无绑定副作用导入）/ ExportDeclaration moduleSpecifier
 *      （再导出）/ CallExpression `require('…')` / ImportEqualsDeclaration
 *      （import = require）/ CallExpression `import('…')`（动态）；
 * 2. 既有 runtime-registry-internal-seam.test.ts 的 AC5 describe 块（316–395 行）
 *    迁移到本 helper（或删除，由本文件承载 AC5')——弱正则审计不得残留。
 *
 * 【issue #110 SA2-B3 追加（2026-08-26）】本文件另含 REPO_ROOT 活链路锚：RAC1
 * 真实全仓门禁的默认 roots（单根 REPO_ROOT + 顶层白名单 {packages,domains,apps}）
 * 必须收集到真实生产树 `packages/namespace-registry/src/registry.ts` 对 internal
 * subpath 的消费（非 fixture-only、非真空通过），并要求 violators=[]；对应断言见
 * 文件末 describe「RAC1 真实全仓门禁」的新增 it「REPO_ROOT relPath 活链路
 * （issue #110 SA2 B3）：真实 registry.ts 生产 import 必须被收集」。真实 gateway
 * 由此保持单实现（探针 fixture 与全仓门禁共用同一 helper）的语义。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  auditInternalSubpathImporters,
  isWhitelistedConsumer,
} from './helpers/registry-seam-audit';
import type { RegistrySeamAuditResult } from './helpers/registry-seam-audit';

// ── fixture 树 ─────────────────────────────────────────────────────────────
// repo/ 模拟仓库布局（relPath 以 packages/ 开头，白名单前缀可命中）；
// bypass/ 承载全部绕过形态与反误报控制组（relPath 不以 packages/ 开头 → 非白名单）。
const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/registry-seam-audit-rev1', import.meta.url));
const REPO_FIXTURE = path.join(FIXTURE_ROOT, 'repo');
const BYPASS_FIXTURE = path.join(FIXTURE_ROOT, 'bypass');

// RAC1 绕过形态（反馈 1 点名清单）= bypass/ 下对应的 fixture 相对路径。
const SIDE_EFFECT_IMPORT = 'side-effect-import.ts';
const RE_EXPORT = 're-export.ts';
const REQUIRE_CALL = 'carrier-require.cjs';
const IMPORT_EQUALS = 'import-equals.cts';
const DYNAMIC_IMPORT = 'dynamic-import.ts';
const CARRIER_JS = 'carrier.js';
const CARRIER_JSX = 'carrier.jsx';
const CARRIER_MJS = 'carrier.mjs';
// 反误报控制组（不得被检测）。
const CONTROL_FILES = ['comment-only.ts', 'string-literal.ts', 'other-specifier.ts'];
// RAC2 正例（白名单内 Registry 生产模块，模拟文件真实存在于 fixture 树）。
const WHITELISTED_POSITIVES = [
  'packages/namespace-registry/src/registry.ts',
  'packages/namespace-registry/src/lease/manager.ts',
];
// RAC2 反例（存在消费 → 审计判违规的 fixture 树路径）。
const NON_PROD_CONSUMERS = [
  'packages/namespace-registry/src/testing/case.ts',
  'packages/namespace-registry/src/fixtures/seed.ts',
  'packages/namespace-registry/src/mock/registry-mock.ts',
  'packages/namespace-registry/src/registry.test.tsx',
  'packages/namespace-registry/src/registry.spec.tsx',
];
// RAC2 负例（非 Registry 生产代码）。
const NON_REGISTRY_CONSUMER = ['packages/persistence/src/store.ts'];

// 探针与真实门禁共用同一次 helper 扫描（同一实现的两类输入）。
let fixtureScan: RegistrySeamAuditResult;
beforeAll(() => {
  fixtureScan = auditInternalSubpathImporters([REPO_FIXTURE, BYPASS_FIXTURE]);
});

/**
 * 探针断言原语：给定 fixture 相对路径，断言 helper 既「检测到该消费」（importers），
 * 又「判违规」（violators）——RAC1「存在该消费 → 审计判违规」的逐形态固定。
 */
function expectDetectedAndViolating(relPath: string): void {
  expect(fixtureScan.importers, `审计应检测到消费方 ${relPath}`).toContain(relPath);
  expect(fixtureScan.violators, `审计应对 ${relPath} 判违规`).toContain(relPath);
}

describe('RAC1 探针：审计 helper 对全部绕过形态逐一判违规（fixture 树）', () => {
  it('副作用导入 import "@nomicore/namespace-runtime/internal"（无绑定）→ 检测 + 判违规', () => {
    expectDetectedAndViolating(SIDE_EFFECT_IMPORT);
  });

  it('再导出 export * from / export { … } from → 检测 + 判违规', () => {
    expectDetectedAndViolating(RE_EXPORT);
  });

  it('require("…") 调用（CommonJS 消费形态，.cjs 载体）→ 检测 + 判违规', () => {
    expectDetectedAndViolating(REQUIRE_CALL);
  });

  it('import x = require("…")（ImportEqualsDeclaration，.cts 载体）→ 检测 + 判违规', () => {
    expectDetectedAndViolating(IMPORT_EQUALS);
  });

  it('动态 import("…")（表达式形态）→ 检测 + 判违规', () => {
    expectDetectedAndViolating(DYNAMIC_IMPORT);
  });

  it('.js 生产载体（ESM 再导出）→ 检测 + 判违规', () => {
    expectDetectedAndViolating(CARRIER_JS);
  });

  it('.jsx 生产载体（副作用导入 + JSX 语法）→ 检测 + 判违规', () => {
    expectDetectedAndViolating(CARRIER_JSX);
  });

  it('.mjs 生产载体（动态 import()）→ 检测 + 判违规', () => {
    expectDetectedAndViolating(CARRIER_MJS);
  });

  it('控制组：注释 / 字符串字面量 / 其他包 specifier 不得被误判为 internal 消费方', () => {
    for (const rel of CONTROL_FILES) {
      expect(fixtureScan.importers, `控制组文件 ${rel} 不应被检测为 internal 消费方`).not.toContain(rel);
      expect(fixtureScan.violators, `控制组文件 ${rel} 不应出现在违规清单`).not.toContain(rel);
    }
  });

  it('防空扫（探针侧）：fixture 树确实被扫描到（prodFiles > 0，未被测试目录豁免规则吞掉）', () => {
    // 探针 fixture 根目录名不命中跳过清单；此断言防止「审计没扫到任何东西」导致的假绿。
    expect(fixtureScan.prodFiles).toBeGreaterThan(0);
  });
});

describe('RAC2 探针：白名单收窄的运行时集成——非生产代码消费 internal 判违规', () => {
  it('正例：Registry src 生产模块（含生产子目录）消费 → 检测到但判合规', () => {
    for (const rel of WHITELISTED_POSITIVES) {
      expect(fixtureScan.importers, `审计应检测到白名单消费方 ${rel}`).toContain(rel);
      expect(fixtureScan.violators, `白名单内消费方 ${rel} 不得判违规`).not.toContain(rel);
    }
  });

  it('反例：src/testing|fixtures|mock 目录与 *.test.*/*.spec.* 文件名消费 → 检测 + 判违规', () => {
    for (const rel of NON_PROD_CONSUMERS) {
      expectDetectedAndViolating(rel);
    }
  });

  it('负例：非 Registry 生产代码（packages/persistence/src/store.ts）消费 → 检测 + 判违规', () => {
    for (const rel of NON_REGISTRY_CONSUMER) {
      expectDetectedAndViolating(rel);
    }
  });
});

describe('RAC2 矩阵：白名单谓词 allow/deny（正反例纯度矩阵）', () => {
  it('allow：Registry src 生产模块（含生产子目录）放行', () => {
    expect(isWhitelistedConsumer('packages/namespace-registry/src/registry.ts')).toBe(true);
    expect(isWhitelistedConsumer('packages/namespace-registry/src/index.ts')).toBe(true);
    expect(isWhitelistedConsumer('packages/namespace-registry/src/lease/manager.ts')).toBe(true);
    expect(isWhitelistedConsumer('packages/namespace-registry/src/lease/deep/manager.ts')).toBe(true);
  });

  it('deny：非生产目录段 testing/test/__tests__/fixtures/mock（反馈 2 点名 + 冲突报告下界）', () => {
    for (const rel of [
      'packages/namespace-registry/src/testing/registry.test.ts',
      'packages/namespace-registry/src/test/case.ts',
      'packages/namespace-registry/src/__tests__/case.ts',
      'packages/namespace-registry/src/lease/fixtures/seed.ts',
      'packages/namespace-registry/src/lease/mock/registry-mock.ts',
    ]) {
      expect(isWhitelistedConsumer(rel), `非生产目录路径 ${rel} 必须拒绝`).toBe(false);
    }
  });

  it('deny：*.test.* / *.spec.* 文件名（不论目录位置）', () => {
    for (const rel of [
      'packages/namespace-registry/src/registry.test.ts',
      'packages/namespace-registry/src/registry.spec.ts',
      'packages/namespace-registry/src/lease/manager.test.ts',
      'packages/namespace-registry/src/lease/manager.spec.ts',
    ]) {
      expect(isWhitelistedConsumer(rel), `测试文件名 ${rel} 必须拒绝`).toBe(false);
    }
  });

  it('deny：包根 test/ 目录与一切非 Registry 路径（其他包/src、domains、apps）', () => {
    for (const rel of [
      'packages/namespace-registry/test/seam.test.ts',
      'packages/persistence/src/index.ts', // 其他包生产代码
      'packages/namespace-runtime/src/internal.ts', // 本包自己也不行（生产工厂保留包内）
      'packages/namespace-runtime/src/index.ts',
      'domains/vfs3-assets/src/schema.ts', // domains 非 Registry
      'apps/web/src/index.ts', // apps 非 Registry
      'packages/namespace-registry/src2/index.ts', // 前缀相似性（src2/ ≠ src/）不得误放行
    ]) {
      expect(isWhitelistedConsumer(rel), `非白名单路径 ${rel} 必须拒绝`).toBe(false);
    }
  });
});

describe('RAC1 真实全仓门禁：审计 helper 对仓库生产代码树的既有门禁保持绿', () => {
  it('防空扫（真实侧）：仓库有生产代码文件被审计（helper 默认 roots = packages/domains/apps）', () => {
    const scan = auditInternalSubpathImporters();
    expect(scan.prodFiles).toBeGreaterThan(0);
  });

  it('真实全仓：internal subpath 的生产代码消费方 ⊆ 白名单（violators 为空）', () => {
    // 现状（HEAD=0a4d460）：无任何生产代码消费 internal subpath（含新扩展名覆盖与非
    // Registry 路径）→ helper 落地后此断言必须保持绿；若 SA3 实现后变红，说明真实仓
    // 内存在漏检形态的真实消费方，属实现前必须先处理的边界破坏（回禀总控，勿绕过）。
    const scan = auditInternalSubpathImporters();
    expect(
      scan.violators,
      `internal subpath 只允许 Registry 生产代码消费；违规消费方：${scan.violators.join(', ') || '(无)'}`,
    ).toEqual([]);
  });

  it('REPO_ROOT relPath 活链路（issue #110 SA2 B3）：真实 registry.ts 生产 import 必须被收集', () => {
    // 非 fixture-only 门禁：默认 roots（单根 REPO_ROOT + 顶层白名单）必须收集到真实
    // 生产树 packages/namespace-registry/src/registry.ts 的 internal 消费——避免
    // 「审计没扫到任何东西」导致的假绿（violators=[] 的真空通过）。
    const scan = auditInternalSubpathImporters();
    expect(
      scan.importers,
      'REPO_ROOT 相对路径扫描必须收集真实生产树的 internal import',
    ).toContain('packages/namespace-registry/src/registry.ts');
  });
});

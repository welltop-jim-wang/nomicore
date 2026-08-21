/**
 * SA6 红灯测试 — domains/vfs3-assets 领域包 dogfood（issue #27）· AC1 包结构/纯类型 +
 * AC5 docs 三锚位 TSDoc 断言。
 *
 * 契约来源：
 * - AC1：ADR 0005 §5 领域包组成 = schema.vfsl + generated.ts + index.ts（增广挂载）+
 *   test/ + package.json（纯类型）；「纯类型」类比 ADR 0004 D3——类型空间产物，运行时为空模块；
 * - AC5：ADR 0005 §3（派生 schema 必须携带 docs）+ §4（生成物入仓）——生成物中
 *   别名/字段/标记位三锚位的 fixture JSDoc 全部出现在 TSDoc 注释上
 *   （F2 评审证据缺口，#46 Spec 轴，本票补齐）。
 *
 * 断言纪律（为什么不构成「源码 grep 伪测试」）：
 * - 本文件断言对象是**生成物 generated.ts 的 TSDoc 挂载**——docs 入生成物就是本票的交付内容
 *   本身（同 F2「纯发射器的发射输出 = 可观测行为」先例），不是用文本形状代理行为；
 * - 锚定方式为 **TypeScript 编译器 parser 的 jsDoc 挂载**（ts.createSourceFile 后读声明节点的
 *   jsDoc 数组）——tsc 把注释识别为挂在哪个声明上的文档，属语义层断言（IDE hover 所见即所断），
 *   不是正则扫文本；
 * - 期望值**不由本测试硬编码复述**：fixture 文本经 SchemaSource 接缝（ADR 0001 脚手架纪律——
 *   消费方不直接读文件）+ parseVfsl/evaluate 求出派生 schema，docs 三槽（aliasDocs/fieldDocs/
 *   markerDocs）非空条目逐字锚定——fixture 改动时本测试自动跟随，漏挂即红。
 *
 * 已知证据缺口（提请 SA1/总控定夺，不阻塞本测试落地）：规格 §10 fixture 当前的 JSDoc 全部位于
 * 别名位与字段位（`notes`）；**标记位**（markerDocs——doc 注释直挂标记类型记号）在 fixture 中
 * 无条目，故「标记位」臂当前空转（扫描逻辑在场，fixture 一旦携带标记位 JSDoc 即生效）。若 AC5
 * 要求标记位有实证，需在 schema.vfsl 的标记位补一条 JSDoc（偏离 §10 fixture 原文，须决议）。
 *
 * 红灯现状：domains/vfs3-assets 包尚不存在 → AC1 existsSync 全 false、运行时 import 失败、
 * FileSchemaSource.list() 无本领域 id → 红灯（真红，非伪红）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { assertVfslDialect, evaluate, FileSchemaSource, parseVfsl } from '@nomicore/vfsl';
import type { DerivedSchema } from '@nomicore/vfsl';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pkgDir, '..', '..');
const schemaPath = join(pkgDir, 'schema.vfsl');
const generatedPath = join(pkgDir, 'generated.ts');
const indexPath = join(pkgDir, 'index.ts');
const pkgJsonPath = join(pkgDir, 'package.json');

describe('AC1 — 包结构符合 ADR 0005 §5', () => {
  it('五件齐备：schema.vfsl + generated.ts + index.ts + test/ + package.json', () => {
    const entries: [string, string][] = [
      ['schema.vfsl', schemaPath],
      ['generated.ts', generatedPath],
      ['index.ts（增广挂载点）', indexPath],
      ['package.json（纯类型）', pkgJsonPath],
      ['test/', join(pkgDir, 'test')],
    ];
    const missing = entries.filter(([, p]) => !existsSync(p)).map(([name]) => name);
    expect(missing, `领域包缺件：${missing.join('、')}`).toEqual([]);
  });

  it('package.json 可解析且包名 = @nomicore/vfs3-assets（测试唯一依赖的接缝名）', () => {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { name?: string };
    expect(pkg.name).toBe('@nomicore/vfs3-assets');
  });

  it('纯类型包：运行时模块零导出（类型空间产物，编译后为空模块）', async () => {
    const mod = await import('@nomicore/vfs3-assets');
    expect(Object.keys(mod)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC5 — docs 三锚位 TSDoc
// ---------------------------------------------------------------------------

/** 经 SchemaSource 接缝取本领域信封（ADR 0001 脚手架纪律），parse + evaluate 出派生 schema。 */
async function loadDerived(): Promise<DerivedSchema> {
  const source = new FileSchemaSource(repoRoot);
  const ids = await source.list();
  // id/目录名张力未决（见 projection 测试文件头）：兼容 vfs3-assets@N 与 vfs3.assets@N 两种钉法。
  const id = ids.find((i) => /^vfs3[.-]assets@\d+$/.test(i));
  expect(id, `FileSchemaSource.list() 中应存在本领域 id（vfs3-assets@N 或 vfs3.assets@N），实际：${JSON.stringify(ids)}`).toBeDefined();
  const env = await source.load(id as string);
  assertVfslDialect(env); // 消费方首动作 = 方言断言（ADR 0005 §1）
  const parsed = parseVfsl(env.text);
  expect(parsed.ok, `schema.vfsl 解析失败：${JSON.stringify(parsed.ok ? null : parsed.issues)}`).toBe(true);
  if (!parsed.ok) throw new Error('unreachable');
  const result = evaluate(parsed.module);
  expect(result.ok, `schema.vfsl 求值失败：${JSON.stringify(result.ok ? null : result.issues)}`).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.derived;
}

/**
 * tsc parser 视角：挂在声明节点上的 JSDoc 原文（多块拼接，含 @tag——tsc 会把 `@semantic …`
 * 解析为 JSDocTag 而非 comment 文本，故取 jsDoc 节点原始文本最稳）。
 */
function attachedJsDocText(node: ts.Node): string {
  const docs = (node as ts.Node & { jsDoc?: ts.JSDoc[] }).jsDoc ?? [];
  return docs.map((j) => j.getText()).join('\n');
}

/** 逐字锚定：派生 docs 行保留原空白，tsc 解析后的 comment 文本会修剪——按 trim 后包含判定。 */
function expectDocLine(docText: string, line: string, where: string): void {
  expect(docText, `${where} 的 fixture JSDoc 未挂到生成物 TSDoc：${line}`).toContain(line.trim());
}

/** 在 generated.ts 的 AST 上定位 VfslPathMap 增广接口（ROOT doc 与 ROOT 字段 doc 的挂载点）。 */
function findAugmentation(sf: ts.SourceFile): ts.InterfaceDeclaration {
  for (const st of sf.statements) {
    if (!ts.isModuleDeclaration(st) || st.name.text !== '@nomicore/vfsl-protocol' || st.body === undefined) continue;
    const body = ts.isModuleBlock(st.body) ? st.body : undefined;
    for (const inner of body?.statements ?? []) {
      if (ts.isInterfaceDeclaration(inner) && inner.name.text === 'VfslPathMap') return inner;
    }
  }
  throw new Error('generated.ts 中未找到 declare module \'@nomicore/vfsl-protocol\' 的 VfslPathMap 增广');
}

/** 在 generated.ts 顶层找具名别名声明（段②发射位）。 */
function findAlias(sf: ts.SourceFile, name: string): ts.TypeAliasDeclaration {
  const decl = sf.statements.find(
    (st): st is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(st) && st.name.text === name,
  );
  if (decl === undefined) throw new Error(`generated.ts 中未找到别名声明 ${name}`);
  return decl;
}

describe('AC5 — docs 三锚位：fixture JSDoc 全部以 TSDoc 挂载到生成物对应声明', () => {
  it('别名位：aliasDocs 每条非空 JSDoc 逐字挂到对应别名声明（ROOT → VfslPathMap 增广接口）', async () => {
    const derived = await loadDerived();
    const sf = ts.createSourceFile(generatedPath, readFileSync(generatedPath, 'utf8'), ts.ScriptTarget.ES2022, true);
    const checked: string[] = [];
    for (const [name, lines] of Object.entries(derived.aliasDocs)) {
      if (lines.length === 0) continue;
      const host = name === 'ROOT' ? findAugmentation(sf) : findAlias(sf, name);
      const docText = attachedJsDocText(host);
      for (const line of lines) {
        expectDocLine(docText, line, `别名位 ${name}`);
        checked.push(`${name}: ${line}`);
      }
    }
    // 防空转守门：§10 fixture 至少携带 5 条别名位 JSDoc（AssetId/Audit/AssetEntity/Attachments/ROOT）
    expect(checked.length, '别名位扫描空转——fixture 别名 JSDoc 一条都未检出（装置失效？）').toBeGreaterThanOrEqual(5);
  });

  it('字段位：fieldDocs 每条非空 JSDoc 逐字挂到对应字段声明（当前 fixture：ROOT.notes）', async () => {
    const derived = await loadDerived();
    const sf = ts.createSourceFile(generatedPath, readFileSync(generatedPath, 'utf8'), ts.ScriptTarget.ES2022, true);
    const checked: string[] = [];
    for (const [path, lines] of Object.entries(derived.fieldDocs)) {
      if (lines.length === 0) continue;
      // 解析器覆盖 fixture 现存形态：'ROOT.<field>'（→ VfslPathMap 成员）与 '<Alias>.<field>'
      // （→ 别名对象字面量成员）。fixture 出现新锚位形态时必须扩展本解析器——响亮失败不静默跳过。
      const segs = path.split('.');
      let host: ts.Node;
      if (segs.length === 2 && segs[0] === 'ROOT') {
        const iface = findAugmentation(sf);
        const member = iface.members.find(
          (m): m is ts.PropertySignature =>
            ts.isPropertySignature(m) && m.name !== undefined && m.name.getText(sf).replace(/^['"]|['"]$/g, '') === segs[1],
        );
        if (member === undefined) throw new Error(`VfslPathMap 增广中未找到字段 ${segs[1]}`);
        host = member;
      } else if (segs.length === 2) {
        const alias = findAlias(sf, segs[0] as string);
        if (!ts.isTypeLiteralNode(alias.type)) {
          throw new Error(`字段位解析器不支持：${path}（别名 ${segs[0]} 非对象字面量形）`);
        }
        const member = alias.type.members.find(
          (m): m is ts.PropertySignature =>
            ts.isPropertySignature(m) && m.name !== undefined && m.name.getText(sf).replace(/^['"]|['"]$/g, '') === segs[1],
        );
        if (member === undefined) throw new Error(`别名 ${segs[0]} 中未找到字段 ${segs[1]}`);
        host = member;
      } else {
        throw new Error(`字段位解析器不支持的路径形态：${path}（请扩展本测试解析器）`);
      }
      const docText = attachedJsDocText(host);
      for (const line of lines) {
        expectDocLine(docText, line, `字段位 ${path}`);
        checked.push(`${path}: ${line}`);
      }
    }
    // 防空转守门：§10 fixture 至少携带 1 条字段位 JSDoc（ROOT.notes 的 @semantic 可选说明字段）
    expect(checked.length, '字段位扫描空转——fixture 字段 JSDoc 一条都未检出（装置失效？）').toBeGreaterThanOrEqual(1);
  });

  it('标记位：markerDocs 每条非空 JSDoc 逐字出现在生成物 TSDoc（fixture 当前无标记位 JSDoc → 本臂空转，见文件头缺口声明）', async () => {
    const derived = await loadDerived();
    const text = readFileSync(generatedPath, 'utf8');
    for (const [path, lines] of Object.entries(derived.markerDocs)) {
      for (const line of lines) {
        // 标记位 doc 由发射器以行内 `/** … */` 形式置于 PathSchema<…> 前（emitNode），
        // 不挂声明节点（parser 的 jsDoc 数组不收行内类型位注释）——故本臂用逐字在场断言。
        expect(text, `标记位 ${path} 的 fixture JSDoc 未出现在生成物 TSDoc：${line}`).toContain(`/** ${line} */`);
      }
    }
  });
});

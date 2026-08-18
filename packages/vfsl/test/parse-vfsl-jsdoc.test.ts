/**
 * SA6 红灯测试 — 文档注释（doc comment，`/**` 开头）原文捕获与挂载（issue #7）。
 *
 * 契约来源：
 * - docs/vfsl/v1-spec.md（frozen）：§5 注释规则（三态处理表、忽略与捕获边界、
 *   挂载规则、E305、`@tag` 原文保留）+ §2 注记 9（注释是词法级 trivia）+ 附录
 *   §10 fixture 挂载样本（AssetId 两条连续 doc 同挂一节点；`@semantic` 挂 notes?）；
 * - PRD #3（wiki/raw/20260818-prd-vfsl-v1.md）#35/#37：文档注释原文捕获并挂载到
 *   相邻声明性节点；IR 可序列化、可哈希；具体形状经公共接缝 parseVfsl 观察。
 *
 * 断言一律经公共入口 parseVfsl；不测 tokenizer / 内部 AST（内部结构非公共契约）。
 * 挂载断言按「目标节点子树内逐字可见、兄弟节点内不可见」锚定——不锁定 doc 载荷的
 * 字段名与集合形状（PRD #37 实现自由度），只锁定原文逐字保留与挂载位置正确的
 * 行为契约。doc 原文按「`/**` 与注释结束界定符之间的逐字文本」断言（§5 三态
 * 处理表：含内部 `*`、缩进、换行与 `@tag` 行）。
 *
 * 红灯现状（2026-08-18 分支 HEAD，总控探针）：doc 被 tokenizer 当作块注释静默
 * 丢弃，IR 无 doc 载荷；YMap<…> E100；悬空 doc 静默吞掉。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';

/** PRD #3 冻结的公共接缝返回形状。 */
type ParseResult =
  | { ok: true; module: unknown }
  | { ok: false; issues: { message: string; line: number; column: number }[] };

function expectOk(result: ParseResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok: true，实际 ok: false（issues: ${JSON.stringify(result.issues)}）`);
  }
  return result.module;
}

/** PRD #37：IR 可 JSON 序列化（内容哈希缓存的前提）——序列化往返须无损。 */
function expectJsonRoundTrip(value: unknown): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

/** 按声明名定位别名节点（VfslModule.aliases[] 公共形状）。 */
function aliasNode(module: unknown, name: string): { name: string; type?: unknown } {
  const m = module as { aliases?: { name: string; type?: unknown }[] };
  const alias = m.aliases?.find((a) => a.name === name);
  if (alias === undefined) {
    throw new Error(`测试前提失败：IR 中无别名 '${name}'`);
  }
  return alias;
}

/** 定位对象类型中的字段节点（VfslType.object.fields[] 公共形状）。 */
function fieldNode(alias: { name: string; type?: unknown }, name: string): { name: string } {
  const t = alias.type as { kind?: string; fields?: { name: string }[] } | undefined;
  if (t === undefined || t.kind !== 'object' || !Array.isArray(t.fields)) {
    throw new Error(`测试前提失败：别名 '${alias.name}' 的类型不是对象`);
  }
  const field = t.fields.find((f) => f.name === name);
  if (field === undefined) {
    throw new Error(`测试前提失败：对象中无字段 '${name}'`);
  }
  return field;
}

describe('parseVfsl — /** */ 文档注释原文捕获与挂载（issue #7）', () => {
  // —— AC1 + AC3 类型别名位：规格附录 AssetId 两条连续 doc 的样本结构 ——
  const DOC_ASSET_1 =
    '\n * vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位）\n * @since v1 标签行原样保留\n';
  const DOC_ASSET_2 = ' 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|"';

  it('连续两条 doc 逐字保留（含换行/内部 */缩进/@tag 行）、按出现顺序同挂 AssetId，不挂到相邻别名', () => {
    const text = `/**${DOC_ASSET_1}*/\n\n/**${DOC_ASSET_2}*/\ntype AssetId = string;\ntype Other = number;`;
    const module = expectOk(parseVfsl(text));
    expectJsonRoundTrip(module);

    const assetId = JSON.stringify(aliasNode(module, 'AssetId'));
    const other = JSON.stringify(aliasNode(module, 'Other'));
    // 原文逐字保留（含内部 `*`、缩进、换行与 @tag 行）：JSON 序列化必然把换行转义
    // 为 `\n` 两字符、引号转义为 `\"`，原始形态子串在序列化输出中结构上不可能存在——
    // 故以「序列化转义形」为比对口径（设计 §7.4 方向 (b)），对 PRD #37 允许的全部
    // IR 形状（string[] / 拼接 string / 任意字段名）均可满足。
    const e1 = JSON.stringify(DOC_ASSET_1).slice(1, -1); // 含 `\n` 的转义形
    const e2 = JSON.stringify(DOC_ASSET_2).slice(1, -1); // 含 `\"` 的转义形
    expect(assetId).toContain(e1);
    expect(assetId).toContain(e2);
    // 连续多条按出现顺序全部挂载到同一后续节点（§5 挂载规则）
    expect(assetId.indexOf(e1)).toBeLessThan(assetId.indexOf(e2));
    // 挂载到正确节点：不泄漏到相邻别名
    expect(other).not.toContain(e1);
    expect(other).not.toContain(e2);
  });

  // —— AC3 属性位：规格附录 `/** @semantic 可选说明字段 */` 挂 notes? 的样本 ——
  const DOC_FIELD = ' @semantic 可选说明字段 ';

  it('属性位：/** @semantic 可选说明字段 */ 逐字挂到字段 notes，不挂到同对象其他字段', () => {
    const text = `type AssetsDoc = {\n  /**${DOC_FIELD}*/\n  notes?: string;\n  keywords: string;\n};`;
    const module = expectOk(parseVfsl(text));
    expectJsonRoundTrip(module);

    const notes = JSON.stringify(fieldNode(aliasNode(module, 'AssetsDoc'), 'notes'));
    const keywords = JSON.stringify(fieldNode(aliasNode(module, 'AssetsDoc'), 'keywords'));
    expect(notes).toContain(DOC_FIELD);
    expect(keywords).not.toContain(DOC_FIELD);
  });

  // —— AC3 标记类型位：Marker 记号处挂载；YMap<{…}> 语法本切片须接受（§3 形状约束 E304 留 #6）——
  const DOC_MARKER = ' 审计信息：所有写入留痕 ';

  it('标记类型位：doc 挂到 Marker 记号处（YMap 正例，挂载在类型子树内而非别名声明处）', () => {
    const text = `type Audit = /**${DOC_MARKER}*/ YMap<{ createdBy: string; }>;`;
    const module = expectOk(parseVfsl(text));
    expectJsonRoundTrip(module);

    const typeSubtree = JSON.stringify(aliasNode(module, 'Audit').type);
    if (typeSubtree === undefined) {
      throw new Error('测试前提失败：别名 Audit 无 type 载荷');
    }
    expect(typeSubtree).toContain(DOC_MARKER);
  });

  it('悬空文档注释（doc 后直到模块末尾无可挂载节点）→ VFSL-E305，锚注释起始（§5 挂载规则）', () => {
    const result = parseVfsl('type A = string;\n/** 悬空文档注释 */');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      // §4：以 message 冻结前缀为断言锚（消息正文措辞不冻结）
      expect(result.issues[0]!.message).toMatch(/^VFSL-E305: /);
      // §4 定位锚：注释起始（line 2, column 1）
      expect(result.issues[0]!.line).toBe(2);
      expect(result.issues[0]!.column).toBe(1);
    }
  });

  it('忽略型注释（// 与 /* */）出现在 doc 与目标节点之间不破坏相邻挂载（§5 挂载规则 ∩ AC2）', () => {
    const doc = ' 前导文档 ';
    const text = `/**${doc}*/ // 行注释\n/* 块注释 */ type A = string;`;
    const module = expectOk(parseVfsl(text));
    expect(JSON.stringify(aliasNode(module, 'A'))).toContain(doc);
  });

  it('`//` 与 `/* */` 不影响解析结果：有无比对 IR 一致（AC2）', () => {
    const plain = expectOk(parseVfsl('type A = string;\ntype B = { x: number };'));
    const withComments = expectOk(
      parseVfsl('// 行注释\n/* 块注释 */ type A = string; /* 尾部块 */\ntype B = { /* 字段间 */ x: number }; // 行尾'),
    );
    expect(withComments).toEqual(plain);
  });

  it('特例 `/**/` 与 `/***/` 是块注释而非文档注释：有无比对 IR 一致（§5 忽略与捕获边界）', () => {
    const plain = expectOk(parseVfsl('type A = string;'));
    const edge = expectOk(parseVfsl('/**/ type A = string; /***/'));
    expect(edge).toEqual(plain);
  });
});

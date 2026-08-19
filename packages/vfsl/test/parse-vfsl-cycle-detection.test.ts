/**
 * SA6 验收测试 — Parser 环检测与 §10 fixture 全量解析（issue #9）。
 *
 * 契约来源（docs/vfsl/v1-spec.md，frozen）：
 * - §4「递归与循环引用检测」：类型别名引用图成环即拒绝——自引用（含经容器包裹的
 *   `type A = { x: A[] };`）与互引用（A→B→A）同样 → VFSL-E106；消息携带环路径
 *   （如 `A → B → A`），line/column 为检测到再入的引用记号；
 * - §4「错误数量与恢复策略」：E106 属引用 / 语义相位（模块全量解析成功后才进入），
 *   issues 恰含 1 条，message 前缀 `VFSL-E<三位>: ` 冻结（断言前缀，不锁正文措辞）；
 * - §5 挂载规则：文档注释（`/**` 起头的注释）原文捕获（逐字保留），挂载到紧邻的
 *   声明性节点（类型别名 / 属性 / 标记类型三锚位）；连续多条按出现顺序全挂同一节点；
 *   `docs: string[]` 无 doc 时为空数组（#7 §7.2 契约）；
 * - §10 附录 `vfs3.assets` 参考 fixture 全文（本文件 fixture 逐字复刻）；
 * - PRD #3：IR 必须可序列化、可哈希（内容哈希缓存的前提）。
 *
 * 锚定策略：以 Issue #9 四条 AC 为锚独立编写，输入形状与 #6/#7 既有用例不重复
 * （#6/#7 已有：单行自引用 `{ x: A }`、两节点对象互引用、fixture ok+roundtrip+正则
 * 原文；本文件新增：容器包裹自引用 / 多行自引用 / 标记实参自引用、标记传递互引用 /
 * 三节点环 / 纯别名链环（边界）/ Record 值位环 / Record 键位环 / 联合成员位环、fixture 七条 JSDoc 逐节点挂载、
 * 环路径进消息、序列化确定性）。全部断言经公共接缝 parseVfsl 运行时行为，无源码 grep。
 */
import { describe, expect, it } from 'vitest';
import { parseVfsl } from '../src/index.js';

/** PRD #3 冻结的公共接缝返回形状。 */
type ParseResult =
  | { ok: true; module: unknown }
  | { ok: false; issues: { message: string; line: number; column: number }[] };

type Issue = { message: string; line: number; column: number };

/** 断言 ok: true 并返回 module（module 形状不锁定，断言时按需探测）。 */
function expectOk(result: ParseResult): unknown {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`期望 ok: true，实际 ok: false（issues: ${JSON.stringify(result.issues)}）`);
  }
  return result.module;
}

/** PRD 验收：IR 可 JSON 序列化（内容哈希缓存的前提）——序列化往返须无损。 */
function expectJsonRoundTrip(value: unknown): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

/** 断言 ok: false、issues 恰含 1 条，且字段形状 / 行列基准 / message 前缀全部合规。 */
function expectSingleIssue(result: ParseResult): Issue {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`期望 ok: false，实际 ok: true（module: ${JSON.stringify(result.module)}）`);
  }
  expect(result.issues).toHaveLength(1);
  const issue = result.issues[0];
  expect(issue).toBeDefined();
  if (!issue) {
    throw new Error('issues 数组为空');
  }
  // message 冻结前缀格式（§4 错误码传递通道）：VFSL-E<编号>: <消息>
  expect(issue.message).toMatch(/^VFSL-E\d{3}: /);
  // line/column 均 1 起
  expect(Number.isInteger(issue.line)).toBe(true);
  expect(issue.line).toBeGreaterThanOrEqual(1);
  expect(Number.isInteger(issue.column)).toBe(true);
  expect(issue.column).toBeGreaterThanOrEqual(1);
  return issue;
}

/** 断言错误码前缀（不锁消息全文，§4 措辞自由度）。 */
function expectCode(issue: Issue, code: string): void {
  expect(issue.message).toMatch(new RegExp(`^VFSL-E${code}: `));
}

/** 断言错误码前缀 + 精确锚点行列（§4 定位锚冻结）。 */
function expectIssueAt(issue: Issue, code: string, line: number, column: number): void {
  expectCode(issue, code);
  expect(issue.line).toBe(line);
  expect(issue.column).toBe(column);
}

/** 按声明名定位别名节点（VfslModule.aliases[] 公共形状）。 */
function aliasNode(module: unknown, name: string): { name: string; type?: unknown; docs?: string[] } {
  const m = module as { aliases?: { name: string; type?: unknown; docs?: string[] }[] };
  const alias = m.aliases?.find((a) => a.name === name);
  if (alias === undefined) {
    throw new Error(`测试前提失败：IR 中无别名 '${name}'`);
  }
  return alias;
}

/** 定位别名类型中的对象载荷（marker 包裹时下钻 arg——VfslType 公共形状）。 */
function objectFieldsOf(
  alias: { name: string; type?: unknown },
): { name: string; docs?: string[]; optional?: boolean; type?: unknown }[] {
  let t = alias.type as { kind?: string; marker?: string; arg?: unknown; fields?: { name: string }[] } | undefined;
  if (t?.kind === 'marker') {
    t = t.arg as typeof t;
  }
  if (t === undefined || t.kind !== 'object' || !Array.isArray(t.fields)) {
    throw new Error(`测试前提失败：别名 '${alias.name}' 的类型（marker 下钻后）不是对象`);
  }
  return t.fields as { name: string; docs?: string[]; optional?: boolean; type?: unknown }[];
}

/** 定位对象（含 marker 包裹）类型中的字段节点（VfslType.object.fields[] 公共形状）。 */
function fieldNode(
  alias: { name: string; type?: unknown },
  name: string,
): { name: string; docs?: string[]; optional?: boolean; type?: unknown } {
  const field = objectFieldsOf(alias).find((f) => f.name === name);
  if (field === undefined) {
    throw new Error(`测试前提失败：对象中无字段 '${name}'`);
  }
  return field;
}

describe('AC1 — 自引用别名被拒，错误含行列（issue #9 / spec §4）', () => {
  it('容器包裹自引用（spec §4 明示形态）：type A = { x: A[] }; → E106，锚再入引用记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = { x: A[] };'));
    expectIssueAt(issue, '106', 1, 15);
  });

  it('多行对象自引用：锚再入引用记号的行列（line 2, column 6）', () => {
    const issue = expectSingleIssue(parseVfsl('type A = {\n  x: A;\n};'));
    expectIssueAt(issue, '106', 2, 6);
  });

  it('标记实参自引用：type A = YArray<A>; → E106（引用边来自 Marker 实参）', () => {
    const issue = expectSingleIssue(parseVfsl('type A = YArray<A>;'));
    expectIssueAt(issue, '106', 1, 17);
  });
});

describe('AC2 — 互引用环（A→B→A）被拒（issue #9 / spec §4）', () => {
  it('经标记传递的两节点环 → E106，锚再入引用记号，消息含环路径 A → B → A', () => {
    const issue = expectSingleIssue(parseVfsl('type A = YArray<B>;\ntype B = YMap<{ a: A }>;'));
    expectIssueAt(issue, '106', 2, 20);
    // §4：消息携带环路径（如 `A → B → A`）
    expect(issue.message).toContain('A → B → A');
  });

  it('三节点环（A→B→C→A）→ E106，消息含完整环路径 A → B → C → A', () => {
    const issue = expectSingleIssue(parseVfsl('type A = { b: B };\ntype B = { c: C };\ntype C = { a: A };'));
    expectIssueAt(issue, '106', 3, 15);
    expect(issue.message).toContain('A → B → C → A');
  });

  it('边界：纯别名链环（无容器包裹）type A = B; type B = A; → E106', () => {
    const issue = expectSingleIssue(parseVfsl('type A = B;\ntype B = A;'));
    expectIssueAt(issue, '106', 2, 10);
    expect(issue.message).toContain('A → B → A');
  });

  it('经 Record 值位成环（A→B→A）→ E106，锚再入引用记号', () => {
    const issue = expectSingleIssue(parseVfsl('type A = Record<string, B>;\ntype B = { a: A };'));
    expectIssueAt(issue, '106', 2, 15);
    expect(issue.message).toContain('A → B → A');
  });

  it('Record 键位自引用环：type A = Record<A, string>; → E106（边源 = Record 键），锚再入引用记号 (1,17)，消息含 A → A', () => {
    const issue = expectSingleIssue(parseVfsl('type A = Record<A, string>;'));
    expectIssueAt(issue, '106', 1, 17);
    expect(issue.message).toContain('A → A');
  });

  it('联合成员位互引用环：type A = { x: B }; type B = A | { y: string }; → E106（边源 = 联合成员），锚再入引用记号 (2,10)，消息含 A → B → A', () => {
    const issue = expectSingleIssue(parseVfsl('type A = { x: B };\ntype B = A | { y: string };'));
    expectIssueAt(issue, '106', 2, 10);
    expect(issue.message).toContain('A → B → A');
  });
});

describe('AC3 — vfs3.assets fixture 全量解析为完整 IR，JSDoc 原文挂载正确（issue #9 / spec §10 ∩ §5）', () => {
  // §10 附录 fixture 逐字复刻（含 Pattern 实参反斜杠双写 `\\-`，§2 注记 6）
  const fixture = `
/** vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） */

/** 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" */
type AssetId = string & Pattern<"^[A-Za-z0-9_\\\\-]{1,64}$">;

/** 审计信息：所有写入留痕 */
type Audit = YMap<{
  createdBy: YLeaf<string>;
  createdAt: YLeaf<number>;
}>;

/** 资产实体：按 kind 判别的封闭联合 */
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }
  | { kind: "text"; body: YLeaf<string>; audit: Audit }
  | { kind: "file"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };

/** 附件：与 Yjs 同步无关的纯值数组 */
type Attachments = YPlainArray<YLeaf<string>>;

/** AssetsDoc：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 */
type AssetsDoc = YXmlFragment<{
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  audit: Audit;
  /** @semantic 可选说明字段 */
  notes?: YLeaf<string>;
  keywords: YLeaf<string>[];
}>;
`.trim();

  // 七条文档注释的原文捕获期望（逐字保留：`/**` 与 `*/` 之间内容含首尾空格）
  const DOC_FIXTURE = ' vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） ';
  const DOC_ASSET_ID = ' 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" ';
  const DOC_AUDIT = ' 审计信息：所有写入留痕 ';
  const DOC_ASSET_ENTITY = ' 资产实体：按 kind 判别的封闭联合 ';
  const DOC_ATTACHMENTS = ' 附件：与 Yjs 同步无关的纯值数组 ';
  const DOC_ASSETSDOC = ' AssetsDoc：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 ';
  const DOC_NOTES = ' @semantic 可选说明字段 ';

  it('fixture 全量解析 ok: true，五个别名按声明顺序齐全（幸福路径）', () => {
    const module = expectOk(parseVfsl(fixture));
    const names = (module as { aliases?: { name: string }[] }).aliases?.map((a) => a.name);
    expect(names).toEqual(['AssetId', 'Audit', 'AssetEntity', 'Attachments', 'AssetsDoc']);
  });

  it('六标记全部进入 IR：Pattern / YMap / YLeaf / YArray / YPlainArray / YXmlFragment（spec §10 覆盖声明）', () => {
    const module = expectOk(parseVfsl(fixture));

    // AssetId → Pattern（string & Pattern<"…"> 的约束侧，解码后原文）
    const assetIdType = aliasNode(module, 'AssetId').type as { kind?: string; regex?: string };
    expect(assetIdType.kind).toBe('pattern');
    // §2 注记 6：`\\-` 双写解码为单反斜杠原文
    expect(assetIdType.regex).toBe('^[A-Za-z0-9_\\-]{1,64}$');

    // Audit → YMap
    const auditType = aliasNode(module, 'Audit').type as { kind?: string; marker?: string };
    expect(auditType.kind).toBe('marker');
    expect(auditType.marker).toBe('YMap');

    // Attachments → YPlainArray<YLeaf<string>>（纯值上下文嵌套标记）
    const attachmentsType = aliasNode(module, 'Attachments').type as {
      kind?: string;
      marker?: string;
      arg?: { kind?: string; marker?: string; arg?: { kind?: string; name?: string } };
    };
    expect(attachmentsType.kind).toBe('marker');
    expect(attachmentsType.marker).toBe('YPlainArray');
    expect(attachmentsType.arg?.kind).toBe('marker');
    expect(attachmentsType.arg?.marker).toBe('YLeaf');
    expect(attachmentsType.arg?.arg?.kind).toBe('primitive');
    expect(attachmentsType.arg?.arg?.name).toBe('string');

    // AssetsDoc → YXmlFragment
    const assetsDocType = aliasNode(module, 'AssetsDoc').type as { kind?: string; marker?: string };
    expect(assetsDocType.kind).toBe('marker');
    expect(assetsDocType.marker).toBe('YXmlFragment');

    // YArray 出现于嵌套位：AssetEntity 的 "file" 成员 tags: YArray<YLeaf<string>>
    const fileMember = (aliasNode(module, 'AssetEntity').type as {
      members?: { fields?: { name: string; type?: unknown }[] }[];
    }).members?.[2];
    const tags = fileMember?.fields?.find((f) => f.name === 'tags')?.type as {
      kind?: string;
      marker?: string;
      arg?: { kind?: string; marker?: string };
    };
    expect(tags.kind).toBe('marker');
    expect(tags.marker).toBe('YArray');
    expect(tags.arg?.kind).toBe('marker');
    expect(tags.arg?.marker).toBe('YLeaf');

    // YLeaf 出现于嵌套位：keywords: YLeaf<string>[] 的数组元素为 YLeaf 标记
    const keywords = fieldNode(aliasNode(module, 'AssetsDoc'), 'keywords').type as {
      kind?: string;
      element?: { kind?: string; marker?: string };
    };
    expect(keywords.kind).toBe('array');
    expect(keywords.element?.kind).toBe('marker');
    expect(keywords.element?.marker).toBe('YLeaf');
  });

  it('JSDoc 原文逐节点挂载正确：别名锚位六条（含 AssetId 连续两条）+ 属性锚位一条，互不泄漏', () => {
    const module = expectOk(parseVfsl(fixture));

    // 别名锚位：AssetId 连续两条按出现顺序同挂一节点（§5 挂载规则 ∩ spec §10 挂载表）
    expect(aliasNode(module, 'AssetId').docs).toEqual([DOC_FIXTURE, DOC_ASSET_ID]);
    expect(aliasNode(module, 'Audit').docs).toEqual([DOC_AUDIT]);
    expect(aliasNode(module, 'AssetEntity').docs).toEqual([DOC_ASSET_ENTITY]);
    expect(aliasNode(module, 'Attachments').docs).toEqual([DOC_ATTACHMENTS]);
    expect(aliasNode(module, 'AssetsDoc').docs).toEqual([DOC_ASSETSDOC]);

    // 属性锚位：/** @semantic 可选说明字段 */ 逐字挂到字段 notes（docs 非空），
    // 同对象其他字段不泄漏（docs 为空数组——#7 §7.2 必填契约）
    const notes = fieldNode(aliasNode(module, 'AssetsDoc'), 'notes');
    expect(notes.docs).toEqual([DOC_NOTES]);
    expect(notes.optional).toBe(true);
    for (const other of ['assets', 'attachments', 'audit', 'keywords']) {
      expect(fieldNode(aliasNode(module, 'AssetsDoc'), other).docs).toEqual([]);
    }
  });

  it('判别联合 AssetEntity 三成员（字面量 kind 判别）与 Record<AssetId, AssetEntity> 键约束入 IR', () => {
    const module = expectOk(parseVfsl(fixture));

    // AssetEntity：三成员联合，成员全部对象形，首成员首字段为 kind 字面量判别
    const entityType = aliasNode(module, 'AssetEntity').type as {
      kind?: string;
      members?: { kind?: string; fields?: { name: string; type?: { kind?: string; value?: unknown } }[] }[];
    };
    expect(entityType.kind).toBe('union');
    expect(entityType.members).toHaveLength(3);
    const kinds = entityType.members?.map((m) => {
      const kindField = m.fields?.find((f) => f.name === 'kind');
      return kindField?.type?.kind === 'literal' ? kindField.type.value : undefined;
    });
    expect(kinds).toEqual(['image', 'text', 'file']);

    // assets: Record<AssetId, AssetEntity> —— 键/值经别名引用进 IR（键约束未折叠）
    const assets = fieldNode(aliasNode(module, 'AssetsDoc'), 'assets').type as {
      kind?: string;
      key?: { kind?: string; name?: string };
      value?: { kind?: string; name?: string };
    };
    expect(assets.kind).toBe('record');
    expect(assets.key).toEqual({ kind: 'ref', name: 'AssetId' });
    expect(assets.value).toEqual({ kind: 'ref', name: 'AssetEntity' });
  });
});

describe('AC4 — 产出的 IR 可 JSON 序列化（内容哈希缓存的前提，PRD #3）', () => {
  const fixture = `
/** vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） */

/** 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" */
type AssetId = string & Pattern<"^[A-Za-z0-9_\\\\-]{1,64}$">;

/** 审计信息：所有写入留痕 */
type Audit = YMap<{
  createdBy: YLeaf<string>;
  createdAt: YLeaf<number>;
}>;

/** 资产实体：按 kind 判别的封闭联合 */
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }
  | { kind: "text"; body: YLeaf<string>; audit: Audit }
  | { kind: "file"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };

/** 附件：与 Yjs 同步无关的纯值数组 */
type Attachments = YPlainArray<YLeaf<string>>;

/** AssetsDoc：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 */
type AssetsDoc = YXmlFragment<{
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  audit: Audit;
  /** @semantic 可选说明字段 */
  notes?: YLeaf<string>;
  keywords: YLeaf<string>[];
}>;
`.trim();

  it('fixture IR JSON 往返无损（JSON.parse(JSON.stringify(module)) ≡ module）', () => {
    const module = expectOk(parseVfsl(fixture));
    expectJsonRoundTrip(module);
  });

  it('确定性：同一文本两次独立解析产出完全相同的序列化（内容哈希的前提）', () => {
    const a = JSON.stringify(expectOk(parseVfsl(fixture)));
    const b = JSON.stringify(expectOk(parseVfsl(fixture)));
    expect(a).toBe(b);
  });

  it('全部 kind 覆盖：primitive / literal / ref / object / union / array / record / marker / pattern 的 IR 往返无损', () => {
    const text = [
      'type Prim = string | 80 | null | unknown | boolean | number;',
      'type P = string & Pattern<"^[a-z]+$">;',
      'type Nested = YMap<{',
      '  arr: YArray<string | number>;',
      '  rec: Record<string, P>;',
      '  plain: YPlainArray<{ a: string }>;',
      '}>;',
      'type Root = { first: Nested; second?: P[]; third: "x" | "y" };',
    ].join('\n');
    const module = expectOk(parseVfsl(text));
    expectJsonRoundTrip(module);
  });
});

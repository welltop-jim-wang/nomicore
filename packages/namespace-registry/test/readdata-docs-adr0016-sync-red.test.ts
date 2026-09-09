/**
 * SA6 红灯契约 — issue #274：typed-access skill 与 docs/integration 覆盖
 * readData 语义 schema 投影（ADR 0016）的**文档同步验收**。
 *
 * 任务类型：feature（文档能力缺口——仓库行为已随 #273/#272 合入 HEAD，规范面
 * （ADR-0016/ADR-0008 修订节/CONTEXT 词条）已就位，缺的是**面向集成方与 agent
 * 消费者**的文档同步：typed-access 指引未说明成功读的 `schema` 字段形态/null
 * 语义/典型消费方式；docs/integration 的 readData 示例仍含与 ADR-0016 矛盾的
 * 两键全等形状注记。
 *
 * 断言面（全部 RED at HEAD）：
 * - R1  typed-access.md 引用 ADR-0016（挂接权威源）；
 * - R2  typed-access.md 说明「成功读随值携带路径语义 schema 投影（projection/投影）」；
 * - R3  typed-access.md 说明投影体四键（valueSchema/aliases/docs/aliasDocs 具名
 *       或 ReadDataSchemaProjection）；
 * - R4  typed-access.md 说明 docs/aliasDocs 切片键规约与派生 schema 文档表同构
 *       （路径寻址/别名名锚定）；
 * - R5  typed-access.md 给出「schema 为 null 不是读的失败」判读指引；
 * - R6  typed-access.md 说明典型消费方式：凭投影解读值并构造读后合法 mutation；
 * - R7  docs/integration/cordis-plugin-hosting.md 的 readData 成功形状注记
 *       `// { ok: true, value: 'first' }` 不含 schema——与运行时实际输出
 *       （`{ ok: true, value, schema }`，#273 已合入）矛盾，必须同步。
 *
 * 匹配器为内容锚（见 `readdata-docs-adr0016-contract-fixture.ts` 头注），其敏感性
 * 由同目录 control 文件的样本双向校验（正样本绿/负样本红），防关键词空转伪绿。
 * 本文件在目标文档同步后应全绿；同步前每一条失败的断言消息即缺口的可观测证据。
 */
import { describe, expect, it } from 'vitest';
import {
  SCOPE_DOCS,
  adr0016Refs,
  hasConsumptionParagraph,
  hasFourKeyParagraph,
  hasKeyConventionParagraph,
  hasNullSemanticsParagraph,
  hasShapeParagraph,
  readRepoDoc,
  staleAnnotationViolations,
} from './readdata-docs-adr0016-contract-fixture.js';

const TYPED_ACCESS = readRepoDoc(SCOPE_DOCS.typedAccess);
const CORDIS_HOSTING = readRepoDoc(SCOPE_DOCS.cordisHosting);

describe('issue #274 R1–R2：typed-access 说明成功读的 schema 字段与投影形态', () => {
  it('R1 typed-access.md 引用 ADR-0016（权威形态来源挂接）', () => {
    expect(
      adr0016Refs(TYPED_ACCESS),
      'typed-access.md 必须引用 ADR 0016（或 docs/adr/0016-readdata-semantic-schema-projection.md 锚点）作为 readData 语义 schema 投影的权威形态来源',
    ).toBe(true);
  });

  it('R2 typed-access.md 说明成功读随值携带路径语义 schema 投影（schema 字段）', () => {
    expect(
      hasShapeParagraph(TYPED_ACCESS),
      'typed-access.md 须有一段说明「readData 成功读在值之外返回该路径的语义 schema 投影（schema 字段）」（同一段落含 readData 与规范词形「schema 投影 / schema projection」）',
    ).toBe(true);
  });
});

describe('issue #274 R3–R4：schema 字段形态（四键投影体 + docs 键规约）', () => {
  it('R3 typed-access.md 说明投影体四键（valueSchema/aliases/docs/aliasDocs 具名，或 ReadDataSchemaProjection）', () => {
    expect(
      hasFourKeyParagraph(TYPED_ACCESS),
      'typed-access.md 须具名投影体四键（同一段落含 valueSchema 与 aliasDocs——值语义子树/别名闭包/注释切片形态；贴出 ReadDataSchemaProjection 接口亦可）',
    ).toBe(true);
  });

  it('R4 typed-access.md 说明 docs/aliasDocs 切片键规约与派生 schema 文档表同构（路径寻址/别名名锚定）', () => {
    expect(
      hasKeyConventionParagraph(TYPED_ACCESS),
      'typed-access.md 须说明 docs/aliasDocs 的键规约与派生 schema 文档三表同构（§3 绝对语法路径/合成段寻址、别名以别名名锚定——含 aliasDocs + 同构/synthetic/寻址/键规约 等锚词）',
    ).toBe(true);
  });
});

describe('issue #274 R5–R6：null 语义判读 + 典型消费方式', () => {
  it('R5 typed-access.md 给出「schema 为 null 不是读的失败」判读指引', () => {
    expect(
      hasNullSemanticsParagraph(TYPED_ACCESS),
      'typed-access.md 须说明 schema 可为 null 且 null 不是读的失败（读的 ok 恒真；段落须含 null 与「不是读的失败 / not a read failure」规范判读语）',
    ).toBe(true);
  });

  it('R6 typed-access.md 说明典型消费方式：凭投影解读值并构造读后合法 mutation', () => {
    expect(
      hasConsumptionParagraph(TYPED_ACCESS),
      'typed-access.md 须说明消费方式（读后修改场景凭随读的「schema 投影」解读值语义并构造合法 mutation——段落须含「schema 投影」词形与 mutation/mutateData）',
    ).toBe(true);
  });
});

describe('issue #274 R7：docs/integration readData 示例形状注记同步', () => {
  it('R7 cordis-plugin-hosting.md 不再含两键全等成功形状注记（缺 schema 的 `// { ok: true, value: … }`）', () => {
    const violations = staleAnnotationViolations(CORDIS_HOSTING);
    expect(
      violations,
      'cordis-plugin-hosting.md 的 readData 成功形状注记必须同步为含 schema 的形状（或删除全等注记）；ADR-0016 后成功分支恰三键 { ok, value, schema }。当前过时注记：'
        + violations.join(' | '),
    ).toEqual([]);
  });
});

/**
 * issue #274 验收契约共享夹具（非测试文件，vitest 不收集——无 .test.ts 后缀）。
 *
 * 用途：为「typed-access skill 与 docs/integration 覆盖 readData 语义 schema 投影
 * （ADR 0016）」的文档同步验收提供（a）作用域文档路径、（b）仓库文档读取、
 * （c）可独立做敏感性单元验证的内容匹配器。
 *
 * 匹配器语义（每个匹配器 = 一份验收要求的最小内容锚；匹配器本身以纯文本为输入，
 * 敏感性由 `readdata-docs-adr0016-sync-control.test.ts` 的正/负样本双向校验，防止
 * 关键词空转/伪绿）：
 * - shape：同一段落出现 readData 与词汇同构的「schema 投影 / schema projection」
 *   相邻短语（ADR-0016/CONTEXT 的规范词形「语义 schema 投影」）——文档必须说明
 *   「成功读随值携带该路径的语义 schema 投影」这一结果面事实；相邻短语锚防止
 *   「生成的静态类型投影 + schema.vfsl」等无关同段落关键词的伪绿；
 * - fourKey：某段落同时出现 valueSchema 与 aliasDocs（四键投影体的两个代表标识）——
 *   形态说明必须具名投影体（或贴出 ReadDataSchemaProjection 接口），不能只说
 *   「有 schema」；
 * - keyConvention：某段落出现 aliasDocs 且带键规约锚词（同构/synthetic/寻址/
 *   键规约/same convention/isomorphic）——docs/aliasDocs 切片键规约须与派生
 *   schema 文档表同构（路径寻址/别名名锚定）；
 * - nullSemantics：某段落同时出现 null 与「不是读的失败 / not a read failure」
 *   （ADR-0016 L22 / CONTEXT 词条的规范判读语）——「schema 为 null 不是读的失败」
 *   判读指引；
 * - consumption：同一段落出现「schema 投影」相邻短语与（mutation|mutateData）——
 *   典型消费方式须覆盖「凭投影解读值并构造读后合法 mutation」场景；
 * - adr0016Refs：文件级出现 ADR-0016 / 0016-readdata 引用——文档必须挂接权威
 *   规范源（docs/AGENTS：链接权威源而非复制规则）；
 * - staleAnnotationViolations：行级注释形如 `// { ok: true, value: ... }` 且不含
 *   schema —— ADR-0016 后成功分支恰三键，此类两键全等形状注记即过时陈述；
 * - readDataOptionUsages：readData(path, …) 带第二实参的用法——ADR-0016 交付纪律
 *   always-on（无 opt-in 开关），文档不得发明带参读面。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** issue #274 作用域文档（typed-access skill + docs/integration 消费 readData 的文档）。 */
export const SCOPE_DOCS = {
  typedAccess: '.agents/skills/nomicore/typed-access.md',
  cordisHosting: 'docs/integration/cordis-plugin-hosting.md',
  externalCodegen: 'docs/integration/external-project-vfsl-codegen.md',
} as const;

export function readRepoDoc(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** 段 = 空行分隔的文本块（含代码块——代码块内也是文档内容）。 */
export function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/u);
}

const RE_READ_DATA = /\breadData\b/u;
const RE_SCHEMA = /\bschema\b/ui;
/** 规范词形「schema 投影 / schema projection」（容忍反引号/角括号包裹与零空格）。 */
const RE_SCHEMA_PROJECTION = /`?schema`?\s*(?:投影|projection)/ui;
const RE_VALUE_SCHEMA = /\bvalueSchema\b/u;
const RE_ALIAS_DOCS = /\baliasDocs\b/u;
const RE_KEY_CONVENTION = /同构|synthetic|寻址|键规约|same convention|isomorphic|isomorphism/ui;
const RE_NULL_NOT_FAILURE = /不是读的失败|not a read failure/ui;
const RE_MUTATION = /mutation|mutateData/ui;

/** 要求 R2：说明「成功读 = 值 + 语义 schema 投影」的段落存在。 */
export function hasShapeParagraph(text: string): boolean {
  return paragraphs(text).some((p) => RE_READ_DATA.test(p) && RE_SCHEMA_PROJECTION.test(p));
}

/** 要求 R3：投影体四键具名（valueSchema + aliasDocs 代表锚）。 */
export function hasFourKeyParagraph(text: string): boolean {
  return paragraphs(text).some((p) => RE_VALUE_SCHEMA.test(p) && RE_ALIAS_DOCS.test(p));
}

/** 要求 R4：docs/aliasDocs 键规约与派生 schema 文档表同构（路径寻址/别名名锚定）。 */
export function hasKeyConventionParagraph(text: string): boolean {
  return paragraphs(text).some((p) => RE_ALIAS_DOCS.test(p) && RE_KEY_CONVENTION.test(p));
}

/** 要求 R5：「schema 为 null 不是读的失败」判读指引段落。 */
export function hasNullSemanticsParagraph(text: string): boolean {
  return paragraphs(text).some((p) => /\bnull\b/ui.test(p) && RE_NULL_NOT_FAILURE.test(p));
}

/** 要求 R6：典型消费方式——凭投影解读/构造读后合法 mutation。 */
export function hasConsumptionParagraph(text: string): boolean {
  return paragraphs(text).some((p) => RE_SCHEMA_PROJECTION.test(p) && RE_MUTATION.test(p));
}

/** 要求 R1：文档必须引用 ADR-0016（或 0016-readdata 锚点）。 */
export function adr0016Refs(text: string): boolean {
  return /ADR\s*[-–—]?\s*0016|0016[-_\s]?readdata/ui.test(text);
}

/**
 * 要求 R7（docs/integration 示例同步）：返回「两键全等成功形状注释行」（行注释
 * `// { ok: true, value: …` 且不含 schema）——ADR-0016 后成功分支恰三键
 * `{ ok, value, schema }`，此类注记是过时/矛盾陈述。
 */
export function staleAnnotationViolations(text: string): string[] {
  return text
    .split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /\/\/\s*\{\s*ok\s*:\s*true/ui.test(line))
    .filter(({ line }) => !RE_SCHEMA.test(line))
    .map(({ line, i }) => `L${i + 1}: ${line.trim()}`);
}

/** 负控：作用域文档不得出现 readData 带第二实参的用法（ADR-0016 always-on，无 opt-in）。 */
export function readDataOptionUsages(text: string): string[] {
  return text
    .split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /readData\s*\([^)]*,/u.test(line))
    .map(({ line, i }) => `L${i + 1}: ${line.trim()}`);
}

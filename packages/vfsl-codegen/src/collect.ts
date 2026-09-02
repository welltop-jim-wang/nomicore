/**
 * CLI 编排纯函数（§5.3）：FileSchemaSource 消费 + 方言断言 + parse/evaluate +
 * 逐 id 生成 → { outPath, text }[]。
 *
 * outPath 推导 = F2 施加的约定（R2/SA2 #3）：SchemaSource 接缝不暴露来源目录
 * （信封仅 lang/version/id/text），CLI 只能从 id 推导——`idBase = id 剥离 @<digits>
 * 后缀`，生成位 = `<root>/domains/<idBase>/generated.ts`（ADR 0005 §5）。约定破坏
 * （目录不存在）→ 响亮 exit 2，诊断消息写明规则本体。
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSchemaSource, assertVfslDialect, evaluate, parseVfsl } from '@nomicore/vfsl';
import type { SchemaEnvelope } from '@nomicore/vfsl';
import { generateProjection } from './emitter.js';

export interface ProjectionOutput {
  id: string;
  idBase: string;
  outPath: string;
  text: string;
}

/** 生成期业务错误（parse/evaluate 失败、idBase 约定破坏、同目录多 id 冲突）→ CLI exit 2。 */
export class ProjectionError extends Error {
  readonly id: string | undefined;

  constructor(message: string, id?: string) {
    super(message);
    this.name = 'ProjectionError';
    if (id !== undefined) {
      this.id = id;
    }
  }
}

/** §5.3 流程 2–5：list → 逐 id load/断言/parse/evaluate/生成 → 冲突检查。 */
export async function collectProjections(root: string, domain?: string): Promise<ProjectionOutput[]> {
  const source = new FileSchemaSource(root);
  const ids = await source.list();
  const selectedIds = domain === undefined
    ? ids
    : ids.filter((id) => baseOf(id) === domain);
  if (domain !== undefined && selectedIds.length === 0) {
    throw new ProjectionError(`领域不存在：'${domain}'（期望 domains/${domain}/schema.vfsl）`);
  }
  if (domain !== undefined && selectedIds.length !== 1) {
    throw new ProjectionError(`领域 '${domain}' 必须恰好对应一个 schema，实际 ${selectedIds.length} 个`);
  }
  const outputs: ProjectionOutput[] = [];
  const outByPath = new Map<string, string>();
  for (const id of selectedIds) {
    const env = await source.load(id);
    assertVfslDialect(env); // 消费方首动作 = 方言断言（ADR 0005 §1）
    const text = projectionText(env);
    const idBase = baseOf(id);
    await assertIdBaseDir(root, idBase, id);
    const outPath = join(root, 'domains', idBase, 'generated.ts');
    const prev = outByPath.get(outPath);
    if (prev !== undefined) {
      throw new ProjectionError(
        `同目录多 id 冲突：'${prev}' 与 '${id}' 均映射到 ${outPath}（v1 一域一 schema 约定）`,
        id,
      );
    }
    outByPath.set(outPath, id);
    outputs.push({ id, idBase, outPath, text });
  }
  return outputs;
}

/** parse + evaluate + 纯发射；失败 → ProjectionError（issues 全文进 stderr）。 */
function projectionText(env: SchemaEnvelope): string {
  const parsed = parseVfsl(env.text);
  if (!parsed.ok) {
    throw new ProjectionError(
      `[parse] 领域 '${env.id}' 解析失败：\n${parsed.issues.map((i) => `${i.line}:${i.column} ${i.message}`).join('\n')}`,
      env.id,
    );
  }
  const result = evaluate(parsed.module);
  if (!result.ok) {
    throw new ProjectionError(
      `[evaluate] 领域 '${env.id}' 求值失败：\n${result.issues.map((i) => `${i.line}:${i.column} ${i.message}`).join('\n')}`,
      env.id,
    );
  }
  return generateProjection(result.derived, { sourceText: env.text });
}

/** id 剥离尾部 `@<digits>` 后缀（无后缀 → 整串）。 */
function baseOf(id: string): string {
  return /^(.+)@(\d+)$/.exec(id)?.[1] ?? id;
}

/** idBase 目录存在性（F2 自设不变式）：不存在 → 响亮拒绝，消息含规则本体。 */
async function assertIdBaseDir(root: string, idBase: string, id: string): Promise<void> {
  const dir = join(root, 'domains', idBase);
  let isDir = false;
  try {
    isDir = (await stat(dir)).isDirectory();
  } catch (err) {
    if ((err as { code?: unknown }).code !== 'ENOENT') throw err; // 环境级故障冒泡（→ exit 2）
  }
  if (!isDir) {
    throw new ProjectionError(
      `id base 必须等于领域目录名（domains/${idBase}/generated.ts 才是生成位）：` +
        `id '${id}' → base '${idBase}'，但目录 '${dir}/' 不存在`,
      id,
    );
  }
}

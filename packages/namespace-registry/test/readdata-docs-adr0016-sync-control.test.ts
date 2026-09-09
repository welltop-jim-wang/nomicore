/**
 * SA6 负控/基线 — issue #274：readData 语义 schema 投影（ADR 0016）文档同步契约。
 *
 * 本文件全部用例在 HEAD（#273/#272 已合入）与目标文档同步后都应保持绿，功能：
 * 1. **行为锚（运行时事实）**：按 docs/integration/cordis-plugin-hosting.md「创建、
 *    读取、修改和重新打开」示例原样装配真实 Registry（Cordis + stub persistence +
 *    registry plugin），实测 `lease.readData(['title'])` 输出形状——成功分支恰三键
 *    { ok, value, schema }、schema 非 null 且为四键投影体。该事实即 R7 红灯的
 *    行为侧证据：文档注记 `// { ok: true, value: 'first' }` 与真实输出矛盾。
 * 2. **匹配器敏感性单元验证**：每个文档内容锚都做正样本（绿）/负样本（红）双向
 *    校验，防关键词空转、防伪红伪绿（断言失败即 matcher 设计与实现缺陷）。
 * 3. **负控内容扫描**（目标同步后仍须保持）：docs/integration 其余 readData 示例
 *    无两键全等形状注记；作用域文档无 readData 带参（opt-in）用法（ADR-0016
 *    always-on）；typed-access 核心内容（VfslPathMap/--check）不被重写吞掉；
 *    权威源 ADR-0016 词汇在场（来源健全性）。
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DocHandle, DocPersistence, User } from '@nomicore/persistence';
import { provideNomicorePersistence } from '@nomicore/persistence';
import { createFakeTimerPlugin } from '@nomicore/persistence/testing';
import { createManualClock, createManualClockPlugin } from '@nomicore/clock/testing';
import {
  createNamespaceRegistryPlugin,
  requireNomicoreRegistry,
} from '@nomicore/namespace-registry';
import type { NamespaceLease } from '@nomicore/namespace-registry';
import { createRegistryTestScheduler } from '@nomicore/namespace-registry/testing';
import { Context } from '@deepseek-ai/cordis';
import { provideInstance } from '@nomicore/instance';
import {
  SCOPE_DOCS,
  adr0016Refs,
  hasConsumptionParagraph,
  hasFourKeyParagraph,
  hasKeyConventionParagraph,
  hasNullSemanticsParagraph,
  hasShapeParagraph,
  paragraphs,
  readDataOptionUsages,
  readRepoDoc,
  staleAnnotationViolations,
} from './readdata-docs-adr0016-contract-fixture.js';

// ── 行为锚装配（真实 Registry 组合；形态沿用 registry-sa7-cordis.test.ts）─────────

class CordisExampleStubHandle implements DocHandle {
  readonly doc: Y.Doc;

  constructor(readonly owner: User, readonly docId: string) {
    const doc = new Y.Doc();
    doc.getMap('SCHEMA').set('lang', 'vfsl');
    doc.getMap('SCHEMA').set('version', 1);
    doc.getMap('SCHEMA').set('id', 'notes-v1');
    doc.getMap('SCHEMA').set('text', 'type ROOT = { title: string; count: number };\n');
    doc.getMap('META').set('docId', docId);
    doc.getMap('ROOT').set('title', 'first');
    doc.getMap('ROOT').set('count', 0);
    this.doc = doc;
  }

  getStatus(): 'ready' {
    return 'ready';
  }

  release(): Promise<void> {
    return Promise.resolve();
  }
}

class CordisExampleStubPersistence implements DocPersistence {
  async loadDoc(owner: User, docId: string): Promise<DocHandle | null> {
    return new CordisExampleStubHandle(owner, docId);
  }

  async saveDoc(): Promise<void> {}

  async createDoc(owner: User, docId: string): Promise<DocHandle> {
    return new CordisExampleStubHandle(owner, docId);
  }
}

function stubPersistencePlugin(stub: CordisExampleStubPersistence): { name: string; apply(ctx: Context): void } {
  return {
    name: 'cordis-example-stub-persistence',
    apply(ctx: Context): void {
      provideNomicorePersistence(ctx, stub);
    },
  };
}

async function flushMicrotasks(times = 40): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function collectUnhandledRejections(): { readonly events: unknown[]; dispose(): void } {
  const events: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    events.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  return {
    events,
    dispose() {
      process.off('unhandledRejection', onRejection);
    },
  };
}

describe('行为锚：cordis-plugin-hosting 示例的真实输出形状（ADR-0016 成功分支恰三键）', () => {
  it('create 后 readData([\'title\']) 实测 = { ok:true, value:\'first\', schema: 四键非 null 投影 }——文档注记缺 schema 与运行时矛盾', async () => {
    const probe = collectUnhandledRejections();
    try {
      const scheduler = createRegistryTestScheduler();
      const ctx = new Context();
      provideInstance(ctx, Object.freeze({ instanceId: 'test-host', role: 'hub' }));
      createManualClockPlugin(createManualClock(1_700_000_123_456)).apply(ctx);
      createFakeTimerPlugin(scheduler).apply(ctx);
      const stub = new CordisExampleStubPersistence();
      const persistenceFiber = ctx.plugin(stubPersistencePlugin(stub));
      await persistenceFiber;
      const plugin = createNamespaceRegistryPlugin();
      const registryFiber = ctx.plugin(plugin);
      await registryFiber;
      const registry = requireNomicoreRegistry(ctx);

      const created = await registry.create({
        owner: { userId: 'acme-user' },
        schema: { lang: 'vfsl', version: 1, id: 'notes-v1', text: 'type ROOT = { title: string; count: number };\n' },
        root: { title: 'first', count: 0 },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('unreachable');
      const lease: NamespaceLease = created.lease;

      const r1 = lease.readData(['title']);
      expect(r1.ok).toBe(true);
      if (!r1.ok) throw new Error('unreachable');
      expect(r1.value).toBe('first');
      // 成功分支恰三键（ADR-0016：{ ok, value, schema }）——文档注记少 schema 键即矛盾。
      expect(Object.keys(r1).sort()).toEqual(['ok', 'schema', 'value']);
      expect(JSON.stringify(r1)).toContain('"schema"');
      // schema 非 null（schemaState=ready + 路径在 schema 内），四键投影体。
      expect(r1.schema).not.toBeNull();
      expect(Object.keys(r1.schema as object).sort()).toEqual(['aliasDocs', 'aliases', 'docs', 'valueSchema']);

      const r2 = lease.readData(['count']);
      expect(r2.ok).toBe(true);
      if (!r2.ok) throw new Error('unreachable');
      expect(r2.value).toBe(0);
      expect(r2.schema).not.toBeNull();
      expect(Object.keys(r2).sort()).toEqual(['ok', 'schema', 'value']);

      await lease.release();
      await ctx.fiber.dispose();
      await flushMicrotasks();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(probe.events).toEqual([]);
    } finally {
      probe.dispose();
    }
  });
});

// ── 匹配器敏感性单元验证（防关键词空转：正样本绿 / 负样本红）──────────────────

describe('匹配器敏感性：正样本（绿）', () => {
  it('shape：中/英文规范样本均识别（含「语义 schema 投影」词形）', () => {
    expect(hasShapeParagraph('readData 成功分支返回 { ok: true, value, schema }：schema 为该路径的语义 schema 投影。')).toBe(true);
    expect(hasShapeParagraph('readData 成功分支返回 { ok: true, value, schema }：`schema` 为该路径的语义 schema 投影。')).toBe(true);
    expect(hasShapeParagraph("A successful `readData(path)` returns the value together with the path's semantic schema projection.")).toBe(true);
  });
  it('fourKey：四键具名样本识别', () => {
    expect(hasFourKeyParagraph('schema 四键投影体：valueSchema（值语义子树）、aliases（传递闭包别名）、docs 与 aliasDocs（注释切片）。')).toBe(true);
  });
  it('keyConvention：键规约样本识别（含同构/合成段锚词）', () => {
    expect(hasKeyConventionParagraph("docs/aliasDocs 的键规约与派生 schema 文档三表同构：§3 语法路径 + '<key>' 合成段寻址，别名以别名名锚定。")).toBe(true);
  });
  it('nullSemantics：中/英文判读指引样本识别', () => {
    expect(hasNullSemanticsParagraph('schema 为 null 覆盖三种缺席情形；null 不是读的失败，读的 ok 恒真。')).toBe(true);
    expect(hasNullSemanticsParagraph('A null `schema` is not a read failure: the read still succeeded.')).toBe(true);
  });
  it('consumption：凭投影构造读后 mutation 样本识别', () => {
    expect(hasConsumptionParagraph('读取后需要修改时，可凭随读返回的语义 schema 投影解读值域并构造合法 mutation。')).toBe(true);
  });
  it('staleAnnotation：含 schema 的三键注记不视为过时', () => {
    expect(staleAnnotationViolations("console.log(lease.readData(['title']))\n// { ok: true, value: 'first', schema: { valueSchema: {}, aliases: {}, docs: {}, aliasDocs: {} } }")).toEqual([]);
  });
});

describe('匹配器敏感性：负样本（红）——缺任一语义锚即拒绝', () => {
  it('shape：readData+投影但 schema 仅以 schema.vfsl 形式出现（现状段落回归样本）→ 拒绝', () => {
    expect(
      hasShapeParagraph('4. Prove that each consuming package\u2019s TypeScript Program contains its generated projection.\n5. Review generated diffs. Modify `schema.vfsl` or the generator contract\u2014not `generated.ts`\u2014when output is wrong.\n6. the adapter calls public `NamespaceLease.readData()` and `mutateData()`;'),
    ).toBe(false);
  });
  it('shape：readData+projection 但无 schema → 拒绝', () => {
    expect(hasShapeParagraph('readData 保持动态接口；类型投影由 codegen 在生成时完成。')).toBe(false);
  });
  it('shape：readData+schema 但无「schema 投影」相邻词形 → 拒绝', () => {
    expect(hasShapeParagraph('readData 成功时 value 恒在场；schema 无关读取。')).toBe(false);
  });
  it('fourKey：只提 valueSchema 不提 aliasDocs → 拒绝', () => {
    expect(hasFourKeyParagraph('投影包含 valueSchema 值语义子树与别名表（见 ADR-0016）。')).toBe(false);
  });
  it('keyConvention：有 aliasDocs 无键规约锚词 → 拒绝', () => {
    expect(hasKeyConventionParagraph('aliasDocs 与 docs 在每次读中随投影返回。')).toBe(false);
  });
  it('nullSemantics：null 语义反向陈述（"null 是读失败"类）→ 拒绝', () => {
    expect(hasNullSemanticsParagraph('schema 为 null 说明这次读取失败了。')).toBe(false);
    expect(hasNullSemanticsParagraph('value 缺席或 schema 缺失时不是读的失败。')).toBe(false);
  });
  it('consumption：mutation 与 schema 投影无关联的段落（现状段落回归样本）→ 拒绝', () => {
    expect(
      hasConsumptionParagraph('5. Review generated diffs. Modify `schema.vfsl` or the generator contract when output is wrong.\n6. the adapter calls public `NamespaceLease.readData()` and `mutateData()`; one narrow assertion may bridge a successful runtime result to its projected type.'),
    ).toBe(false);
    expect(hasConsumptionParagraph('mutation 必须最小、可合并、有语义；未知路径在类型层 fail closed。')).toBe(false);
  });
  it('staleAnnotation：缺 schema 的两键注记被标记', () => {
    const violations = staleAnnotationViolations("console.log(lease.readData(['title']))\n// { ok: true, value: 'first' }");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("value: 'first'");
  });
  it('optIn：readData 带第二实参被标记；无参形式不标记', () => {
    expect(readDataOptionUsages("const r = lease.readData(['title'], { schema: true })")).toHaveLength(1);
    expect(readDataOptionUsages("const r = lease.readData(['title'])")).toEqual([]);
  });
});

// ── 负控内容扫描（HEAD 与目标同步后均须绿）─────────────────────────────────────

describe('负控内容扫描：作用域文档与权威源一致性保持', () => {
  it('external-project-vfsl-codegen.md 现无（且不得引入）两键全等 readData 形状注记', () => {
    expect(staleAnnotationViolations(readRepoDoc(SCOPE_DOCS.externalCodegen))).toEqual([]);
  });
  it('typed-access.md 现无（且不得引入）两键全等 readData 形状注记', () => {
    expect(staleAnnotationViolations(readRepoDoc(SCOPE_DOCS.typedAccess))).toEqual([]);
  });
  it('作用域文档全部无 readData 带第二实参（opt-in）用法——ADR-0016 always-on', () => {
    for (const rel of Object.values(SCOPE_DOCS)) {
      expect(readDataOptionUsages(readRepoDoc(rel)), `${rel} 不得出现 readData(path, …) 带参用法`).toEqual([]);
    }
  });
  it('typed-access 核心内容保持（VfslPathMap 接线与 --check 新鲜度门禁不被重写吞掉）', () => {
    const text = readRepoDoc(SCOPE_DOCS.typedAccess);
    expect(text).toContain('VfslPathMap');
    expect(text).toContain('--check');
  });
  it('权威源健全性：ADR-0016 在场且含结果形状与 null 判读词汇（匹配器词汇的来源）', () => {
    const adr = readRepoDoc('docs/adr/0016-readdata-semantic-schema-projection.md');
    expect(adr0016Refs(adr)).toBe(true);
    expect(adr).toContain('schema: ReadDataSchemaProjection | null');
    expect(adr).toContain('不是读的失败');
    // 匹配器全部以 ADR/CONTEXT 词汇为本——段落切分健壮性冒烟。
    expect(paragraphs(adr).length).toBeGreaterThan(10);
  });
});

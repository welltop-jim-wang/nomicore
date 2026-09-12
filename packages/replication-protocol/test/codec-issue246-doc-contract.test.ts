/**
 * issue #246 文档契约测试（File A）——分块传输 wire 契约收口与实现代际互通矩阵的
 * 规范侧可执行验收（设计 §12.2；SA2 评审 iteration 1 approve）。
 *
 * 覆盖组：
 *  - D1：ADR 0013 状态「已接受」+ 两层权威让渡（wire 冻结值 → 协议文档；配置/理据 →
 *        ADR 保留）+ observer 事件词表单列为 local seam 词表（F4 枚举拆分）；
 *  - D2：协议 §10.3 由占位收口为完整 live UPDATE 分块契约（transfer 身份、发送端规则、
 *        接收端规则、错误码三分类映射 F3、未协商门控）；
 *  - D3：实现代际（v1/v2）三层消歧词条与过期注记清理（R27/N1）；
 *  - D4：§22 conformance 清单纳入互通矩阵、golden 与新消息码锁定值（AC4）；
 *  - D5：三方一致绿锚（§5/§6.1/§9.4/§13.2/§17/§23.1 冻结面只校验、不重登记，R26）；
 *  - D6：引用完整性（§22/ADR/CONTEXT 的 `*.test.ts` 与 `docs/` 路径存在性；
 *        ADR 0010 零分块引用守卫）。
 *
 * 断言源纪律（F2-3）：本文件只读取仓库根 `docs/` 下文件与 `CONTEXT.md`
 * （`readFileSync(new URL('../../../<path>', import.meta.url))`）。**禁止读取
 * `wiki/raw/**`**——该目录为历史 evidence、非规范契约（`docs/AGENTS.md` Authority 节），
 * 且为未跟踪任务产物。本文件是包内首个跨出包界读取仓库根 docs/CONTEXT 的契约测试
 * （先例 `codec-package-contract.test.ts` 只读本包文件）；读取边界在此显式登记。
 * 断言形态 = 「锚定子串/正则存在于指定节切片」；节切片按最近标题切分。
 *
 * N7 落地约定：引用文件名一律写仓库根相对全路径（`packages/.../x.test.ts`），
 * 使 D6-1 的存在性检查与引用文本自解释（裸文件名按仓库根解析会恒红）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAP_CHUNKED_UPDATE, MESSAGE_TYPES } from '@nomicore/replication-protocol';

const REPO_ROOT = new URL('../../../', import.meta.url);
const PROTOCOL_PATH = 'docs/protocols/instance-replication-v1.md';
const ADR13_PATH = 'docs/adr/0013-chunked-live-update-transfer.md';
const ADR10_PATH = 'docs/adr/0010-hub-peer-websocket-ydoc-replication.md';

function readRepoFile(relPath: string): string {
  return readFileSync(new URL(relPath, REPO_ROOT), 'utf8');
}

const PROTOCOL = readRepoFile(PROTOCOL_PATH);
const ADR13 = readRepoFile(ADR13_PATH);
const ADR10 = readRepoFile(ADR10_PATH);
const CONTEXT = readRepoFile('CONTEXT.md');

/** 按最近标题切分：返回 `heading` 起始节到下一个同级或更高级标题之间的正文。 */
function sliceSection(doc: string, heading: string): string {
  const lines = doc.split('\n');
  const start = lines.findIndex((line) => {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    return match !== null && match[2]!.trim().startsWith(heading);
  });
  if (start < 0) throw new Error(`找不到节标题：${heading}`);
  const level = /^(#+)/.exec(lines[start]!)![1]!.length;
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s/.exec(lines[index]!);
    if (match !== null && match[1]!.length <= level) break;
    body.push(lines[index]!);
  }
  return body.join('\n');
}

/** 句/分句切分（用于「该枚举子句不含…」类定向负向断言）。 */
function clauses(text: string): string[] {
  return text
    .split(/[。；\n]/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

/** CONTEXT.md 词条切片：标题匹配任一 matcher 的词条（标题行到下一个词条标题）。 */
function contextEntries(doc: string, matchers: readonly RegExp[]): string {
  const lines = doc.split('\n');
  const picked: string[] = [];
  let current: { title: string; body: string[] } | undefined;
  const flush = (): void => {
    if (current !== undefined && matchers.some((matcher) => matcher.test(current!.title))) {
      picked.push([current.title, ...current.body].join('\n'));
    }
    current = undefined;
  };
  for (const line of lines) {
    const match = /^\*\*(.+?)\*\*:?\s*$/.exec(line);
    if (match !== null) {
      flush();
      current = { title: match[1]!, body: [] };
      continue;
    }
    if (current !== undefined) current.body.push(line);
  }
  flush();
  return picked.join('\n');
}

const CONTEXT_CHUNKED_TERMS = contextEntries(CONTEXT, [
  /分块复制传输/,
  /UPDATE_CHUNK/,
  /CAP_CHUNKED_UPDATE/,
  /实现代际/,
]);

function testFileTokens(text: string): string[] {
  return [...new Set(text.match(/[\w][\w./-]*\.test\.ts/g) ?? [])];
}

function docsPathTokens(text: string): string[] {
  return [...new Set(text.match(/docs\/[\w./-]+\.md/g) ?? [])];
}

const STATUS_LINE = ADR13.split('\n').find((line) => line.startsWith('状态：')) ?? '';
const ADR13_SUBSTITUTION = sliceSection(ADR13, '取代与关联');

// ═══════════════════════════ D1 ADR 状态与权威让渡 ═══════════════════════════

describe('issue #246 D1：ADR 0013 接受状态与两层权威让渡', () => {
  it('D1-1 状态行 =「已接受」，且无「已提议/提议」状态残留', () => {
    expect(STATUS_LINE, 'ADR 0013 必须有状态行').not.toBe('');
    expect(STATUS_LINE).toContain('状态：已接受');
    expect(STATUS_LINE).not.toContain('状态：提议');
  });

  it('D1-2 权威让渡锚：wire 冻结值 + 协议文档 + 唯一权威；枚举子句不含事件词表', () => {
    const delegations = clauses(ADR13).filter((clause) => clause.includes('wire 冻结值'));
    expect(delegations.length, 'ADR 必须出现 wire 冻结值让渡子句').toBeGreaterThan(0);
    const anchor = delegations.find(
      (clause) =>
        clause.includes('唯一权威') &&
        clause.includes(PROTOCOL_PATH) &&
        ['消息码', '字段序', 'capability', '错误码', 'reason'].every((word) => clause.includes(word)),
    );
    expect(anchor, 'wire 冻结值枚举 + 协议文档唯一权威须同现于同一子句').toBeDefined();
    for (const clause of delegations) {
      expect(clause, 'wire 冻结值枚举子句不得并入 observer 事件词表（F4）').not.toContain('事件词表');
    }
  });

  it('D1-3 两层边界：配置表权威保留于 ADR（状态行或取代与关联节）', () => {
    const scope = `${STATUS_LINE}\n${ADR13_SUBSTITUTION}`;
    expect(scope, '配置表权威归属须显式保留于 ADR 侧').toMatch(/配置表[^。；\n]*权威|权威[^。；\n]*配置表/);
  });

  it('D1-4 取代与关联节：两层权威锚生效表述，且无旧未来时子句', () => {
    expect(ADR13_SUBSTITUTION).toContain(PROTOCOL_PATH);
    expect(ADR13_SUBSTITUTION, 'wire 冻结值 → 协议文档').toMatch(/wire 冻结值[^。\n]*唯一权威/);
    expect(ADR13_SUBSTITUTION, '配置语义/设计理据 → 本文').toMatch(
      /配置(语义|表)[^。\n]*(权威保留于本文|保留于本文)/,
    );
    expect(ADR13_SUBSTITUTION).not.toContain('接受后以该文档修订');
  });

  it('D1-5 observer 事件词表单列为 local seam 词表，且不与 wire 冻结值从属（F4）', () => {
    const seams = clauses(ADR13).filter((clause) => clause.includes('事件词表'));
    expect(seams.length, 'ADR 必须显式登记 observer 事件词表定位').toBeGreaterThan(0);
    const seamClause = seams.find(
      (clause) => clause.includes('local seam') || clause.includes('非 wire 契约'),
    );
    expect(seamClause, '事件词表须以 local seam / 非 wire 契约定位').toBeDefined();
    expect(seamClause).not.toContain('wire 冻结值');
  });
});

// ═══════════════════════════ D2 协议 §10.3 完整契约 ═══════════════════════════

const SECTION_103 = sliceSection(PROTOCOL, '10.3 UPDATE_CHUNK');

describe('issue #246 D2：协议 §10.3 由占位收口为完整 live UPDATE 分块契约', () => {
  it('D2-1 占位句「属后续切片」已消失', () => {
    expect(SECTION_103).not.toContain('属后续切片');
  });

  it('D2-2 发送端规则锚完整（进入条件/惰性切片/独立 sequence/调度与窗口槽/ACK 锚/中止复用）', () => {
    for (const anchor of [
      '> maxUpdateBytes',
      'CAP_CHUNKED_UPDATE',
      '出队发送时刻惰性进行',
      '每帧独立消费本发送方向 sequence',
      'round-robin',
      'in-flight 窗口槽',
      'ACK 计时锚 = 末 chunk 出站时刻',
      '中止复用既有机制',
    ]) {
      expect(SECTION_103, `发送端锚缺失：${anchor}`).toContain(anchor);
    }
  });

  it('D2-3 接收端规则锚完整（作用域四元组/分配前二维上界/三分类错误码/顺序核对/一次 apply + ACK 锚/超时路径/零写入）', () => {
    for (const anchor of [
      '(连接, 方向, namespaceId, transferId)',
      'maxChunkedUpdateBytes',
      'maxChunksPerUpdate',
      '首 chunk 在分配前',
      'UPDATE_TRANSFER_TOO_LARGE',
      'UPDATE_TRANSFER_VIOLATION',
      'maxConcurrentAssembliesPerConnection',
      'chunkIndex === 已收数量',
      'UPDATE_ACK',
      'ackedSequence = 末 chunk 帧序',
      'UPDATE_TRANSFER_EXPIRED',
      'live Y.Doc 零写入',
    ]) {
      expect(SECTION_103, `接收端锚缺失：${anchor}`).toContain(anchor);
    }
  });

  it('D2-4（绿锚）未协商门控句保留：payload 解析前 UNSUPPORTED_MESSAGE_TYPE / close 1002', () => {
    expect(SECTION_103).toContain('UNSUPPORTED_MESSAGE_TYPE');
    expect(SECTION_103).toContain('1002');
    expect(SECTION_103).toMatch(/payload 解析前/);
  });
});

// ═══════════════════════════ D3 术语一致性 ═══════════════════════════

describe('issue #246 D3：实现代际词表三层消歧与过期注记清理', () => {
  it('D3-1 协议 §1 含「实现代际」词条与三层消歧锚（envelopeVersion / protocolVersions / 非 protocol 版本）', () => {
    const section1 = sliceSection(PROTOCOL, '1. 术语与不变量');
    expect(section1).toContain('实现代际');
    expect(section1).toMatch(/与协议版本正交|实现代际[^。\n]*正交/);
    expect(section1).toMatch(/`envelopeVersion` 恒 1/);
    expect(section1).toMatch(/`protocolVersions` 不因代际变化/);
    expect(section1).toContain('非 protocol 版本');
  });

  it('D3-2（绿锚）协议文档零「协议版本 2 / envelope v2 / protocol v2」误读串', () => {
    for (const forbidden of ['协议版本 2', 'envelope v2', 'protocol v2']) {
      expect(PROTOCOL, `禁止把 v2 代际写成协议版本语义：${forbidden}`).not.toContain(forbidden);
    }
  });

  it('D3-3 CONTEXT.md 同步：含实现代际词条、无「ADR 0013 提议」、UPDATE_CHUNK 词条无过期切片注记', () => {
    expect(CONTEXT).toContain('实现代际');
    expect(CONTEXT).not.toContain('ADR 0013 提议');
    const updateChunkEntry = contextEntries(CONTEXT, [/^UPDATE_CHUNK$/]);
    expect(updateChunkEntry, 'CONTEXT.md 必须有 UPDATE_CHUNK 词条').not.toBe('');
    expect(updateChunkEntry).not.toContain('后续切片承接');
  });
});

// ═══════════════════════════ D4 §22 conformance 收口 ═══════════════════════════

const SECTION_22 = sliceSection(PROTOCOL, '22. Conformance tests');

describe('issue #246 D4：§22 conformance 清单收口（互通矩阵 + golden/锁定值）', () => {
  it('D4-1 §22 含实现代际互通矩阵条目：三代际格 + 三层确定性等同 + v1 基线文件名', () => {
    for (const anchor of [
      'v1 peer ↔ v2 hub',
      'v2 peer ↔ v1 hub',
      'v2 ↔ v2',
      'kind#sequence',
      '确定性字段',
      'kind+计数',
      'ws-replication-issue233-repro.test.ts',
      '#233 刻画',
    ]) {
      expect(SECTION_22, `§22 互通矩阵锚缺失：${anchor}`).toContain(anchor);
    }
  });

  it('D4-2 §22 分块/互通条目含锁定值 0x42 / 0x00000001 与 golden/矩阵资产指向', () => {
    expect(SECTION_22).toContain('0x42');
    expect(SECTION_22).toContain('0x00000001');
    for (const asset of [
      'codec-messages-golden.test.ts',
      'codec-issue242-ac-red.test.ts',
      'codec-version-interop.test.ts',
      'ws-replication-issue246-interop-matrix.test.ts',
    ]) {
      expect(SECTION_22, `§22 资产指向缺失：${asset}`).toContain(asset);
    }
  });
});

// ═══════════════════════════ D5 三方一致绿锚（冻结面回归锁定） ═══════════════════════════

describe('issue #246 D5：冻结面三方一致绿锚（只校验、不重登记）', () => {
  it('D5-1 §5 消息注册表 / §6.1 capability / §13.2 两错误码 / §9.4 reason 词表逐字在库', () => {
    const section5 = sliceSection(PROTOCOL, '5. 消息注册表');
    expect(section5).toMatch(/`0x42`\s*\|\s*UPDATE_CHUNK/);
    const section61 = sliceSection(PROTOCOL, '6.1 HELLO');
    expect(section61).toContain('0x00000001');
    expect(section61).toContain('CAP_CHUNKED_UPDATE');
    const section132 = sliceSection(PROTOCOL, '13.2 Namespace error registry');
    expect(section132).toMatch(/UPDATE_TRANSFER_VIOLATION\s*\|\s*yes/);
    expect(section132).toMatch(/UPDATE_TRANSFER_TOO_LARGE\s*\|\s*yes/);
    const section94 = sliceSection(PROTOCOL, '9.4 RESYNC_REQUIRED');
    expect(section94).toContain('UPDATE_TRANSFER_EXPIRED');
  });

  it('D5-2 §17 四配置键名 + 跨字段链①② + 「不得运行时 clamp」在节内', () => {
    const section17 = sliceSection(PROTOCOL, '17. 背压');
    for (const anchor of [
      'maxChunkedUpdateBytes',
      'maxChunksPerUpdate',
      'maxConcurrentAssembliesPerConnection',
      'assemblyTimeoutMs',
      'maxChunkedUpdateBytes <= maxQueuedUpdateBytes',
      'maxChunkedUpdateBytes <= maxChunksPerUpdate * maxUpdateBytes',
    ]) {
      expect(section17, `§17 锚缺失：${anchor}`).toContain(anchor);
    }
    expect(section17).toContain('不得运行时 clamp');
  });

  it('D5-3 §23.1 分块 observer 四事件类型一行一型在库', () => {
    const section231 = sliceSection(PROTOCOL, '23.1 事件词汇');
    for (const anchor of [
      'chunked-update-sent',
      'chunked-update-applied',
      'chunked-update-acked',
      'chunked-update-aborted',
    ]) {
      expect(section231, `§23.1 事件缺失：${anchor}`).toContain(anchor);
    }
  });

  it('D5-4 实现常量与文档登记值三方相等（0x42 / 0x00000001）', () => {
    expect(MESSAGE_TYPES.UPDATE_CHUNK).toBe(0x42);
    expect(CAP_CHUNKED_UPDATE).toBe(0x00000001);
    const section5 = sliceSection(PROTOCOL, '5. 消息注册表');
    expect(section5).toContain(`\`0x${MESSAGE_TYPES.UPDATE_CHUNK.toString(16)}\``);
    const section61 = sliceSection(PROTOCOL, '6.1 HELLO');
    expect(section61).toContain(`\`0x${CAP_CHUNKED_UPDATE.toString(16).padStart(8, '0')}\``);
  });

  it('D5-5 §10.3 单帧字段表六字段序保持（namespaceId→transferId→chunkIndex→chunkCount→totalBytes→bytes）', () => {
    const order = ['namespaceId', 'transferId', 'chunkIndex', 'chunkCount', 'totalBytes', 'bytes'];
    let cursor = -1;
    for (const field of order) {
      const at = SECTION_103.indexOf(`| ${field} |`, cursor + 1);
      expect(at, `§10.3 字段表缺字段或字段序漂移：${field}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });
});

// ═══════════════════════════ D6 引用完整性 ═══════════════════════════

describe('issue #246 D6：链接与引用文件名检查（可执行化）', () => {
  it('D6-1 §22 / ADR 0013 / CONTEXT 分块词条引用的 *.test.ts 全部相对仓库根存在', () => {
    const tokens = testFileTokens(`${SECTION_22}\n${ADR13}\n${CONTEXT_CHUNKED_TERMS}`);
    expect(tokens.length, '三处规范源必须携带可解析的测试资产引用').toBeGreaterThan(0);
    for (const token of tokens) {
      expect(existsSync(new URL(token, REPO_ROOT)), `引用文件名不存在：${token}`).toBe(true);
    }
  });

  it('D6-2 ADR 0013 与 CONTEXT 分块词条引用的 docs/*.md 路径全部存在', () => {
    const tokens = docsPathTokens(`${ADR13}\n${CONTEXT_CHUNKED_TERMS}`);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(existsSync(new URL(token, REPO_ROOT)), `引用文档路径不存在：${token}`).toBe(true);
    }
  });

  it('D6-3 守卫：ADR 0010 零分块引用（权威边界无双重登记）', () => {
    expect(ADR10).not.toMatch(/UPDATE_CHUNK|CAP_CHUNKED|分块/);
  });
});

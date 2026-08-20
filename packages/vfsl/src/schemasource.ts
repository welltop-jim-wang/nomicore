/**
 * SchemaSource 接缝 + FileSchemaSource + 方言断言（issue #25 / F1，ADR 0005 §1/§2 落地）。
 *
 * 定位：投影生成管线的第一块承重接缝——一切脚手架消费方（F2 生成器、G dogfood、CI 校验）
 * 经 `SchemaSource` 取文本，终态切 `DocSchemaSource` 时零消费方改动（ADR 0001 修订节
 * 「脚手架纪律」）。本模块是文件格式层，不是方言层：
 *
 * - 头部 `// @lang/@id/@version` 指令注释是文件格式约定（ADR 0005 §2），不是语义层机器
 *   标签——ADR 0001「无机器标签」条款不触及；带头部的 `.vfsl` 文本可直接被 `parseVfsl`
 *   解析（行注释是词法 trivia，v1-spec §2 注记 9/10），本模块零文本变换；
 * - 错误通道与方言层 `VfslIssue`（`{message,line,column}`）互不相干：结构化错误
 *   `SchemaSourceError { kind:'schema-source', code, id?, path? }` 管「这份数据是不是它
 *   自称的 schema」，不复用 `errors.ts` 的 VFSL-E 码注册表；
 * - 信封 `{ lang, version, id, text }` 与 CONTEXT.md / v1-spec §7 逐字一致；`lang` 保持
 *   `string`（方言泛型，不窄化到 `'vfsl'`——方言约束由断言层执行）。
 *
 * 头部解析规则（§3）：指令只在**前导 trivia 区**识别（空白行 / `//` 行注释 / 完整块注释
 * 组成的极大前缀，遇首行代码即停）；三键大小写敏感；空值 = 缺失；重复键 = 响亮
 * 拒绝（missing-directive）；未知键容忍忽略（文件格式开放扩展点）；块注释内伪指令不计。
 *
 * 寻址规则（§4）：id→文件两级寻址——一级 = 头部 `@id` 精确入册（首胜，id 的权威来源）；
 * 二级 = `@<digits>` 后缀剥离后按目录名**诊断回退**（「缺 @id 报 missing-directive 而非
 * unknown-id」的机制）。每次 load/list 现扫、无缓存、恒新鲜；`list()` 绝不静默跳过损坏
 * 文件（一坏全拒，AC5 可见性的运行时根基）。
 */
import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

/** ADR 0005 §1 冻结的接缝形状（async from day one、完整信封、list 枚举）。 */
export interface SchemaSource {
  load(id: string): Promise<SchemaEnvelope>;
  list(): Promise<string[]>;
}

/** CONTEXT.md / v1-spec §7 信封形状（方言中立载体；恰四键，不夹带成员）。 */
export interface SchemaEnvelope {
  lang: string;
  version: number;
  id: string;
  text: string;
}

/** 接缝层结构化错误的三码语义域（与方言层 VfslIssue 两套通道，见文件头注释）。 */
export type SchemaSourceErrorCode = 'missing-directive' | 'dialect-mismatch' | 'unknown-id';

/**
 * 接缝层结构化错误：响亮失败的唯一渠道（load 签名返回 `Promise<SchemaEnvelope>`，
 * 拒绝走 Promise rejection，绝不 resolve 降级/空信封）。
 *
 * `kind`/`code` 为可枚举自有属性（useDefineForClassFields 下类字段即 defineProperty）——
 * `rejects.toMatchObject({ kind, code })` 直接可见；可选字段按 exactOptionalPropertyTypes
 * 纪律「判后再赋」，不显式赋 undefined。
 */
export class SchemaSourceError extends Error {
  readonly kind = 'schema-source';
  readonly code: SchemaSourceErrorCode;
  /** 请求的 id（可知时）。 */
  readonly id?: string;
  /** 涉事文件完整路径（诊断定位）。 */
  readonly path?: string;

  constructor(
    code: SchemaSourceErrorCode,
    message: string,
    context?: { id?: string; path?: string },
  ) {
    super(message);
    this.name = 'SchemaSourceError';
    this.code = code;
    if (context?.id !== undefined) {
      this.id = context.id;
    }
    if (context?.path !== undefined) {
      this.path = context.path;
    }
  }
}

/** 方言断言输入：信封方言两键 + 可选 id（错误上下文）。`SchemaEnvelope` 结构可赋值于此。 */
export interface DialectAssertionInput {
  lang: string;
  version: number;
  id?: string;
}

/**
 * 方言断言（ADR 0005 §1「消费方首动作 = 方言断言」）：`lang === 'vfsl' && version === 1`，
 * 不符即抛 `SchemaSourceError('dialect-mismatch')`。断言语义单点冻结——FileSchemaSource
 * 信封组装点（层 1，挡「盘上是什么」）与消费方对到手信封（层 2，挡「信封是什么」）共用
 * 本函数，双层防御非冗余。
 */
export function assertVfslDialect(input: DialectAssertionInput): void {
  if (input.lang !== 'vfsl' || input.version !== 1) {
    const message =
      `方言不符: 期望 lang='vfsl'、version=1，实际 lang='${input.lang}'、version=${String(input.version)}`;
    throw new SchemaSourceError(
      'dialect-mismatch',
      message,
      input.id !== undefined ? { id: input.id } : undefined,
    );
  }
}

/**
 * 阶段态仓内文件源：扫描 `<root>/domains/<domain>/*.vfsl`（深度恰为 1+1）。入参语义 =
 * 「包含 `domains/` 的根目录」（仓内使用即传 repo 根，与 ADR 0005 §5「顶层 domains/」一致）。
 */
export class FileSchemaSource implements SchemaSource {
  readonly root: string;

  /** 同步、零 I/O——仅记录根路径；扫描在每次 load/list 调用时现做（无缓存、恒新鲜）。 */
  constructor(root: string) {
    this.root = root;
  }

  /**
   * 两级寻址（§4.2）：
   * - 一级：头部 `@id` 精确入册（id 的权威来源，文件自述），按扫描序首胜；
   * - 二级：`<base>@<digits>` 后缀剥离 → 目录名诊断回退（决策树）——「存在但其声明
   *   损坏」报 missing-directive 而非 unknown-id 的机制。
   *
   * 拒绝分类（§3.3 顺序即语义）：先寻址后校验（文件没找到谈不上键校验）；先完整性后
   * 方言（键都没有谈不上方言）。
   */
  async load(id: string): Promise<SchemaEnvelope> {
    // 早出：带 @<digits> 后缀且 base 非单一路径段 → 在触碰文件系统之前即出局（防穿越，
    // 结构性按名匹配之外的双保险）。
    const suffix = /^(.+)@(\d+)$/.exec(id);
    const base = suffix === null ? undefined : (suffix[1] as string);
    if (base !== undefined && !isSingleSegment(base)) {
      throw new SchemaSourceError(
        'unknown-id',
        `未知 id: '${id}'（base 含路径分隔符或为 '.'/'..'——不按路径寻址）`,
        { id },
      );
    }

    const { entries } = await scanDomains(this.root);

    // 一级：首胜查表（条目数组顺序 = 目录名 sort → 文件名 sort，确定性；重复 id 排序在
    // 先者胜出，后来者不覆盖）。
    for (const entry of entries) {
      if (declaredIdOf(entry.header) !== id) {
        continue;
      }
      const text = await readFile(entry.path, 'utf8');
      // 以最新内容为准：扫描后文件若变更（头部 id 不再相符）→ 视同未命中（宁可不存在，
      // 不可拿错文件）。
      const fresh = parseHeaderDirectives(text);
      if (declaredIdOf(fresh) !== id) {
        continue;
      }
      const { lang, version, id: headerId } = validateHeader(fresh, entry.path, id);
      return { lang, version, id: headerId, text };
    }

    // 二级：诊断回退决策树（仅对带 @<digits> 后缀的 id；无后缀的 id 仅走一级）。
    if (base !== undefined) {
      return resolveViaDirFallback(base, id, entries);
    }

    throw new SchemaSourceError('unknown-id', `未知 id: '${id}'（无任何文件声明该 id）`, { id });
  }

  /**
   * 枚举 + 逐文件完整校验（§3.3 全树）：任一文件头部损坏或方言不符 → 整体 reject
   * （结构化错误，含 path）——静默跳过坏文件会让 CI 对坏文件失明（AC5 反面），
   * 「一个坏文件拖死整个枚举」正是想要的。返回按序声明的 id，重复项原样保留
   * （重复可见，暴露而非隐藏）。
   */
  async list(): Promise<string[]> {
    const { entries, strays } = await scanDomains(this.root);
    if (strays.length > 0) {
      // 顶层散放 = 布局错误（非三码语义域）：整体 reject，原生 Error（不臆造第 4 码）。
      throw new Error(
        `[vfsl] 布局错误: domains/ 顶层散放 schema 文件（${strays.join('、')}）` +
          `——领域 schema 应位于 domains/<domain>/（ADR 0005 §5）`,
      );
    }
    const ids: string[] = [];
    for (const entry of entries) {
      const { id } = validateHeader(entry.header, entry.path);
      ids.push(id);
    }
    return ids;
  }
}

// ---------------------------------------------------------------------------
// 内部实现（头部解析 / 扫描 / 校验——不是接缝，是 FileSchemaSource 的实现细节）
// ---------------------------------------------------------------------------

/** 三键契约：文件格式冻结的必需指令（ADR 0005 §2）。 */
const CONTRACT_KEYS = new Set(['lang', 'id', 'version']);

/** 指令行模式：行首空白容忍；键为 `[A-Za-z0-9_]+`；恰一个冒号（值域排除冒号）；值 trim。 */
const DIRECTIVE_RE = /^\s*\/\/\s*@(\w+)\s*:\s*([^:]*?)\s*$/;
const LINE_COMMENT_RE = /^\s*\/\//;
const BLOCK_COMMENT_RE = /^\s*\/\*/;

/** 行内最后一个块注释闭合符之后是否残留非空白内容（有 → 该行是「块注释闭合 + 同行代码」，按首行代码处理）。 */
function hasCodeAfterBlockClose(line: string): boolean {
  return /\S/.test(line.slice(line.lastIndexOf('*/') + 2));
}

interface HeaderParse {
  /** 三键中「值非空」的解析结果（空值 = 缺失，不入表；重复键取首个出现值）。 */
  directives: Map<string, string>;
  /** 非空出现次数 ≥ 2 的三键（身份声明歧义 → 响亮拒绝，消息含出现数）。 */
  duplicateKeys: Array<{ key: string; count: number }>;
}

/**
 * 前导 trivia 区指令解析（§3.1/§3.2）：自文件首行起，由「空白行 / `//` 行注释 / 完整
 * 块注释（以 `/*` 起始、跨行闭合的整体跳过）」组成的极大前缀内识别指令；遇首行代码
 * 即停（代码行之后的 `// @id:` 不
 * 识别——防模块正文散文注释劫持身份声明）。块注释整体跳过，内部各行一律不计为指令
 * （防散文示例里的 `// @id:` 被误读）；块注释闭合之后若同行残留非空白内容
 * （单行块注释、跨行闭合行皆然）→ 该行按首行代码处理，前导区终止。BOM
 * （ECMAScript `\s` 含 U+FEFF）与 CRLF（尾 `\r` 被 `\s*$` 吸收）天然容忍。
 */
function parseHeaderDirectives(text: string): HeaderParse {
  const directives = new Map<string, string>();
  const counts = new Map<string, number>();
  let inBlockComment = false;
  for (const line of text.split('\n')) {
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
        if (hasCodeAfterBlockClose(line)) {
          break; // 闭合符之后同行残留代码 → 首行代码，头部区结束
        }
      }
      continue;
    }
    if (/^\s*$/.test(line)) {
      continue; // 空行 = trivia
    }
    if (BLOCK_COMMENT_RE.test(line)) {
      if (line.includes('*/')) {
        if (hasCodeAfterBlockClose(line)) {
          break; // 行内闭合后残留代码 → 首行代码，头部区结束
        }
      } else {
        inBlockComment = true; // 跨行块注释：余下行全部跳过直至闭合
      }
      continue;
    }
    if (LINE_COMMENT_RE.test(line)) {
      const m = DIRECTIVE_RE.exec(line);
      if (m !== null) {
        const key = m[1] as string;
        const value = m[2] as string;
        if (CONTRACT_KEYS.has(key) && value !== '') {
          if (!directives.has(key)) {
            directives.set(key, value);
          }
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      continue; // 行注释（含不匹配的散文注释）跳过，继续扫
    }
    break; // 首行代码 → 头部区结束
  }
  const duplicateKeys = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([key, count]) => ({ key, count }));
  return { directives, duplicateKeys };
}

/** 扫描产物：每个 `domains/<d>/<f>.vfsl` 一条（序 = 目录名 sort → 文件名 sort，确定性）。 */
interface ScanEntry {
  /** 目录名（单段，与 id base 按名精确相等比较）。 */
  dir: string;
  /** 文件名（含 .vfsl 后缀）。 */
  file: string;
  /** 完整路径（诊断定位）。 */
  path: string;
  /** 该文件头部解析结果（读取时点）。 */
  header: HeaderParse;
}

interface ScanResult {
  entries: ScanEntry[];
  /** domains/ 顶层散放 .vfsl 完整路径（布局错误，仅 list() 消费）。 */
  strays: string[];
}

/**
 * 现扫 `<root>/domains/`（§4.1/§4.3）：深度恰为 1+1；目录名与文件名均 sort() 保证确定
 * 性；排除 `.` 开头目录/文件（备份暂存非领域包形态）、深层 `.vfsl`（防 dogfood 测试
 * fixture 混入注册）、非 `.vfsl` 文件。目录判据 = `dirent.isDirectory()`（I1：不跟随
 * 符号链接，防盘外注册）。`domains/` 缺失（ENOENT）→ 合法空集（设计内状态）；ENOTDIR /
 * EACCES 等环境级故障原样冒泡（虚假降级会掩盖调用方 bug / 仓内异常状态）。
 */
async function scanDomains(root: string): Promise<ScanResult> {
  const domainsDir = join(root, 'domains');
  let top: Dirent[];
  try {
    top = await readdir(domainsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return { entries: [], strays: [] };
    }
    throw err;
  }
  const dirs = top
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
  const entries: ScanEntry[] = [];
  for (const dir of dirs) {
    const sub = await readdir(join(domainsDir, dir), { withFileTypes: true });
    const files = sub
      .filter((f) => f.isFile() && f.name.endsWith('.vfsl') && !f.name.startsWith('.'))
      .map((f) => f.name)
      .sort();
    for (const file of files) {
      const path = join(domainsDir, dir, file);
      entries.push({
        dir,
        file,
        path,
        header: parseHeaderDirectives(await readFile(path, 'utf8')),
      });
    }
  }
  const strays = top
    .filter((d) => d.isFile() && d.name.endsWith('.vfsl') && !d.name.startsWith('.'))
    .map((d) => join(domainsDir, d.name))
    .sort();
  return { entries, strays };
}

/** 头部损坏（重复键 / 三键缺失或空值）→ missing-directive 错误；完好 → null。 */
function headerDamageError(
  parsed: HeaderParse,
  path: string,
  requestedId?: string,
): SchemaSourceError | null {
  // exactOptionalPropertyTypes：可选字段不显式赋 undefined——判后再赋。
  const context: { id?: string; path?: string } = { path };
  if (requestedId !== undefined) {
    context.id = requestedId;
  }
  if (parsed.duplicateKeys.length > 0) {
    const first = parsed.duplicateKeys[0] as { key: string; count: number };
    return new SchemaSourceError(
      'missing-directive',
      `头部指令重复: @${first.key} 出现 ${first.count} 次（${path}）`,
      context,
    );
  }
  const missing: string[] = [];
  for (const key of CONTRACT_KEYS) {
    if (parsed.directives.get(key) === undefined) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    return new SchemaSourceError(
      'missing-directive',
      `头部缺少指令: @${missing.join('、@')}（${path}）`,
      context,
    );
  }
  return null;
}

interface ValidatedHeader {
  lang: string;
  version: number;
  id: string;
}

/**
 * §3.3 校验树（先完整性后方言）：重复键 / 三键缺失 → missing-directive（消息指明键与
 * 文件路径）；三键齐 → 层 1 内建方言断言（`version` 值非 `/^\d+$/` → NaN → 断言失败，
 * 归 dialect-mismatch）。
 */
function validateHeader(parsed: HeaderParse, path: string, requestedId?: string): ValidatedHeader {
  const damage = headerDamageError(parsed, path, requestedId);
  if (damage !== null) {
    throw damage;
  }
  const lang = parsed.directives.get('lang') ?? '';
  const id = parsed.directives.get('id') ?? '';
  const versionStr = parsed.directives.get('version') ?? '';
  const version = /^\d+$/.test(versionStr) ? Number(versionStr) : NaN;
  try {
    assertVfslDialect({ lang, version, id: requestedId ?? id });
  } catch (err) {
    // 补 path 上下文（盘上文件定位）后重抛；其余错误原样冒泡。
    if (err instanceof SchemaSourceError && err.code === 'dialect-mismatch' && err.path === undefined) {
      throw new SchemaSourceError('dialect-mismatch', err.message, {
        id: requestedId ?? id,
        path,
      });
    }
    throw err;
  }
  return { lang, version, id };
}

/** 头部完整 = 三键齐且无重复键（不含方言有效性——lang/version 值不符仍是「健康声明」）。 */
function isComplete(parsed: HeaderParse): boolean {
  return (
    parsed.duplicateKeys.length === 0 &&
    parsed.directives.get('lang') !== undefined &&
    parsed.directives.get('id') !== undefined &&
    parsed.directives.get('version') !== undefined
  );
}

/** 入册资格 = 「@id 恰出现一次且值非空」：返回声明 id；重复 @id / 缺失 → undefined（不入册）。 */
function declaredIdOf(parsed: HeaderParse): string | undefined {
  const id = parsed.directives.get('id');
  if (id === undefined || parsed.duplicateKeys.some((d) => d.key === 'id')) {
    return undefined;
  }
  return id;
}

/** 剥离尾部 `@<digits>` 后缀得 base（无后缀 → 整串；后缀剥离是回退的启发式，不是 id 的语法义务）。 */
function baseOf(idStr: string): string {
  return /^(.+)@(\d+)$/.exec(idStr)?.[1] ?? idStr;
}

/**
 * base 单一路径段校验（R2 #5）：含 `/` 或 `\`（跨平台分隔符）、恰为 `.` / `..` / 空串
 * （整串相等；`broken.id` 这类含点子串的合法段不受影响）→ 非法。非法 base 直接 unknown-id、
 * 零文件系统访问——校验早出 + 结构性按名匹配双保险防穿越。
 */
function isSingleSegment(base: string): boolean {
  return (
    base !== '' &&
    base !== '.' &&
    base !== '..' &&
    !base.includes('/') &&
    !base.includes('\\')
  );
}

/**
 * 二级诊断回退决策树（R2 #2，四分支互斥且并集覆盖目录全部状态）。一句话冻结：
 * **missing-directive 仅当「目录内有损坏文件可指」且「无健康同 base 声明」**。
 * 本函数必抛（load 失败路径），不返回。
 */
function resolveViaDirFallback(base: string, id: string, entries: ScanEntry[]): never {
  const dirEntries = entries.filter((e) => e.dir === base);
  // 分支 1：目录不存在，或存在但无 .vfsl 文件 → unknown-id
  if (dirEntries.length === 0) {
    throw new SchemaSourceError(
      'unknown-id',
      `未知 id: '${id}'（domains/${base}/ 下无 schema 文件）`,
      { id },
    );
  }
  // 分支 2：有「头部完整且声明 base 与请求一致」的健康文件 → unknown-id（附实际声明 id
  // ——版本打错（请求 v2 vs 盘上完好 v1）一眼可诊）
  const healthy = dirEntries.filter(
    (e) => isComplete(e.header) && baseOf(declaredIdOf(e.header) ?? '') === base,
  );
  if (healthy.length > 0) {
    const first = healthy[0] as ScanEntry;
    throw new SchemaSourceError(
      'unknown-id',
      `未知 id: '${id}'（domains/${base}/ 内文件实际声明 ${declaredIdOf(first.header) ?? ''}——版本打错或 id 不符）`,
      { id, path: first.path },
    );
  }
  // 分支 3：无健康同 base 声明，但目录内存在损坏文件（缺键/空值/重复键）→ missing-directive
  // （排序首个损坏者——entries 已按序；消息含路径与所缺键）
  for (const e of dirEntries) {
    const damage = headerDamageError(e.header, e.path, id);
    if (damage !== null) {
      throw damage;
    }
  }
  // 分支 4：无健康同 base 声明、且文件头部全部完整（声明的全是别的 base——目录名 ↔ @id
  // 背离）→ unknown-id（附目录内实际声明的 id）
  const first = dirEntries[0] as ScanEntry;
  throw new SchemaSourceError(
    'unknown-id',
    `未知 id: '${id}'（domains/${base}/ 内文件实际声明 ${declaredIdOf(first.header) ?? ''}——目录名与 @id 背离）`,
    { id, path: first.path },
  );
}
